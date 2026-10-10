import SwiftUI
import ERPCore

/// Settings → Data (src/app/settings/data): drafts, backups, what was removed, the imports and the
/// shop's defaults. Backups and the contact and hisaab imports are native (BackupSettings, ContactImportSettings,
/// HisaabImportSettings); a backup's Restore and the Taheri Software book's one-off import stay the ERP's pages.
struct DataSettings: View {
    var body: some View {
        SettingsGate(title: "Data") { DataForm(settings: $0) }
    }
}

private struct DataForm: View {
    let settings: Settings
    @State private var writer = SettingsWriter()

    var body: some View {
        Form { Group {
            Section {
                SettingToggle(title: "Keep unfinished orders and sales", key: "autoDraftForms", stored: settings.autoDraftForms, writer: writer)
                NavigationLink(value: Route(path: "/drafts")) { Label("Drafts", systemImage: "doc.text") }
            } header: {
                LedgerHeading(title: "Drafts")
            } footer: {
                Text("A new order or sale is kept as it is typed, on every device, until it is saved.")
            }

            LedgerSection("Keep and restore") {
                NavigationLink(value: Route(path: "/settings/backups")) { Label("Backups", systemImage: "externaldrive") }
                NavigationLink(value: Route(path: "/settings/recently-removed")) { Label("Recently removed", systemImage: "arrow.uturn.backward") }
            }

            Section {
                NavigationLink(value: Route(path: "/settings/contact-import")) { Label("Import contacts", systemImage: "person.crop.circle.badge.plus") }
                NavigationLink(value: Route(path: "/settings/hisaab-import")) { Label("Import hisaab", systemImage: "square.and.arrow.down") }
                if House.id == "taheri" {
                    NavigationLink(value: Route(path: "/settings/import-taheri")) { Label("Import Taheri Software book", systemImage: "books.vertical") }
                }
            } header: {
                LedgerHeading(title: "Imports")
            } footer: {
                Text("Bring records in from a phone or another app.")
            }

            Section {
                NavigationLink(value: Route(path: "/settings/data?web=1")) { Label("Restore shop defaults", systemImage: "arrow.counterclockwise") }
            } footer: {
                Text("Resets the shop name, address and number. No orders or invoices are touched.")
            }

            SettingsErrorSection(writer: writer)
            }
            .houseRows()
        }
        .onChange(of: settings) { _, _ in writer.settled() }
    }
}
