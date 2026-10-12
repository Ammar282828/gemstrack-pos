package erp.core

import erp.core.logic.invoiceSaleValue
import erp.core.models.Invoice
import kotlin.test.Test
import kotlin.test.assertEquals

/** src/lib/analytics/sale-value.test.ts, case for case. */
class SaleValueTests {
    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!

    @Test
    fun testASalePaidWhollyInOldGoldIsWorthWhatWasSoldNotNothing() {
        // INV-000007 as stored: 700,090 sold, 12,090 off, 688,000 in exchange → grandTotal 0.
        assertEquals(688000.0, invoiceSaleValue(invoice(mapOf("grandTotal" to 0, "exchangeAmount1" to 688000))))
    }

    @Test
    fun testPartExchangeTheCashPartPlusTheExchange() {
        assertEquals(
            100000.0,
            invoiceSaleValue(invoice(mapOf("grandTotal" to 25000, "exchanges" to listOf(mapOf("description" to "Old ring", "value" to 60000), mapOf("description" to "", "value" to 15000))))),
        )
    }

    @Test
    fun testTheExchangeListWinsOverTheOldTotalsItAlsoWrites() {
        assertEquals(
            15.0,
            invoiceSaleValue(invoice(mapOf("grandTotal" to 10, "exchanges" to listOf(mapOf("description" to "", "value" to 5)), "exchangeAmount1" to 5))),
        )
    }

    @Test
    fun testNoExchangeFieldOlderInvoicesKeptItInAPaymentTheTotalAsItIs() {
        assertEquals(991324.95, invoiceSaleValue(invoice(mapOf("grandTotal" to 991324.95))))
        assertEquals(5000.0, invoiceSaleValue(invoice(mapOf("grandTotal" to 5000, "exchangeDescription" to "old chain"))))
        assertEquals(0.0, invoiceSaleValue(null))
    }
}
