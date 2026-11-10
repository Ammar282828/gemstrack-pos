package erp.core.models

import erp.core.Container
import erp.core.Decodable

// TCS from the order page (src/lib/tcs-booking.ts, src/lib/tracking.ts, src/lib/shipment-costs.ts): what a booking leaves on the order,
// what the booking form starts with, where the parcel is, and what TCS charged to carry it. All decoded leniently, as every model.

/** The receiver on a booking. */
data class Consignee(val name: String, val address: String, val mobile: String, val email: String = "") {
    companion object : Decodable<Consignee> {
        override fun fromMap(m: Map<String, Any?>): Consignee {
            val c = Container(m)
            return Consignee(c.string("name", ""), c.string("address", ""), c.string("mobile", ""), c.string("email", ""))
        }
    }
}

/** Whether Shopify was fulfilled with the number, or why not (`tcsBooking.shopify`). */
data class ShopifyFulfilNote(val ok: Boolean, val message: String) {
    companion object : Decodable<ShopifyFulfilNote> {
        override fun fromMap(m: Map<String, Any?>): ShopifyFulfilNote {
            val c = Container(m)
            return ShopifyFulfilNote(c.bool("ok", false), c.string("message", ""))
        }
    }
}

/** `tcsBooking`: what a booking made from the ERP (op bookTcs) leaves on the order or invoice. */
data class TcsBooking(
    val cn: String,
    val bookedAt: String,
    val by: String,
    val codAmount: Double,
    val destinationCity: String,
    val weight: Double,
    val pieces: Int,
    val reference: String,
    val consignee: Consignee,
    val originCity: String,
    /** Set when it was cancelled with TCS; `tcsConsignmentNo` is then cleared. */
    val cancelledAt: String? = null,
    val shopify: ShopifyFulfilNote? = null,
) {
    /** Made here and not cancelled: the slip prints and Cancel booking is offered. */
    val live: Boolean get() = cn.isNotEmpty() && cancelledAt.isNullOrEmpty()

    companion object : Decodable<TcsBooking> {
        override fun fromMap(m: Map<String, Any?>): TcsBooking {
            val c = Container(m)
            return TcsBooking(
                cn = c.string("cn", ""),
                bookedAt = c.string("bookedAt", ""),
                by = c.string("by", ""),
                codAmount = c.double("codAmount", 0.0),
                destinationCity = c.string("destinationCity", ""),
                weight = c.double("weight", 0.0),
                pieces = c.int("pieces") ?: 1,
                reference = c.string("reference", ""),
                consignee = c.obj("consignee", Consignee) ?: Consignee("", "", ""),
                originCity = c.string("originCity", ""),
                cancelledAt = c.string("cancelledAt")?.takeIf { it.isNotEmpty() },
                shopify = c.obj("shopify", ShopifyFulfilNote),
            )
        }
    }
}

/** `shippingCost`: a slice of what TCS charged for the parcel, never a money total of the sale (owners only; "Courier cost"). */
data class ShippingCost(
    val cn: String,
    val total: Double,
    val delivery: Double,
    val tax: Double,
    val fuel: Double,
    val codFee: Double,
    val insurance: Double,
    val withholding: Double,
    val other: Double,
    val netReceived: Double? = null,
    val updatedAt: String = "",
) {
    companion object : Decodable<ShippingCost> {
        override fun fromMap(m: Map<String, Any?>): ShippingCost {
            val c = Container(m)
            return ShippingCost(
                cn = c.string("cn", ""),
                total = c.double("total", 0.0),
                delivery = c.double("delivery", 0.0),
                tax = c.double("tax", 0.0),
                fuel = c.double("fuel", 0.0),
                codFee = c.double("codFee", 0.0),
                insurance = c.double("insurance", 0.0),
                withholding = c.double("withholding", 0.0),
                other = c.double("other", 0.0),
                netReceived = c.double("netReceived"),
                updatedAt = c.string("updatedAt", ""),
            )
        }
    }
}

/** One scan on a parcel's timeline. */
data class TrackEvent(val at: String, val status: String, val location: String? = null) {
    companion object : Decodable<TrackEvent> {
        override fun fromMap(m: Map<String, Any?>): TrackEvent {
            val c = Container(m)
            return TrackEvent(c.string("at", ""), c.string("status", ""), c.string("location")?.takeIf { it.isNotEmpty() })
        }
    }
}

/** `GET /api/app/tracking` → `{ tracking }` (src/lib/tracking.ts `Tracking`): where the parcel is, whoever answered. */
data class Tracking(
    /** "tcs" or "shopify". */
    val source: String,
    val carrier: String,
    val cn: String?,
    /** The words to show ("Out for delivery", "With TCS"). */
    val status: String,
    /** booked, shipped, in_transit, out_for_delivery, attempted, delivered, returned, cancelled or unfulfilled. */
    val state: String,
    /** Newest first. */
    val events: List<TrackEvent>,
    val url: String?,
    val deliveredAt: String?,
    val receivedBy: String?,
    val checkedAt: String,
) {
    companion object : Decodable<Tracking> {
        override fun fromMap(m: Map<String, Any?>): Tracking {
            val c = Container(m)
            return Tracking(
                source = c.string("source", ""),
                carrier = c.string("carrier", "Courier"),
                cn = c.string("cn")?.takeIf { it.isNotEmpty() },
                status = c.string("status", ""),
                state = c.string("state", ""),
                events = c.list("events", TrackEvent),
                url = c.string("url")?.takeIf { it.isNotEmpty() },
                deliveredAt = c.string("deliveredAt")?.takeIf { it.isNotEmpty() },
                receivedBy = c.string("receivedBy")?.takeIf { it.isNotEmpty() },
                checkedAt = c.string("checkedAt", ""),
            )
        }
    }
}

/** `prefill` of `GET /api/app/courier`: what the booking form starts with. */
data class BookingPrefill(
    val consignee: Consignee,
    val destinationCity: String,
    val codAmount: Double,
    val weight: Double,
    val pieces: Int,
    val reference: String,
    val productDetails: String,
    /** A Shopify order sits behind it: the form offers to fulfil it with the number. */
    val shopifyOrderId: String?,
) {
    companion object : Decodable<BookingPrefill> {
        override fun fromMap(m: Map<String, Any?>): BookingPrefill {
            val c = Container(m)
            return BookingPrefill(
                consignee = c.obj("consignee", Consignee) ?: Consignee("", "", ""),
                destinationCity = c.string("destinationCity", ""),
                codAmount = c.double("codAmount", 0.0),
                weight = c.double("weight", 0.5),
                pieces = c.int("pieces") ?: 1,
                reference = c.string("reference", ""),
                productDetails = c.string("productDetails", ""),
                shopifyOrderId = c.string("shopifyOrderId")?.takeIf { it.isNotEmpty() },
            )
        }
    }
}

/** `GET /api/app/courier`: the account's state, the form's start, TCS's cities and the live booking, if any. */
data class CourierInfo(
    val connected: Boolean,
    val ready: Boolean,
    val originCity: String,
    val prefill: BookingPrefill,
    val cities: List<String>,
    val booked: TcsBooking?,
) {
    companion object : Decodable<CourierInfo> {
        override fun fromMap(m: Map<String, Any?>): CourierInfo {
            val c = Container(m)
            @Suppress("UNCHECKED_CAST")
            val account = Container((m["booking"] as? Map<String, Any?>) ?: emptyMap())
            return CourierInfo(
                connected = account.bool("connected", false),
                ready = account.bool("ready", false),
                originCity = account.string("originCity", "Karachi"),
                prefill = c.obj("prefill", BookingPrefill) ?: BookingPrefill.fromMap(emptyMap()),
                cities = c.strings("cities"),
                booked = c.obj("booked", TcsBooking),
            )
        }
    }
}
