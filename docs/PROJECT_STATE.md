# Tongue project state — 2026-09-18

Read this first. Historical handoff claims are not current verification.

## Decision and scope

**Guided practice release; not a public-launch sign-off.** Preserve the existing product and learner history. Test whether guided content plus recall practice helps a specific learner before funding the P1–P14 migration or a broad redesign. No validated demand, educational effectiveness, or profitability evidence was available in this session. A request for existing learner/payment evidence remains unanswered.

Working hypothesis: adult English-speaking French beginners preparing for travel may value a small, guided food/travel vocabulary program with measured delayed recall. This is a candidate audience, not a validated market. See [pilot contract](PILOT_CONTRACT.md) for comparisons, thresholds, costs, and stopping rules.

## Repository and access

- Active checkout: `/Users/coronado/Documents/ChatGPT/projects-tongue/tongue`.
- Branch: `codex/tongue-release-readiness`, based on `b237f8d` from `origin/main`.
- Original checkout `/Users/coronado/Downloads/french-app` was clean at the same commit; left untouched.
- GitHub clone, terminal, workspace edits/readback, Node/npm, local PostgreSQL, browser control: verified.
- Local PostgreSQL 14 cluster: parent folder `.local-postgres`, localhost port 55439, role `tongue`. Preview database `tongue_release_test`; final regression database `tongue_final_test`.
- Production database, Fly account permissions, Stripe account, mail delivery, AI/audio provider operation: **not connected or verified**. No production secrets were read or changed. The original checkout's `.env` is documented as production; never load it for tests.
- Public read-only checks at 2026-09-18 13:31 UTC: `/health` returned 200 with `db:ok`; `/api/version` returned 404. Consistent with pre-P0 deployment; exact image identity remains unknown.
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
7. Regression suite expanded from 24 to 38 tests. CI workflow added; hosted execution has not occurred. Reproducible local preview command added.

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
- **Delivery:** not deployed; Docker image, remote CI, rollback image, load tests, microphone/audio, Safari/Firefox, full keyboard/contrast and offline recovery remain unverified.

## Exact next action

Next complete account/session isolation and safe deletion/recovery tests, then verify email and Stripe in an isolated provider test environment. In parallel, obtain participant access and human review for the bounded pilot. Before production: confirm credential rotation, capture read-only production content/backup evidence, run the release checks, build the image, record a rollback image, and obtain deployment authorization. Do not expand the feature set to avoid these blockers.

Historical state is retained in [the September 17 archive](archive/PROJECT_STATE_2026-09-17.md). Other architecture docs describe proposals, not mandatory scope or verified completion.
