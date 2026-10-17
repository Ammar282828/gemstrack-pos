import SwiftUI
import Observation

/// A device draft as a row: this screen's own, or an earlier native Post a piece draft that opens as a design.
struct DesignDraftRow: Identifiable {
    let id: String
    let title: String
    let updated: Date
    let thumb: UIImage?
    /// Set for an earlier Post a piece draft.
    let old: NativePostDraft?
}

/// What the Saved shelf and the start screen read: the shop's designs (with the legacy saved ads through, for owner and marketing,
/// as the API sends them), their folders, and this phone's drafts.
@MainActor
@Observable
final class DesignShelf {
    var items: [DesignRecord] = []
    var folders: [DesignFolder] = []
    var loaded = false
    var error: String?
    var draftRows: [DesignDraftRow] = []
    @ObservationIgnored private let disk = DesignDraftDisk.current()

    func load() async {
        if House.isDemo { loaded = true; return }
        do {
            let r = try await DesignRecords.list()
            items = r.items
            folders = r.folders
            error = nil
        } catch {
            if !loaded { self.error = error.localizedDescription }
        }
        loaded = true
    }

    func loadDrafts() async {
        var rows: [DesignDraftRow] = []
        for d in (try? await disk.list()) ?? [] {
            rows.append(DesignDraftRow(id: d.id, title: d.title.isEmpty ? "Untitled design" : d.title, updated: d.updated, thumb: d.thumb.flatMap { UIImage(data: $0) }, old: nil))
        }
        let older = (try? await NativePostDisk(scope: DesignDraftDisk.scope()).list()) ?? []
        for o in older where !o.photos.isEmpty || !o.words.s("headline").isEmpty {
            rows.append(DesignDraftRow(id: o.id, title: o.title, updated: o.updated, thumb: o.photos.first.flatMap { WebsitePhoto.thumbnail($0.data, maxPixel: 120) }, old: o))
        }
        draftRows = rows.sorted { $0.updated > $1.updated }
    }

    func deleteDraft(_ row: DesignDraftRow) async {
        if row.old != nil { try? await NativePostDisk(scope: DesignDraftDisk.scope()).remove(row.id) }
        else { await disk.remove(row.id) }
        await loadDrafts()
    }

    func folderName(_ id: String?) -> String? { folders.first { $0.id == id }?.name }
}

// MARK: The shelf (saved-shelf.tsx)

struct DesignSavedView: View {
    let shelf: DesignShelf
    let onOpen: (DesignRecord) -> Void
    let onOpenDraft: (DesignDraftRow) -> Void
    /// Owner and marketing: the ads already in the ad account can be kept in a folder.
    var adsOk = false

    private static let all = "__all", unfiled = "__unfiled", device = "__device", account = "__account"
    @State private var view = DesignSavedView.all
    @State private var q = ""
    @State private var detail: DesignRecord?
    @State private var asking = false
    @State private var renaming: DesignFolder?
    @State private var folderText = ""
    @State private var deletingFolder: DesignFolder?
    @State private var deletingDraft: DesignDraftRow?
    @State private var problem: String?
    @State private var tick = 0

    private var counts: [String: Int] {
        var c: [String: Int] = [:]
        for i in shelf.items { c[i.folder ?? "", default: 0] += 1 }
        return c
    }
    private var shown: [DesignRecord] {
        let words = q.lowercased().split(separator: " ").map(String.init)
        return shelf.items.filter { i in
            let inView = view == Self.all || (view == Self.unfiled ? i.folder == nil : i.folder == view)
            let hay = "\(i.name) \(i.fields["headline"] ?? "") \(i.kind)".lowercased()
            return inView && words.allSatisfy { hay.contains($0) }
        }
    }
    private var folder: DesignFolder? { shelf.folders.first { $0.id == view } }

    var body: some View {
        List {
            Section {
                ChipRow {
                    FilterChip(title: "All", count: shelf.items.count, chosen: view == Self.all) { view = Self.all }
                    if (counts[""] ?? 0) > 0 { FilterChip(title: "Unfiled", count: counts[""], chosen: view == Self.unfiled) { view = Self.unfiled } }
                    ForEach(shelf.folders) { f in FilterChip(title: f.name, count: counts[f.id] ?? 0, chosen: view == f.id) { view = f.id } }
                    FilterChip(title: "On this phone", count: shelf.draftRows.count, chosen: view == Self.device) { view = Self.device }
                    if adsOk { FilterChip(title: "In the ad account", chosen: view == Self.account) { view = Self.account } }
                    FilterChip(title: "New folder", chosen: false) { renaming = nil; folderText = ""; asking = true }
                }
                .chipRowInList()
            }
            if let folder, view == folder.id {
                Section {
                    Button("Rename folder") { renaming = folder; folderText = folder.name; asking = true }
                    Button("Delete folder", role: .destructive) { deletingFolder = folder }
                }.houseRows()
            }
            if view == Self.device { drafts }
            else if view == Self.account && adsOk { DesignAccountAds(folders: shelf.folders) { Task { await shelf.load() } } }
            else { designs }
        }
        .listStyle(.insetGrouped).modifier(HouseGround())
        .searchable(text: $q, prompt: "Find a design")
        .refreshable { await shelf.load(); await shelf.loadDrafts() }
        .task { await shelf.load(); await shelf.loadDrafts() }
        .sheet(item: $detail) { r in
            DesignDetailSheet(record: r, shelf: shelf, onOpen: { rec in detail = nil; onOpen(rec) }, onChanged: { Task { await shelf.load() } })
        }
        .alert(renaming == nil ? "New folder" : "Rename folder", isPresented: $asking) {
            TextField("Name", text: $folderText)
            Button(renaming == nil ? "Make folder" : "Rename") { saveFolder() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete the folder “\(deletingFolder?.name ?? "")”? Its designs stay, unfiled.",
                            isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }), titleVisibility: .visible) {
            Button("Delete folder", role: .destructive) { if let f = deletingFolder { dropFolder(f) } }
        }
        .confirmationDialog("Delete this draft from this phone?",
                            isPresented: Binding(get: { deletingDraft != nil }, set: { if !$0 { deletingDraft = nil } }), titleVisibility: .visible) {
            Button("Delete draft", role: .destructive) { if let d = deletingDraft { tick += 1; Task { await shelf.deleteDraft(d) } } }
        }
        .destructiveFeedback(trigger: tick)
        .failureAlert($problem, title: "Could not finish")
    }

    @ViewBuilder private var designs: some View {
        if let error = shelf.error {
            Section { Text(error).foregroundStyle(Tone.problem.color) }.houseRows()
        } else if !shelf.loaded {
            Section { SkeletonLoading("Opening the shelf") }.houseRows()
        } else if shown.isEmpty {
            Section {
                ContentUnavailableView(shelf.items.isEmpty ? "Nothing saved yet" : "Nothing here", systemImage: "folder",
                                       description: Text(shelf.items.isEmpty ? "Save a design from the workspace and it waits here, in any folder you make." : "No design in this folder matches."))
            }.listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(shown) { r in
                    Button { detail = r } label: { DesignRecordLine(record: r) }
                        .buttonStyle(.plain).zoomSource(id: "design:" + r.id)
                }
            }.houseRows()
        }
    }

    @ViewBuilder private var drafts: some View {
        if shelf.draftRows.isEmpty {
            Section {
                ContentUnavailableView("No drafts on this phone", systemImage: "iphone",
                                       description: Text("A design is kept here as you make it, and for 30 days after."))
            }.listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(shelf.draftRows) { d in
                    Button { onOpenDraft(d) } label: { DesignDraftLine(row: d) }.buttonStyle(.plain)
                        .swipeActions { Button("Delete", role: .destructive) { deletingDraft = d } }
                }
            } footer: { Text("Earlier Post a piece drafts open here as designs.") }.houseRows()
        }
    }

    private func saveFolder() {
        let name = folderText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        Task {
            do {
                if let renaming { try await DesignRecords.renameFolder(renaming.id, name) }
                else { let made = try await DesignRecords.createFolder(name); view = made.id }
                await shelf.load()
            } catch { problem = error.localizedDescription }
        }
    }

    private func dropFolder(_ f: DesignFolder) {
        Task {
            do { try await DesignRecords.deleteFolder(f.id); view = Self.all; tick += 1; await shelf.load() }
            catch { problem = error.localizedDescription }
        }
    }
}

// MARK: One design (saved-shelf.tsx DesignDialog)

struct DesignDetailSheet: View {
    let record: DesignRecord
    let shelf: DesignShelf
    let onOpen: (DesignRecord) -> Void
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picture: UIImage?
    @State private var pictureData: Data?
    @State private var name = ""
    @State private var folder = ""
    @State private var problem: String?
    @State private var confirmDelete = false
    @State private var share: MarketingFileShare?
    @State private var busy: String?
    @State private var tick = 0

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Group {
                        if let picture { Image(uiImage: picture).resizable().scaledToFit() }
                        else if let thumb = record.thumbImage { Image(uiImage: thumb).resizable().scaledToFit().opacity(0.7) }
                        else { SkeletonLoading("Opening the picture") }
                    }
                    .frame(maxWidth: .infinity, minHeight: 160, maxHeight: 360)
                    TextField("Name", text: $name).submitLabel(.done).onSubmit { rename() }
                    Text(DesignKinds.label(record.kind) + " · " + record.pages.map(\.label).joined(separator: ", ") + (record.scope == "ads" ? " · ads" : ""))
                        .font(.footnote).foregroundStyle(.secondary)
                    Picker("Folder", selection: $folder) {
                        Text("Unfiled").tag("")
                        ForEach(shelf.folders) { Text($0.name).tag($0.id) }
                    }
                }.houseRows()
                Section {
                    if record.canOpen { Button { dismiss(); onOpen(record) } label: { Label("Open", systemImage: "folder") } }
                    Button { Task { await sharePicture() } } label: { Label("Share the picture", systemImage: "square.and.arrow.up") }.disabled(pictureData == nil)
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                } footer: {
                    if record.isLegacy { Text("A saved ad from the earlier Studio. Saving it from the workspace keeps a design in its place.") }
                }.houseRows()
            }
            .houseForm()
            .navigationTitle(record.name).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task { await loadPicture() }
            .onAppear { name = record.name; folder = record.folder ?? "" }
            .onChange(of: folder) { _, now in
                guard now != (record.folder ?? "") else { return }
                let target: String? = now.isEmpty ? nil : now
                Task { await patch(folder: .some(target), name: nil) }
            }
            .onDisappear { rename() }
            .confirmationDialog("Delete “\(record.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { remove() }
            }
            .destructiveFeedback(trigger: tick)
            .failureAlert($problem, title: "Could not finish")
            .websiteBusy(busy)
            .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
        }
    }

    private func loadPicture() async {
        guard let data = try? await DesignRecords.file(record.id, "image:" + record.master), let image = UIImage(data: data) else { return }
        pictureData = data
        picture = image
    }

    private func rename() {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean != record.name else { return }
        Task { await patch(folder: nil, name: clean) }
    }

    private func patch(folder: String??, name: String?) async {
        do { try await DesignRecords.patch(record.id, folder: folder, name: name); onChanged() }
        catch { problem = error.localizedDescription }
    }

    private func remove() {
        busy = "Deleting…"
        Task {
            defer { busy = nil }
            do { try await DesignRecords.delete(record.id); tick += 1; onChanged(); dismiss() }
            catch { problem = error.localizedDescription }
        }
    }

    private func sharePicture() async {
        guard let data = pictureData else { return }
        let safe = record.name.replacingOccurrences(of: "[^A-Za-z0-9 _-]+", with: "", options: .regularExpression)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent((safe.isEmpty ? "design" : safe) + ".jpg")
        do { try data.write(to: url); share = MarketingFileShare(items: [url]) } catch { problem = error.localizedDescription }
    }
}
