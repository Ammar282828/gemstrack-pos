package erp.app.screens.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.config.Prefs
import erp.app.screens.money.DayRow
import erp.app.screens.money.MoneySheet
import erp.app.ui.AppClock
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.ledgerCard
import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate

/**
 * The period every Analytics tab shares: the web keeps it in the address (`?range=`), the app on the phone
 * (`erp.analytics.range`, and `.from` / `.to` for a custom one), so every tab reads the same one.
 */
object AnaPeriodStore {
    const val rangeKey = "erp.analytics.range"
    const val fromKey = "erp.analytics.from"
    const val toKey = "erp.analytics.to"

    var key by mutableStateOf(Prefs.string(rangeKey) ?: AnaPeriod.defaultKey)
        private set
    var from by mutableStateOf(Prefs.string(fromKey) ?: "")
        private set
    var to by mutableStateOf(Prefs.string(toKey) ?: "")
        private set

    fun choose(newKey: String) {
        key = newKey
        Prefs.putString(rangeKey, newKey)
    }

    fun chooseCustom(first: LocalDate, last: LocalDate) {
        from = first.toString()
        to = last.toString()
        Prefs.putString(fromKey, from)
        Prefs.putString(toKey, to)
        choose("custom")
    }
}

/**
 * The period the tabs share (the web's "Quick:" chips and its date range). The choice is kept by [AnaPeriodStore]; this
 * only writes it.
 */
@Composable
fun AnaPeriodBar(state: AnaPeriodState, modifier: Modifier = Modifier) {
    var choosing by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        ChipRow {
            for (q in AnaPeriod.quick) FilterChip(q.label, chosen = state.key == q.key, onClick = { AnaPeriodStore.choose(q.key) })
            // A year picked from the Yearly table has no quick chip of its own.
            AnaPeriod.year(state.key)?.let { FilterChip(it.toString(), chosen = true, onClick = {}) }
            FilterChip(customTitle(state), chosen = state.key == "custom", onClick = { choosing = true })
        }
        Text(
            AnaPeriod.describe(state.range),
            Modifier.padding(horizontal = 20.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    if (choosing) {
        val today = karachiDay(AppClock.now())
        CustomPeriodSheet(
            start = state.range?.from?.let { karachiDay(it) } ?: today.minusDays(29),
            end = state.range?.to?.let { karachiDay(it) } ?: today,
            today = today,
            onDismiss = { choosing = false },
            onShow = { a, b ->
                AnaPeriodStore.chooseCustom(a, b)
                choosing = false
            },
        )
    }
}

private fun customTitle(state: AnaPeriodState): String {
    val r = state.range
    if (state.key != "custom" || r == null) return "Custom"
    val a = AnaDate.dayMonth(r.from)
    val b = AnaDate.dayMonth(r.to)
    return if (a == b) a else "$a to $b"
}

private fun karachiDay(at: Instant): LocalDate = at.atOffset(ERPDate.karachi).toLocalDate()

/** Two days to look between. */
@Composable
private fun CustomPeriodSheet(start: LocalDate, end: LocalDate, today: LocalDate, onDismiss: () -> Unit, onShow: (LocalDate, LocalDate) -> Unit) {
    var first by remember { mutableStateOf(start) }
    var last by remember { mutableStateOf(end) }
    MoneySheet(title = "Custom period", onDismiss = onDismiss, confirmText = "Show", onConfirm = { onShow(first, maxOf(first, last)) }) {
        Column(Modifier.fillMaxWidth().ledgerCard(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            DayRow("From", first, { first = it; if (last < it) last = it }, latest = today)
            DayRow("To", last, { last = it }, latest = maxOf(today, first), earliest = first)
        }
    }
}
