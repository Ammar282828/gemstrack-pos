package erp.app.screens.orders

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.ui.MineTag
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.Pill
import erp.app.ui.PromiseWords
import erp.app.ui.Radius
import erp.app.ui.RowAction
import erp.app.ui.RowAmount
import erp.app.ui.SwipeActions
import erp.app.ui.StageTrack
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.zoomSource
import erp.core.logic.OrderStage
import erp.core.logic.PromiseState
import erp.core.logic.STAGES
import erp.core.logic.orderTiming
import erp.core.logic.pieceCounts
import erp.core.models.Order
import java.time.Instant

// An order on the hub: a card. Its head (who it is for, when it was promised, what it is, where it stands and what
// is owed) opens the order; under a rule sits the card's one next step (components/order/next-step.tsx), with the
// rest of its moves behind the ⋯ (and a long press). The customer and order number lead. Status, money and the
// promise get separate space, so a narrow phone never squeezes progress counts into ellipses. The detail page
// holds the complete stage track. (OrderCard.swift)

/** Calling or writing to the customer from a card. */
enum class OrderContactKind { call, whatsApp }

/** What the hub does with a card. The hub owns the state and the writes. */
class OrderCardActions(
    val advance: (Order) -> Unit,
    val markReady: (Order) -> Unit,
    val setStatus: (Order, String) -> Unit,
    /** Opens an ERP path in the app (a native screen, or the ERP's page with `?web=1`). */
    val open: (String) -> Unit,
    /** Call or WhatsApp the customer on the order's number. */
    val contact: (Order, OrderContactKind) -> Unit,
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OrderCard(
    order: Order,
    stage: OrderStage,
    /** What the order's invoice still has owing. */
    owed: Double,
    now: Instant,
    isOwner: Boolean,
    /** Taken by the signed-in person: the card is lit in place (docs/decisions.md "Signed-in defaults"). */
    mine: Boolean,
    busy: Boolean,
    actions: OrderCardActions,
    modifier: Modifier = Modifier,
    /** The hub grouped by stage already says the stage in the heading: the card keeps only its bars then. */
    showsStage: Boolean = true,
) {
    /** Invoiced, paid or not, is greyed (owner, 2026-10-06): the order's work is done and its money is the invoice's. */
    val greyed = OrdersLogic.hasInvoice(order) || stage == OrderStage.done
    /** Every stage but done and closed has its one action, and an invoiced order its quiet link. */
    val step = OrdersLogic.nextStep(order, stage, owed)
    val canAdvance = OrdersLogic.offersAdvance(order, stage, isOwner)
    val hasPhone = OrdersLogic.dialable(order.customerContact).isNotEmpty()
    var menu by remember { mutableStateOf(false) }
    val accent = ErpColors.accent
    val path = OrderPaths.order(order.id)

    // The card's swipes (OrderCard.swift): from the left the customer, from the right the money and the bench. A swipe
    // has room for one a side, so the second of each pair (WhatsApp; Ready beside Advance) is in the card's menu and
    // TalkBack's actions.
    val call = RowAction("Call", Symbols.Call, Tone.settled) { actions.contact(order, OrderContactKind.call) }
    val whatsApp = RowAction("WhatsApp", Symbols.Chat, Tone.credit) { actions.contact(order, OrderContactKind.whatsApp) }
    val advance = RowAction("Advance", Symbols.Payments, Tone.working) { actions.advance(order) }
    val ready = RowAction("Ready", Symbols.CheckCircle, Tone.settled) { actions.markReady(order) }
    val right = listOfNotNull(advance.takeIf { canAdvance }, ready.takeIf { stage == OrderStage.karigar })
    SwipeActions(
        modifier = modifier.clip(Radius.cardShape),
        start = call.takeIf { hasPhone },
        end = right.firstOrNull(),
        more = listOfNotNull(whatsApp.takeIf { hasPhone }) + right.drop(1),
    ) {
    Column(
        Modifier
            .zoomSource(path)
            .ledgerCard(padding = 20.dp, lit = mine),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box {
            Box(
                Modifier.combinedClickable(
                    onClickLabel = "Open ${order.id}",
                    onClick = { actions.open(path) },
                    onLongClickLabel = "Actions for ${order.id}",
                    onLongClick = { menu = true },
                ),
            ) {
                OrderCardHead(order, stage, owed, now, greyed, mine, showsStage)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                if (step != null) OrderNextStepRow(order, step, busy, actions)
            }
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = "Actions for ${order.id}" }) {
                    Icon(Symbols.MoreVert, null)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (canAdvance) {
                        MenuItem("Record an advance", Symbols.Payments) { menu = false; actions.advance(order) }
                    }
                    if (stage == OrderStage.karigar) {
                        MenuItem("Mark ready", Symbols.CheckCircle) { menu = false; actions.markReady(order) }
                    }
                    Text(
                        "Set status",
                        Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    for (s in OrdersLogic.settableStatuses) {
                        DropdownMenuItem(
                            text = { Text(s) },
                            leadingIcon = if (s == order.status.rawValue) ({ Icon(Symbols.Check, "Current status") }) else null,
                            onClick = { menu = false; actions.setStatus(order, s) },
                        )
                    }
                    HorizontalDivider()
                    if (hasPhone) {
                        MenuItem("Call", Symbols.Call) { menu = false; actions.contact(order, OrderContactKind.call) }
                        MenuItem("WhatsApp", Symbols.Chat) { menu = false; actions.contact(order, OrderContactKind.whatsApp) }
                    }
                    MenuItem("Open in the ERP", Symbols.Public) { menu = false; actions.open(OrderPaths.orderPage(order.id)) }
                }
            }
        }
    }
    }
}

@Composable
private fun MenuItem(text: String, icon: ImageVector, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(text) }, leadingIcon = { Icon(icon, null) }, onClick = onClick)
}

/** The card's summary. Complete piece, payment and contact details remain on the order. */
@Composable
fun OrderCardHead(order: Order, stage: OrderStage, owed: Double, now: Instant, greyed: Boolean, mine: Boolean, showsStage: Boolean = true) {
    val counts = pieceCounts(order.items)
    val wide = !isLargeText()
    val name = OrdersLogic.customerName(order)
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Who first, and what is owed beside them; the name takes two lines before the sum gives way.
        val who: @Composable (Modifier) -> Unit = { m ->
            Row(m, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Monogram(name, size = MonogramSize.row)
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        name,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = if (greyed) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(order.id, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (mine) MineTag()
                        if (OrdersLogic.isOnline(order)) OrdersOnlineBadge()
                    }
                }
            }
        }
        if (wide) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                who(Modifier.weight(1f))
                Money(order, stage, owed, wide)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                who(Modifier.fillMaxWidth())
                Money(order, stage, owed, wide)
            }
        }
        val what = OrdersLogic.cardWhat(order)
        Text(
            what.first + (what.second?.let { " · $it" } ?: ""),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        StateRow(order, stage, counts.unassigned, counts.done, counts.total, now, greyed, showsStage)
    }
}

/** Where it stands (the four bars, and the stage's word unless the heading says it) and the promise. */
@Composable
private fun StateRow(order: Order, stage: OrderStage, unassigned: Int, done: Int, total: Int, now: Instant, greyed: Boolean, showsStage: Boolean) {
    val large = isLargeText()
    val words: @Composable () -> Unit = {
        if (showsStage || stage == OrderStage.closed) {
            Text(
                stageWords(order, stage, unassigned, done, total, greyed),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                color = stageTone(stage).color(), maxLines = 2,
            )
        }
    }
    if (large) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (stage != OrderStage.closed) StageTrack(stage)
            words()
            Promise(order, now)
        }
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (stage != OrderStage.closed) StageTrack(stage, Modifier.width(88.dp))
            Box(Modifier.weight(1f)) { words() }
            Promise(order, now)
        }
    }
}

internal fun stageWords(order: Order, stage: OrderStage, unassigned: Int, done: Int, total: Int, greyed: Boolean): String {
    val title = if (stage == OrderStage.closed) order.status.rawValue else (STAGES[stage]?.title ?: stage.name)
    if (total <= 0 || greyed || stage == OrderStage.closed || stage == OrderStage.done) return title
    return title + " · " + (if (unassigned > 0) "$unassigned unassigned" else "$done of $total done")
}

internal fun stageTone(stage: OrderStage): Tone = when (stage) {
    OrderStage.karigar -> Tone.working
    OrderStage.ready, OrderStage.done -> Tone.settled
    OrderStage.transfer, OrderStage.payment -> Tone.owed
    else -> Tone.quiet
}

/** Late is red, today amber, anything else a quiet date. */
@Composable
private fun Promise(order: Order, now: Instant) {
    val timing = orderTiming(order, now)
    val promise = OrdersLogic.promise(order, now)
    val due = timing.due
    if (!OrdersLogic.isOpen(order) || due == null) return
    val urgent = promise.chase && (timing.state == PromiseState.late || timing.state == PromiseState.today || promise.urgent)
    val words = PromiseWords.say(timing)
    Text(
        if (urgent) words.text else "Due " + OrdersLogic.dueDay(due),
        style = MaterialTheme.typography.bodySmall.copy(fontWeight = if (urgent) FontWeight.SemiBold else FontWeight.Normal),
        color = if (urgent) words.tone.color() else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
    )
}

/** What is still owed (amber), what is in credit (teal), or Paid in a pill once nothing is. */
@Composable
private fun Money(order: Order, stage: OrderStage, owed: Double, wide: Boolean) {
    if (stage == OrderStage.closed) return
    val due = OrdersLogic.stillOwed(order, owed)
    if (Math.abs(due) >= 1) {
        Column(horizontalAlignment = if (wide) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RowAmount(Math.abs(due), tone = if (due < 0) Tone.credit.color() else Tone.owed.color())
            Text(if (due < 0) "In credit" else "Owed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        Pill("Paid", tone = Tone.settled)
    }
}

/** One visible next action, with secondary money actions in the overflow menu. An invoiced order links to its invoice, where payments are taken. */
@Composable
fun OrderNextStepRow(order: Order, step: OrderNextStep, busy: Boolean, actions: OrderCardActions) {
    if (step is OrderNextStep.Invoice) {
        Row(
            Modifier.defaultMinSize(minHeight = 48.dp).clickable(onClickLabel = "Open invoice ${step.id}") { actions.open(OrderPaths.invoice(step.id)) },
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Symbols.Description, null, Modifier.size(18.dp), tint = ErpColors.accent)
            Text("Invoice ${step.id}", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = ErpColors.accent)
        }
    } else if (busy) {
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { Loading(Modifier.size(26.dp)) }
    } else {
        TextButton(
            onClick = {
                when (step) {
                    // The order's own page has the transfer's moves (OrderOnlineSection, and its bar's Check transfer).
                    is OrderNextStep.CheckTransfer -> actions.open(OrderPaths.order(order.id))
                    OrderNextStep.GiveOut -> actions.open(OrderPaths.giveOut(order.id))
                    OrderNextStep.MarkReady -> actions.markReady(order)
                    OrderNextStep.Finalize -> actions.open(OrderPaths.finalize(order.id))
                    is OrderNextStep.Invoice -> {}
                }
            },
            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
        ) {
            Icon(stepIcon(step), null, Modifier.size(18.dp))
            Text(step.title, Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

/** The step's icon (the SF Symbol the iPhone draws, in Material's terms). */
fun stepIcon(step: OrderNextStep): ImageVector = when (step.symbol) {
    "banknote" -> Symbols.Payments
    "person.badge.plus" -> Symbols.PersonAdd
    "checkmark.circle" -> Symbols.CheckCircle
    else -> Symbols.Description
}
