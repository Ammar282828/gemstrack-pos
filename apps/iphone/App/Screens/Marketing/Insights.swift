import SwiftUI
import Charts
import ERPCore

// Insights (src/app/insights, docs/features/insights.md): the house's Instagram and Facebook, organic beside paid,
// read from /api/insights (owners and marketing accounts, like Ads). Three screens on the web's own paths:
// Overview, Posts, Audience. What the numbers say comes worked out from the server (`part=findings`, shape.ts
// findingsFor), so the phone and the web never disagree; nothing here decides anything.

// MARK: - Answers

struct InsightPart: Decodable, Hashable, Identifiable {
    var key = ""
    var value = 0.0
    var id: String { key }
    private enum K: String, CodingKey { case key, value }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        value = c.double(.value, default: 0)
    }
}

struct InsightSplit: Decodable, Hashable {
    var ads = 0.0
    var organic = 0.0
    var adsShare: Double?
    var bySurface: [InsightPart] = []
    private enum K: String, CodingKey { case ads, organic, adsShare, bySurface }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ads = c.double(.ads, default: 0)
        organic = c.double(.organic, default: 0)
        adsShare = c.double(.adsShare)
        bySurface = c.list(.bySurface, of: InsightPart.self)
    }
}

struct InsightFollows: Decodable, Hashable {
    var follows = 0.0
    var unfollows = 0.0
    var net = 0.0
    private enum K: String, CodingKey { case follows, unfollows, net }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        follows = c.double(.follows, default: 0)
        unfollows = c.double(.unfollows, default: 0)
        net = c.double(.net, default: 0)
    }
}

/// `{ "reach": 18556, … }` with any odd value left out.
private func numbers<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> [String: Double] {
    let raw = (try? c.decodeIfPresent([String: Lossy<Double>].self, forKey: key)) ?? [:]
    var out: [String: Double] = [:]
    for (k, v) in raw { if let n = v.value { out[k] = n } }
    return out
}

struct InstagramInsight: Decodable {
    var username = ""
    var picture: String?
    var followers = 0.0
    var totals: [String: Double] = [:]
    var previous: [String: Double] = [:]
    var reach: InsightSplit?
    var views: InsightSplit?
    var interactions: InsightSplit?
    var nonFollowerReach: Double?
    var follows: InsightFollows?
    var previousFollows: InsightFollows?
    var daily: [Day] = []

    struct Day: Decodable, Identifiable {
        var date = ""
        var reach = 0.0
        var id: String { date }
        private enum K: String, CodingKey { case date, reach }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            date = c.string(.date, default: "")
            reach = c.double(.reach, default: 0)
        }
    }

    private struct Account: Decodable {
        var username = ""
        var picture: String?
        var followers = 0.0
        private enum K: String, CodingKey { case username, picture, followers }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            username = c.string(.username, default: "")
            picture = c.string(.picture)
            followers = c.double(.followers, default: 0)
        }
    }

    private enum K: String, CodingKey { case account, totals, previous, reach, views, interactions, nonFollowerReach, follows, previousFollows, daily }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let a = c.object(.account, of: Account.self)
        username = a?.username ?? ""
        picture = a?.picture
        followers = a?.followers ?? 0
        totals = numbers(c, .totals)
        previous = numbers(c, .previous)
        reach = c.object(.reach, of: InsightSplit.self)
        views = c.object(.views, of: InsightSplit.self)
        interactions = c.object(.interactions, of: InsightSplit.self)
        nonFollowerReach = c.double(.nonFollowerReach)
        follows = c.object(.follows, of: InsightFollows.self)
        previousFollows = c.object(.previousFollows, of: InsightFollows.self)
        daily = c.list(.daily, of: Day.self)
    }
}

struct FacebookInsight: Decodable {
    var name = ""
    var followers = 0.0
    var totals: [String: Double] = [:]
    var previous: [String: Double] = [:]
    var daily: [Day] = []

    struct Day: Decodable, Identifiable {
        var date = ""
        var views = 0.0
        var id: String { date }
        private enum K: String, CodingKey { case date, views }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            date = c.string(.date, default: "")
            views = c.double(.views, default: 0)
        }
    }

    private struct Page: Decodable {
        var name = ""
        var followers = 0.0
        private enum K: String, CodingKey { case name, followers }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            name = c.string(.name, default: "")
            followers = c.double(.followers, default: 0)
        }
    }

    private enum K: String, CodingKey { case page, totals, previous, daily }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let p = c.object(.page, of: Page.self)
        name = p?.name ?? ""
        followers = p?.followers ?? 0
        totals = numbers(c, .totals)
        previous = numbers(c, .previous)
        daily = c.list(.daily, of: Day.self)
    }
}

struct InsightPlatform: Decodable, Identifiable {
    var platform = ""
    var metrics = AdMetrics()
    var id: String { platform }
    private enum K: String, CodingKey { case platform, metrics }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        platform = c.string(.platform, default: "")
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
    }
}

struct InsightsOverview: Decodable {
    var instagram: InstagramInsight?
    var facebook: FacebookInsight?
    var paid: [InsightPlatform] = []
    var paidBefore: [InsightPlatform] = []
    var followerDays: [(date: String, followers: Double)] = []
    var currency = "PKR"
    var since = ""
    var until = ""
    var beforeSince = ""
    var beforeUntil = ""
    var at = ""

    private struct Paid: Decodable {
        var now: [InsightPlatform] = []
        var before: [InsightPlatform] = []
        private enum K: String, CodingKey { case now, before }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            now = c.list(.now, of: InsightPlatform.self)
            before = c.list(.before, of: InsightPlatform.self)
        }
    }
    private struct Kept: Decodable {
        var date = ""
        var igFollowers: Double?
        private enum K: String, CodingKey { case date, igFollowers }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            date = c.string(.date, default: "")
            igFollowers = c.double(.igFollowers)
        }
    }
    private struct Span: Decodable {
        var since = ""
        var until = ""
        private enum K: String, CodingKey { case since, until }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            since = c.string(.since, default: "")
            until = c.string(.until, default: "")
        }
    }

    private enum K: String, CodingKey { case instagram, facebook, paid, history, currency, since, until, previous, at }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        instagram = c.object(.instagram, of: InstagramInsight.self)
        facebook = c.object(.facebook, of: FacebookInsight.self)
        let p = c.object(.paid, of: Paid.self)
        paid = p?.now ?? []
        paidBefore = p?.before ?? []
        followerDays = c.list(.history, of: Kept.self).compactMap { (k: Kept) -> (date: String, followers: Double)? in
            guard let f = k.igFollowers else { return nil }
            return (date: k.date, followers: f)
        }
        currency = c.string(.currency, default: "PKR")
        since = c.string(.since, default: "")
        until = c.string(.until, default: "")
        let b = c.object(.previous, of: Span.self)
        beforeSince = b?.since ?? ""
        beforeUntil = b?.until ?? ""
        at = c.string(.at, default: "")
    }
}

struct InsightFinding: Decodable, Identifiable, Hashable {
    var tone = "info"
    var title = ""
    var why = ""
    var id: String { title }
    private enum K: String, CodingKey { case tone, title, why }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        tone = c.string(.tone, default: "info")
        title = c.string(.title, default: "")
        why = c.string(.why, default: "")
    }
}

private struct InsightFindings: Decodable {
    var findings: [InsightFinding] = []
    private enum K: String, CodingKey { case findings }
    init(from decoder: Decoder) throws {
        findings = (try decoder.container(keyedBy: K.self)).list(.findings, of: InsightFinding.self)
    }
}

struct InsightPost: Decodable, Identifiable, Hashable {
    var id = ""
    var platform = ""
    var kind = "post"
    var at = ""
    var caption = ""
    var thumb: String?
    var link: String?
    var reach: Double?
    var views: Double?
    var likes: Double?
    var comments: Double?
    var shares: Double?
    var saves: Double?
    var interactions: Double?
    var profileVisits: Double?
    var follows: Double?
    var avgWatchMs: Double?
    var facebookViews: Double?
    var clicks: Double?
    var replies: Double?
    var rate: Double?
    var older = false

    private enum K: String, CodingKey {
        case id, platform, kind, at, caption, thumb, link, reach, views, likes, comments, shares, saves, interactions
        case profileVisits, follows, avgWatchMs, facebookViews, clicks, replies, rate, older
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        platform = c.string(.platform, default: "")
        kind = c.string(.kind, default: "post")
        at = c.string(.at, default: "")
        caption = c.string(.caption, default: "")
        thumb = c.string(.thumb)
        link = c.string(.link)
        reach = c.double(.reach)
        views = c.double(.views)
        likes = c.double(.likes)
        comments = c.double(.comments)
        shares = c.double(.shares)
        saves = c.double(.saves)
        interactions = c.double(.interactions)
        profileVisits = c.double(.profileVisits)
        follows = c.double(.follows)
        avgWatchMs = c.double(.avgWatchMs)
        facebookViews = c.double(.facebookViews)
        clicks = c.double(.clicks)
        replies = c.double(.replies)
        rate = c.double(.rate)
        older = c.bool(.older, default: false)
    }
}

struct InsightsPosts: Decodable {
    var posts: [InsightPost] = []
    var stories: [InsightPost] = []
    var live: Set<String> = []
    var lastPostAt: String?
    private enum K: String, CodingKey { case posts, stories, liveStories, lastPostAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        posts = c.list(.posts, of: InsightPost.self)
        stories = c.list(.stories, of: InsightPost.self)
        live = Set(c.strings(.liveStories))
        lastPostAt = c.string(.lastPostAt)
    }
}

struct InsightDims: Decodable {
    var age: [InsightPart] = []
    var gender: [InsightPart] = []
    var city: [InsightPart] = []
    var country: [InsightPart] = []
    private enum K: String, CodingKey { case age, gender, city, country }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        age = c.list(.age, of: InsightPart.self)
        gender = c.list(.gender, of: InsightPart.self)
        city = c.list(.city, of: InsightPart.self)
        country = c.list(.country, of: InsightPart.self)
    }
}

struct InsightsAudience: Decodable {
    var followers: InsightDims?
    var reached: InsightDims?
    var engaged: InsightDims?
    var online: [Double]?

    private struct Inner: Decodable {
        var followers: InsightDims?
        var reached: InsightDims?
        var engaged: InsightDims?
        var online: [Double]?
        private enum K: String, CodingKey { case followers, reached, engaged, online }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            followers = c.object(.followers, of: InsightDims.self)
            reached = c.object(.reached, of: InsightDims.self)
            engaged = c.object(.engaged, of: InsightDims.self)
            let hours: [Lossy<Double>]? = (try? c.decodeIfPresent([Lossy<Double>].self, forKey: .online)) ?? nil
            online = hours.map { (list: [Lossy<Double>]) in list.map { (v: Lossy<Double>) in v.value ?? 0 } }
        }
    }
    private enum K: String, CodingKey { case audience }
    init(from decoder: Decoder) throws {
        let a = (try decoder.container(keyedBy: K.self)).object(.audience, of: Inner.self)
        followers = a?.followers
        reached = a?.reached
        engaged = a?.engaged
        online = a?.online
    }
}

// MARK: - Shared

enum InsightRange {
    static let all: [AdsRange.Option] = [
        AdsRange.Option(key: "last_7d", label: "Last 7 days"), AdsRange.Option(key: "last_14d", label: "Last 14 days"),
        AdsRange.Option(key: "last_28d", label: "Last 28 days"), AdsRange.Option(key: "this_month", label: "This month"),
    ]
    static func label(_ key: String) -> String { all.first { (r: AdsRange.Option) in r.key == key }?.label ?? key }
}

@MainActor
enum InsightsAPI {
    static func get<T: Decodable>(_ part: String, range: String, fresh: Bool, as type: T.Type) async throws -> T {
        try await SWR.get("/api/insights?part=\(part)&range=\(range)\(fresh ? "&fresh=1" : "")", keep: "/api/insights?part=\(part)&range=\(range)", as: T.self)
    }

    /// The last answer for this part and range, shown while the new one is read.
    static func last<T: Decodable>(_ part: String, range: String, as type: T.Type) -> T? {
        SWR.peek("/api/insights?part=\(part)&range=\(range)", as: T.self)
    }
}

/// The range as a toolbar menu, its own key (Instagram stops at 30 days, so it isn't Ads' range).
struct InsightRangeMenu: View {
    @Binding var key: String
    var body: some View {
        Menu {
            Picker("Range", selection: $key) {
                ForEach(InsightRange.all) { (r: AdsRange.Option) in Text(r.label).tag(r.key) }
            }
        } label: {
            Label(InsightRange.label(key), systemImage: "calendar")
        }
    }
}

enum InsightWords {
    static let surface: [String: String] = ["POST": "Posts", "CAROUSEL_CONTAINER": "Carousels", "REEL": "Reels", "STORY": "Stories", "AD": "Ads"]
    static let kind: [String: String] = ["post": "Photo post", "carousel": "Carousel", "reel": "Reel", "story": "Story", "fb": "Facebook post"]
    static let platform: [String: String] = ["instagram": "Instagram", "facebook": "Facebook", "messenger": "Messenger", "audience_network": "Audience Network", "threads": "Threads"]
    static let gender: [String: String] = ["F": "Women", "M": "Men", "U": "Not said"]
    static let country: [String: String] = ["PK": "Pakistan", "AE": "UAE", "SA": "Saudi Arabia", "GB": "United Kingdom", "US": "United States", "CA": "Canada", "AU": "Australia", "IN": "India", "BD": "Bangladesh", "DE": "Germany", "QA": "Qatar"]
    static func optional(_ v: Double?) -> String { v.map { (x: Double) in AdsFormat.compact(x) } ?? "—" }
    static func percent(_ v: Double?) -> String { v.map { (x: Double) in String(format: "%.1f%%", x * 100) } ?? "—" }
    static func hour(_ h: Int) -> String { "\((h + 11) % 12 + 1)\(h < 12 ? "am" : "pm")" }
}

private struct InsightsLocked: View {
    var body: some View {
        NotAvailableState("Insights are for owners", why: "Sign in with an owner or marketing account to see the shop's Instagram and Facebook numbers.", symbol: "lock")
    }
}

// MARK: - Overview

// MARK: - An iPad's wide window

/// A titled block of an insights screen: a List section on a phone, a card in a column on an iPad's wide window
/// (`bare`: the content is tiles that are cards already).
struct InsightBlock<Content: View>: View {
    let title: String
    var trailing: String?
    var count: Int?
    var footer: String?
    var bare = false
    @ViewBuilder let content: () -> Content
    @Environment(\.siteWide) private var wide

    var body: some View {
        if wide {
            if bare {
                stack
            } else {
                stack.ledgerCard()
            }
        } else if title.isEmpty {
            Section {
                content()
            } footer: {
                if let footer { Text(footer) }
            }
            .houseRows()
        } else {
            Section {
                content()
            } header: {
                LedgerHeading(title: title, count: count, trailing: trailing)
            } footer: {
                if let footer { Text(footer) }
            }
            .houseRows()
        }
    }

    private var stack: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !title.isEmpty { LedgerHeading(title: title, count: count, trailing: trailing) }
            content()
            if let footer { Text(footer).font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

/// Figure tiles: pairs on a phone, four across on an iPad's wide window.
private struct InsightTiles: View {
    let tiles: [FigureTile]
    @Environment(\.siteWide) private var wide

    var body: some View {
        if wide {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4), spacing: 10) {
                ForEach(tiles.indices, id: \.self) { (i: Int) in tiles[i] }
            }
        } else {
            VStack(spacing: 10) {
                ForEach(Array(stride(from: 0, to: tiles.count, by: 2)), id: \.self) { (i: Int) in
                    FigureRow(spacing: 10) {
                        tiles[i]
                        if i + 1 < tiles.count { tiles[i + 1] }
                    }
                }
            }
        }
    }
}

/// The phone's List, or on an iPad's wide window (regular width, 820 points and more) the same blocks as cards in a
/// scrolling page. `wide` is told the page's width, for the number of columns.
private struct InsightPage<Narrow: View, Wide: View>: View {
    var refresh: () async -> Void
    @ViewBuilder let narrow: () -> Narrow
    @ViewBuilder let wide: (CGFloat) -> Wide
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    private var isWide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    var body: some View {
        Group {
            if isWide {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) { wide(width) }
                        .environment(\.siteWide, true)
                        .padding(.horizontal, 28)
                        .padding(.top, 8)
                        .padding(.bottom, 28)
                        .frame(maxWidth: 1240)
                        .frame(maxWidth: .infinity)
                }
                .background(Theme.ground)
                .refreshable { await refresh() }
            } else {
                narrow()
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

struct InsightsOverviewScreen: View {
    @Environment(Session.self) private var session
    @AppStorage("insights.range") private var rangeKey = "last_28d"
    @State private var data: InsightsOverview?
    @State private var found: [InsightFinding] = []
    @State private var problem: String?

    private var mayRead: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        Group {
            if !mayRead {
                InsightsLocked()
            } else if let data {
                content(data)
            } else if let problem {
                ErrorState(problem, retry: House.isDemo ? nil : { Task { await load(fresh: true) } })
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Insights")
        .navigationBarTitleDisplayMode(.large)
        .toolbar { if mayRead { ToolbarItem(placement: .primaryAction) { InsightRangeMenu(key: $rangeKey) } } }
        .task(id: rangeKey) { if mayRead { await load() } }
    }

    private func load(fresh: Bool = false) async {
        if data == nil, let cached = InsightsAPI.last("overview", range: rangeKey, as: InsightsOverview.self) { data = cached }
        do {
            data = try await InsightsAPI.get("overview", range: rangeKey, fresh: fresh, as: InsightsOverview.self)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        // The findings read all three parts on the server; a failure there only hides them.
        found = (try? await InsightsAPI.get("findings", range: rangeKey, fresh: false, as: InsightFindings.self).findings) ?? []
    }

    private func content(_ d: InsightsOverview) -> some View {
        InsightPage(refresh: { await load(fresh: true) }) {
            List {
                Group {
                    findingsSection
                    if let ig = d.instagram {
                        instagramFigures(ig)
                        splitSection(ig)
                        reachChart(ig)
                        followersSection(d)
                    }
                    paidSection(d)
                    if let fb = d.facebook { facebookSection(fb) }
                    placesSection(d)
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
            .refreshable { await load(fresh: true) }
        } wide: { _ in
            findingsSection
            if let ig = d.instagram {
                instagramFigures(ig)
                // The two charts side by side, then the split beside the paid platforms.
                HStack(alignment: .top, spacing: 20) {
                    reachChart(ig).frame(maxWidth: .infinity, alignment: .top)
                    followersSection(d).frame(maxWidth: .infinity, alignment: .top)
                }
                HStack(alignment: .top, spacing: 20) {
                    splitSection(ig).frame(maxWidth: .infinity, alignment: .top)
                    paidSection(d).frame(maxWidth: .infinity, alignment: .top)
                }
            } else {
                paidSection(d)
            }
            if let fb = d.facebook { facebookSection(fb) }
            placesSection(d)
        }
    }

    @ViewBuilder
    private var findingsSection: some View {
        if !found.isEmpty {
            InsightBlock(title: "What the numbers say") {
                ForEach(found) { (f: InsightFinding) in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: f.tone == "good" ? "checkmark.circle" : (f.tone == "warn" ? "exclamationmark.triangle.fill" : "info.circle"))
                            .foregroundStyle(f.tone == "good" ? Tone.settled.color : (f.tone == "warn" ? Tone.owed.color : Color.secondary))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(f.title).font(.body.weight(.medium))
                            Text(f.why).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func instagramFigures(_ ig: InstagramInsight) -> some View {
        let t = ig.totals, p = ig.previous
        func v(_ k: String) -> Double { t[k] ?? 0 }
        let follows = ig.follows.map { (f: InsightFollows) in "\(f.net >= 0 ? "+" : "−")\(AdsFormat.count(abs(f.net))) · \(AdsFormat.count(f.follows)) in, \(AdsFormat.count(f.unfollows)) out" }
        let newPeople = ig.nonFollowerReach.map { (s: Double) in "\(Int((s * 100).rounded()))% not following" }
        let linkShare = v("profile_views") > 0 ? String(format: "%.1f%% of visits", 100 * v("website_clicks") / v("profile_views")) : nil
        let tiles: [FigureTile] = [
            FigureTile(label: "Followers", value: AdsFormat.count(ig.followers), detail: follows),
            FigureTile(label: "Accounts reached", value: AdsFormat.compact(v("reach")), detail: AdsFormat.change(v("reach"), p["reach"]) ?? newPeople),
            FigureTile(label: "Views", value: AdsFormat.compact(v("views")), detail: AdsFormat.change(v("views"), p["views"])),
            FigureTile(label: "Accounts engaged", value: AdsFormat.compact(v("accounts_engaged")), detail: AdsFormat.change(v("accounts_engaged"), p["accounts_engaged"])),
            FigureTile(label: "Interactions", value: AdsFormat.compact(v("total_interactions")), detail: "\(AdsFormat.compact(v("likes"))) likes · \(AdsFormat.compact(v("comments"))) comments"),
            FigureTile(label: "Shares · saves", value: "\(AdsFormat.compact(v("shares"))) · \(AdsFormat.compact(v("saves")))", detail: "\(AdsFormat.compact(v("replies"))) story replies"),
            FigureTile(label: "Profile visits", value: AdsFormat.compact(v("profile_views")), detail: AdsFormat.change(v("profile_views"), p["profile_views"])),
            FigureTile(label: "Link taps", value: AdsFormat.compact(v("website_clicks")), detail: linkShare)
        ]
        return InsightBlock(title: "Instagram", trailing: "@\(ig.username)", bare: true) {
            InsightTiles(tiles: tiles)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
        }
    }

    private func splitSection(_ ig: InstagramInsight) -> some View {
        InsightBlock(title: "Ads or own posts?", footer: "Counted per surface (posts, carousels, reels, stories, ads), so the parts can add up to more than the account's reach.") {
            splitRow("Accounts reached", ig.reach)
            splitRow("Views", ig.views)
            splitRow("Interactions", ig.interactions)
        }
    }

    @ViewBuilder
    private func splitRow(_ title: String, _ s: InsightSplit?) -> some View {
        if let s, s.ads + s.organic > 0 {
            let share = s.adsShare ?? 0
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(title)
                    Spacer(minLength: 8)
                    Text("ads \(AdsFormat.compact(s.ads)) · own \(AdsFormat.compact(s.organic))").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                }
                GeometryReader { (g: GeometryProxy) in
                    HStack(spacing: 2) {
                        Capsule().fill(Theme.accent).frame(width: max(0, (g.size.width - 2) * share))
                        Capsule().fill(Theme.accent.opacity(0.35))
                    }
                }
                .frame(height: 8)
                .accessibilityLabel("\(Int((share * 100).rounded()))% from ads")
                Text(([("From ads \(Int((share * 100).rounded()))%")] + s.bySurface.filter { (p: InsightPart) in p.value > 0 }.map { (p: InsightPart) in "\(InsightWords.surface[p.key] ?? p.key) \(AdsFormat.compact(p.value))" }).joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private struct Point: Identifiable {
        let id: String
        let date: Date
        let value: Double
    }

    @ViewBuilder
    private func reachChart(_ ig: InstagramInsight) -> some View {
        let points: [Point] = ig.daily.compactMap { (d: InstagramInsight.Day) -> Point? in
            guard let date = AdsDay.plot(d.date) else { return nil }
            return Point(id: d.date, date: date, value: d.reach)
        }
        if points.count > 1 {
            InsightBlock(title: "Reached, day by day") {
                Chart(points) { (p: Point) in
                    BarMark(x: .value("Day", p.date, unit: .day), y: .value("Reached", p.value)).foregroundStyle(Theme.accent)
                }
                .frame(height: 180)
                .accessibilityLabel("Accounts reached each day, ads included")
                .accessibilityValue(ChartSummary.say(points.map { (label: ChartSummary.day($0.date), value: $0.value) }, money: false))
            }
        }
    }

    private func followersSection(_ d: InsightsOverview) -> some View {
        let points: [Point] = d.followerDays.compactMap { (k: (date: String, followers: Double)) -> Point? in
            guard let date = AdsDay.plot(k.date) else { return nil }
            return Point(id: k.date, date: date, value: k.followers)
        }
        return InsightBlock(title: "Followers over time") {
            if points.count > 1 {
                Chart(points) { (p: Point) in
                    LineMark(x: .value("Day", p.date, unit: .day), y: .value("Followers", p.value)).foregroundStyle(Theme.accent)
                }
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(height: 160)
                .accessibilityLabel("Followers over time")
                .accessibilityValue(ChartSummary.say(points.map { (label: ChartSummary.day($0.date), value: $0.value) }, money: false, total: false))
            } else {
                Text("Meta keeps no follower history, so the ERP writes the count down every day. The line fills in from there.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private func paidSection(_ d: InsightsOverview) -> some View {
        let shown = d.paid.filter { (p: InsightPlatform) in p.metrics.spend > 0 || p.metrics.impressions > 0 }
        let before = Dictionary(uniqueKeysWithValues: d.paidBefore.map { (p: InsightPlatform) in (p.platform, p.metrics.spend) })
        return InsightBlock(title: "Ads by platform") {
            if shown.isEmpty {
                Text("No ad ran in \(InsightRange.label(rangeKey).lowercased()).").foregroundStyle(.secondary)
            } else {
                ForEach(shown) { (p: InsightPlatform) in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(InsightWords.platform[p.platform] ?? p.platform).font(.body.weight(.medium))
                            Spacer(minLength: 8)
                            Text(AdsFormat.money(p.metrics.spend, d.currency)).font(.body.weight(.semibold)).monospacedDigit()
                        }
                        Text([AdsFormat.change(p.metrics.spend, before[p.platform]), "\(AdsFormat.compact(p.metrics.reach)) reached", "\(AdsFormat.compact(p.metrics.impressions)) views", "\(AdsFormat.count(p.metrics.linkClicks)) link clicks"]
                            .compactMap { (s: String?) in s }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                        let results = AdsResults.headlineActions(p.metrics, limit: 4)
                        if !results.isEmpty {
                            Text(results.map { (r: AdsResults.Line) in "\(AdsFormat.count(r.value)) \(r.label.lowercased())" }.joined(separator: " · ")).font(.caption)
                        }
                    }
                }
            }
            MarketingLink(title: "Ads overview", symbol: "megaphone", path: "/ads")
        }
    }

    private func facebookSection(_ fb: FacebookInsight) -> some View {
        let t = fb.totals, p = fb.previous
        func v(_ k: String) -> Double { t[k] ?? 0 }
        let points: [Point] = fb.daily.compactMap { (d: FacebookInsight.Day) -> Point? in
            guard let date = AdsDay.plot(d.date) else { return nil }
            return Point(id: d.date, date: date, value: d.views)
        }
        return InsightBlock(title: "Facebook", trailing: fb.name) {
            VStack(spacing: 10) {
                InsightTiles(tiles: [
                    FigureTile(label: "Followers", value: AdsFormat.count(fb.followers), detail: "+\(AdsFormat.count(v("page_daily_follows_unique"))) · −\(AdsFormat.count(v("page_daily_unfollows_unique")))"),
                    FigureTile(label: "Views", value: AdsFormat.compact(v("page_media_view")), detail: AdsFormat.change(v("page_media_view"), p["page_media_view"]) ?? "\(AdsFormat.compact(v("page_total_media_view_unique"))) people"),
                    FigureTile(label: "Engagement", value: AdsFormat.compact(v("page_post_engagements")), detail: AdsFormat.change(v("page_post_engagements"), p["page_post_engagements"])),
                    FigureTile(label: "Page visits", value: AdsFormat.compact(v("page_views_total")), detail: AdsFormat.change(v("page_views_total"), p["page_views_total"]))
                ])
                if points.count > 1 && points.contains(where: { (x: Point) in x.value > 0 }) {
                    Chart(points) { (x: Point) in
                        BarMark(x: .value("Day", x.date, unit: .day), y: .value("Views", x.value)).foregroundStyle(Theme.accent)
                    }
                    .frame(height: 140)
                    .accessibilityLabel("Page views each day")
                    .accessibilityValue(ChartSummary.say(points.map { (label: ChartSummary.day($0.date), value: $0.value) }, money: false))
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
        }
    }

    private func placesSection(_ d: InsightsOverview) -> some View {
        let foot = d.at.isEmpty ? nil : "\(ShopDate.say(d.since)) to \(ShopDate.say(d.until)), compared with \(ShopDate.say(d.beforeSince)) to \(ShopDate.say(d.beforeUntil)). From Meta, \(MarketingTime.clock(d.at)). Instagram's numbers include its ads; the split takes them apart."
        return InsightBlock(title: "", footer: foot) {
            MarketingLink(title: "Posts", subtitle: "Every post, reel and story, with its numbers", symbol: "square.grid.2x2", path: "/insights/posts")
            MarketingLink(title: "Audience", subtitle: "Who follows, who was reached, when they're online", symbol: "person.2", path: "/insights/audience")
        }
    }
}

// MARK: - Posts

struct InsightsPostsScreen: View {
    @Environment(Session.self) private var session
    @AppStorage("insights.range") private var rangeKey = "last_28d"
    @State private var data: InsightsPosts?
    @State private var problem: String?
    @State private var filter = "all"
    @State private var sort = "at"

    private var mayRead: Bool { session.role == "owner" || session.role == "marketing" }
    private static let filters: [(key: String, label: String)] = [("all", "All"), ("reel", "Reels"), ("post", "Photos"), ("carousel", "Carousels"), ("story", "Stories"), ("fb", "Facebook"), ("older", "Older, still earning")]
    private static let sorts: [(key: String, label: String)] = [("at", "Newest"), ("views", "Views"), ("reach", "Reach"), ("interactions", "Interactions"), ("rate", "Engagement rate"), ("shares", "Shares"), ("saves", "Saves")]

    var body: some View {
        Group {
            if !mayRead {
                InsightsLocked()
            } else if let data {
                content(data)
            } else if let problem {
                ContentUnavailableView("Couldn't read the posts", systemImage: "square.grid.2x2", description: Text(problem))
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Posts")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if mayRead {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Sort", selection: $sort) { ForEach(Self.sorts, id: \.key) { (s: (key: String, label: String)) in Text(s.label).tag(s.key) } }
                        Picker("Range", selection: $rangeKey) { ForEach(InsightRange.all) { (r: AdsRange.Option) in Text(r.label).tag(r.key) } }
                    } label: { Label("Sort", systemImage: "arrow.up.arrow.down") }
                }
            }
        }
        .task(id: rangeKey) { if mayRead { await load() } }
    }

    private func load(fresh: Bool = false) async {
        if data == nil, let cached = InsightsAPI.last("posts", range: rangeKey, as: InsightsPosts.self) { data = cached }
        do {
            data = try await InsightsAPI.get("posts", range: rangeKey, fresh: fresh, as: InsightsPosts.self)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func value(_ p: InsightPost) -> Double {
        switch sort {
        case "views": return p.views ?? -1
        case "reach": return p.reach ?? -1
        case "interactions": return p.interactions ?? -1
        case "rate": return p.rate ?? -1
        case "shares": return p.shares ?? -1
        case "saves": return p.saves ?? -1
        default: return 0
        }
    }

    private func content(_ d: InsightsPosts) -> some View {
        let all = d.posts + d.stories
        let rows = all.filter { (p: InsightPost) in filter == "all" ? true : (filter == "older" ? p.older : p.kind == filter) }
        let shown = sort == "at" ? rows.sorted { (a: InsightPost, b: InsightPost) in a.at > b.at } : rows.sorted { (a: InsightPost, b: InsightPost) in value(a) > value(b) }
        return InsightPage(refresh: { await load(fresh: true) }) {
            postsList(d, shown)
        } wide: { _ in
            postsWide(d, shown)
        }
    }

    private static let postsNote = "A post's numbers are its lifetime so far. A story's exist only while it's up, so the ERP reads every live story each hour and keeps the last count. Engagement rate is interactions over reach."

    /// An iPad's page: the filters, then the posts as cards, two across.
    @ViewBuilder
    private func postsWide(_ d: InsightsPosts, _ shown: [InsightPost]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.filters, id: \.key) { (f: (key: String, label: String)) in
                    FilterChip(title: f.label, chosen: filter == f.key) { filter = f.key }
                }
            }
        }
        if let last = d.lastPostAt {
            Text("Last Instagram post \(ShopDate.say(last))").font(.footnote).foregroundStyle(.secondary)
        }
        LedgerHeading(title: "Posts", count: shown.count)
        if shown.isEmpty {
            Text("Nothing here for \(InsightRange.label(rangeKey).lowercased()).").foregroundStyle(.secondary)
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 440), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(shown) { (p: InsightPost) in row(p, live: d.live.contains(p.id)).ledgerCard() }
            }
        }
        Text(Self.postsNote).font(.footnote).foregroundStyle(.secondary)
    }

    private func postsList(_ d: InsightsPosts, _ shown: [InsightPost]) -> some View {
        List {
            Group {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Self.filters, id: \.key) { (f: (key: String, label: String)) in
                                FilterChip(title: f.label, chosen: filter == f.key) { filter = f.key }
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                    if let last = d.lastPostAt {
                        LabeledContent("Last Instagram post") { Text(ShopDate.say(last)) }
                    }
                }
                Section {
                    if shown.isEmpty {
                        Text("Nothing here for \(InsightRange.label(rangeKey).lowercased()).").foregroundStyle(.secondary)
                    } else {
                        ForEach(shown) { (p: InsightPost) in row(p, live: d.live.contains(p.id)) }
                    }
                } header: {
                    LedgerHeading(title: "Posts", count: shown.count)
                } footer: {
                    Text(Self.postsNote)
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await load(fresh: true) }
    }

    private func row(_ p: InsightPost, live: Bool) -> some View {
        let tall = p.kind == "story" || p.kind == "reel"
        var stats: [(String, String)] = [("Views", InsightWords.optional(p.views)), ("Reach", InsightWords.optional(p.reach)), ("Likes", InsightWords.optional(p.likes)),
                                         ("Comments", InsightWords.optional(p.comments)), ("Shares", InsightWords.optional(p.shares)), ("Rate", InsightWords.percent(p.rate))]
        if let s = p.saves { stats.append(("Saves", AdsFormat.compact(s))) }
        if let v = p.profileVisits { stats.append(("Profile visits", AdsFormat.compact(v))) }
        if let f = p.follows { stats.append(("Follows", AdsFormat.compact(f))) }
        if let w = p.avgWatchMs { stats.append(("Avg watch", String(format: "%.1fs", w / 1000))) }
        if let fv = p.facebookViews { stats.append(("On Facebook", AdsFormat.compact(fv))) }
        if let c = p.clicks { stats.append(("Clicks", AdsFormat.compact(c))) }
        return HStack(alignment: .top, spacing: 12) {
            StockImage(imageUrl: p.thumb, name: p.caption, key: p.id)
                .frame(width: tall ? 54 : 72, height: tall ? 96 : 72)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(InsightWords.kind[p.kind] ?? p.kind).font(.caption.weight(.medium))
                    Text(ShopDate.say(p.at)).font(.caption).foregroundStyle(.secondary)
                    if live { StatusBadge("Up now", color: Tone.settled.color) }
                    if p.older { Text("before this range").font(.caption).foregroundStyle(.secondary) }
                    Spacer(minLength: 0)
                    if let link = p.link, let url = URL(string: link) {
                        Link(destination: url) { Image(systemName: "arrow.up.right.square") }.foregroundStyle(.secondary)
                    }
                }
                if !p.caption.isEmpty { Text(p.caption).font(.subheadline).lineLimit(2) }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 6) {
                    ForEach(stats, id: \.0) { (s: (String, String)) in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(s.0).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            Text(s.1).font(.subheadline.weight(.semibold)).monospacedDigit()
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Audience

struct InsightsAudienceScreen: View {
    @Environment(Session.self) private var session
    @AppStorage("insights.range") private var rangeKey = "last_28d"
    @State private var data: InsightsAudience?
    @State private var problem: String?
    @State private var group = "followers"

    private var mayRead: Bool { session.role == "owner" || session.role == "marketing" }

    var body: some View {
        Group {
            if !mayRead {
                InsightsLocked()
            } else if let data {
                content(data)
            } else if let problem {
                ContentUnavailableView("Couldn't read the audience", systemImage: "person.2", description: Text(problem))
            } else {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Audience")
        .navigationBarTitleDisplayMode(.large)
        .task { if mayRead { await load() } }
    }

    private func load(fresh: Bool = false) async {
        if data == nil, let cached = InsightsAPI.last("audience", range: rangeKey, as: InsightsAudience.self) { data = cached }
        do {
            data = try await InsightsAPI.get("audience", range: rangeKey, fresh: fresh, as: InsightsAudience.self)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func content(_ a: InsightsAudience) -> some View {
        let dims = group == "reached" ? a.reached : (group == "engaged" ? a.engaged : a.followers)
        return InsightPage(refresh: { await load(fresh: true) }) {
            audienceList(a, dims)
        } wide: { _ in
            audienceWide(a, dims)
        }
    }

    private func audienceNote() -> String {
        group == "followers" ? "Everyone following now. Meta gives these only as they are now, with no history." : "This month. Meta gives these only as they are now, with no history."
    }

    /// An iPad's page: the choice, the four breakdowns two across, then when followers are online.
    @ViewBuilder
    private func audienceWide(_ a: InsightsAudience, _ dims: InsightDims?) -> some View {
        Picker("Who", selection: $group) {
            Text("Followers").tag("followers")
            Text("Reached").tag("reached")
            Text("Engaged").tag("engaged")
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 480)
        Text(audienceNote()).font(.footnote).foregroundStyle(.secondary)
        if let dims {
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 20) {
                    shares("Age", dims.age, label: { (k: String) in k })
                    shares("Cities", dims.city, label: { (k: String) in k })
                }
                .frame(maxWidth: .infinity, alignment: .top)
                VStack(alignment: .leading, spacing: 20) {
                    shares("Gender", dims.gender, label: { (k: String) in InsightWords.gender[k] ?? k })
                    shares("Countries", dims.country, label: { (k: String) in InsightWords.country[k] ?? k })
                }
                .frame(maxWidth: .infinity, alignment: .top)
            }
        }
        onlineSection(a.online)
    }

    private func audienceList(_ a: InsightsAudience, _ dims: InsightDims?) -> some View {
        List {
            Group {
                Section {
                    Picker("Who", selection: $group) {
                        Text("Followers").tag("followers")
                        Text("Reached").tag("reached")
                        Text("Engaged").tag("engaged")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                } footer: {
                    Text(group == "followers" ? "Everyone following now. Meta gives these only as they are now, with no history." : "This month. Meta gives these only as they are now, with no history.")
                }
                if let dims {
                    shares("Age", dims.age, label: { (k: String) in k })
                    shares("Gender", dims.gender, label: { (k: String) in InsightWords.gender[k] ?? k })
                    shares("Cities", dims.city, label: { (k: String) in k })
                    shares("Countries", dims.country, label: { (k: String) in InsightWords.country[k] ?? k })
                }
                onlineSection(a.online)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await load(fresh: true) }
    }

    @ViewBuilder
    private func shares(_ title: String, _ parts: [InsightPart], label: @escaping (String) -> String) -> some View {
        let total = max(1, parts.reduce(0) { (s: Double, p: InsightPart) in s + p.value })
        let top = Array(parts.sorted { (a: InsightPart, b: InsightPart) in a.value > b.value }.prefix(8))
        let biggest = max(top.first?.value ?? 1, 1)
        InsightBlock(title: title) {
            if top.isEmpty {
                Text("Meta has nothing for this yet.").foregroundStyle(.secondary)
            } else {
                ForEach(top) { (p: InsightPart) in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(label(p.key)).lineLimit(1)
                            Spacer(minLength: 8)
                            Text("\(Int((p.value / total * 100).rounded()))%").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        }
                        ProgressView(value: p.value, total: biggest).tint(Theme.accent)
                    }
                }
            }
        }
    }

    private struct HourPoint: Identifiable {
        let id: Int
        let online: Double
    }

    private func onlineSection(_ hours: [Double]?) -> some View {
        InsightBlock(title: "When followers are online", trailing: "Karachi time") {
            if let hours, hours.count == 24, hours.contains(where: { (v: Double) in v > 0 }) {
                let points: [HourPoint] = hours.indices.map { (i: Int) in HourPoint(id: i, online: hours[i]) }
                Chart(points) { (p: HourPoint) in
                    BarMark(x: .value("Hour", InsightWords.hour(p.id)), y: .value("Online", p.online)).foregroundStyle(Theme.accent)
                }
                .frame(height: 160)
                .accessibilityLabel("Followers online each hour, Karachi time")
                .accessibilityValue(ChartSummary.say(points.map { (label: InsightWords.hour($0.id), value: $0.online) }, money: false, total: false))
            } else {
                Text("Meta isn't sharing this for the account yet (it holds it back for smaller accounts).").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
