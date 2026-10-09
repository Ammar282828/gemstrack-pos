import Foundation
import ERPCore

// The order in progress as the ERP's own order form holds it, for Drafts (Firestore `drafts`,
// components/drafts/use-work-drafts.ts; decisions.md "Drafts": "every device in the shop sees the same list
// and a sale started on a phone is finished at the counter"). The form continues a draft with
// `form.reset(fields)` and `setDelivery(delivery)` (order-form.tsx), so this is `{ ...formValues, delivery }`.
//
// Each piece is the very item `createOrder` is sent (NewOrderMath.item) less the three figures the form works
// out for itself: the same shape the form takes back when an order is edited. The rates are the ones this order
// was quoted at, so the counter prices it as the phone did (apps/iphone/contract holds the two to the same
// total). Pure, so the contract cases build it through the code the screen runs.

extension NewOrderDraft {
    /// The order form's values, and its delivery, for a draft in Drafts.
    func webValues(settings: Settings?) -> [String: Any] {
        let rates = NewOrderMath.formRates(self, settings)
        var o: [String: Any] = [:]
        o["items"] = pieces.map { p -> [String: Any] in
            var item = NewOrderMath.item(p, rates: rates, photo: true)
            for k in ["metalCost", "wastageCost", "totalEstimate"] { item[k] = nil }
            return item
        }
        o["goldRate18k"] = rates.goldRatePerGram18k
        o["goldRate21k"] = rates.goldRatePerGram21k
        o["goldRate22k"] = rates.goldRatePerGram22k
        o["goldRate24k"] = rates.goldRatePerGram24k
        o["palladiumRate18k"] = rates.palladiumRatePerGram18k
        o["palladiumRate12k"] = rates.palladiumRatePerGram12k
        o["hideRates"] = hideRates
        o["discountAmount"] = NewOrderFormat.finite(NewOrderFormat.num(discount))
        o["costRate24k"] = NewOrderFormat.finite(NewOrderMath.costRatePerGram(self))
        o["advancePayment"] = NewOrderFormat.finite(NewOrderFormat.num(advance))
        // The form's field is nullish: no method recorded is null, never "".
        o["advanceMethod"] = advanceMethod.isEmpty ? NSNull() : advanceMethod as Any
        o["exchangeRows"] = exchanges.map { x -> [String: Any] in
            ["id": x.id, "description": x.description, "karat": x.karat, "weightG": x.weightG,
             "ratePerGram": x.ratePerGram, "value": x.value, "valueTyped": x.valueTyped]
        }
        // The rows' totals, which the form keeps in step with them and reads for every total.
        let ex = orderExchangeFields(exchangesFromRows(exchanges.map { $0.row }))
        o["advanceInExchangeDescription"] = ex.advanceInExchangeDescription
        o["advanceInExchangeValue"] = NewOrderFormat.finite(ex.advanceInExchangeValue)
        // A customer on file, or the form's walk-in value with a name or number typed for a new one.
        o["customerId"] = customerId.isEmpty ? "__WALK_IN__" : customerId
        o["customerName"] = customerName
        o["customerContact"] = customerPhone
        if !source.isEmpty { o["source"] = source }
        if !takenBy.isEmpty { o["takenBy"] = takenBy }
        o["promisedDate"] = promised
        if !NewOrderFormat.trim(notes).isEmpty { o["notes"] = notes }
        o["delivery"] = webDelivery
        return o
    }

    /// DeliveryInfo as the form holds it: whether it is going out, and what has been typed.
    private var webDelivery: [String: Any] {
        var d: [String: Any] = ["required": deliver, "address": deliveryAddress]
        func put(_ key: String, _ value: String) {
            if !NewOrderFormat.trim(value).isEmpty { d[key] = value }
        }
        put("city", deliveryCity)
        put("contactName", deliveryName)
        put("contactPhone", deliveryPhone)
        put("notes", deliveryNotes)
        put("expectedDate", deliveryExpected)
        let charge = NewOrderFormat.num(deliveryCharge)
        if charge > 0 { d["charge"] = charge }
        return d
    }
}
