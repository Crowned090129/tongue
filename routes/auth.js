const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");

const router = express.Router();
const JWT_SECRET = () => process.env.JWT_SECRET || "dev-secret-change-in-production";

// ── Brute-force rate limiters (DB-backed — survive restarts, shared across machines) ──
// Login: 10 attempts per 15 minutes per IP
// Signup: 5 accounts per hour per IP

async function checkLoginRateLimit(ip) {
  const { allowed } = await db.checkIpRateLimit(
    `login_ip:${ip}`, 10, 15 * 60 * 1000
  );
  return allowed;
}

async function checkSignupRateLimit(ip) {
  const { allowed } = await db.checkIpRateLimit(
    `signup_ip:${ip}`, 5, 60 * 60 * 1000
  );
  return allowed;
}

// ── POST /api/auth/login — validate access code (paid subscribers) ─────────────
router.post("/login", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  if (!await checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: "Too many login attempts. Please wait 15 minutes and try again." });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Access code is required." });
  }

  const normalized = code.trim().toUpperCase();

  const row = await db.get(`
    SELECT ac.id AS "codeId", ac.expires_at, ac.is_active,
           u.id AS "userId", u.email, u.plan, u.status
    FROM access_codes ac
    JOIN users u ON u.id = ac.user_id
    WHERE ac.code = $1
  `, [normalized]);

  if (!row) {
    return res.status(401).json({ error: "Invalid access code. Check your email for the correct code." });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: "This access code is no longer active. Check your email for a renewed code." });
  }
  if (new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: "This access code has expired. Check your email for a renewed code." });
  }
  if (row.status !== "active") {
    return res.status(401).json({ error: "Your subscription is not active. Please renew at /subscribe." });
  }

  // Rotate nonce with 2-slot system — supports up to 2 concurrent devices.
  const existing = await db.get("SELECT session_nonce FROM access_codes WHERE id = $1", [row.codeId]);
  const nonce = crypto.randomBytes(16).toString("hex");
  await db.run(
    "UPDATE access_codes SET session_nonce = $1, session_nonce_2 = $2 WHERE id = $3",
    [nonce, existing?.session_nonce || null, row.codeId]
  );

  const expiresAt = new Date(row.expires_at).toISOString();
  const token = jwt.sign(
    { userId: row.userId, codeId: row.codeId, email: row.email, plan: row.plan, nonce },
    JWT_SECRET(),
    { expiresIn: "30d" }
  );

  res.json({ token, expiresAt, email: row.email, plan: row.plan });
});

// ── POST /api/auth/signup — create free account (no payment required) ─────────
router.post("/signup", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  // Skip IP rate limiting in test mode (tests share 127.0.0.1 and exhaust the limit quickly)
  if (process.env.NODE_ENV !== "test" && !await checkSignupRateLimit(ip)) {
    return res.status(429).json({ error: "Too many signups from this address. Please try again later." });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== "string" || !email.includes("@") || email.length > 254) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const normalized = email.trim().toLowerCase();

  // Don't overwrite an existing paid account
  const existing = await db.get("SELECT id, plan, status FROM users WHERE email = $1", [normalized]);
  if (existing && existing.status === "active" && existing.plan !== "free") {
    return res.status(409).json({
      error: "This email already has an active subscription. Use your access code to log in.",
      hasPaid: true,
    });
  }

  // Upsert free user
  await db.run(`
    INSERT INTO users (email, plan, status)
    VALUES ($1, 'free', 'active')
    ON CONFLICT(email) DO UPDATE
      SET plan   = CASE WHEN users.plan <> 'free' THEN users.plan ELSE 'free' END,
          status = 'active'
  `, [normalized]);

  const user = await db.get("SELECT id, plan FROM users WHERE email = $1", [normalized]);

  const token = jwt.sign(
    { userId: user.id, email: normalized, plan: "free" },
    JWT_SECRET(),
    { expiresIn: "90d" }
  );

  // Optional: send a welcome email (fire-and-forget)
  try {
    const { sendEmail } = require("../utils/email");
    const APP_URL = process.env.APP_URL || "http://localhost:3000";
    await sendEmail(
      normalized,
      "Welcome to Tonge — you're in!",
      `<div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
        <h1 style="color:#2563eb;font-size:22px;margin-bottom:8px">🌐 Welcome to Tonge!</h1>
        <p style="color:#334155;font-size:14px;line-height:1.7;margin-bottom:16px">
          Your free account is ready. You can access all 11 language reference guides and
          try the AI Coach with <strong>5 free messages per day</strong>.
        </p>
        <p style="color:#64748b;font-size:13px;margin-bottom:20px">
          When you're ready to go unlimited, upgrade to Tonge Premium — $9/month or $79/year.
        </p>
        <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">
          Start learning →
        </a>
      </div>`
    );
  } catch (_) { /* non-fatal */ }

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  res.json({ token, email: normalized, plan: "free", expiresAt });
});

// ── POST /api/auth/resend-code — email the current active code ────────────────
const resendAttempts = new Map();
router.post("/resend-code", async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== "string" || !email.includes("@") || email.length > 254) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const normalized = email.trim().toLowerCase();

  const now = Date.now();
  const entry = resendAttempts.get(normalized) || { count: 0, reset: now + 3_600_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 3_600_000; }
  entry.count++;
  resendAttempts.set(normalized, entry);
  if (entry.count > 3) {
    return res.status(429).json({ error: "Too many attempts. Please wait an hour and try again." });
  }

  const row = await db.get(`
    SELECT ac.code, u.plan, u.status
    FROM access_codes ac
    JOIN users u ON u.id = ac.user_id
    WHERE u.email = $1 AND ac.is_active = 1 AND ac.expires_at > NOW()
    ORDER BY ac.created_at DESC LIMIT 1
  `, [normalized]);

  if (!row || row.status !== "active") {
    return res.json({ sent: true }); // prevent email enumeration
  }

  const { sendEmail } = require("../utils/email");
  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  await sendEmail(
    normalized,
    "Your Tonge Access Code",
    `<div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h1 style="color:#2563eb;font-size:20px;margin-bottom:4px">🌐 Your access code</h1>
      <p style="color:#334155;font-size:14px;margin-bottom:20px">You requested your access code. Here it is:</p>
      <div style="background:#f1f5f9;border:2px solid #2563eb;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Access Code</div>
        <div style="font-size:28px;font-weight:900;color:#2563eb;letter-spacing:4px">${row.code}</div>
      </div>
      <p style="color:#64748b;font-size:13px">
        Go to <a href="${APP_URL}" style="color:#2563eb">${APP_URL}</a> and enter this code to access the app.
        If you didn't request this, you can ignore it.
      </p>
    </div>`
  );

  res.json({ sent: true });
});

// ── GET /api/auth/validate — check token validity on app startup ──────────────
// Always returns the CURRENT plan from DB — fixes stale JWT plan after upgrade.
router.get("/validate", requireAuth, async (req, res) => {
  const { userId, codeId, nonce, plan } = req.user;

  // Always fetch current user state from DB (source of truth)
  const user = await db.get(
    "SELECT status, email, plan, onboarding_completed, user_level, user_goal, daily_commitment FROM users WHERE id = $1",
    [userId]
  );
  if (!user || user.status === "deleted") {
    return res.status(401).json({ error: "Account not found." });
  }

  // Free users: no code validation needed
  if (plan === "free" && user.plan === "free") {
    if (user.status !== "active") return res.status(401).json({ error: "Account inactive." });
    return res.json({
      valid: true,
      email: user.email,
      plan: "free",
      onboardingCompleted: user.onboarding_completed,
      userLevel: user.user_level,
      userGoal: user.user_goal,
      dailyCommitment: user.daily_commitment,
    });
  }

  // Free user who upgraded — their JWT says 'free' but DB says paid
  if (plan === "free" && user.plan !== "free") {
    // Their new JWT will be issued when they next use their access code.
    // For now, just confirm the account is active with the new plan.
    return res.json({ valid: true, email: user.email, plan: user.plan, needsRelogin: true });
  }

  // Paid users: validate code + nonce
  const row = await db.get(`
    SELECT ac.is_active, ac.expires_at, ac.session_nonce, ac.session_nonce_2
    FROM access_codes ac
    WHERE ac.id = $1 AND ac.user_id = $2
  `, [codeId, userId]);

  if (!row || !row.is_active || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
  if (row.session_nonce !== nonce && row.session_nonce_2 !== nonce) {
    return res.status(401).json({
      error: "Your subscription has renewed. Check your email for your new access code.",
      reason: "renewed",
    });
  }

  res.json({
    valid: true,
    email: user.email,
    plan: user.plan, // always from DB, not JWT
    expiresAt: row.expires_at,
    onboardingCompleted: user.onboarding_completed,
    userLevel: user.user_level,
    userGoal: user.user_goal,
    dailyCommitment: user.daily_commitment,
  });
});

// ── POST /api/auth/onboarding — save onboarding preferences ──────────────────
router.post("/onboarding", requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { level, goal, dailyCommitment, language } = req.body || {};

  const VALID_LEVELS = ["beginner-zero", "beginner", "intermediate", "advanced"];
  const VALID_GOALS  = ["travel", "work", "school", "conversation", "family", "business", "personal"];
  const VALID_MINS   = [5, 15, 30, 60];

  if (level && !VALID_LEVELS.includes(level)) return res.status(400).json({ error: "Invalid level." });
  if (goal  && !VALID_GOALS.includes(goal))   return res.status(400).json({ error: "Invalid goal." });
  if (dailyCommitment && !VALID_MINS.includes(Number(dailyCommitment))) return res.status(400).json({ error: "Invalid daily commitment." });

  await db.run(`
    UPDATE users
    SET user_level = COALESCE($1, user_level),
        user_goal  = COALESCE($2, user_goal),
        daily_commitment = COALESCE($3, daily_commitment),
        onboarding_completed = TRUE
    WHERE id = $4
  `, [level || null, goal || null, dailyCommitment ? Number(dailyCommitment) : null, userId]);

  // Track analytics
  db.trackEvent(userId, "onboarding_completed", { level, goal, dailyCommitment, language });

  res.json({ saved: true });
});

// ── DELETE /api/auth/account ──────────────────────────────────────────────────
router.delete("/account", requireAuth, async (req, res) => {
  const { userId } = req.user;

  const user = await db.get("SELECT id, email, stripe_customer_id FROM users WHERE id = $1", [userId]);
  if (!user) return res.status(404).json({ error: "Account not found." });

  if (user.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
      const subs = await stripe.subscriptions.list({ customer: user.stripe_customer_id, status: "active", limit: 5 });
      for (const sub of subs.data) await stripe.subscriptions.cancel(sub.id);
    } catch (e) {
      console.error("Account deletion: Stripe cancellation failed:", e.message);
    }
  }

  await db.run("DELETE FROM access_codes WHERE user_id = $1", [userId]);
  await db.run("UPDATE subscriptions SET status = 'deleted', updated_at = NOW() WHERE user_id = $1", [userId]);
  await db.run(
    "UPDATE users SET email = $1, stripe_customer_id = NULL, status = 'deleted' WHERE id = $2",
    [`deleted_${userId}_${Date.now()}@deleted.invalid`, userId]
  );

  console.log(`[Auth] Account deleted: userId=${userId}`);
  res.json({ deleted: true });
});

// ── Middleware ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    req.user = jwt.verify(token, JWT_SECRET());
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

async function requirePaid(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required." });
  // Always query DB — do NOT trust JWT plan. Cancelled subscriptions must be blocked
  // even while a valid JWT is still in circulation (up to 30 days).
  const hasPaid = await db.hasActivePaidAccess(req.user.userId);
  if (!hasPaid) {
    return res.status(402).json({
      error: "This feature requires a Tonge Premium subscription.",
      upgrade: true,
    });
  }
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requirePaid = requirePaid;
