#if os(macOS)
import SwiftUI
import Charts
import AppKit
import ERPCore

// Social › Insights, Posts and Audience on the Mac (docs/features/mac-design.md, "Ads"): reports. A row of figures with
// their change, charts that read out where the pointer is, and the lists as sortable tables. The screens (Insights.swift)
// keep the loading; these are the parts they are made of.

// MARK: The figures

enum InsightsMacFigures {
    private static func figure(_ label: String, _ value: String, now: Double, before: Double?, fallback: String? = nil) -> MacFigure {
        let change = AdsFormat.change(now, before)
        return MacFigure(label, value, detail: change ?? fallback,
                         detailTone: change == nil ? nil : AdsMacFormat.changeTone(now, before, goodWhenUp: true))
    }

    /// Instagram in two rows of four: who follows, what was reached and seen, what people did.
    static func instagram(_ ig: InstagramInsight) -> [[MacFigure]] {
        let t = ig.totals
        let p = ig.previous
        func v(_ k: String) -> Double { t[k] ?? 0 }
        let follows = ig.follows.map { (f: InsightFollows) in "\(f.net >= 0 ? "+" : "−")\(AdsFormat.count(abs(f.net))) · \(AdsFormat.count(f.follows)) in, \(AdsFormat.count(f.unfollows)) out" }
        let newPeople = ig.nonFollowerReach.map { (s: Double) in "\(Int((s * 100).rounded()))% not following" }
        let linkShare = v("profile_views") > 0 ? String(format: "%.1f%% of visits", 100 * v("website_clicks") / v("profile_views")) : nil
        let first: [MacFigure] = [
            MacFigure("Followers", AdsFormat.count(ig.followers), detail: follows),
            figure("Accounts reached", AdsFormat.compact(v("reach")), now: v("reach"), before: p["reach"], fallback: newPeople),
            figure("Views", AdsFormat.compact(v("views")), now: v("views"), before: p["views"]),
            figure("Accounts engaged", AdsFormat.compact(v("accounts_engaged")), now: v("accounts_engaged"), before: p["accounts_engaged"]),
        ]
        let second: [MacFigure] = [
            MacFigure("Interactions", AdsFormat.compact(v("total_interactions")),
                      detail: "\(AdsFormat.compact(v("likes"))) likes · \(AdsFormat.compact(v("comments"))) comments"),
            MacFigure("Shares · saves", "\(AdsFormat.compact(v("shares"))) · \(AdsFormat.compact(v("saves")))",
                      detail: "\(AdsFormat.compact(v("replies"))) story replies"),
            figure("Profile visits", AdsFormat.compact(v("profile_views")), now: v("profile_views"), before: p["profile_views"]),
            MacFigure("Link taps", AdsFormat.compact(v("website_clicks")), detail: linkShare),
        ]
        return [first, second]
    }

    static func facebook(_ fb: FacebookInsight) -> [MacFigure] {
        let t = fb.totals
        let p = fb.previous
        func v(_ k: String) -> Double { t[k] ?? 0 }
        return [
            MacFigure("Followers", AdsFormat.count(fb.followers),
                      detail: "+\(AdsFormat.count(v("page_daily_follows_unique"))) · −\(AdsFormat.count(v("page_daily_unfollows_unique")))"),
            figure("Views", AdsFormat.compact(v("page_media_view")), now: v("page_media_view"), before: p["page_media_view"],
                   fallback: "\(AdsFormat.compact(v("page_total_media_view_unique"))) people"),
            figure("Engagement", AdsFormat.compact(v("page_post_engagements")), now: v("page_post_engagements"), before: p["page_post_engagements"]),
            figure("Page visits", AdsFormat.compact(v("page_views_total")), now: v("page_views_total"), before: p["page_views_total"]),
        ]
    }
}

// MARK: Ads or own posts?

struct InsightsMacSplitRow: Identifiable {
    let id: String
    let label: String
    let ads: Double
    let organic: Double
    let share: Double
    let surfaces: String

    init(_ label: String, _ s: InsightSplit) {
        id = label
        self.label = label
        ads = s.ads
        organic = s.organic
        share = s.adsShare ?? 0
        surfaces = s.bySurface.filter { (p: InsightPart) in p.value > 0 }
            .map { (p: InsightPart) in "\(InsightWords.surface[p.key] ?? p.key) \(AdsFormat.compact(p.value))" }
            .joined(separator: " · ")
    }
}

/// Reach, views and interactions, from ads and from own posts, with the share that ads gave.
struct InsightsMacSplitTable: View {
    let rows: [InsightsMacSplitRow]
    @State private var sort = [KeyPathComparator(\InsightsMacSplitRow.label)]

    var body: some View {
        let list = rows.sorted(using: sort)
        Table(list, sortOrder: $sort) {
            TableColumn("Measure", value: \.label) { (r: InsightsMacSplitRow) in Text(r.label) }
                .width(min: 110, ideal: 150)
            TableColumn("From Ads", value: \.ads) { (r: InsightsMacSplitRow) in
                Text(AdsFormat.compact(r.ads)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Own Posts", value: \.organic) { (r: InsightsMacSplitRow) in
                Text(AdsFormat.compact(r.organic)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Share From Ads", value: \.share) { (r: InsightsMacSplitRow) in
                Text("\(Int((r.share * 100).rounded()))%").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("By Surface") { (r: InsightsMacSplitRow) in Text(r.surfaces).foregroundStyle(.secondary).lineLimit(1) }
                .width(min: 160, ideal: 360)
        }
        .frame(height: adsMacTableHeight(list.count))
    }
}

// MARK: Ads by platform

struct InsightsMacPlatformRow: Identifiable {
    let id: String
    let name: String
    let spend: Double
    let change: String
    let reach: Double
    let views: Double
    let clicks: Double
    let results: String
}

struct InsightsMacPlatformTable: View {
    let rows: [InsightsMacPlatformRow]
    let currency: String
    @State private var sort = [KeyPathComparator(\InsightsMacPlatformRow.spend, order: .reverse)]

    var body: some View {
        let list = rows.sorted(using: sort)
        Table(list, sortOrder: $sort) {
            TableColumn("Platform", value: \.name) { (r: InsightsMacPlatformRow) in Text(r.name) }
                .width(min: 110, ideal: 160)
            TableColumn("Spent", value: \.spend) { (r: InsightsMacPlatformRow) in
                VStack(alignment: .trailing, spacing: 0) {
                    Text(AdsFormat.money(r.spend, currency)).monospacedDigit()
                    if !r.change.isEmpty { Text(r.change).font(.caption).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 100, ideal: 130)
            TableColumn("Reached", value: \.reach) { (r: InsightsMacPlatformRow) in
                Text(AdsFormat.compact(r.reach)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Views", value: \.views) { (r: InsightsMacPlatformRow) in
                Text(AdsFormat.compact(r.views)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Link Clicks", value: \.clicks) { (r: InsightsMacPlatformRow) in
                Text(AdsFormat.count(r.clicks)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 80, ideal: 100)
            TableColumn("Results") { (r: InsightsMacPlatformRow) in Text(r.results).lineLimit(1) }
                .width(min: 120, ideal: 260)
        }
        .frame(height: adsMacTableHeight(list.count, row: 36))
    }
}

// MARK: Audience

struct InsightsMacShareRow: Identifiable {
    let id: String
    let label: String
    let value: Double
    let share: Double
}

/// One breakdown (age, gender, cities, countries): its share, as a number and as a bar.
struct InsightsMacShareTable: View {
    let heading: String
    let rows: [InsightsMacShareRow]
    @State private var sort = [KeyPathComparator(\InsightsMacShareRow.value, order: .reverse)]

    var body: some View {
        let list = rows.sorted(using: sort)
        let biggest = max(list.map { (r: InsightsMacShareRow) in r.value }.max() ?? 1, 1)
        Table(list, sortOrder: $sort) {
            TableColumn(heading, value: \.label) { (r: InsightsMacShareRow) in Text(r.label).lineLimit(1) }
                .width(min: 90, ideal: 150)
            TableColumn("Share", value: \.value) { (r: InsightsMacShareRow) in
                HStack(spacing: 8) {
                    Text("\(Int((r.share * 100).rounded()))%").monospacedDigit().frame(width: 40, alignment: .trailing)
                    GeometryReader { (g: GeometryProxy) in
                        Capsule().fill(Theme.accent).frame(width: max(2, g.size.width * r.value / biggest), height: 6)
                            .frame(maxHeight: .infinity, alignment: .center)
                    }
                }
            }
            .width(min: 120, ideal: 220)
        }
        .frame(height: adsMacTableHeight(list.count))
    }
}

/// Followers online by the hour, read by pointing: the hour under the pointer is marked and its share said.
struct InsightsMacHourChart: View {
    struct Hour: Identifiable {
        let id: Int
        let label: String
        let online: Double
    }

    let hours: [Hour]
    @State private var hovered: String?

    var body: some View {
        Chart {
            ForEach(hours) { (h: Hour) in
                BarMark(x: .value("Hour", h.label), y: .value("Online", h.online))
                    .foregroundStyle(Theme.accent.opacity(hovered == nil || hovered == h.label ? 1 : 0.5))
            }
            if let hovered, let h = hours.first(where: { (x: Hour) in x.label == hovered }) {
                RuleMark(x: .value("Hour", hovered))
                    .foregroundStyle(Color.secondary.opacity(0.4))
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.label).font(.caption.weight(.semibold))
                            Text("\(AdsFormat.compact(h.online)) online").font(.caption).monospacedDigit()
                        }
                        .padding(8)
                        .background(Theme.card, in: .rect(cornerRadius: 8, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                    }
            }
        }
        .chartOverlay { (proxy: ChartProxy) in
            GeometryReader { (geo: GeometryProxy) in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { (phase: HoverPhase) in
                        switch phase {
                        case .active(let at):
                            guard let frame = proxy.plotFrame else { return }
                            let x = at.x - geo[frame].origin.x
                            let label: String? = proxy.value(atX: x)
                            hovered = label
                        case .ended:
                            hovered = nil
                        }
                    }
            }
        }
        .accessibilityLabel("Followers online each hour, Karachi time")
        .accessibilityValue(ChartSummary.say(hours.map { (label: $0.label, value: $0.online) }, money: false, total: false))
    }
}

// MARK: A post, in the inspector

struct InsightsMacPostPanel: View {
    let post: InsightPost
    let live: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MacInspectorHeader(title: InsightWords.kind[post.kind] ?? post.kind, subtitle: ShopDate.say(post.at),
                                   status: live ? MacStatus("Up now", tone: .settled) : (post.older ? MacStatus("Before this range", tone: .quiet) : nil),
                                   actions: [])
                StockImage(imageUrl: post.thumb, name: post.caption, key: post.id)
                    .aspectRatio(post.kind == "story" || post.kind == "reel" ? 9.0 / 16.0 : 1, contentMode: .fit)
                    .frame(maxHeight: 260)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    .frame(maxWidth: .infinity)
                if !post.caption.isEmpty { Text(post.caption).textSelection(.enabled) }
                ForEach(Array(figures.enumerated()), id: \.offset) { _, cells in MacFigures(cells) }
                if let link = post.link, let url = URL(string: link) {
                    Button("Open on Instagram") { NSWorkspace.shared.open(url) }
                }
            }
            .padding(16)
        }
    }

    /// Every number the phone's row shows, two to a line.
    private var figures: [[MacFigure]] {
        var all: [MacFigure] = [
            MacFigure("Views", InsightWords.optional(post.views)), MacFigure("Reach", InsightWords.optional(post.reach)),
            MacFigure("Likes", InsightWords.optional(post.likes)), MacFigure("Comments", InsightWords.optional(post.comments)),
            MacFigure("Shares", InsightWords.optional(post.shares)), MacFigure("Engagement rate", InsightWords.percent(post.rate)),
        ]
        if let s = post.saves { all.append(MacFigure("Saves", AdsFormat.compact(s))) }
        if let v = post.profileVisits { all.append(MacFigure("Profile visits", AdsFormat.compact(v))) }
        if let f = post.follows { all.append(MacFigure("Follows", AdsFormat.compact(f))) }
        if let w = post.avgWatchMs { all.append(MacFigure("Average watch", String(format: "%.1fs", w / 1000))) }
        if let fv = post.facebookViews { all.append(MacFigure("On Facebook", AdsFormat.compact(fv))) }
        if let c = post.clicks { all.append(MacFigure("Clicks", AdsFormat.compact(c))) }
        var out: [[MacFigure]] = []
        var i = 0
        while i < all.count {
            out.append(Array(all[i..<min(i + 2, all.count)]))
            i += 2
        }
        return out
    }
}
#endif
