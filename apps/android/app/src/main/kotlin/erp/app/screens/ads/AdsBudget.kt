package erp.app.screens.ads

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.ui.AppClock
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.core.ERPDate
import java.time.Instant
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * A budget and an end date (the web's campaign menu: Budget, Schedule; src/app/api/ads/object/[id]), as the sheet
 * works them out. The kind stays as it is, a day's or the whole run's, as Meta keeps it. Nothing changes until the
 * counter has read what it will cost, before and after, a day and about a month, and said yes: it is money at Meta.
 */
class AdsBudgetModel(val target: AdsBudgetTarget, val amount: String, val hasEnd: Boolean, val endDay: Instant) {
    /** A day's budget, or the whole run's (Meta keeps the kind it was made with). */
    val isDaily: Boolean get() = (target.daily ?: 0.0) > 0 || (target.lifetime ?: 0.0) <= 0

    val before: Double get() = (if (isDaily) target.daily else target.lifetime) ?: 0.0

    val after: Double?
        get() {
            val v = erp.core.logic.ShopNumber.parse(amount)
            return if (v != null && v > 0) v else null
        }

    /** The end as the sheet holds it: the chosen day's last minute in Karachi, or none. */
    val endAfter: Instant? get() = if (hasEnd || !isDaily) AdsDays.endOfDay(endDay) else null

    val endBefore: Instant? get() = AdsDays.parse(target.end)

    val budgetChanged: Boolean get() = after?.let { Math.abs(it - before) >= 0.005 } ?: false

    val endChanged: Boolean
        get() {
            val a = endBefore
            val b = endAfter
            return when {
                a == null && b == null -> false
                a != null && b != null -> ERPDate.karachiDay(a) != ERPDate.karachiDay(b)
                else -> true
            }
        }

    private fun money(v: Double) = AdsFormat.money(v, target.currency)

    private fun dayWords(d: Instant?): String = if (d == null) "no end" else ShopDate.say(ERPDate.iso(d))

    val nowLine: String get() = if (before > 0) money(before) + (if (isDaily) " a day" else " in total") else "None of its own"
    val endsLine: String get() = dayWords(endBefore)

    /** Before and after, in money, as the counter agrees to it. */
    val review: String
        get() {
            val lines = ArrayList<String>()
            val v = after
            if (budgetChanged && v != null) {
                val per = if (isDaily) " a day" else " in total"
                lines.add("Budget: ${money(before)}$per → ${money(v)}$per")
                if (isDaily) lines.add("About ${money(v * 30.4)} a month (was ${money(before * 30.4)})")
            }
            if (endChanged) lines.add("Ends: ${dayWords(endBefore)} → ${dayWords(endAfter)}")
            lines.add("Meta starts spending at the new budget at once.")
            return lines.joinToString("\n")
        }

    /** The note under the amount: a month's worth, and a warning when it more than doubles. */
    val noteLines: List<Pair<String, Boolean>>
        get() {
            val v = after ?: return listOf("A budget above zero." to false)
            val out = ArrayList<Pair<String, Boolean>>()
            if (isDaily) out.add("About ${money(v * 30.4)} a month at this budget." to false)
            if (before > 0 && v > before * 2) out.add("That more than doubles what it spends." to true)
            return out
        }

    companion object {
        /** The field's first text: the budget as it stands. */
        fun plain(v: Double): String = if (v == Math.rint(v)) v.toLong().toString() else String.format(Locale.US, "%.2f", v)

        fun start(target: AdsBudgetTarget, now: Instant = AppClock.now()): AdsBudgetModel {
            val now0 = if ((target.daily ?: 0.0) > 0) target.daily else target.lifetime
            val ends = AdsDays.parse(target.end)
            return AdsBudgetModel(target, now0?.let { plain(it) } ?: "", ends != null, ends ?: now.plusSeconds(7 * 86_400))
        }
    }
}

/** The budget sheet: a campaign's or an ad set's budget and end date; [saved] reads the campaigns again once Meta has the change. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdsBudgetSheet(target: AdsBudgetTarget, onDismiss: () -> Unit, saved: suspend () -> Unit) {
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val start = remember(target) { AdsBudgetModel.start(target) }
    var amount by remember(target) { mutableStateOf(start.amount) }
    var hasEnd by remember(target) { mutableStateOf(start.hasEnd) }
    var endDay by remember(target) { mutableStateOf(start.endDay) }
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val m = AdsBudgetModel(target, amount, hasEnd, endDay)
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheet, containerColor = erp.app.ui.theme.ErpColors.ground) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row3(
                title = if (target.level == "campaign") "Campaign budget" else "Ad set budget",
                busy = busy,
                canReview = m.after != null && (m.budgetChanged || m.endChanged),
                onCancel = onDismiss,
                onReview = { confirming = true },
            )
            AdsSection(target.name) {
                ValueRow("Now") { Text(m.nowLine) }
                ValueRow("Ends") { Text(m.endsLine) }
            }
            AdsSection(
                "Budget (${target.currency})",
                footer = { Column { for ((line, warn) in m.noteLines) Text(line, color = if (warn) Tone.owed.color() else androidx.compose.material3.LocalContentColor.current) } },
            ) {
                ValueRow(if (m.isDaily) "A day" else "In total") {
                    ValueInput(amount, { amount = it }, prompt = "Amount", label = if (m.isDaily) "A day" else "In total", keyboard = KeyboardType.Decimal)
                }
            }
            AdsSection("End", footer = { Text(if (m.isDaily) "Off runs it until it is paused." else "A total budget is spent by its end date.") }) {
                if (m.isDaily) ToggleRow("Ends on a day", hasEnd, { hasEnd = it })
                if (hasEnd || !m.isDaily) AdsDayRow("Ends", endDay, min = AppClock.now()) { endDay = it }
            }
            failure?.let { f ->
                AdsSection(null) { AdsWarningRow(f, Tone.problem, Icons.Filled.Warning) }
            }
        }
    }
    if (confirming) {
        AdsConfirm(
            title = "Change it at Meta?", message = m.review, confirm = "Change it",
            onDismiss = { confirming = false },
            onConfirm = {
                scope.launch {
                    busy = true
                    failure = null
                    try {
                        val v = m.after
                        if (m.budgetChanged && v != null) backend.setBudget(target.level, target.id, if (m.isDaily) v else null, if (m.isDaily) null else v)
                        if (m.endChanged) backend.setEnd(target.level, target.id, m.endAfter)
                        saved()
                        onDismiss()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = adsWords(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

/** The sheet's bar: Cancel, the title, Review (or a skeleton while it works). */
@Composable
private fun Row3(title: String, busy: Boolean, canReview: Boolean, onCancel: () -> Unit, onReview: () -> Unit) {
    androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        TextButton(onClick = onCancel, enabled = !busy) { Text("Cancel") }
        Text(title, Modifier.weight(1f), style = androidx.compose.material3.MaterialTheme.typography.titleMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (busy) erp.app.ui.SkeletonLoading(compact = true, label = "Saving")
        else TextButton(onClick = onReview, enabled = canReview) { Text("Review") }
    }
}
