# SME Record

A production-ready **Business Financial Ledger** (income / expense bookkeeping)
for small and medium businesses, built by **OneXportal**.

SME Record is a centralized, cloud-based electronic financial ledger and bookkeeping system that enables businesses to securely record, manage, and monitor income, expenses, and financial transactions from a single trusted platform.

The app ships as **a single Node.js / Express service**:

- exposes a JSON API under `/api/*`
- serves the static frontend from `frontend/` on the same origin
- talks to **MongoDB Atlas** (cloud) — no local database required

> Stack: Node.js 18+, Express 4, Mongoose 8, JWT auth, vanilla HTML/JS frontend.

---

## 1. Project layout

```
smerecord/
├── package.json              ← root scripts (start, dev, seed)
├── render.yaml               ← Render Blueprint (one-click deploy)
├── set-up.md                 ← full step-by-step setup guide
├── README.md
├── backend/
│   ├── app.js                ← Express server entry
│   ├── package.json
│   ├── .env.example          ← copy to .env locally
│   ├── nodemon.json
│   ├── config/db.js          ← MongoDB connection
│   ├── models/               ← User, Admin, RecordBook, Transaction,
│   │                            Category, Notification, ActivityLog,
│   │                            PlatformSettings
│   ├── controllers/          ← auth, admin, transaction, reports
│   ├── routes/               ← /api/auth /api/books /api/transactions
│   │                            /api/categories /api/reports /api/admin/*
│   ├── middleware/           ← auth, adminAuth (RBAC), validate
│   ├── utils/                ← helpers, email
│   └── scripts/seed.js       ← creates first superadmin
└── frontend/
    ├── index.html  auth.html  dashboard.html
    ├── admin.html  admin-login.html
    └── api.js                ← API client (uses /api relative path)
```

---

## 2. Features

### User app

- Register / login with **business name + password** (JWT, 7-day expiry).
- Email verification + password reset flows (SMTP optional in dev).
- Multiple **record books** per business.
- Income / expense **transactions** with category, sub-category, payment
  method, reference number, tags, and notes.
- **Reports**: dashboard summary, monthly trend, category breakdown.
- Per-user **notifications** inbox (broadcast + targeted).

### Admin panel (separate JWT realm, RBAC)

- Roles: `superadmin` / `moderator` / `viewer`.
- Manage users (list, suspend, delete, reset data).
- Send broadcast or targeted notifications.
- View aggregate analytics + recent transactions.
- Tamper-evident **activity log** of every admin action.
- Platform settings (feature flags, limits).
- Maintenance utilities (DB stats, full data export).
- Manage other admins (superadmin only).

---

## 3. Security defaults

| Area            | What's enabled                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Transport       | `helmet`, `compression`, `trust proxy = 1`                                                                        |
| CORS            | Allowlist — `CLIENT_URL` + `RENDER_EXTERNAL_URL` in prod, `http://localhost:5000` in dev                          |
| Body limits     | `10mb` JSON + urlencoded                                                                                          |
| Rate limits     | 300 / 15 min global · 20 / 15 min on `/api/auth` · 10 / 15 min on `/api/admin/auth` · 5 / 15 min on admin login   |
| Passwords       | bcrypt cost 10 (users), cost 12 (admins)                                                                          |
| Tokens          | **Two separate JWT secrets** — `JWT_SECRET` for users, `ADMIN_JWT_SECRET` for admins; admin tokens expire in 12 h |
| Suspended users | Blocked at login **and** on every authenticated request                                                           |
| Soft-delete     | Transactions soft-deleted, books archived (recoverable)                                                           |
| Error handler   | Production responses never leak stack traces or internal messages                                                 |
| 404             | `/api/*` 404s stay JSON; everything else falls back to the SPA                                                    |

---

## 4. Quick start

```bash
git clone <your-repo> smerecord
cd smerecord
npm install                              # installs root + backend deps

cp backend/.env.example backend/.env     # then fill in MONGO_URI + secrets
npm run seed                             # creates first superadmin
npm run dev                              # → http://localhost:5000
```

Default admin credentials (change immediately after first login):

- **Username:** `admin`
- **Password:** `Admin@1234`

For the full walk-through — generating JWT secrets, configuring MongoDB
Atlas, and deploying to Render — see [`set-up.md`](./set-up.md).

---

## 5. Available scripts

Run these from the project root:

| Command        | What it does                                                |
| -------------- | ----------------------------------------------------------- |
| `npm install`  | Installs root deps **and** backend deps (via `postinstall`) |
| `npm start`    | Production server (`node backend/app.js`)                   |
| `npm run dev`  | Dev server with auto-reload (`nodemon backend/app.js`)      |
| `npm run seed` | One-time superadmin seeder                                  |

---

## 6. Audit summary (this revision)

The codebase was scanned end-to-end. Production-blocking and correctness
issues fixed in this build:

| #   | Severity     | Issue                                                                                                                                                                                                                         | Fix                                                                                                                                                                                               |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Critical** | Real `backend/.env` with live MongoDB Atlas credentials and JWT secrets was shipped inside the source bundle.                                                                                                                 | Removed; `.gitignore` widened to `**/.env`; only `.env.example` ships.                                                                                                                            |
| 2   | **Critical** | `User` model had no `isSuspended` / `suspendedAt` / `suspendedBy` / `suspendReason` fields, but the admin controller wrote to them. Mongoose strict mode **silently dropped** those writes, so suspending a user did nothing. | Added the four fields (with `isSuspended` indexed) and surfaced them in `toPublicJSON()`.                                                                                                         |
| 3   | **Critical** | Suspended users could still log in and use the API — the auth flow never checked the flag.                                                                                                                                    | Added an `isSuspended` check to both `POST /api/auth/login` and the `protect` middleware (returns `403`).                                                                                         |
| 4   | **High**     | Mobile-only / Termux dev workflow with `browser-sync` on a separate port. Caused a CORS-tied dual-origin setup that broke as soon as `CLIENT_URL` wasn't perfectly aligned.                                                   | Removed `browser-sync` from `package-lock.json` and the root scripts. Express now serves the static frontend on the same origin in dev and prod; `frontend/api.js` uses the relative `/api` path. |
| 5   | **High**     | `backend/package.json` had a dangling `npx live-server` script and an unused `backend` script pointing at a non-existent `server.js`.                                                                                         | Trimmed to `start` / `dev` / `seed`.                                                                                                                                                              |
| 6   | Medium       | `nodemon.json` watched only `app.js`, `routes`, `config`, `models` — editing a controller, middleware, or util did **not** restart the dev server.                                                                            | Expanded watch list to include `controllers`, `middleware`, `utils`.                                                                                                                              |
| 7   | Medium       | README and `backend/README-SETUP.md` documented a Termux-only workflow.                                                                                                                                                       | Replaced with this README and a fresh `set-up.md` describing VS Code + Node.js + MongoDB Atlas on a laptop.                                                                                       |
| 8   | Low          | `frontend/api.js` hard-coded `http://localhost:5000/api` for dev, requiring the page to know which port the API was on.                                                                                                       | Now uses `/api` relatively — works in dev (Express serves both) and prod.                                                                                                                         |

What was already solid and left untouched:

- Helmet, compression, request size limits, `trust proxy = 1`.
- Tiered rate limiting and the two-realm JWT split.
- bcrypt cost 12 for admins, 10 for users.
- Soft-delete for transactions, archive for books.
- Indexed `userId + bookId + date` for report aggregation.
- Centralised error handler with normalised JSON shape.
- SPA fallback that excludes `/api` and `/health`.

Admin URL: /admin-login.html

---

## 7. License

Proprietary © OneXportal. All rights reserved.
