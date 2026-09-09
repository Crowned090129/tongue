const express = require("express");
const router  = express.Router();

// Rate limit: 10 questions per IP per hour (no auth needed)
const ipLimits = new Map();
function checkLimit(ip) {
  const now  = Date.now();
  const entry = ipLimits.get(ip) || { count: 0, reset: now + 3_600_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 3_600_000; }
  entry.count++;
  ipLimits.set(ip, entry);
  return entry.count <= 10;
}

const SYSTEM = `You are the Tongue support assistant. Tongue is a smart language learning app.

Key facts about Tongue:
- 12 languages: French, Spanish, Portuguese, Italian, German, English, Chinese, Japanese, Korean, Russian, Arabic, Hindi
- Free plan: 5 Coach messages per day, all reference content (grammar, vocab, cheatsheets), flashcards (browser-based), drills, dialogues, roadmap, word space
- Premium: $9/month or $79/year — up to 300 Coach messages/day, streak sync across devices
- Login: no password. Free users sign up with email. Paid users use an access code (format TG-XXXXXXXX)
- Access codes: valid on 2 devices simultaneously. Lost codes can be retrieved at the Resend Code page.
- Stripe billing: users can cancel, change plan, or update payment method via Account → Manage Billing
- Subscriptions auto-renew. A new access code is emailed on each renewal.
- Refunds: offered within 7 days of purchase
- Homepage: https://tongue-app.fly.dev · App URL: https://tongue-app.fly.dev/app
- Support: users can reply to any email they received from Tongue

Answer in 2-4 sentences. Be warm, clear, and helpful. If you don't know the answer, say so honestly and suggest replying to any Tongue email for personal help. Never make up features or prices. Never ask for passwords or payment details.`;

// POST /api/support — Smart support chat, no auth required
router.post("/", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
  if (!checkLimit(ip)) {
    return res.status(429).json({ error: "Too many questions. Please wait a bit and try again." });
  }

  const { question } = req.body || {};
  if (!question || typeof question !== "string" || question.trim().length < 3) {
    return res.status(400).json({ error: "Please enter a question." });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "Question too long." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ answer: "Support chat is temporarily unavailable. Please reply to any email you've received from Tongue and we'll get back to you within 24 hours." });
  }

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
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
    });
    const data = await apiRes.json();
    if (!apiRes.ok) throw new Error(data.error?.message || "API error");
    res.json({ answer: data.content[0].text });
  } catch (e) {
    console.error("[Support] Claude error:", e.message);
    res.json({ answer: "I'm having trouble answering right now. Please reply to any email you've received from Tongue and we'll help you personally." });
  }
});

module.exports = router;
