import SwiftUI
import Observation

@MainActor @Observable
final class StudioModel {
    var tab = "plan"
    var part = "plays"
    var catalogue = MarketingValue.null
    var guide = MarketingValue.null
    var weekly = MarketingValue.null
    var asset = MarketingValue.null
    var photo: Data?
    var originalPhoto: Data?
    var marked = false
    var doc = NativeArtwork.blank(photo: "photo", height: 1350)
    var fields: [String: String] = ["kicker": "", "headline": "", "weight": "", "details": ""]
    var format = "portrait"
    var template = "headline"
    var customWidth = 1080.0
    var customHeight = 1350.0
    var price = ""
    var text = ""
    var headline = ""
    var goal = "whatsapp"
    var link = ""
    var brief = ""
    var pair = true
    var rates = MarketingValue.null
    var copy = MarketingValue.null
    var direction = MarketingValue.null
    var painted = MarketingValue.null
    var check = MarketingValue.null
    var image = MarketingValue.null
    var savedID: String?
    var folder = ""
    var busy: String?
    var error: String?
    var said: String?
    var route: Route?
    let engine = NativeArtwork()
    var photos: [String: Data] { photo.map { ["photo": $0] } ?? [:] }
    var title: String { fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? asset.s("name", "Studio ad") }
    var formatInfo: MarketingValue { catalogue["formats"].array.first { $0.s("id") == format } ?? .null }
    var renderKey: String { doc.text + MarketingValue(fields).text + (photo.map { String($0.count) } ?? "") }
    func run(_ title: String, _ work: () async throws -> Void) async {
        guard busy == nil else { return }
        busy = title; error = nil; defer { busy = nil }
        do { try await work() } catch { self.error = error.localizedDescription }
    }
    func load(path: String) async {
        let asked = AdsQuery.value("v", in: path) ?? "plan"
        let old = ["picks": ("photos", "picks"), "library": ("photos", "library"), "guide": ("plan", "guide"), "rivals": ("plan", "rivals")]
        if let value = old[asked] { tab = value.0; part = value.1 }
        else { tab = ["plan", "photos", "make", "board", "saved"].contains(asked) ? asked : "plan"; part = AdsQuery.value("s", in: path) ?? "plays" }
        do { let r = try await engine.run(doc: doc, photos: [:], fields: fields); catalogue = r["catalogue"] } catch { self.error = error.localizedDescription }
        if !House.isDemo { do { rates = try await MarketingRequest.get("/api/ads/studio/rates") } catch { self.error = error.localizedDescription } }
    }
    func choose(_ item: MarketingValue, preferOriginal: Bool = true) async {
        await run("Bringing the photo…") {
            asset = item; savedID = nil
            let cleanID = preferOriginal ? item["original"].s("id") : ""
            let id = cleanID.isEmpty ? item.s("id") : cleanID
            let data = try await ERPAPI.shared.data("/api/ads/studio/image?id=" + AdsQuery.escape(id) + "&size=2400")
            guard let jpeg = WebsitePhoto.jpegCopy(data) else { throw ERPAPI.Failure(status: 0, message: "This photo could not be opened.") }
            photo = jpeg; originalPhoto = jpeg; marked = item.s("source") == "site" && cleanID.isEmpty
            fields["headline"] = item.s("name"); fields["weight"] = item.s("specs"); link = item.s("page")
            if fields["details"]?.isEmpty != false { fields["details"] = catalogue["brand"]["voice"]["ctas"].array.first?.string ?? "Message us" }
            try await layout(reset: true); tab = "make"
        }
    }
    func upload(_ data: Data) async {
        await run("Opening photo…") {
            guard let jpeg = WebsitePhoto.jpegCopy(data) else { throw ERPAPI.Failure(status: 0, message: "Choose a readable photo.") }
            asset = .null; photo = jpeg; originalPhoto = jpeg; marked = false; savedID = nil
            try await layout(reset: true); tab = "make"
        }
    }
    func startPlay(_ play: MarketingValue) async {
        format = play.s("format"); template = play.s("template"); goal = play.s("goal"); brief = play.s("brief"); pair = play["pair"].bool; fields["details"] = play.s("cta")
        if !play.s("path").isEmpty, !House.isDemo {
            do { let config = try await MarketingRequest.get("/api/app/website"); if let base = URL(string: config.s("site")), let destination = URL(string: play.s("path"), relativeTo: base) { link = destination.absoluteString } } catch { self.error = error.localizedDescription }
        }
        if photo == nil { tab = "photos"; part = "picks" }
        else { await run("Preparing this play…") { try await layout(reset: true); tab = "make" } }
    }
    func layout(reset: Bool = false) async throws {
        let base = reset ? NativeArtwork.blank(photo: "photo", height: 1350) : doc
        let r = try await engine.run(doc: base, photos: photos, fields: fields, options: ["action": "ad", "value": template, "format": format, "custom": ["w": customWidth, "h": customHeight], "photoMarked": marked, "rates": rates.any])
        doc = r["doc"]; image = r
    }
    func preview() async {
        do { let r = try await engine.run(doc: doc, photos: photos, fields: fields); guard !Task.isCancelled else { return }; image = r } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func rendered(_ size: String? = nil, px: Int = 1080) async throws -> Data {
        var target = doc
        if let size, size != format {
            let r = try await engine.run(doc: NativeArtwork.blank(photo: "photo"), photos: photos, fields: fields, options: ["action": "ad", "value": template, "format": size, "photoMarked": marked, "rates": rates.any]); target = r["doc"]
        }
        let r = try await engine.run(doc: target, photos: photos, fields: fields, options: ["px": px])
        guard let bytes = Data(base64Encoded: r.s("image")) else { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn.") }
        return bytes
    }
    func aiParams() -> [String: Any] {
        ["name": asset.s("name"), "collection": asset.s("collection"), "specs": fields["weight"] ?? "", "price": price, "brief": brief, "format": format, "aspect": formatInfo.s("ai", "4:5"), "shape": formatInfo.s("label", format), "trimTo": formatInfo.s("short"), "destination": goal, "kicker": fields["kicker"] ?? "", "headline": fields["headline"] ?? "", "cta": fields["details"] ?? ""]
    }
    func imageAI(_ op: String, params: [String: Any] = [:]) async {
        guard let photo else { return }
        await run("Making a photo version…") {
            let r = try await MarketingRequest.ai(op, images: [photo], params: params)
            guard let bytes = Data(base64Encoded: r["image"].s("data")) else { throw ERPAPI.Failure(status: 0, message: "The AI returned no photo.") }
            painted = r
            if r["check"] != .null && !r["check"]["samePiece"].bool { said = "The check says the piece changed. Compare this version before choosing it." }
            else { self.photo = bytes; marked = false; try await layout() }
        }
    }
    func makeAI(paint: Bool) async {
        guard let photo else { return }
        await run(paint ? "Painting the ad…" : "Designing the ad…") {
            let bytes = try await WebsiteForm.send("/api/ads/studio/auto", fields: [("op", paint ? "paint" : "direct"), ("params", WebsiteForm.text(aiParams()))], files: [.init(field: "image", name: "photo.jpg", type: "image/jpeg", data: photo)], timeout: 300)
            let r = try JSONDecoder().decode(MarketingValue.self, from: bytes)
            if paint { painted = r; return }
            let d = r["direction"]; direction = d
            for (key, from) in [("kicker", "kicker"), ("headline", "headline"), ("details", "cta")] { if !d.s(from).isEmpty { fields[key] = d.s(from) } }
            if !d.s("layout").isEmpty { template = d.s("layout") }
            text = d["primaryText"].array.first?.string ?? text; headline = d["adHeadlines"].array.first?.string ?? headline
            copy = MarketingValue(["primaryText": d["primaryText"].any, "headlines": d["adHeadlines"].any, "why": d.s("why")])
            try await layout(reset: true)
        }
    }
    func usePainted() async {
        guard let bytes = Data(base64Encoded: painted["image"].s("data")) else { return }
        photo = bytes; marked = true; template = "clean"; painted = .null
        await run("Using this version…") { try await layout(reset: true) }
    }
    func writeWords() async {
        await run("Writing alternatives…") {
            var params = aiParams(); params["goal"] = goal
            copy = try await MarketingRequest.send("/api/ads/studio/copy", params)
            let words = copy["onImage"]
            for key in ["kicker", "headline", "details"] { if !words.s(key).isEmpty { fields[key] = words.s(key) } }
            text = copy["primaryText"].array.first?.string ?? text; headline = copy["headlines"].array.first?.string ?? headline
        }
    }
    func checkAd(start: String, days: Int) async {
        await run("Checking this ad…") {
            let image = try await rendered()
            let data = try await WebsiteForm.send("/api/ads/studio/check", fields: [("format", format), ("text", text), ("headline", headline), ("specs", fields["weight"] ?? ""), ("price", price), ("start", start), ("days", String(days))], files: [.init(field: "image", name: "ad.jpg", type: "image/jpeg", data: image)], timeout: 240)
            check = try JSONDecoder().decode(MarketingValue.self, from: data)
        }
    }
    func save(asNew: Bool) async {
        guard let photo else { return }
        await run("Saving the design…") {
            let output = try await rendered()
            let meta: [String: Any] = ["folder": folder.isEmpty ? NSNull() : folder as Any, "name": title, "format": format, "template": template, "fields": fields, "price": price, "text": text, "headline": headline, "goal": goal, "link": link, "asset": asset == .null ? NSNull() : ["id": asset.s("id"), "name": asset.s("name")] as Any]
            var pairs = [("meta", WebsiteForm.text(meta))]; if let savedID, !asNew { pairs.append(("id", savedID)) }
            let bytes = try await WebsiteForm.send("/api/ads/studio/saved", fields: pairs, files: [.init(field: "image", name: "ad.jpg", type: "image/jpeg", data: output), .init(field: "photo", name: "photo.jpg", type: "image/jpeg", data: photo), .init(field: "doc", name: "doc.json", type: "application/json", data: doc.data)])
            let r = try JSONDecoder().decode(MarketingValue.self, from: bytes); savedID = r["item"].s("id"); said = "Saved in Studio."
        }
    }
    func restore(_ item: MarketingValue) async {
        await run("Opening saved design…") {
            let id = item.s("id"), base = "/api/ads/studio/saved/" + AdsQuery.escape(id)
            photo = try await ERPAPI.shared.data(base + "?key=photo")
            doc = try JSONDecoder().decode(MarketingValue.self, from: await ERPAPI.shared.data(base + "?key=doc"))
            originalPhoto = photo; asset = item["asset"]; fields = item["fields"].object.mapValues(\.string)
            format = item.s("format", "portrait"); template = item.s("template", "clean"); price = item.s("price"); text = item.s("text"); headline = item.s("headline"); goal = item.s("goal", "whatsapp"); link = item.s("link"); savedID = id; folder = item.s("folder"); tab = "make"
        }
    }
    func newAd() async {
        await run("Preparing the ad…") {
            func upload(_ data: Data) async throws -> MarketingValue {
                let bytes = try await WebsiteForm.send("/api/ads/images", fields: [], files: [.init(field: "file", name: "ad.jpg", type: "image/jpeg", data: data)])
                return try JSONDecoder().decode(MarketingValue.self, from: bytes)
            }
            let output = try await rendered(); let up = try await upload(output)
            var vertical = MarketingValue.null
            if pair && ["portrait", "square"].contains(format) { vertical = try await upload(rendered("story")) }
            let key = UUID().uuidString
            StudioHandoffs.shared.ads[key] = MarketingValue(["photos": [["hash": up.s("hash"), "url": up["url"].any, "headline": headline.isEmpty ? title : headline, "link": link]], "vertical": vertical.any, "text": text, "headline": headline.isEmpty ? title : headline, "goal": goal, "link": link, "name": title + " · " + format])
            do { _ = try await MarketingRequest.send("/api/ads/studio/creatives", ["assets": asset.s("id").isEmpty ? [] : [asset.s("id")], "hash": up.s("hash"), "url": up["url"].any, "format": format, "name": title]) } catch { said = "The ad is ready; its Studio usage record could not be saved." }
            route = Route(path: "/ads/new?studio=" + key)
        }
    }
    func post() async {
        guard let photo else { return }
        await run("Preparing a post…") {
            var draft = NativePostDraft(); let p = NativePostPhoto(name: title, data: photo)
            draft.photos = [p]; draft.words["headline"] = .string(title); draft.words["caption"] = .string(text); draft.words["captionEdited"] = .bool(true)
            for (kind, size) in [("square", "square"), ("story", "story")] {
                let r = try await engine.run(doc: NativeArtwork.blank(photo: "photo"), photos: photos, fields: fields, options: ["action": "ad", "value": template, "format": size, "photoMarked": marked, "rates": rates.any])
                var target = r["doc"]; target["bg"]["photoId"] = .string(p.id)
                target["layers"] = .array(target["layers"].array.map { l in var copy = l; if copy.s("photoId") == "photo" { copy["photoId"] = .string(p.id) }; if !copy.s("bind").isEmpty { copy["text"] = .string(fields[copy.s("bind")] ?? ""); copy["bind"] = .null }; return copy })
                if kind == "square" { draft.square = target } else { draft.story = target }
            }
            let key = UUID().uuidString; StudioHandoffs.shared.posts[key] = draft
            route = Route(path: "/website/post?studio=" + key)
        }
    }
}

@MainActor final class StudioHandoffs {
    static let shared = StudioHandoffs()
    var ads: [String: MarketingValue] = [:]
    var posts: [String: NativePostDraft] = [:]
}
