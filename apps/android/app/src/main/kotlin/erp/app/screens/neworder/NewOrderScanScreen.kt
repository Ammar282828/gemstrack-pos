package erp.app.screens.neworder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberSingle
import erp.app.ui.MinTouchTarget
import erp.app.ui.NotAvailableState
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.core.entry.NewOrderScanAnswer
import erp.core.entry.NewOrderScanItem
import erp.core.entry.NewOrderScanReading
import erp.core.entry.NewOrderSlip
import erp.core.entry.fillFromSlip
import erp.core.logic.Money
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// Read a slip (components/order/order-scanner.tsx): a parchi photographed, front and back, a second page, or a
// picture of the piece beside it, read by the ERP's reader (/api/vision/order, Gemini, owners only: the shop's AI
// account pays for it) and laid into New order's form for the person to check and save. Nothing is created here.
//
// The photos stay on screen beside the reading, the names it could not pin are offered as a choice, and a slip that
// does not add up as read says where. Up to six photos are read together as one order; adding or removing one reads
// the set again, because the second page changes what the first page means. (NewOrderScanScreen.swift.)

/** The route's own cap: front, back, a second page and the piece is four. */
private const val MAX_PHOTOS = 6

@Composable
internal fun ScanSlipPage(holder: DraftHolder, onClose: () -> Unit) {
    val session = LocalSession.current
    val book = LocalBook.current
    val customers by rememberShelf(book.customers)
    val karigars by rememberShelf(book.karigars)
    val settings by rememberSingle(book.settings)
    val scope = rememberCoroutineScope()

    var photos by remember { mutableStateOf(listOf<PaperPhoto>()) }
    var reading by remember { mutableStateOf<NewOrderScanReading?>(null) }
    // The names are picked in place on the reading, so a change to one says so here.
    var picks by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    /** The whole set, sent together (`{ images: [{ data, mimeType }] }`), and the names matched against the book. */
    fun read() {
        val set = photos
        if (set.isEmpty() || busy) return
        busy = true
        reading = null
        problem = null
        scope.launch {
            try {
                val text = PaperReader.ask("/api/vision/order", mapOf("images" to set.map { it.payload }))
                val answer = NewOrderScanAnswer.read(text)
                if (answer == null) {
                    problem = "The ERP's answer could not be read back. Try again."
                } else if (set.map { it.id } == photos.map { it.id }) {
                    reading = NewOrderScanReading.resolve(answer, customers, karigars)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                problem = PaperReader.words(e)
            } finally {
                busy = false
            }
        }
    }

    fun add(added: List<PaperPhoto>) {
        problem = null
        photos = (photos + added).take(MAX_PHOTOS)
        read()
    }

    /** A photo taken away is really gone: the rest are read again without it. */
    fun remove(id: UUID) {
        photos = photos.filter { it.id != id }
        problem = null
        if (photos.isEmpty()) reading = null else read()
    }

    /**
     * The reading into the order (NewOrderDraft.fill(fromSlip:)): the customer and karigar as picked here, the photos as
     * the pieces' reference pictures. The form then shows it all, to be checked and saved there.
     */
    fun fill() {
        val r = reading ?: return
        val customer = r.customer?.pinned?.let { p -> book.customers.item(p.id) }
        holder.edit {
            fillFromSlip(
                scan = r.answer,
                customer = customer,
                heardCustomer = if (customer == null) r.customer?.heard else null,
                karigarId = r.karigar?.pinned?.id ?: "",
                photos = photos.map { it.small },
                fallbackMetal = House.metal,
                settings = settings,
            )
        }
        onClose()
    }

    FullScreenPage(
        title = "Read a slip",
        onBack = onClose,
        bottomBar = {
            if (session.isOwner) {
                val seeded = holder.read().ratesSeeded
                Button(
                    onClick = ::fill,
                    // The rates are seeded from today's before the slip's go in: the shop's settings must have arrived.
                    enabled = reading != null && !busy && photos.isNotEmpty() && (seeded || settings != null),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).defaultMinSize(minHeight = MinTouchTarget),
                ) {
                    Icon(Icons.Filled.Check, null)
                    Text("Fill the form", Modifier.padding(start = 8.dp))
                }
            }
        },
    ) {
        if (!session.isOwner) {
            NotAvailableState(
                "Reading a slip is for the owners",
                why = "The ERP reads paper with the shop's AI account, which only an owner's sign-in may use. Type the order in, or ask an owner.",
            )
        } else {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                FormCard(
                    title = "The slip",
                    footer = if (photos.isEmpty()) {
                        "A parchi, front and back, or a picture of the piece: up to six, read together as one order. Nothing is saved here: the form is filled in for you to check."
                    } else {
                        "Read together as one order. The first photo goes on the order as its reference picture, unless the reading says which photo shows which piece."
                    },
                ) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (photos.isNotEmpty()) PaperPhotoStrip(photos, remove = if (busy) null else ::remove)
                        if (photos.size < MAX_PHOTOS) {
                            PaperPicker(
                                room = MAX_PHOTOS - photos.size,
                                scanTitle = if (photos.isEmpty()) "Scan the slip" else "Scan another",
                                disabled = busy,
                                onAdd = ::add,
                                onProblem = { problem = it },
                            )
                        }
                    }
                }
                if (busy) {
                    FormCard(footer = "Usually a few seconds; up to a minute when the shop's AI is busy.") {
                        Row(Modifier.fillMaxWidth().formRow(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            SkeletonLoading(compact = true)
                            Text(if (photos.size > 1) "Reading ${photos.size} photos…" else "Reading it…")
                        }
                    }
                }
                problem?.let { FormCard(title = "Could not read that") { NoteRow(it, Icons.Filled.Warning, Tone.problem) } }
                val r = reading
                if (r != null && !busy) {
                    picks.let { }
                    ReadingSections(r, photos.size, onPick = { picks += 1 })
                }
            }
        }
    }
}

@Composable
private fun ReadingSections(r: NewOrderScanReading, photoCount: Int, onPick: () -> Unit) {
    val a = r.answer
    val check = NewOrderSlip.check(a)
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        a.unreadable?.takeIf { it.isNotEmpty() }?.let { unread ->
            FormCard(title = "Could not make this out") { NoteRow(unread, Icons.AutoMirrored.Filled.HelpOutline, Tone.owed) }
        }
        if (check.warnings.isNotEmpty()) {
            FormCard(
                title = "The slip does not add up as read",
                footer = "Nothing has been corrected: check the figures against the photo, and fix them on the form.",
            ) {
                check.warnings.forEach { w -> NoteRow(w, Icons.Filled.Warning, Tone.owed) }
            }
        }
        r.karigar?.let { g ->
            PaperNamePick("Karigar", g, "Nobody in the book sounds like that: choose the karigar on each piece.") { p -> g.pinned = p; onPick() }
        }
        r.customer?.let { g ->
            PaperNamePick("Customer", g, "Nobody in the book sounds like that: the name goes on the order as written, as a new customer.") { p -> g.pinned = p; onPick() }
        }
        FormCard(
            title = NewOrderScanLogic.piecesTitle(a.items.size),
            footer = if (NewOrderScanLogic.hasAnyHisaab(a)) {
                "The rate on the slip goes into the order's rate box, so the form prices these pieces the way the slip did. Change the rate on the form and they move with it."
            } else {
                null
            },
        ) {
            if (a.items.isEmpty()) NoteRow("No pieces could be read off this. Filling the form adds one empty piece to start by hand.")
            a.items.forEachIndexed { i, it -> ScanPieceRow(it, off = check.itemsOff.contains(i), photoCount = photoCount) }
        }
        FootSection(a, check)
    }
}

@Composable
private fun ScanPieceRow(it: NewOrderScanItem, off: Boolean, photoCount: Int) {
    val s = NewOrderSlip
    val written = s.num(it.lineTotal)
    val computed = s.linePrice(it)
    Column(Modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TwoLine(
            title = if (it.description.isNullOrEmpty()) "Unnamed piece" else it.description!!,
            subtitle = NewOrderScanLogic.pieceBits(it, photoCount).joinToString(" · "),
            trailing = if (written > 0) Money.pkr(written) else null,
            trailingTint = if (off) Tone.problem.color() else androidx.compose.ui.graphics.Color.Unspecified,
        )
        if (computed != null && written <= 0) {
            Text("Rate × weight comes to ${Money.pkr(computed)}: no amount was written against it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        it.note?.takeIf { n -> n.isNotEmpty() }?.let { n -> Text(n, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun FootSection(a: NewOrderScanAnswer, check: NewOrderSlip.Check) {
    if (!NewOrderScanLogic.hasFoot(a)) return
    val s = NewOrderSlip
    val ex = s.exchangeValue(a.exchange)
    FormCard(
        title = "Foot of the slip",
        footer = "The advance, the discount and the old gold go into their own boxes. The slip's totals are only checked: the form works out its own.",
    ) {
        if (s.num(a.subtotal) > 0) ValueRow("Pieces", Money.pkr(s.num(a.subtotal)))
        if (s.num(a.discount) > 0) ValueRow("Discount", "− " + Money.pkr(s.num(a.discount)))
        if (s.num(a.advancePayment) > 0) ValueRow("Advance (cash)", "− " + Money.pkr(s.num(a.advancePayment)))
        a.exchange?.let { x ->
            Row(Modifier.fillMaxWidth().formRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Taken in exchange")
                    Text(NewOrderScanLogic.exchangeWords(x, ex.from), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    if (ex.from == NewOrderSlip.ExchangeFrom.unpriced) "No figure" else "− " + Money.pkr(ex.value),
                    color = if (ex.from == NewOrderSlip.ExchangeFrom.unpriced) Tone.problem.color() else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        if (s.num(a.balanceDue) > 0) {
            Row(Modifier.fillMaxWidth().formRow(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Balance written"); Text(Money.pkr(s.num(a.balanceDue)), fontWeight = FontWeight.SemiBold)
            }
        } else {
            check.balance?.let { b ->
                Row(Modifier.fillMaxWidth().formRow(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Balance, as the figures read"); Text(Money.pkr(b), fontWeight = FontWeight.SemiBold)
                }
            }
        }
        a.expectedDate?.takeIf { it.isNotEmpty() }?.let { ValueRow("Wanted by", it) }
        a.notes?.takeIf { it.isNotEmpty() }?.let { NoteRow(it) }
    }
}
