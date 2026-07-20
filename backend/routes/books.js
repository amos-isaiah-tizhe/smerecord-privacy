/**
 * routes/books.js
 *
 * PERFORMANCE NOTES:
 * - GET uses .lean() for the RecordBook query
 * - GET uses a single aggregation instead of N per-book queries (N+1 fix)
 * - GET uses a per-user in-memory cache (2-min TTL) — books change rarely
 *   but totals change with every transaction, so TTL is shorter than categories
 * - Cache is invalidated on every write (POST/PUT/DELETE) so changes appear
 *   immediately after the user performs an action
 */

const express     = require('express');
const router      = express.Router();
const RecordBook  = require('../models/RecordBook');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/helpers');

router.use(protect);

// ── In-memory per-user cache ──────────────────────────────────────────────────
// Shorter TTL than categories (2 min vs 5 min) because book totals change
// every time the user logs a transaction. We still cache to avoid hammering
// the DB on every page refresh/navigation.
// ─────────────────────────────────────────────────────────────────────────────
const _cache    = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function getCached(userId) {
  const entry = _cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(userId);
    return null;
  }
  return entry.data;
}

function setCached(userId, data) {
  _cache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL });
}

function invalidateCache(userId) {
  _cache.delete(String(userId));
}

// Attach the cache invalidator to the router object so transactionController
// can import it via require('../routes/books').invalidateBooksCache.
// IMPORTANT: this must come BEFORE module.exports = router, because
// `module.exports = router` replaces the entire exports object — any
// property set on module.exports before that line gets wiped out.
router.invalidateBooksCache = invalidateCache;

module.exports = router;
router.get('/', async (req, res) => {
  try {
    const userId = String(req.user._id);

    const cached = getCached(userId);
    if (cached) return successResponse(res, cached);

    const books = await RecordBook.find({
      userId: req.user._id,
      isArchived: false
    }).lean();

    // Single aggregation across all of the user's books instead of one
    // query per book (avoids N+1 query fan-out as the number of books grows).
    const totals = await Transaction.aggregate([
      { $match: { userId: req.user._id, isDeleted: false } },
      {
        $group: {
          _id: '$bookId',
          totalIncome:  { $sum: { $cond: [{ $eq: ['$type', 'income']  }, '$amount', 0] } },
          totalExpense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } }
        }
      }
    ]);

    const totalsMap = {};
    totals.forEach(t => { totalsMap[t._id.toString()] = t; });

    const booksWithTotals = books.map(book => {
      const t = totalsMap[book._id.toString()];
      return {
        ...book,
        totalIncome:  t ? t.totalIncome  : 0,
        totalExpense: t ? t.totalExpense : 0
      };
    });

    const data = { books: booksWithTotals };
    setCached(userId, data);

    return successResponse(res, data);

  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// POST /api/books — create a new book
router.post('/', async (req, res) => {
  try {
    const { name, currency, description } = req.body;
    if (!name) return errorResponse(res, 'Book name is required');

    const book = await RecordBook.create({
      userId: req.user._id,
      name, currency, description
    });

    invalidateCache(String(req.user._id));

    return successResponse(res, { book }, 'Record book created', 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// PUT /api/books/:id — update a book
router.put('/:id', async (req, res) => {
  try {
    const book = await RecordBook.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name: req.body.name, currency: req.body.currency, description: req.body.description },
      { new: true, runValidators: true }
    );
    if (!book) return errorResponse(res, 'Book not found', 404);

    invalidateCache(String(req.user._id));

    return successResponse(res, { book }, 'Book updated');
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// DELETE /api/books/:id — archive a book
router.delete('/:id', async (req, res) => {
  try {
    const book = await RecordBook.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isArchived: true },
      { new: true }
    );
    if (!book) return errorResponse(res, 'Book not found', 404);

    invalidateCache(String(req.user._id));

    return successResponse(res, null, 'Record book archived');
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

module.exports = router;
