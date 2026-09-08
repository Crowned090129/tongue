const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();
const JWT_SECRET = () => process.env.JWT_SECRET || "dev-secret-change-in-production";

// Google Sign-In. Dormant until GOOGLE_CLIENT_ID is set (the frontend hides the
// button too). The client is created lazily so a missing env var never crashes boot.
const GOOGLE_CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || "";
let _googleClient = null;
function googleClient() {
  if (!_googleClient) _googleClient = new OAuth2Client(GOOGLE_CLIENT_ID());
  return _googleClient;
}

// Log a (verified) email in at its REAL tier — paid if the account holds a live
// access code (with the same 2-slot nonce rotation as /login), otherwise free
// (same upsert as /signup). Never downgrades an existing account. Shared by every
// verified-identity path (Google, magic link). Returns a session or null.
async function issueSessionForEmail(email) {
  await db.run(`
    INSERT INTO users (email, plan, status)
    VALUES ($1, 'free', 'active')
    ON CONFLICT(email) DO UPDATE SET status = 'active'
  `, [email]);

  const user = await db.get(
    "SELECT id, email, plan, status FROM users WHERE email = $1", [email]
  );
  if (!user || user.status === "deleted") return null;

  if (user.plan && user.plan !== "free") {
    const codeRow = await db.get(`
      SELECT id, expires_at, session_nonce
      FROM access_codes
      WHERE user_id = $1 AND is_active = 1 AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `, [user.id]);
    if (codeRow) {
      const nonce = crypto.randomBytes(16).toString("hex");
      await db.run(
        "UPDATE access_codes SET session_nonce = $1, session_nonce_2 = $2 WHERE id = $3",
        [nonce, codeRow.session_nonce || null, codeRow.id]
      );
      const expiresAt = new Date(codeRow.expires_at).toISOString();
      const token = jwt.sign(
        { userId: user.id, codeId: codeRow.id, email: user.email, plan: user.plan, nonce },
        JWT_SECRET(), { expiresIn: "30d" }
      );
      return { token, expiresAt, email: user.email, plan: user.plan, userId: user.id };
    }
    // Paid on record but no live code (lapsed) → fall through to a free session.
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, plan: "free" },
    JWT_SECRET(), { expiresIn: "90d" }
  );
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  return { token, expiresAt, email: user.email, plan: "free", userId: user.id };
}

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
      "Welcome to Tongue — you're in!",
      `<div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
        <div style="background:linear-gradient(135deg,#C0153E,#FF5F7E);padding:24px 28px;text-align:center">
          <div style="font-size:36px;margin-bottom:4px">👅</div>
          <div style="color:#fff;font-size:20px;font-weight:900">TONGUE</div>
          <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:2px">Speak Every Tongue</div>
        </div>
        <div style="padding:28px">
          <h1 style="color:#0f172a;font-size:20px;margin:0 0 10px">Welcome! Your free account is ready.</h1>
          <p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 16px">
            You can explore all 11 language reference guides and try the Coach with <strong>5 free messages per day</strong>.
          </p>
          <p style="color:#64748b;font-size:13px;margin:0 0 22px">
            Ready to go unlimited? Upgrade to Tongue Premium — $9/month or $79/year.
          </p>
          <a href="${APP_URL}/app" style="display:inline-block;padding:13px 28px;background:#C0153E;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
            Start learning →
          </a>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0">
          <p style="color:#94a3b8;font-size:11px;text-align:center">© Tongue · <a href="${APP_URL}" style="color:#C0153E;text-decoration:none">${APP_URL}</a></p>
        </div>
      </div>`
    );
  } catch (_) { /* non-fatal */ }

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  res.json({ token, email: normalized, plan: "free", expiresAt });
});

// ── POST /api/auth/google — sign in / sign up with a Google account ───────────
// Frontend (Google Identity Services) sends the ID token as `credential`.
// We verify it with Google, then log the user in at their REAL tier: paid if
// they hold an active access code, otherwise free — mirroring /login + /signup.
router.post("/google", async (req, res) => {
  if (!GOOGLE_CLIENT_ID()) {
    return res.status(503).json({ error: "Google sign-in is not enabled." });
  }

  const ip = req.ip || req.connection.remoteAddress || "unknown";
  if (process.env.NODE_ENV !== "test" && !await checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
  }

  const { credential } = req.body || {};
  if (!credential || typeof credential !== "string") {
    return res.status(400).json({ error: "Missing Google credential." });
  }

  // Verify the token's signature, audience, and expiry with Google.
  let payload;
  try {
    const ticket = await googleClient().verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID(),
    });
    payload = ticket.getPayload();
  } catch (e) {
    console.error("[Auth] Google token verification failed:", e.message);
    return res.status(401).json({ error: "Could not verify your Google account. Please try again." });
  }

  if (!payload || !payload.email || !payload.email_verified) {
    return res.status(401).json({ error: "Your Google account has no verified email." });
  }

  const email = payload.email.trim().toLowerCase();
  if (email.length > 254) return res.status(400).json({ error: "Invalid email address." });

  const sess = await issueSessionForEmail(email);
  if (!sess) return res.status(401).json({ error: "Account not found." });
  db.trackEvent(sess.userId, "login_google", { plan: sess.plan });
  res.json({ token: sess.token, expiresAt: sess.expiresAt, email: sess.email, plan: sess.plan });
});

// ── Magic-link (passwordless email) login ─────────────────────────────────────
const MAGIC_TTL_MS = 15 * 60 * 1000; // link valid 15 minutes
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// POST /api/auth/magic-link/request — email the user a one-tap login link.
// Always returns { sent:true } (never reveals whether the email exists).
router.post("/magic-link/request", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  if (process.env.NODE_ENV !== "test") {
    const { allowed } = await db.checkIpRateLimit(`magic_ip:${ip}`, 8, 60 * 60 * 1000);
    if (!allowed) return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== "string" || !email.includes("@") || email.length > 254) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  const normalized = email.trim().toLowerCase();

  // Per-email throttle (independent of IP) — 4 links per hour.
  if (process.env.NODE_ENV !== "test") {
    const { allowed } = await db.checkIpRateLimit(`magic_email:${normalized}`, 4, 60 * 60 * 1000);
    if (!allowed) return res.json({ sent: true }); // silent — no enumeration
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MS).toISOString();

  await db.run(
    "INSERT INTO magic_links (email, token_hash, expires_at) VALUES ($1, $2, $3)",
    [normalized, tokenHash, expiresAt]
  );

  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  const link = `${APP_URL}/app?magic=${token}`;
  try {
    const { sendEmail } = require("../utils/email");
    await sendEmail(
      normalized,
      "Your Tongue login link",
      `<div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
        <div style="background:linear-gradient(135deg,#C0153E,#FF5F7E);padding:24px 28px;text-align:center">
          <div style="color:#fff;font-size:20px;font-weight:900">TONGUE</div>
          <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:2px">Speak Every Tongue</div>
        </div>
        <div style="padding:28px">
          <h1 style="color:#0f172a;font-size:20px;margin:0 0 8px">Log in to Tongue</h1>
          <p style="color:#334155;font-size:14px;margin:0 0 22px">Tap the button below to sign in. This link works once and expires in 15 minutes.</p>
          <a href="${link}" style="display:inline-block;padding:13px 30px;background:#C0153E;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Log in to Tongue →</a>
          <p style="color:#94a3b8;font-size:12px;margin:22px 0 0">If you didn't request this, you can safely ignore this email — no one can log in without this link.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0">
          <p style="color:#94a3b8;font-size:11px;text-align:center">© Tongue · <a href="${APP_URL}" style="color:#C0153E;text-decoration:none">${APP_URL}</a></p>
        </div>
      </div>`
    );
  } catch (e) {
    console.error("[Auth] Magic-link email failed:", e.message);
  }

  res.json({ sent: true });
});

// POST /api/auth/magic-link/verify — exchange the token for a session.
router.post("/magic-link/verify", async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing login token." });
  }
  const tokenHash = sha256(token.trim());

  // Single-use: atomically claim the token only if it's unused and unexpired.
  const row = await db.get(
    `UPDATE magic_links
        SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING email`,
    [tokenHash]
  );
  if (!row) {
    return res.status(401).json({ error: "This login link is invalid or has expired. Please request a new one." });
  }

  const sess = await issueSessionForEmail(row.email);
  if (!sess) return res.status(401).json({ error: "Account not found." });
  db.trackEvent(sess.userId, "login_magic_link", { plan: sess.plan });
  res.json({ token: sess.token, expiresAt: sess.expiresAt, email: sess.email, plan: sess.plan });
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
    "Your Tongue Access Code",
    `<div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
      <div style="background:linear-gradient(135deg,#C0153E,#FF5F7E);padding:24px 28px;text-align:center">
        <div style="font-size:36px;margin-bottom:4px">👅</div>
        <div style="color:#fff;font-size:20px;font-weight:900">TONGUE</div>
        <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:2px">Speak Every Tongue</div>
      </div>
      <div style="padding:28px">
        <h1 style="color:#0f172a;font-size:20px;margin:0 0 8px">Here is your access code</h1>
        <p style="color:#334155;font-size:14px;margin:0 0 20px">You requested your access code. Enter it on the login screen to access the app.</p>
        <div style="background:#fff0f4;border:2px solid #C0153E;border-radius:12px;padding:22px;text-align:center;margin:0 0 20px">
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Access Code</div>
          <div style="font-size:30px;font-weight:900;color:#C0153E;letter-spacing:4px">${row.code}</div>
        </div>
        <p style="color:#64748b;font-size:13px">
          Go to <a href="${APP_URL}/app" style="color:#C0153E">${APP_URL}/app</a> and click <strong>"I Have a Code"</strong> to log in.
          If you didn't request this, you can safely ignore it.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0">
        <p style="color:#94a3b8;font-size:11px;text-align:center">© Tongue · <a href="${APP_URL}" style="color:#C0153E;text-decoration:none">${APP_URL}</a></p>
      </div>
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
    "SELECT status, email, plan, onboarding_completed, user_level, user_goal, daily_commitment, target_lang FROM users WHERE id = $1",
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
      targetLang: user.target_lang,
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
    targetLang: user.target_lang,
  });
});

// ── POST /api/auth/preferences — persist target language / level mid-session ──
// Lets language switches and level changes follow the account across devices,
// not just localStorage.
router.post("/preferences", requireAuth, async (req, res) => {
  const { userId } = req.user;
  const { language, level } = req.body || {};
  const VALID_LEVELS = ["beginner-zero", "beginner", "intermediate", "advanced"];
  if (level && !VALID_LEVELS.includes(level)) return res.status(400).json({ error: "Invalid level." });
  if (language && !/^[a-z]{2}$/.test(language)) return res.status(400).json({ error: "Invalid language." });
  if (!language && !level) return res.json({ saved: false });

  await db.run(
    "UPDATE users SET target_lang = COALESCE($1, target_lang), user_level = COALESCE($2, user_level) WHERE id = $3",
    [language || null, level || null, userId]
  );
  res.json({ saved: true });
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
        target_lang = COALESCE($4, target_lang),
        onboarding_completed = TRUE
    WHERE id = $5
  `, [level || null, goal || null, dailyCommitment ? Number(dailyCommitment) : null, language || null, userId]);

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
      error: "This feature requires a Tongue Premium subscription.",
      upgrade: true,
    });
  }
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requirePaid = requirePaid;
