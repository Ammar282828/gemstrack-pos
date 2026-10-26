package erp.app.screens.sale

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AddShoppingCart
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingCart
import erp.app.ui.Button
import erp.app.ui.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import coil3.compose.AsyncImage
import erp.app.auth.LocalSession
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.MinTouchTarget
import erp.app.ui.MoneyFeedback
import erp.app.ui.NumericText
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.core.entry.SaleLookup
import erp.core.entry.SaleNumber
import erp.core.entry.TagCode
import erp.core.logic.Money
import erp.core.logic.PricedPiece
import erp.core.logic.PricingRates
import erp.core.logic.calculateProductCosts
import erp.core.logic.describeMetal
import erp.core.logic.isWalkInName
import erp.core.models.Product

/**
 * Scan a tag (src/app/scan/page.tsx, `/scan`): read a piece's tag, see the piece, then add it to a new sale or open its
 * page. The web page keeps a cart beside the scanner; here the sale is the phone's own unfinished one (SaleStore),
 * which New sale opens.
 *
 * A tag that is not in stock may already be sold: the screen says which sale it went out on.
 */
@Composable
fun ScanTag() {
    ScreenTitle("Scan a tag")
    val book = LocalBook.current
    val products by rememberShelf(book.products)
    val invoices by rememberShelf(book.invoices)
    val settings by rememberSingle(book.settings)
    val navigator = LocalNavigator.current
    val isOwner = LocalSession.current.isOwner

    var found by remember { mutableStateOf<Found?>(null) }
    // The SKU just put on the sale, so its card says so instead of offering it again.
    var addedSku by remember { mutableStateOf<String?>(null) }
    var onSale by remember { mutableIntStateOf(SaleStore.load()?.lines?.size ?: 0) }
    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        onSale = SaleStore.load()?.lines?.size ?: 0
        onPauseOrDispose {}
    }
    MoneyFeedback(success = tick, failure = null)

    fun handle(code: String) {
        val sku = TagCode.sku(code)
        if (sku.isEmpty()) return
        addedSku = null
        val p = SaleLookup.find(sku, products)
        val sold = if (p == null) SaleLookup.soldOn(sku, invoices) else null
        found = when {
            p != null -> Found.Piece(p.sku)
            sold != null -> Found.Sold(sku, sold.id)
            else -> Found.Unknown(sku)
        }
        tick += 1
    }

    fun scanAnother() {
        found = null
        addedSku = null
    }

    fun addToSale(p: Product) {
        SaleStore.add(p)
        addedSku = p.sku
        onSale = SaleStore.load()?.lines?.size ?: 0
        tick += 1
    }

    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TagScanner(active = found == null) { code -> handle(code) }
        when (val f = found) {
            is Found.Piece -> {
                val p = products.firstOrNull { it.sku == f.sku }
                if (p != null) PieceCard(p, settings, added = addedSku == p.sku, onSale, isOwner, { addToSale(p) }, { navigator.open(SaleLinks.continueSale) }, { navigator.open(SaleLinks.piece(p.sku)) }, ::scanAnother)
                else UnknownCard(f.sku, ::scanAnother)
            }
            is Found.Sold -> SoldCard(f.code, f.invoice, invoices.firstOrNull { it.id == f.invoice }, { navigator.open(SaleLinks.invoice(f.invoice)) }, ::scanAnother)
            is Found.Unknown -> UnknownCard(f.code, ::scanAnother)
            null -> Unit
        }
        if (found == null && onSale > 0 && isOwner) {
            // Pieces already waiting on the new sale.
            Card {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.ShoppingCart, contentDescription = null)
                    Text("$onSale piece${if (onSale == 1) "" else "s"} on the new sale", style = MaterialTheme.typography.titleMedium)
                }
                FilledTonalButton(onClick = { navigator.open(SaleLinks.continueSale) }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp)) { Text("Open the sale") }
            }
        }
    }
}

/** What the last tag turned out to be. */
private sealed interface Found {
    data class Piece(val sku: String) : Found
    data class Sold(val code: String, val invoice: String) : Found
    data class Unknown(val code: String) : Found
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
}

private fun spec(p: Product): String {
    val parts = ArrayList<String>()
    parts.add(describeMetal(p.metalType, p.karat))
    if (p.metalWeightG > 0) parts.add(SaleNumber.grams(p.metalWeightG) + "g")
    p.size?.takeIf { it.isNotEmpty() }?.let { parts.add("Size $it") }
    return parts.joinToString(" · ")
}

@Composable
private fun PieceCard(
    p: Product,
    settings: erp.core.models.Settings?,
    added: Boolean,
    onSale: Int,
    isOwner: Boolean,
    addToSale: () -> Unit,
    openSale: () -> Unit,
    openPiece: () -> Unit,
    scanAnother: () -> Unit,
) {
    val price = settings?.let { calculateProductCosts(PricedPiece(p), PricingRates(it)).totalPrice }
    Card {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            p.imageUrl?.takeIf { it.isNotEmpty() }?.let { url ->
                AsyncImage(url, contentDescription = p.name, Modifier.size(72.dp).clip(Radius.tileShape), contentScale = ContentScale.Crop)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(p.name, style = MaterialTheme.typography.titleMedium)
                Text(p.sku, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(spec(p), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (price != null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Price today", style = MaterialTheme.typography.bodyLarge)
                NumericText(Money.pkr(price), price, style = MaterialTheme.typography.titleMedium)
            }
        }
        if (isOwner) {
            if (added) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Tone.settled.color())
                    Text(
                        "On the new sale · $onSale piece${if (onSale == 1) "" else "s"}",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = Tone.settled.color(),
                    )
                }
                Button(onClick = openSale, Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp)) { Text("Open the sale") }
            } else {
                Button(onClick = addToSale, Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp)) {
                    Icon(Icons.Filled.AddShoppingCart, contentDescription = null, Modifier.size(18.dp))
                    Text("Add to a new sale", Modifier.padding(start = 8.dp))
                }
            }
        }
        FilledTonalButton(onClick = openPiece, Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp)) {
            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, Modifier.size(18.dp))
            Text("Open the piece", Modifier.padding(start = 8.dp))
        }
        TextButton(onClick = scanAnother, Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget)) { Text("Scan another") }
    }
}

@Composable
private fun SoldCard(code: String, invoiceId: String, inv: erp.core.models.Invoice?, open: () -> Unit, scanAnother: () -> Unit) {
    Card {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Search, contentDescription = null)
            Text("$code is not in stock", style = MaterialTheme.typography.titleMedium)
        }
        if (inv != null) {
            val who = if (isWalkInName(inv.customerName) || inv.customerName.isEmpty()) "Walk-in" else inv.customerName
            Text("It was sold on ${inv.id} · ${ShopDate.say(inv.createdAt)} · $who.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text("It was sold on $invoiceId.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FilledTonalButton(onClick = open, Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp)) { Text("Open $invoiceId") }
        TextButton(onClick = scanAnother, Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget)) { Text("Scan another") }
    }
}

@Composable
private fun UnknownCard(code: String, scanAnother: () -> Unit) {
    Card {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Search, contentDescription = null)
            Text("No piece $code in stock", style = MaterialTheme.typography.titleMedium)
        }
        Text(
            "It may be a one-off piece that was billed without being stocked, or it is not entered yet.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FilledTonalButton(onClick = scanAnother, Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp)) { Text("Scan another") }
    }
}
