// ============================================================
//  TRANSROUTE PWA — FULL INTEGRATED INSPECTION LOGIC
// ============================================================

const CHECKLIST = {
  'Documents & Compliance': [
    'Tourism Permit', 'Passenger Liability Insurance', 'RC1 (NATIS Document)', 
    'Cross Border Permit', 'Licence Disc Valid'
  ],
  'Engine Compartment': [
    'Engine Oil Level', 'Coolant Level', 'Brake Fluid',
    'Fan Belts / Tension', 'Battery Terminals', 'Leakages (Oil/Water)'
  ],
  'External & Exterior': [
    'Tyre Tread & Pressure', 'Wheel Nuts Secured', 'Spare Wheel & Tools',
    'Windscreen & Wipers', 'Mirrors & Glass', 'Headlights (High/Low)', 
    'Brake & Tail Lights', 'Indicators (Front/Rear)', 'Reverse & Plate Lights',
    'Reflectors & Tape', 'MUD GUARDS', 'TOW BAR'
  ],
  'Internal / Cab': [
    'Horn & Gauges', 'Seatbelts / Seats', 'Air Conditioner / Demister',
    'Steering Play', 'Footbrake / Handbrake', 'Interior Cleanliness', 'Dash Camera'
  ],
  'Safety Gear & Tools': [
    'Fire Extinguisher', 'Triangle & First Aid', 'Safety Vest',
    'Spare Wheel + Rim', 'Jack & Jack Handle', 'Wheel Spanner', 
    'Medic Kit-Green Bag', 'Roadside Kit - Blue Case'
  ],
  'Communication & Tech': [
    'Headset', 'PA System', 'Microphone', 'Key with Key Ring'
  ]
};

// State
let checklist   = {}; 
let mediaFiles  = []; 
let uploadedUrls = [];
let driverSigPad;
window.inspectionPdfUrls = [];
let clientSigPad;

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


async function triggerFaultAlert({ vehicleReg, driverId, faults, inspectionId }) {
  try {
    const { data, error } = await sb.functions.invoke('fault-alert', {
      body: {
        vehicle_reg: vehicleReg,
        driver_id: driverId,
        faults,
        inspection_id: inspectionId ?? null
      }
    });

    if (error) {
      console.error('[fault-alert] invoke returned error');
      console.error('[fault-alert] message:', error.message);
      console.error('[fault-alert] name:', error.name);
      console.error('[fault-alert] status:', error.status ?? 'n/a');
      console.error('[fault-alert] context:', error.context ?? 'n/a');
      return;
    }

    console.log('[fault-alert] success response:', data);

    if (Array.isArray(data?.recipients)) {
      data.recipients.forEach((r, idx) => {
        console.log(
          `[fault-alert] recipient #${idx + 1}: phone=${r.phone}, ok=${r.ok}, status=${r.status}`,
          r.response
        );
      });
    }
  } catch (err) {
    console.error('[fault-alert] request failed before edge function completed');
    console.error('[fault-alert] raw error object:', err);
    console.error('[fault-alert] diagnostic message:', err?.message ?? 'Unknown error');
    console.error('[fault-alert] diagnostic status:', err?.status ?? err?.context?.status ?? 'n/a');
    console.error('[fault-alert] diagnostic code:', err?.code ?? 'n/a');
  }
}

// ── Form Submission ───────────────────────────────────────────
document.getElementById('form-inspection')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (driverSigPad.isEmpty()) { toast('Please provide a driver signature', 'warning'); return; }
  if (clientSigPad.isEmpty()) { toast('Please provide a client signature', 'warning'); return; }

  const submitBtn = document.getElementById('btn-submit');
  const vehicleReg = document.getElementById('vehicle-select').value;
  const inspType = document.getElementById('insp-type').value;
  const mileage = parseInt(document.getElementById('mileage-input').value) || null;
  const notes = document.getElementById('notes-input').value.trim() || null;

  const checked = getCheckedCount();
  const total = getTotalItems();
  if (checked < total && !confirm(`${total - checked} items skipped. Submit anyway?`)) return;

  const faults = Object.entries(checklist).filter(([, v]) => v === 'fault').map(([k]) => k);
  const hasCriticalFault = faults.length > 0;

  submitBtn.disabled = true;
  submitBtn.innerHTML = 'Submitting...';

  const payload = {
    vehicle_reg: vehicleReg,
    driver_id: currentProfile.driver_id,
    inspection_type: inspType,
    checklist_json: checklist,
    faults_json: faults,
    mileage_at_inspection: mileage,
    notes,
    has_critical_fault: hasCriticalFault,
    driver_signature: driverSigPad.toDataURL(),
    client_signature: clientSigPad.toDataURL(),
    submitted_at: new Date().toISOString(),
    pdf_urls: window.inspectionPdfUrls
  };

  if (!navigator.onLine) {
    await saveInspectionOffline(payload);
    toast('Saved offline — will sync later', 'warning');
    submitBtn.disabled = false; submitBtn.textContent = 'Submit Inspection';
    return;
  }

  const { data: insertedInspection, error } = await sb.from('inspections').insert(payload).select().single();
  if (error) { toast('Error: ' + error.message, 'error'); submitBtn.disabled = false; return; }

  if (hasCriticalFault) {
    await triggerFaultAlert({
      vehicleReg,
      driverId: currentProfile.driver_id,
      faults,
      inspectionId: insertedInspection?.id ?? null
    });

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
  driverSigPad.clear();
  clientSigPad.clear();
  document.getElementById('media-preview-before').innerHTML = '';
  document.getElementById('media-preview-after').innerHTML = '';
  mediaFiles = [];
  buildChecklist();
}

// ── Init ──────────────────────────────────────────────────────
(async () => {
  const session = await initAuth('driver');
  if (!session) return;

  const name = currentProfile?.name || 'Driver';
  const nameEl        = document.getElementById('driver-name');
  const sidebarNameEl = document.getElementById('sidebar-driver-name');
  if (nameEl)        nameEl.textContent        = name;
  if (sidebarNameEl) sidebarNameEl.textContent = name;

  initSidebar();
  document.getElementById('btn-signout-sidebar')?.addEventListener('click', signOut);

  driverSigPad = new SignaturePad(document.getElementById('driver-signature-pad'), { backgroundColor: 'rgb(255,255,255)' });
  clientSigPad = new SignaturePad(document.getElementById('client-signature-pad'), { backgroundColor: 'rgb(255,255,255)' });

  document.getElementById('clear-driver-sig').addEventListener('click', () => driverSigPad.clear());
  document.getElementById('clear-client-sig').addEventListener('click', () => clientSigPad.clear());

  await loadVehicleOptions();
  await loadBookingOptions();
  buildChecklist();
  setupMediaCapture();
  updateSyncBadge();
})();

async function loadBookingOptions() {
  if (!currentProfile?.driver_id) return;
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('bookings')
    .select('id, invoice_no, client_name, route')
    .eq('assigned_driver_id', currentProfile.driver_id)
    .gte('end_date', today)
    .neq('status', 'cancelled')
    .order('start_date');
  const sel = document.getElementById('invoice-select');
  if (!sel || !data?.length) return;
  data.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.invoice_no;
    opt.textContent = `${b.invoice_no} — ${b.client_name}`;
    sel.appendChild(opt);
  });
}

async function uploadPdfToCloudinary(pdfFile){
  if(!pdfFile || pdfFile.type!=='application/pdf') throw new Error('Only PDF files are allowed');
  if(pdfFile.size > 50*1024*1024) throw new Error('PDF exceeds 50MB limit');
  const fd = new FormData();
  fd.append('file', pdfFile);
  fd.append('upload_preset', CONFIG.CLOUDINARY_UPLOAD_PRESET);
  fd.append('folder', 'transroute/inspections');
  fd.append('resource_type', 'raw');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/upload`, { method:'POST', body: fd });
  const json = await res.json();
  if(!res.ok || !json.secure_url) throw new Error(json.error?.message || 'PDF upload failed');
  return json.secure_url;
}
document.getElementById('inspection-pdf-input')?.addEventListener('change', async (e)=>{
 const files=[...(e.target.files||[])];
 for(const f of files){
  try{const url=await uploadPdfToCloudinary(f); window.inspectionPdfUrls.push(url); const a=document.createElement('a'); a.href=url; a.target='_blank'; a.textContent=`📄 ${f.name}`; document.getElementById('pdf-preview').appendChild(a); document.getElementById('pdf-preview').appendChild(document.createElement('br'));}catch(err){toast(err.message,'error');}
 }
});
