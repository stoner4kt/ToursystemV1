# INYATHI PWA — Dev Prompt for Replit / Codex

## Overview

Apply the following two feature sets to the INYATHI fleet management PWA codebase. Do not break any existing functionality. Make all changes incrementally and test each file before moving to the next.

---

## FEATURE 1 — Transfer Recon Edit Requests (Driver → Admin → OTP approval)

Mirror the existing **Recon Sheet** edit-request workflow (`recon_sheets.edit_request_*` columns + `initiateReconEditApprovalOTP`) for the **Transfer Recon** (`transfer_recon_sheets` table).

### 1A — Database migration

Create a new migration file `supabase/migrations/20260620000000_transfer_recon_edit_requests.sql` with the following:

```sql
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
```

### 1B — `driver-dashboard.html`

1. Add a **"Request Edit"** modal for Transfer Recon, directly below the existing `modal-recon-edit-request` modal:

```html
<!-- Transfer Recon Edit Request Modal -->
<div class="modal-overlay" id="modal-transfer-recon-edit-request">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">Request Transfer Recon Edit</span>
      <button class="modal-close" onclick="closeModal('modal-transfer-recon-edit-request')">✕</button>
    </div>
    <input type="hidden" id="transfer-recon-edit-request-id">
    <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5">
      Submitted transfer recon sheets are locked. Your edit request will be sent to the admin for OTP-verified approval.
    </p>
    <div class="form-group">
      <label>Reason for Edit Request <span class="required">*</span></label>
      <textarea id="transfer-recon-edit-reason" class="form-control" rows="3"
        placeholder="Explain which transfers need to be corrected and why…" required></textarea>
    </div>
    <button class="btn btn-amber btn-full" onclick="submitTransferReconEditRequest()">Submit Request</button>
  </div>
</div>
```

### 1C — `driver-dashboard.js`

**Add** the following functions (place near the bottom of the file, alongside the existing `openReconEditRequest` / `submitReconEditRequest` functions):

```js
// ── TRANSFER RECON EDIT REQUEST (driver side) ─────────────────
function openTransferReconEditRequest(sheetId) {
  const idEl = document.getElementById('transfer-recon-edit-request-id');
  const reasonEl = document.getElementById('transfer-recon-edit-reason');
  if (idEl) idEl.value = sheetId;
  if (reasonEl) reasonEl.value = '';
  openModal('modal-transfer-recon-edit-request');
}

async function submitTransferReconEditRequest() {
  const sheetId = document.getElementById('transfer-recon-edit-request-id')?.value;
  const reason  = document.getElementById('transfer-recon-edit-reason')?.value.trim();
  if (!sheetId) return;
  if (!reason) { toast('Please provide a reason for the edit request', 'error'); return; }

  try {
    const { error } = await sb.from('transfer_recon_sheets').update({
      edit_request_status:  'pending',
      edit_request_reason:  reason,
      edit_request_sent_at: new Date().toISOString(),
    }).eq('id', sheetId).eq('driver_id', currentProfile.driver_id);
    if (error) throw error;
    toast('Edit request submitted — admin will review and approve via OTP', 'success');
    closeModal('modal-transfer-recon-edit-request');
    await loadTransferReconHistory();
  } catch (err) {
    toast('Failed to submit request: ' + err.message, 'error');
  }
}

window.openTransferReconEditRequest   = openTransferReconEditRequest;
window.submitTransferReconEditRequest = submitTransferReconEditRequest;
```

**Update** the `loadTransferReconHistory` function to show the edit-request status badge and the "Request Edit" button, mirroring `loadReconHistory`. Replace the existing `loadTransferReconHistory` function with:

```js
async function loadTransferReconHistory() {
  const container = document.getElementById('tr-history-list');
  if (!container) return;
  const { data, error } = await sb
    .from('transfer_recon_sheets')
    .select('id,week_start,week_end,status,submitted_at,transfers,edit_request_status,edit_request_reason')
    .eq('driver_id', currentProfile.driver_id)
    .order('week_start', { ascending: false })
    .limit(10);
  if (error) { container.innerHTML = `<p style="color:var(--red)">${error.message}</p>`; return; }
  if (!data?.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>No previous submissions.</p></div>`;
    return;
  }
  container.innerHTML = data.map((s) => {
    const canRequest = s.status === 'submitted' &&
      (!s.edit_request_status || s.edit_request_status === 'none' || s.edit_request_status === 'rejected');
    const editRequestBadge = s.edit_request_status === 'pending'
      ? `<span style="color:var(--orange);font-size:.78rem;font-weight:700">⏳ Edit request pending</span>`
      : s.edit_request_status === 'approved'
      ? `<span style="color:var(--green);font-size:.78rem;font-weight:700">✓ Edit approved</span>`
      : s.edit_request_status === 'rejected'
      ? `<span style="color:var(--red);font-size:.78rem" title="Rejected by admin">✗ Request rejected</span>`
      : '';
    return `
    <div class="inspection-item">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">Week: ${formatDate(s.week_start)} — ${formatDate(s.week_end)}</div>
        <div class="inspection-meta">${(s.transfers||[]).length} transfer(s) · Submitted: ${s.submitted_at ? formatDate(s.submitted_at) : '—'}</div>
        ${editRequestBadge ? `<div style="margin-top:4px">${editRequestBadge}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        ${statusBadge(s.status)}
        ${canRequest
          ? `<button class="btn btn-sm btn-outline" style="font-size:.75rem"
               onclick="openTransferReconEditRequest('${s.id}')">Request Edit</button>`
          : ''}
      </div>
    </div>`;
  }).join('');
}
```

### 1D — `admin.js`

**Add** the following functions, alongside the existing `initiateReconEditApprovalOTP` / `rejectReconEditRequest` / `approveReconEditRequest` functions:

```js
// ── TRANSFER RECON EDIT APPROVAL (admin side) ─────────────────

async function approveTransferReconEditRequest(sheetId) {
  try {
    const { error } = await sb.from('transfer_recon_sheets').update({
      edit_request_status:      'approved',
      edit_request_approved_by: currentProfile?.id,
      edit_request_approved_at: new Date().toISOString(),
      status:                   'draft',
    }).eq('id', sheetId);
    if (error) throw error;
    toast('Transfer recon edit request approved — driver can now re-submit', 'success');
    loadTransferReconReview?.();
  } catch (err) {
    toast('Approval failed: ' + err.message, 'error');
  }
}

async function rejectTransferReconEditRequest(sheetId, reason) {
  const rejReason = reason || prompt('Enter a reason for rejecting this edit request (optional):');
  try {
    const { error } = await sb.from('transfer_recon_sheets').update({
      edit_request_status:             'rejected',
      edit_request_rejection_reason:   rejReason || null,
    }).eq('id', sheetId);
    if (error) throw error;
    toast('Transfer recon edit request rejected', 'info');
    loadTransferReconReview?.();
  } catch (err) {
    toast('Rejection failed: ' + err.message, 'error');
  }
}

async function initiateTransferReconEditApprovalOTP(sheetId) {
  if (!CONFIG.OTP_ENABLED) {
    if (confirm('Approve this transfer recon edit request without OTP (OTP is disabled)?')) {
      await approveTransferReconEditRequest(sheetId);
    }
    return;
  }
  try {
    toast('Sending OTP to admin email…', 'info');
    const res = await fetch(CONFIG.SEND_OTP_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        resource_type:  'transfer_recon_edit',
        resource_id:    sheetId,
        admin_id:       currentProfile?.id,
        context_label:  'Transfer Recon Edit Approval',
      }),
    });
    const result = await res.json();
    if (!res.ok) { toast(result.error || 'Failed to send OTP', 'error'); return; }
    const descEl = document.getElementById('otp-modal-desc');
    if (descEl) descEl.textContent =
      `OTP sent to ${CONFIG.ADMIN_EMAIL}. Verify to approve the driver's transfer recon edit request.`;
    const codeEl = document.getElementById('otp-input');
    if (codeEl) codeEl.value = '';
    const noticeEl = document.getElementById('otp-attempts-notice');
    if (noticeEl) noticeEl.style.display = 'none';
    currentOTPContext = { resourceId: sheetId, resourceType: 'transfer_recon_edit' };
    openModal('modal-otp-verify');
  } catch (err) {
    toast('OTP request failed: ' + err.message, 'error');
  }
}

window.initiateTransferReconEditApprovalOTP = initiateTransferReconEditApprovalOTP;
window.rejectTransferReconEditRequest       = rejectTransferReconEditRequest;
```

**Update** the `submitOTPVerification` function's dispatch block to handle `transfer_recon_edit`. Inside the `else if` chain after the existing `recon_edit` branch, add:

```js
} else if (currentOTPContext?.resourceType === 'transfer_recon_edit') {
  await approveTransferReconEditRequest(currentOTPContext.resourceId);
  currentOTPContext = null;
}
```

**Update** `loadTransferReconReview` to show pending edit badges and Approve/Reject buttons. In the `.map((s) => ...)` template inside `loadTransferReconReview`, find the section that renders each `inspection-item` and replace it with the following (keep all existing filter/query logic unchanged, only update the HTML template):

```js
  container.innerHTML = data.map((s) => {
    const hasPendingEdit = s.edit_request_status === 'pending';
    const editBadge = hasPendingEdit
      ? `<span style="color:var(--orange);font-weight:700;font-size:.78rem">⚠ Edit Request Pending</span>`
      : s.edit_request_status === 'approved'
      ? `<span style="color:var(--green);font-size:.78rem">Edit Approved</span>`
      : s.edit_request_status === 'rejected'
      ? `<span style="color:var(--red);font-size:.78rem">Edit Rejected</span>`
      : '';
    return `
    <div class="inspection-item" onclick="openTransferReconDetail('${s.id}')">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">${s.profiles?.name || s.driver_id} · Week ${formatDate(s.week_start)} — ${formatDate(s.week_end)}</div>
        <div class="inspection-meta">${(s.transfers || []).length} transfer(s) · ${s.submitted_at ? 'Submitted ' + formatDate(s.submitted_at) : 'Draft'}</div>
        <div style="margin-top:3px">${statusBadge(s.status)}${editBadge ? '&nbsp;&nbsp;' + editBadge : ''}</div>
        ${hasPendingEdit ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:3px">Reason: ${s.edit_request_reason || '—'}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        ${statusBadge(s.status)}
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openTransferReconDetail('${s.id}')">View</button>
        ${hasPendingEdit
          ? `<button class="btn btn-sm btn-amber" onclick="event.stopPropagation();initiateTransferReconEditApprovalOTP('${s.id}')" title="Approve edit request via OTP">Approve Edit</button>
             <button class="btn btn-sm btn-danger" style="font-size:.73rem" onclick="event.stopPropagation();rejectTransferReconEditRequest('${s.id}')">Reject</button>`
          : ''}
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadTransferReconPDF('${s.id}')">PDF</button>
      </div>
    </div>`;
  }).join('');
```

Also update the `select` query inside `loadTransferReconReview` to include the new edit columns:

```js
  let query = sb
    .from('transfer_recon_sheets')
    .select('*, profiles!transfer_recon_sheets_driver_id_fkey(name, driver_id), edit_request_status, edit_request_reason')
    .order('week_start', { ascending: false });
```

---

## FEATURE 2 — Responsive Layout Optimisation (Mobile, Tablet, Laptop)

Apply the following CSS and structural changes. The goal is a clean, touch-friendly experience at every breakpoint without breaking the existing dark-navy/amber design.

### 2A — `style.css` additions

Append the following block to the **very end** of `style.css`:

```css
/* ============================================================
   RESPONSIVE LAYOUT OVERHAUL — mobile-first polish pass
   ============================================================ */

/* ── GLOBAL TOUCH TARGETS ─────────────────────────────────── */
.btn, .form-control, select.form-control, .chk-btn,
.sidebar-nav-link, .tab-btn, .modal-close, .sidebar-close {
  min-height: 44px;
}

/* ── HEADER ────────────────────────────────────────────────── */
.app-header {
  padding: 0 12px;
  gap: 8px;
}
.app-header .logo { font-size: 1rem; gap: 6px; }
.header-user { max-width: 90px; font-size: .78rem; }

/* ── CONTEXT BAR ────────────────────────────────────────────── */
.context-bar { padding: 8px 12px; }
.breadcrumbs { font-size: .78rem; flex-wrap: wrap; }

/* ── SIDEBAR ────────────────────────────────────────────────── */
#app-sidebar { width: min(var(--sidebar-w), 85vw); }
.sidebar-nav-link { font-size: .9rem; padding: 12px 16px; }
.sidebar-nav-icon { font-size: 1rem; }

/* ── TAB NAV hidden on desktop (sidebar handles nav) ─────────
   Shown only on mobile as a bottom or top strip.             */
@media (max-width: 1024px) {
  .tab-nav {
    display: flex !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    padding: 0 4px;
    gap: 2px;
  }
  .tab-nav::-webkit-scrollbar { display: none; }
  .tab-btn {
    flex: 0 0 auto;
    scroll-snap-align: start;
    padding: 10px 12px;
    font-size: .74rem;
    white-space: nowrap;
    border-radius: 6px 6px 0 0;
    min-height: 40px;
  }
}

/* ── MAIN & CARDS ───────────────────────────────────────────── */
.main { padding: 12px; }
.card { padding: 14px; margin-bottom: 12px; border-radius: 12px; }
.card-header { flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.card-title { font-size: .97rem; }

/* ── FORMS ──────────────────────────────────────────────────── */
.form-row { grid-template-columns: 1fr; gap: 12px; }
.form-group { margin-bottom: 14px; }
.form-control { font-size: .93rem; padding: 11px 12px; border-radius: 10px; }

/* ── STATS ROW ──────────────────────────────────────────────── */
.stats-row {
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.stat-card { padding: 12px; border-radius: 10px; }
.stat-value { font-size: 1.3rem; }

/* ── TABLES ─────────────────────────────────────────────────── */
.table-wrapper { border-radius: 10px; }
.table-wrapper table { min-width: 480px; font-size: .82rem; }
thead th { padding: 10px 10px; font-size: .73rem; }
tbody td { padding: 10px 10px; }

/* ── MODAL ──────────────────────────────────────────────────── */
.modal {
  padding: 18px 14px;
  border-radius: 18px 18px 0 0;
  max-height: 94dvh;
}
.modal-header { margin-bottom: 14px; }
.modal-title { font-size: 1rem; }

/* ── CALENDAR ───────────────────────────────────────────────── */
.cal-day { min-height: 44px; font-size: .8rem; }
.cal-day-name { font-size: .67rem; }
.day-number { font-size: .8rem; }

/* ── INSPECTION LIST ────────────────────────────────────────── */
.inspection-item { padding: 12px 0; gap: 8px; }
.inspection-title { font-size: .87rem; }
.inspection-meta { font-size: .76rem; }

/* ── BOOKING ITEMS ──────────────────────────────────────────── */
.booking-route { font-size: .86rem; }
.booking-meta  { font-size: .76rem; }

/* ── TASK CARDS ─────────────────────────────────────────────── */
.task-card { padding: 12px 14px; }
.task-title { font-size: .92rem; }

/* ── CHECKLIST ──────────────────────────────────────────────── */
.checklist-item { padding: 10px 0; }
.checklist-label { font-size: .87rem; }
.chk-btn { padding: 8px 10px; font-size: .76rem; min-width: 44px; }

/* ── DOC PREVIEW ────────────────────────────────────────────── */
.doc-preview-list { gap: 6px; }
.doc-preview-item { padding: 7px 9px; font-size: .8rem; gap: 8px; }

/* ── TRANSFER RECON TABLE ───────────────────────────────────── */
#tr-table { font-size: .78rem; }
#tr-table th, #tr-table td { padding: 6px 5px; }
#tr-table input.form-control,
#tr-table select.form-control { min-height: 38px; font-size: .78rem; padding: 6px 8px; }

/* ── TOAST ──────────────────────────────────────────────────── */
#toast-container { bottom: 16px; max-width: calc(100% - 24px); }
.toast { font-size: .85rem; padding: 11px 14px; }

/* ── EMPTY STATE ────────────────────────────────────────────── */
.empty-state { padding: 32px 16px; border-radius: 10px; }
.empty-state .empty-icon { font-size: 2.8rem; }

/* ─────────────────────────────────────────────────────────────
   TABLET (481px – 768px)
───────────────────────────────────────────────────────────── */
@media (min-width: 481px) {
  .main { padding: 16px; }
  .form-row { grid-template-columns: 1fr 1fr; }
  .stats-row { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .modal { padding: 22px 20px; }
  .card { padding: 16px; }
}

/* ─────────────────────────────────────────────────────────────
   SMALL LAPTOP (769px – 1024px)
───────────────────────────────────────────────────────────── */
@media (min-width: 769px) {
  .main { padding: 20px; max-width: 900px; }
  .stats-row { grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .card { padding: 18px; }
  .modal-overlay { align-items: center; }
  .modal {
    max-width: 560px;
    border-radius: 16px;
    padding: 26px 24px;
    transform: scale(.97);
    max-height: 90dvh;
  }
  .modal-overlay.open .modal { transform: scale(1); }
  .table-wrapper table { font-size: .85rem; }
}

/* ─────────────────────────────────────────────────────────────
   DESKTOP (≥1025px)
───────────────────────────────────────────────────────────── */
@media (min-width: 1025px) {
  /* Sidebar always visible, header spans full width */
  body {
    display: grid;
    grid-template-columns: var(--sidebar-w) 1fr;
    grid-template-rows: var(--header-h) auto 1fr;
    min-height: 100dvh;
  }
  .app-header {
    grid-column: 1 / -1;
    grid-row: 1;
    padding-left: 16px;
  }
  #app-sidebar {
    grid-column: 1;
    grid-row: 2 / -1;
    transform: translateX(0) !important;
    position: sticky;
    top: 0;
    height: 100dvh;
    overflow-y: auto;
    box-shadow: 2px 0 10px rgba(0,0,0,.12);
  }
  .sidebar-overlay,
  .sidebar-close,
  #sidebar-toggle { display: none !important; }

  .context-bar {
    grid-column: 2;
    grid-row: 2;
    top: var(--header-h);
    position: sticky;
    z-index: 90;
  }
  .main {
    grid-column: 2;
    grid-row: 3;
    max-width: 1100px;
    padding: 24px 32px;
  }
  .tab-nav { display: none !important; }

  .card { padding: 20px; }
  .modal { max-width: 640px; }
  .stats-row { grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .form-row { gap: 16px; }
  .table-wrapper table { font-size: .87rem; }
  .header-user { max-width: 160px; font-size: .85rem; }

  /* Show search bar on desktop */
  .header-search { display: block; min-width: 200px; }
}

/* ─────────────────────────────────────────────────────────────
   WIDE DESKTOP (≥1280px)
───────────────────────────────────────────────────────────── */
@media (min-width: 1280px) {
  .main { max-width: 1280px; padding: 28px 40px; }
  .stats-row { grid-template-columns: repeat(5, 1fr); }
}

/* ── BOOKING MODAL — wider on large screens ─────────────────── */
@media (min-width: 769px) {
  #modal-booking .modal,
  #modal-admin-inspection .modal,
  #modal-transfer-recon-detail .modal { max-width: 700px; }
}
@media (min-width: 1025px) {
  #modal-booking .modal { max-width: 760px; }
  #modal-transfer-recon-detail .modal { max-width: 860px; }
}

/* ── FIX: tables must stay visible on all screen sizes ──────── */
.table-wrapper table { display: table !important; }

/* ── TRANSFER RECON — horizontal scroll on small screens ────── */
@media (max-width: 768px) {
  #tr-table-wrapper,
  div:has(> #tr-table) { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  #tr-table { min-width: 640px; }
}

/* ── RENTED VEHICLE FIELDS — better mobile spacing ─────────── */
#rented-vehicle-fields .form-row { grid-template-columns: 1fr; }
@media (min-width: 481px) {
  #rented-vehicle-fields .form-row { grid-template-columns: 1fr 1fr; }
}

/* ── DRIVER DASHBOARD — task card actions wrap nicely ───────── */
.task-card .btn + .btn { margin-top: 6px; }
@media (min-width: 481px) {
  .task-card .btn + .btn { margin-top: 0; margin-left: 6px; }
}

/* ── INSPECTION PROGRESS STEPS ─────────────────────────────── */
.inspection-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.inspection-progress span {
  flex: 1;
  min-width: 80px;
  text-align: center;
  font-size: .72rem;
  padding: 7px 8px;
  border-radius: 999px;
}

/* ── FIX: booking modal form rows on small screens ──────────── */
@media (max-width: 480px) {
  #form-booking .form-row,
  #form-admin-inspection .form-row { grid-template-columns: 1fr; }
}

/* ── ADMIN CHECKLIST — two-column on wider screens ─────────── */
@media (min-width: 600px) {
  #admin-checklist-container { column-count: 2; column-gap: 20px; }
  #admin-checklist-container .checklist-section { break-inside: avoid; }
}

/* ── MEDIA PREVIEW GRIDS ────────────────────────────────────── */
.media-preview { grid-template-columns: repeat(3, 1fr); gap: 6px; }
@media (min-width: 481px) { .media-preview { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 769px) { .media-preview { grid-template-columns: repeat(5, 1fr); } }

/* ── SAFE AREA PADDING for notched phones ───────────────────── */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .main { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
  #toast-container { bottom: calc(16px + env(safe-area-inset-bottom)); }
}
```

### 2B — `index.html` structural fix

In `index.html`, wrap the Transfer Recon table inside a scroll container. Find the `<div style="overflow-x:auto;margin-bottom:16px">` inside `modal-transfer-recon-detail` and ensure its parent `<div id="transfer-recon-detail-body">` has `overflow: hidden` so the scrollable child works on all browsers. No HTML change needed if already present.

In the admin Transfer Recon tab panel (`<div class="tab-panel" id="tab-transfer-recon">`), ensure the filter row uses the existing `.form-row` class with responsive columns — no change needed if already using `class="form-row"`.

### 2C — `driver-dashboard.html` structural fix

In the Transfer Recon tab (`<div class="tab-panel" id="tab-transfer-recon">`), wrap the `<table id="tr-table">` in an explicit scroll container:

```html
<div id="tr-table-wrapper" style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:4px">
  <table id="tr-table" ...>
    ...
  </table>
</div>
```

Remove the inline `overflow-x:auto` from the existing `<div style="overflow-x:auto">` parent if present and replace it with `id="tr-table-wrapper"` to avoid duplicate wrappers.

---

## Testing checklist

After all changes are applied, verify:

- [ ] Driver can click "Request Edit" on a submitted transfer recon sheet in the history list
- [ ] The modal opens with a reason textarea
- [ ] Submitting sets `edit_request_status = 'pending'` on the `transfer_recon_sheets` row
- [ ] The Transfer Recon admin tab shows the ⚠ badge and Approve/Reject buttons for pending requests
- [ ] Clicking "Approve Edit" triggers OTP flow (or direct approval if `OTP_ENABLED = false`)
- [ ] OTP verification dispatches to `approveTransferReconEditRequest` and resets sheet status to `draft`
- [ ] Driver can now edit and re-submit the sheet
- [ ] Rejection stores the rejection reason and shows the badge on the driver's history
- [ ] On a 375px mobile screen, all modals are scrollable with no horizontal overflow
- [ ] On a 768px tablet, two-column form rows display correctly
- [ ] On a 1024px laptop, the sidebar is visible and the main content area is not cropped
- [ ] Calendar booking bars render correctly at all breakpoints
- [ ] Tables are always visible and horizontally scrollable on mobile (not hidden)
- [ ] No existing features (Recon edit, Booking delete OTP, etc.) are broken

---

## Notes for Codex / Replit Agent

- Do **not** introduce new npm packages.
- Do **not** change the Supabase URL, anon key, or any value in `config.js`.
- The OTP functions (`send-otp-email`, `verify-otp`) already support arbitrary `resource_type` strings; you only need to add `transfer_recon_edit` to the DB constraint and the client-side dispatch.
- Apply the SQL migration by creating the file in `supabase/migrations/` — do not manually run SQL.
- Keep all CSS additions at the **end** of `style.css` so they override earlier rules correctly.
- Preserve all `window.xxx = xxx` exports for functions called from inline `onclick` attributes in HTML.
