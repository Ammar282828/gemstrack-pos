package erp.app.screens.orders

import android.content.Intent
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import erp.app.auth.LocalSession
import erp.app.data.OnlineInbox
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.LedgerHeading
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.NotAvailableState
import erp.app.ui.RowAmount
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.app.ui.toWhatsAppNumber
import erp.core.logic.Money
import kotlinx.coroutines.launch

/**
 * Online orders (/orders/online): the web Orders page's "Online — to confirm" inbox (components/order/
 * online-inbox.tsx), which Home's "online orders to confirm" opens. Every order from the website waits here until
 * a person looks at it (docs/decisions.md "Online orders"): each with its pieces, photographs and sizes, who and
 * where, and what the same pieces cost at today's rate, so whoever confirms knows how far gold has moved. Confirm
 * writes the ORD- order and starts the price hold; Decline sends the reason. Both tell the customer on WhatsApp, so
 * each asks first with the words that go (OnlineConfirmSheet, OnlineDeclineSheet). Under them, the last
 * fortnight's: a confirmed one opens its order, where the transfer is checked.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnlineOrdersScreen() {
    ScreenTitle("Online orders")
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    /** The accounts the server lets act on online orders (lib/website/staff-gate.ts): marketing is refused. */
    val mayAct = role == "owner" || role == "staff"
    val asks = session.shop.websiteSelling && mayAct
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()

    val phase by OnlineOrdersStore.phase.collectAsStateWithLifecycle()
    val rows by OnlineOrdersStore.rows.collectAsStateWithLifecycle()
    val waitingCount by OnlineInbox.waiting.collectAsStateWithLifecycle()
    var confirming by remember { mutableStateOf<OnlineOrderRow?>(null) }
    var declining by remember { mutableStateOf<OnlineOrderRow?>(null) }
    var told by remember { mutableStateOf<OnlineTold?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    // A new one placed while the screen is open: the app's two-minute count sees it first (OnlineInbox).
    LaunchedEffect(asks, waitingCount) { if (asks) OnlineOrdersStore.load() }

    Box(Modifier.fillMaxSize()) {
        when {
            !session.shop.websiteSelling -> NotAvailableState("No online orders here", why = "This house's website takes no orders.", icon = Icons.Filled.Public)
            !mayAct -> NotAvailableState("Owners and staff only", why = "Only owner and staff accounts can act on online orders.")
            else -> when (val p = phase) {
                OnlineOrdersStore.Phase.Idle, OnlineOrdersStore.Phase.Loading -> SkeletonLoading(Modifier.fillMaxSize())
                is OnlineOrdersStore.Phase.Failed -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    NotAvailableState("Couldn't read the online orders", why = p.message, icon = Icons.Filled.CloudOff)
                    Button(
                        onClick = { scope.launch { OnlineOrdersStore.load() } },
                        colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                    ) { Text("Try again") }
                }
                OnlineOrdersStore.Phase.Loaded -> PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { scope.launch { refreshing = true; OnlineOrdersStore.load(); refreshing = false } },
                ) {
                    OnlineList(
                        waiting = OnlineOrdersStore.waiting(rows),
                        lately = OnlineOrdersStore.lately(rows),
                        told = told,
                        onConfirm = { confirming = it },
                        onDecline = { declining = it },
                    )
                }
            }
        }
    }

    confirming?.let { r ->
        OnlineConfirmSheet(r, onDismiss = { confirming = null }, openOrder = { navigator.open(OrderPaths.order(it)) })
    }
    declining?.let { r ->
        OnlineDeclineSheet(r, onDismiss = { declining = null }, done = { told = it })
    }
}

// MARK: The list

@Composable
private fun OnlineList(
    waiting: List<OnlineOrderRow>,
    lately: List<OnlineOrderRow>,
    told: OnlineTold?,
    onConfirm: (OnlineOrderRow) -> Unit,
    onDecline: (OnlineOrderRow) -> Unit,
) {
    val navigator = LocalNavigator.current
    LazyColumn(
        Modifier.fillMaxSize().readableColumn(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (told != null) {
            item("told") {
                Column(Modifier.ledgerCard()) {
                    OrdersStatusLine(if (told.ok) Icons.Filled.CheckCircle else Icons.Filled.Warning, told.words, if (told.ok) Tone.settled else Tone.owed)
                }
            }
        }
        if (waiting.isEmpty()) {
            item("none") {
                NotAvailableState(
                    "Nothing to confirm",
                    why = "A new one shows here, on Home and beside Orders. Nothing is in the book, and nobody has the bank details, until you confirm.",
                    icon = Icons.Filled.Verified,
                )
            }
        } else {
            items(waiting, key = { it.id }) { r -> WaitingCard(r, onConfirm, onDecline) }
        }
        if (lately.isNotEmpty()) {
            item("lately-h") { LedgerHeading("The last two weeks") }
            item("lately") {
                Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (r in lately) {
                        if (r.state == "confirmed" && !r.orderId.isNullOrEmpty()) {
                            TwoLine(
                                "${r.id} · ${r.orderId}",
                                Modifier.clickable { navigator.open(OrderPaths.order(r.orderId)) },
                                subtitle = confirmedLine(r), trailing = Money.pkr(r.grandTotal),
                            )
                        } else if (r.state == "declined") {
                            TwoLine(
                                "${r.id} · declined",
                                subtitle = listOf(r.customer.name, r.declineReason ?: "").filter { it.isNotEmpty() }.joinToString(" · "),
                                trailing = Money.pkr(r.grandTotal),
                                trailingTint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            TwoLine(r.id, subtitle = r.customer.name, trailing = Money.pkr(r.grandTotal))
                        }
                    }
                }
            }
        }
    }
}

private fun confirmedLine(r: OnlineOrderRow): String {
    var s = r.customer.name
    if (!r.confirmedAt.isNullOrEmpty()) s += " · confirmed " + ShopDate.say(r.confirmedAt, withTime = true)
    OnlineOrdersLogic.who(r.confirmedBy)?.let { s += " by $it" }
    return s
}

// MARK: One waiting

@Composable
private fun WaitingCard(r: OnlineOrderRow, onConfirm: (OnlineOrderRow) -> Unit, onDecline: (OnlineOrderRow) -> Unit) {
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        WhoRow(r)
        for (l in r.lines) LineRow(l)
        CustomerRows(r)
        OnlineOrdersLogic.movedLine(r)?.let { moved ->
            val dearer = (OnlineOrdersLogic.moved(r)?.amount ?: 0.0) > 0
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                Icon(Icons.Filled.TrendingUp, null, Modifier.size(18.dp), tint = if (dearer) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant)
                Text(moved, style = MaterialTheme.typography.bodySmall, color = if (dearer) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (r.state == "confirming") {
            // Someone pressed Confirm a moment ago; the server holds it for them for two minutes.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(
                    "Being confirmed" + (OnlineOrdersLogic.who(r.claimedBy)?.let { " by $it" } ?: "") + "…",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            Button(
                onClick = { onConfirm(r) }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
            ) {
                Icon(Icons.Filled.Check, null, Modifier.size(18.dp))
                Text("Confirm", Modifier.padding(start = 8.dp))
            }
            OutlinedButton(onClick = { onDecline(r) }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = Tone.problem.color())) {
                Icon(Icons.Filled.Close, null, Modifier.size(18.dp))
                Text("Decline", Modifier.padding(start = 8.dp))
            }
        }
    }
}

/** Who it is from first (the section says Online already); the number the customer quotes and how long ago are the quiet line, and the total sits at the right. */
@Composable
private fun WhoRow(r: OnlineOrderRow) {
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
    ) {
        Monogram(r.customer.name, size = MonogramSize.row)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                r.customer.name.ifEmpty { "Customer" },
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf("Online", r.id, OnlineOrdersLogic.ago(r.placedAt)).filter { it.isNotEmpty() }.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RowAmount(r.grandTotal)
            Text(
                if (r.deliveryCharge > 0) "incl. ${Money.pkr(r.deliveryCharge)} delivery" else "free delivery",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun LineRow(l: OnlineOrderLine) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        OrdersThumb(l.image, l.description, Modifier.size(48.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(OnlineOrdersLogic.pieceName(l.description), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (l.size != null) {
                Text("Size ${l.size}", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium), color = Tone.owed.color())
            }
        }
        Text(Money.pkr(l.price), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits))
    }
}

/** A piece's photograph from its address, or its first letter while there is none (a photo kept in the document is not decoded in a list). */
@Composable
fun OrdersThumb(image: String, name: String, modifier: Modifier = Modifier) {
    val shape = erp.app.ui.Radius.thumbShape
    val source = image.trim()
    Box(modifier.clip(shape).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
        if (source.startsWith("http")) {
            AsyncImage(model = source, contentDescription = name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Text(
                name.trim().take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CustomerRows(r: OnlineOrderRow) {
    val context = LocalContext.current
    val dial = OrdersLogic.dialable(r.customer.phone)
    if (dial.isNotEmpty()) {
        TextButton(onClick = { erp.app.device.openAddress(context, Intent.ACTION_DIAL, "tel:$dial") }) {
            Icon(Icons.Filled.Call, null, Modifier.size(18.dp))
            Text(r.customer.phone, Modifier.padding(start = 8.dp))
        }
    }
    val wa = toWhatsAppNumber(r.customer.phone)
    if (wa.isNotEmpty()) {
        TextButton(onClick = { erp.app.device.openAddress(context, Intent.ACTION_VIEW, "https://wa.me/$wa") }) {
            Icon(Icons.Filled.Chat, null, Modifier.size(18.dp))
            Text("WhatsApp", Modifier.padding(start = 8.dp))
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.LocationOn, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(listOf(r.delivery.address, r.delivery.city).filter { it.isNotEmpty() }.joinToString(", "), style = MaterialTheme.typography.bodyMedium)
        }
        val notes = r.delivery.notes?.trim().orEmpty()
        if (notes.isNotEmpty()) {
            Text("“$notes”", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
