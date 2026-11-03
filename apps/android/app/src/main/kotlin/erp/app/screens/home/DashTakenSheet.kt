package erp.app.screens.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.window.core.layout.WindowSizeClass
import erp.app.nav.LocalNavigator
import erp.app.ui.FullScreenSheet
import erp.app.ui.RowAmount
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import kotlin.math.max

// "Taken today", opened (DashboardTaken.swift `DashTakenSheet`): a bar for each day of money taken, a segmented 7 days /
// This month / 30 days / 90 days, and under it the chosen day: its total, how it was paid, and every entry. A bottom sheet on
// a phone, a full-screen page on a tablet. Today's cash (the drawer) is the other screen.

@Composable
fun DashTakenSheet(days: List<DashTakenDay>, monthLength: Int, onDismiss: () -> Unit) {
    val wide = currentWindowAdaptiveInfoV2().windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)
    if (wide) {
        FullScreenSheet(title = "Taken", onCancel = onDismiss, cancelText = "Close") {
            TakenBody(days, monthLength, onDismiss, Modifier.padding(horizontal = 16.dp))
        }
    } else {
        @OptIn(ExperimentalMaterial3Api::class)
        ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Text("Taken", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleLarge)
            TakenBody(days, monthLength, onDismiss, Modifier.navigationBarsPadding().padding(horizontal = 16.dp))
        }
    }
}

@Composable
private fun TakenBody(days: List<DashTakenDay>, monthLength: Int, onDismiss: () -> Unit, modifier: Modifier) {
    var rangeName by rememberSaveable { mutableStateOf(DashTakenRange.week.name) }
    val range = DashTakenRange.valueOf(rangeName)
    var pickedDay by rememberSaveable { mutableStateOf<Long?>(null) }
    val list = remember(days, range, monthLength) { range.shown(days, monthLength) }
    val chosen = list.firstOrNull { it.day.epochSecond == pickedDay } ?: list.lastOrNull()
    val nav = LocalNavigator.current

    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(top = 8.dp, bottom = 24.dp).widthIn(max = 900.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            DashTakenRange.entries.forEachIndexed { i, r ->
                SegmentedButton(
                    selected = r == range, onClick = { rangeName = r.name; pickedDay = null },
                    shape = SegmentedButtonDefaults.itemShape(i, DashTakenRange.entries.size),
                ) { Text(r.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        Summary(range, list)
        TakenChart(list, chosen?.day?.epochSecond, range) { pickedDay = it }
        if (chosen != null) Detail(chosen) { path -> onDismiss(); nav.open(path) }
    }
}

@Composable
private fun Summary(range: DashTakenRange, list: List<DashTakenDay>) {
    val total = list.sumOf { it.total }
    val busy = list.count { it.total > 0 }
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        DashLabel(range.heading)
        Text(Money.pkrLac(total), style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
        if (busy > 0) {
            Text(
                "${Money.pkrLac(total / busy)} on an average day with sales",
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Bars for each day, the chosen one in the accent; a tap or a drag across them picks the day under the finger. */
@Composable
private fun TakenChart(list: List<DashTakenDay>, chosenAt: Long?, range: DashTakenRange, onPick: (Long) -> Unit) {
    val accent = ErpColors.accent
    val grey = MaterialTheme.colorScheme.onSurfaceVariant
    val top = list.maxOfOrNull { it.total } ?: 0.0
    val spoken = "Money taken each day, ${range.label}: " + list.filter { it.total > 0 }.joinToString(", ") { DashDate.dayMonth(it.day) + " " + Money.pkrLac(it.total) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            Text("Taken each day", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = grey)
            Text("Peak " + Money.axisLac(top), style = MaterialTheme.typography.labelSmall, color = grey)
        }
        Canvas(
            Modifier.fillMaxWidth().height(200.dp).semantics { contentDescription = spoken }
                .pointerInput(list) { detectTapGestures { p -> if (list.isNotEmpty()) onPick(list[((p.x / size.width) * list.size).toInt().coerceIn(0, list.size - 1)].day.epochSecond) } }
                .pointerInput(list) { detectHorizontalDragGestures { c, _ -> if (list.isNotEmpty()) onPick(list[((c.position.x / size.width) * list.size).toInt().coerceIn(0, list.size - 1)].day.epochSecond) } },
        ) {
            val slot = size.width / max(list.size, 1)
            val bar = (slot * 0.7f).coerceIn(2.dp.toPx(), 28.dp.toPx())
            val floor = size.height - 0.5.dp.toPx()
            list.forEachIndexed { i, d ->
                val h = if (top > 0) ((d.total / top).toFloat() * (floor - 2.dp.toPx())).coerceAtLeast(0f) else 0f
                if (h > 0f) {
                    drawRoundRect(
                        if (d.day.epochSecond == chosenAt) accent else accent.copy(alpha = 0.3f),
                        Offset(slot * i + (slot - bar) / 2, floor - h), Size(bar, h), CornerRadius(minOf(bar / 2, 3.dp.toPx())),
                    )
                }
            }
            drawLine(grey.copy(alpha = 0.2f), Offset(0f, floor), Offset(size.width, floor), strokeWidth = 1.dp.toPx())
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            Text(list.firstOrNull()?.let { DashDate.dayMonth(it.day) } ?: "", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = grey)
            Text(list.lastOrNull()?.let { DashDate.dayMonth(it.day) } ?: "", style = MaterialTheme.typography.labelSmall, color = grey)
        }
    }
}

@Composable
private fun Detail(d: DashTakenDay, open: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            DashLabel(DashDate.longDay(d.day))
            Text(Money.pkr(d.total), style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
            if (d.entries.isNotEmpty()) Text(d.countsLine, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (d.entries.isEmpty()) {
            Text("Nothing was taken this day.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            SplitCard(d)
            Column(Modifier.fillMaxWidth().ledgerCard(padding = 0.dp)) {
                d.entries.forEachIndexed { i, e ->
                    if (i > 0) erp.app.ui.LedgerDivider()
                    EntryRow(e, open)
                }
            }
        }
    }
}

/** The day by how it was paid, with how many entries each way. */
@Composable
private fun SplitCard(d: DashTakenDay) {
    Column(Modifier.fillMaxWidth().ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (m in DashTakenMethod.entries) {
            val v = d.bySplit[m] ?: continue
            if (v < 0.5) continue
            val tone = if (m == DashTakenMethod.unpaid) Tone.owed.color() else androidx.compose.ui.graphics.Color.Unspecified
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(m.label, style = MaterialTheme.typography.bodyMedium, color = if (m == DashTakenMethod.unpaid) tone else MaterialTheme.colorScheme.onSurface)
                Text("${d.splitCounts[m] ?: 0}", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("", Modifier.weight(1f))
                RowAmount(v, tone = tone)
            }
        }
    }
}

@Composable
private fun EntryRow(e: DashTakenEntry, open: (String) -> Unit) {
    val line = listOf(e.time, e.who).filter { it.isNotEmpty() }.joinToString(" · ")
    val label = e.customer.ifEmpty { e.what }
    val path = e.path
    val icon = when (e.kind) {
        DashTakenKind.sale -> Symbols.Receipt
        DashTakenKind.order -> Symbols.ListAlt
        DashTakenKind.repair -> Symbols.Build
        DashTakenKind.extra -> Symbols.AddCircle
    }
    Row(
        Modifier.fillMaxWidth()
            .then(if (path != null) Modifier.clickable(role = Role.Button, onClickLabel = "Open ${e.ref}") { open(path) } else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$label, ${e.what}, ${Money.pkr(e.amount)}, ${e.methodText}" },
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                if (e.customer.isEmpty()) e.methodText else listOf(e.what, e.ref).filter { it.isNotEmpty() }.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (line.isEmpty()) e.methodText else "$line · ${e.methodText}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        RowAmount(e.amount)
        if (path != null) DashChevron()
    }
}
