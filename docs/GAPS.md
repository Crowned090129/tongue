# What is not complete — 2026-09-19

An honest inventory, ordered by what would hurt a real user first. Every claim
here is either measured in this session or marked as unverified. This is not the
launch-gate checklist (that is in `LAUNCH_HANDOFF.md`); it is the answer to
"what is actually missing from this product".

---

## 1. Two languages have a mission. Ten do not.

**Partly closed 2026-09-19.** French and Spanish each have an authored
mission. A tester who picks either gets checked answers and real feedback.
A tester who picks any of the other ten still gets the old experience:
study a list, rate yourself, nothing checks the answer.

Authoring more is straightforward — the checker, storage, review hand-off,
tests and translation overlay are all built and proven twice. What is missing
is content, and it needs someone who knows the language well enough to write
the diagnostics. **Do not generate these with AI without review.** The value of
a mission is that a person decided "je veux" sounds demanding to a waiter; a
generated near-miss explanation that is subtly wrong teaches something false,
confidently, to someone with no way to detect it.

The order worth doing next is whichever language your testers actually pick.
That is now measurable — `scripts/health-report.js` reports missions started by
language.

## 2. Teaching copy: interface translated, content partly

**Partly closed 2026-09-19.** The mission interface is translated (English and
Spanish written out, the other ten falling back to English per key, with a test
that fails if the two dictionaries drift or a placeholder is dropped).

A mission can also carry its explanations in another language, and the French
mission has a full Spanish set — so a Spanish speaker learning French reads
"Di que quisieras la sopa de cebolla de entrada" and gets told that "je veux"
suena exigente. The French itself is untouched; only the prose is swapped, and
tests assert the overlay cannot alter an accept list or a diagnose pattern.

Still missing: every other pairing. A Portuguese speaker learning French, or a
French speaker learning Spanish, reads English. The mechanism exists; the
authoring does not.

## 3. Account recovery works, but it has a ceiling

**Resolved 2026-09-19.** Production SMTP authenticates on both machines and the
sender domain (`gmail.com`) has SPF, DKIM and DMARC. Recovery by email link is
viable. This was established without sending a message to anyone.

What remains:

- **Gmail's daily send cap** (~500/day free, ~2,000 Workspace) limits how many
  people can receive a login link per day. It is not a problem at today's usage
  and becomes one the moment growth works.
- Login links come from a **personal `@gmail.com` address**, which reads as
  phishing and cannot be branded.
- Resend is keyed but unusable: `tongue.app` has **no MX, SPF or DKIM records**.
  Setting those up is the fix for both points above.
- Still unproven: that a message lands in an inbox rather than a spam folder.
  The transport authenticating is strong evidence, not proof.

## 4. Learner progress lives in one browser and nowhere else

Completions, saved words, streaks, review schedule, mission progress — all of it
is `localStorage`, now correctly scoped per account. That scoping fixed a leak
between accounts on a shared device. It did **not** make the data durable.

- Clear site data, switch device, or use a private window → everything is gone.
- The UI says so honestly ("stored in this browser"), which is the right
  behaviour for an untrue-to-promise situation, but it is still a product that
  forgets you.
- Server-side progress needs ownership, conflict and migration rules defined
  **before** it is built. Two devices editing the same review deck is a real
  design problem, not a schema problem.

## 5. Money is entirely unexercised

No checkout, renewal, cancellation, refund or webhook retry has ever been run,
even in Stripe test mode. Billing tests use a stub. Account deletion now fails
closed when Stripe cannot confirm cancellation — which is correct, and also
means **deletion will refuse to work if Stripe is misconfigured**, and nobody has
checked whether it is.

Deletion is also still not complete erasure. It anonymises the user row and
cancels subscriptions; it does not audit every table that references a user, and
there is no stated retention policy.

## 6. The unit economics do not work yet

Break-even is roughly **37 AI messages/day** against ~$9/month; the paid cap is
**300/day**. A free user costs roughly $1.20/month and pays nothing. See
`CAPACITY.md` — including the correction that the real per-message token counts
are **already being logged** to `ai_usage_logs` and have simply never been read.

This is the constraint that makes "millions of users" the wrong thing to work on
next. Read the table, then set the allowances.

## 7. Operational blind spots — partly closed

**Closed 2026-09-19:** browser crashes are now reported (message, file, line and
the build hash, so a crash ties to a deploy), capped at five per page load and
carrying no user content. `scripts/health-report.js` reads them back alongside
the mission funnel and the verdict spread per step. Verified end to end: threw
an error in a browser, read it out of the report.

**Still open:**

- **No backup or restore rehearsal.** There is a database with real accounts and
  no evidence anyone can restore it. This is the largest remaining operational
  risk and it is not something code can close — it needs someone to take a
  snapshot, restore it somewhere else, and confirm the data is intact.
- **No alerting.** Crashes are recorded, not pushed. Somebody has to run the
  report to find out.
- **The container builds on deploy** via Fly's remote builder, which has now run
  several times, so that gap is closed in practice.
- Rate limiting is still a database write per limited request.

## 8. Reach and accessibility — partly verified

**Audited 2026-09-19** across the live surface: no interactive element without
an accessible name, no image without alt text, no positive tabindex breaking tab
order, and the mission's feedback announces through `role="status"` with focus
moved to it. One real find, now fixed: the support chat input had a placeholder
and no label, which screen readers announce inconsistently and which vanishes on
the first keystroke.

**Still unverified:** actual screen-reader passes, colour contrast across the
full palette, Safari and Firefox (neither is available on this machine), slow or
offline networks, and audio permissions and failures. The service worker
registers in production and its offline behaviour has never been exercised.

iOS and Android scaffolds exist under `native/`. Neither has been built,
submitted, or tested against the current web build.

## 9. There is no evidence anyone wants this

Production logs show **no authentication activity at all** since the last deploy.
No validated demand, no retention data, no evidence the teaching works.

The mission is the first thing in this product worth putting in front of a real
learner, because it is the first thing that produces a signal: did they get the
answer right, did the feedback help, did they come back for the review. That
signal is worth more than the next ten features.

---

## What is genuinely finished

So the list above is read in proportion:

- Authentication, session revocation, account separation and honest failure
  messaging — verified against a running server and in a browser.
- The mission end-to-end, including resume across reload and hand-off into
  spaced review.
- The production build: content-hashed assets, no third-party JavaScript, no
  browser-side JSX compilation.
- Graceful shutdown, health draining, request timeouts.
- 53 automated tests, 84/84 content seeds, a clean install from the lockfile, and
  a runtime dependency audit with zero high or critical findings.
