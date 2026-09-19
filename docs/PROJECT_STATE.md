# Tongue project state — 2026-09-19

Read this first. Historical handoff claims are not current verification.

## Where the code actually is

| | Commit | Notes |
|---|---|---|
| **Deployed** | `88994b5` | image `registry.fly.io/tongue-app:deployment-01M2VDYVWAMWF0GT16ZGW52P1W` |
| **Branch head** | `7484370` | `codex/tongue-release-readiness` — **not deployed** |

The `49d10cf` hardening candidate is now **finished and locally verified**, and a
first authored mission ships on top of it. See
[the verification record](verification/2026-09-19-mission-and-hardening.md) for
commands, results and the explicit not-verified list.

Local results: clean install, build, **53/53 tests**, **84/84 seeds**, runtime
audit **9 moderate / 0 high / 0 critical**, SIGTERM drain exit 0, and a browser
pass on the production-built client. Container build is still unexercised
(no Docker on this machine); real email, Stripe and load behaviour remain
untested.

## What a learner can do now that they could not before

One mission — **"Order a meal and ask for the bill"** (French) — leads the Learn
screen ahead of the lesson catalogue. It states a concrete outcome, teaches five
phrases with the reason each matters, then asks the learner to write what they
would say in five situations. Each answer is checked against authored
alternatives and the learner is told what it would communicate: "je veux" reads
as demanding to a waiter, "carafe" is feminine, "la facture" is an invoice rather
than a restaurant bill. Valid alternatives and accent-free spelling are accepted.
**An answer matching nothing authored is reported as unchecked, never as wrong.**
No pronunciation or proficiency scoring. Finishing saves the five phrases into
the existing SM-2 review deck, so they return on a schedule.

This is one mission in one language. It is a template, not a finished curriculum.

## Deploying this changes who stays signed in

The deployed build issues a session to anyone who submits an **existing** address
at signup. That is a live account-takeover path: knowing an address is enough to
get a session for it. This branch closes it (`409`), and stops honouring the
unverified tokens it already handed out.

Consequence: everyone holding an unverified signup session is signed out on their
next visit and must return via email link, Google or access code. The sign-in
screen now explains this and confirms their saved work is intact. **Verify that
production email actually delivers before deploying**, or those learners have no
way back. Do not reintroduce a signup bypass to work around broken email.

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

1. Confirm production email delivery in an authorised way (founder's own inbox),
   because the sign-out above depends on it. This needs the account owner.
2. Get answers to the capacity questions still unanswered: registered vs active
   users, expected peak concurrency, provider budget, latency/availability
   targets, backup and restore requirements. "Ready for millions" cannot be
   assessed, let alone claimed, without them.
3. Build the container somewhere Docker exists and verify the image boots,
   serves `/app` from `build/index.html`, and drains on SIGTERM.
4. Then one reviewed deployment: capture the previous image, confirm hosted CI,
   check rolling health, `/api/version`, the served asset list, and one
   authenticated journey.

Do not expand the feature set to avoid these gates.

Historical state is retained in [the September 17 archive](archive/PROJECT_STATE_2026-09-17.md). Other architecture docs describe proposals, not mandatory scope or verified completion.
