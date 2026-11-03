package erp.app.screens.neworder

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.IconButton
import erp.app.ui.NotAvailableState
import erp.app.ui.SearchBarField
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import erp.app.ui.TextButton
import erp.app.ui.Button
import erp.app.ui.TwoLine
import erp.app.ui.icons.Symbols
import erp.core.entry.NewOrderWords
import erp.core.logic.categoryTitle

// The chip row under a description, "View all", "Add stone combo" and the wastage chips (DescribeKit.swift). The matching is
// DescribeLogic; what is read and saved is DescribeStore.

/**
 * Under the description field: what this shop has already written for this category, and its stone combos, to tap. Its height is
 * reserved (the chips come and go, the row never grows), and a pick is handed back through [onPick].
 */
@Composable
internal fun DescribeSuggestions(text: String, category: String, onPick: (String) -> Unit) {
    val rev by DescribeStore.revision.collectAsStateWithLifecycle()
    LaunchedEffect(category) { DescribeStore.load(category) }
    val shown = remember(text, category, rev) { DescribeLogic.compute(text, category, DescribeStore.entries(category), DescribeStore.combos) }
    var menu by remember { mutableStateOf(false) }
    var showAll by remember { mutableStateOf(false) }
    var addCombo by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in shown) {
                SuggestionChip(onClick = { onPick(s.text) }, label = { Text(s.text, maxLines = 1) })
            }
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Symbols.MoreVert, "More descriptions") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("View all descriptions") }, onClick = { menu = false; showAll = true })
                DropdownMenuItem(text = { Text("Add stone combo") }, leadingIcon = { Icon(Symbols.Add, null) }, onClick = { menu = false; addCombo = true })
            }
        }
    }
    if (showAll) DescribeHistorySheet(category, onPick = onPick, onDismiss = { showAll = false })
    if (addCombo) StoneComboSheet(onDismiss = { addCombo = false })
}

/** Every past description, most used first: search it, and narrow it by category. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DescribeHistorySheet(category: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val rev by DescribeStore.revision.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { DescribeStore.load("") }
    var filter by remember { mutableStateOf(category) }
    var query by remember { mutableStateOf("") }
    val all = remember(rev) { DescribeStore.entries("").ifEmpty { DescribeStore.entries(category) } }
    val counts = remember(all) { all.groupingBy { it.category }.eachCount() }
    val rows = remember(all, filter, query) {
        val tokens = query.lowercase().split(' ').filter { it.isNotEmpty() }
        all.filter { e -> (filter.isEmpty() || e.category == filter) && tokens.all { e.lower.contains(it) } }
    }
    val composed = remember(rev, query, filter) {
        if (query.isNotEmpty()) emptyList() else {
            val word = (erp.core.logic.categorySingular(filter) ?: "").lowercase()
            DescribeStore.combos.map { DescribeLogic.compose(it, word) }.filter { it.isNotEmpty() }
        }
    }
    fun choose(t: String) { onPick(t); onDismiss() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Past descriptions", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.titleLarge)
            SearchBarField(
                value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                placeholder = { Text("Search descriptions") }, leadingIcon = { Icon(Symbols.Search, null) }, singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            )
            ChipRow {
                FilterChip("All", chosen = filter.isEmpty(), onClick = { filter = "" }, count = all.size)
                for (c in NewOrderWords.categories.filter { counts[it.id] != null }) {
                    FilterChip(c.label, chosen = filter == c.id, onClick = { filter = c.id }, count = counts[c.id])
                }
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 240.dp, max = 560.dp)) {
                if (rows.isEmpty() && composed.isEmpty()) {
                    if (query.isNotEmpty()) NotAvailableState("No results", why = "Nothing matches “${query.trim()}”.", icon = Symbols.Search)
                    else NotAvailableState("No past descriptions yet", icon = Symbols.Search)
                } else {
                    LazyColumn {
                        if (composed.isNotEmpty()) {
                            item(key = "combos") { Text("Stone combos", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary) }
                            items(composed, key = { "c|$it" }) { t ->
                                Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { choose(t) }.padding(horizontal = 16.dp, vertical = 12.dp)) { Text(t) }
                            }
                            item(key = "past") { Text("Past descriptions", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary) }
                        }
                        items(rows, key = { it.id }) { e ->
                            val title = categoryTitle(e.category).orEmpty()
                            val times = if (e.count == 1) "1 time" else "${e.count} times"
                            Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { choose(e.text) }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                                TwoLine(title = e.text, subtitle = if (title.isEmpty()) times else "$title · $times")
                            }
                        }
                    }
                }
            }
            TextButton(onClick = onDismiss, Modifier.padding(start = 8.dp, bottom = 12.dp)) { Text("Cancel") }
        }
    }
}

/** The stones the sheet offers to tap. */
internal val STONES = listOf("Diamond", "Ruby", "Emerald", "Sapphire", "Pearl", "Zircon", "Polki", "Kundan", "Turquoise", "Coral", "Onyx", "Moissanite")

/**
 * A quick way to add a combo: tap the stones, or type any words. It joins them ("Ruby & diamond") and adds it to the shop's
 * list, which every description row then offers with the category's word.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StoneComboSheet(onDismiss: () -> Unit) {
    var picked by remember { mutableStateOf(listOf<String>()) }
    var extra by remember { mutableStateOf("") }
    val rev by DescribeStore.revision.collectAsStateWithLifecycle()
    val combo = DescribeLogic.combo(picked, extra)
    val saved = remember(rev) { DescribeStore.combos }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Add stone combo", style = MaterialTheme.typography.titleLarge)
            Text("Stones", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (s in STONES) {
                    FilterChip(s, chosen = s in picked, onClick = { picked = if (s in picked) picked - s else picked + s })
                }
            }
            QuietBox(extra, { extra = it }, "Another stone, or your own words (e.g. Pearl, Zircon)")
            Text(
                if (combo.isEmpty()) "Pick the stones this piece usually has." else "Saved as \"$combo\"; a ring then reads \"${DescribeLogic.compose(combo, "ring")}\".",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (saved.isNotEmpty()) {
                Text("Saved combos", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                Text(saved.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(onClick = { DescribeStore.addCombo(combo); onDismiss() }, enabled = combo.isNotEmpty()) { Text("Save") }
            }
        }
    }
}

@Composable
private fun QuietBox(value: String, onChange: (String) -> Unit, placeholder: String) {
    erp.app.ui.SearchBarField(
        value = value, onValueChange = onChange, modifier = Modifier.fillMaxWidth(), placeholder = { Text(placeholder) },
        singleLine = true, keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences),
    )
}

// MARK: Wastage

/**
 * 10% · 12% · 15% · 25% · Other, a connected button group. A value that is not on the list reads as Other, with its own fields; [other]
 * is true once Other is chosen (and for a value not on the list), so typing "12" in Other never flips the row back.
 */
@Composable
internal fun WastageChips(percent: String, other: Boolean, onPercent: (String) -> Unit, onOther: (Boolean) -> Unit) {
    LaunchedEffect(Unit) { if (WastagePicks.preset(percent) == null) onOther(true) }
    val showsOther = WastagePicks.reveals(percent, other)
    val labels = WastagePicks.presets.map { "$it%" } + "Other"
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Wastage", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            labels.forEachIndexed { i, label ->
                val isOther = i == WastagePicks.presets.size
                SegmentedButton(
                    selected = if (isOther) showsOther else !showsOther && WastagePicks.preset(percent) == WastagePicks.presets[i],
                    onClick = {
                        if (isOther) onOther(true) else { onOther(false); onPercent(WastagePicks.presets[i].toString()) }
                    },
                    shape = SegmentedButtonDefaults.itemShape(i, labels.size),
                    label = { Text(label, maxLines = 1) },
                )
            }
        }
    }
}
