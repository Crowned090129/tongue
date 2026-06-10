/**
 * server.js — entry point.
 *
 * Validates env vars, initialises the DB schema, starts the HTTP server,
 * schedules maintenance cron, and kicks off background content generation.
 *
 * The Express app itself lives in app.js so tests can import it without
 * triggering any of the side-effects here.
 */

require("dotenv").config();
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

// ── Cron: streak reminder push notifications — 8 PM UTC daily ────────────────
cron.schedule("0 20 * * *", async () => {
  try {
    const { sendStreakReminders } = require("./utils/push");
    await sendStreakReminders(db);
  } catch (e) {
    console.error("[Cron] Streak reminder error:", e.message);
  }
});

// ── Cron: clean up expired sessions + stale rate-limit rows — 3 AM UTC daily ─
cron.schedule("0 3 * * *", async () => {
  try {
    const del1 = await db.run("DELETE FROM admin_sessions WHERE expires_at < NOW()");
    const del2 = await db.run(
      "DELETE FROM rate_limits WHERE window_reset < $1",
      [Date.now() - 600_000]
    );
    if (del1.changes) console.log(`[Cron] Cleaned ${del1.changes} expired admin sessions`);
    if (del2.changes) console.log(`[Cron] Cleaned ${del2.changes} stale rate limit rows`);
  } catch (e) {
    console.error("[Cron] Cleanup error:", e.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  await db.initialize();

  app.listen(PORT, () => {
    console.log(`\nTonge server running on port ${PORT}`);
    console.log(`  App:       http://localhost:${PORT}`);
    console.log(`  Admin:     http://localhost:${PORT}/admin`);
    console.log(`  Subscribe: http://localhost:${PORT}/subscribe`);
    console.log(`  FAQ:       http://localhost:${PORT}/faq`);
    console.log(`  Health:    http://localhost:${PORT}/health\n`);

    // Background: generate any missing reference content (non-blocking).
    // Skipped in test mode.
    if (process.env.NODE_ENV !== "test") {
      setTimeout(() => {
        const { generateMissingContent } = require("./routes/content");
        generateMissingContent().catch(e =>
          console.error("[Content] Startup generation error:", e.message)
        );
      }, 3000);
    }
  });
}

start().catch(err => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
