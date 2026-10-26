package erp.app.screens.invoices

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.ArrowCircleDown
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileCopy
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Percent
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.QuestionMark
import erp.app.ui.Button
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.ContactActions
import erp.app.ui.HeroAmount
import erp.app.ui.LedgerHeading
import erp.app.ui.LocalNoteState
import erp.app.ui.MoneyRow
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.Note
import erp.app.ui.NotAvailableState
import erp.app.ui.PaidRing
import erp.app.ui.PaymentCustomer
import erp.app.ui.PaymentSheet
import erp.app.ui.PerforationDivider
import erp.app.ui.Pill
import erp.app.ui.QuickAction
import erp.app.ui.RowAmount
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.RowAction
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.isLargeText
import erp.app.ui.ledgerCard
import erp.app.ui.heroSheen
import erp.app.ui.minus
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.theme.TabularDigits
import erp.app.ui.zoomDestination
import erp.core.logic.BalanceState
import erp.core.logic.Margin
import erp.core.logic.balanceLine
import erp.core.logic.canHoldCredit
import erp.core.logic.describeDelivery
import erp.core.logic.exchangeTotal
import erp.core.logic.invoiceExchanges
import erp.core.logic.invoiceMargin
import erp.core.logic.isOwing
import erp.core.logic.owesMoney
import erp.core.logic.percentLabel
import erp.core.logic.saleCustomerKey
import erp.core.logic.describeExchangeEntry
import erp.core.logic.WALK_IN_ENTITY
import erp.core.models.ExchangeEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceItem
import erp.core.models.InvoiceStatus
import erp.core.models.Payment
import erp.core.models.PaymentType
import erp.core.logic.Money
import erp.app.ui.OwnerDeletion
import erp.app.ui.OwnerDeleteCodeSheet

/** The invoice's own actions, each a sheet. */
private enum class InvoiceAct { Discount, Payment, GiveBack, Refund, Delete }

/** Pieces shown before "Show N more". */
private const val FIRST_PIECES = 5

/**
 * An invoice, for the shop (src/components/invoice/invoice-viewer.tsx): its pieces and figures, payments, taking a
 * payment, the customer's page to share, and who it was for (named or changed here, set-customer-dialog.tsx). The
 * PDF is the one Print saves (lib/invoice-pdf.ts), drawn on the ERP's server and shown here, to print or share;
 * Taheri's WhatsApp send has the server draw and send it from the shop's line, and House of Mina's link goes from
 * here. Edit is New sale's own form; the discount, deleting a payment, a refund and deleting the invoice are native
 * sheets (owners, the last three behind the delete code).
 *
 * Laid out as the order's page is (2026-10-12): one receipt at the head (who, when, what is still due beside a ring
 * of what is paid), the quick row (ring, write, print), then the pieces as the bill reads them with its totals, the
 * payments, the details, and the shop's own lines at the foot. Take payment is the bar at the foot while money is
 * owed; the ⋯ menu keeps everything else.
 */
@Composable
fun InvoiceScreen(id: String) {
    val book = LocalBook.current
    val status = rememberShelfStatus(book.invoices)
    val customers by rememberShelf(book.customers)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val invoice = status.items.firstOrNull { it.id == id }
    ScreenTitle(id)
    // The page grows out of its row on the list (the row's id is this route's path).
    Box(Modifier.fillMaxSize().zoomDestination(InvoiceFacts.path(id))) {
        if (invoice != null) {
            InvoiceDetail(invoice, customers)
        } else {
            ShelfState(loaded = status.loaded, error = status.error, offline = status.offline, connectionLost = connectionLost) { InvoiceNotFound(id) }
        }
    }
}

/** An invoice the books do not hold: refunded in full, which removes it (the ERP's words). */
@Composable
private fun InvoiceNotFound(id: String) {
    val navigator = LocalNavigator.current
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        NotAvailableState("Invoice $id not found", why = "It may have been refunded in full, which removes it.", icon = Icons.Filled.QuestionMark)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { navigator.open("/invoices") }) { Text("All invoices") }
            TextButton(onClick = { navigator.open("/invoices/new") }) { Text("New sale") }
        }
    }
}

@Composable
private fun InvoiceDetail(inv: Invoice, customers: List<erp.core.models.Customer>) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val role = session.role
    val canPay = InvoiceFacts.mayTakePayments(role)
    val owner = session.isOwner
    val byCustomer = session.shop.invoiceByCustomer
    val note = LocalNoteState.current

    var paying by remember { mutableStateOf<Invoice?>(null) }
    var sending by remember { mutableStateOf<Invoice?>(null) }
    var pdf by remember { mutableStateOf<InvoicePdfTarget?>(null) }
    var settingCustomer by remember { mutableStateOf(false) }
    var acting by remember { mutableStateOf<InvoiceAct?>(null) }
    var allPieces by rememberSaveable(inv.id) { mutableStateOf(false) }
    // A payment swiped away: the delete code is asked for it straight away.
    var paymentAsk by remember { mutableStateOf<Pair<OwnerDeletion, InvoiceActionOutcome>?>(null) }
    var menuOpen by remember { mutableStateOf(false) }

    val owing = isOwing(inv)

    fun say(n: InvoiceNote) = note.show(Note(n.title, n.detail))

    fun openWeb(doing: String? = null) = navigator.open(InvoiceFacts.path(inv.id, web = true, doing = doing))

    /** After a sheet: its note on the page, or back to the list when the invoice is gone. */
    fun acted(o: InvoiceActionOutcome) {
        if (o.removed) navigator.back() else say(o.note)
    }

    fun act(a: InvoiceAct) {
        // An owner's sheet; the shop floor keeps the ERP's page, which says it is an owner's (the server refuses staff either way).
        if (owner) acting = a else openWeb()
    }

    ScreenActions {
        Box {
            IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                val item: @Composable (String, ImageVector, Boolean, () -> Unit) -> Unit = { label, icon, destructive, run ->
                    MenuAction(label, icon, destructive) { menuOpen = false; run() }
                }
                MenuHeading("Share")
                // The PDF Print saves, drawn on the ERP's server and shown here: Print, Save, WhatsApp from its share sheet.
                item("PDF", Icons.Filled.PictureAsPdf, false) { pdf = InvoiceFacts.pdfTarget(inv, byCustomer) }
                // The split button's other half (print-button.tsx): one invoice per piece, for pieces bought for several people.
                if (inv.items.size > 1) item("PDF per piece", Icons.Filled.FileCopy, false) { pdf = InvoiceFacts.pdfTarget(inv, byCustomer, perPiece = true) }
                item(if (inv.sentOnWhatsApp == null) "WhatsApp" else "WhatsApp again", Icons.AutoMirrored.Filled.Message, false) { sending = inv }
                InvoiceFacts.shareUrl(inv, House.serverUrl)?.let { link ->
                    item("Customer link", Icons.Filled.Link, false) {
                        val words = InvoiceFacts.shareMessage(inv, session.shop.name, byCustomer)
                        erp.app.device.shareText(context, InvoiceFacts.shareTitle(inv, byCustomer), "$words\n\n$link")
                    }
                }
                HorizontalDivider()
                MenuHeading("Change")
                item("Edit", Icons.Filled.Edit, false) { navigator.open(InvoiceFacts.editPath(inv.id)) }
                // Gold moves: the same edit, at its rates (owners', as Edit invoice is).
                if (owner) item("Change rate", Icons.Filled.Percent, false) { navigator.open(InvoiceFacts.changeRatePath(inv.id)) }
                if (inv.status != InvoiceStatus.refunded) {
                    // The store's own Firestore write on the web, which the shop floor cannot make: an owner's.
                    if (owner) item(if (InvoiceFacts.unnamed(inv)) "Name the customer" else "Change customer", Icons.Filled.Person, false) { settingCustomer = true }
                    item("Change discount", Icons.Filled.Percent, false) { act(InvoiceAct.Discount) }
                }
                HorizontalDivider()
                MenuHeading("More")
                item("Open in the ERP", Icons.Filled.Language, false) { openWeb() }
                HorizontalDivider()
                if (inv.status != InvoiceStatus.refunded) item("Refund…", Icons.AutoMirrored.Filled.Undo, true) { act(InvoiceAct.Refund) }
                item("Delete invoice…", Icons.Filled.Delete, true) { act(InvoiceAct.Delete) }
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(), // the page's column is PlaceScreen's (readableWidth: 820)
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                item { Hero(inv, owner) { settingCustomer = true } }
                item { QuickRow(inv, customers, byCustomer) { pdf = it } }
                item {
                    PiecesCard(inv, owner, allPieces) { allPieces = true }
                }
                item {
                    PaymentsCard(
                        inv, owner, owing,
                        mayTake = InvoiceFacts.mayTakePayment(role, inv, owing),
                        onTake = { paying = inv },
                        onDelete = { index, p -> paymentAsk = InvoiceActionWords.deletingPayment(inv, index, p) },
                        onGiveBack = { act(InvoiceAct.GiveBack) },
                    )
                }
                item { DetailsCard(inv, customers) { navigator.open(it) } }
                item { ShopCard(inv, role) }
            }
            // Taking a payment is THE action of an invoice that is owed.
            if (canPay && owing) {
                Button(
                    onClick = { paying = inv },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).defaultMinSize(minHeight = 52.dp),
                ) {
                    Icon(Icons.Filled.Payments, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    if (isLargeText()) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Take payment")
                            Text(Money.pkr(inv.balanceDue))
                        }
                    } else {
                        Text("Take payment · ${Money.pkr(inv.balanceDue)}", maxLines = 1)
                    }
                }
            }
        }
        InvoiceWhatsAppSend(
            invoice = sending,
            onStarted = { sending = null },
            openWeb = { _, doing -> openWeb(doing) },
            sent = { say(it) },
        )
    }

    paying?.let { picked ->
        InvoicePaymentSheet(picked, onDismiss = { paying = null }, recorded = { paid, amount -> note.show(Note("Payment recorded", InvoiceFacts.recordedDetail(paid, amount))) })
    }
    if (settingCustomer) InvoiceCustomerSheet(inv, onDismiss = { settingCustomer = false }, onSaved = { say(it) })
    when (acting) {
        InvoiceAct.Discount -> InvoiceDiscountSheet(inv, onDismiss = { acting = null }, onDone = ::acted)
        InvoiceAct.Payment -> InvoicePaymentDeleteSheet(inv, onDismiss = { acting = null }, onDone = ::acted)
        InvoiceAct.GiveBack -> InvoiceCreditSheet(inv, onDismiss = { acting = null }, onDone = ::acted)
        InvoiceAct.Refund -> InvoiceRefundSheet(inv, onDismiss = { acting = null }, onDone = ::acted)
        InvoiceAct.Delete -> InvoiceDeleteSheet(inv, onDismiss = { acting = null }, onDone = ::acted)
        null -> Unit
    }
    paymentAsk?.let { (deletion, outcome) ->
        OwnerDeleteCodeSheet(deletion, onDismiss = { paymentAsk = null }, onDone = { acted(outcome) })
    }
    pdf?.let { InvoicePdfDialog(it, onDismiss = { pdf = null }) }
}

/** The payment sheet for an invoice (the kit's PaymentSheet), the balance one tap away. */
@Composable
internal fun InvoicePaymentSheet(inv: Invoice, onDismiss: () -> Unit, recorded: ((Invoice, Double) -> Unit)? = null) {
    // Money over the balance is a named customer's credit; a walk-in's is refused (invoice-credit.ts).
    PaymentSheet(
        title = "Take payment · ${inv.id}",
        onDismiss = onDismiss,
        onSave = { entry ->
            InvoiceFacts.record(inv, entry.amount, entry.method, entry.reference)
            recorded?.invoke(inv, entry.amount)
        },
        // Settle changes the discount, which is an owner's to change (/api/app/write updateInvoiceDiscount), so
        // staff are offered Save alone.
        settle = if (LocalSession.current.isOwner) { entry, remainder ->
            InvoiceFacts.settle(inv, entry.amount, entry.method, entry.reference, remainder)
            // The page's note works out what is left from what came off the balance: the payment and the
            // remainder given off together, so it says "Paid in full".
            recorded?.invoke(inv, entry.amount + remainder)
        } else null,
        owed = if (owesMoney(inv.balanceDue)) inv.balanceDue else null,
        customer = PaymentCustomer(name = inv.customerName, canHoldCredit = canHoldCredit(inv.customerId)),
    )
}

@Composable
private fun MenuAction(label: String, icon: ImageVector, destructive: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, color = if (destructive) Tone.problem.color() else androidx.compose.ui.graphics.Color.Unspecified) },
        leadingIcon = { Icon(icon, null, tint = if (destructive) Tone.problem.color() else MaterialTheme.colorScheme.onSurfaceVariant) },
        onClick = onClick,
    )
}

@Composable
private fun MenuHeading(text: String) {
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

// MARK: The receipt: who, when, what is due

/**
 * Who it was for and when, then what is still due (or credit, or paid in full) beside the ring of what is paid,
 * with the total and the paid sum under it.
 */
@Composable
private fun Hero(inv: Invoice, owner: Boolean, nameThem: () -> Unit) {
    val large = isLargeText()
    val whenSaid = ShopDate.say(inv.createdAt, withTime = true)
    Column(Modifier.heroSheen(padding = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (large) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Monogram(inv.customerName, size = MonogramSize.hero)
                WhoBlock(inv, whenSaid, Modifier)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Monogram(inv.customerName, size = MonogramSize.hero)
                WhoBlock(inv, whenSaid, Modifier.weight(1f))
            }
        }
        // A sale to nobody in particular, named once the bill is out (decision "Name a sale"): an owner's, as on the web.
        if (owner && InvoiceFacts.unnamed(inv) && inv.status != InvoiceStatus.refunded) {
            Row(
                Modifier
                    .defaultMinSize(minHeight = 48.dp)
                    .clip(CircleShape)
                    .background(ErpColors.accent.copy(alpha = 0.12f))
                    .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = nameThem)
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.PersonAdd, contentDescription = null, tint = ErpColors.accent)
                Text("Name the customer", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold), color = ErpColors.accent)
            }
        }
        PerforationDivider()
        Figures(inv)
        // Whoever opens it next sees the PDF went, so it is not sent twice.
        inv.sentOnWhatsApp?.let { sent ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("PDF sent to ${sent.to} · ${ShopDate.say(sent.at, withTime = true)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The customer's name in the serif, when it was made, and how many pieces and who took it. */
@Composable
private fun WhoBlock(inv: Invoice, whenSaid: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            InvoiceFacts.customerName(inv, walkIn = "Walk-in"),
            style = ErpType.heading.copy(fontSize = 24.sp, lineHeight = 30.sp),
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (whenSaid.isNotEmpty()) {
            Text(whenSaid, style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(InvoiceFacts.piecesLine(inv), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, modifier = Modifier.weight(1f, fill = false))
            if (InvoiceFacts.isShopify(inv)) Pill("Shopify")
        }
    }
}

/** What is due as the big figure, the ring of what is paid beside it, and both sums in a line under. */
@Composable
private fun Figures(inv: Invoice) {
    val lead: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            LeadFigure(inv)
            Text(
                "Total ${Money.pkr(inv.grandTotal)} · Paid ${Money.pkr(inv.amountPaid)}",
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    if (isLargeText()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { lead(); PaidRing(inv.amountPaid, inv.grandTotal) }
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { lead() }
            PaidRing(inv.amountPaid, inv.grandTotal)
        }
    }
}

/** Due while owing (amber, red once old), In credit, or Paid in full; a refunded invoice says Refunded instead. */
@Composable
private fun LeadFigure(inv: Invoice) {
    val line = balanceLine(inv.balanceDue)
    if (inv.status == InvoiceStatus.refunded) {
        Pill("Refunded", tone = Tone.quiet, icon = Icons.AutoMirrored.Filled.Undo)
        return
    }
    when (line.state) {
        BalanceState.due -> {
            Text("Due", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HeroAmount(line.amount, tone = InvoiceFacts.balanceTone(inv).color())
        }
        BalanceState.credit -> {
            Text("In credit", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HeroAmount(line.amount, tone = Tone.credit.color())
        }
        BalanceState.paid -> Text("Paid in full", style = ErpType.heroNumber, color = Tone.settled.color(), maxLines = 1)
    }
}

// MARK: What is done most, one tap away

/** Ring, write or message the customer, and the PDF: the things the counter does after a sale. Taking the money is the bar at the foot. */
@Composable
private fun QuickRow(inv: Invoice, customers: List<erp.core.models.Customer>, byCustomer: Boolean, openPdf: (InvoicePdfTarget) -> Unit) {
    val phone = InvoiceFacts.whatsAppPhone(inv, inv.customerId?.let { id -> customers.firstOrNull { it.id == id } })
    val reachable = InvoiceFacts.dialable(phone).isNotEmpty()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        if (reachable) ContactActions(phone, Modifier.weight(1f))
        QuickAction("PDF", Icons.Filled.PictureAsPdf, { openPdf(InvoiceFacts.pdfTarget(inv, byCustomer)) }, Modifier.width(if (reachable) 88.dp else 110.dp))
    }
}

// MARK: The pieces, as the bill reads them

@Composable
private fun PiecesCard(inv: Invoice, owner: Boolean, all: Boolean, showAll: () -> Unit) {
    val items = inv.items
    val shown = if (all) items else items.take(FIRST_PIECES)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Pieces", Modifier.padding(horizontal = 16.dp), count = items.size)
        Column(Modifier.ledgerCard().animateContentSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (items.isEmpty()) Text("No pieces on this invoice.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            shown.forEach { PieceRow(it, owner) }
            if (!all && items.size > FIRST_PIECES) TextButton(onClick = showAll) { Text("Show ${items.size - FIRST_PIECES} more") }
            PerforationDivider()
            TotalRows(inv)
        }
    }
}

/** One piece: what it is and its price, then its metal, weight and stock number, what is set into it, and the breakdown the printed bill carries. */
@Composable
private fun PieceRow(item: InvoiceItem, showBreakdown: Boolean) {
    val facts = InvoiceWords.pieceFacts(item)
    val settings = InvoiceWords.pieceSettings(item)
    val costs = InvoiceWords.pieceCosts(item)
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        // The name leading and the price trailing; at accessibility sizes the price goes under the name.
        if (isLargeText()) {
            Text(InvoiceWords.pieceTitle(item), style = MaterialTheme.typography.titleMedium)
            RowAmount(item.itemTotal)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Text(InvoiceWords.pieceTitle(item), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                RowAmount(item.itemTotal)
            }
        }
        if (facts.isNotEmpty()) Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        settings.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (showBreakdown && costs.isNotEmpty()) {
            Text(costs.joinToString(" · "), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * Under the pieces, as the printed bill: the subtotal, the discount, each exchange row on its own line (what was
 * taken in, lib/exchange.ts), any adjustment, and the one Total; the rates it was priced at, unless it leaves them
 * off (`hideRates`: the bill is priced at these rates and just does not say so).
 */
@Composable
private fun TotalRows(inv: Invoice) {
    val exchanges = invoiceExchanges(inv)
    val adjustments = inv.adjustmentsAmount ?: 0.0
    val rates = InvoiceWords.appliedRates(inv)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MoneyRow("Subtotal", inv.subtotal)
        if (inv.discountAmount > 0) MoneyRow("Discount", -inv.discountAmount, signed = true)
        if (exchangeTotal(exchanges) > 0) exchanges.forEach { ExchangeRowView(it) }
        if (adjustments != 0.0) MoneyRow("Adjustments", adjustments, signed = true)
        MoneyRow("Total", inv.grandTotal, emphasis = true)
        if (!inv.hideRates && rates.isNotEmpty()) {
            Text(
                "Rates applied · " + rates.joinToString("  ·  "),
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ExchangeRowView(e: ExchangeEntry) {
    val said = describeExchangeEntry(e)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (e.value > 0) MoneyRow("Exchange", -e.value, signed = true) else LabelValue("Exchange", "—")
        if (said.isNotEmpty()) Text(said, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Payments

/**
 * Always there: what came in, or that nothing has. An owner swipes a payment to delete it (the delete code is asked
 * next, saying what the invoice will read after); a long press offers the same.
 */
@Composable
private fun PaymentsCard(
    inv: Invoice,
    owner: Boolean,
    owing: Boolean,
    mayTake: Boolean,
    onTake: () -> Unit,
    onDelete: (Int, Payment) -> Unit,
    onGiveBack: () -> Unit,
) {
    val line = balanceLine(inv.balanceDue)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading(
            "Payments", Modifier.padding(horizontal = 16.dp),
            count = if (inv.paymentHistory.size > 1) inv.paymentHistory.size else null,
            trailing = Money.pkr(inv.amountPaid),
        )
        Column(Modifier.fillMaxWidth().clip(erp.app.ui.Radius.cardShape).background(ErpColors.card)) {
            if (inv.paymentHistory.isEmpty()) {
                Text("No payments yet", Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            inv.paymentHistory.forEachIndexed { index, p ->
                if (index > 0) erp.app.ui.LedgerDivider()
                if (owner) {
                    SwipeActions(end = RowAction("Delete payment", Icons.Filled.Delete, Tone.problem) { onDelete(index, p) }, menu = listOf(RowAction("Delete payment", Icons.Filled.Delete, Tone.problem) { onDelete(index, p) })) {
                        PaymentRow(p)
                    }
                } else {
                    PaymentRow(p)
                }
            }
            if (mayTake && (inv.paymentHistory.isEmpty() || !owing)) {
                TextButton(onClick = onTake, Modifier.padding(horizontal = 8.dp)) {
                    Icon(Icons.Filled.Payments, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (owing) "Take payment" else "Take payment as credit")
                }
            }
            // Paid past the total: the customer's credit, on their hisaab (decision "Invoice credit").
            if (line.state == BalanceState.credit && inv.status != InvoiceStatus.refunded && inv.paymentHistory.isNotEmpty()) {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = null, tint = Tone.credit.color())
                    Text(
                        "${line.label} · ${Money.pkr(line.amount)}, on ${InvoiceFacts.customerName(inv, walkIn = "the customer")}'s hisaab",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        color = Tone.credit.color(),
                    )
                }
                // Finish the credit by handing the money over (an owner's; a walk-in holds none).
                if (owner && InvoiceCredit.canGiveBack(inv)) {
                    TextButton(onClick = onGiveBack, Modifier.padding(horizontal = 8.dp)) {
                        Icon(Icons.Filled.Payments, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(InvoiceCredit.buttonWords(inv))
                    }
                }
            }
        }
    }
}

/** One payment: how it came (its symbol), when, any reference or note, and the amount. A refund reads as one, quietly. */
@Composable
private fun PaymentRow(p: Payment) {
    val refund = InvoiceWords.isRefund(p)
    val tone = if (refund) Tone.quiet else Tone.settled
    val symbol: ImageVector = if (refund) Icons.AutoMirrored.Filled.Undo else when (p.method) {
        PaymentType.cash -> Icons.Filled.Payments
        PaymentType.card -> Icons.Filled.CreditCard
        PaymentType.bankTransfer -> Icons.Filled.AccountBalance
        PaymentType.cheque -> Icons.Filled.Description
        else -> Icons.Filled.ArrowCircleDown
    }
    Row(
        Modifier.fillMaxWidth().background(ErpColors.card).defaultMinSize(minHeight = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(34.dp).clip(CircleShape).background(tone.fill().copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(symbol, contentDescription = null, Modifier.size(18.dp), tint = tone.color())
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(InvoiceWords.paymentTitle(p), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            Text(InvoiceWords.paymentDetail(p), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        if (refund) {
            Text(
                Money.minus(p.amount),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
            )
        } else {
            RowAmount(p.amount)
        }
    }
}

// MARK: Details

/** Where it came from, where it goes, who took it and how it reached us: the quiet facts. */
@Composable
private fun DetailsCard(inv: Invoice, customers: List<erp.core.models.Customer>, open: (String) -> Unit) {
    val order = inv.sourceOrderId ?: ""
    val ship = describeDelivery(inv.delivery)
    val by = inv.takenBy ?: ""
    val source = InvoiceWords.sourceWords(inv)
    // The customer's id when the sale has a real one: not a walk-in however it was recorded, and not just a typed name.
    val key = saleCustomerKey(inv) { cid -> customers.firstOrNull { it.id == cid }?.name }
    val customerId = if (key == WALK_IN_ENTITY || key.startsWith("name:")) null else key
    if (customerId == null && order.isEmpty() && ship.isEmpty() && by.isEmpty() && source == null) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Details", Modifier.padding(horizontal = 16.dp))
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (customerId != null) LinkRow("Customer", InvoiceFacts.customerName(inv, walkIn = "Walk-in")) { open("/customers/" + InvoiceFacts.encode(customerId)) }
            if (order.isNotEmpty()) LinkRow("From order", order) { open("/orders/" + InvoiceFacts.encode(order)) }
            if (ship.isNotEmpty()) LabelValue("Deliver to", ship.joinToString("\n"))
            if (by.isNotEmpty()) LabelValue("Taken by", by)
            if (source != null) LabelValue("Source", source)
        }
    }
}

@Composable
private fun LabelValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, Modifier.weight(1.5f), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End)
    }
}

@Composable
private fun LinkRow(label: String, value: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End)
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: For the shop

/** The shop's margin (owners and staff; blurred until tapped) and the note nobody but the shop reads. */
@Composable
private fun ShopCard(inv: Invoice, role: String) {
    val settings = House.margin
    // The margin is the shop's own (lib/margin.ts): owners and staff see it, never a customer.
    val showsMargin = InvoiceWords.showsMargin(settings) && (role == "owner" || role == "staff")
    val shopNote = (inv.internalNote ?: "").trim()
    if (shopNote.isEmpty() && !showsMargin) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.padding(horizontal = 16.dp).semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lock, contentDescription = null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("For the shop (never printed)", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (showsMargin) MarginRow(inv, settings)
            if (shopNote.isNotEmpty()) Text(shopNote, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * What the shop earns on this sale (lib/margin.ts), for owners and staff and blurred until tapped: the counter turns
 * its screen to show a customer the bill, and a margin beside the total is the one thing they must not read. The
 * figure is not worked out until then, and it is in nothing that is printed, shared or linked.
 */
@Composable
private fun MarginRow(inv: Invoice, settings: erp.core.logic.MarginSettings) {
    var shown by remember(inv.id) { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp)
            .clickable(role = androidx.compose.ui.semantics.Role.Button) { shown = !shown }
            .semantics { contentDescription = if (shown) "Hide our margin" else "Show our margin" },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("We earn", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        if (shown) {
            val m: Margin = invoiceMargin(inv, settings)
            Text(
                InvoiceWords.marginWords(m, settings, percentLabel(m)),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = TabularDigits),
                textAlign = TextAlign.End,
                color = if (m.assumed) MaterialTheme.colorScheme.onSurfaceVariant else if (m.percent < 0) Tone.late.color() else Tone.settled.color(),
            )
        } else {
            // Stand-in digits, never the figure: where blur is unavailable (Android 11 and older) nothing is given away.
            Text(
                "00.0% · PKR 00,000",
                Modifier.blur(6.dp).alpha(0.6f).clearAndSetSemantics {},
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = TabularDigits),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
