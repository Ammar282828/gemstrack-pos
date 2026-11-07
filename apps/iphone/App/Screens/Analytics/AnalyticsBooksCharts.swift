import SwiftUI
import Charts
import ERPCore

// The redesigned Analytics' charts (components/analytics/charts.tsx): one y-axis, never two (two measures, two charts);
// the six series colours in a fixed order (AbPalette), good and bad in the tones only; thin marks; a read-out on every
// chart: a rule and a tooltip along time, a line of words under a ranked or stepped one. An Overview card is itself a
// link, so its picture there only looks (`interactive: false`); the page it opens has the full read-out.

/// A small floating card for a chart's tooltip.
private struct AbTip<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 2) { content() }
            .padding(8)
            .background(Theme.elevated, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).strokeBorder(Color.secondary.opacity(0.2), lineWidth: 0.5)
            }
            .fixedSize()
    }
}

/// The words under a chart that says what is selected (or what to do to select).
private struct AbReadout: View {
    let text: String?
    let hint: String

    var body: some View {
        Text(text ?? hint)
            .font(.house(.footnote))
            .foregroundStyle(text == nil ? Color.secondary : Color.primary)
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Revenue over time

/// Revenue by day, week or month as an area under a line, the period before dashed on the same axis.
struct AbTrend: View {
    let rows: [ComparedRow]
    var bucket: BooksBucket = .day
    var showPrev = false
    var height: CGFloat = 200
    var interactive = true
    @State private var picked: Date?

    private func plot(_ r: ComparedRow) -> Date { AbPlot.bucket(r.start, bucket) }

    private var selected: ComparedRow? {
        guard let picked else { return nil }
        return rows.min { (a: ComparedRow, b: ComparedRow) -> Bool in
            abs(plot(a).timeIntervalSince(picked)) < abs(plot(b).timeIntervalSince(picked))
        }
    }

    private var axisFormat: Date.FormatStyle {
        bucket == .month ? .dateTime.month(.abbreviated).year(.twoDigits) : .dateTime.month(.abbreviated).day()
    }

    var body: some View {
        Chart {
            ForEach(rows) { (r: ComparedRow) in
                AreaMark(x: .value("Date", plot(r)), y: .value("Revenue", r.value / Money.lac))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(AbPalette.color(1).opacity(0.15))
                LineMark(x: .value("Date", plot(r)), y: .value("Revenue", r.value / Money.lac), series: .value("Series", "Now"))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(AbPalette.color(1))
                    .lineStyle(StrokeStyle(lineWidth: 2))
                if rows.count < 3 {
                    PointMark(x: .value("Date", plot(r)), y: .value("Revenue", r.value / Money.lac))
                        .foregroundStyle(AbPalette.color(1))
                }
                if showPrev, let p = r.prev {
                    LineMark(x: .value("Date", plot(r)), y: .value("Revenue", p / Money.lac), series: .value("Series", "Before"))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                }
            }
            if let s = selected {
                RuleMark(x: .value("Selected", plot(s)))
                    .foregroundStyle(Color.secondary.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tip(s)
                    }
            }
        }
        .chartXSelection(value: interactive ? $picked : Binding<Date?>.constant(nil))
        .chartYAxisLabel("PKR lac", position: .top, alignment: .leading)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                AxisGridLine()
                AxisTick()
                AxisValueLabel(format: axisFormat)
            }
        }
        .frame(height: height)
        .allowsHitTesting(interactive)
        .accessibilityLabel("Revenue over time")
        .accessibilityValue(ChartSummary.say(rows.map { (label: $0.tip, value: $0.value) }))
    }

    private func tip(_ r: ComparedRow) -> some View {
        AbTip {
            Text(r.tip).font(.house(.caption).weight(.semibold))
            Text(Money.pkrLac(r.value)).font(.house(.caption)).monospacedDigit()
            if showPrev, let p = r.prev {
                Text(Money.pkrLac(p) + " before").font(.house(.caption2)).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }
}

// MARK: Months, grouped or stacked

/// One bar (or one point of the line) of `AbBars`: a series' value in a month or a day.
struct AbBarPoint: Identifiable {
    let id: String
    /// Where the chart draws it (`AbPlot`).
    let plot: Date
    /// The tooltip's title: "Nov 26".
    let tip: String
    let series: String
    let value: Double
}

struct AbSeries {
    let name: String
    let color: Color
}

/// Bars by month for one or more series, side by side (`grouped`) or stacked, with one optional line over them on the
/// same axis. `divisor` and `unit` say what the axis counts (rupees in lac; tola for the metal).
struct AbBars: View {
    let points: [AbBarPoint]
    let series: [AbSeries]
    var line: AbSeries?
    var grouped = true
    var unit: Calendar.Component = .month
    var divisor: Double = Money.lac
    var axisLabel = "PKR lac"
    var format: (Double) -> String = { (v: Double) -> String in Money.pkrLac(v) }
    var height: CGFloat = 260
    @State private var picked: Date?

    private var barPoints: [AbBarPoint] { points.filter { (p: AbBarPoint) -> Bool in p.series != line?.name } }
    private var linePoints: [AbBarPoint] { points.filter { (p: AbBarPoint) -> Bool in p.series == line?.name } }
    private var names: [String] { series.map { (s: AbSeries) -> String in s.name } + (line.map { [$0.name] } ?? []) }
    private var colors: [Color] { series.map { (s: AbSeries) -> Color in s.color } + (line.map { [$0.color] } ?? []) }

    /// The plotted date nearest the finger.
    private var selectedDate: Date? {
        guard let picked else { return nil }
        let dates = Array(Set(points.map { (p: AbBarPoint) -> Date in p.plot }))
        return dates.min { (a: Date, b: Date) -> Bool in abs(a.timeIntervalSince(picked)) < abs(b.timeIntervalSince(picked)) }
    }

    var body: some View {
        Chart {
            ForEach(barPoints) { (p: AbBarPoint) in
                if grouped {
                    BarMark(x: .value("When", p.plot, unit: unit), y: .value("Amount", p.value / divisor))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", p.series))
                } else {
                    BarMark(x: .value("When", p.plot, unit: unit), y: .value("Amount", p.value / divisor))
                        .foregroundStyle(by: .value("Series", p.series))
                }
            }
            ForEach(linePoints) { (p: AbBarPoint) in
                LineMark(x: .value("When", p.plot), y: .value("Amount", p.value / divisor), series: .value("Series", p.series))
                    .foregroundStyle(by: .value("Series", p.series))
                    .lineStyle(StrokeStyle(lineWidth: 2))
                PointMark(x: .value("When", p.plot), y: .value("Amount", p.value / divisor))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbolSize(24)
            }
            if let at = selectedDate {
                RuleMark(x: .value("Selected", at))
                    .foregroundStyle(Color.secondary.opacity(0.35))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tip(at)
                    }
            }
        }
        .chartForegroundStyleScale(domain: names, range: colors)
        .chartXSelection(value: $picked)
        .chartYAxisLabel(axisLabel, position: .top, alignment: .leading)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { _ in
                AxisGridLine()
                AxisTick()
                AxisValueLabel(format: .dateTime.month(.abbreviated))
            }
        }
        .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Chart by month")
        .accessibilityValue(summary)
    }

    private func tip(_ at: Date) -> some View {
        let here = points.filter { (p: AbBarPoint) -> Bool in p.plot == at }
        return AbTip {
            Text(here.first?.tip ?? "").font(.house(.caption).weight(.semibold))
            ForEach(names, id: \.self) { (name: String) in
                if let p = here.first(where: { (q: AbBarPoint) -> Bool in q.series == name }) {
                    Text(name + ": " + format(p.value)).font(.house(.caption)).monospacedDigit()
                }
            }
        }
    }

    private var summary: String {
        let months = Array(Set(points.map { (p: AbBarPoint) -> String in p.tip }))
        return "\(months.count) periods. " + names.joined(separator: ", ")
    }
}

// MARK: The waterfall

/// One step of a waterfall: a total stands on zero, a change hangs off the running figure.
struct AbStep: Identifiable {
    let label: String
    let value: Double
    let total: Bool
    var id: String { label }
}

struct AbWaterfall: View {
    let steps: [AbStep]
    var height: CGFloat = 240
    var interactive = true
    @State private var picked: String?

    private struct Bar: Identifiable {
        let id: String
        let step: AbStep
        let from: Double
        let to: Double
    }

    private var bars: [Bar] {
        var running = 0.0
        var out: [Bar] = []
        for s in steps {
            if s.total {
                out.append(Bar(id: s.label, step: s, from: 0, to: s.value))
                running = s.value
            } else {
                out.append(Bar(id: s.label, step: s, from: running, to: running + s.value))
                running += s.value
            }
        }
        return out
    }

    /// Revenue in the house's colour, a profit total in good or bad, a cost that came off in bad: tones, not a rank.
    private func color(_ s: AbStep, first: Bool) -> Color {
        if !s.total { return Tone.late.color.opacity(0.7) }
        if first { return Theme.accent }
        return s.value >= 0 ? Tone.settled.color : Tone.late.color
    }

    private var readout: String? {
        guard let picked, let s = steps.first(where: { (x: AbStep) -> Bool in x.label == picked }) else { return nil }
        return s.label + ": " + (s.total ? Money.pkrLac(s.value) : AbSay.signed(s.value))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Chart {
                RuleMark(y: .value("Zero", 0.0))
                    .foregroundStyle(Color.secondary.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 0.5))
                ForEach(Array(bars.enumerated()), id: \.element.id) { i, b in
                    BarMark(x: .value("Step", b.step.label), yStart: .value("From", b.from / Money.lac), yEnd: .value("To", b.to / Money.lac))
                        .foregroundStyle(color(b.step, first: i == 0))
                        .opacity(picked == nil || picked == b.step.label ? 1 : 0.45)
                        .cornerRadius(3, style: .continuous)
                }
            }
            .chartXSelection(value: interactive ? $picked : Binding<String?>.constant(nil))
            .chartYAxisLabel("PKR lac", position: .top, alignment: .leading)
            .frame(height: height)
            .allowsHitTesting(interactive)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("From revenue to profit")
            .accessibilityValue(steps.map { (s: AbStep) -> String in s.label + " " + Money.pkrLac(s.value) }.joined(separator: ". "))
            if interactive { AbReadout(text: readout, hint: "Touch a bar to read it.") }
        }
    }
}

// MARK: Ranked bars

/// One bar of a ranked list: a name, its figure in rupees (or the page's own unit), a colour and an optional chip.
struct AbHBar: Identifiable {
    let id: String
    let label: String
    let value: Double
    /// The figure as the page says it ("PKR 1.2 lac").
    let valueText: String
    var color: Color = Theme.accent
    var chip: String?
}

struct AbHBars: View {
    let rows: [AbHBar]
    /// What `value` is divided by for the axis: lac for rupees, 1 for counts.
    var divisor: Double = Money.lac
    var interactive = true
    var rowHeight: CGFloat = 34
    @State private var picked: String?

    private struct Shown: Identifiable {
        let row: AbHBar
        let name: String
        var id: String { row.id }
    }

    /// Two pieces with one name stay two bars: the chart keys a bar by its name.
    private var shown: [Shown] {
        var seen: [String: Int] = [:]
        var out: [Shown] = []
        for r in rows {
            let n = (seen[r.label] ?? 0) + 1
            seen[r.label] = n
            out.append(Shown(row: r, name: n == 1 ? r.label : r.label + " (\(n))"))
        }
        return out
    }

    private var top: Double { max(rows.map { (r: AbHBar) -> Double in r.value }.max() ?? 1, 0.0001) }

    private var readout: String? {
        guard let picked, let hit = shown.first(where: { (e: Shown) -> Bool in e.name == picked }) else { return nil }
        return hit.name + " · " + hit.row.valueText + (hit.row.chip.map { " · " + $0 } ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Chart {
                ForEach(shown) { (e: Shown) in
                    BarMark(x: .value("Amount", e.row.value / divisor), y: .value("Name", e.name))
                        .foregroundStyle(e.row.color)
                        .opacity(picked == nil || picked == e.name ? 1 : 0.45)
                        .cornerRadius(3, style: .continuous)
                        .annotation(position: .trailing, spacing: 4) {
                            Text(e.row.valueText + (e.row.chip.map { " · " + $0 } ?? ""))
                                .font(.house(.caption2))
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .fixedSize()
                        }
                }
            }
            .chartYSelection(value: interactive ? $picked : Binding<String?>.constant(nil))
            // Room right of the longest bar for its figure.
            .chartXScale(domain: 0...(top / divisor * 1.6))
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .leading) { _ in AxisValueLabel() }
            }
            .frame(height: CGFloat(max(rows.count, 1)) * rowHeight + 8)
            .allowsHitTesting(interactive)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Ranked bars")
            .accessibilityValue(rows.map { (r: AbHBar) -> String in r.label + " " + r.valueText }.joined(separator: ". "))
            if interactive { AbReadout(text: readout, hint: "Touch a bar to read it.") }
        }
    }
}

// MARK: One bar of shares

/// A part of a whole: its name, figure and colour.
struct AbPart: Identifiable {
    let id: String
    let label: String
    let value: Double
    let color: Color
}

/// The parts of one whole as one bar, with a row for each under it (name, figure, share). A bar that has no room for a
/// legend of its own is the web's `StackedBar100`.
struct AbStack: View {
    let parts: [AbPart]
    /// How a figure reads (rupees by default; a count, a tola).
    var format: (Double) -> String = { (v: Double) -> String in Money.lacCrore(v) }
    /// The rows under the bar; off for a card too small to hold them.
    var legend = true
    var barHeight: CGFloat = 14
    var interactive = true
    @State private var picked: String?

    private var shown: [AbPart] { parts.filter { (p: AbPart) -> Bool in p.value > 0 } }
    private var total: Double { shown.reduce(0) { $0 + $1.value } }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            if shown.isEmpty {
                Text("Nothing in this period.").font(.house(.footnote)).foregroundStyle(.secondary)
            } else {
                GeometryReader { (geo: GeometryProxy) in
                    HStack(spacing: 2) {
                        ForEach(shown) { (p: AbPart) in
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(p.color)
                                .opacity(picked == nil || picked == p.id ? 1 : 0.4)
                                .frame(width: max(2, (geo.size.width - CGFloat(shown.count - 1) * 2) * CGFloat(p.value / total)))
                                .contentShape(Rectangle())
                                .onTapGesture { if interactive { picked = picked == p.id ? nil : p.id } }
                        }
                    }
                }
                .frame(height: barHeight)
                .accessibilityHidden(true)
                if legend {
                    ForEach(shown) { (p: AbPart) in
                        HStack(spacing: pt(8)) {
                            Circle().fill(p.color).frame(width: 8, height: 8).accessibilityHidden(true)
                            Text(p.label).font(.house(.footnote)).foregroundStyle(.secondary)
                            Spacer(minLength: pt(8))
                            Text(format(p.value)).font(.house(.footnote).weight(picked == p.id ? .semibold : .medium)).monospacedDigit()
                            Text(String(AbSay.percent(p.value, total)) + "%").font(.house(.footnote)).foregroundStyle(.secondary).monospacedDigit()
                                .frame(minWidth: 34, alignment: .trailing)
                        }
                        .accessibilityElement(children: .combine)
                    }
                } else if let hit = shown.first(where: { (p: AbPart) -> Bool in p.id == picked }) {
                    AbReadout(text: hit.label + " " + format(hit.value), hint: "")
                }
            }
        }
    }
}

// MARK: A measure by category (weekdays)

/// One bar per name along the bottom (the weekdays), the average of each.
struct AbColumns: View {
    struct Column: Identifiable {
        let id: String
        let label: String
        let value: Double
        let detail: String
    }

    let columns: [Column]
    var height: CGFloat = 200
    var average: Double?
    @State private var picked: String?

    private var readout: String? {
        guard let picked, let c = columns.first(where: { (x: Column) -> Bool in x.id == picked }) else { return nil }
        return c.label + ": " + c.detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Chart {
                ForEach(columns) { (c: Column) in
                    BarMark(x: .value("Name", c.label), y: .value("Amount", c.value / Money.lac))
                        .foregroundStyle(AbPalette.color(1))
                        .opacity(picked == nil || picked == c.id ? 1 : 0.45)
                        .cornerRadius(3, style: .continuous)
                }
                if let average {
                    RuleMark(y: .value("Average", average / Money.lac))
                        .foregroundStyle(Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
            }
            .chartXSelection(value: $picked)
            .chartYAxisLabel("PKR lac", position: .top, alignment: .leading)
            .frame(height: height)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Average revenue by weekday")
            .accessibilityValue(columns.map { (c: Column) -> String in c.label + " " + c.detail }.joined(separator: ". "))
            AbReadout(text: readout, hint: "Touch a bar to read it.")
        }
    }
}
