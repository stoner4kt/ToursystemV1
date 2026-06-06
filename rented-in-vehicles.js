// ============================================================
//  INYATHI PWA — RENTED-IN VEHICLE DASHBOARD
// ============================================================

let rentedRows = [];

(async () => {
  const session = await initAuth('admin');
  if (!session) return;
  const name = currentProfile?.name || currentUser?.email?.split('@')[0] || 'Admin';
  document.getElementById('admin-name').textContent = name;
  document.getElementById('sidebar-admin-name').textContent = name;
  initSidebar();
  document.getElementById('btn-signout-sidebar')?.addEventListener('click', signOut);
  document.getElementById('btn-add-rented')?.addEventListener('click', openAddRentedVehicle);
  document.getElementById('btn-confirm-assign-rented')?.addEventListener('click', confirmAssignRentedVehicleToBooking);
  await loadRentedVehicles();
})();

async function loadRentedVehicles() {
  const tbody = document.getElementById('rented-tbody');
  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner"></div></td></tr>`;
  const { data, error } = await sb
    .from('rented_vehicles')
    .select(`
      *,
      bookings!rented_vehicles_assigned_booking_id_fkey(
        id, invoice_no, client_name, start_date, end_date
      ),
      profiles!rented_vehicles_assigned_driver_id_fkey(
        name, driver_id
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red)">${error.message}</td></tr>`;
    return;
  }

  rentedRows = data || [];
  renderRentedRows();
  loadRentedStats();
}

function renderRentedRows() {
  const tbody = document.getElementById('rented-tbody');
  if (!rentedRows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🚗</div><p>No rented vehicles recorded yet.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rentedRows.map((row) => {
    const model = [row.make, row.model].filter(Boolean).join(' ');
    const bookingCell = row.bookings
      ? `<strong>${row.bookings.invoice_no}</strong><br>
         <span style="font-size:.75rem;color:var(--text-muted)">${row.bookings.client_name || ''}</span><br>
         <span style="font-size:.73rem;color:var(--text-muted)">${formatDate(row.bookings.start_date)} → ${formatDate(row.bookings.end_date)}</span>`
      : '<span style="color:var(--text-muted)">—</span>';
    const driverCell = row.profiles
      ? `${row.profiles.name}<br><span style="font-size:.75rem;color:var(--text-muted)">${row.profiles.driver_id}</span>`
      : '<span style="color:var(--text-muted)">—</span>';
    return `<tr>
      <td>${row.supplier || '—'}${row.supplier_ref ? `<br><span style="font-size:.75rem;color:var(--text-muted)">${row.supplier_ref}</span>` : ''}</td>
      <td><strong>${row.reg_no}</strong><br><span style="font-size:.78rem;color:var(--text-muted)">${model || '—'}</span></td>
      <td>${formatDate(row.start_date)} → ${formatDate(row.end_date)}</td>
      <td>${row.daily_rate ? 'R ' + Number(row.daily_rate).toFixed(2) : '—'}</td>
      <td>${statusBadge(row.status || 'active')}</td>
      <td>${bookingCell}</td>
      <td>${driverCell}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openEditRentedVehicle('${row.id}')">Edit</button>
        ${!row.assigned_booking_id ? `<button class="btn btn-sm btn-outline" onclick="openAssignRentedVehicleToBooking('${row.id}', '${escapeAttr(row.reg_no)}')">Assign to Booking</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function loadRentedStats() {
  const today = new Date().toISOString().split('T')[0];
  const inSeven = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  document.getElementById('rented-stat-active').textContent = rentedRows.filter((r) => r.status === 'active' && r.assigned_booking_id).length;
  document.getElementById('rented-stat-ending').textContent = rentedRows.filter((r) => r.status === 'active' && r.end_date && r.end_date >= today && r.end_date <= inSeven).length;
  document.getElementById('rented-stat-returned').textContent = rentedRows.filter((r) => r.status === 'returned').length;
}

function openAddRentedVehicle() {
  document.getElementById('form-rented-vehicle').reset();
  document.getElementById('rented-id').value = '';
  document.getElementById('rented-status').value = 'active';
  document.getElementById('modal-rented-title').textContent = 'Add Rented Vehicle';
  openModal('modal-rented-vehicle');
}

function openEditRentedVehicle(id) {
  const row = rentedRows.find((r) => r.id === id);
  if (!row) return;
  document.getElementById('rented-id').value = row.id;
  document.getElementById('rented-supplier').value = row.supplier || '';
  document.getElementById('rented-reg').value = row.reg_no || '';
  document.getElementById('rented-make').value = row.make || '';
  document.getElementById('rented-model').value = row.model || '';
  document.getElementById('rented-start').value = row.start_date || '';
  document.getElementById('rented-end').value = row.end_date || '';
  document.getElementById('rented-rate').value = row.daily_rate || '';
  document.getElementById('rented-status').value = row.status || 'active';
  document.getElementById('rented-ref').value = row.supplier_ref || '';
  document.getElementById('rented-notes').value = row.notes || '';
  document.getElementById('modal-rented-title').textContent = 'Edit Rented Vehicle';
  openModal('modal-rented-vehicle');
}

async function openAssignRentedVehicleToBooking(vehicleId, reg) {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('assign-rented-id').value = vehicleId;
  document.getElementById('assign-rented-label').textContent = `Vehicle: ${reg}`;
  const sel = document.getElementById('assign-booking-select');
  sel.innerHTML = '<option value="">Loading bookings…</option>';
  openModal('modal-assign-rented');

  const { data, error } = await sb.from('bookings')
    .select('id, invoice_no, client_name, start_date, end_date, assigned_driver_id, is_rented_vehicle, rented_vehicle_id')
    .neq('status', 'cancelled')
    .gte('end_date', today)
    .order('start_date', { ascending: true });
  if (error) {
    sel.innerHTML = `<option value="">${error.message}</option>`;
    return;
  }
  const bookings = (data || []).filter((b) => !b.is_rented_vehicle || !b.rented_vehicle_id);
  sel.innerHTML = '<option value="">— Select booking —</option>';
  bookings.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.dataset.driverId = b.assigned_driver_id || '';
    opt.textContent = `${b.invoice_no} — ${b.client_name || 'Client TBC'} (${formatDate(b.start_date)} → ${formatDate(b.end_date)})`;
    sel.appendChild(opt);
  });
}

async function confirmAssignRentedVehicleToBooking() {
  const vehicleId = document.getElementById('assign-rented-id').value;
  const bookingSelect = document.getElementById('assign-booking-select');
  const bookingId = bookingSelect.value;
  if (!vehicleId || !bookingId) return toast('Please select a booking', 'error');
  const vehicle = rentedRows.find((r) => r.id === vehicleId);
  const selected = bookingSelect.options[bookingSelect.selectedIndex];
  const driverId = selected?.dataset.driverId || null;
  const model = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ');

  const { error: bookingError } = await sb.from('bookings').update({
    is_rented_vehicle: true,
    rented_vehicle_id: vehicleId,
    rented_vehicle_reg: vehicle?.reg_no || null,
    rented_vehicle_model: model || null,
  }).eq('id', bookingId);
  if (bookingError) return toast(bookingError.message, 'error');

  const { error: vehicleError } = await sb.from('rented_vehicles').update({
    assigned_booking_id: bookingId,
    assigned_driver_id: driverId,
  }).eq('id', vehicleId);
  if (vehicleError) return toast(vehicleError.message, 'error');

  toast('Rented vehicle assigned to booking', 'success');
  closeModal('modal-assign-rented');
  await loadRentedVehicles();
}

document.getElementById('form-rented-vehicle')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('rented-id').value;
  const payload = {
    supplier: document.getElementById('rented-supplier').value.trim(),
    reg_no: document.getElementById('rented-reg').value.trim(),
    make: document.getElementById('rented-make').value.trim() || null,
    model: document.getElementById('rented-model').value.trim() || null,
    start_date: document.getElementById('rented-start').value || null,
    end_date: document.getElementById('rented-end').value || null,
    daily_rate: document.getElementById('rented-rate').value || null,
    supplier_ref: document.getElementById('rented-ref').value.trim() || null,
    status: document.getElementById('rented-status').value,
    notes: document.getElementById('rented-notes').value.trim() || null,
  };
  const q = id ? sb.from('rented_vehicles').update(payload).eq('id', id) : sb.from('rented_vehicles').insert(payload);
  const { error } = await q;
  if (error) return toast(error.message, 'error');
  toast(id ? 'Rented vehicle updated' : 'Rented vehicle added', 'success');
  closeModal('modal-rented-vehicle');
  await loadRentedVehicles();
});

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.openEditRentedVehicle = openEditRentedVehicle;
window.openAssignRentedVehicleToBooking = openAssignRentedVehicleToBooking;
