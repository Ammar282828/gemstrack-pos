package erp.app.screens.invoices

import erp.app.data.Demo
import erp.core.logic.invoiceMargin
import erp.core.logic.percentLabel
import erp.core.models.Invoice
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertTrue

/** Every invoice of the demo books goes through the screens' logic without a gap: the list, the page, its sheets. */
class DemoInvoicesTests {
    private val now = Instant.parse("2026-10-12T05:00:00Z")

    private val invoices: List<Invoice> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)["invoices"].orEmpty().map { Invoice.fromMap(it) }
    }

    @Test fun theDemoHasInvoicesToShow() {
        assertTrue(invoices.size >= 3)
    }

    @Test fun theListGroupsFiltersAndSumsTheDemoBooks() {
        for (g in InvoiceGrouping.values()) {
            val sections = InvoicesListRules.sections(invoices, g, now)
            assertTrue(sections.sumOf { it.rows.size } == invoices.size, "$g keeps every invoice")
            assertTrue(sections.all { it.title.isNotEmpty() })
        }
        for (c in InvoiceChip.values()) InvoicesListRules.sections(invoices.filter { c.matches(it) }, InvoiceGrouping.day, now)
        val s = InvoiceSummary.of(invoices, now)
        assertTrue(s.owed >= 0 && s.month >= s.today)
        assertTrue(InvoicesListRules.scope(invoices, InvoiceFilter(search = invoices.first().id), { emptyMap() }, now).isNotEmpty())
    }

    @Test fun eachPageAndSheetHasItsWords() {
        for (inv in invoices) {
            InvoiceFacts.customerName(inv)
            InvoiceFacts.whatSold(inv)
            InvoiceFacts.time(inv.createdAt)
            InvoiceFacts.balanceTone(inv, now)
            InvoiceFacts.pdfTarget(inv, byCustomer = true)
            InvoiceFacts.pdfTarget(inv, byCustomer = false, perPiece = true)
            InvoiceFacts.shareMessage(inv, "DEMO", byCustomer = true)
            InvoiceFacts.shareMessage(inv, "DEMO", byCustomer = false)
            InvoiceWords.appliedRates(inv)
            InvoiceWords.sourceWords(inv)
            for (item in inv.items) {
                InvoiceWords.pieceTitle(item)
                InvoiceWords.pieceFacts(item)
                InvoiceWords.pieceSettings(item)
                InvoiceWords.pieceCosts(item)
            }
            for (p in inv.paymentHistory) {
                InvoiceWords.paymentTitle(p)
                InvoiceWords.paymentDetail(p)
            }
            inv.paymentHistory.indices.forEach { InvoiceActionWords.deletingPayment(inv, it, inv.paymentHistory[it]) }
            InvoiceActionWords.deletion(inv, invoices, ledgerRows = null)
            val m = invoiceMargin(inv, erp.app.config.House.marginFor("taheri"))
            InvoiceWords.marginWords(m, erp.app.config.House.marginFor("taheri"), percentLabel(m))
        }
    }
}
