/**
 * utils/helpers.js — Reusable utility functions
 *
 * Small helper functions used across the backend.
 */

const jwt    = require('jsonwebtoken');
const crypto = require('crypto'); // Built into Node.js — no install needed

// ─────────────────────────────────────────
// Generate a JWT token for a user
//
// jwt.sign() creates a signed token that contains:
//   - The user's ID (so we know who they are on future requests)
//   - An expiry time (so old tokens stop working)
// ─────────────────────────────────────────
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },                         // payload: what to store in the token
    process.env.JWT_SECRET,                 // secret: used to sign and verify
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } // expiry
  );
};

// ─────────────────────────────────────────
// Generate a random secure token (for email verification, password reset)
// crypto.randomBytes(32) generates 32 random bytes,
// .toString('hex') converts them to a hex string.
// ─────────────────────────────────────────
const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// ─────────────────────────────────────────
// Standard success response format
// Using a consistent format makes the frontend code simpler.
// ─────────────────────────────────────────
const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

// ─────────────────────────────────────────
// Standard error response format
// ─────────────────────────────────────────
const errorResponse = (res, message = 'An error occurred', statusCode = 400) => {
  return res.status(statusCode).json({
    success: false,
    message
  });
};

// ─────────────────────────────────────────
// Get start of day / week / month (for date filtering in reports)
// ─────────────────────────────────────────
const getPeriodDates = (period) => {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { from: today, to: new Date() };

    case 'week': {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay()); // Sunday of this week
      return { from: weekStart, to: new Date() };
    }

    case 'month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: monthStart, to: new Date() };
    }

    case 'year': {
      const yearStart = new Date(now.getFullYear(), 0, 1);
      return { from: yearStart, to: new Date() };
    }

    default:
      // "all" — no date restriction
      return { from: null, to: null };
  }
};

// ─────────────────────────────────────────
// Escape special regex characters in user input before it's used inside
// `new RegExp(...)`. Without this, a businessName/search term containing
// regex metacharacters (e.g. "(a+)+$") can cause catastrophic backtracking
// (ReDoS) or unintended matches against other users' records.
// ─────────────────────────────────────────
const escapeRegex = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  generateToken,
  generateSecureToken,
  successResponse,
  errorResponse,
  getPeriodDates,
  escapeRegex
};
