const token = new URLSearchParams(location.search).get('token');

const form = document.getElementById('f');
const msg = document.getElementById('msg');
const pw = document.getElementById('pw');

form.onsubmit = async e => {
  e.preventDefault();

  const r = await fetch('/api/auth/reset-password/' + token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      password: pw.value
    })
  });

  const d = await r.json();

  // Set message
 msg.textContent = d.message;

  // Show message element
  msg.classList.add('show');

  // Redirect if successful
  if (r.ok) {
    setTimeout(() => {
      location.href = 'auth.html';
    }, 1500);
  }
};