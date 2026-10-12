package erp.core.entry

import java.text.Normalizer

// A name read off paper, ranked against the book and offered, never decided: src/lib/voice/phonetics.ts
// (`phoneticKey`, `nameScore`, `rankNames`) and the scanners' `guessName` (lib/vision/order-draft.ts,
// `guessCustomer` in bill-draft.ts), ported line for line so the phone ranks a slip's "Alifya" exactly as the
// browser does. Shared by Read a slip (New order) and Read a written bill (New sale). (NewOrderScanNames.swift.)
//
// The bar is higher than voice's: a slip gives the matcher a few characters of somebody's shorthand, and a wrong
// karigar on an order is gold leaving the shop in the wrong direction. Only a clear winner is pinned; anything short
// of that comes back as candidates for a person to pick from.

/** Someone in the book a name is matched against (phonetics.ts `RosterEntry`). */
data class PaperPerson(val id: String, val name: String)

/** One of the book, with how well the name read off the paper matches it. */
data class PaperRankedName(val id: String, val name: String, val score: Double)

/**
 * A name read off paper (order-draft.ts `NameGuess`): what was written, the one person it surely is (only a clear
 * winner), and who else it might be. `pinned` is the person's choice from then on ("Not them", "Which one?").
 */
data class PaperNameGuess(val heard: String, var pinned: PaperRankedName?, val candidates: List<PaperRankedName>)

object PaperNames {
    /** `guessName`: pinned at 0.88 and 0.15 clear of the next; candidates over 0.45, five at most. */
    fun guess(heard: String?, pool: List<PaperPerson>): PaperNameGuess? {
        val text = NewOrderFormat.trim(heard ?: "")
        if (text.isEmpty()) return null
        val ranked = rank(text, pool)
        val top = ranked.firstOrNull()
        val next = if (ranked.size > 1) ranked[1] else null
        var decisive = false
        if (top != null && top.score >= 0.88) {
            decisive = if (next != null) top.score - next.score >= 0.15 else true
        }
        return PaperNameGuess(
            heard = text,
            pinned = if (decisive) top else null,
            candidates = ranked.filter { it.score > 0.45 }.take(5),
        )
    }

    /** `rankNames` (no learned aliases: a slip's names are never taught). Best first; equal scores keep the book's order, as the browser's stable sort does. */
    fun rank(query: String, roster: List<PaperPerson>): List<PaperRankedName> =
        roster.withIndex()
            .map { (i, r) -> i to PaperRankedName(r.id, r.name, nameScore(query, r.name)) }
            .sortedWith { a, b -> if (a.second.score != b.second.score) (if (a.second.score > b.second.score) -1 else 1) else a.first.compareTo(b.first) }
            .map { it.second }

    // The sound of a name

    private val aspirate = Regex("([kgbdtjcs])h")
    private val doubled = Regex("(.)\\1+")
    private val finalH = Regex("h$")
    private val finalVowel = Regex("[ae]$")

    /** Sound-alike pairs that genuinely occur when these names are written in Latin script (`tokenKey`). */
    fun tokenKey(word: String): String {
        var s = word
        // Aspirated consonants lose the h — Khan/Kan, Ghulam/Gulam, Bhai/Bai
        s = s.replace("ph", "f")
        s = aspirate.replace(s, "$1")
        // Spelling variants for the same sound
        s = s.replace("ck", "k").replace("q", "k").replace("x", "ks")
        s = s.replace("w", "v") // Wala/Vala, Anwar/Anvar
        s = s.replace("z", "j") // Zainab/Jainab — z is commonly voiced as j in Gujarati
        s = s.replace("y", "i")
        // Long vowels are written doubled or singly at random — Batool/Batul, Sakeena/Sakina
        s = s.replace("aa", "a").replace("ee", "i").replace("oo", "u")
        s = s.replace("ai", "e").replace("au", "o").replace("ou", "u")
        s = doubled.replace(s, "$1") // Abbas/Abas, Shabbir/Shabir
        s = finalH.replace(s, "") // Fatemah/Fatema
        s = finalVowel.replace(s, "a") // Fateme/Fatema
        return s
    }

    /**
     * The same names in the scripts they are also spoken and written in (Urdu and Arabic, Gujarati, Devanagari), by
     * code point (`SCRIPTS`), deliberately rough: close enough for the sound rules to do their work.
     */
    private val scripts: Map<Int, String> = mapOf(
        0x0627 to "a", 0x0622 to "a", 0x0623 to "a", 0x0625 to "a", 0x0628 to "b", 0x067E to "p", 0x062A to "t", 0x0679 to "t",
        0x062B to "s", 0x062C to "j", 0x0686 to "ch", 0x062D to "h", 0x062E to "kh", 0x062F to "d", 0x0688 to "d", 0x0630 to "z",
        0x0631 to "r", 0x0691 to "r", 0x0632 to "z", 0x0698 to "zh", 0x0633 to "s", 0x0634 to "sh", 0x0635 to "s", 0x0636 to "z",
        0x0637 to "t", 0x0638 to "z", 0x0639 to "a", 0x063A to "gh", 0x0641 to "f", 0x0642 to "k", 0x06A9 to "k", 0x0643 to "k",
        0x06AF to "g", 0x0644 to "l", 0x0645 to "m", 0x0646 to "n", 0x06BA to "n", 0x0648 to "o", 0x06C1 to "h", 0x0647 to "h",
        0x06BE to "h", 0x06CC to "i", 0x064A to "i", 0x06D2 to "e", 0x0A85 to "a", 0x0A86 to "a", 0x0A87 to "i", 0x0A88 to "i",
        0x0A89 to "u", 0x0A8A to "u", 0x0A8F to "e", 0x0A90 to "ai", 0x0A93 to "o", 0x0A94 to "au", 0x0A95 to "k", 0x0A96 to "kh",
        0x0A97 to "g", 0x0A98 to "gh", 0x0A9A to "ch", 0x0A9B to "ch", 0x0A9C to "j", 0x0A9D to "jh", 0x0A9F to "t", 0x0AA0 to "th",
        0x0AA1 to "d", 0x0AA2 to "dh", 0x0AA3 to "n", 0x0AA4 to "t", 0x0AA5 to "th", 0x0AA6 to "d", 0x0AA7 to "dh", 0x0AA8 to "n",
        0x0AAA to "p", 0x0AAB to "f", 0x0AAC to "b", 0x0AAD to "bh", 0x0AAE to "m", 0x0AAF to "y", 0x0AB0 to "r", 0x0AB2 to "l",
        0x0AB3 to "l", 0x0AB5 to "v", 0x0AB6 to "sh", 0x0AB7 to "sh", 0x0AB8 to "s", 0x0AB9 to "h", 0x0ABE to "a", 0x0ABF to "i",
        0x0AC0 to "i", 0x0AC1 to "u", 0x0AC2 to "u", 0x0AC7 to "e", 0x0AC8 to "ai", 0x0ACB to "o", 0x0ACC to "au", 0x0ACD to "",
        0x0A82 to "n", 0x0905 to "a", 0x0906 to "a", 0x0907 to "i", 0x0908 to "i", 0x0909 to "u", 0x090A to "u", 0x090F to "e",
        0x0910 to "ai", 0x0913 to "o", 0x0914 to "au", 0x0915 to "k", 0x0916 to "kh", 0x0917 to "g", 0x0918 to "gh", 0x091A to "ch",
        0x091B to "ch", 0x091C to "j", 0x091D to "jh", 0x091F to "t", 0x0920 to "th", 0x0921 to "d", 0x0922 to "dh", 0x0923 to "n",
        0x0924 to "t", 0x0925 to "th", 0x0926 to "d", 0x0927 to "dh", 0x0928 to "n", 0x092A to "p", 0x092B to "f", 0x092C to "b",
        0x092D to "bh", 0x092E to "m", 0x092F to "y", 0x0930 to "r", 0x0932 to "l", 0x0935 to "v", 0x0936 to "sh", 0x0937 to "sh",
        0x0938 to "s", 0x0939 to "h", 0x093E to "a", 0x093F to "i", 0x0940 to "i", 0x0941 to "u", 0x0942 to "u", 0x0947 to "e",
        0x0948 to "ai", 0x094B to "o", 0x094C to "au", 0x094D to "", 0x0902 to "n",
    )

    /**
     * Anything outside Latin (U+0020–U+024F) is read through `scripts`, else becomes a space. By code point, as the
     * browser's /u regex walks it: a Gujarati vowel sign is its own letter here, not part of the one before.
     */
    private fun transliterate(s: String): String {
        val out = StringBuilder()
        s.codePoints().forEach { u ->
            if (u in 0x20..0x24F) out.appendCodePoint(u) else out.append(scripts[u] ?: " ")
        }
        return out.toString()
    }

    /** JavaScript's `\s`. */
    private fun isSpace(u: Int): Boolean = when (u) {
        in 0x09..0x0D, 0x20, 0xA0, 0x1680, in 0x2000..0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF -> true
        else -> false
    }

    /** `phoneticKey`: the name's words, each reduced to its sound. */
    fun phoneticKey(name: String?): List<String> {
        val lower = Normalizer.normalize(transliterate(name ?: "").lowercase(), Normalizer.Form.NFD)
        val base = StringBuilder()
        lower.codePoints().forEach { u ->
            when {
                u in 0x300..0x36F -> Unit
                u in 0x61..0x7A || isSpace(u) -> base.appendCodePoint(u)
                else -> base.append(' ')
            }
        }
        val words = ArrayList<String>()
        val cur = StringBuilder()
        base.toString().codePoints().forEach { u ->
            if (isSpace(u)) {
                if (cur.isNotEmpty()) {
                    words.add(cur.toString())
                    cur.setLength(0)
                }
            } else {
                cur.appendCodePoint(u)
            }
        }
        if (cur.isNotEmpty()) words.add(cur.toString())
        return words.map { tokenKey(it) }.filter { it.isNotEmpty() }
    }

    // How alike two names are

    /** Edit distance over the keys' letters (they are a–z only by now). */
    private fun levenshtein(a: ByteArray, b: ByteArray): Int {
        if (a.contentEquals(b)) return 0
        if (a.isEmpty()) return b.size
        if (b.isEmpty()) return a.size
        var prev = IntArray(b.size + 1) { it }
        for (i in a.indices) {
            val cur = IntArray(b.size + 1)
            cur[0] = i + 1
            for (j in b.indices) {
                cur[j + 1] = minOf(prev[j + 1] + 1, cur[j] + 1, prev[j] + (if (a[i] == b[j]) 0 else 1))
            }
            prev = cur
        }
        return prev[b.size]
    }

    private fun ratio(a: String, b: String): Double {
        val x = a.toByteArray(Charsets.UTF_8)
        val y = b.toByteArray(Charsets.UTF_8)
        if (x.isEmpty() && y.isEmpty()) return 1.0
        return 1 - levenshtein(x, y).toDouble() / maxOf(x.size, y.size).toDouble()
    }

    /**
     * `nameScore`: token by token. Every word written must find a home in the stored name (a word with nowhere to go
     * pulls the score down); the stored name's own extra words are only lightly penalised, since a slip often carries
     * part of a name ("Fatema" for "Fatema Bakir Abuwala").
     */
    fun nameScore(query: String, candidate: String): Double {
        val q = phoneticKey(query)
        val c = phoneticKey(candidate)
        if (q.isEmpty() || c.isEmpty()) return 0.0
        val pool = c.toMutableList()
        var total = 0.0
        for (qt in q) {
            var best = 0.0
            var bestAt = -1
            for ((i, ct) in pool.withIndex()) {
                val r = ratio(qt, ct)
                if (r > best) {
                    best = r
                    bestAt = i
                }
            }
            if (bestAt >= 0 && best > 0.5) pool.removeAt(bestAt)
            total += best
        }
        val covered = total / q.size.toDouble()
        // Matching one token of a three-token name is weaker evidence than matching all of them.
        val completeness = 1 - (pool.size.toDouble() / c.size.toDouble()) * 0.25
        return smax(0.0, smin(1.0, covered * completeness))
    }
}
