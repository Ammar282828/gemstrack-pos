package erp.app.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.rounded.Domain
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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

    SettingsPage {
        SettingsSection { Account(me?.email.orEmpty(), session.shop.person, session.shop.name) }

        SettingsSection {
            SettingsLinkRow("Shop", Icons.Filled.Storefront, SettingsColors.blue, "/app/settings/shop")
            SettingsLinkRow("Alerts", Icons.Filled.NotificationsActive, SettingsColors.red, "/settings/alerts")
            SettingsLinkRow("Bank accounts", Icons.Filled.AccountBalance, SettingsColors.green, "/settings/payment-methods")
        }

        SettingsSection {
            SettingsLinkRow("Integrations", Icons.Filled.Extension, SettingsColors.purple, "/settings/integrations")
            SettingsLinkRow("Data", Icons.Filled.Storage, SettingsColors.gray, "/settings/data")
            SettingsLinkRow("Activity", Icons.Filled.History, SettingsColors.indigo, "/activity-log")
            SettingsLinkRow("Voice", Icons.Filled.Mic, SettingsColors.pink, "/settings/voice")
        }

        SettingsSection {
            SettingsLinkRow("Businesses", Icons.Rounded.Domain, SettingsColors.orange, "/app/businesses")
            SettingsLinkRow("This phone", Icons.Filled.PhoneAndroid, SettingsColors.teal, "/app/phone")
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
