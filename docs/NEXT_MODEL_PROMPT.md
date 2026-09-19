# Paste this into the next model

You are continuing Tongue in `Crowned090129/tongue`. Work only on this product. Read `AGENTS.md`, then `docs/PROJECT_STATE.md`, then `docs/verification/2026-09-19-mission-and-hardening.md`. `docs/LAUNCH_HANDOFF.md` is now historical context for why the hardening candidate exists; its "unfinished" framing is out of date. ASTRA and architecture documents are background, not proof of behaviour or a requirement to execute.

Branch `codex/tongue-release-readiness` is at `7484370`. **Deployed code is still `88994b5`.** Do not confuse them. The hardening candidate is finished and locally verified (clean install, build, 53/53 tests, 84/84 seeds, runtime audit 9 moderate / 0 high / 0 critical, SIGTERM drain exit 0, browser pass on the production-built client). Reuse that evidence; do not re-run the whole suite to confirm what has not changed.

The first authored mission ("Order a meal and ask for the bill", French) is live on the branch and leads the Learn screen. It checks written answers against authored alternatives, explains near misses, accepts valid variants, and reports an unrecognised sentence as *unchecked* rather than wrong. Preserve that honesty property — it is asserted in tests. Replicate the pattern to a second mission only after the first one is in front of a real learner; more authored missions with no user feedback is guessing at scale.

Three things block deployment, and the first needs the account owner:

1. **Confirm production email actually delivers.** This release stops honouring unverified signup sessions, so those learners must return via email link, Google or access code. Production has `RESEND_API_KEY`, `SMTP_*` and `EMAIL_FROM` set, but nothing was sent and no inbox was checked. Do not send mail to anyone but the owner, and never reintroduce a signup bypass to compensate.
2. **Build the container.** Docker was unavailable locally, so the multi-stage Dockerfile has not been exercised since `49d10cf`. Verify the image boots, serves `/app` from `build/index.html`, and drains on SIGTERM.
3. **Capacity numbers are still missing.** Registered vs active users, peak concurrency, requests and provider calls per session, latency/availability targets, provider budget, backup/restore requirements. Ask for them; do not assume, do not load-test production, and do not describe the app as ready for millions without them.

Also unverified: Stripe (checkout, renewal, cancellation, refund, webhook retry), service-worker registration, Safari/Firefox, screen readers, audio, offline recovery, backup/restore, and whether production content matches the seeds.

Work economically: one model, narrow reads, no subagents unless asked, finish one coherent release before deploying. Be candid about what is verified, what is inferred and what is unknown.
