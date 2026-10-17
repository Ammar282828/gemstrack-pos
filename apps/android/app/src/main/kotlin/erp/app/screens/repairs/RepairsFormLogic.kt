package erp.app.screens.repairs

import erp.core.models.Karigar

/** One piece being typed: kept as text until it is saved. */
data class RepairsDraftPiece(
    val key: Long,
    val item: String = "",
    val work: String = "",
    val weight: String = "",
    val price: String = "",
)

/** Everything the form holds as typed, for the payload (RepairsForm.swift `payload()`). */
data class RepairsFormValues(
    val customerId: String? = null,
    val name: String = "",
    val phone: String = "",
    val pieces: List<RepairsDraftPiece> = emptyList(),
    val hasDate: Boolean = true,
    /** "yyyy-MM-dd", Karachi's day. */
    val promised: String = "",
    val karigarId: String = "",
    val takenBy: String = "",
    val note: String = "",
    val advance: String = "",
    val method: String = "Cash",
    val editing: Boolean = false,
)

/** The pure rules of the New repair / Edit form (RepairsForm.swift), kept off the view so the JVM tests reach them. */
object RepairsFormLogic {
    /** A number typed in the field: commas ignored, nothing or 0 is nothing (sale-flow fields show 0 as blank). */
    fun number(text: String): Double? {
        val t = text.replace(",", "").trim(' ', '\t')
        if (t.isEmpty()) return null
        val v = swiftDouble(t) ?: return null
        return if (v > 0) v else null
    }

    /** A price or an advance: whole rupees (owner, 2026-10-17: "there should be no decimals"). */
    fun rupees(text: String): Double? = number(text)?.let { erp.app.ui.PaymentText.rounded(it) }?.takeIf { it > 0 }

    // Swift's `Double(String)`: a plain decimal (a phone's number pad types nothing else), no spaces inside.
    private val plain = Regex("""^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$""")
    private fun swiftDouble(t: String): Double? = if (plain.matches(t)) t.toDoubleOrNull()?.takeIf { it.isFinite() } else null

    fun hasPiece(pieces: List<RepairsDraftPiece>): Boolean =
        pieces.any { it.item.trim().isNotEmpty() || it.work.trim().isNotEmpty() }

    fun total(pieces: List<RepairsDraftPiece>): Double = pieces.fold(0.0) { sum, p -> sum + (rupees(p.price) ?: 0.0) }

    /**
     * `addRepair`'s `repair` (and `updateRepair`'s): a blank name stays blank, as the web saves `name.trim()` (the screens say
     * "Walk-in" for it; nothing writes that word), an empty piece is dropped, and a piece with only the work typed is called
     * "Piece", as the web does. An advance is taken at intake only; an edit's money stays as it is.
     */
    fun payload(v: RepairsFormValues, karigars: List<Karigar>): Map<String, Any?> {
        val kept = ArrayList<Map<String, Any?>>()
        for (p in v.pieces) {
            val item = p.item.trim()
            val work = p.work.trim()
            if (item.isEmpty() && work.isEmpty()) continue
            val doc = LinkedHashMap<String, Any?>()
            doc["item"] = if (item.isEmpty()) "Piece" else item
            doc["work"] = work
            number(p.weight)?.let { doc["weightG"] = it }
            rupees(p.price)?.let { doc["price"] = it }
            kept.add(doc)
        }
        val repair = LinkedHashMap<String, Any?>()
        repair["customerName"] = v.name.trim()
        repair["pieces"] = kept
        v.customerId?.let { if (it.isNotEmpty()) repair["customerId"] = it }
        val number = v.phone.trim()
        if (number.isNotEmpty()) repair["customerContact"] = RepairsKit.normalizePhone(number)
        if (v.hasDate) repair["promisedDate"] = v.promised
        karigars.firstOrNull { it.id == v.karigarId }?.let {
            repair["karigarId"] = it.id
            repair["karigarName"] = it.name
        }
        val by = v.takenBy.trim()
        if (by.isNotEmpty()) repair["takenBy"] = by
        val remark = v.note.trim()
        if (remark.isNotEmpty()) repair["internalNote"] = remark
        val advance = rupees(v.advance) ?: 0.0
        if (!v.editing && advance > 0) {
            repair["advance"] = advance
            repair["advanceMethod"] = v.method
        }
        return repair
    }
}
