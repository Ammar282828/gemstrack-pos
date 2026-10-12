package erp.app.screens.rates

import erp.core.DocJSON
import erp.core.models.Settings
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RateKeysTests {
    private fun settings(vararg extra: Pair<String, Any?>): Settings =
        DocJSON.decode<Settings>("global", mapOf("goldRatePerGram21k" to 26_250, "goldRatePerGram24k" to 30_000, "silverRatePerGram" to 345.5) + extra)

    @Test fun aGoldHouseWatches21KAndFilesSilverUnderOtherMetals() {
        assertEquals("21K", RateKeys.main("gold").label)
        assertEquals(listOf("Gold", "Palladium", "Other metals"), RateKeys.groups("gold").map { it.title })
        assertEquals(listOf("Silver", "Platinum"), RateKeys.groups("gold").last().fields.map { it.label })
        assertEquals(
            listOf("goldRatePerGram24k", "goldRatePerGram22k", "goldRatePerGram21k", "goldRatePerGram18k"),
            RateKeys.groups("gold").first().fields.map { it.key },
        )
    }

    @Test fun aSilverHouseWatchesSilverAndLeadsWithIt() {
        assertEquals("Silver", RateKeys.main("silver").label)
        assertEquals("silverRatePerGram", RateKeys.main("silver").key)
        assertEquals(listOf("Silver", "Gold", "Palladium", "Other metals"), RateKeys.groups("silver").map { it.title })
        assertEquals(listOf("Per gram"), RateKeys.groups("silver").first().fields.map { it.label })
        assertEquals(listOf("Platinum"), RateKeys.groups("silver").last().fields.map { it.label })
        assertEquals("Left at zero, 18K and 12K palladium are priced from the flat rate.", RateKeys.groups("silver")[2].note)
    }

    @Test fun ratesAreSaidGroupedWithTheirPaisaAndAZeroIsADash() {
        assertEquals("26,250", RateKeys.say(26_250.0))
        assertEquals("345.5", RateKeys.say(345.5))
        assertEquals("345.57", RateKeys.say(345.567))
        assertEquals("—", RateKeys.shown(0.0))
        assertEquals("26,250", RateKeys.shown(26_250.0))
        assertEquals("26250", RateKeys.plain(26_250.0))
        assertEquals("345.5", RateKeys.plain(345.5))
    }

    @Test fun typedRatesReadTheDecimalPadsCommaAndKeepTwoDecimals() {
        assertEquals(26_250.0, RateKeys.parse("26,250"))
        assertEquals(345.5, RateKeys.parse("345,5"))
        assertEquals(345.55, RateKeys.parse("345,55"))
        assertEquals(26_250.0, RateKeys.parse(" 26 250 "))
        assertEquals(345.57, RateKeys.parse("345.567"))
        assertEquals(0.01, RateKeys.parse("0.005"))
        assertNull(RateKeys.parse(""))
        assertNull(RateKeys.parse("abc"))
        assertNull(RateKeys.parse("1,2,3x"))
    }

    @Test fun onlyWhatMovedIsSent() {
        val s = settings()
        val typed = mapOf(
            "goldRatePerGram21k" to "26,250", // unchanged
            "goldRatePerGram24k" to "30,500", // moved
            "goldRatePerGram18k" to "0", // not a real rate
            "silverRatePerGram" to "345.503", // within half a paisa of 345.5 once rounded: 345.5
            "platinumRatePerGram" to "", // left blank
        )
        val changed = RateKeys.changed("gold", typed, s)
        assertEquals(listOf("goldRatePerGram24k"), changed.map { it.key })
        assertEquals(mapOf("rates" to mapOf("goldRatePerGram24k" to 30_500.0)), RateKeys.payload(changed, typed, fromGoldPk = false))
    }

    @Test fun goldPkRatesAreSaidInTheLog() {
        val typed = mapOf("goldRatePerGram21k" to "26,400", "goldRatePerGram22k" to "27600.5")
        val changed = RateKeys.changed("gold", typed, settings())
        assertEquals(
            mapOf("rates" to mapOf("goldRatePerGram22k" to 27_600.5, "goldRatePerGram21k" to 26_400.0), "source" to "gold.pk"),
            RateKeys.payload(changed, typed, fromGoldPk = true),
        )
        assertEquals(listOf("goldRatePerGram22k", "goldRatePerGram21k"), changed.map { it.key })
    }

    @Test fun nothingTypedIsTheSameTodayAndSendsNoRates() {
        val changed = RateKeys.changed("gold", emptyMap(), settings())
        assertEquals(emptyList(), changed)
        assertEquals(mapOf("rates" to emptyMap<String, Any?>()), RateKeys.payload(changed, emptyMap(), false))
        // Without the settings loaded every real figure is a change from nothing.
        assertEquals(1, RateKeys.changed("gold", mapOf("goldRatePerGram21k" to "26000"), null).size)
    }

    @Test fun goldPkAnswersAreReadLeniently() {
        assertEquals(emptyMap(), goldPkRates(null))
        assertEquals(emptyMap(), goldPkRates(mapOf("goldRatePerGram24k" to 0)))
        assertEquals(
            mapOf("goldRatePerGram24k" to 30_100.0, "goldRatePerGram21k" to 26_400.0),
            goldPkRates(mapOf("goldRatePerGram24k" to 30_100, "goldRatePerGram21k" to 26_400.0, "goldRatePerGram22k" to "x")),
        )
    }

    @Test fun theSetLineSaysWhenAndByWhom() {
        assertEquals("not dated", rateSetLine(settings()))
        assertEquals("not dated · Ammar", rateSetLine(settings("ratesUpdatedBy" to "Ammar")))
        assertEquals("", rateSetLine(null).let { if (it == "not dated") "" else it })
    }
}
