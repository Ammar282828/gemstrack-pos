package erp.core

import erp.core.logic.RecentlyRemoved
import erp.core.models.HisaabEntry
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/lib/recently-removed.test.ts, case for case. Ids made up. */
class RecentlyRemovedTests {
    private fun entry(f: Map<String, Any?>): HisaabEntry = ERPDecode.model<HisaabEntry>(f)!!
    private fun order(f: Map<String, Any?>): Order = ERPDecode.model<Order>(f)!!

    private val history: Map<String, RecentlyRemoved.History>
        get() = RecentlyRemoved.removedHistory(
            hisaab = listOf(entry(mapOf("entityId" to "cust-1")), entry(mapOf("entityId" to "cust-1")), entry(mapOf("entityId" to "kar-1")), entry(mapOf("entityId" to "")), entry(emptyMap())),
            orders = listOf(order(mapOf("customerId" to "cust-1")), order(mapOf("customerId" to "cust-2")), order(mapOf("customerId" to "kar-1")), order(emptyMap())),
        )

    @Test
    fun testCountsLedgerEntriesByPersonAndOrdersByCustomer() {
        val h = history
        assertEquals(RecentlyRemoved.History(entries = 2, orders = 1), h["cust-1"])
        assertEquals(RecentlyRemoved.History(entries = 0, orders = 1), h["cust-2"])
        assertEquals(RecentlyRemoved.History(entries = 1, orders = 1), h["kar-1"])
        assertNull(h[""])
        assertEquals(3, h.size)
    }

    @Test
    fun testSaysItAsTheRowDoes() {
        assertEquals("2 ledger entries · 1 order", RecentlyRemoved.carriesText(RecentlyRemoved.History(entries = 2, orders = 1)))
        assertEquals("1 ledger entry", RecentlyRemoved.carriesText(RecentlyRemoved.History(entries = 1, orders = 0)))
        assertEquals("3 orders", RecentlyRemoved.carriesText(RecentlyRemoved.History(entries = 0, orders = 3)))
        assertEquals("", RecentlyRemoved.carriesText(RecentlyRemoved.History(entries = 0, orders = 0)))
        assertEquals("", RecentlyRemoved.carriesText(null))
    }

    @Test
    fun testAddsUpWhatEmptyingTheListWouldOrphanAKarigarsEntriesNeverOrders() {
        assertEquals(RecentlyRemoved.History(entries = 3, orders = 2), RecentlyRemoved.removedTotals(customerIds = listOf("cust-1", "cust-2"), karigarIds = listOf("kar-1"), history = history))
        assertEquals(RecentlyRemoved.History(), RecentlyRemoved.removedTotals(customerIds = emptyList(), karigarIds = emptyList(), history = history))
    }

    @Test
    fun testRemovedMeansDeletedAtIsSet() {
        assertTrue(RecentlyRemoved.isRemoved("2026-10-01T05:00:00.000Z"))
        assertFalse(RecentlyRemoved.isRemoved(""))
        assertFalse(RecentlyRemoved.isRemoved(null))
    }
}
