package erp.app.screens.work

import erp.app.ui.icons.Symbols
import erp.app.ui.SegmentedColumn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.data.Shelf
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.FormSection
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.RowAction
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.ERPDate
import erp.core.logic.ActivityLogEntry
import erp.core.logic.ActivityLogRules

private const val PAGE_SIZE = 200

/** Where Revert, the sign-in list and the emergency lock live. */
private const val WEB_PAGE = "/activity-log?web=1"

/**
 * Activity (src/app/activity-log/page.tsx): everything done in the ERP, newest first (Firestore `activity_log`), narrowed by
 * the kind of event and a range of days. Owners only, as Settings is: the log is the shop's books.
 *
 * Owners read the collection live, as the web does. The filters are the page's: Event Type (a kind, matched on the start of
 * the event's type) and a date range; here the last day of the range counts in full (ActivityLogRules.filter says why). What
 * stays the ERP's page: Revert (it deletes the invoice, order or expense, so it asks for the delete code), the sign-in list and
 * the emergency lock, which the page carries below the log.
 */
@Composable
fun ActivityLogScreen() {
    if (LocalSession.current.isOwner) {
        ScreenTitle("Activity")
        ActivityLogPage()
    } else {
        WorkNotYours("Activity", "The activity log is kept for the shop's owners.")
    }
}

@Composable
private fun ActivityLogPage() {
    val book = LocalBook.current
    val nav = LocalNavigator.current
    // A long log, so it is read only while this screen is open.
    val shelf = remember { Shelf("activity_log", ActivityLogEntry, { it.id }, Comparator<ActivityLogEntry> { a, b -> b.timestamp.compareTo(a.timestamp) }, book) }
    DisposableEffect(shelf) {
        if (!House.isDemo) shelf.need()
        onDispose { shelf.reset() }
    }
    val status = rememberShelfStatus(shelf)
    val demoEntries = remember { if (House.isDemo) WorkDemoBooks.activity(AppClock.now()) else emptyList() }
    val entries = if (House.isDemo) demoEntries else status.items

    // "All" or one of `ActivityLogRules.eventTypes`.
    var type by remember { mutableStateOf("All") }
    var range by remember { mutableStateOf(WorkRange()) }
    // How many lines are listed: a log runs to thousands, so it is shown a page at a time.
    var shown by remember { mutableIntStateOf(PAGE_SIZE) }

    val today = ERPDate.karachiDay(AppClock.now())
    val revision = if (House.isDemo) demoEntries.size else status.revision
    val list = remember(revision, type, range.fromDay, range.toDay, today) {
        ActivityLogRules.filter(entries, type, range.fromDay, range.toDay, today)
    }

    ShelfState(
        loaded = House.isDemo || status.loaded,
        error = if (House.isDemo) null else status.error,
        offline = !House.isDemo && status.offline,
    ) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
        ) {
            item(key = "filters") {
                Box(Modifier.padding(bottom = 12.dp)) { FormSection(
                    "Filters",
                    footer = if (range.useFrom && !range.useTo) ({ Text("Without an end date the range runs to the end of today.") }) else null,
                ) {
                    PickerRow(
                        "Event type", type,
                        listOf("All" to "All") + ActivityLogRules.eventTypes.map { it to ActivityLogRules.title(it) },
                    ) { type = it; shown = PAGE_SIZE }
                    WorkRangeFields(range) { range = it; shown = PAGE_SIZE }
                } }
            }
            item(key = "head") {
                Text(
                    "Everything done in the ERP, newest first · ${list.size} ${if (list.size == 1) "entry" else "entries"}",
                    Modifier.padding(start = 4.dp, end = 4.dp, bottom = 12.dp),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (list.isEmpty()) {
                item(key = "none") {
                    NotAvailableState("No Activity Found", Modifier.padding(bottom = 12.dp), why = "There are no log entries for the selected filters.", icon = Symbols.History)
                }
            } else {
                val visible = list.take(shown)
                items(visible.size, key = { visible[it].id.ifEmpty { "i$it" } }) { i ->
                    val first = i == 0
                    val last = i == visible.lastIndex && list.size <= shown
                    val top = if (first) Radius.card else Radius.joint
                    val bottom = if (last) Radius.card else Radius.joint
                    Column(
                        Modifier.padding(bottom = if (i == visible.lastIndex) 12.dp else 2.dp)
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(top, top, bottom, bottom)).background(ErpColors.card),
                    ) {
                        LogRow(visible[i]) { nav.open(WEB_PAGE) }
                    }
                }
                if (list.size > shown) {
                    item(key = "more") {
                        Column(Modifier.padding(top = 12.dp).clip(Radius.cardShape).background(ErpColors.card)) {
                            ActionRow("Show ${minOf(PAGE_SIZE, list.size - shown)} more", { shown += PAGE_SIZE })
                        }
                    }
                }
            }
            item(key = "web") {
                Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SegmentedColumn {
                        ActionRow("Sign-ins and the emergency lock", { nav.open(WEB_PAGE) }, icon = Symbols.Shield)
                    }
                    Text(
                        "Reverting an invoice, an order or an expense asks for the delete code, so it stays on the ERP's page (swipe the line). The last 30 sign-ins and the emergency lock are there too.",
                        Modifier.padding(horizontal = 16.dp),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun LogRow(e: ActivityLogEntry, openWeb: () -> Unit) {
    val tint = when (ActivityLogRules.tone(e.eventType)) {
        ActivityLogRules.Tone.created -> Tone.settled
        ActivityLogRules.Tone.updated -> Tone.working
        ActivityLogRules.Tone.deleted -> Tone.owed
        ActivityLogRules.Tone.other -> Tone.quiet
    }.color()
    val revert = if (ActivityLogRules.isRevertable(e.eventType)) RowAction("Revert", Symbols.Undo, Tone.owed, openWeb) else null
    val menu = if (revert == null) emptyList() else listOf(RowAction("Revert on the ERP's page", Symbols.Undo, Tone.owed, openWeb))
    SwipeActions(end = revert, menu = menu) {
        Row(
            Modifier.fillMaxWidth().background(ErpColors.card).ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
        ) {
            Icon(symbol(e.eventType), contentDescription = null, Modifier.size(24.dp), tint = tint)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(e.description, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = tint)
                if (e.details.isNotEmpty()) {
                    Text(e.details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(
                ShopDate.say(e.timestamp, withTime = true), Modifier.widthIn(max = 132.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End,
            )
        }
    }
}

/** The icon of the thing it was done to (the page's own). */
private fun symbol(eventType: String) = when {
    eventType.endsWith(".refund") -> Symbols.Undo
    else -> when (eventType.substringBefore('.')) {
        "product" -> Symbols.Diamond
        "customer" -> Symbols.Person
        "karigar", "job" -> Symbols.Hardware
        "invoice" -> Symbols.Receipt
        "order" -> Symbols.ListAlt
        "expense" -> Symbols.Payments
        "revenue" -> Symbols.TrendingUp
        "given" -> Symbols.Inventory2
        "repair" -> Symbols.Build
        "rates" -> Symbols.AttachMoney
        else -> Symbols.History
    }
}
