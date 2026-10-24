package erp.core.logic

/**
 * The one reader of a number someone typed or pasted (amounts, weights, rates). Every screen goes through it so
 * "12,5" means the same everywhere; before, some fields read it as 125. Unreadable is null, never 0.
 * (ShopNumber.swift.)
 */
object ShopNumber {
    /**
     * Accepts ASCII, Arabic-Indic and Urdu digits. A comma groups thousands only when it groups 3 digits
     * ("1,500", lakh "1,50,000"); a lone comma with 1-2 digits after it and no dot ("12,5") is a decimal point,
     * as the decimal pad of a comma region types it. One "." is the decimal point. Spaces and "PKR"/"Rs" are ignored.
     */
    fun parse(text: String): Double? {
        var t = ascii(text).lowercase()
        for (word in listOf("pkr", "rs.", " rs", "rs")) t = t.replace(word, "")
        t = t.filter { !it.isWhitespace() }
        if (t.isEmpty() || !t.all { it in '0'..'9' || it == ',' || it == '.' }) return null
        if (!t.any { it in '0'..'9' }) return null

        val dots = t.count { it == '.' }
        if (dots > 1) return null
        var whole = t
        var fraction = ""
        if (dots == 1) {
            val dot = t.indexOf('.')
            whole = t.substring(0, dot)
            fraction = t.substring(dot + 1)
            if (fraction.contains(',')) return null
        } else {
            val comma = t.lastIndexOf(',')
            if (comma >= 0) {
                val after = t.length - comma - 1
                if ((after == 1 || after == 2) && t.count { it == ',' } == 1) {
                    whole = t.substring(0, comma)
                    fraction = t.substring(comma + 1)
                }
            }
        }
        if (whole.contains(',')) {
            val groups = whole.split(',')
            if (groups.size < 2 || groups.first().length !in 1..3 || groups.last().length != 3) return null
            if (!groups.drop(1).dropLast(1).all { it.length == 2 || it.length == 3 }) return null
            whole = groups.joinToString("")
        }
        if (whole.isEmpty() && fraction.isEmpty()) return null
        val s = (if (whole.isEmpty()) "0" else whole) + (if (fraction.isEmpty()) "" else ".$fraction")
        val v = s.toDoubleOrNull() ?: return null
        return if (v.isFinite()) v else null
    }

    /** Digits of any script to ASCII; the Arabic decimal and thousands marks to "." and ",". */
    fun ascii(text: String): String {
        val out = StringBuilder(text.length)
        for (ch in text) {
            when (ch.code) {
                in 0x0660..0x0669 -> out.append('0' + (ch.code - 0x0660))
                in 0x06F0..0x06F9 -> out.append('0' + (ch.code - 0x06F0))
                0x066B -> out.append('.')
                0x066C, 0x060C -> out.append(',')
                else -> out.append(ch)
            }
        }
        return out.toString()
    }

    /** True when something was typed but cannot be read (blank is not unreadable: it is just empty). */
    fun isUnreadable(text: String): Boolean = text.isNotBlank() && parse(text) == null
}
