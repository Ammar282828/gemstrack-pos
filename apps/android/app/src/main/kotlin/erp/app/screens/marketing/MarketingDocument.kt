package erp.app.screens.marketing

import erp.app.data.ErpApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * A document held as raw JSON, never decoded into fields (MarketingDocument.swift `MarketingValue`): a design, a
 * post's words, an answer of the marketing routes. A field the web adds survives a save from the phone and the
 * reverse, because nothing here knows the fields. Values are immutable; `with` makes the changed copy.
 */
@JvmInline
value class MarketingValue(val json: JsonElement = JsonNull) {
    val isNull: Boolean get() = json is JsonNull

    val obj: Map<String, MarketingValue>
        get() = (json as? JsonObject)?.mapValues { MarketingValue(it.value) } ?: emptyMap()

    val array: List<MarketingValue>
        get() = (json as? JsonArray)?.map { MarketingValue(it) } ?: emptyList()

    /** Text only when the value is text: a number is not "5" here (the Swift `.string`). */
    val string: String get() = (json as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""

    /** A number, or text that reads as one; 0 otherwise. */
    val number: Double
        get() {
            val p = json as? JsonPrimitive ?: return 0.0
            if (p is JsonNull) return 0.0
            if (!p.isString && p.booleanOrNull != null) return 0.0
            return p.content.toDoubleOrNull() ?: 0.0
        }

    val bool: Boolean get() = (json as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: false

    operator fun get(key: String): MarketingValue = MarketingValue((json as? JsonObject)?.get(key) ?: JsonNull)

    /** A copy with [key] set (an array or a number becomes an object first, as `subscript set` does on Swift's enum). */
    fun with(key: String, value: MarketingValue): MarketingValue {
        val map = LinkedHashMap<String, JsonElement>((json as? JsonObject) ?: emptyMap())
        map[key] = value.json
        return MarketingValue(JsonObject(map))
    }

    fun with(key: String, value: Any?): MarketingValue = with(key, of(value))

    /** A copy with the value at a path set: `d.withPath(listOf("bg", "photoId"), x)` is `d["bg"]["photoId"] = x`. */
    fun withPath(path: List<String>, value: MarketingValue): MarketingValue =
        if (path.isEmpty()) value else with(path.first(), this[path.first()].withPath(path.drop(1), value))

    fun without(key: String): MarketingValue =
        MarketingValue(JsonObject(((json as? JsonObject) ?: emptyMap()).filterKeys { it != key }))

    /** The number at [key], or [fallback] when there is none (`n`). */
    fun n(key: String, fallback: Double = 0.0): Double = if (this[key].isNull) fallback else this[key].number

    fun s(key: String, fallback: String = ""): String = if (this[key].isNull) fallback else this[key].string

    /** Canonical text: keys sorted at every level, so equal documents give equal text (a task key, a draft's hash). */
    val text: String get() = canonical(json)

    /** Maps, lists, text, numbers (whole ones as Long), booleans and null: what `ErpApi` bodies are made of. */
    val any: Any?
        get() = when (val j = json) {
            is JsonObject -> j.mapValues { MarketingValue(it.value).any }
            is JsonArray -> j.map { MarketingValue(it).any }
            is JsonNull -> null
            is JsonPrimitive -> when {
                j.isString -> j.content
                j.booleanOrNull != null -> j.booleanOrNull
                else -> j.content.toDoubleOrNull()?.let { if (it == Math.rint(it) && kotlin.math.abs(it) < 9e15) it.toLong() else it }
            }
            else -> null
        }

    companion object {
        val NULL = MarketingValue(JsonNull)
        private val lenient = Json { ignoreUnknownKeys = true }

        fun string(s: String) = MarketingValue(JsonPrimitive(s))
        fun bool(b: Boolean) = MarketingValue(JsonPrimitive(b))

        /** A whole number is written without ".0" (a design's frame says 1080, not 1080.0). */
        fun number(d: Double): MarketingValue =
            MarketingValue(if (d.isFinite() && d == Math.rint(d) && kotlin.math.abs(d) < 9e15) JsonPrimitive(d.toLong()) else if (d.isFinite()) JsonPrimitive(d) else JsonNull)

        fun array(items: List<MarketingValue>) = MarketingValue(JsonArray(items.map { it.json }))
        fun obj(vararg pairs: Pair<String, Any?>) = of(mapOf(*pairs))

        /** From any plain value: maps, lists, text, numbers, booleans, null, or another MarketingValue / JsonElement. */
        fun of(value: Any?): MarketingValue = when (value) {
            null -> NULL
            is MarketingValue -> value
            is JsonElement -> MarketingValue(value)
            is String -> string(value)
            is Boolean -> bool(value)
            is Double -> number(value)
            is Float -> number(value.toDouble())
            is Number -> MarketingValue(JsonPrimitive(value))
            is Map<*, *> -> MarketingValue(JsonObject(value.entries.associate { (k, v) -> k.toString() to of(v).json }))
            is Iterable<*> -> MarketingValue(JsonArray(value.map { of(it).json }))
            is Array<*> -> MarketingValue(JsonArray(value.map { of(it).json }))
            else -> NULL
        }

        /** The value in JSON text; null when it is not JSON (an answer that is a web page, an empty body). */
        fun parse(text: String): MarketingValue = try {
            val e = lenient.parseToJsonElement(text)
            // A page of HTML reads as a bare word to this parser; it is not a value.
            if (e is JsonPrimitive && e !is JsonNull && !e.isString && e.booleanOrNull == null && e.content.toDoubleOrNull() == null) NULL else MarketingValue(e)
        } catch (e: Exception) {
            NULL
        }

        private fun canonical(j: JsonElement): String = when (j) {
            is JsonObject -> j.entries.sortedBy { it.key }.joinToString(",", "{", "}") { Json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(it.key)) + ":" + canonical(it.value) }
            is JsonArray -> j.joinToString(",", "[", "]") { canonical(it) }
            else -> j.toString()
        }
    }
}

/**
 * The marketing routes as `MarketingValue`s (MarketingRequest): the ERP's own paths, as the signed-in person.
 * A long timeout for what makes pictures or sends to the groups.
 */
object MarketingRequest {
    suspend fun get(path: String): MarketingValue = MarketingValue.parse(ErpApi.shared.data(path))

    suspend fun send(path: String, body: Map<String, Any?> = emptyMap(), method: String = "POST"): MarketingValue =
        MarketingValue.parse(ErpApi.shared.data(path, method, MarketingValue.of(body).obj.mapValues { it.value.json }, 240_000))

    /**
     * A picture from the phone (or an accepted AI version) into the Studio's uploads (POST /api/ads/studio/uploads): its
     * library id, "up:<id>", which a board's photo or inset ("lib:up:<id>") can hold. [rawType] ("image/png",
     * "image/svg+xml") sends the file as it is (a logo file is not made a JPEG: that would turn a PNG's clear parts black
     * and an SVG into nothing); the server rasterises and flattens it. Otherwise a JPEG copy is sent; it is returned too.
     */
    suspend fun uploadPicture(data: ByteArray, name: String, rawType: String? = null): Pair<String, ByteArray> {
        val bytes = if (rawType == null) (MarketingPhotos.jpegCopy(data) ?: data) else data
        val ext = when (rawType) { "image/svg+xml" -> "svg"; "image/png" -> "png"; else -> "jpg" }
        val text = ErpApi.shared.upload(
            "/api/ads/studio/uploads", listOf("name" to name),
            listOf(ErpApi.FormFile("file", "picture.$ext", rawType ?: "image/jpeg", bytes)), timeoutMs = 180_000,
        )
        val id = MarketingValue.parse(text)["asset"].s("id")
        if (!id.startsWith("up:")) throw ErpApi.Failure(0, "The upload gave no picture.")
        return id to bytes
    }

    /** The AI route (`/api/website/post/ai`): the operation, its params as JSON text, and the photographs as JPEGs. */
    suspend fun ai(op: String, images: List<ByteArray>, params: Map<String, Any?>): MarketingValue =
        MarketingValue.parse(
            ErpApi.shared.upload(
                "/api/website/post/ai",
                fields = listOf("op" to op, "params" to MarketingValue.of(params).text),
                files = images.mapIndexed { i, d -> ErpApi.FormFile("image", "image-$i.jpg", "image/jpeg", MarketingPhotos.jpegCopy(d) ?: d) },
                timeoutMs = 240_000,
            ),
        )
}
