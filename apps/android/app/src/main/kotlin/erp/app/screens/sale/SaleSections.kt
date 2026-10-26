package erp.app.screens.sale

import erp.app.ui.Loading
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.automirrored.filled.Assignment
import androidx.compose.material.icons.filled.Delete
import erp.app.ui.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import erp.app.ui.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.ui.CustomerField
import erp.app.ui.EntryStep
import erp.app.ui.EntryStepState
import erp.app.ui.MinTouchTarget
import erp.app.ui.NumericText
import erp.app.ui.PaymentMethods
import erp.app.ui.PaymentText
import erp.app.ui.RoundOffChips
import erp.app.ui.RecentCustomers
import erp.app.ui.Radius
import erp.app.ui.SectionCard
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.isLargeText
import erp.app.ui.ledgerRow
import erp.app.ui.minus
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.auth.LocalSession
import erp.core.entry.EntryHouse
import erp.core.entry.SALE_GRAMS_PER_TOLA
import erp.core.entry.SaleExchangeRow
import erp.core.entry.SaleFigures
import erp.core.entry.SaleLine
import erp.core.entry.SaleLookup
import erp.core.entry.SaleNumber
import erp.core.entry.SalePaymentRow
import erp.core.logic.BalanceState
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.Margin
import erp.core.logic.Money
import erp.core.logic.balanceLine
import erp.core.logic.calculateProductCosts
import erp.core.logic.PricedPiece
import erp.core.logic.describeMetal
import erp.core.logic.exchangeRowsTotal
import erp.core.logic.goldCostPerGram
import erp.core.logic.percentLabel
import erp.core.logic.ratesSetToday
import erp.core.logic.whenSet
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Product
import erp.core.models.Settings
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.abs
import erp.app.ui.ValueRow
import erp.app.ui.NumberRow
import erp.app.ui.TextRow
import erp.app.ui.ToggleRow
import erp.app.ui.PickerRow
import erp.app.ui.ActionRow
import erp.app.ui.SmallPrint
import erp.app.ui.FieldRow
import erp.app.ui.FormSection
import erp.core.swiftRounded

// The sections of New sale, in the order of the web's page (sale-page.tsx): the customer, the pieces, the rates, the
// discount, what is handed over in exchange, what is paid now, the shop's own fields, the delivery, and the totals.
// (FormSections.swift.)

/** What the books hold that the sale reads, as the screen has them this moment. */
internal class SaleData(
    val products: List<Product>,
    val productsLoaded: Boolean,
    val invoices: List<Invoice>,
    val orders: List<Order>,
    val customers: List<Customer>,
    val settings: Settings?,
)

// MARK: 1. Customer

private fun customerNote(s: SaleFormState, f: SaleFigures): String = when {
    s.draft.customerId != null -> "${f.who.name} is on file: the sale goes on their account."
    f.who.id != null -> "That number is on file as ${f.who.name}: the sale goes to them."
    f.namedCustomer -> "${f.who.name} is new: the ERP adds them to the book when the sale is saved."
    else -> "Walk-in. No customer is made; overpayment can't be kept as credit."
}

@Composable
internal fun CustomerSection(s: SaleFormState, f: SaleFigures, d: SaleData) {
    // The book is offered as the name is typed, as on the web (customer-autocomplete.tsx); a number typed first finds
    // its customer too. Typing again lets go of a pick.
    SectionCard("Customer") {
        CustomerField(
            name = s.draft.customerName,
            pickedId = s.draft.customerId,
            phone = s.draft.customerPhone,
            book = d.customers,
            onType = { t -> s.update { it.typeName(t) } },
            onPhoneChange = { p -> s.update { it.customerPhone = p } },
            onPick = { c -> s.pickCustomer(c) },
            recent = { RecentCustomers.recent(d.invoices, d.orders, d.customers) },
        )
        SmallPrint(customerNote(s, f))
    }
}

// MARK: 2. Pieces

private fun spec(line: SaleLine): String {
    val parts = ArrayList<String>()
    parts.add(describeMetal(line.metalType, line.karat))
    if (line.metalWeightG > 0) parts.add(SaleNumber.grams(line.metalWeightG) + "g")
    line.size?.takeIf { it.isNotEmpty() }?.let { parts.add("Size $it") }
    // A key made up for one bill is not a stock number (lib/sku.ts stockSku).
    line.stockSku?.let { parts.add(it) }
    return parts.joinToString(" · ")
}

/** One piece on the sale: tap to edit, swipe to remove. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LineRow(s: SaleFormState, line: SaleLine, f: SaleFigures, d: SaleData) {
    // A piece gone from the shelf since it went on the sale (sold at the counter, or on another phone).
    val gone = d.productsLoaded && !line.isOneOff && d.products.none { it.sku == line.sku }
    androidx.compose.runtime.key(line.sku) {
        val dismiss = androidx.compose.material3.rememberSwipeToDismissBoxState(
            confirmValueChange = { target ->
                if (target == androidx.compose.material3.SwipeToDismissBoxValue.EndToStart) {
                    s.remove(line.sku)
                    true
                } else {
                    false
                }
            },
        )
        androidx.compose.material3.SwipeToDismissBox(
            state = dismiss,
            enableDismissFromStartToEnd = false,
            backgroundContent = {
                // Only while it is being swiped: drawn at rest, the red showed as a fringe at a rounded card's corners.
                if (dismiss.dismissDirection != androidx.compose.material3.SwipeToDismissBoxValue.Settled) {
                    Row(Modifier.fillMaxWidth().background(Tone.late.fill()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Delete, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
                    }
                }
            },
        ) {
            Column(
                Modifier.fillMaxWidth().background(ErpColors.card)
                    .clickable(onClickLabel = "Edit this piece", role = Role.Button) { s.editing = line }
                    .semantics {
                        customActions = listOf(androidx.compose.ui.semantics.CustomAccessibilityAction("Remove") { s.remove(line.sku); true })
                    }
                    .ledgerRow(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                TwoLine(
                    title = line.name.ifEmpty { line.stockSku ?: "New piece" },
                    subtitle = spec(line),
                    trailing = Money.pkr(f.price(line.sku)),
                )
                if (line.isCustomPrice) {
                    Text("Fixed price: ${Money.pkr(line.customPrice ?: 0.0)}", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
                }
                val rate = line.silverRatePerGram
                if (line.metalType == "silver" && !line.isCustomPrice && rate != null && rate > 0) {
                    Text("Rate: ${SaleNumber.grams(rate)}/g", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (gone) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(14.dp), tint = Tone.problem.color())
                        Text("No longer in stock", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
                    }
                }
            }
        }
    }
}

@Composable
internal fun PiecesSection(s: SaleFormState, f: SaleFigures, d: SaleData) {
    val taken = s.draft.lines.map { it.sku }.toSet()
    val results = SaleLookup.matches(s.query, d.products, taken)
    val n = s.draft.lines.size
    FormSection("Pieces", footer = { Text("$n piece${if (n == 1) "" else "s"}. Tap to edit; swipe to remove.") }) {
        s.draft.lines.forEach { line -> LineRow(s, line, f, d) }
        FieldRow(
            label = "Search stock by SKU or name", value = s.query, onChange = { s.query = it; s.notice = null },
            imeAction = androidx.compose.ui.text.input.ImeAction.Search, onImeAction = { s.addTyped() },
            leading = Icons.Filled.Search,
        )
        results.forEach { p ->
            val price = calculateProductCosts(PricedPiece(p), f.rateBook.pricing).totalPrice
            Row(Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Button) { s.add(p) }) {
                TwoLine(title = p.name, subtitle = p.sku, trailing = Money.pkr(price))
            }
        }
        s.notice?.let { notice ->
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(16.dp), tint = Tone.problem.color())
                Text(notice, style = MaterialTheme.typography.bodyMedium, color = Tone.problem.color())
            }
        }
        ActionRow("Scan a tag", { s.scanning = true }, Icons.Filled.QrCodeScanner)
        // Straight to the piece: no "this bill only or stock too?" question first (owner, 2026-10-24).
        ActionRow("New item", { s.startNewItem() }, Icons.Filled.AddCircle)
        // The AI bill reader (SaleScanScreen): the ERP's own reader, its lines put on this sale.
        ActionRow("Read a written bill", { s.readingBill = true }, Icons.Filled.DocumentScanner)
    }
}

// MARK: 3. Rates

private val mainRate: Pair<String, (Settings) -> Double> =
    if (House.metal == "silver") "Silver" to { it.silverRatePerGram } else "21K" to { it.goldRatePerGram21k }

private fun staleRateText(settings: Settings?): String {
    val main = settings?.let { mainRate.second(it) } ?: 0.0
    return "The rate was not set today (${mainRate.first} ${Money.grouped(main)} · ${whenSet(settings?.ratesUpdatedAt)}). Tap to set it, or carry on."
}

@Composable
internal fun RatesSection(s: SaleFormState, f: SaleFigures, d: SaleData) {
    // The shop's rate not set today: say so, never block the sale (RateStaleNotice).
    val stale = f.hasPieces && !ratesSetToday(d.settings?.ratesUpdatedAt)
    if (f.boxes.isEmpty() && !stale) return
    FormSection("Rates (PKR per gram)", footer = { Text("Used for this sale only. A rate typed here is not saved as today's rate: set that from the rate chip.") }) {
        if (stale) {
            Row(
                Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Button) { s.rateSheet = true },
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(18.dp), tint = Tone.owed.color())
                Text(staleRateText(d.settings), style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
            }
        }
        f.boxes.forEach { box ->
            NumberRow(box.label, f.rateBook.text(box.key), { t -> s.update { it.rates[box.key.name] = t } })
        }
        if (s.draft.rates.isNotEmpty()) {
            ActionRow("Back to today's rates", { s.update { it.rates = LinkedHashMap() } })
        }
    }
}

// MARK: 4. Discount

@Composable
internal fun DiscountSection(s: SaleFormState, f: SaleFigures) {
    FormSection("Discount", footer = f.discountProblem?.let { problem -> { Text(problem, color = Tone.problem.color()) } }) {
        NumberRow("Amount (PKR)", s.draft.discount, { t -> s.update { it.discount = t } }, rupees = true)
        // sale-page.tsx: offered once the bill can be worked out; the bill before any discount is the pieces less the exchange.
        if (f.hasEstimate) {
            RoundOffChips(f.subtotal - f.exchange, f.discount, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { n ->
                s.update { it.discount = if (n > 0) n.toLong().toString() else "" }
            }
        }
    }
}

// MARK: 5. Exchange

private enum class ExchangeField { Description, Karat, WeightG, RatePerGram, Value }

private fun exchangePatch(field: ExchangeField, text: String): ExchangeRowPatch = when (field) {
    ExchangeField.Description -> ExchangeRowPatch(description = text)
    ExchangeField.Karat -> ExchangeRowPatch(karat = text)
    ExchangeField.WeightG -> ExchangeRowPatch(weightG = text)
    ExchangeField.RatePerGram -> ExchangeRowPatch(ratePerGram = text)
    ExchangeField.Value -> ExchangeRowPatch(value = text)
}

private fun exchangeText(row: SaleExchangeRow, field: ExchangeField): String = when (field) {
    ExchangeField.Description -> row.description
    ExchangeField.Karat -> row.karat
    ExchangeField.WeightG -> row.weightG
    ExchangeField.RatePerGram -> row.ratePerGram
    ExchangeField.Value -> row.value
}

/** One exchange row. A field is edited through core's `applyExchangeRowChange`: grams × rate refills the amount until someone types one. */
@Composable
private fun ExchangeRowView(s: SaleFormState, row: SaleExchangeRow) {
    fun text(field: ExchangeField) = s.draft.exchanges.firstOrNull { it.id == row.id }?.let { exchangeText(it, field) } ?: ""
    fun set(field: ExchangeField, t: String) = s.update { it.changeExchange(row.id, exchangePatch(field, t)) }
    val live = s.draft.exchanges.firstOrNull { it.id == row.id } ?: row
    val computed = !live.valueTyped && SaleNumber.value(live.weightG) > 0 && SaleNumber.value(live.ratePerGram) > 0
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(0.dp), verticalAlignment = Alignment.CenterVertically) {
            FieldRow(
                "What it is (e.g. old ring)", text(ExchangeField.Description), { t -> set(ExchangeField.Description, t) },
                Modifier.weight(1f), capitalization = KeyboardCapitalization.Sentences,
            )
            FieldRow(
                "Amount", PaymentText.whole(text(ExchangeField.Value)), { t -> set(ExchangeField.Value, PaymentText.whole(t)) },
                Modifier.width(150.dp), keyboard = KeyboardType.Number,
            )
        }
        if (live.hasDetails || s.openedExchange.contains(row.id)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(0.dp), verticalAlignment = Alignment.CenterVertically) {
                // Karat only where the house sells gold; a silver house weighs without it.
                if (House.metal == "gold") {
                    Box(Modifier.weight(1f).padding(start = 16.dp)) {
                        var open by remember { mutableStateOf(false) }
                        TextButton(onClick = { open = true }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                            Text(text(ExchangeField.Karat).ifEmpty { "Karat" })
                        }
                        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                            DropdownMenuItem(text = { Text("Karat") }, onClick = { open = false; set(ExchangeField.Karat, "") })
                            listOf("24k", "22k", "21k", "18k").forEach { k ->
                                DropdownMenuItem(text = { Text(k) }, onClick = { open = false; set(ExchangeField.Karat, k) })
                            }
                        }
                    }
                }
                FieldRow("Grams", text(ExchangeField.WeightG), { t -> set(ExchangeField.WeightG, t) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal)
                FieldRow("Rate / g", text(ExchangeField.RatePerGram), { t -> set(ExchangeField.RatePerGram, t) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal)
            }
            if (computed) {
                Text(
                    "Amount = grams × rate. Type an amount to change it.",
                    Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            TextButton(onClick = { s.openedExchange = s.openedExchange + row.id }, Modifier.padding(start = 8.dp).defaultMinSize(minHeight = MinTouchTarget)) {
                Text("+ Weight & rate", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
internal fun ExchangeSection(s: SaleFormState) {
    val total = exchangeRowsTotal(s.draft.exchanges.map { it.core })
    FormSection("Exchange / trade-in", footer = { Text("Gold or anything else the customer hands over, taken off the bill at an agreed value.") }) {
        s.draft.exchanges.forEach { row -> SwipeToRemove(onRemove = { s.update { it.removeExchange(row.id) } }) { ExchangeRowView(s, row) } }
        ActionRow("Add another exchange", { s.update { it.addExchange() } }, Icons.Filled.Add)
        if (s.draft.exchanges.size > 1 && total > 0) {
            ValueRow("Exchange total") { Text(Money.pkr(total), style = MaterialTheme.typography.bodyLarge) }
        }
    }
}

/** A row that goes when it is swiped away (and has a "Remove" action for TalkBack). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SwipeToRemove(onRemove: () -> Unit, content: @Composable () -> Unit) {
    val latest by androidx.compose.runtime.rememberUpdatedState(onRemove)
    val dismiss = androidx.compose.material3.rememberSwipeToDismissBoxState(
        confirmValueChange = { target ->
            if (target == androidx.compose.material3.SwipeToDismissBoxValue.EndToStart) { latest(); true } else false
        },
    )
    androidx.compose.material3.SwipeToDismissBox(
        state = dismiss,
        enableDismissFromStartToEnd = false,
        modifier = Modifier.semantics { customActions = listOf(androidx.compose.ui.semantics.CustomAccessibilityAction("Remove") { latest(); true }) },
        backgroundContent = {
            if (dismiss.dismissDirection != androidx.compose.material3.SwipeToDismissBoxValue.Settled) {
                Row(Modifier.fillMaxWidth().background(Tone.late.fill()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Delete, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
                }
            }
        },
    ) { Box(Modifier.fillMaxWidth().background(ErpColors.card)) { content() } }
}

// MARK: 6. Payments taken now

private fun referencePrompt(method: String): String = when (method) {
    "Cheque" -> "Cheque no."
    "Card" -> "Last 4 digits"
    "Bank Transfer" -> "Reference"
    else -> "No reference"
}

@Composable
private fun PaymentRowView(s: SaleFormState, row: SalePaymentRow, f: SaleFigures) {
    val live = s.draft.payments.firstOrNull { it.id == row.id } ?: row
    val single = s.draft.payments.size < 2
    fun set(change: (SalePaymentRow) -> Unit) = s.update { d ->
        val i = d.payments.indexOfFirst { it.id == row.id }
        if (i >= 0) change(d.payments[i])
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            FieldRow("Amount (PKR)", PaymentText.whole(live.amount), { t -> set { it.amount = PaymentText.whole(t) } }, Modifier.weight(1f), keyboard = KeyboardType.Number)
            FilledTonalButton(
                onClick = { s.update { it.payRest(row.id, f.total) } },
                enabled = f.hasEstimate,
                modifier = Modifier.padding(end = 16.dp).defaultMinSize(minHeight = MinTouchTarget),
            ) { Text(if (single) "Paid in full" else "The rest") }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                PickerRow("Paid by", live.method, PaymentMethods.all.map { it to it }) { m -> set { it.method = m } }
            }
            FieldRow(referencePrompt(live.method), live.reference, { t -> set { it.reference = t } }, Modifier.weight(1f), enabled = live.method != "Cash")
        }
    }
}

@Composable
internal fun PaymentSection(s: SaleFormState, f: SaleFigures) {
    FormSection(
        "Payment received",
        footer = { Text("Taken as the invoice is written and filed in its payment history. Leave it empty if nothing is paid yet: a payment can still be recorded after.") },
    ) {
        s.draft.payments.forEach { row -> SwipeToRemove(onRemove = { s.update { it.removePayment(row.id) } }) { PaymentRowView(s, row, f) } }
        ActionRow("Add another payment", { s.update { it.addPayment() } }, Icons.Filled.Add)
        if (f.hasEstimate) BalanceRow(f)
    }
}

/** What is left after the payments, in the ERP's words (InvoiceCredit): due, paid in full, or the customer's credit. A walk-in's extra is change, not credit, and the server refuses it. */
@Composable
internal fun BalanceRow(f: SaleFigures) {
    val line = balanceLine(f.balance)
    if (f.overpaid) {
        ValueRow("More than the total by") { Text(Money.pkr(abs(f.balance)), style = MaterialTheme.typography.bodyLarge, color = Tone.problem.color()) }
    } else when (line.state) {
        BalanceState.credit -> ValueRow(line.label) { Text(Money.pkr(line.amount), style = MaterialTheme.typography.bodyLarge, color = Tone.credit.color()) }
        BalanceState.paid -> ValueRow(line.label) { Icon(Icons.Filled.CheckCircle, "Paid in full", tint = Tone.settled.color()) }
        BalanceState.due -> ValueRow(line.label) { Text(Money.pkr(line.amount), style = MaterialTheme.typography.bodyLarge, color = Tone.owed.color()) }
    }
}

// MARK: 7. For the shop: taken by, rates off the bill, a note, the margin

/** The house's counter names (STORE_TAKEN_BY), counted and filtered on: "Ammar" typed three ways is three people to a filter. Free text only when the house has no list. */
@Composable
private fun TakenByRow(s: SaleFormState) {
    val names = LocalSession.current.shop.takenBy
    if (names.isEmpty()) {
        TextRow("Taken by", s.draft.takenBy, { t -> s.update { it.takenBy = t } }, prompt = "Not set", capitalization = KeyboardCapitalization.Words)
    } else {
        val options = buildList {
            add("" to "Not set")
            names.forEach { add(it to it) }
            // A name kept in a saved sale that the list has dropped since stays selectable.
            if (s.draft.takenBy.isNotEmpty() && !names.contains(s.draft.takenBy)) add(s.draft.takenBy to s.draft.takenBy)
        }
        PickerRow("Taken by", s.draft.takenBy, options) { v -> s.update { it.takenBy = v } }
    }
}

/** "PKR 4,500 a gram · our cost…": the 24k rate worked into what a gram of jewellery costs the shop. */
@Composable
private fun CostRateRows(s: SaleFormState, f: SaleFigures, d: SaleData) {
    val ratti = EntryHouse.margin.rattiLess ?: 0.0
    val perGram = SaleNumber.value(s.draft.costTola) / SALE_GRAMS_PER_TOLA
    val sheetTola = swiftRounded((d.settings?.goldRatePerGram24k ?: 0.0) * SALE_GRAMS_PER_TOLA)
    val assumed = swiftRounded(EntryHouse.margin.assumedMargin * 100).toInt()
    NumberRow("24k rate now (PKR / tola)", s.draft.costTola, { t -> s.update { it.costTola = t } }, prompt = "For our margin", decimal = false)
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (perGram > 0) {
            SmallPrint("${Money.pkr(perGram)} a gram · our cost ${Money.pkr(goldCostPerGram(perGram, rattiLess = ratti))} a gram of jewellery (24k less ${SaleNumber.grams(ratti)} ratti).")
        } else {
            SmallPrint("Without it the margin is taken as $assumed%.")
        }
        if (sheetTola > 0 && sheetTola != swiftRounded(SaleNumber.value(s.draft.costTola))) {
            TextButton(onClick = { s.update { it.costTola = sheetTola.toLong().toString() } }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                Text("Use the rate sheet's ${Money.grouped(sheetTola)} a tola", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    f.margin?.let { MarginRow(s, it) }
}

private fun marginWords(m: Margin): String {
    val assumed = swiftRounded(EntryHouse.margin.assumedMargin * 100).toInt()
    if (m.assumed) return "≈ ${percentLabel(m)} (no 24k rate given — assumed)"
    var out = "${percentLabel(m)} · ${Money.pkr(m.profit)}"
    if (m.costedShare < 0.999) {
        val rest = swiftRounded((1 - m.costedShare) * 100).toInt()
        out += " · $rest% of it at $assumed% (no weight)"
    }
    return out
}

/**
 * What the shop earns on this sale, blurred until tapped: the counter turns its screen to show a customer the bill, and
 * a margin beside the total is the one thing they must not read off it. What is blurred is a made-up figure, never
 * the real one, so a phone that cannot blur still shows nothing.
 */
@Composable
private fun MarginRow(s: SaleFormState, m: Margin) {
    val tone = if (m.assumed) Tone.quiet else if (m.percent < 0) Tone.late else Tone.settled
    Row(
        Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Button, onClickLabel = if (s.marginShown) "Hide our margin" else "Show our margin") { s.marginShown = !s.marginShown },
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Lock, contentDescription = null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("We earn", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            if (s.marginShown) marginWords(m) else "00.0% · PKR 00,000",
            Modifier.then(if (s.marginShown) Modifier else Modifier.blur(6.dp)).semantics { if (!s.marginShown) contentDescription = "Hidden" },
            style = MaterialTheme.typography.bodyLarge,
            color = tone.color(),
            textAlign = TextAlign.End,
        )
    }
}

@Composable
internal fun ShopSection(s: SaleFormState, f: SaleFigures, d: SaleData) {
    FormSection("For the shop", footer = { Text("Never printed on the bill or sent to the customer.") }) {
        TakenByRow(s)
        ToggleRow(
            "Leave rates off the printed bill", s.draft.hideRates, { v -> s.update { it.hideRates = v } },
            sub = "Prices stay the same. The invoice just won't show the per-gram rate.",
        )
        FieldRow(
            "Internal note", s.draft.internalNote, { t -> s.update { it.internalNote = t } },
            placeholder = "Changes still to make, promises given, anything to remember about this sale",
            singleLine = false, minLines = 2, maxLines = 6, capitalization = KeyboardCapitalization.Sentences,
        )
        // Houses that cost a sale by its gold ask for the 24k rate now (lib/margin.ts); Mina's silver does not.
        if (EntryHouse.margin.rattiLess != null) CostRateRows(s, f, d)
    }
}

// MARK: 7b. Delivery

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ExpectedDate(s: SaleFormState) {
    var picking by remember { mutableStateOf(false) }
    val day = SaleDates.date(s.draft.delivery.expectedDate) ?: LocalDate.now()
    ValueRow("Date") {
        TextButton(onClick = { picking = true }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
            Text(day.format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", java.util.Locale.ENGLISH)))
        }
    }
    if (picking) {
        val state = rememberDatePickerState(initialSelectedDateMillis = day.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        val picked = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        s.update { it.delivery.expectedDate = SaleDates.string(picked) }
                    }
                    picking = false
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
}

@Composable
internal fun DeliverySection(s: SaleFormState, f: SaleFigures, d: SaleData) {
    val delivery = s.draft.delivery
    FormSection("Delivery", footer = { Text("Off unless ticked: most sales are handed over at the counter.") }) {
        ToggleRow("Deliver this", delivery.required, { v -> s.update { it.delivery.required = v } })
        if (delivery.required) {
            val known = SaleLookup.knownAddresses(
                customerId = f.who.id,
                customerAddress = d.customers.firstOrNull { it.id == f.who.id }?.address,
                invoices = d.invoices,
            )
            if (known.isNotEmpty()) {
                PickerRow("Address on file", "", known.map { it to it }) { a -> s.update { it.delivery.address = a } }
            }
            FieldRow(
                "Delivery address", delivery.address, { t -> s.update { it.delivery.address = t } },
                placeholder = "House / flat, street, area", singleLine = false, minLines = 2, maxLines = 4,
                capitalization = KeyboardCapitalization.Sentences,
            )
            FieldRow("City", delivery.city, { t -> s.update { it.delivery.city = t } }, placeholder = "Karachi", capitalization = KeyboardCapitalization.Words)
            ToggleRow("Expected date", delivery.expectedDate.isNotEmpty(), { on ->
                s.update { it.delivery.expectedDate = if (on) SaleDates.string(LocalDate.now()) else "" }
            })
            if (delivery.expectedDate.isNotEmpty()) ExpectedDate(s)
            FieldRow("Receiver name", delivery.contactName, { t -> s.update { it.delivery.contactName = t } }, placeholder = "If not the customer", capitalization = KeyboardCapitalization.Words)
            FieldRow("Receiver phone", delivery.contactPhone, { t -> s.update { it.delivery.contactPhone = t } }, placeholder = "Optional", keyboard = KeyboardType.Phone)
            NumberRow("Delivery charge (PKR)", delivery.charge, { t -> s.update { it.delivery.charge = t } }, prompt = "0 if free", rupees = true)
            FieldRow("Instructions", delivery.notes, { t -> s.update { it.delivery.notes = t } }, placeholder = "Landmark, timing, gate code", capitalization = KeyboardCapitalization.Sentences)
        }
    }
}

// MARK: The summary under the steps

/**
 * Where each step stands, from the sale as typed: a tick when it is complete, an amber dot where Save is held up
 * (Payment carries the sale's `blockedReason`, as the bar at the foot says it in words).
 */
internal fun stepStates(f: SaleFigures): Map<EntryStep, EntryStepState> {
    val out = LinkedHashMap<EntryStep, EntryStepState>()
    if (f.namedCustomer) out[EntryStep.customer] = EntryStepState.done
    if (f.hasPieces) out[EntryStep.pieces] = if (f.missingRates.isEmpty()) EntryStepState.done else EntryStepState.attention
    if (f.blockedReason != null) {
        // An empty sale is not yet a problem to look at: the Pieces step has nothing, and says so.
        if (f.hasPieces) out[EntryStep.payment] = EntryStepState.attention
    } else if (f.hasEstimate && f.paidNow > 0) {
        out[EntryStep.payment] = EntryStepState.done
    }
    return out
}

/** The sale's total and what it still asks, pinned under the steps on Pieces and Payment so the figure is in view as pieces are added and money is taken. */
@Composable
internal fun SaleSummary(f: SaleFigures) {
    val line = balanceLine(f.balance)
    val total: @Composable () -> Unit = {
        NumericText(if (f.hasEstimate) "Total ${Money.pkr(f.total)}" else "Total …", f.total, style = ErpType.heading)
    }
    val due: @Composable () -> Unit = {
        if (f.hasEstimate) {
            val (text, tone) = when {
                f.overpaid -> "Over ${Money.pkr(abs(f.balance))}" to Tone.problem
                line.state == BalanceState.due -> "Due ${Money.pkr(line.amount)}" to Tone.owed
                line.state == BalanceState.credit -> "In credit ${Money.pkr(line.amount)}" to Tone.credit
                else -> "Paid in full" to Tone.settled
            }
            NumericText(text, f.balance, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = tone.color())
        }
    }
    val box = Modifier.fillMaxWidth().background(ErpColors.ground).padding(horizontal = 16.dp, vertical = 8.dp)
    if (isLargeText()) {
        Column(box, verticalArrangement = Arrangement.spacedBy(2.dp)) { total(); due() }
    } else {
        Row(box, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { total(); due() }
    }
}

// MARK: 8. Totals

@Composable
private fun TotalRow(label: String, value: Double, f: SaleFigures, signed: Boolean = false, strong: Boolean = false) {
    ValueRow(label) {
        if (f.hasEstimate) {
            NumericText(
                if (signed) Money.minus(value) else Money.pkr(value), value,
                style = if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
            )
        } else {
            Text("…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun TotalsSection(f: SaleFigures) {
    FormSection("Totals") {
        TotalRow("Subtotal", f.subtotal, f)
        if (f.discount != 0.0) TotalRow("Discount", f.discount, f, signed = true)
        if (f.exchange != 0.0) TotalRow("Exchange", f.exchange, f, signed = true)
        TotalRow("Total", f.total, f, strong = true)
        if (f.hasEstimate) {
            if (f.paidNow > 0) TotalRow("Paid now", f.paidNow, f)
            BalanceRow(f)
        }
    }
}

/** The same pieces can go to the workshop as an order instead (sale-page.tsx "Create order", /orders/add?fromCart=1). */
@Composable
internal fun OrderSection(s: SaleFormState) {
    // A sale already billed is not turned into an order.
    if (s.edit != null) return
    FormSection("Order", footer = { Text("Invoice bills it now. Order sends it to the workshop first, with an advance if taken.") }) {
        ActionRow("Create order", { s.askOrder() }, Icons.AutoMirrored.Filled.Assignment, enabled = s.draft.lines.isNotEmpty())
    }
}

/**
 * The one action of the screen, with the ERP's own words above it: what it refused, else why Save is off
 * (sale-page.tsx `invoiceBlockedReason`: a disabled button with no explanation reads as broken).
 */
@Composable
internal fun SaveBar(s: SaleFormState, f: SaleFigures, openPath: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        erp.app.ui.UpdateBanner()
        val failure = s.failure
        val reason = f.blockedReason
        if (failure != null) {
            Column(
                Modifier.fillMaxWidth().clip(Radius.chipShape).background(ErpColors.card).padding(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(failure, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color(), textAlign = TextAlign.Center)
                if (s.alreadySold) {
                    // A new item is refused only once it is on an invoice: this sale was saved before (a save sent again
                    // after the answer was lost), so there is nothing to take off.
                    Text("This sale was already saved. Look for it in Invoices before saving it again.", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), textAlign = TextAlign.Center)
                    FilledTonalButton(onClick = { openPath("/invoices") }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text("Open Invoices") }
                }
                if (s.goneSkus.isNotEmpty()) {
                    FilledTonalButton(onClick = { s.dropGone() }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text("Take them off the sale") }
                }
            }
        } else if (reason != null) {
            Text(
                reason,
                Modifier.fillMaxWidth().clip(Radius.chipShape).background(ErpColors.card).padding(10.dp),
                style = MaterialTheme.typography.bodySmall, color = (if (f.hasPieces) Tone.problem else Tone.quiet).color(), textAlign = TextAlign.Center,
            )
        }
        val label = if (s.edit != null) {
            if (f.hasEstimate) "Save changes · ${Money.pkr(f.total)}" else "Save changes"
        } else {
            if (f.hasEstimate) "Save sale · ${Money.pkr(f.total)}" else "Save sale"
        }
        Button(
            onClick = { s.save(f) },
            enabled = f.canSave && !s.saving && !erp.app.ui.rememberUpdateBlocked(),
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp),
        ) {
            if (s.saving) Loading(Modifier.size(24.dp), color = ErpColors.onAccent)
            Text(label, Modifier.padding(start = if (s.saving) 8.dp else 0.dp))
        }
    }
}
