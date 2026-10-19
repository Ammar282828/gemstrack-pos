package erp.core

import erp.core.logic.defaultSpreadEnd
import erp.core.logic.spreadTimes
import java.time.Instant
import java.time.format.DateTimeFormatter
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** src/lib/social/queue-plan.test.ts's spreadTimes and defaultSpreadEnd cases, on Karachi's clock (QueuePlanTests.swift). */
class QueuePlanTests {
    private fun at(iso: String): Instant = ERPDate.parse(iso)!!
    private fun clock(d: Instant): String = DateTimeFormatter.ofPattern("HH:mm").withZone(ERPDate.karachi).format(d)

    private val from = at("2026-09-25T11:00:00+05:00")
    private val to = at("2026-09-25T20:00:00+05:00")

    @Test fun spreadsEvenlyFirstAndLastAtTheEnds() {
        assertEquals(listOf("11:00", "14:00", "17:00", "20:00"), spreadTimes(4, from, to).map(::clock))
    }

    @Test fun roundsToTheMinute() {
        val times = spreadTimes(3, from, at("2026-09-25T11:01:01+05:00"))
        assertTrue(times.all { it.epochSecond % 60 == 0L })
    }

    @Test fun putsEverythingAtTheStartWhenTheWindowIsOver() {
        assertEquals(listOf(to, to), spreadTimes(2, to, from))
    }

    @Test fun onePieceGoesAtTheStart() {
        assertEquals(listOf(from), spreadTimes(1, from, to))
        assertEquals(emptyList(), spreadTimes(0, from, to))
    }

    @Test fun theWindowEndsHalfAnHourBeforeClosing() {
        assertEquals("20:30", clock(defaultSpreadEnd(at("2026-09-24T12:00:00+05:00")))) // Thursday
        assertEquals("19:30", clock(defaultSpreadEnd(at("2026-09-25T16:00:00+05:00")))) // Friday
    }
}
