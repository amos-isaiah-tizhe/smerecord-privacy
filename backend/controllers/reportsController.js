/**
 * controllers/reportsController.js
 *
 * Reports use MongoDB "aggregation" — a powerful way to
 * group, sum, and transform data directly in the database.
 *
 * Think of aggregation like a pipeline:
 *   data → filter → group → sort → result
 */

const Transaction = require('../models/Transaction');
const { successResponse, errorResponse, getPeriodDates } = require('../utils/helpers');
const mongoose = require('mongoose');

// ─────────────────────────────────────────
// DASHBOARD SUMMARY
// GET /api/reports/summary?bookId=xxx&period=month
// Returns: total income, total expense, net balance, cash/bank split
// ─────────────────────────────────────────
const getSummary = async (req, res) => {
  try {
    const { bookId, period = 'month' } = req.query;

    const match = {
      userId:    req.user._id,
      isDeleted: false
    };

    if (bookId) match.bookId = new mongoose.Types.ObjectId(bookId);

    // Apply date filter
    const { from, to } = getPeriodDates(period);
    if (from) match.date = { $gte: from };
    if (to)   match.date = { ...(match.date || {}), $lte: to };

    // MongoDB aggregation pipeline
    const result = await Transaction.aggregate([
      // Stage 1: filter to matching documents
      { $match: match },

      // Stage 2: group all documents together and calculate totals
      {
        $group: {
          _id: null,  // null means group everything into one bucket

          totalIncome:  { $sum: { $cond: [{ $eq: ['$type', 'income']  }, '$amount', 0] } },
          totalExpense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },

          cashIncome:   { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'income']  }, { $eq: ['$paymentMethod', 'cash'] }] }, '$amount', 0] } },
          bankIncome:   { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'income']  }, { $eq: ['$paymentMethod', 'bank'] }] }, '$amount', 0] } },
          cashExpense:  { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'expense'] }, { $eq: ['$paymentMethod', 'cash'] }] }, '$amount', 0] } },
          bankExpense:  { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'expense'] }, { $eq: ['$paymentMethod', 'bank'] }] }, '$amount', 0] } },

          incomeCount:  { $sum: { $cond: [{ $eq: ['$type', 'income']  }, 1, 0] } },
          expenseCount: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, 1, 0] } },
          totalTxCount: { $sum: 1 }
        }
      }
    ]);

    // If no transactions, return zeros
    const data = result[0] || {
      totalIncome: 0, totalExpense: 0,
      cashIncome: 0,  bankIncome: 0,
      cashExpense: 0, bankExpense: 0,
      incomeCount: 0, expenseCount: 0, totalTxCount: 0
    };

    data.netBalance = data.totalIncome - data.totalExpense;
    data.cashOnHand = data.cashIncome  - data.cashExpense;

    return successResponse(res, data);

  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ─────────────────────────────────────────
// MONTHLY TREND (last 12 months)
// GET /api/reports/monthly?bookId=xxx
// Returns: month-by-month income and expense totals
// ─────────────────────────────────────────
const getMonthlyTrend = async (req, res) => {
  try {
    const { bookId } = req.query;

    const match = {
      userId:    req.user._id,
      isDeleted: false,
      date:      { $gte: new Date(new Date().setMonth(new Date().getMonth() - 11)) }
    };

    if (bookId) match.bookId = new mongoose.Types.ObjectId(bookId);

    const result = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          // Group by year + month
          _id: {
            year:  { $year:  '$date' },
            month: { $month: '$date' }
          },
          income:  { $sum: { $cond: [{ $eq: ['$type', 'income']  }, '$amount', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
          count:   { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Format the result for the frontend chart
    const months    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formatted = result.map(r => ({
      label:   months[r._id.month - 1] + ' ' + r._id.year,
      income:  r.income,
      expense: r.expense,
      balance: r.income - r.expense,
      count:   r.count
    }));

    return successResponse(res, { months: formatted });

  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ─────────────────────────────────────────
// CATEGORY BREAKDOWN
// GET /api/reports/categories?bookId=xxx&type=expense&period=month
// ─────────────────────────────────────────
const getCategoryBreakdown = async (req, res) => {
  try {
    const { bookId, type = 'expense', period = 'month' } = req.query;

    const match = {
      userId:    req.user._id,
      isDeleted: false,
      type
    };

    if (bookId) match.bookId = new mongoose.Types.ObjectId(bookId);

    const { from, to } = getPeriodDates(period);
    if (from) match.date = { $gte: from };
    if (to)   match.date = { ...(match.date || {}), $lte: to };

    const result = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id:   '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }  // highest spending first
    ]);

    // Calculate percentages
    const grandTotal = result.reduce((sum, r) => sum + r.total, 0);
    const categories = result.map(r => ({
      name:       r._id || 'Uncategorized',
      total:      r.total,
      count:      r.count,
      percentage: grandTotal ? Math.round((r.total / grandTotal) * 100) : 0
    }));

    return successResponse(res, { categories, grandTotal });

  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { getSummary, getMonthlyTrend, getCategoryBreakdown };
