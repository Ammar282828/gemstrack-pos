import SwiftUI
import Observation
import ERPCore

/// Home: the morning glance (src/app/page.tsx, redrawn 2026-09-27; docs/decisions.md "Dashboard"; on the
/// ledger since 2026-10-09). Today first, large: what was taken, how many invoices, the week as bars. Under it
/// three small cards say how the shop stands: this month against last, owed to you, on the bench. Then three
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
    /// At the largest text sizes the three cards stand one under another rather than squeezed side by side.
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The instant the page is worked out against; it turns over at Karachi's midnight on a screen left open.
    @State private var now = Date()
    /// "Set today's gold rate" opens the rate form here, for owners, rather than the ERP's page.
    @State private var rateSheet = false
    /// Online orders waiting to be confirmed, and whether selling waits on today's rate (the server says).
    private var inbox: OnlineInbox { .shared }

    var body: some View {
        ShelfState(loaded: ready, error: book.orders.error ?? book.invoices.error, offline: book.orders.offline) {
            page(makeFigures())
        }
        .navigationTitle(title)
        .onAppear { needAll() }
        .onChange(of: session.role) { _, _ in needAll() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                now = Date()
                Task { await askOnline() }
            }
        }
        .task { await keepTime() }
        // The count itself is polled once for the whole app (RootView); coming here asks again at once.
        .task { await askOnline() }
        .sheet(isPresented: $rateSheet) { RateSheet() }
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

    /// The web's heading: the shop's name.
    private var title: String {
        let name = book.settings.value?.shopName ?? ""
        return name.isEmpty ? "Dashboard" : name
    }

    // MARK: The page

    private func page(_ f: DashFigures) -> some View {
        // A house whose website does not sell has no online orders to confirm and no rate to pause on.
        let selling = session.shop.websiteSelling
        let needs = f.needs(onlineWaiting: selling ? inbox.waiting : 0, ratePause: selling ? inbox.ratePause : nil)
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    dateLine
                    hero(f)
                    stats(f)
                }
                needsSection(needs)
                dueSection(f)
                salesSection(f)
                monthSection(f)
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .background(Theme.ground.ignoresSafeArea())
    }

    /// "FRIDAY 9 OCTOBER", under the shop's name.
    private var dateLine: some View {
        Text(DashDate.dayLabel(now))
            .font(.caption.weight(.semibold))
            .tracking(0.8)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.horizontal, 4)
            .accessibilityLabel(DashDate.longDay(now))
    }

    // MARK: Today and the three cards

    @ViewBuilder
    private func linked<C: View>(_ path: String?, @ViewBuilder _ label: () -> C) -> some View {
        let content = label()
        if let path {
            NavigationLink(value: Route(path: path)) { content }.buttonStyle(.plain)
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

    @ViewBuilder
    private func stats(_ f: DashFigures) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(spacing: 10) { statCards(f) }
        } else {
            HStack(alignment: .top, spacing: 10) { statCards(f) }
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func statCards(_ f: DashFigures) -> some View {
        // Analytics and the hisaab are the owners' books.
        let monthPath: String? = session.isOwner ? "/analytics" : nil
        linked(monthPath) { thisMonth(f, linked: monthPath != nil) }
        linked(session.isOwner && f.owedInHisaab > 0 ? "/hisaab" : "/invoices") { owedCard(f) }
        linked("/workshop") { onTheBench(f) }
    }

    private func thisMonth(_ f: DashFigures, linked: Bool) -> some View {
        DashStat(label: "This month", linked: linked) {
            DashStatAmount(amount: f.monthRevenue)
            DashMonthChange(ratio: f.monthAgainstLast, now: now)
        }
    }

    /// Owed is amber, never red: money still to come is not an alarm.
    private func owedCard(_ f: DashFigures) -> some View {
        let owing = f.totalOutstanding > 0
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
            if critical > 0 {
                DashStatNote(text: "\(critical) sitting \(DashBench.criticalDays)+ days", tint: Tone.late.color)
            } else {
                DashStatNote(text: "Nothing overdue")
            }
        }
    }

    // MARK: The three lists

    private func needsSection(_ needs: [DashNeed]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Needs you", count: needs.count)
            Group {
                if needs.isEmpty {
                    DashAllClear()
                } else {
                    DashNeedList(needs: needs, onRates: session.isOwner ? { rateSheet = true } : nil)
                }
            }
            .dashRowsCard()
        }
    }

    private func dueSection(_ f: DashFigures) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Due to customers", count: f.due.count, allPath: "/orders", allLabel: "All orders")
            Group {
                if f.due.isEmpty {
                    DashEmpty(text: "No open orders or repairs.")
                } else {
                    DashRows(items: f.due, inset: DashDueRow.leaf + 12) { (d: DashDue) in DashDueRow(due: d) }
                }
            }
            .dashRowsCard()
        }
    }

    private func salesSection(_ f: DashFigures) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Recent sales", allPath: "/invoices", allLabel: "All invoices")
            Group {
                if f.recentInvoices.isEmpty {
                    DashEmpty(text: "No sales yet.")
                } else {
                    DashRows(items: f.recentInvoices, inset: DashSaleRow.monogram + 12) { (i: Invoice) in DashSaleRow(invoice: i) }
                }
            }
            .dashRowsCard()
        }
    }

    private func monthSection(_ f: DashFigures) -> some View {
        let path: String? = session.isOwner ? "/analytics" : nil
        return VStack(alignment: .leading, spacing: 8) {
            DashHeader(title: "Last 30 days")
            linked(path) {
                DashMonthCard(figures: f, showCosts: session.isOwner, linked: path != nil)
            }
        }
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
    static let shared = OnlineInbox()

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
