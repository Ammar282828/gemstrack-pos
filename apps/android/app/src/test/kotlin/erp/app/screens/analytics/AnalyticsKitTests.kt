package erp.app.screens.analytics

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The redesign's small words and rules (components/analytics/kit.tsx `deltaOf`, `DeltaPill`). */
class AnalyticsKitTests {
    @Test fun aDeltaIsTheChangeInPercentAgainstTheAbsoluteBefore() {
        val up = anaDelta(110.0, 100.0)!!
        assertEquals(10.0, up.pct, 1e-9)
        assertTrue(up.better)
        // A loss that shrank is a rise from a negative: (−50 − −100) / 100 = +50%.
        assertEquals(50.0, anaDelta(-50.0, -100.0)!!.pct, 1e-9)
        assertFalse(anaDelta(90.0, 100.0)!!.better)
    }

    @Test fun nothingToCompareWithGivesNoDelta() {
        assertNull(anaDelta(5.0, null))
        assertNull(anaDelta(5.0, 0.0))
    }

    @Test fun lessIsBetterWhereTheFigureSaysSo() {
        val d = anaDelta(80.0, 100.0, upIsGood = false)!!
        assertEquals(-20.0, d.pct, 1e-9)
        assertTrue(d.better)
    }

    @Test fun theWordsCarryTheArrowThePercentAndWhatItIsAgainst() {
        assertEquals("▲ 10% vs last month", anaDeltaWords(AnaDelta(10.0, true), "last month"))
        assertEquals("▼ 4.5% vs last year", anaDeltaWords(AnaDelta(-4.5, false), "last year"))
        assertEquals("▬ No change vs the day before", anaDeltaWords(AnaDelta(0.2, true), "the day before"))
        assertEquals("▲ 999+% vs last month", anaDeltaWords(AnaDelta(5000.0, true), "last month"))
        assertNotNull(AnaSection.valueOf("metal"))
    }

    @Test fun karatsKeepTheirColoursByNameNotRank() {
        // Slots 1 to 6 in a fixed order: 24k, 22k, 21k, 18k, 12k, anything else.
        assertEquals(listOf(1, 2, 3, 4, 5, 6, 6), listOf("24k", "22K", "21k", "18k", "12k", "14k", "unknown").map { karatSlot(it) })
    }

    @Test fun percentsAndPluralsAreSaidTheWebsWay() {
        assertEquals(33, anaPercent(1.0, 3.0))
        assertEquals(0, anaPercent(1.0, 0.0))
        assertEquals("1 new customer", anaPlural(1, "new customer"))
        assertEquals("3 coins", anaPlural(3, "coin"))
        assertEquals("−" + erp.core.logic.Money.pkrLac(200000.0), anaSignedLac(-200000.0))
        assertEquals("+" + erp.core.logic.Money.pkrLac(200000.0), anaSignedLac(200000.0))
    }
}
