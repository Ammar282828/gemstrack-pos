package erp.app.screens.money

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Switch
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.ui.SwipeActions
import erp.app.ui.RowAction
import erp.app.config.House
import erp.app.nav.ScreenTitle
import erp.app.ui.LedgerDivider
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.NoteHost
import erp.app.ui.NoteState
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.fill
import erp.app.ui.readableColumn
import erp.app.ui.rememberHaptics
import erp.app.ui.rememberNoteState
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

// What the Money and Owner screens share (MoneyKit.swift, OwnerKit.swift): the owners-only line, the metal's word, the date
// filter of a custom span, and the small controls their forms are made of. Several of these are the shell's own
// pieces on the iPhone (Form rows, swipe actions, the large sheet); the Android kit does not have them in a shape these
// screens can share yet, so they are written here.
// Swipes, the delete code and the note are the shared kit's (RowAction/SwipeActions, OwnerDeleteCodeSheet, LocalNoteState). TODO(shared): MoneySheet and the date/number fields have no equivalent in the kit (its PickerRow/ToggleRow take other arguments) and stay here.

/** The books of money are the owners' (the web hides them from staff), so each screen shows anyone else one line. */
@Composable
fun MoneyOwnersOnly(title: String, why: String? = null) {
    ScreenTitle(title)
    NotAvailableState("Owners only", why = why)
}

object MoneyWords {
    /** The house's own metal for lines that name it ("12.500 g gold"): "silver" in a silver house. */
    val metal: String get() = if (House.metal == "silver") "silver" else "gold"
}

// MARK: Rows in cards

/** The corners a row of a card list takes by its place: the first rounds the top, the last the bottom. */
@Composable
fun Modifier.cardEdges(first: Boolean, last: Boolean): Modifier {
    val top = if (first) Radius.card else 0.dp
    val bottom = if (last) Radius.card else 0.dp
    return clip(RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)).background(ErpColors.card)
}

/** Rows of one card in a lazy list: each its own item (the list stays lazy), the card's corners and hairlines drawn by place. */
fun <T> LazyListScope.cardRows(keyPrefix: String, rows: List<T>, key: (T) -> String, row: @Composable (T) -> Unit) {
    itemsIndexed(rows, key = { _, r -> keyPrefix + key(r) }) { i, r ->
        val first = i == 0
        val last = i == rows.lastIndex
        Column(Modifier.padding(horizontal = 16.dp).readableColumn()) {
            Column(Modifier.cardEdges(first, last)) {
                row(r)
                if (!last) LedgerDivider()
            }
        }
    }
}

/** A line of small print in the list (a Section's footer). */
@Composable
fun Footnote(text: String, modifier: Modifier = Modifier, tone: Tone = Tone.quiet) {
    Text(
        text,
        modifier.padding(horizontal = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = if (tone == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else tone.color(),
    )
}

@Composable
fun ErrorLine(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = Tone.problem.color())
        Text(text, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun SheetHeading(text: String) {
    Text(text, Modifier.semantics { heading() }, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

// MARK: Search

@Composable
fun MoneySearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
        },
        singleLine = true,
        shape = Radius.chipShape,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    )
}

// MARK: Sheets

/**
 * The frame the money sheets share (the iPhone's NavigationStack in a sheet): Cancel, the title, and the one
 * confirming action. A sheet that is saving cannot be swiped away.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoneySheet(
    title: String,
    onDismiss: () -> Unit,
    busy: Boolean = false,
    confirmText: String? = null,
    confirmEnabled: Boolean = true,
    onConfirm: () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val working by rememberUpdatedState(busy)
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !working })
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = { if (!working) onDismiss() },
        sheetState = state,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { if (!working) scope.launch { state.hide(); onDismiss() } }) { Text("Cancel") }
                Text(
                    title, Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, maxLines = 2,
                )
                if (confirmText != null) {
                    Button(onClick = onConfirm, enabled = confirmEnabled && !busy) {
                        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary) else Text(confirmText)
                    }
                } else {
                    Spacer(Modifier.size(64.dp))
                }
            }
            Column(
                Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = content,
            )
        }
    }
}

// MARK: Fields

/** A text box of a form; [number] opens the decimal pad, as the web's amount box (digits and one dot). */
@Composable
fun MoneyField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    number: Boolean = false,
    unit: String? = null,
    singleLine: Boolean = true,
    big: Boolean = false,
    enabled: Boolean = true,
    /** A sum of money: the number pad and whole rupees only (owner, 2026-10-17: "there should be no decimals"). */
    rupees: Boolean = false,
) {
    OutlinedTextField(
        value = if (rupees) erp.app.ui.PaymentText.whole(value) else value,
        onValueChange = { onChange(if (rupees) erp.app.ui.PaymentText.whole(it) else it) },
        modifier = modifier.fillMaxWidth(),
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        suffix = unit?.let { { Text(it) } },
        enabled = enabled,
        singleLine = singleLine,
        minLines = 1,
        maxLines = if (singleLine) 1 else 4,
        textStyle = if (big) MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold) else MaterialTheme.typography.bodyLarge,
        keyboardOptions = KeyboardOptions(keyboardType = if (rupees) KeyboardType.Number else if (number) KeyboardType.Decimal else KeyboardType.Text, imeAction = ImeAction.Done),
    )
}

/** A row that opens a menu of choices (the iPhone's `.pickerStyle(.menu)`): its name on the left, the choice on the right. */
@Composable
fun <T> PickerRow(label: String, options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == selected }?.second ?: ""
    Box(modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(enabled = enabled, role = Role.DropdownList) { open = true },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text(shown, style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent, textAlign = TextAlign.End, maxLines = 2)
            Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((value, name) in options) {
                DropdownMenuItem(
                    text = { Text(name, fontWeight = if (value == selected) FontWeight.SemiBold else FontWeight.Normal) },
                    onClick = { open = false; onSelect(value) },
                )
            }
        }
    }
}

/** A small heading inside a menu (the iPhone's Picker title). */
@Composable
fun MenuHeading(text: String) {
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** One choice of a menu picker, the chosen one marked. */
@Composable
fun ChoiceItem(label: String, chosen: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label) }, leadingIcon = { RadioButton(selected = chosen, onClick = null) }, onClick = onClick)
}

/** A row with a switch (the iPhone's Toggle). */
@Composable
fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

/**
 * A day to pick (the iPhone's `DatePicker(displayedComponents: .date)`): the row shows it, a tap opens the calendar.
 * [latest] keeps it from being after that day (the forms do not take a day not yet come); [earliest] from before.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DayRow(
    label: String,
    day: LocalDate,
    onPick: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    latest: LocalDate? = null,
    earliest: LocalDate? = null,
) {
    var open by remember { mutableStateOf(false) }
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable(role = Role.Button) { open = true },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.CalendarMonth, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(MoneyCalendar.sayFull(MoneyCalendar.pickedDay(day)), color = ErpColors.accent, fontWeight = FontWeight.Medium)
    }
    if (open) {
        fun utc(d: LocalDate) = d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val picker = rememberDatePickerState(
            initialSelectedDateMillis = utc(day),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    (latest == null || utcTimeMillis <= utc(latest)) && (earliest == null || utcTimeMillis >= utc(earliest))
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { ms ->
                        // The picker's own calendar day, whatever time of day it holds.
                        onPick(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate())
                    }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(picker) }
    }
}

/**
 * The date filter of a custom span, as the web's range picker works: nothing is bound until a start date is
 * chosen, and with no end date the span runs to the end of today. Put it in a card.
 */
@Composable
fun MoneyRangeFields(filter: MoneyCustomRange, onChange: (MoneyCustomRange) -> Unit) {
    val today = LocalDate.now()
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        ToggleRow("From a date", filter.useFrom, { onChange(filter.copy(useFrom = it)) })
        if (filter.useFrom) {
            DayRow("From", filter.from, { onChange(filter.withFrom(it)) }, latest = today)
            ToggleRow("To a date", filter.useTo, { onChange(filter.copy(useTo = it)) })
            if (filter.useTo) DayRow("To", filter.to, { onChange(filter.copy(to = it)) }, latest = maxOf(today, filter.from), earliest = filter.from)
        }
    }
}

/** The picker's day with the moment's clock kept, as the iPhone's date box keeps the time of day (a new row is dated now). */
fun pickedInstant(day: LocalDate, clockFrom: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): Instant =
    day.atTime(clockFrom.atZone(zone).toLocalTime()).atZone(zone).toInstant()

/** A swipe or a menu that names its words for TalkBack; here so a row's own description is not repeated. */
fun Modifier.described(text: String): Modifier = semantics { contentDescription = text }

/** The phone's own calendar, which the date pickers show (a day picked is the day on the wall). */
internal val phoneZone: ZoneId get() = ZoneId.systemDefault()
