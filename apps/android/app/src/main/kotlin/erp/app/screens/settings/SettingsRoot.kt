package erp.app.screens.settings

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import erp.app.ui.AlertDialog
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.BuildConfig
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.nav.NavIcon
import erp.app.nav.NavMap
import erp.app.nav.NavPlace
import erp.app.nav.ScreenTitle
import erp.app.ui.NotAvailableState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors

/**
 * `/settings`: who is signed in, then the shop's settings in the phone Settings app's grouping. Each row opens its own
 * screen, the web's tabs in its order; Backups and the imports are under Data, Labels under Integrations (and Stock),
 * as on the web.
 */
@Composable
fun SettingsRoot() {
    ScreenTitle("Settings")
    val session = LocalSession.current
    if (!session.isOwner) {
        NotAvailableState("Owners only", why = "Settings are the owners’.")
        return
    }
    var signingOut by remember { mutableStateOf(false) }
    val me by session.me.collectAsStateWithLifecycle()

    // The web's Settings sections (nav.ts SETTINGS `section`: Shop, Connections, Records) with their tabs in its order.
    val sections = remember(session.me) {
        val e = NavMap.current.visible(me?.role ?: "owner").settings
        e?.sections?.map { it to e.tabsIn(it) } ?: emptyList()
    }

    SettingsPage {
        SettingsSection { Account(me?.email.orEmpty(), session.shop.person, session.shop.name) }

        for (section in sections) {
            SettingsSection(title = section.first) {
                for (t in section.second) SettingsTabRow(t)
            }
        }

        SettingsSection {
            SettingsLinkRow("Businesses", Symbols.Domain, "/app/businesses")
            SettingsLinkRow("This phone", Symbols.PhoneAndroid, "/app/phone")
        }

        SettingsSection(footer = versionLine(House.storeName, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)) {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { signingOut = true }.ledgerRow(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Sign out", style = MaterialTheme.typography.bodyLarge, color = Tone.problem.color())
            }
        }
    }

    if (signingOut) {
        AlertDialog(
            onDismissRequest = { signingOut = false },
            title = { Text("Sign out of ${session.shop.name}?") },
            text = { Text("The books are cleared from this phone until you sign in again.") },
            confirmButton = { TextButton(onClick = { signingOut = false; session.signOut() }) { Text("Sign out", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { signingOut = false }) { Text("Cancel") } },
        )
    }
}

/** A tab as a row: the app's own look for the ones it has drawn, the map's icon for any the web adds. */
@Composable
private fun SettingsTabRow(t: NavPlace) {
    when (t.href) {
        "/settings" -> SettingsLinkRow("Shop", Symbols.Storefront, "/app/settings/shop")
        "/settings/alerts" -> SettingsLinkRow("Alerts", Symbols.NotificationsActive, t.href)
        "/settings/payment-methods" -> SettingsLinkRow("Bank accounts", Symbols.AccountBalance, t.href)
        "/settings/integrations" -> SettingsLinkRow("Integrations", Symbols.Extension, t.href)
        "/settings/data" -> SettingsLinkRow("Data", Symbols.Storage, t.href)
        "/activity-log" -> SettingsLinkRow("Activity", Symbols.History, t.href)
        "/settings/voice" -> SettingsLinkRow("Voice", Symbols.Mic, t.href)
        else -> SettingsLinkRow(t.label, NavIcon.vector(t.icon), t.href)
    }
}

/** "TAHERI ERP · 0.1.0 (2)": the house and the build. */
fun versionLine(house: String, name: String, code: Int): String = "$house · $name ($code)"

/** The signed-in person, as the top of the phone's own Settings shows its account. */
@Composable
private fun Account(email: String, person: String?, shopName: String) {
    val name = person ?: email
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(56.dp).clip(CircleShape).background(ErpColors.accent), contentAlignment = Alignment.Center) {
            Text(initial(name), style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold), color = ErpColors.onAccent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (person != null && email.isNotEmpty()) {
                Text(email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("Owner · $shopName", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The first letter, upper case (`String(name.prefix(1)).uppercased()`). */
fun initial(name: String): String = name.take(1).uppercase()
