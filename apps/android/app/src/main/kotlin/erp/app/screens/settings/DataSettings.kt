package erp.app.screens.settings

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.LibraryBooks
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Undo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import erp.app.config.House
import erp.core.models.Settings

/**
 * Settings → Data (src/app/settings/data): drafts, backups, what was removed, the imports and the shop's defaults.
 * Backups and the contact and hisaab imports are native (BackupSettings, ContactImportSettings, HisaabImportSettings);
 * and so is the Taheri Software book's one-off import (TaheriBookImportSettings); a backup's Restore stays the ERP's page.
 */
@Composable
fun DataSettings() {
    SettingsGate("Data") { DataForm(it) }
}

@Composable
private fun DataForm(settings: Settings) {
    val writer = rememberSettingsWriter()
    LaunchedEffect(settings) { writer.settled() }

    SettingsPage {
        SettingsSection("Drafts", "A new order or sale is kept as it is typed, on every device, until it is saved.") {
            SettingToggle("Keep unfinished orders and sales", "autoDraftForms", settings.autoDraftForms, writer)
            SettingsNavRow("Drafts", Icons.Filled.Description, "/drafts")
        }

        SettingsSection("Keep and restore") {
            SettingsNavRow("Backups", Icons.Filled.Save, "/settings/backups")
            SettingsNavRow("Recently removed", Icons.Filled.Undo, "/settings/recently-removed")
        }

        SettingsSection("Imports", "Bring records in from a phone or another app.") {
            SettingsNavRow("Import contacts", Icons.Filled.PersonAdd, "/settings/contact-import")
            SettingsNavRow("Import hisaab", Icons.Filled.FileDownload, "/settings/hisaab-import")
            if (House.id == "taheri") SettingsNavRow("Import Taheri Software book", Icons.Filled.LibraryBooks, "/settings/import-taheri")
        }

        SettingsSection(footer = "Resets the shop name, address and number. No orders or invoices are touched.") {
            SettingsNavRow("Restore shop defaults", Icons.Filled.Restore, "/settings/data?web=1")
        }

        SettingsErrorSection(writer)
    }
}
