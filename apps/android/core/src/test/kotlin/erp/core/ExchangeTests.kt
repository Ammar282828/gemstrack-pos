package erp.core

import erp.core.logic.ExchangeRow
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.applyExchangeRowChange
import erp.core.logic.blankExchangeRow
import erp.core.logic.describeExchangeEntry
import erp.core.logic.exchangeRowsTotal
import erp.core.logic.exchangeTotal
import erp.core.logic.exchangesFromRows
import erp.core.logic.invoiceExchangeFields
import erp.core.logic.invoiceExchanges
import erp.core.logic.orderExchangeFields
import erp.core.logic.orderExchanges
import erp.core.logic.rowsFromExchanges
import erp.core.models.ExchangeEntry
import erp.core.models.Invoice
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull

/** src/lib/exchange.test.ts, case for case. */
class ExchangeTests {
    private fun order(fields: Map<String, Any?>): Order = ERPDecode.model<Order>(fields)!!
    private fun invoice(fields: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(fields)!!

    // MARK: reading older documents

    @Test
    fun testAnOrdersOneExchangeBecomesOneRow() {
        assertEquals(
            listOf(ExchangeEntry(description = "Old ring 21k 5.2g", value = 95000.0)),
            orderExchanges(order(mapOf("advanceInExchangeDescription" to "Old ring 21k 5.2g", "advanceInExchangeValue" to 95000))),
        )
    }

    @Test
    fun testAnOrderWithNoExchangeHasNoRows() {
        assertEquals(emptyList(), orderExchanges(order(mapOf("advanceInExchangeValue" to 0))))
        assertEquals(emptyList(), orderExchanges(null))
    }

    @Test
    fun testAnInvoicesDescriptionAndTwoAmountsBecomeTwoRowsDescribedOnce() {
        assertEquals(
            listOf(ExchangeEntry(description = "Old bangles", value = 50000.0), ExchangeEntry(description = "", value = 20000.0)),
            invoiceExchanges(invoice(mapOf("exchangeDescription" to "Old bangles", "exchangeAmount1" to 50000, "exchangeAmount2" to 20000))),
        )
    }

    @Test
    fun testTheRowsWinOverTheOldFieldsWhenBothAreThere() {
        val rows = listOf(ExchangeEntry(description = "Chain", karat = "22k", weightG = 10.0, ratePerGram = 20000.0, value = 200000.0))
        val inv = invoice(
            mapOf(
                "exchanges" to listOf(mapOf("description" to "Chain", "karat" to "22k", "weightG" to 10, "ratePerGram" to 20000, "value" to 200000)),
                "exchangeDescription" to "x", "exchangeAmount1" to 1,
            ),
        )
        assertEquals(rows, invoiceExchanges(inv))
    }

    // Not in the TS tests: the other shapes of an old document.
    @Test
    fun testAnOldInvoiceKeepsASecondAmountAloneAndANamedExchangeWithNoValue() {
        assertEquals(
            listOf(ExchangeEntry(description = "Old chain", value = 7000.0)),
            invoiceExchanges(invoice(mapOf("exchangeDescription" to "Old chain", "exchangeAmount2" to 7000))),
        )
        assertEquals(
            listOf(ExchangeEntry(description = "Old chain", value = 0.0)),
            invoiceExchanges(invoice(mapOf("exchangeDescription" to " Old chain "))),
        )
        assertEquals(emptyList(), invoiceExchanges(invoice(emptyMap())))
        assertEquals(emptyList(), invoiceExchanges(null))
    }

    // MARK: writing

    private val rows = listOf(
        ExchangeEntry(description = "Old ring", karat = "22k", weightG = 5.2, ratePerGram = 21000.0, value = 109200.0),
        ExchangeEntry(description = "Broken chain", value = 40000.0),
        ExchangeEntry(description = "", value = 0.0),
    )

    @Test
    fun testAnOrderKeepsTheRowsAndTheirTotalsInTheOldFields() {
        val f = orderExchangeFields(rows)
        assertEquals(2, f.exchanges.size)
        assertEquals(149200.0, f.advanceInExchangeValue)
        assertEquals("Old ring · 22k · 5.2 g at 21,000/g; Broken chain", f.advanceInExchangeDescription)
    }

    @Test
    fun testAnInvoiceKeepsTheRowsAndOneTotalSoEveryOldReaderSumsRight() {
        val f = invoiceExchangeFields(rows)
        assertEquals(149200.0, f?.exchangeAmount1)
        assertEquals(2, f?.exchanges?.size)
    }

    @Test
    fun testNothingExchangedWritesNothing() {
        assertNull(invoiceExchangeFields(emptyList()))
        // A named row with no value is kept, but there is no total to write.
        assertNull(invoiceExchangeFields(listOf(ExchangeEntry(description = "Old watch", value = 0.0)))?.exchangeAmount1)
    }

    @Test
    fun testTotalsAndDescriptions() {
        assertEquals(149200.0, exchangeTotal(rows))
        assertEquals("Gold · 3 g", describeExchangeEntry(ExchangeEntry(description = "", weightG = 3.0, value = 1.0)))
        // Just an amount, the simple exchange: no metal is named for it.
        assertEquals("Exchange", describeExchangeEntry(ExchangeEntry(description = "", value = 5000.0)))
        assertEquals("Old watch", describeExchangeEntry(ExchangeEntry(description = "Old watch", value = 5000.0)))
        assertEquals("Gold · 21k", describeExchangeEntry(ExchangeEntry(description = "", karat = "21k", value = 1.0)))
        assertEquals("Ring · 2.5 g", describeExchangeEntry(ExchangeEntry(description = "Ring", weightG = 2.5, value = 1.0)))
        assertEquals("Ring · 2 g at 1,234,567/g", describeExchangeEntry(ExchangeEntry(description = "Ring", weightG = 2.0, ratePerGram = 1234567.4, value = 1.0)))
        assertEquals(0.0, exchangeTotal(null))
    }

    // MARK: rows as typed

    @Test
    fun testGramsTimesRateFillsTheValueUntilAValueIsTyped() {
        var r = blankExchangeRow()
        r = applyExchangeRowChange(r, ExchangeRowPatch(weightG = "5"))
        assertEquals("", r.value)
        r = applyExchangeRowChange(r, ExchangeRowPatch(ratePerGram = "20000"))
        assertEquals("100000", r.value)
        r = applyExchangeRowChange(r, ExchangeRowPatch(value = "95000"))
        r = applyExchangeRowChange(r, ExchangeRowPatch(weightG = "6"))
        assertEquals("95000", r.value)
    }

    @Test
    fun testClearingATypedValueLetsGramsTimesRateFillItAgain() {
        var r = applyExchangeRowChange(blankExchangeRow(), ExchangeRowPatch(value = "5000"))
        r = applyExchangeRowChange(r, ExchangeRowPatch(value = ""))
        r = applyExchangeRowChange(r, ExchangeRowPatch(weightG = "2", ratePerGram = "10000"))
        assertEquals("20000", r.value)
    }

    @Test
    fun testRoundTripsThroughWhatIsWrittenDroppingBlankRows() {
        val typed = listOf(
            ExchangeRow(description = "Old ring", karat = "21k", weightG = "5.2", ratePerGram = "20000", value = "104000"),
            blankExchangeRow(),
        )
        val written = exchangesFromRows(typed)
        assertEquals(listOf(ExchangeEntry(description = "Old ring", karat = "21k", weightG = 5.2, ratePerGram = 20000.0, value = 104000.0)), written)
        assertEquals(written, exchangesFromRows(rowsFromExchanges(written)))
        assertEquals(104000.0, exchangeRowsTotal(typed))
    }

    @Test
    fun testAnInvoiceWithNoExchangeOpensWithOneEmptyRowToTypeIn() {
        assertEquals(1, rowsFromExchanges(emptyList()).size)
    }

    // Not in the TS tests: a row's id, and a half rupee rounding up as Math.round does.
    @Test
    fun testRowsGetTheirOwnIdsAndRoundTheComputedValueLikeMathRound() {
        assertEquals(7, blankExchangeRow().id.length)
        assertNotEquals(blankExchangeRow().id, blankExchangeRow().id)
        val r = applyExchangeRowChange(blankExchangeRow(), ExchangeRowPatch(weightG = "2.5", ratePerGram = "100.2"))
        assertEquals("251", r.value) // 250.5
    }
}
