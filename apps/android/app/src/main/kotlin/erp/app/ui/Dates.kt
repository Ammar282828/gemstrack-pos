package erp.app.ui

import erp.core.ERPDate
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Dates the way the shop says them: "Today 4:05 pm", "Yesterday", "Tue 6 Oct", "6 Oct 2025" (Kit.swift `ShopDate`). */
object ShopDate {
    private fun format(pattern: String): DateTimeFormatter =
        DateTimeFormatter.ofPattern(pattern, Locale.UK).withZone(ERPDate.karachi)

    private val time = format("h:mm a")
    private val thisYear = format("EEE d MMM")
    private val older = format("d MMM yyyy")

    fun say(iso: String?, withTime: Boolean = false, now: Instant = Instant.now()): String {
        val d = ERPDate.parse(iso) ?: return ""
        return stamp(d, withTime, now)
    }

    /** The same words for an instant already in hand (a picker's value, now): "Today 4:05 pm", "Tue 6 Oct". */
    fun stamp(d: Instant, withTime: Boolean = false, now: Instant = Instant.now()): String {
        // The clock reads "pm", not the locale's "PM" or "p.m.".
        val t = if (withTime) " " + time.format(d).replace(Regex("(?i)\\s*([ap])\\.?m\\.?$")) { " ${it.groupValues[1].lowercase()}m" } else ""
        val day = ERPDate.karachiDay(d)
        if (day == ERPDate.karachiDay(now)) return "Today$t"
        if (day == ERPDate.karachiDay(now.minusSeconds(86_400))) return "Yesterday$t"
        if (day == ERPDate.karachiDay(now.plusSeconds(86_400))) return "Tomorrow$t"
        val sameYear = day.take(4) == ERPDate.karachiDay(now).take(4)
        return (if (sameYear) thisYear else older).format(d) + t
    }
}
