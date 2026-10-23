import SwiftUI
import Charts
import ERPCore

/// The report's own sections (page.tsx): the chart, the funnel, the sources table and the custom-period sheet.

// MARK: Chart

private struct SitePoint: Identifiable {
    let id: String
    let date: Date
    let value: Double
}

/// Sessions day by day with visitors and WhatsApp enquiries; for a one-day period, by the hour with the day before faint.
/// One accent family: sessions pale, WhatsApp full, visitors grey.
struct SiteChartSection: View {
    let report: SiteReport

    var body: some View {
        if let hours = report.hours {
            SiteBlock(title: "Sessions by the hour", note: "Karachi time; the faint shape is the day before") {
                hoursChart(hours)
            }
        } else if report.series.count > 1 {
            SiteBlock(title: "Sessions, day by day") {
                daysChart
            }
        }
    }

    private func points(_ pick: (SiteDay) -> Int) -> [SitePoint] {
        report.series.compactMap { (d: SiteDay) -> SitePoint? in
            guard let date = AdsDay.plot(d.day) else { return nil }
            return SitePoint(id: d.day, date: date, value: Double(pick(d)))
        }
    }

    private var daysChart: some View {
        let sessions = points { (d: SiteDay) in d.sessions }
        let visitors = points { (d: SiteDay) in d.visitors }
        let asked = points { (d: SiteDay) in d.enquiries }
        return Chart {
            ForEach(sessions) { (p: SitePoint) in
                BarMark(x: .value("Day", p.date, unit: .day), y: .value("Sessions", p.value))
                    .foregroundStyle(by: .value("Series", "Sessions"))
            }
            ForEach(visitors) { (p: SitePoint) in
                LineMark(x: .value("Day", p.date, unit: .day), y: .value("Visitors", p.value))
                    .foregroundStyle(by: .value("Series", "Visitors"))
                    .interpolationMethod(.monotone)
            }
            ForEach(asked) { (p: SitePoint) in
                LineMark(x: .value("Day", p.date, unit: .day), y: .value("WhatsApp", p.value))
                    .foregroundStyle(by: .value("Series", "WhatsApp"))
                    .interpolationMethod(.monotone)
            }
        }
        .chartForegroundStyleScale(domain: ["Sessions", "Visitors", "WhatsApp"], range: [Theme.accent.opacity(0.35), Color.secondary, Theme.accent])
        .frame(height: 200)
        .padding(.vertical, 6)
        .accessibilityLabel("Sessions each day, with visitors and WhatsApp enquiries")
        .accessibilityValue(ChartSummary.say(sessions.map { (p: SitePoint) in (label: ChartSummary.day(p.date), value: p.value) }, money: false))
    }

    private func hoursChart(_ hours: [SiteHour]) -> some View {
        Chart {
            ForEach(hours) { (h: SiteHour) in
                AreaMark(x: .value("Hour", h.hour), y: .value("Day before", h.before))
                    .foregroundStyle(Color.secondary.opacity(0.2))
            }
            ForEach(hours) { (h: SiteHour) in
                BarMark(x: .value("Hour", h.hour), y: .value("Sessions", h.sessions))
                    .foregroundStyle(Theme.accent)
            }
        }
        .chartXScale(domain: 0...23)
        .chartXAxis { AxisMarks(values: [0, 6, 12, 18]) }
        .frame(height: 200)
        .padding(.vertical, 6)
        .accessibilityLabel("Sessions each hour of the day, Karachi time")
        .accessibilityValue(ChartSummary.say(hours.map { (h: SiteHour) in (label: String(format: "%02d:00", h.hour), value: Double(h.sessions)) }, money: false))
    }
}

// MARK: Funnel

/// Visited → opened a piece → saved → asked on WhatsApp: each step's share of all visits and of the step before.
struct SiteFunnelSection: View {
    let now: SiteSummary
    let before: SiteSummary

    private struct Step: Identifiable {
        let id: String
        let label: String
        let n: Int
        let b: Int
    }

    private var steps: [Step] {
        [
            Step(id: "visited", label: "Visited", n: now.funnel.sessions, b: before.funnel.sessions),
            Step(id: "piece", label: "Opened a piece", n: now.funnel.piece, b: before.funnel.piece),
            Step(id: "save", label: "Saved a piece", n: now.funnel.save, b: before.funnel.save),
            Step(id: "ask", label: "Asked on WhatsApp", n: now.funnel.enquire, b: before.funnel.enquire)
        ]
    }

    var body: some View {
        let all = steps
        SiteBlock(title: "From a visit to a WhatsApp message") {
            ForEach(Array(all.enumerated()), id: \.element.id) { (i: Int, s: Step) in
                stepRow(s, index: i, all: all)
            }
        }
    }

    private func stepRow(_ s: Step, index i: Int, all: [Step]) -> some View {
        let top = Swift.max(1, all[0].n)
        let ofVisits = all[0].n > 0 ? Double(s.n) / Double(all[0].n) : 0
        return VStack(alignment: .leading, spacing: 6) {
            AdaptiveStack(spacing: 8) {
                Text(s.label)
                Spacer(minLength: 8)
                HStack(spacing: 8) {
                    Text(SiteWords.number(s.n)).monospacedDigit()
                        .contentTransition(.numericText(value: Double(s.n)))
                    if i > 0 {
                        Text(SiteWords.pct(ofVisits, digits: 1) + " of visits").font(.footnote).foregroundStyle(.secondary)
                    }
                    SiteDelta(now: Double(s.n), before: Double(s.b))
                }
            }
            ProgressView(value: Double(s.n), total: Double(top))
                .tint(Theme.accent)
                .accessibilityHidden(true)
            if i > 0 && all[i - 1].n > 0 {
                Text(SiteWords.pct(Double(s.n) / Double(all[i - 1].n), digits: 1) + " of those who " + all[i - 1].label.lowercased())
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: Sources that bring enquiries

/// Each source's sessions and how far they got: Shopify's "conversion by source".
struct SiteSourcesSection: View {
    let sources: [SiteSource]
    @State private var all = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shown: [SiteSource] {
        let top = Array(sources.prefix(15))
        return all ? top : Array(top.prefix(5))
    }

    var body: some View {
        if !sources.isEmpty {
            SiteBlock(title: "Which sources bring enquiries", note: "Of each source's sessions, the share that reached each step") {
                ForEach(shown) { (s: SiteSource) in
                    row(s)
                }
                if Swift.min(sources.count, 15) > 5 {
                    Button(all ? "Show fewer" : "Show all \(Swift.min(sources.count, 15))") {
                        Motion.run(reduce: reduceMotion) { all.toggle() }
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
    }

    private func share(_ n: Int, of total: Int) -> String {
        total > 0 ? SiteWords.pct(Double(n) / Double(total)) : "—"
    }

    private func asked(_ s: SiteSource) -> String {
        let pct = s.sessions > 0 ? " · " + SiteWords.pct(Double(s.enquire) / Double(s.sessions), digits: 1) : ""
        return "\(s.enquire) on WhatsApp" + pct
    }

    private func row(_ s: SiteSource) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            AdaptiveStack(spacing: 8) {
                Text(SiteWords.source(s.key))
                Spacer(minLength: 8)
                Text(SiteWords.number(s.sessions) + (s.sessions == 1 ? " session" : " sessions"))
                    .monospacedDigit().foregroundStyle(.secondary)
            }
            Text("Opened a piece " + share(s.piece, of: s.sessions) + " · Saved " + share(s.save, of: s.sessions))
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            // WhatsApp is the one coloured thing on the row, and only when someone asked.
            Text(asked(s))
                .font(.footnote.weight(s.enquire > 0 ? .semibold : .regular))
                .foregroundStyle(s.enquire > 0 ? Tone.settled.color : Color.secondary)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: Custom period

/// Two days, in Karachi time as the site counts them.
struct SiteCustomRangeSheet: View {
    let from: String
    let to: String
    let apply: (String, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var start = Date()
    @State private var end = Date()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("From", selection: $start, in: ...Date(), displayedComponents: .date)
                    DatePicker("To", selection: $end, in: ...Date(), displayedComponents: .date)
                } footer: {
                    Text("Days are Karachi days, as the website counts them.")
                }
            }
            .houseForm()
            .environment(\.calendar, ERPDate.karachiCalendar)
            .environment(\.timeZone, ERPDate.karachi)
            .navigationTitle("Custom period")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { finish() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { seed() }
    }

    private func seed() {
        let now = Date()
        start = SiteWords.date(from) ?? now.addingTimeInterval(-29 * 86_400)
        end = SiteWords.date(to) ?? now
    }

    private func finish() {
        let a = ERPDate.karachiDay(start)
        let b = ERPDate.karachiDay(end)
        apply(a <= b ? a : b, a <= b ? b : a)
        dismiss()
    }
}

extension SiteWords {
    /// Noon on a "yyyy-MM-dd" Karachi day, so a picker in Karachi's zone shows that day.
    static func date(_ ymd: String) -> Date? {
        let parts = ymd.split(separator: "-").compactMap { (s: Substring) in Int(s) }
        guard parts.count == 3 else { return nil }
        return ERPDate.karachiCalendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
}
