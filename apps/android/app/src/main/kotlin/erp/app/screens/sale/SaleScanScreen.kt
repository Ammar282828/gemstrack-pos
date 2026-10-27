package erp.app.screens.sale

import erp.app.ui.icons.Symbols
import android.util.Base64
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import erp.app.ui.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
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
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderSlip
import erp.core.entry.SaleBill
import erp.core.entry.SaleBillAnswer
import erp.core.entry.SaleBillLine
import erp.core.entry.SaleBillReading
import erp.core.entry.SaleDraft
import erp.core.entry.SaleFigures
import erp.core.entry.fillFromBill
import erp.core.logic.Money
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch
import erp.app.ui.ValueRow
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.PaperPhoto
import erp.app.ui.PaperReader
import erp.app.ui.PaperPicker
import erp.app.ui.PaperPhotoStrip
import erp.app.ui.PaperNamePick

/**
 * Read a written bill (components/cart/bill-scanner.tsx): a handwritten bill or estimate photographed, read by the
 * ERP's reader (/api/vision/bill, owners only) and put on New sale for the person to check and save. Nothing is
 * invoiced here.
 *
 * A bill has two kinds of line, and this screen never lets them look alike: one that showed its working is priced
 * from the rate (the bill's own, held in its box), one that showed only a figure is billed at that figure and will not
 * move when the rate does. Lines can be left off before they go on the sale.
 *
 * [draft] is the sale's draft: the lines are added to it ([onDraft]), and the sale shows them on return. A new sale
 * is kept on this phone as well (SaleStore); an invoice being edited is not ([keep]).
 */
@Composable
internal fun SaleScanScreen(draft: SaleDraft, onDraft: (SaleDraft) -> Unit, keep: Boolean, onClose: () -> Unit) {
    FullScreenSheet(title = "Read a written bill", onCancel = onClose, cancelText = "Back") {
        if (LocalSession.current.isOwner) {
            ScanForm(draft, onDraft, keep, onClose)
        } else {
            NotAvailableState(
                "Reading a bill is for the owners",
                why = "The ERP reads paper with the shop's AI account, which only an owner's sign-in may use.",
            )
        }
    }
}

@Composable
private fun ScanForm(draft: SaleDraft, onDraft: (SaleDraft) -> Unit, keep: Boolean, onClose: () -> Unit) {
    val book = LocalBook.current
    val customers by rememberShelf(book.customers)
    val settings by rememberSingle(book.settings)
    val scope = rememberCoroutineScope()
    var photo by remember { mutableStateOf<PaperPhoto?>(null) }
    var reading by remember { mutableStateOf<SaleBillReading?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    /** One photo (`{ image, mimeType }`), as the browser sends a bill; the customer matched against the book. */
    fun read() {
        val p = photo ?: return
        if (busy) return
        busy = true
        reading = null
        problem = null
        scope.launch {
            try {
                val text = PaperReader.ask("/api/vision/bill", mapOf("image" to Base64.encodeToString(p.jpeg, Base64.NO_WRAP), "mimeType" to "image/jpeg"))
                val answer = SaleBillAnswer.read(text)
                if (answer == null) {
                    problem = "The ERP's answer could not be read back. Try again."
                } else if (photo?.id == p.id) {
                    reading = SaleBillReading.resolve(answer, customers)
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

    /**
     * The kept lines onto the sale (SaleDraft.fillFromBill), the rates it set remembered as the bill's (SaleScanHeld),
     * and a new sale kept on the phone at once so the form, reading it back, finds them there.
     */
    fun fill() {
        val r = reading ?: return
        val customer = r.customer?.pinned?.let { p -> book.customers.item(p.id) }
        val next = draft.copy()
        val held = next.fillFromBill(r, customer, House.metal)
        SaleStore.hold(held, draft)
        onDraft(next)
        if (keep) SaleStore.save(next)
        onClose()
    }

    val n = reading?.kept?.size ?: 0
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            FormSection(
                "The bill",
                footer = {
                    Text(
                        if (photo == null) {
                            "A handwritten bill or estimate, with or without a breakdown, on the counter or already on this phone. The lines go on the sale for you to check: nothing is invoiced here."
                        } else {
                            "Retake or choose another to read again."
                        },
                    )
                },
            ) {
                photo?.let { p -> Column(Modifier.padding(12.dp)) { PaperPhotoStrip(listOf(p), remove = null) } }
                PaperPicker(
                    room = 1, scanTitle = if (photo == null) "Scan the bill" else "Retake", disabled = busy,
                    add = { added -> added.firstOrNull()?.let { photo = it; problem = null; read() } },
                    problem = { problem = it },
                    modifier = Modifier.padding(12.dp),
                )
            }
            if (busy) {
                FormSection("Reading it…", footer = { Text("Usually a few seconds; up to a minute when the shop's AI is busy.") }) {
                    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        SkeletonLoading(compact = true)
                        Text("Reading it…")
                    }
                }
            }
            problem?.let { text ->
                FormSection("Could not read that") {
                    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Symbols.Warning, contentDescription = null, tint = Tone.problem.color())
                        Text(text, color = Tone.problem.color())
                    }
                }
            }
            reading?.let { r ->
                if (!busy) ReadingSections(r, draft, settings, customers, onReading = { reading = it })
            }
        }
        // THE action: the kept lines onto the sale, then back to it.
        Button(
            onClick = ::fill,
            enabled = reading != null && !busy && n > 0,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).defaultMinSize(minHeight = 52.dp),
        ) {
            Icon(Symbols.Done, contentDescription = null, Modifier.size(18.dp))
            Text(if (n > 0) "Add ${if (n == 1) "1 line" else "$n lines"} to the sale" else "Add to the sale", Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun ReadingSections(
    r: SaleBillReading,
    draft: SaleDraft,
    settings: erp.core.models.Settings?,
    customers: List<erp.core.models.Customer>,
    onReading: (SaleBillReading) -> Unit,
) {
    val a = r.answer
    a.unreadable?.takeIf { it.isNotEmpty() }?.let { unread ->
        FormSection("Could not make this out") {
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Symbols.HelpOutline, contentDescription = null, tint = Tone.owed.color())
                Text(unread, color = Tone.owed.color())
            }
        }
    }
    r.customer?.let { g ->
        PaperNamePick("Customer", g, "Nobody in the book sounds like that: choose the customer on the sale.") { p ->
            onReading(r.copy(customer = g.copy(pinned = p)))
        }
    }
    LinesSection(r, onReading)
    FootSection(r, draft, settings, customers)
}

@Composable
private fun LinesSection(r: SaleBillReading, onReading: (SaleBillReading) -> Unit) {
    val lines = r.answer.lines
    val bare = r.kept.count { !SaleBill.hasBreakdown(it) }
    FormSection(
        "${r.kept.size} of ${lines.size} line${if (lines.size == 1) "" else "s"}",
        footer = {
            if (bare > 0) {
                Text("$bare line${if (bare == 1) "" else "s"} came without a weight, so ${if (bare == 1) "it is" else "they are"} billed at the written figure and will not move if you change the rate. Tap a line to leave it off.")
            } else if (lines.isNotEmpty()) {
                Text("Tap a line to leave it off the sale.")
            }
        },
    ) {
        if (lines.isEmpty()) {
            Text("No lines could be read off this. You can still bill it by hand.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        lines.forEachIndexed { i, l ->
            val on = !r.skipped.contains(i)
            Box_(on) {
                Row(
                    Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Checkbox) {
                        val skipped = r.skipped.toMutableSet()
                        if (!skipped.remove(i)) skipped.add(i)
                        onReading(r.copy(skipped = skipped))
                    },
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        if (on) Symbols.CheckCircle else Symbols.RadioButtonUnchecked,
                        contentDescription = if (on) "On the sale" else "Left off",
                        tint = if (on) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    LineRow(l, r.answer.ratePerGram)
                }
            }
        }
    }
}

@Composable
private fun Box_(on: Boolean, content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Box(Modifier.alpha(if (on) 1f else 0.45f)) { content() }
}

@Composable
private fun LineRow(l: SaleBillLine, billRate: Double?) {
    val s = NewOrderSlip
    val bits = ArrayList<String>()
    if (SaleBill.hasBreakdown(l)) {
        bits.add("Priced from the rate")
        l.metalType?.takeIf { it.isNotEmpty() }?.let { bits.add(it) }
        l.karat?.let { bits.add("${s.jsNumber(it)}k") }
        val w = l.weightG ?: 0.0
        bits.add("${s.jsNumber(w)} g" + if (l.weightWasTola == true) " (${BigDecimal(w / s.tolaG).setScale(2, RoundingMode.HALF_EVEN).toPlainString()} tola written)" else "")
        if ((l.stoneWeightG ?: 0.0) > 0) bits.add("less ${s.jsNumber(l.stoneWeightG ?: 0.0)} g stone")
        SaleBill.wastagePercentOf(l)?.let { wp -> bits.add("wastage ${s.jsNumber(wp)}%" + if ((l.wastageG ?: 0.0) > 0) " (${s.jsNumber(l.wastageG ?: 0.0)} g)" else "") }
        val rate = if ((l.ratePerGram ?: 0.0) > 0) (l.ratePerGram ?: 0.0) else (billRate ?: 0.0)
        if (rate > 0) bits.add("at ${s.money(rate)}/g")
        if ((l.stoneCharges ?: 0.0) > 0) bits.add("stones ${s.money(l.stoneCharges ?: 0.0)}")
        if ((l.makingCharges ?: 0.0) > 0) bits.add("making ${s.money(l.makingCharges ?: 0.0)}")
    } else {
        bits.add("As written on the bill: no breakdown, the figure is used as it stands")
    }
    val written = SaleBill.writtenTotal(l)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TwoLine(
            title = l.description?.takeIf { it.isNotEmpty() } ?: "Unnamed line",
            subtitle = bits.joinToString(" · "),
            trailing = if (written > 0) Money.pkr(written) else null,
        )
        l.note?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun FootSection(r: SaleBillReading, draft: SaleDraft, settings: erp.core.models.Settings?, customers: List<erp.core.models.Customer>) {
    val book = LocalBook.current
    val a = r.answer
    val written = SaleBill.writtenFigure(a)
    val held = SaleBill.rates(r.kept, a.ratePerGram, House.metal)
    val check = filledCheck(r, draft, settings, customers, written) { id -> book.customers.item(id) }
    FormSection("Foot of the bill", footer = { Text(footNote(a, held)) }) {
        if ((a.discount ?: 0.0) > 0) ValueRow("Discount") { Text(Money.pkr(a.discount ?: 0.0)) }
        if ((a.grandTotal ?: 0.0) > 0) ValueRow("Total") { Text(Money.pkr(a.grandTotal ?: 0.0)) }
        if ((a.amountPaid ?: 0.0) > 0) ValueRow("Paid") { Text(Money.pkr(a.amountPaid ?: 0.0)) }
        a.date?.takeIf { it.isNotEmpty() }?.let { day -> ValueRow("Dated") { Text(day) } }
        held.keys.sorted().forEach { k ->
            ValueRow("Rate ${k.replace("gold", "").uppercase()}") { Text("${Money.grouped(held[k] ?: 0.0)} / g") }
        }
        if (check != null) {
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                Icon(
                    if (check.second) Symbols.CheckCircle else Symbols.Warning, contentDescription = null,
                    tint = if (check.second) MaterialTheme.colorScheme.onSurfaceVariant else Tone.owed.color(),
                )
                Text(check.first, color = if (check.second) MaterialTheme.colorScheme.onSurfaceVariant else Tone.owed.color())
            }
        }
    }
}

private fun footNote(a: SaleBillAnswer, held: Map<String, Double>): String {
    val parts = ArrayList<String>()
    if (held.isNotEmpty()) parts.add("The bill's rate goes in its box for this sale only, so its lines come to the paper's figures; it is never kept as today's rate.")
    if ((a.discount ?: 0.0) > 0) parts.add("Its discount goes in unless one is typed already.")
    if ((a.amountPaid ?: 0.0) > 0) parts.add("What it says was paid goes in as cash, unless a payment is typed already: change it if it was paid another way.")
    parts.add("Check the lines against the bill before saving.")
    return parts.joinToString(" ")
}

/**
 * The sale as it would be once filled, against the figure at the foot of the bill (sale-page.tsx's "This does not
 * match the bill"): a line missed on a crowded slip shows here before anything goes on the sale. Words and whether it matches.
 */
private fun filledCheck(
    r: SaleBillReading,
    draft: SaleDraft,
    settings: erp.core.models.Settings?,
    customers: List<erp.core.models.Customer>,
    written: Double?,
    customerOf: (String) -> erp.core.models.Customer?,
): Pair<String, Boolean>? {
    if (written == null || r.kept.isEmpty()) return null
    val preview = draft.copy()
    preview.fillFromBill(r, r.customer?.pinned?.let { customerOf(it.id) }, House.metal)
    val f = SaleFigures(preview, settings, customers, EntryHouse.margin)
    if (!f.hasEstimate) return null
    if (!SaleBill.differs(written, f.total)) return "Filled in, the sale comes to ${Money.pkr(f.total)}, as the bill says." to true
    val gap = f.total - written
    return "This does not match the bill: it says ${Money.pkr(written)}, the sale would come to ${Money.pkr(f.total)} (${if (gap > 0) "+" else "−"}${Money.grouped(kotlin.math.abs(gap))}). Check for a line that was missed." to false
}
