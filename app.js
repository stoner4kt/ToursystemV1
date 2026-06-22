// ============================================================
//  INYATHI PWA — SHARED UTILITIES & AUTH
// ============================================================

const { createClient } = supabase;
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

let currentUser    = null;
let currentProfile = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function initAuth(requiredRole = null) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = requiredRole === 'admin' ? 'admin-login.html' : 'driver-login.html';
    return null;
  }
  currentUser = session.user;

  const { data: profile } = await sb.from('profiles')
    .select('*').eq('id', currentUser.id).single();

  currentProfile = profile;

  if (requiredRole && profile && profile.role !== requiredRole) {
    window.location.href = profile.role === 'admin' ? 'index.html' : 'driver-dashboard.html';
    return null;
  }

  if (!profile) {
    console.warn('Profile not found in database yet.');
    return { user: currentUser, profile: null };
  }

  return { user: currentUser, profile };
}

async function signOut() {
  const role = currentProfile?.role || 'driver';
  await sb.auth.signOut();
  clearIndexedDB();
  window.location.href = role === 'admin' ? 'admin-login.html' : 'driver-login.html';
}

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_INSPECTIONS') syncPendingInspections();
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });
}

// ── Offline Detection ─────────────────────────────────────────
const offlineBanner = document.getElementById('offline-banner');
function updateOnlineStatus() {
  if (offlineBanner) offlineBanner.classList.toggle('visible', !navigator.onLine);
}
window.addEventListener('online',  () => { updateOnlineStatus(); syncPendingInspections(); });
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ── IndexedDB ─────────────────────────────────────────────────
const DB_NAME    = 'transroute-offline';
const DB_VERSION = 1;
let idb = null;

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    if (idb) return resolve(idb);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending_inspections')) {
        const store = db.createObjectStore('pending_inspections', { keyPath: 'local_id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };
    req.onsuccess = (e) => { idb = e.target.result; resolve(idb); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function saveInspectionOffline(data) {
  const db     = await openIndexedDB();
  const record = { ...data, synced: false, saved_at: new Date().toISOString() };
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('pending_inspections', 'readwrite');
    const req = tx.objectStore('pending_inspections').add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getPendingInspections() {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('pending_inspections', 'readonly');
    const idx = tx.objectStore('pending_inspections').index('synced');
    const req = idx.getAll(false);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function markInspectionSynced(localId) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction('pending_inspections', 'readwrite');
    const store  = tx.objectStore('pending_inspections');
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (rec) { rec.synced = true; store.put(rec); }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function clearIndexedDB() {
  const db = await openIndexedDB();
  const tx = db.transaction('pending_inspections', 'readwrite');
  tx.objectStore('pending_inspections').clear();
}

async function getPendingCount() {
  try { const p = await getPendingInspections(); return p.length; } catch { return 0; }
}

// ── Sync Pending Inspections ──────────────────────────────────
async function syncPendingInspections() {
  if (!navigator.onLine) return;
  try {
    const pending = await getPendingInspections();
    for (const record of pending) {
      const { local_id, synced, saved_at, mediaFiles, ...payload } = record;
      if (mediaFiles && mediaFiles.length > 0) {
        const uploadedUrls = [];
        for (const fileData of mediaFiles) {
          try { uploadedUrls.push(await uploadToCloudinary(fileData.blob, 'inspections')); }
          catch (err) { console.warn('Media upload failed during sync:', err); }
        }
        payload.media_urls = uploadedUrls;
      }
      const { data: syncedData, error } = await sb.from('inspections').insert(payload).select().single();
      if (!error) {
        await markInspectionSynced(local_id);
        if (payload.has_critical_fault) await triggerFaultAlert(payload);
        await postToWorkerWebhook(CONFIG.WORKER_INSPECTIONS_WEBHOOK_URL, syncedData || payload);
      }
    }
    updateSyncBadge();
  } catch (err) { console.warn('Sync error:', err); }
}

async function updateSyncBadge() {
  const count = await getPendingCount();
  document.querySelectorAll('.sync-count').forEach((el) => {
    el.textContent = count;
    el.closest('[data-sync-wrapper]')?.classList.toggle('hidden', count === 0);
  });
}

// ── Cloudinary Helpers ────────────────────────────────────────
/**
 * Safely extract a document URL from any stored format.
 * Handles:
 *   - Correct format: { url: "https://..." }
 *   - Legacy malformed: { "0":"h","1":"t",... } (string spread into object)
 *   - Plain string (direct URL)
 */
function getDocumentUrl(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  if (doc.url) return doc.url;
  // Reconstruct from numeric keys (string-spread bug)
  const numericKeys = Object.keys(doc)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  if (numericKeys.length > 0) return numericKeys.map((k) => doc[k]).join('');
  return '';
}

// ── Cloudinary Upload ─────────────────────────────────────────
const UPLOAD_ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function uploadToCloudinary(file, folder = 'inspections') {
  if (!file) throw new Error('No file provided');

  const fullFolder = folder.startsWith('inyathi/') ? folder : `inyathi/${folder}`;

  if (!UPLOAD_ALLOWED_TYPES.has(file.type)) {
    throw new Error(`File type not allowed: ${file.name || file.type}`);
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new Error(`File exceeds 10MB limit: ${file.name || 'file'}`);
  }

  // Get a signed upload token from the edge function
  let sigData;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const { data, error } = await sb.functions.invoke('sign-upload', {
      body: { folder: fullFolder },
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (error) throw new Error(error.message);
    sigData = data;
  } catch (err) {
    console.error('[uploadToCloudinary] sign-upload failed:', err);
    throw new Error('Could not generate upload signature.');
  }

  if (!sigData?.signature || !sigData?.api_key || !sigData?.timestamp) {
    throw new Error('Upload preset misconfigured.');
  }

  const isRaw = file.type === 'application/pdf' ||
    file.type.includes('word') || file.type.includes('excel') ||
    file.type.includes('spreadsheet') || file.type.includes('ms-excel');
  const resourceType = isRaw ? 'raw' : 'auto';

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', String(sigData.api_key));
      formData.append('timestamp', String(sigData.timestamp));
      formData.append('signature', sigData.signature);
      formData.append('upload_preset', sigData.upload_preset);
      formData.append('folder', sigData.folder);
      // Force public delivery so secure_url is directly accessible (no signed delivery needed)
      formData.append('type', sigData.type || 'upload');

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${sigData.cloud_name}/${resourceType}/upload`,
        { method: 'POST', body: formData },
      );
      const json = await res.json();

      if (!res.ok) {
        const msg = json.error?.message || '';
        console.error(`[uploadToCloudinary] attempt ${attempt} rejected:`, msg);
        if (msg.toLowerCase().includes('preset')) throw new Error('Upload preset misconfigured.');
        throw new Error('Cloudinary upload rejected the file.');
      }

      return {
        url:           json.secure_url,
        public_id:     json.public_id,
        resource_type: resourceType,
      };
    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  throw lastError;
}

// ── Signed URL helper ─────────────────────────────────────────
async function getSignedUrl(publicId, resourceType = 'raw', asAttachment = false) {
  if (!publicId) return null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(CONFIG.GET_SIGNED_URL_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ publicId, resourceType, asAttachment }),
    });
    const data = await res.json().catch((err) => { console.error('[getSignedUrl] JSON parse error:', err); return null; });
    if (!data) return null;
    return data.signedUrl || null;
  } catch (err) {
    console.error('[getSignedUrl] error:', err);
    return null;
  }
}

// ── Fault Alert ───────────────────────────────────────────────
async function triggerFaultAlert(inspection) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    await fetch(CONFIG.FAULT_ALERT_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ vehicle_reg: inspection.vehicle_reg, driver_id: inspection.driver_id, faults: inspection.faults_json, inspection_id: inspection.id }),
    });
  } catch (err) { console.warn('Fault alert failed:', err); }
}

// ── Toast Notifications ───────────────────────────────────────
function toast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Formatting Helpers ────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatMileage(km) {
  if (!km && km !== 0) return '—';
  return km.toLocaleString('en-ZA') + ' km';
}
function statusBadge(status) {
  const map = {
    active: 'badge-green', confirmed: 'badge-green', completed: 'badge-blue',
    pending: 'badge-amber', maintenance: 'badge-amber', invoiced: 'badge-amber',
    submitted: 'badge-blue', reviewed: 'badge-green',
    decommissioned: 'badge-gray', cancelled: 'badge-gray',
    'pre-trip': 'badge-blue', 'post-trip': 'badge-green',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
}

// ── Modal Helpers ─────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
});

// ── Webhook ───────────────────────────────────────────────────
async function postToWorkerWebhook(url, payload) {
  if (!url || url.includes('YOUR_WORKER')) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.WORKER_SHARED_TOKEN || ''}` },
      body: JSON.stringify(payload),
    });
  } catch (err) { console.warn('Worker webhook failed:', err); }
}

// ── Sidebar Toggle ─────────────────────────────────────────────
function initSidebar() {
  const toggleBtn  = document.getElementById('sidebar-toggle');
  const sidebar    = document.getElementById('app-sidebar');
  const overlay    = document.getElementById('sidebar-overlay');
  const closeBtn   = document.getElementById('sidebar-close');

  if (!toggleBtn || !sidebar) return;

  const storageKey = `${location.pathname}-sidebar-open`;
  function persistState(isOpen) {
    try { localStorage.setItem(storageKey, isOpen ? '1' : '0'); } catch (_) {}
  }
  function openSidebar()  { sidebar.classList.add('open'); overlay?.classList.add('open'); persistState(true); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay?.classList.remove('open'); persistState(false); }

  toggleBtn.addEventListener('click', openSidebar);
  closeBtn?.addEventListener('click', closeSidebar);
  overlay?.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('.sidebar-nav-link').forEach((link) => {
    link.addEventListener('click', () => { if (!link.dataset.keepOpen) closeSidebar(); });
  });

  const desktopView = window.matchMedia('(min-width: 1025px)').matches;
  if (desktopView) openSidebar();
  else {
    const remembered = (() => { try { return localStorage.getItem(storageKey) === '1'; } catch (_) { return false; } })();
    if (remembered) openSidebar();
  }
}

document.addEventListener('click', (event) => {
  const tabButton = event.target.closest('.tab-btn,[data-tab]');
  if (!tabButton) return;
  const label = (tabButton.textContent || '').trim().replace(/\s+/g, ' ');
  const adminCtx = document.getElementById('context-tab-label');
  const driverCtx = document.getElementById('driver-context-tab-label');
  if (adminCtx && label) adminCtx.textContent = label;
  if (driverCtx && label) driverCtx.textContent = label;
});
