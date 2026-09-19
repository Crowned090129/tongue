const express = require("express");
const { requireAuth } = require("./auth");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Learner-side product events. Without these, a mission can be used by a hundred
// testers and nobody learns whether it worked, where they gave up, or which
// steps confused them.
//
// The browser is not trusted to name its own events: an open endpoint would let
// any signed-in client write arbitrary rows into analytics_events, which is both
// a storage-growth problem and a way to poison the only measurement there is.
// Only the names below are accepted, and only the fields listed for each.
const EVENTS = {
  mission_started:      ["missionId", "lang"],
  mission_step_checked: ["missionId", "lang", "stepId", "verdict", "attempt"],
  mission_step_skipped: ["missionId", "lang", "stepId"],
  mission_completed:    ["missionId", "lang", "cleared", "total"],
  mission_cards_saved:  ["missionId", "lang", "added"],
  mission_abandoned:    ["missionId", "lang", "stepId"],
  // A crash in the browser is otherwise invisible: the learner sees a blank
  // screen and nobody else ever hears about it. Deliberately carries no user
  // content — a message, where it happened, and which build it was.
  client_error:         ["message", "source", "line", "build", "view"],
};

// Deliberately excludes anything the learner typed. Their answers can contain
// anything at all, and we have no reason to store them to measure a funnel.
const VERDICTS = new Set(["ok", "close", "unchecked"]);

function clean(name, raw) {
  const allowed = EVENTS[name];
  const out = {};
  for (const key of allowed) {
    const value = raw ? raw[key] : undefined;
    if (value === undefined || value === null) continue;
    if (key === "verdict") { if (VERDICTS.has(value)) out[key] = value; continue; }
    if (typeof value === "number") { if (Number.isFinite(value)) out[key] = Math.trunc(value); continue; }
    if (typeof value === "string") { out[key] = value.slice(0, key === "message" ? 300 : 64); continue; }
    // Anything else (objects, arrays, booleans) is not something we asked for.
  }
  return out;
}

// POST /api/events — record one product event for the signed-in learner.
// Fire-and-forget by design: analytics must never break the thing being measured.
router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const name = req.body && req.body.event;
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(EVENTS, name)) {
    return res.status(400).json({ error: "Unknown event." });
  }
  // A misbehaving or looping client must not be able to fill the table.
  const { allowed } = await db.checkIpRateLimit(`events:${userId}`, 300, 60 * 60 * 1000);
  if (!allowed) return res.status(429).json({ error: "Too many events." });

  db.trackEvent(userId, name, clean(name, req.body.props));
  res.status(202).json({ recorded: true });
}));

module.exports = router;
module.exports.__EVENTS = EVENTS;
