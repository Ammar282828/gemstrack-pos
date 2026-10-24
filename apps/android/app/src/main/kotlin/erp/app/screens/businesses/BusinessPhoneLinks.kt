package erp.app.screens.businesses

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.device.Push
import erp.app.device.WidgetLinker
import erp.app.screens.settings.SettingsSection
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow

/**
 * Settings → This phone: each business on the phone and whether it is linked here, for alerts and for the widget (Settings → This phone lists
 * each business in the iPhone's). The phone's token is each business's own (its Firebase project has its own sender); a business is told of it
 * when somebody is signed in to it. The kinds of alert below are chosen for the open business.
 */
@Composable
fun BusinessPhoneLinks() {
    val list by Businesses.list.collectAsStateWithLifecycle()
    val states by Push.states.collectAsStateWithLifecycle()
    if (House.isDemo || list.size < 2) return
    SettingsSection("Businesses on this phone", "Alerts and the widget are linked per business, when you sign in to it. The kinds of alert are chosen for the open one.") {
        for (b in list) {
            val signedIn = remember(b, states) { Businesses.signedInEmail(b) != null }
            val alerts = when {
                !b.androidReady -> "Android sign-in not set up" to Tone.owed
                !signedIn -> "Signed out" to Tone.quiet
                states[b.id] is Push.LinkState.Failed -> "Alerts: couldn't link" to Tone.problem
                Push.token(b) != null -> "Alerts linked" to Tone.settled
                else -> "Alerts not linked" to Tone.quiet
            }
            val widget = if (signedIn && WidgetLinker.isLinked(b)) "widget linked" else null
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                BusinessBadge(b, size = 32.dp)
                Column(Modifier.weight(1f)) {
                    Text(b.displayName, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        listOfNotNull(alerts.first, widget).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = if (alerts.second == Tone.quiet) MaterialTheme.colorScheme.onSurfaceVariant else alerts.second.color(),
                    )
                }
            }
        }
    }
}
