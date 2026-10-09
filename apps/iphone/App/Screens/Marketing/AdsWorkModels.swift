import Foundation
import ERPCore

// The answers of the Ads routes behind Setup, Audiences and Rules (/api/ads/status, /setup, /pixel, /audiences,
// /rules), read leniently: a missing or odd field gives a default, never an emptied page.

/// Which ad account, Page and Instagram account this house advertises from (src/lib/ads/settings.ts AdsSettings).
struct AdsSettingsRow: Decodable, Hashable {
    let adAccountId: String?
    let adAccountName: String?
    let pageId: String?
    let pageName: String?
    let instagramUserId: String?
    let instagramUsername: String?
    let whatsappGreeting: String?
    let loginConfigId: String?
    let pixelId: String?

    private enum K: String, CodingKey {
        case adAccountId, adAccountName, pageId, pageName, instagramUserId, instagramUsername, whatsappGreeting, loginConfigId, pixelId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        func text(_ k: K) -> String? {
            let v = c.string(k)?.trimmingCharacters(in: .whitespaces)
            return (v ?? "").isEmpty ? nil : v
        }
        adAccountId = text(.adAccountId)
        adAccountName = text(.adAccountName)
        pageId = text(.pageId)
        pageName = text(.pageName)
        instagramUserId = text(.instagramUserId)
        instagramUsername = text(.instagramUsername)
        whatsappGreeting = text(.whatsappGreeting)
        loginConfigId = text(.loginConfigId)
        pixelId = text(.pixelId)
    }
}

/// GET /api/ads/status: what every Ads page needs to know before it can do anything (ads-kit.tsx AdsStatus).
struct AdsStatusAnswer: Decodable {
    struct App: Decodable {
        let id: String?
        let secret: Bool
        let secretName: String
        let tokenSecret: String
        let tokenStoreExists: Bool
        let tokenStoreWrite: Bool
        let project: String
        let loginConfigId: String?
        let loginConfigFromEnv: Bool
        /// What Meta's Live switch asks for, read from the app; nil when Meta didn't answer.
        let live: Live?
        let privacyPage: String
        let deletionPage: String

        struct Live: Decodable {
            let privacyPolicyUrl: String?
            let category: String?
            let icon: Bool

            private enum K: String, CodingKey { case privacyPolicyUrl, category, icon }

            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: K.self)
                privacyPolicyUrl = c.string(.privacyPolicyUrl).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
                category = c.string(.category).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
                icon = c.bool(.icon, default: false)
            }

            var ready: Bool { privacyPolicyUrl != nil && category != nil && icon }
        }

        private enum K: String, CodingKey { case id, secret, secretName, tokenSecret, tokenStore, project, loginConfigId, loginConfigFromEnv, live, pages }
        private enum T: String, CodingKey { case exists, write }
        private enum P: String, CodingKey { case privacy, deletion }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            id = c.string(.id).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
            secret = c.bool(.secret, default: false)
            secretName = c.string(.secretName, default: "meta-app-secret")
            tokenSecret = c.string(.tokenSecret, default: "meta-ads-token")
            if let t = try? c.nestedContainer(keyedBy: T.self, forKey: .tokenStore) {
                tokenStoreExists = t.bool(.exists, default: false)
                tokenStoreWrite = t.bool(.write, default: false)
            } else {
                tokenStoreExists = false
                tokenStoreWrite = false
            }
            project = c.string(.project, default: "")
            loginConfigId = c.string(.loginConfigId).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
            loginConfigFromEnv = c.bool(.loginConfigFromEnv, default: false)
            live = c.object(.live, of: Live.self)
            if let p = try? c.nestedContainer(keyedBy: P.self, forKey: .pages) {
                privacyPage = p.string(.privacy, default: "")
                deletionPage = p.string(.deletion, default: "")
            } else {
                privacyPage = ""
                deletionPage = ""
            }
        }
    }

    struct Connection: Decodable {
        let connected: Bool
        /// "user" (a Facebook login, which runs out) or "system" (a system user's token, which doesn't).
        let kind: String
        let userName: String?
        let daysLeft: Int?
        let missingScopes: [String]
        let error: String?

        private enum K: String, CodingKey { case connected, kind, userName, daysLeft, missingScopes, error }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            connected = c.bool(.connected, default: false)
            kind = c.string(.kind, default: "user")
            userName = c.string(.userName).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
            daysLeft = c.int(.daysLeft)
            missingScopes = c.strings(.missingScopes)
            error = c.string(.error).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        }
    }

    let app: App?
    let connection: Connection?
    let connectionError: String?
    let settings: AdsSettingsRow?
    let houseInstagram: String?
    let pinnedAccount: Bool
    let account: AdAccount?
    let accountError: String?

    private enum K: String, CodingKey { case app, connection, connectionError, settings, houseInstagram, pinnedAccount, account, accountError }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        app = c.object(.app, of: App.self)
        connection = c.object(.connection, of: Connection.self)
        connectionError = c.string(.connectionError).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        settings = c.object(.settings, of: AdsSettingsRow.self)
        houseInstagram = c.string(.houseInstagram).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        pinnedAccount = c.bool(.pinnedAccount, default: false)
        account = c.object(.account, of: AdAccount.self)
        accountError = c.string(.accountError).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
    }

    /// Connected, with an ad account chosen: the pages can work (ads-kit.tsx useAdsStatus `ready`).
    var ready: Bool { connection?.connected == true && settings?.adAccountId != nil }
    var currency: String { account?.currency ?? "PKR" }
}

// MARK: Setup's choices (GET /api/ads/setup)

struct AdsAccountChoice: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let currency: String
    let status: Int
    let business: String?

    private enum K: String, CodingKey { case id, name, currency, status, business }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        currency = c.string(.currency, default: "")
        status = c.int(.status) ?? 0
        business = c.string(.business)
    }
}

struct AdsPageChoice: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let picture: String?
    let canAdvertise: Bool
    let instagramUsername: String?
    let whatsapp: String?

    private enum K: String, CodingKey { case id, name, picture, canAdvertise, instagram, whatsapp }
    private enum I: String, CodingKey { case username }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        picture = c.string(.picture)
        canAdvertise = c.bool(.canAdvertise, default: true)
        if let i = try? c.nestedContainer(keyedBy: I.self, forKey: .instagram) {
            instagramUsername = i.string(.username)
        } else {
            instagramUsername = nil
        }
        whatsapp = c.string(.whatsapp).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
    }
}

struct AdsInstagramChoice: Decodable, Identifiable, Hashable {
    let id: String
    let username: String
    let picture: String?
    /// "page", "ad account" or "business".
    let via: String
    let pageId: String?

    private enum K: String, CodingKey { case id, username, picture, via, pageId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        username = c.string(.username, default: "")
        picture = c.string(.picture)
        via = c.string(.via, default: "business")
        pageId = c.string(.pageId).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
    }
}

struct AdsSetupAssets: Decodable {
    let accounts: [AdsAccountChoice]
    let pages: [AdsPageChoice]
    let instagram: [AdsInstagramChoice]
    let settings: AdsSettingsRow?

    private enum K: String, CodingKey { case accounts, pages, instagram, settings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        accounts = c.list(.accounts, of: AdsAccountChoice.self).filter { (a: AdsAccountChoice) in !a.id.isEmpty }
        pages = c.list(.pages, of: AdsPageChoice.self).filter { (p: AdsPageChoice) in !p.id.isEmpty }
        instagram = c.list(.instagram, of: AdsInstagramChoice.self).filter { (i: AdsInstagramChoice) in !i.id.isEmpty }
        settings = c.object(.settings, of: AdsSettingsRow.self)
    }
}

/// POST /api/ads/setup: the settings as saved.
struct AdsSettingsSaved: Decodable {
    let settings: AdsSettingsRow?

    private enum K: String, CodingKey { case settings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        settings = c.object(.settings, of: AdsSettingsRow.self)
    }
}

// MARK: The website pixel (/api/ads/pixel)

struct AdsPixelRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let lastFired: String?

    private enum K: String, CodingKey { case id, name, lastFired }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: c.string(.id, default: ""))
        lastFired = c.string(.lastFired)
    }
}

/// A site the house sells from and the pixels its front page carries (nil: the page couldn't be read).
struct AdsPixelSite: Decodable, Hashable {
    let url: String
    let ids: [String]?
    let loader: Bool

    private enum K: String, CodingKey { case url, ids, loader }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        url = c.string(.url, default: "")
        // null (the page couldn't be read) stays nil; a list, even an empty one, is what the page carries.
        ids = (try? c.decodeIfPresent([LenientString].self, forKey: .ids))?.map { (s: LenientString) in s.value }
        loader = c.bool(.loader, default: false)
    }

    /// "taheri.shop".
    var host: String {
        let h = URL(string: url)?.host ?? url
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }
}

struct AdsPixelState: Decodable, Hashable {
    let id: String?
    let lastFired: String?
    let live: Bool
    let onSite: Bool?
    /// The site that carries it (or the first the house sells from).
    let site: String?
    let sites: [AdsPixelSite]
    /// What the chosen pixel received in the last 7 days, by event name; nil when Meta wouldn't say.
    let events: [String: Double]?

    private enum K: String, CodingKey { case id, lastFired, live, onSite, site, sites, events }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        lastFired = c.string(.lastFired)
        live = c.bool(.live, default: false)
        onSite = c.bool(.onSite)
        site = c.string(.site).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        sites = c.list(.sites, of: AdsPixelSite.self)
        if let raw = try? c.decodeIfPresent([String: Lossy<Double>].self, forKey: .events) {
            var out: [String: Double] = [:]
            for (k, v) in raw { if let n = v.value { out[k] = n } }
            events = out
        } else {
            events = nil
        }
    }

    /// The pixels the house's own sites already carry (House of Mina's Shopify store, through Shopify's app).
    var carried: [String] {
        var seen: [String] = []
        for s in sites { for id in s.ids ?? [] where !seen.contains(id) { seen.append(id) } }
        return seen
    }

    func sitesCarrying(_ id: String) -> String {
        sites.filter { (s: AdsPixelSite) in (s.ids ?? []).contains(id) }.map { (s: AdsPixelSite) in s.host }.joined(separator: " and ")
    }

    /// "1,204 page views · 31 added to cart · 4 orders" (pixel-step.tsx eventLine).
    var eventLine: String {
        guard let events else { return "" }
        let order = ["PageView", "ViewContent", "Search", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase"]
        let word: [String: String] = ["PageView": "page views", "ViewContent": "pieces viewed", "Search": "searches", "AddToCart": "added to cart",
                                      "InitiateCheckout": "checkouts started", "AddPaymentInfo": "payment details", "Purchase": "orders"]
        let keys = events.keys.filter { (k: String) in (events[k] ?? 0) > 0 }.sorted { (a: String, b: String) in
            let ia = order.firstIndex(of: a) ?? 99
            let ib = order.firstIndex(of: b) ?? 99
            return ia == ib ? a < b : ia < ib
        }
        if keys.isEmpty { return "nothing" }
        return keys.map { (k: String) in "\(AdsFormat.count(events[k] ?? 0)) \(word[k] ?? k)" }.joined(separator: " · ")
    }

    var purchases: Double? { events.map { (e: [String: Double]) in e["Purchase"] ?? 0 } }
}

struct AdsPixelAnswer: Decodable {
    let pixels: [AdsPixelRow]
    let state: AdsPixelState?

    private enum K: String, CodingKey { case pixels, state }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        pixels = c.list(.pixels, of: AdsPixelRow.self).filter { (p: AdsPixelRow) in !p.id.isEmpty }
        state = c.object(.state, of: AdsPixelState.self)
    }
}

// MARK: Audiences (/api/ads/audiences)

struct AdsAudienceRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /// "Customer list", "Lookalike", "Engagement", "Website"…
    let kind: String
    let lower: Double?
    let upper: Double?
    let ready: Bool
    let status: String?
    let created: String?

    private enum K: String, CodingKey { case id, name, kind, size, ready, status, created }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        kind = c.string(.kind, default: "")
        let size: [Double] = c.list(.size, of: Double.self)
        lower = size.count == 2 ? size[0] : nil
        upper = size.count == 2 ? size[1] : nil
        ready = c.bool(.ready, default: true)
        status = c.string(.status).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        created = c.string(.created)
    }

    /// "12k–15k people", or nil before Meta knows.
    var sizeWords: String? {
        guard let lower, let upper else { return nil }
        return "\(AdsFormat.compact(lower))–\(AdsFormat.compact(upper))"
    }
}

/// A choice with a line under it (a customer segment, a kind of rule).
struct AdsHinted: Decodable, Identifiable, Hashable {
    let key: String
    let label: String
    let hint: String
    /// Rules: "spend" (an amount today) or "cost" (a cost per result).
    let needs: String
    var id: String { key }

    private enum K: String, CodingKey { case key, label, hint, needs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        label = c.string(.label, default: "")
        hint = c.string(.hint, default: "")
        needs = c.string(.needs, default: "spend")
    }
}

struct AdsAudiencesAnswer: Decodable {
    let audiences: [AdsAudienceRow]
    let segments: [AdsHinted]
    let events: [AdsChoice]
    let instagram: String?

    private enum K: String, CodingKey { case audiences, segments, events, instagram }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        audiences = c.list(.audiences, of: AdsAudienceRow.self).filter { (a: AdsAudienceRow) in !a.id.isEmpty }
        segments = c.list(.segments, of: AdsHinted.self).filter { (s: AdsHinted) in !s.key.isEmpty }
        events = c.list(.events, of: AdsChoice.self).filter { (e: AdsChoice) in !e.key.isEmpty }
        instagram = c.string(.instagram).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
    }
}

/// What making a customer audience sent (hashed): how many customers.
struct AdsAudienceMade: Decodable {
    let id: String?
    let sent: Double?

    private enum K: String, CodingKey { case id, sent }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id)
        sent = c.double(.sent)
    }
}

// MARK: Rules and the log (/api/ads/rules)

struct AdsRuleRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let enabled: Bool
    /// "ad sets · today · spent > Rs 500 · results < 1 → pause it, every 30 min" (rules.ts describeRule).
    let summary: String

    private enum K: String, CodingKey { case id, name, enabled, summary }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        enabled = c.bool(.enabled, default: false)
        summary = c.string(.summary, default: "")
    }
}

/// One change made to the ads from the ERP (`ads_log`).
struct AdsLogRow: Decodable, Identifiable, Hashable {
    let id: String
    let at: String
    let by: String
    let action: String
    let target: String?
    let name: String?
    let daily: Double?
    let lifetime: Double?
    let currency: String?
    let newName: String?
    let end: String?
    let hasEnd: Bool

    private enum K: String, CodingKey { case id, at, by, action, target, name, detail }
    private enum D: String, CodingKey { case daily, lifetime, currency, name, end }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: UUID().uuidString)
        at = c.string(.at, default: "")
        by = c.string(.by, default: "")
        action = c.string(.action, default: "")
        target = c.string(.target).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        name = c.string(.name).flatMap { (s: String) -> String? in s.isEmpty ? nil : s }
        if let d = try? c.nestedContainer(keyedBy: D.self, forKey: .detail) {
            daily = d.double(.daily)
            lifetime = d.double(.lifetime)
            currency = d.string(.currency)
            newName = d.string(.name)
            end = d.string(.end)
            hasEnd = d.contains(.end)
        } else {
            daily = nil
            lifetime = nil
            currency = nil
            newName = nil
            end = nil
            hasEnd = false
        }
    }

    /// The change in words (rules/page.tsx logLine).
    func words(_ fallbackCurrency: String) -> String {
        let cur = currency ?? fallbackCurrency
        switch action {
        case "budget":
            if let daily, daily > 0 { return "budget → \(AdsFormat.money(daily, cur)) a day" }
            return "budget → \(AdsFormat.money(lifetime ?? 0, cur)) in total"
        case "rename":
            return "renamed “\(newName ?? "")”"
        case "schedule":
            if let end, !end.isEmpty { return "end date \(ShopDate.say(end))" }
            return "no end date"
        default:
            return action
        }
    }
}

struct AdsRulesAnswer: Decodable {
    let rules: [AdsRuleRow]
    let kinds: [AdsHinted]
    let currency: String
    let log: [AdsLogRow]

    private enum K: String, CodingKey { case rules, kinds, currency, log }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        rules = c.list(.rules, of: AdsRuleRow.self).filter { (r: AdsRuleRow) in !r.id.isEmpty }
        kinds = c.list(.kinds, of: AdsHinted.self).filter { (k: AdsHinted) in !k.key.isEmpty }
        currency = c.string(.currency, default: "PKR")
        log = c.list(.log, of: AdsLogRow.self)
    }
}
