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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfItem
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.customers.FormSection
import erp.app.screens.customers.SavedHeader
import erp.app.screens.customers.TextRow
import erp.app.screens.neworder.NumberRow
import erp.app.screens.neworder.PickerRow
import erp.app.screens.neworder.SizeFieldRow
import erp.app.screens.neworder.ToggleRow
import erp.app.screens.neworder.ValueRow
import erp.app.screens.neworder.formRow
import erp.app.ui.FailureAlert
import erp.app.ui.NotAvailableState
import erp.app.ui.PieceInspector
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.TransactionReviewRow
import erp.app.ui.TransactionWorkspace
import erp.app.ui.color
import erp.app.ui.readableColumn
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.core.DocJSON
import erp.core.entry.NewOrderSizes
import erp.core.logic.METAL_TYPES
import erp.core.logic.calculateProductCosts
import erp.core.logic.describeMetal
import erp.core.logic.karatLabel
import erp.core.logic.karatsFor
import erp.core.logic.metalLabel
import erp.core.logic.platingTypes
import erp.core.models.MetalType
import erp.core.models.Product
import erp.core.logic.Money
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Add a piece to stock (/products/add) or edit one (/products/<sku>/edit): the ERP's product form
 * (src/components/product/product-form.tsx), every field it edits, in its order and under its checks, saved through
 * the ERP (`addProduct` / `updateProduct` on /api/app/write, lib/writes/products.ts): the same SKU numbering, names and
 * gold coin rules as the browser's store. Owners only, as Stock is.
 *
 * The photo is the one thing not here: the web uploads it to Firebase Storage from the browser, and the ERP has no
 * route a phone could send one through, so Photo opens the ERP's own edit page. An edit never sends the photo, the
 * tag's QR or the Shopify ids, so what is on file stays.
 *
 * The web form puts the wastage back to 10% (25% with diamonds) whenever the metal, the diamonds, the stones or the
 * category changes, and also as it opens. Here an edit opens on the piece's own wastage, so changing only its name
 * never moves its price; every other reset is the web's, on opening and on change.
 *
 * [sku] null adds a piece.
 */
@Composable
fun StockPieceForm(sku: String?, onCreated: ((Product) -> Unit)? = null) {
    val book = LocalBook.current
    val session = LocalSession.current
    val products = rememberShelfStatus(book.products)
    val product = if (sku != null) rememberShelfItem(book.products, sku) else null
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { book.settings.need() }
    when {
        !session.isOwner -> {
            ScreenTitle(if (sku == null) "Add piece" else "Edit piece")
            NotAvailableState("Only an owner can change the stock", why = "Ask an owner to add or edit the piece.", icon = Icons.Filled.Lock)
        }
        sku != null -> {
            ScreenTitle("Edit piece")
            ShelfState(loaded = products.loaded, error = products.error, offline = products.offline, connectionLost = connectionLost) {
                if (product != null) StockPieceEditor(product) else NotInStock(sku)
            }
        }
        else -> StockPieceEditor(null, onCreated)
    }
}

/** A sold piece has left the stock, and the ERP's edit page cannot find it either; its own page says where it went. */
@Composable
private fun NotInStock(sku: String) {
    val navigator = LocalNavigator.current
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        NotAvailableState("Not in stock", why = "$sku is not in stock, so it cannot be edited. A sold piece stays as it was sold.", icon = Icons.Filled.Inventory2)
        TextButton(onClick = { navigator.open(StockKit.piecePath(sku)) }) { Text("Open $sku") }
    }
}

// MARK: The form

internal val StockFieldsSaver = mapSaver<StockPieceFields>(
    save = { f ->
        mapOf(
            "name" to f.name, "categoryId" to f.categoryId, "metalType" to f.metalType, "karat" to f.karat, "weight" to f.weight,
            "silverRate" to f.silverRate, "secondMetal" to f.secondMetal, "secondKarat" to f.secondKarat, "secondWeight" to f.secondWeight,
            "wastage" to f.wastage, "making" to f.making, "hasDiamonds" to f.hasDiamonds, "hasStones" to f.hasStones,
            "stoneWeight" to f.stoneWeight, "diamondCharges" to f.diamondCharges, "stoneCharges" to f.stoneCharges,
            "miscCharges" to f.miscCharges, "stoneDetails" to f.stoneDetails, "diamondDetails" to f.diamondDetails,
            "fixed" to f.fixed, "customPrice" to f.customPrice, "description" to f.description, "size" to f.size,
            "platingType" to f.platingType, "platingNote" to f.platingNote, "nickelFree" to f.nickelFree,
        )
    },
    restore = { m ->
        StockPieceFields(
            name = m["name"] as String, categoryId = m["categoryId"] as String, metalType = m["metalType"] as String,
            karat = m["karat"] as String, weight = m["weight"] as String, silverRate = m["silverRate"] as String,
            secondMetal = m["secondMetal"] as String, secondKarat = m["secondKarat"] as String, secondWeight = m["secondWeight"] as String,
            wastage = m["wastage"] as String, making = m["making"] as String, hasDiamonds = m["hasDiamonds"] as Boolean,
            hasStones = m["hasStones"] as Boolean, stoneWeight = m["stoneWeight"] as String,
            diamondCharges = m["diamondCharges"] as String, stoneCharges = m["stoneCharges"] as String,
            miscCharges = m["miscCharges"] as String, stoneDetails = m["stoneDetails"] as String,
            diamondDetails = m["diamondDetails"] as String, fixed = m["fixed"] as Boolean, customPrice = m["customPrice"] as String,
            description = m["description"] as String, size = m["size"] as String, platingType = m["platingType"] as String,
            platingNote = m["platingNote"] as String, nickelFree = m["nickelFree"] as Boolean,
        )
    },
)

private class SavedPiece(val sku: String, val name: String)

@Composable
private fun StockPieceEditor(original: Product?, onCreated: ((Product) -> Unit)? = null) {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val settings by rememberSingle(book.settings)
    val editing = original != null

    var f by rememberSaveable(original?.sku, stateSaver = StockFieldsSaver) {
        mutableStateOf(if (original != null) StockPieceFields.of(original).settle(keepWastage = true) else StockPieceFields().settle())
    }
    var saving by remember { mutableStateOf(false) }
    // Names this new piece for the ERP's once-only check: a retry of the same piece reuses it, the next piece (even with
    // the same figures) gets a fresh one rather than "already sent and recorded".
    var batch by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
    var failure by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<SavedPiece?>(null) }

    val rates = StockKit.rates(settings)
    val todaysPrice: Double? = rates?.let { calculateProductCosts(f.priced, it).totalPrice }

    // What the web form's effect watches: the coin, the diamonds, the stones, the metals, the men's ring. Not as it opens
    // (the opening settle is above), so an edit keeps the piece's own wastage.
    var opened by remember { mutableStateOf(false) }
    LaunchedEffect(f.ruleKey) {
        if (!opened) opened = true else f = f.settle()
    }

    suspend fun save() {
        if (saving) return
        f.problem?.let { failure = it; return }
        // An edit is not a sale: the screen closes at once and the Outbox carries it. A new piece waits for its SKU.
        if (original != null) {
            ErpApi.shared.enqueue("updateProduct", mapOf("sku" to original.sku, "piece" to f.piece), "Piece ${original.sku}")
            haptics.success()
            navigator.back()
            return
        }
        saving = true
        try {
            val out = ErpApi.shared.write("addProduct", mapOf("piece" to f.piece, "batch" to batch))
            batch = UUID.randomUUID().toString()
            @Suppress("UNCHECKED_CAST")
            val doc = out["product"] as? Map<String, Any?> ?: emptyMap()
            val newSku = doc["sku"] as? String ?: ""
            if (newSku.isEmpty()) throw ErpApi.Failure(0, "Saved, but no SKU came back. Check Stock before adding it again.")
            val made: Product? = DocJSON.decode<Product>(newSku, doc)
            if (onCreated != null) {
                if (made == null) throw ErpApi.Failure(0, "The piece was saved but its details were not returned. Check Stock before adding it again.")
                onCreated(made)
            }
            haptics.success()
            saved = SavedPiece(newSku, made?.name ?: newSku)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e.message ?: e.toString()
        }
        saving = false
    }

    fun startAnother() {
        f = StockPieceFields(categoryId = f.categoryId).settle()
        failure = null
        saved = null
    }

    val done = saved
    ScreenTitle(if (done != null) "Saved" else if (editing) "Edit piece" else "Add piece")
    ScreenActions {
        if (done == null) TextButton(onClick = { scope.launch { save() } }, enabled = !saving) { Text("Save") }
        else TextButton(onClick = { navigator.back() }) { Text("Done") }
    }
    BackHandler(enabled = saving) {}
    FailureAlert(failure, onDismiss = { failure = null }, title = if (editing) "The piece wasn't saved" else "The piece wasn't added")

    if (done != null) {
        SavedPage(done, onPhoto = { navigator.open(StockKit.editPath(done.sku) + "?web=1") }, onAnother = ::startAnother, onOpen = { navigator.open(StockKit.piecePath(done.sku)) })
        return
    }

    TransactionWorkspace(
        editor = {
            Box(Modifier.fillMaxSize()) {
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    Form(f, { f = it }, original, todaysPrice, rates != null)
                    if (saving) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
            }
        },
        review = {
            PieceInspector(
                f.name,
                listOf(
                    TransactionReviewRow("Metal", describeMetal(f.metalType, f.karat)),
                    TransactionReviewRow("Size", f.size),
                    TransactionReviewRow("Weight", if (f.weight.isEmpty()) "—" else f.weight + " g"),
                    TransactionReviewRow("At today's rates", todaysPrice?.let { Money.pkr(it) } ?: "Pending rates"),
                ),
            )
        },
        footer = {},
    )
}

@Composable
private fun Segmented(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (id, label) ->
            SegmentedButton(
                selected = selected == id, onClick = { onPick(id) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size), label = { Text(label) },
            )
        }
    }
}

@Composable
private fun Form(f: StockPieceFields, set: (StockPieceFields) -> Unit, original: Product?, todaysPrice: Double?, hasRates: Boolean) {
    PieceSection(f, set)
    if (f.silver) FinishSection(f, set)
    if (f.isMensRing && !f.fixed) SecondMetalSection(f, set)
    SizeSection(f, set)
    PriceSection(f, set, todaysPrice)
    if (!f.fixed && !f.isGoldCoin) StonesSection(f, set)
    PhotoSection(original)
}

// MARK: The piece

@Composable
private fun PieceSection(f: StockPieceFields, set: (StockPieceFields) -> Unit) {
    val categoryOptions = buildList {
        if (f.categoryId.isEmpty()) add("" to "Choose")
        StockKit.categories.forEach { add(it.id to it.title) }
        // A category the ERP's list no longer has stays selectable on the piece that carries it.
        if (f.categoryId.isNotEmpty() && StockKit.categories.none { it.id == f.categoryId }) add(f.categoryId to f.categoryId)
    }
    val metalOptions = buildList {
        METAL_TYPES.forEach { add(it.rawValue to metalLabel(it)) }
        if (none { it.first == f.metalType }) add(f.metalType to metalLabel(f.metalType))
    }
    // The product form offers a karat for gold only (palladium's is the order form's and the sale's).
    val karatOptions = buildList {
        karatsFor(MetalType.gold).forEach { add(it.rawValue to karatLabel(it)) }
        if (f.karat.isNotEmpty() && none { it.first == f.karat }) add(f.karat to karatLabel(f.karat))
    }
    FormSection(title = "The piece", footer = if (!f.fixed) "Left blank, the name is made from the category and the SKU." else null) {
        PickerRow("Category", f.categoryId, categoryOptions) { set(f.copy(categoryId = it)) }
        // A fixed-price piece is named by its description (that is what the save writes into its name), so the box that
        // names the piece is whichever one the price mode uses.
        if (f.fixed) {
            TextRow("Description", f.description, { set(f.copy(description = it)) }, prompt = "e.g. Turkish silver ring with onyx stone", minLines = 2, maxLines = 5, capitalization = KeyboardCapitalization.Sentences)
        } else {
            TextRow("Name", f.name, { set(f.copy(name = it)) }, prompt = "Name (optional)", capitalization = KeyboardCapitalization.Words)
        }
        PickerRow("Metal", f.metalType, metalOptions) { set(f.copy(metalType = it)) }
        if (f.metalType == "gold") {
            Column(Modifier.fillMaxWidth().formRow(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Karat", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Segmented(karatOptions, f.karat) { set(f.copy(karat = it)) }
            }
        }
    }
}

@Composable
private fun FinishSection(f: StockPieceFields, set: (StockPieceFields) -> Unit) {
    val platings = buildList {
        add("" to "No plating")
        platingTypes.forEach { add(it to it) }
        if (f.platingType.isNotEmpty() && none { it.first == f.platingType }) add(f.platingType to f.platingType)
    }
    FormSection(title = "925 Sterling Silver finish") {
        PickerRow("Plating", f.platingType, platings) { set(f.copy(platingType = it)) }
        if (f.platingType == "Other") {
            TextRow("Describe the plating", f.platingNote, { set(f.copy(platingNote = it)) }, prompt = "e.g. Rose gold plating")
        }
        ToggleRow("Nickel free", f.nickelFree) { set(f.copy(nickelFree = it)) }
    }
}

/** A men's ring can carry a second metal, priced from the rate only (the web's "Second metal"). */
@Composable
private fun SecondMetalSection(f: StockPieceFields, set: (StockPieceFields) -> Unit) {
    FormSection(title = "Second metal", footer = "Optional.") {
        PickerRow("Metal", f.secondMetal, listOf("" to "None") + METAL_TYPES.map { it.rawValue to metalLabel(it) }) { set(f.copy(secondMetal = it)) }
        if (f.secondMetal == "gold") {
            val options = buildList {
                if (f.secondKarat.isEmpty()) add("" to "Choose")
                karatsFor(MetalType.gold).forEach { add(it.rawValue to karatLabel(it)) }
            }
            PickerRow("Karat", f.secondKarat, options) { set(f.copy(secondKarat = it)) }
        }
        if (f.secondMetal.isNotEmpty()) NumberRow("Weight", f.secondWeight, { set(f.copy(secondWeight = it)) }, prompt = "e.g. 1.25", unit = "g")
    }
}

// MARK: Size

/** A category with a scale picks its size from it (the web's SizePicker); any other category has no size. */
@Composable
private fun SizeSection(f: StockPieceFields, set: (StockPieceFields) -> Unit) {
    val scale = NewOrderSizes.scale(f.categoryId) ?: return
    FormSection(title = "Size", footer = if (scale.multi) scale.label + ". Leave either blank if not applicable." else scale.label) {
        if (scale.multi) {
            for (part in scale.parts) {
                val parsed = NewOrderSizes.parse(f.size, scale.legacyPartKey)
                SizeFieldRow(part.label, part.options, parsed[part.key] ?: "") { typed ->
                    val now = LinkedHashMap(NewOrderSizes.parse(f.size, scale.legacyPartKey))
                    now[part.key] = typed
                    set(f.copy(size = NewOrderSizes.compose(now, scale.parts.map { it.key })))
                }
            }
        } else {
            scale.parts.firstOrNull()?.let { only -> SizeFieldRow("Size", only.options, f.size) { set(f.copy(size = it)) } }
        }
    }
}

// MARK: Price

@Composable
private fun PriceSection(f: StockPieceFields, set: (StockPieceFields) -> Unit, todaysPrice: Double?) {
    val footer = when {
        f.fixed -> "The reference rate is for the shop's own record only: it does not change the price."
        f.silver -> "The rate is all-inclusive, for this piece. 0 uses the silver rate in settings."
        f.isGoldCoin -> "A gold coin is sold by its weight alone: no making, wastage, stones or sundries."
        else -> null
    }
    FormSection(title = "Price", footer = footer) {
        Column(Modifier.fillMaxWidth().formRow()) {
            Segmented(listOf("0" to "Weight × rate", "1" to "Fixed price"), if (f.fixed) "1" else "0") { set(f.copy(fixed = it == "1")) }
        }
        if (f.fixed) {
            NumberRow("Price (PKR)", f.customPrice, { set(f.copy(customPrice = it)) }, prompt = "e.g. 15000", rupees = true)
            NumberRow("Reference rate per gram", f.silverRate, { set(f.copy(silverRate = it)) }, prompt = "Optional")
        } else {
            NumberRow("Weight", f.weight, { set(f.copy(weight = it)) }, prompt = "e.g. 5.75", unit = "g")
            if (f.silver) {
                NumberRow("Rate per gram (PKR)", f.silverRate, { set(f.copy(silverRate = it)) }, prompt = "e.g. 275")
            } else if (!f.isGoldCoin) {
                NumberRow("Wastage (%)", f.wastage, { set(f.copy(wastage = it)) }, prompt = "e.g. 10")
            }
            if (!f.isGoldCoin) {
                if (!f.silver) NumberRow("Making (PKR)", f.making, { set(f.copy(making = it)) }, prompt = "e.g. 5000", rupees = true)
                NumberRow("Misc (PKR)", f.miscCharges, { set(f.copy(miscCharges = it)) }, prompt = "e.g. 250", rupees = true)
            }
        }
        if (todaysPrice != null) {
            ValueRow("At today's rates", if (todaysPrice > 0) Money.pkr(todaysPrice) else "Price N/A", strong = true)
        }
    }
}

// MARK: Diamonds and stones

@Composable
private fun StonesSection(f: StockPieceFields, set: (StockPieceFields) -> Unit) {
    FormSection(title = "Diamonds and stones") {
        ToggleRow("Has diamonds", f.hasDiamonds) { set(f.copy(hasDiamonds = it)) }
        if (f.hasDiamonds) {
            NumberRow("Diamonds (PKR)", f.diamondCharges, { set(f.copy(diamondCharges = it)) }, prompt = "e.g. 50000", rupees = true)
            TextRow("Diamond details", f.diamondDetails, { set(f.copy(diamondDetails = it)) }, prompt = "e.g. Centre 1ct VVS1, sides 12 × 0.05ct VS2", minLines = 2, maxLines = 4, capitalization = KeyboardCapitalization.Sentences)
        }
        ToggleRow("Has other stones", f.hasStones) { set(f.copy(hasStones = it)) }
        if (f.hasStones) {
            NumberRow("Stone weight", f.stoneWeight, { set(f.copy(stoneWeight = it)) }, prompt = "e.g. 0.5", unit = "g")
            NumberRow("Stones (PKR)", f.stoneCharges, { set(f.copy(stoneCharges = it)) }, prompt = "e.g. 15000")
            TextRow("Stone details", f.stoneDetails, { set(f.copy(stoneDetails = it)) }, prompt = "e.g. 1 × ruby 2ct, and 2g gold accent", minLines = 2, maxLines = 4, capitalization = KeyboardCapitalization.Sentences)
        }
    }
}

// MARK: Photo

/** Photos are the ERP's page: it uploads them from the browser, and the phone has no way to send one. */
@Composable
private fun PhotoSection(original: Product?) {
    val navigator = LocalNavigator.current
    if (original != null) {
        val photo = StockKit.filled(original.imageUrl)
        FormSection(title = "Photo", footer = "The photo is uploaded on the ERP's own page. Everything else saves here, and saving here keeps the photo.") {
            if (photo != null) {
                Box(Modifier.padding(16.dp)) {
                    StockImage(photo, original.name, original.sku, Modifier.size(96.dp).clip(Radius.tileShape), decodeDataUri = true)
                }
            }
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(StockKit.editPath(original.sku) + "?web=1") }.formRow(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Filled.PhotoLibrary, contentDescription = null, tint = ErpColors.accent)
                Text(if (photo == null) "Add a photo in the ERP" else "Change the photo in the ERP", color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
            }
        }
    } else {
        FormSection(title = "Photo", footer = "The photo is uploaded on the ERP's own page, which opens from here after saving.") {
            Row(Modifier.fillMaxWidth().formRow(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.PhotoLibrary, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Add the photo once the piece is saved", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

// MARK: Saved

@Composable
private fun SavedPage(s: SavedPiece, onPhoto: () -> Unit, onAnother: () -> Unit, onOpen: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).readableColumn().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SavedHeader("${s.name} is in stock as ${s.sku}.")
            FormSection(footer = "The photo is added on the ERP's own page. Another piece starts in the same category.") {
                SavedAction("Add a photo", Icons.Filled.AddPhotoAlternate, onPhoto)
                SavedAction("Add another piece", Icons.Filled.Inventory2, onAnother)
            }
        }
        Button(
            onClick = onOpen,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).defaultMinSize(minHeight = 52.dp),
        ) { Text("Open ${s.sku}") }
    }
}

@Composable
private fun SavedAction(text: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).formRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ErpColors.accent)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
    }
}
