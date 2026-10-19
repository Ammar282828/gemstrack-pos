package erp.app.screens.marketing

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.LedgerHeading
import erp.app.ui.Note
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.AppClock
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.ERPDate
import erp.core.logic.defaultSpreadEnd
import erp.core.logic.spreadTimes
import java.time.Instant
import java.time.LocalTime
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/** The times of Spread over the day (queue-panel.tsx `soon`, `atTime`), on Karachi's clock (pure, so it is tested). */
object PostQueueSpreadLogic {
    /** The next five-minute mark at least [min] minutes away. */
    fun soon(min: Int, now: Instant): Instant {
        val d = now.plusSeconds(min * 60L)
        // Karachi's offset is whole hours, so its minute is the epoch's.
        val minute = ((d.epochSecond / 60) % 60).toInt()
        val up = Math.ceil(minute / 5.0).toInt() * 5 - minute
        val floored = Instant.ofEpochSecond(d.epochSecond - d.epochSecond % 60)
        return floored.plusSeconds(up * 60L)
    }

    /** `time`'s hour and minute on `day`'s date. */
    fun onDay(day: Instant, time: LocalTime): Instant =
        day.atOffset(ERPDate.karachi).withHour(time.hour).withMinute(time.minute).withSecond(0).withNano(0).toInstant()

    /** The picked hour and minute today, or tomorrow if that has passed (more than a minute ago). */
    fun atTime(picked: LocalTime, now: Instant): Instant {
        val d = onDay(now, picked)
        return if (d.epochSecond - now.epochSecond < -60) d.plusSeconds(86_400) else d
    }

    fun clock(t: LocalTime): String = "%02d:%02d".format(t.hour, t.minute)

    fun time(hhmm: String): LocalTime = LocalTime.of(hhmm.substringBefore(':').toInt(), hhmm.substringAfter(':').toInt())

    fun localTime(at: Instant): LocalTime = at.atOffset(ERPDate.karachi).toLocalTime().withSecond(0).withNano(0)

    /** The window as the counter set it: the first today at that time, or tomorrow if it has passed; the last on the first one's day. */
    fun planned(n: Int, first: LocalTime, last: LocalTime, now: Instant): List<Instant> {
        val from = atTime(first, now)
        val to = onDay(from, last)
        return spreadTimes(n, from, to)
    }

    /** What the counter reads when it is done: "from 11:00 am to 8:30 pm", or "at 11:00 am" for one. */
    fun span(times: List<Instant>): String =
        if (times.size > 1) "from ${MarketingTime.clock(ERPDate.iso(times.first()))} to ${MarketingTime.clock(ERPDate.iso(times.last()))}"
        else "at ${MarketingTime.clock(times.firstOrNull()?.let { ERPDate.iso(it) })}"
}

/**
 * Spread over the day (queue-panel.tsx's dialog): the waiting pieces go out evenly between a first and a last time, in the
 * queue's order, each to wherever it was set to go. The times are `spreadTimes` (queue-plan.ts, in core); each piece is given
 * its time through the queue's own route, and the server's tick sends them, so nobody needs to keep the app open.
 */
@Composable
fun PostQueueSpreadSheet(onDone: (Note) -> Unit, onClose: () -> Unit) {
    val state by PostsStore.state.collectAsState()
    val scope = rememberCoroutineScope()
    val now = AppClock.now()
    var first by remember { mutableStateOf(PostQueueSpreadLogic.localTime(PostQueueSpreadLogic.soon(10, now))) }
    var last by remember {
        val start = PostQueueSpreadLogic.soon(10, now)
        val end = defaultSpreadEnd(now)
        mutableStateOf(PostQueueSpreadLogic.localTime(if (end > start) end else start))
    }
    var picking by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    val waiting = state.waiting
    val times = PostQueueSpreadLogic.planned(waiting.size, first, last, now)

    fun schedule() {
        val ids = waiting.map { it.id }
        val at = PostQueueSpreadLogic.planned(ids.size, first, last, AppClock.now())
        scope.launch {
            busy = "Giving each its time…"
            try {
                PostsStore.spread(ids, at)
                onDone(Note("${ids.size} ${PostTrayLogic.noun(ids.size)} spread ${PostQueueSpreadLogic.span(at)}", "They go by themselves: the app can be closed."))
                onClose()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: "Something went wrong."
            } finally {
                busy = null
            }
        }
    }

    FullScreenSheet(
        title = "Spread over the day", onCancel = { if (busy == null) onClose() },
        confirmText = "Schedule them", confirmEnabled = waiting.isNotEmpty() && busy == null, onConfirm = ::schedule,
    ) {
        PostQueueSpreadPage(state, first, last, times, busy, pickFirst = { picking = "first" }, pickLast = { picking = "last" })
    }
    picking?.let { which ->
        WebsiteTimeDialog(
            title = if (which == "first") "First" else "Last", initial = PostQueueSpreadLogic.clock(if (which == "first") first else last), fallback = "11:00",
            onDismiss = { picking = null },
            onPick = { hhmm ->
                val t = PostQueueSpreadLogic.time(hhmm)
                if (which == "first") first = t else last = t
                picking = null
            },
        )
    }
    FailureAlert(failure, { failure = null })
}

/** The sheet's page: the window, when each goes, and what is failing (drawn from state in hand, so the screenshot tests draw it from the demo). */
@Composable
fun PostQueueSpreadPage(state: PostsState, first: LocalTime, last: LocalTime, times: List<Instant>, busy: String?, pickFirst: () -> Unit, pickLast: () -> Unit) {
    val waiting = state.waiting
        Box(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().readableColumn(720.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                WebsiteCard(
                    footer = {
                        Text(
                            "The ${waiting.size} ${PostTrayLogic.noun(waiting.size)} go out evenly between these times, each to wherever it was set to go. " +
                                "They go by themselves: nobody needs to keep the app open.",
                        )
                    },
                ) {
                    TimeRow("First", first, pickFirst)
                    TimeRow("Last", last, pickLast)
                }
                if (waiting.isNotEmpty()) {
                    FormSection("When each goes") {
                        waiting.forEachIndexed { i, e ->
                            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(e.headline.ifEmpty { "Untitled" }, Modifier.weight(1f), maxLines = 1)
                                Text(
                                    times.getOrNull(i)?.let { ShopDate.stamp(it, withTime = true) } ?: "",
                                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                val failing = state.failingChecks
                if (failing.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LedgerHeading("Something they need is failing now", tone = Tone.problem)
                        for (c in failing) Text("${c.label}: ${c.fix ?: c.detail}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            WebsiteBusy(busy)
        }
}

@Composable
private fun TimeRow(label: String, time: LocalTime, pick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = pick).ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(WebsiteGoldTime.clock(PostQueueSpreadLogic.clock(time)), style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
    }
}

