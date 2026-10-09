import SwiftUI
import PhotosUI
import UIKit
import ERPCore

/// Website → Add photos (src/app/website/photos/page.tsx): choose the collection once, then add the tray's
/// photographs from Photos or the camera, and send them. Each goes on its own to the same route the web page
/// uses (/api/website/photos), which relays it to the site with the site's secret and turns HEIC into JPEG on
/// the way, so one bad file never stops the rest and a failure is sent again without redoing the batch.
/// A photograph is public as soon as it arrives (the site reads its drop folder on every load), so Send says
/// where they go first.
///
/// The Maisons (taheri.shop): each photograph asks for its house and the model's official name, and the ERP
/// names the files (/api/website/photos/names), as the site reads them back. Retouch is the web's (the AI
/// route's `retouch`), with the original kept to put back and the "same piece?" check shown.
struct WebsitePhotosScreen: View {
    @Environment(Session.self) private var session
    private var site: WebsiteStore { WebsiteStore.shared }

    @State private var collections: [WebsiteCollection]?
    @State private var configured = true
    @State private var denied = false
    @State private var problem: String?
    @State private var folder = ""
    /// How the chosen collection names its photographs; nil while it is asked, or when it could not be.
    @State private var maison: WebsiteMaisonAnswer?
    @State private var maisonUnknown = false
    @State private var items: [WebsitePhotoItem] = []
    @State private var lastHouse = ""
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var choosing = false
    @State private var confirmingSend = false
    @State private var sending = false
    @State private var reading = false
    @State private var said: String?
    @State private var failure: String?

    private static let folderKey = "erp.website.photoFolder"
    /// The photos route's own limit (25 MB).
    private static let maxBytes = 25 * 1024 * 1024

    var body: some View {
        Group {
            if denied {
                ContentUnavailableView("This account can't add photographs", systemImage: "lock",
                                       description: Text("Only owner, staff and marketing accounts can write to the website."))
            } else if let problem, collections == nil {
                ContentUnavailableView {
                    Label("Couldn't read the collections", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Try again") { Task { await load() } }.buttonStyle(.glass)
                }
            } else if collections == nil {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                page
            }
        }
        .navigationTitle("Add photos")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await site.loadSettings()
            if collections == nil { await load() }
        }
        .onChange(of: folder) { _, now in
            UserDefaults.standard.set(now, forKey: WebsitePhotosScreen.folderKey)
            Task { await checkMaison() }
        }
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: 24, matching: .images, preferredItemEncoding: .current)
        .onChange(of: picked) { _, now in
            guard !now.isEmpty else { return }
            let chosen = now
            picked = []
            Task { await add(chosen) }
        }
        .fullScreenCover(isPresented: $camera) {
            NewOrderCamera { (image: UIImage?) in
                camera = false
                if let image { Task { await take(image) } }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $choosing) {
            WebsiteCollectionSheet(collections: collections ?? [], folder: $folder)
        }
        .confirmationDialog("Put them on \(site.siteName)?", isPresented: $confirmingSend, titleVisibility: .visible) {
            Button("Send \(pending.count) to the website") { Task { await sendAll() } }
        } message: {
            Text(sendWords)
        }
        .alert("Not done", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    // MARK: The page

    private var chosen: WebsiteCollection? { collections?.first { (c: WebsiteCollection) in c.folder == folder } }
    private var isMaison: Bool { maison?.maison ?? false }
    private var pending: [WebsitePhotoItem] { items.filter { (i: WebsitePhotoItem) in i.status == .queued || i.status == .failed } }
    private var done: [WebsitePhotoItem] { items.filter { (i: WebsitePhotoItem) in i.status == .done } }
    private var failedCount: Int { items.filter { (i: WebsitePhotoItem) in i.status == .failed }.count }
    private var unnamed: Int {
        guard isMaison else { return 0 }
        return pending.filter { (i: WebsitePhotoItem) in i.house.isEmpty || i.model.trimmingCharacters(in: .whitespaces).isEmpty }.count
    }
    private var retouching: Bool { items.contains { (i: WebsitePhotoItem) in i.retouching } }
    private var canSend: Bool {
        !folder.isEmpty && configured && !pending.isEmpty && unnamed == 0 && !retouching && !sending && !reading && !maisonUnknown && maison != nil
    }

    private var page: some View {
        List {
            Group {
                if !configured {
                    Section {
                        Label("Uploads are not switched on yet: the website's upload secret isn't set on this ERP. Until it is, nothing below can be sent.", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
                collectionSection
                addSection
                if !items.isEmpty { photosSection }
                if !items.isEmpty { sendSection }
                if !done.isEmpty { WebsiteSetOfTheDay(withNote: false) }
                if !done.isEmpty { afterSection }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private var collectionSection: some View {
        Section {
            Button { choosing = true } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(chosen.map { (c: WebsiteCollection) in "\(c.category) → \(c.collection)" } ?? "Choose where these photographs go…")
                            .foregroundStyle(chosen == nil ? Color.secondary : Color.primary)
                        if let c = chosen {
                            Text(c.count > 0 ? "It has \(c.count) pieces today" : "Nothing in it yet").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down").foregroundStyle(.secondary)
                }
            }
            .disabled(sending)
        } header: {
            Text("Collection")
        } footer: {
            if isMaison {
                Text("The houses' own pieces. Give each photograph its house and the model's official name, exactly as the house names it (“LOVE Bracelet, Classic”). The site shows it under its house, in 18k, with no gold-rate price. Several photographs of one piece: give them the same name.")
            } else if maisonUnknown {
                Text("Couldn't check how this collection names its photographs. Pull to try again before sending.")
            } else {
                Text("They appear on \(site.siteName) as soon as they arrive: no rebuild.")
            }
        }
    }

    private var addSection: some View {
        Section {
            Button { picking = true } label: { Label("Choose photographs", systemImage: "photo.on.rectangle") }
                .disabled(folder.isEmpty || sending)
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { camera = true } label: { Label("Take a photo", systemImage: "camera") }
                    .disabled(folder.isEmpty || sending)
            }
            if reading { MarketingReading(text: "Reading the photographs…") }
        } footer: {
            Text(folder.isEmpty ? "Choose a collection first." : "JPEG, PNG, WebP or HEIC · up to 25 MB each · add as many as you like.")
        }
    }

    private var photosSection: some View {
        Section {
            ForEach(items) { (item: WebsitePhotoItem) in
                row(item)
                    .swipeActions {
                        if item.status != .uploading && !sending && !item.retouching {
                            Button(role: .destructive) { remove(item.id) } label: { Label("Remove", systemImage: "trash") }
                        }
                    }
            }
        } header: {
            Text("Photographs · \(items.count)")
        } footer: {
            if failedCount > 0 && !sending { Text("Send again to retry the ones that failed.") }
        }
    }

    private func row(_ item: WebsitePhotoItem) -> some View {
        let editable = (item.status == .queued || item.status == .failed) && !sending
        return HStack(alignment: .top, spacing: 12) {
            picture(item)
            VStack(alignment: .leading, spacing: 6) {
                Text(displayName(item)).lineLimit(2)
                statusLine(item)
                if isMaison && editable {
                    Picker("House", selection: houseBinding(item.id)) {
                        Text("House…").tag("")
                        ForEach(maison?.houses ?? [], id: \.self) { (h: String) in Text(h).tag(h) }
                    }
                    .pickerStyle(.menu)
                    TextField("Official name, e.g. LOVE Bracelet, Classic", text: modelBinding(item.id))
                        .textInputAutocapitalization(.words)
                        .font(.subheadline)
                }
                if let check = item.check, !check.passes {
                    Label(check.differences.first ?? "Not checked: compare it with the original.", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                if editable && !item.retouching {
                    HStack(spacing: 14) {
                        Button { Task { await retouch(item.id) } } label: {
                            Label(item.original == nil ? "Retouch" : "Retouch again", systemImage: "wand.and.stars")
                        }
                        if item.original != nil {
                            Button { undoRetouch(item.id) } label: { Label("Original", systemImage: "arrow.uturn.backward") }
                        }
                    }
                    .font(.subheadline)
                    .buttonStyle(.borderless)
                }
                if item.status == .done, let rel = item.rel, !rel.isEmpty {
                    WebsiteFeatureButton(key: rel, name: item.stem)
                        .font(.subheadline)
                        .buttonStyle(.borderless)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func picture(_ item: WebsitePhotoItem) -> some View {
        ZStack {
            Rectangle().fill(.quaternary)
            if let thumb = item.thumb {
                Image(uiImage: thumb).resizable().scaledToFill()
            } else {
                Image(systemName: "photo").foregroundStyle(.secondary)
            }
            if item.status == .uploading || item.retouching {
                Rectangle().fill(Color.black.opacity(0.45))
                ProgressView().tint(.white)
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(.rect(cornerRadius: 12))
        .opacity(item.status == .done ? 0.7 : 1)
    }

    @ViewBuilder
    private func statusLine(_ item: WebsitePhotoItem) -> some View {
        switch item.status {
        case .done:
            Label("On the website", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(.green)
        case .failed:
            Label(item.error ?? "Failed", systemImage: "xmark.circle.fill").font(.caption).foregroundStyle(.red)
        case .uploading:
            Text("Sending…").font(.caption).foregroundStyle(.secondary)
        case .queued:
            Text(item.retouching ? "Retouching… about a minute" : WebsitePhoto.size(item.data.count))
                .font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
    }

    private func displayName(_ item: WebsitePhotoItem) -> String {
        if isMaison, !item.house.isEmpty, !item.model.trimmingCharacters(in: .whitespaces).isEmpty {
            return "\(item.house) — \(item.model.trimmingCharacters(in: .whitespaces))"
        }
        return item.stem + "." + item.kind.ext
    }

    private var sendSection: some View {
        Section {
            Button { confirmingSend = true } label: {
                Label(sending ? "Sending…" : "Send \(pending.count) to the website", systemImage: "arrow.up.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .disabled(!canSend)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if !done.isEmpty && !sending {
                Button("Clear \(done.count) sent") { items.removeAll { (i: WebsitePhotoItem) in i.status == .done } }
            }
        } footer: {
            if unnamed > 0 {
                Text("\(unnamed) still need\(unnamed == 1 ? "s" : "") a house and a name.").foregroundStyle(.orange)
            } else if let said {
                Text(said)
            }
        }
    }

    @ViewBuilder
    private var afterSection: some View {
        Section {
            if MarketingKit.has("/website/weights", role: session.role) {
                MarketingLink(title: "Record their weights", subtitle: "Photo weights: the weight the site draws on each", symbol: "scalemass", path: "/website/weights")
            }
            if let url = collectionURL {
                Link(destination: url) {
                    Label("See \(chosen?.collection ?? "the collection") on the website", systemImage: "safari")
                }
            }
        }
    }

    /// The collection's page on the site (the web's own guess when the site doesn't say).
    private var collectionURL: URL? {
        guard let c = chosen, let base = site.settings?.site, !base.isEmpty else { return nil }
        let slug = c.collection.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        return URL(string: base + (c.path ?? "/" + slug))
    }

    /// Where the photographs go, said before anything is sent: they are public the moment they arrive.
    private var sendWords: String {
        let shelf = chosen.map { (c: WebsiteCollection) in "\(c.category) → \(c.collection)" } ?? folder
        let n = pending.count
        let retouched = pending.filter { (i: WebsitePhotoItem) in i.original != nil }.count
        let ai = retouched > 0 ? "\n\n\(retouched) of them retouched by the AI: check \(retouched == 1 ? "it" : "them") against the originals." : ""
        return "\(n) photograph\(n == 1 ? "" : "s") go\(n == 1 ? "es" : "") to \(site.siteName), into \(shelf), and \(n == 1 ? "is" : "are") public at once: anyone who opens the site sees \(n == 1 ? "it" : "them").\(ai)"
    }

    // MARK: Bindings into the tray

    private func houseBinding(_ id: UUID) -> Binding<String> {
        Binding(get: { items.first { (i: WebsitePhotoItem) in i.id == id }?.house ?? "" },
                set: { (v: String) in
                    if let k = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) { items[k].house = v }
                    if !v.isEmpty { lastHouse = v }
                })
    }

    private func modelBinding(_ id: UUID) -> Binding<String> {
        Binding(get: { items.first { (i: WebsitePhotoItem) in i.id == id }?.model ?? "" },
                set: { (v: String) in if let k = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) { items[k].model = String(v.prefix(160)) } })
    }

    // MARK: Reading

    private func load() async {
        do {
            let a = try await ERPAPI.shared.get("/api/website/photos", as: WebsiteCollectionsAnswer.self)
            collections = a.collections
            configured = a.configured
            problem = nil
            // A counter session is usually one tray: the last collection again.
            if folder.isEmpty, let last = UserDefaults.standard.string(forKey: WebsitePhotosScreen.folderKey),
               a.collections.contains(where: { (c: WebsiteCollection) in c.folder == last }) {
                folder = last
            } else if !folder.isEmpty {
                await checkMaison()
            }
        } catch let f as ERPAPI.Failure where f.status == 401 || f.status == 403 {
            denied = true
        } catch {
            problem = error.localizedDescription
        }
    }

    private func checkMaison() async {
        maison = nil
        maisonUnknown = false
        guard !folder.isEmpty else { return }
        let asked = folder
        do {
            let a = try await ERPAPI.shared.get("/api/website/photos/names?folder=\(WebsiteNumber.query(asked))", as: WebsiteMaisonAnswer.self)
            if folder == asked { maison = a }
        } catch {
            // Never send a Maisons tray under the camera's names: until it is known, Send waits.
            if folder == asked { maisonUnknown = true }
        }
    }

    // MARK: Adding

    private func add(_ chosen: [PhotosPickerItem]) async {
        reading = true
        defer { reading = false }
        var skipped = 0
        var tooBig = 0
        for p in chosen {
            guard let raw = try? await p.loadTransferable(type: Data.self) else { skipped += 1; continue }
            let ready = await Task.detached(priority: .userInitiated) { () -> (Data, WebsitePhoto.Kind, UIImage?)? in
                guard let r = WebsitePhoto.prepared(raw) else { return nil }
                return (r.data, r.kind, WebsitePhoto.thumbnail(r.data, maxPixel: 240))
            }.value
            guard let ready else { skipped += 1; continue }
            if ready.0.count > WebsitePhotosScreen.maxBytes { tooBig += 1; continue }
            items.append(WebsitePhotoItem(data: ready.0, kind: ready.1, thumb: ready.2, stem: nextStem(), house: lastHouse))
        }
        if skipped + tooBig > 0 {
            var why: [String] = []
            if skipped > 0 { why.append("\(skipped) couldn't be read: only JPEG, PNG, WebP and HEIC photographs can go on the website") }
            if tooBig > 0 { why.append("\(tooBig) \(tooBig == 1 ? "is" : "are") over 25 MB") }
            failure = "Skipped \(skipped + tooBig). " + why.joined(separator: "; ") + "."
        }
    }

    private func take(_ image: UIImage) async {
        reading = true
        defer { reading = false }
        let ready = await Task.detached(priority: .userInitiated) { () -> (Data, UIImage?)? in
            guard let jpeg = WebsitePhoto.jpeg(image, longestEdge: 4032, quality: 0.92) else { return nil }
            return (jpeg, WebsitePhoto.thumbnail(jpeg, maxPixel: 240))
        }.value
        guard let ready else { failure = "Couldn't use that photo."; return }
        items.append(WebsitePhotoItem(data: ready.0, kind: WebsitePhoto.Kind(ext: "jpg", mime: "image/jpeg"), thumb: ready.1, stem: nextStem(), house: lastHouse))
    }

    /// A name for a photo from Photos, which hands over none: when it was added, and a count, so a tray never
    /// sends two under one name.
    private func nextStem() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "yyyyMMdd-HHmmss"
        let tag = String(UUID().uuidString.prefix(4)).lowercased()
        return "IMG-\(f.string(from: Date()))-\(items.count + 1)\(tag)"
    }

    private func remove(_ id: UUID) {
        items.removeAll { (i: WebsitePhotoItem) in i.id == id }
    }

    // MARK: Retouch (the AI route's own, as the web page calls it)

    private func retouch(_ id: UUID) async {
        guard let k = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) else { return }
        items[k].retouching = true
        let source = items[k].data
        func finish(_ change: (inout WebsitePhotoItem) -> Void) {
            if let j = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) { change(&items[j]) }
        }
        do {
            // The AI reads JPEG and PNG; the phone makes the JPEG (HEIC included) as the web asks the converter to.
            let jpeg = await Task.detached(priority: .userInitiated) { WebsitePhoto.jpegCopy(source, longestEdge: 3000) }.value
            guard let jpeg else { throw ERPAPI.Failure(status: 0, message: "This photo couldn't be read.") }
            let r = try await WebsiteForm.json("/api/website/post/ai", fields: [("op", "retouch"), ("params", "{}")],
                                               files: [WebsiteForm.File(field: "image", name: "photo.jpg", type: "image/jpeg", data: jpeg)],
                                               timeout: 310, as: WebsiteRetouched.self)
            guard let data = r.data, !data.isEmpty else { throw ERPAPI.Failure(status: 0, message: "The AI sent no photo back.") }
            let thumb = await Task.detached(priority: .userInitiated) { WebsitePhoto.thumbnail(data, maxPixel: 240) }.value
            finish { (i: inout WebsitePhotoItem) in
                if i.original == nil { i.original = WebsitePhotoItem.Original(data: i.data, kind: i.kind, thumb: i.thumb) }
                i.data = data
                i.kind = WebsitePhoto.Kind(ext: "jpg", mime: "image/jpeg")
                i.thumb = thumb
                i.check = r
                i.retouching = false
            }
            if !r.checked { said = "Retouched, not checked: compare it with the original before sending." }
            else if r.passes { said = "Retouched: " + (r.steps.isEmpty ? "the same piece." : r.steps.joined(separator: " → ")) }
            else { said = "Retouched. Check it closely: " + (r.differences.first ?? "it may not be the same piece.") }
        } catch {
            finish { (i: inout WebsitePhotoItem) in i.retouching = false }
            failure = "Couldn't retouch it. " + error.localizedDescription
        }
    }

    private func undoRetouch(_ id: UUID) {
        guard let k = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }), let o = items[k].original else { return }
        items[k].data = o.data
        items[k].kind = o.kind
        items[k].thumb = o.thumb
        items[k].original = nil
        items[k].check = nil
    }

    // MARK: Sending (one after another: shop wifi, big files)

    private func sendAll() async {
        guard canSend else { return }
        sending = true
        said = nil
        defer { sending = false }
        let target = folder
        // The Maisons: the ERP names the whole tray (sent ones included, so a later photo of a piece numbers after them).
        var names: [UUID: String] = [:]
        if isMaison {
            do {
                let tray: [[String: Any]] = items.map { (i: WebsitePhotoItem) in ["house": i.house, "model": i.model, "ext": i.kind.ext] }
                let a = try await ERPAPI.shared.post("/api/website/photos/names", ["folder": target, "items": tray], as: WebsiteMaisonNames.self)
                guard a.maison, a.names.count == items.count else { throw ERPAPI.Failure(status: 0, message: "The ERP didn't name the photographs.") }
                for (i, name) in zip(items, a.names) { names[i.id] = name }
            } catch {
                failure = "Not sent. " + error.localizedDescription
                return
            }
        }
        let queue = pending.map { (i: WebsitePhotoItem) in i.id }
        var sent = 0
        for id in queue {
            guard let k = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) else { continue }
            items[k].status = .uploading
            items[k].error = nil
            let item = items[k]
            let name = names[id] ?? (item.stem + "." + item.kind.ext)
            do {
                let up = try await WebsiteForm.json("/api/website/photos", fields: [("folder", target), ("name", name)],
                                                    files: [WebsiteForm.File(field: "file", name: "photo.\(item.kind.ext)", type: item.kind.mime, data: item.data)],
                                                    timeout: 120, as: WebsiteUploaded.self)
                if let j = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) {
                    items[j].status = .done
                    items[j].rel = up.rel
                }
                sent += 1
            } catch {
                if let j = items.firstIndex(where: { (i: WebsitePhotoItem) in i.id == id }) {
                    items[j].status = .failed
                    items[j].error = error.localizedDescription
                }
            }
        }
        if sent > 0 {
            said = "\(sent) photograph\(sent == 1 ? "" : "s") sent: on \(site.siteName) in \(chosen?.collection ?? "the collection") now."
            await site.loadFeatured()
        }
    }
}

/// One photograph in the tray, from Photos or the camera.
struct WebsitePhotoItem: Identifiable {
    enum Status { case queued, uploading, done, failed }

    /// The photograph as it came, kept while a retouched one stands in for it.
    struct Original {
        let data: Data
        let kind: WebsitePhoto.Kind
        let thumb: UIImage?
    }

    let id = UUID()
    var data: Data
    var kind: WebsitePhoto.Kind
    var thumb: UIImage?
    /// The name it goes up under, without its ending (the ending says what the bytes are).
    let stem: String
    var house = ""
    var model = ""
    var status: Status = .queued
    var error: String?
    /// Its key on the site once there ("Category/Collection/file"), for the set of the day.
    var rel: String?
    var retouching = false
    var original: Original?
    var check: WebsiteRetouched?

    init(data: Data, kind: WebsitePhoto.Kind, thumb: UIImage?, stem: String, house: String) {
        self.data = data
        self.kind = kind
        self.thumb = thumb
        self.stem = stem
        self.house = house
    }
}

/// The site's collections, by category, to choose where the photographs go.
struct WebsiteCollectionSheet: View {
    let collections: [WebsiteCollection]
    @Binding var folder: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    struct Shelf: Identifiable {
        let id: String
        let list: [WebsiteCollection]
    }

    private var shelves: [Shelf] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        let shown = collections.filter { (c: WebsiteCollection) in
            words.allSatisfy { (w: String) in "\(c.category) \(c.collection)".lowercased().contains(w) }
        }
        var order: [String] = []
        var by: [String: [WebsiteCollection]] = [:]
        for c in shown {
            if by[c.category] == nil { order.append(c.category) }
            by[c.category, default: []].append(c)
        }
        return order.map { (k: String) in Shelf(id: k, list: by[k] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(shelves) { (s: Shelf) in
                    Section(s.id) {
                        ForEach(s.list) { (c: WebsiteCollection) in
                            Button {
                                folder = c.folder
                                dismiss()
                            } label: {
                                HStack {
                                    Text(c.collection).foregroundStyle(Color.primary)
                                    Spacer(minLength: 8)
                                    if c.count > 0 { Text("\(c.count)").foregroundStyle(.secondary).monospacedDigit() }
                                    if c.folder == folder { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                                }
                            }
                        }
                    }
                    .houseRows()
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, prompt: "Find a collection")
            .navigationTitle("Collection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }
}
