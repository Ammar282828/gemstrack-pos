import SwiftUI
import ERPCore

/// Website → Visitors for the house whose public store is Shopify (House of Mina): Shopify's own analytics, read through the
/// ERP (GET /api/website/shopify-analytics, src/app/website/interest/shopify-report.tsx). The tiles with their change on the
/// period before, sessions and sales over time, the conversion funnel, then every list as ranked rows with bars. A section
/// whose scope Shopify has not granted is one card at the top saying what to grant (owner, 2026-11-03: "add all Shopify
/// website insights … ALL"). Owners only; the route answers 403 to staff.
struct ShopifyVisitorsView: View {
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var width: CGFloat = 0

    /// An iPad's (or a Mac's) wide window: two columns of cards.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    @State private var period: String
    @State private var report: ShopReport?
    @State private var problem: String?

    private static let periodKey = "erp.shopifyAnalytics.period"
    private let periods: [(key: String, label: String)] = [
        ("today", "Today"), ("7d", "7 days"), ("30d", "30 days"), ("90d", "90 days"), ("month", "This month")
    ]

    init() {
        let stored = UserDefaults.standard.string(forKey: BizKey(Self.periodKey)) ?? "30d"
        _period = State(initialValue: ["today", "7d", "30d", "90d", "month"].contains(stored) ? stored : "30d")
    }

    private var path: String { "/api/website/shopify-analytics?range=\(period)&compare=1" }

    var body: some View {
        if session.isOwner {
            ownerBody
        } else {
            ShopOwnersOnly(title: "Visitors")
        }
    }

    private var ownerBody: some View {
        content
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .motion(period)
            .overlay { stateOverlay }
            .navigationTitle("Visitors")
            .navigationBarTitleDisplayMode(.inline)
            #if os(macOS)
            .macRefresh { Task { await load() } }
            #endif
            .refreshable { await load() }
            .task(id: period) { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if wide {
            wideBody
        } else {
            List {
                Section {
                    chips.chipRowInList()
                    if let r = report {
                        Text(spanLine(r))
                            .font(.footnote).foregroundStyle(.secondary)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }
                if let r = report {
                    grants(r)
                    figures(r)
                    ForEach(ShopBlockID.phone) { (b: ShopBlockID) in
                        block(b, r)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .modifier(HouseGround())
        }
    }

    // MARK: The period

    private var chips: some View {
        ChipRow {
            ForEach(periods, id: \.key) { (p: (key: String, label: String)) in
                FilterChip(title: p.label, chosen: period == p.key) { choose(p.key) }
            }
        }
    }

    private func choose(_ key: String) {
        guard key != period else { return }
        UserDefaults.standard.set(key, forKey: BizKey(Self.periodKey))
        Motion.run(reduce: reduceMotion) { period = key }
    }

    private func spanLine(_ r: ShopReport) -> String {
        var s = ""
        if let name = r.store?.name, !name.isEmpty { s += name + " on Shopify \u{00B7} " }
        s += SiteWords.span(r.from, r.to)
        if let p = r.previous, !p.from.isEmpty { s += " \u{00B7} compared with " + SiteWords.span(p.from, p.to) }
        return s + " \u{00B7} Shopify may take a few minutes to catch up"
    }

    // MARK: Wide window

    private var wideBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(20)) {
                VStack(alignment: .leading, spacing: pt(10)) {
                    chips.padding(.leading, -16)
                    if let r = report {
                        Text(spanLine(r)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let r = report {
                    grants(r)
                    figures(r)
                    block(.series, r)
                    HStack(alignment: .top, spacing: pt(20)) {
                        VStack(alignment: .leading, spacing: pt(20)) {
                            ForEach(ShopBlockID.left) { (b: ShopBlockID) in block(b, r) }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                        VStack(alignment: .leading, spacing: pt(20)) {
                            ForEach(ShopBlockID.right) { (b: ShopBlockID) in block(b, r) }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                }
            }
            .environment(\.siteWide, true)
            .padding(.horizontal, pt(28))
            .padding(.top, pt(8))
            .padding(.bottom, pt(28))
            .frame(maxWidth: 1240)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
    }

    // MARK: The report

    @ViewBuilder
    private func grants(_ r: ShopReport) -> some View {
        ForEach(ShopWords.missing(r.all)) { (m: ShopMissing) in
            ShopGrantCard(missing: m)
        }
    }

    private func money(_ r: ShopReport) -> (Double) -> String {
        let cur = r.store?.currency ?? ""
        return { (x: Double) -> String in ShopWords.money(x, cur) }
    }

    private func tile(_ k: ShopKpis, _ name: String, _ label: String, _ format: (Double) -> String,
                      invert: Bool = false, detail: String? = nil) -> SiteTile {
        SiteTile(label: label, value: format(k.value(name)), now: k.value(name), before: k.before(name), invert: invert, detail: detail)
    }

    @ViewBuilder
    private func figures(_ r: ShopReport) -> some View {
        let cash = money(r)
        let count = { (x: Double) -> String in ShopWords.number(x) }
        let rate = { (x: Double) -> String in SiteWords.pct(x) }
        let seconds = { (x: Double) -> String in SiteWords.duration(x * 1000) }
        ShopGate(title: "Sessions", section: r.traffic) { (k: ShopKpis) in
            ShopFigureBlock {
                tile(k, "sessions", "Sessions", count, detail: String(format: "%.1f pages each", k.value("pageviewsPerSession")))
                tile(k, "visitors", "Visitors", count)
                tile(k, "pageviews", "Page views", count)
                tile(k, "conversionRate", "Conversion rate", rate, detail: ShopWords.number(k.value("completedCheckout")) + " checked out")
                tile(k, "bounceRate", "Bounce rate", rate, invert: true)
                tile(k, "avgSessionSeconds", "Time on site", seconds, detail: "a session")
                tile(k, "searches", "Searches", count)
                tile(k, "productsViewed", "Products viewed", count)
            }
        }
        ShopGate(title: "Sales", section: r.sales) { (k: ShopKpis) in
            ShopFigureBlock {
                tile(k, "totalSales", "Total sales", cash)
                tile(k, "orders", "Orders", count)
                tile(k, "averageOrderValue", "Average order", cash)
                tile(k, "returningCustomerRate", "Returning customers", rate, detail: ShopWords.number(k.value("newCustomers")) + " new")
                tile(k, "grossSales", "Gross sales", cash)
                tile(k, "discounts", "Discounts", cash, invert: true)
                tile(k, "netSales", "Net sales", cash)
                tile(k, "itemsSold", "Items sold", count)
            }
        }
    }

    @ViewBuilder
    private func block(_ b: ShopBlockID, _ r: ShopReport) -> some View {
        let cur = r.store?.currency ?? ""
        switch b {
        case .series:
            ShopGate(title: "Sessions and sales over time", section: r.series) { (s: ShopSeries) in
                ShopSeriesBlock(series: s)
            }
        case .funnel:
            ShopGate(title: "Conversion funnel", section: r.funnel) { (steps: [ShopFunnelStep]) in
                ShopFunnelBlock(steps: steps)
            }
        case .products:
            ShopGate(title: "Top products", section: r.products) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Top products", rows: ShopRanks.rows(rows, currency: cur, money: true, sub: Self.sold),
                                note: "Net sales", empty: "No sales in this period.")
            }
        case .productPages:
            ShopGate(title: "Product pages people land on", section: r.productPages) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Product pages people land on", rows: ShopRanks.rows(rows, currency: cur),
                                note: "Sessions. Shopify keeps no per-product views table.", empty: "None in this period.")
            }
        case .sources:
            ShopGate(title: "Where they came from", section: r.sources) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Where they came from", rows: ShopRanks.rows(rows, currency: cur, sub: Self.bought),
                                note: "Sessions", empty: "No sessions yet.")
            }
        case .places:
            ShopGate(title: "Where they are", section: r.places) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Where they are", rows: ShopRanks.rows(rows, currency: cur, lead: true),
                                note: "Sessions", empty: "No sessions yet.")
            }
        case .devices:
            ShopGate(title: "Devices", section: r.devices) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Devices", rows: ShopRanks.rows(rows, currency: cur, label: Self.device), empty: "No sessions yet.")
            }
        case .landing:
            ShopGate(title: "Pages they arrived on", section: r.landing) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Pages they arrived on", rows: ShopRanks.rows(rows, currency: cur, sub: Self.bounced),
                                note: "Landing pages, by sessions", empty: "No sessions yet.")
            }
        case .searches:
            ShopGate(title: "What they searched for", section: r.searches) { (rows: [ShopListRow]) in
                ShopRankSection(title: "What they searched for", rows: ShopRanks.rows(rows, currency: cur, label: Self.quoted),
                                note: "On the store", empty: "No searches yet.")
            }
        case .channels:
            ShopGate(title: "Sales by channel", section: r.channels) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Sales by channel", rows: ShopRanks.rows(rows, currency: cur, money: true),
                                note: "Net sales", empty: "No sales in this period.")
            }
        case .discounts:
            ShopGate(title: "Discount codes", section: r.discounts) { (rows: [ShopListRow]) in
                ShopRankSection(title: "Discount codes", rows: ShopRanks.rows(rows, currency: cur, money: true),
                                note: "Discounts given", empty: "No codes used in this period.")
            }
        case .customers:
            ShopGate(title: "New and returning customers", section: r.customers) { (rows: [ShopListRow]) in
                ShopRankSection(title: "New and returning customers", rows: ShopRanks.rows(rows, currency: cur, money: true),
                                note: "Total sales", empty: "No sales in this period.")
            }
        }
    }

    // The words under a row.
    private static let sold: (ShopListRow) -> String? = { (r: ShopListRow) -> String? in
        let n = r.extra["net_items_sold"] ?? 0
        return n > 0 ? "\(ShopWords.number(n)) sold" : nil
    }
    private static let bought: (ShopListRow) -> String? = { (r: ShopListRow) -> String? in
        let n = r.extra["sessions_that_completed_checkout"] ?? 0
        return n > 0 ? "\(ShopWords.number(n)) bought" : nil
    }
    private static let bounced: (ShopListRow) -> String? = { (r: ShopListRow) -> String? in
        let x = r.extra["bounce_rate"] ?? 0
        return x > 0 ? SiteWords.pct(x) + " bounced" : nil
    }
    private static let device: (ShopListRow) -> String = { (r: ShopListRow) -> String in
        let mapped = SiteWords.device(r.label.lowercased())
        return mapped == r.label.lowercased() ? r.label : mapped
    }
    private static let quoted: (ShopListRow) -> String = { (r: ShopListRow) -> String in
        "\u{201C}" + r.label + "\u{201D}"
    }

    // MARK: Loading

    @ViewBuilder
    private var stateOverlay: some View {
        if report == nil, let problem {
            ErrorState(problem) { Task { await load() } }
        } else if report == nil {
            SkeletonPage(shape: .figures)
        }
    }

    /// The previous report stays while the next period loads; a failure shows only when there is nothing to show.
    private func load() async {
        let asked = path
        if report == nil, let cached = SWR.peek(asked, as: ShopReport.self) { report = cached }
        do {
            let r = try await SWR.get(asked, as: ShopReport.self)
            guard asked == path else { return }
            Motion.run(reduce: reduceMotion) { report = r }
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            if report == nil { problem = error.localizedDescription }
        }
    }
}

/// The report's blocks, in the order a phone lists them and the two columns of a wide window.
enum ShopBlockID: String, Identifiable {
    case series, funnel, products, productPages, sources, places, devices, landing, searches, channels, discounts, customers
    var id: String { rawValue }

    static let phone: [ShopBlockID] = [.series, .funnel, .products, .productPages, .sources, .places, .devices, .landing, .searches, .channels, .discounts, .customers]
    static let left: [ShopBlockID] = [.funnel, .products, .sources, .devices, .channels, .customers]
    static let right: [ShopBlockID] = [.places, .productPages, .landing, .searches, .discounts]
}
