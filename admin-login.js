const { createClient } = supabase;
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const form         = document.getElementById('admin-login-form');
const emailInput   = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton  = document.getElementById('btn-login');
const msg          = document.getElementById('msg');

form.addEventListener('submit', onLoginSubmit);

async function onLoginSubmit(event) {
  event.preventDefault();
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) return showMessage('Please enter both email and password.', 'error');

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';
  showMessage('', '');

  try {
    await sb.auth.signOut();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showMessage(error.message || 'Login failed. Please check your credentials.', 'error');

    const userId = data?.user?.id;
    if (!userId) return showMessage('Login failed: no user session returned.', 'error');

    const { data: profile, error: profileError } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle();

    const metadataRole = data?.user?.app_metadata?.role || data?.user?.user_metadata?.role;
    const isConfiguredAdminEmail = Boolean(CONFIG.ADMIN_EMAIL) && email.toLowerCase() === String(CONFIG.ADMIN_EMAIL).toLowerCase();
    const isAdmin = profile?.role === 'admin' || metadataRole === 'admin' || isConfiguredAdminEmail;

    if (profileError && !isAdmin) {
      await sb.auth.signOut();
      return showMessage(`Unable to verify admin role (${profileError.message}).`, 'error');
    }
    if (!isAdmin) {
      await sb.auth.signOut();
      return showMessage('Access denied: this account is not an admin.', 'error');
    }

    showMessage('Login successful. Redirecting…', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 800);
  } catch (err) {
    showMessage(err?.message || 'Unexpected error during login.', 'error');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign In';
  }
}

function showMessage(text, type) {
  if (!text) { msg.className = 'login-msg'; msg.textContent = ''; return; }
  msg.textContent = text;
  msg.className   = `login-msg ${type}`;
}
