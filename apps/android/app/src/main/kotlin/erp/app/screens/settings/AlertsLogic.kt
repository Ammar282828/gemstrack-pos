package erp.app.screens.settings

import erp.core.models.Settings

/** One switch on the Alerts page: the settings field it is, its words, and what the stored document says. */
class AlertSwitch(val key: String, val title: String, val detail: String, val value: (Settings) -> Boolean)

/** The Alerts page's pure rules (AlertSettings.swift). */
object AlertsLogic {
    /** Switches that act as things happen. */
    val live = listOf(
        AlertSwitch("notifNewOrder", "New order", "A new order is created") { it.notifNewOrder },
        AlertSwitch("notifOrderCompleted", "Order completed", "An order is marked completed") { it.notifOrderCompleted },
        AlertSwitch("notifOrderCancelled", "Order cancelled", "An order is cancelled or refunded") { it.notifOrderCancelled },
        AlertSwitch("notifNewInvoice", "New sale or invoice", "An invoice is created") { it.notifNewInvoice },
        AlertSwitch("notifPaymentReceived", "Payment received", "A payment is recorded on an invoice") { it.notifPaymentReceived },
    )

    val reports = listOf(
        AlertSwitch("notifDailyReport", "Daily report", "Nightly: sales, cash collected, orders, outstanding") { it.notifDailyReport },
        AlertSwitch("notifDailyChecklist", "Daily checklist", "Morning: active orders, overdue, unreturned items") { it.notifDailyChecklist },
        AlertSwitch("notifEndOfDay", "End of day", "Evening: today’s sales, orders and expenses") { it.notifEndOfDay },
        AlertSwitch("notifWeeklyReport", "Weekly report", "Mondays: the last seven days") { it.notifWeeklyReport },
        AlertSwitch("notifMonthlyReport", "Monthly report", "The 1st: the month before, as a PDF") { it.notifMonthlyReport },
        AlertSwitch("notifAdsDaily", "Ads summary", "Yesterday’s Meta ads and what needs attention") { it.notifAdsDaily },
    )

    val checks = listOf(
        AlertSwitch("notifOrderOverdue", "Overdue orders", "Orders past the date promised") { it.notifOrderOverdue },
        AlertSwitch("notifGivenItems", "Given items overdue", "Items out and not returned for 7 days") { it.notifGivenItems },
        AlertSwitch("notifKarigarPayment", "Karigar balances", "Cash to pay and gold with each karigar") { it.notifKarigarPayment },
    )

    /** The three times, as the server reads them when none is stored. */
    const val CHECKLIST_DEFAULT = "09:00"
    const val END_OF_DAY_DEFAULT = "19:00"
    const val REPORT_DEFAULT = "21:00"

    /** International format with no plus, as the sender reads it. A leading 0 is Pakistan's. Null when it cannot be one. */
    fun international(typed: String): String? {
        val t = typed.trim { it == ' ' || it == '\t' }
        var d = t.filter { it in '0'..'9' }
        if (t.startsWith("+")) {
            // Already international.
        } else if (d.startsWith("00")) {
            d = d.drop(2)
        } else if (d.startsWith("0")) {
            d = "92" + d.drop(1)
        } else if (d.length == 10 && d.startsWith("3")) {
            d = "92$d"
        }
        return if (d.length in 8..15) d else null
    }

    /** "09:00" as hour and minute (a part that does not read is the page's 9 and 0). */
    fun parse(hhmm: String): Pair<Int, Int> {
        val p = hhmm.split(":").mapNotNull { it.trim().toIntOrNull() }
        return (p.getOrNull(0) ?: 9) to (p.getOrNull(1) ?: 0)
    }

    fun hhmm(hour: Int, minute: Int): String = String.format(java.util.Locale.US, "%02d:%02d", hour, minute)

    /** "9:00 am", the way the clock reads on a row. */
    fun say(hhmm: String): String {
        val (h, m) = parse(hhmm)
        val h12 = if (h % 12 == 0) 12 else h % 12
        return "$h12:${String.format(java.util.Locale.US, "%02d", m)} ${if (h < 12) "am" else "pm"}"
    }

    /** The times that differ from what is stored, as the `updateSettings` patch. */
    fun timePatch(checklist: String, endOfDay: String, report: String, stored: Settings): Map<String, Any?> {
        val patch = LinkedHashMap<String, Any?>()
        if (checklist != (stored.notifDailyChecklistTime ?: CHECKLIST_DEFAULT)) patch["notifDailyChecklistTime"] = checklist
        if (endOfDay != (stored.notifEndOfDayTime ?: END_OF_DAY_DEFAULT)) patch["notifEndOfDayTime"] = endOfDay
        if (report != (stored.notifDailyReportTime ?: REPORT_DEFAULT)) patch["notifDailyReportTime"] = report
        return patch
    }
}
