'use strict';
const express = require('express');
const { body } = require('express-validator');
const router  = express.Router();
const { adminLogin, getAdminProfile, updateAdminProfile } = require('../controllers/adminController');
const { protectAdmin } = require('../middleware/adminAuth');
const { validate }      = require('../middleware/validate');

// POST /api/admin/auth/login
router.post('/login',
  [
    body('username').optional().trim(),
    body('email').optional().trim(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  adminLogin
);

// GET  /api/admin/auth/me
router.get('/me',  protectAdmin, getAdminProfile);

// PUT  /api/admin/auth/me
router.put('/me',  protectAdmin, updateAdminProfile);

module.exports = router;
