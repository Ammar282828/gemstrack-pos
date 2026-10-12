package erp.core.logic

import erp.core.ERPDate
import erp.core.seconds
import erp.core.shortestDigits
import erp.core.swiftDouble
import erp.core.swiftRounded
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import kotlin.math.abs
import kotlin.math.floor

/**
 * The few places where JavaScript and Kotlin read the same text or number differently, and the
 * ported rules (src/lib) lean on the JavaScript way: `Math.round` sends a half up,
 * `toFixed` and `String(n)` print numbers their own way, `parseFloat` takes a leading number
 * and ignores the rest, `localeCompare` sorts strings, and date-fns' `parseISO` reads a bare day
 * as the *local* midnight. Internal to erp.core: a rule that needs one of them says so with `JS.`,
 * so a reader can see where the port is being exact on purpose.
 *
 * Karachi is "local" for every date here: the shop's counter, its devices and the owner's phone
 * are all UTC+5 (ERPDate.karachi), and the two sites the web ERP computes dates on (browser,
 * server) are told apart only by the server, which the app never is.
 */
internal object JS {
    // Numbers

    /** `Math.round`: halves go up, so -2.5 is -2 (a schoolbook `rounded()` would say -3). */
    fun round(x: Double): Double {
        if (!x.isFinite()) return x
        val down = floor(x)
        return if (x - down >= 0.5) down + 1 else down
    }

    /**
     * `String(n)`: the shortest digits that read back as the same number, laid out the way
     * ECMAScript does (3, 5.2, 104000, 0.00001, 1e-7, 1e+21). Kotlin's own `toString` switches
     * to an exponent sooner ("1.0E-5") and prints "3.0".
     */
    fun number(x: Double): String {
        if (x.isNaN()) return "NaN"
        if (x == 0.0) return "0"
        if (x.isInfinite()) return if (x < 0) "-Infinity" else "Infinity"
        // value = 0.<digits> × 10^n
        val (digits, n) = shortestDigits(abs(x))
        val k = digits.length
        val sign = if (x < 0) "-" else ""
        if (n in k..21) return sign + digits + "0".repeat(n - k)
        if (n in 1..21) return sign + digits.substring(0, n) + "." + digits.substring(n)
        if (n in -5..0) return sign + "0." + "0".repeat(-n) + digits
        val e = n - 1
        val tail = (if (e < 0) "-" else "+") + abs(e).toString()
        return sign + (if (k == 1) digits else digits.substring(0, 1) + "." + digits.substring(1)) + "e" + tail
    }

    /**
     * `n.toFixed(digits)`: the double's exact decimal value, a tie going to the larger number
     * ((7.25).toFixed(1) is "7.3", (1.005).toFixed(2) is "1.00" because 1.005 is really 1.00499…).
     */
    fun toFixed(x: Double, digits: Int): String {
        if (!x.isFinite() || abs(x) >= 1e21) return number(x)
        val negative = x < 0
        val expansion = BigDecimal(abs(x)).setScale(digits + 60, RoundingMode.HALF_EVEN).toPlainString()
        val dot = expansion.indexOf('.')
        val whole = if (dot < 0) expansion else expansion.substring(0, dot)
        val fraction = if (dot < 0) "" else expansion.substring(dot + 1)
        val kept = fraction.take(digits)
        val next = fraction.getOrNull(digits)
        val list = (whole + kept).map { it - '0' }.toMutableList()
        if (next != null && next - '0' >= 5) {
            var i = list.size - 1
            while (i >= 0) {
                if (list[i] == 9) {
                    list[i] = 0
                    i -= 1
                } else {
                    list[i] += 1
                    break
                }
            }
            if (i < 0) list.add(0, 1)
        }
        val text = list.joinToString("")
        val cut = text.length - digits
        val body = if (digits > 0) text.substring(0, cut) + "." + text.substring(cut) else text
        return (if (negative) "-" else "") + body
    }

    /** `Number(s)`: NaN unless the whole text is a number (blank is 0). */
    fun toNumber(s: String): Double {
        val t = trim(s)
        if (t.isEmpty()) return 0.0
        when (t) {
            "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
            "-Infinity" -> return Double.NEGATIVE_INFINITY
        }
        // JavaScript's whole-number forms: 0x1f, 0b101, 0o17 (never signed, never with a point).
        if (t.length > 2 && t[0] == '0') {
            val radix = when (t[1]) {
                'x', 'X' -> 16
                'b', 'B' -> 2
                'o', 'O' -> 8
                else -> null
            }
            if (radix != null) {
                return t.substring(2).toULongOrNull(radix)?.toDouble() ?: Double.NaN
            }
        }
        // Swift also reads "inf", "nan" and hex floats; JavaScript reads none of them.
        if (t.any { it in "xXpPnN" } || t.contains("inf", ignoreCase = true)) return Double.NaN
        return swiftDouble(t) ?: Double.NaN
    }

    private fun isDigit(c: Char) = c in '0'..'9'

    /** `parseFloat(s)`: the number the text starts with ("26250.00", " 12abc" is 12, ".5", "1e3x"), else NaN. */
    fun parseFloat(s: String): Double {
        val chars = trimStart(s)
        var i = 0
        var sign = ""
        if (i < chars.length && (chars[i] == '+' || chars[i] == '-')) {
            sign = if (chars[i] == '-') "-" else ""
            i += 1
        }
        if (chars.substring(i).startsWith("Infinity")) return if (sign == "-") Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
        val whole = StringBuilder()
        var fraction = ""
        while (i < chars.length && isDigit(chars[i])) {
            whole.append(chars[i])
            i += 1
        }
        if (i < chars.length && chars[i] == '.') {
            var j = i + 1
            val f = StringBuilder()
            while (j < chars.length && isDigit(chars[j])) {
                f.append(chars[j])
                j += 1
            }
            if (whole.isNotEmpty() || f.isNotEmpty()) {
                fraction = f.toString()
                i = j
            }
        }
        if (whole.isEmpty() && fraction.isEmpty()) return Double.NaN
        var exponent = ""
        if (i < chars.length && (chars[i] == 'e' || chars[i] == 'E')) {
            var j = i + 1
            var e = ""
            if (j < chars.length && (chars[j] == '+' || chars[j] == '-')) {
                e += chars[j]
                j += 1
            }
            val digits = StringBuilder()
            while (j < chars.length && isDigit(chars[j])) {
                digits.append(chars[j])
                j += 1
            }
            if (digits.isNotEmpty()) exponent = "e$e$digits"
        }
        val text = sign + (if (whole.isEmpty()) "0" else whole.toString()) + (if (fraction.isEmpty()) "" else ".$fraction") + exponent
        return swiftDouble(text) ?: Double.NaN
    }

    /** `parseInt(s, 10)`: the whole number the text starts with ("21k" is 21), else NaN. */
    fun parseInt(s: String): Double {
        val chars = trimStart(s)
        var i = 0
        var negative = false
        if (i < chars.length && (chars[i] == '+' || chars[i] == '-')) {
            negative = chars[i] == '-'
            i += 1
        }
        val digits = StringBuilder()
        while (i < chars.length && isDigit(chars[i])) {
            digits.append(chars[i])
            i += 1
        }
        val value = swiftDouble(digits.toString()) ?: return Double.NaN
        return if (negative) -value else value
    }

    // Text

    /** JavaScript's white space and line terminators (`\s`, `trim`): not Swift's, which also counts U+0085 and leaves out U+FEFF. */
    private val whitespace: Set<Char> = buildSet {
        addAll("\t\n\u000B\u000C\r       　﻿".toList())
        addAll(' '..' ')
    }

    fun isSpace(c: Char): Boolean = c in whitespace

    /** `String.prototype.trim`. */
    fun trim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && s[a] in whitespace) a++
        while (b > a && s[b - 1] in whitespace) b--
        return s.substring(a, b)
    }

    private fun trimStart(s: String): String {
        var a = 0
        while (a < s.length && s[a] in whitespace) a++
        return s.substring(a)
    }

    /** JavaScript truthiness of an optional string: present and not "". */
    fun has(s: String?): Boolean = !s.isNullOrEmpty()

    /**
     * `a.localeCompare(b)` as ICU's root collation orders ASCII (what Node, a browser and the
     * shop's ids and ISO dates are made of): punctuation, then digits, then letters with case
     * only breaking a tie (a before A). Anything outside ASCII sorts after it by code point.
     * Negative when `a` sorts first.
     */
    fun localeCompare(a: String, b: String): Int {
        val sa = a.codePoints().toArray().toList()
        val sb = b.codePoints().toArray().toList()
        val pa = sa.mapNotNull { primaryWeight(it) }
        val pb = sb.mapNotNull { primaryWeight(it) }
        for (i in 0 until minOf(pa.size, pb.size)) {
            if (pa[i] != pb[i]) return if (pa[i] < pb[i]) -1 else 1
        }
        if (pa.size != pb.size) return if (pa.size < pb.size) -1 else 1
        // Same letters: lower case first, at the first place the case differs.
        val ka = sa.filter { primaryWeight(it) != null }
        val kb = sb.filter { primaryWeight(it) != null }
        for (i in 0 until minOf(ka.size, kb.size)) {
            val x = ka[i]
            val y = kb[i]
            if (x != y) {
                val xl = isLowerAscii(x)
                val yl = isLowerAscii(y)
                if (xl != yl) return if (xl) -1 else 1
                return if (x < y) -1 else 1
            }
        }
        return 0
    }

    private val punctuationOrder = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$".toList().map { it.code }

    private fun isLowerAscii(s: Int) = s in 97..122

    /** null for a control character, which collation ignores. */
    private fun primaryWeight(s: Int): Int? = when (s) {
        in 0x09..0x0D, 0x20 -> s
        in 0..0x1F, 0x7F -> null
        in 0x30..0x39 -> 1000 + (s - 0x30)
        in 0x61..0x7A -> 2000 + (s - 0x61)
        in 0x41..0x5A -> 2000 + (s - 0x41)
        else -> {
            val at = punctuationOrder.indexOf(s)
            if (at >= 0) 100 + at else 10_000 + s
        }
    }

    // Dates

    /** An instant as whole milliseconds, which is how `getTime()` compares them (a period's end is 23:59:59.999). */
    fun ms(d: Instant): Long = swiftRounded(d.seconds * 1000).toLong()

    private const val karachiOffset = 5L * 3600

    private fun isBareDay(s: String): Boolean {
        if (s.length != 10) return false
        return s.withIndex().all { (i, ch) -> if (i == 4 || i == 7) ch == '-' else ch in '0'..'9' }
    }

    /** "yyyy-MM-ddTHH:mm[:ss[.fff]]" with no zone: the local time, which here is Karachi. */
    private fun zonelessDateTime(s: String): Instant? {
        val parts = s.split("T", limit = 2)
        if (parts.size != 2 || !isBareDay(parts[0])) return null
        val midnight = ERPDate.parse(parts[0]) ?: return null
        val clock = parts[1].split(":")
        if (clock.size != 2 && clock.size != 3) return null
        val h = clock[0].toIntOrNull() ?: return null
        val m = clock[1].toIntOrNull() ?: return null
        if (h !in 0..23 || m !in 0..59) return null
        var seconds = 0.0
        if (clock.size == 3) {
            val sec = swiftDouble(clock[2]) ?: return null
            if (!(sec >= 0 && sec < 60) || clock[2].contains("+") || clock[2].contains("-")) return null
            seconds = sec
        }
        val whole = floor(seconds)
        return midnight.plusSeconds(-karachiOffset + h * 3600L + m * 60L + whole.toLong()).plusNanos(Math.round((seconds - whole) * 1e9))
    }

    /** `new Date(s)`: an ISO instant, a bare day (UTC midnight), or a zoneless date-time (Karachi). null is an invalid date. */
    fun newDate(s: String?): Instant? {
        if (s.isNullOrEmpty()) return null
        return ERPDate.parse(s) ?: zonelessDateTime(trim(s))
    }

    /**
     * date-fns `parseISO(s)`: as `newDate`, except that a bare day is the *local* midnight
     * (here Karachi's), which is the whole reason the web ERP uses it for promised days.
     */
    fun parseISO(s: String?): Instant? {
        if (s.isNullOrEmpty()) return null
        val t = trim(s)
        if (isBareDay(t)) return ERPDate.parse(t)?.minusSeconds(karachiOffset)
        return newDate(t)
    }

    /** date-fns `startOfDay`, in Karachi. */
    fun karachiStartOfDay(d: Instant): Instant {
        val midnightUTC = ERPDate.parse(ERPDate.karachiDay(d)) ?: d
        return midnightUTC.minusSeconds(karachiOffset)
    }

    /** date-fns `differenceInCalendarDays(a, b)` for two Karachi days. */
    fun calendarDays(a: Instant, since: Instant): Int =
        swiftRounded((karachiStartOfDay(a).seconds - karachiStartOfDay(since).seconds) / 86_400).toInt()

    /** en-GB's short month as the browser the web ERP runs in prints it ("Sept" for September). */
    val shortMonths = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")
    val shortWeekdays = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

    // The number habits the three rule files here use (Pricing.swift's extension)

    /** `Number(x) || 0` for a number in hand: a NaN (and a -0) is 0. */
    fun orZero(x: Double): Double = if (x.isNaN() || x == 0.0) 0.0 else x

    /** `Number(x) || 0` for a field that may be absent (`Number(undefined)` is NaN). */
    fun orZero(x: Double?): Double = if (x == null) 0.0 else orZero(x)

    /** JavaScript truthiness of a number: not 0, not NaN, and present. */
    fun truthy(x: Double?): Boolean = x != null && !(x.isNaN() || x == 0.0)

    /** `Math.max(0, x)`: a NaN stays NaN (Kotlin's `max` would say NaN too, but a plain comparison is the TS's). */
    fun atLeastZero(x: Double): Double = if (x.isNaN()) x else (if (x > 0) x else 0.0)
}

/**
 * JavaScript's `sort`, which is stable: elements that compare equal keep their order. `compare`
 * is the comparator's number: negative sorts `a` first. (A merge sort of its own, so an odd
 * comparator, a NaN say, can never raise the "contract violated" error the JDK's sort can.)
 */
internal fun <T> List<T>.jsSorted(compare: (T, T) -> Double): List<T> {
    if (size < 2) return toList()
    fun merge(items: List<T>): List<T> {
        if (items.size < 2) return items
        val mid = items.size / 2
        val left = merge(items.subList(0, mid))
        val right = merge(items.subList(mid, items.size))
        val out = ArrayList<T>(items.size)
        var i = 0
        var j = 0
        while (i < left.size && j < right.size) {
            // The right one goes first only when it is strictly smaller; a tie keeps the earlier one.
            if (compare(right[j], left[i]) < 0) out.add(right[j++]) else out.add(left[i++])
        }
        while (i < left.size) out.add(left[i++])
        while (j < right.size) out.add(right[j++])
        return out
    }
    return merge(this)
}
