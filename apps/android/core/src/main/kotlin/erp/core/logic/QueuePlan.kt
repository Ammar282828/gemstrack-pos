package erp.core.logic

import erp.core.ERPDate
import java.time.DayOfWeek
import java.time.Instant

// Ported from src/lib/social/queue-plan.ts (QueuePlan.swift; tests: QueuePlanTests): when each queued piece goes when the
// counter spreads the queue over the day. Pure, so the phone's Spread over the day lays the times out as the web's does;
// the queue's tick on the server sends them, whoever set them.

/**
 * Times for [n] pieces spread evenly from [from] to [to] (both included when n > 1). A window already over, or backwards,
 * puts them all at [from].
 */
fun spreadTimes(n: Int, from: Instant, to: Instant): List<Instant> {
    if (n <= 0) return emptyList()
    val span = (to.toEpochMilli() - from.toEpochMilli()) / 1000.0
    if (n == 1 || span <= 0) return List(n) { from }
    val step = span / (n - 1)
    // To the minute: a time the counter reads as "4:35", not "4:35:17".
    return (0 until n).map { i ->
        val ms = from.toEpochMilli().toDouble() + step * 1000 * i
        Instant.ofEpochSecond(JS.round(ms / 60_000).toLong() * 60)
    }
}

/**
 * The end of today's posting window, Karachi's time: half an hour before closing (Sat-Thu 21:00, Friday 20:00, the
 * shop's hours).
 */
fun defaultSpreadEnd(now: Instant): Instant {
    val day = now.atOffset(ERPDate.karachi)
    val friday = day.dayOfWeek == DayOfWeek.FRIDAY
    return day.withHour(if (friday) 19 else 20).withMinute(30).withSecond(0).withNano(0).toInstant()
}
