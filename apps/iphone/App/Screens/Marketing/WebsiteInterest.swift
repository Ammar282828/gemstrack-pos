import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

/// Website → Interest (src/app/website/interest/page.tsx): which of the site's pieces visitors save, ask about on
/// WhatsApp, open and stay on, counted anonymously by the house's own site since 22 October. One read
/// (GET /api/website/interest?from=&to=); the web's rules, here as four short lists instead of its four tabs.
/// Above them the site's report (WebsiteAnalyticsKit.swift: GET /api/website/analytics) for the chosen period; Live is its own screen.

/// One piece's counts, as /api/website/interest sends them. Any number may be missing.
struct WebsiteInterestPiece: Decodable, Identifiable, Hashable {
    let piece: String
    let name: String
    let thumb: String
    let url: String
    let collection: String
    let views: Int
    let saves: Int
    let unsaves: Int
    let netSaves: Int
    let enquiries: Int
    let dwellMs: Double
    let dwellN: Int
    let avgDwellMs: Double
    var id: String { piece }

    private enum K: String, CodingKey { case piece, name, thumb, url, collection, views, saves, unsaves, netSaves, enquiries, dwellMs, dwellN, avgDwellMs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        piece = c.string(.piece, default: "")
        name = c.string(.name, default: "")
        thumb = c.string(.thumb, default: "")
        url = c.string(.url, default: "")
        collection = c.string(.collection, default: "")
        views = c.int(.views) ?? 0
        saves = c.int(.saves) ?? 0
        unsaves = c.int(.unsaves) ?? 0
        netSaves = c.int(.netSaves) ?? 0
        enquiries = c.int(.enquiries) ?? 0
        dwellMs = c.double(.dwellMs, default: 0)
        dwellN = c.int(.dwellN) ?? 0
        avgDwellMs = c.double(.avgDwellMs, default: 0)
    }
}

struct WebsiteInterestAnswer: Decodable {
    let pieces: [WebsiteInterestPiece]

    private enum K: String, CodingKey { case pieces }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        pieces = c.list(.pieces, of: WebsiteInterestPiece.self)
    }
}

/// The four lists, with the web's ranking and wording (LISTS in the page).
enum WebsiteInterestList: String, CaseIterable, Identifiable {
    case saved, asked, longest, opened
    var id: String { rawValue }

    var title: String {
        switch self {
        case .saved: return "Saved"
        case .asked: return "Asked about"
        case .longest: return "Looked at longest"
        case .opened: return "Opened"
        }
    }

    /// What ranks the piece; 0 keeps it out. A minimum of three looks, so one long stare doesn't top the list.
    func rank(_ r: WebsiteInterestPiece) -> Double {
        switch self {
        case .saved: return Double(r.netSaves)
        case .asked: return Double(r.enquiries)
        case .longest: return r.dwellN >= 3 ? r.avgDwellMs : 0
        case .opened: return Double(r.views)
        }
    }

    var emptyTitle: String {
        switch self {
        case .saved: return "No saves in this period"
        case .asked: return "No enquiries in this period"
        case .longest: return "Nothing looked at long enough in this period"
        case .opened: return "No opens in this period"
        }
    }

    func say(_ r: WebsiteInterestPiece) -> String {
        switch self {
        case .saved: return "\(r.netSaves) saved"
        case .asked: return "\(r.enquiries) on WhatsApp"
        case .longest: return "\(Self.secs(r.avgDwellMs)) on average · \(r.dwellN) looks"
        case .opened: return "\(r.views) opens"
        }
    }

    /// The web's `secs`: "1m 20s" from a minute up, else "45s".
    static func secs(_ ms: Double) -> String {
        if ms >= 60_000 { return "\(Int(ms / 60_000))m \(Int(((ms.truncatingRemainder(dividingBy: 60_000)) / 1000).rounded()))s" }
        return "\(Int((ms / 1000).rounded()))s"
    }

    /// Ranked, highest first, ties in the server's order, the top 40 (as the web).
    func ranked(_ all: [WebsiteInterestPiece]) -> [WebsiteInterestPiece] {
        let kept = all.enumerated().filter { (e: (offset: Int, element: WebsiteInterestPiece)) in rank(e.element) > 0 }
        let sorted = kept.sorted { (a: (offset: Int, element: WebsiteInterestPiece), b: (offset: Int, element: WebsiteInterestPiece)) in
            let ra = rank(a.element)
            let rb = rank(b.element)
            return ra == rb ? a.offset < b.offset : ra > rb
        }
        return Array(sorted.prefix(40).map { (e: (offset: Int, element: WebsiteInterestPiece)) in e.element })
    }
}

struct WebsiteInterestScreen: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.layoutWidthClass) private var sizeClass
    /// The window's own width, to choose between the phone's List and an iPad's columns of cards.
    @State private var width: CGFloat = 0

    /// An iPad's wide window: tiles four across, the sections in two columns.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    /// The period last chosen on this device (the web keeps it too); Custom is not remembered.
    @AppStorage("erp.websiteInterest.period") private var storedPeriod = "30d"
    @State private var custom = false
    @State private var customFrom = ""
    @State private var customTo = ""
    @State private var picking = false
    @State private var list: WebsiteInterestList = .saved
    @State private var report: SiteReport?
    @State private var pieces: [WebsiteInterestPiece]?
    @State private var problem: String?
    @State private var liveNow: Int?

    private let periods: [(key: String, label: String)] = [
        ("today", "Today"), ("yesterday", "Yesterday"), ("7d", "7 days"), ("30d", "30 days"), ("90d", "90 days"), ("all", "All time")
    ]

    private var periodKey: String {
        periods.contains { (p: (key: String, label: String)) in p.key == storedPeriod } ? storedPeriod : "30d"
    }

    private var query: String {
        custom ? "range=custom&from=\(customFrom)&to=\(customTo)" : "range=\(periodKey)"
    }

    var body: some View {
        content
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .motion(query)
        .motion(list)
        .overlay { stateOverlay }
        .navigationTitle("Interest")
        .navigationBarTitleDisplayMode(.inline)
        #if os(macOS)
        .navigationSubtitle(report.map { (r: SiteReport) in spanLine(r) } ?? "")
        .toolbar { macToolbar }
        .macRefresh { Task { await load() } }
        #endif
        .refreshable { await load() }
        .task(id: query) { await load() }
        .task(id: scenePhase) { await pollLive() }
        .onAppear { remember() }
        .onChange(of: list) { _, new in
            UserDefaults.standard.set(new.rawValue, forKey: BizKey("erp.interestList"))
        }
        .sheet(isPresented: $picking) {
            SiteCustomRangeSheet(from: customFrom, to: customTo) { (a: String, b: String) in
                customFrom = a
                customTo = b
                custom = true
            }
            .presentationSizing(.form)
        }
    }

    @ViewBuilder
    private var content: some View {
        if wide {
            wideBody
        } else {
            List {
                periodSection
                if let r = report {
                    reportSections(r)
                }
                if report != nil || pieces != nil {
                    piecesSection
                }
            }
            .listStyle(.insetGrouped)
            .modifier(HouseGround())
        }
    }

    // MARK: An iPad's wide window

    private var wideBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(20)) {
                widePeriod
                if let r = report {
                    wideReport(r)
                }
                if report != nil || pieces != nil {
                    widePieces
                }
            }
            .environment(\.siteWide, true)
            .padding(.horizontal, pt(28))
            .padding(.top, pt(8))
            .padding(.bottom, pt(28))
            .frame(maxWidth: 1240)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
    }

    private var widePeriod: some View {
        #if os(macOS)
        // The period, Custom and Live are in the window's toolbar.
        EmptyView()
        #else
        VStack(alignment: .leading, spacing: pt(10)) {
            HStack(alignment: .center, spacing: pt(16)) {
                ChipRow {
                    ForEach(periods, id: \.key) { (p: (key: String, label: String)) in
                        FilterChip(title: p.label, chosen: !custom && periodKey == p.key) { choose(p.key) }
                    }
                    FilterChip(title: "Custom", chosen: custom) { picking = true }
                }
                .padding(.leading, -16)
                NavigationLink(value: Route(path: "/website/interest/live")) { liveLabel }
                    .buttonStyle(.bordered)
                    .pointerHover()
            }
            if let r = report {
                Text(spanLine(r)).font(.footnote).foregroundStyle(.secondary)
            }
        }
        #endif
    }

    @ViewBuilder
    private func wideReport(_ r: SiteReport) -> some View {
        let n = r.now
        if n.sessions == 0 && r.before.sessions == 0 {
            Text("Nothing counted in this period yet. Visits are counted from 23 October 2026; piece interest from 22 October. It fills as people use the website.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        // Eight tiles in two rows of four.
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: pt(12), alignment: .top), count: 4), spacing: pt(12)) {
            tiles(r)
        }
        SiteChartSection(report: r)
        HStack(alignment: .top, spacing: pt(20)) {
            VStack(alignment: .leading, spacing: pt(20)) {
                SiteFunnelSection(now: n, before: r.before)
                SiteRankSection(title: "Where they came from", rows: SiteRanks.sourceRows(n.sources), total: n.sessions, empty: "No sessions yet.",
                                alt: SiteRanks.channelRows(n.channels), picks: ["Sources", "Kinds"])
                SiteSourcesSection(sources: n.sources)
                SiteRankSection(title: "Campaigns", rows: campaignRows(n), total: n.sessions)
                deviceSections(n)
            }
            .frame(maxWidth: .infinity, alignment: .top)
            VStack(alignment: .leading, spacing: pt(20)) {
                SiteRankSection(title: "Where they are", rows: SiteRanks.cityRows(n.countries, cities: n.cities), total: n.sessions, empty: "No sessions yet.",
                                alt: SiteRanks.countryRows(n.countries), picks: ["Cities", "Countries"])
                pageSections(n)
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }

    private var widePieces: some View {
        let rows = list.ranked(pieces ?? [])
        return VStack(alignment: .leading, spacing: pt(12)) {
            LedgerHeading(title: "Pieces")
            picker
            if pieces != nil && rows.isEmpty {
                Text(list.emptyTitle + ". It fills as people use the website.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: pt(20), alignment: .top), GridItem(.flexible(), spacing: pt(20), alignment: .top)], spacing: pt(14)) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { (i: Int, r: WebsiteInterestPiece) in
                    row(r, rank: i + 1, in: list)
                }
            }
            Text(LocalizedStringKey(Self.countingNote)).font(.footnote).foregroundStyle(.secondary)
        }
        .ledgerCard()
    }

    // MARK: Period and live

    private var periodSection: some View {
        Section {
            ChipRow {
                ForEach(periods, id: \.key) { (p: (key: String, label: String)) in
                    FilterChip(title: p.label, chosen: !custom && periodKey == p.key) { choose(p.key) }
                }
                FilterChip(title: "Custom", chosen: custom) { picking = true }
            }
            .chipRowInList()
            if let r = report {
                Text(spanLine(r))
                    .font(.footnote).foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            liveRow
        }
    }

    func spanLine(_ r: SiteReport) -> String {
        SiteWords.span(r.from, r.to) + " · compared with " + SiteWords.span(r.previous.from, r.previous.to)
    }

    private var liveRow: some View {
        NavigationLink(value: Route(path: "/website/interest/live")) { liveLabel }
            .listRowBackground(Theme.card)
    }

    var liveLabel: some View {
        HStack(spacing: pt(10)) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .foregroundStyle((liveNow ?? 0) > 0 ? Tone.settled.color : Color.secondary)
            if let n = liveNow {
                Text("\(n) on the site now").monospacedDigit()
                    .contentTransition(.numericText(value: Double(n)))
            } else {
                Text("Live")
            }
        }
    }

    func choose(_ key: String) {
        guard custom || key != periodKey else { return }
        Motion.run(reduce: reduceMotion) {
            custom = false
            storedPeriod = key
        }
    }

    // MARK: The report

    @ViewBuilder
    private func reportSections(_ r: SiteReport) -> some View {
        let n = r.now
        if n.sessions == 0 && r.before.sessions == 0 {
            Section {
                Text("Nothing counted in this period yet. Visits are counted from 23 October 2026; piece interest from 22 October. It fills as people use the website.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .houseRows()
        }
        tilesSection(r)
        SiteChartSection(report: r)
        SiteFunnelSection(now: n, before: r.before)
        SiteRankSection(title: "Where they came from", rows: SiteRanks.sourceRows(n.sources), total: n.sessions, empty: "No sessions yet.",
                                alt: SiteRanks.channelRows(n.channels), picks: ["Sources", "Kinds"])
        SiteRankSection(title: "Where they are", rows: SiteRanks.cityRows(n.countries, cities: n.cities), total: n.sessions, empty: "No sessions yet.",
                                alt: SiteRanks.countryRows(n.countries), picks: ["Cities", "Countries"])
        SiteSourcesSection(sources: n.sources)
        SiteRankSection(title: "Campaigns", rows: campaignRows(n), total: n.sessions)
        deviceSections(n)
        pageSections(n)
    }

    @ViewBuilder
    private func deviceSections(_ n: SiteSummary) -> some View {
        SiteRankSection(title: "Device", rows: SiteRanks.counts(n.devices, label: SiteWords.device), total: n.sessions, empty: "No sessions yet.")
        SiteRankSection(title: "System", rows: SiteRanks.plain(n.os), total: n.sessions, empty: "No sessions yet.")
        SiteRankSection(title: "Browser", rows: SiteRanks.plain(n.browsers), total: n.sessions, empty: "No sessions yet.",
                        note: "Instagram and Facebook are their in-app browsers.")
    }

    @ViewBuilder
    private func pageSections(_ n: SiteSummary) -> some View {
        SiteRankSection(title: "Pages they arrived on", rows: SiteRanks.pages(n.landing), total: n.sessions, empty: "No sessions yet.")
        SiteRankSection(title: "Pages they left from", rows: SiteRanks.pages(n.exits), total: n.sessions, empty: "No sessions yet.")
        SiteRankSection(title: "Most viewed pages", rows: SiteRanks.pages(n.pages), total: n.pageviews, empty: "No page views yet.")
        SiteRankSection(title: "Collections browsed", rows: SiteRanks.pages(n.collections), empty: "No collection pages opened yet.")
        SiteRankSection(title: "What they searched for", rows: searchRows(n))
        SiteRankSection(title: "Pages not found", rows: SiteRanks.pages(n.notFound),
                        note: "A broken link somewhere, or a piece taken down.")
    }

    private func campaignRows(_ n: SiteSummary) -> [SiteRankRow] {
        n.campaigns.map { (c: SiteCampaign) -> SiteRankRow in
            SiteRankRow(id: c.key, label: c.key, sub: "\(c.piece) opened a piece · \(c.enquire) asked", value: c.value)
        }
    }

    private func searchRows(_ n: SiteSummary) -> [SiteRankRow] {
        n.searches.map { (s: SiteCount) -> SiteRankRow in
            SiteRankRow(id: s.key, label: "\u{201C}" + s.key + "\u{201D}", value: s.value)
        }
    }

    // MARK: Tiles

    private func tilesSection(_ r: SiteReport) -> some View {
        Section {
            FigureGrid {
                tiles(r)
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    @ViewBuilder
    private func tiles(_ r: SiteReport) -> some View {
        let n = r.now
        let b = r.before
        SiteTile(label: "Sessions", value: SiteWords.number(n.sessions), now: Double(n.sessions), before: Double(b.sessions),
                 detail: String(format: "%.1f pages each", n.pagesPerSession))
        SiteTile(label: "Visitors", value: SiteWords.number(n.visitors), now: Double(n.visitors), before: Double(b.visitors),
                 detail: r.visitorsExact ? nil : "day by day, added")
        SiteTile(label: "Page views", value: SiteWords.number(n.pageviews), now: Double(n.pageviews), before: Double(b.pageviews))
        SiteTile(label: "Time on site", value: SiteWords.duration(n.avgSessionMs), now: n.avgSessionMs, before: b.avgSessionMs,
                 detail: "a session, on average")
        SiteTile(label: "Bounce rate", value: SiteWords.pct(n.bounceRate), now: n.bounceRate, before: b.bounceRate, invert: true,
                 detail: "left after one page")
        askedTile(n, b)
        SiteTile(label: "Saved a piece", value: SiteWords.number(n.funnel.save), now: Double(n.funnel.save), before: Double(b.funnel.save),
                 detail: "sessions")
        returningTile(n, b)
    }

    private func askedTile(_ n: SiteSummary, _ b: SiteSummary) -> some View {
        SiteTile(label: "Asked on WhatsApp", value: SiteWords.number(n.funnel.enquire),
                 now: Double(n.funnel.enquire), before: Double(b.funnel.enquire),
                 detail: SiteWords.pct(n.conversion, digits: 1) + " of sessions")
    }

    private func returningTile(_ n: SiteSummary, _ b: SiteSummary) -> some View {
        let share = n.sessions > 0 ? Double(n.returningSessions) / Double(n.sessions) : 0
        let detail = SiteWords.number(n.returningSessions) + " sessions · " + SiteWords.number(n.newVisitors) + " new people"
        return SiteTile(label: "Returning", value: SiteWords.pct(share),
                        now: Double(n.returningSessions), before: Double(b.returningSessions), detail: detail)
    }

    // MARK: Pieces

    private var piecesSection: some View {
        let rows = list.ranked(pieces ?? [])
        return Section {
            picker
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            if pieces != nil && rows.isEmpty {
                Text(list.emptyTitle + ". It fills as people use the website.")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .listRowBackground(Theme.card)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { (i: Int, r: WebsiteInterestPiece) in
                row(r, rank: i + 1, in: list)
                    .listRowBackground(Theme.card)
            }
        } header: {
            LedgerHeading(title: "Pieces")
        } footer: {
            Text(LocalizedStringKey(Self.countingNote))
        }
    }

    /// How the numbers are counted (the web's note), with the geolocation credit DB-IP's licence asks for.
    private static let countingNote = "A session is one visit; a new one starts after 30 minutes away. Visitors are told apart by a random id their browser keeps, never by name or address; visitors who ask not to be tracked (Do Not Track) and bots are not counted. Places come from the visitor\u{2019}s network address, looked up and then forgotten \u{2014} [IP Geolocation by DB-IP](https://db-ip.com); city for Pakistan and the Gulf, the country elsewhere."

    @ViewBuilder
    private var picker: some View {
        let choice = Binding<WebsiteInterestList>(get: { list }, set: { (l: WebsiteInterestList) in
            Motion.run(reduce: reduceMotion) { list = l }
        })
        if typeSize.isAccessibilitySize {
            Picker("List", selection: choice) {
                ForEach(WebsiteInterestList.allCases) { (l: WebsiteInterestList) in Text(l.title).tag(l) }
            }
            .pickerStyle(.menu)
            .selectionFeedback(trigger: list)
        } else {
            Picker("List", selection: choice) {
                ForEach(WebsiteInterestList.allCases) { (l: WebsiteInterestList) in Text(l.title).tag(l) }
            }
            .pickerStyle(.segmented)
            .selectionFeedback(trigger: list)
        }
    }

    /// The list last chosen on this device, per business.
    private func remember() {
        if let raw = UserDefaults.standard.string(forKey: BizKey("erp.interestList")), let l = WebsiteInterestList(rawValue: raw) { list = l }
    }

    @ViewBuilder
    private var stateOverlay: some View {
        if report == nil, let problem {
            ErrorState(problem) { Task { await load() } }
        } else if report == nil {
            SkeletonLoading("Loading…").controlSize(.large)
        }
    }

    private func row(_ r: WebsiteInterestPiece, rank: Int, in list: WebsiteInterestList) -> some View {
        Button {
            if let u = URL(string: r.url), !r.url.isEmpty { openURL(u) }
        } label: {
            HStack(spacing: pt(12)) {
                Text("\(rank)")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .frame(minWidth: 22)
                StockImage(imageUrl: r.thumb, name: r.name, key: r.piece)
                    .frame(width: 44, height: 44)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.name.isEmpty ? r.piece : r.name).foregroundStyle(.primary)
                    Text(list.say(r)).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                    if !r.collection.isEmpty {
                        Text(r.collection).font(.caption).foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let u = URL(string: r.url), !r.url.isEmpty {
                Button { openURL(u) } label: { Label("Open on the website", systemImage: "safari") }
                Button { UIPasteboard.general.string = r.url } label: { Label("Copy link", systemImage: "link") }
            }
        }
    }

    // MARK: Loading

    /// The previous report and list stay while the next period loads; a failure shows only when there is nothing to show.
    private func load() async {
        guard !(custom && (customFrom.isEmpty || customTo.isEmpty)) else { return }
        if report == nil, let cached = SWR.peek("/api/website/analytics?\(query)", as: SiteReport.self) { report = cached }
        do {
            let r = try await SWR.get("/api/website/analytics?\(query)", as: SiteReport.self)
            report = r
            problem = nil
            // The piece rankings for the same days as the report.
            let a = try await ERPAPI.shared.get("/api/website/interest?from=\(r.from)&to=\(r.to)", as: WebsiteInterestAnswer.self)
            pieces = a.pieces
        } catch is CancellationError {
            return
        } catch {
            if report == nil { problem = error.localizedDescription }
        }
    }

    /// "N on the site now": asked once on appearing, then every 30 seconds, only while this screen is up and the app is active.
    private func pollLive() async {
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            if let l = try? await ERPAPI.shared.get("/api/website/analytics/live", as: SiteLive.self) {
                Motion.run(reduce: reduceMotion) { liveNow = l.visitors }
            }
            do { try await Task.sleep(for: .seconds(30)) } catch { return }
        }
    }
}

#if os(macOS)
extension WebsiteInterestScreen {
    /// Live (with the count on the site now) and the period as one menu; View › Refresh (⌘R) reads the report again.
    @ToolbarContentBuilder
    var macToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            NavigationLink(value: Route(path: "/website/interest/live")) { liveLabel }
                .help("Who is on the website right now")
            Menu {
                Picker("Days", selection: Binding<String>(get: { custom ? "custom" : periodKey },
                                                          set: { (k: String) in if k == "custom" { picking = true } else { choose(k) } })) {
                    ForEach(periods, id: \.key) { (p: (key: String, label: String)) in Text(p.label).tag(p.key) }
                    Text("Custom…").tag("custom")
                }
                .pickerStyle(.inline)
            } label: {
                Label("Days", systemImage: "calendar")
            }
            .help("The days the report covers")
        }
    }
}
#endif
