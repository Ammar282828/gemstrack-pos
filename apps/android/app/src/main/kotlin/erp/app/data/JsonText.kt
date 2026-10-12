package erp.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Maps and lists to JSON text (the other direction is core's `Json.parse`). Plain JVM, so the pure parts of
 * the app test without a device. `JSONSerialization` on the iPhone and this agree on the one thing that
 * matters: the same value always makes the same text (keys sorted when asked), so ERP request ids can be
 * compared.
 */
object JsonText {
    /** Text for any JSON-ish value; `sorted` orders object keys at every level (`.sortedKeys`). Null if it holds anything JSON cannot. */
    fun of(value: Any?, sorted: Boolean = false): String? = element(value, sorted)?.toString()

    /** Whether the value is something JSON can hold (`isValidJSONObject`): finite numbers, text, booleans, null, maps, lists. */
    fun isValid(value: Any?): Boolean = element(value, false) != null

    private fun element(v: Any?, sorted: Boolean): JsonElement? = when (v) {
        null -> JsonNull
        is JsonElement -> v
        is String -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        // A whole double is written as an integer (5, not 5.0), as Foundation does.
        is Double -> number(v)
        is Float -> number(v.toDouble())
        is Number -> JsonPrimitive(v)
        is List<*> -> v.map { element(it, sorted) ?: return null }.let { JsonArray(it) }
        is Array<*> -> v.map { element(it, sorted) ?: return null }.let { JsonArray(it) }
        is Map<*, *> -> {
            val keys = v.keys.map { it as? String ?: return null }.let { if (sorted) it.sorted() else it }
            val out = LinkedHashMap<String, JsonElement>()
            for (k in keys) out[k] = element(v[k], sorted) ?: return null
            JsonObject(out)
        }
        else -> null
    }

    private fun number(d: Double): JsonElement? = when {
        !d.isFinite() -> null
        d == Math.rint(d) && Math.abs(d) < 9.0e15 -> JsonPrimitive(d.toLong())
        else -> JsonPrimitive(d)
    }
}
