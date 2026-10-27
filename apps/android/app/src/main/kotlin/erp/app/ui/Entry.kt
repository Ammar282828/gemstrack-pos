package erp.app.ui

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import kotlin.math.min

// The step flow New order and New sale share (TransactionWorkspace.swift): four steps on a phone, the editor
// beside an "At a glance" review on a wide window.

enum class EntryStep(val title: String) {
    customer("Customer"), pieces("Pieces"), payment("Payment"), review("Review");

    val next: EntryStep get() = entries[min(ordinal + 1, entries.size - 1)]
    val previous: EntryStep get() = entries[maxOf(ordinal - 1, 0)]
}

/** Where a step stands, shown on its tab: a tick when it is complete, an amber dot when it needs a look. */
enum class EntryStepState { done, attention }

/** The four steps as tabs. [states] is optional per step; a step with none shows its name alone. */
@Composable
fun EntrySteps(
    selection: EntryStep,
    onSelect: (EntryStep) -> Unit,
    modifier: Modifier = Modifier,
    states: Map<EntryStep, EntryStepState> = emptyMap(),
) {
    val focus = LocalFocusManager.current
    // A light tick as the step changes, from the tabs or from Continue.
    SelectionFeedback(selection)
    val tab: @Composable (EntryStep, Modifier) -> Unit = { step, m ->
        val chosen = selection == step
        val state = states[step]
        val spoken = "Step ${step.ordinal + 1} of 4: ${step.title}" + when (state) {
            EntryStepState.done -> ", done"
            EntryStepState.attention -> ", needs a look"
            null -> ""
        }
        Box(
            m
                .defaultMinSize(minHeight = MinTouchTarget)
                .clip(CircleShape)
                .background(if (chosen) MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent)
                .selectable(selected = chosen, role = Role.Tab) {
                    focus.clearFocus()
                    onSelect(step)
                }
                .semantics { contentDescription = spoken },
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (state == EntryStepState.done) Icon(Symbols.Check, contentDescription = null, Modifier.size(14.dp), tint = if (chosen) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    step.title,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (chosen) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
                if (state == EntryStepState.attention) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(Tone.owed.fill()))
                }
            }
        }
    }
    val rows = if (isLargeText()) 2 else 4
    Column(
        modifier.fillMaxWidth().background(ErpColors.ground).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        EntryStep.entries.chunked(rows).forEach { line ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                line.forEach { step -> tab(step, Modifier.weight(1f)) }
            }
        }
    }
}

/** Back and Continue under the steps. */
@Composable
fun EntryContinue(selection: EntryStep, onSelect: (EntryStep) -> Unit, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    fun move(step: EntryStep) {
        focus.clearFocus()
        onSelect(step)
    }
    Row(modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (selection != EntryStep.customer) {
            OutlinedButton(onClick = { move(selection.previous) }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                Icon(Symbols.ArrowBack, contentDescription = null, Modifier.size(18.dp))
                Text("Back", Modifier.padding(start = 6.dp))
            }
        }
        // The width goes on the label's row: the step's main action is a full-width button, not a small pill.
        Button(
            onClick = { move(selection.next) },
            Modifier.weight(1f).defaultMinSize(minHeight = MinTouchTarget).semantics { stateDescription = "Continue to ${selection.next.title}" },
        ) {
            Text("Continue")
            Icon(Symbols.ArrowForward, contentDescription = null, Modifier.padding(start = 6.dp).size(18.dp))
        }
    }
}

/**
 * The available window width decides the layout, including split-screen and resized windows: from 820 dp the
 * editor sits beside the review and its footer, below that the footer is pinned under the editor.
 */
@Composable
fun TransactionWorkspace(
    editor: @Composable () -> Unit,
    review: @Composable () -> Unit,
    footer: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier.fillMaxSize().background(ErpColors.ground)) {
        val available = maxWidth
        if (available >= 820.dp && !isLargeText()) {
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxHeight()) { editor() }
                // The review pane is its own tone (no rule between the panes).
                Column(Modifier.width(min(380f, available.value * 0.35f).dp).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainerLow)) {
                    Box(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp)) { review() }
                    footer()
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) { editor() }
                footer()
            }
        }
    }
}

data class TransactionReviewRow(val label: String, val value: String)

/** The same contextual summary accompanies piece editing on a wide window. */
@Composable
fun PieceInspector(title: String, rows: List<TransactionReviewRow>, modifier: Modifier = Modifier) {
    // Its parts are tonal tiles of one group: no rule between them.
    SegmentedColumn(modifier) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            GlanceTitle("Piece summary", Symbols.AutoAwesome)
            Text(title.ifEmpty { "New piece" }, style = MaterialTheme.typography.titleMedium)
        }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            rows.forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(row.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        row.value.ifEmpty { "—" },
                        style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.End,
                    )
                }
            }
        }
    }
}

/** "At a glance": who it is for, the pieces, and the figures, as three tiles of one group. */
@Composable
fun TransactionReview(
    customer: String,
    pieces: List<TransactionReviewRow>,
    figures: List<TransactionReviewRow>,
    modifier: Modifier = Modifier,
    contact: String = "",
) {
    SegmentedColumn(modifier) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            GlanceTitle("At a glance", Symbols.FactCheck)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(customer.ifEmpty { "Walk-in" }, style = MaterialTheme.typography.titleMedium)
                if (contact.isNotEmpty()) Text(contact, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "${pieces.size} piece${if (pieces.size == 1) "" else "s"}",
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (pieces.isEmpty()) {
                Text("Add a piece to begin.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            pieces.forEach { ReviewRow(it) }
        }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { figures.forEach { ReviewRow(it) } }
    }
}

@Composable
private fun GlanceTitle(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, Modifier.size(18.dp), tint = ErpColors.accent)
        Text(text, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = ErpColors.accent)
    }
}

@Composable
private fun ReviewRow(row: TransactionReviewRow) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Text(row.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(
            row.value,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = TabularDigits),
            textAlign = TextAlign.End,
        )
    }
}
