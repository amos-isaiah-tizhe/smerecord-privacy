/**
 * middleware/adminAuth.js
 *
 * Protects admin-only routes.
 * Works the same way as auth.js (JWT verification),
 * but checks the Admin model instead of User,
 * and also enforces role-based permissions.
 *
 * Usage in routes:
 *   router.get('/users', protectAdmin, getUsers);              // any admin
 *   router.delete('/user/:id', protectAdmin, requireRole('superadmin'), deleteUser);
 */

const jwt   = require('jsonwebtoken');
const Admin = require('../models/Admin');

// ── Step 1: Verify JWT and load admin ──
const protectAdmin = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Admin access denied. Please sign in to the admin panel.'
      });
    }

    // Use a DIFFERENT secret for admin tokens — extra security
    // Falls back to JWT_SECRET if ADMIN_JWT_SECRET is not set
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    // Confirm it's an admin token (we embed role:'admin' when signing)
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'This token does not have admin privileges.'
      });
    }

    const admin = await Admin.findById(decoded.id);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found. Please sign in again.'
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This admin account has been deactivated.'
      });
    }

    // Attach admin to request — route handlers can use req.admin
    req.admin = admin;
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Admin session expired. Please sign in again.'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid admin token.'
    });
  }
};

// ── Step 2 (optional): Enforce a specific role ──
//
// Usage: requireRole('superadmin')
// Returns a middleware function that checks the role.
//
// Role hierarchy:
//   superadmin > moderator > viewer
//
const roleHierarchy = { superadmin: 3, moderator: 2, viewer: 1 };

const requireRole = (minimumRole) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const adminLevel   = roleHierarchy[req.admin.role]   || 0;
    const requiredLevel= roleHierarchy[minimumRole]      || 999;

    if (adminLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: `This action requires the "${minimumRole}" role. Your role: "${req.admin.role}".`
      });
    }

    next();
  };
};

module.exports = { protectAdmin, requireRole };
