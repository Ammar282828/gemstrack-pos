#if os(macOS)
import SwiftUI
import ERPCore

// The pieces of a stock piece's page that Stock's inspector and the piece's own window share: what it is made of, and
// what it sells for at today's rates with the sum shown line by line (docs/features/mac-design.md, "Stock"). Plain rows
// as cards on the ground (the iPhone's piece page): the numbers are ERPCore's (`calculateProductCosts`, through StockKit), the
// words are the piece page's.

/// A piece's price at today's rates: the total, or why there is none. A fixed-price piece sells at its own price.
enum MacStockPricing {
    /// The rates a piece is priced from; nil while the shop's settings have not arrived (a fixed price needs none).
    static func rates(_ p: Product, _ settings: Settings?) -> PricingRates? {
        StockKit.rates(settings) ?? (p.isCustomPrice ? PricingRates() : nil)
    }

    /// What the piece sells for, or nil while the rates are not here.
    static func total(_ p: Product, _ settings: Settings?) -> Double? {
        rates(p, settings).map { StockKit.costs(p, $0).totalPrice }
    }

    /// "PKR 321,700", "Price N/A" for a piece that prices at nothing, a dash while the rates have not arrived.
    static func words(_ total: Double?) -> String {
        guard let total else { return "\u{2014}" }
        return total > 0 ? Money.pkr(total) : "Price N/A"
    }
}

/// What a piece is made of: category, metal, weight, finish, stones and the notes. Sections for a grouped Form.
struct MacStockDetailSections: View {
    let product: Product

    var body: some View {
        let p = product
        MacWorkCard("Details") {
            MacWorkFact("Category", StockKit.categoryTitle(p.categoryId))
            if !p.isCustomPrice { makeRows(p) }
            if let size = StockKit.filled(p.size) { MacWorkFact("Size", size) }
            if let finish = describePlating(p) { MacWorkFact("Finish", finish) }
            if let stones = StockKit.filled(p.stoneDetails) { note("Stones and second metal", stones) }
            if let diamonds = StockKit.filled(p.diamondDetails) { note("Diamond details", diamonds) }
            if let about = StockKit.filled(p.description) { note("Description", about) }
        }
    }

    @ViewBuilder
    private func makeRows(_ p: Product) -> some View {
        MacWorkFact("Metal", capitalised(p.metalType.rawValue))
        if p.metalType == .gold, let k = p.karat, !k.rawValue.isEmpty {
            MacWorkFact("Karat", k.rawValue.uppercased())
        }
        MacWorkFact("Weight", StockKit.grams(p.metalWeightG))
        if let second = p.secondaryMetalType, !second.rawValue.isEmpty, (p.secondaryMetalWeightG ?? 0) > 0 {
            MacWorkFact("Second metal", capitalised(second.rawValue))
            if second == .gold, let k = p.secondaryMetalKarat, !k.rawValue.isEmpty {
                MacWorkFact("Second metal karat", k.rawValue.uppercased())
            }
            MacWorkFact("Second metal weight", StockKit.grams(p.secondaryMetalWeightG ?? 0))
        }
        if p.metalType != .silver {
            MacWorkFact("Wastage", StockKit.percent(p.wastagePercentage))
        }
        MacWorkFact("Diamonds", p.hasDiamonds ? "Yes" : "No")
        if p.stoneWeightG > 0 {
            MacWorkFact("Stone weight", StockKit.grams(p.stoneWeightG))
        }
    }

    private func capitalised(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    private func note(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            Text(text).textSelection(.enabled)
        }
    }
}

/// What the piece sells for at today's rates and how that adds up, as plain rows: the rate it is priced from, the metal,
/// wastage, making, diamonds, stones and sundries, then the total. Silver has no wastage or making line (its rate carries them).
struct MacStockPriceSection: View {
    let product: Product
    let settings: Settings?

    var body: some View {
        let p = product
        let rates = MacStockPricing.rates(p, settings)
        let costs: ProductCosts? = rates.map { StockKit.costs(p, $0) }
        MacWorkCard(p.isCustomPrice ? "Fixed Price" : "Price at Today's Rates") {
            HStack(alignment: .firstTextBaseline) {
                Text("Price").font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Text(MacStockPricing.words(costs?.totalPrice))
                    .font(.system(.title3, design: .serif).weight(.semibold)).monospacedDigit()
            }
            if p.isCustomPrice {
                if let note = StockKit.filled(p.description) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Description").font(.callout).foregroundStyle(.secondary)
                        Text(note).textSelection(.enabled)
                    }
                }
            } else if let costs {
                breakdown(p, costs)
            }
        }
    }

    @ViewBuilder
    private func breakdown(_ p: Product, _ c: ProductCosts) -> some View {
        if let settings, let rate = StockKit.rateLine(p, settings) {
            MacWorkFact(rate.label, "\(Money.pkr(rate.perGram)) / gram")
        }
        money("Metal cost", c.metalCost)
        if p.metalType != .silver {
            money("Wastage cost", c.wastageCost)
            money("Making charges", c.makingCharges)
        }
        if p.hasDiamonds { money("Diamond charges", c.diamondCharges) }
        money(p.hasDiamonds ? "Other stone charges" : "Stone charges", c.stoneCharges)
        money("Misc. charges", c.miscCharges)
    }

    private func money(_ label: String, _ amount: Double) -> some View {
        MacWorkFact(label, Money.pkr(amount))
    }
}
#endif
