# Verification record — 2026-09-19 — restaurant mission + hardening candidate

Commits `0063170` and `7484370` on `codex/tongue-release-readiness`, based on the
unfinished candidate `49d10cf`. Every result below was produced in this session
against an isolated local PostgreSQL 14 cluster (`127.0.0.1:55439`) and a
test-only JWT secret. The production `.env` was never loaded.

## Commands and results

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | 536 packages, clean install from lockfile |
| `npm run build` | vendors React/ReactDOM/lucide, emits hashed `app.<hash>.js`, fails if any `unpkg.com` reference survives |
| `NODE_ENV=test TEST_DATABASE_URL=…/tongue_final_test JWT_SECRET=local-test npm test` | **53 pass, 0 fail** (was 46) |
| `npm run validate:seed` | **84 valid, 0 invalid, 0 missing** |
| `npm audit --omit=dev` | **9 moderate, 0 high, 0 critical** |
| `SIGTERM` to `node server.js` | logged `SIGTERM: draining active requests`, **exit code 0** |

### Dependency audit — what the 9 findings actually are

All nine trace to one advisory: `uuid <11.1.1`
([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)),
a missing buffer bounds check in uuid **v3/v5/v6 when the caller supplies `buf`**.
It is reachable only through `node-cron` (which uses v4 for task ids) and the
optional `firebase-admin` tree. Tongue never calls uuid with a `buf`. The fix is
a `firebase-admin` major upgrade; it was **not** applied. This is a low-exposure
known issue, not a cleared one.

The earlier handoff's "3 high, 1 critical" came from the all-dependency output,
which includes the Capacitor/native build tooling. The runtime-only number above
is the one that describes the deployed image.

## Browser verification (local, built client, Chromium in the Claude browser pane)

Served from `PORT=3003 SERVE_BUILT_CLIENT=on npm run preview:local`, i.e. the
**production-built** page, not the raw JSX page.

- `/app` serves `build/index.html`; zero `babel/standalone` references.
- Network shows **no third-party JavaScript** — only a Google Fonts stylesheet.
- Restaurant mission end to end: brief → 5 checked steps → completion → 5 cards
  saved → Flashcards reports "5 cards due now · spaced repetition (SM-2)" → Home
  leads with "5 saved words are ready to review".
- Mission draft resumed after a full page reload (stage, step and text restored).
- Lesson draft resumed after a full page reload.
- Completion removes the saved attempt; Learn switches to "Practise it again".
- Account separation: a second account on the same browser now gets its own
  onboarding and does not inherit the previous learner's level or language.
- Revoked legacy session lands on a usable sign-in screen **with an explanation**.
- 390 px: no horizontal overflow (`scrollWidth === innerWidth === 390`).

## Server behaviour verified against a running instance

| Case | Result |
|---|---|
| Signup with an existing address | `409 sign_in_required` — no session issued |
| Magic link with no mail transport | `503 email_unavailable`, unsent link deleted |
| Legacy token with no `verified` claim | `401 sign_in_required` |
| `/health` while draining | `503`; new connections refused once the listener closes |

## Automated coverage added

Seven tests around mission checking, including the honesty property: an
unrecognised but plausible sentence must be reported as *unchecked*, never as an
error. Every authored step is asserted to accept its own model answer and each
listed alternative, so authoring drift fails the build rather than teaching
wrong French.

## Not verified — do not describe these as done

- **Container build.** Docker is not available on this machine. The multi-stage
  Dockerfile and its `npm run build` step are unexercised since `49d10cf`.
- **Real email delivery.** Production has `RESEND_API_KEY`, `SMTP_*` and
  `EMAIL_FROM` set, but no message was sent and no inbox was checked.
- **Stripe.** No checkout, renewal, cancellation or refund was exercised. Billing
  tests use a stub.
- **Service worker registration** fails in the browser pane; `sw.js` itself is
  served correctly (200, `application/javascript`). Unverified, not known broken.
- Load behaviour, Safari/Firefox, screen readers, audio, offline recovery,
  backup/restore, and production content parity.

## Known limitation in mission checking

Acceptance is substring containment over a normalised answer. A sentence that
contains an authored phrase passes even if it also contains clumsy wording.
Precise diagnostics (register, gender, English words) are still surfaced on
accepted answers to compensate, but broad catch-all rules are not. This favours
accepting valid alternatives over catching every flaw, which is the intended
trade for a beginner mission.
