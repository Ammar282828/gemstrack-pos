package erp.app.screens.orders

import erp.app.data.Demo
import erp.core.ERPDecode
import erp.core.logic.OrderStage
import erp.core.logic.stageOf
import erp.core.models.Invoice
import erp.core.models.Order
import java.io.File
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test

// The Orders screens render from the demo books (CONVENTIONS.md rule 13): what they read of the demo's orders
// and invoices works out under every grouping, with nothing left over and no step or word missing. (The screens
// themselves have no screenshot harness yet.)
class DemoOrdersTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private val docs: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private val orders: List<Order> by lazy { docs.getValue("orders").map { d -> ERPDecode.model<Order>(d)!! } }
    private val invoices: List<Invoice> by lazy { docs.getValue("invoices").map { d -> ERPDecode.model<Invoice>(d)!! } }

    @Test fun theDemoHasOrdersToShow() {
        assertTrue(orders.isNotEmpty())
        assertTrue(orders.all { it.id.isNotEmpty() })
    }

    @Test fun everyGroupingPlacesEveryOpenOrderOnce() {
        val owedOn = OrdersLogic.owedOnInvoices(invoices)
        for (g in OrdersGrouping.entries) {
            val sections = OrdersLogic.sections(orders, g, owedOn, now)
            val ids = sections.flatMap { s -> s.orders.map { it.id } }
            assertEquals(ids.size, ids.toSet().size, "$g places an order twice")
            if (g == OrdersGrouping.due) {
                assertEquals(orders.filter { OrdersLogic.isOpen(it) }.map { it.id }.toSet(), ids.toSet(), "$g")
            } else {
                assertEquals(orders.map { it.id }.toSet(), ids.toSet(), "$g")
            }
            assertTrue(sections.all { it.title.isNotEmpty() }, "$g has a nameless section")
        }
    }

    @Test fun everyCardHasItsWordsAndItsStep() {
        val owedOn = OrdersLogic.owedOnInvoices(invoices)
        for (o in orders) {
            val owed = OrdersLogic.owed(o, owedOn)
            val stage = stageOf(o, owed)
            assertTrue(OrdersLogic.customerName(o).isNotEmpty())
            assertTrue(OrdersLogic.cardWhat(o).first.isNotEmpty())
            assertTrue(OrdersLogic.promiseLine(o, now).isNotEmpty())
            val step = OrdersLogic.nextStep(o, stage, owed)
            if (stage == OrderStage.closed || stage == OrderStage.done) {
                assertTrue(step == null || step is OrderNextStep.Invoice, o.id)
            } else {
                assertTrue(step != null, "${o.id} at $stage has no next step")
                assertTrue(step.title.isNotEmpty())
            }
            // The page's money works for every piece the demo has.
            OrdersLogic.balance(o)
            OrdersLogic.advanceLines(o)
            OrdersLogic.rateLine(o)
            for (item in o.items) pieceFacts(item)
        }
    }
}
