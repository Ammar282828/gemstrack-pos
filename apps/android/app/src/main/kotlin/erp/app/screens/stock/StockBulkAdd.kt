package erp.app.screens.stock

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.customers.FormSection
import erp.app.screens.customers.SavedHeader
import erp.app.screens.customers.TextRow
import erp.app.screens.neworder.NumberRow
import erp.app.screens.neworder.PickerRow
import erp.app.screens.neworder.QuietField
import erp.app.screens.neworder.ToggleRow
import erp.app.screens.neworder.formRow
import erp.app.ui.FailureAlert
import erp.app.ui.LedgerDivider
import erp.app.ui.NotAvailableState
import erp.app.ui.readableColumn
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.core.entry.NewOrderFormat
import erp.core.logic.METAL_TYPES
import erp.core.logic.karatLabel
import erp.core.logic.karatsFor
import erp.core.logic.metalLabel
import erp.core.models.MetalType
import java.util.UUID
import kotlinx.coroutines.launch

/**
 * Add pieces in bulk (/products/bulk-add, src/app/products/bulk-add/page.tsx): one setup shared by every piece
 * (category, name prefix, metal and karat, wastage, making, stones, diamonds, sundries) and a list of weights, one piece
 * for each. Paste a list of weights, or type them, and each can carry its own name suffix.
 *
 * The setup is the product form's own model (`StockPieceFields`), so a piece made here is checked, shaped and priced
 * exactly as one made on the single form. The ERP adds them in order, each numbered as a piece added by hand
 * (`addProducts`, ops-stock2.ts, the same `addProduct` write): all are checked before the first is written, so a mistake
 * in row 9 leaves nothing half in stock.
 *
 * As the web's page, a piece here is priced by weight and rate (never a fixed price) and the figures start at nothing,
 * not at the single form's 10%. Silver is priced by its all-in rate, so it has no wastage or making. Differences: a name
 * suffix typed with no prefix names the piece (the page ignored it), pasting drops the empty row first, and the weights
 * go to the ERP twenty pieces to a request.
 */
@Composable
fun StockBulkAdd() {
    val session = LocalSession.current
    if (session.isOwner) {
        StockBulkEditor()
    } else {
        ScreenTitle("Add in bulk")
        NotAvailableState("Only an owner can change the stock", why = "Ask an owner to add the pieces.", icon = Icons.Filled.Lock)
    }
}

private val RowsSaver = listSaver<List<StockBulkRow>, String>(
    save = { rows -> rows.flatMap { listOf(it.id, it.weight, it.suffix) } },
    restore = { flat -> flat.chunked(3).map { StockBulkRow(it[0], it[1], it[2]) } },
)

@Composable
private fun StockBulkEditor() {
    val navigator = LocalNavigator.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var shared by rememberSaveable(stateSaver = StockFieldsSaver) { mutableStateOf(StockBulk.freshSetup()) }
    var prefix by rememberSaveable { mutableStateOf("") }
    var rows by rememberSaveable(stateSaver = RowsSaver) { mutableStateOf(listOf(StockBulkRow())) }
    var pasted by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    // One run of "Add pieces": the same weights pasted again later are a new run, not a repeat.
    var batch by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
    var confirmReset by remember { mutableStateOf(false) }
    var failureTitle by remember { mutableStateOf("The pieces weren't added") }
    var failure by remember { mutableStateOf<String?>(null) }
    // The SKUs once everything is in stock.
    var done by remember { mutableStateOf<List<String>?>(null) }

    // The product form's rules, line for line (a coin carries nothing, silver no wastage), but the wastage stays what was
    // typed: the page this follows never put it back to 10%. Not as it opens.
    var opened by remember { mutableStateOf(false) }
    LaunchedEffect(shared.ruleKey) {
        if (!opened) opened = true else shared = shared.settle(keepWastage = true)
    }

    fun reset() {
        shared = StockBulk.freshSetup()
        prefix = ""
        rows = listOf(StockBulkRow())
        pasted = ""
        failure = null
    }

    fun addPasted() {
        val found = StockBulk.weights(pasted)
        if (found.isEmpty()) return
        // A row nothing was typed in would only fail the check.
        val kept = rows.filterNot { NewOrderFormat.trim(it.weight).isEmpty() && NewOrderFormat.trim(it.suffix).isEmpty() }
        rows = kept + found.map { StockBulkRow(weight = NewOrderFormat.trimmed(it, 3)) }
        pasted = ""
    }

    suspend fun save() {
        if (saving) return
        StockBulk.firstProblem(shared, prefix, rows)?.let {
            failureTitle = "The pieces weren't added"
            failure = it
            return
        }
        saving = true
        val all = rows
        val out = StockBulk.add(all, shared, prefix, batch) { op, fields -> ErpApi.shared.write(op, fields) }
        saving = false
        val stopped = out.stopped
        if (stopped != null) {
            // What went in is in stock; the list keeps only what did not.
            val rest = all.drop(out.next)
            rows = rest.ifEmpty { listOf(StockBulkRow()) }
            if (out.added.isEmpty()) {
                failureTitle = "The pieces weren't added"
                failure = stopped
            } else {
                failureTitle = "Some pieces weren't added"
                failure = "${out.added.size} of ${all.size} pieces are in stock (${out.added.first()} to ${out.added.last()}). $stopped " +
                    "Check Stock before adding the rest, which are still in the list."
            }
            return
        }
        haptics.success()
        batch = UUID.randomUUID().toString()
        done = out.added
    }

    val skus = done
    ScreenTitle(if (skus != null) "Added" else "Add in bulk")
    ScreenActions { if (skus != null) TextButton(onClick = { navigator.back() }) { Text("Done") } }
    BackHandler(enabled = saving) {}
    FailureAlert(failure, onDismiss = { failure = null }, title = failureTitle)

    if (skus != null) {
        DonePage(skus, onAgain = {
            rows = listOf(StockBulkRow()); pasted = ""; failure = null; done = null
        }, onOpenPiece = { navigator.open(StockKit.piecePath(it)) }, onOpenStock = { navigator.open("/products") })
        return
    }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SharedSection(shared, { shared = it }, prefix, { prefix = it })
            if (!shared.isGoldCoin) {
                CostSection(shared) { shared = it }
                StonesSection(shared) { shared = it }
            }
            AddWeightsSection(pasted, { pasted = it }, onAddPasted = ::addPasted, onAddRow = { rows = rows + StockBulkRow() })
            WeightsSection(rows, { id, new -> rows = rows.map { if (it.id == id) new else it } }, { id -> rows = rows.filterNot { it.id == id } })
            FormSection {
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !saving, role = Role.Button) { confirmReset = true }.formRow(),
                    verticalAlignment = Alignment.CenterVertically,
                ) { Text("Reset form", color = if (saving) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge) }
            }
        }
        Button(
            onClick = { scope.launch { save() } },
            enabled = !saving && rows.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).defaultMinSize(minHeight = 52.dp),
        ) {
            if (saving) erp.app.ui.SkeletonLoading(compact = true) else Text("Add ${rows.size} piece${if (rows.size == 1) "" else "s"}")
        }
    }
    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Reset the form?") },
            text = { Text("Every row and the setup above are cleared.") },
            confirmButton = { TextButton(onClick = { confirmReset = false; reset() }) { Text("Reset", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Cancel") } },
        )
    }
}

// MARK: Shared by every piece

@Composable
private fun SharedSection(shared: StockPieceFields, set: (StockPieceFields) -> Unit, prefix: String, setPrefix: (String) -> Unit) {
    val categories = buildList {
        if (shared.categoryId.isEmpty()) add("" to "Choose")
        StockKit.categories.forEach { add(it.id to it.title) }
    }
    val metals = buildList {
        METAL_TYPES.forEach { add(it.rawValue to metalLabel(it)) }
        if (none { it.first == shared.metalType }) add(shared.metalType to metalLabel(shared.metalType))
    }
    val karats = buildList {
        karatsFor(MetalType.gold).forEach { add(it.rawValue to karatLabel(it)) }
        if (shared.karat.isNotEmpty() && none { it.first == shared.karat }) add(shared.karat to karatLabel(shared.karat))
    }
    FormSection(title = "Shared by every piece", footer = "A piece is named “prefix suffix”. With neither, it is named from the category and its SKU.") {
        PickerRow("Category", shared.categoryId, categories) { set(shared.copy(categoryId = it)) }
        TextRow("Name prefix", prefix, setPrefix, prompt = "Optional, e.g. Gold ring design A", capitalization = KeyboardCapitalization.Words)
        PickerRow("Metal", shared.metalType, metals) { set(shared.copy(metalType = it)) }
        if (shared.metalType == "gold") {
            Column(Modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Karat", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    karats.forEachIndexed { i, (id, label) ->
                        SegmentedButton(
                            selected = shared.karat == id, onClick = { set(shared.copy(karat = id)) },
                            shape = SegmentedButtonDefaults.itemShape(i, karats.size), label = { Text(label) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CostSection(shared: StockPieceFields, set: (StockPieceFields) -> Unit) {
    FormSection(
        title = "Costs",
        footer = if (shared.silver) "Silver is priced by weight at the silver rate in settings, all-inclusive: no wastage or making." else null,
    ) {
        if (!shared.silver) {
            NumberRow("Wastage (%)", shared.wastage, { set(shared.copy(wastage = it)) }, prompt = "e.g. 10")
            NumberRow("Making (PKR)", shared.making, { set(shared.copy(making = it)) }, prompt = "e.g. 5000", rupees = true)
        }
        NumberRow("Misc (PKR)", shared.miscCharges, { set(shared.copy(miscCharges = it)) }, prompt = "e.g. 250", rupees = true)
    }
}

@Composable
private fun StonesSection(shared: StockPieceFields, set: (StockPieceFields) -> Unit) {
    FormSection(
        title = "Diamonds and stones",
        footer = if (shared.hasStones || shared.hasDiamonds) "The same figures go on every piece." else null,
    ) {
        ToggleRow("Has other stones", shared.hasStones) { set(shared.copy(hasStones = it)) }
        if (shared.hasStones) {
            NumberRow("Stone weight", shared.stoneWeight, { set(shared.copy(stoneWeight = it)) }, prompt = "e.g. 0.5", unit = "g")
            NumberRow("Stones (PKR)", shared.stoneCharges, { set(shared.copy(stoneCharges = it)) }, prompt = "e.g. 15000", rupees = true)
        }
        ToggleRow("Has diamonds", shared.hasDiamonds) { set(shared.copy(hasDiamonds = it)) }
        if (shared.hasDiamonds) {
            NumberRow("Diamonds (PKR)", shared.diamondCharges, { set(shared.copy(diamondCharges = it)) }, prompt = "e.g. 50000", rupees = true)
        }
    }
}

// MARK: The weights

@Composable
private fun AddWeightsSection(pasted: String, setPasted: (String) -> Unit, onAddPasted: () -> Unit, onAddRow: () -> Unit) {
    val any = StockBulk.weights(pasted).isNotEmpty()
    FormSection(title = "Add weights", footer = "Paste a list from a message or a sheet: every number in it becomes a piece.") {
        TextRow("Weights", pasted, setPasted, prompt = "Paste or type weights, e.g. 4.2 5.1 6.75", minLines = 2, maxLines = 6)
        LinkLine("Add these weights", Icons.Filled.ContentPaste, any, onAddPasted)
        LinkLine("Add a row", Icons.Filled.Add, true, onAddRow)
    }
}

@Composable
private fun LinkLine(text: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    val ink = if (enabled) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).formRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink)
        Text(text, color = ink, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun WeightsSection(rows: List<StockBulkRow>, change: (String, StockBulkRow) -> Unit, remove: (String) -> Unit) {
    FormSection(title = "Weights to add · ${rows.size}", footer = "Tap the cross to take a row out.") {
        if (rows.isEmpty()) {
            Text("No weights yet. Paste a list or add a row.", Modifier.fillMaxWidth().formRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        rows.forEachIndexed { index, row ->
            Row(
                Modifier.fillMaxWidth().formRow(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("${index + 1}", Modifier.widthIn(min = 22.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                QuietField(
                    row.weight, { change(row.id, row.copy(weight = it)) }, Modifier.weight(1f), placeholder = "Weight (g)",
                    keyboardType = KeyboardType.Decimal, autoCorrect = false, label = "Weight of piece ${index + 1}",
                )
                QuietField(
                    row.suffix, { change(row.id, row.copy(suffix = it)) }, Modifier.weight(1f), placeholder = "Name suffix",
                    capitalization = KeyboardCapitalization.Words, label = "Name suffix of piece ${index + 1}",
                )
                IconButton(onClick = { remove(row.id) }) { Icon(Icons.Filled.Close, contentDescription = "Remove piece ${index + 1}") }
            }
        }
    }
}

// MARK: Done

@Composable
private fun DonePage(skus: List<String>, onAgain: () -> Unit, onOpenPiece: (String) -> Unit, onOpenStock: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).readableColumn().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SavedHeader("${skus.size} piece${if (skus.size == 1) " is" else "s are"} in stock.", title = "Bulk add complete")
            FormSection(title = "Added", footer = "Photos are added on each piece's ERP page.") {
                skus.forEachIndexed { i, sku ->
                    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpenPiece(sku) }.formRow(), verticalAlignment = Alignment.CenterVertically) {
                        Text(sku, style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"))
                    }
                    if (i < skus.lastIndex) LedgerDivider()
                }
            }
            FormSection(footer = "The setup stays as it is; the weights start again.") {
                LinkLine("Add more pieces", Icons.Filled.Inventory2, true, onAgain)
            }
        }
        Button(
            onClick = onOpenStock,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).defaultMinSize(minHeight = 52.dp),
        ) { Text("Open Stock") }
    }
}
