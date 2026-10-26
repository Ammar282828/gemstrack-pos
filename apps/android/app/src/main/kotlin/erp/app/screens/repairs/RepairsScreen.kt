package erp.app.screens.repairs

import erp.app.ui.AppClock
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Build
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.LedgerDivider
import erp.app.ui.RowAction
import erp.app.ui.SwipeActions
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.NumericText
import erp.app.ui.ShelfState
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.Money
import erp.core.logic.PromiseState
import erp.core.logic.OrderTiming
import erp.core.logic.repairBalance
import erp.core.logic.repairSummary
import erp.core.logic.repairTotal
import erp.core.logic.timingLabel
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.time.Instant


/**
 * Repairs (src/app/repairs/page.tsx, docs/decisions.md "Repairs"): a customer's own pieces, left to be mended. The list by
 * where the ticket stands, In the shop then Ready, with Collected and Cancelled folded away; a ticket opens as a sheet.
 * Owners take pieces in and move them on (Ready, Collected, money): the ERP lets only an owner write a repair, and staff
 * read the list as it is.
 *
 * The ERP links here as /repairs?id=REP-000001 (open that ticket) and /repairs?new=1 (the form). Read once, when the
 * screen appears and, for an id, once the list is in.
 */
@Composable
fun RepairsScreen(path: String) {
    val session = LocalSession.current
    val book = LocalBook.current
    val context = LocalContext.current
    val repairs = rememberShelfStatus(book.repairs)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val desk = rememberRepairsDesk()

    var query by rememberSaveable { mutableStateOf("") }
    // The folded groups a person has opened.
    var opened by rememberSaveable { mutableStateOf(emptySet<String>()) }
    var sheetId by rememberSaveable { mutableStateOf<String?>(null) }
    var sheetSeed by remember { mutableStateOf<Repair?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    // A repair just written: its sheet opens when the form has left.
    var pending by remember { mutableStateOf<RepairsOpen?>(null) }
    var linkRead by rememberSaveable { mutableStateOf(false) }
    var missing by remember { mutableStateOf<String?>(null) }

    ScreenTitle("Repairs")
    ScreenActions {
        if (session.isOwner) IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "New repair") }
    }

    // /repairs?new=1 opens the form (for an owner); /repairs?id=REP-000012 opens that ticket once the list has come in,
    // or says so if it is not there.
    LaunchedEffect(repairs.loaded, path) {
        if (linkRead) return@LaunchedEffect
        val isNew = RepairsKit.query("new", path) == "1"
        val id = RepairsKit.query("id", path).orEmpty()
        if (isNew) {
            linkRead = true
            if (session.isOwner) creating = true
        } else if (id.isNotEmpty()) {
            if (!repairs.loaded) return@LaunchedEffect
            linkRead = true
            if (book.repairs.item(id) != null) { sheetSeed = null; sheetId = id } else missing = id
        } else {
            linkRead = true
        }
    }

    ShelfState(loaded = repairs.loaded, error = repairs.error, offline = repairs.offline, connectionLost = connectionLost) {
        val q = query.trim().lowercase()
        val now = remember(repairs.revision) { AppClock.now() }
        val groups = remember(repairs.revision, q) {
            val shown = if (q.isEmpty()) repairs.items else repairs.items.filter { RepairsKit.matches(it, q) }
            RepairsKit.groups(shown)
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 4.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item(key = "search") {
                Box(Modifier.padding(horizontal = 16.dp)) {
                    RepairsSearchField(query, { query = it }, "Name, phone, piece or REP no.")
                }
            }
            if (groups.isEmpty()) {
                item(key = "empty") {
                    if (q.isNotEmpty()) {
                        NotAvailableState("No Results for “$query”", why = "Check the spelling or try a new search.", icon = Icons.Filled.Search)
                    } else {
                        NotAvailableState(
                            "No repairs yet",
                            why = if (session.isOwner) "Tap + when a customer leaves pieces to be mended." else "Repairs the shop takes in will show here.",
                            icon = Icons.Filled.Build,
                        )
                    }
                }
            }
            for (g in groups) {
                item(key = "h" + g.id) { GroupHeader(g) }
                val forceOpen = q.isNotEmpty()
                val open = !g.folded || forceOpen || g.id in opened
                if (g.folded) {
                    item(key = "f" + g.id) {
                        Column(Modifier.padding(horizontal = 16.dp)) {
                            Column(Modifier.cardEdges(first = true, last = !open)) {
                                FoldRow(g, open, forceOpen) { opened = if (g.id in opened) opened - g.id else opened + g.id }
                            }
                        }
                    }
                }
                if (open) {
                    items(g.rows.size, key = { i -> g.id + "/" + g.rows[i].id }) { i ->
                        val r = g.rows[i]
                        val firstInCard = !g.folded && i == 0
                        Column(Modifier.padding(horizontal = 16.dp)) {
                            Column(Modifier.cardEdges(first = firstInCard, last = i == g.rows.lastIndex)) {
                                RepairRow(desk.shown(r), now, desk, context, isOwner = session.isOwner, shopName = session.shop.name) {
                                    sheetSeed = null
                                    sheetId = r.id
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    RepairsDeskHost(desk)

    sheetId?.let { id ->
        RepairsSheet(id = id, seed = sheetSeed, onDismiss = { sheetId = null; sheetSeed = null })
    }
    if (creating) {
        RepairsForm(
            editing = null,
            onDismiss = {
                creating = false
                pending?.let { p -> pending = null; sheetSeed = p.seed; sheetId = p.id }
            },
            onSaved = { id, seed -> pending = RepairsOpen(id, seed) },
        )
    }
    missing?.let { id ->
        AlertDialog(
            onDismissRequest = { missing = null },
            title = { Text("Repair not found") },
            text = { Text("${id.ifEmpty { "That ticket" }} may have been deleted.") },
            confirmButton = { TextButton(onClick = { missing = null }) { Text("OK") } },
        )
    }
}

/** Rows of one card: the first rounds the top, the last the bottom. */
@Composable
private fun Modifier.cardEdges(first: Boolean, last: Boolean): Modifier {
    val top: Dp = if (first) erp.app.ui.Radius.card else erp.app.ui.Radius.joint
    val bottom: Dp = if (last) erp.app.ui.Radius.card else erp.app.ui.Radius.joint
    return fillMaxWidth().padding(bottom = if (last) 0.dp else 2.dp).clip(RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)).background(ErpColors.card)
}

@Composable
private fun GroupHeader(g: RepairsGroup) {
    val owing = if (g.folded) 0.0 else g.rows.fold(0.0) { sum, r -> sum + repairBalance(r) }
    Row(
        Modifier.padding(horizontal = 20.dp).padding(top = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom,
    ) {
        Box(Modifier.weight(1f)) { LedgerHeading(g.title) }
        Text("${g.rows.size}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (owing >= 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                NumericText(
                    Money.pkrLac(owing), owing,
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text("due", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Collected and Cancelled fold away: "3 repairs", a tap opens them. A search opens them by itself. */
@Composable
private fun FoldRow(g: RepairsGroup, open: Boolean, forced: Boolean, toggle: () -> Unit) {
    val n = g.rows.size
    Row(
        Modifier.fillMaxWidth().clickable(enabled = !forced, role = Role.Button, onClick = toggle)
            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
            .ledgerRow(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$n repair${if (n == 1) "" else "s"}", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(
            Icons.Filled.ExpandMore, contentDescription = null,
            Modifier.then(if (open) Modifier else Modifier.alpha(0.9f)),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * A ticket on the list: what it is, who for, when it was promised (late in red), what it still owes, and the karigar if
 * it is with one. Swipe from the right for the next step (owners), from the left to tell them (Ready); a long press has
 * the rest.
 */
@Composable
private fun RepairRow(
    r: Repair,
    now: Instant,
    desk: RepairsDesk,
    context: Context,
    isOwner: Boolean,
    shopName: String,
    onOpen: () -> Unit,
) {
    val whatsApp = if (r.status == RepairStatus.ready) RepairsKit.whatsAppUrl(r, shopName) else null
    val ready = RowAction("Mark ready", Icons.Filled.CheckCircle, Tone.settled) { desk.markReady(r) }
    val collected = RowAction("Collected", Icons.Filled.Inventory2, Tone.working) { desk.collect(r) }
    val tell = whatsApp?.let { RowAction("Tell them", Icons.Filled.Chat, Tone.settled) { openUrl(context, it) } }
    val trailing = when {
        isOwner && r.status == RepairStatus.received -> ready
        isOwner && r.status == RepairStatus.ready -> collected
        else -> null
    }
    val menu = ArrayList<RowAction>()
    if (isOwner && r.status == RepairStatus.received) menu.add(ready)
    if (isOwner && r.status == RepairStatus.ready) menu.add(collected)
    if (whatsApp != null) menu.add(RowAction("Tell them it's ready", Icons.Filled.Chat, Tone.settled) { openUrl(context, whatsApp) })
    if (isOwner && r.status != RepairStatus.cancelled && repairBalance(r) > 0) {
        menu.add(RowAction("Take payment", Icons.Filled.Payments, Tone.house) { desk.taking = r })
    }
    if (isOwner && (r.status == RepairStatus.received || r.status == RepairStatus.ready)) {
        menu.add(RowAction("Cancel repair", Icons.Filled.Close, Tone.problem) { desk.askCancel(r) })
    }
    SwipeActions(start = tell, end = trailing, menu = menu, onClick = onOpen) {
        RepairRowBody(r, now, busy = desk.isBusy(r.id))
    }
}

@Composable
private fun RepairRowBody(r: Repair, now: Instant, busy: Boolean) {
    val greyed = r.status == RepairStatus.collected || r.status == RepairStatus.cancelled
    Column(Modifier.fillMaxWidth().background(ErpColors.card).alpha(if (greyed) 0.55f else 1f).ledgerRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Text(
                repairSummary(r), Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (busy) SkeletonLoading(compact = true) else RowMoney(r)
        }
        Text(who(r), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        PromiseText(r, now)
        Text(facts(r, now), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** "Hira Sample · +923000000103". */
internal fun who(r: Repair): String {
    var s = RepairsKit.customer(r)
    RepairsKit.filled(r.customerContact)?.let { s += " · $it" }
    return s
}

/** "REP-000012 · in Tue 6 Oct · with Ustad Demo". */
internal fun facts(r: Repair, now: Instant): String {
    val parts = ArrayList<String>()
    parts.add(r.id)
    when (r.status) {
        RepairStatus.ready -> RepairsKit.filled(r.readyAt)?.let { parts.add("ready " + RepairsKit.byDay(it, now)) }
        RepairStatus.collected -> RepairsKit.filled(r.collectedAt)?.let { parts.add("collected " + RepairsKit.byDay(it, now)) }
        else -> parts.add("in " + RepairsKit.byDay(r.receivedAt, now))
    }
    RepairsKit.filled(r.karigarName)?.let { parts.add("with $it") }
    return parts.joinToString(" · ")
}

@Composable
private fun RowMoney(r: Repair) {
    val owing = repairBalance(r)
    if (owing >= 1) {
        Column(horizontalAlignment = Alignment.End) {
            NumericText(Money.pkr(owing), owing, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
            Text("due", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else if (repairTotal(r) > 0) {
        Text("paid", style = MaterialTheme.typography.bodySmall, color = Tone.settled.color())
    }
}

/**
 * "Ready by Sat 10 Oct · 3 days late": the promise of a ticket still in the shop, in the web's colours (late in red, the
 * day itself in orange, otherwise quiet). Nothing for any other status.
 */
@Composable
fun PromiseText(r: Repair, now: Instant, modifier: Modifier = Modifier, large: Boolean = false) {
    val t = RepairsKit.timing(r, now) ?: return
    val color = when (t.state) {
        PromiseState.late -> Tone.late.color()
        PromiseState.today -> Tone.owed.color()
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        promiseLine(r, t, now), modifier,
        style = (if (large) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodySmall)
            .copy(fontWeight = if (t.state == PromiseState.late) FontWeight.SemiBold else FontWeight.Normal),
        color = color,
    )
}

internal fun promiseLine(r: Repair, t: OrderTiming, now: Instant = AppClock.now()): String {
    val base = "Ready by " + RepairsKit.byDay(r.promisedDate, now)
    if (t.state == PromiseState.today) return base
    val `when` = timingLabel(t)
    return if (`when`.isEmpty()) base else "$base · $`when`"
}

internal fun openUrl(context: Context, url: String, action: String = Intent.ACTION_VIEW) {
    val intent = Intent(action, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No app on the phone handles it: the button simply did not open anything.
    }
}
