package erp.app.screens.work

import erp.app.ui.icons.Symbols
import erp.app.ui.AppClock
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.ui.NotAvailableState
import erp.app.ui.ToggleRow
import erp.app.ui.theme.ErpColors
import erp.core.ERPDate
import erp.core.logic.ActivityLogEntry
import erp.core.logic.WorkDraft
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale

// What the Work screens share (WorkKit.swift): addresses, the lock for what is not a person's to see, the day range of a
// filter, and the made-up books the demo shows.

private const val PART_KEEP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@"

/** One part of a path: an id with a "/" or "?" in it must not split the address. */
private fun part(s: String): String {
    val out = StringBuilder()
    for (b in s.toByteArray(Charsets.UTF_8)) {
        val c = (b.toInt() and 0xFF).toChar()
        if (b >= 0 && c in PART_KEEP) out.append(c) else out.append('%').append(String.format(Locale.US, "%02X", b.toInt() and 0xFF))
    }
    return out.toString()
}

fun WorkPaths.order(id: String): String = "/orders/" + part(id)

fun WorkPaths.invoice(id: String): String = "/invoices/" + part(id)

/** A place the signed-in person is not let into (the ERP's menu does not offer it to them either). */
@Composable
fun WorkNotYours(title: String, detail: String = "The ERP does not show this to your account.") {
    erp.app.nav.ScreenTitle(title)
    NotAvailableState(title, why = detail)
}

/**
 * What the person chose for a range of days, as the web's range picker works: nothing is bound until a start date is chosen,
 * and with no end date the range runs to the end of today. Days are the phone's own calendar days ("6 Oct" is the 6th
 * wherever the phone is), as "yyyy-MM-dd".
 */
data class WorkRange(
    val useFrom: Boolean = false,
    val from: LocalDate = ShopToday.date().withDayOfMonth(1),
    val useTo: Boolean = false,
    val to: LocalDate = ShopToday.date(),
) {
    val fromDay: String? get() = if (useFrom) from.toString() else null
    val toDay: String? get() = if (useFrom && useTo) to.toString() else null

    /** Picking a start after the end carries the end with it. */
    fun withFrom(day: LocalDate): WorkRange = copy(from = day, to = if (to.isBefore(day)) day else to)
}

/** The range's dates, as rows of a form (put them in a Section). */
@Composable
fun WorkRangeFields(range: WorkRange, onChange: (WorkRange) -> Unit) {
    val today = ShopToday.date()
    Column {
        ToggleRow("From a date", range.useFrom, { onChange(range.copy(useFrom = it)) })
        if (range.useFrom) {
            WorkDayRow("From", range.from, today) { onChange(range.withFrom(it)) }
            ToggleRow("To a date", range.useTo, { onChange(range.copy(useTo = it)) })
            if (range.useTo) WorkDayRow("To", range.to, maxOf(today, range.from), range.from) { onChange(range.copy(to = it)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorkDayRow(label: String, day: LocalDate, latest: LocalDate, earliest: LocalDate? = null, onPick: (LocalDate) -> Unit) {
    var open by remember { mutableStateOf(false) }
    fun utc(d: LocalDate) = d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { open = true }.padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Symbols.CalendarMonth, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(erp.core.logic.ShopCalendar.longDay(day.toString()), color = ErpColors.accent, fontWeight = FontWeight.Medium)
    }
    if (open) {
        val picker = rememberDatePickerState(
            initialSelectedDateMillis = utc(day),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    utcTimeMillis <= utc(latest) && (earliest == null || utcTimeMillis >= utc(earliest))
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { ms -> onPick(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()) }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(picker) }
    }
}

// MARK: The demo's books

/** Made-up drafts and activity for the demo (CONVENTIONS.md rule 4): the demo book holds neither, the ERP's server keeps them. */
object WorkDemoBooks {
    private fun ago(now: Instant, seconds: Long): String = ERPDate.iso(now.minusSeconds(seconds))

    fun drafts(now: Instant = AppClock.now()): List<WorkDraft> = listOf(
        WorkDraft("order-demo01aa-ab12c", "order", "Sana Demo", "Plain band, matte finish · advance PKR 20,000", 1, 148_000.0, "iPhone", ago(now, 3_600), ago(now, 1_500)),
        WorkDraft("order-demo02bb-cd34e", "order", "No customer yet", "Bangle pair with filigree, Matching studs", 2, 760_000.0, "Mac", ago(now, 90_000), ago(now, 86_400)),
        WorkDraft("sale-demo03cc-ef56g", "sale", "Bilal Example", "Gents ring, Chain 22k · discount PKR 5,000", 2, 214_000.0, "iPhone", ago(now, 7_200), ago(now, 5_400)),
    )

    fun activity(now: Instant = AppClock.now()): List<ActivityLogEntry> {
        fun e(n: Int, type: String, what: String, details: String, id: String, seconds: Long) =
            ActivityLogEntry("log-demo-$n", ago(now, seconds), type, what, details, id)
        return listOf(
            e(1, "invoice.create", "Created invoice INV-D0003", "Sana Demo | By: Demo", "INV-D0003", 1_800),
            e(2, "invoice.payment", "Payment of PKR 40,000 on INV-D0002", "Bilal Example | Cash", "INV-D0002", 7_000),
            e(3, "order.create", "Created order ORD-D0004", "Sana Demo | By: Demo", "ORD-D0004", 20_000),
            e(4, "order.update", "Marked ORD-D0002 In Progress", "Karigar assigned", "ORD-D0002", 90_000),
            e(5, "expense.create", "Added expense: Workshop electricity", "PKR 12,500 | Utilities", "EXP-D0001", 100_000),
            e(6, "product.update", "Updated product: DEMO-0007", "Price changed", "DEMO-0007", 180_000),
            e(7, "customer.create", "Added customer: Example Customer", "By: Counter Two", "CUST-D09", 260_000),
            e(8, "repair.status", "Repair REP-D0001 is Ready", "Chain clasp", "REP-D0001", 300_000),
            e(9, "rates.update", "Gold rates updated", "24k: 38,500 per gram", "rates", 400_000),
            e(10, "order.delete", "Removed order ORD-D0000", "Duplicate", "ORD-D0000", 520_000),
        )
    }
}

/** Karachi's today as a plain date (the screens' clock is AppClock's, so a test can pin it). */
internal object ShopToday {
    fun date(): LocalDate = LocalDate.parse(ERPDate.karachiDay(AppClock.now()))
}
