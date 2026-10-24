package erp.app.screens.neworder

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import erp.app.config.Prefs
import erp.app.ui.EntryStep
import erp.app.ui.EntryStepState
import erp.core.entry.NewOrderDay
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderDraftStore
import erp.core.entry.NewOrderFormat
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderPieceDraft
import erp.core.entry.NewOrderWords
import erp.core.logic.RateKey
import erp.core.logic.isCredit
import erp.core.logic.rates
import erp.core.logic.describeMetal
import erp.core.logic.goldCostPerGram
import erp.core.logic.percentLabel
import erp.core.logic.MarginSettings
import erp.core.logic.Money
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.logic.Margin
import erp.core.models.Order
import erp.core.models.Settings
import java.text.BreakIterator
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID
import kotlin.math.abs
import kotlin.math.floor

// The pure part of the order form's screens: what the steps say, how a piece reads in a list, which rate boxes show,
// the addresses on file, the picker's days, and the route paths. No Compose in the rules, so they have JVM tests.
// (NewOrder.swift, NewOrderSections.swift, NewOrderPieceEditor.swift, NewOrderRoutes.swift.)

/**
 * The order in progress as a screen holds it. The core's draft is a mutable object, as the Swift struct is a value:
 * every change goes through [edit] (which tells the screens it moved), and every reader asks [read], which is what
 * subscribes it. Kept stable so a section that is given the holder is redrawn only when the draft changes.
 */
@Stable
class DraftHolder(initial: NewOrderDraft) {
    private var current by mutableStateOf(initial)
    private var revision by mutableIntStateOf(0)

    /** The draft as it stands; reading it inside a composable is what redraws that composable on the next change. */
    fun read(): NewOrderDraft {
        revision.let { }
        return current
    }

    /** The draft without subscribing (a save, a debounced keep). */
    val now: NewOrderDraft get() = current

    /** Changes the draft in place and tells every reader. */
    fun edit(block: NewOrderDraft.() -> Unit) {
        current.block()
        revision += 1
    }

    /** One piece, by id. */
    fun editPiece(id: UUID, block: NewOrderPieceDraft.() -> Unit) {
        edit { pieces.firstOrNull { it.id == id }?.block() }
    }

    /** A whole new draft (start over, an order that began elsewhere). */
    fun replace(next: NewOrderDraft) {
        current = next
        revision += 1
    }

    /** Moves on with every change: a debounce keys on it. */
    val stamp: Int get() = revision
}

/** The order kept on this phone (`NewOrderDraftStore` on the iPhone): the core encodes it, Prefs holds the text. */
object NewOrderPhoneStore {
    fun load(): NewOrderDraft? = Prefs.string(NewOrderDraftStore.key)?.let { NewOrderDraftStore.decode(it) }

    fun save(draft: NewOrderDraft) {
        val text = NewOrderDraftStore.encode(draft)
        Prefs.putString(NewOrderDraftStore.key, text)
    }

    fun clear() = Prefs.remove(NewOrderDraftStore.key)
}

object NewOrderLogic {
    // MARK: Steps

    /** `String.count` on a trimmed text: Swift counts what a person sees as one character. */
    fun characters(s: String): Int {
        if (s.isEmpty()) return 0
        val it = BreakIterator.getCharacterInstance()
        it.setText(s)
        var n = 0
        while (it.next() != BreakIterator.DONE) n++
        return n
    }

    /** Swift's `.whitespaces`: spaces and tabs only. */
    private fun trimSpaces(s: String): String = s.trim(' ', '\t', ' ')

    /**
     * Where each step stands, read from the draft only: a tick when it is complete, an amber dot when what is typed
     * would stop the save (the same rules as `NewOrderMath.problem`).
     */
    fun stepStates(d: NewOrderDraft): Map<EntryStep, EntryStepState> {
        val out = LinkedHashMap<EntryStep, EntryStepState>()
        if (trimSpaces(d.customerName).isNotEmpty()) out[EntryStep.customer] = EntryStepState.done
        if (d.pieces.isNotEmpty()) {
            val complete = d.pieces.all { p ->
                characters(trimSpaces(p.description)) >= 3 &&
                    (if (p.manual) NewOrderFormat.num(p.manualPrice) > 0 else NewOrderFormat.num(p.weight) > 0)
            }
            out[EntryStep.pieces] = if (complete) EntryStepState.done else EntryStepState.attention
        }
        // What would stop the save: a negative, or a figure that is not a number (NewOrderMath.problem).
        if (NewOrderFormat.below0(d.discount) || NewOrderFormat.below0(d.advance) || NewOrderFormat.unreadable(d.discount) || NewOrderFormat.unreadable(d.advance)) {
            out[EntryStep.payment] = EntryStepState.attention
        } else if (NewOrderFormat.num(d.advance) > 0) {
            out[EntryStep.payment] = EntryStepState.done
        }
        return out
    }

    /** "Gold (21K) · 5.2 g · 10" (components/order/order-form.tsx `spec`). */
    fun pieceSpec(p: NewOrderPieceDraft): String {
        val parts = ArrayList<String>()
        val metal = describeMetal(p.metal, p.karat)
        if (metal.isNotEmpty()) parts.add(metal)
        val weight = NewOrderFormat.num(p.weight)
        if (!p.manual && weight > 0) parts.add(NewOrderFormat.trimmed(weight) + " g")
        val size = NewOrderFormat.trim(p.size)
        if (size.isNotEmpty()) parts.add(size)
        return parts.joinToString(" · ")
    }

    /** What the pinned summary calls the balance: credit once more has been taken than the pieces come to. */
    enum class DueTone { credit, owed, settled }

    fun dueTone(balance: Double): DueTone = when {
        balance <= -1 -> DueTone.credit
        balance >= 1 -> DueTone.owed
        else -> DueTone.settled
    }

    fun dueLabel(balance: Double): String = if (isCredit(balance)) "Credit to customer" else "Due"

    /** The at-a-glance rows of the review pane (TransactionReview). */
    fun reviewFigures(t: NewOrderMath.Totals): List<Pair<String, String>> = listOf(
        "Estimate" to Money.pkr(t.subtotal),
        "Discount" to Money.pkr(t.discount),
        "Advance" to Money.pkr(t.advance),
        "Exchange" to Money.pkr(t.exchange),
        (if (t.balance < 0) "Credit to customer" else "Balance due") to Money.pkr(abs(t.balance)),
    )

    fun pieceLabel(index: Int, description: String): String =
        "${index + 1}. ${description.ifEmpty { "Untitled piece" }}"

    // MARK: Promised

    /** Seven, ten and fourteen days are what the counter actually says to a customer. */
    val quickDays = listOf(7, 10, 14)

    /** Inside a bench week, or already behind: said at the moment of choosing. */
    fun urgentWords(d: Int): String = when {
        d < 0 -> "Urgent · past"
        d == 0 -> "Urgent · today"
        else -> "Urgent · ${d}d"
    }

    /** The date picker works in UTC midnights; a promised day is a bare "yyyy-MM-dd". */
    fun dayToPickerMillis(day: String): Long? {
        if (NewOrderDay.date(day) == null) return null
        return runCatching { LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
    }

    fun pickerMillisToDay(millis: Long): String = LocalDate.ofInstant(Instant.ofEpochMilli(millis), ZoneOffset.UTC).toString()

    // MARK: Rates

    class RateBox(val key: RateKey, val label: String) {
        val id: String get() = key.name
    }

    /**
     * Only the rates this order uses, as the web shows them: a box that is on screen looks like a box that must be
     * checked. Add an 18k piece and the 18k rate appears; remove it and it goes.
     */
    fun rateBoxes(d: NewOrderDraft): List<RateBox> {
        val goldKarats = d.pieces.filter { it.metal == "gold" }.map { it.karat }.toSet()
        val palladiumKarats = d.pieces.filter { it.metal == "palladium" }.map { it.karat }.toSet()
        val out = ArrayList<RateBox>()
        val gold = listOf(
            RateKey.goldRatePerGram24k to "24k", RateKey.goldRatePerGram22k to "22k",
            RateKey.goldRatePerGram21k to "21k", RateKey.goldRatePerGram18k to "18k",
        )
        for ((key, karat) in gold) if (goldKarats.contains(karat)) out.add(RateBox(key, "Gold $karat"))
        if (hasPalladium(d)) {
            val pd = listOf(RateKey.palladiumRatePerGram18k to "18k", RateKey.palladiumRatePerGram12k to "12k")
            for ((key, karat) in pd) if (palladiumKarats.isEmpty() || palladiumKarats.contains(karat)) out.add(RateBox(key, "Palladium $karat"))
        }
        return out
    }

    fun hasPalladium(d: NewOrderDraft): Boolean = d.pieces.any { it.metal == "palladium" }
    fun hasSilver(d: NewOrderDraft): Boolean = d.pieces.any { it.metal == "silver" }

    /** Typed rates that are no longer today's. */
    fun ratesDiffer(d: NewOrderDraft, settings: Settings?): Boolean {
        if (settings == null) return false
        val today = settings.rates
        return rateBoxes(d).any { box ->
            val typed = NewOrderFormat.num(d.rates[box.key.name] ?: "")
            abs(typed - (today[box.key] ?: 0.0)) >= 0.005
        }
    }

    fun ratesFooter(palladium: Boolean, silver: Boolean): String {
        var s = "Applies to every piece on this order, and is kept on it. A rate typed here is used for this order only: today's rates are changed with the rate chip."
        if (palladium) s += " A palladium rate left at zero falls back to the shop's flat palladium rate."
        if (silver) s += " Silver is priced at the shop's rate, which already holds its making and wastage."
        return s
    }

    // MARK: Delivery

    /**
     * The customer's saved address, then every address their orders and invoices were delivered to, once each
     * (delivery-fields.tsx `knownAddresses`): offered, never filled in by itself.
     */
    fun knownAddresses(customerId: String, customers: List<Customer>, orders: List<Order>, invoices: List<Invoice>): List<String> {
        if (customerId.isEmpty()) return emptyList()
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        fun take(raw: String?) {
            val a = NewOrderFormat.trim(raw ?: "")
            if (a.isEmpty() || !seen.add(a.lowercase())) return
            out.add(a)
        }
        take(customers.firstOrNull { it.id == customerId }?.address)
        for (o in orders) if (o.customerId == customerId) take(o.delivery?.address)
        for (i in invoices) if (i.customerId == customerId) take(i.delivery?.address)
        return out
    }

    // MARK: The shop's margin

    /** Half away from zero, as Swift's `.rounded()`. */
    fun swiftRound(x: Double): Double = if (x < 0) -floor(-x + 0.5) else floor(x + 0.5)

    fun assumedPercent(m: MarginSettings): Int = swiftRound(m.assumedMargin * 100).toInt()

    /** The 24k rate sheet's price for a tola, whole rupees. */
    fun sheetTola(settings: Settings?): Int = swiftRound((settings?.goldRatePerGram24k ?: 0.0) * NewOrderWords.gramsPerTola).toInt()

    fun rateWords(perGram: Double, m: MarginSettings): String {
        if (perGram > 0) {
            val cost = goldCostPerGram(perGram, m.rattiLess ?: 0.0)
            return "${Money.pkr(perGram)} a gram · our cost ${Money.pkr(cost)} a gram of jewellery (24k less ${NewOrderFormat.trimmed(m.rattiLess ?: 0.0, 1)} ratti)."
        }
        return "Without it the margin is taken as ${assumedPercent(m)}%."
    }

    /** What is read when the figure is tapped (shop-margin.tsx MarginFigure). */
    fun marginWords(m: Margin?, settings: MarginSettings): String {
        if (m == null) return "—"
        if (m.assumed) return "≈ ${percentLabel(m)} (no 24k rate given: assumed)"
        var s = "${percentLabel(m)} · ${Money.pkr(m.profit)}"
        if (m.costedShare < 0.999) {
            val rest = swiftRound((1 - m.costedShare) * 100).toInt()
            s += " · $rest% of it at ${assumedPercent(settings)}% (no weight)"
        }
        return s
    }

    // MARK: Routes

    /** "/orders/<id>/edit" → the id. */
    fun editId(path: String): String? = between(path, "/edit")

    /** "/orders/<id>/slip" → the id. */
    fun slipId(path: String): String? = between(path, "/slip")

    private fun between(path: String, tail: String): String? {
        val bare = path.substringBefore('?')
        if (!bare.startsWith("/orders/") || !bare.endsWith(tail)) return null
        if (bare.length < "/orders/".length + tail.length) return null
        val id = bare.substring("/orders/".length, bare.length - tail.length)
        if (id.isEmpty() || id.contains('/')) return null
        return erp.app.nav.ScreenRoute.percentDecode(id)
    }

    /** A path's `scan=` asking for one of the AI readers ("bill", "parchi"). */
    fun asks(path: String, scan: String): Boolean {
        if (!path.contains('?')) return false
        val query = path.substringAfter('?').substringBefore('#')
        return query.split('&').any { it == "scan=$scan" }
    }

    // MARK: Messages

    const val SAVE_BLOCKED_TITLE = "The order can't be saved yet"

    /** A refusal the ERP gave for an order it has already seen (a second tap, a retry): it is made, not lost. */
    fun alreadySent(status: Int, message: String): Boolean = status == 409 && message.startsWith("This was already sent")

    fun noAnswer(message: String, isNew: Boolean): String =
        if (isNew) "$message\n\nIf the connection dropped, the order may have been saved. Check Orders before saving it again."
        else "$message\n\nIf the connection dropped, the changes may have been saved. Check the order before saving again."
}
