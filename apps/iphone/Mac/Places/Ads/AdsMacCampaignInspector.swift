#if os(macOS)
import SwiftUI
import ERPCore

// The inspector of Ads › Campaigns (docs/features/mac-design.md, "Ads"): what is picked in the outline, whether a
// campaign, an ad set or an ad: its head (status, spend, Pause or Run), its results with the change where Meta gave
// one, the ad's picture, the budget and end date edited in place, and Meta's own details folded at the foot.

struct AdsMacInspector: View {
    let row: AdsMacRow
    /// The status as the table shows it (a switch moved at once).
    let shownStatus: String
    let currency: String
    let mayChange: Bool
    /// The default button and its neighbours (Pause or Run, Duplicate).
    let main: [MacAction]
    /// Archive and Delete, kept apart.
    let manage: [MacAction]
    /// Read the campaigns again once Meta has a change.
    let reload: () async -> Void
    let fail: (String) -> Void

    var body: some View {
        Form {
            Group {
                Section { head.listRowInsets(EdgeInsets()) }
                sections
            }
            .houseRows()
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
    }

    /// The iPhone's record head: the picture or symbol, the name in the serif over its line, a status pill, what it spent, then its actions.
    private var head: some View {
        let words = AdsStatusWords.of(shownStatus)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                lead
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.name).font(.system(.title3, design: .serif).weight(.semibold)).lineLimit(3).textSelection(.enabled)
                    Text(subtitle).font(.callout).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .firstTextBaseline) {
                Pill(words.label, tone: AdsStatusWords.tone(words.tone))
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("Spent").font(.caption).foregroundStyle(.secondary)
                    Text(AdsFormat.money(row.metrics.spend, currency))
                        .font(.system(.title2, design: .serif).weight(.semibold)).monospacedDigit()
                }
            }
            MacActionButtons(actions: main)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var lead: some View {
        if row.level == .ad {
            StockImage(imageUrl: row.image, name: row.name, key: row.id)
                .frame(width: 56, height: 56)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
        } else {
            Image(systemName: row.level == .campaign ? "megaphone.fill" : "square.stack.3d.up.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 56, height: 56)
                .background(Theme.accent.opacity(0.13), in: Circle())
        }
    }

    private var subtitle: String {
        switch row.level {
        case .campaign:
            return row.objective.map { (o: String) in "Campaign · " + AdsObjective.label(o) } ?? "Campaign"
        case .adset:
            return "Ad set in " + row.parents
        case .ad:
            return "Ad in " + row.parents
        }
    }

    @ViewBuilder
    private var sections: some View {
        resultsSection
        if !row.issues.isEmpty || row.learning != nil {
            Section("Meta Says") {
                ForEach(row.issues, id: \.self) { (issue: String) in
                    Label(issue, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.owed.color)
                }
                if let learning = row.learning { Text(learning).foregroundStyle(Tone.owed.color) }
            }
        }
        if row.level != .ad { budgetSection }
        Section("Manage") { MacActionButtons(actions: manage) }
        Section { AdsMacRawDetails(level: row.level.rawValue, id: row.id).id(row.id) }
    }

    private var resultsSection: some View {
        let cells = AdsMacFormat.figures(row, currency).flatMap { (line: [MacFigure]) in line }
        return Section("Results") {
            AdsMacFigureRows(figures: cells)
        }
    }

    @ViewBuilder
    private var budgetSection: some View {
        if row.hasBudget {
            AdsMacBudgetEditor(row: row, currency: currency, enabled: mayChange && !row.locked, saved: reload, failed: fail)
                .id(row.id)
        } else {
            Section("Budget and Dates") {
                Text(row.level == .campaign ? "Its budget is set on its ad sets." : "Its budget is set on the campaign.")
                    .foregroundStyle(.secondary)
                LabeledContent("Ends", value: row.end == nil ? "No end" : ShopDate.say(row.end))
            }
        }
    }
}

/// A campaign's or ad set's budget and end date, changed here: the button says what will happen, and does it.
struct AdsMacBudgetEditor: View {
    let row: AdsMacRow
    let currency: String
    let enabled: Bool
    let saved: () async -> Void
    let failed: (String) -> Void

    @State private var amount: String
    @State private var hasEnd: Bool
    @State private var endDay: Date
    @State private var busy = false

    init(row: AdsMacRow, currency: String, enabled: Bool, saved: @escaping () async -> Void, failed: @escaping (String) -> Void) {
        self.row = row
        self.currency = currency
        self.enabled = enabled
        self.saved = saved
        self.failed = failed
        let now = (row.daily ?? 0) > 0 ? row.daily : row.lifetime
        _amount = State(initialValue: now.map { (v: Double) in AdsMacBudgetEditor.plain(v) } ?? "")
        let ends = ERPDate.parse(row.end)
        _hasEnd = State(initialValue: ends != nil)
        _endDay = State(initialValue: ends ?? Date().addingTimeInterval(7 * 86_400))
    }

    private static func plain(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.2f", v)
    }

    // MARK: Reading

    /// A day's budget, or the whole run's (Meta keeps the kind it was made with).
    private var isDaily: Bool { (row.daily ?? 0) > 0 || (row.lifetime ?? 0) <= 0 }
    private var before: Double { (isDaily ? row.daily : row.lifetime) ?? 0 }
    private var after: Double? {
        guard let v = ShopNumber.parse(amount), v > 0 else { return nil }
        return v
    }

    /// The end as the editor holds it: the chosen day's last minute in Karachi, or none.
    private var endAfter: Date? {
        guard hasEnd || !isDaily else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ERPDate.karachi
        let start = cal.startOfDay(for: endDay)
        return start.addingTimeInterval(86_400 - 60)
    }
    private var endBefore: Date? { ERPDate.parse(row.end) }

    private var budgetChanged: Bool { after.map { (v: Double) in abs(v - before) >= 0.005 } ?? false }
    private var endChanged: Bool {
        switch (endBefore, endAfter) {
        case (nil, nil): return false
        case let (a?, b?): return ERPDate.karachiDay(a) != ERPDate.karachiDay(b)
        default: return true
        }
    }

    private func money(_ v: Double) -> String { AdsFormat.money(v, currency) }
    private func dayWords(_ d: Date?) -> String { d.map { (x: Date) in ShopDate.say(ERPDate.iso(x)) } ?? "No end" }

    private var buttonTitle: String {
        if budgetChanged, let v = after { return "Change to \(money(v)) \(isDaily ? "a day" : "in total")" }
        if endChanged { return endAfter == nil ? "Remove the End Date" : "Change the End Date" }
        return "Change"
    }

    private var note: String? {
        guard let v = after else { return "A budget above zero." }
        var lines: [String] = []
        if isDaily { lines.append("About \(money(v * 30.4)) a month at this budget.") }
        if before > 0 && v > before * 2 { lines.append("That more than doubles what it spends.") }
        if budgetChanged || endChanged { lines.append("Meta starts spending at the new budget at once.") }
        return lines.isEmpty ? nil : lines.joined(separator: " ")
    }

    // MARK: The section

    var body: some View {
        Section("Budget and Dates") {
            LabeledContent("Now", value: before > 0 ? money(before) + (isDaily ? " a day" : " in total") : "None of its own")
            LabeledContent("Ends", value: dayWords(endBefore))
            LabeledContent(isDaily ? "A day" : "In total") {
                TextField("Amount", text: $amount)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(width: 110)
            }
            if isDaily { Toggle("Ends on a day", isOn: $hasEnd) }
            if hasEnd || !isDaily {
                DatePicker("Ends", selection: $endDay, in: Date()..., displayedComponents: .date)
                    .environment(\.timeZone, ERPDate.karachi)
            }
            if let note { Text(note).font(.caption).foregroundStyle(.secondary) }
            Button(buttonTitle) { Task { await save() } }
                .disabled(!enabled || busy || after == nil || !(budgetChanged || endChanged))
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if budgetChanged, let v = after {
                try await AdsAPI.setBudget(level: row.level.rawValue, id: row.id, daily: isDaily ? v : nil, lifetime: isDaily ? nil : v)
            }
            if endChanged {
                try await AdsAPI.setEnd(level: row.level.rawValue, id: row.id, end: endAfter)
            }
            await saved()
        } catch {
            failed(error.localizedDescription)
        }
    }
}

/// Meta's own fields for the object, behind one disclosure at the foot: read only when it is opened.
struct AdsMacRawDetails: View {
    let level: String
    let id: String
    @State private var open = false
    @State private var fields: [String: Any]?
    @State private var problem: String?

    var body: some View {
        DisclosureGroup("Meta's Details", isExpanded: $open) {
            if let fields {
                MarketingDetails(fields: fields)
            } else if let problem {
                Text(problem).foregroundStyle(.secondary)
            } else {
                MarketingReading(text: "Asking Meta…")
            }
        }
        .task(id: open) { if open && fields == nil { await load() } }
    }

    private func load() async {
        do {
            let data = try await ERPAPI.shared.data("/api/ads/object/\(AdsQuery.escape(id))?level=\(level)")
            let all = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            fields = all?[level] as? [String: Any] ?? [:]
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}
#endif
