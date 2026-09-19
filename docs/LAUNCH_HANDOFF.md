# Tongue launch handoff — 2026-09-18

## Read this boundary first

- Repo: https://github.com/Crowned090129/tongue
- Working checkout: `/Users/coronado/Documents/ChatGPT/projects-tongue/tongue`
- Working branch: `codex/tongue-release-readiness`; previously pushed directly to `main` with authorization.
- Production: https://tongue-app.fly.dev/app ; app name `tongue-app`. Do not touch the separate typo app `tonge-app` without need/authorization.
- Last **verified deployed code**: `88994b5`. Documentation commit `0f73452` followed it.
- Production image: `registry.fly.io/tongue-app:deployment-01M2VDYVWAMWF0GT16ZGW52P1W`.
- Verified production at 23:35 UTC: health/database OK, version image above, public HTML contains guided-practice code. Authenticated production journey was not repeated.
- Latest hardening candidate: changes described below. **Not deployed.** Local build and 46 tests pass; browser/runtime release checks remain.
- Work stopped when automatic approval review could not run because the account usage limit was reached. This was not an unsafe-action rejection. Do not bypass approval. User then requested this repository handoff.

## User intent and operating constraints

The user rejects the product as disconnected lists with no explanation of how to improve. Desired outcome: a coherent learn → attempt → useful feedback → retry → delayed review journey, with polished navigation and honest progress. They supplied visual references with calm white cards, restrained color, clear hierarchy and focused mobile screens; those references are inspiration, not a request to copy another product. Preserve Tongue's existing logo and crimson identity.

They want everything ready for launch and millions of users. Neither a traffic model nor an operating budget is known. A pending question asked whether “millions” means registered users, monthly active users or simultaneous users, and what monthly infrastructure/AI budget applies. Do not silently assume a million concurrent users.

No subagents were used or requested. User is sensitive to quota consumption. Do not launch fleets, repeatedly reread the 200KB historical documentation, rewrite the framework, or deploy each small patch. No real customer messages, purchases, reset credits, or paid provider tests were performed.

## What is already live

`d1890f7`: bundled-content compatibility restored (84/84 seeds); corrupt cached content fails without substituting indexed content; review dates/language filters fixed; onboarding flow repaired; billing portal gated by explicitly verified identity; dialogs improved; honest plan limits; isolated preview and CI.

`88994b5`: vocabulary, grammar and dialogue lessons use rounds of at most five paired items. Study/listen → type or speak from memory → reveal → self-rate → retry/save/continue. No completion button before the final round. Course entry features conversation scenes; catalogue and full lesson references are collapsed. Reference tools point back to guided practice. Canonical data/order unchanged. 39 local tests and hosted CI passed; local browser round and dialogue entry verified. This is self-assessment, not automatic correction or evidence of learning effectiveness.

## Current unfinished hardening candidate

1. `routes/auth.js`: existing-email signup returns 409 rather than issuing a session. `INSERT ... ON CONFLICT DO NOTHING` closes the signup race. New initial unverified sessions have `signupOwner:true`; old unverified/legacy sessions must sign in again. Every authenticated request checks current account existence/suspension/deletion and paid-code nonce/expiry. Sensitive verification now requires `verified === true`. Deleted status is preserved by sign-in upsert.
2. Deletion fails closed when a billing customer exists but Stripe is unavailable or cancellation fails. It iterates all subscriptions and cancels nonterminal statuses. Database cleanup is transactional. **Still not complete data erasure:** audit all user-associated tables, retention obligations, concurrent webhooks and partial external cancellation. No real Stripe deletion was tested.
3. Magic-link delivery checks the mail helper's result, invalidates unsent links and returns 503 instead of claiming success. Missing-transport logs no longer print email content/login links.
4. `public/index.html`: learner cards, course completion, saved word-space items, roadmap and streak data use account-scoped storage. A one-time `learner_legacy_owner` marker assigns old unscoped data only to the account present at upgrade; no account at upgrade means old data is retained but not exposed to a later login. **Legacy ownership is an assumption**, since old data had no owner. Test migration and storage-denied behavior carefully. This is local isolation, NOT cloud sync or encryption. Browser storage can still be read by someone with access to the device/devtools.
5. Lesson attempt state (round, stage, index, draft, reveal state, missed items) persists in scoped storage with a content signature. Changed content invalidates the draft instead of applying it to different items. Final completion removes the attempt. Storage failure displays an alert. Browser reload/resume is **not yet verified**.
6. Startup validation now signs out rejected sessions; logout also removes saved access code to prevent automatic re-login. Audit cross-tab account switches and React state retained after logout/login; namespacing alone does not resolve every stale in-memory state path.
7. `scripts/build-client.js`: compiles the existing JSX into a content-hashed JS asset; generated HTML excludes Babel. `npm run build`; `public/build/` ignored. Production `/app` serves built HTML; assets use immutable caching, HTML no-cache. Docker uses a build stage then prunes dev dependencies. React/lucide still come from external CDNs; not yet vendored/pinned comprehensively. **Docker build and built-client browser check pending.**
8. `server.js`, `fly.toml`, `app.js`: SIGTERM draining, readiness 503 during drain, stop cron tasks, close idle connections and pool, 25s deadline / 30s Fly kill timeout. Request/header timeouts set. **Actual process termination/in-flight behavior not verified.**
9. `npm audit fix --ignore-scripts --no-fund` applied compatible updates. Large lockfile diff (~3K lines) needs clean-install review. Before fixes runtime audit showed 16 findings (3 high). After fix the all-dependency output reported 15 (11 moderate, 3 high, 1 critical); this includes development/native tooling. The **post-fix runtime-only audit did not execute** because approval review hit the quota limit. Do not claim vulnerabilities are cleared. Do not blindly run `--force`.

## Exact verification completed on this candidate

- `npm run build`: passed, generated `app.51048814384b4a36.js`, 482140 bytes at last run.
- `npm test`: **46 tests, 46 pass, 0 fail** with local PostgreSQL and test-only JWT secret.
- New tests: concurrent signup grants exactly one session, suspended/deleted/unsafe-legacy sessions rejected on ordinary endpoints, revoked paid nonce rejected, billing-unavailable deletion retains account, browser key isolation/legacy owner, failed magic-link delivery invalidates unsent token, readiness during draining. Existing lesson progression and API checks retained.
- Provider successes are mocked or not exercised. Test pass ≠ real email/Stripe/AI/audio verification.
- Last production verification belongs to the PREVIOUS release, not this candidate.
- Latest candidate not yet clean-installed, container-built, browser-tested, load-tested or deployed.

## Reproduce safely

Never load `/Users/coronado/Downloads/french-app/.env`; documented production credentials. The original checkout was left untouched. Never connect tests to production.

```sh
cd /Users/coronado/Documents/ChatGPT/projects-tongue/tongue
npm ci --ignore-scripts --no-audit --no-fund
npm run build
NODE_ENV=test TEST_DATABASE_URL=postgres://tongue@127.0.0.1:55439/tongue_final_test JWT_SECRET=local-test npm test
npm run validate:seed
npm audit --omit=dev --json
```

Existing isolated PostgreSQL14 cluster: parent `.local-postgres`; role `tongue`; localhost55439. If stopped:

```sh
/opt/homebrew/opt/postgresql@14/bin/pg_ctl -D ../.local-postgres -l ../.local-postgres/server.log -o '-p 55439 -h 127.0.0.1' start
```

Production-built client preview with providers intentionally blank:

```sh
PORT=3003 SERVE_BUILT_CLIENT=on TEST_DATABASE_URL=postgres://tongue@127.0.0.1:55439/tongue_release_test npm run preview:local
```

Use http://127.0.0.1:3003/app. Starting that preview was blocked before execution. Old port3001 preview may still be running stale server code: restart deliberately or use3003. Browser controls through `cua_repl`; read current documentation/state before use. Terminal/sandbox escalations are required for localhost networking here. Do not circumvent a failed approval.

## Efficient next sequence

1. Read this handoff, inspect `git status`/diff, run clean install + build + tests + runtime audit once. Review auth middleware, token compatibility and lock changes. Verify Node/cron compatibility after dependency updates. Add focused tests for new findings, not tests that merely mirror code.
2. Browser-test two local accounts: signup, existing-email rejection, explicit verified test login, logout and reload, language switch, legacy migration, no cross-account cards, draft resume and completion cleanup. Check storage unavailable and changed-content cases. Do not inject or use production credentials. Confirm old signup sessions recover to a usable sign-in screen. Test built HTML, not only raw JSX preview.
3. Returning-user recovery is now dependent on real email/Google/access-code login. Confirm configured sender and provider operation in an authorized test environment before broad rollout. A dangerous signup bypass is not an acceptable fallback for broken email.
4. Complete a single authored restaurant mission: outcome “order a meal and ask for the bill,” a small set of useful examples, an attempt in context, explanation of errors and a retry. Accept valid alternatives. Deterministic authored feedback can cover bounded tasks; an AI assessor needs schema validation, uncertainty/fallback, cost caps and quality evaluation. Do not mark an unfamiliar correct response wrong just because it differs from the reference. No claims of pronunciation assessment without actual evidence.
5. Persist account-owned progress server-side only after verified identity and conflict/recovery rules are defined. Local keys are an interim fix. Stable lesson/content versions must precede regenerated curricula; frozen positional IDs currently protect existing users.
6. Close launch gates below, then one reviewed deployment. Capture previous image, check hosted CI, rolling health, `/api/version`, public asset contents, and one authenticated critical journey. Update PROJECT_STATE after, keeping exact code/image identity distinct from docs-only commits.

## Launch gates — not yet satisfied

- Security: confirm rotation of publicly exposed admin credentials reported in old handoff, review admin auth, token revocation, CORS/CSP, rate limiting/abuse, user-generated HTML and secret handling. Never recover old exposed passwords from git history.
- Identity/recovery: verified email delivery and Google/access-code recovery; multi-tab/account lifecycle; deletion/retention policy and actual cleanup.
- Learning: human linguistic review, accessible prompts/feedback, no fabricated proficiency, end-to-end experience in each advertised language. The current English instructional copy is not a fully localized product.
- Payments: Stripe test checkout, webhook retry/idempotency/renewal/cancellation/refund and entitlement checks; no live charges without authorization.
- Data: backups, restore drill, ownership/schema migration, export, deletion, conflict handling and recovery after offline use.
- Operations: reproducible container build, graceful shutdown, monitoring/alerts, incident/rollback runbook, deployment probes, dependency review.
- Capacity/economics: define peak concurrency and request mix, test staging incrementally, database connections/indexes, shared rate limits, provider quotas/latency, queue/backpressure and per-user spending controls. Two healthy machines do NOT demonstrate million-user capacity. Do not stress production or provision expensive capacity without a budget.
- Accessibility/mobile: keyboard/focus, narrow screens, contrast, reduced motion, screen-reader status, audio permissions/failures, Safari/Firefox and slow/offline networks.

## Resources / code map

Start with local evidence: `docs/verification/2026-09-18-guided-practice.md`, `docs/verification/2026-09-18-release.md`, `docs/PILOT_CONTRACT.md`; `docs/CODEBASE_GUIDE.md` and `docs/ARCHITECTURE_FORENSICS.md` for navigation only, verify against code. `docs/HISTORY.md` explains prior rejected redesigns. `docs/ASTRA_*`, migration/target architecture are historical.

Primary vendor documentation starting points (re-check current details; these links are resources, not verification of this release):
- Express production guidance: https://expressjs.com/en/advanced/best-practice-performance.html
- Node HTTP lifecycle: https://nodejs.org/api/http.html
- PostgreSQL backup/restore: https://www.postgresql.org/docs/current/backup.html
- Fly deployment guidance: https://fly.io/docs/launch/deploy/
- Stripe webhook behavior/testing: https://docs.stripe.com/webhooks
- OWASP application verification: https://owasp.org/www-project-application-security-verification-standard/
- WCAG: https://www.w3.org/TR/WCAG22/

Use these when a specific gate needs them; avoid a broad research pass that substitutes for fixing known defects. No demand, efficacy, revenue, scale or profitability validation is available.
