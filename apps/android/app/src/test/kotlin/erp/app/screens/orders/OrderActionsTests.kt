package erp.app.screens.orders

import erp.core.ERPDecode
import erp.core.Json
import erp.core.models.Order
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

// OrderActionsLogic.swift: which moves an order offers, the words they say (lib/order-message.ts line for line)
// and the answers of the routes they call. Made-up names and amounts only.
class OrderActionsTests {
    private fun order(vararg changes: Pair<String, Any?>): Order = ERPDecode.model<Order>(
        mapOf(
            "id" to "ORD-7", "createdAt" to "2026-10-07T05:00:00.000Z", "status" to "Pending", "grandTotal" to 45_500.0,
            "customerName" to "Sana Demo",
            "items" to listOf(
                mapOf("description" to "Ring", "karat" to "21k", "estimatedWeightG" to 5.0, "metalType" to "gold"),
                mapOf("description" to "Chain", "estimatedWeightG" to 4.25, "metalType" to "silver"),
                mapOf("description" to "Set", "isManualPrice" to true, "estimatedWeightG" to 9.0),
            ),
        ) + changes,
    )!!

    @Test fun theUndoingMovesAreTheOwnersAndFollowTheInvoice() {
        val open = order()
        val invoiced = order("invoiceId" to "INV-3", "status" to "Completed")
        assertTrue(OrderActions.canUndoInvoice(invoiced, true))
        assertFalse(OrderActions.canUndoInvoice(invoiced, false))
        assertFalse(OrderActions.canUndoInvoice(open, true))
        assertTrue(OrderActions.canRefund(open, true))
        assertFalse(OrderActions.canRefund(order("status" to "Cancelled"), true))
        assertTrue(OrderActions.canDelete(open, true))
        assertFalse(OrderActions.canDelete(invoiced, true))
        assertEquals("Delete order: delete or undo INV-3 first", OrderActions.deleteBlocked(invoiced))
        assertNull(OrderActions.deleteBlocked(open))
    }

    @Test fun theConfirmationsSayTheStoresWords() {
        val o = order("invoiceId" to "INV-3")
        assertEquals("Undo invoice INV-3 back to order ORD-7", OrderActions.undoWhat(o))
        assertEquals("Refund order ORD-7", OrderActions.refundWhat(o))
        assertEquals("Delete order ORD-7", OrderActions.deleteWhat(o))
        assertTrue(OrderActions.undoDetail(o).startsWith("This will permanently cancel invoice INV-3 and revert this order back to “In Progress”"))
        assertTrue(OrderActions.refundDetail(o).endsWith("Invoice INV-3 will be permanently deleted, all hisaab entries removed, and items returned to stock."))
        assertEquals("This will mark order ORD-7 as Refunded. The order record will be kept but removed from revenue calculations.", OrderActions.refundDetail(order()))
        assertEquals("Order Reverted" to "Invoice INV-3 has been cancelled and order is now editable.", OrderActions.undoneNote(o, "INV-3"))
        assertEquals("Invoice Cancelled" to "Invoice INV-3 removed. You can now edit the order.", OrderActions.unlockedNote("INV-3"))
        assertEquals("Order Refunded" to "Order ORD-7 has been marked as refunded and stock restored.", OrderActions.refundedNote(o))
        assertEquals("Order ORD-7 deleted", OrderActions.deletedNote(o))
    }

    @Test fun bookingACourierIsAnOwnersAndOnlyWhereThePageOffersIt() {
        // Neither invoiced nor being made: the header's button.
        assertTrue(OrderActions.canBookCourier(order(), true))
        assertFalse(OrderActions.canBookCourier(order(), false))
        // Being made: Finalize & invoice instead.
        assertFalse(OrderActions.canBookCourier(order("status" to "In Progress"), true))
        // Invoiced or completed and not yet given a TCS number: the menu's.
        assertTrue(OrderActions.canBookCourier(order("status" to "In Progress", "invoiceId" to "INV-1"), true))
        assertTrue(OrderActions.canBookCourier(order("status" to "Completed"), true))
        assertFalse(OrderActions.canBookCourier(order("status" to "Completed", "tcsConsignmentNo" to "CN123"), true))
        assertEquals("CN123", OrderActions.tcsConsignment(order("tcsConsignmentNo" to " CN123 ")))
        assertNull(OrderActions.tcsConsignment(order("tcsConsignmentNo" to "  ")))
    }

    @Test fun leopardsIsForOnlineOrdersOnceThePaymentIsIn() {
        val web = mapOf("paymentStatus" to "transfer_received", "token" to "t")
        val online = order("source" to "website", "website" to web)
        assertTrue(OrderActions.canShipLeopards(online))
        assertFalse(OrderActions.canFollowLeopards(online))
        val shipped = order("source" to "website", "website" to web, "leopards" to mapOf("cn" to "LP123456", "trackingUrl" to "https://x.test/t"))
        assertFalse(OrderActions.canShipLeopards(shipped))
        assertTrue(OrderActions.canFollowLeopards(shipped))
        val delivered = order("source" to "website", "website" to web, "leopards" to mapOf("cn" to "LP123456", "deliveredAt" to "2026-10-10T05:00:00.000Z"))
        assertFalse(OrderActions.canFollowLeopards(delivered))
        assertFalse(OrderActions.canShipLeopards(order("source" to "website", "website" to mapOf("paymentStatus" to "awaiting_transfer", "token" to "t"))))
        assertTrue(OrderActions.cnLooksRight(" LP1234 "))
        assertFalse(OrderActions.cnLooksRight("LP12"))
    }

    @Test fun theSummaryMessageIsOrderMessageTsLineForLine() {
        val expected = "Dear Sana Demo,\n\n" +
            "Here is a summary of your custom order *#ORD-7* from TAHERI.\n\n" +
            "*Item 1:* Ring\n  - Est. Weight: 5g (21k)\n" +
            "*Item 2:* Chain\n  - Est. Weight: 4.25g \n" +
            "*Item 3:* Set\n" +
            "\n*Total Balance Due:* PKR 45,500.00\n\n" +
            "We are working on your order and will notify you of any updates.\n\n" +
            "Thank you for your business."
        assertEquals(expected, OrderActions.customerMessage(order(), OrderActions.MessageKind.summary, "TAHERI"))
    }

    @Test fun theStatusUpdatesSayInProgressAndCompleted() {
        val o = order("customerName" to "")
        val inProgress = OrderActions.customerMessage(o, OrderActions.MessageKind.inProgress, "TAHERI")
        assertEquals(
            "Dear Customer,\n\nThis is an update regarding your order *#ORD-7* from TAHERI.\n\n" +
                "We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n" +
                "Thank you for your business.",
            inProgress,
        )
        val completed = OrderActions.customerMessage(o, OrderActions.MessageKind.completed, "TAHERI")
        assertTrue(completed.contains("Your custom order is now *Completed* and ready for collection.\n\n*Amount Due:* PKR 45,500.00\n\n"))
    }

    @Test fun numbersAreWrittenAsJavaScriptWritesThem() {
        assertEquals("3", OrderActions.jsNumber(3.0))
        assertEquals("4.25", OrderActions.jsNumber(4.25))
        assertEquals("45,500.00", OrderActions.amount(45_500.0))
        assertEquals("1,234.5", OrderActions.amount(1234.5).replace("1,234.50", "1,234.5"))
        assertEquals("1,234.568", OrderActions.amount(1234.5678))
        assertEquals("0.00", OrderActions.amount(Double.NaN))
    }

    @Test fun courierWordsFollowTheShopifyLink() {
        assertEquals("Create a matching Shopify order — custom lines only, nothing added to your catalogue", OrderActions.courierFirstStep(order()))
        assertEquals("Shopify order #1042 already exists", OrderActions.courierFirstStep(order("shopifyOrderId" to "gid-1", "shopifyOrderNumber" to 1042)))
        assertEquals("Shopify order #gid-1 already exists", OrderActions.courierFirstStep(order("shopifyOrderId" to "gid-1")))
        assertFalse(OrderActions.delivering(order()))
        assertTrue(OrderActions.delivering(order("delivery" to mapOf("required" to true, "address" to "House 1", "city" to "Karachi"))))
        assertFalse(OrderActions.delivering(order("delivery" to mapOf("required" to true, "address" to "  "))))
    }

    @Test fun theShopifyOrderMadeIsReadFromTheRoutesAnswer() {
        val made = OrderActions.madeShopifyOrder(mapOf("shopifyOrderId" to "gid-9", "shopifyOrderNumber" to 1043L, "hasShippingAddress" to true))
        assertEquals(OrderActions.MadeShopifyOrder("gid-9", "1043", true), made)
        assertEquals("Shopify order #1043 created" to "Delivery address attached.", OrderActions.madeNote(made!!))
        val none = OrderActions.madeShopifyOrder(mapOf("shopifyOrderId" to "gid-9"))!!
        assertEquals("Shopify order #gid-9 created", OrderActions.madeNote(none).first)
        assertTrue(OrderActions.madeNote(none).second.startsWith("No delivery address on this order"))
        assertNull(OrderActions.madeShopifyOrder(mapOf("shopifyOrderId" to "")))
        assertNull(OrderActions.madeShopifyOrder(emptyMap()))
        assertEquals("Fulfilled. Universal Courier will book it with Envio and add the tracking number.", OrderActions.fulfilledWords(emptyMap()))
        assertEquals("Sent.", OrderActions.fulfilledWords(mapOf("message" to "Sent.")))
    }

    @Test fun tcsIsFoundOnSuccessOrCheckpointsAndCutToFive() {
        val ok = Json.parse(
            """{"message":"SUCCESS","shipmentsummary":"In transit","checkpoints":[
            {"datetime":"1","status":"a"},{"datetime":"2","status":"b"},{"datetime":"3","status":"c"},
            {"datetime":"4","status":"d"},{"datetime":"5","status":"e"},{"datetime":"6","status":"f"}]}""",
        ) as Map<String, Any?>
        val t = OrderActions.tcsTrack(ok).getOrThrow()
        assertEquals("In transit", t.summary)
        assertEquals(listOf("a", "b", "c", "d", "e"), t.checkpoints.map { it.status })
        // Checkpoints alone are a find too, with the page's words for a missing summary.
        val bare = OrderActions.tcsTrack(mapOf("checkpoints" to emptyList<Any>())).getOrThrow()
        assertEquals("No summary available.", bare.summary)
        // Otherwise its words.
        assertEquals("Not found", OrderActions.tcsTrack(mapOf("shipmentsummary" to "Not found")).exceptionOrNull()?.message)
        assertEquals("Bad key", OrderActions.tcsTrack(mapOf("error" to "Bad key")).exceptionOrNull()?.message)
        assertEquals("No data found.", OrderActions.tcsTrack(emptyMap()).exceptionOrNull()?.message)
        assertEquals("https://www.tcscourier.com/domestic/tracking/?ref=CN%20123", OrderActions.tcsUrl("CN 123"))
    }

    @Test fun leopardsTrackingKeepsTheLastFive() {
        val json = Json.parse(
            """{"status":"In transit","delivered":false,"history":[
            {"at":"1","status":"a","location":"Lahore"},{"at":"2","status":"b"},{"at":"3","status":"c"},
            {"at":"4","status":"d"},{"at":"5","status":"e"},{"at":"6","status":"f","location":"Karachi"}]}""",
        ) as Map<String, Any?>
        val t = OrderActions.leopardsTrack(json)
        assertEquals("In transit", t.status)
        assertFalse(t.delivered)
        assertEquals(listOf("2 — b", "3 — c", "4 — d", "5 — e", "6 — f · Karachi"), t.lines)
        assertEquals("Unknown", OrderActions.leopardsTrack(emptyMap()).status)
        assertEquals("LP1", OrderActions.shippedCN(mapOf("leopards" to mapOf("cn" to "LP1"))))
        assertNull(OrderActions.shippedCN(emptyMap()))
    }

    @Test fun aMoveThatMessagesSaysWhetherTheMessageWent() {
        assertEquals("Done. The customer has been told on WhatsApp.", OrderActions.notifiedWords(emptyMap()))
        assertEquals("Done — but the customer's WhatsApp did not send: no number", OrderActions.notifiedWords(mapOf("notified" to "no number")))
    }

    @Test fun aRoutesFieldIsTextWhetherItCameAsTextOrANumber() {
        assertEquals("a", OrderActions.text("a"))
        assertEquals("5", OrderActions.text(5))
        assertEquals("5", OrderActions.text(5L))
        assertEquals("5", OrderActions.text(5.0))
        assertEquals("5.5", OrderActions.text(5.5))
        assertNull(OrderActions.text(null))
        assertNull(OrderActions.text(true))
    }
}
