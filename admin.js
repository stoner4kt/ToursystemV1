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

  document.getElementById('booking-is-rented')?.addEventListener('change', function() {
    document.getElementById('rented-vehicle-fields').style.display = this.checked ? 'block' : 'none';
    if (!this.checked) {
      document.getElementById('booking-rented-reg').value = '';
      document.getElementById('booking-rented-model').value = '';
      document.getElementById('booking-rented-vehicle-id').value = '';
      document.getElementById('booking-rented-vehicle-select').value = '';
    }
  });

  document.getElementById('booking-rented-vehicle-select')?.addEventListener('change', function() {
    const sel = this.options[this.selectedIndex];
    if (sel && sel.value) {
      document.getElementById('booking-rented-reg').value   = sel.dataset.reg   || '';
      document.getElementById('booking-rented-model').value = sel.dataset.model || '';
      document.getElementById('booking-rented-vehicle-id').value = sel.value;
    } else {
      document.getElementById('booking-rented-vehicle-id').value = '';
    }
  });

  document.getElementById('btn-signout-sidebar')?.addEventListener('click', signOut);

  renderCalendar();
  await loadPendingDeletionsBadge();
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
  if (target === 'inspections') loadAdminInspections();
  if (target === 'traffic-fines') initTrafficFinesDashboard();
  if (target === 'bookings-archive')  loadBookingsArchive();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── CALENDAR ──────────────────────────────────────────────────
let calDate       = new Date();
let allBookings   = [];

const CAL_PALETTE     = ['#2563eb','#16a34a','#dc2626','#f59e0b','#7c3aed','#0891b2','#ea580c','#be185d'];
const vehicleColorMap = {};
function getVehicleColor(reg) {
  if (!reg) return '#94a3b8';
  if (!vehicleColorMap[reg]) {
    vehicleColorMap[reg] = CAL_PALETTE[Object.keys(vehicleColorMap).length % CAL_PALETTE.length];
  }
  return vehicleColorMap[reg];
}
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

  await loadRentedVehicleDropdown();
}

async function loadRentedVehicleDropdown() {
  const sel = document.getElementById('booking-rented-vehicle-select');
  if (!sel) return;
  const { data } = await sb.from('rented_vehicles')
    .select('id,reg_no,make,model,status')
    .in('status', ['active'])
    .order('reg_no');
  sel.innerHTML = '<option value="">— or enter details below —</option>';
  (data || []).forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.dataset.reg   = v.reg_no;
    opt.dataset.model = [v.make, v.model].filter(Boolean).join(' ');
    opt.textContent   = `${v.reg_no} — ${[v.make, v.model].filter(Boolean).join(' ')} (${v.status})`;
    sel.appendChild(opt);
  });
}

async function renderCalendar() {
  const year  = calDate.getFullYear();
  const month = calDate.getMonth();
  document.getElementById('cal-month-label').textContent =
    calDate.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

  const from = new Date(year, month, 1).toISOString().split('T')[0];
  const to   = new Date(year, month + 1, 0).toISOString().split('T')[0];

  // Fetch bookings and vehicle colours in parallel (single round-trip)
  const [{ data: bookingData }, vehicleResult] = await Promise.all([
    sb.from('bookings').select('*').lte('start_date', to).gte('end_date', from).order('start_date'),
    sb.from('vehicles').select('registration_no, calendar_color').order('registration_no'),
  ]);
  allBookings = bookingData || [];

  // ── Vehicle colour map (module-level map, updated here each render) ──
  (vehicleResult.data || []).forEach((v) => {
    if (v.calendar_color) vehicleColorMap[v.registration_no] = v.calendar_color;
  });

  // ── Build calendar map: dateStr → [bookings] ───────────────
  // Parse "YYYY-MM-DD" as a local-time date to avoid UTC-offset drift
  function parseDateLocal(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);
  const calendarMap = {};
  allBookings.forEach((b) => {
    // Clamp each booking to the visible month so iteration is bounded
    const start = new Date(Math.max(parseDateLocal(b.start_date).getTime(), monthStart.getTime()));
    const end   = new Date(Math.min(parseDateLocal(b.end_date).getTime(),   monthEnd.getTime()));
    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
      const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      if (!calendarMap[key]) calendarMap[key] = [];
      calendarMap[key].push(b);
    }
  });

  // ── Render grid ────────────────────────────────────────────
  const grid     = document.getElementById('cal-grid');
  const firstDay = new Date(year, month, 1).getDay();
  const lastDay  = new Date(year, month + 1, 0).getDate();
  const today    = new Date();
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
    const el = document.createElement('div'); el.className = 'cal-day';
    if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) el.classList.add('today');

    // Day number (wrapped so markers can sit below it)
    const dayNum = document.createElement('div');
    dayNum.className = 'day-number';
    dayNum.textContent = d;
    el.appendChild(dayNum);

    // Mark day as having bookings (keeps has-booking class logic intact)
    const dayBookings = calendarMap[dateStr] || [];
    if (dayBookings.length > 0) el.classList.add('has-booking');

    el.addEventListener('click', () => showBookingsForDate(dateStr, el));
    grid.appendChild(el);
  }
  loadCalendarStats();
  requestAnimationFrame(() => renderBookingBars());
}

function renderBookingBars() {
  const wrapper = document.getElementById('cal-grid-wrapper');
  if (!wrapper) return;

  wrapper.querySelectorAll('.cal-booking-bar').forEach(el => el.remove());

  const grid = document.getElementById('cal-grid');
  const cells = Array.from(grid.querySelectorAll('.cal-day'));
  if (!cells.length) return;

  // If wrapper has no width the tab is hidden — skip silently
  const wrapperRect = wrapper.getBoundingClientRect();
  if (!wrapperRect.width) return;

  const year     = calDate.getFullYear();
  const month    = calDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDay  = new Date(year, month + 1, 0).getDate();

  function cellIndex(d) { return firstDay + d - 1; }

  function dateToIndex(str) {
    const [y, m, d] = str.split('-').map(Number);
    if (y !== year || m - 1 !== month || d < 1 || d > lastDay) return null;
    return cellIndex(d);
  }

  function parseDateLocal(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);

  // Match bar height to current responsive CSS breakpoint
  const vw = wrapperRect.width;
  const BAR_HEIGHT = vw >= 1025 ? 6 : vw <= 400 ? 4 : 5;
  const BAR_GAP    = 2;
  const TOP_OFFSET = 20; // px below the day number inside each cell

  const cellOffsets = {};
  const sorted = [...allBookings].sort((a, b) => a.start_date.localeCompare(b.start_date));

  sorted.forEach(b => {
    const bStart   = parseDateLocal(b.start_date);
    const bEnd     = parseDateLocal(b.end_date);
    const visStart = new Date(Math.max(bStart.getTime(), monthStart.getTime()));
    const visEnd   = new Date(Math.min(bEnd.getTime(),   monthEnd.getTime()));
    if (visStart > visEnd) return;

    const reg   = b.is_rented_vehicle ? (b.rented_vehicle_reg || null) : b.assigned_vehicle_reg;
    const color = getVehicleColor(reg);

    let cursor = new Date(visStart);
    const pad  = n => String(n).padStart(2, '0');

    while (cursor <= visEnd) {
      const daysUntilSat = 6 - cursor.getDay();
      const segEnd = new Date(Math.min(
        visEnd.getTime(),
        new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + daysUntilSat).getTime()
      ));

      const segStartStr = `${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}-${pad(cursor.getDate())}`;
      const segEndStr   = `${segEnd.getFullYear()}-${pad(segEnd.getMonth()+1)}-${pad(segEnd.getDate())}`;

      const startIdx = dateToIndex(segStartStr);
      const endIdx   = dateToIndex(segEndStr);

      if (startIdx !== null && endIdx !== null && startIdx < cells.length && endIdx < cells.length) {
        const startCell = cells[startIdx];
        const endCell   = cells[endIdx];

        if (startCell && endCell) {
          const startRect = startCell.getBoundingClientRect();
          const endRect   = endCell.getBoundingClientRect();

          const left  = startRect.left - wrapperRect.left + 2;
          const width = (endRect.right - wrapperRect.left - 2) - left;

          // Determine stack slot across all cells in this segment
          let slot = 0;
          for (let i = startIdx; i <= endIdx; i++) slot = Math.max(slot, cellOffsets[i] || 0);
          for (let i = startIdx; i <= endIdx; i++) cellOffsets[i] = slot + 1;

          // top is relative to the wrapper — use the cell's actual Y offset
          const top = (startRect.top - wrapperRect.top) + TOP_OFFSET + slot * (BAR_HEIGHT + BAR_GAP);

          const isStart = segStartStr === b.start_date || bStart <= monthStart;
          const isEnd   = segEndStr   === b.end_date   || bEnd   >= monthEnd;

          const bar = document.createElement('div');
          bar.className = 'cal-booking-bar' +
            (isStart && isEnd ? ' bar-solo' : isStart ? ' bar-start' : isEnd ? ' bar-end' : '');
          bar.style.cssText = `left:${left}px;top:${top}px;width:${width}px;background:${color};`;
          bar.title = `${b.client_name} (${reg || 'No vehicle'})`;
          bar.addEventListener('click', () => showBookingsForDate(segStartStr, startCell));

          wrapper.appendChild(bar);
        }
      }

      cursor = new Date(segEnd);
      cursor.setDate(cursor.getDate() + 1);
    }
  });
}

// ── PAYMENT STATUS HELPERS ────────────────────────────────────
function paymentStatusBadge(b) {
  const ps = b.payment_status || (b.receipt_number ? 'paid' : 'unpaid');
  if (ps === 'paid')
    return `<span class="badge badge-green" title="${b.receipt_number ? 'RCP: ' + escapeHtml(b.receipt_number) : 'Paid'}">✓ Paid</span>`;
  if (ps === 'partially_paid')
    return `<span class="badge badge-amber">◑ Partial</span>`;
  return `<span class="badge" style="background:#fee2e2;color:var(--red)">✗ Unpaid</span>`;
}
function paymentDotColor(b) {
  if (b.status === 'cancelled') return 'var(--red)';
  const ps = b.payment_status || (b.receipt_number ? 'paid' : 'unpaid');
  if (ps === 'paid')            return 'var(--green)';
  if (ps === 'partially_paid')  return 'var(--amber)';
  return 'var(--orange)';
}

function showBookingsForDate(dateStr, cell) {
  document.querySelectorAll('.cal-day.selected').forEach((el) => el.classList.remove('selected'));
  cell.classList.add('selected');
  const dayBookings = allBookings.filter((b) => dateStr >= b.start_date && dateStr <= b.end_date);
  const container   = document.getElementById('day-bookings');
  if (!dayBookings.length) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">No bookings on ${formatDate(dateStr)}.</p>`;
    return;
  }
  container.innerHTML = dayBookings.map((b) => `
    <div class="booking-item ${b.payment_status === 'paid' || b.receipt_number ? 'booking-paid' : b.payment_status === 'partially_paid' ? 'booking-partial' : 'booking-unpaid'}">
      <div class="booking-dot" style="background:${paymentDotColor(b)}"></div>
      <div class="booking-info">
        <div class="booking-route">${b.client_name} — ${b.tour_reference || b.route || 'Tour Ref TBC'}</div>
        <div class="booking-meta">${b.invoice_no} · ${b.assigned_driver_id || 'Unassigned'} · ${b.is_rented_vehicle ? (b.rented_vehicle_reg || 'Rented vehicle') : (b.assigned_vehicle_reg || 'No vehicle')} · ${paymentStatusBadge(b)}</div>
        ${b.is_rented_vehicle
          ? `<span class="badge badge-amber" title="${b.rented_vehicle_reg || ''}">🚗 Rented${b.rented_vehicle_reg ? ': ' + b.rented_vehicle_reg : ''}</span>`
          : ''}
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
  toggleBookingLockState({ is_locked: false });
  document.getElementById('booking-id').value          = '';
  document.getElementById('booking-invoice').value     = `INV-${Date.now().toString().slice(-6)}`;
  document.getElementById('booking-client').value      = '';
  document.getElementById('booking-tour-reference').value       = '';
  document.getElementById('booking-start-date').value  = '';
  document.getElementById('booking-end-date').value    = '';
  document.getElementById('booking-driver').value      = '';
  document.getElementById('booking-vehicle').value     = '';
  document.getElementById('booking-is-rented').checked = false;
  document.getElementById('rented-vehicle-fields').style.display = 'none';
  document.getElementById('booking-rented-vehicle-select').value = '';
  document.getElementById('booking-rented-reg').value = '';
  document.getElementById('booking-rented-model').value = '';
  document.getElementById('booking-rented-vehicle-id').value = '';
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
  const addInspBtn = document.getElementById('btn-add-inspection');
  if (addInspBtn) addInspBtn.style.display = 'none';
}
function bookingDocumentHref(doc, asAttachment = true) {
  if (doc?.url && !doc?.public_id) return doc.url;
  return '#';
}

function bookingDocumentAttrs(doc) {
  if (!doc?.public_id) return '';
  return `data-public-id="${escapeHtml(doc.public_id)}" data-resource-type="${escapeHtml(doc.resource_type || 'raw')}" data-secure-download="true"`;
}

async function handleSecureDocumentContainerClick(event) {
  const link = event.target.closest('a[data-secure-download="true"]');
  if (!link) return;
  event.preventDefault();
  const signedUrl = await getSignedUrl(link.dataset.publicId, link.dataset.resourceType || 'raw', true);
  if (!signedUrl) return toast('Could not generate secure link', 'error');
  window.open(signedUrl, '_blank', 'noopener');
}

function normalizeItineraryMetadata(itinerary) {
  if (!itinerary) return null;

  let meta = itinerary;
  if (typeof itinerary === 'string') {
    try {
      meta = JSON.parse(itinerary);
    } catch (_) {
      meta = { url: itinerary, filename: 'Itinerary' };
    }
  }

  if (!meta || typeof meta !== 'object') return null;
  if (meta.public_id) return { ...meta, filename: meta.filename || 'Itinerary', resource_type: meta.resource_type || 'raw' };
  if (meta.url) return { ...meta, filename: meta.filename || 'Itinerary' };
  return null;
}

function itineraryLinkAttrs(meta) {
  if (!meta?.public_id) return '';
  return `data-public-id="${escapeHtml(meta.public_id)}" data-resource-type="${escapeHtml(meta.resource_type || 'raw')}" data-itinerary-secure-download="true"`;
}

function renderItineraryLink(itinerary, label = '📋 Itinerary', className = '', style = '') {
  const meta = normalizeItineraryMetadata(itinerary);
  if (!meta) return '';

  const href = meta.public_id ? '#' : meta.url;
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  const styleAttr = style ? ` style="${escapeHtml(style)}"` : '';
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener"${classAttr}${styleAttr} ${itineraryLinkAttrs(meta)}>${escapeHtml(label)}</a>`;
}

async function handleSecureItineraryLinkClick(event) {
  const link = event.target.closest('a[data-itinerary-secure-download="true"]');
  if (!link) return;
  event.preventDefault();
  const signedUrl = await getSignedUrl(link.dataset.publicId, link.dataset.resourceType || 'raw', false);
  if (!signedUrl) return toast('Could not generate secure link', 'error');
  window.open(signedUrl, '_blank', 'noopener');
}

function bindSecureItineraryLinks(container) {
  if (!container || container.dataset.secureItineraryHandlerBound) return;
  container.addEventListener('click', handleSecureItineraryLinkClick);
  container.dataset.secureItineraryHandlerBound = 'true';
}

function renderBookingDocumentsList() {
  const holder = document.getElementById('booking-documents-list');
  if (!holder) return;
  if (!holder.dataset.secureDocHandlerBound) {
    holder.addEventListener('click', handleSecureDocumentContainerClick);
    holder.dataset.secureDocHandlerBound = 'true';
  }
  if (!currentBookingDocuments.length) {
    holder.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem">No documents attached.</div>`;
    return;
  }
  const isAdmin = currentProfile?.role === 'admin';
  const items = currentBookingDocuments.map((d, i) => {
    const docUrl = getDocumentUrl(d);
    const name = d.filename || 'Document';
    const isPdf  = /\.pdf$/i.test(name);
    const isImg  = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
    const isWord = /\.(doc|docx)$/i.test(name);
    const icon   = isPdf ? '📄' : isWord ? '📝' : isImg ? '' : '📎';
    const preview = isImg
      ? `<img src="${docUrl}" loading="lazy" alt="${name}" style="max-height:60px;border-radius:4px;object-fit:cover;flex-shrink:0">`
      : `<span class="doc-preview-icon">${icon}</span>`;
    if (!docUrl) console.error('[renderBookingDocumentsList] Missing document URL', d);
    return `<div class="doc-preview-item">
      ${preview}
      <div class="doc-preview-meta">
        <a href="${docUrl || '#'}" target="_blank" rel="noopener" class="doc-preview-name">${name}</a>
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
  const itinUrl = getDocumentUrl(itinerary);
  if (!itinUrl) { el.innerHTML = ''; return; }
  const isPdf = /\.pdf$/i.test(itinerary?.filename || '');
  el.innerHTML = `<div class="doc-preview-item">
    <span class="doc-preview-icon">${isPdf ? '📄' : '📎'}</span>
    <div class="doc-preview-meta">
      <a href="${itinUrl}" target="_blank" rel="noopener" class="doc-preview-name">${itinerary?.filename || 'Itinerary'}</a>
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
  const isRented = !!data.is_rented_vehicle;
  document.getElementById('booking-is-rented').checked = isRented;
  document.getElementById('rented-vehicle-fields').style.display = isRented ? 'block' : 'none';
  document.getElementById('booking-rented-reg').value   = data.rented_vehicle_reg   || '';
  document.getElementById('booking-rented-model').value = data.rented_vehicle_model || '';
  document.getElementById('booking-rented-vehicle-id').value = data.rented_vehicle_id || '';
  document.getElementById('booking-rented-vehicle-select').value = data.rented_vehicle_id || '';
  document.getElementById('booking-status').value     = data.status;
  const notesInput = getBookingNotesInput();
  if (notesInput) notesInput.value = data.notes || '';
  currentBookingDocuments = Array.isArray(data.booking_documents) ? data.booking_documents : [];
  renderBookingDocumentsList();
  renderItineraryPreview(data.itinerary_url);
  document.getElementById('modal-booking-title').textContent = 'Edit Booking';
  openModal('modal-booking');
  const deleteBtn = document.getElementById('btn-request-delete');
  if (deleteBtn) deleteBtn.style.display = data.is_locked ? 'none' : 'inline-block';
  const addInspBtn = document.getElementById('btn-add-inspection');
  if (addInspBtn) addInspBtn.style.display = 'inline-block';
}

document.getElementById('form-booking')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('booking-id').value;
  const vehicle = document.getElementById('booking-vehicle').value;
  const start = document.getElementById('booking-start-date').value;
  const end = document.getElementById('booking-end-date').value;
  const isRentedBooking = document.getElementById('booking-is-rented').checked;
  if (isRentedBooking && !document.getElementById('booking-rented-reg').value.trim()) {
    toast('Please enter the rented vehicle registration number', 'error');
    return;
  }
  const availability = await validateVehicleAvailability(vehicle, start, end, id || null);
  if (!availability.ok) {
    toast(availability.message, 'error');
    return;
  }

  const driverId = document.getElementById('booking-driver').value;
  if (driverId) {
    const driverAvail = await validateDriverAvailability(driverId, start, end, id || null);
    if (!driverAvail.ok) {
      toast(driverAvail.message, 'error');
      return;
    }
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
    assigned_vehicle_reg: isRentedBooking ? null : (document.getElementById('booking-vehicle').value || null),
    is_rented_vehicle:    isRentedBooking,
    rented_vehicle_id:    document.getElementById('booking-rented-vehicle-id').value || null,
    rented_vehicle_reg:   isRentedBooking ? (document.getElementById('booking-rented-reg').value.trim() || null) : null,
    rented_vehicle_model: isRentedBooking ? (document.getElementById('booking-rented-model').value.trim() || null) : null,
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
        const upload = await uploadToCloudinary(f, 'booking-documents');
        currentBookingDocuments.push({ ...upload, filename: f.name, size: f.size, uploaded_at: new Date().toISOString(), uploaded_by: currentProfile?.id || null });
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
      const itineraryUpload = await uploadToCloudinary(itineraryFile, 'booking-itinerary');
      payload.itinerary_url         = JSON.stringify({ public_id: itineraryUpload.public_id, resource_type: itineraryUpload.resource_type, filename: itineraryFile.name });
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
    const receiptHtml = b.payment_status === 'paid' || b.receipt_number
      ? `<span style="color:var(--green);font-weight:700;font-size:.78rem">✓ ${b.receipt_number || 'Paid'}</span>`
      : b.payment_status === 'partially_paid'
      ? `<span style="color:var(--amber);font-weight:700;font-size:.78rem">◑ Partial</span>`
      : `<span style="color:var(--orange);font-size:.78rem">✗ Unpaid</span>`;
    const alertBtn = !b.maintenance_alert_sent && b.status !== 'cancelled'
      ? `<button class="btn btn-sm" style="background:var(--orange);color:#fff;margin-top:4px" title="Send vehicle return/maintenance alert email" onclick="sendMaintenanceAlertForBooking('${b.id}')">🔔 Alert</button>`
      : b.maintenance_alert_sent ? `<span style="font-size:.73rem;color:var(--green)">✓ Alerted</span>` : '';
    const itineraryLink = renderItineraryLink(b.itinerary_url, '📋 Itinerary', '', 'font-size:.73rem');
    return `<tr>
      <td>${b.invoice_no}<br>${receiptHtml}</td>
      <td>${b.client_name}</td>
      <td style="font-size:.8rem">${b.assigned_driver_id || '—'}</td>
      <td>${b.is_rented_vehicle
        ? `<span class="badge badge-amber">🚗 ${b.rented_vehicle_reg || 'Rented'}</span>`
        : (b.assigned_vehicle_reg || '—')
      }</td>
      <td>${formatDate(b.start_date)}</td>
      <td>${formatDate(b.end_date)}<br>${alertBtn}</td>
      <td>${statusBadge(b.status)}</td>
      <td>${docs.length ? `<span class="badge badge-blue">${docs.length} docs</span>` : '—'}${itineraryLink ? `<br>${itineraryLink}` : ''}</td>
      <td><button class="btn btn-sm btn-outline" onclick="openEditBooking('${b.id}')">View Details</button>${docs.length ? ` <button class="btn btn-sm btn-amber" onclick="downloadBookingDocuments('${b.id}')">Docs</button>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9">No bookings found.</td></tr>`;
  bindSecureItineraryLinks(tbody);
}
async function downloadBookingDocuments(bookingId) {
  const { data } = await sb.from('bookings').select('booking_documents').eq('id', bookingId).single();
  const docs = Array.isArray(data?.booking_documents) ? data.booking_documents : [];
  docs.forEach((d) => {
    const url = getDocumentUrl(d);
    if (!url) { console.error('[downloadBookingDocuments] Missing document URL', d); return; }
    window.open(url, '_blank', 'noopener');
  });
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
    if (payload.is_rented_vehicle && payload.rented_vehicle_id && bookingData?.id) {
      await sb.from('rented_vehicles').update({
        assigned_booking_id: bookingData.id,
        assigned_driver_id:  payload.assigned_driver_id || null,
      }).eq('id', payload.rented_vehicle_id);
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
    if (currentOTPContext?.resourceType === 'booking_delete' && pendingBookingDeleteId) {
      const bId   = pendingBookingDeleteId;
      const reqId = pendingBookingDeleteReqId;
      const rsn   = pendingBookingDeleteReason;
      pendingBookingDeleteId     = null;
      pendingBookingDeleteReqId  = null;
      pendingBookingDeleteReason = null;
      currentOTPContext = null;
      await executeBookingDeletion(bId, reqId, rsn);
    } else if (pendingBookingSave) {
      const { id, payload } = pendingBookingSave;
      pendingBookingSave = null;
      currentOTPContext  = null;
      await performBookingSave(id, payload, null);
    } else if (currentOTPContext?.resourceType === 'recon_edit') {
      await approveReconEditRequest(currentOTPContext.resourceId);
      currentOTPContext = null;
    } else if (currentOTPContext?.resourceType === 'transfer_recon_edit') {
      await approveTransferReconEditRequest(currentOTPContext.resourceId);
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

// ── BOOKING DELETE REQUEST FLOW ───────────────────────────────

function openBookingDeleteRequest() {
  const id = document.getElementById('booking-id').value;
  if (!id) return toast('Save the booking first before requesting deletion', 'error');
  document.getElementById('delete-request-booking-id').value = id;
  document.getElementById('delete-request-reason').value = '';
  document.getElementById('delete-request-type').value = 'mistake';
  closeModal('modal-booking');
  openModal('modal-booking-delete-request');
}
window.openBookingDeleteRequest = openBookingDeleteRequest;

async function submitBookingDeleteRequest() {
  const bookingId = document.getElementById('delete-request-booking-id').value;
  const reason    = document.getElementById('delete-request-reason').value.trim();
  const type      = document.getElementById('delete-request-type').value;

  if (!reason) return toast('Please provide a reason for the deletion request', 'error');

  const btn = document.getElementById('btn-submit-delete-request');
  btn.disabled = true; btn.textContent = 'Sending OTP…';

  try {
    const { data: reqData, error: reqError } = await sb
      .from('booking_delete_requests')
      .insert({
        booking_id:        bookingId,
        requested_by:      currentProfile.id,
        reason,
        cancellation_type: type,
        status:            'pending',
      })
      .select()
      .single();

    if (reqError) throw reqError;

    const res = await fetch(CONFIG.SEND_OTP_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        resource_type:  'booking_delete',
        resource_id:    bookingId,
        admin_id:       currentProfile.id,
        context_label:  'Booking Deletion',
      }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to send OTP');

    closeModal('modal-booking-delete-request');

    const descEl = document.getElementById('otp-modal-desc');
    if (descEl) {
      descEl.textContent =
        `An OTP has been sent to ${CONFIG.ADMIN_EMAIL}. ` +
        `Enter it below to authorize the permanent deletion of this booking.`;
    }
    const codeEl = document.getElementById('otp-input');
    if (codeEl) codeEl.value = '';
    const noticeEl = document.getElementById('otp-attempts-notice');
    if (noticeEl) noticeEl.style.display = 'none';

    pendingBookingDeleteId      = bookingId;
    pendingBookingDeleteReqId   = reqData.id;
    pendingBookingDeleteReason  = reason;
    currentOTPContext = { resourceId: bookingId, resourceType: 'booking_delete' };

    openModal('modal-otp-verify');

  } catch (err) {
    toast('Delete request failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Delete Request & Send OTP';
  }
}
window.submitBookingDeleteRequest = submitBookingDeleteRequest;

let pendingBookingDeleteId     = null;
let pendingBookingDeleteReqId  = null;
let pendingBookingDeleteReason = null;

async function executeBookingDeletion(bookingId, deleteReqId, reason) {
  try {
    const { data: booking } = await sb
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (!booking) { toast('Booking not found', 'error'); return; }

    await sb.from('booking_edit_log').insert({
      booking_id:  bookingId,
      admin_id:    currentProfile?.id,
      action:      'delete',
      reason,
      old_values:  booking,
      approved_at: new Date().toISOString(),
    });

    const { error: delError } = await sb
      .from('bookings')
      .delete()
      .eq('id', bookingId);

    if (delError) throw delError;

    if (deleteReqId) {
      await sb.from('booking_delete_requests').update({
        status:      'approved',
        reviewed_by: currentProfile?.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', deleteReqId);
    }

    toast('Booking permanently deleted', 'success');
    closeModal('modal-otp-verify');
    closeModal('modal-booking');
    await renderCalendar();
    await loadBookingsArchive();
    await loadPendingDeletionsBadge();

  } catch (err) {
    toast('Deletion failed: ' + err.message, 'error');
  }
}
window.executeBookingDeletion = executeBookingDeletion;

// ── PENDING DELETIONS (main admin review) ─────────────────────

async function loadPendingDeletionsBadge() {
  const { count } = await sb
    .from('booking_delete_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  const el   = document.getElementById('stat-pending-deletions');
  const card = document.getElementById('stat-pending-deletions-card');
  if (el)   el.textContent = count ?? 0;
  if (card) card.style.display = (count && count > 0) ? '' : 'none';
}

async function openPendingDeletionsModal() {
  openModal('modal-pending-deletions');
  await loadPendingDeletionsDetail();
}
window.openPendingDeletionsModal = openPendingDeletionsModal;

async function loadPendingDeletionsDetail() {
  const body = document.getElementById('pending-deletions-body');
  if (!body) return;
  body.innerHTML = '<div class="spinner"></div>';

  const { data, error } = await sb
    .from('booking_delete_requests')
    .select(`
      *,
      bookings(invoice_no, client_name, start_date, end_date, status),
      profiles!booking_delete_requests_requested_by_fkey(name)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    body.innerHTML = `<p style="color:var(--red)">${error.message}</p>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <p>No pending deletion requests.</p>
    </div>`;
    return;
  }

  body.innerHTML = data.map((req) => `
    <div class="inspection-item">
      <div style="flex:1;min-width:0">
        <div class="inspection-title">
          ${escapeHtml(req.bookings?.invoice_no ?? req.booking_id)} —
          ${escapeHtml(req.bookings?.client_name ?? '—')}
        </div>
        <div class="inspection-meta">
          Requested by: ${escapeHtml(req.profiles?.name ?? '—')} ·
          ${formatDateTime(req.created_at)}
        </div>
        <div style="font-size:.82rem;margin-top:4px">
          <strong>Type:</strong> ${escapeHtml(req.cancellation_type)} ·
          <strong>Reason:</strong> ${escapeHtml(req.reason)}
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
          Booking: ${formatDate(req.bookings?.start_date)} →
          ${formatDate(req.bookings?.end_date)} ·
          ${statusBadge(req.bookings?.status ?? '—')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-danger"
          onclick="initiateAdminApproveDelete('${req.id}','${req.booking_id}',
            decodeURIComponent('${encodeURIComponent(req.reason)}'))">
          Approve &amp; Delete
        </button>
        <button class="btn btn-sm btn-outline"
          onclick="rejectDeleteRequest('${req.id}')">
          Reject
        </button>
      </div>
    </div>`).join('');
}

async function initiateAdminApproveDelete(reqId, bookingId, reason) {
  try {
    toast('Sending OTP to admin email…', 'info');

    const res = await fetch(CONFIG.SEND_OTP_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        resource_type:  'booking_delete',
        resource_id:    bookingId,
        admin_id:       currentProfile?.id,
        context_label:  'Booking Deletion Approval',
      }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to send OTP');

    const descEl = document.getElementById('otp-modal-desc');
    if (descEl) {
      descEl.textContent =
        `OTP sent to ${CONFIG.ADMIN_EMAIL}. Verify to permanently delete this booking.`;
    }
    const codeEl = document.getElementById('otp-input');
    if (codeEl) codeEl.value = '';
    const noticeEl = document.getElementById('otp-attempts-notice');
    if (noticeEl) noticeEl.style.display = 'none';

    pendingBookingDeleteId     = bookingId;
    pendingBookingDeleteReqId  = reqId;
    pendingBookingDeleteReason = reason;
    currentOTPContext = { resourceId: bookingId, resourceType: 'booking_delete' };

    closeModal('modal-pending-deletions');
    openModal('modal-otp-verify');

  } catch (err) {
    toast('OTP request failed: ' + err.message, 'error');
  }
}
window.initiateAdminApproveDelete = initiateAdminApproveDelete;

async function rejectDeleteRequest(reqId) {
  const reason = prompt('Rejection reason (optional):');
  const { error } = await sb
    .from('booking_delete_requests')
    .update({
      status:           'rejected',
      rejection_reason: reason || null,
      reviewed_by:      currentProfile?.id,
      reviewed_at:      new Date().toISOString(),
    })
    .eq('id', reqId);

  if (error) { toast(error.message, 'error'); return; }

  toast('Deletion request rejected', 'info');
  await loadPendingDeletionsDetail();
  await loadPendingDeletionsBadge();
}
window.rejectDeleteRequest = rejectDeleteRequest;

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
      edit_request_status:           'rejected',
      edit_request_rejection_reason: rejReason || null,
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
      <td>${b.is_rented_vehicle ? `<span class="badge badge-amber">🚗 ${b.rented_vehicle_reg || 'Rented'}</span>` : (b.assigned_vehicle_reg || '—')}</td>
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
      <td>${b.is_rented_vehicle ? `<span class="badge badge-amber">🚗 ${b.rented_vehicle_reg || 'Rented'}</span>` : (b.assigned_vehicle_reg || '—')}</td>
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
          ${insp.is_rented_vehicle
            ? `<span class="badge badge-amber" style="font-size:.7rem">🚗 Rented Vehicle${insp.rented_vehicle_model ? ': ' + insp.rented_vehicle_model : ''}</span> `
            : ''}
          ${faults.length > 0
            ? `<div class="inspection-fault-count">⚠ ${faults.length} fault(s)</div>`
            : '<div style="color:var(--green);font-size:.78rem;margin-top:3px">✓ No faults</div>'}
        </div>
        <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();downloadPDF('${insp.id}')">PDF</button>
      </div>`;
  }).join('');
}

// ── ADMIN INSPECTION SHEET ────────────────────────────────────

const ADMIN_CHECKLIST = {
  'Documents & Compliance': [
    'Tourism Permit','Passenger Liability Insurance','RC1 (NATIS Document)',
    'Cross Border Permit','Licence Disc Valid'
  ],
  'Engine Compartment': [
    'Engine Oil Level','Coolant Level','Brake Fluid',
    'Fan Belts / Tension','Battery Terminals','Leakages (Oil/Water)'
  ],
  'External & Exterior': [
    'Tyre Tread & Pressure','Wheel Nuts Secured','Spare Wheel & Tools',
    'Windscreen & Wipers','Mirrors & Glass','Headlights (High/Low)',
    'Brake & Tail Lights','Indicators (Front/Rear)','Reverse & Plate Lights',
    'Reflectors & Tape','MUD GUARDS','TOW BAR'
  ],
  'Internal / Cab': [
    'Horn & Gauges','Seatbelts / Seats','Air Conditioner / Demister',
    'Steering Play','Footbrake / Handbrake','Interior Cleanliness','Dash Camera'
  ],
  'Safety Gear & Tools': [
    'Fire Extinguisher','Triangle & First Aid','Safety Vest',
    'Spare Wheel + Rim','Jack & Jack Handle','Wheel Spanner',
    'Medic Kit-Green Bag','Roadside Kit - Blue Case'
  ],
  'Communication & Tech': [
    'Headset','PA System','Microphone','Key with Key Ring'
  ]
};

let adminChecklistState = {};
let adminInspMediaFiles = [];

function buildAdminChecklist() {
  const container = document.getElementById('admin-checklist-container');
  if (!container) return;
  adminChecklistState = {};
  container.innerHTML = '';

  Object.entries(ADMIN_CHECKLIST).forEach(([section, items]) => {
    const sec = document.createElement('div');
    sec.className = 'checklist-section';
    sec.innerHTML = `<div class="checklist-section-title">${section}</div>`;
    items.forEach((item) => {
      adminChecklistState[item] = null;
      const row = document.createElement('div');
      row.className = 'checklist-item';
      row.innerHTML = `
        <div class="checklist-label">${item}</div>
        <div class="checklist-buttons">
          <button type="button" class="chk-btn" data-item="${item}" data-value="ok">OK</button>
          <button type="button" class="chk-btn" data-item="${item}" data-value="fault">Fault</button>
        </div>`;
      sec.appendChild(row);
    });
    container.appendChild(sec);
  });

  container.onclick = (e) => {
    const btn = e.target.closest('.chk-btn');
    if (!btn) return;
    const item  = btn.dataset.item;
    const value = btn.dataset.value;
    adminChecklistState[item] = value;
    btn.closest('.checklist-item').querySelectorAll('.chk-btn').forEach((b) => {
      b.classList.toggle('ok',    b.dataset.value === 'ok'    && value === 'ok');
      b.classList.toggle('fault', b.dataset.value === 'fault' && value === 'fault');
    });
    updateAdminFaultSummary();
  };
}

function updateAdminFaultSummary() {
  const faults = Object.entries(adminChecklistState).filter(([, v]) => v === 'fault').map(([k]) => k);
  const el = document.getElementById('admin-fault-summary');
  if (!el) return;
  el.innerHTML = faults.length > 0
    ? `<div class="fault-alert"><div class="fault-icon">⚠</div><div class="fault-text"><strong>${faults.length} fault(s) marked:</strong><br><span style="font-size:.82rem">${escapeHtml(faults.join(' · '))}</span></div></div>`
    : '';
}

async function loadAdminInspections() {
  const container = document.getElementById('admin-inspections-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';

  const vehicleFilter = (document.getElementById('insp-filter-vehicle')?.value || '').trim().toUpperCase();
  const dateFilter    = document.getElementById('insp-filter-date')?.value || '';
  const faultFilter   = document.getElementById('insp-filter-faults')?.checked || false;

  let query = sb.from('inspections')
    .select('*, profiles!inspections_driver_id_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (vehicleFilter) query = query.ilike('vehicle_reg', `%${vehicleFilter}%`);
  if (dateFilter)    query = query.gte('created_at', dateFilter).lte('created_at', `${dateFilter}T23:59:59`);
  if (faultFilter)   query = query.eq('has_critical_fault', true);

  const { data, error } = await query;

  if (error) {
    container.innerHTML = `<p style="color:var(--red)">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data?.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No inspections found.</p></div>`;
    return;
  }

  container.innerHTML = data.map((insp) => {
    const faults = insp.faults_json || [];
    const media  = insp.media_urls  || [];
    return `
      <div class="inspection-item" onclick="openReportDetail('${insp.id}')">
        <div style="flex:1;min-width:0">
          <div class="inspection-title">${escapeHtml(insp.vehicle_reg)} — ${escapeHtml(insp.inspection_type)}</div>
          <div class="inspection-meta">
            ${escapeHtml(insp.profiles?.name || insp.driver_id || '—')} ·
            ${formatDateTime(insp.created_at)} · ${media.length} photo(s)
            ${insp.invoice_no ? ' · <span style="color:var(--navy)">' + escapeHtml(insp.invoice_no) + '</span>' : ''}
          </div>
          ${insp.is_rented_vehicle ? `<span class="badge badge-amber" style="font-size:.7rem">🚗 Rented</span> ` : ''}
          ${faults.length > 0
            ? `<div class="inspection-fault-count">⚠ ${faults.length} fault(s)</div>`
            : '<div style="color:var(--green);font-size:.78rem;margin-top:3px">✓ No faults</div>'}
        </div>
        <button class="btn btn-sm btn-amber"
          onclick="event.stopPropagation();downloadPDF('${insp.id}')">PDF</button>
      </div>`;
  }).join('');
}
window.loadAdminInspections = loadAdminInspections;

async function openAdminInspectionModal(bookingId = null) {
  adminChecklistState = {};
  adminInspMediaFiles = [];

  const form = document.getElementById('form-admin-inspection');
  if (form) form.reset();
  const preview = document.getElementById('admin-insp-media-preview');
  if (preview) preview.innerHTML = '';
  const faultSummary = document.getElementById('admin-fault-summary');
  if (faultSummary) faultSummary.innerHTML = '';
  const invoiceEl = document.getElementById('admin-insp-invoice');
  if (invoiceEl) invoiceEl.value = '';

  // Populate booking dropdown
  const bookingSel = document.getElementById('admin-insp-booking');
  if (bookingSel) {
    const { data: bookings } = await sb.from('bookings')
      .select('id,invoice_no,client_name,assigned_vehicle_reg,assigned_driver_id,is_rented_vehicle,rented_vehicle_reg')
      .not('status', 'eq', 'cancelled')
      .order('start_date', { ascending: false })
      .limit(150);
    bookingSel.innerHTML = '<option value="">— No booking link —</option>';
    (bookings || []).forEach((b) => {
      const opt = document.createElement('option');
      opt.value             = b.id;
      opt.dataset.vehicleReg = b.is_rented_vehicle ? (b.rented_vehicle_reg || '') : (b.assigned_vehicle_reg || '');
      opt.dataset.driverId  = b.assigned_driver_id || '';
      opt.dataset.invoiceNo = b.invoice_no;
      opt.textContent = `${b.invoice_no} — ${b.client_name}`;
      bookingSel.appendChild(opt);
    });
    if (bookingId) {
      bookingSel.value = bookingId;
      _adminInspFillFromBookingSel(bookingSel);
    }
    bookingSel.onchange = () => _adminInspFillFromBookingSel(bookingSel);
  }

  // Populate fleet vehicle dropdown
  const vehicleSel = document.getElementById('admin-insp-vehicle');
  if (vehicleSel) {
    const { data: fleet } = await sb.from('vehicles')
      .select('registration_no,make,model').eq('status', 'active').order('registration_no');
    vehicleSel.innerHTML = '<option value="">— Select fleet vehicle —</option>';
    (fleet || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.registration_no;
      opt.textContent = `${v.registration_no} (${[v.make, v.model].filter(Boolean).join(' ')})`;
      vehicleSel.appendChild(opt);
    });
  }

  buildAdminChecklist();

  const photoInput = document.getElementById('admin-insp-photos');
  if (photoInput) {
    photoInput.onchange = (e) => {
      const prev = document.getElementById('admin-insp-media-preview');
      Array.from(e.target.files).forEach((file) => {
        adminInspMediaFiles.push(file);
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.style.cssText = 'width:80px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border);margin:4px';
        prev.appendChild(img);
      });
    };
  }

  openModal('modal-admin-inspection');
}
window.openAdminInspectionModal = openAdminInspectionModal;

function _adminInspFillFromBookingSel(sel) {
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  const invoiceEl  = document.getElementById('admin-insp-invoice');
  const vehicleSel = document.getElementById('admin-insp-vehicle');
  const manualEl   = document.getElementById('admin-insp-vehicle-manual');
  if (invoiceEl) invoiceEl.value = opt.dataset.invoiceNo || '';
  const reg = opt.dataset.vehicleReg || '';
  if (reg && vehicleSel) {
    const match = Array.from(vehicleSel.options).find(o => o.value === reg);
    if (match) { vehicleSel.value = reg; }
    else if (manualEl) { manualEl.value = reg; }
  }
}

function openAdminInspectionFromBooking() {
  const id = document.getElementById('booking-id').value;
  closeModal('modal-booking');
  openAdminInspectionModal(id || null);
}
window.openAdminInspectionFromBooking = openAdminInspectionFromBooking;

async function adminTriggerFaultAlert({ vehicleReg, driverId, faults, inspectionId }) {
  try {
    const { data, error } = await sb.functions.invoke('fault-alert', {
      body: { vehicle_reg: vehicleReg, driver_id: driverId, faults, inspection_id: inspectionId ?? null }
    });
    if (error) console.error('[admin fault-alert]', error.message);
    else       console.log('[admin fault-alert] success:', data);
  } catch (err) {
    console.error('[admin fault-alert] failed:', err?.message);
  }
}

async function submitAdminInspection() {
  const vehicleSel    = document.getElementById('admin-insp-vehicle');
  const vehicleManual = document.getElementById('admin-insp-vehicle-manual');
  const vehicleReg    = (vehicleSel?.value || vehicleManual?.value || '').trim().toUpperCase();

  if (!vehicleReg) { toast('Please select or enter a vehicle registration', 'error'); return; }
  const inspType = document.getElementById('admin-insp-type')?.value;
  if (!inspType)  { toast('Please select an inspection type', 'error'); return; }

  const mileage   = parseInt(document.getElementById('admin-insp-mileage')?.value) || null;
  const notes     = document.getElementById('admin-insp-notes')?.value.trim() || null;
  const invoiceNo = document.getElementById('admin-insp-invoice')?.value.trim() || null;

  const total   = Object.keys(adminChecklistState).length;
  const checked = Object.values(adminChecklistState).filter(v => v !== null).length;
  if (checked < total && !confirm(`${total - checked} checklist item(s) not marked. Submit anyway?`)) return;

  const faults           = Object.entries(adminChecklistState).filter(([, v]) => v === 'fault').map(([k]) => k);
  const hasCriticalFault = faults.length > 0;

  const btn = document.getElementById('btn-submit-admin-inspection');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const uploadedMedia = [];
    if (adminInspMediaFiles.length) {
      toast('Uploading inspection photos…', 'info');
      for (const file of adminInspMediaFiles) {
        uploadedMedia.push(await uploadToCloudinary(file, 'inspections'));
      }
    }

    const bookingSel = document.getElementById('admin-insp-booking');
    const bookingOpt = bookingSel?.options[bookingSel?.selectedIndex];
    const driverId   = bookingOpt?.dataset?.driverId || null;
    const bookingId  = bookingSel?.value || null;
    const isRented   = !!(vehicleSel && !vehicleSel.value && vehicleManual?.value);

    const payload = {
      vehicle_reg:           vehicleReg,
      is_rented_vehicle:     isRented,
      invoice_no:            invoiceNo,
      driver_id:             driverId,
      inspection_type:       inspType,
      checklist_json:        adminChecklistState,
      faults_json:           faults,
      mileage_at_inspection: mileage,
      notes,
      has_critical_fault:    hasCriticalFault,
      driver_signature:      null,
      client_signature:      null,
      submitted_at:          new Date().toISOString(),
      media_urls:            uploadedMedia,
      pdf_urls:              [],
    };

    const { data: inserted, error } = await sb.from('inspections').insert(payload).select().single();
    if (error) throw error;

    // Link pre/post-trip inspection to booking
    if (bookingId && inserted?.id) {
      const field = inspType === 'pre-trip'  ? 'pre_trip_inspection_id'
                  : inspType === 'post-trip' ? 'post_trip_inspection_id'
                  : null;
      if (field) await sb.from('bookings').update({ [field]: inserted.id }).eq('id', bookingId);
    }

    if (hasCriticalFault) {
      await adminTriggerFaultAlert({
        vehicleReg,
        driverId: driverId || currentProfile?.id,
        faults,
        inspectionId: inserted?.id ?? null,
      });
      toast(`⚠ Inspection saved — ${faults.length} fault(s) detected, alert sent`, 'warning', 6000);
    } else {
      toast('Inspection submitted successfully', 'success');
    }

    closeModal('modal-admin-inspection');
    loadAdminInspections();
    loadReports();
  } catch (err) {
    toast('Submission failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Inspection'; }
  }
}
window.submitAdminInspection = submitAdminInspection;

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
    ${Array.isArray(sheet.slip_image_urls) && sheet.slip_image_urls.length
      ? `<div style="margin-top:16px">
          <strong>Slip Photos (${sheet.slip_image_urls.length})</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));
                     gap:8px;margin-top:10px">
            ${sheet.slip_image_urls.map((img) => {
              const src = img?.url || img;
              return `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">
                <img src="${escapeHtml(src)}" loading="lazy"
                     style="width:100%;height:80px;object-fit:cover;
                            border-radius:8px;border:1px solid var(--border)">
              </a>`;
            }).join('')}
          </div>
        </div>`
      : ''}
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
      <div><strong>Vehicle</strong><p>${insp.vehicle_reg} — ${insp.is_rented_vehicle ? (insp.rented_vehicle_model || 'Rented Vehicle') : `${insp.vehicles?.make||''} ${insp.vehicles?.model||''}`}</p>${insp.is_rented_vehicle ? `<span class="badge badge-amber" style="font-size:.7rem">🚗 Rented Vehicle${insp.rented_vehicle_model ? ': ' + insp.rented_vehicle_model : ''}</span>` : ''}</div>
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
          ${media.map((item, index) => {
            const legacyUrl = typeof item === 'string' ? item : item?.url;
            const publicId = typeof item === 'object' ? item?.public_id : null;
            const resourceType = (typeof item === 'object' ? item?.resource_type : null) || (/\.(mp4|webm|mov)$/i.test(legacyUrl || '') ? 'video' : 'image');
            if (publicId) {
              return resourceType === 'video'
                ? `<div class="media-preview-item"><video src="${SECURE_MEDIA_SPINNER}" controls data-secure-media="true" data-public-id="${escapeHtml(publicId)}" data-resource-type="video"></video></div>`
                : `<div class="media-preview-item"><a href="#" target="_blank" data-secure-media-link="report-media-${index}"><img id="report-media-${index}" src="${SECURE_MEDIA_SPINNER}" alt="media" data-secure-media="true" data-public-id="${escapeHtml(publicId)}" data-resource-type="image"></a></div>`;
            }
            return /\.(mp4|webm|mov)$/i.test(legacyUrl || '')
              ? `<div class="media-preview-item"><video src="${legacyUrl}" controls></video></div>`
              : `<div class="media-preview-item"><a href="${legacyUrl}" target="_blank"><img src="${legacyUrl}" alt="media"></a></div>`;
          }).join('')}
        </div>
      </div>` : ''}
    ${insp.notes ? `<div style="margin-top:12px"><strong>Notes</strong><p style="font-size:.88rem;color:var(--text-muted)">${insp.notes}</p></div>` : ''}
    <div style="margin-top:18px"><button class="btn btn-amber btn-full" onclick="downloadPDF('${insp.id}')">⬇ Download PDF Report</button></div>
  `;
  document.getElementById('report-detail-id').value = id;
  document.querySelectorAll('#report-detail-body [data-secure-media="true"]').forEach((el) => {
    renderSecureMedia(el, el.dataset.publicId, el.dataset.resourceType || 'image').then(() => {
      const link = el.closest('a[data-secure-media-link]');
      if (link && el.src) link.href = el.src;
    });
  });
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
    y += wrapped.length * 5 + 6;
  }

  // ── SIGNATURES ────────────────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 52) { doc.addPage(); y = 20; }

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Signatures', 14, y);
  y += 8;

  const sigTimestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
  const SIG_W  = 80;
  const SIG_H  = 28;
  const GAP    = 14;
  const LEFT_X  = 14;
  const RIGHT_X = LEFT_X + SIG_W + GAP;

  function embedSig(base64, x, label) {
    const sigTop = y;
    try {
      if (!base64 || typeof base64 !== 'string' || base64.length < 100) {
        throw new Error('empty');
      }
      const dataUrl = base64.startsWith('data:')
        ? base64
        : `data:image/png;base64,${base64}`;
      const rawB64 = dataUrl.split(',')[1] || '';
      if (!/^[A-Za-z0-9+/=]+$/.test(rawB64.slice(0, 40))) {
        throw new Error('invalid base64');
      }
      doc.addImage(dataUrl, 'PNG', x, sigTop, SIG_W, SIG_H);
    } catch (err) {
      console.warn(`Signature embed skipped (${label}):`, err.message);
      doc.setDrawColor(180, 180, 180);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, sigTop, SIG_W, SIG_H, 2, 2, 'FD');
      doc.setTextColor(150, 150, 150);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.text('Signature on file', x + SIG_W / 2, sigTop + SIG_H / 2 - 2, { align: 'center' });
      doc.text(sigTimestamp,         x + SIG_W / 2, sigTop + SIG_H / 2 + 4, { align: 'center' });
    }
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.4);
    doc.line(x, sigTop + SIG_H + 2, x + SIG_W, sigTop + SIG_H + 2);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(label, x, sigTop + SIG_H + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Signed: ${sigTimestamp}`, x, sigTop + SIG_H + 12);
  }

  embedSig(insp.driver_signature, LEFT_X,  'Driver Signature');
  embedSig(insp.client_signature, RIGHT_X, 'Client / Manager Signature');
  // ── END SIGNATURES ────────────────────────────────────────────────────────

  doc.save(`INYATHI_Inspection_${insp.vehicle_reg}_${insp.created_at?.split('T')[0]}.pdf`);
  toast('PDF downloaded', 'success');
}


async function validateVehicleAvailability(vehicleReg,startDate,endDate,excludeBookingId=null){
  if(!vehicleReg||!startDate||!endDate) return {ok:true};
  const isRented = document.getElementById('booking-is-rented')?.checked;
  if(isRented) return {ok:true};
  let q=sb.from('bookings').select('id,invoice_no,start_date,end_date,status').eq('assigned_vehicle_reg',vehicleReg).neq('status','cancelled').lte('start_date',endDate).gte('end_date',startDate);
  if(excludeBookingId) q=q.neq('id',excludeBookingId);
  const {data,error}=await q; if(error) return {ok:false,message:error.message};
  if((data||[]).length) return {ok:false,message:`Vehicle already booked (${data[0].invoice_no}) for overlapping dates.`};
  return {ok:true};
}
async function validateDriverAvailability(driverId, startDate, endDate, excludeBookingId = null) {
  if (!driverId || !startDate || !endDate) return { ok: true };
  let q = sb.from('bookings')
    .select('id,invoice_no,start_date,end_date,client_name')
    .eq('assigned_driver_id', driverId)
    .neq('status', 'cancelled')
    .lte('start_date', endDate)
    .gte('end_date', startDate);
  if (excludeBookingId) q = q.neq('id', excludeBookingId);
  const { data, error } = await q;
  if (error) return { ok: false, message: error.message };
  if ((data || []).length) {
    const conflict = data[0];
    return {
      ok: false,
      message: `Driver already assigned to booking ${conflict.invoice_no} (${conflict.client_name}) for overlapping dates (${formatDate(conflict.start_date)} → ${formatDate(conflict.end_date)}).`
    };
  }
  return { ok: true };
}
async function validateBookingCompletion(bookingId){
 const {data,error}=await sb.from('bookings').select('payment_status,pre_trip_inspection_id,post_trip_inspection_id').eq('id',bookingId).single();
 if(error) return {ok:false,message:error.message};
 if(data.payment_status!=='paid') return {ok:false,message:'Payment status must be paid.'};
 if(!data.pre_trip_inspection_id) return {ok:false,message:'Pre-trip inspection required.'};
 if(!data.post_trip_inspection_id) return {ok:false,message:'Post-trip inspection required.'};
 return {ok:true};
}
function toggleBookingLockState(data){
  const locked=!!data?.is_locked;
  document.querySelectorAll('#form-booking input,#form-booking select,#form-booking textarea, #form-booking button[type="submit"]').forEach(el=>{if(el.id!=='btn-mark-complete')el.disabled=locked});
  ['booking-is-rented','booking-rented-reg','booking-rented-model','booking-rented-vehicle-select'].forEach((id)=>{const el=document.getElementById(id); if(el) el.disabled=locked;});
  document.getElementById('booking-lock-notice').style.display=locked?'block':'none';
  document.getElementById('btn-mark-complete').style.display=locked?'none':'inline-block';
}
async function completeBooking(bookingId){ if(currentProfile?.role!=='admin') return toast('Only admins can complete bookings','error'); const v=await validateBookingCompletion(bookingId); if(!v.ok) return toast(v.message,'warning'); const {error}=await sb.from('bookings').update({status:'completed',is_locked:true,completed_by:currentProfile.id,completed_at:new Date().toISOString()}).eq('id',bookingId); if(error) return toast(error.message,'error'); toast('Booking completed and locked','success'); closeModal('modal-booking'); await renderCalendar(); }
document.getElementById('btn-mark-complete')?.addEventListener('click',()=>{const id=document.getElementById('booking-id').value;if(id)completeBooking(id);});
async function loadIncidentReports() {
  const container = document.getElementById('incident-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';

  const { data, error } = await sb
    .from('incident_reports')
    .select('*, profiles!incident_reports_driver_id_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    container.innerHTML = `<p style="color:var(--red)">${error.message}</p>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚨</div>
        <p>No incident reports submitted yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = data.map((inc) => {
    const photos = Array.isArray(inc.photo_urls)    ? inc.photo_urls    : [];
    const docs   = Array.isArray(inc.document_urls) ? inc.document_urls : [];
    return `
      <div class="inspection-item" onclick="openIncidentDetail('${inc.id}')">
        <div style="flex:1;min-width:0">
          <div class="inspection-title">
            ${escapeHtml(inc.vehicle_reg)} —
            ${escapeHtml(inc.incident_type)}
          </div>
          <div class="inspection-meta">
            ${escapeHtml(inc.profiles?.name ?? inc.driver_id)} ·
            ${formatDateTime(inc.created_at)}
            ${inc.injuries
              ? ' · <span style="color:var(--red);font-weight:700">⚠ Injuries</span>'
              : ''}
          </div>
          ${inc.location
            ? `<div style="font-size:.78rem;color:var(--text-muted)">
                📍 ${escapeHtml(inc.location)}
               </div>`
            : ''}
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:3px">
            ${photos.length} photo(s) · ${docs.length} document(s)
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          ${statusBadge(inc.status)}
          <button class="btn btn-sm btn-outline"
            onclick="event.stopPropagation();openIncidentDetail('${inc.id}')">
            View
          </button>
        </div>
      </div>`;
  }).join('');
}

async function openIncidentDetail(id) {
  const { data: inc, error } = await sb
    .from('incident_reports')
    .select('*, profiles!incident_reports_driver_id_fkey(name)')
    .eq('id', id)
    .single();

  if (error || !inc) {
    toast(error?.message || 'Incident not found', 'error');
    return;
  }

  const photos = Array.isArray(inc.photo_urls)    ? inc.photo_urls    : [];
  const docs   = Array.isArray(inc.document_urls) ? inc.document_urls : [];

  let photosHtml = '';
  if (photos.length) {
    const photoItems = photos.map((p, i) => {
      if (p.public_id) {
        return `<div class="media-preview-item">
          <img id="inc-photo-${id}-${i}"
            src="/icons/icon-192.png"
            alt="${escapeHtml(p.filename || 'photo')}"
            data-public-id="${escapeHtml(p.public_id)}"
            data-resource-type="${escapeHtml(p.resource_type || 'image')}"
            style="width:100%;height:80px;object-fit:cover;border-radius:8px;
                   border:1px solid var(--border)">
        </div>`;
      }
      return `<div class="media-preview-item">
        <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(p.url)}"
            alt="${escapeHtml(p.filename || 'photo')}"
            style="width:100%;height:80px;object-fit:cover;border-radius:8px">
        </a>
      </div>`;
    }).join('');
    photosHtml = `
      <div style="margin-top:14px">
        <strong>Photos (${photos.length})</strong>
        <div class="media-preview" style="margin-top:8px">${photoItems}</div>
      </div>`;
  }

  let docsHtml = '';
  if (docs.length) {
    const docLinks = docs.map((d) => {
      if (d.public_id) {
        return `<a class="doc-preview-item" style="cursor:pointer"
          href="#"
          onclick="(async(e)=>{
            e.preventDefault();
            const url=await getSignedUrl('${escapeHtml(d.public_id)}',
              '${escapeHtml(d.resource_type||'raw')}',true);
            if(url) window.open(url,'_blank','noopener');
            else toast('Could not generate link','error');
          })(event)">
          <span class="doc-preview-icon">📄</span>
          <div class="doc-preview-meta">
            <span class="doc-preview-name">${escapeHtml(d.filename || 'Document')}</span>
          </div>
        </a>`;
      }
      return `<a class="doc-preview-item" href="${escapeHtml(d.url)}"
        target="_blank" rel="noopener">
        <span class="doc-preview-icon">📄</span>
        <div class="doc-preview-meta">
          <span class="doc-preview-name">${escapeHtml(d.filename || 'Document')}</span>
        </div>
      </a>`;
    }).join('');
    docsHtml = `
      <div style="margin-top:14px">
        <strong>Documents (${docs.length})</strong>
        <div class="doc-preview-list" style="margin-top:8px">${docLinks}</div>
      </div>`;
  }

  document.getElementById('report-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><strong>Vehicle</strong><p>${escapeHtml(inc.vehicle_reg)}</p></div>
      <div><strong>Type</strong><p>${statusBadge(inc.incident_type)}</p></div>
      <div><strong>Driver</strong>
        <p>${escapeHtml(inc.profiles?.name ?? inc.driver_id)}</p></div>
      <div><strong>Date</strong><p>${formatDateTime(inc.created_at)}</p></div>
      <div><strong>Location</strong><p>${escapeHtml(inc.location || '—')}</p></div>
      <div><strong>Injuries</strong>
        <p>${inc.injuries
          ? '<span style="color:var(--red);font-weight:700">⚠ Yes</span>'
          : 'No'}</p></div>
    </div>
    <div style="margin-bottom:12px">
      <strong>Description</strong>
      <p style="font-size:.88rem;margin-top:6px;line-height:1.55">
        ${escapeHtml(inc.description || '—')}
      </p>
    </div>
    ${statusBadge(inc.status)}
    ${photosHtml}
    ${docsHtml}
    <div style="margin-top:18px">
      <div class="form-group">
        <label>Admin Notes</label>
        <textarea id="incident-admin-notes-${inc.id}" class="form-control" rows="3"
          placeholder="Internal notes, follow-up actions…"
        >${escapeHtml(inc.admin_notes || '')}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-amber"
          onclick="saveIncidentAdminNotes('${inc.id}')">
          Save Notes
        </button>
        <select id="incident-status-select-${inc.id}" class="form-control"
          style="max-width:160px">
          <option value="reported"  ${inc.status==='reported'  ?'selected':''}>Reported</option>
          <option value="reviewed"  ${inc.status==='reviewed'  ?'selected':''}>Reviewed</option>
          <option value="closed"    ${inc.status==='closed'    ?'selected':''}>Closed</option>
        </select>
        <button class="btn btn-outline"
          onclick="updateIncidentStatus('${inc.id}')">
          Update Status
        </button>
      </div>
    </div>`;

  document.getElementById('report-detail-id').value = id;
  openModal('modal-report-detail');

  photos.forEach((p, i) => {
    if (!p.public_id) return;
    const imgEl = document.getElementById(`inc-photo-${id}-${i}`);
    if (!imgEl) return;
    renderSecureMedia(imgEl, p.public_id, p.resource_type || 'image')
      .then(() => {
        const link = imgEl.closest('a');
        if (link && imgEl.src) link.href = imgEl.src;
      })
      .catch(console.warn);
  });
}

async function saveIncidentAdminNotes(incidentId) {
  const notes = document.getElementById(`incident-admin-notes-${incidentId}`)?.value || '';
  const { error } = await sb
    .from('incident_reports')
    .update({ admin_notes: notes })
    .eq('id', incidentId);

  if (error) { toast(error.message, 'error'); return; }
  toast('Notes saved', 'success');
}

async function updateIncidentStatus(incidentId) {
  const status = document.getElementById(
    `incident-status-select-${incidentId}`
  )?.value;

  if (!status) return;

  const { error } = await sb
    .from('incident_reports')
    .update({
      status,
      reviewed_by: currentProfile?.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', incidentId);

  if (error) { toast(error.message, 'error'); return; }
  toast(`Status updated to ${status}`, 'success');
  closeModal('modal-report-detail');
  loadIncidentReports();
}

window.openIncidentDetail      = openIncidentDetail;
window.saveIncidentAdminNotes  = saveIncidentAdminNotes;
window.updateIncidentStatus    = updateIncidentStatus;
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

async function loadVehicleChecklists() {
  const { data, error } = await sb
    .from('vehicle_checklists')
    .select('*, profiles!vehicle_checklists_driver_id_fkey(name)')
    .order('checklist_date', { ascending: false })
    .limit(200);
  const list = document.getElementById('checklist-list');
  if (error) { list.innerHTML = `<p style="color:var(--red)">${error.message}</p>`; return; }
  if (!data?.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🛠</div><p>No vehicle checklists submitted yet.</p></div>';
    return;
  }
  list.innerHTML = data.map((c) => {
    const statusColor = c.status === 'completed' ? 'var(--green)' : 'var(--amber)';
    return `
      <div class="inspection-item">
        <div style="flex:1;min-width:0">
          <div class="inspection-title">
            ${escapeHtml(c.vehicle_reg)} · ${escapeHtml(c.checklist_date)}
          </div>
          <div class="inspection-meta">
            ${escapeHtml(c.profiles?.name || c.driver_id)} ·
            <span style="color:${statusColor};font-weight:700">${escapeHtml(c.status)}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm btn-outline"
            onclick="openChecklistDetail('${c.id}')">View</button>
          <button class="btn btn-sm btn-amber"
            onclick="downloadChecklistPDF('${c.id}')">PDF</button>
        </div>
      </div>`;
  }).join('');
}

async function openChecklistDetail(id) {
  const { data: c, error } = await sb
    .from('vehicle_checklists')
    .select('*, profiles!vehicle_checklists_driver_id_fkey(name, driver_id)')
    .eq('id', id)
    .single();
  if (error || !c) { toast(error?.message || 'Not found', 'error'); return; }

  const ITEMS = ['exterior','interior','mechanical','fluids',
                 'tires','brakes','lights','safety_gear'];
  const itemRows = ITEMS.map((key) => {
    const val = c[key] || '—';
    const color = val === 'OK' ? 'var(--green)'
                : val === 'Needs Attention' ? 'var(--red)' : 'var(--text-muted)';
    return `<tr>
      <td style="padding:8px;text-transform:capitalize;font-weight:600">
        ${key.replace('_', ' ')}
      </td>
      <td style="padding:8px;color:${color};font-weight:700">${escapeHtml(val)}</td>
    </tr>`;
  }).join('');

  const pdfLink = c.pdf_url
    ? `<a href="${escapeHtml(c.pdf_url)}" target="_blank" rel="noopener"
           class="btn btn-sm btn-outline">📄 Attached PDF</a>`
    : '';

  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><strong>Vehicle</strong><p>${escapeHtml(c.vehicle_reg)}</p></div>
      <div><strong>Date</strong><p>${formatDate(c.checklist_date)}</p></div>
      <div><strong>Driver</strong>
        <p>${escapeHtml(c.profiles?.name || c.driver_id)}</p></div>
      <div><strong>Status</strong>
        <p>${statusBadge(c.status)}</p></div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.88rem;
                  border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:var(--navy);color:#fff">
          <th style="padding:8px;text-align:left">Item</th>
          <th style="padding:8px;text-align:left">Result</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    ${c.notes ? `<div style="margin-top:12px">
      <strong>Notes</strong>
      <p style="font-size:.88rem;color:var(--text-muted)">${escapeHtml(c.notes)}</p>
    </div>` : ''}
    <div style="display:flex;gap:8px;margin-top:16px">
      ${pdfLink}
      <button class="btn btn-amber btn-full"
        onclick="downloadChecklistPDF('${c.id}')">⬇ Download PDF</button>
    </div>`;

  // Reuse report-detail modal
  document.getElementById('report-detail-body').innerHTML = body;
  document.getElementById('report-detail-id').value = id;
  openModal('modal-report-detail');
}

async function downloadChecklistPDF(id) {
  const { data: c, error } = await sb
    .from('vehicle_checklists')
    .select('*, profiles!vehicle_checklists_driver_id_fkey(name, driver_id)')
    .eq('id', id)
    .single();
  if (error || !c) { toast(error?.message || 'Not found', 'error'); return; }
  toast('Generating checklist PDF…', 'info', 4000);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  // Header
  doc.setFillColor(15, 39, 68);
  doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('INYATHI Vehicle Checklist', 14, 12);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(CONFIG.COMPANY_NAME, 14, 20);
  let y = 36;
  doc.setTextColor(20, 20, 20); doc.setFontSize(10);
  const meta = [
    ['Vehicle', c.vehicle_reg],
    ['Date', c.checklist_date],
    ['Driver', c.profiles?.name || c.driver_id],
    ['Status', c.status],
  ];
  meta.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold'); doc.text(label + ':', 14, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(value || '—'), 60, y);
    y += 7;
  });
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Checklist Items', 14, y); y += 7;
  const ITEMS = ['exterior','interior','mechanical','fluids',
                 'tires','brakes','lights','safety_gear'];
  doc.setFontSize(9.5);
  ITEMS.forEach((key) => {
    const val = c[key] || '—';
    doc.setFont('helvetica', 'bold');
    doc.text(key.charAt(0).toUpperCase() + key.slice(1).replace('_',' ') + ':', 14, y);
    doc.setFont('helvetica', 'normal');
    if (val === 'OK') doc.setTextColor(6, 95, 70);
    else if (val === 'Needs Attention') doc.setTextColor(185, 28, 28);
    else doc.setTextColor(100, 116, 139);
    doc.text(val, 70, y);
    doc.setTextColor(20, 20, 20);
    y += 7;
  });
  if (c.notes) {
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.text('Notes:', 14, y); y += 7;
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(c.notes, W - 28);
    doc.text(lines, 14, y);
  }
  doc.save(`INYATHI_Checklist_${c.vehicle_reg}_${c.checklist_date}.pdf`);
  toast('Checklist PDF downloaded', 'success');
}

window.openChecklistDetail  = openChecklistDetail;
window.downloadChecklistPDF = downloadChecklistPDF;

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
    .select('*, profiles!transfer_recon_sheets_driver_id_fkey(name, driver_id), edit_request_status, edit_request_reason')
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

window.addEventListener('resize', () => {
  if (document.getElementById('tab-calendar')?.classList.contains('active')) {
    requestAnimationFrame(() => renderBookingBars());
  }
});

