import SwiftUI
import ERPCore

/// Analytics → Cash (pages/cash.tsx): "What actually moved?" Money in against money out, month by month, then this
/// period's two sides taken apart. Revenue counts what was earned (open orders and unpaid bills included); cash counts
/// only what physically moved, and the gap between them is who still owes us, listed at the bottom (the Overview's
/// "Still to collect" opens here).
struct AbCashScreen: View {
    var body: some View {
        AbHost(title: "Cash") { (ctx: AbCtx) in
            AbCashPage(ctx: ctx)
        }
    }
}

struct AbCashPage: View {
    let ctx: AbCtx

    private var b: Books { ctx.books }

    private var inParts: [AbPart] {
        [
            AbPart(id: "invoice", label: "Invoice payments", value: b.cashInFromInvoicePayments, color: AbPalette.color(1)),
            AbPart(id: "advance", label: "Order advances", value: b.cashInFromOrderAdvances, color: AbPalette.color(2)),
            AbPart(id: "exchange", label: "Exchange", value: b.cashInFromExchange, color: AbPalette.color(3)),
            AbPart(id: "extra", label: "Extra revenue", value: b.cashInFromExtraRevenue, color: AbPalette.color(4)),
        ]
    }

    private var outParts: [AbPart] {
        [
            AbPart(id: "running", label: "Running costs", value: b.cashOutRunning, color: AbPalette.kind(.running)),
            AbPart(id: "goods", label: "Goods", value: b.cashOutGoods, color: AbPalette.kind(.goods)),
            AbPart(id: "drawings", label: "Drawings", value: b.cashOutDrawings, color: AbPalette.kind(.drawings)),
            AbPart(id: "credit", label: "Credit paid back", value: b.creditPaidBack, color: AbPalette.color(4)),
        ]
    }

    private var gapLine: String {
        b.accrualVsCashGap > 0
            ? Money.pkrLac(b.accrualVsCashGap) + " of the revenue is not collected yet: it sits in unpaid invoices and open orders. That gap is revenue (what was earned) less cash in (what moved), gold taken off a bill left out."
            : "Everything earned in this period has been collected."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            months
            AbFigures(items: [
                AbFigure(label: "Cash in", value: Money.pkrLac(b.cashIn), tone: .settled),
                AbFigure(label: "Cash out", value: Money.pkrLac(b.cashOut), tone: b.cashOut > 0 ? Tone.late : nil),
                AbFigure(label: "Net cash", value: AbSay.signed(b.netCashFlow),
                         detail: b.netCashFlow >= 0 ? "Cash grew this period" : "More went out than came in",
                         tone: b.netCashFlow >= 0 ? Tone.settled : Tone.late),
            ])
            AbGrid {
                AbCard(title: "Where the cash came from", takeaway: b.cashIn > 0 ? Money.pkrLac(b.cashIn) + " came in." : "No cash came in during this period.") {
                    if b.cashIn > 0 { AbStack(parts: inParts, format: { (v: Double) -> String in Money.pkrLac(v) }) }
                }
                AbCard(title: "Where the cash went", takeaway: b.cashOut > 0 ? Money.pkrLac(b.cashOut) + " went out." : "No cash went out during this period.") {
                    if b.cashOut > 0 { AbStack(parts: outParts, format: { (v: Double) -> String in Money.pkrLac(v) }) }
                }
            }
            receivables
            AbExplain {
                Text(gapLine)
                Text("Cash flow counts money received and paid. Revenue also includes unpaid sales and open orders. Cash out is every expense paid in the period, and credit handed back to a customer; credit paid back is also added to cash in, so the net is the same.")
                Text("A payment on an older bill lands in the month it was paid, even in a month with no new sale.")
            }
        }
    }

    // MARK: Month by month

    private var months: some View {
        AbLoad(ctx: ctx, work: { (engine: BooksEngine, _: BooksInput, _: BooksOptions) -> [MonthRow] in
            engine.months(12)
        }) { (rows: [MonthRow]?) in
            if let rows {
                let best = rows.reduce(nil as MonthRow?) { (m: MonthRow?, r: MonthRow) -> MonthRow? in
                    (r.cashIn - r.cashOut) > (m.map { $0.cashIn - $0.cashOut } ?? -Double.infinity) ? r : m
                }
                let take = best != nil && (best!.cashIn > 0 || best!.cashOut > 0)
                    ? "Most cash kept in the last 12 months: " + best!.month + ", " + AbSay.signed(best!.cashIn - best!.cashOut) + "."
                    : "No money moved in the last 12 months."
                AbCard(title: "Money in and out", takeaway: take) {
                    AbBars(points: rows.flatMap { (m: MonthRow) -> [AbBarPoint] in
                        [
                            AbBarPoint(id: m.key + "-i", plot: AbPlot.month(m.start), tip: m.month, series: "In", value: m.cashIn),
                            AbBarPoint(id: m.key + "-o", plot: AbPlot.month(m.start), tip: m.month, series: "Out", value: m.cashOut),
                            AbBarPoint(id: m.key + "-n", plot: AbPlot.month(m.start), tip: m.month, series: "Net", value: m.cashIn - m.cashOut),
                        ]
                    }, series: [AbSeries(name: "In", color: Tone.settled.color), AbSeries(name: "Out", color: Tone.late.color)],
                           line: AbSeries(name: "Net", color: AbPalette.color(2)), height: 300)
                }
            } else {
                AbCard(title: "Money in and out") { ProgressView().frame(maxWidth: .infinity, minHeight: 120) }
            }
        }
    }

    // MARK: Who still owes us

    @ViewBuilder private var receivables: some View {
        let list = b.receivables
        let shown = Array(list.prefix(15))
        if list.isEmpty {
            AbCard(title: "Who still owes us", takeaway: "Nobody owes anything on this period’s sales.") { EmptyView() }
        } else {
            AbTable(title: "Who still owes us") {
                ForEach(shown) { (r: ReceivableRow) in
                    NavigationLink(value: Route(path: "/invoices/" + r.id)) {
                        AbRow(title: r.customerName,
                              subtitle: AbSay.day(r.date, "d MMM yyyy") + (r.coinDue > 0 ? " · " + Money.lacCrore(r.coinDue) + " of it on coins" : ""),
                              trailing: Money.lacCrore(r.balanceDue), trailingTone: Tone.owed)
                    }
                    .buttonStyle(.pressable)
                }
                HStack {
                    Text(list.count > shown.count ? "Largest " + String(shown.count) + " of " + String(list.count) + " unpaid" : String(list.count) + " unpaid")
                        .font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    Text("Total owed " + Money.pkrLac(b.receivablesTotal)).font(.footnote.weight(.semibold)).monospacedDigit()
                }
                .padding(.top, pt(8))
            }
        }
    }
}
