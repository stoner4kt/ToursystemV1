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
  CLOUDINARY_CLOUD_NAME: 'YOUR_CLOUD_NAME',
  CLOUDINARY_UPLOAD_PRESET: 'YOUR_UNSIGNED_UPLOAD_PRESET',

  // ── App Branding ─────────────────────────────────────────
  APP_NAME: 'TransRoute',
  COMPANY_NAME: 'Your Company Name (Pty) Ltd',
  ADMIN_EMAIL: 'admin@yourcompany.com',

  // ── Fault Alert Edge Function ────────────────────────────
  // https://app.supabase.com → Edge Functions → fault-alert → URL
  FAULT_ALERT_FUNCTION_URL: 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/fault-alert',

  // ── Optional Cloudflare Worker Webhooks (Google Sheets logging) ─
  WORKER_BOOKINGS_WEBHOOK_URL: 'https://YOUR_WORKER.workers.dev/bookings',
  WORKER_INSPECTIONS_WEBHOOK_URL: 'https://YOUR_WORKER.workers.dev/inspections',
  WORKER_SHARED_TOKEN: 'YOUR_WORKER_SHARED_TOKEN',
};
