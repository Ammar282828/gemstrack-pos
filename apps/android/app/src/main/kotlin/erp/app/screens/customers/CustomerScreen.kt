package erp.app.screens.customers

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.screens.invoices.InvoiceCredit
import erp.app.screens.invoices.InvoiceCreditSheet
import erp.app.ui.OwnerDeleteCodeSheet
import erp.app.ui.RowAction
import erp.app.ui.SwipeActions
import erp.app.ui.OwnerDeletion
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.LedgerSection
import erp.app.ui.LocalNoteState
import erp.app.ui.HeroAmount
import erp.app.ui.Monogram
import erp.app.ui.MonogramSize
import erp.app.ui.Note
import erp.app.ui.NoteHost
import erp.app.ui.NoteState
import erp.app.ui.NotAvailableState
import erp.app.ui.Pill
import erp.app.ui.QuickAction
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.StatusBadge
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.heroSheen
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.rememberNoteState
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.zoomDestination
import erp.core.logic.BalanceState
import erp.core.logic.Money
import erp.core.logic.balanceLine
import erp.core.models.Customer
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.util.concurrent.ConcurrentHashMap

/**
 * A customer just made on this phone, kept until the shelf brings them (staff poll every 25 seconds): the iPhone passes
 * it along as `seed`; here screens are made from a path, so it waits in this one place.
 */
object CustomerSeeds {
    private val made = ConcurrentHashMap<String, Customer>()
    fun put(c: Customer) { if (c.id.isNotEmpty()) made[c.id] = c }
    operator fun get(id: String): Customer? = made[id]
}

private class Facts(
    val customer: Customer,
    val invoices: List<Invoice>,
    val orders: List<Order>,
    val repairs: List<Repair>,
    val hisaab: List<HisaabEntry>,
    val owing: CustomerKit.Owing,
)

private const val HISAAB_SHOWN = 12

/**
 * One customer (src/app/customers/[id]/page.tsx), and what the web page leaves you to hunt for: what they owe (the
 * list's own figure, lib/owed.ts), their repairs, and a hisaab for owners. A removed customer is not shown (store.ts
 * splitRemoved): the web says "not found"; this says they were removed, since Settings > Recently removed puts them back.
 *
 * Remove is native for an owner (`removeCustomer`, lib/writes/customer-admin.ts): it hides the customer, and the ERP
 * checks the delete code with it. The sheet says what stays with them first.
 */
@Composable
fun CustomerScreen(id: String) {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val owner = session.isOwner
    val customers = rememberShelfStatus(book.customers)
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val repairs = rememberShelfStatus(book.repairs)
    LaunchedEffect(owner) { if (owner) book.hisaab.need() }
    val hisaabItems by book.hisaab.items.collectAsStateWithLifecycle()
    val hisaabLoaded by book.hisaab.loaded.collectAsStateWithLifecycle()
    val hisaabError by book.hisaab.error.collectAsStateWithLifecycle()
    val hisaabRevision by book.hisaab.revision.collectAsStateWithLifecycle()
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val own = LocalNoteState.current
    val note = if (own !== NoteState.Inert) own else rememberNoteState()

    val seed = CustomerSeeds[id]
    /** An invoice whose credit is being handed back (InvoiceCreditSheet). */
    var givingBack by remember { mutableStateOf<Invoice?>(null) }
    val customer = customers.items.firstOrNull { it.id == id } ?: seed
    val loaded = seed != null || (customers.loaded && invoices.loaded && orders.loaded && repairs.loaded && (!owner || hisaabLoaded))
    val failure = customers.error ?: invoices.error ?: orders.error ?: repairs.error ?: (if (owner) hisaabError else null)
    var deletion by remember { mutableStateOf<OwnerDeletion?>(null) }

    ScreenTitle(customer?.let { CustomerKit.shown(it) } ?: "Customer")
    ScreenActions {
        // Editing a profile is an owner's: the shop floor has no write to it, in the ERP or here.
        if (customer != null && !CustomerKit.isRemoved(customer) && owner) {
            TextButton(onClick = { navigator.open(CustomerKit.path(customer.id, "/edit")) }) { Text("Edit") }
        }
    }

    fun facts(c: Customer): Facts {
        val ledger = if (owner) hisaabItems else null
        val owed = CustomerKit.owed(invoices.items, customers.items, ledger)
        val mine = hisaabItems.filter { it.entityType == HisaabEntityType.customer && it.entityId == c.id }
        return Facts(
            customer = c,
            invoices = invoices.items.filter { it.customerId == c.id },
            orders = orders.items.filter { it.customerId == c.id },
            repairs = repairs.items.filter { it.customerId == c.id },
            hisaab = if (owner) mine else emptyList(),
            owing = CustomerKit.owing(c.id, owed, ledger),
        )
    }

    val shown = remember(customer, customers.revision, invoices.revision, orders.revision, repairs.revision, hisaabRevision, owner) {
        if (customer == null || CustomerKit.isRemoved(customer)) null else facts(customer)
    }

    /** Says what stays with them before it asks for the code (the web's confirmation), then hides them. */
    fun askToRemove(f: Facts) {
        val c = f.customer
        val name = CustomerKit.shown(c)
        val stays = CustomerMergeCounts(invoices = f.invoices.size, orders = f.orders.size, hisaab = f.hisaab.size, given = 0).sentence
        var detail = if (stays == "nothing") "$name will be hidden from the lists." else "$name will be hidden from the lists. Their $stays stay where they are."
        if (f.owing.total >= 1) detail += " They still owe ${Money.pkr(f.owing.total)}."
        detail += " Settings, then Recently removed, puts them back."
        deletion = OwnerDeletion("Delete customer $name", detail, final = false, run = { code ->
            ErpApi.shared.write("removeCustomer", mapOf("customerId" to c.id, "deleteCode" to code))
            note.show(Note("$name removed", "Settings, then Recently removed, puts them back."))
        })
    }

    Box(Modifier.fillMaxSize().zoomDestination(CustomerKit.path(id))) {
        ShelfState(loaded = loaded, error = failure, offline = customers.offline, connectionLost = connectionLost) {
            when {
                customer == null -> NotAvailableState(
                    "Customer not found", why = "They are not in the book on this phone.", icon = Icons.Filled.QuestionMark,
                )
                CustomerKit.isRemoved(customer) -> NotAvailableState(
                    "Removed", why = "${CustomerKit.shown(customer)} was removed. Settings, then Recently removed, puts them back.", icon = Icons.Filled.PersonOff,
                )
                shown != null -> Page(shown, owner, onGiveBack = { givingBack = it }) { askToRemove(shown) }
            }
        }
        if (own === NoteState.Inert) NoteHost(note)
    }
    deletion?.let { OwnerDeleteCodeSheet(it, onDismiss = { deletion = null }, onDone = {}) }
    givingBack?.let { inv ->
        InvoiceCreditSheet(inv, onDismiss = { givingBack = null }, onDone = { o -> note.show(Note(o.note.title, o.note.detail)) })
    }
}

@Composable
private fun Page(f: Facts, owner: Boolean, onGiveBack: (Invoice) -> Unit, onRemove: () -> Unit) {
    val navigator = LocalNavigator.current
    LazyColumn(
        Modifier.fillMaxSize().readableColumn(820.dp),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item { Header(f.customer) }
        item { OwedCard(f.owing) }
        item { InvoicesSection(f.invoices, owner, onGiveBack) { navigator.open(CustomerKit.place("/invoices/", it)) } }
        item { OrdersSection(f.orders) { navigator.open(CustomerKit.place("/orders/", it)) } }
        item { RepairsSection(f.repairs) { navigator.open(CustomerKit.place("/repairs?id=", it)) } }
        if (owner) item { HisaabSection(f.hisaab, f.customer.id) { navigator.open(CustomerKit.hisaabPath(f.customer.id)) } }
        item { DetailsSection(f.customer) }
        sizesItem(f.customer)
        // Removing is an owner's, as the web's direct write is.
        if (owner) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onRemove).ledgerRow(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(Icons.Filled.PersonRemove, contentDescription = null, tint = Tone.problem.color())
                            Text("Remove this customer", style = MaterialTheme.typography.bodyLarge, color = Tone.problem.color())
                        }
                    }
                    Text(
                        "Removing hides them; their invoices, orders and hisaab stay, and Settings, then Recently removed, puts them back. It asks for the delete code.",
                        Modifier.padding(horizontal = 4.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// MARK: Who, and how to reach them

@Composable
private fun Header(c: Customer) {
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Monogram(CustomerKit.shown(c), size = MonogramSize.hero)
            Text(CustomerKit.shown(c), style = ErpType.heading, textAlign = TextAlign.Center)
            CustomerKit.filled(c.phone)?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Contact("Call", Icons.Filled.Call, CustomerKit.callUri(c.phone) != null, Modifier.weight(1f)) { CustomerLinks.call(context, c.phone) }
            Contact("WhatsApp", Icons.AutoMirrored.Filled.Chat, CustomerKit.whatsAppUri(c.phone) != null, Modifier.weight(1f)) { CustomerLinks.whatsApp(context, c.phone) }
            Contact("Message", Icons.Filled.Sms, CustomerKit.messageUri(c.phone) != null, Modifier.weight(1f)) { CustomerLinks.message(context, c.phone) }
        }
    }
}

@Composable
private fun Contact(title: String, icon: ImageVector, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    QuickAction(
        title, icon, onClick = { if (enabled) onClick() },
        modifier = modifier.alpha(if (enabled) 1f else 0.38f).semantics { if (!enabled) disabled() },
    )
}

// MARK: Owed

@Composable
private fun OwedCard(o: CustomerKit.Owing) {
    Column(Modifier.heroSheen(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Owed to you", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HeroAmount(o.total)
        Text(owedDetail(o), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal fun owedDetail(o: CustomerKit.Owing): String {
    val parts = ArrayList<String>()
    if (o.total <= 0.5 && o.shopOwesThem <= 0.5) parts += "Nothing outstanding"
    if (o.onInvoices >= 1) parts += "On ${o.invoiceCount} invoice${if (o.invoiceCount == 1) "" else "s"} ${Money.pkr(o.onInvoices)}"
    if (o.inHisaab >= 1) parts += "In the hisaab ${Money.pkr(o.inHisaab)}"
    if (o.shopOwesThem >= 1) parts += "The hisaab owes them ${Money.pkr(o.shopOwesThem)}"
    return parts.joinToString(" · ")
}

// MARK: Details and sizes

@Composable
private fun DetailsSection(c: Customer) {
    val address = listOf(c.address, c.city, c.country).mapNotNull { CustomerKit.filled(it) }.joinToString(", ")
    LedgerSection("Customer details", collapsible = true) {
        val rows = buildList {
            CustomerKit.filled(c.phone)?.let { add("Phone" to it) }
            CustomerKit.filled(c.altPhone)?.let { add("Second number" to it) }
            CustomerKit.filled(c.email)?.let { add("Email" to it) }
            if (address.isNotEmpty()) add("Address" to address)
            c.source?.let { add("Source" to CustomerKit.sourceLabel(it)) }
            CustomerKit.filled(c.birthday)?.let { add("Birthday" to CustomerKit.day(it)) }
            CustomerKit.filled(c.anniversary)?.let { add("Anniversary" to CustomerKit.day(it)) }
            CustomerKit.filled(c.preference)?.let { add("Prefers" to it) }
            CustomerKit.filled(c.notes)?.let { add("Notes" to it) }
        }
        rows.forEachIndexed { i, (label, value) ->
            DetailRow(label, value)
            if (i < rows.lastIndex) LedgerDivider()
        }
    }
}

/** One line on the web ("Ring 14 · Bangle 2.6"): here a row each, and no section when none is on file. */
private fun androidx.compose.foundation.lazy.LazyListScope.sizesItem(c: Customer) {
    val sizes = listOf(
        "Ring" to CustomerKit.filled(c.ringSize), "Bangle" to CustomerKit.filled(c.bangleSize),
        "Bracelet" to CustomerKit.filled(c.braceletSize), "Chain" to CustomerKit.filled(c.chainLength),
    ).mapNotNull { (k, v) -> v?.let { k to it } }
    if (sizes.isEmpty()) return
    item {
        LedgerSection("Sizes", collapsible = true) {
            sizes.forEachIndexed { i, (label, value) ->
                DetailRow(label, value)
                if (i < sizes.lastIndex) LedgerDivider()
            }
        }
    }
}

// MARK: Their invoices, orders, repairs

@Composable
private fun EmptyLine(text: String) {
    Text(text, Modifier.fillMaxWidth().ledgerRow(), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun InvoicesSection(list: List<Invoice>, owner: Boolean, onGiveBack: (Invoice) -> Unit, open: (String) -> Unit) {
    LedgerSection("Invoices · ${list.size}") {
        if (list.isEmpty()) EmptyLine("No sales history found for this customer.")
        list.forEachIndexed { i, inv ->
            // Credit they have paid ahead: the owner can hand it back (decision "Invoice credit").
            val giveBack = if (owner && InvoiceCredit.canGiveBack(inv)) RowAction("Give back", Icons.Filled.Payments, Tone.credit) { onGiveBack(inv) } else null
            SwipeActions(end = giveBack, menu = listOfNotNull(giveBack)) {
                Box(Modifier.clickable(role = Role.Button) { open(inv.id) }.ledgerRow()) { CustInvoiceRow(inv) }
            }
            if (i < list.lastIndex) LedgerDivider()
        }
        // A swipe is easy to miss: the same action as a plain row, one per invoice in credit.
        if (owner) {
            list.filter { InvoiceCredit.canGiveBack(it) }.forEach { inv ->
                LedgerDivider()
                Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onGiveBack(inv) }.ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Payments, null, Modifier.padding(end = 8.dp), tint = Tone.credit.color())
                    Text(InvoiceCredit.rowWords(inv), color = Tone.credit.color(), style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

@Composable
private fun OrdersSection(list: List<Order>, open: (String) -> Unit) {
    LedgerSection("Orders · ${list.size}") {
        if (list.isEmpty()) EmptyLine("No custom orders found for this customer.")
        list.forEachIndexed { i, order ->
            Box(Modifier.clickable(role = Role.Button) { open(order.id) }.ledgerRow()) { CustOrderRow(order) }
            if (i < list.lastIndex) LedgerDivider()
        }
    }
}

@Composable
private fun RepairsSection(list: List<Repair>, open: (String) -> Unit) {
    LedgerSection("Repairs · ${list.size}") {
        if (list.isEmpty()) EmptyLine("No repairs for this customer.")
        list.forEachIndexed { i, repair ->
            Box(Modifier.clickable(role = Role.Button) { open(repair.id) }.ledgerRow()) { CustRepairRow(repair) }
            if (i < list.lastIndex) LedgerDivider()
        }
    }
}

// MARK: Hisaab (owners)

@Composable
private fun HisaabSection(rows: List<HisaabEntry>, id: String, openAll: () -> Unit) {
    LedgerSection("Hisaab") {
        if (rows.isEmpty()) {
            EmptyLine("Nothing is written in their hisaab.")
            LedgerDivider()
        }
        rows.take(HISAAB_SHOWN).forEach { row ->
            Box(Modifier.fillMaxWidth().ledgerRow()) { CustHisaabRow(row) }
            LedgerDivider()
        }
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = openAll).ledgerRow(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.MenuBook, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(if (rows.size > HISAAB_SHOWN) "All ${rows.size} rows in their hisaab" else "Open their hisaab", style = MaterialTheme.typography.bodyLarge)
        }
    }
}

// MARK: Rows

internal fun invoiceSubtitle(invoice: Invoice): String {
    val line = balanceLine(invoice.balanceDue)
    val refunded = invoice.status == InvoiceStatus.refunded
    val parts = arrayListOf(ShopDate.say(invoice.createdAt))
    if (refunded) parts += "refunded"
    else if (line.state == BalanceState.due) parts += "owes ${Money.pkr(line.amount)}"
    else if (line.state == BalanceState.credit) parts += "credit ${Money.pkr(line.amount)}"
    return parts.joinToString(" · ")
}

@Composable
private fun CustInvoiceRow(invoice: Invoice) {
    val line = balanceLine(invoice.balanceDue)
    val refunded = invoice.status == InvoiceStatus.refunded
    TwoLine(
        invoice.id, subtitle = invoiceSubtitle(invoice), trailing = Money.pkr(invoice.grandTotal),
        trailingTint = if (!refunded && line.state == BalanceState.due) Tone.owed.color() else Color.Unspecified,
    )
}

internal fun orderSubtitle(order: Order): String {
    val parts = arrayListOf(ShopDate.say(order.createdAt))
    val n = order.items.size
    if (n > 0) parts += "$n piece${if (n == 1) "" else "s"}"
    if (!order.invoiceId.isNullOrEmpty()) parts += "invoiced"
    return parts.joinToString(" · ")
}

@Composable
private fun CustOrderRow(order: Order) {
    val closed = order.status == OrderStatus.cancelled || order.status == OrderStatus.refunded
    val invoiced = !order.invoiceId.isNullOrEmpty()
    // The order's total is stored net of its advances, so it is the balance still to pay (order-payment.ts).
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        TwoLine(
            order.id, Modifier.weight(1f), subtitle = orderSubtitle(order), trailing = Money.pkr(order.grandTotal),
            trailingTint = if (closed || invoiced) MaterialTheme.colorScheme.onSurfaceVariant else Color.Unspecified,
        )
        StatusBadge(order.status)
    }
}

internal fun repairSubtitle(repair: Repair): String {
    val open = repair.status == RepairStatus.received || repair.status == RepairStatus.ready
    val parts = arrayListOf(repair.id, ShopDate.say(repair.receivedAt))
    val promised = CustomerKit.filled(repair.promisedDate)
    if (open && promised != null) parts += "promised ${ShopDate.say(promised)}"
    return parts.joinToString(" · ")
}

@Composable
private fun CustRepairRow(repair: Repair) {
    val balance = CustomerKit.repairBalance(repair)
    val open = repair.status == RepairStatus.received || repair.status == RepairStatus.ready
    val (text, tone) = CustomerKit.repairStatus(repair.status)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        TwoLine(
            CustomerKit.repairSummary(repair), Modifier.weight(1f), subtitle = repairSubtitle(repair),
            trailing = if (open && balance >= 1) Money.pkr(balance) else null, trailingTint = Tone.owed.color(),
        )
        Pill(text, tone = tone)
    }
}

/** What they owe goes up (+), what they pay comes off (-): debit less credit, as the ERP keeps it. */
internal fun hisaabAmount(entry: HisaabEntry): String? {
    val net = entry.cashDebit - entry.cashCredit
    if (Math.abs(net) < 1) return null
    return (if (net > 0) "+" else "-") + Money.pkr(Math.abs(net))
}

internal fun hisaabSubtitle(entry: HisaabEntry, metal: String): String {
    val parts = arrayListOf(ShopDate.say(entry.date))
    // The house's own metal: the hisaab's "gold" columns hold silver in House of Mina (STORE_METAL_WORD).
    if (entry.goldDebitGrams > 0) parts += "gave ${CustomerKit.grams(entry.goldDebitGrams)} g $metal"
    if (entry.goldCreditGrams > 0) parts += "got ${CustomerKit.grams(entry.goldCreditGrams)} g $metal"
    CustomerKit.filled(entry.linkedInvoiceId)?.let { parts += "invoice $it" }
    return parts.joinToString(" · ")
}

@Composable
private fun CustHisaabRow(entry: HisaabEntry) {
    val net = entry.cashDebit - entry.cashCredit
    TwoLine(
        CustomerKit.filled(entry.description) ?: "Entry", subtitle = hisaabSubtitle(entry, House.metal),
        trailing = hisaabAmount(entry), trailingTint = if (net > 0) Tone.owed.color() else Tone.settled.color(),
    )
}
