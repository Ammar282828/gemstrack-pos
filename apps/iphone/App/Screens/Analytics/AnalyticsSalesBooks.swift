import SwiftUI
import ERPCore

/// Analytics → Sales (pages/sales.tsx): "When did the money come in?" The hero is revenue over time (day, week or month)
/// with the period before dashed on the same axis; under it the figures, what the revenue is made of, which weekdays
/// are busy, every month on record, and every day (a row opens that day's invoices and pieces).
struct AbSalesScreen: View {
    var body: some View {
        AbHost(title: "Sales") { (ctx: AbCtx) in
            AbSalesPage(ctx: ctx)
        }
    }
}

struct AbSalesPage: View {
    let ctx: AbCtx
    /// The grain the person picked; a new period starts over on its own.
    @State private var picked: BooksBucket?
    @State private var compare = true
    @State private var day: SalesDay?
    @State private var allDays = false

    private var b: Books { ctx.books }
    private var bucket: BooksBucket { picked ?? autoBucket(ctx.period, now: ctx.now) }

    /// What a different period is: its key and its two ends.
    private var periodID: String {
        ctx.state.key + "|" + String(Int(ctx.range?.from.timeIntervalSince1970 ?? 0)) + "|" + String(Int(ctx.range?.to.timeIntervalSince1970 ?? 0))
    }

    private var canCompare: Bool { ctx.previous != nil && (ctx.prev?.totalSales ?? 0) > 0 }

    private var rows: [ComparedRow] {
        let current = bucketSeries(b.salesOverTime, bucket, range: ctx.period, now: ctx.now)
        let before: [BucketRow]? = ctx.prev.map { (p: Books) -> [BucketRow] in
            bucketSeries(p.salesOverTime, bucket, range: ctx.previousRange, now: ctx.now)
        }
        return compareSeries(current, before)
    }

    private var trendTakeaway: String {
        let best = rows.reduce(nil as ComparedRow?) { (m: ComparedRow?, r: ComparedRow) -> ComparedRow? in r.value > (m?.value ?? 0) ? r : m }
        guard let best else { return "No sales in this period" }
        var s = "Best " + bucket.rawValue + ": " + best.tip + " · " + Money.pkrLac(best.value)
        if canCompare && compare, let before = ctx.prev, let label = ctx.previousLabel {
            s += " · " + Money.pkrLac(before.totalSales) + " " + label
        }
        return s
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            trend
            AbFigures(items: [
                AbFigure(label: "Sales", value: AnaFormat.number(Double(b.totalOrders), maxDigits: 0), detail: "Invoices and booked orders"),
                AbFigure(label: "Average sale", value: Money.pkrLac(b.averageOrderValue)),
                AbFigure(label: "Pieces sold", value: AnaFormat.count(b.totalItemsSold),
                         detail: AnaFormat.fixed(b.averageItemsPerOrder, 1) + " per sale"),
                AbFigure(label: "Discounts given", value: Money.pkrLac(b.totalDiscounts)),
            ])
            AbGrid {
                mix
                weekdays
            }
            months
            days
            AbExplain {
                Text("Revenue is what the shop sold, on the day it was ordered: an invoice at its sale value (gold taken in exchange is payment, so it is added back), an order not yet invoiced at its full value, and extra revenue such as repairs.")
                Text(AbSay.metalWord + " coins are kept apart from sales and profit; they are on the " + AbSay.metalWord + " page.")
                Text("The grain suits the period until you pick one: days up to 45 of them, weeks up to 200, then months. Quiet days stay on the chart as zeros, and the dashed line is the period before, day for day.")
                Text("A weekday’s figure is its average over the days the period holds, quiet days counted as 0.")
            }
        }
        .onChange(of: periodID) { _, _ in picked = nil }
        .sheet(item: $day) { (d: SalesDay) in
            AbDaySheet(day: d, invoices: b.invoicesByDay[d.date] ?? [])
        }
    }

    // MARK: Revenue over time

    private var trend: some View {
        AbCard(title: "Revenue over time", takeaway: trendTakeaway) {
            VStack(alignment: .leading, spacing: pt(12)) {
                Picker("Group by", selection: Binding<BooksBucket>(get: { bucket }, set: { (v: BooksBucket) in picked = v })) {
                    Text("Day").tag(BooksBucket.day)
                    Text("Week").tag(BooksBucket.week)
                    Text("Month").tag(BooksBucket.month)
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: bucket)
                if canCompare, let label = ctx.previousLabel {
                    Toggle("Compare with " + label, isOn: $compare)
                        .font(.subheadline)
                        .tint(Theme.accent)
                }
                AbTrend(rows: rows, bucket: bucket, showPrev: canCompare && compare, height: 280)
            }
        }
    }

    // MARK: Mix and weekdays

    private var mix: some View {
        let total = b.revenueMix.reduce(0) { $0 + $1.value }
        let top = b.revenueMix.max { $0.value < $1.value }
        let take = total > 0 && top != nil
            ? top!.label + " made " + String(AbSay.percent(top!.value, total)) + "% of " + Money.pkrLac(total)
            : "No revenue in this period"
        let colors: [String: Color] = ["invoices": AbPalette.color(1), "orders": AbPalette.color(2), "extra": AbPalette.color(3)]
        return AbCard(title: "Revenue mix", takeaway: take) {
            AbStack(parts: b.revenueMix.map { (m: RevenueMixRow) -> AbPart in
                AbPart(id: m.key, label: m.label, value: m.value, color: colors[m.key] ?? AbPalette.color(6))
            }, format: abLac)
        }
    }

    private var weekdays: some View {
        let best = b.byWeekday.reduce(nil as WeekdayRow?) { (m: WeekdayRow?, d: WeekdayRow) -> WeekdayRow? in d.avg > (m?.avg ?? 0) ? d : m }
        let take = best != nil && best!.avg > 0
            ? best!.label + " is busiest: " + Money.pkrLac(best!.avg) + " on an average one"
            : "No sales in this period"
        return AbCard(title: "By weekday", takeaway: take) {
            AbColumns(columns: b.byWeekday.map { (d: WeekdayRow) -> AbColumns.Column in
                AbColumns.Column(id: d.label, label: d.label, value: d.avg,
                                 detail: Money.pkrLac(d.avg) + " on average · " + AbSay.count(d.count, "sale") + " over " + AbSay.count(d.days, "day"))
            })
        }
    }

    // MARK: Every month

    private var months: some View {
        AbLoad(ctx: ctx, work: { (_: BooksEngine, input: BooksInput, options: BooksOptions) -> MonthlyRevenue in
            monthlyRevenue(input, options: options)
        }) { (monthly: MonthlyRevenue?) in
            if let monthly, !monthly.data.isEmpty {
                let best = monthly.data.first { $0.key == monthly.best }
                let take = best.map { "Best month " + $0.month + " · " + Money.pkrLac($0.revenue) + "; the dashed line is the " + Money.pkrLac(monthly.average) + " average" }
                AbCard(title: "Every month", takeaway: take) {
                    AbBars(points: monthly.data.flatMap { (m: MonthlyRevenue.Row) -> [AbBarPoint] in
                        [
                            AbBarPoint(id: m.key + "-r", plot: AbPlot.month(m.start), tip: m.month, series: "Revenue", value: m.revenue),
                            AbBarPoint(id: m.key + "-a", plot: AbPlot.month(m.start), tip: m.month, series: "Average", value: monthly.average),
                        ]
                    }, series: [AbSeries(name: "Revenue", color: AbPalette.color(1))],
                           line: AbSeries(name: "Average", color: Color.secondary), grouped: false, height: 240)
                }
            }
        }
    }

    // MARK: Every day

    private var days: some View {
        let list = b.salesOverTime.sorted { $0.date > $1.date }
        let shown = allDays ? list : Array(list.prefix(14))
        return AbTable(title: "Every day",
                       detail: list.isEmpty ? nil : AbSay.count(list.count, "day") + " with sales. Tap a day to see its invoices and pieces.") {
            if list.isEmpty {
                Text("No daily data available for the selected period.").font(.subheadline).foregroundStyle(.secondary)
                    .padding(.vertical, pt(8))
            } else {
                ForEach(shown) { (d: SalesDay) in
                    Button { day = d } label: {
                        AbRow(title: AbSay.day(d.date, "EEE, d MMM yyyy"),
                              subtitle: AbSay.count(d.orders, "order") + " · " + AnaFormat.count(d.itemsSold) + " " + (d.itemsSold == 1 ? "piece" : "pieces"),
                              trailing: Money.lacCrore(d.sales))
                    }
                    .buttonStyle(.pressable)
                }
                if list.count > shown.count || allDays {
                    Button(allDays ? "Show fewer" : "Show all " + String(list.count) + " days") { allDays.toggle() }
                        .font(.subheadline)
                        .padding(.top, pt(8))
                }
            }
        }
    }
}

/// One day's invoices and the pieces on them, as the web's Daily Report dialog shows them.
struct AbDaySheet: View {
    let day: SalesDay
    let invoices: [Invoice]
    @Environment(\.dismiss) private var dismiss

    private struct Piece: Identifiable {
        let id: String
        let item: InvoiceItem
    }

    private var pieces: [Piece] {
        var out: [Piece] = []
        for inv in invoices {
            for (i, item) in inv.items.enumerated() { out.append(Piece(id: inv.id + "-" + String(i) + "-" + item.sku, item: item)) }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Total revenue") { Text(Money.pkrLac(day.sales)).monospacedDigit() }
                    LabeledContent("Total orders", value: String(day.orders))
                    LabeledContent("Pieces sold", value: AnaFormat.count(day.itemsSold))
                }
                .houseRows()
                if !invoices.isEmpty {
                    Section {
                        ForEach(invoices) { (inv: Invoice) in
                            TwoLine(title: inv.customerName.isEmpty ? WALK_IN_NAME : inv.customerName, subtitle: inv.id,
                                    trailing: Money.lacCrore(invoiceSaleValue(inv)))
                        }
                    } header: {
                        LedgerHeading(title: "Invoices", count: invoices.count)
                    }
                    .houseRows()
                }
                if !pieces.isEmpty {
                    Section {
                        ForEach(pieces) { (p: Piece) in
                            TwoLine(title: p.item.name, subtitle: p.item.sku, trailing: Money.lacCrore(p.item.itemTotal))
                        }
                    } header: {
                        LedgerHeading(title: "Products sold", count: pieces.count)
                    }
                    .houseRows()
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background { HouseGroundFill().ignoresSafeArea() }
            .navigationTitle(AbSay.day(day.date, "EEE, d MMM yyyy"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
