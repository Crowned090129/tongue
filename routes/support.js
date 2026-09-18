const express = require("express");
const db      = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { classifyUpstream, classifyFetchFailure, sendAiError } = require("../utils/aiErrors");
const router  = express.Router();

const SUPPORT_TIMEOUT_MS = 30_000;

const SYSTEM = `You are the Tongue support assistant. Tongue is a smart language learning app.

Key facts about Tongue:
- 12 languages: French, Spanish, Portuguese, Italian, German, English, Chinese, Japanese, Korean, Russian, Arabic, Hindi
- Free plan: 5 Coach messages per day, all reference content (grammar, vocab, cheatsheets), flashcards (browser-based), drills, dialogues, roadmap, word space, daily streaks
- Premium: $9/month or $79/year — up to 300 Coach messages/day
- Streaks are free for everyone. They are not a Premium feature.
- Login: no password. Free users sign up with email. Paid users use an access code (format TG-XXXXXXXX)
- Access codes: valid on 2 devices simultaneously. Lost codes can be retrieved at the Resend Code page.
- Billing changes (cancel, change plan, update payment method) are handled by replying to any email from Tongue. There is no billing screen in the app yet, so never send users to one.
- Subscriptions auto-renew.
- Refunds: offered within 7 days of purchase
- Homepage: https://tongue-app.fly.dev · App URL: https://tongue-app.fly.dev/app
- Support: users can reply to any email they received from Tongue

Answer in 2-4 sentences. Be warm, clear, and helpful. If you don't know the answer, say so honestly and suggest replying to any Tongue email for personal help. Never make up features or prices. Never ask for passwords or payment details.`;

// POST /api/support — Smart support chat, no auth required
router.post("/", asyncHandler(async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[Support] ANTHROPIC_API_KEY not set");
    return sendAiError(res, "ai_unconfigured");
  }

  // Rate limit: 10 questions per IP per hour, DB-backed so it holds across
  // restarts and machines.
  const { allowed } = await db.checkIpRateLimit("support_ip:" + req.ip, 10, 3_600_000);
  if (!allowed) {
    return res.status(429).json({ error: "Too many questions. Please wait a bit and try again." });
  }

  const { question } = req.body || {};
  if (!question || typeof question !== "string" || question.trim().length < 3) {
    return res.status(400).json({ error: "Please enter a question." });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "Question too long." });
  }

  let apiRes, bodyText;
  try {
    apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system:     SYSTEM,
        messages:   [{ role: "user", content: question.trim() }],
      }),
      signal: AbortSignal.timeout(SUPPORT_TIMEOUT_MS),
    });
    bodyText = await apiRes.text();
  } catch (e) {
    const code = classifyFetchFailure(e);
    console.error(`[Support] Claude request failed (${code}):`, e.message);
    return sendAiError(res, code);
  }

  if (!apiRes.ok) {
    const code = classifyUpstream(apiRes.status, bodyText);
    console.error(`[Support] Claude error ${apiRes.status} (${code}):`, bodyText.slice(0, 200));
    return sendAiError(res, code);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (e) {
    console.error(`[Support] Claude response is not JSON (${e.message}):`, bodyText.slice(0, 200));
    return sendAiError(res, "ai_bad_output");
  }
  const answer = data?.content?.[0]?.text;
  if (typeof answer !== "string" || !answer.trim()) {
    console.error("[Support] Claude response has no answer text:", bodyText.slice(0, 200));
    return sendAiError(res, "ai_bad_output");
  }
  res.json({ answer });
}));

module.exports = router;
