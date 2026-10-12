package erp.core

import erp.core.logic.ActivityLogEntry
import erp.core.logic.ActivityLogRules
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/app/activity-log/page.tsx has no test of its own. These pin its filters (Karachi's days) and its words. */
class ActivityLogRulesTests {
    private fun log(id: String, type: String, at: String) =
        ActivityLogEntry(id = id, timestamp = at, eventType = type, description = "d $id", details = "", entityId = id)

    // 6 Oct 10:00, 8 Oct 20:00 UTC (= 9 Oct 01:00 in Karachi), 9 Oct 10:00, 9 Oct 20:00 UTC (= 10 Oct 01:00).
    private val logs: List<ActivityLogEntry>
        get() = listOf(
            log("a", "order.create", "2026-10-06T10:00:00Z"),
            log("b", "invoice.payment", "2026-10-08T20:00:00Z"),
            log("c", "product.update", "2026-10-09T10:00:00Z"),
            log("d", "order.update", "2026-10-09T20:00:00Z"),
        )

    @Test
    fun testNoFilterIsEverythingNewestFirst() {
        val out = ActivityLogRules.filter(logs, type = "All", fromDay = null, toDay = null, today = "2026-10-10")
        assertEquals(listOf("d", "c", "b", "a"), out.map { it.id })
    }

    @Test
    fun testAKindMatchesTheStartOfTheEventType() {
        assertEquals(listOf("d", "a"), ActivityLogRules.filter(logs, type = "order", fromDay = null, toDay = null, today = "2026-10-10").map { it.id })
        assertEquals(listOf("b"), ActivityLogRules.filter(logs, type = "invoice", fromDay = null, toDay = null, today = "2026-10-10").map { it.id })
        assertEquals(emptyList(), ActivityLogRules.filter(logs, type = "rates", fromDay = null, toDay = null, today = "2026-10-10").map { it.id })
    }

    @Test
    fun testARangeIsWholeDaysInKarachiBothEndsIncluded() {
        // 9 Oct in Karachi holds b (01:00) and c (15:00) but not d (10 Oct 01:00).
        val out = ActivityLogRules.filter(logs, type = "All", fromDay = "2026-10-09", toDay = "2026-10-09", today = "2026-10-10")
        assertEquals(listOf("c", "b"), out.map { it.id })
        assertEquals(listOf("a"), ActivityLogRules.filter(logs, type = "All", fromDay = "2026-10-06", toDay = "2026-10-08", today = "2026-10-10").map { it.id })
    }

    @Test
    fun testNoEndDayRunsToToday() {
        val out = ActivityLogRules.filter(logs, type = "All", fromDay = "2026-10-09", toDay = null, today = "2026-10-10")
        assertEquals(listOf("d", "c", "b"), out.map { it.id })
        // Today is not past the end of the range: it counts.
        assertEquals(listOf("c", "b"), ActivityLogRules.filter(logs, type = "All", fromDay = "2026-10-09", toDay = null, today = "2026-10-09").map { it.id })
    }

    @Test
    fun testAKindAndARangeTogetherAndALogWithNoDateIsOutOfAnyRange() {
        assertEquals(listOf("a"), ActivityLogRules.filter(logs, type = "order", fromDay = "2026-10-06", toDay = "2026-10-06", today = "2026-10-10").map { it.id })
        val undated = log("u", "order.create", "")
        assertEquals(listOf("u"), ActivityLogRules.filter(listOf(undated), type = "All", fromDay = null, toDay = null, today = "2026-10-10").map { it.id })
        assertEquals(emptyList(), ActivityLogRules.filter(listOf(undated), type = "All", fromDay = "2026-10-01", toDay = null, today = "2026-10-10").map { it.id })
    }

    @Test
    fun testTheWordsAndTones() {
        assertEquals("Invoice", ActivityLogRules.title("invoice"))
        assertEquals("", ActivityLogRules.title(""))
        assertEquals(ActivityLogRules.Tone.created, ActivityLogRules.tone("invoice.create"))
        assertEquals(ActivityLogRules.Tone.created, ActivityLogRules.tone("repair.payment"))
        assertEquals(ActivityLogRules.Tone.updated, ActivityLogRules.tone("order.update"))
        assertEquals(ActivityLogRules.Tone.deleted, ActivityLogRules.tone("expense.delete"))
        assertEquals(ActivityLogRules.Tone.other, ActivityLogRules.tone("order.revert"))
        assertEquals(ActivityLogRules.Tone.other, ActivityLogRules.tone(""))
        assertTrue(ActivityLogRules.isRevertable("expense.create"))
        assertFalse(ActivityLogRules.isRevertable("expense.update"))
        assertEquals("The order will be permanently deleted.", ActivityLogRules.consequence("order.create"))
        assertNull(ActivityLogRules.consequence("order.update"))
        assertEquals(8, ActivityLogRules.eventTypes.size)
    }

    @Test
    fun testALineReadsFromAnOddDocument() {
        val e = assertNotNull(DocJSON.decode<ActivityLogEntry>("x1", mapOf("eventType" to "order.update", "timestamp" to "2026-10-09T10:00:00Z", "description" to 5)))
        assertEquals("x1", e.id)
        assertEquals("5", e.description)
        assertEquals("", e.details)
        assertEquals("", e.entityId)
    }
}
