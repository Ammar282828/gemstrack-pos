package erp.app.screens.settings

// What Settings → Import the Taheri Software book reads from the ERP's preview and sends back (TaheriBookImportSettings.swift;
// lib/writes/taheri-book-import.ts). Kept apart from the view so a JVM test can hold the payloads to the iPhone's.

/** A name or a number already in the book, but not both (taheri-book-import.ts `BookHalfMatch`). */
data class BookHalfMatch(
    val id: String,
    /** "customer" or "karigar". */
    val kind: String,
    val name: String,
    /** "same_name" or "same_phone". */
    val verdict: String,
    val matches: List<String>,
    /** The ledger entries those already carry. */
    val carried: Int,
) {
    /** The page's line under the name: "Same name as Demo — which carries 3 ledger entries". */
    val line: String
        get() {
            var s = (if (verdict == "same_name") "Same name as " else "Same number as ") + matches.joinToString(", ")
            if (carried > 0) s += " — which carries $carried ledger entr${if (carried == 1) "y" else "ies"}"
            return s
        }

    companion object {
        fun from(d: Map<*, *>, fallbackId: String): BookHalfMatch = BookHalfMatch(
            id = d["id"] as? String ?: fallbackId,
            kind = d["kind"] as? String ?: "customer",
            name = d["name"] as? String ?: "",
            verdict = d["verdict"] as? String ?: "same_name",
            matches = (d["matches"] as? List<*>).orEmpty().filterIsInstance<String>(),
            carried = count(d["carried"]),
        )
    }
}

/** `importTaheriBook`'s preview: what is in the file, the plan's tallies and its fingerprint. */
class BookPreview(out: Map<*, *>) {
    val source: String = out["source"] as? String ?: ""
    val customersInFile: Int
    val karigarsInFile: Int
    val counts: Map<String, Int>
    val halfMatches: List<BookHalfMatch>
    private val addsOnly: Int
    private val addsWithHalfMatches: Int
    val fingerprint: String = out["fingerprint"] as? String ?: ""

    init {
        val inFile = out["inFile"] as? Map<*, *> ?: emptyMap<Any, Any>()
        customersInFile = count(inFile["customers"])
        karigarsInFile = count(inFile["karigars"])
        counts = (out["counts"] as? Map<*, *> ?: emptyMap<Any, Any>()).entries.associate { it.key.toString() to count(it.value) }
        halfMatches = (out["halfMatches"] as? List<*>).orEmpty().mapIndexedNotNull { i, v -> (v as? Map<*, *>)?.let { BookHalfMatch.from(it, "half-$i") } }
        val adds = out["willAdd"] as? Map<*, *> ?: emptyMap<Any, Any>()
        addsOnly = count(adds["only"])
        addsWithHalfMatches = count(adds["withHalfMatches"])
    }

    fun count(key: String): Int = counts[key] ?: 0

    /** What Import adds (the page's `willAdd`), as the ERP counted it. */
    fun adds(takingHalfMatches: Boolean): Int = if (takingHalfMatches) addsWithHalfMatches else addsOnly
}

object TaheriBookImportLogic {
    /** The ERP's preview: read-only, so each look is its own (`seq`: ErpApi names a change by its content). */
    fun previewBody(seq: String): Map<String, Any?> = mapOf("preview" to true, "seq" to seq)

    /** Import: the preview's fingerprint (the ERP plans again and refuses if anything changed) and the half-matches' opt-in. */
    fun importBody(fingerprint: String, takeConflicts: Boolean): Map<String, Any?> =
        mapOf("fingerprint" to fingerprint, "takeConflicts" to takeConflicts)

    /** (customers, karigars) the ERP says it added. */
    fun added(out: Map<String, Any?>): Pair<Int, Int> = count(out["customers"]) to count(out["karigars"])

    fun records(n: Int): String = "$n record${if (n == 1) "" else "s"}"
}

/** `(v as? NSNumber)?.intValue ?? 0`: a count, from a number (or 0). */
private fun count(v: Any?): Int = (v as? Number)?.toInt() ?: 0
