# Guided practice release — September 18, 2026

Problem: lessons were reference lists with a manual completion button. They gave no required attempt, feedback loop, or clear next action.

Changed: vocabulary, grammar and dialogue lessons now use rounds of at most five paired examples: study/listen → produce from memory → compare → self-rate → retry/save/continue. Finish is available only after the final round. No automatic proficiency, pronunciation or free-writing assessment is claimed. Grammar's legacy combined translations remain paired with both source examples. Dialogue shows scene/preceding line and speaker. Full reference remains available in a disclosure. Course entry highlights three conversation scenes and collapses the full catalogue. Reference tools link back to guided practice.

Verification: 39 automated checks pass, including complete 12-item progression through three rounds, no early completion, language-specific card saving, source pairing, full JSX compilation and existing API regressions. Local browser verified study → typed recall → reveal → difficult/easy ratings → summary → save five cards → next round; reload retained saved cards. Redesigned course loaded and restaurant scene opened correctly. Screenshot inspected at the existing narrow viewport. No paid provider calls. Audio provider success, every locale, and full accessibility remain unverified.

Limits: self-assessment, not an automatic language tutor. Mid-lesson round state resets on exit/reload; completed lessons and saved cards retain the existing browser persistence. Existing per-browser rather than per-account storage remains a known issue. This release changes the core course and tool guidance, not every historical screen's design. Canonical content, IDs and ordering are unchanged.
