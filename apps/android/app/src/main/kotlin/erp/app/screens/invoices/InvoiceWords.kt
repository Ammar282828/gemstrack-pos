package erp.app.screens.invoices

import erp.app.config.House
import erp.app.ui.ShopDate
import erp.core.logic.Margin
import erp.core.logic.MarginSettings
import erp.core.logic.Money
import erp.core.logic.customerSourceLabel
import erp.core.logic.describeMetal
import erp.core.logic.describePlating
import erp.core.logic.describeSettings
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Payment
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

// The words an invoice page prints about its pieces, payments and margin (InvoiceScreen.swift's row views),
// worked out apart from the screen so they are tested.

object InvoiceWords {
    /** Grams, to three places at most: 3.9, 12.345 (no grouping). */
    fun grams(v: Double): String {
        val f = DecimalFormat("0.###", DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_EVEN }
        return f.format(BigDecimal(v.toString()))
    }

    /** The piece's name, else its category, else its stock number. */
    fun pieceTitle(item: InvoiceItem): String {
        val name = item.name.trim()
        if (name.isNotEmpty()) return name
        return pieceCategory(item) ?: item.sku.ifEmpty { "Piece" }
    }

    /**
     * The category in words ("Ring" for cat001), or what the piece carries when it is not one of the ERP's own
     * (invoice-viewer.tsx: `categorySingular(id) || id`).
     */
    fun pieceCategory(item: InvoiceItem): String? {
        val c = item.itemCategory?.trim()
        if (c.isNullOrEmpty()) return null
        return InvoiceFacts.categoryWords(c)
    }

    /** The SKU worth showing a person: a one-off key (NEW-…, BILL-…) is not a stock number. */
    fun stockSku(sku: String): String? = if (sku.isEmpty() || sku.startsWith("NEW-") || sku.startsWith("BILL-")) null else sku

    /** The category (unless the name already says it), metal and karat, weight, size, finish, stone weight, and the stock number when it is one. */
    fun pieceFacts(item: InvoiceItem): List<String> {
        val out = mutableListOf<String>()
        val title = pieceTitle(item)
        val category = pieceCategory(item)
        if (category != null && title != category && !title.contains(category, ignoreCase = true)) out.add(category)
        out.add(describeMetal(item.metalType, item.karat))
        if (item.metalWeightG > 0) out.add(grams(item.metalWeightG) + " g")
        item.size?.takeIf { it.isNotEmpty() }?.let { out.add("Size $it") }
        describePlating(item)?.let { out.add(it) }
        if (item.stoneWeightG > 0) out.add("Stone " + grams(item.stoneWeightG) + " g")
        stockSku(item.sku)?.let { out.add(it) }
        return out.filter { it.isNotEmpty() }
    }

    /** What is set into it (diamonds, stones), less the lines the facts already say. */
    fun pieceSettings(item: InvoiceItem): List<String> =
        describeSettings(item).filter { !it.startsWith("Finish:") && !it.startsWith("Stone weight:") }

    /** The price broken into metal, wastage, making and stones, as the order's pieces do (owners only). */
    fun pieceCosts(item: InvoiceItem): List<String> {
        val out = mutableListOf<String>()
        if (item.metalCost > 0) out.add("Metal " + Money.grouped(item.metalCost))
        if (item.wastageCost > 0) out.add("Wastage (${grams(item.wastagePercentage)}%) ${Money.grouped(item.wastageCost)}")
        if (item.makingCharges > 0) out.add("Making " + Money.grouped(item.makingCharges))
        if (item.diamondChargesIfAny > 0) out.add("Diamonds " + Money.grouped(item.diamondChargesIfAny))
        if (item.stoneChargesIfAny > 0) out.add("Stones " + Money.grouped(item.stoneChargesIfAny))
        if (item.miscChargesIfAny > 0) out.add("Misc " + Money.grouped(item.miscChargesIfAny))
        return out
    }

    /** The rates the bill was priced at, for the gold karats it uses: "24k 33,700/g". */
    fun appliedRates(inv: Invoice): List<String> {
        val used = inv.items.filter { it.metalType == MetalType.gold }.mapNotNull { it.karat }.toSet()
        val r = inv.ratesApplied
        val out = mutableListOf<String>()
        fun add(k: KaratValue, v: Double?) { if (k in used && v != null && v > 0) out.add("${k.rawValue} ${Money.grouped(v)}/g") }
        add(KaratValue.k24, r.goldRatePerGram24k)
        add(KaratValue.k22, r.goldRatePerGram22k)
        add(KaratValue.k21, r.goldRatePerGram21k)
        add(KaratValue.k18, r.goldRatePerGram18k)
        return out
    }

    /** A refund (a row below zero, lib/writes/invoice-refund.ts) reads as one, quietly. */
    fun isRefund(p: Payment): Boolean = p.amount < 0

    /** The method (older records predate payment types and have none), or Refund. */
    fun paymentTitle(p: Payment): String {
        if (isRefund(p)) return if (InvoiceCredit.isPayback(p)) "Credit paid back" else "Refund"
        val method = p.method?.rawValue ?: ""
        return method.ifEmpty { "Payment" }
    }

    /** When, the reference, and a note that says more than the method does. */
    fun paymentDetail(p: Payment): String {
        val parts = mutableListOf<String>()
        val whenSaid = ShopDate.say(p.date, withTime = true)
        if (whenSaid.isNotEmpty()) parts.add(whenSaid)
        p.reference?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        var note = (p.notes ?: "").trim()
        if (note.isNotEmpty() && !note.startsWith("Payment received")) {
            if (InvoiceCredit.isPayback(p)) note = p.method?.rawValue ?: ""
            else if (isRefund(p) && note.startsWith("Refund")) note = note.removePrefix("Refund").trim { it == ':' || it == ' ' || it == '\t' }
            if (note.isNotEmpty()) parts.add(note)
        }
        return if (parts.isEmpty()) "—" else parts.joinToString(" · ")
    }

    /** Shopify's import, else the channel the customer came by. */
    fun sourceWords(inv: Invoice): String? {
        if (InvoiceFacts.isShopify(inv)) return "Shopify"
        return inv.acquisitionSource?.let { customerSourceLabel(it.rawValue) ?: it.rawValue }
    }

    // MARK: The margin (lib/margin.ts), for the shop

    /** Mina's silver is not costed that way: its web page shows no margin row at all. */
    fun showsMargin(settings: MarginSettings): Boolean = settings.rattiLess != null

    /** The margin as the counter reads it; the figure is not worked out until the row is tapped. */
    fun marginWords(m: Margin, settings: MarginSettings, percent: String): String {
        if (m.assumed) return "≈ $percent (no 24k rate given — assumed)"
        var s = "$percent · ${Money.pkr(m.profit)}"
        if (m.costedShare < 0.999) {
            val rest = Math.round((1 - m.costedShare) * 100).toInt()
            val assumed = Math.round(settings.assumedMargin * 100).toInt()
            s += " · $rest% of it at $assumed% (no weight)"
        }
        return s
    }
}
