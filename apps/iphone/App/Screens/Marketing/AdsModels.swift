import Foundation
import ERPCore

// The Ads routes' answers (src/lib/ads/shape.ts, /api/ads/overview, /api/ads/campaigns), read
// leniently. Money in them is already in the account's currency, whole units (the server converts Meta's
// minor units), so nothing here divides by 100.

/// A range's numbers for an account, a campaign, an ad set or an ad (shape.ts `Metrics`).
struct AdMetrics: Decodable, Hashable {
    var spend = 0.0
    var impressions = 0.0
    var reach = 0.0
    var frequency = 0.0
    var clicks = 0.0
    var linkClicks = 0.0
    var ctr = 0.0
    var cpm = 0.0
    var cpc = 0.0
    /// Meta's action types ("link_click", "onsite_conversion.messaging_conversation_started_7d") and how many.
    var actions: [String: Double] = [:]

    init() {}

    private enum K: String, CodingKey {
        case spend, impressions, reach, frequency, clicks, linkClicks, ctr, cpm, cpc, actions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        spend = c.double(.spend, default: 0)
        impressions = c.double(.impressions, default: 0)
        reach = c.double(.reach, default: 0)
        frequency = c.double(.frequency, default: 0)
        clicks = c.double(.clicks, default: 0)
        linkClicks = c.double(.linkClicks, default: 0)
        ctr = c.double(.ctr, default: 0)
        cpm = c.double(.cpm, default: 0)
        cpc = c.double(.cpc, default: 0)
        let raw = (try? c.decodeIfPresent([String: Lossy<Double>].self, forKey: .actions)) ?? [:]
        var out: [String: Double] = [:]
        for (type, value) in raw { if let v = value.value { out[type] = v } }
        actions = out
    }
}

/// The ad account (shape.ts `AdsAccount`).
struct AdAccount: Decodable, Hashable {
    let id: String
    let name: String
    let currency: String
    let status: Int
    let amountSpent: Double
    let spendCap: Double?
    let funding: String?

    private enum K: String, CodingKey { case id, name, currency, status, amountSpent, spendCap, funding }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        currency = c.string(.currency, default: "PKR")
        status = c.int(.status) ?? 0
        amountSpent = c.double(.amountSpent, default: 0)
        spendCap = c.double(.spendCap)
        funding = c.string(.funding)
    }
}

struct AdDay: Decodable, Identifiable, Hashable {
    let date: String
    let metrics: AdMetrics
    var id: String { date }

    private enum K: String, CodingKey { case date, metrics }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
    }
}

/// An ad that spent most in the range.
struct AdTop: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let campaign: String
    let thumbnail: String?
    let goal: String?
    let metrics: AdMetrics

    private enum K: String, CodingKey { case id, name, campaign, thumbnail, goal, metrics }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        campaign = c.string(.campaign, default: "")
        thumbnail = c.string(.thumbnail)
        goal = c.string(.goal)
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
    }
}

/// A row of "who saw them", "where" or "region".
struct AdSplit: Decodable, Identifiable, Hashable {
    let key: String
    let label: String
    let metrics: AdMetrics
    var id: String { key }

    private enum K: String, CodingKey { case key, label, metrics }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        label = c.string(.label, default: "")
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
    }
}

/// One thing that needs a look (src/lib/ads/attention.ts `AttentionItem`).
struct AdAttention: Decodable, Identifiable, Hashable {
    let severity: String
    let title: String
    let why: String
    /// pause, resume or open; empty when there is nothing to tap.
    let doing: String
    let level: String
    let targetId: String
    let targetName: String
    let href: String
    var id: String { "\(title)|\(targetId)|\(why)" }

    private enum K: String, CodingKey { case severity, title, why, action }
    private enum A: String, CodingKey { case doing = "do", level, id, name, href }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        severity = c.string(.severity, default: "tip")
        title = c.string(.title, default: "")
        why = c.string(.why, default: "")
        if let a = try? c.nestedContainer(keyedBy: A.self, forKey: .action) {
            doing = a.string(.doing, default: "")
            level = a.string(.level, default: "")
            targetId = a.string(.id, default: "")
            targetName = a.string(.name, default: "")
            href = a.string(.href, default: "")
        } else {
            doing = ""
            level = ""
            targetId = ""
            targetName = ""
            href = ""
        }
    }
}

struct AdMonth: Decodable, Hashable {
    let spent: Double
    let projected: Double
    let lastMonth: Double
    let dayOfMonth: Int
    let daysInMonth: Int

    private enum K: String, CodingKey { case spent, projected, lastMonth, dayOfMonth, daysInMonth }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        spent = c.double(.spent, default: 0)
        projected = c.double(.projected, default: 0)
        lastMonth = c.double(.lastMonth, default: 0)
        dayOfMonth = c.int(.dayOfMonth) ?? 1
        daysInMonth = max(1, c.int(.daysInMonth) ?? 30)
    }
}

/// GET /api/ads/overview.
struct AdOverview: Decodable {
    let account: AdAccount
    let since: String?
    let until: String?
    let totals: AdMetrics
    let before: AdMetrics?
    let beforeSince: String?
    let beforeUntil: String?
    let daily: [AdDay]
    let topAds: [AdTop]
    let ageGender: [AdSplit]
    let placement: [AdSplit]
    let region: [AdSplit]
    let attention: [AdAttention]
    let month: AdMonth?
    let at: String

    private enum K: String, CodingKey {
        case account, since, until, totals, previous, daily, topAds, breakdowns, attention, month, at
    }
    private enum P: String, CodingKey { case since, until, metrics }
    private enum B: String, CodingKey { case ageGender, placement, region }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        guard let acct = c.object(.account, of: AdAccount.self) else {
            throw DecodingError.keyNotFound(K.account, .init(codingPath: [], debugDescription: "The answer has no ad account."))
        }
        account = acct
        since = c.string(.since)
        until = c.string(.until)
        totals = c.object(.totals, of: AdMetrics.self) ?? AdMetrics()
        if let p = try? c.nestedContainer(keyedBy: P.self, forKey: .previous) {
            before = p.object(.metrics, of: AdMetrics.self)
            beforeSince = p.string(.since)
            beforeUntil = p.string(.until)
        } else {
            before = nil
            beforeSince = nil
            beforeUntil = nil
        }
        daily = c.list(.daily, of: AdDay.self)
        topAds = c.list(.topAds, of: AdTop.self)
        if let b = try? c.nestedContainer(keyedBy: B.self, forKey: .breakdowns) {
            ageGender = b.list(.ageGender, of: AdSplit.self)
            placement = b.list(.placement, of: AdSplit.self)
            region = b.list(.region, of: AdSplit.self)
        } else {
            ageGender = []
            placement = []
            region = []
        }
        attention = c.list(.attention, of: AdAttention.self)
        month = c.object(.month, of: AdMonth.self)
        at = c.string(.at, default: "")
    }
}

// MARK: The campaign tree

struct AdItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let status: String
    let effectiveStatus: String
    let image: String?
    let issues: [String]
    let metrics: AdMetrics

    private enum K: String, CodingKey { case id, name, status, effectiveStatus, image, thumbnail, issues, metrics }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        let state = c.string(.status, default: "")
        status = state
        effectiveStatus = c.string(.effectiveStatus, default: state)
        image = c.string(.image) ?? c.string(.thumbnail)
        issues = c.strings(.issues)
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
    }
}

struct AdSet: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let status: String
    let effectiveStatus: String
    let optimizationGoal: String
    let dailyBudget: Double?
    let lifetimeBudget: Double?
    let endTime: String?
    let learning: String?
    let issues: [String]
    let metrics: AdMetrics
    let ads: [AdItem]

    private enum K: String, CodingKey {
        case id, name, status, effectiveStatus, optimizationGoal, dailyBudget, lifetimeBudget, endTime, learning, issues, metrics, ads
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        let state = c.string(.status, default: "")
        status = state
        effectiveStatus = c.string(.effectiveStatus, default: state)
        optimizationGoal = c.string(.optimizationGoal, default: "")
        dailyBudget = c.double(.dailyBudget)
        lifetimeBudget = c.double(.lifetimeBudget)
        endTime = c.string(.endTime)
        learning = c.string(.learning)
        issues = c.strings(.issues)
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
        ads = c.list(.ads, of: AdItem.self)
    }
}

struct AdCampaign: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let status: String
    let effectiveStatus: String
    let objective: String
    let dailyBudget: Double?
    let lifetimeBudget: Double?
    let stopTime: String?
    let issues: [String]
    let metrics: AdMetrics
    /// The same length of time before, for "up 18%".
    let previous: AdMetrics?
    let adsets: [AdSet]

    private enum K: String, CodingKey {
        case id, name, status, effectiveStatus, objective, dailyBudget, lifetimeBudget, stopTime, issues, metrics, previous, adsets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        let state = c.string(.status, default: "")
        status = state
        effectiveStatus = c.string(.effectiveStatus, default: state)
        objective = c.string(.objective, default: "")
        dailyBudget = c.double(.dailyBudget)
        lifetimeBudget = c.double(.lifetimeBudget)
        stopTime = c.string(.stopTime)
        issues = c.strings(.issues)
        metrics = c.object(.metrics, of: AdMetrics.self) ?? AdMetrics()
        previous = c.object(.previous, of: AdMetrics.self)
        adsets = c.list(.adsets, of: AdSet.self)
    }
}

/// GET /api/ads/campaigns.
struct AdCampaigns: Decodable {
    let account: AdAccount
    let campaigns: [AdCampaign]

    private enum K: String, CodingKey { case account, campaigns }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        guard let acct = c.object(.account, of: AdAccount.self) else {
            throw DecodingError.keyNotFound(K.account, .init(codingPath: [], debugDescription: "The answer has no ad account."))
        }
        account = acct
        campaigns = c.list(.campaigns, of: AdCampaign.self).filter { (x: AdCampaign) in !x.id.isEmpty }
    }
}
