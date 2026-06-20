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

## Cloudinary Upload Architecture (definitive)
- `sign-upload` edge function in `supabase/functions/sign-upload/index.ts` is the ONLY path for getting upload credentials
- Browser calls `sb.functions.invoke('sign-upload', { body: { folder } })` → gets `{ signature, timestamp, api_key, cloud_name, upload_preset, folder, type: 'upload' }`
- `type=upload` is signed AND sent in FormData to force public delivery, overriding any 'authenticated' preset setting on Cloudinary — this means `secure_url` values are directly accessible without signed delivery URLs
- `getDocumentUrl(doc)` in `app.js` handles backward-compat for malformed `{"0":"h","1":"t",...}` records (string spread into object)
- All document viewers (`renderBookingDocumentsList`, `downloadBookingDocuments`, `driver-dashboard.js`) call `getDocumentUrl(d)` — NEVER `d.url` directly
- Migration SQL: `migrations/fix_malformed_booking_documents.sql` — run once in Supabase SQL Editor to repair existing bad records

**Why public delivery:** Supabase auth already controls who can log in; document links are only shown to authenticated users. Authenticated Cloudinary delivery added no real security but required separate signed delivery URL generation (which would expire and break stored links).

## Regional Data Separation (Cape Town / Joburg toggle)
- `location TEXT NOT NULL DEFAULT 'Cape Town' CHECK (location IN ('Cape Town','Joburg'))` added to `profiles`, `vehicles`, `bookings`; `driver_invites` gets `location TEXT` (no default — set at invite time)
- Migration: `supabase/migrations/20260621000000_add_region_location.sql` (idempotent, run in Supabase dashboard)
- `currentRegion` persisted in `localStorage` via key `REGION_STORAGE_KEY = 'inyathi-admin-region'`; `currentBookingLocation` tracks the location of the booking currently open in the modal
- `loadBookingDropdowns(locationOverride?)` filters drivers and vehicles by `loc = locationOverride || currentRegion`; called with `data.location` in `openEditBooking` so the edit form shows only same-region assets
- Fleet table: 8 columns (added Location badge); Drivers manage table: 6 columns (added Location badge); both have location + status filter dropdowns wired to change events
- `loadPendingDeletionsBadge` drops `head:true` count approach — fetches `bookings!inner(location)` with `.eq('bookings.location', currentRegion)` and counts client-side (head:true + join filter incompatible)
- `loadAdminTrafficFines` uses `bookings!inner!traffic_fines_booking_id_fkey(...)` + `.eq('bookings.location', currentRegion)`
- `validateVehicleAvailability` + `validateDriverAvailability` do a location pre-check against `currentBookingLocation` before the overlap query
- `driver-invite` edge function validates `location` field (must be 'Cape Town' or 'Joburg') and stores it in `driver_invites`; `driver-signup.html` reads it back and applies it to the `profiles` row

## Edge Functions deployment checklist
Before setting `CONFIG.OTP_ENABLED = true`:
1. Run `supabase functions deploy send-otp-email` 
2. Run `supabase functions deploy verify-otp`
3. Run `supabase functions deploy check-vehicle-maintenance`
4. Add `RESEND_API_KEY` and `ADMIN_EMAIL` secrets in Supabase dashboard → Edge Functions → Secrets

**Why:** OTP is opt-in so the app remains fully functional without email infrastructure deployed.
