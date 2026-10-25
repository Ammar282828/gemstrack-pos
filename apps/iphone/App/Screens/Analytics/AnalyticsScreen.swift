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
    /// The books and figures, worked out once per change of the books, the period or the day, not once per drawing
    /// (coming back to the app or a window coming forward redraws this screen).
    @State private var reckoned = Memo<(AnaBooks, AnaFigures)>()

    var body: some View {
        if session.isOwner { owners } else {
            NotAvailableState("Owners only", why: "Analytics are worked out from the owners’ books.").navigationTitle(section.title)
        }
    }

    private var owners: some View {
        titled(ShelfState(loaded: ready, error: firstError, offline: book.invoices.offline) {
            pages()
        })
        .navigationTitle(section.title)
        .onAppear { needAll() }
        .onChange(of: session.role) { _, _ in needAll() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { turnOver() }
        }
        .task { await keepTime() }
    }

    /// The Overview is the hub (large title); the four tabs drilled into from it are inline.
    @ViewBuilder private func titled<V: View>(_ view: V) -> some View {
        if section == .overview { view.hubTitleDisplay() } else { view.navigationBarTitleDisplayMode(.inline) }
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
        // Extra revenue counts in Revenue, Est. profit and Cash in: a failed read must not quietly lower them.
        return book.expenses.error ?? book.revenue.error
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
        // Margin is worked out for owners alone; a customer or a staff account never sees it.
        let margin: MarginSettings? = isOwner ? House.margin : nil
        let key = [book.invoices.revision, book.orders.revision, book.products.revision, book.customers.revision,
                   book.expenses.revision, book.revenue.revision, isOwner ? 1 : 0, rangeKey.hashValue, customFrom.hashValue,
                   customTo.hashValue, Int(now.timeIntervalSince1970 / 60), book.settings.revision]
        let (books, figures) = reckoned(key) {
            let live = book.customers.items.filter { (c: Customer) -> Bool in (c.deletedAt ?? "").isEmpty }
            let books = AnaBooks(
                invoices: book.invoices.items,
                orders: book.orders.items,
                products: book.products.items,
                customers: live,
                expenses: isOwner ? book.expenses.items : [],
                extraRevenue: isOwner ? book.revenue.items : []
            )
            return (books, AnaFigures(books, range: period.range, margin: margin))
        }
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

    #if os(macOS)
    @State private var macCustom = false
    #endif

    var body: some View {
        #if os(macOS)
        macBody
        #else
        if let kind = empty {
            AnaEmptyPage(kind: kind, bar: bar)
        } else {
            page
        }
        #endif
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
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
        List { Group {
            Section {
                bar
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            Section {
                switch kind {
                case .nothingInRange:
                    NotAvailableState("Nothing in this range", why: "There are no invoices or orders in the selected period. Pick another period to see more.",
                                      symbol: "chart.bar")
                case .noData:
                    NotAvailableState("No data yet", why: "There is no data available to generate analytics yet.",
                                      symbol: "chart.bar")
                }
            }
            .listRowBackground(Color.clear)
        }.houseRows()
        }
        .listStyle(.insetGrouped)
    }
}

// MARK: - The Mac

#if os(macOS)
extension AnaPages {
    /// A wide report. The tab and the period are the window's toolbar, not rows of chips: a menu of the five tabs, and
    /// the period as a pop-up with the quick ranges and "Custom period…". The period reads under the title.
    @ViewBuilder
    fileprivate var macBody: some View {
        Group {
            if let kind = empty {
                AnaEmptyPage(kind: kind, bar: bar)
            } else {
                page
            }
        }
        .navigationSubtitle(AnaPeriod.describe(period.range))
        .toolbar {
            ToolbarItem(placement: .principal) {
                Menu {
                    ForEach(AnaSection.macTabs, id: \.path) { tab in
                        NavigationLink(value: Route(path: tab.path)) {
                            Label(tab.name, systemImage: tab.section == section ? "checkmark" : "chart.bar")
                        }
                    }
                } label: {
                    Label(section == .overview ? "Overview" : section.title, systemImage: "chart.bar.xaxis")
                }
                .help("Switch between Overview, Sales, Products, Customers and Categories")
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Period", selection: $rangeKey) {
                        ForEach(AnaPeriod.quick) { (q: AnaPeriod.Quick) in Text(q.label).tag(q.key) }
                    }
                    .pickerStyle(.inline)
                    Divider()
                    Button("Custom period…") { macCustom = true }
                } label: {
                    Label(period.key == "custom" ? "Custom" : (AnaPeriod.quick.first { $0.key == period.key }?.label ?? "Period"),
                          systemImage: "calendar")
                }
                .help("The period every Analytics tab reads")
            }
        }
        .sheet(isPresented: $macCustom) {
            AnaCustomPeriod(start: period.range?.from ?? AnaDate.adding(days: -29, to: Date()),
                            end: period.range?.to ?? Date()) { (a: Date, b: Date) in
                customFrom = AnaDate.dayKey(a)
                customTo = AnaDate.dayKey(b)
                rangeKey = "custom"
            }
        }
    }
}

extension AnaEmptyPage {
    /// Nothing to report: one calm message in the middle of the window (the period is in the toolbar).
    @ViewBuilder
    fileprivate var macBody: some View {
        Group {
            switch kind {
            case .nothingInRange:
                NotAvailableState("Nothing in this range", why: "There are no invoices or orders in the selected period. Pick another period from the toolbar.",
                                  symbol: "chart.bar")
            case .noData:
                NotAvailableState("No data yet", why: "There is no data available to generate analytics yet.",
                                  symbol: "chart.bar")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
