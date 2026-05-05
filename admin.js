// ============================================================
//  TRANSROUTE PWA — ADMIN DASHBOARD LOGIC
// ============================================================

// ── TAB NAVIGATION ───────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${target}`)?.classList.add('active');
    if (target === 'calendar') renderCalendar();
    if (target === 'fleet') { loadFleet(); }
    if (target === 'drivers') loadDriversTab();
    if (target === 'reports')  loadReports();
  });
});


async function loadDrivers() {
  const tbody = document.getElementById('drivers-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';

  const { data: drivers, error } = await sb.from('profiles')
    .select('id,driver_id,name,is_active,created_at,role')
    .eq('role', 'driver')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${error.message}</td></tr>`;
    return;
  }

  const { data: vehicles } = await sb.from('vehicles').select('registration_no,assigned_driver_id');
  const { data: bookings } = await sb.from('bookings').select('tour_date,invoice_no,status');
  const { data: inspections } = await sb.from('inspections').select('driver_id,invoice_no,created_at');

  const today = new Date().toISOString().split('T')[0];
  tbody.innerHTML = (drivers || []).map((d) => {
    const status = d.is_active ? 'Active' : 'Inactive';
    const completed = (inspections || []).filter(i => i.driver_id === d.driver_id).length;
    const regs = (vehicles || []).filter(v => v.assigned_driver_id === d.driver_id).map(v => v.registration_no);
    const upcoming = (bookings || []).filter(b => b.start_date >= today && b.status !== 'cancelled').length;
    return `<tr><td>${d.name}</td><td>${d.driver_id}</td><td>${status}</td><td>${completed}</td><td>${upcoming}</td></tr>`;
  }).join('') || '<tr><td colspan="5">No drivers found.</td></tr>';
}

// ────────────────────────────────────────────────────────────
//  CALENDAR
// ────────────────────────────────────────────────────────────
let calDate     = new Date();
let allBookings = [];
let driverOptions = [];

async function loadDriverOptions() {
  const { data } = await sb.from('profiles')
    .select('driver_id, name, is_active, role')
    .eq('role', 'driver')
    .eq('is_active', true)
    .order('name');
  driverOptions = data || [];
  const sel = document.getElementById('vehicle-assigned-driver');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Unassigned —</option>';
  driverOptions.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.driver_id;
    opt.textContent = `${d.name} (${d.driver_id})`;
    sel.appendChild(opt);
  });
}


async function inviteDriver(event) {
  event.preventDefault();
  const nameInput = document.getElementById('driver-invite-name');
  const emailInput = document.getElementById('driver-invite-email');
  const msg = document.getElementById('driver-invite-msg');
  const submitBtn = event.target.querySelector('button[type="submit"]');

  const fullName = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();

  if (!fullName || !email) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Please enter driver name and email.';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  msg.style.color = 'var(--text-muted)';
  msg.textContent = 'Sending invitation link...';

  try {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        data: { full_name: fullName, role: 'driver' },
        emailRedirectTo: `${window.location.origin}/inspection.html`,
      },
    });

    if (error) throw error;

    msg.style.color = 'var(--green)';
    msg.textContent = 'Invite sent. The driver can open the magic link from their email to log in.';
    nameInput.value = '';
    emailInput.value = '';
      } catch (err) {
    msg.style.color = 'var(--red)';
    msg.textContent = err?.message || 'Failed to send driver invite.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Invite Link';
  }
}

async function renderCalendar() {
  const year  = calDate.getFullYear();
  const month = calDate.getMonth();

  document.getElementById('cal-month-label').textContent =
    calDate.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

  // Fetch bookings for this month
  const from = new Date(year, month, 1).toISOString().split('T')[0];
  const to   = new Date(year, month + 1, 0).toISOString().split('T')[0];
  const { data } = await sb.from('bookings')
    .select('*').lte('start_date', to).gte('end_date', from)
    .order('start_date');
  allBookings = data || [];

  // Build calendar grid
  const grid     = document.getElementById('cal-grid');
  const firstDay = new Date(year, month, 1).getDay();
  const lastDay  = new Date(year, month + 1, 0).getDate();
  const today    = new Date();

  const bookingDates = new Set(allBookings.map((b) => b.start_date));
  grid.innerHTML = '';

  // Day-name headers
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-day-name'; el.textContent = d;
    grid.appendChild(el);
  });

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day other-month';
    grid.appendChild(el);
  }

  // Day cells
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = d;
    if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear())
      el.classList.add('today');
    if (bookingDates.has(dateStr)) el.classList.add('has-booking');
    el.addEventListener('click', () => showBookingsForDate(dateStr, el));
    grid.appendChild(el);
  }

  // Load stats
  loadCalendarStats();
}

function showBookingsForDate(dateStr, cell) {
  document.querySelectorAll('.cal-day.selected').forEach((el) => el.classList.remove('selected'));
  cell.classList.add('selected');
  const dayBookings = allBookings.filter((b) => b.start_date === dateStr);
  const container   = document.getElementById('day-bookings');

  if (dayBookings.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:.88rem;padding:8px 0;">No bookings on ${formatDate(dateStr)}.</p>`;
    return;
  }
  container.innerHTML = dayBookings.map((b) => `
    <div class="booking-item">
      <div class="booking-dot" style="background:${b.status==='confirmed'?'var(--green)':b.status==='cancelled'?'var(--red)':'var(--amber)'}"></div>
      <div class="booking-info">
        <div class="booking-route">${b.client_name} — ${b.route || 'Route TBC'}</div>
        <div class="booking-meta">${b.invoice_no} · ${b.assigned_driver_id || 'Unassigned driver'} · ${b.assigned_vehicle_reg || 'Unassigned vehicle'}</div>
      </div>
      <div class="d-flex" style="display:flex;gap:6px;align-items:center">
        ${statusBadge(b.status)}
        <button class="btn btn-sm btn-outline" onclick="openEditBooking('${b.id}')">Edit</button>
      </div>
    </div>
  `).join('');
}

async function loadCalendarStats() {
  const { data } = await sb.from('bookings').select('status');
  const all    = data || [];
  document.getElementById('stat-total').textContent    = all.length;
  document.getElementById('stat-confirmed').textContent = all.filter(b=>b.status==='confirmed').length;
  document.getElementById('stat-pending').textContent   = all.filter(b=>b.status==='pending').length;
  document.getElementById('stat-invoiced').textContent  = all.filter(b=>b.status==='invoiced').length;
}

document.getElementById('cal-prev')?.addEventListener('click', () => {
  calDate.setMonth(calDate.getMonth() - 1); renderCalendar();
});
document.getElementById('cal-next')?.addEventListener('click', () => {
  calDate.setMonth(calDate.getMonth() + 1); renderCalendar();
});

// ── Add / Edit Booking ────────────────────────────────────────
document.getElementById('btn-add-booking')?.addEventListener('click', () => {
  resetBookingForm();
  document.getElementById('modal-booking-title').textContent = 'New Booking';
  openModal('modal-booking');
});

function resetBookingForm() {
  document.getElementById('booking-id').value       = '';
  document.getElementById('booking-invoice').value  = `INV-${Date.now().toString().slice(-6)}`;
  document.getElementById('booking-client').value   = '';
  document.getElementById('booking-route').value    = '';
  document.getElementById('booking-start-date').value     = '';
  document.getElementById('booking-end-date').value       = '';
  document.getElementById('booking-driver').value         = '';
  document.getElementById('booking-vehicle').value        = '';
  document.getElementById('booking-status').value   = 'pending';
  document.getElementById('booking-notes').value    = '';
}

async function openEditBooking(id) {
  const { data } = await sb.from('bookings').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('booking-id').value       = data.id;
  document.getElementById('booking-invoice').value  = data.invoice_no;
  document.getElementById('booking-client').value   = data.client_name;
  document.getElementById('booking-route').value    = data.route || '';
  document.getElementById('booking-start-date').value     = data.start_date;
  document.getElementById('booking-end-date').value       = data.end_date;
  document.getElementById('booking-driver').value         = data.assigned_driver_id || '';
  document.getElementById('booking-vehicle').value        = data.assigned_vehicle_reg || '';
  document.getElementById('booking-status').value   = data.status;
  document.getElementById('booking-notes').value    = data.notes || '';
  document.getElementById('modal-booking-title').textContent = 'Edit Booking';
  openModal('modal-booking');
}

document.getElementById('form-booking')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('booking-id').value;
  const payload = {
    invoice_no:  document.getElementById('booking-invoice').value.trim(),
    client_name: document.getElementById('booking-client').value.trim(),
    route:       document.getElementById('booking-route').value.trim(),
    start_date:  document.getElementById('booking-start-date').value,
    end_date:    document.getElementById('booking-end-date').value,
    assigned_driver_id: document.getElementById('booking-driver').value || null,
    assigned_vehicle_reg: document.getElementById('booking-vehicle').value || null,
    status:      document.getElementById('booking-status').value,
    notes:       document.getElementById('booking-notes').value.trim(),
  };
  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true; submitBtn.textContent = 'Saving…';

  const { data: bookingData, error } = id
    ? await sb.from('bookings').update(payload).eq('id', id).select().single()
    : await sb.from('bookings').insert(payload).select().single();

  submitBtn.disabled = false; submitBtn.textContent = 'Save Booking';
  if (error) {
    const extra = error.message.includes('infinite recursion detected')
      ? ' Database RLS policy issue detected. Run updated schema.sql policies (is_admin function) in Supabase SQL editor.'
      : '';
    toast('Error: ' + error.message + extra, 'error');
    return;
  }
  toast(id ? 'Booking updated' : 'Booking added', 'success');
  await postToWorkerWebhook(CONFIG.WORKER_BOOKINGS_WEBHOOK_URL, bookingData || payload);
  closeModal('modal-booking');
  renderCalendar();
});

// ────────────────────────────────────────────────────────────
//  FLEET MANAGEMENT
// ────────────────────────────────────────────────────────────
async function loadFleet() {
  const tbody = document.getElementById('fleet-tbody');
  tbody.innerHTML = `<tr><td colspan="7"><div class="skeleton-table-row"><div class="skeleton-table-cell" style="width:18%"></div><div class="skeleton-table-cell" style="width:18%"></div><div class="skeleton-table-cell" style="width:10%"></div><div class="skeleton-table-cell" style="width:14%"></div><div class="skeleton-table-cell" style="width:14%"></div><div class="skeleton-table-cell" style="width:12%"></div><div class="skeleton-table-cell" style="width:14%"></div></div></td></tr>`;
  const { data, error } = await sb.from('vehicles').select('*').order('registration_no');
  
  if (error) { tbody.innerHTML = `<tr><td colspan="7">Error loading fleet</td></tr>`; return; }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🚌</div><p>No vehicles added yet.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((v) => {
    const pct = v.next_service_km
      ? Math.min(100, Math.round((v.current_mileage / v.next_service_km) * 100))
      : 0;
    const barClass = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : '';
    const kmLeft = v.next_service_km ? v.next_service_km - v.current_mileage : null;
    return `
      <tr>
        <td><strong>${v.registration_no}</strong></td>
        <td>${v.make || ''} ${v.model}</td>
        <td>${v.year || '—'}</td>
        <td>${formatMileage(v.current_mileage)}</td>
        <td>
          <div class="progress-bar" title="${formatMileage(v.current_mileage)} / ${formatMileage(v.next_service_km)}">
            <div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div>
          </div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-top:3px">
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

document.getElementById('btn-add-vehicle')?.addEventListener('click', async () => {
    resetVehicleForm();
  document.getElementById('modal-vehicle-title').textContent = 'Add Vehicle';
  openModal('modal-vehicle');
});

function resetVehicleForm() {
  ['vehicle-id','vehicle-reg','vehicle-model','vehicle-make',
   'vehicle-year','vehicle-mileage','vehicle-service-km','vehicle-notes'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('vehicle-status').value = 'active';
  }

async function openEditVehicle(id) {
    const { data } = await sb.from('vehicles').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('vehicle-id').value         = data.id;
  document.getElementById('vehicle-reg').value        = data.registration_no;
  document.getElementById('vehicle-model').value      = data.model;
  document.getElementById('vehicle-make').value       = data.make || '';
  document.getElementById('vehicle-year').value       = data.year || '';
  document.getElementById('vehicle-mileage').value    = data.current_mileage;
  document.getElementById('vehicle-service-km').value = data.next_service_km || '';
  document.getElementById('vehicle-status').value     = data.status;
  document.getElementById('vehicle-notes').value      = data.notes || '';
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
  if (error) {
    const extra = error.message.includes('infinite recursion detected')
      ? ' Database RLS policy issue detected. Run updated schema.sql policies (is_admin function) in Supabase SQL editor.'
      : '';
    toast('Error: ' + error.message + extra, 'error');
    return;
  }
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

// ────────────────────────────────────────────────────────────
//  REPORTS (Inspections)
// ────────────────────────────────────────────────────────────
async function loadReports() {
  const container = document.getElementById('reports-list');
  container.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  const { data, error } = await sb.from('inspections')
    .select('*, profiles(name), vehicles(model)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { container.innerHTML = '<p>Error loading reports.</p>'; return; }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No inspections recorded yet.</p></div>`;
    return;
  }

  container.innerHTML = data.map((insp) => {
    const faults  = insp.faults_json || [];
    const media   = insp.media_urls  || [];
    return `
      <div class="inspection-item" onclick="openReportDetail('${insp.id}')">
        <div>
          <div class="inspection-title">${insp.vehicle_reg} — ${insp.inspection_type}</div>
          <div class="inspection-meta">
            Driver: ${insp.profiles?.name || insp.driver_id} ·
            ${formatDateTime(insp.created_at)} ·
            ${media.length} photo(s)
          </div>
          ${faults.length > 0
            ? `<div class="inspection-fault-count">⚠ ${faults.length} fault(s) reported</div>`
            : '<div style="color:var(--green);font-size:.8rem;margin-top:3px">✓ No faults</div>'
          }
        </div>
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadPDF('${insp.id}')">
          PDF
        </button>
      </div>`;
  }).join('');
}

async function openReportDetail(id) {
  const { data: insp } = await sb.from('inspections')
    .select('*, profiles(name, driver_id), vehicles(model, make)')
    .eq('id', id).single();
  if (!insp) return;

  const faults  = insp.faults_json  || [];
  const media   = insp.media_urls   || [];
  const checklistEntries = Object.entries(insp.checklist_json || {});

  document.getElementById('report-detail-body').innerHTML = `
    <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div><strong>Vehicle</strong><p>${insp.vehicle_reg} — ${insp.vehicles?.make||''} ${insp.vehicles?.model||''}</p></div>
      <div><strong>Driver</strong><p>${insp.profiles?.name || insp.driver_id}</p></div>
      <div><strong>Type</strong><p>${statusBadge(insp.inspection_type)}</p></div>
      <div><strong>Date</strong><p>${formatDateTime(insp.created_at)}</p></div>
      <div><strong>Mileage</strong><p>${formatMileage(insp.mileage_at_inspection)}</p></div>
      <div><strong>Invoice</strong><p>${insp.invoice_no || '—'}</p></div>
    </div>
    ${faults.length > 0 ? `
      <div class="fault-alert">
        <div class="fault-icon">⚠</div>
        <div class="fault-text"><strong>${faults.length} Critical Fault(s):</strong><br>${faults.join(' · ')}</div>
      </div>` : '<p style="color:var(--green);font-weight:600;margin-bottom:12px">✓ No critical faults</p>'
    }
    <div style="margin-bottom:16px">
      <strong>Checklist (${checklistEntries.filter(([,v])=>v==='ok').length}/${checklistEntries.length} OK)</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px">
        ${checklistEntries.map(([item, result]) => `
          <div style="font-size:.82rem;display:flex;gap:6px;align-items:center">
            <span style="color:${result==='ok'?'var(--green)':'var(--red)'}">
              ${result === 'ok' ? '✓' : '✕'}
            </span>${item}
          </div>`).join('')}
      </div>
    </div>
    ${media.length > 0 ? `
      <div>
        <strong>Photos / Videos</strong>
        <div class="media-preview" style="margin-top:8px">
          ${media.map((url) => url.match(/\.(mp4|webm|mov)$/i)
            ? `<div class="media-preview-item"><video src="${url}" controls></video></div>`
            : `<div class="media-preview-item"><a href="${url}" target="_blank"><img src="${url}" alt="media"></a></div>`
          ).join('')}
        </div>
      </div>` : ''
    }
    ${insp.notes ? `<div style="margin-top:14px"><strong>Notes</strong><p style="font-size:.9rem;color:var(--text-muted)">${insp.notes}</p></div>` : ''}
    <div style="margin-top:20px;display:flex;gap:10px">
      <button class="btn btn-amber btn-full" onclick="downloadPDF('${insp.id}')">⬇ Download PDF Report</button>
    </div>
  `;
  document.getElementById('report-detail-id').value = id;
  openModal('modal-report-detail');
}

// ── PDF Generation ────────────────────────────────────────────
async function downloadPDF(inspectionId) {
  const { data: insp } = await sb.from('inspections')
    .select('*, profiles(name, driver_id), vehicles(model, make, registration_no)')
    .eq('id', inspectionId).single();
  if (!insp) { toast('Inspection not found', 'error'); return; }

  toast('Generating PDF…', 'info', 5000);
  const { jsPDF } = window.jspdf;
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();
  let   y    = 15;

  // ── Header ──────────────────────────────────────────────────
  doc.setFillColor(15, 39, 68);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(CONFIG.APP_NAME, 14, 13);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(CONFIG.COMPANY_NAME, 14, 20);
  doc.setFontSize(9);
  doc.text('VEHICLE INSPECTION REPORT', W - 14, 13, { align: 'right' });
  doc.text(formatDateTime(insp.created_at), W - 14, 20, { align: 'right' });
  y = 36;

  // ── Details Grid ─────────────────────────────────────────────
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

  // ── Faults ────────────────────────────────────────────────────
  const faults = insp.faults_json || [];
  if (faults.length > 0) {
    doc.setFillColor(254, 226, 226); doc.rect(14, y - 4, W - 28, 7 + faults.length * 6, 'F');
    doc.setTextColor(185, 28, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`⚠ Critical Faults (${faults.length})`, 16, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    faults.forEach((f) => { doc.text('• ' + f, 18, y); y += 6; });
    y += 4;
  } else {
    doc.setFillColor(209, 250, 229); doc.rect(14, y - 4, W - 28, 10, 'F');
    doc.setTextColor(6, 95, 70); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('✓ No Critical Faults Reported', 16, y); y += 12;
  }

  // ── Checklist ─────────────────────────────────────────────────
  doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Inspection Checklist', 14, y); y += 6;
  const entries = Object.entries(insp.checklist_json || {});
  doc.setFontSize(8.5);
  const colW = (W - 28) / 2;
  entries.forEach(([item, result], i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    const col = i % 2;
    const xPos = 14 + col * colW;
    if (col === 0 && i > 0) y += 0;
    const color = result === 'ok' ? [16, 185, 129] : [239, 68, 68];
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(result === 'ok' ? '✓' : '✕', xPos, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(item, xPos + 5, y);
    if (col === 1) y += 6;
  });
  if (entries.length % 2 !== 0) y += 6;
  y += 4;

  // ── Notes ────────────────────────────────────────────────────
  if (insp.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Notes', 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(doc.splitTextToSize(insp.notes, W - 28), 14, y);
  }

  // ── Footer ────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(15, 39, 68); doc.rect(0, 287, W, 10, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
    doc.text(`${CONFIG.COMPANY_NAME} — Generated ${formatDateTime(new Date())}`, 14, 293);
    doc.text(`Page ${i} of ${pageCount}`, W - 14, 293, { align: 'right' });
  }

  doc.save(`TransRoute_Inspection_${insp.vehicle_reg}_${insp.created_at.split('T')[0]}.pdf`);
  toast('PDF downloaded', 'success');
}

// ── Init ──────────────────────────────────────────────────────
(async () => {
  const session = await initAuth('admin');
  if (!session) return;

  document.getElementById('admin-name').textContent = currentProfile?.name || 'Admin';
  document.getElementById('btn-signout')?.addEventListener('click', signOut);
  document.querySelector('[data-tab="calendar"]')?.click();
  document.getElementById('form-driver-invite')?.addEventListener('submit', inviteDriver);
  updateSyncBadge();
  await loadBookingDriverOptions();
  await loadBookingVehicleOptions();

  const inspectionChannel = sb.channel('public:inspections')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inspections' }, (payload) => {
      toast('New inspection submitted!', 'info', 3000);
      if (document.getElementById('tab-reports').classList.contains('active')) {
        loadReports();
      }
    }).subscribe();

  const hasSeenTour = localStorage.getItem('transroute-admin-tour-seen');
  if (!hasSeenTour) { setTimeout(() => startAdminTour(), 1000); }
  const tourBtn = document.createElement('button');
  tourBtn.className = 'btn-icon'; tourBtn.innerHTML = '❓'; tourBtn.title = 'Show Tour'; tourBtn.onclick = startAdminTour;
  document.querySelector('.header-actions').prepend(tourBtn);
})();


loadDriverOptions();
loadDrivers();


async function loadBookingDriverOptions() {
  const { data } = await sb.from('profiles').select('driver_id,name').eq('role','driver').eq('is_active', true).order('name');
  const sel = document.getElementById('booking-driver'); if (!sel) return;
  sel.innerHTML = '<option value="">— Unassigned —</option>';
  (data||[]).forEach((d)=>{ const o=document.createElement('option'); o.value=d.driver_id; o.textContent=`${d.name} (${d.driver_id})`; sel.appendChild(o); });
}
async function loadBookingVehicleOptions() {
  const { data } = await sb.from('vehicles').select('registration_no,model').eq('status','active').order('registration_no');
  const sel = document.getElementById('booking-vehicle'); if (!sel) return;
  sel.innerHTML = '<option value="">— Unassigned —</option>';
  (data||[]).forEach((v)=>{ const o=document.createElement('option'); o.value=v.registration_no; o.textContent=`${v.registration_no} (${v.model})`; sel.appendChild(o); });
}

async function loadDriversTab() {
 const [activeRes, upcomingRes, driversRes] = await Promise.all([
  sb.from('bookings').select('*').lte('start_date', new Date().toISOString().split('T')[0]).gte('end_date', new Date().toISOString().split('T')[0]).order('start_date'),
  sb.from('bookings').select('*').gt('start_date', new Date().toISOString().split('T')[0]).order('start_date'),
  sb.from('profiles').select('*').eq('role','driver').order('name')
 ]);
 const at=document.getElementById('drivers-active-trips'); const ut=document.getElementById('drivers-upcoming-trips'); const dt=document.getElementById('drivers-manage-tbody');
 at.innerHTML=(activeRes.data||[]).map(b=>`<tr><td>${b.invoice_no}</td><td>${b.client_name}</td><td>${b.assigned_driver_id||'—'}</td><td>${b.assigned_vehicle_reg||'—'}</td><td>${formatDate(b.start_date)} - ${formatDate(b.end_date)}</td></tr>`).join('')||'<tr><td colspan="5">No active trips.</td></tr>';
 ut.innerHTML=(upcomingRes.data||[]).map(b=>`<tr><td>${b.invoice_no}</td><td>${b.client_name}</td><td>${b.assigned_driver_id||'—'}</td><td>${b.assigned_vehicle_reg||'—'}</td><td>${formatDate(b.start_date)}</td></tr>`).join('')||'<tr><td colspan="5">No upcoming trips.</td></tr>';
 dt.innerHTML=(driversRes.data||[]).map(d=>`<tr><td>${d.name}</td><td>${d.driver_id}</td><td>${d.phone||'—'}</td><td>${d.is_active?'Active':'Inactive'}</td><td><button class='btn btn-sm btn-outline' onclick="openEditDriver('${d.id}')">Edit</button> <button class='btn btn-sm btn-danger' onclick="deleteDriver('${d.id}')">Del</button></td></tr>`).join('')||'<tr><td colspan="5">No drivers found.</td></tr>';
}
async function openEditDriver(driverId){ const {data}=await sb.from('profiles').select('*').eq('id',driverId).single(); if(!data) return; document.getElementById('driver-id').value=data.id; document.getElementById('driver-name-input').value=data.name||''; document.getElementById('driver-code-input').value=data.driver_id||''; document.getElementById('driver-phone-input').value=data.phone||''; document.getElementById('driver-active-input').value=String(data.is_active); document.getElementById('modal-driver-title').textContent='Edit Driver'; openModal('modal-driver'); }
async function deleteDriver(driverId){ if(!confirm('Delete this driver?')) return; const {error}=await sb.from('profiles').delete().eq('id',driverId); if(error){toast(error.message,'error');return;} toast('Driver deleted','success'); loadDriversTab(); }
document.getElementById('btn-add-driver')?.addEventListener('click',()=>{ document.getElementById('form-driver').reset(); document.getElementById('driver-id').value=''; document.getElementById('modal-driver-title').textContent='Add Driver'; openModal('modal-driver');});
document.getElementById('form-driver')?.addEventListener('submit', async (e)=>{ e.preventDefault(); const id=document.getElementById('driver-id').value; const payload={name:document.getElementById('driver-name-input').value.trim(), driver_id:document.getElementById('driver-code-input').value.trim(), phone:document.getElementById('driver-phone-input').value.trim()||null, is_active:document.getElementById('driver-active-input').value==='true', role:'driver'}; const {error}= id? await sb.from('profiles').update(payload).eq('id',id): await sb.from('profiles').insert(payload); if(error){toast(error.message,'error');return;} closeModal('modal-driver'); toast('Driver saved','success'); loadDriversTab();});

function startAdminTour(){ const tour = new Shepherd.Tour({ useModalOverlay: true, defaultStepOptions: { cancelIcon: { enabled: true }, classes: 'shepherd-theme-custom', scrollTo: { behavior: 'smooth', block: 'center' } } }); tour.addStep({id:'welcome',text:'Welcome to TransRoute Admin! Let me show you around.',buttons:[{text:'Skip',action:tour.cancel},{text:'Start Tour',action:tour.next}]}); ['calendar','fleet','drivers','reports'].forEach((id,idx)=>tour.addStep({id,text:id==='calendar'?'Manage bookings and view your schedule here.':id==='fleet'?'Monitor your fleet vehicles and service schedules.':id==='drivers'?'Manage drivers and view their active and upcoming trips.':'Review inspection reports and download PDFs.',attachTo:{element:`[data-tab="${id}"]`,on:'bottom'},buttons:[{text:'Back',action:tour.back},{text:idx===3?'Finish':'Next',action:idx===3?tour.complete:tour.next}]})); tour.on('complete',()=>localStorage.setItem('transroute-admin-tour-seen','true')); tour.start(); }
