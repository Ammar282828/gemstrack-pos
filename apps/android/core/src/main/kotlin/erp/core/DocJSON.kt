package erp.core

import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.Json as KJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A Firestore document as plain JSON values, whichever way it reached the phone, so the models
 * decode it one way (Lenient.kt):
 *
 * - from the Firestore SDK (owners): Timestamps, references and bytes are SDK objects, turned
 *   into text by the app's hook, then into JSON here;
 * - from the ERP's server (/api/staff/collections, for staff): the Admin SDK's Timestamps arrive
 *   as `{"_seconds": …, "_nanoseconds": …}`, which the models would otherwise drop as unreadable.
 *
 * Timestamps become ISO text, as the ERP writes its own dates (store.ts keeps dates as strings).
 */
object DocJSON {
    /** What `plain` answers for a value JSON cannot hold (the Swift `nil`); it is dropped from its map or list. */
    object Dropped

    /** JSON-safe values all the way down. `custom` turns a value JSON cannot hold into one it can (null there: dropped). */
    fun plain(value: Any?, custom: (Any) -> Any? = { null }): Any? = when (value) {
        null -> null
        is String -> value
        is Boolean -> value
        is Number -> if (value.toDouble().isFinite()) value else Dropped
        is Instant -> ERPDate.iso(value)
        is java.util.Date -> ERPDate.iso(value.toInstant())
        is ByteArray -> Base64.getEncoder().encodeToString(value)
        is List<*> -> value.map { plain(it, custom) }.filter { it !== Dropped }
        is Map<*, *> -> timestamp(value) ?: run {
            val out = LinkedHashMap<String, Any?>()
            for ((k, v) in value) {
                val p = plain(v, custom)
                if (p !== Dropped) out[k.toString()] = p
            }
            out
        }
        else -> custom(value)?.let { plain(it, custom) } ?: Dropped
    }

    /** The Admin SDK's Timestamp as JSON (`_seconds`/`_nanoseconds`, or `seconds`/`nanoseconds`), as ISO. */
    internal fun timestamp(map: Map<*, *>): String? {
        if (map.size != 2) return null
        val s = (map["_seconds"] ?: map["seconds"]) as? Number ?: return null
        val n = (map["_nanoseconds"] ?: map["nanoseconds"]) as? Number ?: return null
        return ERPDate.iso(ERPDate.fromSeconds(s.toDouble() + n.toDouble() / 1e9))
    }

    @PublishedApi internal fun <T : Any> decodeWith(model: Decodable<T>, id: String, data: Map<String, Any?>, custom: (Any) -> Any? = { null }): T {
        @Suppress("UNCHECKED_CAST")
        val map = LinkedHashMap((plain(data, custom) as? Map<String, Any?>) ?: emptyMap())
        map["id"] = id
        return model.fromMap(map)
    }

    /** A document as a model: its id is the document's (as store.ts does, `{ ...doc.data(), id: doc.id }`). */
    inline fun <reified T : Any> decode(id: String, data: Map<String, Any?>, noinline custom: (Any) -> Any? = { null }): T =
        decodeWith(Registry.decoder(T::class), id, data, custom)

    /** A list of documents from the ERP's server: each carries its own `id`. */
    inline fun <reified T : Any> decodeList(docs: List<Any?>): List<T> = decodeListWith(Registry.decoder(T::class), docs)

    fun <T : Any> decodeListWith(model: Decodable<T>, docs: List<Any?>): List<T> = docs.mapNotNull { doc ->
        val map = plain(doc) as? Map<*, *> ?: return@mapNotNull null
        model.from(map)
    }
}

/** Decode a model from a Firestore document already turned into JSON-safe values (Timestamps as ISO strings). */
object ERPDecode {
    /** Null unless `value` is a JSON-safe object (no NaN, no foreign objects) that decodes. */
    inline fun <reified T : Any> model(from: Any?): T? = modelWith(Registry.decoder(T::class), from)

    fun <T : Any> modelWith(model: Decodable<T>, from: Any?): T? = if (isValidJsonObject(from)) model.from(from) else null

    /** `[Lossy<T>]` from JSON text: elements that do not decode are dropped; text that is not an array gives none. */
    inline fun <reified T : Any> models(json: String): List<T> = modelsWith(Registry.decoder(T::class), json)

    fun <T : Any> modelsWith(model: Decodable<T>, json: String): List<T> {
        val list = Json.parse(json) as? List<*> ?: return emptyList()
        return list.mapNotNull { model.from(it) }
    }

    /** `JSONSerialization.isValidJSONObject`: an object or array holding only text, finite numbers, booleans, null, objects and arrays. */
    fun isValidJsonObject(v: Any?): Boolean {
        if (v !is Map<*, *> && v !is List<*>) return false
        return validJson(v)
    }

    private fun validJson(v: Any?): Boolean = when (v) {
        null, is String, is Boolean -> true
        is Number -> v.toDouble().isFinite()
        is List<*> -> v.all { validJson(it) }
        is Map<*, *> -> v.entries.all { it.key is String && validJson(it.value) }
        else -> false
    }
}

/** JSON text as the maps and lists the models read, so tests and the app's server answers take the same path. */
object Json {
    /** Parses JSON text to String, Long/Double, Boolean, List, Map or null. Null for text that is not JSON as well. */
    fun parse(text: String): Any? = try {
        value(KJson.parseToJsonElement(text))
    } catch (e: Exception) {
        null
    }

    /** True when the text is JSON at all (told apart from the JSON `null`). */
    fun isJson(text: String): Boolean = try {
        KJson.parseToJsonElement(text)
        true
    } catch (e: Exception) {
        false
    }

    private fun value(e: JsonElement): Any? = when (e) {
        is JsonNull -> null
        is JsonObject -> e.entries.associateTo(LinkedHashMap()) { it.key to value(it.value) }
        is JsonArray -> e.map { value(it) }
        is JsonPrimitive -> when {
            e.isString -> e.content
            e.content == "true" -> true
            e.content == "false" -> false
            else -> e.content.toLongOrNull() ?: e.content.toDouble()
        }
    }

    /** A model from JSON text: null unless it is an object. */
    inline fun <reified T : Any> decode(text: String): T? = Registry.decoder(T::class).from(parse(text))

    /** The models of a JSON array, one odd element never emptying the list. */
    inline fun <reified T : Any> decodeList(text: String): List<T> = ERPDecode.models(text)
}
