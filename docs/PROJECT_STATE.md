# Tongue project state — 2026-09-19

Read this first. Historical handoff claims are not current verification.

## Where the code actually is

| | Commit | Notes |
|---|---|---|
| **Deployed** | `6535452` | image `registry.fly.io/tongue-app:deployment-01M2VSGSJD05GF4J8Q4H2JFGYW`, deployed 2026-09-19 02:57 UTC |
| **Branch head** | `6535452` | `codex/tongue-release-readiness` — pushed, CI green |
| Previous image (rollback) | `88994b5` | `registry.fly.io/tongue-app:deployment-01M2VDYVWAMWF0GT16ZGW52P1W` |

Verified in production after the rolling deploy: both machines healthy,
`/api/version` reports the new image, `/app` serves the content-hashed build with
**zero third-party JavaScript** and no browser-side Babel, the restaurant mission
is present in the shipped bundle, and the page renders with **no console errors**.
The Docker multi-stage build was exercised for the first time by Fly's remote
builder as part of this deploy.

**Email delivery is confirmed viable.** Both machines log
`[EMAIL] SMTP transport authenticated — login links can be delivered.` The sender
domain is `gmail.com`, which has SPF, DKIM and DMARC. No message was sent to
anyone to establish this — `verify()` authenticates and disconnects.

Local results behind this release: clean install, build, **57/57 tests**, 84/84
seeds, runtime audit **9 moderate / 0 high / 0 critical**, SIGTERM drain exit 0,
and a full browser pass on the production-built client. See
[the verification record](verification/2026-09-19-mission-and-hardening.md) and
[what is not complete](GAPS.md).

## New constraint found while verifying email

Login links are sent through **Gmail SMTP from a personal `@gmail.com` address**.
Two consequences, neither of which is a bug today and both of which bite later:

1. **Gmail enforces a daily send cap** — on the order of 500 messages/day for a
   free account, ~2,000 for Workspace. Magic-link sign-in is the primary recovery
   path, so the number of people who can log in per day is capped by it. This
   breaks quietly, at exactly the moment growth starts working.
2. Sending account-access links from a personal Gmail address is a trust problem
   and reads as phishing to a careful recipient.

Moving to a dedicated sending domain on Resend (already keyed) would fix both.
That requires SPF/DKIM records on the sending domain — `tongue.app` currently has
**no MX, SPF or DKIM records at all**, which is why Resend cannot be used today.

## Decision and scope

**Guided practice release; not a public-launch sign-off.** Preserve the existing product and learner history. Test whether guided content plus recall practice helps a specific learner before funding the P1–P14 migration or a broad redesign. No validated demand, educational effectiveness, or profitability evidence was available in this session. A request for existing learner/payment evidence remains unanswered.

Working hypothesis: adult English-speaking French beginners preparing for travel may value a small, guided food/travel vocabulary program with measured delayed recall. This is a candidate audience, not a validated market. See [pilot contract](PILOT_CONTRACT.md) for comparisons, thresholds, costs, and stopping rules.

## Repository and access

- Active checkout: `/Users/coronado/Documents/ChatGPT/projects-tongue/tongue`.
- Branch: `codex/tongue-release-readiness`, based on `b237f8d` from `origin/main`.
- Original checkout `/Users/coronado/Downloads/french-app` was clean at the same commit; left untouched.
- GitHub clone, terminal, workspace edits/readback, Node/npm, local PostgreSQL, browser control: verified.
- Local PostgreSQL 14 cluster: parent folder `.local-postgres`, localhost port 55439, role `tongue`. Preview database `tongue_release_test`; final regression database `tongue_final_test`.
- Fly deployment access is verified. Production database content, Stripe account, mail delivery and AI/audio provider operation remain unverified. No production secrets were read or changed. The original checkout's `.env` is documented as production; never load it for tests.
- Historical pre-deployment public checks at 2026-09-18 13:31 UTC: `/health` returned 200 with `db:ok`; `/api/version` returned 404. Consistent with pre-P0 deployment; exact image identity remains unknown.
- Previous commit `d1890f7` pushed to main; GitHub CI succeeded and Fly deployment completed with healthy machines. Current guided-practice changes are documented in `verification/2026-09-18-guided-practice.md`. No external messages, purchases, reset credits, or subagents.

## Current guided-practice change

The core lesson journey now requires study, recall attempts and comparison in short rounds, with retry, review-card saving and completion after the final round. Course entry features conversation scenes and a collapsed catalogue; reference tools point to practice. 39 checks pass; local browser journey verified. See `verification/2026-09-18-guided-practice.md` for exact scope and limits.

## Previously implemented in this branch

1. Bundled content uses its documented compatibility contract; generated content retains enrichment requirements. All 84 files pass. No seed file, array order, learner key, or schema changed. Existing cache rows remain frozen. Corrupt stored content now fails explicitly instead of substituting a different lesson under existing progress.
2. Review and Flashcards share language-filtered `next_review` statistics. Review differentiates due/upcoming and discloses browser-local persistence.
3. Home has one next action based on real due cards; other tools remain in an expandable section. Learn has a calmer next-lesson header and explicit self-reported completion. Logo and brand assets unchanged.
4. Signup immediately opens onboarding; onboarding saves goal/level/language before advancing, shows failures, and opens Learn. Lesson components reset transient state when changing lessons.
5. Settings exposes subscription management with an authenticated request. Server requires `verified: true`, rejects legacy/unverified tokens, and derives customer identity from the signed-in user. Live Stripe success is unverified.
6. Upgrade describes the actual 300-message daily cap; removes fabricated unlimited/analytics benefits. Account/upgrade dialogs have semantics, focus trapping, Escape, and focus restoration. Reduced-motion and focus styles added.
7. Regression suite expanded from 24 to 38 tests. CI workflow added; hosted execution passed for both `d1890f7` and `88994b5`. Reproducible local preview command added.

## Verification

See [verification record](verification/2026-09-18-release.md). Final automated result: **38 pass, 0 fail**, fresh local database; **84 valid, 0 invalid, 0 missing** seeds. No paid providers used; billing success uses a stub.

Browser verified: French lesson opens; 12 words saved; one completion and one review survive reload; due count moves 12 → 11 with 1 upcoming; Spanish deck remains empty; unverified billing gives a specific error; Escape restores settings-button focus; mobile home fits 390px; light/dark controls operate; disabled AI gives an availability message. This is not full accessibility, audio, multi-browser, or provider certification.

## Release blockers and known limits

- **Security:** public-history admin credential exposure reported by prior handoff; rotation on both `tongue-app` and `tonge-app` remains unconfirmed. Do not recover or reuse that value.
- **Identity/data:** signup does not verify email ownership; general `requireAuth` only checks JWT. Suspended/deleted-account enforcement needs correction. Local learner storage is per browser/language, not per account and not synced; shared-device isolation and export/recovery are not solved.
- **Deletion:** existing deletion endpoint swallows Stripe cancellation failures and anonymizes only part of account data. Do not expose it as a complete deletion flow until cancellation, revocation, retention, and transactional behavior are fixed and tested.
- **Billing/recovery:** real checkout, renewal, cancellation, refunds, magic-link delivery and account recovery not exercised. Webhook retry/renewal regression coverage remains incomplete.
- **Content:** passing schemas is not pedagogical or linguistic review. Live content may differ from seeds. Obtain a read-only content snapshot before changing canonical IDs/order. No production backup/restore rehearsal was done.
- **Claims/economics:** existing marketing/onboarding/Coach surfaces still need a complete claims audit. The 300/day AI allowance can exceed $9 revenue; see pilot contract. Do not promote unlimited AI.
- **Delivery:** `d1890f7` deployed successfully; `88994b5` deployed successfully; public `/health` reports database OK and `/app` contains the new guided practice UI. Docker build and remote CI verified for the previous release; load tests, microphone/audio, Safari/Firefox, full keyboard/contrast and offline recovery remain unverified.

## Exact next action

The release is deployed and verified. What matters next, in order:

1. **Put the mission in front of one real learner.** It is the first thing in
   this product that produces a signal — did the feedback help, did they come
   back for the review. Production logs still show effectively no user activity.
2. **Read `ai_usage_logs`.** Real per-message token counts are already recorded
   and have never been looked at. They replace every cost estimate in
   [CAPACITY.md](CAPACITY.md) with a measurement, and should set the allowances.
3. **Set up a sending domain** before growth makes the Gmail cap a real ceiling.
4. **Stripe has never been exercised**, even in test mode. Do that before
   accepting another payment.
5. Backups and a restore rehearsal. There are real accounts and no evidence
   anyone can restore them.

Do not expand the feature set ahead of items 1 and 2.

Historical state is retained in [the September 17 archive](archive/PROJECT_STATE_2026-09-17.md). Other architecture docs describe proposals, not mandatory scope or verified completion.
