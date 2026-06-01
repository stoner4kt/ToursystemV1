// ============================================================
//  TRANSROUTE PWA — CONFIGURATION
//  Edit ONLY this file before deploying.
//  See SETUP_GUIDE.md for where to find each value.
// ============================================================
const CONFIG = {
  // ── Supabase ─────────────────────────────────────────────
  // https://app.supabase.com → Your Project → Settings → API
  SUPABASE_URL: 'https://jxsesdcwdjrxydkvhpsh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4c2VzZGN3ZGpyeHlka3ZocHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTAyNDEsImV4cCI6MjA5MzQ4NjI0MX0.IKbWP2e29tZDPYfafhI72f-DQ8EjllmldplP3jv04tM',

  // ── Cloudinary ───────────────────────────────────────────
  // https://cloudinary.com/console
  CLOUDINARY_CLOUD_NAME: 'dzf97vyjs',
  CLOUDINARY_UPLOAD_PRESET: 'transroute_uploads',

  // ── App Branding ─────────────────────────────────────────
  APP_NAME: 'INYATHI',
  COMPANY_NAME: 'INYATHI (Pty) Ltd',
  ADMIN_EMAIL: 'info@inyathi.co.za',

  // ── Fault Alert Edge Function ────────────────────────────
  // https://app.supabase.com → Edge Functions → fault-alert → URL
  FAULT_ALERT_FUNCTION_URL: 'https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/fault-alert',

  // ── OTP Edge Functions (Features 3 & 6) ──────────────────
  SEND_OTP_FUNCTION_URL:   'https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/send-otp-email',
  VERIFY_OTP_FUNCTION_URL: 'https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/verify-otp',
  NOTIFY_EXPENSE_FUNCTION_URL: 'https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/notify-expense-submitted',
  NOTIFY_DRIVER_FINE_FUNCTION_URL: 'https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/notify-driver-fine',

  // ── Maintenance Alert Edge Function (Feature 4) ───────────
  MAINTENANCE_ALERT_FUNCTION_URL: 'https://jxsesdcwdjrxydkvhpsh.supabase.co/functions/v1/check-vehicle-maintenance',

  // ── Feature Flags ─────────────────────────────────────────
  // Set to true only after deploying OTP edge functions + RESEND_API_KEY secret
  OTP_ENABLED: false,

  // ── Cloudflare Workers Webhooks (security + logging) ─────────────
  // Receives booking write events for downstream compliance logging.
  WORKER_BOOKINGS_WEBHOOK_URL: 'https://transroute-security.YOUR_ACCOUNT.workers.dev/bookings',
  // Receives inspection submission events for operational monitoring.
  WORKER_INSPECTIONS_WEBHOOK_URL: 'https://transroute-security.YOUR_ACCOUNT.workers.dev/inspections',
  // Receives weekly recon-sheet submission and review events.
  WORKER_RECON_WEBHOOK_URL: 'https://transroute-security.YOUR_ACCOUNT.workers.dev/recon-sheets',
  // Shared bearer token validated by the Cloudflare Worker.
  WORKER_SHARED_TOKEN: 'your-generated-token-here',
};
