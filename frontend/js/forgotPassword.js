const form = document.getElementById('f');
const emailInput = document.getElementById('email');
const msg = document.getElementById('msg');

// ── TURNSTILE TOKEN STORAGE ──
let forgotToken = '';

// Cloudflare callback
window.onForgotTurnstile = (t) => {
  forgotToken = t;
};

form.onsubmit = async e => {
  e.preventDefault();

  // Clear previous message
  msg.textContent = '';
  msg.classList.remove('show');

  // Basic validation
  if (!emailInput.value.trim()) {
    msg.textContent = 'Please enter your email address.';
    msg.classList.add('show');
    return;
  }

  // Turnstile validation
  // On localhost Turnstile never fires its callback (error 300010), so
  // forgotToken stays empty. Skip the guard in dev; enforce in production.
  const _isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!forgotToken && !_isDev) {
    msg.textContent = 'Please complete the bot check.';
    msg.classList.add('show');
    return;
  }

  try {

    const r = await fetch('/api/auth/forgot-password', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        email: emailInput.value.trim(),
        turnstileToken: forgotToken,
      })
    });

    const d = await r.json();

    msg.textContent = d.message;
    msg.classList.add('show');

    // Reset Turnstile
    turnstile.reset();
    forgotToken = '';

  } catch (err) {

    msg.textContent = 'Something went wrong. Please try again.';
    msg.classList.add('show');

    // Reset Turnstile
    turnstile.reset();
    forgotToken = '';

    console.error(err);
  }
};