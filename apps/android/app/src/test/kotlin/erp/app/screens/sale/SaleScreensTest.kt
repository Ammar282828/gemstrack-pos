package erp.app.screens.sale

import erp.app.data.Demo
import erp.app.ui.EntryStep
import erp.app.ui.EntryStepState
import erp.core.DocJSON
import erp.core.entry.EntryHouse
import erp.core.entry.SaleDraft
import erp.core.entry.SaleFigures
import erp.core.entry.SaleLine
import erp.core.entry.SaleNumber
import erp.core.entry.payload
import erp.core.entry.webValues
import erp.core.models.Customer
import erp.core.models.Product
import erp.core.models.Settings
import java.io.File
import java.time.Instant
import java.time.LocalDate
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * New sale's own rules: where its routes match, what a path asks, how a SKU becomes a link, what this phone keeps,
 * and the demo books carried through the screens' own steps to a priced sale. The money itself is core's (and proven
 * against the iPhone by the contract); these hold the screens to it.
 */
class SaleScreensTest {
    private val demo: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), Instant.now())
    }

    private fun products(): List<Product> = demo.getValue("products").map { DocJSON.decode<Product>(it["sku"] as String, it) }
    private fun settings(): Settings = demo.getValue("app_settings").first().let { DocJSON.decode<Settings>(it["id"] as String, it) }
    private fun customers(): List<Customer> = demo.getValue("customers").map { DocJSON.decode<Customer>(it["id"] as String, it) }

    @Before fun house() {
        EntryHouse.id = "taheri"
        SaleStore.clear()
    }

    // Routes

    @Test fun theSalesOwnPathsAreMatchedAndAnInvoicesAreNot() {
        fun native(p: String) = SaleRoutes.any { it.matches(p) }
        assertTrue(native("/new"))
        assertTrue(native("/invoices/new"))
        assertTrue(native("/invoices/new?scan=bill"))
        assertTrue(native("/scan"))
        assertTrue(native("/invoices/INV-000123/edit"))
        assertFalse(native("/invoices/INV-000123"))
        assertFalse(native("/invoices"))
        assertFalse(native("/orders/add"))
    }

    @Test fun aPathAsksForOneOfTheReaders() {
        assertTrue(SaleRouting.asks("/invoices/new?scan=bill", "bill"))
        assertFalse(SaleRouting.asks("/invoices/new?scan=parchi", "bill"))
        assertTrue(SaleRouting.asks("/orders/add?x=1&scan=parchi", "parchi"))
        assertFalse(SaleRouting.asks("/invoices/new", "bill"))
    }

    @Test fun anEditPathNamesItsInvoice() {
        assertEquals("INV-000123", SaleRouting.editId("/invoices/INV-000123/edit"))
        assertEquals("INV 9", SaleRouting.editId("/invoices/INV%209/edit?x=1"))
        assertNull(SaleRouting.editId("/invoices//edit"))
        assertNull(SaleRouting.editId("/invoices/a/b/edit"))
        assertNull(SaleRouting.editId("/invoices/INV-1"))
        assertNull(SaleRouting.editId("/invoices/edit"))
    }

    @Test fun linksEscapeWhatAPathCannotHold() {
        assertEquals("/products/RNG-D110", SaleLinks.piece("RNG-D110"))
        assertEquals("/products/A%20B%2FC", SaleLinks.piece("A B/C"))
        assertEquals("/invoices/INV-000123", SaleLinks.invoice("INV-000123"))
        assertEquals("/products/%E2%82%A8", SaleLinks.piece("\u20A8"))
        // A letter in any script stays, as the system's alphanumerics do.
        assertEquals("/products/\u0905", SaleLinks.piece("\u0905"))
    }

    @Test fun anExpectedDateIsTheDayAsTheErpKeepsIt() {
        assertEquals("2026-10-12", SaleDates.string(LocalDate.of(2026, 10, 12)))
        assertEquals(LocalDate.of(2026, 10, 12), SaleDates.date("2026-10-12"))
        assertNull(SaleDates.date(""))
        assertNull(SaleDates.date("12/10/2026"))
    }

    @Test fun halvesGoAwayFromZero() {
        assertEquals(3.0, awayRounded(2.5))
        assertEquals(-3.0, awayRounded(-2.5))
        assertEquals(10.0, awayRounded(9.6))
        assertEquals(0.0, awayRounded(0.4))
    }

    // What the phone keeps

    @Test fun zeroIsBlankInANumberField() {
        assertEquals("", SaleNumber.text(0.0))
        assertEquals("3.4", SaleNumber.text(3.4))
    }

    @Test fun aSaleIsKeptOnThePhoneAndABlankOneIsNot() {
        assertNull(SaleStore.load())
        val d = SaleDraft()
        d.lines.add(SaleLine.fromProduct(products().first()))
        d.customerName = "Sana Demo"
        SaleStore.save(d)
        val back = SaleStore.load()
        assertNotNull(back)
        assertEquals(listOf("RNG-D110"), back.lines.map { it.sku })
        assertEquals("Sana Demo", back.customerName)
        SaleStore.save(SaleDraft())
        assertNull(SaleStore.load())
    }

    @Test fun aScannedPieceGoesOnTheSaleOnce() {
        val p = products().first()
        assertTrue(SaleStore.add(p))
        assertFalse(SaleStore.add(p))
        assertEquals(1, SaleStore.load()?.lines?.size)
    }

    @Test fun aRateABillSetIsNotWrittenBack() {
        val d = SaleDraft()
        d.lines.add(SaleLine.blankFor("gold", "BILL-1"))
        d.rates["gold21k"] = "33000.00"
        SaleStore.hold(mapOf("gold21k" to "33000.00"), d)
        val kept = SaleStore.unheld(mapOf("goldRatePerGram21k" to 33000.0, "goldRatePerGram22k" to 35000.0), d)
        assertEquals(mapOf("goldRatePerGram22k" to 35000.0), kept)
        // Typing another figure over it makes it the person's own again.
        d.rates["gold21k"] = "33100"
        assertEquals(2, SaleStore.unheld(mapOf("goldRatePerGram21k" to 33100.0, "goldRatePerGram22k" to 35000.0), d)?.size)
    }

    // The demo books through the screens' steps

    @Test fun theDemoBooksPriceASaleAndGateItsSteps() {
        val settings = settings()
        val d = SaleDraft()
        val empty = SaleFigures(d, settings, customers(), EntryHouse.margin)
        assertEquals("Add a piece to the sale first.", empty.blockedReason)
        assertTrue(stepStates(empty).isEmpty())

        products().forEach { d.add(it) }
        d.pick(customers().first())
        val f = SaleFigures(d, settings, customers(), EntryHouse.margin)
        assertTrue(f.hasEstimate)
        assertTrue(f.subtotal > 0)
        assertNull(f.blockedReason)
        val states = stepStates(f)
        assertEquals(EntryStepState.done, states[EntryStep.customer])
        assertEquals(EntryStepState.done, states[EntryStep.pieces])
        assertNull(states[EntryStep.payment])

        // Paid in full: the rest, in whole rupees, and the payment step is done.
        d.payRest(d.payments.first().id, f.total)
        val paid = SaleFigures(d, settings, customers(), EntryHouse.margin)
        assertEquals(EntryStepState.done, stepStates(paid)[EntryStep.payment])
        assertTrue(kotlin.math.abs(paid.balance) <= 0.5)

        // What Save sends and what Drafts holds are core's, built without the screen throwing.
        val sent = d.payload(paid) { null }
        assertEquals(3, (sent["cart"] as List<*>).size)
        assertTrue(d.webValues(paid.subtotal).containsKey("cart"))
    }

    @Test fun anOverpaymentToAWalkInHoldsSaveBack() {
        val d = SaleDraft()
        d.add(products().first())
        val f0 = SaleFigures(d, settings(), customers(), EntryHouse.margin)
        d.payments.first().amount = SaleNumber.text(f0.total + 5000)
        val f = SaleFigures(d, settings(), customers(), EntryHouse.margin)
        assertTrue(f.overpaid)
        assertFalse(f.canSave)
        assertEquals(EntryStepState.attention, stepStates(f)[EntryStep.payment])
    }
}
