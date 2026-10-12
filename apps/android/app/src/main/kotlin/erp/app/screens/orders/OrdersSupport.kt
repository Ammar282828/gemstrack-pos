package erp.app.screens.orders

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.filled.Public
import erp.app.config.House
import erp.app.ui.LedgerHeading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Margin
import erp.core.logic.PromiseState
import erp.core.logic.orderMargin
import erp.core.models.Order
import erp.core.models.OrderStatus
import kotlinx.coroutines.launch

// The few helpers the Orders screens share. Everything here carries Order(s) in its name, or is private to the
// group, so it cannot meet another group's helpers (OrdersSupport.swift).

/** The places the Orders screens open, as ERP paths (the iPhone's `OrdersWebTarget`). */
object OrderPaths {
    /** An id as one path piece ("KAR-1", or a name with odd characters in it). */
    fun piece(id: String): String {
        val out = StringBuilder()
        for (b in id.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "-_.~") out.append(c) else out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** Explicit access to the order's full ERP page (`?web=1` asks the registry for the ERP's own page). */
    fun orderPage(id: String) = "/orders/${piece(id)}?web=1"

    /** The order's native page. */
    fun order(id: String) = "/orders/${piece(id)}"

    /** The native bench, limited to this order: assign a karigar and record the handover separately. */
    fun giveOut(id: String) = "/workshop?order=" + piece(id)

    /** The workshop slip, native: drawn on the ERP's server by the one builder (lib/order-slip-pdf.ts), shown here and printed or shared from the share sheet. */
    fun slip(id: String) = "/orders/${piece(id)}/slip"

    /** Finalize & invoice, native (OrderFinalizeScreen; the web's page reads ?do=finalize for the same dialog). */
    fun finalize(id: String) = "/orders/${piece(id)}/finalize"

    /** New order's form on the order on file (NewOrderEdit). */
    fun edit(id: String) = "/orders/${piece(id)}/edit"

    fun invoice(id: String) = "/invoices/${piece(id)}"

    fun customer(id: String) = "/customers/${piece(id)}"

    /** "/orders/ORD-1/finalize" → "ORD-1"; null for any other path. */
    fun finalizeId(path: String): String? {
        val bare = path.substringBefore('?')
        if (!bare.startsWith("/orders/") || !bare.endsWith("/finalize")) return null
        val id = bare.removePrefix("/orders/").removeSuffix("/finalize")
        if (id.isEmpty() || id.contains('/')) return null
        return erp.app.nav.ScreenRoute.percentDecode(id)
    }
}

/** The colours the Orders screens give what they say, from the ledger's tones only. */
object OrdersTone {
    /** The status picker's pill: amber while waiting to start, blue with the karigars, green once finished. */
    fun status(s: OrderStatus): Tone = when (s) {
        OrderStatus.pending -> Tone.owed
        OrderStatus.inProgress -> Tone.working
        OrderStatus.completed -> Tone.settled
        else -> Tone.quiet
    }

    /** The web's colours for a promise (components/shared/promise-line.tsx): red once late, amber on the day and inside the bench week, quiet once the order is finished or when nothing was promised. */
    fun promise(p: OrderPromise): Tone {
        if (p.chase && p.state == PromiseState.late) return Tone.late
        if (p.chase && p.state == PromiseState.today) return Tone.owed
        return if (p.urgent) Tone.owed else Tone.quiet
    }
}

/**
 * "Online": an order that came from the website and was confirmed by a person. A quiet label rather than a
 * capsule, so a card keeps to one badge (App/UI/Ledger.swift).
 */
@Composable
fun OrdersOnlineBadge(modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Public, null, Modifier.size(12.dp), tint = Tone.working.color())
        Text("Online", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold), color = Tone.working.color(), maxLines = 1)
    }
}

/**
 * What the shop earns on an order, blurred until tapped: the counter turns its screen to show a customer the
 * bill, and a margin beside the total is the one thing they must not read off it. The figure is not in the view
 * until it is tapped (shop-margin.tsx MarginFigure). Shop screens only.
 */
@Composable
fun OrdersMarginRow(order: Order, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf(false) }
    val settings = House.margin
    val m: Margin? = if (shown) orderMargin(order, settings = settings) else null
    val tint = when {
        m == null -> MaterialTheme.colorScheme.onSurfaceVariant
        m.assumed -> MaterialTheme.colorScheme.onSurfaceVariant
        m.percent < 0 -> Tone.late.color()
        else -> Tone.settled.color()
    }
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = if (shown) "Hide our margin" else "Show our margin") { shown = !shown }
            .semantics { contentDescription = if (shown) "We earn: ${OrdersLogic.marginWords(m!!, settings)}. Hide our margin" else "Show our margin" },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lock, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("We earn", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            if (m != null) OrdersLogic.marginWords(m, settings) else "00.0% · PKR 00,000",
            Modifier.weight(1.4f).then(if (m == null) Modifier.blur(5.dp).alpha(0.6f) else Modifier),
            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
            color = tint,
            textAlign = TextAlign.End,
        )
    }
}

/** What an error says on screen: the ERP's own words. */
fun ordersSay(e: Throwable): String = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."

// MARK: Sheets

/**
 * A full-height sheet with a title and a Cancel, a scrolling body and, when given, a button pinned under it:
 * the Orders group's counterpart of the iPhone's `NavigationStack { Form … safeAreaBar }` sheets. [locked] keeps
 * it from closing while a write is out (`interactiveDismissDisabled`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrdersSheet(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    cancelLabel: String = "Cancel",
    locked: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
    bottom: (@Composable (close: () -> Unit) -> Unit)? = null,
    content: @Composable ColumnScope.(close: () -> Unit) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !locked })
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch {
            state.hide()
            onDismiss()
        }
    }
    ModalBottomSheet(
        onDismissRequest = { if (!locked) onDismiss() },
        sheetState = state,
        containerColor = ErpColors.ground,
    ) {
        Column(modifier.fillMaxWidth().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = close, enabled = !locked) { Text(cancelLabel) }
                Text(
                    title,
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                )
                if (trailing != null) trailing() else Row(Modifier.size(width = 72.dp, height = 1.dp)) {}
            }
            HorizontalDivider()
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) { content(close) }
            if (bottom != null) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { bottom(close) }
            }
        }
    }
}

/** A form section on the house's card: its heading, its rows, and a footnote under it. */
@Composable
fun OrdersFormSection(
    modifier: Modifier = Modifier,
    title: String? = null,
    footer: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (title != null) LedgerHeading(title)
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
        if (footer != null) {
            Text(footer, Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A label and its value, the value trailing (the form's `LabeledContent`). */
@Composable
fun OrdersLabeled(label: String, value: String, modifier: Modifier = Modifier, tint: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            Modifier.weight(1.2f),
            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
            color = if (tint == androidx.compose.ui.graphics.Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else tint,
            textAlign = TextAlign.End,
        )
    }
}

/** A line with a leading icon in a tone: a result, a warning, a refusal. */
@Composable
fun OrdersStatusLine(icon: ImageVector, text: String, tone: Tone, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, Modifier.size(20.dp), tint = tone.color())
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = tone.color())
    }
}
