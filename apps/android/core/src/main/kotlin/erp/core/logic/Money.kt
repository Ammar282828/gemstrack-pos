package erp.core.logic

import erp.core.shortestDigits
import erp.core.swiftRounded
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs

/** Lac and crore (src/lib/money.ts): how the shop reads big sums. 85,000 · 4.5 lac · 1.25 crore. */
object Money {
    const val lac: Double = 100_000.0
    const val crore: Double = 10_000_000.0

    /** C's `%.{digits}f`: the exact value, a tie going to the even digit (Java's own formatter rounds the shortest digits half up, which is not the same). */
    internal fun fixed(x: Double, digits: Int): String {
        if (x.isNaN()) return "nan"
        if (x.isInfinite()) return if (x < 0) "-inf" else "inf"
        val text = BigDecimal(abs(x)).setScale(digits, RoundingMode.HALF_EVEN).toPlainString()
        return if (x < 0 || (x == 0.0 && 1.0 / x < 0)) "-$text" else text
    }

    private fun trimmed(v: Double, digits: Int): String {
        var s = fixed(v, digits)
        if (s.contains(".")) {
            s = s.trimEnd('0')
            if (s.endsWith(".")) s = s.dropLast(1)
        }
        return s
    }

    /** Whole rupees grouped the way the ERP's en-US formatting groups them: 85,000. */
    fun grouped(n: Double): String {
        if (n.isNaN()) return "NaN"
        if (n.isInfinite()) return if (n < 0) "-∞" else "∞"
        val r = swiftRounded(n)
        val negative = r < 0 || (r == 0.0 && 1.0 / r < 0)
        // The shortest digits, as ICU prints a double, then padded with zeros.
        val whole = if (r == 0.0) "0" else shortestDigits(abs(r)).let { (digits, e) -> digits + "0".repeat(maxOf(0, e - digits.length)) }
        val out = StringBuilder()
        for ((i, ch) in whole.withIndex()) {
            if (i > 0 && (whole.length - i) % 3 == 0) out.append(',')
            out.append(ch)
        }
        return (if (negative) "-" else "") + out
    }

    fun lacCrore(n: Double, digits: Int = 2): String {
        val v = if (n.isFinite()) n else 0.0
        val sign = if (v < 0) "-" else ""
        val a = abs(v)
        val round = { x: Double -> fixed(x, digits).toDoubleOrNull() ?: x }
        if (a >= crore || round(a / lac) >= 100) return "$sign${trimmed(a / crore, digits)} crore"
        if (a >= lac || swiftRounded(a) >= lac) return "$sign${trimmed(a / lac, digits)} lac"
        return "$sign${grouped(a)}"
    }

    /** "PKR 4.5 lac". */
    fun pkrLac(n: Double, digits: Int = 2): String = "PKR ${lacCrore(n, digits)}"

    /** "PKR 321,700": exact, as invoices and receipts say it. */
    fun pkr(n: Double): String = "PKR ${grouped(n)}"
}
