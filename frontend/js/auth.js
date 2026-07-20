// Cloudflare tunsetile integration for login and registration forms

let loginTurnstileToken = '';
let registerTurnstileToken = '';

window.onLoginTurnstile = (t) => { loginTurnstileToken = t; };
window.onRegisterTurnstile = (t) => { registerTurnstileToken = t; };

// ──────────────────────────────────────────────
// TAB SWITCHING
// ──────────────────────────────────────────────
function switchTab(tab) {
  // Hide all panels
  document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  hideAlert();

  if (tab === 'login') {
    document.getElementById('loginPanel').classList.add('active');
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
  } else {
    document.getElementById('registerPanel').classList.add('active');
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
  }
}

// ──────────────────────────────────────────────
// SHOW / HIDE PASSWORD
// ──────────────────────────────────────────────
function togglePwd(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector('i');

  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
}

// ──────────────────────────────────────────────
// ALERTS
// ──────────────────────────────────────────────
function showAlert(msg, type = 'error') {
  const box = document.getElementById('authAlert');
  if (!box) return;
  box.textContent = msg;
  box.className = 'alert ' + type;
  box.style.display = 'block';
}

function hideAlert() {
  const box = document.getElementById('authAlert');
  if (!box) return;
}

// ──────────────────────────────────────────────
// LOGIN HANDLER
// This sends a request to the backend API.
// For now it checks localStorage (demo mode).
// ──────────────────────────────────────────────
async function handleLogin() {
  const businessEl = document.getElementById('loginBusiness');
  const passwordEl = document.getElementById('loginPassword');
  const btn = document.getElementById('loginBtn');

  if (!businessEl || !passwordEl || !btn) return;

  const business = businessEl.value.trim();
  const password = passwordEl.value;

  hideAlert();

  // Normal form validation
  if (!business || !password) {
    showAlert('Please fill in all fields.');
    return;
  }

  // Turnstile validation
  // On localhost Turnstile never fires its callback (error 300010 — site key
  // not valid for localhost), so loginTurnstileToken stays empty and the form
  // would block forever. Skip the guard in dev; production always enforces it.
  const _isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!loginTurnstileToken && !_isDev) {
    showAlert('Please complete the bot check.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in...';

  try {

    const res = await Auth.login({
      businessName: business,
      password,
      turnstileToken: loginTurnstileToken,
    });

    if (res && res.success) {

      setToken(res.data.token);
      setSession(res.data.user);

      window.location.href = 'dashboard.html';

    } else {

      showAlert(res?.message || 'Invalid business name or password.');

      // Reset Turnstile
      turnstile.reset();
      loginTurnstileToken = '';
    }

  } catch (err) {

    showAlert('Something went wrong. Please try again.');

    // Reset Turnstile
    turnstile.reset();
    loginTurnstileToken = '';

  } finally {

    btn.disabled = false;
    btn.innerHTML = 'Sign In';
  }
}
// ──────────────────────────────────────────────
// REGISTER HANDLER
// ──────────────────────────────────────────────
async function handleRegister() {
  const fullNameEl = document.getElementById('regName');
  const businessNameEl = document.getElementById('regBusiness');
  const emailEl = document.getElementById('regEmail');
  const passwordEl = document.getElementById('regPassword');
  const confirmEl = document.getElementById('regConfirm');
  const btn = document.getElementById('registerBtn');

  if (!fullNameEl || !businessNameEl || !emailEl || !passwordEl || !confirmEl || !btn) return;

  const fullName = fullNameEl.value.trim();
  const businessName = businessNameEl.value.trim();
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  const confirm = confirmEl.value;

  hideAlert();

  if (!fullName || !businessName || !email || !password || !confirm) {
    showAlert('Please fill in all fields.');
    return;
  }

  if (!email.includes('@')) {
    showAlert('Please enter a valid email address.');
    return;
  }

  if (password.length < 6) {
    showAlert('Password must be at least 6 characters.');
    return;
  }

  if (password !== confirm) {
    showAlert('Passwords do not match.');
    return;
  }

  // ── TURNSTILE CHECK ──
  // Same localhost bypass as handleLogin — see comment there.
  const _isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!registerTurnstileToken && !_isDev) {
    showAlert('Please complete the bot check.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account...';

  try {

    // ── REAL API CALL ──
    const res = await Auth.register({
      fullName,
      businessName,
      email,
      password,
      turnstileToken: registerTurnstileToken,
    });

    if (res && res.success) {

      // Auto-login: backend returns a token on successful registration
      setToken(res.data.token);
      setSession(res.data.user);

      // Reset Turnstile
      turnstile.reset();
      registerTurnstileToken = '';

      window.location.href = 'dashboard.html';

    } else {

      showAlert(res?.message || 'Registration failed. Please try again.');

      // Reset Turnstile
      turnstile.reset();
      registerTurnstileToken = '';
    }

  } catch (err) {

    showAlert('Something went wrong. Please try again.');

    // Reset Turnstile
    turnstile.reset();
    registerTurnstileToken = '';

  } finally {

    btn.disabled = false;
    btn.innerHTML = 'Create Account';
  }
}

// ── If already logged in, skip to dashboard ──
if (getToken()) {
  window.location.href = 'dashboard.html';
}
// Allow Enter key to submit login
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    const loginPanel = document.getElementById('loginPanel');
    const registerPanel = document.getElementById('registerPanel');
    const loginActive = loginPanel?.classList.contains('active');
    if (loginActive) handleLogin();
    else if (registerPanel) handleRegister();
  }
});

// Attach handlers for elements changed to data-attributes
function attachAuthHandlers() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-toggle-pwd]').forEach(btn => {
    btn.addEventListener('click', () => togglePwd(btn.dataset.togglePwd, btn));
  });

  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('registerBtn')?.addEventListener('click', handleRegister);
}

attachAuthHandlers();