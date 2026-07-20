/**
 * models/Notification.js
 *
 * Stores every notification sent by admins.
 * Two uses:
 *   1. Admin history (what was sent, to whom, when)
 *   2. User inbox (each user can read their own notifications)
 */

const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    // Who sent it
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true
    },

    // 'broadcast' = sent to all users
    // 'targeted'  = sent to one specific user
    // 'system'    = auto-generated (e.g. password reset alerts)
    type: {
      type: String,
      enum: ['broadcast', 'targeted', 'system'],
      default: 'broadcast'
    },

    // If targeted, which user receives it
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters']
    },

    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters']
    },

    // Priority affects how it appears to the user
    priority: {
      type: String,
      enum: ['normal', 'info', 'warning', 'urgent'],
      default: 'normal'
    },

    // Track delivery status
    status: {
      type: String,
      enum: ['sent', 'failed', 'draft'],
      default: 'sent'
    },

    // How many users received this (for broadcast)
    recipientCount: {
      type: Number,
      default: 0
    },

    // Which users have replied to this notification
    replies: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        message: {
          type: String,
          required: [true, 'Reply message is required'],
          trim: true,
          maxlength: [1000, 'Reply cannot exceed 1000 characters']
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],

    // Which users have read this notification
    // Only used for broadcast — targeted ones track read status differently
    readBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  {
    timestamps: true
  }
);

// ── Index for fast queries ──
NotificationSchema.index({ targetUserId: 1, createdAt: -1 });
NotificationSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
