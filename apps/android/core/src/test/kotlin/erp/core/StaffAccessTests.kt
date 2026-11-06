package erp.core

import erp.core.logic.StaffAccess
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/staff-pages.test.ts and roles.test.ts, case for case. */
class StaffAccessTests {
    @Test fun staffGoHomeFromBooksAnalyticsSettingsAndStock() {
        for (p in listOf("/analytics", "/analytics/sales", "/expenses", "/hisaab/abc", "/settings/shop", "/overheads", "/products", "/products/bulk-add", "/today", "/ads/campaigns", "/insights", "/website/interest", "/ads/setup")) {
            assertTrue(StaffAccess.staffBlocked(p, false), p)
        }
    }

    @Test fun staffMayWork() {
        for (p in listOf("/", "/orders", "/orders/ORD-1", "/invoices/new", "/customers/abc", "/workshop", "/karigars/k1", "/posts", "/design", "/website/photos", "/products/RIN-000001", "/calendar", "/drafts", "/repairs", "/help")) {
            assertFalse(StaffAccess.staffBlocked(p, false), p)
        }
    }

    @Test fun alsoMarketingOpensAdsInsightsVisitorsButNeverSetupOrSettings() {
        for (p in listOf("/ads/campaigns", "/ads/new", "/insights/posts", "/website/interest/live")) assertFalse(StaffAccess.staffBlocked(p, true), p)
        for (p in listOf("/ads/setup", "/ads/audiences", "/ads/rules", "/ads/tests", "/settings", "/analytics")) assertTrue(StaffAccess.staffBlocked(p, true), p)
    }

    @Test fun aQueryIsIgnored() {
        assertTrue(StaffAccess.staffBlocked("/analytics?range=30d", false))
        assertFalse(StaffAccess.staffBlocked("/repairs?new=1", false))
        assertTrue(StaffAccess.within("/orders/1", "/orders"))
        assertFalse(StaffAccess.within("/orders-old", "/orders"))
    }

    @Test fun rolesSeeMoneyAndSpend() {
        assertTrue(StaffAccess.seesMoney("owner"))
        for (r in listOf("staff", "marketing", "karigar", "none")) assertFalse(StaffAccess.seesMoney(r), r)
        assertTrue(StaffAccess.spendHidden("staff", true))
        assertFalse(StaffAccess.spendHidden("staff", false))
        assertFalse(StaffAccess.spendHidden("marketing", true))
        assertFalse(StaffAccess.spendHidden("owner", true))
        assertTrue(StaffAccess.marketingAccess("staff", true))
        assertFalse(StaffAccess.marketingAccess("staff", false))
        assertTrue(StaffAccess.marketingAccess("marketing", false))
        assertEquals(500, StaffAccess.DEFAULT_PAUSED_BUDGET)
    }
}
