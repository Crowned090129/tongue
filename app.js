/**
 * app.js — Express application factory.
 *
 * Separated from server.js so tests can import the app without triggering
 * db.initialize(), app.listen(), or background content generation.
 *
 * Usage:
 *   const app = require('./app');       // tests, supertest
 *   const { app } = require('./app');   // named export alternative
 */

// Load .env but never override vars already set by the shell (e.g. NODE_ENV=test)
require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const path    = require("path");
const db      = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,    // React CDN + inline scripts require this off
  crossOriginEmbedderPolicy: false,
}));
app.disable("x-powered-by");

// ── CORS — restricted to known origins ───────────────────────────────────────
const allowedOrigins = [
  process.env.APP_URL,
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:5000",
  // Capacitor native apps — these origins are set by Capacitor's WebView
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);   // curl / mobile / server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS: origin not allowed"));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
// Stripe webhook must receive the raw body BEFORE express.json() processes it.
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "100kb" }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  let dbOk = false;
  try { await db.get("SELECT 1"); dbOk = true; } catch (_) {}
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    db:     dbOk ? "ok" : "error",
    ts:     new Date().toISOString(),
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/auth",    require("./routes/auth"));
app.use("/api/claude",  require("./routes/claude"));
app.use("/api/stripe",  require("./routes/stripe"));
app.use("/api/streaks", require("./routes/streaks"));
app.use("/api/content", require("./routes/content"));
app.use("/api/push",    require("./routes/push"));
app.use("/admin",       require("./routes/admin"));

// ── SEO landing pages ─────────────────────────────────────────────────────────
const LANG_SEO = {
  french:     { key:"fr", name:"French",     flag:"🇫🇷", speakers:"300M",  time:"B2 in 9–12 months",  desc:"Romance language with rich grammar, beautiful sounds, and global cultural prestige." },
  spanish:    { key:"es", name:"Spanish",    flag:"🇪🇸", speakers:"500M+", time:"B2 in 6–9 months",   desc:"The world's second most spoken language — unlock Latin America, Spain, and beyond." },
  english:    { key:"en", name:"English",    flag:"🇺🇸", speakers:"1.5B",  time:"B2 in 9–18 months",  desc:"The global language of business, science, travel, and the internet." },
  portuguese: { key:"pt", name:"Portuguese", flag:"🇧🇷", speakers:"260M",  time:"B2 in 6–9 months",   desc:"Gateway to Brazil, Portugal, and 9 countries across 4 continents." },
  italian:    { key:"it", name:"Italian",    flag:"🇮🇹", speakers:"85M",   time:"B2 in 8–10 months",  desc:"The language of art, food, opera, and one of Europe's most visited countries." },
  german:     { key:"de", name:"German",     flag:"🇩🇪", speakers:"130M",  time:"B2 in 12–16 months", desc:"Europe's largest economy, precision engineering, and world-class education." },
  chinese:    { key:"zh", name:"Chinese",    flag:"🇨🇳", speakers:"1.3B",  time:"B1 in 18–24 months", desc:"Mandarin — the most spoken language on Earth and the language of the world's largest economy." },
  japanese:   { key:"ja", name:"Japanese",   flag:"🇯🇵", speakers:"125M",  time:"B1 in 18–24 months", desc:"Anime, technology, culture, and one of the world's most fascinating writing systems." },
  korean:     { key:"ko", name:"Korean",     flag:"🇰🇷", speakers:"80M",   time:"B1 in 15–20 months", desc:"K-pop, K-dramas, Samsung, and one of Asia's most dynamic economies." },
  russian:    { key:"ru", name:"Russian",    flag:"🇷🇺", speakers:"260M",  time:"B1 in 14–18 months", desc:"The most widely spoken Slavic language, spanning 11 time zones." },
  arabic:     { key:"ar", name:"Arabic",     flag:"🇸🇦", speakers:"420M",  time:"B1 in 18–24 months", desc:"Official language of 22 countries, the language of the Quran, and a gateway to the Middle East." },
  hindi:      { key:"hi", name:"Hindi",      flag:"🇮🇳", speakers:"600M+", time:"B1 in 12–18 months", desc:"The most spoken language in India — Bollywood, cricket, and the world's fastest-growing major economy." },
};

function landingPage(lang) {
  const BASE = process.env.APP_URL || `http://localhost:${PORT}`;
  const otherLangs = Object.values(LANG_SEO)
    .filter(l => l.key !== lang.key)
    .map(l => `<a href="/learn-${l.name.toLowerCase()}" class="lang-chip">${l.flag} ${l.name}</a>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Learn ${lang.name} Online with AI — Tonge</title>
  <meta name="description" content="Learn ${lang.name} faster with an AI tutor. Personalised exercises, grammar, vocabulary, pronunciation, and real conversation practice. ${lang.speakers} speakers worldwide."/>
  <meta property="og:title" content="Learn ${lang.name} with AI — Tonge"/>
  <meta property="og:description" content="${lang.desc}"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;color:#0f172a}
    .t-nav{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #e2e8f0;padding:0 20px}
    .t-nav-inner{max-width:900px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:56px;gap:12px}
    .t-nav-logo img{height:32px;width:auto}
    .t-nav-cta{padding:7px 16px;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;font-weight:700;text-decoration:none}
    .t-nav-cta:hover{background:#1d4ed8}
    .hero{background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;padding:60px 20px;text-align:center}
    .hero-flag{font-size:64px;margin-bottom:16px}
    .hero h1{font-size:clamp(26px,5vw,42px);font-weight:900;margin-bottom:12px;line-height:1.2}
    .hero p{font-size:16px;opacity:.88;max-width:520px;margin:0 auto 28px;line-height:1.6}
    .hero-meta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-bottom:32px}
    .meta-chip{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600}
    .cta-btn{display:inline-block;padding:16px 36px;background:#fff;color:#2563eb;border-radius:12px;font-weight:800;font-size:17px;text-decoration:none;box-shadow:0 4px 20px rgba(0,0,0,.2)}
    .section{padding:48px 20px;max-width:860px;margin:0 auto}
    h2{font-size:22px;font-weight:900;margin-bottom:8px}
    .sub{color:#64748b;margin-bottom:28px;font-size:14px}
    .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:44px}
    .feat{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
    .feat-icon{font-size:26px;margin-bottom:9px}
    .feat h3{font-size:14px;font-weight:800;margin-bottom:5px}
    .feat p{font-size:13px;color:#64748b;line-height:1.6}
    .steps{display:flex;flex-direction:column;gap:12px;margin-bottom:44px}
    .step{display:flex;gap:16px;align-items:flex-start;background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
    .step-num{width:34px;height:34px;background:#2563eb;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;flex-shrink:0;margin-top:1px}
    .step h3{font-size:14px;font-weight:800;margin-bottom:3px}
    .step p{font-size:13px;color:#64748b;line-height:1.5}
    .pricing{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:480px;margin:0 auto 32px}
    .price-card{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:22px;text-align:center}
    .price-card.pop{border-color:#2563eb;background:#eff6ff}
    .price-amount{font-size:30px;font-weight:900;margin:6px 0 3px}
    .price-period{font-size:11px;color:#64748b}
    .price-label{font-size:13px;font-weight:700;color:#334155;margin-bottom:4px}
    .price-save{font-size:11px;color:#16a34a;font-weight:700;margin-top:4px}
    .langs{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:28px}
    .lang-chip{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:6px 13px;font-size:13px;color:#334155;font-weight:600;text-decoration:none}
    .lang-chip:hover{border-color:#2563eb;color:#2563eb}
    .cta-section{text-align:center;padding:48px 20px;background:#fff}
    .cta-section h2{font-size:26px;font-weight:900;margin-bottom:10px}
    .cta-section p{color:#64748b;margin-bottom:26px;font-size:14px}
    .btn-primary{display:inline-block;padding:15px 36px;background:#2563eb;color:#fff;border-radius:12px;font-weight:800;font-size:16px;text-decoration:none}
    footer{text-align:center;padding:28px 20px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0}
    footer img{height:22px;opacity:.5;display:block;margin:0 auto 10px}
    footer a{color:#64748b;text-decoration:none;margin:0 8px}
    footer a:hover{color:#2563eb}
    @media(max-width:480px){.pricing{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <nav class="t-nav">
    <div class="t-nav-inner">
      <a href="/" class="t-nav-logo"><img src="/logo.svg" alt="Tonge"/></a>
      <a href="${BASE}/subscribe" class="t-nav-cta">Get started →</a>
    </div>
  </nav>
  <div class="hero">
    <div class="hero-flag">${lang.flag}</div>
    <h1>Learn ${lang.name} with AI</h1>
    <p>${lang.desc} Start speaking from day one with your personal AI tutor.</p>
    <div class="hero-meta">
      <span class="meta-chip">${lang.speakers} speakers worldwide</span>
      <span class="meta-chip">${lang.time} to fluency</span>
      <span class="meta-chip">11 languages</span>
    </div>
    <a href="${BASE}/subscribe" class="cta-btn">Start Learning ${lang.name} — from $9/mo</a>
  </div>
  <div class="section">
    <h2>Everything you need to learn ${lang.name}</h2>
    <p class="sub">Tonge is a complete AI-powered learning system — not just flashcards.</p>
    <div class="features">
      <div class="feat"><div class="feat-icon">🤖</div><h3>AI Tutor &amp; Coach</h3><p>Personalised exercises: fill-in-the-blank, translation, role-play, free writing with corrections. Never the same lesson twice.</p></div>
      <div class="feat"><div class="feat-icon">📖</div><h3>Grammar &amp; Quick Reference</h3><p>AI-generated grammar guide for ${lang.name} — explained in your language, with examples and audio.</p></div>
      <div class="feat"><div class="feat-icon">🃏</div><h3>Spaced Repetition Flashcards</h3><p>Save words as you learn. SM-2 algorithm schedules reviews exactly when you need them — proven to 2–3× retention.</p></div>
      <div class="feat"><div class="feat-icon">💬</div><h3>Conversations &amp; Dialogues</h3><p>Practice real-life scenarios with instant corrections and follow-ups from your AI tutor.</p></div>
      <div class="feat"><div class="feat-icon">🔊</div><h3>Native Pronunciation</h3><p>Every word playable with native text-to-speech. Hear it, repeat it, remember it.</p></div>
      <div class="feat"><div class="feat-icon">🔥</div><h3>Streaks &amp; Progress</h3><p>Daily streaks keep you consistent. Consistency is the only thing that gets you to fluency.</p></div>
    </div>
    <h2>How it works</h2>
    <p class="sub">Three steps from zero to speaking ${lang.name}.</p>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div><h3>Subscribe — get your access code by email</h3><p>Monthly ($9) or yearly ($79). Code arrives instantly. No app download needed — works in any browser.</p></div></div>
      <div class="step"><div class="step-num">2</div><div><h3>Select ${lang.flag} ${lang.name} as your target</h3><p>Open the app, tap Languages, select ${lang.name}. Add your native language for personalised comparisons.</p></div></div>
      <div class="step"><div class="step-num">3</div><div><h3>Practice 20–30 minutes daily</h3><p>AI Coach + Flashcards + Drills. Consistent daily practice beats marathon sessions. You'll see results in weeks.</p></div></div>
    </div>
    <h2>Pricing</h2>
    <p class="sub">One subscription. All 11 languages. Cancel anytime.</p>
    <div class="pricing">
      <div class="price-card"><div class="price-label">Monthly</div><div class="price-amount">$9</div><div class="price-period">per month</div></div>
      <div class="price-card pop"><div class="price-label">Yearly</div><div class="price-amount">$79</div><div class="price-period">per year</div><div class="price-save">Save 27%</div></div>
    </div>
    <h2>Also available for</h2>
    <p class="sub">Switch between any of the 11 languages with one subscription.</p>
    <div class="langs">${otherLangs}</div>
  </div>
  <div class="cta-section">
    <h2>Start learning ${lang.name} today</h2>
    <p>AI-powered. No downloads. Works on any device. Cancel anytime.</p>
    <a href="${BASE}/subscribe" class="btn-primary">Get started — from $9/month →</a>
  </div>
  <footer>
    <img src="/logo.svg" alt="Tonge"/>
    <p>© ${new Date().getFullYear()} Tonge · AI-powered language learning</p>
    <div style="margin-top:8px">
      <a href="/faq">FAQ &amp; Help</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/subscribe">Subscribe</a><a href="/">App</a>
    </div>
  </footer>
</body>
</html>`;
}

Object.keys(LANG_SEO).forEach(slug => {
  app.get(`/learn-${slug}`, (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(landingPage(LANG_SEO[slug]));
  });
});

app.get("/help", (_req, res) => res.redirect(301, "/faq"));

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// 404 fallback
app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

module.exports = app;
