package erp.app

import erp.app.nav.AppRouter
import erp.app.nav.ScreenRegistry
import erp.app.nav.ScreenRoute
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoutingTests {
    private val routes = listOf(
        ScreenRoute.exact("/orders") {},
        ScreenRoute.item("/orders/") {},
    )

    @Test fun exactIgnoresTheQuery() {
        val r = ScreenRoute.exact("/orders") {}
        assertTrue(r.matches("/orders"))
        assertTrue(r.matches("/orders?tab=late"))
        assertFalse(r.matches("/orders/ORD-000123"))
        assertFalse(r.matches("/orders2"))
    }

    @Test fun itemTakesOneSegmentAfterThePrefix() {
        val r = ScreenRoute.item("/orders/") {}
        assertTrue(r.matches("/orders/ORD-000123"))
        assertTrue(r.matches("/orders/ORD-000123?x=1"))
        assertFalse(r.matches("/orders/"))
        assertFalse(r.matches("/orders/ORD-000123/edit"))
        assertFalse(r.matches("/orders"))
    }

    @Test fun anIdIsPercentDecoded() {
        assertEquals("a b/c", ScreenRoute.percentDecode("a%20b%2Fc"))
        assertEquals("Zoë", ScreenRoute.percentDecode("Zo%C3%AB"))
        // a plus stays a plus (removingPercentEncoding), and a bad escape leaves the text as it was
        assertEquals("a+b", ScreenRoute.percentDecode("a+b"))
        assertEquals("100%", ScreenRoute.percentDecode("100%"))
        assertEquals("%zz", ScreenRoute.percentDecode("%zz"))
    }

    @Test fun webFlagAsksForTheErpsOwnPage() {
        assertTrue(ScreenRegistry.wantsWeb("/orders/ORD-1?web=1"))
        assertTrue(ScreenRegistry.wantsWeb("/orders/ORD-1?a=b&web=1"))
        assertFalse(ScreenRegistry.wantsWeb("/orders/ORD-1"))
        assertFalse(ScreenRegistry.wantsWeb("/orders/ORD-1?web=0"))
        assertFalse(ScreenRegistry.wantsWeb("/orders/ORD-1?webx=1"))
    }

    @Test fun theFlagComesOffForThePage() {
        assertEquals("/orders/ORD-1", ScreenRegistry.withoutWebFlag("/orders/ORD-1?web=1"))
        assertEquals("/orders/ORD-1?a=b", ScreenRegistry.withoutWebFlag("/orders/ORD-1?web=1&a=b"))
        assertEquals("/orders/ORD-1?a=b", ScreenRegistry.withoutWebFlag("/orders/ORD-1?a=b&web=1"))
        assertEquals("/orders/ORD-1", ScreenRegistry.withoutWebFlag("/orders/ORD-1"))
        assertEquals("/x#top", ScreenRegistry.withoutWebFlag("/x?web=1#top"))
    }

    @Test fun nativeOnlyWhereARouteMatchesAndTheWebIsNotAsked() {
        assertTrue(ScreenRegistry.hasNative("/orders", routes))
        assertTrue(ScreenRegistry.hasNative("/orders/ORD-1", routes))
        assertFalse(ScreenRegistry.hasNative("/orders/ORD-1?web=1", routes), "edit, refund, print: the ERP's page")
        assertFalse(ScreenRegistry.hasNative("/orders/ORD-1/edit", routes), "a path the ERP serves itself falls through")
        assertFalse(ScreenRegistry.hasNative("/stock", routes))
        assertFalse(ScreenRegistry.hasNative("/", emptyList()))
    }

    @Test fun anAppLinkOfTheErpHostOpensItsPath() {
        val host = "erp.example.test"
        assertEquals("/orders/ORD-1", AppRouter.pathFor("https", host, "/orders/ORD-1", null, host))
        assertEquals("/orders?tab=late", AppRouter.pathFor("https", host, "/orders", "tab=late", host))
        assertEquals("/", AppRouter.pathFor("https", host, "", null, host))
        assertNull(AppRouter.pathFor("https", "elsewhere.test", "/orders", null, host))
        assertNull(AppRouter.pathFor("http", host, "/orders", null, host))
        assertNull(AppRouter.pathFor("market", host, "/orders", null, host))
    }

    @Test fun theAppsOwnAddressNamesAPath() {
        val host = "erp.example.test"
        assertEquals("/orders/ORD-1", AppRouter.pathFor("erp", "orders", "/ORD-1", null, host))
        assertEquals("/orders/ORD-1", AppRouter.pathFor("erp", null, "/orders/ORD-1", null, host))
        assertEquals("/invoices?x=1", AppRouter.pathFor("erp", "invoices", "", "x=1", host))
    }
}
