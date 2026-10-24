import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import Observation

/// A photograph to start from, fetched when the design opens so choosing it costs nothing (use-design.ts StartPhoto).
struct DesignStartPhoto {
    var label: String
    var load: () async throws -> Data
    /// The photograph already carries the house's marks (taheri.shop's wordmark and weight).
    var marked = false
    var fields: [String: String] = [:]
    /// siteId / assetId
    var source: [String: String] = [:]
}

/// A layout the engine offers (AD_TEMPLATES).
struct DesignLayout: Identifiable {
    let id: String
    let label: String
}

/// What the start screen hands the workspace (use-design.ts StartRequest).
struct DesignStartRequest {
    var kind: String
    var sizes: [DesignSizeChoice]
    var photo: DesignStartPhoto?
    var fields: [String: String] = [:]
    var copy: [String: String] = [:]
    var template = "headline"
    /// A page's document built by the caller rather than laid out by a template (a flat picture rebuilt as layers).
    var compose: ((DesignPageState) -> MarketingValue)?
}

/// The design being made: the work (DesignWork), its photographs, what is drawn from them, and the three places it lives: the
/// device draft (autosaved 1.5 s after a change, as the web's), the shop's `designs` (Save), and the layer editor's own undo.
@MainActor
@Observable
final class DesignWorkspaceModel {
    var work: DesignWork?
    /// The main photograph is "photo"; others (an inset, an extended copy) by their own id. All JPEG.
    private(set) var photos: [String: Data] = [:]
    var starting = false
    var saving = false
    var draftSaved: Date?
    var error: String?
    var sheet: DesignSheet?
    /// Pages drawn small (the strip) and at reading size (the active page), by page id.
    private(set) var thumbs: [String: UIImage] = [:]
    private(set) var previews: [String: UIImage] = [:]
    /// Bumped when what a page is drawn from changes without its document (the words, the photographs).
    private(set) var tick = 0
    /// The engine's catalogue (layouts, palettes), read once.
    private(set) var catalogue = MarketingValue.null
    var marked = false
    /// Phase 2: an address a sheet asks the screen to open (the Meta ad's New ad), the one AI tool running, an AI picture waiting for a
    /// look, and the photographs before the AI ones ("Back to the photo before").
    var route: Route?
    var aiBusy: String?
    var candidate: DesignCandidate?
    private(set) var photoUndo: [DesignPhotoStep] = []
    /// The same-piece check that came with the photograph in use, when the AI made it.
    private(set) var photoCheck: MarketingValue?
    /// "Also remove tags and strings": whether Enhance and Retouch take the website's marks off too (per device).
    var tidy = UserDefaults.standard.bool(forKey: "design.tidy")
    func setTidy(_ on: Bool) { tidy = on; UserDefaults.standard.set(on, forKey: "design.tidy") }

    let engine = NativeArtwork()
    @ObservationIgnored private var composeNow: ((DesignPageState) -> MarketingValue)?
    @ObservationIgnored var speak: ((Note) -> Void)?
    @ObservationIgnored private var previewPhotos: [String: Data] = [:]
    @ObservationIgnored private var photosChanged = true
    @ObservationIgnored private var draftID: String?
    @ObservationIgnored private var createdAt = Date()
    @ObservationIgnored private var autosave: Task<Void, Never>?
    /// A save is on its way through the Outbox.
    private(set) var uploading = false
    @ObservationIgnored private var pendingOld: String?
    @ObservationIgnored private var token = UUID()
    @ObservationIgnored private var serial = 0
    @ObservationIgnored private var editSnapshot: (pageId: String, work: DesignWork)?
    @ObservationIgnored private var disk = DesignDraftDisk.current()

    private static var currentKey: String { "design.draft.current.\(House.id)" }

    var isOpen: Bool { work != nil }

    func say(_ title: String, detail: String = "", failed: Bool = false) {
        speak?(Note(title: title, detail: detail, failed: failed))
    }

    // MARK: The engine

    func loadCatalogue() async {
        guard catalogue == .null else { return }
        do {
            let r = try await engine.run(doc: DesignWork.blankDoc(w: 1080, h: 1080), photos: [:], fields: DesignWork.emptyFields())
            catalogue = r["catalogue"]
        } catch { self.error = error.localizedDescription }
    }

    /// The layouts the engine offers (lib/ads/studio/templates.ts AD_TEMPLATES for this house).
    var templates: [DesignLayout] { catalogue["templates"].array.map { DesignLayout(id: $0.s("id"), label: $0.s("label")) } }

    private func setPhotos(_ new: [String: Data]) {
        photos = new
        previewPhotos = new.mapValues { WebsitePhoto.jpegCopy($0, longestEdge: 1200) ?? $0 }
        photosChanged = true
        tick += 1
    }

    /// A page laid out by a template (or, for the website's own page, the catalogue's photograph); anything added by hand stays.
    /// Make it with AI (DesignAI) lays every size out with the layout the art director chose.
    func layOut(_ p: DesignPageState, template: String, fields: [String: String]) async throws -> MarketingValue {
        let options: [String: Any]
        if DesignSizes.isCatalogue(label: p.label) { options = ["action": "square", "value": "catalogue"] }
        else { options = ["action": "ad", "value": template, "photoMarked": marked] }
        let r = try await engine.run(doc: p.doc, photos: photos, fields: fields, options: options)
        var doc = r["doc"]
        if !DesignSizes.isCatalogue(label: p.label) { doc["meta"]["template"] = .string(template) }
        return doc
    }

    /// A page as JPEG data at this width (the same call Save and Publish use).
    func render(pageId: String, px: Int, quality: Double = 0.92) async throws -> Data {
        guard let w = work, let p = w.page(pageId) else { throw ERPAPI.Failure(status: 0, message: "That page is gone.") }
        let r = try await engine.run(doc: p.doc, photos: photos, fields: w.fields, options: ["px": px, "quality": quality])
        guard let data = Data(base64Encoded: r.s("image")) else { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn.") }
        return data
    }

    /// A page drawn over another of the design's photographs (a further angle), for Publish's "more photos".
    func renderWith(pageId: String, photoId: String, px: Int, quality: Double = 0.92) async throws -> Data {
        guard let w = work, var doc = w.page(pageId)?.doc else { throw ERPAPI.Failure(status: 0, message: "That page is gone.") }
        doc["bg"]["photoId"] = .string(photoId)
        doc["bg"]["placement"] = MarketingValue(["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5])
        let r = try await engine.run(doc: doc, photos: photos, fields: w.fields, options: ["px": px, "quality": quality])
        guard let data = Data(base64Encoded: r.s("image")) else { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn.") }
        return data
    }

    /// The strip's small picture of a page, a moment after it stopped changing.
    func refreshThumb(_ pageId: String) async {
        guard let w = work, !w.fresh, let p = w.page(pageId) else { return }
        do {
            try await Task.sleep(for: .milliseconds(450))
            let r = try await engine.run(doc: p.doc, photos: previewPhotos, fields: w.fields, options: ["px": 220, "quality": 0.7])
            if !Task.isCancelled, let image = NativeArtwork.image(r) { thumbs[pageId] = image }
        } catch {}
    }

    /// The active page at reading size.
    func refreshPreview(_ pageId: String) async {
        guard let w = work, !w.fresh, let p = w.page(pageId) else { return }
        do {
            try await Task.sleep(for: .milliseconds(250))
            let r = try await engine.run(doc: p.doc, photos: previewPhotos, fields: w.fields, options: ["px": 760, "quality": 0.85])
            if !Task.isCancelled, let image = NativeArtwork.image(r) { previews[pageId] = image }
        } catch {}
    }

    // MARK: Starting, opening, closing

    private func begin(_ w: DesignWork, draft id: String?, photos map: [String: Data]) {
        token = UUID()
        draftID = id ?? "design-" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36) + String(UInt32.random(in: 0..<46_656), radix: 36)
        createdAt = Date()
        UserDefaults.standard.set(draftID, forKey: Self.currentKey)
        thumbs = [:]; previews = [:]
        photoUndo = []; photoCheck = nil; candidate = nil; aiBusy = nil
        setPhotos(map)
        work = w
        serial += 1
        scheduleDraft()
    }

    /// A new design: the first size is the master. It is laid out once, here, with the photograph in.
    func start(_ req: DesignStartRequest) async -> Bool {
        starting = true
        defer { starting = false }
        do {
            var map: [String: Data] = [:]
            if let p = req.photo {
                let raw = try await p.load()
                guard let jpeg = WebsitePhoto.jpegCopy(raw) else { throw ERPAPI.Failure(status: 0, message: "That photograph could not be read.") }
                map["photo"] = jpeg
            }
            var fields = req.photo?.fields ?? [:]
            for (k, v) in req.fields where !v.isEmpty { fields[k] = v }
            marked = req.photo?.marked ?? false
            composeNow = req.compose
            let w = DesignWork.new(kind: req.kind, sizes: req.sizes, fields: fields, source: req.photo?.source ?? [:], copy: req.copy, template: req.template)
            begin(w, draft: nil, photos: map)
            await layOutFresh()
            return work != nil
        } catch {
            self.error = "Couldn’t start. " + error.localizedDescription
            return false
        }
    }

    /// The first layout of a fresh design, on every page.
    private func layOutFresh() async {
        guard let w = work, w.fresh else { return }
        let mine = token
        do {
            var docs: [String: MarketingValue] = [:]
            for p in w.pages {
                if let compose = composeNow { docs[p.id] = compose(p) }
                else { docs[p.id] = try await layOut(p, template: w.template, fields: w.fields) }
            }
            composeNow = nil
            guard mine == token, var cur = work, cur.fresh else { return }
            for i in cur.pages.indices { if let d = docs[cur.pages[i].id] { cur.pages[i].doc = d } }
            cur.fresh = false
            work = cur
            tick += 1
            changed()
        } catch {
            guard mine == token else { return }
            // A design that cannot be laid out would wait forever: back to the start screen, with the reason.
            work = nil
            token = UUID()
            self.error = "Couldn’t lay the design out. " + error.localizedDescription
        }
    }

    /// A saved design (or a legacy saved ad), with each page's layout and its photographs.
    func open(_ record: DesignRecord) async -> Bool {
        starting = true
        defer { starting = false }
        do {
            let o = try await DesignRecords.open(record)
            marked = false
            begin(o.work, draft: nil, photos: o.photos)
            return true
        } catch {
            self.error = "Couldn’t open it. " + error.localizedDescription
            return false
        }
    }

    /// A draft of this screen's own.
    func openDraft(_ id: String) async -> Bool {
        starting = true
        defer { starting = false }
        guard let d = await disk.draft(id) else { error = "That draft isn’t here any more."; return false }
        let map = await disk.photos(id)
        marked = false
        begin(d.work, draft: id, photos: map)
        createdAt = d.created
        photosChanged = false
        return true
    }

    /// An earlier Post a piece draft, opened as a design. The old draft goes once this one is kept in its place.
    func openOld(_ old: NativePostDraft) -> Bool {
        guard let c = DesignOldDraft.convert(old) else {
            error = "That Post a piece draft has no story or square to open. Open it in Post a piece."
            return false
        }
        marked = false
        begin(c.work, draft: nil, photos: c.photos)
        pendingOld = old.id
        say("Opened as a design", detail: "Your words, photographs and both pictures came with it.")
        return true
    }

    /// The design left open on this phone comes back (never over one already open).
    func resume() async {
        guard work == nil, let id = UserDefaults.standard.string(forKey: Self.currentKey) else { return }
        if await disk.draft(id) != nil { _ = await openDraft(id) }
    }

    /// Back to the start screen. The draft stays on the phone ("Where you left off").
    func close() async {
        await flush()
        autosave?.cancel()
        token = UUID()
        work = nil; setPhotos([:]); thumbs = [:]; previews = [:]
        draftID = nil
        UserDefaults.standard.removeObject(forKey: Self.currentKey)
    }

    /// The draft goes once the design is sent on (as the web's `finish`).
    func finish() {
        if let id = draftID { Task { await disk.remove(id) } }
        UserDefaults.standard.removeObject(forKey: Self.currentKey)
    }

    // MARK: The device draft

    /// Called on every change: the draft is written 1.5 s after the last one.
    private func changed() {
        serial += 1
        scheduleDraft()
    }

    private func scheduleDraft() {
        autosave?.cancel()
        autosave = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(1500)) } catch { return }
            await self?.flush()
        }
    }

    /// Write the draft now.
    func flush() async {
        guard let w = work, !w.fresh, let id = draftID else { return }
        let thumb = photos["photo"].flatMap { WebsitePhoto.thumbnail($0, maxPixel: 160) }?.jpegData(compressionQuality: 0.6)
        let draft = DesignDraft(id: id, created: createdAt, updated: Date(), title: w.displayName, thumb: thumb, work: w)
        do {
            try await disk.save(draft, photos: photosChanged ? photos : nil)
            photosChanged = false
            draftSaved = Date()
            if let old = pendingOld {
                pendingOld = nil
                try? await NativePostDisk(scope: DesignDraftDisk.scope()).remove(old)
            }
        } catch { /* storage full or protected: the design is still on screen */ }
    }

    // MARK: Changes

    private func mutate(_ change: (inout DesignWork) -> Void) {
        guard var w = work else { return }
        change(&w)
        work = w
        changed()
    }

    /// The layer editor's view of a page's document: its edits come up through here (design-state.ts says what an edit does to the others).
    func docBinding(_ pageId: String) -> Binding<MarketingValue> {
        Binding(get: { self.work?.page(pageId)?.doc ?? .null }, set: { self.editDoc(pageId, $0) })
    }

    func editDoc(_ pageId: String, _ doc: MarketingValue) { mutate { $0.editDoc(pageId, doc) } }
    func setDoc(_ pageId: String, _ doc: MarketingValue) { mutate { $0.setDoc(pageId, doc) } }
    func redoFromMaster(_ pageId: String, _ doc: MarketingValue) { mutate { $0.redoFromMaster(pageId, doc) } }
    func addPages(_ pages: [NewDesignPage]) { mutate { $0.addPages(pages) } }
    func removePage(_ id: String) { mutate { $0.removePage(id) }; thumbs[id] = nil; previews[id] = nil }
    func setMaster(_ id: String) { mutate { $0.setMaster(id) } }
    func setActive(_ id: String) { if var w = work { w.setActive(id); work = w } }
    func rename(_ name: String) { mutate { $0.name = String(name.prefix(120)); $0.dirty = true } }
    func setField(_ key: String, _ value: String) { mutate { $0.fields[key] = value; $0.dirty = true }; tick += 1 }
    func setCopy(_ key: String, _ value: String) { mutate { $0.copy[key] = value; $0.dirty = true } }
    func refile(_ folder: String?) { mutate { $0.folder = folder; $0.dirty = true } }

    /// A field of the words, held to the web's limit (design-piece.tsx FIELD_ROWS).
    func fieldBinding(_ key: String, limit: Int = 300) -> Binding<String> {
        Binding(get: { self.work?.fields[key] ?? "" }, set: { self.setField(key, String($0.prefix(limit))) })
    }
    func copyBinding(_ key: String, limit: Int = 2000) -> Binding<String> {
        Binding(get: { self.work?.copy[key] ?? "" }, set: { self.setCopy(key, String($0.prefix(limit))) })
    }

    /// Lay the active page out again with a template (the web's Layout list); it becomes the person's own if it is not the master.
    func applyTemplate(_ id: String) async {
        guard let w = work, !w.fresh else { return }
        let page = w.activePage
        do {
            let doc = try await layOut(page, template: id, fields: w.fields)
            editDoc(page.id, doc)
        } catch { self.error = "Couldn’t change the layout. " + error.localizedDescription }
    }

    /// The layer editor opened on a page: if it is closed without a change (Cancel), the page is as it was.
    func beginEditing(_ pageId: String) { if let w = work { editSnapshot = (pageId, w) } }
    func endEditing() {
        defer { editSnapshot = nil }
        guard let snap = editSnapshot, var w = work,
              let i = w.pages.firstIndex(where: { $0.id == snap.pageId }),
              let j = snap.work.pages.firstIndex(where: { $0.id == snap.pageId }),
              w.pages[i].doc == snap.work.pages[j].doc else { return }
        w.pages[i].origin = snap.work.pages[j].origin
        w.pages[i].rev = snap.work.pages[j].rev
        w.stale = snap.work.stale
        w.dirty = snap.work.dirty
        work = w
    }

    /// A photograph the person chose in place of the picture. The pages keep their layouts and show the new one.
    func replacePhoto(_ data: Data, label: String? = nil, fields: [String: String] = [:], source: [String: String] = [:], marked isMarked: Bool = false) {
        guard let jpeg = WebsitePhoto.jpegCopy(data) else { error = "That photograph could not be read."; return }
        var map = photos
        map["photo"] = jpeg
        setPhotos(map)
        marked = isMarked
        mutate { w in
            for (k, v) in fields where !v.isEmpty && (w.fields[k] ?? "").isEmpty { w.fields[k] = v }
            for (k, v) in source { w.source[k] = v }
            w.dirty = true
        }
    }

    // MARK: Pictures (phase 2: the AI tools, further photographs)

    /// A further photograph under its own id (an extended copy a resized page uses, another angle of the piece).
    func addPhoto(_ id: String, _ data: Data) {
        guard DesignRecords.idOK(id), let jpeg = WebsitePhoto.jpegCopy(data) else { return }
        var map = photos
        map[id] = jpeg
        setPhotos(map)
        mutate { $0.dirty = true }
    }

    func removePhoto(_ id: String) {
        guard id != "photo" else { return }
        var map = photos
        map[id] = nil
        setPhotos(map)
        mutate { $0.dirty = true }
    }

    /// Other angles of the piece ("More photos of this piece"): they go out as squares of their own.
    var moreIds: [String] { photos.keys.filter { $0.hasPrefix("more-") }.sorted() }

    func addMore(_ data: Data) {
        guard moreIds.count < 8 else { error = "A piece takes up to 8 more photographs."; return }
        addPhoto("more-" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36) + String(UInt32.random(in: 0..<1296), radix: 36), data)
    }

    /// An AI picture in the photograph's place. The one before it is kept, one step back at a time.
    func takeAIPhoto(_ data: Data, check: MarketingValue?, clean: Bool) {
        guard let jpeg = WebsitePhoto.jpegCopy(data) else { error = "The AI’s picture could not be read."; return }
        if let old = photos["photo"] { photoUndo.append(DesignPhotoStep(data: old, marked: marked, check: photoCheck)); if photoUndo.count > 5 { photoUndo.removeFirst() } }
        var map = photos
        map["photo"] = jpeg
        setPhotos(map)
        if clean { marked = false }
        photoCheck = check
        mutate { $0.dirty = true }
    }

    var canUndoPhoto: Bool { !photoUndo.isEmpty }

    func undoPhoto() {
        guard let last = photoUndo.popLast() else { return }
        var map = photos
        map["photo"] = last.data
        setPhotos(map)
        marked = last.marked
        photoCheck = last.check
        mutate { $0.dirty = true }
    }

    // MARK: Pages made for a shape (phase 2: the resize engine, for Publish's "Make 1:1 from this" and "Re-do from the master")

    /// The master's design on another shape (workspace.tsx `resizedTo`): one engine call, no AI.
    func resizedDoc(to w: Double, _ h: Double) async throws -> MarketingValue {
        guard let cur = work else { throw ERPAPI.Failure(status: 0, message: "No design is open.") }
        var options: [String: Any] = ["action": "resize", "targets": [["w": w, "h": h]], "photoMarked": marked]
        let subject = cur.masterPage.doc["meta"]["subject"]
        if subject != .null { options["subject"] = subject.any }
        let r = try await engine.run(doc: cur.masterPage.doc, photos: photos.mapValues { WebsitePhoto.jpegCopy($0, longestEdge: 1200) ?? $0 }, fields: cur.fields, options: options)
        let doc = r["results"].array.first?["doc"] ?? .null
        guard doc != .null else { throw ERPAPI.Failure(status: 0, message: "That didn’t resize.") }
        return doc
    }

    /// The website's own page is the catalogue's photograph (the weight stamped, the mark), not a poster.
    func catalogueDoc(w: Double, h: Double) async throws -> MarketingValue {
        guard let cur = work else { throw ERPAPI.Failure(status: 0, message: "No design is open.") }
        let r = try await engine.run(doc: DesignWork.blankDoc(w: w, h: h), photos: photos, fields: cur.fields, options: ["action": "square", "value": "catalogue"])
        return r["doc"]
    }

    /// A page of a destination's shape that the design hasn't got ("Make 1:1 from this"). WhatsApp's square and the website's are the
    /// same shape but not the same picture: each has a page of its own.
    func makeSize(_ presetId: String) async {
        guard let cur = work, let p = DesignSizes.size(presetId) else { return }
        let same: (DesignPageState) -> Bool = { x in
            presetId == "website" || presetId == "whatsapp" ? x.label == p.label : x.w == p.w && x.h == p.h && x.format == p.format
        }
        guard !cur.pages.contains(where: same) else { return }
        do {
            let doc: MarketingValue
            if presetId == "website" { doc = try await catalogueDoc(w: p.w, h: p.h) } else { doc = try await resizedDoc(to: p.w, p.h) }
            guard let latest = work, !latest.pages.contains(where: same) else { return }
            addPages([NewDesignPage(id: nil, label: p.label, format: p.format, w: p.w, h: p.h, doc: doc, origin: presetId == "website" ? "manual" : "resized", syncedFrom: nil)])
        } catch { self.error = "Couldn’t make that size. " + error.localizedDescription }
    }

    /// "Re-do from the master" on a resized page that is behind it.
    func redoPage(_ pageId: String) async {
        guard let cur = work, let page = cur.page(pageId) else { return }
        do {
            let doc: MarketingValue
            if DesignSizes.isCatalogue(label: page.label) { doc = try await catalogueDoc(w: page.w, h: page.h) } else { doc = try await resizedDoc(to: page.w, page.h) }
            redoFromMaster(pageId, doc)
            say("Done again from the master", detail: page.label)
        } catch { self.error = "Couldn’t do it again. " + error.localizedDescription }
    }

    // MARK: Save to the shop

    /// What a save sends, drawn now (the phone's own work): the same parts the web posts.
    private struct SaveParts {
        let meta: MarketingValue
        let id: String?
        let docs: [String: Data]
        let images: [String: Data]
        let files: [String: Data]
    }

    private func drawSave(_ w: DesignWork) async throws -> SaveParts {
        let small = try await engine.run(doc: w.masterPage.doc, photos: previewPhotos, fields: w.fields, options: ["px": 200, "quality": 0.7])
        let thumb = "data:image/jpeg;base64," + small.s("image")
        var docs: [String: Data] = [:], images: [String: Data] = [:]
        for p in w.pages {
            docs[p.id] = p.doc.data
            images[p.id] = try await render(pageId: p.id, px: Int(min(2160, max(p.w, 1080))))
        }
        // The photograph it is drawn on, at most 2048 px; the others only when a page uses them.
        var files: [String: Data] = [:]
        for (id, data) in photos where id == "photo" || w.pages.contains(where: { DesignRecords.docUses($0.doc, id) }) {
            guard let image = UIImage(data: data), let jpeg = WebsitePhoto.jpeg(image, longestEdge: 2048, quality: 0.9) else { continue }
            files[id] = jpeg
        }
        return SaveParts(meta: w.meta(thumb: thumb), id: w.id, docs: docs, images: images, files: files)
    }

    private func kept(_ record: DesignRecord, before: Int) {
        if var cur = work {
            cur.id = record.id
            cur.folder = record.folder
            cur.dirty = serial != before
            work = cur
            changed()
        }
    }

    /// Save: the same parts the web posts (DesignRecords.save). Returns the record, or nil with `error` set.
    /// Awaited, for Publish, which needs the record.
    @discardableResult
    func saveToShop() async -> DesignRecord? {
        guard let w = work, !w.fresh else { return nil }
        saving = true
        defer { saving = false }
        let before = serial
        do {
            let p = try await drawSave(w)
            let record = try await DesignRecords.save(meta: p.meta, id: p.id, docs: p.docs, images: p.images, photos: p.files)
            kept(record, before: before)
            say("Saved", detail: "On the Saved shelf.")
            return record
        } catch {
            self.error = "Couldn’t save it. " + error.localizedDescription
            return nil
        }
    }

    /// The Save button: the design is drawn here, the upload goes through the Outbox and the editor is free at once.
    /// A second Save while one is on its way waits for it (a first save would otherwise make two records).
    func saveInBackground() async {
        guard let w = work, !w.fresh, !uploading else { return }
        saving = true
        let before = serial
        let parts: SaveParts
        do { parts = try await drawSave(w) } catch {
            saving = false
            self.error = "Couldn’t save it. " + error.localizedDescription
            return
        }
        saving = false
        uploading = true
        say("Saving…", detail: "It goes on in the background.")
        Outbox.shared.post(label: "Save “\(w.displayName)”") { [self] in
            uploading = true
            defer { uploading = false }
            let record = try await DesignRecords.save(meta: parts.meta, id: parts.id ?? work?.id, docs: parts.docs, images: parts.images, photos: parts.files)
            kept(record, before: before)
            return "Saved to the Saved shelf"
        }
    }

    /// Note a send on the saved design (PATCH { published }), as the web's Publish sheet does.
    func recordPublish(dest: String, ok: Bool = true, ref: String? = nil) async {
        guard let id = work?.id else { return }
        var published: [String: Any] = ["dest": dest, "ok": ok]
        if let ref { published["ref"] = ref }
        _ = try? await ERPAPI.shared.send(DesignRecords.base(id), method: "PATCH", ["published": published])
    }
}
