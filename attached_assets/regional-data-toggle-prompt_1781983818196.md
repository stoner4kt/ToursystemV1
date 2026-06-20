# Task: Add Regional Data Separation (Cape Town / Joburg) to the INYATHI Fleet PWA

## Context
This is a Supabase + vanilla JS PWA (no build step). Key files:
- `schema.sql` — master schema (run once on fresh installs)
- `supabase/migrations/*.sql` — incremental migrations (numbered, idempotent)
- `config.js` — shared frontend config object `CONFIG`
- `app.js` — shared Supabase client (`sb`), auth (`initAuth`), helpers
- `admin.js` + `index.html` — admin dashboard (Calendar, Fleet, Drivers, etc. tabs)
- `driver-dashboard.js` / `driver-dashboard.html` — driver-facing app (no changes needed here)
- `supabase/functions/driver-invite/index.ts` — edge function that invites a new driver and creates their `profiles` row

Three tables get a `location` column: `public.profiles` (drivers), `public.vehicles`, and `public.bookings`.

The fleet is shared across regions, but each vehicle and driver has a **current home location**. The system must prevent assigning a vehicle or driver to a booking based in a different region than where they're currently located (e.g. a Cape Town–based vehicle cannot be assigned to a Joburg booking), and admins need visibility into a vehicle/driver's location both when assigning them to a booking and when browsing the Fleet/Drivers management pages.

---

## 1. Database changes

Create a new migration file: `supabase/migrations/20260621000000_add_region_location.sql`

Requirements:
- Add `location TEXT NOT NULL DEFAULT 'Cape Town' CHECK (location IN ('Cape Town','Joburg'))` to:
  - `public.profiles` (drivers)
  - `public.vehicles`
  - `public.bookings`
- Use `ADD COLUMN IF NOT EXISTS` for idempotency, matching existing migration style in this repo.
- Add indexes: `idx_profiles_location`, `idx_vehicles_location`, `idx_bookings_location`.
- Add `location TEXT` to `public.driver_invites` as well (no default needed — set explicitly at invite time, see Section 3).
- Backfill existing rows to `'Cape Town'` via the column default on `ADD COLUMN` (no separate `UPDATE` needed).
- `rented_vehicles` (third-party rental vehicles) do NOT need a `location` column for this task — leave them as-is.
- Mirror all three `ALTER TABLE ... ADD COLUMN` blocks into `schema.sql` as well, near each table's original `CREATE TABLE`, or in a clearly marked "REGION SUPPORT" section near the other additive blocks at the bottom — fresh installs must get these columns without needing the migration.
- Confirm `public.handle_new_user()` (auto-creates a `profiles` row on signup) still inserts successfully now that `location` is `NOT NULL DEFAULT 'Cape Town'` — it doesn't need to set `location` itself.

---

## 2. Shared config

In `config.js`, add a single source of truth for valid regions:

```js
LOCATIONS: ['Cape Town', 'Joburg'],
```

Use this constant everywhere a `<select>` of regions is built (toggle, filters, vehicle/driver modals) so there's exactly one place to add a region later.

---

## 3. Driver invite flow — set location at invite time

`supabase/functions/driver-invite/index.ts` currently accepts `{ email, fullName }`.

Changes:
- Accept an additional `location` field. Validate it's `'Cape Town' | 'Joburg'`; reject with 400 if missing/invalid.
- Store `location` on the `driver_invites` upsert row.
- In `driver-signup.html`'s post-signup flow (where it currently does `sb.from('profiles').update({ role:'driver', is_active:true })` after the user sets their password), also read `location` from the matching `driver_invites` row and include it in that same update call, so the new driver's `profiles.location` matches what was selected at invite time (not just the column default).

In `admin.js`:
- `inviteDriver(email, fullName)` → `inviteDriver(email, fullName, location)`, passing `location` through to the edge function body.
- In the `modal-driver` form (`form-driver` submit handler), add a **Location** `<select>` (populated from `CONFIG.LOCATIONS`) to the "Add Driver" view, defaulting to the currently active region toggle (Section 5), but admin-editable before submit. Pass its value into `inviteDriver(...)`.
- In the "Edit Driver" view of the same modal, also show the Location `<select>`, pre-filled from `profiles.location`, editable — this is how an admin relocates a driver between regions. Persist on update.

---

## 4. Fleet & Drivers management pages — location + active/inactive filters

### 4.1 Fleet tab (`tab-fleet`)
In `index.html`, above the fleet table, add filter controls:

```html
<div class="form-row" style="margin-bottom:12px">
  <div class="form-group">
    <label>Location</label>
    <select id="fleet-filter-location" class="form-control">
      <option value="">All Locations</option>
      <option value="Cape Town">Cape Town</option>
      <option value="Joburg">Joburg</option>
    </select>
  </div>
  <div class="form-group">
    <label>Status</label>
    <select id="fleet-filter-status" class="form-control">
      <option value="">All Statuses</option>
      <option value="active">Active</option>
      <option value="maintenance">In Maintenance</option>
      <option value="decommissioned">Decommissioned</option>
    </select>
  </div>
</div>
```

Wire both to call `loadFleet()` on `change`. In `admin.js`, update `loadFleet()` to read these filter values and apply `.eq('location', ...)` / `.eq('status', ...)` to the `vehicles` query when set.

Add a **Location** column to the fleet table (header in `index.html`, cell in `loadFleet()`'s row template) showing a badge, e.g. reuse the existing `.badge` styles.

In `modal-vehicle` (`form-vehicle`), add a Location `<select>` (from `CONFIG.LOCATIONS`) so admins can set/change a vehicle's home location. Include `location` in the `payload` built in the `form-vehicle` submit handler. Default to the active region toggle when adding a new vehicle (`resetVehicleForm()`).

### 4.2 Drivers tab → "Manage Drivers" table
Same pattern as Fleet: above `drivers-manage-tbody`, add `driver-filter-location` and `driver-filter-status` (`All / Active / Inactive`, mapping to `profiles.is_active`) selects, wired to re-run `loadManageDrivers()` on change with `.eq('location', ...)` / `.eq('is_active', ...)` applied as needed.

Add a **Location** column to the Manage Drivers table (header in `index.html`, cell in `loadManageDrivers()`'s row template).

These local Fleet/Drivers filters are independent of the global region toggle described in Section 5 — admins should be able to browse all vehicles/drivers across both regions on these management pages regardless of which region is active in the header toggle (useful for planning cross-region relocations), then narrow with these dropdowns as needed.

---

## 5. Global admin region toggle (scopes Calendar / Bookings / Traffic Fines)

### 5.1 UI
In `index.html`, inside `.header-actions` (next to `.header-search`):

```html
<div class="region-toggle" id="region-toggle" role="group" aria-label="Region">
  <button type="button" class="region-toggle-btn" data-region="Cape Town">Cape Town</button>
  <button type="button" class="region-toggle-btn" data-region="Joburg">Joburg</button>
</div>
```

Add matching styles in `style.css` (small pill buttons, active state using `var(--amber)`/`var(--navy)`, consistent with existing `.badge`/`.btn-sm`).

### 5.2 State
In `admin.js`, near the top-level state (`calDate`, `allBookings`):

```js
const REGION_STORAGE_KEY = 'inyathi-admin-region';
let currentRegion = localStorage.getItem(REGION_STORAGE_KEY) || 'Cape Town';
```

```js
function initRegionToggle() {
  document.querySelectorAll('.region-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.region === currentRegion);
    btn.addEventListener('click', () => setRegion(btn.dataset.region));
  });
}

function setRegion(region) {
  if (region === currentRegion) return;
  currentRegion = region;
  localStorage.setItem(REGION_STORAGE_KEY, region);
  document.querySelectorAll('.region-toggle-btn').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.region === region)
  );
  refreshRegionScopedData();
}

async function refreshRegionScopedData() {
  await loadPendingDeletionsBadge();
  await loadBookingDropdowns();
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'calendar';
  switchTab(activeTab);
}
```

Call `initRegionToggle()` from the existing top-level admin init IIFE, right after `initSidebar()`.

### 5.3 Scope booking queries by `currentRegion`
Add `.eq('location', currentRegion)` to every Supabase query against `bookings` in `admin.js`:
- `renderCalendar()` (month grid query)
- `loadCalendarStats()`
- `loadBookingsArchive()`
- `loadActiveTrips()` / `loadUpcomingTrips()` (Drivers tab)
- `loadPendingDeletionsBadge()` / `loadPendingDeletionsDetail()` — filter on the joined `bookings.location`
- Traffic fines (`loadAdminTrafficFines`, `lookupDriverByFineTimeDashboard`) — filter via joined `bookings.location`

Leave `inspections`, `recon_sheets`, `transfer_recon_sheets`, `incident_reports`, and `vehicle_checklists` unscoped for now — flag in your PR summary if you think any of these should also be region-scoped rather than deciding silently.

---

## 6. Region-aware vehicle & driver assignment on bookings

This is the core safety requirement: **a booking can only be assigned a vehicle or driver currently located in the same region as the booking.**

A new booking's `location` is always `currentRegion` (Section 7). So:

### 6.1 Filter + label the assignment dropdowns
In `loadBookingDropdowns()` (`admin.js`):
- Filter the vehicle `<select id="booking-vehicle">` query: `.eq('status','active').eq('location', currentRegion)`.
- Filter the driver `<select id="booking-driver">` query: `.eq('role','driver').eq('is_active',true).eq('location', currentRegion)`.
- Update each `<option>`'s label to include the location for clarity even though the list is pre-filtered, e.g. `CA 123 456 — Quantum (Cape Town)` and `J. Smith (DRV-AB12C3) — Cape Town`, so admins always see at a glance where a resource is based.

This applies both when creating a new booking and when re-opening `openEditBooking()` for an existing one — the dropdowns should always reflect the booking's own `location`, not necessarily the currently active toggle, when editing. Concretely: in `openEditBooking(id)`, after loading the booking, re-run `loadBookingDropdowns()` scoped to `data.location` (not `currentRegion`) before populating the selected values, so an admin editing a Joburg booking still sees Joburg-based vehicles/drivers even if the header toggle is currently set to Cape Town. Add a small helper, e.g. `loadBookingDropdownsForLocation(location)`, used by both the "new booking" flow (`currentRegion`) and the "edit booking" flow (`booking.location`).

### 6.2 Hard validation backstop
Update `validateVehicleAvailability(vehicleReg, startDate, endDate, excludeBookingId)` and `validateDriverAvailability(driverId, startDate, endDate, excludeBookingId)`:
- Before the existing overlap check, fetch the vehicle's/driver's `location` and compare it against the booking's `location` (the value currently in the form / `currentRegion` for new bookings, or the booking's stored `location` for edits).
- If they don't match, return `{ ok: false, message: 'Vehicle CA 123 456 is based in Joburg and cannot be assigned to a Cape Town booking.' }` (driver equivalent message similarly).
- This acts as a safety net even though the dropdowns are pre-filtered (e.g. if the underlying vehicle/driver location changed after the dropdown was populated, or if rented vehicles are later given a location field and bypass the dropdown filter).

### 6.3 Rented vehicles
`rented_vehicles` has no `location` column per Section 1 — leave the rented-vehicle flow (`booking-is-rented`, `rented-vehicle-fields`) unaffected by this validation, since rented vehicles are sourced ad hoc per booking rather than from the shared fleet.

---

## 7. New bookings automatically inherit the active region

In `admin.js`, in the `form-booking` submit handler's `payload` object, add `location: currentRegion` **only when creating a new booking** (`!id`). When editing (`id` present), never overwrite `location` — preserve the booking's original region. Optionally show the booking's region as a small read-only badge near `#modal-booking-title` when editing, for admin clarity.

---

## 8. Acceptance criteria

1. Migration runs cleanly on a fresh DB and the existing seeded DB without errors.
2. `profiles.location`, `vehicles.location`, and `bookings.location` all default to `'Cape Town'` and reject any value other than `'Cape Town'`/`'Joburg'`.
3. Toggling the header region pill re-renders Calendar, Bookings Archive, Active/Upcoming Trips, Deletion Requests, and Traffic Fines so only rows for the selected region appear, with the selection persisted across reloads.
4. Creating a new booking while "Joburg" is active inserts `location = 'Joburg'`, and the vehicle/driver dropdowns in that booking modal only offer Joburg-based vehicles and drivers, each option labeled with its location.
5. Attempting to force-assign a vehicle or driver from a different region than the booking (e.g. via a stale dropdown state) is blocked with a clear, specific error message — never silently allowed.
6. The Fleet tab and Manage Drivers table each have independent Location + Active/Inactive filters that work regardless of the header region toggle's current value, and both tables display each row's location.
7. Editing an existing booking, vehicle, or driver does not silently change its region; only explicit admin action (the vehicle/driver modal's Location field) relocates them.
8. Inviting a new driver while a given region is active creates their profile with that region, confirmed via the invite → signup → profile-update chain.
9. Rented vehicles are unaffected by any of the above (no location field, no validation against booking location).

Please implement this end-to-end: migration + `schema.sql` mirror + `config.js` + `admin.js` + `index.html`/`style.css` + `driver-invite` edge function + `driver-signup.html`. Flag in your summary any place you had to make a judgment call (especially whether inspections/recon/incidents should also be region-scoped) rather than deciding silently.
