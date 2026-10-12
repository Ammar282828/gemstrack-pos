package erp.app.screens.invoices

import erp.app.screens.invoices.Fixtures.invoice
import erp.core.logic.MarginSettings
import erp.core.logic.invoiceMargin
import erp.core.logic.percentLabel
import erp.core.models.Payment
import erp.core.models.PaymentType
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InvoicePageTests {
    @Test fun gramsAreToThreePlacesAtMostWithoutGrouping() {
        assertEquals("3.9", InvoiceWords.grams(3.9))
        assertEquals("12.346", InvoiceWords.grams(12.3456))
        assertEquals("5", InvoiceWords.grams(5.0))
        assertEquals("1234.5", InvoiceWords.grams(1234.5))
    }

    @Test fun aPieceIsNamedByItsNameThenCategoryThenStockNumber() {
        assertEquals("Ruby ring", InvoiceWords.pieceTitle(Fixtures.item()))
        assertEquals("Ring", InvoiceWords.pieceTitle(Fixtures.item(name = " ", extra = mapOf("itemCategory" to "cat001"))))
        assertEquals("SKU-1", InvoiceWords.pieceTitle(Fixtures.item(sku = "SKU-1", name = "")))
        assertEquals("Piece", InvoiceWords.pieceTitle(Fixtures.item(sku = "", name = "")))
    }

    @Test fun theFactsLeaveOutTheCategoryTheNameAlreadySaysAndAOneOffKey() {
        val ring = Fixtures.item(extra = mapOf("itemCategory" to "cat001", "size" to "13", "stoneWeightG" to 0.25))
        assertEquals(listOf("Gold (21K)", "5 g", "Size 13", "Stone 0.25 g", "RNG-001"), InvoiceWords.pieceFacts(ring))
        val chain = Fixtures.item(sku = "NEW-3", name = "Gold chain", extra = mapOf("itemCategory" to "cat001"))
        assertEquals(listOf("Ring", "Gold (21K)", "5 g"), InvoiceWords.pieceFacts(chain))
        assertNull(InvoiceWords.stockSku("BILL-7"))
        assertEquals("RNG-9", InvoiceWords.stockSku("RNG-9"))
    }

    @Test fun theBreakdownListsOnlyWhatThePieceCharged() {
        val item = Fixtures.item(
            extra = mapOf("metalCost" to 70_000.0, "wastageCost" to 5_000.0, "wastagePercentage" to 7.5, "makingCharges" to 12_000.0, "diamondChargesIfAny" to 1_000.0),
        )
        assertEquals(listOf("Metal 70,000", "Wastage (7.5%) 5,000", "Making 12,000", "Diamonds 1,000"), InvoiceWords.pieceCosts(item))
        assertEquals(emptyList(), InvoiceWords.pieceCosts(Fixtures.item()))
    }

    @Test fun theRatesAreThoseOfTheGoldKaratsTheBillUses() {
        val inv = invoice(
            extra = mapOf("ratesApplied" to mapOf("goldRatePerGram24k" to 35_000.0, "goldRatePerGram21k" to 30_625.0, "goldRatePerGram22k" to 32_000.0)),
            items = listOf(mapOf("name" to "A", "metalType" to "gold", "karat" to "21k"), mapOf("name" to "B", "metalType" to "silver", "karat" to "22k")),
        )
        assertEquals(listOf("21k 30,625/g"), InvoiceWords.appliedRates(inv))
    }

    @Test fun aRefundReadsAsOneAndKeepsOnlyWhatItAdds() {
        val refund = Payment(-1_500.0, "2026-10-06T06:00:00.000Z", "Refund: damaged", PaymentType.cash)
        assertTrue(InvoiceWords.isRefund(refund))
        assertEquals("Refund", InvoiceWords.paymentTitle(refund))
        assertTrue(InvoiceWords.paymentDetail(refund).endsWith("damaged"))
        assertFalse(InvoiceWords.paymentDetail(refund).contains("Refund"))
        val plain = Payment(500.0, "2026-10-06T06:00:00.000Z", "Payment received", PaymentType.card, "1234")
        assertEquals("Card", InvoiceWords.paymentTitle(plain))
        assertTrue(InvoiceWords.paymentDetail(plain).endsWith("1234"))
        // an old record: no method, no date, no note
        assertEquals("Payment", InvoiceWords.paymentTitle(Payment(1.0, "")))
        assertEquals("—", InvoiceWords.paymentDetail(Payment(1.0, "")))
        assertEquals("Advance", InvoiceWords.paymentDetail(Payment(1.0, "", "Advance")))
    }

    @Test fun theSourceIsShopifyElseTheChannelTheCustomerCameBy() {
        assertEquals("Shopify", InvoiceWords.sourceWords(invoice(extra = mapOf("source" to "shopify_import"))))
        assertEquals("Referral", InvoiceWords.sourceWords(invoice(extra = mapOf("acquisitionSource" to "referral"))))
        assertEquals("elsewhere", InvoiceWords.sourceWords(invoice(extra = mapOf("acquisitionSource" to "elsewhere"))))
        assertNull(InvoiceWords.sourceWords(invoice()))
    }

    @Test fun minaShowsNoMarginAndTaheriDoes() {
        assertTrue(InvoiceWords.showsMargin(erp.app.config.House.marginFor("taheri")))
        assertFalse(InvoiceWords.showsMargin(erp.app.config.House.marginFor("mina")))
        assertEquals(MarginSettings.mina, erp.app.config.House.marginFor("mina"))
    }

    @Test fun theMarginIsSaidAsAssumedOrCostedAndNeverUntilTapped() {
        val settings = erp.app.config.House.marginFor("taheri")
        val noRate = invoiceMargin(invoice(grandTotal = 100_000.0), settings)
        assertTrue(noRate.assumed)
        assertEquals("≈ 10% (no 24k rate given — assumed)", InvoiceWords.marginWords(noRate, settings, percentLabel(noRate)))
        val piece = mapOf("sku" to "R", "name" to "Ring", "itemTotal" to 100_000.0, "metalType" to "gold", "karat" to "21k", "metalWeightG" to 3.0)
        val costed = invoiceMargin(invoice(grandTotal = 100_000.0, extra = mapOf("costRate24k" to 30_000.0), items = listOf(piece)), settings)
        assertFalse(costed.assumed)
        assertTrue(InvoiceWords.marginWords(costed, settings, percentLabel(costed)).startsWith(percentLabel(costed) + " · PKR "))
    }
}
