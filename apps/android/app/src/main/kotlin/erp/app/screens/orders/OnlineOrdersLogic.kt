package erp.app.screens.orders

import erp.app.ui.AppClock
import erp.app.ui.ShopDate
import erp.app.ui.toWhatsAppNumber
import erp.core.Container
import erp.core.Decodable
import erp.core.ERPDate
import erp.core.logic.Money
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Duration
import java.time.Instant
import kotlin.math.abs

// The online orders' answers, read as leniently as the web reads them (src/lib/website/types.ts `OnlineOrderRow`,
// src/lib/website/online-preview.ts `MovePreview`): a missing or odd field gives a default, never an error that
// would empty the inbox (CONVENTIONS.md rule 3). And the inbox's words and small sums, as the web's cards and
// dialogs have them (components/order/online-inbox.tsx, website-order-panel.tsx). Nothing here decides money:
// what a move books and sends is the server's (lib/website/online.ts, fulfilment.ts), and its confirmation shows
// the server's own words (OnlinePreview).

/**
 * One order from the website before it is an order (`online_orders/<ONL-…>`, /api/website/online): waiting to be
 * confirmed, or confirmed or declined in the last fortnight.
 */
data class OnlineOrderRow(
    val id: String,
    /** to_confirm, confirming (someone pressed Confirm a moment ago), confirmed, declined. */
    val state: String,
    val placedAt: String,
    val customer: OnlineCustomer,
    val delivery: OnlineDelivery,
    val lines: List<OnlineOrderLine>,
    val subtotal: Double,
    val deliveryCharge: Double,
    /** What the customer pays: the pieces and the delivery. */
    val grandTotal: Double,
    /** The same pieces at today's rate, while the site is selling; null when not. */
    val todayTotal: Double?,
    /** The customer's own page for it. */
    val statusUrl: String,
    val claimedBy: String?,
    val confirmedAt: String?,
    val confirmedBy: String?,
    /** The ORD- order confirming made. */
    val orderId: String?,
    val holdUntil: String?,
    val declinedAt: String?,
    val declineReason: String?,
) {
    companion object : Decodable<OnlineOrderRow> {
        override fun fromMap(m: Map<String, Any?>): OnlineOrderRow {
            val c = Container(m)
            return OnlineOrderRow(
                id = c.string("id", ""),
                state = c.string("state", ""),
                placedAt = c.string("placedAt", ""),
                customer = c.obj("customer", OnlineCustomer) ?: OnlineCustomer(),
                delivery = c.obj("delivery", OnlineDelivery) ?: OnlineDelivery(),
                lines = c.list("lines", OnlineOrderLine),
                subtotal = c.double("subtotal", 0.0),
                deliveryCharge = c.double("deliveryCharge", 0.0),
                grandTotal = c.double("grandTotal", 0.0),
                todayTotal = c.double("todayTotal"),
                statusUrl = c.string("statusUrl", ""),
                claimedBy = c.string("claimedBy"),
                confirmedAt = c.string("confirmedAt"),
                confirmedBy = c.string("confirmedBy"),
                orderId = c.string("orderId"),
                holdUntil = c.string("holdUntil"),
                declinedAt = c.string("declinedAt"),
                declineReason = c.string("declineReason"),
            )
        }
    }
}

data class OnlineCustomer(val name: String = "", val phone: String = "", val email: String? = null) {
    companion object : Decodable<OnlineCustomer> {
        override fun fromMap(m: Map<String, Any?>): OnlineCustomer {
            val c = Container(m)
            return OnlineCustomer(c.string("name", ""), c.string("phone", ""), c.string("email"))
        }
    }
}

data class OnlineDelivery(val address: String = "", val city: String = "", val notes: String? = null) {
    companion object : Decodable<OnlineDelivery> {
        override fun fromMap(m: Map<String, Any?>): OnlineDelivery {
            val c = Container(m)
            return OnlineDelivery(c.string("address", ""), c.string("city", ""), c.string("notes"))
        }
    }
}

/** A piece as the customer ordered it: its photograph, the price they were quoted, the size they chose. */
data class OnlineOrderLine(val key: String, val description: String, val price: Double, val image: String, val size: String?) {
    companion object : Decodable<OnlineOrderLine> {
        override fun fromMap(m: Map<String, Any?>): OnlineOrderLine {
            val c = Container(m)
            val s = c.string("size")?.trim()
            return OnlineOrderLine(
                key = c.string("key", ""),
                description = c.string("description", ""),
                price = c.double("price", 0.0),
                image = c.string("image", ""),
                size = if (s.isNullOrEmpty()) null else s,
            )
        }
    }
}

/** /api/website/online: the waiting ones first, then the last fortnight's. */
data class OnlineOrdersAnswer(val orders: List<OnlineOrderRow>) {
    companion object : Decodable<OnlineOrdersAnswer> {
        override fun fromMap(m: Map<String, Any?>): OnlineOrdersAnswer =
            OnlineOrdersAnswer(Container(m).list("orders", OnlineOrderRow).filter { it.id.isNotEmpty() })
    }
}

/**
 * What a move will send and to whom, in the server's own words (/api/website/online/<id>/preview,
 * /api/website/orders/<id>/preview: lib/website/online-preview.ts), shown before the move is made.
 */
data class OnlinePreview(
    /** confirm, decline, transfer_received, lapse. */
    val move: String,
    /** The customer's reference: the ONL- number. */
    val ref: String,
    val name: String,
    /** The number the WhatsApp goes to; empty when the order has none. */
    val to: String,
    /** The message, word for word. */
    val text: String,
    /** False when nothing will go: the ERP's WhatsApp is off, or there is no number. */
    val sends: Boolean,
    /** Confirm: when the price hold would end, were it confirmed now. */
    val holdUntil: String?,
    /** Transfer received: what it books. */
    val booking: OnlineBooking?,
) {
    companion object : Decodable<OnlinePreview> {
        override fun fromMap(m: Map<String, Any?>): OnlinePreview {
            val c = Container(m)
            return OnlinePreview(
                move = c.string("move", ""),
                ref = c.string("ref", ""),
                name = c.string("name", ""),
                to = c.string("to", ""),
                text = c.string("text", ""),
                sends = c.bool("sends", true),
                holdUntil = c.string("holdUntil"),
                booking = c.obj("booking", OnlineBooking),
            )
        }
    }
}

/** What Transfer received books (fulfilment.ts markTransferReceived): the pieces' balance as one dated Bank Transfer advance, the delivery as extra revenue. */
data class OnlineBooking(val advance: Double, val deliveryRevenue: Double, val total: Double) {
    companion object : Decodable<OnlineBooking> {
        override fun fromMap(m: Map<String, Any?>): OnlineBooking {
            val c = Container(m)
            return OnlineBooking(c.double("advance", 0.0), c.double("deliveryRevenue", 0.0), c.double("total", 0.0))
        }
    }
}

/** A move done, said on the screen it was made from: whether the customer's WhatsApp went. */
data class OnlineTold(val words: String, val ok: Boolean)

object OnlineOrdersLogic {
    /** The web's HOLD_HOURS (online-inbox.tsx): what a confirmation says when the server's preview has not come. */
    const val holdHours = 24

    /** The reasons the web offers to decline with (online-inbox.tsx REASONS), sent after "we can't take it as it was placed:". */
    val reasons = listOf(
        "This piece cannot be made in the size asked for",
        "We cannot deliver to this city",
        "We could not reach you on this number",
        "This design is no longer made",
    )

    /** Declining keeps 300 characters of the reason and needs three (online.ts declineOnlineOrder). */
    const val reasonLimit = 300

    fun reasonReady(reason: String): Boolean = reason.trim().length >= 3

    /** Waiting for someone to look: to confirm, or being confirmed by someone a moment ago. */
    fun isWaiting(r: OnlineOrderRow): Boolean = r.state == "to_confirm" || r.state == "confirming"

    /** "Rs 201,500", as the customer's own messages write it (the shop's screens say PKR: Money.pkr). */
    fun rs(n: Double): String = "Rs " + Money.grouped(n)

    /** "+PKR 3,500" or "−PKR 3,500": how far a price has moved. */
    fun signedPKR(n: Double): String = (if (n < 0) "−" else "+") + Money.pkr(abs(n))

    /** The piece's name without the " (size 12)" the site appends: the size has its own line. */
    fun pieceName(description: String): String {
        if (!description.endsWith(")")) return description
        val at = description.indexOf(" (size ")
        if (at < 0) return description
        val inner = description.substring(at + " (size ".length, description.length - 1)
        return if (inner.isEmpty() || inner.contains(")")) description else description.substring(0, at)
    }

    /** The sizes asked for, or "none asked" (the confirm dialog's line). */
    fun sizes(r: OnlineOrderRow): String {
        val s = r.lines.mapNotNull { it.size }
        return if (s.isEmpty()) "none asked" else s.joinToString(", ")
    }

    /** "piece", or "3 pieces". */
    fun pieces(n: Int): String = if (n == 1) "piece" else "$n pieces"

    // MARK: Today's rate

    data class Moved(val amount: Double, val percent: Double)

    /** How far gold has moved the same pieces since the customer ordered; null when today's price is not known. */
    fun moved(r: OnlineOrderRow): Moved? {
        val today = r.todayTotal ?: return null
        val amount = today - r.grandTotal
        return Moved(amount, if (r.grandTotal != 0.0) amount / r.grandTotal * 100 else 0.0)
    }

    /** C's "%.1f": the double's exact value, ties to even. */
    private fun oneDecimal(x: Double): String = BigDecimal(x).setScale(1, RoundingMode.HALF_EVEN).toPlainString()

    /** The card's line, from half a percent either way: "At today's rate it is PKR 205,000 (+PKR 3,500, +1.7%). Confirming holds their price." */
    fun movedLine(r: OnlineOrderRow): String? {
        val m = moved(r) ?: return null
        val today = r.todayTotal ?: return null
        if (abs(m.percent) < 0.5) return null
        val pct = (if (m.percent > 0) "+" else "") + oneDecimal(m.percent) + "%"
        return "At today's rate it is ${Money.pkr(today)} (${signedPKR(m.amount)}, $pct). Confirming holds their price."
    }

    /** The confirm dialog's "Today it would be": only when gold has gone up by half a percent or more. */
    fun dearerToday(r: OnlineOrderRow): Double? {
        val m = moved(r) ?: return null
        if (m.amount <= 0 || abs(m.percent) < 0.5) return null
        return r.todayTotal
    }

    // MARK: Words

    /**
     * When it was placed, said the web's way ("2 hours ago"): Foundation's RelativeDateTimeFormatter picks the
     * largest unit that has reached one, in numbers.
     */
    fun ago(iso: String, now: Instant = AppClock.now()): String {
        val d = ERPDate.parse(iso) ?: return ""
        val seconds = Duration.between(d, now).seconds
        val n = abs(seconds)
        val (count, unit) = when {
            n < 5 -> return "now"
            n < 60 -> n to "second"
            n < 3_600 -> n / 60 to "minute"
            n < 86_400 -> n / 3_600 to "hour"
            n < 7 * 86_400 -> n / 86_400 to "day"
            n < 30 * 86_400 -> n / (7 * 86_400) to "week"
            n < 365 * 86_400 -> n / (30 * 86_400) to "month"
            else -> n / (365 * 86_400) to "year"
        }
        val words = "$count $unit${if (count == 1L) "" else "s"}"
        return if (seconds >= 0) "$words ago" else "in $words"
    }

    /** The account that did it, without its domain; nothing for the development bypass. */
    fun who(email: String?): String? {
        if (email.isNullOrEmpty() || email == "dev-bypass") return null
        return email.substringBefore('@').ifEmpty { email }
    }

    /** The confirm dialog's description, the web's words; the hold is the server's when its preview has come. */
    fun confirmWords(r: OnlineOrderRow, holdUntil: String?): String {
        val hold = holdWords(holdUntil)
        return "It becomes an order in the book for ${r.customer.name}, labelled Online, with its ${pieces(r.lines.size)} at the " +
            "prices they were quoted. They are told on WhatsApp, and you send them your bank details there; they have " +
            "$hold to transfer ${Money.pkr(r.grandTotal)}."
    }

    /** "until Tue 6 Oct 2:30 pm" from the server's hold, else the web's "24 hours". */
    fun holdWords(holdUntil: String?): String {
        if (holdUntil != null) until(holdUntil)?.let { return "until $it" }
        return "$holdHours hours"
    }

    /** What became of a WhatsApp the server tried to send (the routes' `notified`: null when it went). */
    fun told(notified: String?, name: String, sent: String): OnlineTold {
        if (!notified.isNullOrEmpty()) return OnlineTold("Done, but the WhatsApp did not send ($notified): tell $name yourself.", false)
        return OnlineTold(sent, true)
    }

    // MARK: The bank details, from the shop's phone

    /**
     * WhatsApp to the customer from this phone, the amount and reference written in: the shop sends its bank
     * details itself (the owner, 2026-10-04), so this only opens the chat ready (lib/website/online-client.ts
     * `bankDetailsWhatsApp`). The person adds the account and presses send there.
     */
    fun bankDetailsText(name: String, ref: String, total: Double): String =
        "Assalamualaikum $name, your order $ref is confirmed. The amount is ${rs(total)}. Please transfer it to:\n"

    private const val componentSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    /** JavaScript's encodeURIComponent. */
    fun component(s: String): String {
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in componentSafe) out.append(c) else out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** wa.me with the words written in; null without a usable number. */
    fun bankDetailsUrl(phone: String, name: String, ref: String, total: Double): String? {
        val number = toWhatsAppNumber(phone)
        if (number.isEmpty()) return null
        return "https://wa.me/$number?text=${component(bankDetailsText(name, ref, total))}"
    }

    /** "Tue 6 Oct 2:30 pm": when a hold ends, said as the shop says a time; null for a time that does not read. */
    fun until(iso: String): String? = ShopDate.say(iso, withTime = true).ifEmpty { null }
}
