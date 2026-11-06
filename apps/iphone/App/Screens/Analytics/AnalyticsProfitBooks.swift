import SwiftUI
import ERPCore

/// Analytics → Profit (pages/profit.tsx): "What did we keep?" The waterfall from revenue to net profit is the page; under
/// it the same story month by month, how the estimate is made, and the years. Net profit is profit less the running
/// costs only (net-profit.ts); where a house records its goods (Mina) the middle step is its Gross profit, not an estimate.
struct AbProfitScreen: View {
    var body: some View {
        AbHost(title: "Profit") { (ctx: AbCtx) in
            AbProfitPage(ctx: ctx)
        }
    }
}

struct AbProfitPage: View {
    let ctx: AbCtx

    private var b: Books { ctx.books }
    private var profitWord: String { House.recordsGoods ? "Gross profit" : "Est. profit" }

    private var steps: [AbStep] {
        [
            AbStep(label: "Revenue", value: b.totalSales, total: true),
            AbStep(label: House.recordsGoods ? "Goods" : "Pieces cost", value: -b.costOfPieces, total: false),
            AbStep(label: profitWord, value: b.estProfitAdj, total: true),
            AbStep(label: "Running", value: -b.runningExpenses, total: false),
            AbStep(label: "Net profit", value: b.netProfit, total: true),
        ]
    }

    private var takeaway: String {
        guard b.totalSales > 0 else { return "No sales in this period." }
        let net = Money.pkrLac(b.netProfit)
        let revenue = Money.pkrLac(b.totalSales)
        if b.netProfit >= 0 {
            let kept = AnaFormat.number((b.netMargin * 10).rounded() / 10, maxDigits: 1)
            return "Kept PKR \(kept) of every PKR 100: \(net) net profit on \(revenue) revenue."
        }
        let loss = Money.pkrLac(-b.netProfit)
        let running = Money.pkrLac(b.runningExpenses)
        let profit = Money.pkrLac(b.estProfitAdj)
        let kind = House.recordsGoods ? "gross" : "estimated"
        return "A loss of \(loss): running costs of \(running) were more than the \(profit) of \(kind) profit."
    }

    private var estPercent: Double { b.totalSales > 0 ? (b.estProfitAdj / b.totalSales * 1000).rounded() / 10 : 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            AbCard(title: "From revenue to profit", takeaway: takeaway) {
                AbWaterfall(steps: steps, height: 300)
            }
            AbFigures(items: [
                AbFigure(label: "Revenue", value: Money.pkrLac(b.totalSales)),
                AbFigure(label: profitWord, value: Money.pkrLac(b.estProfitAdj),
                         detail: b.totalSales > 0 ? AbSay.pct1(estPercent) + " of revenue" : nil),
                AbFigure(label: "Running costs", value: Money.pkrLac(b.runningExpenses)),
                AbFigure(label: "Net profit", value: Money.pkrLac(b.netProfit),
                         detail: b.totalSales > 0 ? AbSay.pct1(b.netMargin) + " margin" : nil,
                         tone: b.totalSales > 0 ? (b.netProfit >= 0 ? Tone.settled : Tone.late) : nil),
            ])
            months
            explain
            years
        }
    }

    // MARK: Month by month

    private var months: some View {
        AbLoad(ctx: ctx, work: { (engine: BooksEngine, _: BooksInput, _: BooksOptions) -> [MonthRow] in
            engine.months(12)
        }) { (rows: [MonthRow]?) in
            if let rows {
                let best = rows.reduce(nil as MonthRow?) { (m: MonthRow?, r: MonthRow) -> MonthRow? in r.net > (m?.net ?? -Double.infinity) ? r : m }
                let take = best != nil && best!.revenue > 0
                    ? "Best net profit of the last 12 months: " + best!.month + ", " + Money.pkrLac(best!.net) + "."
                    : "No sales in the last 12 months."
                AbCard(title: "Month by month", takeaway: take) {
                    VStack(alignment: .leading, spacing: pt(16)) {
                        AbBars(points: rows.flatMap { (m: MonthRow) -> [AbBarPoint] in
                            [
                                AbBarPoint(id: m.key + "-p", plot: AbPlot.month(m.start), tip: m.month, series: profitWord, value: m.estProfit),
                                AbBarPoint(id: m.key + "-r", plot: AbPlot.month(m.start), tip: m.month, series: "Running costs", value: m.running),
                            ]
                        }, series: [AbSeries(name: profitWord, color: AbPalette.color(1)), AbSeries(name: "Running costs", color: AbPalette.color(2))],
                               height: 240)
                        Text("Net margin").font(.subheadline.weight(.medium))
                        AbBars(points: rows.map { (m: MonthRow) -> AbBarPoint in
                            AbBarPoint(id: m.key + "-m", plot: AbPlot.month(m.start), tip: m.month, series: "Net margin", value: m.netMargin)
                        }, series: [], line: AbSeries(name: "Net margin", color: AbPalette.color(4)), divisor: 1, axisLabel: "Percent",
                               format: { (v: Double) -> String in AbSay.pct1(v) }, height: 130)
                    }
                }
            } else {
                AbCard(title: "Month by month") { ProgressView().frame(maxWidth: .infinity, minHeight: 120) }
            }
        }
    }

    // MARK: How it is worked out

    private var explain: some View {
        let margin = Int((House.margin.assumedMargin * 100).rounded())
        let costed = b.salesCosted
        let count = b.salesCount
        let rest = max(0, count - costed)
        let flat = Money.pkrLac(b.estProfit)
        let pct = AnaFormat.number(estPercent, maxDigits: 1)
        return AbExplain(title: "How profit is estimated") {
            if House.recordsGoods {
                Text("Gross profit is revenue less the goods bought in the period (\(pct)% of revenue here). Stock bought and not yet sold counts as spent. At a flat \(margin)% it would be \(flat).")
            } else if let ratti = House.margin.rattiLess, costed > 0 {
                let less = AnaFormat.number(ratti, maxDigits: 2)
                Text("\(costed) of \(count) sales are worked out from the 24k rate typed when they were made (the piece costs that rate less \(less) ratti); the other \(rest) are taken at \(margin)%. Extra revenue is also at \(margin)%.")
            } else {
                Text("Est. profit is revenue × \(margin)%, before running costs.")
            }
            Text("Net profit is that profit less running costs only: not the owners’ drawings, and not the goods the margin already allows for.")
        }
    }

    // MARK: Every year

    private var years: some View {
        AbLoad(ctx: ctx, work: { (_: BooksEngine, input: BooksInput, options: BooksOptions) -> [YearRow] in
            yearlySummary(input, options: options)
        }) { (rows: [YearRow]?) in
            if let rows, !rows.isEmpty {
                AbTable(title: "Every year", detail: "All of history, whatever period is chosen. Tap a year to look at it.") {
                    ForEach(rows) { (y: YearRow) in
                        Button { ctx.setRange("year-" + String(y.year)) } label: {
                            AbRow(title: String(y.year), subtitle: yearLine(y),
                                  trailing: Money.lacCrore(y.netProfit), trailingTone: y.netProfit < 0 ? Tone.late : nil)
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    /// "Revenue 4.5 lac · Est. profit 40,000 · running 10,000 · unpaid 5,000 · 3.2% margin".
    private func yearLine(_ y: YearRow) -> String {
        var parts: [String] = ["Revenue \(Money.lacCrore(y.revenue))", "\(profitWord) \(Money.lacCrore(y.profit))", "running \(Money.lacCrore(y.expenses))"]
        if y.unpaid > 0 { parts.append("unpaid \(Money.lacCrore(y.unpaid))") }
        if y.revenue > 0 { parts.append("\(AbSay.pct1(y.netMargin)) margin") }
        return parts.joined(separator: " · ")
    }
}
