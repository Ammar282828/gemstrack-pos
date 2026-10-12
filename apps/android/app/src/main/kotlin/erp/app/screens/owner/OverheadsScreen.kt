package erp.app.screens.owner

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.RemoveCircle
import androidx.compose.material.icons.filled.TrendingDown
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.money.Footnote
import erp.app.screens.money.MoneyOwnersOnly
import erp.app.screens.money.Host
import erp.app.screens.money.cardEdges
import erp.app.screens.money.rememberScreenNote
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.LedgerHeading
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.RowAmount
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.core.logic.OverheadMonthRow
import erp.core.logic.OverheadProgress
import erp.core.logic.OverheadSummary
import erp.core.logic.Overheads
import erp.core.models.OverheadItem
import erp.core.models.OverheadPlansAnswer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.UUID

/**
 * Money → Overheads (src/app/overheads/page.tsx): what this month has to cover before anything is profit, whether each
 * month since the benchmark started did, and the sheet that makes the target.
 *
 * The sheet is a benchmark, not a ledger: nothing on it is an expense, counted against profit or put in the hisaab. Its
 * plans come from the ERP (/api/app/overheads, resolved as the page resolves them, the starting sheet included); the
 * score is worked out here from the books by the page's own rules (core's Overheads, ported from lib/overheads.ts). A
 * save applies from this month on, so a month already scored keeps the target it was scored against
 * (`saveOverheadPlan`, lib/writes/overheads.ts). Owners only.
 */
@Composable
fun OverheadsScreen() {
    if (!LocalSession.current.isOwner) {
        MoneyOwnersOnly("Overheads")
        return
    }
    OverheadsBoard()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OverheadsBoard() {
    val book = LocalBook.current
    val scope = rememberCoroutineScope()
    val invoices = rememberShelfStatus(book.invoices)
    val orders = rememberShelfStatus(book.orders)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val note = rememberScreenNote()

    var answer by remember { mutableStateOf<OverheadPlansAnswer?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var lines by remember { mutableStateOf<List<OverheadDraftLine>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    // One clock for the whole screen, so the month boundary and the days-left figure cannot disagree part-way down.
    var now by remember { mutableStateOf(Instant.now()) }

    val thisMonth = Overheads.monthKey(now)
    val monthName = Overheads.monthLabel(thisMonth).substringBefore(' ')
    val plans = answer?.plans ?: emptyList()
    // The sheet in force this month, as saved.
    val liveItems = Overheads.planForMonth(plans, thisMonth) ?: emptyList()
    // What is on screen: the bar moves with an edit before it is saved.
    val items = lines.map { it.item }
    val dirty = answer != null && lines != OverheadDraftLine.lines(liveItems)
    val dirtyNow by rememberUpdatedState(dirty)
    val ready = (answer != null || loadError != null) && invoices.loaded && orders.loaded

    /** The plans, from the ERP. What arrives is adopted, but never over the top of an edit in progress. */
    suspend fun load() {
        val wasDirty = dirtyNow
        try {
            val a = ErpApi.shared.getModel<OverheadPlansAnswer>("/api/app/overheads") ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
            val at = Instant.now()
            answer = a
            loadError = null
            now = at
            if (!wasDirty) lines = OverheadDraftLine.lines(Overheads.planForMonth(a.plans, Overheads.monthKey(at)) ?: emptyList())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (answer == null) loadError = e.message ?: e.toString()
        }
    }
    LaunchedEffect(Unit) { load() }

    fun add() {
        lines = lines + OverheadDraftLine(Overheads.newOverheadId(items))
    }

    ScreenTitle("Overheads")
    ScreenActions {
        IconButton(onClick = ::add, enabled = answer != null) { Icon(Icons.Filled.Add, contentDescription = "Add a line") }
    }

    /**
     * The ERP saves it from this month on (its own clock, in Karachi) and answers with the plans now on file; blank
     * lines are dropped there, as the page drops them.
     */
    fun save() {
        if (saving) return
        saving = true
        saveError = null
        scope.launch {
            try {
                val kept = OverheadsSave.withUniqueIds(items)
                // `seq` makes each save its own: the same sheet saved, changed and saved back within half a minute is
                // not one change sent twice (ErpApi names a write by its content).
                val out = ErpApi.shared.write("saveOverheadPlan", OverheadsSave.fields(kept, UUID.randomUUID().toString()))
                val from = out["from"] as? String ?: thisMonth
                val saved = (out["items"] as? List<*>).orEmpty().mapNotNull { (it as? Map<*, *>)?.let { m -> @Suppress("UNCHECKED_CAST") OverheadItem.fromMap(m as Map<String, Any?>) } }
                // The answer carries the plans now on file: the record and the sheet are drawn from them.
                val onFile = out["plans"]
                if (onFile != null) {
                    val a = OverheadPlansAnswer.fromMap(mapOf("start" to (answer?.start ?: Overheads.benchmarkStart), "plans" to onFile, "saved" to true))
                    answer = a
                    lines = OverheadDraftLine.lines(Overheads.planForMonth(a.plans, thisMonth) ?: emptyList())
                } else {
                    lines = OverheadDraftLine.lines(saved)
                }
                note.show(Note("Benchmark saved", "${OwnerText.pkr(Overheads.overheadTotal(saved))} a month, from ${Overheads.monthLabel(from)}."))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                saveError = e.message ?: e.toString()
            }
            saving = false
        }
    }

    Box(Modifier.fillMaxSize()) {
        ShelfState(
            loaded = ready, error = invoices.error ?: orders.error, offline = invoices.offline, connectionLost = connectionLost,
        ) {
            val revenue by produceState<Map<String, erp.core.logic.OverheadRevenue>?>(null, invoices.revision, orders.revision) {
                value = withContext(Dispatchers.Default) { Overheads.revenueByMonth(invoices.items, orders.items) }
            }
            val byMonth = revenue
            if (byMonth == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                val rows = remember(plans, byMonth, now) { Overheads.monthlyRows(plans, byMonth, now) }
                val summary = remember(rows) { Overheads.benchmarkSummary(rows) }
                val current = rows.firstOrNull { it.inProgress }
                val target = Overheads.overheadTotal(items)
                val earned = current?.earned ?: 0.0
                val p = Overheads.overheadProgress(target, earned, now)
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 4.dp, bottom = if (dirty) 190.dp else 96.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        if (answer == null && loadError != null) item(key = "error") {
                            Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                LedgerHeading("Couldn’t read the sheet")
                                Row(
                                    Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(16.dp),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Filled.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(loadError.orEmpty(), Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                TextButton(onClick = { scope.launch { load() } }) {
                                    Icon(Icons.Filled.Autorenew, contentDescription = null)
                                    Text("  Try again")
                                }
                            }
                        }
                        item(key = "month") { ThisMonth(target, earned, p, monthName) }
                        item(key = "record") { Record(rows, summary) }
                        if (answer != null) item(key = "sheet") {
                            Sheet(
                                lines, target, thisMonth,
                                onChange = { id, edit -> lines = lines.map { if (it.id == id) edit(it) else it } },
                                onAdd = ::add,
                                onRemove = { id -> lines = lines.filter { it.id != id } },
                            )
                        }
                    }
                }
            }
        }
        if (dirty) {
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
                SaveBar(
                    saveError, saving, monthName,
                    onDiscard = { lines = OverheadDraftLine.lines(liveItems); saveError = null },
                    onSave = ::save,
                )
            }
        }
        note.Host()
    }
}

// MARK: This month, first

@Composable
private fun ThisMonth(target: Double, earned: Double, p: OverheadProgress, monthName: String) {
    val met = p.shortfall == 0.0 && target > 0
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Footnote("What $monthName has to cover before anything is profit. Scored from ${Overheads.monthLabel(Overheads.benchmarkStart)}.")
        FigureRow(spacing = 10.dp) {
            FigureTile("Needed this month", OwnerText.pkr(target), Modifier.share(), tint = ErpColors.accent, number = target)
            FigureTile("Revenue so far", OwnerText.pkr(earned), Modifier.share(), number = earned)
        }
        Column(Modifier.ledgerCard(padding = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            LinearProgressIndicator(
                progress = { (p.percent / 100.0).coerceIn(0.0, 1.0).toFloat() },
                modifier = Modifier.fillMaxWidth(), color = ErpColors.accent,
            )
            if (met) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.TrendingUp, contentDescription = null, tint = Tone.settled.color())
                    Text(
                        "Covered — ${OwnerText.pkr(earned - target)} above the benchmark",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = Tone.settled.color(),
                    )
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    RowAmount(p.shortfall, tone = ErpColors.accent)
                    Text("still to earn", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CalendarMonth, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(daysLine(p, met), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** "22 days left · PKR 8,455/day". */
internal fun daysLine(p: OverheadProgress, met: Boolean): String {
    val days = "${p.daysLeft} day${if (p.daysLeft == 1) "" else "s"} left"
    return if (met) days else "$days · ${OwnerText.pkr(p.perDayNeeded)}/day"
}

// MARK: The record

@Composable
private fun Record(rows: List<OverheadMonthRow>, s: OverheadSummary) {
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Month by month", Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().cardEdges(first = true, last = true)) {
            rows.forEachIndexed { i, r ->
                if (i > 0) erp.app.ui.LedgerDivider()
                MonthRow(r)
            }
        }
        Footnote(summaryLine(s))
    }
}

internal fun summaryLine(s: OverheadSummary): String {
    if (s.monthsScored == 0) {
        return "Nothing scored yet — ${Overheads.monthLabel(Overheads.benchmarkStart)} is the first full month."
    }
    return "${s.monthsMet} of ${s.monthsScored} finished month${if (s.monthsScored == 1) "" else "s"} cleared the benchmark" +
        " · average ${OwnerText.pkr(s.averageRevenue)} · running ${OwnerText.signed(s.cumulativeSurplus)}"
}

@Composable
private fun MonthRow(r: OverheadMonthRow) {
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    val tone: Color = if (r.inProgress) quiet else if (r.met) Tone.settled.color() else Tone.owed.color()
    val icon = if (r.inProgress) Icons.Filled.RemoveCircle else if (r.met) Icons.Filled.CheckCircle else Icons.Filled.TrendingDown
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tone)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (r.inProgress) "${r.label} · so far" else r.label, style = MaterialTheme.typography.bodyLarge, maxLines = 2)
            Text("${OwnerText.pkr(r.earned)} of ${OwnerText.pkr(r.target)}", style = MaterialTheme.typography.bodySmall, color = quiet)
        }
        Text(
            OwnerText.signed(r.surplus),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = if (r.inProgress) quiet else if (r.surplus >= 0) Tone.settled.color() else Tone.owed.color(),
        )
    }
}

// MARK: The sheet that produces the target

@Composable
private fun Sheet(
    lines: List<OverheadDraftLine>,
    target: Double,
    thisMonth: String,
    onChange: (String, (OverheadDraftLine) -> OverheadDraftLine) -> Unit,
    onAdd: () -> Unit,
    onRemove: (String) -> Unit,
) {
    Column(Modifier.padding(horizontal = 16.dp).readableColumn(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("The sheet", Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().cardEdges(first = true, last = true).padding(vertical = 4.dp)) {
            for (line in lines) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = line.label, onValueChange = { v -> onChange(line.id) { it.copy(label = v) } },
                        modifier = Modifier.weight(1f), label = { Text("What is it for") }, singleLine = true,
                    )
                    OutlinedTextField(
                        value = line.amountText, onValueChange = { v -> onChange(line.id) { it.copy(amountText = v) } },
                        modifier = Modifier.weight(0.7f), label = { Text("Amount") }, singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    IconButton(onClick = { onRemove(line.id) }) { Icon(Icons.Filled.Close, contentDescription = "Remove ${line.label.ifEmpty { "this line" }}") }
                }
            }
            TextButton(onClick = onAdd, Modifier.padding(horizontal = 8.dp)) {
                Icon(Icons.Filled.AddCircleOutline, contentDescription = null)
                Text("  Add a line")
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Total", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                RowAmount(target, tone = ErpColors.accent)
            }
        }
        Footnote(
            "A benchmark, not a ledger. Nothing here is recorded as an expense or counted against profit — enter the real payments in Expenses as they go out. " +
                "Changes apply from ${Overheads.monthLabel(thisMonth)} onward; months already scored keep the target they were scored against.",
        )
    }
}

// MARK: Saving

@Composable
private fun SaveBar(saveError: String?, saving: Boolean, monthName: String, onDiscard: () -> Unit, onSave: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (saveError != null) {
            Text(
                saveError,
                Modifier.fillMaxWidth().clip(Radius.chipShape).background(ErpColors.card).padding(10.dp),
                style = MaterialTheme.typography.bodySmall, color = Tone.problem.color(), textAlign = TextAlign.Center,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth().readableColumn()) {
            OutlinedButton(onClick = onDiscard, enabled = !saving, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.Undo, contentDescription = null)
                Text("  Discard")
            }
            Button(onClick = onSave, enabled = !saving, modifier = Modifier.weight(1f)) {
                if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = ErpColors.onAccent)
                Text("Save from $monthName")
            }
        }
    }
}
