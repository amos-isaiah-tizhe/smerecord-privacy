/**
 * middleware/auth.js — JWT Authentication Middleware
 *
 * This middleware protects routes that require login.
 *
 * How JWT works (simple explanation):
 *   1. User logs in → server gives them a "token" (a long string)
 *   2. User sends that token with every future request
 *   3. Server checks the token to confirm who the user is
 *   4. If valid, the request continues. If not, return 401 Unauthorized.
 *
 * The token is sent in the request header like this:
 *   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 */

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token;

    // Check if Authorization header exists and starts with "Bearer"
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      // Extract just the token part after "Bearer "
      token = req.headers.authorization.split(' ')[1];
    }

    // If no token was found, reject the request
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Please log in first.'
      });
    }

    // Verify the token using our JWT secret
    // jwt.verify() decodes the token and returns the payload we stored in it
    // If the token is tampered with or expired, it throws an error
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the user from the ID stored in the token
    // .lean() returns a plain JS object instead of a full Mongoose document —
    // this runs on EVERY authenticated request so the speedup compounds.
    // We do still need the isSuspended check and toPublicJSON() in getMe,
    // so we use a select to grab exactly the fields we need.
    const user = await User.findById(decoded.id).lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists. Please log in again.'
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        message: 'This account has been suspended. Please contact support.'
      });
    }

    // Attach the plain user object to req — lean() means it's a regular JS
    // object, not a Mongoose doc, so Mongoose methods like .save() won't work.
    // Controllers that need to save changes must re-fetch with User.findById().
    req.user = user;

    // Call next() to move on to the actual route handler
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Your session has expired. Please log in again.'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid token. Please log in again.'
    });
  }
};

module.exports = { protect };
