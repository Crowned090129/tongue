package app.tongue.language.common

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Defensive readers for the dynamic `/api/claude` JSON. The AI response shape
 * varies by feature, so never assume a field exists or has a given type.
 */

fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

fun JsonObject.strOr(key: String, default: String): String = str(key) ?: default

fun JsonObject.int(key: String): Int? =
    (this[key] as? JsonPrimitive)?.intOrNull

fun JsonObject.bool(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.booleanOrNull

fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray

/** Reads a string list from a JsonArray of primitives, skipping non-strings. */
fun JsonArray.stringList(): List<String> =
    mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }

/** Coerce any element to a display string (primitive content, or a compact form). */
fun JsonElement.asDisplayString(): String = when (this) {
    is JsonPrimitive -> content
    else -> toString()
}

/** Free-tier remaining quota, if the backend attached `_meta.remaining`. */
fun JsonObject.remainingQuota(): Int? = obj("_meta")?.get("remaining")?.let {
    (it as? JsonPrimitive)?.intOrNull
}
