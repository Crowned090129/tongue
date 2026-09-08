# Tongue — curated seed content authoring spec

You are authoring **real, accurate, curated language-learning reference content** for the Tongue app.
This is shipped content that real learners depend on — it must be **factually and grammatically correct**.
Write one file per tab at `seed/content/<lang>/<tab>.json`. Each file contains ONLY the JSON object for that tab (no wrapper, no markdown).

## Which topics to cover
Open `routes/content.js` and find your language's curated topic lists:
- `GRAMMAR_TOPICS["<lang>"]`  → cover **every** topic, in order → `grammar.json`
- `CHEATSHEET_GROUPS["<lang>"]` → one category per group → `cheatsheet.json`
- `STRUCTURE_TOPICS["<lang>"]` → one structure per topic, in order → `structures.json`
- `VOCAB_CATEGORIES["<lang>"]` → one category per entry, in order → `vocab.json`
- `DIALOGUE_SCENARIOS["<lang>"]` → one dialogue per scene, in order → `dialogues.json`
- `drills.json` and `roadmap.json` have no list — see counts below.

If a list is missing for your language, fall back to the `fr` (French) list of the same name for coverage, adapted to your language.

## Exact JSON schemas (match field names EXACTLY)

**grammar.json** — one section per GRAMMAR_TOPICS entry (aim for all of them; **minimum 20**):
```json
{"sections":[{"title":"3–5 word name","level":"Beginner|Intermediate|Advanced","rule":"2–3 sentences stating the ACTUAL rule/pattern/formula","example_target":"a natural, correct sentence in the target language","example_target_2":"a second shorter correct sentence","example_ref":"English: [translation of ex1] / [translation of ex2]","note":"the #1 tip, common mistake, or nuance"}]}
```
Label the first third Beginner, middle third Intermediate, last third Advanced.

**cheatsheet.json** — one category per CHEATSHEET_GROUPS entry (**minimum 10**), each with **8–12 items**:
```json
{"categories":[{"name":"Category Name","items":[{"target":"word/phrase in target language","ref":"English meaning","note":"pronunciation, gender, or usage note"}]}]}
```

**structures.json** — one per STRUCTURE_TOPICS entry (**minimum 12**):
```json
{"structures":[{"pattern":"Subject + Verb + Object (a memorable formula)","title":"what it expresses (5–8 words)","explanation":"2–3 sentences: how it works + when to use + word-order rule","ex1_target":"example in target language","ex1_ref":"English translation","ex2_target":"a DIFFERENT example in target language","ex2_ref":"English translation"}]}
```

**vocab.json** — one category per VOCAB_CATEGORIES entry (**minimum 12**), each with **8–12 words**:
```json
{"categories":[{"name":"Category Name (target + English)","words":[{"t":"word in target language","p":"pronunciation guide","r":"English meaning"}]}]}
```

**dialogues.json** — one per DIALOGUE_SCENARIOS entry (**minimum 6**), each **8–12 lines**, 2 speakers alternating:
```json
{"dialogues":[{"title":"scene title","scene":"one-sentence context","level":"Beginner|Intermediate|Advanced","lines":[{"speaker":"name/role","target":"line in target language","ref":"English translation"}],"vocab":["key word (English meaning)","..."],"note":"a genuine cultural insight"}]}
```
`vocab` array: 4–6 items. Label earliest dialogues Beginner, last ones Advanced.

**drills.json** — exactly **20 drills**, mixed: 6 verb conjugations, 5 vocabulary, 4 grammar forms (gender/articles/cases/particles as relevant), 2 numbers/time, 3 everyday phrases:
```json
{"drills":[{"q":"a short English question asking for a target-language answer, e.g. \"'I am' in French?\"","a":"the correct target-language answer only","hint":"a rule, pattern, or memory tip","type":"Conjugation|Vocab|Grammar|Numbers|Phrase"}]}
```

**roadmap.json** — exactly **5 phases**, each `can` array has **6** items:
```json
{"phases":[{"phase":1,"title":"Survival","dur":"Weeks 1–2","goal":"one-sentence goal","can":["6 concrete milestones naming REAL grammar features/tenses/scripts of THIS language"],"daily":"a concrete daily plan with minutes per activity"}]}
```
Phases in order: 1 Survival (Weeks 1–2), 2 Foundation (Weeks 3–6), 3 Core Structures (Months 2–3), 4 Fluency (Months 3–6), 5 Mastery (Months 6+). Adjust durations to the language's real difficulty.

## Accuracy rules (violations are unacceptable)
- Every target-language string must be **grammatically correct** with correct spelling, accents, and diacritics. Double-check every form.
- English (`ref`, `example_ref`, `r`) must be an accurate translation.
- **Non-Latin scripts are REQUIRED in the target fields** (never romanization-only) for: zh (Hanzi), ja (kana/kanji), ko (Hangul), ru (Cyrillic), ar (Arabic script), hi (Devanagari). Put romanization in the `note`/`p`/`hint` field instead.
  - zh: pinyin with tone marks in `p`/`note`. ja: romaji. ko: revised romanization. ru: English phonetics with stressed syllable CAPS. ar: transliteration. hi: keep Devanagari in `t`/`target`/`a`.
- Numbers must be exactly correct — verify every digit.
- Notes/hints must add real value (a rule or memory aid), not restate the answer.

## Output
Write all 7 files for your language to `seed/content/<lang>/`. Each file is valid JSON (double-quoted strings, no trailing commas, no comments). Do not include any text outside the JSON in the files.
After writing, verify each file parses as JSON.
