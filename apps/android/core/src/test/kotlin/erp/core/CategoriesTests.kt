package erp.core

import erp.core.logic.categoryShareText
import erp.core.logic.guessCategory
import erp.core.logic.lineCategory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** src/lib/categories.test.ts, case for case (CategoriesTests.swift). */
class CategoriesTests {
    @Test fun lineCategoryOwnThenOrdersThenName() {
        assertEquals("cat001", lineCategory("cat001", "cat007", "Bangle"))
        assertEquals("cat007", lineCategory("", "cat007", "Ring"))
        assertEquals("cat001", lineCategory("", null, "Cat’s eye ring"))
        assertNull(lineCategory(null, null, "Custom from sample"))
    }

    @Test fun guessCategory() {
        val cases = listOf(
            "Necklace" to "cat013", "Jhumki" to "cat002", "2 Pairs Custom Earrings" to "cat002", "String Set" to "cat012",
            "Multi Colour Bangle & Ring" to "cat006", "CNC bangles" to "cat007", "6 bangle stack" to "cat007", "CNC band" to "cat009",
            "ruby lari bracelet" to "cat005", "Plain Gold Loose Bracelet" to "cat019", "Plain Gold ‘H’ Locket" to "cat004",
            "Pink Ruby Ring" to "cat001", "Men's Ring" to "cat018", "ARY 1g" to "cat017", "Multi Stone Thakti" to "cat004",
            "Earrings and Necklace NN" to "cat013", "Plain Gold" to null, "Use onyx" to null,
        )
        for ((name, want) in cases) assertEquals(want, guessCategory(name), name)
        assertNull(guessCategory(null))
        assertNull(guessCategory("  "))
    }

    @Test fun shareText() {
        assertEquals("32%", categoryShareText(0.32))
        assertEquals("10%", categoryShareText(0.1))
        assertEquals("0.7%", categoryShareText(0.007))
        assertEquals("0.0%", categoryShareText(0.0))
    }
}
