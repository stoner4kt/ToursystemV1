-- Ensure incident_reports table exists with all required columns
CREATE TABLE IF NOT EXISTS public.incident_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID        REFERENCES public.bookings(id) ON DELETE SET NULL,
  driver_id       TEXT        NOT NULL REFERENCES public.profiles(driver_id),
  vehicle_reg     TEXT        NOT NULL,
  incident_type   TEXT        NOT NULL DEFAULT 'other',
  description     TEXT,
  location        TEXT,
  injuries        BOOLEAN     NOT NULL DEFAULT false,
  photo_urls      JSONB       NOT NULL DEFAULT '[]',
  document_urls   JSONB       NOT NULL DEFAULT '[]',
  status          TEXT        NOT NULL DEFAULT 'reported'
                              CHECK (status IN ('reported','reviewed','closed')),
  admin_notes     TEXT,
  reviewed_by     UUID        REFERENCES public.profiles(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns if table already existed
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS photo_urls    JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS document_urls JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS admin_notes   TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by   UUID  REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;

-- Backfill vehicle_reg from legacy pdf_url column if any rows have null
UPDATE public.incident_reports
SET vehicle_reg = 'UNKNOWN'
WHERE vehicle_reg IS NULL OR vehicle_reg = '';

-- Add NOT NULL if it wasn't originally
ALTER TABLE public.incident_reports
  ALTER COLUMN vehicle_reg SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_driver  ON public.incident_reports(driver_id);
CREATE INDEX IF NOT EXISTS idx_incidents_vehicle ON public.incident_reports(vehicle_reg);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON public.incident_reports(created_at DESC);

CREATE OR REPLACE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='incident_reports' AND policyname='incidents_driver_select') THEN
    CREATE POLICY "incidents_driver_select" ON public.incident_reports FOR SELECT
      USING (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='incident_reports' AND policyname='incidents_driver_insert') THEN
    CREATE POLICY "incidents_driver_insert" ON public.incident_reports FOR INSERT
      WITH CHECK (driver_id = (SELECT driver_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='incident_reports' AND policyname='incidents_admin_all') THEN
    CREATE POLICY "incidents_admin_all" ON public.incident_reports FOR ALL
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END;
$$;
