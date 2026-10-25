import SwiftUI
import ERPCore

/// Ads → Audiences (src/app/ads/audiences/page.tsx): the ad account's audiences, and the three kinds worth making
/// from here: the shop's own customers (from the ERP's customer book, scrambled on the server before Meta sees
/// them; owners only, as the route insists), people who engaged with the house's Instagram, and lookalikes of
/// either, and website visitors from the shop's pixel (2026-10-16). Any of them can then be reached or left out on New ad → Who sees it. Making an audience spends
/// nothing; sending the customer book and deleting ask first.
struct AdsAudiencesScreen: View {
    @Environment(Session.self) private var session

    @State private var status: AdsStatusAnswer?
    @State private var data: AdsAudiencesAnswer?
    @State private var problem: String?
    @State private var loadProblem: String?
    @State private var busy: String?
    @State private var segment = "buyers"
    @State private var days = 365
    @State private var event = "ig_business_profile_all"
    @State private var webEvent = "Purchase"
    @State private var webDays = 180
    @State private var origin = ""
    @State private var percent = 1
    @State private var country = "PK"
    @State private var sendingCustomers = false
    @State private var deleting: AdsAudienceRow?
    @State private var notice: String?
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var failure: String?
    #if os(macOS)
    @State private var macPicked = Set<String>()
    @State private var macOrder = [KeyPathComparator(\AdsAudienceRow.name)]
    /// The rows in the table's order, made again only when the audiences or the sort change.
    @State private var macMade = Memo<[AdsAudienceRow]>()
    @State private var macMaking = false
    /// Which kind the New Audience sheet makes: customers, engagers, website, lookalike.
    @State private var macKind = "customers"
    #endif

    private static let countries = [
        AdsChoice(key: "PK", label: "Pakistan"), AdsChoice(key: "AE", label: "UAE"), AdsChoice(key: "SA", label: "Saudi Arabia"),
        AdsChoice(key: "GB", label: "UK"), AdsChoice(key: "US", label: "USA"), AdsChoice(key: "CA", label: "Canada"),
    ]

    private var mayUse: Bool { session.role == "owner" || session.role == "marketing" }
    private var isOwner: Bool { session.role == "owner" }

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
        .navigationTitle("Audiences")
        .navigationBarTitleDisplayMode(.inline)
        .task { if mayUse && status == nil { await load() } }
    }

    private func dialogs<V: View>(_ v: V) -> some View {
        v
            .confirmationDialog("Send “\(segmentLabel)” to Meta?", isPresented: $sendingCustomers, titleVisibility: .visible) {
                Button("Send") { Task { await make(["kind": "customers", "segment": segment], "customers") } }
                Button("Not now", role: .cancel) {}
            } message: {
                Text("The customers' phone numbers, emails and names are scrambled on the ERP's server first; Meta receives only the scrambled codes, matches them to accounts, and doesn't keep the unmatched ones. It costs nothing. The first time, Meta may ask for its Custom Audience terms to be accepted.")
            }
            .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: deletingShown, titleVisibility: .visible, presenting: deleting) { (a: AdsAudienceRow) in
                Button("Delete", role: .destructive) { Task { await remove(a) } }
            } message: { (_: AdsAudienceRow) in
                Text("Ads that reach or leave out this audience lose it and keep the rest of their targeting. This can't be undone.")
            }
            .noteToast($note)
            .onChange(of: notice) { _, now in
                guard let now else { return }
                notice = nil
                Note.show(Note(title: now), in: $note, reduce: reduceMotion)
            }
            .failureAlert($failure, title: "Meta didn't take that")
    }

    private var deletingShown: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { (on: Bool) in if !on { deleting = nil } })
    }



    private var segmentLabel: String { data?.segments.first { (s: AdsHinted) in s.key == segment }?.label ?? "customers" }

    // MARK: Asking the ERP

    private func load() async {
        do {
            let s = try await AdsAPI.status()
            status = s
            problem = nil
            if s.ready { await loadAudiences() }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func loadAudiences() async {
        do {
            data = try await AdsAPI.audiences()
            loadProblem = nil
        } catch {
            loadProblem = error.localizedDescription
        }
    }

    private func make(_ body: [String: Any], _ what: String) async {
        busy = what
        defer { busy = nil }
        do {
            let m = try await AdsAPI.makeAudience(body)
            if let sent = m.sent, sent > 0 {
                notice = "\(AdsFormat.count(sent)) customers sent (scrambled); Meta matches them over the next hour or so."
            } else {
                notice = "Audience made. Meta fills it over the next hour or so."
            }
            await loadAudiences()
        } catch {
            failure = error.localizedDescription
        }
    }

    /// Today's customers added to a customer list; ones Meta already has are ignored.
    private func refresh(_ a: AdsAudienceRow) async {
        busy = a.id
        defer { busy = nil }
        do {
            let m = try await AdsAPI.makeAudience(["kind": "refresh", "id": a.id, "segment": segment])
            notice = "\(AdsFormat.count(m.sent ?? 0)) customers sent; ones Meta already had are ignored."
            await loadAudiences()
        } catch {
            failure = error.localizedDescription
        }
    }

    private func remove(_ a: AdsAudienceRow) async {
        busy = a.id
        defer { busy = nil }
        do {
            try await AdsAPI.deleteAudience(a.id)
            await loadAudiences()
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
                        Button("Try again") { Task { await loadAudiences() } }
                    }
                }
                customersSection
                engagersSection
                websiteSection
                lookalikeSection
                listSection
            }
            .houseRows()
            .disabled(busy != nil)
        }
        .listStyle(.insetGrouped)
        .readableColumn(780)
        .refreshable { await loadAudiences() }
    }

    private func busyLabel(_ title: String, _ what: String, _ symbol: String) -> some View {
        HStack(spacing: pt(8)) {
            if busy == what { SkeletonLoading() } else { Image(systemName: symbol) }
            Text(title)
        }
    }

    var customersSection: some View {
        Section {
            if isOwner {
                ForEach(data?.segments ?? []) { (seg: AdsHinted) in
                    Button { segment = seg.key } label: {
                        HStack(alignment: .top, spacing: pt(10)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(seg.label).foregroundStyle(.primary)
                                Text(seg.hint).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            if seg.key == segment { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                        }
                    }
                }
                Button { sendingCustomers = true } label: { busyLabel("Make “\(segmentLabel)”", "customers", "checkmark.shield") }
                    .disabled(data == nil)
            } else {
                Text("Only an owner can send the customer book to Meta.").foregroundStyle(.secondary)
            }
        } header: {
            LedgerHeading(title: "\(session.shop.name)'s customers")
        } footer: {
            Text("Show ads to people who already buy from the shop, or leave them out of ads meant for new people. From the ERP's customer book: phones and emails are scrambled (SHA-256) on the server before anything goes to Meta, which only matches them to accounts.")
        }
    }

    private var engagersSection: some View {
        Section {
            Picker("Who", selection: $event) {
                ForEach(data?.events ?? []) { (e: AdsChoice) in Text(e.label).tag(e.key) }
            }
            Picker("In the last", selection: $days) {
                Text("30 days").tag(30)
                Text("90 days").tag(90)
                Text("180 days").tag(180)
                Text("Year").tag(365)
                Text("2 years").tag(730)
            }
            Button { Task { await make(["kind": "engagers", "days": days, "event": event], "engagers") } } label: {
                busyLabel("Make the engagers audience", "engagers", "camera")
            }
            .disabled(data == nil)
        } header: {
            LedgerHeading(title: data?.instagram.map { (ig: String) in "Instagram engagers · @\(ig)" } ?? "Instagram engagers")
        }
    }

    /// People the pixel saw on the website (audiences/page.tsx "Website visitors"): to show ads again to the ones who
    /// looked or carted and didn't buy, or to make a lookalike of the buyers. Meta keeps them up to 180 days.
    private var websiteSection: some View {
        Section {
            if let data, !data.pixel {
                Text("Choose the shop's pixel on Setup first.").foregroundStyle(.secondary)
            } else {
                ForEach(data?.websiteEvents ?? []) { (e: AdsHinted) in
                    Button { webEvent = e.key } label: {
                        HStack(alignment: .top, spacing: pt(10)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.label).foregroundStyle(.primary)
                                Text(e.hint).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            if e.key == webEvent { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                        }
                    }
                }
                Picker("In the last", selection: $webDays) {
                    ForEach([7, 14, 30, 60, 90, 180], id: \.self) { (d: Int) in Text("\(d) days").tag(d) }
                }
                Button { Task { await make(["kind": "website", "days": webDays, "event": webEvent], "website") } } label: {
                    busyLabel("Make the website audience", "website", "globe")
                }
                .disabled(data == nil)
            }
        } header: {
            LedgerHeading(title: "Website visitors")
        }
    }

    private var seeds: [AdsAudienceRow] { (data?.audiences ?? []).filter { (a: AdsAudienceRow) in a.kind != "Lookalike" } }

    private var lookalikeSection: some View {
        Section {
            Picker("Like which audience", selection: $origin) {
                Text("Choose one").tag("")
                ForEach(seeds) { (a: AdsAudienceRow) in
                    Text(a.sizeWords.map { (w: String) in "\(a.name) (\(w))" } ?? a.name).tag(a.id)
                }
            }
            Picker("How alike", selection: $percent) {
                ForEach([1, 2, 3, 5, 10], id: \.self) { (p: Int) in Text("\(p)%").tag(p) }
            }
            .pickerStyle(.segmented)
            Picker("Country", selection: $country) {
                ForEach(Self.countries) { (c: AdsChoice) in Text(c.label).tag(c.key) }
            }
            Button { Task { await make(["kind": "lookalike", "origin": origin, "percent": percent, "country": country], "lookalike") } } label: {
                busyLabel("Make the lookalike", "lookalike", "sparkles")
            }
            .disabled(origin.isEmpty)
        } header: {
            LedgerHeading(title: "Lookalike")
        } footer: {
            Text("1% is the closest match. Meta needs at least 100 matched people in the country to start from.")
        }
    }

    private var listSection: some View {
        Section {
            if let data {
                if data.audiences.isEmpty {
                    Text("No audiences yet.").foregroundStyle(.secondary)
                }
                ForEach(data.audiences) { (a: AdsAudienceRow) in audienceRow(a) }
            } else if loadProblem == nil {
                MarketingReading(text: "Reading the audiences…")
            }
        } header: {
            LedgerHeading(title: "In the ad account")
        }
    }

    private func audienceRow(_ a: AdsAudienceRow) -> some View {
        let size = a.sizeWords.map { (w: String) in "\(w) people" } ?? "size not known yet"
        let made = a.created.map { (c: String) in ShopDate.say(c) } ?? ""
        let line = [a.kind, size, made].filter { (s: String) in !s.isEmpty }.joined(separator: " · ")
        return HStack(spacing: pt(10)) {
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name)
                Text(line).font(.caption).foregroundStyle(.secondary)
                if let st = a.status { Text(st).font(.caption).foregroundStyle(Tone.owed.color) }
            }
            Spacer(minLength: 8)
            if busy == a.id {
                SkeletonLoading()
            } else {
                if a.kind == "Customer list" && isOwner {
                    Button { Task { await refresh(a) } } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Add today's customers")
                }
                Button { deleting = a } label: { Image(systemName: "trash").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Delete \(a.name)")
            }
        }
    }
}

#if os(macOS)
// MARK: - The Mac's Audiences: the ad account's audiences as a table with the picked one in the inspector, and a new
// audience made in a short sheet whose button says what it will do (the customer book's privacy is told in the sheet,
// so nothing asks a second time).

extension AdsAudiencesScreen {
    private var macRows: [AdsAudienceRow] {
        let all = data?.audiences ?? []
        return macMade([all.hashValue, macOrder.hashValue]) { all.sorted(using: macOrder) }
    }
    private var macPickedRows: [AdsAudienceRow] { macRows.filter { (a: AdsAudienceRow) in macPicked.contains(a.id) } }

    private var macNewAudience: MacAction {
        MacAction("New Audience…", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                  enabled: busy == nil && data != nil) {
            macMaking = true
        }
    }

    private func macActions(_ picked: [AdsAudienceRow]) -> [[MacAction]] {
        let one: AdsAudienceRow? = picked.count == 1 ? picked[0] : nil
        let refreshable = one.map { (a: AdsAudienceRow) in a.kind == "Customer list" && isOwner } ?? false
        let add = MacAction("Add Today's Customers", symbol: "arrow.clockwise", enabled: refreshable && busy == nil) {
            if let a = one { Task { await refresh(a) } }
        }
        let copy = MacAction("Copy Name", symbol: "doc.on.doc", enabled: !picked.isEmpty) {
            MacClipboard.copy(picked.map { (a: AdsAudienceRow) in a.name }.joined(separator: "\n"))
        }
        let delete = MacAction("Delete…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: one != nil && busy == nil) {
            if let a = one { deleting = a }
        }
        return [[add, copy], [delete], [macNewAudience]]
    }

    func macContent(_ s: AdsStatusAnswer) -> some View {
        let rows = macRows
        let picked = macPickedRows
        return VStack(spacing: 0) {
            AdsMacAlertBar(status: s)
            if let loadProblem {
                Label(loadProblem, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Tone.problem.color)
                    .padding(8)
            }
            macTable(rows)
        }
        .macInspector { macInspectorPanel(picked) }
        .macRefresh { Task { await loadAudiences() } }
        .macRecordMenu(MacRecordMenu(title: "Audience", groups: macActions(picked)))
        .macSummaryBar(["\(rows.count) audience\(rows.count == 1 ? "" : "s") in the ad account"])
        .navigationSubtitle(data.map { (d: AdsAudiencesAnswer) in "\(d.audiences.count) in the ad account" } ?? "")
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                MacToolbarAction(action: macNewAudience)
            }
        }
        .disabled(busy != nil)
        .sheet(isPresented: $macMaking) { macNewSheet }
    }

    private func macTable(_ rows: [AdsAudienceRow]) -> some View {
        Table(rows, selection: $macPicked, sortOrder: $macOrder) {
            TableColumn("Audience", value: \.name) { (a: AdsAudienceRow) in
                VStack(alignment: .leading, spacing: 1) {
                    Text(a.name).lineLimit(1)
                    if let st = a.status { Text(st).font(.caption).foregroundStyle(Tone.owed.color) }
                }
            }
            .width(min: 160, ideal: 280)
            TableColumn("Kind", value: \.kind) { (a: AdsAudienceRow) in Text(a.kind) }
                .width(min: 90, ideal: 130)
            TableColumn("People") { (a: AdsAudienceRow) in
                Text(a.sizeWords ?? "not known yet").monospacedDigit().foregroundStyle(a.sizeWords == nil ? Color.secondary : Color.primary)
            }
            .width(min: 90, ideal: 120)
            TableColumn("Made") { (a: AdsAudienceRow) in Text(a.created.map { (c: String) in ShopDate.say(c) } ?? "") }
                .width(min: 80, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            let picked = macRows.filter { (a: AdsAudienceRow) in ids.contains(a.id) }
            MacActionItems(groups: macActions(picked))
        }
        .overlay {
            if let data, data.audiences.isEmpty {
                ContentUnavailableView("No Audiences Yet", systemImage: "person.2", description: Text("New Audience (\u{2303}\u{2318}N) makes one."))
            } else if data == nil && loadProblem == nil {
                MarketingReading(text: "Reading the audiences…")
            }
        }
    }

    // MARK: The inspector

    @ViewBuilder
    private func macInspectorPanel(_ picked: [AdsAudienceRow]) -> some View {
        if picked.count == 1, let a = picked.first {
            let actions = macActions(picked)
            VStack(alignment: .leading, spacing: 14) {
                MacInspectorHeader(title: a.name, subtitle: a.kind,
                                   status: a.status.map { (st: String) in MacStatus(st, tone: .owed) },
                                   headline: MacHeadline("People", a.sizeWords ?? "not known yet"),
                                   actions: a.kind == "Customer list" && isOwner ? [actions[0][0], actions[1][0]] : [actions[1][0]])
                LabeledContent("Made", value: a.created.map { (c: String) in ShopDate.say(c) } ?? "")
                Text(macAbout(a)).font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            MacInspectorEmpty(title: macPicked.count > 1 ? "\(macPicked.count) Selected" : "No Audience Selected",
                              detail: "Click an audience to see it. Pick it on a new ad under Who Sees It.")
        }
    }

    private func macAbout(_ a: AdsAudienceRow) -> String {
        switch a.kind {
        case "Customer list": return "The shop's customers, as Meta matched them. Add today's customers to bring it up to date."
        case "Lookalike": return "People like an audience of the shop's, found by Meta."
        default: return "Any ad can reach this audience, or leave it out, from its Who Sees It."
        }
    }

    // MARK: A new audience

    private var macKinds: [(key: String, label: String)] {
        var out: [(key: String, label: String)] = []
        if isOwner { out.append((key: "customers", label: "The Shop's Customers")) }
        out.append((key: "engagers", label: "Instagram Engagers"))
        out.append((key: "website", label: "Website Visitors"))
        out.append((key: "lookalike", label: "Lookalike"))
        return out
    }

    /// What the sheet's button says, and does.
    private var macMakeTitle: String {
        switch macKind {
        case "customers": return "Send “\(segmentLabel)” to Meta"
        case "engagers": return "Make the Engagers Audience"
        case "website": return "Make the Website Audience"
        default: return "Make the Lookalike"
        }
    }

    private var macMakeDisabled: Bool {
        if data == nil || busy != nil { return true }
        switch macKind {
        case "website": return data?.pixel != true
        case "lookalike": return origin.isEmpty
        default: return false
        }
    }

    private func macMake() {
        macMaking = false
        switch macKind {
        case "customers": Task { await make(["kind": "customers", "segment": segment], "customers") }
        case "engagers": Task { await make(["kind": "engagers", "days": days, "event": event], "engagers") }
        case "website": Task { await make(["kind": "website", "days": webDays, "event": webEvent], "website") }
        default: Task { await make(["kind": "lookalike", "origin": origin, "percent": percent, "country": country], "lookalike") }
        }
    }

    private var macNewSheet: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    Picker("Audience of", selection: $macKind) {
                        ForEach(macKinds, id: \.key) { (k: (key: String, label: String)) in Text(k.label).tag(k.key) }
                    }
                    .pickerStyle(.menu)
                }
                macKindFields
            }
            .formStyle(.grouped)
            AdsMacSheetFooter(title: macMakeTitle, disabled: macMakeDisabled, cancel: { macMaking = false }) { macMake() }
        }
        .frame(width: 480, height: 440)
        .onAppear { if macKind == "customers" && !isOwner { macKind = "engagers" } }
    }

    @ViewBuilder
    private var macKindFields: some View {
        switch macKind {
        case "customers":
            Section {
                Picker("Customers", selection: $segment) {
                    ForEach(data?.segments ?? []) { (seg: AdsHinted) in Text(seg.label).tag(seg.key) }
                }
                .pickerStyle(.menu)
                if let hint = data?.segments.first(where: { (seg: AdsHinted) in seg.key == segment })?.hint {
                    Text(hint).font(.caption).foregroundStyle(.secondary)
                }
                Text("Show ads to people who already buy from the shop, or leave them out of ads meant for new people. The customers' phone numbers, emails and names are scrambled (SHA-256) on the ERP's server first; Meta receives only the scrambled codes, matches them to accounts, and doesn't keep the unmatched ones. It costs nothing. The first time, Meta may ask for its Custom Audience terms to be accepted.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        case "engagers":
            Section {
                Picker(data?.instagram.map { (ig: String) in "Who on @\(ig)" } ?? "Who", selection: $event) {
                    ForEach(data?.events ?? []) { (e: AdsChoice) in Text(e.label).tag(e.key) }
                }
                .pickerStyle(.menu)
                Picker("In the last", selection: $days) {
                    Text("30 days").tag(30)
                    Text("90 days").tag(90)
                    Text("180 days").tag(180)
                    Text("Year").tag(365)
                    Text("2 years").tag(730)
                }
                .pickerStyle(.menu)
            }
        case "website":
            Section {
                if let data, !data.pixel {
                    Text("Choose the shop's pixel on Setup first.").foregroundStyle(.secondary)
                } else {
                    Picker("Visitors who", selection: $webEvent) {
                        ForEach(data?.websiteEvents ?? []) { (e: AdsHinted) in Text(e.label).tag(e.key) }
                    }
                    .pickerStyle(.menu)
                    if let hint = data?.websiteEvents.first(where: { (e: AdsHinted) in e.key == webEvent })?.hint {
                        Text(hint).font(.caption).foregroundStyle(.secondary)
                    }
                    Picker("In the last", selection: $webDays) {
                        ForEach([7, 14, 30, 60, 90, 180], id: \.self) { (d: Int) in Text("\(d) days").tag(d) }
                    }
                    .pickerStyle(.menu)
                }
            }
        default:
            Section {
                Picker("Like which audience", selection: $origin) {
                    Text("Choose one").tag("")
                    ForEach(seeds) { (a: AdsAudienceRow) in
                        Text(a.sizeWords.map { (w: String) in "\(a.name) (\(w))" } ?? a.name).tag(a.id)
                    }
                }
                .pickerStyle(.menu)
                Picker("How alike", selection: $percent) {
                    ForEach([1, 2, 3, 5, 10], id: \.self) { (p: Int) in Text("\(p)%").tag(p) }
                }
                .pickerStyle(.menu)
                Picker("Country", selection: $country) {
                    ForEach(Self.countries) { (c: AdsChoice) in Text(c.label).tag(c.key) }
                }
                .pickerStyle(.menu)
                Text("1% is the closest match. Meta needs at least 100 matched people in the country to start from.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
#endif
