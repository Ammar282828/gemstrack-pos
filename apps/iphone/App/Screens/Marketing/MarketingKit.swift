import SwiftUI
import ERPCore

// What the Marketing screens share: the places they link to, who may see which, and the few small
// views (a chip, a link row) that look the same on Posts, Ads and Website.

enum MarketingKit {
    static let postsWeb = "/posts?web=1"
    static let piecesPath = "/marketing/pieces"
    static let piecePrefix = "/marketing/piece"
    static let websitePath = "/marketing/website"

    /// One website piece's own screen. The id is a file path on taheri.shop ("Rings/DSC0912.webp"),
    /// so it travels fully escaped in the query, which `pieceId` reads back.
    static func piecePath(_ id: String) -> String {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return "\(piecePrefix)?id=\(escaped)"
    }

    static func pieceId(in path: String) -> String? {
        URLComponents(string: path)?.queryItems?.first { (q: URLQueryItem) in q.name == "id" }?.value
    }

    /// Whether this person's map has the place, as a row, a tab or a page. The map (nav-<house>.json)
    /// is already cut to the house's flags (Post a piece, Investments, Edit a piece, the studio…), and
    /// `visible(to:)` to the person's role, so a place that is not theirs is simply not there.
    static func has(_ href: String, role: String) -> Bool {
        let map = NavMap.current.visible(to: role)
        for e in map.entries {
            if e.href == href { return true }
            if (e.tabs ?? []).contains(where: { (t: NavPlace) in t.href == href }) { return true }
            if (e.pages ?? []).contains(where: { (t: NavPlace) in t.href == href }) { return true }
        }
        return false
    }

    /// An entry's tabs for this person, in the ERP's order ("website" → Add photos, Edit a piece…).
    static func tabs(of entryId: String, role: String) -> [NavPlace] {
        NavMap.current.visible(to: role).entries.first { (e: NavEntry) in e.id == entryId }?.tabs ?? []
    }
}

/// Times and ages in the shop's own words (Karachi, am/pm in lower case).
enum MarketingTime {
    private static let clockFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "h:mm a"
        f.amSymbol = "am"
        f.pmSymbol = "pm"
        return f
    }()

    private static let weekdayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "EEEE"
        return f
    }()

    /// "4:05 pm".
    static func clock(_ iso: String?) -> String {
        guard let d = ERPDate.parse(iso) else { return "" }
        return clockFormat.string(from: d)
    }

    static func weekday(_ iso: String?) -> String {
        guard let d = ERPDate.parse(iso) else { return "" }
        return weekdayFormat.string(from: d)
    }

    static func isToday(_ iso: String?) -> Bool {
        guard let d = ERPDate.parse(iso) else { return false }
        return ERPDate.karachiDay(d) == ERPDate.karachiDay(Date())
    }

    /// Whole days since, as the hub counts them (src/app/posts/page.tsx daysAgo).
    static func daysAgo(_ iso: String?) -> Int? {
        guard let d = ERPDate.parse(iso) else { return nil }
        return Int((Date().timeIntervalSince(d) / 86_400).rounded(.down))
    }

    /// "posted today", "posted 3 days ago" (piece-card.tsx agoLabel).
    static func postedAgo(_ iso: String?) -> String? {
        guard let days = daysAgo(iso) else { return nil }
        if days <= 0 { return "posted today" }
        if days == 1 { return "posted yesterday" }
        return "posted \(days) days ago"
    }
}

/// A filter chip: the chosen one is the house's filled button, the others glass (as Stock's categories).
struct MarketingChip: View {
    let title: String
    var count: Int?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        if selected {
            Button(action: action) { label }.buttonStyle(.houseProminent)
        } else {
            Button(action: action) { label }.buttonStyle(.glass)
        }
    }

    private var label: some View {
        HStack(spacing: 5) {
            Text(title)
            if let count { Text("\(count)").font(.caption).monospacedDigit().opacity(0.7) }
        }
        .font(.subheadline.weight(.medium))
    }
}

/// A row that opens an ERP page (or another native screen) in the app.
struct MarketingLink: View {
    let title: String
    var subtitle: String?
    let symbol: String
    let path: String

    var body: some View {
        NavigationLink(value: Route(path: path)) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            } icon: {
                Image(systemName: symbol).foregroundStyle(Theme.accent)
            }
        }
    }
}

/// A line while something is being read.
struct MarketingReading: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            SkeletonLoading()
            Text(text).foregroundStyle(.secondary)
        }
    }
}
