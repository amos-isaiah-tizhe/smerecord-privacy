/**
 * models/ActivityLog.js
 *
 * Records every significant admin action.
 * This is your audit trail — you can see exactly who did what and when.
 *
 * Examples of things that get logged:
 *   - Admin logged in
 *   - User was suspended
 *   - Notification was sent
 *   - User was deleted
 *   - Settings were changed
 */

const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema(
  {
    // Which admin performed this action
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Admin',
      required: true
    },

    adminName: {
      type: String   // stored directly for fast display (denormalised)
    },

    // Category of action for filtering
    // 'auth'    = login / logout
    // 'user'    = user management (suspend, delete, reset)
    // 'notif'   = notification sent
    // 'settings'= settings changed
    // 'data'    = data export / import / delete
    category: {
      type:    String,
      enum:    ['auth', 'user', 'notif', 'settings', 'data', 'system'],
      default: 'system'
    },

    // Specific action type (used for icon selection in UI)
    action: {
      type:    String,
      enum:    ['login', 'logout', 'suspend', 'unsuspend', 'delete', 'reset',
                'send_notif', 'update_settings', 'export', 'import', 'register', 'tx'],
      required: true
    },

    // Human-readable description (supports HTML for bold names etc.)
    description: {
      type:    String,
      required: true,
      maxlength: [500, 'Log description too long']
    },

    // Which user was affected (if any)
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      default: null
    },

    targetUserName: {
      type: String,
      default: null
    },

    // Extra data (e.g. which fields changed in settings)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // IP address for security auditing
    ip: {
      type: String
    }
  },
  {
    // Only createdAt — logs are never updated
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// ── Indexes for fast filtering ──
ActivityLogSchema.index({ adminId: 1, createdAt: -1 });
ActivityLogSchema.index({ category: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1 });
ActivityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
