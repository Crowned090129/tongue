/**
 * server.js — entry point.
 *
 * Validates env vars, initialises the DB schema, starts the HTTP server,
 * schedules maintenance cron, and (only when CONTENT_AUTOGEN=on) kicks off
 * background content generation.
 *
 * The Express app itself lives in app.js so tests can import it without
 * triggering any of the side-effects here.
 */

require("dns").setDefaultResultOrder("ipv4first"); // force IPv4 — Railway can't reach Supabase via IPv6
// Never in tests: .env holds production credentials (same rule as app.js).
if (process.env.NODE_ENV !== "test") require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

// ── Process safety net ────────────────────────────────────────────────────────
// The root fix for rejected awaits is asyncHandler on every route. This handler
// catches whatever still slips through (e.g. a promise nobody awaited) and logs it
// loudly; without it Node exits on the first unhandled rejection.
process.on("unhandledRejection", (reason) => {
  console.error("[Server] UNHANDLED PROMISE REJECTION (a caller is missing await/.catch):", reason);
});

// A synchronous throw that escaped every handler leaves the process in an unknown
// state. Log it and exit with code 1 so Fly restarts a clean process.
process.on("uncaughtException", (err, origin) => {
  console.error(`[Server] UNCAUGHT EXCEPTION (${origin}) — exiting so the machine restarts clean:`, err);
  process.exit(1);
});

const cron = require("node-cron");
const db   = require("./db");
const app  = require("./app");

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET", // Without this, anyone can forge Stripe events
  "ADMIN_PASSWORD",        // Without this, admin panel is inaccessible
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[Server] Missing required environment variables: ${missing.join(", ")}`);
  if (process.env.NODE_ENV === "production") process.exit(1);
  else console.warn("[Server] Continuing in dev mode with missing env vars");
}

const PORT = process.env.PORT || 3000;

// ── Content freeze ────────────────────────────────────────────────────────────
// Regeneration rewrites content_cache rows that existing users' lesson progress
// points at (index-based lesson IDs), so it is off unless explicitly turned on.
const CONTENT_AUTOGEN = process.env.CONTENT_AUTOGEN === "on";
console.log(CONTENT_AUTOGEN
  ? "[Content] Automatic content generation is ON (CONTENT_AUTOGEN=on): missing or invalid content is regenerated at boot and every 6 hours. To freeze content, unset CONTENT_AUTOGEN (or set it to anything but \"on\") and restart."
  : "[Content] Automatic content generation is OFF: cached content is served unchanged. To turn it on, set CONTENT_AUTOGEN=on (e.g. fly secrets set CONTENT_AUTOGEN=on) and restart.");

// ── Cron ──────────────────────────────────────────────────────────────────────
// Every machine runs this schedule. A job runs only on the machine that claims
// its (job, slot) row first; the others log and skip.
async function claimSlot(job, slot) {
  if (await db.claimJobRun(job, slot)) return true;
  console.log(`[Cron] ${job} ${slot} already claimed by another machine — skipping`);
  return false;
}

const utcDateSlot = () => new Date().toISOString().slice(0, 10); // "2026-09-14"

function utcSixHourSlot() {                                        // "2026-09-14T06"
  const now = new Date();
  const bucket = String(Math.floor(now.getUTCHours() / 6) * 6).padStart(2, "0");
  return `${now.toISOString().slice(0, 10)}T${bucket}`;
}

// Streak reminder push notifications — 8 PM UTC daily
cron.schedule("0 20 * * *", async () => {
  try {
    if (!(await claimSlot("streak_reminders", utcDateSlot()))) return;
    const { sendStreakReminders } = require("./utils/push");
    await sendStreakReminders(db);
  } catch (e) {
    console.error("[Cron] Streak reminder error:", e);
  }
});

// Auto-repair missing content — every 6 hours (only when CONTENT_AUTOGEN=on)
cron.schedule("0 */6 * * *", async () => {
  if (!CONTENT_AUTOGEN) {
    console.log("[Cron] Content repair skipped: automatic content generation is off (CONTENT_AUTOGEN is not \"on\")");
    return;
  }
  try {
    if (!(await claimSlot("content_repair", utcSixHourSlot()))) return;
    const { generateMissingContent } = require("./routes/content");
    await generateMissingContent();
  } catch (e) {
    console.error("[Cron] Content repair error:", e);
  }
});

// Clean up expired sessions + stale rate-limit rows — 3 AM UTC daily
cron.schedule("0 3 * * *", async () => {
  try {
    if (!(await claimSlot("cleanup", utcDateSlot()))) return;
    const del1 = await db.run("DELETE FROM admin_sessions WHERE expires_at < NOW()");
    const del2 = await db.run(
      "DELETE FROM rate_limits WHERE window_reset < $1",
      [Date.now() - 600_000]
    );
    if (del1.changes) console.log(`[Cron] Cleaned ${del1.changes} expired admin sessions`);
    if (del2.changes) console.log(`[Cron] Cleaned ${del2.changes} stale rate limit rows`);
  } catch (e) {
    console.error("[Cron] Cleanup error:", e);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  await db.initialize();

  // Load the curated seed content into the cache (idempotent). This is what makes
  // every lesson screen show real content immediately, with no AI credits required.
  if (process.env.NODE_ENV !== "test") {
    try {
      const { seedContent } = require("./routes/content");
      await seedContent();
    } catch (e) {
      console.error("[Seed] content seeding error:", e.message);
    }
  }

  // Account recovery depends on email. Surface a broken transport in the deploy
  // log instead of discovering it when someone cannot sign back in. Probe only —
  // authenticates and disconnects, sends nothing.
  if (process.env.NODE_ENV !== "test") {
    require("./utils/email").logTransportStatus().catch(e =>
      console.error("[EMAIL] transport check failed to run:", e.message));
  }

  const server = app.listen(PORT, () => {
    console.log(`\nTongue server running on port ${PORT}`);
    console.log(`  App:       http://localhost:${PORT}`);
    console.log(`  Admin:     http://localhost:${PORT}/admin`);
    console.log(`  Subscribe: http://localhost:${PORT}/subscribe`);
    console.log(`  FAQ:       http://localhost:${PORT}/faq`);
    console.log(`  Health:    http://localhost:${PORT}/health\n`);

    // Background: generate any missing reference content. Not awaited, so it never
    // blocks serving. Only when CONTENT_AUTOGEN=on; skipped in test mode.
    if (process.env.NODE_ENV !== "test" && CONTENT_AUTOGEN) {
      const { generateMissingContent } = require("./routes/content");
      generateMissingContent().catch(e =>
        console.error("[Content] Startup generation error:", e)
      );
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  let draining = false;
  const shutdown = signal => {
    if (draining) return;
    draining = true;
    app.locals.draining = true;
    console.log(`[Server] ${signal}: draining active requests`);
    for (const task of cron.getTasks().values()) task.stop();
    const deadline = setTimeout(() => process.exit(1), 25_000);
    deadline.unref();
    server.close(async () => {
      try { await db.pool.end(); clearTimeout(deadline); process.exit(0); }
      catch (error) { console.error("[Server] Shutdown failed:",error.message); process.exit(1); }
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

start().catch(err => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
