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

// In tests the only database the app may open is TEST_DATABASE_URL, and only a
// local *_test database. DATABASE_URL (production, in .env) is never read then.
const connStr = process.env.NODE_ENV === "test"
  ? require("./tests/support/assertTestDatabase").assertTestDatabase()
  : (process.env.DATABASE_URL || "postgresql://localhost/tongue_dev");
const isLocal = connStr.includes("localhost") || connStr.includes("127.0.0.1");
const pool = new Pool({
  connectionString: connStr,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  family: 4, // force IPv4 — Railway containers can't reach Supabase via IPv6
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

    -- User-reported content errors (grammar/vocab accuracy feedback loop)
    CREATE TABLE IF NOT EXISTS content_reports (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      lang       TEXT NOT NULL,
      tab        TEXT NOT NULL,
      note       TEXT,
      resolved   BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Passwordless "magic link" login tokens. Only the SHA-256 hash is stored,
    -- so a DB leak can't be used to log in. Single-use, short-lived.
    CREATE TABLE IF NOT EXISTS magic_links (
      id         SERIAL PRIMARY KEY,
      email      TEXT        NOT NULL,
      token_hash TEXT        NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Scheduled-job claims (additive, added in P0). Every web machine runs the
    -- cron schedule; the first to insert (job, slot) runs it, the rest skip.
    CREATE TABLE IF NOT EXISTS job_runs (
      job        TEXT NOT NULL,
      slot       TEXT NOT NULL,
      claimed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (job, slot)
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
    "ALTER TABLE users           ADD COLUMN IF NOT EXISTS target_lang          TEXT",
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
    "CREATE INDEX IF NOT EXISTS idx_magic_links_hash     ON magic_links(token_hash)",
    "CREATE INDEX IF NOT EXISTS idx_magic_links_expires  ON magic_links(expires_at)",
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
 * DB-backed rate limiter — survives restarts, shared across all machines.
 *
 * One atomic statement, so concurrent requests can never exceed maxAttempts,
 * and a denied attempt does not consume anything.
 *
 * key         — unique string, e.g. "login_ip:1.2.3.4" or "123" (AI daily quota)
 * maxAttempts — max allowed within the window
 * windowMs    — window duration in milliseconds
 *
 * Returns { allowed, remaining, resetAt } (resetAt = epoch ms when the window ends)
 */
async function hitRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const row = await get(`
    INSERT INTO rate_limits (user_id, count, window_reset)
    VALUES ($1, 1, $2::bigint + $3::bigint)
    ON CONFLICT (user_id) DO UPDATE SET
      count        = CASE WHEN rate_limits.window_reset < $2::bigint THEN 1 ELSE rate_limits.count + 1 END,
      window_reset = CASE WHEN rate_limits.window_reset < $2::bigint THEN $2::bigint + $3::bigint ELSE rate_limits.window_reset END
    WHERE rate_limits.window_reset < $2::bigint OR rate_limits.count < $4::integer
    RETURNING count, window_reset
  `, [key, now, windowMs, maxAttempts]);

  if (!row) {
    const current = await get("SELECT window_reset FROM rate_limits WHERE user_id = $1", [key]);
    return { allowed: false, remaining: 0, resetAt: current ? Number(current.window_reset) : now + windowMs };
  }
  return { allowed: true, remaining: Math.max(0, maxAttempts - row.count), resetAt: Number(row.window_reset) };
}

/**
 * Give back one unit taken by hitRateLimit (e.g. an AI call that failed upstream).
 * Pass the resetAt that hitRateLimit returned so a refund never lands in a newer window.
 */
async function refundRateLimit(key, resetAt) {
  await run(
    "UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE user_id = $1 AND window_reset = $2::bigint",
    [key, resetAt]
  );
}

// Kept for existing callers (auth, admin): same contract as before, now atomic.
async function checkIpRateLimit(key, maxAttempts, windowMs) {
  const { allowed, remaining } = await hitRateLimit(key, maxAttempts, windowMs);
  return { allowed, remaining };
}

/**
 * Run fn(tx) in one transaction on a dedicated connection. `tx` has the same
 * get/all/run helpers as this module. Commits when fn resolves; rolls back and
 * rethrows when it rejects.
 */
async function transaction(fn) {
  const client = await pool.connect();
  const tx = {
    get: async (text, params = []) => (await client.query(text, params)).rows[0] ?? null,
    all: async (text, params = []) => (await client.query(text, params)).rows,
    run: async (text, params = []) => {
      const res = await client.query(text, params);
      return { changes: res.rowCount, lastID: res.rows[0]?.id ?? null };
    },
  };
  let brokenConnection = false;
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      brokenConnection = true;
      console.error("[DB] Rollback failed:", rollbackErr.message);
    }
    throw err;
  } finally {
    client.release(brokenConnection);
  }
}

/**
 * Claim one run of a scheduled job for a time slot (e.g. "2026-09-14" or
 * "2026-09-14T06"). Returns true for exactly one caller across all machines.
 */
async function claimJobRun(job, slot) {
  const row = await get(
    "INSERT INTO job_runs (job, slot) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING job",
    [job, slot]
  );
  return row !== null;
}

module.exports = {
  pool, get, all, run, initialize, transaction,
  hasActivePaidAccess, trackEvent,
  hitRateLimit, refundRateLimit, checkIpRateLimit, claimJobRun,
};
