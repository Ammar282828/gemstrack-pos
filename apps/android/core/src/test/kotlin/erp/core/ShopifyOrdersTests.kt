package erp.core

import erp.core.logic.ShopifyDelivery
import erp.core.logic.ShopifyOrders
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ShopifyOrdersTests {
    private fun inv(id: String, source: String? = "shopify"): Invoice {
        val m = mutableMapOf<String, Any?>("id" to id)
        if (source != null) m["source"] = source
        return Invoice.fromMap(m)
    }

    private fun order(id: String, source: String? = "shopify", state: String? = null, invoiceId: String? = null): Order {
        val m = mutableMapOf<String, Any?>("id" to id)
        if (source != null) m["source"] = source
        if (state != null) m["whatsappOrder"] = mapOf("state" to state, "at" to "2026-11-01T10:00:00.000Z")
        if (invoiceId != null) m["invoiceId"] = invoiceId
        return Order.fromMap(m)
    }

    @Test fun orderDecodesSourceAndWhatsApp() {
        val o = order("SHOPIFY-1001", state = "awaiting-confirmation")
        assertEquals("shopify", o.source?.rawValue)
        assertEquals("awaiting-confirmation", o.whatsappOrder?.state)
        assertEquals(null, order("ORD-1", null).whatsappOrder)
    }

    @Test fun invoiceBySourcePrefix() {
        assertTrue(ShopifyOrders.isShopify(inv("A", "shopify")))
        assertTrue(ShopifyOrders.isShopify(inv("B", "shopify-import")))
        assertFalse(ShopifyOrders.isShopify(inv("C", null)))
        assertFalse(ShopifyOrders.isShopify(inv("D", "pos")))
    }

    @Test fun orderByIdOrSource() {
        assertTrue(ShopifyOrders.isShopify(order("SHOPIFY-5", null)))
        assertTrue(ShopifyOrders.isShopify(order("ORD-5", "shopify")))
        assertFalse(ShopifyOrders.isShopify(order("ORD-5", "website")))
        assertFalse(ShopifyOrders.isShopify(order("ORD-5", null)))
    }

    @Test fun toConfirmOnlyWhileAwaiting() {
        assertTrue(ShopifyOrders.toConfirm(order("SHOPIFY-1", state = "awaiting-confirmation")))
        assertFalse(ShopifyOrders.toConfirm(order("SHOPIFY-1", state = "confirmed")))
        assertFalse(ShopifyOrders.toConfirm(order("SHOPIFY-1", state = "declined")))
        assertFalse(ShopifyOrders.toConfirm(order("SHOPIFY-1")))
        assertFalse(ShopifyOrders.toConfirm(order("ORD-1", null, state = "awaiting-confirmation")))
    }

    @Test fun hubListsSplitByTheSection() {
        val all = listOf(order("SHOPIFY-1"), order("ORD-2", null))
        assertEquals(listOf("SHOPIFY-1"), ShopifyOrders.hubOrders(all, section = true, shopify = true).map { it.id })
        assertEquals(listOf("ORD-2"), ShopifyOrders.hubOrders(all, section = true, shopify = false).map { it.id })
        assertEquals(listOf("SHOPIFY-1", "ORD-2"), ShopifyOrders.hubOrders(all, section = false, shopify = false).map { it.id })
        val invs = listOf(inv("A"), inv("B", null))
        assertEquals(listOf("B"), ShopifyOrders.listedInvoices(invs, true).map { it.id })
        assertEquals(listOf("A", "B"), ShopifyOrders.listedInvoices(invs, false).map { it.id })
    }

    @Test fun earlierInvoicesAreTheOnesNoOrderMade() {
        val invs = listOf(inv("OLD"), inv("MADE"), inv("POS", null))
        val orders = listOf(order("SHOPIFY-9", invoiceId = "MADE"))
        assertEquals(listOf("OLD"), ShopifyOrders.earlier(invs, orders).map { it.id })
    }

    private fun invWith(vararg f: Pair<String, Any?>): Invoice = Invoice.fromMap(mapOf<String, Any?>("id" to "X", "source" to "shopify") + f)

    @Test fun eligibleForOrder() {
        assertTrue(ShopifyOrders.eligibleForOrder(invWith()))
        assertTrue(ShopifyOrders.eligibleForOrder(invWith("shopifyFulfillment" to "partial")))
        assertTrue(ShopifyOrders.eligibleForOrder(invWith("shopifyFulfillment" to "unfulfilled")))
        assertFalse(ShopifyOrders.eligibleForOrder(invWith("shopifyFulfillment" to "fulfilled")))
        assertFalse(ShopifyOrders.eligibleForOrder(invWith("sourceOrderId" to "ORD-1")))
        assertFalse(ShopifyOrders.eligibleForOrder(invWith("status" to "Refunded")))
        assertFalse(ShopifyOrders.eligibleForOrder(invWith("shopifyCancelledAt" to "2026-11-01T10:00:00.000Z")))
        assertFalse(ShopifyOrders.eligibleForOrder(invWith("source" to "pos")))
    }

    @Test fun eligibleSkipsInvoicesAnOrderMade() {
        val invs = listOf(inv("A"), inv("B"))
        assertEquals(listOf("A"), ShopifyOrders.eligible(invs, listOf(order("SHOPIFY-1", invoiceId = "B"))).map { it.id })
    }

    @Test fun conversionParsesAndSays() {
        val c = ShopifyOrders.Conversion.parse(mapOf(
            "converted" to listOf(mapOf("invoiceId" to "A", "orderId" to "SHOPIFY-1"), mapOf("invoiceId" to "B", "orderId" to "SHOPIFY-2")),
            "skipped" to listOf(mapOf("invoiceId" to "C", "reason" to "already an order")),
        ))
        assertEquals(listOf("A" to "SHOPIFY-1", "B" to "SHOPIFY-2"), c.converted)
        assertEquals("2 made orders, 1 skipped: already an order", c.summary)
        assertEquals("1 made an order", ShopifyOrders.Conversion.parse(mapOf("converted" to listOf(mapOf("invoiceId" to "A", "orderId" to "S")))).summary)
    }
}

class ShopifyDeliveryTests {
    private val fields = mapOf(
        "shopifyDelivery" to "delivered",
        "shopifyTracking" to mapOf("company" to "TCS", "number" to "100000000001"),
        "shopifyDeliveryAt" to "2026-11-06T10:00:00.000Z",
    )

    @Test fun theWordsAreTheWebs() {
        assertEquals("Delivered", ShopifyDelivery.label("delivered", "TCS"))
        assertEquals("Returned", ShopifyDelivery.label("returned", null))
        assertEquals("Delivery attempted", ShopifyDelivery.label("attempted", null))
        assertEquals("Out for delivery", ShopifyDelivery.label("out_for_delivery", null))
        assertEquals("With TCS", ShopifyDelivery.label("in_transit", "TCS"))
        assertEquals("With courier", ShopifyDelivery.label("in_transit", "  "))
        assertEquals("With courier", ShopifyDelivery.label("in_transit", null))
        assertEquals("Shipped", ShopifyDelivery.label("shipped", "TCS"))
        assertNull(ShopifyDelivery.label("unfulfilled", "TCS"))
        assertNull(ShopifyDelivery.label(null, null))
        assertNull(ShopifyDelivery.label("whatever", null))
    }

    @Test fun tones() {
        assertEquals(ShopifyDelivery.Tone.positive, ShopifyDelivery.tone("delivered"))
        assertEquals(ShopifyDelivery.Tone.negative, ShopifyDelivery.tone("returned"))
        assertEquals(ShopifyDelivery.Tone.warning, ShopifyDelivery.tone("attempted"))
        assertEquals(ShopifyDelivery.Tone.neutral, ShopifyDelivery.tone("in_transit"))
        assertEquals(ShopifyDelivery.Chip("Delivered", ShopifyDelivery.Tone.positive), ShopifyDelivery.chip("delivered", null))
        assertNull(ShopifyDelivery.chip("unfulfilled", null))
    }

    @Test fun modelsReadTheFieldsAndTheLine() {
        val inv = Invoice.fromMap(mapOf<String, Any?>("id" to "SHOPIFY-1", "source" to "shopify") + fields)
        assertEquals("delivered", inv.shopifyDelivery)
        assertEquals("TCS", inv.shopifyTracking?.company)
        assertEquals("100000000001", inv.shopifyTracking?.number)
        assertEquals("Delivered · TCS 100000000001 · 6 Nov", ShopifyDelivery.line(inv))
        val order = Order.fromMap(mapOf<String, Any?>("id" to "SHOPIFY-2") + fields + mapOf("shopifyDelivery" to "in_transit"))
        assertEquals("With TCS · TCS 100000000001", ShopifyDelivery.line(order))
        assertEquals("With TCS", ShopifyDelivery.chip(order)?.label)
        val bare = Order.fromMap(mapOf<String, Any?>("id" to "SHOPIFY-3"))
        assertNull(bare.shopifyDelivery)
        assertNull(bare.shopifyTracking)
        assertNull(ShopifyDelivery.chip(bare))
        assertNull(ShopifyDelivery.line(bare))
        assertEquals("Shipped", ShopifyDelivery.line("shipped", null, null))
    }
}
