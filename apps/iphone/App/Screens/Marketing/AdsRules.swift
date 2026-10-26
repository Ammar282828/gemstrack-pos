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
    #if os(macOS)
    @State private var macPicked = Set<String>()
    @State private var macOrder = [KeyPathComparator(\AdsRuleRow.name)]
    /// The rows in the table's order, made again only when the rules or the sort change.
    @State private var macMade = Memo<[AdsRuleRow]>()
    @State private var macMaking = false
    #endif

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
            .failureAlert($failure, title: "Meta didn't take that")
    }

    private var switchingShown: Binding<Bool> {
        Binding(get: { switchingOn != nil }, set: { (on: Bool) in if !on { switchingOn = nil } })
    }

    private var deletingShown: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { (on: Bool) in if !on { deleting = nil } })
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
        #if os(macOS)
        macContent(s)
        #else
        phoneContent(s)
        #endif
    }

    private func phoneContent(_ s: AdsStatusAnswer) -> some View {
        List {
            Group {
                AdsAlertsSection(status: s)
                if let loadProblem {
                    Section {
                        Label(loadProblem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tone.problem.color)
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
        .readableColumn(780)
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        .refreshable { await loadRules() }
    }

    private var newRuleSection: some View {
        Section {
            ForEach(data?.kinds ?? []) { (k: AdsHinted) in
                Button { kind = k.key } label: {
                    HStack(alignment: .top, spacing: pt(10)) {
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
                HStack(spacing: pt(8)) {
                    if busy == "new" { SkeletonLoading() }
                    Text("Make the rule")
                }
            }
            .disabled(busy != nil || amountValue == nil || data == nil)
        } header: {
            LedgerHeading(title: "A new rule")
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
                    HStack(spacing: pt(10)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.name)
                            Text(r.summary).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        if busy == r.id {
                            SkeletonLoading()
                        } else {
                            Toggle("On", isOn: ruleSwitch(r)).labelsHidden().tint(Theme.accent).disabled(busy != nil)
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) { deleting = r } label: { Label("Delete", systemImage: "trash") }
                    }
                    #if os(macOS)
                    .contextMenu {
                        Button(r.enabled ? "Switch off" : "Switch on…", systemImage: r.enabled ? "pause.circle" : "play.circle") {
                            if r.enabled { Task { await set(r, on: false) } } else { switchingOn = r }
                        }
                        .disabled(busy != nil)
                        Divider()
                        Button("Delete…", systemImage: "trash", role: .destructive) { deleting = r }
                    }
                    #endif
                }
            } else if loadProblem == nil {
                MarketingReading(text: "Reading the rules…")
            }
        } header: {
            LedgerHeading(title: "Rules on the account")
        } footer: {
            #if os(macOS)
            if let data, !data.rules.isEmpty { Text("Right-click a rule to delete it.") }
            #else
            if let data, !data.rules.isEmpty { Text("Swipe a rule to delete it.") }
            #endif
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
            LedgerHeading(title: "Changes made from the ERP")
        }
    }
}

#if os(macOS)
// MARK: - The Mac's Rules: the rules on the account as a table with the picked one in the inspector, the log of changes
// below it, and a new rule made in a short sheet whose button says what it does.

extension AdsRulesScreen {
    private var macRules: [AdsRuleRow] {
        let all = data?.rules ?? []
        return macMade([all.hashValue, macOrder.hashValue]) { all.sorted(using: macOrder) }
    }
    private var macPickedRules: [AdsRuleRow] { macRules.filter { (r: AdsRuleRow) in macPicked.contains(r.id) } }

    private var macNewRule: MacAction {
        MacAction("New Rule…", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]), enabled: busy == nil && data != nil) {
            macMaking = true
        }
    }

    private func macActions(_ picked: [AdsRuleRow]) -> [[MacAction]] {
        let one: AdsRuleRow? = picked.count == 1 ? picked[0] : nil
        let toggle = MacAction(one?.enabled == true ? "Switch Off" : "Switch On…", symbol: one?.enabled == true ? "pause.circle" : "play.circle",
                               enabled: one != nil && busy == nil, isDefault: true) {
            if let r = one {
                if r.enabled { Task { await set(r, on: false) } } else { switchingOn = r }
            }
        }
        let delete = MacAction("Delete…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: one != nil && busy == nil) {
            if let r = one { deleting = r }
        }
        return [[toggle], [delete], [macNewRule]]
    }

    func macContent(_ s: AdsStatusAnswer) -> some View {
        let rules = macRules
        let picked = macPickedRules
        return VStack(spacing: 0) {
            AdsMacAlertBar(status: s)
            if let loadProblem {
                Label(loadProblem, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Tone.problem.color)
                    .padding(8)
            }
            VSplitView {
                macRulesTable(rules)
                    .frame(minHeight: 170)
                macLog
                    .frame(minHeight: 150)
            }
        }
        .macInspector { macInspectorPanel(picked) }
        .macRefresh { Task { await loadRules() } }
        .macRecordMenu(MacRecordMenu(title: "Rule", groups: macActions(picked)))
        .macSummaryBar(macSummary(rules))
        .navigationSubtitle("On the ad account")
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                MacToolbarAction(action: macNewRule)
            }
        }
        .sheet(isPresented: $macMaking) { macNewRuleSheet }
    }

    private func macSummary(_ rules: [AdsRuleRow]) -> [String] {
        let on = rules.filter { (r: AdsRuleRow) in r.enabled }.count
        return ["\(rules.count) rule\(rules.count == 1 ? "" : "s")", "\(on) on"]
    }

    private func macRulesTable(_ rules: [AdsRuleRow]) -> some View {
        Table(rules, selection: $macPicked, sortOrder: $macOrder) {
            TableColumn("Rule", value: \.name) { (r: AdsRuleRow) in Text(r.name).lineLimit(1) }
                .width(min: 120, ideal: 220)
            TableColumn("What It Does") { (r: AdsRuleRow) in
                Text(r.summary).foregroundStyle(.secondary).lineLimit(2)
            }
            .width(min: 160, ideal: 420)
            TableColumn("On") { (r: AdsRuleRow) in
                if busy == r.id {
                    SkeletonLoading()
                } else {
                    Toggle("On", isOn: ruleSwitch(r)).labelsHidden().toggleStyle(.switch).controlSize(.small).disabled(busy != nil)
                }
            }
            .width(min: 44, ideal: 52)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            let picked = macRules.filter { (r: AdsRuleRow) in ids.contains(r.id) }
            MacActionItems(groups: macActions(picked))
        }
        .overlay {
            if let data, data.rules.isEmpty {
                ContentUnavailableView("No Rules Yet", systemImage: "checklist", description: Text("New Rule (\u{2303}\u{2318}N) makes one. Meta checks it around the clock."))
            } else if data == nil && loadProblem == nil {
                MarketingReading(text: "Reading the rules…")
            }
        }
    }

    private var macLog: some View {
        VStack(alignment: .leading, spacing: 6) {
            LedgerHeading(title: "Changes made from the ERP").padding(.horizontal, 12).padding(.top, 8)
            Table(data?.log ?? []) {
                TableColumn("When") { (r: AdsLogRow) in Text(ShopDate.say(r.at, withTime: true)).monospacedDigit().lineLimit(1) }
                    .width(min: 110, ideal: 150)
                TableColumn("Change") { (r: AdsLogRow) in Text(r.words(currency)).lineLimit(1) }
                    .width(min: 140, ideal: 260)
                TableColumn("What") { (r: AdsLogRow) in Text(r.name ?? r.target ?? "").lineLimit(1) }
                    .width(min: 100, ideal: 220)
                TableColumn("By") { (r: AdsLogRow) in Text(r.by).lineLimit(1) }
                    .width(min: 70, ideal: 120)
            }
        }
    }

    // MARK: The inspector

    @ViewBuilder
    private func macInspectorPanel(_ picked: [AdsRuleRow]) -> some View {
        if picked.count == 1, let r = picked.first {
            let actions = macActions(picked)
            VStack(alignment: .leading, spacing: 14) {
                MacInspectorHeader(title: r.name, subtitle: "Rule on the ad account",
                                   status: MacStatus(r.enabled ? "On" : "Off", tone: r.enabled ? .settled : .quiet),
                                   actions: [actions[0][0], actions[1][0]])
                Text(r.summary).foregroundStyle(.secondary)
                Text("Meta checks it itself around the clock on every ad set in the account, even with the ERP closed. A rule costs nothing itself.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            MacInspectorEmpty(title: macPicked.count > 1 ? "\(macPicked.count) Selected" : "No Rule Selected",
                              detail: "Click a rule to see what it does and switch it on or off.")
        }
    }

    // MARK: A new rule

    private var macNewRuleSheet: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    Picker("Rule", selection: $kind) {
                        ForEach(data?.kinds ?? []) { (k: AdsHinted) in Text(k.label).tag(k.key) }
                    }
                    .pickerStyle(.menu)
                    if let hint = chosen?.hint { Text(hint).font(.caption).foregroundStyle(.secondary) }
                    LabeledContent(chosen?.needs == "cost" ? "Per result (\(currency))" : "Today (\(currency))") {
                        TextField("Amount", text: $amount)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            .frame(width: 110)
                    }
                }
                Section("What It Will Do") {
                    Text(newRuleName).fontWeight(.medium)
                    Text(newRuleWords).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            AdsMacSheetFooter(title: "Make the Rule", disabled: busy != nil || amountValue == nil || data == nil, cancel: { macMaking = false }) {
                macMaking = false
                Task { await make() }
            }
        }
        .frame(width: 460, height: 420)
    }
}
#endif
