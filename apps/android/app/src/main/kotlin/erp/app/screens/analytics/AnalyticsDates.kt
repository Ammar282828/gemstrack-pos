package erp.app.screens.analytics

import erp.app.screens.home.DashDate
import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// Karachi's days and the period picker, as the web's Analytics has them (components/analytics,
// lib/analytics/range-param.ts; AnalyticsDates.swift). Prefixed Ana so it cannot meet another group's type.
// `new Date` / `parseISO` and the start of a day are the dashboard's (DashDate): one reading of the ERP's dates.

/** date-fns on Karachi's calendar: "today", "this year" and a day's start and end are the shop's, wherever the phone is. */
object AnaDate {
    private val zone = ERPDate.karachi

    private fun format(pattern: String): DateTimeFormatter = DateTimeFormatter.ofPattern(pattern, Locale.US).withZone(zone)

    private val dayMonthYearFormat = format("d MMM yyyy")
    private val dayMonthFormat = format("d MMM")
    private val longDayFormat = format("EEEE, d MMMM yyyy")
    private val monthShortFormat = format("MMM yy")
    private val monthLongFormat = format("MMMM yyyy")

    fun parseISO(s: String?): Instant? = DashDate.parseISO(s)

    fun startOfDay(d: Instant): Instant = DashDate.startOfDay(d)

    fun startOfMonth(d: Instant): Instant = DashDate.startOfMonth(d)

    /** date-fns `endOfDay`: the last millisecond of the day. */
    fun endOfDay(d: Instant): Instant = DashDate.adding(1, startOfDay(d)).minusMillis(1)

    fun adding(days: Int, to: Instant): Instant = DashDate.adding(days, to)

    fun year(d: Instant): Int = d.atOffset(zone).year

    fun startOfYear(year: Int): Instant = LocalDate.of(year, 1, 1).atStartOfDay(zone).toInstant()

    fun endOfYear(year: Int): Instant = endOfDay(LocalDate.of(year, 12, 31).atStartOfDay(zone).toInstant())

    /** "2026-10-08": the Karachi day an instant falls on. */
    fun dayKey(d: Instant): String = ERPDate.karachiDay(d)

    /** "2026-10". */
    fun monthKey(d: Instant): String = ERPDate.karachiDay(d).take(7)

    /** "8 Oct 2026". */
    fun dayMonthYear(d: Instant): String = dayMonthYearFormat.format(d)

    /** "8 Oct". */
    fun dayMonth(d: Instant): String = dayMonthFormat.format(d)

    /** "Thursday, 8 October 2026". */
    fun longDay(d: Instant): String = longDayFormat.format(d)

    /** "Oct 26" (date-fns 'MMM yy') for a month key "2026-10". */
    fun monthShort(key: String): String {
        val parts = key.split('-')
        val y = parts.getOrNull(0)?.toIntOrNull() ?: return key
        val m = parts.getOrNull(1)?.toIntOrNull() ?: return key
        return monthShortFormat.format(LocalDate.of(y, m, 15).atStartOfDay(zone))
    }

    /** "October 2026" for the Monthly PDF's picker. */
    fun monthLong(d: Instant): String = monthLongFormat.format(d)

    /** "2026-12" -> "2027-01". */
    fun nextMonth(key: String): String {
        val parts = key.split('-')
        val y = parts.getOrNull(0)?.toIntOrNull()
        val m = parts.getOrNull(1)?.toIntOrNull()
        if (parts.size != 2 || y == null || m == null) return key + "x"
        val ny = if (m == 12) y + 1 else y
        val nm = if (m == 12) 1 else m + 1
        return "%04d-%02d".format(Locale.US, ny, nm)
    }
}

/** A period as the pages filter by it: the first instant of its first day to the last of its last. */
data class AnaRange(val from: Instant, val to: Instant) {
    /** date-fns `isWithinInterval` (both ends included). */
    fun contains(d: Instant): Boolean = !d.isBefore(from) && !d.isAfter(to)
}

/** What the picker says and what the pages read: the key, and its range (null is all time). */
data class AnaPeriodState(val key: String, val range: AnaRange?)

/**
 * The period picker's rules (lib/analytics/range-param.ts). Every Analytics screen opens on this month, the 1st to
 * today (owner, 2026-10-12: decisions.md "Analytics default: this month"), so [defaultKey] is not the iPhone's
 * last-30; Last 30 days stays one tap away. A rolling period is worked out from `now` every time it is read, so a
 * screen left open past midnight moves with the day.
 */
object AnaPeriod {
    data class Quick(val key: String, val label: String)

    val quick: List<Quick> = listOf(
        Quick("this-month", "This month"),
        Quick("last-30", "Last 30 days"),
        Quick("last-90", "Last 90 days"),
        Quick("this-year", "This year"),
        Quick("last-year", "Last year"),
        Quick("all-time", "All time"),
    )

    const val defaultKey = "this-month"

    /** The year of a `year-2025` key (the Yearly table's rows set these). */
    fun year(key: String): Int? {
        if (key.length != 9 || !key.startsWith("year-")) return null
        val digits = key.drop(5)
        if (!digits.all { it in '0'..'9' }) return null
        return digits.toInt()
    }

    private fun span(a: Instant, b: Instant) = AnaRange(AnaDate.startOfDay(a), AnaDate.endOfDay(b))

    private fun wholeYear(y: Int) = AnaRange(AnaDate.startOfYear(y), AnaDate.endOfYear(y))

    /** The range a key names, as of [now]; null for all time. An unknown key is the default. */
    fun rangeFor(key: String, now: Instant, from: String?, to: String?): AnaRange? {
        when (key) {
            "this-month" -> return span(AnaDate.startOfMonth(now), now)
            "last-30" -> return span(AnaDate.adding(-29, now), now)
            "last-90" -> return span(AnaDate.adding(-89, now), now)
            "this-year" -> return span(AnaDate.startOfYear(AnaDate.year(now)), now)
            "last-year" -> return wholeYear(AnaDate.year(now) - 1)
            "all-time" -> return null
        }
        year(key)?.let { return wholeYear(it) }
        if (key == "custom") {
            val start = AnaDate.parseISO(from)
            if (start != null) return span(start, AnaDate.parseISO(to) ?: start)
        }
        return rangeFor(defaultKey, now, null, null)
    }

    /** The stored key, made safe: an unknown or broken one falls back to the default. */
    fun read(key: String, from: String?, to: String?, now: Instant): AnaPeriodState {
        val asked = key.ifEmpty { defaultKey }
        val known = quick.any { it.key == asked } || year(asked) != null || (asked == "custom" && AnaDate.parseISO(from) != null)
        val chosen = if (known) asked else defaultKey
        return AnaPeriodState(chosen, rangeFor(chosen, now, from, to))
    }

    /** "8 Sep 2026 to 7 Oct 2026", or "All time". */
    fun describe(range: AnaRange?): String {
        if (range == null) return "All time"
        val a = AnaDate.dayMonthYear(range.from)
        val b = AnaDate.dayMonthYear(range.to)
        return if (a == b) a else "$a to $b"
    }
}
