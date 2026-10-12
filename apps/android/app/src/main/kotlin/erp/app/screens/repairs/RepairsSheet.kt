package erp.app.screens.repairs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Print
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfItem
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.screens.owner.OwnerAsk
import erp.app.screens.owner.OwnerAskSheet
import erp.app.screens.owner.ownerAsk
import erp.app.ui.HeroAmount
import erp.app.ui.LedgerHeading
import erp.app.ui.NotAvailableState
import erp.app.ui.Pill
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import erp.app.web.WebScreen
import erp.core.logic.Money
import erp.core.logic.isWalkInName
import erp.core.logic.repairBalance
import erp.core.logic.repairPaid
import erp.core.logic.repairSummary
import erp.core.logic.repairTotal
import erp.core.models.Repair
import erp.core.models.RepairPiece
import erp.core.models.RepairPayment
import erp.core.models.RepairStatus
import java.time.Instant

/**
 * One ticket, as a sheet on the list (the ERP has no /repairs/<id>: its page opens a ticket in a dialog). What is on it: its
 * pieces, the money, where it stands and who has it. Ready, Collected, Take payment, Edit, Cancel and Delete are native and
 * owners' (the ERP lets only an owner write a repair); Delete asks for the delete code, which the ERP checks with the
 * delete, and takes the money paid out of Extra revenue with the ticket. Print receipt is the ERP's page: the receipt is
 * drawn in the browser (src/lib/repair-pdf.ts, jsPDF and the page's QR codes), so it opens over the sheet as the iPhone's
 * does inside the sheet's own stack.
 */
@Composable
fun RepairsSheet(id: String, seed: Repair?, onDismiss: () -> Unit) {
    val session = LocalSession.current
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val desk = rememberRepairsDesk()
    val shelfItem = rememberShelfItem(book.repairs, id)
    val loaded = rememberShelfStatus(book.repairs).loaded
    val current: Repair? = shelfItem ?: seed

    var web by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    var deletion by remember { mutableStateOf<OwnerAsk?>(null) }
    // The ticket is gone: the sheet leaves once the code sheet has.
    var deleted by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }

    RepairsSheetFrame(
        title = id,
        onDismiss = onDismiss,
        trailing = { _ ->
            Box {
                IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                val cancellable = current?.let { it.status == RepairStatus.received || it.status == RepairStatus.ready } ?: false
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    // Print receipt is the ERP's page for this ticket (it draws the PDF), open to everyone who can read the ticket;
                    // Edit, Cancel and Delete are native and owners'. Cancel keeps the record.
                    DropdownMenuItem(
                        text = { Text("Print receipt") }, leadingIcon = { Icon(Icons.Filled.Print, null) },
                        onClick = { menuOpen = false; web = RepairsKit.webPath(id) },
                    )
                    if (session.isOwner && current != null) {
                        DropdownMenuItem(
                            text = { Text("Edit") }, leadingIcon = { Icon(Icons.Filled.Edit, null) },
                            onClick = { menuOpen = false; editing = true },
                        )
                        if (cancellable) {
                            DropdownMenuItem(
                                text = { Text("Cancel repair", color = Tone.problem.color()) },
                                leadingIcon = { Icon(Icons.Filled.Close, null, tint = Tone.problem.color()) },
                                onClick = { menuOpen = false; desk.askCancel(current) },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Delete", color = Tone.problem.color()) },
                            leadingIcon = { Icon(Icons.Filled.Delete, null, tint = Tone.problem.color()) },
                            onClick = { menuOpen = false; deletion = askDelete(current) },
                        )
                    }
                }
            }
        },
        bottom = if (current != null && session.isOwner && RepairsKit.hasActions(current)) {
            { ActionBar(current, desk) }
        } else {
            null
        },
    ) { close ->
        when {
            current != null -> Detail(current, session.isOwner, session.shop.name, onCustomer = { cid -> close(); navigator.open("/customers/$cid") }, context = context)
            !loaded -> SkeletonLoading(Modifier.fillMaxWidth())
            else -> NotAvailableState("Repair not found", why = "$id is not in the book. It may have been deleted.", icon = Icons.Filled.Build)
        }
    }

    RepairsDeskHost(desk)

    web?.let { path -> RepairsWebPage(path, onClose = { web = null }) }
    if (editing && current != null) RepairsForm(editing = current, onDismiss = { editing = false }, onSaved = { _, _ -> })
    deletion?.let { d ->
        OwnerAskSheet(
            d,
            onDismiss = { deletion = null; if (deleted) onDismiss() },
            onDone = { deleted = true },
        )
    }
}

/**
 * The web's "cancel or delete?": Delete removes the ticket for good, and the money paid on it comes out of Extra revenue
 * with it. Said before the code is asked for.
 */
internal fun askDelete(r: Repair): OwnerAsk {
    val id = r.id
    val paid = repairPaid(r)
    var detail = "${repairSummary(r)} — ${RepairsKit.customer(r)}. Delete removes it for good"
    detail += if (paid > 0) ", and the ${Money.pkr(paid)} paid comes out of Extra revenue with it." else "."
    if (r.status == RepairStatus.received || r.status == RepairStatus.ready) detail += " Cancel repair keeps the record instead."
    return ownerAsk(what = "Delete repair $id", detail = detail) { code ->
        ErpApi.shared.write("deleteRepair", mapOf("repairId" to id, "deleteCode" to code))
    }
}

/** The ERP's own page over the sheet, with a way back (the iPhone pushes it on the sheet's own stack). */
@Composable
private fun RepairsWebPage(path: String, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                    Text("Print receipt", style = MaterialTheme.typography.titleMedium)
                }
                Box(Modifier.weight(1f).fillMaxWidth()) { WebScreen(erp.app.nav.ScreenRegistry.withoutWebFlag(path)) }
            }
        }
    }
}

// MARK: The ticket

@Composable
private fun Detail(r: Repair, isOwner: Boolean, shopName: String, onCustomer: (String) -> Unit, context: android.content.Context) {
    val now = remember(r) { Instant.now() }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        HeaderCard(r, now, shopName, onCustomer, context)
        PiecesCard(r)
        MoneyCard(r, now)
        DetailsCard(r, isOwner, now)
    }
}

@Composable
private fun HeaderCard(r: Repair, now: Instant, shopName: String, onCustomer: (String) -> Unit, context: android.content.Context) {
    RepairsSection {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                Text(
                    repairSummary(r), Modifier.weight(1f),
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                )
                Pill(RepairsKit.label(r.status), tone = RepairsKit.tone(r.status))
            }
            Text("${r.id} · in ${RepairsKit.byDay(r.receivedAt, now)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            PromiseText(r, now, large = true)
        }
        val name = RepairsKit.customer(r)
        val cid = r.customerId
        if (!cid.isNullOrEmpty() && !isWalkInName(r.customerName)) {
            Box(Modifier.clickable(role = Role.Button) { onCustomer(cid) }) { RepairsLabeled("Customer", name, tint = ErpColors.accent) }
        } else {
            RepairsLabeled("Customer", name)
        }
        RepairsKit.filled(r.customerContact)?.let { phone ->
            val uri = RepairsKit.callUri(phone)
            if (uri != null) {
                Box(Modifier.clickable(role = Role.Button) { openUrl(context, uri, android.content.Intent.ACTION_DIAL) }) { RepairsLabeled("Phone", phone, tint = ErpColors.accent) }
            } else {
                RepairsLabeled("Phone", phone)
            }
        }
        // The page's "Tell them": the ready message, on WhatsApp, for a Ready ticket with a number.
        if (r.status == RepairStatus.ready) {
            RepairsKit.whatsAppUrl(r, shopName)?.let { url ->
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { openUrl(context, url) },
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Chat, null, tint = ErpColors.accent)
                    Text("Tell them it's ready", color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

@Composable
private fun PiecesCard(r: Repair) {
    RepairsSection(title = "Pieces (${r.pieces.size})") {
        r.pieces.forEach { PieceRow(it) }
    }
}

@Composable
private fun PieceRow(p: RepairPiece) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.item.ifEmpty { "Piece" }, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
            if (p.work.isNotEmpty()) Text(p.work, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            p.weightG?.let { w -> if (w > 0) Text(RepairsKit.grams(w), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        p.price?.let { price -> if (price > 0) Text(Money.pkr(price), style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun MoneyCard(r: Repair, now: Instant) {
    val total = repairTotal(r)
    val paid = repairPaid(r)
    val owing = repairBalance(r)
    RepairsSection(title = "Money") {
        RepairsLabeled("Total", Money.pkr(total))
        if (paid > 0) RepairsLabeled("Paid", Money.pkr(paid), tint = Tone.settled.color())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Balance due", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            HeroAmount(owing)
        }
        r.payments.forEach { PaymentLine(it, now) }
    }
}

/** "Today · Cash · Advance". */
@Composable
private fun PaymentLine(p: RepairPayment, now: Instant) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Text(RepairsKit.paymentWords(p, now), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(Money.pkr(p.amount), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DetailsCard(r: Repair, isOwner: Boolean, now: Instant) {
    RepairsSection(title = "Details") {
        RepairsLabeled("Taken in", ShopDate.say(r.receivedAt, withTime = true, now = now))
        RepairsKit.filled(r.promisedDate)?.let { RepairsLabeled("Ready by", ShopDate.say(it, now = now)) }
        RepairsKit.filled(r.readyAt)?.let { RepairsLabeled("Marked ready", ShopDate.say(it, withTime = true, now = now)) }
        RepairsKit.filled(r.collectedAt)?.let { RepairsLabeled("Collected", ShopDate.say(it, withTime = true, now = now)) }
        RepairsKit.filled(r.karigarName)?.let { RepairsLabeled("Karigar", it) }
        RepairsKit.filled(r.takenBy)?.let { RepairsLabeled("Taken by", it) }
        // For the shop only: never printed, never sent, and an owner's to read.
        if (isOwner) {
            RepairsKit.filled(r.internalNote)?.let { note ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Note for the shop", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(note)
                }
            }
        }
    }
}

// MARK: The next step

/** Ready, Collected, Take payment under the ticket: the primary step in the accent, the money beside it. */
@Composable
private fun ActionBar(r: Repair, desk: RepairsDesk) {
    val busy = desk.isBusy(r.id)
    val owing = r.status != RepairStatus.cancelled && repairBalance(r) > 0
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (r.status == RepairStatus.received) {
            ActionButton("Mark ready", Icons.Filled.CheckCircle, true, busy, Modifier.weight(1f)) { desk.markReady(r) }
        }
        if (r.status == RepairStatus.ready) {
            ActionButton("Collected", Icons.Filled.Inventory2, true, busy, Modifier.weight(1f)) { desk.collect(r) }
        }
        if (owing) {
            ActionButton("Take payment", Icons.Filled.Payments, false, busy, Modifier.weight(1f)) { desk.taking = r }
        }
    }
}

@Composable
private fun ActionButton(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, primary: Boolean, busy: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val content: @Composable () -> Unit = {
        Icon(icon, null, Modifier.padding(end = 8.dp))
        Text(title)
    }
    if (primary) {
        Button(onClick, modifier, enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent)) { content() }
    } else {
        OutlinedButton(onClick, modifier, enabled = !busy) { content() }
    }
}
