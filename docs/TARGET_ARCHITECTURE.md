# Tongue: Target Architecture

**Date:** 2026-09-14
**Status:** proposal, for owner review
**Based on:** [ARCHITECTURE_FORENSICS.md](./ARCHITECTURE_FORENSICS.md). Finding IDs (S1, B4, P1, D3, L2 …) refer to that document.
**Delivery sequence:** [MIGRATION_PLAN.md](./MIGRATION_PLAN.md)

---

## 0. Principles and non-goals

**Principles**

1. **One Tongue.** Every language runs through the same systems. A language supplies data: a LanguagePack, content, a curriculum and annotations. Language-specific code is allowed only inside a *capability module* that implements a real linguistic feature (tones, furigana, RTL, case tables). It is never allowed as a per-language screen or branch (`if (lang === "fr")` is a lint error outside capability modules).
2. **Truthful by construction.**
   - No fabricated content, progress, levels or statistics.
   - Every number shown to the learner comes from recorded events.
   - AI output is labelled as AI, cached, optional, and never the only way to learn.
   - When infrastructure is missing, the UI says so.
3. **Content describes, engines render.** Lessons are data (typed blocks). Renderers own interaction. Evaluation is a pure function.
4. **Server is the source of truth for the learner.** The client keeps a cache and an outbox. Web, iOS and Android read the same learner model.
5. **Additive, reversible delivery.** Every persisted-schema change is a versioned, documented, additive migration. Legacy data is kept in raw form until the owner explicitly approves cleanup.
6. **Keep the brand.**
   - Keep: Tongue logo, crimson/pink primary, warm cream neutrals, Fraunces + Instrument Sans, subtle borders, rounded surfaces, audio affordances, sentence breakdown, common-mistake insight.
   - Rule out: dark-SaaS, gradients-everywhere, glassmorphism, card-wall dashboards.

**Non-goals for this redesign**

- A new visual identity.
- New languages.
- Runtime AI-generated curriculum.
- CEFR certification claims. Levels stay "Foundations / Beginner / Intermediate / Advanced" until content is audited against CEFR descriptors.

---

## 1. System map: Tongue Core

| System | Responsibility | Owns (data) | Replaces today |
|---|---|---|---|
| **Language Registry** | LanguagePacks, capabilities, locales, SEO metadata | `shared/languages/*.json` | ~15 registries (D1), `LANGS_DATA` identity fields, `SCRIPT_CHECK`, `LANG_NOTES`, `LANG_SEO` |
| **Content Service** | Versioned reference content with stable item IDs, validation, provenance, drafts | `content/<lang>/<tab>.json`, `content_cache` (derived), `content_snapshots`, `content_drafts` | blob-per-tab with no IDs (P1), request-path generation (S6), regeneration loop (§2.3) |
| **Curriculum Engine** | Course → stage → unit → lesson graph, outcomes, locking, placement | `curriculum/<lang>.json` | `buildUnits` (5918-5935), unlinked roadmap |
| **Lesson Engine** | Block schema, lesson composition, renderer registry, session runner, evaluation, feedback, completion | `lessons/<lang>/*.json` (compiled), `annotations/<lang>/*.json` | `LessonView` + two completion buttons (P4, L8) |
| **Practice Engine** | Session builder for review, drills, pronunciation, mistakes | uses learner projections | ReviewScreen (L1), Drills reveal-only, TodaysPractice table |
| **Review / SRS Engine** | One SM-2 implementation, server-authoritative card state | `srs_cards`, `review_items` | 3 SM-2 copies (D3), 3 stores (D4) |
| **Vocabulary Engine** | User vocabulary state (saved / known / ignored), lemma keys, gloss sources | `user_vocabulary` | `ws_saved` (L6), "Add all" only |
| **Grammar Engine** | Grammar concepts (content items), concept ↔ exercise ↔ mistake links, inflection tables via capabilities | content + annotations | duplicate grammar renderers (D8) |
| **Sentence Breakdown** | Segmentation, token resolution (lexicon → content index → cached AI), token actions | `lexicon/<lang>.json`, `ai_result_cache` | 3 breakdown schemas (D6), unbounded `bd_*` cache |
| **Analysis** | Analyze workspace: documents, segmentation, extraction, practise-from-text | `saved_analyses` | TextAnalyzer + WordSpace (D5, D6) |
| **Coach** | Server-defined AI features with typed I/O, context assembly, AI gateway, error contract, availability | `ai_usage_logs`, `ai_result_cache` | generic `/api/claude` proxy (B10), per-screen error copy (L2, L3, L16) |
| **Speech / Pronunciation** | `speak()`, per-language voice preference, recognition wrapper, transcript comparison | user prefs | `say()` + Conversation `speak()` (D13), `VoicePanel` global |
| **Learner Model** | Event log + projections; import of legacy data | `learning_events` + projections (§10) | ~9 `localStorage` stores (P3, L7), write-only streak |
| **Progress & Planner** | Today's next action, streaks, journey position, honest estimates | derived | `ExploreHome` tiles, `tongue_last`, weekday schedule |
| **Entitlements** | What each plan includes (single definition), quota classes | `entitlements` *(decision-gated)* | codes-as-entitlement (B5), hand-written plan copy (L10) |
| **Application Shell** | Routing, layout, navigation, tokens, primitives, a11y, i18n, toasts, dialogs, error boundaries | `web/src/app`, `web/src/ui` | conditional router, 4 header systems, hand-rolled overlays (§7) |

Code boundary: **pure domain logic lives in `shared/`** (types, Zod schemas, SM-2, evaluation, normalization, planner, segmentation rules, derivation rules). It runs identically on the server, in web tests and as golden vectors for native. UI lives in `web/`. Persistence and AI calls live in the server.

---

## 2. Language Registry and LanguagePack

### 2.1 Schema (`shared/languages/schema.ts`, runtime-validated with Zod)

```ts
export type LanguageCode = "fr"|"es"|"en"|"pt"|"it"|"de"|"zh"|"ja"|"ko"|"ru"|"ar"|"hi";
export type ScriptId = "latin"|"hanzi-simplified"|"hiragana"|"katakana"|"kanji"|"hangul"|"cyrillic"|"arabic"|"devanagari";

export interface LanguagePack {
  code: LanguageCode;                       // content key (same as today's VALID_LANGS)
  status: "active" | "beta" | "hidden";
  names: { en: string; native: string };    // UI-localized names come from i18n: lang.<code>.name
  slug: string;                             // "french" → /learn-french SEO page
  flagEmoji: string;                        // presentation only; never a data key
  variant?: { id: string; label: string; note: string };   // e.g. pt → "pt-BR"; ar → "MSA"
  direction: "ltr" | "rtl";
  scripts: ScriptId[];
  scriptRules?: {                           // replaces SCRIPT_CHECK (content.js:42-49) + SCHEMA.md:61-62
    requiredInFields: string[];             // e.g. ["target","t","a","example_target","ex1_target"]
    unicodeRanges: string[];                // validator regex source, one place
  };
  romanization?: { scheme: RomanizationScheme; field: "p" | "note" | "hint" };
  segmentation: { strategy: "whitespace" | "whitespace+clitics" | "intl-segmenter"; clitics?: string[] };
  cjkGlyphLang?: "zh-Hans" | "ja" | "ko";   // sets lang="" on target text so glyphs render correctly
  speech: { ttsLocale: string; sttLocale: string; defaultRate: number; voiceTestPhrase: string };
  capabilities: Capability[];
  themeAccentKey: string;                   // from today's LANG_THEME (index.html:422)
  seo: { speakers: { value: string; source: string } };  // one value; fixes 310M vs 300M drift
  content: { tabs: TabId[]; glossLanguage: "en"; curriculumId: string };
  uiLocaleAvailable: boolean;               // UI dictionary exists (all 12 today)
}

export type RomanizationScheme =
  | "pinyin-tone-marks" | "hepburn-romaji" | "revised-romanization"
  | "english-phonetic-stress-caps" | "arabic-transliteration" | "hindi-transliteration" | "none";
```

### 2.2 Capabilities: declared, rendered, exercised

```ts
export type Capability = CapabilityBody & { support: "declared" | "rendered" | "exercised" };
type CapabilityBody =
  | { id: "grammaticalGender"; genders: ("masculine"|"feminine"|"neuter")[]; markedBy: "article"|"agreement"|"both" }
  | { id: "grammaticalCases"; cases: string[] }
  | { id: "verbConjugation"; persons: string[] }
  | { id: "verbAspect"; aspects: string[] }
  | { id: "formalAddress"; pairs: { informal: string; formal: string }[] }
  | { id: "politenessLevels"; levels: string[] }
  | { id: "particles" }
  | { id: "tones"; count: number; neutralTone: boolean; notation: "diacritics" }
  | { id: "measureWords" }
  | { id: "kanaScripts" } | { id: "kanji" } | { id: "furigana" }
  | { id: "elisionLiaison" }
  | { id: "separableVerbs" } | { id: "nounCapitalization" }
  | { id: "rootPatternMorphology" } | { id: "dualNumber" } | { id: "vowelDiacritics"; optional: true }
  | { id: "diglossia"; standard: string }
  | { id: "ergativeMarking"; marker: string }
  | { id: "postpositions" };
```

`support` keeps the registry truthful:

- `declared`: the linguistic fact is recorded, but no UI or exercise uses it yet.
- `rendered`: a shared system displays it (for example, gender tags on vocabulary).
- `exercised`: at least one derivation rule produces exercises for it.

Admin pages and the docs show this matrix, so no capability is implied to exist before it does.

### 2.3 Capability matrix (initial declarations; all start as `declared` unless noted)

| Lang | Scripts / dir | Romanization | Capabilities (linguistically legitimate) |
|---|---|---|---|
| fr | latin / ltr | none | grammaticalGender (m/f, article+agreement), verbConjugation, formalAddress (tu/vous), elisionLiaison |
| es | latin / ltr | none | grammaticalGender, verbConjugation, formalAddress (tú/usted) |
| pt | latin / ltr, variant pt-BR | none | grammaticalGender, verbConjugation, formalAddress (você/o senhor) |
| it | latin / ltr | none | grammaticalGender, verbConjugation, formalAddress (tu/Lei), elisionLiaison |
| de | latin / ltr | none | grammaticalGender (m/f/n), grammaticalCases (Nom/Akk/Dat/Gen), verbConjugation, separableVerbs, nounCapitalization, formalAddress (du/Sie) |
| en | latin / ltr | none | verbConjugation (limited persons) |
| zh | hanzi-simplified / ltr, cjkGlyphLang zh-Hans, intl-segmenter | pinyin-tone-marks | tones (4 + neutral), measureWords |
| ja | hiragana+katakana+kanji / ltr, cjkGlyphLang ja, intl-segmenter | hepburn-romaji | kanaScripts, kanji, furigana, particles, politenessLevels (plain/polite/honorific), verbConjugation |
| ko | hangul / ltr | revised-romanization | particles, politenessLevels (speech levels), verbConjugation |
| ru | cyrillic / ltr | english-phonetic-stress-caps | grammaticalGender (m/f/n), grammaticalCases (6), verbAspect (perfective/imperfective), verbConjugation |
| ar | arabic / **rtl**, variant MSA | arabic-transliteration | grammaticalGender (m/f), dualNumber, rootPatternMorphology, vowelDiacritics, diglossia (MSA) |
| hi | devanagari / ltr | hindi-transliteration | grammaticalGender (m/f), postpositions, ergativeMarking (ने), formalAddress (तू/तुम/आप), verbConjugation |

### 2.4 How capabilities extend shared systems (never fork them)

| Capability | System extended | Extension |
|---|---|---|
| `direction: rtl` | Shell | `<html dir>` for the UI locale; `dir="auto"`/`dir="rtl"` on target-language text; mirrored icons via logical CSS properties |
| `cjkGlyphLang` | Text primitives | `<TargetText lang=…>` sets the `lang` attribute |
| `segmentation` | Sentence Breakdown | chooses whitespace / clitic split / `Intl.Segmenter` |
| `romanization` | Vocabulary, Breakdown, Lesson blocks | shows `p` in secondary text with a scheme label; toggle in settings |
| `furigana` | Text primitives | `<ruby>` rendering when annotation supplies readings |
| `tones` | Pronunciation, Vocabulary | tone-mark display; PronunciationExercise variant "hear and pick the tone" (only where content carries pinyin) |
| `grammaticalGender` | Vocabulary, Lesson Engine | gender tag and article display; `MultipleChoice` derivation "choose the article" (only where content encodes the article in `t`) |
| `verbConjugation` / `grammaticalCases` | Grammar Engine | `ConjugationPatternBlock` (an inflection table) enabled; tables come from annotations with source guard (§5.6) |
| `formalAddress` / `politenessLevels` | Coach, Conversation | register instruction added to server prompts; Culture insight tags |
| `scriptRules` | Content Service validator | one regex source for validation and prompts |
| `speech` | Speech Service | TTS/STT locale; voice test phrase (fixes missing Hindi phrase, D13) |

### 2.5 Delivery and consumers

- **Source of truth.** `shared/languages/<code>.json`, validated at build time. It is **served** at `GET /api/languages` (public, `Cache-Control: max-age=3600`, ETag) for web and native.
- **Server consumers:** content validation and prompts, AI gateway prompt notes (replacing `claude.js:13-20`), SEO page generation (replacing `app.js:87-100`), admin grid (replacing `admin.js:535-537`), support prompt facts, email copy counts ("12 languages" computed, not typed).
- **Web consumers:** language switcher, settings native-language picker (all `uiLocaleAvailable` languages, fixing the 8-of-12 problem), theme accent, speech, text primitives.
- **Native consumers:** replace `Language.swift` / `Language.kt` static lists. A bundled fallback copy of the JSON is kept and refreshed from the API.
- **Unknown codes.** `getLanguage(code)` throws a typed `UnknownLanguageError`. The router redirects to the user's valid target language or to onboarding. **No silent French fallback** (fixes §2.1(3)).

---

## 3. Content model and identity

### 3.1 Canonical content and stable IDs

- Canonical reviewed content lives in the repository at `content/<lang>/<tab>.json`. It is produced once from the **owner-approved canonical source** (decision gate G1 in the migration plan: production `content_cache` snapshot vs repo seeds), then reviewed.
- **Every addressable item gets an immutable ID**: `"<lang>.<tab>.<slug>"`, for example `fr.grammar.present-er-etre-avoir`, `fr.vocab.numbers`, `fr.vocab.numbers.cinq`, `fr.drills.i-am`, `fr.cheatsheet.faux-amis.avoir-faim`. IDs are assigned by a deterministic script and committed. Human edits keep them.
- **CI guard (`validate:content`):**
  - IDs are unique.
  - An ID that existed in the previous committed version cannot disappear unless a `redirects` entry maps it.
  - Schema validation passes.
  - Script rules come from the LanguagePack.
- `contentVersion` = SHA-256 of the canonical file. Learner records store the version they were produced against.

### 3.2 Versioned schema

- **`schemaVersion: 1`** is today's `SCHEMA.md` shape. It stays valid, so the seed/validator mismatch (P2) is resolved by versioning, not by forcing regeneration.
- **`schemaVersion: 2`** adds the optional fields `id`, `examples[]`, `common_mistake`, `level` on vocabulary/structures/drills, and `sources[]` for provenance.
- The validator validates each file against its declared version. There is one schema definition (Zod) from which `SCHEMA.md`, generation prompts and the validator are all derived, replacing the three disagreeing descriptions.

### 3.3 Runtime role of the database and AI

- `content_cache` becomes a **derived cache** of canonical content: loaded at deploy by `release_command`, with additive `content_version` and `source` columns.
- **AI generation never writes to `content_cache` automatically.** It writes to `content_drafts` (admin review, diff view, approve → commit via PR). The 6-hourly `generateMissingContent` loop is removed. It is frozen first, behind `CONTENT_AUTOGEN=off`, in migration P0.
- Before any content change reaches production, a `content_snapshots` row (lang, tab, json, reason, taken_at) is written.
- The content API adds `ETag = contentVersion` and `Cache-Control: private, max-age=300, stale-while-revalidate=86400` (fixes L15).

### 3.4 Gloss language (honest scope)

- Reference glosses are English today (P13). The content metadata declares `glossLanguage: "en"`, and the UI says "Meanings in English" whenever the learner's native language differs.
- Localized glosses, if pursued, become an additional `glosses: { es: "…" }` map per item with the same ID. They are reviewed content, never runtime AI.
- Coach explanations continue to follow the native language, because that is real server behaviour (`claude.js:34`).

### 3.5 Content moved out of the client

`LANGS_DATA` facts, sounds and culture (index.html 546-1012) move to `content/<lang>/culture.json` and `content/<lang>/sounds.json` for all 12 languages:

- fr, es and ja entries come from their inline blocks.
- The other 9 come from `FACTS_BY_LANG`, `SOUNDS_BY_LANG` and `CULTURE_BY_LANG`.
- All fabricated fields are **deleted**: level, streak, resume, resumePct, vocabTotal, the soundCount literal, vocabThemes pct/state, placeholder exercises.

---

## 4. Curriculum model

### 4.1 Schema (`shared/curriculum/schema.ts`)

```ts
export interface Course {
  id: string;                  // "fr.core"
  lang: LanguageCode;
  version: string;             // semver; lesson_progress stores it
  contentVersions: Record<TabId, string>;
  stages: Stage[];
}
export interface Stage {
  id: string;                  // "fr.core.foundations"
  title: I18nKey;
  band: "foundations" | "beginner" | "intermediate" | "advanced";
  units: Unit[];
}
export interface Unit {
  id: string;                  // "fr.core.beginner.u2-present-tense"
  title: I18nKey | string;
  summary: string;
  outcomes: Outcome[];         // can-do statements, each with provenance
  lessons: LessonRef[];
  checkpoint?: LessonRef;      // optional test-out / consolidation lesson
}
export interface Outcome { id: string; text: string; source: ContentRef }   // e.g. roadmap.phases[0].can[2]
export interface LessonRef {
  id: string;                  // "fr.lesson.present-er-etre-avoir"
  title: string;
  kind: "vocabulary" | "grammar" | "dialogue" | "pattern" | "review";
  sources: ContentRef[];       // content item IDs the lesson is built from
  prerequisites: string[];     // lesson IDs
  blockCount: number;          // computed by the lesson compiler
}
export interface ContentRef { itemId: string; field?: string; contentVersion: string }
```

### 4.2 Building courses without inventing content

1. **Compiler v1 (parity).** `scripts/compile-curriculum.ts` reproduces today's `buildUnits` ordering from canonical content (vocab 0-2; Beginner grammar; vocab 3-8; Intermediate; vocab 9+; Advanced; dialogues), with stable IDs. The journey learners already know is preserved. Legacy position IDs (`v3`, `g12`, `d0`) map exactly to lesson IDs through `legacy_lesson_map/<lang>.json`, generated from the same snapshot.
2. **Editorial v2 (reviewed).** Units are re-sequenced to interleave related vocabulary, grammar, patterns and dialogues. Examples: numbers + present tense + "Il y a" pattern + café dialogue. Outcomes are attached from the language's `roadmap.json` `can[]` statements, which are real curated milestones. Each editorial change is a reviewed curriculum version. Completed lesson IDs survive re-sequencing because IDs are not positions.
3. **Depth differences stay visible.** Where content depth differs (fr/es/de/pt have 16 vocab categories without examples), the course is shorter and example-dependent blocks are omitted. The admin content matrix flags the gap. Nothing is padded.

### 4.3 Lesson states and locking

| State | Rule |
|---|---|
| `completed` | `lesson_progress.status='completed'` |
| `in_progress` | started, not completed |
| `available` | all `prerequisites` completed, **or** inside a stage unlocked by placement |
| `locked` | otherwise. Shown with "Complete *X* to unlock" and, where a checkpoint exists, "Test out". Locked lessons can be previewed read-only (Library view of the same items), so learning is never paywalled by the lock. |

- **Placement.** Uses the onboarding level already stored in `users.user_level` (fixes P8): `beginner-zero`/`beginner` → Foundations; `intermediate` → Beginner and Intermediate available; `advanced` → all available. It can be changed in settings. Placement never marks lessons *completed*.
- **Estimates (honest).**
  - "N lessons left in this unit" is always shown.
  - Time estimates appear only when there is data: "about M min", where M = learner's median active minutes per completed engine lesson × remaining lessons, shown only after ≥3 engine-completed lessons.
  - Before that, a lesson shows "≈ B steps" (block count). No invented minutes.

---

## 5. Lesson Engine

### 5.1 Session model

A lesson is a sequence of **steps** grouped by phase:

- **UNDERSTAND → HEAR → INSPECT → RECALL → PRODUCE → FEEDBACK → COMPLETE.**
- FEEDBACK is attached to every exercise attempt, not only one step.
- REVIEW scheduling happens at COMPLETE.
- A phase may be absent when content cannot support it. Example: no HEAR on a device without TTS, where the fallback is "Audio unavailable on this device".

```ts
export interface Lesson {
  id: string; lang: LanguageCode; courseId: string; version: string;
  title: string; band: Stage["band"]; outcomes: string[];      // outcome IDs
  sources: ContentRef[];
  steps: { phase: Phase; blocks: Block[] }[];
}
export type Phase = "understand" | "hear" | "inspect" | "recall" | "produce" | "complete";

interface BlockBase {
  id: string;                       // stable within lesson: "b07"
  type: Block["type"];
  sources: ContentRef[];            // provenance: which content fields this block shows or derives from
  derivation?: { rule: DerivationRuleId; seed: string; params?: Record<string, unknown> };
  requires?: Capability["id"][];    // block skipped (and logged) if the LanguagePack lacks it
  concepts?: string[];              // content item IDs this block practises (feeds concept_stats)
  optional?: boolean;
}
```

### 5.2 Block catalogue

| Block | Kind | Key fields | Renderer interaction |
|---|---|---|---|
| `ConceptBlock` | display | `title`, `band`, `outcomes` | intro card |
| `ExplanationBlock` | display | `markdownSafeText` (verbatim source text), `emphasis?: string[]` | reading width (`--measure`) |
| `ExampleBlock` | display | `target`, `ref`, `audio: boolean` | TargetText + AudioButton + "Inspect" → breakdown |
| `SentenceBreakdownBlock` | inspect | `text`, `tokens?: TokenAnnotation[]` | token selection → token panel (§7) |
| `AudioBlock` | hear | `items: {target, ref}[]`, `rate?` | play all / each; replay |
| `ConjugationPatternBlock` | display+inspect | `lemma`, `rows: {person, form, highlight?}[]`, `endings?` | inflection table; tap a form to hear it |
| `ListeningExercise` | exercise | `audioText`, `choices`, `answer` | play → choose |
| `MultipleChoiceExercise` | exercise | `prompt`, `choices`, `answer`, `mistakes?` | select → check |
| `FillBlankExercise` | exercise | `before`, `after`, `answer: AnswerSpec`, `ref?` | typed input with language-aware keyboard hints |
| `OrderingExercise` | exercise | `tokens` (seeded shuffle), `answer: string[]` | drag or tap-to-place; keyboard reorder |
| `MatchingExercise` | exercise | `pairs: {left, right}[]` | tap-pair; keyboard |
| `SpeakingExercise` | exercise | `target`, `ref` | record → transcript compare (if STT) or self-report (flagged) |
| `WritingExercise` | exercise | `prompt`, `answer?: AnswerSpec`, `coachReview?: boolean` | constrained → deterministic; open → optional Coach review, labelled AI |
| `TranslationExercise` | exercise | `prompt` (ref), `answer: AnswerSpec`, `hint?` | typed; hint after first miss |
| `MistakeInsightBlock` | display | `wrong`, `right`, `explanation`, `scaffold?: FillBlankExercise` | shows the contrast; optional scaffold |
| `CultureInsightBlock` | display | `text` | note card |
| `PronunciationExercise` | exercise | `target`, `focus?` (sound from `sounds.json`) | listen → repeat → compare transcript |
| `CheckpointBlock` | exercise group | `selection: "unit-missed-first" \| "unit-all"`, `count` | draws earlier exercises from learner state |
| `LessonSummaryBlock` | complete | computed only | metrics + Continue / Review lesson |

### 5.3 Evaluation (pure, shared, golden-tested)

```ts
export interface AnswerSpec {
  accepted: string[];                              // from content; ≥1
  normalization: "latin-default" | "cjk" | "arabic" | "devanagari";  // chosen from LanguagePack
  accentPolicy: "strict" | "accept-with-note";      // "accept-with-note" → correct, but feedback shows the accents
  mistakes?: MistakeRule[];
}
export interface MistakeRule {
  id: string;                                       // "fr.mistake.etre-for-avoir-faim"
  matches: string[];                                // normalized wrong answers (authored, reviewed)
  concept: string;                                  // content item ID
  explanation: ContentRef;                          // MUST cite an existing content field
  scaffold?: { before: string; after: string; answer: AnswerSpec };
}
export interface Evaluation {
  correct: boolean;
  normalizedResponse: string;
  matchedMistake?: string;                          // MistakeRule.id
  notes: ("accents" | "capitalization" | "punctuation")[];
}
export function evaluate(spec: AnswerSpec, response: string, lang: LanguagePack): Evaluation;
```

Normalization profiles:

- **Latin:** Unicode NFC, trim, collapse whitespace, unify apostrophes `’`/`'`, strip trailing punctuation, case-fold.
- **CJK:** NFC, full-width/half-width folding, strip spaces.
- **Arabic:** optionally strip harakat, unify alef variants only when accentPolicy allows.
- **Devanagari:** NFC.

Golden vectors live in `shared/fixtures/evaluation/*.json` and are used by web, server and any native client.

### 5.4 Renderer contract

```ts
export interface BlockRendererProps<B extends Block> {
  block: B;
  lesson: { id: string; lang: LanguagePack; nativeLang: LanguageCode };
  services: {
    speech: SpeechService;          // speak(text, {lang, rate}); recognize({lang}) | null
    breakdown: BreakdownService;    // resolve(text) → Token[]
    vocabulary: VocabularyService;  // save / markKnown (emits events)
    coach: CoachLauncher;           // open({ context }) → drawer
  };
  emit(event: LearnerEventDraft): void;     // to the outbox; never awaited by UI
  onResult(result: BlockResult): void;
}
export interface BlockResult {
  blockId: string;
  status: "completed" | "skipped";
  attempts: number;
  firstTryCorrect?: boolean;
  matchedMistakes: string[];
  activeMs: number;                 // measured with visibility-aware timer
}
export const blockRegistry: { [T in Block["type"]]: React.ComponentType<BlockRendererProps<Extract<Block,{type:T}>>> };
```

Rules:

- Renderers never fetch content and never call AI directly. They go through services.
- Every interactive renderer supports keyboard operation and exposes its state to assistive technology.
- A lesson **completes naturally** when every non-optional block has a `completed` result. There is no "Mark done" button (fixes L8). Leaving midway keeps `in_progress` with the last completed block, so resume returns to the same block.

### 5.5 Deterministic derivation rules (no fabricated data)

| Rule ID | Source fields | Output | Determinism and guard |
|---|---|---|---|
| `grammar.concept` | `grammar[i].title, level` | ConceptBlock | verbatim |
| `grammar.explain` | `rule`, `note` | ExplanationBlock | verbatim |
| `grammar.examples` | `example_target`, `example_target_2`, `example_ref` | ExampleBlock ×2 | `example_ref`: strip leading `"English: "`, split once on `" / "`; if the count ≠ 2, show the combined ref under the first example |
| `sentence.order` | any example target | OrderingExercise | tokens via LanguagePack segmentation; only 3-12 tokens; shuffle seeded by `lessonId+blockId`, guaranteed ≠ original |
| `vocab.match` | `vocab[c].words[*].t/r` | MatchingExercise (≤6 pairs) | seeded selection |
| `vocab.listen-choose` | `t` (audio), `r` | ListeningExercise | 3 distractors from the same category; needs ≥4 words |
| `vocab.recall` | `r` → `t` | TranslationExercise | `accepted=[t]` |
| `vocab.example` | `ex`, `exr` | ExampleBlock | only when present (8 languages today) |
| `drill.recall` | `drills[i].q/a/hint` | TranslationExercise | `accepted=[a]`; hint after first miss |
| `structure.explain` | `pattern`, `explanation`, `ex1/ex2` | ExplanationBlock + ExampleBlock | verbatim |
| `structure.identify` | `ex*_target` + sibling `pattern`s in the unit | MultipleChoiceExercise | choices = patterns of structures in the same unit |
| `dialogue.listen` | `lines[k].target/ref` | ListeningExercise | distractors = other refs of the same dialogue |
| `dialogue.order` | 4 consecutive lines | OrderingExercise | seeded window |
| `cheatsheet.match` | `items[*].target/ref` | MatchingExercise | seeded |
| `culture.insight` | `dialogues[i].note`, `culture.json` | CultureInsightBlock | verbatim |
| `pattern.table` | **annotation** + cited source | ConjugationPatternBlock + FillBlank/MCQ over its forms | **source guard**: every form must occur (normalized) in a cited source field, else CI fails |
| `mistake.rule` | **annotation** + cited explanation | MistakeInsightBlock (+ scaffold) and `mistakes[]` on exercises | explanation must be a `ContentRef` to an existing field; `reviewedBy`/`reviewedAt` required |
| `speak.repeat` | an example target | SpeakingExercise | transcript comparison only when STT exists; otherwise self-report, stored as `self_reported` and excluded from correctness |
| `review.checkpoint` | learner projections | CheckpointBlock | missed first, then oldest; deterministic ordering |

**Annotations** (`annotations/<lang>/<lessonId>.json`) are the only place structure is added. That structure means inflection tables, accepted alternatives and known wrong forms. Annotations are small, human-reviewed and provenance-checked. They never introduce facts that are not already in the cited content.

### 5.6 Worked example: French "Le présent: verbes en -er, être et avoir"

Sources, all existing (forensics §5.3):
- `grammar.json` section 0 (rule, examples, note)
- `routes/content.js:57` anchor (parler paradigm), to be moved into `content/fr/grammar.json` as a cited field
- `cheatsheet.json` "avoir faim / soif … uses avoir not être"
- `drills.json` 0-2
- `vocab.json` "Les Verbes Courants"
- `structures.json` "Sujet + Verbe + Objet"

The final text follows the canonical content chosen at gate G1.

```jsonc
{
  "id": "fr.lesson.present-er-etre-avoir", "lang": "fr", "courseId": "fr.core", "version": "1.0.0",
  "title": "Le présent : verbes en -er, être et avoir", "band": "beginner",
  "outcomes": ["fr.roadmap.p1.can.2"],  // "Conjugate être and avoir in the present…"
  "steps": [
    { "phase": "understand", "blocks": [
      { "id": "b01", "type": "ConceptBlock", "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"title"}] },
      { "id": "b02", "type": "ExplanationBlock", "derivation": {"rule":"grammar.explain","seed":"b02"},
        "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"rule"}] }
    ]},
    { "phase": "hear", "blocks": [
      { "id": "b03", "type": "AudioBlock", "derivation": {"rule":"grammar.examples","seed":"b03"},
        "items": [{"target":"Nous parlons français et ils habitent à Paris.","ref":"We speak French and they live in Paris."},
                  {"target":"J'ai deux frères et je suis étudiant.","ref":"I have two brothers and I am a student."}] }
    ]},
    { "phase": "inspect", "blocks": [
      { "id": "b04", "type": "SentenceBreakdownBlock", "text": "J'ai deux frères et je suis étudiant.",
        "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"example_target_2"}] },
      { "id": "b05", "type": "ConjugationPatternBlock", "lemma": "parler", "derivation": {"rule":"pattern.table","seed":"b05"},
        "rows": [{"person":"je","form":"parle"},{"person":"tu","form":"parles"},{"person":"il/elle","form":"parle"},
                 {"person":"nous","form":"parlons"},{"person":"vous","form":"parlez"},{"person":"ils/elles","form":"parlent"}],
        "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"anchor"}] },
      { "id": "b06", "type": "ConjugationPatternBlock", "lemma": "être", "derivation": {"rule":"pattern.table","seed":"b06"},
        "rows": [{"person":"je","form":"suis"},{"person":"tu","form":"es"},{"person":"il","form":"est"},
                 {"person":"nous","form":"sommes"},{"person":"vous","form":"êtes"},{"person":"ils","form":"sont"}],
        "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"rule"}] },
      { "id": "b07", "type": "ConjugationPatternBlock", "lemma": "avoir", "derivation": {"rule":"pattern.table","seed":"b07"},
        "rows": [{"person":"je","form":"ai"},{"person":"tu","form":"as"},{"person":"il","form":"a"},
                 {"person":"nous","form":"avons"},{"person":"vous","form":"avez"},{"person":"ils","form":"ont"}],
        "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"rule"}] },
      { "id": "b08", "type": "ExplanationBlock", "sources": [{"itemId":"fr.grammar.present-er-etre-avoir","field":"note"}] }
    ]},
    { "phase": "recall", "blocks": [
      { "id": "b09", "type": "FillBlankExercise", "derivation": {"rule":"pattern.table","seed":"b09"},
        "before": "Nous parl", "after": " français.", "answer": {"accepted":["ons"],"normalization":"latin-default","accentPolicy":"strict"},
        "concepts": ["fr.grammar.present-er-etre-avoir"] },
      { "id": "b10", "type": "MultipleChoiceExercise", "derivation": {"rule":"pattern.table","seed":"b10"},
        "prompt": "J'___ deux frères.", "choices": ["ai","suis","as"], "answer": "ai" },
      { "id": "b11", "type": "MistakeInsightBlock", "derivation": {"rule":"mistake.rule","seed":"b11"},
        "wrong": "Je suis faim", "right": "J'ai faim",
        "explanation": {"itemId":"fr.cheatsheet.faux-amis.avoir-faim","field":"note"},
        "scaffold": {"before":"J'","after":" faim.","answer":{"accepted":["ai"],"normalization":"latin-default","accentPolicy":"strict",
          "mistakes":[{"id":"fr.mistake.etre-for-avoir-faim","matches":["suis"],"concept":"fr.cheatsheet.faux-amis.avoir-faim",
                       "explanation":{"itemId":"fr.cheatsheet.faux-amis.avoir-faim","field":"note"},
                       "scaffold":{"before":"J'","after":" faim.","answer":{"accepted":["ai"],"normalization":"latin-default","accentPolicy":"strict"}}}]}} },
      { "id": "b12", "type": "MultipleChoiceExercise", "derivation": {"rule":"pattern.table","seed":"b12"},
        "prompt": "Je ___ étudiant. (I am a student)", "choices": ["suis","ai","est"], "answer": "suis" }
    ]},
    { "phase": "produce", "blocks": [
      { "id": "b13", "type": "TranslationExercise", "derivation": {"rule":"drill.recall","seed":"b13"},
        "prompt": "'I am' in French?", "answer": {"accepted":["je suis"],"normalization":"latin-default","accentPolicy":"accept-with-note"},
        "hint": "être is irregular: je suis, tu es, il est", "sources": [{"itemId":"fr.drills.i-am"}] },
      { "id": "b14", "type": "TranslationExercise", "derivation": {"rule":"drill.recall","seed":"b14"},
        "prompt": "'We have' in French?", "answer": {"accepted":["nous avons"],"normalization":"latin-default","accentPolicy":"accept-with-note"},
        "sources": [{"itemId":"fr.drills.we-have"}] },
      { "id": "b15", "type": "OrderingExercise", "derivation": {"rule":"sentence.order","seed":"b15"},
        "sources": [{"itemId":"fr.structures.svo","field":"ex1_target"}] },
      { "id": "b16", "type": "SpeakingExercise", "derivation": {"rule":"speak.repeat","seed":"b16"},
        "target": "J'ai deux frères et je suis étudiant.", "optional": true }
    ]},
    { "phase": "complete", "blocks": [ { "id": "b17", "type": "LessonSummaryBlock" } ] }
  ]
}
```

Feedback behaviour in this lesson:

- If the learner types `suis` in b11's scaffold, the evaluation matches `fr.mistake.etre-for-avoir-faim`.
- The feedback panel then shows the cited cheatsheet note ("literally 'to have hunger/thirst', uses avoir not être").
- It re-presents the scaffold `J'___ faim.`.
- It emits `exercise_attempted{correct:false, matchedMistake}`, which raises that concept's review priority (§9.4).

`LessonSummaryBlock` shows only computed values:

- exercises answered
- correct on first try (n / m)
- mistakes to review (links)
- words added to review (only those the learner accepted)
- active time

Actions are **Continue** (next available lesson) and **Review this lesson**. There are no XP, "fluency" or percentage-mastery claims.

---

## 6. Practice and Review

- **One SRS implementation** in `shared/srs/sm2.ts`. The web version is canonical, and Android is already a faithful port. Parameters: grades 0-3 → quality [0, 2, 4, 5], ease floor 1.3, intervals 1 → 6 → ×ease, Easy ×1.6. The server applies it on `POST /api/learner/reviews`. Golden vectors in `shared/fixtures/srs/` pin the behaviour; the iOS divergence (D3) is a failing vector until fixed.
- **Review queue** (`GET /api/learner/review-queue?lang=`) is built deterministically in this order:
  1. due `srs_cards` (`next_review_at <= now`, current language only; fixes L1)
  2. due `review_items`: missed lesson exercises and matched mistake rules, re-asked after 1, 3 and 7 days with the same SM-2 update
  3. concept reinforcement for `concept_stats` with ≥3 attempts and first-try accuracy <60%, which pulls that concept's exercises from completed lessons

  Counts shown anywhere (Today, Practice, nav badges) come from one `deckStats(lang)` endpoint (fixes L1 and duplicated counting).
- **Flashcards** become deck management (browse, add, edit, delete, import from My Words) plus the card review UI inside the review session. "Load starter deck" draws from the lesson vocabulary the learner has completed, instead of a hard-coded category read (fixes the starter-deck shape bug).
- **Quick Drills** are graded `TranslationExercise` sets built from `drills.json` (the `drill.recall` rule). Attempts are recorded.
- **Pronunciation**: `sounds.json` items plus `PronunciationExercise`. Scoring is honest: "We compared what the speech recogniser heard" (transcript match). No phonetic accuracy score is claimed.
- **Mistakes** (`/practice/mistakes`): grouped matched mistake rules and missed exercises with the cited explanation and a "Practise now" action.

---

## 7. Sentence Breakdown system

```ts
export interface Token {
  surface: string; start: number; end: number;
  lemma?: string; pos?: PartOfSpeech; features?: Partial<{ tense: string; person: string; number: string; gender: string; case: string; aspect: string; politeness: string }>;
  gloss?: string;                          // in glossLanguage (or native language when source is AI)
  reading?: string;                        // romanization / furigana
  grammarRefs?: string[];                  // content item IDs
  source: "lexicon" | "content-index" | "ai" | "none";
  learnerState: "new" | "saved" | "reviewing" | "known";   // from user_vocabulary + srs_cards
}
```

**Pipeline** (`BreakdownService.resolve(text, lang)`):

1. **Segment** per LanguagePack (`whitespace+clitics` for fr/it such as `j'`, `l'`, `qu'`; `Intl.Segmenter` for zh/ja; whitespace plus particle hints for ko).
2. **Curated lexicon** `lexicon/<lang>.json`: human-reviewed entries for surfaces used in lessons (`ai` → lemma `avoir`, verb, present, 1sg, "have", grammarRefs `fr.grammar.present-er-etre-avoir`). Each entry must cite a content item where one exists.
3. **Content index:** exact and case-folded matches against vocabulary `t` (gloss `r`), cheatsheet `target`.
4. **Cached AI enrichment** (explicit "Explain this sentence" action, feature `breakdown.enrich`). The server-side cache is keyed by `sha256(lang|nativeLang|modelVersion|text)`. Results are marked `source:"ai"` and shown with an "AI" label. If AI is unavailable, steps 1-3 still work and the UI says "Detailed analysis unavailable right now".

**Token panel actions** (same component in lessons, Library, Analyze):

- **Hear:** SpeechService.
- **Save:** `word_saved` event → `user_vocabulary`, optional card.
- **Grammar context:** opens the Library item.
- **Ask Coach:** opens the Coach drawer with `{text, token, lessonId?}`.
- **Practise:** creates an SRS card, or opens concept exercises.
- **Known / unknown:** `vocab_state_changed`.

The unbounded `bd_*` localStorage cache is replaced by the server cache plus a bounded LRU on the client (200 entries).

---

## 8. Analyze workspace

- **Route:** `/app/:lang/coach/analyze` (new) and `/app/:lang/coach/analyze/:analysisId` (saved).
- **Layout:**
  - Expanded (≥1024px): two panes. Source text on the left, Inspector on the right.
  - Medium: resizable split.
  - Compact: source full width, Inspector as a bottom sheet that opens on token selection.
- **Source pane:** paste or type (≤20,000 chars). Deterministic segmentation renders tokens coloured by `learnerState` (new / saved / reviewing / known). Sentence boundaries are selectable.
- **Inspector tabs:**
  - **Word:** token panel (§7).
  - **Sentence:** translation (AI, explicit button, cached) and breakdown.
  - **Grammar:** lexicon grammarRefs, then AI notes (explicit).
  - **Vocabulary:** extraction list of every distinct token not `known`, with lexicon or content glosses where available. Select → save to My Words / create cards.
  - **Practise:** deterministic exercises from the learner's own text: cloze on saved words in their sentences, sentence ordering, listening with TTS. Attempts are recorded with `subject_type:"analysis"`.
- **Save** stores to `saved_analyses`, which the user can rename or delete. **Send to Coach** opens Coach with the selected text as context.
- **Availability:** everything except translation, AI grammar notes and AI enrichment works without AI.
- **Replaces:** TextAnalyzer (7474-7587) and the Word Space "debounced auto-translate". Look-up becomes an explicit action from the shell search (§12.4), which stops passive lookups from burning the free AI quota (B11).

---

## 9. Coach, the AI gateway, and the learner model

### 9.1 Server-defined AI features (replaces the generic prompt proxy)

`server/ai/features/*.ts`, each exporting `{ id, inputSchema, outputSchema, buildPrompt(input, ctx), model, maxTokens, quotaClass, cacheable }`:

| Feature | Input | Output | Used by |
|---|---|---|---|
| `coach.ask` | message, context refs | reply text + optional citations to content IDs | Coach |
| `coach.conversation` | scenarioId, level, history | SSE stream | Conversation (existing server-owned scenarios kept) |
| `coach.review_writing` | prompt, learner text | corrections[] {span, suggestion, rule}, overall comment | WritingExercise (open), Coach › Correct my writing |
| `breakdown.enrich` | text | Token[] (lemma/pos/features/gloss) | Breakdown, Analyze |
| `analyze.translate` | text | translation | Analyze |
| `analyze.grammar_notes` | text | notes[] | Analyze |
| `lookup.translate` | query | translation, pronunciation, examples[] (neutral keys `target`/`ref`, not `translation_fr`) | shell Look up |
| `culture.expand` | culture item ID | expansion | Library › Culture |
| `support.answer` | question | answer | Help |

`POST /api/claude` stays temporarily as a deprecated shim that only accepts known `featureType` values, then is removed. `language` and `nativeLang` are validated against the registry (fixes B10).

### 9.2 AI gateway and error contract

- **One module** (`server/ai/gateway.ts`) owns model IDs (config), timeouts, retries, cost logging (all features, including content drafts; fixes P14), prompt caching for static system prompts, and **error classification**:

```ts
type AiErrorCode = "ai_unavailable_credits" | "ai_unconfigured" | "ai_overloaded" | "ai_bad_output" | "ai_timeout" | "quota_exceeded";
// HTTP: credits/unconfigured → 503 + Retry-After; overloaded/timeout → 503; bad_output → 502; quota → 429
// Body: { code, message, retryable, resetAt? }
```

- **Quota is charged only after a successful upstream response**, using an atomic conditional update (fixes B11).
- **Streaming:** the upstream request opens first. SSE headers are flushed only after upstream returns OK. Failures before streaming return JSON errors with a real status (fixes L3).
- **`GET /api/ai/status`:** circuit-breaker state (`available | degraded | unavailable`). The shell shows one honest banner ("The AI tutor is unavailable right now. Lessons, review and the library still work."). AI entry points are disabled with that explanation instead of failing one by one (fixes L2, L16).
- **Client:** `AiError` plus a single `<AiUnavailable code=…/>` component. "Check your connection" appears **only** when `fetch` itself rejects.

### 9.3 Coach context (no fake intelligence)

Context assembly is explicit, minimal and visible to the learner as "Coach can see: …":

- target and native language, LanguagePack notes (register, script)
- current lesson title and outcomes (if opened from a lesson)
- the selected text or token (from Breakdown or Analyze)
- up to 3 most frequent recent matched mistake rules with their explanations
- band from placement

Coach message text is not stored in `learning_events`. Only `coach_message_sent{feature, contextRefs, chars}` is recorded. Coach replies never change progress or mastery.

### 9.4 Learner Model

**Event types** (`shared/learner/events.ts`, Zod-validated on the server):

| Event | Payload (key fields) | Producers |
|---|---|---|
| `lesson_started` | lessonId, courseVersion | Lesson Engine |
| `block_completed` | lessonId, blockId, activeMs | Lesson Engine |
| `exercise_attempted` | exerciseKey (lessonId#blockId or drillId), blockType, correct, attemptNo, matchedMistake?, concepts[], responseHash, activeMs, evaluation: `deterministic`\|`transcript`\|`self_reported`\|`ai` | Lesson, Practice, Analyze-practise |
| `lesson_completed` | lessonId, exercises, firstTryCorrect, activeMs | Lesson Engine |
| `item_encountered` | contentItemId, context (lesson\|library\|analysis) | Library, lessons |
| `word_saved` / `word_state_changed` | termKey, surface, gloss, contentRef?, state | Breakdown, Analyze, Look up, lessons |
| `card_created` / `card_deleted` | cardId, origin | Flashcards, lessons |
| `card_reviewed` | cardId, grade 0-3, reviewedAt | Review |
| `pronunciation_attempted` | target, transcript?, match: boolean\|null, method | Speaking/Pronunciation |
| `conversation_turn` / `conversation_completed` | scenarioId, turns | Conversation |
| `coach_message_sent` | feature, contextRefs, chars | Coach |
| `analysis_saved` | analysisId, chars | Analyze |
| `outcome_self_checked` | outcomeId, checked | Learn › Outcomes (migrated Roadmap checkboxes) |
| `legacy_imported` | importId, summary | Import |

**Projections** (maintained transactionally when events are accepted):

`lesson_progress`, `srs_cards`, `review_items`, `user_vocabulary`, `concept_stats`, `activity_days`, `learner_streak`, `outcome_checks`.

**What can honestly be measured, and what is labelled otherwise:**

| Metric | Shown as | Basis |
|---|---|---|
| Lessons completed / in progress | exact | engine completion; legacy completions labelled "marked done (earlier version)" |
| Exercise accuracy (first-try) | exact, per lesson/concept | deterministic evaluation only |
| Repeated mistakes | exact counts per mistake rule | matched rules |
| Cards due / learned (≥1 successful review) | exact | SRS state |
| Words saved / reviewing | exact | user_vocabulary + cards |
| Active days, streak | exact under a stated rule: a day counts when ≥1 **learning** event occurs in the learner's timezone (lesson block, exercise, card review, conversation turn). Lookups and Coach questions do not count. | activity_days |
| Active time | approximate, visibility-aware timer; labelled "about" | block activeMs |
| Concept practice accuracy | "practice accuracy", not "mastery", until validated | concept_stats |
| Pronunciation | "recogniser matched / didn't match"; never a score | transcript comparison |
| AI writing feedback | shown, labelled AI; **excluded** from accuracy and mastery | `evaluation:"ai"` |
| CEFR level, fluency, "words known" | **not shown** | no valid basis |

### 9.5 Server schema proposal: additive, versioned migrations

- **Runner:** `server/migrations/NNN_name.sql` with a `schema_migrations` table recording version and checksum. It runs from Fly `release_command` and fails loudly: non-zero exit aborts the deploy.
- **Baseline:** migration `000_baseline` asserts that the existing 13 tables exist and changes nothing.
- **Existing tables:** only `ADD COLUMN IF NOT EXISTS`. No renames, no drops, no type changes in this programme.

```sql
-- 001_schema_migrations.sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- 002_content_safety.sql
ALTER TABLE content_cache ADD COLUMN IF NOT EXISTS content_version TEXT;
ALTER TABLE content_cache ADD COLUMN IF NOT EXISTS source TEXT;          -- 'reviewed' | 'seed' | 'legacy-ai'
CREATE TABLE IF NOT EXISTS content_snapshots (
  id BIGSERIAL PRIMARY KEY, lang TEXT NOT NULL, tab TEXT NOT NULL,
  content_json TEXT NOT NULL, reason TEXT NOT NULL, taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS content_drafts (
  id BIGSERIAL PRIMARY KEY, lang TEXT NOT NULL, tab TEXT NOT NULL, content_json TEXT NOT NULL,
  generator TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status TEXT NOT NULL DEFAULT 'pending');

-- 003_learner_profile.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS native_lang TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;

-- 004_learning_events.sql
CREATE TABLE IF NOT EXISTS learning_events (
  event_id       UUID PRIMARY KEY,                  -- client-generated → idempotent retries
  user_id        INTEGER NOT NULL REFERENCES users(id),
  lang           TEXT NOT NULL,
  type           TEXT NOT NULL,
  subject_type   TEXT,
  subject_id     TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source         TEXT NOT NULL,                     -- web | ios | android | server | import
  client_id      TEXT,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS learning_events_user_lang_time ON learning_events (user_id, lang, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_subject ON learning_events (user_id, subject_type, subject_id);

-- 005_lesson_progress.sql
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, lesson_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed')),
  last_block_id TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, course_version TEXT,
  exercises INTEGER NOT NULL DEFAULT 0, first_try_correct INTEGER NOT NULL DEFAULT 0, active_ms BIGINT NOT NULL DEFAULT 0,
  completion_source TEXT NOT NULL DEFAULT 'engine' CHECK (completion_source IN ('engine','legacy_self_report')),
  legacy_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lang, lesson_id));

-- 006_srs.sql
CREATE TABLE IF NOT EXISTS srs_cards (
  card_id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL,
  front TEXT NOT NULL, back TEXT NOT NULL DEFAULT '', pronunciation TEXT NOT NULL DEFAULT '', example TEXT NOT NULL DEFAULT '',
  content_ref TEXT, origin TEXT NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1, repetitions INTEGER NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5,
  next_review_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ, legacy_local_id TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS srs_cards_dedupe ON srs_cards (user_id, lang, lower(front)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS srs_cards_due ON srs_cards (user_id, lang, next_review_at) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS review_items (
  user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, item_key TEXT NOT NULL,
  reason TEXT NOT NULL, concept_id TEXT, due_at TIMESTAMPTZ NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1, repetitions INTEGER NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5,
  resolved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lang, item_key));

-- 007_vocabulary_concepts.sql
CREATE TABLE IF NOT EXISTS user_vocabulary (
  user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, term_key TEXT NOT NULL,
  surface TEXT NOT NULL, gloss TEXT, content_ref TEXT,
  state TEXT NOT NULL CHECK (state IN ('saved','known','ignored')), source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lang, term_key));
CREATE TABLE IF NOT EXISTS concept_stats (
  user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, concept_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, first_try_correct INTEGER NOT NULL DEFAULT 0,
  recent JSONB NOT NULL DEFAULT '[]'::jsonb, mistake_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_at TIMESTAMPTZ, PRIMARY KEY (user_id, lang, concept_id));

-- 008_activity.sql
CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, local_date DATE NOT NULL,
  learning_events INTEGER NOT NULL DEFAULT 0, active_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, lang, local_date));
CREATE TABLE IF NOT EXISTS learner_streak (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), current_days INTEGER NOT NULL DEFAULT 0,
  longest_days INTEGER NOT NULL DEFAULT 0, total_days INTEGER NOT NULL DEFAULT 0, last_active_date DATE,
  carried_over_from TEXT);            -- 'legacy_local' | 'legacy_server' | NULL (transparent carry-over)
CREATE TABLE IF NOT EXISTS outcome_checks (
  user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, outcome_id TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL, source TEXT NOT NULL, PRIMARY KEY (user_id, lang, outcome_id));

-- 009_legacy_imports.sql
CREATE TABLE IF NOT EXISTS legacy_imports (
  id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
  source TEXT NOT NULL,                -- web-localstorage | ios-userdefaults | android-room
  checksum TEXT NOT NULL, payload JSONB NOT NULL, summary JSONB, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_id, checksum));

-- 010_analysis_ai_cache.sql
CREATE TABLE IF NOT EXISTS saved_analyses (
  id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), lang TEXT NOT NULL, title TEXT,
  body TEXT NOT NULL CHECK (length(body) <= 20000), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS ai_result_cache (
  cache_key TEXT PRIMARY KEY, feature TEXT NOT NULL, lang TEXT NOT NULL, native_lang TEXT, model TEXT NOT NULL,
  result JSONB NOT NULL, hits INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
```

Notes:

- **The existing `streaks` table stays** and is dual-written during transition, because the push-reminder cron reads `last_practice`. The cron switches to `activity_days` in P12, after which `streaks` becomes read-only history.
- **Account deletion** (`DELETE /api/auth/account`, which anonymises today) must also delete the user's rows in every learner table in one transaction. This is documented in the privacy page update.
- **Retention:** `learning_events` is kept. It never stores free text from Coach or analyses; `saved_analyses` holds only what the user chose to save.

### 9.6 APIs

| Method + path | Purpose |
|---|---|
| `GET /api/learner/snapshot?lang=` | progress summary, deck stats, streak, curriculum position, due counts (one request feeds Today, Learn, nav badges) |
| `POST /api/learner/events` | batch ≤100 events; idempotent by `event_id`; returns accepted IDs and updated projections digest |
| `GET /api/learner/progress?lang=` | lesson states for the course |
| `GET /api/learner/review-queue?lang=` / `POST /api/learner/reviews` | review session / server-applied SM-2 |
| `GET/POST/PATCH/DELETE /api/learner/cards` | deck management |
| `GET/PUT /api/learner/vocabulary` | My Words |
| `POST /api/learner/import` | legacy import (§9.7) |
| `GET /api/learner/today?lang=` | Planner output: `NextAction[]` with `reason` |
| `GET /api/languages`, `GET /api/curriculum/:lang`, `GET /api/lessons/:lessonId` | registry, course, compiled lesson JSON |

All routes use Zod input validation, the async error wrapper and `requireAuth`, which checks account status after gate G2.

### 9.7 No-data-loss migration of existing browser data

**What exists** (forensics §6.2): `fc_cards_v2`, `learn_progress_<lang>` ×12, `roadmap_<lang>` ×12, `ws_saved`, `streak_*`, `tongue_last`, `user_level`, `target_lang`, `native_lang`, `bd_*`.

**Protocol** (client `LegacyImporter`, runs only after authentication resolves):

1. **Snapshot.** Read every legacy key as raw strings into `{clientId, capturedAt, timezone, raw}`. `clientId` is a random UUID persisted in `tongue_client_id`. Compute a SHA-256 checksum of the canonical JSON. `bd_*` is not uploaded (AI cache, regenerable) and is not deleted.
2. **Consent.** If any learner key is non-empty, show a one-time dialog: "We found learning data saved in this browser: *N* flashcards, *M* completed lessons, a *S*-day streak. Add it to **email**?" with Add / Not now / Keep separate. Existing sign-out does not clear these keys, so the data may belong to a previous account; nothing is merged silently. The answer is remembered per `(clientId, userId, checksum)`.
3. **Upload.** `POST /api/learner/import`. The server writes `legacy_imports` first (raw payload, unique per `user_id, client_id, checksum`, so retries are no-ops). It then merges **in one transaction**:

   | Legacy data | Merge rule |
   |---|---|
   | Cards | Validate each; invalid entries are reported and stay in raw. Upsert on `(user_id, lang, lower(front))`. On conflict keep the state with more `repetitions`; tie → later `next_review`. Never lower a server card's progress. `next_review` (ms) → `next_review_at`. `legacy_local_id` kept. |
   | `learn_progress_<lang>` | Map position IDs through `legacy_lesson_map/<lang>.json`, generated from the production content snapshot that served those positions; exact because regeneration is frozen in P0. Insert `completed` with `completion_source='legacy_self_report'` and `legacy_id`. Unmapped IDs are listed in `summary.unmapped` (kept in raw). |
   | `roadmap_<lang>` | `<phase>-<milestone>` → `outcome_checks` (`source='legacy_self_report'`). |
   | `ws_saved` (no language) | **Not guessed.** Stored in `summary.unassignedLookups`. Library › My Words shows "Assign 23 earlier look-ups to a language", pre-selecting the current target language but requiring confirmation. On confirm → `user_vocabulary` (and cards if chosen). |
   | Streak | Streak = server row merged with local counters: `longest = max`, `total = max`. `current` = local count if local `last` is today or yesterday in the provided timezone, otherwise the server-computed value. Written to `learner_streak` with `carried_over_from`. No synthetic `activity_days` rows are created. |
   | `user_level`, `target_lang`, `native_lang` | Server value wins when present; local fills blanks. |
   | `tongue_last` | Not imported (superseded by `lesson_progress.in_progress`). |

4. **Verify.** The client fetches `/api/learner/snapshot` and compares counts with the local snapshot. On mismatch it keeps using local stores through the adapter and retries. The import is marked done (`tongue_import_state`) only after verification.
5. **Keep legacy keys.** They stay untouched for at least two releases and are not deleted until an owner-approved cleanup phase. Until import is confirmed, the new stores dual-read: server when online and confirmed, local cache otherwise.
6. **Native.** The same endpoint with `source='ios-userdefaults'` (`tongue.flashcards.v1`) or `'android-room'`. iOS cards were scheduled with the divergent algorithm, so their intervals are imported as-is and never recomputed.

---

## 10. Progress and Planner (TODAY)

The planner is a pure function in `shared/planner/today.ts` (server-executed, unit-tested):

```ts
export interface NextAction { kind: "resume_lesson"|"review_due"|"next_lesson"|"practice_mistakes"|"conversation"|"placement";
  targetRoute: string; title: string; reason: string; estimate?: string; }
export function planToday(s: LearnerSnapshot, course: Course, now: Date): { primary: NextAction; secondary: NextAction[] };
```

Priority, first match wins for `primary`:

1. **No placement** → finish onboarding.
2. **In-progress lesson** touched in the last 7 days → resume at its last block.
3. **Due reviews ≥ 10**, or matched mistakes from the last session → review session.
4. **Next available lesson** in the curriculum.
5. **Due reviews > 0.**
6. **Unresolved mistakes** → practise mistakes.
7. **Course complete** → conversation scenario at the learner's band.

`reason` is always shown ("Because you left *Le présent* at step 9").

Today renders:

- **one** primary action card
- review-due count
- current unit progress ("Unit 2 · 3 of 7 lessons")
- streak under the stated rule
- a compact "Ask Coach" entry with the current context
- **one** optional discovery item (word of the day from vocabulary; culture fact)

That is at most six surfaces, down from about 23 entry points today.

---

## 11. Application shell, design tokens and primitives

### 11.1 Tokens: one source, brand preserved

- **Source:** `design/tokens.json` generates:
  - `web/src/ui/tokens.css` (CSS custom properties, light and dark)
  - `public/brand.css` variables (marketing, legal, 404, SEO pages)
  - `native/ios/.../Theme.swift` and `native/android/.../Color.kt` (if native continues)
  - `shared/tokens.ts` (breakpoints for JS)
- **Canonical values** are resolved once in P3 with a side-by-side visual review, starting from the "crafted identity" commits (`61d1859`, `cb66af2`):
  - brand crimson `#C0153E`, pink `#FF5F7E`
  - warm paper background from `brand.css`/`home.html` (`#F6F1E8`), warm ink (`#231C16`)
  - Fraunces (display) + Instrument Sans (UI)
  - radii 11 / 16 / 24 / pill
  - subtle warm borders
  - dark theme keeps the existing violet-black layers with `#FF7090` accent
  - accent themes (`THEMES`, `LANG_THEME`) preserved as data
  - `--blue*` names renamed to `--brand*`
- **New token families:**
  - **type scale:** 12 caption (floor), 13, 14, 16 body, 18, 22, 28, 36 display; no text below 12px
  - **spacing:** 4-based
  - **tap:** `--tap-min: 44px`
  - **measure:** `--measure: 68ch`
  - **widths:** `--width-reading: 44rem`, `--width-app: 72rem`, `--width-wide: 77.5rem` (1240px, today's cap)
  - **motion**, with `prefers-reduced-motion` honoured
  - **focus ring:** 2px accent + 2px offset
  - **elevation:** 2 levels
- **Theme application is synchronous:** `data-theme`, `data-accent` and `dir` attributes on `<html>`, set before first paint by an inline-free boot module plus CSS. The `C` getter layer and all `getComputedStyle` calls during render are removed. `meta[name=theme-color]` updates with the theme. The logo becomes an inline `<BrandMark>` SVG using `var(--accent-2)`/`var(--accent)`; the static `icon.svg` stays for favicon and manifest only (fixes L9).
- **Lint:** `stylelint` + ESLint rule forbidding hex/rgb literals outside `design/` (fixes 378 literals).

### 11.2 Breakpoints and layout (single source)

| Class | Width | Primary navigation | Layout |
|---|---|---|---|
| compact | < 600px | bottom tab bar (5 areas, labels, 56px, safe-area aware) | single column |
| medium | 600-1023px | navigation rail (icons + labels) | single column, wider gutters |
| expanded | ≥ 1024px | left sidebar: 5 areas + current area's sections | main + optional side panel (Coach drawer / Inspector) ≥ 1280px |

- JS reads the same constants via `matchMedia` (`useBreakpoint`), replacing `useDesktop` (900) and CSS 480/820/900 (fixes the 820-899 framed-card mode and the #root overflow).
- **Page templates:**
  - `AreaHome` (Today, Learn, Practice, Coach, Library landing): app width.
  - `ReadingPage` (Library items, lesson reading steps): reading width, prose at `--measure` (fixes L13).
  - `SessionPage` (lesson, review, drills): focused mode. On compact the bottom bar hides and a labelled "Exit" returns to the origin. Progress bar in the header.
  - `WorkspacePage` (Analyze): full width, two panes.

### 11.3 Primitives (`web/src/ui`), each with an accessibility contract

| Primitive | Contract |
|---|---|
| `AppShell` | regions: skip link, header, nav, main (`<main>` with route focus management), side panel, toast region (`aria-live=polite`), dialog layer |
| `PageHeader` | title (h1), subtitle, breadcrumbs (derived from the route tree), back (labelled, `history.back()` fallback to parent) |
| `ContentColumn` | `variant: reading \| app \| wide`, the only width owner |
| `Surface` | card/section with token borders and radii |
| `Button`, `IconButton`, `TextButton` | variants primary/secondary/ghost/danger; min 44px hit area; `IconButton` requires `aria-label` (type-enforced) |
| `Field`, `TextInput`, `TextArea`, `Select`, `Switch`, `SegmentedControl`, `Checkbox` | label association, error text via `aria-describedby` |
| `Dialog`, `Sheet` | `role=dialog`, `aria-modal`, labelled, Escape closes, focus trap, focus return, scroll lock (fixes L11) |
| `Toast` | queue, pause on hover/focus, never the only error channel for blocking failures |
| `AsyncBoundary` + `LoadingState` / `ErrorState` / `EmptyState` | typed `AppError` → copy + actions; skeletons sized to content; error boundary per route |
| `TargetText` | sets `lang`/`dir` from LanguagePack; optional reading/furigana |
| `AudioButton` | SpeechService; announces playing state; min 44px |
| `ProgressBar`, `ProgressRing` | `role=progressbar` with values |
| `Eyebrow`, `SectionLabel`, `Prose` | type-scale bound; one component replaces ~20 ad-hoc uppercase labels |
| `Tabs`, `Menu`, `Tooltip` | WAI-ARIA patterns, keyboard complete |
| `CoachDrawer`, `LanguageSwitcher`, `LookUp` (command dialog) | shell-level features |

- **Styling:** CSS Modules plus token variables. No inline style objects in new code. Legacy inline styles are removed screen by screen.
- **Icons:** `lucide-react` (tree-shaken, pinned), replacing DOM-scanning `createIcons`.
- **i18n:** per-locale JSON dictionaries (`web/src/i18n/<locale>.json`) generated once from `UI_STRINGS`/`UI_EXT`/`UI_NAV*`. Typed keys; the missing-key check runs in CI. `<html lang>` follows the UI locale. All English literals and the persisted `tongue_last` labels go away.

### 11.4 Keyboard and focus

- Route change moves focus to the page `<h1>`.
- Global shortcuts: `/` opens Look up, `Esc` closes the top dialog/drawer.
- Session shortcuts: `Enter` checks/continues, `1-4` chooses an option, `Space` replays audio. All discoverable via a `?` help dialog.
- Visible focus ring on every interactive element.
- Automated axe checks in E2E; zero serious violations is a phase exit criterion.

---

## 12. Navigation model

### 12.1 Areas

| Area | Purpose | Sections |
|---|---|---|
| **TODAY** | "What should I do next?" | primary action, review due, progress, streak, Ask Coach, one discovery |
| **LEARN** | the journey | Journey (stages → units → lessons), Lesson session, Outcomes (can-do checklist), Placement |
| **PRACTICE** | keep what you learned | Review session, Flashcards (deck), Quick Drills, Pronunciation, Mistakes |
| **COACH** | AI-assisted help, clearly labelled | Ask, Conversation, Analyze text, Correct my writing |
| **LIBRARY** | reference, browsable | Grammar, Vocabulary, Sentence Patterns, Dialogues, Quick Reference, Sounds, Culture, My Words |

**Global (shell header):** language switcher, Look up (`/`), account menu (Settings, Plan, Help, Sign out).

### 12.2 Where every existing feature lands

| Existing (index.html) | Fate | Target |
|---|---|---|
| `explore` → ExploreHome (5444) | replace | TODAY |
| WordOfDay (5411) | move | TODAY discovery; uses vocabulary content with ID |
| Home facts (`LANGS_DATA.facts`) | move to content | TODAY discovery / LIBRARY › Culture |
| `learn` → LearnPath (6249), LessonView (6207), Vocab/Grammar/DialogueLesson | replace | LEARN › Journey, lesson sessions (Lesson Engine) |
| `roadmap` → Roadmap (4513) | merge | LEARN › Outcomes (checkbox state migrated) |
| NewOnboarding (6540) | refactor | `/app/welcome` + LEARN › Placement |
| `review` → ReviewScreen (6481) | replace | PRACTICE › Review |
| `cards` → Flashcards (5062) | refactor | PRACTICE › Flashcards (deck) + review session |
| `drills` → Drills (4379) | replace | PRACTICE › Quick Drills (graded) |
| `sounds` → SoundsScreen (6369) | split | LIBRARY › Sounds (reference) + PRACTICE › Pronunciation |
| `coach` → AICoach (3297): `word` | fold | COACH › Ask ("Teach me a word" starter) |
| AICoach `fill`, `quiz` (AI-generated) | replace | PRACTICE (deterministic exercises from content) |
| AICoach `trans`, `write`, `opinion` | move | COACH › Correct my writing (`coach.review_writing`) |
| AICoach `convo` | merge | COACH › Conversation |
| `voice-tutor` → Conversation (7153) | keep engine, new UI | COACH › Conversation |
| `analyzer` → TextAnalyzer (7474) | replace | COACH › Analyze text (workspace) |
| `wordspace` → WordSpace (4855) | replace | shell Look up (explicit submit) + LIBRARY › My Words (saved) |
| `grammar` / `grammar-full` → Grammar/AITabContent (4253, duplicate branches 8250/8253) | merge | LIBRARY › Grammar (item pages deep-linkable) |
| `vocab-full` → Vocab (4372) + genMoreWords | refactor | LIBRARY › Vocabulary. "Generate more words" becomes an admin content-draft tool, not learner-facing ephemeral AI output. |
| `structures` → Structures (4261) | move | LIBRARY › Sentence Patterns |
| `dialogues` → Dialogues (4449) | merge renderer | LIBRARY › Dialogues (with breakdown, like lessons) |
| `today` → TodaysPractice (7107) + CheatSheet | split | weekday table **removed** (replaced by Planner); CheatSheet → LIBRARY › Quick Reference |
| `culture` → CultureScreen (6397) | move | LIBRARY › Culture (`culture.expand` AI labelled) |
| SentenceExplorer / ExampleLine (5989-6151) | refactor | Sentence Breakdown system (everywhere) |
| ReportError (3841) | keep | on every Library item and lesson block ("Report a problem") |
| SettingsOverlay (6706) | refactor | `/app/settings` (account, **billing portal and delete account restored** from dead SettingsPanel, explanations language ×12, theme, voice) |
| VoicePanel (4737) | refactor | `/app/settings/voice` (persisted per-language voice) |
| LangSwitchOverlay (6679) | refactor | shell LanguageSwitcher (Dialog) |
| UpgradeOverlay (6764) | refactor | `/app/upgrade` + Dialog; copy from the plan definition |
| Free / expiry / renewed banners (8215-8231) | refactor | shell notice region driven by entitlements |
| SupportChat (8384) | refactor | account menu › Help (`support.answer`, honest errors) |
| AccessCodeLogin (3049) | refactor | `/app/signin` (magic link, Google, code) |
| TopBar (7722), ExploreHome dock | replace | AppShell navigation (one NAV config) |
| ConceptScreen, VocabThemesScreen, VocabWordsScreen, PhrasesScreen, GrammarScreen | **delete** | fabricated / placeholder data; no reachable path |
| DesktopNav, OnboardingModal, HowToUseModal, ShareCardModal, SettingsPanel (after restoring its two features), VocabCard, ConjTable, Row, lpKindMark | **delete** | never rendered |
| Capacitor bootstrap (231-300), `__registerPushToken` | **delete** | no Capacitor shell exists |

---

## 13. URL routing, deep links, back button

### 13.1 Route table (`web/src/app/routes.ts`, typed)

```
/app                                   → redirect: signed-in → /app/:targetLang/today ; else /app/signin
/app/signin   /app/welcome             → auth, onboarding (magic link keeps ?magic=, then replaceState)
/app/:lang/today
/app/:lang/learn
/app/:lang/learn/outcomes
/app/:lang/learn/lesson/:lessonId               (?step=b09 resumes a block)
/app/:lang/practice
/app/:lang/practice/review
/app/:lang/practice/flashcards   /app/:lang/practice/flashcards/new
/app/:lang/practice/drills       /app/:lang/practice/pronunciation   /app/:lang/practice/mistakes
/app/:lang/coach                 /app/:lang/coach/conversation/:scenarioId?
/app/:lang/coach/analyze/:analysisId?          /app/:lang/coach/write
/app/:lang/library
/app/:lang/library/grammar/:itemId?   /app/:lang/library/vocabulary/:categoryId?
/app/:lang/library/patterns/:itemId?  /app/:lang/library/dialogues/:itemId?
/app/:lang/library/reference   /app/:lang/library/sounds   /app/:lang/library/culture   /app/:lang/library/my-words
/app/settings  /app/settings/voice  /app/settings/account  /app/upgrade
```

### 13.2 Behaviour

- **Router.** React Router (library mode) over the History API with a typed wrapper (`routes.ts` → `href()` helpers). Language is a path segment so deep links are unambiguous and shareable.
- **Server.** `app.get(["/app", "/app/*"])` returns the built `index.html` with `Cache-Control: no-cache`. Unknown `:lang` → registry check → redirect.
- **Back.**
  - The in-app back control calls `history.back()` when the previous entry belongs to the app (tracked via `history.state.idx`). Otherwise it navigates to the route-tree parent. Browser and Android Back share the same path (fixes L4).
  - Session pages confirm before leaving only if an answer is typed but not yet checked. Progress is already persisted per block, so there is no data-loss prompt.
- **Scroll restoration** per history entry. Scroll position is kept for Library lists.
- **Language switch** navigates to the same route under the new language when valid, otherwise to `/app/:lang/today`. No `setStack([])` wipe.
- **Deep link sources:**
  - push notifications carry `data.url` (replacing `[data-tab="0"]`)
  - emails link to `/app/:lang/practice/review`
  - SEO `/learn-french` CTA → `/app/fr/learn`
  - checkout `success_url` → `/app/upgrade?checkout=success`
- **Legacy compatibility:** `/app?checkout=success` and `/app?magic=` keep working. The `tongue_last` value is read once and ignored afterwards.

---

## 14. Build and module strategy (leaving the in-browser Babel file)

### 14.1 Recommendation: Vite + React 18 + TypeScript (strict) + Zod, npm workspaces-free layout

**Rationale:**

- Removes the 3.1 MB Babel download and 0.4-0.8 s main-thread compile.
- Hashed immutable assets.
- Dev server with HMR.
- First-class TypeScript and CSS Modules.
- Code splitting per area (Coach, Analyze and Library chunks load on demand).
- Self-hosted pinned React and lucide, so SRI is not needed and a real CSP becomes possible.

esbuild alone lacks the dev server and HTML pipeline. Next.js adds a server runtime the Express app does not need. Keeping React 18 avoids a framework migration on top of an architecture migration.

**Layout** (server files stay at the root in early phases to avoid churn):

```
design/tokens.json            → generated tokens (css/ts/swift/kt)
shared/                       → TypeScript: languages, content schema, curriculum, lesson blocks, evaluation,
                                srs, planner, learner events, segmentation, fixtures (golden vectors)
                                built to shared/dist (CJS for server, ESM for web) with tsup
web/                          → Vite app: index.html, src/{app,ui,features/{today,learn,practice,coach,library,settings,auth},
                                core (client services: api, outbox, speech, breakdown), i18n, legacy/}
content/ curriculum/ annotations/ lexicon/   → canonical reviewed data (validated in CI)
server/migrations/ server/ai/  → new server modules (existing routes/ remain, gradually typed with // @ts-check + JSDoc from shared types)
tests/{unit,contract,integration,e2e}
```

### 14.2 Transition without behaviour change

1. **Extract (parity).**
   - Move lines 315-8503 verbatim into `web/src/legacy/LegacyApp.jsx` and the `<style>` block into `legacy.css`.
   - Import React/ReactDOM 18.3.1 (the version unpkg currently resolves) and lucide 0.454.0 from npm. A shim assigns `window.lucide` for the existing `Icon`.
   - Delete the Babel script tag.
   - Output: `web/dist/`.
2. **Dual-serve flag.**
   - `WEB_CLIENT=vite|legacy` in `app.js` selects `web/dist/index.html` or the untouched `public/index.html`, kept for two releases.
   - Rollback = `fly secrets set WEB_CLIENT=legacy` (machine restart), or redeploy the previous image with `fly deploy --image`.
3. **Parity gate.** A Playwright suite runs the same script against both clients (local server + test DB + fake AI):
   - every one of the 22 view branches reached
   - text snapshots equal
   - screenshots at 375 and 1440 within tolerance
   - no new console errors
4. **Strangle.** New shell and routes wrap `LegacyApp` views as route elements (`/app/:lang/legacy/:view`) while areas are rebuilt. Each rebuilt area removes its legacy branch. The `legacy/` folder must be empty at the end of P13.

### 14.3 Serving, caching, versioning

- `/assets/*` → `express.static(web/dist/assets, { immutable: true, maxAge: "1y" })`.
- `/app*` HTML → `no-cache`. `<meta name="tongue-build" content="<gitsha>">`. `GET /api/version` → `{build, minClientBuild}`.
- The client checks the version on `visibilitychange` and every 30 minutes. When newer, it shows a non-blocking "Update available" toast. It reloads automatically only on route change outside a session, never mid-lesson. `minClientBuild` forces a reload for breaking API changes.
- **Service worker.**
  - Cache name derived from the build ID.
  - Precache only hashed assets.
  - Navigations network-first.
  - No CDN caching; there are no CDN scripts left.
  - A shipped kill-switch (`/sw.js` that unregisters itself) is available as rollback.
- **CSP**, enabled in Report-Only first, then enforced:

  ```
  default-src 'self'
  script-src 'self' https://accounts.google.com/gsi/client
  style-src 'self' https://fonts.googleapis.com
  font-src https://fonts.gstatic.com
  connect-src 'self'
  frame-src https://accounts.google.com
  img-src 'self' data:
  ```

  React's `style` property writes are CSSOM and not blocked.

### 14.4 Tooling and scripts

- **Tools:** `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `playwright`, `@axe-core/playwright`, `eslint` (typescript-eslint, react-hooks, jsx-a11y, custom no-lang-branch and no-raw-color rules), `stylelint`, `prettier`, `zod`, `tsup`. All versions pinned in `package-lock.json`.
- **Scripts:**
  - `dev`: server + Vite with `/api` proxy
  - `build`: tokens → shared → web
  - `typecheck`, `lint`
  - `test:unit`, `test:contract`, `test:integration` (needs `TEST_DATABASE_URL`), `test:e2e`
  - `validate:content`, `migrate`

### 14.5 Docker and Fly

```dockerfile
# build stage
FROM node:20.20.2-alpine AS build          # pin exact version (observed); pin digest at implementation
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run validate:content && npm run test:unit

# runtime stage
FROM node:20.20.2-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/content ./content
COPY --from=build /app/curriculum ./curriculum
COPY --from=build /app/annotations ./annotations
COPY --from=build /app/lexicon ./lexicon
COPY server.js app.js db.js ./
COPY routes ./routes
COPY utils ./utils
COPY server ./server
COPY public ./public
USER node
EXPOSE 3001
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
```

```toml
# fly.toml additions
[deploy]
  release_command = "node server/migrate.js"   # applies versioned migrations + loads canonical content; non-zero exit aborts deploy
  strategy = "rolling"

[[http_service.checks]]
  grace_period = "15s"
  interval     = "15s"
  timeout      = "5s"
  method       = "GET"
  path         = "/health"
```

- **Cron:** each job runs under `pg_try_advisory_lock(<job-id>)` so a second machine is safe.
- `.dockerignore` additionally excludes `tests/`, `docs/`, `.claude/`, `native/` (already), and the legacy Railway/Nixpacks files.

---

## 15. Server architecture changes (supporting the core)

- **Errors:** an `asyncHandler` wrapper (or Express 5 after tests exist); a final error middleware returning `{code, message}` JSON; `process.on("unhandledRejection")` logs with request context. It does not exit silently.
- **Validation:** Zod at every route boundary (fixes `{"email":1}` crashes).
- **Identity and entitlement** (details decision-gated, see the migration plan):
  - `requireAuth` loads account status (cached 60s)
  - one `getEntitlements(userId)` used by Coach quotas, plan copy and the upgrade UI
  - `trust proxy` set for Fly
  - atomic limiters
- **Stripe:** process inside a transaction, *then* insert `stripe_events`; 5xx on failure so Stripe retries; authenticated portal.
- **Observability:**
  - structured JSON logs with request IDs
  - AI gateway metrics (latency, error codes, cost)
  - `learning_events` ingestion counts
  - an admin "system health" page (AI status, content versions, migration version, build ID)

---

## 16. Native apps in this architecture

- **Today:** unshipped scaffolds pointing at a stale host, with a French gate, a divergent SRS, prompt copies and undeliverable iOS push (forensics §1.4, B12, D3, D5).
- **Architecture position:** thin clients over Tongue Core APIs and nothing else.
  - `GET /api/languages` (registry, replaces static lists)
  - content, curriculum and lessons as **block JSON** (same schema; native renderers per block type)
  - learner APIs (events, cards, reviews, import)
  - AI features by ID (no client prompts)
  - evaluation and SRS behaviour pinned by `shared/fixtures` golden vectors run in XCTest/JUnit
  - server-authoritative review scheduling
- **Required before any release:** `tongue-app.fly.dev` base URL from build config, French gate removed, magic-link/Google sign-in, **in-app account deletion** (App Store guideline 5.1.1(v)), push via FCM on both platforms (Firebase iOS SDK) or an APNs sender.
- **Recommendation:** freeze native feature work until P4 (sync APIs) ships. Then choose between (a) native thin clients as above, or (b) a PWA / single wrapped web app, which has the least duplication. This choice is reversible (code stays in git) and does not affect users, because nothing is shipped.

---

## 17. Testing strategy (never touches the production database)

### 17.1 Hard guard

```ts
// tests/support/assertTestDatabase.ts, imported first by every DB-using test and by server/migrate.js when NODE_ENV=test
export function assertTestDatabase(url = process.env.TEST_DATABASE_URL) {
  if (process.env.NODE_ENV !== "test") throw new Error("Refusing: NODE_ENV must be 'test'");
  if (!url) throw new Error("Refusing: TEST_DATABASE_URL is required (DATABASE_URL is ignored in tests)");
  const u = new URL(url);
  const localHost = ["localhost", "127.0.0.1", "postgres"].includes(u.hostname);
  const testName = u.pathname.slice(1).endsWith("_test");
  if (!localHost || !testName) throw new Error(`Refusing to run tests against ${u.hostname}${u.pathname}`);
}
```

- Tests **never** call `require("dotenv").config()`. They load `.env.test` explicitly, which contains no production values, and `db.js` in test mode reads only `TEST_DATABASE_URL`.
- The destructive helpers (`truncateAll`) exist only under `tests/support`, and each first asserts the guard.
- **CI:** a Postgres 16 service container named `postgres`, database `tongue_test`. Local: `docker compose -f tests/compose.yml up`.

### 17.2 Layers

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | SM-2 vectors, evaluation/normalization vectors, planner, curriculum compiler, derivation rules (incl. source guard), segmentation, route table, token contrast checks |
| Contract | Vitest + Zod | canonical content and seeds per schema version; registry; lessons compile; API response fixtures (also consumed by native); i18n key parity |
| Integration | node:test/Vitest + supertest on `app.js` with the test DB | auth flows (incl. B2/B3 regressions), Stripe webhook with signed fixtures (ordering, transaction, retry), learner events idempotency, import merge rules, review queue, entitlements, AI gateway with `FakeAiGateway` (credits/timeout/bad output), migrations up on an empty DB and on a baseline-schema DB |
| Component | Vitest + Testing Library | primitives' a11y contracts (Dialog focus trap, IconButton label), every block renderer (keyboard, results) |
| E2E | Playwright against local server + test DB + fake AI | flows below × viewports 375/768/1440/2000 × light/dark; axe |
| Production verification | read-only synthetic check after deploy | `GET /health`, `GET /api/version`, `GET /app` 200 + build meta; no writes |

### 17.3 E2E flows (each tied to Definition of Done)

1. Sign-in (magic link via captured email) → onboarding placement → Today shows one primary action.
2. Complete the French present-tense lesson: wrong "suis" in the avoir-faim scaffold → mistake insight → correct → summary shows computed metrics → Continue.
3. Progress survives reload, navigation, and a **second browser context** (cross-device).
4. Legacy import: seed `localStorage` with fixture keys (cards, progress, streak, ws_saved) → consent → server snapshot counts match → legacy keys still present.
5. Review count equals the Flashcards due count; switch to Korean → only Korean cards.
6. Browser Back and deep links across all five areas; refresh keeps the route.
7. AI unavailable (fake credits error) → honest banner; lessons, review and library usable; no "check your connection".
8. Analyze: paste text → tokens → save word → appears in My Words and review.
9. Theme switch → no element with the brand hex outside the accent token (computed-style scan).
10. Keyboard-only lesson completion; axe: zero serious or critical violations.
11. Layout metrics: no horizontal overflow; prose ≤ 95 CPL; no text < 12px; tap targets ≥ 44px on compact.

---

## 18. Definition of Done: traceability

| DoD item | Architecture element |
|---|---|
| Coherent shell; same-product feel | §11 AppShell, tokens, primitives, templates |
| Languages via common architecture | §2 Registry/LanguagePack, capability modules, lint rule |
| Duplication removed or justified | §1 system map; D1-D19 mapped to single owners |
| Guided curriculum | §4 |
| Interactive lessons | §5 Lesson Engine |
| French content through the generic engine | §5.6 (same derivation rules apply to all 12) |
| Today prioritises next step | §10 Planner |
| Analyze is a real workspace | §8 |
| Simpler navigation | §12 (5 areas, every feature placed) |
| Progress survives navigation | §9 Learner Model + §13 routing + E2E 3 |
| No silently lost functionality | §12.2 landing table (billing and account deletion restored) |
| Major flows manually verified; tests pass | §17 |
| No fake or placeholder behaviour | §0 principle 2, §3.5 deletions, §9.4 measurable table |
| No unexplained console errors | E2E console assertions; AI gateway error contract |
| No broken responsive layouts | §11.2 breakpoints, E2E 11 |
| Changes documented | these documents + `CHANGELOG.md` per phase + regenerated `SCHEMA.md` |
