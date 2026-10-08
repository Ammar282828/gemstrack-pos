import SwiftUI
import ERPCore

/// Analytics → Customers (analytics-view.tsx section "customers" and customer-breakdown.tsx): the ten
/// who spent most in the period, where revenue comes from by how the customer found the shop, then
/// everyone who bought, searchable and sorted by spending, number of sales or average sale. Every
/// walk-in is the one row (walk-in.ts).
struct AnaCustomersPage: View {
    let figures: AnaFigures
    let rows: [AnaBreakdown.CustomerRow]
    let bar: AnaPeriodBar

    private static let sorts = ["Spending", "Number of sales", "Average sale"]

    @State private var search = ""
    @State private var sort = 0

    var body: some View {
        List {
            Section {
                bar
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            topSection
            sourceSection
            allSection
        }
        .listStyle(.insetGrouped)
        .searchable(text: $search, prompt: "Search everyone by name")
    }

    // MARK: Top ten

    private var topSection: some View {
        Section {
            if figures.topCustomers.isEmpty {
                Text("No customer sales data available for the selected period.").foregroundStyle(.secondary)
            } else {
                ForEach(figures.topCustomers) { (c: AnaTopCustomer) in
                    topRow(c)
                }
            }
        } header: {
            Text("Top customers by sales")
        } footer: {
            Text("Top 10 for the selected period.")
        }
        .houseRows()
    }

    @ViewBuilder private func topRow(_ c: AnaTopCustomer) -> some View {
        let subtitle = String(c.orderCount) + " " + AnaFormat.plural(c.orderCount, "order", "orders")
        if let id = c.customerId {
            NavigationLink(value: Route(path: AnaPath.customer(id))) {
                TwoLine(title: c.name, subtitle: subtitle, trailing: Money.lacCrore(c.totalSpent))
            }
        } else {
            TwoLine(title: c.name, subtitle: subtitle, trailing: Money.lacCrore(c.totalSpent))
        }
    }

    // MARK: Acquisition source

    /// Where revenue comes from by how the customer found the store. A sale's source is its own
    /// override first, then the linked customer's saved one; sales with neither are Unclassified.
    @ViewBuilder private var sourceSection: some View {
        let sources = figures.sourceBreakdown
        Section {
            if sources.isEmpty {
                Text("No acquisition-source data available for the selected period.").foregroundStyle(.secondary)
            } else {
                // Share is of the source-attributed revenue (not of the total, which also holds extra
                // revenue that has no source), so the column adds up to 100%.
                let total = sources.reduce(0.0) { (sum: Double, s: AnaSourceRow) -> Double in sum + s.revenue }
                ForEach(sources) { (s: AnaSourceRow) in
                    TwoLine(title: s.label, subtitle: sourceLine(s, total), trailing: Money.lacCrore(s.revenue))
                }
                if !figures.sourceTrend.isEmpty {
                    AnaSourceTrendChart(points: figures.sourceTrend)
                }
            }
        } header: {
            Text("Acquisition source insights")
        } footer: {
            Text("Where revenue comes from by how the customer found the store: walk-in, referral, Taheri spillover and other. Sales with no source on the sale or on the customer are Unclassified.")
        }
        .houseRows()
    }

    /// "4 sales · 38.2% · avg 1.1 lac".
    private func sourceLine(_ s: AnaSourceRow, _ total: Double) -> String {
        let share = total > 0 ? s.revenue / total * 100 : 0
        let sales = String(s.orderCount) + " " + AnaFormat.plural(s.orderCount, "sale", "sales")
        return sales + " · " + AnaFormat.fixed(share, 1) + "% · avg " + Money.lacCrore(s.avgOrderValue)
    }

    // MARK: Everyone

    private var shown: [AnaBreakdown.CustomerRow] {
        let term = search.trimmingCharacters(in: .whitespaces).lowercased()
        let matched: [AnaBreakdown.CustomerRow] = term.isEmpty ? rows : rows.filter { (c: AnaBreakdown.CustomerRow) -> Bool in
            c.name.lowercased().contains(term)
        }
        switch sort {
        case 1: return AnaSort.descending(matched) { (c: AnaBreakdown.CustomerRow) -> Double in Double(c.orderCount) }
        case 2: return AnaSort.descending(matched) { (c: AnaBreakdown.CustomerRow) -> Double in c.averageSpent }
        default: return AnaSort.descending(matched) { (c: AnaBreakdown.CustomerRow) -> Double in c.totalSpent }
        }
    }

    @ViewBuilder private var allSection: some View {
        let list = shown
        Section {
            AnaSortChips(titles: Self.sorts, selected: sort) { (i: Int) in sort = i }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
        Section {
            if list.isEmpty {
                Text("No customer data for this period.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { (c: AnaBreakdown.CustomerRow) in
                    row(c)
                }
            }
        } header: {
            Text("Everyone who bought")
        }
        .houseRows()
    }

    /// "3 sales · 7 pieces · average 1.2 lac".
    private func rowLine(_ c: AnaBreakdown.CustomerRow) -> String {
        let sales = String(c.orderCount) + " " + AnaFormat.plural(c.orderCount, "sale", "sales")
        let pieces = AnaFormat.count(c.itemsPurchased) + " " + (c.itemsPurchased == 1 ? "piece" : "pieces")
        return sales + " · " + pieces + " · average " + Money.lacCrore(c.averageSpent)
    }

    @ViewBuilder private func row(_ c: AnaBreakdown.CustomerRow) -> some View {
        if let id = c.customerId {
            NavigationLink(value: Route(path: AnaPath.customer(id))) {
                TwoLine(title: c.name, subtitle: rowLine(c), trailing: Money.lacCrore(c.totalSpent))
            }
        } else {
            TwoLine(title: c.name, subtitle: rowLine(c), trailing: Money.lacCrore(c.totalSpent))
        }
    }
}
