const express = require("express");
const { requireAuth } = require("./auth");
const db = require("../db");

const router = express.Router();

// ── Language-aware system prompts ─────────────────────────────────────────────
const LANG_NAMES_COACH = {
  fr:"French", es:"Spanish", pt:"Portuguese", it:"Italian", de:"German",
  en:"English", zh:"Chinese (Mandarin)", ja:"Japanese", ko:"Korean",
  ru:"Russian", ar:"Arabic", hi:"Hindi",
};
const LANG_NOTES = {
  zh: "Always use Chinese characters (Hanzi) in examples — never pinyin-only. Tones are critical.",
  ja: "Always use Japanese script (hiragana/katakana/kanji) in examples. Include furigana or romaji only as secondary aids.",
  ko: "Always use Hangul in examples. Include romanization only as a secondary aid.",
  ru: "Always use Cyrillic script in examples. Note grammatical cases where relevant.",
  ar: "Always use Arabic script in examples (right-to-left). Specify if Modern Standard Arabic (MSA) or a dialect.",
  hi: "Always use Devanagari script in examples — never romanized-only Hindi. Note gender agreement for verbs and adjectives.",
};

function buildSystemPrompt(lang) {
  const name = LANG_NAMES_COACH[lang] || lang;
  const note = LANG_NOTES[lang] ? `\n\nScript rule: ${LANG_NOTES[lang]}` : "";
  return `You are an expert ${name} language coach on the Tonge app. Your job is to help adult learners acquire ${name} through targeted exercises, honest feedback, and clear explanations.

Core principles:
- Always respond with valid JSON only — never add prose, markdown, or code fences outside the JSON
- Be accurate: every ${name} sentence you produce must be grammatically correct
- Be encouraging: praise what the student did right before correcting errors
- Be specific: cite the exact rule behind every correction
- Be concise: learners need actionable feedback, not lectures${note}

You may ONLY discuss topics related to language learning, ${name} grammar, vocabulary, pronunciation, culture, or travel. Politely redirect any off-topic requests back to language practice.`;
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Free  : 5 requests per 24 hours (hard limit, backed by DB)
// Paid  : 300 requests per 24 hours (safety cap) + 30 per 60 seconds (burst)

async function checkRateLimit(userId, plan) {
  const now = Date.now();
  const isFree = plan === "free";

  // Per-minute burst limit for paid users (30/min)
  if (!isFree) {
    const minKey = `${userId}_min`;
    const minRow = await db.get("SELECT count, window_reset FROM rate_limits WHERE user_id = $1", [`${userId}_burst`]);
    if (!minRow || now > parseInt(minRow.window_reset)) {
      await db.run(`
        INSERT INTO rate_limits (user_id, count, window_reset)
        VALUES ($1, 1, $2)
        ON CONFLICT(user_id) DO UPDATE SET count = 1, window_reset = $2
      `, [`${userId}_burst`, now + 60_000]);
    } else if (minRow.count >= 30) {
      return { allowed: false, reason: "burst", remaining: 0 };
    } else {
      await db.run("UPDATE rate_limits SET count = count + 1 WHERE user_id = $1", [`${userId}_burst`]);
    }
  }

  // Daily limit
  const win  = 86_400_000; // 24h
  const max  = isFree ? 5 : 300;
  const key  = String(userId);

  const row = await db.get("SELECT count, window_reset FROM rate_limits WHERE user_id = $1", [key]);

  if (!row || now > parseInt(row.window_reset)) {
    await db.run(`
      INSERT INTO rate_limits (user_id, count, window_reset)
      VALUES ($1, 1, $2)
      ON CONFLICT(user_id) DO UPDATE SET count = 1, window_reset = $2
    `, [key, now + win]);
    return { allowed: true, remaining: max - 1 };
  }

  if (row.count >= max) {
    return { allowed: false, reason: "daily", remaining: 0 };
  }

  await db.run("UPDATE rate_limits SET count = count + 1 WHERE user_id = $1", [key]);
  return { allowed: true, remaining: max - row.count - 1 };
}

// ── Input validation ──────────────────────────────────────────────────────────
function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return "prompt is required";
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return "prompt cannot be empty";
  if (trimmed.length > 6000) return "prompt is too long (max 6000 characters)";
  // Reject obvious injection attempts
  if (/ignore previous instructions|disregard all|you are now/i.test(trimmed)) {
    return "invalid prompt content";
  }
  return null;
}

// ── POST /api/claude ──────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const { userId, codeId, nonce, plan } = req.user;
  const { prompt, maxTokens, language, featureType } = req.body || {};

  // Input validation
  const validationError = validatePrompt(prompt);
  if (validationError) return res.status(400).json({ error: validationError });

  // Paid users: validate code is still active + nonce matches
  if (plan !== "free") {
    const code = await db.get(`
      SELECT is_active, expires_at, session_nonce, session_nonce_2
      FROM access_codes WHERE id = $1 AND user_id = $2
    `, [codeId, userId]);

    if (!code || !code.is_active || new Date(code.expires_at) < new Date()) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    if (code.session_nonce !== nonce && code.session_nonce_2 !== nonce) {
      return res.status(401).json({
        error: "Your subscription has renewed. Check your email for your new access code.",
        reason: "renewed",
      });
    }

    // Double-check paid access via DB (source of truth)
    const hasPaid = await db.hasActivePaidAccess(userId);
    if (!hasPaid) {
      return res.status(402).json({
        error: "Your subscription is not active. Please renew at /subscribe.",
        upgrade: true,
      });
    }
  }

  // Rate limiting
  const { allowed, remaining, reason } = await checkRateLimit(userId, plan);
  if (!allowed) {
    const isFree = plan === "free";
    const error = isFree
      ? "You've used your 5 free AI messages today. Upgrade to Tonge Premium for unlimited access."
      : reason === "burst"
        ? "Too many requests. Please slow down."
        : "You've reached the daily AI limit (300 messages). Resets at midnight.";

    db.trackEvent(userId, "free_limit_reached", { plan, reason });
    return res.status(429).json({ error, upgrade: isFree });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[Claude] ANTHROPIC_API_KEY not set");
    return res.status(500).json({ error: "AI service is not configured." });
  }

  const startTime = Date.now();
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: Math.min(maxTokens || 1000, 2000), // hard cap at 2000
        system: buildSystemPrompt(language || "fr"),
        messages: [{ role: "user", content: String(prompt).slice(0, 6000) }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`[Claude] API error ${anthropicRes.status}:`, errText.slice(0, 200));
      return res.status(502).json({ error: "AI service error. Please try again in a moment." });
    }

    const data = await anthropicRes.json();
    const inputTokens  = data.usage?.input_tokens  || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    // Cost estimate: claude-sonnet-4-5 ~$3/MTok in, $15/MTok out
    const costEstimate = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

    // Log usage (async, non-blocking)
    db.run(`
      INSERT INTO ai_usage_logs (user_id, language, feature_type, input_length, output_length, estimated_cost)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, language || null, featureType || null, inputTokens, outputTokens, costEstimate]).catch(() => {});

    const raw = (data.content?.[0]?.text || "{}").replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[Claude] JSON parse failed:", raw.slice(0, 300));
      return res.status(502).json({ error: "AI returned unexpected format. Please try again." });
    }

    // Surface remaining free-tier quota
    if (plan === "free") {
      parsed._meta = { plan: "free", remaining };
    }

    db.trackEvent(userId, "ai_message_sent", { plan, language, featureType });
    res.json(parsed);

  } catch (e) {
    console.error("[Claude] Proxy error:", e.message);
    res.status(500).json({ error: "Connection error. Please try again." });
  }
});

module.exports = router;
