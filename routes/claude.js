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

function buildSystemPrompt(lang, nativeLang) {
  const name       = LANG_NAMES_COACH[lang]       || lang;
  const nativeName = LANG_NAMES_COACH[nativeLang] || "English";
  const note = LANG_NOTES[lang] ? `\n\nScript rule: ${LANG_NOTES[lang]}` : "";
  return `You are an expert ${name} language coach on the Tongue app. Your job is to help adult learners acquire ${name} through targeted exercises, honest feedback, and clear explanations.

Core principles:
- Always respond with valid JSON only — never add prose, markdown, or code fences outside the JSON
- Be accurate: every ${name} sentence you produce must be grammatically correct
- Be encouraging: praise what the student did right before correcting errors
- Be specific: cite the exact rule behind every correction
- Be concise: learners need actionable feedback, not lectures
- INSTRUCTION LANGUAGE: Write ALL explanations, feedback, translations, grammar notes, and corrections in ${nativeName}. Use ${name} only for example sentences and exercise content itself.${note}

You may ONLY discuss topics related to language learning, ${name} grammar, vocabulary, pronunciation, culture, or travel. Politely redirect any off-topic requests back to language practice.`;
}

// ── Conversation (real multi-turn chat) ───────────────────────────────────────
// Scenarios drive a role-play persona. The `id` is the contract with the client;
// the persona/system text lives here so web + native share one source of truth.
const CONVERSATION_SCENARIOS = {
  free:       { persona:"a friendly local",              system:"Have a free, open-ended, friendly chat. Be genuinely curious about the learner — ask about their day, interests, work, plans. Keep it light and encouraging." },
  cafe:       { persona:"a café barista",                system:"You are a barista at a cozy café. The learner just walked in. Greet them, take their drink/food order, make small talk, and handle payment at the end." },
  friend:     { persona:"a new friend at a meetup",      system:"You are a warm local meeting the learner for the first time at a language-exchange meetup. Get to know each other — names, where you're from, hobbies, why they're learning." },
  interview:  { persona:"a hiring manager",              system:"You are a hiring manager interviewing the learner for a job they'd love. Ask about their background, strengths, and why they want the role. Be professional but kind." },
  directions: { persona:"a helpful stranger",            system:"You are a friendly local on the street. The learner is a tourist who is lost. Help them find their way and suggest a nearby place worth visiting." },
  restaurant: { persona:"a waiter",                      system:"You are a waiter at a nice restaurant. Seat the learner, describe a couple of specials, take their order, and recommend a dish or drink." },
  doctor:     { persona:"a doctor",                      system:"You are a caring family doctor. The learner is a patient. Ask what's wrong, ask a few follow-up questions about their symptoms, and give simple reassuring advice." },
  market:     { persona:"a market vendor",              system:"You are a cheerful vendor at an outdoor food market. The learner wants to buy fresh produce. Describe what's good today, quote prices, and let them haggle a little." },
  hotel:      { persona:"a hotel receptionist",          system:"You are a hotel receptionist. Help the learner check in, answer questions about their room, breakfast, and things to do nearby." },
  date:       { persona:"someone on a first date",       system:"You are on a friendly first date with the learner at a casual restaurant. Be warm and a little playful — ask about their life, tastes, and dreams. Keep it wholesome." },
};

const LEVEL_GUIDE = {
  "beginner-zero": { label:"Absolute beginner",   register:"Use only very simple, high-frequency words and short present-tense sentences. Go slow and be extra encouraging." },
  beginner:        { label:"Beginner (A1–A2)",    register:"Use simple everyday vocabulary, mostly present tense, and short sentences." },
  intermediate:    { label:"Intermediate (B1)",   register:"Use natural everyday language with common past and future tenses, and a few idioms." },
  advanced:        { label:"Advanced (B2+)",      register:"Speak naturally at near-native pace with idioms, nuance, and rich vocabulary." },
};

function buildChatSystemPrompt({ lang, nativeLang, scenario, level }) {
  const name       = LANG_NAMES_COACH[lang]       || lang;
  const nativeName = LANG_NAMES_COACH[nativeLang] || "English";
  const note = LANG_NOTES[lang] ? `\nScript rule: ${LANG_NOTES[lang]}` : "";
  const sc  = CONVERSATION_SCENARIOS[scenario] || CONVERSATION_SCENARIOS.free;
  const lvl = LEVEL_GUIDE[level] || LEVEL_GUIDE.beginner;
  return `You are a warm, patient ${name} conversation partner inside the Tongue language-learning app. You are role-playing a real spoken conversation with an adult learner whose native language is ${nativeName}.

ROLE / SCENARIO:
${sc.system}

THE LEARNER'S LEVEL: ${lvl.label}. ${lvl.register}

HOW TO TALK:
- Speak ONLY in ${name}. Do not switch to ${nativeName}, except at most a single word in parentheses if the learner is truly stuck.
- Keep every reply short and natural — 1 to 3 sentences, like real speech. Never lecture.
- Stay in character as ${sc.persona} and keep the scene moving. Always end with a question or a prompt so the learner has something to respond to.
- If the learner makes a mistake, do NOT stop to correct it formally. Instead, naturally model the correct phrasing in your own reply (recasting), the way a kind native speaker would.
- If the learner writes in ${nativeName} or gets stuck, gently nudge them back into ${name} and hand them the exact ${name} phrase they need.
- Never break character or mention being an AI, a model, or a prompt.${note}

Output plain conversational text only — no JSON, no markdown, no stage directions, no surrounding quotation marks.`;
}

// ── Shared session/access check (paid nonce + active subscription) ────────────
async function checkAccess(user) {
  const { userId, codeId, nonce, plan } = user;
  if (plan === "free") return { ok: true };
  const code = await db.get(`
    SELECT is_active, expires_at, session_nonce, session_nonce_2
    FROM access_codes WHERE id = $1 AND user_id = $2
  `, [codeId, userId]);
  if (!code || !code.is_active || new Date(code.expires_at) < new Date()) {
    return { ok: false, status: 401, error: "Session expired. Please log in again." };
  }
  if (code.session_nonce !== nonce && code.session_nonce_2 !== nonce) {
    return { ok: false, status: 401, error: "Your subscription has renewed. Check your email for your new access code.", reason: "renewed" };
  }
  const hasPaid = await db.hasActivePaidAccess(userId);
  if (!hasPaid) {
    return { ok: false, status: 402, error: "Your subscription is not active. Please renew at /subscribe.", upgrade: true };
  }
  return { ok: true };
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
  const { userId, plan } = req.user;
  const { prompt, maxTokens, language, featureType, nativeLang } = req.body || {};

  // Input validation
  const validationError = validatePrompt(prompt);
  if (validationError) return res.status(400).json({ error: validationError });

  // Paid users: validate code is still active + nonce matches + subscription live
  const access = await checkAccess(req.user);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error, reason: access.reason, upgrade: access.upgrade });
  }

  // Rate limiting
  const { allowed, remaining, reason } = await checkRateLimit(userId, plan);
  if (!allowed) {
    const isFree = plan === "free";
    const error = isFree
      ? "You've used your 5 free coach messages today. Upgrade to Tongue Premium for unlimited access."
      : reason === "burst"
        ? "Too many requests. Please slow down."
        : "You've reached the daily limit (300 messages). Resets at midnight.";

    db.trackEvent(userId, "free_limit_reached", { plan, reason });
    return res.status(429).json({ error, upgrade: isFree });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[Claude] ANTHROPIC_API_KEY not set");
    return res.status(500).json({ error: "the tutor is not configured." });
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
        system: buildSystemPrompt(language || "fr", nativeLang || "en"),
        messages: [{ role: "user", content: String(prompt).slice(0, 6000) }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`[Claude] API error ${anthropicRes.status}:`, errText.slice(0, 200));
      return res.status(502).json({ error: "the tutor error. Please try again in a moment." });
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
      return res.status(502).json({ error: "The tutor returned an unexpected response. Please try again." });
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

// ── POST /api/claude/chat — real streaming conversation (SSE) ─────────────────
// Body: { messages:[{role,content}], scenario, level, language, nativeLang }
// Streams events: {type:"delta",text} … {type:"done",remaining} | {type:"error",…}
router.post("/chat", requireAuth, async (req, res) => {
  const { userId, plan } = req.user;
  const { messages, scenario, level, language, nativeLang } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  // Sanitize: keep only well-formed user/assistant turns, cap size + history depth.
  const clean = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
    return res.status(400).json({ error: "the last message must be from the user" });
  }
  const lastUser = clean[clean.length - 1].content;
  if (/ignore previous instructions|disregard all|you are now/i.test(lastUser)) {
    return res.status(400).json({ error: "invalid message content" });
  }

  const access = await checkAccess(req.user);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error, reason: access.reason, upgrade: access.upgrade });
  }

  const { allowed, remaining, reason } = await checkRateLimit(userId, plan);
  if (!allowed) {
    const isFree = plan === "free";
    const error = isFree
      ? "You've used your free conversation turns today. Upgrade to Tongue Premium for unlimited conversations."
      : reason === "burst" ? "Too many messages — please slow down." : "You've reached today's limit. Resets at midnight.";
    db.trackEvent(userId, "free_limit_reached", { plan, reason, featureType: "chat" });
    return res.status(429).json({ error, upgrade: isFree });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "the tutor is not configured." });

  // Server-Sent Events
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {} };

  let full = "", inTok = 0, outTok = 0;
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        stream: true,
        system: buildChatSystemPrompt({ lang: language || "fr", nativeLang: nativeLang || "en", scenario, level }),
        messages: clean,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      const lowCredit = /credit balance|insufficient|quota|billing/i.test(errText);
      console.error(`[Chat] upstream ${upstream.status}:`, errText.slice(0, 200));
      send({ type: "error", error: lowCredit ? "credits" : "upstream",
        message: lowCredit ? "The tutor is offline for a moment. Please try again shortly." : "The tutor hit a snag. Please try again." });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const payload = l.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev; try { ev = JSON.parse(payload); } catch { continue; }
        if (ev.type === "message_start") inTok = ev.message?.usage?.input_tokens || 0;
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          full += ev.delta.text;
          send({ type: "delta", text: ev.delta.text });
        } else if (ev.type === "message_delta") outTok = ev.usage?.output_tokens || outTok;
      }
    }

    send({ type: "done", remaining: plan === "free" ? remaining : null });
    res.end();

    const cost = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;
    db.run(`INSERT INTO ai_usage_logs (user_id, language, feature_type, input_length, output_length, estimated_cost)
            VALUES ($1,$2,$3,$4,$5,$6)`, [userId, language || null, "chat", inTok, outTok, cost]).catch(() => {});
    db.trackEvent(userId, "chat_message_sent", { plan, language, scenario });
  } catch (e) {
    console.error("[Chat] stream error:", e.message);
    send({ type: "error", error: "connection", message: "Connection lost. Please try again." });
    try { res.end(); } catch (_) {}
  }
});

module.exports = router;
