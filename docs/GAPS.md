# What is not complete — 2026-09-19

An honest inventory, ordered by what would hurt a real user first. Every claim
here is either measured in this session or marked as unverified. This is not the
launch-gate checklist (that is in `LAUNCH_HANDOFF.md`); it is the answer to
"what is actually missing from this product".

---

## 1. The teaching experience is one mission deep

**The single biggest gap.** There is exactly one authored mission — "Order a meal
and ask for the bill" — and it exists only in French.

- The other **11 languages** get the old experience: study a list, type from
  memory, rate yourself. Nothing checks the answer, so nothing tells the learner
  what they got wrong or why.
- Even in French, one mission covers one situation. There is no second mission,
  no ordering between missions, and no sense of a path through them.
- The rest of the French course is still **44 lessons of word lists** with
  self-rated recall. The mission sits on top of that; it does not replace it.

The mission is a proven template, not a curriculum. Authoring more of them is
straightforward work — the checker, the storage, the review hand-off and the
tests are all built and verified. What is missing is the authored content, and
that needs a human who knows the language well enough to write the diagnostics.

**Do not scale this by generating missions with AI without linguistic review.**
The whole value of the mission is that a human decided "je veux" sounds
demanding to a waiter. A generated near-miss explanation that is subtly wrong
teaches the learner something false, confidently.

## 2. Teaching copy is English-only

The interface chrome is translated — 203 `t()` call sites across 12 locales. The
**instructional copy is not.** Lesson framing, the mission brief, every piece of
feedback and every button inside the learning flow is hardcoded English.

A Spanish speaker learning French gets Spanish menus and English teaching. That
is the single largest thing standing between this and being a product for
non-English speakers, and the mission added to the problem rather than reducing
it.

## 3. Nobody can be sure a returning learner gets back in

- Signup no longer issues a session for an existing address (fixed this release).
  Recovery therefore depends entirely on **email link, Google, or access code**.
- **Production email delivery has never been confirmed.** `RESEND_API_KEY`,
  `SMTP_*` and `EMAIL_FROM` are all set, but no message has been sent and no
  inbox checked. `tongue.app` has **no SPF, no MX and no Resend DKIM record**,
  so if mail works it is via SMTP, not Resend.
- Until someone sends one real message and watches it arrive, account recovery
  is an assumption.

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

## 7. Operational blind spots

- **The container has not been built since `49d10cf`.** Docker is unavailable on
  the development machine. The multi-stage Dockerfile, its build step and the
  vendored-asset copy are unexercised. A Fly deploy would be the first real test.
- **No monitoring, no alerting, no error tracking.** A 500 in production is
  discovered by a user, not by the team.
- **No backup or restore rehearsal.** There is a database with real accounts in
  it and no evidence anyone can restore it.
- **No rollback runbook**, though the previous image ID is recorded.
- Rate limiting is a **database write per limited request**, which is the first
  thing that will break under load.

## 8. Reach and accessibility

- Verified: keyboard focus handling in the mission, `role="status"` feedback,
  390px layout with no overflow, reduced-motion and focus styles.
- **Not verified:** screen readers, colour contrast across the full palette,
  Safari and Firefox, slow or offline networks, audio permissions and failures.
- The service worker registers but its registration failed in the test browser;
  `sw.js` itself serves correctly. Offline behaviour is unknown, not broken.
- iOS and Android scaffolds exist under `native/`. Neither has been built,
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
