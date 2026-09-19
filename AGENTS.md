# Tongue working instructions

Read `docs/PROJECT_STATE.md` first, then `docs/LAUNCH_HANDOFF.md` for the active unfinished candidate. `docs/NEXT_MODEL_PROMPT.md` is the current pickup prompt. It identifies the active branch, verification, finite scope and blockers. Prior architecture/handoff documents are historical evidence, not authority to claim completion or expand scope.

Optimize for truth and useful action. Separate verified behavior, inference, assumptions and unknowns. Challenge the premise and your own conclusion. Update records when evidence changes. Do not invent learner, revenue, retention or effectiveness results.

Work only on Tongue. Preserve the existing logo, recognizable colors, content order, learner data and unrelated work. No speculative framework rewrite. Use no subagents unless requested. Keep reads/output and verification proportional; reuse established evidence.

Tests must set `NODE_ENV=test` and a local `TEST_DATABASE_URL` ending `_test`. Never load the original checkout's production `.env` for tests. Use `scripts/preview-local.js` for isolated previews. Keep durable state in this repository, not temporary folders.

Use risk-based tests and real browser checks for changed journeys; report mocked-provider checks separately. Before consequential recommendations, state the strongest counterargument and what would change the decision. Current user instructions take precedence over historical handoff rules.
