import Foundation
import ERPCore

// The sale in progress as the ERP's own sale page holds it, for Drafts (Firestore `drafts`,
// components/drafts/use-work-drafts.ts; decisions.md "Drafts"): `saleDraftValue` in sale-page.tsx, which
// `applySaleDraft` puts back on screen at the counter. The cart is each line exactly as `createInvoice` is sent
// it (SaleLine.payload, the web cart's product), without the tag's QR picture, which the sale takes from the live
// piece. The rate boxes typed in this sale go too, so the counter prices the sale at the rates the phone quoted
// (apps/iphone/contract holds the two to the same figures). Pure, so the contract cases build it through the
// code the screen runs.

extension SaleDraft {
    /// The sale page's draft value. `subtotal` is the screen's (SaleFigures), for the card in Drafts.
    func webValues(subtotal: Double) -> [String: Any] {
        var o: [String: Any] = [:]
        let picked = !(customerId ?? "").isEmpty
        // A customer on file is picked by id; a name or number typed for someone new is the walk-in fields.
        if picked { o["selectedCustomerId"] = customerId }
        o["walkInCustomerName"] = picked ? "" : customerName
        o["walkInCustomerPhone"] = picked ? "" : customerPhone
        o["discountAmountInput"] = discount.isEmpty ? "0" : discount
        o["exchangeRows"] = exchanges.map { x -> [String: Any] in
            ["id": x.id, "description": x.description, "karat": x.karat, "weightG": x.weightG,
             "ratePerGram": x.ratePerGram, "value": x.value, "valueTyped": x.valueTyped]
        }
        o["internalNote"] = internalNote
        o["salePayments"] = payments.map { p -> [String: Any] in
            ["id": p.id, "amount": p.amount, "method": p.method, "reference": p.reference]
        }
        if !takenBy.isEmpty { o["takenBy"] = takenBy }
        o["hideRates"] = hideRates
        o["delivery"] = webDelivery
        let tola = SaleNumber.value(costTola)
        o["costRate24k"] = tola > 0 ? tola / SALE_GRAMS_PER_TOLA : NSNull()
        o["cart"] = lines.map { $0.payload() }
        o["subtotal"] = subtotal.isFinite ? subtotal : 0
        // The boxes typed in this sale, and that they were typed by hand (a new invoice writes those back to the
        // shop's rates): every other box follows today's rates, on the phone as at the counter.
        var typed: [String: String] = [:]
        for (key, value) in rates where RateInputKey(rawValue: key) != nil && SaleNumber.value(value) > 0 {
            typed[key] = value
        }
        o["rates"] = typed
        o["typedRates"] = typed.keys.sorted()
        return o
    }

    /// The sale page's DeliveryInfo: whether it is going out, and what has been typed.
    private var webDelivery: [String: Any] {
        var d: [String: Any] = ["required": delivery.required, "address": delivery.address]
        func put(_ key: String, _ value: String) {
            if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { d[key] = value }
        }
        put("city", delivery.city)
        put("expectedDate", delivery.expectedDate)
        put("contactName", delivery.contactName)
        put("contactPhone", delivery.contactPhone)
        put("notes", delivery.notes)
        if let v = SaleNumber.parse(delivery.charge), v > 0 { d["charge"] = v }
        return d
    }
}
