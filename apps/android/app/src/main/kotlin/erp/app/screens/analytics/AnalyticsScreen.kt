package erp.app.screens.analytics

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
import erp.core.logic.MarginSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** The five tabs of Analytics (lib/nav.ts: one entry, so the title menu switches between them). */
enum class AnaSection(val title: String) {
    /** The Overview is "Analytics", as on the web. */
    overview("Analytics"),
    sales("Sales"),
    products("Products"),
    customers("Customers"),
    categories("Categories"),
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
        ScreenTitle(section.title)
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

    ScreenTitle(section.title)

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

    ShelfState(loaded = loaded, error = error, offline = invoices.offline, connectionLost = connectionLost) {
        val period = AnaPeriod.read(AnaPeriodStore.key, AnaPeriodStore.from, AnaPeriodStore.to, now)
        // Margin is worked out for owners alone; a customer or a staff account never sees it.
        val margin = erp.app.config.House.margin
        val data by produceState<AnaPageData?>(
            null, section, period, invoices.revision, orders.revision, products.revision, customers.revision, expenses.revision, revenue.revision,
        ) {
            val live = customers.items.filter { (it.deletedAt ?: "").isEmpty() }
            val books = AnaBooks(invoices.items, orders.items, products.items, live, expenses.items, revenue.items)
            value = withContext(Dispatchers.Default) { AnaPageData.of(section, books, period, margin) }
        }
        val d = data
        if (d == null) SkeletonLoading(Modifier.fillMaxSize()) else AnaPages(section, d)
    }
}

/** Everything one tab shows, worked out once per change of the books or the period, off the main thread. */
class AnaPageData(
    val books: AnaBooks,
    val period: AnaPeriodState,
    val margin: MarginSettings?,
    val figures: AnaFigures,
    val history: AnaHistory?,
    val productRows: List<AnaBreakdown.ProductRow>,
    val customerRows: List<AnaBreakdown.CustomerRow>,
    val categoryRows: List<AnaBreakdown.CategoryRow>,
) {
    companion object {
        fun of(section: AnaSection, books: AnaBooks, period: AnaPeriodState, margin: MarginSettings?): AnaPageData {
            val range = period.range
            return AnaPageData(
                books, period, margin,
                figures = AnaFigures.of(books, range, margin),
                history = if (section == AnaSection.sales) AnaHistory.of(books, margin) else null,
                productRows = if (section == AnaSection.products) AnaBreakdown.products(books, range) else emptyList(),
                customerRows = if (section == AnaSection.customers) AnaBreakdown.customers(books, range) else emptyList(),
                categoryRows = if (section == AnaSection.categories) AnaBreakdown.categories(books, range) else emptyList(),
            )
        }
    }
}

/** What a tab shows when there is nothing to show. */
enum class AnaEmptyKind { nothingInRange, noData }

/** One tab's page, chosen by section. */
@Composable
private fun AnaPages(section: AnaSection, d: AnaPageData) {
    val showCosts = d.margin != null
    val empty: AnaEmptyKind? = when {
        d.period.range != null && d.figures.invoicesInRange == 0 && d.figures.ordersInRange == 0 -> AnaEmptyKind.nothingInRange
        d.books.invoices.isEmpty() && d.books.orders.isEmpty() && d.books.expenses.isEmpty() -> AnaEmptyKind.noData
        else -> null
    }
    if (empty != null) {
        AnaEmptyPage(empty, d.period)
        return
    }
    when (section) {
        AnaSection.overview -> AnaOverviewPage(d.figures, d.period, showCosts, d.margin ?: MarginSettings.default)
        AnaSection.sales -> AnaSalesPage(d.figures, d.history ?: AnaHistory(), d.period, showCosts) { AnaPeriodStore.choose(it) }
        AnaSection.products -> AnaProductsPage(d.figures, d.productRows, d.period)
        AnaSection.customers -> AnaCustomersPage(d.figures, d.customerRows, d.period)
        AnaSection.categories -> AnaCategoriesPage(d.categoryRows, d.period)
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
