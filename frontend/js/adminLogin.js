'use strict';

/* =========================================================
   ADMIN LOGIN MODULE (CSP SAFE + EVENT DELEGATION PATTERN)
   ---------------------------------------------------------
   - No inline onclick usage
   - One global event listener for clicks
   - Action-based routing system
   - Clean separation of UI + logic
========================================================= */


/* =========================================================
   ACTION REGISTRY (like a mini router)
========================================================= */
const AdminActions = {
  adminLogin: handleAdminLogin,
  toggleAdminPwd: toggleAdminPwd,
};


/* =========================================================
   GLOBAL EVENT DELEGATION
   ---------------------------------------------------------
   Instead of attaching multiple event listeners,
   we listen once at document level and route actions.
========================================================= */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;
  const fn = AdminActions[action];

  if (typeof fn === 'function') {
    fn(e, el);
  }
});


/* =========================================================
   ENTER KEY HANDLER (scoped safely)
   ---------------------------------------------------------
   Only triggers on admin page inputs.
   Prevents accidental triggers on other pages.
========================================================= */
document.addEventListener('keydown', (e) => {
  const isAdminPage = document.getElementById('adminUsername');

  if (!isAdminPage) return;

  if (e.key === 'Enter') {
    handleAdminLogin();
  }
});


/* =========================================================
   ADMIN LOGIN FUNCTION
========================================================= */
async function handleAdminLogin() {
  const usernameEl = document.getElementById('adminUsername');
  const pwdEl = document.getElementById('adminPwd');
  const btn = document.getElementById('loginBtn');
  const alertBox = document.getElementById('alert');

  if (!usernameEl || !pwdEl || !btn || !alertBox) return;

  const username = usernameEl.value.trim();
  const pwd = pwdEl.value;

  // Hide previous alert
  alertBox.style.display = 'none';

  // Basic validation
  if (!username || !pwd) {
    showAlert('Please fill in all fields.');
    return;
  }

  // UI loading state
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verifying...';

  try {

    /* ─────────────────────────────────────────────
       REAL API CALL (Admin authentication)
    ───────────────────────────────────────────── */
    const res = await Admin.login({
      username,
      password: pwd
    });

    // Success case
    if (res && res.success) {

      // Store admin JWT token
      setAdminToken(res.data.token);

      // Store session metadata (UI convenience)
      localStorage.setItem('admin_session', JSON.stringify({
        username: res.data.admin.username,
        name: res.data.admin.name,
        role: res.data.admin.role,
        loginTime: new Date().toISOString()
      }));

      // Redirect to admin dashboard
      window.location.href = 'admin.html';

      return;
    }

    // Failed login
    showAlert(res?.message || 'Invalid username or password.');

  } catch (err) {

    console.error('Admin login error:', err);
    showAlert('Cannot connect to server.');

  } finally {

    // Reset button state ALWAYS
    btn.disabled = false;
    btn.innerHTML = 'Sign In to Admin Panel';
  }
}


/* =========================================================
   PASSWORD TOGGLE FUNCTION
========================================================= */
function toggleAdminPwd() {
  const input = document.getElementById('adminPwd');
  const icon = document.getElementById('eyeIcon');
  if (!input || !icon) return;

  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
}


/* =========================================================
   ALERT HANDLER
========================================================= */
function showAlert(msg) {
  const el = document.getElementById('alert');
  if (!el) return;

  el.textContent = msg;
  el.className = 'alert error';
  el.style.display = 'block';
}


/* =========================================================
   AUTO REDIRECT IF ALREADY LOGGED IN
========================================================= */
if (getAdminToken()) {
  window.location.href = 'admin.html';
}