/**
 * models/RecordBook.js
 *
 * A RecordBook belongs to a User.
 * One user can have multiple books (e.g. "Main Business", "Side Hustle").
 * All transactions are linked to a specific book.
 */

const mongoose = require('mongoose');

const RecordBookSchema = new mongoose.Schema(
  {
    // Which user owns this book?
    // mongoose.Schema.Types.ObjectId is the type MongoDB uses for IDs.
    // ref: 'User' means it references the User model — this is called a "relationship".
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true    // index = faster queries when filtering by userId
    },

    name: {
      type:     String,
      required: [true, 'Book name is required'],
      trim:     true,
      maxlength: [100, 'Book name cannot exceed 100 characters']
    },

    currency: {
      type:    String,
      default: 'NGN',
      enum:    ['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR']
    },

    description: {
      type:    String,
      trim:    true,
      maxlength: [250, 'Description cannot exceed 250 characters']
    },

    // Soft delete: instead of actually deleting from DB,
    // we just mark isArchived = true and filter it out
    isArchived: {
      type:    Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

RecordBookSchema.index({
  userId: 1,
  isArchived: 1
});

module.exports = mongoose.model('RecordBook', RecordBookSchema);
