# Tongue — Project State

**Living status document.** Where the project stands right now, and what happens next.

This file complements the other three and deliberately does not repeat them:

| Document | Answers |
|---|---|
| `docs/ARCHITECTURE_FORENSICS.md` | What exists today, evidence-backed, with finding IDs (S1, B4, L2, P2…) |
| `docs/TARGET_ARCHITECTURE.md` | Where we are going (Tongue Core + Language Registry, lesson blocks, learner model) |
| `docs/MIGRATION_PLAN.md` | How we get there (phases P0…P14, gates G1…G7, ground rules) |
| **`docs/PROJECT_STATE.md`** (this file) | **Where we are now, what is blocked, what is next** |

Rule for this file: every claim of "verified" names the method. Anything unconfirmed is written as
**unknown — needs checking**, never as a guess.

---

## 1. Status summary

**As of:** 2026-09-17

| Item | Value |
|---|---|
| HEAD commit | `b3f6504` — "P0: crash-proof the server, freeze content regeneration, fix security and billing, honest AI errors" |
| Branch | `main` |
| Remote | `github.com/Crowned090129/tongue` (**public repository**) |
| Working tree | Clean (`git status --porcelain` empty) |
| Pushed | Local ref `origin/main` equals HEAD; `git rev-list --left-right --count origin/main...HEAD` → `0 0`. No network fetch was performed, so this reflects the last successful push, not a live check of GitHub. |
| **Deployed to Fly** | **No.** P0 has not been deployed. |

### Deployed versus on `main` — be exact

- **On `main` (and on GitHub):** all of P0. See §3.
- **Running in production (`tongue-app.fly.dev`):** the **pre-P0 build**. Nothing in P0 is live.

Consequences of that gap, and they are the most important facts in this document:

1. The crash class S1 is still live. In the deployed build a rejected `await` in an async route
   still ends the process.
2. `POST /api/stripe/create-portal` is still unauthenticated in production (B1). Any email still
   returns a live Stripe Billing Portal link.
3. The content freeze is **code-side only**. The deployed build still regenerates content at boot
   and every 6 hours. The thing actually stopping regeneration in production today is that the
   Anthropic calls fail — the forensics run observed the live chat endpoint returning
   `error:"credits"` (`docs/ARCHITECTURE_FORENSICS.md` §2.3). Whether that is still true right now is
   **unknown — needs checking**. This is why the owner's "no Anthropic credits until the freeze is
   live" instruction is load-bearing and not merely cautious.
4. The honest AI error contract, the admin hardening, the renewal fix and the webhook transaction
   are all on `main` only.

**To verify which build is live** once a deploy happens: `GET /api/version` returns
`{version, startedAt}`, where `version` is `FLY_IMAGE_REF || GIT_SHA || "dev"`, with
`Cache-Control: no-store` (`app.js:91`). This endpoint is itself new in P0, so it does not exist on
the deployed build — a 404 from it is current-state confirmation that P0 is not live.

**Second Fly app.** `tonge-app.fly.dev` (typo host) is referenced by `.env.example`,
`native/ios/.../APIClient.swift` and `native/android/app/build.gradle.kts`.
`capacitor.config.json:6` points at the correct `tongue-app.fly.dev`. Whether `tonge-app` shares
the production `DATABASE_URL` — and therefore duplicates cron jobs — is **unknown — needs
checking**; gate G7 in `docs/MIGRATION_PLAN.md` §2 (gate G7) exists precisely to establish it before anything is
scaled down. Do not state the shared-database claim as fact until `fly secrets list --app
tonge-app` (or equivalent) has been run by the owner.

---

## 2. Migration phases

Status is against `docs/MIGRATION_PLAN.md` §3.

| Phase | Scope (one line) | Status | Evidence |
|---|---|---|---|
| **P0** | Safety net and production stabilisation | **Done in code, not deployed, tail open** | Commit `b3f6504`, 26 files, +4284/−599 (`git show --stat`). Detail and gaps in §3–§4. |
| P1 | Build and module extraction, dead-code removal | Not started | No Vite config, no `src/`, `public/index.html` is still one 8,621-line file with in-browser Babel |
| P2 | Language Registry, content identity, shared foundations | Not started | Blocked by **G1**. No content item carries an `id`: a walk over all 84 seed files finds no `id`/slug/key field at any depth |
| P3 | Design tokens, app shell, URL routing, navigation | Not started | Navigation is still a single in-memory back-stack with no URL/history integration |
| P4 | Learner Model foundation and sync | Not started | Learner data is still `localStorage`-only; no progress table exists in the 14-table schema |
| P5 | Today v1 | Not started | — |
| P6 | Curriculum model and Learn journey | Not started | — |
| P7 | Generic Lesson Engine | Not started | — |
| P8 | French lessons in the engine | Not started | — |
| P9 | Practice and Review integration | Not started | — |
| P10 | Sentence Breakdown system and Analyze workspace | Not started | — |
| P11 | Coach with context and AI features | Not started | Blocked by **G3** for entitlements |
| P12 | Learner-state connections and Today v2 | Not started | — |
| P13 | Responsive, accessibility and polish audit | Not started | — |
| P14 | Regression testing, E2E verification, release docs | Not started | No `docs/verification/` directory exists |

P0 does **not** meet its own exit criteria in `MIGRATION_PLAN.md`. Specifically: there is no CI, no
production content snapshot, and gate inputs G1–G7 have not been collected. See §4 and §5.

---

## 3. What P0 changed

Grouped by outcome. Each row names the forensics finding it closes and how it was checked.
"Verified here" means re-verified in this session against the working tree at `b3f6504`.

### 3.1 The server no longer dies on a failed await

| Change | Closes | Verification |
|---|---|---|
| `utils/asyncHandler.js` — `Promise.resolve(fn(req,res,next)).catch(next)`, default export | S1 | **Verified here.** Audited every route file: `admin.js` 10/10, `auth.js` 10/10, `claude.js` 2/2, `content.js` 6/6, `push.js` 2/2, `streaks.js` 2/2, `stripe.js` 3 of 4 (the fourth, `GET /prices` at `stripe.js:27`, is a synchronous handler and needs no wrapper), `support.js` 1/1. **Zero unwrapped async handlers remain.** |
| Final error middleware in `app.js` (`app.js:295`) — JSON for `/api*` and `/admin/api/*`, text/plain elsewhere; `invalid_json` 400, `payload_too_large` 413, `cors_rejected` 403, `internal_error` 500 | S1 | Verified by hand at P0 (local boot: malformed body → 400 `invalid_json`, process still alive). **Not re-verified here** — no regression test exists. |
| `unhandledRejection` logs loudly; `uncaughtException` exits 1 for a clean Fly restart (`server.js`) | S1 | Verified by hand at P0. Not re-verified here. |
| `app.set("trust proxy", 1)` (`app.js:34`) so per-IP limiters key on the visitor | S5 | Verified by hand at P0 against a local Postgres (rate-limit keys read back as the right-most `X-Forwarded-For` entry). Not re-verified here. |
| `db.claimJobRun(job, slot)` + `job_runs` table — one machine per cron slot | S4 | **Verified here** by code read: `db.js:184` (table), `db.js:374` (`INSERT … ON CONFLICT DO NOTHING RETURNING job`). Note this differs from the plan, which specified `pg_try_advisory_lock`. |
| `fly.toml` health check on `/health` (grace 20s, interval 30s, timeout 5s) | S3 | **Verified here**: `fly.toml:30-35`. Not exercised against Fly — not deployed. |
| `GET /api/version` | S3 | **Verified here**: `app.js:91`. Not exercised in production. |
| Dockerfile pinned to `node:20.20.2-alpine`, `npm ci --omit=dev`, `USER node` | S3 | **Verified here** by reading `Dockerfile`. **Image never built** — no Docker daemon on this machine, and building is a network operation the safety rules forbid. Build success is **unverified**. |

### 3.2 Content is frozen

| Change | Closes | Verification |
|---|---|---|
| `CONTENT_AUTOGEN` must be exactly `"on"`; boot logs which mode is active (`server.js:56-59`) | forensics §2.3 / `content-2`, `content-3` | **Verified here** by reading `server.js:56-59`; both banner strings are explicit. A prior run confirmed `isAutogenEnabled() === false` and `generateContent("fr","grammar")` rejecting with `AutogenDisabledError` / `autogen_disabled` under the local test env. |
| `seedContent` no longer overwrites an existing row unless `CONTENT_SEED_UPGRADE=on`; held rows are logged | forensics §2.3 | Verified by the content mapper's run against a throwaway DB. Not re-verified here. |
| Corrupt cached JSON falls back to the seed instead of throwing; concurrent generation per `(lang,tab)` de-duplicated | forensics §2.3 | **Verified here** by reading `routes/content.js:1644-1670`. The corrupt row is deliberately left in place — replacing it would remap lesson progress. |

**Why the freeze matters, mechanically:** a lesson has no id. Completion is stored client-side as an
array position (`"g12"` = `content.sections[12]`). Regenerating a `content_cache` row silently
repoints every user's completed lessons at different material. There is no way to detect or undo it
after the fact.

### 3.3 Security and billing

| Change | Closes | Verification |
|---|---|---|
| `create-portal` requires `requireAuth` and uses the caller's own `stripe_customer_id`; the request body is ignored (`routes/stripe.js:84`) | B1 | Verified by the identity/money mapper by calling the endpoint with and without a Bearer token (401 / 200). **The client was never updated — see §4.** |
| Webhook: the `stripe_events` insert and the handler run in one `db.transaction`, emails fire after commit, failures return 500 so Stripe retries (`routes/stripe.js:141-164`) | B4 | Verified by the identity/money mapper with a stubbed Stripe client (`__setStripeClientForTests`, no network): duplicate replay → `{received:true,duplicate:true}`, handler throw → rollback + 500. |
| Renewals extend the existing code with `GREATEST(...)` instead of deactivating it (`extendActiveCodes`, `routes/stripe.js:172`) | B5 | Verified by the same stubbed-webhook run: the same code id and string survived a renewal with a later expiry. |
| Suspended accounts can no longer be reactivated by signing up again | B3 (partial, G2-safe) | Verified by the identity mapper: `/login` and `/signup` both return 403 `account_suspended`. **Note:** only `suspended` is sticky — a `cancelled` account is still silently reactivated to `active` by a plain `/signup`. That is unchanged by P0 and still open. |
| A signup session for an existing email is `verified:false` and cannot delete the account | B2 | Verified by the identity mapper: a `/signup` token gets 403 `verification_required` on `DELETE /account`; a magic-link token gets 200. |
| Admin: `crypto.timingSafeEqual` over SHA-256 digests, header-only `x-admin-token` (no `?token=`), server-side logout (`routes/admin.js:35,45,88`) | B8 (code part) | Verified by the identity mapper: `?token=<valid>` → 401; logout → subsequent call 401 `admin_session_invalid`. |
| `language`/`nativeLang` validated against `VALID_LANGS`; no silent French default | B10 | Verified by hand at P0 (invalid language → 400). |
| Rate limiting is one atomic `INSERT … ON CONFLICT … WHERE` statement; AI quota is reserved before the call and refunded on every failure | B11, D18 | Verified by the server-core mapper: with max=2, the third hit returned `allowed:false` and the stored count stayed at 2 (a denial consumes nothing). |

### 3.4 Honest AI and content errors

| Change | Closes | Verification |
|---|---|---|
| `utils/aiErrors.js` — one contract, 7 codes, real statuses, `{code,error,message,retryable}` + `Retry-After` | L2 | Verified by the server-core mapper by invoking `sendAiError` for all 7 codes plus an unknown code. `ai_unconfigured` and `ai_unavailable_credits` are 503/not-retryable with `Retry-After: 3600`. |
| `/api/claude/chat` opens upstream **before** flushing SSE headers, so a pre-stream failure is a real JSON status instead of a 200 stream carrying an error | L3 | Verified by hand at P0 (chat returned JSON instead of a fake SSE stream). Not re-verified here. |
| `/api/support` answers honestly instead of 200 + a fabricated apology | L16 | Verified by hand at P0 (support → 503). |
| Client: one `aiErrorMessage` / `contentErrorMessage`; "check your connection" only when `fetch` itself fails | L2 | **Partially landed.** The contract exists (`ApiRequestError` at `public/index.html:2960`, `readApiError` 2981, `aiErrorMessage` 2998, `fetchContent` 3008, `contentErrorMessage` 3018) and six call sites use it correctly. Several do not — see §4. |

### 3.5 Test harness

| Change | Verification |
|---|---|
| `tests/support/assertTestDatabase.js` — in test mode `db.js` opens only `TEST_DATABASE_URL`, and only a local `*_test` database. `DATABASE_URL` is unreachable from tests. | **Verified here.** Full suite run under the mandated env prefix against `postgres://tongue@127.0.0.1:55432/tongue_verify_test`: **24 tests, 8 suites, 24 pass, 0 fail, 318 ms.** Prior negative runs confirmed the guard throws for a remote host, a non-`_test` database name, and a missing variable. |
| `smoke.test.js` no longer loads `.env`, fails loudly instead of skipping, and expects 200 for streaks | Covered by the same run. |

### 3.6 One claim in the P0 commit message is not true of the code

The commit message states:

> "Review and Flashcards share one deck-stats helper, so their counts agree; Review filters by the
> current language (it read nextReview while cards store next_review)."

**That fix is not in the working tree.** Verified here by grep:

- `fcDeckStats` is defined at `public/index.html:2833` and used at exactly **one** site — `Flashcards`, line 5181.
- `ReviewScreen` (line 6598) does not call it. It still reads the wrong field at three places:
  `6602` `allCards.filter(c => (c.nextReview || 0) <= now)`, `6603` `filter(c => !c.nextReview)`,
  `6647` `filter(c => c.nextReview && c.nextReview > now)`.
- Cards are stored with `next_review` (7 occurrences in the file).

Effect, by inspection: `nextReview` is always `undefined`, so `undefined || 0 <= now` is true for
every card — "due" always equals the whole deck, "unseen" always equals the whole deck, "upcoming"
is always 0, and the progress bar is always 0%. `ReviewScreen` also destructures `tLang` and never
uses it, so it counts every language's cards while `Flashcards` scopes to the current one.

Treat the half of the commit message covering client work as a statement of intent, not of fact —
the client owner agent did not finish. The server half of the message matches the code.

---

## 4. The unfinished P0 tail

P0 was implemented by six file-partitioned agents. The run was cut off by a usage limit before the
regression-test agent, the cross-owner coordination step and the adversarial review ran. The
following is what is left.

### 4.1 Regression tests — none written

The P0-specific tests the plan calls for do not exist. `tests/smoke.test.js` is still the entire
suite (24 tests). Missing, each one a regression for a fix that currently has no automated guard:

- [ ] Malformed body → 400 and the process stays alive (S1)
- [ ] `create-portal` without a token → 401; with a token → only the caller's own customer (B1)
- [ ] Webhook handler failure → 500, then the retry processes exactly once (B4)
- [ ] Renewal webhook keeps the access code active (B5)
- [ ] Simulated credits error → 503 `ai_unavailable_credits`, quota **not** charged (L2, B11)
- [ ] The test-database guard refuses a non-local `TEST_DATABASE_URL` (verified by hand, not by test)
- [ ] The limiter stays within its limit under 20 concurrent requests (D18)

### 4.2 Adversarial review — never ran

No independent pass looked for holes in the P0 changes. §3.6 is what one grep found; assume more.

### 4.3 Client call sites still on the old contract

Verified here by grep against `public/index.html`:

- [ ] **Billing portal is broken end to end.** `openBillingPortal` at line 4727 still sends only
      `Content-Type` and a `{ email }` body — no `Authorization` header — against an endpoint P0
      made `requireAuth`. Every click returns 401. Compounding it, the only call sites for
      `create-portal` (4727) and `DELETE /api/auth/account` (4704) live inside `SettingsPanel`,
      which has **zero JSX mount sites** (`grep -c "<SettingsPanel"` → 0). The live
      `SettingsOverlay` (mounted at 8458) has neither control. **A paying user cannot cancel or
      delete from the app at all.**
- [ ] Eight hardcoded "Connection error. / Connection issue." strings remain at lines 3184, 3203,
      3251, 3272, 4718, 4735, 8154, 8537. Two (4718, 4735) are in the dead `SettingsPanel`; the
      other six are live.
- [ ] `ReviewScreen` field-name bug — §3.6.
- [ ] `UpgradeOverlay` (line 6881) still sells "All 12 languages" and "Unlimited cards" and
      "Unlimited coaching" as Premium features. Free users already have all 12 languages and
      unlimited local cards, and paid coaching is capped at 300 messages/day
      (`routes/claude.js:131`, `isFree ? 5 : 300`). The P0 plan-copy fix landed in
      `public/subscribe.html` only (verified by reading the commit diff for those files).
- [ ] `UpgradeOverlay` has no Escape handling and no dialog semantics. Verified here:
      `grep -c "Escape"` over the whole file → **0 matches**, and
      `grep -c 'role="dialog"\|aria-modal'` → **0**. Dismissal is backdrop click or the "Maybe
      later" text. This was listed as "not confirmed"; it is now confirmed absent.

### 4.4 Deploy and production verification — not done

- [ ] `fly deploy` (per `DEPLOY.md:62`). Rollback if needed: `fly releases`, then
      `fly deploy --image registry.fly.io/tongue-app:<previous>` (`DEPLOYMENT_CHECKLIST.md:204-209`).
      The exact image-tag form is documented but **unverified** — no `fly` command has been run.
- [ ] Confirm `GET /api/version` returns the P0 build.
- [ ] Confirm the Fly health check passes.
- [ ] Confirm the boot log shows the content-freeze line.
- [ ] Re-walk forensics live flows 1–10; expect identical behaviour except honest AI messages.

### 4.5 P0 deliverables from the plan that were never built

Verified here by existence check — all absent: `.env.test`, `tests/compose.yml`, `.github/`
(no CI), `scripts/export-content-snapshot.js`, `docs/verification/`. `zod` is not a dependency
(`grep -c zod package.json` → 0), so the planned schema validation was not implemented; input
validation is hand-rolled. The `tongue-app-staging` app was not created (unverifiable from the repo).

`scripts/validate_seed.js` exists and works but is wired into **no** npm script and no gate. It
currently exits 1.

---

## 5. Open decision gates

None of G1–G7 has been decided. Each blocks work; each has a safe default already in force.

| Gate | Decision needed | Blocks | Safe default in force now | What the owner must supply |
|---|---|---|---|---|
| **G1** | Canonical content: the production `content_cache` rows, or the repository seeds? | P2 content IDs, and therefore all progress mapping, P6–P8 | Regeneration frozen in code; production content served unchanged | A **read-only** snapshot of production `content_cache`. The first attempt was blocked by a permission prompt and never taken. Safest first probe: `GET /api/content/status` (admin) returns per-`(lang,tab)` `generated_at` without exposing content bodies. |
| **G2** | Account-status semantics — should `requireAuth` enforce `users.status`? | The remaining half of B3 | Only the `suspended` reactivation was stopped. No new lockouts. A suspended or deleted free account still passes `requireAuth` on every route except `/api/auth/validate` until its 90-day token expires. | A ruling on whether a former subscriber (`status='cancelled'`, `plan='free'`) should keep free access. If yes, status enforcement must exempt them. |
| **G3** | Entitlement model: codes → subscriptions, plus admin grants | Entitlements work in P11 | Code-based access kept; the renewal logout fixed by extending codes instead of rotating them | A decision on whether admin-issued codes without a Stripe subscription keep access. Note `requirePaid` (`routes/auth.js:672`) is exported and attached to **zero** routes — the only enforced paid/free difference today is the AI message quota. |
| **G4** | Require verification for existing emails on `/api/auth/signup` | The rest of B2 | Signup issues a `verified:false` session that cannot delete the account. Nobody is blocked. | Confirmation that production email actually delivers — send one magic link to yourself. `sendEmail` returns `false` in console-fallback mode. The Stripe webhook does check it (`routes/stripe.js:160` logs "not delivered"), but the four callers that matter for sign-in do not — `routes/auth.js:265` (welcome/access code), `384` (magic link), `472` (resend code) and `routes/admin.js:268` all `await sendEmail(...)` and discard the result, so a silent non-delivery reads as success. |
| **G5** | Secret rotation | Closing B8 | `DEPLOY.md` placeholders in the working tree | **Rotate `ADMIN_PASSWORD` on both Fly apps (`tongue-app` and `tonge-app`).** The old value is still in this public repo's history (commit `a5a4718`, per the P0 commit message). Not confirmed done. Only an 8-character prefix of `JWT_SECRET` was published; rotating `JWT_SECRET` signs out every user, so it is a separate decision. |
| **G6** | Cleaning production test residue (`test_*@tongue-test.invalid`) | P0 ops close-out | Count only, read-only. No deletion. | A row count from production, then a delete/keep decision. |
| **G7** | Retiring `tonge-app.fly.dev` | P0 ops, native client work | Left running, untouched | Its `DATABASE_URL` host. If it shares the production database it duplicates cron jobs; if it does not, it is merely a stale build. **Currently unknown.** Never destroy it before this is answered. |

---

## 6. Risks, ranked

Ranked by expected harm (severity × likelihood), highest first.

### R1 — The admin password is in public git history and may not be rotated

- **Exposure:** the repository is public. `DEPLOY.md` carried the real `ADMIN_PASSWORD` from the
  first commit (`a5a4718`) until P0 replaced it with a placeholder in the working tree. Git history
  is unchanged and is world-readable.
- **What that password reaches:** `/admin/api/*` — user list, code generation, code revocation,
  account status changes, per-user email. One shared password, no per-admin identity, no IP binding,
  8-hour sessions.
- **Mitigation in place:** timing-safe comparison, header-only token, server-side logout, 5
  attempts / 15 min per IP — all on `main`, **none deployed**.
- **Residual risk: high.** Rotation is not confirmed. Until it is, assume the credential is
  compromised. Rotating costs nothing and breaks nothing (G5's own note: "no user impact").
- **Action:** rotate on **both** Fly apps today. Do not wait for the deploy.

### R2 — P0 is not deployed, so every fix it contains is still absent from production

- Live today: the S1 crash path, the unauthenticated billing portal (B1), the renewal logout (B5),
  non-atomic rate limiters (B11), "check your connection" for credit exhaustion (L2), the admin
  `?token=` query parameter (B8), and unfrozen content regeneration.
- **Mitigation in place:** none in production. On `main` only.
- **Residual risk: high**, and it grows with every day the gap stays open, because the two states
  drift and the deploy gets harder to reason about.
- **Action:** deploy, then verify §4.4. Deploying is the single highest-value action available.

### R3 — Content regeneration would remap every learner's progress

- **Mechanism:** no content item has an `id` at any depth (verified by a walk over all 84 seed
  files). Lesson identity is array position: `learn_progress_<lang>` holds `"g12"`, meaning
  `content.sections[12]` of whatever row is in `content_cache` right now. Roadmap ticks are
  `"<phase>-<milestone>"`. Regenerating or re-seeding a row silently repoints all of it.
- **Mitigation in place:** `CONTENT_AUTOGEN` and `CONTENT_SEED_UPGRADE` both default off — **on
  `main`**. In production the de facto brake is that Anthropic calls fail (observed as
  `error:"credits"` at forensics time; current state unknown).
- **Residual risk: high while undeployed, medium after.** The residual after deploy is human: two
  `npm` scripts still exist that bypass the freeze. `npm run prewarm` / `prewarm:force`
  (`scripts/prewarm-content.js:17`) loads the production `.env` — production `DATABASE_URL` and
  real Anthropic credits, with no test guard. It happens to crash on `require("better-sqlite3")`
  (not in `package.json`, not in `node_modules`) and it writes a column named `content` where
  production has `content_json`, so today it is inert. That is luck, not design.
- **Action:** deploy the freeze; do not add Anthropic credits until it is confirmed live; delete
  `prewarm` and its two npm scripts, or rewrite them against `db.js` with a guard.

### R4 — A fresh database ships 16 broken content tabs

- **Measured, not inferred.** Ran `node scripts/validate_seed.js` under the test env prefix:
  **68 valid, 16 invalid, 0 missing (of 84)**. All 12 `grammar.json` fail "section 0 needs ≥3
  examples"; `fr`, `es`, `de`, `pt` `vocab.json` fail "category 0 has too few words (need ≥30)".
- **Root cause:** commit `ae35713` raised `validateContent` (grammar now needs an `examples` array
  of ≥3 plus `common_mistake`; vocab needs ≥30 words each carrying `ex`) and deepened only 8 vocab
  seeds. No grammar seed was ever re-authored, and `seed/SCHEMA.md` still documents the **old**
  shapes — anyone authoring from the spec today reproduces the failure.
- **Effect:** `loadSeedFile` returns null for an invalid file, so on a database with no row for
  those pairs `GET /api/content/:lang/:tab` falls through to
  `503 {"code":"content_unavailable"}` (`routes/content.js:1665-1667`, read here). The advertised
  zero-AI fallback does not exist for grammar in any language, nor for fr/es/de/pt vocab.
- **Production is unaffected** because its rows already exist — they are older AI-generated rows,
  not the repo seeds (forensics §2.3). But that also means **the repo cannot rebuild them.**
- **Residual risk: high for disaster recovery, zero for current users.** If the production database
  were lost or rebuilt, 16 tabs would be gone with no source to restore from.
- **Action:** take the G1 snapshot before anything else touches content. Then either relax the
  validator or re-author 16 seed files — and either way write the legacy id map first, because both
  choices change array contents (R3).

### R5 — A second Fly app may be running duplicate crons on the production database

- `tonge-app.fly.dev` is a live older build. If it shares `DATABASE_URL`, it sends duplicate streak
  reminders and, before the freeze, ran duplicate content regeneration.
- **Mitigation in place:** P0 added `job_runs` claim locking (`db.js:374`), so **once both apps run
  P0 code** only one machine per slot acts. `tonge-app` runs old code, so it does not participate in
  the lock.
- **Residual risk: medium, and unquantified** — the shared-database premise is itself unverified
  (G7). Do not repeat it as fact.
- **Action:** read `tonge-app`'s `DATABASE_URL` host. That single fact closes G7 and sizes this risk.

### R6 — A paying user cannot cancel or delete from inside the app

- Both endpoints are live and correct server-side; their only client callers are in dead code, and
  the one that exists would 401 anyway (§4.3).
- `privacy.html` and `terms.html` describe deletion and cancellation as available.
- **Mitigation in place:** none. Users must email.
- **Residual risk: medium** — a consumer-protection and trust problem, not a technical one.
- **Action:** add both controls to `SettingsOverlay` and add the `Authorization` header. Small,
  self-contained, needs no gate.

### R7 — There is no CI and no client test coverage

- 24 smoke tests run only when someone remembers. `public/index.html` — 569 KB of browser-compiled
  JSX — has zero tests, no lint, no build, no typecheck. `validate_seed.js` gates nothing.
- **Residual risk: medium and compounding** — P1–P14 are large refactors with no safety net beneath
  the client.
- **Action:** the cheapest useful step is a GitHub Actions workflow that runs `npm test` plus
  `node scripts/validate_seed.js` against a Postgres service. Note the validator currently exits 1,
  so wire it as non-blocking first or fix the seeds first.

### R8 — Migrations are invisible

- Every `ALTER` and `CREATE INDEX` in `db.js` runs under `.catch(() => {})` (`db.js:219`, `db.js:239`).
  A genuinely failed migration is silent and the boot still logs "Schema ready ✓". There is no
  schema-version table, so nothing can detect drift between production and `initialize()`.
- **Residual risk: low today, high the moment schema work starts** (P2, P4).
- **Action:** before P4, add a migrations table and stop swallowing errors.

---

## 7. Deferred by the owner

These are decisions, not oversights. Do not action them without an explicit go.

| Item | Status | Note |
|---|---|---|
| Deep vocabulary for **es, fr, pt, de** | Deferred until the owner says go | These four are exactly the vocab seeds that fail the validator (R4). Any regeneration is also an R3 event. |
| Anything that costs money | On hold | Includes topping up Anthropic credits — explicitly gated on the content freeze being confirmed live in production. |
| Native apps (iOS / Android) | Not in scope | The hand-written native clients still point at `tonge-app.fly.dev` while `capacitor.config.json` points at `tongue-app.fly.dev`. Unresolved, parked. |

---

## 8. Changelog

Append one entry per session. Newest first. Keep entries factual: what changed, what was verified,
and how.

### 2026-09-17 — `docs/PROJECT_STATE.md` created

- Created this file at HEAD `b3f6504`. No code changed.
- Re-verified in this session: the full test suite (24/24 pass, 318 ms, local
  `tongue_verify_test`); `scripts/validate_seed.js` (68 valid / 16 invalid / 0 missing);
  `asyncHandler` coverage across all 8 route files (zero unwrapped async handlers);
  `origin/main` equals HEAD; `docs/PROJECT_STATE.md` did not previously exist.
- **Correction recorded:** the P0 commit message claims `ReviewScreen` was fixed to use
  `fcDeckStats` and filter by language. It was not. `ReviewScreen` still reads `nextReview` at
  `public/index.html:6602`, `6603` and `6647` while cards store `next_review`, and `fcDeckStats` has
  exactly one caller (`Flashcards`, line 5181). See §3.6.
- **Newly confirmed:** `UpgradeOverlay` has no Escape handling and no dialog semantics — zero
  matches for `Escape` and zero for `role="dialog"`/`aria-modal` in the entire client file. It also
  still advertises "All 12 languages", "Unlimited cards" and "Unlimited coaching" as Premium
  features, all three of which are false (free has all 12 languages and unlimited local cards; paid
  is capped at 300 messages/day, `routes/claude.js:131`).
- **Flagged as unverified, against the working assumption:** that `tonge-app` shares the production
  database. `docs/MIGRATION_PLAN.md` §2 (gate G7) (G7) treats this as a thing to confirm, not a known fact, and no
  `fly` command has been run.

### 2026-09-17 — P0 implemented and pushed (`b3f6504`)

- 26 files, +4284 / −599. Crash-proofing, content freeze, security and billing fixes, honest AI
  errors, test-database guard. Full detail in §3.
- Verified by hand against a local throwaway Postgres and in a browser: `/health`, `/api/version`,
  honest AI errors, invalid language 400, chat returning JSON instead of a fake SSE stream, support
  503, malformed body 400, portal 401 without auth, admin `?token=` rejected, process alive after
  forced errors, content-freeze log line at boot; login gate, signup, onboarding, Home, Learn,
  Coach, Flashcards empty state.
- **Not done:** P0 regression tests, adversarial review, several client call sites, deploy.
