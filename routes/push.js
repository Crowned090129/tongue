/**
 * routes/push.js
 *
 * POST /api/push/register   — save a device push token (called on app launch)
 * DELETE /api/push/token    — remove a token (called on logout)
 */

const express      = require("express");
const db           = require("../db");
const { requireAuth } = require("./auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const VALID_PLATFORMS = ["ios", "android", "web"];

// POST /api/push/register
router.post("/register", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { token, platform } = req.body || {};

  if (!token  || typeof token  !== "string" || token.length  < 10) {
    return res.status(400).json({ error: "Invalid token." });
  }
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: "platform must be ios, android, or web." });
  }

  await db.run(`
    INSERT INTO push_tokens (user_id, token, platform)
    VALUES ($1, $2, $3)
    ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform
  `, [userId, token.trim(), platform]);

  res.json({ registered: true });
}));

// DELETE /api/push/token — called on logout so we don't send reminders to signed-out devices
router.delete("/token", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { token } = req.body || {};

  if (!token) return res.status(400).json({ error: "token is required." });
  // pg would serialise an object or array into the query parameter, so only a
  // string can ever match a stored token.
  if (typeof token !== "string") return res.status(400).json({ error: "token must be a string." });

  await db.run(
    "DELETE FROM push_tokens WHERE user_id = $1 AND token = $2",
    [userId, token]
  );

  res.json({ removed: true });
}));

module.exports = router;
