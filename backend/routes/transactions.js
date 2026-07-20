/**
 * routes/transactions.js
 */

const express = require('express');
const { body } = require('express-validator');
const router  = express.Router();

const {
  createTransaction,
  getTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction
} = require('../controllers/transactionController');

const { protect }  = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// All transaction routes require login
router.use(protect);

// GET  /api/transactions        — list with filters
// POST /api/transactions        — create new
router.route('/')
  .get(getTransactions)
  .post(
    [
      body('bookId').notEmpty().withMessage('Record book is required'),
      body('type')  .isIn(['income', 'expense']).withMessage('Type must be income or expense'),
      body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
      body('date')  .notEmpty().withMessage('Date is required')
    ],
    validate,
    createTransaction
  );

// GET    /api/transactions/:id  — get one
// PUT    /api/transactions/:id  — update
// DELETE /api/transactions/:id  — delete
router.route('/:id')
  .get(getTransaction)
  .put(updateTransaction)
  .delete(deleteTransaction);

module.exports = router;
