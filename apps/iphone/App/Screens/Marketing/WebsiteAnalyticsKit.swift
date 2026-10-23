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

// MARK: One block, two homes

private struct SiteWideKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// The report is laid out as cards in columns (an iPad's wide window) rather than as a List's sections.
    var siteWide: Bool {
        get { self[SiteWideKey.self] }
        set { self[SiteWideKey.self] = newValue }
    }
}

/// A titled block of the report: a List section on a phone, a card in a column on an iPad's wide window.
/// `options` (two names) put a small segmented switch beside the title, bound to `choice`.
struct SiteBlock<Content: View>: View {
    let title: String
    var note: String?
    var options: [String] = []
    var choice: Binding<Int>?
    @ViewBuilder let content: () -> Content
    @Environment(\.siteWide) private var wide

    var body: some View {
        if wide {
            VStack(alignment: .leading, spacing: 12) {
                head
                content()
                if let note {
                    Text(note).font(.footnote).foregroundStyle(.secondary)
                }
            }
            .ledgerCard()
        } else {
            Section {
                content()
            } header: {
                head
            } footer: {
                if let note { Text(note) }
            }
            .houseRows()
        }
    }

    @ViewBuilder private var head: some View {
        if let choice, options.count > 1 {
            HStack(alignment: .center, spacing: 12) {
                LedgerHeading(title: title)
                Spacer(minLength: 8)
                Picker(title, selection: choice) {
                    ForEach(0..<options.count, id: \.self) { (i: Int) in
                        Text(options[i]).tag(i)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 190)
            }
        } else {
            LedgerHeading(title: title)
        }
    }
}

// MARK: Ranked lists

/// One line of a ranked list.
struct SiteRankRow: Identifiable {
    let id: String
    var lead: String?
    let label: String
    var sub: String?
    let value: Int
}

enum SiteRanks {
    static func counts(_ xs: [SiteCount], label: (String) -> String) -> [SiteRankRow] {
        xs.map { (x: SiteCount) -> SiteRankRow in SiteRankRow(id: x.key, label: label(x.key), value: x.value) }
    }

    static func pages(_ xs: [SiteCount]) -> [SiteRankRow] { counts(xs, label: SiteWords.page) }

    static func plain(_ xs: [SiteCount]) -> [SiteRankRow] { counts(xs, label: { (k: String) in k }) }

    /// Countries, one row each.
    static func countryRows(_ countries: [SiteCount]) -> [SiteRankRow] {
        countries.map { (c: SiteCount) -> SiteRankRow in
            SiteRankRow(id: c.key, lead: SiteWords.flag(c.key), label: SiteWords.countryName(c.key), value: c.value)
        }
    }

    /// Cities, flat: flag + city, "region, country" beneath. What a country has beyond its listed cities is one
    /// row: the country itself when no city is known there, "Other cities" when some are.
    static func cityRows(_ countries: [SiteCount], cities: [SiteCity]) -> [SiteRankRow] {
        var out: [SiteRankRow] = []
        for x in cities {
            let place = x.region.isEmpty ? SiteWords.countryName(x.cc) : x.region + ", " + SiteWords.countryName(x.cc)
            out.append(SiteRankRow(id: x.id, lead: SiteWords.flag(x.cc), label: x.city, sub: place, value: x.sessions))
        }
        for c in countries {
            let inside = cities.filter { (x: SiteCity) in x.cc == c.key }
            let counted = inside.reduce(0) { (n: Int, x: SiteCity) in n + x.sessions }
            let rest = c.value - counted
            if rest <= 0 { continue }
            if inside.isEmpty {
                out.append(SiteRankRow(id: "country/" + c.key, lead: SiteWords.flag(c.key), label: SiteWords.countryName(c.key), value: rest))
            } else {
                out.append(SiteRankRow(id: "other/" + c.key, lead: SiteWords.flag(c.key), label: "Other cities", sub: SiteWords.countryName(c.key), value: rest))
            }
        }
        return out.sorted { (a: SiteRankRow, b: SiteRankRow) in a.value > b.value }
    }

    /// Sources, flat, with how many asked on WhatsApp beside each.
    static func sourceRows(_ xs: [SiteSource]) -> [SiteRankRow] {
        xs.map { (x: SiteSource) -> SiteRankRow in
            SiteRankRow(id: x.key, label: SiteWords.source(x.key), sub: x.enquire > 0 ? "\(x.enquire) asked" : nil, value: x.sessions)
        }
    }

    /// Kinds of source (direct, search, social, ads, other sites, email).
    static func channelRows(_ xs: [SiteCount]) -> [SiteRankRow] {
        counts(xs, label: SiteWords.channel)
    }
}

/// A List section of ranked rows: the first few, then "Show all". With `alt` and two `picks`, a small switch
/// in the header changes the list between the two (no row opens into others).
/// Hidden when it has no rows and no `empty` words.
struct SiteRankSection: View {
    let title: String
    let rows: [SiteRankRow]
    var total: Int?
    /// What an empty list says; nil hides the section.
    var empty: String?
    var note: String?
    var show = 5
    /// The second list and the names of the two, as ["Sources", "Kinds"].
    var alt: [SiteRankRow]?
    var picks: [String] = []

    @State private var all = false
    @State private var second = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if rows.isEmpty && (alt ?? []).isEmpty && empty == nil {
            EmptyView()
        } else {
            SiteBlock(title: title, note: note, options: switchable ? picks : [], choice: pickBinding) { content }
        }
    }

    private var switchable: Bool { alt != nil && picks.count > 1 }

    private var pickBinding: Binding<Int> {
        Binding<Int>(get: { second }, set: { (v: Int) in
            all = false
            second = v
        })
    }

    private var shownRows: [SiteRankRow] {
        if second == 1, switchable, let a = alt { return a }
        return rows
    }

    @ViewBuilder private var content: some View {
        let list = shownRows
        if list.isEmpty {
            Text(empty ?? "").font(.subheadline).foregroundStyle(.secondary)
        } else {
            ForEach(all ? list : Array(list.prefix(show))) { (r: SiteRankRow) in
                rowBody(r, in: list)
            }
            if list.count > show {
                Button(all ? "Show fewer" : "Show all \(list.count)") {
                    Motion.run(reduce: reduceMotion) { all.toggle() }
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private func sum(_ list: [SiteRankRow]) -> Int {
        if let total { return total }
        return list.reduce(0) { (n: Int, r: SiteRankRow) in n + r.value }
    }

    private func rowBody(_ row: SiteRankRow, in list: [SiteRankRow]) -> some View {
        let parentTotal = sum(list)
        let share = parentTotal > 0 ? Double(row.value) / Double(parentTotal) : 0
        let top = Swift.max(1, list.map { (r: SiteRankRow) in r.value }.max() ?? 1)
        return VStack(alignment: .leading, spacing: 6) {
            AdaptiveStack(spacing: 8) {
                HStack(spacing: 6) {
                    if let lead = row.lead { Text(lead).accessibilityHidden(true) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.label)
                        if let sub = row.sub {
                            Text(sub).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    Text(SiteWords.number(row.value)).monospacedDigit()
                        .contentTransition(.numericText(value: Double(row.value)))
                    Text(SiteWords.pct(share)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            ProgressView(value: Double(row.value), total: Double(top))
                .tint(Theme.accent)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
