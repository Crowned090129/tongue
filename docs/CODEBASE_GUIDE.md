# Tongue — Codebase Guide

**What this is.** A complete map of the code as it exists at commit `b3f6504` ("P0: crash-proof
the server…"), on branch `main`, pushed to `github.com/Crowned090129/tongue` (a **public** repo).
It is written for someone who has never opened the repository and needs to find any behaviour
without searching blindly.

**How to read it.**

- Every claim here was checked against the code at `b3f6504`, not against
  `docs/ARCHITECTURE_FORENSICS.md`, which describes the pre-P0 state in places and whose
  `routes/content.js` line numbers are now wrong.
- References are written `file.js:NNN` or "function `X` in `file.js`". Every line number was
  re-checked with `grep -n` / `sed -n` before it was written down. Line numbers move; the
  quoted identifier next to them is the durable part.
- Anything that could not be confirmed from the code or from a local run is marked
  **unverified** or **unknown — needs checking**. Nothing here is a guess presented as a fact.
- No production system was touched to write this: no `fly` command, no `git push`, no
  `npm install`, no provider call, and no read of the production database. Local runs used a
  throwaway Postgres on `127.0.0.1:55432` (see §8).

**What is NOT true yet, so you do not assume it.** P0 is committed and pushed but **not
deployed** — production is still running the pre-P0 image. P0 shipped without its own
regression tests and without an adversarial review (the run was cut short), so the 24 tests
that pass are the *pre-existing* smoke suite, not P0 coverage. Seven decision gates (G1–G7 in
`docs/MIGRATION_PLAN.md`) are still open and need the owner.

---

## 1. One-screen overview

### Request path

```
Browser
  │
  │  https://tongue-app.fly.dev/...
  ▼
Fly proxy            force_https = true, internal_port 3001   (fly.toml:16-17)
  │                  health check GET /health every 30s       (fly.toml:30-35)
  ▼
node server.js       Docker CMD; boots, then delegates        (Dockerfile:15)
  │
  ▼
app.js  ── the Express app, built with zero side effects (module.exports = app, app.js:324)
  │
  ├─ trust proxy 1 ........................ app.js:34   (req.ip = real visitor behind Fly)
  ├─ helmet (CSP + COEP off) .............. app.js:37
  ├─ cors (allowlist, 403 cors_rejected) .. app.js:55
  ├─ express.raw for /api/stripe/webhook .. app.js:68   ← must stay before express.json
  ├─ express.json({ limit: "100kb" }) ..... app.js:69
  ├─ GET /health, /api/version, /api/config app.js:73, 91, 103
  ├─ 8 route mounts ....................... app.js:109-116
  ├─ 12 generated SEO landing pages ....... app.js:260  (/learn-french … /learn-hindi)
  ├─ GET /help → 301 /faq, GET /, GET /app  app.js:267, 271, 277
  ├─ express.static(public, extensions html) app.js:282
  ├─ 404 → public/404.html ................ app.js:285
  └─ final error middleware ............... app.js:295  ← last app.use(), always
  │
  ▼
routes/*.js          8 modules, every async handler wrapped in asyncHandler
  │
  ▼
db.js                one pg Pool (max 20 per process), thin get/all/run helpers
  │
  ▼
Postgres             14 tables, created idempotently at boot by db.initialize()
```

There is **no ORM, no build step and no bundler**. The web client is one 8,621-line
`public/index.html` whose JSX is compiled in the visitor's browser by Babel loaded from
unpkg.com (`public/index.html:21`).

### Directory tree

| Path | What lives there |
|---|---|
| `server.js` | Process entry point. All side effects: env validation, crash guards, cron registration, `db.initialize()`, `seedContent()`, `listen()`. 157 lines. |
| `app.js` | Express app factory + full middleware chain + SEO pages + the one error middleware. Side-effect free so tests can `require("../app")`. 324 lines. |
| `db.js` | The only database module. Pool, `get/all/run/transaction`, schema, rate limiter, cron lock, paid-access check. 384 lines. |
| `routes/` | 8 route modules: `auth.js` (689), `admin.js` (689), `claude.js` (483), `content.js` (1861), `push.js` (56), `streaks.js` (68), `stripe.js` (438), `support.js` (94). |
| `utils/` | `aiErrors.js` (the AI failure contract), `asyncHandler.js` (the P0 crash fix), `email.js`, `push.js`, `codes.js`. |
| `public/` | The web client (`index.html`) plus 9 static pages, `brand.css`, `sw.js`, `manifest.json`, icons. 19 files. |
| `seed/` | `SCHEMA.md` (the authoring spec) and `content/<lang>/<tab>.json` — 84 files, 2.0 MB. |
| `scripts/` | `validate_seed.js` (safe, local, wired to nothing) and `prewarm-content.js` (dead **and dangerous** — see §9). |
| `tests/` | `smoke.test.js` (24 tests) and `support/assertTestDatabase.js` (the production guard). |
| `docs/` | `ARCHITECTURE_FORENSICS.md`, `TARGET_ARCHITECTURE.md`, `MIGRATION_PLAN.md`, `ASTRA_HANDOFF.md`, this file, plus older manuals. Excluded from the Docker image. |
| `native/` | Hand-written iOS (Swift) and Android (Kotlin) shells. Not built, not shipped in the web image (`.dockerignore:11`). |
| `assets/` | `generate-icons.js` (`npm run icons`). |
| `data/` | 3 leftover SQLite files (`french.db`, `-wal`, `-shm`) from before the Postgres migration. Nothing in the running app opens them. |
| `.claude/launch.json` | Tracked local-dev launch config pointing at a local Postgres with blank provider keys. |
| `app/`, `gradle/`, `cron/` | **Empty directory trees — 0 files each.** Leftovers. |
| `railway.json`, `railway.toml`, `nixpacks.toml` | Dead deploy configs for a platform no longer used. Still tracked, still copied into the image. |

---

## 2. Server

### 2.1 Boot sequence

Captured by actually running `node server.js` locally (see §8 for the exact env prefix):

```
[Server] Missing required environment variables: DATABASE_URL, ANTHROPIC_API_KEY, …
[Server] Continuing in dev mode with missing env vars
[Content] Automatic content generation is OFF: cached content is served unchanged. …
[DB] Initialising schema…
[DB] Schema ready ✓

Tongue server running on port 3199
  App:       http://localhost:3199
  Admin:     http://localhost:3199/admin
  …
```

In order, from `server.js`:

| Step | Where | Notes |
|---|---|---|
| 1. Force IPv4 DNS | `server.js:12` | `dns.setDefaultResultOrder("ipv4first")`. The comment still says "Railway". |
| 2. Load `.env` | `server.js:14` | Skipped entirely when `NODE_ENV === "test"`. `.env` holds production credentials. |
| 3. Crash guards | `server.js:20`, `:26` | `unhandledRejection` logs only; `uncaughtException` logs then `process.exit(1)` (`:28`) so Fly restarts the machine. |
| 4. Required-env check | `server.js:36` (`REQUIRED_ENV`), `:44` | `DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_PASSWORD`. **Fatal only when `NODE_ENV === "production"`** (`:47`); otherwise it warns and continues. |
| 5. Content-freeze banner | `server.js:56-59` | `CONTENT_AUTOGEN === "on"` — strict equality, any other value means off. Prints which mode it is in. |
| 6. Register 3 cron jobs | `server.js:79`, `:90`, `:105` | **Registered at module load, before `db.initialize()` has run.** |
| 7. `start()` | `server.js:121` | `await db.initialize()` (`:122`) → `seedContent()` unless `NODE_ENV==="test"` (`:128-129`) → `app.listen(PORT)` (`:135`). |
| 8. Failure | `server.js:154` | `start().catch` logs `[Server] Fatal startup error:` and exits 1 (`:156`). |

Gotchas:

- The startup banner prints `process.env.PORT` **as configured**, not the port actually bound.
- Because crons are registered before the schema exists, a job firing in that window on a
  brand-new database would fail on a missing `job_runs` table and be swallowed by its own
  `try/catch`.

### 2.2 Middleware order in `app.js`

Order is load-bearing. Anything inserted in the wrong place changes behaviour.

| # | Line | Middleware | Why it is here |
|---|---|---|---|
| 1 | 34 | `app.set("trust proxy", 1)` | Makes `req.ip` the visitor, not the Fly proxy. **Every per-IP rate limit depends on this.** Putting a CDN in front of Fly without raising the number would key every limiter on the CDN. |
| 2 | 37 | `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })` | CSP is off because the client loads React and Babel from unpkg and compiles JSX inline. |
| 3 | 41 | `app.disable("x-powered-by")` | |
| 4 | 55 | `cors({ origin: <allowlist fn>, credentials: true })` | Allowlist at `app.js:44-53`: `APP_URL`, `FRONTEND_URL`, `http://localhost:3000`, `http://localhost:5000`, `capacitor://localhost`, `ionic://localhost`, `http://localhost`, then `.filter(Boolean)`. **No `Origin` header ⇒ allowed** (curl, native, server-to-server). Unknown origin ⇒ `Error` with `err.code = "cors_rejected"`. |
| 5 | 68 | `express.raw({type:"application/json"})` mounted at `/api/stripe/webhook` | Stripe signature verification needs the raw bytes. body-parser sets `req._body`, so the `express.json` below skips it. |
| 6 | 69 | `express.json({ limit: "100kb" })` | Oversized bodies become a 413 in the error middleware. |
| 7 | 73, 91, 103 | `/health`, `/api/version`, `/api/config` | Unauthenticated, defined inline. |
| 8 | 109-116 | 8 route mounts | `/api/auth`, `/api/claude`, `/api/stripe`, `/api/streaks`, `/api/content`, `/api/push`, `/api/support`, `/admin` |
| 9 | 260 | 12 SEO landing pages | `GET /learn-<slug>` for `french, spanish, english, portuguese, italian, german, chinese, japanese, korean, russian, arabic, hindi` (`LANG_SEO`, `app.js:119`), `Cache-Control: public, max-age=3600`, rendered by `landingPage()` (`app.js:134`). |
| 10 | 267, 271, 277 | `GET /help` → 301 `/faq`; `GET /` → `public/home.html`; `GET /app` → `public/index.html` | |
| 11 | 282 | `express.static(public, { extensions: ["html"] })` | `/faq` serves `public/faq.html`, `/subscribe` serves `subscribe.html`, etc. |
| 12 | 285 | 404 fallback → `public/404.html` | Registered for **all** paths, so unknown API paths return HTML (see §9). |
| 13 | 295 | Final error middleware | **Must stay last.** |

Verified live (local probe, ephemeral port):

```
GET /health           -> 200 {"status":"ok","db":"ok","ts":"…"}
GET /api/version      -> 200 {"version":"dev","startedAt":"…"}
GET /api/config       -> 200 {"googleClientId":null}
GET /faq              -> 200 text/html
GET /learn-french     -> 200 text/html  (<title>Learn French Online — Tongue</title>)
GET /help             -> 301 -> /faq
GET /api/nope         -> 404 text/html   ← not JSON
GET /admin/api/unknown-> 404 text/html   ← not JSON
```

### 2.3 The error contract

One middleware (`app.js:295-322`) answers everything passed to `next(err)`.

`wantsJson` (`app.js:300`) is true when the path is exactly `/api`, or starts with `/api/` or
`/admin/api/`. JSON for those; `text/plain` with the same message everywhere else. Query
strings are stripped before logging (`app.js:299`).

| Condition | Status | Body | Log |
|---|---|---|---|
| `err.code === "cors_rejected"` (`app.js:304`) | 403 | `{"error":"This origin is not allowed.","code":"cors_rejected"}` — **JSON on every path**, not just API paths | `[CORS] Rejected origin <o> for <METHOD> <path>` |
| `err.expose === true` **and** 4xx, `err.type === "entity.parse.failed"` | as `err.status` (400) | `{"error":"The request body is not valid JSON.","code":"invalid_json"}` | — |
| same, `err.type === "entity.too.large"` | 413 | `{"error":"The request body is too large.","code":"payload_too_large"}` | — |
| same, any other exposed 4xx | as `err.status` | `{"error":"The request could not be processed.","code":"bad_request"}` | — |
| anything else | 500 | `{"error":"Something went wrong on our side. Please try again.","code":"internal_error"}` | `[Error] <METHOD> <path> → 500:` + the error |
| `res.headersSent` (`app.js:297`) | — | `return next(err)` → Express default handler. This is the SSE path. | — |

Only errors carrying `expose === true` **and** a 4xx status reach the client. A library error
that merely carries `statusCode` (Stripe, for instance) is deliberately reported as a 500.

Verified live: bad JSON on `/api/auth/signup` → `400 {"error":"The request body is not valid
JSON.","code":"invalid_json"}`; a 200 KB body → `413 {…"code":"payload_too_large"}`; a
disallowed `Origin` → `403 {…"code":"cors_rejected"}`.

**The AI error contract** is separate and lives in `utils/aiErrors.js` — see §2.6.

### 2.4 `db.js` helper reference

| Signature | Returns | Where |
|---|---|---|
| `get(text, params = [])` | first row object, or `null` | `db.js:34` |
| `all(text, params = [])` | array of rows (`[]` when nothing matches) | `db.js:39` |
| `run(text, params = [])` | `{ changes: res.rowCount, lastID: res.rows[0]?.id ?? null }` — `lastID` is **null unless the SQL ends in `RETURNING id`**. The module docstring at `db.js:7` omits `lastID`. | `db.js:44` |
| `initialize()` | creates 14 tables, then 11 `ALTER` migrations (`db.js:193`) and 13 `CREATE INDEX` statements (`db.js:223`) | `db.js:51` |
| `transaction(fn)` | whatever `fn` resolves to. `fn` gets a `tx` with the same `get/all/run`. Rejection rolls back and rethrows the **original** error; a failed ROLLBACK destroys the connection with `client.release(true)` (`db.js:364`) instead of poisoning the pool. | `db.js:339` |
| `hitRateLimit(key, maxAttempts, windowMs)` | `{ allowed, remaining, resetAt }`. One atomic `INSERT … ON CONFLICT DO UPDATE … WHERE`, so a **denied attempt consumes nothing**. | `db.js:298` |
| `refundRateLimit(key, resetAt)` | `undefined`. Decrements only when `window_reset = $2`, so a refund can never land in a newer window. Unknown key = silent no-op. | `db.js:321` |
| `checkIpRateLimit(key, maxAttempts, windowMs)` | `{ allowed, remaining }` only — deliberately narrower, no `resetAt` | `db.js:329` |
| `claimJobRun(job, slot)` | `boolean`. `INSERT … ON CONFLICT DO NOTHING RETURNING job` — true for exactly one caller per `(job, slot)` across all machines. | `db.js:372` |
| `hasActivePaidAccess(userId)` | `boolean`. Gate first: `users.plan !== 'free' AND users.status === 'active'` (`db.js:255`). Then true if a live `access_codes` row exists (`:258`), else true if `subscriptions.status` is `active`/`trialing` (`:270`) or `paid_access_until` is in the future (`:272`). | `db.js:251` |
| `trackEvent(userId, eventName, metadata = {})` | **`async` in signature only.** The INSERT is not awaited (`db.js:280`) and its errors are swallowed. Awaiting it gives no delivery guarantee. | `db.js:279` |
| `pool` | the raw `pg.Pool` — exported so tests can `pool.end()` | `db.js:21` |

Pool config (`db.js:21-28`): `ssl` false when local else `{rejectUnauthorized:false}`,
`family: 4`, `max: 20` **per Node process**, `idleTimeoutMillis` 30 000,
`connectionTimeoutMillis` 5 000.

Connection string (`db.js:17-19`): in test mode it is
`require("./tests/support/assertTestDatabase").assertTestDatabase()`; otherwise
`process.env.DATABASE_URL || "postgresql://localhost/tongue_dev"`.

Two things worth knowing before you touch this file:

- **Every migration and index runs under `.catch(() => {})`** (`db.js:219`, `:239`). A migration
  that fails for a real reason is completely invisible and the boot still prints `Schema ready ✓`.
  There is no schema-version table and no migration log.
- `window_reset` is `BIGINT`, and `pg` returns BIGINT **as a string** — which is why the code
  wraps it in `Number()` at `db.js:312` and `:314`.

### 2.5 Cron jobs

All three are `node-cron` schedules registered in `server.js`, each guarded by
`claimSlot(job, slot)` (`server.js:64`) which wraps `db.claimJobRun` so **N machines run the job
once**.

| Schedule | Job name | Slot key | Body | Gate |
|---|---|---|---|---|
| `0 20 * * *` (`server.js:79`) | `streak_reminders` | `utcDateSlot()` = `YYYY-MM-DD` (`:70`) | lazy-requires `./utils/push`, calls `sendStreakReminders(db)` | Firebase env vars; without them it claims the slot and logs a skip |
| `0 */6 * * *` (`server.js:90`) | `content_repair` | `utcSixHourSlot()` = `YYYY-MM-DDTHH`, HH ∈ 00/06/12/18 (`:72`) | lazy-requires `./routes/content`, calls `generateMissingContent()` | **`CONTENT_AUTOGEN` checked at `:91`, outside the try and before `claimSlot`** — with the freeze on, every machine logs the skip every 6 hours and no `job_runs` row is ever claimed |
| `0 3 * * *` (`server.js:105`) | `cleanup` | `utcDateSlot()` | `DELETE FROM admin_sessions WHERE expires_at < NOW()` (`:108`) and `DELETE FROM rate_limits WHERE window_reset < now-600000` (`:110`) | — |

**The "UTC" in the comments is only true because the container clock is UTC.** `node-cron`
3.0.3 is given no `timezone` option (grep for `timezone` in `server.js` returns nothing), so
matching uses process-local time while the slot keys are always UTC. Run the server on a
non-UTC host and the fire times shift while the slot keys do not. Whether the Fly machines
actually run `TZ=UTC` is **unknown — needs checking**; the Dockerfile and `fly.toml` set no `TZ`
and `node:20-alpine` defaults to UTC, but that was not confirmed against a running machine.

Retention: **only `admin_sessions` and `rate_limits` are ever pruned.** `job_runs`,
`magic_links`, `stripe_events`, `ai_usage_logs`, `analytics_events` and `content_reports` grow
without bound.

### 2.6 `utils/`

**`utils/asyncHandler.js` (18 lines).** The P0 crash fix. Express 4 ignores the promise an
async handler returns, so a rejected `await` became an `unhandledRejection` and killed the
process. `asyncHandler(fn)` (`:12`) returns
`function asyncRoute(req,res,next){ Promise.resolve(fn(req,res,next)).catch(next); }`.
Default export (`module.exports = asyncHandler`, `:18`) — not a named one.

**I verified that every async route and async middleware in the repo is currently wrapped**:
`grep -E "^router\.(get|post|patch|delete|put)\(.*async" routes/*.js | grep -v asyncHandler`
returns nothing, and the same check over `app.js` returns nothing. Any new async handler that
skips the wrapper silently reintroduces the crash class P0 removed. Note the wrapper only
catches rejections from the function it wraps — fire-and-forget work started inside a handler
still escapes to `server.js`'s `unhandledRejection` logger.

**`utils/aiErrors.js` (63 lines).** One contract for every AI-backed route. Body is always
`{ code, error, message, retryable }`, where `error` deliberately duplicates `message` for
clients written before `code` existed.

| Code | Status | `retryable` | `Retry-After` | Message |
|---|---|---|---|---|
| `ai_unconfigured` | 503 | false | 3600 | The AI tutor is unavailable right now. Lessons, review and the library still work. |
| `ai_unavailable_credits` | 503 | false | 3600 | *(same text)* |
| `ai_overloaded` | 503 | true | 60 | The AI tutor is busy right now. Try again in a minute. |
| `ai_timeout` | 503 | true | 60 | The AI tutor took too long to answer. Try again. |
| `ai_unreachable` | 503 | true | 60 | Tongue couldn't reach the AI tutor. Try again in a minute. |
| `ai_bad_output` | 502 | true | — | The AI tutor sent an answer Tongue couldn't read. Try again. |
| `ai_upstream_error` | 502 | false | — | The AI tutor couldn't handle that request. |

`Retry-After` is set on 503s only, keyed off `retryable`, not off the code (`:59`).

- `classifyUpstream(status, bodyText)` (`:33`): the **body regex wins over the status** —
  `/credit balance|purchase credits|billing|insufficient…credit/i` → `ai_unavailable_credits`;
  then 402 → credits; 401/403 → `ai_unconfigured`; 408 → `ai_timeout`; 429, 529 or ≥500 →
  `ai_overloaded`; else `ai_upstream_error`.
- `classifyFetchFailure(err)` (`:44`): `TimeoutError`/`AbortError` → `ai_timeout`, everything
  else → `ai_unreachable`.
- An **unknown code silently degrades to `ai_upstream_error`** in both `aiErrorBody` (`:51`)
  and the `AiError` constructor (`:25`) rather than throwing. A typo'd code produces the wrong
  user-facing message, not an exception.
- The file's stated rule (`:7-8`): "Check your connection" must only ever be shown when the
  *browser's own fetch* failed, never for a provider-side problem.

Verified live: with `ANTHROPIC_API_KEY` blank, `POST /api/claude` answered
`503 Retry-After: 3600 {"code":"ai_unconfigured",…}` and `POST /api/support` the same.

**`utils/email.js` (197 lines).** `sendEmail(to, subject, html)` (`:38`) → `Promise<boolean>`.
Fallback order **SMTP → Resend → console**, and it is a real fallback: an SMTP throw is logged
and Resend is tried. Transports are built at module load (`:4` Resend, `:11` SMTP), so setting
a key after boot has no effect until restart. `FROM` (`:21`) =
`${EMAIL_FROM_NAME || "Tongue"} <${EMAIL_FROM || SMTP_USER || "noreply@example.com"}>`.
SMTP requires all three of `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`; `secure` is true only when
`SMTP_PORT` is exactly `"465"` (`:15`).

**Console mode is a failure, not a success.** With no transport it logs
`[EMAIL] (no transport configured) …` then always
`[EMAIL] ✗ ALL transports failed for <to> — email NOT delivered` and returns `false`. I saw
both lines during every local signup. Four templates: `welcomeEmail` (`:66`),
`renewalEmail` (`:105`), `cancellationEmail` (`:138`), `paymentFailedEmail` (`:163`).

**`utils/push.js` (147 lines).** Firebase Cloud Messaging. `getMessaging()` (`:18`) returns
null unless both `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON` are set;
`firebase-admin` is an `optionalDependency` (present in `node_modules`). `sendPush` (`:49`)
**throws a plain object literal `{ stale: true, token }`** (`:73`) — not an `Error` — when FCM
reports the token is unregistered; both current callers test `e.stale`. `sendToUser` (`:84`),
`sendStreakReminders` (`:106`) is the 20:00 cron body. The reminder query compares
`s.last_practice < CURRENT_DATE::TEXT`, i.e. a Node UTC date string against the Postgres
session date — correct only while both clocks are UTC.

**`utils/codes.js` (24 lines).** `generateCode()` (`:5`) = `"TG-"` + 8 characters drawn from
`CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"` (`:3`) via `crypto.randomBytes(8)` and
`bytes[i] % CHARS.length`. 32 symbols (no I, O, 0, 1), so `256 % 32 === 0` and the modulo is
unbiased — **this only works because the alphabet length is a power of two**. 40 bits of
entropy; uniqueness relies on the UNIQUE constraint on `access_codes.code`, not the generator.
`codeExpiryDate(plan)` (`:14`) returns an ISO **string**: +1 year for `"yearly"`, +1 month for
anything else including `undefined`.

---

## 3. API reference

24 HTTP routes across 8 router files, plus 3 inline endpoints in `app.js`. Grouped by file.
"Auth" is `requireAuth` (Bearer JWT, `routes/auth.js:660`), `adminAuth` (the `x-admin-token`
header, `routes/admin.js:50`), or none.

### 3.1 Inline in `app.js`

| Method | Path | Auth | Success | Failure | Where |
|---|---|---|---|---|---|
| GET | `/health` | none | 200 `{status:"ok",db:"ok",ts}` | 503 `{status:"degraded",db:"error",ts}`, logs `[Health] Database check failed:` | `app.js:73` |
| GET | `/api/version` | none | 200 `{version, startedAt}`, `Cache-Control: no-store`. `version` = `FLY_IMAGE_REF \|\| GIT_SHA \|\| "dev"`; `startedAt` is when `app.js` was first required, not when `listen()` happened. | — | `app.js:91` |
| GET | `/api/config` | none | 200 `{googleClientId: string\|null}`, `Cache-Control: public, max-age=300` | — | `app.js:103` |

### 3.2 `routes/auth.js` — `/api/auth` (10 routes)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/login` | none | `{ code (required), email? }` | 200 `{token, expiresAt, email, plan}`, or 200 `{needsEmail:true}` for an unclaimed code with no email | 429 `{code:"rate_limited"}` (10/15 min per IP); 400 `{code:"invalid_input", field}`; 401 unknown/inactive/expired code; **403 `{code:"account_suspended"}` checked before code state**; 409 when the email belongs to another user |
| POST | `/signup` | none | `{ email }` | 200 `{token, email, plan:"free", expiresAt}` — the JWT carries `verified:false` | 429 `{code:"rate_limited"}` (5/h per IP *skipped when `NODE_ENV==="test"`*, 5/h per address always); 400 `{code:"invalid_input",field:"email"}`; 403 suspended; 409 `{error, hasPaid:true}` |
| POST | `/google` | none | `{ credential }` | 200 `{token, expiresAt, email, plan}` | 503 when `GOOGLE_CLIENT_ID` unset; 429; 400 invalid_input; 401 on verify failure or unverified Google email; 401 `Account not found.`; 403 suspended |
| POST | `/magic-link/request` | none | `{ email }` | **always** 200 `{sent:true}` (anti-enumeration), even when the per-address throttle trips | 429 only on the IP limit (8/h); 400 invalid_input |
| POST | `/magic-link/verify` | none | `{ token }` | 200 `{token, expiresAt, email, plan}`, `verified:true` | 401 invalid/expired/replayed; 403 suspended |
| POST | `/resend-code` | none | `{ email }` | **always** 200 `{sent:true}` | 429 (10/h per IP, 3/h per address); 400 invalid_input |
| GET | `/validate` | requireAuth | — | Three distinct shapes — see below | 401 `Account not found.` / `Account inactive.` / `Session expired…` / `{error, reason:"renewed"}` |
| POST | `/preferences` | requireAuth | `{ language?: /^[a-z]{2}$/, level? }` | 200 `{saved:true}`, or `{saved:false}` when both fields are absent | 400 `{code:"invalid_input", field}` |
| POST | `/onboarding` | requireAuth | `{ level?, goal?, dailyCommitment?: 5\|15\|30\|60, language? }` | 200 `{saved:true}`; also sets `onboarding_completed = TRUE` | 400 `{code:"invalid_input", field}` |
| DELETE | `/account` | requireAuth **+ `isVerifiedSession`** | — | 200 `{deleted:true}` | 403 `{code:"verification_required"}` for a `verified:false` session; 404 |

`GET /api/auth/validate` (`routes/auth.js:503`) returns one of three bodies:

1. **Free** (JWT plan free AND DB plan free):
   `{valid:true, email, plan:"free", onboardingCompleted, userLevel, userGoal, dailyCommitment, targetLang}`.
   Verified live against a fresh signup.
2. **Upgraded since login** (JWT free, DB paid): `{valid:true, email, plan, needsRelogin:true}` —
   note this body **omits every profile field**.
3. **Paid**: as (1) plus `expiresAt` (the access code's expiry), with `plan` always read from the
   database, never from the JWT.

Session JWTs (HS256, `JWT_SECRET`, which falls back to the literal
`"dev-secret-change-in-production"` at `routes/auth.js:9` when unset):

- **Paid**: `{userId, codeId, email, plan:"monthly"|"yearly", nonce, verified:true}`, `expiresIn "30d"`.
- **Free**: `{userId, email, plan:"free", verified: true|false}`, `expiresIn "90d"`. `verified:false`
  only from `/signup`. Confirmed by decoding a live signup token:
  `{"userId":99,"email":"…","plan":"free","verified":false,"iat":…,"exp":…}`.
- Legacy tokens have no `verified` key; `isVerifiedSession` (`routes/auth.js:54`) is
  `!!user && user.verified !== false`, so a **missing** claim counts as verified.
- No refresh token, no `jti`, no revocation list. The only paid-session kill switch is the
  2-slot nonce (`session_nonce`, `session_nonce_2`) plus `access_codes.is_active`.

**`expiresAt` in a paid response is the access code's expiry, not the token's** — up to ~365
days for a yearly plan while the JWT dies at day 30. See §9.

### 3.3 `routes/claude.js` — `/api/claude` (2 routes)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/` | requireAuth | `{prompt, maxTokens?, featureType?, language, nativeLang?}` | 200 = **the model's own JSON object returned verbatim**, plus `_meta:{plan:"free", remaining}` for free users | 400 invalid prompt; 400 `{code:"invalid_language", error:"language must be one of: fr, es, de, en, pt, it, zh, ja, ko, ru, ar, hi"}`; 401 (`reason:"renewed"` possible); 402 `{upgrade:true}`; 503 `ai_unconfigured` **before quota** so an unconfigured tutor costs no message; 429 `{code:"quota_exceeded", error, upgrade:isFree, resetAt}`; any AI failure via `sendAiError` |
| POST | `/chat` | requireAuth | `{messages:[{role,content}], scenario, level, language, nativeLang?}` | SSE stream: `data: {type:"delta", text}` repeatedly, then `{type:"done", remaining}` (`remaining` is null for paid) | Pre-stream failures are **ordinary JSON with a real status**; mid-stream failures arrive as `{type:"error", ...aiErrorBody(code)}` inside a 200 stream (`routes/claude.js:472`) |

Both use `model: "claude-sonnet-4-5"` (`routes/claude.js:237` and `:378`).
`POST /` caps output at `Math.min(maxTokens || 1000, 2000)` (`:238`); `/chat` at `400` (`:379`).
Upstream timeout 60 000 ms (`:11`). Messages are filtered to well-formed user/assistant turns,
capped at the last 20, each sliced to 2000 chars; the last turn must be `role:"user"`.

Quota (`reserveQuota`, `routes/claude.js:119`) is reserved **before** the upstream call and
refunded on every failure (`refundQuota`, `:142`), so a provider outage never burns a message:

| Plan | Daily | Burst |
|---|---|---|
| free | 5 per 24 h, key `String(userId)` | **none** — the burst reservation is inside `if (!isFree)` (`:124`) |
| paid | 300 per 24 h | 30 per 60 s, key `${userId}_burst` |

`checkAccess` (`:93`) **returns `{ok:true}` immediately for any free-plan JWT** (`:95`) with no
database lookup. Client disconnect is detected on `res` "close", not `req` (the comment at
`:360-362` explains why), and **does not refund** — the tokens were spent.

### 3.4 `routes/content.js` — `/api/content` (6 routes)

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/:lang/:tab` | requireAuth | See the outcome table below | 400 `{error:"Unknown language"}` / `{error:"Unknown tab"}` — **neither carries a `code`** |
| GET | `/status` | adminAuth | 200 `{langs, tabs, cached:{lang:{tab:generated_at}}, total, possible:84, names}` — the safe way to see what production holds without reading content bodies | 401 `admin_auth_required` / `admin_session_invalid` |
| POST | `/regenerate/:lang` | adminAuth | 200 `{message:"Regenerating all tabs for <Name>…"}` **sent before the work starts**; the loop then runs fire-and-forget with a 2 s gap per tab | 400 unknown language; **409 `{code:"autogen_disabled", error}`** |
| POST | `/regenerate/:lang/:tab` | adminAuth | 200 `{message:"Regenerating <Name> — <tab>…"}`, then fire-and-forget | 400; 409 `autogen_disabled` |
| POST | `/report` | requireAuth | 200 `{ok:true}`; note is sliced to 500 chars; fires `trackEvent(userId,"content_error_reported",{lang,tab})` | 400 `{code:"invalid_lang"\|"invalid_tab"\|"invalid_note"}`; 500 |
| GET | `/reports` | adminAuth | 200 `{reports:[{id,user_id,lang,tab,note,resolved,created_at}], names}`, newest first, LIMIT 200 | 401 |

`GET /api/content/:lang/:tab` outcomes, in the order the handler tries them
(`routes/content.js:1618-1679`):

| # | Condition | Response |
|---|---|---|
| 1 | `lang` not in `VALID_LANGS` | 400 `{"error":"Unknown language"}` |
| 2 | `tab` not in `VALID_TABS` | 400 `{"error":"Unknown tab"}` |
| 3 | Cached row parses | 200 `{content, generated_at, cached:true}` — **`generated_at` appears only here** |
| 4 | Cached row is corrupt JSON **and** a valid seed exists | 200 `{content:<seed>, cached:false, seeded:true}`; the corrupt row is **deliberately left in place** (replacing it would remap lesson progress), logged `[Content] Corrupt content_cache row …` |
| 5 | Corrupt and no valid seed | 503 `{code:"content_corrupt", error:"This section can't be loaded right now."}` |
| 6 | No row, valid seed exists | 200 `{content:<seed>, cached:false, seeded:true}` + a fire-and-forget `INSERT … ON CONFLICT DO NOTHING` |
| 7a | No row, no valid seed, autogen **off** | 503 `{code:"content_unavailable", error:"This section isn't available for this language yet."}` |
| 7b | No row, no valid seed, autogen **on** | 200 `{content, cached:false}` or 503 `{error:"Content is being prepared. Please try again in 30 seconds."}` — **no `code`** |

Verified live against a freshly seeded local database:
`fr/grammar` → 503 `content_unavailable`; `fr/vocab` → 503 `content_unavailable`;
`it/vocab` → 200 `cached:true`; `fr/dialogues` → 200; `fr/roadmap` → 200;
`xx/vocab` → 400 `Unknown language`; `fr/nope` → 400 `Unknown tab`.

Route-order note: `GET "/:lang/:tab"` is registered at `:1618`, **before** `GET "/status"`
(`:1680`) and `GET "/reports"` (`:1756`). That is safe — those are single-segment paths and
cannot match a two-segment pattern, and `/regenerate/:lang` is POST-only.

### 3.5 `routes/stripe.js` — `/api/stripe` (4 routes)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/prices` | none | — | 200 `{monthly:{amount:900,interval:"month",label:"$9 / month"}, yearly:{amount:7900,interval:"year",label:"$79 / year"}}` — **hardcoded** (`routes/stripe.js:27-32`), it does not read the live Stripe price objects | — |
| POST | `/create-checkout` | **none** | `{plan:"monthly"\|"yearly", email?}` | 200 `{url}`. `success_url` = `${APP_URL}/app?checkout=success`, `cancel_url` = `${APP_URL}/subscribe?checkout=cancelled`, `allow_promotion_codes: true`, `consent_collection.terms_of_service: "required"` | 400 `{code:"invalid_plan"}` / `{code:"invalid_email"}`; 500 `{code:"billing_unconfigured"}` when the matching `STRIPE_PRICE_*` is unset; 500 `{code:"checkout_failed"}` |
| POST | `/create-portal` | requireAuth | **ignored** — the customer comes from `SELECT stripe_customer_id FROM users WHERE id = req.user.userId` | 200 `{url}`, `return_url = APP_URL` | 401; 404 `{code:"no_billing_account"}`; 500 `{code:"portal_failed"}` |
| POST | `/webhook` | Stripe signature | raw Buffer | 200 `{received:true}` or `{received:true, duplicate:true}` | 400 `webhook_unconfigured` / `missing_signature` / `invalid_payload` (body not a Buffer) / `invalid_signature`; 500 `{code:"webhook_failed"}` after rollback so Stripe retries |

Webhook ordering (`routes/stripe.js:105-165`), which is the part that matters:

1. secret present → signature header present → `Buffer.isBuffer(req.body)` → `constructEvent`
2. `SELECT 1 FROM stripe_events WHERE event_id = $1` fast path (`:128`) → `duplicate:true`
3. **One transaction** (`:141-144`): `INSERT INTO stripe_events` **first**, then
   `handleStripeEvent`. Both commit or neither does. A concurrent duplicate blocks on the
   primary key and surfaces as `e.code === "23505" && e.table === "stripe_events"` (`:146`),
   answered as `duplicate:true`.
4. `res.json({received:true})`
5. **Then** the `afterCommit` effects (emails, analytics) run (`:157-164`). An email failure can
   never fail the webhook; `sendEmail` returning `false` is logged as
   `[Stripe] After-commit <name> not delivered …`.

Handled event types (`handleStripeEvent`, `routes/stripe.js:181`): `checkout.session.completed`
(`:187`), `invoice.payment_succeeded` (`:259`), `customer.subscription.updated` (`:322`),
`customer.subscription.deleted` (`:377`), `invoice.payment_failed` (`:407`). Everything else
falls through to a log line — **and still gets a `stripe_events` row**, so it can never be
replayed.

Renewal keeps the existing code rather than minting a new one: `extendActiveCodes`
(`routes/stripe.js:172`) runs
`UPDATE access_codes SET expires_at = GREATEST(expires_at, $1::timestamptz) WHERE user_id=$2 AND is_active=1`.
A new code is minted only when that matched zero rows (`:293`).

Tests swap the Stripe client with `module.exports.__setStripeClientForTests` (`:435`), which
throws unless `NODE_ENV === "test"`.

### 3.6 `routes/admin.js` — `/admin` (10 routes)

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| POST | `/api/login` | none | 200 `{token: 64 hex chars, expiresAt: +8h}` | 429 `{code:"rate_limited"}` (5/15 min per IP, **not** skipped in test mode); 400 `{code:"invalid_input",field:"password"}`; 401 `{code:"invalid_admin_password"}` — also returned when `ADMIN_PASSWORD` is unset, so there is **no bypass** |
| POST | `/api/logout` | header only | 200 `{loggedOut:true}`, idempotent — DELETEs the row so the token dies everywhere | 401 `admin_auth_required` with no header |
| GET | `/api/stats` | adminAuth | 200 `{totalUsers, activeUsers, activeCodes, monthly, yearly, free, paid, mrr, conversionRate, aiToday, aiMonth, aiCostToday, aiCostMonth, newSignupsToday, newSignupsMonth}` | 401 |
| GET | `/api/users` | adminAuth | 200 — a **bare JSON array**, LIMIT 200, `ORDER BY created_at DESC` | 401 |
| GET | `/api/codes` | adminAuth | 200 — a **bare JSON array**, LIMIT 200 | 401 |
| POST | `/api/codes/generate` | adminAuth | 200 `{code, expiresAt, email: string\|null, plan, unclaimed: boolean}` | 400 invalid_input |
| DELETE | `/api/codes/:id` | adminAuth | 200 `{revoked:true}` (sets `is_active=0`, never deletes) | 400 invalid id; 404 |
| PATCH | `/api/users/:id` | adminAuth | 200 `{updated:true}`; any status other than `active` also sets **every** one of that user's codes to `is_active=0` | 400 (status must be `active`\|`cancelled`\|`suspended`); 404 |
| POST | `/api/email` | adminAuth | 200 `{sent:true, to}` | 400 invalid_input; 404 |
| GET | `/` | **none, by design** | the dashboard HTML (`adminHTML()`, `routes/admin.js:293`) — the login screen; all data comes from the `adminAuth`-protected `/admin/api/*` calls | — |

Admin auth after P0: `adminPasswordMatches` (`:35`) hashes **both** sides to fixed-length
SHA-256 digests before `crypto.timingSafeEqual`, so timing leaks neither contents nor length.
`adminTokenFrom` (`:45`) reads `req.headers["x-admin-token"]` **only** — a `?token=` query
string is no longer accepted. Sessions are a bare `crypto.randomBytes(32).toString("hex")` with
an 8-hour expiry (`:78-79`), no IP binding, no per-admin identity, one shared `ADMIN_PASSWORD`.
`module.exports.requireAdmin = adminAuth` (`:689`) is what `routes/content.js` imports.

### 3.7 `routes/streaks.js` — `/api/streaks` (2 routes)

| Method | Path | Auth | Success |
|---|---|---|---|
| POST | `/log` | requireAuth | 200 `{current_streak, longest_streak, total_days, is_new_day}`. Idempotent per server-UTC day. Increments only when `last_practice` was exactly yesterday, otherwise restarts at 1. Verified live: first call → `{current_streak:1, longest_streak:1, total_days:1, is_new_day:true}`. |
| GET | `/` | requireAuth | 200 `{current_streak, longest_streak, total_days, last_practice}`; `current_streak` is **reported as 0** when `last_practice` is neither today nor yesterday, but the stored row is not reset. No row at all → `{current_streak:0, longest_streak:0, total_days:0}` (no `last_practice` key). |

"Today" is `new Date().toISOString().slice(0,10)` — the **server's UTC date**, not the learner's.
Explicitly free for every signed-in user; `tests/smoke.test.js:216` pins that.

### 3.8 `routes/push.js` — `/api/push` (2 routes)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/register` | requireAuth | `{token: string len ≥ 10, platform: "ios"\|"android"\|"web"}` | 200 `{registered:true}`; upsert `ON CONFLICT(user_id, token) DO UPDATE SET platform` | 400 `{error:"Invalid token."}` / `{error:"platform must be ios, android, or web."}` |
| DELETE | `/token` | requireAuth | `{token: string}` | 200 `{removed:true}` | 400 `{error:"token is required."}` / `{error:"token must be a string."}` — the string check exists because pg would serialise an object or array into the parameter |

### 3.9 `routes/support.js` — `/api/support` (1 route)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/` | **none** | `{question}` | 200 `{answer}` | 503 `ai_unconfigured` when `ANTHROPIC_API_KEY` is unset; 429 `{error:"Too many questions. Please wait a bit and try again."}` (10/h per IP, `support_ip:<ip>`); AI failures via `sendAiError` |

Model `claude-haiku-4-5-20251001`, `max_tokens: 300` (`routes/support.js:59-60`), 30 s timeout.
The system prompt (`:9`) **hardcodes commercial facts** — 12 languages, 5 free Coach
messages/day, $9/month or $79/year, up to 300 Coach messages/day, codes valid on 2 devices, a
7-day refund window, and "There is no billing screen in the app yet, so never send users to
one". The 5/day and 300/day figures do match `reserveQuota`. The prices, the refund window and
the "no billing screen" claim are **not derived from anything in the code** and will drift —
treat them as unverified. There is no quota reserve/refund here: a failed upstream call still
consumed one of the caller's 10 IP slots.

### 3.10 Rate-limit key reference

All limits are DB-backed in `rate_limits`, so they survive restarts and span machines.

| Key | Limit | Caller |
|---|---|---|
| `<userId>` | 5/24 h free, 300/24 h paid | `routes/claude.js:131` |
| `<userId>_burst` | 30/60 s, paid only | `routes/claude.js:125` |
| `login_ip:<ip>` | 10 / 15 min | `routes/auth.js:113` |
| `signup_ip:<ip>` | 5 / h | `routes/auth.js:120` |
| `signup_email:<addr>` | 5 / h | `routes/auth.js:232` |
| `magic_ip:<ip>` | 8 / h | `routes/auth.js:355` |
| `magic_email:<addr>` | 4 / h | `routes/auth.js:367` |
| `resend_ip:<ip>` | 10 / h | `routes/auth.js:441` |
| `resend_email:<addr>` | 3 / h | `routes/auth.js:453` |
| `adminlogin_ip:<ip>` | 5 / 15 min | `routes/admin.js:27` |
| `support_ip:<ip>` | 10 / h | `routes/support.js:36` |

The AI keys are the only **unprefixed** ones — a bare numeric user id. There is no collision
today because every other caller namespaces its key, but it is fragile.

---

## 4. Content system

All lesson and reference material is served from **one Postgres table, `content_cache`**, keyed
`(lang, tab)`. 12 languages × 7 tabs = 84 possible rows, one JSON blob each.
**No item anywhere carries an id** — see §6.3.

### 4.1 Languages and tabs

`LANG_NAMES` (`routes/content.js:36`), `VALID_LANGS = Object.keys(LANG_NAMES)` (`:43`):

```
fr  es  de  en  pt  it  zh  ja  ko  ru  ar  hi
```

`VALID_TABS` (`routes/content.js:44`):

```
grammar  cheatsheet  structures  vocab  dialogues  drills  roadmap
```

All seven are used by the web client. `SCRIPT_CHECK` (`:54`) holds per-language Unicode regexes
for **zh, ja, ko, ru, ar, hi only** — Latin-script languages skip the native-script check
entirely.

### 4.2 Anchor tables — the curated spine

Five per-language tables define how deep each tab should be. **All five have all 12 language
keys, with identical counts for every language** (I evaluated the literals plus the
`UNIVERSAL_VOCAB_EXTRA` concatenation in an isolated scope and printed the counts for all 12):

| Tab | Table | Line | Items per language |
|---|---|---|---|
| grammar | `GRAMMAR_TOPICS` | `routes/content.js:60` | 22 |
| cheatsheet | `CHEATSHEET_GROUPS` | `:351` | 12 |
| structures | `STRUCTURE_TOPICS` | `:522` | 16 |
| vocab | `VOCAB_CATEGORIES` | `:741` | **30** (16 in the literal + 14 from `UNIVERSAL_VOCAB_EXTRA`) |
| dialogues | `DIALOGUE_SCENARIOS` | `:985` | 6 |
| drills | — | — | no table; "20 drills" lives only in the prompt |
| roadmap | — | — | no table; "5 phases" lives only in the prompt |

Two traps for a reader:

- **`VOCAB_CATEGORIES` is mutated at module load.** The loop at `routes/content.js:977-979`
  concatenates `UNIVERSAL_VOCAB_EXTRA` (14 entries, `:964`) onto every language. Reading the
  literal at `:741` undercounts by 14.
- The comment at `routes/content.js:984` says "5 real-life scenes per language". Every
  `DIALOGUE_SCENARIOS` list actually has **6**. The comment is stale.

`anchorTarget(lang, tab)` (`:1538`) maps a tab to `{field, count}` and returns `null` for
drills and roadmap.

### 4.3 Prompts

Seven builders: `buildGrammarPrompt` (`:1086`), `buildCheatsheetPrompt` (`:1106`),
`buildStructuresPrompt` (`:1125`), `buildVocabPrompt` (`:1143`), `buildDialoguesPrompt`
(`:1165`), `buildDrillsPrompt` (`:1186`), `buildRoadmapPrompt` (`:1201`).

**`buildVocabPrompt` is dead code.** `runGeneration` (`:1483`) routes vocab to
`generateAndStoreVocab` and the `prompts` object (`:1487-1494`) has no `vocab` key. It also
still says "Generate exactly 18 words", contradicting both `VOCAB_WORDS_PER_CATEGORY = 40`
(`:1378`) and the validator's ≥30 rule. **Do not read it as the live vocab spec.**

The live vocab path is `generateAndStoreVocab(lang)` (`:1401`): **one Anthropic request per
category**, i.e. 30 sequential calls per language with a 300 ms gap. It aborts the whole
language fast on `/credit balance|billing|invalid_request_error|401|403/` so a dead key does
not trigger 30 doomed calls. Its inner retry backs off 1500 ms **only in the catch branch** —
a well-formed but too-short response retries immediately with no delay (`:1408-1421`).

`callAnthropic(prompt)` (`:1337`) uses `model: "claude-opus-4-5"`, `max_tokens: 22000`
(`:1349-1350`), strips ``` fences, and falls back to a `/\{[\s\S]*\}/` match before giving up.

### 4.4 `validateContent(lang, tab, data)` — the real content schema

`routes/content.js:1219`, exported at `:1858`. Returns `null` when valid, otherwise a
human-readable string naming the **first** problem. This one function gates the API, the
generator, the seed loader and `scripts/validate_seed.js`.

| Tab | Minimum | Every item must have |
|---|---|---|
| grammar | ≥10 `sections` | `title`, `rule`, `example_target`, `example_ref`, **`examples[]` with ≥3 entries each having `target` + `ref`** (`:1243`), **`common_mistake`** (`:1245`) |
| cheatsheet | ≥7 `categories` | `name`, ≥5 `items` (`:1259`) |
| structures | ≥9 `structures` | `pattern`, `explanation`, `ex1_target`, `ex1_ref` |
| vocab | ≥9 `categories` | `name`, **≥30 `words`** (`:1286`), every word carrying **`t`, `r` AND `ex`** (`:1287`) |
| dialogues | ≥4 `dialogues` | `title`, `scene`, ≥6 `lines` (`:1300`), ≥3 `vocab` entries (`:1301`) |
| drills | ≥12 `drills` | `q`, `a` |
| roadmap | ≥5 `phases` | `title`, `goal`, ≥4 `can` items (`:1326`), `daily` |
| unknown tab | — | returns `null`, i.e. **validation is skipped** (`:1332`) |

The native-script check runs only for zh/ja/ko/ru/ar/hi, on grammar `example_target` and every
`examples[].target`, cheatsheet `items[].target`, structures `ex1_target`, vocab `words[].t`,
dialogue `lines[].target`, and drill `a`.

**A field the course silently depends on that the validator does not check:** grammar
`section.level` (`"Beginner"` / `"Intermediate"` / `"Advanced"`). The prompt asks for it
(`:1100`) and the client's `buildUnits` partitions the whole Learn course by those exact
English literals (`public/index.html:6038, 6041, 6044`). Content that validates perfectly but
omits `level` produces **zero grammar units** with no error anywhere.

### 4.5 Seeds — and the 16 that are rejected

`seed/content/<lang>/<tab>.json`: **84 files, 2.0 MB**, one directory per language. Measured
depth (I walked every file):

| Tab | Every language |
|---|---|
| grammar | 22 sections |
| cheatsheet | 12 categories |
| structures | 16 structures |
| dialogues | 6 dialogues |
| drills | 20 drills |
| roadmap | 5 phases |
| vocab | **split**: ar, en, hi, it, ja, ko, ru, zh have 30 categories × 40 words (1200 words each); fr 16/192, es 16/194, de 16/176, pt 16/172 |

**`node scripts/validate_seed.js` currently prints `68 valid, 16 invalid, 0 missing (of 84)`
and exits 1.** I ran it. The 16 failures:

- **All 12 `grammar.json`** — `section 0 needs ≥3 examples`. Every grammar seed has 22 sections
  of which **zero** carry an `examples` array and **zero** carry `common_mistake`.
- **fr, es, de, pt `vocab.json`** — `category 0 has too few words (need ≥30)`.

Cause: commit `ae35713` raised the validator (grammar `examples` ≥3 + `common_mistake`; vocab
≥30 words each with `ex`) and deepened **only 8 vocab seeds**. `git show --stat ae35713 -- seed/`
lists exactly 8 changed files: `ar, en, hi, it, ja, ko, ru, zh` `vocab.json`. No grammar seed
was ever regenerated to the new spec, and `seed/SCHEMA.md` was never updated — it still
documents the **old** grammar shape (no `examples`, no `common_mistake`) and "8–12 words" per
vocab category. **Anyone authoring from `seed/SCHEMA.md` today will produce files that fail
validation.**

Consequence, which I confirmed end to end on a clean database: `seedContent()` logs
`[Seed] 68 inserted, 0 upgraded to curated content, 16 skipped (invalid)`, and per-tab coverage
is `cheatsheet 12, dialogues 12, drills 12, roadmap 12, structures 12, vocab 8, grammar 0`.
Then `GET /api/content/fr/grammar` answers **503 `content_unavailable`**. The advertised
"works with zero AI credits" fallback does not exist for grammar in **any** language, nor for
fr/es/de/pt vocab.

### 4.6 `content_cache` and `seedContent()`

```sql
CREATE TABLE content_cache (
  lang         TEXT NOT NULL,
  tab          TEXT NOT NULL,
  content_json TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lang, tab)
);
```
(`db.js:115-121`. No version column, no checksum, no source column, no per-item rows.)

Measured row sizes on a freshly seeded database (68 rows, 1,713,045 bytes total):

| Tab | min | avg | max |
|---|---|---|---|
| vocab | 135 252 | 155 746 | 190 938 |
| cheatsheet | 10 819 | 13 596 | 16 218 |
| dialogues | 10 211 | 11 324 | 13 159 |
| structures | 6 487 | 7 515 | 8 465 |
| roadmap | 3 064 | 3 728 | 4 288 |
| drills | 2 377 | 2 760 | 3 095 |

A vocab read is ~150 KB with no pagination, no field selection and no `Cache-Control` (Express
sends a weak ETag, so a conditional GET can still 304).

`seedContent()` (`routes/content.js:1798`), run once at boot from `server.js:129` and **skipped
entirely when `NODE_ENV === "test"`**:

1. Missing file → skip. Bad JSON → warn, `invalid++`. Fails `validateContent` → warn
   `[Seed] invalid <lang>/<tab>: <reason>`, `invalid++`. **This is where the 16 die.**
2. No existing row → `INSERT … ON CONFLICT(lang,tab) DO NOTHING` (never replaces a row a peer
   machine created after the SELECT), `inserted++`.
3. Existing row → compare `seedItemCount(seed)` vs `seedItemCount(existing)` (`:1786`). If the
   existing parses and `newCount <= oldCount`, continue silently. **Never downgrades.**
4. Otherwise it is an upgrade candidate: with `CONTENT_SEED_UPGRADE` off it is counted as
   `held` and logged
   `[Seed] kept <lang>/<tab>: existing row has N item(s), seed has M item(s) — not replaced; set CONTENT_SEED_UPGRADE=on to upgrade (remaps lesson progress)`.
   With it on, `INSERT … ON CONFLICT DO UPDATE`, `upgraded++`.

`seedItemCount` counts only the **top-level array length**, so for vocab it counts *categories*,
not words. A production row with 30 shallow categories looks "as deep as" a 30 × 40 seed and is
never flagged.

### 4.7 The freeze flags

| Flag | Exact test | Effect when off |
|---|---|---|
| `CONTENT_AUTOGEN` | `process.env.CONTENT_AUTOGEN === "on"` — `isAutogenEnabled()`, `routes/content.js:1449-1451` | `generateContent` (`:1471`) throws `AutogenDisabledError` (`:1453`, `code: "autogen_disabled"`). It is the **only** entry point, so on-demand GET, admin regenerate, boot and the 6-hourly cron all obey it. `generateMissingContent` (`:1549`) returns immediately with a log line. Admin regenerate short-circuits with 409 `autogen_disabled`. The on-demand GET answers 503 `content_unavailable` instead of calling the API. |
| `CONTENT_SEED_UPGRADE` | `=== "on"`, `routes/content.js:1801` | An existing `content_cache` row is never replaced by a deeper seed; upgrades are logged as `held`. |

Both were confirmed off in the local test environment: `isAutogenEnabled()` returned `false`
and `generateContent("fr","grammar")` rejected with `AutogenDisabledError / autogen_disabled`.

**Why these exist:** lesson identity is array position (`v3`, `g12`). Regenerating or
re-seeding a row silently remaps every learner's completed lessons. That is the whole reason
P0 froze both. Do not turn either on without reading §6.3 first.

When autogen **is** on, `generateMissingContent` regenerates a cached row if it fails
`validateContent` **or** is below 70 % of the anchor count (`:1571`):
`Math.floor(count * 0.7)` = grammar 15, cheatsheet 8, structures 11, vocab 21, dialogues 4.
Drills and roadmap have no anchor, so only the validator applies.

### 4.8 Repo content versus production content

| | In the repo | In production only |
|---|---|---|
| What | 84 seed files, of which **68 are servable** | Every `content_cache` row that already exists |
| Reproducible? | Yes, from `git` | **No.** `seedContent` never replaces an existing row while `CONTENT_SEED_UPGRADE` is off. |

**Unknown — needs checking.** What production's `content_cache` actually holds was not read
(a read-only snapshot was blocked by a permission prompt and never taken; gate G1). This is the
single highest-value open question in the codebase:

- If production holds grammar and fr/es/de/pt vocab rows, **the repo cannot rebuild them** and
  they must be exported before any content or schema work.
- If it does not, grammar is already answering 503 for live learners.
- `docs/ARCHITECTURE_FORENSICS.md` §2.3 *infers* (marked unverified there) that French
  production vocab/grammar are older AI-generated rows rather than the seeds — the live French
  "Les Nombres" lesson showed 18 word cards while the fr seed has 12. That inference is
  consistent with the code, but it is still an inference.
- Production rows may also be **richer** than any seed: the client renderer understands
  `examples` and `common_mistake`, and the AI pipeline would have produced them.

The safe first probe is `GET /api/content/status` (adminAuth), which returns per-pair
`generated_at` without exposing any content body.

---

## 5. Client — `public/index.html`

One file, 8,621 lines, 569,378 bytes raw. Served at `GET /app` (`app.js:277`). There is **no
build step**: the JSX is compiled in the visitor's browser by Babel on every page load.

### 5.1 Anatomy of the file

| Lines | What |
|---|---|
| 1–21 | `<head>`: meta, manifest link (`:14`), Google Fonts, then four CDN `<script>` tags — lucide 0.454.0 (`:18`), **react@18** (`:19`), **react-dom@18** (`:20`), `@babel/standalone@7.29.7` (`:21`). React and ReactDOM use an **unpinned major range**; lucide and Babel are pinned exactly. |
| 22–224 | Inline `<style>`: `:root` design tokens (`:24-71`), the `.dark-theme` override (`:73`, 23 redefined tokens), responsive / stage / sheet / FAB rules |
| 225–229 | Service-worker registration (unconditional) |
| 234–311 | Capacitor push bootstrap; defines `window.__registerPushToken` (`:247`) and `__unregisterPushToken` (`:293`) |
| 313–314 | `<body>`, `<div id="root">` |
| **315–8620** | One `<script type="text/babel" data-presets="react">` holding the entire app |
| 8618–8619 | `ReactDOM.createRoot(document.getElementById('root')).render(<App/>)` — **unguarded, and there is no error boundary anywhere in the file** |

### 5.2 Component index

62 top-level `function X(…)` components. Line ranges below were computed from the file at
`b3f6504` (start = the `function` line; end = the line before the next top-level declaration).
**Components with zero JSX mount sites are marked DEAD** — verified by grepping the whole file
for each bare name, not just for `<Name`.

| Component | Lines | Len | Note |
|---|---|---|---|
| `Icon` | 448–472 | 25 | lucide wrapper |
| `PlayBtn` `Tag` `Info` `Box` | 2675–2718 | 44 | small primitives |
| `Row` | 2719–2731 | 13 | **DEAD** |
| `ConjTable` | 2732–2756 | 25 | **DEAD** |
| `Heading` `Tabs` | 2757–2781 | 25 | |
| `SaveToFlashcardsBtn` | 2844–2866 | 23 | |
| `AccessCodeLogin` | 3150–3395 | 246 | the login gate |
| `AICoach` | 3396–3889 | 494 | |
| `ContentLoader` `ReportError` | 3912–3967 | 56 | |
| `AITabContent` | 3968–4343 | 376 | renders cheatsheet / grammar / structures / vocab |
| `CheatSheet` `Grammar` `Structures` `Vocab` | 4344–4482 | 34 | thin wrappers over `AITabContent` |
| `VocabCard` | 4371–4475 | 105 | **DEAD** |
| `Drills` | 4483–4552 | 70 | |
| `Dialogues` | 4553–4616 | 64 | |
| `Roadmap` | 4617–4684 | 68 | |
| `SettingsPanel` | 4685–4840 | 156 | **DEAD — and it is the only caller of billing + delete-account. See §9.** |
| `VoicePanel` | 4841–4958 | 118 | |
| `WordSpace` | 4959–5166 | 208 | |
| `Flashcards` | 5167–5484 | 318 | |
| `BackBtn` `WrappedScreen` | 5488–5523 | 36 | |
| `WordOfDay` | 5525–5556 | 32 | downloads a whole ~150 KB vocab row to pick one word |
| `ExploreHome` | 5557–5754 | 198 | home screen; **contains the mobile bottom dock** |
| `GrammarScreen` | 5755–5802 | 48 | **DEAD** — view `grammar` renders `<Grammar/>` at `:8367` instead |
| `ConceptScreen` | 5803–5881 | 79 | |
| `VocabThemesScreen` `VocabWordsScreen` `PhrasesScreen` | 5882–6026 | 145 | |
| `VocabLesson` | 6061–6101 | 41 | |
| `RoleBadge` `SentenceExplorer` `ExampleLine` | 6124–6265 | 142 | sentence breakdown |
| `GrammarLesson` `DialogueLesson` `LessonView` | 6266–6338 | 73 | |
| `ProgressRing` `LearnPath` | 6347–6485 | 139 | the Learn course |
| `SoundsScreen` `CultureScreen` | 6486–6597 | 112 | |
| `ReviewScreen` | 6598–6656 | 59 | **all its numbers are wrong — see §9** |
| `NewOnboarding` | 6657–6795 | 139 | the live onboarding |
| `LangSwitchOverlay` | 6796–6822 | 27 | |
| `SettingsOverlay` | 6823–6880 | 58 | **the live settings sheet** |
| `UpgradeOverlay` | 6881–6912 | 32 | |
| `OnboardingModal` | 6913–7113 | 201 | **DEAD** |
| `HowToUseModal` | 7114–7223 | 110 | **DEAD** |
| `TodaysPractice` | 7224–7269 | 46 | |
| `Conversation` | 7270–7590 | 321 | SSE role-play |
| `TextAnalyzer` | 7591–7706 | 116 | |
| `ShareCardModal` | 7707–7838 | 132 | **DEAD** |
| `TopBar` | 7839–7956 | 118 | desktop-only global bar |
| `DesktopNav` | 7957–8065 | 109 | **DEAD** — superseded by `TopBar` |
| `App` | 8066–8500 | 435 | owns view + stack |
| `SupportChat` | 8501–8622 | 122 | mounted unconditionally at `:8479` |

**Dead total: 9 components, 899 lines** (Row 13 + ConjTable 25 + VocabCard 105 +
SettingsPanel 156 + GrammarScreen 48 + OnboardingModal 201 + HowToUseModal 110 +
ShareCardModal 132 + DesktopNav 109).

Key non-component helpers:

| Symbol | Line | What |
|---|---|---|
| `C` | 372 | design-token bridge — every key is a getter calling `getComputedStyle().getPropertyValue()`, so inline styles follow the CSS variables live |
| `THEMES` | 409 | 10 accents: crimson, sunset, amber, emerald, teal, sky, indigo, violet, sakura, rose |
| `LANG_THEME` | 422 | maps each of the 12 languages to a theme key (fr→indigo, es→amber, en→crimson, …) |
| `applyAccent(themeKey, isDark)` | 426 | writes `--accent`, `--accent-2`, `--grad`, `--accentSoft`, `--accentLine` onto `document.documentElement` |
| `resolveThemeKey(langId, choice)` | 441 | explicit pick wins unless it is `"auto"`, then `LANG_THEME` |
| `makeNavState` / `makeBackState` | 484 / 487 | pure navigation reducers |
| `TARGETS` / `REFS` | 506 / 520 | the 12 target languages / reference languages. **`TARGETS[x].flag` is an emoji; `LANGS_DATA[x].flag` is a CSS gradient string** — two incompatible conventions |
| `LANGS_DATA` | 546 | per-language screen data. **Hand-authored for fr, es, ja only**; the loop at `:959` machine-generates pt, it, de, en, zh, ko, ru, ar, hi from `TARGETS` with literal placeholders |
| `t(key, vars)` | 2640 | i18n lookup; `dict[key] → UI_STRINGS.en[key] → the raw key`, naive `{n}` substitution |
| `useMobile` / `useDesktop` | 2649 / 2662 | ≤640 px / ≥900 px |
| `FC_KEY`, `fcLoad`, `fcSave`, `fcAdd`, `sm2`, `fcDeckStats` | 2782–2833 | the flashcard store |
| `getToken`, `isLoggedIn`, `saveSession`, `logout` | 2889–2913 | session helpers |
| `_streak` | 2921 | client-side streak counter |
| `ApiRequestError`, `readApiError`, `aiErrorMessage`, `fetchContent`, `contentErrorMessage`, `askClaude`, `streamChat` | 2960–3063 | the API layer (see §5.5) |
| `GRAD` | 5485 | `"var(--grad)"` — the single gradient token used by ~25 inline styles |
| `lpKey`/`lpLoad`/`lpSave`, `buildUnits` | 6027–6047 | lesson progress + course construction |
| `_skey`, `getBreakdown` | 6110 / 6111 | sentence-breakdown cache |

### 5.3 Views and navigation

`App` (`:8066`) holds `view` and `stack`. `nav(v)` (`:8270`) pushes via `makeNavState` and
writes `tongue_last`; `goBack()` (`:8278`) pops via `makeBackState`; `wrap(title, subtitle,
content, noPad)` (`:8323`) renders a `WrappedScreen`.

**22 views**, from `view === "…"` inside `App`'s render (`:8352-8434`):

```
explore  coach  grammar  grammar-full  concept  vocabThemes  vocabWords  vocab-full
phrases  dialogues  learn  sounds  culture  cards  drills  structures  wordspace
roadmap  voice-tutor  analyzer  today  review
```

`RESUMABLE` (`:8263-8269`) lists **18** of them; `explore`, `vocabThemes`, `vocabWords` and
`phrases` are deliberately not resumable.

Navigation model: **a single linear back-stack with no URL or History integration.** On mobile
the bottom dock lives *inside* `ExploreHome` (`:5737-5749`), so it only exists on the home
view; every other screen offers only `WrappedScreen`'s back button. `App` mirrors that with
`document.body.classList.toggle("has-bottom-dock", view === "explore" && !isDesktop)`
(`:8219-8223`), which lifts the support FAB.

Cross-component messaging is three window `CustomEvent`s — there is no store and no context:

| Event | Dispatched | Handled |
|---|---|---|
| `session-renewed` | `:3041`, `:3078` | `:8116` → logged out + renewed banner |
| `show-upgrade` (`detail:{reason:"ai_limit"}` or `{upgraded:true}`) | `:3050`, `:3083`, `:3943`, `:3989`, `:6523`, `:7603`, `:8212` | `:8127` → `setOverlay("upgrade")` |
| `streak-updated` (`detail:{count}`) | `:2945` | `:8121` |

### 5.4 Design tokens, theming, i18n

**Tokens.** 38 CSS custom properties on `:root` (`:24-71`): `--accent`, `--accent-2`, `--grad`,
`--accentSoft`, `--accentLine`, `--stage`, `--bg`, `--surf`, `--surf2`, `--dock`, `--bezel`,
`--bg-card`, `--bg-soft`, `--bg-sheet`, `--border`, `--shadow`, `--shadow-card`, `--line`,
`--font`, `--serif`, `--text`, `--text-mid`, `--text-muted`, `--muted`, `--faint`,
`--tableHd`, `--tableHdText`, `--green`, `--purple`, `--teal`, `--orange`, `--red`, `--pink`,
`--info`, `--radius-card`, `--radius-sheet`, `--radius-btn`, `--radius-pill`.
`.dark-theme` (`:73`) redefines 23 of them. Dark mode is a class on
`document.documentElement`, toggled at `:8076` and `:8313`.

**Three independent token systems exist and will drift**: `public/index.html`'s `:root`
(`--accent`, `--bg: #F5F2EC`), `public/brand.css`'s `:root` (`--blue`, `--bg: #F6F1E8`, loaded
by 7 static pages but **not** by `index.html`), and `public/home.html`'s own inline styles.

**i18n.** Five dictionaries merged in this order (`:2631`, `:2633`, `:2635`):
`UI_STRINGS` (`:1013`, 23 en keys × 12 langs) → `UI_EXT` (`:1389`, 110 en keys × 12 langs) →
`UI_NAV` (`:2576`, 96 keys, **en only**) → `UI_NAV_I18N` (`:2632`, 73 keys × 11 langs) →
`UI_NAV_TOOLS` (`:2634`, 22 keys × 11 langs).

I replayed that merge in Node: **en has 227 keys, every other language has 225**, and exactly
two keys are English-only in all 11 — **`nav_learn`** and **`translate_failed`**. `nav_learn` is
the label of the primary Learn tab in four live places (`:5565`, `:7844`, `:7961`, `:8391`), so
the Learn tab reads "Learn" in English for 11 of 12 UI languages.

The system is only half-applied: a static count over the Babel block found **229 literal
English JSX text nodes** and **17 hardcoded English placeholder/title/alt/aria-label
attributes**. The entire desktop `TopBar` chrome is English-only (`:7916`, `:7923`, `:7925`,
`:7926-7927`).

### 5.5 API client layer and error contract

P0 introduced a single coherent contract:

| Symbol | Line | Contract |
|---|---|---|
| `ApiRequestError` | 2960 | `{code, status, retryable, serverMessage, reason, upgrade}`; the `message` keeps legacy tokens (`FREE_LIMIT`, `UNAUTHORIZED`, `RENEWED`, `RATE_LIMITED`) so older checks keep working |
| `readApiError(res, legacy)` | 2981 | turns any failed response into an `ApiRequestError`; `code` is the server's code, `"network"` when the browser itself could not connect, or a status-derived code for older responses |
| `aiErrorMessage(err)` | 2998 | one honest user-facing message per code. `MSG_OFFLINE` (`:2974`) — "Check your connection" — is used **only** for a real browser-side failure |
| `fetchContent(lang, tab)` | 3008 | sends `Authorization: Bearer`; throws `ApiRequestError` |
| `contentErrorMessage(err)` | 3018 | content-specific copy |
| `askClaude(prompt, maxTokens, lang, nativeLang)` | 3024 | returns the parsed JSON object. 401 → `logout()` + `"RENEWED"`/`"UNAUTHORIZED"`; 429 with `upgrade` → `"FREE_LIMIT"` + `show-upgrade`. Every success calls `_streak.log()` |
| `streamChat({…}, {onDelta, onError, …})` | 3063 | SSE reader; splits on `\n\n`; frame types `delta`, `done`, `error`. `onError` always gets `{type, code, status, retryable, message: aiErrorMessage(err)}` with `type ∈ auth \| renewed \| limit \| connection \| api` |

**There is no fetch wrapper or interceptor.** Every authenticated call hand-writes its
`Authorization` header, which is exactly how the billing-portal call came to be missed (§9).

Six call sites use the contract correctly (`:3437`, `:3461`, `:4003`, `:4391`, `:4987`, and
`streamChat`'s own `fail` at `:3064`). The rest do not — see §9.

Endpoints the client calls: `/api/auth/{account,google,login,magic-link/request,
magic-link/verify,onboarding,preferences,signup,validate}`, `/api/claude`, `/api/claude/chat`,
`/api/config`, `/api/content/:lang/:tab`, `/api/content/report`, `/api/push/register`,
`/api/push/token`, `/api/streaks/log`, `/api/stripe/create-portal`, `/api/support`.
**`/api/stripe/create-checkout` is called only by `public/subscribe.html:298`** and
**`/api/auth/resend-code` only by `public/resend-code.html:133`**. `GET /api/streaks` has **no
web caller at all** — the client only ever POSTs `/log` (`:2948`) and discards the body.

### 5.6 localStorage key reference

Every access is individually wrapped in `try/catch`, so a quota failure is **silent**: the user
sees progress "save" and it is gone on reload.

| Key | Shape | Owner |
|---|---|---|
| `auth_token` | JWT string | `:2883`, `saveSession` `:2893`, `logout` `:2913` |
| `auth_expiry` | ISO datetime; `isLoggedIn()` (`:2890`) is `new Date(expiry) > new Date()` | same |
| `auth_email`, `auth_plan` | strings; `auth_plan` ∈ `free\|monthly\|yearly` | same; `auth_plan` also overwritten from `/validate` at `:8200` |
| `tongue_code` | uppercased access code, used for silent re-login | `:8170-8184`, `:8462` |
| `fc_cards_v2` | JSON array, newest first. Card = `{id:"<base36 ms>-<6 base36>", lang, front, back, pronunciation, example, interval, repetitions, ease, next_review (epoch ms)}` | `FC_KEY :2782`, `fcAdd :2791`, `sm2 :2812` |
| `ws_saved` | JSON array **capped at 100** (`:5002`) of `{id, input, fr, ref, pronunciation, date}`. **No language field.** | `WordSpace :4968-5010` |
| `learn_progress_<lang>` | JSON array of positional lesson ids `"v<i>"`, `"g<i>"`, `"d<i>"` | `lpKey :6027`, `lpLoad/lpSave :6028-6029` |
| `roadmap_<lang>` | JSON array of `"<phaseIdx>-<milestoneIdx>"` | `Roadmap :4619` (read), `:4632` (write) |
| `bd_<lang>_<_skey(text)>` | cached sentence breakdown `{gist, parts[], related[]}`. `_skey` (`:6110`) is a 32-bit hash rendered base36. **Never evicted.** | `getBreakdown :6111-6120` |
| `streak_count` / `streak_longest` / `streak_total` | integer strings | `_streak :2921-2952` |
| `streak_last` | `Date.toDateString()`, e.g. `"Wed Sep 17 2026"` — **a different format and a different clock from the server's `YYYY-MM-DD` UTC** | same |
| `target_lang` | a `TARGETS` key, default `"fr"` (`:8084`) | `:8210`, `:8244`, `:8301`, `:8444` |
| `native_lang` | one of the 12 codes, defaulting to the browser language (`:497`) | `:3984`, `:8239`, `:8319` |
| `user_level` | `beginner-zero\|beginner\|intermediate\|advanced`. **Written only from the `/validate` response (`:8206`)** — never by the onboarding wizard | `:7274`, `:8112` |
| `theme_choice` | a `THEMES` key or `"auto"`, default `"crimson"` | `:438-439` |
| `_dark` | `"1"` / `"0"` | `:8074`, `:8251` |
| `_new_login`, `_seen_onboard` | `"1"` flags gating onboarding | `:8103`, `:8149-8150`, `:8303` |
| `tongue_last` | `{view, label}` from `RESUMABLE` | written `:8275`, read by the Continue card `:5684` |
| `admin_token` | admin session token (different page, same origin) | `public/admin-content.html:225` |
| `sessionStorage support_hidden` | `"1"` once the support FAB is dismissed | `:8508`, `:8555` — the only `sessionStorage` use |

### 5.7 Flashcards and SM-2

`fcAdd(card)` (`:2791`) deduplicates by `lang` + lowercased `front`, `unshift`s, and seeds
`interval:1, repetitions:0, ease:2.5, next_review: Date.now()` (`:2803-2806`).

`sm2(card, quality)` (`:2812`) takes `quality` 0=Again, 1=Hard, 2=Good, 3=Easy:

- `quality === 0` → `interval = 1; repetitions = 0`.
- otherwise `q5 = [0,2,4,5][quality]`;
  `ease = Math.max(1.3, ease + 0.1 - (5-q5)*(0.08 + (5-q5)*0.02))`;
  `repetitions === 0 → interval 1`, `=== 1 → 6`, else `Math.round(interval * ease)`;
  `quality === 3` applies a ×1.6 Easy bonus; `repetitions++`.
- `next_review = Date.now() + interval * 86400000`.

**Two behaviours worth knowing.** "Again" schedules the card for *tomorrow*, not immediately —
the UI copy at `:5290` says otherwise. And because only `quality === 0` resets `repetitions`,
"Hard" (mapped to SM-2 quality 2) is treated as a pass: for `repetitions ≥ 2` it runs
`interval = Math.round(interval * ease)` and pushes the card **further away**.

`fcDeckStats(cards, lang, now)` (`:2833`) is the single source for deck numbers — its own
comment says it exists "so Flashcards and Review must always agree". It returns
`{deck, total, due, upcoming, newCount, learned}`, filtered by `lang`, reading `next_review`.
`Flashcards` uses it (`:5181`). **`ReviewScreen` does not** — see §9.

### 5.8 Sentence breakdown

`getBreakdown(lang, text)` (`:6111`) checks `localStorage["bd_"+lang+"_"+_skey(text)]`, else
asks Claude for
`{gist, parts:[{s, r, m, role}], related:[{kind, label}]}` with `maxTokens 1300`, then caches it.
`ROLE_COLORS` (`:6102`) and `roleColor` (`:6109`) colour each part by grammatical role.
`SentenceExplorer` (`:6129`) renders it; `ExampleLine` (`:6250`) is the inline entry point.
Cards can be added straight from a part (`addPartCard`, `:6148`).

The cache has **no eviction, no size accounting and no version prefix**, and `_skey` is a
32-bit hash, so distinct sentences can collide and silently serve the wrong breakdown.

### 5.9 The other public pages

| File | Lines | Purpose | Notes |
|---|---|---|---|
| `home.html` | 726 | marketing landing, `GET /` | Vanilla JS, no React. **Does not link `brand.css`** — third token system. Prices hardcoded at `:552`, `:608`, `:693`, `:698` |
| `subscribe.html` | 323 | checkout, `/subscribe` | The **only** caller of `POST /api/stripe/create-checkout` (`:298`) |
| `faq.html` | 519 | `/faq`, and the target of the `/help` 301 | Client-side search |
| `admin-content.html` | 482 | standalone content console at `/admin-content` | **Unlinked** — nothing in `routes/`, `app.js` or `server.js` references it. `TABS` (`:192`) has only 5 of 7 tabs; `LANGS` (`:193`) has 10 of 12 — **fr and en are missing**, so French and English content cannot be managed here |
| `resend-code.html` | 161 | `/resend-code` | The only caller of `POST /api/auth/resend-code` (`:133`) |
| `privacy.html` / `terms.html` / `404.html` | 163 / 200 / 84 | static | |
| `brand.css` | 167 | shared tokens for the 7 static pages | `--blue #C0153E`, `--bg #F6F1E8`, Fraunces + Instrument Sans |
| `sw.js` | 75 | service worker, `CACHE_NAME "tongue-v2"` | Bypasses `/api/` and `/admin` (`:42-44`); network-first for navigations (`:47`); cache-first otherwise (`:62`). **The CDN branch (`:65-72`) calls `caches.put` with no `res.ok` check and no `.catch`** |
| `manifest.json` | 34 | PWA manifest | `start_url: "/"` — an installed PWA opens the **marketing page**, not `/app`. `description` says "11 languages" |

---

## 6. Data model

**14 tables**, created idempotently by `db.initialize()` (`db.js:51`). The column lists below
are from a live `information_schema` dump of a database built by `initialize()` alone — not from
reading the SQL. There is **no migrations table**, so nothing records which of the 11 ALTERs
actually ran, and all of them are silenced with `.catch(() => {})`.

### 6.1 Tables

| Table | Columns | Written by | Read by |
|---|---|---|---|
| **users** | `id serial PK`, `email text NOT NULL UNIQUE`, `stripe_customer_id text UNIQUE`, `plan text DEFAULT 'free'`, `status text DEFAULT 'active'`, `user_level text`, `user_goal text`, `daily_commitment int`, `onboarding_completed bool DEFAULT false`, `created_at timestamptz DEFAULT now()`, `target_lang text` | `routes/auth.js` (upsert, email bind, preferences, onboarding, soft delete), `routes/stripe.js` (4 webhook handlers), `routes/admin.js` (code generate, status patch) | `db.js` (`hasActivePaidAccess`), `routes/auth.js`, `routes/stripe.js`, `routes/admin.js`, `utils/push.js` |
| **access_codes** | `id serial PK`, `user_id int NOT NULL → users(id)`, `code text NOT NULL UNIQUE`, `is_active int DEFAULT 1`, `expires_at timestamptz NOT NULL`, `session_nonce text`, `session_nonce_2 text`, `created_at` | `routes/auth.js` (nonce rotation, hard DELETE on account deletion), `routes/stripe.js` (extend / mint / deactivate), `routes/admin.js` | `db.js`, `routes/auth.js`, `routes/claude.js`, `routes/admin.js` |
| **subscriptions** | `id serial PK`, `user_id int NOT NULL **UNIQUE** → users(id)`, `stripe_subscription_id text UNIQUE`, `stripe_price_id text`, `plan text`, `status text`, `current_period_end timestamptz`, `cancel_at_period_end bool DEFAULT false`, `paid_access_until timestamptz`, `created_at`, `updated_at` | `routes/stripe.js` only (+ `routes/auth.js` sets `status='deleted'`) | **`db.js:266` only** |
| **admin_sessions** | `id serial PK`, `token text NOT NULL UNIQUE`, `expires_at timestamptz NOT NULL`, `created_at` | `routes/admin.js` (login, logout), `server.js:108` (3 AM prune) | `routes/admin.js:54` |
| **rate_limits** | `user_id **text** PK`, `count int DEFAULT 0`, `window_reset **bigint** DEFAULT 0` | `db.js` (`hitRateLimit`, `refundRateLimit`), `server.js:110` (prune) | same |
| **streaks** | `user_id int PK → users(id)`, `current_streak int DEFAULT 0`, `longest_streak int DEFAULT 0`, `last_practice **text**`, `total_days int DEFAULT 0` | `routes/streaks.js` only | `routes/streaks.js`, `utils/push.js:118` |
| **content_cache** | `lang text NOT NULL`, `tab text NOT NULL`, `content_json text NOT NULL`, `generated_at timestamptz DEFAULT now()`, **PK (lang, tab)** | `routes/content.js` only (generate, seed-on-demand, `seedContent`) | `routes/content.js` only |
| **ai_usage_logs** | `id serial PK`, `user_id int → users(id) ON DELETE SET NULL`, `language text`, `feature_type text`, `input_length int`, `output_length int`, `estimated_cost numeric(10,6)`, `created_at` | `routes/claude.js:184` (`logUsage`, fire-and-forget) | `routes/admin.js` (stats only) |
| **analytics_events** | `id serial PK`, `user_id int` — **no foreign key**, `event_name text NOT NULL`, `metadata jsonb`, `created_at` | `db.js:281` (`trackEvent`) only | **nothing — write-only** |
| **stripe_events** | `event_id text PK`, `processed_at timestamptz DEFAULT now()` | `routes/stripe.js:142` | `routes/stripe.js:128` |
| **push_tokens** | `id serial PK`, `user_id int NOT NULL → users(id) **ON DELETE CASCADE**`, `token text NOT NULL`, `platform text NOT NULL`, `created_at`, **UNIQUE(user_id, token)** | `routes/push.js`, `utils/push.js` (stale-token delete) | same |
| **content_reports** | `id serial PK`, `user_id int → users(id) ON DELETE SET NULL`, `lang text NOT NULL`, `tab text NOT NULL`, `note text`, `resolved bool DEFAULT false`, `created_at` | `routes/content.js:1744` | `routes/content.js:1758` (admin, LIMIT 200) |
| **magic_links** | `id serial PK`, `email text NOT NULL` *(plaintext)*, `token_hash text NOT NULL UNIQUE`, `expires_at timestamptz NOT NULL`, `used_at timestamptz`, `created_at` | `routes/auth.js` (issue at `:376`, atomic claim at `:419`) | claimed via `UPDATE … RETURNING`, never SELECTed |
| **job_runs** | `job text NOT NULL`, `slot text NOT NULL`, `claimed_at timestamptz DEFAULT now()`, **PK (job, slot)** | `db.js:372` (`claimJobRun`) | claimed via `INSERT … RETURNING` |

Foreign-key delete rules (from the live catalog — they are **not** uniform):
`push_tokens` CASCADE; `ai_usage_logs` and `content_reports` SET NULL;
`access_codes`, `streaks`, `subscriptions` NO ACTION.

Value domains observed in code, **none of which has a CHECK constraint**:
`users.plan ∈ free|monthly|yearly`; `users.status ∈ active|cancelled|suspended|deleted`;
`push_tokens.platform ∈ ios|android|web`. `access_codes.is_active` is `INTEGER` 0/1 — a SQLite
leftover, compared everywhere as `= 1` / `= 0`.

`rate_limits.user_id` is a **mixed TEXT namespace** (see §3.10) holding user ids, `<id>_burst`,
raw IPs and **raw email addresses**. The `DO $$` block at `db.js:206` drops and recreates the
table if the column is still INTEGER from an old deploy.

Five indexes duplicate an existing unique constraint and buy nothing: `idx_users_email`,
`idx_users_stripe_cust`, `idx_subs_user`, `idx_rate_limits_user`, `idx_magic_links_hash`
(`db.js:224-236`).

### 6.2 Learner state that is not on the server

Everything a learner actually produces lives **only in that browser's localStorage** (§5.6):
flashcards (`fc_cards_v2`), saved words (`ws_saved`), lesson progress
(`learn_progress_<lang>`), roadmap ticks (`roadmap_<lang>`), the visible streak
(`streak_*`), theme, level and the resume point. Clearing site data or switching device loses
all of it.

There are effectively **three unsynchronised stores**:

| Store | Where | Key |
|---|---|---|
| Web flashcards | browser localStorage | `fc_cards_v2` |
| iOS flashcards | `UserDefaults` | `tongue.flashcards.v1` (`native/ios/Tongue/Features/Flashcards/FlashcardStore.swift`) |
| Server | — | **no deck table at all** |

Two more duplications:

- **Streaks.** The server writes ISO `YYYY-MM-DD` in **server UTC** (`routes/streaks.js:12`);
  the client writes `Date.toDateString()` in **browser-local** time (`public/index.html:2934`).
  The client never reads `GET /api/streaks`. The server's copy exists only to drive push
  reminders — which need two `FIREBASE_*` env vars that are not in `.env.example`.
- **Onboarding.** `users.onboarding_completed`, `user_goal` and `daily_commitment` are written
  and returned by `/validate`, but the web client gates onboarding purely on localStorage
  `_new_login` / `_seen_onboard`, so the wizard re-runs on every new browser even though the
  server knows it is done.

### 6.3 The content-identity problem

**No content item anywhere carries an id.** I walked all 84 seed files and collected every
field name at every depth:

```
a, can, categories, daily, dialogues, drills, dur, ex, ex1_ref, ex1_target, ex2_ref,
ex2_target, example_ref, example_target, example_target_2, explanation, exr, goal, hint,
items, level, lines, name, note, p, pattern, phase, phases, q, r, ref, rule, scene,
sections, speaker, structures, t, target, title, type, vocab, words
```

There is no `id`, `slug`, `key` or `uid`. **An item is addressable only by its array index.**

Lesson identity is built from those indices in `buildUnits` (`public/index.html:6031-6047`):

```js
const vLes = (i) => ({ id:"v"+i, kind:"vocab",    idx:i });   // index into content.categories
const gLes = (i) => ({ id:"g"+i, kind:"grammar",  idx:i });   // index into content.sections
const dLes = (i) => ({ id:"d"+i, kind:"dialogue", idx:i });   // index into content.dialogues
```

Grammar is *displayed* grouped by `s.level`, but `gLes(x.i)` emits the **original** index — so
`"g12"` means `content.sections[12]` of whatever row is in `content_cache` right now. Those ids
are what gets written to `learn_progress_<lang>`. Roadmap ticks use the same scheme,
`"<phaseIdx>-<milestoneIdx>"` (`public/index.html:4657`).

**Exactly what breaks if content is regenerated or re-seeded:**

| Change | Effect |
|---|---|
| A grammar row is regenerated with sections in a different order | Every learner's completed grammar lessons point at **different material**. No error, no warning — the ticks simply mark the wrong lessons. |
| A vocab row gains categories (16 → 30) | `"v0".."v15"` still resolve, but to different categories if ordering changed; `"v16".."v29"` appear as untouched. |
| A row **shrinks** | Ids past the new end resolve to `undefined`. Screens that index without a guard render nothing or throw. |
| A roadmap row's phases change | `"2-3"` now marks a different milestone. |
| Grammar `level` values change or are localised | `buildUnits` partitions on the literals `"Beginner"`, `"Intermediate"`, `"Advanced"` (`:6038, 6041, 6044`). Different strings ⇒ **entire course units vanish** while the `g<i>` ids stay in localStorage. |

Because the progress lives in browsers and never reaches the server, **there is no way to
measure from here how much a renumbering would destroy** — and no way to undo it.

This is precisely why P0 set `CONTENT_AUTOGEN` and `CONTENT_SEED_UPGRADE` to off-by-default.
Any fix — stable ids, a legacy id map, a content version column — has to land **before** those
flags are ever turned on, and it needs a read-only production snapshot first (gate G1).

---

## 7. Infrastructure

### 7.1 Docker image

`Dockerfile`, 15 lines, single stage:

```dockerfile
FROM node:20.20.2-alpine                                  # pinned patch
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force          # lockfileVersion 3, runtime deps only
COPY --chown=node:node . .
USER node                                                 # unprivileged
EXPOSE 3001
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
```

There is **no build step** — the client ships as raw `public/index.html` and is compiled in the
browser, so the image contains no bundler and the running app has a hard runtime dependency on
`unpkg.com`. There is no `HEALTHCHECK` instruction; the check lives in `fly.toml`.

Pre-P0 (`git show b3f6504^:Dockerfile`) this was `node:20-alpine` + `npm install --production`,
running as **root**.

`.dockerignore` (25 lines; 15 added by P0) excludes `node_modules`, `.env`, `.env.*`, `data/`,
`*.db`, `*.log`, `.git`, `native/`, `tests/`, `docs/`, `.claude/`, root-level `*.md`, scratch
globs and `coverage/`. Consequences:

- **The image cannot run the test suite** — `tests/` is excluded.
- `seed/` (2.0 MB) and `public/` (784 KB) deliberately stay; the server reads both at runtime.
- `*.md` matches the repo **root only** under Docker ignore semantics, so `seed/SCHEMA.md` still
  ships (the comment at `:17` says this is intended).
- The dead `railway.json`, `railway.toml` and `nixpacks.toml` are **not** excluded and are
  copied into every image.

### 7.2 `fly.toml`

| Setting | Value | Line |
|---|---|---|
| `app` | `tongue-app` | 5 |
| `primary_region` | `iad` | 6 |
| `[build] dockerfile` | `Dockerfile` | 9 |
| `[env]` | `NODE_ENV = "production"`, `PORT = "3001"` | 12–13 |
| `internal_port` / `force_https` | 3001 / true | 16–17 |
| `auto_stop_machines` | `"off"` | 18 |
| `auto_start_machines` | true | 19 |
| `min_machines_running` | 1 | 20 |
| concurrency | `connections`, hard 500, soft 300 | 22–25 |
| health check | `GET /health`, grace 20s, interval 30s, timeout 5s | 30–35 |
| `[[vm]]` | 512 mb, shared, 1 cpu | 37–40 |

Two things this file does **not** have:

- **No `[deploy]` section and no `release_command`.** The schema is (re)created on every boot
  inside `db.initialize()`, and its ALTERs are silenced. A bad migration surfaces as runtime SQL
  errors, never as a failed deploy.
- **`[[vm]]` sets machine *size*, not *count*.** The real machine count can only be read with
  `fly status`, which was not run.

Always-on + at least one machine means the in-process `node-cron` schedules always run; the
`job_runs` claim table is what stops N machines doing the same work N times.

### 7.3 Deploy and rollback

All `fly` commands below are **documented in the repo, not executed** — the safety rules for
this task forbade touching production. Treat the exact image-tag form as **unverified**.

| Action | Command | Source |
|---|---|---|
| Deploy | `fly deploy` | `DEPLOY.md:62`, `DEPLOYMENT_CHECKLIST.md:100` |
| Set secrets | `fly secrets set KEY=value` | `DEPLOY.md:42-54` |
| List releases | `fly releases` | `DEPLOYMENT_CHECKLIST.md:205` |
| Roll back | `fly deploy --image registry.fly.io/tongue-app:<previous>` | `DEPLOYMENT_CHECKLIST.md:206` |
| Last-resort restart | `fly scale count 0` then `fly scale count 1` | `DEPLOYMENT_CHECKLIST.md:209-210` |
| Logs | `fly logs --app tongue-app` | `DEPLOY.md:148` |

**Verify a deploy from the code, not from the dashboard**: `GET /api/version` returns
`{version: FLY_IMAGE_REF, startedAt}` with `Cache-Control: no-store`, and `GET /health` returns
200 or 503. `fly deploy` waits for new machines to pass the `/health` check before proceeding.

### 7.4 The second Fly app

The string `tonge-app` (note the typo) appears in `.env.example:20` and `:22`,
`native/ios/.../APIClient.swift`, `native/android/app/build.gradle.kts`, and
`docs/ARCHITECTURE_FORENSICS.md:70` ("older build, still live").

**Whether `tonge-app` shares the production database is NOT established by anything in this
repo — unknown, needs checking.** `docs/docs/MIGRATION_PLAN.md §2 (gate G7)` (gate G7) states the open
question rather than a settled fact: *"If it shares the production database it duplicates cron
jobs"*, and `:125` lists confirming its `DATABASE_URL` as a prerequisite. Answering it needs
`fly secrets list --app tonge-app` or `fly ssh console`, run by the owner.

What **is** verified from the repo: `capacitor.config.json:6` points the Capacitor shell at
`https://tongue-app.fly.dev` (the current host) while the hand-written native sources point at
`tonge-app.fly.dev` (the old one) — **the native surface disagrees with itself**.

### 7.5 Environment variables

Names and purpose only. Never put a value in a document; `.env` holds production credentials.

| Variable | Required | Read where | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | `db.js:19` | Production Postgres. **Never read when `NODE_ENV=test`.** Falls back to `postgresql://localhost/tongue_dev`. |
| `TEST_DATABASE_URL` | tests only | `tests/support/assertTestDatabase.js:10` | The only database the app may open in test mode, and only a local `*_test` one. |
| `JWT_SECRET` | yes | `routes/auth.js:9` | Signs every session. **Falls back to the literal `"dev-secret-change-in-production"` when unset**, producing working but forgeable tokens. |
| `ANTHROPIC_API_KEY` | yes | `routes/claude.js`, `routes/support.js`, `routes/content.js:1338` | Absence surfaces as `ai_unconfigured`, checked *before* quota. |
| `STRIPE_SECRET_KEY` | yes | `routes/stripe.js:19` (lazy) | Checkout, portal, deletion-time cancellation. |
| `STRIPE_WEBHOOK_SECRET` | yes | `routes/stripe.js:106` | Without it every webhook is 400 `webhook_unconfigured`. |
| `ADMIN_PASSWORD` | yes | `routes/admin.js:73` | The single admin credential. Unset = every login 401s (no bypass). |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | no | `routes/stripe.js` | Chosen by plan in checkout, and the reverse lookup that maps a price id back to a plan in the webhook. Unset ⇒ 500 `billing_unconfigured`. |
| `NODE_ENV` | — | everywhere | `production` makes missing required env fatal (`server.js:47`); `test` disables dotenv, forces the test-DB guard, skips `seedContent()` and startup generation, and disables several IP limits in `routes/auth.js`. |
| `PORT` | — | `app.js:24`, `server.js:51` | Code default **3000**; `fly.toml` sets **3001**, matching `EXPOSE`. |
| `CONTENT_AUTOGEN` | no | `server.js:56`, `routes/content.js:1450` | Must be exactly `"on"`. **Not in `.env.example`.** |
| `CONTENT_SEED_UPGRADE` | no | `routes/content.js:1801` | Must be exactly `"on"`. **Not in `.env.example`.** |
| `APP_URL` | no | `app.js:45`, `:135`, `utils/email.js:22`, `routes/stripe.js` | CORS allowlist, SEO page base, every email link, checkout/portal URLs. Default `http://localhost:3000`. |
| `FRONTEND_URL` | no | `app.js:46` | Second CORS allowlist entry. |
| `GOOGLE_CLIENT_ID` | no | `app.js:105`, `routes/auth.js` | Gates `POST /api/auth/google` (503 when unset) and is echoed publicly by `/api/config`. **Not in `.env.example`.** |
| `FLY_IMAGE_REF` | set by Fly | `app.js:93` | Reported by `/api/version`. |
| `GIT_SHA` | no | `app.js:93` | Version fallback for non-Fly hosts. **Not in `.env.example`.** |
| `RESEND_API_KEY` | no | `utils/email.js:4` | Enables the Resend transport, at module load. |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | no | `utils/email.js:11` | All three needed together to enable the preferred SMTP transport. **None in `.env.example`.** |
| `SMTP_PORT` | no | `utils/email.js:15` | Default `"465"`; `secure` is true only when the value is exactly `"465"`. |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | no | `utils/email.js:21` | The From header. `EMAIL_FROM_NAME` is **not in `.env.example`**. |
| `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT_JSON` | no | `utils/push.js:20` | Both required before any push is sent. **Neither is in `.env.example`.** |
| `DB_PATH` | dead | `scripts/prewarm-content.js:22` | SQLite-era leftover. |
| `VERBOSE` | no | `scripts/validate_seed.js` | Per-file validator output. |

`.env.example` additionally lists **`ADMIN_EMAILS` and `SUPPORT_EMAIL`, which are referenced by
no JavaScript in the repo** — I grepped every `.js` and `.html` outside `node_modules` and found
zero hits.

### 7.6 Service worker

`public/sw.js`, registered unconditionally from `public/index.html:226-228`.
`CACHE_NAME = "tongue-v2"` (`:4`); `STATIC_ASSETS = ["/", "/subscribe", "/faq", "/manifest.json"]`
(`:5-10`) — note **`/app` is not pre-cached**, so the app page is only cached opportunistically
after a first successful navigation.

Fetch strategy (`:38-75`): `/api/` and `/admin` are never intercepted (`:42-44`);
`request.mode === "navigate"` is network-first with a cache fallback (`:47-59`); everything else
is cache-first, and CDN responses (`url.includes("unpkg.com") || url.includes("cdn")`) are
written to the cache (`:65-72`). Google Fonts match neither test, so fonts are never
runtime-cached.

### 7.7 Dead platform configs

| File | Lines | What it says | Why it matters |
|---|---|---|---|
| `railway.json` | 13 | NIXPACKS builder, `startCommand "node server.js"`, healthcheck `/health` | Start command **lacks** `--dns-result-order=ipv4first` |
| `railway.toml` | 9 | `startCommand "node --dns-result-order=ipv4first server.js"` | Contradicts `railway.json` |
| `nixpacks.toml` | 8 | `nodejs_20`, `npm install --production` | Unpinned resolution — the exact thing P0 replaced with `npm ci --omit=dev` |

Three mutually inconsistent install/start recipes, all tracked, all shipped in the image, none
used. The IPv4 comments in `db.js:26` and `server.js:12` still explain a Railway/Supabase IPv6
problem that no longer applies.

---

## 8. Tests

**Harness:** Node's built-in test runner. **Zero test dependencies** — no jest, vitest,
playwright, puppeteer or supertest anywhere in `package.json`.

**The command** (`package.json:9` is `NODE_ENV=test node --test tests/smoke.test.js`). The full
invocation that works against a local throwaway Postgres, which I ran:

```
NODE_ENV=test \
TEST_DATABASE_URL=postgres://tongue@127.0.0.1:55432/tongue_verify_test \
DATABASE_URL= ANTHROPIC_API_KEY= RESEND_API_KEY= STRIPE_SECRET_KEY= \
STRIPE_WEBHOOK_SECRET= SMTP_HOST= SMTP_USER= SMTP_PASS= EMAIL_FROM= \
GOOGLE_CLIENT_ID= JWT_SECRET=local-test-secret ADMIN_PASSWORD=local-admin-test \
npm test
```

Real result at `b3f6504`: **`# tests 24  # suites 8  # pass 24  # fail 0  # skipped 0`**, exit 0.

`[EMAIL] (no transport configured)` and `[EMAIL] ✗ ALL transports failed` lines during signup
tests are **expected**, not failures — the transports are deliberately blanked.

### 8.1 What the 24 tests cover

`tests/smoke.test.js` (297 lines) imports `../app`, **not `../server`**, and listens on port 0 —
so no cron, no `seedContent`, no dotenv.

| Suite | Line | Tests | What |
|---|---|---|---|
| Infrastructure | 83 | 2 | `/health` 200 `db:ok`; `/api/stripe/prices` returns price objects |
| Auth — signup | 104 | 4 | valid email → token + `plan:free`; missing email 400; invalid email 400; idempotent repeat |
| Auth — validate | 138 | 3 | valid free token; no token 401; garbage token 401 |
| Auth — login | 167 | 3 | invalid code 401; missing code 400; empty-string code 400 |
| Access control — unauthenticated | 189 | 4 | `/api/claude`, `/api/streaks`, `/api/streaks/log`, `/api/content/status` all 401 |
| Access control — free tier | 213 | 2 | `GET /api/streaks` 200 for a free token (**streaks are free**); `POST /api/claude` not 401/402 for a free token |
| Access control — admin | 251 | 3 | wrong password 401; `/admin/api/stats` and `/admin/api/users` 401 without a token |
| Input validation | 272 | 3 | 1000-char email 400; non-string code 400; oversized prompt 400 |

`before()` (`:35`) throws if `TEST_DATABASE_URL` is missing (`:37-39`), runs `db.initialize()`
(`:40`) and `DELETE FROM rate_limits` (`:43`) — harmless only because the guard makes a local
`*_test` database the only reachable target.

### 8.2 The production guard

`tests/support/assertTestDatabase.js` (27 lines) is called from `db.js:17-19` whenever
`NODE_ENV === "test"`, **at module require time, before any pool is opened**.

It requires: `NODE_ENV === "test"`, a `TEST_DATABASE_URL`, a hostname in `LOCAL_HOSTS` (`:8` —
`localhost`, `127.0.0.1`, `::1`, `[::1]`, `postgres`), and a database name ending in `_test`
(`:20`). `DATABASE_URL` is never read in test mode, so the production credential in `.env` is
unreachable from the suite.

Refusal messages (previously exercised): `Refusing to run tests against <host>/<db>`;
`Refusing: TEST_DATABASE_URL is required (DATABASE_URL is ignored in tests)`;
`Refusing: TEST_DATABASE_URL is not a valid URL`. A bare `npm test` with no
`TEST_DATABASE_URL` fails loudly and exits 1.

One mismatch worth knowing: the guard accepts `::1`, `[::1]` and `postgres`, but `db.js:20`
decides "is local" by substring-matching only `"localhost"` and `"127.0.0.1"`. A guard-approved
`::1` or docker-compose `postgres` URL would be handed `ssl:{rejectUnauthorized:false}` and
`family:4`. Established by reading the expression, **not reproduced against a live socket**.

### 8.3 The local test database

A **throwaway** Homebrew PostgreSQL 14.19 cluster on `127.0.0.1:55432`, with its data directory
inside this session's scratchpad — **assume it is gone in a future session** and recreate it:

```
createdb -h 127.0.0.1 -p 55432 -U tongue <name>_test     # schema is created by db.initialize()
dropdb   -h 127.0.0.1 -p 55432 -U tongue <name>_test
```

`.claude/launch.json` is the only ready-made non-test way to run the server without touching
production: it points at `postgres://tongue@127.0.0.1:55432/tongue_local` with blank provider
keys and `PORT=3001`. It is committed to a **public** repo, so it must never gain a real value.

### 8.4 What is NOT covered — the honest list

- **No client tests at all.** `public/index.html` is 569 KB of browser-compiled JSX with zero
  tests, zero lint, zero typecheck.
- **No E2E or browser tests.** No Playwright, no Puppeteer.
- **No CI.** `.github/` does not exist. The 24 tests run only when a human remembers.
- **No unit tests.** Nothing tests `utils/`, the `db.js` helpers, or the 154 KB of
  `routes/content.js`.
- **Untested routers entirely**: the Stripe webhook signature and transaction path, `push`,
  `support`, and all of `routes/content.js`'s generation, validation and seeding logic.
  `content` is touched by exactly one 401 test; `stripe` by one prices test; `admin` by 401s.
- **No provider stubs.** The AI test passes because Anthropic is unconfigured, so it asserts
  only "not 401/402" — it proves authorization, not AI behaviour.
- **No coverage tooling.**
- **`scripts/validate_seed.js` is wired to nothing** — no `validate` npm script, no CI — and it
  currently **exits 1**.
- P0 plan items never delivered: `.env.test`, `tests/compose.yml`, a CI workflow,
  `scripts/export-content-snapshot.js`, Zod validation (`zod` is not a dependency), and the
  `tongue-app-staging` app.
- **P0 has no regression tests of its own.** The 24 passing tests are the pre-existing suite.

---

## 9. Known defects and dead code surviving P0

Severity key: **P0** = money, security or data loss; **P1** = a user-visible feature is broken;
**P2** = wrong or misleading behaviour; **P3** = clutter, drift, maintenance burden.
Every entry names a file and a symbol.

### 9.1 Security

| Sev | Defect | File · symbol |
|---|---|---|
| **P0** | **The pre-P0 `ADMIN_PASSWORD` is still in this public repo's git history.** P0 replaced the value with a placeholder in the working tree only. `git log --follow -- DEPLOY.md` shows the file was introduced in the initial commit `a5a4718`, and the `b3f6504^` blob's `ADMIN_PASSWORD=` line is **not** a placeholder. An 8-character `JWT_SECRET` prefix was also published. **Rotation on both Fly apps is gate G5 and is not confirmed done.** | `DEPLOY.md` (history), commit `a5a4718` |
| **P1** | **Suspension and deletion do not revoke live sessions.** `requireAuth` verifies the JWT and nothing else; `checkAccess` returns `{ok:true}` immediately for any free-plan JWT. Only `GET /api/auth/validate` checks `users.status`. A suspended or deleted free account keeps working on every other `requireAuth` route, and keeps its 5 AI messages a day, until its 90-day token expires. | `routes/auth.js:660` `requireAuth`; `routes/claude.js:95` `checkAccess` |
| **P2** | **A cancelled account is silently reactivated by `/signup`.** The upsert's status CASE protects only `'suspended'`: `status = CASE WHEN users.status = 'suspended' THEN users.status ELSE 'active' END`. A `status='cancelled'` row posting to `/api/auth/signup` gets a fresh 90-day token and flips back to `active`. The same expression is in `issueSessionForEmail`. | `routes/auth.js:246`, `:68` |
| **P2** | **`JWT_SECRET` silently falls back to a literal.** `const JWT_SECRET = () => process.env.JWT_SECRET \|\| "dev-secret-change-in-production"`. Unset in production it produces working but forgeable tokens rather than a hard failure. (`server.js` does list it in `REQUIRED_ENV`, so a *production* boot would exit — but any other `NODE_ENV` will not.) | `routes/auth.js:9` |
| **P2** | **Admin sessions are a single shared credential with no identity.** 64 hex chars, 8-hour expiry, no IP binding, no rotation, one shared `ADMIN_PASSWORD`, token kept in `localStorage`. | `routes/admin.js:78-79`; `public/admin-content.html:225` |
| **P3** | **PII in `rate_limits` and `magic_links`.** Rate-limit keys embed raw email addresses (`signup_email:`, `magic_email:`, `resend_email:`); `magic_links.email` is plaintext and **rows are never deleted**, used or not. | `db.js:101`, `:173`; `routes/auth.js:232`, `:367`, `:453` |

### 9.2 Money

| Sev | Defect | File · symbol |
|---|---|---|
| **P0** | **The billing-portal button always 401s.** P0 changed `POST /api/stripe/create-portal` to `requireAuth` and to ignore the body, but the client call still sends only `Content-Type` and `{ email }` — **no `Authorization` header**. `git diff b3f6504^ b3f6504 -- public/index.html` contains **zero** `create-portal` hits, so the client was never updated. Fix is one line. *(Today this is masked by the next defect: the caller is dead code.)* | `public/index.html:4727` `openBillingPortal`; server at `routes/stripe.js:84` |
| **P0** | **A paying user cannot cancel or delete from the app.** The live settings sheet, `SettingsOverlay`, offers native language, theme, dark toggle, voice panel, an Upgrade link, and a hardcoded-English "Sign out" — **no billing control and no delete-account control**. `POST /api/stripe/create-portal` is called only at `:4727` and `DELETE /api/auth/account` only at `:4704`, both inside `SettingsPanel`, which has **zero mount sites**. The i18n keys `manage_billing`, `del_account` and `sign_out` exist in all 12 languages and are never passed to `t()`. Both server routes are live. | `public/index.html:6823-6880` `SettingsOverlay`; dead caller `:4685-4840` `SettingsPanel` |
| **P1** | **The cancellation email promises access the code revokes.** The template says *"Your access code will stay active until the end of your current billing period"*, but the `customer.subscription.deleted` handler sets every code to `is_active = 0` and `users.plan='free', status='cancelled'` **in the same transaction**. | `utils/email.js:148`; `routes/stripe.js:389-390` |
| **P1** | **The `paid_access_until` grace period is unreachable from the webhook.** `hasActivePaidAccess` gates on `plan !== 'free' AND status === 'active'` **before** reaching the grace branch. `customer.subscription.updated` writes `status='cancelled'` for a non-active sub and `customer.subscription.deleted` writes `plan='free'` — so the grace period only fires for a state no handler produces. | `db.js:255` (gate) vs `db.js:272` (branch); `routes/stripe.js:389` |
| **P1** | **Events the webhook ignores are still marked processed.** The `stripe_events` INSERT runs **before** the handler inside the same transaction and commits even when the switch `break`s without doing anything — including a `checkout.session.completed` carrying **no email**, which creates no user and logs only `[Stripe] checkout.session.completed: no email`. Stripe sees 200 and never retries, and a code fix cannot replay it. **A paying customer who arrives without an email address is lost silently.** | `routes/stripe.js:142` vs `:143`; no-email break at `:187+` |
| **P2** | **A late renewal event moves subscription dates backwards.** `extendActiveCodes` protects `access_codes.expires_at` with `GREATEST`, but the `subscriptions` UPDATE assigns `current_period_end` and `paid_access_until` directly, so the two can disagree. | `routes/stripe.js:172-174` vs `:305-306` |
| **P2** | **Paid sessions advertise the wrong expiry.** The JWT is signed `expiresIn "30d"` but the response's `expiresAt` is the access code's expiry (~365 days for yearly). `saveSession` stores it and `isLoggedIn()` trusts it, while the validate-on-startup effect swallows a 401 (`r.ok ? r.json() : null` then `if (!d \|\| !d.valid) return;`). A yearly subscriber's client believes it is signed in for a year while the token dies at day 30; only the Coach has a 401→`logout()` handler. | `routes/auth.js:93`, `:196`; `public/index.html:2890`, `:2893`, `:8193`; 401 handlers at `:3036`, `:3075` |
| **P2** | **`requirePaid` is dead code.** Defined at `routes/auth.js:672`, exported at `:688`, and a repo-wide grep finds **no route that uses it**. The only free/paid difference the server enforces is the AI quota in `reserveQuota`, keyed on the **JWT** `plan` claim rather than the database. | `routes/auth.js:672` |
| **P3** | **`GET /api/stripe/prices` hardcodes 900/7900 cents** and does not read the live Stripe price objects, so it can silently drift. Pricing is additionally duplicated across `home.html` (×4), `subscribe.html` (×2), `faq.html` (×3) and `index.html` (×3) — a price change means editing four files. | `routes/stripe.js:27-32` |

### 9.3 Content

| Sev | Defect | File · symbol |
|---|---|---|
| **P0** | **16 of 84 seed files fail the validator**, so on a fresh database grammar is missing for **all 12 languages** and vocab for **fr/es/de/pt**, and those tabs answer 503 `content_unavailable`. Measured: `node scripts/validate_seed.js` → `68 valid, 16 invalid, 0 missing (of 84)`. The zero-AI fallback the architecture advertises does not exist for those pairs. | `seed/content/*/grammar.json`, `seed/content/{fr,es,de,pt}/vocab.json` vs `validateContent` `routes/content.js:1243`, `:1245`, `:1286`, `:1287` |
| **P0** | **`seed/SCHEMA.md` contradicts the validator.** It documents grammar sections with no `examples` array and no `common_mistake`, and vocab as "8–12 words" of `{t,p,r}`. The validator demands `examples` ≥3 plus `common_mistake`, and ≥30 words each carrying `t`, `r` **and** `ex`. **Anyone authoring from this spec today reproduces the failure.** | `seed/SCHEMA.md` |
| **P1** | **`section.level` is required by the course and checked by nothing.** `buildUnits` partitions the whole Learn course on the literals `"Beginner"`/`"Intermediate"`/`"Advanced"`; `validateContent` never requires `level`. Valid content without it produces **zero grammar units**, silently. | `public/index.html:6038, 6041, 6044` vs `routes/content.js:1219` |
| **P1** | **Production content is not reproducible from the repo** and has never been snapshotted (gate G1). `seedContent` never replaces an existing row while `CONTENT_SEED_UPGRADE` is off, so whatever production holds for the 16 failing pairs exists nowhere else. **Unknown — needs checking.** | `routes/content.js:1798` |
| **P2** | **`seedItemCount` counts top-level array length only.** For vocab it counts *categories*, not words, so a 30-shallow-category production row looks as deep as a 30 × 40 seed. Depth regressions inside a tab are invisible. | `routes/content.js:1786` |
| **P2** | **`buildVocabPrompt` is unreachable dead code and contradicts the live spec** — it still says "Generate exactly 18 words" while `VOCAB_WORDS_PER_CATEGORY` is 40 and the validator demands ≥30. A reader will mistake it for the vocab specification. | `routes/content.js:1143` |
| **P2** | **Inconsistent error contract on `GET /api/content/:lang/:tab`.** The two 400s and the on-demand-generation 503 carry **no `code`**, while every other failure in the file does. A client switching on `code` falls through. | `routes/content.js:1621`, `:1622`, `:1677` |
| **P2** | **`generateAndStoreVocab`'s retry does not back off on a short answer** — the 1500 ms delay is only in the catch branch, so a well-formed but too-short response retries immediately. | `routes/content.js:1408-1421` |
| **P3** | `scripts/validate_seed.js` is the gate that would have caught all of this, **and nothing runs it** — no npm script, no CI. It currently exits 1. | `scripts/validate_seed.js` |
| **P3** | Stale comment: `routes/content.js:984` says "5 real-life scenes per language"; every list has **6**. | `routes/content.js:984` |
| **P3** | `routes/claude.js` duplicates the 12-language name map as `LANG_NAMES_COACH` instead of importing `LANG_NAMES` — which it already imports `VALID_LANGS` from. Two sources of truth. | `routes/claude.js:14` |
| **P3** | Three Anthropic model ids are bare string literals in three files with no shared constant: `claude-opus-4-5` (`routes/content.js:1349`), `claude-sonnet-4-5` (`routes/claude.js:237`, `:378`), `claude-haiku-4-5-20251001` (`routes/support.js:59`). Whether each is still a valid live model id is **unknown — needs checking** against current provider docs; no provider call was made. The `$3`/`$15` per-MTok figures in `logUsage` are a hardcoded estimate, not a fetched price. | as listed |

### 9.4 Client

| Sev | Defect | File · symbol |
|---|---|---|
| **P1** | **Every number on the Review screen is wrong.** Cards are stored with `next_review`, but `ReviewScreen` reads `c.nextReview`: `(c.nextReview \|\| 0) <= now` is `0 <= now` for every card (so "due" always equals the whole deck), `!c.nextReview` marks every card "unseen", `c.nextReview && …` always yields 0 upcoming, and the progress bar is therefore always 0 %. It also never filters by language — `fcLoad()` is unfiltered while `Flashcards` uses `fcDeckStats(cards, tLang, …)`. `fcDeckStats`'s own comment says it exists so the two screens "must always agree"; `ReviewScreen` never calls it. | `public/index.html:6602`, `:6603`, `:6647`; correct helper at `:2833` |
| **P1** | **Word Space imports mislabel the language.** `ws_saved` entries carry no language field, and `importFromWordSpace` stamps the **current** target language on all of them: `fcAdd({ lang: tLang, front: entry.fr, … })`. Save French words, switch to Japanese, import — the whole deck is now Japanese. | `public/index.html:5224`; entry built at `:4994-5001` |
| **P1** | **`SupportChat` is unreadable in dark mode.** It is mounted unconditionally and uses `.sheet`, whose background is `var(--surf)` → `#161420` in dark mode, while painting text `#0f172a`, borders `#f1f5f9`/`#e2e8f0`, muted `#64748b` and a fixed `#C0153E` accent that ignores `applyAccent`. Near-black text on a near-black sheet. *(Read from the code; confirm visually before filing.)* | `public/index.html:8501-8622`, mounted `:8479` |
| **P2** | **`TextAnalyzer` defeats the P0 error contract** — its catch sets `"Could not analyze. Check your connection and try again."` unconditionally, discarding the `ApiRequestError`. A 429, an expired session, an `ai_overloaded` 503 and a genuine offline failure all print the same "check your connection", which is exactly what `aiErrorMessage` was written to eliminate. | `public/index.html:7605-7611` |
| **P2** | **Four more `askClaude` call sites discard the error entirely**: `CultureScreen` sets only `{loading:false, err:true}` (`:6532`); `Conversation.translateMsg` just clears the spinner with no message (`:7418`); `Conversation.endConversation` sets `setSummary(null)` (`:7431`); `SentenceExplorer` collapses everything to `{err:true}` (`:6140`). | `public/index.html` as listed |
| **P2** | **Four live call sites still print hardcoded "Connection error. Please try again."** from a catch that also wraps `await res.json()`, so a non-JSON response (a proxy error page, a 502 HTML body) is misreported as a network failure. Plus `SupportChat`'s "Connection issue." | `public/index.html:3184`, `:3203`, `:3251`, `:3272`, `:8154`, `:8537` |
| **P2** | **Nine of twelve languages render machine-generated placeholders as content.** The `LANGS_DATA` stub generator emits `c1:"..."`, `options:["Option A","Option B","Option C","Option D"]`, `term:"Hello"`, `pron:"..."` for pt, it, de, en, zh, ko, ru, ar, hi. These are rendered by reachable views — `ConceptScreen`, `VocabWordsScreen`, `PhrasesScreen`. | `public/index.html:959-1009`; consumers `:5803`, `:5912`, `:5959` |
| **P2** | **The vocabulary screens display fabricated progress.** `vocabThemes` entries carry static `count` and `pct` literals (`count:100, pct:"20%"` for every stub language), rendered as "{count} words · {pct} known" and used to drive the progress-bar width. None of it derives from the learner. | `public/index.html:5900`, `:5902`, `:5925`; data `:581-587`, `:995-1000` |
| **P2** | **`VocabWordsScreen` ignores the theme the user picked** — `theme` is used only for the header while the list is `L.words.filter(...)`, a single flat array. Tapping "Food & Drink" shows the same six travel words as "Travel". `:5947` also indexes `stateMap[w.state].icon` with no guard. | `public/index.html:5912-5947` |
| **P2** | **Flashcards copy contradicts the algorithm.** The UI says "'Again' brings it back immediately", but `sm2` with quality 0 sets `interval = 1` and `next_review = now + 86400000` — tomorrow. And "Hard" (mapped to SM-2 quality 2) is a **pass**: only quality 0 resets `repetitions`, so for `repetitions ≥ 2` a "Hard" answer runs `interval * ease` and pushes the card further away. | `public/index.html:5290` vs `:2812-2827` |
| **P2** | **The sentence-breakdown cache grows without bound.** One `localStorage` entry per distinct sentence under `bd_<lang>_<hash>`, no eviction, no size accounting, no version prefix, `QuotaExceededError` swallowed by a bare catch. `_skey` is a 32-bit hash, so distinct sentences can collide and serve the wrong breakdown. | `public/index.html:6110-6120` |
| **P2** | **The level chosen during onboarding does not appear until the next page load.** `NewOnboarding.saveAndFinish` POSTs `{level, language}` but never writes `localStorage["user_level"]`; the only writer is the `/validate` handler, which runs once on mount. Until then `ExploreHome` falls back to `Level ${L.level}` — "Level A2" for every language, since the stub generator hardcodes `level:"A2"`. | `public/index.html:6679-6689` vs `:8206`; fallback `:5562`, `:976` |
| **P2** | **The live onboarding silently dropped two fields.** The dead `OnboardingModal` posted `{level, goal, dailyCommitment, language}`; `NewOnboarding` posts only `{level, language}`. If the server still persists `goal` and `daily_commitment`, those columns are now never written by the web client. | `public/index.html:6685` vs `:6944` |
| **P2** | **No error boundary and no local fallback for the CDN.** `ReactDOM.createRoot(...).render(<App/>)` is unguarded, and React, ReactDOM, Babel and lucide all load from unpkg. If unpkg is unreachable, `#root` stays empty with no message. React and ReactDOM use the **unpinned** ranges `react@18` / `react-dom@18`, so a patch release can change production behaviour with no commit in this repo. | `public/index.html:8618-8619`, `:18-21` |
| **P2** | **`sw.js` can poison its own cache.** The CDN branch calls `caches.put` with no `res.ok` check and the fetch has no `.catch`, so a failed or error unpkg response is written to cache `tongue-v2` and served until `CACHE_NAME` is bumped — for an app whose React runtime comes from unpkg, that is app-breaking. | `public/sw.js:65-72` |
| **P3** | **`nav_learn` and `translate_failed` are English-only** in all 11 other languages, so the primary Learn tab reads "Learn" for most UI languages. Beyond that, **229 English JSX text nodes and 17 English attributes** remain hardcoded against a 227-key dictionary. | `public/index.html:2578`, `:1426`; usages `:5565`, `:7844`, `:8391` |
| **P3** | **Nine local bindings shadow the global `t()`** in the same flat scope (`:427`, `:960`, `:3907`, `:5725`, `:6144-6146`, `:7346`, `:7380`). None of those scopes currently calls `t("key")`, so nothing is broken — but `:5725` (`{MORE.map(t => (`) wraps JSX that renders labels and is **one translated string away from a TypeError**. | `public/index.html` as listed |
| **P3** | **Latent:** `Roadmap` initialises `done` from `localStorage["roadmap_"+tLang]` in a `useState` initialiser with no `useEffect` on `tLang` (`LearnPath` has exactly that guard). Today `LangSwitchOverlay` resets the view and unmounts `Roadmap`, so I could not construct a live path — but it is one refactor from firing. | `public/index.html:4618-4620` vs `:6369` |
| **P3** | `const mobile = useMobile()` in `App` is assigned and never read; `useMobile` attaches a resize listener purely to feed dead state. | `public/index.html:8067` |
| **P3** | **Two incompatible `flag` conventions**: `TARGETS[x].flag` / `REFS[x].flag` are emoji, `LANGS_DATA[x].flag` is a CSS gradient string. `TopBar:7903` does `background: L.flag` and only works because `L` comes from `LANGS_DATA`. | `public/index.html:506`, `:520`, `:546` |

### 9.5 Platform, tooling and drift

| Sev | Defect | File · symbol |
|---|---|---|
| **P0** | **`npm run prewarm` / `prewarm:force` loads the production `.env`.** `scripts/prewarm-content.js:17` calls `require("dotenv").config()` with no test guard, so it would use the production `DATABASE_URL` and real Anthropic credits. `--force` regenerates everything — **precisely the harm the content freeze exists to prevent.** It is also already broken: it requires `better-sqlite3`, which is in neither `package.json` nor `node_modules`, and it writes a column named `content` where production has `content_json`. **Never run it. Delete it and the two npm scripts.** | `scripts/prewarm-content.js`; `package.json:16-17` |
| **P1** | **Every migration and index in `initialize()` is silenced** with `.catch(() => {})`, and there is no schema-version table — a genuinely failed migration is invisible and the boot still prints `Schema ready ✓`. | `db.js:219`, `:239` |
| **P1** | **No retention on 6 of 14 tables.** The 3 AM cron prunes only `admin_sessions` and `rate_limits`. `job_runs`, `magic_links`, `stripe_events`, `ai_usage_logs`, `analytics_events` and `content_reports` grow forever. `job_runs` adds ~2 rows/day with the freeze on, ~6 with it off. | `server.js:108-112` |
| **P2** | **Unknown API paths return the HTML 404 page, not JSON.** Verified: `GET /api/nope` and `GET /admin/api/unknown` both → `404 text/html`. A `fetch()` client parsing the response as JSON gets a parse error instead of a code. | `app.js:285` |
| **P2** | **`sendEmail` returns `false` in console-fallback mode and no caller checks it.** `routes/auth.js:265`, `:384`, `:472` and `routes/admin.js:268` all `await sendEmail(...)` and discard the result, so undelivered access-code and magic-link mail reads as success. Only `routes/stripe.js:160` checks `ok === false`. | `utils/email.js:38` and the listed callers |
| **P2** | **`trackEvent` is `async` but never awaits its INSERT** and swallows its errors, so `await db.trackEvent(...)` gives no delivery guarantee at all. | `db.js:279-281` |
| **P2** | **`analytics_events` is write-only.** 14 event names are inserted from five files; a repo-wide grep finds **no SELECT** from the table. Two indexes are maintained for queries nobody runs. | `db.js:136`, `:281` |
| **P2** | **`ai_usage_logs.input_length` / `output_length` hold token counts, not lengths.** `logUsage` writes `inputTokens` / `outputTokens` into columns named `*_length`. | `routes/claude.js:184`; `db.js:124` |
| **P2** | **The cron comments claim UTC but `node-cron` is given no `timezone` option.** Matching uses process-local time while the slot keys stay UTC. Correct on Fly only because the image sets no `TZ` — and whether the machines actually run UTC is **unknown — needs checking**. | `server.js:79`, `:90`, `:105` |
| **P2** | **`utils/push.js` throws a plain object, not an `Error`**: `{ stale: true, token }`. It works only because both callers test `e.stale`; anything else would log an object with no stack. | `utils/push.js:73` |
| **P2** | **Streaks compute "today" from the server clock in UTC**, so the practice day rolls over mid-evening for western-hemisphere learners. The push reminder compounds it by comparing a Node UTC string against Postgres `CURRENT_DATE::TEXT`. | `routes/streaks.js:12`, `:33`; `utils/push.js:114-121` |
| **P2** | **`routes/streaks.js:17` INSERTs the first row with no `ON CONFLICT`** against a primary key. A duplicate raises `23505` → a 500 via `asyncHandler`. The window is between the SELECT at `:14` and the INSERT; **reachable in principle, not observed** — three parallel requests did not reproduce it. | `routes/streaks.js:14-20` |
| **P2** | **`db.js`'s SSL decision is a substring test** for `"localhost"`/`"127.0.0.1"` in the connection string, so a remote host merely *containing* either substring would connect without TLS. | `db.js:20` |
| **P2** | **Account deletion is soft and incomplete.** `access_codes` rows are deleted and the email is anonymised, but the `users` row survives with `status='deleted'`, so `streaks`, `ai_usage_logs`, `analytics_events`, `content_reports` and `push_tokens` rows all remain and the `ON DELETE CASCADE` on `push_tokens` never fires. | `routes/auth.js:644-649` |
| **P3** | **`app.js`'s own JSDoc documents an export that does not exist.** Lines 8–9 advertise `const { app } = require('./app')`; the file only does `module.exports = app`, so `require('./app').app` is `undefined`. | `app.js:8-9` vs `:324` |
| **P3** | **`db.js`'s docstring omits `lastID`** from `run()`'s return. | `db.js:7` vs `:44` |
| **P3** | **The startup banner prints the configured `PORT`, not the bound port** — `PORT=0` prints "running on port 0". | `server.js:135` |
| **P3** | **Cron jobs are registered before `db.initialize()`** — on a first boot against an empty database a job firing in that window would fail on a missing `job_runs` table and be swallowed. | `server.js:79-118` vs `:122` |
| **P3** | **The admin dashboard cannot reach features its own API has.** `generateCode()` refuses to submit without an email, so unclaimed codes (`unclaimed: true`) can only be created with curl. The Content Library tab hardcodes **10** languages (`LANG_NAMES_ADMIN`, missing fr and hi) and **4** tabs (`TABS_ADMIN`) against a server supporting 12 and 7. | `routes/admin.js:547`, `:598`, `:599`, `:197` |
| **P3** | **`public/admin-content.html` is a second, unlinked admin UI.** Nothing in `routes/`, `app.js` or `server.js` references it; it duplicates the inline grid in `routes/admin.js` and hardcodes 5 tabs and 10 languages, **missing fr and en entirely**. | `public/admin-content.html:192-193` |
| **P3** | **Stale copy — the language count is inconsistent across four files.** `TARGETS` defines 12. `public/manifest.json:4` says "11 languages"; `public/index.html:7` lists "…and 7 more" (= 11); the signup welcome email says "all 11 language reference guides" (I saw it in a live local signup). `faq.html`, `subscribe.html` and `home.html` all say 12. | `routes/auth.js:277`; `public/manifest.json:4`; `public/index.html:7` |
| **P3** | **`manifest.json` `start_url` is `/`**, so an installed PWA opens the marketing page rather than `/app`, and `"screenshots": []` means no rich install UI. | `public/manifest.json:5`, `:31` |
| **P3** | **`.env.example` is out of sync** — it omits `CONTENT_AUTOGEN`, `CONTENT_SEED_UPGRADE`, `GOOGLE_CLIENT_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SMTP_*`, `EMAIL_FROM_NAME`, `GIT_SHA` and `TEST_DATABASE_URL`, and lists `ADMIN_EMAILS` and `SUPPORT_EMAIL`, which **no code reads**. Its `APP_URL`/`FRONTEND_URL` still point at the old `tonge-app` host. | `.env.example` |
| **P3** | **`DEPLOYMENT_CHECKLIST.md` is pre-P0 and misleading** — it attributes helmet, CORS, the 100 kb limit and `x-powered-by` to `server.js` (all now in `app.js` after the split), its §10 content pre-generation loop would defeat the content freeze, and `DEPLOY.md:143` shows a `/health` payload that omits the `db` field. Its free/paid table also claims streaks are paid-only; the shipped behaviour is the opposite and `tests/smoke.test.js:216` asserts it. | `DEPLOYMENT_CHECKLIST.md`, `DEPLOY.md:143`, `:158-166` |
| **P3** | **Empty directory trees still tracked**: `app/`, `gradle/`, `cron/` contain **0 files** each. `data/` holds 3 leftover SQLite files that nothing opens. | repo root |
| **P3** | **Three dead deploy configs with three mutually inconsistent commands** are still copied into every Docker image. | `railway.json`, `railway.toml`, `nixpacks.toml` |

### 9.6 Dead code inventory

| Symbol | File | Lines | Evidence |
|---|---|---|---|
| `Row` | `public/index.html` | 2719–2731 | only reference is its own definition |
| `ConjTable` | `public/index.html` | 2732–2756 | only reference is its own definition |
| `VocabCard` | `public/index.html` | 4371–4475 | 3 references: definition, a comment, a `console.error` label |
| `SettingsPanel` | `public/index.html` | 4685–4840 | 2 references: definition + a comment. **Holds the only billing and delete-account callers.** |
| `GrammarScreen` | `public/index.html` | 5755–5802 | only reference is its own definition; view `grammar` renders `<Grammar/>` |
| `OnboardingModal` | `public/index.html` | 6913–7113 | only reference is its own definition |
| `HowToUseModal` | `public/index.html` | 7114–7223 | only reference is its own definition |
| `ShareCardModal` | `public/index.html` | 7707–7838 | only reference is its own definition |
| `DesktopNav` | `public/index.html` | 7957–8065 | only reference is its own definition; superseded by `TopBar` |
| `buildVocabPrompt` | `routes/content.js` | 1143–1164 | `runGeneration` routes vocab to `generateAndStoreVocab`; the `prompts` map has no `vocab` key |
| `requirePaid` | `routes/auth.js` | 672–684 | exported, attached to no route |
| `scripts/prewarm-content.js` | — | 328 | `better-sqlite3` absent; writes the wrong column to the wrong store |
| `railway.json`, `railway.toml`, `nixpacks.toml` | — | 30 | no platform reads them |
| `public/admin-content.html` | — | 482 | unlinked; duplicates the inline admin grid |
| `app/`, `gradle/`, `cron/` | — | 0 files | empty trees |

**Client dead-component total: 9 components, 899 lines** of the 8,621-line file.

---

## Appendix — how this document was verified

Everything below was executed locally against a throwaway Postgres on `127.0.0.1:55432`.
No production system was contacted; no repository file other than this one was modified.

- `git log --oneline -3`, `git status --porcelain` (clean), `git remote -v` — HEAD `b3f6504` on
  `main`, tracking `origin/main`.
- `wc -l` on every server, route, util, test and script file; the client measured separately.
- `grep -n` re-verification of **every** line number cited, against the working tree.
- Full live `information_schema` dump (tables, columns, types, defaults, foreign keys with
  delete rules, unique and primary keys) after running `db.initialize()` on a clean database.
- `node scripts/validate_seed.js` → `68 valid, 16 invalid, 0 missing (of 84)`, with per-file
  reasons.
- `TRUNCATE content_cache` + `seedContent()` → `[Seed] 68 inserted, 0 upgraded, 16 skipped
  (invalid)`; per-tab coverage and per-tab byte sizes measured with SQL.
- Live HTTP probe on an ephemeral port covering `/health`, `/api/version`, `/api/config`,
  `/api/stripe/prices`, unauthenticated 401s, the HTML 404 on API paths, malformed JSON, a
  200 KB body, a rejected `Origin`, `/api/support`, `/faq`, `/learn-french`, `/help`.
- Authenticated probe: signup → decoded the JWT claims → `GET /api/content/{fr/grammar,
  fr/vocab, it/vocab, fr/dialogues, fr/roadmap, xx/vocab, fr/nope}` → `/api/auth/validate` →
  `/api/streaks/log` → `/api/claude` (valid and invalid language).
- `node server.js` boot, capturing the exact log sequence.
- `npm test` under the mandated env prefix → **24 pass, 0 fail, exit 0**.
- Evaluated the five anchor tables plus the `UNIVERSAL_VOCAB_EXTRA` concatenation in isolation,
  printing counts for all 12 languages.
- Walked all 84 seed files: per-tab item counts, per-language vocab word counts, and the full
  set of field names at every depth (**no id-like field exists**).
- Replayed the client's i18n merge in Node → 227 en keys, 225 elsewhere, `nav_learn` and
  `translate_failed` missing from all 11.
- Built the client component index from the file itself (start line + next top-level
  declaration), and counted mount sites by grepping each **bare component name**, not `<Name`.
- Verified that **no** async route or middleware is missing an `asyncHandler` wrapper.
- `git show --stat ae35713 -- seed/` (exactly 8 vocab files) and `git diff b3f6504^ b3f6504 --
  public/index.html | grep -c create-portal` (**0**).

**Not verified, and deliberately so:** anything requiring a `fly` command, a read of the
production database, an Anthropic/Stripe/Resend/Firebase call, `npm install`, `git push`, or a
`docker build` (the Docker daemon is not running here, so the post-P0 image has **never been
built** — risk is low, since only the base tag, `npm ci` and `USER` changed, but it is
unverified). Runtime behaviour of the client was analysed statically, not observed in a browser.
