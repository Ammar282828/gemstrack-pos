package erp.app.screens.settings

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.runtime.Composable
import erp.app.nav.ScreenTitle
import erp.app.ui.NotAvailableState

/**
 * `/app/widgets` (the iPhone's WidgetPreviewScreen: the real widget faces drawn with sample figures). The Android
 * widgets are Glance's and come with the widget phase (docs/features/android-app.md, phase 5); until then this says so,
 * and the preview takes the shape of the faces when they exist.
 */
@Composable
fun WidgetPreviewScreen() {
    ScreenTitle("Widgets")
    NotAvailableState(
        "The widget comes with the widget phase",
        why = "The home-screen widget shows the shop’s revenue and pinned message once it is built and linked. Its preview, with sample figures, will be here.",
        icon = Icons.Filled.Widgets,
    )
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
