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
        VStack(alignment: .leading, spacing: pt(6)) {
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
        #if os(macOS)
        .macChartReadout(dates: days.map { $0.plotDate }) { (at: Date) in
            let d = days.first { $0.plotDate == at }
            return ChartSummary.day(at) + ": " + Money.pkrLac(d?.sales ?? 0)
        }
        #endif
        .accessibilityLabel("Revenue each day")
        .accessibilityValue(ChartSummary.say(days.map { (label: ChartSummary.day($0.plotDate), value: $0.sales) }))
    }
}

/// Sales day by day over the period.
struct AnaSalesChart: View {
    let days: [AnaDay]

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
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
            #if os(macOS)
            .macChartReadout(dates: days.map { $0.plotDate }) { (at: Date) in
                let d = days.first { $0.plotDate == at }
                return ChartSummary.day(at) + ": " + Money.pkrLac(d?.sales ?? 0) + " · " + String(d?.orders ?? 0) + " sales"
            }
            #endif
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
        VStack(alignment: .leading, spacing: pt(6)) {
            Chart(days) { (d: AnaDay) in
                BarMark(x: .value("Day", d.plotDate, unit: .day), y: .value("Orders", d.orders))
                    .foregroundStyle(Tone.settled.color)
            }
            .frame(height: 110)
            #if os(macOS)
            .macChartReadout(dates: days.map { $0.plotDate }) { (at: Date) in
                ChartSummary.day(at) + ": " + String(days.first { $0.plotDate == at }?.orders ?? 0) + " sales"
            }
            #endif
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
        VStack(alignment: .leading, spacing: pt(6)) {
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
            #if os(macOS)
            .macChartReadout(dates: months.map { $0.plotDate }) { (at: Date) in
                let m = months.first { $0.plotDate == at }
                return (m?.label ?? "") + ": " + Money.pkrLac(m?.revenue ?? 0)
            }
            #endif
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
        VStack(alignment: .leading, spacing: pt(6)) {
            Chart(points) { (p: AnaSourcePoint) in
                LineMark(x: .value("Day", p.plotDate), y: .value("Revenue", p.amount / Money.lac), series: .value("Source", p.label))
                    .foregroundStyle(by: .value("Source", p.label))
                    .interpolationMethod(.monotone)
            }
            .frame(height: 240)
            #if os(macOS)
            .macChartReadout(dates: Array(Set(points.map { $0.plotDate })).sorted()) { (at: Date) in
                let rows = points.filter { $0.plotDate == at }.sorted { $0.amount > $1.amount }
                return ([ChartSummary.day(at)] + rows.map { $0.label + " " + Money.lacCrore($0.amount) }).joined(separator: " · ")
            }
            #endif
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

/// Each category's share of revenue (category-breakdown.tsx): a ranked list of bars in one hue, the share
/// written beside each with its revenue in lac; Uncategorized, if any, in muted grey. Not a pie: seventeen
/// slices could not be read.
struct AnaShareChart: View {
    let rows: [AnaBreakdown.CategoryRow]

    private var total: Double { rows.reduce(0) { $0 + $1.revenue } }
    private var top: Double { max(1, rows.map { $0.revenue }.max() ?? 1) }

    var body: some View {
        if rows.isEmpty {
            Text("No category revenue in this period.").font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 80)
        } else {
            VStack(spacing: pt(12)) {
                ForEach(rows) { (c: AnaBreakdown.CategoryRow) in
                    let muted = c.id == "uncategorized"
                    VStack(alignment: .leading, spacing: pt(4)) {
                        HStack(alignment: .firstTextBaseline, spacing: pt(12)) {
                            Text(c.name).font(.subheadline).lineLimit(1)
                                .foregroundStyle(muted ? Color.secondary : Color.primary)
                            Spacer(minLength: 0)
                            Text(categoryShareText(total > 0 ? c.revenue / total : 0)).font(.subheadline).monospacedDigit()
                            Text(Money.lacCrore(c.revenue)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        }
                        GeometryReader { (geo: GeometryProxy) in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.secondary.opacity(0.15))
                                Capsule().fill(muted ? Color.secondary.opacity(0.4) : Theme.accent.opacity(0.75))
                                    .frame(width: geo.size.width * CGFloat(max(0, c.revenue) / top))
                            }
                        }
                        .frame(height: 8)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(c.name), \(categoryShareText(total > 0 ? c.revenue / total : 0)) of revenue")
                    .accessibilityValue(Spoken.rupees(c.revenue, lac: true))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Share of revenue by category, largest first")
        }
    }
}
