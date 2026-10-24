import SwiftUI
import Charts
import ERPCore

/// Ads → Overview (src/app/ads/page.tsx): what the house's Meta ads cost and brought over a range, each
/// against the same length of time before, day by day, the ads that spent most, who saw them, and what
/// Meta has flagged. Read from /api/ads/overview, which answers owners and marketing accounts. The one
/// thing done here is the web's own: pause a flagged ad set, or run a paused one again (asked first,
/// since it spends). New ad and Setup are native (AdsNewAd.swift, AdsSetup.swift); Studio and the ads' own pages
/// stay the ERP's.
struct AdsOverviewScreen: View {
    @Environment(Session.self) private var session

    @AppStorage("ads.range") private var rangeKey = "last_7d"
    @State private var data: AdOverview?
    @State private var problem: String?
    @State private var acting: String?
    @State private var asking: AdAttention?
    @State private var failure: String?
    @State private var go: Route?
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize

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
        .navigationTitle("Ads")
        .hubTitleDisplay()
        // An iPad's tables and rows sit in a centred column, not across the whole window.
        .readableColumn(1040)
        .toolbar {
            if mayRead {
                ToolbarItem(placement: .primaryAction) { AdsRangeMenu(key: $rangeKey) }
                #if os(macOS)
                ToolbarItem(placement: .primaryAction) {
                    Button { go = Route(path: "/ads/new") } label: { Label("New ad", systemImage: "plus") }
                        .help("Make a new ad")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await load(fresh: true) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                        .keyboardShortcut("r", modifiers: .command)
                        .help("Ask Meta again")
                }
                #endif
            }
        }
        .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
        .onChange(of: go) { old, new in if old != nil && new == nil, mayRead { Task { await load(fresh: true) } } }
        .task(id: rangeKey) { if mayRead { await load() } }
        .confirmationDialog("Run it again?", isPresented: askingShown, titleVisibility: .visible, presenting: asking) { (a: AdAttention) in
            Button("Run again") { Task { await run(a, running: true) } }
        } message: { (a: AdAttention) in
            Text("\(a.targetName) will spend its budget again.")
        }
        .failureAlert($failure, title: "Meta didn't take that")
        .noteToast($note)
    }

    private var askingShown: Binding<Bool> {
        Binding(get: { asking != nil }, set: { (on: Bool) in if !on { asking = nil } })
    }


    // MARK: Asking Meta

    private func load(fresh: Bool = false) async {
        if data == nil, let cached = AdsAPI.lastOverview(range: rangeKey) { data = cached }
        do {
            data = try await AdsAPI.overview(range: rangeKey, fresh: fresh)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func run(_ a: AdAttention, running: Bool) async {
        acting = a.targetId
        defer { acting = nil }
        do {
            try await AdsAPI.setRunning(level: a.level, id: a.targetId, running: running)
            Note.show(Note(title: running ? "Running again" : "Paused", detail: a.targetName), in: $note, reduce: reduceMotion)
            await load(fresh: true)
        } catch {
            failure = error.localizedDescription
        }
    }

    private func failed(_ message: String) -> some View {
        VStack(spacing: 0) {
            // The demo has no ERP to ask again: no button that can only fail.
            ErrorState(message, retry: House.isDemo ? nil : { Task { await load(fresh: true) } })
            Button("Open Setup") { go = Route(path: "/ads/setup") }
                .buttonStyle(.bordered)
                .padding(.bottom, 32)
        }
    }

    // MARK: The page

    private func content(_ d: AdOverview) -> some View {
        #if os(macOS)
        macContent(d)
        #else
        phoneContent(d)
        #endif
    }

    private func phoneContent(_ d: AdOverview) -> some View {
        let cur = d.account.currency
        return List {
            Group {
                topSections(d, cur)
                middleSections(d, cur)
                bottomSections(d, cur)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await load(fresh: true) }
        .motion(d.totals.spend)
    }

    @ViewBuilder
    private func topSections(_ d: AdOverview, _ cur: String) -> some View {
        accountSection(d)
        if let problem {
            Section { Label(problem, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) } header: { LedgerHeading(title: "Couldn't refresh") }
        }
        figuresSection(d, cur)
        broughtSection(d)
        attentionSection(d)
    }

    @ViewBuilder
    private func middleSections(_ d: AdOverview, _ cur: String) -> some View {
        monthSection(d, cur)
        dailySection(d, cur)
        topAdsSection(d, cur)
    }

    @ViewBuilder
    private func bottomSections(_ d: AdOverview, _ cur: String) -> some View {
        splitSection("Who saw them", d.ageGender, cur)
        splitSection("Where", d.placement, cur)
        splitSection("Region", d.region, cur)
        linksSection
    }

    private func accountSection(_ d: AdOverview) -> some View {
        Section {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.account.name).font(.headline)
                    if let funding = d.account.funding, !funding.isEmpty {
                        Text(funding).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                AdsAccountBadge(status: d.account.status)
            }
        } footer: {
            Text(periodLine(d))
        }
    }

    /// "Thu 1 Oct to Wed 7 Oct, compared with …" in the shop's date words.
    private func periodLine(_ d: AdOverview) -> String {
        func span(_ a: String?, _ b: String?) -> String {
            guard let a, let b else { return "" }
            return a == b ? ShopDate.say(a) : "\(ShopDate.say(a)) to \(ShopDate.say(b))"
        }
        let now = span(d.since, d.until)
        let before = span(d.beforeSince, d.beforeUntil)
        if now.isEmpty { return AdsRange.label(rangeKey) }
        return before.isEmpty ? now : "\(now), compared with \(before)"
    }

    // MARK: Figures

    private func figuresSection(_ d: AdOverview, _ cur: String) -> some View {
        let t = d.totals
        let b = d.before
        let main = AdsResults.headlineResult(t)
        let spentNote = [AdsFormat.change(t.spend, b?.spend), "\(AdsFormat.money(d.account.amountSpent, cur)) all time"]
            .compactMap { (s: String?) in s }
            .joined(separator: " · ")
        let reachNote = AdsFormat.change(t.reach, b?.reach) ?? "\(AdsFormat.compact(t.impressions)) views"
        let across = sizeClass.isPadLayout && !typeSize.isAccessibilitySize
        return Section {
            if across {
                // An iPad: every figure in one grid, four across.
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4), spacing: 10) {
                    FigureTile(label: "Spent", value: AdsFormat.money(t.spend, cur), detail: spentNote)
                    FigureTile(label: "People reached", value: AdsFormat.compact(t.reach), detail: reachNote)
                    mainTile(t, b, main, cur)
                    FigureTile(label: "Click-through", value: AdsFormat.pct(t.ctr),
                               detail: "\(AdsFormat.money(t.cpm, cur)) per 1,000 views")
                    salesTilePair(t, b, cur)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            } else {
            VStack(spacing: 10) {
                FigureRow(spacing: 10) {
                    FigureTile(label: "Spent", value: AdsFormat.money(t.spend, cur), detail: spentNote)
                    FigureTile(label: "People reached", value: AdsFormat.compact(t.reach), detail: reachNote)
                }
                FigureRow(spacing: 10) {
                    mainTile(t, b, main, cur)
                    FigureTile(label: "Click-through", value: AdsFormat.pct(t.ctr),
                               detail: "\(AdsFormat.money(t.cpm, cur)) per 1,000 views")
                }
                salesTiles(t, b, cur)
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
            }
        }
    }

    /// The sales tiles alone, for the iPad's grid (no row around them).
    @ViewBuilder
    private func salesTilePair(_ t: AdMetrics, _ b: AdMetrics?, _ cur: String) -> some View {
        let s = AdsResults.sales(t)
        if s.purchases > 0 || s.value > 0 {
            let before = b.map { (m: AdMetrics) in AdsResults.sales(m) }
            FigureTile(label: "Sales from ads", value: AdsFormat.money(s.value, cur),
                       detail: AdsFormat.change(s.value, before?.value) ?? "\(AdsFormat.count(s.purchases)) order\(s.purchases == 1 ? "" : "s")")
            FigureTile(label: "ROAS", value: AdsResults.roasText(s.roas),
                       detail: s.costPerPurchase.map { (c: Double) in "\(AdsFormat.money(c, cur)) per order" } ?? "Sales for every rupee spent")
        }
    }

    /// What the ads sold, when they sold anything (ads/page.tsx: Sales from ads · ROAS · Cost per purchase).
    @ViewBuilder
    private func salesTiles(_ t: AdMetrics, _ b: AdMetrics?, _ cur: String) -> some View {
        let s = AdsResults.sales(t)
        if s.purchases > 0 || s.value > 0 {
            let before = b.map { (m: AdMetrics) in AdsResults.sales(m) }
            FigureRow(spacing: 10) {
                FigureTile(label: "Sales from ads", value: AdsFormat.money(s.value, cur),
                           detail: AdsFormat.change(s.value, before?.value) ?? "\(AdsFormat.count(s.purchases)) order\(s.purchases == 1 ? "" : "s")")
                FigureTile(label: "ROAS", value: AdsResults.roasText(s.roas),
                           detail: s.costPerPurchase.map { (c: Double) in "\(AdsFormat.money(c, cur)) per order" } ?? "Sales for every rupee spent")
            }
        }
    }

    /// The result the account mostly buys, or clicks where it has none.
    @ViewBuilder
    private func mainTile(_ t: AdMetrics, _ b: AdMetrics?, _ main: (key: String, label: String, value: Double), _ cur: String) -> some View {
        if main.key == "reach" {
            FigureTile(label: "Clicks", value: AdsFormat.count(t.clicks),
                       detail: t.clicks > 0 ? "\(AdsFormat.money(t.cpc, cur)) each" : nil)
        } else {
            let before = b.map { (m: AdMetrics) in AdsResults.value(m, key: main.key) }
            let each = main.value > 0 ? "\(AdsFormat.money(t.spend / main.value, cur)) each" : nil
            FigureTile(label: main.label, value: AdsFormat.count(main.value),
                       detail: AdsFormat.change(main.value, before) ?? each)
        }
    }

    @ViewBuilder
    private func broughtSection(_ d: AdOverview) -> some View {
        // The headline result is the tile above: not again here.
        let shown = AdsResults.headlineResult(d.totals).label
        let actions = AdsResults.headlineActions(d.totals, limit: 10).filter { (a: AdsResults.Line) in a.label != shown }
        if !actions.isEmpty {
            Section {
                ForEach(actions) { (a: AdsResults.Line) in
                    LabeledContent(a.label) { Text(AdsFormat.count(a.value)).monospacedDigit() }
                }
            } header: {
                LedgerHeading(title: "What it brought")
            }
        }
    }

    // MARK: Needs a look

    @ViewBuilder
    private func attentionSection(_ d: AdOverview) -> some View {
        Section {
            if d.attention.isEmpty {
                Label("Nothing needs attention.", systemImage: "checkmark.circle").foregroundStyle(Tone.settled.color)
            } else {
                ForEach(d.attention) { (a: AdAttention) in attentionItem(a) }
            }
        } header: {
            LedgerHeading(title: "Needs a look", count: d.attention.count)
        }
    }

    @ViewBuilder
    private func attentionItem(_ a: AdAttention) -> some View {
        if a.doing == "open", !a.href.isEmpty {
            NavigationLink(value: Route(path: openPath(a.href))) { attentionBody(a) }
        } else {
            attentionBody(a)
        }
    }

    private func attentionBody(_ a: AdAttention) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: a.severity == "tip" ? "lightbulb" : "exclamationmark.triangle.fill")
                .foregroundStyle(a.severity == "bad" ? Tone.problem.color : (a.severity == "warn" ? Tone.owed.color : Color.secondary))
            VStack(alignment: .leading, spacing: 4) {
                Text(a.title).font(.body.weight(.medium))
                Text(a.why).font(.subheadline).foregroundStyle(.secondary)
                if a.doing == "pause" {
                    Button("Pause") { Task { await run(a, running: false) } }
                        .buttonStyle(.bordered)
                        .disabled(acting != nil)
                } else if a.doing == "resume" {
                    Button("Run again") { asking = a }
                        .buttonStyle(.bordered)
                        .disabled(acting != nil)
                }
            }
        }
    }

    /// An ad's own page is the ERP's (its previews and Meta's review notes); the rest are native or ERP pages by path.
    private func openPath(_ href: String) -> String {
        href
    }

    // MARK: Month, days, top ads, who saw them

    @ViewBuilder
    private func monthSection(_ d: AdOverview, _ cur: String) -> some View {
        if let m = d.month, m.spent > 0 || m.lastMonth > 0 {
            Section {
                LabeledContent("Spent so far") { Text(AdsFormat.money(m.spent, cur)).monospacedDigit().contentTransition(.numericText(value: m.spent)) }
                LabeledContent("Heading for") { Text(AdsFormat.money(m.projected, cur)).monospacedDigit().contentTransition(.numericText(value: m.projected)) }
                if m.lastMonth > 0 {
                    LabeledContent("Last month") { Text(AdsFormat.money(m.lastMonth, cur)).monospacedDigit().contentTransition(.numericText(value: m.lastMonth)) }
                }
                ProgressView(value: Double(min(m.dayOfMonth, m.daysInMonth)), total: Double(m.daysInMonth)) {
                    Text("Day \(m.dayOfMonth) of \(m.daysInMonth)").font(.footnote).foregroundStyle(.secondary)
                }
                .tint(Theme.accent)
            } header: {
                LedgerHeading(title: "This month")
            }
        }
    }

    private struct DayPoint: Identifiable {
        let id: String
        let date: Date
        let spend: Double
    }

    private func dailyChart(_ points: [DayPoint], _ cur: String) -> some View {
        #if os(macOS)
        AdsDailyHoverChart(days: points.map { (p: DayPoint) in AdsDailyPoint(id: p.id, date: p.date, spend: p.spend) }, currency: cur)
        #else
        Chart(points) { (p: DayPoint) in
            BarMark(x: .value("Day", p.date, unit: .day), y: .value("Spent", p.spend))
                .foregroundStyle(Theme.accent)
        }
        #endif
    }

    @ViewBuilder
    private func dailySection(_ d: AdOverview, _ cur: String) -> some View {
        let points: [DayPoint] = d.daily.compactMap { (day: AdDay) -> DayPoint? in
            guard let date = AdsDay.plot(day.date) else { return nil }
            return DayPoint(id: day.date, date: date, spend: day.metrics.spend)
        }
        if points.count > 1 {
            Section {
                dailyChart(points, cur)
                .frame(height: 180)
                .accessibilityLabel("Spend each day over the range")
                .accessibilityValue(ChartSummary.say(points.map { (label: ChartSummary.day($0.date), value: $0.spend) }, money: false))
            } header: {
                LedgerHeading(title: "Day by day")
            }
        }
    }

    @ViewBuilder
    private func topAdsSection(_ d: AdOverview, _ cur: String) -> some View {
        Section {
            if d.topAds.isEmpty {
                Text("No ad spent anything in \(AdsRange.label(rangeKey).lowercased()).").foregroundStyle(.secondary)
            } else {
                ForEach(d.topAds) { (a: AdTop) in
                    NavigationLink(value: Route(path: "/ads/campaigns?ad=\(a.id)")) { topAdRow(a, cur) }
                }
            }
        } header: {
            LedgerHeading(title: "The ads that spent most")
        }
    }

    private func topAdRow(_ a: AdTop, _ cur: String) -> some View {
        HStack(spacing: 12) {
            StockImage(imageUrl: a.thumbnail, name: a.name, key: a.id)
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).lineLimit(1)
                Text(a.campaign).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(AdsFormat.money(a.metrics.spend, cur)).font(.subheadline.weight(.semibold)).monospacedDigit()
                    .contentTransition(.numericText(value: a.metrics.spend))
                Text(resultLine(a, cur)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    private func resultLine(_ a: AdTop, _ cur: String) -> String {
        let s = AdsResults.sales(a.metrics)
        let roas = s.value > 0 ? " · \(AdsResults.roasText(s.roas)) ROAS" : ""
        guard let r = AdsResults.of(a.metrics, goal: a.goal) else { return "\(AdsFormat.compact(a.metrics.reach)) reached\(roas)" }
        let each = r.value > 0 ? " · \(AdsFormat.money(a.metrics.spend / r.value, cur)) each" : ""
        return "\(AdsFormat.count(r.value)) \(r.label.lowercased())\(each)\(roas)"
    }

    @ViewBuilder
    private func splitSection(_ title: String, _ rows: [AdSplit], _ cur: String) -> some View {
        let top = Array(rows.prefix(8))
        let bySpend = top.contains { (r: AdSplit) in r.metrics.spend > 0 }
        let biggest = top.map { (r: AdSplit) in bySpend ? r.metrics.spend : r.metrics.impressions }.max() ?? 1
        if !top.isEmpty {
            Section {
                ForEach(top) { (r: AdSplit) in
                    let v = bySpend ? r.metrics.spend : r.metrics.impressions
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(r.label).lineLimit(1)
                            Spacer(minLength: 8)
                            Text(bySpend ? AdsFormat.money(v, cur) : "\(AdsFormat.compact(v)) views")
                                .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                                .contentTransition(.numericText(value: v))
                        }
                        ProgressView(value: v, total: max(biggest, 1)).tint(Theme.accent)
                    }
                }
            } header: {
                LedgerHeading(title: title)
            }
        }
    }

    // MARK: Elsewhere in Ads

    @ViewBuilder
    private var linksSection: some View {
        Section {
            MarketingLink(title: "Campaigns", symbol: "checklist", path: "/ads/campaigns")
            MarketingLink(title: "New ad", symbol: "paperplane", path: "/ads/new")
            MarketingLink(title: "Setup", symbol: "slider.horizontal.3", path: "/ads/setup")
        } footer: {
            if let d = data, !d.at.isEmpty {
                Text("From Meta, \(MarketingTime.clock(d.at)). Today's numbers keep changing for a few hours; reach across days can't be added up, so \"people reached\" is Meta's own count for the whole range.")
            }
        }
    }
}

#if os(macOS)
/// Spend day by day, read by hovering: the day under the pointer is marked and its spend said.
struct AdsDailyPoint: Identifiable {
    let id: String
    let date: Date
    let spend: Double
}

struct AdsDailyHoverChart: View {
    let days: [AdsDailyPoint]
    let currency: String
    @State private var hovered: Date?

    var body: some View {
        Chart {
            ForEach(days) { (d: AdsDailyPoint) in
                BarMark(x: .value("Day", d.date, unit: .day), y: .value("Spent", d.spend))
                    .foregroundStyle(Theme.accent.opacity(hovered == nil || hovered == d.date ? 1 : 0.55))
            }
            if let h = hovered, let d = days.first(where: { (x: AdsDailyPoint) in x.date == h }) {
                RuleMark(x: .value("Day", h, unit: .day))
                    .foregroundStyle(Color.secondary.opacity(0.4))
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ChartSummary.day(h)).font(.caption.weight(.semibold))
                            Text(AdsFormat.money(d.spend, currency)).font(.caption).monospacedDigit()
                        }
                        .padding(8)
                        .background(Theme.card, in: .rect(cornerRadius: 8, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                    }
            }
        }
        .chartOverlay { (proxy: ChartProxy) in
            GeometryReader { (geo: GeometryProxy) in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { (phase: HoverPhase) in
                        switch phase {
                        case .active(let at):
                            guard let frame = proxy.plotFrame else { return }
                            let x = at.x - geo[frame].origin.x
                            guard let date: Date = proxy.value(atX: x) else { return }
                            hovered = days.min { (a: AdsDailyPoint, b: AdsDailyPoint) in abs(a.date.timeIntervalSince(date)) < abs(b.date.timeIntervalSince(date)) }?.date
                        case .ended:
                            hovered = nil
                        }
                    }
            }
        }
        .accessibilityLabel("Spend each day over the range")
        .accessibilityValue(ChartSummary.say(days.map { (label: ChartSummary.day($0.date), value: $0.spend) }, money: false))
    }
}

extension AdsOverviewScreen {
    /// Two columns on a wide window: the figures, the days and the ads that spent most; beside them what needs a look,
    /// what it brought, the month and who saw the ads.
    func macContent(_ d: AdOverview) -> some View {
        let cur = d.account.currency
        return MacTwoPane(sideWidth: 420, sideOnRight: true) {
            List {
                Group {
                    attentionSection(d)
                    broughtSection(d)
                    monthSection(d, cur)
                    bottomSections(d, cur)
                }
                .houseRows()
            }
            .listStyle(.inset)
        } main: {
            List {
                Group {
                    accountSection(d)
                    if let problem {
                        Section { Label(problem, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) } header: { LedgerHeading(title: "Couldn't refresh") }
                    }
                    figuresSection(d, cur)
                    dailySection(d, cur)
                    topAdsSection(d, cur)
                }
                .houseRows()
            }
            .listStyle(.inset)
        }
        .navigationSubtitle(periodLine(d))
        .motion(d.totals.spend)
    }
}
#endif
