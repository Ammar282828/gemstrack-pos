package erp.app.screens.stock

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.Prefs
import erp.app.data.Connection
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.invoices.RowAction
import erp.app.screens.invoices.SwipeActions
import erp.app.screens.sale.SaleStore
import erp.app.ui.ChipRow
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.FilterChip
import erp.app.ui.LedgerDivider
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import erp.app.ui.zoomSource
import erp.core.logic.Money
import erp.core.models.Product

/** Grid or list, as the web offers (products/page.tsx `viewMode`). The web starts on the grid; a phone starts on the list. */
enum class StockLayout { list, grid }

/** A piece with what it sells for today (null until the shop's rates have arrived). */
class StockRowModel(val product: Product, val price: Double?) {
    val id: String get() = product.sku
}

internal const val STOCK_LAYOUT_KEY = "stock.layout"

/**
 * Stock: every piece in the shop, what each sells for at today's rates, and what they come to
 * (src/app/products/page.tsx). Owners' screen by the ERP's own choice (nav.ts). Adding and editing a piece are the
 * native product form (StockPieceForm), adding many at once is StockBulkAdd; deleting and the label printer stay the
 * ERP's pages.
 */
@Composable
fun StockList() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val owner = session.isOwner
    val products = rememberShelfStatus(book.products)
    val settings by rememberSingle(book.settings)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()

    var layout by remember { mutableStateOf(runCatching { StockLayout.valueOf(Prefs.string(STOCK_LAYOUT_KEY) ?: "") }.getOrDefault(StockLayout.list)) }
    var search by rememberSaveable { mutableStateOf("") }
    // null is every category; "" is the pieces with none.
    var category by rememberSaveable { mutableStateOf<String?>(null) }

    val all = products.items
    val q = search.trim()
    val shown = remember(all, settings, category, q) {
        val rates = StockKit.rates(settings)
        all.asSequence()
            .filter { category == null || it.categoryId == category }
            .filter { q.isEmpty() || StockKit.matches(it, q) }
            .map { StockRowModel(it, rates?.let { r -> StockKit.costs(it, r).totalPrice }) }
            .toList()
    }
    val filtering = category != null || q.isNotEmpty()

    fun sell(p: Product) {
        SaleStore.add(p)
        navigator.open(StockKit.newSalePath)
    }

    ScreenTitle("Stock")
    ScreenActions {
        IconButton(onClick = {
            layout = if (layout == StockLayout.grid) StockLayout.list else StockLayout.grid
            Prefs.putString(STOCK_LAYOUT_KEY, layout.name)
        }) {
            Icon(
                if (layout == StockLayout.grid) Icons.AutoMirrored.Filled.ViewList else Icons.Filled.GridView,
                contentDescription = if (layout == StockLayout.grid) "List" else "Grid",
            )
        }
        if (owner) IconButton(onClick = { navigator.open(StockKit.addPath) }) { Icon(Icons.Filled.Add, contentDescription = "Add piece") }
    }

    fun actions(p: Product): List<RowAction> = buildList {
        // Selling is the owners' (createInvoice): staff are not offered a sale they cannot save.
        if (owner) {
            add(RowAction("Sell", Icons.Filled.ShoppingCart, Tone.settled) { sell(p) })
            add(RowAction("Edit", Icons.Filled.Edit, Tone.house) { navigator.open(StockKit.editPath(p.sku)) })
            add(RowAction("Delete", Icons.Filled.Delete, Tone.problem) { navigator.open(StockKit.piecePath(p.sku, web = true)) })
        }
    }

    ShelfState(loaded = products.loaded, error = products.error, offline = products.offline, connectionLost = connectionLost) {
        Column(Modifier.fillMaxSize()) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                placeholder = { Text("Search by name or SKU") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                trailingIcon = {
                    if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
                },
                singleLine = true,
                shape = Radius.chipShape,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
            CategoryChips(all, category) { category = it }
            when (layout) {
                StockLayout.list -> ListView(all, shown, owner, filtering, ::actions, onOpen = { navigator.open(StockKit.piecePath(it)) })
                StockLayout.grid -> GridView(all, shown, owner, filtering, ::actions, onOpen = { navigator.open(StockKit.piecePath(it)) })
            }
        }
    }
}

// MARK: Category chips

/** How many pieces each category holds (the web counts the whole stock, whatever is searched). */
internal fun categoryCounts(all: List<Product>): Map<String, Int> {
    val counts = LinkedHashMap<String, Int>()
    for (p in all) counts.merge(p.categoryId, 1, Int::plus)
    return counts
}

@Composable
private fun CategoryChips(all: List<Product>, category: String?, onPick: (String?) -> Unit) {
    val counts = remember(all) { categoryCounts(all) }
    val options = StockKit.categoryOptions(counts, category)
    ChipRow {
        FilterChip("All", chosen = category == null, onClick = { onPick(null) }, count = all.size)
        for (c in options) FilterChip(c.title, chosen = category == c.id, onClick = { onPick(c.id) }, count = counts[c.id] ?: 0)
    }
}

// MARK: Count and worth

/** "N pieces in stock" (the web's subtitle) and, for an owner, what they would sell for today. While a category or a search is on, both figures are of what is shown. */
@Composable
private fun Header(all: List<Product>, shown: List<StockRowModel>, owner: Boolean, filtering: Boolean) {
    FigureRow(Modifier.padding(horizontal = 0.dp), spacing = 12.dp) {
        FigureTile(
            "In stock", "${shown.size} piece${if (shown.size == 1) "" else "s"}",
            Modifier.share(), detail = if (filtering) "of ${all.size} in the shop" else null,
        )
        if (owner) {
            val worth = StockKit.worth(shown.map { it.price })
            FigureTile("Worth today", worth?.let { Money.pkrLac(it) } ?: "—", Modifier.share(), detail = "at today's rates", number = worth ?: 0.0)
        }
    }
}

@Composable
private fun EmptyState(filtering: Boolean) {
    NotAvailableState(
        "No pieces found",
        why = if (filtering) "Try adjusting your search or filter." else "Add a piece to begin.",
        icon = Icons.Filled.Sell,
    )
}

// MARK: List

@Composable
private fun ListView(
    all: List<Product>,
    shown: List<StockRowModel>,
    owner: Boolean,
    filtering: Boolean,
    actions: (Product) -> List<RowAction>,
    onOpen: (String) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp)) {
        item(key = "header") { Box(Modifier.padding(bottom = 16.dp)) { Header(all, shown, owner, filtering) } }
        if (shown.isEmpty()) {
            item(key = "empty") { EmptyState(filtering) }
        } else {
            items(shown.size, key = { shown[it].id }) { i ->
                val row = shown[i]
                val p = row.product
                val first = i == 0
                val last = i == shown.lastIndex
                val shape = RoundedCornerShape(
                    topStart = if (first) Radius.card else 0.dp, topEnd = if (first) Radius.card else 0.dp,
                    bottomStart = if (last) Radius.card else 0.dp, bottomEnd = if (last) Radius.card else 0.dp,
                )
                val menu = actions(p)
                Column(Modifier.clip(shape)) {
                    SwipeActions(
                        start = menu.firstOrNull { it.label == "Sell" },
                        end = menu.firstOrNull { it.label == "Edit" },
                        menu = menu,
                        onClick = { onOpen(p.sku) },
                    ) {
                        Box(Modifier.fillMaxWidth().background(ErpColors.card)) { StockRow(row) }
                    }
                    if (!last) LedgerDivider()
                }
            }
        }
    }
}

/** A price, or why there is none: "Price N/A" for a piece that prices at nothing, a dash while the rates have not arrived. */
@Composable
internal fun StockPrice(price: Double?, modifier: Modifier = Modifier) {
    if (price != null && price > 0) {
        Text(
            Money.pkr(price), modifier,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
            maxLines = 1,
        )
    } else {
        Text(if (price == null) "—" else "Price N/A", modifier, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** One piece in the list: its photo, name and SKU, its metal, weight and category, today's price. */
@Composable
private fun StockRow(row: StockRowModel) {
    val p = row.product
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StockImage(p.imageUrl, p.name, p.sku, Modifier.size(52.dp).clip(Radius.thumbShape).zoomSource(StockKit.piecePath(p.sku)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.name, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(p.sku, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Text(StockKit.detail(p), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        StockPrice(row.price)
    }
}

// MARK: Grid

@Composable
private fun GridView(
    all: List<Product>,
    shown: List<StockRowModel>,
    owner: Boolean,
    filtering: Boolean,
    actions: (Product) -> List<RowAction>,
    onOpen: (String) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(160.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "header", span = { GridItemSpan(maxLineSpan) }) { Header(all, shown, owner, filtering) }
        if (shown.isEmpty()) {
            item(key = "empty", span = { GridItemSpan(maxLineSpan) }) { EmptyState(filtering) }
        } else {
            items(shown, key = { it.id }) { row ->
                SwipeActions(menu = actions(row.product), onClick = { onOpen(row.product.sku) }, modifier = Modifier.clip(Radius.cardShape)) {
                    StockCard(row)
                }
            }
        }
    }
}

/** One piece as a card in the grid. */
@Composable
private fun StockCard(row: StockRowModel) {
    val p = row.product
    Column(Modifier.ledgerCard(padding = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        StockImage(p.imageUrl, p.name, p.sku, Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.tileShape).zoomSource(StockKit.piecePath(p.sku)))
        Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(p.sku, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Text(
            "${StockKit.metalLine(p)} · ${StockKit.grams(p.metalWeightG)}", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
        )
        StockPrice(row.price)
    }
}
