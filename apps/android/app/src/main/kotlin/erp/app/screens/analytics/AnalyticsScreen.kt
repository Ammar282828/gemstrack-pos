package erp.app.screens.analytics

import erp.app.ui.SkeletonShape
import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.ScreenTitle
import erp.app.ui.AppClock
import erp.app.ui.NotAvailableState
import erp.app.ui.ShelfState
import erp.app.ui.SkeletonLoading
import erp.core.logic.Books
import erp.core.logic.BooksInput
import erp.core.logic.BooksOptions
import erp.core.logic.MarginSettings
import erp.core.logic.Period
import erp.core.logic.monthlyRevenue
import erp.core.logic.monthlySeries
import erp.core.logic.previousPeriod
import erp.core.logic.yearlySummary
import erp.core.models.MetalType
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * The tabs of Analytics (lib/nav.ts: one entry, so the title menu switches between them), in the menu's order. The
 * redesign of 2026-11-05 added Profit, Cash, Spending and the house's metal (Gold / Silver).
 */
enum class AnaSection(val title: String) {
    /** The Overview is "Analytics", as on the web. */
    overview("Analytics"),
    sales("Sales"),
    profit("Profit"),
    cash("Cash"),
    spending("Spending"),
    products("Products"),
    customers("Customers"),
    categories("Categories"),
    metal("Metal sold"),
    ;

    /** What the title bar says: the metal page is "Gold sold" or "Silver sold" (the nav's `heading`). */
    val heading: String get() = if (this == metal) erp.app.config.House.metal.replaceFirstChar { it.uppercase() } + " sold" else title
}

/**
 * Analytics (src/components/analytics/analytics-view.tsx), one screen per address over the same books and the same
 * period. Owners only, as lib/roles.ts has it ("staff: … no analytics"): the web hides it from staff's menu, and here a
 * staff or marketing account reaching it by a link sees one line and reads nothing. (The staff-side branches below stay
 * correct should that ever change.)
 *
 * Like the web, nothing is drawn until the books are in: a figure worked out from half of them would be wrong.
 */
@Composable
fun AnalyticsScreen(section: AnaSection) {
    if (!LocalSession.current.isOwner) {
        ScreenTitle(section.heading)
        NotAvailableState("Owners only")
        return
    }
    AnalyticsBoard(section)
}

@Composable
private fun AnalyticsBoard(section: AnaSection) {
    val book = LocalBook.current
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val products = rememberShelfStatus(book.products)
    val customers = rememberShelfStatus(book.customers)
    // Expenses and extra revenue are the owners' books; staff have none to read.
    val expenses = rememberShelfStatus(book.expenses)
    val revenue = rememberShelfStatus(book.revenue)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    ScreenTitle(section.heading)

    val loaded = invoices.loaded && orders.loaded && products.loaded && customers.loaded && expenses.loaded && revenue.loaded
    // Extra revenue counts in Revenue, Est. profit and Cash in: a failed read must not quietly lower them.
    val error = invoices.error ?: orders.error ?: products.error ?: customers.error ?: expenses.error ?: revenue.error

    // The instant the period is worked out against; it turns over at Karachi's midnight on a screen left open.
    var now by remember { mutableStateOf(AppClock.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            val next = AppClock.now()
            if (AnaDate.dayKey(now) != AnaDate.dayKey(next)) now = next
        }
    }

    ShelfState(shape = erp.app.ui.SkeletonShape.Chart, loaded = loaded, error = error, offline = invoices.offline, connectionLost = connectionLost) {
        val period = AnaPeriod.read(AnaPeriodStore.key, AnaPeriodStore.from, AnaPeriodStore.to, now)
        // Margin is worked out for owners alone; a customer or a staff account never sees it.
        val margin = erp.app.config.House.margin
        // The goods a house files as expenses, which net profit does not take off again (Business.goodsExpenseCategories).
        val goods = erp.app.config.House.goodsExpenseCategories
        val data by produceState<AnaPageData?>(
            null, section, period, invoices.revision, orders.revision, products.revision, customers.revision, expenses.revision, revenue.revision,
        ) {
            val live = customers.items.filter { (it.deletedAt ?: "").isEmpty() }
            val books = AnaBooks(invoices.items, orders.items, products.items, live, expenses.items, revenue.items)
            value = withContext(Dispatchers.Default) { AnaPageData.of(section, books, period, margin, goods, now) }
        }
        val d = data
        if (d == null) SkeletonLoading(Modifier.fillMaxSize(), shape = SkeletonShape.Chart) else AnaPages(section, d)
    }
}

/** Everything one tab shows, worked out once per change of the books or the period, off the main thread. */
class AnaPageData(
    val books: AnaBooks,
    val period: AnaPeriodState,
    val margin: MarginSettings?,
    val figures: AnaFigures,
    val productRows: List<AnaBreakdown.ProductRow>,
    val customerRows: List<AnaBreakdown.CustomerRow>,
    val categoryRows: List<AnaBreakdown.CategoryRow>,
    /** The redesign's books (core `Books`): this period, the one before, and the months. */
    val ledger: AnaLedger,
) {
    companion object {
        fun of(
            section: AnaSection, books: AnaBooks, period: AnaPeriodState, margin: MarginSettings?, goods: List<String> = emptyList(),
            now: Instant = AppClock.now(),
        ): AnaPageData {
            val range = period.range
            return AnaPageData(
                books, period, margin,
                // The three older tabs keep the figures they were built on; the redesigned ones read the core books.
                figures = if (section == AnaSection.products || section == AnaSection.customers || section == AnaSection.categories) AnaFigures.of(books, range, margin, goods) else AnaFigures(),
                productRows = if (section == AnaSection.products) AnaBreakdown.products(books, range) else emptyList(),
                customerRows = if (section == AnaSection.customers) AnaBreakdown.customers(books, range) else emptyList(),
                categoryRows = if (section == AnaSection.categories) AnaBreakdown.categories(books, range) else emptyList(),
                ledger = ledgerOf(section, books, range, margin, goods, now),
            )
        }

        /** The core books for a page: only what the section draws is worked out (the twelve months cost twelve passes). */
        fun ledgerOf(section: AnaSection, books: AnaBooks, range: AnaRange?, margin: MarginSettings?, goods: List<String>, now: Instant): AnaLedger {
            val opts = BooksOptions(
                now = now, metal = if (erp.app.config.House.metal == "silver") MetalType.silver else MetalType.gold,
                margin = margin ?: MarginSettings.default, goods = goods,
            )
            val input = BooksInput(books.invoices, books.orders, books.products, books.customers, books.expenses, books.extraRevenue)
            val period = range?.let { Period(it.from, it.to) }
            val previous = previousPeriod(period, now)
            val current = Books.compute(input, period, opts)
            val needsPrev = section == AnaSection.overview || section == AnaSection.sales
            val needsMonths = section == AnaSection.profit || section == AnaSection.cash || section == AnaSection.spending || section == AnaSection.metal
            return AnaLedger(
                books = current,
                prev = if (needsPrev && previous != null) Books.compute(input, previous.range, opts) else null,
                previous = previous,
                months = if (needsMonths) monthlySeries(input, 12, opts) else emptyList(),
                years = if (section == AnaSection.profit) yearlySummary(input, opts) else emptyList(),
                monthly = if (section == AnaSection.sales) monthlyRevenue(input, opts) else null,
                range = period,
                now = now,
                recordsGoods = goods.isNotEmpty(),
            )
        }
    }
}

/** What a tab shows when there is nothing to show. */
enum class AnaEmptyKind { nothingInRange, noData }

/** One tab's page, chosen by section. */
@Composable
private fun AnaPages(section: AnaSection, d: AnaPageData) {
    val b = d.ledger.books
    // Cash, Spending and the metal page have something to say about a period with collections, expenses or coin bills but no sale.
    val hasSomething = when (section) {
        AnaSection.cash -> b.cashIn > 0 || b.cashOut > 0
        AnaSection.spending -> b.totalExpenses > 0
        AnaSection.metal -> b.coinSummary.invoices > 0
        else -> false
    }
    val empty: AnaEmptyKind? = when {
        d.books.invoices.isEmpty() && d.books.orders.isEmpty() && d.books.expenses.isEmpty() -> AnaEmptyKind.noData
        b.rangeEmpty && !hasSomething -> AnaEmptyKind.nothingInRange
        else -> null
    }
    if (empty != null) {
        AnaEmptyPage(empty, d.period)
        return
    }
    when (section) {
        AnaSection.overview -> AnaOverviewPage(d.ledger, d.period)
        AnaSection.sales -> AnaSalesPage(d.ledger, d.period)
        AnaSection.profit -> AnaProfitPage(d.ledger, d.period) { AnaPeriodStore.choose(it) }
        AnaSection.cash -> AnaCashPage(d.ledger, d.period)
        AnaSection.spending -> AnaSpendingPage(d.ledger, d.period)
        AnaSection.products -> AnaProductsPage(d.figures, d.productRows, d.period, d.ledger)
        AnaSection.customers -> AnaCustomersPage(d.figures, d.customerRows, d.period, d.ledger)
        AnaSection.categories -> AnaCategoriesPage(d.categoryRows, d.period)
        AnaSection.metal -> AnaMetalPage(d.ledger, d.period)
    }
}

/** "Nothing in this range" and "No data yet", under the period chips so the period can be changed. */
@Composable
private fun AnaEmptyPage(kind: AnaEmptyKind, period: AnaPeriodState) {
    AnaPage(period) {
        when (kind) {
            AnaEmptyKind.nothingInRange -> NotAvailableState(
                "Nothing in this range",
                why = "There are no invoices or orders in the selected period. Pick another period to see more.",
                icon = Symbols.BarChart,
            )
            AnaEmptyKind.noData -> NotAvailableState(
                "No data yet",
                why = "There is no data available to generate analytics yet.",
                icon = Symbols.BarChart,
            )
        }
    }
}

// MARK: Layout the tabs share

/** The page of a tab: the period chips first, then its cards, scrolling as one. */
@Composable
fun AnaPage(period: AnaPeriodState, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 4.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AnaPeriodBar(period)
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
    }
}

/** Cards in one column on a phone, two side by side where the window is wide (the iPad's room). */
@Composable
fun AnaColumns(left: @Composable ColumnScope.() -> Unit, right: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth >= 720.dp) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp), content = left)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp), content = right)
            }
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                left()
                right()
            }
        }
    }
}
