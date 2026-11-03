package erp.app.screens.voice

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import erp.app.screens.workshop.WorkshopPieceAsk
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import erp.core.models.Order
import erp.core.models.Product
import erp.core.models.Repair
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The record a screen has open, as voice is told it (the iPhone's `VoiceFocus`, owner 2026-11-02: "smart enough to know what
 * im referring to and change small details from there"). Sent with every sentence as `context` (/api/voice/native,
 * src/lib/voice/context.ts): the server reads the record from its own book by kind and id, so the label and the pieces are
 * only a fallback for a record made a moment ago. Field names are the iPhone's, key for key.
 */
data class VoiceFocus(
    /** order, invoice, customer, karigar, product, repair, job, expense (context.ts CONTEXT_KINDS). */
    val kind: String,
    /** The record's id (a stock piece's SKU). */
    val id: String,
    /** "Order ORD-0123 · Ayesha · 2 pieces". */
    val label: String,
    /** An order's or invoice's pieces, in order: what "the second piece" is. */
    val pieces: List<String> = emptyList(),
    /** The one piece open (the Workshop's Details), from 0: what "it" is. */
    val piece: Int? = null,
) {
    val payload: Map<String, Any?>
        get() = buildMap {
            put("kind", kind)
            put("id", id)
            put("label", label)
            put("pieces", pieces.mapIndexed { i, name -> mapOf("index" to i, "name" to name) })
            if (piece != null) put("piece", piece)
        }

    companion object {
        private fun count(n: Int) = if (n == 1) "1 piece" else "$n pieces"

        fun order(o: Order) = VoiceFocus(
            "order", o.id, "Order ${o.id} · ${o.customerName ?: "Walk-in"} · ${count(o.items.size)}", o.items.map { it.description },
        )

        fun invoice(i: Invoice) = VoiceFocus(
            "invoice", i.id, "Invoice ${i.id} · ${i.customerName} · ${count(i.items.size)}", i.items.map { it.name },
        )

        fun customer(c: Customer) = VoiceFocus("customer", c.id, "Customer ${c.name}")

        fun karigar(k: Karigar) = VoiceFocus("karigar", k.id, "Karigar ${k.name}")

        fun product(p: Product) = VoiceFocus("product", p.sku, "Piece ${p.sku} · ${p.name}")

        fun repair(r: Repair) = VoiceFocus("repair", r.id, "Repair ${r.id} · ${r.customerName}", r.pieces.map { it.item })

        fun job(j: KarigarJob) = VoiceFocus("job", j.id, "Workshop job · ${j.description} · ${j.karigarName}")

        /** The order or invoice a Workshop piece is on, and which piece, as voice is told it. */
        fun piece(ask: WorkshopPieceAsk): VoiceFocus = when (val t = ask.target) {
            is WorkshopPieceAsk.Target.Order -> VoiceFocus("order", t.id, "Order ${t.id}, piece ${t.index + 1}", piece = t.index)
            is WorkshopPieceAsk.Target.Invoice -> VoiceFocus("invoice", t.id, "Invoice ${t.id}, piece ${t.index + 1}", piece = t.index)
        }
    }
}

/**
 * Which records are open, the newest last (the iPhone's `VoiceContext`). A stack, not one slot: a page opened over another
 * is its own Activity and shows before the one under it goes, and a sheet closing does not tell the page under it that it
 * is back; each screen takes out only its own entry, so what is left on top is what is in front. Process-wide, so the
 * overlay (shown by every Activity) reads the same stack whichever page is up.
 */
object VoiceContext {
    private class Entry(val owner: Any, val focus: VoiceFocus)

    private var open: List<Entry> = emptyList()
    private val _current = MutableStateFlow<VoiceFocus?>(null)

    /** The record in front: what "it", "her" and "the second piece" mean. */
    val focus: VoiceFocus? get() = _current.value

    /** The same, to watch (the overlay's "Listening · about …" line). */
    val current: StateFlow<VoiceFocus?> = _current.asStateFlow()

    @Synchronized
    fun set(focus: VoiceFocus?, owner: Any) {
        open = open.filter { it.owner !== owner } + listOfNotNull(focus?.let { Entry(owner, it) })
        _current.value = open.lastOrNull()?.focus
    }

    fun clear(owner: Any) = set(null, owner)

    /** A business's records: emptied on a switch (Businesses.resetPerBusinessState). */
    @Synchronized
    fun reset() {
        open = emptyList()
        _current.value = null
    }
}

/**
 * This screen shows [focus] (null while it loads, or when the record is gone): voice is told so while it is open
 * (the iPhone's `.voiceFocus`). Put it in the screen's composable body.
 */
@Composable
fun VoiceFocusEffect(focus: VoiceFocus?) {
    val owner = remember { Any() }
    DisposableEffect(focus) {
        VoiceContext.set(focus, owner)
        onDispose { VoiceContext.clear(owner) }
    }
}
