package erp.app.screens.home

import erp.app.ui.AppClock
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerSection
import erp.app.ui.NotAvailableState
import erp.app.ui.RowAmount
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.CashLine
import erp.core.logic.CashMethod
import erp.core.logic.CashSource
import erp.core.logic.METHODS
import erp.core.logic.Money
import erp.core.logic.TodaysCash
import erp.core.logic.todaysCash
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Home → Today's cash (src/app/today/page.tsx): what came in today by how it was paid, what went out, and what the
 * drawer should have gained. Every figure is core's `todaysCash` (the 9 pm report's "Net cash" reads the same rule);
 * Karachi's day, re-read once a minute so a screen left open turns over at midnight.
 *
 * Owners only, as on the web's menu: the drawer is worked out from expenses and extra revenue, which are the owners'
 * books. Anyone else is told so and nothing is read for them.
 */
@Composable
fun TodaysCashScreen() {
    ScreenTitle("Today’s cash")
    val session = LocalSession.current
    if (!session.isOwner) {
        NotAvailableState("Owners only")
        return
    }
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val repairs = rememberShelfStatus(book.repairs)
    val revenue = rememberShelfStatus(book.revenue)
    val expenses = rememberShelfStatus(book.expenses)
    val ready = invoices.loaded && orders.loaded && repairs.loaded && revenue.loaded && expenses.loaded

    var now by remember { mutableStateOf(AppClock.now()) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { now = AppClock.now() }
    // Re-read once a minute, so a page left open turns over at Karachi's midnight.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = AppClock.now()
        }
    }
    val cash by produceState<TodaysCash?>(
        null, ready, invoices.revision, orders.revision, repairs.revision, revenue.revision, expenses.revision, now.epochSecond / 60,
    ) {
        if (!ready) return@produceState
        val at = now
        value = withContext(Dispatchers.Default) {
            todaysCash(invoices.items, orders.items, repairs.items, revenue.items, expenses.items, at)
        }
    }

    ShelfState(
        loaded = ready && cash != null,
        error = invoices.error ?: orders.error,
        offline = invoices.offline,
        connectionLost = connectionLost,
    ) {
        cash?.let { Page(it, now, navigator::open) }
    }
}

@Composable
private fun Page(t: TodaysCash, now: Instant, open: (String) -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn().padding(horizontal = 16.dp).padding(top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                DashDate.dayLabel(now),
                Modifier.padding(horizontal = 4.dp),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Tiles(t)
        }
        LedgerSection("By how it was paid") {
            METHODS.forEachIndexed { i, m ->
                if (i > 0) LedgerDivider()
                MethodRow(m, t.byMethod[m] ?: 0.0)
            }
        }
        LedgerSection("Came in") {
            if (t.lines.isEmpty()) {
                Text("Nothing yet today.", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                t.lines.forEachIndexed { i, line ->
                    if (i > 0) LedgerDivider()
                    CameInRow(line, open)
                }
            }
        }
        if (t.expenseLines.isNotEmpty()) {
            LedgerSection(
                "Paid out",
                footer = { Text("Expenses carry no method, so every one the business paid today counts as leaving the drawer; one a partner paid out of pocket does not.") },
            ) {
                t.expenseLines.forEachIndexed { i, e ->
                    if (i > 0) LedgerDivider()
                    Column(Modifier.fillMaxWidth().ledgerRow()) { TwoLine(e.description, subtitle = e.category, trailing = Money.pkr(e.amount)) }
                }
            }
        }
    }
}

@Composable
private fun Tiles(t: TodaysCash) {
    val n = t.expenseLines.size
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FigureRow(spacing = 10.dp) {
            FigureTile(
                "In the drawer", Money.pkr(t.netCash), Modifier.share(), detail = "Cash in, less what was paid out",
                tint = if (t.netCash < 0) Tone.owed.color() else ErpColors.accent, number = t.netCash,
            )
            FigureTile("Money in", Money.pkr(t.totalIn), Modifier.share(), detail = "Every method", number = t.totalIn)
        }
        FigureRow(spacing = 10.dp) {
            val out = t.expenses + t.paidBack
            FigureTile(
                "Paid out", Money.pkr(out), Modifier.share(),
                detail = "$n expense${if (n == 1) "" else "s"}" + if (t.paidBack > 0) " and ${Money.pkr(t.paidBack)} of credit given back" else "",
                number = out,
            )
            FigureTile("Exchange", Money.pkr(t.exchange), Modifier.share(), detail = "Taken in exchange — not cash", number = t.exchange)
        }
    }
}

@Composable
private fun MethodRow(m: CashMethod, amount: Double) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(m.rawValue, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        RowAmount(amount, tone = if (amount == 0.0) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
    }
}

internal fun cashSourceWord(s: CashSource): String = when (s) {
    CashSource.invoice -> "Invoice"
    CashSource.advance -> "Order advance"
    CashSource.repair -> "Repair"
    CashSource.extra -> "Extra revenue"
}

internal fun cashLinePath(l: CashLine): String = when (l.source) {
    CashSource.invoice -> DashPath.invoice(l.ref)
    CashSource.advance -> DashPath.order(l.ref)
    CashSource.repair -> DashPath.repair(l.ref)
    CashSource.extra -> "/additional-revenue"
}

/** An Extra revenue line's ref is its own words; the others are a document and who it was for. */
internal fun cashLineTitle(l: CashLine): String = if (l.source == CashSource.extra || l.who.isEmpty()) l.ref else "${l.ref} · ${l.who}"

internal fun cashLineSubtitle(l: CashLine): String = "${if (l.payback) "Credit paid back" else cashSourceWord(l.source)} · ${l.method.rawValue} · ${DashDate.clock(l.at)}"

@Composable
private fun CameInRow(l: CashLine, open: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { open(cashLinePath(l)) }.ledgerRow()) {
        TwoLine(cashLineTitle(l), subtitle = cashLineSubtitle(l), trailing = Money.pkr(l.amount))
    }
}
