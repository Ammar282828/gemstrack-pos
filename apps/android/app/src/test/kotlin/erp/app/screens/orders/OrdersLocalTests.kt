package erp.app.screens.orders

import erp.core.ERPDecode
import erp.core.logic.OrderStage
import erp.core.models.Order
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

// What an order shows between a tap and the books agreeing (OrderScreen.swift localStatus, localDone, localStage).
// Made-up names and amounts only.
class OrdersLocalTests {
    private fun order(status: String = "Pending") = ERPDecode.model<Order>(
        mapOf(
            "id" to "ORD-1", "createdAt" to "2026-10-07T05:00:00.000Z", "status" to status, "customerName" to "Sana Demo",
            "items" to listOf(
                mapOf("description" to "Ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5.0, "isCompleted" to false),
                mapOf("description" to "Chain", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 9.0, "isCompleted" to true),
            ),
        ),
    )!!

    @Test fun nothingLocalIsTheBooksOwnOrder() {
        val o = order()
        assertSame(o, OrdersLocal.shown(o, null, emptyMap()))
    }

    @Test fun aStatusJustChosenIsShownAtOnce() {
        assertEquals("Completed", OrdersLocal.shown(order(), "Completed", emptyMap()).status.rawValue)
    }

    @Test fun aTickIsShownOnItsPieceOnly() {
        val shown = OrdersLocal.shown(order(), null, mapOf(0 to true, 1 to false))
        assertEquals(listOf(true, false), shown.items.map { it.isCompleted })
    }

    @Test fun theStageFollowsTheStatusUnlessInvoicedOrAwaitingTransfer() {
        assertEquals(OrderStage.ready, OrdersLocal.stage(OrderStage.karigar, false, "Completed"))
        assertEquals(OrderStage.closed, OrdersLocal.stage(OrderStage.karigar, false, "Cancelled"))
        assertEquals(OrderStage.karigar, OrdersLocal.stage(OrderStage.new, false, "In Progress"))
        assertEquals(OrderStage.new, OrdersLocal.stage(OrderStage.karigar, false, "Pending"))
        assertEquals(OrderStage.payment, OrdersLocal.stage(OrderStage.payment, true, "Completed"), "an invoiced order keeps its own")
        assertEquals(OrderStage.transfer, OrdersLocal.stage(OrderStage.transfer, false, "Completed"))
        assertEquals(OrderStage.karigar, OrdersLocal.stage(OrderStage.karigar, false, null))
    }

    @Test fun theBooksAgreeingDropsTheLocalChange() {
        val o = order("Completed")
        assertTrue(OrdersLocal.statusAgrees(o, "Completed"))
        assertFalse(OrdersLocal.statusAgrees(o, "Pending"))
        assertTrue(OrdersLocal.doneAgrees(o, 1, true))
        assertFalse(OrdersLocal.doneAgrees(o, 0, true))
        assertTrue(OrdersLocal.doneAgrees(o, 7, true), "a piece that is gone is nothing to wait for")
    }

    @Test fun theToastsWordsAreTheIphones() {
        assertEquals("Marked ready", OrdersLocal.said("Completed"))
        assertEquals("Order cancelled", OrdersLocal.said("Cancelled"))
        assertEquals("Now in progress", OrdersLocal.said("In Progress"))
    }
}
