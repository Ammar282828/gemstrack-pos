import Foundation
import ERPCore

// Edit order (src/app/orders/[id]/edit, the same order-form.tsx as New order): the order on file opened in
// New order's own form, and saved as the form's "Save Changes" saves it (`updateOrder`,
// lib/writes/update-order.ts). Pure, so the contract cases (apps/iphone/Packages/Contract) run it.
//
// What the form does not show stays as it is on file: each piece is sent with the index it had, and the
// ERP lays the form's fields over that stored piece, preserving workshop handover facts. The
// order keeps the rates it was quoted at; more advance than before is money taken today (the ERP lists it).

/// An order opened for editing: which order, and which stored piece each piece on screen began as.
struct NewOrderEdit: Equatable {
    let orderId: String
    let draft: NewOrderDraft
    /// A piece on screen → its index in the order on file. A piece added while editing has none.
    let origin: [UUID: Int]
    /// Invoiced already: the invoice keeps its own copy of the pieces, so a change here does not reach it.
    let invoiced: Bool

    init(_ o: Order) {
        orderId = o.id
        invoiced = !(o.invoiceId ?? "").isEmpty
        var d = NewOrderDraft()
        var origin: [UUID: Int] = [:]
        let named = NewOrderFormat.trim(o.customerName ?? "")
        let id = o.customerId ?? ""
        d.customerId = id
        // The placeholder name is no one's: the box starts empty, as a walk-in's does.
        d.customerName = isWalkInName(named) && id.isEmpty ? "" : named
        d.customerPhone = o.customerContact ?? ""
        d.source = o.source?.rawValue ?? ""
        d.takenBy = o.takenBy ?? ""
        d.promised = NewOrderEdit.day(o.promisedDate)
        d.notes = o.notes ?? ""
        d.hideRates = o.hideRates
        d.pieces = o.items.enumerated().map { (i, item) in
            let p = NewOrderPieceDraft(onFile: item)
            origin[p.id] = i
            return p
        }
        d.rates = NewOrderEdit.rates(o.ratesApplied)
        d.ratesSeeded = true
        d.discount = NewOrderFormat.boxText(o.discountAmount ?? 0)
        d.advance = NewOrderFormat.boxText(o.advancePayment)
        d.advanceMethod = o.advanceMethod?.rawValue ?? "Cash"
        let rows = rowsFromExchanges(orderExchanges(o)).map { NewOrderExchangeDraft($0) }
        d.exchanges = rows.isEmpty ? [.blank()] : rows
        if let del = o.delivery, del.required, !NewOrderFormat.trim(del.address).isEmpty {
            d.deliver = true
            d.deliveryAddress = del.address
            d.deliveryCity = del.city ?? ""
            d.deliveryName = del.contactName ?? ""
            d.deliveryPhone = del.contactPhone ?? ""
            d.deliveryNotes = del.notes ?? ""
            d.deliveryCharge = NewOrderFormat.boxText(del.charge ?? 0)
            d.deliveryExpected = del.expectedDate ?? ""
        }
        let perGram = o.costRate24k ?? 0
        d.costTola = perGram > 0 ? String(Int((perGram * NewOrderWords.gramsPerTola).rounded())) : ""
        draft = d
        self.origin = origin
    }

    /// The promised day as the form's box holds it: "yyyy-MM-dd", or "" for none.
    static func day(_ stored: String?) -> String {
        let s = NewOrderFormat.trim(stored ?? "")
        guard s.count >= 10 else { return "" }
        let head = String(s.prefix(10))
        let parts = head.split(separator: "-")
        guard parts.count == 3, parts[0].count == 4, parts.allSatisfy({ Int($0) != nil }) else { return "" }
        return head
    }

    /// The rate card the order was priced at, in the form's boxes (a rate the order lacks is left blank).
    static func rates(_ r: Rates) -> [String: String] {
        let all: [(RateKey, Double?)] = [
            (.goldRatePerGram24k, r.goldRatePerGram24k), (.goldRatePerGram22k, r.goldRatePerGram22k),
            (.goldRatePerGram21k, r.goldRatePerGram21k), (.goldRatePerGram18k, r.goldRatePerGram18k),
            (.palladiumRatePerGram, r.palladiumRatePerGram), (.palladiumRatePerGram18k, r.palladiumRatePerGram18k),
            (.palladiumRatePerGram12k, r.palladiumRatePerGram12k), (.platinumRatePerGram, r.platinumRatePerGram),
            (.silverRatePerGram, r.silverRatePerGram),
        ]
        var out: [String: String] = [:]
        for (key, value) in all { out[key.rawValue] = NewOrderFormat.boxText(value ?? 0, digits: 2) }
        return out
    }
}

extension NewOrderPieceDraft {
    /// A stored piece in the form's boxes. Its sample photo stays on file (only a new one is sent).
    init(onFile item: OrderItem) {
        self.init()
        category = item.itemCategory ?? ""
        description = item.description
        metal = item.metalType.rawValue
        let karats = karatsFor(item.metalType).map { $0.rawValue }
        let kept = item.karat?.rawValue ?? ""
        karat = karats.isEmpty ? kept : (karats.contains(kept) ? kept : (karats.contains("21k") ? "21k" : (karats.last ?? "")))
        weight = NewOrderFormat.boxText(item.estimatedWeightG, digits: 3)
        hasStones = item.hasStones
        stoneWeight = NewOrderFormat.boxText(item.stoneWeightG, digits: 3)
        stoneDetails = item.stoneDetails ?? ""
        hasDiamonds = item.hasDiamonds
        diamond = NewOrderFormat.boxText(item.diamondCharges)
        diamondDetails = item.diamondDetails ?? ""
        wastage = NewOrderFormat.boxText(item.wastagePercentage, digits: 4)
        making = NewOrderFormat.boxText(item.makingCharges)
        stones = NewOrderFormat.boxText(item.stoneCharges)
        size = item.size ?? ""
        platingType = item.platingType ?? ""
        platingNote = item.platingNote ?? ""
        nickelFree = item.nickelFree
        karigarId = item.karigarId ?? ""
        referenceSku = item.referenceSku ?? ""
        sampleGiven = item.sampleGiven
        isCompleted = item.isCompleted
        samplePhotoId = item.samplePhotoId
        sampleImageDataUri = item.sampleImageDataUri
        manual = item.isManualPrice
        manualPrice = item.isManualPrice ? NewOrderFormat.boxText(item.manualPrice ?? 0) : ""
        adminNote = item.adminNote ?? ""
    }
}

extension NewOrderMath {
    /// What Edit order hands `ERPAPI.write("updateOrder", …)`: `{ orderId, order }`, the order as the form's
    /// edit path builds it. Unlike a new order, a name typed without picking someone is only a name (the ERP
    /// makes no customer on an edit), and a field emptied is cleared on file (null), not left as it was.
    static func editRequest(_ d: NewOrderDraft, edit: NewOrderEdit, settings: Settings, customers: [Customer]) -> [String: Any] {
        var o = order(d, settings: settings, customers: customers)
        let rates = formRates(d, settings)
        o["items"] = d.pieces.map { p -> [String: Any] in
            // Keep the stored photo unless the counter replaces or removes it.
            var item = self.item(p, rates: rates, photo: true)
            // A karigar taken off in the form is taken off on file too.
            if NewOrderFormat.trim(p.karigarId).isEmpty { item["karigarId"] = NSNull() }
            item["editIndex"] = edit.origin[p.id] ?? -1
            return item
        }
        if o["customerId"] == nil { o["customerId"] = NSNull() }
        if NewOrderFormat.trim((o["customerName"] as? String) ?? "").isEmpty { o["customerName"] = WALK_IN_NAME }
        if o["customerContact"] == nil { o["customerContact"] = "" }
        o["hideRates"] = d.hideRates
        if o["advanceMethod"] == nil { o["advanceMethod"] = NSNull() }
        if o["costRate24k"] == nil { o["costRate24k"] = NSNull() }
        if o["delivery"] == nil { o["delivery"] = NSNull() }
        if o["promisedDate"] == nil { o["promisedDate"] = NSNull() }
        if o["notes"] == nil { o["notes"] = "" }
        return ["orderId": edit.orderId, "order": o]
    }
}
