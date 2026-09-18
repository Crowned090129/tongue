# Astra Handoff — operating brief for Tongue

Historical brief. Read [current project state](PROJECT_STATE.md) first; this file describes the September 17 baseline, not the latest branch or verification.

**Written:** 2026-09-17, against git HEAD `b3f6504` ("P0: crash-proof the server, freeze content regeneration, fix security and billing, honest AI errors"), pushed to `origin/main`.

You are picking this project up cold. Read sections 1–3 before you touch anything, then section 4 to know where the work actually stands, then section 5 for what to do first. Everything here was checked against the code at `b3f6504`, not against the older design documents. Where something is unverified, it says so in those words.

---

## 1. What Tongue is and where it runs

Tongue is a language-learning web app covering 12 languages. A learner picks a target language and a native language, and gets reference content (grammar, cheatsheet, sentence structures, vocabulary, dialogues, drills, a roadmap), a guided Learn path built from that content, flashcards with spaced repetition, and an AI Coach for conversation practice. Free accounts get 5 AI messages a day; paid accounts get 300 a day plus a short burst allowance. Streaks, lessons and flashcards are free for everyone.

The 12 language codes, from `LANG_NAMES` in `routes/content.js`: `fr, es, de, en, pt, it, zh, ja, ko, ru, ar, hi`.

**Where things live:**

| Thing | Where |
|---|---|
| Local repository | `/Users/coronado/Downloads/french-app` |
| GitHub | `https://github.com/Crowned090129/tongue.git`, branch `main` — **public repository** |
| Production app | `https://tongue-app.fly.dev` (marketing site at `/`, the app at `/app`) |
| Fly app name | `tongue-app`, region `iad`, `min_machines_running = 1`, `auto_stop_machines = "off"` (`fly.toml`) |
| Second Fly app | `tonge-app` — note the typo. An older build, still live. See §7 gate G7. |
| Database | Fly Postgres, connection string in `.env` as `DATABASE_URL`. **This is production.** |

**Shape of the codebase.** An Express 4 server with a `pg` connection pool and no ORM, plus a single-file React client.

- `server.js` (157 lines) — the process entry point. Everything with a side effect: env validation, the content-freeze banner, three cron registrations, `db.initialize()`, `seedContent()`, `app.listen()`.
- `app.js` (324 lines) — builds and exports the Express app with **no** side effects, so tests can `require("../app")` and listen on an ephemeral port. Middleware chain, 8 route mounts, 12 generated SEO landing pages, static files, one final error handler. Export is `module.exports = app` — the JSDoc at the top of the file claims `const { app } = require('./app')` also works; it does not.
- `db.js` (384 lines) — the only database module. `get` / `all` / `run` / `transaction`, an atomic SQL rate limiter, the cron claim lock, `hasActivePaidAccess`, and an idempotent `initialize()` that creates exactly 14 tables.
- `routes/` — `auth.js`, `admin.js`, `stripe.js`, `claude.js`, `content.js`, `streaks.js`, `push.js`, `support.js`.
- `utils/` — `asyncHandler.js`, `aiErrors.js`, `email.js`, `push.js`, `codes.js`.
- `public/index.html` (8,621 lines, 569 KB) — the **entire** web client. One `<script type="text/babel">` block compiled in the visitor's browser. No build step.
- `seed/content/<lang>/<tab>.json` — 84 curated content files (12 languages × 7 tabs), 2.0 MB.
- `docs/` — `ARCHITECTURE_FORENSICS.md` (what exists, evidence-backed, with finding IDs like S1/B4/L2 — parts of it describe the pre-P0 state), `TARGET_ARCHITECTURE.md` (the agreed target design), `MIGRATION_PLAN.md` (phases P0–P14, gates G1–G7, ground rules).

---

## 2. The owner's non-negotiable rules

These are not style preferences. Work that breaks one of them gets rejected regardless of whether it functions.

1. **One Tongue.** Languages are data, never per-language code. No `if (lang === "fr")` branches, no French-specific screens. A new language should be a registry entry plus content, nothing else.
2. **No fabricated content, progress or statistics.** Never display a number the learner did not produce. Never show placeholder text as if it were content.
3. **No fake implementations.** A screen that looks finished but does nothing is worse than an honest "not available yet". If a feature is not built, say so in the UI and in your report.
4. **Fix root causes, never symptoms.** Trace the bug to the shared system that produced it and fix it there.
5. **No `setTimeout` workarounds.** If something needs a delay to work, you have not understood the ordering problem.
6. **Never swallow errors.** No empty `catch {}`. No error path that returns success. If you cannot handle it, let it reach the error middleware.
7. **Do not silently change persisted schemas.** Database columns, `localStorage` key shapes and content-array ordering are all persisted state. Changing them without a migration and an owner decision destroys user data.
8. **Protect user data.** Legacy `localStorage` keys, the `streaks` table and `content_cache` rows are never deleted by this programme. Cleanup is a separate, owner-approved step.
9. **Never claim something works because it compiles.** Verify it in the running app, in a browser, with real clicks.
10. **Report honestly what was not done.** An incomplete task reported accurately is fine. An incomplete task reported as finished is the one unrecoverable mistake.

---

## 3. Safety rules, with the real commands

### 3.1 `.env` is production

`/Users/coronado/Downloads/french-app/.env` holds the **production** `DATABASE_URL` and live provider keys. It is untracked (`git ls-files` shows only `.env.example`). Rules:

- Never print a secret value, never paste one into a document, a commit, an issue or a chat message.
- Never run anything that loads `.env` against production. That includes `npm start` in this directory without overriding the environment, and **especially** `npm run prewarm` / `npm run prewarm:force` (see §9).
- `NODE_ENV=test` disables `dotenv` in both `server.js` and `app.js`, and `db.js` then refuses any database that is not a local `*_test` one. That is the only safe mode to run code in by default.

### 3.2 Running tests

The suite is Node's built-in runner. There is no jest, no vitest, no Playwright, no CI. One command, run from the repo root:

```
NODE_ENV=test TEST_DATABASE_URL=postgres://tongue@127.0.0.1:55432/tongue_verify_test DATABASE_URL= ANTHROPIC_API_KEY= RESEND_API_KEY= STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= SMTP_HOST= SMTP_USER= SMTP_PASS= EMAIL_FROM= GOOGLE_CLIENT_ID= JWT_SECRET=local-test-secret ADMIN_PASSWORD=local-admin-test npm test
```

Verified result at `b3f6504`: **24 tests, 8 suites, 24 pass, 0 fail**, roughly 400 ms. `[EMAIL] (no transport configured)` and `[EMAIL] ✗ ALL transports failed` lines during the run are expected — the mail transports are deliberately blank.

Use that same env prefix for any other local script, for example the seed validator:

```
… node scripts/validate_seed.js
```

Verified output at `b3f6504`: `68 valid, 16 invalid, 0 missing (of 84)`, exit code 1.

### 3.3 The guard that makes this safe

`tests/support/assertTestDatabase.js` is called from `db.js` at module load whenever `NODE_ENV === "test"`. It refuses any URL whose host is not in `LOCAL_HOSTS` (`localhost`, `127.0.0.1`, `::1`, `[::1]`, `postgres`) or whose database name does not end in `_test`, and it refuses to run at all if `TEST_DATABASE_URL` is missing. `DATABASE_URL` is never read in test mode. Verified refusals, each thrown before any connection is opened:

- remote host → `Refusing to run tests against db.example.com/tongue_test`
- local host, name not ending `_test` → `Refusing to run tests against 127.0.0.1/tongue_prod`
- variable unset → `Refusing: TEST_DATABASE_URL is required (DATABASE_URL is ignored in tests)`

Do not weaken this guard. If a test needs a different database, create another local `*_test` one.

### 3.4 The local Postgres

Work in this session used a throwaway Homebrew PostgreSQL 14.19 cluster on port 55432, with the data directory inside a session scratchpad. **Assume it is gone.** Databases that existed: `tongue_local`, `tongue_test`, `tongue_verify_test`, plus several per-area `*_test` databases.

Creating and dropping databases on a running cluster is verified to work:

```
createdb -h 127.0.0.1 -p 55432 -U tongue tongue_verify_test
dropdb   -h 127.0.0.1 -p 55432 -U tongue tongue_verify_test
```

The schema is created automatically by `db.initialize()` on the first run, so an empty database is enough. Bringing up a cluster from scratch (`initdb`, `pg_ctl start`, `createuser -s tongue`) was **not run in this session** — the cluster already existed — so treat that part as unverified and adapt it to your machine.

### 3.5 Running a local server

`.claude/launch.json` holds a tracked `tongue-local` configuration: `NODE_ENV=development`, `PORT=3001`, `DATABASE_URL=postgres://tongue@127.0.0.1:55432/tongue_local`, a placeholder `JWT_SECRET` and `ADMIN_PASSWORD`, and every provider key blanked. It needs the `tongue_local` database to exist. It is committed to a public repository, so it must never gain a real value.

Note: in development mode, missing required environment variables are **not** fatal — `server.js` logs `[Server] Continuing in dev mode with missing env vars` and keeps going. Only `NODE_ENV=production` makes them fatal.

### 3.6 Never do these

- Never enter, set, generate or read back a secret value. Rotating a secret is the owner's job, in their own console.
- Never run a `fly` command that writes: no `fly deploy`, no `fly secrets set`, no `fly scale`, no `fly ssh`, unless the owner has asked for that specific command in this session.
- Never run `npm install` or add a dependency without asking. The lockfile is what the production image is built from.
- Never `git push` without being asked.

### 3.7 What needs owner approval, every time

- Anything that **writes** to the production database, including one-off SQL.
- Anything that **costs money**: Anthropic credits, a new Fly machine, a paid service.
- **Deleting data** of any kind, including "obviously stale" rows.
- **Rotating secrets**, or changing which secrets are set on a Fly app.
- **Changing repository visibility**, or rewriting git history.
- **Deploying**, until the owner has said P0 may go out.

---

## 4. Current state

### 4.1 What P0 did

P0 is implemented, committed as `b3f6504`, and pushed to `main`. It is **not deployed**. Production is still running the pre-P0 build.

- **Crash-proofing.** Express 4 ignores the promise an async handler returns, so a rejected `await` became an `unhandledRejection` and killed the only machine. `utils/asyncHandler.js` wraps every async route and middleware — verified: `grep -n "async (req" routes/*.js app.js | grep -v asyncHandler` returns nothing. `app.js` ends with one error middleware that answers JSON for `/api*` and `/admin/api/*` and `text/plain` elsewhere.
- **Content freeze.** `CONTENT_AUTOGEN` must be exactly the string `"on"` to enable AI content generation. Off (the default), boot generation, the 6-hourly repair cron and on-demand generation are all disabled, and the app logs which mode it is in at boot. Every generation path funnels through `generateContent` in `routes/content.js`, which throws `AutogenDisabledError` (code `autogen_disabled`) when frozen. `CONTENT_SEED_UPGRADE` is a second, separate freeze: `seedContent()` will not replace an existing `content_cache` row unless it is `"on"`.
- **Test isolation.** `tests/support/assertTestDatabase.js` plus the `db.js` hook described in §3.3.
- **Honest AI errors.** `utils/aiErrors.js` defines 7 codes with real statuses: `ai_unconfigured` and `ai_unavailable_credits` (503, not retryable, `Retry-After: 3600`), `ai_overloaded` / `ai_timeout` / `ai_unreachable` (503, retryable, `Retry-After: 60`), `ai_bad_output` and `ai_upstream_error` (502). Body is `{code, error, message, retryable}` where `error` duplicates `message` for older clients. The SSE chat route commits to `text/event-stream` headers only after the upstream responds OK, so pre-stream failures are still real HTTP statuses.
- **Security and billing.** `POST /api/stripe/create-portal` now requires `requireAuth` and reads `stripe_customer_id` from the caller's own row, ignoring the request body. Admin auth is a timing-safe SHA-256 compare, header-only (`x-admin-token`; a `?token=` query string is rejected), with a real server-side logout. The Stripe webhook inserts into `stripe_events` and runs the handler inside one transaction. Renewals now extend the existing access code with `GREATEST` instead of issuing a new one, so paying customers are no longer logged out at renewal. `app.set("trust proxy", 1)` makes per-IP rate limits key on the real client.
- **Delivery.** `fly.toml` gained `[[http_service.checks]]` on `/health` (grace 20s, interval 30s, timeout 5s). The `Dockerfile` is pinned to `node:20.20.2-alpine`, uses `npm ci --omit=dev`, and runs as `USER node`.
- **Cron single-flight.** A `job_runs` table with `PRIMARY KEY (job, slot)` and `claimJobRun(job, slot)` — `INSERT … ON CONFLICT DO NOTHING RETURNING job`. Exactly one machine runs each job per slot. (The plan called for `pg_try_advisory_lock`; P0 used the claim table instead. Same effect, different mechanism.)

### 4.2 What is verified, and how

- **The suite passes.** 24/24 at `b3f6504`, re-run today.
- **The server was verified by hand** against a local throwaway Postgres: `/health`, `/api/version`, honest AI errors (503 `ai_unconfigured` with a code), invalid language → 400, chat returning JSON instead of a fake SSE stream, support → 503, malformed body → 400 `invalid_json`, portal → 401 without auth, admin `?token=` rejected, the process still alive after forced errors, and the content-freeze line in the boot log.
- **The app was verified in a browser:** login gate, signup, onboarding, Home, Learn (showing an honest "not available yet" message), Coach (honest AI-unavailable message), Flashcards empty state.
- **Subsystem maps.** Six agents read the code and re-verified their claims by running it — middleware probes, a stubbed-Stripe webhook probe, a `hasActivePaidAccess` truth table, the rate-limiter atomicity, the test-guard refusals. Their findings are folded into this document.

### 4.3 What is NOT verified

Say this plainly to anyone who asks whether P0 is finished: **the P0 tail did not run.**

- **The P0 regression tests were never written.** The plan lists them (malformed body keeps the process alive, portal without a token → 401, webhook failure → 500 then exactly-once retry, renewal keeps the code active, a fake credits error → 503 `ai_unavailable_credits` without charging quota, the guard refuses a non-local URL, the limiter holds under 20 concurrent requests). None of them exist. The current 24 tests are the pre-P0 smoke suite.
- **No adversarial review happened.** Nobody tried to break P0's own work.
- **The client owner agent died mid-task.** Some client work landed (a single AI/content error contract, `fcDeckStats`, a starter-deck shape fix, a checkout banner, corrected plan copy). Some did not: several call sites still print hardcoded "Connection error", and the Upgrade dialog's Escape and focus handling was never confirmed.
- **The Docker image has never been built at this commit.** Low risk — only the base tag, the install command and the user changed — but unverified.
- **Nothing has been deployed.** Production runs the pre-P0 build.

### 4.4 Open risks, honestly

1. **The old `ADMIN_PASSWORD` is in public git history.** `DEPLOY.md` contained the real value from the first commit (`a5a4718`). The working tree now has placeholders (`DEPLOY.md` lines 44–45), but git history is unchanged and the repository is public. The owner has been told to rotate `ADMIN_PASSWORD` on **both** Fly apps (`tongue-app` and `tonge-app`). **Not confirmed done.** Only an 8-character prefix of `JWT_SECRET` was ever published; rotating `JWT_SECRET` signs out every user, so that is a separate decision (gate G5).
2. **16 of 84 seed files fail the validator.** `node scripts/validate_seed.js` → `68 valid, 16 invalid`. All 12 `grammar.json` fail with `section 0 needs ≥3 examples`; `fr/es/de/pt` `vocab.json` fail with `category 0 has too few words (need ≥30)`. Cause: an earlier commit raised `validateContent` (grammar now needs an `examples` array of ≥3 plus `common_mistake`; vocab needs ≥30 words each carrying `t`, `r`, `ex`) and deepened only 8 vocab seeds. No grammar seed was ever re-authored, and `seed/SCHEMA.md` still documents the **old** shapes — anyone authoring from that spec today reproduces the failure. Consequence: on a **fresh** database those 16 tabs are skipped by `seedContent` and answer `503 {"code":"content_unavailable"}`. Production is unaffected **only** because its rows already exist. The advertised "works with zero AI credits" fallback does not currently exist for grammar in any language.
3. **Production content is unknown.** Nobody has read it. The read-only snapshot the plan calls for was blocked by a permission prompt and never taken. The repo's 84 seed files are almost certainly **not** what live users see: `seedContent` never replaces an existing row while `CONTENT_SEED_UPGRADE` is off, and the forensics infer production holds older AI-generated rows. Until a snapshot exists, treat production content as unknown.
4. **Billing is unreachable from the app.** `POST /api/stripe/create-portal` and `DELETE /api/auth/account` are live and correct on the server, but their only client callers sit inside `SettingsPanel` in `public/index.html` (lines 4685–4838), which has **zero** mount sites — verified, `grep -c "<SettingsPanel" public/index.html` returns 0. The settings sheet users actually see (`SettingsOverlay`) offers language, theme, dark mode and Sign out, and nothing else. A paying user cannot cancel or delete from inside the app. Worse, the dead call at line 4727 sends no `Authorization` header, so restoring it as-is would 401.
5. **Review screen numbers are wrong.** Cards are stored with `next_review`; `ReviewScreen` reads `c.nextReview` at lines 6602, 6603 and 6647. Every card reads as due, every card reads as unseen, "upcoming" is always 0, and the progress bar is always 0%. It also loads every language's deck, not the current one.
6. **All learner data is single-device.** Lesson progress, flashcards, saved words, roadmap ticks and the streak the learner sees all live in that browser's `localStorage` and never reach the server. Clearing site data loses everything.
7. **Lesson identity is array position.** No content item anywhere carries an `id` — verified by walking all 84 seed files. Lesson IDs are `"g12"`, `"v3"`, `"d0"`, and roadmap ticks are `"<phase>-<milestone>"`. Regenerating or re-seeding a content row silently remaps every learner's completed lessons. This is the reason both freezes exist.
8. **`tonge-app` is still live.** Whether it shares the production database — and therefore whether it is running duplicate cron jobs — is **unknown and needs checking**. The repository does not establish it; `MIGRATION_PLAN.md` gate G7 explicitly says to confirm its `DATABASE_URL` first. Do not assume either way.

---

## 5. Immediate next actions, in order

Do these in order. Each has a definition of done. Do not start the next one until the previous is actually done, not "should be fine".

### 5.1 Write the P0 regression tests

Add them to `tests/` (a new `tests/p0.test.js` is cleaner than growing `smoke.test.js`). Cover, at minimum:

- A malformed JSON body on an `/api` path returns `400 {"code":"invalid_json"}` **and the process is still alive** afterwards.
- `POST /api/stripe/create-portal` with no `Authorization` header → 401; with a valid token → only the caller's own `stripe_customer_id` is used.
- A webhook handler failure returns 500 and leaves no `stripe_events` row, then the retry processes exactly once.
- A renewal webhook keeps the existing access code active and extends `expires_at` (never moves it backwards).
- A simulated credits failure returns `503 ai_unavailable_credits` and the AI quota is **not** charged.
- `assertTestDatabase` refuses a non-local URL, a non-`_test` name, and a missing variable.
- The rate limiter stays within its limit under 20 concurrent requests.

Stripe can be driven without network or real keys through `module.exports.__setStripeClientForTests` in `routes/stripe.js` (it throws unless `NODE_ENV === "test"`).

**Done when:** the full command in §3.2 passes with the new tests included, and each new test has been seen to **fail** when the fix it guards is reverted locally.

### 5.2 Run the adversarial review that never ran

Read P0's own diff (`git show b3f6504`) as an attacker and as the maintainer who inherits it. Specific things to probe: an async route or middleware that escaped `asyncHandler`; work started inside a handler and not awaited (fire-and-forget still escapes to the `unhandledRejection` logger); the `headersSent` branch of the error middleware (`app.js` line 297), which is the SSE path and was never exercised; whether `refundQuota` can land in the wrong window; whether any error path returns success.

**Done when:** you have a written list of findings with file and function names, each either fixed with a test or explicitly deferred with a reason.

### 5.3 Finish the remaining client error call sites

Six live call sites in `public/index.html` still print hardcoded copy from a `catch` that also wraps `await res.json()`, so a non-JSON response is misreported as a network failure: lines **3184, 3203, 3251, 3272** (in `AccessCodeLogin`), **8154** (the magic-link effect) and **8537** (`SupportChat`, "Connection issue"). Lines 4718 and 4735 are inside the dead `SettingsPanel` and have no user impact today.

Separately, `TextAnalyzer` at line 7610 unconditionally sets "Could not analyze. Check your connection and try again.", discarding the `ApiRequestError` — a 429, an expired session and a real outage all read the same. Four more `askClaude` call sites discard the error entirely: `CultureScreen` (6531), `Conversation.translateMsg` (7417), `Conversation.endConversation` (7431), `SentenceExplorer` (6140).

Route them all through the existing contract: `readApiError` (2981), `aiErrorMessage` (2998), `contentErrorMessage` (3018). Six sites already do this correctly — 3437, 3461, 4003, 4391, 4987 and `streamChat`'s own `fail` at 3064 — copy those.

Also confirm the Upgrade dialog's Escape key and focus handling, which was never checked.

**Done when:** each changed screen has been exercised **in a browser** against a locally running server, with the AI key blank (so the honest 503 fires) and with the server stopped (so a real network failure fires), and the two produce different, correct messages.

### 5.4 Deploy P0 to Fly and verify in production

Only after 5.1–5.3, and only with the owner's go-ahead.

```
fly deploy
```

`fly.toml` has no `[deploy]` section and no `release_command`, so the schema is created at boot by `db.initialize()`, not as a release step. The health check gates the rollout.

Verify after the deploy, read-only:

- `GET https://tongue-app.fly.dev/api/version` → the new image ref (`Cache-Control: no-store`, so you always get the live value).
- `GET https://tongue-app.fly.dev/health` → `200 {"status":"ok","db":"ok","ts":…}`.
- The boot log contains the `[Content] Automatic content generation is OFF` line — this is the confirmation the owner is waiting for before topping up AI credits.
- Walk the browser flows: login, signup, Home, Learn, Coach, Flashcards.

**Rollback**, documented in `DEPLOYMENT_CHECKLIST.md` lines 204–209 and `MIGRATION_PLAN.md` — **not executed or verified by anyone here**:

```
fly releases                                              # find the previous image
fly deploy --image registry.fly.io/tongue-app:<previous>  # redeploy it
```

Last resort: `fly scale count 0` then `fly scale count 1`. Confirm the result with `GET /api/version`.

**Done when:** `/api/version` reports the new build, `/health` is green, the freeze line is in the log, the browser flows pass, and you have told the owner in writing what you verified and what you did not.

### 5.5 Then, before starting P1

Two blockers that are not P0 but gate everything after it: take the **read-only production content snapshot** (gate G1 — see §7), and get confirmation that `ADMIN_PASSWORD` was rotated on both Fly apps (gate G5).

---

## 6. The phase plan and the Definition of Done

Full detail, scope, verification, data-safety and rollback for each phase is in `docs/MIGRATION_PLAN.md` §3. One line each:

- **P0** — Safety net and production stabilisation: make it safe to change, test and deploy, and stop active harm. *(Code done at `b3f6504`; tail and deploy outstanding — see §5.)*
- **P1** — Build and module extraction: leave in-browser Babel for a real Vite build with **no user-visible change**, and remove confirmed dead code.
- **P2** — Language Registry and content identity: languages become configuration, content becomes addressable, versioned and stable. Gate G1 must be decided inside this phase.
- **P3** — Design tokens, app shell, URL routing, navigation: one coherent shell with deep links and a working Back button.
- **P4** — Learner Model foundation and sync: the server becomes the source of truth for progress, flashcards, saved words and streak, with every existing browser record preserved.
- **P5** — Today v1: Home becomes TODAY, with one primary next action based on real learner state.
- **P6** — Curriculum model and Learn journey: stages, units, lesson states, locking, placement, honest estimates.
- **P7** — Generic Lesson Engine: active lessons built from reusable blocks, deterministic exercises, teaching feedback.
- **P8** — French lessons in the engine, and the same path for every other language.
- **P9** — Practice and Review integration: one review system fed by lessons, cards and mistakes.
- **P10** — Sentence Breakdown system and the Analyze workspace: tap-to-inspect everywhere.
- **P11** — Coach with context: a server-defined, context-aware assistant, clearly labelled, with honest availability.
- **P12** — Learner-state connections completion and Today v2: every surface feeds the one learner model.
- **P13** — Responsive, accessibility and polish audit across every route, device, theme and script.
- **P14** — Regression testing, end-to-end verification, release documentation: prove the Definition of Done.

**Ground rules that apply to every phase** (`MIGRATION_PLAN.md` §0): each phase is shippable on its own behind a flag with a documented off-switch; schema changes are additive, versioned and loud (`CREATE TABLE` / `ADD COLUMN` / `CREATE INDEX`, all `IF NOT EXISTS`, no `DROP` or `RENAME` without an owner decision, and a failed migration aborts the deploy); tests never touch production; every bug is root-caused with a regression test; every phase has a rollback; every phase records its manual verification in `docs/verification/<phase>.md` (that directory does not exist yet — create it).

**Definition of Done** (`MIGRATION_PLAN.md` §4) — the programme is finished when all of these have linked evidence:

coherent shell with a same-product feel · languages delivered through one common architecture · duplication removed or justified · a guided curriculum · interactive lessons · French content running through the generic engine · Today prioritises the next step · Analyze is a real workspace · simpler navigation · progress survives navigation · no silently lost functionality · major flows manually verified · relevant automated tests pass · no fake or placeholder behaviour presented as complete · no unexplained console errors · no broken responsive layouts · changes documented.

---

## 7. Decision gates G1–G7

These need the owner. Until each is decided, use the safe default and keep working on whatever does not depend on it. Full table in `MIGRATION_PLAN.md` §2.

| Gate | Decision needed | What it blocks | Safe default until decided |
|---|---|---|---|
| **G1** | Canonical content: are production `content_cache` rows the truth, or the repo seeds? | P2 content IDs, and all progress mapping | Regeneration stays frozen. Production content is served unchanged. **A read-only snapshot is still missing** — it was blocked by a permission prompt. Getting it is the prerequisite for this decision and for any stable-ID work. |
| **G2** | Account-status semantics. `status='cancelled'` is written both by admins and by the Stripe `subscription.deleted` webhook; enforcing status in `requireAuth` could lock out former subscribers now on the free plan. | Enforcing account status on requests | Only stop the upserts that force `status='active'` for suspended users. Create no new lockouts. |
| **G3** | Entitlement model: access codes vs subscriptions vs admin grants. Codes issued by admins with no Stripe subscription could lose access. | Entitlements work in P11 | Keep code-based access. The renewal logout is already fixed by extending the code instead of replacing it. Note `requirePaid` exists in `routes/auth.js` and is attached to **no route** — the only enforced paid/free difference today is the AI quota. |
| **G4** | Require verification (magic link or Google) for existing emails on `/api/auth/signup`. If production email delivery is broken — which is **unverified** — this locks out free users. | Signup verification | Rate-limit and log signup reuse. Do not block. Confirm email delivery first by sending one magic link to the owner. |
| **G5** | Secret rotation. The old `ADMIN_PASSWORD` is in public git history; only a `JWT_SECRET` prefix was published. Rotating `JWT_SECRET` signs out every user; rewriting git history is destructive. | P0 security closure | Rotate `ADMIN_PASSWORD` immediately on **both** Fly apps — no user impact. **Not yet confirmed done.** The values are already placeholders in the working tree. |
| **G6** | Cleaning test residue from production (`test_*@tongue-test.invalid` users, if any). This deletes production rows. | Production cleanup | Count only, read-only. No deletion. |
| **G7** | Retiring `tonge-app.fly.dev`, a live older build. If it shares the production database it duplicates the cron jobs. | Ops and the native decision | Scale it to zero **only after confirming its `DATABASE_URL`**. Never destroy it without a decision. Whether it shares the database is currently **unknown — needs checking**. |

---

## 8. How to work

### 8.1 The loop

**DISCOVER → PLAN → IMPLEMENT → TEST → VERIFY → DONE.**

- **Discover.** Read the actual code before forming an opinion. The forensics document describes the pre-P0 state in places and its line numbers are stale. Re-check every line number with `grep -n` before you cite it; prefer "function `X` in file `Y`" over a bare line number.
- **Plan.** Say what you will change, which files you own, and what "done" looks like. If the plan touches persisted state or production, stop and ask.
- **Implement.** Smallest change that fixes the root cause.
- **Test.** Automated where possible; every bug fix ships with a regression test that you have watched fail without the fix.
- **Verify.** In the running app, in a browser. Compiling is not evidence.
- **Done.** Report what you did, what you verified and how, and what you did **not** do.

### 8.2 File partitioning when running parallel agents

Parallel agents in this repo must be partitioned **by file ownership**, not by feature. Two agents editing `public/index.html` will clobber each other — it is one 8,621-line file and the whole client lives in it. Assign exactly one owner per file, state it in the task, and make every other agent read-only for that file. Reasonable boundaries: `server.js` + `app.js` + `db.js` + `utils/` · `routes/auth.js` + `routes/admin.js` + `routes/stripe.js` · `routes/content.js` + `routes/claude.js` + `routes/support.js` · `public/*` · `tests/` + infra files · `docs/`. Cross-owner changes go through a coordination step at the end, not concurrently.

### 8.3 Verifying UI changes in a browser

There is no build step, so a change to `public/index.html` is live on reload. Start the local server (§3.5), open `http://localhost:3001/app`, and click the actual flow. Check the browser console — the app has **no React error boundary**, so any render throw blanks `#root` silently. Test both themes (the app ships a dark mode) and at phone width, since layout regressions are one of the Definition-of-Done items. To see an honest AI failure, leave `ANTHROPIC_API_KEY` blank; to see a real network failure, stop the server.

### 8.4 Deploying and rolling back

See §5.4. The short version: `fly deploy`, then confirm with `GET /api/version` and `GET /health`, and roll back by redeploying the previous image from `fly releases`. Never deploy without the owner's go-ahead, and never deploy something you have not run locally.

### 8.5 Commit messages here

Existing style is a short imperative summary line, optionally with a `type:` prefix, and a body that explains *why* and lists what was verified. Look at `b3f6504` for the shape. Rules:

- One logical change per commit.
- Never commit a secret. Never commit `.env`.
- Say what you verified in the body, and say what you did not verify.
- End the message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

- Commit and push only when asked. If you are on `main` and about to commit unasked work, branch first.

---

## 9. Things that will bite you

1. **Babel is pinned at 7.29.7, in the browser.** `public/index.html` line 21 loads `@babel/standalone@7.29.7` from unpkg and compiles 555 KB of JSX on every page load. React and ReactDOM load from unpkg with the **unpinned** range `react@18` / `react-dom@18` (lines 19–20), so a React patch release can change production behaviour with no commit in this repo. If unpkg is unreachable, `#root` stays empty with no message. Do not "upgrade" any of these casually, and leave the pin alone until P1 replaces the whole arrangement with a Vite build.
2. **Content identity is array position.** No item has an ID. `"g12"` means `content.sections[12]` of whatever row is in `content_cache` *right now*. Reordering, regenerating or re-seeding a row silently remaps every learner's completed lessons. Both `CONTENT_AUTOGEN` and `CONTENT_SEED_UPGRADE` are off for this reason. Do not turn either on without an owner decision, and do not turn on `CONTENT_SEED_UPGRADE` at all until stable IDs exist.
3. **There is a second Fly app on the same story.** `tonge-app` (typo host) is an older live build. The unshipped native iOS and Android clients point at it; `capacitor.config.json` points at `tongue-app`. Whether `tonge-app` shares the production database, and therefore whether it is duplicating cron jobs, is **unknown — needs checking** (gate G7). Do not scale, restart or destroy it.
4. **On a fresh database, 16 content tabs are missing.** All 12 grammar files and `fr/es/de/pt` vocab fail `validateContent` and are skipped by `seedContent`, so those tabs return `503 content_unavailable`. `seed/SCHEMA.md` still documents the old, now-invalid shapes, so authoring from it reproduces the bug. `scripts/validate_seed.js` would catch this and **nothing runs it** — it is in no npm script and there is no CI.
5. **Learner state is localStorage-only.** Progress (`learn_progress_<lang>`), flashcards (`fc_cards_v2`), saved words (`ws_saved`), roadmap ticks (`roadmap_<lang>`) and the streak the user sees all live in one browser. The server keeps a *separate* streak row that the web client never reads — the client writes `Date.toDateString()` in local time, the server writes an ISO date in UTC, and the two never reconcile. The iOS app keeps a **third** independent flashcard deck in `UserDefaults`. Every `localStorage` write is individually `try/catch`'d, so quota failures are silent.
6. **The git history is public and contains an old secret.** Rotation is gate G5. Never rewrite history without an explicit owner decision, and never add a new secret to a tracked file — including `.claude/launch.json`, which is committed.
7. **`npm run prewarm` and `npm run prewarm:force` are live grenades.** `scripts/prewarm-content.js` calls `require("dotenv").config()`, i.e. it loads the **production** `.env`. It would spend real Anthropic credits and rewrite production content, which is exactly what the freeze exists to prevent. It also cannot actually run — it requires `better-sqlite3`, which is not in `package.json` or `node_modules` — and it writes a column named `content` while production has `content_json`. Do not run it; propose deleting it and its two npm scripts.
8. **Migrations are silent.** Every `ALTER` and `CREATE INDEX` in `db.js initialize()` is wrapped in `.catch(() => {})`, and there is no schema-version table. A genuinely failed migration is invisible and the boot still logs `Schema ready ✓`. Assume nothing about the production schema matching what `initialize()` produces; the only way to know is a read-only `information_schema` diff.
9. **Unknown API paths return HTML, not JSON.** The 404 fallback in `app.js` is registered for all paths, so a `fetch()` that parses the response as JSON gets a parse error instead of a code. Two 400s on `GET /api/content/:lang/:tab` ("Unknown language", "Unknown tab") also carry no `code` field, unlike everything else.
10. **Email failures are invisible.** `sendEmail` returns `false` in console-fallback mode and on every failure, and **no caller in `routes/auth.js` or `routes/admin.js` checks the return value**. An undelivered access code or magic link reads as success to the user. Only the Stripe webhook's `afterCommit` path logs it.
11. **`db.trackEvent` is `async` but does not await its insert.** Awaiting it guarantees nothing and its errors are swallowed. Also: `analytics_events` is write-only — 14 event names are inserted from 5 files and nothing in the repo ever selects from it.
12. **Nothing is pruned except two tables.** The 03:00 cron deletes expired `admin_sessions` and stale `rate_limits` rows. `magic_links` (which stores plaintext email addresses), `stripe_events`, `ai_usage_logs`, `analytics_events`, `content_reports` and `job_runs` grow forever.
13. **Cron timing is only correct by accident.** `node-cron` is given no `timezone` option, so matching uses the process-local clock; the "8 PM UTC" comments are true only because the container has no `TZ` set. Slot keys are UTC regardless. Run the server on a non-UTC machine and the jobs fire at local times while the slot keys stay UTC.
14. **Nine of twelve languages render placeholders.** `LANGS_DATA` in `public/index.html` is hand-authored only for `fr`, `es` and `ja`; the loop around line 959 machine-generates the other nine with literal `"Option A"`, `"..."` and `"Hello"`, and those are rendered by reachable views (concept, vocabThemes, vocabWords, phrases). The vocabulary screens also show hardcoded `count` and `pct` values that are not derived from the learner at all. Both are direct violations of rule 2 in §2 and should be fixed in P2.
15. **877 lines of dead components sit in `public/index.html`.** `GrammarScreen`, `SettingsPanel`, `OnboardingModal`, `HowToUseModal`, `ShareCardModal`, `DesktopNav`, `VocabCard`, `ConjTable`, `Row` — all with zero mount sites. Some of them (notably `SettingsPanel`) contain the *only* client callers of live server endpoints, which is why billing looks missing rather than broken. Removing them is P1 scope; do not delete one without first checking what unique code it holds.

---

## 10. Quick reference

```
# run the tests (the only safe default way to run this code)
NODE_ENV=test TEST_DATABASE_URL=postgres://tongue@127.0.0.1:55432/tongue_verify_test \
DATABASE_URL= ANTHROPIC_API_KEY= RESEND_API_KEY= STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= \
SMTP_HOST= SMTP_USER= SMTP_PASS= EMAIL_FROM= GOOGLE_CLIENT_ID= \
JWT_SECRET=local-test-secret ADMIN_PASSWORD=local-admin-test npm test

# validate the seed corpus (same prefix)
… node scripts/validate_seed.js          # currently: 68 valid, 16 invalid, 0 missing (of 84)

# read-only production checks (safe)
curl -s https://tongue-app.fly.dev/health
curl -s https://tongue-app.fly.dev/api/version
```

Environment variables that change behaviour rather than just supplying a credential: `NODE_ENV` (`test` switches the database guard on and disables dotenv; `production` makes missing required vars fatal), `CONTENT_AUTOGEN` (must be exactly `"on"`), `CONTENT_SEED_UPGRADE` (must be exactly `"on"`), `PORT` (fly sets 3001; the code defaults to 3000).

Documents to read next, in this order: `docs/MIGRATION_PLAN.md` §0 and §2 (ground rules and gates), `docs/TARGET_ARCHITECTURE.md` (where this is going), `docs/ARCHITECTURE_FORENSICS.md` (what exists — remember it predates P0 in places).
