import Foundation
import ERPCore

// Finalize & invoice (components/order/order-dialogs.tsx FinalizeOrderDialog), as the phone holds it: each
// piece's final figures as typed, starting from the order's own, priced by ERPCore's `finalizedItemCosts`
// at the rates the order was booked at, so what the screen shows is what the invoice will say
// (lib/writes/finalize-order.ts prices the same pieces the same way). Pure, so it compiles without UIKit.

/// One piece's final figures, as text while they are typed.
struct OrderFinalizeRow: Identifiable, Equatable {
    let index: Int
    var id: Int { index }
    let item: OrderItem
    /// A fixed price instead of weight × rate.
    var manual: Bool
    var price: String
    var weight: String
    /// The percentage (the grams are shown beside it).
    var wastage: String
    var making: String
    var stones: String
    var diamonds: String

    /// The dialog's opening figures: the order's own (a fixed price, else what the order estimated).
    init(_ item: OrderItem, index: Int) {
        self.index = index
        self.item = item
        manual = item.isManualPrice
        let onOrder = (item.manualPrice ?? 0) > 0 ? (item.manualPrice ?? 0) : (item.totalEstimate ?? 0)
        price = NewOrderFormat.boxText(onOrder)
        weight = NewOrderFormat.boxText(item.estimatedWeightG, digits: 3)
        wastage = NewOrderFormat.boxText(item.wastagePercentage, digits: 4)
        making = NewOrderFormat.boxText(item.makingCharges)
        stones = NewOrderFormat.boxText(item.stoneCharges)
        diamonds = NewOrderFormat.boxText(item.diamondCharges)
    }

    private func n(_ s: String) -> Double { NewOrderFormat.num(s) }

    /// What the order said this piece would come to.
    var onOrder: Double { item.isManualPrice ? (item.manualPrice ?? 0) : (item.totalEstimate ?? 0) }

    var finalized: FinalizedItem {
        FinalizedItem(
            description: item.description, metalType: item.metalType, karat: item.karat,
            finalWeightG: n(weight), finalWastagePercentage: n(wastage), finalMakingCharges: n(making),
            finalDiamondCharges: n(diamonds), finalStoneCharges: n(stones),
            isManualPrice: manual, finalManualPrice: n(price)
        )
    }

    /// The wastage's grams at this weight (the grams the karigar writes, and the invoice prints).
    var wastageGrams: Double { wastageGramsFor(n(wastage), n(weight), item.stoneWeightG) }

    /// The payload's piece, as the dialog sends it (`FinalizedItem`).
    var payload: [String: Any] {
        var o: [String: Any] = [
            "description": item.description, "metalType": item.metalType.rawValue,
            "finalWeightG": n(weight), "finalWastagePercentage": n(wastage), "finalMakingCharges": n(making),
            "finalDiamondCharges": n(diamonds), "finalStoneCharges": n(stones),
            "isManualPrice": manual, "finalManualPrice": n(price),
        ]
        if let k = item.karat?.rawValue, !k.isEmpty { o["karat"] = k }
        return o
    }
}

enum OrderFinalizeMath {
    struct Figures: Equatable {
        var prices: [Double] = []
        var subtotal = 0.0
        var discount = 0.0
        var exchange = 0.0
        var advances = 0.0
        /// What the invoice still asks for once the advances are counted as paid.
        var balance = 0.0
        /// The invoice's total (before the advances).
        var total: Double { subtotal - discount - exchange }
    }

    static func figures(_ order: Order, rows: [OrderFinalizeRow], discount: String, settings: Settings) -> Figures {
        let rates = orderInvoiceRates(order, settings)
        var f = Figures()
        f.prices = rows.map { r in finalizedItemCosts(r.item, r.finalized, rates).price }
        f.subtotal = f.prices.reduce(0, +)
        f.discount = NewOrderFormat.num(discount)
        f.exchange = exchangeTotal(orderExchanges(order))
        f.advances = orderAdvancePayments(order).reduce(0.0) { $0 + $1.amount }
        f.balance = f.subtotal - f.discount - f.exchange - f.advances
        return f
    }

    /// The dialog's checks (`finalizeOrderSchema`): a priced piece needs a weight; nothing negative.
    static func problem(_ rows: [OrderFinalizeRow], discount: String) -> String? {
        for r in rows {
            if !r.manual && NewOrderFormat.num(r.weight) <= 0 { return "Piece \(r.index + 1): weight must be a positive number." }
            if r.manual && NewOrderFormat.num(r.price) <= 0 { return "Piece \(r.index + 1): a fixed price needs the price." }
        }
        if NewOrderFormat.num(discount) < 0 { return "Discount cannot be negative." }
        return nil
    }

    /// What `ERPAPI.write("finalizeOrder", …)` takes. `costTola` is the 24k rate per tola, for the shop's margin.
    static func request(_ orderId: String, rows: [OrderFinalizeRow], discount: String, costTola: String) -> [String: Any] {
        var out: [String: Any] = [
            "orderId": orderId,
            "items": rows.map { $0.payload },
            "additionalDiscount": NewOrderFormat.num(discount),
        ]
        let tola = NewOrderFormat.num(costTola)
        if tola > 0 { out["costRate24k"] = tola / NewOrderWords.gramsPerTola }
        return out
    }
}
