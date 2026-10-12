package erp.core.entry

import erp.core.logic.RateInputKey
import java.text.BreakIterator
import java.util.Base64

// What the entry files share and Swift gives for free: Swift's min/max, a saved draft's strict reading
// ("a field that is missing or the wrong kind takes its default", orderField / saleField), and the JSON the
// phone's drafts are kept as. Payloads are Map<String, Any?> trees of String, Double (Int for a count), Boolean,
// List, Map and null (Swift's NSNull); an ABSENT key and a key holding null are different things, as they are
// in Swift, so a payload is read with containsKey when that matters.

/** Swift's `max(x, y)`: `y >= x ? y : x` (so max(0, -0.0) is -0.0, and a NaN y loses). */
internal fun smax(x: Double, y: Double): Double = if (y >= x) y else x

/** Swift's `min(x, y)`: `y < x ? y : x`. */
internal fun smin(x: Double, y: Double): Double = if (y < x) y else x

/** `String.count`: Swift counts grapheme clusters, not UTF-16 units. */
internal fun graphemeCount(s: String): Int {
    if (s.isEmpty()) return 0
    val it = BreakIterator.getCharacterInstance()
    it.setText(s)
    var n = 0
    while (it.next() != BreakIterator.DONE) n++
    return n
}

/** `RateInputKey(rawValue:)`. */
internal fun rateInputKey(raw: String): RateInputKey? = RateInputKey.values().firstOrNull { it.name == raw }

/** `Data.base64EncodedString()`. */
internal fun base64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

/**
 * A saved draft's fields, read the way `decodeIfPresent` with a fallback reads them (NewOrderDraft.orderField,
 * SaleModel.saleField): a missing field, a null, or one of another kind is the default; nothing throws and
 * nothing is coerced (a number in a text field is not text here, as in Swift's JSONDecoder).
 */
internal class DraftReader(private val m: Map<String, Any?>) {
    fun string(key: String, default: String): String = (m[key] as? String) ?: default
    fun string(key: String): String? = m[key] as? String
    fun bool(key: String, default: Boolean): Boolean = (m[key] as? Boolean) ?: default
    fun bool(key: String): Boolean? = m[key] as? Boolean
    fun double(key: String, default: Double): Double = (m[key] as? Number)?.toDouble() ?: default
    fun double(key: String): Double? = (m[key] as? Number)?.toDouble()
    fun stringMap(key: String, default: Map<String, String>): Map<String, String> {
        val v = m[key] as? Map<*, *> ?: return default
        val out = LinkedHashMap<String, String>()
        for ((k, value) in v) {
            // One value of another kind fails the whole dictionary in Swift, which then takes the default.
            out[k as? String ?: return default] = value as? String ?: return default
        }
        return out
    }

    /** A list whose every element must decode; one that does not takes the default (Swift throws for the whole array). */
    fun <T> list(key: String, default: List<T>, element: (Map<String, Any?>) -> T?): List<T> {
        val v = m[key] as? List<*> ?: return default
        val out = ArrayList<T>(v.size)
        for (e in v) {
            @Suppress("UNCHECKED_CAST")
            val map = e as? Map<String, Any?> ?: return default
            out.add(element(map) ?: return default)
        }
        return out
    }

    @Suppress("UNCHECKED_CAST")
    fun obj(key: String): Map<String, Any?>? = m[key] as? Map<String, Any?>

    /** Bytes kept as base64 text (Swift's `Data` coding); a text that is not base64 is absent. */
    fun bytes(key: String): ByteArray? {
        val s = m[key] as? String ?: return null
        return try {
            Base64.getDecoder().decode(s)
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}

/** JSON text for a draft: the maps and lists above, compact. */
internal object EntryJson {
    fun write(value: Any?): String = StringBuilder().also { put(it, value) }.toString()

    private fun put(out: StringBuilder, v: Any?) {
        when (v) {
            null -> out.append("null")
            is String -> quote(out, v)
            is Boolean -> out.append(if (v) "true" else "false")
            is Int, is Long -> out.append(v.toString())
            is Number -> out.append(erp.core.logic.JS.number(v.toDouble()))
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((k, x) in v) {
                    if (!first) out.append(',')
                    first = false
                    quote(out, k.toString())
                    out.append(':')
                    put(out, x)
                }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                v.forEachIndexed { i, x ->
                    if (i > 0) out.append(',')
                    put(out, x)
                }
                out.append(']')
            }
            else -> quote(out, v.toString())
        }
    }

    private fun quote(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c < ' ' -> out.append("\\u%04x".format(c.code))
                else -> out.append(c)
            }
        }
        out.append('"')
    }
}
