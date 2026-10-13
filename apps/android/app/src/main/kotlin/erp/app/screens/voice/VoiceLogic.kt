package erp.app.screens.voice

import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderScanAnswer
import erp.core.entry.NewOrderSlip
import erp.core.entry.SaleBillAnswer
import erp.core.entry.SaleBillReading
import erp.core.entry.SaleDraft
import erp.core.entry.fillFromBill
import erp.core.entry.fillFromSlip
import erp.core.models.Customer
import erp.core.models.Product
import erp.core.models.Settings
import kotlin.math.log10

/** One planned step of what was said (`NativeVoiceCard`): written in words, with the operations to send once confirmed. */
class VoiceOperation(val op: String, val fields: Map<String, Any?>)

class VoiceCard(raw: Map<String, Any?>) {
    val title: String = raw["title"] as? String ?: "Review"
    val summary: String = raw["summary"] as? String ?: ""
    val problem: String? = raw["problem"] as? String
    val operations: List<VoiceOperation> = (raw["operations"] as? List<*>).orEmpty().mapNotNull { o ->
        val m = o as? Map<*, *> ?: return@mapNotNull null
        val op = m["op"] as? String ?: return@mapNotNull null
        @Suppress("UNCHECKED_CAST")
        val fields = m["fields"] as? Map<String, Any?> ?: return@mapNotNull null
        VoiceOperation(op, fields)
    }
    val href: String? = raw["href"] as? String

    @Suppress("UNCHECKED_CAST")
    val handoff: Map<String, Any?>? = raw["handoff"] as? Map<String, Any?>
}

/** The ERP's reading of a request (`NativeVoicePlan`): an answer, steps to confirm, and the page to open. */
class VoicePlan(raw: Map<String, Any?>, var reviewedWords: String) {
    val cards: List<VoiceCard> = (raw["cards"] as? List<*>).orEmpty().mapNotNull { (it as? Map<*, *>)?.let { m -> @Suppress("UNCHECKED_CAST") VoiceCard(m as Map<String, Any?>) } }
    val answer: String? = raw["answer"] as? String
    val href: String? = raw["href"] as? String
    val operations: List<VoiceOperation> get() = cards.flatMap { it.operations }

    /** Every step is clear: no problem is raised and nothing needs filling in by hand first. */
    val ready: Boolean get() = cards.all { it.problem == null && it.handoff == null }
}

object VoiceLogic {
    /** The longest a recording runs (the server takes up to a minute). */
    const val MAX_SECONDS = 60

    /** `Recording stops after one minute.` */
    const val MAX_MILLIS = MAX_SECONDS * 1000

    /** A recording smaller than this is nothing (the Swift's `data.count > 1000`). */
    const val MIN_BYTES = 1000

    /** Live words in the two languages the ERP's voice offers (the iPhone's picker). */
    val languages = listOf("en-PK" to "English", "ur-PK" to "Urdu")

    /** A request body for the route: `{audio: base64}` or `{text}`. */
    fun audioBody(base64: String): Map<String, Any?> = mapOf("audio" to base64)
    fun textBody(words: String): Map<String, Any?> = mapOf("text" to words.trim())

    /**
     * What to send once recording stops. The iPhone sends the recording; here, if the recorder came out empty or silent
     * (Android's recogniser and the recorder share the microphone, and the recogniser can win it) but live words were
     * heard, those words go as text instead of failing. Null when there is nothing at all.
     */
    fun input(audio: ByteArray?, peakAmplitude: Int, liveWords: String): Map<String, Any?>? {
        val heard = liveWords.trim()
        val usable = audio != null && audio.size > MIN_BYTES && (peakAmplitude > SILENT || heard.isEmpty())
        return when {
            usable -> audioBody(java.util.Base64.getEncoder().encodeToString(audio))
            heard.isNotEmpty() -> textBody(heard)
            else -> null
        }
    }

    /** The recorder's peak amplitude (0 to 32767) below which a recording is taken to be silence. */
    const val SILENT = 250

    /** The meter's 0...1 from an amplitude, as the iPhone's `(averagePower + 55) / 55` on decibels. */
    fun level(amplitude: Int): Float {
        if (amplitude <= 0) return 0f
        val db = 20.0 * log10(amplitude / 32767.0)
        return ((db + 55.0) / 55.0).coerceIn(0.0, 1.0).toFloat()
    }

    /** A card's heading as the iPhone shows it (`.capitalized`: each word's first letter up, the rest down). */
    fun heading(title: String): String =
        title.split(' ').joinToString(" ") { w -> w.lowercase().replaceFirstChar { it.uppercase() } }

    /** The words the person typed or the server heard, ready to review. */
    fun canRead(words: String): Boolean = words.trim().isNotEmpty()
}

/**
 * A card that needs the form (`NativeVoiceHandoff`): the New order or New sale drafted from what was said and kept on
 * the phone, for the form to open on. Pure on its inputs; the caller keeps the draft.
 */
object VoiceHandoff {
    class Failure(message: String) : Exception(message)

    fun order(
        payload: Map<String, Any?>,
        customers: (String) -> Customer?,
        settings: Settings?,
        person: String?,
        fallbackMetal: String,
        existing: NewOrderDraft?,
    ): NewOrderDraft {
        val customerId = pinnedId(payload["customer"])
        val karigarId = pinnedId(payload["karigar"])
        val scan = NewOrderScanAnswer.from(payload) ?: throw Failure("Open the native form and enter the details shown above.")
        val draft = existing ?: NewOrderDraft()
        val firstPiece = draft.pieces.size
        draft.fillFromSlip(
            scan = scan, customer = customers(customerId), heardCustomer = null, karigarId = karigarId,
            photos = emptyList(), fallbackMetal = fallbackMetal, settings = settings,
        )
        for ((i, piece) in scan.items.withIndex()) {
            val price = piece.lineTotal
            if (price != null && price > 0 && firstPiece + i < draft.pieces.size) {
                draft.pieces[firstPiece + i].manual = true
                draft.pieces[firstPiece + i].manualPrice = NewOrderSlip.jsNumber(price)
            }
        }
        (payload["advanceMethod"] as? String)?.let { draft.advanceMethod = it }
        if (draft.takenBy.isEmpty()) draft.takenBy = person ?: ""
        return draft
    }

    fun sale(
        payload: Map<String, Any?>,
        customers: List<Customer>,
        customerById: (String) -> Customer?,
        products: List<Product>,
        person: String?,
        fallbackMetal: String,
        existing: SaleDraft?,
    ): SaleDraft {
        val raw = LinkedHashMap(payload)
        raw["amountPaid"] = payload["paid"]
        val answer = SaleBillAnswer.from(raw) ?: throw Failure("Open the native form and enter the details shown above.")
        val reading = SaleBillReading.resolve(answer, customers)
        val draft = existing ?: SaleDraft()
        draft.fillFromBill(reading, (payload["customerId"] as? String)?.let(customerById), fallbackMetal)
        (payload["method"] as? String)?.let { m -> if (draft.payments.isNotEmpty()) draft.payments[0].method = m }
        if (draft.takenBy.isEmpty()) draft.takenBy = person ?: ""
        for (sku in (payload["skus"] as? List<*>).orEmpty().filterIsInstance<String>()) {
            products.firstOrNull { it.sku == sku }?.let { draft.add(it) }
        }
        return draft
    }

    /** What a handoff names to build, or null: only "order" and "sale" have a native form. */
    fun kind(handoff: Map<String, Any?>?): String? = (handoff?.get("kind") as? String)?.takeIf { it == "order" || it == "sale" }

    @Suppress("UNCHECKED_CAST")
    fun payload(handoff: Map<String, Any?>?): Map<String, Any?> = handoff?.get("payload") as? Map<String, Any?> ?: emptyMap()

    private fun pinnedId(v: Any?): String = (((v as? Map<*, *>)?.get("pinned")) as? Map<*, *>)?.get("id") as? String ?: ""
}
