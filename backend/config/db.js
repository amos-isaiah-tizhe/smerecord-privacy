'use strict';
const mongoose = require('mongoose');

mongoose.connection.on('connected',    () => console.log(`✅  MongoDB → ${mongoose.connection.host}`));
mongoose.connection.on('disconnected', () => console.warn('⚠️   MongoDB disconnected'));
mongoose.connection.on('reconnected',  () => console.log('✅  MongoDB reconnected'));
mongoose.connection.on('error',        e  => console.error('❌  MongoDB error:', e.message));

module.exports = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS:          60000,
      heartbeatFrequencyMS:     10000,
      maxPoolSize:              10,
      minPoolSize:              2,
    });
  } catch (e) {
    console.error('❌  MongoDB connection failed:', e.message);
    process.exit(1);
  }
};
