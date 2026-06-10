-- Fix 1: Remove orphaned FK so vehicles can be deleted by admin.
-- Inspections keep their vehicle_reg text value; FK enforcement is removed.
ALTER TABLE public.inspections
  DROP CONSTRAINT IF EXISTS fk_inspections_vehicles;

ALTER TABLE public.inspections
  DROP CONSTRAINT IF EXISTS inspections_vehicle_reg_fkey;

-- Fix 2: Add slip_image_urls column to recon_sheets for driver photo uploads.
ALTER TABLE public.recon_sheets
  ADD COLUMN IF NOT EXISTS slip_image_urls JSONB NOT NULL DEFAULT '[]';

-- Fix 3: Ensure vehicle_checklists has a profile FK for driver name joins.
-- (Only needed if the FK was not already created; safe to run repeatedly.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_checklists_driver_id_fkey'
      AND conrelid = 'public.vehicle_checklists'::regclass
  ) THEN
    ALTER TABLE public.vehicle_checklists
      ADD CONSTRAINT vehicle_checklists_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES public.profiles(driver_id)
      ON DELETE SET NULL;
  END IF;
END;
$$;
