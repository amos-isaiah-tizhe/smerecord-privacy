/**
 * controllers/authController.js
 *
 * Controllers contain the actual logic for each route.
 * They receive the request (req), do the work, and send a response (res).
 *
 * Think of routes as signposts — they point to controllers.
 * Controllers are where the actual work happens.
 */

const User         = require('../models/User');
const RecordBook   = require('../models/RecordBook');
const { generateToken, generateSecureToken, successResponse, errorResponse, escapeRegex } = require('../utils/helpers');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');

// ─────────────────────────────────────────
// REGISTER
// POST /api/auth/register
// ─────────────────────────────────────────
const register = async (req, res) => {
  try {
    // req.body contains the JSON data the frontend sent
    const { fullName, businessName, email, password } = req.body;

    // Check if email already registered
    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) {
      return errorResponse(res, 'An account with this email already exists');
    }

    // Check if business name already taken
    const bizExists = await User.findOne({
      businessName: { $regex: new RegExp(`^${escapeRegex(businessName)}$`, 'i') }
    });
    if (bizExists) {
      return errorResponse(res, 'This business name is already registered');
    }

    // Generate email verification token
    const verificationToken  = generateSecureToken();
    const tokenExpiry        = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create the user
    // Note: the pre-save hook in User.js will hash passwordHash automatically
    const user = await User.create({
      fullName,
      businessName,
      email,
      passwordHash:            password,   // will be hashed by pre-save hook
      verificationToken,
      verificationTokenExpiry: tokenExpiry
    });

    // Automatically create a default record book for the new user
    await RecordBook.create({
      userId:   user._id,
      name:     businessName + ' — Main Book',
      currency: 'NGN'
    });

    // Send verification email — only in production
    // In development, auto-verify the user so you can test without email
    if (process.env.NODE_ENV === 'production') {
      // Fire-and-forget — don't await the email so the user gets a response
      // instantly instead of waiting 2-5 seconds for SMTP to respond.
      // If the email fails, the user can request a new one. The account
      // is already created so we should never block the response for this.
      sendVerificationEmail(user, verificationToken)
        .catch(err => console.warn('⚠️  Verification email failed:', err.message));
    } else {
      // Dev mode: auto-verify immediately so you don't need to click a link
      user.isVerified          = true;
      user.verificationToken   = undefined;
      user.verificationTokenExpiry = undefined;
      await user.save();
      console.log('✅ Dev mode: user auto-verified:', user.email);
    }

    // Generate JWT token for immediate login after registration
    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: user.toPublicJSON()
    }, process.env.NODE_ENV === 'production' ? 'Registration successful! Please check your email to verify your account.' : 'Registration successful!', 201);

  } catch (error) {
    console.error('Register error:', error);
    return errorResponse(res, error.message || 'Registration failed', 500);
  }
};

// ─────────────────────────────────────────
// LOGIN
// POST /api/auth/login
// ─────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { businessName, password } = req.body;

    // Find user by business name
    // We use .select('+passwordHash') because passwordHash has select:false in the schema
    const user = await User.findOne({
      businessName: { $regex: new RegExp(`^${escapeRegex(businessName)}$`, 'i') }
    }).select('+passwordHash');

    if (!user) {
      // Use a generic message — don't tell attacker which field is wrong
      return errorResponse(res, 'Invalid business name or password', 401);
    }

    // Compare provided password with stored hash
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid business name or password', 401);
    }

    // In production, block users who have not verified their email address.
    // In dev mode this check is skipped because register() auto-verifies the
    // user so you can test without clicking an email link.
    if (process.env.NODE_ENV === 'production' && !user.isVerified) {
      return errorResponse(
        res,
        'Please verify your email before logging in. Check your inbox for the verification link.',
        401
      );
    }

    // Block suspended accounts
    if (user.isSuspended) {
      return errorResponse(res, 'This account has been suspended. Please contact support.', 403);
    }

    // Generate a JWT token
    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: user.toPublicJSON()
    }, 'Login successful');

  } catch (error) {
    console.error('Login error:', error);
    return errorResponse(res, 'Login failed. Please try again.', 500);
  }
};

// ─────────────────────────────────────────
// VERIFY EMAIL
// GET /api/auth/verify-email/:token
// ─────────────────────────────────────────
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    // Find user with matching token that hasn't expired
    const user = await User.findOne({
      verificationToken:       token,
      verificationTokenExpiry: { $gt: Date.now() }  // $gt = greater than (not yet expired)
    }).select('+verificationToken +verificationTokenExpiry');

    if (!user) {
      return errorResponse(res, 'Verification link is invalid or has expired', 400);
    }

    // Mark as verified and clear the token
    user.isVerified              = true;
    user.verificationToken       = undefined;
    user.verificationTokenExpiry = undefined;
    await user.save();

    return successResponse(res, null, 'Email verified successfully! You can now log in.');

  } catch (error) {
    return errorResponse(res, 'Email verification failed', 500);
  }
};

// ─────────────────────────────────────────
// FORGOT PASSWORD
// POST /api/auth/forgot-password
// ─────────────────────────────────────────
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });

    // Don't reveal if the email exists or not (security best practice)
    if (!user) {
      return successResponse(res, null, 'If that email is registered, a reset link has been sent.');
    }

    const resetToken  = generateSecureToken();
    const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.resetPasswordToken  = resetToken;
    user.resetPasswordExpiry = tokenExpiry;
    await user.save({ validateBeforeSave: false });

    // Fire-and-forget — respond immediately, don't block on SMTP
    // If email fails, user can try again. Token is already saved in DB.
    sendPasswordResetEmail(user, resetToken)
      .catch(async (err) => {
        console.warn('⚠️  Password reset email failed:', err.message);
        // Clean up the token if email failed completely
        try {
          user.resetPasswordToken  = undefined;
          user.resetPasswordExpiry = undefined;
          await user.save({ validateBeforeSave: false });
        } catch (_) { /* ignore cleanup error */ }
      });

    return successResponse(res, null, 'Password reset link has been sent to your email.');

  } catch (error) {
    return errorResponse(res, 'Something went wrong. Please try again.', 500);
  }
};

// ─────────────────────────────────────────
// RESET PASSWORD
// POST /api/auth/reset-password/:token
// ─────────────────────────────────────────
const resetPassword = async (req, res) => {
  try {
    const { token }    = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      resetPasswordToken:  token,
      resetPasswordExpiry: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpiry');

    if (!user) {
      return errorResponse(res, 'Reset link is invalid or has expired', 400);
    }

    // Update the password (pre-save hook will hash it)
    user.passwordHash        = password;
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();

    return successResponse(res, null, 'Password reset successful. You can now log in.');

  } catch (error) {
    return errorResponse(res, 'Password reset failed', 500);
  }
};

// ─────────────────────────────────────────
// GET CURRENT USER (me)
// GET /api/auth/me
// Requires: JWT token in Authorization header
// ─────────────────────────────────────────
const getMe = async (req, res) => {
  // req.user is a plain lean object (set by the protect middleware).
  // We manually shape the public fields instead of calling toPublicJSON()
  // since that method only exists on full Mongoose document instances.
  const u = req.user;
  return successResponse(res, {
    user: {
      id:           u._id,
      fullName:     u.fullName,
      businessName: u.businessName,
      email:        u.email,
      currency:     u.currency,
      timezone:     u.timezone,
      isVerified:   u.isVerified,
      isSuspended:  u.isSuspended,
      createdAt:    u.createdAt
    }
  });
};

// ─────────────────────────────────────────
// UPDATE PROFILE
// PUT /api/auth/me
// ─────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { fullName, businessName, email, currency, timezone } = req.body;

    // Build update object — only include fields that were sent
    const updates = {};
    if (fullName)     updates.fullName     = fullName;
    if (businessName) updates.businessName = businessName;
    if (email)        updates.email        = email.toLowerCase();
    if (currency)     updates.currency     = currency;
    if (timezone)     updates.timezone     = timezone;

    // Uniqueness checks — do these BEFORE the update so we return a clear
    // error message instead of a raw MongoDB E11000 duplicate-key crash.
    if (businessName) {
      const taken = await User.findOne({
        businessName: { $regex: new RegExp(`^${escapeRegex(businessName)}$`, 'i') },
        _id: { $ne: req.user._id }   // exclude the current user from the check
      });
      if (taken) return errorResponse(res, 'That business name is already taken', 400);
    }

    if (email) {
      const taken = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: req.user._id }
      });
      if (taken) return errorResponse(res, 'That email is already registered to another account', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    return successResponse(res, { user: user.toPublicJSON() }, 'Profile updated');

  } catch (error) {
    return errorResponse(res, error.message || 'Update failed', 500);
  }
};

module.exports = {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile
};
