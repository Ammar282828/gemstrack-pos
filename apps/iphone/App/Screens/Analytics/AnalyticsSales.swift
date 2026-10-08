import SwiftUI
import ERPCore

/// Analytics → Sales (analytics-view.tsx, section "sales"): when the money came in. Sales over time in
/// the period, then the shape of the whole history (months and years, which the period does not bound),
/// then the days one by one. A year's row sets the period to that year; a day's row opens its report.
struct AnaSalesPage: View {
    let figures: AnaFigures
    let history: AnaHistory
    let bar: AnaPeriodBar
    let showCosts: Bool
    /// Sets the period (a `year-2025` key).
    let pick: (String) -> Void

    @State private var day: AnaDay?

    var body: some View {
        List {
            Section {
                bar
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            overTimeSection
            monthlySection
            yearlySection
            dailySection
        }
        .listStyle(.insetGrouped)
        .sheet(item: $day) { (d: AnaDay) in
            AnaDaySheet(day: d, invoices: figures.invoicesByDay[d.date] ?? [])
        }
    }

    // MARK: Sales over time

    private var overTimeSection: some View {
        Section {
            if figures.salesOverTime.isEmpty {
                Text("No sales data available to display chart for the selected period.").foregroundStyle(.secondary)
            } else {
                AnaSalesChart(days: figures.salesOverTime)
                AnaOrdersChart(days: figures.salesOverTime)
            }
        } header: {
            Text("Sales over time")
        } footer: {
            Text("Revenue and order count trend for the selected period.")
        }
        .houseRows()
    }

    // MARK: Revenue by month

    @ViewBuilder private var monthlySection: some View {
        if !history.months.isEmpty {
            Section {
                AnaMonthlyChart(months: history.months, average: history.monthlyAverage, best: history.bestMonth)
            } header: {
                Text("Revenue by month")
            } footer: {
                Text(monthlyNote)
            }
            .houseRows()
        }
    }

    private var monthlyNote: String {
        var text = "Every month on record, regardless of the period above."
        if history.monthlyAverage > 0 {
            text += " Averaging \(Money.pkrLac(history.monthlyAverage)) across months with sales; the best month is green."
        }
        return text
    }

    // MARK: Yearly performance

    @ViewBuilder private var yearlySection: some View {
        if !history.yearly.isEmpty {
            Section {
                ForEach(history.yearly) { (y: AnaYear) in
                    Button { pick("year-\(y.year)") } label: { yearRow(y) }
                        .buttonStyle(.plain)
                }
            } header: {
                Text("Yearly performance")
            } footer: {
                Text(showCosts
                     ? "All-time revenue, expenses and profit by year. Tap a year to filter Analytics to it."
                     : "All-time revenue by year. Tap a year to filter Analytics to it.")
            }
            .houseRows()
        }
    }

    private func yearRow(_ y: AnaYear) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(y.year)).font(.headline)
                Spacer(minLength: 8)
                Text(Money.lacCrore(y.revenue)).font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            Text(yearDetail(y)).font(.caption).foregroundStyle(.secondary)
            if showCosts {
                HStack(spacing: 6) {
                    Text("Net profit \(Money.lacCrore(y.netProfit))")
                        .foregroundStyle(y.netProfit >= 0 ? Color.green : Color.red)
                    Text(y.revenue > 0 ? "\(AnaFormat.fixed(y.netProfit / y.revenue * 100, 1))% margin" : "—")
                        .foregroundStyle(.secondary)
                }
                .font(.caption)
                .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func yearDetail(_ y: AnaYear) -> String {
        var parts: [String] = []
        parts.append(y.unpaid > 0 ? "Unpaid \(Money.lacCrore(y.unpaid))" : "Nothing unpaid")
        if showCosts {
            parts.append("Expenses \(Money.lacCrore(y.expenses))")
            parts.append("Est. profit \(Money.lacCrore(y.profit))")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: Daily summary

    private var dailySection: some View {
        Section {
            if figures.salesOverTime.isEmpty {
                Text("No daily data available for the selected period.").foregroundStyle(.secondary)
            } else {
                ForEach(figures.salesOverTime) { (d: AnaDay) in
                    Button { day = d } label: { dayRow(d) }
                        .buttonStyle(.plain)
                }
            }
        } header: {
            Text("Daily summary")
        } footer: {
            Text("A day-by-day breakdown of sales activity for the selected period. Tap a day for its report.")
        }
        .houseRows()
    }

    private func dayRow(_ d: AnaDay) -> some View {
        // "Today", "Yesterday", "Tue 6 Oct", "6 Oct 2025": the shop's way of saying a day.
        let said = ShopDate.say(d.date)
        let title = said.isEmpty ? d.date : said
        let orders = String(d.orders) + " " + AnaFormat.plural(d.orders, "order", "orders")
        let items = AnaFormat.count(d.itemsSold) + (d.itemsSold == 1 ? " item" : " items")
        let subtitle = orders + " · " + items
        return TwoLine(title: title, subtitle: subtitle, trailing: Money.lacCrore(d.sales))
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
    }
}

/// One day's report: its revenue, the invoices written, and the pieces on them. The web's dialog.
struct AnaDaySheet: View {
    let day: AnaDay
    let invoices: [Invoice]

    @Environment(\.dismiss) private var dismiss

    /// A piece on a bill, with the bill it is on.
    private struct Line: Identifiable {
        let id: String
        let invoiceId: String
        let item: InvoiceItem
    }

    private var lines: [Line] {
        var out: [Line] = []
        for inv in invoices {
            for (i, item) in inv.items.enumerated() {
                out.append(Line(id: "\(inv.id)-\(i)", invoiceId: inv.id, item: item))
            }
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
                } header: {
                    Text(AnaDate.longDay(AnaDate.parseISO(day.date) ?? Date()))
                } footer: {
                    Text("Orders and extra revenue are in the totals; the lists are the invoices written this day.")
                }
                Section("Invoices") {
                    if invoices.isEmpty {
                        Text("No invoices on this day.").foregroundStyle(.secondary)
                    } else {
                        ForEach(invoices) { (inv: Invoice) in
                            TwoLine(title: inv.id, subtitle: inv.customerName, trailing: Money.lacCrore(invoiceSaleValue(inv)))
                        }
                    }
                }
                Section("Products sold") {
                    if lines.isEmpty {
                        Text("No pieces sold on this day.").foregroundStyle(.secondary)
                    } else {
                        ForEach(lines) { (l: Line) in
                            TwoLine(title: l.item.name, subtitle: l.item.sku, trailing: Money.lacCrore(l.item.itemTotal))
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Daily report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
