import SwiftUI
import Observation
import ERPCore

/// Home: the morning glance (src/app/page.tsx, redrawn 2026-09-27; docs/decisions.md "Dashboard"; on the
/// ledger since 2026-10-09). Today first, large: what was taken, how many invoices, the week as bars. Under it
/// two small cards say how the shop stands: owed to you, on the bench (this month is its own card). Then three
/// lists, each a thing the counter needs to know: what needs a decision (worst first, each led by what it is
/// about), what is due to customers (by the date they were promised, as a calendar leaf), and the latest
/// sales (who, and whether paid). The 30-day line sits quietly at the bottom. Nothing to press but the cards
/// and rows themselves; New sale is the app's bar.
///
/// Every figure is ERPCore's rule (DashboardFigures.swift gathers them, it re-derives none). The web
/// page has no role check, so staff see what the web shows them from the books they can read: no
/// hisaab, so Owed to you is invoices only; no expenses, so the 30-day line is revenue alone.
struct Dashboard: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    /// At the largest text sizes the cards stand one under another rather than squeezed side by side.
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The instant the page is worked out against; it turns over at Karachi's midnight on a screen left open.
    @State private var now = Date()
    /// "Set today's gold rate" opens the rate sheet here: the form for owners, the rates to read for anyone else.
    @State private var rateSheet = false
    @State private var noteSheet = false
    @State private var allNeeds = false
    @State private var allDue = false
    @State private var allSales = false
    /// The page's width: an iPad's wide window lays Home out in two columns.
    @State private var width: CGFloat = 0
    /// Online orders waiting to be confirmed, and whether selling waits on today's rate (the server says).
    private var inbox: OnlineInbox { .shared }

    var body: some View {
        ShelfState(loaded: ready, error: book.orders.error ?? book.invoices.error, offline: book.orders.offline) {
            #if os(macOS)
            macPage(makeFigures())
            #else
            page(makeFigures())
            #endif
        }
        .safeAreaInset(edge: .top, spacing: 0) { UpdateBanner() }
        .navigationTitle("Today")
        .onAppear { needAll() }
        .onChange(of: session.role) { _, _ in needAll() }
        .onChange(of: ready, initial: true) { _, isReady in if isReady { LaunchClock.finish("home") } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                now = Date()
                Task { await askOnline() }
            }
        }
        .task { await keepTime() }
        // The count itself is polled once for the whole app (RootView); coming here asks again at once.
        .task { await askOnline() }
        #if os(macOS)
        .sheet(isPresented: $rateSheet) { RateSheetHost().frame(minWidth: 540, minHeight: 520) }
        .sheet(isPresented: $noteSheet) { TeamNoteEditor().frame(minWidth: 520, minHeight: 360) }
        .navigationSubtitle(DashDate.longDay(now))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Today's rate", systemImage: "chart.line.uptrend.xyaxis") { rateSheet = true }
                    .help("Set or read today's gold rate")
                    .keyboardShortcut("r", modifiers: [.command, .option])
            }
            if session.isOwner {
                ToolbarItem(placement: .primaryAction) {
                    Button("Team note", systemImage: "pin") { noteSheet = true }
                        .help("Write the note the team sees on Home")
                        .keyboardShortcut("t", modifiers: [.command, .option])
                }
            }
        }
        #else
        .sheet(isPresented: $rateSheet) { RateSheetHost() }
        .sheet(isPresented: $noteSheet) { TeamNoteEditor() }
        .toolbar {
            if session.isOwner {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Team note", systemImage: "pin") { noteSheet = true }
                }
            }
        }
        #endif
    }

    // MARK: Shelves

    private func needAll() {
        book.orders.need()
        book.invoices.need()
        book.customers.need()
        book.karigars.need()
        book.karigarJobs.need()
        book.repairs.need()
        book.settings.need()
        // The shop's books are the owners'; staff have no hisaab, expenses or extra revenue to read.
        if session.isOwner {
            book.hisaab.need()
            book.expenses.need()
            book.revenue.need()
        }
    }

    /// Like the web, nothing is drawn until the books are in: a figure worked out from half of them would be wrong.
    private var ready: Bool {
        let core = book.orders.loaded && book.invoices.loaded && book.repairs.loaded
            && book.customers.loaded && book.karigars.loaded && book.karigarJobs.loaded
        if !session.isOwner { return core }
        return core && book.hisaab.loaded && book.expenses.loaded && book.revenue.loaded
    }

    /// Reckoned once per change of the books it reads (or of the minute), never per drawing: the timer,
    /// the online count and the rate chip redraw this screen far more often than the books change.
    @State private var figures = Memo<DashFigures>()

    private func makeFigures() -> DashFigures {
        let key = [book.orders.revision, book.invoices.revision, book.revenue.revision, book.expenses.revision,
                   book.karigars.revision, book.karigarJobs.revision, book.repairs.revision, book.customers.revision,
                   book.hisaab.revision, Int(now.timeIntervalSince1970 / 60)]
        return figures(key) { reckonFigures() }
    }

    private func reckonFigures() -> DashFigures {
        DashFigures(
            orders: book.orders.items, invoices: book.invoices.items,
            revenues: book.revenue.items, expenses: book.expenses.items,
            karigars: book.karigars.items, karigarJobs: book.karigarJobs.items,
            repairs: book.repairs.items, customers: book.customers.items,
            hisaab: book.hisaab.items, now: now)
    }

    // MARK: The page

    private func page(_ f: DashFigures) -> some View {
        // A house whose website does not sell has no online orders to confirm and no rate to pause on.
        let selling = session.shop.websiteSelling
        let needs = f.needs(onlineWaiting: selling ? inbox.waiting : 0, ratePause: selling ? inbox.ratePause : nil)
        let wide = width >= 820 && !typeSize.isAccessibilitySize
        return ScrollView {
            Group {
                if wide {
                    wideColumns(f, needs: needs)
                } else {
                    VStack(alignment: .leading, spacing: pt(22)) {
                        VStack(alignment: .leading, spacing: pt(12)) {
                            dateLine
                            hero(f)
                            figureGrid(f)
                        }
                        needsSection(needs)
                        dueSection(f)
                        salesSection(f)
                    }
                }
            }
            .padding(.horizontal, wide ? 28 : 16)
            .padding(.top, pt(4))
            .padding(.bottom, pt(24))
            // On the widest windows the page stays a page: the two columns never drift a room apart.
            .frame(maxWidth: wide ? 1480 : .infinity)
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .motion(needs.count)
    }

    /// An iPad's Home: today, the hero across the full width and the four figures in one row, then the three
    /// lists in columns: three from 1180 pt, else two, each list dealt to the shorter column so they balance.
    private func wideColumns(_ f: DashFigures, needs: [DashNeed]) -> some View {
        VStack(alignment: .leading, spacing: pt(26)) {
            VStack(alignment: .leading, spacing: pt(12)) {
                dateLine
                hero(f)
                wideFigureRow(f)
            }
            let lists = wideLists(f, needs: needs)
            HStack(alignment: .top, spacing: pt(24)) {
                ForEach(lists.indices, id: \.self) { (c: Int) in
                    VStack(alignment: .leading, spacing: pt(22)) {
                        ForEach(lists[c], id: \.self) { (l: HomeList) in wideList(l, f, needs: needs) }
                    }
                    .frame(maxWidth: .infinity, alignment: .top)
                }
            }
        }
    }

    private enum HomeList: Hashable { case needs, due, sales }

    private func wideFigureRow(_ f: DashFigures) -> some View {
        HStack(alignment: .top, spacing: pt(10)) {
            owedTile(f); benchTile(f); monthTile(f); dueTile(f)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func wideList(_ l: HomeList, _ f: DashFigures, needs: [DashNeed]) -> some View {
        switch l {
        case .needs: needsSection(needs)
        case .due: dueSection(f)
        case .sales: salesSection(f)
        }
    }

    /// Lists in the order the page reads (needs, due, sales), each given to the column with the fewer rows so far.
    private func wideLists(_ f: DashFigures, needs: [DashNeed]) -> [[HomeList]] {
        func rows(_ n: Int, _ all: Bool) -> Int { n == 0 ? 2 : 2 + (all ? n : min(n, 3)) }
        let weights: [(HomeList, Int)] = [
            (.needs, needs.isEmpty ? 0 : rows(needs.count, allNeeds)),
            (.due, rows(f.due.count, allDue)),
            (.sales, rows(f.recentInvoices.count, allSales)),
        ]
        let count = width >= 1180 ? 3 : 2
        var cols = Array(repeating: [HomeList](), count: count)
        var load = Array(repeating: 0, count: count)
        for (l, w) in weights {
            let i = load.indices.min { load[$0] < load[$1] } ?? 0
            cols[i].append(l)
            load[i] += w
        }
        return cols.filter { !$0.isEmpty }
    }

    /// "TUESDAY 21 OCTOBER", a quiet line above the hero.
    private var dateLine: some View {
        Text(DashDate.dayLabel(now))
            .font(.caption.weight(.semibold))
            .tracking(0.8)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.horizontal, pt(4))
            .accessibilityLabel(DashDate.longDay(now))
    }

    // MARK: Today and the two cards

    @ViewBuilder
    private func linked<C: View>(_ path: String?, @ViewBuilder _ label: () -> C) -> some View {
        let content = label()
        if let path {
            NavigationLink(value: Route(path: path)) { content }.buttonStyle(.plain).pointerHover()
        } else {
            content
        }
    }

    /// Taken today, as the web's headline links it: the invoices.
    private func hero(_ f: DashFigures) -> some View {
        linked("/invoices") {
            DashHero(amount: f.todayRevenue, invoices: f.todayInvoiceCount,
                     lastSale: f.lastSaleToday.map { DashDate.clock(iso: $0.createdAt) },
                     week: f.week, linked: true)
        }
    }

    /// The four figures, always showing: two by two, one under another at accessibility sizes.
    @ViewBuilder
    private func figureGrid(_ f: DashFigures) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(spacing: pt(10)) {
                owedTile(f)
                benchTile(f)
                monthTile(f)
                dueTile(f)
            }
        } else {
            VStack(spacing: pt(10)) {
                HStack(alignment: .top, spacing: pt(10)) { owedTile(f); benchTile(f) }
                    .fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .top, spacing: pt(10)) { monthTile(f); dueTile(f) }
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func owedTile(_ f: DashFigures) -> some View {
        // The hisaab is the owners' book.
        linked(session.isOwner && f.owedInHisaab > 0 ? "/hisaab" : "/invoices") { owedCard(f) }
    }

    private func benchTile(_ f: DashFigures) -> some View {
        linked("/workshop") { onTheBench(f) }
    }

    /// This month's takings against last (the old This month card, now a tile; the detail is Analytics).
    private func monthTile(_ f: DashFigures) -> some View {
        linked(session.isOwner ? "/analytics" : nil) {
            DashStat(label: "This month", linked: session.isOwner) {
                DashStatAmount(amount: f.revenueMonth)
                DashMonthChange(ratio: f.monthAgainstLast, now: f.now)
            }
        }
    }

    /// Orders and repairs promised to customers; red only for the late ones. (Their totals are not what is left to
    /// collect, so no sum is shown here: Owed to you says that.)
    private func dueTile(_ f: DashFigures) -> some View {
        let n = f.due.count
        let late = f.due.filter { $0.isLate }.count
        return linked("/orders") {
            DashStat(label: "Orders due", linked: true) {
                DashStatValue(text: n == 0 ? "None" : "\(n) open")
                if late > 0 { DashStatNote(text: "\(late) late", tint: Tone.late.color) }
            }
        }
    }

    /// Owed is amber, never red: money still to come is not an alarm.
    private func owedCard(_ f: DashFigures) -> some View {
        let owing = f.totalOutstanding >= 1
        let n = f.unpaid.count
        return DashStat(label: "Owed to you", linked: true) {
            if owing {
                DashStatAmount(amount: f.totalOutstanding, tint: Tone.owed.color)
            } else {
                DashStatValue(text: "Nil")
            }
            DashStatNote(text: "\(n) unpaid")
            if f.owedInHisaab > 0 {
                DashStatNote(text: "\(Money.lacCrore(f.owedInHisaab)) in hisaab", tint: Color.secondary)
            }
        }
    }

    private func onTheBench(_ f: DashFigures) -> some View {
        let n = f.activeJobs
        let critical = f.criticalJobs.count
        return DashStat(label: "On the bench", linked: true) {
            DashStatValue(text: "\(n) piece\(n == 1 ? "" : "s")")
            // Nothing overdue is the normal state: no line for it.
            if critical > 0 {
                DashStatNote(text: "\(critical) sitting \(DashBench.criticalDays)+ days", tint: Tone.late.color)
            }
        }
    }

    // MARK: The three lists

    /// Nothing needing anyone: no section, no empty card.
    @ViewBuilder
    private func needsSection(_ needs: [DashNeed]) -> some View {
        if !needs.isEmpty { needsCard(needs) }
    }

    private func needsCard(_ needs: [DashNeed]) -> some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            DashHeader(title: "Needs you", count: needs.count)
            DashNeedList(needs: allNeeds ? needs : Array(needs.prefix(3)), onRates: { rateSheet = true })
                .dashRowsCard()
            if needs.count > 3 { reveal($allNeeds, count: needs.count - 3) }
        }
        .motion(allNeeds)
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func dueSection(_ f: DashFigures) -> some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            DashHeader(title: "Due to customers", count: f.due.count, allPath: "/orders", allLabel: "All orders")
            Group {
                if f.due.isEmpty {
                    DashEmpty(text: "No open orders or repairs.")
                } else {
                    DashRows(items: allDue ? f.due : Array(f.due.prefix(3)), inset: DashDueRow.leaf + 12) { (d: DashDue) in DashDueRow(due: d) }
                }
            }
            .dashRowsCard()
            if f.due.count > 3 { reveal($allDue, count: f.due.count - 3) }
        }
        .motion(allDue)
    }

    private func salesSection(_ f: DashFigures) -> some View {
        VStack(alignment: .leading, spacing: pt(8)) {
            DashHeader(title: "Recent sales", allPath: "/invoices", allLabel: "All invoices")
            Group {
                if f.recentInvoices.isEmpty {
                    DashEmpty(text: "No sales yet.")
                } else {
                    DashRows(items: allSales ? f.recentInvoices : Array(f.recentInvoices.prefix(3)), inset: DashSaleRow.monogram + 12) { (i: Invoice) in DashSaleRow(invoice: i) }
                }
            }
            .dashRowsCard()
            if f.recentInvoices.count > 3 { reveal($allSales, count: f.recentInvoices.count - 3) }
        }
        .motion(allSales)
    }

    private func reveal(_ expanded: Binding<Bool>, count: Int) -> some View {
        Button(expanded.wrappedValue ? "Show less" : "Show \(count) more") {
            Motion.run(expanded.wrappedValue ? Motion.exit : Motion.enter, reduce: reduceMotion) { expanded.wrappedValue.toggle() }
        }
        .font(.subheadline.weight(.medium)).frame(minHeight: Metrics.tap).padding(.horizontal, pt(4))
    }

    // MARK: Time and the server

    /// Each minute, so the day turns over at Karachi's midnight.
    private func keepTime() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            now = Date()
        }
    }

    /// Ask the server for the online-orders count now, in a house whose website sells (the web's
    /// sidebar asks the same way on focus).
    private func askOnline() async {
        if session.shop.websiteSelling { await inbox.refresh() }
    }
}

/// Online orders waiting to be confirmed, and whether selling waits on today's rate (/api/website/online?count=1),
/// as the web's sidebar polls them every two minutes (lib/website/online-client.ts: one poll serves the
/// sidebar and the dashboard). One loop for the whole app, run by RootView; the dashboard's "Needs you"
/// and the Orders tab's badge both read it. A house that does not sell online answers zero; the demo and a
/// dropped connection leave what is shown.
@MainActor
@Observable
final class OnlineInbox {
    /// Replaced, not cleared, when the person switches business (Businesses.switch): none of it is the next one's.
    static var shared = OnlineInbox()
    static func reset() { shared = OnlineInbox() }

    private(set) var waiting = 0
    private(set) var ratePause: DashRatePause?
    @ObservationIgnored private var asking = false

    /// Ask now, then every two minutes, until the task is cancelled.
    func keep() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(120))
        }
    }

    /// One question at a time: a second ask while one is out is the same answer.
    func refresh() async {
        guard !asking else { return }
        asking = true
        defer { asking = false }
        guard let data = try? await ERPAPI.shared.data("/api/website/online?count=1"),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let count = (json["waiting"] as? Int) ?? 0
        let pause: DashRatePause? = (json["pausedForRates"] as? Bool) == true
            ? DashRatePause(ratesUpdatedAt: json["ratesUpdatedAt"] as? String) : nil
        if waiting != count { waiting = count }
        if ratePause != pause { ratePause = pause }
    }
}

// MARK: - The Mac

#if os(macOS)
extension Dashboard {
    /// The Mac's Home: the day's figures across the window in one Grid (today large, the four cards beside it), and
    /// under them Needs you, Due to customers and Recent sales as panels side by side. Every row opens on a click and
    /// has a right-click menu (Open, Open in New Window). The figures and rows are the iPhone's own.
    fileprivate func macPage(_ f: DashFigures) -> some View {
        let selling = session.shop.websiteSelling
        let needs = f.needs(onlineWaiting: selling ? inbox.waiting : 0, ratePause: selling ? inbox.ratePause : nil)
        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                macFigures(f)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 22, alignment: .top)],
                          alignment: .leading, spacing: 22) {
                    if !needs.isEmpty { macNeeds(needs) }
                    macDue(f)
                    macSales(f)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 20)
            .frame(maxWidth: 1600)
            .frame(maxWidth: .infinity)
        }
        .motion(needs.count)
    }

    /// Today large and the four cards in one row when the window is wide; else today above a row of four.
    private func macFigures(_ f: DashFigures) -> some View {
        ViewThatFits(in: .horizontal) {
            Grid(alignment: .top, horizontalSpacing: 12, verticalSpacing: 12) {
                GridRow {
                    hero(f).gridCellColumns(2).frame(maxWidth: .infinity, maxHeight: .infinity)
                    macTiles(f)
                }
            }
            .frame(minWidth: 1000)
            VStack(alignment: .leading, spacing: 12) {
                hero(f)
                Grid(alignment: .top, horizontalSpacing: 12, verticalSpacing: 12) {
                    GridRow { macTiles(f) }
                }
            }
        }
    }

    @ViewBuilder
    private func macTiles(_ f: DashFigures) -> some View {
        owedTile(f).frame(maxWidth: .infinity, maxHeight: .infinity)
        benchTile(f).frame(maxWidth: .infinity, maxHeight: .infinity)
        monthTile(f).frame(maxWidth: .infinity, maxHeight: .infinity)
        dueTile(f).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private static var macShown: Int { 8 }

    private func macNeeds(_ needs: [DashNeed]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Needs you", count: needs.count)
            DashRows(items: allNeeds ? needs : Array(needs.prefix(Self.macShown)), inset: 42) { (n: DashNeed) in
                DashNeedRow(need: n, onRates: { rateSheet = true }).macOpenMenu(n.opensRates ? nil : n.path)
            }
            .dashRowsCard()
            if needs.count > Self.macShown { MacRevealButton(expanded: $allNeeds, count: needs.count - Self.macShown) }
        }
    }

    private func macDue(_ f: DashFigures) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Due to customers", count: f.due.count, allPath: "/orders", allLabel: "All orders")
            Group {
                if f.due.isEmpty {
                    DashEmpty(text: "No open orders or repairs.")
                } else {
                    DashRows(items: allDue ? f.due : Array(f.due.prefix(Self.macShown)), inset: DashDueRow.leaf + 12) { (d: DashDue) in
                        DashDueRow(due: d).macOpenMenu(d.path)
                    }
                }
            }
            .dashRowsCard()
            if f.due.count > Self.macShown { MacRevealButton(expanded: $allDue, count: f.due.count - Self.macShown) }
        }
    }

    private func macSales(_ f: DashFigures) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Recent sales", allPath: "/invoices", allLabel: "All invoices")
            Group {
                if f.recentInvoices.isEmpty {
                    DashEmpty(text: "No sales yet.")
                } else {
                    DashRows(items: allSales ? f.recentInvoices : Array(f.recentInvoices.prefix(Self.macShown)), inset: DashSaleRow.monogram + 12) { (i: Invoice) in
                        DashSaleRow(invoice: i).macOpenMenu(DashPath.invoice(i.id))
                    }
                }
            }
            .dashRowsCard()
            if f.recentInvoices.count > Self.macShown { MacRevealButton(expanded: $allSales, count: f.recentInvoices.count - Self.macShown) }
        }
    }
}
#endif
