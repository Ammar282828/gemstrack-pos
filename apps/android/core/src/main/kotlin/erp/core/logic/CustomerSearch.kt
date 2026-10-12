package erp.core.logic

import erp.core.isSwiftWhitespaceOrNewline
import erp.core.models.Customer
import java.text.Collator
import java.text.Normalizer
import java.util.Locale

/**
 * The book offered as a name is typed, on New sale and New order: who the counter most likely means,
 * first. The web's box (customer-autocomplete.tsx) keeps any name containing the letters, in book order;
 * the phone ranks them, and finds a customer by number too, since the counter often has only the number.
 *
 * Best first: the whole name; a name that begins with what is typed; one with a word that does ("dem" finds
 * "Sana Demo"); every typed word starting a word of the name ("sa de"); the letters anywhere; a number that
 * holds the typed digits however they were written (0300…, +92300…, 300…). Ties go to the shorter name, then
 * A to Z. Removed customers and the old "Walk-in Customer" records are never offered (lib/walk-in.ts).
 */
object CustomerSearch {
    /** Where the typed letters sit in a name: `name.substring(start, end)`. */
    data class TextRange(val start: Int, val end: Int)

    data class Hit(
        val customer: Customer,
        /** Where the typed letters sit in the name, for marking them; null when found by number. */
        val match: TextRange?,
        /** Found by the number, not the name. */
        val byPhone: Boolean,
    )

    /** The people of the book: not removed, not a walk-in record. */
    fun people(all: List<Customer>): List<Customer> = all.filter { (it.deletedAt ?: "").isEmpty() && !isWalkInName(it.name) }

    /** Typed digits as a number's own: no country code, no leading 0 ("0300 12" and "+92 300 12" are "30012"). */
    fun digitsTyped(s: String): String {
        var d = s.filter { it in '0'..'9' }
        if (d.startsWith("92") && d.length > 2) d = d.drop(2)
        while (d.startsWith("0")) d = d.drop(1)
        return d
    }

    /** Case and accents set aside: "Zoë" is "zoe". */
    private fun fold(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).filter { Character.getType(it) != Character.NON_SPACING_MARK.toInt() && Character.getType(it) != Character.COMBINING_SPACING_MARK.toInt() && Character.getType(it) != Character.ENCLOSING_MARK.toInt() }
            .lowercase(Locale.ROOT)

    private fun words(s: String): List<String> = s.split(' ', '-', '.', ',').filter { it.isNotEmpty() }

    private fun spaced(s: String): String = s.split(' ').filter { it.isNotEmpty() }.joinToString(" ")

    /** Where `needle` first sits in `name`, ignoring case and accents, in the name's own indexes. */
    private fun rangeOf(name: String, needle: String): TextRange? {
        if (needle.isEmpty()) return null
        // Each character of the name folded on its own, remembering where it came from.
        val folded = StringBuilder()
        val origin = ArrayList<Int>()
        var i = 0
        while (i < name.length) {
            val cp = name.codePointAt(i)
            val len = Character.charCount(cp)
            val piece = fold(name.substring(i, i + len))
            for (ch in piece) {
                folded.append(ch)
                origin.add(i)
            }
            i += len
        }
        val at = folded.indexOf(fold(needle))
        if (at < 0) return null
        val endFolded = at + fold(needle).length
        val start = origin[at]
        // The end is after the last matched character of the name.
        var end = start
        var j = at
        while (j < endFolded) {
            val o = origin[j]
            val len = Character.charCount(name.codePointAt(o))
            end = o + len
            j += 1
        }
        // Trailing marks of the last character belong to it.
        while (end < name.length && Character.getType(name[end]) == Character.NON_SPACING_MARK.toInt()) end += 1
        return TextRange(start, end)
    }

    private fun characterCount(s: String): Int = Normalizer.normalize(s, Normalizer.Form.NFC).let { it.codePointCount(0, it.length) }

    fun rank(query: String, all: List<Customer>, limit: Int = 6): List<Hit> {
        val q = spaced(fold(query))
        if (q.isEmpty()) return emptyList()
        val qWords = words(q)
        val qDigits = digitsTyped(query)
        // A number is being typed when the query is mostly digits.
        val typingNumber = qDigits.length >= 3 && query.none { it.isLetter() }

        val scored = mutableListOf<Pair<Int, Hit>>()
        for (c in people(all)) {
            val name = fold(c.name)
            val nameWords = words(name)
            var score: Int? = null
            if (!typingNumber) {
                if (name == q) {
                    score = 0
                } else if (name.startsWith(q)) {
                    score = 1
                } else if (nameWords.any { it.startsWith(q) }) {
                    score = 2
                } else if (qWords.size > 1 && qWords.all { w -> nameWords.any { it.startsWith(w) } }) {
                    score = 3
                } else if (name.contains(q)) {
                    score = 4
                }
            }
            var byPhone = false
            if (score == null && qDigits.length >= 3) {
                val numbers = listOf(c.phone, c.altPhone).map { if (phoneKey(it).isEmpty()) digitsTyped(it ?: "") else phoneKey(it) }
                if (numbers.any { it.isNotEmpty() && it.contains(qDigits) }) {
                    score = if (typingNumber) 1 else 5
                    byPhone = true
                }
            }
            val s = score ?: continue
            val range = if (byPhone) null else rangeOf(c.name, erp.core.swiftTrim(query))
            scored.add(s to Hit(customer = c, match = range, byPhone = byPhone))
        }
        val collator = Collator.getInstance(Locale.ROOT).apply { strength = Collator.SECONDARY }
        val sorted = scored.sortedWith { a, b ->
            if (a.first != b.first) return@sortedWith a.first.compareTo(b.first)
            val la = characterCount(a.second.customer.name)
            val lb = characterCount(b.second.customer.name)
            if (la != lb) return@sortedWith la.compareTo(lb)
            collator.compare(a.second.customer.name, b.second.customer.name)
        }
        return sorted.take(limit).map { it.second }
    }

    /** The typed name is exactly someone in the book (any case, any spacing): worth saying before a second customer of the same name is made. */
    fun exact(query: String, all: List<Customer>): List<Customer> {
        val q = spaced(fold(query))
        if (q.isEmpty()) return emptyList()
        return people(all).filter { spaced(fold(it.name)) == q }
    }
}

/**
 * A number as the ERP keeps it: +92… (phone-field.tsx `toE164`/`fromPasted` with Pakistan as the country, for the
 * shapes the counter types). "0300 1234567", "923001234567", "0092…", "+92 0300…" and a bare "3001234567" all
 * become "+923001234567"; anything else (a foreign number with its +, a number still being typed) stays as typed,
 * spaces and dashes aside.
 */
fun pakistanE164(raw: String): String {
    var t = raw.trim { isSwiftWhitespaceOrNewline(it) }.filter { it !in " -().'" }
    if (t.isEmpty()) return ""
    if (t.startsWith("00")) t = "+" + t.drop(2)
    // The code typed twice, pasted from a chat: "+92+92…".
    while (t.startsWith("+92+92")) t = t.drop(3)
    // A trunk zero inside an international number.
    if (t.startsWith("+920")) t = "+92" + t.drop(4)
    val digits = t.filter { isNumeric(it) }
    if (t.startsWith("+")) return "+$digits"
    if (digits.length == 11 && digits.startsWith("0")) return "+92" + digits.drop(1)
    if (digits.length == 12 && digits.startsWith("92")) return "+$digits"
    if (digits.length == 10 && digits.startsWith("3")) return "+92$digits"
    return t
}

private fun isNumeric(c: Char): Boolean {
    val type = Character.getType(c)
    return type == Character.DECIMAL_DIGIT_NUMBER.toInt() || type == Character.LETTER_NUMBER.toInt() || type == Character.OTHER_NUMBER.toInt()
}
