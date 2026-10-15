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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import erp.app.config.House
import erp.app.nav.ScreenTitle
import erp.app.ui.ChipRow
import erp.app.ui.FilterChip
import androidx.compose.foundation.isSystemInDarkTheme
import erp.app.widget.WidgetSize
import erp.app.widget.WidgetFacePreview
import erp.app.widget.WidgetStore
import erp.app.widget.WidgetSummary
import erp.app.widget.previewHeight
import erp.app.widget.previewWidth

/**
 * `/app/widgets` (WidgetPreviewScreen.swift): the widget's real faces, drawn from the same plan as the home-screen
 * widget, with explicitly labelled sample figures (or, once the widget is linked and has read them, the shop's own).
 * Light and Dark show the faces as the widget draws them in either mode of the device.
 */
@Composable
fun WidgetPreviewScreen() {
    ScreenTitle("Widgets")
    val context = LocalContext.current
    val deviceDark = isSystemInDarkTheme()
    var dark by rememberSaveable { mutableStateOf(deviceDark) }
    var live by rememberSaveable { mutableStateOf(false) }
    // What the widget last read, if it is linked and has read anything.
    val kept = remember { WidgetStore.load(context)?.let { WidgetStore.cached(context, it) } }
    val summary = if (live && kept != null) kept else WidgetSummary.sample(House.storeName)

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (live && kept != null) "Your shop’s figures" else "Sample figures and message", style = MaterialTheme.typography.titleSmall)
            Text(
                if (live && kept != null) "As the widget last read them from the ERP." else "These are examples, not your shop’s numbers.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        ChipRow {
            FilterChip("Light", chosen = !dark, onClick = { dark = false })
            FilterChip("Dark", chosen = dark, onClick = { dark = true })
            if (kept != null) {
                FilterChip("Sample", chosen = !live, onClick = { live = false })
                FilterChip("Your shop", chosen = live, onClick = { live = true })
            }
        }
        // The faces draw in the chosen mode whatever the device is in, as a widget does in either.
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            for ((title, size) in listOf("Small" to WidgetSize.Small, "Medium" to WidgetSize.Medium, "Large" to WidgetSize.Large)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    WidgetFacePreview(summary, size, House.storeName, Modifier.size(previewWidth(size), previewHeight(size)), dark = dark)
                }
            }
        }
        Text(
            "Your home-screen widget shows the shop’s actual revenue and pinned message after it is linked, and keeps them fresh about every half hour.",
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
