package erp.app.screens.invoices

import erp.app.data.ErpApi
import erp.app.ui.PaymentText
import erp.app.ui.ShopDate
import erp.core.logic.BalanceState
import erp.core.logic.InvoiceActions
import erp.core.logic.balanceLine
import erp.core.logic.canHoldCredit
import erp.core.logic.inCredit
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.Payment
import erp.app.ui.OwnerDeletion

// What the invoice page's own actions share (InvoiceActionKit.swift; components/invoice/invoice-viewer.tsx): change
// the discount, delete a payment, refund, delete. Each sheet says exactly what will change, from the ERP's own rules
// (core InvoiceActions, ported from lib/invoice-actions.ts), before anything is sent; the write is the ERP's
// (/api/app/write, ops-invoice-actions.ts). A delete or a refund asks for the delete code with it (decision "Delete
// code"). Owners only: on the web each is the store's own Firestore write, which the shop floor cannot make.

object InvoiceActionWords {
    /**
     * The figures a confirmation was worked out from: the ERP changes nothing if the invoice has moved since (a
     * payment taken on another screen), so what was agreed to is what happens.
     */
    fun seen(inv: Invoice): Map<String, Any?> = mapOf("grandTotal" to inv.grandTotal, "amountPaid" to inv.amountPaid)

    /** "Balance due PKR 5,000", "Credit to customer PKR 3,000" or "Paid in full", never a negative balance. */
    fun balance(balanceDue: Double): String {
        val line = balanceLine(balanceDue)
        return if (line.state == BalanceState.paid) line.label else "${line.label} ${PaymentText.pkr(line.amount)}"
    }

    /** Who the ledger row is for, as the page names them. */
    fun who(inv: Invoice): String = InvoiceFacts.customerName(inv, walkIn = "the walk-in")

    /**
     * What the customer's hisaab does after a change that leaves `balanceDue` owing (the shared writes' ledger
     * rule): one row at what is owed, or none once nothing is. A walk-in has no hisaab of their own.
     * `keepsCredit`: the write also keeps the invoice's credit row (deleting a payment does, `followCredit`; the
     * discount's write does not, and the ledger sync puts that right later).
     */
    fun ledger(inv: Invoice, balanceDue: Double, keepsCredit: Boolean = false): String {
        if (balanceDue >= 1) {
            return if (canHoldCredit(inv.customerId)) "${who(inv)}'s hisaab shows ${PaymentText.pkr(balanceDue)} owed on it."
            else "Its walk-in ledger row shows ${PaymentText.pkr(balanceDue)} owed."
        }
        if (keepsCredit && inCredit(balanceDue) && canHoldCredit(inv.customerId)) {
            return "${who(inv)}'s hisaab holds ${PaymentText.pkr(-balanceDue)} as credit."
        }
        return "Nothing is owed on it: its ledger row for what was owed goes."
    }

    /** The store's words as its delete-code dialog says them (requireDeleteCode). */
    fun deletePaymentWhat(amount: Double, invoiceId: String): String = "Delete the payment of ${PaymentText.pkr(amount)} on $invoiceId"

    fun refundWhat(amount: Double, invoiceId: String): String = "Refund ${PaymentText.pkr(amount)} on $invoiceId"

    fun deleteInvoiceWhat(invoiceId: String): String = "Delete invoice $invoiceId"

    /** One piece as a person names it: "Ruby ring (RNG-001)", the stock number only when it is one. */
    fun piece(item: InvoiceItem): String {
        val name = item.name.trim()
        val oneOff = item.sku.startsWith("NEW-") || item.sku.startsWith("BILL-")
        if (name.isEmpty()) return item.sku
        return if (oneOff) name else "$name (${item.sku})"
    }

    /**
     * What deleting the invoice takes with it (lib/writes/invoice-delete.ts): its ledger rows, its pieces back in
     * stock (core piecesBackInStock), its order's link, Shopify's copy. Said before the code is asked.
     * `ledgerRows` null: the hisaab is not read yet, and the rows are said without a count rather than as none.
     */
    fun deletion(inv: Invoice, others: List<Invoice>, ledgerRows: Int?): String {
        val lines = mutableListOf<String>()
        when (ledgerRows) {
            null -> lines.add("Its ledger rows on the hisaab go with it.")
            0 -> lines.add("It has no ledger rows.")
            else -> lines.add("Its $ledgerRows ledger row${if (ledgerRows == 1) "" else "s"} on the hisaab go${if (ledgerRows == 1) "es" else ""} with it.")
        }
        val back = InvoiceActions.piecesBackInStock(inv, others)
        if (back.isEmpty()) {
            lines.add("No piece goes back in stock.")
        } else {
            lines.add("Back in stock: " + back.joinToString(", ") { piece(it) } + ".")
        }
        // Fewer back than it has: a piece made for an order (never stock) or sold on another invoice too stays as it is.
        if (back.size < inv.items.map { it.sku }.filter { it.isNotEmpty() }.toSet().size) {
            lines.add("A piece made for an order, or sold on another invoice too, stays where it is.")
        }
        inv.sourceOrderId?.takeIf { it.isNotEmpty() }?.let { lines.add("Order $it stays, without this invoice: its advance counts again.") }
        val shop = inv.shopifyOrderId
        if (!shop.isNullOrEmpty() && !inv.id.startsWith("SHOPIFY-")) lines.add("Its Shopify order is cancelled too.")
        return lines.joinToString(" ")
    }

    // MARK: The writes, key for key

    /** `deleteInvoice` (a delete, and a full refund, which is the same write). */
    fun deleteInvoiceFields(invoiceId: String, code: String): Map<String, Any?> = mapOf("invoiceId" to invoiceId, "deleteCode" to code)

    /** `deleteInvoicePayment`: the payment as the list showed it (its place, amount and date); the ERP checks all three. */
    fun deletePaymentFields(invoiceId: String, index: Int, p: Payment, code: String): Map<String, Any?> = mapOf(
        "invoiceId" to invoiceId, "index" to index, "amount" to p.amount, "paymentDate" to p.date, "deleteCode" to code,
    )

    /** `updateInvoiceDiscount`. */
    fun discountFields(inv: Invoice, discount: Double): Map<String, Any?> =
        mapOf("invoiceId" to inv.id, "discountAmount" to discount, "seen" to seen(inv))

    /** `refundInvoicePartial`; the reason only when one was given. */
    fun partialRefundFields(invoiceId: String, amount: Double, code: String, seen: Map<String, Any?>, reason: String): Map<String, Any?> {
        val fields = linkedMapOf<String, Any?>("invoiceId" to invoiceId, "amount" to amount, "deleteCode" to code, "seen" to seen)
        if (reason.isNotEmpty()) fields["reason"] = reason
        return fields
    }

    /** `setInvoiceCustomer`: the customer picked, and the number only when there is one. */
    fun customerFields(invoiceId: String, name: String, customerId: String?, phoneE164: String): Map<String, Any?> {
        val fields = linkedMapOf<String, Any?>("invoiceId" to invoiceId, "name" to name)
        if (customerId != null) fields["customerId"] = customerId
        if (phoneE164.isNotEmpty()) fields["phone"] = phoneE164
        return fields
    }

    // MARK: Deleting one payment

    /** How it came and what it says (older records predate payment types and have none). */
    fun paymentDetail(p: Payment): String {
        val parts = mutableListOf(p.method?.rawValue ?: "—")
        p.reference?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        val note = (p.notes ?: "").trim()
        parts.add(if (note.isEmpty()) "Payment received" else note)
        return parts.joinToString(" · ")
    }

    /**
     * What deleting one payment says and does: the delete code's words, the ERP's write, and the note for the page
     * after. The sheet's rows and the invoice page's swipe both start it. Null when the payment is no longer there.
     */
    fun deletingPayment(invoice: Invoice, index: Int, p: Payment): Pair<OwnerDeletion, InvoiceActionOutcome>? {
        val after = InvoiceActions.withoutPayment(InvoiceActions.Figures(invoice), index) ?: return null
        val whenSaid = ShopDate.say(p.date)
        val note = (p.notes ?: "").trim()
        var said = "${PaymentText.pkr(p.amount)} of $whenSaid${if (note.isEmpty()) "" else " ($note)"} comes off ${invoice.id}."
        said += " Paid becomes ${PaymentText.pkr(after.amountPaid)}; ${balance(after.balanceDue)}."
        said += " " + ledger(invoice, after.balanceDue, keepsCredit = true)
        invoice.sourceOrderId?.takeIf { it.isNotEmpty() }?.let { said += " Order $it's balance becomes ${PaymentText.pkr(after.balanceDue)}." }
        val line = balanceLine(after.balanceDue)
        val outcome = InvoiceActionOutcome(
            note = InvoiceNote(
                "Payment deleted",
                "${PaymentText.pkr(p.amount)} taken off ${invoice.id}. ${line.label}${if (line.amount > 0) ": ${PaymentText.pkr(line.amount)}" else ""}.",
            ),
            removed = false,
        )
        val invoiceId = invoice.id
        val deletion = OwnerDeletion(deletePaymentWhat(p.amount, invoiceId), said, run = { code ->
            ErpApi.shared.write("deleteInvoicePayment", deletePaymentFields(invoiceId, index, p, code))
        })
        return deletion to outcome
    }
}
