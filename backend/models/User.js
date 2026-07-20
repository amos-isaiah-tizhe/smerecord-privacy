/**
 * models/User.js — The User data model
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type:      String,
      required:  [true, 'Full name is required'],
      trim:      true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },

    businessName: {
      type:      String,
      required:  [true, 'Business name is required'],
      trim:      true,
      unique:    true,
      maxlength: [100, 'Business name cannot exceed 100 characters']
    },

    email: {
      type:      String,
      required:  [true, 'Email is required'],
      unique:    true,
      lowercase: true,
      trim:      true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
    },

    // We NEVER store plain passwords — only the bcrypt hash
    passwordHash: {
      type:     String,
      required: true,
      select:   false
    },

    // Email verification
    isVerified:              { type: Boolean, default: false },
    verificationToken:       { type: String,  select: false },
    verificationTokenExpiry: { type: Date,    select: false },

    // Password reset
    resetPasswordToken:  { type: String, select: false },
    resetPasswordExpiry: { type: Date,   select: false },

    // Admin moderation — suspended users cannot log in
    isSuspended:   { type: Boolean, default: false, index: true },
    suspendedAt:   { type: Date,    default: null },
    suspendedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    suspendReason: { type: String,  default: '' },

    // User preferences
    currency: { type: String, default: 'NGN' },
    timezone: { type: String, default: 'Africa/Lagos' }
  },
  { timestamps: true }
);

// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  next();
});

UserSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

UserSchema.methods.toPublicJSON = function () {
  return {
    id:           this._id,
    fullName:     this.fullName,
    businessName: this.businessName,
    email:        this.email,
    isVerified:   this.isVerified,
    isSuspended:  this.isSuspended || false,
    currency:     this.currency,
    timezone:     this.timezone,
    createdAt:    this.createdAt
  };
};

module.exports = mongoose.model('User', UserSchema);
