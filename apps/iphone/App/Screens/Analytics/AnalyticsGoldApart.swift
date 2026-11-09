import SwiftUI
import ERPCore

// Gold apart from silver (owner, 2026-11-09, House of Mina: "I want gold revenue to be separate with a (est 10% profit
// margin) and silver revenue to be separate. So this takes effect in any place revenue is mentioned"). The split is ERPCore's
// (GoldApart, Books.goldRevenue / silverRevenue); this is only how a screen says it. The total stays "Revenue" with the
// two parts under it; a business whose descriptor has no `goldApartMargin` (Taheri) gets nil and nothing changes
// (src/lib/analytics/gold-split.ts, the web's twin of this file).

/// The revenue split of one set of books, with the words every place uses.
struct AbSplit {
    let total: Double
    let silver: Double
    let gold: Double
    let goldProfit: Double
    let percent: Double

    init(total: Double, silver: Double, gold: Double, goldProfit: Double, percent: Double) {
        self.total = total
        self.silver = silver
        self.gold = gold
        self.goldProfit = goldProfit
        self.percent = percent
    }

    /// nil where gold is not apart (`percent` nil: Taheri).
    init?(_ b: Books, percent: Double?) {
        guard let percent else { return nil }
        self.init(total: b.totalSales, silver: b.silverRevenue, gold: b.goldRevenue, goldProfit: b.goldProfit, percent: percent)
    }

    /// The same from the earlier figures (`AnaFigures`, which the Mac's pages and the old pages read).
    init?(_ f: AnaFigures) {
        guard let percent = f.goldApartMargin else { return nil }
        self.init(total: f.totalSales, silver: f.silverRevenue, gold: f.goldRevenue, goldProfit: f.goldProfit, percent: percent)
    }

    var silverLabel: String { GoldApart.silverRevenueLabel }
    var goldLabel: String { GoldApart.goldRevenueLabel(percent) }
    /// "Profit est. at 10%: PKR 4,000"
    var goldCaption: String { "Profit est. at " + GoldApart.percentText(percent) + "%: " + Money.pkrLac(goldProfit) }
    /// The two parts under the total, a line each, for a tile's small print.
    var tileLines: String {
        silverLabel + " " + Money.pkrLac(silver) + "\n" + goldLabel + " " + Money.pkrLac(gold) + "\n" + goldCaption
    }
    /// "Silver PKR 6 lac · Gold PKR 4 lac (est. 10% margin)": one line of words.
    var line: String {
        "Silver " + Money.pkrLac(silver) + " \u{00B7} Gold " + Money.pkrLac(gold) + " (est. " + GoldApart.percentText(percent) + "% margin)"
    }
}

extension AbCtx {
    /// The split of this period's books; nil where gold is not apart.
    var split: AbSplit? { AbSplit(books, percent: options.goldApartMargin) }
}

/// "Revenue by metal": one bar, silver then gold, with the gold's estimated profit under it.
struct AbMetalRevenue: View {
    let split: AbSplit

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Text("Revenue by metal").font(.house(.footnote).weight(.medium))
            AbStack(parts: [
                AbPart(id: "silver", label: split.silverLabel, value: split.silver, color: AbPalette.color(1)),
                AbPart(id: "gold", label: split.goldLabel, value: split.gold, color: AbPalette.color(3)),
            ], format: abLac, interactive: false)
            Text(split.goldCaption).font(.house(.footnote)).foregroundStyle(.secondary)
        }
    }
}

/// Silver and gold per day, week or month, stacked: the Sales page's picture of the split.
struct AbMetalTrend: View {
    let books: Books
    let split: AbSplit
    let bucket: BooksBucket
    let period: Period
    let now: Date

    private var unit: Calendar.Component {
        switch bucket {
        case .day: return .day
        case .week: return .weekOfYear
        case .month: return .month
        }
    }

    var body: some View {
        let rows = silverGoldRows(books.salesOverTime, bucket, range: period, now: now)
        AbBars(points: rows.flatMap { (r: SilverGoldRow) -> [AbBarPoint] in
            [
                AbBarPoint(id: r.key + "-s", plot: AbPlot.bucket(r.start, bucket), tip: r.tip, series: split.silverLabel, value: r.silver),
                AbBarPoint(id: r.key + "-g", plot: AbPlot.bucket(r.start, bucket), tip: r.tip, series: split.goldLabel, value: r.gold),
            ]
        }, series: [AbSeries(name: split.silverLabel, color: AbPalette.color(1)), AbSeries(name: split.goldLabel, color: AbPalette.color(3))],
                grouped: false, unit: unit, height: 220)
    }
}
