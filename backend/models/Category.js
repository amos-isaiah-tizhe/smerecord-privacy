/**
 * models/Category.js
 *
 * Users can create their own custom income/expense categories
 * and sub-categories. Each category is scoped to a user.
 */

const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true
    },

    name: {
      type:     String,
      required: [true, 'Category name is required'],
      trim:     true,
      maxlength: [60, 'Category name cannot exceed 60 characters']
    },

    // "income" or "expense" — which form this category appears in
    type: {
      type:     String,
      required: true,
      enum:     ['income', 'expense']
    },

    // Array of sub-category name strings
    // Example: category "Transport" might have subCategories ["Fuel", "Uber", "Bus fare"]
    subCategories: {
      type:    [String],
      default: []
    },

    // Optional icon name (Font Awesome class suffix, e.g. "car", "utensils")
    icon: {
      type:    String,
      default: 'tag'
    },

    // Optional color for visual grouping
    color: {
      type:    String,
      default: '#6b7280'
    }
  },
  {
    timestamps: true
  }
);

// A user cannot have two categories with the same name and type
CategorySchema.index({ userId: 1, name: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Category', CategorySchema);
