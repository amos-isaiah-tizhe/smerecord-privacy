// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let adminSession = null;
let currentDetailUserId = null;
let notifType = 'broadcast';
let userPage = 1;
let txPage = 1;
const PAGE_SIZE = 15;

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// IN-MEMORY CACHE — loaded from API on init
// ═══════════════════════════════════════════════════════
let _users = [];
let _txs = [];
let _notifs = [];
let _activity = [];
let _settings = {};

// Persistent Chart instances
let regChart = null;
let statusChart = null;
let analyticsBarChart = null;
let analyticsMethodChart = null;
let growthChart = null;

// Ensure charts render crisply on high-DPI screens
try { if (window.Chart) Chart.defaults.devicePixelRatio = window.devicePixelRatio || 1; } catch (e) { /* ignore */ }

const getUsers = () => _users;
const getTxs = () => _txs;
const getNotifs = () => _notifs;
const getActivity = () => _activity;
const getSettings = () => _settings;

// Activity normalization & persistence helpers
function normalizeActivityItem(item) {
  if (!item) return { id: null, type: 'system', text: '—', time: new Date().toISOString() };
  const actionMap = {
    send_notif: 'notif', login: 'login', logout: 'login', suspend: 'suspend', unsuspend: 'suspend',
    delete: 'delete', reset: 'delete', register: 'register', tx: 'tx'
  };
  const type = actionMap[item.action] || item.category || item.action || item.type || 'system';
  const text = item.description || item.text || item.message || '';
  const time = item.createdAt || item.time || item.sentAt || item.timestamp || new Date().toISOString();
  const id = item._id || item.id || null;
  return { id, type, text, time };
}

function normalizeActivityList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeActivityItem);
}

function saveActivity(list) {
  try {
    const normalized = normalizeActivityList(list);
    localStorage.setItem('admin_activity', JSON.stringify(normalized));
    _activity = normalized;
  } catch (e) {
    console.warn('saveActivity failed', e);
  }
}

function logActivity(actionOrType, description) {
  const it = { action: actionOrType, description: description, createdAt: new Date().toISOString() };
  const norm = normalizeActivityItem(it);
  _activity.unshift(norm);
  try { localStorage.setItem('admin_activity', JSON.stringify(_activity)); } catch (e) { /* ignore */ }
}

const fmt = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

function attachAdminEventHandlers() {
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  document.getElementById('adminBackBtn')?.addEventListener('click', () => { window.location.href = 'auth.html'; });
  document.getElementById('adminLogoutBtn')?.addEventListener('click', adminLogout);
  document.getElementById('toggleSidebarBtn')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);
  document.addEventListener('click', event => {
    const btn = event.target.closest('button[data-action="closeModal"]');
    if (!btn) return;
    const target = btn.dataset.target;
    if (target) closeModal(target);
  });
  document.getElementById('notificationsBtn')?.addEventListener('click', () => showPage('notifications'));
  document.getElementById('refreshDataBtn')?.addEventListener('click', refreshAllData);

  document.getElementById('filterStatus')?.addEventListener('change', renderUsersTable);
  document.getElementById('searchUser')?.addEventListener('input', renderUsersTable);
  document.getElementById('clearUserFiltersBtn')?.addEventListener('click', clearUserFilters);
  document.getElementById('openNotifModalBtn')?.addEventListener('click', openNotifModal);

  document.getElementById('filterLogType')?.addEventListener('change', renderActivityLog);
  document.getElementById('filterLogDate')?.addEventListener('change', renderActivityLog);
  document.getElementById('clearLogFiltersBtn')?.addEventListener('click', clearLogFilters);
  document.getElementById('clearActivityLogBtn')?.addEventListener('click', clearActivityLog);

  // Transactions page — stats load when the page is shown (see showPage)
  // No filter listeners needed; the stats page has no filters.

  document.querySelectorAll('.notif-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.notifType;
      if (type) selectNotifType(type, btn);
    });
  });
  document.getElementById('notifMessage')?.addEventListener('input', updateCharCount);
  document.getElementById('sendNotificationBtn')?.addEventListener('click', sendNotification);
  document.getElementById('clearNotifHistoryBtn')?.addEventListener('click', clearNotifHistory);

  document.getElementById('exportFeedbackBtn')?.addEventListener('click', exportFeedbackCSV);
  document.getElementById('savePlatformSettingsBtn')?.addEventListener('click', savePlatformSettings);
  document.getElementById('saveAdminAccountBtn')?.addEventListener('click', saveAdminAccount);

  document.getElementById('exportFullBackupBtn')?.addEventListener('click', exportFullBackup);
  document.getElementById('importBackupBtn')?.addEventListener('click', importBackup);
  document.getElementById('importFile')?.addEventListener('change', handleImport);
  document.getElementById('clearAllTransactionsBtn')?.addEventListener('click', clearAllTransactions);
  document.getElementById('deleteAllUsersBtn')?.addEventListener('click', deleteAllUsers);
  document.getElementById('nuclearResetBtn')?.addEventListener('click', nuclearReset);

  document.getElementById('closeUserDetailBtn')?.addEventListener('click', closeUserDetail);
  document.getElementById('detailNotifyBtn')?.addEventListener('click', () => notifyUser(currentDetailUserId));
  document.getElementById('detailResetBtn')?.addEventListener('click', () => resetUserData(currentDetailUserId));
  document.getElementById('detailSuspendBtn')?.addEventListener('click', () => toggleSuspendUser(currentDetailUserId));
  document.getElementById('detailDeleteBtn')?.addEventListener('click', () => deleteUser(currentDetailUserId));

  document.getElementById('notifModalCloseBtn')?.addEventListener('click', () => closeModal('notifModal'));
  document.getElementById('sendModalNotificationBtn')?.addEventListener('click', sendModalNotification);

  document.getElementById('usersTableBody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const userId = btn.dataset.userId;
    if (!action || !userId) return;
    if (action === 'open-user-detail') openUserDetail(userId);
    if (action === 'notify-user') notifyUser(userId);
    if (action === 'toggle-suspend') toggleSuspendUser(userId);
    if (action === 'delete-user') deleteUser(userId);
  });

  document.getElementById('feedbackBody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.feedbackId;
    if (!action || !id) return;
    if (action === 'resolve-feedback') resolveFeedback(id);
    if (action === 'delete-feedback') deleteFeedback(id);
  });
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  const adminData = await Admin.requireAuth();
  if (!adminData) return;

  adminSession = JSON.parse(localStorage.getItem('admin_session') || '{}');
  adminSession.name = adminData.name || adminSession.name || 'Admin';
  adminSession.username = adminData.username || adminSession.username || '';
  adminSession.role = adminData.role || adminSession.role || 'superadmin';

  const el_adminName = document.getElementById('adminName');
  const el_adminInitials = document.getElementById('adminInitials');
  const el_adminNameInput = document.getElementById('adminNameInput');
  const el_adminUsernameInput = document.getElementById('adminUsernameInput');
  const el_adminEmailInput = document.getElementById('adminEmailInput');

  if (el_adminName) el_adminName.textContent = adminSession.name;
  if (el_adminInitials) el_adminInitials.textContent = adminSession.name.charAt(0).toUpperCase();
  if (el_adminNameInput) el_adminNameInput.value = adminSession.name || '';
  if (el_adminUsernameInput) el_adminUsernameInput.value = adminSession.username || '';
  if (el_adminEmailInput) el_adminEmailInput.value = adminSession.email || '';

  attachAdminEventHandlers();
  await refreshAllData();
}

async function refreshAllData() {
  try {
    const [statsRes, usersRes, notifsRes, actRes] = await Promise.all([
      Admin.stats(),
      Admin.users({ limit: 20 }),
      Admin.notifications(),
      Admin.activity()
      // NOTE: Admin.transactions() is intentionally NOT called here.
      // The transactions page now shows anonymised platform stats, fetched
      // on-demand when the user navigates to that page. We no longer load
      // individual transaction records into the admin frontend at all —
      // that was the privacy violation we fixed.
    ]);

    const usersFromApiRaw = usersRes?.data?.users;
    let usersFromApi;
    if (Array.isArray(usersFromApiRaw)) {
      usersFromApi = usersFromApiRaw;
      try { localStorage.setItem('sme_users', JSON.stringify(usersFromApi)); } catch (e) { /* ignore */ }
    } else {
      try { usersFromApi = JSON.parse(localStorage.getItem('sme_users') || '[]'); } catch (e) { usersFromApi = []; }
    }
    _users  = usersFromApi || [];
    _notifs = notifsRes?.data?.notifications || [];
    // Trust the backend as the source of truth. Only fall back to the local
    // cache if the API call genuinely failed (apiLogs is undefined) — NOT
    // when it succeeded with zero entries (that's a legitimately empty log,
    // e.g. right after clearing it).
    const apiLogs = actRes?.data?.logs;
    if (Array.isArray(apiLogs)) {
      _activity = normalizeActivityList(apiLogs);
      try { localStorage.setItem('admin_activity', JSON.stringify(_activity)); } catch (e) { /* ignore */ }
    } else {
      const stored = (function () {
        try { return JSON.parse(localStorage.getItem('admin_activity') || '[]'); } catch (e) { return []; }
      })();
      _activity = normalizeActivityList(stored);
    }

    renderOverview(statsRes?.data);
    updateNotifDot();
  } catch (e) {
    console.error('refreshAllData error:', e);
  }
}

// ═══════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════
function renderOverview(stats) {
  const users = getUsers();
  const txs = getTxs();

  const total = stats?.totalUsers ?? users.length;
  const active = stats?.activeUsers ?? users.filter(u => !u.isSuspended).length;
  const suspended = stats?.suspendedUsers ?? users.filter(u => u.isSuspended).length;
  const newMonth = stats?.newThisMonth ?? 0;
  const income = stats?.totalIncome ?? txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const txCount = stats?.totalTxs ?? txs.length;

  const elStatTotal = document.getElementById('statTotalUsers');
  const elStatActive = document.getElementById('statActiveUsers');
  const elStatSuspended = document.getElementById('statSuspended');
  const elStatNewUsers = document.getElementById('statNewUsers');
  const elStatActiveRate = document.getElementById('statActiveRate');
  const elStatSuspendedNote = document.getElementById('statSuspendedNote');
  const elStatIncome = document.getElementById('statIncome');
  const elStatTxs = document.getElementById('statTxs');
  const elStatTxsSub = document.getElementById('statTxsSub');

  if (elStatTotal) elStatTotal.textContent = total;
  if (elStatActive) elStatActive.textContent = active;
  if (elStatSuspended) elStatSuspended.textContent = suspended;
  if (elStatNewUsers) elStatNewUsers.textContent = '+' + newMonth + ' this month';
  if (elStatActiveRate) elStatActiveRate.textContent = total ? Math.round(active / total * 100) + '% of total' : '0%';
  if (elStatSuspendedNote) elStatSuspendedNote.textContent = suspended ? suspended + ' account(s) restricted' : 'No suspensions';
  if (elStatIncome) elStatIncome.textContent = fmt(income);
  if (elStatTxs) elStatTxs.textContent = txCount;
  if (elStatTxsSub) elStatTxsSub.textContent = txCount + ' total records';

  const pb = document.getElementById('pendingBadge');
  if (pb && suspended > 0) { pb.textContent = suspended; pb.style.display = 'inline-block'; }

  const recentUsers = [...users].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
  renderUsersInTable(recentUsers, 'recentUsersBody', false);

  renderRecentActivityWidget();

  renderRegistrationChart();
  renderStatusChart();
}

function renderRegistrationChart() {
  const users = _users;
  const months = [], counts = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const yr = d.getFullYear(), mo = d.getMonth();
    months.push(d.toLocaleString('default', { month: 'short' }));
    counts.push(users.filter(u => {
      const cd = new Date(u.createdAt);
      return cd.getFullYear() === yr && cd.getMonth() === mo;
    }).length);
  }

  const regChartEl = document.getElementById('regChart');
  if (!regChartEl) return;

  // Create the chart once and reuse it to avoid "Canvas is already in use" errors
  if (!regChart) {
    const ctx = regChartEl.getContext('2d');
    regChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          label: 'New Users',
          data: counts,
          backgroundColor: 'rgba(124,58,237,0.65)',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { grid: { color: '#eef' }, ticks: { stepSize: 1 }, beginAtZero: true }, x: { grid: { display: false } } }
      }
    });
  } else {
    regChart.data.labels = months;
    regChart.data.datasets[0].data = counts;
    regChart.update();
  }
}

function renderStatusChart() {
  const users = _users;
  const active = users.filter(u => !u.isSuspended).length;
  const suspended = users.filter(u => u.isSuspended).length;

  const statusChartEl = document.getElementById('statusChart');
  if (!statusChartEl) return;
  if (!statusChart) {
    const ctx = statusChartEl.getContext('2d');
    statusChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Active', 'Suspended'],
        datasets: [{
          data: [active || 0, suspended || 0],
          backgroundColor: ['rgba(0,200,150,0.8)', 'rgba(255,77,109,0.8)'],
          borderWidth: 2, borderColor: '#fff'
        }]
      },
      options: {
        responsive: true, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } }
      }
    });
  } else {
    statusChart.data.datasets[0].data = [active || 0, suspended || 0];
    statusChart.update();
  }
}

// ═══════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════
function renderAnalytics() {
  const txs = _txs;

  // Income vs Expense bar
  const months = [], inc = [], exp = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const yr = d.getFullYear(), mo = d.getMonth();
    const filtered = txs.filter(t => { const td = new Date(t.date); return td.getFullYear() === yr && td.getMonth() === mo; });
    months.push(d.toLocaleString('default', { month: 'short' }));
    inc.push(filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
    exp.push(filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  }

  const analyticsBarEl = document.getElementById('analyticsBar');
  if (analyticsBarEl) {
    const ctx1 = analyticsBarEl.getContext('2d');
    if (!analyticsBarChart) {
      analyticsBarChart = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: months, datasets: [
            { label: 'Income', data: inc, backgroundColor: 'rgba(0,200,150,0.7)', borderRadius: 5 },
            { label: 'Expense', data: exp, backgroundColor: 'rgba(255,77,109,0.7)', borderRadius: 5 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#eef' },
              ticks: { callback: v => '₦' + Number(Math.round(v)).toLocaleString() }
            },
            x: { grid: { display: false } }
          }
        }
      });
    } else {
      analyticsBarChart.data.labels = months;
      analyticsBarChart.data.datasets[0].data = inc;
      analyticsBarChart.data.datasets[1].data = exp;
      analyticsBarChart.update();
    }
  }

  // Payment method doughnut
  const cash = txs.filter(t => t.method === 'cash').length;
  const bank = txs.filter(t => t.method === 'bank').length;
  const pos = txs.filter(t => t.method === 'pos').length;
  const other = txs.length - cash - bank - pos;

  const analyticsMethodEl = document.getElementById('analyticsMethod');
  if (analyticsMethodEl) {
    const ctx2 = analyticsMethodEl.getContext('2d');
    if (!analyticsMethodChart) {
      analyticsMethodChart = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['Cash', 'Bank', 'POS', 'Other'],
          datasets: [{
            data: [cash || 0, bank || 0, pos || 0, other || 0],
            backgroundColor: ['#00c896', '#3b82f6', '#f5a623', '#a78bfa'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: {
          responsive: true, cutout: '60%',
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } } }
        }
      });
    } else {
      analyticsMethodChart.data.datasets[0].data = [cash || 0, bank || 0, pos || 0, other || 0];
      analyticsMethodChart.update();
    }
  }

  // Top categories
  const catMap = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    catMap[t.category || 'Other'] = (catMap[t.category || 'Other'] || 0) + t.amount;
  });
  const top = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = top.reduce((s, [, v]) => s + v, 0);

  const topCategoriesEl = document.getElementById('topCategories');
  if (topCategoriesEl) topCategoriesEl.innerHTML = top.length ? top.map(([cat, amt]) => {
    const pct = total ? Math.round(amt / total * 100) : 0;
    return `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span style="font-weight:600;">${cat}</span>
        <span style="color:var(--red);">${fmt(amt)}</span>
      </div>
      <div style="background:var(--border);border-radius:20px;height:5px;">
        <div style="background:var(--red);border-radius:20px;height:5px;width:${pct}%;"></div>
      </div>
      <div style="font-size:10px;color:var(--ink-soft);margin-top:2px;">${pct}%</div>
    </div>`;
  }).join('') : '<div class="empty-state"><i class="fa-solid fa-chart-bar"></i><p>No data yet.</p></div>';

  // Platform growth line chart
  const growthChartEl = document.getElementById('growthChart');
  if (growthChartEl) {
    const ctx3 = growthChartEl.getContext('2d');
    const txCounts = months.map((_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
      const yr = d.getFullYear(), mo = d.getMonth();
      return txs.filter(t => { const td = new Date(t.date); return td.getFullYear() === yr && td.getMonth() === mo; }).length;
    });

    if (!growthChart) {
      growthChart = new Chart(ctx3, {
        type: 'line',
        data: {
          labels: months, datasets: [
            {
              label: 'Transactions', data: txCounts,
              borderColor: 'var(--purple)', backgroundColor: 'rgba(124,58,237,0.08)',
              fill: true, tension: 0.4, pointRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#eef' }, ticks: { stepSize: 1 } },
            x: { grid: { display: false } }
          }
        }
      });
    } else {
      growthChart.data.labels = months;
      growthChart.data.datasets[0].data = txCounts;
      growthChart.update();
    }
  }
}

// ═══════════════════════════════════════════════════════
// USERS TABLE
// ═══════════════════════════════════════════════════════
function renderUsersTable() {
  let users = _users.slice();
  const el_filterStatus = document.getElementById('filterStatus');
  const el_searchUser = document.getElementById('searchUser');
  const status = el_filterStatus?.value || '';
  const search = (el_searchUser?.value || '').toLowerCase();

  if (status === 'suspended') users = users.filter(u => u.isSuspended);
  else if (status === 'active') users = users.filter(u => !u.isSuspended);
  if (search) users = users.filter(u =>
    (u.fullName || '').toLowerCase().includes(search) ||
    (u.email || '').toLowerCase().includes(search) ||
    (u.businessName || '').toLowerCase().includes(search)
  );

  users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = users.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const paged = users.slice((userPage - 1) * PAGE_SIZE, userPage * PAGE_SIZE);

  renderUsersInTable(paged, 'usersTableBody', true);
  renderPagination('userPagination', userPage, totalPages, (p) => { userPage = p; renderUsersTable(); });
}

function renderUsersInTable(users, tbodyId, showActions) {
  const txs = _txs;
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><i class="fa-solid fa-users-slash"></i><p>No users found.</p></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const uid = u._id || u.id;
    const userTxs = txs.filter(t => t.userId === uid);
    const status = u.isSuspended ? 'suspended' : 'active';

    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#6366f1);
                      display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;flex-shrink:0;">
            ${(u.fullName || '?').charAt(0).toUpperCase()}
          </div>
          <span style="font-weight:600;">${escapeHtml(u.fullName) || '—'}</span>
        </div>
      </td>
      <td>${escapeHtml(u.businessName) || '—'}</td>
      <td style="color:var(--ink-soft); font-size:12px;">${escapeHtml(u.email) || '—'}</td>
      <td style="font-size:12px;">${fmtDate(u.createdAt)}</td>
      <td>${userTxs.length}</td>
      <td><span class="pill ${status}">${status}</span></td>
      ${showActions ? `
      <td>
        <div class="action-group">
          <button class="btn btn-outline btn-sm" data-action="open-user-detail" data-user-id="${uid}">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button class="btn btn-sm" style="background:var(--purple-bg);color:var(--purple);"
            data-action="notify-user" data-user-id="${uid}">
            <i class="fa-solid fa-bell"></i>
          </button>
          <button class="btn btn-sm ${status === 'suspended' ? 'btn-green' : 'btn-red'}"
            data-action="toggle-suspend" data-user-id="${uid}">
            <i class="fa-solid fa-${status === 'suspended' ? 'check' : 'ban'}"></i>
          </button>
          <button class="btn btn-red btn-sm" data-action="delete-user" data-user-id="${uid}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>` : `<td></td>`}
    </tr>`;
  }).join('');
}

function clearUserFilters() {
  const el_filterStatus = document.getElementById('filterStatus');
  const el_searchUser = document.getElementById('searchUser');
  if (el_filterStatus) el_filterStatus.value = '';
  if (el_searchUser) el_searchUser.value = '';
  userPage = 1;
  renderUsersTable();
}

// ═══════════════════════════════════════════════════════
// USER DETAIL PANEL
// ═══════════════════════════════════════════════════════
function openUserDetail(userId) {
  currentDetailUserId = userId;
  const u = _users.find(u => (u._id || u.id) === userId);
  if (!u) return;

  const status = u.isSuspended ? 'suspended' : 'active';

  // ── Populate immediately with what we already have ───────────────────────
  // Show the panel right away so the user doesn't wait. Stats (books,
  // categories, tx count) will be filled in once the API call resolves.
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('detailAvatar',     (u.fullName || '?').charAt(0).toUpperCase());
  set('detailName',       u.fullName     || '—');
  set('detailBiz',        u.businessName || '—');
  set('detailEmail',      u.email        || '—');
  set('detailId',         u._id || u.id);
  set('detailJoined',     fmtDate(u.createdAt));
  set('detailTxCount',    '…');  // loading indicator
  set('detailBooks',      '…');
  set('detailCategories', '…');

  const el_detailStatusPill = document.getElementById('detailStatusPill');
  if (el_detailStatusPill) {
    el_detailStatusPill.innerHTML = `<span class="pill ${status}">${status}</span>`;
  }

  const suspendBtn = document.getElementById('detailSuspendBtn');
  if (suspendBtn) {
    if (status === 'suspended') {
      suspendBtn.innerHTML        = '<i class="fa-solid fa-check"></i> Reactivate User';
      suspendBtn.style.background = 'var(--green-bg)';
      suspendBtn.style.color      = 'var(--green)';
    } else {
      suspendBtn.innerHTML        = '<i class="fa-solid fa-ban"></i> Suspend User';
      suspendBtn.style.background = 'var(--red-bg)';
      suspendBtn.style.color      = 'var(--red)';
    }
  }

  // Open the panel — user sees it immediately
  const el_userDetail = document.getElementById('userDetail');
  if (el_userDetail) el_userDetail.classList.add('open');

  // ── Fetch real stats from backend ─────────────────────────────────────────
  // _users is loaded from GET /api/admin/users which returns basic account
  // info only. Stats (txCount, bookCount, categoryCount) are only returned
  // by GET /api/admin/users/:id — fetch them now and fill in the panel.
  // This also logs the data access to the activity log (NDPR requirement).
  Admin.userDetail(userId).then(res => {
    if (!res?.success) return;
    const detail = res.data?.user;
    if (!detail) return;

    set('detailTxCount',    detail.stats?.txCount       ?? '0');
    set('detailBooks',      detail.stats?.bookCount     ?? '0');
    set('detailCategories', detail.stats?.categoryCount ?? '0');

  }).catch(() => {
    // If the fetch fails, show dashes instead of the loading indicator
    set('detailTxCount',    '—');
    set('detailBooks',      '—');
    set('detailCategories', '—');
  });
}

function closeUserDetail() {
  const el_userDetail = document.getElementById('userDetail');
  if (el_userDetail) el_userDetail.classList.remove('open');
  currentDetailUserId = null;
}

// ═══════════════════════════════════════════════════════
// USER ACTIONS
// ═══════════════════════════════════════════════════════
async function toggleSuspendUser(userId) {
  const user = _users.find(u => (u._id || u.id) === userId);
  if (!user) return;
  const res = await Admin.toggleSuspend(userId);
  if (res?.success) {
    user.isSuspended = !user.isSuspended;
    const action = user.isSuspended ? 'suspended' : 'reactivated';
    toast(`User ${action}`, user.isSuspended ? 'warning' : 'success');
    renderUsersTable();
    renderOverview();
    if (currentDetailUserId === userId) openUserDetail(userId);
  } else {
    toast(res?.message || 'Action failed', 'error');
  }
}

async function deleteUser(userId) {
  const user = _users.find(u => (u._id || u.id) === userId);
  if (!user) return;
  if (!confirm(`Delete user "${user.fullName}"?\n\nThis also removes all their data.`)) return;
  const res = await Admin.deleteUser(userId);
  if (res?.success) {
    _users = _users.filter(u => (u._id || u.id) !== userId);
    _txs = _txs.filter(t => t.userId !== userId);
    toast('User deleted', 'info');
    closeUserDetail();
    renderUsersTable();
    renderOverview();
  } else {
    toast(res?.message || 'Delete failed', 'error');
  }
}

async function resetUserData(userId) {
  const user = _users.find(u => (u._id || u.id) === userId);
  if (!user) return;
  if (!confirm(`Reset all data for "${user.fullName}"?\n\nTransactions, books and categories will be deleted.`)) return;
  const res = await Admin.resetUser(userId);
  if (res?.success) {
    _txs = _txs.filter(t => t.userId !== userId);
    toast(`Data reset for ${user.fullName}`, 'info');
    openUserDetail(userId);
  } else {
    toast(res?.message || 'Reset failed', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════
function selectNotifType(type, el) {
  notifType = type;
  document.querySelectorAll('.notif-type-btn').forEach(b => b.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const targetGroup = document.getElementById('targetUserGroup');
  if (targetGroup) targetGroup.style.display = type === 'targeted' ? 'block' : 'none';

  // Populate user select
  if (type === 'targeted') {
    const sel = document.getElementById('notifTargetUser');
    if (sel) {
      sel.innerHTML = '<option value="">Select a user...</option>' +
        _users.map(u => `<option value="${u._id || u.id}">${escapeHtml(u.fullName)} — ${escapeHtml(u.businessName)}</option>`).join('');
    }
  }
}

function updateCharCount() {
  const msgEl = document.getElementById('notifMessage');
  const countEl = document.getElementById('charCount');
  if (!msgEl || !countEl) return;
  const msg = msgEl.value;
  countEl.textContent = msg.length;
}

async function sendNotification() {
  const titleEl = document.getElementById('notifTitle');
  const messageEl = document.getElementById('notifMessage');
  const priorityEl = document.getElementById('notifPriority');
  const targetEl = document.getElementById('notifTargetUser');

  if (!titleEl || !messageEl || !priorityEl) {
    toast('Notification form is not available', 'error');
    return;
  }

  const title = titleEl.value.trim();
  const message = messageEl.value.trim();
  const priority = priorityEl.value;
  const targetId = targetEl?.value;

  if (!title) { toast('Please enter a title', 'error'); return; }
  if (!message) { toast('Please enter a message', 'error'); return; }
  if (notifType === 'targeted' && !targetId) { toast('Please select a target user', 'error'); return; }

  const res = await Admin.notify({
    type: notifType, title, message, priority,
    targetUserId: notifType === 'targeted' ? targetId : undefined
  });

  if (res?.success) {
    titleEl.value = '';
    messageEl.value = '';
    const charCountEl = document.getElementById('charCount');
    if (charCountEl) charCountEl.textContent = '0';
    toast('Notification sent!', 'success');
    const nRes = await Admin.notifications();
    _notifs = nRes?.data?.notifications || _notifs;
    renderNotifHistory();
  } else {
    toast(res?.message || 'Failed to send notification', 'error');
  }
}

function renderNotifHistory() {
  const notifs = _notifs;
  const el = document.getElementById('notifHistoryList');
  if (!el) return;

  if (notifs.length === 0) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bell-slash"></i><p>No notifications sent yet.</p></div>';
    return;
  }

  el.innerHTML = notifs.map(n => {
    const priorityColors = { normal: 'var(--ink-soft)', info: 'var(--blue)', warning: 'var(--gold)', urgent: 'var(--red)' };
    const target = n.targetUserId ? (escapeHtml(_users.find(u => (u._id || u.id) === n.targetUserId)?.fullName) || 'Unknown') : 'All Users';
    const replies = Array.isArray(n.replies) ? n.replies : [];
    const notifId = n._id || n.id;

    return `
    <div style="padding:14px 20px;border-bottom:1px solid var(--surface-3);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);">${escapeHtml(n.title)}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill ${n.type}">${n.type}</span>
          <button onclick="deleteNotification('${notifId}')" title="Delete this notification"
            style="background:none;border:none;color:var(--ink-soft);cursor:pointer;padding:2px;">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px;">${escapeHtml(n.message)}</div>
      <div style="display:flex;gap:12px;font-size:11px;color:var(--ink-soft);margin-bottom:8px;">
        <span><i class="fa-solid fa-user" style="margin-right:3px;"></i>${target}</span>
        <span><i class="fa-solid fa-clock" style="margin-right:3px;"></i>${fmtTime(n.sentAt)}</span>
        <span style="color:${priorityColors[n.priority]};font-weight:600;text-transform:uppercase;font-size:10px;">${n.priority}</span>
        <span><i class="fa-solid fa-reply" style="margin-right:3px;"></i>${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}</span>
      </div>
      ${replies.length ? `<div style="padding:10px 12px;background:rgba(var(--surface-rgb),0.2);border-radius:10px;margin-bottom:10px;">
        ${replies.map(reply => {
      const author = reply.userId?.fullName || reply.userId?.businessName || 'User';
      return `<div style="margin-bottom:8px;font-size:12px;color:var(--ink);">
            <strong>${escapeHtml(author)}:</strong> ${escapeHtml(reply.message)}<br/>
            <span style="color:var(--ink-soft);font-size:11px;">${fmtTime(reply.createdAt)}</span>
          </div>`;
    }).join('')}
      </div>` : ''}
    </div>`;
  }).join('');
}

async function clearNotifHistory() {
  if (!confirm('Clear all notification history?')) return;
  try {
    await Admin.clearNotifications();
    _notifs = [];
    renderNotifHistory();
    updateNotifDot();
    toast('History cleared', 'info');
  } catch (e) {
    toast('Failed to clear notification history', 'error');
  }
}

async function deleteNotification(id) {
  if (!id) return;
  if (!confirm('Delete this notification?')) return;
  try {
    await Admin.deleteNotification(id);
    _notifs = _notifs.filter(n => (n._id || n.id) !== id);
    renderNotifHistory();
    updateNotifDot();
    toast('Notification deleted', 'info');
  } catch (e) {
    toast('Failed to delete notification', 'error');
  }
}

function openNotifModal(userId) {
  const titleEl = document.getElementById('modalNotifTitle');
  const messageEl = document.getElementById('modalNotifMessage');
  if (titleEl) titleEl.value = '';
  if (messageEl) messageEl.value = '';
  openModal('notifModal');
}

function notifyUser(userId) {
  const user = getUsers().find(u => (u._id || u.id) === userId);
  if (!user) return;
  closeUserDetail();
  showPage('notifications');

  const buttons = document.querySelectorAll('.notif-type-btn');
  if (buttons[1]) selectNotifType('targeted', buttons[1]);

  const sel = document.getElementById('notifTargetUser');
  if (sel) {
    sel.innerHTML = '<option value="">Select a user...</option>' +
      getUsers().map(u => `<option value="${u._id || u.id}" ${(u._id || u.id) === userId ? 'selected' : ''}>${escapeHtml(u.fullName)} — ${escapeHtml(u.businessName)}</option>`).join('');
  }

  const titleEl = document.getElementById('notifTitle');
  if (titleEl) titleEl.focus();
}

// Sends a notification straight to the backend (Notification collection),
// instead of writing only to this browser's localStorage. Without this, a
// notification "sent" via the user-detail modal never reaches the real
// user — their dashboard reads from the API, not from the admin's own
// local storage.
async function sendModalNotification() {
  const titleEl = document.getElementById('modalNotifTitle');
  const messageEl = document.getElementById('modalNotifMessage');
  const priorityEl = document.getElementById('modalNotifPriority');

  if (!titleEl || !messageEl || !priorityEl) { toast('Notification modal is not available', 'error'); return; }

  const title = titleEl.value.trim();
  const message = messageEl.value.trim();
  const priority = priorityEl.value;

  if (!title || !message) { toast('Fill in all fields', 'error'); return; }

  const userId = currentDetailUserId;
  const user = getUsers().find(u => (u._id || u.id) === userId);
  if (!user) return;

  const res = await Admin.notify({
    type: 'targeted',
    title,
    message,
    priority,
    targetUserId: userId
  });

  if (!res?.success) {
    toast(res?.message || 'Failed to send notification', 'error');
    return;
  }

  const nRes = await Admin.notifications();
  _notifs = nRes?.data?.notifications || _notifs;
  renderNotifHistory();

  closeModal('notifModal');
  toast(`Notification sent to ${user.fullName}`, 'success');
}

function updateNotifDot() {
  // dot shown when there are unread notifications
  const dot = document.getElementById('notifDot');
  if (dot) dot.style.display = _notifs.length ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════
function logItemHTML(item) {
  const icons = { register: 'user-plus', login: 'right-to-bracket', suspend: 'ban', notif: 'bell', delete: 'trash', tx: 'receipt' };
  return `
  <div class="log-item" data-log-id="${item.id || ''}">
    <div class="log-icon ${item.type}"><i class="fa-solid fa-${icons[item.type] || 'circle'}"></i></div>
    <div class="log-body">
      <div class="log-text">${item.text}</div>
      <div class="log-time">${fmtTime(item.time)}</div>
    </div>
    ${item.id ? `
    <button class="log-delete-btn" title="Delete this entry" onclick="deleteActivityItem('${item.id}')">
      <i class="fa-solid fa-xmark"></i>
    </button>` : ''}
  </div>`;
}

function renderActivityLog() {
  let log = _activity.slice();
  const type = document.getElementById('filterLogType').value;
  const date = document.getElementById('filterLogDate').value;

  if (type) log = log.filter(l => l.type === type);
  if (date) log = log.filter(l => l.time.startsWith(date));

  const el = document.getElementById('fullActivityLog');
  el.innerHTML = log.length ? log.map(logItemHTML).join('') :
    '<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>No activity found.</p></div>';
}

function clearLogFilters() {
  document.getElementById('filterLogType').value = '';
  document.getElementById('filterLogDate').value = '';
  renderActivityLog();
}

function renderRecentActivityWidget() {
  const log = getActivity().slice(0, 8);
  const logEl = document.getElementById('recentActivityLog');
  if (logEl) {
    logEl.innerHTML = log.length ? log.map(logItemHTML).join('') :
      '<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>No activity yet.</p></div>';
  }
}

async function clearActivityLog() {
  if (!confirm('Clear the entire activity log?')) return;
  try {
    await Admin.clearActivity();
    _activity = [];
    try { localStorage.removeItem('admin_activity'); } catch (e) { /* ignore */ }
    renderActivityLog();
    renderRecentActivityWidget();
    toast('Activity log cleared', 'info');
  } catch (e) {
    toast('Failed to clear activity log', 'error');
  }
}

async function deleteActivityItem(id) {
  if (!id) return;
  if (!confirm('Delete this log entry?')) return;
  try {
    await Admin.deleteActivityItem(id);
    _activity = _activity.filter(a => a.id !== id);
    try { localStorage.setItem('admin_activity', JSON.stringify(_activity)); } catch (e) { /* ignore */ }
    renderActivityLog();
    renderRecentActivityWidget();
    toast('Log entry deleted', 'info');
  } catch (e) {
    toast('Failed to delete entry', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// ALL TRANSACTIONS (ADMIN VIEW)
// ═══════════════════════════════════════════════════════
async function renderPlatformTxStats() {
  try {
    const res = await Admin.transactions();
    if (!res?.success) {
      toast('Failed to load transaction stats', 'error');
      return;
    }

    const { summary, categoryDistribution, methodBreakdown, monthlyTrend } = res.data;

    // ── Summary cards ────────────────────────────────────────────────────────
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set('statTotalTxCount',   (summary.totalTransactions || 0).toLocaleString());
    set('statPlatformIncome', fmt(summary.totalPlatformIncome  || 0));
    set('statPlatformExpense',fmt(summary.totalPlatformExpense || 0));
    set('statAvgTxPerUser',   summary.avgTransactionsPerUser   || 0);
    set('statActiveBooks',    (summary.activeRecordBooks || 0).toLocaleString());

    // ── Category distribution ─────────────────────────────────────────────────
    const catEl = document.getElementById('txCategoryDistribution');
    if (catEl) {
      if (!categoryDistribution?.length) {
        catEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-tag"></i><p>No data yet.</p></div>';
      } else {
        const maxCount = Math.max(...categoryDistribution.map(c => c.count));
        catEl.innerHTML = categoryDistribution.map(c => `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="font-size:12.5px;color:var(--ink);width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c._id) || 'Uncategorised'}</div>
            <div style="flex:1;background:var(--surface-2);border-radius:20px;height:8px;overflow:hidden;">
              <div style="height:8px;border-radius:20px;background:var(--purple);width:${Math.round((c.count / maxCount) * 100)}%;"></div>
            </div>
            <div style="font-size:12px;color:var(--ink-soft);width:40px;text-align:right;">${c.count}</div>
          </div>
        `).join('');
      }
    }

    // ── Payment method breakdown ──────────────────────────────────────────────
    const methodEl = document.getElementById('txMethodBreakdown');
    if (methodEl) {
      if (!methodBreakdown?.length) {
        methodEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No data yet.</p></div>';
      } else {
        const totalMethods = methodBreakdown.reduce((s, m) => s + m.count, 0);
        methodEl.innerHTML = methodBreakdown.map(m => {
          const pct = totalMethods > 0 ? Math.round((m.count / totalMethods) * 100) : 0;
          return `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="font-size:12.5px;color:var(--ink);width:80px;text-transform:capitalize;">${escapeHtml(m._id) || 'Unknown'}</div>
            <div style="flex:1;background:var(--surface-2);border-radius:20px;height:8px;overflow:hidden;">
              <div style="height:8px;border-radius:20px;background:var(--blue);width:${pct}%;"></div>
            </div>
            <div style="font-size:12px;color:var(--ink-soft);width:60px;text-align:right;">${m.count} (${pct}%)</div>
          </div>`;
        }).join('');
      }
    }

    // ── Monthly trend ─────────────────────────────────────────────────────────
    const trendEl = document.getElementById('txMonthlyTrend');
    if (trendEl) {
      if (!monthlyTrend?.length) {
        trendEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-line"></i><p>No data yet.</p></div>';
      } else {
        // Group by year/month and sum income+expense counts separately
        const months = {};
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        monthlyTrend.forEach(r => {
          const key = `${monthNames[r._id.month - 1]} ${r._id.year}`;
          if (!months[key]) months[key] = { income: 0, expense: 0 };
          months[key][r._id.type] = (months[key][r._id.type] || 0) + r.count;
        });

        const entries = Object.entries(months).slice(-6); // last 6 months
        const maxVal  = Math.max(...entries.map(([, v]) => Math.max(v.income, v.expense)), 1);

        trendEl.innerHTML = `
          <div style="display:flex;gap:8px;align-items:flex-end;height:120px;padding:0 4px;">
            ${entries.map(([label, v]) => `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;">
                <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:90px;">
                  <div style="flex:1;background:var(--green);border-radius:4px 4px 0 0;height:${Math.round((v.income/maxVal)*90)}px;" title="Income: ${v.income} tx"></div>
                  <div style="flex:1;background:var(--red);border-radius:4px 4px 0 0;height:${Math.round((v.expense/maxVal)*90)}px;" title="Expense: ${v.expense} tx"></div>
                </div>
                <div style="font-size:10px;color:var(--ink-soft);text-align:center;line-height:1.2;">${label}</div>
              </div>
            `).join('')}
          </div>
          <div style="display:flex;gap:16px;margin-top:10px;font-size:11px;color:var(--ink-soft);">
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--green);border-radius:2px;margin-right:4px;"></span>Income count</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--red);border-radius:2px;margin-right:4px;"></span>Expense count</span>
          </div>
        `;
      }
    }

  } catch (e) {
    console.error('renderPlatformTxStats error:', e);
    toast('Failed to load transaction stats', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════
// NOTE: Feedback has no backend support at all right now — there's no
// Feedback model, no routes, and no submission UI on the user dashboard.
// getFeedback() always returns [] so this page doesn't crash, but it will
// never show real data until that backend feature is actually built.
const getFeedback = () => [];

function renderFeedback() {
  const feedback = getFeedback();
  const tbody = document.getElementById('feedbackBody');

  if (feedback.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-comment-slash"></i><p>Feedback isn't wired up to the backend yet.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = feedback.map(f => `
    <tr>
      <td style="font-size:12px;">${fmtDate(f.date)}</td>
      <td style="font-weight:600;">${escapeHtml(f.userName) || '—'}</td>
      <td><span class="pill info">${escapeHtml(f.type) || 'general'}</span></td>
      <td style="max-width:240px;font-size:12px;">${escapeHtml(f.message) || '—'}</td>
      <td><span class="pill ${f.status || 'pending'}">${f.status || 'pending'}</span></td>
      <td>
        <div class="action-group">
          <button class="btn btn-green btn-sm" data-action="resolve-feedback" data-feedback-id="${f.id}">Resolve</button>
          <button class="btn btn-red btn-sm" data-action="delete-feedback" data-feedback-id="${f.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

function resolveFeedback(id) {
  toast('Feedback isn\'t connected to a backend yet — nothing to resolve', 'info');
}

function deleteFeedback(id) {
  toast('Feedback isn\'t connected to a backend yet — nothing to delete', 'info');
}

function exportFeedbackCSV() {
  toast('No feedback to export — this feature is not wired up yet', 'info');
}

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════
async function savePlatformSettings() {
  const settings = {
    platformName: document.getElementById('settingPlatformName').value,
    defaultCurrency: document.getElementById('settingDefaultCurrency').value,
    supportEmail: document.getElementById('settingSupportEmail').value
  };
  const res = await Admin.updateSettings(settings);
  if (res?.success) {
    _settings = { ..._settings, ...settings };
    toast('Platform settings saved', 'success');
  } else {
    toast(res?.message || 'Failed to save settings', 'error');
  }
}

async function saveAdminAccount() {
  const name = document.getElementById('adminNameInput').value.trim();
  const email = document.getElementById('adminEmailInput').value.trim();
  const newPwd = document.getElementById('adminNewPwd').value;
  const curPwd = document.getElementById('adminCurrentPwd').value;

  if (!name) { toast('Name is required', 'error'); return; }
  if (newPwd && newPwd.length < 6) { toast('New password must be at least 6 characters', 'error'); return; }
  if (newPwd && !curPwd) { toast('Enter your current password to change it', 'error'); return; }

  // Build payload
  const payload = { name, email };
  if (newPwd) { payload.currentPassword = curPwd; payload.newPassword = newPwd; }

  // Use Admin update profile endpoint
  const res = await adminRequest('PUT', '/profile', payload);
  if (res?.success) {
    adminSession.name = name;
    adminSession.email = email;
    localStorage.setItem('admin_session', JSON.stringify(adminSession));

    document.getElementById('adminCurrentPwd').value = '';
    document.getElementById('adminNewPwd').value = '';
    document.getElementById('adminName').textContent = name;
    document.getElementById('adminInitials').textContent = name.charAt(0).toUpperCase();

    toast('Admin account updated', 'success');
  } else {
    toast(res?.message || 'Update failed', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════
async function renderMaintenance() {
  const res = await Admin.maintenanceStats();
  const stats = res?.data || {};

  document.getElementById('storageSize').textContent = (stats.dbSizeKB || '—') + ' KB';
  document.getElementById('storageBar').style.width = Math.min(stats.dbUsagePct || 0, 100) + '%';

  document.getElementById('recordCounts').innerHTML = [
    ['Users', _users.length, 'fa-users', 'var(--blue)'],
    ['Transactions', _txs.length, 'fa-receipt', 'var(--gold)'],
    ['Notifications', _notifs.length, 'fa-bell', 'var(--primary)'],
    ['Activity Logs', _activity.length, 'fa-list', 'var(--text-sec)'],
  ].map(([label, count, icon, color]) => `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;">
        <i class="fa-solid ${icon}" style="color:${color};width:14px;"></i> ${label}
      </div>
      <span style="font-family:var(--heading-font);font-size:14px;font-weight:700;">${count}</span>
    </div>`).join('');
}

// Pulls the real backup payload from the backend (GET /maintenance/export)
// instead of stitching one together from local helper functions that don't
// exist (getBooks/getCats/getFeedback were never defined — calling them
// threw a ReferenceError and the button silently did nothing).
async function exportFullBackup() {
  try {
    const res = await Admin.exportData();
    if (!res?.success) { toast(res?.message || 'Export failed', 'error'); return; }

    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sme-admin-backup-' + new Date().toISOString().split('T')[0] + '.json'; a.click();
    URL.revokeObjectURL(url);
    toast('Full backup downloaded', 'success');
    // No logActivity() call here — the backend's exportPlatformData controller
    // already writes its own activity log entry; refreshAllData() on next
    // load will pick it up. Logging it again here would just be a duplicate,
    // local-only entry that gets thrown away on refresh anyway.
  } catch (e) {
    toast('Export failed', 'error');
  }
}

function importBackup() {
  // There is currently no backend endpoint to restore a backup into MongoDB.
  // The old version of this button wrote straight into localStorage (and
  // called several functions — saveUsers, saveTxs, saveNotifs, saveActivity —
  // that don't exist), so it silently failed and never actually restored
  // anything. Being honest about that here instead of pretending to import.
  toast('Restoring from a backup file isn\'t supported yet — this needs a new backend endpoint', 'info');
}

function handleImport(event) {
  // Intentionally not implemented — see importBackup() above. Clear the
  // file input so a re-selected file still fires the change event.
  event.target.value = '';
}

async function clearAllTransactions() {
  if (!confirm('Delete ALL transactions permanently? This cannot be undone.')) return;
  try {
    await Admin.clearTransactions();
    toast('All transactions deleted', 'info');
    await refreshAllData();
    renderMaintenance();
  } catch (e) {
    toast('Failed to clear transactions', 'error');
  }
}

async function deleteAllUsers() {
  if (!confirm('Delete ALL user accounts? (Admin account will remain)')) return;
  try {
    const users = getUsers();
    await Promise.all(users.map(u => Admin.deleteUser(u._id || u.id).catch(() => null)));
    toast('All users deleted', 'info');
    await refreshAllData();
    renderMaintenance();
    renderOverview();
  } catch (e) {
    toast('Failed to delete all users', 'error');
  }
}

async function nuclearReset() {
  const input = prompt('This wipes EVERYTHING. Type "RESET" to confirm:');
  if (input !== 'RESET') { toast('Reset cancelled', 'info'); return; }

  try {
    const users = getUsers();
    await Promise.all([
      Admin.clearTransactions(),
      ...users.map(u => Admin.deleteUser(u._id || u.id).catch(() => null))
    ]);
    await Admin.clearNotifications();
    await Admin.clearActivity(); // do this last — it also wipes the log of everything above

    toast('Platform reset complete', 'info');
    await refreshAllData();
    renderOverview();
    renderMaintenance();
  } catch (e) {
    toast('Reset failed partway through — check the data carefully', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalPages * PAGE_SIZE);

  let btns = '';
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - currentPage) > 1) {
      if (i === 3 || i === totalPages - 2) btns += `<span style="padding:0 4px;color:var(--ink-soft)">…</span>`;
      continue;
    }
    btns += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  el.innerHTML = `
    <span>Page ${currentPage} of ${totalPages}</span>
    <div class="page-btns">
      <button class="page-btn" data-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      ${btns}
      <button class="page-btn" data-page="${Math.min(totalPages, currentPage + 1)}" ${currentPage === totalPages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>`;

  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.page);
      if (!Number.isFinite(target) || target < 1 || target > totalPages) return;
      onPageChange(target);
    });
  });
}

// ═══════════════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════════════
const pageTitles = {
  overview: 'Overview', analytics: 'Analytics', users: 'All Users',
  userActivity: 'Activity Log', transactions: 'All Transactions',
  notifications: 'Notifications', feedback: 'Feedback',
  settings: 'Settings', maintenance: 'Maintenance'
};

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('pageTitle').textContent = pageTitles[name] || name;

  // Mark nav link active
  document.querySelectorAll('.nav-link').forEach(l => {
    const txt = l.textContent.trim();
    if (txt.startsWith(pageTitles[name]?.split(' ')[0] || '_')) l.classList.add('active');
  });

  // Page-specific renders
  if (name === 'overview') renderOverview();
  if (name === 'analytics') renderAnalytics();
  if (name === 'users') { userPage = 1; renderUsersTable(); }
  if (name === 'userActivity') renderActivityLog();
  if (name === 'transactions') { renderPlatformTxStats(); }
  if (name === 'notifications') renderNotifHistory();
  if (name === 'feedback') renderFeedback();
  if (name === 'maintenance') renderMaintenance();

  closeSidebar();
}

function handleGlobalSearch() {
  const q = document.getElementById('globalSearch').value;
  if (q.length > 0) { showPage('users'); document.getElementById('searchUser').value = q; renderUsersTable(); }
}

// ═══════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

// ═══════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const div = document.createElement('div');
  div.className = 'toast ' + type;
  const icons = { success: 'circle-check', error: 'circle-xmark', info: 'circle-info', warning: 'triangle-exclamation' };
  div.innerHTML = `<i class="fa-solid fa-${icons[type] || 'circle-info'}"></i> ${escapeHtml(msg)}`;
  container.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity 0.3s'; setTimeout(() => div.remove(), 300); }, 3000);
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
function adminLogout() {
  if (!confirm('Sign out of Admin Panel?')) return;
  Admin.logout();
}

// ═══════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════
init();