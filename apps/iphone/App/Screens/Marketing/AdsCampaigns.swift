import SwiftUI
#if os(macOS)
import AppKit
#endif
import ERPCore

/// Ads → Campaigns (src/app/ads/campaigns/page.tsx): every campaign with its ad sets and their ads,
/// each with its status and the range's numbers against the time before, and the web's run / pause
/// switch (turning one on asks first, since it spends), and the budget and end date (AdsBudgetSheet, which
/// shows the money before and after and asks). Audience, rename, duplicate, archive and delete, and an
/// ad's previews, are each one's own screen (AdsObjectScreen): one tap opens it.
struct AdsCampaignsScreen: View {
    var path = "/ads/campaigns"
    @State private var gallery = false
    @State private var sort = "spend"
    @State private var expanded = Set<String>()
    @State private var allExpanded = false
    @Environment(Session.self) private var session

    @AppStorage("ads.range") private var rangeKey = "last_7d"
    @State private var data: AdCampaigns?
    @State private var problem: String?
    @State private var filter = Filter.all
    @State private var search = ""
    @State private var archived = false
    @State private var busy: String?
    @State private var asking: Target?
    @State private var failure: String?
    @State private var go: Route?
    @State private var budgeting: AdsBudgetTarget?
    /// A switch shows what was asked at once; it is dropped when Meta has answered (or refused).
    @State private var shownStatus: [String: String] = [:]
    /// The range's campaigns as a CSV (the web's Download (CSV)), ready for the share sheet.
    @State private var csvFile: URL?
    @State private var exporting = false
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutWidthClass) private var sizeClass
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var macSelection = Set<String>()
    @State private var macOrder = [AdsMacRowOrder(field: .spend, order: .reverse)]
    /// The outline's rows, made once per change of the campaigns, the filter, the search or the sort.
    @State private var macRows = Memo<[AdsMacRow]>()
    @State private var macFlat = Memo<[AdsMacRow]>()
    @State private var macConfirm: AdsMacConfirm?
    @State private var macRunMany: [Target] = []
    @State private var macWorking = false
    #endif

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", running = "Running", paused = "Paused", problems = "Problems"
        var id: String { rawValue }
    }

    /// A campaign or ad set a switch acts on.
    struct Target: Identifiable, Hashable {
        let level: String
        let id: String
        let name: String
    }

    private var mayRead: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        Group {
            if !mayRead {
                AdsOwnersOnly()
            } else if let data {
                content(data)
            } else if let problem {
                failed(problem)
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        #if os(macOS)
        .navigationTitle("Ads")
        #else
        .navigationTitle("Campaigns")
        #endif
        .hubTitleDisplay()
        // An iPad's rows and tables sit in a centred column.
        #if !os(macOS)
        .readableColumn(1040)
        #endif
        #if !os(macOS)
        .searchable(text: $search, prompt: "Search campaigns, ad sets, ads")
        #endif
        #if os(macOS)
        .toolbar { macToolbar }
        #else
        .toolbar {
            if mayRead {
                ToolbarItem(placement: .primaryAction) { AdsRangeMenu(key: $rangeKey) }
                ToolbarItem(placement: .primaryAction) {
                    Button { go = Route(path: "/ads/new") } label: { Label("New ad", systemImage: "plus") }
                        .accessibilityLabel("New ad")
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Toggle("Show archived", isOn: $archived)
                        Toggle("Expand all campaigns", isOn: $allExpanded)
                        Button { Task { await exportCsv() } } label: { Label("Download (CSV)", systemImage: "tablecells") }
                            .disabled(exporting)
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        #endif
        .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
        // Back from a campaign, ad set or ad: what was paused, renamed or deleted there shows here.
        .onChange(of: go) { old, new in if old != nil && new == nil { Task { await load() } } }
        .task(id: "\(rangeKey)|\(archived)") { csvFile = nil; if mayRead { await load() } }
        .task { if let id = AdsQuery.value("ad", in: path) { go = Route(path: objectPath("ad", id)) } }
        .confirmationDialog("Run it?", isPresented: askingShown, titleVisibility: .visible, presenting: asking) { (t: Target) in
            Button("Run") { Task { await setRunning(t, running: true) } }
        } message: { (t: Target) in
            Text("\(t.name) will start spending its budget.")
        }
        .sheet(item: $budgeting) { (t: AdsBudgetTarget) in
            AdsBudgetSheet(target: t) { await load() }.presentationSizing(.form)
        }
        .failureAlert($failure, title: "Meta didn't take that")
        .noteToast($note)
    }

    private var askingShown: Binding<Bool> {
        Binding(get: { asking != nil }, set: { (on: Bool) in if !on { asking = nil } })
    }


    // MARK: Asking Meta

    func load() async {
        if data == nil, let cached = AdsAPI.lastCampaigns(range: rangeKey, archived: archived) { data = cached }
        do {
            data = try await AdsAPI.campaigns(range: rangeKey, archived: archived)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Every campaign, ad set and ad in the range as the web's CSV (export.ts, made by the server), for Numbers,
    /// Excel or Google Sheets.
    private func exportCsv() async {
        exporting = true
        defer { exporting = false }
        do {
            let d = try await ERPAPI.shared.data("/api/ads/campaigns?range=\(rangeKey)&format=csv\(archived ? "&archived=1" : "")")
            csvFile = try SettingsFiles.save(d, named: "ads-\(rangeKey)-\(ERPDate.karachiDay(Date())).csv")
        } catch {
            failure = error.localizedDescription
        }
    }

    /// Optimistic: the switch moves now; Meta's answer follows through the Outbox (put back, with Retry, if refused).
    private func setRunning(_ t: Target, running: Bool) async {
        shownStatus[t.id] = running ? "ACTIVE" : "PAUSED"
        Outbox.shared.post(label: (running ? "Run " : "Pause ") + t.name) {
            shownStatus[t.id] = running ? "ACTIVE" : "PAUSED"
            do {
                try await AdsAPI.setRunning(level: t.level, id: t.id, running: running)
            } catch {
                shownStatus[t.id] = nil
                throw error
            }
            await load()
            shownStatus[t.id] = nil
            return running ? "Running: \(t.name)" : "Paused: \(t.name)"
        }
    }

    private func failed(_ message: String) -> some View {
        VStack(spacing: 0) {
            // The demo has no ERP to ask again: no button that can only fail.
            ErrorState(message, retry: House.isDemo ? nil : { Task { await load() } })
            Button("Open Setup") { go = Route(path: "/ads/setup") }
                .buttonStyle(.bordered)
                .padding(.bottom, pt(32))
        }
    }

    // MARK: Which campaigns

    private func isProblem(_ status: String, _ issues: [String]) -> Bool {
        ["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO"].contains(status) || !issues.isEmpty
    }

    private func shown(_ d: AdCampaigns) -> [AdCampaign] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        return d.campaigns.filter { (c: AdCampaign) in
            if !words.isEmpty {
                var names = [c.name]
                for s in c.adsets {
                    names.append(s.name)
                    for a in s.ads { names.append(a.name) }
                }
                let text = names.joined(separator: " ").lowercased()
                if !words.allSatisfy({ (w: String) in text.contains(w) }) { return false }
            }
            switch filter {
            case .all:
                return true
            case .running:
                return c.effectiveStatus == "ACTIVE"
            case .paused:
                return c.effectiveStatus == "PAUSED"
            case .problems:
                if isProblem(c.effectiveStatus, c.issues) { return true }
                return c.adsets.contains { (s: AdSet) in
                    isProblem(s.effectiveStatus, s.issues) || s.ads.contains { (a: AdItem) in isProblem(a.effectiveStatus, a.issues) }
                }
            }
        }
    }

    // MARK: The page

    private func content(_ d: AdCampaigns) -> some View {
        #if os(macOS)
        macContent(d)
        #else
        phoneContent(d)
        #endif
    }

    private func phoneContent(_ d: AdCampaigns) -> some View {
        let cur = d.account.currency
        let list = shown(d)
        let spent = list.reduce(0.0) { (sum: Double, c: AdCampaign) in sum + c.metrics.spend }
        let views = list.reduce(0.0) { (sum: Double, c: AdCampaign) in sum + c.metrics.impressions }
        return List {
            Group {
                Section {
                    Picker("Show", selection: $filter) {
                        ForEach(Filter.allCases) { (f: Filter) in Text(f.rawValue).tag(f) }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(summary(list.count, d.campaigns.count, spent, views, cur))
                }
                Section {
                    Picker("View", selection: $gallery) {
                        Text("Campaigns").tag(false)
                        Text("Ads and pictures").tag(true)
                    }.pickerStyle(.segmented)
                    if gallery {
                        Picker("Sort", selection: $sort) {
                            Text("Most spent").tag("spend"); Text("Most results").tag("results")
                            Text("Cheapest result").tag("cost"); Text("Best ROAS").tag("roas")
                            Text("Best click-through").tag("ctr"); Text("Name").tag("name")
                        }
                    }
                }
                if let problem {
                    Section { Label(problem, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) } header: { LedgerHeading(title: "Couldn't refresh") }
                }
                if exporting || csvFile != nil {
                    Section {
                        if exporting { Label("Making the CSV…", systemImage: "tablecells") }
                        if let csvFile {
                            ShareLink(item: csvFile) { Label("Save or send \(csvFile.lastPathComponent)", systemImage: "square.and.arrow.up") }
                        }
                    }
                }
                if gallery { gallerySection(list, cur) }
                else { ForEach(list) { (c: AdCampaign) in campaignSection(c, cur) } }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .overlay {
            if list.isEmpty {
                if d.campaigns.isEmpty {
                    EmptyState("No campaigns yet", symbol: "megaphone", message: "Make the first ad from New ad.")
                } else if !search.isEmpty {
                    ContentUnavailableView.search(text: search)
                } else {
                    EmptyState("Nothing matches", symbol: "megaphone", message: "Try another filter.")
                }
            }
        }
        .refreshable { await load() }
    }

    private func summary(_ count: Int, _ all: Int, _ spent: Double, _ views: Double, _ cur: String) -> String {
        let which = count == all ? "All campaigns" : "\(count) of \(all) campaigns"
        return "\(which): \(AdsFormat.money(spent, cur)) spent · \(AdsFormat.compact(views)) views"
    }

    // MARK: A campaign

    private func campaignSection(_ c: AdCampaign, _ cur: String) -> some View {
        let goal: String? = c.adsets.count == 1 ? c.adsets[0].optimizationGoal : nil
        return Section {
            campaignRow(c, goal, cur)
            DisclosureGroup("\(c.adsets.count) ad set\(c.adsets.count == 1 ? "" : "s")", isExpanded: Binding(get: { allExpanded || expanded.contains(c.id) }, set: { on in
                allExpanded = false; if on { expanded.insert(c.id) } else { expanded.remove(c.id) }
            })) {
                ForEach(c.adsets) { (s: AdSet) in adSetRow(s, cur) }
            }
        }
    }

    /// The ad sets are counted once, on the disclosure below (CONVENTIONS rule 15).
    private func campaignRow(_ c: AdCampaign, _ goal: String?, _ cur: String) -> some View {
        let bits: [String] = [
            AdsObjective.label(c.objective),
            c.stopTime.map { (t: String) in "ends \(ShopDate.say(t))" } ?? "",
        ].filter { (s: String) in !s.isEmpty }
        return HStack(alignment: .top, spacing: pt(12)) {
            VStack(alignment: .leading, spacing: pt(4)) {
                Text(c.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                AdsStatusBadge(status: c.effectiveStatus)
                if !bits.isEmpty { Text(bits.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
                let b = budget(c.dailyBudget, c.lifetimeBudget, cur)
                if !b.isEmpty {
                    budgetButton(AdsBudgetTarget(level: "campaign", id: c.id, name: c.name, daily: c.dailyBudget,
                                                 lifetime: c.lifetimeBudget, end: c.stopTime, currency: cur), b)
                }
                numbers(c.metrics, goal: goal, before: c.previous, cur)
                issues(c.issues)
            }
            Spacer(minLength: 8)
            VStack(spacing: pt(12)) {
                runSwitch(Target(level: "campaign", id: c.id, name: c.name), status: c.status)
                detailsButton("campaign", c.id)
            }
        }
        .padding(.vertical, pt(2))
    }

    private func adSetRow(_ s: AdSet, _ cur: String) -> some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            HStack(alignment: .top, spacing: pt(12)) {
                VStack(alignment: .leading, spacing: pt(4)) {
                    Text(s.name).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: pt(6)) {
                        AdsStatusBadge(status: s.effectiveStatus)
                        if let learning = s.learning { Text(learning).font(.caption).foregroundStyle(Tone.owed.color) }
                    }
                    let b = budget(s.dailyBudget, s.lifetimeBudget, cur)
                    if !b.isEmpty {
                        budgetButton(AdsBudgetTarget(level: "adset", id: s.id, name: s.name, daily: s.dailyBudget,
                                                     lifetime: s.lifetimeBudget, end: s.endTime, currency: cur), b)
                    }
                    numbers(s.metrics, goal: s.optimizationGoal, before: nil, cur)
                    issues(s.issues)
                }
                Spacer(minLength: 8)
                VStack(spacing: pt(12)) {
                    runSwitch(Target(level: "adset", id: s.id, name: s.name), status: s.status)
                    detailsButton("adset", s.id)
                }
            }
            if !s.ads.isEmpty { adStrip(s.ads, cur) }
        }
        .padding(.leading, pt(14))
        .padding(.vertical, pt(2))
    }

    /// The ads of an ad set as pictures; each opens its own screen (previews and Meta's review notes).
    private func adStrip(_ ads: [AdItem], _ cur: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: pt(10)) {
                ForEach(ads) { (a: AdItem) in
                    Button { go = Route(path: objectPath("ad", a.id)) } label: {
                        VStack(alignment: .leading, spacing: pt(4)) {
                            StockImage(imageUrl: a.image, name: a.name, key: a.id)
                                .aspectRatio(1, contentMode: .fit)
                                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                            Text(a.name).font(.caption).fixedSize(horizontal: false, vertical: true)
                            Text(AdsFormat.money(a.metrics.spend, cur)).font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                        }
                        .frame(width: 84)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func objectPath(_ level: String, _ id: String) -> String {
        "/ads/object?level=\(level)&id=\(AdsQuery.escape(id))"
    }

    private func detailsButton(_ level: String, _ id: String) -> some View {
        Button("Details and actions", systemImage: "ellipsis.circle") { go = Route(path: objectPath(level, id)) }
            .labelStyle(.iconOnly).buttonStyle(.borderless).frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
    }

    private func gallerySection(_ campaigns: [AdCampaign], _ cur: String) -> some View {
        let ads = campaigns.flatMap(\.adsets).flatMap(\.ads).filter { ad in
            switch filter {
            case .all: return true
            case .running: return ad.effectiveStatus == "ACTIVE"
            case .paused: return ad.effectiveStatus == "PAUSED"
            case .problems: return isProblem(ad.effectiveStatus, ad.issues)
            }
        }.sorted { a, b in
            let ar = AdsResults.of(a.metrics, goal: nil)?.value ?? 0
            let br = AdsResults.of(b.metrics, goal: nil)?.value ?? 0
            switch sort {
            case "name": return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            case "results": return ar > br
            case "cost": return (ar > 0 ? a.metrics.spend / ar : Double.infinity) < (br > 0 ? b.metrics.spend / br : Double.infinity)
            case "ctr": return a.metrics.ctr > b.metrics.ctr
            case "roas": return (AdsResults.sales(a.metrics).roas ?? -1) > (AdsResults.sales(b.metrics).roas ?? -1)
            default: return a.metrics.spend > b.metrics.spend
            }
        }
        return Section {
            if sizeClass.isPadLayout {
                // The same cards in an adaptive grid: a square picture at 1,000 points wide is not an ad.
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: pt(14), alignment: .top)], spacing: pt(14)) {
                    ForEach(ads) { ad in
                        galleryCard(ad, cur).padding(pt(14)).background(Theme.card, in: .rect(cornerRadius: Radius.tile, style: .continuous))
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            } else {
                ForEach(ads) { ad in
                    galleryCard(ad, cur).padding(.vertical, pt(10))
                }
            }
        }
    }

    private func galleryCard(_ ad: AdItem, _ cur: String) -> some View {
        VStack(alignment: .leading, spacing: pt(12)) {
            Button { go = Route(path: objectPath("ad", ad.id)) } label: {
                VStack(alignment: .leading, spacing: pt(10)) {
                    StockImage(imageUrl: ad.image, name: ad.name, key: ad.id).aspectRatio(1, contentMode: .fit).clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                    Text(ad.name).font(.headline).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                }
            }.buttonStyle(.plain)
            AdsStatusBadge(status: ad.effectiveStatus)
            numbers(ad.metrics, goal: nil, before: nil, cur)
            issues(ad.issues)
            HStack {
                detailsButton("ad", ad.id)
                Spacer()
                runSwitch(Target(level: "ad", id: ad.id, name: ad.name), status: ad.status)
            }
        }
    }

    // MARK: Pieces of a row

    /// Run or pause. Pausing is at once, as the web's switch; running asks first.
    private func runSwitch(_ t: Target, status: String) -> some View {
        let on = Binding<Bool>(
            get: { (shownStatus[t.id] ?? status) == "ACTIVE" },
            set: { (wantOn: Bool) in
                if wantOn { asking = t } else { Task { await setRunning(t, running: false) } }
            }
        )
        // The switch stays where it is while Meta answers (a spinner in its place made the row jump).
        return Toggle("Running", isOn: on)
            .labelsHidden()
            .tint(Theme.accent)
            // One change at a time: a second switch mid-send would have its busy mark cleared by the first.
            .disabled(busy != nil || status == "ARCHIVED" || status == "DELETED")
            .opacity(busy == t.id ? 0.4 : 1)
    }

    /// The budget in words, as a button: it opens the budget and end date to change.
    private func budgetButton(_ t: AdsBudgetTarget, _ words: String) -> some View {
        Button { budgeting = t } label: {
            Label(words, systemImage: "pencil.circle").font(.caption.weight(.medium))
        }
        .buttonStyle(.borderless)
        .disabled(!mayChange)
    }

    /// Who may change the money: the same as the server's ads gate.
    private var mayChange: Bool { session.role == "owner" || session.role == "marketing" }

    private func budget(_ daily: Double?, _ lifetime: Double?, _ cur: String) -> String {
        if let daily, daily > 0 { return "\(AdsFormat.money(daily, cur)) a day" }
        if let lifetime, lifetime > 0 { return "\(AdsFormat.money(lifetime, cur)) in total" }
        return ""
    }

    /// "PKR 12,000 · up 18% on before · 45 chats started · PKR 266 each · 12.3k reached".
    private func numbers(_ m: AdMetrics, goal: String?, before: AdMetrics?, _ cur: String) -> some View {
        var parts: [String] = [AdsFormat.money(m.spend, cur)]
        if let change = AdsFormat.change(m.spend, before?.spend) { parts.append(change) }
        if let r = AdsResults.of(m, goal: goal) {
            parts.append("\(AdsFormat.count(r.value)) \(r.label.lowercased())")
            if r.value > 0 { parts.append("\(AdsFormat.money(m.spend / r.value, cur)) each") }
        }
        let s = AdsResults.sales(m)
        if s.value > 0 { parts.append("\(AdsFormat.money(s.value, cur)) sales · \(AdsResults.roasText(s.roas)) ROAS") }
        parts.append("\(AdsFormat.compact(m.reach)) reached")
        return Text(parts.joined(separator: " · "))
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .contentTransition(.numericText(value: m.spend))
    }

    @ViewBuilder
    private func issues(_ list: [String]) -> some View {
        ForEach(list, id: \.self) { issue in
            Label(issue, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(Tone.owed.color)
        }
    }
}


#if os(macOS)
// MARK: - The Mac's Campaigns: an outline of campaigns, ad sets and ads, the picked one in the inspector
// (docs/features/mac-design.md, "Ads"). The state, the loading and every write are the screen's above; the rows, the
// inspector and the budget editor are in Mac/Places/Ads.

extension AdsCampaignsScreen {
    // MARK: The rows

    private func macKey(_ d: AdCampaigns) -> [Int] {
        [d.campaigns.hashValue, filter.hashValue, search.hashValue, macOrder.hashValue]
    }

    private func macRowsFor(_ d: AdCampaigns) -> [AdsMacRow] {
        macRows(macKey(d)) { AdsMacTree.rows(shown(d), order: macOrder) }
    }

    private func macFlatFor(_ d: AdCampaigns) -> [AdsMacRow] {
        macFlat(macKey(d)) { AdsMacTree.flatten(macRowsFor(d)) }
    }

    /// What is picked, in the outline's order.
    private var macPicked: [AdsMacRow] {
        guard let d = data, !macSelection.isEmpty else { return [] }
        return macFlatFor(d).filter { (r: AdsMacRow) in macSelection.contains(r.id) }
    }

    private func macTarget(_ r: AdsMacRow) -> Target {
        Target(level: r.level.rawValue, id: r.id, name: r.name)
    }

    // MARK: The actions, declared once

    var macNewAd: MacAction {
        MacAction("New Ad…", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]), enabled: mayRead) {
            let route = Route(path: "/ads/new")
            if let openPlace { openPlace(route) } else { go = route }
        }
    }

    private func macActions(_ picked: [AdsMacRow], _ d: AdCampaigns) -> AdsMacActions {
        let cur = d.account.currency
        let free = busy == nil && !macWorking && mayChange
        let live = picked.filter { (r: AdsMacRow) in !r.locked }
        let running = live.filter { (r: AdsMacRow) in (shownStatus[r.id] ?? r.status) == "ACTIVE" }
        let paused = live.filter { (r: AdsMacRow) in (shownStatus[r.id] ?? r.status) != "ACTIVE" }
        let one: AdsMacRow? = picked.count == 1 ? picked[0] : nil
        let canBudget = one.map { (r: AdsMacRow) in r.level != .ad && r.hasBudget && !r.locked } ?? false

        let pause = MacAction("Pause", symbol: "pause.circle", enabled: free && !running.isEmpty) {
            for r in running { Task { await setRunning(macTarget(r), running: false) } }
        }
        let run = MacAction("Run…", symbol: "play.circle", enabled: free && !paused.isEmpty) {
            let targets = paused.map { (r: AdsMacRow) in macTarget(r) }
            if targets.count == 1 { asking = targets[0] } else { macRunMany = targets }
        }
        var next = running.isEmpty ? run : pause
        next.isDefault = true
        let budget = MacAction("Change the Budget…", symbol: "banknote", enabled: free && canBudget) {
            if let r = one {
                budgeting = AdsBudgetTarget(level: r.level.rawValue, id: r.id, name: r.name, daily: r.daily, lifetime: r.lifetime,
                                            end: r.end, currency: cur)
            }
        }
        let duplicate = MacAction("Duplicate", symbol: "doc.on.doc", shortcut: KeyboardShortcut("d", modifiers: .command),
                                  enabled: free && one != nil && !live.isEmpty) {
            if let r = one { Task { await macAct([r], "duplicate") } }
        }
        let archive = MacAction("Archive…", symbol: "archivebox", enabled: free && !live.isEmpty) {
            macConfirm = .archive(live)
        }
        let delete = MacAction("Delete…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: free && !picked.isEmpty) {
            macConfirm = .delete(picked)
        }
        let manager = MacAction("Open in Ads Manager", symbol: "arrow.up.forward.square", enabled: one != nil) {
            if let r = one, let url = AdsMacFormat.managerURL(level: r.level, id: r.id, account: d.account.id) {
                NSWorkspace.shared.open(url)
            }
        }
        return AdsMacActions(pause: pause, run: run, next: next, budget: budget, duplicate: duplicate, archive: archive,
                             delete: delete, manager: manager, newAd: macNewAd)
    }

    /// Duplicate (a paused copy), archive or delete: the route the object's own screen posts to, then the list again.
    func macAct(_ rows: [AdsMacRow], _ action: String) async {
        guard !macWorking else { return }
        macWorking = true
        defer { macWorking = false }
        do {
            for r in rows { try await AdsAPI.macObjectAction(level: r.level.rawValue, id: r.id, action: action) }
            if action != "duplicate" { macSelection.subtract(rows.map { (r: AdsMacRow) in r.id }) }
            await load()
            let what = action == "duplicate" ? "Duplicated, paused" : (action == "archive" ? "Archived" : "Deleted")
            Note.show(Note(title: what, detail: rows.count == 1 ? rows[0].name : "\(rows.count) items"), in: $note, reduce: reduceMotion)
        } catch {
            failure = error.localizedDescription
            await load()
        }
    }

    // MARK: The toolbar

    // New Ad and the one filter menu; Pause, Run and the rest of what a picked object can do are the inspector's, the Ad
    // menu's and the right-click menu's (a toolbar of seven capsules overflowed a 13-inch screen), and Refresh is ⌘R.
    @ToolbarContentBuilder
    var macToolbar: some ToolbarContent {
        if mayRead {
            ToolbarItemGroup(placement: .automatic) {
                MacToolbarAction(action: macNewAd)
                macFilterMenu
            }
        }
    }

    private var macSortField: Binding<AdsMacRowOrder.Field> {
        Binding(get: { macOrder.first?.field ?? .spend },
                set: { (f: AdsMacRowOrder.Field) in macOrder = [AdsMacRowOrder(field: f, order: f == .name || f == .status || f == .cost ? .forward : .reverse)] })
    }

    private var macFilterMenu: some View {
        Menu {
            Section("Show") {
                Picker("Show", selection: $filter) {
                    ForEach(Filter.allCases) { (f: Filter) in Text(f.rawValue).tag(f) }
                }
                .pickerStyle(.inline)
            }
            Section("Days") {
                Picker("Range", selection: $rangeKey) {
                    ForEach(AdsRange.all) { (r: AdsRange.Option) in Text(r.label).tag(r.key) }
                }
                .pickerStyle(.inline)
            }
            Section("Sort by") {
                Picker("Sort by", selection: macSortField) {
                    Text("Spent").tag(AdsMacRowOrder.Field.spend)
                    Text("Results").tag(AdsMacRowOrder.Field.results)
                    Text("Cheapest Result").tag(AdsMacRowOrder.Field.cost)
                    Text("ROAS").tag(AdsMacRowOrder.Field.roas)
                    Text("Reach").tag(AdsMacRowOrder.Field.reach)
                    Text("Budget").tag(AdsMacRowOrder.Field.budget)
                    Text("Status").tag(AdsMacRowOrder.Field.status)
                    Text("Name").tag(AdsMacRowOrder.Field.name)
                }
                .pickerStyle(.inline)
            }
            Divider()
            Toggle("Show Archived", isOn: $archived)
            Button { Task { await exportCsv() } } label: { Label("Download CSV…", systemImage: "tablecells") }
                .disabled(exporting)
        } label: {
            Label("Filter", systemImage: filter == .all && !archived ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("Which campaigns, the days the numbers cover, archived ads, and the numbers as a CSV")
    }

    // MARK: The page

    func macContent(_ d: AdCampaigns) -> some View {
        let rows = macRowsFor(d)
        let picked = macPicked
        let actions = macActions(picked, d)
        return macDialogs(
            macTable(rows, d)
                .overlay { macEmpty(d, rows) }
                .macSearchable(text: $search, prompt: "Search campaigns, ad sets, ads")
                .macSummaryBar(macSummary(rows, d, picked))
                .safeAreaInset(edge: .bottom, spacing: 0) { macFileBar }
                .macInspector { macInspectorPanel(d) }
                .macRefresh { Task { await load() } }
                .macRecordMenu(MacRecordMenu(title: "Ad", groups: actions.groups))
                .navigationSubtitle("Campaigns · " + AdsRange.label(rangeKey) + " · " + d.account.name)
        )
    }

    @ViewBuilder
    private func macEmpty(_ d: AdCampaigns, _ rows: [AdsMacRow]) -> some View {
        if rows.isEmpty {
            if d.campaigns.isEmpty {
                ContentUnavailableView("No Campaigns Yet", systemImage: "megaphone", description: Text("Make the first ad with New Ad (\u{2303}\u{2318}N)."))
            } else if !search.isEmpty {
                ContentUnavailableView.search(text: search)
            } else {
                ContentUnavailableView("Nothing Matches", systemImage: "megaphone", description: Text("Try another filter in the toolbar."))
            }
        }
    }

    /// The CSV on its way, or Meta's refusal to refresh.
    @ViewBuilder
    private var macFileBar: some View {
        if problem != nil || exporting || csvFile != nil {
            // The page's own bar at the foot, as every other (the ground, one hairline), not a grey of its own.
            MacPageFooter {
                if let problem { Label(problem, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary).lineLimit(1) }
                if exporting { Label("Making the CSV…", systemImage: "tablecells") }
                if let csvFile {
                    ShareLink(item: csvFile) { Label("Save or send \(csvFile.lastPathComponent)", systemImage: "square.and.arrow.up") }
                }
                Spacer()
            }
            .font(.callout)
        }
    }

    /// One line: the campaigns shown, or what is picked (the shallowest level picked, so a campaign and its ads are not counted twice).
    private func macSummary(_ rows: [AdsMacRow], _ d: AdCampaigns, _ picked: [AdsMacRow]) -> [String] {
        let cur = d.account.currency
        if picked.isEmpty {
            let spent = rows.reduce(0.0) { (sum: Double, r: AdsMacRow) in sum + r.metrics.spend }
            let views = rows.reduce(0.0) { (sum: Double, r: AdsMacRow) in sum + r.metrics.impressions }
            let which = rows.count == d.campaigns.count ? "\(rows.count) campaign\(rows.count == 1 ? "" : "s")" : "\(rows.count) of \(d.campaigns.count) campaigns"
            return [which, "\(AdsFormat.money(spent, cur)) spent", "\(AdsFormat.compact(views)) views"]
        }
        func depth(_ r: AdsMacRow) -> Int { r.level == .campaign ? 0 : (r.level == .adset ? 1 : 2) }
        let top = picked.map { (r: AdsMacRow) in depth(r) }.min() ?? 0
        let counted = picked.filter { (r: AdsMacRow) in depth(r) == top }
        let spent = counted.reduce(0.0) { (sum: Double, r: AdsMacRow) in sum + r.metrics.spend }
        let views = counted.reduce(0.0) { (sum: Double, r: AdsMacRow) in sum + r.metrics.impressions }
        return ["\(picked.count) selected", "\(AdsFormat.money(spent, cur)) spent", "\(AdsFormat.compact(views)) views"]
    }

    // MARK: The outline

    // The iPhone's campaign row, one line of the outline: the picture or symbol, the name over its objective and budget, the status
    // pill, what it spent over what it brought, and the run switch. Ad sets and ads fold under their campaign.
    private func macTable(_ rows: [AdsMacRow], _ d: AdCampaigns) -> some View {
        let cur = d.account.currency
        return List(rows, children: \.children, selection: $macSelection) { (r: AdsMacRow) in
            macOutlineRow(r, cur)
                .listRowBackground(Theme.card)
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            macMenu(ids, d)
        } primaryAction: { (ids: Set<String>) in
            macOpen(ids, d)
        }
    }

    private func macOutlineRow(_ r: AdsMacRow, _ cur: String) -> some View {
        let words = AdsStatusWords.of(shownStatus[r.id] ?? r.effectiveStatus)
        return HStack(spacing: 12) {
            macLead(r)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name).font(.body).lineLimit(1)
                Text(macSecondLine(r, cur)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            if !r.issues.isEmpty {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Tone.owed.color).help(r.issues.joined(separator: "\n"))
            }
            Pill(words.label, tone: AdsStatusWords.tone(words.tone))
            VStack(alignment: .trailing, spacing: 2) {
                Text(AdsFormat.money(r.metrics.spend, cur)).font(.body.weight(.semibold)).monospacedDigit().lineLimit(1)
                Text(macResultLine(r, cur)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(minWidth: 110, alignment: .trailing)
            runSwitch(macTarget(r), status: r.status)
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder
    private func macLead(_ r: AdsMacRow) -> some View {
        if r.level == .ad {
            StockImage(imageUrl: r.image, name: r.name, key: r.id)
                .frame(width: 36, height: 36)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
        } else {
            Image(systemName: r.level == .campaign ? "megaphone.fill" : "square.stack.3d.up.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 36, height: 36)
                .background(Theme.accent.opacity(0.13), in: Circle())
        }
    }

    /// "Messages · PKR 1,500 a day · ends 3 Nov", or "Ad set · …", "Ad".
    private func macSecondLine(_ r: AdsMacRow, _ cur: String) -> String {
        var parts: [String] = []
        if r.level == .campaign, let o = r.objective, !o.isEmpty { parts.append(AdsObjective.label(o)) } else { parts.append(r.level.word) }
        let b = AdsMacFormat.budget(r, cur)
        if !b.isEmpty { parts.append(b) }
        if let end = r.end, !end.isEmpty { parts.append("ends \(ShopDate.say(end))") }
        return parts.joined(separator: " · ")
    }

    /// "45 chats started · PKR 266 each".
    private func macResultLine(_ r: AdsMacRow, _ cur: String) -> String {
        let said = AdsMacFormat.result(r)
        if said.isEmpty { return "\(AdsFormat.compact(r.metrics.reach)) reached" }
        return r.resultValue > 0 ? said + " · " + AdsFormat.money(r.costEach, cur) + " each" : said
    }

    /// Return or a double-click: the object's own page, in a window of its own.
    private func macOpen(_ ids: Set<String>, _ d: AdCampaigns) {
        let picked = macFlatFor(d).filter { (r: AdsMacRow) in ids.contains(r.id) }
        for r in picked.prefix(3) {
            let route = Route(path: objectPath(r.level.rawValue, r.id))
            if let openPlace { openPlace(route) } else { go = route }
        }
    }

    @ViewBuilder
    private func macMenu(_ ids: Set<String>, _ d: AdCampaigns) -> some View {
        let picked = macFlatFor(d).filter { (r: AdsMacRow) in ids.contains(r.id) }
        if picked.isEmpty {
            MacActionItems(groups: [[macNewAd]])
        } else {
            if picked.count == 1, let r = picked.first {
                MacOpenInWindow(path: objectPath(r.level.rawValue, r.id))
                Divider()
            }
            MacActionItems(groups: macActions(picked, d).groups)
            Divider()
            Button("Copy Name", systemImage: "doc.on.doc") { MacClipboard.copy(picked.map { (r: AdsMacRow) in r.name }.joined(separator: "\n")) }
        }
    }

    // MARK: The inspector

    @ViewBuilder
    private func macInspectorPanel(_ d: AdCampaigns) -> some View {
        let picked = macPicked
        if picked.count == 1, let r = picked.first {
            let a = macActions(picked, d)
            AdsMacInspector(row: r, shownStatus: shownStatus[r.id] ?? r.effectiveStatus, currency: d.account.currency, mayChange: mayChange,
                            main: [a.next, a.duplicate], manage: [a.archive, a.delete],
                            reload: { await load() }, fail: { (m: String) in failure = m })
                .id(r.id)
        } else if picked.count > 1 {
            let a = macActions(picked, d)
            VStack(spacing: 12) {
                MacInspectorEmpty(title: "\(picked.count) Selected", detail: "Pause or run them together, or archive them.")
                MacActionButtons(actions: [a.pause, a.run, a.archive])
            }
            .padding(16)
        } else {
            MacInspectorEmpty(title: "No Campaign Selected", detail: "Click a campaign, ad set or ad to see its results and change its budget.")
        }
    }

    // MARK: What asks first

    private func macDialogs<V: View>(_ v: V) -> some View {
        v
            .confirmationDialog(macConfirmTitle, isPresented: macConfirmShown, titleVisibility: .visible, presenting: macConfirm) { (c: AdsMacConfirm) in
                Button(c.isDelete ? "Delete Permanently" : "Archive", role: c.isDelete ? .destructive : nil) {
                    Task { await macAct(c.rows, c.isDelete ? "delete" : "archive") }
                }
            } message: { (c: AdsMacConfirm) in
                Text(c.isDelete ? "Stops it and everything under it for good. This cannot be undone."
                     : "Stops it and everything under it. It stays available under Show Archived.")
            }
            .confirmationDialog("Run \(macRunMany.count) of them?", isPresented: macRunManyShown, titleVisibility: .visible) {
                Button("Run \(macRunMany.count)") {
                    let targets = macRunMany
                    macRunMany = []
                    for t in targets { Task { await setRunning(t, running: true) } }
                }
            } message: {
                Text("They will start spending their budgets.")
            }
    }

    private var macConfirmTitle: String {
        guard let c = macConfirm else { return "" }
        let what = c.rows.count == 1 ? "“\(c.rows[0].name)”" : "\(c.rows.count) items"
        return (c.isDelete ? "Delete " : "Archive ") + what + "?"
    }

    private var macConfirmShown: Binding<Bool> {
        Binding(get: { macConfirm != nil }, set: { (on: Bool) in if !on { macConfirm = nil } })
    }

    private var macRunManyShown: Binding<Bool> {
        Binding(get: { !macRunMany.isEmpty }, set: { (on: Bool) in if !on { macRunMany = [] } })
    }
}
#endif
