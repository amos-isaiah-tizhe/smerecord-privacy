/**
 * models/Admin.js
 *
 * The Admin is separate from regular users.
 * Admins have elevated privileges and their own
 * login credentials, stored in a different collection.
 *
 * A "collection" in MongoDB = a table in SQL.
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const AdminSchema = new mongoose.Schema(
  {
    username: {
      type:      String,
      required:  [true, 'Username is required'],
      unique:    true,
      lowercase: true,
      trim:      true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [40, 'Username cannot exceed 40 characters'],
      match:     [/^[a-z0-9_.-]+$/, 'Username may only contain lowercase letters, numbers, dot, dash and underscore']
    },

    name: {
      type:     String,
      required: [true, 'Admin name is required'],
      trim:     true
    },

    email: {
      type:      String,
      required:  [true, 'Email is required'],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },

    passwordHash: {
      type:   String,
      required: true,
      select: false   // never returned in queries unless explicitly requested
    },

    // Role-based access control (RBAC)
    // 'superadmin' can do everything — delete users, change settings
    // 'moderator'  can view and send notifications but not delete
    // 'viewer'     read-only access
    role: {
      type:    String,
      enum:    ['superadmin', 'moderator', 'viewer'],
      default: 'superadmin'
    },

    // Is this admin account active?
    isActive: {
      type:    Boolean,
      default: true
    },

    // When they last logged in
    lastLogin: {
      type: Date
    },

    // Their IP address at last login (for audit purposes)
    lastLoginIP: {
      type: String
    },

    // 2FA (Two-Factor Authentication) — placeholder for future
    twoFactorEnabled: {
      type:    Boolean,
      default: false
    }
  },
  {
    timestamps: true  // adds createdAt, updatedAt automatically
  }
);

// ── Hash password before saving (same pattern as User model) ──
AdminSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  const salt = await bcrypt.genSalt(12); // 12 rounds = stronger than user (10)
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  next();
});

// ── Compare a plain password against the stored hash ──
AdminSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

// ── Safe public object (no password hash) ──
AdminSchema.methods.toPublicJSON = function () {
  return {
    id:        this._id,
    username:  this.username,
    name:      this.name,
    email:     this.email,
    role:      this.role,
    isActive:  this.isActive,
    lastLogin: this.lastLogin,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('Admin', AdminSchema);
