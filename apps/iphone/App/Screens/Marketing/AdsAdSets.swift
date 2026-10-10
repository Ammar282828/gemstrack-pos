import SwiftUI
import ERPCore

/// One ad set of the designer (lib/ads/adset-design.ts AdSetDraft), with its dates as the phone picks them.
struct AdsSetDraft: Identifiable, Hashable {
    let key: String
    var name: String
    var goal: String
    var audience: AdsAudience
    var budgetKind = "daily"
    var amount = "1000"
    var start: Date?
    var end: Date?
    var id: String { key }

    /// The next card: the one before it with a new name, so a test changes one thing at a time (nextAdSet).
    func next(_ n: Int) -> AdsSetDraft {
        AdsSetDraft(key: UUID().uuidString, name: "Ad set \(n)", goal: goal, audience: audience,
                    budgetKind: budgetKind, amount: amount, start: start, end: end)
    }

    var json: [String: Any] {
        var b = AdsBudget()
        b.kind = budgetKind
        b.amount = AdsAmount.parse(amount) ?? 0
        b.start = start.map { (d: Date) in d.ISO8601Format() }
        b.end = end.map { (d: Date) in d.ISO8601Format() }
        var o: [String: Any] = [:]
        o["key"] = key
        o["name"] = name
        o["goal"] = goal
        o["audience"] = audience.json
        o["budget"] = b.json
        return o
    }
}

/// Ads → Ad sets (src/app/ads/adset/page.tsx): one or several ad sets, each its own audience, places, budget,
/// dates and goal, into a campaign the account has or a new one, filled with copies of ads already made or an
/// Instagram post boosted. The usual use is a test: the same ad to two or three audiences side by side.
/// `?campaign=` and `?ads=` start in a campaign with chosen ads (after a new ad), `?from=<ad set>` from a copy of
/// one ("Copy and change"). The server checks the design and says what it will make and cost (/api/ads/plan)
/// before the counter agrees; only then /api/ads/adsets makes it, deleting anything half-made on a failure.
struct AdsAdSetsScreen: View {
    let path: String

    @Environment(Session.self) private var session

    @State private var status: AdsStatusAnswer?
    @State private var lists: AdsNewAdLists?
    @State private var info: AdsAdsetsInfo?
    @State private var tree: AdCampaigns?
    @State private var treeError: String?
    @State private var problem: String?
    @State private var started = false

    @State private var target = "new"
    @State private var campaign: AdsAdsetsInfo.Campaign?
    @State private var campaignName = ""
    @State private var sets: [AdsSetDraft] = [AdsSetDraft(key: UUID().uuidString, name: "Ad set 1", goal: "whatsapp", audience: AdsAudience())]
    @State private var editing: AdsSetDraft?
    @State private var adsKind = "copy"
    @State private var adIds: [String] = []
    @State private var adQ = ""
    @State private var media: [AdsMedia]?
    @State private var post = ""
    @State private var link = ""
    @State private var launch = "paused"

    @State private var checking = false
    @State private var check: AdsDesignCheck?
    @State private var confirming = false
    @State private var sending = false
    @State private var made: AdsDesignMade?
    @State private var failure: String?

    private var mayUse: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        dialogs(page)
    }

    private var page: some View {
        Group {
            if !mayUse {
                AdsOwnersOnly()
            } else if let made {
                madeView(made)
            } else if let status, status.ready, let lists, info != nil {
                form(lists)
            } else {
                AdsNotReady(status: status, problem: problem, retry: load)
            }
        }
        .navigationTitle("Ad sets")
        .navigationBarTitleDisplayMode(.inline)
        .task { if mayUse && status == nil { await load() } }
        .task(id: adsKind) { if adsKind == "post" && media == nil && lists != nil { await loadMedia() } }
        .onChange(of: allowedKeys) { _, _ in fitGoals() }
    }

    private func dialogs<V: View>(_ v: V) -> some View {
        v
            .sheet(item: $editing) { (s: AdsSetDraft) in
                AdsAudienceSheet(title: s.name.isEmpty ? "Who sees it" : s.name, draft: s.audience,
                                 goal: lists?.goal(s.goal)?.optimization ?? "REACH", positions: lists?.igPositions ?? []) { (a: AdsAudience) in
                    if let i = sets.firstIndex(where: { (x: AdsSetDraft) in x.key == s.key }) { sets[i].audience = a }
                }
            }
            .confirmationDialog(launch == "live" ? "Make them and run them?" : "Make these ad sets?", isPresented: $confirming, titleVisibility: .visible) {
                Button(launch == "live" ? "Make them and run them" : "Make them, paused") { Task { await send() } }
                Button("Not yet", role: .cancel) {}
            } message: {
                Text((check?.summary ?? []).joined(separator: "\n"))
            }
            .alert("That didn't work", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: Reading

    private var currency: String { info?.currency ?? status?.currency ?? "PKR" }
    private var budgeted: Bool { target != "new" && (campaign?.budgeted ?? false) }

    /// The goals an ad set can have here: Meta fixes the objective per campaign (goalsForObjective), and a boosted
    /// post can't carry some goals, copies of ads others.
    private var allowed: [AdsGoal] {
        let all = lists?.goals ?? []
        let base = target != "new" && campaign != nil ? all.filter { (g: AdsGoal) in g.objective == campaign?.objective } : all
        return base.filter { (g: AdsGoal) in adsKind == "post" ? !g.photosOnly : !g.postOnly }
    }

    private var allowedKeys: [String] { allowed.map { (g: AdsGoal) in g.key } }

    private func fitGoals() {
        guard let first = allowed.first else { return }
        for i in sets.indices where !allowedKeys.contains(sets[i].goal) { sets[i].goal = first.key }
    }

    private var design: [String: Any] {
        var c: [String: Any] = [:]
        if target == "new" {
            c["kind"] = "new"
            c["name"] = campaignName
        } else {
            c["kind"] = "existing"
            c["id"] = target
            c["objective"] = campaign?.objective ?? ""
            c["budgeted"] = campaign?.budgeted ?? false
            c["name"] = campaign?.name ?? ""
        }
        var ads: [String: Any] = [:]
        if adsKind == "copy" {
            ads["kind"] = "copy"
            ads["ids"] = adIds
        } else {
            ads["kind"] = "post"
            ads["mediaId"] = post
            ads["link"] = link
        }
        var d: [String: Any] = [:]
        d["campaign"] = c
        d["adsets"] = sets.map { (s: AdsSetDraft) in s.json }
        d["ads"] = ads
        d["launch"] = launch
        return d
    }

    private var adCount: Int { sets.count * (adsKind == "copy" ? adIds.count : 1) }

    private struct AdRow: Identifiable {
        let ad: AdItem
        let place: String
        var id: String { ad.id }
    }

    /// Every ad in the account (the last 30 days' tree), the chosen ones first.
    private var shownAds: [AdRow] {
        var rows: [AdRow] = []
        for c in tree?.campaigns ?? [] {
            for s in c.adsets {
                for a in s.ads { rows.append(AdRow(ad: a, place: "\(c.name) › \(s.name)")) }
            }
        }
        let words = adQ.lowercased().split(separator: " ").map(String.init)
        let hits = rows.filter { (r: AdRow) in
            let hay = "\(r.ad.name) \(r.place)".lowercased()
            return words.allSatisfy { (w: String) in hay.contains(w) }
        }
        let chosen = hits.filter { (r: AdRow) in adIds.contains(r.ad.id) }
        let rest = hits.filter { (r: AdRow) in !adIds.contains(r.ad.id) }
        return Array((chosen + rest).prefix(60))
    }

    // MARK: Asking the ERP

    private func load() async {
        do {
            let s = try await AdsAPI.status()
            status = s
            problem = nil
            guard s.ready else { return }
            if lists == nil { lists = try await AdsAPI.newAdLists() }
            if !started { try await begin() }
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Once: the campaign, the ad set to start from and the chosen ads from the path; then every ad to copy from.
    private func begin() async throws {
        let from = AdsQuery.value("from", in: path)
        let inCampaign = AdsQuery.value("campaign", in: path)
        if let ads = AdsQuery.value("ads", in: path) {
            adIds = ads.split(separator: ",").map(String.init).filter { (x: String) in !x.isEmpty && x.allSatisfy(\.isNumber) }
        }
        if let inCampaign { target = inCampaign }
        let i = try await AdsAPI.adsetsInfo(campaign: inCampaign, from: from)
        info = i
        started = true
        if from != nil, let d = i.draft {
            sets = [AdsSetDraft(key: UUID().uuidString, name: d.name, goal: d.goal, audience: d.audience, budgetKind: d.budget.kind,
                                amount: AdsAmount.field(d.budget.amount), start: nil, end: ERPDate.parse(d.budget.end))]
            if !i.ads.isEmpty { adIds = i.ads }
        }
        if let c = i.campaign {
            target = c.id
            campaign = c
        }
        do {
            tree = try await AdsAPI.campaigns(range: "last_30d", archived: false)
        } catch {
            treeError = error.localizedDescription
        }
        fitGoals()
    }

    private func loadMedia() async {
        media = ((try? await AdsAPI.media(after: nil))?.media ?? []).filter { (m: AdsMedia) in m.boostable != false }
    }

    private func pickCampaign(_ id: String) {
        target = id
        if id == "new" {
            campaign = nil
            return
        }
        if let c = tree?.campaigns.first(where: { (x: AdCampaign) in x.id == id }) {
            campaign = AdsAdsetsInfo.Campaign(id: c.id, name: c.name, objective: c.objective,
                                              budgeted: (c.dailyBudget ?? 0) > 0 || (c.lifetimeBudget ?? 0) > 0)
        }
    }

    private var campaignChoice: Binding<String> {
        Binding(get: { target }, set: { (id: String) in pickCampaign(id) })
    }

    private func review() async {
        checking = true
        defer { checking = false }
        do {
            let c = try await AdsAPI.check(design: design)
            check = c
            if c.problems.isEmpty { confirming = true }
        } catch {
            failure = error.localizedDescription
        }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            made = try await AdsAPI.makeAdsets(design: design)
        } catch {
            failure = "Nothing was made. \(error.localizedDescription)"
        }
    }

    // MARK: The form

    private func form(_ l: AdsNewAdLists) -> some View {
        List {
            Group {
                if let s = status { AdsAlertsSection(status: s) }
                campaignSection
                ForEach($sets) { (s: Binding<AdsSetDraft>) in
                    let key = s.wrappedValue.key
                    AdsSetCard(draft: s, number: (sets.firstIndex(where: { (x: AdsSetDraft) in x.key == key }) ?? 0) + 1,
                               goals: allowed, budgeted: budgeted, currency: currency, removable: sets.count > 1,
                               audience: { editing = s.wrappedValue },
                               remove: { sets.removeAll { (x: AdsSetDraft) in x.key == key } })
                }
                Section {
                    Button {
                        if let last = sets.last { sets.append(last.next(sets.count + 1)) }
                    } label: {
                        Label("Another ad set", systemImage: "plus")
                    }
                    .disabled(sets.count >= 6)
                } footer: {
                    Text("It starts as a copy of the last, so a test changes one thing. Six at most.")
                }
                adsSection
                makeSections
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
    }

    private var campaignSection: some View {
        Section {
            Picker("Campaign", selection: campaignChoice) {
                Text("A new campaign").tag("new")
                ForEach((tree?.campaigns ?? []).filter { (c: AdCampaign) in c.status != "ARCHIVED" }) { (c: AdCampaign) in
                    Text("\(c.name) · \(AdsObjective.label(c.objective))").tag(c.id)
                }
                if let c = campaign, !(tree?.campaigns ?? []).contains(where: { (x: AdCampaign) in x.id == c.id }) {
                    Text(c.name).tag(c.id)
                }
            }
            if target == "new" {
                TextField("Campaign name", text: $campaignName)
            }
            if let treeError {
                Text("The account's campaigns didn't come: \(treeError)").font(.footnote).foregroundStyle(.red)
            }
        } header: {
            LedgerHeading(title: "Campaign")
        } footer: {
            if budgeted { Text("This campaign holds the budget; its ad sets share it.") }
        }
    }

    private var adsSection: some View {
        Section {
            Picker("Ads in them", selection: $adsKind) {
                Text("Copies of ads").tag("copy")
                Text("An Instagram post").tag("post")
            }
            .pickerStyle(.segmented)
            if adsKind == "copy" {
                copyRows
            } else {
                postRows
            }
        } header: {
            LedgerHeading(title: "Ads in them")
        } footer: {
            Text(adsKind == "copy" ? "\(adIds.count) chosen: a copy of each goes into every ad set." : "The post runs as it is in every ad set.")
        }
    }

    @ViewBuilder
    private var copyRows: some View {
        if tree == nil && treeError == nil {
            MarketingReading(text: "Reading the account's ads…")
        } else {
            TextField("Find an ad", text: $adQ).autocorrectionDisabled()
            ForEach(shownAds) { (r: AdRow) in
                let on = adIds.contains(r.ad.id)
                Button {
                    if on { adIds.removeAll { (x: String) in x == r.ad.id } } else { adIds.append(r.ad.id) }
                } label: {
                    HStack(spacing: 10) {
                        StockImage(imageUrl: r.ad.image, name: r.ad.name, key: r.ad.id)
                            .frame(width: 44, height: 44)
                            .clipShape(.rect(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.ad.name).foregroundStyle(.primary).lineLimit(2)
                            Text(r.place).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Theme.accent : Color.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var postRows: some View {
        if let media {
            AdsMediaGrid(media: media, chosen: post.isEmpty ? nil : post) { (m: AdsMedia) in post = post == m.id ? "" : m.id }
            if sets.contains(where: { (s: AdsSetDraft) in lists?.goal(s.goal)?.toSite == true || s.goal == "channel" }) {
                TextField("https://… where the button goes", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
        } else {
            MarketingReading(text: "Reading Instagram…")
        }
    }

    @ViewBuilder
    private var makeSections: some View {
        Section {
            Picker("Launch", selection: $launch) {
                Text("Make them paused").tag("paused")
                Text("Run them once approved").tag("live")
            }
            .pickerStyle(.segmented)
        } footer: {
            Text(launch == "paused" ? "Nothing is spent until they are switched on in Campaigns." : "They start once Meta approves them and spend their budgets from then.")
        }
        AdsProblemsSection(problems: check?.problems ?? [])
        Section {
            Button { Task { await review() } } label: {
                HStack(spacing: 8) {
                    if checking || sending { SkeletonLoading() }
                    Text("Review: \(sets.count) ad set\(sets.count == 1 ? "" : "s") · \(adCount) ad\(adCount == 1 ? "" : "s")")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .disabled(checking || sending)
            .listRowBackground(Color.clear)
        }
    }

    // MARK: Made

    private func madeView(_ m: AdsDesignMade) -> some View {
        List {
            Group {
                Section {
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(.green)
                        Text("\(m.adsets.count) ad set\(m.adsets.count == 1 ? "" : "s") made\(m.live ? "" : ", paused")").font(.headline)
                        ForEach(m.warnings, id: \.self) { (w: String) in
                            Text(w).font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                Section {
                    ForEach(m.adsets) { (s: AdsDesignMade.Made) in
                        LabeledContent(s.name, value: "\(s.ads.count) ad\(s.ads.count == 1 ? "" : "s")")
                    }
                }
                Section {
                    MarketingLink(title: "See them in Campaigns", symbol: "checklist", path: "/ads/campaigns")
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }
}

/// One ad set's card: its name, goal, budget (unless the campaign holds it), dates and audience.
private struct AdsSetCard: View {
    @Binding var draft: AdsSetDraft
    let number: Int
    let goals: [AdsGoal]
    let budgeted: Bool
    let currency: String
    let removable: Bool
    let audience: () -> Void
    let remove: () -> Void

    private var startOn: Binding<Bool> {
        Binding(get: { draft.start != nil }, set: { (on: Bool) in draft.start = on ? Self.dayStart(Date()) : nil })
    }

    private var endOn: Binding<Bool> {
        Binding(get: { draft.end != nil }, set: { (on: Bool) in draft.end = on ? Self.dayEnd(Date().addingTimeInterval(7 * 86_400)) : nil })
    }

    private var startDay: Binding<Date> {
        Binding(get: { draft.start ?? Date() }, set: { (d: Date) in draft.start = Self.dayStart(d) })
    }

    private var endDay: Binding<Date> {
        Binding(get: { draft.end ?? Date() }, set: { (d: Date) in draft.end = Self.dayEnd(d) })
    }

    /// A day's first minute and last minute in Karachi, as the web's date boxes send them.
    private static func dayStart(_ d: Date) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ERPDate.karachi
        return cal.startOfDay(for: d)
    }

    private static func dayEnd(_ d: Date) -> Date { dayStart(d).addingTimeInterval(86_400 - 60) }

    var body: some View {
        Section {
            TextField("Ad set name", text: $draft.name)
            Picker("Goal", selection: $draft.goal) {
                ForEach(goals) { (g: AdsGoal) in Text(g.label).tag(g.key) }
            }
            if !budgeted {
                Picker("Budget", selection: $draft.budgetKind) {
                    Text("A day").tag("daily")
                    Text("In total").tag("total")
                }
                .pickerStyle(.segmented)
                LabeledContent(draft.budgetKind == "daily" ? "A day (\(currency))" : "In total (\(currency))") {
                    TextField("Amount", text: $draft.amount)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                }
            }
            Toggle("Starts on a day", isOn: startOn).tint(Theme.accent)
            if draft.start != nil {
                DatePicker("From", selection: startDay, displayedComponents: .date)
                    .environment(\.timeZone, ERPDate.karachi)
            }
            Toggle("Ends on a day", isOn: endOn).tint(Theme.accent)
            if draft.end != nil {
                DatePicker("To", selection: endDay, in: Date()..., displayedComponents: .date)
                    .environment(\.timeZone, ERPDate.karachi)
            }
            Button(action: audience) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Who sees it").foregroundStyle(.primary)
                        Text(draft.audience.words).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                }
            }
            if removable {
                Button(role: .destructive, action: remove) { Label("Remove this ad set", systemImage: "trash") }
            }
        } header: {
            LedgerHeading(title: "Ad set \(number)")
        }
    }
}
