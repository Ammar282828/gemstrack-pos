import SwiftUI
import ERPCore

/// Website → Visitors → Live for the house whose public store is Shopify (House of Mina): GET /api/website/shopify-analytics/live
/// (src/app/website/interest/shopify-live.tsx), asked again every 60 seconds while this screen is up and the app active (the
/// server keeps an answer that long). Shopify has no Live View API, so this is what stands in: sessions in the last half hour,
/// today's figures, sessions by the minute, today's places, and the orders and checkouts of the last half hour. Owners only.
struct ShopifyLiveView: View {
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var width: CGFloat = 0
    @State private var live: ShopLive?
    @State private var problem: String?

    /// An iPad's (or a Mac's) wide window: the count and today's figures across the top, two columns beneath.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    var body: some View {
        if session.isOwner {
            ownerBody
        } else {
            ShopOwnersOnly(title: "Live")
        }
    }

    private var ownerBody: some View {
        content
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .motion(live?.lastHalfHour)
            .overlay { stateOverlay }
            .navigationTitle("Live")
            .navigationBarTitleDisplayMode(.inline)
            #if os(macOS)
            .macRefresh { Task { await load() } }
            #endif
            .refreshable { await load() }
            .task(id: scenePhase) { await poll() }
    }

    @ViewBuilder
    private var content: some View {
        if wide {
            wideBody
        } else {
            List {
                if let l = live {
                    grants(l)
                    Section {
                        heroBody(l)
                    } footer: {
                        if !l.note.isEmpty { Text(l.note) }
                    }
                    .houseRows()
                    todayBlock(l)
                    recentBlock(l)
                    minuteBlock(l)
                    placesBlock(l)
                }
            }
            .listStyle(.insetGrouped)
            .modifier(HouseGround())
        }
    }

    private var wideBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(20)) {
                if let l = live {
                    grants(l)
                    HStack(alignment: .top, spacing: pt(12)) {
                        heroBody(l).ledgerCard().frame(maxWidth: 340)
                        todayBlock(l)
                    }
                    if !l.note.isEmpty {
                        Text(l.note).font(.footnote).foregroundStyle(.secondary)
                    }
                    HStack(alignment: .top, spacing: pt(20)) {
                        VStack(alignment: .leading, spacing: pt(20)) {
                            minuteBlock(l)
                            placesBlock(l)
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                        VStack(alignment: .leading, spacing: pt(20)) {
                            recentBlock(l)
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

    // MARK: The count

    private func heroBody(_ l: ShopLive) -> some View {
        let n = l.lastHalfHour
        let on = (n ?? 0) > 0
        return HStack(spacing: pt(14)) {
            Image(systemName: "circle.fill")
                .font(.caption)
                .foregroundStyle(on ? Tone.settled.color : Color.secondary.opacity(0.4))
                .symbolEffect(.pulse, isActive: on && !reduceMotion)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: pt(4)) {
                Text(n.map { (x: Int) -> String in String(x) } ?? "\u{2013}")
                    .font(.system(.largeTitle, design: .serif).weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(n ?? 0)))
                Text("sessions on the store in the last \(l.windowMinutes) minutes")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: The blocks

    @ViewBuilder
    private func grants(_ l: ShopLive) -> some View {
        ForEach(ShopWords.missing(l.all)) { (m: ShopMissing) in
            ShopGrantCard(missing: m)
        }
    }

    private func todayBlock(_ l: ShopLive) -> some View {
        ShopGate(title: "Today so far", section: l.today) { (k: ShopKpis) in
            ShopFigureBlock(title: "Today so far") {
                SiteTile(label: "Sessions", value: ShopWords.number(k.value("sessions")), detail: "today")
                SiteTile(label: "Visitors", value: ShopWords.number(k.value("visitors")))
                SiteTile(label: "Added to cart", value: ShopWords.number(k.value("addedToCart")), detail: "sessions")
                SiteTile(label: "Reached checkout", value: ShopWords.number(k.value("reachedCheckout")),
                         detail: ShopWords.number(k.value("completedCheckout")) + " completed")
            }
        }
    }

    private func minuteBlock(_ l: ShopLive) -> some View {
        ShopGate(title: "Sessions by the minute", section: l.sessions) { (s: ShopSeries) in
            ShopMinuteBlock(series: s)
        }
    }

    private func placesBlock(_ l: ShopLive) -> some View {
        ShopGate(title: "Where they are", section: l.places) { (rows: [ShopListRow]) in
            ShopRankSection(title: "Where they are", rows: ShopRanks.rows(rows, currency: "", lead: true),
                            note: "Sessions today", empty: "No sessions yet today.")
        }
    }

    private func recentBlock(_ l: ShopLive) -> some View {
        ShopGate(title: "Orders and checkouts", section: l.recent) { (list: [ShopActivity]) in
            SiteBlock(title: "Orders and checkouts", note: "The last \(l.windowMinutes) minutes, newest first.") {
                if list.isEmpty {
                    Text("No orders or checkouts in the last \(l.windowMinutes) minutes.")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(list) { (a: ShopActivity) in
                        activityRow(a)
                    }
                }
            }
        }
    }

    private func activityRow(_ a: ShopActivity) -> some View {
        let items = a.items.map { (i: ShopActivity.Item) -> String in "\(i.title) \u{00D7}\(i.quantity)" }.joined(separator: ", ")
        let detail = [items, a.place].filter { (s: String) in !s.isEmpty }.joined(separator: " \u{00B7} ")
        return HStack(alignment: .top, spacing: pt(12)) {
            Image(systemName: a.kind == "order" ? "bag" : "cart")
                .foregroundStyle(.secondary)
                .frame(width: 22)
                .accessibilityHidden(true)
            AdaptiveStack(spacing: pt(8), alignment: .top) {
                VStack(alignment: .leading, spacing: pt(2)) {
                    Text(a.kind == "order" ? "Order " + a.label : a.label)
                    if !detail.isEmpty {
                        Text(detail).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: pt(2)) {
                    if let amount = a.amount {
                        Text(ShopWords.money(amount, a.currency)).monospacedDigit()
                    }
                    Text(ShopWords.ago(a.ago)).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Loading

    @ViewBuilder
    private var stateOverlay: some View {
        if live == nil, let problem {
            ErrorState(problem) { Task { await load() } }
        } else if live == nil {
            SkeletonPage(shape: .figures)
        }
    }

    /// A failed poll keeps what is on screen; the message shows only when there is nothing yet.
    private func load() async {
        do {
            let l = try await ERPAPI.shared.get("/api/website/shopify-analytics/live", as: ShopLive.self)
            Motion.run(reduce: reduceMotion) { live = l }
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            if live == nil { problem = error.localizedDescription }
        }
    }

    /// Every 60 seconds while the screen is visible and the app active; the task ends with either.
    private func poll() async {
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            await load()
            do { try await Task.sleep(for: .seconds(60)) } catch { return }
        }
    }
}
