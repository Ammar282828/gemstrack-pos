package erp.app.screens.neworder

import erp.core.entry.NewOrderScanAnswer
import erp.core.entry.NewOrderScanExchange
import erp.core.entry.NewOrderScanItem
import erp.core.entry.NewOrderSlip
import java.util.Locale

// What Read a slip says about a reading, as words (NewOrderScanScreen.swift): the lines under each piece, the
// exchange, and which parts of the foot are worth a section. Pure, so the JVM tests hold the wording.

object NewOrderScanLogic {
    /** Swift's `String(format: "%.3f", x)`. */
    private fun fixed3(x: Double): String = String.format(Locale.US, "%.3f", x)

    /** The facts under a piece, in the reader's order. */
    fun pieceBits(it: NewOrderScanItem, photoCount: Int): List<String> {
        val s = NewOrderSlip
        val written = s.num(it.lineTotal)
        val bits = ArrayList<String>()
        if (s.hasHisaab(it)) {
            bits.add("Hisaab on the slip")
        } else if (written > 0 && !s.hasWeight(it)) {
            bits.add("Figure only: a fixed price")
        }
        it.itemCategory?.takeIf { c -> c.isNotEmpty() }?.let { c -> bits.add(c) }
        it.metalType?.takeIf { m -> m.isNotEmpty() && m != "gold" }?.let { m -> bits.add(m) }
        it.karat?.let { k -> bits.add("${s.jsNumber(k)}k") }
        it.weightG?.let { w ->
            bits.add("${s.jsNumber(w)} g" + (if (it.weightWasTola == true) " (${fixed3(w / s.tolaG)} tola on the slip)" else ""))
        }
        if (s.num(it.ratePerGram) > 0) {
            bits.add("@ ${s.money(s.num(it.ratePerGram))}/g" + (if (it.rateWasPerTola == true) " (${s.money(s.num(it.ratePerGram) * s.tolaG)}/tola on the slip)" else ""))
        }
        s.wastagePercentOf(it)?.let { w ->
            bits.add("wastage ${s.jsNumber(w)}%" + (if (s.num(it.wastageG) > 0) " (${s.jsNumber(s.num(it.wastageG))} g)" else ""))
        }
        if (s.num(it.stoneWeightG) > 0) bits.add("less ${s.jsNumber(s.num(it.stoneWeightG))} g stone")
        if (s.num(it.makingCharges) > 0) bits.add("making ${s.money(s.num(it.makingCharges))}" + (if (it.makingWasPerGram == true) " (written per gram)" else ""))
        if (s.num(it.stoneCharges) > 0) bits.add("stones ${s.money(s.num(it.stoneCharges))}")
        it.size?.takeIf { z -> z.isNotEmpty() }?.let { z -> bits.add("Size $z") }
        it.photoIndex?.let { idx -> if (photoCount > 1) bits.add("photo ${s.jsNumber(idx)}") }
        return bits
    }

    fun exchangeWords(x: NewOrderScanExchange, from: NewOrderSlip.ExchangeFrom): String {
        val s = NewOrderSlip
        val parts = ArrayList<String>()
        x.description?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        if (s.num(x.karat) > 0) parts.add("${s.jsNumber(s.num(x.karat))}k")
        if (s.num(x.weightG) > 0) parts.add("${s.jsNumber(s.num(x.weightG))} g" + (if (x.weightWasTola == true) " (tola on the slip)" else ""))
        if (s.num(x.ratePerGram) > 0) parts.add("@ ${s.money(s.num(x.ratePerGram))}/g")
        if (from == NewOrderSlip.ExchangeFrom.computed) parts.add("weight × rate off the slip")
        return parts.joinToString(" · ")
    }

    /** Whether the foot of the slip has anything to say (any figure, a date, or notes). */
    fun hasFoot(a: NewOrderScanAnswer): Boolean =
        a.advancePayment != null || a.exchange != null || a.discount != null || a.subtotal != null ||
            a.balanceDue != null || !a.expectedDate.isNullOrEmpty() || !a.notes.isNullOrEmpty()

    fun piecesTitle(count: Int): String = if (count == 1) "1 piece" else "$count pieces"

    /** The line under the reading: a slip with rates and weights explains where its rate goes. */
    fun hasAnyHisaab(a: NewOrderScanAnswer): Boolean = a.items.any { NewOrderSlip.hasHisaab(it) }
}
