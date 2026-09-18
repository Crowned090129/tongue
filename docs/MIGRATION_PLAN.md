# Tongue: Migration Plan

**Date:** 2026-09-14
**Inputs:** [ARCHITECTURE_FORENSICS.md](./ARCHITECTURE_FORENSICS.md) (finding IDs such as S1, B4 and L2 refer to it) and [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) (§ references point to it).

---

## 0. Ground rules for every phase

1. **Shippable on its own.** Every phase can go to production by itself. New behaviour ships behind a server-read flag (`FLAGS` env or an `app_flags` table) with a documented default and a documented off-switch.
2. **Schema changes are additive, versioned and loud.** Only `server/migrations/NNN_*.sql` through `release_command` may change the schema. The allowed operations are `CREATE TABLE`, `ADD COLUMN` and `CREATE INDEX` (all `IF NOT EXISTS`). No `DROP`, `RENAME` or type change is allowed without an owner decision. A failed migration aborts the deploy.
3. **Protect user data.**
   - Before any production data migration, the owner takes a database backup (`pg_dump` or the provider's point-in-time restore). A migration that has not been rehearsed on staging does not run.
   - Legacy data (browser `localStorage` keys, `streaks`, `content_cache` rows) is never deleted by this programme. Cleanup is a separate, owner-approved step.
4. **Tests never touch production.** From P0 onward every test uses `TEST_DATABASE_URL` behind the hard guard (target §17.1). Production verification after a deploy is read-only (`/health`, `/api/version`, `GET /app`), plus manual flows run with an owner-controlled account.
5. **Environments.**
   - Local: Postgres in Docker.
   - Staging: a new Fly app `tongue-app-staging` with its own new database. It holds no production data unless the owner explicitly approves a sanitised copy.
   - Production: `tongue-app`.
6. **Bug policy.** Every bug is reproduced, traced, root-caused and fixed at the shared system. The fix ships with a regression test and is re-verified in the UI. No `setTimeout` workarounds, no swallowed errors.
7. **Rollback in every phase.** Each phase has (a) a flag that turns the new behaviour off, and (b) a redeploy of the previous image with `fly deploy --image registry.fly.io/tongue-app:<previous>`. Additive migrations stay in place, and the old code ignores the new tables.
8. **Record every change.** Each phase appends to `CHANGELOG.md`, updates these documents where reality differs from plan, and records the manual verification (who, when, which flows, which viewport) in `docs/verification/<phase>.md`.

---

## 1. Why the order differs from the default 12 phases

| Change | Dependency that forces it |
|---|---|
| **P0 inserted: safety net and stabilisation** | The only test suite runs against the `.env` database, which is production (S2). A rejected database call crashes the only machine (S1). Once AI credits return, content regeneration will rewrite rows that users' progress depends on (§2.3). The billing portal is open (B1). Nothing else can be verified or deployed safely until these are fixed. |
| **Owner phase 1 split into P1 (build extraction) and P2 (registry and content identity)** | The shell, primitives and TypeScript cannot be built inside an 8,500-line in-browser Babel script. Stable content IDs are needed before any progress can be migrated. |
| **Learner-model foundation (from owner phase 10) moved to P4, before Today** | Today "must use real learner state" and Learn progress "must survive navigation". Both need server learner state and the import of legacy progress. Owner phase 10 continues as P12, which connects the remaining producers (Coach, analysis, speaking) and mastery. |
| **Today (P5) comes before Learn (P6) but reads from a Planner, not from Learn internals** | Keeps the owner's order. Today v1 uses the migrated legacy progress. Today v2 (P12) uses concept statistics and mistakes. |
| **Owner phases 11 and 12 are kept, but responsive design, accessibility and tests are exit criteria in every phase** | Primitives are accessible from P3 onward. P13 and P14 are the final audit and release, not the first time these concerns appear. |

### Dependency graph

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─▶ P6 ─▶ P7 ─▶ P8 ─▶ P9 ─▶ P10 ─▶ P11 ─▶ P12 ─▶ P13 ─▶ P14
            │           │                  └──────────▶ P9 (review items need engine events)
            │           └──▶ native decision point (after P4 sync APIs exist)
            └──▶ G1 (canonical content) must be decided inside P2
```

### Mapping to the owner's phases

| Owner phase | Plan phase |
|---|---|
| 1 Architecture cleanup + shared languages | P1 + P2 |
| 2 Tokens + shell + navigation | P3 |
| 3 Today | P5 (v1), P12 (v2) |
| 4 Learn | P6 |
| 5 Generic lesson engine | P7 |
| 6 French lesson content in the engine | P8 |
| 7 Practice/review integration | P9 |
| 8 Analyze workspace | P10 |
| 9 Coach context | P11 |
| 10 Learner-state connections | P4 (foundation) + P12 (completion) |
| 11 Responsive/accessibility/polish | P13 (plus exit criteria in every phase) |
| 12 Regression + E2E verification | P14 (plus tests in every phase) |

---

## 2. Decision gates (owner input required before the dependent step)

Each gate protects user data or paying users. Work that does not depend on a gate goes ahead.

| Gate | Decision | Blocks | Safe default until decided |
|---|---|---|---|
| **G1** | Canonical content. Production `content_cache` is inferred to be older AI-generated rows (forensics §2.3). The repository seeds are the alternative. | P2 content IDs; all progress mapping | Regeneration frozen (P0). Production content is served unchanged. |
| **G2** | Account-status semantics. `status='cancelled'` is written both by admins and by the Stripe `subscription.deleted` webhook (B3, B6). Enforcing status in `requireAuth` could lock out former subscribers who are now on the free plan. | P0-B3 enforcement step | Only stop the upserts that force `status='active'` for `suspended` users. No new lockouts. |
| **G3** | Entitlement model: codes → subscriptions plus admin grants (B5). Codes issued by admins with no Stripe subscription could lose access. | Entitlements work (P11) | Keep code-based access. Fix the renewal logout by stopping code deactivation on `subscription_cycle` (see P0). |
| **G4** | Require verification (magic link or Google) for existing emails on `/api/auth/signup` (B2). If production email delivery is broken (UNVERIFIED), free users would be locked out. | P0-B2 | Rate-limit and log `/signup` reuse. Do not block. |
| **G5** | Secret rotation. The `ADMIN_PASSWORD` in tracked `DEPLOY.md` matches the local `.env`, and the `JWT_SECRET` prefix matches (B8). Rotating `JWT_SECRET` signs out every user. Rewriting git history is destructive. | P0 security | Rotate `ADMIN_PASSWORD` immediately (no user impact). Remove the values from `DEPLOY.md` in the working tree. |
| **G6** | Cleaning test residue from production (`test_*@tongue-test.invalid` users, if present). This deletes production rows. | P0 ops | Count only, read-only. No deletion. |
| **G7** | Retiring `tonge-app.fly.dev`. It is a live older build. If it shares the production database it duplicates cron jobs (reminders, regeneration). | P0 ops / native | Scale it to zero only after confirming its `DATABASE_URL`. Never destroy it without a decision. |

---

## 3. Phases

### P0: Safety net and production stabilisation

**Goal:** make it safe to change, test and deploy, and stop active harm.

**Scope:**

- **Tests**
  - `tests/support/assertTestDatabase.ts` (target §17.1).
  - `.env.test` and `tests/compose.yml` (Postgres 16).
  - Remove `require("dotenv").config()` from tests.
  - Fix the stale streaks assertion (`tests/smoke.test.js:213-222`).
  - Stub Anthropic, Resend and Stripe.
  - CI workflow: install → test with a Postgres service.
- **Crash-proof server (S1)**
  - `asyncHandler` wrapper on every route in `routes/*.js`.
  - Final JSON error middleware in `app.js`.
  - `process.on("unhandledRejection")` logging in `server.js`.
  - Zod validation on `auth`, `stripe`, `claude`, `content/report`, `push` and `support` bodies (the `{"email":1}` case).
- **Content freeze (§2.3)**
  - `CONTENT_AUTOGEN=off` disables boot-time `generateMissingContent` (`server.js:96-101`), the 6-hour cron (`server.js:46-53`) and on-demand generation (`routes/content.js:1600-1601`, which then returns 503 with an honest message).
  - Guard `JSON.parse` at `content.js:1581`.
  - The owner runs a **read-only** export script (`scripts/export-content-snapshot.js`, SELECT only) that writes production `content_cache` to a local folder for G1.
- **Security fixes that need no decision**
  - B1: `create-portal` requires `requireAuth` and uses the caller's own `stripe_customer_id`.
  - B4: the webhook handles the event in a transaction, then inserts into `stripe_events`, and returns 500 on failure so Stripe retries.
  - B7: `success_url` → `/app?checkout=success`.
  - B10: validate `language` and `nativeLang` against `VALID_LANGS`.
  - B8: `crypto.timingSafeEqual`, remove `req.query.token`, add server-side admin logout.
  - S5: `app.set("trust proxy", 1)` or read `Fly-Client-IP`.
  - B11 and D18: atomic limiters; charge the AI quota after success.
  - B5 interim (no entitlement change): stop deactivating codes on `invoice.payment_succeeded` renewals. Extend `expires_at` and keep the code, so paying users are no longer logged out.
  - B3 partial (G2-safe): signup, magic-link and Google upserts no longer reset `status='suspended'` to active.
- **AI honesty (L2, L3, L16)**
  - Classify upstream errors in `routes/claude.js` and `routes/support.js` (credits/unconfigured → 503 `{code}`).
  - The SSE route opens upstream before flushing headers.
  - In legacy `public/index.html`, `askClaude` and `streamChat` parse `{code}`, and one shared `aiErrorMessage(code)` replaces the per-screen "check your connection" strings (3338, 4882, 7493, 6052, 8404-8423). WordSpace status stops showing "Auto-translating…" on error (4922).
- **Delivery**
  - `fly.toml` gets `[[http_service.checks]]` on `/health`.
  - Dockerfile uses a pinned `node:20.20.2-alpine`, `npm ci --omit=dev` and `USER node`.
  - Cron jobs take `pg_try_advisory_lock`.
  - Create `tongue-app-staging` with its own database.
- **Owner read-only operations (inputs to the gates):**
  - Fly restart count.
  - `tonge-app` `DATABASE_URL` host (G7).
  - Count of `test_*@tongue-test.invalid` rows (G6).
  - Send one magic link to the owner to confirm production email delivery (G4).
  - Rotate `ADMIN_PASSWORD` (G5).

**Deliverables:** guarded test harness plus CI; crash-proof server; content freeze and snapshot; the security fixes above; honest AI failure states; health checks; staging app; `docs/verification/P0.md`.

**Verification:**

- **Automated (test DB):**
  - A malformed body returns 400 and the process stays alive (regression for S1).
  - `create-portal` without a token → 401; with a token → only the caller's own customer.
  - Webhook handler failure → 500, then the retry processes exactly once.
  - Renewal webhook keeps the code active.
  - Fake credits error → 503 `ai_unavailable_credits`, and the quota is not charged.
  - The guard refuses a non-local `TEST_DATABASE_URL`.
  - The limiter stays within its limit under 20 concurrent requests.
- **Manual (staging, then production):**
  - Forensics live flows 1-10 still behave as before, except that the AI screens show the honest unavailable message.
  - Production logs show `CONTENT_AUTOGEN=off` at boot.
  - The Fly health check passes.

**Data safety:** no schema change. The content freeze stops overwrites. The snapshot is taken before any content work. Webhook handling becomes stricter, but no rows are removed.

**Rollback:** redeploy the previous image. The flags `CONTENT_AUTOGEN` and `AI_ERROR_CONTRACT` revert behaviour.

**Exit criteria:**

- `npm test` is green locally and in CI against the test database only.
- No known crash path remains.
- Regeneration is frozen in production.
- A production content snapshot exists.
- B1, B4, B7, B8 (code part), B10 and B11 are fixed.
- Gate inputs G1-G7 have been collected.

DoD: "relevant automated tests pass", "no unexplained console errors" (AI path).

---

### P1: Build and module extraction (behaviour parity), dead-code removal

**Goal:** leave in-browser Babel with **no user-visible change**, and remove code confirmed to be unused.

**Scope:**

- **Build setup:** `web/` (Vite + React 18.3.1 + TypeScript config), `shared/` scaffold, `design/` scaffold.
- **Extraction:** move `public/index.html` lines 315-8503 verbatim into `web/src/legacy/LegacyApp.jsx`, and the `<style>` block into `legacy.css`. Import lucide 0.454.0 from npm and add the `window.lucide` shim. Add a `WEB_CLIENT=vite|legacy` switch in `app.js`, and keep `public/index.html` untouched for two releases.
- **Caching and versioning:** `/assets` immutable; `/app*` `no-cache`; `/api/version` plus the build meta tag; a service worker whose cache name is derived from the build ID (no CDN caching), with a kill-switch service worker available; CSP in Report-Only mode.
- **Docker and Fly:** multi-stage Dockerfile (target §14.5). Update `.dockerignore`.
- **Lint and typecheck:** ESLint, stylelint and `tsc`, applied to new code only. The legacy folder is excluded from rules except parse checks.
- **Keep existing functionality before deleting anything:** port the billing portal button (now authenticated) and "Delete account" from the dead `SettingsPanel` (4581-4736) into the live `SettingsOverlay` (6706). Settings lists all 12 native languages from `SUPPORTED` (495).
- **Delete** (each confirmed unreferenced in forensics P9/P11):
  - Components: `DesktopNav` (7840), `GrammarScreen` (5642), `OnboardingModal` (6796), `HowToUseModal` (6997), `ShareCardModal` (7590), `SettingsPanel` (4581, after the port above), `VocabCard` (4268), `ConjTable` (2731), `Row` (2718), `lpKindMark` (5946).
  - Routes and screens: `ConceptScreen`, `VocabThemesScreen`, `VocabWordsScreen`, `PhrasesScreen`, their route branches (8256-8268), and `concept` in `RESUMABLE`.
  - Other code: the Capacitor bootstrap (231-300, 2888-2895), `scripts/prewarm-content.js` and its npm scripts, the `cap:*` scripts and `capacitorDependencies`, `railway.json`, `railway.toml`, `nixpacks.toml`, `capacitor.config.json`.
  - Empty, untracked `app/` and `gradle/` directories.
- **Out of scope:** `LANGS_DATA` stays until P2.

**Deliverables:** Vite build served in production with legacy fallback; parity test suite; Settings with billing and deletion restored; dead code removed; `docs/verification/P1.md`.

**Verification:**

- **Automated:** Playwright parity suite (local server + test database + fake AI), run against `WEB_CLIENT=legacy` and `WEB_CLIENT=vite`:
  - log in, then open every reachable view branch (explore, coach, grammar, grammar-full, vocab-full, dialogues, learn, sounds, culture, cards, drills, structures, wordspace, roadmap, voice-tutor, analyzer, today, review)
  - text snapshots are equal
  - screenshots at 375 and 1440 are within tolerance
  - no new console errors
  - Unit test: a static check that no removed identifier is referenced.
- **Performance:** no Babel request; the first-load JS transfer and time-to-interactive are recorded and compared with legacy (expect a large drop).
- **Manual (staging, then production):**
  - forensics flows 1, 2, 3, 5, 6, 8 still match.
  - Settings shows "Manage billing" (paid test account on Stripe test mode in staging) and "Delete account" (staging throwaway account).
- **Release check:** after deploy, `/api/version` matches the commit, and an old tab shows "Update available".

**Data safety:** no data changes. Deleted screens held no user data. `localStorage` keys are unchanged.

**Rollback:** `fly secrets set WEB_CLIENT=legacy`, or redeploy the previous image. Ship the kill-switch service worker if caching misbehaves.

**Exit criteria:**

- Production serves the Vite build.
- Zero Babel in the browser.
- Parity suite green.
- CSP report shows only expected sources.
- Billing and deletion are reachable.
- About 1,100 lines of dead code are gone.

DoD: "duplication removed or justified", "no silently lost functionality".

---

### P2: Language Registry, content identity, shared foundations

**Goal:** languages become configuration, and content becomes addressable, versioned and stable.

**Scope:**

- **Migrations:** runner plus `000_baseline`, `001_schema_migrations`, `002_content_safety` (target §9.5); `release_command` in `fly.toml`.
- **Registry**
  - Create `shared/languages/*.json` for the 12 languages, with capabilities declared (target §2.3) and a Zod schema.
  - Add `GET /api/languages`.
  - Replace every server copy: `routes/content.js:31-49` (names, `SCRIPT_CHECK`), `routes/claude.js:8-20`, `app.js:87-100` (SEO pages generated from the registry), `routes/admin.js:535-537` (full 12×7 grid), `routes/support.js:18`, `routes/auth.js:210` ("11 languages" becomes a computed count).
  - In the legacy client, derive `TARGETS`, `REFS`, `NATIVES`, `SUPPORTED`, `TEST_PHRASES` and `LANG_THEME` from the registry (`web/src/legacy` imports the JSON).
  - `getLanguage()` replaces the roughly 20 French fallbacks. Invalid codes redirect to the account language.
  - `<html lang>` and `dir` follow the UI locale. Target-language text gets a `lang` attribute (legacy `ExampleLine`, vocabulary tiles).
- **Content (G1 must be decided first)**
  1. Commit the chosen canonical snapshot as `content/<lang>/<tab>.json` with `schemaVersion`.
  2. Assign stable IDs (`scripts/assign-content-ids.ts`, deterministic, committed).
  3. Versioned validator (v1 and v2) in CI via `validate:content`, which also enforces the ID-immutability rule.
  4. `release_command` loads canonical content into `content_cache` (`content_version`, `source`). Before overwriting any row that differs, it writes a `content_snapshots` row.
  5. Generate `legacy_lesson_map/<lang>.json` from the same snapshot using today's `buildUnits` order (5918-5935).
  6. Replace `generateMissingContent` and the regenerate endpoints with `content_drafts` (admin preview and diff, no automatic publish). Fix the admin Preview 401 (`admin-content.html:455`).
  7. Move `LANGS_DATA` facts, sounds and culture into `content/<lang>/{culture,sounds}.json` for all 12 languages. Delete the fabricated fields (level, streak, resume, resumePct, soundCount literal, vocabThemes pct/state, stub exercises). The Sounds header count becomes computed (fixes 36/30/46 vs 6).
  8. Regenerate `SCHEMA.md` from the Zod schema.
- **AI gateway skeleton**
  - `server/ai/gateway.ts` holds model IDs from config, logs cost for every call (including drafts), and carries the error classification from P0.
  - Prompt script rules are read from the registry, so the Hindi omission (D2) is gone.

**Deliverables:** registry used by server, SEO pages, admin and the legacy client; canonical content with IDs in the repository; release-time loading; drafts workflow; migrations 000-002; `docs/verification/P2.md`.

**Verification:**

- **Automated:**
  - Registry schema test.
  - `validate:content` green, and it fails when an ID is removed.
  - Contract test: `/api/content/:lang/:tab` returns the canonical content for all 84 files plus culture and sounds.
  - Snapshot test: generated `/learn-<slug>` pages contain the same facts as before, except the corrected speaker counts.
  - Legacy map test: for each language, `v0`, `g0` and `d0` map to the lesson whose title matches the snapshot.
  - The migration runner applies cleanly to an empty database and to a baseline-shaped database.
- **Manual (production, after deploy):**
  - The French course still shows the same unit and lesson titles and counts as before (live baseline: 44 for fr, 58 for ko) and the same items. "Les Nombres" still has 18 words if G1 chose the production snapshot.
  - Arabic UI renders RTL.
  - Settings lists 12 native languages.
  - The admin grid shows 12×7.
  - The Sounds header count is correct.
  - A stale `target_lang` in `localStorage` redirects to a valid language.

**Data safety:** `content_snapshots` hold the pre-load rows. Migrations are additive. Legacy progress IDs still resolve because order and content are unchanged.

**Rollback:** redeploy the previous image (it ignores the new columns and tables). Restore `content_cache` rows from `content_snapshots` if needed.

**Exit criteria:**

- Zero hand-maintained language lists outside the registry (lint rule `no-language-literal-lists`).
- Every content item has a stable ID.
- No runtime AI writes to `content_cache`.
- Admin, SEO and email use registry counts.

DoD: "languages via common architecture", "no fake/placeholder behaviour".

---

### P3: Design tokens, application shell, URL routing, navigation

**Goal:** one coherent application shell with the five areas, deep links and a working Back button, keeping the brand.

**Scope:**

- **Tokens:** `design/tokens.json` with canonical values settled in a side-by-side review (target §11.1). Generate `web/src/ui/tokens.css`, the `public/brand.css` variables and `shared/tokens.ts`. Rename `--blue*` to `--brand*`.
- **Primitives** (target §11.3) with component tests. Inline `BrandMark` SVG. `meta theme-color` synced. Themes applied synchronously through data attributes (fixes L9 and the accent staleness).
- **Shell and routing**
  - `AppShell` with the compact/medium/expanded navigation (target §11.2), `PageHeader` with breadcrumbs, and `ContentColumn` as the only width owner.
  - Router with the target §13 route table. Express catch-all `/app/*`. Language as a path segment. Back behaviour and scroll restoration.
- **Mount the legacy views as route elements inside the areas** (strangler):
  - LIBRARY ← Grammar, Vocab, Structures, Dialogues, CheatSheet, Sounds, Culture
  - PRACTICE ← Flashcards, Drills, Review
  - COACH ← AICoach, Conversation, TextAnalyzer
  - Look up ← WordSpace
  - LEARN ← LearnPath, Roadmap
  - TODAY ← ExploreHome, temporarily until P5, with its duplicate tiles removed
- **Delete:** `TopBar` (7722), the ExploreHome dock (5623-5636), the `view`/`stack` state (7953-7954), `tongue_last` writes (8157-8159), the `key={view}` wrapper and the `isDesktop` parent swap (8366-8380). `WrappedScreen` is replaced by `PageHeader` plus `ContentColumn` (fixes L5, L12, L13 and the Conversation composer pinning).
- **Overlays:** Language switcher, Settings, Voice and Upgrade move to `Dialog`/`Sheet` or routes (fixes L11).
- **i18n:** extract to per-locale JSON with typed keys. Add `nav_learn` for 11 locales. Translate the English literals in the shell and on Home. CI key-parity check.
- **Push:** payloads use `data.url` (replaces `[data-tab="0"]`).
- **Flag:** `SHELL_V2` (default on in staging; production rollout starts with the owner's account through an email allowlist, then everyone).

**Deliverables:** token pipeline, primitives library, shell, router, the five-area navigation with every existing feature placed (target §12.2), accessible dialogs, i18n files, `docs/verification/P3.md`.

**Verification:**

- **Automated:**
  - E2E Back and deep links across all routes, refresh keeps the route, language switch keeps the route.
  - axe: zero serious or critical violations on shell pages.
  - Layout metrics at 375/768/1440/2000: no horizontal overflow; prose ≤95 CPL; no text <12px; tap targets ≥44px on compact.
  - Theme scan: no computed brand hex outside the accent token after switching to Emerald.
  - Component tests: Dialog Escape and focus trap; `IconButton` requires a label.
- **Manual:**
  - Every row of target §12.2 is reachable in ≤2 interactions from its area on phone and desktop.
  - Keyboard-only navigation works across areas.
  - Arabic in RTL.
  - Dark mode, including the SupportChat replacement.

**Data safety:** no schema change. `localStorage` is unchanged apart from `tongue_last`, which is no longer written; the old value stays.

**Rollback:** `SHELL_V2=off` serves the P2 build's legacy shell (the same bundle carries both shells for one release), or redeploy the previous image.

**Exit criteria:**

- One shell, one navigation config, one header system, one width owner.
- Back button and deep links work.
- The owner signs off the visual review of brand tokens.
- No legacy navigation code remains.

DoD: "coherent shell", "simpler navigation", "no broken responsive layouts".

---

### P4: Learner Model foundation and sync (no-data-loss import)

**Goal:** the server becomes the source of truth for progress, flashcards, saved words and streak, with every existing browser record preserved.

**Scope:**

- **Migrations** `003_learner_profile` … `009_legacy_imports` (target §9.5).
- **Server:** `routes/learner.js` with `snapshot`, `events` (idempotent), `progress`, `cards`, `reviews` (server-applied SM-2 from `shared/srs`), `vocabulary` and `import`. Account deletion also deletes learner rows in the same transaction.
- **Shared code:** `shared/learner/events.ts`, `shared/srs/sm2.ts` (the web algorithm, 2811-2826) with golden vectors, and `deckStats`.
- **Client**
  - A `learner` service with a cache and an `IndexedDB` outbox (bounded, retried).
  - Adapters so legacy Flashcards (`fcLoad`/`fcSave`/`fcAdd`, 2781-2809), LearnPath (`lpLoad`/`lpSave`, 5914-5916), Roadmap (4515) and `_streak` (2906-2938) read and write through the learner service. During this phase they also keep writing the legacy keys (dual-write).
  - `LegacyImporter` with the consent dialog (target §9.7).
  - "Assign earlier look-ups" UI in My Words.
- **Fixes delivered by the shared system**
  - L1: Review uses `deckStats(lang)` and the language filter.
  - Starter deck reads the correct shape.
  - L6: new saved words carry a language.
  - Streak rule: only learning events count. `askClaude` no longer logs streaks (2966-2967). Carry-over is preserved in `learner_streak.carried_over_from`, and release notes explain the rule.
  - Sign-out clears the local learner cache **only after** import is confirmed for that account.
- **Streak cron:** `streaks` is dual-written so the push cron keeps working.
- **Native:** the same import endpoint documented for iOS and Android. No native changes yet.
- **Flag:** `LEARNER_SYNC` (owner allowlist → 10% → 100%, by user ID hash).

**Deliverables:** learner tables and APIs; synced flashcards, progress, roadmap, streak and saved words; importer; `docs/verification/P4.md`, including a rehearsal on staging with real key shapes.

**Verification:**

- **Automated (integration on the test DB):**
  - Import merge rules with fixtures shaped exactly like production keys: conflicting cards keep the higher repetitions; unmapped legacy lesson IDs are reported; `ws_saved` is left unassigned; streak `max` rules.
  - Idempotency: the same checksum twice is a no-op; retried events are deduplicated.
  - Deleting an account deletes learner rows.
  - SM-2 golden vectors.
  - `deckStats` matches the review queue.
- **Automated (E2E):**
  - Seed `localStorage` → consent → snapshot counts equal local counts → legacy keys still present.
  - Second browser context shows the same progress.
  - Korean Review shows only Korean cards.
- **Manual (production, owner account first):**
  - Before enabling, note local counts (cards, completed lessons, streak).
  - Enable the flag, then confirm the snapshot matches.
  - Complete a lesson on desktop and see it on phone.
  - Review a card and see the due count update everywhere.

**Data safety:**

- The owner takes a database backup before the migrations.
- Raw payloads are kept in `legacy_imports`.
- Legacy keys stay untouched (dual-write).
- Merges run in transactions.
- Consent prevents merging another account's data.
- No deletion anywhere.

**Rollback:** `LEARNER_SYNC=off` returns clients to the legacy local stores, which are complete because of dual-write. The server tables stay, and a later re-enable picks up via the outbox.

**Exit criteria:**

- 100% rollout.
- Import error rate ≈ 0 over 7 days, with every failure reproduced and fixed.
- Web progress follows the account.
- L1, L6 and L7 closed with regression tests.

DoD: "progress survives navigation", learner-model foundation.

---

### P5: Today v1

**Goal:** Home becomes TODAY, with one primary next action based on real learner state.

**Scope:** `shared/planner/today.ts` (target §10); `GET /api/learner/today`; `features/today` page (primary action with reason, review due, unit progress, streak under the stated rule, Ask Coach entry, one discovery item from vocabulary or culture content). Remove `ExploreHome` (5444-5639), its roughly 23 entry points, and the `TodaysPractice` weekday table (7107-7146); the CheatSheet already lives in LIBRARY › Quick Reference. Flag `TODAY_V1`.

**Deliverables:** Today page, planner, `docs/verification/P5.md`.

**Verification:**

- **Automated:**
  - Planner unit tests for each priority rule, using snapshot fixtures: new user; in-progress lesson; ≥10 due; next lesson; course complete.
  - E2E: the primary action navigates to the right route and "reason" text is present.
  - axe; layout metrics.
- **Manual:**
  - The three archetypes on staging (new account, account with an in-progress lesson, account with due cards).
  - The owner account in production.

**Data safety:** read-only use of learner data.

**Rollback:** `TODAY_V1=off` shows the P3 interim home.

**Exit criteria:**

- Home shows at most 6 surfaces.
- Every number shown is traceable to an API field.
- No fabricated statistic.

DoD: "Today prioritises next step".

---

### P6: Curriculum model and Learn journey

**Goal:** a visible journey with stages, units, lesson states, locking, placement and honest estimates.

**Scope:**

- `shared/curriculum` schema.
- `scripts/compile-curriculum.ts` v1, which keeps today's `buildUnits` order with stable IDs.
- `GET /api/curriculum/:lang`.
- `features/learn` journey UI: stage header, units with outcomes attached from `roadmap.json` `can[]`, lesson states (completed / in progress / available / locked with the reason), placement from `users.user_level` (fixes P8).
- Estimates follow target §4.3 rules.
- LEARN › Outcomes replaces Roadmap; checkbox state comes from `outcome_checks`.
- Lessons open at `/learn/lesson/:lessonId`, rendered by the legacy `LessonView` inside `SessionPage`, with the duplicate "Mark done" toggle removed (6221). Completion is a single action written as `completion_source='legacy_self_report'` until P7.
- Delete `buildUnits`, `lpLoad` and `lpSave` usage once they are served by the API.
- Flag `LEARN_V2`.

**Deliverables:** curriculum files for 12 languages, journey UI, outcomes, `docs/verification/P6.md`.

**Verification:**

- **Automated:**
  - The compiler reproduces the P2 legacy map for all 12 languages.
  - Locking and placement unit tests.
  - E2E: an imported legacy completion shows as completed on the same lesson; locked lesson message; placement unlock.
- **Manual:** journeys in fr (16 vocab categories), ko (30), ar (RTL) and zh (CJK) on phone and desktop. Fewer lessons in shallower languages are shown honestly.

**Data safety:** reads `lesson_progress`; no writes beyond existing events.

**Rollback:** `LEARN_V2=off` shows the legacy LearnPath adapter from P4.

**Exit criteria:**

- The journey is visible for all 12 languages.
- Onboarding level affects availability.
- No invented time estimates.

DoD: "guided curriculum".

---

### P7: Generic Lesson Engine

**Goal:** active lessons built from reusable blocks, with deterministic exercises, teaching feedback and natural completion.

**Scope:**

- **Shared code:** `shared/lesson` block schema (19 block types, target §5.2), `evaluate()` with normalisation profiles and golden vectors, the derivation rule catalogue with the source guard (target §5.5), a lesson compiler (curriculum + content + annotations → lesson JSON) and the annotation format.
- **Server:** `GET /api/lessons/:lessonId`.
- **Web**
  - `blockRegistry` and a renderer for every block type (keyboard- and screen-reader-complete).
  - Session runner (resume at `last_block_id`), feedback panel, `LessonSummaryBlock` with computed metrics only, and Continue / Review lesson.
  - `SpeechService` replaces `say()` (335-356) and Conversation `speak()` (7199-7205), with a persisted per-language voice (fixes D13).
  - `CoachLauncher` (opens COACH › Ask with context; full context arrives in P11).
- **Events:** `lesson_started`, `block_completed`, `exercise_attempted`, `lesson_completed`; missed exercises and matched mistakes create `review_items`.
- **Rollout:** auto-derived vocabulary and dialogue lessons for all 12 languages (no annotations needed) behind `ENGINE_KINDS=vocabulary,dialogue`. Grammar stays on the legacy view until P8.
- **Delete:** legacy `VocabLesson` and `DialogueLesson` once those kinds are on the engine.

**Deliverables:** engine, renderers, auto-derived lessons, `docs/verification/P7.md`.

**Verification:**

- **Automated:**
  - Evaluation vectors (apostrophes, accents policy, CJK width folding).
  - Derivation determinism: the same seed gives the same output, and ordering exercises never keep the original order.
  - Source guard fails on an invented form.
  - Component tests for all 19 renderers.
  - E2E: a keyboard-only vocabulary lesson completes; the summary numbers equal the recorded events; resume after reload returns to the same block.
  - axe.
- **Manual:** one vocabulary lesson and one dialogue lesson in fr, ja and ar on phone and desktop; TTS present and absent (a browser without voices shows the honest message).

**Data safety:** new events only. Legacy completions remain valid (`legacy_self_report`).

**Rollback:** `ENGINE_KINDS=` (empty) returns all lessons to the legacy view.

**Exit criteria:**

- No "Mark done" on engine lessons.
- Every exercise has provenance.
- Zero fabricated items.

DoD: "interactive lessons".

---

### P8: French lessons in the engine (and the same path for all languages)

**Goal:** the French curriculum, including the owner's example lesson, runs entirely through the generic engine.

**Scope:**

- **Annotations:** `annotations/fr/*.json` for the 22 French grammar lessons (inflection tables, accepted alternatives, mistake rules citing existing content such as `cheatsheet` "avoir faim … uses avoir not être"). `lexicon/fr.json` for tokens in lesson examples.
- **Review:** the owner or an appointed French reviewer records `reviewedBy` and `reviewedAt`.
- **Worked example:** "Le présent : verbes en -er, être et avoir" exactly as target §5.6, using the canonical content chosen at G1.
- **Curriculum:** an editorial French curriculum v2 (optional in this phase) that interleaves vocabulary, grammar, patterns and dialogues. IDs stay stable, so progress carries over.
- **Rollout:** `ENGINE_KINDS` gains `grammar,pattern` for fr. Other languages use auto-derived grammar lessons (explanation, examples, ordering, drill recall) without tables until their annotations are reviewed, and the admin content matrix shows that gap.
- **Delete:** legacy `GrammarLesson` (6153-6188) once all languages run grammar through the engine.

**Deliverables:** reviewed French annotations and lexicon, all French lessons on the engine, per-language annotation backlog in `docs/content-backlog.md`, `docs/verification/P8.md`.

**Verification:**

- **Automated:**
  - The source guard passes for every French annotation.
  - Every French lesson compiles.
  - E2E owner scenario: typing "suis" in `J'___ faim` shows the cited explanation and scaffold; correct → summary; the mistake appears in PRACTICE › Mistakes.
- **Manual:** the reviewer completes all 22 French grammar lessons on staging and signs `docs/verification/P8.md`; the owner completes the example lesson in production.

**Data safety:** lesson IDs are unchanged from P6, so completed lessons stay completed.

**Rollback:** remove `grammar` from `ENGINE_KINDS` for fr.

**Exit criteria:** 100% of French lessons are engine-rendered and none depends on French-specific code.

DoD: "French content through the generic engine".

---

### P9: Practice and Review integration

**Goal:** one review system fed by lessons, cards and mistakes, with graded practice.

**Scope:**

- `GET /api/learner/review-queue` (due cards, then due review items, then weak concepts; target §6).
- PRACTICE › Review session (card review and exercise re-asks in one runner, reusing block renderers).
- PRACTICE › Flashcards as deck management. The starter deck comes from completed lesson vocabulary.
- PRACTICE › Quick Drills as graded `drill.recall` sets.
- PRACTICE › Pronunciation (`sounds.json` plus `PronunciationExercise`, transcript-based and labelled).
- PRACTICE › Mistakes.
- **Delete:** legacy `ReviewScreen` (6481-6537), `Drills` (4379-4445), legacy `Flashcards` review UI (5062-5366), and the AICoach `fill`/`quiz` types (3324-3331).
- Today planner rules 3, 5 and 6 use the queue.

**Deliverables:** unified practice area, `docs/verification/P9.md`.

**Verification:**

- **Automated:**
  - Queue ordering unit tests.
  - SM-2 vectors on server reviews.
  - E2E: miss an exercise in a lesson → it appears in review the next day (clock fixture) → correct → rescheduled; Flashcards due count = Review count = Today count.
  - Drills record attempts.
- **Manual:** a review session on phone with 20 mixed items; pronunciation with speech recognition allowed and denied.

**Data safety:** cards migrated in P4 are reused, with no re-scheduling.

**Rollback:** `PRACTICE_V2=off` returns to the P4 adapters.

**Exit criteria:**

- One review count everywhere.
- Drills are graded.
- No reveal-only practice remains.

DoD: "practice/review integration".

---

### P10: Sentence Breakdown system and Analyze workspace

**Goal:** tap-to-inspect everywhere, and a real Analyze workspace.

**Scope:**

- Migration `010_analysis_ai_cache`.
- `BreakdownService` (segmentation per LanguagePack, then lexicon, then content index, then cached `breakdown.enrich`), used by lessons, Library and Analyze.
- Token panel actions (hear, save, grammar context, ask Coach, practise, known/unknown).
- `features/coach/analyze` two-pane workspace (target §8), `saved_analyses`, practise-from-text.
- Shell **Look up** command (explicit submit, `lookup.translate` with neutral keys).
- LIBRARY › My Words.
- **Delete:** `getBreakdown` (5998-6009) and the `bd_*` writes (the keys stay), `SentenceExplorer` (5989-6151), `TextAnalyzer` (7474-7587), `WordSpace` (4855-5058).

**Deliverables:** breakdown system, Analyze workspace, Look up, My Words, `docs/verification/P10.md`.

**Verification:**

- **Automated:**
  - Segmentation tests (fr clitics `j'ai`, ja/zh `Intl.Segmenter` fixtures, ar RTL offsets).
  - Resolution order tests.
  - Cache key includes the native language.
  - E2E: paste text → select token → save → My Words and review; AI unavailable → segmentation, lexicon and known-word highlighting still work, with an honest message for translation.
- **Manual:** analyse a French news paragraph and a Japanese paragraph on desktop and phone.

**Data safety:** `bd_*` keys untouched. Saved analyses are user-deletable.

**Rollback:** `ANALYZE_V2=off` returns to the P3-mounted legacy TextAnalyzer and WordSpace, which stay in the bundle for one release.

**Exit criteria:**

- One breakdown schema.
- No passive AI calls while typing.
- Analyze works (degraded) without AI.

DoD: "Analyze is a real workspace", "sentence breakdown reusable".

---

### P11: Coach with context and the AI features

**Goal:** Coach is a server-defined, context-aware assistant that is clearly labelled, with honest availability.

**Scope:**

- `server/ai/features/*` (target §9.1), `GET /api/ai/status`, and a shell AI banner.
- COACH › Ask with visible context chips (lesson, token or text, recent mistakes).
- COACH › Conversation (keeps the server scenarios, `claude.js:42-84`) in the new UI.
- COACH › Correct my writing (`coach.review_writing`, labelled AI, excluded from accuracy).
- `culture.expand`; Help (`support.answer`).
- `/api/claude` becomes a known-feature shim and is then removed (after native is updated or retired).
- Quota classes per feature. Charge on success only.
- **Entitlements (G3 decided):** one `getEntitlements`, and plan copy generated from it (fixes L10).
- **Delete:** `AICoach` (3297-3784), the legacy Conversation UI (7153-7471) and `SupportChat` (8384-8499).

**Deliverables:** Coach area, AI features, availability banner, entitlements (if G3 decided), `docs/verification/P11.md`.

**Verification:**

- **Automated:**
  - `FakeAiGateway` integration tests for every feature: schema-valid output, bad output → `ai_bad_output`, credits → 503, quota not charged on failure, cost logged.
  - E2E: open Coach from a lesson and the context chips show that lesson; AI down → banner and disabled entry points; lessons unaffected.
- **Manual:** conversation scenario on phone with voice mode; writing correction in fr and ja.

**Data safety:** coach text is not stored in events. `ai_usage_logs` stays.

**Rollback:** `COACH_V2=off` restores the P3-mounted legacy coach for one release.

**Exit criteria:**

- No client-authored prompts remain.
- One AI error contract.
- Plan copy matches server behaviour.

DoD: "Coach context", "no fake implementations".

---

### P12: Learner-state connections completion and Today v2

**Goal:** every learning surface feeds the one learner model, and Today uses it fully.

**Scope:**

- Remaining producers: `item_encountered` (Library), `conversation_turn`/`completed`, `pronunciation_attempted`, `analysis_saved`, `coach_message_sent`.
- `concept_stats` drives review priorities.
- Today v2 planner rules (mistakes, concept reinforcement).
- Per-timezone activity days. The push-reminder cron moves to `activity_days` (native users counted correctly). `streaks` becomes read-only history.
- Remove the P4 legacy adapters (the legacy **keys** stay).
- **Native decision point:** either implement thin clients (target §16: registry, block JSON renderers, learner APIs, golden vectors, host fix, French gate removal, account deletion, FCM on iOS) or a PWA path. The chosen track gets its own sub-plan with the same gates.

**Deliverables:** complete event coverage, Today v2, cron migration, native track plan, `docs/verification/P12.md`.

**Verification:**

- **Automated:** coverage test that every feature route emits its declared events; planner v2 tests; the cron sends one reminder per user per local day (advisory lock, two-machine test).
- **Manual:** a week-long staging scenario with a clock fixture.

**Data safety:** the `streaks` table is kept.

**Rollback:** per-producer flags; cron flag `REMINDERS_SOURCE=streaks|activity`.

**Exit criteria:**

- Every row of target §9.4 is either measured or explicitly not shown.
- No `localStorage`-only learner state remains.

DoD: "learner-state connections".

---

### P13: Responsive, accessibility and polish audit

**Goal:** finish quality across every route, device, theme and script.

**Scope:**

- Full route × viewport (375/768/1440/2000) × theme (light/dark, 10 accents) × direction (ltr/rtl) × script (Latin/CJK/Arabic/Devanagari) audit.
- Loading, empty and error states on every route.
- Copy and i18n sweep (no English literals; plan and marketing copy from definitions).
- Performance budgets (per-area JS chunk, LCP and INP on a mid-range phone).
- **Enforce CSP.** Remove the `legacy/` folder, `public/index.html` (legacy client) and the `WEB_CLIENT` switch.
- **Unify styling:** marketing, legal, SEO and email templates move onto generated tokens (fixes D16, D17).
- Refresh docs: README, DEPLOY (no secrets), native READMEs or their removal.

**Deliverables:** audit report with every issue fixed or ticketed with owner acceptance, `docs/verification/P13.md`.

**Verification:**

- **Automated:** Playwright matrix with axe and layout metrics; Lighthouse CI budgets; lint for raw colours and language branches.
- **Manual:** screen reader pass (VoiceOver iOS and macOS, TalkBack) on Today, a lesson, review, Analyze and Settings; keyboard-only pass.

**Data safety:** none affected.

**Rollback:** per-change revert.

**Exit criteria:**

- Zero serious or critical axe issues.
- Budgets met.
- No legacy client code.

DoD: "no broken responsive layouts", "accessibility".

---

### P14: Regression testing, end-to-end verification, release documentation

**Goal:** prove the Definition of Done and leave the system documented.

**Scope:**

- Full automated suite (unit, contract, integration, component, E2E matrix) green in CI.
- Manual verification script executed in production with an owner-controlled account, covering target §17.3 flows 1-11. Results recorded with screenshots and timestamps.
- Seven-day observation: error logs, AI error codes, import failures, restart count = 0 for crash causes.
- Final `CHANGELOG.md`; regenerated `SCHEMA.md`; architecture docs updated to "as built".
- **Owner-approved cleanup proposals (not executed without decision):** legacy `localStorage` keys (after 2 releases with verified import), `streaks` table archive, `tonge-app` retirement (G7), production test residue (G6).

**Deliverables:** DoD sign-off document `docs/verification/DEFINITION_OF_DONE.md` mapping each item to evidence.

**Verification:** as scoped above.

**Data safety:** cleanup only through decisions.

**Rollback:** not applicable. Each earlier phase keeps its own rollback until cleanup is approved.

**Exit criteria:** every DoD item has linked evidence (test run URL, manual verification record, or document section).

---

## 4. Definition of Done: phase coverage

| DoD item | Delivered in | Evidence |
|---|---|---|
| Coherent shell; same-product feel | P3, P13 | shell E2E, visual review sign-off |
| Languages via common architecture | P2 (registry), P7/P8 (engine) | lint rules, registry contract tests |
| Duplication removed or justified | P1, P2, P3, P9, P10, P11 | D1-D19 closure table in P14 doc |
| Guided curriculum | P6 | journey E2E |
| Interactive lessons | P7 | engine E2E |
| French content through generic engine | P8 | reviewer sign-off, E2E owner scenario |
| Today prioritises next step | P5, P12 | planner tests |
| Analyze is a real workspace | P10 | analyze E2E |
| Simpler navigation | P3 | §12.2 reachability checklist |
| Progress survives navigation | P3 (routing), P4 (sync) | cross-context E2E |
| No silently lost functionality | P1 (billing and deletion restored), §12.2 landing table | checklist |
| Major flows manually verified | every phase `docs/verification/*.md`, P14 | records |
| Relevant automated tests pass | P0 onward | CI |
| No fake or placeholder behaviour presented as complete | P2 (LANGS_DATA fabrications removed), P7 (provenance), P11 (AI labelled) | contract tests, review |
| No unexplained console errors | P0 (AI errors), P14 | E2E console assertions |
| No broken responsive layouts | P3, P13 | layout metric tests |
| Changes documented | every phase | CHANGELOG, docs |

---

## 5. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI credits restored before the regeneration freeze ships, so content is rewritten and progress remapped | medium | high | P0 first item; tell the owner not to top up credits until `CONTENT_AUTOGEN=off` is confirmed in production logs |
| Production content differs from the inferred state (UNVERIFIED) | medium | medium | read-only snapshot in P0; G1 decision on real data |
| Import merges another user's device data | medium | high | consent dialog; per-account import state; raw payload retained |
| Email delivery broken in production, locking out users if verification is enforced | unknown | high | G4 checks delivery before enforcement |
| The Vite extraction changes behaviour subtly | medium | medium | parity suite; `WEB_CLIENT` flag; two-release legacy fallback |
| Single production machine during migrations | medium | medium | release_command migrations are additive and fast; health checks; deploy off-peak; backup first |
| Entitlement or status changes affect paying users | medium | high | gates G2/G3; interim fixes stop logouts without changing who has access |
| Native apps diverge further | high (if developed now) | medium | freeze native until P12 decision |
| Reviewer capacity for annotations (P8) | medium | medium | auto-derived lessons keep all languages usable; the annotation backlog is visible, not hidden |
