package erp.app.screens.sale

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonSkippableComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.ui.NumericText
import erp.app.ui.PieceInspector
import erp.app.ui.TransactionReviewRow
import erp.app.ui.TransactionWorkspace
import erp.app.ui.theme.ErpColors
import erp.core.entry.NewOrderSizes
import erp.core.entry.SaleLine
import erp.core.entry.SaleLineFields
import erp.core.logic.METAL_TYPES
import erp.core.logic.Money
import erp.core.logic.PricingRates
import erp.core.logic.calculateProductCosts
import erp.core.logic.categoryTitle
import erp.core.logic.describeMetal
import erp.core.logic.karatLabel
import erp.core.logic.karatsFor
import erp.core.logic.metalHasKarat
import erp.core.logic.metalLabel
import erp.core.logic.platingTypes
import erp.core.logic.staticCategories
import erp.app.ui.ValueRow
import erp.app.ui.ValueInput
import erp.app.ui.NumberRow
import erp.app.ui.TextRow
import erp.app.ui.ToggleRow
import erp.app.ui.PickerRow
import erp.app.ui.FieldRow
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet

/**
 * Every attribute of a line on the sale, not only its price (components/cart/edit-cart-item-dialog.tsx): the name,
 * category, size, metal, weights, plating, and each charge. The line total at the foot is worked out by the same
 * `calculateProductCosts` the sale uses, so what is shown here is what the invoice will say. Changes are for this
 * sale only; the piece in stock is untouched.
 *
 * With [create] it is the web's "New item": a piece that was never in inventory, described to be billed on this sale
 * only. The same fields, and the name is required before it can be added.
 *
 * Unlike the web, a palladium piece keeps its karat when edited (the web's patch drops it for any metal but gold,
 * which would price an 18k palladium piece at the flat rate).
 */
@Composable
internal fun SaleLineEditor(line: SaleLine, rates: PricingRates, onApply: (SaleLine) -> Unit, onDismiss: () -> Unit, create: Boolean = false) {
    // The fields are core's plain class (the contract tests run the same code): the screen follows them by a count.
    val fields = remember { SaleLineFields(line) }
    var rev by remember { mutableIntStateOf(0) }
    fun edit(change: SaleLineFields.() -> Unit) {
        fields.change()
        rev += 1
    }
    @Suppress("UNUSED_EXPRESSION") rev
    val preview = calculateProductCosts(fields.applied(line).priced, rates).totalPrice

    FullScreenSheet(
        title = if (create) "New item" else (line.stockSku ?: "Edit piece"),
        onCancel = onDismiss,
        confirmText = if (create) "Add to bill" else "Apply",
        // A new item needs a name before it can go on the bill (the web's dialog, mode "create").
        confirmEnabled = !(create && fields.name.trim().isEmpty()),
        onConfirm = {
            onApply(fields.applied(line))
            onDismiss()
        },
    ) {
        TransactionWorkspace(
            editor = {
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    PieceSection(fields, create, rev, ::edit)
                    if (fields.metalType == "silver") FinishSection(fields, rev, ::edit)
                    SizeSection(fields, rev, ::edit)
                    PriceSection(fields, rev, ::edit)
                    StonesSection(fields, rev, ::edit)
                    BillSection(fields, rev, ::edit)
                    TotalSection(preview, create)
                }
            },
            review = {
                PieceInspector(
                    title = fields.name,
                    rows = listOf(
                        TransactionReviewRow("Metal", describeMetal(fields.metalType, fields.karat)),
                        TransactionReviewRow("Size", fields.size),
                        TransactionReviewRow("Weight", if (fields.weight.isEmpty()) "—" else fields.weight + " g"),
                        TransactionReviewRow("On this bill", Money.pkr(preview)),
                    ),
                )
            },
            footer = {},
        )
    }
}

@Composable
@NonSkippableComposable
private fun PieceSection(f: SaleLineFields, create: Boolean, rev: Int, edit: (SaleLineFields.() -> Unit) -> Unit) {
    val allowed = karatsFor(f.metalType).map { it.rawValue }
    // A karat the piece already carries stays selectable even if the metal's list no longer offers it.
    val karatOptions = if (f.karat.isNotEmpty() && !allowed.contains(f.karat) && metalHasKarat(f.metalType)) allowed + f.karat else allowed
    FormSection("The piece", footer = if (create) ({ Text("Describe the piece you are billing. It goes on this invoice only: your stock is untouched.") }) else null) {
        val categories = buildList {
            add("" to "Not set")
            staticCategories.forEach { add(it.id to it.title) }
            if (f.categoryId.isNotEmpty() && categoryTitle(f.categoryId) == null) add(f.categoryId to f.categoryId)
        }
        PickerRow("Category", f.categoryId, categories) { v -> edit { categoryId = v } }
        FieldRow("Item name", f.name, { v -> edit { name = v } }, placeholder = "What is being sold", capitalization = KeyboardCapitalization.Words)
        val metals = METAL_TYPES.map { it.rawValue to metalLabel(it) }.let { m ->
            if (METAL_TYPES.none { it.rawValue == f.metalType }) m + (f.metalType to f.metalType) else m
        }
        PickerRow("Metal", f.metalType, metals) { new ->
            edit {
                metalType = new
                // The karat follows the metal: none for silver, a listed one for gold and palladium.
                val ok = karatsFor(new).map { it.rawValue }
                if (ok.isEmpty()) karat = "" else if (!ok.contains(karat)) karat = if (ok.contains("21k")) "21k" else (ok.firstOrNull() ?: "")
            }
        }
        if (karatOptions.isNotEmpty()) {
            PickerRow("Karat", f.karat, karatOptions.map { it to karatLabel(it) }) { v -> edit { karat = v } }
        }
    }
}

/**
 * A category with a scale picks its size from it, as the web's SizePicker does (a set with two parts keeps
 * "Ring: 10 · Bangle: 2.4" in one string); any other category takes the size as typed.
 */
@Composable
@NonSkippableComposable
private fun SizeSection(f: SaleLineFields, rev: Int, edit: (SaleLineFields.() -> Unit) -> Unit) {
    val scale = NewOrderSizes.scale(f.categoryId)
    if (scale != null) {
        FormSection("Size", footer = { Text(if (scale.multi) scale.label + ". Leave either blank if not applicable." else scale.label) }) {
            if (scale.multi) {
                scale.parts.forEachIndexed { i, part ->
                    val parsed = NewOrderSizes.parse(f.size, scale.legacyPartKey)
                    SaleSizeField(part.label, part.options, parsed[part.key] ?: "") { typed ->
                        edit {
                            val p = LinkedHashMap(NewOrderSizes.parse(size, scale.legacyPartKey))
                            p[part.key] = typed
                            size = NewOrderSizes.compose(p, scale.parts.map { it.key })
                        }
                    }
                }
            } else {
                scale.parts.firstOrNull()?.let { only -> SaleSizeField("Size", only.options, f.size) { v -> edit { size = v } } }
            }
        }
    } else {
        FormSection("Size") {
            TextRow("Size", f.size, { v -> edit { size = v } }, prompt = "Optional")
        }
    }
}

/** A size typed, or chosen from the scale's list (NewOrderSizeField). */
@Composable
private fun SaleSizeField(title: String, options: List<String>, value: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ValueRow(title) {
        ValueInput(value, onChange, prompt = "Optional", label = title, keyboard = KeyboardType.Text)
        Box {
            IconButton(onClick = { open = true }) { Icon(Icons.Filled.UnfoldMore, "Choose a $title") }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                DropdownMenuItem(text = { Text("No size") }, onClick = { open = false; onChange("") })
                options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { open = false; onChange(option) }) }
            }
        }
    }
}

@Composable
@NonSkippableComposable
private fun FinishSection(f: SaleLineFields, rev: Int, edit: (SaleLineFields.() -> Unit) -> Unit) {
    FormSection("925 Sterling Silver finish") {
        PickerRow("Plating", f.platingType, listOf("" to "No plating") + platingTypes.map { it to it }) { v -> edit { platingType = v } }
        if (f.platingType == "Other") {
            FieldRow("Describe the plating", f.platingNote, { v -> edit { platingNote = v } }, placeholder = "e.g. Rose gold plating")
        }
        ToggleRow("Nickel free", f.nickelFree, { v -> edit { nickelFree = v } })
    }
}

@Composable
@NonSkippableComposable
private fun PriceSection(f: SaleLineFields, rev: Int, edit: (SaleLineFields.() -> Unit) -> Unit) {
    val silver = f.metalType == "silver"
    FormSection("Price", footer = if (f.fixed) ({ Text("The weight is printed on the bill; the price stays as typed.") }) else null) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            listOf(false to "Weight × rate", true to "Fixed price").forEachIndexed { i, (fixed, title) ->
                SegmentedButton(
                    selected = f.fixed == fixed,
                    onClick = { edit { this.fixed = fixed } },
                    shape = SegmentedButtonDefaults.itemShape(i, 2),
                ) { Text(title) }
            }
        }
        if (f.fixed) {
            NumberRow("Price (PKR)", f.customPrice, { v -> edit { customPrice = v } }, prompt = "The agreed total", rupees = true)
            // A fixed price still has a weight, and the bill says it (owner, 2026-10-07): it moves nothing, but it
            // prints, and the margin is costed from it instead of the 10% guess.
            NumberRow("Weight (g)", f.weight, { v -> edit { weight = v } }, prompt = "Optional")
            if (silver) NumberRow("Reference rate per gram", f.silverRate, { v -> edit { silverRate = v } }, prompt = "Optional")
        } else {
            NumberRow("Weight (g)", f.weight, { v -> edit { weight = v } })
            if (silver) {
                NumberRow("Rate per gram (PKR)", f.silverRate, { v -> edit { silverRate = v } }, prompt = "e.g. 150")
            } else {
                NumberRow("Wastage (%)", f.wastage, { v -> edit { wastage = v } })
            }
            NumberRow("Making (PKR)", f.making, { v -> edit { making = v } }, rupees = true)
            NumberRow("Stones (PKR)", f.stoneCharges, { v -> edit { stoneCharges = v } }, rupees = true)
            NumberRow("Misc (PKR)", f.miscCharges, { v -> edit { miscCharges = v } }, rupees = true)
            if (silver) NumberRow("Wastage (%)", f.wastage, { v -> edit { wastage = v } })
        }
    }
}

@Composable
@NonSkippableComposable
private fun StonesSection(f: SaleLineFields, rev: Int, edit: (SaleLineFields.() -> Unit) -> Unit) {
    FormSection("Diamonds and stones") {
        ToggleRow("Has diamonds", f.hasDiamonds, { v -> edit { hasDiamonds = v } })
        if (f.hasDiamonds) {
            // The charge only exists when the price is built from the rate; the details print either way.
            if (!f.fixed) NumberRow("Diamonds (PKR)", f.diamondCharges, { v -> edit { diamondCharges = v } }, rupees = true)
            FieldRow("Diamond details", f.diamondDetails, { v -> edit { diamondDetails = v } }, placeholder = "e.g. 0.5ct round")
        }
        ToggleRow("Has other stones", f.hasStones, { v -> edit { hasStones = v } })
        if (f.hasStones) {
            NumberRow("Stone weight (g)", f.stoneWeight, { v -> edit { stoneWeight = v } })
            FieldRow("Stone details", f.stoneDetails, { v -> edit { stoneDetails = v } }, placeholder = "e.g. 4 rubies")
        }
    }
}

@Composable
@NonSkippableComposable
private fun BillSection(f: SaleLineFields, rev: Int, edit: (SaleLineFields.() -> Unit) -> Unit) {
    FormSection("On the bill") {
        FieldRow(
            "Description", f.billDescription, { v -> edit { billDescription = v } },
            placeholder = "Additional details to appear on the invoice", singleLine = false, minLines = 2, maxLines = 5,
            capitalization = KeyboardCapitalization.Sentences,
        )
    }
}

@Composable
private fun TotalSection(preview: Double, create: Boolean) {
    FormSection("Total", footer = { Text(if (create) "This piece is on this sale only." else "These changes apply to this sale only, not to the piece in stock.") }) {
        ValueRow("Line total") {
            NumericText(Money.pkr(preview), preview, style = MaterialTheme.typography.titleMedium)
        }
    }
}
