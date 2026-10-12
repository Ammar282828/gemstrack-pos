package erp.core.entry

import erp.core.swiftTrimNewlines

// The sale in progress as the ERP's own sale page holds it, for Drafts (Firestore `drafts`,
// components/drafts/use-work-drafts.ts; decisions.md "Drafts"): `saleDraftValue` in sale-page.tsx, which
// `applySaleDraft` puts back on screen at the counter. The cart is each line exactly as `createInvoice` is sent it
// (SaleLine.payload, the web cart's product), without the tag's QR picture, which the sale takes from the live piece.
// The rate boxes typed in this sale go too, so the counter prices the sale at the rates the phone quoted (the
// contract holds the two to the same figures). Pure, so the contract cases build it through the code the screen runs.
// (SaleWebDraft.swift.)

/** The sale page's draft value. `subtotal` is the screen's (SaleFigures), for the card in Drafts. */
fun SaleDraft.webValues(subtotal: Double): MutableMap<String, Any?> {
    val o = LinkedHashMap<String, Any?>()
    val picked = !customerId.isNullOrEmpty()
    // A customer on file is picked by id. The name box holds the name either way, as the web's does once a customer is
    // picked (customer-autocomplete.tsx), so the counter sees who it is for.
    if (picked) o["selectedCustomerId"] = customerId
    o["walkInCustomerName"] = customerName
    o["walkInCustomerPhone"] = customerPhone
    o["discountAmountInput"] = if (discount.isEmpty()) "0" else discount
    o["exchangeRows"] = exchanges.map { x ->
        linkedMapOf<String, Any?>(
            "id" to x.id, "description" to x.description, "karat" to x.karat, "weightG" to x.weightG,
            "ratePerGram" to x.ratePerGram, "value" to x.value, "valueTyped" to x.valueTyped,
        )
    }
    o["internalNote"] = internalNote
    o["salePayments"] = payments.map { p ->
        linkedMapOf<String, Any?>("id" to p.id, "amount" to p.amount, "method" to p.method, "reference" to p.reference)
    }
    if (takenBy.isNotEmpty()) o["takenBy"] = takenBy
    o["hideRates"] = hideRates
    o["delivery"] = webDelivery()
    val tola = SaleNumber.value(costTola)
    o["costRate24k"] = if (tola > 0) tola / SALE_GRAMS_PER_TOLA else null
    o["cart"] = lines.map { it.payload() }
    o["subtotal"] = if (subtotal.isFinite()) subtotal else 0.0
    // The boxes typed in this sale, and that they were typed by hand (a new invoice writes those back to the shop's
    // rates): every other box follows today's rates, on the phone as at the counter.
    val typed = LinkedHashMap<String, String>()
    for ((key, value) in rates) {
        if (rateInputKey(key) != null && SaleNumber.value(value) > 0) typed[key] = value
    }
    o["rates"] = typed
    o["typedRates"] = typed.keys.sorted()
    return o
}

/** The sale page's DeliveryInfo: whether it is going out, and what has been typed. */
private fun SaleDraft.webDelivery(): Map<String, Any?> {
    val d = LinkedHashMap<String, Any?>()
    d["required"] = delivery.required
    d["address"] = delivery.address
    fun put(key: String, value: String) {
        if (swiftTrimNewlines(value).isNotEmpty()) d[key] = value
    }
    put("city", delivery.city)
    put("expectedDate", delivery.expectedDate)
    put("contactName", delivery.contactName)
    put("contactPhone", delivery.contactPhone)
    put("notes", delivery.notes)
    val v = SaleNumber.parse(delivery.charge)
    if (v != null && v > 0) d["charge"] = v
    return d
}
