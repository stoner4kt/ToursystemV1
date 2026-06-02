CREATE TABLE IF NOT EXISTS public.rented_vehicles (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier      TEXT          NOT NULL,
  reg_no        TEXT          NOT NULL,
  make          TEXT,
  model         TEXT,
  start_date    DATE,
  end_date      DATE,
  daily_rate    NUMERIC(12,2),
  supplier_ref  TEXT,
  status        TEXT          NOT NULL DEFAULT 'active',
  notes         TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Link rented vehicle data to bookings and inspections.
-- Safe to re-run (idempotent).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_rented_vehicle     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rented_vehicle_id     UUID        REFERENCES public.rented_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rented_vehicle_reg    TEXT,
  ADD COLUMN IF NOT EXISTS rented_vehicle_model  TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_rented_vehicle_id
  ON public.bookings(rented_vehicle_id)
  WHERE rented_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_is_rented
  ON public.bookings(is_rented_vehicle)
  WHERE is_rented_vehicle = true;

ALTER TABLE public.rented_vehicles
  ADD COLUMN IF NOT EXISTS assigned_booking_id   UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_driver_id    TEXT REFERENCES public.profiles(driver_id) ON DELETE SET NULL;

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS is_rented_vehicle     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rented_vehicle_model  TEXT;

-- Rented vehicles are not in public.vehicles, so rented inspections must be able
-- to store a registration that does not exist in the owned fleet table.
ALTER TABLE public.inspections
  DROP CONSTRAINT IF EXISTS inspections_vehicle_reg_fkey;
