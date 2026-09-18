# Tongue: Architecture Forensics

**Date:** 2026-09-14
**Scope:** the whole repository at `main` (HEAD `ae35713`), plus one live session on https://tongue-app.fly.dev/app.
**Method:**
- Six areas were investigated in parallel: platform, content, client-language, client-shell, client-features, native-and-secondary. A quality/ops pass was added on top.
- Two skeptics independently re-checked every claim against the code.
- One logged-in session exercised the product end to end on the live site.
- Traced defects were matched to code paths.

**Safety:**
- Read-only. No repository files were changed except these three documents.
- No test suite, migration or script was run against any database.
- No secret values are reproduced. Only variable names appear here.

Companion documents: [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) · [MIGRATION_PLAN.md](./MIGRATION_PLAN.md)

## How to read the labels

| Label | Meaning |
|---|---|
| **CONFIRMED** | Both skeptics confirmed it in the code, or it was reproduced in the live session. |
| **CONFIRMED (live)** | Reproduced in the live session, with network or console evidence. |
| **PARTIALLY CONFIRMED** | The core is true but the original wording was too strong. Only the corrected statement appears here. |
| **UNVERIFIED** | Plausible, but checking it needs production access this audit did not have (production DB rows, Fly secrets, logs). Never presented as fact. |

Line numbers refer to `public/index.html` unless another file is named.

---

## Executive verdict

Tongue is **not yet one product**, but not for the reason suspected.

- **Languages are not separate implementations.** The server has one content pipeline and one coach proxy serving all 12 languages. Every learning screen a user can reach is one component parameterised by `tLang`.
- **The fragmentation is between features, clients and copies of configuration:**
  - The language list, prices and design tokens are hand-copied in many places, and the copies have drifted.
  - A second, hand-authored per-language data model (`LANGS_DATA`) sits beside the real content pipeline.
  - Every feature keeps its own private learner state in `localStorage`, so there is no learner model.
  - "Lessons" are read-only reference items with a self-reported "Mark complete" button.
  - Navigation, headers, widths and overlays are rebuilt per screen.
  - Three clients (web, iOS, Android) each re-implement product logic, and iOS already gives different results.

Two groups of problems are more urgent than the redesign and must be handled first:

1. **Platform safety.**
   - Any rejected database call inside most async handlers crashes the single production machine (reproduced locally).
   - The only test suite runs against whatever `.env` points to, which is production, and wipes `rate_limits` there.
2. **Security and billing.**
   - The Stripe billing portal can be opened by email alone.
   - `/api/auth/signup` issues a session for an existing email without verification.
   - The admin password in tracked `DEPLOY.md` matches the local `.env`.
   - Stripe events are marked processed before they are handled.

---

## 1. Current architecture

### 1.1 Runtime topology — CONFIRMED

```
Browser (web)                         Native (unshipped scaffolds)
 public/index.html (8,504 lines)       native/ios (SwiftUI, XcodeGen spec)
  React 18 + ReactDOM from unpkg        native/android (Kotlin/Compose/Room)
  @babel/standalone 7.29.7 compiles     base URL: https://tonge-app.fly.dev  <-- old host
  ~550 KB of JSX in the browser
  state: ~15 localStorage keys
        |
        v  HTTPS
Fly.io app "tongue-app" (1 machine, 512 MB, iad)      Fly app "tonge-app" (older build, still live)
 Dockerfile: node:20-alpine, npm install --production, runs as root, no HEALTHCHECK
 server.js -> app.js (Express 4.22.2)
   /api/auth  /api/claude  /api/content  /api/stripe  /api/streaks  /api/push  /api/support  /admin
   /learn-<lang> SEO pages (app.js LANG_SEO)   /  -> home.html   /app -> index.html
   node-cron in-process: push reminders 20:00 UTC, content generation every 6h, cleanup 03:00
        |
        v
Postgres (DATABASE_URL; Supabase host per local .env; production value not inspected)
 13 tables, schema re-created on every boot, migration errors swallowed
        |
        v
Anthropic (Opus content generation, Sonnet coach/chat, Haiku support), Stripe, Resend/SMTP, Firebase (optional)
```

Evidence:
- `Dockerfile:1-7`, `fly.toml:5-30`, `server.js:36-68,96-101`, `app.js:24-27,57-84,87-255`
- `public/index.html:18-21` (CDN scripts), `315-8503` (the `text/babel` block)
- `native/ios/Tongue/Networking/APIClient.swift:24`, `native/android/app/build.gradle.kts:36-37`

### 1.2 Server — CONFIRMED

**Size and shape.** One Express monolith of about 4,100 lines of JavaScript: `routes/content.js` 1,762, `admin.js` 614, `auth.js` 596, `claude.js` 372, `stripe.js` 366, `db.js` 310, `app.js` 257.

**Separation of concerns.** There is no layering. Routes run SQL directly through `db.get/all/run` (`db.js:30-45`).

**Error handling** (claim `platform-3`, reproduced):
- Express 4 ignores promises returned by async handlers.
- There is no error middleware (`app.js:253` is only a 2-argument 404 handler).
- There is no `unhandledRejection` handler anywhere.
- A rejected `await` in an unguarded handler therefore ends the process. This was reproduced on Node 20.20.2 and 22.13.1 using the repo's own Express.
- Unguarded handlers: every one in `routes/admin.js` (8 async handlers, 0 `try`), `streaks.js`, `push.js`, and parts of `auth.js` and `claude.js`.
- Example: an anonymous `POST /api/stripe/create-portal {"email":1}` throws on `email.trim()` (`routes/stripe.js:61-63`).

**Schema management** (`quality-6`, `platform-16`):
- `db.initialize()` runs `CREATE TABLE IF NOT EXISTS` for 13 tables, 11 ALTERs and a DO block on every boot.
- Every migration and index error is swallowed (`db.js:206,226`).
- There is no migration history, no transactions and no release phase (`fly.toml` has no `[deploy]` or checks).

**Tables** (`db.js:50-227`): `users`, `access_codes`, `subscriptions`, `admin_sessions`, `rate_limits`, `streaks`, `content_cache`, `ai_usage_logs`, `analytics_events`, `stripe_events`, `push_tokens`, `content_reports`, `magic_links`. There is **no** table for lessons, progress, flashcards, reviews, attempts or saved words (`platform-11`).

### 1.3 Web client — CONFIRMED

- **One file, compiled in the browser.** One inline `<script type="text/babel">` spans lines 315-8503 (549,913 bytes). Babel standalone (3.14 MB, 661 KB gzipped) compiles it on every page load. The local transform took 0.4-0.8 s and Babel prints its ">500KB deoptimised" note on every load (`quality-4`, PARTIALLY CONFIRMED: the service worker caches unpkg files, so the *download* usually happens once per device, but compilation happens every time).
- **No build step, no modules, no types, no router, no state layer.**
- **Navigation.** It is `useState(view)` plus a `stack` array (7953-7954), with a conditional `view === "x" && …` chain (8235-8317) inside `App` (7949-8381).
- **Pinning and integrity.** `react@18` and `react-dom@18` float within major version 18. None of the 4 CDN scripts has SRI. CSP is disabled (`app.js:25`). The JWT lives in `localStorage` (2882) (`quality-5`).
- **Tests.** No test touches the client (`client-shell-19`).

### 1.4 Clients and secondary surfaces — CONFIRMED

- **iOS** (about 45 Swift files) and **Android** (about 50 Kotlin files) are two commits from 2026-07-14 that no later redesign has touched (`native-and-secondary-11`). Both point at the old `tonge-app.fly.dev`, which is still live but serves an older build (487,892 bytes vs 563,727 bytes) (`native-and-secondary-1`).
- **Capacitor** config, `cap:*` scripts and the index.html push bootstrap (231-300) are dead. No Capacitor platform exists (`native-and-secondary-7`).
- **Marketing, SEO and admin pages** use at least four separate styling systems: `brand.css`, `home.html` `:root`, the `app.js:117-164` inline template, and `routes/admin.js:242-252` blue (`platform-18`, `native-and-secondary-8`).

### 1.5 Testing, CI, delivery — CONFIRMED

- **One test file.** `tests/smoke.test.js` has 294 lines and 26 tests covering auth and access-control status codes.
- **It is unsafe to run.** It loads `.env` (`smoke.test.js:19`), whose `DATABASE_URL` is not localhost. It runs `DELETE FROM rate_limits` (`:41`), never deletes the users it creates (`:77`), and makes real Anthropic and Resend calls (`quality-1`).
- **It is stale.** It expects `402` from `GET /api/streaks` (`:213-222`), but `ae35713` removed that gate (`routes/streaks.js:7-8,47`) (`quality-3`, `platform-10`).
- **No CI, lint, typecheck or build.** `scripts/validate_seed.js` exists but nothing runs it (`content-14`).

---

## 2. Language implementation architecture

### 2.1 Direct answer to "does each language have its own implementation?"

**NO. There are no separate per-language implementations** on the server or in the reachable web screens. CONFIRMED.

- **Server.** One generic pipeline runs anchor list → prompt → JSON → validate → cache → `GET /api/content/:lang/:tab` (`routes/content.js:1081-1208,1214-1328,1568-1607`). The only language-keyed behaviour tables are `SCRIPT_CHECK` (`:42-49`) and `LANG_NAMES` (`:31`). A grep found no per-language `if` or `switch` (`content-4`).
- **Coach and chat.** One system prompt builder is parameterised by language (`routes/claude.js:22-37,63`). One scenario engine serves all clients (`:42-84`).
- **Web.** Grammar, Structures and Vocab (`AITabContent`, 3870-4239), Drills, Dialogues and Roadmap (`useApiContent`, 3791-3811), LearnPath (6261-6263) and WordOfDay (5417) are each a single component that takes `tLang` (`client-language-1`).

**YES, language concerns are duplicated, drifted and partly hard-coded.** CONFIRMED, with corrections applied.

1. **Language identity is re-declared in about 15 registries.**

   | Where | Registries |
   |---|---|
   | Web client | `TARGETS` 506, `REFS` 520, `SYNERGY_DESC` 528, `LANGS_DATA` 546, `speakersMap`/`nativeMap` 972-973, `LANG_THEME` 422, `SUPPORTED` 495, `TEST_PHRASES` 4773, `NATIVES` 6708 |
   | Server | `routes/content.js:31`, `routes/claude.js:8,13`, `app.js:87`, `routes/admin.js:535-537`, `scripts/prewarm-content.js:27,108` (fallback), `routes/support.js:18`, `routes/auth.js:210` ("11 languages") |
   | Native | `Language.swift:25-38`, `Language.kt:24-37` |

   The copies disagree:
   - Speaker counts: fr 310M vs 300M, es 485M vs 500M+.
   - The admin map lists 10 languages and 4 of 7 tabs. Rows still come from `VALID_LANGS`, so the grid really loses 3 tab columns.
   - The meta description implies 11 languages.
   - Settings offers 8 of 12 native languages.

   Claims: `platform-13`, `content-5`, `client-language-5`, `client-language-8`.

2. **A second per-language content model exists on the client: `LANGS_DATA` (544-1009).**
   - fr, es and ja were hand-typed "from the design handoff" (comment at 544-545).
   - The other 9 languages come from a stub loop (958-1009) with placeholders such as "Option A", "...", "Hello" and `level:"A2"`.
   - Live readers: Home facts (5446), the `Level ${L.level}` fallback (5449, the one live placeholder), SoundsScreen (6377-6381), CultureScreen (6429), TopBar flag and name (7786), and the language pickers (6558, 6681).
   - For the 9 stub languages, facts, sounds and culture come from real curated maps: `SOUNDS_BY_LANG` 765, `FACTS_BY_LANG` 845, `CULTURE_BY_LANG` 901. The lesson-style fields (concept, exercise, vocabThemes, phrases…) are read only by screens nobody can reach.
   - Claims: `client-language-2`, `client-language-3`, `client-shell-9` (PARTIALLY CONFIRMED, corrected).

3. **French is the silent default in about 20 client paths and 2 server paths.**
   - 12× `TARGETS[x]?.name || "French"`.
   - `|| "fr-FR"` at 320, 4741, 4857, 7155, 8128.
   - `|| "fr"` at 2797, 2945, 2980, 7967.
   - `LANGS_DATA[tLang] || LANGS_DATA.fr` (8168).
   - Server: `routes/claude.js:216,321`.
   - A stale `target_lang` shows French chrome while content requests fail with 400. For logged-in users with a valid stored `targetLang`, validation corrects it (8091-8093).
   - Claims: `client-language-6`, `client-shell-10`, `content-13`.

4. **French-era names in the generic AI contract.** `translation_fr` and `ex.fr` are used as the target-language slot for all 12 languages (4282, 4345, 4877, 4888; iOS `WordSpaceViewModel.swift:55`; Android `WordSpaceViewModel.kt:95,118`) (`content-13`, `native-and-secondary-4`).

5. **Native apps branch on French.** `hasReferenceContent: code != "fr"` (`Language.swift:20`) and `hasContentApi: code != "fr"` (`Language.kt:20`) show "coming soon" for content the server does serve (`seed/content/fr/*`, `content.js:1589`) (`native-and-secondary-2`).

6. **Content depth differs by language.**

   | Languages | Seed vocab | Grammar | Dialogues |
   |---|---|---|---|
   | fr, es, de, pt | 16 categories, 172-194 words, no example sentences | 22 sections | 6 |
   | the other 8 | 30 categories, 1,200 words with `ex`/`exr` | 22 sections | 6 |

   In the live session, Learn showed 44 lessons for French and 58 for Korean. See §2.3 for why French *production* content differs from the French *seed* (`content-7`, `client-features-12`).

7. **Capabilities are not modelled.** Script, direction, romanization, tones, gender, cases and formality exist only as prose:
   - server regexes (`content.js:42-49`)
   - coach notes (`claude.js:13-20`)
   - prompt text copied across 8+ prompts, where Hindi is omitted in the live grammar prompt (`:1098`) and cheatsheet prompt (`:1117`)

   Consequences:
   - The Arabic UI renders left-to-right.
   - `<html lang="en">` is fixed (line 2).
   - Target-language text carries no `lang` attribute, so kanji can render with Chinese glyph forms.

   Claims: `client-language-11`, `content-5`.

### 2.2 Language-specific logic that legitimately belongs (to become declared capabilities)

- **Native-script enforcement** for zh, ja, ko, ru, ar, hi (`SCRIPT_CHECK`, `SCHEMA.md:61-62`).
- **Romanization scheme per language:** pinyin with tone marks, romaji, Revised Romanization, Russian stress capitals, Arabic and Hindi transliteration.
- **Grammatical features:** gender (fr, es, pt, it, de, ru, ar, hi), cases (de, ru), conjugation, aspect (ru), particles (ja, ko), tones and measure words (zh), politeness and speech levels (ja, ko), formal address (fr tu/vous, es tú/usted, de du/Sie, it tu/Lei, pt você, hi तू/तुम/आप), ergative ने (hi), root-and-pattern morphology and MSA vs dialect (ar).
- **Presentation:** RTL for Arabic, CJK glyph language, furigana, word segmentation for zh and ja.
- **Voice:** TTS and speech-recognition locale (`TARGETS[x].tts`, 506-519).

### 2.3 Content actually served differs from repository seeds — PARTIALLY CONFIRMED

**What was observed.**
- The live French "Les Nombres" lesson showed **18 word cards**, and "Add all" added 18. The seed has **12** (`seed/content/fr/vocab.json`).
- The live French grammar lesson is titled "Present Tense -er verbs". Its example is "Je parle français avec mes amis tous les jours." and it has a "Common mistake" block.
- The seed section 0 is titled "Le présent des verbes en -er", has example "Nous parlons français et ils habitent à Paris.", and has no `common_mistake` field.
- Korean showed 40-word lessons, which matches the Korean seed.

**Why.** `GET /api/content/:lang/:tab` serves any existing `content_cache` row without validating it (`content.js:1579-1585`). The 18-word count matches the obsolete `buildVocabPrompt` target of 18 words (`content-10`).

**Inference.** Production French vocab and grammar are older AI-generated rows, not the curated seeds. The production rows themselves were **not read** (UNVERIFIED), per the safety rules.

**Consequences.**
- Content decisions and any stable-ID or progress mapping must be based on a read-only **snapshot of production `content_cache`**, not on the seed files.
- `validateContent` rejects those rows (≥30 words per category; ≥3 examples plus `common_mistake`). `generateMissingContent` re-queues them at boot and every 6h (`content.js:1519`, `server.js:46-53,96-101`). The live chat endpoint returned `error:"credits"`, which means generation is currently failing.
- **If AI credits are topped up before regeneration is frozen**, the loop will rewrite French, Spanish, German and Portuguese vocab (16 → 30 categories) and every grammar row. Index-based lesson IDs (`v3`, `g12`) would then silently point at different lessons for existing users (`content-2`, `content-3`).
- The mechanism is CONFIRMED in code. Production row contents are UNVERIFIED.

---

## 3. Confirmed duplication

| # | What is duplicated | Copies (evidence) | Drift observed | Label |
|---|---|---|---|---|
| D1 | Language registry | ~15 declarations (§2.1) | speaker counts, 10 vs 12 langs, 4 vs 7 tabs, 8 vs 12 native langs | CONFIRMED |
| D2 | Script/romanization rules | 8+ prompt strings in `content.js`, `claude.js:13-20`, `prewarm-content.js:127,185-191` | Hindi omitted in grammar (`:1098`) and cheatsheet (`:1117`) prompts | PARTIALLY CONFIRMED |
| D3 | SM-2 flashcard scheduler | web `2811-2826`; Android `FlashcardRepository.kt:78-106` (faithful port); iOS `Flashcard.swift:42-84` | iOS uses grades 1/3/4/5, changes ease on Again (2.5→1.96) and has no Easy bonus | CONFIRMED |
| D4 | Flashcard storage | `localStorage fc_cards_v2` (2781); iOS UserDefaults `tongue.flashcards.v1`; Android Room `flashcards` | three unsynced datasets, no server table | CONFIRMED |
| D5 | Analyzer / Word Space prompts | web 7488, 4877; iOS `AnalyzerViewModel.swift:59-66`, `WordSpaceViewModel.swift:55`; Android `AnalyzerViewModel.kt:99-114`, `WordSpaceViewModel.kt:94-118` | web asks for 4 examples, native for 3; Android hard-codes reference language "English" | CONFIRMED |
| D6 | "Break text into words" | `getBreakdown` 6002 `parts{s,r,m,role}`; WordSpace 4877 `literal_breakdown{word,meaning}`; TextAnalyzer 7489 `words{word,meaning,grammar,ref}` | three schemas, three prompts | CONFIRMED |
| D7 | Role-play | Coach `convo` exercise (3330, 3355) vs Conversation SSE (7153-7471, `/api/claude/chat`) | native Coach uses neither engine | CONFIRMED |
| D8 | Grammar renderers | `AITabContent` grammar (3980-4018) vs `GrammarLesson` (6155-6185) | `example_target_2` gets `knownRef` in one only | CONFIRMED |
| D9 | Vocab renderers | `AITabContent` vocab (4138-4151), `VocabLesson` (5958-5974), `WordOfDay` (5429-5440) + dead `VocabCard` (4268), `VocabWordsScreen` (5799) | example lines shown only where `ex` exists | CONFIRMED |
| D10 | Dialogue renderers | `Dialogues` (4449-4500, plain text) vs `DialogueLesson` (6199, with Break down) | "Break down" in Learn only | CONFIRMED |
| D11 | Content fetching | `useApiContent` 3791, `AITabContent` 3908 + inline retry 3945, `LearnPath` 6261-6263, Flashcards starter 5131, WordOfDay 5417 | different 503 copy; starter deck reads the wrong response shape (5134) | CONFIRMED |
| D12 | Navigation lists | TopBar PRIMARY/MENU (7725-7749); ExploreHome HELPERS/INTENTS/MORE (5451-5477); RESUMABLE (8146-8152); dead DesktopNav (7842-7871) | drills in DesktopNav PRIMARY only; Coach ×3 on mobile Home | CONFIRMED |
| D13 | Speech output | shared `say()` (335-356, rate 0.80, honours `activeVoice`) vs Conversation `speak()` (7199-7205, rate 0.9, ignores voice) | chosen voice ignored in Conversation, never persisted | PARTIALLY CONFIRMED (2 paths, not 3) |
| D14 | Session and access-code checks | `routes/auth.js:468-476` vs `routes/claude.js:87-104` | same nonce logic copied | CONFIRMED |
| D15 | Prices | `routes/stripe.js:15-16`, `app.js:198,205-206`, `routes/admin.js:85,340-341`, `utils/email.js:67`, `auth.js:213`, `support.js:20`, index.html 3289/4635/4652/6774, home/subscribe/faq | admin MRR counts admin-issued free codes as revenue | CONFIRMED |
| D16 | Design tokens | index.html `:root` (24-97) + `C` getter fallbacks (369-398), `brand.css:5-31`, `home.html:29-32`, `app.js:119`, `admin.js:242-252`, iOS `Theme.swift`, Android `Color.kt`, `capacitor.config.json` | `--bg` #F5F2EC vs #F6F1E8, `--text` #14121A vs #231C16, `C.bg` fallback #FAF7F2, `--blue` holds crimson | CONFIRMED |
| D17 | Email header markup | `routes/auth.js:201-206,315-319,399-404` vs `utils/email.js:24-29` (not exported) | — | CONFIRMED |
| D18 | Rate limiters | DB `checkIpRateLimit` (`db.js:282-306`), DB `checkRateLimit` (`claude.js:111-152`), in-memory Maps (`auth.js:364`, `support.js:5`) | Maps grow without bound and are per machine; none are atomic | CONFIRMED |
| D19 | Onboarding / settings | live `NewOnboarding` (6540) vs dead `OnboardingModal` (6796); live `SettingsOverlay` (6706) vs dead `SettingsPanel` (4581) | billing portal and account deletion exist only in the dead panel | CONFIRMED |

---

## 4. Confirmed structural problems

### 4.1 Platform safety (fix before anything else)

| ID | Finding | Evidence | Label |
|---|---|---|---|
| S1 | A rejected await in most async handlers crashes the only production machine. | `node_modules/express` 4.22.2; no error middleware; reproduced with exit code 1 | CONFIRMED |
| S2 | The test suite runs against the `.env` database (production), wipes `rate_limits`, leaves `test_*@tongue-test.invalid` users behind, and calls Anthropic and Resend for real. | `tests/smoke.test.js:5-6,19,41,55-59,77` | CONFIRMED (whether it has ever been run against production is UNVERIFIED) |
| S3 | No release phase, no health checks, and migration errors are swallowed. A boot failure in the base CREATE statements does exit with code 1. | `fly.toml`; `db.js:205-207,225-227`; `server.js:106-108` | PARTIALLY CONFIRMED |
| S4 | Cron runs in every web process with no lock. Scaling to N machines would send reminders N times. | `server.js:36-68`; `fly.toml:30` | CONFIRMED |
| S5 | `trust proxy` is never set. Every "per-IP" limiter keys on `req.ip`, which behind Fly is most likely the proxy address, so visitors share buckets. | `auth.js:86,155,238,281`; `admin.js:33` | PARTIALLY CONFIRMED (runtime `req.ip` not observed) |
| S6 | Content generation runs on the request path with no in-flight dedupe. An unguarded `JSON.parse` sits in an async handler. | `content.js:1581,1600-1601,1632` | CONFIRMED |

### 4.2 Security and billing

| ID | Finding | Evidence | Label |
|---|---|---|---|
| B1 | `POST /api/stripe/create-portal` has no auth and no rate limit. Any subscriber's email returns a live Billing Portal session URL. | `routes/stripe.js:59-80`; `app.js:79` | CONFIRMED |
| B2 | `POST /api/auth/signup` issues a 90-day session for any existing email that is not active-paid, with no proof of ownership. That token can call `DELETE /api/auth/account`, which cancels subscriptions and anonymises the user. | `auth.js:168-192,224-225,539-560` | CONFIRMED |
| B3 | Suspensions don't stick: signup, magic-link and Google flows force `status='active'`. `requireAuth` never checks status. | `auth.js:24-28,177-183,568-578`; `admin.js:180-190` | CONFIRMED |
| B4 | Stripe events are recorded before they are handled and the endpoint always returns 200. There is no transaction, so a mid-checkout DB failure leaves a paying customer with no code or subscription, and Stripe never retries. | `stripe.js:101-124,147-198` | CONFIRMED |
| B5 | Paid access is tied to rotating access codes. A renewal (`subscription_cycle`/`update`) deactivates every code. Paid JWTs then fail on the next Coach call with "Session expired", not the "renewed" banner. Magic-link and Google users recover automatically. | `stripe.js:234-238`; `auth.js:468-476`; `claude.js:87-104` | PARTIALLY CONFIRMED |
| B6 | The `paid_access_until` grace branch almost never decides access. The cancellation email promises access "until the end of the billing period" but is sent when codes are switched off. | `db.js:238-262`; `stripe.js:282-336` | PARTIALLY CONFIRMED |
| B7 | Checkout `success_url` is `/?checkout=success`. `/` serves `home.html`, which ignores the flag. | `stripe.js:39`; `app.js:239-247` | CONFIRMED (production `APP_URL` not inspected) |
| B8 | Admin uses one shared password with `!==` comparison. The token is accepted in `?token=`. Logout is client-only. Tracked `DEPLOY.md:44-45` contains an ADMIN_PASSWORD that **matches the local `.env`** and an 11-character JWT_SECRET fragment whose first 8 characters match the local `.env`. | `admin.js:20,41,606` | PARTIALLY CONFIRMED (whether production uses these values is UNVERIFIED; treat as compromised) |
| B9 | CSP is disabled, React is unpinned from unpkg with no SRI, and the bearer token plus a reusable access code sit in `localStorage`. | `app.js:25`; 19-20, 2882, 3148, 8053-8059 | CONFIRMED |
| B10 | The AI `language` field goes straight into the system prompt. `/api/claude` is a general prompt proxy: the browser writes every prompt, up to 6,000 characters. | `claude.js:23,63,163,172,216` | CONFIRMED |
| B11 | The AI quota check is not atomic (read, then update) and is charged before the upstream call. Outages still burn the free user's 5 per day. | `claude.js:137-152,185,291` | CONFIRMED |
| B12 | iOS push can never be delivered: iOS sends a raw APNs token, but the server only sends via FCM. | `PushManager.swift:41-44`; `utils/push.js:54-55` | CONFIRMED |

### 4.3 Product structure

| ID | Finding | Evidence | Label |
|---|---|---|---|
| P1 | There is no curriculum or lesson model on the server. Content is one JSON blob per `(lang, tab)` and items have no IDs. "Lessons" are array positions (`v3`, `g12`), and completion is stored in `localStorage`. | `db.js:111-117`; 5918-5935; 0 `id` fields across 84 seeds | CONFIRMED |
| P2 | The seed files fail the current validator: all 12 grammar seeds and the fr, es, de, pt vocab seeds are rejected. The "zero-AI" fallback therefore no longer exists for those tabs. | `content.js:1238-1240,1281`; validator run in a vm sandbox | CONFIRMED |
| P3 | There is no shared learner model. About 9 stores with separate key and ID schemes exist; see §6. | 2781, 4515, 4864, 5914, 2910, 5999, 8158 | CONFIRMED |
| P4 | Lessons are read-only views with two self-report completion buttons and no exercise. | 6207-6224 | CONFIRMED + CONFIRMED (live) |
| P5 | Practice features are disconnected islands. Coach (7 AI types), Conversation, Drills (reveal only), Review, Flashcards, Word Space, Analyzer and Breakdown record no attempts, correctness or mistakes. | 3359, 3620, 4405-4430, 7312, 7490 | CONFIRMED |
| P6 | No URL routing. Back leaves the app, refresh returns to Home, and there are no deep links. The push-tap handler clicks a selector (`[data-tab="0"]`) that exists nowhere. | 7953-7954, 8039, 281 | CONFIRMED + CONFIRMED (live) |
| P7 | State that depends on the session is read once at mount. After an in-session code, Google or free-signup login, onboarding is skipped, the free banner is missing and the server's level is ignored until reload. Only the magic-link path works around this. | 7985-7993, 8076-8097, 8033, 8179 | CONFIRMED |
| P8 | Level is collected in onboarding and ignored by curriculum, Coach and Drills. It is not cached after onboarding, and Home computes `levelText` but never renders it. | 6561-6570, 8087-8089, 5449 | CONFIRMED |
| P9 | Dead code: DesktopNav, GrammarScreen, OnboardingModal, HowToUseModal, SettingsPanel, ShareCardModal, ConjTable, Row, VocabCard, lpKindMark (~890 lines). Unreachable routes: `concept`, `vocabThemes`, `vocabWords`, `phrases` (~220 lines). | definition-only grep; 8256-8268 | PARTIALLY CONFIRMED (`grammar-full` is reachable via TodaysPractice 8309) |
| P10 | The settings redesign silently dropped features. Account deletion and the billing portal exist only in the dead `SettingsPanel` (4600, 4623). `faq.html:381` still points users to them. | 6706-6795 | CONFIRMED |
| P11 | Legacy leftovers: `scripts/prewarm-content.js` is broken (needs `better-sqlite3`, writes SQLite). Railway and Nixpacks configs remain. Empty root `app/` and `gradle/` directories exist (untracked). | `prewarm-content.js:19,22,34` | CONFIRMED |
| P12 | Docs contradict reality. README describes Railway + SQLite ("French Immersion"). `PROJECT_DOCUMENT.md` says "~4,500 lines". The native READMEs describe French as web-hard-coded. DEPLOY.md's Fly + Supabase description is broadly accurate. | `README.md:1,80,104`; `PROJECT_DOCUMENT.md:67`; `native/README.md:43` | PARTIALLY CONFIRMED |
| P13 | Reference content has no native-language dimension. All glosses are English, even for a Spanish speaker learning English, while the Coach writes explanations in the native language. | `db.js:116`; `content.js:1089,1148,1383`; `claude.js:34` | CONFIRMED |
| P14 | AI cost visibility has gaps. Opus generation (22k tokens) is never logged. Web `featureType` is NULL. Model IDs are hard-coded in 5 places. No prompt caching. | `content.js:1332-1366`; `claude.js:214,234-237,318,362`; `support.js:60` | CONFIRMED |

---

## 5. Current lesson architecture

### 5.1 How a "lesson" exists today — CONFIRMED

1. `LearnPath` (6249-6366) fetches three whole tab blobs in parallel: grammar, vocab and dialogues (6261-6263).
2. `buildUnits` (5918-5935) builds seven fixed units from array slices. The titles are English literals:
   - "Foundations — First Words" = `vocab.slice(0,3)`
   - "Grammar — First Rules" = sections where `level==="Beginner"`
   - "Everyday Words" = `vocab.slice(3,9)`
   - Intermediate grammar
   - "More Vocabulary" = `vocab.slice(9)`
   - Advanced grammar
   - "Real Conversations" = all dialogues
3. Lesson identity is `{id:"v"+i | "g"+i | "d"+i, kind, idx}` (5920-5922). It is a **position in the current blob**.
4. `LessonView` (6207-6224) renders one read-only item:
   - `VocabLesson` (5948-5983): a word grid with audio, "Break down" on `ex` when present, and "Add all to Flashcards".
   - `GrammarLesson` (6153-6188): rule, examples, common mistake, note.
   - `DialogueLesson` (6189-6205).
5. Completion is set by **two buttons** that write the same flag:
   - "Mark complete & continue" → `markDone`, which logs a streak (6218-6220, 6275).
   - "Mark done / ✓ Completed" → `toggle`, which can un-complete and logs no streak (6221, 6276).
6. Progress is `localStorage["learn_progress_"+lang]` = an array of those position IDs (5914-5916).

### 5.2 Consequences — CONFIRMED

- **There is no UNDERSTAND → HEAR → INSPECT → RECALL → PRODUCE → FEEDBACK sequence.** Nothing checks understanding before completion. Live, a lesson was completed without any interaction.
- **The curriculum is hard-coded in JavaScript, not described in content.** Roadmap milestones (`roadmap.json` `can[]`) are real can-do statements but are not linked to lessons. Roadmap has its own checkbox store (4515, 4553).
- **Onboarding level is ignored.** Everyone starts at "Foundations".
- **Any content regeneration, or a seed upgrade that resizes a tab, remaps completed lessons silently** (§2.3).
- **Practice and assessment capabilities exist, but outside lessons:**
  - Coach generates 7 AI exercise types and throws the feedback away (3297-3784).
  - Drills are reveal-only (4379-4445).
  - Flashcards has a real SM-2 scheduler (2811-2826).
  - Sentence breakdown is AI-only (5998-6009) and failed live with a 502.
- **Two useful concepts already exist in data:**
  - "Common mistake" is a field the renderer understands (4007, 6175). The seeds lack it, though AI-generated production rows may have it.
  - Cheatsheet notes carry real mistake content: `seed/content/fr/cheatsheet.json` "avoir faim / soif … uses avoir not être" (category "Faux Amis et Expressions").

### 5.3 What real content already supports the owner's example lesson — CONFIRMED (repo inspection)

| Needed in "Present tense: -er verbs, être & avoir" | Existing real source |
|---|---|
| Pattern and endings, être and avoir forms | `seed/content/fr/grammar.json` section 0 `rule` (lists -e/-es/-e/-ons/-ez/-ent and every être and avoir form); `routes/content.js:57` anchor (full parler paradigm) |
| Example sentences with translations | section 0 `example_target`, `example_target_2`, `example_ref` |
| Pronunciation note (silent endings) | section 0 `note` |
| "J'ai faim", not "Je suis faim" | `cheatsheet.json` Faux Amis item "avoir faim / soif" with note "uses avoir not être" |
| Recall and production prompts | `drills.json` items 0-2 ("'I am'" → je suis; "'We have'" → nous avons; "'They speak'" → ils parlent) |
| Related vocabulary | `vocab.json` "Les Verbes Courants": être, avoir, parler… |
| Structure selection | `structures.json` "Sujet + Verbe + Objet" (ex1 "Je mange une pomme.") |

The production French grammar row (§2.3) is a different, AI-generated version. The migration plan resolves which version is canonical before lessons are authored.

---

## 6. Current learner / progress architecture

### 6.1 Server-side learner state — CONFIRMED

| Data | Storage | Per language? | Read by clients? |
|---|---|---|---|
| level, goal, daily minutes, target language, onboarding flag | `users` columns (`db.js:51-63,183-187`) via `/api/auth/onboarding`, `/preferences` | no (one global value) | yes, via `/api/auth/validate` |
| streak | `streaks` (`db.js:103-109`), one row per user, UTC days (`routes/streaks.js:11,33`) | no | **no client reads it**; the 20:00 UTC push cron reads `last_practice` (`utils/push.js`) |
| push tokens | `push_tokens` | n/a | n/a |
| AI usage, analytics, content reports | `ai_usage_logs`, `analytics_events`, `content_reports` | partly | admin only |

No server table stores lessons, cards, reviews, attempts, mistakes, saved words, roadmap checks or native language (`platform-11`, PARTIALLY CONFIRMED: level and target language *do* sync).

### 6.2 Client-side stores (web) — CONFIRMED

| Key | Owner (line) | Shape | Language-scoped | Notes |
|---|---|---|---|---|
| `learn_progress_<lang>` | LearnPath 5914-5916 | `["v0","g12",…]` | yes | position IDs; not cleared on sign-out |
| `fc_cards_v2` | fcLoad/fcSave/fcAdd 2781-2809 | `[{id,lang,front,back,pronunciation,example,interval,repetitions,ease,next_review}]` | field `lang` | writes swallow quota errors (2787); `fcAdd` returns true even if the save failed (2807-2808) |
| `roadmap_<lang>` | Roadmap 4515, 4528 | `["<phase>-<milestone>"]` | yes | self-ticked, positional |
| `ws_saved` | WordSpace 4864, 4899, 4905 | `[{id,input,fr,ref,pronunciation,date}]` (max 100) | **no** | import stamps the current language (5117) |
| `streak_count/longest/total/last` | `_streak` 2906-2938 | ints + `toDateString()` | no | incremented by **any** successful AI call (2966-2967), flashcard rating (5091) and lesson completion (6275) |
| `tongue_last` | nav() 8157-8159 | `{view,label}` English label | no | drives the Home "Continue" card |
| `bd_<lang>_<hash>` | getBreakdown 5999-6007 | AI breakdown JSON | yes (not by native language) | unbounded, never evicted |
| `user_level`, `target_lang`, `native_lang`, `theme_choice`, `_dark` | App | strings | — | `user_level` not written after onboarding (6561-6570) |
| `auth_token`, `auth_expiry`, `auth_email`, `auth_plan`, `tongue_code`, `_new_login`, `_seen_onboard` | auth module 2863-2902, 3148 | strings | — | sign-out clears only auth keys and `tongue_code` (2898, 8345) |

### 6.3 Defects caused by this fragmentation

| Defect | Evidence | Label |
|---|---|---|
| Review shows every card as due/unseen, 0 upcoming, all languages. It reads `nextReview`, but cards store `next_review`. | 6484-6486, 6530 vs 2805, 2825 | CONFIRMED + CONFIRMED (live: Flashcards 17 due / 1 learned vs Review "18 due · 18 unseen · 0 upcoming"; Korean Review showed the French cards) |
| "Load starter deck" never adds cards: it reads `data.categories` instead of `data.content.categories`. | 5134 vs `content.js:1580-1596` | CONFIRMED |
| Word Space saves have no language; importing labels them with the active language. | 4889-4896, 5117 | CONFIRMED |
| Streak counts passive lookups (a Word Space typing pause) but not Drills or Roadmap. | 2966-2967, 4868-4879 | PARTIALLY CONFIRMED |
| A second account on the same browser inherits the first account's cards, progress, streak and onboarding flag. | 2898, 8345 | CONFIRMED |
| Progress does not follow the account. Native apps keep separate decks, and iOS schedules differently. | D3, D4 | CONFIRMED |
| Native apps never log practice, so native users with push tokens may get "you haven't practised" reminders on days they did. | `platform-12` | PARTIALLY CONFIRMED |

### 6.4 What can honestly be measured from existing data today

- **Can be measured:** lesson completion (self-reported), flashcard SM-2 state and review grades, activity days (with the caveat that they include passive AI calls), words added to flashcards, self-assessed level, target and native language.
- **Cannot be measured today:** attempts, correctness, repeated mistakes, time on task, mastery, pronunciation accuracy, known/unknown vocabulary, curriculum position beyond self-reported completion.

---

## 7. Current design-system / layout architecture

### 7.1 Tokens and theming — CONFIRMED

- **CSS custom properties** on `:root` (24-72) with a `.dark-theme` override (73-97). This is the right idea: warm neutrals, crimson `#C0153E` / pink `#FF5F7E` gradient, Fraunces + Instrument Sans, radii 16/24/11/pill.
- **`C` object** (369-398): 28 getters, each calling `getComputedStyle` on every access. There are about 1,280 `C.` references. Duplicate aliases exist (`blue`=accent, `card`=surf, `bdr`=line, `amber`=orange), and fallbacks disagree with `:root` (`C.bg` #FAF7F2 vs `--bg` #F5F2EC; `C.green` #22A06B vs #1E9962).
- **Accent themes** (`THEMES`, `LANG_THEME`, `applyAccent` 409-441) are good data-driven theming. However, they are applied in a post-render `useEffect` (8139-8141). Inline colours read through `C` during that render stay one change stale until something else re-renders (`client-shell-4`, PARTIALLY CONFIRMED).
- **Bypasses:**
  - 378 quoted hex literals; `#C0153E` appears 56 times.
  - SupportChat uses a hard-coded slate palette, so its header text is dark on the dark sheet in dark mode (8448-8492).
  - The login card is `#fff` (3178).
  - `meta theme-color` is fixed (line 8).
  - The logo is `<img src="/icon.svg">` with a baked-in gradient, so it cannot follow the theme.

  Claims: `client-shell-17`, CONFIRMED (live: Emerald theme left 9 visible crimson elements).
- **No type scale, spacing scale, tap-target token or reading-width token.** About 55 `fontSize` literals are ≤10px (8px dock label 5626; 9px section labels 5431, 5546, 5576, 5587, 5610).

### 7.2 Layout — CONFIRMED

- **Three shell modes from two unrelated breakpoints:**
  - JS `useDesktop` at ≥900 (2661-2671); an unused `useMobile` at ≤640 (2648).
  - CSS media queries at 480, 820 and 900 (98-223).
  - Result: at 820-899px the mobile JSX renders inside a 600px framed card. At ≥900 `.app-shell-in-stage` removes every width cap (197-207), and `#root` keeps `padding:32px 24px` from the ≥820 rule, which should overflow the viewport by about 64px (`client-shell-3`, derived from CSS, not rendered).
- **About 10 independent width owners:**
  - `WrappedScreen` 1240 (5400)
  - Flashcards 880 (5171)
  - appBody 520 (8213)
  - `.app-shell` 600
  - `.sheet` 560 (138)
  - Upgrade 380 (6769)
  - login 390 (3178)
  - Home, self-headed screens and onboarding: **none**. Live at 2000px, Home cards were 942px while other screens were capped at 1240.
- **Four header systems:** TopBar (desktop only, 7775), ExploreHome's own mobile header (5482-5500), `WrappedScreen` header (serif 22px, 5392-5397), and an inline `BackBtn` + 20px title inside 8 self-headed screens.
- **`WrappedScreen` body is a block, not a flex container** (5399-5400). Conversation's pinned composer therefore scrolls with the page (`client-shell-2`, derived statically).
- **Reading width is not controlled.** Live lesson text reached about 188 characters per line at 12.5px; Grammar, Phrases, Roadmap and Today reached 183-201.
- **Mobile navigation exists only on Home** (5623-5636; `has-bottom-dock` only when `view==="explore"`, 8100-8106). Every other mobile screen has only an icon-only `BackBtn` with no accessible name (5375-5385). CONFIRMED (live).
- **Overlays are hand-rolled per component.** None has `role="dialog"`, `aria-modal`, Escape handling or a focus trap. "Maybe later" is a `<span onClick>` (6785) (CONFIRMED live + code).
- **Remounting.** Every navigation remounts the screen: each view is a conditional branch and `key={view}` sits on the wrapper. On mount, `isDesktop` swaps `appBody`'s parent (8366-8380), which remounts the tree again. `_wodCache` (5411, commit `54aae37`) was added to survive that second remount.
- **i18n.** `t()` plus 12 fully keyed dictionaries (1013-2644) is sound, but:
  - `nav_learn` is missing in 11 languages.
  - About 100-140 English literals bypass `t()` (home stats, "Learn from the start", RESUMABLE labels persisted in `tongue_last`, TopBar "Explore" and "Upgrade").
  - About 48 defined keys are unused.
  - No `dir` or `lang` handling.

  Claims: `client-language-9`, `client-language-10`, `client-shell-12`.
- **Icons.** `Icon` injects `<i data-lucide>` and polls for the global `lucide` (40×75ms). `useLucide` rescans the whole document from 19 call sites (448-479).

---

## 8. Root causes of known UI inconsistencies

### 8.1 Root-cause map

| Symptom the owner sees | Root cause (not the symptom) | Evidence |
|---|---|---|
| Screens have different widths, paddings and headers | No application shell or `ContentColumn` primitive; each screen chooses its own container; two breakpoint systems | §7.2; 5388-5406, 5503, 6498, 8213 |
| Home is cluttered | Navigation lists hand-maintained in 3 live places + 1 dead place; Home used as the only mobile nav; no "next action" model to prioritise one thing | 5451-5477, 7725-7749, 8146-8152 |
| Mobile users get lost | Nav rendered inside the Home screen, not the shell; no URL history | 5623-5636, 8380, 7953-7954 |
| Colours ignore the chosen theme | Raw hex literals (no lint), static meta and logo, accent applied after render | 8, 444, 5485, 6510, 8227, 8492, 8139-8141 |
| Tiny text and small tap targets | No type-scale or tap-min tokens; shared primitives (PlayBtn, Tag, ExampleLine) built undersized, so every consumer inherits them | 2676-2685, 6137-6146, 5626 |
| Lines too long to read | No measure token; the 1240 cap is the only limit | 5400, 185-209 |
| "Patched instead of fixed" | Mount-only state (7985-7993) patched for magic link only (8033); remount churn patched with `_wodCache` (5411); login grey strip fixed for login only (`31d0cb8`); streak paid gate removed without updating the test (`ae35713`) | `client-shell-5`, `client-shell-7` |
| Same content looks and behaves differently on different screens | Duplicate renderers per content type (D8-D10) and duplicate fetchers (D11) | §3 |
| Numbers disagree between screens (Review vs Flashcards) | No single deck/stats module; each screen re-derives from raw `localStorage` | 5064, 5077, 6484-6486 |
| Mixed-language UI | Screens bypass `t()`; English labels persisted into storage (`tongue_last`) | 5460, 5510-5512, 8146-8158 |

### 8.2 Reproduced live defects and traced root causes — CONFIRMED (live)

| # | Defect (live) | Severity | Root cause | Class |
|---|---|---|---|---|
| L1 | Review counts wrong and cross-language | major | ReviewScreen written against a different card shape (`nextReview`) and never filters by `tLang` (6484-6486); no shared deck module; no schema check | architectural |
| L2 | All non-streaming AI features fail with 502 and say "check your connection" | critical | `routes/claude.js:221-224` maps any upstream error to a generic 502 with no credit detection; `askClaude` discards the body (2964); each screen writes its own "connection" copy (3338, 4882, 7493); WordSpace status ignores the error (4922); quota charged before the call (185) | architectural |
| L3 | Conversation stream is HTTP 200 carrying `error:"credits"`, shown as "offline for a moment" | major | SSE headers flushed before the upstream call (`claude.js:305-309`); soft copy for a persistent condition (326-332) | architectural |
| L4 | Browser Back does nothing inside the app | major | Navigation lives only in React state; no History API (7953-7954, 8153-8165) | architectural |
| L5 | Mobile nav only on Home; icon-only back arrow elsewhere | major | Dock lives inside ExploreHome (5623-5636); TopBar only on ≥900 (8369); DesktopNav dead (7840) | architectural |
| L6 | Word Space items are global and imported under the wrong language | major | `ws_saved` has no `lang`; import uses `tLang` (4887-4900, 5112-5123) | architectural |
| L7 | Progress exists only in `localStorage` | major | No server learner model or routes (`app.js:77-84`, `db.js:51-169`) | architectural |
| L8 | Two redundant completion buttons; no practice step | minor | Lesson = pointer into reference content; completion is self-report (6207-6225, 5918-5930) | architectural |
| L9 | Theme leaves crimson elements | minor | Brand hex used outside tokens; static meta and logo (§7.1) | architectural |
| L10 | Premium modal claims "All 12 languages" (free users already have them) | minor | No plan/entitlement definition; copy hand-written in many places (6766, 4650, 3268, `subscribe.html:9,179,199`); content route has no plan check (`content.js:1568`) | architectural |
| L11 | Upgrade "Maybe later" is a non-focusable span; no Escape | minor | No shared Dialog primitive (6768, 6785) | architectural |
| L12 | Home unbounded at 2000px while others cap at 1240 | minor | Home bypasses `WrappedScreen` (8235-8243, 5503) | architectural |
| L13 | ~188-character lines in lessons | minor | No measure token (5400) | architectural |
| L14 | 8-10px text; 14-22px tap targets on mobile | minor | No type or tap tokens; undersized primitives | architectural |
| L15 | Content refetched on every mount (64 requests in one session) | minor | No shared content store; remount on every nav; no Cache-Control or ETag (`content.js:1568-1605`) | architectural |
| L16 | Support chat returns 200 with an apology on upstream failure | minor | `routes/support.js:45-47,68-71` swallow errors into a fake answer; client ignores `res.ok` (8404-8423) | architectural |
| L17 | Dead per-language screens with fabricated stats in the bundle | minor | Redesign `ae35713` added new screens without deleting old ones; `LANGS_DATA` demo data (581, 589-594) | architectural |

**Observations from the live session:**
- Progress survived reload.
- No 401 or 402 responses appeared.
- The only console errors were the Babel >500KB note and the 502s.
- No horizontal overflow at 375, 1440 or 2000px.

None of the 17 defects is a one-line bug in isolation. Each one comes from a missing shared system. That is why earlier fixes (`54aae37`, `31d0cb8`, `ae35713`) each closed one symptom and left the pattern in place.

---

## 9. Systems worth preserving

| System | Why | Evidence |
|---|---|---|
| Single content API `/api/content/:lang/:tab` with `VALID_LANGS`/`VALID_TABS` validation; seed-first serving | Already "languages as data" on the server | `content.js:1568-1607` |
| Curated per-language content (22 grammar / 12 cheatsheet / 16 structures / 30 vocab anchors / 6 dialogues / 20 drills / 5 roadmap phases) | Real, language-specific pedagogy (cases, aspect, particles, tones, ergative ने) | `content.js:55-1077`; `seed/content/*` (84 files) |
| `validateContent` + `scripts/validate_seed.js` | Basis of a content CI gate, once versioned | `content.js:1214-1328` |
| Server-owned conversation scenarios, levels and recasting prompt; SSE streaming with history capping | The right model for every AI feature | `claude.js:42-84,266-370`; client `streamChat` 2973-3018 |
| `content_reports` feedback loop | Accuracy reporting | `content.js:1661+` |
| Magic-link design (hashed, single-use atomic claim, 15-min TTL, no enumeration) | Correct security design | `auth.js:280-362`; `db.js:167-176` |
| `issueSessionForEmail` as the single identity-to-session point | Extend it rather than keep parallel paths | `auth.js:24-60` |
| Stripe signature verification with raw-body mount; `stripe_events` dedupe table | Fix the ordering, keep the mechanism | `app.js:53`; `stripe.js:94` |
| DB-backed IP limiter pattern (once atomic and proxy-aware) | Survives restarts and multiple machines | `db.js:282-306` |
| `app.js`/`server.js` split | Lets tests import the app without cron | `app.js`, `server.js` |
| Email fallback chain that never throws and logs outcomes | Resilient delivery | `utils/email.js:38-187` |
| `/health` with DB check | Needs to be wired into Fly checks | `app.js:57-65` |
| CSS custom-property tokens + accent-theme data | Right basis for one design system (fix how it's applied) | 24-97, 409-441 |
| `t()` with full 12-language key parity | Sound i18n core | 1013-2644 |
| SM-2 algorithm (web/Android version) and `fcAdd` dedupe by lang+front | Core of one review engine | 2790-2827 |
| `getBreakdown` / `SentenceExplorer` / `ExampleLine` interaction | Language-agnostic "tap to inspect" concept | 5989-6151 |
| `useApiContent` + `ContentLoader` | One loading/error pattern to generalise | 3791-3838 |
| `LearnPath` idea (course assembled from shared content), `ProgressRing`, `LESSON_KIND` config | Correct direction, wrong identity model | 6226-6366 |
| Real `SOUNDS_BY_LANG` / `FACTS_BY_LANG` / `CULTURE_BY_LANG` content | Real content; move into the content pipeline | 765-956 |
| Native networking and auth storage (typed endpoints, Keychain, SecureAuthStore); native content models matching `SCHEMA.md` | Clean if native continues | `Endpoint.swift`, `ContentModels.swift`, `ReferenceModels.kt` |

---

## 10. Systems requiring refactor

| System | Refactor | Why |
|---|---|---|
| Express error handling | Async wrapper or Express 5; final JSON error middleware; `unhandledRejection` logging; body validation (Zod) on every route | S1 |
| Rate limiting | Atomic single-statement `INSERT … ON CONFLICT … RETURNING`; `trust proxy` / `Fly-Client-IP`; charge AI quota only on success; replace in-memory Maps | S5, B11, D18 |
| Stripe integration | Authenticated portal (JWT → own customer); `client_reference_id`; process in a transaction *then* record the event, returning 5xx on failure; `success_url` → `/app` | B1, B4, B7 |
| Admin auth | `timingSafeEqual`; header-only token; server logout; per-admin identity + audit (full replacement in §11) | B8 |
| Schema management | Versioned migrations that fail loudly; Fly `release_command`; drop duplicate indexes (`db.js:211-222`) | S3 |
| Cron | Single leader via `pg_try_advisory_lock`, or a separate process group; prune `magic_links` and old analytics | S4 |
| Content pipeline | Anchors moved out of `routes/content.js` into data; one schema used by SCHEMA.md, prompts and validator; **stable item IDs**; versioned validator; generation moved off the request path with a lock and a freeze flag; no automatic overwrite of reviewed content | P1, P2, S6, §2.3 |
| Flashcard/SRS logic | One deck module; server-authoritative state; shared golden vectors for any client implementation | D3, D4, L1 |
| i18n | Per-locale files; remaining literals through `t()`; `nav_learn`; `dir` and `lang` attributes; picker driven by the 12-code registry | §7.2 |
| Theming | Accent applied synchronously via data attributes plus CSS; `meta theme-color` and inline SVG brand mark follow the theme; remove the `C` getter layer | L9 |
| Content renderers | One renderer per content item type (GrammarPoint, WordTile, DialogueLine, StructurePattern) shared by Library and lessons | D8-D10 |
| Speech | One `SpeechService` (`speak(text,{lang,rate})`, persisted per-language voice, recognition wrapper) | D13 |
| Email/SEO/admin rendering | Shared token output; shared email header; SEO pages generated from the registry | D16, D17 |
| Native apps (if kept) | Point at `tongue-app.fly.dev`; remove the French gate; consume registry and sync APIs; contract tests | §1.4 |

---

## 11. Systems requiring replacement

| Replace | With | Why |
|---|---|---|
| In-browser Babel single file, unpinned unpkg scripts, CSP off | Vite + React + TypeScript build; hashed, cacheable bundles; self-hosted pinned vendors; real CSP | §1.3, B9 |
| `useState(view)` + conditional chain + `key={view}` | URL router (History API) with deep links, working Back and scroll restoration | P6, L4 |
| `LANGS_DATA` (3 hand-authored + 9 stubs) and ~15 language registries | One Language Registry (LanguagePack + capabilities), served to every client; facts, sounds and culture moved into content | §2 |
| Blob-per-tab + index-based `buildUnits` course | Curriculum model (course → stage → unit → lesson) with stable content IDs | P1, §5 |
| Read-only `LessonView` with self-report buttons | Lesson Engine: typed blocks, deterministic exercises, feedback, natural completion | P4, L8 |
| Nine `localStorage` learner stores, write-only server streak, three unsynced SRS copies | Server Learner Model (event log + projections) with local cache/outbox and a no-loss import | P3, L7 |
| `ReviewScreen` hub, Drills reveal-only, TodaysPractice weekday table | Review queue from learner state; graded drills in the practice engine; deterministic Today planner | L1, P5 |
| Generic client-authored `/api/claude` prompt proxy; per-feature AI error copy | Server-defined AI features with typed I/O, one AI gateway, typed error contract, availability signal | B10, L2, L3, L16 |
| Access-code-based entitlement (rotating codes log users out) | Entitlements derived from subscriptions and admin grants; codes only as redemption | B5, B6 *(owner decision required: see MIGRATION_PLAN decision gates)* |
| Unverified `/api/auth/signup` for existing emails | Verified (magic link / Google) access for existing accounts | B2 *(decision gate)* |
| Shared-password admin with URL token | Per-admin accounts (ADMIN_EMAILS + magic link), header tokens, audit log | B8 |
| Hand-rolled overlays, four header systems, per-screen widths | Application shell + primitives (Dialog, Sheet, PageHeader, ContentColumn, Toast, states) | §7 |
| `tests/smoke.test.js` against `.env` DB | Isolated test DB with a hard production-host refusal; unit/contract/integration/E2E layers; CI | S2 |
| Dead code: DesktopNav, GrammarScreen, OnboardingModal, HowToUseModal, SettingsPanel (after restoring billing + deletion into Settings), ShareCardModal, ConjTable, Row, VocabCard, lpKindMark, unreachable concept/vocabThemes/vocabWords/phrases routes, Capacitor bootstrap, `prewarm-content.js`, Railway/Nixpacks configs, empty `app/` and `gradle/` | Deletion (after confirming unused; each listed above is confirmed unreferenced) | P9, P11 |

---

## 12. Target architecture (summary)

Full specification: [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md).

- **One Tongue Core.** Language Registry, Content & Curriculum, Lesson Engine, Practice/Review (SRS), Vocabulary, Grammar, Sentence Breakdown, Analysis, Coach (AI gateway), Speech/Pronunciation, Learner Model, Progress/Planner, and the Application Shell. A language is a **LanguagePack** (identity, locales, scripts, direction, romanization, declared capabilities) plus content plus a curriculum. Capabilities such as `grammaticalGender`, `verbConjugation`, `tones`, `furigana` and `rtl` extend the shared systems. No per-language application code.
- **Web.** Vite + React + TypeScript with `shared/` Zod schemas used by server and web. A URL router (`/app/:lang/today|learn|practice|coach|library/...`). One AppShell with brand tokens (crimson/pink, warm cream, Fraunces + Instrument Sans).
- **Navigation.** TODAY / LEARN / PRACTICE / COACH / LIBRARY. Every existing feature is mapped to one of these, and dead or fabricated screens are removed.
- **Lessons.** Typed blocks in the UNDERSTAND → HEAR → INSPECT → RECALL → PRODUCE → FEEDBACK → COMPLETE sequence. Exercises are derived deterministically from real content, with provenance references and a "forms must occur in source text" guard. Human-reviewed annotations are allowed only where structure is missing.
- **Learner Model.** An append-only `learning_events` table plus projections (`lesson_progress`, `srs_cards`, `user_vocabulary`, `concept_stats`, `activity_days`) via additive, versioned migrations. A no-data-loss import of every `localStorage` store keeps raw payloads.

## 13. Migration plan (summary)

Full plan: [MIGRATION_PLAN.md](./MIGRATION_PLAN.md).

The owner's 12 phases are kept but **re-ordered where dependencies require it**. Every phase ships behind flags with rollback.

- **P0 (inserted):** a safety net and production stabilisation (test isolation, crash handling, content regeneration freeze, critical security fixes that need no decision) must come first. Nothing else can be verified safely without it.
- **Build extraction** (in-browser Babel → Vite with behaviour parity) is split out of phase 1, because shell and primitives cannot be built inside an 8,500-line inline script.
- **The learner-model foundation moves before TODAY.** TODAY "must use real learner state" and LEARN progress must survive navigation and devices. The owner's phase 10 remains the phase that connects the remaining producers (Coach, analysis, speaking) and mastery.
- **Decision gates** (owner input required, see the returned list): canonical content source, account-status semantics, entitlement model, signup verification, secret rotation, production test residue cleanup, retiring `tonge-app.fly.dev`.

---

## Appendix A: Live verification session (2026-09-14, https://tongue-app.fly.dev/app, free account)

| Flow | Result | Key observation |
|---|---|---|
| 1 Progress persistence | pass | `learn_progress_fr=["v0"]` survived reload; only network call was `POST /api/streaks/log` |
| 2 Completion controls | partial | "Mark complete & continue" (1088×44) and "Mark done" (106×44) side by side; no exercise |
| 3 Flashcards | fail | 18 added; Flashcards 17 due / 1 learned after "Good"; Review "18 cards due · 18 unseen · 0 upcoming" |
| 4 Sentence breakdown | fail | `POST /api/claude` → 502 `{"error":"the tutor error. Please try again in a moment."}` |
| 5 Language switching | partial | Korean course separate (0 of 58); Review in Korean listed French cards; `ws_saved` and `tongue_last` global |
| 6 Theme | partial | `--accent` → #199B63, but 9 elements still rgb(192,21,62); `meta theme-color` unchanged |
| 7 AI without credits | fail | Coach, Word Space, Analyze → 502; Conversation 200 + SSE `error:"credits"`; Support 200 + apology |
| 8 Every view renders | partial | no crash; Drills reveal-only; Flashcards empty state shows "deck is empty" and "All caught up!" together; Premium modal claims "All 12 languages" |
| 9 Browser back | fail | `history.length` stayed 2; URL stayed `/app` |
| 10 Layout 375/1440/2000 | partial | no horizontal overflow; Home cards 942px at 2000; lesson ~188 CPL; 8-10px labels; 14-22px tap targets |

**Network failures:** `POST /api/claude` → 502 ×4; `POST /api/claude/chat` → 200 with in-band `credits` error; `POST /api/support` → 200 with fallback apology.
**Console:** Babel ">500KB" deoptimisation note on every load; four 502 resource errors.

## Appendix B: Evidence index (by audit claim ID)

| Area | Claim IDs → sections |
|---|---|
| platform | `platform-1` B1 · `-2` B2 · `-3` S1 · `-4` S5 · `-5` B3 · `-6` B6 · `-7` B5 · `-8` B4 · `-9` B7 · `-10` S2 · `-11` §6.1 · `-12` §6.1/§6.3 · `-13` D1 · `-14` B8 · `-15` S4 · `-16` S3 · `-17` D15 · `-18` D16/D17 · `-19` D18 · `-20` P11 · `-21` B11 |
| content | `content-1` P2 · `-2` §2.3 · `-3` P1 · `-4` §2.1 · `-5` D1/D2 · `-6` P13 · `-7` §2.1(6) · `-8` B10 · `-9` B11 · `-10` P11 · `-11` S6 · `-12` P14 · `-13` §2.1(3-4) · `-14` §1.5 · `-15` §2.1(7) |
| client-language | `-1` §2.1 · `-2` P9 · `-3` §2.1(2) · `-4` Sounds count · `-5` D1 · `-6` §2.1(3) · `-7` D13 · `-8` §7.2 · `-9` §7.2 · `-10` §7.2 · `-11` §2.1(7) · `-12` P9 · `-13` D11 |
| client-shell | `-1` §7.2 · `-2` §7.2 · `-3` §7.2 · `-4` §7.1 · `-5` P7 · `-6` P6 · `-7` §7.2 · `-8` P9 · `-9` §2.1(2) · `-10` §2.1(3) · `-11` §7.2 · `-12` §7.2 · `-13` §6.3 · `-14` B9 · `-15` §1.3 · `-16` §6.2 · `-17` §7.1 · `-18` D12 · `-19` §1.3 |
| client-features | `-1` L1 · `-2` §6.3 · `-3` P3 · `-4` §5 · `-5` D8-D10 · `-6` D6/D7 · `-7` P9 · `-8` P10 · `-9` L6 · `-10` §6.3 · `-11` B11 · `-12` §2.1(6) · `-13` P8 · `-14` D12 · `-15` §2.1(3) · `-16` §6.2 · `-17` D11 · `-18` §7.1 · `-19` §1.5 · `-20` D3 |
| native-and-secondary | `-1` §1.4 · `-2` §2.1(5) · `-3` D3 · `-4` D5 · `-5` D7 · `-6` B12 · `-7` P11 · `-8` D16 · `-9` D1 · `-10` §17 of target · `-11` §1.4 · `-12` admin Preview 401 (`admin-content.html:211,455` vs `content.js:1568`) · `-13` P12 · `-14` §1.5 |
| quality | `-1` S2 · `-2` S1 · `-3` §1.5 · `-4` §1.3 · `-5` B9 · `-6` S3 · `-7` silent catches (72 in index.html, e.g. 2787, 5916, 6261-6263) · `-8` timing patches (455-457, 2889, 7205) · `-9` B8/B11 · `-10` caching (§A) · `-11` D1/D15 · `-12` P11 |

Additional confirmed details not repeated above:
- **Sounds header count.** It shows `soundCount` 36/30/46 for fr, es and ja, but only 6 cards exist for each (6377; 551, 623, 693).
- **Admin content Preview always renders empty.** It sends only `x-admin-token` to a Bearer-JWT route (`admin-content.html:211,455`).
- **The service worker keeps a constant cache name.** `CACHE_NAME "tongue-v2"` never changes, and unpkg files are cached cache-first (`public/sw.js`).
- **`/app` caching is fine.** It is served with `max-age=0` plus an ETag, and production `/app` is byte-identical to the local file (563,727 bytes). Stale UI is therefore not HTTP caching; the real gap is that there is no build version to detect stale clients.

## Appendix C: Unverified items (require owner or production access)

1. Contents of production `content_cache` rows (French is inferred to be AI-generated, from live counts and titles).
2. Which Fly secrets are set (`EMAIL_FROM` with a verified domain, `SMTP_*`, `GOOGLE_CLIENT_ID`, `FIREBASE_*`), and whether production `JWT_SECRET` / `ADMIN_PASSWORD` equal the values in `DEPLOY.md`.
3. Runtime `req.ip` on Fly without `trust proxy`.
4. Production restart counts, which would show whether S1 has already caused outages.
5. Whether `npm test` was ever run against production (`test_*@tongue-test.invalid` rows; wiped `rate_limits`).
6. Which `DATABASE_URL` the still-running `tonge-app.fly.dev` uses. If it is production, it duplicates cron (reminders, regeneration).
7. Subscribers with a `stripe_events` row but no active code or subscription (B4 victims).
8. Whether the #root ≥900px overflow and Conversation composer pinning reproduce in a real logged-in browser (derived from CSS and JSX only).

## Appendix D: Hypotheses that turned out to be wrong or narrower than suspected

- "Each language has its own implementation": **not true** on the server or in the reachable web screens (§2.1).
- "HTTP caching serves stale UI": **not true** for `/app` (`max-age=0` + ETag, network-first service worker). The gap is having no build version.
- "`key={view}` causes the state loss": **narrower**. The conditional branches unmount screens anyway; the `isDesktop` parent swap is a second remount trigger.
- "Hindi omitted in 4 prompts": only the live grammar and cheatsheet prompts omit it; the others are generic or dead.
- "About 1,100 dead lines": about 890 lines of never-rendered components plus about 220 lines of unreachable routed screens.
- "`grammar-full` unreachable": **reachable** via TodaysPractice's `tabMap` (8309).
- "Native apps can't be built": they need standard setup (`xcodegen`, Gradle wrapper jar), but nothing blocks a build.
- "Supabase is abandoned": **not true**. The local `DATABASE_URL` host is Supabase; DEPLOY.md's Fly + Supabase stack is broadly accurate.
- "The shallow French seed is what users see": **not true** (§2.3). The shallow seeds fail validation and are not served; French users see older AI-generated cache rows.
