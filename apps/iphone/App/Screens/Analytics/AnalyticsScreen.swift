import SwiftUI
import ERPCore

/// The five tabs of Analytics (lib/nav.ts: one entry, so the title menu switches between them).
enum AnaSection {
    case overview, sales, products, customers, categories

    /// The tab's own heading: the Overview is "Analytics", as on the web.
    var title: String {
        switch self {
        case .overview: return "Analytics"
        case .sales: return "Sales"
        case .products: return "Products"
        case .customers: return "Customers"
        case .categories: return "Categories"
        }
    }
}

/// Analytics (src/components/analytics/analytics-view.tsx), one screen per address over the same books
/// and the same period. The period is the web's picker, kept on this phone in
/// `@AppStorage("erp.analytics.range")` (and `erp.analytics.from` / `.to` for a custom one), so every
/// tab reads the same one.
///
/// Owners only, as lib/roles.ts has it ("staff: … no analytics"): the web hides it from staff's menu, and
/// here a staff or marketing account reaching it by a link sees one line and reads nothing. (The
/// staff-side branches below stay correct should that ever change.)
///
/// Like the web, nothing is drawn until the books are in: a figure worked out from half of them would
/// be wrong.
struct AnalyticsScreen: View {
    let section: AnaSection

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("erp.analytics.range") private var rangeKey = AnaPeriod.defaultKey
    @AppStorage("erp.analytics.from") private var customFrom = ""
    @AppStorage("erp.analytics.to") private var customTo = ""

    /// The instant the period is worked out against; it turns over at Karachi's midnight on a screen left open.
    @State private var now = Date()

    var body: some View {
        if session.isOwner { owners } else {
            ContentUnavailableView("Owners only", systemImage: "lock").navigationTitle(section.title)
        }
    }

    private var owners: some View {
        ShelfState(loaded: ready, error: firstError, offline: book.invoices.offline) {
            pages()
        }
        .navigationTitle(section.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { needAll() }
        .onChange(of: session.role) { _, _ in needAll() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { turnOver() }
        }
        .task { await keepTime() }
    }

    // MARK: Shelves

    private func needAll() {
        book.invoices.need()
        book.orders.need()
        book.products.need()
        book.customers.need()
        // Expenses and extra revenue are the owners' books; staff have none to read.
        if session.isOwner {
            book.expenses.need()
            book.revenue.need()
        }
    }

    private var ready: Bool {
        let core = book.invoices.loaded && book.orders.loaded && book.products.loaded && book.customers.loaded
        if !session.isOwner { return core }
        return core && book.expenses.loaded && book.revenue.loaded
    }

    private var firstError: String? {
        let core = book.invoices.error ?? book.orders.error ?? book.products.error ?? book.customers.error
        if core != nil || !session.isOwner { return core }
        return book.expenses.error
    }

    // MARK: Time

    /// A rolling period ends today: re-read it when the day turns on a screen left open.
    private func turnOver() {
        let next = Date()
        if !AnaDate.karachi.isDate(now, inSameDayAs: next) { now = next }
    }

    private func keepTime() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            turnOver()
        }
    }

    // MARK: The pages

    private func pages() -> some View {
        let isOwner = session.isOwner
        let period = AnaPeriod.read(key: rangeKey, from: customFrom, to: customTo, now: now)
        let live = book.customers.items.filter { (c: Customer) -> Bool in (c.deletedAt ?? "").isEmpty }
        let books = AnaBooks(
            invoices: book.invoices.items,
            orders: book.orders.items,
            products: book.products.items,
            customers: live,
            expenses: isOwner ? book.expenses.items : [],
            extraRevenue: isOwner ? book.revenue.items : []
        )
        // Margin is worked out for owners alone; a customer or a staff account never sees it.
        let margin: MarginSettings? = isOwner ? House.margin : nil
        let figures = AnaFigures(books, range: period.range, margin: margin)
        return AnaPages(section: section, books: books, figures: figures, period: period, margin: margin,
                        rangeKey: $rangeKey, customFrom: $customFrom, customTo: $customTo)
    }
}

/// What a tab shows when there is nothing to show.
enum AnaEmptyKind {
    case nothingInRange, noData
}

/// One tab's page, chosen by section. Everything heavy is worked out here, once per change of the
/// books or the period, so typing in a search box only filters rows that are already made.
struct AnaPages: View {
    let section: AnaSection
    let books: AnaBooks
    let figures: AnaFigures
    let period: AnaPeriodState
    let margin: MarginSettings?
    @Binding var rangeKey: String
    @Binding var customFrom: String
    @Binding var customTo: String

    private var showCosts: Bool { margin != nil }

    private var bar: AnaPeriodBar {
        AnaPeriodBar(key: $rangeKey, from: $customFrom, to: $customTo, state: period)
    }

    private var empty: AnaEmptyKind? {
        if period.range != nil && figures.invoicesInRange == 0 && figures.ordersInRange == 0 { return .nothingInRange }
        if books.invoices.isEmpty && books.orders.isEmpty && books.expenses.isEmpty { return .noData }
        return nil
    }

    var body: some View {
        if let kind = empty {
            AnaEmptyPage(kind: kind, bar: bar)
        } else {
            page
        }
    }

    @ViewBuilder private var page: some View {
        switch section {
        case .overview:
            AnaOverviewPage(figures: figures, bar: bar, showCosts: showCosts)
        case .sales:
            AnaSalesPage(figures: figures, history: AnaHistory(books, margin: margin), bar: bar, showCosts: showCosts) { (key: String) in
                rangeKey = key
            }
        case .products:
            AnaProductsPage(figures: figures, rows: AnaBreakdown.products(books, range: period.range), bar: bar)
        case .customers:
            AnaCustomersPage(figures: figures, rows: AnaBreakdown.customers(books, range: period.range), bar: bar)
        case .categories:
            AnaCategoriesPage(rows: AnaBreakdown.categories(books, range: period.range), bar: bar)
        }
    }
}

/// "Nothing in this range" and "No data yet", under the period chips so the period can be changed.
struct AnaEmptyPage: View {
    let kind: AnaEmptyKind
    let bar: AnaPeriodBar

    var body: some View {
        List {
            Section {
                bar
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            Section {
                switch kind {
                case .nothingInRange:
                    ContentUnavailableView("Nothing in this range", systemImage: "chart.bar",
                                           description: Text("There are no invoices or orders in the selected period. Pick another period to see more."))
                case .noData:
                    ContentUnavailableView("No data yet", systemImage: "chart.bar",
                                           description: Text("There is no data available to generate analytics yet."))
                }
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
    }
}
