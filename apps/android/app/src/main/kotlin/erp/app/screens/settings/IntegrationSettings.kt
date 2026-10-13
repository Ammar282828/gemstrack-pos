package erp.app.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Sync
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.ui.ActionRow
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.ValueRow
import erp.app.ui.ledgerRow
import erp.core.models.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings → Integrations (src/app/settings/integrations): the website, Shopify and Meta. Connecting any of them is a
 * sign-in on the other service's own page, so this shows where each stands and opens the ERP's page for the rest.
 */
@Composable
fun IntegrationSettings() {
    SettingsGate("Integrations") { IntegrationsForm(it) }
}

@Composable
@Suppress("UNUSED_PARAMETER")
private fun IntegrationsForm(settings: Settings) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var shopify by remember { mutableStateOf<ShopifyStatus?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    suspend fun check() {
        failure = null
        try {
            shopify = ShopifyStatus.from(ErpApi.shared.get("/api/shopify/status"))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e.message ?: e.toString()
        }
    }
    LaunchedEffect(Unit) { check() }

    SettingsPage {
        if (session.shop.websiteSelling) {
            SettingsSection(footer = "Whether the site takes orders, and at what rate.") {
                SettingsNavRow("Selling on the website", Icons.Filled.Language, "/settings/integrations?web=1")
            }
        }

        SettingsSection("Shopify") {
            val s = shopify
            if (s != null) {
                ValueRow("Status") { ReadOnly(ShopifyLogic.statusText(s)) }
                s.shop?.let { domain -> ValueRow("Store") { ReadOnly(domain) } }
                if (s.configured) ValueRow("Last synced") { ReadOnly(s.lastSyncedAt?.let { ShopDate.say(it, withTime = true) } ?: "Not yet") }
                s.error?.let { NoteRow(it) }
            } else if (failure != null) {
                NoteRow(failure!!)
                ActionRow("Check connection again", onClick = { scope.launch { check() } })
            } else {
                Column(Modifier.fillMaxWidth().ledgerRow()) { SkeletonLoading(compact = true) }
            }
            if (shopify?.configured != false) {
                SettingsNavRow("Connection and import", Icons.Filled.Sync, "/app/settings/shopify")
            }
            SettingsNavRow("On the ERP's page", Icons.Filled.Language, "/settings/integrations?web=1")
        }

        SettingsSection("Meta", "The Facebook login, ad account, Page, Instagram and pixel.") {
            SettingsNavRow("Ads › Setup", Icons.Filled.Campaign, "/ads/setup")
        }

        SettingsSection {
            SettingsNavRow("Labels and tags", Icons.Filled.LocalOffer, "/settings/printer")
        }
    }
}
