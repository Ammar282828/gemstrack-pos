package erp.app.screens.settings

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.Businesses
import erp.app.data.ErpApi
import erp.app.ui.AlertDialog
import erp.app.ui.Button
import erp.app.ui.FieldRow
import erp.app.ui.Tone
import erp.app.ui.TextButton
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.rememberHaptics
import erp.core.logic.SafepayLink
import erp.core.models.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

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

        if (session.isOwner) SafepaySection()

        SettingsSection {
            SettingsNavRow("Labels and tags", Symbols.LocalOffer, "/settings/printer")
        }
    }
}

/**
 * Safepay (owner, 2026-11-09; ops-paylinks.ts `setSafepayKey`): the house's PUBLIC key, which turns on the payment link on invoices
 * and orders. Owners only. Disconnect (or saving an empty box) turns it off; the ERP answers whether links are on.
 */
@Composable
private fun SafepaySection() {
    val connected = Businesses.currentFlow.collectAsStateWithLifecycle().value.offersPaymentLinks
    var key by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val trimmed = key.trim()
    val bad = trimmed.isNotEmpty() && !SafepayLink.isPublicKey(trimmed)

    /** An empty key disconnects. Needs a connection (it is not kept to send later): the write says so itself. */
    fun save(publicKey: String) {
        if (saving) return
        scope.launch {
            saving = true
            error = null
            try {
                val out = ErpApi.shared.write("setSafepayKey", mapOf("publicKey" to publicKey), queueOffline = false)
                Businesses.setPaymentLinks(out["paymentLinks"] as? Boolean ?: publicKey.isNotEmpty())
                key = ""
                haptics.success()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
                haptics.failure()
            }
            saving = false
        }
    }

    SettingsSectionWith(
        "Safepay",
        footer = {
            if (bad) Text("That is not a public key: it starts with sec_ and is letters and numbers only.", color = Tone.problem.color())
            else Text("Safepay dashboard \u2192 Developer \u2192 API \u2192 Public key (starts with sec_). Never the Secret key.")
        },
    ) {
        ValueRow("Safepay") { Text(if (connected) "Connected" else "Not connected", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        FieldRow("Public key", key, { key = it }, placeholder = "sec_\u2026", enabled = !saving)
        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { save(trimmed) }, enabled = !saving && SafepayLink.isPublicKey(trimmed)) { Text("Save") }
            if (connected) TextButton(onClick = { confirming = true }, enabled = !saving) { Text("Disconnect", color = Tone.problem.color()) }
        }
        error?.let { ErrorRow(it) }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Disconnect Safepay?") },
            text = { Text("Invoices and orders stop offering a payment link. Links already sent still work.") },
            confirmButton = { TextButton(onClick = { confirming = false; save("") }) { Text("Disconnect", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
        )
    }
}
