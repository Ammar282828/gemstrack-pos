import SwiftUI
import FirebaseCore
import ERPCore

/// Settings → Backups (src/app/settings/backups/page.tsx): export, restore, and manage the shop's data.
///
/// - Export Backup: the collections the page copies, each with how many records it holds (/api/app/backup), read
///   one at a time and put together here as the page's own file (`{ exportedAt, collections, data }`), which its
///   Restore reads. The file goes to the share sheet, to be saved to Files or sent. When it was last made is this
///   phone's, as the page keeps its own per browser.
/// - Restore from Backup stays the ERP's page: it writes every record in a file over the live books, across every
///   collection the file names, with no shared write behind it and no way back. Moved to the server it would be
///   an Admin write past the Firestore rules that bound the browser's copy, so it is opened there.
/// - Sold Product Recovery: a sold piece found by its SKU or name and re-added to stock under a new SKU
///   (/api/app/write `reAddSoldProduct`). The sold pieces are read only once a search is typed.
/// - Cloud Database Backups (PITR): Google's, opened in the Cloud Console.
/// - Danger Zone: the latest pieces deleted, behind the delete code (`deleteLatestProducts`).
struct BackupSettings: View {
    var body: some View {
        SettingsOwnersOnly(title: "Backups") { BackupPage() }
    }
}

/// /api/app/backup: one collection the backup copies.
private struct SettingsBackupCollection: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let description: String
    /// -1 when the ERP could not count it (the page's "err").
    let count: Int

    private enum K: String, CodingKey { case id, label, description, count }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        label = c.string(.label, default: "")
        description = c.string(.description, default: "")
        count = c.int(.count) ?? -1
    }
}

private struct SettingsBackupList: Decodable {
    let collections: [SettingsBackupCollection]
    let fileName: String

    private enum K: String, CodingKey { case collections, fileName }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        // A collection's id goes into the file as a key: only the ERP's own lower-case names.
        collections = c.list(.collections, of: SettingsBackupCollection.self).filter { !$0.id.isEmpty && $0.id.allSatisfy { $0 == "_" || ($0.isASCII && $0.isLowercase) } }
        fileName = c.string(.fileName, default: "backup.json")
    }
}

private struct BackupPage: View {
    @AppStorage("settings.backup.lastExport") private var lastExport = ""

    @State private var list: SettingsBackupList?
    @State private var listError: String?
    @State private var selected: Set<String> = []
    @State private var exporting = false
    @State private var progress = 0.0
    @State private var file: URL?

    @State private var sold = Shelf<Product>(Collections.soldProducts) { $0.sku.localizedStandardCompare($1.sku) == .orderedAscending }
    @State private var search = ""
    @State private var recovering: String?

    @State private var deleteCountText = "1"
    @State private var deletion: OwnerDeletion?

    @State private var note: OwnerNote?
    @State private var failure: String?

    var body: some View {
        Form { Group {
            exportSection
            restoreSection
            recoverySection
            pitrSection
            dangerSection
            }
            .houseRows()
        }
        .navigationTitle("Backups")
        .navigationBarTitleDisplayMode(.inline)
        .ownerNote($note)
        .alert("Could not do that", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
        }
        .task { await loadList() }
        .refreshable { await loadList() }
        .onChange(of: search) { _, typed in
            if !typed.trimmingCharacters(in: .whitespaces).isEmpty { sold.need() }
        }
        .onDisappear { sold.reset() }
    }

    // MARK: Export Backup

    /// "1,234", as the page's toLocaleString.
    static func grouped(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    private var collections: [SettingsBackupCollection] { list?.collections ?? [] }

    private var totalDocs: Int {
        collections.filter { selected.contains($0.id) }.reduce(0) { $0 + max(0, $1.count) }
    }

    private func loadList() async {
        do {
            let next = try await ERPAPI.shared.get("/api/app/backup", as: SettingsBackupList.self)
            // Everything is chosen to begin with, as on the page.
            if list == nil { selected = Set(next.collections.map(\.id)) }
            list = next
            listError = nil
        } catch {
            listError = error.localizedDescription
        }
    }

    private var exportSection: some View {
        Section {
            if list == nil {
                if let listError {
                    Label(listError, systemImage: "exclamationmark.icloud").foregroundStyle(.secondary)
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }
                }
            } else {
                Button(selected.count == collections.count ? "Deselect all" : "Select all") {
                    selected = selected.count == collections.count ? [] : Set(collections.map(\.id))
                }
                .disabled(exporting)
                ForEach(collections) { (c: SettingsBackupCollection) in
                    Toggle(isOn: Binding(
                        get: { selected.contains(c.id) },
                        set: { on in if on { selected.insert(c.id) } else { selected.remove(c.id) } }
                    )) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.label)
                                Text(c.description).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Text(c.count < 0 ? "err" : BackupPage.grouped(c.count))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(exporting)
                }
                if exporting { ProgressView(value: progress) }
                Button { Task { await export() } } label: {
                    HStack(spacing: 8) {
                        if exporting { ProgressView() }
                        Label(exporting ? "Exporting… \(Int(progress * 100))%" : "Download Backup", systemImage: "doc.badge.arrow.up")
                    }
                }
                .disabled(exporting || selected.isEmpty)
                if let file {
                    ShareLink(item: file) {
                        Label("Save or send \(file.lastPathComponent)", systemImage: "square.and.arrow.up")
                    }
                }
            }
        } header: {
            Text("Export Backup")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text("Download all your data as a JSON file you can store locally or import later.")
                if list != nil { Text("\(BackupPage.grouped(totalDocs)) records selected") }
                if !lastExport.isEmpty { Text("Last export: \(ShopDate.say(lastExport, withTime: true))") }
            }
        }
    }

    /// The page's file, a collection at a time: `{ "exportedAt": …, "collections": […], "data": { <id>: { … } } }`.
    private func export() async {
        guard let list, !selected.isEmpty else {
            failure = "Select at least one collection."
            return
        }
        let cols = list.collections.map(\.id).filter { selected.contains($0) }
        exporting = true
        progress = 0
        file = nil
        do {
            let now = ERPDate.iso(Date())
            var out = Data("{\"exportedAt\":\"\(now)\",\"collections\":".utf8)
            out.append(try JSONSerialization.data(withJSONObject: cols))
            out.append(Data(",\"data\":{".utf8))
            for (i, c) in cols.enumerated() {
                let docs = try await ERPAPI.shared.data("/api/app/backup?collection=\(c)", timeout: 300)
                guard docs.first == UInt8(ascii: "{") else { throw ERPAPI.Failure(status: 0, message: "The ERP sent something that is not \(c).") }
                if i > 0 { out.append(Data(",".utf8)) }
                out.append(Data("\"\(c)\":".utf8))
                out.append(docs)
                progress = Double(i + 1) / Double(cols.count)
            }
            out.append(Data("}}".utf8))
            file = try SettingsFiles.save(out, named: list.fileName)
            lastExport = now
            let total = list.collections.filter { selected.contains($0.id) }.reduce(0) { $0 + max(0, $1.count) }
            withAnimation { note = OwnerNote(title: "Backup Downloaded", detail: "\(BackupPage.grouped(total)) records across \(cols.count) collections.") }
        } catch {
            failure = "Export Failed: \(error.localizedDescription)"
        }
        exporting = false
        progress = 0
    }

    // MARK: Restore from Backup

    private var restoreSection: some View {
        Section {
            NavigationLink(value: Route(path: "/settings/backups?web=1")) {
                Label("Restore from Backup in the ERP", systemImage: "arrow.counterclockwise")
            }
        } header: {
            Text("Restore from Backup")
        } footer: {
            Text("Upload a previously exported JSON backup. Documents are merged — existing records are updated, nothing is deleted. It writes over the live books, so it is done on the ERP’s own page.")
        }
    }

    // MARK: Sold Product Recovery

    private var soldHits: [Product] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(sold.items.lazy.filter { $0.sku.lowercased().contains(q) || $0.name.lowercased().contains(q) }.prefix(50))
    }

    private var recoverySection: some View {
        Section {
            TextField("Search SKU or name of a sold item…", text: $search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !search.trimmingCharacters(in: .whitespaces).isEmpty {
                if !sold.loaded {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if let error = sold.error, sold.items.isEmpty {
                    Label(error, systemImage: "exclamationmark.icloud").foregroundStyle(.secondary)
                } else if soldHits.isEmpty {
                    Text("No sold products found matching your search.").foregroundStyle(.secondary)
                } else {
                    ForEach(soldHits) { (p: Product) in
                        HStack(spacing: 12) {
                            TwoLine(title: p.name, subtitle: p.sku)
                            Button {
                                Task { await reAdd(p) }
                            } label: {
                                if recovering == p.sku { ProgressView() } else { Label("Re-Add", systemImage: "plus.circle") }
                            }
                            .buttonStyle(.glass)
                            .disabled(recovering != nil)
                        }
                    }
                }
            }
        } header: {
            Text("Sold Product Recovery")
        } footer: {
            Text("Search for a sold product by its original SKU or name to re-add it to active inventory.")
        }
    }

    private func reAdd(_ p: Product) async {
        recovering = p.sku
        do {
            let out = try await ERPAPI.shared.write("reAddSoldProduct", ["sku": p.sku])
            let sku = (out["product"] as? [String: Any])?["sku"] as? String
            withAnimation {
                note = OwnerNote(title: "Product Restored", detail: "\(p.name) has been re-added to inventory with a new SKU\(sku.map { " (\($0))" } ?? "").")
            }
        } catch {
            failure = "Failed to restore product: \(error.localizedDescription)"
        }
        recovering = nil
    }

    // MARK: Cloud Database Backups (PITR)

    private var pitrSection: some View {
        Section {
            Text("PITR must be enabled in your Firebase project. Restoration overwrites your current data — consult a developer before using it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let url = consoleURL {
                Link(destination: url) { Label("Open Firestore Console", systemImage: "arrow.up.right.square") }
            }
        } header: {
            Text("Cloud Database Backups (PITR)")
        } footer: {
            Text("Firestore’s Point-in-Time Recovery lets you restore to any minute in the last 7 days via the Google Cloud Console. Managed by Google Cloud.")
        }
    }

    private var consoleURL: URL? {
        let project = House.firebaseOptions?.projectID ?? ""
        return project.isEmpty
            ? URL(string: "https://console.cloud.google.com/")
            : URL(string: "https://console.cloud.google.com/firestore/databases/-default-/pitr?project=\(project)")
    }

    // MARK: Danger Zone

    private var deleteCount: Int { Int(deleteCountText.filter(\.isNumber)) ?? 0 }

    private var dangerSection: some View {
        Section {
            LabeledContent("Delete the latest N pieces (by highest SKU)") {
                TextField("1", text: $deleteCountText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 80)
            }
            Button(role: .destructive) { askToDelete() } label: {
                Label("Delete \(max(deleteCount, 1)) Product\(max(deleteCount, 1) == 1 ? "" : "s")", systemImage: "trash")
            }
            .disabled(deleteCount <= 0)
        } header: {
            Text("Danger Zone").foregroundStyle(.red)
        } footer: {
            Text("Destructive actions that cannot be undone.")
        }
    }

    private func askToDelete() {
        let count = deleteCount
        guard count > 0 else {
            failure = "Please enter a positive number."
            return
        }
        deletion = OwnerDeletion(
            what: "Delete the latest \(count) products",
            detail: "This will permanently delete the \(count) most recently added products."
        ) { code in
            let out = try await ERPAPI.shared.write("deleteLatestProducts", ["count": count, "deleteCode": code])
            let gone = out["deleted"] as? Int ?? 0
            withAnimation { note = OwnerNote(title: "Success", detail: "\(gone) latest products deleted.") }
        }
    }
}
