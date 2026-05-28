---
name: INYATHI project overview
description: Architecture, stack, and key constraints for the INYATHI Fleet Management PWA.
---

## Stack
- **Frontend**: Static Vanilla JS / HTML / CSS PWA (no framework, no bundler)
- **Auth + Database**: Supabase (project ref: `jxsesdcwdjrxydkvhpsh`)
- **File uploads**: Cloudinary (cloud name: `dzf97vyjs`, preset: `transroute_uploads`)
- **Hosting**: Vercel (static)
- **Dev preview on Replit**: Python HTTP server on port 5000 (`python3 -m http.server 5000`)

## Key constraints
- DO NOT migrate away from Supabase or Cloudinary — user explicitly confirmed retention
- DO NOT add a Node server — app is intentionally static
- Admin email: `info@inyathi.co.za`
- Supabase Edge Functions live in `supabase/functions/`; they use Deno + Resend API for emails

## Files
- `config.js` — all URLs, keys, and feature flags (OTP_ENABLED, etc.)
- `admin.js` — main admin dashboard logic (~1300+ lines)
- `driver-dashboard.js` — driver portal logic
- `schema.sql` — full Postgres schema; run new ALTER TABLE blocks in Supabase SQL editor
- `style.css` — all styling; desktop layout breakpoint at 1025px
- `pdf-generator.js` — PDF generation with pdf-lib

**Why:** App was designed as a zero-server PWA to minimise infrastructure cost and complexity for a small fleet operator.
