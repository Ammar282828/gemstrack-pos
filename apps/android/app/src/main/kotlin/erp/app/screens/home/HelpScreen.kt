package erp.app.screens.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.FilledTonalButton
import erp.app.ui.LedgerSection
import erp.app.ui.SearchBarField
import erp.app.ui.ledgerRow
import erp.app.ui.icons.Symbols
import erp.core.logic.HelpGuide
import erp.core.logic.HelpGuides

/**
 * Help (src/app/help/page.tsx, 2026-11-05): how to do each thing an employee can do, in a few plain steps, one group of
 * questions per job and a search box; tap a question to open it. The marketing guides only for someone who has marketing
 * (owners, the marketing account, staff who also run it). The guides are `HelpGuides` in core, the web's own words: change
 * one when its screen's buttons change.
 */
@Composable
fun HelpScreen() {
    ScreenTitle("Help")
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val marketing = HelpGuides.hasMarketing(session.role, session.alsoMarketing)
    val metal = if (erp.app.config.Businesses.current.metal == "silver") "Silver" else "Gold"
    var q by rememberSaveable { mutableStateOf("") }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val sections = remember(q, marketing, session.shop.name, metal) { HelpGuides.shown(session.shop.name, metal, q, marketing) }
    val searching = q.trim().isNotEmpty()

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text(
            "How to do each thing in the ERP, step by step. Tap a question to open it.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        SearchBarField(
            q, { q = it }, Modifier.fillMaxWidth(),
            placeholder = { Text("Search, e.g. payment, repair, photos") },
            leadingIcon = { Icon(Symbols.Search, null) },
        )
        if (sections.isEmpty()) {
            Text(
                "Nothing matches “${q.trim()}”. Try another word.",
                Modifier.fillMaxWidth().padding(vertical = 24.dp), style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        for (s in sections) {
            LedgerSection(s.section) {
                for (g in s.guides) {
                    // A search opens every guide it found, as the web does.
                    GuideRow(g, searching || open == g.id, { open = if (open == g.id) null else g.id }) { href -> navigator.open(href) }
                }
            }
        }
        Text(
            "Something not here, or not working as it says? Ask an owner.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
    }
}

@Composable
private fun GuideRow(g: HelpGuide, isOpen: Boolean, toggle: () -> Unit, openPath: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().ledgerRow()) {
        Row(
            Modifier.fillMaxWidth()
                .clickable(role = Role.Button, onClick = toggle)
                .semantics { stateDescription = if (isOpen) "Expanded" else "Collapsed" }
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(g.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
            Icon(
                Symbols.ExpandMore, null, Modifier.rotate(if (isOpen) 180f else 0f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (isOpen) {
            Column(Modifier.padding(top = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                g.steps.forEachIndexed { i, step ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                        Text("${i + 1}.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(step, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                g.tip?.let {
                    Text(
                        it, Modifier.fillMaxWidth().padding(top = 2.dp), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                val href = g.whereHref
                if (href != null && g.whereLabel != null) {
                    FilledTonalButton(onClick = { openPath(href) }) { Text("Open ${g.whereLabel}") }
                }
            }
        }
    }
}
