import SwiftUI
import ERPCore

/// Analytics → Categories (category-breakdown.tsx): revenue, pieces and sales per category in the
/// period, and each one's share of the revenue. Revenue is gross line-item revenue, before invoice
/// discounts and trade-ins.
struct AnaCategoriesPage: View {
    let rows: [AnaBreakdown.CategoryRow]
    let bar: AnaPeriodBar

    var body: some View {
        List {
            Section {
                bar
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if rows.isEmpty {
                Section {
                    Text("No category sales data for the selected period.").foregroundStyle(.secondary)
                }
                .houseRows()
            } else {
                shareSection
                tableSection
            }
            LedgerSection("About these figures", collapsible: true) {
                Text("Revenue is before invoice discounts and trade-ins, so it can be higher than Overview.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
    }

    private var tableSection: some View {
        Section {
            ForEach(rows) { (c: AnaBreakdown.CategoryRow) in
                TwoLine(title: c.name, subtitle: line(c), trailing: Money.lacCrore(c.revenue))
            }
        } header: {
            LedgerHeading(title: "By category")
        }
        .houseRows()
    }

    /// "12 pieces · 9 sales".
    private func line(_ c: AnaBreakdown.CategoryRow) -> String {
        let pieces = AnaFormat.count(c.itemsSold) + " " + (c.itemsSold == 1 ? "piece" : "pieces")
        let sales = String(c.orders) + " " + AnaFormat.plural(c.orders, "sale", "sales")
        return pieces + " · " + sales
    }

    private var shareSection: some View {
        Section {
            AnaShareChart(rows: rows)
        } header: {
            LedgerHeading(title: "Share of revenue")
        }
        .houseRows()
    }
}
