/**
 * models/Transaction.js
 *
 * The heart of the app. Every income or expense entry
 * is stored as a Transaction document.
 */

const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true
    },

    bookId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'RecordBook',
      required: true,
      index:    true
    },

    // "income" or "expense"
    type: {
      type:     String,
      required: true,
      enum:     ['income', 'expense']
    },

    amount: {
      type:     Number,
      required: [true, 'Amount is required'],
      min:      [0.01, 'Amount must be greater than 0']
    },

    // How was the money moved?
    paymentMethod: {
      type:    String,
      default: 'cash',
      enum:    ['cash', 'bank', 'pos', 'mobile', 'cheque', 'other']
    },

    category: {
      type:  String,
      trim:  true,
      default: 'Uncategorized'
    },

    subCategory: {
      type:  String,
      trim:  true,
      default: ''
    },

    description: {
      type:     String,
      trim:     true,
      maxlength: [500, 'Description cannot exceed 500 characters']
    },

    // The actual date of the transaction (not when it was recorded)
    date: {
      type:     Date,
      required: [true, 'Transaction date is required'],
      index:    true
    },

    // Optional: attach a reference number (invoice, receipt ID, etc.)
    referenceNumber: {
      type:  String,
      trim:  true
    },

    // Tags for flexible labelling (e.g. ["urgent", "recurring"])
    tags: [String],

    // Soft delete
    isDeleted: {
      type:    Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

TransactionSchema.index({
  userId: 1,
  isDeleted: 1,
  date: -1
});

// ─────────────────────────────────────────
// Compound indexes for faster queries
// When you filter by userId + bookId + date often,
// MongoDB can use this index instead of scanning every document.
// ─────────────────────────────────────────
TransactionSchema.index({ userId: 1, bookId: 1, date: -1 });
TransactionSchema.index({ userId: 1, bookId: 1, type: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
