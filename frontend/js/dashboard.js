// ══════════════════════════════════════════════════════
// APP STATE
// Everything in the app lives here.
// ══════════════════════════════════════════════════════
let session = null;  // logged-in user
let activeBookId = null;  // current record book
let barChartInst = null;
let pieChartInst = null;
let currency = localStorage.getItem('sme_currency') || '₦';

// Ensure Chart.js uses the device pixel ratio for sharp rendering
try { if (window.Chart) Chart.defaults.devicePixelRatio = window.devicePixelRatio || 1; } catch (e) { /* ignore */ }

// ══════════════════════════════════════════════════════
// HELPERS: localStorage storage
// Think of localStorage as a small database inside the browser.
// JSON.stringify converts a JS object to a text string for storage.
// JSON.parse converts that text string back to a JS object.
// ══════════════════════════════════════════════════════

// In-memory cache
let _books = [];
let _txs = [];
let _categories = [];
let _notifications = [];
let _notificationActiveTab = 'all';
const NOTIFICATION_STORAGE_PREFIX = 'sme_notifs_';

// Format number as currency
function fmt(num) {
  return currency + Number(num || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

// Format date nicely
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ══════════════════════════════════════════════════════
// INIT: runs when the page loads
// ══════════════════════════════════════════════════════
async function init() {
  session = await Auth.requireAuth();
  if (!session) return;
  session.userId = session._id || session.id;
  currency = localStorage.getItem('sme_currency') || '₦';

  const el_sidebarName = document.getElementById('sidebarName');
  const el_sidebarBiz = document.getElementById('sidebarBiz');
  const el_userInitials = document.getElementById('userInitials');
  const el_txDate = document.getElementById('txDate');
  const el_txDate2 = document.getElementById('txDate2');
  const el_settingName = document.getElementById('settingName');
  const el_settingBiz = document.getElementById('settingBiz');
  const el_settingEmail = document.getElementById('settingEmail');

  if (el_sidebarName) el_sidebarName.textContent = session.fullName;
  if (el_sidebarBiz) el_sidebarBiz.textContent = session.businessName;
  if (el_userInitials) el_userInitials.textContent = session.fullName.charAt(0).toUpperCase();

  const today = new Date().toISOString().split('T')[0];
  if (el_txDate) el_txDate.value = today;
  if (el_txDate2) el_txDate2.value = today;
  if (el_settingName) el_settingName.value = session.fullName;
  if (el_settingBiz) el_settingBiz.value = session.businessName;
  if (el_settingEmail) el_settingEmail.value = session.email || '';

  await loadAllData();
  await loadUserNotifications();
  attachDashboardEventHandlers();
}

function attachDashboardEventHandlers() {
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action],[data-page]');
    if (!target) return;

    if (target.dataset.action) {
      event.preventDefault();
      const action = target.dataset.action.trim();
      const payload = target.dataset.value ?? target.dataset.tab ?? target.dataset.txId ?? target.dataset.bookId ?? target.dataset.catId;

      if (action === 'closeModal' && target.dataset.target) {
        return closeModal(target.dataset.target);
      }

      if (payload !== undefined) {
        return callDashboardHandler(action, [payload]);
      }

      return callDashboardHandler(action, []);
    }

    if (target.dataset.page) {
      event.preventDefault();
      return showPage(target.dataset.page);
    }
  });

  document.addEventListener('change', event => {
    const target = event.target.closest('[data-change]');
    if (!target) return;
    const handlerName = target.dataset.change.trim().replace(/\(\s*\)$/, '');
    callDashboardHandler(handlerName, [event]);
  });

  document.addEventListener('input', event => {
    const target = event.target.closest('[data-input]');
    if (!target) return;
    const handlerName = target.dataset.input.trim().replace(/\(\s*\)$/, '');
    callDashboardHandler(handlerName, [event]);
  });

  // Logout button (not using data-action) — ensure it's wired
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
}

function callDashboardHandler(handlerName, args = []) {
  const fn = typeof window[handlerName] === 'function' ? window[handlerName] : null;
  if (!fn) {
    console.warn('Dashboard handler not found:', handlerName);
    return;
  }
  return fn(...args);
}

async function loadAllData() {
  try {
    const [booksRes, catsRes] = await Promise.all([Books.list(), Categories.list()]);
    _books = booksRes?.data?.books || [];
    _categories = catsRes?.data?.categories || [];

    if (_books.length === 0) {
      const res = await Books.create({
        name: (session.businessName || 'My Business') + ' — Main Book',
        currency: 'NGN'
      });
      if (res?.success) _books = [res.data.book];
    }

    if (_books.length > 0) {
      activeBookId = _books[0]._id || _books[0].id;
    }

    refreshCategoryDropdowns();
    renderBookSwitcher();
    await loadTxsForBook(activeBookId);
    refreshDashboard();
  } catch (e) {
    console.error('loadAllData error:', e);
    toast('Failed to load data. Please refresh.', 'error');
  }
}

function getNotificationStorageKey() {
  return session?.userId ? NOTIFICATION_STORAGE_PREFIX + session.userId : null;
}

function getLocalNotifications() {
  const key = getNotificationStorageKey();
  if (!key) return [];
  try {
    return JSON.parse(localStorage.getItem(key) || '[]') || [];
  } catch (e) {
    return [];
  }
}

function saveLocalNotifications(notifs = []) {
  const key = getNotificationStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(notifs));
  } catch (e) {
    console.warn('Unable to write local notifications', e);
  }
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeNotification(n = {}) {
  const readBy = Array.isArray(n.readBy) ? n.readBy : [];
  const replies = Array.isArray(n.replies) ? n.replies : [];
  const read = !!(
    n.read === true ||
    n.isRead === true ||
    (session?.userId && readBy.some(u => String(u) === String(session.userId)))
  );

  return {
    id: n._id || n.id || '',
    title: n.title || 'Notification',
    message: n.message || '',
    type: n.type || 'broadcast',
    priority: n.priority || 'normal',
    createdAt: n.createdAt || n.sentAt || Date.now(),
    read,
    replies,
    replyCount: replies.length
  };
}

async function loadUserNotifications() {
  if (!session?.userId) return [];

  let notifs = [];
  let fetchedFromServer = false;

  try {
    const res = await UserNotifications.list();
    if (res?.success && Array.isArray(res.data.notifications)) {
      notifs = res.data.notifications.map(normalizeNotification);
      fetchedFromServer = true;
    }
  } catch (e) {
    console.warn('Notification fetch failed:', e);
  }

  if (!fetchedFromServer) {
    notifs = getLocalNotifications().map(normalizeNotification);
  }

  _notifications = notifs;
  updateNotificationBadge(_notifications);

  if (fetchedFromServer) {
    saveLocalNotifications(_notifications);
  }

  return _notifications;
}

function updateNotificationBadge(notifs = _notifications) {
  const badge = document.getElementById('notifBadge');
  const button = document.querySelector('[data-action="showNotifications"]');
  if (!badge) return;

  const unreadCount = (notifs || []).filter(n => !n.read).length;
  badge.textContent = unreadCount > 0 ? String(unreadCount) : '';
  badge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  if (button) button.classList.toggle('has-unread', unreadCount > 0);
}

function formatNotificationTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

function renderNotificationPanel(activeTab = _notificationActiveTab) {
  _notificationActiveTab = activeTab;
  const modal = document.getElementById('userNotifModal');
  if (!modal) return;

  const listEl = modal.querySelector('#userNotifList');
  const countEl = modal.querySelector('#notificationSummary');
  const tabButtons = modal.querySelectorAll('.notif-tab');
  const total = _notifications.length;
  const unread = _notifications.filter(n => !n.read).length;

  if (countEl) {
    countEl.textContent = `${unread} unread / ${total} total`;
  }

  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === activeTab);
  });

  const filtered = _notifications.filter(n => {
    if (activeTab === 'unread') return !n.read;
    if (activeTab === 'read') return n.read;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!listEl) return;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-state" style="padding:30px 0;text-align:center;">
      <i class="fa-solid fa-bell-slash"></i>
      <p>${activeTab === 'read' ? 'No read notifications yet.' : activeTab === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</p>
    </div>`;
    return;
  }

  listEl.innerHTML = filtered.map(n => `
    <div class="notif-card ${n.read ? 'read' : 'unread'}" id="notifCard_${n.id}">
      <div class="notif-meta">
        <div class="notif-title">${escapeHTML(n.title)}</div>
        <div class="notif-time">${formatNotificationTime(n.createdAt)}</div>
      </div>
      <div class="notif-message">${escapeHTML(n.message)}</div>
      ${n.replyCount ? `
        <div class="notif-replies-summary">
          <strong>${n.replyCount}</strong> repl${n.replyCount === 1 ? 'y' : 'ies'}
        </div>
      ` : ''}
      ${n.replyCount ? `
        <div class="notif-replies-list">
          ${n.replies.map(reply => `
            <div class="notif-reply-item">
              <div class="notif-reply-text">${escapeHTML(reply.message)}</div>
              <div class="notif-reply-time">${formatNotificationTime(reply.createdAt)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="notif-footer">
        <div class="notif-actions">
          <button class="btn-link" data-action="toggleNotifReply" data-value="${n.id}">Reply</button>
          ${n.read ? '' : `<button class="btn-link" data-action="markNotifRead" data-value="${n.id}">Mark as read</button>`}
        </div>
        <div class="notif-status">${n.read ? 'Read' : 'Unread'}</div>
      </div>
      <div class="notif-reply-box">
        <textarea id="notifReply_${n.id}" class="notif-reply-input" placeholder="Reply to this notification..."></textarea>
        <button class="btn btn-secondary btn-sm" data-action="submitNotifReply" data-value="${n.id}">Send reply</button>
      </div>
    </div>
  `).join('');
}

async function markNotificationAsRead(id) {
  if (!id) return;
  const notif = _notifications.find(n => n.id === id);
  if (!notif || notif.read) return;

  notif.read = true;
  saveLocalNotifications(_notifications);
  updateNotificationBadge(_notifications);
  renderNotificationPanel(_notificationActiveTab);

  try {
    await UserNotifications.markRead(id);
  } catch (e) {
    console.warn('Unable to mark notification as read:', e);
  }
}

async function markAllNotificationsRead() {
  const unreadItems = _notifications.filter(n => !n.read);
  if (!unreadItems.length) return;

  unreadItems.forEach(n => n.read = true);
  saveLocalNotifications(_notifications);
  updateNotificationBadge(_notifications);
  renderNotificationPanel(_notificationActiveTab);

  await Promise.all(unreadItems.map(n => UserNotifications.markRead(n.id).catch(() => null)));
}

async function submitNotifReply(id) {
  if (!id) return;
  const textarea = document.getElementById('notifReply_' + id);
  if (!textarea) return;

  const message = textarea.value.trim();
  if (!message) {
    return toast('Please enter a reply message', 'error');
  }

  textarea.disabled = true;

  try {
    const res = await UserNotifications.reply(id, message);
    if (!res?.success) {
      throw new Error(res?.message || 'Reply failed');
    }

    const notif = _notifications.find(n => n.id === id);
    if (notif) {
      notif.read = true;
      notif.replies = Array.isArray(res.data.replies) ? res.data.replies : (notif.replies || []);
      notif.replyCount = notif.replies.length;
    }

    saveLocalNotifications(_notifications);
    updateNotificationBadge(_notifications);
    renderNotificationPanel(_notificationActiveTab);
    toast('Reply sent', 'success');
  } catch (e) {
    console.warn('Unable to send reply:', e);
    toast(e.message || 'Unable to send reply', 'error');
  } finally {
    textarea.disabled = false;
  }
}

function toggleNotifReply(id) {
  if (!id) return;
  const card = document.getElementById('notifCard_' + id);
  if (!card) return;

  const open = !card.classList.contains('reply-open');
  document.querySelectorAll('.notif-card.reply-open').forEach(el => el.classList.remove('reply-open'));
  document.querySelectorAll('[data-action="toggleNotifReply"]').forEach(btn => btn.textContent = 'Reply');

  if (open) {
    card.classList.add('reply-open');
    const button = card.querySelector('[data-action="toggleNotifReply"]');
    if (button) button.textContent = 'Cancel';
    const textarea = card.querySelector('.notif-reply-input');
    if (textarea) textarea.focus();
  }
}

// ══════════════════════════════════════════════════════
// RECORD BOOKS
// ══════════════════════════════════════════════════════
function renderBookSwitcher() {
  const sel = document.getElementById('activeBookSelect');
  if (!sel) return;
  sel.innerHTML = '';
  if (_books.length === 0) {
    sel.innerHTML = '<option value="">No books yet</option>';
    return;
  }
  _books.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b._id || b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
  if (activeBookId) sel.value = activeBookId;
  activeBookId = sel.value;
}

async function onBookSwitch() {
  const sel = document.getElementById('activeBookSelect');
  if (!sel) return;
  activeBookId = sel.value;
  if (!activeBookId) return;
  await loadTxsForBook(activeBookId);
  refreshDashboard();
  renderTransactionsPage();
  renderCategoriesPage();
}

async function loadTxsForBook(bookId) {
  if (!bookId) { _txs = []; return; }
  try {
    const res = await Transactions.list({ bookId, limit: 20 });
    _txs = (res?.success && res?.data?.transactions) ? res.data.transactions : [];
  } catch (e) {
    console.error('loadTxsForBook error:', e);
    _txs = [];
  }
}

function renderBooksPage() {
  const books = _books;

  let html = `<div class="add-book-card" data-action="openBookModal">
    <i class="fa-solid fa-plus"></i><span>New Record Book</span>
  </div>`;

  books.forEach(b => {
    const income = b.totalIncome || 0;
    const expense = b.totalExpense || 0;
    const id = b._id || b.id;
    html += `
    <div class="book-card" data-action="switchBook" data-book-id="${id}">
      <div class="book-icon"><i class="fa-solid fa-book-open"></i></div>
      <div class="book-name">${escapeHTML(b.name)}</div>
      <div class="book-meta">Created ${fmtDate(b.createdAt)}</div>
      <div class="book-stats">
        <div class="book-stat">
          <div class="book-stat-val" style="color:var(--primary)">${fmt(income)}</div>
          <div class="book-stat-lbl">Income</div>
        </div>
        <div class="book-stat">
          <div class="book-stat-val" style="color:var(--red)">${fmt(expense)}</div>
          <div class="book-stat-lbl">Expenses</div>
        </div>
        <div class="book-stat">
          <div class="book-stat-val">${fmt(income - expense)}</div>
          <div class="book-stat-lbl">Balance</div>
        </div>
      </div>
    </div>`;
  });

  const booksGrid = document.getElementById('booksGrid');
  if (booksGrid) booksGrid.innerHTML = html;
}

async function switchBook(bookId) {
  activeBookId = bookId;
  const sel = document.getElementById('activeBookSelect');
  if (sel) sel.value = bookId;
  await loadTxsForBook(bookId);
  refreshDashboard();
  showPage('dashboard');
  toast('Record book switched', 'info');
}

function openBookModal() {
  const el_bookName = document.getElementById('bookName');
  if (el_bookName) el_bookName.value = '';
  openModal('bookModal');
}

async function saveBook() {
  const el_bookName = document.getElementById('bookName');
  const el_bookCurrency = document.getElementById('bookCurrency');

  if (!el_bookName || !el_bookCurrency) {
    toast('Book form elements not found', 'error');
    return;
  }

  const name = el_bookName.value.trim();
  const cur = el_bookCurrency.value || 'NGN';

  if (!name) {
    toast('Please enter a book name', 'error');
    return;
  }

  const res = await Books.create({
    name,
    currency: cur
  });

  if (res?.success) {

    activeBookId = res.data.book._id || res.data.book.id;

    // Reload fresh books from backend
    const booksRes = await Books.list();
    _books = booksRes?.data?.books || [];

    closeModal('bookModal');

    renderBookSwitcher();

    await loadTxsForBook(activeBookId);

    renderBooksPage();

    refreshDashboard();

    toast('Record book created!', 'success');

  } else {
    toast(res?.message || 'Failed to create book', 'error');
  }
}

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
function refreshDashboard() {
  const period = document.getElementById('dashPeriod')?.value || 'month';
  let txs = _txs.slice();

  // Filter by period
  txs = filterByPeriod(txs, period);

  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;
  const pm = t => t.paymentMethod || t.method || 'cash';
  const cash = txs.filter(t => pm(t) === 'cash').reduce((s, t) => {
    return s + (t.type === 'income' ? t.amount : -t.amount);
  }, 0);

  const incomeTxs = txs.filter(t => t.type === 'income').length;
  const expenseTxs = txs.filter(t => t.type === 'expense').length;

  const dashElements = {
    income: document.getElementById('dashIncome'),
    expense: document.getElementById('dashExpense'),
    balance: document.getElementById('dashBalance'),
    cash: document.getElementById('dashCash'),
    incomeTx: document.getElementById('dashIncomeTx'),
    expenseTx: document.getElementById('dashExpenseTx'),
    balanceNote: document.getElementById('dashBalanceNote'),
    cashNote: document.getElementById('dashCashNote')
  };

  if (dashElements.income) dashElements.income.textContent = fmt(income);
  if (dashElements.expense) dashElements.expense.textContent = fmt(expense);
  if (dashElements.balance) dashElements.balance.textContent = fmt(balance);
  if (dashElements.cash) dashElements.cash.textContent = fmt(Math.max(0, cash));
  if (dashElements.incomeTx) dashElements.incomeTx.textContent = incomeTxs + ' transaction' + (incomeTxs !== 1 ? 's' : '');
  if (dashElements.expenseTx) dashElements.expenseTx.textContent = expenseTxs + ' transaction' + (expenseTxs !== 1 ? 's' : '');
  if (dashElements.balanceNote) dashElements.balanceNote.textContent = balance >= 0 ? 'Profit' : 'Loss';
  if (dashElements.cashNote) dashElements.cashNote.textContent = 'Cash transactions only';

  renderRecentTx(txs);
  renderBarChart(txs);
  renderPieChart(txs);
}

function filterByPeriod(txs, period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'all') return txs;
  if (period === 'today') return txs.filter(t => new Date(t.date) >= today);

  if (period === 'week') {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    return txs.filter(t => new Date(t.date) >= weekStart);
  }

  if (period === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return txs.filter(t => new Date(t.date) >= monthStart);
  }

  return txs;
}

function renderRecentTx(txs) {
  const recent = [...txs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  const tbody = document.getElementById('recentTxBody');
  if (!tbody) return;

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        <p>No transactions yet. Add your first one!</p>
        <button class="btn-green" style="width:auto;padding:10px 18px;" data-page="addIncome">
          <i class="fa-solid fa-plus"></i> Add Transaction
        </button>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td><span class="type-badge ${t.type}">${t.type}</span></td>
      <td>${escapeHTML(t.category) || '—'}</td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(t.description || t.desc) || '—'}</td>
      <td><i class="fa-solid fa-${((t.paymentMethod || t.method) === 'cash' ? 'money-bill' : 'building-columns')}" style="color:var(--text-sec); margin-right:4px;"></i>${capitalize(t.paymentMethod || t.method || 'cash')}</td>
      <td class="amount-${t.type}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td>
    </tr>
  `).join('');
}

// ══════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════
function renderBarChart(txs) {
  // Group by month (last 6 months)
  const months = [];
  const incomes = [];
  const expenses = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleString('default', { month: 'short' });
    const yr = d.getFullYear();
    const mo = d.getMonth();
    const filtered = txs.filter(t => {
      const td = new Date(t.date);
      return td.getFullYear() === yr && td.getMonth() === mo;
    });
    months.push(label);
    incomes.push(filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
    expenses.push(filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  }

  if (barChartInst) barChartInst.destroy();

  const canvasEl = document.getElementById('barChart');
  if (!canvasEl) return;

  const ctx = canvasEl.getContext('2d');
  barChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: 'Income', data: incomes, backgroundColor: 'rgba(139,92,246,0.7)', borderRadius: 6 },
        { label: 'Expense', data: expenses, backgroundColor: 'rgba(255,77,109,0.7)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: '#eef0f5' }, ticks: { callback: v => currency + v.toLocaleString() } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderPieChart(txs) {
  const expTxs = txs.filter(t => t.type === 'expense');
  const catMap = {};

  expTxs.forEach(t => {
    const cat = t.category || 'Other';
    catMap[cat] = (catMap[cat] || 0) + t.amount;
  });

  const labels = Object.keys(catMap);
  const data = Object.values(catMap);
  const colors = ['#ff4d6d', '#f5a623', '#3b82f6', '#7c3aed', '#8B5CF6', '#06b6d4', '#10b981', '#f59e0b'];

  const canvasEl = document.getElementById('pieChart');
  if (!canvasEl) return;

  if (pieChartInst) pieChartInst.destroy();

  const ctx = canvasEl.getContext('2d');

  if (labels.length === 0) {
    pieChartInst = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: ['#e8eaef'] }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
    });
    return;
  }

  pieChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } },
      cutout: '60%'
    }
  });
}

// ══════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════
function setTxType(type) { /* used by toggle buttons */ }

function switchToExpense() { showPage('addExpense'); }
function switchToIncome() { showPage('addIncome'); }

function clearTxForm() {
  ['txAmount', 'txDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const el_txDate = document.getElementById('txDate');
  const el_txCategory = document.getElementById('txCategory');
  const el_txSubCategory = document.getElementById('txSubCategory');
  if (el_txDate) el_txDate.value = new Date().toISOString().split('T')[0];
  if (el_txCategory) el_txCategory.value = '';
  if (el_txSubCategory) el_txSubCategory.value = '';
}

function clearTxForm2() {
  ['txAmount2', 'txDesc2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const el_txDate2 = document.getElementById('txDate2');
  const el_txCategory2 = document.getElementById('txCategory2');
  const el_txSubCategory2 = document.getElementById('txSubCategory2');
  if (el_txDate2) el_txDate2.value = new Date().toISOString().split('T')[0];
  if (el_txCategory2) el_txCategory2.value = '';
  if (el_txSubCategory2) el_txSubCategory2.value = '';
}

function saveTransaction() { saveTx('income'); }
function saveTransaction2() { saveTx('expense'); }

async function saveTx(type) {
  const suffix = type === 'income' ? '' : '2';
  const el_amt = document.getElementById('txAmount' + suffix);
  const el_method = document.getElementById('txMethod' + suffix);
  const el_cat = document.getElementById('txCategory' + suffix);
  const el_subCat = document.getElementById('txSubCategory' + suffix);
  const el_desc = document.getElementById('txDesc' + suffix);
  const el_date = document.getElementById('txDate' + suffix);

  if (!el_amt || !el_method || !el_cat || !el_subCat || !el_desc || !el_date) {
    toast('Transaction form elements not found', 'error');
    return;
  }

  const rawAmt = el_amt.value;
  const amount = parseFloat(rawAmt);
  const method = el_method.value || 'cash';
  const cat = el_cat.value || 'Uncategorized';
  const subCat = el_subCat.value || '';
  const desc = el_desc.value.trim();
  const date = el_date.value;

  if (!rawAmt || isNaN(amount) || amount <= 0) {
    toast('Please enter a valid amount', 'error'); return;
  }
  if (!activeBookId) {
    toast('No record book selected. Create one first.', 'error'); return;
  }
  if (!date) {
    toast('Please select a date', 'error'); return;
  }

  const res = await Transactions.create({
    bookId: activeBookId,
    type,
    amount,
    paymentMethod: method,
    category: cat,
    subCategory: subCat,
    description: desc,
    date
  });

  if (res?.success) {
    _txs.unshift(res.data.transaction);
    const booksRes = await Books.list();
    _books = booksRes?.data?.books || [];
    type === 'income' ? clearTxForm() : clearTxForm2();
    toast(capitalize(type) + ' recorded!', 'success');
    refreshDashboard();
    renderTransactionsPage();
  } else {
    toast(res?.message || 'Failed to save. Check console for details.', 'error');
    console.error('saveTx error:', res);
  }
}

function renderTransactionsPage() {
  let txs = _txs.slice();
  const el_filterType = document.getElementById('filterType');
  const el_filterMethod = document.getElementById('filterMethod');
  const el_filterCategory = document.getElementById('filterCategory');
  const el_filterFrom = document.getElementById('filterFrom');
  const el_filterTo = document.getElementById('filterTo');
  const el_globalSearch = document.getElementById('globalSearch');

  const type = el_filterType?.value || '';
  const meth = el_filterMethod?.value || '';
  const cat = el_filterCategory?.value || '';
  const from = el_filterFrom?.value || '';
  const to = el_filterTo?.value || '';
  const search = (el_globalSearch?.value || '').toLowerCase();

  if (type) txs = txs.filter(t => t.type === type);
  const pm2 = t => t.paymentMethod || t.method || 'cash';
  if (meth) txs = txs.filter(t => pm2(t) === meth);
  if (cat) txs = txs.filter(t => t.category === cat);
  if (from) txs = txs.filter(t => t.date >= from);
  if (to) txs = txs.filter(t => t.date <= to);
  if (search) txs = txs.filter(t =>
    (t.description || t.desc || '').toLowerCase().includes(search) ||
    (t.category || '').toLowerCase().includes(search)
  );

  txs.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tbody = document.getElementById('allTxBody');

  if (txs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No transactions match your filters.</p></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = txs.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td><span class="type-badge ${t.type}">${t.type}</span></td>
      <td>${escapeHTML(t.category) || '—'}</td>
      <td>${escapeHTML(t.subCategory) || '—'}</td>
      <td style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(t.description || t.desc) || '—'}</td>
      <td>${capitalize(t.paymentMethod || t.method || 'cash')}</td>
      <td class="amount-${t.type}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn del" data-action="deleteTx" data-tx-id="${t._id || t.id}" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deleteTx(id) {
  if (!confirm('Delete this transaction?')) return;
  const res = await Transactions.delete(id);
  if (res?.success) {
    _txs = _txs.filter(t => String(t._id || t.id) !== String(id));
    renderTransactionsPage();
    refreshDashboard();
    toast('Transaction deleted', 'info');
  } else {
    toast(res?.message || 'Failed to delete', 'error');
  }
}

function clearFilters() {
  const el_filterType = document.getElementById('filterType');
  const el_filterMethod = document.getElementById('filterMethod');
  const el_filterCategory = document.getElementById('filterCategory');
  const el_filterFrom = document.getElementById('filterFrom');
  const el_filterTo = document.getElementById('filterTo');

  if (el_filterType) el_filterType.value = '';
  if (el_filterMethod) el_filterMethod.value = '';
  if (el_filterCategory) el_filterCategory.value = '';
  if (el_filterFrom) el_filterFrom.value = '';
  if (el_filterTo) el_filterTo.value = '';

  renderTransactionsPage();
}

function handleSearch() {
  const el_pageTransactions = document.getElementById('page-transactions');
  if (el_pageTransactions && el_pageTransactions.classList.contains('active')) {
    renderTransactionsPage();
  }
}

// ══════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════
function renderCategoriesPage() {
  const cats = _categories.slice();
  const grid = document.getElementById('catGrid');

  if (cats.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-tags"></i><p>No categories yet. Add your first one!</p></div>`;
    return;
  }

  grid.innerHTML = cats.map(c => `
    <div class="cat-card">
      <div class="cat-header">
        <div class="cat-name">${escapeHTML(c.name)}</div>
        <span class="cat-type ${c.type}">${c.type}</span>
      </div>
      <div class="sub-tags">
        ${(c.subCategories || []).map(s => `<span class="sub-tag">${escapeHTML(s)}</span>`).join('')}
      </div>
      <div class="cat-actions">
        <button class="action-btn del" data-action="deleteCat" data-cat-id="${c._id || c.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join('');

  // Also refresh category dropdowns in transaction forms
  refreshCategoryDropdowns();
}

function refreshCategoryDropdowns() {
  const cats = _categories.slice();
  const incCats = cats.filter(c => c.type === 'income');
  const expCats = cats.filter(c => c.type === 'expense');

  const buildOpts = (list) => {
    let o = '<option value="">Select category</option>';
    list.forEach(c => o += `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`);
    return o;
  };

  const el_txCategory = document.getElementById('txCategory');
  const el_txCategory2 = document.getElementById('txCategory2');
  const el_filterCategory = document.getElementById('filterCategory');

  if (el_txCategory) el_txCategory.innerHTML = buildOpts(incCats);
  if (el_txCategory2) el_txCategory2.innerHTML = buildOpts(expCats);

  // Filter page category dropdown
  if (el_filterCategory) {
    const allOpts = '<option value="">All Categories</option>' +
      cats.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)} (${c.type})</option>`).join('');
    el_filterCategory.innerHTML = allOpts;
  }
}

function loadSubCategories() {
  loadSubs('txCategory', 'txSubCategory', 'income');
}

function loadSubCategories2() {
  loadSubs('txCategory2', 'txSubCategory2', 'expense');
}

function loadSubs(catSelectId, subSelectId, type) {
  const catSelect = document.getElementById(catSelectId);
  const subSel = document.getElementById(subSelectId);

  if (!catSelect || !subSel) return;

  const selectedName = catSelect.value;
  const cats = _categories.filter(c => c.type === type);
  const found = cats.find(c => c.name === selectedName);

  subSel.innerHTML = '<option value="">Select sub-category</option>';

  if (found && found.subCategories) {
    found.subCategories.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      subSel.appendChild(opt);
    });
  }
}

function openCatModal() {
  const el_catName = document.getElementById('catName');
  const el_catSubs = document.getElementById('catSubs');

  if (el_catName) el_catName.value = '';
  if (el_catSubs) el_catSubs.value = '';
  openModal('catModal');
}

async function saveCategory() {
  const el_catName = document.getElementById('catName');
  const el_catType = document.getElementById('catType');
  const el_catSubs = document.getElementById('catSubs');

  if (!el_catName || !el_catType || !el_catSubs) {
    toast('Category form elements not found', 'error');
    return;
  }

  const name = el_catName.value.trim();
  const type = el_catType.value;
  const subs = el_catSubs.value
    .split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (!name) { toast('Please enter a category name', 'error'); return; }

  const res = await Categories.create({ name, type, subCategories: subs });
  if (res?.success) {
    _categories.push(res.data.category);
    closeModal('catModal');
    renderCategoriesPage();
    toast('Category added!', 'success');
  } else {
    toast(res?.message || 'Failed to save category', 'error');
  }
}

async function deleteCat(id) {
  if (!confirm('Delete this category?')) return;
  const res = await Categories.delete(id);
  if (res?.success) {
    _categories = _categories.filter(c => (c._id || c.id) !== id);
    renderCategoriesPage();
    toast('Category deleted', 'info');
  } else {
    toast(res?.message || 'Failed to delete', 'error');
  }
}

// ══════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════
function renderReports() {
  const txs = _txs.slice();

  // Monthly chart (last 6 months)
  const months = [], incomes = [], expenses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const yr = d.getFullYear(), mo = d.getMonth();
    const filtered = txs.filter(t => { const td = new Date(t.date); return td.getFullYear() === yr && td.getMonth() === mo; });
    months.push(d.toLocaleString('default', { month: 'short' }));
    incomes.push(filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
    expenses.push(filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  }

  const monthlyChartEl = document.getElementById('monthlyChart');
  if (!monthlyChartEl) return;
  const mCtx = monthlyChartEl.getContext('2d');
  new Chart(mCtx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        { label: 'Income', data: incomes, borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.1)', fill: true, tension: 0.4 },
        { label: 'Expense', data: expenses, borderColor: '#ff4d6d', backgroundColor: 'rgba(255,77,109,0.1)', fill: true, tension: 0.4 }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { grid: { color: '#eef' } } } }
  });

  // Cash vs Bank chart
  const pm = t => t.paymentMethod || t.method || 'cash';
  const cashInc = txs.filter(t => t.type === 'income' && pm(t) === 'cash').reduce((s, t) => s + t.amount, 0);
  const bankInc = txs.filter(t => t.type === 'income' && pm(t) === 'bank').reduce((s, t) => s + t.amount, 0);
  const cashExp = txs.filter(t => t.type === 'expense' && pm(t) === 'cash').reduce((s, t) => s + t.amount, 0);
  const bankExp = txs.filter(t => t.type === 'expense' && pm(t) === 'bank').reduce((s, t) => s + t.amount, 0);

  const methodChartEl = document.getElementById('methodChart');
  if (!methodChartEl) return;
  const mCtx2 = methodChartEl.getContext('2d');
  new Chart(mCtx2, {
    type: 'bar',
    data: {
      labels: ['Cash', 'Bank'],
      datasets: [
        { label: 'Income', data: [cashInc, bankInc], backgroundColor: 'rgba(139,92,246,0.7)', borderRadius: 6 },
        { label: 'Expense', data: [cashExp, bankExp], backgroundColor: 'rgba(255,77,109,0.7)', borderRadius: 6 }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  // Category breakdown cards
  const expTxs = txs.filter(t => t.type === 'expense');
  const catMap = {};
  expTxs.forEach(t => { const c = t.category || 'Other'; catMap[c] = (catMap[c] || 0) + t.amount; });
  const totalExp = Object.values(catMap).reduce((s, v) => s + v, 0);

  const container = document.getElementById('categoryBreakdown');
  container.innerHTML = Object.entries(catMap).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
    const pct = totalExp ? Math.round(amt / totalExp * 100) : 0;
    return `
    <div style="background:var(--surface-2); border-radius:10px; padding:14px; border:1px solid var(--border);">
      <div style="font-size:13px; font-weight:600; color:var(--text); margin-bottom:6px;">${escapeHTML(cat)}</div>
      <div style="font-size:16px; font-weight:700; color:var(--red);">${fmt(amt)}</div>
      <div style="background:var(--border); border-radius:20px; height:4px; margin-top:8px;">
        <div style="background:var(--red); border-radius:20px; height:4px; width:${pct}%;"></div>
      </div>
      <div style="font-size:11px; color:var(--text-sec); margin-top:4px;">${pct}% of expenses</div>
    </div>`;
  }).join('') || '<div style="color:var(--text-sec); font-size:13px;">No expense data yet.</div>';
}

// ══════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════
function exportCSV() {
  const txs = _txs.slice();
  if (txs.length === 0) { toast('No transactions to export', 'error'); return; }

  const headers = ['Date', 'Type', 'Category', 'Sub-Category', 'Description', 'Method', 'Amount'];
  const rows = txs.map(t => [
    t.date, t.type, t.category || '', t.subCategory || '',
    (t.description || t.desc || '').replace(/,/g, ';'), t.paymentMethod || t.method || 'cash', t.amount
  ]);

  const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sme-record-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported!', 'success');
}

function downloadBackup() {
  const data = {
    exportedAt: new Date().toISOString(),
    user: session,
    books: _books,
    transactions: _txs,
    categories: _categories
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sme-backup-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded!', 'success');
}

// ══════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════
async function saveSettings() {
  const el_settingName = document.getElementById('settingName');
  const el_settingBiz = document.getElementById('settingBiz');
  const el_settingEmail = document.getElementById('settingEmail');
  const el_settingCurrency = document.getElementById('settingCurrency');

  if (!el_settingName || !el_settingBiz || !el_settingEmail || !el_settingCurrency) {
    toast('Settings form elements not found', 'error');
    return;
  }

  const name = el_settingName.value.trim();
  const biz = el_settingBiz.value.trim();
  const email = el_settingEmail.value.trim();
  const cur = el_settingCurrency.value;

  if (!name || !biz) { toast('Name and business name are required', 'error'); return; }

  const res = await Auth.update({ fullName: name, businessName: biz, email });
  if (res?.success) {
    session.fullName = name; session.businessName = biz; session.email = email;
    setSession(session);
    currency = cur; localStorage.setItem('sme_currency', cur);

    const el_sidebarName = document.getElementById('sidebarName');
    const el_sidebarBiz = document.getElementById('sidebarBiz');
    const el_userInitials = document.getElementById('userInitials');
    if (el_sidebarName) el_sidebarName.textContent = name;
    if (el_sidebarBiz) el_sidebarBiz.textContent = biz;
    if (el_userInitials) el_userInitials.textContent = name.charAt(0).toUpperCase();

    toast('Settings saved!', 'success');
    refreshDashboard();
  } else { toast(res?.message || 'Failed to save', 'error'); }
}

async function changePassword() {
  const currentEl = document.getElementById('settingCurrentPw');
  const newEl     = document.getElementById('settingNewPw');
  const confirmEl = document.getElementById('settingConfirmPw');

  if (!currentEl || !newEl || !confirmEl) {
    toast('Password fields not found', 'error');
    return;
  }

  const current = currentEl.value;
  const next    = newEl.value;
  const confirm = confirmEl.value;

  if (!current || !next || !confirm) {
    toast('Please fill in all three password fields', 'error');
    return;
  }

  if (next.length < 6) {
    toast('New password must be at least 6 characters', 'error');
    return;
  }

  if (next !== confirm) {
    toast('New password and confirmation do not match', 'error');
    return;
  }

  const res = await Auth.changePassword({ currentPassword: current, newPassword: next });

  if (res?.success) {
    // Clear the fields on success
    currentEl.value = '';
    newEl.value = '';
    confirmEl.value = '';
    toast('Password changed successfully', 'success');
  } else {
    toast(res?.message || 'Failed to change password', 'error');
  }
}

async function clearAllData() {
  if (!confirm(
    'This will permanently delete ALL your transactions, categories, and record books.\n\n' +
    'A fresh default book will be created for you.\n\n' +
    'This cannot be undone. Are you sure?'
  )) return;

  // Second confirmation — this is destructive
  if (!confirm('Are you absolutely sure? This cannot be reversed.')) return;

  const res = await Auth.clearMyData();

  if (res?.success) {
    toast('All data cleared. Starting fresh!', 'info');
    // Reload the full dashboard so books/transactions/categories all reflect the reset
    await refreshDashboard();
  } else {
    toast(res?.message || 'Failed to clear data', 'error');
  }
}

// ══════════════════════════════════════════════════════
// PAGE NAVIGATION
// ══════════════════════════════════════════════════════
const pageTitles = {
  dashboard: 'Dashboard',
  transactions: 'All Transactions',
  addIncome: 'Add Income',
  addExpense: 'Add Expense',
  categories: 'Categories',
  books: 'Record Books',
  reports: 'Reports',
  settings: 'Settings'
};

function showPage(name) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Remove active from all nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  // Show the requested page
  const pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('active');

  // Set topbar title
  const pageTitleEl = document.getElementById('pageTitle');
  if (pageTitleEl) pageTitleEl.textContent = pageTitles[name] || name;

  // Mark active nav link
  const links = document.querySelectorAll('.nav-link');
  links.forEach(l => {
    if (l.textContent.trim().toLowerCase().includes(pageTitles[name]?.toLowerCase()?.split(' ')[0] || '')) {
      l.classList.add('active');
    }
  });

  // Run page-specific render functions
  if (name === 'transactions') renderTransactionsPage();
  if (name === 'categories') renderCategoriesPage();
  if (name === 'books') renderBooksPage();
  if (name === 'reports') renderReports();
  if (name === 'addIncome' || name === 'addExpense') refreshCategoryDropdowns();

  closeSidebar();
}

// ══════════════════════════════════════════════════════
// SIDEBAR (MOBILE)
// ══════════════════════════════════════════════════════
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open');
}

async function openNotificationModal() {
  let modal = document.getElementById('userNotifModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'userNotifModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:680px; width:100%;">
        <div class="modal-header">
          <div>
            <div class="modal-title">Notifications</div>
            <div id="notificationSummary" style="font-size:13px;color:var(--ink-soft);margin-top:6px;">Loading…</div>
          </div>
          <button class="modal-close" data-action="closeModal" data-target="userNotifModal" aria-label="Close notifications">&times;</button>
        </div>
        <div class="notif-panel-header">
          <div class="notif-tabs">
            <button type="button" class="notif-tab active" data-action="switchNotifTab" data-value="all">All</button>
            <button type="button" class="notif-tab" data-action="switchNotifTab" data-value="unread">Unread</button>
            <button type="button" class="notif-tab" data-action="switchNotifTab" data-value="read">Read</button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="markAllNotifsRead">Mark all read</button>
        </div>
        <div id="userNotifList" class="notif-list"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  }

  renderNotificationPanel(_notificationActiveTab);
  modal.classList.add('open');
}

async function showNotifications() {
  if (!session || !session.userId) return toast('Not signed in', 'error');

  await loadUserNotifications();
  openNotificationModal();
}

// Action wrappers used by data-action attributes
function switchNotifTab(tab) {
  renderNotificationPanel(tab);
}

function markNotifRead(id) {
  return markNotificationAsRead(id);
}

function markAllNotifsRead() {
  return markAllNotificationsRead();
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// ══════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

// Close modal when clicking outside
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ══════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// A toast is a small notification message that appears
// and disappears automatically.
// ══════════════════════════════════════════════════════
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const div = document.createElement('div');
  div.className = 'toast ' + type;

  const icons = { success: 'circle-check', error: 'circle-xmark', info: 'circle-info' };
  div.innerHTML = `<i class="fa-solid fa-${icons[type] || 'circle-info'}"></i> ${escapeHTML(msg)}`;

  container.appendChild(div);

  // Remove after 3 seconds
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transition = 'opacity 0.3s';
    setTimeout(() => div.remove(), 300);
  }, 3000);
}

// ══════════════════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════════════════
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function logout() {
  if (!confirm('Sign out of SME Record?')) return;
  Auth.logout();
}

// ══════════════════════════════════════════════════════
// START THE APP
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);