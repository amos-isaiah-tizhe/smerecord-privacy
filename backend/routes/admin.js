/**
 * routes/admin.js
 *
 * All admin API endpoints live here.
 * Every route is protected — you MUST be a logged-in
 * admin to access any of them.
 *
 * Route map:
 *
 * AUTH
 *   POST   /api/admin/auth/login         → login
 *   GET    /api/admin/auth/me            → get my profile
 *   PUT    /api/admin/auth/me            → update my profile
 *
 * DASHBOARD
 *   GET    /api/admin/stats              → all overview numbers
 *
 * USERS
 *   GET    /api/admin/users              → list users (paginated + filters)
 *   GET    /api/admin/users/:id          → user full detail
 *   PATCH  /api/admin/users/:id/suspend  → suspend / reactivate
 *   DELETE /api/admin/users/:id          → delete user + all data
 *   DELETE /api/admin/users/:id/data     → reset data, keep account
 *
 * NOTIFICATIONS
 *   POST   /api/admin/notifications/send          → send notification
 *   GET    /api/admin/notifications               → list sent notifications
 *   GET    /api/admin/notifications/user/:userId  → user's inbox
 *
 * ANALYTICS
 *   GET    /api/admin/analytics/registrations    → monthly reg trend
 *   GET    /api/admin/analytics/transactions     → tx trend
 *   GET    /api/admin/analytics/categories       → top categories
 *   GET    /api/admin/analytics/payment-methods  → method breakdown
 *
 * ACTIVITY LOG
 *   GET    /api/admin/activity           → paginated log
 *   DELETE /api/admin/activity           → clear log (superadmin)
 *
 * SETTINGS
 *   GET    /api/admin/settings           → get platform settings
 *   PUT    /api/admin/settings           → update platform settings
 *
 * MAINTENANCE
 *   GET    /api/admin/maintenance/stats           → DB stats
 *   DELETE /api/admin/maintenance/transactions    → wipe txs (superadmin)
 *   GET    /api/admin/maintenance/export          → export all data
 *
 * ADMIN MANAGEMENT (superadmin only)
 *   GET    /api/admin/admins             → list all admins
 *   POST   /api/admin/admins             → create new admin
 *   DELETE /api/admin/admins/:id         → delete an admin
 */

const express    = require('express');
const { body }   = require('express-validator');
const router     = express.Router();
// rate limiting for admin login is configured in routes/adminAuth.js

const { protectAdmin, requireRole } = require('../middleware/adminAuth');
const { validate }                  = require('../middleware/validate');

const {
  adminLogin, getAdminProfile, updateAdminProfile,
  getOverviewStats,
  getAllUsers, getUserDetail, toggleSuspendUser, deleteUser, resetUserData,
  sendNotification, getNotifications, getUserNotifications, clearNotifications, deleteNotificationItem,
  getRegistrationTrend, getTransactionAnalytics,
  getActivityLog, clearActivityLog, deleteActivityLogItem,
  getSettings, updateSettings,
  getMaintenanceStats, clearAllTransactions, exportPlatformData,
  listAdmins, createAdmin, deleteAdmin,
  getPlatformTransactionStats
} = require('../controllers/adminController');

// NOTE: POST /auth/login is registered in routes/adminAuth.js (mounted before
// this router). Do NOT redefine it here — the duplicate previously rejected
// email-based logins because it required `username` to be non-empty.

// All routes below this line require a valid admin token
router.use(protectAdmin);

router.get('/auth/me',  getAdminProfile);
router.put('/auth/me',
  [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().withMessage('Valid email required')
  ],
  validate,
  updateAdminProfile
);

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
router.get('/stats', getOverviewStats);

// ═══════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════
router.get('/users',                                 getAllUsers);
router.get('/users/:id',                             getUserDetail);
router.patch('/users/:id/suspend',                   toggleSuspendUser);
router.delete('/users/:id',      requireRole('superadmin'), deleteUser);
router.delete('/users/:id/data', requireRole('superadmin'), resetUserData);

// ═══════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════
router.post('/notifications/send',
  [
    body('type')   .isIn(['broadcast','targeted','system']).withMessage('Invalid type'),
    body('title')  .notEmpty().trim().withMessage('Title is required'),
    body('message').notEmpty().trim().withMessage('Message is required')
  ],
  validate,
  sendNotification
);

router.get   ('/notifications',               getNotifications);
router.get   ('/notifications/user/:userId',  getUserNotifications);
router.delete('/notifications',               requireRole('superadmin'), clearNotifications);
router.delete('/notifications/:id',           requireRole('superadmin'), deleteNotificationItem);

// ═══════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════
router.get('/analytics/registrations',   getRegistrationTrend);
router.get('/analytics/transactions',    getTransactionAnalytics);

// ═══════════════════════════════════════════
// ALL TRANSACTIONS (admin view)
// ═══════════════════════════════════════════
router.get('/transactions', getPlatformTransactionStats);

// ═══════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════
router.get   ('/activity',      getActivityLog);
router.delete('/activity',      requireRole('superadmin'), clearActivityLog);
router.delete('/activity/:id',  requireRole('superadmin'), deleteActivityLogItem);

// ═══════════════════════════════════════════
// PLATFORM SETTINGS
// ═══════════════════════════════════════════
router.get('/settings', getSettings);
router.put ('/settings', requireRole('superadmin'), updateSettings);

// ═══════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════
router.get   ('/maintenance/stats',        getMaintenanceStats);
router.get   ('/maintenance/export',       requireRole('superadmin'), exportPlatformData);
router.delete('/maintenance/transactions', requireRole('superadmin'), clearAllTransactions);

// ═══════════════════════════════════════════
// ADMIN MANAGEMENT (superadmin only)
// ═══════════════════════════════════════════
router.get('/admins',  requireRole('superadmin'), listAdmins);

router.post('/admins',
  requireRole('superadmin'),
  [
    body('username').notEmpty().trim().withMessage('Username required'),
    body('name')    .notEmpty().trim().withMessage('Name required'),
    body('email')   .isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role')    .optional().isIn(['superadmin','moderator','viewer']).withMessage('Invalid role')
  ],
  validate,
  createAdmin
);

router.delete('/admins/:id', requireRole('superadmin'), deleteAdmin);

module.exports = router;
