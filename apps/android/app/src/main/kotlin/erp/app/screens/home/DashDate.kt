package erp.app.screens.home

import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Karachi's days and the web's date-fns formats (DashboardFigures.swift `DashDate`). "Today" and "this month"
 * are the shop's, wherever the phone is. Core keeps `new Date` / `parseISO` to itself (internal), so the two
 * readings the dashboard needs are here, as the Swift has them.
 */
object DashDate {
    private val zone = ERPDate.karachi
    private const val OFFSET = 5L * 3600

    private fun format(pattern: String): DateTimeFormatter = DateTimeFormatter.ofPattern(pattern, Locale.US).withZone(zone)

    private val zoneless = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm").map { DateTimeFormatter.ofPattern(it, Locale.US) }
    private val dayMonthFormat = format("d MMM")
    private val weekdayDayMonthFormat = format("EEE d MMM")
    private val longDayFormat = format("EEEE, d MMMM yyyy")
    private val weekdayMonthFormat = format("EEEE d MMMM")
    private val monthNameFormat = format("MMMM")
    private val shortMonthFormat = format("MMM")
    private val clockFormat = format("h:mm a")

    /** `new Date(iso)`: an instant, a bare day (UTC midnight) or a date-time with no zone (Karachi's clock). */
    fun newDate(s: String?): Instant? {
        val t = s?.trim().orEmpty()
        if (t.isEmpty()) return null
        ERPDate.parse(t)?.let { return it }
        for (f in zoneless) {
            try {
                return LocalDateTime.parse(t, f).toInstant(zone)
            } catch (e: DateTimeParseException) {
                // try the next shape
            }
        }
        return null
    }

    /** date-fns `parseISO`: as [newDate], except that a bare day is the local (here Karachi's) midnight. */
    fun parseISO(s: String?): Instant? {
        val t = s?.trim().orEmpty()
        if (t.isEmpty()) return null
        if (t.length == 10) ERPDate.parse(t)?.let { return it.minusSeconds(OFFSET) }
        return newDate(t)
    }

    private fun local(d: Instant) = d.atOffset(zone)

    fun startOfDay(d: Instant): Instant = local(d).toLocalDate().atStartOfDay(zone).toInstant()

    fun startOfMonth(d: Instant): Instant = local(d).toLocalDate().withDayOfMonth(1).atStartOfDay(zone).toInstant()

    fun adding(days: Int, to: Instant): Instant = local(to).plusDays(days.toLong()).toInstant()

    fun addingMonths(months: Int, to: Instant): Instant = local(to).plusMonths(months.toLong()).toInstant()

    /** date-fns `differenceInCalendarDays(later, earlier)`. */
    fun calendarDays(later: Instant, since: Instant): Int =
        ChronoUnit.DAYS.between(local(since).toLocalDate(), local(later).toLocalDate()).toInt()

    /** "8 Oct". */
    fun dayMonth(d: Instant): String = dayMonthFormat.format(d)

    fun dayMonth(iso: String?): String = newDate(iso)?.let { dayMonthFormat.format(it) } ?: ""

    /** "Thu 8 Oct". */
    fun weekdayDayMonth(d: Instant): String = weekdayDayMonthFormat.format(d)

    /** "Thursday, 8 October 2026". */
    fun longDay(d: Instant): String = longDayFormat.format(d)

    /** "Thursday 8 October". */
    fun dayLabel(d: Instant): String = weekdayMonthFormat.format(d)

    /** "October". */
    fun monthName(d: Instant): String = monthNameFormat.format(d)

    /** "Sep". */
    fun shortMonth(d: Instant): String = shortMonthFormat.format(d)

    /** The month before [d]'s, for "62% of Sep". */
    fun lastMonth(d: Instant): Instant = addingMonths(-1, d)

    /** "2:30 pm", as ShopDate says a time. */
    fun clock(iso: String?): String = newDate(iso)?.let { clockFormat.format(it).replace("AM", "am").replace("PM", "pm") } ?: ""

    /** A calendar date at Karachi's midnight, for the occasions (Feb 29 in a common year rolls into March, as the calendar does). */
    internal fun date(year: Int, month: Int, day: Int): Instant =
        LocalDate.of(year, 1, 1).plusMonths((month - 1).toLong()).plusDays((day - 1).toLong()).atStartOfDay(zone).toInstant()

    internal fun year(d: Instant): Int = local(d).year
}
