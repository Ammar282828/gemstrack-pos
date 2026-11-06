package erp.core

import erp.core.logic.HelpGuides
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The Help page's guides (src/app/help/page.tsx) and who sees which. */
class HelpGuidesTests {
    private fun titles(q: String, marketing: Boolean) = HelpGuides.shown("TAHERI", "Gold", q, marketing).flatMap { it.guides }.map { it.title }

    @Test fun staffWithoutMarketingGetNoMarketingSection() {
        val s = HelpGuides.shown("MINA", "Silver", "", false)
        assertEquals(listOf("Selling", "Orders", "Repairs", "Workshop", "Customers"), s.map { it.section })
        assertTrue(s.flatMap { it.guides }.none { it.marketing })
    }

    @Test fun marketingGuidesForOwnersMarketingAndStaffWhoAlsoRunIt() {
        assertTrue(HelpGuides.hasMarketing("owner", false))
        assertTrue(HelpGuides.hasMarketing("marketing", false))
        assertTrue(HelpGuides.hasMarketing("staff", true))
        assertFalse(HelpGuides.hasMarketing("staff", false))
        assertTrue(HelpGuides.shown("MINA", "Silver", "", true).any { it.section == "Marketing" })
    }

    @Test fun everyWordMustMatchAndMarketingStaysOutOfStaffsSearch() {
        assertEquals(listOf("Take in a repair", "Repair ready and collected"), titles("repair", false).take(2))
        assertEquals(listOf("Add photos of pieces to the website", "Edit a piece on the website"), titles("photos", true))
        assertTrue(titles("photos", false).isEmpty())
        assertTrue(titles("payment zzzz", true).isEmpty())
        assertTrue("Take a payment on an invoice" in titles("record a payment", false))
    }

    @Test fun theShopAndMetalAreSpokenInTheGuides() {
        val send = HelpGuides.all("House of Mina", "Silver").flatMap { it.guides }.first { it.id == "send" }
        assertTrue(send.steps.any { "House of Mina's own number" in it })
        val photos = HelpGuides.all("House of Mina", "Silver").flatMap { it.guides }.first { it.id == "photos" }
        assertTrue(photos.steps.any { "silver weight" in it })
    }
}
