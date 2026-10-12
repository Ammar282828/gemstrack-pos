package erp.core.entry

import erp.core.logic.exchangesFromRows
import erp.core.logic.orderExchangeFields
import erp.core.models.Settings

// The order in progress as the ERP's own order form holds it, for Drafts (Firestore `drafts`,
// components/drafts/use-work-drafts.ts; decisions.md "Drafts": "every device in the shop sees the same list and a
// sale started on a phone is finished at the counter"). The form continues a draft with `form.reset(fields)` and
// `setDelivery(delivery)` (order-form.tsx), so this is `{ ...formValues, delivery }`. (NewOrderWebDraft.swift.)
//
// Each piece is the very item `createOrder` is sent (NewOrderMath.item) less the three figures the form works out
// for itself: the same shape the form takes back when an order is edited. The rates are the ones this order was
// quoted at, so the counter prices it as the phone did (the contract holds the two to the same total). Pure, so the
// contract cases build it through the code the screen runs.

/** The order form's values, and its delivery, for a draft in Drafts. */
fun NewOrderDraft.webValues(settings: Settings?): MutableMap<String, Any?> {
    val rates = NewOrderMath.formRates(this, settings)
    val o = LinkedHashMap<String, Any?>()
    o["items"] = pieces.map { p ->
        val item = NewOrderMath.item(p, rates, photo = true)
        for (k in listOf("metalCost", "wastageCost", "totalEstimate")) item.remove(k)
        item
    }
    o["goldRate18k"] = rates.goldRatePerGram18k
    o["goldRate21k"] = rates.goldRatePerGram21k
    o["goldRate22k"] = rates.goldRatePerGram22k
    o["goldRate24k"] = rates.goldRatePerGram24k
    o["palladiumRate18k"] = rates.palladiumRatePerGram18k
    o["palladiumRate12k"] = rates.palladiumRatePerGram12k
    o["hideRates"] = hideRates
    o["discountAmount"] = NewOrderFormat.finite(NewOrderFormat.num(discount))
    o["costRate24k"] = NewOrderFormat.finite(NewOrderMath.costRatePerGram(this))
    o["advancePayment"] = NewOrderFormat.finite(NewOrderFormat.num(advance))
    // The form's field is nullish: no method recorded is null, never "".
    o["advanceMethod"] = if (advanceMethod.isEmpty()) null else advanceMethod
    o["exchangeRows"] = exchanges.map { x ->
        linkedMapOf<String, Any?>(
            "id" to x.id, "description" to x.description, "karat" to x.karat, "weightG" to x.weightG,
            "ratePerGram" to x.ratePerGram, "value" to x.value, "valueTyped" to x.valueTyped,
        )
    }
    // The rows' totals, which the form keeps in step with them and reads for every total.
    val ex = orderExchangeFields(exchangesFromRows(exchanges.map { it.row }))
    o["advanceInExchangeDescription"] = ex.advanceInExchangeDescription
    o["advanceInExchangeValue"] = NewOrderFormat.finite(ex.advanceInExchangeValue)
    // A customer on file, or the form's walk-in value with a name or number typed for a new one.
    o["customerId"] = if (customerId.isEmpty()) "__WALK_IN__" else customerId
    o["customerName"] = customerName
    o["customerContact"] = customerPhone
    if (source.isNotEmpty()) o["source"] = source
    if (takenBy.isNotEmpty()) o["takenBy"] = takenBy
    o["promisedDate"] = promised
    if (NewOrderFormat.trim(notes).isNotEmpty()) o["notes"] = notes
    o["delivery"] = webDelivery()
    return o
}

/** DeliveryInfo as the form holds it: whether it is going out, and what has been typed. */
private fun NewOrderDraft.webDelivery(): Map<String, Any?> {
    val d = LinkedHashMap<String, Any?>()
    d["required"] = deliver
    d["address"] = deliveryAddress
    fun put(key: String, value: String) {
        if (NewOrderFormat.trim(value).isNotEmpty()) d[key] = value
    }
    put("city", deliveryCity)
    put("contactName", deliveryName)
    put("contactPhone", deliveryPhone)
    put("notes", deliveryNotes)
    put("expectedDate", deliveryExpected)
    val charge = NewOrderFormat.num(deliveryCharge)
    if (charge > 0) d["charge"] = charge
    return d
}
