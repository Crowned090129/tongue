/**
 * routes/content.js
 *
 * Server-side content cache for reference tabs (Grammar, CheatSheet, Structures, Vocab, Dialogues).
 * Content is generated ONCE per language, validated, stored in PostgreSQL, and served to ALL users
 * instantly — no per-user API calls for reference material.
 *
 * Generation pipeline:
 *   1. Call Claude with a carefully scoped prompt
 *   2. Parse JSON response
 *   3. Validate structure + content quality (non-Latin script check, field counts)
 *   4. If validation fails → retry up to 3 times total
 *   5. Store only if valid
 *
 * Generation is triggered:
 *   A. Automatically at server startup for any missing content (background, non-blocking)
 *   B. On first authenticated GET if somehow still missing after startup
 *   C. Admin-only POST /api/content/regenerate/:lang or /api/content/regenerate/:lang/:tab
 *
 * Users CANNOT trigger regeneration — they always get the cached, validated version.
 */

const express = require("express");
const db      = require("../db");
const { requireAuth }  = require("./auth");
const { requireAdmin } = require("./admin");

const router = express.Router();

// ── Language metadata ─────────────────────────────────────────────────────────
const LANG_NAMES = {
  es: "Spanish", de: "German",  en: "English",  pt: "Portuguese",
  it: "Italian", zh: "Chinese (Mandarin)", ja: "Japanese",
  ko: "Korean",  ru: "Russian", ar: "Arabic",   hi: "Hindi",
};

const VALID_LANGS = Object.keys(LANG_NAMES);
const VALID_TABS  = ["grammar", "cheatsheet", "structures", "vocab", "dialogues"];

// Unicode range helpers for script validation
const HAS_CHINESE   = s => /[一-鿿㐀-䶿]/.test(s);
const HAS_JAPANESE  = s => /[぀-ゟ゠-ヿ一-鿿]/.test(s);
const HAS_KOREAN    = s => /[가-힯ᄀ-ᇿ]/.test(s);
const HAS_CYRILLIC  = s => /[Ѐ-ӿ]/.test(s);
const HAS_ARABIC     = s => /[؀-ۿݐ-ݿ]/.test(s);
const HAS_DEVANAGARI = s => /[ऀ-ॿ]/.test(s);

const SCRIPT_CHECK = { zh: HAS_CHINESE, ja: HAS_JAPANESE, ko: HAS_KOREAN, ru: HAS_CYRILLIC, ar: HAS_ARABIC, hi: HAS_DEVANAGARI };

// ── Language-specific topic lists ────────────────────────────────────────────
// Explicit lists tell Claude exactly what to cover in what order.
// This prevents hallucination and ensures the highest-value topics are always present.

const GRAMMAR_TOPICS = {
  es: [
    "Present tense: regular -ar/-er/-ir verbs (all 6 persons: yo/tú/él/nosotros/vosotros/ellos)",
    "Ser vs Estar: two verbs for 'to be' — permanent identity (ser) vs temporary state/location (estar)",
    "Preterite tense: completed past actions — regular forms + key irregulars (ser/ir/hacer/tener/estar)",
    "Imperfect tense: habitual or ongoing past — era/estaba/había patterns and when to use vs preterite",
    "Reflexive verbs: me/te/se/nos/os/se + verb — levantarse, llamarse, sentirse and placement rules",
    "Object pronouns: direct (lo/la/los/las) and indirect (le/les) — position before conjugated verb",
    "Present subjunctive: formation and use after querer que, esperar que, ojalá, cuando + future",
    "Future tense: regular (add -é/-ás/-á/-emos/-éis/-án to infinitive) + irregular stems (tener→tendr-)",
  ],
  pt: [
    "Present tense: -ar/-er/-ir verbs (all 6 persons) — key differences from Spanish endings",
    "Ser vs Estar vs Ficar: three verbs for states — ser (identity), estar (temporary), ficar (become/stay)",
    "Pretérito Perfeito: completed past — regular forms + key irregulars (ser/ir/ter/fazer/poder)",
    "Personal Infinitive: unique to Portuguese — inflected infinitive with person endings (falar/falares/falar/falarmos/falardes/falarem)",
    "Contractions: em+o=no, de+o=do, a+o=ao, em+a=na, de+a=da, por+o=pelo — mandatory in written Portuguese",
    "Future with ir+infinitive: vou falar, vai comer, vamos partir — the main way to express near future",
    "Object pronouns: me/te/o/a/lhe + clitic placement rules (before verb in Brazil, after in Portugal)",
    "Diminutives: -inho/-inha suffix — cafezinho, beijinho, obrigadinho — very common in Brazilian Portuguese",
  ],
  it: [
    "Present tense: -are/-ere/-ire verbs (all 6 persons) + essere and avere conjugation",
    "Passato Prossimo: main past tense — essere or avere auxiliary + participio passato (-ato/-uto/-ito)",
    "Essere vs Avere as auxiliary: verbs of motion/state take essere (sono andato); transitive verbs take avere (ho mangiato)",
    "Imperfetto: habitual or ongoing past — ero/avevo/facevo — when to use vs Passato Prossimo",
    "Reflexive verbs: mi/ti/si/ci/vi/si + verb — lavarsi, svegliarsi, divertirsi and agreement in Passato Prossimo",
    "Ci and Ne: ci = there/it (c'è, ci sono, andarci); ne = of it/some (ne voglio due, ne parla sempre)",
    "Formal address: Lei (not tu) + 3rd person singular verb — used in professional/polite contexts",
    "Congiuntivo Presente: after penso che, spero che, è importante che — formation of all conjugation types",
  ],
  de: [
    "Grammatical gender: der (masculine) / die (feminine) / das (neuter) — must learn with each noun, not predictable",
    "Nominative case: subject of sentence — der/die/das/die, ein/eine/ein/— articles; adjective endings",
    "Accusative case: direct object — den/die/das/die (masculine changes to den), einen/eine/ein; prepositions: durch/für/gegen/ohne/um",
    "Dative case: indirect object — dem/der/dem/den (nouns add -n in plural), einem/einer/einem; prepositions: aus/bei/mit/nach/seit/von/zu/gegenüber",
    "Present tense: regular -en verbs all 6 persons + stem-vowel changes (fahren→fährst, lesen→liest) + sein/haben/werden",
    "Perfekt: past tense in speech — haben/sein auxiliary + Partizip II (ge-+stem+-t for regular, ge-+stem+-en for strong verbs)",
    "Modal verbs: können/müssen/wollen/sollen/dürfen/mögen — conjugation + infinitive goes to END of sentence",
    "Separable verbs: anrufen/aufstehen/mitkommen/zurückgehen — prefix separates in main clause (Ich rufe dich an)",
  ],
  en: [
    "Present Simple vs Present Continuous: I work (habit/fact) vs I am working (now/temporary) — usage rules and state verbs that never use continuous",
    "Past Simple vs Present Perfect: I went (specific past time) vs I have gone (connection to present, unspecified time) — with since/for/just/already/yet",
    "Future: will (spontaneous/prediction) vs going to (plan/evidence) vs Present Continuous for arrangements",
    "Modal verbs: can/could (ability/possibility), must/have to (obligation), should (advice), might/may (possibility), would (conditional/polite)",
    "First and Second Conditional: If + present simple + will (real possibility) vs If + past simple + would (unreal/hypothetical)",
    "Articles: a/an (first mention, non-specific) vs the (known/unique/second mention) vs no article (plural generics, proper nouns, abstract nouns)",
    "Prepositions of time: at (clock times/holidays), in (months/years/seasons/parts of day), on (days/dates) — no logic, must be memorized",
    "Phrasal verbs: give up/look after/carry on/find out/put off — meaning is unpredictable from parts; most common 20 examples",
  ],
  zh: [
    "No verb conjugation: Mandarin verbs never change form — time is shown by time words (昨天/明天) and aspect markers, not verb endings",
    "Measure words (量词): one classifier for every noun — 一本书 (yī běn shū), 三个人 (sān gè rén), 两条鱼 (liǎng tiáo yú) — 个 is the default",
    "Aspect marker 了 (le): marks completed action or change of state — 我吃了 (I ate) vs 我吃 (I eat) — NOT a past tense marker",
    "Aspect markers 过 and 着: 过 = prior experience (我去过北京 I've been to Beijing), 着 = ongoing state (他睡着了 He fell asleep)",
    "Sentence time word order: Subject + Time + Place + Verb + Object — 我今天在家吃饭 (I today at home eat rice)",
    "把 construction: Subject + 把 + Object + Verb + Result — moves object before verb to emphasize result/disposal (把书放在桌子上)",
    "Comparison with 比: A + 比 + B + adjective — 他比我高 (He is taller than me) vs 没有 for negative comparison",
    "Question formation: add 吗 for yes/no (你去吗?), use question words 什么/哪里/谁/怎么/为什么/几 in normal word order",
  ],
  ja: [
    "Sentence order SOV: Subject + Object + Verb — verb ALWAYS at end — 私はりんごを食べます (I apple eat)",
    "Topic は vs Subject が: は (wa) marks topic/contrast (私は学生です), が (ga) marks new subject/exclusive focus (誰が来ましたか)",
    "Essential particles: を (wo) direct object, に (ni) direction/time/location for existence, で (de) location of action/means, と (to) together with",
    "Verb forms: dictionary form → ます form (polite present/future) → て form (te-form, linking) → た form (plain past) — regular and irregular (する/くる)",
    "い-adjectives vs な-adjectives: い-adj conjugate (暑い→暑くない→暑かった); な-adj use です/じゃない (静か→静かじゃない→静かでした)",
    "て form + います: ongoing action (食べています = is eating) vs habitual/resulting state (住んでいます = lives, 知っています = knows)",
    "Potential form: verb stem + られます (ichidan) or stem change + えます (godan) — 食べられます (can eat), 行けます (can go)",
    "Politeness levels: ます/です form (polite, default) vs plain/dictionary form (casual with friends) — context determines which to use",
  ],
  ko: [
    "Sentence order SOV + predicate always last: Subject + Object + Verb/Adjective — 나는 사과를 먹어요 (I apple eat)",
    "Topic particle 은/는 vs subject particle 이/가: 은/는 marks topic or contrast; 이/가 marks new subject or emphasis — subtle but important distinction",
    "Object particle 을/를 and location particles 에/에서: 을/를 = direct object; 에 = static location/direction/time; 에서 = location of action or 'from'",
    "Polite verb endings: -아/어요 (informal polite, everyday speech) vs -습니다/ㅂ니다 (formal polite, presentations/news) — same meaning, different formality",
    "Tenses: past (-았/었어요: 먹었어요 ate), present/habitual (-아/어요: 먹어요 eat/eats), future intention (-(으)ㄹ 거예요: 먹을 거예요 will eat)",
    "Negation: 안 + verb (안 먹어요 don't eat) or verb stem + 지 않아요 (먹지 않아요) — both mean the same, 지 않아요 is more formal",
    "Descriptive verbs (형용사): adjectives conjugate like verbs — 크다 (to be big), 작아요 (is small) — no separate 'to be' for adjectives",
    "Honorific -시-: inserted into verb when subject is senior/respected — 선생님이 오세요 (The teacher is coming) vs 친구가 와요 (Friend is coming)",
  ],
  ru: [
    "Nominative case: subject of sentence — Я читаю (I read), Кот спит (The cat sleeps) — no article in Russian",
    "Accusative case: direct object — Я вижу тебя (I see you), Он читает книгу (He reads the book) — masculine animate nouns change ending",
    "Genitive case: possession, absence, quantity — нет воды (no water), у меня есть (I have), стакан чая (glass of tea), после урока (after class)",
    "Dative case: to/for someone — Я дал ей цветы (I gave her flowers), Мне нравится (I like it, lit. 'to me it is pleasing')",
    "Instrumental case: by/with/using — Я пишу ручкой (I write with a pen), Он работает врачом (He works as a doctor), с другом (with a friend)",
    "Prepositional case: location with в/на — Я живу в Москве (I live in Moscow), Книга на столе (The book is on the table)",
    "Verb aspects: imperfective (process/habit/repeated) vs perfective (completed single action) — читать/прочитать, писать/написать — must learn both forms",
    "Present tense conjugation: 1st conjugation читать→читаю/читаешь/читает/читаем/читаете/читают; 2nd conj говорить→говорю/говоришь/говорит; быть (to be) is absent in present tense",
  ],
  ar: [
    "The definite article ال (al-): attaches directly to noun (الكتاب = the book); sun letters (ت ث د ذ ر ز س ش ص ض ط ظ ل ن) assimilate the lam (الشمس → ash-shams)",
    "Grammatical gender: every noun is masculine or feminine — ة (taa marbuta) usually marks feminine (طالبة = female student); adjectives must agree in gender",
    "Dual form: special suffix for exactly two — كتابان (two books), طالبتان (two female students) — used for people, things, time expressions",
    "Past tense (الماضي): based on root pattern فَعَلَ — كَتَبَ (he wrote), كَتَبَت (she wrote), كَتَبتُ (I wrote), كَتَبنا (we wrote) — all 13 persons",
    "Present tense (المضارع): يَفعَلُ pattern — يَكتُبُ (he writes), تَكتُبُ (she writes), أَكتُبُ (I write), نَكتُبُ (we write) — imperfect/ongoing",
    "Broken plurals (جمع التكسير): irregular plurals that change the word pattern — كِتاب → كُتُب (book→books), بَيت → بُيوت (house→houses) — must learn individually",
    "Sentence structure: nominal sentences (الجملة الاسمية) have no 'is/are' — المعلم كبير = the teacher [is] big; verbal sentences begin with verb (VSO order)",
    "Root system (الجذر الثلاثي): three-letter roots carry core meaning — ك-ت-ب (writing): كَتَبَ (he wrote), كِتاب (book), كاتِب (writer), مَكتَبة (library), مَكتَب (desk/office)",
  ],
  hi: [
    "SOV sentence order: Subject + Object + Verb — मैं हिंदी सीखता हूँ (Main Hindī sīkhtā hūn = I Hindi learn) — verb always comes last",
    "Grammatical gender: every noun is masculine or feminine — लड़का (ladkā, boy, m.) vs लड़की (ladkī, girl, f.) — adjectives and verbs must agree in gender",
    "Verb agreement with subject gender: present tense verb changes — वह जाता है (vah jātā hai, he goes) vs वह जाती है (vah jātī hai, she goes)",
    "Present tense with है/हैं: verb stem + ता/ती/ते + है/हो/हूँ/हैं — मैं खाता हूँ (I eat, m.), वे जाते हैं (they go, m. pl.)",
    "Past tense with था/थी/थे: verb + ā/ī/e suffix + था/थी for habitual past — मैं खाता था (I used to eat, m.) — and perfective past with ने construction",
    "Postpositions (not prepositions): markers come AFTER the noun — घर में (ghar meṃ = in the house), स्कूल से (skūl se = from school), मेरे लिए (mere lie = for me)",
    "को (ko) postposition: marks indirect objects and certain direct objects — मुझे हिंदी पसंद है (mujhe Hindī pasand hai = I like Hindi, lit. 'to-me Hindi pleasing is')",
    "Infinitive + चाहिए/सकना/पड़ना: obligation and ability — मुझे जाना है (I have to go), वह बोल सकता है (he can speak), मुझे पानी चाहिए (I need water)",
  ],
};

const CHEATSHEET_GROUPS = {
  es: ["Greetings & Farewells (12 phrases)", "Numbers 1–20 (20 items)", "Days & Months (19 items)", "Essential Verbs: ser/estar/tener/ir/hacer/poder/querer/saber/venir/decir (10 verbs, conjugated in yo/tú/él)", "Question Words & Common Connectors (12 items)", "Survival Phrases: ordering, directions, emergencies (15 phrases)"],
  pt: ["Greetings & Farewells (12 phrases)", "Numbers 1–20 (20 items)", "Days & Months (19 items)", "Essential Verbs: ser/estar/ter/ir/fazer/poder/querer/saber/vir/dizer (10 verbs, yo/tu/ele form)", "Question Words & Connectors (12 items)", "Survival Phrases: restaurant, transport, help (15 phrases)"],
  it: ["Greetings & Farewells (12 phrases)", "Numbers 1–20 (20 items)", "Days & Months (19 items)", "Essential Verbs: essere/avere/fare/andare/potere/volere/sapere/venire/dire/stare (10 verbs, io/tu/lui form)", "Question Words & Connectors (12 items)", "Survival Phrases: café, shopping, getting around (15 phrases)"],
  de: ["Greetings & Farewells (12 phrases)", "Numbers 1–20 (20 items)", "Days & Months (19 items)", "Essential Verbs: sein/haben/machen/gehen/können/wollen/müssen/wissen/kommen/sagen (10 verbs, ich/du/er form)", "Question Words & Connectors (12 items)", "Survival Phrases: shopping, transport, asking for help (15 phrases)"],
  en: ["Greetings & Social Phrases (12 phrases)", "Numbers 1–20 (20 items)", "Days, Months & Time Expressions (19 items)", "Essential Verbs: be/have/do/go/get/make/know/think/come/say (10 verbs, I/you/he form)", "Question Words & Common Connectors (12 items)", "Survival Phrases: formal requests, phone, email (15 phrases)"],
  zh: ["Greetings & Polite Phrases (12 phrases with pinyin)", "Numbers 1–20 plus 100/1000/10000 (23 items with pinyin)", "Days, Months & Time (19 items with pinyin)", "Essential Verbs: 是/有/在/去/来/做/说/要/可以/喜欢 (10 verbs with pinyin and tone marks)", "Question Words & Connectors (12 items with pinyin)", "Survival Phrases: ordering food, directions, shopping (15 phrases with pinyin)"],
  ja: ["Greetings & Polite Expressions (12 phrases with hiragana and romaji)", "Numbers 1–20 plus 100/1000/10000 (23 items with hiragana and romaji)", "Days, Months & Time Expressions (19 items with hiragana and romaji)", "Essential Verbs in ます form: います/あります/します/いきます/きます/たべます/のみます/みます/ききます/かいます (10 verbs)", "Question Words & Connectors (12 items with hiragana and romaji)", "Survival Phrases: restaurant, transport, asking for help (15 phrases)"],
  ko: ["Greetings & Polite Expressions (12 phrases with Hangul and romanization)", "Numbers: Native Korean 1–10 + Sino-Korean 1–10 + 20/30/100/1000 (24 items)", "Days, Months & Time Expressions (19 items with Hangul)", "Essential Verbs in -아/어요 form: 있어요/없어요/해요/가요/와요/먹어요/마셔요/봐요/들어요/사요 (10 verbs)", "Question Words & Connectors (12 items with Hangul)", "Survival Phrases: ordering, directions, polite requests (15 phrases)"],
  ru: ["Greetings & Polite Phrases (12 phrases with Cyrillic)", "Numbers 1–20 plus 100/1000 (22 items with Cyrillic)", "Days, Months & Time Expressions (19 items with Cyrillic)", "Essential Verbs: быть/иметь/делать/идти/мочь/хотеть/знать/говорить/думать/любить — present tense я/ты/он form", "Question Words & Connectors (12 items with Cyrillic)", "Survival Phrases: shopping, directions, emergencies (15 phrases with Cyrillic)"],
  ar: ["Greetings & Polite Phrases (12 phrases in Arabic script with transliteration)", "Numbers 1–20 in Arabic script and numerals (20 items)", "Days, Months & Time Expressions (19 items in Arabic script)", "Essential Verbs in past/present: ذهب/يذهب, أكل/يأكل, شرب/يشرب, قال/يقول, كتب/يكتب, عمل/يعمل, أراد/يريد, عرف/يعرف, جاء/يجيء, نام/ينام", "Question Words & Common Connectors (12 items in Arabic)", "Survival Phrases: greetings, ordering, directions (15 phrases in Arabic)"],
  hi: ["अभिवादन और विदाई (Greetings & Farewells — 12 phrases in Devanagari with transliteration)", "गिनती (Numbers 1–20 + 50/100/1000 in Devanagari with transliteration)", "दिन, महीने और समय (Days, Months & Time — 19 items in Devanagari)", "ज़रूरी क्रियाएँ (Essential Verbs): होना/करना/जाना/आना/खाना/पीना/देखना/बोलना/समझना/चाहना — present tense मैं/तुम/वह forms with transliteration", "प्रश्नवाचक शब्द (Question Words & Connectors — 12 items: क्या/कहाँ/कब/कौन/क्यों/कैसे etc.)", "उत्तरजीविता वाक्यांश (Survival Phrases — 15 phrases: restaurant, transport, help, numbers in Devanagari)"],
};

const STRUCTURE_TOPICS = {
  es: ["Subject + Verb + Object (SVO basic statement)", "Question with ¿...? (inversion optional, intonation often enough)", "Negation: no + verb (double negation: no...nada/nadie/nunca)", "Ir a + infinitive: near future (Voy a comer = I'm going to eat)", "Estar + gerundio: present progressive (Estoy comiendo = I am eating)", "Me gusta / Me gustan: expressing likes (indirect object + gustar)", "Hay: there is / there are (¿Hay + noun? for questions)", "Si + present, future: first conditional (Si tengo tiempo, voy al gym)"],
  pt: ["Subject + Verb + Object (SVO basic statement)", "Question formation: intonation or inversion (Você fala inglês? / Fala você inglês?)", "Negation: não before verb (Não falo japonês; não...nada/ninguém for double negation)", "Ir a + infinitive: near future (Vou falar = I'm going to speak)", "Estar + gerúndio: present progressive (Estou comendo = I am eating) — Brazil", "Gostar de: expressing likes (Gosto de música = I like music)", "Ter que + infinitive: obligation (Tenho que estudar = I have to study)", "Se + present, future: first conditional (Se tiver tempo, vou ao ginásio)"],
  it: ["Subject + Verb + Object (SVO, subject pronoun often dropped — pro-drop language)", "Question with rising intonation or inversion (Parli italiano? / Stai bene?)", "Negation: non before verb (Non mangio carne; non...niente/nessuno for double negation)", "Stare + gerundio: present progressive (Sto mangiando = I am eating)", "Dovere + infinitive: must/have to (Devo studiare = I must study)", "Mi piace / Mi piacciono: expressing likes (mi piace + singular, mi piacciono + plural)", "Ecco: here is/are, there you go (Ecco il conto! / Ecco a te!)", "Se + present, future: first conditional (Se ho tempo, vengo)"],
  de: ["Statement word order: Subject + Verb (position 2) + rest (Ich esse heute Pizza)", "Question: verb moves to position 1 (Isst du Pizza? / Was isst du?)", "Negation: nicht after verb/before adjective (Ich esse nicht. / Das ist nicht gut.)", "Kein/keine: negation of nouns (Ich habe kein Geld / keine Zeit)", "Modal + infinitive at end: Ich kann heute nicht kommen (modal verb 2nd, infinitive last)", "Separable verb: prefix at end (Ich rufe dich morgen an / Wann fährst du ab?)", "Weil/dass: subordinate clause — verb goes to END (Ich bleibe zu Hause, weil ich krank bin)", "Wenn + past tense, würde: second conditional (Wenn ich Zeit hätte, würde ich kommen)"],
  en: ["Affirmative: Subject + Verb + Object (I eat pizza every day)", "Question with do/does/did: Do you speak English? / Where does she live?", "Negation with don't/doesn't/didn't: I don't like coffee / She doesn't work here", "Present Perfect: Subject + have/has + past participle (I have visited Paris three times)", "Passive voice: Subject + be + past participle (The book was written in 1984)", "Reporting speech: She said (that) she was tired / He asked if I could help", "Purpose clause with to/in order to/so that: I study English to get a better job", "Concessive clause with although/even though/despite: Although it was raining, we went out"],
  zh: ["Basic SVO: Subject + Verb + Object (我喝茶. Wǒ hē chá. I drink tea.)", "Time-place before verb: Subject + Time + Place + Verb + Object (我今天在家工作)", "Question with 吗: statement + 吗? (你吃饭了吗? Did you eat?)", "Question with 呢: X + 呢? for 'what about X?' (我很好，你呢? I'm fine, and you?)", "了 for completed action: Verb + 了 (我吃了. I ate. / 他来了. He came.)", "想/要/可以 + verb: want to / need to / can (我想去北京. I want to go to Beijing.)", "比 comparison: A + 比 + B + Adj (苹果比橙子贵. Apples are more expensive than oranges.)", "是...的 emphasis: 是 + circumstance + 的 (他是昨天来的. It was yesterday that he came.)"],
  ja: ["Basic SOV: Topic + Object + Verb (私はすしが好きです. I like sushi.)", "Verb + ます: polite present/future (食べます = eat/will eat; 行きます = go/will go)", "Verb + ました: polite past (食べました = ate; 行きました = went)", "Verb + ません: polite negative (食べません = don't eat; 行きません = don't go)", "Noun + です: polite nominal sentence (これはりんごです. This is an apple.)", "Verb て-form + ください: polite request (ゆっくり話してください. Please speak slowly.)", "Verb て-form + います: ongoing action or habitual (今、食べています. I am eating now.)", "〜たいです: want to do (日本語を勉強したいです. I want to study Japanese.)"],
  ko: ["Basic SOV: Subject + Object + Predicate (나는 사과를 먹어요. I eat an apple.)", "Verb stem + 아/어요: polite present (먹어요 = eat, 가요 = go, 있어요 = there is/have)", "Verb stem + 았/었어요: past tense (먹었어요 = ate, 갔어요 = went, 했어요 = did)", "-(으)ㄹ 거예요: future intention (먹을 거예요 = will eat, 갈 거예요 = will go)", "이에요/예요: 'to be' with nouns (학생이에요 = am/is/are a student, 한국이에요 = is Korea)", "안 + verb / verb + 지 않아요: negation (안 먹어요 / 먹지 않아요 = don't eat)", "Noun + 이/가 있어요 (없어요): existence (시간이 있어요 = I have time, 돈이 없어요 = no money)", "-(으)세요: honorific request/statement (앉으세요 = please sit, 천천히 말씀해 주세요 = please speak slowly)"],
  ru: ["Simple sentence: Subject (Nominative) + Verb + Object (Accusative) — Я читаю книгу. I read a book.", "Question by intonation: same word order, rising intonation — Ты читаешь книгу? / Где ты живёшь?", "Negation: не before verb — Я не говорю по-русски. I don't speak Russian.", "У меня есть: 'I have' — У + genitive + есть + nominative (У меня есть кошка. I have a cat.)", "Нет + genitive: 'there is no' or negating possession — У меня нет кошки. / Нет времени.", "Я хочу/могу/должен + infinitive: want/can/must (Я хочу поехать в Москву.)", "В/На + Prepositional: location (Я живу в России. / Книга лежит на столе.)", "Если + present, future: first conditional (Если у меня будет время, я позвоню.)"],
  ar: ["Nominal sentence (الجملة الاسمية): Subject + Predicate, no verb 'to be' in present (الطقس جميل = The weather [is] beautiful)", "Verbal sentence (الجملة الفعلية): Verb + Subject + Object, VSO order (ذهب الولد إلى المدرسة = The boy went to school)", "Question with هل/أ: هل + statement for yes/no question (هل تتكلم العربية؟ = Do you speak Arabic?)", "Negation: لا + present verb, لم + jussive for past (لا أعرف = I don't know, لم أذهب = I didn't go)", "Definite/Indefinite: كتاب (a book) vs الكتاب (the book) — adjective agrees: كتاب كبير / الكتاب الكبير", "كان + adjective/noun: past 'to be' (كان الطقس جميلاً = The weather was beautiful)", "إضافة (Idafa): noun + noun possession without of (بيت الرجل = the man's house, lit. house-the man)", "ليس: 'is not' for present negation of nominal sentences (ليس الطقس جميلاً = The weather is not beautiful)"],
  hi: ["Basic SOV: Subject + Object + Verb (मैं पानी पीता हूँ. Main pānī pītā hūn. I drink water.)", "Postposition से (se): from/by/with — दिल्ली से (from Delhi), मुझसे बात करो (talk with me)", "Postposition को (ko): to/for/at — उसको (to him/her), मुझको (to me), रात को (at night)", "में/पर for location: में = inside (घर में = in the house), पर = on/at surface (मेज़ पर = on the table)", "चाहना/पसंद होना for wants and likes: मुझे चाय चाहिए (I want tea), मुझे हिंदी पसंद है (I like Hindi)", "क्या + sentence = yes/no question: क्या आप हिंदी बोलते हैं? (Do you speak Hindi?)", "ने construction for perfective past: transitive verbs — मैंने खाना खाया (I ate food) — subject takes ने, object takes nothing", "नहीं for negation: before verb — मैं नहीं जाता (I don't go) / जाना नहीं है (don't have to go)"],
};

const VOCAB_CATEGORIES = {
  es: ["Los Números (Numbers) — 0 to 30 + 40/50/60/70/80/90/100/1000", "Los Colores y Formas (Colors & Shapes)", "La Familia y las Relaciones (Family & Relationships)", "La Comida y Bebida (Food & Drink) — 20 common items", "Viajes y Transporte (Travel & Transport)", "El Tiempo y las Estaciones (Weather & Seasons)", "El Cuerpo Humano (The Human Body)", "Adjetivos Esenciales (Essential Adjectives) — opposites pairs"],
  pt: ["Os Números (Numbers) — 0 to 30 + 40/50/100/1000", "As Cores e Formas (Colors & Shapes)", "A Família e Relações (Family & Relationships)", "Comida e Bebida (Food & Drink) — Brazilian favorites included", "Viagens e Transporte (Travel & Transport)", "O Tempo e as Estações (Weather & Seasons)", "O Corpo Humano (The Human Body)", "Adjetivos Essenciais (Essential Adjectives) — opposite pairs"],
  it: ["I Numeri (Numbers) — 0 to 30 + 40/50/100/1000", "I Colori e le Forme (Colors & Shapes)", "La Famiglia e le Relazioni (Family & Relationships)", "Il Cibo e le Bevande (Food & Drink) — Italian specialties included", "Viaggi e Trasporti (Travel & Transport)", "Il Tempo e le Stagioni (Weather & Seasons)", "Il Corpo Umano (The Human Body)", "Aggettivi Essenziali (Essential Adjectives) — opposite pairs"],
  de: ["Die Zahlen (Numbers) — 0 to 30 + 40/50/100/1000", "Die Farben und Formen (Colors & Shapes)", "Die Familie und Beziehungen (Family & Relationships)", "Essen und Trinken (Food & Drink) — German classics included", "Reisen und Verkehr (Travel & Transport)", "Das Wetter und Jahreszeiten (Weather & Seasons)", "Der menschliche Körper (The Human Body)", "Wichtige Adjektive (Essential Adjectives) — opposite pairs, with gender note"],
  en: ["Numbers & Quantities (0 to 30 + fractions + ordinals)", "Colors, Shapes & Sizes", "Family & Social Relationships", "Food, Drink & Cooking Verbs", "Travel, Transport & Directions", "Work & Daily Routine Verbs", "Emotions & Mental States", "Essential Adjectives & Their Opposites"],
  zh: ["数字 Shùzì (Numbers) — 0–20 + 百/千/万 + phone/price reading patterns, with pinyin + tones", "颜色和形状 (Colors & Shapes) — all with pinyin and tones", "家人和关系 (Family & Relationships) — including different terms for maternal/paternal relatives", "食物和饮料 (Food & Drink) — Chinese cuisine focus, all with pinyin", "出行和交通 (Travel & Transport) — all with pinyin", "时间和天气 (Time & Weather) — all with pinyin", "身体部位 (Body Parts) — all with pinyin", "常用形容词 (Common Adjectives) — opposite pairs, all with pinyin"],
  ja: ["数字 Sūji (Numbers) — 1–20 + 100/1000/10000 + Japanese counter 〜つ, in hiragana and romaji", "色と形 (Colors & Shapes) — in hiragana/kanji with romaji", "家族と関係 (Family & Relationships) — in-group (uchi) vs out-group (soto) terms both listed", "食べ物と飲み物 (Food & Drink) — Japanese cuisine focus, hiragana/kanji and romaji", "旅行と交通 (Travel & Transport) — in hiragana/kanji with romaji", "時間と天気 (Time & Weather) — in hiragana/kanji with romaji", "体の部位 (Body Parts) — in hiragana/kanji with romaji", "基本形容詞 (Basic Adjectives) — い-adj and な-adj labeled, opposite pairs"],
  ko: ["숫자 (Numbers) — native Korean 1–10 + sino-Korean 1–10 + 20/30/100/1000, with romanization", "색깔과 모양 (Colors & Shapes) — with romanization", "가족과 관계 (Family & Relationships) — formal and informal terms", "음식과 음료 (Food & Drink) — Korean cuisine focus, with romanization", "여행과 교통 (Travel & Transport) — with romanization", "시간과 날씨 (Time & Weather) — with romanization", "신체 부위 (Body Parts) — with romanization", "기본 형용사 (Basic Adjectives) — descriptive verb form listed, opposites paired"],
  ru: ["Числа (Numbers) — 1–20 + 30/40/50/100/1000 in Cyrillic + genitive rule for 2/3/4 vs 5+", "Цвета и Формы (Colors & Shapes) — in Cyrillic with stress marks", "Семья и Отношения (Family & Relationships) — in Cyrillic", "Еда и Напитки (Food & Drink) — Russian cuisine included, Cyrillic + stress", "Путешествия и Транспорт (Travel & Transport) — in Cyrillic", "Погода и Времена года (Weather & Seasons) — in Cyrillic", "Части Тела (Body Parts) — in Cyrillic", "Основные Прилагательные (Essential Adjectives) — short and long form noted, opposite pairs"],
  ar: ["الأرقام (Numbers) — 1–20 in Arabic script + numerals + how Arabic numbers are written right-to-left", "الألوان والأشكال (Colors & Shapes) — in Arabic script with transliteration, masculine and feminine forms", "العائلة والعلاقات (Family & Relationships) — in Arabic with transliteration", "الطعام والشراب (Food & Drink) — Middle Eastern cuisine, Arabic script + transliteration", "السفر والمواصلات (Travel & Transport) — Arabic script + transliteration", "الطقس والفصول (Weather & Seasons) — Arabic script + transliteration", "أجزاء الجسم (Body Parts) — Arabic script + transliteration", "الصفات الأساسية (Essential Adjectives) — masculine and feminine forms, opposite pairs"],
  hi: ["गिनती (Numbers) — 0–30 + 40/50/100/1000 in Devanagari with transliteration", "रंग और आकार (Colors & Shapes) — in Devanagari with transliteration and gender notes", "परिवार और रिश्ते (Family & Relationships) — in Devanagari, different terms for maternal/paternal relatives", "खाना और पेय (Food & Drink) — Indian cuisine and street food, Devanagari + transliteration", "यात्रा और परिवहन (Travel & Transport) — Devanagari + transliteration", "मौसम और ऋतुएँ (Weather & Seasons) — Devanagari + transliteration, all 6 Indian seasons", "शरीर के अंग (Body Parts) — Devanagari + transliteration", "ज़रूरी विशेषण (Essential Adjectives) — masculine and feminine forms, opposite pairs, Devanagari"],
};

// ── Dialogue scenarios — 5 real-life scenes per language ─────────────────────
const DIALOGUE_SCENARIOS = {
  es: ["Greetings & introductions at a social gathering (2 strangers meeting, exchanging names, jobs, where they are from)", "At a restaurant: ordering food and drinks, asking about the menu, paying the bill", "Asking for and giving directions in a city (finding a metro station, a pharmacy, a hotel)", "Shopping for clothes: asking about sizes, colors, prices, trying on items", "A phone call to make a doctor's appointment, explain symptoms, confirm the time"],
  pt: ["Greetings & introductions at a café in Brazil (two people meeting for the first time)", "Ordering food at a Brazilian churrascaria — asking about the menu, drinks, and the bill", "Asking for directions in São Paulo — finding a metro station and a pharmacy", "Shopping at a market — asking prices, bargaining politely, paying", "Calling to book a hotel room — dates, room type, price, breakfast included"],
  it: ["Greetings & introductions at an Italian dinner party (formal and informal register)", "At a bar ordering a coffee and a pastry — typical Italian bar interaction", "Asking for directions in Rome — finding the Colosseum, a bus stop, a pharmacy", "Buying fresh produce at a market — asking for quantities, prices, freshness", "Booking a table at a restaurant by phone — date, time, number of guests, dietary needs"],
  de: ["Greetings & self-introduction in a professional setting (new colleague at work)", "At a German bakery and supermarket — ordering bread, asking for items, paying", "Asking for directions in Berlin — public transport, U-Bahn, bus connections", "At a doctor's appointment — explaining symptoms, understanding the doctor's advice", "Renting an apartment: asking about the size, rent, utilities, lease duration"],
  en: ["Job interview: introducing yourself, describing experience, answering common questions", "At a hotel: checking in, asking about facilities, reporting a problem with the room", "Making plans with a friend: suggesting activities, agreeing/disagreeing, confirming a time and place", "A formal meeting: presenting an idea, asking for clarification, agreeing on next steps", "At a hospital or pharmacy: describing symptoms, asking about medication, understanding instructions"],
  zh: ["Greetings and self-introductions at a Chinese university (name, nationality, why learning Chinese)", "Ordering food at a Chinese restaurant — asking about dishes, spice level, drinks, the bill", "Taking a taxi in Beijing — giving the destination, asking about the fare, making conversation", "Shopping at a Chinese market — asking prices, bargaining, paying with WeChat Pay", "Calling to book a hotel room in Mandarin — dates, room type, price, special requests"],
  ja: ["Greetings and self-introductions in a Japanese workplace setting (name, company, role)", "Ordering at a Japanese ramen restaurant — reading the menu, ordering, asking about toppings", "Asking for directions near Shibuya station — finding a convenience store, the exit, a café", "Shopping at a Japanese department store — asking a staff member for help, sizes, gift wrapping", "A phone call to make a reservation at a ryokan (traditional inn) — dates, room, dinner included"],
  ko: ["Greetings and self-introductions at a Korean language exchange event", "Ordering Korean food at a restaurant — samgyeopsal, drinks, asking for more side dishes (반찬)", "Asking for directions in Seoul — finding the subway exit, a convenience store, Gyeongbokgung", "Shopping at a Korean cosmetics store — asking about products, skin type recommendations, prices", "Making a phone call to book a Korean cooking class — date, time, what to bring, price"],
  ru: ["Greetings and self-introductions at a Russian cultural event (name, city, occupation)", "At a Russian café: ordering tea, coffee, a dish from the menu, asking for the bill", "Asking for directions in Moscow — finding Red Square, a metro station, a pharmacy (аптека)", "Shopping at a Russian supermarket — asking where items are, quantities, paying at the cashier", "Booking a train ticket at a ticket office — destination, class, date, one-way or return"],
  ar: ["Greetings and self-introductions using formal Modern Standard Arabic (name, country, purpose of learning Arabic)", "At a Middle Eastern restaurant: ordering mezze, main dishes, tea, and asking for the bill", "Asking for directions in Cairo — finding a mosque, a bank, a taxi, using polite request forms", "Shopping at a souk (market): asking about goods, negotiating prices, expressing satisfaction", "A phone call to arrange a meeting with a colleague — time, place, agenda, confirming details"],
  hi: ["Greetings and self-introductions in Hindi — first meeting, exchanging names, cities, and why learning Hindi", "Ordering food at a dhaba (roadside restaurant) — asking about the menu, chai, paying the bill", "Asking for directions in Delhi — finding a metro station, a market, and using please/thank you correctly", "Bargaining at a bazaar — asking prices, negotiating, expressing that something is too expensive", "Booking a train ticket at a counter — destination, class (AC/sleeper), date, one-way or return"],
};

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildGrammarPrompt(lang) {
  const name   = LANG_NAMES[lang];
  const topics = GRAMMAR_TOPICS[lang];
  return `You are an expert ${name} language teacher creating a grammar reference for adult learners. Generate exactly 8 grammar sections covering these topics IN THIS ORDER:

${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences, no explanation before or after:
{"sections":[{"title":"Short name (3–5 words)","level":"Beginner","rule":"2–3 sentence accurate explanation of the rule including the actual pattern or formula","example_target":"A natural grammatically correct sentence in ${name}","example_target_2":"A second shorter example sentence in ${name}","example_ref":"English: [translation of example 1] / [translation of example 2]","note":"The single most important tip, common mistake to avoid, or key nuance"}]}

ACCURACY RULES — violations are unacceptable:
- Every sentence in example_target and example_target_2 MUST be in ${name}, not English
- All ${name} text must be grammatically correct — double-check every form
- level: sections 1–3 = "Beginner", 4–6 = "Intermediate", 7–8 = "Advanced"
- rule must state the actual grammatical rule, not just describe what the section is about
- note must give practical advice (common error or memory trick), not restate the rule
- For non-Latin script languages (Chinese/Japanese/Korean/Russian/Arabic): ALWAYS include native script — do not romanize only`;
}

function buildCheatsheetPrompt(lang) {
  const name   = LANG_NAMES[lang];
  const groups = CHEATSHEET_GROUPS[lang];
  return `You are an expert ${name} language teacher creating a quick-reference cheat sheet. Generate exactly 6 categories:

${groups.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences:
{"categories":[{"name":"Category Name","items":[{"target":"${name} word or phrase","ref":"English meaning","note":"pronunciation tip, gender note, or usage context"}]}]}

ACCURACY RULES:
- Every item in target must be in ${name} — correct spelling, correct script, correct diacritics
- ref must be accurate English meaning
- note must be useful — pronunciation (for non-Latin scripts: include romanization in note), grammatical gender, register (formal/informal), or when to use
- Numbers must be exactly correct — check every digit
- Verb entries must show the correct conjugated form requested in the category description
- For Chinese: include pinyin with tone marks in note; For Japanese: include romaji in note; For Korean: include romanization; For Arabic: include transliteration; For Russian: include stress mark where helpful`;
}

function buildStructuresPrompt(lang) {
  const name   = LANG_NAMES[lang];
  const topics = STRUCTURE_TOPICS[lang];
  return `You are an expert ${name} language teacher creating a sentence-structure guide for adult learners. Generate exactly 8 patterns IN THIS ORDER:

${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences:
{"structures":[{"pattern":"Formula (e.g. Subject + Verb + Object)","title":"What this structure expresses (5–8 words)","explanation":"2–3 sentences on how it works, when to use it, and key word-order or grammatical rules","ex1_target":"Example sentence in ${name}","ex1_ref":"English translation","ex2_target":"A second different example in ${name}","ex2_ref":"English translation"}]}

ACCURACY RULES:
- ex1_target and ex2_target MUST be in ${name} — grammatically correct, natural-sounding sentences
- pattern should be a memorable formula, not a description
- explanation must be factually accurate and specific — state the exact rule
- The two examples must demonstrate DIFFERENT uses or vocabulary of the same structure
- For non-Latin script languages: use native script in ex1_target and ex2_target`;
}

function buildVocabPrompt(lang) {
  const name       = LANG_NAMES[lang];
  const categories = VOCAB_CATEGORIES[lang];
  return `You are an expert ${name} language teacher creating a vocabulary reference. Generate exactly 8 categories IN THIS ORDER:

${categories.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences:
{"categories":[{"name":"Category Name in ${name} and English","words":[{"t":"word in ${name}","p":"pronunciation guide","r":"English meaning"}]}]}

ACCURACY RULES:
- t (target) must be the correct ${name} spelling/script for every single word
- p (pronunciation): Chinese = pinyin with tones; Japanese = romaji; Korean = revised romanization; Russian = English phonetics with stressed syllable in CAPS; Arabic = simple transliteration; Latin-script languages = stressed syllable in CAPS
- r must be accurate English translation
- Include the exact number of words specified in each category description
- For languages with grammatical gender: note gender where relevant in the r field with (m)/(f)/(n)`;
}

function buildDialoguesPrompt(lang) {
  const name      = LANG_NAMES[lang];
  const scenarios = DIALOGUE_SCENARIOS[lang];
  return `You are an expert ${name} language teacher writing 5 realistic dialogues for intermediate learners. Each dialogue must be a natural, authentic conversation that sounds like real ${name} speakers — not a textbook exercise.

Write dialogues for these 5 scenes IN THIS ORDER:
${scenarios.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences:
{"dialogues":[{"title":"Short scene title","scene":"One sentence describing the context and setting","level":"Beginner|Intermediate|Advanced","lines":[{"speaker":"Person A name or role","target":"Their line in ${name}","ref":"English translation"}],"vocab":["key word/phrase (English meaning)"],"note":"One cultural insight or language tip specific to this dialogue"}]}

ACCURACY RULES:
- Every line in target MUST be in ${name} — grammatically correct and natural
- Each dialogue must have 8–12 lines total (alternating between 2 speakers)
- vocab array must list 4–6 key words or phrases from the dialogue with their English meanings
- level: dialogues 1–2 = "Beginner", dialogues 3–4 = "Intermediate", dialogue 5 = "Advanced"
- note must give a genuine cultural insight — not just a grammar explanation
- For non-Latin scripts (Chinese/Japanese/Korean/Russian/Arabic/Hindi): ALL lines in target MUST use native script, not romanization alone
- For Hindi specifically: ALL target lines MUST contain Devanagari script (not just romanized Hindi)`;
}

// ── Content validation ────────────────────────────────────────────────────────
// Validates structure and quality before storing. Returns null if valid,
// or a string describing the first problem found.

function validateContent(lang, tab, data) {
  const check = SCRIPT_CHECK[lang];

  function hasNativeScript(text) {
    if (!check) return true; // Latin-script language — no check needed
    return check(String(text || ""));
  }

  function checkScriptInArray(items, field) {
    if (!check) return null;
    const bad = items.findIndex(item => !hasNativeScript(item[field] || ""));
    if (bad !== -1) return `Item ${bad} missing native script in '${field}'`;
    return null;
  }

  if (tab === "grammar") {
    if (!Array.isArray(data.sections))         return "missing sections array";
    if (data.sections.length < 6)              return `only ${data.sections.length} sections (need ≥6)`;
    for (const [i, s] of data.sections.entries()) {
      if (!s.title)          return `section ${i} missing title`;
      if (!s.rule)           return `section ${i} missing rule`;
      if (!s.example_target) return `section ${i} missing example_target`;
      if (!s.example_ref)    return `section ${i} missing example_ref`;
      const err = checkScriptInArray([s], "example_target");
      if (err) return err;
    }
    return null;
  }

  if (tab === "cheatsheet") {
    if (!Array.isArray(data.categories))       return "missing categories array";
    if (data.categories.length < 5)            return `only ${data.categories.length} categories (need ≥5)`;
    for (const [i, c] of data.categories.entries()) {
      if (!c.name)                             return `category ${i} missing name`;
      if (!Array.isArray(c.items) || c.items.length < 5) return `category ${i} has too few items`;
      const err = checkScriptInArray(c.items, "target");
      if (err) return `category ${i}: ${err}`;
    }
    return null;
  }

  if (tab === "structures") {
    if (!Array.isArray(data.structures))       return "missing structures array";
    if (data.structures.length < 6)            return `only ${data.structures.length} structures (need ≥6)`;
    for (const [i, s] of data.structures.entries()) {
      if (!s.pattern)     return `structure ${i} missing pattern`;
      if (!s.explanation) return `structure ${i} missing explanation`;
      if (!s.ex1_target)  return `structure ${i} missing ex1_target`;
      if (!s.ex1_ref)     return `structure ${i} missing ex1_ref`;
      const err = checkScriptInArray([s], "ex1_target");
      if (err) return err;
    }
    return null;
  }

  if (tab === "vocab") {
    if (!Array.isArray(data.categories))       return "missing categories array";
    if (data.categories.length < 6)            return `only ${data.categories.length} categories (need ≥6)`;
    for (const [i, c] of data.categories.entries()) {
      if (!c.name)                             return `category ${i} missing name`;
      if (!Array.isArray(c.words) || c.words.length < 5) return `category ${i} has too few words`;
      const err = checkScriptInArray(c.words, "t");
      if (err) return `category ${i}: ${err}`;
    }
    return null;
  }

  if (tab === "dialogues") {
    if (!Array.isArray(data.dialogues))        return "missing dialogues array";
    if (data.dialogues.length < 4)             return `only ${data.dialogues.length} dialogues (need ≥4)`;
    for (const [i, d] of data.dialogues.entries()) {
      if (!d.title)                            return `dialogue ${i} missing title`;
      if (!d.scene)                            return `dialogue ${i} missing scene`;
      if (!Array.isArray(d.lines) || d.lines.length < 6) return `dialogue ${i} has fewer than 6 lines`;
      if (!Array.isArray(d.vocab) || d.vocab.length < 3) return `dialogue ${i} has fewer than 3 vocab items`;
      const err = checkScriptInArray(d.lines, "target");
      if (err) return `dialogue ${i}: ${err}`;
    }
    return null;
  }

  return null; // unknown tab — skip validation
}

// ── Anthropic API call ────────────────────────────────────────────────────────

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",   // Best accuracy for language content
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw  = (data.content?.[0]?.text || "")
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/g, "").trim();

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`JSON parse failed. Response preview: ${raw.slice(0, 200)}`);
  }
}

// ── Main generation function with validation + retry ─────────────────────────

const MAX_ATTEMPTS = 3;

async function generateContent(lang, tab) {
  const prompts = {
    grammar:    buildGrammarPrompt(lang),
    cheatsheet: buildCheatsheetPrompt(lang),
    structures: buildStructuresPrompt(lang),
    vocab:      buildVocabPrompt(lang),
    dialogues:  buildDialoguesPrompt(lang),
  };

  if (!prompts[tab]) throw new Error(`Unknown tab: ${tab}`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[Content] Generating ${lang}/${tab} (attempt ${attempt}/${MAX_ATTEMPTS})…`);

    let content;
    try {
      content = await callAnthropic(prompts[tab]);
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
      console.warn(`[Content] API call failed ${lang}/${tab} attempt ${attempt}: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
      continue;
    }

    const validationError = validateContent(lang, tab, content);
    if (validationError) {
      console.warn(`[Content] Validation failed ${lang}/${tab} attempt ${attempt}: ${validationError}`);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Content failed validation after ${MAX_ATTEMPTS} attempts. Last error: ${validationError}`);
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    // Valid — store it
    await db.run(`
      INSERT INTO content_cache (lang, tab, content_json, generated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT(lang, tab) DO UPDATE SET content_json = excluded.content_json, generated_at = NOW()
    `, [lang, tab, JSON.stringify(content)]);

    console.log(`[Content] ✓ ${lang}/${tab} stored (attempt ${attempt})`);
    return content;
  }
}

// ── Background generation at startup ─────────────────────────────────────────
// Fills any missing lang+tab pairs. Called from server.js after routes are mounted.

async function generateMissingContent() {
  const needed = [];
  for (const lang of VALID_LANGS) {
    for (const tab of VALID_TABS) {
      const row = await db.get("SELECT 1 FROM content_cache WHERE lang=$1 AND tab=$2", [lang, tab]);
      if (!row) needed.push([lang, tab]);
    }
  }

  if (needed.length === 0) {
    console.log("[Content] All content cached ✓");
    return;
  }

  console.log(`[Content] Background generation: ${needed.length} missing items`);

  for (const [lang, tab] of needed) {
    try {
      await generateContent(lang, tab);
    } catch (e) {
      console.error(`[Content] ✗ ${lang}/${tab}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // 2s between calls
  }

  console.log("[Content] Background generation complete ✓");
}

// ── API routes ────────────────────────────────────────────────────────────────

// GET /api/content/:lang/:tab — serve cached content (authenticated users)
router.get("/:lang/:tab", requireAuth, async (req, res) => {
  const { lang, tab } = req.params;

  if (!VALID_LANGS.includes(lang)) return res.status(400).json({ error: "Unknown language" });
  if (!VALID_TABS.includes(tab))   return res.status(400).json({ error: "Unknown tab" });

  const cached = await db.get(
    "SELECT content_json, generated_at FROM content_cache WHERE lang=$1 AND tab=$2",
    [lang, tab]
  );

  if (cached) {
    return res.json({
      content:      JSON.parse(cached.content_json),
      generated_at: cached.generated_at,
      cached:       true,
    });
  }

  // Should have been pre-generated at startup — generate now as fallback
  try {
    const content = await generateContent(lang, tab);
    res.json({ content, cached: false });
  } catch (e) {
    console.error(`[Content] On-demand generation failed ${lang}/${tab}:`, e.message);
    res.status(503).json({ error: "Content is being prepared. Please try again in 30 seconds." });
  }
});

// GET /api/content/status — admin: shows cache status for all lang+tab pairs
router.get("/status", requireAdmin, async (req, res) => {
  const rows  = await db.all("SELECT lang, tab, generated_at FROM content_cache");
  const index = {};
  for (const r of rows) {
    if (!index[r.lang]) index[r.lang] = {};
    index[r.lang][r.tab] = r.generated_at;
  }
  res.json({
    langs:    VALID_LANGS,
    tabs:     VALID_TABS,
    cached:   index,
    total:    rows.length,
    possible: VALID_LANGS.length * VALID_TABS.length,
    names:    LANG_NAMES,
  });
});

// POST /api/content/regenerate/:lang — admin: regenerate all tabs for one language
router.post("/regenerate/:lang", requireAdmin, async (req, res) => {
  const { lang } = req.params;
  if (!VALID_LANGS.includes(lang)) return res.status(400).json({ error: "Unknown language" });

  res.json({ message: `Regenerating all tabs for ${LANG_NAMES[lang]}…` });

  for (const tab of VALID_TABS) {
    try {
      await generateContent(lang, tab);
    } catch (e) {
      console.error(`[Content] Admin regen failed ${lang}/${tab}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`[Content] Admin regen of ${lang} complete`);
});

// POST /api/content/regenerate/:lang/:tab — admin: regenerate a single item
router.post("/regenerate/:lang/:tab", requireAdmin, async (req, res) => {
  const { lang, tab } = req.params;
  if (!VALID_LANGS.includes(lang)) return res.status(400).json({ error: "Unknown language" });
  if (!VALID_TABS.includes(tab))   return res.status(400).json({ error: "Unknown tab" });

  res.json({ message: `Regenerating ${LANG_NAMES[lang]} — ${tab}…` });

  try {
    await generateContent(lang, tab);
  } catch (e) {
    console.error(`[Content] Admin regen failed ${lang}/${tab}:`, e.message);
  }
});

module.exports = router;
module.exports.generateMissingContent = generateMissingContent;
module.exports.VALID_LANGS  = VALID_LANGS;
module.exports.VALID_TABS   = VALID_TABS;
module.exports.LANG_NAMES   = LANG_NAMES;
