'use strict';
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const crypto = require('crypto');
const verifyTurnstile = require('../middleware/verifyTurnstile');
const { sendMail } = require('../utils/mailer');

const {
  register, login, verifyEmail,
  forgotPassword, resetPassword,
  getMe, updateProfile
} = require('../controllers/authController');

const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const Notification = require('../models/Notification');

// POST /api/auth/register
router.post('/register',
  [
    body('fullName').notEmpty().trim().withMessage('Full name is required'),
    body('businessName').notEmpty().trim().withMessage('Business name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  verifyTurnstile,
  validate,
  register
);

// POST /api/auth/login
router.post('/login',
  [
    body('businessName').notEmpty().withMessage('Business name is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  verifyTurnstile,
  validate,
  login
);

// GET  /api/auth/verify-email/:token
router.get('/verify-email/:token', verifyEmail);

// POST /api/auth/forgot-password
router.post('/forgot-password',
  [body('email').isEmail().withMessage('Valid email is required')],
  verifyTurnstile,
  validate,
  forgotPassword
);

// POST /api/auth/reset-password/:token
router.post('/reset-password/:token',
  [body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')],
  validate,
  resetPassword
);

// GET /api/auth/me  — get logged-in user
router.get('/me', protect, getMe);

// PUT /api/auth/me  — update profile
router.put('/me', protect, updateProfile);

// PUT /api/auth/me/password — change password
// Users previously had no way to change their password from the app.
// The only alternative was the forgot-password email flow which requires
// SMTP to be configured and working.
router.put('/me/password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
  ],
  validate,
  async (req, res) => {
    try {
      // We need passwordHash for comparison — it has select:false in the schema
      const user = await User.findById(req.user._id).select('+passwordHash');
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const isMatch = await user.comparePassword(req.body.currentPassword);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }

      // The pre-save hook in User.js hashes this automatically
      user.passwordHash = req.body.newPassword;
      await user.save();

      return res.json({ success: true, message: 'Password changed successfully' });
    } catch (e) {
      console.error('Change password error:', e);
      return res.status(500).json({ success: false, message: 'Failed to change password' });
    }
  }
);

// DELETE /api/auth/me/data — clear all user data (transactions, books, categories)
// Keeps the account itself. Re-creates a default record book so the user
// isn't left with an empty dashboard.
router.delete('/me/data',
  protect,
  async (req, res) => {
    try {
      const Transaction = require('../models/Transaction');
      const RecordBook  = require('../models/RecordBook');
      const Category    = require('../models/Category');
      const User        = require('../models/User');

      await Promise.all([
        Transaction.deleteMany({ userId: req.user._id }),
        RecordBook.deleteMany({ userId: req.user._id }),
        Category.deleteMany({ userId: req.user._id })
      ]);

      // Re-create their default book so they land on a working dashboard
      const user = await User.findById(req.user._id);
      await RecordBook.create({
        userId:   req.user._id,
        name:     (user?.businessName || 'My Business') + ' — Main Book',
        currency: user?.currency || 'NGN'
      });

      return res.json({ success: true, message: 'All your data has been cleared' });
    } catch (e) {
      console.error('Clear data error:', e);
      return res.status(500).json({ success: false, message: 'Failed to clear data' });
    }
  }
);

// ── USER NOTIFICATIONS ────────────────────────────────────────────────────────

// GET /api/auth/notifications — get notifications for logged-in user
router.get('/notifications', protect, async (req, res) => {
  try {
    const notifs = await Notification.find({
      $or: [
        { targetUserId: req.user._id },
        { type: 'broadcast' }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, data: { notifications: notifs } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// PATCH /api/auth/notifications/:id/read — mark notification as read
router.patch('/notifications/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, {
      $addToSet: { readBy: req.user._id }
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
});

// POST /api/auth/notifications/:id/reply — add a reply to a notification
router.post('/notifications/:id/reply',
  [body('message').notEmpty().trim().withMessage('Reply message is required')],
  protect,
  validate,
  async (req, res) => {
    try {
      const { message } = req.body;
      const notif = await Notification.findById(req.params.id);
      if (!notif) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      if (notif.type === 'targeted' && String(notif.targetUserId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'You are not authorized to reply to this notification' });
      }

      // Add reply and mark notification as read for the replying user
      notif.replies = notif.replies || [];
      notif.replies.push({ userId: req.user._id, message });
      notif.readBy = notif.readBy || [];
      if (!notif.readBy.some(u => String(u) === String(req.user._id))) {
        notif.readBy.push(req.user._id);
      }
      await notif.save();

      return res.json({ success: true, data: { replies: notif.replies } });
    } catch (e) {
      console.error('Notification reply failed:', e);
      return res.status(500).json({ success: false, message: 'Failed to send reply' });
    }
  }
);

module.exports = router;
