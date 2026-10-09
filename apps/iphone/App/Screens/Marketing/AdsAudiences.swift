import SwiftUI
import ERPCore

/// Ads → Audiences (src/app/ads/audiences/page.tsx): the ad account's audiences, and the three kinds worth making
/// from here: the shop's own customers (from the ERP's customer book, scrambled on the server before Meta sees
/// them; owners only, as the route insists), people who engaged with the house's Instagram, and lookalikes of
/// either. Any of them can then be reached or left out on New ad → Who sees it. Making an audience spends
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
    @State private var origin = ""
    @State private var percent = 1
    @State private var country = "PK"
    @State private var sendingCustomers = false
    @State private var deleting: AdsAudienceRow?
    @State private var notice: String?
    @State private var failure: String?

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
            .alert("Done", isPresented: noticeShown) {
                Button("OK") { notice = nil }
            } message: {
                Text(notice ?? "")
            }
            .alert("Meta didn't take that", isPresented: failureShown) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
    }

    private var deletingShown: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { (on: Bool) in if !on { deleting = nil } })
    }

    private var noticeShown: Binding<Bool> {
        Binding(get: { notice != nil }, set: { (on: Bool) in if !on { notice = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
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
        List {
            Group {
                AdsAlertsSection(status: s)
                if let loadProblem {
                    Section {
                        Label(loadProblem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                        Button("Try again") { Task { await loadAudiences() } }
                    }
                }
                customersSection
                engagersSection
                lookalikeSection
                listSection
            }
            .houseRows()
            .disabled(busy != nil)
        }
        .listStyle(.insetGrouped)
        .refreshable { await loadAudiences() }
    }

    private func busyLabel(_ title: String, _ what: String, _ symbol: String) -> some View {
        HStack(spacing: 8) {
            if busy == what { ProgressView() } else { Image(systemName: symbol) }
            Text(title)
        }
    }

    private var customersSection: some View {
        Section {
            if isOwner {
                ForEach(data?.segments ?? []) { (seg: AdsHinted) in
                    Button { segment = seg.key } label: {
                        HStack(alignment: .top, spacing: 10) {
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
            Text("\(session.shop.name)'s customers")
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
            Text(data?.instagram.map { (ig: String) in "Instagram engagers · @\(ig)" } ?? "Instagram engagers")
        } footer: {
            Text("People who already know the shop on Instagram: usually the cheapest to turn into chats.")
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
            Text("Lookalike")
        } footer: {
            Text("New people who resemble an audience above. 1% is the closest match; bigger reaches more people, less alike. Meta needs at least 100 matched people in the country to start from.")
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
            Text("In the ad account")
        }
    }

    private func audienceRow(_ a: AdsAudienceRow) -> some View {
        let size = a.sizeWords.map { (w: String) in "\(w) people" } ?? "size not known yet"
        let made = a.created.map { (c: String) in ShopDate.say(c) } ?? ""
        let line = [a.kind, size, made].filter { (s: String) in !s.isEmpty }.joined(separator: " · ")
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name)
                Text(line).font(.caption).foregroundStyle(.secondary)
                if let st = a.status { Text(st).font(.caption).foregroundStyle(.orange) }
            }
            Spacer(minLength: 8)
            if busy == a.id {
                ProgressView()
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
