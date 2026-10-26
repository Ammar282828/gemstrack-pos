package erp.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.Single
import erp.app.nav.ScreenActions
import erp.app.screens.design.ConfirmDestructive
import erp.app.screens.stock.StockKit
import erp.app.ui.ActionRow
import erp.app.ui.LocalNoteState
import erp.app.ui.NotAvailableState
import erp.app.ui.Note
import erp.app.ui.PickerRow
import erp.app.ui.RowAction
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.core.models.Collections
import java.util.UUID

/**
 * Settings → Integrations → Selling on the website (components/settings/website-settings.tsx): whether the site shows
 * prices and takes orders, how a piece is priced on top of its gold, delivery, how fresh the rate must be, and which ERP
 * category a bought piece is filed under. Read live from `app_settings/website`; saved whole through /api/app/write
 * `saveWebsiteConfig` (lib/writes/website-config.ts), the page's own write, which checks every figure. The bank account
 * is not here: it is the server's environment, so nothing that writes the books can move a payment.
 * (WebsiteSellingSettings.swift.)
 */
@Composable
fun WebsiteSellingSettings() {
    SettingsOwnersOnly("Selling on the website") { WebsiteSellingLoader() }
}

@Composable
private fun WebsiteSellingLoader() {
    val book = LocalBook.current
    val doc = remember(book) { Single(Collections.settings, Collections.websiteConfigDoc, WebsiteSellingConfig, book) }
    DisposableEffect(doc) {
        doc.need()
        onDispose { doc.reset() }
    }
    val value by doc.value.collectAsStateWithLifecycle()
    val loaded by doc.loaded.collectAsStateWithLifecycle()
    val error by doc.error.collectAsStateWithLifecycle()
    when {
        !loaded -> SkeletonLoading(Modifier.fillMaxWidth().padding(16.dp))
        error != null && value == null ->
            NotAvailableState("Couldn’t read the website settings", why = error, icon = Icons.Filled.CloudOff)
        // No document yet reads as the page's defaults.
        else -> WebsiteSellingForm(value ?: WebsiteSellingConfig())
    }
}

/**
 * The form on what the book holds: the person's edits are kept, and the book's copy replaces them only where nothing
 * has been changed. Saving leaves at once (the Outbox) and says so.
 */
@Composable
fun WebsiteSellingForm(fresh: WebsiteSellingConfig) {
    val note = LocalNoteState.current
    val haptics = rememberHaptics()
    // `base` is what the book held when it was last taken in; `draft` is the form as the person has left it.
    var draft by remember { mutableStateOf(fresh) }
    var base by remember { mutableStateOf(fresh) }
    var confirmingDiscard by remember { mutableStateOf(false) }
    LaunchedEffect(fresh) {
        if (draft == base) draft = fresh
        base = fresh
    }
    val dirty = draft != base

    fun save() {
        if (!dirty) return
        val sending = draft
        ErpApi.shared.enqueue("saveWebsiteConfig", WebsiteSelling.save(sending, UUID.randomUUID().toString()), "Website settings")
        base = sending
        haptics.success()
        note.show(
            Note(
                "Website settings saved",
                if (sending.enabled) "The site shows prices at the next rate refresh." else "Selling is switched off; the site shows no prices.",
            ),
        )
    }

    ScreenActions { TextButton(onClick = ::save, enabled = dirty) { Text("Save") } }

    val categories = remember(draft.posCategoryId) {
        // The ERP's categories, and the one saved if the list no longer has it.
        val out = StockKit.categories.toMutableList()
        if (draft.posCategoryId.isNotEmpty() && out.none { it.id == draft.posCategoryId }) out.add(StockKit.Category(draft.posCategoryId, draft.posCategoryId))
        out.map { it.id to it.title }
    }

    SettingsPage {
        SettingsSection(
            footer = "The site prices each photographed piece live, weight × today’s rate for its karat plus what you set here, and creates the product and the order in the ERP when a customer checks out. Payment is by bank transfer; you confirm it on the order.",
        ) {
            ToggleRow(
                "Show prices and take orders", draft.enabled, { draft = draft.copy(enabled = it) },
                sub = if (draft.enabled) "On. The site shows prices for every piece with a readable weight." else "Off. The site shows no prices; every piece is enquiry-only.",
            )
            if (draft.missing.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.Warning, null, Modifier.size(20.dp), tint = Tone.owed.color())
                    Text(
                        "Before this can work, set ${draft.missing.joinToString(" and ")}.",
                        style = MaterialTheme.typography.bodyMedium, color = Tone.owed.color(),
                    )
                }
            }
        }

        SettingsSection(
            "Orders",
            footer = "A product is created in that category the moment a piece is bought, none before. Diamond pieces priced on request are recommended.",
        ) {
            PickerRow("ERP category", draft.posCategoryId, listOf("" to "Choose a category") + categories) { draft = draft.copy(posCategoryId = it) }
            ChoiceRow(
                "Diamond-set pieces", draft.diamondPolicy,
                listOf("enquire" to "Price on request", "gold_only" to "Price the gold, add a diamond charge"),
            ) { draft = draft.copy(diamondPolicy = it) }
            if (draft.diamondPolicy == "gold_only") {
                NumberBox("Default diamond charge, Rs", draft.diamondChargesDefault, { draft = draft.copy(diamondChargesDefault = it ?: 0.0) }, "0", whole = true, nullable = false)
            }
        }

        val def = draft.defaultPricing
        SettingsSection("Default pricing", footer = "Applies to every collection without its own row below.") {
            PickerRow("Karat", def.karat ?: "21k", WebsiteSelling.karats.map { it to it }) { draft = draft.copy(defaultPricing = def.copy(karat = it)) }
            NumberBox("Wastage %", def.wastagePercentage, { draft = draft.copy(defaultPricing = def.copy(wastagePercentage = it ?: 0.0)) }, "0", decimal = true)
            NumberBox("Making, Rs per gram", def.makingChargesPerGram, { draft = draft.copy(defaultPricing = def.copy(makingChargesPerGram = it ?: 0.0)) }, "0")
            NumberBox("Stones, Rs per piece", def.stoneChargesDefault, { draft = draft.copy(defaultPricing = def.copy(stoneChargesDefault = it ?: 0.0)) }, "0")
            PickerRow("Palladium karat", draft.palladiumKarat, listOf("18k" to "18k", "12k" to "12k")) { draft = draft.copy(palladiumKarat = it) }
        }

        SettingsSection("Per-collection pricing", footer = "Only the fields you fill differ from the default. Swipe a collection to remove it.") {
            val names = draft.overridden
            if (names.isEmpty()) {
                Text("Every collection uses the default pricing.", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            names.forEach { name ->
                CollectionRow(
                    name, draft.categoryPricing[name] ?: WebsitePricing(), def,
                    onChange = { draft = draft.copy(categoryPricing = draft.categoryPricing + (name to it)) },
                    onRemove = { draft = draft.copy(categoryPricing = draft.categoryPricing - name) },
                )
            }
            val left = WebsiteSelling.siteCollections.filter { draft.categoryPricing[it] == null }
            if (left.isNotEmpty()) {
                // Choosing one adds its row and the picker goes back to "Choose…".
                PickerRow("Add a collection", "", listOf("" to "Choose…") + left.map { it to it }) {
                    if (it.isNotEmpty()) draft = draft.copy(categoryPricing = draft.categoryPricing + (it to WebsitePricing()))
                }
            }
        }

        SettingsSection("Delivery", footer = "Leopards, anywhere in Pakistan. Booked by you after the transfer clears.") {
            NumberBox("Delivery charge, Rs", draft.deliveryCharge, { draft = draft.copy(deliveryCharge = it ?: 0.0) }, "0", whole = true, nullable = false)
            NumberBox("Free delivery over, Rs", draft.freeDeliveryOver, { draft = draft.copy(freeDeliveryOver = it) }, "None")
        }

        SettingsSection(
            "Today’s rate",
            footer = "The site sells only while the counter’s gold rate was set this recently (${WebsiteSelling.defaultRateAge.toInt()} hours when empty). Older, and every piece says to ask on WhatsApp until the rate is set again.",
        ) {
            NumberBox("Rate fresh for, hours", draft.maxRateAgeHours, { draft = draft.copy(maxRateAgeHours = it) }, WebsiteSelling.defaultRateAge.toInt().toString())
        }

        SettingsSection {
            Text(
                "The bank account shown to customers is kept by whoever manages the ERP, not here, so nothing that can write to the books can change where the money goes.",
                Modifier.fillMaxWidth().ledgerRow(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            base.updatedAt?.takeIf { it.isNotEmpty() }?.let { at -> ValueRow("Last saved") { ReadOnly(ShopDate.say(at, withTime = true)) } }
        }

        if (dirty) {
            SettingsSection {
                ActionRow("Discard changes", onClick = { confirmingDiscard = true }, tone = Tone.problem)
            }
        }
    }

    if (confirmingDiscard) {
        ConfirmDestructive(
            "Discard your changes?", "The form goes back to what was last saved.", "Discard changes",
            onDismiss = { confirmingDiscard = false }, onConfirm = { draft = base },
        )
    }
}

/** One collection's own row: a karat and three charges, each falling back to the default's (shown as the prompt). */
@Composable
private fun CollectionRow(name: String, row: WebsitePricing, def: WebsitePricing, onChange: (WebsitePricing) -> Unit, onRemove: () -> Unit) {
    SwipeActions(
        end = RowAction("Remove $name", Icons.Filled.Delete, Tone.problem, onRemove),
    ) {
        Column(Modifier.fillMaxWidth().background(ErpColors.card)) {
            Text(name, Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
            PickerRow("Karat", row.karat ?: "", listOf("" to "Default (${def.karat ?: "21k"})") + WebsiteSelling.karats.map { it to it }) {
                onChange(row.copy(karat = it.ifEmpty { null }))
            }
            NumberBox("Wastage %", row.wastagePercentage, { onChange(row.copy(wastagePercentage = it)) }, WebsiteSelling.plain(def.wastagePercentage), decimal = true)
            NumberBox("Making per gram", row.makingChargesPerGram, { onChange(row.copy(makingChargesPerGram = it)) }, WebsiteSelling.plain(def.makingChargesPerGram))
            NumberBox("Stones", row.stoneChargesDefault, { onChange(row.copy(stoneChargesDefault = it)) }, WebsiteSelling.plain(def.stoneChargesDefault))
        }
    }
}

/**
 * A figure at a row's right edge. Whole rupees for a sum of money (owner, 2026-10-17: "there should be no decimals");
 * a box that may stay empty (`nullable`) reports null for it, one that may not reports 0. The box holds what was typed
 * and takes the figure back only when it is no longer what the typing reads as (a discard, a fresh read).
 */
@Composable
private fun NumberBox(
    title: String, value: Double?, onChange: (Double?) -> Unit, prompt: String,
    decimal: Boolean = false, whole: Boolean = false, nullable: Boolean = true,
) {
    var text by remember { mutableStateOf(WebsiteSelling.plain(value)) }
    LaunchedEffect(value) {
        val read = WebsiteSelling.read(text, whole)
        if ((if (nullable) read else read ?: 0.0) != value) text = WebsiteSelling.plain(value)
    }
    ValueRow(title) {
        ValueInput(
            text, { text = it; onChange(WebsiteSelling.read(it, whole)) }, prompt, title,
            keyboard = if (decimal) KeyboardType.Decimal else KeyboardType.Number,
        )
    }
}

/**
 * A choice whose words are long (the kit's [PickerRow] gives the label and the choice one line between them): the label
 * stands over the choice, and tapping either opens the menu.
 */
@Composable
private fun ChoiceRow(label: String, selected: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == selected }?.second ?: selected
    Box {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.DropdownList) { open = true }.ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, style = MaterialTheme.typography.bodyLarge)
                Text(shown, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, title) -> DropdownMenuItem(text = { Text(title) }, onClick = { open = false; onSelect(value) }) }
        }
    }
}
