package erp.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Print
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.nav.ScreenTitle
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import erp.app.ui.ToggleRow
import erp.app.widget.ErpWidget
import erp.app.widget.WidgetFacePreview
import erp.app.widget.WidgetLayout
import erp.app.widget.WidgetLinkData
import erp.app.widget.WidgetSize
import erp.app.widget.WidgetStore
import erp.app.widget.WidgetSummary
import erp.app.widget.previewHeight
import erp.app.widget.previewWidth
import kotlinx.coroutines.launch

/**
 * `/app/widgets` (WidgetPreviewScreen.swift): the widget's real faces, drawn from the same plan as the home-screen
 * widget, with explicitly labelled sample figures (or, once the widget is linked and has read them, the shop's own).
 * Light and Dark show the faces as the widget draws them in either mode of the device. With two businesses on this phone the
 * faces carry both, as the widget does by default; "Show both businesses" turns the second off.
 */
@Composable
fun WidgetPreviewScreen() {
    ScreenTitle("Widgets")
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val deviceDark = isSystemInDarkTheme()
    var dark by rememberSaveable { mutableStateOf(deviceDark) }
    var live by rememberSaveable { mutableStateOf(false) }
    var both by remember { mutableStateOf(Prefs.bool(Prefs.WIDGET_BOTH) ?: true) }
    val list by Businesses.list.collectAsStateWithLifecycle()
    val open by Businesses.currentFlow.collectAsStateWithLifecycle()

    // What the widget last read, if it is linked and has read anything: each business's own.
    val linked = remember { WidgetStore.all(context) }
    val kept = remember(linked) { linked.mapNotNull { l -> WidgetStore.cached(context, l)?.let { l to it } } }
    val showLive = live && kept.isNotEmpty()
    // The sample: this phone's businesses, made-up figures, each under its own name.
    val samples = remember(list, open) {
        list.map { b -> WidgetLinkData.of(b, "") to WidgetSummary.sample(b.displayName) }
    }
    val pool = if (showLive) kept else samples
    val order = list.map { it.id }
    val shown = WidgetLayout.pick(pool.map { it.first }, order, open.id, both).map { l -> l to pool.first { it.first.id == l.id }.second }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (showLive) "Your shop’s figures" else "Sample figures and message", style = MaterialTheme.typography.titleSmall)
            Text(
                if (showLive) "As the widget last read them from each ERP." else "These are examples, not your shop’s numbers.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (list.size > 1) {
            ToggleRow(
                "Show both businesses", both,
                {
                    both = it
                    Prefs.putBool(Prefs.WIDGET_BOTH, it)
                    // The widget on the home screen follows at once.
                    scope.launch { runCatching { ErpWidget().updateAll(context) } }
                },
                sub = "Every size shows both when two are linked; off shows the open business only.",
            )
        }
        ChipRow {
            FilterChip("Light", chosen = !dark, onClick = { dark = false })
            FilterChip("Dark", chosen = dark, onClick = { dark = true })
            if (kept.isNotEmpty()) {
                FilterChip("Sample", chosen = !live, onClick = { live = false })
                FilterChip("Your shop", chosen = live, onClick = { live = true })
            }
        }
        // The faces draw in the chosen mode whatever the device is in, as a widget does in either.
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            for ((title, size) in listOf("Small" to WidgetSize.Small, "Medium" to WidgetSize.Medium, "Large" to WidgetSize.Large)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    WidgetFacePreview(shown, size, House.storeName, Modifier.size(previewWidth(size), previewHeight(size)), dark = dark)
                }
            }
        }
        Text(
            "Your home-screen widget shows each business’s actual takings, the week’s line, what is owed and due, and the shop’s pinned message after it is linked, and keeps them fresh about every half hour. A tap opens the app on that business.",
            Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * Settings → WEPrint (src/app/settings/weprint-api): switched off on the web (its live feed's endpoint never existed),
 * kept so an old bookmark lands somewhere, and saying the same here.
 */
@Composable
fun WeprintSettings() {
    ScreenTitle("WEPrint")
    SettingsPage {
        SettingsSection {
            NoteRow("WEPrint")
            NoteRow("The live feed to WEPrint isn’t set up, so this page is switched off.")
            NoteRow("Export the pieces as CSV from Labels and import that file into WEPrint instead.")
            SettingsNavRow("Open Labels", Icons.Filled.Print, "/settings/printer")
        }
    }
}
