/**
 * middleware/validate.js
 *
 * Checks if express-validator found any errors.
 * If yes, returns a 400 error. If no, continues to the controller.
 */

const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // Collect all error messages into one string
    const messages = errors.array().map(e => e.msg).join(', ');
    return res.status(400).json({ success: false, message: messages });
  }

  next();
};

module.exports = { validate };
