const express = require("express");
const { requireAuth } = require("./auth");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { classifyUpstream, classifyFetchFailure, aiErrorBody, sendAiError } = require("../utils/aiErrors");
const { VALID_LANGS } = require("./content");

const router = express.Router();

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const UPSTREAM_TIMEOUT_MS = 60_000;

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

// ── Quota ─────────────────────────────────────────────────────────────────────
// Free  : 5 requests per 24 hours (hard limit, backed by DB)
// Paid  : 300 requests per 24 hours (safety cap) + 30 per 60 seconds (burst)
// Units are reserved atomically before the upstream call and refunded when the
// call fails, so a provider outage never uses up anyone's messages.

async function reserveQuota(userId, plan) {
  const isFree = plan === "free";
  const held = [];

  if (!isFree) {
    const burstKey = `${userId}_burst`;
    const burst = await db.hitRateLimit(burstKey, 30, 60_000);
    if (!burst.allowed) return { allowed: false, reason: "burst", resetAt: burst.resetAt };
    held.push({ key: burstKey, resetAt: burst.resetAt });
  }

  const dayKey = String(userId);
  const day = await db.hitRateLimit(dayKey, isFree ? 5 : 300, 86_400_000);
  if (!day.allowed) {
    await refundQuota({ held }, "daily limit reached");
    return { allowed: false, reason: "daily", resetAt: day.resetAt };
  }
  held.push({ key: dayKey, resetAt: day.resetAt });
  return { allowed: true, remaining: day.remaining, held };
}

// Give back what reserveQuota took. A failed refund is logged; the caller still
// answers with the real AI error.
async function refundQuota(quota, why) {
  for (const { key, resetAt } of quota.held) {
    try {
      await db.refundRateLimit(key, resetAt);
    } catch (e) {
      console.error(`[Claude] quota refund failed for ${key} (${why}):`, e.message);
    }
  }
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

// language and nativeLang go into the system prompt, so only known codes are
// accepted. nativeLang falls back to English only when it is not sent at all.
function resolveLanguages({ language, nativeLang }) {
  if (!VALID_LANGS.includes(language)) {
    return { error: `language must be one of: ${VALID_LANGS.join(", ")}` };
  }
  if (nativeLang === undefined || nativeLang === null) return { language, nativeLang: "en" };
  if (!VALID_LANGS.includes(nativeLang)) {
    return { error: `nativeLang must be one of: ${VALID_LANGS.join(", ")}` };
  }
  return { language, nativeLang };
}

// ── Usage log (cost tracking) ─────────────────────────────────────────────────
// Cost estimate: claude-sonnet-4-5 ~$3/MTok in, $15/MTok out.
// Fire-and-forget, but a failed insert is logged.
function logUsage({ userId, language, featureType, inputTokens, outputTokens }) {
  const costEstimate = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  db.run(`
    INSERT INTO ai_usage_logs (user_id, language, feature_type, input_length, output_length, estimated_cost)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, language, featureType, inputTokens, outputTokens, costEstimate])
    .catch(e => console.error(`[Claude] ai_usage_logs insert failed (user ${userId}, feature ${featureType}):`, e.message));
}

// ── POST /api/claude ──────────────────────────────────────────────────────────
router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { userId, plan } = req.user;
  const { prompt, maxTokens, featureType } = req.body || {};

  // Input validation
  const validationError = validatePrompt(prompt);
  if (validationError) return res.status(400).json({ error: validationError });
  const langs = resolveLanguages(req.body);
  if (langs.error) return res.status(400).json({ code: "invalid_language", error: langs.error });
  // Recorded as sent (the web client does not send one yet).
  const feature = typeof featureType === "string" && featureType ? featureType.slice(0, 64) : null;

  // Paid users: validate code is still active + nonce matches + subscription live
  const access = await checkAccess(req.user);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error, reason: access.reason, upgrade: access.upgrade });
  }

  // Configuration before quota: an unconfigured tutor must not cost a message.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[Claude] ANTHROPIC_API_KEY not set");
    return sendAiError(res, "ai_unconfigured");
  }

  const quota = await reserveQuota(userId, plan);
  if (!quota.allowed) {
    const isFree = plan === "free";
    const error = isFree
      ? "You've used your 5 free coach messages today. Upgrade to Tongue Premium for unlimited access."
      : quota.reason === "burst"
        ? "Too many requests. Please slow down."
        : "You've reached the daily limit (300 messages). It resets 24 hours after your first message of the day.";

    db.trackEvent(userId, "free_limit_reached", { plan, reason: quota.reason });
    return res.status(429).json({ code: "quota_exceeded", error, upgrade: isFree, resetAt: quota.resetAt });
  }

  // Every failure from here on gives the reserved message back.
  const fail = async (code, detail) => {
    console.error(`[Claude] ${code}:`, detail);
    await refundQuota(quota, code);
    return sendAiError(res, code);
  };

  const requestBody = JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: Math.min(maxTokens || 1000, 2000), // hard cap at 2000
    system: buildSystemPrompt(langs.language, langs.nativeLang),
    messages: [{ role: "user", content: String(prompt).slice(0, 6000) }],
  });

  let anthropicRes, bodyText;
  try {
    anthropicRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: requestBody,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    bodyText = await anthropicRes.text();
  } catch (e) {
    return fail(classifyFetchFailure(e), `request failed: ${e.message}`);
  }

  if (!anthropicRes.ok) {
    return fail(classifyUpstream(anthropicRes.status, bodyText), `API error ${anthropicRes.status}: ${bodyText.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (e) {
    return fail("ai_bad_output", `response body is not JSON (${e.message}): ${bodyText.slice(0, 200)}`);
  }

  // Tokens were spent even if the output below turns out to be unusable.
  logUsage({
    userId,
    language: langs.language,
    featureType: feature,
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
  });

  const text = data?.content?.[0]?.text;
  const raw = typeof text === "string" ? text.replace(/```json/g, "").replace(/```/g, "").trim() : "";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return fail("ai_bad_output", `model output is not JSON (${e.message}): ${raw.slice(0, 300)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    return fail("ai_bad_output", `model output is not a JSON object: ${raw.slice(0, 300)}`);
  }

  // Surface remaining free-tier quota
  if (plan === "free") {
    parsed._meta = { plan: "free", remaining: quota.remaining };
  }

  db.trackEvent(userId, "ai_message_sent", { plan, language: langs.language, featureType: feature });
  res.json(parsed);
}));

// Anthropic can also report an error inside an HTTP 200 stream. Map its type to
// the status the same error has on a normal response, then classify as usual.
const STREAM_ERROR_STATUS = {
  invalid_request_error: 400, authentication_error: 401, permission_error: 403,
  not_found_error: 404, request_too_large: 413, rate_limit_error: 429,
  api_error: 500, overloaded_error: 529,
};

// ── POST /api/claude/chat — real streaming conversation (SSE) ─────────────────
// Body: { messages:[{role,content}], scenario, level, language, nativeLang }
// Failures before the stream starts are JSON with a real status ({code,…}).
// Streams events: {type:"delta",text} … {type:"done",remaining} | {type:"error",code,message,error,retryable}
router.post("/chat", requireAuth, asyncHandler(async (req, res) => {
  const { userId, plan } = req.user;
  const { messages, scenario, level } = req.body || {};

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
  const langs = resolveLanguages(req.body);
  if (langs.error) return res.status(400).json({ code: "invalid_language", error: langs.error });

  const access = await checkAccess(req.user);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error, reason: access.reason, upgrade: access.upgrade });
  }

  // Configuration before quota: an unconfigured tutor must not cost a message.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[Chat] ANTHROPIC_API_KEY not set");
    return sendAiError(res, "ai_unconfigured");
  }

  const quota = await reserveQuota(userId, plan);
  if (!quota.allowed) {
    const isFree = plan === "free";
    const error = isFree
      ? "You've used your free conversation turns today. Upgrade to Tongue Premium for unlimited conversations."
      : quota.reason === "burst" ? "Too many messages — please slow down." : "You've reached today's limit. It resets 24 hours after your first message of the day.";
    db.trackEvent(userId, "free_limit_reached", { plan, reason: quota.reason, featureType: "chat" });
    return res.status(429).json({ code: "quota_exceeded", error, upgrade: isFree, resetAt: quota.resetAt });
  }

  // The upstream request ends on timeout or when the learner leaves. A leave is
  // detected on res (closed before it finished): req "close" already fires once
  // the JSON body has been read, while the connection is still open.
  const leave = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (res.writableFinished) return;
    clientGone = true;
    leave.abort();
  });

  let full = "", inTok = 0, outTok = 0;
  const logChatUsage = () => logUsage({ userId, language: langs.language, featureType: "chat", inputTokens: inTok, outputTokens: outTok });

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        stream: true,
        system: buildChatSystemPrompt({ lang: langs.language, nativeLang: langs.nativeLang, scenario, level }),
        messages: clean,
      }),
      signal: AbortSignal.any([leave.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
  } catch (e) {
    if (clientGone) {
      console.warn(`[Chat] user ${userId} disconnected before the tutor answered`);
      return;
    }
    const code = classifyFetchFailure(e);
    console.error(`[Chat] upstream request failed (${code}):`, e.message);
    await refundQuota(quota, code);
    return sendAiError(res, code);
  }

  // Nothing has been sent yet, so a failed upstream still gets a real status.
  if (!upstream.ok || !upstream.body) {
    let errText = "";
    try {
      errText = await upstream.text();
    } catch (e) {
      console.error(`[Chat] could not read upstream ${upstream.status} body:`, e.message);
    }
    const code = upstream.ok ? "ai_bad_output" : classifyUpstream(upstream.status, errText);
    console.error(`[Chat] upstream ${upstream.status} (${code}):`, errText.slice(0, 200));
    await refundQuota(quota, code);
    return sendAiError(res, code);
  }

  // Upstream answered OK: only now commit to Server-Sent Events.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  const send = (obj) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  let stopped = false, failure = null;
  try {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!failure) {
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
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch (e) {
          failure = { code: "ai_bad_output", detail: `unreadable stream event (${e.message}): ${payload.slice(0, 200)}` };
          break;
        }
        if (ev.type === "message_start") inTok = ev.message?.usage?.input_tokens || 0;
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          full += ev.delta.text;
          send({ type: "delta", text: ev.delta.text });
        } else if (ev.type === "message_delta") outTok = ev.usage?.output_tokens || outTok;
        else if (ev.type === "message_stop") stopped = true;
        else if (ev.type === "error") {
          const status = STREAM_ERROR_STATUS[ev.error?.type] || 500;
          failure = { code: classifyUpstream(status, payload), detail: payload.slice(0, 200) };
          break;
        }
      }
    }
    if (failure) reader.cancel().catch(e => console.error("[Chat] could not cancel the upstream stream:", e.message));
    else if (!stopped) failure = { code: "ai_unreachable", detail: "upstream stream ended before message_stop" };
  } catch (e) {
    if (clientGone) {
      console.warn(`[Chat] user ${userId} disconnected mid-stream`);
      logChatUsage();
      return;
    }
    failure = { code: classifyFetchFailure(e), detail: e.message };
  }

  if (failure) {
    console.error(`[Chat] stream failed (${failure.code}):`, failure.detail);
    if (inTok || outTok) logChatUsage();
    await refundQuota(quota, failure.code);
    send({ type: "error", ...aiErrorBody(failure.code) });
    return res.end();
  }

  send({ type: "done", remaining: plan === "free" ? quota.remaining : null });
  res.end();

  logChatUsage();
  db.trackEvent(userId, "chat_message_sent", { plan, language: langs.language, scenario });
}));

module.exports = router;
