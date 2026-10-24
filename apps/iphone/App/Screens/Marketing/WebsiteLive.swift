import SwiftUI
import ERPCore

/// Website → Interest → Live (src/app/website/interest/live/page.tsx): who is on the house's website right now
/// (seen in the last five minutes), where, on which page, from where; and today's running totals.
/// GET /api/website/analytics/live, asked again every 15 seconds, only while this screen is up and the app is active.
struct WebsiteLiveScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    /// An iPad's wide window: the count and today's tiles across the top, the lists in two or three columns.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    @State private var live: SiteLive?
    @State private var problem: String?

    var body: some View {
        content
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .motion(live?.visitors)
        .overlay { stateOverlay }
        .navigationTitle("Live")
        .navigationBarTitleDisplayMode(.inline)
        #if os(macOS)
        .navigationSubtitle(live.map { (l: SiteLive) in "\(l.visitors) on the site now" } ?? "")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r", modifiers: .command)
                    .help("Ask who is on the website now (it also updates itself every 15 seconds)")
            }
        }
        #endif
        .refreshable { await load() }
        .task(id: scenePhase) { await poll() }
    }

    @ViewBuilder
    private var content: some View {
        if wide {
            wideBody
        } else {
            phoneList
        }
    }

    // MARK: An iPad's wide window

    private var wideBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let l = live {
                    wideTop(l)
                    if l.visitors > 0 {
                        columns(l)
                    } else {
                        Text("No one on the site at the moment. Visits are counted from 23 October 2026.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            .environment(\.siteWide, true)
            .padding(.horizontal, 28)
            .padding(.top, 8)
            .padding(.bottom, 28)
            .frame(maxWidth: 1360)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
    }

    private func wideTop(_ l: SiteLive) -> some View {
        let t = l.today
        return HStack(alignment: .top, spacing: 12) {
            heroBody(l).ledgerCard().frame(maxWidth: 340)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 4), spacing: 12) {
                FigureTile(label: "Sessions", value: SiteWords.number(t.sessions), detail: SiteWords.number(t.visitors) + " people")
                FigureTile(label: "Page views", value: SiteWords.number(t.pageviews), detail: SiteWords.duration(t.avgSessionMs) + " a session")
                FigureTile(label: "Opened a piece", value: SiteWords.number(t.pieces), detail: SiteWords.number(t.saves) + " saved one")
                FigureTile(label: "Asked on WhatsApp", value: SiteWords.number(t.enquiries), detail: SiteWords.pct(t.conversion, digits: 1) + " of sessions")
            }
        }
    }

    private func places(_ l: SiteLive) -> some View {
        SiteRankSection(title: "Where they are", rows: SiteRanks.cityRows(l.countries, cities: l.cityRows), total: l.visitors,
                        alt: SiteRanks.countryRows(l.countries), picks: ["Cities", "Countries"])
    }
    private func looking(_ l: SiteLive) -> some View {
        SiteRankSection(title: "What they\u{2019}re looking at", rows: SiteRanks.pages(l.pages), total: l.visitors)
    }
    private func came(_ l: SiteLive) -> some View {
        SiteRankSection(title: "How they came", rows: SiteRanks.counts(l.sources, label: SiteWords.source), total: l.visitors)
    }
    private func devices(_ l: SiteLive) -> some View {
        SiteRankSection(title: "On", rows: SiteRanks.counts(l.devices, label: SiteWords.device), total: l.visitors)
    }

    @ViewBuilder
    private func columns(_ l: SiteLive) -> some View {
        HStack(alignment: .top, spacing: 20) {
            if width >= 1180 {
                VStack(alignment: .leading, spacing: 20) { places(l); devices(l) }.frame(maxWidth: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 20) { looking(l); came(l) }.frame(maxWidth: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 20) { visitsSection(l.sessions) }.frame(maxWidth: .infinity, alignment: .top)
            } else {
                VStack(alignment: .leading, spacing: 20) { places(l); came(l); devices(l) }.frame(maxWidth: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 20) { looking(l); visitsSection(l.sessions) }.frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }

    @ViewBuilder
    private var phoneList: some View {
        List {
            if let l = live {
                heroSection(l)
                todaySection(l.today)
                if l.visitors > 0 {
                    SiteRankSection(title: "Where they are", rows: SiteRanks.cityRows(l.countries, cities: l.cityRows), total: l.visitors,
                        alt: SiteRanks.countryRows(l.countries), picks: ["Cities", "Countries"])
                    SiteRankSection(title: "What they\u{2019}re looking at", rows: SiteRanks.pages(l.pages), total: l.visitors)
                    SiteRankSection(title: "How they came", rows: SiteRanks.counts(l.sources, label: SiteWords.source), total: l.visitors)
                    SiteRankSection(title: "On", rows: SiteRanks.counts(l.devices, label: SiteWords.device), total: l.visitors)
                    visitsSection(l.sessions)
                } else {
                    Section {
                        Text("No one on the site at the moment. Visits are counted from 23 October 2026.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .houseRows()
                }
            }
        }
        .listStyle(.insetGrouped)
        .modifier(HouseGround())
    }

    // MARK: The count

    private func heroSection(_ l: SiteLive) -> some View {
        Section {
            heroBody(l)
        }
        .houseRows()
    }

    private func heroBody(_ l: SiteLive) -> some View {
        HStack(spacing: 14) {
                Image(systemName: "circle.fill")
                    .font(.caption)
                    .foregroundStyle(l.visitors > 0 ? Tone.settled.color : Color.secondary.opacity(0.4))
                    .symbolEffect(.pulse, isActive: l.visitors > 0 && !reduceMotion)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(l.visitors)")
                        .font(.system(.largeTitle, design: .serif).weight(.semibold))
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(l.visitors)))
                    Text(heroWords(l)).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
    }

    private func heroWords(_ l: SiteLive) -> String {
        let who = l.visitors == 1 ? "person" : "people"
        var s = who + " on the site now"
        if l.visitors > 0 {
            s += " \u{00B7} \(l.newVisitors) new, \(max(0, l.visitors - l.newVisitors)) returning"
        }
        return s
    }

    private func todaySection(_ t: SiteLiveToday) -> some View {
        Section {
            FigureGrid {
                FigureTile(label: "Sessions", value: SiteWords.number(t.sessions), detail: SiteWords.number(t.visitors) + " people")
                FigureTile(label: "Page views", value: SiteWords.number(t.pageviews), detail: SiteWords.duration(t.avgSessionMs) + " a session")
                FigureTile(label: "Opened a piece", value: SiteWords.number(t.pieces), detail: SiteWords.number(t.saves) + " saved one")
                FigureTile(label: "Asked on WhatsApp", value: SiteWords.number(t.enquiries), detail: SiteWords.pct(t.conversion, digits: 1) + " of sessions")
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } header: {
            LedgerHeading(title: "Today so far")
        }
    }

    // MARK: Each visit

    private func visitsSection(_ visits: [SiteLiveVisit]) -> some View {
        SiteBlock(title: "Each visit", note: "Newest first; no names, no addresses.") {
            ForEach(visits) { (v: SiteLiveVisit) in
                visitRow(v)
            }
        }
    }

    private func place(_ v: SiteLiveVisit) -> String {
        var parts: [String] = []
        if !v.city.isEmpty { parts.append(v.city) }
        parts.append(SiteWords.countryName(v.cc))
        return parts.joined(separator: ", ")
    }

    private func detail(_ v: SiteLiveVisit) -> String {
        let device = SiteWords.device(v.device) + (v.browser.isEmpty ? "" : ", " + v.browser)
        let who = v.isNew ? "new" : "returning"
        return [place(v), SiteWords.source(v.source), device, who].joined(separator: " \u{00B7} ")
    }

    private func stay(_ v: SiteLiveVisit) -> String {
        let pages = SiteWords.pages(v.pages)
        return v.forMs > 0 ? pages + " \u{00B7} " + SiteWords.duration(v.forMs) : pages
    }

    private func visitRow(_ v: SiteLiveVisit) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(SiteWords.flag(v.cc)).font(.title3).accessibilityHidden(true)
            AdaptiveStack(spacing: 8, alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(SiteWords.page(v.path))
                    Text(detail(v)).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(stay(v))
                    Text(SiteWords.ago(v.ago))
                }
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Loading

    @ViewBuilder
    private var stateOverlay: some View {
        if live == nil, let problem {
            ErrorState(problem) { Task { await load() } }
        } else if live == nil {
            SkeletonLoading("Loading\u{2026}").controlSize(.large)
        }
    }

    /// A failed poll keeps what is on screen; the message shows only when there is nothing yet.
    private func load() async {
        do {
            let l = try await ERPAPI.shared.get("/api/website/analytics/live", as: SiteLive.self)
            Motion.run(reduce: reduceMotion) { live = l }
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            if live == nil { problem = error.localizedDescription }
        }
    }

    /// Every 15 seconds while the screen is visible and the app active; the task ends with either.
    private func poll() async {
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            await load()
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
        }
    }
}
