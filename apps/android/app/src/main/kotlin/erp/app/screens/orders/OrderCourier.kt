package erp.app.screens.orders

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.data.ServerShelf
import erp.app.ui.AlertDialog
import erp.app.ui.BusyLabel
import erp.app.ui.Button
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.OutlinedButton
import erp.app.ui.Pill
import erp.app.ui.QuickPdf
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonBlock
import erp.app.ui.Switch
import erp.app.ui.TextButton
import erp.app.ui.TextField
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.TcsCourier
import erp.core.models.CourierInfo
import erp.core.models.Order
import erp.core.models.TcsBooking
import erp.core.models.Tracking
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// TCS on the order page (src/components/order/tcs-shipping.tsx): the Book with TCS sheet (op bookTcs), the Tracking card (TCS's own scans when
// the account works, else Shopify's fulfilment events: GET /api/app/tracking) with the shipping slip and Cancel booking (op cancelTcs), and the
// owners' Courier cost. The rules and words are core's TcsCourier (tested); the 4 × 6 slip is drawn by the ERP (GET /api/app/pdf/shipping-slip/<id>).
// Owners and staff book and track, as the server lets them; the cost is the owner's.

private fun TcsCourier.Tone.tone(): Tone = when (this) {
    TcsCourier.Tone.settled -> Tone.settled
    TcsCourier.Tone.late -> Tone.late
    TcsCourier.Tone.owed -> Tone.owed
    TcsCourier.Tone.working -> Tone.working
    TcsCourier.Tone.quiet -> Tone.quiet
}

// MARK: Book with TCS

/**
 * The form: receiver, city, weight, pieces, cash to collect, all from the order and editable (`GET /api/app/courier`). A Shopify order is also
 * fulfilled on Shopify with the number so the customer's email and Shopify show it, unless the switch is off. Owners can still book the older way,
 * through Shopify and Universal Courier ([onShopify]), as the web's "Or book through Shopify instead".
 */
@Composable
fun BookTcsSheet(order: Order, isOwner: Boolean, onDismiss: () -> Unit, onShopify: () -> Unit, onBooked: (TcsBooking) -> Unit) {
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<CourierInfo?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var form by remember { mutableStateOf<TcsCourier.Form?>(null) }
    var fulfil by remember { mutableStateOf(true) }
    var notify by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var booked by remember { mutableStateOf<Pair<TcsBooking, Pair<String, String>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val quick = erp.app.ui.rememberQuickPdf()

    LaunchedEffect(order.id, attempt) {
        loadError = null
        info = null
        try {
            val answer = ErpApi.shared.get("/api/app/courier?order=" + java.net.URLEncoder.encode(order.id, "UTF-8").replace("+", "%20"))
            @Suppress("UNCHECKED_CAST")
            val loaded = CourierInfo.fromMap((answer as? Map<String, Any?>) ?: emptyMap())
            info = loaded
            form = TcsCourier.Form.from(loaded)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = ordersSay(e)
        }
    }

    fun book() {
        val f = form ?: return
        if (busy) return
        val problem = TcsCourier.problem(f)
        if (problem != null) { error = problem; return }
        busy = true
        error = null
        scope.launch {
            try {
                val out = ErpApi.shared.write("bookTcs", TcsCourier.bookRequest("order", order.id, f, fulfil, notify))
                val b = TcsCourier.bookedFrom(out) ?: throw OrderActionFailure("TCS did not give a booking back. Look at the order again before booking twice.")
                booked = b to TcsCourier.bookedWords(b, b.shopify)
                ServerShelf.wake()
                onBooked(b)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = ordersSay(e)
            }
            busy = false
        }
    }

    val done = booked
    OrdersSheet(
        title = if (done != null) "Booked: ${done.first.cn}" else "Book with TCS",
        onDismiss = onDismiss,
        locked = busy,
        bottom = { close ->
            if (done != null) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { quick.share(TcsCourier.slipPath("order", order.id), TcsCourier.slipFileName(done.first.cn), "TCS ${done.first.cn}") },
                        enabled = !quick.preparing,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                    ) {
                        BusyLabel(quick.preparing) {
                            Icon(Symbols.Print, null, Modifier.size(18.dp))
                            Text("Shipping slip", Modifier.padding(start = 8.dp))
                        }
                    }
                    OutlinedButton(onClick = close, modifier = Modifier.fillMaxWidth()) { Text("Done") }
                }
            } else {
                Button(
                    onClick = ::book,
                    enabled = !busy && info?.ready == true && form != null,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                ) {
                    BusyLabel(busy) {
                        Icon(Symbols.LocalShipping, null, Modifier.size(18.dp))
                        Text("Book with TCS", Modifier.padding(start = 8.dp))
                    }
                }
            }
        },
    ) {
        if (done != null) {
            OrdersFormSection(footer = "Print the slip and tape it on the parcel.") {
                OrdersStatusLine(Symbols.CheckCircle, done.second.first, Tone.settled)
                Text(done.second.second, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            return@OrdersSheet
        }
        val loaded = info
        val f = form
        loadError?.let { why ->
            OrdersFormSection(title = "Could not read the order") {
                OrdersStatusLine(Symbols.Warning, why, Tone.problem)
                TextButton(onClick = { attempt++ }) { Text("Retry") }
            }
            return@OrdersSheet
        }
        if (loaded == null || f == null) {
            OrdersFormSection { SkeletonBlock(Modifier.fillMaxWidth().height(160.dp)) }
            return@OrdersSheet
        }
        TcsCourier.notReadyWords(loaded)?.let { OrdersFormSection { OrdersStatusLine(Symbols.Warning, it, Tone.owed) } }
        OrdersFormSection(title = "Receiver") {
            Field("Receiver", f.name, busy) { form = f.copy(name = it); error = null }
            Field("Address", f.address, busy) { form = f.copy(address = it); error = null }
            Field("City", f.city, busy) { form = f.copy(city = it); error = null }
            if (loaded.cities.isNotEmpty() && f.city.isNotBlank()) {
                val low = f.city.trim().lowercase()
                val near = loaded.cities.filter { it.lowercase().contains(low) && !it.equals(f.city.trim(), ignoreCase = true) }.take(4)
                if (near.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (c in near) TextButton(onClick = { form = f.copy(city = c) }, enabled = !busy) { Text(c) }
                    }
                }
            }
            Field("Mobile", f.mobile, busy, KeyboardType.Phone) { form = f.copy(mobile = it); error = null }
            Field("Email (optional)", f.email, busy, KeyboardType.Email) { form = f.copy(email = it); error = null }
        }
        OrdersFormSection(
            title = "Parcel",
            footer = "Cash to collect is what is still owed on it, delivery included. Leave it blank if it is paid.",
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) { Field("Weight (kg)", f.weight, busy, KeyboardType.Decimal) { form = f.copy(weight = it); error = null } }
                Box(Modifier.weight(1f)) { Field("Pieces", f.pieces, busy, KeyboardType.Number) { form = f.copy(pieces = it); error = null } }
            }
            Field(
                "Cash to collect (PKR)", if (f.cod == "0") "" else f.cod, busy, KeyboardType.Number, placeholder = "0, paid",
            ) { form = f.copy(cod = it); error = null }
            Field("Note for the rider (optional)", f.remarks, busy) { form = f.copy(remarks = it); error = null }
        }
        if (loaded.prefill.shopifyOrderId != null) {
            OrdersFormSection(
                footer = "If Universal Courier is set to book every fulfilment, switch this off, or it may book a second parcel.",
            ) {
                SwitchRow("Also mark fulfilled on Shopify with this number, so Shopify and the customer see the tracking", fulfil, !busy) { fulfil = it }
                if (fulfil) SwitchRow("Email the customer the tracking", notify, !busy) { notify = it }
            }
        }
        error?.let { OrdersFormSection(title = "Not booked") { OrdersStatusLine(Symbols.Warning, it, Tone.problem) } }
        if (isOwner) {
            TextButton(onClick = onShopify, enabled = !busy) { Text("Or book through Shopify instead (Universal Courier books the parcel)") }
        }
    }
    erp.app.ui.QuickPdfBusy(quick)
}

@Composable
private fun Field(label: String, value: String, busy: Boolean, type: KeyboardType = KeyboardType.Text, placeholder: String? = null, onChange: (String) -> Unit) {
    TextField(
        value = value, onValueChange = onChange, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !busy,
        label = { Text(label) }, placeholder = placeholder?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = type),
    )
}

@Composable
private fun SwitchRow(text: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

// MARK: Tracking

/**
 * Where the parcel is: the latest word, then every scan newest first, with TCS's page linked, the shipping slip and Cancel booking for a
 * booking made here that has not gone yet. Shown once the order has a number or Shopify has shipped it ([TcsCourier.hasParcel]); [refreshKey]
 * changing asks again (the menu's Track).
 */
@Composable
fun OrderTrackingCard(order: Order, refreshKey: Int, quick: QuickPdf, onCancelled: (String) -> Unit, modifier: Modifier = Modifier) {
    if (!TcsCourier.hasParcel(order)) return
    val context = LocalContext.current
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    val live = TcsCourier.liveBooking(order)
    var tracking by remember { mutableStateOf<Tracking?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var all by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }

    // Asked again when the parcel changes (booked here, cancelled), on Refresh, and from the menu's Track.
    LaunchedEffect(order.id, live?.cn, refreshKey, attempt) {
        busy = true
        error = null
        try {
            val fresh = refreshKey > 0 || attempt > 0
            val answer = ErpApi.shared.get(
                "/api/app/tracking?order=" + java.net.URLEncoder.encode(order.id, "UTF-8").replace("+", "%20") + if (fresh) "&fresh=1" else "",
            )
            val t = (answer as? Map<*, *>)?.get("tracking")
            @Suppress("UNCHECKED_CAST")
            tracking = (t as? Map<String, Any?>)?.let { Tracking.fromMap(it) }
            loaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = ordersSay(e)
        }
        busy = false
    }

    fun cancel() {
        val b = live ?: return
        if (cancelling) return
        cancelling = true
        scope.launch {
            try {
                ErpApi.shared.write("cancelTcs", TcsCourier.cancelRequest("order", order.id))
                ServerShelf.wake()
                confirmCancel = false
                note.show(Note("TCS booking cancelled", b.cn))
                onCancelled(b.cn)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                note.show(Note("Not cancelled", ordersSay(e), failed = true))
            }
            cancelling = false
        }
    }

    val t = tracking
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LedgerHeading(TcsCourier.heading(t, live))
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { if (t != null) Pill(t.status, tone = TcsCourier.tone(t.state).tone()) }
                TextButton(onClick = { attempt++ }, enabled = !busy) {
                    BusyLabel(busy) {
                        Icon(Symbols.Refresh, null, Modifier.size(18.dp))
                        Text("Refresh", Modifier.padding(start = 6.dp))
                    }
                }
            }
            error?.let { why ->
                OrdersStatusLine(Symbols.Warning, why, Tone.problem)
                TextButton(onClick = { attempt++ }) { Text("Retry") }
            }
            if (!loaded && error == null) SkeletonBlock(Modifier.fillMaxWidth().height(64.dp))
            if (loaded && t == null && error == null) {
                Text("No word from the courier yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (t != null) {
                if (t.state == "delivered" && (t.deliveredAt != null || t.receivedBy != null)) {
                    val day = t.deliveredAt?.let { ShopDate.say(it, withTime = true) }.orEmpty()
                    Text(
                        "Delivered" + (if (day.isNotEmpty()) " $day" else "") + (t.receivedBy?.let { " · received by $it" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                val shown = TcsCourier.shownEvents(t, all)
                if (shown.isEmpty()) {
                    Text("No scans yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                for ((i, e) in shown.withIndex()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                        Box(
                            Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape)
                                .background(if (i == 0) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f)),
                        )
                        Column(Modifier.weight(1f)) {
                            Text(e.status, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
                            val at = ShopDate.say(e.at, withTime = true).ifEmpty { e.at }
                            Text(
                                at + (e.location?.let { " · $it" } ?: ""),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                if (t.events.size > shown.size) {
                    TextButton(onClick = { all = true }) { Text("Show all ${t.events.size}") }
                }
                val checked = ShopDate.say(t.checkedAt, withTime = true)
                Text(
                    TcsCourier.sourceWords(t) + if (checked.isNotEmpty()) " · checked $checked" else "",
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (live != null) {
                    TextButton(
                        onClick = { quick.share(TcsCourier.slipPath("order", order.id), TcsCourier.slipFileName(live.cn), "TCS ${live.cn}") },
                        enabled = !quick.preparing,
                    ) {
                        Icon(Symbols.Print, null, Modifier.size(18.dp))
                        Text("Shipping slip", Modifier.padding(start = 6.dp))
                    }
                }
                t?.url?.let { url ->
                    TextButton(onClick = { erp.app.device.openAddress(context, Intent.ACTION_VIEW, url) }) {
                        Icon(Symbols.OpenInNew, null, Modifier.size(18.dp))
                        Text("On ${t.carrier}'s site", Modifier.padding(start = 6.dp))
                    }
                }
            }
            if (TcsCourier.canCancel(live, t)) {
                TextButton(onClick = { confirmCancel = true }) {
                    Icon(Symbols.Close, null, Modifier.size(18.dp), tint = Tone.problem.color())
                    Text("Cancel booking", Modifier.padding(start = 6.dp), color = Tone.problem.color())
                }
            }
        }
    }
    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { if (!cancelling) confirmCancel = false },
            title = { Text("Cancel TCS booking ${live?.cn.orEmpty()}?") },
            text = { Text(TcsCourier.cancelDetail) },
            confirmButton = {
                TextButton(onClick = ::cancel, enabled = !cancelling) {
                    BusyLabel(cancelling) { Text("Cancel booking", color = Tone.problem.color()) }
                }
            },
            dismissButton = { TextButton(onClick = { confirmCancel = false }, enabled = !cancelling) { Text("Keep it") } },
        )
    }
}

// MARK: Courier cost

/** What TCS charged to carry the parcel (lib/shipment-costs-server.ts): owners only, never staff; nothing until TCS has given a cost. */
@Composable
fun CourierCostCard(order: Order, isOwner: Boolean, modifier: Modifier = Modifier) {
    val cost = order.shippingCost
    if (!TcsCourier.showsCost(cost, isOwner) || cost == null) return
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LedgerHeading("Courier cost")
        Row(Modifier.ledgerCard(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (line in TcsCourier.costLines(cost)) {
                    Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(
                erp.core.logic.Money.pkr(cost.total),
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
            )
        }
    }
}
