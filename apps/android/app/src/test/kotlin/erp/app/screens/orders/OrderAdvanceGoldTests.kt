package erp.app.screens.orders

import erp.app.ui.PaymentText
import erp.core.ERPDecode
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.applyExchangeRowChange
import erp.core.logic.blankExchangeRow
import erp.core.logic.exchangesFromRows
import erp.core.models.Order
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// An order advance can be paid in gold (OrdersSupport.swift OrderAdvance, OrdersLogic.advanceLines): made-up names and amounts only.
class OrderAdvanceGoldTests {
    private fun order(vararg changes: Pair<String, Any?>): Order = ERPDecode.model<Order>(
        mapOf("id" to "ORD-1", "createdAt" to "2026-10-07T05:00:00.000Z", "status" to "Pending", "customerName" to "Sana Demo") + changes,
    )!!

    @Test fun anExchangeRowGoesToTheWriteAsTheNewOrderSendsIt() {
        var row = blankExchangeRow()
        row = applyExchangeRowChange(row, ExchangeRowPatch(description = "Old ring"))
        row = applyExchangeRowChange(row, ExchangeRowPatch(karat = "22k"))
        row = applyExchangeRowChange(row, ExchangeRowPatch(weightG = "5"))
        row = applyExchangeRowChange(row, ExchangeRowPatch(ratePerGram = "20000"))
        val e = exchangesFromRows(listOf(row)).single()
        // grams x rate filled the amount, as the New order form does
        assertEquals(mapOf("description" to "Old ring", "value" to 100_000.0, "karat" to "22k", "weightG" to 5.0, "ratePerGram" to 20_000.0), PaymentText.exchangeJson(e))
        assertEquals(listOf("description", "value", "karat", "weightG", "ratePerGram"), PaymentText.exchangeJson(e).keys.toList())
    }

    @Test fun aBareRowCarriesOnlyWhatItIsAndItsAmount() {
        val row = applyExchangeRowChange(applyExchangeRowChange(blankExchangeRow(), ExchangeRowPatch(description = "Broken chain")), ExchangeRowPatch(value = "40000"))
        assertEquals(mapOf("description" to "Broken chain", "value" to 40_000.0), PaymentText.exchangeJson(exchangesFromRows(listOf(row)).single()))
    }

    @Test fun whatWasRecordedIsSaidAsCashGoldOrBoth() {
        val gold = listOf(mapOf<String, Any?>("description" to "Old ring", "value" to 100_000.0))
        assertEquals("PKR 50,000", PaymentText.advanceSaid(50_000.0, emptyList()))
        assertEquals("PKR 50,000 cash + PKR 100,000 gold", PaymentText.advanceSaid(50_000.0, gold))
        assertEquals("PKR 100,000 gold", PaymentText.advanceSaid(0.0, gold))
    }

    @Test fun aGoldAdvanceIsListedBeneathItsDayWithItsGold() {
        val gold = mapOf(
            "id" to "adv-x", "amount" to 20_000, "date" to "2026-10-09T05:00:00.000Z", "method" to "Cash", "notes" to "Second",
            "exchanges" to listOf(mapOf("description" to "Old ring", "karat" to "22k", "weightG" to 5, "ratePerGram" to 20_000, "value" to 100_000)),
        )
        val goldOnly = mapOf("id" to "adv-y", "amount" to 0, "date" to "2026-10-10T05:00:00.000Z", "exchanges" to listOf(mapOf("description" to "Chain", "value" to 30_000)))
        val o = order("advancePayment" to 20_000, "advances" to listOf(gold, goldOnly))
        val lines = OrdersLogic.advanceLines(o)
        assertEquals(2, lines.size)
        assertEquals(20_000.0, lines[0].amount)
        assertEquals(100_000.0, lines[0].goldValue)
        assertTrue(lines[0].gold.startsWith("Gold: Old ring"))
        assertTrue(lines[0].gold.endsWith("PKR 100,000"))
        assertEquals(0.0, lines[1].amount)
        assertEquals(30_000.0, lines[1].goldValue)
    }

    @Test fun aCashOnlyAdvanceHasNoGoldLine() {
        val o = order("advancePayment" to 5_000, "advanceMethod" to "Cash")
        val line = OrdersLogic.advanceLines(o).single()
        assertEquals("", line.gold)
        assertEquals(0.0, line.goldValue)
    }
}
