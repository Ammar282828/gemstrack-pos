import SwiftUI
import ERPCore

/// Ads → Campaigns (src/app/ads/campaigns/page.tsx): every campaign with its ad sets and their ads,
/// each with its status and the range's numbers against the time before, and the web's run / pause
/// switch (turning one on asks first, since it spends), and the budget and end date (AdsBudgetSheet, which
/// shows the money before and after and asks). Audience, rename, duplicate, archive and delete, and an
/// ad's previews, stay the ERP's page: one tap opens it.
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
        .navigationTitle("Campaigns")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "Search campaigns, ad sets, ads")
        .toolbar {
            if mayRead {
                ToolbarItem(placement: .primaryAction) { AdsRangeMenu(key: $rangeKey) }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Toggle("Show archived", isOn: $archived)
                        Toggle("Expand all campaigns", isOn: $allExpanded)
                        Button { go = Route(path: "/ads/new") } label: { Label("New ad", systemImage: "plus") }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
        .task(id: "\(rangeKey)|\(archived)") { if mayRead { await load() } }
        .task { if let id = AdsQuery.value("ad", in: path) { go = Route(path: objectPath("ad", id)) } }
        .confirmationDialog("Run it?", isPresented: askingShown, titleVisibility: .visible, presenting: asking) { (t: Target) in
            Button("Run") { Task { await setRunning(t, running: true) } }
        } message: { (t: Target) in
            Text("\(t.name) will start spending its budget.")
        }
        .sheet(item: $budgeting) { (t: AdsBudgetTarget) in
            AdsBudgetSheet(target: t) { await load() }
        }
        .alert("Meta didn't take that", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var askingShown: Binding<Bool> {
        Binding(get: { asking != nil }, set: { (on: Bool) in if !on { asking = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: Asking Meta

    private func load() async {
        do {
            data = try await AdsAPI.campaigns(range: rangeKey, archived: archived)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func setRunning(_ t: Target, running: Bool) async {
        busy = t.id
        defer { busy = nil }
        do {
            try await AdsAPI.setRunning(level: t.level, id: t.id, running: running)
            await load()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func failed(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Campaigns aren't ready", systemImage: "megaphone")
        } description: {
            Text(message)
        } actions: {
            Button("Try again") { Task { await load() } }.buttonStyle(.glass)
            Button("Open Setup") { go = Route(path: "/ads/setup") }.buttonStyle(.glass)
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
                            Text("Cheapest result").tag("cost"); Text("Best click-through").tag("ctr"); Text("Name").tag("name")
                        }
                    }
                }
                if let problem {
                    Section { Label(problem, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) } header: { Text("Couldn't refresh") }
                }
                if list.isEmpty {
                    Section {
                        ContentUnavailableView(d.campaigns.isEmpty ? "No campaigns yet" : "Nothing matches",
                                               systemImage: "megaphone",
                                               description: Text(d.campaigns.isEmpty ? "Make the first ad from New ad." : "Try another filter or search."))
                    }
                }
                if gallery { gallerySection(list, cur) }
                else { ForEach(list) { (c: AdCampaign) in campaignSection(c, cur) } }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
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
            DisclosureGroup("\(c.adsets.count) ad sets", isExpanded: Binding(get: { allExpanded || expanded.contains(c.id) }, set: { on in
                allExpanded = false; if on { expanded.insert(c.id) } else { expanded.remove(c.id) }
            })) {
                ForEach(c.adsets) { (s: AdSet) in adSetRow(s, cur) }
            }
        }
    }

    private func campaignRow(_ c: AdCampaign, _ goal: String?, _ cur: String) -> some View {
        let bits: [String] = [
            AdsObjective.label(c.objective),
            "\(c.adsets.count) ad set\(c.adsets.count == 1 ? "" : "s")",
            c.stopTime.map { (t: String) in "ends \(ShopDate.say(t))" } ?? "",
        ].filter { (s: String) in !s.isEmpty }
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(c.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                AdsStatusBadge(status: c.effectiveStatus)
                Text(bits.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                let b = budget(c.dailyBudget, c.lifetimeBudget, cur)
                if !b.isEmpty {
                    budgetButton(AdsBudgetTarget(level: "campaign", id: c.id, name: c.name, daily: c.dailyBudget,
                                                 lifetime: c.lifetimeBudget, end: c.stopTime, currency: cur), b)
                }
                numbers(c.metrics, goal: goal, before: c.previous, cur)
                issues(c.issues)
            }
            Spacer(minLength: 8)
            VStack(spacing: 12) {
                runSwitch(Target(level: "campaign", id: c.id, name: c.name), status: c.status)
                detailsButton("campaign", c.id)
            }
        }
        .padding(.vertical, 2)
    }

    private func adSetRow(_ s: AdSet, _ cur: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(s.name).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        AdsStatusBadge(status: s.effectiveStatus)
                        if let learning = s.learning { Text(learning).font(.caption).foregroundStyle(.orange) }
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
                VStack(spacing: 12) {
                    runSwitch(Target(level: "adset", id: s.id, name: s.name), status: s.status)
                    detailsButton("adset", s.id)
                }
            }
            if !s.ads.isEmpty { adStrip(s.ads, cur) }
        }
        .padding(.leading, 14)
        .padding(.vertical, 2)
    }

    /// The ads of an ad set as pictures; each opens the ERP's page for it (previews and Meta's review notes).
    private func adStrip(_ ads: [AdItem], _ cur: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 10) {
                ForEach(ads) { (a: AdItem) in
                    Button { go = Route(path: objectPath("ad", a.id)) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            StockImage(imageUrl: a.image, name: a.name, key: a.id)
                                .aspectRatio(1, contentMode: .fit)
                                .clipShape(.rect(cornerRadius: 10))
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
            .labelStyle(.iconOnly).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
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
            default: return a.metrics.spend > b.metrics.spend
            }
        }
        return Section {
            ForEach(ads) { ad in
                VStack(alignment: .leading, spacing: 12) {
                    Button { go = Route(path: objectPath("ad", ad.id)) } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            StockImage(imageUrl: ad.image, name: ad.name, key: ad.id).aspectRatio(1, contentMode: .fit).clipShape(.rect(cornerRadius: 16))
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
                }.padding(.vertical, 10)
            }
        }
    }

    // MARK: Pieces of a row

    /// Run or pause. Pausing is at once, as the web's switch; running asks first.
    private func runSwitch(_ t: Target, status: String) -> some View {
        let on = Binding<Bool>(
            get: { status == "ACTIVE" },
            set: { (wantOn: Bool) in
                if wantOn { asking = t } else { Task { await setRunning(t, running: false) } }
            }
        )
        return Group {
            if busy == t.id {
                SkeletonLoading()
            } else {
                Toggle("Running", isOn: on)
                    .labelsHidden()
                    .tint(Theme.accent)
                    .disabled(status == "ARCHIVED" || status == "DELETED")
            }
        }
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
        parts.append("\(AdsFormat.compact(m.reach)) reached")
        return Text(parts.joined(separator: " · "))
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
    }

    @ViewBuilder
    private func issues(_ list: [String]) -> some View {
        ForEach(list, id: \.self) { issue in
            Label(issue, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        }
    }
}
