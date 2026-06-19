// ============================================================
//  INYATHI PWA — DRIVER DASHBOARD LOGIC
// ============================================================

(async () => {
  const session = await initAuth('driver');
  if (!session) return;

  const name = currentProfile?.name || 'Driver';
  const headerName   = document.getElementById('driver-name-header');
  const sidebarName  = document.getElementById('sidebar-driver-name');
  const reconName    = document.getElementById('recon-driver-name');
  if (headerName)  headerName.textContent  = name;
  if (sidebarName) sidebarName.textContent = name;
  if (reconName)   reconName.value         = name;

  initSidebar();

  document.getElementById('btn-signout')?.addEventListener('click', signOut);

  await loadDriverTasks();

  const hash = location.hash;
  if (hash === '#recon') switchDriverTab('recon');
  else if (hash === '#checklists') switchDriverTab('checklists');
  else if (hash === '#incidents') switchDriverTab('incidents');
  else if (hash === '#documents') switchDriverTab('documents');
  else if (hash === '#fines') switchDriverTab('fines');
  else switchDriverTab('tasks');
})();

// ── TAB NAVIGATION ───────────────────────────────────────────
async function switchDriverTab(target) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

  document.querySelector(`.tab-btn[data-tab="${target}"]`)?.classList.add('active');
  document.getElementById(`tab-${target}`)?.classList.add('active');

  document.querySelectorAll('#app-sidebar .sidebar-nav-link[data-tab]').forEach((l) => l.classList.remove('active'));
  document.querySelector(`#app-sidebar .sidebar-nav-link[data-tab="${target}"]`)?.classList.add('active');
  if(target==='recon') await loadReconHistory();
  if(target==='checklists') await loadDriverChecklists();
  if(target==='incidents') await loadDriverIncidents();
  if(target==='documents') await loadMyDocuments();
  if(target==='transfer-recon') await loadTransferRecon();
  if(target==='fines') await loadDriverFines();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchDriverTab(btn.dataset.tab));
});

function normalizeItineraryMetadata(itinerary) {
  if (!itinerary) return null;

  let meta = itinerary;
  if (typeof itinerary === 'string') {
    try {
      meta = JSON.parse(itinerary);
    } catch (_) {
      meta = { url: itinerary };
    }
  }

  if (!meta || typeof meta !== 'object') return null;
  if (meta.public_id) return { ...meta, resource_type: meta.resource_type || 'raw' };
  if (meta.url) return meta;
  return null;
}

function itineraryLinkAttrs(meta) {
  if (!meta?.public_id) return '';
  return `data-public-id="${escapeHtml(meta.public_id)}" data-resource-type="${escapeHtml(meta.resource_type || 'raw')}" data-itinerary-secure-download="true"`;
}

function renderItineraryLink(itinerary, label = '📋 View Itinerary', className = '') {
  const meta = normalizeItineraryMetadata(itinerary);
  if (!meta) return '';

  const href = meta.public_id ? '#' : meta.url;
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener"${classAttr} ${itineraryLinkAttrs(meta)}>${escapeHtml(label)}</a>`;
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

// ── DRIVER TASKS ──────────────────────────────────────────────
async function loadDriverTasks() {
  if (!currentProfile?.driver_id) {
    renderNoDriverId();
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: bookings, error } = await sb.from('bookings')
    .select('*')
    .eq('assigned_driver_id', currentProfile.driver_id)
    .order('start_date', { ascending: false });

  if (error) {
    document.getElementById('tasks-upcoming-list').innerHTML = `<p style="color:var(--red)">Error loading tasks: ${error.message}</p>`;
    return;
  }

  const all       = bookings || [];
  const active    = all.filter(b => b.start_date <= today && b.end_date >= today && b.status !== 'cancelled');
  const upcoming  = all.filter(b => b.start_date > today  && b.status !== 'cancelled');
  const completed = all.filter(b => b.status === 'completed' || (b.end_date < today && b.status !== 'cancelled'));

  document.getElementById('task-stat-upcoming').textContent  = upcoming.length;
  document.getElementById('task-stat-active').textContent    = active.length;
  document.getElementById('task-stat-completed').textContent = completed.length;
  document.getElementById('task-stat-total').textContent     = all.length;

  renderTaskList('tasks-active-list',    active,    'No active trips right now.');
  renderTaskList('tasks-upcoming-list',  upcoming,  'No upcoming trips assigned.');
  renderTaskList('tasks-completed-list', completed.slice(0, 10), 'No completed trips yet.');
}

function renderNoDriverId() {
  const msg = `<div class="empty-state"><div class="empty-icon">👤</div><p>Your driver profile is not fully set up. Contact your admin.</p></div>`;
  ['tasks-active-list','tasks-upcoming-list','tasks-completed-list'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = msg;
  });
  ['task-stat-upcoming','task-stat-active','task-stat-completed','task-stat-total'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}

function renderTaskList(containerId, bookings, emptyMsg) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!bookings || !bookings.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>${emptyMsg}</p></div>`;
    return;
  }

  bindSecureItineraryLinks(container);
  container.innerHTML = bookings.map((b) => {
    const statusClass = `status-${b.status}`;
    const isActive = b.start_date <= new Date().toISOString().split('T')[0] && b.end_date >= new Date().toISOString().split('T')[0];
    const docs = Array.isArray(b.booking_documents) ? b.booking_documents : [];
    const canViewDocs = b.assigned_driver_id === currentProfile?.driver_id && docs.length > 0;
    const itineraryLink = renderItineraryLink(b.itinerary_url, '📋 View Itinerary', 'btn btn-sm btn-outline');
    return `
      <div class="task-card ${statusClass}">
        <div class="task-row">
          <div class="task-title">${b.client_name}</div>
          ${statusBadge(b.status)}
        </div>
        <div class="task-meta">
          ${b.tour_reference || b.route || 'Tour Ref TBC'}
          · ${b.is_rented_vehicle
              ? `<span class="badge badge-amber" style="font-size:.72rem">🚗 Rented: ${b.rented_vehicle_reg || 'TBC'}</span>`
              : (b.assigned_vehicle_reg || 'Vehicle TBC')}
        </div>
        <div class="task-dates">
          📅 ${formatDate(b.start_date)} → ${formatDate(b.end_date)}
          · Ref: ${b.invoice_no}
        </div>
        ${isActive ? `
          <div style="margin-top:10px">
            <a href="inspection.html" class="btn btn-amber btn-sm">+ Start Inspection</a>
          </div>` : ''}
        ${b.itinerary_url ? `<div style="margin-top:8px"><a href="${b.itinerary_url}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">📋 View Itinerary</a></div>` : ''}
        ${canViewDocs ? `<div style="margin-top:8px"><button type="button" class="btn btn-sm btn-outline" onclick="toggleBookingDocuments('${b.id}')">📄 Documents (${docs.length})</button><div id="task-docs-${b.id}" style="display:none;margin-top:6px">${docs.map((d)=>{const dUrl=getDocumentUrl(d);return `<div><a href="${dUrl||'#'}" target="_blank" rel="noopener">${d.filename||'Document'}</a></div>`;}).join('')}</div></div>` : ''}
        ${b.notes ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">📝 ${b.notes}</div>` : ''}
      </div>`;
  }).join('');
}
function toggleBookingDocuments(bookingId) {
  const el = document.getElementById(`task-docs-${bookingId}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
window.toggleBookingDocuments = toggleBookingDocuments;

// ── RECON SUBMISSION ──────────────────────────────────────────
function getWeekRange(d = new Date()) {
  const date = new Date(d);
  const day  = date.getDay();
  const start = new Date(date);
  start.setDate(date.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

document.getElementById('form-recon')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const range   = getWeekRange();
    const startKm = Number(document.getElementById('recon-start-km').value || 0);
    const endKm   = Number(document.getElementById('recon-end-km').value   || 0);
    const slipFiles = Array.from(
      document.getElementById('recon-slip-photos')?.files || []
    );
    const slipImageUrls = [];
    if (slipFiles.length > 0) {
      toast('Uploading slip photos…', 'info');
      for (const f of slipFiles) {
        const upload = await uploadToCloudinary(f, 'recon-slips');
        slipImageUrls.push({
          url:           upload.url,
          public_id:     upload.public_id,
          resource_type: upload.resource_type,
          filename:      f.name,
          size:          f.size,
          uploaded_at:   new Date().toISOString(),
        });
      }
    }
    const payload = {
      driver_id:        currentProfile.driver_id,
      week_start:       range.start,
      week_end:         range.end,
      tour_reference:   document.getElementById('recon-tour-reference').value.trim(),
      tour_vehicle:     document.getElementById('recon-tour-vehicle').value.trim()   || null,
      vehicle_reg:      document.getElementById('recon-vehicle-reg').value.trim()    || null,
      start_km:         startKm || null,
      end_km:           endKm   || null,
      total_distance_km: endKm > startKm ? (endKm - startKm) : 0,
      cost_lines_text:  document.getElementById('recon-lines').value.trim()          || null,
      slip_image_urls:  slipImageUrls,
      trip_budget:      document.getElementById('recon-trip-budget').value.trim()    || null,
      trip_cost:        document.getElementById('recon-trip-cost').value.trim()      || null,
      driver_food:      document.getElementById('recon-driver-food').value.trim()    || null,
      flights_to:       document.getElementById('recon-flights-to').value.trim()     || null,
      flights_from:     document.getElementById('recon-flights-from').value.trim()   || null,
      driver_rate:      document.getElementById('recon-driver-rate').value.trim()    || null,
      accommodation:    document.getElementById('recon-accommodation').value.trim()  || null,
      total_profit_loss: document.getElementById('recon-profit-loss').value.trim()  || null,
      director_sign_off: document.getElementById('recon-director-signoff').value.trim() || null,
      status:           'submitted',
      submitted_at:     new Date().toISOString(),
    };
    const { data, error } = await sb.from('recon_sheets').insert(payload).select().single();
    if (error) throw error;
    await postToWorkerWebhook(CONFIG.WORKER_RECON_WEBHOOK_URL, data || payload);
    toast('Recon sheet submitted successfully!', 'success');
    e.target.reset();
    document.getElementById('recon-slip-preview').innerHTML = '';
    document.getElementById('recon-driver-name').value = currentProfile?.name || '';
    switchDriverTab('tasks');
  } catch (err) {
    toast(err.message || 'Failed to submit recon sheet', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Recon Sheet';
  }
});

document.getElementById('recon-slip-photos')
  ?.addEventListener('change', (e) => {
    const preview = document.getElementById('recon-slip-preview');
    Array.from(e.target.files).forEach((file) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.cssText =
        'width:100%;height:82px;object-fit:cover;border-radius:10px;border:1px solid var(--border)';
      preview.appendChild(img);
    });
  });

async function loadDriverChecklists(){document.getElementById('checklist-date').value=new Date().toISOString().split('T')[0]; document.getElementById('checklist-items').innerHTML=['exterior','interior','mechanical','fluids','tires','brakes','lights','safety_gear'].map(k=>`<label>${k}<select id="chk-${k}" class="form-control"><option>OK</option><option>Needs Attention</option><option>N/A</option></select></label>`).join(''); const {data:v}=await sb.from('bookings').select('assigned_vehicle_reg').eq('assigned_driver_id',currentProfile.driver_id); const regs=[...new Set((v||[]).map(x=>x.assigned_vehicle_reg).filter(Boolean))]; document.getElementById('checklist-vehicle').innerHTML=regs.map(r=>`<option>${r}</option>`).join(''); const {data}=await sb.from('vehicle_checklists').select('*').eq('driver_id',currentProfile.driver_id).order('checklist_date',{ascending:false}); document.getElementById('checklist-history').innerHTML=(data||[]).map(c=>`<div>${c.checklist_date} · ${c.vehicle_reg} · ${c.status}</div>`).join('');}
document.getElementById('checklist-form')?.addEventListener('submit', async (e)=>{e.preventDefault(); const pdf=document.getElementById('checklist-pdf-input').files[0]; const pdf_url=pdf ? await uploadToCloudinary(pdf,'driver-documents') : null; const payload={vehicle_reg:document.getElementById('checklist-vehicle').value,driver_id:currentProfile.driver_id,checklist_date:document.getElementById('checklist-date').value,exterior:document.getElementById('chk-exterior').value,interior:document.getElementById('chk-interior').value,mechanical:document.getElementById('chk-mechanical').value,fluids:document.getElementById('chk-fluids').value,tires:document.getElementById('chk-tires').value,brakes:document.getElementById('chk-brakes').value,lights:document.getElementById('chk-lights').value,safety_gear:document.getElementById('chk-safety_gear').value,notes:document.getElementById('checklist-notes').value||null,pdf_url,status:'completed'}; const {error}=await sb.from('vehicle_checklists').insert(payload); if(error) return toast(error.message,'error'); toast('Checklist submitted','success'); await loadDriverChecklists();});
async function loadDriverIncidents() {
  const today = new Date().toISOString().split('T')[0];
  const { data: bookings } = await sb
    .from('bookings')
    .select('id, invoice_no, assigned_vehicle_reg, rented_vehicle_reg, is_rented_vehicle')
    .eq('assigned_driver_id', currentProfile.driver_id)
    .order('start_date', { ascending: false })
    .limit(50);

  const sel = document.getElementById('incident-booking');
  if (sel) {
    sel.innerHTML = '<option value="">— Select booking —</option>';
    (bookings || []).forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      const reg = b.is_rented_vehicle
        ? (b.rented_vehicle_reg || 'Rented')
        : (b.assigned_vehicle_reg || '');
      opt.dataset.vehicleReg = reg;
      opt.textContent = `${b.invoice_no}${reg ? ' — ' + reg : ''}`;
      sel.appendChild(opt);
    });
  }

  sel?.addEventListener('change', function () {
    const opt = this.options[this.selectedIndex];
    const regInput = document.getElementById('incident-vehicle-reg');
    if (opt && opt.dataset.vehicleReg && regInput) {
      regInput.value = opt.dataset.vehicleReg;
    }
  });

  document.getElementById('incident-photos')
    ?.addEventListener('change', (e) => {
      const preview = document.getElementById('incident-photo-preview');
      if (!preview) return;
      Array.from(e.target.files).forEach((file) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.style.cssText =
          'width:100%;height:82px;object-fit:cover;border-radius:10px;border:1px solid var(--border)';
        preview.appendChild(img);
      });
    });

  await loadIncidentHistory();
}

async function loadIncidentHistory() {
  const container = document.getElementById('incident-history');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';

  const { data, error } = await sb
    .from('incident_reports')
    .select('*')
    .eq('driver_id', currentProfile.driver_id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    container.innerHTML =
      `<p style="color:var(--red)">${error.message}</p>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No incident reports submitted yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = data.map((inc) => {
    const photos = Array.isArray(inc.photo_urls) ? inc.photo_urls : [];
    const docs   = Array.isArray(inc.document_urls) ? inc.document_urls : [];
    return `
      <div class="inspection-item">
        <div style="flex:1;min-width:0">
          <div class="inspection-title">
            ${escapeHtml(inc.vehicle_reg)} · ${escapeHtml(inc.incident_type)}
          </div>
          <div class="inspection-meta">
            ${formatDateTime(inc.created_at)}
            ${inc.injuries ? ' · ⚠ Injuries reported' : ''}
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
        ${statusBadge(inc.status)}
      </div>`;
  }).join('');
}

document.getElementById('incident-form')
  ?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'Submitting…';

    try {
      const vehicleReg = document.getElementById('incident-vehicle-reg')
        .value.trim().toUpperCase();

      if (!vehicleReg) {
        toast('Vehicle registration is required', 'error');
        return;
      }

      const incidentType = document.getElementById('incident-type').value;
      if (!incidentType) {
        toast('Please select an incident type', 'error');
        return;
      }

      const description = document.getElementById('incident-description').value.trim();
      if (!description) {
        toast('Please describe the incident', 'error');
        return;
      }

      const photoFiles = Array.from(
        document.getElementById('incident-photos')?.files || []
      );
      const photoUrls = [];
      if (photoFiles.length > 0) {
        toast('Uploading incident photos…', 'info');
        for (const f of photoFiles) {
          if (f.size > 10 * 1024 * 1024) {
            toast(`File too large (max 10 MB): ${f.name}`, 'error');
            return;
          }
          const upload = await uploadToCloudinary(f, 'incidents');
          photoUrls.push({
            url:           upload.url,
            public_id:     upload.public_id,
            resource_type: upload.resource_type,
            filename:      f.name,
            size:          f.size,
            uploaded_at:   new Date().toISOString(),
          });
        }
      }

      const docFiles = Array.from(
        document.getElementById('incident-pdf')?.files || []
      );
      const documentUrls = [];
      if (docFiles.length > 0) {
        toast('Uploading supporting documents…', 'info');
        for (const f of docFiles) {
          if (f.size > 10 * 1024 * 1024) {
            toast(`File too large (max 10 MB): ${f.name}`, 'error');
            return;
          }
          const upload = await uploadToCloudinary(f, 'incident-documents');
          documentUrls.push({
            url:           upload.url,
            public_id:     upload.public_id,
            resource_type: upload.resource_type,
            filename:      f.name,
            size:          f.size,
            uploaded_at:   new Date().toISOString(),
          });
        }
      }

      const bookingId = document.getElementById('incident-booking')?.value || null;

      const payload = {
        booking_id:     bookingId || null,
        driver_id:      currentProfile.driver_id,
        vehicle_reg:    vehicleReg,
        incident_type:  incidentType,
        description,
        location:       document.getElementById('incident-location')?.value.trim() || null,
        injuries:       document.getElementById('incident-injuries')?.checked ?? false,
        photo_urls:     photoUrls,
        document_urls:  documentUrls,
        status:         'reported',
      };

      const { error } = await sb.from('incident_reports').insert(payload);
      if (error) throw error;

      toast('Incident report submitted successfully', 'success');

      e.target.reset();
      const preview = document.getElementById('incident-photo-preview');
      if (preview) preview.innerHTML = '';

      await loadIncidentHistory();

    } catch (err) {
      toast('Submission failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Incident Report';
    }
  });
async function loadMyDocuments(){const [i,c,n,r]=await Promise.all([sb.from('inspections').select('id,created_at,pdf_urls').eq('driver_id',currentProfile.driver_id),sb.from('vehicle_checklists').select('id,checklist_date,pdf_url').eq('driver_id',currentProfile.driver_id),sb.from('incident_reports').select('id,incident_date,pdf_url').eq('driver_id',currentProfile.driver_id),sb.from('recon_sheets').select('id,week_start,week_end').eq('driver_id',currentProfile.driver_id)]); const docs=[]; (i.data||[]).forEach(x=>(x.pdf_urls||[]).forEach(u=>docs.push(`<li>Inspection (${x.created_at}) <a href="${u}" target="_blank">PDF</a></li>`))); (c.data||[]).forEach(x=>docs.push(`<li>Checklist ${x.checklist_date} ${x.pdf_url?`<a href="${x.pdf_url}" target="_blank">PDF</a>`:''}</li>`)); (n.data||[]).forEach(x=>docs.push(`<li>Incident ${x.incident_date} ${x.pdf_url?`<a href="${x.pdf_url}" target="_blank">PDF</a>`:''}</li>`)); (r.data||[]).forEach(x=>docs.push(`<li>Recon ${x.week_start} - ${x.week_end}</li>`)); document.getElementById('my-documents-list').innerHTML=`<ul>${docs.join('')}</ul>`;}

// ── TRANSFER RECON ─────────────────────────────────────────────
const TR_DRAFT_KEY = () => `tr_draft_${currentProfile?.driver_id}_${trGetWeekRange().start}`;
let trCurrentSheet = null;
let trIsSubmitted  = false;

function trGetWeekRange(d = new Date()) {
  const date = new Date(d);
  const day  = date.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

async function loadTransferRecon() {
  if (!currentProfile?.driver_id) return;

  const range = trGetWeekRange();
  document.getElementById('tr-driver-name').value = currentProfile?.name || '';
  document.getElementById('tr-week-label').textContent =
    `Week: ${formatDate(range.start)} — ${formatDate(range.end)}`;

  const { data, error } = await sb
    .from('transfer_recon_sheets')
    .select('*')
    .eq('driver_id', currentProfile.driver_id)
    .eq('week_start', range.start)
    .maybeSingle();

  if (error) console.warn('Transfer recon load error:', error.message);

  trCurrentSheet = data || null;
  trIsSubmitted  = data?.status === 'submitted' || data?.status === 'reviewed';

  const statusBadgeEl = document.getElementById('tr-status-badge');
  if (statusBadgeEl) {
    statusBadgeEl.innerHTML = trCurrentSheet
      ? statusBadge(trCurrentSheet.status)
      : '<span class="badge badge-gray">New</span>';
  }

  const submittedNotice = document.getElementById('tr-submitted-notice');
  const addRowBtn       = document.getElementById('tr-add-row-btn');
  const submitWrapper   = document.getElementById('tr-submit-wrapper');
  if (submittedNotice) submittedNotice.style.display = trIsSubmitted ? 'block' : 'none';
  if (addRowBtn)       addRowBtn.style.display       = trIsSubmitted ? 'none'  : '';
  if (submitWrapper)   submitWrapper.style.display    = trIsSubmitted ? 'none'  : '';

  let transfers = [];
  if (trCurrentSheet) {
    transfers = Array.isArray(trCurrentSheet.transfers) ? trCurrentSheet.transfers : [];
  } else {
    try {
      const saved = localStorage.getItem(TR_DRAFT_KEY());
      if (saved) transfers = JSON.parse(saved);
    } catch (_) {}
  }

  if (!transfers.length) transfers = [trEmptyRow()];
  renderTransferRows(transfers);
  await loadTransferReconHistory();
}

function trEmptyRow() {
  return { vehicle_reg: '', vehicle_name: '', transfer_date: '', reference_nr: '', tla_type: '', description: '', notes: '' };
}

function renderTransferRows(rows) {
  const tbody = document.getElementById('tr-table-body');
  if (!tbody) return;
  tbody.innerHTML = rows.map((row, i) => `
    <tr id="tr-row-${i}" style="border-bottom:1px solid var(--border)">
      <td style="padding:4px 4px"><input class="form-control" style="min-width:80px;font-size:.8rem" value="${row.vehicle_reg||''}" ${trIsSubmitted?'readonly':''} oninput="trUpdateRow(${i},'vehicle_reg',this.value)"></td>
      <td style="padding:4px 4px"><input class="form-control" style="min-width:80px;font-size:.8rem" value="${row.vehicle_name||''}" ${trIsSubmitted?'readonly':''} oninput="trUpdateRow(${i},'vehicle_name',this.value)"></td>
      <td style="padding:4px 4px"><input type="date" class="form-control" style="min-width:100px;font-size:.8rem" value="${row.transfer_date||''}" ${trIsSubmitted?'readonly':''} oninput="trUpdateRow(${i},'transfer_date',this.value)"></td>
      <td style="padding:4px 4px"><input class="form-control" style="min-width:120px;font-size:.8rem;font-weight:600" value="${row.reference_nr||''}" ${trIsSubmitted?'readonly':''} placeholder="Required *" oninput="trUpdateRow(${i},'reference_nr',this.value)"></td>
      <td style="padding:4px 4px">
        <select class="form-control" style="min-width:110px;font-size:.8rem" ${trIsSubmitted?'disabled':''} onchange="trUpdateRow(${i},'tla_type',this.value)">
          <option value="">— Select —</option>
          <option value="Tour" ${row.tla_type==='Tour'?'selected':''}>T = Tour</option>
          <option value="Long Transfer" ${row.tla_type==='Long Transfer'?'selected':''}>L = Long Transfer</option>
          <option value="Airport Transfer" ${row.tla_type==='Airport Transfer'?'selected':''}>A = Airport Transfer</option>
        </select>
      </td>
      <td style="padding:4px 4px"><input class="form-control" style="min-width:110px;font-size:.8rem" value="${row.description||''}" ${trIsSubmitted?'readonly':''} oninput="trUpdateRow(${i},'description',this.value)"></td>
      <td style="padding:4px 4px"><input class="form-control" style="min-width:80px;font-size:.8rem" value="${row.notes||''}" ${trIsSubmitted?'readonly':''} oninput="trUpdateRow(${i},'notes',this.value)"></td>
      <td style="padding:4px 4px;text-align:center">
        ${!trIsSubmitted ? `<button type="button" class="btn btn-sm btn-danger" onclick="removeTransferRow(${i})" title="Remove row">✕</button>` : ''}
      </td>
    </tr>`).join('');
}

let _trRows = [];

function trUpdateRow(index, field, value) {
  const tbody = document.getElementById('tr-table-body');
  if (!tbody) return;
  const rows = trCollectRows();
  if (rows[index]) rows[index][field] = value;
  try { localStorage.setItem(TR_DRAFT_KEY(), JSON.stringify(rows)); } catch(_) {}
}

function trCollectRows() {
  const tbody = document.getElementById('tr-table-body');
  if (!tbody) return [];
  const rows = [];
  tbody.querySelectorAll('tr[id^="tr-row-"]').forEach((tr, i) => {
    const inputs  = tr.querySelectorAll('input');
    const selects = tr.querySelectorAll('select');
    rows.push({
      vehicle_reg:   inputs[0]?.value  || '',
      vehicle_name:  inputs[1]?.value  || '',
      transfer_date: inputs[2]?.value  || '',
      reference_nr:  inputs[3]?.value  || '',
      tla_type:      selects[0]?.value || '',
      description:   inputs[4]?.value  || '',
      notes:         inputs[5]?.value  || '',
    });
  });
  return rows;
}

function addTransferRow() {
  const rows = trCollectRows();
  if (rows.length >= 20) return toast('Maximum 20 transfer rows allowed', 'warning');
  rows.push(trEmptyRow());
  renderTransferRows(rows);
  try { localStorage.setItem(TR_DRAFT_KEY(), JSON.stringify(rows)); } catch(_) {}
}
window.addTransferRow = addTransferRow;

function removeTransferRow(index) {
  const rows = trCollectRows();
  if (rows.length <= 1) return toast('At least one transfer row is required', 'warning');
  rows.splice(index, 1);
  renderTransferRows(rows);
  try { localStorage.setItem(TR_DRAFT_KEY(), JSON.stringify(rows)); } catch(_) {}
}
window.removeTransferRow = removeTransferRow;

async function submitTransferRecon() {
  const rows = trCollectRows();
  if (!rows.length) return toast('Add at least one transfer entry', 'error');

  const invalid = rows.filter(r => !r.reference_nr.trim());
  if (invalid.length) return toast('Tour/Transfer Reference Nr is required for every row', 'error');

  const btn = document.getElementById('tr-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const range = trGetWeekRange();
    const payload = {
      driver_id:    currentProfile.driver_id,
      week_start:   range.start,
      week_end:     range.end,
      transfers:    rows,
      status:       'submitted',
      submitted_at: new Date().toISOString(),
    };

    let error;
    if (trCurrentSheet?.id) {
      ({ error } = await sb.from('transfer_recon_sheets').update(payload).eq('id', trCurrentSheet.id));
    } else {
      ({ error } = await sb.from('transfer_recon_sheets').insert(payload));
    }

    if (error) throw error;

    try { localStorage.removeItem(TR_DRAFT_KEY()); } catch(_) {}

    toast('Transfer recon submitted successfully!', 'success');
    await loadTransferRecon();
  } catch (err) {
    toast(err.message || 'Failed to submit', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Transfer Recon'; }
  }
}
window.submitTransferRecon = submitTransferRecon;

// ── RECON EDIT REQUEST (Feature 3) ────────────────────────────
async function loadReconHistory() {
  const container = document.getElementById('recon-history-list');
  if (!container) return;
  const { data, error } = await sb
    .from('recon_sheets')
    .select('id,week_start,week_end,status,submitted_at,edit_request_status,edit_request_reason')
    .eq('driver_id', currentProfile.driver_id)
    .order('week_start', { ascending: false })
    .limit(10);
  if (error) { container.innerHTML = `<p style="color:var(--red)">${error.message}</p>`; return; }
  if (!data?.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No recon sheets submitted yet.</p></div>`; return; }
  container.innerHTML = data.map((s) => {
    const canRequest = s.status === 'submitted' && (!s.edit_request_status || s.edit_request_status === 'none' || s.edit_request_status === 'rejected');
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
        <div class="inspection-meta">Submitted: ${s.submitted_at ? formatDate(s.submitted_at) : '—'}</div>
        ${editRequestBadge ? `<div style="margin-top:4px">${editRequestBadge}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        ${statusBadge(s.status)}
        ${canRequest ? `<button class="btn btn-sm btn-outline" style="font-size:.75rem" onclick="openReconEditRequest('${s.id}')">Request Edit</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openReconEditRequest(reconId) {
  const idEl = document.getElementById('recon-edit-request-id');
  const reasonEl = document.getElementById('recon-edit-reason');
  if (idEl) idEl.value = reconId;
  if (reasonEl) reasonEl.value = '';
  openModal('modal-recon-edit-request');
}

async function submitReconEditRequest() {
  const reconId = document.getElementById('recon-edit-request-id')?.value;
  const reason  = document.getElementById('recon-edit-reason')?.value.trim();
  if (!reconId) return;
  if (!reason) { toast('Please provide a reason for the edit request', 'error'); return; }

  try {
    const { error } = await sb.from('recon_sheets').update({
      edit_request_status:  'pending',
      edit_request_reason:  reason,
      edit_request_sent_at: new Date().toISOString(),
    }).eq('id', reconId).eq('driver_id', currentProfile.driver_id);
    if (error) throw error;
    toast('Edit request submitted — admin will review and approve', 'success');
    closeModal('modal-recon-edit-request');
    await loadReconHistory();
  } catch (err) {
    toast('Failed to submit request: ' + err.message, 'error');
  }
}

window.openReconEditRequest   = openReconEditRequest;
window.submitReconEditRequest = submitReconEditRequest;

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

// ── DRIVER TRAFFIC FINES ─────────────────────────────────────
function driverFineEscapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function driverFineMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? `R ${numeric.toFixed(2)}` : driverFineEscapeHtml(amount);
}

async function loadDriverFines() {
  const container = document.getElementById('driver-fines-list');
  if (!container) return;
  if (!currentProfile?.driver_id) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>Your driver profile is not fully set up. Contact your admin.</p></div>';
    return;
  }

  container.innerHTML = '<div class="spinner"></div>';
  const { data, error } = await sb
    .from('traffic_fines')
    .select('*, bookings!traffic_fines_booking_id_fkey(invoice_no,client_name,tour_reference,start_date,end_date)')
    .eq('driver_id', currentProfile.driver_id)
    .order('fine_timestamp', { ascending: false });

  if (error) {
    container.innerHTML = `<p style="color:var(--red)">Unable to load fines: ${driverFineEscapeHtml(error.message)}</p>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>No traffic fines have been logged to your profile.</p></div>';
    return;
  }

  container.innerHTML = data.map((fine) => `
    <div class="task-card">
      <div class="task-row">
        <div class="task-title">${driverFineEscapeHtml(fine.fine_reference || 'Traffic Fine')}</div>
        ${fine.email_sent ? '<span class="badge badge-green">Email Sent</span>' : '<span class="badge badge-amber">Logged</span>'}
      </div>
      <div class="task-meta">${driverFineEscapeHtml(fine.vehicle_reg)} · ${formatDateTime(fine.fine_timestamp)} · ${driverFineMoney(fine.amount)}</div>
      <div class="task-dates">Booking: ${driverFineEscapeHtml(fine.bookings?.invoice_no || fine.booking_id)} · ${driverFineEscapeHtml(fine.bookings?.client_name || '—')}</div>
      ${fine.location ? `<div style="font-size:.82rem;margin-top:6px">📍 ${driverFineEscapeHtml(fine.location)}</div>` : ''}
      ${fine.description ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">📝 ${driverFineEscapeHtml(fine.description)}</div>` : ''}
    </div>`).join('');
}

window.loadDriverFines = loadDriverFines;
