package app.tongue.language.feature.reference

import app.tongue.language.common.array
import app.tongue.language.common.str
import kotlinx.serialization.json.JsonObject

/**
 * Typed views over the dynamic `/api/content/{lang}/{tab}` payloads. The backend
 * JSON is read defensively (via [JsonExt]) into these small immutable shapes so
 * the Compose layer never touches raw [JsonObject]s.
 *
 * Every model exposes the target-language strings separately so the UI can attach
 * a [PlayButton] to each one.
 */

data class GrammarSection(
    val title: String,
    val level: String?,
    val rule: String?,
    val exampleTarget: String?,
    val exampleTarget2: String?,
    val exampleRef: String?,
    val note: String?,
)

data class CheatItem(val target: String?, val ref: String?, val note: String?)
data class CheatCategory(val name: String, val items: List<CheatItem>)

data class Structure(
    val pattern: String?,
    val title: String,
    val explanation: String?,
    val ex1Target: String?,
    val ex1Ref: String?,
    val ex2Target: String?,
    val ex2Ref: String?,
)

data class VocabWord(val target: String?, val pronunciation: String?, val ref: String?)
data class VocabCategory(val name: String, val words: List<VocabWord>)

data class DialogueLine(val speaker: String?, val target: String?, val ref: String?)
data class Dialogue(
    val title: String,
    val scene: String?,
    val level: String?,
    val lines: List<DialogueLine>,
    val vocab: String?,
    val note: String?,
)

/** Discriminated result of parsing a content payload for a given tab. */
sealed interface ReferenceContent {
    data class Grammar(val sections: List<GrammarSection>) : ReferenceContent
    data class Cheatsheet(val categories: List<CheatCategory>) : ReferenceContent
    data class Structures(val structures: List<Structure>) : ReferenceContent
    data class Vocab(val categories: List<VocabCategory>) : ReferenceContent
    data class Dialogues(val dialogues: List<Dialogue>) : ReferenceContent
    /** Non-empty payload we couldn't map — render generically upstream. */
    data object Empty : ReferenceContent
}

// ── Parsers (defensive: skip malformed entries, never throw) ────────────────────

fun parseGrammar(content: JsonObject?): ReferenceContent.Grammar {
    val sections = content?.array("sections").orEmptyObjects().map { s ->
        GrammarSection(
            title = s.str("title") ?: "Section",
            level = s.str("level"),
            rule = s.str("rule"),
            exampleTarget = s.str("example_target"),
            exampleTarget2 = s.str("example_target_2"),
            exampleRef = s.str("example_ref"),
            note = s.str("note"),
        )
    }
    return ReferenceContent.Grammar(sections)
}

fun parseCheatsheet(content: JsonObject?): ReferenceContent.Cheatsheet {
    val categories = content?.array("categories").orEmptyObjects().map { c ->
        CheatCategory(
            name = c.str("name") ?: "Category",
            items = c.array("items").orEmptyObjects().map { i ->
                CheatItem(i.str("target"), i.str("ref"), i.str("note"))
            },
        )
    }
    return ReferenceContent.Cheatsheet(categories)
}

fun parseStructures(content: JsonObject?): ReferenceContent.Structures {
    val structures = content?.array("structures").orEmptyObjects().map { s ->
        Structure(
            pattern = s.str("pattern"),
            title = s.str("title") ?: (s.str("pattern") ?: "Structure"),
            explanation = s.str("explanation"),
            ex1Target = s.str("ex1_target"),
            ex1Ref = s.str("ex1_ref"),
            ex2Target = s.str("ex2_target"),
            ex2Ref = s.str("ex2_ref"),
        )
    }
    return ReferenceContent.Structures(structures)
}

fun parseVocab(content: JsonObject?): ReferenceContent.Vocab {
    val categories = content?.array("categories").orEmptyObjects().map { c ->
        VocabCategory(
            name = c.str("name") ?: "Category",
            words = c.array("words").orEmptyObjects().map { w ->
                VocabWord(w.str("t"), w.str("p"), w.str("r"))
            },
        )
    }
    return ReferenceContent.Vocab(categories)
}

fun parseDialogues(content: JsonObject?): ReferenceContent.Dialogues {
    val dialogues = content?.array("dialogues").orEmptyObjects().map { d ->
        Dialogue(
            title = d.str("title") ?: "Dialogue",
            scene = d.str("scene"),
            level = d.str("level"),
            lines = d.array("lines").orEmptyObjects().map { l ->
                DialogueLine(l.str("speaker"), l.str("target"), l.str("ref"))
            },
            vocab = d.str("vocab"),
            note = d.str("note"),
        )
    }
    return ReferenceContent.Dialogues(dialogues)
}

/** Coerce a [JsonArray] to the [JsonObject] elements it contains, skipping others. */
private fun kotlinx.serialization.json.JsonArray?.orEmptyObjects(): List<JsonObject> =
    this?.mapNotNull { it as? JsonObject }.orEmpty()
