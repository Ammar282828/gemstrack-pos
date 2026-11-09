package erp.app.screens.settings

import erp.app.ui.icons.Symbols
import androidx.compose.runtime.Composable
import erp.app.auth.LocalSession
import erp.core.models.Settings

/**
 * Settings → Integrations (src/app/settings/integrations): the website and Meta. The website's selling settings are native;
 * Meta's connection is Ads › Setup. Shopify has no card here: the server registers its notices and catches up itself.
 */
@Composable
fun IntegrationSettings() {
    SettingsGate("Integrations") { IntegrationsForm(it) }
}

@Composable
@Suppress("UNUSED_PARAMETER")
private fun IntegrationsForm(settings: Settings) {
    val session = LocalSession.current
    SettingsPage {
        if (session.shop.websiteSelling) {
            SettingsSection(footer = "Whether the site takes orders, and at what rate.") {
                SettingsNavRow("Selling on the website", Symbols.Language, "/app/settings/website")
            }
        }

        SettingsSection("Meta", "The Facebook login, ad account, Page, Instagram and pixel.") {
            SettingsNavRow("Ads › Setup", Symbols.Campaign, "/ads/setup")
        }

        SettingsSection {
            SettingsNavRow("Labels and tags", Symbols.LocalOffer, "/settings/printer")
        }
    }
}
