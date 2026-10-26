package erp.app.screens.rates

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import erp.app.ui.Radius
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberSingle
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerSection
import erp.app.ui.MinTouchTarget
import erp.app.ui.NumericText
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Money
import erp.core.logic.ratesSetToday
import erp.core.logic.whenSet
import erp.core.models.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The day's rates (the ERP's rate chip and sheet, components/rates/rate-chip.tsx; RateSheet.swift): the house's own
 * rate always in sight, amber when it was not set on Karachi's today, and a sheet to set it or to confirm it
 * unchanged. Saved through the ERP (/api/app/write `setRates`, lib/writes/rates.ts), which stamps who and when and
 * logs it, exactly as the browser's sheet does.
 */

/** "9:40 · Ammar": when the rate was set and by whom, as the sheets' "Set" line says it. */
fun rateSetLine(s: Settings?): String =
    listOf(whenSet(s?.ratesUpdatedAt), s?.ratesUpdatedBy).filter { !it.isNullOrEmpty() }.joinToString(" · ")

/**
 * The chip in every tab's bar. The ERP shows it to everyone: an owner's opens the form, anyone else's (staff,
 * marketing) a page to read, since the server takes a rate only from an owner.
 */
@Composable
fun RateChip(modifier: Modifier = Modifier) {
    val book = LocalBook.current
    val session = LocalSession.current
    val settings by rememberSingle(book.settings)
    var open by remember { mutableStateOf(false) }
    val main = RateKeys.main(House.metal)
    val s = settings
    val today = ratesSetToday(s?.ratesUpdatedAt)
    val rate = s?.let(main.value)
    val ink = if (today) MaterialTheme.colorScheme.onSurface else Tone.owed.color()
    val spoken = if (session.isOwner) {
        if (today) "Today's rate. Tap to change." else "The rate was not set today. Tap to set it."
    } else {
        if (today) "Today's rate. Tap to see when it was set." else "The rate was not set today. Tap to see it."
    }
    Row(
        modifier
            .defaultMinSize(minHeight = MinTouchTarget)
            .clickable(role = Role.Button) { open = true }
            .padding(horizontal = 12.dp)
            .semantics(mergeDescendants = true) { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!today) Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(14.dp), tint = ink)
        Text(main.label, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), color = ink)
        NumericText(
            if (rate != null) Money.grouped(rate) else "—", rate ?: 0.0,
            style = MaterialTheme.typography.bodySmall, color = ink,
        )
    }
    if (open) {
        if (session.isOwner) RateSheet(onDismiss = { open = false }) else RateReadout(onDismiss = { open = false })
    }
}

/** A label with its value at the right edge (the Form's `LabeledContent`). */
@Composable
private fun ValueLine(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(value, style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
    }
}

@Composable
private fun Rows(rows: List<@Composable () -> Unit>) {
    rows.forEachIndexed { i, row ->
        if (i > 0) LedgerDivider()
        row()
    }
}

/** The day's rates to read, for those who cannot set them: the rates, and when and by whom they were set. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RateReadout(onDismiss: () -> Unit) {
    val book = LocalBook.current
    val settings by rememberSingle(book.settings)
    val s = settings
    val main = RateKeys.main(House.metal)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false), containerColor = ErpColors.ground) {
        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Today’s rate", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onDismiss) { Text("Done") }
            }
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).readableColumn().padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                LedgerSection(
                    "Rate",
                    footer = { Text(if (ratesSetToday(s?.ratesUpdatedAt)) "PKR per gram. Only an owner can change the rate." else "This rate was not set today. An owner sets it.") },
                ) {
                    Rows(listOf(
                        { ValueLine(main.label, "PKR ${RateKeys.shown(s?.let(main.value) ?: 0.0)}") },
                        { ValueLine("Set", rateSetLine(s)) },
                    ))
                }
                for (g in RateKeys.groups(House.metal)) {
                    LedgerSection(g.title, footer = g.note?.let { note -> { Text(note) } }) {
                        Rows(g.fields.map { f -> { ValueLine(f.label, RateKeys.shown(s?.let(f.value) ?: 0.0)) } })
                    }
                }
            }
        }
    }
}

/** gold.pk's answer (/api/gold-rates): per-gram gold rates, divided from its per-tola ones by the server. */
internal fun goldPkRates(answer: Any?): Map<String, Double> {
    val m = answer as? Map<*, *> ?: return emptyMap()
    val out = LinkedHashMap<String, Double>()
    for (key in listOf("goldRatePerGram24k", "goldRatePerGram22k", "goldRatePerGram21k", "goldRatePerGram18k")) {
        val v = (m[key] as? Number)?.toDouble() ?: continue
        if (v > 0) out[key] = v
    }
    return out
}

/**
 * The form an owner sets the day's rates in (and the sheet a New sale can raise for a stale rate). Only what moved
 * is ever sent; "Same today" confirms the rates unchanged, which still stamps who and when. [onDismiss] runs on
 * Cancel and after a save.
 */
@Composable
fun RateSheet(onDismiss: () -> Unit) {
    val book = LocalBook.current
    val session = LocalSession.current
    val settings by rememberSingle(book.settings)
    val s = settings
    val scope = rememberCoroutineScope()
    val typed = remember { mutableStateMapOf<String, String>() }
    var saving by remember { mutableStateOf(false) }
    var filling by remember { mutableStateOf(false) }
    // The fields hold gold.pk's rates, so the log can say where they came from (the web's `source`).
    var fromGoldPk by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val metal = House.metal
    val main = RateKeys.main(metal)
    val changed = RateKeys.changed(metal, typed, s)
    // The button is the owner's, and for a gold house: gold.pk has no silver.
    val offersGoldPk = session.isOwner && metal == "gold"

    fun fillFromGoldPk() {
        filling = true; error = null; note = null
        scope.launch {
            try {
                val found = goldPkRates(ErpApi.shared.get("/api/gold-rates"))
                if (found.isEmpty()) throw ErpApi.Failure(0, "It sent no rates.")
                for ((k, v) in found) typed[k] = RateKeys.plain(v)
                fromGoldPk = true
                val k21 = found["goldRatePerGram21k"]?.let { " (21K ${RateKeys.say(it)} a gram)" } ?: ""
                note = "gold.pk’s rates are filled in$k21. Check them, then save."
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "gold.pk did not answer (${e.message ?: "Something went wrong."}). Type the rate in instead."
            } finally {
                filling = false
            }
        }
    }

    // Rates are not a money write: the sheet closes at once and the Outbox carries them.
    val haptics = rememberHaptics()
    fun save() {
        ErpApi.shared.enqueue("setRates", RateKeys.payload(changed, typed, fromGoldPk), "Rates")
        haptics.success()
        onDismiss()
    }

    RateDialog(
        title = "Today’s rate",
        onCancel = onDismiss,
        confirmText = if (changed.isEmpty()) "Same today" else "Save",
        confirmEnabled = !saving && !filling && s != null,
        onConfirm = ::save,
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().readableColumn().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            LedgerSection("Rate", footer = { Text("PKR per gram. New sales and the website sell at these rates.") }) {
                Rows(listOf(
                    { ValueLine(main.label, "PKR ${RateKeys.say(s?.let(main.value) ?: 0.0)}") },
                    { ValueLine("Set", rateSetLine(s)) },
                ))
            }
            if (offersGoldPk) {
                // Its own card with no heading, as the Form's headerless Section is.
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)
                            .clickable(enabled = !filling && !saving, role = Role.Button) { fillFromGoldPk() }.ledgerRow(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Language, contentDescription = null, Modifier.size(22.dp), tint = ErpColors.accent)
                        Text("Fill gold from gold.pk", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
                        if (filling) SkeletonLoading(compact = true)
                    }
                    note?.let { Text(it, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            for (g in RateKeys.groups(metal)) {
                LedgerSection(g.title, footer = g.note?.let { text -> { Text(text) } }) {
                    Rows(g.fields.map { f ->
                        {
                            val stored = s?.let(f.value) ?: 0.0
                            RateField(f.label, typed[f.key].orEmpty(), RateKeys.say(stored), f.key == main.key) { typed[f.key] = it }
                        }
                    })
                }
            }
            error?.let { Text(it, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 4.dp)) }
        }
    }
}

/** A rate typed at the row's right edge, its stored figure in grey while empty. Silver takes paisa, as the web's box does. */
@Composable
private fun RateField(label: String, value: String, prompt: String, bold: Boolean, onChange: (String) -> Unit) {
    val focus = LocalFocusManager.current
    Row(
        Modifier.fillMaxWidth().ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        val style = MaterialTheme.typography.bodyLarge.copy(
            color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.End,
            fontFeatureSettings = TabularDigits, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        )
        BasicTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier.weight(1f).defaultMinSize(minHeight = MinTouchTarget).semantics { contentDescription = label },
            singleLine = true,
            textStyle = style,
            cursorBrush = SolidColor(ErpColors.accent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget), contentAlignment = Alignment.CenterEnd) {
                    if (value.isEmpty()) {
                        Text(prompt, style = style.copy(color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), fontWeight = FontWeight.Normal), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    inner()
                }
            },
        )
    }
}

/** The iPhone's large sheet: a full-screen page over the screen with Cancel and a confirm button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RateDialog(
    title: String,
    onCancel: () -> Unit,
    confirmText: String,
    confirmEnabled: Boolean,
    onConfirm: () -> Unit,
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
                    navigationIcon = { IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, "Cancel") } },
                    actions = {
                        TextButton(onClick = onConfirm, enabled = confirmEnabled, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text(confirmText) }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = ErpColors.ground),
                )
                Box(Modifier.weight(1f).fillMaxWidth().background(ErpColors.ground)) { content() }
            }
        }
    }
}
