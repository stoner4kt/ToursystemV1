-- ============================================================
--  REGION SUPPORT — Cape Town / Joburg location separation
--  Safe to run repeatedly (idempotent, uses IF NOT EXISTS).
-- ============================================================

-- 1. Add location to profiles (drivers)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT 'Cape Town'
    CHECK (location IN ('Cape Town', 'Joburg'));

CREATE INDEX IF NOT EXISTS idx_profiles_location ON public.profiles(location);

-- 2. Add location to vehicles
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT 'Cape Town'
    CHECK (location IN ('Cape Town', 'Joburg'));

CREATE INDEX IF NOT EXISTS idx_vehicles_location ON public.vehicles(location);

-- 3. Add location to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT 'Cape Town'
    CHECK (location IN ('Cape Town', 'Joburg'));

CREATE INDEX IF NOT EXISTS idx_bookings_location ON public.bookings(location);

-- 4. Add location to driver_invites (no default — set explicitly at invite time)
ALTER TABLE public.driver_invites
  ADD COLUMN IF NOT EXISTS location TEXT;

-- Note: public.handle_new_user() does not need to set location explicitly;
-- the DEFAULT 'Cape Town' on profiles.location handles new signups automatically.

-- Note: rented_vehicles intentionally has no location column (sourced ad hoc per booking).
