const { createClient } = supabase;
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const AUTH_TIMEOUT_MS = 15000;
const form         = document.getElementById('admin-login-form');
const emailInput   = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton  = document.getElementById('btn-login');
const msg          = document.getElementById('msg');

form.addEventListener('submit', onLoginSubmit);

async function onLoginSubmit(event) {
  event.preventDefault();
  const email    = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  if (!email || !password) return showMessage('Please enter both email and password.', 'error');

  setLoading(true, 'Signing in…');
  showMessage('', '');

  try {
    const { data, error } = await withTimeout(
      sb.auth.signInWithPassword({ email, password }),
      'Login is taking too long. Please check your connection and try again.'
    );
    if (error) throw error;

    const userId = data?.user?.id;
    if (!userId) throw new Error('Login failed: no user session returned.');

    const { data: profile, error: profileError } = await withTimeout(
      sb.from('profiles').select('role').eq('id', userId).maybeSingle(),
      'Login succeeded, but role verification timed out. Please try again.'
    );

    const metadataRole = data?.user?.app_metadata?.role || data?.user?.user_metadata?.role;
    const isConfiguredAdminEmail = Boolean(CONFIG.ADMIN_EMAIL) && email === String(CONFIG.ADMIN_EMAIL).toLowerCase();
    const isAdmin = profile?.role === 'admin' || metadataRole === 'admin' || isConfiguredAdminEmail;

    if (profileError && !isAdmin) {
      await signOutLocalOnly();
      throw new Error(`Unable to verify admin role (${profileError.message}).`);
    }
    if (!isAdmin) {
      await signOutLocalOnly();
      throw new Error('Access denied: this account is not an admin.');
    }

    showMessage('Login successful. Redirecting…', 'success');
    window.location.assign('index.html');
  } catch (err) {
    showMessage(err?.message || 'Unexpected error during login.', 'error');
    setLoading(false);
  }
}

async function signOutLocalOnly() {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { console.warn('Local sign out failed:', err); }
}

function withTimeout(promise, timeoutMessage) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), AUTH_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function setLoading(isLoading, text = 'Sign In') {
  loginButton.disabled = isLoading;
  loginButton.textContent = text;
}

function showMessage(text, type) {
  if (!text) { msg.className = 'login-msg'; msg.textContent = ''; return; }
  msg.textContent = text;
  msg.className   = `login-msg ${type}`;
}
