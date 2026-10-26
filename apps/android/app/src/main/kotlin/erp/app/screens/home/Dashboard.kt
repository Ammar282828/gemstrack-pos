package erp.app.screens.home

import erp.app.ui.AppClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.OnlineInbox
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.rates.RateSheet
import erp.app.ui.ShelfState
import erp.app.ui.UpdateBanner
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Home: the morning glance (src/app/page.tsx, redrawn 2026-09-27; docs/decisions.md "Dashboard"; on the ledger since
 * 2026-10-09). Today first, large: what was taken, how many invoices, the week as bars. Under it three small cards say
 * how the shop stands: this month against last, owed to you, on the bench. Then three lists, each a thing the counter
 * needs to know: what needs a decision (worst first, each led by what it is about), what is due to customers (by the
 * date they were promised, as a calendar leaf), and the latest sales (who, and whether paid). The 30-day line sits
 * quietly at the bottom. Nothing to press but the cards and rows themselves; New sale is the app's menu.
 *
 * Every figure is core's rule (DashboardFigures.kt gathers them, it re-derives none). The web page has no role check,
 * so staff see what the web shows them from the books they can read: no hisaab, so Owed to you is invoices only; no
 * expenses, so the 30-day line is revenue alone. Marketing has no Home (the shell sends it to Posts).
 */
@Composable
fun Dashboard() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val owner = session.isOwner
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    // The instant the page is worked out against; it turns over at Karachi's midnight on a screen left open.
    var now by remember { mutableStateOf(AppClock.now()) }
    var rateSheet by rememberSaveable { mutableStateOf(false) }
    var noteSheet by rememberSaveable { mutableStateOf(false) }
    var allNeeds by rememberSaveable { mutableStateOf(false) }
    var allDue by rememberSaveable { mutableStateOf(false) }
    var allSales by rememberSaveable { mutableStateOf(false) }

    // The shop's books are the owners'; staff have no hisaab, expenses or extra revenue to read.
    val orders = rememberShelfStatus(book.orders)
    val invoices = rememberShelfStatus(book.invoices)
    val customers = rememberShelfStatus(book.customers)
    val karigars = rememberShelfStatus(book.karigars)
    val karigarJobs = rememberShelfStatus(book.karigarJobs)
    val repairs = rememberShelfStatus(book.repairs)
    val settings by rememberSingle(book.settings)
    LaunchedEffect(owner) {
        if (owner) {
            book.hisaab.need()
            book.expenses.need()
            book.revenue.need()
        }
    }
    val hisaab by book.hisaab.items.collectAsStateWithLifecycle()
    val hisaabLoaded by book.hisaab.loaded.collectAsStateWithLifecycle()
    val hisaabRev by book.hisaab.revision.collectAsStateWithLifecycle()
    val expenses by book.expenses.items.collectAsStateWithLifecycle()
    val expensesLoaded by book.expenses.loaded.collectAsStateWithLifecycle()
    val expensesRev by book.expenses.revision.collectAsStateWithLifecycle()
    val revenue by book.revenue.items.collectAsStateWithLifecycle()
    val revenueLoaded by book.revenue.loaded.collectAsStateWithLifecycle()
    val revenueRev by book.revenue.revision.collectAsStateWithLifecycle()

    // Like the web, nothing is drawn until the books are in: a figure worked out from half of them would be wrong.
    val core = orders.loaded && invoices.loaded && repairs.loaded && customers.loaded && karigars.loaded && karigarJobs.loaded
    val ready = if (!owner) core else core && hisaabLoaded && expensesLoaded && revenueLoaded

    // Online orders waiting to be confirmed, and whether selling waits on today's rate (the server says).
    val selling = session.shop.websiteSelling
    val waiting by OnlineInbox.waiting.collectAsStateWithLifecycle()
    val ratePause by OnlineInbox.ratePause.collectAsStateWithLifecycle()
    // The count itself is polled once for the whole app (RootScaffold); coming here, or back, asks again at once.
    LaunchedEffect(selling) { if (selling) OnlineInbox.refresh() }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { now = AppClock.now() }
    // Each minute, so the day turns over at Karachi's midnight.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = AppClock.now()
        }
    }

    // Reckoned once per change of the books it reads (or of the minute), never per drawing, and off the main thread.
    val minute = now.epochSecond / 60
    val figures by produceState<DashFigures?>(
        null, ready, orders.revision, invoices.revision, revenueRev, expensesRev, karigars.revision, karigarJobs.revision,
        repairs.revision, customers.revision, hisaabRev, minute,
    ) {
        if (!ready) return@produceState
        val at = now
        value = withContext(Dispatchers.Default) {
            DashFigures(
                at, orders.items, invoices.items, revenue, expenses, karigars.items, karigarJobs.items,
                repairs.items, customers.items, hisaab,
            )
        }
    }

    // Home says Today, not the shop's name (the business is the badge's and the chip's to say).
    ScreenTitle("Today")
    if (owner) {
        ScreenActions {
            IconButton(onClick = { noteSheet = true }) { Icon(Icons.Filled.PushPin, "Team note") }
        }
    }

    Column(Modifier.fillMaxSize()) {
        UpdateBanner()
        Box(Modifier.weight(1f)) {
            ShelfState(
                loaded = ready && figures != null,
                error = orders.error ?: invoices.error,
                offline = orders.offline,
                connectionLost = connectionLost,
            ) {
                figures?.let { f ->
                    val needs = f.needs(if (selling) waiting else 0, if (selling) ratePause else null)
                    DashboardPage(
                        f, needs, owner,
                        open = navigator::open,
                        onRates = if (owner) ({ rateSheet = true }) else null,
                        allNeeds = allNeeds, allDue = allDue, allSales = allSales,
                        toggleNeeds = { allNeeds = !allNeeds }, toggleDue = { allDue = !allDue }, toggleSales = { allSales = !allSales },
                    )
                }
            }
        }
    }
    if (rateSheet) RateSheet(onDismiss = { rateSheet = false })
    if (noteSheet) TeamNoteEditor(onDismiss = { noteSheet = false })
}

@Composable
private fun DashboardPage(
    f: DashFigures,
    needs: List<DashNeed>,
    owner: Boolean,
    open: (String) -> Unit,
    onRates: (() -> Unit)?,
    allNeeds: Boolean, allDue: Boolean, allSales: Boolean,
    toggleNeeds: () -> Unit, toggleDue: () -> Unit, toggleSales: () -> Unit,
) {
    // An iPad's wide window lays Home out in two columns; at the largest text sizes the page stays one.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 900.dp && !isLargeText()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier
                    .padding(horizontal = if (wide) 28.dp else 16.dp)
                    .padding(top = 4.dp, bottom = 24.dp)
                    // On the widest windows the page stays a page: the two columns never drift a room apart.
                    .widthIn(max = if (wide) 1240.dp else Dp.Infinity)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(if (wide) 26.dp else 22.dp),
            ) {
                if (wide) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        DateLine(f)
                        Hero(f, open)
                        FigureGrid(f, owner, open)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                            NeedsSection(needs, allNeeds, toggleNeeds, open, onRates)
                            DueSection(f, allDue, toggleDue, open)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                            SalesSection(f, allSales, toggleSales, open)
                        }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        DateLine(f)
                        Hero(f, open)
                        FigureGrid(f, owner, open)
                    }
                    NeedsSection(needs, allNeeds, toggleNeeds, open, onRates)
                    DueSection(f, allDue, toggleDue, open)
                    SalesSection(f, allSales, toggleSales, open)
                }
            }
        }
    }
}

/** "TUESDAY 21 OCTOBER", a quiet line above the hero. */
@Composable
private fun DateLine(f: DashFigures) {
    Text(
        DashDate.dayLabel(f.now).uppercase(),
        Modifier.padding(horizontal = 16.dp).clearAndSetSemantics { contentDescription = DashDate.longDay(f.now) },
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Taken today, as the web's headline links it: the invoices. */
@Composable
private fun Hero(f: DashFigures, open: (String) -> Unit) {
    DashHero(
        f.todayRevenue, f.todayInvoiceCount, f.lastSaleToday?.let { DashDate.clock(it.createdAt) }, f.week,
        onClick = { open("/invoices") },
    )
}

/** The four figures, always showing: two by two, one under another at large text sizes. */
@Composable
private fun FigureGrid(f: DashFigures, owner: Boolean, open: (String) -> Unit) {
    // Analytics and the hisaab are the owners' books.
    val tiles: List<@Composable (Modifier) -> Unit> = listOf(
        { m -> OwedTile(f, owner, open, m) },
        { m -> BenchTile(f, open, m) },
        { m -> MonthTile(f, owner, open, m) },
        { m -> DueTile(f, open, m) },
    )
    if (isLargeText()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { tiles.forEach { it(Modifier) } }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (pair in tiles.chunked(2)) {
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) { pair.forEach { it(Modifier.weight(1f)) } }
            }
        }
    }
}

/** Owed is amber, never red: money still to come is not an alarm. */
@Composable
private fun OwedTile(f: DashFigures, owner: Boolean, open: (String) -> Unit, modifier: Modifier) {
    DashStat("Owed to you", { open(if (owner && f.owedInHisaab > 0) "/hisaab" else "/invoices") }, modifier) {
        if (f.totalOutstanding >= 1) DashStatAmount(f.totalOutstanding, Tone.owed.color()) else DashStatValue("Nil")
        DashStatNote("${f.unpaid.size} unpaid")
        if (f.owedInHisaab > 0) DashStatNote("${Money.lacCrore(f.owedInHisaab)} in hisaab")
    }
}

@Composable
private fun BenchTile(f: DashFigures, open: (String) -> Unit, modifier: Modifier) {
    DashStat("On the bench", { open("/workshop") }, modifier) {
        val n = f.activeJobs
        DashStatValue("$n piece${if (n == 1) "" else "s"}")
        val critical = f.criticalJobs.size
        if (critical > 0) DashStatNote("$critical sitting ${DashBench.criticalDays}+ days", Tone.late.color())
        else DashStatNote("Nothing overdue")
    }
}

/** This month's takings against last (the old This month card, now a tile; the detail is Analytics). */
@Composable
private fun MonthTile(f: DashFigures, owner: Boolean, open: (String) -> Unit, modifier: Modifier) {
    DashStat("This month", if (owner) ({ open("/analytics") }) else null, modifier) {
        DashStatAmount(f.monthRevenue)
        DashMonthChange(f.monthAgainstLast, f.now)
        if (f.monthCoins > 0) DashStatNote("+ ${Money.pkrLac(f.monthCoins)} in gold coins")
    }
}

/**
 * Orders and repairs promised to customers; red only for the late ones. Their totals are not what is left to collect,
 * so no sum is shown here: Owed to you says that.
 */
@Composable
private fun DueTile(f: DashFigures, open: (String) -> Unit, modifier: Modifier) {
    val n = f.due.size
    val late = f.lateDue.size
    DashStat("Orders due", { open("/orders") }, modifier) {
        DashStatValue(if (n == 0) "None" else "$n open")
        if (late > 0) DashStatNote("$late late", Tone.late.color())
    }
}

@Composable
private fun NeedsSection(needs: List<DashNeed>, all: Boolean, toggle: () -> Unit, open: (String) -> Unit, onRates: (() -> Unit)?) {
    // Nothing needing anyone: no section, no empty card.
    if (needs.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        DashHeader("Needs you", count = needs.size)
        DashNeedList(if (all) needs else needs.take(3), open, onRates)
        if (needs.size > 3) DashReveal(all, needs.size - 3, toggle)
    }
}

@Composable
private fun DueSection(f: DashFigures, all: Boolean, toggle: () -> Unit, open: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        DashHeader("Due to customers", count = f.due.size, allLabel = "All orders", onAll = { open("/orders") })
        if (f.due.isEmpty()) DashEmpty("No open orders or repairs.")
        else DashRowsCard(if (all) f.due else f.due.take(3), inset = DUE_LEAF + 12.dp) { d -> DashDueRow(d, open) }
        if (f.due.size > 3) DashReveal(all, f.due.size - 3, toggle)
    }
}

@Composable
private fun SalesSection(f: DashFigures, all: Boolean, toggle: () -> Unit, open: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        DashHeader("Recent sales", allLabel = "All invoices", onAll = { open("/invoices") })
        if (f.recentInvoices.isEmpty()) DashEmpty("No sales yet.")
        else DashRowsCard(if (all) f.recentInvoices else f.recentInvoices.take(3), inset = SALE_MONOGRAM + 12.dp) { i -> DashSaleRow(i, f.now, open) }
        if (f.recentInvoices.size > 3) DashReveal(all, f.recentInvoices.size - 3, toggle)
    }
}
