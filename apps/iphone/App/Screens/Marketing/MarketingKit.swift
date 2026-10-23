import SwiftUI
import ERPCore

// What the Marketing screens share: the places they link to, who may see which, and the few small
// views (a chip, a link row) that look the same on Posts, Ads and Website.

enum MarketingKit {
    /// The Posts tray (PostTrayScreen): pick website pieces, caption them, send them or queue them.
    static let trayPrefix = "/marketing/tray"
    static let piecesPath = "/marketing/pieces"
    static let piecePrefix = "/marketing/piece"
    static let websitePath = "/marketing/website"

    /// One website piece's own screen. The id is a file path on taheri.shop ("Rings/DSC0912.webp"),
    /// so it travels fully escaped in the query, which `pieceId` reads back.
    static func piecePath(_ id: String) -> String {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return "\(piecePrefix)?id=\(escaped)"
    }

    /// The tray, empty or starting on one piece.
    static func trayPath(_ id: String? = nil) -> String {
        guard let id else { return trayPrefix }
        return "\(trayPrefix)?id=" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
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

/// A filter chip: the kit's FilterChip (rule 16: filters are not glass), kept under this name for the screens.
struct MarketingChip: View {
    let title: String
    var count: Int?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        FilterChip(title: title, count: count, chosen: selected, action: action)
    }
}

/// A row that opens an ERP page (or another native screen) in the app.
struct MarketingLink: View {
    let title: String
    var subtitle: String?
    let symbol: String
    let path: String

    @Environment(\.siteWide) private var wide

    var body: some View {
        if wide {
            // On an iPad's page of cards there is no List row to draw the chevron.
            NavigationLink(value: Route(path: path)) {
                HStack {
                    label
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .hoverEffect()
        } else {
            NavigationLink(value: Route(path: path)) { label }
        }
    }

    private var label: some View {
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
