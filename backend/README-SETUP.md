# SME Record — Backend Setup Guide (Termux)

## Full Project Structure

```
backend/
├── app.js                    ← Express server
├── .env.example              ← Copy to .env
├── package.json
├── scripts/
│   └── seed.js               ← Run once: creates superadmin
├── config/
│   └── db.js                 ← MongoDB connection
├── models/
│   ├── User.js
│   ├── Admin.js              ← Separate admin accounts
│   ├── RecordBook.js
│   ├── Transaction.js
│   ├── Category.js
│   ├── Notification.js       ← Admin-sent notifications
│   ├── ActivityLog.js        ← Admin audit trail
│   └── PlatformSettings.js   ← Feature flags + config
├── controllers/
│   ├── authController.js     ← User auth (register/login)
│   ├── adminController.js    ← ALL admin operations
│   ├── transactionController.js
│   └── reportsController.js
├── routes/
│   ├── auth.js               ← /api/auth/*
│   ├── admin.js              ← /api/admin/*  ← NEW
│   ├── books.js
│   ├── transactions.js
│   ├── categories.js
│   └── reports.js
└── middleware/
    ├── auth.js               ← User JWT check
    ├── adminAuth.js          ← Admin JWT + RBAC check
    └── validate.js
```

---

## Termux Setup (Step by Step)

### 1. Install packages

```bash
pkg update && pkg upgrade -y
pkg install nodejs mongodb -y
```

### 2. Start MongoDB

```bash
mkdir -p $HOME/mongodb-data
mongod --dbpath $HOME/mongodb-data --fork --logpath $HOME/mongodb.log
```

Verify it's running:
```bash
mongo --eval "db.adminCommand('ping')"
# Should print: { ok: 1 }
```

### 3. Install Node dependencies

```bash
cd backend
npm install
```

### 4. Configure environment

```bash
cp .env.example .env
nano .env
```

Required values to set:
```bash
MONGO_URI=mongodb://localhost:27017/smerecord
JWT_SECRET=<generate below>
ADMIN_JWT_SECRET=<generate below — must be different>
```

Generate secure secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Run this twice, use first output for JWT_SECRET, second for ADMIN_JWT_SECRET.

### 5. Seed the database

```bash
npm run seed
```

Creates your first superadmin:
- **Username:** admin
- **Password:** Admin@1234

Change the password immediately after first login.

### 6. Start server

```bash
npm run dev   # development (auto-restart)
npm start     # production
```

Expect to see:
```
✅ MongoDB Connected: localhost
✅ SME Record API running on http://localhost:5000
```

---

## Admin Panel API

All admin routes need this header:
```
Authorization: Bearer <token_from_admin_login>
```

Admin login:
```bash
curl -X POST http://localhost:5000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@1234"}'
```

Returns:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "admin": { "name": "Super Admin", "role": "superadmin" }
  }
}
```

Use that token for all subsequent admin requests.

---

## Admin Role Hierarchy

```
superadmin  → Everything
moderator   → View + suspend users + send notifications
viewer      → Read-only (stats, analytics, logs)
```

Admin routes guarded by role:
- `requireRole('superadmin')` → delete user, wipe data, manage admins
- `protectAdmin` only → all other admin routes (any logged-in admin)

---

## Security Notes

| Layer | What's Protected |
|-------|-----------------|
| Rate limiting | 5 login attempts / 15 min for admin login |
| Account lockout | 30 min lockout after 5 wrong passwords |
| Separate JWT secrets | User tokens cannot access admin routes |
| Helmet.js | HTTP security headers |
| bcrypt (12 rounds) | Admin passwords hashed stronger than users |
| Input validation | All POST/PUT inputs validated |
| Activity log | Every admin action written to ActivityLog collection |

---

## Feature Flags (via Admin Settings)

Stored in `PlatformSettings` MongoDB document:

| Flag | Default | Effect |
|------|---------|--------|
| `allowRegistration` | true | Block/allow new user signups |
| `requireEmailVerify` | false | Force email verification |
| `maintenanceMode` | false | Show maintenance page to users |
| `allowCSVExport` | true | Enable/disable CSV export for users |

---

## Common Termux Issues

**MongoDB won't start:**
```bash
# Check if it's already running
pgrep mongod
# Kill it and restart
pkill mongod
mongod --dbpath $HOME/mongodb-data --fork --logpath $HOME/mongodb.log
```

**Port 5000 already in use:**
```bash
# Find and kill the process
lsof -i :5000
kill -9 <PID>
# Or change PORT in .env to 5001
```

**npm install fails:**
```bash
# Clear cache and retry
npm cache clean --force
npm install
```

**Cannot connect to MongoDB from Node:**
- Make sure `mongod` is running first
- Check `MONGO_URI` in `.env` matches exactly: `mongodb://localhost:27017/smerecord`
