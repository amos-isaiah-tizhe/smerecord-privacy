'use strict';
/**
 * frontend/api.js — SME Record API Client
 * ==========================================
 * ALL server communication goes through here.
 * Loaded by every HTML page via <script src="api.js"></script>
 */

// ── BASE URL ──────────────────────────────────────────────────────────────────
// Dev:  Express serves both the API and the static frontend from
//       http://localhost:5000, so the relative path "/api" works everywhere.
// Prod: same domain → "/api" (relative path).
const API_BASE = '/api';

// ── HTML ESCAPING ─────────────────────────────────────────────────────────────
// Any user-supplied or admin-supplied text (descriptions, category names,
// notification messages, business names, etc.) MUST be passed through this
// before being inserted via innerHTML/template literals, or it becomes a
// stored XSS vector (e.g. a transaction description of "<img src=x onerror=...>").
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── USER TOKEN ────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('sme_token'); }
function setToken(t) { localStorage.setItem('sme_token', t); }
function removeToken() { localStorage.removeItem('sme_token'); }
function getSession() { return JSON.parse(localStorage.getItem('sme_session') || 'null'); }
function setSession(u) { localStorage.setItem('sme_session', JSON.stringify(u)); }
function removeSession() { localStorage.removeItem('sme_session'); }

// ── CORE REQUEST ──────────────────────────────────────────────────────────────
async function apiRequest(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(API_BASE + path, opts);
    let data;
    try { data = await res.json(); }
    catch { data = { success: false, message: 'Invalid server response' }; }

    // Token expired → log out
    if (res.status === 401) {
      removeToken(); removeSession();
      if (!window.location.pathname.includes('auth.html')) {
        window.location.href = 'auth.html';
      }
      return null;
    }
    return data;
  } catch (err) {
    console.error('[API]', method, path, err.message);
    return { success: false, message: 'Cannot connect to server. Is the backend running on port 5000?' };
  }
}

const api = {
  get: (path) => apiRequest('GET', path),
  post: (path, body) => apiRequest('POST', path, body),
  put: (path, body) => apiRequest('PUT', path, body),
  patch: (path, body) => apiRequest('PATCH', path, body),
  delete: (path) => apiRequest('DELETE', path),
};

// ── AUTH ──────────────────────────────────────────────────────────────────────
const Auth = {
  register: (d) => api.post('/auth/register', d),
  login: (d) => api.post('/auth/login', d),
  me: () => api.get('/auth/me'),
  update: (d) => api.put('/auth/me', d),
  changePassword: (d) => api.put('/auth/me/password', d),
  clearMyData: () => api.delete('/auth/me/data'),

  logout() {
    removeToken(); removeSession();
    window.location.href = 'auth.html';
  },

  async requireAuth() {
    if (!getToken()) { window.location.href = 'auth.html'; return null; }
    const res = await Auth.me();
    if (!res || !res.success) {
      removeToken(); removeSession();
      window.location.href = 'auth.html';
      return null;
    }
    setSession(res.data.user);
    return res.data.user;
  }
};

// ── BOOKS ─────────────────────────────────────────────────────────────────────
const Books = {
  list: () => api.get('/books'),
  create: (d) => api.post('/books', d),
  update: (id, d) => api.put('/books/' + id, d),
  delete: (id) => api.delete('/books/' + id),
};

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
const Transactions = {
  list: (p) => api.get('/transactions?' + new URLSearchParams(p || {}).toString()),
  create: (d) => api.post('/transactions', d),
  update: (id, d) => api.put('/transactions/' + id, d),
  delete: (id) => api.delete('/transactions/' + id),
};

// ── CATEGORIES ────────────────────────────────────────────────────────────────
const Categories = {
  list: (type) => api.get('/categories' + (type ? '?type=' + type : '')),
  create: (d) => api.post('/categories', d),
  update: (id, d) => api.put('/categories/' + id, d),
  delete: (id) => api.delete('/categories/' + id),
};

// ── REPORTS ───────────────────────────────────────────────────────────────────
const Reports = {
  summary: (bookId, period) =>
    api.get(`/reports/summary?bookId=${bookId}&period=${period || 'month'}`),
  monthly: (bookId, year) =>
    api.get(`/reports/monthly?bookId=${bookId}&year=${year}`),
};

// ── USER NOTIFICATIONS ────────────────────────────────────────────────────────
const UserNotifications = {
  list: () => api.get('/auth/notifications'),
  markRead: (id) => api.patch('/auth/notifications/' + id + '/read', {}),
  reply: (id, message) => api.post('/auth/notifications/' + id + '/reply', { message })
};

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — separate token, separate endpoints
// ══════════════════════════════════════════════════════════════════════════════
function getAdminToken() { return localStorage.getItem('sme_admin_token'); }
function setAdminToken(t) { localStorage.setItem('sme_admin_token', t); }
function removeAdminToken() {
  localStorage.removeItem('sme_admin_token');
  localStorage.removeItem('admin_session');
}

async function adminRequest(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAdminToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(API_BASE + '/admin' + path, opts);
    let data;
    try { data = await res.json(); }
    catch { data = { success: false, message: 'Invalid server response' }; }

    if (res.status === 401) {
      removeAdminToken();
      if (!window.location.pathname.includes('admin-login.html')) {
        window.location.href = 'admin-login.html';
      }
      return null;
    }
    return data;
  } catch (err) {
    console.error('[Admin API]', method, path, err.message);
    return { success: false, message: 'Cannot connect to server.' };
  }
}

const Admin = {
  login: (d) => adminRequest('POST', '/auth/login', d),
  me: () => adminRequest('GET', '/auth/me'),
  updateMe: (d) => adminRequest('PUT', '/auth/me', d),
  stats: () => adminRequest('GET', '/stats'),
  users: (p) => adminRequest('GET', '/users?' + new URLSearchParams(p || {}).toString()),
  toggleSuspend: (id) => adminRequest('PATCH', '/users/' + id + '/suspend'),
  userDetail: (id) => adminRequest('GET', '/users/' + id),
  deleteUser: (id) => adminRequest('DELETE', '/users/' + id),
  resetUser: (id) => adminRequest('DELETE', '/users/' + id + '/data'),
  notify: (d) => adminRequest('POST', '/notifications/send', d),
  notifications: () => adminRequest('GET', '/notifications'),
  clearNotifications: () => adminRequest('DELETE', '/notifications'),
  deleteNotification: (id) => adminRequest('DELETE', '/notifications/' + id),
  userNotifs: (id) => adminRequest('GET', '/notifications/user/' + id),
  transactions: (p) => adminRequest('GET', '/transactions?' + new URLSearchParams(p || {}).toString()),
  activity: () => adminRequest('GET', '/activity'),
  clearActivity: () => adminRequest('DELETE', '/activity'),
  deleteActivityItem: (id) => adminRequest('DELETE', '/activity/' + id),
  settings: () => adminRequest('GET', '/settings'),
  updateSettings: (d) => adminRequest('PUT', '/settings', d),
  maintenanceStats: () => adminRequest('GET', '/maintenance/stats'),
  exportData: () => adminRequest('GET', '/maintenance/export'),
  clearTransactions: () => adminRequest('DELETE', '/maintenance/transactions'),
  admins: () => adminRequest('GET', '/admins'),
  createAdmin: (d) => adminRequest('POST', '/admins', d),
  deleteAdmin: (id) => adminRequest('DELETE', '/admins/' + id),

  logout() {
    removeAdminToken();
    window.location.href = 'admin-login.html';
  },

  async requireAuth() {
    if (!getAdminToken()) { window.location.href = 'admin-login.html'; return null; }
    const res = await Admin.me();
    if (!res || !res.success) {
      removeAdminToken();
      window.location.href = 'admin-login.html';
      return null;
    }
    return res.data;
  }
};
