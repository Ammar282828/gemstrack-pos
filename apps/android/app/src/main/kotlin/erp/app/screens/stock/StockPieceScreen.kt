package erp.app.screens.stock

import erp.app.ui.SegmentedColumn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Verified
import erp.app.ui.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfItem
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.sale.SaleStore
import erp.app.ui.HeroAmount
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerHeading
import erp.app.ui.LedgerSection
import erp.app.ui.MoneyRow
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.NotAvailableState
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.app.ui.zoomDestination
import erp.core.logic.PricingRates
import erp.core.logic.ProductCosts
import erp.core.logic.describePlating
import erp.core.logic.isWalkInName
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.MetalType
import erp.core.models.Product
import erp.core.models.Settings
import erp.core.logic.Money

/**
 * One piece in stock (src/app/products/[sku]/page.tsx): its photo, what it sells for at today's rates and how that adds
 * up, and what it is made of. Selling it opens the sale form and Edit the native product form (StockPieceForm);
 * printing its tag is the native tag sheet and deleting it (which asks for the delete code) is the ERP's own page. A piece that has left the
 * stock reads "Sold", with the invoice it went out on.
 */
@Composable
fun StockPieceScreen(sku: String) {
    val book = LocalBook.current
    val products = rememberShelfStatus(book.products)
    val settings by rememberSingle(book.settings)
    val product = rememberShelfItem(book.products, sku)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    ScreenTitle(sku)
    Box(Modifier.fillMaxSize().zoomDestination(StockKit.piecePath(sku))) {
        ShelfState(loaded = products.loaded, error = products.error, offline = products.offline, connectionLost = connectionLost) {
            if (product != null) Detail(product, settings) else StockSoldView(sku)
        }
    }
}

// MARK: The page

@Composable
private fun Detail(p: Product, settings: Settings?) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val owner = session.isOwner
    var tagging by remember { mutableStateOf(false) }
    val rates: PricingRates? = StockKit.rates(settings) ?: (if (p.isCustomPrice) PricingRates() else null)
    val costs: ProductCosts? = remember(p, rates) { rates?.let { StockKit.costs(p, it) } }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth().readableColumn(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item { Hero(p) }
            item { PriceSection(p, costs, settings) }
            if (!p.isCustomPrice) item { SpecsSection(p) }
            if (owner) item { ErpSection(p, { navigator.open(it) }, { tagging = true }) }
        }
        if (tagging) StockPieceTagSheet(p) { tagging = false }
        // Selling is the owners' (createInvoice is owner-only): staff read the piece without a Sell they cannot finish.
        if (owner) {
            Button(
                onClick = {
                    SaleStore.add(p)
                    navigator.open(StockKit.newSalePath)
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).defaultMinSize(minHeight = 52.dp),
            ) {
                Icon(Icons.Filled.ShoppingCart, contentDescription = null)
                Text("  Sell")
            }
        }
    }
}

// MARK: Photo and name

@Composable
private fun Hero(p: Product) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            StockImage(
                p.imageUrl, p.name, p.sku,
                Modifier.widthIn(max = 340.dp).heightIn(max = 340.dp).fillMaxWidth().aspectRatio(1f).clip(Radius.chipShape),
                decodeDataUri = true,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill(StockKit.categoryTitle(p.categoryId), tone = Tone.house)
            Text(p.name, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
            Text(p.sku, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// MARK: Price

/** The total large, then how it adds up. A fixed-price piece shows its description instead of the weights, as the web does. */
@Composable
private fun PriceSection(p: Product, costs: ProductCosts?, settings: Settings?) {
    LedgerSection("Price") {
        Column(Modifier.fillMaxWidth().ledgerRow(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (p.isCustomPrice) "Fixed price" else "At today's rates",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (costs != null && costs.totalPrice > 0) {
                HeroAmount(costs.totalPrice)
            } else {
                Text(totalLine(costs), style = ErpType.heroNumber, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            }
        }
        if (p.isCustomPrice) {
            StockKit.filled(p.description)?.let { note ->
                LedgerDivider()
                TextBlock("Description", note)
            }
        } else if (costs != null) {
            Breakdown(p, costs, settings)
        }
    }
}

internal fun totalLine(costs: ProductCosts?): String {
    if (costs == null) return "—"
    return if (costs.totalPrice > 0) Money.pkr(costs.totalPrice) else "Price N/A"
}

/** Metal, wastage, making, diamonds, stones and sundries, then the total. Silver has no wastage or making line: its rate carries them (lib/pricing.ts). */
@Composable
private fun Breakdown(p: Product, c: ProductCosts, settings: Settings?) {
    val lines = buildList<Pair<String, Double>> {
        add("Metal cost" to c.metalCost)
        if (p.metalType != MetalType.silver) {
            add("Wastage cost" to c.wastageCost)
            add("Making charges" to c.makingCharges)
        }
        if (p.hasDiamonds) add("Diamond charges" to c.diamondCharges)
        add((if (p.hasDiamonds) "Other stone charges" else "Stone charges") to c.stoneCharges)
        add("Misc. charges" to c.miscCharges)
    }
    val rate = settings?.let { StockKit.rateLine(p, it) }
    if (rate != null) {
        LedgerDivider()
        SpecRow(rate.label, "${Money.pkr(rate.perGram)} / gram")
    }
    for ((label, amount) in lines) {
        LedgerDivider()
        MoneyRow(label, amount, Modifier.ledgerRow())
    }
    LedgerDivider()
    MoneyRow("Total", c.totalPrice, Modifier.ledgerRow(), emphasis = true)
}

// MARK: What it is made of

@Composable
private fun SpecsSection(p: Product) {
    val rows = buildList<Pair<String, String>> {
        add("Metal" to StockKit.capitalised(p.metalType.rawValue))
        val k = p.karat
        if (p.metalType == MetalType.gold && k != null && k.rawValue.isNotEmpty()) add("Karat" to k.rawValue.uppercase())
        add("Weight" to StockKit.grams(p.metalWeightG))
        val second = p.secondaryMetalType
        if (second != null && second.rawValue.isNotEmpty() && (p.secondaryMetalWeightG ?: 0.0) > 0) {
            add("Second metal" to StockKit.capitalised(second.rawValue))
            val sk = p.secondaryMetalKarat
            if (second == MetalType.gold && sk != null && sk.rawValue.isNotEmpty()) add("Second metal karat" to sk.rawValue.uppercase())
            add("Second metal weight" to StockKit.grams(p.secondaryMetalWeightG ?: 0.0))
        }
        if (p.metalType != MetalType.silver) add("Wastage" to StockKit.percent(p.wastagePercentage))
        add("Diamonds" to if (p.hasDiamonds) "Yes" else "No")
        if (p.stoneWeightG > 0) add("Stone weight" to StockKit.grams(p.stoneWeightG))
        StockKit.filled(p.size)?.let { add("Size" to it) }
        describePlating(p)?.let { add("Finish" to it) }
    }
    val blocks = buildList<Pair<String, String>> {
        StockKit.filled(p.stoneDetails)?.let { add("Stones and second metal" to it) }
        StockKit.filled(p.diamondDetails)?.let { add("Diamond details" to it) }
        StockKit.filled(p.description)?.let { add("Description" to it) }
    }
    LedgerSection("Details", collapsible = true) {
        rows.forEachIndexed { i, (label, value) ->
            SpecRow(label, value)
            if (i < rows.lastIndex || blocks.isNotEmpty()) LedgerDivider()
        }
        blocks.forEachIndexed { i, (label, text) ->
            TextBlock(label, text)
            if (i < blocks.lastIndex) LedgerDivider()
        }
    }
}

/** A label and what it says, the value at the right (SwiftUI's `LabeledContent`). */
@Composable
private fun SpecRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
        Text(label, Modifier.weight(0.5f), style = MaterialTheme.typography.bodyLarge)
        Text(
            value, Modifier.weight(0.5f), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"),
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun TextBlock(title: String, text: String) {
    Column(Modifier.fillMaxWidth().ledgerRow(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

// MARK: Edit, and the ERP's own pages

/**
 * Edit is the native product form and Print tag the native tag sheet (StockPieceTag.kt: the QR, the shop's tag to a Zebra or
 * Label LIVE, the CSV). The photo is added, changed or taken off here and saves at once. Delete is the ERP's page: it asks for
 * the delete code there. Owners only (Stock is theirs).
 */
@Composable
private fun ErpSection(p: Product, open: (String) -> Unit, onTag: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        SegmentedColumn {
            LinkRow("Edit", Icons.Filled.Edit, ErpColors.accent) { open(StockKit.editPath(p.sku)) }
            LedgerDivider()
            LinkRow("Print tag", Icons.Filled.Print, ErpColors.accent, onTag)
        }
        LedgerSection("Photo") { StockPiecePhotoField(p.sku, p.name, p.imageUrl) }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerHeading("On the ERP's page", Modifier.padding(horizontal = 16.dp))
            SegmentedColumn {
                LinkRow("Delete", Icons.Filled.Delete, Tone.problem.color()) { open(StockKit.piecePath(p.sku, web = true)) }
            }
            Text(
                "This opens the ERP's own page. Delete asks for the delete code there.",
                Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun LinkRow(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, ink: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).ledgerRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = ink)
    }
}

// MARK: Sold

/** The invoices that carry a SKU: a piece that is not in the stock is sold, if one does. */
internal fun salesOf(sku: String, invoices: List<Invoice>): List<Invoice> = invoices.filter { inv -> inv.items.any { it.sku == sku } }

/** A piece that is not in the stock: sold, if an invoice carries its SKU. The invoices are read only now, so an ordinary piece page does not pay for the whole book. */
@Composable
private fun StockSoldView(sku: String) {
    val book = LocalBook.current
    val navigator = LocalNavigator.current
    val invoices = rememberShelfStatus(book.invoices)
    if (!invoices.loaded) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SkeletonLoading() }
        return
    }
    val sales = remember(invoices.revision, sku) { salesOf(sku, invoices.items) }
    if (sales.isEmpty()) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            NotAvailableState(
                "Not in stock",
                why = invoices.error ?: "No piece with the SKU $sku is in stock, and no invoice carries it.",
                icon = Icons.Filled.Inventory2,
            )
            TextButton(onClick = { navigator.open("/products") }) { Text("All stock") }
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().readableColumn(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.Verified, contentDescription = null, Modifier.padding(bottom = 2.dp), tint = Tone.settled.color())
                Text("Sold", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                Text("$sku is no longer in stock.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            LedgerSection(if (sales.size == 1) "Sold on" else "Sold on these invoices") {
                sales.forEachIndexed { i, inv ->
                    Box(Modifier.clickable(role = Role.Button) { navigator.open("/invoices/" + StockKit.encode(inv.id)) }.ledgerRow()) { SaleRow(sku, inv) }
                    if (i < sales.lastIndex) LedgerDivider()
                }
            }
        }
    }
}

internal fun saleSubtitle(inv: Invoice): String {
    val name = inv.customerName.trim()
    val who = if (name.isEmpty() || isWalkInName(name)) "Walk-in" else name
    val whenText = ShopDate.say(inv.createdAt)
    return if (whenText.isEmpty()) who else "$who · $whenText"
}

@Composable
private fun SaleRow(sku: String, inv: Invoice) {
    val item = inv.items.firstOrNull { it.sku == sku }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        TwoLine(inv.id, Modifier.weight(1f), subtitle = saleSubtitle(inv), trailing = item?.let { Money.pkr(it.itemTotal) })
        if (inv.status == InvoiceStatus.refunded) Pill("Refunded", tone = Tone.quiet)
    }
}
