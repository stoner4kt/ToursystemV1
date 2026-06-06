-- Fix: build rental_period using Africa/Johannesburg wall-clock times, not UTC.
-- Safe to re-run (idempotent).

-- 1. Replace the trigger function to use SAST timezone for date-only inputs.
CREATE OR REPLACE FUNCTION public.set_booking_rental_period()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  computed_start TIMESTAMPTZ;
  computed_end   TIMESTAMPTZ;
BEGIN
  -- If explicit timestamps are supplied, use them directly.
  -- Otherwise, interpret the DATE columns as Africa/Johannesburg wall-clock midnight.
  computed_start := COALESCE(
    NEW.start_time,
    (NEW.start_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Africa/Johannesburg'
  );

  computed_end := COALESCE(
    NEW.end_time,
    -- End date is INCLUSIVE in the UI: extend to 23:59:59 SAST on that day.
    (NEW.end_date::text || ' 23:59:59')::timestamp AT TIME ZONE 'Africa/Johannesburg'
  );

  IF computed_start IS NULL THEN
    RAISE EXCEPTION 'Booking start_time/start_date is required to compute rental_period';
  END IF;

  IF computed_end <= computed_start THEN
    RAISE EXCEPTION 'Booking end_time/end_date must be after start_time/start_date';
  END IF;

  NEW.start_time   := computed_start;
  NEW.end_time     := computed_end;
  -- Use closed-closed [) range: start inclusive, end exclusive (end+1 second).
  NEW.rental_period := tstzrange(computed_start, computed_end + interval '1 second', '[)');
  RETURN NEW;
END;
$$;

-- 2. Backfill all existing bookings that still have a UTC-based rental_period.
UPDATE public.bookings
SET
  start_time = (start_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Africa/Johannesburg',
  end_time   = (end_date::text   || ' 23:59:59')::timestamp AT TIME ZONE 'Africa/Johannesburg',
  rental_period = tstzrange(
    (start_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Africa/Johannesburg',
    (end_date::text   || ' 23:59:59')::timestamp AT TIME ZONE 'Africa/Johannesburg' + interval '1 second',
    '[)'
  )
WHERE
  -- Only rows whose rental_period was built from a naive UTC cast need updating.
  -- Detect by comparing: a UTC midnight cast differs from a SAST midnight cast by 2 hours.
  start_time IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (
    start_time -
    ((start_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Africa/Johannesburg')
  ))) > 1;

-- 3. Ensure the trigger is (re)attached.
DROP TRIGGER IF EXISTS trg_bookings_rental_period ON public.bookings;
CREATE TRIGGER trg_bookings_rental_period
  BEFORE INSERT OR UPDATE OF start_date, end_date, start_time, end_time
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_rental_period();
