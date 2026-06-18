-- Add edit-request workflow columns to transfer_recon_sheets (idempotent)
ALTER TABLE public.transfer_recon_sheets
  ADD COLUMN IF NOT EXISTS edit_request_status TEXT DEFAULT 'none'
    CHECK (edit_request_status IN ('none','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS edit_request_reason TEXT,
  ADD COLUMN IF NOT EXISTS edit_request_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_request_approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS edit_request_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_request_rejection_reason TEXT;

-- Extend OTP resource_type enum to include transfer_recon_edit
ALTER TABLE public.otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_resource_type_check;

ALTER TABLE public.otp_verifications
  ADD CONSTRAINT otp_verifications_resource_type_check
  CHECK (resource_type IN (
    'recon_edit', 'booking_edit', 'booking_delete',
    'expense_approval', 'incident_delete', 'transfer_recon_edit'
  ));
