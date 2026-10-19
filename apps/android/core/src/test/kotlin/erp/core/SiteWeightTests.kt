package erp.core

import erp.core.logic.postOnlyWeight
import erp.core.logic.validWeight
import erp.core.logic.weightForSite
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/lib/website/site-weight.test.ts's cases (SiteWeightTests.swift): a new upload reads as taheri.shop's own, the source counts. */
class SiteWeightTests {
    @Test fun keepsATypedWeightForTaheriShopsOwnPhotographThatHasNoneToTwoPlaces() {
        assertEquals(3.84, weightForSite("attributes", null, "3.84"))
        assertEquals(12.0, weightForSite("attributes", null, " 12 "))
        assertEquals(5.46, weightForSite("attributes", null, "5.4567"))
    }

    @Test fun neverChangesAWeightTheSiteAlreadyHas() {
        assertNull(weightForSite("attributes", 4.1, "4.2"))
    }

    @Test fun leavesTheCataloguesPiecesAloneAndAnythingNotAWeight() {
        assertNull(weightForSite("pieces", null, "3.84"))
        assertNull(weightForSite(null, null, "3.84"))
        for (w in listOf("", "0", "0.0", "abc", "3.", "-2")) assertNull(weightForSite("attributes", null, w), w)
    }

    @Test fun isThePostsOwnOnlyWhenTheSiteHasAWeightAndADifferentOneIsTyped() {
        assertFalse(postOnlyWeight(4.2, "4.2"))
        assertFalse(postOnlyWeight(4.2, "4.20"))
        assertTrue(postOnlyWeight(4.2, "4.35"))
        assertFalse(postOnlyWeight(null, "4.35"))
        assertFalse(postOnlyWeight(4.2, ""))
    }

    @Test fun takesAPositiveNumberAsTyped() {
        assertTrue(validWeight("3.84"))
        assertFalse(validWeight("0"))
        assertFalse(validWeight("3."))
    }
}
