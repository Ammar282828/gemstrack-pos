package erp.app.screens.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.LedgerHeading
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.NotAvailableState
import erp.app.ui.PaymentText
import erp.app.ui.Pill
import erp.app.ui.RoundOffChips
import erp.app.ui.RowAmount
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TransactionReview
import erp.app.ui.TransactionReviewRow
import erp.app.ui.TransactionWorkspace
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.entry.NewOrderFormat
import erp.core.entry.SaleNumber
import erp.core.logic.Money
import erp.core.logic.RateField
import erp.core.logic.finalizeRateRows
import erp.core.logic.orderInvoiceRates
import erp.core.logic.rateShown
import erp.core.logic.isCredit
import erp.core.logic.takesWastageAndMaking
import erp.core.models.Order
import erp.core.models.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Finalize & invoice (/orders/<id>/finalize; the web's dialog on the order page, ?do=finalize): each finished
 * piece's weight, wastage, making, stones and diamonds (or a fixed price), the discount and the shop's 24k rate,
 * with what the invoice comes to as they are typed (OrderFinalizeModel). Finalize asks once, with the total and
 * the balance, then the ERP makes the invoice (`finalizeOrder`, lib/writes/finalize-order.ts, owners only as in the
 * browser): the next number, the advances as payments, the exchange, the order Completed and linked, the hisaab.
 * The invoice then opens in this screen's place.
 */
@Composable
fun OrderFinalizeScreen(id: String) {
    ScreenTitle("Make invoice")
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val haptics = rememberHaptics()
    val me by session.me.collectAsStateWithLifecycle()
    val isOwner = me?.role == "owner"
    val orders = rememberShelfStatus(book.orders)
    rememberShelf(book.invoices)
    val settings by rememberSingle(book.settings)
    val order = orders.items.firstOrNull { it.id == id }

    var rows by remember { mutableStateOf(listOf<OrderFinalizeRow>()) }
    var discount by remember { mutableStateOf("") }
    // The rate boxes as typed: the order's booked rates to start with (gold moves; the counter may change any).
    var rateTexts by remember { mutableStateOf<RateTexts>(emptyMap()) }
    var costTola by remember { mutableStateOf("") }
    var started by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var made by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // The dialog's opening figures, once: the order's own.
    LaunchedEffect(order?.id, settings != null) {
        if (started || order == null || settings == null) return@LaunchedEffect
        rows = order.items.mapIndexed { i, item -> OrderFinalizeRow.of(item, i) }
        settings?.let { rateTexts = OrderFinalizeMath.bookedTexts(order, it) }
        discount = erp.core.entry.NewOrderFormat.rupeeBox(order.discountAmount)
        val perGram = order.costRate24k ?: 0.0
        costTola = if (perGram > 0) OrdersLogic.halfAway(perGram * erp.core.entry.NewOrderWords.gramsPerTola).toLong().toString() else ""
        started = true
    }
    LaunchedEffect(failure) { if (failure != null) haptics.failure() }
    LaunchedEffect(made) { if (made != null) haptics.success() }

    // The invoice made, it opens in this screen's place.
    LaunchedEffect(made) {
        val invoiceId = made ?: return@LaunchedEffect
        navigator.replace(OrderPaths.invoice(invoiceId))
    }

    val s = settings
    when {
        made != null -> SkeletonLoading(Modifier.fillMaxSize())
        !isOwner -> NotAvailableState("Only an owner can invoice an order", why = "Ask an owner to finalize it.")
        order != null && s != null -> {
            val inv = order.invoiceId
            if (!inv.isNullOrEmpty()) {
                NotAvailableState("Invoiced already", why = "${order.id} is on $inv.", icon = Icons.Filled.Description)
            } else {
                FinalizeForm(
                    order, s, rows, { rows = it }, rateTexts, { rateTexts = it }, discount, { discount = it }, costTola, { costTola = it },
                    saving, failure, confirming, { confirming = it }, { failure = it },
                ) {
                    scope.launch {
                        saving = true
                        failure = null
                        try {
                            val out = ErpApi.shared.write("finalizeOrder", OrderFinalizeMath.request(order.id, rows, discount, costTola, OrderFinalizeMath.changedRates(order, s, rateTexts)))
                            val invoiceId = ((out["invoice"] as? Map<*, *>)?.get("id") as? String) ?: ""
                            if (invoiceId.isEmpty()) {
                                failure = "The invoice was made, but the ERP did not say its number. Look for it under Invoices."
                            } else {
                                // The invoice reaches the shelf a moment after the server writes it.
                                for (n in 0 until 12) {
                                    if (book.invoices.item(invoiceId) != null) break
                                    delay(250)
                                }
                                made = invoiceId
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: ErpApi.Failure) {
                            failure = if (e.status == 0) e.message + "\n\nIf the connection dropped, the invoice may have been made. Check the order before trying again." else e.message
                        } catch (e: Exception) {
                            failure = ordersSay(e) + "\n\nIf the connection dropped, the invoice may have been made. Check the order before trying again."
                        }
                        saving = false
                    }
                }
            }
        }
        orders.loaded && order == null -> NotAvailableState("No such order", why = "$id isn't in the book.")
        else -> SkeletonLoading(Modifier.fillMaxSize())
    }
}

// MARK: The form

@Composable
private fun FinalizeForm(
    order: Order,
    settings: Settings,
    rows: List<OrderFinalizeRow>,
    setRows: (List<OrderFinalizeRow>) -> Unit,
    rateTexts: RateTexts,
    setRateTexts: (RateTexts) -> Unit,
    discount: String,
    setDiscount: (String) -> Unit,
    costTola: String,
    setCostTola: (String) -> Unit,
    saving: Boolean,
    failure: String?,
    confirming: Boolean,
    setConfirming: (Boolean) -> Unit,
    setFailure: (String?) -> Unit,
    onFinalize: () -> Unit,
) {
    val f = remember(order, rows, discount, settings, rateTexts) { OrderFinalizeMath.figures(order, rows, discount, settings, rateTexts) }
    fun update(i: Int, change: (OrderFinalizeRow) -> OrderFinalizeRow) = setRows(rows.mapIndexed { n, r -> if (n == i) change(r) else r })

    TransactionWorkspace(
        editor = {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Header(order, f.balance)
                RatesSection(order, settings, rateTexts, setRateTexts, enabled = !saving)
                for (row in rows) {
                    PieceSection(row, if (row.index < f.prices.size) f.prices[row.index] else 0.0) { change -> update(row.index, change) }
                }
                Section(footer = "The 24k rate is the shop's own, for its margin. It is never printed.") {
                    Field("Discount", discount, setDiscount, KeyboardType.Number, "0", enabled = !saving)
                    // FinalizeOrderDialog: the bill before any discount is the pieces less the exchange.
                    RoundOffChips(f.subtotal - f.exchange, f.discount) { n -> setDiscount(NewOrderFormat.rupeeBox(n)) }
                    // The shop's own figure for its margin: owners only, never the customer (decisions.md "Margin").
                    Field("24k a tola now", costTola, setCostTola, KeyboardType.Number, "For the margin", enabled = !saving)
                }
                Section(
                    title = "The invoice",
                    footer = "Priced at the rates above (the order's booked ones unless you changed one). The advances become the invoice's payments, each on its own day; the exchange comes off the total.",
                ) {
                    Labeled("Pieces", Money.pkr(f.subtotal))
                    if (f.discount > 0) Labeled("Discount", "− " + Money.pkr(f.discount))
                    if (f.exchange > 0) Labeled("Exchange", "− " + Money.pkr(f.exchange))
                    Labeled("Invoice total", Money.pkr(f.total))
                    if (f.advances > 0) Labeled("Advance paid", "− " + Money.pkr(f.advances))
                    Labeled(if (isCredit(f.balance)) "Credit to customer" else "Balance due", Money.pkr(Math.abs(f.balance)), strong = true)
                }
            }
        },
        review = {
            TransactionReview(
                customer = order.customerName ?: "",
                pieces = rows.mapIndexed { index, row ->
                    TransactionReviewRow("${index + 1}. ${row.item.description}", Money.pkr(if (index < f.prices.size) f.prices[index] else 0.0))
                },
                figures = listOf(
                    TransactionReviewRow("Invoice total", Money.pkr(f.total)),
                    TransactionReviewRow("Advance paid", Money.pkr(f.advances)),
                    TransactionReviewRow(if (isCredit(f.balance)) "Credit to customer" else "Balance due", Money.pkr(Math.abs(f.balance))),
                ),
            )
        },
        footer = {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (failure != null) OrdersStatusLine(Icons.Filled.Warning, failure, Tone.problem)
                Button(
                    onClick = {
                        val problem = OrderFinalizeMath.problem(rows, discount, order, rateTexts)
                        if (problem != null) setFailure(problem) else { setFailure(null); setConfirming(true) }
                    },
                    enabled = !saving, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                ) {
                    if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = ErpColors.onAccent)
                    Text("Make invoice · ${Money.pkr(f.total)}", Modifier.padding(start = if (saving) 8.dp else 0.dp))
                }
            }
        },
    )

    if (confirming) {
        AlertDialog(
            onDismissRequest = { setConfirming(false) },
            title = { Text("Make the invoice?") },
            text = { Text(confirmWords(order, f)) },
            confirmButton = { TextButton(onClick = { setConfirming(false); onFinalize() }) { Text("Make invoice") } },
            dismissButton = { TextButton(onClick = { setConfirming(false) }) { Text("Cancel") } },
        )
    }
}

/** What is agreed to: the invoice's total and what is left owing (or in credit). */
internal fun confirmWords(order: Order, f: OrderFinalizeMath.Figures): String {
    val rest = if (isCredit(f.balance)) "with " + Money.pkr(Math.abs(f.balance)) + " in credit" else Money.pkr(f.balance) + " still due"
    return order.id + " becomes an invoice of " + Money.pkr(f.total) + ", " + rest + ". The order is then completed. Undoing it needs the delete code."
}

/** Who it is for, which order, and what is due once the advances are counted. */
@Composable
private fun Header(order: Order, due: Double) {
    Row(
        Modifier.fillMaxWidth().ledgerCard().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Monogram(OrdersLogic.customerName(order), size = MonogramSize.row)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(OrdersLogic.customerName(order), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(order.id, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (Math.abs(due) >= 1) {
                RowAmount(Math.abs(due), tone = if (due < 0) Tone.credit.color() else Tone.owed.color())
                Text(if (due < 0) "In credit" else "Due", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Pill("Paid", tone = Tone.settled)
            }
        }
    }
}

/**
 * Rates (PKR per gram) for the metals and karats the order uses, prefilled with the booked rates (the web dialog's
 * block): gold moves daily and orders are delivered weeks after they are booked, so any may be changed, or all set
 * to today's. Silver's rate is all-in (it holds the making and wastage). Nothing is sent unless one changed.
 */
@Composable
private fun RatesSection(order: Order, settings: Settings, texts: RateTexts, setTexts: (RateTexts) -> Unit, enabled: Boolean) {
    val rateRows = remember(order) { finalizeRateRows(order.items) }
    if (rateRows.isEmpty()) return
    val booked = remember(order, settings) { orderInvoiceRates(order, settings) }
    val changed = OrderFinalizeMath.changedRates(order, settings, texts)
    Section(
        title = "Rates (PKR per gram)",
        footer = "Booked rates unless you change one." +
            (if (rateRows.any { it.field == RateField.SILVER }) " Silver's rate already holds its making and wastage." else "") +
            " The invoice keeps the rates it was priced at.",
    ) {
        for (r in rateRows) {
            Field(
                r.label, texts[r.field] ?: "", { v -> setTexts(texts + (r.field to v)) }, KeyboardType.Decimal, "0", enabled = enabled,
                helper = if (r.field in changed) "Booked at " + NewOrderFormat.boxText(rateShown(booked, r.field), 2) else null,
            )
        }
        if (OrderFinalizeMath.todayDiffers(order, settings, texts)) {
            TextButton(onClick = { setTexts(texts + OrderFinalizeMath.todayTexts(order, settings)) }, enabled = enabled) { Text("Use today's rates") }
        }
    }
}

@Composable
private fun PieceSection(row: OrderFinalizeRow, price: Double, change: ((OrderFinalizeRow) -> OrderFinalizeRow) -> Unit) {
    val takes = takesWastageAndMaking(row.item.metalType)
    val roundedOnOrder = OrdersLogic.halfAway(row.onOrder).toLong()
    val roundedPrice = OrdersLogic.halfAway(price).toLong()
    Section(
        title = "${row.index + 1}. ${row.item.description.ifEmpty { "A piece" }}",
        trailing = Money.pkr(price),
        footer = if (row.onOrder > 0 && roundedOnOrder != roundedPrice) "On the order ${Money.pkr(row.onOrder)}." else null,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Fixed price", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Switch(checked = row.manual, onCheckedChange = { v -> change { it.copy(manual = v) } })
        }
        if (row.manual) {
            Field("Final price", row.price, { v -> change { it.copy(price = v) } }, KeyboardType.Number, "0")
            Field("Weight (g)", row.weight, { v -> change { it.copy(weight = v) } }, KeyboardType.Decimal, "Optional")
        } else {
            Field("Final weight (g)", row.weight, { v -> change { it.copy(weight = v) } }, KeyboardType.Decimal, "0")
            if (takes) {
                Field(
                    "Wastage %", row.wastage, { v -> change { it.copy(wastage = v) } }, KeyboardType.Decimal, "0",
                    helper = SaleNumber.grams(row.wastageGrams) + " g",
                )
                Field("Making", row.making, { v -> change { it.copy(making = v) } }, KeyboardType.Number, "0")
            }
            Field("Stones", row.stones, { v -> change { it.copy(stones = v) } }, KeyboardType.Number, "0")
            Field("Diamonds", row.diamonds, { v -> change { it.copy(diamonds = v) } }, KeyboardType.Number, "0")
        }
    }
}

@Composable
private fun Section(
    title: String? = null,
    trailing: String? = null,
    footer: String? = null,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (title != null) LedgerHeading(title, trailing = trailing)
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
        if (footer != null) Text(footer, Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Labeled(label: String, value: String, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            style = (if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium).copy(fontFeatureSettings = TabularDigits),
            color = if (strong) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
        )
    }
}

/** A labelled number box, right aligned, steady digits (the form's `LabeledContent { TextField }`). */
@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    keyboard: KeyboardType,
    placeholder: String,
    helper: String? = null,
    enabled: Boolean = true,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        // A number-pad box is a sum of money, kept to whole rupees (owner, 2026-10-17: "there should be no decimals").
        val whole = keyboard == KeyboardType.Number
        OutlinedTextField(
            value = if (whole) PaymentText.whole(value) else value, onValueChange = { onChange(if (whole) PaymentText.whole(it) else it) }, modifier = Modifier.width(160.dp), enabled = enabled, singleLine = true,
            placeholder = { Text(placeholder, Modifier.fillMaxWidth(), textAlign = TextAlign.End) },
            textStyle = MaterialTheme.typography.bodyMedium.copy(textAlign = TextAlign.End, fontFeatureSettings = TabularDigits),
            supportingText = helper?.let { { Text(it, Modifier.fillMaxWidth(), textAlign = TextAlign.End) } },
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        )
    }
}
