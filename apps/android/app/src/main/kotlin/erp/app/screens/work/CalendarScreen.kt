package erp.app.screens.work

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.auth.LocalSession
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.AppClock
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.StatusBadge
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.logic.ShopCalendar
import erp.core.logic.ShopCalendarDay
import erp.core.logic.ShopCalendarEvent
import erp.core.logic.ShopCalendarMonth
import erp.core.logic.shopCalendarDays
import erp.core.logic.shopCalendarDue
import erp.core.logic.shopCalendarDueOn
import erp.core.logic.shopCalendarMonth
import erp.core.models.Order

/** The width from which the month sits beside its day (the iPad's two columns). */
private const val WIDE_DP = 840

/**
 * Home → Calendar (src/app/calendar/page.tsx): sales and orders, day by day. A month in a grid, each day with the money taken
 * that day (a sale counts on the day its order was taken, as the dashboard and Analytics count it), how many sales and orders
 * it saw, and how many pieces were promised for it; the month's figures above; the day chosen below, with its rows opening
 * the invoice or order. Every figure is core's (`shopCalendarDays`): the money layer and the promise layer are kept apart, as
 * on the page. Owners and staff, as the web's menu has it (nav.ts: Calendar is `staff: true`).
 */
@Composable
fun CalendarScreen() {
    val role = LocalSession.current.role
    if (role == "owner" || role == "staff") {
        ScreenTitle("Calendar")
        CalendarPage()
    } else {
        WorkNotYours("Calendar", "The shop's sales and orders are kept for its owners and staff.")
    }
}

private class Reckoned(val days: Map<String, ShopCalendarDay>, val due: Map<String, Int>)

@Composable
private fun CalendarPage() {
    val book = LocalBook.current
    val orders = rememberShelfStatus(book.orders)
    val invoices = rememberShelfStatus(book.invoices)

    val today = ShopCalendar.today(AppClock.now())
    val todayKey = ShopCalendar.dayKey(today.year, today.month, today.day)
    var year by remember { mutableStateOf(today.year) }
    var month by remember { mutableStateOf(today.month) }
    // The day chosen; today to start with.
    var selected by remember { mutableStateOf(todayKey) }

    ScreenActions {
        TextButton(onClick = {
            year = today.year; month = today.month; selected = todayKey
        }) { Text("Today") }
    }

    val books = remember(orders.revision, invoices.revision) {
        Reckoned(shopCalendarDays(invoices.items, orders.items), shopCalendarDue(orders.items))
    }
    val figures = shopCalendarMonth(books.days, year, month)
    fun step(delta: Int) {
        val next = ShopCalendar.step(year, month, delta)
        year = next.year; month = next.month
    }

    ShelfState(loaded = orders.loaded && invoices.loaded, error = orders.error ?: invoices.error, offline = orders.offline) {
        val wide = LocalConfiguration.current.screenWidthDp >= WIDE_DP
        val monthPane: @Composable () -> Unit = {
            Tiles(figures, year, month)
            MonthCard(books, year, month, todayKey, selected, onSelect = { selected = it }, onStep = ::step)
        }
        val dayPane: @Composable () -> Unit = {
            DaySection(books.days[selected]?.events.orEmpty(), selected)
            DueSection(shopCalendarDueOn(selected, orders.items), selected)
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { monthPane() }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { dayPane() }
            }
        } else {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                monthPane()
                dayPane()
            }
        }
    }
}

/** The month on screen: its money, its sales and orders, and the average day that took anything. */
@Composable
private fun Tiles(m: ShopCalendarMonth, year: Int, month: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FigureRow(spacing = 10.dp) {
            FigureTile(ShopCalendar.title(year, month), Money.pkr(m.total), Modifier.share(), tint = Tone.settled.color(), number = m.total)
            FigureTile("Sales", "${m.sales}", Modifier.share(), number = m.sales.toDouble())
        }
        FigureRow(spacing = 10.dp) {
            FigureTile("Orders", "${m.orders}", Modifier.share(), number = m.orders.toDouble())
            FigureTile("Avg. trading day", if (m.perTradingDay > 0) Money.pkr(Math.round(m.perTradingDay).toDouble()) else "—", Modifier.share())
        }
    }
}

@Composable
private fun MonthCard(
    books: Reckoned, year: Int, month: Int, today: String, selected: String,
    onSelect: (String) -> Unit, onStep: (Int) -> Unit,
) {
    Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(horizontal = 8.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onStep(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous month") }
            Text(ShopCalendar.title(year, month), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            IconButton(onClick = { onStep(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next month") }
        }
        Row {
            for (name in listOf("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")) {
                Text(name, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        }
        val cells = ShopCalendar.cells(year, month)
        for (week in cells.chunked(7)) {
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (i in 0 until 7) {
                    val day = week.getOrNull(i)
                    if (day == null) Box(Modifier.weight(1f).heightIn(min = 60.dp)) else {
                        val key = ShopCalendar.dayKey(year, month, day)
                        DayCell(day, key, books.days[key], books.due[key] ?: 0, key == selected, key == today) { onSelect(key) }
                    }
                }
            }
        }
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Legend(Icons.Filled.FiberManualRecord, "Sales", Tone.settled)
            Legend(Icons.Filled.FiberManualRecord, "Orders", Tone.working)
            Legend(Icons.Filled.EventAvailable, "Promised", Tone.owed)
        }
    }
}

@Composable
private fun Legend(icon: androidx.compose.ui.graphics.vector.ImageVector, word: String, tone: Tone) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(12.dp), tint = tone.color())
        Text(word, style = MaterialTheme.typography.bodySmall, color = tone.color())
    }
}

@Composable
private fun RowScope.DayCell(day: Int, key: String, data: ShopCalendarDay?, due: Int, isSelected: Boolean, isToday: Boolean, onClick: () -> Unit) {
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(Radius.thumb)
    val accent = ErpColors.accent
    Column(
        Modifier.weight(1f).defaultMinSize(minHeight = 60.dp)
            .clip(shape)
            .background(if (isSelected) accent.copy(alpha = 0.16f) else androidx.compose.ui.graphics.Color.Transparent)
            .then(if (isToday) Modifier.border(BorderStroke(1.5.dp, accent), shape) else Modifier)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = spoken(key, data, due); selected = isSelected }
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text("$day", style = MaterialTheme.typography.labelMedium.copy(fontWeight = if (isToday) FontWeight.Bold else FontWeight.Medium), color = if (isToday) accent else MaterialTheme.colorScheme.onSurface)
        // The money taken that day, in a few characters; a day with nothing sold shows none.
        Text(
            if (data != null && data.total > 0) ShopCalendar.dayMoney(data.total) else " ",
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
            maxLines = 1, softWrap = false, overflow = TextOverflow.Clip,
        )
        Row(Modifier.heightIn(min = 12.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
            if (data != null && data.invoices > 0) Count(data.invoices, Tone.settled)
            if (data != null && data.orders > 0) Count(data.orders, Tone.working)
            if (due > 0) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.EventAvailable, null, Modifier.size(9.dp), tint = Tone.owed.color())
                    Text("$due", fontSize = 9.sp, color = Tone.owed.color())
                }
            }
        }
    }
}

@Composable
private fun Count(n: Int, tone: Tone) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Box(Modifier.size(5.dp).clip(androidx.compose.foundation.shape.CircleShape).background(tone.color()))
        Text("$n", fontSize = 9.sp, color = tone.color())
    }
}

/** What a day says to TalkBack: its date, the money, the sales and orders, and what was promised. */
internal fun spoken(key: String, data: ShopCalendarDay?, due: Int): String {
    val parts = mutableListOf(ShopCalendar.longDay(key))
    if (data != null) {
        if (data.total > 0) parts.add(Money.pkr(data.total))
        if (data.invoices > 0) parts.add("${data.invoices} sale${if (data.invoices == 1) "" else "s"}")
        if (data.orders > 0) parts.add("${data.orders} order${if (data.orders == 1) "" else "s"}")
    }
    if (due > 0) parts.add("$due promised")
    return parts.joinToString(", ")
}

@Composable
private fun DaySection(events: List<ShopCalendarEvent>, selected: String) {
    val nav = LocalNavigator.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Events for ${ShopCalendar.longDay(selected)}", Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
            if (events.isEmpty()) {
                Text("No events for this day.", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                events.forEachIndexed { i, e ->
                    if (i > 0) LedgerDivider()
                    val path = if (e.isInvoice) WorkPaths.invoice(e.docId) else WorkPaths.order(e.docId)
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button) { nav.open(path) }.ledgerRow(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
                    ) {
                        val tone = if (e.isInvoice) Tone.settled else Tone.working
                        Icon(if (e.isInvoice) Icons.Filled.Receipt else Icons.Filled.ListAlt, null, Modifier.size(24.dp), tint = tone.color())
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(e.docId, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(e.customerName.ifEmpty { "Walk-in" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(ShopCalendar.clock(e.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                        }
                        Text(Money.pkr(e.grandTotal), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"))
                    }
                }
            }
        }
        Text(
            "${events.size} event${if (events.size == 1) "" else "s"} found.",
            Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The pieces promised for the day chosen (the promise layer on its own: it never touches the money above). */
@Composable
private fun DueSection(due: List<Order>, selected: String) {
    if (due.isEmpty()) return
    val nav = LocalNavigator.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Promised for this day", Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
            due.forEachIndexed { i, o ->
                if (i > 0) LedgerDivider()
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { nav.open(WorkPaths.order(o.id)) }.ledgerRow(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
                ) {
                    Icon(Icons.Filled.EventAvailable, null, Modifier.size(24.dp), tint = Tone.owed.color())
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(o.id, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold), maxLines = 1)
                        Text((o.customerName ?: "").ifEmpty { "Walk-in" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    StatusBadge(o.status)
                }
            }
        }
    }
}
