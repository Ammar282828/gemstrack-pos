package erp.app

import erp.app.nav.NavMap
import erp.core.ERPDecode
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order
import erp.app.nav.SearchLogic
import erp.app.nav.SearchResults
import erp.app.nav.HubSplitKind
import java.io.File
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Search tab's rules (SearchHome.swift): what the idle list holds and what typed words find. */
class SearchLogicTests {
    private fun real(house: String) = NavMap.parse(File("../../iphone/App/Resources/nav-$house.json").readText())!!

    @Test fun idleListLeadsWithAnalyticsUnderOverviewAndHasNoHomeRow() {
        for (house in listOf("taheri", "mina")) {
            val groups = SearchLogic.groups(real(house).visible("owner"))
            assertEquals("Overview", groups.first().label, house)
            assertEquals(listOf("analytics"), groups.first().entries.map { it.id }, "Home is a tab, so it has no row")
            assertTrue(groups.drop(1).all { it.label.isNotEmpty() })
        }
    }

    @Test fun analyticsListsEachLaterSectionAsAQuietRow() {
        val a = real("taheri").visible("owner").entries.first { it.id == "analytics" }
        assertEquals(listOf("Analytics: Website", "Analytics: Social", "Analytics: Ads"), SearchLogic.sectionRows(a).map { it.first })
        assertEquals("/website/interest", SearchLogic.sectionRows(a).first().second.href)
    }

    @Test fun aMarketingAccountsListHoldsOnlyItsOwnAnalyticsTabs() {
        val groups = SearchLogic.groups(real("taheri").visible("marketing"))
        assertTrue(groups.first().entries.single().id == "analytics")
        assertEquals(listOf("Analytics: Social", "Analytics: Ads"), SearchLogic.sectionRows(groups.first().entries.single()).map { it.first })
    }

    // Made-up people and numbers; the models decode leniently from the few fields a row reads.
    private fun customer(id: String, name: String, phone: String? = null, removed: Boolean = false) =
        ERPDecode.model<Customer>(buildMap { put("id", id); put("name", name); phone?.let { put("phone", it) }; if (removed) put("deletedAt", "2026-10-01T00:00:00.000Z") })!!

    @Test fun typedWordsFindPlacesAndBooksByNameAndPhoneDigits() {
        val map = real("taheri").visible("owner")
        val book = listOf(
            customer("c1", "Sana Demo", "+92 300 0000101"),
            customer("c2", "Hasan Sample", "0321 1234567"),
            customer("c3", "Sana Removed", "03000000999", removed = true),
        )
        val invoices = listOf(ERPDecode.model<Invoice>(mapOf("id" to "INV-0001", "customerName" to "Hasan Sample"))!!)
        val orders = listOf(ERPDecode.model<Order>(mapOf("id" to "ORD-0001", "customerName" to "Sana Demo"))!!)
        assertEquals(listOf("c1"), SearchResults.of("SANA", map, book).customers.map { it.id }, "case-blind; a removed customer is not found")
        // a short run of digits matches no phone; four or more do, with the punctuation ignored
        assertTrue(SearchResults.of("123", map, book).customers.isEmpty())
        assertEquals(listOf("c2"), SearchResults.of("1234567", map, book).customers.map { it.id })
        assertEquals(listOf("c1"), SearchResults.of("0000101", map, book).customers.map { it.id })
        assertEquals(listOf("INV-0001"), SearchResults.of("hasan", map, book, invoices, orders).invoices.map { it.id })
        assertEquals(listOf("ORD-0001"), SearchResults.of("ord-0001", map, book, invoices, orders).orders.map { it.id })
        // places are found by name, keyword or the row they sit under
        assertTrue(SearchResults.of("analytics", map).places.any { it.place.href == "/analytics" })
        assertTrue(SearchResults.of("  ", map, book).isEmpty)
        assertTrue(SearchResults.of("zzzzzz", map, book, invoices, orders).isEmpty)
    }

    @Test fun onlyTheFiveHubsSplitOnAWideWindow() {
        assertEquals("Choose an order", HubSplitKind.prompt("/orders")?.title)
        assertEquals("Choose an invoice", HubSplitKind.prompt("/invoices")?.title)
        assertEquals("Choose a customer", HubSplitKind.prompt("/customers")?.title)
        assertEquals("Choose a piece", HubSplitKind.prompt("/products")?.title)
        assertEquals("Choose a repair", HubSplitKind.prompt("/repairs?id=REP-1")?.title)
        assertNull(HubSplitKind.prompt("/workshop"))
        assertNotNull(HubSplitKind.prompt("/orders"))
    }
}
