package erp.app.screens.sale

import erp.app.ui.icons.Symbols
import erp.app.ui.SegmentedColumn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import erp.app.data.LocalBook
import erp.app.data.rememberSingle
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.LedgerHeading
import erp.app.ui.LedgerSection
import erp.app.ui.Radius
import erp.app.ui.fill
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.entry.EntryHouse
import erp.core.entry.SaleDraft
import erp.core.logic.Money
import erp.core.logic.PricingRates
import erp.core.logic.calculateProductCosts
import erp.app.ui.ActionRow

/**
 * The one way into a sale (src/app/new/page.tsx). The decision is the thing you know first: the customer is either
 * buying now, commissioning a piece, or bringing one in to be fixed, and it changes which fields matter. So it is
 * asked first, and each answer continues on its own screen. Beside the three: a tag scanned, and the paper the counter
 * already wrote.
 */
@Composable
fun NewChooser() {
    ScreenTitle("New")
    val book = LocalBook.current
    val settings by rememberSingle(book.settings)
    val navigator = LocalNavigator.current
    EntryHouse.id = erp.app.config.House.id

    // This phone's unfinished sale, if it has pieces.
    var inProgress by remember { mutableStateOf<SaleDraft?>(SaleStore.load()) }
    LifecycleResumeEffect(Unit) {
        inProgress = SaleStore.load()
        onPauseOrDispose {}
    }

    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        inProgress?.takeIf { it.lines.isNotEmpty() }?.let { draft ->
            Untitled("Kept on this phone, and in Drafts for the counter.") {
                ProgressRow(draft, settings) { navigator.open(SaleLinks.continueSale) }
            }
        }

        // One line each, as the system's own "New" menus put it.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerHeading("What is it?", Modifier.padding(horizontal = 16.dp))
            SegmentedColumn {
                Choice("Sale", "Buying now: pieces, payment, the invoice", Symbols.Description, MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.onPrimary) { navigator.open("/invoices/new") }
                Choice("Order", "To be made: sizes, an advance, the workshop", Symbols.Assignment, MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer) { navigator.open("/orders/add") }
                Choice("Repair", "Brought in to be fixed: pieces, price, ready-by", Symbols.Build, MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer) { navigator.open("/repairs?new=1") }
            }
        }

        // The other ways in. Reading a written bill and a parchi are the ERP's AI scanners: its pages.
        LedgerSection("Other ways in") {
            LinkRow("Scan a tag", Symbols.QrCodeScanner) { navigator.open("/scan") }
            LinkRow("Read a written bill", Symbols.DocumentScanner) { navigator.open(SaleLinks.readBill) }
            LinkRow("Scan a parchi", Symbols.Article) { navigator.open("/orders/add?scan=parchi") }
        }

        Untitled("Orders and sales not yet saved, from every device in the shop.") {
            LinkRow("Drafts", Symbols.Inbox) { navigator.open("/drafts") }
        }
    }
}

/** A card of rows with no heading of its own, and a line of small print under it. */
@Composable
private fun Untitled(footer: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SegmentedColumn { content() }
        Text(footer, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * A bill left half-finished should be obvious, and one tap from here. Its figure is the pieces at today's rates, as
 * the web's card shows it.
 */
@Composable
private fun ProgressRow(draft: SaleDraft, settings: erp.core.models.Settings?, open: () -> Unit) {
    val n = draft.lines.size
    var subtotal = 0.0
    if (settings != null) {
        val rates = PricingRates(settings)
        for (line in draft.lines) subtotal += calculateProductCosts(line.priced, rates).totalPrice
    }
    Row(
        Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Button, onClick = open),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Symbols.ShoppingCart, contentDescription = null, tint = erp.app.ui.Tone.owed.fill())
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("A sale in progress", style = MaterialTheme.typography.titleMedium)
            Text(
                "$n piece${if (n == 1) "" else "s"}" + (if (subtotal > 0) " · ${Money.pkr(subtotal)}" else ""),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("Continue", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
    }
}

/** An icon in its own colour, the title and one line: Settings' and Files' rows. */
@Composable
private fun Choice(title: String, blurb: String, icon: ImageVector, tint: Color, ink: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(Radius.thumbShape).background(tint), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, Modifier.size(20.dp), tint = ink)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(blurb, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LinkRow(label: String, icon: ImageVector, onClick: () -> Unit) {
    ActionRow(label, onClick, icon, tone = erp.app.ui.Tone.quiet)
}
