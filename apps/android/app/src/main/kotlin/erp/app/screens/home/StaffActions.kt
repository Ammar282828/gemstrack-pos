package erp.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import erp.app.screens.marketing.MarketingKit
import erp.app.ui.LedgerHeading
import erp.app.ui.QuickAction
import erp.app.ui.ledgerCard
import erp.app.ui.icons.Symbols

/**
 * An employee's Home has no figures (the owner, 2026-11-05: "Dashboard should not have numbers, just tailored features for
 * her"; src/components/home/staff-actions.tsx): the things she does, one tap each, then the work lists below it. The
 * marketing row only for a staff member who also runs the marketing (`alsoMarketing`), and Help always.
 *
 * What staff can do from this app is what the ERP lets their account write: New order, Scan a tag, New customer and the
 * Workshop. A sale and a repair are saved for owners alone here (`createInvoice`, `addRepair`), so those two shortcuts of
 * the web's row are not offered.
 */
private class StaffShortcut(val title: String, val icon: ImageVector, val path: String, val prominent: Boolean = false)

@Composable
fun StaffActions(role: String, marketing: Boolean, open: (String) -> Unit) {
    val work = listOf(
        StaffShortcut("New order", Symbols.Assignment, "/orders/add", prominent = true),
        StaffShortcut("Scan a tag", Symbols.QrCodeScanner, "/scan"),
        StaffShortcut("New customer", Symbols.PersonAdd, "/customers/add"),
        StaffShortcut("Workshop", Symbols.Hardware, "/workshop"),
        StaffShortcut("Help", Symbols.HelpOutline, "/help"),
    )
    // Each only where this house has it (the map is cut to the house's flags): Stories, Design and New ad are not every house's.
    val marketingRow = listOfNotNull(
        StaffShortcut("Add photos", Symbols.AddPhotoAlternate, "/website/photos").takeIf { MarketingKit.has("/website/photos", role) },
        StaffShortcut("Design", Symbols.Palette, "/design").takeIf { MarketingKit.has("/design", role) },
        StaffShortcut("Stories", Symbols.PhotoCamera, "/posts/stories").takeIf { MarketingKit.has("/posts/stories", role) || MarketingKit.has("/posts", role) },
        StaffShortcut("New ad", Symbols.Campaign, "/ads/new").takeIf { MarketingKit.has("/ads/new", role) },
    )
    Column(Modifier.fillMaxWidth().ledgerCard(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ShortcutRow(work, open)
        if (marketing && marketingRow.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                LedgerHeading("Marketing")
                ShortcutRow(marketingRow, open)
            }
        }
    }
}

/** Up to four to a line, the same width each, so a short line keeps its tiles the size of a full one. */
@Composable
private fun ShortcutRow(items: List<StaffShortcut>, open: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (line in items.chunked(4)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (s in line) QuickAction(s.title, s.icon, { open(s.path) }, Modifier.weight(1f), prominent = s.prominent)
                repeat(4 - line.size) { androidx.compose.foundation.layout.Spacer(Modifier.weight(1f)) }
            }
        }
    }
}
