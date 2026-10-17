import SwiftUI
import ERPCore

/// Settings → Data (src/app/settings/data): drafts, backups, what was removed, the imports and the
/// shop's defaults. Backups and the imports are native (BackupSettings, ContactImportSettings, HisaabImportSettings,
/// TaheriBookImportSettings), and so is Restore shop defaults (/api/app/write `restoreShopDefaults`, ops-settings3.ts).
struct DataSettings: View {
    var body: some View {
        SettingsGate(title: "Data") { DataForm(settings: $0) }
    }
}

private struct DataForm: View {
    let settings: Settings
    @State private var writer = SettingsWriter()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// What Restore shop defaults would write, read from the ERP before it is asked.
    @State private var defaults: ShopDefaultsPreview?
    @State private var restoring = false
    @State private var note: Note?

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
                // No server flag says "this house has a Taheri Software book" (it is Taheri's one-off), so this stays a brand
                // check: the bundled Taheri art (the demo wears it), never an added business that only borrows its files.
                if House.bundledArt == "taheri" {
                    NavigationLink(value: Route(path: "/settings/import-taheri")) { Label("Import Taheri Software book", systemImage: "books.vertical") }
                }
            } header: {
                LedgerHeading(title: "Imports")
            }

            Section {
                Button { Task { await previewDefaults() } } label: {
                    HStack {
                        Label("Restore shop defaults", systemImage: "arrow.counterclockwise")
                        if restoring { Spacer(); ProgressView() }
                    }
                }
                .disabled(restoring)
            } footer: {
                Text("Resets the shop name, address and number to this house’s own, and a gold house’s gold rates to gold.pk’s. No orders or invoices are touched.")
            }

            SettingsErrorSection(writer: writer)
            }
            .houseRows()
        }
        .onChange(of: settings) { _, _ in writer.settled() }
        .noteToast($note)
        .confirmationDialog("Restore shop defaults?", isPresented: Binding(get: { defaults != nil }, set: { if !$0 { defaults = nil } }),
                            titleVisibility: .visible, presenting: defaults) { _ in
            Button("Restore") { Task { await restore() } }
            Button("Cancel", role: .cancel) {}
        } message: { d in
            Text(d.summary(settings))
        }
    }

    private func previewDefaults() async {
        restoring = true
        defer { restoring = false }
        do {
            // `seq`: each look is its own (ERPAPI names a change by its content).
            let out = try await ERPAPI.shared.write("restoreShopDefaults", ["preview": true, "seq": UUID().uuidString])
            defaults = ShopDefaultsPreview(out)
        } catch {
            writer.error = error.localizedDescription
        }
    }

    private func restore() async {
        restoring = true
        defer { restoring = false }
        do {
            let out = try await ERPAPI.shared.write("restoreShopDefaults", ["seq": UUID().uuidString])
            let done = ShopDefaultsPreview(out)
            let name = done.shop["shopName"] ?? settings.shopName
            Note.show(Note(title: "Shop defaults restored", detail: (done.rates.isEmpty ? "" : "Gold rates from gold.pk. ") + "Shop details reset to \(name)’s defaults."),
                      in: $note, reduce: reduceMotion)
        } catch {
            writer.error = "Restore failed: \(error.localizedDescription)"
        }
    }
}

/// restoreShopDefaults' answer: the shop's own details it writes, and gold.pk's rates (none when gold.pk did not
/// answer, or for a house that is not gold).
struct ShopDefaultsPreview: Identifiable {
    let id = UUID()
    let shop: [String: String]
    let rates: [String: Double]
    let gold: Bool

    init(_ out: [String: Any]) {
        shop = (out["shop"] as? [String: Any] ?? [:]).compactMapValues { $0 as? String }
        rates = (out["rates"] as? [String: Any] ?? [:]).compactMapValues { ($0 as? NSNumber)?.doubleValue }
        gold = out["gold"] as? Bool ?? false
    }

    private static let shopFields: [(key: String, label: String)] = [("shopName", "Name"), ("shopAddress", "Address"), ("shopContact", "Number")]
    private static let rateFields: [(key: String, label: String)] = [
        ("goldRatePerGram24k", "24K"), ("goldRatePerGram22k", "22K"), ("goldRatePerGram21k", "21K"), ("goldRatePerGram18k", "18K"),
    ]

    /// Each change, now → after, for the confirmation.
    func summary(_ s: Settings) -> String {
        let now: [String: String] = ["shopName": s.shopName, "shopAddress": s.shopAddress, "shopContact": s.shopContact]
        var lines = Self.shopFields.compactMap { f -> String? in
            guard let next = shop[f.key] else { return nil }
            let was = now[f.key] ?? ""
            return was == next ? "\(f.label): \(next) (unchanged)" : "\(f.label): \(was.isEmpty ? "empty" : was) → \(next)"
        }
        if !rates.isEmpty {
            let r = Self.rateFields.compactMap { f in rates[f.key].map { "\(f.label) \(Money.pkr($0))" } }
            lines.append("Gold per gram from gold.pk: " + r.joined(separator: ", ") + ". The rates are stamped as set now.")
        } else if gold {
            lines.append("gold.pk did not answer: the gold rates stay as they are.")
        }
        lines.append("No orders or invoices are touched.")
        return lines.joined(separator: "\n")
    }
}
