package erp.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import erp.app.data.LocalBook
import erp.app.nav.LocalBottomBar
import erp.app.data.rememberShelf
import erp.app.device.Foreground
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.CustomerSearch
import erp.core.models.Customer
import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

// The rows and pages a form is made of, shared by every group that has one (New sale first: SaleKit.swift, Forms in
// the iPhone's App/UI). Rows sit on the house card with a hairline between them; none of them knows a screen.

// MARK: Rows of a form

/** A label with its value at the right edge: the shape of the Form's `LabeledContent`. */
@Composable
fun ValueRow(label: String, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        content()
    }
}

/** What is typed at a row's right edge, with its prompt in grey while empty. */
@Composable
fun RowScope.ValueInput(
    value: String,
    onChange: (String) -> Unit,
    prompt: String,
    label: String,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    enabled: Boolean = true,
) {
    val focus = LocalFocusManager.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.weight(1f).defaultMinSize(minHeight = MinTouchTarget).semantics { contentDescription = label },
        enabled = enabled,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.End,
            fontFeatureSettings = if (keyboard == KeyboardType.Text) null else TabularDigits,
        ),
        cursorBrush = SolidColor(ErpColors.accent),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = capitalization, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        decorationBox = { inner ->
            Box(Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget), contentAlignment = Alignment.CenterEnd) {
                if (value.isEmpty()) {
                    Text(prompt, style = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End), color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                inner()
            }
        },
    )
}

/**
 * A label with a number typed at its right edge. Zero is blank, as the sale's fields show it (decisions.md "Number
 * fields"): the draft holds text, and `SaleNumber.text` has already left a zero out of it.
 */
@Composable
fun NumberRow(label: String, text: String, onChange: (String) -> Unit, prompt: String = "0", decimal: Boolean = true) {
    ValueRow(label) {
        ValueInput(text, onChange, prompt, label, keyboard = if (decimal) KeyboardType.Decimal else KeyboardType.Number)
    }
}

/** A label with words typed at its right edge. */
@Composable
fun TextRow(label: String, text: String, onChange: (String) -> Unit, prompt: String, capitalization: KeyboardCapitalization = KeyboardCapitalization.None, keyboard: KeyboardType = KeyboardType.Text) {
    ValueRow(label) { ValueInput(text, onChange, prompt, label, keyboard = keyboard, capitalization = capitalization) }
}

/** A switch, with a line under its name when there is something to know. */
@Composable
fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, sub: String? = null) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** A choice from a list, said at the right edge; tapping opens the menu (a Form's `Picker`). */
@Composable
fun PickerRow(label: String, selected: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == selected }?.second ?: selected
    Box {
        Row(
            Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.DropdownList) { open = true },
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text(shown, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, maxLines = 2)
            Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, title) ->
                DropdownMenuItem(text = { Text(title) }, onClick = { open = false; onSelect(value) })
            }
        }
    }
}

/** A row that does something: an icon, its words, in the accent unless it says otherwise. */
@Composable
fun ActionRow(label: String, onClick: () -> Unit, icon: ImageVector? = null, enabled: Boolean = true, tone: Tone = Tone.house) {
    val ink = if (enabled) (if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurface else tone.color()) else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    Row(
        Modifier.fillMaxWidth().ledgerRow().clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, contentDescription = null, Modifier.size(22.dp), tint = ink)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = ink)
    }
}

/** A line of small print under or inside a section. */
@Composable
fun SmallPrint(text: String, tone: Tone = Tone.quiet, modifier: Modifier = Modifier) {
    Text(text, modifier, style = MaterialTheme.typography.bodySmall, color = tone.color())
}

/** A row's own text box (a name, a note) as the Material field. */
@Composable
fun FieldRow(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 6,
    enabled: Boolean = true,
    imeAction: ImeAction = if (singleLine) ImeAction.Done else ImeAction.Default,
    onImeAction: (() -> Unit)? = null,
    leading: ImageVector? = null,
) {
    val focus = LocalFocusManager.current
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        leadingIcon = leading?.let { { Icon(it, contentDescription = null) } },
        enabled = enabled,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = capitalization, imeAction = imeAction, autoCorrectEnabled = capitalization != KeyboardCapitalization.None),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }, onSearch = { onImeAction?.invoke() }),
    )
}

/**
 * A card's rows with a hairline between them, wherever the rows come from (an `if` that shows none leaves no line).
 * The lines are real children, so they draw with the rows and move with them.
 */
@Composable
fun DividedColumn(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    SubcomposeLayout(modifier.fillMaxWidth()) { constraints ->
        val loose = constraints.copy(minHeight = 0)
        val rows = subcompose("rows", content).map { it.measure(loose) }
        val lines = (1 until rows.size).map { i -> subcompose("line$i") { LedgerDivider() }.first().measure(loose) }
        val height = rows.sumOf { it.height } + lines.sumOf { it.height }
        layout(constraints.maxWidth, height) {
            var y = 0
            rows.forEachIndexed { i, row ->
                if (i > 0) {
                    lines[i - 1].placeRelative(0, y)
                    y += lines[i - 1].height
                }
                row.placeRelative(0, y)
                y += row.height
            }
        }
    }
}

/** A titled card of rows (the Form's Section): the rows are divided, the footer is small print under the card. */
@Composable
fun FormSection(title: String, footer: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    LedgerSection(title, footer = footer) { DividedColumn(content = content) }
}

// MARK: Full-screen pages

/**
 * The iPhone's large sheet (a NavigationStack with Cancel and a confirm button): a full-screen page over the
 * screen on a phone, as wide as the window on a tablet, so a two-pane form has its room.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FullScreenSheet(
    title: String,
    onCancel: () -> Unit,
    confirmText: String? = null,
    onConfirm: () -> Unit = {},
    confirmEnabled: Boolean = true,
    cancelText: String = "Cancel",
    content: @Composable () -> Unit,
) {
    Dialog(
        onDismissRequest = onCancel,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = ErpColors.ground) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                TopAppBar(
                    title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    navigationIcon = { IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, cancelText) } },
                    actions = {
                        if (confirmText != null) TextButton(onClick = onConfirm, enabled = confirmEnabled, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text(confirmText) }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = ErpColors.ground),
                )
                Box(Modifier.weight(1f).fillMaxWidth()) { content() }
            }
        }
    }
}


@Composable
fun Modifier.verticalScrollColumn(): Modifier = this.then(Modifier.verticalScroll(rememberScrollState()))
