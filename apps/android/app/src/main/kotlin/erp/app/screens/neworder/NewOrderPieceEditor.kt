package erp.app.screens.neworder

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import erp.app.ui.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.ui.MinTouchTarget
import erp.app.ui.NotAvailableState
import erp.app.ui.PieceInspector
import erp.app.ui.TransactionReviewRow
import erp.app.ui.TransactionWorkspace
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.TabularDigits
import erp.core.entry.NewOrderFormat
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderSizes
import erp.core.entry.NewOrderWords
import erp.core.logic.METAL_TYPES
import erp.core.logic.Money
import erp.core.logic.describeMetal
import erp.core.logic.karatsFor
import erp.core.logic.metalLabel
import erp.core.logic.takesWastageAndMaking
import erp.core.logic.wastageGramsFor
import erp.core.models.Karigar
import erp.core.models.MetalType
import erp.core.models.Settings
import java.util.UUID

// One piece, in full (order-form.tsx's open item): what it is, what it costs, what the bench needs, and what it was
// copied from. Every field the web has, under the same names and the same rules. (NewOrderPieceEditor.swift.)

/** One row of the form's list of pieces: what it is, what it is made of, and what it comes to. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun PieceRow(
    title: String,
    spec: String,
    number: Int,
    price: Double,
    onOpen: () -> Unit,
    onDuplicate: () -> Unit,
    onRemove: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val shown = title.ifEmpty { "Untitled piece" }
    Box {
        Row(
            Modifier.fillMaxWidth().formRow()
                .combinedClickable(role = Role.Button, onClick = onOpen, onLongClick = { menu = true })
                .semantics(mergeDescendants = true) { contentDescription = "Piece $number, $shown" + (if (price > 0) ", ${Money.pkr(price)}" else "") },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("#$number", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    shown, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (title.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
                if (spec.isNotEmpty()) {
                    Text(spec, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (price > 0) {
                Text(Money.pkr(price), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits))
            }
            IconButton(onClick = { menu = true }, Modifier.size(MinTouchTarget)) {
                Icon(Icons.Filled.MoreVert, "More for piece $number", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text("Duplicate") }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) }, onClick = { menu = false; onDuplicate() })
            DropdownMenuItem(
                text = { Text("Remove", color = Tone.problem.color()) },
                leadingIcon = { Icon(Icons.Filled.Delete, null, tint = Tone.problem.color()) },
                onClick = { menu = false; onRemove() },
            )
        }
    }
}

/** The editor, over the form: "Piece N" with Save product (which only closes: every change is already in the draft). */
@Composable
internal fun PieceEditor(
    holder: DraftHolder,
    pieceId: UUID,
    settings: Settings?,
    karigars: List<Karigar>,
    editingOrder: Boolean,
    onDuplicate: () -> Unit,
    onRemove: () -> Unit,
    onClose: () -> Unit,
) {
    val d = holder.read()
    val index = d.pieces.indexOfFirst { it.id == pieceId }
    FullScreenPage(
        title = if (index >= 0) "Piece ${index + 1}" else "Piece",
        onBack = onClose,
        actions = { TextButton(onClick = onClose) { Text("Save product") } },
    ) {
        if (index < 0) {
            NotAvailableState("That piece is gone", icon = Icons.Filled.Delete)
        } else {
            PieceEditorBody(holder, pieceId, settings, karigars, editingOrder, onDuplicate = { onDuplicate(); onClose() }, onRemove = { onRemove(); onClose() })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PieceEditorBody(
    holder: DraftHolder,
    pieceId: UUID,
    settings: Settings?,
    karigars: List<Karigar>,
    editingOrder: Boolean,
    onDuplicate: () -> Unit,
    onRemove: () -> Unit,
) {
    val d = holder.read()
    val piece = d.pieces.firstOrNull { it.id == pieceId } ?: return
    val rates = NewOrderMath.formRates(d, settings)
    val metal = MetalType.of(piece.metal)
    val price = NewOrderMath.price(piece, rates)
    var confirmRemove by remember { mutableStateOf(false) }
    fun edit(block: erp.core.entry.NewOrderPieceDraft.() -> Unit) = holder.editPiece(pieceId, block)

    TransactionWorkspace(
        editor = {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                // The piece
                FormCard(title = "The piece") {
                    PickerRow("Category", piece.category, listOf("" to "None") + NewOrderWords.categories.map { it.id to it.label }) { c -> edit { category = c } }
                    WideFieldRow("Description", piece.description, { t -> edit { description = t } }, prompt = "e.g. Custom ring with ruby stone", minLines = 2, maxLines = 5)
                    PickerRow("Metal", piece.metal, METAL_TYPES.map { it.rawValue to metalLabel(it) }) { m -> edit { setMetal(m) } }
                    val karats = karatsFor(metal)
                    if (karats.isNotEmpty()) {
                        Column(Modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Karat", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                                karats.forEachIndexed { i, k ->
                                    SegmentedButton(
                                        selected = piece.karat == k.rawValue,
                                        onClick = { edit { karat = k.rawValue } },
                                        shape = SegmentedButtonDefaults.itemShape(i, karats.size),
                                        label = { Text(k.rawValue.uppercase()) },
                                    )
                                }
                            }
                        }
                    }
                    // 925 sterling silver's finish: plating, and whether it is nickel free.
                    if (metal == MetalType.silver) {
                        PickerRow("Plating", piece.platingType, listOf("" to "No plating") + NewOrderWords.platings.map { it to it }) { p -> edit { platingType = p } }
                        if (piece.platingType == "Other") {
                            FieldRow("Plating", piece.platingNote, { t -> edit { platingNote = t } }, prompt = "e.g. Rose gold plating")
                        }
                        ToggleRow("Nickel free", piece.nickelFree) { on -> edit { nickelFree = on } }
                    }
                }

                // Size
                NewOrderSizes.scale(piece.category)?.let { scale ->
                    FormCard(title = "Size", footer = if (scale.multi) scale.label + ". Leave either blank if not applicable." else scale.label) {
                        if (scale.multi) {
                            scale.parts.forEach { part ->
                                val parsed = NewOrderSizes.parse(piece.size, scale.legacyPartKey)
                                SizeFieldRow(part.label, part.options, parsed[part.key] ?: "") { typed ->
                                    val next = NewOrderSizes.parse(piece.size, scale.legacyPartKey).toMutableMap()
                                    next[part.key] = typed
                                    edit { size = NewOrderSizes.compose(next, scale.parts.map { it.key }) }
                                }
                            }
                        } else {
                            scale.parts.firstOrNull()?.let { only -> SizeFieldRow("Size", only.options, piece.size) { t -> edit { size = t } } }
                        }
                    }
                }

                // Price
                FormCard(title = "Price", footer = if (!piece.manual) "Weight is with the stones in; the stones' weight comes off the metal." else null) {
                    Column(Modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("How it is priced", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            listOf(false to "Weight × rate", true to "Fixed price").forEachIndexed { i, (fixed, label) ->
                                SegmentedButton(
                                    selected = piece.manual == fixed,
                                    onClick = { edit { manual = fixed } },
                                    shape = SegmentedButtonDefaults.itemShape(i, 2),
                                    label = { Text(label) },
                                )
                            }
                        }
                    }
                    if (piece.manual) {
                        NumberRow("Price (PKR)", piece.manualPrice, { t -> edit { manualPrice = t } }, prompt = "The agreed total", rupees = true)
                    } else {
                        // Weight and wastage together: the two numbers the metal price is made from. Silver's rate already
                        // holds its making and wastage, so silver asks for neither (decisions.md "Order to invoice").
                        NumberRow("Weight", piece.weight, { t -> edit { weight = t } }, unit = "g")
                        if (takesWastageAndMaking(metal)) {
                            WastageRow(piece.wastage, { t -> edit { wastage = t } }, piece.weightValue, piece.stoneWeightValue)
                            NumberRow("Making (PKR)", piece.making, { t -> edit { making = t } }, rupees = true)
                        }
                        NumberRow("Stones (PKR)", piece.stones, { t -> edit { stones = t } }, rupees = true)
                        ToggleRow("Has diamonds", piece.hasDiamonds) { on -> edit { hasDiamonds = on } }
                        if (piece.hasDiamonds) {
                            NumberRow("Diamonds (PKR)", piece.diamond, { t -> edit { diamond = t } }, rupees = true)
                            WideFieldRow("Diamond details", piece.diamondDetails, { t -> edit { diamondDetails = t } }, prompt = "e.g. Centre 1ct VVS1, sides 12 × 0.05ct VS2", minLines = 2, maxLines = 4)
                        }
                        ToggleRow("Has other stones", piece.hasStones) { on -> edit { hasStones = on } }
                        if (piece.hasStones) {
                            NumberRow("Stone weight", piece.stoneWeight, { t -> edit { stoneWeight = t } }, prompt = "e.g. 0.5", unit = "g")
                            WideFieldRow("Stone details", piece.stoneDetails, { t -> edit { stoneDetails = t } }, prompt = "e.g. 1 × ruby 2ct, 4 × sapphire 0.5ct", minLines = 2, maxLines = 4)
                        }
                    }
                }

                // The workshop
                FormCard(title = "For the workshop", footer = "The instructions are never printed on a customer estimate or invoice.") {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Lock, null, Modifier.size(16.dp), tint = Tone.owed.color())
                        Text("Instructions for the karigar", style = MaterialTheme.typography.bodyMedium, color = Tone.owed.color())
                    }
                    WideFieldRow("Instructions", piece.adminNote, { t -> edit { adminNote = t } }, prompt = "Stones, plating, sizing, or other specifications", minLines = 2, maxLines = 6)
                    PickerRow("Karigar", piece.karigarId, listOf("" to "No karigar yet") + karigars.map { it.id to it.name }) { k -> edit { karigarId = k } }
                    if (editingOrder) ToggleRow("Piece is finished", piece.isCompleted) { on -> edit { isCompleted = on } }
                }

                // References
                FormCard(title = "References", footer = "All optional.") {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) { SampleField(holder, pieceId) }
                    FieldRow(
                        "Reference SKU", piece.referenceSku, { t -> edit { referenceSku = t } }, prompt = "e.g. RIN-123456",
                        capitalization = KeyboardCapitalization.Characters,
                    )
                    ToggleRow("Customer provided a physical sample", piece.sampleGiven) { on -> edit { sampleGiven = on } }
                }

                // Total
                FormCard {
                    ValueRow("This piece", Money.pkr(price), strong = true)
                }

                FormCard {
                    ActionRow("Duplicate this piece", icon = Icons.Filled.ContentCopy, onClick = onDuplicate)
                    ActionRow("Remove this piece", icon = Icons.Filled.Delete, destructive = true, onClick = { confirmRemove = true })
                }
            }
        },
        review = {
            PieceInspector(
                title = piece.description,
                rows = listOf(
                    TransactionReviewRow("Metal", describeMetal(piece.metal, piece.karat)),
                    TransactionReviewRow("Size", piece.size),
                    TransactionReviewRow("Weight", if (piece.weight.isEmpty()) "—" else piece.weight + " g"),
                    TransactionReviewRow("Estimate", Money.pkr(price)),
                ),
            )
        },
        footer = {},
    )

    if (confirmRemove) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = { Text("Remove this piece?") },
            confirmButton = { TextButton(onClick = { confirmRemove = false; onRemove() }) { Text("Remove piece", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text("Keep it") } },
        )
    }
}

/**
 * Wastage, one figure two ways (decisions.md "Order to invoice"): the percentage, and the grams it stands for on the
 * metal less its stones. Either can be typed; the percentage is what the order keeps (the workshop slip keeps the
 * percentage, and the invoice prints the grams).
 */
@Composable
internal fun WastageRow(percent: String, onPercent: (String) -> Unit, weight: Double, stoneWeight: Double) {
    // The grams the percentage stands for now.
    val grams = wastageGramsFor(NewOrderFormat.num(percent), weight, stoneWeight)
    val words = NewOrderFormat.boxText(grams, digits = 3)
    var gramsText by remember { mutableStateOf(words) }
    var focused by remember { mutableStateOf(false) }
    // Typing the percentage (or the weight) refreshes the grams, unless the grams are what is being typed.
    LaunchedEffect(grams) { if (!focused) gramsText = words }
    NumberRow("Wastage (%)", percent, onPercent, prompt = "0")
    FieldRow(
        "Wastage (grams)", gramsText,
        { typed ->
            gramsText = typed
            if (focused) onPercent(NewOrderMath.wastageText(typed, weight, stoneWeight))
        },
        prompt = if (weight > 0) "0" else "Weigh it first",
        number = true,
        onFocus = { focused = it },
    )
}
