import SwiftUI
import ERPCore

/// What Website → Interest and Live share: the shapes of GET /api/website/analytics and /analytics/live
/// (lib/website/site-analytics.ts), and the words for places, sources, devices and pages
/// (src/app/website/interest/site-kit.tsx). Every field may be missing; a missing one is zero or empty.

// MARK: Shapes

/// A counted key: a country, a device, a page, a search.
struct SiteCount: Decodable, Identifiable, Hashable {
    var key = ""
    var value = 0
    var id: String { key }

    private enum K: String, CodingKey { case key, value }
    init(key: String, value: Int) { self.key = key; self.value = value }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        value = c.int(.value) ?? 0
    }
}

/// A source with how far its sessions got.
struct SiteSource: Decodable, Identifiable, Hashable {
    var key = ""
    var channel = ""
    var name = ""
    var sessions = 0
    var piece = 0
    var save = 0
    var enquire = 0
    var id: String { key }

    private enum K: String, CodingKey { case key, channel, name, sessions, piece, save, enquire }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        channel = c.string(.channel, default: "")
        name = c.string(.name, default: "")
        sessions = c.int(.sessions) ?? 0
        piece = c.int(.piece) ?? 0
        save = c.int(.save) ?? 0
        enquire = c.int(.enquire) ?? 0
    }
}

/// A campaign (utm_campaign): its sessions in `value`.
struct SiteCampaign: Decodable, Identifiable, Hashable {
    var key = ""
    var value = 0
    var piece = 0
    var save = 0
    var enquire = 0
    var id: String { key }

    private enum K: String, CodingKey { case key, value, piece, save, enquire }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        value = c.int(.value) ?? 0
        piece = c.int(.piece) ?? 0
        save = c.int(.save) ?? 0
        enquire = c.int(.enquire) ?? 0
    }
}

struct SiteCity: Decodable, Identifiable, Hashable {
    var cc = ""
    var region = ""
    var city = ""
    var sessions = 0
    var id: String { cc + "|" + region + "|" + city }

    private enum K: String, CodingKey { case cc, region, city, sessions }
    init(cc: String, region: String, city: String, sessions: Int) {
        self.cc = cc; self.region = region; self.city = city; self.sessions = sessions
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        cc = c.string(.cc, default: "")
        region = c.string(.region, default: "")
        city = c.string(.city, default: "")
        sessions = c.int(.sessions) ?? 0
    }
}

struct SiteFunnel: Decodable, Hashable {
    var sessions = 0
    var piece = 0
    var save = 0
    var enquire = 0

    private enum K: String, CodingKey { case sessions, piece, save, enquire }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        sessions = c.int(.sessions) ?? 0
        piece = c.int(.piece) ?? 0
        save = c.int(.save) ?? 0
        enquire = c.int(.enquire) ?? 0
    }
}

/// The days' counters added up (Summary in site-analytics.ts).
struct SiteSummary: Decodable {
    var sessions = 0
    var visitors = 0
    var pageviews = 0
    var bounces = 0
    var durMs = 0.0
    var newSessions = 0
    var returningSessions = 0
    var newVisitors = 0
    var bounceRate = 0.0
    var avgSessionMs = 0.0
    var pagesPerSession = 0.0
    var funnel = SiteFunnel()
    var conversion = 0.0
    var sources: [SiteSource] = []
    var channels: [SiteCount] = []
    var campaigns: [SiteCampaign] = []
    var countries: [SiteCount] = []
    var cities: [SiteCity] = []
    var devices: [SiteCount] = []
    var os: [SiteCount] = []
    var browsers: [SiteCount] = []
    var landing: [SiteCount] = []
    var exits: [SiteCount] = []
    var pages: [SiteCount] = []
    var collections: [SiteCount] = []
    var notFound: [SiteCount] = []
    var searches: [SiteCount] = []

    private enum K: String, CodingKey {
        case sessions, visitors, pageviews, bounces, durMs, newSessions, returningSessions, newVisitors
        case bounceRate, avgSessionMs, pagesPerSession, funnel, conversion
        case sources, channels, campaigns, countries, cities, devices, os, browsers
        case landing, exits, pages, collections, notFound, searches
    }

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        sessions = c.int(.sessions) ?? 0
        visitors = c.int(.visitors) ?? 0
        pageviews = c.int(.pageviews) ?? 0
        bounces = c.int(.bounces) ?? 0
        durMs = c.double(.durMs, default: 0)
        newSessions = c.int(.newSessions) ?? 0
        returningSessions = c.int(.returningSessions) ?? 0
        newVisitors = c.int(.newVisitors) ?? 0
        bounceRate = c.double(.bounceRate, default: 0)
        avgSessionMs = c.double(.avgSessionMs, default: 0)
        pagesPerSession = c.double(.pagesPerSession, default: 0)
        funnel = c.object(.funnel, of: SiteFunnel.self) ?? SiteFunnel()
        conversion = c.double(.conversion, default: 0)
        sources = c.list(.sources, of: SiteSource.self)
        channels = c.list(.channels, of: SiteCount.self)
        campaigns = c.list(.campaigns, of: SiteCampaign.self)
        countries = c.list(.countries, of: SiteCount.self)
        cities = c.list(.cities, of: SiteCity.self)
        devices = c.list(.devices, of: SiteCount.self)
        os = c.list(.os, of: SiteCount.self)
        browsers = c.list(.browsers, of: SiteCount.self)
        landing = c.list(.landing, of: SiteCount.self)
        exits = c.list(.exits, of: SiteCount.self)
        pages = c.list(.pages, of: SiteCount.self)
        collections = c.list(.collections, of: SiteCount.self)
        notFound = c.list(.notFound, of: SiteCount.self)
        searches = c.list(.searches, of: SiteCount.self)
    }
}

struct SiteDay: Decodable, Identifiable, Hashable {
    var day = ""
    var sessions = 0
    var visitors = 0
    var pageviews = 0
    var enquiries = 0
    var id: String { day }

    private enum K: String, CodingKey { case day, sessions, visitors, pageviews, enquiries }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        day = c.string(.day, default: "")
        sessions = c.int(.sessions) ?? 0
        visitors = c.int(.visitors) ?? 0
        pageviews = c.int(.pageviews) ?? 0
        enquiries = c.int(.enquiries) ?? 0
    }
}

struct SiteHour: Decodable, Identifiable, Hashable {
    var hour = 0
    var sessions = 0
    var before = 0
    var id: Int { hour }

    private enum K: String, CodingKey { case hour, sessions, before }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        hour = c.int(.hour) ?? 0
        sessions = c.int(.sessions) ?? 0
        before = c.int(.before) ?? 0
    }
}

struct SitePeriodRange: Decodable, Hashable {
    var from = ""
    var to = ""

    private enum K: String, CodingKey { case from, to }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        from = c.string(.from, default: "")
        to = c.string(.to, default: "")
    }
}

/// GET /api/website/analytics.
struct SiteReport: Decodable {
    var range = ""
    var from = ""
    var to = ""
    var days = 0
    var previous = SitePeriodRange()
    var today = ""
    var since: String?
    var visitorsExact = true
    var now = SiteSummary()
    var before = SiteSummary()
    var series: [SiteDay] = []
    /// Only for a one-day period: its sessions by the hour, with the day before.
    var hours: [SiteHour]?

    private enum K: String, CodingKey { case range, from, to, days, previous, today, since, visitorsExact, now, before, series, hours }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        range = c.string(.range, default: "")
        from = c.string(.from, default: "")
        to = c.string(.to, default: "")
        days = c.int(.days) ?? 0
        previous = c.object(.previous, of: SitePeriodRange.self) ?? SitePeriodRange()
        today = c.string(.today, default: "")
        since = c.string(.since)
        visitorsExact = c.bool(.visitorsExact, default: true)
        now = c.object(.now, of: SiteSummary.self) ?? SiteSummary()
        before = c.object(.before, of: SiteSummary.self) ?? SiteSummary()
        series = c.list(.series, of: SiteDay.self)
        let h = c.list(.hours, of: SiteHour.self)
        hours = h.isEmpty ? nil : h
    }
}

/// One open session on the live view.
struct SiteLiveVisit: Decodable, Identifiable {
    var path = "/"
    var kind = ""
    var cc = ""
    var region = ""
    var city = ""
    var device = ""
    var browser = ""
    var source = "direct"
    var isNew = false
    var pages = 0
    var forMs = 0.0
    var ago = 0.0
    /// The server sends no id (nothing tells one person from another); the screen numbers them in order.
    var id = 0

    private enum K: String, CodingKey { case path, kind, cc, region, city, device, browser, source, isNew, pages, forMs, ago }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        path = c.string(.path, default: "/")
        kind = c.string(.kind, default: "")
        cc = c.string(.cc, default: "")
        region = c.string(.region, default: "")
        city = c.string(.city, default: "")
        device = c.string(.device, default: "")
        browser = c.string(.browser, default: "")
        source = c.string(.source, default: "direct")
        isNew = c.bool(.isNew, default: false)
        pages = c.int(.pages) ?? 0
        forMs = c.double(.forMs, default: 0)
        ago = c.double(.ago, default: 0)
    }
}

struct SiteLiveToday: Decodable {
    var sessions = 0
    var visitors = 0
    var pageviews = 0
    var enquiries = 0
    var saves = 0
    var pieces = 0
    var conversion = 0.0
    var bounceRate = 0.0
    var avgSessionMs = 0.0

    private enum K: String, CodingKey { case sessions, visitors, pageviews, enquiries, saves, pieces, conversion, bounceRate, avgSessionMs }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        sessions = c.int(.sessions) ?? 0
        visitors = c.int(.visitors) ?? 0
        pageviews = c.int(.pageviews) ?? 0
        enquiries = c.int(.enquiries) ?? 0
        saves = c.int(.saves) ?? 0
        pieces = c.int(.pieces) ?? 0
        conversion = c.double(.conversion, default: 0)
        bounceRate = c.double(.bounceRate, default: 0)
        avgSessionMs = c.double(.avgSessionMs, default: 0)
    }
}

/// GET /api/website/analytics/live.
struct SiteLive: Decodable {
    var at = 0.0
    var visitors = 0
    var newVisitors = 0
    var pages: [SiteCount] = []
    var countries: [SiteCount] = []
    /// key "CC|Region|City".
    var cities: [SiteCount] = []
    var sources: [SiteCount] = []
    var devices: [SiteCount] = []
    var sessions: [SiteLiveVisit] = []
    var today = SiteLiveToday()

    private enum K: String, CodingKey { case at, visitors, newVisitors, pages, countries, cities, sources, devices, sessions, today }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        at = c.double(.at, default: 0)
        visitors = c.int(.visitors) ?? 0
        newVisitors = c.int(.newVisitors) ?? 0
        pages = c.list(.pages, of: SiteCount.self)
        countries = c.list(.countries, of: SiteCount.self)
        cities = c.list(.cities, of: SiteCount.self)
        sources = c.list(.sources, of: SiteCount.self)
        devices = c.list(.devices, of: SiteCount.self)
        let raw = c.list(.sessions, of: SiteLiveVisit.self)
        sessions = raw.enumerated().map { (e: (offset: Int, element: SiteLiveVisit)) -> SiteLiveVisit in
            var v = e.element
            v.id = e.offset
            return v
        }
        today = c.object(.today, of: SiteLiveToday.self) ?? SiteLiveToday()
    }

    /// The live cities as the report's rows ("CC|Region|City").
    var cityRows: [SiteCity] {
        cities.map { (x: SiteCount) -> SiteCity in
            let p = x.key.components(separatedBy: "|")
            let cc = p.count > 0 ? p[0] : ""
            let region = p.count > 1 ? p[1] : ""
            let city = p.count > 2 ? p[2] : ""
            return SiteCity(cc: cc, region: region, city: city, sessions: x.value)
        }
    }
}

// MARK: Words

/// site-kit.tsx's names, ported.
enum SiteWords {
    static func countryName(_ cc: String) -> String {
        if cc.isEmpty || cc == "??" { return "Unknown" }
        return Locale(identifier: "en").localizedString(forRegionCode: cc) ?? cc
    }

    /// The country's flag from its two letters (regional indicator symbols); a globe when unknown.
    static func flag(_ cc: String) -> String {
        let letters = Array(cc.unicodeScalars)
        let valid = letters.count == 2 && letters.allSatisfy { (s: Unicode.Scalar) in s.value >= 65 && s.value <= 90 }
        guard valid else { return "\u{1F310}" }
        var out = ""
        for s in letters {
            if let f = Unicode.Scalar(0x1F1A5 + s.value) { out.unicodeScalars.append(f) }
        }
        return out
    }

    static func channel(_ key: String) -> String {
        switch key {
        case "direct": return "Direct"
        case "search": return "Search"
        case "social": return "Social"
        case "paid": return "Ads"
        case "referral": return "Other sites"
        case "email": return "Email"
        default: return key
        }
    }

    /// "paid:Instagram" → "Instagram ads", "search:Google" → "Google search", "direct" → "Direct".
    static func source(_ key: String) -> String {
        if key == "direct" { return "Direct" }
        guard let i = key.firstIndex(of: ":") else { return key }
        let ch = String(key[key.startIndex..<i])
        let name = String(key[key.index(after: i)...])
        if ch == "paid" { return name + " ads" }
        if ch == "search" { return name + " search" }
        return name
    }

    static func device(_ key: String) -> String {
        switch key {
        case "mobile": return "Phone"
        case "tablet": return "Tablet"
        case "desktop": return "Computer"
        default: return key
        }
    }

    /// "/rings-bands/band-147" → "rings-bands › band-147"; the front page by name.
    static func page(_ path: String) -> String {
        if path == "/" || path.isEmpty { return "Front page" }
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return trimmed.components(separatedBy: "/").joined(separator: " › ")
    }

    /// "12%", "4.5%" (a share under 10% keeps a decimal at zero digits), as the web's `pct`.
    static func pct(_ x: Double, digits: Int = 0) -> String {
        let d = (x > 0 && x < 0.1 && digits == 0) ? 1 : digits
        return String(format: "%.\(d)f%%", x * 100)
    }

    /// "0s", "45s", "3m 20s", "1h 5m".
    static func duration(_ ms: Double) -> String {
        if ms <= 0 { return "0s" }
        let s = Int((ms / 1000).rounded())
        if s >= 3600 { return "\(s / 3600)h \((s % 3600) / 60)m" }
        if s >= 60 { return "\(s / 60)m \(s % 60)s" }
        return "\(s)s"
    }

    static func number(_ n: Int) -> String { Money.grouped(Double(n)) }

    /// "9 Oct" from "2026-10-09".
    static func shortDay(_ ymd: String) -> String {
        guard let d = AdsDay.plot(ymd) else { return ymd }
        return ChartSummary.day(d)
    }

    /// "9 Oct" or "2 Oct → 9 Oct".
    static func span(_ from: String, _ to: String) -> String {
        if from == to { return shortDay(from) }
        return shortDay(from) + " → " + shortDay(to)
    }

    /// "now" under a minute, else "3m ago".
    static func ago(_ ms: Double) -> String {
        if ms < 60_000 { return "now" }
        return "\(Int((ms / 60_000).rounded()))m ago"
    }

    static func pages(_ n: Int) -> String { n == 1 ? "1 page" : "\(n) pages" }
}

// MARK: Delta and tile

/// Against the period before: up green, down red; `invert` where down is good (bounce rate). Nothing without a before.
struct SiteDelta: View {
    let now: Double
    let before: Double
    var invert = false

    var body: some View {
        if before > 0 {
            content
        }
    }

    private var change: Double { (now - before) / before * 100 }

    private var text: String {
        let ratio = now / before
        if change > 0 && ratio >= 3 {
            return ratio >= 10 ? "\(Int(ratio.rounded()))×" : String(format: "%.1f×", ratio)
        }
        return "\(Int(abs(change).rounded()))%"
    }

    @ViewBuilder private var content: some View {
        if abs(change) < 0.5 {
            Text("same as before").font(.caption).foregroundStyle(.secondary)
        } else {
            let up = change > 0
            let good = invert ? !up : up
            let tone: Tone = good ? .settled : .problem
            HStack(spacing: 2) {
                Image(systemName: up ? "arrow.up.right" : "arrow.down.right").imageScale(.small)
                Text(text).monospacedDigit()
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(tone.color)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(deltaSpoken(up: up))
        }
    }

    private func deltaSpoken(up: Bool) -> String {
        (up ? "up " : "down ") + text + " on the period before"
    }
}

/// A figure with its change against the period before and a line of detail.
struct SiteTile: View {
    let label: String
    let value: String
    var now: Double?
    var before: Double?
    var invert = false
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(value)
                .font(.system(.title2, design: .serif).weight(.semibold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .fixedSize(horizontal: false, vertical: true)
            if let now, let before {
                SiteDelta(now: now, before: before, invert: invert)
            }
            if let detail, !detail.isEmpty {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .ledgerCard()
    }
}

// MARK: Ranked lists

/// One line of a ranked list; `children` open under it (a channel's sources, a country's cities).
struct SiteRankRow: Identifiable {
    let id: String
    var lead: String?
    let label: String
    var sub: String?
    let value: Int
    var children: [SiteRankRow] = []
}

enum SiteRanks {
    static func counts(_ xs: [SiteCount], label: (String) -> String) -> [SiteRankRow] {
        xs.map { (x: SiteCount) -> SiteRankRow in SiteRankRow(id: x.key, label: label(x.key), value: x.value) }
    }

    static func pages(_ xs: [SiteCount]) -> [SiteRankRow] { counts(xs, label: SiteWords.page) }

    static func plain(_ xs: [SiteCount]) -> [SiteRankRow] { counts(xs, label: { (k: String) in k }) }

    static func places(_ countries: [SiteCount], cities: [SiteCity]) -> [SiteRankRow] {
        countries.map { (c: SiteCount) -> SiteRankRow in
            let inside = cities.filter { (x: SiteCity) in x.cc == c.key }
            let kids = inside.map { (x: SiteCity) -> SiteRankRow in
                SiteRankRow(id: x.id, label: x.city, sub: x.region.isEmpty ? nil : x.region, value: x.sessions)
            }
            return SiteRankRow(id: c.key, lead: SiteWords.flag(c.key), label: SiteWords.countryName(c.key), value: c.value, children: kids)
        }
    }

    static func channels(_ s: SiteSummary) -> [SiteRankRow] {
        s.channels.map { (c: SiteCount) -> SiteRankRow in
            let inside = s.sources.filter { (x: SiteSource) in x.channel == c.key }
            let kids = inside.map { (x: SiteSource) -> SiteRankRow in
                SiteRankRow(id: x.key, label: SiteWords.source(x.key), sub: x.enquire > 0 ? "\(x.enquire) asked" : nil, value: x.sessions)
            }
            return SiteRankRow(id: c.key, label: SiteWords.channel(c.key), value: c.value, children: kids)
        }
    }
}

/// A List section of ranked rows: the first few, "Show all", rows with children opening in place.
/// Hidden when it has no rows and no `empty` words.
struct SiteRankSection: View {
    let title: String
    let rows: [SiteRankRow]
    var total: Int?
    /// What an empty list says; nil hides the section.
    var empty: String?
    var note: String?
    var show = 5

    @State private var all = false
    @State private var open: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Entry: Identifiable {
        let id: String
        let row: SiteRankRow
        let nested: Bool
    }

    var body: some View {
        if rows.isEmpty && empty == nil {
            EmptyView()
        } else {
            Section {
                content
            } header: {
                LedgerHeading(title: title)
            } footer: {
                if let note { Text(note) }
            }
            .houseRows()
        }
    }

    @ViewBuilder private var content: some View {
        if rows.isEmpty {
            Text(empty ?? "").font(.subheadline).foregroundStyle(.secondary)
        } else {
            ForEach(entries) { (e: Entry) in
                line(e)
            }
            if rows.count > show {
                Button(all ? "Show fewer" : "Show all \(rows.count)") {
                    Motion.run(reduce: reduceMotion) { all.toggle() }
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var sum: Int {
        if let total { return total }
        return rows.reduce(0) { (n: Int, r: SiteRankRow) in n + r.value }
    }

    /// A child's share is of its parent (a channel's sessions), as the web's nested list.
    private var openTotal: Int {
        let parent = rows.first { (r: SiteRankRow) in r.id == open }
        return parent?.value ?? sum
    }

    private var entries: [Entry] {
        let shown = all ? rows : Array(rows.prefix(show))
        var out: [Entry] = []
        for r in shown {
            out.append(Entry(id: r.id, row: r, nested: false))
            if open == r.id {
                for k in r.children.prefix(12) { out.append(Entry(id: r.id + "/" + k.id, row: k, nested: true)) }
            }
        }
        return out
    }

    @ViewBuilder private func line(_ e: Entry) -> some View {
        if e.row.children.isEmpty {
            rowBody(e)
        } else {
            Button {
                Motion.run(reduce: reduceMotion) { open = (open == e.row.id) ? nil : e.row.id }
            } label: {
                rowBody(e)
            }
            .buttonStyle(.plain)
            .accessibilityHint(open == e.row.id ? "Hides the list inside" : "Shows the list inside")
        }
    }

    private func rowBody(_ e: Entry) -> some View {
        let parentTotal = e.nested ? Swift.max(1, openTotal) : sum
        let share = parentTotal > 0 ? Double(e.row.value) / Double(parentTotal) : 0
        let top = Swift.max(1, rows.map { (r: SiteRankRow) in r.value }.max() ?? 1)
        return VStack(alignment: .leading, spacing: 6) {
            AdaptiveStack(spacing: 8) {
                HStack(spacing: 6) {
                    if let lead = e.row.lead { Text(lead).accessibilityHidden(true) }
                    Text(e.row.label)
                    if let sub = e.row.sub {
                        Text(sub).font(.footnote).foregroundStyle(.secondary)
                    }
                    if !e.row.children.isEmpty {
                        Image(systemName: open == e.row.id ? "chevron.up" : "chevron.down")
                            .font(.caption2).foregroundStyle(.tertiary)
                            .contentTransition(.symbolEffect(.replace))
                    }
                }
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    Text(SiteWords.number(e.row.value)).monospacedDigit()
                        .contentTransition(.numericText(value: Double(e.row.value)))
                    Text(SiteWords.pct(share)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            if !e.nested {
                ProgressView(value: Double(e.row.value), total: Double(top))
                    .tint(Theme.accent)
                    .accessibilityHidden(true)
            }
        }
        .padding(.leading, e.nested ? 20 : 0)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
