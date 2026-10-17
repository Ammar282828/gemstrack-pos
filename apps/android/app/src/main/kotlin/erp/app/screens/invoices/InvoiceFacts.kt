package erp.app.screens.invoices

import erp.app.ui.AppClock
import erp.app.data.ErpApi
import erp.app.ui.Tone
import erp.app.ui.toWhatsAppNumber
import erp.core.ERPDate
import erp.core.logic.BalanceState
import erp.core.logic.balanceLine
import erp.core.logic.canHoldCredit
import erp.core.logic.categorySingular
import erp.core.logic.isWalkInName
import erp.core.logic.pakistanE164
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.app.ui.PaymentText
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.temporal.ChronoField
import java.util.Locale
import erp.core.logic.Money

/**
 * What the Invoices list and the invoice page say the same way (InvoiceSupport.swift `InvoiceFacts`): who a sale
 * was for, where an invoice lives, how its balance is coloured, the customer's link, and how a payment is taken.
 * Pure: no screen, no network, so the words and the payloads are tested on the JVM.
 */
object InvoiceFacts {
    /**
     * The name on the bill, or "Walk-in" for a sale to nobody in particular (lib/walk-in.ts: no name, or the
     * placeholder, however it is spelled; "Walk-in Customer - 0300…" is a person).
     */
    fun customerName(inv: Invoice, walkIn: String = "Walk-in"): String {
        val name = inv.customerName.trim()
        return if (name.isEmpty() || isWalkInName(name)) walkIn else name
    }

    // CharacterSet.urlPathAllowed less "/?#%": letters, digits, the unreserved marks, the sub-delims, ":" and "@".
    private const val PATH_SAFE = "-._~!$&'()*+,;=:@"

    /** One part of a path: an id with a "/" or "?" in it must not split the address. */
    fun encode(part: String): String = percent(part) { it.isLetterOrDigit() && it.code < 128 || it in PATH_SAFE }

    // encodeURIComponent leaves these alone.
    private const val COMPONENT_SAFE = "-_.!~*'()"

    private fun component(s: String): String = percent(s) { it.isLetterOrDigit() && it.code < 128 || it in COMPONENT_SAFE }

    private fun percent(s: String, keep: (Char) -> Boolean): String {
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c.code < 128 && keep(c)) out.append(c) else out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /**
     * "/invoices/INV-000123": the invoice page. `web` asks for the ERP's own page (a native screen's "Open in the
     * ERP": print, send, refund, delete). `doing` is what that page does as it opens, once (invoice-viewer.tsx
     * `?do=`, the voice assistant's): "print" draws the PDF Print saves and hands it to the phone's share sheet;
     * "share" sends it on WhatsApp.
     */
    fun path(id: String, web: Boolean = false, doing: String? = null): String {
        val query = buildList {
            if (web) add("web=1")
            if (doing != null) add("do=$doing")
        }
        return "/invoices/" + encode(id) + (if (query.isEmpty()) "" else "?" + query.joinToString("&"))
    }

    /** The sale form on an invoice (components/sale/sale-page.tsx), which has no native screen. */
    fun editPath(id: String): String = "/invoices/" + encode(id) + "/edit"

    /**
     * Still owing after this many days reads red, not orange. A way to see the old debts at a glance (the
     * Awaiting payment section is oldest first for the same reason), not a rule.
     */
    const val STALE_DAYS = 30

    /** The tone of an invoice's balance: owed amber, red once it is old, credit teal, settled green, a refund quiet. */
    fun balanceTone(inv: Invoice, now: Instant = AppClock.now()): Tone {
        if (inv.status == InvoiceStatus.refunded) return Tone.quiet
        return when (balanceLine(inv.balanceDue).state) {
            BalanceState.due -> {
                val made = ERPDate.parse(inv.createdAt) ?: return Tone.owed
                if ((now.epochSecond - made.epochSecond) + (now.nano - made.nano) / 1e9 > STALE_DAYS * 86_400.0) Tone.late else Tone.owed
            }
            BalanceState.credit -> Tone.credit
            BalanceState.paid -> Tone.settled
        }
    }

    /** The category in words ("Ring" for cat001), else the id itself (`categorySingular(id) || id`). */
    fun categoryWords(id: String?): String? {
        if (id.isNullOrEmpty()) return null
        return categorySingular(id) ?: id
    }

    /**
     * What was sold, as the counter remembers a sale: the first piece's name, and "+2 more" for the rest.
     * A line with no name says its category, else its stock number.
     */
    fun whatSold(inv: Invoice): String? {
        val first = inv.items.firstOrNull() ?: return null
        var name = first.name.trim()
        if (name.isEmpty()) name = categoryWords(first.itemCategory) ?: first.sku
        if (name.isEmpty()) name = "1 piece"
        val more = inv.items.size - 1
        return if (more > 0) "$name +$more more" else name
    }

    private val clock: DateTimeFormatter = DateTimeFormatterBuilder()
        .appendPattern("h:mm ")
        .appendText(ChronoField.AMPM_OF_DAY, mapOf(0L to "am", 1L to "pm"))
        .toFormatter(Locale.UK)
        .withZone(ERPDate.karachi)

    /** "3:45 pm", Karachi's: a row under its day's heading needs only the time. */
    fun time(iso: String): String = ERPDate.parse(iso)?.let { clock.format(it) } ?: ""

    /** Who may take a payment (/api/app/write recordPayment): owners and staff. */
    fun mayTakePayments(role: String): Boolean = role == "owner" || role == "staff"

    /**
     * The ERP page's refusal for a payment over the balance. The server writes the payment (lib/writes/
     * invoice-payment.ts) but does not check who may hold credit, so the ERP page's rule is kept here: money over
     * the balance is a named customer's credit; from nobody in particular it is change to hand back, so it is
     * refused (invoice-credit.ts). Null when it may go.
     */
    fun paymentRefusal(inv: Invoice, amount: Double): String? {
        val due = maxOf(0.0, inv.balanceDue)
        // Over by a whole rupee, as record-payment-dialog.tsx counts it (Math.round(amount - balance) > 0).
        if (erp.core.logic.rupees(amount - due) > 0 && !canHoldCredit(inv.customerId)) {
            return "More than the balance of ${Money.pkr(due)}. Credit needs a customer: name who this invoice is for first."
        }
        return null
    }

    /** The `recordPayment` write's fields, key for key as the iPhone sends them. */
    fun paymentFields(inv: Invoice, amount: Double, method: String, reference: String): Map<String, Any?> {
        val fields = linkedMapOf<String, Any?>("invoiceId" to inv.id, "amount" to amount, "method" to method)
        val ref = reference.trim()
        if (method != "Cash" && ref.isNotEmpty()) fields["reference"] = ref
        return fields
    }

    /** Take a payment, as the invoice page and the list's "Take payment" do. */
    suspend fun record(inv: Invoice, amount: Double, method: String, reference: String): Map<String, Any?> {
        paymentRefusal(inv, amount)?.let { throw ErpApi.Failure(400, it) }
        return ErpApi.shared.write("recordPayment", paymentFields(inv, amount, method, reference))
    }

    /**
     * Settle (record-payment-dialog.tsx): the payment and the remainder off the bill's discount in one write
     * (`settleInvoicePayment`, lib/writes/settle.ts), so the balance is 0 without a payment never made and never a
     * payment taken without its discount. Owners only, as the discount is (/api/app/write).
     */
    suspend fun settle(inv: Invoice, amount: Double, method: String, reference: String, remainder: Double) {
        val fields = linkedMapOf<String, Any?>("invoiceId" to inv.id, "amount" to amount, "extra" to remainder, "method" to method)
        val ref = reference.trim()
        if (method != "Cash" && ref.isNotEmpty()) fields["reference"] = ref
        ErpApi.shared.write("settleInvoicePayment", fields)
    }

    // MARK: The customer's link

    /**
     * The page a customer is sent (lib/share-token.ts `invoiceShareUrl`): `/view-invoice/<id>?t=<key>`. That page
     * answers only to the invoice's own key, so an invoice from before keys existed has no link here: the ERP page
     * makes its key as it sends (Send on WhatsApp). `origin` is the house's server address.
     */
    fun shareUrl(inv: Invoice, origin: String): String? {
        val key = inv.shareToken
        if (key.isNullOrEmpty()) return null
        return "${origin.trimEnd('/')}/view-invoice/${component(inv.id)}?t=${component(key)}"
    }

    // MARK: What goes out with the link (lib/invoice-share.ts, the viewer's estimateMessage)

    /** Characters no phone or computer allows in a file's name, and runs of spaces (invoice-share.ts `clean`). */
    private fun clean(s: String): String {
        val blocked = "\\/:*?\"<>|"
        val spaced = s.map { c -> if (c in blocked || c.code < 0x20) ' ' else c }.joinToString("")
        return spaced.split(Regex("""\s+""")).filter { it.isNotEmpty() }.joinToString(" ")
    }

    private val karachiDay: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.UK).withZone(ERPDate.karachi)

    /**
     * The subject of a share. Where an invoice is named after its customer (`byCustomer`, STORE_INVOICE_BY_CUSTOMER:
     * Taheri): "Invoice - Fatima Hussain", never the number, and a walk-in (no name to give) carries its day
     * instead: "Invoice - 5 Oct 2026". Elsewhere (House of Mina) the file is "Invoice-<number>", as invoice-pdf.ts
     * names it.
     */
    fun shareTitle(inv: Invoice, byCustomer: Boolean): String {
        if (!byCustomer) return "Invoice-" + inv.id
        val name = clean(inv.customerName).take(80)
        if (name.isNotEmpty() && !isWalkInName(name)) return "Invoice - $name"
        val made = ERPDate.parse(inv.createdAt) ?: return "Invoice"
        return "Invoice - " + karachiDay.format(made)
    }

    /** The estimate's sums: whole rupees, 12,345, never ".00" (owner, 2026-10-17: "there should be no decimals"). */
    internal fun rupees(n: Double): String = Money.grouped(if (n.isFinite()) n else 0.0)

    /**
     * The words that go with the link: who it is for and what is owed. Where invoices are named after the customer
     * (`byCustomer`, Taheri) they carry no number (invoice-share.ts `invoiceWhatsAppCaption`, "is at the link
     * below"); elsewhere (House of Mina) they are the counter's own (the viewer's `estimateMessage`: "estimate",
     * its ID, what is owed, and the name as the bill has it). `shopName` is the shop's, never "… ERP".
     */
    fun shareMessage(inv: Invoice, shopName: String, byCustomer: Boolean): String {
        val line = balanceLine(inv.balanceDue)
        if (!byCustomer) {
            // `inv.customerName || 'Customer'`: a walk-in's bill reads "Dear Walk-in Customer", as the web's does.
            val named = inv.customerName.ifEmpty { "Customer" }
            var m = "Dear $named,\n\nHere is your estimate from $shopName.\n\n*Estimate ID:* ${inv.id}\n*Total Amount:* PKR ${rupees(inv.grandTotal)}\n"
            m += if (inv.amountPaid > 0) {
                "*Amount Paid:* PKR ${rupees(inv.amountPaid)}\n*Balance Due:* PKR ${rupees(inv.balanceDue)}\n\n"
            } else {
                "*Amount Due:* PKR ${rupees(inv.grandTotal)}\n\n"
            }
            return m + "Thank you for your business."
        }
        val name = clean(inv.customerName)
        val who = if (name.isEmpty() || isWalkInName(name)) "Customer" else name
        val lines = mutableListOf("Dear $who,", "", "Your invoice from $shopName is at the link below.", "", "*Total:* ${Money.pkr(inv.grandTotal)}")
        if (inv.amountPaid > 0) {
            lines.add("*Paid:* ${Money.pkr(inv.amountPaid)}")
            lines.add(if (line.state == BalanceState.credit) "*Credit to you:* ${Money.pkr(line.amount)}" else "*Balance due:* ${Money.pkr(inv.balanceDue)}")
        }
        lines.add("")
        lines.add("Thank you for your business.")
        return lines.joinToString("\n")
    }

    // MARK: The PDF (lib/invoice-pdf.ts, drawn on the ERP's server: /api/app/pdf/invoice)

    /** The ERP route that draws the invoice Print saves; `perPiece`, one invoice per piece, each on its own page. */
    fun pdfPath(id: String, perPiece: Boolean = false): String =
        "/api/app/pdf/invoice/" + encode(id) + (if (perPiece) "?perPiece=1" else "")

    /**
     * The file's name as the browser saves it (invoice-pdf.ts `invoicePdfFileName`): "Invoice - <customer>.pdf"
     * where invoices are named after the customer (`byCustomer`, Taheri), "Invoice-<number>.pdf" elsewhere; per
     * piece only names a bill of more than one piece.
     */
    fun pdfFileName(inv: Invoice, byCustomer: Boolean, perPiece: Boolean = false): String {
        val split = perPiece && inv.items.size > 1
        if (!byCustomer) return "Invoice-" + inv.id + (if (split) "-per-piece.pdf" else ".pdf")
        return shareTitle(inv, byCustomer = true) + (if (split) " (per piece).pdf" else ".pdf")
    }

    /** The PDF screen for an invoice. */
    fun pdfTarget(inv: Invoice, byCustomer: Boolean, perPiece: Boolean = false): InvoicePdfTarget = InvoicePdfTarget(
        path = pdfPath(inv.id, perPiece),
        fileName = pdfFileName(inv, byCustomer, perPiece),
        title = if (perPiece) "${inv.id} per piece" else inv.id,
    )

    /** The body of Taheri's send from the shop's line (`/api/app/pdf/invoice/<id>/whatsapp`). */
    fun sendPdfFields(phone: String): Map<String, Any?> = mapOf("to" to phone)

    /**
     * Taheri's Send on WhatsApp from the phone: the ERP draws the PDF Print saves and sends it from the shop's line
     * through the browser's own send, which notes it on the invoice. Answers the file's name and the number it went to.
     */
    suspend fun sendPdf(inv: Invoice, phone: String): Pair<String, String> {
        // The send asks WAHA first whether the number is on WhatsApp, then sends: the ERP gives it two minutes.
        val out = ErpApi.shared.send(pdfPath(inv.id) + "/whatsapp", body = sendPdfFields(phone), timeoutMs = 130_000)
        return (out["fileName"] as? String ?: "The PDF") to (out["to"] as? String ?: phone)
    }

    // MARK: Send on WhatsApp (invoice-viewer.tsx)

    /** The number the ERP page's WhatsApp box starts with: the invoice's own, else its customer's, as the ERP keeps numbers (+92…). */
    fun whatsAppPhone(inv: Invoice, customer: Customer?): String {
        val own = inv.customerContact ?: ""
        return pakistanE164(own.ifEmpty { customer?.phone ?: "" })
    }

    /**
     * What goes on WhatsApp from the phone (`openWhatsAppWithLink`): the words, then the customer's link, bare where
     * invoices are named after the customer (Taheri), after "View estimate: " elsewhere.
     */
    fun whatsAppText(inv: Invoice, link: String, shopName: String, byCustomer: Boolean): String =
        shareMessage(inv, shopName, byCustomer) + "\n\n" + (if (byCustomer) "" else "View estimate: ") + link

    /** wa.me with the number and the words written in (lib/whatsapp.ts `whatsAppLink`); null without a usable number. */
    fun whatsAppUrl(phone: String, text: String): String? {
        val number = toWhatsAppNumber(phone)
        if (number.isEmpty()) return null
        return "https://wa.me/$number?text=${component(text)}"
    }

    /** What can be dialled: digits, and a leading "+". */
    fun dialable(phone: String?): String {
        val out = StringBuilder()
        for (ch in (phone ?: "").trim()) {
            if (ch == '+' && out.isEmpty()) out.append(ch) else if (ch in '0'..'9') out.append(ch)
        }
        return out.toString()
    }

    /** "3 pieces · Taken by Demo". */
    fun piecesLine(inv: Invoice): String {
        val n = inv.items.size
        val parts = mutableListOf("$n piece${if (n == 1) "" else "s"}")
        inv.takenBy?.takeIf { it.isNotEmpty() }?.let { parts.add("Taken by $it") }
        return parts.joinToString(" · ")
    }

    /** Imported from, or synced with, Shopify. */
    fun isShopify(inv: Invoice): Boolean = (inv.source ?: "").startsWith("shopify")

    /** A sale to nobody in particular: the ERP page offers "Name them" (decision "Name a sale"). */
    fun unnamed(inv: Invoice): Boolean {
        val name = inv.customerName.trim()
        return name.isEmpty() || isWalkInName(name)
    }

    /** Owed, or a named customer's money over the total, taken as credit (invoice-credit.ts). */
    fun mayTakePayment(role: String, inv: Invoice, owing: Boolean): Boolean = mayTakePayments(role) && (owing || canHoldCredit(inv.customerId))

    /** What a payment taken said: what is left, said as the sheet closes. */
    fun recordedDetail(inv: Invoice, amount: Double): String {
        val line = balanceLine(inv.balanceDue - amount)
        return when (line.state) {
            BalanceState.due -> "${Money.pkr(line.amount)} still due"
            BalanceState.credit -> "Paid in full, ${Money.pkr(line.amount)} in credit"
            BalanceState.paid -> "Paid in full"
        }
    }

    /** The amount as the payment sheet would show it (paise kept). */
    fun pkr(v: Double): String = PaymentText.pkr(v)
}

/** An invoice's PDF to open: one invoice, or one per piece. */
data class InvoicePdfTarget(val path: String, val fileName: String, val title: String)

/** A change that has landed, said for a few seconds over the invoice like the web's toast. */
data class InvoiceNote(val title: String, val detail: String)

/** What came of an action, for the invoice page to say (the web's toast) or to leave (the invoice is gone). */
data class InvoiceActionOutcome(
    val note: InvoiceNote,
    /** Deleted, or refunded in full (which deletes it): the page has nothing left to show, as the web goes back to Invoices. */
    val removed: Boolean,
)
