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
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Ads")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if mayRead {
                ToolbarItem(placement: .primaryAction) { AdsRangeMenu(key: $rangeKey) }
            }
        }
        .navigationDestination(item: $go) { (r: Route) in PlaceScreen(path: r.path) }
        .task(id: rangeKey) { if mayRead { await load() } }
        .confirmationDialog("Run it again?", isPresented: askingShown, titleVisibility: .visible, presenting: asking) { (a: AdAttention) in
            Button("Run again") { Task { await run(a, running: true) } }
        } message: { (a: AdAttention) in
            Text("\(a.targetName) will spend its budget again.")
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

    private func load(fresh: Bool = false) async {
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
            await load(fresh: true)
        } catch {
            failure = error.localizedDescription
        }
    }

    private func failed(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Ads aren't ready", systemImage: "megaphone")
        } description: {
            Text(message)
        } actions: {
            Button("Try again") { Task { await load(fresh: true) } }.buttonStyle(.glass)
            Button("Open Setup") { go = Route(path: "/ads/setup") }.buttonStyle(.glass)
        }
    }

    // MARK: The page

    private func content(_ d: AdOverview) -> some View {
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
    }

    @ViewBuilder
    private func topSections(_ d: AdOverview, _ cur: String) -> some View {
        accountSection(d)
        if let problem {
            Section { Label(problem, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary) } header: { Text("Couldn't refresh") }
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
        let words = AdsStatusWords.ofAccount(d.account.status)
        return Section {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.account.name).font(.headline)
                    if let funding = d.account.funding, !funding.isEmpty {
                        Text(funding).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                StatusBadge(words.label, color: AdsStatusWords.color(words.tone))
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
        return Section {
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    FigureTile(label: "Spent", value: AdsFormat.money(t.spend, cur), detail: spentNote)
                    FigureTile(label: "People reached", value: AdsFormat.compact(t.reach), detail: reachNote)
                }
                HStack(spacing: 10) {
                    mainTile(t, b, main, cur)
                    FigureTile(label: "Click-through", value: AdsFormat.pct(t.ctr),
                               detail: "\(AdsFormat.money(t.cpm, cur)) per 1,000 views")
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
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
        let actions = AdsResults.headlineActions(d.totals, limit: 10)
        if !actions.isEmpty {
            Section {
                ForEach(actions) { (a: AdsResults.Line) in
                    LabeledContent(a.label) { Text(AdsFormat.count(a.value)).monospacedDigit() }
                }
            } header: {
                Text("What it brought")
            }
        }
    }

    // MARK: Needs a look

    @ViewBuilder
    private func attentionSection(_ d: AdOverview) -> some View {
        Section {
            if d.attention.isEmpty {
                Label("Nothing needs attention.", systemImage: "checkmark.circle").foregroundStyle(.green)
            } else {
                ForEach(d.attention) { (a: AdAttention) in attentionItem(a) }
            }
        } header: {
            Text(d.attention.isEmpty ? "Needs a look" : "Needs a look: \(d.attention.count)")
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
                .foregroundStyle(a.severity == "bad" ? Color.red : (a.severity == "warn" ? Color.orange : Color.secondary))
            VStack(alignment: .leading, spacing: 4) {
                Text(a.title).font(.body.weight(.medium))
                Text(a.why).font(.subheadline).foregroundStyle(.secondary)
                if a.doing == "pause" {
                    Button("Pause") { Task { await run(a, running: false) } }
                        .buttonStyle(.glass)
                        .disabled(acting == a.targetId)
                } else if a.doing == "resume" {
                    Button("Run again") { asking = a }
                        .buttonStyle(.glass)
                        .disabled(acting == a.targetId)
                }
            }
        }
    }

    /// An ad's own page is the ERP's (its previews and Meta's review notes); the rest are native or ERP pages by path.
    private func openPath(_ href: String) -> String {
        href.contains("?ad=") ? href + "&web=1" : href
    }

    // MARK: Month, days, top ads, who saw them

    @ViewBuilder
    private func monthSection(_ d: AdOverview, _ cur: String) -> some View {
        if let m = d.month, m.spent > 0 || m.lastMonth > 0 {
            Section {
                LabeledContent("Spent so far") { Text(AdsFormat.money(m.spent, cur)).monospacedDigit() }
                LabeledContent("Heading for") { Text(AdsFormat.money(m.projected, cur)).monospacedDigit() }
                if m.lastMonth > 0 {
                    LabeledContent("Last month") { Text(AdsFormat.money(m.lastMonth, cur)).monospacedDigit() }
                }
                ProgressView(value: Double(min(m.dayOfMonth, m.daysInMonth)), total: Double(m.daysInMonth)) {
                    Text("Day \(m.dayOfMonth) of \(m.daysInMonth)").font(.footnote).foregroundStyle(.secondary)
                }
                .tint(Theme.accent)
            } header: {
                Text("This month")
            }
        }
    }

    private struct DayPoint: Identifiable {
        let id: String
        let date: Date
        let spend: Double
    }

    @ViewBuilder
    private func dailySection(_ d: AdOverview, _ cur: String) -> some View {
        let points: [DayPoint] = d.daily.compactMap { (day: AdDay) -> DayPoint? in
            guard let date = AdsDay.plot(day.date) else { return nil }
            return DayPoint(id: day.date, date: date, spend: day.metrics.spend)
        }
        if points.count > 1 {
            Section {
                Chart(points) { (p: DayPoint) in
                    BarMark(x: .value("Day", p.date, unit: .day), y: .value("Spent", p.spend))
                        .foregroundStyle(Theme.accent)
                }
                .frame(height: 180)
                .accessibilityLabel("Spend each day over the range")
            } header: {
                Text("Day by day")
            } footer: {
                Text("Spend each day, in \(cur.uppercased()).")
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
                    NavigationLink(value: Route(path: "/ads/campaigns?ad=\(a.id)&web=1")) { topAdRow(a, cur) }
                }
            }
        } header: {
            Text("The ads that spent most")
        }
    }

    private func topAdRow(_ a: AdTop, _ cur: String) -> some View {
        HStack(spacing: 12) {
            StockImage(imageUrl: a.thumbnail, name: a.name, key: a.id)
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).lineLimit(1)
                Text(a.campaign).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(AdsFormat.money(a.metrics.spend, cur)).font(.subheadline.weight(.semibold)).monospacedDigit()
                Text(resultLine(a, cur)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    private func resultLine(_ a: AdTop, _ cur: String) -> String {
        guard let r = AdsResults.of(a.metrics, goal: a.goal) else { return "\(AdsFormat.compact(a.metrics.reach)) reached" }
        let each = r.value > 0 ? " · \(AdsFormat.money(a.metrics.spend / r.value, cur)) each" : ""
        return "\(AdsFormat.count(r.value)) \(r.label.lowercased())\(each)"
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
                        }
                        ProgressView(value: v, total: max(biggest, 1)).tint(Theme.accent)
                    }
                }
            } header: {
                Text(title)
            }
        }
    }

    // MARK: Elsewhere in Ads

    @ViewBuilder
    private var linksSection: some View {
        Section {
            MarketingLink(title: "Campaigns", subtitle: "Every campaign, ad set and ad; run or pause them", symbol: "checklist", path: "/ads/campaigns")
            if MarketingKit.has("/ads/studio", role: session.role) {
                MarketingLink(title: "Studio", subtitle: "Make the creative before the ad", symbol: "paintpalette", path: "/ads/studio")
            }
            MarketingLink(title: "New ad", subtitle: "Boost a piece or an Instagram post", symbol: "paperplane", path: "/ads/new")
            MarketingLink(title: "Setup", subtitle: "The Meta connection, ad account, audiences and rules", symbol: "slider.horizontal.3", path: "/ads/setup")
        } footer: {
            if let d = data, !d.at.isEmpty {
                Text("From Meta, \(MarketingTime.clock(d.at)). Today's numbers keep changing for a few hours; reach across days can't be added up, so \"people reached\" is Meta's own count for the whole range.")
            }
        }
    }
}
