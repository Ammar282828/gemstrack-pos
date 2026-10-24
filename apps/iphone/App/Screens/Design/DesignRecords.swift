import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The Saved API, exactly as the web client calls it (src/app/design/{use-design,saved-shelf}.ts, src/app/api/design/designs/**):
///
///   GET    /api/design/designs                       → { folders: [{id,name,at}], items: [DesignRecord] }; the owner's and marketing's
///                                                      list adds ads-scope designs and the legacy `ad_saved` rows (id `saved:<id>`)
///   GET    /api/design/designs/<id>?key=doc:<page>   → that page's layout JSON ('image:<page>' the finished JPEG, 'photo:<id>' a photograph)
///   POST   /api/design/designs  (multipart)          → `meta` (JSON), [`id`], and the files 'doc:<page>', 'image:<page>', 'photo:<id>'
///   PATCH  /api/design/designs/<id>  { folder?, name? }
///   DELETE /api/design/designs/<id>                  (the web asks "Delete “name”?" and sends no code; the phone asks the same)
///   POST   /api/design/designs/folders { name } · PATCH { id, name } · DELETE ?id=
///
/// An id with a colon (`saved:abc`) travels escaped, as `encodeURIComponent` does.
@MainActor
enum DesignRecords {
    struct Opened {
        var work: DesignWork
        var photos: [String: Data]
    }

    /// lib/design/model.ts ID_OK: `^[\w-]{1,40}$`.
    nonisolated static func idOK(_ s: String) -> Bool {
        guard (1...40).contains(s.count) else { return false }
        return s.unicodeScalars.allSatisfy { c in
            (c.value >= 48 && c.value <= 57) || (c.value >= 65 && c.value <= 90) || (c.value >= 97 && c.value <= 122) || c == "_" || c == "-"
        }
    }

    static func base(_ id: String) -> String { "/api/design/designs/" + AdsQuery.escape(id) }

    static func list() async throws -> (folders: [DesignFolder], items: [DesignRecord]) {
        let answer = try await MarketingRequest.get("/api/design/designs")
        return (answer["folders"].array.map { DesignFolder($0) }, answer["items"].array.map { DesignRecord($0) })
    }

    /// One file of a design: a page's layout, its finished picture, or a photograph.
    static func file(_ id: String, _ key: String) async throws -> Data {
        try await ERPAPI.shared.data(base(id) + "?key=" + AdsQuery.escape(key))
    }

    /// use-design.ts openRecord: each page's layout, the photograph ('photo:photo'; a legacy ad's is 'photo:main'),
    /// and the further photographs the layouts use.
    static func open(_ r: DesignRecord) async throws -> Opened {
        var docs: [String: MarketingValue] = [:]
        for p in r.pages {
            let data: Data
            do { data = try await file(r.id, "doc:" + p.id) } catch { throw ERPAPI.Failure(status: 0, message: "This design has no layout saved to open again.") }
            docs[p.id] = try JSONDecoder().decode(MarketingValue.self, from: data)
        }
        var photos: [String: Data] = [:]
        if let main = try? await file(r.id, "photo:photo") { photos["photo"] = main }
        else if let legacy = try? await file(r.id, "photo:main") { photos["photo"] = legacy }
        for id in otherPhotoIds(Array(docs.values)) {
            if let data = try? await file(r.id, "photo:" + id) { photos[id] = data }
        }
        guard let work = DesignWork.from(r, docs: docs) else { throw ERPAPI.Failure(status: 0, message: "This design can’t be opened.") }
        return Opened(work: work, photos: photos)
    }

    /// The photographs these documents use besides the main one (use-design.ts otherPhotoIds).
    static func otherPhotoIds(_ docs: [MarketingValue]) -> [String] {
        var ids: Set<String> = []
        for d in docs {
            let bg = d["bg"].s("photoId")
            if !bg.isEmpty { ids.insert(bg) }
            for l in d["layers"].array where l.s("kind") == "image" && l["src"] == .null { ids.insert(l.s("photoId")) }
        }
        ids.remove("photo")
        return ids.filter { idOK($0) }.sorted()
    }

    /// Whether a document draws the photograph with this id (use-design.ts docUses).
    static func docUses(_ d: MarketingValue, _ id: String) -> Bool {
        d["bg"].s("photoId") == id || d["layers"].array.contains { $0.s("kind") == "image" && $0["src"] == .null && $0.s("photoId") == id }
    }

    /// A save: the same parts the web posts. `images` and `docs` are keyed by page id, `photos` by photograph id.
    static func save(meta: MarketingValue, id: String?, docs: [String: Data], images: [String: Data], photos: [String: Data]) async throws -> DesignRecord {
        var fields: [(String, String)] = [("meta", meta.text)]
        if let id, !id.isEmpty { fields.append(("id", id)) }
        var files: [WebsiteForm.File] = []
        for key in docs.keys.sorted() { files.append(.init(field: "doc:" + key, name: "doc.json", type: "application/json", data: docs[key]!)) }
        for key in images.keys.sorted() { files.append(.init(field: "image:" + key, name: "page.jpg", type: "image/jpeg", data: images[key]!)) }
        for key in photos.keys.sorted() { files.append(.init(field: "photo:" + key, name: "photo.jpg", type: "image/jpeg", data: photos[key]!)) }
        let bytes = try await WebsiteForm.send("/api/design/designs", fields: fields, files: files, timeout: 240)
        let answer = try JSONDecoder().decode(MarketingValue.self, from: bytes)
        guard !answer["item"].s("id").isEmpty else { throw ERPAPI.Failure(status: 0, message: "The ERP kept nothing. Try Save again.") }
        return DesignRecord(answer["item"])
    }

    /// File it, rename it.
    static func patch(_ id: String, folder: String??, name: String?) async throws {
        var body: [String: Any] = [:]
        if let folder { body["folder"] = folder.map { $0 as Any } ?? NSNull() }
        if let name { body["name"] = name }
        _ = try await ERPAPI.shared.send(base(id), method: "PATCH", body)
    }

    static func delete(_ id: String) async throws { _ = try await ERPAPI.shared.send(base(id), method: "DELETE") }

    static func createFolder(_ name: String) async throws -> DesignFolder {
        let answer = try await MarketingRequest.send("/api/design/designs/folders", ["name": name])
        return DesignFolder(answer["folder"])
    }
    static func renameFolder(_ id: String, _ name: String) async throws {
        _ = try await ERPAPI.shared.send("/api/design/designs/folders", method: "PATCH", ["id": id, "name": name])
    }
    static func deleteFolder(_ id: String) async throws {
        _ = try await ERPAPI.shared.data("/api/design/designs/folders?id=" + AdsQuery.escape(id), method: "DELETE")
    }
}
