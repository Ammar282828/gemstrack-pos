import Foundation
import ERPCore

// TODO(logic): port lib/analytics/coins.ts (splitCoinSales, splitAllCoinSales, summariseCoins) into
// ERPCore with coins.test.ts. It is here because it builds a copy of an Invoice, which ERPCore's
// models can only make by decoding; a port there can simply copy.

/// Gold coins are not jewellery, and Analytics keeps them apart: a coin sells within a point or two
/// of the metal price, a ring carries making and margin. Invoices are split once, before anything
/// counts them; the jewellery side feeds every figure, the coin side its own card.
///
/// A coin is almost always its own invoice, and then the whole document goes to one side. When a
/// coin and a ring share a bill the document's money (grand total, discount, what was paid, what
/// is owed) is divided in proportion to the line totals, as the web does.
enum AnaCoins {
    /// The category id of "Gold Coins" (lib/categories.ts).
    static let goldCoinCategory = "cat017"

    static func isCoin(_ item: InvoiceItem) -> Bool { item.categoryId == goldCoinCategory }

    struct Split {
        /// The invoice with its coins removed, or nil if it was nothing but coins.
        let jewellery: Invoice?
        /// The invoice reduced to its coins, or nil if it had none.
        let coins: Invoice?
    }

    /// What the coin card reports. Weight is what a coin buyer asks about first.
    struct Summary {
        let invoices: Int
        let coins: Double
        let grams: Double
        let revenue: Double
        /// Revenue over grams: what the shop actually realised per gram, all-in.
        let ratePerGram: Double
        let outstanding: Double
    }

    private static func total(_ items: [InvoiceItem]) -> Double {
        var sum = 0.0
        for i in items { sum += i.itemTotal.isFinite ? i.itemTotal : 0 }
        return sum
    }

    static func split(_ inv: Invoice) -> Split {
        let items = inv.items
        let coinItems = items.filter { isCoin($0) }
        if coinItems.isEmpty { return Split(jewellery: inv, coins: nil) }
        let jewelItems = items.filter { !isCoin($0) }
        if jewelItems.isEmpty { return Split(jewellery: nil, coins: inv) }
        let coinTotal = total(coinItems)
        let all = coinTotal + total(jewelItems)
        // Lines with no money on them cannot be apportioned by money; fall back to a headcount.
        let coinShare = all > 0 ? coinTotal / all : Double(coinItems.count) / Double(items.count)
        return Split(jewellery: side(inv, jewelItems, 1 - coinShare), coins: side(inv, coinItems, coinShare))
    }

    /// Every invoice split, in one pass, keeping order.
    static func splitAll(_ invoices: [Invoice]) -> (jewellery: [Invoice], coins: [Invoice]) {
        var jewellery: [Invoice] = []
        var coins: [Invoice] = []
        for inv in invoices {
            let s = split(inv)
            if let j = s.jewellery { jewellery.append(j) }
            if let c = s.coins { coins.append(c) }
        }
        return (jewellery: jewellery, coins: coins)
    }

    static func summarise(_ invoices: [Invoice]) -> Summary {
        var coins = 0.0
        var grams = 0.0
        var revenue = 0.0
        var outstanding = 0.0
        var bills = 0
        for inv in invoices where inv.status != .refunded {
            bills += 1
            revenue += invoiceSaleValue(inv)
            outstanding += max(0, inv.balanceDue)
            for it in inv.items {
                let q = it.quantity == 0 ? 1.0 : it.quantity
                coins += q
                grams += it.metalWeightG * q
            }
        }
        return Summary(invoices: bills, coins: coins, grams: grams, revenue: revenue,
                       ratePerGram: grams > 0 ? revenue / grams : 0, outstanding: outstanding)
    }

    // MARK: One side of a split invoice

    /// `Math.round(n * share * 100) / 100`.
    private static func scale(_ n: Double, _ share: Double) -> Double {
        let v = n.isFinite ? n : 0
        return (v * share * 100 + 0.5).rounded(.down) / 100
    }

    /// One side of a split invoice, with its money scaled to its share of the lines. The copy is the
    /// document as the ERP would read it back, so every ERPCore rule sees an ordinary Invoice.
    private static func side(_ inv: Invoice, _ items: [InvoiceItem], _ share: Double) -> Invoice {
        if share >= 1 { return inv }
        var doc: [String: Any] = [:]
        doc["customerName"] = inv.customerName
        doc["createdAt"] = inv.createdAt
        doc["subtotal"] = scale(inv.subtotal, share)
        doc["discountAmount"] = scale(inv.discountAmount, share)
        doc["grandTotal"] = scale(inv.grandTotal, share)
        doc["amountPaid"] = scale(inv.amountPaid, share)
        doc["balanceDue"] = scale(inv.balanceDue, share)
        doc["items"] = items.map { itemDoc($0) }
        doc["paymentHistory"] = inv.paymentHistory.map { paymentDoc($0, share) }
        doc["exchanges"] = inv.exchanges.map { exchangeDoc($0, share) }
        if let v = inv.customerId { doc["customerId"] = v }
        if let v = inv.sourceOrderId { doc["sourceOrderId"] = v }
        if let v = inv.status { doc["status"] = v.rawValue }
        if let v = inv.costRate24k { doc["costRate24k"] = v }
        if let v = inv.acquisitionSource { doc["acquisitionSource"] = v.rawValue }
        if let v = inv.exchangeDescription { doc["exchangeDescription"] = v }
        if let v = inv.exchangeAmount1 { doc["exchangeAmount1"] = scale(v, share) }
        if let v = inv.exchangeAmount2 { doc["exchangeAmount2"] = scale(v, share) }
        return DocJSON.decode(Invoice.self, id: inv.id, data: doc) ?? inv
    }

    /// The fields Analytics reads from a line (sale value, margin, weight, category).
    private static func itemDoc(_ it: InvoiceItem) -> [String: Any] {
        var d: [String: Any] = [:]
        d["sku"] = it.sku
        d["name"] = it.name
        d["categoryId"] = it.categoryId
        d["metalType"] = it.metalType.rawValue
        d["metalWeightG"] = it.metalWeightG
        d["stoneWeightG"] = it.stoneWeightG
        d["quantity"] = it.quantity
        d["itemTotal"] = it.itemTotal
        d["stoneChargesIfAny"] = it.stoneChargesIfAny
        d["diamondChargesIfAny"] = it.diamondChargesIfAny
        d["isCustomPrice"] = it.isCustomPrice
        d["isManualPrice"] = it.isManualPrice
        d["hasDiamonds"] = it.hasDiamonds
        d["hasStones"] = it.hasStones
        if let v = it.karat { d["karat"] = v.rawValue }
        if let v = it.stoneDetails { d["stoneDetails"] = v }
        if let v = it.diamondDetails { d["diamondDetails"] = v }
        return d
    }

    private static func paymentDoc(_ p: Payment, _ share: Double) -> [String: Any] {
        var d: [String: Any] = [:]
        d["amount"] = scale(p.amount, share)
        d["date"] = p.date
        if let v = p.notes { d["notes"] = v }
        if let v = p.method { d["method"] = v.rawValue }
        if let v = p.reference { d["reference"] = v }
        return d
    }

    private static func exchangeDoc(_ e: ExchangeEntry, _ share: Double) -> [String: Any] {
        var d: [String: Any] = [:]
        d["description"] = e.description
        d["value"] = scale(e.value, share)
        if let v = e.karat { d["karat"] = v }
        if let v = e.weightG { d["weightG"] = v }
        if let v = e.ratePerGram { d["ratePerGram"] = v }
        return d
    }
}
