package erp.core

import erp.core.logic.RateField
import erp.core.logic.finalizeRateRows
import erp.core.logic.finalizeRates
import erp.core.logic.orderInvoiceRates
import erp.core.logic.rateShown
import erp.core.models.Order
import erp.core.models.OrderItem
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals

/** The rates typed at Finalize (src/lib/order-finalize.test.ts, "finalizeRates" and "finalizeRateRows"). */
class OrderFinalizeRatesTests {
    private inline fun <reified T : Any> decode(fields: Map<String, Any?>): T = ERPDecode.model<T>(fields)!!

    private val settings: Settings = decode(
        mapOf(
            "goldRatePerGram21k" to 30000, "goldRatePerGram24k" to 35000, "silverRatePerGram" to 500,
            "goldRatePerGram22k" to 0, "goldRatePerGram18k" to 0, "palladiumRatePerGram" to 9000, "platinumRatePerGram" to 0,
        ),
    )
    private val order: Order = decode(mapOf("ratesApplied" to mapOf("goldRatePerGram21k" to 20000, "goldRatePerGram24k" to 24000)))

    private fun item(metal: String, karat: String? = null): OrderItem = decode(
        buildMap {
            put("description", "Piece"); put("metalType", metal); put("estimatedWeightG", 5); put("stoneWeightG", 0)
            if (karat != null) put("karat", karat)
        },
    )

    @Test fun noneTypedIsTheBookedRatesExactly() {
        assertEquals(orderInvoiceRates(order, settings), finalizeRates(order, settings))
        assertEquals(20000.0, finalizeRates(order, settings, emptyMap()).goldRatePerGram21k)
    }

    @Test fun positiveFiguresWinAndOthersAreIgnored() {
        val r = finalizeRates(order, settings, mapOf(RateField.GOLD_21K to 22500.0, RateField.GOLD_24K to 0.0, RateField.SILVER to -3.0))
        assertEquals(22500.0, r.goldRatePerGram21k)
        assertEquals(24000.0, r.goldRatePerGram24k)
        assertEquals(0.0, r.silverRatePerGram)
    }

    @Test fun aMetalTheOrderWasNotBookedWithCanBeAdded() {
        assertEquals(450.0, finalizeRates(order, settings, mapOf(RateField.SILVER to 450.0)).silverRatePerGram)
    }

    @Test fun rowsAreOnlyWhatIsInUseGoldFirstSilverLast() {
        val rows = finalizeRateRows(
            listOf(item("silver"), item("gold", "18k"), item("gold", "21k"), item("gold", "21k"), item("palladium", "12k"), item("platinum")),
        )
        assertEquals(
            listOf(RateField.GOLD_21K, RateField.GOLD_18K, RateField.PALLADIUM_12K, RateField.PLATINUM, RateField.SILVER),
            rows.map { it.field },
        )
        assertEquals("Silver (all-in)", rows.last().label)
    }

    @Test fun aPalladiumKaratWithNoRateOfItsOwnIsShownAtTheFlatOne() {
        val flat = erp.core.logic.PricingRates(palladiumRatePerGram = 9000.0)
        assertEquals(9000.0, rateShown(flat, RateField.PALLADIUM_18K))
        assertEquals(12000.0, rateShown(flat.copy(palladiumRatePerGram18k = 12000.0), RateField.PALLADIUM_18K))
    }
}
