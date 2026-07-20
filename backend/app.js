'use strict';

// ── CLUSTER — use all available CPU cores ────────────────────────────────────
// Node.js is single-threaded. Without clustering, one slow bcrypt hash or
// MongoDB query can block everyone else. Clustering forks one worker per CPU
// core so requests run in parallel.
//
// On Render's free plan you get a shared vCPU so this mainly helps locally
// and on any paid plan with dedicated CPUs. It's harmless on single-core
// machines (just runs as one process — same as before).
// ─────────────────────────────────────────────────────────────────────────────
const cluster = require('cluster');
const os      = require('os');

if (cluster.isPrimary) {
  const cpuCount = os.cpus().length;
  console.log(`\n🔀 Starting ${cpuCount} worker${cpuCount > 1 ? 's' : ''} (${cpuCount} CPU core${cpuCount > 1 ? 's' : ''} available)`);

  // Fork one worker per CPU core
  for (let i = 0; i < cpuCount; i++) {
    cluster.fork();
  }

  // If a worker crashes for any reason, log it and immediately restart it
  // so the server never goes down due to one bad request
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`⚠️  Worker ${worker.process.pid} exited (${signal || code}). Restarting...`);
    cluster.fork();
  });

  cluster.on('online', (worker) => {
    console.log(`✅ Worker ${worker.process.pid} online`);
  });

} else {
  // ── WORKER PROCESS — runs the actual Express app ──────────────────────────
  require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Fail fast if required env vars are missing
const required = ['MONGO_URI', 'JWT_SECRET', 'ADMIN_JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
}

const express       = require('express');
const cors          = require('cors');
const helmet        = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const hpp           = require('hpp');
const rateLimit     = require('express-rate-limit');
const morgan        = require('morgan');
const compression   = require('compression');
const cookieParser  = require('cookie-parser');
const path          = require('path');

const connectDB = require('./config/db');
const app       = express();

app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Dev: localhost:5000 (direct)
// Prod: allow CLIENT_URL only
const devOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV === 'production') {
      const allowed = [process.env.CLIENT_URL, process.env.RENDER_EXTERNAL_URL].filter(Boolean);
      return cb(null, allowed.includes(origin));
    }
    return cb(null, devOrigins.includes(origin));
  },
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      scriptSrc: [
        "'self'",
        "https://challenges.cloudflare.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
      ],

      scriptSrcAttr: ["'none'"],

      frameSrc: [
        "https://challenges.cloudflare.com"
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com",
      ],

      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.gstatic.com",
        "data:",
      ],

      imgSrc: [
        "'self'",
        "data:",
        "https:",
      ],

      connectSrc: [
        "'self'",
        "https://challenges.cloudflare.com",
        "https://cdn.jsdelivr.net",
      ],

      frameAncestors: ["'none'"],
    },
  },

  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
app.use(mongoSanitize());
app.use(hpp());
// Compression is only useful in production; Render's CDN handles gzip on the
// edge anyway. In dev, skipping it keeps responses faster to inspect.
if (process.env.NODE_ENV === 'production') {
  app.use(compression());
}
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// ── RATE LIMITS ───────────────────────────────────────────────────────────────
const mkLimit = (max, msg) => rateLimit({
  windowMs: 15 * 60 * 1000, max,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: msg },
});

app.use(mkLimit(300, 'Too many requests. Please slow down.'));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth',         mkLimit(20,  'Too many auth attempts.'),  require('./routes/auth'));
app.use('/api/books',                                                   require('./routes/books'));
app.use('/api/transactions',                                            require('./routes/transactions'));
app.use('/api/categories',                                              require('./routes/categories'));
app.use('/api/reports',                                                 require('./routes/reports'));
app.use('/api/admin/auth',   mkLimit(10,  'Too many admin attempts.'), require('./routes/adminAuth'));
app.use('/api/admin',                                                   require('./routes/admin'));

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── SERVE FRONTEND (same origin in dev AND prod) ─────────────────────────────
// Express serves the static SPA so the laptop dev workflow uses one port (5000)
// and frontend/api.js can hit "/api" relatively.
{
  const fp = path.join(__dirname, '../frontend');
  app.use(express.static(fp, {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    extensions: ['html'],
  }));
  // SPA fallback — skip /api and /health so API 404s stay JSON
  app.get(/^(?!\/api|\/health).*$/, (_req, res) =>
    res.sendFile(path.join(fp, 'index.html'))
  );
}

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use('/api/*', (req, res) =>
  res.status(404).json({ success: false, message: `Not found: ${req.method} ${req.originalUrl}` })
);

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  if (err.name === 'ValidationError')
    return res.status(400).json({ success: false, message: Object.values(err.errors).map(e => e.message).join(', ') });
  if (err.code === 11000)
    return res.status(400).json({ success: false, message: `${Object.keys(err.keyValue || {})[0] || 'Field'} already exists` });
  if (err.name === 'JsonWebTokenError')
    return res.status(401).json({ success: false, message: 'Invalid token' });
  if (err.name === 'TokenExpiredError')
    return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  if (err.name === 'CastError')
    return res.status(400).json({ success: false, message: 'Invalid ID format' });
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 5000;

(async () => {
  await connectDB();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ API → http://localhost:${PORT}`);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`🌐 API → http://localhost:${PORT}`);
    }
  });

  const stop = sig =>
    server.close(() => {
      console.log(`\n${sig} — stopped`);
      process.exit(0);
    });

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
})();

} // end else (cluster worker)
