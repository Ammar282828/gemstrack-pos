import SwiftUI
import ERPCore

/// The shapes of House of Mina's Shopify analytics: GET /api/website/shopify-analytics and /live
/// (lib/website/shopify-analytics.ts). Every section arrives as `{data}`, `{missingScope, note?}` or `{error}`; one failing
/// never takes the others down. Every field may be missing; a missing one is zero or empty.

// MARK: A section

/// What a section of the answer is, for the card at the top that says which scope to grant.
protocol ShopSectionInfo {
    var missing: (scope: String, note: String?)? { get }
}

/// `{ data }`, `{ missingScope, note? }` or `{ error }`; `absent` when the answer has no such key.
enum ShopSection<T: Decodable>: Decodable, ShopSectionInfo {
    case ready(T)
    case missingScope(String, String?)
    case failed(String)
    case absent

    private enum K: String, CodingKey { case data, missingScope, note, error }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        if c.contains(.data), let v = try? c.decode(T.self, forKey: .data) {
            self = .ready(v)
        } else if let s = c.string(.missingScope) {
            self = .missingScope(s, c.string(.note))
        } else if let e = c.string(.error) {
            self = .failed(e)
        } else {
            self = .failed("Shopify sent nothing for this one.")
        }
    }

    var missing: (scope: String, note: String?)? {
        if case .missingScope(let scope, let note) = self { return (scope: scope, note: note) }
        return nil
    }
}

// MARK: Figures and lists

/// One named figure: now, and the period before (nil when not compared).
struct ShopMetric: Decodable, Hashable {
    var value = 0.0
    var before: Double?

    private enum K: String, CodingKey { case value, before }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        value = c.double(.value, default: 0)
        before = c.double(.before)
    }
}

/// `{ name: { value, before } }`. Rates are fractions (0.034 is 3.4%).
struct ShopKpis: Decodable {
    var items: [String: ShopMetric] = [:]

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        items = (try? c.decode([String: ShopMetric].self)) ?? [:]
    }

    func value(_ name: String) -> Double { items[name]?.value ?? 0 }
    func before(_ name: String) -> Double? { items[name]?.before }
}

/// A ranked row of any list: its value now and in the period before, with a few extras (conversion, orders…).
struct ShopListRow: Decodable {
    var key = ""
    var label = ""
    var code = ""
    var value = 0.0
    var before: Double?
    var extra: [String: Double] = [:]

    private enum K: String, CodingKey { case key, label, code, value, before, extra }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        label = c.string(.label, default: "")
        code = c.string(.code, default: "")
        value = c.double(.value, default: 0)
        before = c.double(.before)
        if let raw = try? c.decodeIfPresent([String: Double?].self, forKey: .extra) {
            extra = raw.compactMapValues { (v: Double?) -> Double? in v }
        }
    }
}

struct ShopFunnelStep: Decodable, Identifiable {
    var key = ""
    var label = ""
    var value = 0.0
    var before: Double?
    var id: String { key }

    private enum K: String, CodingKey { case key, label, value, before }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        label = c.string(.label, default: "")
        value = c.double(.value, default: 0)
        before = c.double(.before)
    }
}

/// One slot of a series. `at` is Shopify's own timestamp, read by its characters as the web does (day: the first ten;
/// hour: characters 11 and 12), so the shop's local time is never shifted.
struct ShopSeriesPoint: Decodable {
    var at = ""
    var sessions = 0.0
    var visitors = 0.0
    var sales = 0.0
    var orders = 0.0

    private enum K: String, CodingKey { case at, sessions, visitors, sales, orders }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        at = c.string(.at, default: "")
        sessions = c.double(.sessions, default: 0)
        visitors = c.double(.visitors, default: 0)
        sales = c.double(.sales, default: 0)
        orders = c.double(.orders, default: 0)
    }

    /// The hour of the day ("2026-11-03T14:00:00…" is 14).
    var hour: Int? {
        guard at.count >= 13 else { return nil }
        let a = at.index(at.startIndex, offsetBy: 11)
        let b = at.index(a, offsetBy: 2)
        return Int(at[a..<b])
    }

    /// "14:07" from the timestamp.
    var clock: String {
        guard at.count >= 16 else { return at }
        let a = at.index(at.startIndex, offsetBy: 11)
        let b = at.index(a, offsetBy: 5)
        return String(at[a..<b])
    }

    var day: Date? { AdsDay.plot(String(at.prefix(10))) }
}

struct ShopSeries: Decodable {
    var grain = "day"
    var points: [ShopSeriesPoint] = []

    private enum K: String, CodingKey { case grain, points }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        grain = c.string(.grain, default: "day")
        points = c.list(.points, of: ShopSeriesPoint.self)
    }
}

// MARK: The report

struct ShopStoreInfo: Decodable {
    var name = ""
    var currency = ""

    private enum K: String, CodingKey { case name, currency }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        name = c.string(.name, default: "")
        currency = c.string(.currency, default: "")
    }
}

/// GET /api/website/shopify-analytics?range=&compare=1.
struct ShopReport: Decodable {
    var range = ""
    var from = ""
    var to = ""
    var previous: SitePeriodRange?
    var store: ShopStoreInfo?
    var sales: ShopSection<ShopKpis> = .absent
    var traffic: ShopSection<ShopKpis> = .absent
    var series: ShopSection<ShopSeries> = .absent
    var funnel: ShopSection<[ShopFunnelStep]> = .absent
    var products: ShopSection<[ShopListRow]> = .absent
    var productPages: ShopSection<[ShopListRow]> = .absent
    var channels: ShopSection<[ShopListRow]> = .absent
    var discounts: ShopSection<[ShopListRow]> = .absent
    var customers: ShopSection<[ShopListRow]> = .absent
    var sources: ShopSection<[ShopListRow]> = .absent
    var places: ShopSection<[ShopListRow]> = .absent
    var devices: ShopSection<[ShopListRow]> = .absent
    var landing: ShopSection<[ShopListRow]> = .absent
    var searches: ShopSection<[ShopListRow]> = .absent

    private enum K: String, CodingKey { case range, from, to, previous, shop, sections }
    private enum S: String, CodingKey {
        case sales, traffic, series, funnel, products, productPages, channels, discounts, customers
        case sources, places, devices, landing, searches
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        range = c.string(.range, default: "")
        from = c.string(.from, default: "")
        to = c.string(.to, default: "")
        previous = c.object(.previous, of: SitePeriodRange.self)
        store = c.object(.shop, of: ShopStoreInfo.self)
        guard let s = try? c.nestedContainer(keyedBy: S.self, forKey: .sections) else { return }
        sales = s.object(.sales, of: ShopSection<ShopKpis>.self) ?? .absent
        traffic = s.object(.traffic, of: ShopSection<ShopKpis>.self) ?? .absent
        series = s.object(.series, of: ShopSection<ShopSeries>.self) ?? .absent
        funnel = s.object(.funnel, of: ShopSection<[ShopFunnelStep]>.self) ?? .absent
        products = s.object(.products, of: ShopSection<[ShopListRow]>.self) ?? .absent
        productPages = s.object(.productPages, of: ShopSection<[ShopListRow]>.self) ?? .absent
        channels = s.object(.channels, of: ShopSection<[ShopListRow]>.self) ?? .absent
        discounts = s.object(.discounts, of: ShopSection<[ShopListRow]>.self) ?? .absent
        customers = s.object(.customers, of: ShopSection<[ShopListRow]>.self) ?? .absent
        sources = s.object(.sources, of: ShopSection<[ShopListRow]>.self) ?? .absent
        places = s.object(.places, of: ShopSection<[ShopListRow]>.self) ?? .absent
        devices = s.object(.devices, of: ShopSection<[ShopListRow]>.self) ?? .absent
        landing = s.object(.landing, of: ShopSection<[ShopListRow]>.self) ?? .absent
        searches = s.object(.searches, of: ShopSection<[ShopListRow]>.self) ?? .absent
    }

    /// Every section, to find the scopes still to grant.
    var all: [any ShopSectionInfo] {
        [sales, traffic, series, funnel, products, productPages, channels, discounts, customers, sources, places, devices, landing, searches]
    }
}

// MARK: Live

/// An order or a checkout of the last half hour.
struct ShopActivity: Decodable, Identifiable {
    struct Item: Decodable {
        var title = ""
        var quantity = 1

        private enum K: String, CodingKey { case title, quantity }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            title = c.string(.title, default: "")
            quantity = c.int(.quantity) ?? 1
        }
    }

    var kind = "order"
    var ago = 0.0
    var label = ""
    var amount: Double?
    var currency = ""
    var place = ""
    var items: [Item] = []
    var status = ""
    /// The server sends no id; the screen numbers them in order.
    var id = 0

    private enum K: String, CodingKey { case kind, ago, label, amount, currency, place, items, status }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        kind = c.string(.kind, default: "order")
        ago = c.double(.ago, default: 0)
        label = c.string(.label, default: "")
        amount = c.double(.amount)
        currency = c.string(.currency, default: "")
        place = c.string(.place, default: "")
        items = c.list(.items, of: Item.self)
        status = c.string(.status, default: "")
    }
}

/// GET /api/website/shopify-analytics/live.
struct ShopLive: Decodable {
    var windowMinutes = 30
    var lastHalfHour: Int?
    var note = ""
    var sessions: ShopSection<ShopSeries> = .absent
    var places: ShopSection<[ShopListRow]> = .absent
    var today: ShopSection<ShopKpis> = .absent
    var recent: ShopSection<[ShopActivity]> = .absent

    private struct Count: Decodable {
        var sessionsLastHalfHour: Int?
        var note = ""
        private enum K: String, CodingKey { case sessionsLastHalfHour, note }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            sessionsLastHalfHour = c.int(.sessionsLastHalfHour)
            note = c.string(.note, default: "")
        }
    }

    private enum K: String, CodingKey { case windowMinutes, live, sections }
    private enum S: String, CodingKey { case sessions, places, today, recent }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        windowMinutes = c.int(.windowMinutes) ?? 30
        if let n = c.object(.live, of: Count.self) {
            lastHalfHour = n.sessionsLastHalfHour
            note = n.note
        }
        guard let s = try? c.nestedContainer(keyedBy: S.self, forKey: .sections) else { return }
        sessions = s.object(.sessions, of: ShopSection<ShopSeries>.self) ?? .absent
        places = s.object(.places, of: ShopSection<[ShopListRow]>.self) ?? .absent
        today = s.object(.today, of: ShopSection<ShopKpis>.self) ?? .absent
        let r = s.object(.recent, of: ShopSection<[ShopActivity]>.self) ?? .absent
        if case .ready(let list) = r {
            recent = .ready(list.enumerated().map { (e: (offset: Int, element: ShopActivity)) -> ShopActivity in
                var a = e.element
                a.id = e.offset
                return a
            })
        } else {
            recent = r
        }
    }

    var all: [any ShopSectionInfo] { [sessions, places, today, recent] }
}

// MARK: Words

enum ShopWords {
    /// "PKR 12,345" in the store's own currency (PKR when the answer names none).
    static func money(_ x: Double, _ currency: String?) -> String {
        let c = (currency ?? "").isEmpty ? "PKR" : (currency ?? "PKR")
        return c + " " + Money.grouped(x)
    }

    static func number(_ x: Double) -> String { Money.grouped(x) }

    /// "just now" under a minute, else "3 min ago".
    static func ago(_ ms: Double) -> String {
        if ms < 60_000 { return "just now" }
        return "\(Int((ms / 60_000).rounded())) min ago"
    }

    /// The scopes still to grant, once each, in the order met.
    static func missing(_ sections: [any ShopSectionInfo]) -> [ShopMissing] {
        var out: [ShopMissing] = []
        for s in sections {
            if let m = s.missing, !out.contains(where: { (o: ShopMissing) in o.scope == m.scope }) {
                out.append(ShopMissing(scope: m.scope, note: m.note))
            }
        }
        return out
    }
}

/// A scope Shopify has not granted, with what it said about it.
struct ShopMissing: Identifiable {
    let scope: String
    let note: String?
    var id: String { scope }
}
