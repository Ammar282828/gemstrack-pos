package erp.app.screens.neworder

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Piece entry (decisions.md "Piece entry"): the suggestion chips under a description, the stone combos worded with the category, the wastage
// chips, and the catalogue's answer. Plain Kotlin; made-up descriptions.
class DescribeTests {
    private fun e(text: String, count: Int, category: String, last: String = "2026-10-01") = DescribeEntry(text, count, last, category)

    private val history = listOf(
        e("Ruby ring", 9, "cat001"), e("Diamond ring", 7, "cat001"), e("Plain band", 3, "cat001"),
        e("Pearl earrings", 8, "cat003"), e("Ruby pendant", 4, "cat002"),
    )
    private val combos = listOf("Ruby & diamond", "Emerald")

    @Test fun anEmptyFieldOffersThisCategorysTopOnesThenTheCombosWordedWithIt() {
        val out = DescribeLogic.compute("", "cat001", history, combos).map { it.text }
        assertEquals(listOf("Ruby ring", "Diamond ring", "Plain band", "Ruby & diamond ring", "Emerald ring"), out)
    }

    @Test fun otherCategoriesJoinOnlyWhileSomethingIsTyped() {
        val out = DescribeLogic.compute("ruby", "cat001", history, combos).map { it.text }
        assertEquals(listOf("Ruby ring", "Ruby & diamond ring", "Ruby pendant"), out)
        assertFalse(DescribeLogic.compute("", "cat001", history, combos).any { it.text == "Pearl earrings" })
    }

    @Test fun everyWordTypedMustBeInIt() {
        val out = DescribeLogic.compute("ring dia", "cat001", history, combos).map { it.text }
        assertEquals(listOf("Diamond ring", "Ruby & diamond ring"), out)
    }

    @Test fun whatIsAlreadyTypedIsNotOffered() {
        assertTrue(DescribeLogic.compute("ruby ring", "cat001", history, combos).none { it.text == "Ruby ring" })
    }

    @Test fun thoseThatStartWithWhatIsTypedLeadTheirGroup() {
        val rows = listOf(e("Gold ruby ring", 20, "cat001"), e("Ruby ring", 2, "cat001"))
        assertEquals(listOf("Ruby ring", "Gold ruby ring"), DescribeLogic.compute("ruby", "cat001", rows, emptyList()).map { it.text })
    }

    @Test fun noMoreThanEightChips() {
        val many = (1..30).map { e("Piece $it", 100 - it, "cat001") }
        assertEquals(DescribeLogic.LIMIT, DescribeLogic.compute("", "cat001", many, emptyList()).size)
    }

    @Test fun aComboIsWordedWithTheCategorysSingular() {
        assertEquals("Ruby & diamond ring", DescribeLogic.compose("ruby & diamond", "ring"))
        assertEquals("Emerald", DescribeLogic.compose("emerald", ""))
        assertEquals("Pearl ring", DescribeLogic.compose("Pearl ring", "ring"), "already ends in the word")
        assertEquals("", DescribeLogic.compose("  ", "ring"))
    }

    @Test fun theSheetJoinsTappedStonesAndTypedWords() {
        assertEquals("Ruby & diamond", DescribeLogic.combo(listOf("Ruby", "Diamond"), ""))
        assertEquals("Pearl & zircon", DescribeLogic.combo(listOf("Pearl"), " zircon "))
        assertEquals("Ruby & Pearl & Zircon", DescribeLogic.combo(listOf("Ruby"), "Pearl, Zircon"), "typed words keep their case")
        assertEquals("", DescribeLogic.combo(emptyList(), " , "))
    }

    @Test fun theAnswerIsReadLeniently() {
        val p = DescribeLogic.parse(
            """{"history":[{"text":"Ruby ring","count":2,"lastAt":"2026-10-02","category":"cat001"},{"text":"  ","count":9},{"text":"Pearl set","lastAt":5},
               {"text":"Ruby ring Two","count":2,"lastAt":"2026-10-09","category":"cat001"}],"combos":["Ruby","ruby","  ","Pearl"]}""",
        )
        assertEquals(listOf("Ruby ring Two", "Ruby ring", "Pearl set"), p.history.map { it.text }, "most used first, then newest")
        assertEquals(1, p.history.first { it.text == "Pearl set" }.count)
        assertEquals("5", p.history.first { it.text == "Pearl set" }.lastAt)
        assertEquals(listOf("Ruby", "Pearl"), p.combos)
        assertTrue(DescribeLogic.parse("not json").history.isEmpty())
    }

    // MARK: Wastage

    @Test fun wastageChipsKnowTheirFourPresets() {
        assertEquals(listOf(10, 12, 15, 25), WastagePicks.presets)
        assertEquals(12, WastagePicks.preset("12"))
        assertEquals(15, WastagePicks.preset(" 15.0 "))
        assertNull(WastagePicks.preset("13"))
        assertNull(WastagePicks.preset(""))
    }

    @Test fun otherShowsItsFieldsForAnythingOffTheListAndStaysOpenWhileTyped() {
        assertFalse(WastagePicks.reveals("12", false))
        assertTrue(WastagePicks.reveals("13", false))
        assertTrue(WastagePicks.reveals("", false), "a blank percentage is Other's to fill")
        assertTrue(WastagePicks.reveals("12", true), "typing 12 in Other never flips the row back")
    }

    // MARK: The catalogue

    @Test fun theCataloguePathAsksForTheCategoryAndTheSearch() {
        assertEquals("/api/app/catalogue", CatalogueStore.path("", ""))
        assertEquals("/api/app/catalogue?category=cat001", CatalogueStore.path("cat001", ""))
        assertEquals("/api/app/catalogue?category=cat001&q=ruby+ring", CatalogueStore.path("cat001", "ruby ring"))
        assertEquals("/api/app/catalogue?q=a%26b", CatalogueStore.path("", "a&b"))
    }

    @Test fun theCatalogueAnswerKeepsOnlyPicturesWithAnAddress() {
        val pieces = CatalogueStore.parse(
            """{"pieces":[{"id":"p1","title":"Ruby ring","category":"cat001","image":"https://shop.example/a.jpg","thumb":"https://shop.example/a-s.jpg"},
               {"id":"p2","title":"No thumb","image":"https://shop.example/b.jpg"},{"id":"p3","title":"No picture"},{"title":"Thumb only","thumb":"https://shop.example/c-s.jpg"}]}""",
        )
        assertEquals(listOf("p1", "p2", "https://shop.example/c-s.jpg"), pieces.map { it.id })
        assertEquals("https://shop.example/b.jpg", pieces[1].thumb, "a missing thumb is the picture")
        assertEquals("https://shop.example/c-s.jpg", pieces[2].image, "a missing picture is the thumb")
        assertTrue(CatalogueStore.parse("[]").isEmpty())
    }
}
