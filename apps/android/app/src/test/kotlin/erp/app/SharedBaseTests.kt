package erp.app

import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.device.shareFileName
import erp.app.nav.ScreenRegistry
import erp.core.logic.MarginSettings
import erp.core.swiftRounded
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The shared base's small rules: the iPhone's column widths, the houses' margins, a shared file's name, Swift's rounding. */
class SharedBaseTests {
    @Test fun readableWidthFollowsTheIphonesRegistry() {
        // Pages that lay out the whole window themselves.
        for (p in listOf("/", "/orders", "/invoices", "/invoices/new", "/orders/add", "/orders/ORD-1/finalize", "/orders/ORD-1/edit", "/ads/campaigns", "/posts")) {
            assertNull(ScreenRegistry.readableWidth(p), p)
        }
        // An order, an invoice, a customer or a repair: a little wider than a form.
        assertEquals(820.dp, ScreenRegistry.readableWidth("/orders/ORD-1"))
        assertEquals(820.dp, ScreenRegistry.readableWidth("/invoices/INV-1?x=1"))
        assertEquals(820.dp, ScreenRegistry.readableWidth("/customers/CUST-1"))
        assertEquals(820.dp, ScreenRegistry.readableWidth("/repairs"))
        assertEquals(980.dp, ScreenRegistry.readableWidth("/analytics/month"))
        assertEquals(720.dp, ScreenRegistry.readableWidth("/new"))
        assertEquals(720.dp, ScreenRegistry.readableWidth("/scan"))
    }

    @Test fun eachHouseHasItsOwnMargin() {
        assertEquals(MarginSettings.mina, House.marginFor("mina"))
        assertEquals(MarginSettings.taheri, House.marginFor("taheri"))
        assertEquals(MarginSettings.taheri, House.marginFor("anything else"))
    }

    @Test fun aSharedFileKeepsAPlainName() {
        assertEquals("Invoice - Test Buyer.pdf", shareFileName("Invoice - Test Buyer", "pdf"))
        assertEquals("Invoice - Test Buyer.PDF", shareFileName("Invoice - Test Buyer.PDF", "pdf")) // already has its extension
        assertEquals("a b c.pdf", shareFileName("a/b:c", "pdf"))
        assertEquals("Document.pdf", shareFileName("  ", "pdf"))
        assertEquals("slip.jpg", shareFileName("slip.jpg"))
    }

    @Test fun swiftRoundsHalvesAwayFromZero() {
        assertEquals(3.0, swiftRounded(2.5))
        assertEquals(-3.0, swiftRounded(-2.5))
        assertEquals(10.0, swiftRounded(9.6))
        assertEquals(0.0, swiftRounded(0.4))
    }
}
