import SwiftUI
import Observation
import ERPCore

/// Home: the morning glance (src/app/page.tsx, redrawn 2026-09-27; docs/decisions.md "Dashboard").
/// Four figures say how the shop stands: taken today, this month against last, owed to you, on the
/// bench. Then three lists, each a thing the counter needs to know: what needs a decision (worst
/// first), what is due to customers (by the date they were promised), and the latest sales. The
/// 30-day line sits quietly at the bottom. Nothing to press but the rows themselves; New sale is
/// the app's bar.
///
/// Every figure is ERPCore's rule (DashboardFigures.swift gathers them, it re-derives none). The web
/// page has no role check, so staff see what the web shows them from the books they can read: no
/// hisaab, so Owed to you is invoices only; no expenses, so the 30-day line is revenue alone.
struct Dashboard: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    /// The instant the page is worked out against; it turns over at Karachi's midnight on a screen left open.
    @State private var now = Date()
    /// "Set today's gold rate" opens the rate form here, for owners, rather than the ERP's page.
    @State private var rateSheet = false
    /// Online orders waiting to be confirmed, and whether selling waits on today's rate (the server says).
    private var inbox: OnlineInbox { .shared }

    private static let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

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
            VStack(alignment: .leading, spacing: 16) {
                Text(DashDate.longDay(now)).font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 4)
                tiles(f)
                needsSection(needs)
                dueSection(f)
                salesSection(f)
                monthStrip(f)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    // MARK: The four figures

    private func tiles(_ f: DashFigures) -> some View {
        LazyVGrid(columns: Self.columns, spacing: 10) {
            linked("/invoices") { takenToday(f) }
            // Analytics and the hisaab are the owners' books.
            linked(session.isOwner ? "/analytics" : nil) { thisMonth(f) }
            linked(session.isOwner && f.owedInHisaab > 0 ? "/hisaab" : "/invoices") { owedTile(f) }
            linked("/workshop") { onTheBench(f) }
        }
    }

    @ViewBuilder
    private func linked<C: View>(_ path: String?, @ViewBuilder _ label: () -> C) -> some View {
        let content = label()
        if let path {
            NavigationLink(value: Route(path: path)) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }

    private func takenToday(_ f: DashFigures) -> some View {
        let n = f.todayInvoiceCount
        return FigureTile(label: "Taken today", value: Money.pkrLac(f.todayRevenue),
                          detail: "\(n) invoice\(n == 1 ? "" : "s") today",
                          tint: f.todayRevenue > 0 ? .green : .primary)
    }

    private func thisMonth(_ f: DashFigures) -> some View {
        let detail = f.lastMonthRevenue > 0 ? "Last month \(Money.pkrLac(f.lastMonthRevenue))" : DashDate.monthName(now)
        return FigureTile(label: "This month", value: Money.pkrLac(f.monthRevenue), detail: detail)
    }

    private func owedTile(_ f: DashFigures) -> some View {
        let owing = f.totalOutstanding > 0
        var detail = "\(f.unpaid.count) unpaid"
        if f.owedInHisaab > 0 { detail += " · \(Money.lacCrore(f.owedInHisaab)) hisaab" }
        return FigureTile(label: "Owed to you", value: owing ? Money.pkrLac(f.totalOutstanding) : "Nil",
                          detail: detail, tint: owing ? .red : .primary)
    }

    private func onTheBench(_ f: DashFigures) -> some View {
        let n = f.activeJobs
        let critical = f.criticalJobs.count
        return FigureTile(label: "On the bench", value: "\(n) piece\(n == 1 ? "" : "s")",
                          detail: critical > 0 ? "\(critical) sitting \(DashBench.criticalDays)+ days" : "Nothing overdue",
                          tint: critical > 0 ? .red : .primary)
    }

    // MARK: The three lists

    private func needsSection(_ needs: [DashNeed]) -> some View {
        DashSection(title: "Needs you", symbol: "exclamationmark.triangle",
                    symbolTint: needs.isEmpty ? Color.secondary : Color.red, count: needs.count) {
            if needs.isEmpty {
                DashEmpty(text: "Nothing late, unpaid or waiting.", symbol: "checkmark.circle")
            } else {
                DashRows(items: needs) { (n: DashNeed) in
                    DashNeedRow(need: n, onRates: session.isOwner ? { rateSheet = true } : nil)
                }
            }
        }
    }

    private func dueSection(_ f: DashFigures) -> some View {
        DashSection(title: "Due to customers", symbol: "calendar.badge.clock", count: f.due.count, allPath: "/orders") {
            if f.due.isEmpty {
                DashEmpty(text: "No open orders or repairs.")
            } else {
                DashRows(items: f.due) { (d: DashDue) in DashDueRow(due: d) }
            }
        }
    }

    private func salesSection(_ f: DashFigures) -> some View {
        DashSection(title: "Recent sales", symbol: "receipt", allPath: "/invoices") {
            if f.recentInvoices.isEmpty {
                DashEmpty(text: "No sales yet.")
            } else {
                DashRows(items: f.recentInvoices) { (i: Invoice) in DashSaleRow(invoice: i) }
            }
        }
    }

    private func monthStrip(_ f: DashFigures) -> some View {
        linked(session.isOwner ? "/analytics" : nil) {
            DashMonthStrip(figures: f, showCosts: session.isOwner)
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
