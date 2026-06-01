-- Vehicle-to-driver fine lookup and notification support.
-- Safe to run repeatedly in Supabase SQL editor / migrations.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Keep profile email locally available for driver fine notifications without
-- needing to expose auth.users to client-side queries.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email) WHERE email IS NOT NULL;

UPDATE public.profiles p
SET email = COALESCE(p.email, u.email)
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, driver_id, name, role, email)
  VALUES (
    NEW.id,
    'DRV-' || UPPER(SUBSTRING(NEW.id::text, 1, 6)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'driver'),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = COALESCE(public.profiles.email, EXCLUDED.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Preserve existing date-based booking workflow, while adding optional precise
-- timestamps for fine attribution and a range column optimized for lookup.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rental_period TSTZRANGE;

-- Backfill precise timestamps/ranges from historical DATE fields. End dates are
-- treated as inclusive by existing UI, so the timestamp range is [start, end+1d).
UPDATE public.bookings
SET
  start_time = COALESCE(start_time, start_date::timestamptz),
  end_time = COALESCE(end_time, (end_date + 1)::timestamptz),
  rental_period = tstzrange(
    COALESCE(start_time, start_date::timestamptz),
    COALESCE(end_time, (end_date + 1)::timestamptz, 'infinity'::timestamptz),
    '[)'
  )
WHERE rental_period IS NULL OR start_time IS NULL;

CREATE OR REPLACE FUNCTION public.set_booking_rental_period()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  computed_start TIMESTAMPTZ;
  computed_end   TIMESTAMPTZ;
BEGIN
  computed_start := COALESCE(NEW.start_time, NEW.start_date::timestamptz);
  computed_end := COALESCE(NEW.end_time, (NEW.end_date + 1)::timestamptz, 'infinity'::timestamptz);

  IF computed_start IS NULL THEN
    RAISE EXCEPTION 'Booking start_time/start_date is required to compute rental_period';
  END IF;

  IF computed_end <= computed_start THEN
    RAISE EXCEPTION 'Booking end_time/end_date must be after start_time/start_date';
  END IF;

  NEW.start_time := computed_start;
  NEW.end_time := NULLIF(computed_end, 'infinity'::timestamptz);
  NEW.rental_period := tstzrange(computed_start, computed_end, '[)');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_rental_period ON public.bookings;
CREATE TRIGGER trg_bookings_rental_period
  BEFORE INSERT OR UPDATE OF start_date, end_date, start_time, end_time
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_rental_period();

CREATE INDEX IF NOT EXISTS idx_bookings_rental_period_gist
  ON public.bookings USING gist (rental_period);

CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_rental_period_gist
  ON public.bookings USING gist (assigned_vehicle_reg, rental_period)
  WHERE assigned_vehicle_reg IS NOT NULL AND status <> 'cancelled';

-- Exclusion constraint requested for future correctness. The guard keeps the
-- migration idempotent and prevents a surprise failure when legacy overlapping
-- records already exist; fix those records, rerun the migration, and the
-- constraint will be installed. The trigger below still blocks new overlaps.
DO $$
DECLARE
  has_conflicts BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b1
    JOIN public.bookings b2
      ON b1.id < b2.id
     AND b1.assigned_vehicle_reg = b2.assigned_vehicle_reg
     AND b1.status <> 'cancelled'
     AND b2.status <> 'cancelled'
     AND b1.rental_period && b2.rental_period
    WHERE b1.assigned_vehicle_reg IS NOT NULL
  ) INTO has_conflicts;

  IF NOT has_conflicts
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'bookings_no_vehicle_rental_overlap'
         AND conrelid = 'public.bookings'::regclass
     ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_no_vehicle_rental_overlap
      EXCLUDE USING gist (
        assigned_vehicle_reg WITH =,
        rental_period WITH &&
      )
      WHERE (assigned_vehicle_reg IS NOT NULL AND status <> 'cancelled');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_booking_vehicle_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_vehicle_reg IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings existing
    WHERE existing.id <> NEW.id
      AND existing.assigned_vehicle_reg = NEW.assigned_vehicle_reg
      AND existing.status <> 'cancelled'
      AND existing.rental_period && NEW.rental_period
  ) THEN
    RAISE EXCEPTION 'Vehicle % already has an overlapping booking in %',
      NEW.assigned_vehicle_reg, NEW.rental_period;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_booking_vehicle_overlap ON public.bookings;
CREATE TRIGGER trg_prevent_booking_vehicle_overlap
  BEFORE INSERT OR UPDATE OF assigned_vehicle_reg, rental_period, status
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_booking_vehicle_overlap();

-- Admin-only RPC used by the Supabase client. Accepts either the vehicle UUID
-- or registration number for compatibility with current UI data.
CREATE OR REPLACE FUNCTION public.lookup_driver_by_fine_time(
  p_vehicle_id TEXT,
  p_fine_timestamp TIMESTAMPTZ
)
RETURNS TABLE (
  booking_id UUID,
  driver_id TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  driver_email TEXT,
  vehicle_reg TEXT,
  invoice_no TEXT,
  client_name TEXT,
  rental_period TSTZRANGE
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.assigned_driver_id,
    p.name,
    p.phone,
    p.email,
    b.assigned_vehicle_reg,
    b.invoice_no,
    b.client_name,
    b.rental_period
  FROM public.bookings b
  LEFT JOIN public.profiles p ON p.driver_id = b.assigned_driver_id
  LEFT JOIN public.vehicles v ON v.registration_no = b.assigned_vehicle_reg
  WHERE public.is_admin()
    AND b.status <> 'cancelled'
    AND b.assigned_driver_id IS NOT NULL
    AND (b.assigned_vehicle_reg = p_vehicle_id OR v.id::text = p_vehicle_id)
    AND b.rental_period @> p_fine_timestamp
  ORDER BY lower(b.rental_period) DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_driver_by_fine_time(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_driver_by_fine_time(TEXT, TIMESTAMPTZ) TO authenticated;

CREATE TABLE IF NOT EXISTS public.traffic_fines (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  vehicle_reg          TEXT        NOT NULL REFERENCES public.vehicles(registration_no) ON DELETE RESTRICT,
  driver_id           TEXT        NOT NULL REFERENCES public.profiles(driver_id) ON DELETE RESTRICT,
  fine_timestamp      TIMESTAMPTZ NOT NULL,
  fine_reference      TEXT,
  location            TEXT,
  description         TEXT,
  amount              NUMERIC(12,2) CHECK (amount IS NULL OR amount >= 0),
  notification_email  TEXT,
  email_sent          BOOLEAN     NOT NULL DEFAULT false,
  email_sent_at       TIMESTAMPTZ,
  notification_error  TEXT,
  logged_by_admin_id  UUID        REFERENCES public.profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT traffic_fines_notification_email_format
    CHECK (notification_email IS NULL OR notification_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_traffic_fines_booking ON public.traffic_fines(booking_id);
CREATE INDEX IF NOT EXISTS idx_traffic_fines_driver ON public.traffic_fines(driver_id);
CREATE INDEX IF NOT EXISTS idx_traffic_fines_vehicle_time ON public.traffic_fines(vehicle_reg, fine_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_fines_created ON public.traffic_fines(created_at DESC);

DROP TRIGGER IF EXISTS trg_traffic_fines_updated_at ON public.traffic_fines;
CREATE TRIGGER trg_traffic_fines_updated_at
  BEFORE UPDATE ON public.traffic_fines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_traffic_fine()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  booking_record RECORD;
  driver_email TEXT;
BEGIN
  SELECT * INTO booking_record
  FROM public.bookings
  WHERE id = NEW.booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % does not exist', NEW.booking_id;
  END IF;

  IF NOT (booking_record.rental_period @> NEW.fine_timestamp) THEN
    RAISE EXCEPTION 'Fine timestamp % is outside booking % rental period %',
      NEW.fine_timestamp, NEW.booking_id, booking_record.rental_period;
  END IF;

  IF booking_record.assigned_vehicle_reg IS DISTINCT FROM NEW.vehicle_reg
     OR booking_record.assigned_driver_id IS DISTINCT FROM NEW.driver_id THEN
    RAISE EXCEPTION 'Fine vehicle/driver must match the selected booking';
  END IF;

  SELECT email INTO driver_email
  FROM public.profiles
  WHERE driver_id = NEW.driver_id;

  IF COALESCE(NULLIF(NEW.notification_email, ''), NULLIF(driver_email, '')) IS NULL THEN
    RAISE EXCEPTION 'At least one notification email is required: profile email or notification_email';
  END IF;

  NEW.notification_email := NULLIF(NEW.notification_email, '');
  NEW.logged_by_admin_id := COALESCE(NEW.logged_by_admin_id, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_traffic_fine ON public.traffic_fines;
CREATE TRIGGER trg_validate_traffic_fine
  BEFORE INSERT OR UPDATE OF booking_id, vehicle_reg, driver_id, fine_timestamp, notification_email
  ON public.traffic_fines
  FOR EACH ROW EXECUTE FUNCTION public.validate_traffic_fine();

ALTER TABLE public.traffic_fines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'traffic_fines' AND policyname = 'traffic_fines_driver_select') THEN
    CREATE POLICY "traffic_fines_driver_select" ON public.traffic_fines FOR SELECT
      USING (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'traffic_fines' AND policyname = 'traffic_fines_admin_all') THEN
    CREATE POLICY "traffic_fines_admin_all" ON public.traffic_fines FOR ALL
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END;
$$;
