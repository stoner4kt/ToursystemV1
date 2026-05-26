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
  if (target === 'reports')  loadReports();
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
    <div class="booking-item">
      <div class="booking-dot" style="background:${b.status==='confirmed'?'var(--green)':b.status==='cancelled'?'var(--red)':'var(--amber)'}"></div>
      <div class="booking-info">
        <div class="booking-route">${b.client_name} — ${b.tour_reference || b.route || 'Tour Ref TBC'}</div>
        <div class="booking-meta">${b.invoice_no} · ${b.assigned_driver_id || 'Unassigned'} · ${b.assigned_vehicle_reg || 'No vehicle'}</div>
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
  const notesInput = getBookingNotesInput();
  if (notesInput) notesInput.value = '';
  currentBookingDocuments = [];
  const docInput = document.getElementById('booking-documents-input');
  if (docInput) docInput.value = '';
  renderBookingDocumentsList();
}
function renderBookingDocumentsList() {
  const holder = document.getElementById('booking-documents-list');
  if (!holder) return;
  if (!currentBookingDocuments.length) {
    holder.innerHTML = `<div style="color:var(--text-muted)">No documents attached.</div>`;
    return;
  }
  holder.innerHTML = currentBookingDocuments.map((d, i) => `<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding:4px 0">
    <a href="${d.url || '#'}" target="_blank" rel="noopener">${d.filename || 'Document'}</a>
    <span style="color:var(--text-muted)">${d.size ? `${Math.round(d.size / 1024)} KB` : '—'} · ${formatDateTime(d.uploaded_at)}</span>
    <button type="button" class="btn btn-sm btn-danger" onclick="removeBookingDocument(${i})">🗑</button>
  </div>`).join('');
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
  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true; submitBtn.textContent = 'Saving…';

  const { data: bookingData, error } = id
    ? await sb.from('bookings').update(payload).eq('id', id).select().single()
    : await sb.from('bookings').insert(payload).select().single();

  submitBtn.disabled = false; submitBtn.textContent = 'Save Booking';
  if (error) {
    toast('Error: ' + error.message + (error.message.includes('infinite recursion') ? ' — Check RLS policies.' : ''), 'error');
    return;
  }
  toast(id ? 'Booking updated' : 'Booking added', 'success');
  await postToWorkerWebhook(CONFIG.WORKER_BOOKINGS_WEBHOOK_URL, bookingData || payload);
  closeModal('modal-booking');
  renderCalendar();
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
    return `<tr><td>${b.invoice_no}</td><td>${b.client_name}</td><td>${b.assigned_driver_id || '—'}</td><td>${b.assigned_vehicle_reg || '—'}</td><td>${formatDate(b.start_date)}</td><td>${formatDate(b.end_date)}</td><td>${statusBadge(b.status)}</td><td>${docs.length ? `<span class="badge badge-blue">${docs.length} docs</span>` : '—'}</td><td><button class="btn btn-sm btn-outline" onclick="openEditBooking('${b.id}')">View Details</button> ${docs.length ? `<button class="btn btn-sm btn-amber" onclick="downloadBookingDocuments('${b.id}')">Download Documents</button>` : ''}</td></tr>`;
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
  container.innerHTML = data.map((sheet) => `
    <div class="inspection-item" onclick="openReconDetail('${sheet.id}')">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">${sheet.profiles?.name || sheet.driver_id} · ${sheet.week_start} → ${sheet.week_end}</div>
        <div class="inspection-meta">Ref: ${sheet.tour_reference || '—'} · Vehicle: ${sheet.vehicle_reg || '—'} · Distance: ${sheet.total_distance_km ?? 0} km</div>
        <div class="inspection-fault-count" style="color:var(--navy-mid)">Status: ${statusBadge(sheet.status || 'submitted')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openReconDetail('${sheet.id}')">View</button>
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadReconPDF('${sheet.id}')">PDF</button>
      </div>
    </div>`).join('');
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
async function loadWagesReconciliation(){const {data,error}=await sb.from('recon_sheets').select('*').order('created_at',{ascending:false}).limit(100);document.getElementById('wages-list').innerHTML=error?error.message:(data||[]).map(r=>`<div class="inspection-item"><div class="inspection-title">${r.driver_id} · ${r.tour_reference||'—'}</div><div class="inspection-meta">${r.week_start} → ${r.week_end} · Rate: ${r.driver_rate||'—'}</div></div>`).join('')||'No wages records';}
async function loadVehicleChecklists(){const {data,error}=await sb.from('vehicle_checklists').select('*').order('checklist_date',{ascending:false}).limit(100);document.getElementById('checklist-list').innerHTML=error?error.message:(data||[]).map(c=>`<div class="inspection-item"><div class="inspection-title">${c.vehicle_reg} · ${c.checklist_date}</div><div class="inspection-meta">${c.driver_id} · ${c.status}</div></div>`).join('')||'No checklists';}
