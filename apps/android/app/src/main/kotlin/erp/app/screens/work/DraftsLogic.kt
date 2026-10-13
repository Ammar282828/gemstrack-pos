package erp.app.screens.work

import erp.app.ui.AppClock
import erp.app.ui.ShopDate
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderMath
import erp.core.entry.SaleDraft
import erp.core.entry.SaleNumber
import erp.core.logic.PricingRates
import erp.core.logic.WorkDraft
import erp.core.logic.calculateProductCosts
import erp.core.logic.draftHref
import erp.core.logic.draftOrderDetail
import erp.core.logic.draftSaleDetail
import erp.core.logic.draftTitle
import erp.core.models.Settings
import java.time.Instant

/** One row: a draft in Drafts, or this phone's own work that Drafts does not hold (DraftsScreen.swift `DraftRow`). */
data class DraftRow(
    val draft: WorkDraft,
    /** Only this phone has it (staff, drafts turned off, not yet sent). */
    val phoneOnly: Boolean,
    /** This phone holds the work of this draft, so the native form continues it. */
    val native: Boolean,
) {
    val id: String get() = if (phoneOnly) "phone-" + draft.kind else draft.id
}

/** The Drafts page's pure rules (DraftsScreen.swift), kept off the view so they are tested. */
object DraftsLogic {
    /**
     * The drafts in hand plus the work only this phone has, which comes first: it is what is being typed now. One that was sent
     * to Drafts and is no longer there was finished or discarded at the counter; the form clears it when it next opens.
     */
    fun rows(
        live: List<WorkDraft>,
        phoneOrder: NewOrderDraft?,
        phoneSale: SaleDraft?,
        orderId: String?,
        saleId: String?,
        seesDrafts: Boolean,
        settings: Settings?,
    ): List<DraftRow> {
        val out = ArrayList<DraftRow>()
        var hasOrder = false
        var hasSale = false
        for (d in live) {
            var native = false
            if (d.isOrder && phoneOrder != null && d.id == orderId) { native = true; hasOrder = true }
            if (d.isSale && phoneSale != null && d.id == saleId) { native = true; hasSale = true }
            out.add(DraftRow(d, phoneOnly = false, native = native))
        }
        val mine = ArrayList<DraftRow>()
        if (phoneOrder != null && !hasOrder && !(seesDrafts && orderId != null)) mine.add(DraftRow(orderCard(phoneOrder, settings), true, true))
        if (phoneSale != null && !hasSale && !(seesDrafts && saleId != null)) mine.add(DraftRow(saleCard(phoneSale, settings), true, true))
        return mine + out
    }

    /** The card of the order kept on this phone, worked out as Drafts' own would be (`summarizeOrder`). */
    fun orderCard(d: NewOrderDraft, settings: Settings?): WorkDraft {
        val t = NewOrderMath.totals(d, settings)
        val names = d.pieces.map { it.description.trim() }.filter { it.isNotEmpty() }
        return WorkDraft(
            id = "phone-order", kind = "order", title = draftTitle(d.customerName),
            detail = draftOrderDetail(names, d.pieces.size, t.advance),
            items = d.pieces.size, total = maxOf(0.0, t.balance), device = "", createdAt = "", updatedAt = "",
        )
    }

    /** The card of the sale kept on this phone: the pieces at today's rates, as the New screen's card has it. */
    fun saleCard(d: SaleDraft, settings: Settings?): WorkDraft {
        var subtotal = 0.0
        if (settings != null) {
            val rates = PricingRates(settings)
            for (line in d.lines) subtotal += calculateProductCosts(line.priced, rates).totalPrice
        }
        val names = d.lines.map { if (it.name.isEmpty()) it.sku else it.name }.filter { it.isNotEmpty() }
        return WorkDraft(
            id = "phone-sale", kind = "sale", title = draftTitle(d.customerName),
            detail = draftSaleDetail(names, SaleNumber.value(d.discount)),
            items = d.lines.size, total = maxOf(0.0, subtotal), device = "", createdAt = "", updatedAt = "",
        )
    }

    /** Where a row opens: the native form where this phone holds the work, else the ERP's form on the draft. */
    fun path(row: DraftRow): String {
        if (row.native) return if (row.draft.isOrder) "/orders/add" else "/invoices/new"
        return draftHref(row.draft.kind, row.draft.id) + "&web=1"
    }

    /** "Last typed Today 4:05 pm on iPhone" (and a note when the photos were too big to keep). */
    fun lastTyped(row: DraftRow, now: Instant = AppClock.now()): String {
        val d = row.draft
        if (row.phoneOnly) return "On this phone"
        var line = "Last typed " + ShopDate.say(d.updatedAt, withTime = true, now = now)
        if (d.device.isNotEmpty()) line += " on " + d.device
        if (d.leftOut.contains("photos")) line += " · sample photos too large to keep"
        return line
    }

    /** The confirmation's second line. */
    fun discardMessage(row: DraftRow): String = "${if (row.draft.isOrder) "Order" else "Sale"} for ${row.draft.title}."
}
