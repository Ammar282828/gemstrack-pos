package erp.app.shots

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performSemanticsAction
import erp.app.data.Book
import erp.app.data.Delivery
import erp.app.screens.orders.OrdersGrouping
import erp.app.screens.orders.OrdersLogic
import erp.app.ui.AppClock
import erp.core.logic.stageOf
import erp.core.models.Customer
import erp.core.models.GivenItem
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.Order
import erp.core.models.Settings

/** The books to draw: whatever the test hands over (real documents from a private export, or made-up shapes). */
class SweepBooks(
    val orders: List<Order>,
    val invoices: List<Invoice> = emptyList(),
    val customers: List<Customer> = emptyList(),
    val karigars: List<Karigar> = emptyList(),
    val given: List<GivenItem> = emptyList(),
    val settings: Settings? = null,
)

/**
 * Draws the Orders hub and the order page for every order of a set of books, three ways (the page alone, the hub's
 * card tapped, the Orders tab of the whole shell), and runs the hub's and the card's logic over them. An exception
 * in any of it is caught and returned as a line, so one run lists every order that breaks.
 */
abstract class OrderSweepBase(config: ShotConfig) : ShotBase(config) {
    private fun lines(e: Throwable, n: Int = 14) = e.stackTraceToString().lines().take(n).joinToString(" | ")

    private fun give(b: SweepBooks, orders: List<Order>) {
        val book = Book.shared
        book.orders.take(Delivery.All(orders, false))
        book.invoices.take(Delivery.All(b.invoices, false))
        book.customers.take(Delivery.All(b.customers, false))
        book.karigars.take(Delivery.All(b.karigars, false))
        book.givenItems.take(Delivery.All(b.given, false))
        b.settings?.let { book.settings.take(Delivery.All(listOf(it), false)) }
    }

    /** OrdersLogic and the card's figures, no screen. */
    protected fun sweepLogic(b: SweepBooks): List<String> {
        val failures = ArrayList<String>()
        val owedOn = OrdersLogic.owedOnInvoices(b.invoices)
        val now = AppClock.now()
        try {
            for (g in OrdersGrouping.values()) OrdersLogic.sections(b.orders, g, owedOn, now)
        } catch (e: Throwable) {
            failures += "sections: ${lines(e, 8)}"
        }
        for (o in b.orders) {
            try {
                val owed = OrdersLogic.owed(o, owedOn)
                val stage = stageOf(o, owed)
                OrdersLogic.cardWhat(o); OrdersLogic.whatIsIt(o); OrdersLogic.customerName(o); OrdersLogic.rateLine(o)
                OrdersLogic.promiseLine(o, now); OrdersLogic.promise(o, now); OrdersLogic.balance(o); OrdersLogic.matches(o, "a")
                OrdersLogic.nextStep(o, stage, owed); OrdersLogic.advanceLines(o); OrdersLogic.subtotal(o)
                OrdersLogic.phoneWords(o.customerContact)
            } catch (e: Throwable) {
                failures += "logic ${o.id}: ${lines(e, 8)}"
            }
        }
        return failures
    }

    /** The hub with all the orders on it, then each order's page on its own back stack. */
    protected fun sweepPages(b: SweepBooks): Pair<Int, List<String>> {
        val failures = ArrayList<String>()
        showPlace("/orders")
        give(b, b.orders)
        try {
            settle(800)
        } catch (e: Throwable) {
            failures += "hub: ${lines(e, 12)}"
        }
        var ok = 0
        for (o in b.orders) {
            try {
                showPlace("/orders/${o.id}", below = listOf("/orders"))
                give(b, b.orders)
                settle(800)
                // The page itself, not "Order not found" (the shelf has to have taken the order).
                compose.onAllNodesWithText("Order not found").assertCountEquals(0)
                ok++
            } catch (e: Throwable) {
                failures += "order ${o.id}: ${lines(e)}"
            }
        }
        return ok to failures
    }

    /** The phone's own path: the hub with one order on it, its card tapped (the zoom runs), then the page. Through the shell when [shell]. */
    protected fun sweepTaps(b: SweepBooks, shell: Boolean): Pair<Int, List<String>> {
        val failures = ArrayList<String>()
        var ok = 0
        for (o in b.orders) {
            try {
                if (shell) show { erp.app.nav.AppRoot(erp.app.ErpApp.session) } else showPlace("/orders")
                give(b, listOf(o))
                if (shell) compose.onAllNodesWithText("Orders")[0].performSemanticsAction(SemanticsActions.OnClick)
                settle(1200)
                compose.onNode(SemanticsMatcher("opens ${o.id}") { it.config.getOrNull(SemanticsActions.OnClick)?.label == "Open ${o.id}" }, useUnmergedTree = true)
                    .performSemanticsAction(SemanticsActions.OnClick)
                settle(1500)
                compose.onAllNodesWithText("Order not found").assertCountEquals(0)
                ok++
            } catch (e: Throwable) {
                failures += "${if (shell) "shell" else "tap"} ${o.id}: ${lines(e)}"
            }
        }
        return ok to failures
    }
}
