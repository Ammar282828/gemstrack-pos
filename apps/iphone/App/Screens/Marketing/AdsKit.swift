import SwiftUI
import ERPCore

// The Ads pages' vocabulary on the phone: ranges, statuses and the words for results, ported from
// src/lib/ads/shape.ts (display only: no money rule lives here), and the three server calls.

enum AdsRange {
    struct Option: Identifiable {
        let key: String
        let label: String
        var id: String { key }
    }

    static let all: [Option] = [
        Option(key: "today", label: "Today"), Option(key: "yesterday", label: "Yesterday"),
        Option(key: "last_7d", label: "Last 7 days"), Option(key: "last_14d", label: "Last 14 days"),
        Option(key: "last_30d", label: "Last 30 days"), Option(key: "this_month", label: "This month"),
        Option(key: "last_month", label: "Last month"), Option(key: "maximum", label: "All time"),
    ]

    static func label(_ key: String) -> String {
        all.first { (r: Option) in r.key == key }?.label ?? key
    }
}

enum AdsFormat {
    /// "PKR 1,500", "PKR 4.5 lac" from a lac up, a few paise only under 100; another currency by its code.
    static func money(_ amount: Double, _ currency: String) -> String {
        let v = amount.isFinite ? amount : 0
        let rounded = abs(v) >= 100 ? v.rounded() : (v * 100).rounded() / 100
        if currency.uppercased() == "PKR" {
            return abs(rounded) >= Money.lac ? Money.pkrLac(rounded) : PaymentText.pkr(rounded)
        }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.maximumFractionDigits = abs(rounded) >= 100 ? 0 : 2
        return "\(currency.uppercased()) " + (f.string(from: NSNumber(value: rounded)) ?? String(rounded))
    }

    /// 12,345.
    static func count(_ v: Double) -> String { Money.grouped(v.isFinite ? v : 0) }

    /// 12,300 → "12.3k", 1,250,000 → "1.25M": for tiles.
    static func compact(_ v: Double) -> String {
        let a = abs(v)
        func trimmed(_ x: Double, _ digits: Int) -> String {
            var s = String(format: "%.\(digits)f", x)
            while s.contains(".") && s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
            return s
        }
        if a >= 1_000_000 { return trimmed(v / 1_000_000, 2) + "M" }
        if a >= 10_000 { return trimmed(v / 1_000, 1) + "k" }
        return count(v)
    }

    static func pct(_ v: Double) -> String { String(format: "%.2f%%", v.isFinite ? v : 0) }

    /// "up 18% on before" / "down 6% on before": nil when there is nothing to compare or it has not moved.
    static func change(_ now: Double, _ before: Double?) -> String? {
        guard let before, before != 0, now.isFinite else { return nil }
        let d = (now - before) / before * 100
        if abs(d) < 0.5 { return "same as before" }
        return "\(d > 0 ? "up" : "down") \(Int(abs(d).rounded()))% on before"
    }
}

/// A status in the shop's words and a tone (shape.ts STATUS, ACCOUNT_STATUS).
enum AdsStatusWords {
    enum Tone { case good, idle, warn, bad }

    static func color(_ t: Tone) -> Color {
        switch t {
        case .good: return .green
        case .idle: return .secondary
        case .warn: return .orange
        case .bad: return .red
        }
    }

    private static let object: [String: (String, Tone)] = [
        "ACTIVE": ("Running", .good), "PAUSED": ("Paused", .idle), "CAMPAIGN_PAUSED": ("Campaign paused", .idle),
        "ADSET_PAUSED": ("Ad set paused", .idle), "PENDING_REVIEW": ("In review", .warn), "IN_PROCESS": ("Processing", .warn),
        "PREAPPROVED": ("Pre-approved", .warn), "WITH_ISSUES": ("Has issues", .bad), "DISAPPROVED": ("Rejected", .bad),
        "PENDING_BILLING_INFO": ("Needs payment info", .bad), "ARCHIVED": ("Archived", .idle), "DELETED": ("Deleted", .idle),
    ]

    static func of(_ status: String) -> (label: String, tone: Tone) {
        if let known = object[status] { return (known.0, known.1) }
        let words = status.isEmpty ? "unknown" : status.lowercased().replacingOccurrences(of: "_", with: " ")
        return (words.prefix(1).uppercased() + words.dropFirst(), .idle)
    }

    private static let account: [Int: (String, Tone)] = [
        1: ("Active", .good), 2: ("Disabled", .bad), 3: ("Payment due", .bad), 7: ("Under risk review", .warn),
        8: ("Settling a payment", .warn), 9: ("Grace period", .warn), 100: ("Closing", .bad), 101: ("Closed", .bad),
        201: ("Active", .good), 202: ("Closed", .bad),
    ]

    static func ofAccount(_ status: Int) -> (label: String, tone: Tone) {
        if let known = account[status] { return (known.0, known.1) }
        return ("Status \(status)", .idle)
    }

    /// What to do about an account's trouble (shape.ts ACCOUNT_STATUS `fix`).
    static func accountFix(_ status: Int) -> String? {
        switch status {
        case 2: return "Meta has disabled this ad account. Open Account Quality in Meta Business Suite to see why and request a review."
        case 3: return "A payment failed. Settle the balance in Ads Manager → Billing, and ads start again."
        case 7: return "Meta is reviewing the account; ads wait until it finishes."
        case 9: return "A payment is overdue. Pay it in Ads Manager → Billing before the grace period ends."
        case 101: return "This ad account is closed. Choose another one on Setup."
        default: return nil
        }
    }
}

/// What the ads achieved, in the shop's words (shape.ts RESULT_FOR_GOAL, actionLabel, headlineActions).
enum AdsResults {
    private struct Goal {
        let label: String
        let actions: [String]
        let field: String?
        let unsure: Bool
    }

    private static let purchases = ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"]
    private static let profile = ["instagram_profile_visit", "ig_profile_visit"]
    private static let leads = ["onsite_conversion.lead_grouped", "lead"]

    private static let goals: [String: Goal] = [
        "CONVERSATIONS": Goal(label: "Chats started", actions: ["onsite_conversion.messaging_conversation_started_7d"], field: nil, unsure: false),
        "LINK_CLICKS": Goal(label: "Link clicks", actions: ["link_click"], field: nil, unsure: false),
        "LANDING_PAGE_VIEWS": Goal(label: "Landing page views", actions: ["landing_page_view"], field: nil, unsure: false),
        "OFFSITE_CONVERSIONS": Goal(label: "Purchases", actions: purchases, field: nil, unsure: false),
        "VALUE": Goal(label: "Purchases", actions: purchases, field: nil, unsure: false),
        "POST_ENGAGEMENT": Goal(label: "Post engagement", actions: ["post_engagement"], field: nil, unsure: false),
        "PROFILE_VISIT": Goal(label: "Profile visits", actions: profile, field: nil, unsure: true),
        "VISIT_INSTAGRAM_PROFILE": Goal(label: "Profile visits", actions: profile, field: nil, unsure: true),
        "THRUPLAY": Goal(label: "Video plays", actions: ["video_view"], field: nil, unsure: false),
        "LEAD_GENERATION": Goal(label: "Leads", actions: leads, field: nil, unsure: false),
        "QUALITY_LEAD": Goal(label: "Leads", actions: leads, field: nil, unsure: false),
        "PAGE_LIKES": Goal(label: "Page likes", actions: ["like"], field: nil, unsure: false),
        "REACH": Goal(label: "People reached", actions: [], field: "reach", unsure: false),
        "IMPRESSIONS": Goal(label: "Impressions", actions: [], field: "impressions", unsure: false),
        "AD_RECALL_LIFT": Goal(label: "People reached", actions: [], field: "reach", unsure: false),
    ]

    /// The result count and its name for an optimisation goal; nil where the goal has none worth showing.
    static func of(_ m: AdMetrics, goal: String?) -> (label: String, value: Double)? {
        guard let goal, let g = goals[goal] else { return nil }
        if let field = g.field { return (g.label, field == "reach" ? m.reach : m.impressions) }
        if g.unsure && !g.actions.contains(where: { (a: String) in m.actions[a] != nil }) { return nil }
        let value = g.actions.reduce(0.0) { (best: Double, a: String) in max(best, m.actions[a] ?? 0) }
        return (g.label, value)
    }

    private static let words: [String: String] = [
        "onsite_conversion.messaging_conversation_started_7d": "Chats started",
        "onsite_conversion.total_messaging_connection": "Messaging contacts",
        "onsite_conversion.messaging_first_reply": "First replies",
        "onsite_conversion.messaging_user_depth_2_message_send": "Chats with 2+ messages",
        "onsite_conversion.post_save": "Saves", "onsite_conversion.lead_grouped": "Leads", "lead": "Leads",
        "link_click": "Link clicks", "landing_page_view": "Landing page views", "post_engagement": "Post engagement",
        "page_engagement": "Page engagement", "post_reaction": "Reactions", "post_interaction_gross": "Interactions",
        "comment": "Comments", "post": "Shares", "like": "Page likes", "follow": "Follows", "video_view": "Video plays",
        "photo_view": "Photo views", "omni_purchase": "Purchases", "purchase": "Purchases",
        "instagram_profile_visit": "Profile visits", "ig_profile_visit": "Profile visits",
    ]

    static func label(_ type: String) -> String {
        if let known = words[type] { return known }
        var s = type
        for p in ["onsite_conversion.", "offsite_conversion.", "onsite_web."] where s.hasPrefix(p) {
            s.removeFirst(p.count)
            break
        }
        s = s.replacingOccurrences(of: ".", with: " ").replacingOccurrences(of: "_", with: " ")
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// Actions that are part of another (link clicks are also post engagement) are left out of a list.
    private static let headline = [
        "onsite_conversion.messaging_conversation_started_7d", "link_click", "landing_page_view", "instagram_profile_visit",
        "ig_profile_visit", "post_engagement", "post_reaction", "comment", "onsite_conversion.post_save", "post", "follow",
        "video_view", "onsite_conversion.lead_grouped", "omni_purchase",
    ]

    struct Line: Identifiable {
        let label: String
        let value: Double
        var id: String { label }
    }

    static func headlineActions(_ m: AdMetrics, limit: Int = 6) -> [Line] {
        var seen = Set<String>()
        var out: [Line] = []
        for type in headline {
            guard let v = m.actions[type], v > 0 else { continue }
            let name = label(type)
            if seen.insert(name).inserted { out.append(Line(label: name, value: v)) }
        }
        return Array(out.prefix(limit))
    }

    /// The result the account mostly buys: chats if there are any, then clicks, then engagement (ads/page.tsx mainAction).
    static func headlineResult(_ m: AdMetrics) -> (key: String, label: String, value: Double) {
        for k in ["onsite_conversion.messaging_conversation_started_7d", "link_click", "instagram_profile_visit", "post_engagement"] {
            if let v = m.actions[k], v > 0 { return (k, label(k), v) }
        }
        return ("reach", "People reached", m.reach)
    }

    static func value(_ m: AdMetrics, key: String) -> Double { key == "reach" ? m.reach : (m.actions[key] ?? 0) }
}

/// Meta's objectives, as the owner would say them (shape.ts objectiveLabel).
enum AdsObjective {
    private static let words: [String: String] = [
        "OUTCOME_AWARENESS": "Awareness", "OUTCOME_TRAFFIC": "Traffic", "OUTCOME_ENGAGEMENT": "Engagement", "OUTCOME_LEADS": "Leads",
        "OUTCOME_SALES": "Sales", "OUTCOME_APP_PROMOTION": "App promotion", "MESSAGES": "Messages", "LINK_CLICKS": "Traffic",
        "POST_ENGAGEMENT": "Engagement", "REACH": "Reach", "BRAND_AWARENESS": "Awareness", "CONVERSIONS": "Sales", "VIDEO_VIEWS": "Video views",
    ]

    static func label(_ o: String) -> String {
        if let known = words[o] { return known }
        var s = o
        if s.hasPrefix("OUTCOME_") { s.removeFirst("OUTCOME_".count) }
        s = s.lowercased().replacingOccurrences(of: "_", with: " ")
        return s.prefix(1).uppercased() + s.dropFirst()
    }
}

/// The server calls. They run as the signed-in person (ERPAPI sends the ID token); /api/ads/* answers
/// owners and marketing accounts only (src/lib/ads/gate.ts), the same as the web's Ads pages.
@MainActor
enum AdsAPI {
    static func overview(range: String, fresh: Bool) async throws -> AdOverview {
        try await ERPAPI.shared.get("/api/ads/overview?range=\(range)\(fresh ? "&fresh=1" : "")", as: AdOverview.self)
    }

    static func campaigns(range: String, archived: Bool) async throws -> AdCampaigns {
        try await ERPAPI.shared.get("/api/ads/campaigns?range=\(range)\(archived ? "&archived=1" : "")", as: AdCampaigns.self)
    }

    /// Run or pause one campaign, ad set or ad (`level` is "campaign", "adset" or "ad"): the route the web's
    /// switches call, which checks the object is this house's and records the change in `ads_log`.
    static func setRunning(level: String, id: String, running: Bool) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/object/\(id)", ["level": level, "action": "status", "status": running ? "ACTIVE" : "PAUSED"])
    }

    /// A campaign's or ad set's budget, in the account's own money (the route turns it into Meta's units): a day's,
    /// or the whole run's. The same route as the web's budget box, recorded in `ads_log`.
    static func setBudget(level: String, id: String, daily: Double?, lifetime: Double?) async throws {
        var body: [String: Any] = ["level": level, "action": "budget"]
        if let daily { body["daily"] = daily } else if let lifetime { body["lifetime"] = lifetime }
        _ = try await ERPAPI.shared.send("/api/ads/object/\(id)", body)
    }

    /// When it stops (a campaign's stop time, an ad set's end time); nil runs it with no end.
    static func setEnd(level: String, id: String, end: Date?) async throws {
        let when: Any = end.map { (d: Date) in d.ISO8601Format() } ?? NSNull()
        _ = try await ERPAPI.shared.send("/api/ads/object/\(id)", ["level": level, "action": "schedule", "end": when])
    }
}

/// A date "2026-10-01" at local noon, for a chart's day axis (UTC midnight would slip a day in some zones).
enum AdsDay {
    static func plot(_ ymd: String) -> Date? {
        let parts = ymd.split(separator: "-").compactMap { (s: Substring) in Int(s) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
}

/// The range as a menu in the toolbar (the web's chip row), remembered on the phone.
struct AdsRangeMenu: View {
    @Binding var key: String

    var body: some View {
        Menu {
            Picker("Range", selection: $key) {
                ForEach(AdsRange.all) { (r: AdsRange.Option) in Text(r.label).tag(r.key) }
            }
        } label: {
            Label(AdsRange.label(key), systemImage: "calendar")
        }
    }
}

/// An ad object's status as a coloured word.
struct AdsStatusBadge: View {
    let status: String

    var body: some View {
        let words = AdsStatusWords.of(status)
        StatusBadge(words.label, color: AdsStatusWords.color(words.tone))
    }
}

/// Who the Ads pages are for (src/lib/ads/gate.ts): owners and marketing accounts. Staff never meet them
/// in the map; this is for a link that reaches one anyway.
struct AdsOwnersOnly: View {
    var body: some View {
        ContentUnavailableView("Ads are for owners", systemImage: "lock",
                               description: Text("Sign in with an owner or marketing account to see the ad spend."))
    }
}
