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
  fr: "French",
  es: "Spanish", de: "German",  en: "English",  pt: "Portuguese",
  it: "Italian", zh: "Chinese (Mandarin)", ja: "Japanese",
  ko: "Korean",  ru: "Russian", ar: "Arabic",   hi: "Hindi",
};

const VALID_LANGS = Object.keys(LANG_NAMES);
const VALID_TABS  = ["grammar", "cheatsheet", "structures", "vocab", "dialogues", "drills", "roadmap"];

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
  "fr": [
    "Le présent: verbes réguliers en -er (all 6 persons: je/tu/il/nous/vous/ils) + être et avoir — parler → je parle, tu parles, il parle, nous parlons, vous parlez, ils parlent; être (je suis/tu es/il est/nous sommes/vous êtes/ils sont) and avoir (j'ai/tu as/il a/nous avons/vous avez/ils ont)",
    "Le présent: verbes en -ir et -re + irréguliers courants — finir (je finis, nous finissons, ils finissent), vendre (je vends, il vend, nous vendons) + aller/faire/pouvoir/vouloir/venir/prendre (je vais, je fais, je peux, je veux, je viens, je prends)",
    "Les articles définis, indéfinis et partitifs: définis le/la/l'/les (the), indéfinis un/une/des (a/some), partitifs du/de la/de l'/des for uncountable amounts (je bois du café, je mange de la salade) — all become de/d' after a negative (je ne bois pas de café)",
    "Le genre et l'accord des adjectifs: nouns are masculine or feminine (le livre / la table); adjectives agree in gender and number — un petit chat, une petite maison, des petits chats; most add -e (fem.) and -s (plur.); usually after the noun, but BAGS adjectives of Beauty/Age/Goodness/Size go before (une grande maison, un vieux château)",
    "La négation: ne + verbe + pas/jamais/plus/rien/personne — je ne parle pas, il ne vient jamais, nous n'avons plus d'argent, je ne vois rien, elle ne connaît personne; the indefinite/partitive article becomes de (pas de pain); in casual speech the ne is often dropped (je sais pas)",
    "L'interrogation: three ways to ask — intonation (Tu viens?), est-ce que (Est-ce que tu viens?), and inversion (Viens-tu? / Où habitez-vous?); with question words qui/que/quoi/où/quand/comment/pourquoi/combien and quel/quelle (Quelle heure est-il?)",
    "Les prépositions à / de / en / chez: à = to/at (je vais à Paris, à l'école), de = of/from (je viens de Lyon, la voiture de Marie), en = in/to with feminine countries and months (en France, en mai), chez = at someone's place (chez moi, chez le médecin); mandatory contractions à+le=au, à+les=aux, de+le=du, de+les=des",
    "Le futur proche et le futur simple: futur proche = aller + infinitif for near or planned future (je vais manger, on va partir); futur simple = infinitive + -ai/-as/-a/-ons/-ez/-ont (je parlerai, tu finiras, il vendra) with irregular stems (être→ser-, avoir→aur-, aller→ir-, faire→fer-, venir→viendr-, pouvoir→pourr-)",
    "Le passé composé avec avoir: avoir (au présent) + participe passé — j'ai parlé, tu as fini, il a vendu; participles -er→é, -ir→i, -re→u, plus irregulars (avoir→eu, être→été, faire→fait, prendre→pris, voir→vu, mettre→mis); the main past tense in speech",
    "Le passé composé avec être + accord du participe: 14 verbs of movement/state (DR & MRS VANDERTRAMP: aller, venir, arriver, partir, entrer, sortir, monter, descendre, rester, tomber, naître, mourir, devenir, retourner) + all pronominal verbs take être; the participle agrees with the subject in gender and number — elle est allée, ils sont partis, nous nous sommes levés",
    "L'imparfait vs le passé composé: imparfait for description, habits, and ongoing background past — nous-stem + -ais/-ais/-ait/-ions/-iez/-aient (je parlais, nous faisions, c'était, il y avait); passé composé for completed, punctual actions — Je regardais la télé (imparfait) quand le téléphone a sonné (passé composé)",
    "Les verbes pronominaux (réfléchis): reflexive pronoun me/te/se/nous/vous/se before the verb — se lever, s'appeler, se laver, se souvenir — je me lève, tu t'appelles, il se couche; in passé composé they take être with agreement (elle s'est levée, ils se sont parlé)",
    "L'impératif: commands with no subject pronoun — three forms tu/nous/vous (Parle! Parlons! Parlez!); -er verbs drop the -s in the tu form (Mange!); irregulars être→Sois/Soyons/Soyez, avoir→Aie/Ayons/Ayez; object pronouns attach with a hyphen in the affirmative (Donne-moi!, Lève-toi!) but precede in the negative (Ne te lève pas!)",
    "Les pronoms toniques: moi/toi/lui/elle/nous/vous/eux/elles — used after prepositions (avec moi, chez eux), for emphasis (Moi, je pars.), after c'est (C'est lui), alone in answers (Qui? — Moi!), and in comparisons (plus grand que toi)",
    "Le comparatif et le superlatif: plus/moins/aussi + adjectif + que (Il est plus grand que moi, elle est aussi rapide que lui); superlatif le/la/les plus/moins + adjectif + de (le plus intelligent de la classe); irregulars bon→meilleur→le meilleur, bien→mieux→le mieux, mauvais→pire/plus mauvais",
    "Les pronoms COD et COI: complément d'objet direct me/te/le/la/nous/vous/les (Je le vois, elle nous aime) vs complément d'objet indirect me/te/lui/nous/vous/leur for à + personne (Je lui parle, je leur écris); placed before the conjugated verb; in passé composé the participle agrees with a preceding COD (Je l'ai vue, les fleurs que j'ai achetées)",
    "Les pronoms y et en: y replaces à + lieu/chose (J'y vais, j'y pense) ; en replaces de + chose or a quantity (J'en veux, elle en a trois, il en revient, tu en as besoin); both go directly before the verb",
    "Les pronoms relatifs qui / que / dont / où: qui = sujet (l'homme qui parle), que = objet direct (le livre que je lis), dont = replaces de (la fille dont je parle, le film dont j'ai oublié le titre), où = lieu or temps (la ville où j'habite, le jour où il est arrivé)",
    "Le conditionnel présent: radical du futur + terminaisons de l'imparfait -ais/-ais/-ait/-ions/-iez/-aient (je parlerais, tu voudrais, il pourrait, nous aimerions); used for politeness (Je voudrais un café), hypotheticals, and in the Si + imparfait clause (Si j'avais le temps, je voyagerais)",
    "Le subjonctif présent: radical de la 3e personne du pluriel (ils) + -e/-es/-e/-ions/-iez/-ent (que je parle, que nous finissions); required after il faut que, vouloir que, avoir peur que, bien que, pour que, avant que, and expressions of emotion, doubt or necessity (Il faut que tu partes, je veux que tu viennes); key irregulars être (que je sois), avoir (que j'aie), aller (que j'aille), faire (que je fasse), pouvoir (que je puisse)",
    "Le plus-que-parfait: avoir ou être à l'imparfait + participe passé — j'avais parlé, elle était partie, nous nous étions levés; expresses an action completed before another past action (Quand je suis arrivé, il était déjà parti; j'ai mangé le gâteau qu'elle avait fait)",
    "La formation des adverbes en -ment: généralement adjectif au féminin + -ment (lent→lente→lentement, heureux→heureuse→heureusement, doux→douce→doucement); adjectives ending in a vowel add -ment to the masculine (vrai→vraiment, poli→poliment, absolu→absolument); -ant→-amment (constant→constamment), -ent→-emment (évident→évidemment, both pronounced 'a-ment')"
  ],
  "es": [
    "Present tense: regular -ar/-er/-ir verbs (all 6 persons: yo/tú/él/nosotros/vosotros/ellos)",
    "Ser vs Estar: two verbs for 'to be' — permanent identity (ser) vs temporary state/location (estar)",
    "Preterite tense: completed past actions — regular forms + key irregulars (ser/ir/hacer/tener/estar)",
    "Imperfect tense: habitual or ongoing past — era/estaba/había patterns and when to use vs preterite",
    "Reflexive verbs: me/te/se/nos/os/se + verb — levantarse, llamarse, sentirse and placement rules",
    "Object pronouns: direct (lo/la/los/las) and indirect (le/les) — position before conjugated verb",
    "Present subjunctive: formation and use after querer que, esperar que, ojalá, cuando + future",
    "Future tense: regular (add -é/-ás/-á/-emos/-éis/-án to infinitive) + irregular stems (tener→tendr-)",
    "Por vs Para: por (cause/duration/exchange/'through') vs para (purpose/destination/deadline/recipient) — gracias por, salgo para Madrid",
    "Present perfect (pretérito perfecto): haber + participle — he hablado, has comido, ha vivido — recent/relevant past with hoy/ya/todavía",
    "Conditional tense: infinitive + -ía/-ías/-ía/-íamos/-íais/-ían — hablaría, comería — hypotheticals, politeness (¿podrías?), same irregular stems as future",
    "Imperative (commands): affirmative tú (habla, come), formal usted (hable, coma), negative uses subjunctive (no hables) — pronouns attach in affirmative (dímelo)",
    "Comparatives & superlatives: más/menos + adjective + que (más alto que), irregulars (mejor/peor/mayor/menor), superlative el/la más... (el más rápido)",
    "Gustar-type verbs: indirect object + verb agreeing with the thing — me gusta el café, me gustan los libros, te encanta, le molesta, nos falta (encantar/interesar/doler)",
    "Present progressive: estar + gerundio (-ando/-iendo) — estoy hablando, estás comiendo, están viviendo — action in progress right now; irregular gerunds leyendo, durmiendo, pidiendo",
    "Relative pronouns: que (most common), quien/quienes (people, after preposition), el/la que, el/la cual, cuyo/cuya (whose), lo que (that which) — el libro que leí, la mujer con quien hablé",
    "Double object pronouns: indirect before direct, and le/les → se before lo/la/los/las — se lo di (I gave it to him), ¿me lo puedes traer? / puedes traérmelo",
    "Pluscuamperfecto (past perfect): había + participle — había hablado, habías comido — an action completed before another past moment (cuando llegué, ya había salido)",
    "Passive voice: ser + participle agreeing in gender/number (la casa fue construida) and passive/impersonal se (se venden coches, se habla español, se dice que...) — the everyday alternative",
    "Future perfect (futuro perfecto): habré + participle — habré terminado — an action completed by a future point (para las cinco habré acabado); also probability about the past (ya habrá salido)",
    "Imperfect subjunctive: -ra/-se endings (hablara/hablase, comiera, fuera) — after past-tense triggers (quería que vinieras) and hypothetical si clauses (si tuviera dinero, viajaría)",
    "Conditional perfect & third conditional: habría + participle — habría ido — with si + pluscuamperfecto de subjuntivo (si hubiera sabido, habría venido = if I had known, I would have come)"
  ],
  "pt": [
    "Present tense: -ar/-er/-ir verbs (all 6 persons) — key differences from Spanish endings",
    "Ser vs Estar vs Ficar: three verbs for states — ser (identity), estar (temporary), ficar (become/stay)",
    "Pretérito Perfeito: completed past — regular forms + key irregulars (ser/ir/ter/fazer/poder)",
    "Personal Infinitive: unique to Portuguese — inflected infinitive with person endings (falar/falares/falar/falarmos/falardes/falarem)",
    "Contractions: em+o=no, de+o=do, a+o=ao, em+a=na, de+a=da, por+o=pelo — mandatory in written Portuguese",
    "Future with ir+infinitive: vou falar, vai comer, vamos partir — the main way to express near future",
    "Object pronouns: me/te/o/a/lhe + clitic placement rules (before verb in Brazil, after in Portugal)",
    "Diminutives: -inho/-inha suffix — cafezinho, beijinho, obrigadinho — very common in Brazilian Portuguese",
    "Pretérito Imperfeito: habitual/ongoing past — falava, comia, era, tinha, ia — background actions and 'used to' + when to use vs Pretérito Perfeito",
    "Present subjunctive (presente do subjuntivo): after que espero que, é importante que, talvez, quando (future) — que eu fale, que ele coma, que nós sejamos",
    "Conditional (futuro do pretérito): infinitive + -ia/-ias/-ia/-íamos/-íeis/-iam — falaria, comeria — hypotheticals and politeness (gostaria, poderia)",
    "Imperative (imperativo): affirmative tu (fala, come) and formal você via subjunctive (fale, coma); negatives use subjunctive (não fale, não fales)",
    "Comparatives & superlatives: mais/menos + adjective + (do) que — mais alto que; irregulars melhor/pior/maior/menor; superlative o mais... / -íssimo (bonitíssimo)",
    "Reflexive & pronominal verbs: me/te/se/nos/vos/se — levantar-se, chamar-se, sentir-se, lembrar-se de — enclisis/proclisis placement differs Brazil vs Portugal",
    "Present continuous: estar + gerúndio (estou falando, Brazil) / estar a + infinitivo (estou a falar, Portugal) — action happening right now",
    "Relative pronouns: que (that/which/who), quem (whom, after preposition), o qual/a qual, cujo/cuja (whose), onde (where) — o homem que vi, a pessoa com quem falei",
    "Passive voice: ser + particípio agreeing in gender/number (a casa foi construída) and passive se (vende-se, alugam-se quartos, fala-se inglês)",
    "Pretérito mais-que-perfeito composto: tinha + particípio — tinha falado, tinha comido — an action completed before another past event (quando cheguei, ele já tinha saído)",
    "Pretérito perfeito composto: tenho + particípio — tenho falado, tenho estudado — a repeated or continuous action from the past up to now (NOT a single completed event, unlike Spanish)",
    "Futuro do subjuntivo: unique to Portuguese — quando/se/enquanto/assim que + future subjunctive (quando eu for, se você quiser, se tivermos tempo) — real future conditions",
    "Pretérito imperfeito do subjuntivo: -sse endings (falasse, comesse, fosse, tivesse) — after past triggers (queria que viesses) and hypothetical se clauses (se eu fosse rico, viajaria)",
    "Conditional/future perfect & third conditional: teria + particípio (teria ido) — with se + mais-que-perfeito do subjuntivo (se eu tivesse sabido, teria vindo = if I had known, I would have come)"
  ],
  "it": [
    "Present tense: -are/-ere/-ire verbs (all 6 persons) + essere and avere conjugation",
    "Passato Prossimo: main past tense — essere or avere auxiliary + participio passato (-ato/-uto/-ito)",
    "Essere vs Avere as auxiliary: verbs of motion/state take essere (sono andato); transitive verbs take avere (ho mangiato)",
    "Imperfetto: habitual or ongoing past — ero/avevo/facevo — when to use vs Passato Prossimo",
    "Reflexive verbs: mi/ti/si/ci/vi/si + verb — lavarsi, svegliarsi, divertirsi and agreement in Passato Prossimo",
    "Ci and Ne: ci = there/it (c'è, ci sono, andarci); ne = of it/some (ne voglio due, ne parla sempre)",
    "Formal address: Lei (not tu) + 3rd person singular verb — used in professional/polite contexts",
    "Congiuntivo Presente: after penso che, spero che, è importante che — formation of all conjugation types",
    "Futuro Semplice: -erò/-erai/-erà/-eremo/-erete/-eranno — parlerò, prenderò + irregular stems (essere→sarò, avere→avrò, fare→farò)",
    "Condizionale: -erei/-eresti/-erebbe/-eremmo/-ereste/-erebbero — vorrei, potrei, mi piacerebbe — politeness and hypotheticals",
    "Direct & indirect object pronouns combined: me lo, te la, glielo, ce ne — combined forms where mi/ti/ci/vi become me/te/ce/ve before lo/la/li/le/ne",
    "Imperativo: informal tu (parla!, prendi!, finisci!, negative non parlare!) and formal Lei via congiuntivo (parli!, prenda!) — pronouns attach (dimmi!, fallo!)",
    "Comparatives & superlatives: più/meno + adjective + di/che (più alto di); irregulars migliore/peggiore/maggiore/minore; relative superlative il più... (il più grande)",
    "Passato Remoto: literary/southern completed past — parlai/parlò, fui, ebbi, feci, dissi — common in written narrative and formal storytelling",
    "Stare + gerundio: present progressive — sto parlando, stai mangiando, sta finendo — action in progress right now; irregular gerunds facendo, dicendo, bevendo",
    "Relative pronouns: che (who/which, subject/object), cui (after preposition: la casa in cui vivo), il/la quale, il cui (whose) — l'uomo che conosco, la ragazza di cui parlo",
    "Partitive: di + article for 'some/any' — del pane, della carne, dei libri, delle mele — plus ne to replace it (ne voglio un po')",
    "Trapassato prossimo: avevo/ero + participio passato — avevo mangiato, ero andato — an action completed before another past moment (quando arrivai, era già partito)",
    "Passive voice: essere or venire + participio passato (la casa è stata costruita, viene venduta) and si passivante (si vendono case, si parla italiano)",
    "Congiuntivo imperfetto: -ssi endings (parlassi, prendessi, fossi, avessi) — after past triggers (pensavo che fosse) and hypotheticals (se avessi tempo)",
    "Periodo ipotetico (if clauses): reality (se ho tempo, vengo), possibility (se avessi tempo, verrei = congiuntivo imperfetto + condizionale), impossibility (se avessi avuto tempo, sarei venuto)",
    "Condizionale composto: avrei/sarei + participio — avrei voluto, sarei venuto — unrealized past ('I would have...') and future-in-the-past (ha detto che sarebbe venuto)"
  ],
  "de": [
    "Grammatical gender: der (masculine) / die (feminine) / das (neuter) — must learn with each noun, not predictable",
    "Nominative case: subject of sentence — der/die/das/die, ein/eine/ein/— articles; adjective endings",
    "Accusative case: direct object — den/die/das/die (masculine changes to den), einen/eine/ein; prepositions: durch/für/gegen/ohne/um",
    "Dative case: indirect object — dem/der/dem/den (nouns add -n in plural), einem/einer/einem; prepositions: aus/bei/mit/nach/seit/von/zu/gegenüber",
    "Present tense: regular -en verbs all 6 persons + stem-vowel changes (fahren→fährst, lesen→liest) + sein/haben/werden",
    "Perfekt: past tense in speech — haben/sein auxiliary + Partizip II (ge-+stem+-t for regular, ge-+stem+-en for strong verbs)",
    "Modal verbs: können/müssen/wollen/sollen/dürfen/mögen — conjugation + infinitive goes to END of sentence",
    "Separable verbs: anrufen/aufstehen/mitkommen/zurückgehen — prefix separates in main clause (Ich rufe dich an)",
    "Genitive case: possession — des/der/des/der + masculine/neuter nouns add -s (das Auto des Mannes); prepositions wegen/während/trotz/statt",
    "Adjective endings: strong (no article: guter Wein), weak (after der/die/das: der gute Wein), mixed (after ein/kein/mein: ein guter Wein) declension by gender/case",
    "Word order in subordinate clauses: conjunctions weil/dass/wenn/obwohl send the conjugated verb to the END — Ich weiß, dass er heute kommt",
    "Reflexive verbs & pronouns: sich freuen, sich waschen — accusative (mich/dich/sich) vs dative (mir/dir/sich) reflexive — Ich wasche mich / Ich wasche mir die Hände",
    "Comparative & superlative: adjective + -er + als (größer als), am + -sten / der/die/das -ste (am schnellsten, der schnellste); irregulars gut→besser→best, viel→mehr→meist",
    "Passive voice: werden + Partizip II — Das Haus wird gebaut (present), wurde gebaut (past), ist gebaut worden (perfect) — agent introduced with von",
    "Präteritum (simple past): the narrative/written past — war, hatte, ging, kam, machte, konnte — preferred over Perfekt in writing and for sein/haben/modals even in speech",
    "Futur I: werden (conjugated) + infinitive at the end — Ich werde morgen kommen, Sie wird es machen — future intentions and predictions",
    "Two-way prepositions (Wechselpräpositionen): an/auf/in/über/unter/vor/hinter/neben/zwischen — accusative for motion/direction (Ich gehe in die Schule), dative for location (Ich bin in der Schule)",
    "Relative clauses: der/die/das (and dem/den/dessen) as relative pronouns matching gender/case — verb goes to the END (Der Mann, der dort wohnt; Das Buch, das ich lese)",
    "Infinitive with zu: after many verbs and expressions — Ich versuche zu lernen, Es ist wichtig zu üben; um...zu for purpose (Ich lerne Deutsch, um zu reisen)",
    "Plusquamperfekt: hatte/war + Partizip II — Ich hatte gegessen, Sie war gegangen — an action completed before another past event (Nachdem er gegessen hatte, ging er)",
    "Konjunktiv II: würde + infinitive, plus hätte/wäre/könnte/müsste — hypotheticals and politeness (Ich würde gern kommen; Wenn ich Zeit hätte, würde ich helfen; Könnten Sie...?)",
    "Konjunktiv I (indirect speech): sei/habe/gehe — used in news and formal reporting (Er sagt, er sei krank; Sie meint, sie habe keine Zeit)"
  ],
  "en": [
    "Present Simple vs Present Continuous: I work (habit/fact) vs I am working (now/temporary) — usage rules and state verbs that never use continuous",
    "Past Simple vs Present Perfect: I went (specific past time) vs I have gone (connection to present, unspecified time) — with since/for/just/already/yet",
    "Future: will (spontaneous/prediction) vs going to (plan/evidence) vs Present Continuous for arrangements",
    "Modal verbs: can/could (ability/possibility), must/have to (obligation), should (advice), might/may (possibility), would (conditional/polite)",
    "First and Second Conditional: If + present simple + will (real possibility) vs If + past simple + would (unreal/hypothetical)",
    "Articles: a/an (first mention, non-specific) vs the (known/unique/second mention) vs no article (plural generics, proper nouns, abstract nouns)",
    "Prepositions of time: at (clock times/holidays), in (months/years/seasons/parts of day), on (days/dates) — no logic, must be memorized",
    "Phrasal verbs: give up/look after/carry on/find out/put off — meaning is unpredictable from parts; most common 20 examples",
    "Past Continuous & Past Perfect: was/were + -ing for interrupted past action (I was sleeping when...) vs had + past participle for the earlier of two past events (I had left before...)",
    "Comparatives & superlatives: -er/-est for short adjectives (bigger, biggest), more/most for long ones (more useful, most useful); irregulars good→better→best, bad→worse→worst",
    "Passive voice: be + past participle — The letter was written, English is spoken here, The bridge is being built — focus on action/object when agent is unknown or unimportant",
    "Reported (indirect) speech: tense backshift — 'I am tired' → He said he was tired; will→would, can→could; changes to time/place words (now→then, here→there)",
    "Gerunds vs infinitives: verb + -ing (enjoy swimming, avoid, finish) vs verb + to (want to go, decide, hope); after prepositions always -ing (good at cooking)",
    "Third Conditional & mixed conditionals: If + past perfect + would have + past participle (If I had known, I would have come) — unreal past regret/hypotheticals",
    "Present Perfect Continuous: have/has been + -ing — I have been working all day, It has been raining — emphasizes duration or an ongoing activity up to now",
    "Future Continuous & Future Perfect: will be + -ing (At 8pm I'll be flying) vs will have + past participle (By 2030 I will have graduated) — in progress at, or completed by, a future point",
    "Relative clauses: defining (no commas: The man who called...) vs non-defining (with commas: My brother, who lives in Rome, ...); who/which/that/whose/where and when the pronoun can be omitted",
    "Used to / would / be used to: past habits and states (I used to smoke, We would play outside) vs be/get used to + -ing for familiarity (I'm used to waking up early)",
    "Question tags: statement + reversed auxiliary + pronoun — You're coming, aren't you? / She doesn't drive, does she? / Let's go, shall we?",
    "Causative have/get something done: have/get + object + past participle — I had my hair cut, We're getting the car repaired — someone else does the action for you",
    "Wish & if only: wish + past simple (present regret: I wish I knew), wish + past perfect (past regret: I wish I had studied), wish + would (complaint: I wish you would stop)",
    "Modals of deduction about the past: must have / might have / can't have + past participle — She must have left (certainty), He can't have known (impossibility), They might have forgotten (possibility)"
  ],
  "zh": [
    "No verb conjugation: Mandarin verbs never change form — time is shown by time words (昨天/明天) and aspect markers, not verb endings",
    "Measure words (量词): one classifier for every noun — 一本书 (yī běn shū), 三个人 (sān gè rén), 两条鱼 (liǎng tiáo yú) — 个 is the default",
    "Aspect marker 了 (le): marks completed action or change of state — 我吃了 (I ate) vs 我吃 (I eat) — NOT a past tense marker",
    "Aspect markers 过 and 着: 过 = prior experience (我去过北京 I've been to Beijing), 着 = ongoing/durative state (他站着 tā zhàn zhe, He is standing / 门开着 mén kāi zhe, The door is open)",
    "Sentence time word order: Subject + Time + Place + Verb + Object — 我今天在家吃饭 (I today at home eat rice)",
    "把 construction: Subject + 把 + Object + Verb + Result — moves object before verb to emphasize result/disposal (把书放在桌子上)",
    "Comparison with 比: A + 比 + B + adjective — 他比我高 (He is taller than me) vs 没有 for negative comparison",
    "Question formation: add 吗 for yes/no (你去吗?), use question words 什么/哪里/谁/怎么/为什么/几 in normal word order",
    "Possession & modification with 的 (de): noun + 的 + noun — 我的书 (wǒ de shū, my book), 老师的车 (lǎoshī de chē, the teacher's car), 红色的花 (red flower)",
    "两 vs 二 (liǎng vs èr): 两 before measure words (两个 liǎng gè, two of them) but 二 in counting/numbers (十二 shí'èr, twelve; 第二 dì'èr, second)",
    "Resultative complements: verb + result verb — 看见 (kànjiàn, see/perceive), 听懂 (tīngdǒng, understand by listening), 吃完 (chīwán, finish eating), 找到 (zhǎodào, find)",
    "Directional complements: verb + 来/去 — 进来 (jìnlái, come in), 出去 (chūqù, go out), 回来 (huílái, come back), 上去 (shàngqù, go up) — motion relative to speaker",
    "是...的 construction: emphasizes time/place/manner of a known past action — 我是昨天来的 (wǒ shì zuótiān lái de, It was yesterday that I came)",
    "Potential complements with 得/不: verb + 得/不 + result — 听得懂 (tīng de dǒng, can understand) vs 听不懂 (tīng bu dǒng, can't understand), 吃得完/吃不完 (can/can't finish)",
    "会/能/可以 (huì/néng/kěyǐ) modal verbs: 会 = learned skill (我会说中文, wǒ huì shuō Zhōngwén, I can speak Chinese), 能 = physical ability/possibility (我今天能来, wǒ jīntiān néng lái), 可以 = permission (你可以走了, nǐ kěyǐ zǒu le, you may go)",
    "要/想/得 (yào/xiǎng/děi): 想 = want to/would like (我想喝茶, wǒ xiǎng hē chá), 要 = want/will (我要走了, wǒ yào zǒu le), 得 = have to (你得去, nǐ děi qù, you must go)",
    "被 (bèi) passive construction: Subject + 被 + (agent) + verb + extra — 我的手机被偷了 (wǒ de shǒujī bèi tōu le, My phone was stolen), 他被老师批评了 (tā bèi lǎoshī pīpíng le, he was criticized by the teacher)",
    "给 (gěi): give / for / to — 我给你打电话 (wǒ gěi nǐ dǎ diànhuà, I'll call you), 请给我一杯水 (qǐng gěi wǒ yì bēi shuǐ, please give me a glass of water)",
    "因为...所以 and 虽然...但是: 因为下雨，所以我不去 (yīnwèi xià yǔ, suǒyǐ wǒ bú qù, because it's raining, I won't go); 虽然很贵，但是很好 (suīrán hěn guì, dànshì hěn hǎo, although it's expensive, it's good)",
    "要...了 / 快...了 imminent action: 火车要开了 (huǒchē yào kāi le, the train is about to leave), 快下雨了 (kuài xià yǔ le, it's about to rain), 我快到了 (wǒ kuài dào le, I'm almost there)",
    "Verb reduplication for a brief/casual action: 看看 (kànkan, take a look), 试试 (shìshi, give it a try), 休息休息 (xiūxi xiūxi, rest a bit), 想一想 (xiǎng yi xiǎng, think it over)",
    "越来越 and 越...越: 越来越 + adjective for gradual change (天气越来越冷, tiānqì yuè lái yuè lěng, the weather gets colder and colder); 越...越 for correlation (越多越好, yuè duō yuè hǎo, the more the better)"
  ],
  "ja": [
    "Sentence order SOV: Subject + Object + Verb — verb ALWAYS at end — 私はりんごを食べます (I apple eat)",
    "Topic は vs Subject が: は (wa) marks topic/contrast (私は学生です), が (ga) marks new subject/exclusive focus (誰が来ましたか)",
    "Essential particles: を (wo) direct object, に (ni) direction/time/location for existence, で (de) location of action/means, と (to) together with",
    "Verb forms: dictionary form → ます form (polite present/future) → て form (te-form, linking) → た form (plain past) — regular and irregular (する/くる)",
    "い-adjectives vs な-adjectives: い-adj conjugate (暑い→暑くない→暑かった); な-adj use です/じゃない (静か→静かじゃない→静かでした)",
    "て form + います: ongoing action (食べています = is eating) vs habitual/resulting state (住んでいます = lives, 知っています = knows)",
    "Potential form: verb stem + られます (ichidan) or stem change + えます (godan) — 食べられます (can eat), 行けます (can go)",
    "Politeness levels: ます/です form (polite, default) vs plain/dictionary form (casual with friends) — context determines which to use",
    "Counters: number + classifier — 一つ/二つ (hitotsu/futatsu, general things), 一人/二人 (hitori/futari, people), 一枚 (ichimai, flat objects), 一本 (ippon, long objects), 一匹 (ippiki, small animals)",
    "Desire with たい and たがる: verb stem + たい for one's own wish (食べたい tabetai, I want to eat) vs 〜たがる for third person (彼は行きたがる, he wants to go)",
    "Conditional forms: と (natural/automatic result: 押すと開く), ば (general hypothetical: 行けば), たら (if/when, most versatile: 食べたら), なら (given that: 行くなら) — four distinct 'if'",
    "Giving & receiving: あげる (I give outward), くれる (someone gives to me/my side), もらう (I receive) — plus て-form for favors (手伝ってくれる, do me the favor of helping)",
    "Causative & passive: causative させる/せる (make/let do: 食べさせる, make eat), passive れる/られる (先生に褒められた, was praised by the teacher), causative-passive (行かせられる, be made to go)",
    "Keigo (honorific speech): 尊敬語 sonkeigo elevating others (いらっしゃる for 来る/行く/いる, なさる for する) vs 謙譲語 kenjōgo humbling oneself (参る, いたす, 申す) — used in formal/business settings",
    "Plain (casual) forms: negative ない and past た — 食べない (tabenai, don't eat), 食べなかった (tabenakatta, didn't eat), 行った (itta, went), 行かない (ikanai, don't go) — used with friends and for noun modification",
    "Volitional form: 〜ましょう (polite) / 〜よう (plain) — 行きましょう (ikimashō, let's go), 食べよう (tabeyō, let's eat / I think I'll eat), 〜ましょうか for offers (手伝いましょうか, shall I help?)",
    "Permission and prohibition: 〜てもいい (may) / 〜てはいけない (must not) — ここに座ってもいいですか (koko ni suwatte mo ii desu ka, may I sit here?), 入ってはいけません (haitte wa ikemasen, you must not enter)",
    "Obligation: 〜なければなりません / casual 〜なきゃ — 行かなければなりません (ikanakereba narimasen, I must go), 勉強しなきゃ (benkyō shinakya, I gotta study)",
    "Giving advice: 〜ほうがいい / 〜べき — 休んだほうがいいです (yasunda hō ga ii desu, you'd better rest), もっと練習するべきだ (motto renshū suru beki da, you should practice more)",
    "Quotation with と: 〜と思う (I think) / 〜と言う (say) — 明日雨が降ると思います (ashita ame ga furu to omoimasu, I think it will rain tomorrow), 彼は行くと言いました (kare wa iku to iimashita, he said he would go)",
    "なる (to become): い-adj drop い + く + なる, な-adj/noun + に + なる — 寒くなる (samuku naru, to get cold), 元気になる (genki ni naru, to get well), 医者になる (isha ni naru, to become a doctor)",
    "Conjecture: 〜でしょう / 〜だろう (probably) and 〜かもしれません (might) — 明日は晴れるでしょう (ashita wa hareru deshō, it will probably be sunny), 遅れるかもしれません (okureru kamoshiremasen, I might be late)"
  ],
  "ko": [
    "Sentence order SOV + predicate always last: Subject + Object + Verb/Adjective — 나는 사과를 먹어요 (I apple eat)",
    "Topic particle 은/는 vs subject particle 이/가: 은/는 marks topic or contrast; 이/가 marks new subject or emphasis — subtle but important distinction",
    "Object particle 을/를 and location particles 에/에서: 을/를 = direct object; 에 = static location/direction/time; 에서 = location of action or 'from'",
    "Polite verb endings: -아/어요 (informal polite, everyday speech) vs -습니다/ㅂ니다 (formal polite, presentations/news) — same meaning, different formality",
    "Tenses: past (-았/었어요: 먹었어요 ate), present/habitual (-아/어요: 먹어요 eat/eats), future intention (-(으)ㄹ 거예요: 먹을 거예요 will eat)",
    "Negation: 안 + verb (안 먹어요 don't eat) or verb stem + 지 않아요 (먹지 않아요) — both mean the same, 지 않아요 is more formal",
    "Descriptive verbs (형용사): adjectives conjugate like verbs — 크다 (to be big), 작아요 (is small) — no separate 'to be' for adjectives",
    "Honorific -시-: inserted into verb when subject is senior/respected — 선생님이 오세요 (The teacher is coming) vs 친구가 와요 (Friend is coming)",
    "Connective endings: -고 (and/then: 먹고 자요 eat and sleep), -아/어서 (so/because/sequence: 배고파서 먹어요 hungry so I eat), -지만 (but: 비싸지만 좋아요 expensive but good)",
    "Ability & desire: -(으)ㄹ 수 있다/없다 (can/cannot: 할 수 있어요 I can do it), -고 싶다 (want to: 가고 싶어요 I want to go)",
    "Counters with native/Sino numbers: native 하나/둘/셋 + counter (사람 people: 한 명, 개 things: 두 개) vs Sino 일/이/삼 for dates, money, minutes (삼십 분 30 minutes)",
    "Honorific & humble vocabulary: special words for respect — 잡수시다/드시다 (eat, for elders) vs 먹다, 주무시다 (sleep) vs 자다, 계시다 (be/exist) vs 있다; humble 저 (I) vs 나, 드리다 (give, humble form) vs 주다",
    "Irregular verb stems: ㅂ irregular (덥다→더워요 hot), ㄷ irregular (듣다→들어요 listen), 르 irregular (모르다→몰라요 not know), ㅅ irregular (짓다→지어요 build)",
    "Quoting & reported speech: -다고/-라고 하다 — 간다고 했어요 (said [he] would go), 학생이라고 했어요 (said [he] is a student), question -냐고, command -(으)라고, suggestion -자고",
    "Conditional -(으)면: if/when — 시간이 있으면 만나요 (sigani isseumyeon mannayo, if I have time, let's meet), 비가 오면 안 가요 (biga omyeon an gayo, if it rains, I won't go)",
    "Intention and purpose -(으)려고 / -(으)러: 사려고 해요 (saryeogo haeyo, I intend to buy), 밥을 먹으러 식당에 가요 (babeul meogeureo sikdange gayo, I go to the restaurant to eat)",
    "Obligation and permission: -아/어야 되다 (must: 가야 돼요, gaya dwaeyo, I have to go), -아/어도 되다 (may: 먹어도 돼요, meogeodo dwaeyo, you may eat), -(으)면 안 되다 (must not: 들어가면 안 돼요, deureogamyeon an dwaeyo, you must not enter)",
    "Prohibition command -지 마세요: 담배를 피우지 마세요 (dambaereul piuji maseyo, please don't smoke), 걱정하지 마세요 (geokjeonghaji maseyo, don't worry)",
    "Doing a favor -아/어 주다: do something for someone — 도와주세요 (dowajuseyo, please help me), 친구가 사 줬어요 (chinguga sa jwosseoyo, my friend bought it for me)",
    "Nominalization -는 것 / -기: turn a verb into a noun — 운동하는 것을 좋아해요 (undonghaneun geoseul joahaeyo, I like exercising), 수영하기가 어려워요 (suyeonghagiga eoryeowoyo, swimming is difficult)",
    "Noun-modifying (relative) endings -(으)ㄴ / -는 / -(으)ㄹ: past 먹은 (meogeun, that ate/eaten), present 먹는 (meokneun, that eats), future 먹을 (meogeul, to eat) — 어제 산 책 (eoje san chaek, the book I bought yesterday)",
    "Conjecture -(으)ㄹ 것 같다 (seems/probably): 비가 올 것 같아요 (biga ol geot gatayo, it looks like it will rain), 맛있을 것 같아요 (masisseul geot gatayo, it looks delicious)"
  ],
  "ru": [
    "Nominative case: subject of sentence — Я читаю (I read), Кот спит (The cat sleeps) — no article in Russian",
    "Accusative case: direct object — Я вижу тебя (I see you), Он читает книгу (He reads the book) — masculine animate nouns change ending",
    "Genitive case: possession, absence, quantity — нет воды (no water), у меня есть (I have), стакан чая (glass of tea), после урока (after class)",
    "Dative case: to/for someone — Я дал ей цветы (I gave her flowers), Мне нравится (I like it, lit. 'to me it is pleasing')",
    "Instrumental case: by/with/using — Я пишу ручкой (I write with a pen), Он работает врачом (He works as a doctor), с другом (with a friend)",
    "Prepositional case: location with в/на — Я живу в Москве (I live in Moscow), Книга на столе (The book is on the table)",
    "Verb aspects: imperfective (process/habit/repeated) vs perfective (completed single action) — читать/прочитать, писать/написать — must learn both forms",
    "Present tense conjugation: 1st conjugation читать→читаю/читаешь/читает/читаем/читаете/читают; 2nd conj говорить→говорю/говоришь/говорит; быть (to be) is absent in present tense",
    "Past tense: verb + -л/-ла/-ло/-ли agreeing with subject GENDER and number, not person — он читал (he read), она читала (she read), они читали (they read)",
    "Future tense: imperfective compound буду/будешь + infinitive (я буду читать, I will be reading) vs perfective simple future (я прочитаю, I will read [and finish])",
    "Verbs of motion: идти/ходить (go on foot, one-way vs habitual), ехать/ездить (go by vehicle) + prefixes при-/у-/вы-/по- (прийти arrive, уйти leave, войти enter)",
    "Numbers + case agreement: 1 + nominative (один стол), 2/3/4 + genitive singular (два стола, три книги), 5+ + genitive plural (пять столов, много книг)",
    "Comparatives & superlatives: -ее/-ей ending (быстрее faster, красивее) or более + adjective; superlative самый + adjective (самый большой, the biggest); irregulars лучше (better), хуже (worse)",
    "Reflexive verbs with -ся/-сь: учиться (to study/learn), заниматься (to be occupied with), нравиться (to be pleasing), встречаться (to meet) — -ся after consonants, -сь after vowels",
    "Imperative mood: verb stem + -й / -и / -ь — Читай! (Chitáy!, Read!), Говорите медленно (Govoríte médlenno, Speak slowly — polite), Иди сюда (Idí syudá, Come here)",
    "Short-form adjectives (predicative): Он болен (On bólen, He is sick), Она рада (Oná ráda, She is glad), Я занят (Ya zányat, I am busy), Это возможно (Éto vozmózhno, It is possible)",
    "Possessive pronouns and свой: мой/твой/наш/ваш agree in gender, number and case; свой = one's own, referring back to the subject — Она любит свою работу (Oná lyúbit svoyú rabótu, She loves her own job)",
    "Conditional and subjunctive with бы: past-tense verb + бы — Я хотел бы кофе (Ya khotél by kófe, I would like a coffee), Если бы у меня было время, я бы пришёл (Ésli by u menyá býlo vrémya, ya by prishyól, If I had time, I would come)",
    "Чтобы + purpose or wish: чтобы + infinitive (same subject) or + past tense (different subject) — Я учусь, чтобы знать (Ya uchús, chtóby znat, I study in order to know), Я хочу, чтобы ты пришёл (Ya khochú, chtóby ty prishyól, I want you to come)",
    "Negative pronouns and adverbs with ни-: никто/ничто/никогда/нигде + не (double negation is required) — Я никого не знаю (Ya nikogó ne znáyu, I don't know anyone), Он никогда не опаздывает (On nikogdá ne opázdyvaet, He is never late)",
    "Participles (причастия): verbal adjectives — читающий (chitáyushchiy, reading / who is reading, present active), прочитанный (prochítannyy, [that has been] read, past passive) — decline like adjectives",
    "Verbal adverbs (деепричастия): читая (chitáya, while reading — imperfective, simultaneous action), прочитав (prochitáv, having read — perfective, prior action) — a secondary action of the same subject"
  ],
  "ar": [
    "The definite article ال (al-): attaches directly to noun (الكتاب = the book); sun letters (ت ث د ذ ر ز س ش ص ض ط ظ ل ن) assimilate the lam (الشمس → ash-shams)",
    "Grammatical gender: every noun is masculine or feminine — ة (taa marbuta) usually marks feminine (طالبة = female student); adjectives must agree in gender",
    "Dual form: special suffix for exactly two — كتابان (two books), طالبتان (two female students) — used for people, things, time expressions",
    "Past tense (الماضي): based on root pattern فَعَلَ — كَتَبَ (he wrote), كَتَبَت (she wrote), كَتَبتُ (I wrote), كَتَبنا (we wrote) — all 13 persons",
    "Present tense (المضارع): يَفعَلُ pattern — يَكتُبُ (he writes), تَكتُبُ (she writes), أَكتُبُ (I write), نَكتُبُ (we write) — imperfect/ongoing",
    "Broken plurals (جمع التكسير): irregular plurals that change the word pattern — كِتاب → كُتُب (book→books), بَيت → بُيوت (house→houses) — must learn individually",
    "Sentence structure: nominal sentences (الجملة الاسمية) have no 'is/are' — المعلم كبير = the teacher [is] big; verbal sentences begin with verb (VSO order)",
    "Root system (الجذر الثلاثي): three-letter roots carry core meaning — ك-ت-ب (writing): كَتَبَ (he wrote), كِتاب (book), كاتِب (writer), مَكتَبة (library), مَكتَب (desk/office)",
    "Iḍāfa (الإضافة) possessive construct: noun + noun with no article on the first — كِتابُ الطالبِ (the student's book), بابُ البيتِ (the door of the house); only the last noun takes ال",
    "Attached possessive pronouns: suffix on the noun — كِتابي (my book), كِتابُكَ (your [m] book), كِتابُكِ (your [f] book), كِتابُهُ (his book), كِتابُها (her book), كِتابُنا (our book)",
    "Sound plurals: masculine ون/ين (مُعَلِّم → مُعَلِّمون/مُعَلِّمين, teachers) and feminine ات (مُعَلِّمة → مُعَلِّمات, female teachers) — regular, added to human nouns",
    "Negation: لا + present (لا أعرف, I don't know), ما/لم + past (لم يذهب, he didn't go), لن + subjunctive for future (لن أذهب, I won't go), ليس for 'is not' (ليس كبيراً, he is not big)",
    "Verb forms (الأوزان): derived patterns from the root add meaning — Form II فَعَّلَ (intensive/causative: دَرَّسَ taught), Form III فاعَلَ (reciprocal: كاتَبَ corresponded), Form X اِستَفعَلَ (اِستَخدَمَ istakhdama = used; often 'seek/request' as in اِستَغفَرَ = seek forgiveness)",
    "Comparative & superlative (اسم التفضيل): أَفعَل pattern — أَكبَر (bigger/biggest), أَصغَر (smaller), أَجمَل (more beautiful) — هو أكبر من أخيه (he is older than his brother)",
    "Future tense (المستقبل): prefix سـ or سوف + present verb — سيذهب (sa-yadhhabu, he will go), سوف أكتب (sawfa aktubu, I will write), ستدرس (sa-tadrusu, she will study)",
    "Imperative (فعل الأمر): command form built from the root — اُكتُبْ (uktub, write! m.), اِقرَأْ (iqraʾ, read!), اِذهَبْ (idhhab, go!), اِسمَعْ (ismaʿ, listen!)",
    "Demonstratives (أسماء الإشارة): هذا (hādhā, this m.), هذه (hādhihi, this f.), ذلك (dhālika, that m.), تلك (tilka, that f.), هؤلاء (hāʾulāʾ, these), أولئك (ulāʾika, those) — agree in gender and number",
    "Relative pronouns (الاسم الموصول): الذي (alladhī, who/which m.), التي (allatī, f.), الذين (alladhīna, m. pl.) — used only with definite nouns: الرجلُ الذي كتبَ (the man who wrote)",
    "كان وأخواتها (kāna and its sisters): put the predicate in the accusative — كان الطالبُ مجتهداً (kāna al-ṭālibu mujtahidan, the student was diligent); also أصبح (became), صار, ظلّ, ليس (is not)",
    "إنّ وأخواتها (inna and its sisters): put the subject noun in the accusative — إنّ اللهَ غفورٌ (inna Allāha ghafūrun, indeed God is forgiving); also أنّ (that), لكنّ (but), لأنّ (because), كأنّ (as if)",
    "The verbal noun (المصدر): an action noun derived from the verb — كَتَبَ → كِتابة (kitāba, writing), دَرَسَ → دِراسة (dirāsa, studying), قَرَأَ → قِراءة (qirāʾa, reading); used after أراد, يجب, etc.",
    "Active and passive participles (اسم الفاعل / اسم المفعول): كاتِب (kātib, one who writes / writer) vs مَكتوب (maktūb, written); عامِل (ʿāmil, worker) vs مَعمول (maʿmūl, made/done)"
  ],
  "hi": [
    "SOV sentence order: Subject + Object + Verb — मैं हिंदी सीखता हूँ (Main Hindī sīkhtā hūn = I Hindi learn) — verb always comes last",
    "Grammatical gender: every noun is masculine or feminine — लड़का (ladkā, boy, m.) vs लड़की (ladkī, girl, f.) — adjectives and verbs must agree in gender",
    "Verb agreement with subject gender: present tense verb changes — वह जाता है (vah jātā hai, he goes) vs वह जाती है (vah jātī hai, she goes)",
    "Present tense with है/हैं: verb stem + ता/ती/ते + है/हो/हूँ/हैं — मैं खाता हूँ (I eat, m.), वे जाते हैं (they go, m. pl.)",
    "Past tense with था/थी/थे: verb + ā/ī/e suffix + था/थी for habitual past — मैं खाता था (I used to eat, m.) — and perfective past with ने construction",
    "Postpositions (not prepositions): markers come AFTER the noun — घर में (ghar meṃ = in the house), स्कूल से (skūl se = from school), मेरे लिए (mere lie = for me)",
    "को (ko) postposition: marks indirect objects and certain direct objects — मुझे हिंदी पसंद है (mujhe Hindī pasand hai = I like Hindi, lit. 'to-me Hindi pleasing is')",
    "Infinitive + चाहिए/सकना/पड़ना: obligation and ability — मुझे जाना है (I have to go), वह बोल सकता है (he can speak), मुझे पानी चाहिए (I need water)",
    "Future tense: stem + ऊँगा/एगा/एँगे agreeing with gender — मैं जाऊँगा (main jāūṃgā, I will go, m.), वह करेगी (vah karegī, she will do), हम खाएँगे (ham khāeṃge, we will eat)",
    "Ergative ने (ne) construction: with transitive verbs in perfective past, subject takes ने and verb agrees with the OBJECT — मैंने किताब पढ़ी (maiṃne kitāb paṛhī, I read the book — verb agrees with feminine किताब)",
    "Oblique case: nouns change before postpositions — लड़का → लड़के (ladkā→ladke: लड़के को, to the boy), कमरा → कमरे में (kamre meṃ, in the room), plural masculine takes -ों (लड़कों को)",
    "Continuous & perfect aspects: रहा/रही/रहे + है for progressive (मैं जा रहा हूँ, I am going), चुका/चुकी for completed (मैं खा चुका हूँ, I have already eaten)",
    "Comparatives & superlatives: से (se) + ज़्यादा/कम for comparison — यह उससे बड़ा है (yah usse baṛā hai, this is bigger than that); सबसे (sabse) for superlative — सबसे अच्छा (sabse acchā, the best)",
    "Respect levels with आप/तुम/तू: आप (āp, formal/respectful) + plural verb (आप जाते हैं), तुम (tum, familiar) + तुम जाते हो, तू (tū, intimate/rude) + तू जाता है — pronoun choice signals social relationship",
    "Imperative and requests: तू + stem (बैठ, baiṭh), तुम + ओ (बैठो, baiṭho, sit! — familiar), आप + इए (बैठिए, baiṭhie, please sit — formal); negative मत — मत जाओ (mat jāo, don't go)",
    "Conjunctive participle कर/के ('having done'): links two actions by the same subject — खाना खाकर सो गया (khānā khākar so gayā, having eaten, he slept), घर जाकर आराम करो (ghar jākar ārām karo, go home and rest)",
    "अगर...तो conditional (if...then): अगर बारिश हुई तो मैं नहीं आऊँगा (agar bāriś huī to main nahīṃ āūṃgā, if it rains, I won't come), अगर तुम चाहो तो (agar tum cāho to, if you want)",
    "Subjunctive for wishes and possibility: verb + ए/एँ — शायद वह आए (śāyad vah āe, maybe he will come), ईश्वर करे (īśvar kare, may God grant it), मैं जाऊँ? (main jāūṃ?, shall I go?)",
    "Compound verbs with लेना/देना/जाना: add aspect or direction — खा लिया (khā liyā, ate up, for oneself), दे दिया (de diyā, gave away), सो गया (so gayā, fell asleep), पढ़ लो (paṛh lo, go ahead and read)",
    "Passive voice: verb stem + जाना (conjugated) — यह काम किया जाता है (yah kām kiyā jātā hai, this work is done), किताब पढ़ी गई (kitāb paṛhī gaī, the book was read), दरवाज़ा खोला गया (the door was opened)",
    "Relative-correlative जो...वह: paired clauses — जो मेहनत करता है, वह सफल होता है (jo mehnat kartā hai, vah saphal hotā hai, one who works hard succeeds), जो चाहो वह लो (jo cāho vah lo, take whatever you want)",
    "Causative verbs (करना → कराना/करवाना): make or have someone do — बच्चे को खाना खिलाया (bacce ko khānā khilāyā, fed the child — from खाना), बाल कटवाए (bāl kaṭvāe, got a haircut done), काम करवाया (kām karvāyā, had the work done)"
  ]
};

const CHEATSHEET_GROUPS = {
  "fr": [
    "Salutations et Formules de Politesse (Greetings & Politeness — 12 phrases: bonjour/bonsoir/salut/au revoir/merci/s'il vous plaît/pardon/excusez-moi)",
    "Les Nombres 1–20 plus 30/40/50/60/70/80/90/100/1000 (30 items, with the quatre-vingts pattern)",
    "Les Jours, les Mois et les Saisons (Days, Months & Seasons — 23 items)",
    "Verbes Essentiels: être/avoir/aller/faire/pouvoir/vouloir/devoir/savoir/venir/dire (10 verbs, conjugated je/tu/il)",
    "Mots Interrogatifs et Connecteurs (Question Words & Connectors — 14 items: qui/que/où/quand/comment/pourquoi/combien + et/mais/donc/parce que)",
    "Phrases de Survie: commander, demander son chemin, urgences (Survival Phrases — 15 phrases)",
    "L'Heure et le Temps (Time & Telling the Clock — 12 expressions)",
    "Adjectifs Courants et Contraires (Common Adjectives & Opposites — 16 items with feminine forms)",
    "Au Restaurant et la Nourriture (Food & Restaurant Phrases — 15 phrases)",
    "Les Articles et les Partitifs (Articles & Partitives — le/la/les, un/une/des, du/de la/des — 12 items)",
    "Prépositions et Expressions de Lieu (Prepositions & Place Expressions — 14 items: à/de/en/chez/sur/sous/dans/devant/derrière)",
    "Faux Amis et Expressions Idiomatiques (False Friends & Idioms — 12 items: actuellement = currently, assister à = to attend, ça marche, avoir faim/soif)"
  ],
  "es": [
    "Greetings & Farewells (12 phrases)",
    "Numbers 1–20 (20 items)",
    "Days & Months (19 items)",
    "Essential Verbs: ser/estar/tener/ir/hacer/poder/querer/saber/venir/decir (10 verbs, conjugated in yo/tú/él)",
    "Question Words & Common Connectors (12 items)",
    "Survival Phrases: ordering, directions, emergencies (15 phrases)",
    "Time & Telling the Clock (12 expressions)",
    "Common Adjectives & Opposites (16 items)",
    "Food & Restaurant Phrases (15 phrases)",
    "Shopping & Money: prices, sizes, paying (14 phrases)",
    "Weather & Small Talk (14 items)",
    "Family Members (14 items)"
  ],
  "pt": [
    "Greetings & Farewells (12 phrases)",
    "Numbers 1–20 (20 items)",
    "Days & Months (19 items)",
    "Essential Verbs: ser/estar/ter/ir/fazer/poder/querer/saber/vir/dizer (10 verbs, yo/tu/ele form)",
    "Question Words & Connectors (12 items)",
    "Survival Phrases: restaurant, transport, help (15 phrases)",
    "Time & Telling the Clock (12 expressions)",
    "Common Adjectives & Opposites (16 items)",
    "Food & Restaurant Phrases (15 phrases)",
    "Shopping & Money: prices, sizes, paying (14 phrases)",
    "Weather & Small Talk (14 items)",
    "Family Members (14 items)"
  ],
  "it": [
    "Greetings & Farewells (12 phrases)",
    "Numbers 1–20 (20 items)",
    "Days & Months (19 items)",
    "Essential Verbs: essere/avere/fare/andare/potere/volere/sapere/venire/dire/stare (10 verbs, io/tu/lui form)",
    "Question Words & Connectors (12 items)",
    "Survival Phrases: café, shopping, getting around (15 phrases)",
    "Time & Telling the Clock (12 expressions)",
    "Common Adjectives & Opposites (16 items)",
    "Food & Restaurant Phrases (15 phrases)",
    "Weather & Small Talk (14 items)",
    "Family Members (14 items)",
    "Polite Requests & Etiquette (12 phrases)"
  ],
  "de": [
    "Greetings & Farewells (12 phrases)",
    "Numbers 1–20 (20 items)",
    "Days & Months (19 items)",
    "Essential Verbs: sein/haben/machen/gehen/können/wollen/müssen/wissen/kommen/sagen (10 verbs, ich/du/er form)",
    "Question Words & Connectors (12 items)",
    "Survival Phrases: shopping, transport, asking for help (15 phrases)",
    "Time & Telling the Clock (12 expressions)",
    "Common Adjectives & Opposites (16 items)",
    "Food & Restaurant Phrases (15 phrases)",
    "Weather & Small Talk (14 items)",
    "Family Members (14 items)",
    "Polite Requests & Etiquette (12 phrases)"
  ],
  "en": [
    "Greetings & Social Phrases (12 phrases)",
    "Numbers 1–20 (20 items)",
    "Days, Months & Time Expressions (19 items)",
    "Essential Verbs: be/have/do/go/get/make/know/think/come/say (10 verbs, I/you/he form)",
    "Question Words & Common Connectors (12 items)",
    "Survival Phrases: formal requests, phone, email (15 phrases)",
    "Time & Telling the Clock (12 expressions)",
    "Common Adjectives & Opposites (16 items)",
    "Food & Restaurant Phrases (15 phrases)",
    "Shopping & Money: prices, sizes, paying (14 phrases)",
    "Weather & Small Talk (14 items)",
    "Family Members (14 items)"
  ],
  "zh": [
    "Greetings & Polite Phrases (12 phrases with pinyin)",
    "Numbers 1–20 plus 100/1000/10000 (23 items with pinyin)",
    "Days, Months & Time (19 items with pinyin)",
    "Essential Verbs: 是/有/在/去/来/做/说/要/可以/喜欢 (10 verbs with pinyin and tone marks)",
    "Question Words & Connectors (12 items with pinyin)",
    "Survival Phrases: ordering food, directions, shopping (15 phrases with pinyin)",
    "Time & Telling the Clock (12 expressions with pinyin)",
    "Common Adjectives & Opposites (16 items with pinyin)",
    "Food & Restaurant Phrases (15 phrases with pinyin)",
    "Weather & Small Talk (14 phrases with pinyin)",
    "Family Members: 爸爸/妈妈/哥哥/姐姐/弟弟/妹妹 (14 items with pinyin)",
    "Polite Requests & Etiquette (12 phrases with pinyin)"
  ],
  "ja": [
    "Greetings & Polite Expressions (12 phrases with hiragana and romaji)",
    "Numbers 1–20 plus 100/1000/10000 (23 items with hiragana and romaji)",
    "Days, Months & Time Expressions (19 items with hiragana and romaji)",
    "Essential Verbs in ます form: います/あります/します/いきます/きます/たべます/のみます/みます/ききます/かいます (10 verbs)",
    "Question Words & Connectors (12 items with hiragana and romaji)",
    "Survival Phrases: restaurant, transport, asking for help (15 phrases)",
    "Time & Telling the Clock (12 expressions with hiragana and romaji)",
    "Common Adjectives & Opposites (16 items with hiragana and romaji)",
    "Food & Restaurant Phrases (15 phrases with hiragana and romaji)",
    "Shopping & Money: prices, sizes, paying (14 phrases with hiragana and romaji)",
    "Weather & Small Talk (14 items with hiragana and romaji)",
    "Family Members: 父/母/兄/姉/弟/妹 in-group and out-group terms (14 items with hiragana and romaji)"
  ],
  "ko": [
    "Greetings & Polite Expressions (12 phrases with Hangul and romanization)",
    "Numbers: Native Korean 1–10 + Sino-Korean 1–10 + 20/30/100/1000 (24 items)",
    "Days, Months & Time Expressions (19 items with Hangul)",
    "Essential Verbs in -아/어요 form: 있어요/없어요/해요/가요/와요/먹어요/마셔요/봐요/들어요/사요 (10 verbs)",
    "Question Words & Connectors (12 items with Hangul)",
    "Survival Phrases: ordering, directions, polite requests (15 phrases)",
    "Time & Telling the Clock (12 expressions with Hangul and romanization)",
    "Common Adjectives & Opposites (16 items with Hangul and romanization)",
    "Food & Restaurant Phrases (15 phrases with Hangul and romanization)",
    "Shopping & Money: prices, sizes, paying (14 phrases with Hangul and romanization)",
    "Weather & Small Talk (14 items with Hangul and romanization)",
    "Family Members: 아버지/어머니/형/오빠/누나/언니/동생 (14 items with Hangul and romanization)"
  ],
  "ru": [
    "Greetings & Polite Phrases (12 phrases with Cyrillic)",
    "Numbers 1–20 plus 100/1000 (22 items with Cyrillic)",
    "Days, Months & Time Expressions (19 items with Cyrillic)",
    "Essential Verbs: быть/иметь/делать/идти/мочь/хотеть/знать/говорить/думать/любить — present tense я/ты/он form",
    "Question Words & Connectors (12 items with Cyrillic)",
    "Survival Phrases: shopping, directions, emergencies (15 phrases with Cyrillic)",
    "Time & Telling the Clock (12 expressions with Cyrillic)",
    "Common Adjectives & Opposites (16 items with Cyrillic)",
    "Food & Restaurant Phrases (15 phrases with Cyrillic)",
    "Weather & Small Talk (14 items with Cyrillic)",
    "Family Members: мама/папа/брат/сестра/бабушка/дедушка (14 items with Cyrillic)",
    "Polite Requests & Etiquette (12 phrases with Cyrillic)"
  ],
  "ar": [
    "Greetings & Polite Phrases (12 phrases in Arabic script with transliteration)",
    "Numbers 1–20 in Arabic script and numerals (20 items)",
    "Days, Months & Time Expressions (19 items in Arabic script)",
    "Essential Verbs in past/present: ذهب/يذهب, أكل/يأكل, شرب/يشرب, قال/يقول, كتب/يكتب, عمل/يعمل, أراد/يريد, عرف/يعرف, جاء/يجيء, نام/ينام",
    "Question Words & Common Connectors (12 items in Arabic)",
    "Survival Phrases: greetings, ordering, directions (15 phrases in Arabic)",
    "Time & Telling the Clock (12 expressions in Arabic script with transliteration)",
    "Common Adjectives & Opposites (16 items in Arabic script with transliteration)",
    "Food & Restaurant Phrases (15 phrases in Arabic script with transliteration)",
    "Shopping & Money: prices, bargaining, paying (14 phrases in Arabic script with transliteration)",
    "Weather & Small Talk (14 items in Arabic script with transliteration)",
    "Family Members: أب/أم/أخ/أخت/جد/جدة (14 items in Arabic script with transliteration)"
  ],
  "hi": [
    "अभिवादन और विदाई (Greetings & Farewells — 12 phrases in Devanagari with transliteration)",
    "गिनती (Numbers 1–20 + 50/100/1000 in Devanagari with transliteration)",
    "दिन, महीने और समय (Days, Months & Time — 19 items in Devanagari)",
    "ज़रूरी क्रियाएँ (Essential Verbs): होना/करना/जाना/आना/खाना/पीना/देखना/बोलना/समझना/चाहना — present tense मैं/तुम/वह forms with transliteration",
    "प्रश्नवाचक शब्द (Question Words & Connectors — 12 items: क्या/कहाँ/कब/कौन/क्यों/कैसे etc.)",
    "उत्तरजीविता वाक्यांश (Survival Phrases — 15 phrases: restaurant, transport, help, numbers in Devanagari)",
    "समय बताना (Time & Telling the Clock — 12 expressions in Devanagari with transliteration)",
    "सामान्य विशेषण और विलोम (Common Adjectives & Opposites — 16 items in Devanagari with transliteration)",
    "खाना और रेस्तरां वाक्यांश (Food & Restaurant Phrases — 15 phrases in Devanagari with transliteration)",
    "खरीदारी और पैसे (Shopping & Money — 14 phrases in Devanagari with transliteration)",
    "मौसम और बातचीत (Weather & Small Talk — 14 items in Devanagari with transliteration)",
    "परिवार के सदस्य (Family Members — 14 items in Devanagari with transliteration)"
  ]
};

const STRUCTURE_TOPICS = {
  "fr": [
    "Sujet + Verbe + Objet (SVO basic statement) — Je mange une pomme. (I eat an apple.) / Marie lit un livre. (Marie is reading a book.)",
    "Question with est-ce que: Est-ce que + phrase déclarative (Est-ce que tu parles français? Do you speak French? / Est-ce qu'il vient ce soir? Is he coming tonight?)",
    "Inversion: Verbe-Sujet reliés par un trait d'union (Parlez-vous anglais? Do you speak English? / Où habite-t-il? Where does he live? — the -t- is added between two vowels)",
    "Négation: ne + verbe + pas (Je ne comprends pas. I don't understand. / Elle n'aime pas le café. She doesn't like coffee.)",
    "Aller + infinitif: futur proche (Je vais partir demain. I'm going to leave tomorrow. / On va manger au restaurant. We're going to eat at the restaurant.)",
    "Être en train de + infinitif: action en cours (Je suis en train de travailler. I am (in the middle of) working. / Ils sont en train de dîner. They are having dinner right now.)",
    "Il y a: there is / there are (Il y a un problème. There is a problem. / Il y a beaucoup de gens ici. There are a lot of people here.)",
    "C'est / Ce sont: identifier ou présenter (C'est mon frère. This is my brother. / Ce sont mes collègues. These are my colleagues.)",
    "Depuis + durée: action commencée dans le passé et toujours en cours, au présent (J'habite à Paris depuis trois ans. I've been living in Paris for three years. / Elle apprend le français depuis janvier. She has been learning French since January.)",
    "Verbe + à / de + infinitif: commencer à, réussir à, essayer de, décider de (Je commence à comprendre. I'm starting to understand. / J'ai décidé de partir. I decided to leave.)",
    "Comparatif: plus/moins/aussi + adjectif + que (Elle est plus grande que moi. She is taller than I am. / Ce livre est aussi intéressant que l'autre. This book is as interesting as the other one.)",
    "Devoir / pouvoir / vouloir + infinitif: obligation, capacité, désir (Je dois travailler ce week-end. I have to work this weekend. / Est-ce que je peux vous aider? Can I help you?)",
    "Proposition relative avec qui / que: L'homme qui habite ici. (The man who lives here.) / Le livre que je lis est passionnant. (The book that I'm reading is fascinating.)",
    "Si + présent, futur simple: hypothèse réelle (Si j'ai le temps, je viendrai. If I have time, I will come. / Si tu étudies, tu réussiras. If you study, you will succeed.)",
    "Il faut que + subjonctif: nécessité (Il faut que tu partes maintenant. You have to leave now. / Il faut que nous soyons à l'heure. We must be on time.)",
    "Pour + infinitif: le but (J'apprends le français pour travailler à Paris. I'm learning French in order to work in Paris. / Elle économise pour acheter une maison. She's saving up to buy a house.)"
  ],
  "es": [
    "Subject + Verb + Object (SVO basic statement)",
    "Question with ¿...? (inversion optional, intonation often enough)",
    "Negation: no + verb (double negation: no...nada/nadie/nunca)",
    "Ir a + infinitive: near future (Voy a comer = I'm going to eat)",
    "Estar + gerundio: present progressive (Estoy comiendo = I am eating)",
    "Me gusta / Me gustan: expressing likes (indirect object + gustar)",
    "Hay: there is / there are (¿Hay + noun? for questions)",
    "Si + present, future: first conditional (Si tengo tiempo, voy al gym)",
    "Comparative: más/menos + adjective + que (Ella es más alta que yo. She is taller than I am.)",
    "Tener que + infinitive: obligation (Tengo que trabajar. I have to work.)",
    "Relative clause with que: el hombre que vive aquí (the man who lives here)",
    "Querer que + subjunctive: Quiero que vengas. (I want you to come.)",
    "Passive with ser: Ser + participio (La carta fue escrita por María. The letter was written by María.)",
    "Reported speech: Dijo que + clause (Dijo que estaba cansado. He said that he was tired.)",
    "Superlative: el/la más + adjective + de (Es el más alto de la clase. He is the tallest in the class.)",
    "Concessive with aunque: Aunque llueve, salgo. (Although it's raining, I go out.)"
  ],
  "pt": [
    "Subject + Verb + Object (SVO basic statement)",
    "Question formation: intonation or inversion (Você fala inglês? / Fala você inglês?)",
    "Negation: não before verb (Não falo japonês; não...nada/ninguém for double negation)",
    "Ir a + infinitive: near future (Vou falar = I'm going to speak)",
    "Estar + gerúndio: present progressive (Estou comendo = I am eating) — Brazil",
    "Gostar de: expressing likes (Gosto de música = I like music)",
    "Ter que + infinitive: obligation (Tenho que estudar = I have to study)",
    "Se + present, future: first conditional (Se tiver tempo, vou ao ginásio)",
    "Comparative: mais/menos + adjective + (do) que (Ela é mais alta do que eu. She is taller than I am.)",
    "Relative clause with que: o homem que mora aqui (the man who lives here)",
    "Querer que + subjunctive: Quero que você venha. (I want you to come.)",
    "Purpose with para + infinitive: Estudo para aprender. (I study in order to learn.)",
    "Passive with ser: Ser + particípio (O livro foi escrito em 1990. The book was written in 1990.)",
    "Reported speech: Disse que + clause (Ele disse que estava cansado. He said he was tired.)",
    "Superlative: o/a mais + adjective + de (Ela é a mais alta da turma. She is the tallest in the class.)",
    "Concessive with embora + subjunctive: Embora chova, eu saio. (Although it rains, I go out.)"
  ],
  "it": [
    "Subject + Verb + Object (SVO, subject pronoun often dropped — pro-drop language)",
    "Question with rising intonation or inversion (Parli italiano? / Stai bene?)",
    "Negation: non before verb (Non mangio carne; non...niente/nessuno for double negation)",
    "Stare + gerundio: present progressive (Sto mangiando = I am eating)",
    "Dovere + infinitive: must/have to (Devo studiare = I must study)",
    "Mi piace / Mi piacciono: expressing likes (mi piace + singular, mi piacciono + plural)",
    "Ecco: here is/are, there you go (Ecco il conto! / Ecco a te!)",
    "Se + present, future: first conditional (Se ho tempo, vengo)",
    "Comparative: più/meno + adjective + di/che (Marco è più alto di me. Marco is taller than I am.)",
    "Relative clause with che: l'uomo che abita qui (the man who lives here)",
    "Volere che + congiuntivo: Voglio che tu venga. (I want you to come.)",
    "C'è / ci sono: there is / there are (C'è un problema. / Ci sono molte persone. There is a problem. / There are many people.)",
    "Passive with essere: Essere + participio (Il libro è stato scritto nel 1990. The book was written in 1990.)",
    "Reported speech: Ha detto che + clause (Ha detto che era stanco. He said he was tired.)",
    "Superlative: il/la più + adjective + di/della (È il più alto della classe. He is the tallest in the class.)",
    "Purpose with per + infinitive: Studio per imparare. (I study in order to learn.)"
  ],
  "de": [
    "Statement word order: Subject + Verb (position 2) + rest (Ich esse heute Pizza)",
    "Question: verb moves to position 1 (Isst du Pizza? / Was isst du?)",
    "Negation: nicht after verb/before adjective (Ich esse nicht. / Das ist nicht gut.)",
    "Kein/keine: negation of nouns (Ich habe kein Geld / keine Zeit)",
    "Modal + infinitive at end: Ich kann heute nicht kommen (modal verb 2nd, infinitive last)",
    "Separable verb: prefix at end (Ich rufe dich morgen an / Wann fährst du ab?)",
    "Weil/dass: subordinate clause — verb goes to END (Ich bleibe zu Hause, weil ich krank bin)",
    "Wenn + past tense, würde: second conditional (Wenn ich Zeit hätte, würde ich kommen)",
    "Comparative: Adjective + -er + als (Er ist größer als ich. He is taller than I am.)",
    "Relative clause with der/die/das — verb to END (Der Mann, der dort wohnt. The man who lives there.)",
    "Es gibt + accusative: there is / there are (Es gibt einen Park. There is a park. / Es gibt viele Leute. There are many people.)",
    "Um...zu + infinitive: in order to (Ich lerne Deutsch, um in Berlin zu arbeiten. I study German in order to work in Berlin.)",
    "Passive with werden: werden + Partizip II (Das Buch wurde 1990 geschrieben. The book was written in 1990.)",
    "Perfect tense: haben/sein + Partizip II (Ich habe Pizza gegessen. I have eaten / I ate pizza.)",
    "Superlative: am + adjective + -sten (Er ist am größten. He is the tallest.)",
    "Concessive with obwohl — verb to END (Obwohl es regnet, gehe ich raus. Although it is raining, I go out.)"
  ],
  "en": [
    "Affirmative: Subject + Verb + Object (I eat pizza every day)",
    "Question with do/does/did: Do you speak English? / Where does she live?",
    "Negation with don't/doesn't/didn't: I don't like coffee / She doesn't work here",
    "Present Perfect: Subject + have/has + past participle (I have visited Paris three times)",
    "Passive voice: Subject + be + past participle (The book was written in 1984)",
    "Reporting speech: She said (that) she was tired / He asked if I could help",
    "Purpose clause with to/in order to/so that: I study English to get a better job",
    "Concessive clause with although/even though/despite: Although it was raining, we went out",
    "Comparative: adjective + -er/more + than (She is taller than her brother. This is more expensive than that.)",
    "Relative clause with who/which/that: The woman who called you is my sister.",
    "Second conditional: If + past, would + verb (If I had more time, I would travel more.)",
    "There is / there are: existential statement (There is a problem. / There are two options.)",
    "Superlative: the + adjective + -est / most (She is the tallest in the class. This is the most expensive option.)",
    "Present continuous: Subject + be + verb-ing (I am working right now. / They are studying.)",
    "First conditional: If + present, will + verb (If it rains, we will stay home.)",
    "Indirect question: no inversion in the embedded clause (Can you tell me where the station is?)"
  ],
  "zh": [
    "Basic SVO: Subject + Verb + Object (我喝茶. Wǒ hē chá. I drink tea.)",
    "Time-place before verb: Subject + Time + Place + Verb + Object (我今天在家工作)",
    "Question with 吗: statement + 吗? (你吃饭了吗? Did you eat?)",
    "Question with 呢: X + 呢? for 'what about X?' (我很好，你呢? I'm fine, and you?)",
    "了 for completed action: Verb + 了 (我吃了. I ate. / 他来了. He came.)",
    "想/要/可以 + verb: want to / need to / can (我想去北京. I want to go to Beijing.)",
    "比 comparison: A + 比 + B + Adj (苹果比橙子贵. Apples are more expensive than oranges.)",
    "是...的 emphasis: 是 + circumstance + 的 (他是昨天来的. It was yesterday that he came.)",
    "有 for existence: 有 + noun (桌子上有一本书. Zhuōzi shàng yǒu yì běn shū. There is a book on the table.)",
    "的 relative clause: modifier + 的 + noun (住在这里的人. Zhù zài zhèlǐ de rén. The person who lives here.)",
    "因为...所以: because...so (因为下雨，所以我不去. Yīnwèi xià yǔ, suǒyǐ wǒ bú qù. Because it's raining, I'm not going.)",
    "要/得 for obligation: 你得走了. Nǐ děi zǒu le. (You have to go now.)",
    "被 passive: A + 被 + (B) + Verb (我的手机被偷了. Wǒ de shǒujī bèi tōu le. My phone was stolen.)",
    "最 superlative: 最 + Adj (他是最高的. Tā shì zuì gāo de. He is the tallest.)",
    "正在 progressive: 正在 + Verb (我正在吃饭. Wǒ zhèngzài chīfàn. I am eating right now.)",
    "虽然...但是 concessive: 虽然下雨，但是我还去. (Suīrán xià yǔ, dànshì wǒ hái qù. Although it's raining, I still go.)"
  ],
  "ja": [
    "Basic SOV: Topic + Object + Verb (私はすしが好きです. I like sushi.)",
    "Verb + ます: polite present/future (食べます = eat/will eat; 行きます = go/will go)",
    "Verb + ました: polite past (食べました = ate; 行きました = went)",
    "Verb + ません: polite negative (食べません = don't eat; 行きません = don't go)",
    "Noun + です: polite nominal sentence (これはりんごです. This is an apple.)",
    "Verb て-form + ください: polite request (ゆっくり話してください. Please speak slowly.)",
    "Verb て-form + います: ongoing action or habitual (今、食べています. I am eating now.)",
    "〜たいです: want to do (日本語を勉強したいです. I want to study Japanese.)",
    "〜より〜のほうが: comparison (犬より猫のほうが好きです. Inu yori neko no hō ga suki desu. I like cats more than dogs.)",
    "があります/います: existence — inanimate/animate (机の上に本があります. Tsukue no ue ni hon ga arimasu. There is a book on the desk.)",
    "Plain verb + 名詞: relative clause (ここに住んでいる人. Koko ni sunde iru hito. The person who lives here.)",
    "〜から: because/reason clause (雨が降っているから、行きません. Ame ga futte iru kara, ikimasen. Because it's raining, I won't go.)",
    "〜れる/られる passive: 財布が盗まれました. (Saifu ga nusumaremashita. My wallet was stolen.)",
    "一番 superlative: 一番 + adjective (富士山が一番高いです. Fujisan ga ichiban takai desu. Mt. Fuji is the highest.)",
    "〜なければなりません: obligation (今行かなければなりません. Ima ikanakereba narimasen. I have to go now.)",
    "〜たら conditional: 時間があったら、行きます. (Jikan ga attara, ikimasu. If I have time, I'll go.)"
  ],
  "ko": [
    "Basic SOV: Subject + Object + Predicate (나는 사과를 먹어요. I eat an apple.)",
    "Verb stem + 아/어요: polite present (먹어요 = eat, 가요 = go, 있어요 = there is/have)",
    "Verb stem + 았/었어요: past tense (먹었어요 = ate, 갔어요 = went, 했어요 = did)",
    "-(으)ㄹ 거예요: future intention (먹을 거예요 = will eat, 갈 거예요 = will go)",
    "이에요/예요: 'to be' with nouns (학생이에요 = am/is/are a student, 한국이에요 = is Korea)",
    "안 + verb / verb + 지 않아요: negation (안 먹어요 / 먹지 않아요 = don't eat)",
    "Noun + 이/가 있어요 (없어요): existence (시간이 있어요 = I have time, 돈이 없어요 = no money)",
    "-(으)세요: honorific request/statement (앉으세요 = please sit, 천천히 말씀해 주세요 = please speak slowly)",
    "보다 + 더: comparison (사과가 오렌지보다 더 비싸요. Sagwaga orenjiboda deo bissayo. Apples are more expensive than oranges.)",
    "-아/어야 해요: obligation (지금 가야 해요. Jigeum gaya haeyo. I have to go now.)",
    "Verb + 는 + noun: relative clause (여기 사는 사람. Yeogi saneun saram. The person who lives here.)",
    "-고 싶어요: want to do (한국어를 공부하고 싶어요. Hangugeoreul gongbuhago sipeoyo. I want to study Korean.)",
    "-고 있어요: present progressive (지금 먹고 있어요. Jigeum meokgo isseoyo. I am eating now.)",
    "가장/제일: superlative (백두산이 가장 높아요. Baekdusani gajang nopayo. Baekdu Mountain is the highest.)",
    "-(으)ㄹ 수 있어요: ability (한국어를 할 수 있어요. Hangugeoreul hal su isseoyo. I can speak Korean.)",
    "-(으)면: conditional (시간이 있으면 갈 거예요. Sigani isseumyeon gal geoyeyo. If I have time, I will go.)"
  ],
  "ru": [
    "Simple sentence: Subject (Nominative) + Verb + Object (Accusative) — Я читаю книгу. I read a book.",
    "Question by intonation: same word order, rising intonation — Ты читаешь книгу? / Где ты живёшь?",
    "Negation: не before verb — Я не говорю по-русски. I don't speak Russian.",
    "У меня есть: 'I have' — У + genitive + есть + nominative (У меня есть кошка. I have a cat.)",
    "Нет + genitive: 'there is no' or negating possession — У меня нет кошки. / Нет времени.",
    "Я хочу/могу/должен + infinitive: want/can/must (Я хочу поехать в Москву.)",
    "В/На + Prepositional: location (Я живу в России. / Книга лежит на столе.)",
    "Если + present, future: first conditional (Если у меня будет время, я позвоню.)",
    "Comparative: adjective + -ее / больше, чем — Она выше, чем я. (Ona výše, chem ya. She is taller than I am.)",
    "Который relative clause: Человек, который живёт здесь. (Chelovék, kotóryy zhivyót zdes. The man who lives here.)",
    "Мне надо/нужно + infinitive: necessity — Мне надо идти. (Mne nado idtí. I need to go.)",
    "Потому что: because — Я остаюсь дома, потому что я болен. (Ya ostayús doma, potomú chto ya bólen. I'm staying home because I'm sick.)",
    "Самый superlative: самый + adjective — Это самый высокий дом. (Eto sámyy vysókiy dom. This is the tallest house.)",
    "Reflexive -ся verbs: Я учусь в университете. (Ya uchús v universitéte. I study at university.)",
    "Чтобы + infinitive: purpose — Я учу русский, чтобы работать в Москве. (Ya uchú rússkiy, chtóby rabótat v Moskvé. I study Russian in order to work in Moscow.)",
    "Хотя concessive: Хотя идёт дождь, я иду гулять. (Khotyá idyót dozhd, ya idú gulyát. Although it's raining, I go for a walk.)"
  ],
  "ar": [
    "Nominal sentence (الجملة الاسمية): Subject + Predicate, no verb 'to be' in present (الطقس جميل = The weather [is] beautiful)",
    "Verbal sentence (الجملة الفعلية): Verb + Subject + Object, VSO order (ذهب الولد إلى المدرسة = The boy went to school)",
    "Question with هل/أ: هل + statement for yes/no question (هل تتكلم العربية؟ = Do you speak Arabic?)",
    "Negation: لا + present verb, لم + jussive for past (لا أعرف = I don't know, لم أذهب = I didn't go)",
    "Definite/Indefinite: كتاب (a book) vs الكتاب (the book) — adjective agrees: كتاب كبير / الكتاب الكبير",
    "كان + adjective/noun: past 'to be' (كان الطقس جميلاً = The weather was beautiful)",
    "إضافة (Idafa): noun + noun possession without of (بيت الرجل = the man's house, lit. house-the man)",
    "ليس: 'is not' for present negation of nominal sentences (ليس الطقس جميلاً = The weather is not beautiful)",
    "Comparative with أَفْعَل + مِن: الكتاب أكبر من القلم (al-kitāb akbar min al-qalam = The book is bigger than the pen)",
    "أريد أن + subjunctive: 'I want to' (أريد أن أتعلم العربية = urīdu an ataʿallama al-ʿarabiyya = I want to learn Arabic)",
    "يجب أن + subjunctive: obligation (يجب أن أذهب الآن = yajib an adhhaba al-ān = I must go now)",
    "لأن: because — أبقى في البيت لأنني مريض (abqā fī al-bayt li-annanī marīḍ = I stay home because I am sick)",
    "Future with سـ/سوف: سأذهب إلى السوق غداً (sa-adhhabu ilā as-sūq ghadan = I will go to the market tomorrow)",
    "Relative with الذي/التي: الرجل الذي يسكن هنا (ar-rajul alladhī yaskun hunā = the man who lives here)",
    "Conditional with إذا: إذا كان عندي وقت، سأتصل بك (idhā kāna ʿindī waqt, sa-attaṣilu bik = If I have time, I will call you)",
    "Superlative with الأفعل: هو الأطول في الصف (huwa al-aṭwal fī aṣ-ṣaff = He is the tallest in the class)"
  ],
  "hi": [
    "Basic SOV: Subject + Object + Verb (मैं पानी पीता हूँ. Main pānī pītā hūn. I drink water.)",
    "Postposition से (se): from/by/with — दिल्ली से (from Delhi), मुझसे बात करो (talk with me)",
    "Postposition को (ko): to/for/at — उसको (to him/her), मुझको (to me), रात को (at night)",
    "में/पर for location: में = inside (घर में = in the house), पर = on/at surface (मेज़ पर = on the table)",
    "चाहना/पसंद होना for wants and likes: मुझे चाय चाहिए (I want tea), मुझे हिंदी पसंद है (I like Hindi)",
    "क्या + sentence = yes/no question: क्या आप हिंदी बोलते हैं? (Do you speak Hindi?)",
    "ने construction for perfective past: transitive verbs — मैंने खाना खाया (I ate food) — subject takes ने, object takes nothing",
    "नहीं for negation: before verb — मैं नहीं जाता (I don't go) / जाना नहीं है (don't have to go)",
    "Comparison with से ज़्यादा: A + B से ज़्यादा + adjective (सेब संतरे से ज़्यादा महँगा है. Seb santare se zyādā mahngā hai. The apple is more expensive than the orange.)",
    "जो relative clause: जो आदमी यहाँ रहता है (jo ādmī yahān rahtā hai = the man who lives here)",
    "को + चाहिए / पड़ना for obligation: मुझे जाना है (mujhe jānā hai = I have to go), मुझे काम करना पड़ता है (I have to work)",
    "क्योंकि / इसलिए for cause: मैं घर पर हूँ क्योंकि मैं बीमार हूँ (Main ghar par hūn kyunki main bīmār hūn. I am at home because I am sick.)",
    "Future tense गा/गी/गे: मैं कल दिल्ली जाऊँगा (Main kal Dillī jāūngā. I will go to Delhi tomorrow.)",
    "Present continuous रहा/रही है: मैं अभी खाना खा रहा हूँ (Main abhī khānā khā rahā hūn. I am eating now.)",
    "Superlative with सबसे: वह सबसे लंबा है (Vah sabse lambā hai. He is the tallest.)",
    "Conditional अगर...तो: अगर समय होगा तो मैं आऊँगा (Agar samay hogā to main āūngā. If I have time, I will come.)"
  ]
};

const VOCAB_CATEGORIES = {
  "fr": [
    "Les Nombres (Numbers) — 0 à 30 + 40/50/60/70/80/90/100/1000, including the tricky 70 = soixante-dix, 80 = quatre-vingts, 90 = quatre-vingt-dix",
    "Les Couleurs et les Formes (Colors & Shapes) — with masculine/feminine agreement notes (blanc/blanche, vert/verte)",
    "La Famille et les Relations (Family & Relationships) — including belle-mère/beau-père and step/in-law terms",
    "La Nourriture et les Boissons (Food & Drink) — French cuisine favorites included, 20 common items",
    "Les Voyages et les Transports (Travel & Transport)",
    "Le Temps et les Saisons (Weather & Seasons) — il fait beau/mauvais expressions",
    "Le Corps Humain (The Human Body)",
    "Les Adjectifs Essentiels (Essential Adjectives) — opposite pairs, with feminine forms noted",
    "Les Jours, les Mois et les Mots du Temps (Days, Months & Time words)",
    "Les Verbes Courants (Common Verbs) — daily actions",
    "La Maison et les Meubles (House & Furniture)",
    "Les Vêtements (Clothing)",
    "Les Émotions et les Sentiments (Emotions & Feelings)",
    "Les Métiers et les Professions (Jobs & Professions) — with masculine/feminine forms",
    "En Ville: lieux et commerces (In Town: places & shops)",
    "La Technologie et la Communication (Technology & Communication)"
  ],
  "es": [
    "Los Números (Numbers) — 0 to 30 + 40/50/60/70/80/90/100/1000",
    "Los Colores y Formas (Colors & Shapes)",
    "La Familia y las Relaciones (Family & Relationships)",
    "La Comida y Bebida (Food & Drink) — 20 common items",
    "Viajes y Transporte (Travel & Transport)",
    "El Tiempo y las Estaciones (Weather & Seasons)",
    "El Cuerpo Humano (The Human Body)",
    "Adjetivos Esenciales (Essential Adjectives) — opposites pairs",
    "Los Días, Meses y el Tiempo (Days, Months & Time words)",
    "Verbos Comunes (Common Verbs) — daily actions",
    "La Casa y los Muebles (House & Furniture)",
    "La Ropa (Clothing)",
    "Lugares de la Ciudad (Places in Town)",
    "Animales y Naturaleza (Animals & Nature)",
    "El Dinero y las Compras (Money & Shopping)",
    "Tecnología y Comunicación (Technology & Communication)"
  ],
  "pt": [
    "Os Números (Numbers) — 0 to 30 + 40/50/100/1000",
    "As Cores e Formas (Colors & Shapes)",
    "A Família e Relações (Family & Relationships)",
    "Comida e Bebida (Food & Drink) — Brazilian favorites included",
    "Viagens e Transporte (Travel & Transport)",
    "O Tempo e as Estações (Weather & Seasons)",
    "O Corpo Humano (The Human Body)",
    "Adjetivos Essenciais (Essential Adjectives) — opposite pairs",
    "Dias, Meses e Palavras de Tempo (Days, Months & Time words)",
    "Verbos Comuns (Common Verbs) — daily actions",
    "A Casa e os Móveis (House & Furniture)",
    "As Roupas (Clothing)",
    "Lugares da Cidade (Places in Town)",
    "Animais e Natureza (Animals & Nature)",
    "Dinheiro e Compras (Money & Shopping)",
    "Tecnologia e Comunicação (Technology & Communication)"
  ],
  "it": [
    "I Numeri (Numbers) — 0 to 30 + 40/50/100/1000",
    "I Colori e le Forme (Colors & Shapes)",
    "La Famiglia e le Relazioni (Family & Relationships)",
    "Il Cibo e le Bevande (Food & Drink) — Italian specialties included",
    "Viaggi e Trasporti (Travel & Transport)",
    "Il Tempo e le Stagioni (Weather & Seasons)",
    "Il Corpo Umano (The Human Body)",
    "Aggettivi Essenziali (Essential Adjectives) — opposite pairs",
    "I Giorni, i Mesi e le Parole del Tempo (Days, Months & Time words)",
    "Verbi Comuni (Common Verbs) — daily actions",
    "La Casa e i Mobili (House & Furniture)",
    "I Vestiti (Clothing)",
    "Luoghi della Città (Places in Town)",
    "Animali e Natura (Animals & Nature)",
    "I Soldi e lo Shopping (Money & Shopping)",
    "Tecnologia e Comunicazione (Technology & Communication)"
  ],
  "de": [
    "Die Zahlen (Numbers) — 0 to 30 + 40/50/100/1000",
    "Die Farben und Formen (Colors & Shapes)",
    "Die Familie und Beziehungen (Family & Relationships)",
    "Essen und Trinken (Food & Drink) — German classics included",
    "Reisen und Verkehr (Travel & Transport)",
    "Das Wetter und Jahreszeiten (Weather & Seasons)",
    "Der menschliche Körper (The Human Body)",
    "Wichtige Adjektive (Essential Adjectives) — opposite pairs, with gender note",
    "Tage, Monate und Zeitwörter (Days, Months & Time words)",
    "Häufige Verben (Common Verbs) — daily actions",
    "Haus und Möbel (House & Furniture) — with gender note",
    "Kleidung (Clothing) — with gender note",
    "Orte in der Stadt (Places in Town) — with gender note",
    "Tiere und Natur (Animals & Nature) — with gender note",
    "Geld und Einkaufen (Money & Shopping) — with gender note",
    "Technologie und Kommunikation (Technology & Communication) — with gender note"
  ],
  "en": [
    "Numbers & Quantities (0 to 30 + fractions + ordinals)",
    "Colors, Shapes & Sizes",
    "Family & Social Relationships",
    "Food, Drink & Cooking Verbs",
    "Travel, Transport & Directions",
    "Work & Daily Routine Verbs",
    "Emotions & Mental States",
    "Essential Adjectives & Their Opposites",
    "Days, Months & Time Words",
    "House & Furniture",
    "Clothing & Accessories",
    "Jobs & Professions",
    "Places in Town & Buildings",
    "Animals & Nature",
    "Money, Banking & Shopping",
    "Technology & Communication"
  ],
  "zh": [
    "数字 Shùzì (Numbers) — 0–20 + 百/千/万 + phone/price reading patterns, with pinyin + tones",
    "颜色和形状 (Colors & Shapes) — all with pinyin and tones",
    "家人和关系 (Family & Relationships) — including different terms for maternal/paternal relatives",
    "食物和饮料 (Food & Drink) — Chinese cuisine focus, all with pinyin",
    "出行和交通 (Travel & Transport) — all with pinyin",
    "时间和天气 (Time & Weather) — all with pinyin",
    "身体部位 (Body Parts) — all with pinyin",
    "常用形容词 (Common Adjectives) — opposite pairs, all with pinyin",
    "星期、月份和时间词 (Days, Months & Time words) — all with pinyin",
    "常用动词 (Common Verbs) — daily actions, all with pinyin",
    "衣服 (Clothing) — all with pinyin",
    "职业 (Jobs & Professions) — all with pinyin",
    "城镇场所 (Places in Town) — all with pinyin",
    "动物和自然 (Animals & Nature) — all with pinyin",
    "金钱和购物 (Money & Shopping) — all with pinyin",
    "科技和通讯 (Technology & Communication) — all with pinyin"
  ],
  "ja": [
    "数字 Sūji (Numbers) — 1–20 + 100/1000/10000 + Japanese counter 〜つ, in hiragana and romaji",
    "色と形 (Colors & Shapes) — in hiragana/kanji with romaji",
    "家族と関係 (Family & Relationships) — in-group (uchi) vs out-group (soto) terms both listed",
    "食べ物と飲み物 (Food & Drink) — Japanese cuisine focus, hiragana/kanji and romaji",
    "旅行と交通 (Travel & Transport) — in hiragana/kanji with romaji",
    "時間と天気 (Time & Weather) — in hiragana/kanji with romaji",
    "体の部位 (Body Parts) — in hiragana/kanji with romaji",
    "基本形容詞 (Basic Adjectives) — い-adj and な-adj labeled, opposite pairs",
    "曜日・月・時間の言葉 (Days, Months & Time words) — in hiragana/kanji with romaji",
    "よく使う動詞 (Common Verbs) — daily actions, dictionary form with romaji",
    "衣類 (Clothing) — in hiragana/kanji with romaji",
    "職業 (Jobs & Professions) — in hiragana/kanji with romaji",
    "町の場所 (Places in Town) — in hiragana/kanji with romaji",
    "動物と自然 (Animals & Nature) — in hiragana/kanji with romaji",
    "お金と買い物 (Money & Shopping) — in hiragana/kanji with romaji",
    "テクノロジーと通信 (Technology & Communication) — in hiragana/kanji with romaji"
  ],
  "ko": [
    "숫자 (Numbers) — native Korean 1–10 + sino-Korean 1–10 + 20/30/100/1000, with romanization",
    "색깔과 모양 (Colors & Shapes) — with romanization",
    "가족과 관계 (Family & Relationships) — formal and informal terms",
    "음식과 음료 (Food & Drink) — Korean cuisine focus, with romanization",
    "여행과 교통 (Travel & Transport) — with romanization",
    "시간과 날씨 (Time & Weather) — with romanization",
    "신체 부위 (Body Parts) — with romanization",
    "기본 형용사 (Basic Adjectives) — descriptive verb form listed, opposites paired",
    "요일, 월, 시간 표현 (Days, Months & Time words) — with romanization",
    "자주 쓰는 동사 (Common Verbs) — daily actions, with romanization",
    "옷 (Clothing) — with romanization",
    "직업 (Jobs & Professions) — with romanization",
    "동네 장소 (Places in Town) — with romanization",
    "동물과 자연 (Animals & Nature) — with romanization",
    "돈과 쇼핑 (Money & Shopping) — with romanization",
    "기술과 통신 (Technology & Communication) — with romanization"
  ],
  "ru": [
    "Числа (Numbers) — 1–20 + 30/40/50/100/1000 in Cyrillic + genitive rule for 2/3/4 vs 5+",
    "Цвета и Формы (Colors & Shapes) — in Cyrillic with stress marks",
    "Семья и Отношения (Family & Relationships) — in Cyrillic",
    "Еда и Напитки (Food & Drink) — Russian cuisine included, Cyrillic + stress",
    "Путешествия и Транспорт (Travel & Transport) — in Cyrillic",
    "Погода и Времена года (Weather & Seasons) — in Cyrillic",
    "Части Тела (Body Parts) — in Cyrillic",
    "Основные Прилагательные (Essential Adjectives) — short and long form noted, opposite pairs",
    "Дни, Месяцы и Слова о Времени (Days, Months & Time words) — in Cyrillic with stress",
    "Обычные Глаголы (Common Verbs) — daily actions, in Cyrillic with stress",
    "Одежда (Clothing) — in Cyrillic with stress",
    "Профессии (Jobs & Professions) — in Cyrillic with stress",
    "Места в Городе (Places in Town) — in Cyrillic",
    "Животные и Природа (Animals & Nature) — in Cyrillic",
    "Деньги и Покупки (Money & Shopping) — in Cyrillic",
    "Технологии и Связь (Technology & Communication) — in Cyrillic"
  ],
  "ar": [
    "الأرقام (Numbers) — 1–20 in Arabic script + numerals + how Arabic numbers are written right-to-left",
    "الألوان والأشكال (Colors & Shapes) — in Arabic script with transliteration, masculine and feminine forms",
    "العائلة والعلاقات (Family & Relationships) — in Arabic with transliteration",
    "الطعام والشراب (Food & Drink) — Middle Eastern cuisine, Arabic script + transliteration",
    "السفر والمواصلات (Travel & Transport) — Arabic script + transliteration",
    "الطقس والفصول (Weather & Seasons) — Arabic script + transliteration",
    "أجزاء الجسم (Body Parts) — Arabic script + transliteration",
    "الصفات الأساسية (Essential Adjectives) — masculine and feminine forms, opposite pairs",
    "الأيام والشهور وكلمات الوقت (Days, Months & Time words) — Arabic script + transliteration",
    "الأفعال الشائعة (Common Verbs) — daily actions, Arabic script + transliteration",
    "الملابس (Clothing) — Arabic script + transliteration",
    "المهن (Jobs & Professions) — Arabic script + transliteration",
    "أماكن في المدينة (Places in Town) — Arabic script + transliteration",
    "الحيوانات والطبيعة (Animals & Nature) — Arabic script + transliteration",
    "المال والتسوق (Money & Shopping) — Arabic script + transliteration",
    "التكنولوجيا والاتصالات (Technology & Communication) — Arabic script + transliteration"
  ],
  "hi": [
    "गिनती (Numbers) — 0–30 + 40/50/100/1000 in Devanagari with transliteration",
    "रंग और आकार (Colors & Shapes) — in Devanagari with transliteration and gender notes",
    "परिवार और रिश्ते (Family & Relationships) — in Devanagari, different terms for maternal/paternal relatives",
    "खाना और पेय (Food & Drink) — Indian cuisine and street food, Devanagari + transliteration",
    "यात्रा और परिवहन (Travel & Transport) — Devanagari + transliteration",
    "मौसम और ऋतुएँ (Weather & Seasons) — Devanagari + transliteration, all 6 Indian seasons",
    "शरीर के अंग (Body Parts) — Devanagari + transliteration",
    "ज़रूरी विशेषण (Essential Adjectives) — masculine and feminine forms, opposite pairs, Devanagari",
    "दिन, महीने और समय के शब्द (Days, Months & Time words) — Devanagari + transliteration",
    "रोज़मर्रा की क्रियाएँ (Common Verbs) — daily actions, Devanagari + transliteration",
    "कपड़े (Clothing) — Devanagari + transliteration",
    "पेशे (Jobs & Professions) — Devanagari + transliteration",
    "शहर की जगहें (Places in Town) — Devanagari + transliteration",
    "जानवर और प्रकृति (Animals & Nature) — Devanagari + transliteration",
    "पैसा और खरीदारी (Money & Shopping) — Devanagari + transliteration",
    "तकनीक और संचार (Technology & Communication) — Devanagari + transliteration"
  ]
};

// ── Dialogue scenarios — 5 real-life scenes per language ─────────────────────
const DIALOGUE_SCENARIOS = {
  "fr": [
    "Salutations et présentations dans un café parisien (two people meeting for the first time — exchanging names, jobs, where they're from, shifting from vous to tu)",
    "Au restaurant: commander un repas, poser des questions sur le menu, demander l'addition (ordering entrée/plat/dessert, choosing wine, paying the bill)",
    "Demander son chemin dans Paris — finding a station de métro, a pharmacie and a musée, using polite request forms (Pourriez-vous me dire...)",
    "Faire les courses au marché — asking prices, quantities (un kilo, une livre, une douzaine), freshness, and paying",
    "Un appel téléphonique pour prendre un rendez-vous chez le médecin — expliquer les symptômes, proposer une date, confirmer l'heure",
    "À la boulangerie puis à l'hôtel — acheter une baguette et des viennoiseries, ensuite faire l'enregistrement à l'hôtel (checking in, type de chambre, petit-déjeuner inclus, signaler un problème dans la chambre)"
  ],
  "es": [
    "Greetings & introductions at a social gathering (2 strangers meeting, exchanging names, jobs, where they are from)",
    "At a restaurant: ordering food and drinks, asking about the menu, paying the bill",
    "Asking for and giving directions in a city (finding a metro station, a pharmacy, a hotel)",
    "Shopping for clothes: asking about sizes, colors, prices, trying on items",
    "A phone call to make a doctor's appointment, explain symptoms, confirm the time",
    "At a Spanish post office (Correos) — sending a package, asking about postage and delivery times, filling out the form"
  ],
  "pt": [
    "Greetings & introductions at a café in Brazil (two people meeting for the first time)",
    "Ordering food at a Brazilian churrascaria — asking about the menu, drinks, and the bill",
    "Asking for directions in São Paulo — finding a metro station and a pharmacy",
    "Shopping at a market — asking prices, bargaining politely, paying",
    "Calling to book a hotel room — dates, room type, price, breakfast included",
    "A job interview in Brazil — introducing yourself, describing your experience, discussing hours and salary"
  ],
  "it": [
    "Greetings & introductions at an Italian dinner party (formal and informal register)",
    "At a bar ordering a coffee and a pastry — typical Italian bar interaction",
    "Asking for directions in Rome — finding the Colosseum, a bus stop, a pharmacy",
    "Buying fresh produce at a market — asking for quantities, prices, freshness",
    "Booking a table at a restaurant by phone — date, time, number of guests, dietary needs",
    "At an Italian pharmacy (farmacia) — describing symptoms, asking the pharmacist for medicine, understanding the dosage"
  ],
  "de": [
    "Greetings & self-introduction in a professional setting (new colleague at work)",
    "At a German bakery and supermarket — ordering bread, asking for items, paying",
    "Asking for directions in Berlin — public transport, U-Bahn, bus connections",
    "At a doctor's appointment — explaining symptoms, understanding the doctor's advice",
    "Renting an apartment: asking about the size, rent, utilities, lease duration",
    "At a German bank (Bank) — opening an account, asking about fees, transferring money, understanding the forms"
  ],
  "en": [
    "Job interview: introducing yourself, describing experience, answering common questions",
    "At a hotel: checking in, asking about facilities, reporting a problem with the room",
    "Making plans with a friend: suggesting activities, agreeing/disagreeing, confirming a time and place",
    "A formal meeting: presenting an idea, asking for clarification, agreeing on next steps",
    "At a hospital or pharmacy: describing symptoms, asking about medication, understanding instructions",
    "Meeting a friend's family for dinner — small talk, complimenting the host, thanking them and offering to help"
  ],
  "zh": [
    "Greetings and self-introductions at a Chinese university (name, nationality, why learning Chinese)",
    "Ordering food at a Chinese restaurant — asking about dishes, spice level, drinks, the bill",
    "Taking a taxi in Beijing — giving the destination, asking about the fare, making conversation",
    "Shopping at a Chinese market — asking prices, bargaining, paying with WeChat Pay",
    "Calling to book a hotel room in Mandarin — dates, room type, price, special requests",
    "Visiting a Chinese clinic or pharmacy (药店) — describing symptoms, asking for medicine, understanding how to take it"
  ],
  "ja": [
    "Greetings and self-introductions in a Japanese workplace setting (name, company, role)",
    "Ordering at a Japanese ramen restaurant — reading the menu, ordering, asking about toppings",
    "Asking for directions near Shibuya station — finding a convenience store, the exit, a café",
    "Shopping at a Japanese department store — asking a staff member for help, sizes, gift wrapping",
    "A phone call to make a reservation at a ryokan (traditional inn) — dates, room, dinner included",
    "At a Japanese post office (郵便局) — sending a package abroad, asking about the cost, delivery time, and forms"
  ],
  "ko": [
    "Greetings and self-introductions at a Korean language exchange event",
    "Ordering Korean food at a restaurant — samgyeopsal, drinks, asking for more side dishes (반찬)",
    "Asking for directions in Seoul — finding the subway exit, a convenience store, Gyeongbokgung",
    "Shopping at a Korean cosmetics store — asking about products, skin type recommendations, prices",
    "Making a phone call to book a Korean cooking class — date, time, what to bring, price",
    "At a Korean pharmacy (약국) — describing symptoms, asking the pharmacist for medicine, understanding how to take it"
  ],
  "ru": [
    "Greetings and self-introductions at a Russian cultural event (name, city, occupation)",
    "At a Russian café: ordering tea, coffee, a dish from the menu, asking for the bill",
    "Asking for directions in Moscow — finding Red Square, a metro station, a pharmacy (аптека)",
    "Shopping at a Russian supermarket — asking where items are, quantities, paying at the cashier",
    "Booking a train ticket at a ticket office — destination, class, date, one-way or return",
    "At a Russian post office (почта) — sending a parcel, buying stamps, asking about delivery times and the cost"
  ],
  "ar": [
    "Greetings and self-introductions using formal Modern Standard Arabic (name, country, purpose of learning Arabic)",
    "At a Middle Eastern restaurant: ordering mezze, main dishes, tea, and asking for the bill",
    "Asking for directions in Cairo — finding a mosque, a bank, a taxi, using polite request forms",
    "Shopping at a souk (market): asking about goods, negotiating prices, expressing satisfaction",
    "A phone call to arrange a meeting with a colleague — time, place, agenda, confirming details",
    "At a pharmacy (صيدلية) in an Arab city — describing symptoms, asking the pharmacist for medicine, understanding the instructions"
  ],
  "hi": [
    "Greetings and self-introductions in Hindi — first meeting, exchanging names, cities, and why learning Hindi",
    "Ordering food at a dhaba (roadside restaurant) — asking about the menu, chai, paying the bill",
    "Asking for directions in Delhi — finding a metro station, a market, and using please/thank you correctly",
    "Bargaining at a bazaar — asking prices, negotiating, expressing that something is too expensive",
    "Booking a train ticket at a counter — destination, class (AC/sleeper), date, one-way or return",
    "Visiting a doctor's clinic in India — describing symptoms, asking about medicine, understanding the prescription and dosage"
  ]
};

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildGrammarPrompt(lang) {
  const name   = LANG_NAMES[lang];
  const topics = GRAMMAR_TOPICS[lang];
  return `You are an expert ${name} language teacher creating a grammar reference for adult learners. Generate exactly ${topics.length} grammar sections covering these topics IN THIS ORDER:

${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences, no explanation before or after:
{"sections":[{"title":"Short name (3–5 words)","level":"Beginner","rule":"2–3 sentence accurate explanation of the rule including the actual pattern or formula","example_target":"A natural grammatically correct sentence in ${name}","example_target_2":"A second shorter example sentence in ${name}","example_ref":"English: [translation of example 1] / [translation of example 2]","note":"The single most important tip, common mistake to avoid, or key nuance"}]}

ACCURACY RULES — violations are unacceptable:
- Every sentence in example_target and example_target_2 MUST be in ${name}, not English
- All ${name} text must be grammatically correct — double-check every form
- level: label the earliest third of the sections "Beginner", the middle third "Intermediate", and the final third "Advanced"
- rule must state the actual grammatical rule, not just describe what the section is about
- note must give practical advice (common error or memory trick), not restate the rule
- For non-Latin script languages (Chinese/Japanese/Korean/Russian/Arabic): ALWAYS include native script — do not romanize only`;
}

function buildCheatsheetPrompt(lang) {
  const name   = LANG_NAMES[lang];
  const groups = CHEATSHEET_GROUPS[lang];
  return `You are an expert ${name} language teacher creating a quick-reference cheat sheet. Generate exactly ${groups.length} categories:

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
  return `You are an expert ${name} language teacher creating a sentence-structure guide for adult learners. Generate exactly ${topics.length} patterns IN THIS ORDER:

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
  return `You are an expert ${name} language teacher creating a vocabulary reference. Generate exactly ${categories.length} categories IN THIS ORDER:

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
  return `You are an expert ${name} language teacher writing ${scenarios.length} realistic dialogues for intermediate learners. Each dialogue must be a natural, authentic conversation that sounds like real ${name} speakers — not a textbook exercise.

Write dialogues for these ${scenarios.length} scenes IN THIS ORDER:
${scenarios.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Return ONLY a valid JSON object — no markdown, no code fences:
{"dialogues":[{"title":"Short scene title","scene":"One sentence describing the context and setting","level":"Beginner|Intermediate|Advanced","lines":[{"speaker":"Person A name or role","target":"Their line in ${name}","ref":"English translation"}],"vocab":["key word/phrase (English meaning)"],"note":"One cultural insight or language tip specific to this dialogue"}]}

ACCURACY RULES:
- Every line in target MUST be in ${name} — grammatically correct and natural
- Each dialogue must have 8–12 lines total (alternating between 2 speakers)
- vocab array must list 4–6 key words or phrases from the dialogue with their English meanings
- level: label the earliest dialogues "Beginner", the middle ones "Intermediate", and the last one or two "Advanced"
- note must give a genuine cultural insight — not just a grammar explanation
- For non-Latin scripts (Chinese/Japanese/Korean/Russian/Arabic/Hindi): ALL lines in target MUST use native script, not romanization alone
- For Hindi specifically: ALL target lines MUST contain Devanagari script (not just romanized Hindi)`;
}

function buildDrillsPrompt(lang) {
  const name = LANG_NAMES[lang];
  return `You are an expert ${name} language teacher creating quick active-recall drills — short prompt → short answer, like rapid flashcards for practice. Generate exactly 20 drills with a spread across these skill types IN A MIXED ORDER: verb conjugations (6), essential vocabulary (5), grammar forms such as gender/articles/cases/particles as relevant to ${name} (4), numbers or time (2), and common everyday phrases (3).

Return ONLY a valid JSON object — no markdown, no code fences:
{"drills":[{"q":"a short question, in English, that asks for a specific ${name} answer (e.g. \\"'I am' in ${name}?\\")","a":"the correct ${name} answer only","hint":"a short rule, pattern, or memory tip","type":"Conjugation|Vocab|Grammar|Numbers|Phrase"}]}

ACCURACY RULES — violations are unacceptable:
- Every "a" MUST be correct ${name} with correct spelling, script, accents, and diacritics
- Questions must have a single clear correct answer
- Vary difficulty from beginner to intermediate
- hint must add real value (the rule or a memory aid), never just restate the answer
- For non-Latin script languages (Chinese/Japanese/Korean/Russian/Arabic/Hindi): the "a" MUST be in native script (a romanization may follow in parentheses)`;
}

function buildRoadmapPrompt(lang) {
  const name = LANG_NAMES[lang];
  return `You are an expert ${name} language teacher creating a realistic 5-phase learning roadmap for an adult going from absolute beginner to advanced fluency in ${name}. Use these five phases IN THIS ORDER: 1 "Survival" (Weeks 1–2), 2 "Foundation" (Weeks 3–6), 3 "Core Structures" (Months 2–3), 4 "Fluency" (Months 3–6), 5 "Mastery" (Months 6+). Adjust the durations to be realistic for ${name}'s difficulty for an English speaker.

Return ONLY a valid JSON object — no markdown, no code fences:
{"phases":[{"phase":1,"title":"Survival","dur":"Weeks 1–2","goal":"one-sentence goal for this phase","can":["6 concrete can-do milestones, ${name}-SPECIFIC — name real grammar features, tenses, cases, scripts, or skills"],"daily":"a concrete daily study plan with minutes per activity"}]}

ACCURACY RULES:
- Milestones in "can" must reference REAL ${name} grammar/features by name (e.g. specific tenses, cases, particles, the writing system) — never generic filler
- Difficulty and durations must be realistic for ${name} (e.g. character/script-heavy languages take longer to read)
- Exactly 5 phases; each "can" array has exactly 6 items
- "goal" and "daily" must be specific and actionable, not vague`;
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
    if (data.sections.length < 10)             return `only ${data.sections.length} sections (need ≥10)`;
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
    if (data.categories.length < 7)            return `only ${data.categories.length} categories (need ≥7)`;
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
    if (data.structures.length < 9)            return `only ${data.structures.length} structures (need ≥9)`;
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
    if (data.categories.length < 9)            return `only ${data.categories.length} categories (need ≥9)`;
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

  if (tab === "drills") {
    if (!Array.isArray(data.drills))           return "missing drills array";
    if (data.drills.length < 12)               return `only ${data.drills.length} drills (need ≥12)`;
    for (const [i, d] of data.drills.entries()) {
      if (!d.q) return `drill ${i} missing q`;
      if (!d.a) return `drill ${i} missing a`;
      const err = checkScriptInArray([d], "a");
      if (err) return `drill ${i}: ${err}`;
    }
    return null;
  }

  if (tab === "roadmap") {
    if (!Array.isArray(data.phases))           return "missing phases array";
    if (data.phases.length < 5)                return `only ${data.phases.length} phases (need 5)`;
    for (const [i, p] of data.phases.entries()) {
      if (!p.title) return `phase ${i} missing title`;
      if (!p.goal)  return `phase ${i} missing goal`;
      if (!Array.isArray(p.can) || p.can.length < 4) return `phase ${i} has too few can-do items`;
      if (!p.daily) return `phase ${i} missing daily plan`;
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
      max_tokens: 8000,
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
    drills:     buildDrillsPrompt(lang),
    roadmap:    buildRoadmapPrompt(lang),
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

// How many items each anchored tab should now contain (the curated anchor length).
// Used to detect content generated under an older, shallower spec and refresh it.
function anchorTarget(lang, tab) {
  switch (tab) {
    case "grammar":    return { field: "sections",   count: (GRAMMAR_TOPICS[lang]     || []).length };
    case "cheatsheet": return { field: "categories", count: (CHEATSHEET_GROUPS[lang]  || []).length };
    case "structures": return { field: "structures", count: (STRUCTURE_TOPICS[lang]   || []).length };
    case "vocab":      return { field: "categories", count: (VOCAB_CATEGORIES[lang]   || []).length };
    case "dialogues":  return { field: "dialogues",  count: (DIALOGUE_SCENARIOS[lang] || []).length };
    default:           return null; // drills / roadmap have no per-language anchor list
  }
}

async function generateMissingContent() {
  const needed = [];
  for (const lang of VALID_LANGS) {
    for (const tab of VALID_TABS) {
      const row = await db.get("SELECT content_json FROM content_cache WHERE lang=$1 AND tab=$2", [lang, tab]);
      if (!row) { needed.push([lang, tab]); continue; }
      // Re-validate cached rows against current minimums AND the current anchor
      // depth so content generated under an older, shallower spec is upgraded.
      try {
        const parsed = JSON.parse(row.content_json);
        if (validateContent(lang, tab, parsed)) { needed.push([lang, tab]); continue; } // invalid → regenerate
        const t = anchorTarget(lang, tab);
        if (t && t.count) {
          const have = Array.isArray(parsed[t.field]) ? parsed[t.field].length : 0;
          if (have < t.count) needed.push([lang, tab]); // shallower than current standard → regenerate
        }
      } catch {
        needed.push([lang, tab]); // corrupt JSON → regenerate
      }
    }
  }

  if (needed.length === 0) {
    console.log("[Content] All content cached ✓");
    return;
  }

  console.log(`[Content] Background generation: ${needed.length} items missing or stale (re-deepening)`);

  let skipped = 0;
  for (const [lang, tab] of needed) {
    // Re-check right before generating: on multi-machine deploys another instance
    // may have already produced a valid version, so we avoid duplicate Opus calls.
    try {
      const fresh = await db.get("SELECT content_json FROM content_cache WHERE lang=$1 AND tab=$2", [lang, tab]);
      if (fresh) {
        try {
          if (!validateContent(lang, tab, JSON.parse(fresh.content_json))) { skipped++; continue; }
        } catch { /* fall through and regenerate */ }
      }
    } catch { /* if the check fails, just attempt generation */ }

    try {
      await generateContent(lang, tab);
    } catch (e) {
      console.error(`[Content] ✗ ${lang}/${tab}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // 2s between calls
  }

  console.log(`[Content] Background generation complete ✓${skipped ? ` (skipped ${skipped} already filled by peer)` : ""}`);
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

// POST /api/content/report — a learner flags a content accuracy problem
router.post("/report", requireAuth, async (req, res) => {
  const { lang, tab, note } = req.body || {};
  if (!VALID_LANGS.includes(lang)) return res.status(400).json({ error: "Unknown language" });
  if (!VALID_TABS.includes(tab))   return res.status(400).json({ error: "Unknown tab" });

  const userId = req.user?.userId || null;
  try {
    await db.run(
      "INSERT INTO content_reports (user_id, lang, tab, note) VALUES ($1, $2, $3, $4)",
      [userId, lang, tab, (note || "").toString().slice(0, 500)]
    );
    db.trackEvent(userId, "content_error_reported", { lang, tab });
    res.json({ ok: true });
  } catch (e) {
    console.error("[Content] report failed:", e.message);
    res.status(500).json({ error: "Could not submit report." });
  }
});

// GET /api/content/reports — admin: open content reports, newest first
router.get("/reports", requireAdmin, async (req, res) => {
  const rows = await db.all(
    "SELECT id, user_id, lang, tab, note, resolved, created_at FROM content_reports ORDER BY created_at DESC LIMIT 200"
  );
  res.json({ reports: rows, names: LANG_NAMES });
});

module.exports = router;
module.exports.generateMissingContent = generateMissingContent;
module.exports.VALID_LANGS  = VALID_LANGS;
module.exports.VALID_TABS   = VALID_TABS;
module.exports.LANG_NAMES   = LANG_NAMES;
