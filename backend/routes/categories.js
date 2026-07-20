/**
 * routes/categories.js
 *
 * PERFORMANCE NOTES:
 * - GET uses .lean() — returns plain JS objects, ~2x faster than Mongoose docs
 * - GET uses a per-user in-memory cache (5-min TTL) — categories rarely change
 *   so repeated dashboard loads don't hammer MongoDB on every open
 * - Cache is invalidated on every write (POST/PUT/DELETE) so changes are
 *   always immediately visible
 */

const express    = require('express');
const router     = express.Router();
const Category   = require('../models/Category');
const { protect }= require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/helpers');

router.use(protect);

// ── In-memory per-user cache ──────────────────────────────────────────────────
// Key:   userId string
// Value: { data: { categories }, expiresAt: timestamp }
//
// Why in-memory and not Redis?
//   Redis costs money. For ≤50 concurrent users, a Map in the Node process
//   is perfectly sufficient and free.
//
// Why 5 minutes TTL?
//   Categories change rarely (user adds a new one every few days at most).
//   5 minutes means at worst the user sees a slightly stale category list
//   for up to 5 minutes — but only if they use two devices simultaneously,
//   since writes always bust the cache for that process.
//
// Limitation:
//   With Node cluster (multiple worker processes), each worker has its own
//   Map so writes in worker A don't bust the cache in worker B. On the
//   free/starter Render plan (1 instance) this never happens. If you scale
//   to multiple instances, replace this with Redis.
// ─────────────────────────────────────────────────────────────────────────────
const _cache  = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

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

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const userId = String(req.user._id);

    // Build filter — only include type filter if specified, since we cache
    // the full list and the frontend filters client-side anyway
    const filter = { userId: req.user._id };
    const typeFilter = req.query.type;

    // Use cache only for the unfiltered request (most common case)
    if (!typeFilter) {
      const cached = getCached(userId);
      if (cached) {
        return successResponse(res, cached);
      }
    }

    if (typeFilter) filter.type = typeFilter;

    // .lean() skips Mongoose document wrapper — ~2x faster for read-only queries
    const categories = await Category.find(filter).sort({ name: 1 }).lean();
    const data = { categories };

    // Only cache the full unfiltered result
    if (!typeFilter) {
      setCached(userId, data);
    }

    return successResponse(res, data);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// POST /api/categories
router.post('/', async (req, res) => {
  try {
    const { name, type, subCategories, icon, color } = req.body;
    if (!name || !type) return errorResponse(res, 'Name and type are required');

    const category = await Category.create({
      userId: req.user._id,
      name, type,
      subCategories: subCategories || [],
      icon, color
    });

    // Bust cache — new category must appear immediately on next load
    invalidateCache(String(req.user._id));

    return successResponse(res, { category }, 'Category created', 201);
  } catch (e) {
    if (e.code === 11000) return errorResponse(res, 'Category with this name already exists');
    return errorResponse(res, e.message, 500);
  }
});

// PUT /api/categories/:id — update (add/remove subcategories)
router.put('/:id', async (req, res) => {
  try {
    const cat = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name: req.body.name, subCategories: req.body.subCategories, icon: req.body.icon, color: req.body.color },
      { new: true, runValidators: true }
    );
    if (!cat) return errorResponse(res, 'Category not found', 404);

    // Bust cache — updated category must appear immediately on next load
    invalidateCache(String(req.user._id));

    return successResponse(res, { category: cat }, 'Category updated');
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
  try {
    const cat = await Category.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!cat) return errorResponse(res, 'Category not found', 404);

    // Bust cache — deleted category must vanish immediately on next load
    invalidateCache(String(req.user._id));

    return successResponse(res, null, 'Category deleted');
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

module.exports = router;
