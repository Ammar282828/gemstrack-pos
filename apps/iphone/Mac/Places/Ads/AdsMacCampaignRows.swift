#if os(macOS)
import SwiftUI
import ERPCore

// Ads › Campaigns on the Mac (docs/features/mac-design.md, "Ads"): the campaigns, their ad sets and their ads as one
// outline table. These are the table's rows and the words it uses; the screen (AdsCampaigns.swift) keeps the state,
// the loading and every write, and this file only arranges what it holds.

/// One line of the outline: a campaign, an ad set under it, or an ad under that.
struct AdsMacRow: Identifiable {
    enum Level: String {
        case campaign, adset, ad

        var word: String {
            switch self {
            case .campaign: return "Campaign"
            case .adset: return "Ad set"
            case .ad: return "Ad"
            }
        }
    }

    let id: String
    let level: Level
    let name: String
    let status: String
    let effectiveStatus: String
    let issues: [String]
    let metrics: AdMetrics
    /// The same length of time before (campaigns only), for "up 18%".
    let previous: AdMetrics?
    let daily: Double?
    let lifetime: Double?
    /// A campaign's stop time or an ad set's end time.
    let end: String?
    /// The optimisation goal that says which result counts.
    let goal: String?
    let objective: String?
    let image: String?
    let learning: String?
    /// "Campaign › Ad set" above it, for the inspector's line.
    let parents: String
    var children: [AdsMacRow]?

    var budgetValue: Double {
        if let daily, daily > 0 { return daily }
        return lifetime ?? 0
    }

    var result: (label: String, value: Double)? { AdsResults.of(metrics, goal: goal) }
    var resultValue: Double { result?.value ?? 0 }
    var costEach: Double { resultValue > 0 ? metrics.spend / resultValue : Double.greatestFiniteMagnitude }
    var roas: Double { AdsResults.sales(metrics).roas ?? -1 }
    /// Archived and deleted objects take no switch.
    var locked: Bool { status == "ARCHIVED" || status == "DELETED" }
    var hasBudget: Bool { (daily ?? 0) > 0 || (lifetime ?? 0) > 0 }
}

/// A column's order for the outline: one comparator for all, the field says which number.
struct AdsMacRowOrder: SortComparator, Hashable {
    enum Field: Hashable { case name, status, budget, spend, results, cost, roas, reach }
    var field: Field
    var order: SortOrder = .forward

    private func value(_ r: AdsMacRow) -> Double {
        switch field {
        case .budget: return r.budgetValue
        case .spend: return r.metrics.spend
        case .results: return r.resultValue
        case .cost: return r.costEach
        case .roas: return r.roas
        case .reach: return r.metrics.reach
        default: return 0
        }
    }

    func compare(_ a: AdsMacRow, _ b: AdsMacRow) -> ComparisonResult {
        var result: ComparisonResult
        switch field {
        case .name: result = a.name.localizedCaseInsensitiveCompare(b.name)
        case .status: result = a.effectiveStatus.compare(b.effectiveStatus)
        default:
            let x = value(a), y = value(b)
            result = x == y ? .orderedSame : (x < y ? .orderedAscending : .orderedDescending)
        }
        if order == .reverse {
            if result == .orderedAscending { result = .orderedDescending } else if result == .orderedDescending { result = .orderedAscending }
        }
        return result
    }
}

/// What the outline asks before it archives or deletes.
enum AdsMacConfirm: Identifiable {
    case archive([AdsMacRow])
    case delete([AdsMacRow])

    var id: String {
        switch self {
        case .archive(let rows): return "archive" + rows.map(\.id).joined(separator: ",")
        case .delete(let rows): return "delete" + rows.map(\.id).joined(separator: ",")
        }
    }

    var rows: [AdsMacRow] {
        switch self {
        case .archive(let rows): return rows
        case .delete(let rows): return rows
        }
    }

    var isDelete: Bool {
        if case .delete = self { return true }
        return false
    }
}

/// The outline's actions for what is picked, declared once: the toolbar, the menu bar's Ad menu, the right-click menu and
/// the inspector all draw from these.
struct AdsMacActions {
    var pause: MacAction
    var run: MacAction
    /// Pause when the picked object runs, else Run: the inspector's default button.
    var next: MacAction
    var budget: MacAction
    var duplicate: MacAction
    var archive: MacAction
    var delete: MacAction
    var manager: MacAction
    var newAd: MacAction

    var groups: [[MacAction]] {
        [[pause, run, budget], [duplicate, archive, delete], [manager, newAd]]
    }
}

enum AdsMacTree {
    /// The campaigns as rows, each level in the order asked.
    static func rows(_ campaigns: [AdCampaign], order: [AdsMacRowOrder]) -> [AdsMacRow] {
        let tree = campaigns.map { (c: AdCampaign) -> AdsMacRow in
            let sets = c.adsets.map { (s: AdSet) -> AdsMacRow in
                let ads = s.ads.map { (a: AdItem) -> AdsMacRow in
                    AdsMacRow(id: a.id, level: .ad, name: a.name, status: a.status, effectiveStatus: a.effectiveStatus, issues: a.issues,
                              metrics: a.metrics, previous: nil, daily: nil, lifetime: nil, end: nil, goal: s.optimizationGoal,
                              objective: nil, image: a.image, learning: nil, parents: c.name + " › " + s.name, children: nil)
                }
                return AdsMacRow(id: s.id, level: .adset, name: s.name, status: s.status, effectiveStatus: s.effectiveStatus, issues: s.issues,
                                 metrics: s.metrics, previous: nil, daily: s.dailyBudget, lifetime: s.lifetimeBudget, end: s.endTime,
                                 goal: s.optimizationGoal, objective: nil, image: nil, learning: s.learning, parents: c.name,
                                 children: ads.isEmpty ? nil : ads)
            }
            let goal: String? = c.adsets.count == 1 ? c.adsets[0].optimizationGoal : nil
            return AdsMacRow(id: c.id, level: .campaign, name: c.name, status: c.status, effectiveStatus: c.effectiveStatus, issues: c.issues,
                             metrics: c.metrics, previous: c.previous, daily: c.dailyBudget, lifetime: c.lifetimeBudget, end: c.stopTime,
                             goal: goal, objective: c.objective, image: nil, learning: nil, parents: "", children: sets.isEmpty ? nil : sets)
        }
        return sortRows(tree, order)
    }

    private static func sortRows(_ rows: [AdsMacRow], _ order: [AdsMacRowOrder]) -> [AdsMacRow] {
        rows.sorted(using: order).map { (r: AdsMacRow) -> AdsMacRow in
            var copy = r
            if let kids = r.children { copy.children = AdsMacTree.sortRows(kids, order) }
            return copy
        }
    }

    /// Every row of the outline, parents before their children.
    static func flatten(_ rows: [AdsMacRow]) -> [AdsMacRow] {
        var out: [AdsMacRow] = []
        for r in rows {
            out.append(r)
            if let kids = r.children { out.append(contentsOf: AdsMacTree.flatten(kids)) }
        }
        return out
    }
}

/// The words and figures the outline and its inspector use.
enum AdsMacFormat {
    /// "PKR 1,500 a day", "PKR 20,000 in total", or nothing.
    static func budget(_ r: AdsMacRow, _ cur: String) -> String {
        if let d = r.daily, d > 0 { return "\(AdsFormat.money(d, cur)) a day" }
        if let l = r.lifetime, l > 0 { return "\(AdsFormat.money(l, cur)) in total" }
        return ""
    }

    /// "45 chats started", or nothing where the goal has no result.
    static func result(_ r: AdsMacRow) -> String {
        guard let res = r.result else { return "" }
        return "\(AdsFormat.count(res.value)) \(res.label.lowercased())"
    }

    /// The tone of a change: more results is good, less is not; spend and reach just move.
    static func changeTone(_ now: Double, _ before: Double?, goodWhenUp: Bool) -> Tone? {
        guard goodWhenUp, let before, before != 0, now.isFinite else { return nil }
        let d = (now - before) / before
        if abs(d) < 0.005 { return nil }
        return d > 0 ? .settled : .owed
    }

    /// The figures of a picked object, two to a row: spent and results, reach and click-through, sales.
    static func figures(_ r: AdsMacRow, _ cur: String) -> [[MacFigure]] {
        let m = r.metrics
        let before = r.previous
        var rows: [[MacFigure]] = []
        let spent = MacFigure("Spent", AdsFormat.money(m.spend, cur), detail: AdsFormat.change(m.spend, before?.spend))
        if let res = r.result {
            let each = res.value > 0 ? "\(AdsFormat.money(m.spend / res.value, cur)) each" : nil
            let beforeValue = before.flatMap { (b: AdMetrics) in AdsResults.of(b, goal: r.goal)?.value }
            let change = AdsFormat.change(res.value, beforeValue)
            rows.append([spent, MacFigure(res.label, AdsFormat.count(res.value), detail: change ?? each,
                                          detailTone: change == nil ? nil : changeTone(res.value, beforeValue, goodWhenUp: true))])
        } else {
            rows.append([spent, MacFigure("Clicks", AdsFormat.count(m.clicks), detail: m.clicks > 0 ? "\(AdsFormat.money(m.cpc, cur)) each" : nil)])
        }
        rows.append([MacFigure("People reached", AdsFormat.compact(m.reach), detail: AdsFormat.change(m.reach, before?.reach) ?? "\(AdsFormat.compact(m.impressions)) views"),
                     MacFigure("Click-through", AdsFormat.pct(m.ctr), detail: "\(AdsFormat.money(m.cpm, cur)) per 1,000 views")])
        let s = AdsResults.sales(m)
        if s.value > 0 {
            let beforeSales = before.map { (b: AdMetrics) in AdsResults.sales(b).value }
            rows.append([MacFigure("Sales from ads", AdsFormat.money(s.value, cur),
                                   detail: AdsFormat.change(s.value, beforeSales) ?? "\(AdsFormat.count(s.purchases)) order\(s.purchases == 1 ? "" : "s")",
                                   detailTone: changeTone(s.value, beforeSales, goodWhenUp: true)),
                         MacFigure("ROAS", AdsResults.roasText(s.roas), detail: s.costPerPurchase.map { (c: Double) in "\(AdsFormat.money(c, cur)) per order" })])
        }
        return rows
    }

    /// Ads Manager's own page for an object of this account.
    static func managerURL(level: AdsMacRow.Level, id: String, account: String) -> URL? {
        let act = account.hasPrefix("act_") ? String(account.dropFirst(4)) : account
        let page: String
        let key: String
        switch level {
        case .campaign:
            page = "campaigns"
            key = "selected_campaign_ids"
        case .adset:
            page = "adsets"
            key = "selected_adset_ids"
        case .ad:
            page = "ads"
            key = "selected_ad_ids"
        }
        return URL(string: "https://adsmanager.facebook.com/adsmanager/manage/\(page)?act=\(act)&\(key)=\(id)")
    }
}

extension AdsAPI {
    /// Duplicate (a paused copy), archive or delete one campaign, ad set or ad: the route AdsObjectScreen posts to
    /// for the same three actions (/api/ads/object/<id>), recorded in `ads_log` by the server.
    static func macObjectAction(level: String, id: String, action: String) async throws {
        _ = try await ERPAPI.shared.send("/api/ads/object/\(AdsQuery.escape(id))", ["level": level, "action": action])
    }
}
#endif
