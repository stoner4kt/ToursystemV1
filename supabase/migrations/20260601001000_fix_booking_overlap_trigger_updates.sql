-- Ensure overlap validation also runs when admins move an existing booking by
-- editing date/time columns. This is required in deployments where the guarded
-- exclusion constraint was skipped because legacy overlapping bookings existed.

DROP TRIGGER IF EXISTS trg_prevent_booking_vehicle_overlap ON public.bookings;

CREATE TRIGGER trg_prevent_booking_vehicle_overlap
  BEFORE INSERT OR UPDATE OF assigned_vehicle_reg, rental_period, status, start_date, end_date, start_time, end_time
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_booking_vehicle_overlap();
