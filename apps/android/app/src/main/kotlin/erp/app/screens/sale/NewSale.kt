package erp.app.screens.sale

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenRegistry
import erp.app.nav.ScreenTitle
import erp.app.ui.EntryContinue
import erp.app.ui.EntrySteps
import erp.app.ui.EntryStep
import erp.app.ui.LocalReduceMotion
import erp.app.ui.Motion
import erp.app.ui.MoneyFeedback
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TransactionReview
import erp.app.ui.TransactionReviewRow
import erp.app.ui.TransactionWorkspace
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.entry.EntryHouse
import erp.core.entry.SaleEdit
import erp.core.entry.SaleFigures
import erp.core.logic.Money
import erp.core.logic.ratesSetToday
import erp.core.logic.whenSet
import erp.core.models.Settings
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlinx.coroutines.delay

/**
 * A new sale (src/components/sale/sale-page.tsx, `/invoices/new`): the customer, the pieces, the rates, a discount,
 * what is handed over in exchange, what is paid now, and the shop's own notes, then Save, which the ERP writes as the
 * browser does (`createInvoice`, lib/writes/create-invoice.ts) and opens the invoice.
 *
 * A piece that was never in stock is described on the spot ("New item", a NEW- key that is not a stock number); the
 * server sells it without a stock check and refuses it only if it was sold already.
 *
 * What stays the ERP's page: adding a piece to stock. Owners only, as the ERP's write is.
 *
 * An unfinished sale is kept on this phone (SaleStore) and in the ERP's Drafts, in the sale page's own shape, so the
 * counter can finish it (WorkDraftSync, SaleWebDraft). "Start over" empties both.
 *
 * [readsBill]: opened from the New chooser's Read a written bill, the reader comes up over the form, once.
 */
@Composable
fun NewSale(readsBill: Boolean = false) {
    if (LocalSession.current.isOwner) {
        SaleForm(startsReading = readsBill)
    } else {
        OwnersOnly()
    }
}

/** Staff cannot make a sale in the browser either (the ERP's write is for owners). */
@Composable
private fun OwnersOnly() {
    ScreenTitle("New sale")
    val navigator = LocalNavigator.current
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        NotAvailableState(
            "Sales are for the owners",
            why = "The ERP doesn't let staff make a sale either. You can take an order or a repair, or take a payment on an invoice.",
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = { navigator.open("/orders/add") }) { Text("New order") }
            TextButton(onClick = { navigator.open("/invoices") }) { Text("Invoices") }
        }
    }
}

/** The sale form: [edit] is Edit invoice (SaleEdit), opened on the invoice on file. */
@Composable
fun SaleForm(edit: SaleEdit? = null, startsReading: Boolean = false) {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val settingsLoaded by book.settings.loaded.collectAsStateWithLifecycle()
    val s = remember { SaleFormState(book, edit, session.shop.person ?: "", startsReading, { navigator.open(it) }, { navigator.back() }) }

    // This phone's own unfinished sale, written as it is typed (SaleFormState.setDraft). It is read again whenever the
    // screen shows, and kept in Drafts a moment after the last change; going away sends what is waiting.
    LaunchedEffect(Unit) {
        book.settings.need()
        book.products.need()
        book.customers.need()
        book.invoices.need()
        s.appeared()
    }
    DisposableEffect(Unit) { onDispose { s.disappeared() } }
    // The sale made: a tick felt as it lands.
    MoneyFeedback(success = s.made, failure = null)

    val reduce = LocalReduceMotion.current
    val phase = when {
        s.made != null -> 0
        !settingsLoaded -> 1
        else -> 2
    }
    // The sale made: the form gives way to its invoice on the page's curve.
    Crossfade(phase, animationSpec = Motion.travel(reduce), label = "sale") { p ->
        when (p) {
            0 -> Box(Modifier.fillMaxSize()) {
                s.made?.let { ScreenRegistry.Screen(SaleLinks.invoice(it)) }
                RatesNoteBanner(s, Modifier.align(Alignment.TopCenter))
            }
            1 -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SkeletonLoading() }
            else -> Page(s)
        }
    }
}

/** A line over the invoice when a rate typed on the sale could not be kept as the shop's (the web's toast). */
@Composable
private fun RatesNoteBanner(s: SaleFormState, modifier: Modifier) {
    val note = s.ratesNote ?: return
    LaunchedEffect(note) {
        delay(8000)
        s.ratesNote = null
    }
    Text(
        note,
        modifier.padding(horizontal = 16.dp, vertical = 6.dp).clip(Radius.chipShape).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 14.dp, vertical = 8.dp),
        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
        textAlign = TextAlign.Center,
    )
}

// MARK: The page

@Composable
private fun Page(s: SaleFormState) {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val products by rememberShelf(book.products)
    val productsLoaded = rememberShelfStatus(book.products).loaded
    val invoices by rememberShelf(book.invoices)
    // Orders are only read for the people served lately: not started here, as the iPhone does not start them either.
    val orders by book.orders.items.collectAsStateWithLifecycle()
    val customers by rememberShelf(book.customers)
    val settings by rememberSingle(book.settings)
    val data = SaleData(products, productsLoaded, invoices, orders, customers, settings)
    val f = SaleFigures(s.draft, settings, customers, EntryHouse.margin)
    val edit = s.edit

    ScreenTitle(edit?.let { "Edit ${it.invoiceId}" } ?: "New sale")
    if (edit == null) {
        // Throwing the sale away is a menu's item, not a red button beside the title.
        ScreenActions {
            var menu by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Start over", color = Tone.late.color()) },
                        enabled = !s.draft.isBlank,
                        onClick = { menu = false; s.confirmingReset = true },
                    )
                }
            }
        }
    }
    TransactionWorkspace(
        modifier = Modifier.keyboardSafe(),
        editor = {
            Column(Modifier.fillMaxSize()) {
                EntrySteps(s.step, { s.step = it }, states = stepStates(f))
                if (s.step == EntryStep.pieces || s.step == EntryStep.payment) SaleSummary(f)
                Crossfade(s.step, Modifier.weight(1f), animationSpec = Motion.enter(LocalReduceMotion.current), label = "step") { step ->
                    Column(
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        if (edit != null) EditBanner(edit)
                        when (step) {
                            EntryStep.customer -> CustomerSection(s, f, data)
                            EntryStep.pieces -> {
                                PiecesSection(s, f, data)
                                RatesSection(s, f, data)
                            }
                            EntryStep.payment -> {
                                DiscountSection(s, f)
                                ExchangeSection(s)
                                PaymentSection(s, f)
                            }
                            EntryStep.review -> ReviewSteps(s, f, data)
                        }
                    }
                }
            }
        },
        review = {
            TransactionReview(
                customer = f.who.name,
                contact = s.draft.customerPhone,
                pieces = s.draft.lines.mapIndexed { index, line ->
                    TransactionReviewRow("${index + 1}. ${line.name}", if (f.hasEstimate) Money.pkr(f.price(line.sku)) else "Pending rates")
                },
                figures = listOf(
                    TransactionReviewRow("Subtotal", if (f.hasEstimate) Money.pkr(f.subtotal) else "Pending rates"),
                    TransactionReviewRow("Discount", Money.pkr(f.discount)),
                    TransactionReviewRow("Exchange", Money.pkr(f.exchange)),
                    TransactionReviewRow("Paid now", Money.pkr(f.paidNow)),
                    TransactionReviewRow(if (f.balance < 0) "Credit to customer" else "Balance due", if (f.hasEstimate) Money.pkr(kotlin.math.abs(f.balance)) else "Pending rates"),
                ),
            )
        },
        footer = {
            if (s.step == EntryStep.review) SaveBar(s, f) { navigator.open(it) } else EntryContinue(s.step, { s.step = it })
        },
    )

    Sheets(s, f, settings)
}

@Composable
private fun EditBanner(edit: SaleEdit) {
    Row(Modifier.ledgerCard(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Edit, contentDescription = null, Modifier.size(20.dp), tint = ErpColors.accent)
        Text(
            if (edit.paidBefore > 0) {
                "${Money.pkr(edit.paidBefore)} paid before stays on ${edit.invoiceId}. A payment added below is taken now. A piece taken off stays sold."
            } else {
                "Nothing is paid on ${edit.invoiceId} yet. A payment added below is taken now. A piece taken off stays sold."
            },
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun ReviewSteps(s: SaleFormState, f: SaleFigures, d: SaleData) {
    // The sum first: it is what the customer is told.
    TotalsSection(f)
    SaleSection("Review") {
        ValueRow("Customer") { Text(f.who.name.ifEmpty { "Walk-in" }, style = MaterialTheme.typography.bodyLarge) }
        if (s.draft.customerPhone.isNotEmpty()) ValueRow("Phone") { Text(s.draft.customerPhone, style = MaterialTheme.typography.bodyLarge) }
        ActionRow("Edit pieces", { s.step = EntryStep.pieces })
        ActionRow("Edit payment and exchange", { s.step = EntryStep.payment })
    }
    if (s.draft.lines.isNotEmpty()) {
        SaleSection("Pieces") { s.draft.lines.forEach { line -> LineRow(s, line, f, d) } }
    }
    ShopSection(s, f, d)
    DeliverySection(s, f, d)
    OrderSection(s)
}

/** The sheets and questions over the form. */
@Composable
private fun Sheets(s: SaleFormState, f: SaleFigures, settings: Settings?) {
    s.editing?.let { line ->
        SaleLineEditor(line, f.rateBook.pricing, onApply = { changed -> s.replace(line.sku, changed) }, onDismiss = { s.editing = null })
    }
    s.newItem?.let { line ->
        SaleLineEditor(line, f.rateBook.pricing, onApply = { made -> s.addNew(made) }, onDismiss = { s.newItem = null }, create = true)
    }
    if (s.scanning) SaleScanSheet(handle = { code -> s.scanned(code) }, onDismiss = { s.scanning = false })
    if (s.rateSheet) SaleRateSheet(settings) { s.rateSheet = false }
    if (s.readingBill) {
        SaleScanScreen(draft = s.draft, onDraft = { s.replaceDraft(it) }, keep = s.edit == null, onClose = { s.readingBill = false })
    }
    if (s.confirmingReset) {
        AlertDialog(
            onDismissRequest = { s.confirmingReset = false },
            title = { Text("Start over?") },
            text = { Text("This empties the sale on this phone and takes it out of Drafts: the pieces, the customer and everything typed.") },
            confirmButton = { TextButton(onClick = { s.confirmingReset = false; s.startOver() }) { Text("Start over", color = Tone.late.color()) } },
            dismissButton = { TextButton(onClick = { s.confirmingReset = false }) { Text("Cancel") } },
        )
    }
    if (s.confirmingOrder) {
        AlertDialog(
            onDismissRequest = { s.confirmingOrder = false },
            title = { Text("Replace the order in progress?") },
            text = { Text("An order is half typed on this phone. Making one from these pieces replaces it.") },
            confirmButton = { TextButton(onClick = { s.confirmingOrder = false; s.createOrder() }) { Text("Replace it", color = Tone.late.color()) } },
            dismissButton = { TextButton(onClick = { s.confirmingOrder = false }) { Text("Cancel") } },
        )
    }
}

// MARK: Today's rate, to read

private val rateFormat = DecimalFormat("#,##0.##", DecimalFormatSymbols(Locale.US))

/** A rate not yet set reads as a dash, not a zero; set ones are grouped with their decimals ("26,250", "345.5"). */
private fun rateShown(n: Double): String = if (n > 0) rateFormat.format(n) else "—"

/**
 * The day's rates to read, from the stale-rate line (the iPhone opens its rate sheet here). Setting them is the rate
 * chip's, at the top of every tab.
 */
@Composable
private fun SaleRateSheet(settings: Settings?, onDismiss: () -> Unit) {
    val silver = House.metal == "silver"
    val today = ratesSetToday(settings?.ratesUpdatedAt)
    val setLine = listOfNotNull(whenSet(settings?.ratesUpdatedAt), settings?.ratesUpdatedBy).filter { it.isNotEmpty() }.joinToString(" · ")
    val isOwner = LocalSession.current.isOwner
    FullScreenSheet(title = "Today’s rate", onCancel = onDismiss, confirmText = "Done", onConfirm = onDismiss, cancelText = "Done") {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SaleSection(
                "Rate",
                footer = {
                    Text(
                        if (today) "PKR per gram. " + (if (isOwner) "Change it from the rate chip." else "Only an owner can change the rate.")
                        else "This rate was not set today. " + (if (isOwner) "Set it from the rate chip." else "An owner sets it."),
                    )
                },
            ) {
                ValueRow(if (silver) "Silver" else "21K") {
                    Text("PKR " + rateShown(settings?.let { if (silver) it.silverRatePerGram else it.goldRatePerGram21k } ?: 0.0))
                }
                ValueRow("Set") { Text(setLine) }
            }
            val gold = "Gold" to listOf(
                "24K" to (settings?.goldRatePerGram24k ?: 0.0), "22K" to (settings?.goldRatePerGram22k ?: 0.0),
                "21K" to (settings?.goldRatePerGram21k ?: 0.0), "18K" to (settings?.goldRatePerGram18k ?: 0.0),
            )
            val palladium = "Palladium" to listOf(
                "18K" to (settings?.palladiumRatePerGram18k ?: 0.0), "12K" to (settings?.palladiumRatePerGram12k ?: 0.0),
                "Flat" to (settings?.palladiumRatePerGram ?: 0.0),
            )
            val groups = if (silver) {
                listOf("Silver" to listOf("Per gram" to (settings?.silverRatePerGram ?: 0.0)), gold, palladium, "Other metals" to listOf("Platinum" to (settings?.platinumRatePerGram ?: 0.0)))
            } else {
                listOf(gold, palladium, "Other metals" to listOf("Silver" to (settings?.silverRatePerGram ?: 0.0), "Platinum" to (settings?.platinumRatePerGram ?: 0.0)))
            }
            groups.forEach { (title, fields) ->
                SaleSection(
                    title,
                    footer = if (title == "Palladium") ({ Text("Left at zero, 18K and 12K palladium are priced from the flat rate.") }) else null,
                ) {
                    fields.forEach { (label, value) -> ValueRow(label) { Text(rateShown(value)) } }
                }
            }
        }
    }
}
