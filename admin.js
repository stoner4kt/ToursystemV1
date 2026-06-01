// ============================================================
//  INYATHI PWA — ADMIN DASHBOARD LOGIC
// ============================================================

// ── AUTH & INIT ───────────────────────────────────────────────
(async () => {
  const session = await initAuth('admin');
  if (!session) return;

  const name = currentProfile?.name || currentUser?.email?.split('@')[0] || 'Admin';
  const nameEl = document.getElementById('admin-name');
  if (nameEl) nameEl.textContent = name;
  const sidebarName = document.getElementById('sidebar-admin-name');
  if (sidebarName) sidebarName.textContent = name;

  initSidebar();

  document.getElementById('btn-signout-sidebar')?.addEventListener('click', signOut);

  renderCalendar();
  await loadBookingDropdowns();
})();

// ── TAB NAVIGATION ───────────────────────────────────────────
function switchTab(target) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

  document.querySelector(`.tab-btn[data-tab="${target}"]`)?.classList.add('active');
  document.getElementById(`tab-${target}`)?.classList.add('active');

  document.querySelectorAll('#app-sidebar .sidebar-nav-link').forEach((l) => l.classList.remove('active'));
  document.querySelector(`#app-sidebar .sidebar-nav-link[data-tab="${target}"]`)?.classList.add('active');

  if (target === 'calendar') renderCalendar();
  if (target === 'fleet')    loadFleet();
  if (target === 'drivers')  loadDriversTab();
  if (target === 'recon')    loadReconReview();
  if (target === 'incidents') loadIncidentReports();
  if (target === 'wages') loadWagesReconciliation();
  if (target === 'checklists') loadVehicleChecklists();
  if (target === 'transfer-recon') loadTransferReconReview();
  if (target === 'reports')  loadReports();
  if (target === 'traffic-fines') initTrafficFinesDashboard();
  if (target === 'bookings-archive')  loadBookingsArchive();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── CALENDAR ──────────────────────────────────────────────────
let calDate       = new Date();
let allBookings   = [];
let driverOptions = [];
let currentBookingDocuments = [];
const ALLOWED_DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

async function loadBookingDropdowns() {
  const { data: drivers } = await sb.from('profiles')
    .select('driver_id,name').eq('role','driver').eq('is_active',true).order('name');
  driverOptions = drivers || [];

  const dsel = document.getElementById('booking-driver');
  if (dsel) {
    dsel.innerHTML = '<option value="">— Unassigned —</option>';
    driverOptions.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.driver_id; opt.textContent = `${d.name} (${d.driver_id})`;
      dsel.appendChild(opt);
    });
  }

  const { data: vehicles } = await sb.from('vehicles').select('registration_no,model').eq('status','active').order('registration_no');
  const vsel = document.getElementById('booking-vehicle');
  if (vsel) {
    vsel.innerHTML = '<option value="">— Unassigned —</option>';
    (vehicles || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.registration_no; opt.textContent = `${v.registration_no} — ${v.model}`;
      vsel.appendChild(opt);
    });
  }
}

async function renderCalendar() {
  const year  = calDate.getFullYear();
  const month = calDate.getMonth();
  document.getElementById('cal-month-label').textContent =
    calDate.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

  const from = new Date(year, month, 1).toISOString().split('T')[0];
  const to   = new Date(year, month + 1, 0).toISOString().split('T')[0];
  const { data } = await sb.from('bookings').select('*').lte('start_date', to).gte('end_date', from).order('start_date');
  allBookings = data || [];

  const grid     = document.getElementById('cal-grid');
  const firstDay = new Date(year, month, 1).getDay();
  const lastDay  = new Date(year, month + 1, 0).getDate();
  const today    = new Date();
  const bookingDates = new Set(allBookings.map((b) => b.start_date));
  grid.innerHTML = '';

  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-day-name'; el.textContent = d;
    grid.appendChild(el);
  });
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div'); el.className = 'cal-day other-month'; grid.appendChild(el);
  }
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div'); el.className = 'cal-day'; el.textContent = d;
    if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) el.classList.add('today');
    if (bookingDates.has(dateStr)) el.classList.add('has-booking');
    el.addEventListener('click', () => showBookingsForDate(dateStr, el));
    grid.appendChild(el);
  }
  loadCalendarStats();
}

function showBookingsForDate(dateStr, cell) {
  document.querySelectorAll('.cal-day.selected').forEach((el) => el.classList.remove('selected'));
  cell.classList.add('selected');
  const dayBookings = allBookings.filter((b) => b.start_date === dateStr);
  const container   = document.getElementById('day-bookings');
  if (!dayBookings.length) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">No bookings on ${formatDate(dateStr)}.</p>`;
    return;
  }
  container.innerHTML = dayBookings.map((b) => `
    <div class="booking-item ${b.receipt_number ? 'booking-paid' : 'booking-unpaid'}">
      <div class="booking-dot" style="background:${b.receipt_number ? 'var(--green)' : b.status==='cancelled' ? 'var(--red)' : 'var(--orange)'}"></div>
      <div class="booking-info">
        <div class="booking-route">${b.client_name} — ${b.tour_reference || b.route || 'Tour Ref TBC'}</div>
        <div class="booking-meta">${b.invoice_no} · ${b.assigned_driver_id || 'Unassigned'} · ${b.assigned_vehicle_reg || 'No vehicle'}${b.receipt_number ? ' · <span style="color:var(--green);font-weight:700">RCP: ' + b.receipt_number + '</span>' : ' · <span style="color:var(--orange);font-weight:600">Unpaid</span>'}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${statusBadge(b.status)}
        <button class="btn btn-sm btn-outline" onclick="openEditBooking('${b.id}')">Edit</button>
      </div>
    </div>`).join('');
}

async function loadCalendarStats() {
  const { data } = await sb.from('bookings').select('status');
  const all = data || [];
  document.getElementById('stat-total').textContent     = all.length;
  document.getElementById('stat-confirmed').textContent = all.filter(b=>b.status==='confirmed').length;
  document.getElementById('stat-pending').textContent   = all.filter(b=>b.status==='pending').length;
  document.getElementById('stat-invoiced').textContent  = all.filter(b=>b.status==='invoiced').length;
}

document.getElementById('cal-prev')?.addEventListener('click', () => { calDate.setMonth(calDate.getMonth()-1); renderCalendar(); });
document.getElementById('cal-next')?.addEventListener('click', () => { calDate.setMonth(calDate.getMonth()+1); renderCalendar(); });

// ── ADD / EDIT BOOKING ────────────────────────────────────────
document.getElementById('btn-add-booking')?.addEventListener('click', () => {
  resetBookingForm();
  document.getElementById('modal-booking-title').textContent = 'New Booking';
  openModal('modal-booking');
});


function getBookingNotesInput() {
  return document.getElementById('booking-notes');
}

function resetBookingForm() {
  document.getElementById('booking-id').value          = '';
  document.getElementById('booking-invoice').value     = `INV-${Date.now().toString().slice(-6)}`;
  document.getElementById('booking-client').value      = '';
  document.getElementById('booking-tour-reference').value       = '';
  document.getElementById('booking-start-date').value  = '';
  document.getElementById('booking-end-date').value    = '';
  document.getElementById('booking-driver').value      = '';
  document.getElementById('booking-vehicle').value     = '';
  document.getElementById('booking-status').value      = 'invoiced';
  document.getElementById('booking-payment-status').value = 'unpaid';
  const receiptEl = document.getElementById('booking-receipt-number');
  if (receiptEl) receiptEl.value = '';
  const notesInput = getBookingNotesInput();
  if (notesInput) notesInput.value = '';
  currentBookingDocuments = [];
  const docInput = document.getElementById('booking-documents-input');
  if (docInput) docInput.value = '';
  const itinInput = document.getElementById('booking-itinerary-input');
  if (itinInput) itinInput.value = '';
  renderBookingDocumentsList();
  renderItineraryPreview(null);
}
function renderBookingDocumentsList() {
  const holder = document.getElementById('booking-documents-list');
  if (!holder) return;
  if (!currentBookingDocuments.length) {
    holder.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem">No documents attached.</div>`;
    return;
  }
  const isAdmin = currentProfile?.role === 'admin';
  const items = currentBookingDocuments.map((d, i) => {
    const name = d.filename || 'Document';
    const isPdf  = /\.pdf$/i.test(name);
    const isImg  = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
    const isWord = /\.(doc|docx)$/i.test(name);
    const icon   = isPdf ? '📄' : isWord ? '📝' : isImg ? '' : '📎';
    const preview = isImg
      ? `<img src="${d.url}" loading="lazy" alt="${name}" style="max-height:60px;border-radius:4px;object-fit:cover;flex-shrink:0">`
      : `<span class="doc-preview-icon">${icon}</span>`;
    return `<div class="doc-preview-item">
      ${preview}
      <div class="doc-preview-meta">
        <a href="${d.url || '#'}" target="_blank" rel="noopener" class="doc-preview-name">${name}</a>
        <span>${d.size ? Math.round(d.size / 1024) + ' KB' : '—'} · ${d.uploaded_at ? formatDateTime(d.uploaded_at) : '—'}</span>
      </div>
      ${isAdmin ? `<button type="button" class="btn btn-sm btn-danger" onclick="removeBookingDocument(${i})" title="Remove document" style="flex-shrink:0">🗑</button>` : ''}
    </div>`;
  }).join('');

  if (currentBookingDocuments.length >= 5) {
    holder.innerHTML = `<details style="margin-top:4px"><summary style="cursor:pointer;font-weight:600;font-size:.82rem;padding:4px 0;color:var(--navy-mid)">📎 ${currentBookingDocuments.length} documents (click to expand)</summary><div class="doc-preview-list">${items}</div></details>`;
  } else {
    holder.innerHTML = `<div class="doc-preview-list">${items}</div>`;
  }
}

function renderItineraryPreview(itinerary) {
  const el = document.getElementById('booking-itinerary-preview');
  if (!el) return;
  if (!itinerary?.url) { el.innerHTML = ''; return; }
  const isPdf = /\.pdf$/i.test(itinerary.filename || '');
  el.innerHTML = `<div class="doc-preview-item">
    <span class="doc-preview-icon">${isPdf ? '📄' : '📎'}</span>
    <div class="doc-preview-meta">
      <a href="${itinerary.url}" target="_blank" rel="noopener" class="doc-preview-name">${itinerary.filename || 'Itinerary'}</a>
      <span>Current itinerary · Click to open</span>
    </div>
  </div>`;
}
function removeBookingDocument(i) {
  if (currentProfile?.role !== 'admin') return toast('Only admins can remove documents', 'error');
  currentBookingDocuments.splice(i, 1);
  renderBookingDocumentsList();
}
window.removeBookingDocument = removeBookingDocument;

async function openEditBooking(id) {
  const { data } = await sb.from('bookings').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('booking-id').value         = data.id;
  document.getElementById('booking-invoice').value    = data.invoice_no;
  document.getElementById('booking-client').value     = data.client_name;
  document.getElementById('booking-tour-reference').value      = data.tour_reference || data.route || '';
  document.getElementById('booking-payment-status').value = data.payment_status || 'unpaid';
  const receiptEl = document.getElementById('booking-receipt-number');
  if (receiptEl) receiptEl.value = data.receipt_number || '';
  toggleBookingLockState(data);
  document.getElementById('booking-start-date').value = data.start_date;
  document.getElementById('booking-end-date').value   = data.end_date;
  document.getElementById('booking-driver').value     = data.assigned_driver_id || '';
  document.getElementById('booking-vehicle').value    = data.assigned_vehicle_reg || '';
  document.getElementById('booking-status').value     = data.status;
  const notesInput = getBookingNotesInput();
  if (notesInput) notesInput.value = data.notes || '';
  currentBookingDocuments = Array.isArray(data.booking_documents) ? data.booking_documents : [];
  renderBookingDocumentsList();
  renderItineraryPreview(data.itinerary_url ? { url: data.itinerary_url, filename: data.itinerary_filename } : null);
  document.getElementById('modal-booking-title').textContent = 'Edit Booking';
  openModal('modal-booking');
}

document.getElementById('form-booking')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('booking-id').value;
  const vehicle = document.getElementById('booking-vehicle').value;
  const start = document.getElementById('booking-start-date').value;
  const end = document.getElementById('booking-end-date').value;
  const availability = await validateVehicleAvailability(vehicle, start, end, id || null);
  if (!availability.ok) {
    toast(availability.message, 'error');
    return;
  }

  const payload = {
    invoice_no:           document.getElementById('booking-invoice').value.trim(),
    client_name:          document.getElementById('booking-client').value.trim(),
    tour_reference:       document.getElementById('booking-tour-reference').value.trim(),
    payment_status:       document.getElementById('booking-payment-status').value,
    receipt_number:       document.getElementById('booking-receipt-number')?.value.trim() || null,
    start_date:           document.getElementById('booking-start-date').value,
    end_date:             document.getElementById('booking-end-date').value,
    assigned_driver_id:   document.getElementById('booking-driver').value  || null,
    assigned_vehicle_reg: document.getElementById('booking-vehicle').value || null,
    status:               document.getElementById('booking-status').value,
    notes:                (getBookingNotesInput()?.value || '').trim(),
  };
  const files = Array.from(document.getElementById('booking-documents-input')?.files || []);
  if (files.length > 5) return toast('Maximum 5 files per booking', 'error');
  for (const f of files) {
    if (!ALLOWED_DOC_TYPES.includes(f.type)) return toast(`Unsupported file type: ${f.name}`, 'error');
    if (f.size > 10 * 1024 * 1024) return toast(`File too large (max 10MB): ${f.name}`, 'error');
  }
  if (files.length) {
    if (currentProfile?.role !== 'admin') return toast('Only admins can upload documents', 'error');
    toast('Uploading documents…', 'info');
    try {
      for (const f of files) {
        const url = await uploadToCloudinary(f, 'booking-documents');
        currentBookingDocuments.push({ url, filename: f.name, size: f.size, uploaded_at: new Date().toISOString(), uploaded_by: currentProfile?.id || null });
      }
      toast('Documents saved', 'success');
    } catch (err) {
      toast(`Document upload failed: ${err.message}`, 'error');
      return;
    }
  }
  payload.booking_documents = currentBookingDocuments;

  const itineraryFile = document.getElementById('booking-itinerary-input')?.files?.[0];
  if (itineraryFile) {
    if (currentProfile?.role !== 'admin') return toast('Only admins can upload itineraries', 'error');
    try {
      toast('Uploading itinerary…', 'info');
      const itinUrl = await uploadToCloudinary(itineraryFile, 'booking-itinerary');
      payload.itinerary_url         = itinUrl;
      payload.itinerary_filename    = itineraryFile.name;
      payload.itinerary_uploaded_at = new Date().toISOString();
    } catch (err) {
      toast(`Itinerary upload failed: ${err.message}`, 'error');
      return;
    }
  }

  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true; submitBtn.textContent = 'Saving…';

  if (id && CONFIG.OTP_ENABLED) {
    pendingBookingSave = { id, payload };
    submitBtn.disabled = false; submitBtn.textContent = 'Save Booking';
    await initiateBookingEditOTP(id, 'booking_edit');
    return;
  }

  await performBookingSave(id, payload, submitBtn);
});
document.getElementById('archive-status-filter')?.addEventListener('change', loadBookingsArchive);
document.getElementById('archive-from-date')?.addEventListener('change', loadBookingsArchive);
document.getElementById('archive-to-date')?.addEventListener('change', loadBookingsArchive);
async function loadBookingsArchive() {
  const tbody = document.getElementById('bookings-archive-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9"><div class="spinner"></div></td></tr>`;
  const { data, error } = await sb.from('bookings').select('*').order('start_date', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="9">${error.message}</td></tr>`; return; }
  const status = document.getElementById('archive-status-filter')?.value || 'all';
  const from = document.getElementById('archive-from-date')?.value || '';
  const to = document.getElementById('archive-to-date')?.value || '';
  let rows = data || [];
  if (status !== 'all') rows = rows.filter(b => b.status === status);
  if (from) rows = rows.filter(b => b.start_date >= from);
  if (to) rows = rows.filter(b => b.end_date <= to);
  tbody.innerHTML = rows.map((b) => {
    const docs = Array.isArray(b.booking_documents) ? b.booking_documents : [];
    const receiptHtml = b.receipt_number
      ? `<span style="color:var(--green);font-weight:700;font-size:.78rem">✓ ${b.receipt_number}</span>`
      : `<span style="color:var(--orange);font-size:.78rem">Unpaid</span>`;
    const alertBtn = !b.maintenance_alert_sent && b.status !== 'cancelled'
      ? `<button class="btn btn-sm" style="background:var(--orange);color:#fff;margin-top:4px" title="Send vehicle return/maintenance alert email" onclick="sendMaintenanceAlertForBooking('${b.id}')">🔔 Alert</button>`
      : b.maintenance_alert_sent ? `<span style="font-size:.73rem;color:var(--green)">✓ Alerted</span>` : '';
    return `<tr>
      <td>${b.invoice_no}<br>${receiptHtml}</td>
      <td>${b.client_name}</td>
      <td style="font-size:.8rem">${b.assigned_driver_id || '—'}</td>
      <td>${b.assigned_vehicle_reg || '—'}</td>
      <td>${formatDate(b.start_date)}</td>
      <td>${formatDate(b.end_date)}<br>${alertBtn}</td>
      <td>${statusBadge(b.status)}</td>
      <td>${docs.length ? `<span class="badge badge-blue">${docs.length} docs</span>` : '—'}${b.itinerary_url ? '<br><a href="'+b.itinerary_url+'" target="_blank" style="font-size:.73rem">📋 Itinerary</a>' : ''}</td>
      <td><button class="btn btn-sm btn-outline" onclick="openEditBooking('${b.id}')">View Details</button>${docs.length ? ` <button class="btn btn-sm btn-amber" onclick="downloadBookingDocuments('${b.id}')">Docs</button>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9">No bookings found.</td></tr>`;
}
async function downloadBookingDocuments(bookingId) {
  const { data } = await sb.from('bookings').select('booking_documents').eq('id', bookingId).single();
  const docs = Array.isArray(data?.booking_documents) ? data.booking_documents : [];
  docs.forEach((d) => window.open(d.url, '_blank', 'noopener'));
}
window.downloadBookingDocuments = downloadBookingDocuments;

async function deleteBooking() {
  toast('Bookings cannot be deleted (audit trail requirement).', 'warning');
}

// ── BOOKING OTP & SAVE LOGIC (Feature 6) ─────────────────────
let pendingBookingSave = null;
let currentOTPContext  = null;

async function performBookingSave(id, payload, submitBtn) {
  try {
    const writePayload = id ? { ...payload, last_modified_at: new Date().toISOString() } : payload;
    const { data: bookingData, error } = id
      ? await sb.from('bookings').update(writePayload).eq('id', id).select().single()
      : await sb.from('bookings').insert(writePayload).select().single();

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Booking'; }
    if (error) {
      toast('Error: ' + error.message + (error.message.includes('infinite recursion') ? ' — Check RLS policies.' : ''), 'error');
      return;
    }
    if (id) {
      await sb.from('booking_edit_log').insert({
        booking_id: id, admin_id: currentProfile?.id,
        action: 'edit', new_values: payload, approved_at: new Date().toISOString(),
      }).then(() => {});
    }
    toast(id ? 'Booking updated' : 'Booking added', 'success');
    await postToWorkerWebhook(CONFIG.WORKER_BOOKINGS_WEBHOOK_URL, bookingData || payload);
    closeModal('modal-booking');
    renderCalendar();
  } catch (err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Booking'; }
    toast('Save failed: ' + err.message, 'error');
  }
}

async function initiateBookingEditOTP(resourceId, resourceType) {
  try {
    toast('Sending OTP to admin email…', 'info');
    const res = await fetch(CONFIG.SEND_OTP_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        resource_type:  resourceType,
        resource_id:    resourceId,
        admin_id:       currentProfile?.id,
        context_label:  resourceType === 'booking_edit' ? 'Booking Edit' : 'Booking Delete',
      }),
    });
    const result = await res.json();
    if (!res.ok) { toast(result.error || 'Failed to send OTP', 'error'); return; }
    const descEl = document.getElementById('otp-modal-desc');
    if (descEl) descEl.textContent = `An OTP has been sent to ${CONFIG.ADMIN_EMAIL}. Enter it below to confirm this change.`;
    const codeEl = document.getElementById('otp-input');
    if (codeEl) codeEl.value = '';
    const noticeEl = document.getElementById('otp-attempts-notice');
    if (noticeEl) noticeEl.style.display = 'none';
    currentOTPContext = { resourceId, resourceType };
    openModal('modal-otp-verify');
  } catch (err) {
    toast('OTP request failed: ' + err.message, 'error');
  }
}

async function submitOTPVerification() {
  const code = document.getElementById('otp-input')?.value.trim();
  if (!code || code.length !== 6) { toast('Enter the 6-digit OTP code', 'error'); return; }
  if (!currentOTPContext) { toast('No pending action — please try again', 'error'); return; }
  const btn = document.getElementById('btn-verify-otp');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
  try {
    const res = await fetch(CONFIG.VERIFY_OTP_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ resource_type: currentOTPContext.resourceType, resource_id: currentOTPContext.resourceId, otp_code: code }),
    });
    const result = await res.json();
    if (!result.verified) {
      const noticeEl = document.getElementById('otp-attempts-notice');
      if (noticeEl) { noticeEl.textContent = result.error || 'Incorrect OTP.'; noticeEl.style.display = 'block'; }
      toast(result.error || 'Incorrect OTP', 'error');
      return;
    }
    closeModal('modal-otp-verify');
    toast('OTP verified — saving…', 'success');
    if (pendingBookingSave) {
      const { id, payload } = pendingBookingSave;
      pendingBookingSave = null;
      currentOTPContext  = null;
      await performBookingSave(id, payload, null);
    } else if (currentOTPContext?.resourceType === 'recon_edit') {
      await approveReconEditRequest(currentOTPContext.resourceId);
      currentOTPContext = null;
    }
  } catch (err) {
    toast('Verification error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Verify & Proceed'; }
  }
}

function cancelOTPVerification() {
  pendingBookingSave = null;
  currentOTPContext  = null;
  closeModal('modal-otp-verify');
  toast('Action cancelled', 'info');
}

window.submitOTPVerification = submitOTPVerification;
window.cancelOTPVerification = cancelOTPVerification;

// ── MAINTENANCE ALERT (Feature 4) ─────────────────────────────
async function sendMaintenanceAlertForBooking(bookingId) {
  if (!confirm('Send a vehicle return/maintenance alert email for this booking?')) return;
  try {
    toast('Sending maintenance alert…', 'info');
    const res = await fetch(CONFIG.MAINTENANCE_ALERT_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ booking_id: bookingId }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) { toast(result.error || 'Alert failed', 'error'); return; }
    toast('Maintenance alert sent successfully', 'success');
    loadBookingsArchive();
  } catch (err) {
    toast('Alert error: ' + err.message, 'error');
  }
}
window.sendMaintenanceAlertForBooking = sendMaintenanceAlertForBooking;

// ── RECON EDIT APPROVAL (Feature 3) ───────────────────────────
async function approveReconEditRequest(reconId) {
  try {
    const { error } = await sb.from('recon_sheets').update({
      edit_request_status:      'approved',
      edit_request_approved_by: currentProfile?.id,
      edit_request_approved_at: new Date().toISOString(),
      status:                   'draft',
    }).eq('id', reconId);
    if (error) throw error;
    toast('Recon edit request approved — driver can now re-submit', 'success');
    loadReconReview?.();
  } catch (err) {
    toast('Approval failed: ' + err.message, 'error');
  }
}

async function rejectReconEditRequest(reconId, reason) {
  const rejReason = reason || prompt('Enter a reason for rejecting this edit request (optional):');
  try {
    let { error } = await sb.from('recon_sheets').update({
      edit_request_status:          'rejected',
      edit_request_rejection_reason: rejReason || null,
    }).eq('id', reconId);

    if (error && error.message?.includes('edit_request_rejection_reason')) {
      ({ error } = await sb.from('recon_sheets').update({
        edit_request_status: 'rejected',
      }).eq('id', reconId));
    }

    if (error) throw error;
    toast('Edit request rejected', 'info');
    loadReconReview?.();
  } catch (err) {
    toast('Rejection failed: ' + err.message, 'error');
  }
}

async function initiateReconEditApprovalOTP(reconId) {
  if (!CONFIG.OTP_ENABLED) {
    if (confirm('Approve this recon edit request without OTP (OTP is disabled)?')) {
      await approveReconEditRequest(reconId);
    }
    return;
  }
  try {
    toast('Sending OTP to admin email…', 'info');
    const res = await fetch(CONFIG.SEND_OTP_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ resource_type: 'recon_edit', resource_id: reconId, admin_id: currentProfile?.id, context_label: 'Recon Edit Approval' }),
    });
    const result = await res.json();
    if (!res.ok) { toast(result.error || 'Failed to send OTP', 'error'); return; }
    const descEl = document.getElementById('otp-modal-desc');
    if (descEl) descEl.textContent = `OTP sent to ${CONFIG.ADMIN_EMAIL}. Verify to approve the driver's recon edit request.`;
    const codeEl = document.getElementById('otp-input');
    if (codeEl) codeEl.value = '';
    const noticeEl = document.getElementById('otp-attempts-notice');
    if (noticeEl) noticeEl.style.display = 'none';
    currentOTPContext = { resourceId: reconId, resourceType: 'recon_edit' };
    openModal('modal-otp-verify');
  } catch (err) {
    toast('OTP request failed: ' + err.message, 'error');
  }
}

window.initiateReconEditApprovalOTP = initiateReconEditApprovalOTP;
window.rejectReconEditRequest       = rejectReconEditRequest;

// ── FLEET MANAGEMENT ─────────────────────────────────────────
async function loadFleet() {
  const tbody = document.getElementById('fleet-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7"><div class="spinner"></div></td></tr>`;
  const { data, error } = await sb.from('vehicles').select('*').order('registration_no');
  if (error) { tbody.innerHTML = `<tr><td colspan="7">Error loading fleet: ${error.message}</td></tr>`; return; }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🚌</div><p>No vehicles added yet.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((v) => {
    const pct = v.next_service_km ? Math.min(100, Math.round((v.current_mileage / v.next_service_km) * 100)) : 0;
    const barClass = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : '';
    const kmLeft = v.next_service_km ? v.next_service_km - v.current_mileage : null;
    return `<tr>
      <td><strong>${v.registration_no}</strong></td>
      <td>${v.make || ''} ${v.model}</td>
      <td>${v.year || '—'}</td>
      <td>${formatMileage(v.current_mileage)}</td>
      <td>
        <div class="progress-bar" title="${formatMileage(v.current_mileage)} / ${formatMileage(v.next_service_km)}">
          <div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div>
        </div>
        <div style="font-size:.73rem;color:var(--text-muted);margin-top:3px">
          ${kmLeft !== null ? (kmLeft > 0 ? formatMileage(kmLeft) + ' left' : '<span style="color:var(--red)">Overdue</span>') : '—'}
        </div>
      </td>
      <td>${statusBadge(v.status)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-outline" onclick="openEditVehicle('${v.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteVehicle('${v.id}','${v.registration_no}')">Del</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('btn-add-vehicle')?.addEventListener('click', () => {
  resetVehicleForm();
  document.getElementById('modal-vehicle-title').textContent = 'Add Vehicle';
  openModal('modal-vehicle');
});

function resetVehicleForm() {
  ['vehicle-id','vehicle-reg','vehicle-model','vehicle-make','vehicle-year','vehicle-mileage','vehicle-service-km','vehicle-notes']
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('vehicle-status').value = 'active';
}

async function openEditVehicle(id) {
  const { data } = await sb.from('vehicles').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('vehicle-id').value          = data.id;
  document.getElementById('vehicle-reg').value         = data.registration_no;
  document.getElementById('vehicle-model').value       = data.model;
  document.getElementById('vehicle-make').value        = data.make || '';
  document.getElementById('vehicle-year').value        = data.year || '';
  document.getElementById('vehicle-mileage').value     = data.current_mileage;
  document.getElementById('vehicle-service-km').value  = data.next_service_km || '';
  document.getElementById('vehicle-status').value      = data.status;
  document.getElementById('vehicle-notes').value       = data.notes || '';
  document.getElementById('modal-vehicle-title').textContent = 'Edit Vehicle';
  openModal('modal-vehicle');
}

document.getElementById('form-vehicle')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('vehicle-id').value;
  const payload = {
    registration_no: document.getElementById('vehicle-reg').value.trim().toUpperCase(),
    model:           document.getElementById('vehicle-model').value.trim(),
    make:            document.getElementById('vehicle-make').value.trim() || null,
    year:            parseInt(document.getElementById('vehicle-year').value) || null,
    current_mileage: parseInt(document.getElementById('vehicle-mileage').value) || 0,
    next_service_km: parseInt(document.getElementById('vehicle-service-km').value) || null,
    status:          document.getElementById('vehicle-status').value,
    notes:           document.getElementById('vehicle-notes').value.trim() || null,
  };
  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
  const { error } = id
    ? await sb.from('vehicles').update(payload).eq('id', id)
    : await sb.from('vehicles').insert(payload);
  submitBtn.disabled = false; submitBtn.textContent = 'Save Vehicle';
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(id ? 'Vehicle updated' : 'Vehicle added', 'success');
  closeModal('modal-vehicle');
  loadFleet();
});

async function deleteVehicle(id, reg) {
  if (!confirm(`Delete vehicle ${reg}? This cannot be undone.`)) return;
  const { error } = await sb.from('vehicles').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
  toast(`${reg} removed`, 'success');
  loadFleet();
}

// ── DRIVERS TAB ───────────────────────────────────────────────
async function loadDriversTab() {
  await Promise.all([loadActiveTrips(), loadUpcomingTrips(), loadManageDrivers()]);
}

async function loadActiveTrips() {
  const tbody = document.getElementById('drivers-active-trips');
  if (!tbody) return;
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb.from('bookings')
    .select('*').lte('start_date', today).gte('end_date', today).neq('status','cancelled').order('start_date');
  if (error) { tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`; return; }
  if (!data?.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🛣️</div><p>No active trips today.</p></div></td></tr>`; return; }
  tbody.innerHTML = data.map((b) => `
    <tr>
      <td>${b.invoice_no}</td>
      <td>${b.client_name}</td>
      <td>${b.assigned_driver_id || '—'}</td>
      <td>${b.assigned_vehicle_reg || '—'}</td>
      <td>${formatDate(b.start_date)} → ${formatDate(b.end_date)}</td>
    </tr>`).join('');
}

async function loadUpcomingTrips() {
  const tbody = document.getElementById('drivers-upcoming-trips');
  if (!tbody) return;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const fromDate = tomorrow.toISOString().split('T')[0];
  const { data, error } = await sb.from('bookings')
    .select('*').gte('start_date', fromDate).neq('status','cancelled').order('start_date').limit(20);
  if (error) { tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`; return; }
  if (!data?.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📅</div><p>No upcoming trips.</p></div></td></tr>`; return; }
  tbody.innerHTML = data.map((b) => `
    <tr>
      <td>${b.invoice_no}</td>
      <td>${b.client_name}</td>
      <td>${b.assigned_driver_id || '—'}</td>
      <td>${b.assigned_vehicle_reg || '—'}</td>
      <td>${formatDate(b.start_date)}</td>
    </tr>`).join('');
}

async function loadManageDrivers() {
  const tbody = document.getElementById('drivers-manage-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner"></div></td></tr>`;
  const { data: drivers, error } = await sb.from('profiles')
    .select('id,driver_id,name,phone,is_active').eq('role','driver').order('name');
  if (error) { tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`; return; }
  if (!drivers?.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👥</div><p>No drivers found.</p></div></td></tr>`; return; }
  tbody.innerHTML = drivers.map((d) => `
    <tr>
      <td><strong>${d.name}</strong></td>
      <td>${d.driver_id || '—'}</td>
      <td>${d.phone || '—'}</td>
      <td>${statusBadge(d.is_active ? 'active' : 'decommissioned')}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openEditDriver('${d.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDriver('${d.id}','${d.name}')">Del</button>
      </td>
    </tr>`).join('');
}

async function deleteDriver(id, name) {
  if (!confirm(`Delete driver ${name}? This cannot be undone.`)) return;
  const { error } = await sb.from('profiles').delete().eq('id', id).eq('role', 'driver');
  if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
  toast('Driver deleted', 'success');
  await loadManageDrivers();
  await loadBookingDropdowns();
}

document.getElementById('btn-add-driver')?.addEventListener('click', () => {
  resetDriverForm();
  document.getElementById('modal-driver-title').textContent = 'Add Driver';
  document.getElementById('driver-email-group').style.display = '';
  document.getElementById('driver-code-group').style.display  = 'none';
  document.getElementById('driver-active-group').style.display = 'none';
  openModal('modal-driver');
});

function resetDriverForm() {
  ['driver-id','driver-name-input','driver-email-input','driver-phone-input','driver-code-input']
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
}

async function openEditDriver(id) {
  const { data } = await sb.from('profiles').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('driver-id').value           = data.id;
  document.getElementById('driver-name-input').value   = data.name || '';
  document.getElementById('driver-email-input').value  = data.email || '';
  document.getElementById('driver-code-input').value   = data.driver_id || '';
  document.getElementById('driver-phone-input').value  = data.phone || '';
  document.getElementById('driver-active-input').value = String(data.is_active !== false);
  document.getElementById('driver-email-group').style.display  = 'none';
  document.getElementById('driver-code-group').style.display   = '';
  document.getElementById('driver-active-group').style.display = '';
  document.getElementById('modal-driver-title').textContent = 'Edit Driver';
  openModal('modal-driver');
}

document.getElementById('form-driver')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('driver-id').value;
  const name = document.getElementById('driver-name-input').value.trim();
  const phone = document.getElementById('driver-phone-input').value.trim() || null;
  const submitBtn = e.target.querySelector('[type="submit"]');

  submitBtn.disabled = true; submitBtn.textContent = id ? 'Saving…' : 'Sending invite…';

  let error = null;
  if (id) {
    ({ error } = await sb.from('profiles').update({
      name,
      phone,
      is_active: document.getElementById('driver-active-input').value === 'true',
    }).eq('id', id));
  } else {
    const email = document.getElementById('driver-email-input').value.trim().toLowerCase();
    ({ error } = await inviteDriver(email, name));
  }

  submitBtn.disabled = false; submitBtn.textContent = 'Save Driver';
  if (error) { toast('Error: ' + (error.message || 'Unable to save driver'), 'error'); return; }
  toast(id ? 'Driver updated' : 'Driver invite sent', 'success');
  closeModal('modal-driver');
  loadManageDrivers();
});

async function inviteDriver(email, fullName) {
  const { data, error } = await sb.functions.invoke('driver-invite', {
    body: { email, fullName },
  });

  if (error) return { error: new Error(await getFunctionErrorMessage(error)) };
  if (data?.error) return { error: new Error(data.error) };
  return { data };
}

async function getFunctionErrorMessage(error) {
  const fallback = error?.message || 'Unable to send driver invite';
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') return fallback;

  try {
    const body = await response.clone().json();
    return body?.error || body?.message || fallback;
  } catch {
    try { return (await response.clone().text()) || fallback; }
    catch { return fallback; }
  }
}

// ── REPORTS ───────────────────────────────────────────────────
async function loadReports() {
  const container = document.getElementById('reports-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';
  const { data, error } = await sb.from('inspections')
    .select('*, profiles(name), vehicles(model)')
    .order('created_at', { ascending: false }).limit(50);
  if (error) { container.innerHTML = `<p style="color:var(--red)">Error: ${error.message}</p>`; return; }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No inspections recorded yet.</p></div>`;
    return;
  }
  container.innerHTML = data.map((insp) => {
    const faults = insp.faults_json || [];
    const media  = insp.media_urls  || [];
    return `
      <div class="inspection-item" onclick="openReportDetail('${insp.id}')">
        <div style="flex:1;min-width:0">
          <div class="inspection-title">${insp.vehicle_reg} — ${insp.inspection_type}</div>
          <div class="inspection-meta">Driver: ${insp.profiles?.name || insp.driver_id} · ${formatDateTime(insp.created_at)} · ${media.length} photo(s)</div>
          ${faults.length > 0
            ? `<div class="inspection-fault-count">⚠ ${faults.length} fault(s)</div>`
            : '<div style="color:var(--green);font-size:.78rem;margin-top:3px">✓ No faults</div>'}
        </div>
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadPDF('${insp.id}')">PDF</button>
      </div>`;
  }).join('');
}

// ── RECON REVIEW ──────────────────────────────────────────────
async function loadReconReview() {
  const container = document.getElementById('recon-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';
  const { data, error } = await sb.from('recon_sheets')
    .select('*, profiles!recon_sheets_driver_id_fkey(name, driver_id)')
    .order('week_start', { ascending: false });
  if (error) { container.innerHTML = `<p style="color:var(--red)">Error: ${error.message}</p>`; return; }
  if (!data?.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>No recon sheets submitted yet.</p></div>`;
    return;
  }
  container.innerHTML = data.map((sheet) => {
    const hasPendingEdit = sheet.edit_request_status === 'pending';
    const editBadge = hasPendingEdit
      ? `<span style="color:var(--orange);font-weight:700;font-size:.78rem">⚠ Edit Request Pending</span>`
      : sheet.edit_request_status === 'approved' ? `<span style="color:var(--green);font-size:.78rem">Edit Approved</span>`
      : sheet.edit_request_status === 'rejected' ? `<span style="color:var(--red);font-size:.78rem">Edit Rejected</span>` : '';
    return `
    <div class="inspection-item" onclick="openReconDetail('${sheet.id}')">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">${sheet.profiles?.name || sheet.driver_id} · ${sheet.week_start} → ${sheet.week_end}</div>
        <div class="inspection-meta">Ref: ${sheet.tour_reference || '—'} · Vehicle: ${sheet.vehicle_reg || '—'} · Distance: ${sheet.total_distance_km ?? 0} km</div>
        <div style="margin-top:3px">${statusBadge(sheet.status || 'submitted')}${editBadge ? '&nbsp;&nbsp;' + editBadge : ''}</div>
        ${hasPendingEdit ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:3px">Reason: ${sheet.edit_request_reason || '—'}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;flex-direction:column;align-items:flex-end">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openReconDetail('${sheet.id}')">View</button>
        ${hasPendingEdit ? `<button class="btn btn-sm btn-amber" onclick="event.stopPropagation();initiateReconEditApprovalOTP('${sheet.id}')" title="Approve edit request via OTP">Approve Edit</button><button class="btn btn-sm btn-danger" style="font-size:.73rem" onclick="event.stopPropagation();rejectReconEditRequest('${sheet.id}')">Reject</button>` : ''}
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadReconPDF('${sheet.id}')">PDF</button>
      </div>
    </div>`;
  }).join('');
}

async function openReconDetail(id) {
  const { data: sheet, error } = await sb.from('recon_sheets')
    .select('*, profiles!recon_sheets_driver_id_fkey(name, driver_id)').eq('id', id).single();
  if (error || !sheet) { toast(error?.message || 'Recon sheet not found', 'error'); return; }
  document.getElementById('recon-detail-id').value = id;
  document.getElementById('recon-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><strong>Driver</strong><p>${sheet.profiles?.name || 'Unknown'}</p></div>
      <div><strong>Week</strong><p>${formatDate(sheet.week_start)} → ${formatDate(sheet.week_end)}</p></div>
      <div><strong>Tour Reference</strong><p>${sheet.tour_reference || '—'}</p></div>
      <div><strong>Vehicle Reg</strong><p>${sheet.vehicle_reg || '—'}</p></div>
      <div><strong>Distance</strong><p>${sheet.total_distance_km ?? 0} km</p></div>
      <div><strong>Status</strong><p>${statusBadge(sheet.status || 'submitted')}</p></div>
    </div>
    <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">
    <p><strong>Trip Budget:</strong> ${sheet.trip_budget || '—'}</p>
    <p><strong>Trip Cost:</strong> ${sheet.trip_cost || '—'}</p>
    <p><strong>Driver Food:</strong> ${sheet.driver_food || '—'}</p>
    <p><strong>Flights To:</strong> ${sheet.flights_to || '—'}</p>
    <p><strong>Flights From:</strong> ${sheet.flights_from || '—'}</p>
    <p><strong>Driver Rate:</strong> ${sheet.driver_rate || '—'}</p>
    <p><strong>Accommodation:</strong> ${sheet.accommodation || '—'}</p>
    <p><strong>Total Profit/Loss:</strong> ${sheet.total_profit_loss || '—'}</p>
    ${sheet.cost_lines_text ? `<div style="margin-top:12px"><strong>Slip Lines:</strong><pre style="font-size:.8rem;background:var(--bg);padding:10px;border-radius:8px;overflow-x:auto;white-space:pre-wrap">${sheet.cost_lines_text}</pre></div>` : ''}
    <div style="margin-top:16px"><button class="btn btn-amber btn-full" onclick="downloadReconPDF('${sheet.id}')">⬇ Download PDF</button></div>
  `;
  openModal('modal-recon-detail');
}

async function downloadReconPDF(id) {
  const { data: sheet, error } = await sb.from('recon_sheets')
    .select('*, profiles!recon_sheets_driver_id_fkey(name, driver_id)').eq('id', id).single();
  if (error || !sheet) { toast(error?.message || 'Not found', 'error'); return; }
  toast('Generating PDF…', 'info', 4000);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 14;
  doc.setFillColor(15, 39, 68); doc.rect(0, 0, W, 24, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.text('INYATHI Recon Sheet', 14, 12);
  doc.setFontSize(9); doc.text(CONFIG.COMPANY_NAME, 14, 18);
  y = 32; doc.setTextColor(20, 20, 20); doc.setFontSize(10);
  const lines = [
    ['Driver', `${sheet.profiles?.name || 'Unknown'} (${sheet.profiles?.driver_id || sheet.driver_id})`],
    ['Week', `${sheet.week_start} to ${sheet.week_end}`],
    ['Tour Reference', sheet.tour_reference || '—'],
    ['Vehicle Reg', sheet.vehicle_reg || '—'],
    ['Total Distance (km)', String(sheet.total_distance_km ?? 0)],
    ['Trip Budget', sheet.trip_budget || '—'],
    ['Trip Cost', sheet.trip_cost || '—'],
    ['Driver Food', sheet.driver_food || '—'],
    ['Driver Rate', sheet.driver_rate || '—'],
    ['Accommodation', sheet.accommodation || '—'],
    ['Total Profit/Loss', sheet.total_profit_loss || '—'],
    ['Director Sign Off', sheet.director_sign_off || '—'],
  ];
  lines.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, 14, y);
    doc.setFont('helvetica', 'normal');
    const wrapped = doc.splitTextToSize(String(value), 130);
    doc.text(wrapped, 70, y);
    y += Math.max(6, wrapped.length * 5);
  });
  doc.save(`INYATHI_Recon_${sheet.profiles?.driver_id || sheet.driver_id}_${sheet.week_start}.pdf`);
  toast('Recon PDF downloaded', 'success');
}

async function openReportDetail(id) {
  const { data: insp } = await sb.from('inspections')
    .select('*, profiles(name, driver_id), vehicles(model, make)').eq('id', id).single();
  if (!insp) return;
  const faults = insp.faults_json || [];
  const media  = insp.media_urls  || [];
  const checklistEntries = Object.entries(insp.checklist_json || {});
  document.getElementById('report-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><strong>Vehicle</strong><p>${insp.vehicle_reg} — ${insp.vehicles?.make||''} ${insp.vehicles?.model||''}</p></div>
      <div><strong>Driver</strong><p>${insp.profiles?.name || insp.driver_id}</p></div>
      <div><strong>Type</strong><p>${statusBadge(insp.inspection_type)}</p></div>
      <div><strong>Date</strong><p>${formatDateTime(insp.created_at)}</p></div>
      <div><strong>Mileage</strong><p>${formatMileage(insp.mileage_at_inspection)}</p></div>
      <div><strong>Invoice</strong><p>${insp.invoice_no || '—'}</p></div>
    </div>
    ${faults.length > 0
      ? `<div class="fault-alert"><div class="fault-icon">⚠</div><div class="fault-text"><strong>${faults.length} Critical Fault(s):</strong><br>${faults.join(' · ')}</div></div>`
      : '<p style="color:var(--green);font-weight:600;margin-bottom:12px">✓ No critical faults</p>'}
    <div style="margin-bottom:14px">
      <strong>Checklist (${checklistEntries.filter(([,v])=>v==='ok').length}/${checklistEntries.length} OK)</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px">
        ${checklistEntries.map(([item, result]) => `
          <div style="font-size:.8rem;display:flex;gap:5px;align-items:center">
            <span style="color:${result==='ok'?'var(--green)':'var(--red)'}">${result==='ok'?'✓':'✕'}</span>${item}
          </div>`).join('')}
      </div>
    </div>
    ${media.length > 0 ? `
      <div><strong>Photos / Videos</strong>
        <div class="media-preview" style="margin-top:8px">
          ${media.map((url) => url.match(/\.(mp4|webm|mov)$/i)
            ? `<div class="media-preview-item"><video src="${url}" controls></video></div>`
            : `<div class="media-preview-item"><a href="${url}" target="_blank"><img src="${url}" alt="media"></a></div>`
          ).join('')}
        </div>
      </div>` : ''}
    ${insp.notes ? `<div style="margin-top:12px"><strong>Notes</strong><p style="font-size:.88rem;color:var(--text-muted)">${insp.notes}</p></div>` : ''}
    <div style="margin-top:18px"><button class="btn btn-amber btn-full" onclick="downloadPDF('${insp.id}')">⬇ Download PDF Report</button></div>
  `;
  document.getElementById('report-detail-id').value = id;
  openModal('modal-report-detail');
}

// ── PDF GENERATION ────────────────────────────────────────────
async function downloadPDF(inspectionId) {
  const { data: insp } = await sb.from('inspections')
    .select('*, profiles(name, driver_id), vehicles(model, make, registration_no)').eq('id', inspectionId).single();
  if (!insp) { toast('Inspection not found', 'error'); return; }
  toast('Generating PDF…', 'info', 5000);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W   = doc.internal.pageSize.getWidth();
  let y     = 15;

  doc.setFillColor(15, 39, 68); doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.text('INYATHI', 14, 13);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text(CONFIG.COMPANY_NAME, 14, 20);
  doc.setFontSize(9); doc.text('VEHICLE INSPECTION REPORT', W-14, 13, { align: 'right' });
  doc.text(formatDateTime(insp.created_at), W-14, 20, { align: 'right' });
  y = 36;

  doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Inspection Details', 14, y); y += 7;
  const details = [
    ['Vehicle', `${insp.vehicle_reg}  ${insp.vehicles?.make||''} ${insp.vehicles?.model||''}`],
    ['Driver',  insp.profiles?.name || insp.driver_id],
    ['Type',    insp.inspection_type],
    ['Mileage', formatMileage(insp.mileage_at_inspection)],
    ['Invoice', insp.invoice_no || '—'],
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  details.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');   doc.text(label + ':', 14, y);
    doc.setFont('helvetica', 'normal'); doc.text(value || '—', 50, y);
    y += 6;
  });
  y += 4;

  const faults = insp.faults_json || [];
  if (faults.length > 0) {
    doc.setFillColor(254, 226, 226); doc.rect(14, y-4, W-28, 7+faults.length*6, 'F');
    doc.setTextColor(185, 28, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`⚠ Critical Faults (${faults.length})`, 16, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    faults.forEach((f) => { doc.text('• ' + f, 18, y); y += 6; });
    y += 4;
  } else {
    doc.setFillColor(209, 250, 229); doc.rect(14, y-4, W-28, 10, 'F');
    doc.setTextColor(6, 95, 70); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('✓ No Critical Faults Reported', 16, y); y += 12;
  }

  doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Inspection Checklist', 14, y); y += 6;
  const entries = Object.entries(insp.checklist_json || {});
  doc.setFontSize(8.5);
  const colW = (W-28)/2;
  entries.forEach(([item, result], i) => {
    const col = i % 2; const row = Math.floor(i / 2);
    if (col === 0 && row > 0) y += 5.5;
    const x = 14 + col * colW;
    doc.setTextColor(result === 'ok' ? 6 : 185, result === 'ok' ? 95 : 28, result === 'ok' ? 70 : 28);
    doc.text((result === 'ok' ? '✓' : '✕') + ' ' + item, x, y);
  });
  if (entries.length % 2 !== 0) y += 5.5;
  y += 8;

  if (insp.notes) {
    doc.setTextColor(30,41,59); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('Notes', 14, y); y += 6;
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(insp.notes, W-28);
    doc.text(wrapped, 14, y);
  }
  doc.save(`INYATHI_Inspection_${insp.vehicle_reg}_${insp.created_at?.split('T')[0]}.pdf`);
  toast('PDF downloaded', 'success');
}


async function validateVehicleAvailability(vehicleReg,startDate,endDate,excludeBookingId=null){
  if(!vehicleReg||!startDate||!endDate) return {ok:true};
  let q=sb.from('bookings').select('id,invoice_no,start_date,end_date,status').eq('assigned_vehicle_reg',vehicleReg).neq('status','cancelled').lte('start_date',endDate).gte('end_date',startDate);
  if(excludeBookingId) q=q.neq('id',excludeBookingId);
  const {data,error}=await q; if(error) return {ok:false,message:error.message};
  if((data||[]).length) return {ok:false,message:`Vehicle already booked (${data[0].invoice_no}) for overlapping dates.`};
  return {ok:true};
}
async function validateBookingCompletion(bookingId){
 const {data,error}=await sb.from('bookings').select('payment_status,pre_trip_inspection_id,post_trip_inspection_id').eq('id',bookingId).single();
 if(error) return {ok:false,message:error.message};
 if(data.payment_status!=='paid') return {ok:false,message:'Payment status must be paid.'};
 if(!data.pre_trip_inspection_id) return {ok:false,message:'Pre-trip inspection required.'};
 if(!data.post_trip_inspection_id) return {ok:false,message:'Post-trip inspection required.'};
 return {ok:true};
}
function toggleBookingLockState(data){const locked=!!data?.is_locked;document.querySelectorAll('#form-booking input,#form-booking select,#form-booking textarea, #form-booking button[type="submit"]').forEach(el=>{if(el.id!=='btn-mark-complete')el.disabled=locked});document.getElementById('booking-lock-notice').style.display=locked?'block':'none';document.getElementById('btn-mark-complete').style.display=locked?'none':'inline-block';}
async function completeBooking(bookingId){ if(currentProfile?.role!=='admin') return toast('Only admins can complete bookings','error'); const v=await validateBookingCompletion(bookingId); if(!v.ok) return toast(v.message,'warning'); const {error}=await sb.from('bookings').update({status:'completed',is_locked:true,completed_by:currentProfile.id,completed_at:new Date().toISOString()}).eq('id',bookingId); if(error) return toast(error.message,'error'); toast('Booking completed and locked','success'); closeModal('modal-booking'); await renderCalendar(); }
document.getElementById('btn-mark-complete')?.addEventListener('click',()=>{const id=document.getElementById('booking-id').value;if(id)completeBooking(id);});
async function loadIncidentReports(){const {data,error}=await sb.from('incident_reports').select('*').order('created_at',{ascending:false}).limit(100);document.getElementById('incident-list').innerHTML=error?error.message:(data||[]).map(i=>`<div class="inspection-item"><div class="inspection-title">${i.incident_type}</div><div class="inspection-meta">${i.driver_id} · ${i.vehicle_reg} · ${i.status}</div></div>`).join('')||'No incidents';}
async function loadWagesReconciliation() {
  const { data, error } = await sb.from('recon_sheets').select('*').order('created_at', { ascending: false }).limit(100);
  document.getElementById('wages-list').innerHTML = error ? error.message : (data || []).map((r) => `
    <div class="inspection-item">
      <div class="inspection-title">${r.driver_id} · ${r.tour_reference || '—'}</div>
      <div class="inspection-meta">${r.week_start} → ${r.week_end} · Rate: ${r.driver_rate || '—'}</div>
    </div>`).join('') || 'No wages records';
  await loadWagesTransferRecon();
}

async function loadWagesTransferRecon() {
  const container = document.getElementById('wages-transfer-recon-list');
  if (!container) return;
  const { data, error } = await sb
    .from('transfer_recon_sheets')
    .select('*, profiles!transfer_recon_sheets_driver_id_fkey(name, driver_id)')
    .in('status', ['submitted', 'reviewed'])
    .order('week_start', { ascending: false })
    .limit(50);
  if (error) { container.innerHTML = `<p style="color:var(--red)">${error.message}</p>`; return; }
  if (!data?.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>No transfer recon sheets submitted yet.</p></div>`; return; }
  container.innerHTML = data.map((s) => `
    <div class="inspection-item" onclick="openTransferReconDetail('${s.id}')">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">${s.profiles?.name || s.driver_id} · ${formatDate(s.week_start)} — ${formatDate(s.week_end)}</div>
        <div class="inspection-meta">${(s.transfers || []).length} transfer(s) · Submitted: ${s.submitted_at ? formatDate(s.submitted_at) : '—'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${statusBadge(s.status)}
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadTransferReconPDF('${s.id}')">PDF</button>
      </div>
    </div>`).join('');
}

async function loadVehicleChecklists(){const {data,error}=await sb.from('vehicle_checklists').select('*').order('checklist_date',{ascending:false}).limit(100);document.getElementById('checklist-list').innerHTML=error?error.message:(data||[]).map(c=>`<div class="inspection-item"><div class="inspection-title">${c.vehicle_reg} · ${c.checklist_date}</div><div class="inspection-meta">${c.driver_id} · ${c.status}</div></div>`).join('')||'No checklists';}

// ── TRANSFER RECON REVIEW (ADMIN) ──────────────────────────────
async function loadTransferReconReview() {
  const container = document.getElementById('transfer-recon-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';

  const driverFilter = document.getElementById('tr-filter-driver')?.value || '';
  const weekFilter   = document.getElementById('tr-filter-week')?.value   || '';
  const statusFilter = document.getElementById('tr-filter-status')?.value || '';

  let query = sb
    .from('transfer_recon_sheets')
    .select('*, profiles!transfer_recon_sheets_driver_id_fkey(name, driver_id)')
    .order('week_start', { ascending: false });

  if (driverFilter) query = query.eq('driver_id', driverFilter);
  if (weekFilter)   query = query.eq('week_start', weekFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) { container.innerHTML = `<p style="color:var(--red)">Error: ${error.message}</p>`; return; }
  if (!data?.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>No transfer recon sheets found.</p></div>`;
    return;
  }

  const { data: drivers } = await sb.from('profiles').select('driver_id,name').eq('role','driver').eq('is_active',true).order('name');
  const driverSel = document.getElementById('tr-filter-driver');
  if (driverSel && driverSel.options.length <= 1) {
    (drivers || []).forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.driver_id; opt.textContent = `${d.name} (${d.driver_id})`;
      driverSel.appendChild(opt);
    });
  }

  container.innerHTML = data.map((s) => `
    <div class="inspection-item" onclick="openTransferReconDetail('${s.id}')">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">${s.profiles?.name || s.driver_id} · Week ${formatDate(s.week_start)} — ${formatDate(s.week_end)}</div>
        <div class="inspection-meta">${(s.transfers || []).length} transfer(s) · ${s.submitted_at ? 'Submitted ' + formatDate(s.submitted_at) : 'Draft'}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
        ${statusBadge(s.status)}
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openTransferReconDetail('${s.id}')">View</button>
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadTransferReconPDF('${s.id}')">PDF</button>
      </div>
    </div>`).join('');
}

async function openTransferReconDetail(id) {
  const { data: sheet, error } = await sb
    .from('transfer_recon_sheets')
    .select('*, profiles!transfer_recon_sheets_driver_id_fkey(name, driver_id)')
    .eq('id', id)
    .single();
  if (error || !sheet) { toast(error?.message || 'Sheet not found', 'error'); return; }

  document.getElementById('transfer-recon-detail-id').value = id;
  const transfers = Array.isArray(sheet.transfers) ? sheet.transfers : [];

  const tableRows = transfers.map((t, i) => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px">${i + 1}</td>
      <td style="padding:6px 8px">${t.vehicle_reg || '—'}</td>
      <td style="padding:6px 8px">${t.vehicle_name || '—'}</td>
      <td style="padding:6px 8px">${t.transfer_date ? formatDate(t.transfer_date) : '—'}</td>
      <td style="padding:6px 8px;font-weight:600">${t.reference_nr || '—'}</td>
      <td style="padding:6px 8px">${t.tla_type || '—'}</td>
      <td style="padding:6px 8px">${t.description || '—'}</td>
      <td style="padding:6px 8px">${t.notes || '—'}</td>
    </tr>`).join('');

  document.getElementById('transfer-recon-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><strong>Driver</strong><p>${sheet.profiles?.name || 'Unknown'} (${sheet.profiles?.driver_id || sheet.driver_id})</p></div>
      <div><strong>Week</strong><p>${formatDate(sheet.week_start)} — ${formatDate(sheet.week_end)}</p></div>
      <div><strong>Status</strong><p>${statusBadge(sheet.status)}</p></div>
      <div><strong>Submitted</strong><p>${sheet.submitted_at ? formatDateTime(sheet.submitted_at) : '—'}</p></div>
    </div>
    <div style="overflow-x:auto;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead>
          <tr style="background:var(--navy);color:#fff">
            <th style="padding:7px 8px">#</th>
            <th style="padding:7px 8px">Vehicle Reg</th>
            <th style="padding:7px 8px">Vehicle Name</th>
            <th style="padding:7px 8px">Transfer Date</th>
            <th style="padding:7px 8px">Tour/Transfer Ref Nr</th>
            <th style="padding:7px 8px">T/L/A Type</th>
            <th style="padding:7px 8px">Description</th>
            <th style="padding:7px 8px">Notes</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="8" style="padding:12px;text-align:center;color:var(--text-muted)">No transfers recorded.</td></tr>'}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-amber btn-full" onclick="downloadTransferReconPDF('${sheet.id}')">⬇ Download PDF</button>
      ${sheet.status === 'submitted' ? `<button class="btn btn-outline" onclick="markTransferReconReviewed('${sheet.id}')">✓ Mark Reviewed</button>` : ''}
    </div>`;
  openModal('modal-transfer-recon-detail');
}

async function markTransferReconReviewed(id) {
  const { error } = await sb.from('transfer_recon_sheets').update({
    status: 'reviewed',
    reviewed_by: currentUser?.id || null,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Marked as reviewed', 'success');
  closeModal('modal-transfer-recon-detail');
  loadTransferReconReview();
}
window.markTransferReconReviewed = markTransferReconReviewed;
window.openTransferReconDetail   = openTransferReconDetail;

async function downloadTransferReconPDF(id) {
  const { data: sheet, error } = await sb
    .from('transfer_recon_sheets')
    .select('*, profiles!transfer_recon_sheets_driver_id_fkey(name, driver_id)')
    .eq('id', id)
    .single();
  if (error || !sheet) { toast(error?.message || 'Not found', 'error'); return; }
  toast('Generating PDF…', 'info', 4000);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W   = doc.internal.pageSize.getWidth();
  const H   = doc.internal.pageSize.getHeight();
  let y = 0;

  doc.setFillColor(15, 39, 68);
  doc.rect(0, 0, W, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('INYATHI', 10, 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(CONFIG.COMPANY_NAME, 10, 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('TRANSFER RECON FOR WEEKLY PAYMENT', W / 2, 13, { align: 'center' });
  y = 28;

  doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('Driver Name:', 10, y);
  doc.setFont('helvetica', 'normal');
  doc.text(sheet.profiles?.name || sheet.driver_id || '—', 38, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Week:', W / 2, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${sheet.week_start} to ${sheet.week_end}`, W / 2 + 14, y);
  y += 6;

  doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(80, 80, 80);
  const notice = 'All transfer information to be added here. Client reference numbers to be added to every date. NO salary will be paid if this form has not been completed and sent to the office by every Thursday.';
  const noticeLines = doc.splitTextToSize(notice, W - 20);
  doc.text(noticeLines, 10, y);
  y += noticeLines.length * 4 + 4;

  const colWidths = [8, 28, 28, 26, 44, 36, 46, 35];
  const colX = colWidths.reduce((acc, w, i) => { acc.push(i === 0 ? 8 : acc[i - 1] + colWidths[i - 1]); return acc; }, []);
  const headers = ['#', 'Vehicle Reg', 'Vehicle Name', 'Transfer Date', 'Tour/Transfer Ref Nr', 'T/L/A Type', 'Description', 'Notes'];

  doc.setFillColor(15, 39, 68);
  doc.rect(8, y - 4, W - 16, 8, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  headers.forEach((h, i) => doc.text(h, colX[i] + 1, y));
  y += 5;

  const transfers = Array.isArray(sheet.transfers) ? sheet.transfers : [];
  transfers.forEach((t, idx) => {
    if (y > H - 20) {
      doc.addPage();
      y = 14;
    }
    const bg = idx % 2 === 0 ? [249, 250, 251] : [255, 255, 255];
    doc.setFillColor(...bg);
    doc.rect(8, y - 4, W - 16, 7, 'F');
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    const cells = [
      String(idx + 1),
      t.vehicle_reg  || '—',
      t.vehicle_name || '—',
      t.transfer_date ? formatDate(t.transfer_date) : '—',
      t.reference_nr || '—',
      t.tla_type     || '—',
      t.description  || '—',
      t.notes        || '—',
    ];
    cells.forEach((cell, i) => {
      const clipped = doc.splitTextToSize(String(cell), colWidths[i] - 2)[0] || '';
      doc.text(clipped, colX[i] + 1, y);
    });
    doc.setDrawColor(220, 220, 220);
    doc.line(8, y + 3, W - 8, y + 3);
    y += 7;
  });

  if (!transfers.length) {
    doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
    doc.text('No transfers recorded.', W / 2, y, { align: 'center' });
    y += 8;
  }

  y += 6;
  doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text(`Total Transfers: ${transfers.length}`, 10, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString('en-ZA')}`, W - 10, y, { align: 'right' });

  const driverCode = sheet.profiles?.driver_id || sheet.driver_id || 'DRV';
  doc.save(`TRANSFER_RECON_${driverCode}_${sheet.week_start}.pdf`);
  toast('Transfer Recon PDF downloaded', 'success');
}
window.downloadTransferReconPDF = downloadTransferReconPDF;

// ── TRAFFIC FINES DASHBOARD ──────────────────────────────────
let currentFineLookupMatch = null;
let fineDashboardLoaded = false;

function fineEscapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fineDateTimeLocalToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? `R ${numeric.toFixed(2)}` : fineEscapeHtml(amount);
}

async function initTrafficFinesDashboard() {
  if (fineDashboardLoaded) {
    await loadAdminTrafficFines();
    return;
  }
  fineDashboardLoaded = true;
  await loadFineVehicleOptions();
  await loadAdminTrafficFines();
}

async function loadFineVehicleOptions() {
  const select = document.getElementById('fine-vehicle');
  if (!select) return;
  const { data, error } = await sb.from('vehicles').select('id,registration_no,model').order('registration_no');
  if (error) {
    select.innerHTML = '<option value="">Unable to load vehicles</option>';
    toast(error.message, 'error');
    return;
  }
  select.innerHTML = '<option value="">Select vehicle…</option>' + (data || []).map((v) => (
    `<option value="${fineEscapeHtml(v.registration_no)}">${fineEscapeHtml(v.registration_no)} — ${fineEscapeHtml(v.model || 'Vehicle')}</option>`
  )).join('');
}

async function lookupDriverByFineTimeDashboard(event) {
  event?.preventDefault();
  const vehicleId = document.getElementById('fine-vehicle')?.value?.trim();
  const timestampInput = document.getElementById('fine-timestamp')?.value;
  const fineTimestamp = fineDateTimeLocalToIso(timestampInput);
  const resultBox = document.getElementById('fine-lookup-result');
  const logCard = document.getElementById('fine-log-card');
  currentFineLookupMatch = null;
  if (logCard) logCard.style.display = 'none';

  if (!vehicleId || !fineTimestamp) {
    if (resultBox) resultBox.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Select a vehicle and a valid fine date/time.</p></div>';
    return;
  }

  if (resultBox) resultBox.innerHTML = '<div class="spinner"></div>';
  const { data, error } = await sb.rpc('lookup_driver_by_fine_time', {
    p_vehicle_id: vehicleId,
    p_fine_timestamp: fineTimestamp,
  });

  if (error) {
    if (resultBox) resultBox.innerHTML = `<p style="color:var(--red)">${fineEscapeHtml(error.message)}</p>`;
    return;
  }

  const match = data?.[0];
  if (!match) {
    if (resultBox) resultBox.innerHTML = '<div class="empty-state"><div class="empty-icon">🔎</div><p>No assigned, non-cancelled booking matched that exact vehicle and timestamp.</p></div>';
    return;
  }

  currentFineLookupMatch = match;
  document.getElementById('fine-booking-id').value = match.booking_id;
  document.getElementById('fine-driver-id').value = match.driver_id;
  document.getElementById('fine-vehicle-reg').value = match.vehicle_reg;
  document.getElementById('fine-log-timestamp').value = fineTimestamp;
  document.getElementById('fine-notification-email').required = !match.driver_email;

  if (resultBox) {
    resultBox.innerHTML = `
      <div class="card" style="background:#f8fafc;margin:0">
        <div class="card-title">Matched Booking</div>
        <div class="detail-grid">
          <div><strong>Booking</strong><p>${fineEscapeHtml(match.invoice_no || match.booking_id)}</p></div>
          <div><strong>Client</strong><p>${fineEscapeHtml(match.client_name || '—')}</p></div>
          <div><strong>Vehicle</strong><p>${fineEscapeHtml(match.vehicle_reg)}</p></div>
          <div><strong>Driver</strong><p>${fineEscapeHtml(match.driver_name || match.driver_id)} (${fineEscapeHtml(match.driver_id)})</p></div>
          <div><strong>Phone</strong><p>${fineEscapeHtml(match.driver_phone || '—')}</p></div>
          <div><strong>Profile Email</strong><p>${fineEscapeHtml(match.driver_email || 'No email on profile — enter alternate email below')}</p></div>
        </div>
      </div>`;
  }
  if (logCard) logCard.style.display = 'block';
}

async function submitTrafficFine(event) {
  event?.preventDefault();
  if (!currentFineLookupMatch) {
    toast('Run a lookup before logging a fine.', 'warning');
    return;
  }

  const submitBtn = event?.target?.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

  const alternateEmail = document.getElementById('fine-notification-email').value.trim();
  if (!currentFineLookupMatch.driver_email && !alternateEmail) {
    toast('Enter an alternate email because this driver profile has no email.', 'warning');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Fine & Send Email'; }
    return;
  }

  const amountValue = document.getElementById('fine-amount').value;
  const payload = {
    booking_id: document.getElementById('fine-booking-id').value,
    driver_id: document.getElementById('fine-driver-id').value,
    vehicle_reg: document.getElementById('fine-vehicle-reg').value,
    fine_timestamp: document.getElementById('fine-log-timestamp').value,
    fine_reference: document.getElementById('fine-reference').value.trim() || null,
    location: document.getElementById('fine-location').value.trim() || null,
    description: document.getElementById('fine-description').value.trim() || null,
    amount: amountValue ? Number(amountValue) : null,
    notification_email: alternateEmail || null,
  };

  const { data: inserted, error: insertError } = await sb.from('traffic_fines').insert(payload).select('id').single();
  if (insertError || !inserted) {
    toast(insertError?.message || 'Fine could not be saved.', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Fine & Send Email'; }
    return;
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(CONFIG.NOTIFY_DRIVER_FINE_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ traffic_fine_id: inserted.id }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || 'Notification failed');
    toast(result.warning || 'Fine logged and driver notified.', result.warning ? 'warning' : 'success');
  } catch (err) {
    toast(`Fine saved, but email failed: ${err.message}`, 'warning', 6000);
  }

  event.target.reset();
  currentFineLookupMatch = null;
  document.getElementById('fine-log-card').style.display = 'none';
  document.getElementById('fine-lookup-result').innerHTML = '';
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Fine & Send Email'; }
  await loadAdminTrafficFines();
}

async function loadAdminTrafficFines() {
  const tbody = document.getElementById('traffic-fines-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7"><div class="spinner"></div></td></tr>';
  const { data, error } = await sb
    .from('traffic_fines')
    .select('*, bookings!traffic_fines_booking_id_fkey(invoice_no,client_name), profiles!traffic_fines_driver_id_fkey(name,phone,email)')
    .order('fine_timestamp', { ascending: false })
    .limit(100);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red)">${fineEscapeHtml(error.message)}</td></tr>`;
    return;
  }

  tbody.innerHTML = (data || []).map((fine) => `
    <tr>
      <td>${formatDateTime(fine.fine_timestamp)}</td>
      <td>${fineEscapeHtml(fine.vehicle_reg)}</td>
      <td>${fineEscapeHtml(fine.profiles?.name || fine.driver_id)}<br><span style="font-size:.73rem;color:var(--text-muted)">${fineEscapeHtml(fine.driver_id)}</span></td>
      <td>${fineEscapeHtml(fine.bookings?.invoice_no || fine.booking_id)}<br><span style="font-size:.73rem;color:var(--text-muted)">${fineEscapeHtml(fine.bookings?.client_name || '')}</span></td>
      <td>${fineEscapeHtml(fine.fine_reference || '—')}</td>
      <td>${formatMoney(fine.amount)}</td>
      <td>${fine.email_sent ? '<span class="badge badge-green">Sent</span>' : '<span class="badge badge-amber">Pending</span>'}${fine.notification_error ? `<br><span style="font-size:.72rem;color:var(--red)">${fineEscapeHtml(fine.notification_error)}</span>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7">No traffic fines logged yet.</td></tr>';
}

window.loadAdminTrafficFines = loadAdminTrafficFines;
document.getElementById('fine-lookup-form')?.addEventListener('submit', lookupDriverByFineTimeDashboard);
document.getElementById('fine-log-form')?.addEventListener('submit', submitTrafficFine);
