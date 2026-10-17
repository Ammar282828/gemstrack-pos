import Foundation
import ERPCore

// A draft begun on the web or on another phone, continued in the phone's own form (Drafts' Continue; decisions.md
// "Drafts"). The draft holds the web form's values (`data`: order-form.tsx `{ ...formValues, delivery }`, sale-page.tsx
// `saleDraftValue`), the same shape the phone sends (NewOrderWebDraft, SaleWebDraft), so this is that read back: the
// pieces, the customer, the money typed and the delivery, as the counter's form puts them back on screen
// (`form.reset(fields)`, `applySaleDraft`). Nothing here works out a figure: the form prices what it is given, at the
// rates the draft was quoted at. Pure, so it reads a draft the way the screen does.

enum WorkDraftContinue {
    /// The form's walk-in value (order-form.tsx WALK_IN_CUSTOMER_VALUE): no customer on file.
    static let walkIn = "__WALK_IN__"

    /// The order form's six rate boxes, by the names the form keeps them under.
    private static let orderRates: [(String, RateKey)] = [
        ("goldRate24k", .goldRatePerGram24k), ("goldRate22k", .goldRatePerGram22k),
        ("goldRate21k", .goldRatePerGram21k), ("goldRate18k", .goldRatePerGram18k),
        ("palladiumRate18k", .palladiumRatePerGram18k), ("palladiumRate12k", .palladiumRatePerGram12k),
    ]

    // MARK: An order

    /// The order form's values as New order's draft. Each piece reads as a piece on file does (Edit order's
    /// `NewOrderPieceDraft(onFile:)`), its picture kept as the draft holds it. Today's rates fill any box the draft lacks.
    static func order(_ data: [String: Any], settings: Settings?) -> NewOrderDraft {
        var fields = data
        fields["exchanges"] = nil
        let stored = ERPDecode.model(Order.self, from: DocJSON.plain(fields) ?? [String: Any]())
        var d = stored.map { NewOrderEdit($0).draft } ?? NewOrderDraft.fresh()
        d.pieces = d.pieces.map { (p: NewOrderPieceDraft) -> NewOrderPieceDraft in
            var q = p
            if q.metal.isEmpty { q.metal = House.metal }
            return q
        }
        let id = text(data["customerId"])
        d.customerId = id == walkIn ? "" : id
        d.customerName = text(data["customerName"])
        d.promised = NewOrderEdit.day(text(data["promisedDate"]))
        // The form's method is nullish: none recorded is null.
        d.advanceMethod = text(data["advanceMethod"])
        var rates = settings.map { NewOrderMath.todaysRates($0) } ?? [:]
        for (field, key) in orderRates {
            let v = number(data[field])
            if v > 0 { rates[key.rawValue] = NewOrderFormat.boxText(v, digits: 2) }
        }
        d.rates = rates
        d.ratesSeeded = true
        let rows = exchangeRows(data["exchangeRows"]).map { NewOrderExchangeDraft($0) }
        if !rows.isEmpty { d.exchanges = rows }
        let delivery = data["delivery"] as? [String: Any] ?? [:]
        d.deliver = bool(delivery["required"])
        d.deliveryAddress = text(delivery["address"])
        d.deliveryCity = text(delivery["city"])
        d.deliveryName = text(delivery["contactName"])
        d.deliveryPhone = text(delivery["contactPhone"])
        d.deliveryNotes = text(delivery["notes"])
        d.deliveryCharge = NewOrderFormat.boxText(number(delivery["charge"]))
        d.deliveryExpected = text(delivery["expectedDate"])
        return d
    }

    // MARK: A sale

    /// The sale page's draft value as New sale's draft. A picked customer's name and number come from the book when the
    /// draft's boxes are empty (the web's box holds them once someone is picked).
    static func sale(_ data: [String: Any], customer: (String) -> Customer?) -> SaleDraft {
        var d = SaleDraft()
        let picked = text(data["selectedCustomerId"])
        let person = picked.isEmpty || picked == walkIn ? nil : customer(picked)
        d.customerId = picked.isEmpty || picked == walkIn ? nil : picked
        let name = text(data["walkInCustomerName"])
        let phone = text(data["walkInCustomerPhone"])
        d.customerName = name.isEmpty ? (person?.name ?? "") : name
        d.customerPhone = phone.isEmpty ? (person?.phone ?? "") : phone
        let discount = text(data["discountAmountInput"])
        d.discount = SaleNumber.value(discount) > 0 ? discount : ""
        let rows = exchangeRows(data["exchangeRows"]).map { SaleExchangeRow($0) }
        d.exchanges = rows.isEmpty ? [SaleExchangeRow.blank()] : rows
        let payments = (data["salePayments"] as? [Any] ?? []).compactMap { (raw: Any) -> SalePaymentRow? in
            guard let p = raw as? [String: Any] else { return nil }
            let id = text(p["id"])
            let amount = p["amount"] is String ? text(p["amount"]) : NewOrderFormat.boxText(number(p["amount"]))
            let method = text(p["method"])
            return SalePaymentRow(id: id.isEmpty ? newExchangeRowId() : id, amount: amount,
                                  method: method.isEmpty ? "Cash" : method, reference: text(p["reference"]))
        }
        d.payments = payments.isEmpty ? [SalePaymentRow()] : payments
        d.takenBy = text(data["takenBy"])
        d.hideRates = bool(data["hideRates"])
        d.internalNote = text(data["internalNote"])
        let perGram = number(data["costRate24k"])
        d.costTola = perGram > 0 ? String(Int((perGram * SALE_GRAMS_PER_TOLA).rounded())) : ""
        let delivery = data["delivery"] as? [String: Any] ?? [:]
        d.delivery.required = bool(delivery["required"])
        d.delivery.address = text(delivery["address"])
        d.delivery.city = text(delivery["city"])
        d.delivery.expectedDate = text(delivery["expectedDate"])
        d.delivery.contactName = text(delivery["contactName"])
        d.delivery.contactPhone = text(delivery["contactPhone"])
        d.delivery.notes = text(delivery["notes"])
        d.delivery.charge = NewOrderFormat.boxText(number(delivery["charge"]))
        // Each piece is the web cart's product: what prints on the bill under it is its `description`.
        d.lines = (data["cart"] as? [Any] ?? []).compactMap { (raw: Any) -> SaleLine? in
            guard var p = raw as? [String: Any], !text(p["sku"]).isEmpty else { return nil }
            p["billDescription"] = p["description"]
            p["description"] = nil
            p["qrCodeDataUrl"] = nil
            return ERPDecode.model(SaleLine.self, from: DocJSON.plain(p) ?? [String: Any]())
        }
        // The boxes held on this sale, as typed: every other box follows today's rates.
        var rates: [String: String] = [:]
        for (key, value) in data["rates"] as? [String: Any] ?? [:] where RateInputKey(rawValue: key) != nil {
            let typed = value is String ? text(value) : NewOrderFormat.boxText(number(value))
            if SaleNumber.value(typed) > 0 { rates[key] = typed }
        }
        d.rates = rates
        return d
    }

    // MARK: Reading the form's values

    private static func text(_ v: Any?) -> String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return ""
    }

    /// A number box: the form keeps some as numbers and some as text (`z.coerce.number`).
    private static func number(_ v: Any?) -> Double {
        if let s = v as? String { return NewOrderFormat.num(s) }
        if let n = v as? NSNumber { return NewOrderFormat.finite(n.doubleValue) }
        return 0
    }

    private static func bool(_ v: Any?) -> Bool { (v as? Bool) ?? false }

    /// The exchange rows as typed (components/shared/exchange-rows.tsx), a row missing a field taking the blank.
    private static func exchangeRows(_ v: Any?) -> [ExchangeRow] {
        (v as? [Any] ?? []).compactMap { (raw: Any) -> ExchangeRow? in
            guard let r = raw as? [String: Any] else { return nil }
            let id = text(r["id"])
            return ExchangeRow(id: id.isEmpty ? newExchangeRowId() : id, description: text(r["description"]),
                               karat: text(r["karat"]), weightG: text(r["weightG"]), ratePerGram: text(r["ratePerGram"]),
                               value: text(r["value"]), valueTyped: bool(r["valueTyped"]))
        }
    }
}
