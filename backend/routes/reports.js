/**
 * routes/reports.js
 */

const express    = require('express');
const router     = express.Router();
const { protect }= require('../middleware/auth');
const { getSummary, getMonthlyTrend, getCategoryBreakdown } = require('../controllers/reportsController');

router.use(protect);

// GET /api/reports/summary?bookId=xxx&period=month
router.get('/summary',    getSummary);

// GET /api/reports/monthly?bookId=xxx
router.get('/monthly',    getMonthlyTrend);

// GET /api/reports/categories?bookId=xxx&type=expense&period=month
router.get('/categories', getCategoryBreakdown);

module.exports = router;
