#!/usr/bin/env node
/**
 * prewarm-content.js
 *
 * Pre-generates all 10 × 5 = 50 AI content items (non-French languages) so
 * that every user gets instant page loads on first visit — no 30-second AI
 * wait in production.
 *
 * Usage:
 *   node scripts/prewarm-content.js            # all missing
 *   node scripts/prewarm-content.js --force    # regenerate everything
 *   node scripts/prewarm-content.js es grammar # single lang+tab
 *
 * Requirements: .env must be present with ANTHROPIC_API_KEY and DB_PATH.
 */

require("dotenv").config();
const path   = require("path");
const sqlite = require("better-sqlite3");

// ── Config ───────────────────────────────────────────────────────────────────
const DB_PATH  = process.env.DB_PATH || "./data/french.db";
const FORCE    = process.argv.includes("--force");
const SINGLE_LANG = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const SINGLE_TAB  = process.argv[3] || null;

const LANGS = ["es","pt","it","de","ja","zh","ko","ru","ar","hi"];
const TABS  = ["grammar","cheatsheet","structures","vocab","dialogues"];

// ── Database ─────────────────────────────────────────────────────────────────
const db = new sqlite(path.resolve(DB_PATH));
db.prepare(`
  CREATE TABLE IF NOT EXISTS content_cache (
    lang TEXT, tab TEXT, content TEXT,
    generated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (lang, tab)
  )
`).run();

function isCached(lang, tab) {
  const row = db.prepare("SELECT 1 FROM content_cache WHERE lang=? AND tab=?").get(lang, tab);
  return !!row;
}

// ── HTTP helper (no extra deps — uses built-in https) ────────────────────────
const https = require("https");

function postJSON(url, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => (buf += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { reject(new Error("JSON parse error: " + buf.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Load prompts & validation from routes/content.js ─────────────────────────
// We re-use the exact same functions to guarantee consistency.
// But since content.js uses Express + db handle, we call the HTTP API instead.
// The server must be running. If not, we fall back to calling Anthropic directly
// using the same prompts defined inline below.

// Actually, the cleanest approach: just hit our own running server's admin endpoint.
// But for offline prewarm we inline a minimal version.

// Pull the prompt builders directly from content.js by requiring it in isolation.
// content.js exports LANG_NAMES; we build prompts the same way.
const {
  LANG_NAMES,
} = (() => {
  try {
    // Suppress Express/db side-effects by mocking them
    const Module = require("module");
    const origLoad = Module._load;
    const mocks = {
      express: () => { const r=()=>{}; r.Router=()=>({get:()=>{},post:()=>{}}); return r; },
      "../db": { prepare: () => ({ get: ()=>null, all: ()=>[], run: ()=>{} }), run: ()=>{} },
    };
    Module._load = function(req, ...args) {
      for (const k of Object.keys(mocks)) if (req === k || req.endsWith(k)) return typeof mocks[k]==="function" ? mocks[k]() : mocks[k];
      return origLoad.call(this, req, ...args);
    };
    const mod = require("../routes/content");
    Module._load = origLoad;
    return mod;
  } catch (e) {
    // fallback — define LANG_NAMES inline
    return { LANG_NAMES: { es:"Spanish",pt:"Portuguese",it:"Italian",de:"German",ja:"Japanese",zh:"Chinese (Mandarin)",ko:"Korean",ru:"Russian",ar:"Arabic",hi:"Hindi" } };
  }
})();

// ── Minimal prompt builders (mirrors routes/content.js exactly) ─────────────

const DIALOGUE_SCENARIOS = {
  es: ["Ordering at a tapas bar in Madrid","Asking for directions to a museum","Haggling at a street market","Meeting a neighbor for the first time","Making a doctor's appointment over the phone"],
  pt: ["Ordering food at a churrascaria","Getting help at a pharmacy","Chatting with a taxi driver","Booking a hotel room","Running into a colleague on the street"],
  it: ["Ordering gelato and espresso","Asking for help in a clothing shop","Discussing weekend plans with a friend","Checking in at a B&B","Bargaining at a produce market"],
  de: ["Buying a train ticket at the Bahnhof","Asking a librarian for help","Ordering food at a Biergarten","Meeting a flatmate for the first time","Calling to reschedule an appointment"],
  ja: ["Ordering at a ramen shop","Asking for directions on the subway","Shopping for souvenirs","Greeting a new coworker","Booking a ryokan by phone"],
  zh: ["Ordering dim sum at a restaurant","Haggling at a night market","Asking for directions in Beijing","Meeting a classmate on campus","Calling to change a reservation"],
  ko: ["Ordering at a Korean BBQ","Shopping for clothes at Myeongdong","Asking for directions to a subway station","Meeting a new colleague","Booking a jjimjilbang session"],
  ru: ["Buying groceries at a market","Asking for directions in Moscow","Ordering at a café","Meeting a new neighbor","Booking a museum tour"],
  ar: ["Ordering at a Lebanese restaurant","Asking for directions in a medina","Shopping at a souk","Meeting a host family for the first time","Booking a taxi by phone"],
  hi: ["Ordering at a dhaba","Asking for directions in Delhi","Shopping at a bazaar","Meeting a new colleague","Booking a train ticket"],
};

const SCRIPT_REQUIRED = { ja:"Japanese script (hiragana/katakana/kanji)", zh:"Chinese characters (hanzi)", ko:"Korean script (hangul)", ru:"Cyrillic", ar:"Arabic script", hi:"Devanagari script" };

function buildPrompt(lang, tab) {
  const name = LANG_NAMES[lang] || lang;
  if (tab === "grammar") {
    const sr = SCRIPT_REQUIRED[lang] ? `IMPORTANT: every example_target field MUST contain ${SCRIPT_REQUIRED[lang]} — never romanized text.` : "";
    return `You are an expert ${name} language teacher. Return ONLY valid JSON, no markdown.
${sr}
Return a JSON object:
{"sections":[{"title":"...","rule":"...","example_target":"...","example_ref":"...","notes":"..."}]}
Include exactly 8 sections covering: articles/gender, present tense, past tense, future tense, negation, questions, adjectives, common irregular verbs.
Each section: title (string), rule (1–3 sentence explanation), example_target (${name} sentence), example_ref (English translation), notes (extra tip).`;
  }
  if (tab === "cheatsheet") {
    const sr = SCRIPT_REQUIRED[lang] ? `IMPORTANT: every target field MUST contain ${SCRIPT_REQUIRED[lang]}.` : "";
    return `You are an expert ${name} language teacher. Return ONLY valid JSON, no markdown.
${sr}
Return:
{"categories":[{"name":"...","items":[{"target":"...","ref":"..."}]}]}
Include 6 categories: Greetings & Farewells, Numbers 1–20, Days & Months, Colors, Common Phrases, Emergency Phrases.
Each category has at least 6 items. target = ${name}, ref = English.`;
  }
  if (tab === "structures") {
    const sr = SCRIPT_REQUIRED[lang] ? `IMPORTANT: ex1_target and ex2_target MUST contain ${SCRIPT_REQUIRED[lang]}.` : "";
    return `You are an expert ${name} language teacher. Return ONLY valid JSON, no markdown.
${sr}
Return:
{"structures":[{"pattern":"...","explanation":"...","ex1_target":"...","ex1_ref":"...","ex2_target":"...","ex2_ref":"..."}]}
Include 8 high-frequency sentence patterns (e.g. I want to..., Can you...?, There is/are..., I have been..., etc.).`;
  }
  if (tab === "vocab") {
    const sr = SCRIPT_REQUIRED[lang] ? `IMPORTANT: every t field MUST contain ${SCRIPT_REQUIRED[lang]}.` : "";
    return `You are an expert ${name} language teacher. Return ONLY valid JSON, no markdown.
${sr}
Return:
{"categories":[{"name":"...","words":[{"t":"...","r":"...","p":"..."}]}]}
Include 7 categories: Greetings, Numbers, Food & Drink, Travel & Transport, Family, Body & Health, Emotions.
Each has 8 words. t = ${name} word, r = English, p = pronunciation hint (romanization or IPA).`;
  }
  if (tab === "dialogues") {
    const scenes = (DIALOGUE_SCENARIOS[lang] || []).slice(0, 5);
    const sr = SCRIPT_REQUIRED[lang] ? `IMPORTANT: every target field in lines MUST contain ${SCRIPT_REQUIRED[lang]} — never romanized text only.` : "";
    return `You are an expert ${name} language teacher writing 5 realistic dialogues for learners. Return ONLY valid JSON, no markdown.
${sr}
Write dialogues for these 5 scenes IN THIS ORDER:
${scenes.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Return:
{"dialogues":[{"title":"...","scene":"...","level":"Beginner|Intermediate|Advanced","lines":[{"speaker":"...","target":"...","ref":"..."}],"vocab":["key word (English)"],"note":"Cultural or language tip"}]}
Rules:
- Each dialogue must have 8–12 lines (alternating speakers)
- vocab: 4–6 key words/phrases with English meanings
- level: 1–2 = Beginner, 3–4 = Intermediate, 5 = Advanced
- target lines must be natural, idiomatic ${name} — not word-for-word translations`;
  }
  return "";
}

// ── Validation (mirrors routes/content.js) ───────────────────────────────────
const HAS_CHINESE  = s => /[一-鿿㐀-䶿]/.test(s);
const HAS_JAPANESE = s => /[぀-ゟ゠-ヿ一-鿿]/.test(s);
const HAS_KOREAN   = s => /[가-힯ᄀ-ᇿ]/.test(s);
const HAS_CYRILLIC = s => /[Ѐ-ӿ]/.test(s);
const HAS_ARABIC   = s => /[؀-ۿݐ-ݿ]/.test(s);
const HAS_DEVANAGARI = s => /[ऀ-ॿ]/.test(s);
const SCRIPT_CHECK = { zh: HAS_CHINESE, ja: HAS_JAPANESE, ko: HAS_KOREAN, ru: HAS_CYRILLIC, ar: HAS_ARABIC, hi: HAS_DEVANAGARI };

function validate(lang, tab, data) {
  const sc = SCRIPT_CHECK[lang];
  if (tab === "grammar") {
    if (!Array.isArray(data.sections) || data.sections.length < 6) return "need ≥6 sections";
    for (const [i, s] of data.sections.entries()) {
      if (!s.title || !s.rule || !s.example_target || !s.example_ref) return `section ${i} incomplete`;
      if (sc && !sc(s.example_target)) return `section ${i} example_target missing native script`;
    }
  } else if (tab === "cheatsheet") {
    if (!Array.isArray(data.categories) || data.categories.length < 5) return "need ≥5 categories";
    for (const [i, c] of data.categories.entries()) {
      if (!c.name || !Array.isArray(c.items) || c.items.length < 5) return `category ${i} incomplete`;
      if (sc && !sc(c.items.map(x => x.target).join(""))) return `category ${i} missing native script`;
    }
  } else if (tab === "structures") {
    if (!Array.isArray(data.structures) || data.structures.length < 6) return "need ≥6 structures";
    for (const [i, s] of data.structures.entries()) {
      if (!s.pattern || !s.ex1_target || !s.ex1_ref) return `structure ${i} incomplete`;
      if (sc && !sc(s.ex1_target)) return `structure ${i} ex1_target missing native script`;
    }
  } else if (tab === "vocab") {
    if (!Array.isArray(data.categories) || data.categories.length < 6) return "need ≥6 categories";
    for (const [i, c] of data.categories.entries()) {
      if (!c.name || !Array.isArray(c.words) || c.words.length < 5) return `category ${i} incomplete`;
      if (sc && !sc(c.words.map(w => w.t).join(""))) return `category ${i} missing native script`;
    }
  } else if (tab === "dialogues") {
    if (!Array.isArray(data.dialogues) || data.dialogues.length < 4) return "need ≥4 dialogues";
    for (const [i, d] of data.dialogues.entries()) {
      if (!d.title || !d.scene) return `dialogue ${i} missing title/scene`;
      if (!Array.isArray(d.lines) || d.lines.length < 6) return `dialogue ${i} needs ≥6 lines`;
      if (!Array.isArray(d.vocab) || d.vocab.length < 3) return `dialogue ${i} needs ≥3 vocab`;
      if (sc && !sc(d.lines.map(l => l.target).join(""))) return `dialogue ${i} missing native script`;
    }
  }
  return null;
}

// ── Anthropic call ────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY not set in .env");
  process.exit(1);
}

async function callAnthropic(prompt) {
  const res = await postJSON(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-opus-4-5",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    },
    ANTHROPIC_API_KEY
  );
  if (res.status !== 200) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  const text = res.body?.content?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response: " + text.slice(0, 200));
  return JSON.parse(m[0]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 3;

async function generateOne(lang, tab) {
  const prompt = buildPrompt(lang, tab);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let data;
    try {
      data = await callAnthropic(prompt);
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
      console.log(`    ⚠  attempt ${attempt} API error: ${e.message} — retrying…`);
      continue;
    }
    const err = validate(lang, tab, data);
    if (err) {
      if (attempt === MAX_ATTEMPTS) throw new Error(`Validation failed after ${MAX_ATTEMPTS} attempts: ${err}`);
      console.log(`    ⚠  attempt ${attempt} validation: ${err} — retrying…`);
      continue;
    }
    db.prepare(`
      INSERT INTO content_cache (lang, tab, content, generated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(lang, tab) DO UPDATE SET content=excluded.content, generated_at=excluded.generated_at
    `).run(lang, tab, JSON.stringify(data));
    return;
  }
}

async function main() {
  const targets = [];

  if (SINGLE_LANG && SINGLE_TAB) {
    targets.push({ lang: SINGLE_LANG, tab: SINGLE_TAB });
  } else if (SINGLE_LANG) {
    TABS.forEach(tab => targets.push({ lang: SINGLE_LANG, tab }));
  } else {
    LANGS.forEach(lang => TABS.forEach(tab => targets.push({ lang, tab })));
  }

  const todo = FORCE ? targets : targets.filter(({ lang, tab }) => !isCached(lang, tab));

  if (todo.length === 0) {
    console.log("✅  All content is already cached. Use --force to regenerate.");
    return;
  }

  console.log(`\n🔥  Pre-warming ${todo.length} content item${todo.length !== 1 ? "s" : ""} (${FORCE ? "forced" : "missing only"})…\n`);

  let done = 0;
  let failed = 0;

  for (const { lang, tab } of todo) {
    const name = LANG_NAMES[lang] || lang;
    process.stdout.write(`  [${++done}/${todo.length}] ${name} → ${tab} … `);
    const t0 = Date.now();
    try {
      await generateOne(lang, tab);
      console.log(`✅  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`❌  ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Done: ${done - failed} succeeded, ${failed} failed.`);
  if (failed > 0) {
    console.log(`Re-run to retry failed items (they stay uncached until they pass validation).`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
