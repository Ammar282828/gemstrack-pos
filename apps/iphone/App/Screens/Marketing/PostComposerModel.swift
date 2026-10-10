import SwiftUI
import Observation
import FirebaseAuth

struct NativePostPhoto: Codable, Equatable, Identifiable {
    var id = UUID().uuidString
    var name: String
    var data: Data
    var toSite = true
    var toWhatsApp = true
    var parent: String?
    var check: MarketingValue?
    var source: MarketingValue?
}

struct NativePostDraft: Codable, Equatable, Identifiable {
    var id = UUID().uuidString
    var updated = Date()
    var photos: [NativePostPhoto] = []
    var words = MarketingValue(["headline": "", "kicker": "", "weight": "", "weightEach": false, "metal": "", "stones": "", "hook": "", "caption": "", "captionEdited": false, "formats": "both", "folder": "", "siteName": "", "maisonHouse": "", "toWebsite": false, "toWhatsApp": false, "toInstagram": false, "waTargets": [], "feature": false, "storyOut": false])
    var story = NativeArtwork.blank()
    var square = NativeArtwork.blank(height: 1080)
    var paintedStory: Data?
    var paintedSquare: Data?
    var paintedStoryFor: String?
    var paintedSquareFor: String?
    var letteringCheck: MarketingValue?
    var queuedID: String?
    var queueReady: Bool?
    var title: String { words.s("headline").isEmpty ? "Untitled piece" : words.s("headline") }
}

actor NativePostDisk {
    private let folder: URL
    init(scope: String) {
        folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PostDrafts-\(House.id)-\(scope)", isDirectory: true)
    }
    func list() throws -> [NativePostDraft] {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var drafts: [NativePostDraft] = []
        for url in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) where url.pathExtension == "json" {
            guard let d = try? JSONDecoder().decode(NativePostDraft.self, from: Data(contentsOf: url)) else { continue }
            if Date().timeIntervalSince(d.updated) > 30 * 86400 { try? FileManager.default.removeItem(at: url) } else { drafts.append(d) }
        }
        return drafts.sorted { $0.updated > $1.updated }
    }
    func save(_ draft: NativePostDraft) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(draft).write(to: folder.appendingPathComponent(draft.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func remove(_ id: String) throws { try FileManager.default.removeItem(at: folder.appendingPathComponent(id + ".json")) }
}

@MainActor
@Observable
final class PostComposerModel {
    var draft = NativePostDraft()
    var drafts: [NativePostDraft] = []
    var loaded = false
    var config = MarketingValue.null
    var folders: [MarketingValue] = []
    var audience = MarketingValue.null
    var instagram = MarketingValue.null
    var health = MarketingValue.null
    var aiAnswer = MarketingValue.null
    var storyPreview = MarketingValue.null
    var squarePreview = MarketingValue.null
    var busy: String?
    var error: String?
    var said: String?
    var queueEntry: PostQueueEntry?
    let artwork = NativeArtwork()
    @ObservationIgnored private var disk: NativePostDisk?
    @ObservationIgnored private var saving: Task<Void, Never>?
    var assets: [String: Data] { Dictionary(uniqueKeysWithValues: draft.photos.map { ($0.id, $0.data) }) }
    var hero: NativePostPhoto? { draft.photos.first { $0.id == draft.story["bg"].s("photoId") } ?? draft.photos.first }
    var fields: [String: String] {
        let words = draft.words
        let weight = validWeight
        return ["headline": words.s("headline"), "kicker": words.s("kicker"), "weight": weight, "details": [words.s("metal"), words.s("stones")].filter { !$0.isEmpty }.joined(separator: " | ")]
    }
    var validWeight: String {
        let text = draft.words.s("weight").trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "g", with: "", options: .caseInsensitive)
        guard let value = Double(text), value > 0 else { return "" }
        return text + "g" + (draft.words["weightEach"].bool ? " each" : "")
    }
    var makeSquare: Bool { draft.words.s("formats") != "story" }
    var makeStory: Bool { draft.words.s("formats") != "square" }
    var sitePhotos: [NativePostPhoto] { draft.photos.filter(\.toSite).sorted { a, b in a.id == hero?.id && b.id != hero?.id } }
    var waPhotos: [NativePostPhoto] { draft.photos.filter(\.toWhatsApp).sorted { a, b in a.id == hero?.id && b.id != hero?.id } }
    var siteOn: Bool { makeSquare && draft.words["toWebsite"].bool && !sitePhotos.isEmpty }
    var waKeys: [String] { draft.words["toWhatsApp"].bool && makeSquare ? draft.words["waTargets"].array.map(\.string) : [] }
    var igOn: Bool { makeStory && draft.words["toInstagram"].bool && instagram["connected"].bool }
    var manualStory: Bool { makeStory && !igOn }
    var frozen: Bool { draft.queuedID != nil }
    var problems: [String] {
        var out: [String] = []
        if hero == nil { out.append("Add a photo.") }
        if draft.words.s("headline").trimmingCharacters(in: .whitespaces).isEmpty { out.append("Give the piece a headline.") }
        if makeSquare && draft.words["toWebsite"].bool && sitePhotos.isEmpty { out.append("Choose a photo for the website.") }
        if siteOn && draft.words.s("folder").isEmpty { out.append("Choose a website collection.") }
        if siteOn && draft.words.s("folder").hasSuffix("The Maisons") && draft.words.s("maisonHouse").trimmingCharacters(in: .whitespaces).isEmpty { out.append("Choose the piece’s house for The Maisons.") }
        if makeSquare && draft.words["toWhatsApp"].bool {
            if waPhotos.isEmpty { out.append("Choose a photo for WhatsApp.") }
            if waKeys.isEmpty { out.append("Choose a WhatsApp destination.") }
            if draft.words.s("caption").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append("Write the WhatsApp caption.") }
        }
        if draft.paintedStory != nil && draft.paintedStoryFor != hero?.id { out.append("The painted story belongs to another photo. Repaint it or use the original design.") }
        return out
    }
    func load() async {
        guard !loaded else { return }
        let scope = House.isDemo ? "demo" : (Auth.auth().currentUser?.uid ?? "signed-out")
        let storage = NativePostDisk(scope: scope); disk = storage
        do { drafts = try await storage.list(); if let latest = drafts.first { draft = latest } } catch { self.error = "Drafts could not be read: \(error.localizedDescription)" }
        loaded = true
        if House.isDemo { config = MarketingValue(["siteName": "Demo website", "posting": ["metal": "", "whatsappNumbers": []]]); return }
        await refreshConnections()
    }
    func refreshConnections() async {
        async let c = MarketingRequest.get("/api/app/website")
        async let f = MarketingRequest.get("/api/website/photos")
        async let a = MarketingRequest.get("/api/website/post")
        async let i = MarketingRequest.get("/api/instagram/status")
        do { config = try await c; if draft.words.s("metal").isEmpty { draft.words["metal"] = config["posting"]["metal"] }; if drafts.isEmpty { draft.words["toWebsite"] = .bool(!config.s("site").isEmpty) } } catch { self.error = error.localizedDescription }
        do { let answer = try await f; folders = answer["collections"].array } catch { self.error = error.localizedDescription }
        do { audience = try await a; if drafts.isEmpty { draft.words["toWhatsApp"] = .bool(audience["community"] != .null); let first = audience["groups"].array.prefix(1).map { $0["key"] }; draft.words["waTargets"] = .array(first + (audience["channel"] != .null ? [.string("channel")] : [])) } } catch { self.error = error.localizedDescription }
        do { instagram = try await i; if drafts.isEmpty { draft.words["toInstagram"] = instagram["connected"] } } catch { self.error = error.localizedDescription }
        await checkHealth()
    }
    func checkHealth() async { do { health = try await MarketingRequest.get("/api/website/post/health?fresh=1") } catch { self.error = error.localizedDescription } }
    func changed() {
        guard loaded else { return }
        var snapshot = draft
        snapshot.updated = Date()
        saving?.cancel()
        saving = Task { do { try await Task.sleep(for: .milliseconds(600)); try await disk?.save(snapshot); await refreshDrafts() } catch is CancellationError {} catch { self.error = "Draft could not be saved: \(error.localizedDescription)" } }
    }
    func saveNow() async { saving?.cancel(); do { var snapshot = draft; snapshot.updated = Date(); try await disk?.save(snapshot); await refreshDrafts() } catch { self.error = error.localizedDescription } }
    func refreshDrafts() async { if let list = try? await disk?.list() { drafts = list } }
    func startOver() async { await saveNow(); var next = NativePostDraft(); for key in ["metal", "formats", "toWebsite", "toWhatsApp", "toInstagram", "waTargets", "folder"] { next.words[key] = draft.words[key] }; draft = next; said = nil; queueEntry = nil }
    func open(_ saved: NativePostDraft) async { await saveNow(); draft = saved; queueEntry = nil }
    func remove(_ saved: NativePostDraft) async { do { try await disk?.remove(saved.id); await refreshDrafts(); if saved.id == draft.id { draft = NativePostDraft() } } catch { self.error = error.localizedDescription } }
    func add(_ data: Data, name: String, from: MarketingValue? = nil) async {
        guard draft.photos.count < 12 else { error = "A piece takes up to 12 photos."; return }
        guard let jpeg = WebsitePhoto.jpegCopy(data) else { error = "The photo could not be read."; return }
        var photo = NativePostPhoto(name: name, data: jpeg); photo.source = from; if from != nil { photo.toSite = false }
        draft.photos.append(photo)
        if hero?.id == photo.id { draft.story["bg"]["photoId"] = .string(photo.id); draft.square["bg"]["photoId"] = .string(photo.id); await layoutIfEmpty() }
        changed()
    }
    func layoutIfEmpty() async {
        do {
            if draft.story["layers"].array.isEmpty { let r = try await artwork.run(doc: draft.story, photos: assets, fields: fields, options: ["action": "preset", "value": "stack-left"]); draft.story = r["doc"] }
            if draft.square["layers"].array.isEmpty { let r = try await artwork.run(doc: draft.square, photos: assets, fields: fields, options: ["action": "square", "value": hero?.source?["marked"].bool == true ? "clean" : "catalogue"]); draft.square = r["doc"] }
        } catch { self.error = error.localizedDescription }
    }
    func preview() async {
        guard hero != nil else { return }
        do {
            let story = try await render(story: true, photo: hero, px: 540)
            guard !Task.isCancelled else { return }; storyPreview = story
            let square = try await render(story: false, photo: hero, px: 540)
            guard !Task.isCancelled else { return }; squarePreview = square
            if !draft.words["captionEdited"].bool { draft.words["caption"] = story["caption"] }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func render(story: Bool, photo: NativePostPhoto?, px: Int, site: Bool = false) async throws -> MarketingValue {
        var doc = story ? draft.story : draft.square
        if let photo { doc["bg"]["photoId"] = .string(photo.id) }
        var context = config["posting"].object.mapValues(\.any)
        context["whatsappNumbers"] = config["posting"]["whatsappNumbers"].array.map(\.string)
        let collection = folders.first { $0.s("folder") == draft.words.s("folder") }
        context["link"] = photo?.source?.s("url").isEmpty == false ? photo?.source?.s("url") : config.s("site") + (collection?.s("path") ?? "")
        var options: [String: Any] = ["px": px, "piece": draft.words.any, "context": context, "name": draft.words.s("siteName").isEmpty ? draft.title : draft.words.s("siteName"), "count": max(1, sitePhotos.count), "folder": draft.words.s("folder"), "maisonHouse": draft.words.s("maisonHouse")]
        let paint = story ? (draft.paintedStoryFor == photo?.id ? draft.paintedStory : nil) : (!site && draft.paintedSquareFor == photo?.id ? draft.paintedSquare : nil)
        if let paint { options["background"] = "data:image/jpeg;base64," + paint.base64EncodedString(); options["hideBound"] = true }
        return try await artwork.run(doc: doc, photos: assets, fields: fields, options: options)
    }
    func runAI(op: String, photoID: String?, target: String, params: [String: Any]) async {
        guard let source = draft.photos.first(where: { $0.id == photoID }) ?? hero else { return }
        busy = "Making \(target)…"; error = nil; defer { busy = nil }
        do {
            let result = try await MarketingRequest.ai(op, images: [source.data], params: params)
            aiAnswer = result
            if op == "caption" {
                let c = result["caption"]; if draft.words.s("headline").isEmpty { draft.words["headline"] = c["headlines"].array.first ?? .string("") }
                if draft.words.s("hook").isEmpty { draft.words["hook"] = c["hook"] }
                draft.words["caption"] = c["whatsappCaption"]; draft.words["captionEdited"] = .bool(true)
            } else {
                guard let data = Data(base64Encoded: result["image"].s("data")), let jpeg = WebsitePhoto.jpegCopy(data) else { throw ERPAPI.Failure(status: 0, message: "The AI returned no readable photo.") }
                if op == "letter" || op == "paint" {
                    draft.letteringCheck = result
                    if target == "post" { draft.paintedSquare = jpeg; draft.paintedSquareFor = source.id } else { draft.paintedStory = jpeg; draft.paintedStoryFor = source.id }
                } else {
                    var made = NativePostPhoto(name: target, data: jpeg); made.parent = source.id; made.check = result["check"]; made.source = source.source
                    let story = result.s("aspect") == "9:16" || (params["aspect"] as? String) == "9:16"
                    made.toSite = !story && source.toSite; made.toWhatsApp = !story && source.toWhatsApp
                    if !story, let index = draft.photos.firstIndex(where: { $0.id == source.id }) { draft.photos[index].toSite = false; draft.photos[index].toWhatsApp = false }
                    draft.photos.append(made)
                    if story || source.id == hero?.id { draft.story["bg"]["photoId"] = .string(made.id) }
                    if !story { draft.square["bg"]["photoId"] = .string(made.id) }
                }
                if result["check"] == .null || !result["check"]["samePiece"].bool || result["check"].n("confidence") < 0.8 { said = "Compare this version with the original before posting. The piece could not be verified." }
            }
            await saveNow(); await preview()
        } catch { self.error = error.localizedDescription }
    }
    func finish(queueOnly: Bool) async {
        guard problems.isEmpty else { error = problems.joined(separator: " "); return }
        guard siteOn || !waKeys.isEmpty || igOn else { error = "Choose a destination, or share the story from your phone."; return }
        guard !manualStory || draft.words["storyOut"].bool else { error = "Share or save the story first, or choose Post only."; return }
        busy = "Preparing the post…"; error = nil; defer { busy = nil }
        do {
            if draft.queuedID == nil {
                let thumb = try await render(story: false, photo: hero, px: 240)
                let names = thumb["names"].array.map(\.string)
                let base = draft.title.lowercased().replacingOccurrences(of: "[^a-z0-9_-]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
                var body: [String: Any] = ["headline": draft.title, "caption": draft.words.s("caption"), "fileBase": base.isEmpty ? "piece" : String(base.prefix(120)), "counts": ["site": siteOn ? sitePhotos.count : 0, "wa": waKeys.isEmpty ? 0 : waPhotos.count, "story": igOn], "website": siteOn ? ["folder": draft.words.s("folder"), "collection": folders.first { $0.s("folder") == draft.words.s("folder") }?.s("collection") ?? draft.words.s("folder"), "names": names, "featured": config["featured"].bool && draft.words["feature"].bool] : NSNull(), "instagram": igOn, "whatsapp": waKeys, "thumb": thumb.s("image")]
                if let from = hero?.source, !from.s("id").isEmpty { body["sitePiece"] = from.s("id") }
                let r = try await MarketingRequest.send("/api/website/post/queue", body)
                guard !r["item"].s("id").isEmpty else { throw ERPAPI.Failure(status: 0, message: "The queue returned no piece.") }
                draft.queuedID = r["item"].s("id"); draft.queueReady = false; await saveNow()
            }
            let id = draft.queuedID!
            if draft.queueReady != true {
                let existing = try await MarketingRequest.get("/api/website/post/queue")
                if let item = existing["items"].array.first(where: { $0.s("id") == id }), item.s("status") != "draft" {
                    draft.queueReady = true
                    await saveNow()
                }
            }
            if draft.queueReady != true {
                var uploads: [(String, Data)] = []
                if siteOn { for (i, p) in sitePhotos.enumerated() { let px = max(1080, min(3000, Int(UIImage(data: p.data).map { min($0.size.width, $0.size.height) } ?? 1080))); let r = try await render(story: false, photo: p, px: px, site: true); if let bytes = Data(base64Encoded: r.s("image")) { uploads.append(("site-\(i)", bytes)) } } }
                if !waKeys.isEmpty { for (i, p) in waPhotos.enumerated() { let r = try await render(story: false, photo: p, px: 1600); if let bytes = Data(base64Encoded: r.s("image")) { uploads.append(("wa-\(i)", bytes)) } } }
                if igOn { let r = try await render(story: true, photo: hero, px: 1080); if let bytes = Data(base64Encoded: r.s("image")) { uploads.append(("story", bytes)) } }
                for (i, upload) in uploads.enumerated() { busy = "Keeping photo \(i + 1) of \(uploads.count)…"; _ = try await WebsiteForm.send("/api/website/post/queue/\(id)", fields: [("key", upload.0)], files: [.init(field: "file", name: upload.0 + ".jpg", type: "image/jpeg", data: upload.1)]) }
                _ = try await MarketingRequest.send("/api/website/post/queue/\(id)", ["action": "ready"], method: "PATCH"); draft.queueReady = true; await saveNow()
            }
            if !queueOnly { busy = "Sending…"; _ = try await PostsStore.shared.sendNow(id) }
            let entry = try await MarketingRequest.get("/api/website/post/queue")
            if let found = entry["items"].array.first(where: { $0.s("id") == id }) { queueEntry = try JSONDecoder().decode(PostQueueEntry.self, from: found.data) }
            said = queueOnly ? "In the queue. It waits until you send or schedule it." : (queueEntry?.status == "sent" ? "Sent to every destination." : "Open the queued piece to see what went and retry what remains.")
            await PostsStore.shared.load()
        } catch { self.error = error.localizedDescription; await saveNow() }
    }
}
