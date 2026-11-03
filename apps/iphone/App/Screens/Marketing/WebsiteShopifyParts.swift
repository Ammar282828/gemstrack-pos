import SwiftUI
import Charts
import ERPCore

/// The blocks Shopify's Visitors and Live share (WebsiteShopifyVisitors.swift, WebsiteShopifyLive.swift): the section gate, the
/// card that says which scope to grant, figure tiles, ranked rows with bars, the funnel and the charts. Each is a `SiteBlock`,
/// so it is a List section on a phone and a card in a column on an iPad's or a Mac's wide window.

// MARK: Gate and grant card

/// A section's content when there is data. A scope not granted draws nothing here (one card at the top says what to grant);
/// a section Shopify failed to answer says so in its own block.
struct ShopGate<T: Decodable, Content: View>: View {
    let title: String
    let section: ShopSection<T>
    @ViewBuilder let content: (T) -> Content

    var body: some View {
        switch section {
        case .ready(let d):
            content(d)
        case .failed(let message):
            SiteBlock(title: title) {
                Text("Shopify did not answer this one: " + message)
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        case .missingScope:
            EmptyView()
        case .absent:
            EmptyView()
        }
    }
}

/// "Grant read_reports in Shopify", with the steps. Owners see it where a section came back without its scope.
struct ShopGrantCard: View {
    let missing: ShopMissing

    private var why: String {
        missing.scope == "read_orders"
            ? "Without it the orders and checkouts of the last half hour stay empty."
            : "Without it Shopify\u{2019}s sessions, sales and sources stay empty here."
    }

    private var steps: [String] {
        [
            "In the Shopify admin, open Settings, then Apps and sales channels, then Develop apps (or the app in the Dev Dashboard).",
            "Open the app\u{2019}s Configuration, then Admin API access scopes.",
            "Tick \(missing.scope) and save.",
            "Install the app again, so Shopify hands the ERP the new token."
        ]
    }

    var body: some View {
        SiteBlock(title: "Grant \(missing.scope) in Shopify") {
            VStack(alignment: .leading, spacing: pt(10)) {
                Label {
                    Text(why).font(.subheadline).foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "key.horizontal").foregroundStyle(.secondary)
                }
                ForEach(Array(steps.enumerated()), id: \.element) { (i: Int, step: String) in
                    HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
                        Text("\(i + 1).").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        Text(step).font(.subheadline)
                    }
                }
                if let note = missing.note, !note.isEmpty {
                    Text(note).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: Figures

/// The tiles of one section: a List row of the grid on a phone, the grid itself on a wide window.
struct ShopFigureBlock<Content: View>: View {
    var title: String?
    @ViewBuilder let content: () -> Content
    @Environment(\.siteWide) private var wide

    var body: some View {
        if wide {
            FigureGrid { content() }
        } else {
            Section {
                FigureGrid { content() }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } header: {
                if let title { LedgerHeading(title: title) }
            }
        }
    }
}

// MARK: Ranked rows

/// One line of a ranked list, its value already said.
struct ShopRankRow: Identifiable {
    let id: String
    var lead: String?
    let label: String
    var sub: String?
    let value: Double
    let text: String
}

enum ShopRanks {
    /// Shopify's rows as ranked rows: the flag of a place (`lead`), a second line (`sub`), money or a count.
    static func rows(_ list: [ShopListRow], currency: String, money: Bool = false, lead: Bool = false,
                     label: ((ShopListRow) -> String)? = nil, sub: ((ShopListRow) -> String?)? = nil) -> [ShopRankRow] {
        list.enumerated().map { (e: (offset: Int, element: ShopListRow)) -> ShopRankRow in
            let r = e.element
            return ShopRankRow(id: "\(e.offset)|\(r.key)",
                               lead: lead ? SiteWords.flag(r.code) : nil,
                               label: label?(r) ?? r.label,
                               sub: sub?(r),
                               value: r.value,
                               text: money ? ShopWords.money(r.value, currency) : ShopWords.number(r.value))
        }
    }
}

/// A block of ranked rows with a bar under each: the first few, then "Show all".
struct ShopRankSection: View {
    let title: String
    let rows: [ShopRankRow]
    var note: String?
    var empty: String
    var show = 5

    @State private var all = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        SiteBlock(title: title, note: note) { content }
    }

    @ViewBuilder private var content: some View {
        if rows.isEmpty {
            Text(empty).font(.subheadline).foregroundStyle(.secondary)
        } else {
            ForEach(all ? rows : Array(rows.prefix(show))) { (r: ShopRankRow) in
                rowBody(r)
            }
            if rows.count > show {
                Button(all ? "Show fewer" : "Show all \(rows.count)") {
                    Motion.run(reduce: reduceMotion) { all.toggle() }
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private func rowBody(_ row: ShopRankRow) -> some View {
        let sum = rows.reduce(0.0) { (n: Double, r: ShopRankRow) in n + r.value }
        let share = sum > 0 ? row.value / sum : 0
        let top = Swift.max(1, rows.map { (r: ShopRankRow) in r.value }.max() ?? 1)
        return VStack(alignment: .leading, spacing: pt(6)) {
            AdaptiveStack(spacing: pt(8)) {
                HStack(spacing: pt(6)) {
                    if let lead = row.lead { Text(lead).accessibilityHidden(true) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.label)
                        if let sub = row.sub {
                            Text(sub).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 8)
                HStack(spacing: pt(6)) {
                    Text(row.text).monospacedDigit()
                        .contentTransition(.numericText(value: row.value))
                    Text(SiteWords.pct(share)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            ProgressView(value: Swift.max(0, Swift.min(row.value, top)), total: top)
                .tint(Theme.accent)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: Funnel

/// Sessions, added to cart, reached checkout, completed: each step against the first, and against the period before.
struct ShopFunnelBlock: View {
    let steps: [ShopFunnelStep]

    var body: some View {
        let top = Swift.max(1, steps.first?.value ?? 1)
        SiteBlock(title: "Conversion funnel", note: "Sessions that\u{2026}") {
            ForEach(Array(steps.enumerated()), id: \.element.id) { (i: Int, s: ShopFunnelStep) in
                VStack(alignment: .leading, spacing: pt(6)) {
                    AdaptiveStack(spacing: pt(8)) {
                        Text(s.label)
                        Spacer(minLength: 8)
                        HStack(spacing: pt(6)) {
                            Text(ShopWords.number(s.value)).monospacedDigit()
                            if i > 0 {
                                Text(SiteWords.pct(s.value / top, digits: 1) + " of sessions")
                                    .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                            }
                            if let b = s.before { SiteDelta(now: s.value, before: b) }
                        }
                    }
                    ProgressView(value: Swift.max(0, Swift.min(s.value, top)), total: top)
                        .tint(Theme.accent)
                        .accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: Charts

/// Sessions or sales over the period: bars by the day (by the hour for one day), with the switch beside the title.
struct ShopSeriesBlock: View {
    let series: ShopSeries
    @State private var mode = 0

    private struct Plot: Identifiable {
        let id: String
        let date: Date?
        let hour: Int
        let value: Double
    }

    private var plots: [Plot] {
        series.points.enumerated().compactMap { (e: (offset: Int, element: ShopSeriesPoint)) -> Plot? in
            let p = e.element
            let v = mode == 0 ? p.sessions : p.sales
            if series.grain == "hour" {
                guard let h = p.hour else { return nil }
                return Plot(id: "\(e.offset)", date: nil, hour: h, value: v)
            }
            guard let d = p.day else { return nil }
            return Plot(id: "\(e.offset)", date: d, hour: 0, value: v)
        }
    }

    var body: some View {
        SiteBlock(title: mode == 0 ? "Sessions over time" : "Total sales over time",
                  note: series.grain == "hour" ? "By the hour, Karachi time" : "Day by day",
                  options: ["Sessions", "Sales"], choice: $mode) { chart }
    }

    @ViewBuilder private var chart: some View {
        let list = plots
        if list.isEmpty {
            Text("Nothing in this period yet.").font(.subheadline).foregroundStyle(.secondary)
        } else if series.grain == "hour" {
            hourChart(list)
        } else {
            dayChart(list)
        }
    }

    private func spoken(_ list: [Plot]) -> String {
        ChartSummary.say(list.map { (p: Plot) -> (label: String, value: Double) in
            (label: p.date.map { (d: Date) -> String in ChartSummary.day(d) } ?? String(format: "%02d:00", p.hour), value: p.value)
        }, money: false)
    }

    private func dayChart(_ list: [Plot]) -> some View {
        Chart {
            ForEach(list) { (p: Plot) in
                BarMark(x: .value("Day", p.date ?? Date(), unit: .day), y: .value("Value", p.value))
                    .foregroundStyle(Theme.accent)
            }
        }
        .frame(height: 200)
        .padding(.vertical, pt(6))
        .accessibilityLabel(mode == 0 ? "Sessions each day" : "Total sales each day")
        .accessibilityValue(spoken(list))
    }

    private func hourChart(_ list: [Plot]) -> some View {
        Chart {
            ForEach(list) { (p: Plot) in
                BarMark(x: .value("Hour", p.hour), y: .value("Value", p.value))
                    .foregroundStyle(Theme.accent)
            }
        }
        .chartXScale(domain: 0...23)
        .chartXAxis { AxisMarks(values: [0, 6, 12, 18]) }
        .frame(height: 200)
        .padding(.vertical, pt(6))
        .accessibilityLabel(mode == 0 ? "Sessions each hour" : "Total sales each hour")
        .accessibilityValue(spoken(list))
    }
}

/// Live's sessions by the minute (by the hour where Shopify gave no minutes): the last thirty slots.
struct ShopMinuteBlock: View {
    let series: ShopSeries

    private struct Slot: Identifiable {
        let id: Int
        let value: Double
    }

    private var points: [ShopSeriesPoint] { Array(series.points.suffix(30)) }

    var body: some View {
        let list = points
        let slots = list.enumerated().map { (e: (offset: Int, element: ShopSeriesPoint)) -> Slot in
            Slot(id: e.offset, value: e.element.sessions)
        }
        SiteBlock(title: series.grain == "minute" ? "Sessions by the minute" : "Sessions by the hour, today",
                  note: series.grain == "minute" ? "The last half hour; Shopify\u{2019}s reports lag by a few minutes." : "Shopify gave no minutes, so the hours of today.") {
            if slots.isEmpty {
                Text("Nothing yet.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                VStack(spacing: pt(4)) {
                    Chart {
                        ForEach(slots) { (s: Slot) in
                            BarMark(x: .value("Slot", s.id), y: .value("Sessions", s.value))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    .chartXAxis(.hidden)
                    .frame(height: 120)
                    HStack {
                        Text(list.first?.clock ?? "").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        Spacer(minLength: 8)
                        Text(list.last?.clock ?? "").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    .accessibilityHidden(true)
                }
                .padding(.vertical, pt(6))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Sessions each \(series.grain == "minute" ? "minute" : "hour")")
                .accessibilityValue(ChartSummary.say(slots.map { (s: Slot) -> (label: String, value: Double) in (label: "\(s.id + 1)", value: s.value) }, money: false))
            }
        }
    }
}

// MARK: Not for staff

/// Shopify's reports are the owners' (the routes answer 403 to anyone else).
struct ShopOwnersOnly: View {
    let title: String

    var body: some View {
        NotAvailableState("Shopify analytics are for the owners",
                          why: "Ask an owner how the online store is doing.", symbol: "lock")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
