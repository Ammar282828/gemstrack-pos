import SwiftUI
import Charts
import ERPCore

// The charts, kept simple: Swift Charts' default axes, with the amounts drawn in lac so the axis
// numbers stay short (every exact figure is also a row on its page). The web's own charts are
// recharts; their dual axis (sales against orders) is two charts here.

/// One bar of a horizontal bar chart; `value` is in rupees.
struct AnaBar: Identifiable {
    let id: String
    let label: String
    let value: Double
}

/// A category against its amount, bars lying down (expenses by category, sales by category).
struct AnaBarChart: View {
    let bars: [AnaBar]
    var tint: Color = Theme.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Chart(bars) { (b: AnaBar) in
                BarMark(x: .value("Amount", b.value / Money.lac), y: .value("Name", b.label))
                    .foregroundStyle(tint)
            }
            .frame(height: CGFloat(bars.count) * 28 + 36)
            .accessibilityLabel("Amount by name")
            .accessibilityValue(ChartSummary.say(bars.map { (label: $0.label, value: $0.value) }))
            Text("PKR lac")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// The same quiet bar treatment as Home, with daily figures still available in Sales.
struct AnaRevenueBars: View {
    let days: [AnaDay]
    var body: some View {
        Chart(days) { day in
            BarMark(x: .value("Day", day.plotDate, unit: .day), y: .value("Revenue", day.sales / Money.lac))
                .foregroundStyle(Theme.accent.gradient)
                .cornerRadius(3)
        }
        .frame(height: 190)
        .chartYAxisLabel("PKR lac")
        .accessibilityLabel("Revenue each day")
        .accessibilityValue(ChartSummary.say(days.map { (label: ChartSummary.day($0.plotDate), value: $0.sales) }))
    }
}

/// Sales day by day over the period.
struct AnaSalesChart: View {
    let days: [AnaDay]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Chart(days) { (d: AnaDay) in
                AreaMark(x: .value("Day", d.plotDate), y: .value("Sales", d.sales / Money.lac))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Theme.accent.opacity(0.18))
                LineMark(x: .value("Day", d.plotDate), y: .value("Sales", d.sales / Money.lac))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Theme.accent)
                if days.count < 3 {
                    PointMark(x: .value("Day", d.plotDate), y: .value("Sales", d.sales / Money.lac))
                        .foregroundStyle(Theme.accent)
                }
            }
            .frame(height: 200)
            .accessibilityLabel("Sales each day over the period")
            .accessibilityValue(ChartSummary.say(days.map { (label: ChartSummary.day($0.plotDate), value: $0.sales) }))
            Text("Sales, PKR lac")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// The number of sales each day, under the sales line.
struct AnaOrdersChart: View {
    let days: [AnaDay]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Chart(days) { (d: AnaDay) in
                BarMark(x: .value("Day", d.plotDate, unit: .day), y: .value("Orders", d.orders))
                    .foregroundStyle(Tone.settled.color)
            }
            .frame(height: 110)
            .accessibilityLabel("Orders each day over the period")
            .accessibilityValue(ChartSummary.say(days.map { (label: ChartSummary.day($0.plotDate), value: Double($0.orders)) }, money: false))
            Text("Orders")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// Revenue for every month on record; the best month is picked out, the average is the dashed line.
struct AnaMonthlyChart: View {
    let months: [AnaMonth]
    let average: Double
    let best: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Chart {
                ForEach(months) { (m: AnaMonth) in
                    BarMark(x: .value("Month", m.plotDate, unit: .month), y: .value("Revenue", m.revenue / Money.lac))
                        .foregroundStyle(m.key == best ? Tone.settled.color : Theme.accent)
                }
                RuleMark(y: .value("Average", average / Money.lac))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(.secondary)
            }
            .frame(height: 220)
            .accessibilityLabel("Revenue for each month on record")
            .accessibilityValue(ChartSummary.say(months.map { (label: $0.label, value: $0.revenue) }) + ". Average " + Spoken.rupees(average, lac: true))
            Text("Revenue, PKR lac. Dashed line: the average of months with sales.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// Where revenue comes from, one line per source, day by day.
struct AnaSourceTrendChart: View {
    let points: [AnaSourcePoint]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Chart(points) { (p: AnaSourcePoint) in
                LineMark(x: .value("Day", p.plotDate), y: .value("Revenue", p.amount / Money.lac), series: .value("Source", p.label))
                    .foregroundStyle(by: .value("Source", p.label))
                    .interpolationMethod(.monotone)
            }
            .frame(height: 240)
            .accessibilityLabel("Revenue by source each day")
            .accessibilityValue(Dictionary(grouping: points, by: { $0.label }).map { (name: String, rows: [AnaSourcePoint]) -> String in
                "\(name), \(Spoken.rupees(rows.reduce(0) { $0 + $1.amount }, lac: true))"
            }.sorted().joined(separator: ". "))
            Text("PKR lac")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// Each category's share of revenue.
struct AnaShareChart: View {
    let rows: [AnaBreakdown.CategoryRow]

    /// A share is of what came in: a category at nothing (or below, after returns) has no slice.
    private var slices: [AnaBreakdown.CategoryRow] { rows.filter { $0.revenue > 0 } }

    var body: some View {
        if slices.isEmpty {
            Text("No category revenue in this period.").font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 80)
        } else {
            Chart(slices) { (c: AnaBreakdown.CategoryRow) in
                SectorMark(angle: .value("Revenue", c.revenue), innerRadius: .ratio(0.55), angularInset: 1.5)
                    .foregroundStyle(by: .value("Category", c.name))
            }
            .frame(height: 280)
            .accessibilityLabel("Share of revenue by category")
            .accessibilityValue(slices.map { "\($0.name), \(Spoken.rupees($0.revenue, lac: true))" }.joined(separator: ". "))
        }
    }
}
