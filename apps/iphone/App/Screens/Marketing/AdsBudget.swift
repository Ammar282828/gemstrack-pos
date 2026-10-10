import SwiftUI
import ERPCore

/// What the budget sheet changes: a campaign (a budget on the campaign) or an ad set (a budget of its own).
struct AdsBudgetTarget: Identifiable, Hashable {
    /// "campaign" or "adset".
    let level: String
    let id: String
    let name: String
    let daily: Double?
    let lifetime: Double?
    /// Meta's stop time (a campaign) or end time (an ad set), or nil for none.
    let end: String?
    let currency: String
}

/// A budget and an end date (the web's campaign menu: Budget, Schedule; src/app/api/ads/object/[id]). The
/// kind stays as it is, a day's or the whole run's, as Meta keeps it. Nothing changes until the counter has
/// read what it will cost, before and after, a day and about a month, and said yes: it is money at Meta.
struct AdsBudgetSheet: View {
    let target: AdsBudgetTarget
    /// Read the campaigns again once Meta has the change.
    let saved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amount: String
    @State private var hasEnd: Bool
    @State private var endDay: Date
    @State private var confirming = false
    @State private var busy = false
    @State private var failure: String?

    init(target: AdsBudgetTarget, saved: @escaping () async -> Void) {
        self.target = target
        self.saved = saved
        let now = (target.daily ?? 0) > 0 ? target.daily : target.lifetime
        _amount = State(initialValue: now.map { (v: Double) in Self.plain(v) } ?? "")
        let ends = ERPDate.parse(target.end)
        _hasEnd = State(initialValue: ends != nil)
        _endDay = State(initialValue: ends ?? Date().addingTimeInterval(7 * 86_400))
    }

    // MARK: Reading

    /// A day's budget, or the whole run's (Meta keeps the kind it was made with).
    private var isDaily: Bool { (target.daily ?? 0) > 0 || (target.lifetime ?? 0) <= 0 }
    private var before: Double { (isDaily ? target.daily : target.lifetime) ?? 0 }
    private var after: Double? {
        let v = Double(amount.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces))
        guard let v, v.isFinite, v > 0 else { return nil }
        return v
    }

    /// The end as the sheet holds it: the chosen day's last minute in Karachi, or none.
    private var endAfter: Date? {
        guard hasEnd || !isDaily else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ERPDate.karachi
        let start = cal.startOfDay(for: endDay)
        return start.addingTimeInterval(86_400 - 60)
    }
    private var endBefore: Date? { ERPDate.parse(target.end) }

    private var budgetChanged: Bool { after.map { (v: Double) in abs(v - before) >= 0.005 } ?? false }
    private var endChanged: Bool {
        switch (endBefore, endAfter) {
        case (nil, nil): return false
        case let (a?, b?): return ERPDate.karachiDay(a) != ERPDate.karachiDay(b)
        default: return true
        }
    }

    private func money(_ v: Double) -> String { AdsFormat.money(v, target.currency) }

    private static func plain(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.2f", v)
    }

    private func dayWords(_ d: Date?) -> String {
        guard let d else { return "no end" }
        return ShopDate.say(ERPDate.iso(d))
    }

    // MARK: The sheet

    var body: some View {
        NavigationStack {
            Form { Group {
                Section {
                    LabeledContent("Now", value: before > 0 ? money(before) + (isDaily ? " a day" : " in total") : "None of its own")
                    LabeledContent("Ends", value: dayWords(endBefore))
                } header: {
                    Text(target.name)
                }
                Section {
                    LabeledContent(isDaily ? "A day" : "In total") {
                        TextField("Amount", text: $amount)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                } header: {
                    LedgerHeading(title: "Budget (\(target.currency))")
                } footer: {
                    budgetNote
                }
                Section {
                    if isDaily {
                        Toggle("Ends on a day", isOn: $hasEnd)
                    }
                    if hasEnd || !isDaily {
                        DatePicker("Ends", selection: $endDay, in: Date()..., displayedComponents: .date)
                            .environment(\.timeZone, ERPDate.karachi)
                    }
                } header: {
                    LedgerHeading(title: "End")
                } footer: {
                    Text(isDaily ? "Off runs it until it is paused." : "A total budget is spent by its end date.")
                }
                if let failure {
                    Section { Label(failure, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
                }
                .houseRows()
            }
            .navigationTitle(target.level == "campaign" ? "Campaign budget" : "Ad set budget")
            .navigationBarTitleDisplayMode(.inline)
            .disabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        SkeletonLoading()
                    } else {
                        Button("Review") { confirming = true }
                            .disabled(after == nil || !(budgetChanged || endChanged))
                    }
                }
            }
            .confirmationDialog("Change it at Meta?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Change it") { Task { await save() } }
            } message: {
                Text(review)
            }
        }
    }

    @ViewBuilder
    private var budgetNote: some View {
        if let v = after {
            VStack(alignment: .leading, spacing: 4) {
                if isDaily { Text("About \(money(v * 30.4)) a month at this budget.") }
                if before > 0 && v > before * 2 {
                    Text("That more than doubles what it spends.").foregroundStyle(.orange)
                }
            }
        } else {
            Text("A budget above zero.")
        }
    }

    /// Before and after, in money, as the counter agrees to it.
    private var review: String {
        var lines: [String] = []
        if budgetChanged, let v = after {
            let per = isDaily ? " a day" : " in total"
            lines.append("Budget: \(money(before))\(per) → \(money(v))\(per)")
            if isDaily { lines.append("About \(money(v * 30.4)) a month (was \(money(before * 30.4)))") }
        }
        if endChanged { lines.append("Ends: \(dayWords(endBefore)) → \(dayWords(endAfter))") }
        lines.append("Meta starts spending at the new budget at once.")
        return lines.joined(separator: "\n")
    }

    private func save() async {
        busy = true
        failure = nil
        defer { busy = false }
        do {
            if budgetChanged, let v = after {
                try await AdsAPI.setBudget(level: target.level, id: target.id, daily: isDaily ? v : nil, lifetime: isDaily ? nil : v)
            }
            if endChanged {
                try await AdsAPI.setEnd(level: target.level, id: target.id, end: endAfter)
            }
            await saved()
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }
}
