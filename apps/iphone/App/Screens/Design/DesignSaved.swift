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
    @State private var deletingRecord: DesignRecord?
    @State private var problem: String?
    #if os(macOS)
    @State private var picked: String?
    @State private var pickedDraft: String?
    @FocusState private var macGalleryFocus: Bool
    /// The designs the gallery shows, made again only when the shelf, the folder or the search change.
    @State private var macMade = Memo<[DesignRecord]>()
    #endif

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
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    @ViewBuilder
    private var phoneBody: some View {
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
        .readableColumn(900)
        .searchable(text: $q, prompt: "Find a design")
        .refreshable { await shelf.load(); await shelf.loadDrafts() }
        .task { await shelf.load(); await shelf.loadDrafts() }
        .sheet(item: $detail) { r in
            DesignDetailSheet(record: r, shelf: shelf, onOpen: { rec in detail = nil; onOpen(rec) }, onChanged: { Task { await shelf.load() } })
                .presentationSizing(.form)
        }
        .alert(renaming == nil ? "New folder" : "Rename folder", isPresented: $asking) {
            TextField("Name", text: $folderText)
            Button(renaming == nil ? "Make folder" : "Rename") { saveFolder() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmDestructive(isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }),
                            title: "Delete the folder “\(deletingFolder?.name ?? "")”?", message: "Its designs stay, unfiled.",
                            action: "Delete folder") { if let f = deletingFolder { dropFolder(f) } }
        .confirmDestructive(isPresented: Binding(get: { deletingDraft != nil }, set: { if !$0 { deletingDraft = nil } }),
                            title: "Delete this draft from this phone?", action: "Delete draft") { if let d = deletingDraft { Task { await shelf.deleteDraft(d) } } }
        .confirmDestructive(isPresented: Binding(get: { deletingRecord != nil }, set: { if !$0 { deletingRecord = nil } }),
                            title: "Delete “\(deletingRecord?.name ?? "this design")”?", message: "It is removed from the shop’s shelf.",
                            action: "Delete") { if let d = deletingRecord { dropRecord(d) } }
        .failureAlert($problem, title: "Could not finish")
        .overlay { emptyOrFailed }
    }

    /// Nothing to show, or the shelf could not load: the system's own states over the list, never a row inside it.
    @ViewBuilder private var emptyOrFailed: some View {
        if view == Self.device {
            if shelf.draftRows.isEmpty {
                ContentUnavailableView("No drafts on this phone", systemImage: "iphone",
                                       description: Text("A design is kept here as you make it, and for 30 days after."))
            }
        } else if view == Self.account && adsOk {
            EmptyView()
        } else if let error = shelf.error {
            ErrorState(error) { Task { await shelf.load() } }
        } else if shelf.loaded && shown.isEmpty {
            ContentUnavailableView(shelf.items.isEmpty ? "Nothing saved yet" : "Nothing here", systemImage: "folder",
                                   description: Text(shelf.items.isEmpty ? "Save a design from the workspace and it waits here, in any folder you make." : "No design in this folder matches."))
        }
    }

    @ViewBuilder private var designs: some View {
        if shelf.error != nil {
            EmptyView()
        } else if !shelf.loaded {
            Section { SkeletonLoading("Opening the shelf") }.houseRows()
        } else if !shown.isEmpty {
            Section {
                ForEach(shown) { r in
                    Button { detail = r } label: { DesignRecordLine(record: r) }
                        .buttonStyle(.plain).zoomSource(id: "design:" + r.id)
                        .swipeActions { Button("Delete", role: .destructive) { deletingRecord = r } }
                        .contextMenu {
                            Button { detail = r } label: { Label("Details", systemImage: "info.circle") }
                            if r.canOpen { Button { onOpen(r) } label: { Label("Open", systemImage: "folder") } }
                            Divider()
                            Button(role: .destructive) { deletingRecord = r } label: { Label("Delete", systemImage: "trash") }
                        }
                }
            }.houseRows()
        }
    }

    @ViewBuilder private var drafts: some View {
        if !shelf.draftRows.isEmpty {
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

    private func dropRecord(_ r: DesignRecord) {
        Task {
            do { try await DesignRecords.delete(r.id); await shelf.load() }
            catch { problem = error.localizedDescription }
        }
    }

    private func dropFolder(_ f: DesignFolder) {
        Task {
            do { try await DesignRecords.deleteFolder(f.id); view = Self.all; await shelf.load() }
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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { rename(); dismiss() } } }
            .task { await loadPicture() }
            .onAppear { name = record.name; folder = record.folder ?? "" }
            .onChange(of: folder) { _, now in
                guard now != (record.folder ?? "") else { return }
                let target: String? = now.isEmpty ? nil : now
                Task { await patch(folder: .some(target), name: nil) }
            }
            .onDisappear { rename() }
            .confirmDestructive(isPresented: $confirmDelete, title: "Delete “\(record.name)”?", action: "Delete") { remove() }
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
            do { try await DesignRecords.delete(record.id); onChanged(); dismiss() }
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

#if os(macOS)
extension DesignSavedView {
    /// The shelf as a Mac gallery (Finder's icon view, docs/features/mac-design.md): the designs as pictures, the folder a pop-up
    /// in the toolbar, the search in the toolbar. Click picks, a double-click or Return opens, ⌫ deletes (it asks), right-click
    /// gives the same actions as the Design menu. The drafts on this Mac are a table.
    @ViewBuilder
    fileprivate var macBody: some View {
        macDialogs(
            macContent
                .macSummaryBar(macSummary)
                .macSearchable(text: $q, prompt: "Find a design")
                .toolbar { macToolbar }
                .macRecordMenu(macMenu)
                .navigationSubtitle(macViewTitle)
                .task { await shelf.load(); await shelf.loadDrafts() }
        )
    }

    private func macDialogs<Content: View>(_ content: Content) -> some View {
        content
            .sheet(item: $detail) { r in
                DesignDetailSheet(record: r, shelf: shelf, onOpen: { rec in detail = nil; onOpen(rec) }, onChanged: { Task { await shelf.load() } })
                    .frame(minWidth: 460, minHeight: 520)
            }
            .alert(renaming == nil ? "New folder" : "Rename folder", isPresented: $asking) {
                TextField("Name", text: $folderText)
                Button(renaming == nil ? "Make folder" : "Rename") { saveFolder() }
                Button("Cancel", role: .cancel) {}
            }
            .confirmDestructive(isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }),
                                title: "Delete the folder “\(deletingFolder?.name ?? "")”?", message: "Its designs stay, unfiled.",
                                action: "Delete folder") { if let f = deletingFolder { dropFolder(f) } }
            .confirmDestructive(isPresented: Binding(get: { deletingDraft != nil }, set: { if !$0 { deletingDraft = nil } }),
                                title: "Delete this draft from this Mac?", action: "Delete draft") { if let d = deletingDraft { Task { await shelf.deleteDraft(d) } } }
            .confirmDestructive(isPresented: Binding(get: { deletingRecord != nil }, set: { if !$0 { deletingRecord = nil } }),
                                title: "Delete “\(deletingRecord?.name ?? "this design")”?", message: "It is removed from the shop’s shelf.",
                                action: "Delete") { if let d = deletingRecord { dropRecord(d) } }
            .failureAlert($problem, title: "Could not finish")
    }

    /// What the gallery shows. `shown` walks and lowercases every design; the Mac keeps its answer until the shelf, the folder
    /// or the search change.
    private var macShown: [DesignRecord] {
        var h = Hasher()
        for i in shelf.items {
            h.combine(i.id)
            h.combine(i.name)
            h.combine(i.folder)
            h.combine(i.kind)
            h.combine(i.updated)
            h.combine(i.fields["headline"])
        }
        return macMade([h.finalize(), q.hashValue, view.hashValue]) { shown }
    }

    private var pickedRecord: DesignRecord? { picked.flatMap { id in macShown.first { $0.id == id } } }
    private var pickedDraftRow: DesignDraftRow? { pickedDraft.flatMap { id in shelf.draftRows.first { $0.id == id } } }

    private var macViewTitle: String {
        if view == Self.all { return "All Designs" }
        if view == Self.unfiled { return "Unfiled" }
        if view == Self.device { return "On This Mac" }
        if view == Self.account { return "In the Ad Account" }
        return folder?.name ?? "Designs"
    }

    private var macSummary: [String] {
        if view == Self.device { return ["\(shelf.draftRows.count) draft\(shelf.draftRows.count == 1 ? "" : "s") on this Mac"] }
        if view == Self.account { return [] }
        let n = macShown.count
        return ["\(n) design\(n == 1 ? "" : "s")", folder.map { $0.name } ?? ""]
    }

    // MARK: Actions

    private func macOpenAction(_ r: DesignRecord?) -> MacAction {
        MacAction("Open", symbol: "folder", shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: r?.canOpen ?? false, isDefault: true) {
            if let r { onOpen(r) }
        }
    }

    private func macDetailsAction(_ r: DesignRecord?) -> MacAction {
        MacAction("Details…", symbol: "info.circle", shortcut: KeyboardShortcut("i", modifiers: .command), enabled: r != nil) { detail = r }
    }

    private func macDeleteAction(_ r: DesignRecord?) -> MacAction {
        MacAction("Delete…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive, enabled: r != nil) { deletingRecord = r }
    }

    private func macOpenDraftAction(_ d: DesignDraftRow?) -> MacAction {
        MacAction("Open", symbol: "folder", shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: d != nil, isDefault: true, id: "open-draft") {
            if let d { onOpenDraft(d) }
        }
    }

    private func macDeleteDraftAction(_ d: DesignDraftRow?) -> MacAction {
        MacAction("Delete…", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive, enabled: d != nil, id: "delete-draft") {
            deletingDraft = d
        }
    }

    private var macNewFolderAction: MacAction {
        MacAction("New Folder…", symbol: "folder.badge.plus") { renaming = nil; folderText = ""; asking = true }
    }

    private var macRenameFolderAction: MacAction {
        MacAction("Rename Folder…", symbol: "pencil", enabled: folder != nil && view == folder?.id) {
            if let folder { renaming = folder; folderText = folder.name; asking = true }
        }
    }

    private var macDeleteFolderAction: MacAction {
        MacAction("Delete Folder…", symbol: "folder.badge.minus", role: .destructive, enabled: folder != nil && view == folder?.id) { deletingFolder = folder }
    }

    private var macMenu: MacRecordMenu {
        if view == Self.device {
            return MacRecordMenu(title: "Design", groups: [[macOpenDraftAction(pickedDraftRow), macDeleteDraftAction(pickedDraftRow)],
                                                            [macNewFolderAction, macRenameFolderAction, macDeleteFolderAction]])
        }
        let r = pickedRecord
        return MacRecordMenu(title: "Design", groups: [[macOpenAction(r), macDetailsAction(r)],
                                                        [macNewFolderAction, macRenameFolderAction, macDeleteFolderAction],
                                                        [macDeleteAction(r)]])
    }

    // Open (the picked design or draft) and the one menu: which folder to show, and making, renaming or deleting a folder.
    // Delete is the Design menu's and the right-click menu's, not the toolbar's.
    @ToolbarContentBuilder
    private var macToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if view == Self.device {
                MacToolbarAction(action: macOpenDraftAction(pickedDraftRow))
            } else {
                MacToolbarAction(action: macOpenAction(pickedRecord))
            }
            macFilterMenu
        }
    }

    private var macFilterMenu: some View {
        Menu {
            Picker("Show", selection: Binding<String>(get: { view }, set: { (v: String) in view = v; picked = nil; pickedDraft = nil })) {
                Text("All Designs").tag(Self.all)
                if (counts[""] ?? 0) > 0 { Text("Unfiled").tag(Self.unfiled) }
                ForEach(shelf.folders) { (f: DesignFolder) in Text(f.name).tag(f.id) }
                Text("On This Mac").tag(Self.device)
                if adsOk { Text("In the Ad Account").tag(Self.account) }
            }
            .pickerStyle(.inline)
            Divider()
            ForEach([macNewFolderAction, macRenameFolderAction, macDeleteFolderAction]) { (a: MacAction) in
                Button(a.title, role: a.role) { a.perform() }.disabled(!a.enabled)
            }
        } label: {
            Label("Filter", systemImage: view == Self.all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("Show a folder, the drafts on this Mac or the ads in the ad account; make, rename or delete a folder")
    }

    // MARK: The content

    @ViewBuilder
    private var macContent: some View {
        if view == Self.device {
            macDrafts
        } else if view == Self.account && adsOk {
            List { DesignAccountAds(folders: shelf.folders) { Task { await shelf.load() } } }
                .listStyle(.inset)
        } else if let error = shelf.error {
            ErrorState(error) { Task { await shelf.load() } }
        } else if !shelf.loaded {
            SkeletonLoading("Opening the shelf").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if macShown.isEmpty {
            ContentUnavailableView(shelf.items.isEmpty ? "Nothing saved yet" : "Nothing here", systemImage: "folder",
                                   description: Text(shelf.items.isEmpty ? "Save a design from the workspace and it waits here, in any folder you make." : "No design in this folder matches."))
        } else {
            macGallery
        }
    }

    private var macDrafts: some View {
        Table(shelf.draftRows, selection: $pickedDraft) {
            TableColumn("Name") { (d: DesignDraftRow) in
                HStack(spacing: 8) {
                    Group {
                        if let image = d.thumb { Image(uiImage: image).resizable().scaledToFill() }
                        else { Image(systemName: "photo").foregroundStyle(.secondary) }
                    }
                    .frame(width: 28, height: 28).clipShape(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous))
                    Text(d.title).lineLimit(1)
                }
            }
            .width(min: 140, ideal: 260)
            TableColumn("Kept") { (d: DesignDraftRow) in Text(ShopDate.stamp(d.updated, withTime: true)) }
                .width(min: 110, ideal: 150)
            TableColumn("From") { (d: DesignDraftRow) in Text(d.old == nil ? "This Mac" : "Earlier Post a piece draft").foregroundStyle(.secondary) }
                .width(min: 110, ideal: 170)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            let d = ids.first.flatMap { id in shelf.draftRows.first { $0.id == id } }
            MacActionItems(groups: [[macOpenDraftAction(d)], [macDeleteDraftAction(d)]])
        } primaryAction: { (ids: Set<String>) in
            if let id = ids.first, let d = shelf.draftRows.first(where: { $0.id == id }) { onOpenDraft(d) }
        }
        .onDeleteCommand { deletingDraft = pickedDraftRow }
        .overlay {
            if shelf.draftRows.isEmpty {
                ContentUnavailableView("No drafts on this Mac", systemImage: "desktopcomputer",
                                       description: Text("A design is kept here as you make it, and for 30 days after. Earlier Post a piece drafts open here as designs."))
            }
        }
    }

    private var macGallery: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 240), spacing: 16, alignment: .top)], spacing: 16) {
                ForEach(macShown) { (r: DesignRecord) in macCell(r) }
            }
            .padding(20)
        }
        .focusable()
        .focused($macGalleryFocus)
        .focusEffectDisabled()
        .onKeyPress(.return) {
            guard let r = pickedRecord else { return .ignored }
            macOpenOrDetails(r)
            return .handled
        }
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { (press: KeyPress) in macMove(press.key == .rightArrow ? 1 : -1) }
        .onDeleteCommand { deletingRecord = pickedRecord }
    }

    private func macMove(_ by: Int) -> KeyPress.Result {
        let all = macShown
        guard !all.isEmpty else { return .ignored }
        let at = all.firstIndex(where: { $0.id == picked }) ?? (by > 0 ? -1 : all.count)
        picked = all[min(all.count - 1, max(0, at + by))].id
        return .handled
    }

    private func macOpenOrDetails(_ r: DesignRecord) {
        if r.canOpen { onOpen(r) } else { detail = r }
    }

    private func macCell(_ r: DesignRecord) -> some View {
        let on = picked == r.id
        return VStack(alignment: .leading, spacing: 6) {
            Group {
                if let image = MacDesignThumbs.image(r) { Image(uiImage: image).resizable().scaledToFit() }
                else { Image(systemName: "photo").font(.title2).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity).frame(height: 150)
            .background(Theme.card)
            .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).strokeBorder(on ? Theme.accent : Color.secondary.opacity(0.18), lineWidth: on ? 2.5 : 1))
            Text(r.name).font(.subheadline.weight(.medium)).lineLimit(1)
            Text(DesignKinds.label(r.kind) + " · \(r.pages.count) size" + (r.pages.count == 1 ? "" : "s") + " · " + ShopDate.say(r.updated))
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(6)
        .contentShape(Rectangle())
        .onTapGesture { picked = r.id; macGalleryFocus = true }
        .simultaneousGesture(TapGesture(count: 2).onEnded { picked = r.id; macOpenOrDetails(r) })
        .pointerHover()
        .contextMenu {
            MacActionItems(groups: [[macOpenAction(r), macDetailsAction(r)]])
            Menu("Move to") {
                Button("Unfiled") { Task { try? await DesignRecords.patch(r.id, folder: .some(nil), name: nil); await shelf.load() } }
                ForEach(shelf.folders) { (f: DesignFolder) in
                    Button(f.name) { Task { try? await DesignRecords.patch(r.id, folder: .some(f.id), name: nil); await shelf.load() } }
                }
            }
            Divider()
            MacActionItems(groups: [[macDeleteAction(r)]])
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A saved design's picture, decoded once: the shelf keeps it as a data URL, and decoding it on every redraw of the gallery
/// (a click on a design redraws all of them) is what made picking one slow.
enum MacDesignThumbs {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(_ r: DesignRecord) -> UIImage? {
        let key = NSString(string: r.id + "|" + r.updated)
        if let hit = cache.object(forKey: key) { return hit }
        guard let made = r.thumbImage else { return nil }
        cache.setObject(made, forKey: key)
        return made
    }
}
#endif
