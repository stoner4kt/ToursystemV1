-- Booking delete requests table
CREATE TABLE IF NOT EXISTS public.booking_delete_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  requested_by        UUID        NOT NULL REFERENCES public.profiles(id),
  reason              TEXT        NOT NULL,
  cancellation_type   TEXT        NOT NULL CHECK (cancellation_type IN ('mistake','client_cancelled')),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','approved','rejected')),
  rejection_reason    TEXT,
  reviewed_by         UUID        REFERENCES public.profiles(id),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delete_requests_booking  ON public.booking_delete_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_delete_requests_status   ON public.booking_delete_requests(status);
CREATE INDEX IF NOT EXISTS idx_delete_requests_requester ON public.booking_delete_requests(requested_by);

ALTER TABLE public.booking_delete_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delete_requests_admin" ON public.booking_delete_requests
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Ensure booking_delete is in the OTP constraint (idempotent alter)
ALTER TABLE public.otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_resource_type_check;

ALTER TABLE public.otp_verifications
  ADD CONSTRAINT otp_verifications_resource_type_check
  CHECK (resource_type IN (
    'recon_edit','booking_edit','booking_delete',
    'expense_approval','incident_delete'
  ));

-- Ensure booking_edit_log has a reason column
ALTER TABLE public.booking_edit_log
  ADD COLUMN IF NOT EXISTS reason TEXT;
