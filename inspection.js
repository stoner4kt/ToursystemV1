// ============================================================
//  TRANSROUTE PWA — INSPECTION FORM LOGIC (WITH SIGNATURE)
// ============================================================

const CHECKLIST = {
  'Engine Compartment': [
    'Engine Oil Level', 'Coolant Level', 'Brake Fluid',
    'Fan Belts / Tension', 'Battery Terminals', 'Leakages (Oil/Water)'
  ],
  'External Vehicle': [
    'Tyre Tread & Pressure', 'Wheel Nuts Secured', 'Spare Wheel & Tools',
    'Windscreen & Wipers', 'Mirrors & Glass', 'Licence Disc Valid'
  ],
  'Lights & Electric': [
    'Headlights (High/Low)', 'Indicators (Front/Rear)', 'Brake & Tail Lights',
    'Reverse & Plate Lights', 'Reflectors & Tape'
  ],
  'Internal / Cab': [
    'Horn & Gauges', 'Seatbelts / Seats', 'Air Conditioner / Demister',
    'Steering Play', 'Footbrake / Handbrake'
  ],
  'Safety Gear': [
    'Fire Extinguisher', 'Triangle & First Aid', 'Safety Vest'
  ]
};

// State
let checklist   = {}; 
let mediaFiles  = []; 
let uploadedUrls = [];
let signaturePad;

// ── Build Checklist UI ────────────────────────────────────────
function buildChecklist() {
  const container = document.getElementById('checklist-container');
  container.innerHTML = '';

  Object.entries(CHECKLIST).forEach(([section, items]) => {
    const sec = document.createElement('div');
    sec.className = 'checklist-section';
    sec.innerHTML = `<div class="checklist-section-title">${section}</div>`;

    items.forEach((item) => {
      checklist[item] = null;
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

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.chk-btn');
    if (!btn) return;
    const item  = btn.dataset.item;
    const value = btn.dataset.value;
    checklist[item] = value;
    const row = btn.closest('.checklist-item');
    row.querySelectorAll('.chk-btn').forEach((b) => {
      b.classList.toggle('ok',    b.dataset.value === 'ok'    && value === 'ok');
      b.classList.toggle('fault', b.dataset.value === 'fault' && value === 'fault');
    });
    updateFaultSummary();
  });
}

function updateFaultSummary() {
  const faults = Object.entries(checklist).filter(([, v]) => v === 'fault').map(([k]) => k);
  const el = document.getElementById('fault-summary');
  el.innerHTML = faults.length > 0 ? `<div class="fault-alert"><div class="fault-icon">⚠</div><div class="fault-text"><strong>${faults.length} fault(s) marked:</strong><br><span style="font-size:.82rem">${faults.join(' · ')}</span></div></div>` : '';
  document.getElementById('fault-count-label').textContent = faults.length > 0 ? ` (${faults.length} fault${faults.length !== 1 ? 's' : ''})` : '';
}

function getCheckedCount() { return Object.values(checklist).filter((v) => v !== null).length; }
function getTotalItems() { return Object.keys(checklist).length; }

// ── Media Capture ─────────────────────────────────────────────
function setupMediaCapture() {
  document.querySelectorAll('.capture-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const type  = input.dataset.type;
      Array.from(e.target.files).forEach((file) => addMediaPreview(file, type));
      input.value = ''; 
    });
  });
}

function addMediaPreview(file, type) {
  const isVideo = file.type.startsWith('video/');
  const url = URL.createObjectURL(file);
  mediaFiles.push({ file, preview: url, type });
  const grid = document.getElementById(`media-preview-${type}`);
  const item = document.createElement('div');
  item.className = 'media-preview-item';
  item.innerHTML = isVideo ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt="${type}">`;
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-media'; removeBtn.textContent = '×';
  removeBtn.onclick = () => {
    const idx = mediaFiles.findIndex((m) => m.preview === url);
    if (idx !== -1) mediaFiles.splice(idx, 1);
    item.remove(); URL.revokeObjectURL(url);
  };
  item.appendChild(removeBtn);
  grid.appendChild(item);
}

// ── Load Data ─────────────────────────────────────────────────
async function loadVehicleOptions() {
  const { data } = await sb.from('vehicles').select('registration_no, model, make, current_mileage').eq('status', 'active');
  const sel = document.getElementById('vehicle-select');
  (data || []).forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.registration_no; opt.dataset.mileage = v.current_mileage;
    opt.textContent = `${v.registration_no} (${v.make || ''} ${v.model})`;
    sel.appendChild(opt);
  });
}

// ── Form Submission ───────────────────────────────────────────
document.getElementById('form-inspection')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (signaturePad.isEmpty()) { toast('Please provide a driver signature', 'warning'); return; }

  const submitBtn = document.getElementById('btn-submit');
  const vehicleReg = document.getElementById('vehicle-select').value;
  const inspType = document.getElementById('insp-type').value;
  const mileage = parseInt(document.getElementById('mileage-input').value) || null;
  const notes = document.getElementById('notes-input').value.trim() || null;

  if (!vehicleReg || !inspType) { toast('Please complete required fields', 'warning'); return; }

  const checked = getCheckedCount();
  const total = getTotalItems();
  if (checked < total && !confirm(`${total - checked} items skipped. Submit anyway?`)) return;

  const faults = Object.entries(checklist).filter(([, v]) => v === 'fault').map(([k]) => k);
  const hasCriticalFault = faults.length > 0;

  submitBtn.disabled = true;
  submitBtn.innerHTML = 'Submitting...';

  // Capture signature image
  const signatureData = signaturePad.toDataURL(); 

  const payload = {
    vehicle_reg: vehicleReg,
    driver_id: currentProfile.driver_id,
    inspection_type: inspType,
    checklist_json: checklist,
    faults_json: faults,
    mileage_at_inspection: mileage,
    notes,
    has_critical_fault: hasCriticalFault,
    signature_data: signatureData, // Stores signature as Base64 for PDF export
    submitted_at: new Date().toISOString()
  };

  if (!navigator.onLine) {
    await saveInspectionOffline(payload);
    toast('Saved offline — will sync later', 'warning');
    submitBtn.disabled = false; submitBtn.textContent = 'Submit Inspection';
    return;
  }

  const { data, error } = await sb.from('inspections').insert(payload).select().single();
  if (error) { toast('Error: ' + error.message, 'error'); submitBtn.disabled = false; return; }

  if (hasCriticalFault) {
    const waMsg = encodeURIComponent(`🚨 FAULT ALERT: ${vehicleReg} has ${faults.length} faults. Reported by ${currentProfile.name}.`);
    document.getElementById('wa-alert-link').href = `https://wa.me/${CONFIG.ADMIN_PHONE}?text=${waMsg}`;
    document.getElementById('wa-alert-section').style.display = 'block';
  }

  resetForm();
  document.getElementById('success-section').style.display = 'block';
  document.getElementById('form-inspection').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function resetForm() {
  document.getElementById('form-inspection').reset();
  signaturePad.clear();
  document.getElementById('media-preview-before').innerHTML = '';
  document.getElementById('media-preview-after').innerHTML = '';
  mediaFiles = [];
  buildChecklist();
}

// ── Init ──────────────────────────────────────────────────────
(async () => {
  const session = await initAuth();
  if (!session) return;

  document.getElementById('driver-name').textContent = currentProfile?.name || 'Driver';
  
  // Initialize Signature Pad
  const canvas = document.getElementById('signature-pad');
  signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' });

  document.getElementById('clear-signature').addEventListener('click', () => signaturePad.clear());

  await loadVehicleOptions();
  buildChecklist();
  setupMediaCapture();
})();