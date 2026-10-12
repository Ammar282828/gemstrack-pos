package erp.core

import erp.core.logic.MainRate
import erp.core.logic.RATE_KEYS
import erp.core.logic.RateInputKey
import erp.core.logic.RateKey
import erp.core.logic.RateValues
import erp.core.logic.changedRates
import erp.core.logic.mainRate
import erp.core.logic.rates
import erp.core.logic.ratesSetToday
import erp.core.logic.ratesToKeep
import erp.core.logic.values
import erp.core.logic.whenSet
import erp.core.models.MetalType
import erp.core.models.Rates
import erp.core.models.Settings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/lib/rates.test.ts, case for case (the file under test is logic/RatesLogic.kt). */
class RatesTests {
    private val current: RateValues = mapOf(RateKey.goldRatePerGram21k to 26_000.0, RateKey.goldRatePerGram18k to 22_000.0, RateKey.silverRatePerGram to 250.0)

    private fun keep(
        isNew: Boolean = true,
        typed: Set<RateInputKey> = emptySet(),
        inputs: Map<RateInputKey, String> = emptyMap(),
        metals: Set<MetalType> = setOf(MetalType.gold),
    ): RateValues? = ratesToKeep(isNew = isNew, typed = typed, inputs = inputs, metals = metals, current = current)

    // MARK: what a saved invoice writes back to the shop's rates

    @Test
    fun testAnEditedInvoiceWritesNothingItCarriesItsOwnOldRates() {
        assertNull(keep(isNew = false, typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "24000")))
    }

    @Test
    fun testANewInvoiceWritesOnlyTheBoxesTypedByHand() {
        assertEquals(
            mapOf(RateKey.goldRatePerGram21k to 26_250.0),
            keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "26250.00", RateInputKey.gold18k to "21000")),
        )
    }

    @Test
    fun testNothingTypedWritesNothing() {
        assertNull(keep(inputs = mapOf(RateInputKey.gold21k to "24000")))
    }

    @Test
    fun testSkipsAMetalTheSaleDoesNotCarryABlankOrZeroBoxAndAnUnchangedFigure() {
        assertNull(keep(typed = setOf(RateInputKey.silver), inputs = mapOf(RateInputKey.silver to "260")))
        assertNull(keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "")))
        assertNull(keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "0")))
        assertNull(keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "26000.00")))
    }

    // Not in the TS tests: parseFloat reads the number a box starts with, and a rate with no
    // figure stored yet (nothing to differ from) counts as 0.
    @Test
    fun testABoxIsReadTheWayParseFloatReadsIt() {
        assertEquals(mapOf(RateKey.goldRatePerGram21k to 26_300.0), keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to " 26300abc")))
        assertNull(keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "abc")))
        assertNull(keep(typed = setOf(RateInputKey.gold21k), inputs = mapOf(RateInputKey.gold21k to "-5")))
        assertEquals(mapOf(RateKey.goldRatePerGram22k to 27_000.0), keep(typed = setOf(RateInputKey.gold22k), inputs = mapOf(RateInputKey.gold22k to "27000")))
    }

    // MARK: the rate a house watches

    @Test
    fun testIs21KForGoldAndSilverForSilver() {
        assertEquals(MainRate(key = RateKey.goldRatePerGram21k, label = "21K"), mainRate(MetalType.gold))
        assertEquals(MainRate(key = RateKey.silverRatePerGram, label = "Silver"), mainRate(MetalType.silver))
    }

    @Test
    fun testAChangeCountsOnlyTheRatesThatMove() {
        assertEquals(listOf(RateKey.goldRatePerGram18k), changedRates(mapOf(RateKey.goldRatePerGram21k to 26_000.0, RateKey.goldRatePerGram18k to 21_500.0), current))
        assertEquals(emptyList(), changedRates(emptyMap(), current))
        // Answered in RATE_KEYS' order, however the patch lists them.
        assertEquals(
            listOf(RateKey.goldRatePerGram24k, RateKey.goldRatePerGram18k, RateKey.silverRatePerGram),
            changedRates(mapOf(RateKey.silverRatePerGram to 300.0, RateKey.goldRatePerGram24k to 1.0, RateKey.goldRatePerGram18k to 1.0), current),
        )
    }

    @Test
    fun testTheRatesOfASaleAndOfTheSettingsAsKeyedValues() {
        val sale = ERPDecode.model<Rates>(mapOf("goldRatePerGram21k" to 23_000, "silverRatePerGram" to 250))!!
        assertEquals(mapOf(RateKey.goldRatePerGram21k to 23_000.0, RateKey.silverRatePerGram to 250.0), sale.values)
        assertEquals(emptyMap(), Rates().values)
        val settings = ERPDecode.model<Settings>(mapOf("goldRatePerGram24k" to 26_000))!!
        assertEquals(26_000.0, settings.rates[RateKey.goldRatePerGram24k])
        assertEquals(0.0, settings.rates[RateKey.silverRatePerGram])
        assertEquals(9, RATE_KEYS.size)
        assertEquals(MetalType.silver, RateKey.silverRatePerGram.metal)
        assertEquals(RateKey.palladiumRatePerGram12k, RateInputKey.palladium12k.rateKey)
    }

    // MARK: when the rate was set, in Karachi

    private val now = ERPDate.parse("2026-10-01T10:00:00Z")!! // 15:00 in Karachi

    @Test
    fun testTodayIsKarachisTodayNotUTCs() {
        assertTrue(ratesSetToday("2026-09-30T19:30:00Z", now = now)) // 00:30 on the 1st in Karachi
        assertFalse(ratesSetToday("2026-09-30T18:30:00Z", now = now)) // 23:30 on the 30th
        assertFalse(ratesSetToday(null, now = now))
        assertFalse(ratesSetToday("nonsense", now = now))
    }

    @Test
    fun testReadsAsATimeTodayAWeekdayThisWeekADateBefore() {
        assertEquals("9:40", whenSet("2026-10-01T04:40:00Z", now = now)) // 21K 26,250 · 9:40 by the owner
        assertEquals("Tue 9:40", whenSet("2026-09-29T04:40:00Z", now = now))
        assertTrue(whenSet("2026-09-20T04:40:00Z", now = now).startsWith("20 Sep")) // the browser's ICU: Sep or Sept
        assertEquals("not dated", whenSet(null, now = now))
    }

    // Not in the TS tests: the 24-hour clock the browser prints, an unpadded hour, and the
    // edge of the week.
    @Test
    fun testTheClockIsTwentyFourHourWithAnUnpaddedHour() {
        assertEquals("0:30", whenSet("2026-09-30T19:30:00Z", now = now))
        assertEquals("12:05", whenSet("2026-10-01T07:05:00Z", now = now))
        assertEquals("10:59", whenSet("2026-10-01T05:59:00Z", now = now))
        assertEquals("23:59", whenSet("2026-10-01T18:59:00Z", now = ERPDate.parse("2026-10-01T18:59:30Z")!!))
        assertEquals("not dated", whenSet("garbage", now = now))
        // Within six days a weekday; the sixth day back is a date.
        assertEquals("Sat 9:40", whenSet("2026-09-26T04:40:00Z", now = now))
        assertEquals("25 Sept", whenSet("2026-09-25T04:40:00Z", now = now))
        assertEquals("5 Jun", whenSet("2026-06-05T04:40:00Z", now = now))
    }
}
