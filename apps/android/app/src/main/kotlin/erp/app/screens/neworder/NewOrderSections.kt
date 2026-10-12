package erp.app.screens.neworder

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.ui.CustomerField
import erp.app.ui.MinTouchTarget
import erp.app.ui.PaymentMethods
import erp.app.ui.Tone
import erp.app.ui.color
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDay
import erp.core.entry.NewOrderExchangeDraft
import erp.core.entry.NewOrderFormat
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderWords
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.Money
import erp.core.logic.URGENT_WINDOW_DAYS
import erp.core.logic.exchangeRowsTotal
import erp.core.logic.phoneKey
import erp.core.logic.resolveSaleCustomer
import erp.core.models.Customer
import erp.core.models.Settings

// The order form's sections, one composable each: who it is for, when, the money (rates, discount, advance,
// exchange), notes, delivery, the shop's margin, and the totals. Each takes the holder of the whole draft; the
// figures it shows come from NewOrderMath, which is the core's. (NewOrderSections.swift.)

// MARK: Who it is for

@Composable
internal fun CustomerSection(
    holder: DraftHolder,
    /** Customers who are people: not removed, not the old "Walk-in Customer" records. */
    people: List<Customer>,
    /** The house's counter names (`Shop.takenBy`). "Taken by" is one of them; free text only where the house has no list. */
    takenBy: List<String>,
    /** The last people served, offered before a name is typed (CustomerField). */
    recent: () -> List<Customer> = { emptyList() },
) {
    val d = holder.read()
    // A typed number already on file is that customer (lib/walk-in.ts): said here, so it is no surprise.
    val numberMatch: Customer? = if (d.customerId.isEmpty() && phoneKey(d.customerPhone).isNotEmpty()) {
        val r = resolveSaleCustomer(selectedId = null, typedName = d.customerName, typedPhone = d.customerPhone, customers = people)
        r.id?.let { id -> people.firstOrNull { it.id == id } }
    } else {
        null
    }
    FormCard(title = "Order for") {
        // Counted by name, so the list is fixed and "Ammar" typed three ways is not three people to a filter
        // (taken-by-picker.tsx). It starts on the signed-in person, and always shows who it is.
        if (takenBy.isEmpty()) {
            FieldRow("Taken by", d.takenBy, { t -> holder.edit { this.takenBy = t } }, prompt = "Not set", capitalization = KeyboardCapitalization.Words)
        } else {
            PickerRow("Taken by", d.takenBy, listOf("" to "Not set") + takenBy.map { it to it }) { name -> holder.edit { this.takenBy = name } }
        }
        // The book is offered as the name is typed (customer-autocomplete.tsx); typing again lets go of a pick.
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            CustomerField(
                name = d.customerName,
                pickedId = d.customerId.ifEmpty { null },
                phone = d.customerPhone,
                book = people,
                onType = { t -> holder.edit { typeCustomerName(t) } },
                onPhoneChange = { t -> holder.edit { customerPhone = t } },
                onPick = { c ->
                    holder.edit {
                        if (c != null) {
                            choose(c)
                        } else {
                            customerName = ""
                            customerId = ""
                            customerPhone = ""
                        }
                    }
                },
                recent = recent,
            )
        }
        numberMatch?.let { NoteRow("This number is ${it.name}'s: the order goes to them.", Icons.Filled.PersonSearch) }
        PickerRow(
            "How they found us", d.source,
            listOf("" to "Not specified") + NewOrderWords.sources.map { it.id to it.label },
        ) { s -> holder.edit { source = s } }
    }
}

// MARK: When

@Composable
internal fun PromisedSection(holder: DraftHolder) {
    val d = holder.read()
    val days = NewOrderDay.daysAway(d.promised)
    FormCard(
        title = "Promised for",
        footer = "What the piece is chased against. Within $URGENT_WINDOW_DAYS days is marked urgent.",
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            NewOrderLogic.quickDays.forEach { n ->
                NewOrderChip("${n}d", on = d.promised == NewOrderDay.after(n)) { holder.edit { promised = NewOrderDay.after(n) } }
            }
            NewOrderChip("No date", on = d.promised.isEmpty()) { holder.edit { promised = "" } }
        }
        if (d.promised.isNotEmpty()) {
            DateRow("Date promised", d.promised) { day -> holder.edit { promised = day } }
            if (days != null && days <= URGENT_WINDOW_DAYS) {
                // Soon is amber, as the order page's "Urgent" pill: red is kept for what is already late.
                NoteRow(NewOrderLogic.urgentWords(days), Icons.Filled.Warning, if (days < 0) Tone.late else Tone.owed)
            }
        }
    }
}

// MARK: The pieces

internal fun piecesFooter(count: Int): String =
    if (count == 0) "Add one or more pieces to see the price." else NewOrderFormat.pieces(count) + " on this order"

// MARK: Rates

@Composable
internal fun RatesSection(holder: DraftHolder, settings: Settings?) {
    val d = holder.read()
    val boxes = NewOrderLogic.rateBoxes(d)
    val silver = NewOrderLogic.hasSilver(d)
    if (boxes.isEmpty() && !silver) return
    FormCard(
        title = "Metal rates (PKR / gram)",
        footer = NewOrderLogic.ratesFooter(NewOrderLogic.hasPalladium(d), silver),
    ) {
        boxes.forEach { box ->
            NumberRow(box.label, d.rates[box.key.name] ?: "", { t -> holder.edit { rates[box.key.name] = t } }, prompt = "0")
        }
        if (silver && settings != null) ValueRow("Silver (all-in)", Money.pkr(settings.silverRatePerGram) + "/g")
        if (settings != null && NewOrderLogic.ratesDiffer(d, settings)) {
            ActionRow("Use today's rates", onClick = { holder.edit { rates = LinkedHashMap(NewOrderMath.todaysRates(settings)) } })
        }
    }
}

/**
 * The rates still price the order; this only decides whether the paper says what they were. Some customers are
 * quoted a piece and not a gold price, and a rate line on the slip reopens a conversation the counter has already closed.
 */
@Composable
internal fun PrintedSection(holder: DraftHolder) {
    val d = holder.read()
    FormCard(footer = "Prices stay the same. The slip and the invoice just won't show the per-gram rate.") {
        ToggleRow("Leave rates off the printed bill", d.hideRates) { on -> holder.edit { hideRates = on } }
    }
}

// MARK: Payment

@Composable
internal fun PaymentSection(holder: DraftHolder) {
    val d = holder.read()
    FormCard(title = "Payment", footer = "The discount is carried onto the invoice when this order is finalised.") {
        NumberRow("Discount (PKR)", d.discount, { t -> holder.edit { discount = t } })
        NumberRow("Advance paid (PKR)", d.advance, { t -> holder.edit { advance = t } })
        if (NewOrderFormat.num(d.advance) > 0) {
            PickerRow("Paid by", d.advanceMethod, listOf("" to "Not recorded") + PaymentMethods.all.map { it to it }) { m -> holder.edit { advanceMethod = m } }
        }
    }
}

// MARK: Exchange

private val exchangeKarats = listOf("24k", "22k", "21k", "18k")

/**
 * Old gold or a piece the customer hands over, taken off the bill at an agreed value. One line: what it is and the
 * amount that comes off; weight and rate fold away under it and fill the amount until someone types their own
 * (components/shared/exchange-rows.tsx; the core's `applyExchangeRowChange`).
 */
@Composable
internal fun ExchangeSection(holder: DraftHolder) {
    val d = holder.read()
    var opened by remember { mutableStateOf(setOf<String>()) }
    val total = exchangeRowsTotal(d.exchanges.map { it.row })

    fun remove(id: String) {
        holder.edit { exchanges = if (exchanges.size > 1) exchanges.filter { it.id != id }.toMutableList() else mutableListOf(NewOrderExchangeDraft.blank()) }
    }

    FormCard(title = "Exchange / trade-in", footer = "Old gold or a piece the customer hands over, taken off the bill at an agreed value.") {
        d.exchanges.forEach { row ->
            val showDetails = opened.contains(row.id) || row.karat.isNotEmpty() || row.weightG.isNotEmpty() || row.ratePerGram.isNotEmpty()
            Column(Modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    QuietField(
                        row.description, { t -> holder.edit { patchExchange(row.id, ExchangeRowPatch(description = t)) } },
                        Modifier.weight(1f), placeholder = "What it is (e.g. old ring)", capitalization = KeyboardCapitalization.Sentences, label = "What it is",
                    )
                    QuietField(
                        row.value, { t -> holder.edit { patchExchange(row.id, ExchangeRowPatch(value = t)) } },
                        Modifier.width(110.dp), placeholder = "Amount", keyboardType = KeyboardType.Decimal, autoCorrect = false, end = true, label = "Amount",
                    )
                    IconButton(onClick = { remove(row.id) }, Modifier.size(MinTouchTarget)) {
                        Icon(Icons.Filled.Close, "Remove this exchange", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (showDetails) {
                    val computed = !row.valueTyped && NewOrderFormat.num(row.weightG) > 0 && NewOrderFormat.num(row.ratePerGram) > 0
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        // Karat only means something where the house sells gold; a silver house weighs without it.
                        if (erp.app.config.House.metal == "gold") {
                            KaratMenu(row.karat) { k -> holder.edit { patchExchange(row.id, ExchangeRowPatch(karat = k)) } }
                        }
                        QuietField(
                            row.weightG, { t -> holder.edit { patchExchange(row.id, ExchangeRowPatch(weightG = t)) } },
                            Modifier.weight(1f), placeholder = "Grams", keyboardType = KeyboardType.Decimal, autoCorrect = false, end = true, label = "Grams",
                        )
                        QuietField(
                            row.ratePerGram, { t -> holder.edit { patchExchange(row.id, ExchangeRowPatch(ratePerGram = t)) } },
                            Modifier.weight(1f), placeholder = "Rate / g", keyboardType = KeyboardType.Decimal, autoCorrect = false, end = true, label = "Rate per gram",
                        )
                    }
                    if (computed) {
                        Text("Amount = grams × rate: type an amount to change it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    Text(
                        "+ Weight & rate",
                        Modifier.clickable(role = Role.Button) { opened = opened + row.id }.padding(vertical = 4.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = erp.app.ui.theme.ErpColors.accent,
                    )
                }
            }
        }
        ActionRow("Add another exchange", icon = Icons.Filled.Add, onClick = { holder.edit { exchanges.add(NewOrderExchangeDraft.blank()) } })
        if (d.exchanges.size > 1 && total > 0) ValueRow("Exchange total", Money.pkr(total))
    }
}

@Composable
private fun KaratMenu(karat: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.clickable(role = Role.DropdownList) { open = true }.padding(vertical = 8.dp)
                .semantics { contentDescription = "Karat, ${karat.ifEmpty { "none" }}" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(karat.ifEmpty { "Karat" }, color = if (karat.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            Icon(Icons.Filled.ExpandMore, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Karat") }, onClick = { open = false; onPick("") })
            exchangeKarats.forEach { k -> DropdownMenuItem(text = { Text(k) }, onClick = { open = false; onPick(k) }) }
        }
    }
}

// MARK: Notes and delivery

@Composable
internal fun NotesSection(holder: DraftHolder) {
    val d = holder.read()
    FormCard(title = "Notes", footer = "Kept with the order and carried to its invoice as a note for the shop. Never printed.") {
        WideFieldRow("Notes", d.notes, { t -> holder.edit { notes = t } }, prompt = "Anything the shop should remember", minLines = 2, maxLines = 6)
    }
}

/** "Is this being delivered?" Off by default, because most pieces are collected from the shop. */
@Composable
internal fun DeliverySection(
    holder: DraftHolder,
    /** The customer's saved address and every one they have had pieces delivered to: offered, never filled in by itself. */
    knownAddresses: () -> List<String>,
) {
    val d = holder.read()
    FormCard(title = "Delivery") {
        ToggleRow("Deliver this", d.deliver) { on -> holder.edit { deliver = on } }
        if (!d.deliver) return@FormCard
        val offered = knownAddresses().filter { it != NewOrderFormat.trim(d.deliveryAddress) }
        if (offered.size == 1) {
            ActionRow("Use their address on file", onClick = { holder.edit { deliveryAddress = offered[0] } })
        } else if (offered.size > 1) {
            AddressesMenu(offered) { a -> holder.edit { deliveryAddress = a } }
        }
        WideFieldRow("Address", d.deliveryAddress, { t -> holder.edit { deliveryAddress = t } }, prompt = "House / flat, street, area", minLines = 2, maxLines = 4)
        FieldRow("City", d.deliveryCity, { t -> holder.edit { deliveryCity = t } }, prompt = "Karachi", capitalization = KeyboardCapitalization.Words)
        FieldRow("Receiver", d.deliveryName, { t -> holder.edit { deliveryName = t } }, prompt = "If not the customer", capitalization = KeyboardCapitalization.Words)
        FieldRow("Receiver's phone", d.deliveryPhone, { t -> holder.edit { deliveryPhone = t } }, prompt = "Optional", keyboardType = KeyboardType.Phone)
        NumberRow("Delivery charge (PKR)", d.deliveryCharge, { t -> holder.edit { deliveryCharge = t } }, prompt = "0 if free")
        FieldRow("Instructions", d.deliveryNotes, { t -> holder.edit { deliveryNotes = t } }, prompt = "Landmark, timing, gate", capitalization = KeyboardCapitalization.Sentences)
        ToggleRow("Expected on a day", d.deliveryExpected.isNotEmpty()) { on -> holder.edit { deliveryExpected = if (on) NewOrderDay.today else "" } }
        if (d.deliveryExpected.isNotEmpty()) DateRow("Expected", d.deliveryExpected) { day -> holder.edit { deliveryExpected = day } }
    }
}

@Composable
private fun AddressesMenu(offered: List<String>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ActionRow("Addresses on file (${offered.size})", icon = Icons.Filled.LocationOn, onClick = { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            offered.forEach { a -> DropdownMenuItem(text = { Text(a) }, onClick = { open = false; onPick(a) }) }
        }
    }
}

// MARK: The shop's margin

/**
 * SHOP-ONLY, owners and staff (shop-margin.tsx): the 24k rate now, and what the order earns, hidden until tapped:
 * the counter turns its screen to show a customer the bill, and a margin beside the total is the one thing they must
 * not read off it. The figure is not worked out until it is tapped. A house that does not cost by gold (Mina) has none.
 * (The iPhone blurs the figure; an old Android cannot blur, so it is covered in dots instead.)
 */
@Composable
internal fun MarginSection(holder: DraftHolder, settings: Settings?, totals: () -> NewOrderMath.Totals) {
    val d = holder.read()
    var shown by rememberSaveable { mutableStateOf(false) }
    val house = EntryHouse.margin
    val perGram = NewOrderMath.costRatePerGram(d)
    val sheetTola = NewOrderLogic.sheetTola(settings)
    FormCard(title = "Our margin (shop only)", footer = "Never printed, and never on anything the customer sees.") {
        NumberRow("24k rate now (per tola)", d.costTola, { t -> holder.edit { costTola = t } }, prompt = "Leave empty for ${NewOrderLogic.assumedPercent(house)}%")
        Row(Modifier.fillMaxWidth().formRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.Lock, null, Modifier.padding(top = 2.dp).size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(NewOrderLogic.rateWords(perGram, house), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (sheetTola > 0 && sheetTola.toDouble() != NewOrderFormat.num(d.costTola)) {
            ActionRow("Use the rate sheet's ${Money.grouped(sheetTola.toDouble())} a tola", onClick = { holder.edit { costTola = sheetTola.toString() } })
        }
        Row(
            Modifier.fillMaxWidth().formRow().clickable(role = Role.Button) { shown = !shown }
                .semantics { contentDescription = if (shown) "Hide our margin" else "Show our margin" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Filled.Lock, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("We earn", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                if (shown) NewOrderLogic.marginWords(NewOrderMath.margin(d, settings, totals()), house) else "••.•% · PKR ••,•••",
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = erp.app.ui.theme.TabularDigits),
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                modifier = Modifier.weight(1.4f),
            )
        }
    }
}

// MARK: The totals

/**
 * The arithmetic as a running deduction: what the pieces come to, what comes off, and what is left. `grandTotal` is
 * stored NET of all of it, so it is the balance still owed (lib/order-payment.ts).
 */
@Composable
internal fun TotalsSection(totals: NewOrderMath.Totals, pieces: Int) {
    FormCard(title = "Totals", footer = if (totals.balance < 0) "More has been taken than the pieces come to." else null) {
        ValueRow("Items · " + NewOrderFormat.pieces(pieces), Money.pkr(totals.subtotal))
        if (totals.discount > 0) ValueRow("Discount", "− " + Money.pkr(totals.discount))
        if (totals.advance > 0) ValueRow("Advance paid", "− " + Money.pkr(totals.advance))
        if (totals.exchange > 0) ValueRow("Taken in exchange", "− " + Money.pkr(totals.exchange))
        ValueRow("Balance due", Money.pkr(totals.balance), strong = true)
    }
}
