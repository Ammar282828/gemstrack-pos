#if os(macOS)
import SwiftUI
import ERPCore

// Analytics › Sales on the Mac: when the money came in. The figures with their change, the charts (they read out on hover)
// on the left, and on the right the daily summary and the yearly performance as sortable tables, every day and every year
// shown. A day opens its report; a year sets the period to that year.

struct MacReportsSales: View {
    let c: MacReportsContext
    /// Sets the period to a year (a `year-2025` key).
    let pickYear: (Int) -> Void

    @State private var history = Memo<AnaHistory>()
    @State private var dayRows = Memo<[MacReportsDayRow]>()
    @State private var yearMade = Memo<[MacReportsYearRow]>()
    @State private var day: AnaDay?
    @State private var daySort = [KeyPathComparator(\MacReportsDayRow.date, order: .reverse)]
    @State private var yearSort = [KeyPathComparator(\MacReportsYearRow.year, order: .reverse)]
    @State private var daySelection = Set<String>()
    @State private var yearSelection = Set<String>()

    private var f: AnaFigures { c.figures }

    /// The whole history (months and years), which the period does not bound.
    private var hist: AnaHistory {
        history(c.booksKey) { AnaHistory(c.books, margin: c.margin) }
    }

    var body: some View {
        let h = hist
        let days = dayRowList()
        let years = yearRows(h)
        VStack(spacing: 0) {
            macReportsFigures(figureList(h))
            Divider()
            // Charts beside the two tables on a wide window; narrow, the page scrolls and each stands under the last.
            MacReportsWidth(960) {
                HStack(spacing: 0) {
                    ScrollView { chartsContent(h) }
                        .frame(minWidth: 380, idealWidth: 520)
                    Divider()
                    VSplitView {
                        daily(days)
                            .frame(minHeight: 160)
                        yearly(years)
                            .frame(minHeight: 120, idealHeight: 200)
                    }
                    .frame(minWidth: 460, idealWidth: 480)
                }
            } narrow: {
                ScrollView {
                    VStack(spacing: 0) {
                        chartsContent(h)
                        Divider()
                        daily(days).frame(height: 320)
                        Divider()
                        yearly(years).frame(height: 84 + 26 * CGFloat(min(max(years.count, 1), 10)))
                    }
                }
            }
        }
        .sheet(item: $day) { (d: AnaDay) in
            AnaDaySheet(day: d, invoices: f.invoicesByDay[d.date] ?? [])
        }
    }

    // MARK: The figures

    private func fig(_ label: String, _ value: String, _ now: Double, _ before: Double?) -> MacFigure {
        MacReportsChange.figure(label, value, now: now, before: before, words: c.words)
    }

    private func figureList(_ h: AnaHistory) -> [MacFigure] {
        let p = c.previous
        var out: [MacFigure] = []
        out.append(fig("Revenue", Money.pkrLac(f.totalSales), f.totalSales, p?.totalSales))
        out.append(fig("Orders", String(f.totalOrders), Double(f.totalOrders), p.map { Double($0.totalOrders) }))
        out.append(fig("Average order", Money.pkrLac(f.averageOrderValue), f.averageOrderValue, p?.averageOrderValue))
        out.append(fig("Items sold", AnaFormat.count(f.totalItemsSold), f.totalItemsSold, p?.totalItemsSold))
        out.append(MacFigure("Monthly average", h.monthlyAverage > 0 ? Money.pkrLac(h.monthlyAverage) : "—", detail: "Months with sales"))
        if let best = h.bestMonth, let m = h.months.first(where: { $0.key == best }), m.revenue > 0 {
            out.append(MacFigure("Best month", Money.pkrLac(m.revenue), detail: m.label))
        }
        return out
    }

    // MARK: The charts

    private func chartsContent(_ h: AnaHistory) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Sales over time", detail: nil)
            if f.salesOverTime.isEmpty {
                Text("No sales in this period.")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            } else {
                AnaSalesChart(days: f.salesOverTime).padding(.horizontal, 12)
                MacReportsHeader(title: "Number of sales", detail: nil)
                AnaOrdersChart(days: f.salesOverTime).padding(.horizontal, 12)
            }
            if !h.months.isEmpty {
                MacReportsHeader(title: "Revenue by month", detail: "Every month on record")
                AnaMonthlyChart(months: h.months, average: h.monthlyAverage, best: h.bestMonth).padding(.horizontal, 12)
            }
        }
        .padding(.bottom, 12)
    }

    // MARK: The days

    private func dayRowList() -> [MacReportsDayRow] {
        dayRows(c.key + [daySort.hashValue]) {
            f.salesOverTime
                .map { (d: AnaDay) -> MacReportsDayRow in
                    let said = ShopDate.say(d.date)
                    return MacReportsDayRow(id: d.date, date: d.date, label: said.isEmpty ? d.date : said,
                                            sales: d.sales, orders: d.orders, items: d.itemsSold, day: d)
                }
                .sorted(using: daySort)
        }
    }

    private func daily(_ rows: [MacReportsDayRow]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Daily summary", detail: rows.isEmpty ? nil : "\(rows.count) day\(rows.count == 1 ? "" : "s") \u{00B7} double-click for a day\u{2019}s report")
            Table(rows, selection: $daySelection, sortOrder: $daySort) {
                TableColumn("Day", value: \.date) { (r: MacReportsDayRow) in Text(r.label).lineLimit(1) }
                    .width(min: 100, ideal: 140)
                TableColumn("Sales", value: \.sales) { (r: MacReportsDayRow) in MacAmount(r.sales) }
                    .width(min: 70, ideal: 90)
                TableColumn("Orders", value: \.orders) { (r: MacReportsDayRow) in MacReportsNumber(String(r.orders)) }
                    .width(min: 36, ideal: 48)
                TableColumn("Pieces", value: \.items) { (r: MacReportsDayRow) in MacReportsNumber(AnaFormat.count(r.items)) }
                    .width(min: 36, ideal: 48)
            }
            .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
                if let row = rows.first(where: { ids.contains($0.id) }) {
                    Button("Open Day\u{2019}s Report") { day = row.day }
                }
            } primaryAction: { (ids: Set<String>) in
                if let row = rows.first(where: { ids.contains($0.id) }) { day = row.day }
            }
            .overlay {
                if rows.isEmpty { Text("No days in this period.").foregroundStyle(.secondary) }
            }
        }
    }

    // MARK: The years

    private func yearRows(_ h: AnaHistory) -> [MacReportsYearRow] {
        yearMade(c.booksKey + [yearSort.hashValue]) {
            h.yearly
                .map { (y: AnaYear) -> MacReportsYearRow in
                    MacReportsYearRow(id: String(y.year), year: y.year, revenue: y.revenue, unpaid: y.unpaid, expenses: y.expenses,
                                      profit: y.profit, net: y.netProfit, margin: y.revenue > 0 ? y.netProfit / y.revenue * 100 : 0)
                }
                .sorted(using: yearSort)
        }
    }

    private func yearly(_ rows: [MacReportsYearRow]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Yearly performance", detail: rows.isEmpty ? nil : "Double-click a year to filter Analytics to it")
            Table(rows, selection: $yearSelection, sortOrder: $yearSort) {
                TableColumn("Year", value: \.year) { (r: MacReportsYearRow) in Text(String(r.year)).monospacedDigit() }
                    .width(min: 50, ideal: 60)
                TableColumn("Revenue", value: \.revenue) { (r: MacReportsYearRow) in MacAmount(r.revenue) }
                    .width(min: 70, ideal: 90)
                TableColumn("Unpaid", value: \.unpaid) { (r: MacReportsYearRow) in
                    MacAmount(r.unpaid >= 1 ? r.unpaid : nil, tone: .owed)
                }
                .width(min: 70, ideal: 90)
                TableColumn("Expenses", value: \.expenses) { (r: MacReportsYearRow) in MacAmount(r.expenses) }
                    .width(min: 70, ideal: 90)
                TableColumn("Est. profit", value: \.profit) { (r: MacReportsYearRow) in MacAmount(r.profit) }
                    .width(min: 70, ideal: 90)
                TableColumn("Net profit", value: \.net) { (r: MacReportsYearRow) in
                    MacAmount(r.net, tone: r.net < 0 ? Tone.late : .quiet)
                }
                .width(min: 70, ideal: 90)
                TableColumn("Margin", value: \.margin) { (r: MacReportsYearRow) in
                    MacReportsNumber(r.revenue > 0 ? AnaFormat.fixed(r.margin, 1) + "%" : "\u{2014}")
                }
                .width(min: 50, ideal: 60)
            }
            .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
                if let row = rows.first(where: { ids.contains($0.id) }) {
                    Button("Show Analytics for \(String(row.year))") { pickYear(row.year) }
                }
            } primaryAction: { (ids: Set<String>) in
                if let row = rows.first(where: { ids.contains($0.id) }) { pickYear(row.year) }
            }
            .overlay {
                if rows.isEmpty { Text("No sales on record yet.").foregroundStyle(.secondary) }
            }
        }
    }
}

struct MacReportsDayRow: Identifiable {
    let id: String
    /// "2026-10-08": what Day sorts by.
    let date: String
    let label: String
    let sales: Double
    let orders: Int
    let items: Double
    let day: AnaDay
}

struct MacReportsYearRow: Identifiable {
    let id: String
    let year: Int
    let revenue: Double
    let unpaid: Double
    let expenses: Double
    let profit: Double
    let net: Double
    let margin: Double
}
#endif
