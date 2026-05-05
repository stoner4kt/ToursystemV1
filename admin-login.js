const { createClient } = supabase;
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const form = document.getElementById('admin-login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('btn-login');
const forgotPasswordButton = document.getElementById('btn-forgot-password');
const msg = document.getElementById('msg');

form.addEventListener('submit', onLoginSubmit);
forgotPasswordButton.addEventListener('click', onForgotPassword);

async function onLoginSubmit(event) {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage('Please enter both email and password.', 'error');
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';
  showMessage('', '');

  try {
    // Clear any stale driver/admin session before a fresh admin login.
    await sb.auth.signOut();

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showMessage(error.message || 'Login failed. Please check your credentials.', 'error');
      return;
    }

    const userId = data?.user?.id;
    if (!userId) {
      showMessage('Login failed: no user session returned.', 'error');
      return;
    }

    const { data: profile, error: profileError } = await sb
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError) {
      await sb.auth.signOut();
      showMessage('Unable to verify admin role. Please contact support.', 'error');
      return;
    }

    if (profile?.role !== 'admin') {
      await sb.auth.signOut();
      showMessage('Access denied: this page is for admin users only.', 'error');
      return;
    }

    showMessage('Login successful. Redirecting to dashboard…', 'success');
    window.location.href = 'index.html';
  } catch (err) {
    showMessage(err?.message || 'Unexpected error during login.', 'error');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Login';
  }
}

async function onForgotPassword() {
  const promptedEmail = window.prompt('Enter your admin email for password reset:', emailInput.value.trim());
  const email = (promptedEmail || '').trim();

  if (!email) {
    showMessage('Password reset cancelled: no email entered.', 'error');
    return;
  }

  forgotPasswordButton.disabled = true;

  try {
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) {
      showMessage(error.message || 'Failed to send password reset email.', 'error');
      return;
    }

    showMessage('Password reset email sent. Check your inbox.', 'success');
  } catch (err) {
    showMessage(err?.message || 'Unexpected error while requesting password reset.', 'error');
  } finally {
    forgotPasswordButton.disabled = false;
  }
}

function showMessage(text, type) {
  if (!text) {
    msg.className = '';
    msg.style.display = 'none';
    msg.textContent = '';
    return;
  }

  msg.textContent = text;
  msg.className = type;
  msg.style.display = 'block';
}
