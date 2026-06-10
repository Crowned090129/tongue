const express = require("express");
const { requireAuth, requirePaid } = require("./auth");
const db = require("../db");

const router = express.Router();

// POST /api/streaks/log — record a practice session (idempotent per day)
router.post("/log", requireAuth, requirePaid, async (req, res) => {
  const { userId } = req.user;
  const today = new Date().toISOString().slice(0, 10);

  const row = await db.get("SELECT * FROM streaks WHERE user_id = $1", [userId]);

  if (!row) {
    await db.run(`
      INSERT INTO streaks (user_id, current_streak, longest_streak, last_practice, total_days)
      VALUES ($1, 1, 1, $2, 1)
    `, [userId, today]);
    return res.json({ current_streak: 1, longest_streak: 1, total_days: 1, is_new_day: true });
  }

  if (row.last_practice === today) {
    return res.json({
      current_streak: row.current_streak,
      longest_streak: row.longest_streak,
      total_days:     row.total_days,
      is_new_day:     false,
    });
  }

  const yesterday  = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const newStreak  = row.last_practice === yesterday ? row.current_streak + 1 : 1;
  const newLongest = Math.max(newStreak, row.longest_streak);
  const newTotal   = row.total_days + 1;

  await db.run(`
    UPDATE streaks
    SET current_streak = $1, longest_streak = $2, last_practice = $3, total_days = $4
    WHERE user_id = $5
  `, [newStreak, newLongest, today, newTotal, userId]);

  res.json({ current_streak: newStreak, longest_streak: newLongest, total_days: newTotal, is_new_day: true });
});

// GET /api/streaks — fetch current streak data
router.get("/", requireAuth, requirePaid, async (req, res) => {
  const { userId } = req.user;
  const row = await db.get("SELECT * FROM streaks WHERE user_id = $1", [userId]);

  if (!row) {
    return res.json({ current_streak: 0, longest_streak: 0, total_days: 0 });
  }

  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const active    = row.last_practice === today || row.last_practice === yesterday;

  res.json({
    current_streak: active ? row.current_streak : 0,
    longest_streak: row.longest_streak,
    total_days:     row.total_days,
    last_practice:  row.last_practice,
  });
});

module.exports = router;
