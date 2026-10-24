package erp.app.screens.orders

import erp.core.logic.OrderStage
import erp.core.models.Order
import erp.core.models.OrderStatus

/**
 * An order with what the person just did laid over it, until the books agree (OrderScreen.swift's `localStatus` and
 * `localDone`): a status chosen or a piece ticked leaves the screen at once through the Outbox, and the page shows
 * the change meanwhile. Pure, so a test holds it.
 */
object OrdersLocal {
    /** The order as the person has just left it. */
    fun shown(order: Order, status: String?, done: Map<Int, Boolean>): Order {
        if (status == null && done.isEmpty()) return order
        val items = if (done.isEmpty()) order.items else order.items.mapIndexed { i, it -> done[i]?.let { d -> it.copy(isCompleted = d) } ?: it }
        return order.copy(status = if (status != null) OrderStatus.of(status) else order.status, items = items)
    }

    /** The stage with the status just chosen (an invoiced or awaiting-transfer order keeps its own). */
    fun stage(base: OrderStage, hasInvoice: Boolean, status: String?): OrderStage {
        if (status == null || base == OrderStage.transfer || hasInvoice) return base
        return when (status) {
            "Cancelled", "Refunded" -> OrderStage.closed
            "Completed" -> OrderStage.ready
            "In Progress" -> OrderStage.karigar
            "Pending" -> OrderStage.new
            else -> base
        }
    }

    /** The toast's title for a status just set. */
    fun said(status: String): String = when (status) {
        "Completed" -> "Marked ready"
        "Cancelled" -> "Order cancelled"
        else -> "Now " + status.lowercase()
    }

    /** True when the books say what the person did: their local change can go. */
    fun statusAgrees(order: Order, status: String): Boolean = order.status.rawValue == status

    fun doneAgrees(order: Order, index: Int, done: Boolean): Boolean = index !in order.items.indices || order.items[index].isCompleted == done
}
