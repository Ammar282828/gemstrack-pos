package erp.core

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.reflect.KClass

/**
 * Reading the ERP's Firestore documents as they really are: written over years by the web app,
 * scripts and imports, a number is sometimes a string ("25000"), a list is sometimes a map
 * keyed "0", "1", … (Firestore keeps arrays that way after some partial writes), and any field
 * may be missing. Every model decodes through these, never through a strict reader, so one odd
 * document never empties a list. (Support/Lenient.swift.)
 *
 * A document is a `Map<String, Any?>` of JSON-ish values: String, Number, Boolean, List, Map, null.
 */
class Container(private val map: Map<String, Any?>) {
    fun string(key: String): String? = when (val v = map[key]) {
        is String -> v
        is Number -> numberText(v.toDouble())
        is Boolean -> if (v) "true" else "false"
        else -> null
    }

    fun string(key: String, default: String): String = string(key) ?: default

    fun double(key: String): Double? = when (val v = map[key]) {
        is Number -> v.toDouble().takeIf { it.isFinite() }
        is String -> {
            val t = swiftTrim(v.replace(",", ""))
            swiftDouble(t)?.takeIf { it.isFinite() }
        }
        else -> null
    }

    fun double(key: String, default: Double): Double = double(key) ?: default

    /** `Int(d.rounded())`: a half goes away from zero. */
    fun int(key: String): Int? = double(key)?.let { swiftRounded(it).let { r -> if (r >= Int.MAX_VALUE) Int.MAX_VALUE else if (r <= Int.MIN_VALUE) Int.MIN_VALUE else r.toInt() } }

    fun bool(key: String): Boolean? = when (val v = map[key]) {
        is Boolean -> v
        is String -> v.lowercase(java.util.Locale.ROOT) in listOf("true", "yes", "1")
        is Number -> v.toDouble() != 0.0
        else -> null
    }

    fun bool(key: String, default: Boolean): Boolean = bool(key) ?: default

    /** A list, from an array or from a map keyed by index ("0", "1", …); elements that do not decode are dropped, not fatal. */
    fun <T : Any> list(key: String, decode: (Any?) -> T?): List<T> = when (val v = map[key]) {
        is List<*> -> v.mapNotNull { decode(it) }
        is Map<*, *> -> v.entries
            .map { it.key.toString() to it.value }
            .sortedWith(compareBy<Pair<String, Any?>>({ it.first.toLongOrNull() ?: Long.MAX_VALUE }, { it.first }))
            .mapNotNull { decode(it.second) }
        else -> emptyList()
    }

    fun <T : Any> list(key: String, model: Decodable<T>): List<T> = list(key) { model.from(it) }

    fun strings(key: String): List<String> = list(key) { lenientString(it) }

    fun <T : Any> obj(key: String, decode: (Any?) -> T?): T? = decode(map[key])

    fun <T : Any> obj(key: String, model: Decodable<T>): T? = model.from(map[key])

    /** A listed word, or null when the field is missing or blank (the ERP reads '' as unset). */
    fun <T : Word> word(key: String, words: WordFactory<T>): T? {
        val s = string(key) ?: return null
        if (swiftTrim(s).isEmpty()) return null
        return words.of(s)
    }

    fun <T : Word> word(key: String, words: WordFactory<T>, default: T): T = word(key, words) ?: default

    /** `Record<string, string>`: a map of text to text; values that are not text or numbers are dropped. */
    fun stringMap(key: String): Map<String, String> {
        val v = map[key] as? Map<*, *> ?: return emptyMap()
        val out = LinkedHashMap<String, String>()
        for ((k, value) in v) lenientString(value)?.let { out[k.toString()] = it }
        return out
    }
}

/**
 * A word from a fixed list in the ERP (an order's status, a payment's method, a metal) that must
 * never fail a document: whatever the list does not know is kept as `unknown(raw)`, so a status
 * some script wrote last year still decodes, still shows, and is not mistaken for a known one.
 * Two words are equal when they are the same list's and say the same text.
 */
abstract class Word(val rawValue: String) {
    override fun equals(other: Any?): Boolean = other != null && other::class == this::class && (other as Word).rawValue == rawValue
    override fun hashCode(): Int = rawValue.hashCode()
    override fun toString(): String = "${this::class.simpleName}($rawValue)"
}

interface WordFactory<T : Word> {
    fun of(raw: String): T
}

/** A string, from a string or a number. */
internal fun lenientString(v: Any?): String? = when (v) {
    is String -> v
    is Number -> numberText(v.toDouble())
    else -> null
}

/** A model that reads itself from a document leniently: never throws. */
interface Decodable<T : Any> {
    /** The model from a map that already carries its `id` (what the server's lists and the models' own fields look like). */
    fun fromMap(m: Map<String, Any?>): T

    /** The model from any value; null unless it is an object. */
    fun from(value: Any?): T? {
        if (value !is Map<*, *>) return null
        @Suppress("UNCHECKED_CAST")
        return fromMap(value as Map<String, Any?>)
    }

    /** A Firestore document as a model: its id is the document's (as store.ts does, `{ ...doc.data(), id: doc.id }`). */
    fun from(id: String, data: Map<String, Any?>): T = DocJSON.decodeWith(this, id, data)
}

/** `d == d.rounded() ? String(Int(d)) : String(d)`. */
internal fun numberText(d: Double): String? {
    if (!d.isFinite()) return null
    if (d == swiftRounded(d)) {
        return if (abs(d) < 9.2e18) d.toLong().toString() else BigDecimal(d).toPlainString()
    }
    return swiftDescription(d)
}

/** Swift's `.rounded()`: schoolbook, a half goes away from zero (not Math.round, not half-even). */
fun swiftRounded(x: Double): Double {
    if (!x.isFinite()) return x
    val t = if (x < 0) ceil(x) else floor(x)
    return if (abs(x - t) >= 0.5) t + (if (x < 0) -1.0 else 1.0) else t
}

/** The fewest digits that read back as the same number: "0.DIGITS × 10^n" with digits stripped of trailing zeros. x must be finite and above 0. */
internal fun shortestDigits(x: Double): Pair<String, Int> {
    val exact = BigDecimal(x)
    for (p in 1..17) {
        val r = exact.round(MathContext(p, RoundingMode.HALF_EVEN))
        if (r.toDouble() == x) {
            val unscaled = r.unscaledValue().toString()
            return unscaled.trimEnd('0') to (unscaled.length - r.scale())
        }
    }
    val r = exact.round(MathContext(17, RoundingMode.HALF_EVEN))
    val unscaled = r.unscaledValue().toString()
    return unscaled.trimEnd('0') to (unscaled.length - r.scale())
}

/** Swift's `String(d)` for a finite double: shortest digits, an exponent below 1e-4 ("1e-05"), else plain with ".0" for a whole number. */
internal fun swiftDescription(d: Double): String {
    if (d.isNaN()) return "nan"
    if (d.isInfinite()) return if (d < 0) "-inf" else "inf"
    if (d == 0.0) return if (1.0 / d < 0) "-0.0" else "0.0"
    val sign = if (d < 0) "-" else ""
    val (digits, n) = shortestDigits(abs(d))
    val k = digits.length
    if (abs(d) < 1e-4 || abs(d) >= 18014398509481984.0) {
        val e = n - 1
        val mantissa = if (k == 1) digits else digits.substring(0, 1) + "." + digits.substring(1)
        val tail = (if (e < 0) "-" else "+") + abs(e).toString().padStart(2, '0')
        return "$sign${mantissa}e$tail"
    }
    return sign + when {
        n <= 0 -> "0." + "0".repeat(-n) + digits
        k <= n -> digits + "0".repeat(n - k) + ".0"
        else -> digits.substring(0, n) + "." + digits.substring(n)
    }
}

private val decimalText = Regex("""^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$""")
private val hexText = Regex("""^([+-]?)0[xX]([0-9a-fA-F]*)(\.[0-9a-fA-F]*)?([pP][+-]?\d+)?$""")

/** Swift's `Double(String)`: the whole text must be a number (no spaces); "inf", "nan" and hex floats read too. */
internal fun swiftDouble(t: String): Double? {
    if (t.isEmpty()) return null
    val lower = t.lowercase(java.util.Locale.ROOT)
    val body = lower.trimStart('+', '-')
    if (t.length - body.length <= 1) {
        val negative = lower.startsWith("-")
        when {
            body == "inf" || body == "infinity" -> return if (negative) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
            body == "nan" || (body.startsWith("nan(") && body.endsWith(")")) -> return Double.NaN
        }
    }
    if (decimalText.matches(t)) return t.toDoubleOrNull()
    val hex = hexText.matchEntire(t)
    if (hex != null) {
        if (hex.groupValues[2].isEmpty() && hex.groupValues[3].length <= 1) return null
        val exponent = if (hex.groupValues[4].isEmpty()) "p0" else hex.groupValues[4]
        val fraction = if (hex.groupValues[3].isEmpty()) "" else hex.groupValues[3]
        return (hex.groupValues[1] + "0x" + hex.groupValues[2].ifEmpty { "0" } + fraction + exponent).toDoubleOrNull()
    }
    return null
}

/** The decoders by model class, for `DocJSON.decode<Order>(…)` and its kind. */
object Registry {
    private val decoders = HashMap<KClass<*>, Decodable<*>>()

    fun <T : Any> register(type: KClass<T>, decoder: Decodable<T>) {
        decoders[type] = decoder
    }

    @Suppress("UNCHECKED_CAST")
    fun <T : Any> decoder(type: KClass<T>): Decodable<T> {
        ModelRegistry.ensure()
        return (decoders[type] as? Decodable<T>) ?: throw IllegalArgumentException("${type.simpleName} is not a model of erp.core")
    }
}
