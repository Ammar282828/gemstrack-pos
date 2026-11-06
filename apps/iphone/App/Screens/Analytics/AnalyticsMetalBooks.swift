import SwiftUI
import ERPCore

/// Analytics → Gold / Silver (pages/metal.tsx): how much metal left the shop. Weight, not rupees: the rate moves, the
/// grams do not. Shown in tola (how the trade talks) with grams in the tooltip. Gold coins are kept apart at the bottom.
/// The house's metal is its descriptor's (`House.metal`), so House of Mina reads its silver here.
struct AbMetalScreen: View {
    var body: some View {
        AbHost(title: AbSay.metalWord + " sold") { (ctx: AbCtx) in
            AbMetalPage(ctx: ctx)
        }
    }
}

struct AbMetalPage: View {
    let ctx: AbCtx

    private var b: Books { ctx.books }
    private var metal: String { AbSay.metalWord }

    private func tola(_ grams: Double, _ digits: Int = 2) -> String { AnaFormat.number(AnaFormat.tola(grams), maxDigits: digits) }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            months
            AbFigures(items: [
                AbFigure(label: "Tola", value: tola(b.metalGrams, 3), detail: "in this period"),
                AbFigure(label: "Grams", value: AnaFormat.number(b.metalGrams, maxDigits: 2)),
                AbFigure(label: "Pieces weighed", value: AnaFormat.count(b.metalPieces)),
            ])
            karats
            coins
            AbExplain {
                Text("Weight, not rupees: the rate moves, the grams do not. A piece with no recorded weight adds nothing rather than a guess, and “pieces weighed” says how many had one.")
                Text("Only the house’s metal (\(metal.lowercased())) counts here, by its karat. Tola is how the trade talks; a tola is \(AnaFormat.number(AnaFormat.gramsPerTola, maxDigits: 3)) g.")
                Text("The months are the last 12, whatever period is chosen. \(metal) coins are kept apart from sales and profit: a coin sells at the metal price plus a sliver, so counting it with jewellery would inflate revenue and give it a margin it never earned.")
            }
        }
    }

    // MARK: Month by month

    private var months: some View {
        AbLoad(ctx: ctx, work: { (engine: BooksEngine, _: BooksInput, _: BooksOptions) -> [MonthRow] in
            engine.months(12)
        }) { (rows: [MonthRow]?) in
            if let rows {
                let karatNames = karatsOf(rows)
                let hasWeight = rows.contains { (m: MonthRow) -> Bool in m.metalGrams > 0 }
                let best = rows.reduce(nil as MonthRow?) { (m: MonthRow?, r: MonthRow) -> MonthRow? in r.metalGrams > (m?.metalGrams ?? 0) ? r : m }
                let take = hasWeight && best != nil
                    ? "Most \(metal.lowercased()) left in \(best!.month): \(tola(best!.metalGrams)) tola (\(AbSay.grams(best!.metalGrams)))."
                    : "No \(metal.lowercased()) weighed in the last 12 months."
                AbCard(title: "\(metal) sold, month by month", takeaway: take) {
                    if hasWeight {
                        VStack(alignment: .leading, spacing: pt(6)) {
                            AbBars(points: rows.flatMap { (m: MonthRow) -> [AbBarPoint] in
                                karatNames.map { (k: String) -> AbBarPoint in
                                    AbBarPoint(id: m.key + "-" + k, plot: AbPlot.month(m.start), tip: m.month, series: k.uppercased(),
                                               value: AnaFormat.tola(m.metalByKarat[k] ?? 0))
                                }
                            }, series: karatNames.map { (k: String) -> AbSeries in AbSeries(name: k.uppercased(), color: AbPalette.karat(k)) },
                                   grouped: false, divisor: 1, axisLabel: "Tola",
                                   format: { (t: Double) -> String in
                                       AnaFormat.number(t, maxDigits: 2) + " tola · " + AnaFormat.number(t * AnaFormat.gramsPerTola, maxDigits: 2) + " g"
                                   }, height: 280)
                            Text("Tola; touch a month for grams. The last 12 months, whatever period is picked.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                AbCard(title: "\(metal) sold, month by month") { ProgressView().frame(maxWidth: .infinity, minHeight: 120) }
            }
        }
    }

    // MARK: By karat

    @ViewBuilder private var karats: some View {
        if !b.metalByKarat.isEmpty {
            AbTable(title: "By karat") {
                ForEach(b.metalByKarat) { (k: MetalKaratRow) in
                    AbRow(title: k.karat.uppercased(), subtitle: AbSay.grams(k.grams) + " · " + AbSay.count(Int(k.pieces), "piece"),
                          trailing: tola(k.grams, 3) + " tola", dot: AbPalette.karat(k.karat))
                }
            }
        }
    }

    // MARK: Coins, apart

    @ViewBuilder private var coins: some View {
        if b.hasCoins {
            let coin = b.coinSummary
            VStack(alignment: .leading, spacing: pt(16)) {
                Text("\(metal) coins").font(.system(.title3, design: .serif).weight(.semibold))
                if coin.invoices > 0 {
                    AbFigures(items: coinFigures(coin))
                } else {
                    Text("No coin bills in this period.").font(.subheadline).foregroundStyle(.secondary)
                }
                coinMonths
            }
        }
    }

    private func coinFigures(_ coin: CoinSummary) -> [AbFigure] {
        var items = [
            AbFigure(label: "Coin revenue", value: Money.pkrLac(coin.revenue), detail: AbSay.count(coin.invoices, "bill") + " in this period"),
            AbFigure(label: "Coins sold", value: AnaFormat.count(coin.coins), detail: coin.grams > 0 ? AnaFormat.weight(coin.grams) : "no weight recorded"),
            AbFigure(label: "Realised / gram", value: coin.ratePerGram > 0 ? Money.pkrLac(coin.ratePerGram) : "—", detail: "revenue over grams, all-in"),
        ]
        if coin.outstanding > 0 {
            items.append(AbFigure(label: "Outstanding", value: Money.pkrLac(coin.outstanding), detail: "still owed on coin bills"))
        }
        return items
    }

    private var coinMonths: some View {
        AbLoad(ctx: ctx, work: { (engine: BooksEngine, _: BooksInput, _: BooksOptions) -> [MonthRow] in
            engine.months(12)
        }) { (rows: [MonthRow]?) in
            if let rows, rows.contains(where: { (m: MonthRow) -> Bool in m.coinCount > 0 }) {
                AbCard(title: "Coins sold, month by month", takeaway: "Last 12 months, whatever period is picked.") {
                    AbBars(points: rows.map { (m: MonthRow) -> AbBarPoint in
                        AbBarPoint(id: m.key + "-c", plot: AbPlot.month(m.start), tip: m.month, series: "Coins", value: m.coinCount)
                    }, series: [AbSeries(name: "Coins", color: AbPalette.color(1))], divisor: 1, axisLabel: "Coins",
                           format: { (n: Double) -> String in AbSay.count(Int(n.rounded()), "coin") }, height: 200)
                }
            }
        }
    }
}
