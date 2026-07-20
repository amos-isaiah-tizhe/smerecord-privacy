/**
 * scripts/seed.js — Database Seeder
 *
 * Creates the very first superadmin account in your MongoDB database.
 * Run it ONCE, right after configuring backend/.env for the first time.
 *
 * HOW TO RUN (from the project root, in VS Code's integrated terminal):
 *   npm run seed
 *
 * After running, log into the Admin Panel with:
 *   Username: admin
 *   Password: Admin@1234
 *
 * ⚠️  CHANGE THE PASSWORD immediately after first login!
 *     Admin Panel → Settings → Admin Account
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Admin    = require('../models/Admin');
const connectDB= require('../config/db');

const seed = async () => {
  console.log('\n🌱 SME Record — Database Seeder\n');

  // Connect to MongoDB
  await connectDB();

  try {

    // ─────────────────────────────────────────
    // Check if a superadmin already exists
    // ─────────────────────────────────────────
    const existing = await Admin.findOne({ role: 'superadmin' });

    if (existing) {
      // Repair an older record that may be missing the `username` field
      // (caused username-based login to fail with "Invalid credentials").
      if (!existing.username) {
        existing.username = 'admin';
        await existing.save({ validateBeforeSave: false });
        console.log('🔧  Repaired existing superadmin: username set to "admin".');
      }
      console.log('✅  A superadmin already exists:');
      console.log(`   Name:     ${existing.name}`);
      console.log(`   Username: ${existing.username}`);
      console.log(`   Email:    ${existing.email}`);
      console.log('\n   Seeder skipped creation — no password changes made.\n');
      process.exit(0);
    }

    // ─────────────────────────────────────────
    // Create the superadmin
    // The pre-save hook in Admin.js will bcrypt-hash
    // the password automatically before saving.
    // ─────────────────────────────────────────
    const admin = await Admin.create({
      username:     'admin',
      name:         'Super Admin',
      email:        'admin@smerecord.com',
      passwordHash: 'Admin@1234',   // ← Will be hashed automatically
      role:         'superadmin',
      isActive:     true
    });

    console.log('✅  Superadmin created successfully!\n');
    console.log('   ┌─────────────────────────────────────┐');
    console.log('   │  ADMIN LOGIN CREDENTIALS             │');
    console.log('   │                                      │');
    console.log(`   │  Username : admin                    │`);
    console.log(`   │  Password : Admin@1234               │`);
    console.log('   │                                      │');
    console.log('   │  ⚠️  Change password after login!    │');
    console.log('   └─────────────────────────────────────┘\n');

    console.log('   Admin Panel URL: http://localhost:5000');
    console.log('   Frontend:        open frontend/admin-login.html\n');

  } catch (error) {
    console.error('❌  Seeder failed:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('   Database connection closed.\n');
    process.exit(0);
  }
};

seed();
