---
name: 8-feature implementation decisions
description: Key decisions made when implementing the 8 production features for the INYATHI PWA.
---

## Feature 1 — Receipt Tracking
- `receipt_number TEXT UNIQUE` on bookings (partial index, NULLs not unique)
- Booking items in calendar coloured green (paid) / orange (unpaid) via `.booking-paid` / `.booking-unpaid` CSS classes
- Receipt number field added to booking modal in index.html

## Feature 2 — Document Preview
- `renderBookingDocumentsList()` in admin.js now shows image thumbnails (max 60px), PDF/Word icons, file size, upload date
- Collapses into a `<details>` element when 5+ documents are attached

## Feature 3 — Recon Edit OTP
- Driver sets `edit_request_status='pending'` on recon_sheets via `submitReconEditRequest()`
- Admin sees pending requests in `loadReconReview()` with Approve/Reject buttons
- Approval requires OTP if `CONFIG.OTP_ENABLED=true`; if false, admin gets a `confirm()` dialog instead
- `loadReconHistory()` in driver-dashboard.js loads `recon_sheets` history with edit request status badges

## Feature 4 — Maintenance Alert
- `check-vehicle-maintenance` edge function: sends Resend email alert for bookings ending in 2 days
- Manual trigger supported via POST `{ booking_id }` body
- `maintenance_alert_sent` column prevents duplicate alerts; admin can re-trigger via archive table button

## Feature 5 — Itinerary Upload
- Itinerary stored separately from `booking_documents` (its own Cloudinary URL + filename + timestamp)
- Drivers see "View Itinerary" button on task cards only when `itinerary_url` is set
- Admin uploads via separate file input in booking modal; shown via `renderItineraryPreview()`

## Feature 6 — Booking Edit OTP
- `CONFIG.OTP_ENABLED = false` by default — must be set to `true` AFTER deploying edge functions + RESEND_API_KEY
- When enabled: saving existing booking triggers OTP modal, `pendingBookingSave` stores payload until verified
- Every edit (OTP or direct) creates a `booking_edit_log` entry with `action='edit'` and `new_values` JSONB
- `performBookingSave()` is now the single save path (called after OTP verify or directly when OTP disabled)

## Feature 7 — Inspection Signatures
- `embedSignature()` in pdf-generator.js now validates base64, strips data URI prefix, converts to Uint8Array
- Scale factor clamped to `Math.min(0.25, 150/sigImage.width)` to prevent overflow
- Fallback: draws a bordered rectangle with "Signature on file [timestamp]" text

## Feature 8 — Desktop Layout
- At 1025px+: `#app-sidebar` gets `transform: translateX(0) !important` (always visible)
- `.main` gets `margin-left: var(--sidebar-w)`, `max-width: none`, `padding: 28px 36px`
- `.sidebar-close` and `.sidebar-overlay` hidden on desktop via CSS

## Edge Functions deployment checklist
Before setting `CONFIG.OTP_ENABLED = true`:
1. Run `supabase functions deploy send-otp-email` 
2. Run `supabase functions deploy verify-otp`
3. Run `supabase functions deploy check-vehicle-maintenance`
4. Add `RESEND_API_KEY` and `ADMIN_EMAIL` secrets in Supabase dashboard → Edge Functions → Secrets

**Why:** OTP is opt-in so the app remains fully functional without email infrastructure deployed.
