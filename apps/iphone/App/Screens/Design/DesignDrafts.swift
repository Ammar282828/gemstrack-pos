import Foundation
import FirebaseAuth
#if canImport(UIKit)
import UIKit
#endif

/// A design in progress, kept on this phone (the web keeps it in IndexedDB `taheri-post-drafts`). Same way as the native Post a
/// piece drafts (NativePostDisk): atomic JSON files under Application Support, one folder per house and signed-in person,
/// 30 days. The photographs go in a file beside it, written only when they changed, so the 1.5-second autosave of a
/// design's words never rewrites megabytes.
struct DesignDraft: Codable, Identifiable, Equatable {
    var id: String
    var created: Date
    var updated: Date
    var title: String
    var thumb: Data?
    var work: DesignWork
}

actor DesignDraftDisk {
    private let folder: URL
    init(scope: String) {
        folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DesignDrafts-\(House.id)-\(scope)", isDirectory: true)
    }

    /// The same scope the Post a piece drafts use (PostComposerModel.load).
    @MainActor static func current() -> DesignDraftDisk { DesignDraftDisk(scope: DesignDraftDisk.scope()) }
    @MainActor static func scope() -> String { House.isDemo ? "demo" : (Businesses.shared.auth?.currentUser?.uid ?? "signed-out") }

    private func make() throws { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }

    func list() throws -> [DesignDraft] {
        try make()
        var out: [DesignDraft] = []
        for url in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) where url.pathExtension == "json" {
            guard let d = try? JSONDecoder().decode(DesignDraft.self, from: Data(contentsOf: url)) else { continue }
            if Date().timeIntervalSince(d.updated) > 30 * 86400 { remove(d.id) } else { out.append(d) }
        }
        return out.sorted { $0.updated > $1.updated }
    }

    func save(_ draft: DesignDraft, photos: [String: Data]?) throws {
        try make()
        let opts: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        if let photos { try JSONEncoder().encode(photos).write(to: folder.appendingPathComponent(draft.id + ".photos"), options: opts) }
        try JSONEncoder().encode(draft).write(to: folder.appendingPathComponent(draft.id + ".json"), options: opts)
    }

    func photos(_ id: String) -> [String: Data] {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(id + ".photos")),
              let map = try? JSONDecoder().decode([String: Data].self, from: data) else { return [:] }
        return map
    }

    func draft(_ id: String) -> DesignDraft? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(id + ".json")) else { return nil }
        return try? JSONDecoder().decode(DesignDraft.self, from: data)
    }

    func remove(_ id: String) {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(id + ".json"))
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(id + ".photos"))
    }
}

/// An earlier native Post a piece draft as a design (old-draft.ts, for the phone's `NativePostDraft`): the story becomes the
/// master page and the square the WhatsApp page, the lead photograph the design's own and the others its further photographs,
/// the words and the caption carry. A painted or lettered picture is not carried: the layout is.
enum DesignOldDraft {
    /// The draft's lead photograph: the story's background, else the first.
    static func hero(_ d: NativePostDraft) -> NativePostPhoto? {
        d.photos.first { $0.id == d.story["bg"].s("photoId") } ?? d.photos.first
    }

    static func convert(_ d: NativePostDraft) -> (work: DesignWork, photos: [String: Data])? {
        let formats = d.words.s("formats")
        let story = formats != "square", square = formats != "story"
        let storyHas = !d.story["layers"].array.isEmpty, squareHas = !d.square["layers"].array.isEmpty
        guard (story && storyHas) || (square && squareHas) else { return nil }
        let lead = hero(d)

        // The lead photograph is the design's "photo"; a document that named it by its own id now names it by that.
        func remap(_ doc: MarketingValue) -> MarketingValue {
            guard let lead else { return doc }
            var out = doc
            if out["bg"].s("photoId") == lead.id { out["bg"]["photoId"] = .string("photo") }
            out["layers"] = .array(out["layers"].array.map { l in
                var n = l
                if n.s("kind") == "image", n["src"] == .null, n.s("photoId") == lead.id { n["photoId"] = .string("photo") }
                return n
            })
            if out["placements"] != .null, out["placements"][lead.id] != .null {
                var p = out["placements"].object
                p["photo"] = p.removeValue(forKey: lead.id)
                out["placements"] = .object(p)
            }
            return out
        }

        var pages: [DesignPageState] = []
        if story {
            let z = DesignSizes.size("story")!
            pages.append(DesignPageState(id: "p1", label: z.label, format: z.format, w: z.w, h: d.story["frame"].n("h", z.h), origin: "master", syncedFrom: nil, rev: 0, doc: remap(d.story)))
        }
        if square {
            let z = DesignSizes.whatsapp
            pages.append(DesignPageState(id: DesignWork.nextPageId(pages), label: z.label, format: z.format, w: z.w, h: z.h, origin: pages.isEmpty ? "master" : "manual", syncedFrom: nil, rev: 0, doc: remap(d.square)))
        }
        guard !pages.isEmpty else { return nil }

        let weightText = d.words.s("weight").trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "g", with: "", options: .caseInsensitive)
        let weight = (Double(weightText) ?? 0) > 0 ? weightText + "g" + (d.words["weightEach"].bool ? " each" : "") : ""
        var fields = DesignWork.emptyFields()
        fields["headline"] = d.words.s("headline")
        fields["kicker"] = d.words.s("kicker")
        fields["weight"] = weight
        fields["details"] = [d.words.s("metal"), d.words.s("stones")].filter { !$0.isEmpty }.joined(separator: " | ")
        var copy: [String: String] = [:]
        if !d.words.s("caption").isEmpty { copy["wa"] = d.words.s("caption") }

        var photos: [String: Data] = [:]
        for p in d.photos {
            if p.id == lead?.id { photos["photo"] = p.data }
            else if DesignRecords.idOK(p.id) { photos[p.id] = p.data }
        }
        var work = DesignWork(id: nil, name: d.words.s("headline"), folder: nil, kind: "piece", scope: "shop", source: [:], fields: fields, copy: copy,
                              pages: pages, master: pages[0].id, active: pages[0].id, stale: [], fresh: false, dirty: true, template: "headline")
        if let site = lead?.source?.s("id"), !site.isEmpty { work.source["siteId"] = site }
        return (work, photos)
    }
}
