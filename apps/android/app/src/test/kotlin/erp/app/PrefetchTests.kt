package erp.app

import erp.app.data.Prefetch
import org.junit.Test
import kotlin.test.assertEquals

/** What the launch warms (Prefetch.routes): only what the role may read and the house has. */
class PrefetchTests {
    @Test fun ownerWarmsOverheadsAndTheWebsiteReport() {
        assertEquals(listOf("/api/app/overheads", "/api/website/analytics?range=30d"), Prefetch.routes("owner", websiteSelling = true, shopifyAnalytics = null))
    }

    @Test fun shopifyReportOnlyWhereTheErpSaysSo() {
        assertEquals(
            listOf("/api/app/overheads", "/api/website/analytics?range=30d", "/api/website/shopify-analytics?range=30d&compare=1"),
            Prefetch.routes("owner", websiteSelling = true, shopifyAnalytics = true),
        )
    }

    @Test fun staffWarmsNothingAndMarketingOnlyTheWebsite() {
        assertEquals(emptyList(), Prefetch.routes("staff", websiteSelling = true, shopifyAnalytics = true))
        assertEquals(listOf("/api/website/analytics?range=30d"), Prefetch.routes("marketing", websiteSelling = true, shopifyAnalytics = false))
    }

    @Test fun aHouseWithoutAWebsiteSkipsIt() {
        assertEquals(listOf("/api/app/overheads"), Prefetch.routes("owner", websiteSelling = false, shopifyAnalytics = null))
    }
}
