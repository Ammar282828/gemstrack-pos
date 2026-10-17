import SwiftUI
import UniformTypeIdentifiers
import FirebaseCore
import ERPCore

/// Settings → Backups (src/app/settings/backups/page.tsx): export, restore, and manage the shop's data.
///
/// - Export Backup: the collections the page copies, each with how many records it holds (/api/app/backup), read
///   one at a time and put together here as the page's own file (`{ exportedAt, collections, data }`), which its
///   Restore reads. The file goes to the share sheet, to be saved to Files or sent. When it was last made is this
///   phone's, as the page keeps its own per browser.
/// - Restore from Backup: a backup file picked in Files, read here and shown (its date, each collection and how many
///   records), then merged into the live records a collection's slice (400) at a time through
///   /api/app/backup/restore, which asks the delete code with every slice and keeps to the collections a backup
///   copies. Merged as the page merges: a record in the file is written over the live one; nothing is deleted.
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

    @State private var pickingBackup = false
    @State private var backupFile: RestoreFile?
    @State private var restoreCode = ""
    @State private var confirmingRestore = false
    @State private var restoreProgress: RestoreProgress?

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
        .failureAlert($failure, title: "Could not do that")
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
        }
        .fileImporter(isPresented: $pickingBackup, allowedContentTypes: [.json]) { result in
            switch result {
            case .success(let url): readBackup(url)
            case .failure(let e): failure = e.localizedDescription
            }
        }
        .confirmationDialog("Write this backup over the live records?", isPresented: $confirmingRestore, titleVisibility: .visible) {
            Button("Restore \(BackupPage.grouped(backupFile?.restorable(known).reduce(0) { $0 + $1.docs.count } ?? 0)) records", role: .destructive) {
                Task { await restore() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every record in the file replaces the same record in the books as it is now, field by field: today’s balances, payments and statuses on those records go back to the backup’s. Records added since the backup stay. This can’t be undone.")
        }
        .task { await loadList() }
        .refreshable { await loadList() }
        .onChange(of: search) { _, typed in
            if !typed.trimmingCharacters(in: .whitespaces).isEmpty { sold.need() }
        }
        // Leaving resets the search's shelf (a pushed page counts as leaving): coming back asks again.
        .onAppear { if !search.trimmingCharacters(in: .whitespaces).isEmpty { sold.need() } }
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
                    HStack { Spacer(); SkeletonLoading(); Spacer() }
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
                        if exporting { SkeletonLoading() }
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
            LedgerHeading(title: "Export backup")
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
            Motion.run(reduce: UIAccessibility.isReduceMotionEnabled) { note = OwnerNote(title: "Backup Downloaded", detail: "\(BackupPage.grouped(total)) records across \(cols.count) collections.") }
        } catch {
            failure = "Export Failed: \(error.localizedDescription)"
        }
        exporting = false
        progress = 0
    }

    // MARK: Restore from Backup

    /// The collections the ERP restores (the backup's own list); before it has answered, the file's are sent and the ERP refuses any other.
    private var known: Set<String>? { list.map { Set($0.collections.map(\.id)) } }

    private func label(_ id: String) -> String { collections.first { $0.id == id }?.label ?? id }

    private var restoreSection: some View {
        Section {
            Button { pickingBackup = true } label: {
                Label(backupFile == nil ? "Choose a backup file" : "Choose another file", systemImage: "doc.badge.arrow.down")
            }
            .disabled(restoreProgress != nil)
            if let file = backupFile {
                LabeledContent("File", value: file.name)
                LabeledContent("Exported", value: ERPDate.parse(file.exportedAt) != nil ? ShopDate.say(file.exportedAt, withTime: true) : file.exportedAt)
                ForEach(file.collections) { (c: RestoreFile.Part) in
                    let restorable = known?.contains(c.id) ?? true
                    LabeledContent {
                        Text(restorable ? BackupPage.grouped(c.docs.count) : "not restored")
                            .monospacedDigit()
                            .foregroundStyle(restorable ? Color.primary : Color.secondary)
                    } label: {
                        Text(label(c.id))
                    }
                }
                if let p = restoreProgress {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: Double(p.written), total: Double(max(p.total, 1)))
                        Text("\(label(p.collection)): slice \(p.part) of \(p.parts) · \(BackupPage.grouped(p.written)) of \(BackupPage.grouped(p.total)) records")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                } else {
                    SecureField("Delete code", text: $restoreCode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                    Button(role: .destructive) { confirmingRestore = true } label: {
                        Label("Restore \(BackupPage.grouped(file.restorable(known).reduce(0) { $0 + $1.docs.count })) records", systemImage: "arrow.counterclockwise")
                    }
                    .disabled(restoreCode.count < 4 || file.restorable(known).isEmpty)
                    Button("Clear", role: .cancel) { backupFile = nil; restoreCode = "" }
                }
            }
        } header: {
            LedgerHeading(title: "Restore from backup")
        } footer: {
            Text("A JSON backup exported here or on the ERP. Records are merged: each one in the file is written over the live one, nothing is deleted. Asks for the delete code.")
        }
    }

    private func readBackup(_ url: URL) {
        do {
            let text = try SettingsFiles.text(at: url)
            backupFile = try RestoreFile(name: url.lastPathComponent, text: text)
            restoreCode = ""
        } catch {
            backupFile = nil
            failure = error.localizedDescription
        }
    }

    /// A slice (400 records) at a time, a collection after another; a refusal stops it and says how far it got.
    private func restore() async {
        guard let file = backupFile else { return }
        let parts = file.restorable(known)
        let total = parts.reduce(0) { $0 + $1.docs.count }
        guard total > 0 else { return }
        var written = 0
        let code = restoreCode
        do {
            for c in parts {
                let ids = c.docs.keys.sorted()
                let slices = stride(from: 0, to: ids.count, by: RestoreFile.slice).map { Array(ids[$0..<min($0 + RestoreFile.slice, ids.count)]) }
                for (i, slice) in slices.enumerated() {
                    restoreProgress = RestoreProgress(collection: c.id, part: i + 1, parts: slices.count, written: written, total: total)
                    var docs: [String: Any] = [:]
                    for id in slice { docs[id] = c.docs[id] }
                    _ = try await ERPAPI.shared.send("/api/app/backup/restore", [
                        "collection": c.id, "docs": docs, "deleteCode": code,
                        "exportedAt": file.exportedAt, "part": i + 1, "parts": slices.count,
                    ], timeout: 120)
                    written += slice.count
                }
            }
            restoreProgress = nil
            backupFile = nil
            restoreCode = ""
            Motion.run(reduce: UIAccessibility.isReduceMotionEnabled) {
                note = OwnerNote(title: "Restore complete", detail: "\(BackupPage.grouped(written)) records restored.")
            }
        } catch {
            restoreProgress = nil
            if (error as? ERPAPI.Failure)?.status == 403 { restoreCode = "" }
            failure = written == 0
                ? "Restore failed: \(error.localizedDescription)"
                : "Restore stopped after \(BackupPage.grouped(written)) of \(BackupPage.grouped(total)) records: \(error.localizedDescription) Restoring the same file again is safe."
        }
        await loadList()
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
                    HStack { Spacer(); SkeletonLoading(); Spacer() }
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
                                if recovering == p.sku { SkeletonLoading() } else { Label("Re-Add", systemImage: "plus.circle") }
                            }
                            .buttonStyle(.glass)
                            .disabled(recovering != nil)
                        }
                    }
                }
            }
        } header: {
            LedgerHeading(title: "Sold product recovery")
        } footer: {
            Text("Search for a sold product by its original SKU or name to re-add it to active inventory.")
        }
    }

    private func reAdd(_ p: Product) async {
        recovering = p.sku
        do {
            let out = try await ERPAPI.shared.write("reAddSoldProduct", ["sku": p.sku])
            let sku = (out["product"] as? [String: Any])?["sku"] as? String
            Motion.run(reduce: UIAccessibility.isReduceMotionEnabled) {
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
            LedgerHeading(title: "Cloud database backups (PITR)")
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
            LedgerHeading(title: "Danger zone")
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
            Motion.run(reduce: UIAccessibility.isReduceMotionEnabled) { note = OwnerNote(title: "Success", detail: "\(gone) latest products deleted.") }
        }
    }
}

/// Where a restore has got to.
private struct RestoreProgress: Equatable {
    let collection: String
    let part: Int
    let parts: Int
    let written: Int
    let total: Int
}

/// A backup file as the page reads it: `{ exportedAt, data: { <collection>: { <id>: document } } }`.
private struct RestoreFile {
    /// The page's batch, and the most /api/app/backup/restore takes at a time.
    static let slice = 400

    struct Part: Identifiable {
        let id: String
        let docs: [String: Any]
    }

    let name: String
    let exportedAt: String
    let collections: [Part]

    struct Unreadable: LocalizedError {
        let errorDescription: String?
    }

    init(name: String, text: String) throws {
        guard let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else {
            throw Unreadable(errorDescription: "That file is not a backup: it is not JSON.")
        }
        guard let data = json["data"] as? [String: Any] else {
            throw Unreadable(errorDescription: "Invalid backup format — missing data field.")
        }
        self.name = name
        exportedAt = json["exportedAt"] as? String ?? "Unknown"
        collections = data.keys.sorted().map { Part(id: $0, docs: (data[$0] as? [String: Any] ?? [:]).filter { $0.value is [String: Any] }) }
        if collections.allSatisfy({ $0.docs.isEmpty }) {
            throw Unreadable(errorDescription: "That backup holds no records.")
        }
    }

    /// The collections that will be sent: the ones the ERP restores, with records in them.
    func restorable(_ known: Set<String>?) -> [Part] {
        collections.filter { !$0.docs.isEmpty && (known?.contains($0.id) ?? true) }
    }
}
