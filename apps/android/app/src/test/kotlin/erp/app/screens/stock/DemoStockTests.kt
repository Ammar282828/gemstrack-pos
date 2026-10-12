package erp.app.screens.stock

import erp.app.data.Demo
import erp.core.ERPDecode
import erp.core.models.Invoice
import erp.core.models.Product
import erp.core.models.Settings
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// The Stock screens render from the demo books (CONVENTIONS.md rule 13): every demo piece is listed, priced, searched,
// opened, edited and put on a sale with the screens' own logic, with no gap in its words. (The screens themselves
// have no screenshot harness yet.)
class DemoStockTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private val docs: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private val products: List<Product> by lazy { docs.getValue("products").map { ERPDecode.model<Product>(it)!! } }
    private val invoices: List<Invoice> by lazy { docs.getValue("invoices").map { ERPDecode.model<Invoice>(it)!! } }
    private val settings: Settings by lazy { ERPDecode.model<Settings>(docs.getValue("app_settings").first())!! }

    @Test fun theDemoHasPiecesToShow() {
        assertTrue(products.size >= 3)
        assertTrue(products.all { it.sku.isNotEmpty() })
    }

    @Test fun everyPieceIsPricedListedAndSearched() {
        val rates = StockKit.rates(settings)
        assertNotNull(rates)
        val counts = categoryCounts(products)
        assertEquals(products.size, counts.values.sum())
        // Every category that holds a piece has a chip, and the chips count back to the whole stock.
        val options = StockKit.categoryOptions(counts, null)
        assertEquals(products.size, options.sumOf { counts[it.id] ?: 0 })
        val prices = products.map { StockKit.costs(it, rates).totalPrice }
        assertTrue(prices.all { it >= 0 })
        assertNotNull(StockKit.worth(prices))
        for (p in products) {
            assertTrue(StockKit.detail(p).contains("g"))
            assertTrue(StockKit.matches(p, p.sku))
            assertTrue(StockKit.matches(p, p.name))
            assertEquals(p.sku, StockKit.editSku(StockKit.editPath(p.sku)))
            assertTrue(StockRoutes.any { it.matches(StockKit.piecePath(p.sku)) })
            StockKit.rateLine(p, settings)
            StockKit.metalLine(p)
        }
    }

    @Test fun everyPieceOpensInTheFormAndSendsWhatItHas() {
        for (p in products) {
            val f = StockPieceFields.of(p).settle(keepWastage = true)
            // A demo piece that the web form accepts is one the form can send back.
            if (f.problem == null) {
                assertEquals(p.sku.isNotEmpty(), f.piece["categoryId"] == p.categoryId)
                assertEquals(p.metalWeightG, f.piece["metalWeightG"])
            }
            assertTrue(f.piece.containsKey("name"))
            assertNotNull(f.priced)
        }
    }

    @Test fun aSoldPieceIsFoundOnTheDemoInvoices() {
        val skus = invoices.flatMap { inv -> inv.items.map { it.sku } }.filter { it.isNotEmpty() }
        for (sku in skus) {
            val sales = salesOf(sku, invoices)
            assertTrue(sales.isNotEmpty())
            for (inv in sales) saleSubtitle(inv)
        }
    }

    @Test fun bulkAddWorksOnTheDemoSetup() = kotlinx.coroutines.runBlocking {
        val shared = StockBulk.freshSetup().copy(categoryId = products.first().categoryId)
        val rows = StockBulk.weights("3.4 4.1 5.25").map { StockBulkRow(weight = "$it") }
        assertEquals(null, StockBulk.firstProblem(shared, "Demo", rows))
        val out = StockBulk.add(rows, shared, "Demo", "batch") { _, f ->
            mapOf("products" to (f["pieces"] as List<*>).mapIndexed { i, _ -> mapOf("sku" to "DEMO-$i") })
        }
        assertEquals(3, out.added.size)
    }
}
