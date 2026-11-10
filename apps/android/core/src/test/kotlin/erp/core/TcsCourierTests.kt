package erp.core

import erp.core.logic.TcsCourier
import erp.core.models.CourierInfo
import erp.core.models.Order
import erp.core.models.ShippingCost
import erp.core.models.TcsBooking
import erp.core.models.Tracking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/lib/tracking.test.ts, tcs-booking.test.ts and shipment-costs.test.ts, for what the app reads and builds; all names and numbers made up. */
class TcsCourierTests {
    private fun order(extra: Map<String, Any?> = emptyMap()): Order = Order.fromMap(mapOf<String, Any?>("id" to "ORD-1") + extra)

    private val bookingMap = mapOf<String, Any?>(
        "cn" to "779412345678", "bookedAt" to "2026-11-09T10:00:00.000Z", "by" to "owner@example.com", "codAmount" to 12500,
        "destinationCity" to "Lahore", "weight" to 0.5, "pieces" to 1, "reference" to "#1460",
        "consignee" to mapOf("name" to "Ayesha", "address" to "House 12, Street 4", "mobile" to "03001234567"),
        "originCity" to "Karachi",
    )

    @Test fun trackingDecodesTheServersShape() {
        val t = Tracking.fromMap(
            mapOf(
                "source" to "tcs", "carrier" to "TCS", "cn" to "779412345678", "status" to "Delivered", "state" to "delivered",
                "events" to listOf(
                    mapOf("at" to "2026-11-10T09:00:00.000Z", "status" to "Delivered", "location" to "Lahore"),
                    mapOf("at" to "2026-11-09T18:00:00.000Z", "status" to "Out for delivery"),
                ),
                "url" to "https://www.tcsexpress.com/track/779412345678", "deliveredAt" to "2026-11-10T09:00:00.000Z",
                "receivedBy" to "Ayesha", "checkedAt" to "2026-11-10T10:00:00.000Z",
            ),
        )
        assertEquals("tcs", t.source)
        assertEquals("Lahore", t.events[0].location)
        assertNull(t.events[1].location)
        assertEquals("Ayesha", t.receivedBy)
        assertEquals("From TCS", TcsCourier.sourceWords(t))
        assertEquals("Tracking · TCS 779412345678", TcsCourier.heading(t, null))
    }

    @Test fun trackingFromShopifyAndAnEmptyOne() {
        val t = Tracking.fromMap(mapOf("source" to "shopify", "carrier" to "Courier", "cn" to null, "state" to "unfulfilled", "status" to "Not shipped yet", "events" to emptyList<Any>()))
        assertEquals("From Shopify", TcsCourier.sourceWords(t))
        assertNull(t.cn)
        assertEquals("Tracking", TcsCourier.heading(t, null))
        assertEquals("Tracking · TCS 779412345678", TcsCourier.heading(t, TcsBooking.fromMap(bookingMap)))
    }

    @Test fun eventsShowSixUntilAll() {
        val events = (1..9).map { mapOf("at" to "2026-11-0${it}T10:00:00.000Z", "status" to "Scan $it") }
        val t = Tracking.fromMap(mapOf("source" to "tcs", "events" to events))
        assertEquals(6, TcsCourier.shownEvents(t, false).size)
        assertEquals(9, TcsCourier.shownEvents(t, true).size)
    }

    @Test fun tones() {
        assertEquals(TcsCourier.Tone.settled, TcsCourier.tone("delivered"))
        assertEquals(TcsCourier.Tone.late, TcsCourier.tone("returned"))
        assertEquals(TcsCourier.Tone.late, TcsCourier.tone("cancelled"))
        assertEquals(TcsCourier.Tone.owed, TcsCourier.tone("attempted"))
        assertEquals(TcsCourier.Tone.quiet, TcsCourier.tone("unfulfilled"))
        assertEquals(TcsCourier.Tone.working, TcsCourier.tone("in_transit"))
        assertEquals(TcsCourier.Tone.working, TcsCourier.tone("booked"))
    }

    @Test fun trackUrlAndSlipPaths() {
        assertEquals("https://www.tcsexpress.com/track/779412345678", TcsCourier.trackUrl("779412345678"))
        assertEquals("TCS-779412345678.pdf", TcsCourier.slipFileName("779412345678"))
        assertEquals("/api/app/pdf/shipping-slip/SHOPIFY-1460?kind=order", TcsCourier.slipPath("order", "SHOPIFY-1460"))
        assertEquals("/api/app/pdf/shipping-slip/INV%2001?kind=invoice", TcsCourier.slipPath("invoice", "INV 01"))
    }

    @Test fun bookingDecodesAndKnowsWhenItIsLive() {
        val b = TcsBooking.fromMap(bookingMap)
        assertEquals(12500.0, b.codAmount)
        assertEquals("Ayesha", b.consignee.name)
        assertTrue(b.live)
        assertFalse(TcsBooking.fromMap(bookingMap + ("cancelledAt" to "2026-11-09T12:00:00.000Z")).live)
    }

    @Test fun theCardShowsWhereTheWebShowsIt() {
        assertFalse(TcsCourier.hasParcel(order()))
        assertTrue(TcsCourier.hasParcel(order(mapOf("tcsConsignmentNo" to "779412345678"))))
        assertTrue(TcsCourier.hasParcel(order(mapOf("tcsBooking" to bookingMap))))
        // A cancelled booking alone is no parcel.
        assertFalse(TcsCourier.hasParcel(order(mapOf("tcsBooking" to bookingMap + ("cancelledAt" to "2026-11-09T12:00:00.000Z")))))
        assertTrue(TcsCourier.hasParcel(order(mapOf("shopifyDelivery" to "in_transit"))))
        assertTrue(TcsCourier.hasParcel(order(mapOf("shopifyDelivery" to "returned"))))
        assertFalse(TcsCourier.hasParcel(order(mapOf("shopifyDelivery" to "unfulfilled"))))
        assertTrue(TcsCourier.hasParcel(order(mapOf("shopifyTracking" to mapOf("company" to "TCS", "number" to "1")))))
    }

    @Test fun cancelIsOfferedOnlyForOursNotYetOnItsWay() {
        val live = TcsBooking.fromMap(bookingMap)
        val gone = TcsBooking.fromMap(bookingMap + ("cancelledAt" to "x"))
        fun at(state: String) = Tracking.fromMap(mapOf("source" to "tcs", "state" to state))
        assertTrue(TcsCourier.canCancel(live, null))
        assertTrue(TcsCourier.canCancel(live, at("booked")))
        assertTrue(TcsCourier.canCancel(live, at("shipped")))
        assertFalse(TcsCourier.canCancel(live, at("in_transit")))
        assertFalse(TcsCourier.canCancel(live, at("delivered")))
        assertFalse(TcsCourier.canCancel(gone, null))
        assertFalse(TcsCourier.canCancel(null, null))
    }

    private fun info(ready: Boolean = true, connected: Boolean = true): CourierInfo = CourierInfo.fromMap(
        mapOf(
            "booking" to mapOf("connected" to connected, "ready" to ready, "originCity" to "Karachi"),
            "prefill" to mapOf(
                "consignee" to mapOf("name" to "Ayesha", "address" to "House 12, Street 4", "mobile" to "03001234567", "email" to ""),
                "destinationCity" to "Lahore", "codAmount" to 12500, "weight" to 0.5, "pieces" to 1, "reference" to "#1460",
                "productDetails" to "Jewellery", "shopifyOrderId" to "9876",
            ),
            "cities" to listOf("Karachi", "Lahore"),
            "booked" to null,
        ),
    )

    @Test fun courierInfoDecodesAndSaysWhyNotReady() {
        val i = info()
        assertEquals("9876", i.prefill.shopifyOrderId)
        assertEquals(listOf("Karachi", "Lahore"), i.cities)
        assertNull(i.booked)
        assertNull(TcsCourier.notReadyWords(i))
        assertEquals(TcsCourier.notReadyConnected, TcsCourier.notReadyWords(info(ready = false)))
        assertEquals(TcsCourier.notReadyNotConnected, TcsCourier.notReadyWords(info(ready = false, connected = false)))
    }

    @Test fun theFormStartsFromThePrefillAndBuildsTheRequest() {
        val f = TcsCourier.Form.from(info())
        assertEquals("0.5", f.weight)
        assertEquals("12500", f.cod)
        assertNull(TcsCourier.problem(f))
        val req = TcsCourier.bookRequest("order", "SHOPIFY-1460", f.copy(remarks = "Call first"), fulfilShopify = true, notifyCustomer = false)
        assertEquals("SHOPIFY-1460", req["orderId"])
        assertFalse(req.containsKey("invoiceId"))
        assertEquals("Lahore", req["destinationCity"])
        assertEquals(0.5, req["weight"])
        assertEquals(1, req["pieces"])
        assertEquals(12500.0, req["codAmount"])
        assertEquals("Call first", req["remarks"])
        assertEquals(true, req["fulfilShopify"])
        assertEquals(false, req["notifyCustomer"])
        assertEquals(mapOf("name" to "Ayesha", "address" to "House 12, Street 4", "mobile" to "03001234567", "email" to ""), req["consignee"])
        assertEquals("INV-9", TcsCourier.bookRequest("invoice", "INV-9", f, true, true)["invoiceId"])
        assertEquals(mapOf("orderId" to "ORD-1"), TcsCourier.cancelRequest("order", "ORD-1"))
        assertEquals(mapOf("invoiceId" to "INV-9"), TcsCourier.cancelRequest("invoice", "INV-9"))
    }

    @Test fun codBlankIsPaid() {
        assertEquals(0.0, TcsCourier.cod(""))
        assertEquals(0.0, TcsCourier.cod("abc"))
        assertEquals(0.0, TcsCourier.cod("-5"))
        assertEquals(12500.0, TcsCourier.cod(" 12,500 "))
    }

    @Test fun theFormRefusesWhatTcsCannotTake() {
        val f = TcsCourier.Form.from(info())
        assertEquals("Who is it for? Add the receiver's name.", TcsCourier.problem(f.copy(name = " ")))
        assertEquals("Add the address.", TcsCourier.problem(f.copy(address = "")))
        assertEquals("Add the city.", TcsCourier.problem(f.copy(city = "")))
        assertEquals("Add the receiver's mobile.", TcsCourier.problem(f.copy(mobile = "")))
        assertEquals("The weight is in kg, more than 0.", TcsCourier.problem(f.copy(weight = "0")))
        assertEquals("The weight is in kg, more than 0.", TcsCourier.problem(f.copy(weight = "heavy")))
        assertEquals("Pieces is 1 or more.", TcsCourier.problem(f.copy(pieces = "0")))
    }

    @Test fun bookedWordsAndTheAnswer() {
        val b = TcsBooking.fromMap(bookingMap)
        assertEquals("Booked with TCS: 779412345678" to "Print the shipping slip for the parcel.", TcsCourier.bookedWords(b, null))
        assertEquals("Shopify fulfilled with the number.", TcsCourier.bookedWords(b, erp.core.models.ShopifyFulfilNote(true, "ok")).second)
        assertEquals("Shopify not updated: no token", TcsCourier.bookedWords(b, erp.core.models.ShopifyFulfilNote(false, "no token")).second)
        val answer = mapOf<String, Any?>("ok" to true, "cn" to b.cn, "booking" to bookingMap + ("shopify" to mapOf("ok" to true, "message" to "fulfilled")))
        assertEquals("779412345678", TcsCourier.bookedFrom(answer)?.cn)
        assertEquals(true, TcsCourier.bookedFrom(answer)?.shopify?.ok)
        assertNull(TcsCourier.bookedFrom(mapOf("ok" to true)))
    }

    @Test fun whatThePersonJustDidShowsUntilTheBooksSayIt() {
        val booked = TcsBooking.fromMap(bookingMap)
        val bare = order()
        val afterBooking = TcsCourier.withLocal(bare, booked, null, "t")
        assertEquals("779412345678", afterBooking.tcsConsignmentNo)
        assertTrue(afterBooking.tcsBooking?.live == true)
        // The order now carries it: the local one is not applied again.
        assertEquals(afterBooking, TcsCourier.withLocal(afterBooking, booked, null, "t"))
        val afterCancel = TcsCourier.withLocal(afterBooking, booked, booked.cn, "2026-11-09T12:00:00.000Z")
        assertNull(afterCancel.tcsConsignmentNo)
        assertFalse(afterCancel.tcsBooking!!.live)
        // Booked and cancelled before the books caught up with either.
        assertFalse(TcsCourier.withLocal(bare, booked, booked.cn, "t").tcsBooking!!.live)
        // A booking made again after the cancel is another number: the old cancel does not touch it.
        val again = booked.copy(cn = "779412345999")
        val second = TcsCourier.withLocal(afterCancel, again, booked.cn, "t")
        assertTrue(second.tcsBooking!!.live)
        assertEquals("779412345999", second.tcsConsignmentNo)
        // The books already say cancelled: nothing to apply.
        val cancelled = order(mapOf("tcsBooking" to bookingMap + ("cancelledAt" to "x")))
        assertEquals(cancelled, TcsCourier.withLocal(cancelled, null, booked.cn, "t"))
    }

    private val costMap = mapOf<String, Any?>(
        "cn" to "779412345678", "total" to 140, "delivery" to 118, "tax" to 19, "fuel" to 3, "codFee" to 2, "insurance" to 0, "withholding" to 0, "other" to 0,
        "updatedAt" to "2026-11-10T00:00:00.000Z",
    )

    @Test fun courierCostOnTheOrder() {
        val o = order(mapOf("shippingCost" to costMap + ("netReceived" to 12360)))
        val c = o.shippingCost!!
        assertEquals("delivery 118 · tax 19 · other 5", TcsCourier.costBreakdown(c))
        assertEquals(listOf("delivery 118 · tax 19 · other 5", "Received from TCS PKR 12,360"), TcsCourier.costLines(c))
        assertTrue(TcsCourier.showsCost(c, isOwner = true))
        assertFalse(TcsCourier.showsCost(c, isOwner = false))
        assertFalse(TcsCourier.showsCost(null, isOwner = true))
        assertFalse(TcsCourier.showsCost(ShippingCost.fromMap(costMap + ("total" to 0)), isOwner = true))
        assertNull(order().shippingCost)
    }

    @Test fun withholdingTaxIsSaid() {
        val c = ShippingCost.fromMap(costMap + ("withholding" to 12))
        assertEquals("Withholding tax PKR 12 (taken from the payout)", TcsCourier.costLines(c).last())
    }
}
