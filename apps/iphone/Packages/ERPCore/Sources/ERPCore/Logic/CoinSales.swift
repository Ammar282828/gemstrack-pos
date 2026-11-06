// Ported from src/lib/analytics/coins.ts (splitCoinSales, splitAllCoinSales, summariseCoins).
//
// Gold coins are not jewellery, and Analytics keeps them apart: a coin sells within a point or two of the
// metal price, a ring carries making and margin. Invoices are split once, before anything counts them; the
// jewellery side feeds every figure, the coin side its own card. A coin is almost always its own invoice and
// then the whole document goes to one side; when a coin and a ring share a bill the document's money (grand
// total, discount, paid, owed) is divided in proportion to the line totals.
//
// The app's Analytics screens had a page-local copy (AnaCoins); this is the one Books reads.

import Foundation

/// A line of the "Gold Coins" category (id cat017, lib/categories.ts).
public func isCoinItem(_ item: InvoiceItem) -> Bool { item.categoryId == "cat017" }

public struct CoinSplit {
    /// The invoice with its coins removed, or nil if it was nothing but coins.
    public let jewellery: Invoice?
    /// The invoice reduced to its coins, or nil if it had none.
    public let coins: Invoice?
}

/// What the coin section reports. Weight is what a coin buyer asks about first.
public struct CoinSummary: Equatable {
    public let invoices: Int
    public let coins: Double
    public let grams: Double
    public let revenue: Double
    /// Revenue over grams: what the shop actually realised per gram, all-in.
    public let ratePerGram: Double
    public let outstanding: Double
}

private func itemsTotal(_ items: [InvoiceItem]) -> Double {
    items.reduce(0) { $0 + ($1.itemTotal.isFinite ? $1.itemTotal : 0) }
}

public func splitCoinSales(_ inv: Invoice) -> CoinSplit {
    let items = inv.items
    let coinItems = items.filter { isCoinItem($0) }
    if coinItems.isEmpty { return CoinSplit(jewellery: inv, coins: nil) }
    let jewelItems = items.filter { !isCoinItem($0) }
    if jewelItems.isEmpty { return CoinSplit(jewellery: nil, coins: inv) }
    let coinTotal = itemsTotal(coinItems)
    let all = coinTotal + itemsTotal(jewelItems)
    // Lines with no money on them cannot be apportioned by money; fall back to a headcount.
    let coinShare = all > 0 ? coinTotal / all : Double(coinItems.count) / Double(items.count)
    return CoinSplit(jewellery: coinSide(inv, jewelItems, 1 - coinShare), coins: coinSide(inv, coinItems, coinShare))
}

/// Every invoice split, in one pass, keeping order.
public func splitAllCoinSales(_ invoices: [Invoice]) -> (jewellery: [Invoice], coins: [Invoice]) {
    var jewellery: [Invoice] = []
    var coins: [Invoice] = []
    for inv in invoices {
        let s = splitCoinSales(inv)
        if let j = s.jewellery { jewellery.append(j) }
        if let c = s.coins { coins.append(c) }
    }
    return (jewellery, coins)
}

public func summariseCoins(_ coinInvoices: [Invoice]) -> CoinSummary {
    var coins = 0.0, grams = 0.0, revenue = 0.0, outstanding = 0.0
    var bills = 0
    for inv in coinInvoices where inv.status != .refunded {
        bills += 1
        revenue += invoiceSaleValue(inv)
        outstanding += max(0, inv.balanceDue.isNaN ? 0 : inv.balanceDue)
        for it in inv.items {
            let q = it.quantity == 0 || it.quantity.isNaN ? 1.0 : it.quantity
            coins += q
            grams += (it.metalWeightG.isNaN ? 0 : it.metalWeightG) * q
        }
    }
    return CoinSummary(invoices: bills, coins: coins, grams: grams, revenue: revenue,
                       ratePerGram: grams > 0 ? revenue / grams : 0, outstanding: outstanding)
}

// MARK: One side of a split invoice

/// `Math.round(n * share * 100) / 100`.
private func scaled(_ n: Double, _ share: Double) -> Double {
    JS.round((n.isFinite ? n : 0) * share * 100) / 100
}

/// One side of a split invoice, with its money scaled to its share of the lines. The copy is the document as
/// the ERP would read it back, so every rule sees an ordinary Invoice.
private func coinSide(_ inv: Invoice, _ items: [InvoiceItem], _ share: Double) -> Invoice {
    if share >= 1 { return inv }
    var doc: [String: Any] = [:]
    doc["customerName"] = inv.customerName
    doc["createdAt"] = inv.createdAt
    doc["subtotal"] = scaled(inv.subtotal, share)
    doc["discountAmount"] = scaled(inv.discountAmount, share)
    doc["grandTotal"] = scaled(inv.grandTotal, share)
    doc["amountPaid"] = scaled(inv.amountPaid, share)
    doc["balanceDue"] = scaled(inv.balanceDue, share)
    doc["items"] = items.map { coinItemDoc($0) }
    doc["paymentHistory"] = inv.paymentHistory.map { coinPaymentDoc($0, share) }
    doc["exchanges"] = inv.exchanges.map { coinExchangeDoc($0, share) }
    if let v = inv.customerId { doc["customerId"] = v }
    if let v = inv.sourceOrderId { doc["sourceOrderId"] = v }
    if let v = inv.status { doc["status"] = v.rawValue }
    if let v = inv.costRate24k { doc["costRate24k"] = v }
    if let v = inv.acquisitionSource { doc["acquisitionSource"] = v.rawValue }
    if let v = inv.exchangeDescription { doc["exchangeDescription"] = v }
    if let v = inv.exchangeAmount1 { doc["exchangeAmount1"] = scaled(v, share) }
    if let v = inv.exchangeAmount2 { doc["exchangeAmount2"] = scaled(v, share) }
    return DocJSON.decode(Invoice.self, id: inv.id, data: doc) ?? inv
}

/// The fields Analytics reads from a line (sale value, margin, weight, category).
private func coinItemDoc(_ it: InvoiceItem) -> [String: Any] {
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
    if let v = it.itemCategory { d["itemCategory"] = v }
    if let v = it.stoneDetails { d["stoneDetails"] = v }
    if let v = it.diamondDetails { d["diamondDetails"] = v }
    return d
}

private func coinPaymentDoc(_ p: Payment, _ share: Double) -> [String: Any] {
    var d: [String: Any] = [:]
    d["amount"] = scaled(p.amount, share)
    d["date"] = p.date
    if let v = p.notes { d["notes"] = v }
    if let v = p.method { d["method"] = v.rawValue }
    if let v = p.reference { d["reference"] = v }
    // The credit handed back stays what it is on either side of the split.
    if let v = p.kind { d["kind"] = v }
    return d
}

private func coinExchangeDoc(_ e: ExchangeEntry, _ share: Double) -> [String: Any] {
    var d: [String: Any] = [:]
    d["description"] = e.description
    d["value"] = scaled(e.value, share)
    if let v = e.karat { d["karat"] = v }
    if let v = e.weightG { d["weightG"] = v }
    if let v = e.ratePerGram { d["ratePerGram"] = v }
    return d
}
