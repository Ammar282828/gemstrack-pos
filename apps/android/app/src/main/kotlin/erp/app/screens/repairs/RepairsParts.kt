package erp.app.screens.repairs

import erp.app.ui.TextField
import erp.app.ui.icons.Symbols
import erp.app.ui.SearchBarField
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SelectableDates
import erp.app.ui.Switch
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.ui.LedgerHeading
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.ledgerCard
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// The few form and list pieces the Repairs screens need that the kit does not have yet (the iPhone's NavigationStack sheet,
// Form sections, swipeActions). Kept private to this group.

/**
 * A full-height sheet with a title and a close at its leading edge, a scrolling body and, when given, a bar pinned under it:
 * the counterpart of the iPhone's `NavigationStack { List … safeAreaBar }` sheets. [locked] keeps it from closing while a
 * write is out (`interactiveDismissDisabled`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RepairsSheetFrame(
    title: String,
    onDismiss: () -> Unit,
    cancelLabel: String = "Close",
    locked: Boolean = false,
    trailing: (@Composable (close: () -> Unit) -> Unit)? = null,
    bottom: (@Composable (close: () -> Unit) -> Unit)? = null,
    content: @Composable ColumnScope.(close: () -> Unit) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !locked })
    val scope = rememberCoroutineScope()
    val close: () -> Unit = { scope.launch { state.hide(); onDismiss() } }
    ModalBottomSheet(
        onDismissRequest = { if (!locked) onDismiss() },
        sheetState = state,
        containerColor = ErpColors.ground,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = close, enabled = !locked) { Text(cancelLabel) }
                Text(
                    title,
                    Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                )
                Box(Modifier.defaultMinSize(minWidth = 72.dp), contentAlignment = Alignment.CenterEnd) { trailing?.invoke(close) }
            }
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) { content(close) }
            if (bottom != null) Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { bottom(close) }
        }
    }
}

/** A titled card of rows with a footnote under it (the form's `Section`). */
@Composable
fun RepairsSection(
    modifier: Modifier = Modifier,
    title: String? = null,
    footer: String? = null,
    footerTone: Tone = Tone.quiet,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (title != null) LedgerHeading(title, Modifier.padding(horizontal = 16.dp))
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
        if (!footer.isNullOrEmpty()) {
            Text(
                footer, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall,
                color = if (footerTone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else footerTone.color(),
            )
        }
    }
}

/** A label and its value, the value trailing (`LabeledContent`); the value wraps rather than clipping. */
@Composable
fun RepairsLabeled(label: String, value: String, modifier: Modifier = Modifier, tint: Color = Color.Unspecified) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(
            value, Modifier.weight(1.4f), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            color = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else tint, textAlign = TextAlign.End,
        )
    }
}

/** A text box across the row. */
@Composable
fun RepairsField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    singleLine: Boolean = true,
    minLines: Int = 1,
    end: Boolean = false,
    supporting: String? = null,
) {
    TextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = singleLine,
        minLines = minLines,
        maxLines = if (singleLine) 1 else 5,
        textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = if (end) TextAlign.End else TextAlign.Start),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, capitalization = capitalization),
        supportingText = supporting?.let { { Text(it) } },
    )
}

/** A search box that sits at the top of the list (the iPhone's `.searchable`). */
@Composable
fun RepairsSearchField(value: String, onChange: (String) -> Unit, prompt: String, modifier: Modifier = Modifier) {
    SearchBarField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text(prompt) },
        leadingIcon = { Icon(Symbols.Search, contentDescription = null) },
        trailingIcon = if (value.isEmpty()) null else ({ IconButton(onClick = { onChange("") }) { Icon(Symbols.Close, "Clear search") } }),
        singleLine = true,
        shape = Radius.chipShape,
    )
}

@Composable
fun RepairsToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Switch) { onChange(!checked) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** A day to pick (`DatePicker(displayedComponents: .date)`): the row shows it, a tap opens the calendar. Days are Karachi's, "yyyy-MM-dd". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RepairsDayRow(label: String, day: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val date = runCatching { LocalDate.parse(day) }.getOrNull() ?: erp.app.screens.work.ShopToday.date()
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { open = true },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Symbols.CalendarMonth, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(erp.app.ui.ShopDate.say(day + "T00:00:00+05:00"), color = ErpColors.accent, fontWeight = FontWeight.Medium)
    }
    if (open) {
        val picker = rememberDatePickerState(
            initialSelectedDateMillis = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {},
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    // The picker's own calendar day, whatever time of day it holds.
                    picker.selectedDateMillis?.let { ms -> onPick(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(picker) }
    }
}
