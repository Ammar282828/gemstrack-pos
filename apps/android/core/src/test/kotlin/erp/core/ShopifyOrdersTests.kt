package erp.core

import erp.core.logic.ShopifyOrders
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
}
