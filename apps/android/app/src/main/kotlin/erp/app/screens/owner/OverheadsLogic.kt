package erp.app.screens.owner

import erp.app.screens.money.MoneyParse
import erp.app.ui.PaymentText
import erp.core.logic.Overheads
import erp.core.models.OverheadItem

/**
 * One line of the sheet as it is being typed (OverheadsScreen.swift `OverheadDraftLine`): the amount kept as typed, read
 * the way the web's amount box reads it.
 */
data class OverheadDraftLine(val id: String, val label: String = "", val amountText: String = "") {
    constructor(item: OverheadItem) : this(
        id = item.id,
        label = item.label,
        // A sale-flow number field shows 0 as blank (decision "Number fields").
        amountText = if (item.amount == 0.0) "" else PaymentText.field(item.amount),
    )

    val item: OverheadItem get() = OverheadItem(id = id, label = label, amount = MoneyParse.rupees(amountText) ?: 0.0)

    companion object {
        fun lines(items: List<OverheadItem>): List<OverheadDraftLine> = items.map { OverheadDraftLine(it) }
    }
}

object OverheadsSave {
    /**
     * Each line goes with its own id (the ERP refuses two alike): an old line saved without one gets a new one.
     * `items` is the sheet as typed; the result is what is sent.
     */
    fun withUniqueIds(items: List<OverheadItem>): List<OverheadItem> {
        val kept = ArrayList<OverheadItem>()
        for (line in items) {
            val fixed = if (line.id.isEmpty() || kept.any { it.id == line.id }) line.copy(id = Overheads.newOverheadId(kept + items)) else line
            kept.add(fixed)
        }
        return kept
    }

    /** The fields of the write, as the ERP's `saveOverheadPlan` takes them (`seq` makes each save its own). */
    fun fields(items: List<OverheadItem>, seq: String): Map<String, Any?> =
        mapOf("items" to items.map { mapOf("id" to it.id, "label" to it.label, "amount" to it.amount) }, "seq" to seq)
}
