/**
 * controllers/adminController.js
 *
 * All admin operations in one file:
 *   - Admin auth (login, get profile)
 *   - User management (list, view, suspend, delete, reset)
 *   - Notifications (send, history)
 *   - Platform analytics
 *   - Activity log
 *   - Platform settings
 *   - Maintenance operations
 */

const Admin = require('../models/Admin');
const User = require('../models/User');
const RecordBook = require('../models/RecordBook');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const PlatformSettings = require('../models/PlatformSettings');
const jwt = require('jsonwebtoken');
const { generateSecureToken, successResponse, errorResponse, escapeRegex } = require('../utils/helpers');
const mongoose = require('mongoose');

// ──────────────────────────────────────────────────────
// HELPER: generate admin JWT (different claim from user JWT)
// ──────────────────────────────────────────────────────
const generateAdminToken = (adminId) => {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  return jwt.sign(
    { id: adminId, role: 'admin' },  // role:'admin' distinguishes from user tokens
    secret,
    { expiresIn: '12h' }             // shorter expiry for admin sessions
  );
};

// ──────────────────────────────────────────────────────
// HELPER: write an activity log entry
// ──────────────────────────────────────────────────────
const writeLog = async (admin, action, category, description, meta = {}) => {
  try {
    await ActivityLog.create({
      adminId: admin._id,
      adminName: admin.name,
      action,
      category,
      description,
      targetUserId: meta.targetUserId || null,
      targetUserName: meta.targetUserName || null,
      metadata: meta,
      ip: meta.ip || null
    });
  } catch (e) {
    // Never let logging failures crash the main operation
    console.warn('⚠️  Activity log write failed:', e.message);
  }
};

// ══════════════════════════════════════════════════════
// ADMIN AUTH
// ══════════════════════════════════════════════════════

/**
 * POST /api/admin/auth/login
 * Admin sign-in. Returns a short-lived JWT.
 */
const adminLogin = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = (username || email || '').toLowerCase();

    if (!identifier || !password) {
      return errorResponse(res, 'Username and password are required');
    }

    // Find admin by username OR email
    const admin = await Admin.findOne({
      $or: [
        { username: identifier },
        { email: identifier }
      ]
    }).select('+passwordHash');

    if (!admin || !admin.isActive) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    // Update last login timestamp and IP
    admin.lastLogin = new Date();
    admin.lastLoginIP = req.ip || req.headers['x-forwarded-for'];
    await admin.save({ validateBeforeSave: false });

    const token = generateAdminToken(admin._id);

    // Log the login
    await writeLog(admin, 'login', 'auth', `${admin.name} signed in to Admin Panel`, { ip: admin.lastLoginIP });

    return successResponse(res, { token, admin: admin.toPublicJSON() }, 'Admin login successful');

  } catch (error) {
    console.error('Admin login error:', error);
    return errorResponse(res, 'Login failed', 500);
  }
};

/**
 * GET /api/admin/auth/me
 * Returns the currently logged-in admin's profile.
 */
const getAdminProfile = async (req, res) => {
  return successResponse(res, { admin: req.admin.toPublicJSON() });
};

/**
 * PUT /api/admin/auth/me
 * Update admin's own profile / change password.
 */
const updateAdminProfile = async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.admin._id).select('+passwordHash');

    if (name) admin.name = name;

    // If changing password, verify the current one first
    if (newPassword) {
      if (!currentPassword) {
        return errorResponse(res, 'Current password is required to set a new one');
      }

      const isMatch = await admin.comparePassword(currentPassword);
      if (!isMatch) {
        return errorResponse(res, 'Current password is incorrect', 401);
      }

      if (newPassword.length < 8) {
        return errorResponse(res, 'New password must be at least 8 characters');
      }

      admin.passwordHash = newPassword; // pre-save hook hashes it
    }

    await admin.save();
    await writeLog(admin, 'update_settings', 'settings', `${admin.name} updated their admin profile`);

    return successResponse(res, { admin: admin.toPublicJSON() }, 'Profile updated');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/users
 * List all users with filters, search, and pagination.
 */
const getAllUsers = async (req, res) => {
  try {
    const {
      status, search, page = 1, limit = 20,
      sortBy = 'createdAt', sortOrder = 'desc'
    } = req.query;

    const filter = {};
    if (status === 'suspended') filter.isSuspended = true;
    if (status === 'active') filter.isSuspended = { $ne: true };

    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$or = [
        { fullName: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { businessName: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [users, total] = await Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(parseInt(limit)),
      User.countDocuments(filter)
    ]);

    // Attach transaction count to each user
    const userIds = users.map(u => u._id);
    const txCounts = await Transaction.aggregate([
      { $match: { userId: { $in: userIds }, isDeleted: false } },
      { $group: { _id: '$userId', count: { $sum: 1 } } }
    ]);
    const txCountMap = {};
    txCounts.forEach(t => { txCountMap[t._id.toString()] = t.count; });

    const enriched = users.map(u => ({
      ...u.toPublicJSON(),
      status: u.isSuspended ? 'suspended' : 'active',
      txCount: txCountMap[u._id.toString()] || 0
    }));

    return successResponse(res, {
      users: enriched,
      pagination: {
        total, page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin/users/:id
 * Full profile of one user, including stats.
 */
const getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const userId = user._id;

    const [statsAgg, bookCount, categoryCount] =
      await Promise.all([

        // Aggregate totals only — we do NOT pull individual transaction
        // records. Admins need aggregate context for support, not the
        // ability to read a user's full ledger.
        Transaction.aggregate([
          { $match: { userId, isDeleted: false } },
          {
            $group: {
              _id: null,
              txCount: { $sum: 1 },
              income: {
                $sum: {
                  $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0]
                }
              },
              expense: {
                $sum: {
                  $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0]
                }
              }
            }
          }
        ]),

        RecordBook.countDocuments({ userId, isArchived: false }),

        Category.countDocuments({ userId })
      ]);

    const stats = statsAgg[0] || { txCount: 0, income: 0, expense: 0 };

    // NDPR compliance — log every access to a user's financial summary.
    // Financial data is sensitive personal data under Nigeria's Data
    // Protection Regulation. All access must be auditable.
    await writeLog(req.admin, 'data_access', 'user',
      `${req.admin.name} viewed financial summary for user "${user.businessName}" (${user.email})`,
      { targetUserId: user._id, targetUserName: user.fullName }
    );

    return successResponse(res, {
      user: {
        ...user.toPublicJSON(),

        status: user.isSuspended ? 'suspended' : 'active',
        isSuspended: user.isSuspended || false,

        // Support-level aggregate — enough to answer "how active is this
        // account?" without exposing individual transaction details.
        stats: {
          txCount:    stats.txCount,
          income:     stats.income,
          expense:    stats.expense,
          netBalance: stats.income - stats.expense,
          bookCount,
          categoryCount
        }
      }
      // NOTE: recentTransactions intentionally removed.
      // Individual transaction records (amounts, descriptions, categories
      // linked to a specific user) are private financial data.
      // Admins have no legitimate reason to browse a user's ledger.
    });

  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PATCH /api/admin/users/:id/suspend
 * Toggle suspend / reactivate.
 */
const toggleSuspendUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const wasSuspended = user.isSuspended;
    user.isSuspended = !wasSuspended;
    user.suspendedAt = wasSuspended ? null : new Date();
    user.suspendedBy = wasSuspended ? null : req.admin._id;
    user.suspendReason = req.body.reason || '';
    await user.save({ validateBeforeSave: false });

    const action = wasSuspended ? 'unsuspend' : 'suspend';
    const verb = wasSuspended ? 'reactivated' : 'suspended';

    await writeLog(req.admin, action, 'user',
      `${req.admin.name} ${verb} user "${user.fullName}"`,
      { targetUserId: user._id, targetUserName: user.fullName, reason: req.body.reason }
    );

    return successResponse(res, {
      userId: user._id, isSuspended: user.isSuspended
    }, `User ${verb} successfully`);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/users/:id
 * Permanently delete a user and all their data.
 * Requires superadmin role.
 */
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const userName = user.fullName;

    // Delete cascade — remove all user's data
    await Promise.all([
      User.findByIdAndDelete(user._id),
      Transaction.deleteMany({ userId: user._id }),
      RecordBook.deleteMany({ userId: user._id }),
      Category.deleteMany({ userId: user._id }),
      Notification.deleteMany({ targetUserId: user._id })
    ]);

    await writeLog(req.admin, 'delete', 'user',
      `${req.admin.name} permanently deleted user "${userName}"`,
      { targetUserName: userName }
    );

    return successResponse(res, null, 'User and all associated data deleted');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/users/:id/data
 * Reset a user's data (transactions, books, categories)
 * but keep their account.
 */
const resetUserData = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    await Promise.all([
      Transaction.deleteMany({ userId: user._id }),
      RecordBook.deleteMany({ userId: user._id }),
      Category.deleteMany({ userId: user._id })
    ]);

    // Re-create their default book
    await RecordBook.create({
      userId: user._id,
      name: user.businessName + ' — Main Book',
      currency: user.currency || 'NGN'
    });

    await writeLog(req.admin, 'reset', 'user',
      `${req.admin.name} reset all data for user "${user.fullName}"`,
      { targetUserId: user._id, targetUserName: user.fullName }
    );

    return successResponse(res, null, "User's data has been reset");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════

/**
 * POST /api/admin/notifications
 * Send a notification (broadcast or targeted).
 */
const sendNotification = async (req, res) => {
  try {
    const { type, targetUserId, title, message, priority } = req.body;

    if (!title || !message) {
      return errorResponse(res, 'Title and message are required');
    }

    let recipients = [];

    if (type === 'targeted') {
      if (!targetUserId) return errorResponse(res, 'Target user ID required for targeted notifications');
      const user = await User.findById(targetUserId);
      if (!user) return errorResponse(res, 'Target user not found', 404);
      recipients = [user];
    } else {
      // broadcast or system — send to all active users
      recipients = await User.find({ isSuspended: { $ne: true } });
    }

    const notif = await Notification.create({
      sentBy: req.admin._id,
      type: type || 'broadcast',
      targetUserId: type === 'targeted' ? targetUserId : null,
      title,
      message,
      priority: priority || 'normal',
      status: 'sent',
      recipientCount: recipients.length
    });

    await writeLog(req.admin, 'send_notif', 'notif',
      `${req.admin.name} sent ${type} notification: "${title}" to ${recipients.length} user(s)`,
      { notificationId: notif._id, recipientCount: recipients.length }
    );

    return successResponse(res, {
      notification: notif,
      recipientCount: recipients.length
    }, `Notification sent to ${recipients.length} user(s)`, 201);

  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin/notifications
 * List all sent notifications with pagination.
 */
const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const filter = {};
    if (type) filter.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifs, total] = await Promise.all([
      Notification.find(filter)
        .populate('sentBy', 'name email')
        .populate('targetUserId', 'fullName businessName')
        .populate('replies.userId', 'fullName businessName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(filter)
    ]);

    return successResponse(res, {
      notifications: notifs,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin/notifications/user/:userId
 * Get notifications for a specific user (their inbox).
 */
const getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const notifs = await Notification.find({
      $or: [
        { type: 'broadcast' },
        { type: 'system' },
        { type: 'targeted', targetUserId: userId }
      ]
    })
      .populate('replies.userId', 'fullName businessName email')
      .sort({ createdAt: -1 })
      .limit(50);

    return successResponse(res, { notifications: notifs });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/notifications
 * Delete ALL notifications (admin history + every user's inbox, since
 * they're the same collection).
 */
const clearNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({});

    await writeLog(req.admin, 'data', 'system',
      `${req.admin.name} cleared ${result.deletedCount} notifications`
    );

    return successResponse(res, { deleted: result.deletedCount }, 'All notifications cleared');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/notifications/:id
 * Delete a single notification.
 */
const deleteNotificationItem = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Notification.findByIdAndDelete(id);

    if (!deleted) {
      return errorResponse(res, 'Notification not found', 404);
    }

    return successResponse(res, { deletedId: id }, 'Notification deleted');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/analytics/overview
 * Platform-wide stats for the overview cards.
 */
const getOverviewStats = async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers, activeUsers, suspendedUsers,
      newThisMonth,
      totalTxs, totalIncome, totalExpense
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isSuspended: { $ne: true } }),
      User.countDocuments({ isSuspended: true }),
      User.countDocuments({ createdAt: { $gte: monthStart } }),
      Transaction.countDocuments({ isDeleted: false }),
      Transaction.aggregate([{ $match: { type: 'income', isDeleted: false } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'expense', isDeleted: false } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
    ]);

    return successResponse(res, {
      users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers, newThisMonth },
      transactions: {
        total: totalTxs,
        totalIncome: totalIncome[0]?.total || 0,
        totalExpense: totalExpense[0]?.total || 0
      }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin/analytics/registrations
 * Monthly user registrations for the chart.
 */
const getRegistrationTrend = async (req, res) => {
  try {
    // Last 12 months
    const since = new Date();
    since.setMonth(since.getMonth() - 11);
    since.setDate(1);

    const result = await User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatted = result.map(r => ({
      label: months[r._id.month - 1] + ' ' + r._id.year,
      count: r.count
    }));

    return successResponse(res, { registrations: formatted });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin/analytics/transactions
 * Monthly income vs expense across the whole platform.
 */
const getTransactionAnalytics = async (req, res) => {
  try {
    const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);

    const result = await Transaction.aggregate([
      { $match: { isDeleted: false, date: { $gte: since } } },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Payment method breakdown
    const methodBreakdown = await Transaction.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$amount' } } },
      { $sort: { total: -1 } }
    ]);

    // Top categories by spending
    const topCategories = await Transaction.aggregate([
      { $match: { type: 'expense', isDeleted: false } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 8 }
    ]);

    return successResponse(res, {
      monthly: result,
      methodBreakdown,
      topCategories
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// ACTIVITY LOG
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/activity
 * Paginated activity log with filters.
 */
const getActivityLog = async (req, res) => {
  try {
    const { page = 1, limit = 30, category, action, from, to } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (action) filter.action = action;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate('adminId', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ActivityLog.countDocuments(filter)
    ]);

    return successResponse(res, {
      logs,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/activity
 * Clear the activity log (superadmin only).
 */
const clearActivityLog = async (req, res) => {
  try {
    const { before } = req.query; // optional: only delete logs before a date
    const filter = before ? { createdAt: { $lte: new Date(before) } } : {};

    const result = await ActivityLog.deleteMany(filter);

    await writeLog(req.admin, 'data', 'system',
      `${req.admin.name} cleared ${result.deletedCount} activity log entries`
    );

    return successResponse(res, { deleted: result.deletedCount }, 'Activity log cleared');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/activity/:id
 * Delete a single activity log entry.
 */
const deleteActivityLogItem = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ActivityLog.findByIdAndDelete(id);

    if (!deleted) {
      return errorResponse(res, 'Activity log entry not found', 404);
    }

    return successResponse(res, { deletedId: id }, 'Activity log entry deleted');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// PLATFORM SETTINGS
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/settings
 */
const getSettings = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    return successResponse(res, { settings });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/admin/settings
 */
const updateSettings = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    const allowed = ['platformName', 'supportEmail', 'defaultCurrency',
      'features', 'rateLimits', 'maintenanceMessage'];

    allowed.forEach(key => {
      if (req.body[key] !== undefined) {
        if (typeof req.body[key] === 'object' && !Array.isArray(req.body[key])) {
          // Deep merge for nested objects like 'features'
          settings[key] = { ...settings[key], ...req.body[key] };
        } else {
          settings[key] = req.body[key];
        }
      }
    });

    settings.lastUpdatedBy = req.admin._id;
    await settings.save();

    await writeLog(req.admin, 'update_settings', 'settings',
      `${req.admin.name} updated platform settings`
    );

    return successResponse(res, { settings }, 'Settings updated');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// MAINTENANCE
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/maintenance/stats
 * Database record counts for the maintenance page.
 */
const getMaintenanceStats = async (req, res) => {
  try {
    const [users, txs, books, cats, notifs, logs] = await Promise.all([
      User.countDocuments(),
      Transaction.countDocuments({ isDeleted: false }),
      RecordBook.countDocuments({ isArchived: false }),
      Category.countDocuments(),
      Notification.countDocuments(),
      ActivityLog.countDocuments()
    ]);

    return successResponse(res, { counts: { users, transactions: txs, books, categories: cats, notifications: notifs, activityLogs: logs } });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/maintenance/transactions
 * Clear all transactions (superadmin only).
 */
const clearAllTransactions = async (req, res) => {
  try {
    const result = await Transaction.deleteMany({});
    await writeLog(req.admin, 'delete', 'data', `${req.admin.name} cleared all ${result.deletedCount} transactions`);
    return successResponse(res, { deleted: result.deletedCount }, 'All transactions cleared');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin/maintenance/export
 * Export full platform backup as JSON.
 */
const exportPlatformData = async (req, res) => {
  try {
    const [users, txs, books, cats, notifs] = await Promise.all([
      User.find().select('-passwordHash -verificationToken -resetPasswordToken'),
      Transaction.find(),
      RecordBook.find(),
      Category.find(),
      Notification.find()
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.admin.name,
      version: '1.0',
      users, transactions: txs, books: books,
      categories: cats, notifications: notifs
    };

    await writeLog(req.admin, 'export', 'data', `${req.admin.name} exported full platform backup`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="sme-backup-${Date.now()}.json"`);
    return res.status(200).json(backup);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// ADMIN MANAGEMENT (superadmin manages other admins)
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/admins
 */
const listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().sort({ createdAt: -1 });
    return successResponse(res, { admins: admins.map(a => a.toPublicJSON()) });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/admin/admins
 * Create a new admin account (superadmin only).
 */
const createAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return errorResponse(res, 'Name, email and password are required');
    }

    const exists = await Admin.findOne({ email: email.toLowerCase() });
    if (exists) return errorResponse(res, 'An admin with this email already exists');

    const admin = await Admin.create({
      name, email,
      passwordHash: password,
      role: role || 'moderator'
    });

    await writeLog(req.admin, 'register', 'user',
      `${req.admin.name} created new admin account for "${name}" (${role || 'moderator'})`
    );

    return successResponse(res, { admin: admin.toPublicJSON() }, 'Admin account created', 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/admin/admins/:id
 * Remove an admin account (cannot delete yourself).
 */
const deleteAdmin = async (req, res) => {
  try {
    if (req.params.id === req.admin._id.toString()) {
      return errorResponse(res, 'You cannot delete your own admin account');
    }

    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) return errorResponse(res, 'Admin not found', 404);

    await writeLog(req.admin, 'delete', 'user',
      `${req.admin.name} deleted admin account "${admin.name}"`
    );

    return successResponse(res, null, 'Admin account deleted');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ══════════════════════════════════════════════════════
// ALL TRANSACTIONS (ADMIN VIEW)
// ══════════════════════════════════════════════════════

/**
 * GET /api/admin/transactions
 * All platform transactions, enriched with user info.
 */
/**
 * GET /api/admin/transactions
 *
 * PRIVACY CHANGE: This endpoint no longer returns individual user transaction
 * records. Financial data (amounts, descriptions, categories per user) is
 * sensitive personal data under Nigeria's NDPR and should not be accessible
 * to platform admins.
 *
 * What is returned instead:
 * - Platform-wide volume totals (anonymised)
 * - Average transactions per user
 * - Category distribution (no user names attached)
 * - Number of active record books
 * - Monthly breakdown (type + count only, no amounts per user)
 *
 * What is NOT returned:
 * - Individual transaction records
 * - Transaction descriptions
 * - Per-user income/expense amounts
 * - User names linked to specific transactions
 */
const getPlatformTransactionStats = async (req, res) => {
  try {
    const { from, to } = req.query;

    // Build optional date filter
    const dateFilter = {};
    if (from || to) {
      dateFilter.date = {};
      if (from) dateFilter.date.$gte = new Date(from);
      if (to)   dateFilter.date.$lte = new Date(to);
    }

    const baseMatch = { isDeleted: false, ...dateFilter };

    const [
      // Total count of transactions on the platform
      totalCount,

      // Aggregate volume by type — anonymised totals only, not per-user
      volumeByType,

      // Category distribution — how many transactions per category
      // across the whole platform, no user names attached
      categoryDistribution,

      // Payment method breakdown
      methodBreakdown,

      // Count of active record books (platform health metric)
      activeBooks,

      // Total registered users (for avg calculation)
      totalUsers,

      // Monthly transaction count trend (counts only, no amounts)
      monthlyTrend

    ] = await Promise.all([

      Transaction.countDocuments(baseMatch),

      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: '$type',
            totalAmount: { $sum: '$amount' },
            count:       { $sum: 1 }
          }
        }
      ]),

      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id:   '$category',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id:   '$paymentMethod',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),

      RecordBook.countDocuments({ isArchived: false }),

      User.countDocuments(),

      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: {
              year:  { $year:  '$date' },
              month: { $month: '$date' },
              type:  '$type'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ])
    ]);

    // Shape volume summary
    const income  = volumeByType.find(v => v._id === 'income');
    const expense = volumeByType.find(v => v._id === 'expense');

    return successResponse(res, {
      summary: {
        totalTransactions:       totalCount,
        totalPlatformIncome:     income?.totalAmount  || 0,
        totalPlatformExpense:    expense?.totalAmount || 0,
        totalIncomeTransactions: income?.count        || 0,
        totalExpenseTransactions:expense?.count       || 0,
        activeRecordBooks:       activeBooks,
        avgTransactionsPerUser:  totalUsers > 0
          ? Math.round(totalCount / totalUsers)
          : 0
      },
      categoryDistribution,   // [{_id: 'Food', count: 42}, ...]
      methodBreakdown,         // [{_id: 'cash', count: 120}, ...]
      monthlyTrend             // counts only — no amounts per user
    });

  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  // Auth
  adminLogin, getAdminProfile, updateAdminProfile,

  // Users
  getAllUsers, getUserDetail, toggleSuspendUser,
  deleteUser, resetUserData,

  // Notifications
  sendNotification, getNotifications, getUserNotifications,
  clearNotifications, deleteNotificationItem,

  // Analytics
  getOverviewStats, getRegistrationTrend, getTransactionAnalytics,

  // Activity log
  getActivityLog, clearActivityLog, deleteActivityLogItem,

  // Settings
  getSettings, updateSettings,

  // Maintenance
  getMaintenanceStats, clearAllTransactions, exportPlatformData,

  // Admin management
  listAdmins, createAdmin, deleteAdmin,

  // Transactions (platform stats only — no individual records)
  getPlatformTransactionStats
};
