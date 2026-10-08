import SwiftUI
import ERPCore

/// Analytics → Products (analytics-view.tsx section "products" and product-breakdown.tsx): the ten
/// pieces that earned most in the period, the sales by category, then every piece sold, searchable and
/// sorted by revenue, quantity or number of sales.
///
/// The breakdown's revenue is each piece's own total, before invoice discounts and trade-ins, so it runs
/// higher than the Overview's net figure.
struct AnaProductsPage: View {
    let figures: AnaFigures
    let rows: [AnaBreakdown.ProductRow]
    let bar: AnaPeriodBar

    private static let sorts = ["Revenue", "Quantity sold", "Number of sales"]

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
            categorySection
            allSection
        }
        .listStyle(.insetGrouped)
        .searchable(text: $search, prompt: "Search every piece by name or SKU")
    }

    // MARK: Top ten

    private var topSection: some View {
        Section {
            if figures.topProducts.isEmpty {
                Text("No product sales data available for the selected period.").foregroundStyle(.secondary)
            } else {
                ForEach(figures.topProducts) { (p: AnaTopProduct) in
                    TwoLine(title: p.name, subtitle: topLine(p), trailing: Money.lacCrore(p.revenue))
                }
            }
        } header: {
            Text("Top pieces by revenue")
        } footer: {
            Text("Top 10 for the selected period.")
        }
        .houseRows()
    }

    /// "SKU: R-104 · Qty 2", or "Not in stock" for a piece described for one bill.
    private func topLine(_ p: AnaTopProduct) -> String {
        let sku = AnaSku.isStock(p.sku) ? "SKU: " + p.sku : "Not in stock"
        return sku + " · Qty " + AnaFormat.count(p.quantity)
    }

    // MARK: Sales by category

    @ViewBuilder private var categorySection: some View {
        let sold = figures.salesByCategory.filter { (c: AnaCategorySale) -> Bool in c.sales > 0 }
        Section {
            if sold.isEmpty {
                Text("No category sales data available for the selected period.").foregroundStyle(.secondary)
            } else {
                AnaBarChart(bars: sold.map { (c: AnaCategorySale) -> AnaBar in AnaBar(id: c.categoryId, label: c.name, value: c.sales) })
            }
            NavigationLink(value: Route(path: "/analytics/categories")) {
                Label("Sales by category in detail", systemImage: "chart.pie")
            }
        } header: {
            Text("Sales by category")
        } footer: {
            Text("Revenue distribution for the selected period.")
        }
        .houseRows()
    }

    // MARK: Every piece

    private var shown: [AnaBreakdown.ProductRow] {
        let term = search.trimmingCharacters(in: .whitespaces).lowercased()
        let matched: [AnaBreakdown.ProductRow] = term.isEmpty ? rows : rows.filter { (p: AnaBreakdown.ProductRow) -> Bool in
            p.name.lowercased().contains(term) || p.sku.lowercased().contains(term)
        }
        switch sort {
        case 1: return AnaSort.descending(matched) { (p: AnaBreakdown.ProductRow) -> Double in p.quantity }
        case 2: return AnaSort.descending(matched) { (p: AnaBreakdown.ProductRow) -> Double in Double(p.orders) }
        default: return AnaSort.descending(matched) { (p: AnaBreakdown.ProductRow) -> Double in p.revenue }
        }
    }

    /// "R-104 · Qty 3 · 2 sales".
    private func rowLine(_ p: AnaBreakdown.ProductRow) -> String {
        let sales = String(p.orders) + " " + AnaFormat.plural(p.orders, "sale", "sales")
        return p.sku + " · Qty " + AnaFormat.count(p.quantity) + " · " + sales
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
                Text("No pieces sold in this period.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { (p: AnaBreakdown.ProductRow) in
                    TwoLine(title: p.name, subtitle: rowLine(p), trailing: Money.lacCrore(p.revenue))
                }
            }
        } header: {
            Text("Every piece sold")
        } footer: {
            Text("Revenue here is each piece’s own total, before invoice discounts and trade-ins, so it runs higher than the Overview’s net figure.")
        }
        .houseRows()
    }
}
