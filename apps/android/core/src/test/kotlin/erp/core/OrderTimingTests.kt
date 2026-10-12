package erp.core

import erp.core.logic.DEFAULT_PROMISE_DAYS
import erp.core.logic.OrderTiming
import erp.core.logic.PromiseState
import erp.core.logic.dueSoon
import erp.core.logic.isActiveOrder
import erp.core.logic.isUrgent
import erp.core.logic.lateOrders
import erp.core.logic.orderTiming
import erp.core.logic.timingLabel
import erp.core.models.Order
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/order-timing.ts has no TS test. These cases were run through the TS under
 * TZ=Asia/Karachi (the shop's devices) and the answers pinned here: `now` is 20:00 UTC on
 * 8 Oct, which is already 1 am on the 9th in Karachi.
 */
class OrderTimingTests {
    private val now = ERPDate.parse("2026-10-08T20:00:00Z")!!

    private fun order(promisedDate: String?, createdAt: String, status: String = "Pending", id: String = ""): Order {
        val fields = mutableMapOf<String, Any?>("id" to id, "createdAt" to createdAt, "status" to status)
        if (promisedDate != null) fields["promisedDate"] = promisedDate
        return ERPDecode.model<Order>(fields)!!
    }

    private fun timing(promisedDate: String?, createdAt: String = "2026-10-01T00:00:00Z"): OrderTiming =
        orderTiming(order(promisedDate, createdAt), now = now)

    private fun check(t: OrderTiming, daysLate: Int, state: PromiseState, estimated: Boolean = false, urgent: Boolean, label: String) {
        assertEquals(daysLate, t.daysLate)
        assertEquals(state, t.state)
        assertEquals(estimated, t.estimated)
        assertEquals(urgent, isUrgent(t))
        assertEquals(label, timingLabel(t))
    }

    @Test
    fun testAPromisedDayIsKarachisNotUTCs() {
        // 9 Oct is today in Karachi; due is that day's midnight there, 19:00 UTC the evening before.
        val today = timing("2026-10-09")
        check(today, daysLate = 0, state = PromiseState.today, urgent = true, label = "due today")
        assertEquals(ERPDate.parse("2026-10-08T19:00:00Z"), today.due)
        // 8 Oct would still be "today" read in UTC; in Karachi it is a day late.
        check(timing("2026-10-08"), daysLate = 1, state = PromiseState.late, urgent = true, label = "1 day late")
        check(timing("2026-10-06"), daysLate = 3, state = PromiseState.late, urgent = true, label = "3 days late")
    }

    @Test
    fun testUpcomingIsUrgentWithinTheBenchWeek() {
        check(timing("2026-10-10"), daysLate = -1, state = PromiseState.upcoming, urgent = true, label = "in 1 day")
        check(timing("2026-10-14"), daysLate = -5, state = PromiseState.upcoming, urgent = true, label = "in 5 days")
        check(timing("2026-10-16"), daysLate = -7, state = PromiseState.upcoming, urgent = true, label = "in 7 days")
        check(timing("2026-10-17"), daysLate = -8, state = PromiseState.upcoming, urgent = false, label = "in 8 days")
        check(timing("2026-10-20"), daysLate = -11, state = PromiseState.upcoming, urgent = false, label = "in 11 days")
    }

    @Test
    fun testAPromiseWrittenAsAnInstantCountsOnItsKarachiDay() {
        check(timing("2026-10-09T10:00:00.000Z"), daysLate = 0, state = PromiseState.today, urgent = true, label = "due today")
        // 19:30 UTC on the 8th is 00:30 on the 9th in Karachi.
        check(timing("2026-10-08T19:30:00.000Z"), daysLate = 0, state = PromiseState.today, urgent = true, label = "due today")
        // No zone on it: read in Karachi, as date-fns reads it on the shop's devices.
        check(timing("2026-10-09T01:00:00"), daysLate = 0, state = PromiseState.today, urgent = true, label = "due today")
    }

    @Test
    fun testNoPromiseFallsBackToAgeSoOldOrdersAreStillReported() {
        val legacy = { created: String -> timing(null, created) }
        // Taken 1 Oct (Karachi): 8 days old, a day past the week.
        check(legacy("2026-10-01T10:00:00.000Z"), daysLate = 1, state = PromiseState.late, estimated = true, urgent = false, label = "8 days old")
        check(legacy("2026-10-02T10:00:00.000Z"), daysLate = 0, state = PromiseState.late, estimated = true, urgent = false, label = "7 days old")
        check(legacy("2026-10-03T10:00:00.000Z"), daysLate = -1, state = PromiseState.noPromise, estimated = true, urgent = false, label = "")
        // The age counts Karachi's days: 19:30 UTC on 1 Oct is already 2 Oct there, 18:30 UTC on the 2nd still is.
        check(legacy("2026-10-01T19:30:00.000Z"), daysLate = 0, state = PromiseState.late, estimated = true, urgent = false, label = "7 days old")
        check(legacy("2026-10-02T18:30:00.000Z"), daysLate = 0, state = PromiseState.late, estimated = true, urgent = false, label = "7 days old")
        check(legacy("2026-10-08T21:00:00.000Z"), daysLate = -7, state = PromiseState.noPromise, estimated = true, urgent = false, label = "")
        check(legacy("2026-10-01T10:00:00"), daysLate = 1, state = PromiseState.late, estimated = true, urgent = false, label = "8 days old")
    }

    @Test
    fun testABlankOrUnreadablePromiseIsNoPromise() {
        check(timing("", "2026-10-01T10:00:00.000Z"), daysLate = 1, state = PromiseState.late, estimated = true, urgent = false, label = "8 days old")
        check(timing("soon", "2026-10-01T10:00:00.000Z"), daysLate = 1, state = PromiseState.late, estimated = true, urgent = false, label = "8 days old")
        assertNull(timing("soon", "2026-10-01T10:00:00.000Z").due)
        // Nothing at all: no age to go on, so nothing to report.
        check(timing(null, ""), daysLate = -7, state = PromiseState.noPromise, estimated = true, urgent = false, label = "")
    }

    @Test
    fun testOnlyActiveOrdersAreLateWorstFirstTiesInTheirOrder() {
        val list = listOf(
            order("2026-10-06", "2026-10-01T00:00:00Z", id = "A"),
            order("2026-10-01", "2026-09-20T00:00:00Z", id = "B"),
            order("2026-10-06", "2026-09-30T00:00:00Z", "In Progress", id = "C"),
            order("2026-10-01", "2026-09-20T00:00:00Z", "Completed", id = "D"),
            order("2026-10-12", "2026-09-20T00:00:00Z", id = "E"),
            order(null, "2026-09-20T00:00:00Z", "Cancelled", id = "F"),
            order(null, "2026-09-25T00:00:00Z", id = "G"),
            order("2026-10-09", "2026-09-20T00:00:00Z", id = "H"),
            order(null, "2026-10-06T00:00:00Z", id = "L"),
        )
        val late = lateOrders(list, now = now)
        assertEquals(listOf("B:8", "G:7", "A:3", "C:3"), late.map { "${it.order.id}:${it.timing.daysLate}" })
    }

    @Test
    fun testDueSoonIsActiveOrdersPromisedWithinTheDaysSoonestFirst() {
        val list = listOf(
            order("2026-10-06", "2026-10-01T00:00:00Z", id = "A"),
            order("2026-10-12", "2026-09-20T00:00:00Z", id = "E"),
            order(null, "2026-09-25T00:00:00Z", id = "G"),
            order("2026-10-09", "2026-09-20T00:00:00Z", id = "H"),
            order("2026-10-11", "2026-09-20T00:00:00Z", "In Progress", id = "I"),
            order("2026-10-17", "2026-09-20T00:00:00Z", id = "J"),
            order("2026-10-12", "2026-09-20T00:00:00Z", id = "K"),
            order("2026-10-10", "2026-09-20T00:00:00Z", "Refunded", id = "M"),
        )
        assertEquals(listOf("H:0", "I:-2", "E:-3", "K:-3"), dueSoon(list, now = now).map { "${it.order.id}:${it.timing.daysLate}" })
        assertEquals(listOf("H", "I"), dueSoon(list, now = now, days = 2).map { it.order.id })
    }

    @Test
    fun testOnlyPendingAndInProgressAreActive() {
        assertTrue(isActiveOrder(order(null, "", "Pending")))
        assertTrue(isActiveOrder(order(null, "", "In Progress")))
        for (s in listOf("Completed", "Cancelled", "Refunded", "Draft", "")) assertFalse(isActiveOrder(order(null, "", s)), s)
    }

    @Test
    fun testAnUndatedOrderIsNeverUrgent() {
        assertFalse(isUrgent(OrderTiming(due = null, daysLate = 30, state = PromiseState.late, estimated = true)))
        assertEquals(14, DEFAULT_PROMISE_DAYS)
    }
}
