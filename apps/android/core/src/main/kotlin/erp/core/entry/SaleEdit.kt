package erp.core.entry

import erp.core.logic.RateInputKey
import erp.core.logic.RateKey
import erp.core.logic.invoiceExchanges
import erp.core.logic.isWalkInName
import erp.core.logic.rates
import erp.core.logic.rowsFromExchanges
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.Settings
import erp.core.swiftRounded
import erp.core.swiftTrimNewlines

// Edit invoice (src/app/invoices/[id]/edit, the sale page's `startEdit`): the invoice on file opened in New sale's
// own form, and saved as the sale page saves an edit, through the same `createInvoice` with the invoice's number
// (lib/writes/create-invoice.ts keeps its number, its date and its payments, and puts its hisaab right). Pure, so the
// contract cases compile it. (SaleEdit.swift.)
//
// As in the browser: every line is loaded as it was billed (a line with a fixed price keeps that price), the
// invoice's own rates are held (never written back to the shop's), the payment rows start empty (money taken now is
// added to what was paid before), and a piece taken off the bill stays sold.

class SaleEdit(inv: Invoice, settings: Settings?) {
    val invoiceId: String = inv.id

    /** What was paid before this edit: it stays on the invoice, and new payments are added to it. */
    val paidBefore: Double = inv.amountPaid
    val draft: SaleDraft

    init {
        val d = SaleDraft()
        d.lines = inv.items.map { SaleLine.billed(it) }.toMutableList()
        val id = inv.customerId ?: ""
        d.customerId = if (id.isEmpty()) null else id
        d.customerName = if (isWalkInName(inv.customerName) && id.isEmpty()) "" else inv.customerName
        d.customerPhone = inv.customerContact ?: ""
        // The invoice's own rates in every box, held: a rate it lacks is the shop's, as the browser fills it.
        val stamped = inv.ratesApplied
        val shop = settings?.rates ?: emptyMap()
        fun rate(k: RateInputKey): Double {
            val own: Double? = when (k.rateKey) {
                RateKey.goldRatePerGram24k -> stamped.goldRatePerGram24k
                RateKey.goldRatePerGram22k -> stamped.goldRatePerGram22k
                RateKey.goldRatePerGram21k -> stamped.goldRatePerGram21k
                RateKey.goldRatePerGram18k -> stamped.goldRatePerGram18k
                RateKey.palladiumRatePerGram -> stamped.palladiumRatePerGram
                RateKey.palladiumRatePerGram18k -> stamped.palladiumRatePerGram18k
                RateKey.palladiumRatePerGram12k -> stamped.palladiumRatePerGram12k
                RateKey.platinumRatePerGram -> stamped.platinumRatePerGram
                RateKey.silverRatePerGram -> stamped.silverRatePerGram
            }
            if (own != null && own > 0) return own
            return shop[k.rateKey] ?: 0.0
        }
        val boxes = LinkedHashMap<String, String>()
        for (k in RateInputKey.values()) {
            val v = rate(k)
            if (v > 0) boxes[k.name] = SaleNumber.text(v)
        }
        d.rates = boxes
        d.discount = SaleNumber.text(inv.discountAmount)
        val rows = rowsFromExchanges(invoiceExchanges(inv)).map { SaleExchangeRow(it) }
        d.exchanges = if (rows.isEmpty()) mutableListOf(SaleExchangeRow.blank()) else rows.toMutableList()
        d.payments = mutableListOf(SalePaymentRow())
        d.takenBy = inv.takenBy ?: ""
        d.hideRates = inv.hideRates
        d.internalNote = inv.internalNote ?: ""
        val perGram = inv.costRate24k ?: 0.0
        d.costTola = if (perGram > 0) swiftRounded(perGram * SALE_GRAMS_PER_TOLA).toLong().toString() else ""
        val del = SaleDelivery()
        val x = inv.delivery
        if (x != null && x.required && swiftTrimNewlines(x.address).isNotEmpty()) {
            del.required = true
            del.address = x.address
            del.city = x.city ?: ""
            del.expectedDate = x.expectedDate ?: ""
            del.contactName = x.contactName ?: ""
            del.contactPhone = x.contactPhone ?: ""
            del.charge = SaleNumber.text(x.charge)
            del.notes = x.notes ?: ""
        }
        d.delivery = del
        draft = d
    }
}

/**
 * A billed line back on the sale, as `loadCartFromInvoice` puts it in the cart: a fixed-price line keeps its price,
 * and its stones and diamonds are read from its own flags and details (its charges are 0).
 */
fun SaleLine.Companion.billed(item: InvoiceItem): SaleLine {
    val l = SaleLine.blankFor(item.metalType.rawValue, item.sku)
    l.name = item.name
    l.categoryId = item.categoryId
    l.karat = item.karat?.rawValue
    l.metalWeightG = item.metalWeightG
    val stoneNote = swiftTrimNewlines(item.stoneDetails ?: "")
    val diamondNote = swiftTrimNewlines(item.diamondDetails ?: "")
    l.hasStones = item.stoneChargesIfAny > 0 || item.hasStones || stoneNote.isNotEmpty()
    l.stoneWeightG = item.stoneWeightG
    l.wastagePercentage = item.wastagePercentage
    l.makingCharges = item.makingCharges
    l.hasDiamonds = item.diamondChargesIfAny > 0 || item.hasDiamonds || diamondNote.isNotEmpty()
    l.diamondCharges = item.diamondChargesIfAny
    l.stoneCharges = item.stoneChargesIfAny
    l.miscCharges = item.miscChargesIfAny
    l.stoneDetails = item.stoneDetails
    l.diamondDetails = item.diamondDetails
    l.size = item.size
    val fixed = item.isCustomPrice || item.isManualPrice
    l.isCustomPrice = fixed
    l.customPrice = if (fixed) item.unitPrice else null
    val r = item.silverRatePerGram
    if (r != null && r > 0) l.silverRatePerGram = r
    l.platingType = item.platingType
    l.platingNote = item.platingNote
    l.nickelFree = item.nickelFree
    return l
}

/** The edit as createInvoice takes it: the sale's own payload with the invoice's number. */
fun SaleDraft.editPayload(f: SaleFigures, invoiceId: String, qr: (String) -> String?): MutableMap<String, Any?> {
    val out = payload(f, qr)
    out["existingInvoiceId"] = invoiceId
    return out
}
