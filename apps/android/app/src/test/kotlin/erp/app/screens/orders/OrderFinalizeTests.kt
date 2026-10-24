package erp.app.screens.orders

import erp.core.ERPDecode
import erp.core.logic.RateField
import erp.core.models.Order
import erp.core.models.Settings
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

// OrderFinalizeModel.swift: the dialog's figures as they are typed, priced by core at the rates the order was
// booked at, and the payload `finalizeOrder` takes key for key. Made-up amounts only.
class OrderFinalizeTests {
    private val settings: Settings = ERPDecode.model<Settings>(mapOf("id" to "global", "goldRatePerGram24k" to 40_000.0, "goldRatePerGram21k" to 35_000.0))!!

    private fun order(vararg changes: Pair<String, Any?>): Order = ERPDecode.model<Order>(
        mapOf(
            "id" to "ORD-5", "createdAt" to "2026-10-07T05:00:00.000Z", "status" to "Completed", "customerName" to "Sana Demo",
            "ratesApplied" to mapOf("goldRatePerGram21k" to 30_000.0, "goldRatePerGram24k" to 34_000.0),
            "items" to listOf(
                mapOf(
                    "description" to "Ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5.0, "wastagePercentage" to 10.0,
                    "makingCharges" to 2_000.0, "stoneCharges" to 500.0, "diamondCharges" to 0.0, "totalEstimate" to 190_000.0,
                ),
                mapOf("description" to "Fixed bangle", "metalType" to "gold", "isManualPrice" to true, "manualPrice" to 60_000.0, "totalEstimate" to 60_000.0),
            ),
        ) + changes,
    )!!

    @Test fun theDialogOpensOnTheOrdersOwnFigures() {
        val o = order()
        val a = OrderFinalizeRow.of(o.items[0], 0)
        assertEquals("5", a.weight)
        assertEquals("10", a.wastage)
        assertEquals("2000", a.making)
        assertEquals("500", a.stones)
        // Zero is a blank box, not a typed 0.
        assertEquals("", a.diamonds)
        assertEquals(false, a.manual)
        assertEquals("190000", a.price)
        val b = OrderFinalizeRow.of(o.items[1], 1)
        assertEquals(true, b.manual)
        assertEquals("60000", b.price)
        assertEquals(60_000.0, b.onOrder)
    }

    @Test fun thePieceIsPricedAtTheOrdersRatesAndTheFiguresTyped() {
        val o = order("advancePayment" to 20_000.0, "advanceInExchangeValue" to 5_000.0, "exchanges" to listOf(mapOf("description" to "Old ring", "value" to 5_000.0)))
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        val f = OrderFinalizeMath.figures(o, rows, "1,000", settings)
        // Ring: 5 g of 21k at 30,000 = 150,000, wastage 10% = 15,000, making 2,000, stones 500.
        assertEquals(167_500.0, f.prices[0])
        assertEquals(60_000.0, f.prices[1])
        assertEquals(227_500.0, f.subtotal)
        assertEquals(1_000.0, f.discount)
        assertEquals(5_000.0, f.exchange)
        assertEquals(20_000.0, f.advances)
        assertEquals(221_500.0, f.total)
        assertEquals(227_500.0 - 1_000.0 - 5_000.0 - 20_000.0, f.balance)
        // A heavier piece moves the price as it is typed.
        val heavier = rows.mapIndexed { i, r -> if (i == 0) r.copy(weight = "6") else r }
        assertEquals(167_500.0 + 30_000.0 + 3_000.0, OrderFinalizeMath.figures(o, heavier, "", settings).prices[0])
    }

    @Test fun theWastageGramsFollowTheWeightTyped() {
        val row = OrderFinalizeRow.of(order().items[0], 0)
        assertEquals(0.5, row.wastageGrams)
        assertEquals(0.6, row.copy(weight = "6").wastageGrams, 1e-9)
    }

    @Test fun aPricedPieceNeedsAWeightAndAFixedOneAPrice() {
        val o = order()
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        assertNull(OrderFinalizeMath.problem(rows, ""))
        assertEquals("Piece 1: weight must be a positive number.", OrderFinalizeMath.problem(listOf(rows[0].copy(weight = "")), ""))
        assertEquals("Piece 2: a fixed price needs the price.", OrderFinalizeMath.problem(listOf(rows[0], rows[1].copy(price = "0")), ""))
        assertEquals("Discount cannot be negative.", OrderFinalizeMath.problem(rows, "-5"))
    }

    @Test fun theRequestCarriesEveryKeyTheErpReads() {
        val o = order()
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        val req = OrderFinalizeMath.request(o.id, rows, "1000", "408000")
        assertEquals(setOf("orderId", "items", "additionalDiscount", "costRate24k"), req.keys)
        assertEquals("ORD-5", req["orderId"])
        assertEquals(1_000.0, req["additionalDiscount"])
        assertEquals(408_000.0 / erp.core.entry.NewOrderWords.gramsPerTola, req["costRate24k"])
        @Suppress("UNCHECKED_CAST")
        val items = req["items"] as List<Map<String, Any?>>
        assertEquals(
            setOf("description", "metalType", "finalWeightG", "finalWastagePercentage", "finalMakingCharges", "finalDiamondCharges", "finalStoneCharges", "isManualPrice", "finalManualPrice", "karat"),
            items[0].keys,
        )
        assertEquals("21k", items[0]["karat"])
        assertEquals("gold", items[0]["metalType"])
        assertEquals(5.0, items[0]["finalWeightG"])
        assertEquals(10.0, items[0]["finalWastagePercentage"])
        assertEquals(false, items[0]["isManualPrice"])
        // A piece with no karat sends none; a fixed price sends its price.
        assertTrue(!items[1].containsKey("karat"))
        assertEquals(true, items[1]["isManualPrice"])
        assertEquals(60_000.0, items[1]["finalManualPrice"])
    }

    @Test fun noTolaRateSendsNoCostRate() {
        val o = order()
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        assertTrue(!OrderFinalizeMath.request(o.id, rows, "", "").containsKey("costRate24k"))
        assertEquals(0.0, OrderFinalizeMath.request(o.id, rows, "", "")["additionalDiscount"])
    }

    @Test fun theConfirmationSaysTheTotalAndWhatIsLeft() {
        val o = order()
        val f = OrderFinalizeMath.Figures(subtotal = 100_000.0, discount = 0.0, exchange = 0.0, advances = 30_000.0, balance = 70_000.0)
        assertEquals(
            "ORD-5 becomes an invoice of PKR 100,000, PKR 70,000 still due. The order is then completed. Undoing it needs the delete code.",
            confirmWords(o, f),
        )
        val credit = f.copy(balance = -4_000.0)
        assertTrue(confirmWords(o, credit).contains("with PKR 4,000 in credit"))
    }

    // Rates typed at Finalize (the owner, 2026-10-24: "I don't have the option to change the per gram rate").

    @Test fun theRateBoxesOpenOnTheBookedRatesAndOnlyForWhatIsUsed() {
        val o = order()
        assertEquals(mapOf(RateField.GOLD_21K to "30000"), OrderFinalizeMath.bookedTexts(o, settings))
    }

    @Test fun aTypedRatePricesThePiecesAndOnlyAChangedOneIsSent() {
        val o = order()
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        // Untouched boxes change nothing.
        val booked = OrderFinalizeMath.bookedTexts(o, settings)
        assertEquals(167_500.0, OrderFinalizeMath.figures(o, rows, "", settings, booked).prices[0])
        assertTrue(OrderFinalizeMath.changedRates(o, settings, booked).isEmpty())
        assertTrue(!OrderFinalizeMath.request(o.id, rows, "", "", OrderFinalizeMath.changedRates(o, settings, booked)).containsKey("ratesApplied"))
        // 5 g of 21k at 35,000 = 175,000, wastage 10% = 17,500, making 2,000, stones 500.
        val typed = mapOf(RateField.GOLD_21K to "35,000")
        assertEquals(195_000.0, OrderFinalizeMath.figures(o, rows, "", settings, typed).prices[0])
        val changed = OrderFinalizeMath.changedRates(o, settings, typed)
        assertEquals(mapOf(RateField.GOLD_21K to 35_000.0), changed)
        assertEquals(mapOf("goldRatePerGram21k" to 35_000.0), OrderFinalizeMath.request(o.id, rows, "", "", changed)["ratesApplied"])
    }

    @Test fun useTodaysRatesFillsTheShopsOwnAndShowsOnlyWhenTheyDiffer() {
        val o = order()
        val booked = OrderFinalizeMath.bookedTexts(o, settings)
        assertTrue(OrderFinalizeMath.todayDiffers(o, settings, booked))
        val today = OrderFinalizeMath.todayTexts(o, settings)
        assertEquals(mapOf(RateField.GOLD_21K to "35000"), today)
        assertTrue(!OrderFinalizeMath.todayDiffers(o, settings, booked + today))
    }

    @Test fun aRateThatIsNotANumberIsRefused() {
        val o = order()
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        assertEquals("Gold 21k rate cannot be negative.", OrderFinalizeMath.problem(rows, "", o, mapOf(RateField.GOLD_21K to "-5")))
        assertEquals("The Gold 21k rate is not a number. Retype it, or clear it.", OrderFinalizeMath.problem(rows, "", o, mapOf(RateField.GOLD_21K to "12abc")))
        assertNull(OrderFinalizeMath.problem(rows, "", o, mapOf(RateField.GOLD_21K to "")))
    }

    @Test fun silverIsOneAllInRateThatCanBeTyped() {
        val o = order(
            "ratesApplied" to mapOf("silverRatePerGram" to 400.0),
            "items" to listOf(mapOf("description" to "Chain", "metalType" to "silver", "estimatedWeightG" to 10.0, "totalEstimate" to 4_000.0)),
        )
        val rows = o.items.mapIndexed { i, it -> OrderFinalizeRow.of(it, i) }
        assertEquals(mapOf(RateField.SILVER to "400"), OrderFinalizeMath.bookedTexts(o, settings))
        assertEquals(4_000.0, OrderFinalizeMath.figures(o, rows, "", settings, OrderFinalizeMath.bookedTexts(o, settings)).prices[0])
        assertEquals(4_500.0, OrderFinalizeMath.figures(o, rows, "", settings, mapOf(RateField.SILVER to "450")).prices[0])
    }
}
