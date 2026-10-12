package erp.core.entry

import erp.core.logic.RateKey
import erp.core.logic.WALK_IN_NAME
import erp.core.logic.gramsPerTola
import erp.core.logic.isWalkInName
import erp.core.logic.karatsFor
import erp.core.logic.orderExchanges
import erp.core.logic.rowsFromExchanges
import erp.core.models.Customer
import erp.core.models.OrderItem
import erp.core.models.Order
import erp.core.models.Rates
import erp.core.models.Settings
import erp.core.swiftRounded
import java.util.UUID

// Edit order (src/app/orders/[id]/edit, the same order-form.tsx as New order): the order on file opened in New
// order's own form, and saved as the form's "Save Changes" saves it (`updateOrder`, lib/writes/update-order.ts).
// Pure, so the contract cases run it. (NewOrderEdit.swift.)
//
// What the form does not show stays as it is on file: each piece is sent with the index it had, and the ERP lays
// the form's fields over that stored piece, preserving workshop handover facts. The order keeps the rates it was
// quoted at; more advance than before is money taken today (the ERP lists it).

/** An order opened for editing: which order, and which stored piece each piece on screen began as. */
class NewOrderEdit(o: Order) {
    val orderId: String = o.id
    val draft: NewOrderDraft

    /** A piece on screen → its index in the order on file. A piece added while editing has none. */
    val origin: Map<UUID, Int>

    /** Invoiced already: the invoice keeps its own copy of the pieces, so a change here does not reach it. */
    val invoiced: Boolean = !(o.invoiceId ?: "").isEmpty()

    init {
        val d = NewOrderDraft()
        val origin = LinkedHashMap<UUID, Int>()
        val named = NewOrderFormat.trim(o.customerName ?: "")
        val id = o.customerId ?: ""
        d.customerId = id
        // The placeholder name is no one's: the box starts empty, as a walk-in's does.
        d.customerName = if (isWalkInName(named) && id.isEmpty()) "" else named
        d.customerPhone = o.customerContact ?: ""
        d.source = o.source?.rawValue ?: ""
        d.takenBy = o.takenBy ?: ""
        d.promised = day(o.promisedDate)
        d.notes = o.notes ?: ""
        d.hideRates = o.hideRates
        d.pieces = o.items.mapIndexed { i, item ->
            val p = NewOrderPieceDraft.onFile(item)
            origin[p.id] = i
            p
        }.toMutableList()
        d.rates = LinkedHashMap(rates(o.ratesApplied))
        d.ratesSeeded = true
        d.discount = NewOrderFormat.boxText(o.discountAmount ?: 0.0)
        d.advance = NewOrderFormat.boxText(o.advancePayment)
        d.advanceMethod = o.advanceMethod?.rawValue ?: "Cash"
        val rows = rowsFromExchanges(orderExchanges(o)).map { NewOrderExchangeDraft(it) }
        d.exchanges = if (rows.isEmpty()) mutableListOf(NewOrderExchangeDraft.blank()) else rows.toMutableList()
        val del = o.delivery
        if (del != null && del.required && NewOrderFormat.trim(del.address).isNotEmpty()) {
            d.deliver = true
            d.deliveryAddress = del.address
            d.deliveryCity = del.city ?: ""
            d.deliveryName = del.contactName ?: ""
            d.deliveryPhone = del.contactPhone ?: ""
            d.deliveryNotes = del.notes ?: ""
            d.deliveryCharge = NewOrderFormat.boxText(del.charge ?: 0.0)
            d.deliveryExpected = del.expectedDate ?: ""
        }
        val perGram = o.costRate24k ?: 0.0
        d.costTola = if (perGram > 0) swiftRounded(perGram * NewOrderWords.gramsPerTola).toLong().toString() else ""
        draft = d
        this.origin = origin
    }

    companion object {
        /** The promised day as the form's box holds it: "yyyy-MM-dd", or "" for none. */
        fun day(stored: String?): String {
            val s = NewOrderFormat.trim(stored ?: "")
            if (s.length < 10) return ""
            val head = s.take(10)
            val parts = head.split("-").filter { it.isNotEmpty() }
            // Swift's `Int($0) != nil`: an optional sign and digits only.
            if (parts.size != 3 || parts[0].length != 4 || !parts.all { isInt(it) }) return ""
            return head
        }

        private fun isInt(s: String): Boolean {
            val body = if (s.startsWith("+") || s.startsWith("-")) s.drop(1) else s
            return body.isNotEmpty() && body.all { it in '0'..'9' }
        }

        /** The rate card the order was priced at, in the form's boxes (a rate the order lacks is left blank). */
        fun rates(r: Rates): Map<String, String> {
            val all: List<Pair<RateKey, Double?>> = listOf(
                RateKey.goldRatePerGram24k to r.goldRatePerGram24k, RateKey.goldRatePerGram22k to r.goldRatePerGram22k,
                RateKey.goldRatePerGram21k to r.goldRatePerGram21k, RateKey.goldRatePerGram18k to r.goldRatePerGram18k,
                RateKey.palladiumRatePerGram to r.palladiumRatePerGram, RateKey.palladiumRatePerGram18k to r.palladiumRatePerGram18k,
                RateKey.palladiumRatePerGram12k to r.palladiumRatePerGram12k, RateKey.platinumRatePerGram to r.platinumRatePerGram,
                RateKey.silverRatePerGram to r.silverRatePerGram,
            )
            val out = LinkedHashMap<String, String>()
            for ((key, value) in all) out[key.name] = NewOrderFormat.boxText(value ?: 0.0, digits = 2)
            return out
        }
    }
}

/** A stored piece in the form's boxes. Its sample photo stays on file (only a new one is sent). */
fun NewOrderPieceDraft.Companion.onFile(item: OrderItem): NewOrderPieceDraft {
    val p = NewOrderPieceDraft()
    p.category = item.itemCategory ?: ""
    p.description = item.description
    p.metal = item.metalType.rawValue
    val karats = karatsFor(item.metalType).map { it.rawValue }
    val kept = item.karat?.rawValue ?: ""
    p.karat = if (karats.isEmpty()) kept else (if (karats.contains(kept)) kept else (if (karats.contains("21k")) "21k" else (karats.lastOrNull() ?: "")))
    p.weight = NewOrderFormat.boxText(item.estimatedWeightG, digits = 3)
    p.hasStones = item.hasStones
    p.stoneWeight = NewOrderFormat.boxText(item.stoneWeightG, digits = 3)
    p.stoneDetails = item.stoneDetails ?: ""
    p.hasDiamonds = item.hasDiamonds
    p.diamond = NewOrderFormat.boxText(item.diamondCharges)
    p.diamondDetails = item.diamondDetails ?: ""
    p.wastage = NewOrderFormat.boxText(item.wastagePercentage, digits = 4)
    p.making = NewOrderFormat.boxText(item.makingCharges)
    p.stones = NewOrderFormat.boxText(item.stoneCharges)
    p.size = item.size ?: ""
    p.platingType = item.platingType ?: ""
    p.platingNote = item.platingNote ?: ""
    p.nickelFree = item.nickelFree
    p.karigarId = item.karigarId ?: ""
    p.referenceSku = item.referenceSku ?: ""
    p.sampleGiven = item.sampleGiven
    p.isCompleted = item.isCompleted
    p.samplePhotoId = item.samplePhotoId
    p.sampleImageDataUri = item.sampleImageDataUri
    p.manual = item.isManualPrice
    p.manualPrice = if (item.isManualPrice) NewOrderFormat.boxText(item.manualPrice ?: 0.0) else ""
    p.adminNote = item.adminNote ?: ""
    return p
}

/**
 * What Edit order hands `ErpApi.write("updateOrder", …)`: `{ orderId, order }`, the order as the form's edit path
 * builds it. Unlike a new order, a name typed without picking someone is only a name (the ERP makes no customer on an
 * edit), and a field emptied is cleared on file (null), not left as it was.
 */
fun NewOrderMath.editRequest(d: NewOrderDraft, edit: NewOrderEdit, settings: Settings, customers: List<Customer>): MutableMap<String, Any?> {
    val o = order(d, settings, customers)
    val rates = formRates(d, settings)
    o["items"] = d.pieces.map { p ->
        // Keep the stored photo unless the counter replaces or removes it.
        val item = item(p, rates, photo = true)
        // A karigar taken off in the form is taken off on file too.
        if (NewOrderFormat.trim(p.karigarId).isEmpty()) item["karigarId"] = null
        item["editIndex"] = edit.origin[p.id] ?: -1
        item
    }
    if (!o.containsKey("customerId")) o["customerId"] = null
    if (NewOrderFormat.trim((o["customerName"] as? String) ?: "").isEmpty()) o["customerName"] = WALK_IN_NAME
    if (!o.containsKey("customerContact")) o["customerContact"] = ""
    o["hideRates"] = d.hideRates
    if (!o.containsKey("advanceMethod")) o["advanceMethod"] = null
    if (!o.containsKey("costRate24k")) o["costRate24k"] = null
    if (!o.containsKey("delivery")) o["delivery"] = null
    if (!o.containsKey("promisedDate")) o["promisedDate"] = null
    if (!o.containsKey("notes")) o["notes"] = ""
    return linkedMapOf("orderId" to edit.orderId, "order" to o)
}
