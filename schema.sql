-- ============================================================
--  TRANSROUTE PWA — DATABASE SCHEMA
--  Run this entire file in Supabase → SQL Editor
-- ============================================================

-- 1. PROFILES (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   TEXT        UNIQUE NOT NULL,
  name        TEXT        NOT NULL,
  phone       TEXT,
  role        TEXT        NOT NULL DEFAULT 'driver'
                          CHECK (role IN ('driver', 'admin')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. VEHICLES
CREATE TABLE IF NOT EXISTS public.vehicles (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_no  TEXT    UNIQUE NOT NULL,
  model            TEXT    NOT NULL,
  make             TEXT,
  year             INTEGER,
  current_mileage  INTEGER NOT NULL DEFAULT 0,
  next_service_km  INTEGER,
  status           TEXT    NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'maintenance', 'decommissioned')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. BOOKINGS
CREATE TABLE IF NOT EXISTS public.bookings (
  id            UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_no    TEXT  UNIQUE NOT NULL,
  client_name   TEXT  NOT NULL,
  route         TEXT,
  start_date    DATE  NOT NULL,
  end_date      DATE  NOT NULL,
  assigned_driver_id TEXT REFERENCES public.profiles(driver_id),
  assigned_vehicle_reg TEXT REFERENCES public.vehicles(registration_no),
  status        TEXT  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','invoiced','completed','cancelled')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. INSPECTIONS
CREATE TABLE IF NOT EXISTS public.inspections (
  id                   UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_no           TEXT    REFERENCES public.bookings(invoice_no) ON DELETE SET NULL,
  vehicle_reg          TEXT    NOT NULL REFERENCES public.vehicles(registration_no),
  driver_id            TEXT    NOT NULL REFERENCES public.profiles(driver_id),
  inspection_type      TEXT    NOT NULL CHECK (inspection_type IN ('pre-trip', 'post-trip')),
  checklist_json       JSONB   NOT NULL DEFAULT '{}',
  faults_json          JSONB   NOT NULL DEFAULT '[]',
  media_urls           JSONB   NOT NULL DEFAULT '[]',
  mileage_at_inspection INTEGER,
  notes                TEXT,
  has_critical_fault   BOOLEAN NOT NULL DEFAULT false,
  alert_sent           BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. RECON SHEETS (weekly driver trip-cost/wellness sheet)
CREATE TABLE IF NOT EXISTS public.recon_sheets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id         TEXT NOT NULL REFERENCES public.profiles(driver_id),
  week_start        DATE NOT NULL,
  week_end          DATE NOT NULL,
  tour_reference    TEXT,
  tour_vehicle      TEXT,
  vehicle_reg       TEXT,
  start_km          INTEGER,
  end_km            INTEGER,
  total_distance_km INTEGER DEFAULT 0,
  trips_completed   INTEGER DEFAULT 0,
  total_hours       NUMERIC(8,2),
  cost_lines_text   TEXT,
  trip_budget       TEXT,
  trip_cost         TEXT,
  driver_food       TEXT,
  flights_to        TEXT,
  flights_from      TEXT,
  driver_rate       TEXT,
  accommodation     TEXT,
  total_profit_loss TEXT,
  director_sign_off TEXT,
  vehicle_issues       TEXT,
  accidents_incidents  TEXT,
  traffic_violations   TEXT,
  safety_concerns      TEXT,
  maintenance_needed   TEXT,
  fuel_consumption     TEXT,
  tires_condition      TEXT,
  fatigue_level        INTEGER CHECK (fatigue_level BETWEEN 1 AND 10),
  stress_level         INTEGER CHECK (stress_level BETWEEN 1 AND 10),
  health_issues        TEXT,
  driver_notes         TEXT,
  admin_review_notes   TEXT,
  edit_request_status TEXT DEFAULT 'none' CHECK (edit_request_status IN ('none','pending','approved','rejected')),
  edit_request_reason TEXT,
  edit_request_sent_at TIMESTAMPTZ,
  edit_request_approved_by UUID REFERENCES public.profiles(id),
  edit_request_approved_at TIMESTAMPTZ,
  edit_request_rejection_reason TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reviewed')),
  submitted_at      TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES public.profiles(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 6. DRIVER INVITES (admin-only controlled onboarding)
CREATE TABLE IF NOT EXISTS public.driver_invites (
  email      TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL,
  invited_by UUID REFERENCES public.profiles(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at    TIMESTAMPTZ
);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle  ON public.inspections(vehicle_reg);
CREATE INDEX IF NOT EXISTS idx_inspections_driver   ON public.inspections(driver_id);
CREATE INDEX IF NOT EXISTS idx_inspections_date     ON public.inspections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_fault    ON public.inspections(has_critical_fault);
CREATE INDEX IF NOT EXISTS idx_bookings_driver      ON public.bookings(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates       ON public.bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_recon_driver         ON public.recon_sheets(driver_id);
CREATE INDEX IF NOT EXISTS idx_recon_week           ON public.recon_sheets(week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_recon_status         ON public.recon_sheets(status);

-- ── UPDATED_AT TRIGGER ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_recon_updated_at
  BEFORE UPDATE ON public.recon_sheets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── AUTO-CREATE PROFILE ON SIGN-UP ───────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, driver_id, name, role)
  VALUES (
    NEW.id,
    'DRV-' || UPPER(SUBSTRING(NEW.id::text, 1, 6)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'driver')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_invites ENABLE ROW LEVEL SECURITY;

-- Admin helper (avoids recursive RLS policy checks)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- profiles: users see their own; admins see all
CREATE POLICY "profiles_self"  ON public.profiles FOR SELECT
  USING (auth.uid() = id);
CREATE POLICY "profiles_admin" ON public.profiles FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- vehicles: all authenticated users can read; only admins can write
CREATE POLICY "vehicles_read"  ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicles_admin" ON public.vehicles FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- bookings: all authenticated users can read; only admins can write
CREATE POLICY "bookings_read"  ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bookings_admin" ON public.bookings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- inspections: drivers see their own; admins see all
CREATE POLICY "inspections_own"   ON public.inspections FOR SELECT
  USING (
    driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "inspections_insert" ON public.inspections FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "inspections_admin"  ON public.inspections FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- recon_sheets: drivers can read/write own records; admins can read/write all
CREATE POLICY "recon_own_select" ON public.recon_sheets FOR SELECT
  USING (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "recon_own_insert" ON public.recon_sheets FOR INSERT
  WITH CHECK (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "recon_own_update" ON public.recon_sheets FOR UPDATE
  USING (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "recon_admin" ON public.recon_sheets FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());



-- driver_invites: only admins can read/write
CREATE POLICY "driver_invites_admin" ON public.driver_invites FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── SAMPLE SEED DATA (optional — delete if not needed) ────────
INSERT INTO public.vehicles (registration_no, model, make, year, current_mileage, next_service_km, status)
VALUES
  ('CA 123 456', 'Quantum 2.5 TDi', 'Toyota', 2021, 85000, 90000, 'active'),
  ('CA 789 012', 'Sprinter 316 CDI', 'Mercedes-Benz', 2020, 120000, 125000, 'active'),
  ('GP 345 678', 'Hiace 2.5 D4D', 'Toyota', 2019, 210000, 215000, 'maintenance')
ON CONFLICT DO NOTHING;
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS booking_documents JSONB DEFAULT '[]'::jsonb;

-- 7. TRANSFER RECON SHEETS (weekly driver transfer payment form)
CREATE TABLE IF NOT EXISTS public.transfer_recon_sheets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   TEXT        NOT NULL REFERENCES public.profiles(driver_id),
  week_start  DATE        NOT NULL,
  week_end    DATE        NOT NULL,
  transfers   JSONB       NOT NULL DEFAULT '[]',
  status      TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'reviewed')),
  submitted_at  TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES public.profiles(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_recon_driver ON public.transfer_recon_sheets(driver_id);
CREATE INDEX IF NOT EXISTS idx_transfer_recon_week   ON public.transfer_recon_sheets(week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_transfer_recon_status ON public.transfer_recon_sheets(status);

CREATE TRIGGER trg_transfer_recon_updated_at
  BEFORE UPDATE ON public.transfer_recon_sheets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.transfer_recon_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transfer_recon_own_select" ON public.transfer_recon_sheets FOR SELECT
  USING (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "transfer_recon_own_insert" ON public.transfer_recon_sheets FOR INSERT
  WITH CHECK (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "transfer_recon_own_update" ON public.transfer_recon_sheets FOR UPDATE
  USING (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "transfer_recon_admin" ON public.transfer_recon_sheets FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ═══════════════════════════════════════════════════════════════
-- FEATURE ADDITIONS (run these in Supabase SQL editor)
-- ═══════════════════════════════════════════════════════════════

-- 8a. FEATURE 1 — Receipt tracking on bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS receipt_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_receipt_number
  ON public.bookings(receipt_number) WHERE receipt_number IS NOT NULL;

-- 8b. FEATURE 3 — Recon sheet edit-request workflow
ALTER TABLE public.recon_sheets
  ADD COLUMN IF NOT EXISTS edit_request_status TEXT DEFAULT 'none'
    CHECK (edit_request_status IN ('none','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS edit_request_reason TEXT,
  ADD COLUMN IF NOT EXISTS edit_request_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_request_approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS edit_request_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_request_rejection_reason TEXT;

-- 8c. FEATURE 3 & 6 — OTP verifications (hashed, 15-min expiry)
CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID        REFERENCES public.profiles(id),
  resource_type TEXT        NOT NULL CHECK (resource_type IN ('recon_edit','booking_edit','booking_delete')),
  resource_id   UUID        NOT NULL,
  otp_hash      TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  verified_at   TIMESTAMPTZ,
  attempts      INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_otp_resource ON public.otp_verifications(resource_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_otp_expires  ON public.otp_verifications(expires_at);
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "otp_admin_all" ON public.otp_verifications
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 8d. FEATURE 4 — Vehicle maintenance alert tracking
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS maintenance_alert_sent    BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_alert_sent_at TIMESTAMPTZ;

-- 8e. FEATURE 5 — Itinerary per booking (admin uploads, driver reads)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS itinerary_url         TEXT,
  ADD COLUMN IF NOT EXISTS itinerary_filename    TEXT,
  ADD COLUMN IF NOT EXISTS itinerary_uploaded_at TIMESTAMPTZ;

-- 8f. FEATURE 6 — Booking edit audit trail
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS last_modified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS modification_reason  TEXT;

CREATE TABLE IF NOT EXISTS public.booking_edit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  admin_id    UUID        REFERENCES public.profiles(id),
  action      TEXT        NOT NULL CHECK (action IN ('edit','delete')),
  reason      TEXT,
  old_values  JSONB,
  new_values  JSONB,
  approved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edit_log_booking ON public.booking_edit_log(booking_id);
ALTER TABLE public.booking_edit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edit_log_admin" ON public.booking_edit_log
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 8g. FEATURE 4 — Enable pg_cron for nightly maintenance-alert job
-- Run the following manually in Supabase SQL editor (requires superuser):
-- SELECT cron.schedule(
--   'check-vehicle-maintenance',
--   '0 6 * * *',
--   $$
--     SELECT net.http_post(
--       url:='https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/check-vehicle-maintenance',
--       headers:='{"Authorization":"Bearer SUPABASE_ANON_KEY","Content-Type":"application/json"}'::jsonb,
--       body:='{}'::jsonb
--     )
--   $$
-- );
