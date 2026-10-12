package erp.core

import erp.core.logic.OrderStage
import erp.core.logic.PieceCounts
import erp.core.logic.STAGES
import erp.core.logic.STAGE_ORDER
import erp.core.logic.bookedAsSale
import erp.core.logic.pieceCounts
import erp.core.logic.stageOf
import erp.core.logic.statusAfterUntick
import erp.core.logic.statusFromPieces
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/lib/order-stage.test.ts, case for case. */
class OrderStageTests {
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!

    /** `k(karigarId, isCompleted)` of the TS. */
    private fun k(karigarId: String? = null, isCompleted: Boolean = false): OrderItem {
        val fields = mutableMapOf<String, Any?>("isCompleted" to isCompleted)
        if (karigarId != null) fields["karigarId"] = karigarId
        return ERPDecode.model<OrderItem>(fields)!!
    }

    // MARK: statusFromPieces

    @Test
    fun testEveryPieceWithAKarigarTakesANewOrderToInProgress() {
        assertEquals(OrderStatus.inProgress, statusFromPieces(OrderStatus.pending, listOf(k("a"), k("b"))))
        assertNull(statusFromPieces(OrderStatus.pending, listOf(k("a"), k())))
        assertNull(statusFromPieces(OrderStatus.pending, listOf(k("a"), k("none"))))
    }

    @Test
    fun testEveryPieceFinishedTakesItToCompletedFromPendingOrInProgress() {
        assertEquals(OrderStatus.completed, statusFromPieces(OrderStatus.inProgress, listOf(k("a", true), k("b", true))))
        assertEquals(OrderStatus.completed, statusFromPieces(OrderStatus.pending, listOf(k(null, true))))
        assertNull(statusFromPieces(OrderStatus.inProgress, listOf(k("a", true), k("b"))))
    }

    @Test
    fun testNeverMovesAFinishedCancelledRefundedOrInvoicedOrderNorOneWithNoPieces() {
        for (s in listOf("Completed", "Cancelled", "Refunded")) {
            assertNull(statusFromPieces(OrderStatus.of(s), listOf(k("a", true))))
        }
        assertNull(statusFromPieces(OrderStatus.inProgress, listOf(k("a", true)), invoiced = true))
        assertNull(statusFromPieces(OrderStatus.pending, emptyList()))
        assertNull(statusFromPieces(OrderStatus.pending, null))
    }

    // MARK: statusAfterUntick

    @Test
    fun testAFinishedOrderGoesBackToInProgressUnlessItIsInvoiced() {
        assertEquals(OrderStatus.inProgress, statusAfterUntick(OrderStatus.completed))
        assertNull(statusAfterUntick(OrderStatus.completed, invoiced = true))
        assertNull(statusAfterUntick(OrderStatus.inProgress))
    }

    // MARK: stageOf

    @Test
    fun testSortsOrdersTheWayTheyAreWorked() {
        assertEquals(OrderStage.ready, stageOf(order(mapOf("status" to "Completed"))))
        assertEquals(OrderStage.karigar, stageOf(order(mapOf("status" to "In Progress"))))
        assertEquals(OrderStage.new, stageOf(order(mapOf("status" to "Pending"))))
        assertEquals(OrderStage.payment, stageOf(order(mapOf("status" to "Completed", "invoiceId" to "INV-1")), owedOnInvoice = 5000.0))
        assertEquals(OrderStage.done, stageOf(order(mapOf("status" to "Completed", "invoiceId" to "INV-1")), owedOnInvoice = 0.0))
        assertEquals(OrderStage.closed, stageOf(order(mapOf("status" to "Refunded", "invoiceId" to "INV-1")), owedOnInvoice = 5000.0))
        assertEquals(OrderStage.closed, stageOf(order(mapOf("status" to "Cancelled"))))
    }

    @Test
    fun testHoldsAConfirmedOnlineOrderAtTheTransferUntilTheMoneyIsIn() {
        fun online(status: String, payment: String): Order = order(mapOf("status" to status, "website" to mapOf("paymentStatus" to payment)))
        assertEquals(OrderStage.transfer, stageOf(online("Pending", "awaiting_transfer")))
        assertEquals(OrderStage.transfer, stageOf(online("Pending", "slip_sent")))
        assertEquals(OrderStage.new, stageOf(online("Pending", "transfer_received")))
        assertEquals(OrderStage.closed, stageOf(online("Cancelled", "expired")))
    }

    // MARK: pieceCounts

    @Test
    fun testCountsPiecesThoseWithoutAKarigarAndThoseFinished() {
        assertEquals(PieceCounts(total = 3, unassigned = 2, done = 1), pieceCounts(listOf(k("a", true), k(), k("none"))))
        assertEquals(PieceCounts(total = 0, unassigned = 0, done = 0), pieceCounts(null))
    }

    // MARK: bookedAsSale

    @Test
    fun testCountsACounterOrderOnceTakenNotOnceInvoicedOrClosed() {
        val at = "2026-10-04T10:00:00Z"
        assertTrue(bookedAsSale(order(mapOf("createdAt" to at, "status" to "Pending"))))
        assertFalse(bookedAsSale(order(mapOf("createdAt" to at, "status" to "Completed", "invoiceId" to "INV-1"))))
        assertFalse(bookedAsSale(order(mapOf("createdAt" to at, "status" to "Cancelled"))))
        assertFalse(bookedAsSale(null))
    }

    @Test
    fun testCountsAnOnlineOrderOnlyOnceItsTransferIsIn() {
        val at = "2026-10-04T10:00:00Z"
        fun online(payment: String): Order = order(mapOf("createdAt" to at, "status" to "Pending", "website" to mapOf("paymentStatus" to payment)))
        assertFalse(bookedAsSale(online("awaiting_transfer")))
        assertFalse(bookedAsSale(online("slip_sent")))
        assertTrue(bookedAsSale(online("transfer_received")))
    }

    // Not in the TS tests: the table the hub prints.
    @Test
    fun testTheStagesAreInTheOrderTheyAreWorkedWithAWordEach() {
        assertEquals(listOf("transfer", "ready", "karigar", "new", "payment", "done", "closed"), STAGE_ORDER.map { it.name })
        assertEquals(OrderStage.values().toSet(), STAGES.keys)
        assertEquals("Ready to hand over", STAGES[OrderStage.ready]?.title)
    }
}
