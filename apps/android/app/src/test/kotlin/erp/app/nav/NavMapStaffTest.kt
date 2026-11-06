package erp.app.nav

import java.io.File
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * NavMap.visible(role, alsoMarketing) against src/lib/nav.ts `forRole` as exported to nav-<house>.json (the 2026-11-05 staff access
 * change: Analytics has no staff tab, Help is Home's, staff who also run marketing get the Marketing group without the configuring pages).
 */
class NavMapStaffTest {
    private fun map(house: String): NavMap {
        val file = listOf("../../iphone/App/Resources/nav-$house.json", "apps/iphone/App/Resources/nav-$house.json").map(::File).first { it.exists() }
        return assertNotNull(NavMap.parse(file.readText()))
    }

    private fun hrefs(m: NavMap): Set<String> = m.entries.flatMap { listOf(it.href) + (it.tabs ?: emptyList()).map { t -> t.href } + (it.pages ?: emptyList()).map { p -> p.href } }.toSet()

    @Test fun staffHaveHelpAndNoAnalyticsOrWebsiteVisitors() {
        for (house in listOf("mina", "taheri")) {
            val staff = map(house).visible("staff")
            val all = hrefs(staff)
            assertTrue("/help" in all, house)
            assertTrue("/calendar" in all)
            assertFalse(staff.entries.any { it.id == "analytics" }, "$house: Analytics leaves staff")
            for (gone in listOf("/analytics", "/website/interest", "/website/interest/live", "/insights", "/ads", "/ads/campaigns", "/today", "/expenses", "/hisaab")) {
                assertFalse(gone in all, "$house: $gone")
            }
            assertNull(staff.settings)
            assertNull(staff.newSale)
        }
    }

    @Test fun staffWhoAlsoRunMarketingGetMarketingAndInsightsButNoSetup() {
        val m = map("mina").visible("staff", alsoMarketing = true)
        val all = hrefs(m)
        for (there in listOf("/help", "/orders", "/posts", "/design", "/website/photos", "/ads/campaigns", "/ads/new", "/insights", "/website/interest", "/website/interest/live", "/ads")) {
            assertTrue(there in all, there)
        }
        for (gone in listOf("/ads/setup", "/ads/audiences", "/ads/rules", "/ads/tests", "/analytics", "/today", "/expenses", "/hisaab", "/products")) {
            assertFalse(gone in all, gone)
        }
        // Analytics shows her only its marketing sections, never the Sales ones.
        val analytics = m.entries.first { it.id == "analytics" }
        assertTrue((analytics.tabs ?: emptyList()).all { it.marketing == true })
        assertNull(m.settings)
    }

    @Test fun marketingAccountKeepsItsAdsSetupAndOwnersEverything() {
        val base = map("mina")
        assertTrue("/ads/setup" in hrefs(base.visible("marketing")))
        assertEquals(base.entries.size, base.visible("owner").entries.size)
        // alsoMarketing means nothing to anyone but staff.
        assertEquals(hrefs(base.visible("owner")), hrefs(base.visible("owner", alsoMarketing = true)))
        assertEquals(hrefs(base.visible("marketing")), hrefs(base.visible("marketing", alsoMarketing = true)))
    }
}
