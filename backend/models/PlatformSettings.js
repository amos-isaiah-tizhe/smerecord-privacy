/**
 * models/PlatformSettings.js
 *
 * A single document that stores all platform-wide configuration.
 * We use a singleton pattern — only ONE document ever exists.
 *
 * "Singleton" means: instead of creating many documents,
 * we always find-or-create the one document with a fixed ID.
 */

const mongoose = require('mongoose');

const PlatformSettingsSchema = new mongoose.Schema(
  {
    // Fixed key — ensures only one document exists
    key: {
      type:    String,
      default: 'platform_settings',
      unique:  true
    },

    platformName: {
      type:    String,
      default: 'SME Record'
    },

    supportEmail: {
      type:    String,
      default: 'support@smerecord.com'
    },

    defaultCurrency: {
      type:    String,
      default: 'NGN'
    },

    // ── Feature Flags ──
    // These can be toggled on/off from the admin panel
    features: {
      registrationOpen: { type: Boolean, default: true },
      emailVerification:{ type: Boolean, default: false },
      maintenanceMode:  { type: Boolean, default: false },
      csvExport:        { type: Boolean, default: true },
      feedbackEnabled:  { type: Boolean, default: true }
    },

    // ── Rate Limiting Config ──
    rateLimits: {
      loginAttempts:  { type: Number, default: 10 },
      windowMinutes:  { type: Number, default: 15 },
      globalRPM:      { type: Number, default: 100 }
    },

    // ── Email Config (can be updated from admin panel) ──
    emailConfig: {
      smtpHost:    { type: String, default: '' },
      smtpPort:    { type: Number, default: 587 },
      smtpUser:    { type: String, default: '' },
      fromAddress: { type: String, default: '' }
    },

    // ── Maintenance message shown to users ──
    maintenanceMessage: {
      type:    String,
      default: 'We are currently performing maintenance. Please check back shortly.'
    },

    // ── Last updated by ──
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Admin'
    }
  },
  {
    timestamps: true
  }
);

// ── Static method to get (or create) the settings document ──
PlatformSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ key: 'platform_settings' });

  if (!settings) {
    // Create the default settings document on first access
    settings = await this.create({ key: 'platform_settings' });
  }

  return settings;
};

module.exports = mongoose.model('PlatformSettings', PlatformSettingsSchema);
