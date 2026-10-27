package erp.app.screens.settings.label

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.ui.MinTouchTarget
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.LabelUnits

// The rows the designer's panels are made of (the iPhone's LabelNumberRow, LabelDotRow and the Form's Slider and segmented
// Picker). Numbers are typed or stepped; a typed half-number ("-", "") waits until it reads.

/** A whole number typed in a small box, with a unit and a stepper at its right edge. */
@Composable
fun LabelNumberRow(title: String, value: Int, onChange: (Int) -> Unit, unit: String? = null, range: IntRange = 0..32000) {
    Row(
        Modifier.fillMaxWidth().ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        NumberBox(value, onChange, range, Modifier.widthIn(min = 44.dp, max = 72.dp), title)
        if (unit != null) Text(unit, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, modifier = Modifier.widthIn(max = 70.dp))
        Stepper(value, onChange, range, title)
    }
}

/** A distance in dots and in millimetres, each editable. */
@Composable
fun LabelDotRow(title: String, dots: Int, dpi: Int?, onChange: (Int) -> Unit, range: IntRange = -2000..32000) {
    Row(
        Modifier.fillMaxWidth().ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        NumberBox(dots, onChange, range, Modifier.widthIn(min = 44.dp, max = 64.dp), "$title in dots")
        Text("dots", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        var text by remember(dots, dpi) { mutableStateOf(LabelUnits.mmText(dots.toDouble(), dpi)) }
        BasicTextField(
            value = text,
            onValueChange = { t ->
                text = t
                t.toDoubleOrNull()?.let { onChange(LabelUnits.dots(it, dpi).coerceIn(range.first, range.last)) }
            },
            modifier = Modifier.widthIn(min = 40.dp, max = 56.dp).defaultMinSize(minHeight = MinTouchTarget).semantics { contentDescription = "$title in millimetres" },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.End, fontFeatureSettings = TabularDigits),
            cursorBrush = SolidColor(ErpColors.accent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            decorationBox = { inner -> Box(Modifier.defaultMinSize(minHeight = MinTouchTarget), contentAlignment = Alignment.CenterEnd) { inner() } },
        )
        Text("mm", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun NumberBox(value: Int, onChange: (Int) -> Unit, range: IntRange, modifier: Modifier, label: String) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    BasicTextField(
        value = text,
        onValueChange = { t ->
            text = t
            t.toIntOrNull()?.let { onChange(it.coerceIn(range.first, range.last)) }
        },
        modifier = modifier.defaultMinSize(minHeight = MinTouchTarget).semantics { contentDescription = label },
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.End, fontFeatureSettings = TabularDigits),
        cursorBrush = SolidColor(ErpColors.accent),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        decorationBox = { inner -> Box(Modifier.defaultMinSize(minHeight = MinTouchTarget), contentAlignment = Alignment.CenterEnd) { inner() } },
    )
}

@Composable
private fun RowScope.Stepper(value: Int, onChange: (Int) -> Unit, range: IntRange, label: String) {
    IconButton(onClick = { onChange((value - 1).coerceIn(range.first, range.last)) }, Modifier.size(MinTouchTarget).semantics { contentDescription = "Less $label" }) {
        Icon(Symbols.Remove, null, tint = ErpColors.accent)
    }
    IconButton(onClick = { onChange((value + 1).coerceIn(range.first, range.last)) }, Modifier.size(MinTouchTarget).semantics { contentDescription = "More $label" }) {
        Icon(Symbols.Add, null, tint = ErpColors.accent)
    }
}

/** A titled slider with its value said in the title. */
@Composable
fun LabelSliderRow(title: String, value: Double, range: ClosedFloatingPointRange<Double>, onChange: (Double) -> Unit, enabled: Boolean = true) {
    androidx.compose.foundation.layout.Column(Modifier.fillMaxWidth().ledgerRow()) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        Slider(
            value = value.toFloat().coerceIn(range.start.toFloat(), range.endInclusive.toFloat()),
            onValueChange = { onChange(it.toDouble()) },
            valueRange = range.start.toFloat()..range.endInclusive.toFloat(),
            enabled = enabled,
        )
    }
}

/** A few choices side by side (the segmented Picker). */
@Composable
fun LabelSegments(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, enabled: Boolean = true) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        options.forEachIndexed { i, (value, text) ->
            SegmentedButton(
                selected = value == selected,
                onClick = { onSelect(value) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                enabled = enabled,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) { Text(text, maxLines = 1) }
        }
    }
}

/** A row that opens something: its words in the accent, and a small line under it. */
@Composable
fun LabelTapRow(title: String, onClick: () -> Unit, sub: String? = null, enabled: Boolean = true, icon: androidx.compose.ui.graphics.vector.ImageVector? = null, danger: Boolean = false) {
    val ink = when {
        !enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        danger -> Tone.problem.color()
        else -> ErpColors.accent
    }
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(22.dp), tint = ink)
        androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = ink)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
