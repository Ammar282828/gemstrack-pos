package erp.core

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * The ERP's dates are ISO strings ("2026-10-08T06:00:00.000Z"), and a promised day is a bare
 * "yyyy-MM-dd". Karachi has no daylight saving: UTC+5 all year. A date is a `java.time.Instant`.
 */
object ERPDate {
    val karachi: ZoneOffset = ZoneOffset.ofHours(5)

    private val isoText = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$""")
    private val dayText = Regex("""^\d{4}-\d{2}-\d{2}$""")
    private val isoOut: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    private val dayOut: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC)

    /** An ISO instant (with or without fractional seconds), or a bare day (its UTC midnight, as `new Date("yyyy-mm-dd")` reads it in JS). */
    fun parse(s: String?): Instant? {
        val t = s?.let { swiftTrim(it) } ?: return null
        if (t.isEmpty()) return null
        val m = isoText.matchEntire(t)
        if (m != null) {
            val g = m.groupValues
            return try {
                val local = LocalDateTime.of(g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
                val nanos = if (g[7].isEmpty()) 0 else g[7].take(9).padEnd(9, '0').toInt()
                val offset = if (g[8] == "Z") ZoneOffset.UTC else ZoneOffset.of(g[8])
                local.withNano(nanos).toInstant(offset)
            } catch (e: DateTimeException) {
                null
            }
        }
        if (t.length == 10 && dayText.matches(t)) {
            return try {
                LocalDate.of(t.substring(0, 4).toInt(), t.substring(5, 7).toInt(), t.substring(8, 10).toInt()).atStartOfDay(ZoneOffset.UTC).toInstant()
            } catch (e: DateTimeException) {
                null
            }
        }
        return null
    }

    /** "2026-10-08T06:00:00.000Z": how the ERP writes its own dates. */
    fun iso(d: Instant): String = isoOut.format(d)

    /** Karachi's calendar day of an instant, "yyyy-MM-dd". */
    fun karachiDay(d: Instant): String = dayOut.format(d.plusSeconds(5L * 3600))

    /** `Date(timeIntervalSince1970:)`. */
    fun fromSeconds(t: Double): Instant {
        val whole = floor(t)
        val micros = ((t - whole) * 1e6).roundToLong()
        return Instant.ofEpochSecond(whole.toLong(), micros * 1000)
    }
}

/** `Date.timeIntervalSince1970`. */
internal val Instant.seconds: Double get() = epochSecond + nano / 1e9

/** Foundation's `.whitespaces` (tab and the space separators; not newlines). */
internal fun isSwiftWhitespace(c: Char): Boolean = c == '\t' || Character.getType(c) == Character.SPACE_SEPARATOR.toInt()

internal fun swiftTrim(s: String): String {
    var a = 0
    var b = s.length
    while (a < b && isSwiftWhitespace(s[a])) a++
    while (b > a && isSwiftWhitespace(s[b - 1])) b--
    return s.substring(a, b)
}

/** Foundation's `.whitespacesAndNewlines`. */
internal fun isSwiftWhitespaceOrNewline(c: Char): Boolean =
    isSwiftWhitespace(c) || c == '\n' || c == '\r' || c == '\u000B' || c == '\u000C' || c == '\u0085' || c == ' ' || c == ' '

internal fun swiftTrimNewlines(s: String): String {
    var a = 0
    var b = s.length
    while (a < b && isSwiftWhitespaceOrNewline(s[a])) a++
    while (b > a && isSwiftWhitespaceOrNewline(s[b - 1])) b--
    return s.substring(a, b)
}
