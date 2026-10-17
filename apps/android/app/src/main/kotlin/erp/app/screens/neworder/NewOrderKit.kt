package erp.app.screens.neworder

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.selection.toggleable
import erp.app.ui.theme.ErpColors
import erp.app.ui.LedgerHeading
import erp.app.ui.PaymentText
import erp.app.ui.MinTouchTarget
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.isLargeText
import erp.core.entry.NewOrderDay

// The controls the order form's views share (NewOrderKit.swift): a section card of rows, a labelled field whose
// number boxes show 0 as blank, a quick chip, a picker, a day, and the full-screen page the piece editor and the
// slip reader open in (the iPhone pushes them on the form's own stack; here they sit over it).

// MARK: The section card

/** A titled card of rows with its footnote under it; the form's `Section`. */
@Composable
internal fun FormCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    footer: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null) LedgerHeading(title, Modifier.padding(horizontal = 4.dp))
        Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card), content = content)
        if (!footer.isNullOrEmpty()) {
            Text(
                footer,
                Modifier.padding(horizontal = 4.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** A row's inset and a hairline under it (the rows of a card are told apart by their lines). */
@Composable
internal fun Modifier.formRow(): Modifier {
    val line = MaterialTheme.colorScheme.outlineVariant
    return defaultMinSize(minHeight = 52.dp)
        .drawBehind {
            drawLine(line, Offset(16.dp.toPx(), size.height), Offset(size.width, size.height), strokeWidth = 0.5.dp.toPx())
        }
        .padding(horizontal = 16.dp, vertical = 6.dp)
}

// MARK: Fields

/**
 * A field with no frame, on the card: [QuietField] with the placeholder shown while empty. Text and number boxes
 * share it; a number box is blank for 0 (decisions.md "Number fields") because the draft holds text.
 */
@Composable
internal fun QuietField(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    autoCorrect: Boolean = true,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 6,
    end: Boolean = false,
    label: String? = null,
    onFocus: ((Boolean) -> Unit)? = null,
) {
    val focus = LocalFocusManager.current
    val ink = MaterialTheme.colorScheme.onSurface
    val style: TextStyle = MaterialTheme.typography.bodyLarge.copy(
        color = ink,
        textAlign = if (end) TextAlign.End else TextAlign.Start,
    )
    BasicTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier
            .let { m -> if (label != null) m.semantics { contentDescription = label } else m }
            .let { m -> if (onFocus != null) m.onFocusChanged { onFocus(it.isFocused) } else m },
        textStyle = style,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        cursorBrush = SolidColor(ErpColors.accent),
        keyboardOptions = KeyboardOptions(
            keyboardType = keyboardType,
            capitalization = capitalization,
            autoCorrectEnabled = autoCorrect,
            imeAction = if (singleLine) ImeAction.Done else ImeAction.Default,
        ),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        decorationBox = { inner ->
            Box(contentAlignment = if (end) Alignment.CenterEnd else Alignment.CenterStart) {
                if (value.isEmpty() && placeholder.isNotEmpty()) {
                    Text(
                        placeholder,
                        style = style.copy(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                inner()
            }
        },
    )
}

/** A labelled box: the label leads, the figure sits right (LabeledContent + TextField). Stacks at large text sizes. */
@Composable
internal fun FieldRow(
    title: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    prompt: String = "",
    unit: String? = null,
    number: Boolean = false,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    keyboardType: KeyboardType = if (number) KeyboardType.Decimal else KeyboardType.Text,
    onFocus: ((Boolean) -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val field: @Composable (Modifier) -> Unit = { m ->
        QuietField(
            value, onChange, m, placeholder = prompt, keyboardType = keyboardType, capitalization = capitalization,
            autoCorrect = !number, end = !isLargeText(), label = title, onFocus = onFocus,
        )
    }
    if (isLargeText()) {
        Column(modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                field(Modifier.weight(1f))
                if (unit != null) Text(unit, color = MaterialTheme.colorScheme.onSurfaceVariant)
                trailing?.invoke()
            }
        }
    } else {
        Row(modifier.fillMaxWidth().formRow(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, Modifier.weight(0.45f), style = MaterialTheme.typography.bodyLarge)
            Row(Modifier.weight(0.55f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                field(Modifier.weight(1f))
                if (unit != null) Text(unit, color = MaterialTheme.colorScheme.onSurfaceVariant)
                trailing?.invoke()
            }
        }
    }
}

/**
 * A labelled number box: blank for 0, the decimal pad, figures lined up on the right (NewOrderNumberRow). A sum of
 * money (`rupees`) takes the number pad and whole rupees only (owner, 2026-10-17: "there should be no decimals");
 * weights, rates and percentages keep their decimals.
 */
@Composable
internal fun NumberRow(title: String, value: String, onChange: (String) -> Unit, prompt: String = "", unit: String? = null, rupees: Boolean = false) {
    if (rupees) FieldRow(title, PaymentText.whole(value), { onChange(PaymentText.whole(it)) }, prompt = prompt, unit = unit, number = true, keyboardType = KeyboardType.Number)
    else FieldRow(title, value, onChange, prompt = prompt, unit = unit, number = true)
}

/** A text box across the row, for what runs long (a description, notes, an address). */
@Composable
internal fun WideFieldRow(
    title: String,
    value: String,
    onChange: (String) -> Unit,
    prompt: String = "",
    minLines: Int = 2,
    maxLines: Int = 6,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
) {
    Column(Modifier.fillMaxWidth().formRow()) {
        QuietField(
            value, onChange, Modifier.fillMaxWidth(), placeholder = prompt, singleLine = false, minLines = minLines,
            maxLines = maxLines, capitalization = capitalization, label = title,
        )
    }
}

// MARK: Switches, pickers, days, actions

@Composable
internal fun ToggleRow(title: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().formRow()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .semantics { stateDescription = if (checked) "On" else "Off" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** A menu picker: the label leads, the choice shows at the right, and a tap opens the list ([options] are id to label). */
@Composable
internal fun PickerRow(title: String, selected: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == selected }?.second ?: selected
    Box {
        Row(
            Modifier.fillMaxWidth().formRow().clickable(role = Role.DropdownList) { open = true }
                .semantics { contentDescription = "$title, $shown" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text(shown, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
            Icon(Icons.Filled.ArrowDropDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (id, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(id) })
            }
        }
    }
}

/** A day, said the shop's way; a tap opens the calendar. The value is a bare "yyyy-MM-dd" (Karachi). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DateRow(title: String, day: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val said = NewOrderDay.date(day)?.let { ShopDate.stamp(it) } ?: "Choose"
    Row(
        Modifier.fillMaxWidth().formRow().clickable(role = Role.Button) { open = true }
            .semantics { contentDescription = "$title, $said" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(said, color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
    }
    if (open) {
        val start = NewOrderLogic.dayToPickerMillis(day) ?: NewOrderLogic.dayToPickerMillis(NewOrderDay.today)
        val state = rememberDatePickerState(initialSelectedDateMillis = start)
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onPick(NewOrderLogic.pickerMillisToDay(it)) }
                    open = false
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
}

/** A text action in a row ("Use today's rates", "Add a piece"): the accent, with an optional leading icon. */
@Composable
internal fun ActionRow(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    destructive: Boolean = false,
    enabled: Boolean = true,
) {
    val ink = if (destructive) Tone.problem.color() else ErpColors.accent
    Row(
        modifier.fillMaxWidth().formRow().clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(20.dp), tint = ink)
        Text(text, Modifier.weight(1f), color = ink, style = MaterialTheme.typography.bodyLarge)
    }
}

/** A line of words in the card (a note, a warning), with an optional icon. */
@Composable
internal fun NoteRow(
    text: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    tone: Tone = Tone.quiet,
    modifier: Modifier = Modifier,
) {
    val ink = if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else tone.color()
    Row(modifier.fillMaxWidth().formRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        if (icon != null) Icon(icon, null, Modifier.padding(top = 2.dp).size(20.dp), tint = ink)
        Text(text, Modifier.weight(1f), color = ink, style = MaterialTheme.typography.bodyMedium)
    }
}

/** A label and its value at the right (LabeledContent), the value in tabular figures. */
@Composable
internal fun ValueRow(title: String, value: String, modifier: Modifier = Modifier, strong: Boolean = false, tone: Tone = Tone.quiet) {
    Row(
        modifier.fillMaxWidth().formRow().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(
            value,
            style = (if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge).copy(
                fontFeatureSettings = erp.app.ui.theme.TabularDigits,
                fontWeight = if (strong) androidx.compose.ui.text.font.FontWeight.Bold else androidx.compose.ui.text.font.FontWeight.Medium,
            ),
            color = if (tone == Tone.quiet) LocalContentColor.current else tone.color(),
            textAlign = TextAlign.End,
        )
    }
}

/** A quick choice (7d, 10d, 14d): a capsule, the chosen one in the accent. */
@Composable
internal fun NewOrderChip(title: String, on: Boolean, onClick: () -> Unit) {
    erp.app.ui.FilterChip(title, chosen = on, onClick = onClick)
}

/** A size box: type it (an off-scale size is allowed), or pick from the scale. */
@Composable
internal fun SizeFieldRow(title: String, options: List<String>, value: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    FieldRow(
        title, value, onChange, prompt = "Optional",
        trailing = {
            Box {
                IconButton(onClick = { open = true }, Modifier.size(MinTouchTarget)) {
                    Icon(Icons.Filled.UnfoldMore, "Choose a $title from the scale", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    DropdownMenuItem(text = { Text("No size") }, onClick = { open = false; onChange("") })
                    options.forEach { o -> DropdownMenuItem(text = { Text(o) }, onClick = { open = false; onChange(o) }) }
                }
            }
        },
    )
}

// MARK: A page over the form

/** A page over the whole window with its own bar (the pushed screen of the iPhone's form stack). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FullScreenPage(
    title: String,
    onBack: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    content: @Composable BoxScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onBack,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = ErpColors.ground) {
            Scaffold(
                containerColor = ErpColors.ground,
                contentWindowInsets = WindowInsets.safeDrawing,
                topBar = {
                    TopAppBar(
                        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") } },
                        actions = actions,
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = ErpColors.ground),
                    )
                },
                bottomBar = bottomBar,
            ) { padding -> Box(Modifier.padding(padding).fillMaxSize(), content = content) }
        }
    }
}

/** The small round close/remove button on a photo. */
@Composable
internal fun RoundIconButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(MinTouchTarget).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(28.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(16.dp))
        }
    }
}
