import SwiftUI
import ERPCore

/// Ads → Rules (src/app/ads/rules/page.tsx): watchdogs Meta runs on the ad account by itself (pause what's
/// spending with nothing to show, a daily ceiling, a word when results get expensive), and the log of every change
/// made to the ads from the ERP. A rule acts on its own, every ad set, with the ERP closed: making one or switching
/// one on says exactly what it will do and asks first. Switching one off is at once, like pausing.
struct AdsRulesScreen: View {
    @Environment(Session.self) private var session

    @State private var status: AdsStatusAnswer?
    @State private var data: AdsRulesAnswer?
    @State private var problem: String?
    @State private var loadProblem: String?
    @State private var busy: String?
    @State private var kind = "notify_no_results"
    @State private var amount = "500"
    @State private var making = false
    @State private var switchingOn: AdsRuleRow?
    @State private var deleting: AdsRuleRow?
    @State private var failure: String?

    private var mayUse: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        dialogs(page)
    }

    private var page: some View {
        Group {
            if !mayUse {
                AdsOwnersOnly()
            } else if let status, status.ready {
                content(status)
            } else {
                AdsNotReady(status: status, problem: problem, retry: load)
            }
        }
        .navigationTitle("Rules")
        .navigationBarTitleDisplayMode(.inline)
        .task { if mayUse && status == nil { await load() } }
    }

    private func dialogs<V: View>(_ v: V) -> some View {
        v
            .confirmationDialog("Make “\(newRuleName)”?", isPresented: $making, titleVisibility: .visible) {
                Button("Make the rule") { Task { await make() } }
                Button("Not now", role: .cancel) {}
            } message: {
                Text(newRuleWords)
            }
            .confirmationDialog("Switch on “\(switchingOn?.name ?? "")”?", isPresented: switchingShown, titleVisibility: .visible, presenting: switchingOn) { (r: AdsRuleRow) in
                Button("Switch it on") { Task { await set(r, on: true) } }
            } message: { (r: AdsRuleRow) in
                Text("\(r.summary).\nMeta then checks it by itself on every ad set in the account and acts on what it finds, even with the ERP closed. The rule costs nothing itself.")
            }
            .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: deletingShown, titleVisibility: .visible, presenting: deleting) { (r: AdsRuleRow) in
                Button("Delete", role: .destructive) { Task { await remove(r) } }
            } message: { (_: AdsRuleRow) in
                Text("Meta stops checking it. Ad sets it paused stay paused until switched on.")
            }
            .alert("Meta didn't take that", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
    }

    private var switchingShown: Binding<Bool> {
        Binding(get: { switchingOn != nil }, set: { (on: Bool) in if !on { switchingOn = nil } })
    }

    private var deletingShown: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { (on: Bool) in if !on { deleting = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: Reading

    private var currency: String { data?.currency ?? status?.currency ?? "PKR" }
    private var chosen: AdsHinted? { data?.kinds.first { (k: AdsHinted) in k.key == kind } }
    private var amountValue: Double? { AdsAmount.parse(amount) }

    /// "Tell me what's not working — Rs 500", as Meta will file it (rules.ts ruleSpecs).
    private var newRuleName: String {
        "\(chosen?.label ?? "Rule") — \(AdsFormat.money(amountValue ?? 0, currency))"
    }

    /// What the rule will do, in its own words with the amount in, and what it costs.
    private var newRuleWords: String {
        let money = AdsFormat.money(amountValue ?? 0, currency)
        let hint = (chosen?.hint ?? "")
            .replacingOccurrences(of: "this much", with: money)
            .replacingOccurrences(of: "above this", with: "above \(money)")
        let acts = kind.hasPrefix("pause")
            ? "It pauses ad sets by itself: a paused one stops spending until it is switched on again."
            : "It only sends a Facebook notification; nothing is paused."
        return "\(hint)\nMeta checks it itself around the clock on every ad set in the account, even with the ERP closed. \(acts) The rule costs nothing itself."
    }

    // MARK: Asking the ERP

    private func load() async {
        do {
            let s = try await AdsAPI.status()
            status = s
            problem = nil
            if s.ready { await loadRules() }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func loadRules() async {
        do {
            data = try await AdsAPI.rules()
            loadProblem = nil
        } catch {
            loadProblem = error.localizedDescription
        }
    }

    private func make() async {
        guard let v = amountValue else { return }
        busy = "new"
        defer { busy = nil }
        do {
            try await AdsAPI.makeRule(kind: kind, amount: v)
            await loadRules()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func set(_ r: AdsRuleRow, on: Bool) async {
        busy = r.id
        defer { busy = nil }
        do {
            try await AdsAPI.setRule(r.id, enabled: on)
            await loadRules()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func remove(_ r: AdsRuleRow) async {
        busy = r.id
        defer { busy = nil }
        do {
            try await AdsAPI.deleteRule(r.id)
            await loadRules()
        } catch {
            failure = error.localizedDescription
        }
    }

    // MARK: The page

    private func content(_ s: AdsStatusAnswer) -> some View {
        List {
            Group {
                AdsAlertsSection(status: s)
                if let loadProblem {
                    Section {
                        Label(loadProblem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                        Button("Try again") { Task { await loadRules() } }
                    }
                }
                newRuleSection
                rulesSection
                logSection
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await loadRules() }
    }

    private var newRuleSection: some View {
        Section {
            ForEach(data?.kinds ?? []) { (k: AdsHinted) in
                Button { kind = k.key } label: {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(k.label).foregroundStyle(.primary)
                            Text(k.hint).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        if k.key == kind { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                    }
                }
            }
            LabeledContent(chosen?.needs == "cost" ? "Per result (\(currency))" : "Today (\(currency))") {
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            }
            Button { making = true } label: {
                HStack(spacing: 8) {
                    if busy == "new" { ProgressView() }
                    Text("Make the rule")
                }
            }
            .disabled(busy != nil || amountValue == nil || data == nil)
        } header: {
            Text("A new rule")
        } footer: {
            Text("Meta checks these itself around the clock and acts on every ad set in the account: the ERP doesn't need to be open.")
        }
    }

    private func ruleSwitch(_ r: AdsRuleRow) -> Binding<Bool> {
        Binding(get: { r.enabled }, set: { (on: Bool) in
            if on { switchingOn = r } else { Task { await set(r, on: false) } }
        })
    }

    private var rulesSection: some View {
        Section {
            if let data {
                if data.rules.isEmpty {
                    Text("None yet.").foregroundStyle(.secondary)
                }
                ForEach(data.rules) { (r: AdsRuleRow) in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.name)
                            Text(r.summary).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        if busy == r.id {
                            ProgressView()
                        } else {
                            Toggle("On", isOn: ruleSwitch(r)).labelsHidden().tint(Theme.accent).disabled(busy != nil)
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) { deleting = r } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            } else if loadProblem == nil {
                MarketingReading(text: "Reading the rules…")
            }
        } header: {
            Text("Rules on the account")
        } footer: {
            if let data, !data.rules.isEmpty { Text("Swipe a rule to delete it.") }
        }
    }

    private var logSection: some View {
        Section {
            if let data {
                if data.log.isEmpty {
                    Text("Nothing yet.").foregroundStyle(.secondary)
                }
                ForEach(data.log) { (r: AdsLogRow) in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.words(currency)).font(.subheadline.weight(.medium))
                        Text([ShopDate.say(r.at, withTime: true), r.name ?? r.target ?? "", r.by].filter { (s: String) in !s.isEmpty }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Changes made from the ERP")
        }
    }
}
