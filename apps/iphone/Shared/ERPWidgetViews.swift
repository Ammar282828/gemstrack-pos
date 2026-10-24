import Charts
import SwiftUI
import WidgetKit

/// What the home-screen widget shows and how, shared by the widget (ERPWidget/) and the app,
/// which writes the widget's links (Shared/ERPWidgetLink.swift) and draws a preview of it (WidgetPreviewScreen).
/// The figures come ready to show from the ERP (/api/widget/summary): the widget only lays
/// them out, so a change to what they say needs no new build.

struct ERPSummary: Codable {
    struct Figure: Codable, Hashable {
        let label: String
        let value: String
        let detail: String?
    }
    /// "Taheri", "House of Mina".
    let house: String
    /// When the ERP worked the figures out, as the shop reads a time ("4:05 pm").
    let updated: String
    /// Revenue today and this month first; supporting shop figures follow.
    let figures: [Figure]
    var teamNote: String? = nil
    var asOf: String? = nil
    /// The week, the work that needs someone and the latest sales (added after the first widget; absent from an older
    /// server, and never able to fail the decode of the figures above).
    var extras: Extras? = nil

    struct Extras: Codable {
        struct Need: Codable, Hashable {
            var title = "", detail = "", tone = "owed", path = "/"
        }
        struct Sale: Codable, Hashable {
            var title = "", amount = "", when = "", path = "/"
        }
        var days: [Double] = []
        var weekDelta: Int? = nil
        var bench = 0, due = 0, late = 0
        var needs: [Need] = []
        var recent: [Sale] = []

        init(days: [Double] = [], weekDelta: Int? = nil, bench: Int = 0, due: Int = 0, late: Int = 0,
             needs: [Need] = [], recent: [Sale] = []) {
            self.days = days; self.weekDelta = weekDelta; self.bench = bench; self.due = due; self.late = late
            self.needs = needs; self.recent = recent
        }

        private enum Keys: String, CodingKey { case days, weekDelta, bench, due, late, needs, recent }
        /// Lenient (rule 2): a missing or odd field is a default, never a thrown error.
        init(from decoder: Decoder) throws {
            guard let c = try? decoder.container(keyedBy: Keys.self) else { return }
            days = (try? c.decode([Double].self, forKey: .days)) ?? []
            weekDelta = (try? c.decode(Int.self, forKey: .weekDelta)) ?? (try? c.decode(Double.self, forKey: .weekDelta)).map { Int($0.rounded()) }
            bench = (try? c.decode(Int.self, forKey: .bench)) ?? 0
            due = (try? c.decode(Int.self, forKey: .due)) ?? 0
            late = (try? c.decode(Int.self, forKey: .late)) ?? 0
            needs = (try? c.decode([Need].self, forKey: .needs)) ?? []
            recent = (try? c.decode([Sale].self, forKey: .recent)) ?? []
        }
    }

    static let sample = ERPSummary(house: "Taheri", updated: "4:05 pm", figures: [
        Figure(label: "Made today", value: "Rs 3.12 lac", detail: "revenue"),
        Figure(label: "This month", value: "Rs 28.4 lac", detail: "revenue"),
        Figure(label: "Gold 24k", value: "Rs 2.45 lac", detail: "a tola"),
        Figure(label: "Today's cash", value: "Rs 3.12 lac", detail: "in the drawer"),
        Figure(label: "Owed to you", value: "Rs 18.6 lac", detail: "41 customers"),
        Figure(label: "Orders due", value: "6", detail: "2 late"),
    ], teamNote: "Please confirm all collections before closing today.", extras: Extras(
        days: [180_000, 240_000, 150_000, 310_000, 270_000, 205_000, 312_000], weekDelta: 12, bench: 14, due: 6, late: 2,
        needs: [.init(title: "Ayesha Khan", detail: "3 days late", tone: "late", path: "/orders"),
                .init(title: "Bilal Traders", detail: "2 days late", tone: "late", path: "/orders"),
                .init(title: "Sana Malik", detail: "owes Rs 1.8 lac", tone: "owed", path: "/invoices"),
                .init(title: "Omar Jewellers", detail: "owes Rs 95,000", tone: "owed", path: "/invoices")],
        recent: [.init(title: "Hira Siddiqui", amount: "Rs 1.4 lac", when: "23 Oct", path: "/invoices"),
                 .init(title: "Walk-in", amount: "Rs 62,000", when: "23 Oct", path: "/invoices"),
                 .init(title: "Zain Ali", amount: "Rs 1.1 lac", when: "22 Oct", path: "/invoices")]))

    static func sample(house: String) -> ERPSummary {
        ERPSummary(house: house, updated: sample.updated, figures: sample.figures, teamNote: sample.teamNote, extras: sample.extras)
    }
}

enum ERPWidgetSize {
    case small, medium, large, extraLarge, rectangular, circular, inline
    /// One business's share of a widget that shows two (the entry view lays them out and links each): a row of a
    /// small widget, a column of a medium one, a line of a rectangular accessory. They set no widgetURL of their own.
    case smallHalf, mediumHalf, rectangularLine

    var isHalf: Bool { self == .smallHalf || self == .mediumHalf || self == .rectangularLine }
}

/// Marks a view as part of the accent group when the system renders the widget tinted.
extension View {
    @ViewBuilder func erpAccentable(_ on: Bool = true) -> some View {
        if #available(iOS 16.0, *) { self.widgetAccentable(on) } else { self }
    }
}

/// When the figures were worked out; carries the day when they are not today's.
struct ERPFreshness {
    let text: String
    let short: String
    let stale: Bool

    init(_ s: ERPSummary, now: Date = Date()) {
        guard let day = s.asOf else { text = s.updated; short = s.updated; stale = false; return }
        let tz = TimeZone(identifier: "Asia/Karachi")
        let iso = DateFormatter()
        iso.locale = Locale(identifier: "en_US_POSIX")
        iso.timeZone = tz
        iso.dateFormat = "yyyy-MM-dd"
        if day == iso.string(from: now) { text = s.updated; short = s.updated; stale = false; return }
        var shown = day
        if let d = iso.date(from: day) {
            let out = DateFormatter()
            out.timeZone = tz
            out.setLocalizedDateFormatFromTemplate("d MMM")
            shown = out.string(from: d)
        }
        text = "\(shown) · \(s.updated)"
        short = shown
        stale = true
    }
}


/// The widget's face. `size` is passed in, not read from WidgetKit's environment, so the app can
/// draw the same face for its preview.
struct ERPWidgetFace: View {
    let summary: ERPSummary?
    let size: ERPWidgetSize
    /// The business shown; nil before any is linked (the face then says to open the app and sign in).
    var look: ERPWidgetLook?
    /// Tinted or clear home screen (accented / vibrant): no colour of ours, only the accent group.
    var accented = false

    init(summary: ERPSummary?, size: ERPWidgetSize, look: ERPWidgetLook? = nil, accented: Bool = false) {
        self.summary = summary
        self.size = size
        self.look = look
        self.accented = accented
    }

    private var ink: Color { accented ? .primary : (look?.accent ?? ERPWidgetLook.accentFallback) }
    private func tone(_ name: String) -> Color {
        if accented { return .primary }
        return name == "late" ? .red : name == "settled" ? .green : .orange
    }
    private var note: String? { summary?.teamNote.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } }
    private func figure(_ s: ERPSummary, _ label: String) -> ERPSummary.Figure? { s.figures.first { $0.label == label } }

    var body: some View {
        if let s = summary, let today = s.figures.first {
            if size.isHalf { face(s, today) } else { face(s, today).widgetURL(look?.rootURL) }
        } else if size.isHalf {
            waiting
        } else if size == .inline {
            // An inline accessory is one line of text: no wordmark fits there.
            Text(look == nil ? "Open ERP to sign in" : "\(look?.name ?? "") · no figures yet")
        } else if size == .circular {
            Image(systemName: "banknote").widgetAccentable()
        } else {
            unlinked
        }
    }

    @ViewBuilder private func face(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        switch size {
        case .inline: Text("Today · \(today.value)").privacySensitive().contentTransition(.numericText())
        case .circular: circularFace(s)
        case .rectangular: rectangularFace(s, today)
        case .small: smallFace(s, today)
        case .medium: mediumFace(s, today)
        case .large, .extraLarge: largeFace(s, today)
        case .smallHalf: smallHalfFace(s, today)
        case .mediumHalf: mediumHalfFace(s, today)
        case .rectangularLine: lineFace(s, today)
        }
    }

    // MARK: Accessory

    private func circularFace(_ s: ERPSummary) -> some View {
        let e = s.extras
        return Gauge(value: Double(min(e?.due ?? 0, max(e?.bench ?? 1, 1))), in: 0...Double(max(e?.bench ?? 1, 1))) {
            Text("Due")
        } currentValueLabel: {
            Text("\(e?.due ?? 0)").font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
    }

    private func rectangularFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("Today").font(.caption2.weight(.semibold)).textCase(.uppercase).tracking(0.8).erpAccentable()
                    delta(s, font: .caption2)
                }
                Text(today.value)
                    .font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6).privacySensitive()
                    .contentTransition(.numericText()).invalidatableContent()
                if let e = s.extras, e.due > 0 {
                    Text(e.late > 0 ? "\(e.due) due · \(e.late) late" : "\(e.due) due")
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            if let days = s.extras?.days, days.count > 1 {
                ERPSparkline(days: days, tint: .primary).erpAccentable().frame(width: 38)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Taheri  Rs 1.2 lac": one business on one line of a rectangular accessory that carries two.
    private func lineFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(s.house).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7).erpAccentable()
            Spacer(minLength: 4)
            Text(today.value)
                .font(.system(.callout, design: .rounded).weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6).privacySensitive()
                .contentTransition(.numericText()).invalidatableContent()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Home screen

    private func smallFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                eyebrow("Today")
                Spacer(minLength: 4)
                wordmark(width: 52, height: 14)
            }
            hero(today, style: .title).padding(.top, 4)
            delta(s, font: .caption.weight(.semibold)).padding(.top, 1)
            Spacer(minLength: 4)
            if let days = s.extras?.days, days.count > 1 {
                ERPSparkline(days: days, tint: ink).erpAccentable().frame(height: 38)
            }
            stamp(s)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// A small widget's row when it carries two businesses: the name in its accent, today's figure, a tiny delta.
    private func smallHalfFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            nameTag(s)
            hero(today, style: .title2)
            delta(s, font: .caption2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// A medium widget's column when it carries two businesses: name, today's figure, delta, the week.
    private func mediumHalfFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            nameTag(s)
            hero(today, style: .title).padding(.top, 3)
            delta(s, font: .caption.weight(.semibold)).padding(.top, 1)
            Spacer(minLength: 4)
            if let days = s.extras?.days, days.count > 1 {
                ERPSparkline(days: days, tint: ink).erpAccentable().frame(height: 38)
            }
            stamp(s)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func mediumFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                eyebrow("Today")
                hero(today, style: .title).padding(.top, 3)
                delta(s, font: .caption.weight(.semibold)).padding(.top, 1)
                Spacer(minLength: 4)
                if let days = s.extras?.days, days.count > 1 {
                    ERPWeekBars(days: days, tint: ink).erpAccentable().frame(height: 38)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    Spacer(minLength: 0)
                    wordmark(width: 56, height: 14)
                }
                Spacer(minLength: 4)
                VStack(alignment: .leading, spacing: 9) { stats(s) }
                Spacer(minLength: 4)
                stamp(s)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func largeFace(_ s: ERPSummary, _ today: ERPSummary.Figure) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 0) {
                    eyebrow("Today")
                    hero(today, style: .largeTitle).padding(.top, 2)
                    delta(s, font: .caption.weight(.semibold)).padding(.top, 1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 6) {
                    wordmark(width: 64, height: 16)
                    if let days = s.extras?.days, days.count > 1 {
                        ERPWeekBars(days: days, tint: ink).erpAccentable().frame(height: 34)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            HStack(alignment: .top, spacing: 12) { stats(s, horizontal: true) }
            if let e = s.extras, !(e.needs.isEmpty && e.recent.isEmpty) {
                if !e.needs.isEmpty {
                    section("Needs you") { ForEach(Array(e.needs.prefix(4).enumerated()), id: \.offset) { _, n in needRow(n) } }
                }
                if !e.recent.isEmpty {
                    section("Recent sales") { ForEach(Array(e.recent.prefix(3).enumerated()), id: \.offset) { _, r in saleRow(r) } }
                }
            } else {
                supporting(s, columns: size == .extraLarge ? 4 : 2)
            }
            Spacer(minLength: 0)
            if let note {
                Label(note, systemImage: "pin.fill").font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1).privacySensitive()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// A share of a two-business widget whose figures have not come yet.
    private var waiting: some View {
        Text("\(look?.name ?? "ERP") · no figures yet")
            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var unlinked: some View {
        VStack(alignment: .leading, spacing: 8) {
            wordmark(width: 92, height: 24)
            Spacer(minLength: 4)
            Text(look == nil ? "Open ERP to sign in" : "Waiting for the figures").font(.headline).lineLimit(2)
            Text(look == nil ? "Your shop, at a glance." : "They arrive when \(look?.name ?? "the ERP") can be reached.")
                .font(.caption).foregroundStyle(.tertiary).lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Pieces

    private func eyebrow(_ text: String) -> some View {
        Text(text).textCase(.uppercase)
            .font(.caption2.weight(.semibold)).tracking(1.1)
            .foregroundStyle(.secondary).lineLimit(1)
    }

    /// The business's name in its accent, small caps; what tells two businesses apart on one widget.
    private func nameTag(_ s: ERPSummary) -> some View {
        Text(s.house).textCase(.uppercase)
            .font(.caption2.weight(.semibold)).tracking(1.1)
            .foregroundStyle(ink).lineLimit(1).minimumScaleFactor(0.7).erpAccentable()
    }

    /// The hero figure: "Rs" small and quiet, the number large in rounded semibold numerals.
    private func hero(_ f: ERPSummary.Figure, style: Font.TextStyle) -> some View {
        let hasRs = f.value.hasPrefix("Rs ")
        let number = hasRs ? String(f.value.dropFirst(3)) : f.value
        return HStack(alignment: .firstTextBaseline, spacing: 3) {
            if hasRs { Text("Rs").font(.footnote.weight(.medium)).foregroundStyle(.secondary) }
            Text(number)
                .font(.system(style, design: .rounded).weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.5)
                .contentTransition(.numericText())
                .invalidatableContent()
        }
        .privacySensitive()
        .erpAccentable()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(f.label) \(f.value)")
    }

    /// "▲ 12%" against the seven days before; green up, red down, nothing when there is nothing to compare.
    @ViewBuilder private func delta(_ s: ERPSummary, font: Font) -> some View {
        if let d = s.extras?.weekDelta {
            HStack(spacing: 3) {
                Text("\(d >= 0 ? "▲" : "▼") \(abs(d))%").monospacedDigit()
                    .foregroundStyle(tone(d >= 0 ? "settled" : "late"))
                Text("vs last week").foregroundStyle(.tertiary)
            }
            .font(font).lineLimit(1).minimumScaleFactor(0.7)
            .contentTransition(.numericText())
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(abs(d)) percent \(d >= 0 ? "up" : "down") on last week")
        }
    }

    /// Owed to you, due, on the bench: a symbol, the value, a small label.
    @ViewBuilder private func stats(_ s: ERPSummary, horizontal: Bool = false) -> some View {
        if let owed = figure(s, "Owed to you") {
            stat("banknote", owed.value, "Owed to you", horizontal: horizontal)
        }
        if let e = s.extras {
            stat("calendar.badge.clock", "\(e.due)", e.late > 0 ? "Due · \(e.late) late" : "Orders due",
                 late: e.late > 0, horizontal: horizontal)
            stat("hammer", "\(e.bench)", "On the bench", horizontal: horizontal)
        } else if let due = figure(s, "Due") {
            stat("calendar.badge.clock", due.value, due.detail ?? "Orders due", horizontal: horizontal)
        }
    }

    private func stat(_ symbol: String, _ value: String, _ label: String, late: Bool = false, horizontal: Bool) -> some View {
        HStack(alignment: .center, spacing: 7) {
            Image(systemName: symbol).font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary).frame(width: 18)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit()
                    .foregroundStyle(late ? AnyShapeStyle(tone("late")) : AnyShapeStyle(.primary))
                    .lineLimit(1).minimumScaleFactor(0.7).privacySensitive()
                    .contentTransition(.numericText()).invalidatableContent()
                Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: horizontal ? .infinity : nil, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ rows: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Rectangle().fill(.primary.opacity(0.12)).frame(height: 1)
            eyebrow(title)
            rows()
        }
    }

    private func needRow(_ n: ERPSummary.Extras.Need) -> some View {
        row(n.path) {
            Text(n.title).font(.footnote.weight(.medium)).lineLimit(1)
            Spacer(minLength: 6)
            Text(n.detail).font(.footnote).monospacedDigit()
                .foregroundStyle(tone(n.tone)).lineLimit(1).privacySensitive()
        }
    }

    private func saleRow(_ r: ERPSummary.Extras.Sale) -> some View {
        row(r.path) {
            Text(r.title).font(.footnote.weight(.medium)).lineLimit(1)
            Text(r.when).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            Spacer(minLength: 6)
            Text(r.amount).font(.footnote.weight(.semibold)).monospacedDigit().lineLimit(1).privacySensitive()
        }
    }

    /// A line that opens its screen in the app.
    @ViewBuilder private func row<C: View>(_ path: String, @ViewBuilder _ content: () -> C) -> some View {
        let line = HStack(alignment: .firstTextBaseline, spacing: 6) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
        if let url = look?.url(path) { Link(destination: url) { line } } else { line }
    }

    @ViewBuilder private func wordmark(width: CGFloat, height: CGFloat) -> some View {
        if let brand = look?.brand {
            Image("BrandLogo-\(brand)").resizable()
                .widgetAccentedRenderingMode(.accented).scaledToFit()
                .frame(width: width, height: height, alignment: .trailing)
        } else {
            // An added business has no art in the widget: its name stands in, in its accent.
            Text(look?.name ?? "ERP")
                .font(.system(size: height * 0.7, weight: .semibold, design: .rounded))
                .foregroundStyle(ink).lineLimit(1).minimumScaleFactor(0.5).erpAccentable()
                .frame(width: width, height: height, alignment: .trailing)
        }
    }

    /// Quiet, tertiary: only when the figures are not from today, or the ERP could not be reached.
    @ViewBuilder private func stamp(_ s: ERPSummary) -> some View {
        let f = ERPFreshness(s)
        if f.stale {
            Label("Updated \(f.short)", systemImage: "clock.arrow.circlepath")
                .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                .padding(.top, 2)
        }
    }

    @ViewBuilder private func supporting(_ s: ERPSummary, columns: Int) -> some View {
        let rest = Array(s.figures.dropFirst(2).enumerated())
        if !rest.isEmpty {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14, alignment: .topLeading), count: columns),
                      alignment: .leading, spacing: 10) {
                ForEach(rest, id: \.offset) { item in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.element.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        Text(item.element.value).font(.system(.subheadline, design: .rounded).weight(.semibold))
                            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.75).privacySensitive()
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// Seven days as a line with a soft fill and today's point.
struct ERPSparkline: View {
    let days: [Double]
    let tint: Color

    var body: some View {
        Chart {
            ForEach(Array(days.enumerated()), id: \.offset) { i, v in
                AreaMark(x: .value("Day", i), y: .value("Revenue", v))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(LinearGradient(colors: [tint.opacity(0.32), tint.opacity(0)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Day", i), y: .value("Revenue", v))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
            if let last = days.last {
                PointMark(x: .value("Day", days.count - 1), y: .value("Revenue", last))
                    .symbolSize(28).foregroundStyle(tint)
            }
        }
        .chartXAxis(.hidden).chartYAxis(.hidden).chartLegend(.hidden)
        .chartYScale(domain: 0...max((days.max() ?? 1) * 1.15, 1))
        .accessibilityLabel("Takings, last 7 days")
    }
}

/// Seven small bars; today's is the accent, the rest are faint.
struct ERPWeekBars: View {
    let days: [Double]
    let tint: Color

    var body: some View {
        Chart {
            ForEach(Array(days.enumerated()), id: \.offset) { i, v in
                BarMark(x: .value("Day", i), y: .value("Revenue", max(v, 0)), width: .ratio(0.62))
                    .cornerRadius(3)
                    .foregroundStyle(i == days.count - 1 ? tint : tint.opacity(0.28))
            }
        }
        .chartXAxis(.hidden).chartYAxis(.hidden).chartLegend(.hidden)
        .chartYScale(domain: 0...max((days.max() ?? 1) * 1.05, 1))
        .accessibilityLabel("Takings, last 7 days")
    }
}

/// The business's own ground with a very light top glow; tinted and clear home screens drop it (the entry view).
struct ERPWidgetPaper: View {
    var look: ERPWidgetLook?
    var body: some View {
        (look?.ground ?? ERPWidgetLook.groundFallback).overlay {
            LinearGradient(colors: [.white.opacity(0.08), .clear], startPoint: .top, endPoint: .center)
        }
    }
}
