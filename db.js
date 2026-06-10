/**
 * db.js — PostgreSQL pool (replaces better-sqlite3 for production scale).
 *
 * Drop-in async helpers:
 *   db.get(sql, params)  → first row or null
 *   db.all(sql, params)  → array of rows
 *   db.run(sql, params)  → { changes: rowCount }
 *
 * Schema initialised on first call to db.initialize() (idempotent — safe to run
 * on every cold start).
 */

const { Pool } = require("pg");

const connStr = process.env.DATABASE_URL || "postgresql://localhost/tonge_dev";
const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.includes("localhost") || connStr.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => console.error("[DB] Unexpected pool error:", err.message));

// ── Async helpers ─────────────────────────────────────────────────────────────

async function get(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] ?? null;
}

async function all(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function run(text, params = []) {
  const res = await pool.query(text, params);
  return { changes: res.rowCount, lastID: res.rows[0]?.id ?? null };
}

// ── Schema initialisation (idempotent) ───────────────────────────────────────

async function initialize() {
  console.log("[DB] Initialising schema…");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                   SERIAL PRIMARY KEY,
      email                TEXT    UNIQUE NOT NULL,
      stripe_customer_id   TEXT    UNIQUE,
      plan                 TEXT    DEFAULT 'free',
      status               TEXT    DEFAULT 'active',
      -- onboarding fields
      user_level           TEXT,
      user_goal            TEXT,
      daily_commitment     INTEGER,
      onboarding_completed BOOLEAN DEFAULT FALSE,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS access_codes (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      code            TEXT    UNIQUE NOT NULL,
      is_active       INTEGER DEFAULT 1,
      expires_at      TIMESTAMPTZ NOT NULL,
      session_nonce   TEXT,
      session_nonce_2 TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                     SERIAL PRIMARY KEY,
      user_id                INTEGER NOT NULL UNIQUE REFERENCES users(id),
      stripe_subscription_id TEXT    UNIQUE,
      stripe_price_id        TEXT,
      plan                   TEXT,
      status                 TEXT,
      current_period_end     TIMESTAMPTZ,
      cancel_at_period_end   BOOLEAN DEFAULT FALSE,
      paid_access_until      TIMESTAMPTZ,
      created_at             TIMESTAMPTZ DEFAULT NOW(),
      updated_at             TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id         SERIAL PRIMARY KEY,
      token      TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      user_id      TEXT    PRIMARY KEY,   -- TEXT not INTEGER: supports "123" daily + "123_burst" keys
      count        INTEGER DEFAULT 0,
      window_reset BIGINT  DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS streaks (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id),
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_practice  TEXT,
      total_days     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS content_cache (
      lang         TEXT NOT NULL,
      tab          TEXT NOT NULL,
      content_json TEXT NOT NULL,
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (lang, tab)
    );

    -- AI usage logs (cost tracking + abuse detection)
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      language      TEXT,
      feature_type  TEXT,
      input_length  INTEGER,
      output_length INTEGER,
      estimated_cost NUMERIC(10,6),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Analytics events (internal, no third-party dependency)
    CREATE TABLE IF NOT EXISTS analytics_events (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER,
      event_name TEXT NOT NULL,
      metadata   JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Stripe event deduplication (idempotency)
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id     TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Push notification device tokens (iOS APNs + Android FCM)
    CREATE TABLE IF NOT EXISTS push_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT    NOT NULL,
      platform   TEXT    NOT NULL,   -- 'ios' | 'android' | 'web'
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, token)
    );
  `);

  // Safe migrations (idempotent)
  const migrations = [
    "ALTER TABLE access_codes    ADD COLUMN IF NOT EXISTS session_nonce   TEXT",
    "ALTER TABLE access_codes    ADD COLUMN IF NOT EXISTS session_nonce_2 TEXT",
    "ALTER TABLE users           ADD COLUMN IF NOT EXISTS user_level           TEXT",
    "ALTER TABLE users           ADD COLUMN IF NOT EXISTS user_goal            TEXT",
    "ALTER TABLE users           ADD COLUMN IF NOT EXISTS daily_commitment     INTEGER",
    "ALTER TABLE users           ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE subscriptions   ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE",
    "ALTER TABLE subscriptions   ADD COLUMN IF NOT EXISTS paid_access_until    TIMESTAMPTZ",
    "ALTER TABLE users           ADD COLUMN IF NOT EXISTS stripe_customer_id   TEXT",
    // rate_limits.user_id must be TEXT to support "123_burst" string keys (burst rate limiter)
    // If column is currently INTEGER, recreate the table (it's ephemeral — safe to truncate)
    `DO $$ BEGIN
       IF (SELECT data_type FROM information_schema.columns
           WHERE table_name='rate_limits' AND column_name='user_id') = 'integer' THEN
         DROP TABLE rate_limits;
         CREATE TABLE rate_limits (
           user_id      TEXT    PRIMARY KEY,
           count        INTEGER DEFAULT 0,
           window_reset BIGINT  DEFAULT 0
         );
       END IF;
     END $$`,
  ];
  for (const m of migrations) {
    await pool.query(m).catch(() => {}); // ignore "column already exists"
  }

  // Indexes for performance
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email)",
    "CREATE INDEX IF NOT EXISTS idx_users_stripe_cust    ON users(stripe_customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_codes_user           ON access_codes(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_codes_active         ON access_codes(is_active, expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_subs_user            ON subscriptions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_subs_stripe_id       ON subscriptions(stripe_subscription_id)",
    "CREATE INDEX IF NOT EXISTS idx_rate_limits_user     ON rate_limits(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date   ON ai_usage_logs(user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_user       ON analytics_events(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_event      ON analytics_events(event_name, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_push_tokens_user     ON push_tokens(user_id)",
  ];
  for (const idx of indexes) {
    await pool.query(idx).catch(() => {});
  }

  console.log("[DB] Schema ready ✓");
}

// ── Business logic helpers ─────────────────────────────────────────────────────

/**
 * Returns true only if the user has an active paid subscription.
 * Checks DB subscription record — the source of truth, not just the JWT plan.
 */
async function hasActivePaidAccess(userId) {
  if (!userId) return false;
  const user = await get("SELECT plan, status FROM users WHERE id = $1", [userId]);
  if (!user) return false;
  if (user.plan === "free" || user.status !== "active") return false;

  // Path 1: active access code (admin-issued or resent codes)
  const code = await get(
    "SELECT id FROM access_codes WHERE user_id = $1 AND is_active = 1 AND expires_at > NOW()",
    [userId]
  );
  if (code) return true;

  // Path 2: Stripe subscription record
  const sub = await get(
    "SELECT status, paid_access_until, current_period_end FROM subscriptions WHERE user_id = $1",
    [userId]
  );
  if (!sub) return false;
  if (sub.status === "active" || sub.status === "trialing") return true;
  // Grace period: paid_access_until covers the current billing period
  if (sub.paid_access_until && new Date(sub.paid_access_until) > new Date()) return true;
  return false;
}

/**
 * Log an analytics event (fire-and-forget, never throws).
 */
async function trackEvent(userId, eventName, metadata = {}) {
  run(
    "INSERT INTO analytics_events (user_id, event_name, metadata) VALUES ($1, $2, $3)",
    [userId || null, eventName, JSON.stringify(metadata)]
  ).catch(() => {});
}

/**
 * DB-backed IP rate limiter — survives restarts, shared across all machines.
 *
 * key        — unique string, e.g. "login_ip:1.2.3.4"
 * maxAttempts — max allowed within the window
 * windowMs   — window duration in milliseconds
 *
 * Returns { allowed: boolean, remaining: number }
 */
async function checkIpRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const row = await get(
    "SELECT count, window_reset FROM rate_limits WHERE user_id = $1",
    [key]
  );

  if (!row || now > parseInt(row.window_reset)) {
    // New window — reset counter to 1
    await run(`
      INSERT INTO rate_limits (user_id, count, window_reset)
      VALUES ($1, 1, $2)
      ON CONFLICT(user_id) DO UPDATE SET count = 1, window_reset = $2
    `, [key, now + windowMs]);
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (row.count >= maxAttempts) {
    return { allowed: false, remaining: 0 };
  }

  await run(
    "UPDATE rate_limits SET count = count + 1 WHERE user_id = $1",
    [key]
  );
  return { allowed: true, remaining: maxAttempts - row.count - 1 };
}

module.exports = { pool, get, all, run, initialize, hasActivePaidAccess, trackEvent, checkIpRateLimit };
