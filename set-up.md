# SME Record — Setup Guide (VS Code + Node.js + MongoDB Atlas)

This guide gets the app running on your **laptop** using **VS Code**, **Node.js**,
and a **MongoDB Atlas** (cloud) database. No mobile / Termux / browser-sync.

> Time required: ~10 minutes.

---

## 1. Prerequisites

Install once on your laptop:

| Tool | Version | Download |
| --- | --- | --- |
| **Node.js** | 18 LTS or newer | <https://nodejs.org/> |
| **Git** | any recent | <https://git-scm.com/> |
| **VS Code** | latest | <https://code.visualstudio.com/> |
| **MongoDB Atlas account** | free tier (M0) is fine | <https://www.mongodb.com/cloud/atlas/register> |

Verify Node + npm in a terminal:

```bash
node -v       # → v18.x or newer
npm  -v       # → 9.x or newer
```

Recommended VS Code extensions:

- **ESLint** (Microsoft)
- **DotENV** (mikestead) — syntax highlighting for `.env`
- **MongoDB for VS Code** (MongoDB) — browse your Atlas cluster from the editor
- **Prettier** (optional)

---

## 2. Get the code

```bash
git clone <your-repo-url> smerecord
cd smerecord
code .                  # opens the project in VS Code
```

From here on, use VS Code's integrated terminal:
**Terminal → New Terminal** (`` Ctrl+` ``).

Install dependencies (this also installs the backend deps via `postinstall`):

```bash
npm install
```

---

## 3. Create your MongoDB Atlas cluster

1. Sign in to <https://cloud.mongodb.com/>.
2. **Build a Database → M0 (Free)**. Pick the region closest to you. Click
   **Create**.
3. **Database Access → Add new database user**.
   - Authentication method: **Password**
   - Username: e.g. `smerecord_app`
   - Password: click **Autogenerate** and **save it somewhere safe**
   - Built-in role: **Read and write to any database**
   - Click **Add user**.
4. **Network Access → Add IP address**.
   - For local development click **Allow access from anywhere**
     (`0.0.0.0/0`). For production, lock this down to your server's IP.
5. **Database → Connect → Drivers → Node.js**, and copy the connection
   string. It looks like:

   ```
   mongodb+srv://smerecord_app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

6. Replace `<password>` with the real password (URL-encode any special
   characters — e.g. `#` becomes `%23`), and append the database name
   `smerecord` before the `?`:

   ```
   mongodb+srv://smerecord_app:YOURPASS@cluster0.xxxxx.mongodb.net/smerecord?retryWrites=true&w=majority
   ```

Keep this string ready for the next step.

---

## 4. Configure environment variables

Copy the example file:

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` in VS Code and fill in:

| Variable | Value |
| --- | --- |
| `MONGO_URI` | Your Atlas connection string from step 3 |
| `JWT_SECRET` | A long random hex string (see command below) |
| `ADMIN_JWT_SECRET` | **A second, different** long random hex string |
| `CLIENT_URL` | `http://localhost:5000` (for local dev) |
| `SMTP_*` | Optional — only needed if you want email verification / reset to actually send |

Generate each JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run it **twice** — first output for `JWT_SECRET`, second for `ADMIN_JWT_SECRET`.

> ⚠️  `backend/.env` is gitignored. **Never commit it.**

---

## 5. Seed the first admin

```bash
npm run seed
```

This connects to your Atlas cluster and creates a superadmin:

- **Username:** `admin`
- **Password:** `Admin@1234`

Re-running the seeder is safe — it will skip if a superadmin already exists.

---

## 6. Run the app

```bash
npm run dev
```

You should see:

```
✅  MongoDB → cluster0-shard-xx-xx.xxxxx.mongodb.net
✅ API → http://localhost:5000
```

Open in your browser:

| Page | URL |
| --- | --- |
| User app | <http://localhost:5000/> |
| User login / register | <http://localhost:5000/auth.html> |
| User dashboard | <http://localhost:5000/dashboard.html> |
| Admin login | <http://localhost:5000/admin-login.html> |
| Admin panel | <http://localhost:5000/admin.html> |
| Health check | <http://localhost:5000/health> |

The dev server auto-reloads when you save any file under `backend/`.
Frontend files are served as static assets — just **refresh** the browser.

> 🚨 **Change the seeded admin password right after your first admin login.**

---

## 7. Common tasks

### Run in production mode locally

```bash
NODE_ENV=production npm start
```

### Reset / re-create the superadmin

Delete the `admins` collection in Atlas (or drop just the superadmin
document), then run `npm run seed` again.

### Tail logs

`npm run dev` uses `morgan` in `dev` format. For production format use
`NODE_ENV=production npm start`.

### Inspect the database from VS Code

Install the **MongoDB for VS Code** extension → click the leaf icon in the
sidebar → **Add Connection** → paste your `MONGO_URI`. You can now browse
collections, run queries, and edit documents directly.

---

## 8. Deploying to Render (recommended)

The repo ships a `render.yaml` Blueprint.

1. Push the repo to GitHub.
2. In the Render dashboard click **New + → Blueprint**, point it at the repo.
3. Render will:
   - run `npm install` (which also installs `backend/` deps),
   - run `npm start` (which boots `backend/app.js`),
   - generate `JWT_SECRET` and `ADMIN_JWT_SECRET` automatically,
   - wire `/health` as the health check.
4. Provide these env vars when prompted:
   - `MONGO_URI` — your Atlas connection string.
   - `CLIENT_URL` — `https://<your-service>.onrender.com`.
   - `RENDER_EXTERNAL_URL` — same as `CLIENT_URL` (Render also injects it
     automatically).
   - `SMTP_*` and `EMAIL_FROM` — your transactional email provider
     (SendGrid, Mailgun, Brevo, Postmark, …). Optional.
5. After the first deploy, open a Render **Shell** and run once:

   ```bash
   npm run seed
   ```

6. Visit `https://<your-service>.onrender.com/admin-login.html`, sign in
   as `admin` / `Admin@1234`, and change the password immediately.

---

## 9. Troubleshooting

**`❌ Missing required env variable: MONGO_URI`**
You haven't created `backend/.env` (or the file is empty). Re-do step 4.

**`MongoServerError: bad auth: Authentication failed`**
Wrong username or password in `MONGO_URI`. Remember to URL-encode special
characters in the password (`#` → `%23`, `@` → `%40`, …).

**`MongooseServerSelectionError: ... timed out`**
Your laptop's IP isn't whitelisted in Atlas → **Network Access → Add IP
Address** → **Allow Access from Anywhere** (for dev only).

**Browser can't reach `http://localhost:5000`**
Port 5000 is already in use. Either stop the other process, or set
`PORT=5050` in `backend/.env` and reload.

**Admin login returns "Invalid credentials" right after seeding**
Make sure you're hitting `/admin-login.html`, not the user login. Username
is `admin`, password is `Admin@1234` (case-sensitive).

**Emails don't send in dev**
That's expected unless you set valid `SMTP_*` values. In development the
user-registration flow **auto-verifies** new accounts so you can log in
without clicking a link.

---

That's it — you're production-ready. 🎉
