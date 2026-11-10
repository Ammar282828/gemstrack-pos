package erp.core.logic

import erp.core.models.CourierInfo
import erp.core.models.Order
import erp.core.models.ShippingCost
import erp.core.models.TcsBooking
import erp.core.models.Tracking
import java.net.URLEncoder

/**
 * TCS from the order page (src/components/order/tcs-shipping.tsx; src/lib/tcs-booking.ts, tracking.ts, shipment-costs.ts): the booking
 * form's request, the Tracking card's words and what it offers, and the owners' "Courier cost". Pure; the calls are
 * `GET /api/app/courier`, `GET /api/app/tracking` and the write ops `bookTcs` / `cancelTcs` (src/app/api/app/write/ops-courier.ts).
 */
object TcsCourier {
    // MARK: Which order shows what

    /** The same tones the ERP's pills use (src/lib/tones.ts); the app maps each to its colour. */
    enum class Tone { settled, late, owed, working, quiet }

    /** Where the Shopify mirror says a parcel has left the shop and not come back (src/lib/shopify-delivery.ts `isShippedOut`). */
    fun isShippedOut(delivery: String?): Boolean =
        delivery == "shipped" || delivery == "in_transit" || delivery == "out_for_delivery" || delivery == "attempted" || delivery == "delivered"

    /**
     * Where the web shows the Tracking card (orders/[id]/page.tsx): a number on the order, a live booking made here, Shopify's word that it
     * shipped (or came back), or Shopify's tracking number. No house gate: a house with no TCS and no parcel never has one.
     */
    fun hasParcel(o: Order): Boolean =
        !o.tcsConsignmentNo.isNullOrEmpty() ||
            o.tcsBooking?.live == true ||
            isShippedOut(o.shopifyDelivery) ||
            o.shopifyDelivery == "returned" ||
            !o.shopifyTracking?.number.isNullOrEmpty()

    /** The live booking made from the ERP, if there is one (a cancelled one is not). */
    fun liveBooking(o: Order): TcsBooking? = o.tcsBooking?.takeIf { it.live }

    /**
     * Cancel booking and the slip are offered for a booking made here and not yet on its way: nothing heard, or booked, shipped or
     * unfulfilled (a parcel TCS already carries is not cancelled from here).
     */
    fun canCancel(booking: TcsBooking?, tracking: Tracking?): Boolean =
        booking?.live == true && (tracking == null || tracking.state in CANCELLABLE)

    private val CANCELLABLE = setOf("booked", "shipped", "unfulfilled")

    /**
     * The order as the person just left it, until the books say so: the booking they made ([booked]) and the one they cancelled
     * ([cancelledCn]) applied over the order as it stands. Each stops applying by itself once the order carries it, so a later
     * booking or cancellation of another number is never undone by an old one.
     */
    fun withLocal(o: Order, booked: TcsBooking?, cancelledCn: String?, now: String): Order {
        var r = o
        if (booked != null && r.tcsBooking?.cn != booked.cn) r = r.copy(tcsConsignmentNo = booked.cn, tcsBooking = booked)
        if (cancelledCn != null) {
            val b = r.tcsBooking
            if (b != null && b.cn == cancelledCn && b.live) {
                r = r.copy(tcsBooking = b.copy(cancelledAt = now), tcsConsignmentNo = if (r.tcsConsignmentNo == cancelledCn) null else r.tcsConsignmentNo)
            }
        }
        return r
    }

    // MARK: The words

    /** TCS's tracking page for a consignment (lib/tcs-cod.ts `tcsTrackUrl`). */
    fun trackUrl(cn: String): String = "https://www.tcsexpress.com/track/" + URLEncoder.encode(cn, "UTF-8").replace("+", "%20")

    /** The pill's tone for a state (lib/tracking.ts `trackingTone`). */
    fun tone(state: String): Tone = when (state) {
        "delivered" -> Tone.settled
        "returned", "cancelled" -> Tone.late
        "attempted" -> Tone.owed
        "unfulfilled" -> Tone.quiet
        else -> Tone.working
    }

    /** "Tracking · TCS 779412345678" (the card's head). */
    fun heading(tracking: Tracking?, live: TcsBooking?): String = when {
        tracking?.cn != null -> "Tracking · ${tracking.carrier} ${tracking.cn}"
        live != null -> "Tracking · TCS ${live.cn}"
        else -> "Tracking"
    }

    /** The card shows six scans until "Show all". */
    const val FIRST_SCANS = 6

    fun shownEvents(tracking: Tracking, all: Boolean) = if (all) tracking.events else tracking.events.take(FIRST_SCANS)

    /** "From TCS" / "From Shopify". */
    fun sourceWords(tracking: Tracking): String = "From ${if (tracking.source == "tcs") "TCS" else "Shopify"}"

    /** The toast after booking: Shopify's part, or the nudge to print the slip. */
    fun bookedWords(booking: TcsBooking, shopify: erp.core.models.ShopifyFulfilNote?): Pair<String, String> =
        "Booked with TCS: ${booking.cn}" to when {
            shopify == null -> "Print the shipping slip for the parcel."
            shopify.ok -> "Shopify fulfilled with the number."
            else -> "Shopify not updated: ${shopify.message}"
        }

    const val notReadyConnected = "The TCS account is missing its cost centre code or account number (Settings → Integrations → TCS)."
    const val notReadyNotConnected = "TCS is not connected yet. An owner adds the account in Settings → Integrations → TCS."

    fun notReadyWords(info: CourierInfo): String? = when {
        info.ready -> null
        info.connected -> notReadyConnected
        else -> notReadyNotConnected
    }

    const val cancelDetail = "TCS voids the consignment; tear up its slip. A Shopify fulfilment made with it stays until it is cancelled on Shopify."

    /** "TCS-<cn>.pdf" (lib/shipping-slip-pdf.ts `shippingSlipFileName`). */
    fun slipFileName(cn: String): String = "TCS-$cn.pdf"

    /** The slip, drawn by the ERP (`GET /api/app/pdf/shipping-slip/<id>?kind=order|invoice`). */
    fun slipPath(kind: String, id: String): String =
        "/api/app/pdf/shipping-slip/" + URLEncoder.encode(id, "UTF-8").replace("+", "%20") + "?kind=$kind"

    // MARK: The booking form

    /** What the person types; the prefill is where it starts. Texts, as typed. */
    data class Form(
        val name: String, val address: String, val mobile: String, val email: String, val city: String,
        val weight: String, val pieces: String, val cod: String, val remarks: String,
    ) {
        companion object {
            fun from(info: CourierInfo): Form {
                val p = info.prefill
                return Form(
                    p.consignee.name, p.consignee.address, p.consignee.mobile, p.consignee.email, p.destinationCity,
                    number(p.weight), p.pieces.toString(), number(p.codAmount), "",
                )
            }
        }
    }

    /** 0.5 as "0.5", 1500.0 as "1500" (JavaScript's `String(n)`). */
    fun number(d: Double): String = if (d.isFinite() && d == Math.rint(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString()

    /** What the form cannot send, in words; null when it can go. TCS's own refusals (a mobile, a city) come back from the ERP. */
    fun problem(f: Form): String? {
        if (f.name.isBlank()) return "Who is it for? Add the receiver's name."
        if (f.address.isBlank()) return "Add the address."
        if (f.city.isBlank()) return "Add the city."
        if (f.mobile.isBlank()) return "Add the receiver's mobile."
        val kg = f.weight.trim().toDoubleOrNull()
        if (kg == null || !(kg > 0)) return "The weight is in kg, more than 0."
        val n = f.pieces.trim().toIntOrNull()
        if (n == null || n < 1) return "Pieces is 1 or more."
        return null
    }

    /** What is still owed to be collected: blank is paid (0); anything unreadable is 0 as the web's `Number(x) || 0`. */
    fun cod(text: String): Double = text.trim().replace(",", "").toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 } ?: 0.0

    /** The write op's fields (ops-courier.ts `bookTcs`), for an order or an invoice. */
    fun bookRequest(kind: String, id: String, f: Form, fulfilShopify: Boolean, notifyCustomer: Boolean): Map<String, Any?> = linkedMapOf(
        if (kind == "invoice") "invoiceId" to id else "orderId" to id,
        "consignee" to linkedMapOf("name" to f.name, "address" to f.address, "mobile" to f.mobile, "email" to f.email),
        "destinationCity" to f.city,
        "weight" to (f.weight.trim().toDoubleOrNull() ?: 0.0),
        "pieces" to (f.pieces.trim().toIntOrNull() ?: 1),
        "codAmount" to cod(f.cod),
        "remarks" to f.remarks,
        "fulfilShopify" to fulfilShopify,
        "notifyCustomer" to notifyCustomer,
    )

    fun cancelRequest(kind: String, id: String): Map<String, Any?> = mapOf(if (kind == "invoice") "invoiceId" to id else "orderId" to id)

    /** What `bookTcs` answered: the booking (with Shopify's part folded in), or null if it carries none. */
    fun bookedFrom(answer: Map<String, Any?>): TcsBooking? {
        val m = answer["booking"] as? Map<*, *> ?: return null
        @Suppress("UNCHECKED_CAST")
        return TcsBooking.fromMap(m as Map<String, Any?>).takeIf { it.cn.isNotEmpty() }
    }

    // MARK: Courier cost (owners)

    /** "delivery 118 · tax 19 · other 5" (lib/shipment-costs.ts `costBreakdown`; zero parts left out). */
    fun costBreakdown(c: ShippingCost): String {
        val other = c.fuel + c.codFee + c.insurance + c.other
        return listOf("delivery" to c.delivery, "tax" to c.tax, "other" to other)
            .filter { Math.round(it.second) >= 1 }
            .joinToString(" · ") { "${it.first} ${Money.grouped(it.second)}" }
    }

    /** The card shows for an owner, once TCS has given a cost (the web's `CourierCost`). */
    fun showsCost(c: ShippingCost?, isOwner: Boolean): Boolean = isOwner && c != null && c.total > 0

    /** The lines under "Courier cost". */
    fun costLines(c: ShippingCost): List<String> = buildList {
        val parts = costBreakdown(c)
        if (parts.isNotEmpty()) add(parts)
        if (c.withholding > 0) add("Withholding tax ${Money.pkr(c.withholding)} (taken from the payout)")
        c.netReceived?.let { add("Received from TCS ${Money.pkr(it)}") }
    }
}
