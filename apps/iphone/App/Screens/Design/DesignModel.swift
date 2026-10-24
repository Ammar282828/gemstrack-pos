import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// Design's records and rules, ported from the web (docs/features/design.md): src/lib/design/{model,sizes,gate}.ts
// and src/app/design/design-state.ts. A design is a master page and any number of other sizes (origin
// master | resized | manual); a page's layout is the engine's raw JSON (MarketingValue), never decoded into
// Swift fields, so whatever the web adds to a document survives a save from the phone.
// The sizes below are the web's table (lib/ads/studio/templates.ts AD_FORMATS + lib/design/sizes.ts): if the web adds
// a shape, add it here too (DesignSizes.all), or the phone will not offer it.

// MARK: Who sees what

/// `designGate('post' | 'ads')` (lib/design/gate.ts): post = owner, staff, marketing; ads = owner, marketing.
struct DesignAccess: Equatable {
    let role: String
    var post: Bool { role == "owner" || role == "staff" || role == "marketing" }
    /// The library with scores, the Board, the Ad kind: owner and marketing.
    var ads: Bool { role == "owner" || role == "marketing" }
}

enum DesignSection: String, CaseIterable, Identifiable {
    case make, photos, board, saved
    var id: String { rawValue }
    var title: String {
        switch self {
        case .make: return "Make"
        case .photos: return "Photos"
        case .board: return "Board"
        case .saved: return "Saved"
        }
    }
    /// design-state.ts SECTIONS: the Board is the ad studio's, so owner and marketing only.
    static func offered(_ access: DesignAccess) -> [DesignSection] { allCases.filter { access.ads || $0 != .board } }
    static func of(_ value: String?, _ access: DesignAccess) -> DesignSection { offered(access).first { $0.rawValue == value } ?? .make }
}

/// Photos' parts (design-state.ts PHOTO_PARTS): the website for everyone, the library for owner and marketing.
enum DesignPhotoPart: String, CaseIterable, Identifiable {
    case site, picks, library
    var id: String { rawValue }
    var title: String {
        switch self {
        case .site: return "The website"
        case .picks: return "Best for ads"
        case .library: return "Every photo"
        }
    }
    static func offered(_ access: DesignAccess) -> [DesignPhotoPart] { allCases.filter { access.ads || $0 == .site } }
    static func of(_ value: String?, _ access: DesignAccess) -> DesignPhotoPart { offered(access).first { $0.rawValue == value } ?? .site }
}

// MARK: Kinds

struct DesignKindCard: Identifiable {
    let kind: String
    let title: String
    let note: String
    /// DesignSizes ids the kind starts with.
    let sizes: [String]
    /// Owner and marketing only.
    var ads = false
    var id: String { kind }
}

enum DesignKinds {
    /// design-state.ts KIND_CARDS.
    static let cards: [DesignKindCard] = [
        DesignKindCard(kind: "piece", title: "A piece", note: "Story and post together", sizes: ["story", "whatsapp"]),
        DesignKindCard(kind: "post", title: "Post", note: "Square, for the feed", sizes: ["square"]),
        DesignKindCard(kind: "story", title: "Story", note: "9:16", sizes: ["story"]),
        DesignKindCard(kind: "whatsapp", title: "WhatsApp", note: "Square, for groups", sizes: ["whatsapp"]),
        DesignKindCard(kind: "site", title: "Website photo", note: "Square, for the site", sizes: ["website"]),
        DesignKindCard(kind: "ad", title: "Ad", note: "Meta’s feed sizes", sizes: ["portrait"], ads: true),
        DesignKindCard(kind: "custom", title: "Any size", note: "Your own W:H", sizes: ["square"]),
    ]
    static func card(_ kind: String) -> DesignKindCard { cards.first { $0.kind == kind } ?? cards[1] }
    static func label(_ kind: String) -> String {
        ["piece": "Piece", "ad": "Ad", "story": "Story", "post": "Post", "whatsapp": "WhatsApp", "site": "Website", "custom": "Custom"][kind] ?? "Design"
    }
    static func scope(_ kind: String) -> String { kind == "ad" ? "ads" : "shop" }
    static let valid: Set<String> = ["piece", "ad", "story", "post", "whatsapp", "site", "custom"]
}

// MARK: Sizes

struct DesignSize: Identifiable, Equatable {
    /// An ad format's key ("portrait"), or "whatsapp" / "website" / "custom".
    let id: String
    let label: String
    /// The ratio as people say it: "4:5", "1.91:1".
    let ratio: String
    let w: Double
    let h: Double
    /// Width of the exported picture.
    let px: Double
    /// The ad format whose frame this is ("custom" for the person's own).
    let format: String
    let meta: Bool
}

/// A size chosen on the start screen: a table id, or the person's own W:H.
struct DesignSizeChoice: Equatable {
    var id: String
    var customW = 4
    var customH = 5
    var size: DesignSize { id == "custom" ? DesignSizes.custom(customW, customH) : (DesignSizes.size(id) ?? DesignSizes.all[1]) }
}

struct DesignSizeGroup: Identifiable {
    let title: String
    let sizes: [DesignSize]
    var id: String { title }
}

enum DesignSizes {
    private static func fixed(_ id: String, _ label: String, _ ratio: String, _ h: Double, _ px: Double, meta: Bool = false) -> DesignSize {
        DesignSize(id: id, label: label, ratio: ratio, w: 1080, h: h, px: px, format: id, meta: meta)
    }
    /// Meta's four placements, in the web's order (AD_FORMAT_ORDER).
    static let feed: [DesignSize] = [
        fixed("portrait", "Feed 4:5", "4:5", 1350, 1080, meta: true),
        fixed("square", "Feed 1:1", "1:1", 1080, 1080, meta: true),
        fixed("story", "Stories & reels 9:16", "9:16", 1920, 1080, meta: true),
        fixed("landscape", "Link 1.91:1", "1.91:1", 565, 1200, meta: true),
    ]
    /// The seven more shapes (MORE_FORMAT_ORDER).
    static let more: [DesignSize] = [
        fixed("r2x3", "Tall 2:3", "2:3", 1620, 1080),
        fixed("r3x4", "Portrait 3:4", "3:4", 1440, 1080),
        fixed("r5x4", "Landscape 5:4", "5:4", 864, 1350),
        fixed("r4x3", "Landscape 4:3", "4:3", 810, 1440),
        fixed("r3x2", "Landscape 3:2", "3:2", 720, 1620),
        fixed("r16x9", "Wide 16:9", "16:9", 608, 1920),
        fixed("r21x9", "Banner 21:9", "21:9", 463, 2520),
    ]
    /// WhatsApp and the website only ever get 1:1 (the owner, 2026-09-25).
    static let whatsapp = DesignSize(id: "whatsapp", label: "WhatsApp 1:1", ratio: "1:1", w: 1080, h: 1080, px: 1600, format: "square", meta: false)
    static let website = DesignSize(id: "website", label: "Website 1:1", ratio: "1:1", w: 1080, h: 1080, px: 3000, format: "square", meta: false)

    static let all: [DesignSize] = feed + more + [whatsapp, website]
    static func size(_ id: String) -> DesignSize? { all.first { $0.id == id } }

    /// The start screen's groups, as GROUP_LABEL in start.tsx.
    static let groups: [DesignSizeGroup] = [
        DesignSizeGroup(title: "Feed ads", sizes: feed), DesignSizeGroup(title: "WhatsApp", sizes: [whatsapp]),
        DesignSizeGroup(title: "Website", sizes: [website]), DesignSizeGroup(title: "More shapes", sizes: more),
    ]

    private static func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? a : gcd(b, a % b) }
    static func reduce(_ w: Int, _ h: Int) -> (Int, Int) {
        let a = max(1, w), b = max(1, h), g = gcd(a, b)
        return (a / g, b / g)
    }
    /// A custom W:H as a frame 1080 wide, between 3:1 and 1:2.2 (templates.ts customFormat).
    static func custom(_ w: Int, _ h: Int) -> DesignSize {
        let (rw, rh) = reduce(min(10_000, max(1, w)), min(10_000, max(1, h)))
        let fh = max(360, min(2400, Int((1080.0 * Double(rh) / Double(rw)).rounded())))
        let px = fh < 1080 ? min(3240, Int((1080.0 * 1080.0 / Double(fh)).rounded())) : 1080
        return DesignSize(id: "custom", label: "Custom \(rw):\(rh)", ratio: "\(rw):\(rh)", w: 1080, h: Double(fh), px: Double(px), format: "custom", meta: false)
    }
    /// The website's own page is the catalogue's photograph (use-design.ts isCataloguePage).
    static func isCatalogue(label: String) -> Bool { label == website.label }
    /// Instagram covers a story's top and bottom bands (templates.ts safeZone).
    static func safeZone(h: Double) -> (top: Double, bottom: Double) { h >= 1800 ? ((h * 0.14).rounded(), (h * 0.35).rounded()) : (0, 0) }
}

// MARK: The design being made

struct DesignPageState: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var format: String
    var w: Double
    var h: Double
    /// master | resized | manual
    var origin: String
    /// The page a resized one was made from.
    var syncedFrom: String?
    var rev: Int
    var doc: MarketingValue
}

/// A page handed to `addPages` (the resize sheet, or one made for a destination).
struct NewDesignPage {
    var id: String?
    var label: String
    var format: String
    var w: Double
    var h: Double
    var doc: MarketingValue
    var origin = "resized"
    var syncedFrom: String?
}

/// design-state.ts `DesignWork`. Holds no pixels; the photographs live beside it in the workspace model.
struct DesignWork: Codable, Equatable {
    /// The saved design's id (`saved:<id>` for a legacy ad opened and not yet saved over); nil before the first save.
    var id: String?
    var name = ""
    var folder: String?
    var kind: String
    var scope: String
    /// siteId / productId / assetId
    var source: [String: String] = [:]
    /// kicker, headline, weight (the specs), details (the button line): shared by every page.
    var fields: [String: String]
    /// price, wa, ig, adText, adHeadline, goal, link
    var copy: [String: String] = [:]
    var pages: [DesignPageState]
    var master: String
    var active: String
    /// Resized pages whose master changed since they were made.
    var stale: [String] = []
    /// Waiting for its photo to lay the pages out.
    var fresh = false
    /// Changed since it was last saved to the shop.
    var dirty = false
    var template = "headline"

    static let fieldKeys = ["kicker", "headline", "weight", "details"]
    static func emptyFields() -> [String: String] { ["kicker": "", "headline": "", "weight": "", "details": ""] }

    var displayName: String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty { return n }
        let h = (fields["headline"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return h.isEmpty ? "Untitled design" : h
    }
    func page(_ id: String) -> DesignPageState? { pages.first { $0.id == id } }
    var activePage: DesignPageState { page(active) ?? pages[0] }
    var masterPage: DesignPageState { page(master) ?? pages[0] }

    // MARK: Starting

    static func nextPageId(_ pages: [DesignPageState]) -> String {
        var n = pages.count + 1
        while pages.contains(where: { $0.id == "p\(n)" }) { n += 1 }
        return "p\(n)"
    }

    /// The master's first size is the master, the others are made from it. Laid out once the photo is in.
    static func new(kind: String, sizes: [DesignSizeChoice], name: String = "", fields: [String: String] = [:],
                    source: [String: String] = [:], copy: [String: String] = [:], template: String = "headline") -> DesignWork {
        let chosen = sizes.isEmpty ? DesignKinds.card(kind).sizes.map { DesignSizeChoice(id: $0) } : sizes
        var pages: [DesignPageState] = []
        for c in chosen {
            let z = c.size
            pages.append(DesignPageState(
                id: nextPageId(pages), label: z.label, format: z.format, w: z.w, h: z.h,
                origin: pages.isEmpty ? "master" : "resized", syncedFrom: pages.isEmpty ? nil : pages[0].id, rev: 0, doc: blankDoc(w: z.w, h: z.h)))
        }
        var all = emptyFields()
        for (k, v) in fields where fieldKeys.contains(k) { all[k] = v }
        return DesignWork(id: nil, name: name, folder: nil, kind: kind, scope: DesignKinds.scope(kind), source: source, fields: all, copy: copy,
                          pages: pages, master: pages[0].id, active: pages[0].id, stale: [], fresh: true, dirty: false, template: template)
    }

    /// A blank page: the photo as its ground (templates.ts blankAd), `placements` empty as the web's.
    static func blankDoc(w: Double, h: Double) -> MarketingValue {
        let placement: [String: Any] = ["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5]
        let bg: [String: Any] = ["photoId": "photo", "placement": placement, "dim": 0, "gradient": "none", "color": "#EDE6DA"]
        let layers: [Any] = []
        let frame: [String: Any] = ["w": w, "h": h]
        let placements: [String: Any] = [:]
        return MarketingValue(["bg": bg, "layers": layers, "frame": frame, "placements": placements] as [String: Any])
    }

    // MARK: Edits (design-state.ts: editing the master marks the pages made from it stale; editing a made page makes it the person's own)

    /// The editor changed a page's document.
    mutating func editDoc(_ pageId: String, _ doc: MarketingValue) {
        guard let i = pages.firstIndex(where: { $0.id == pageId }), pages[i].doc != doc else { return }
        let isMaster = pageId == master
        pages[i].doc = doc
        pages[i].rev += 1
        if isMaster {
            for p in pages where p.origin == "resized" && p.syncedFrom == master && !stale.contains(p.id) { stale.append(p.id) }
        } else {
            pages[i].origin = "manual"
            stale.removeAll { $0 == pageId }
        }
        dirty = true
    }

    /// A document set from outside the editor (a layout, a re-do, a resize).
    mutating func setDoc(_ pageId: String, _ doc: MarketingValue, origin: String? = nil, syncedFrom: String? = nil) {
        guard let i = pages.firstIndex(where: { $0.id == pageId }) else { return }
        if let origin { pages[i].origin = origin }
        if let syncedFrom { pages[i].syncedFrom = syncedFrom }
        pages[i].doc = doc
        pages[i].rev += 1
        dirty = true
    }

    /// "Re-do from master" on a resized page: it takes the document made from the master and is in step again.
    mutating func redoFromMaster(_ pageId: String, _ doc: MarketingValue) {
        stale.removeAll { $0 == pageId }
        setDoc(pageId, doc, origin: "resized", syncedFrom: master)
    }

    /// Pages from the resize sheet: ids made unique, `resized` from the master unless it says.
    mutating func addPages(_ incoming: [NewDesignPage]) {
        guard !incoming.isEmpty else { return }
        for n in incoming where pages.count < 24 {
            var id = DesignWork.nextPageId(pages)
            if let wanted = n.id, DesignRecords.idOK(wanted), !pages.contains(where: { $0.id == wanted }) { id = wanted }
            let synced = n.syncedFrom ?? (n.origin == "resized" ? master : nil)
            pages.append(DesignPageState(id: id, label: String(n.label.prefix(60)), format: n.format, w: n.w, h: n.h, origin: n.origin, syncedFrom: synced, rev: 0, doc: n.doc))
        }
        active = pages[pages.count - 1].id
        dirty = true
    }

    mutating func removePage(_ pageId: String) {
        guard pages.count > 1, page(pageId) != nil else { return }
        let wasMaster = master == pageId
        pages.removeAll { $0.id == pageId }
        if wasMaster { master = pages[0].id }
        // A page made from the one that went has nothing to follow: it stands on its own.
        for i in pages.indices {
            if wasMaster && pages[i].id == master { pages[i].origin = "master"; pages[i].syncedFrom = nil }
            else if pages[i].syncedFrom == pageId { pages[i].origin = "manual"; pages[i].syncedFrom = nil }
        }
        if active == pageId { active = master }
        stale.removeAll { $0 == pageId || $0 == master }
        dirty = true
    }

    mutating func setActive(_ pageId: String) { if page(pageId) != nil { active = pageId } }

    /// Another page is the master: pages that followed the old one follow this, and are behind until re-done.
    mutating func setMaster(_ pageId: String) {
        guard pageId != master, page(pageId) != nil else { return }
        let old = master
        for i in pages.indices {
            if pages[i].id == pageId { pages[i].origin = "master"; pages[i].syncedFrom = nil }
            else if pages[i].id == old { pages[i].origin = "manual"; pages[i].syncedFrom = nil }
            else if pages[i].origin == "resized" && pages[i].syncedFrom == old { pages[i].syncedFrom = pageId }
        }
        master = pageId
        stale = pages.filter { $0.origin == "resized" && $0.syncedFrom == pageId }.map(\.id)
        dirty = true
    }

    /// The one-line state under a page in the strip (workspace.tsx PageStrip).
    func stripNote(_ p: DesignPageState) -> String {
        if p.id == master { return "Master" }
        if p.origin == "manual" { return "Edited" }
        return stale.contains(p.id) ? "Behind the master" : "From the master"
    }

    // MARK: The save's meta (lib/design/model.ts designInput: the cleaner the server passes it through)

    static func clip(_ s: String, _ n: Int) -> String { String(s.prefix(n)) }

    /// The `meta` part of POST /api/design/designs: exactly the fields the web sends (`toInput`).
    func meta(thumb: String) -> MarketingValue {
        var o: [String: Any] = [:]
        o["name"] = DesignWork.clip(displayName, 120)
        o["folder"] = folder.map { $0 as Any } ?? NSNull()
        o["kind"] = kind
        o["scope"] = scope
        if !source.isEmpty { o["source"] = source.mapValues { DesignWork.clip($0, 300) } }
        var f: [String: String] = [:]
        for k in DesignWork.fieldKeys { f[k] = DesignWork.clip(fields[k] ?? "", 300) }
        o["fields"] = f
        var c: [String: String] = [:]
        for (k, limit) in [("price", 40), ("wa", 2000), ("ig", 2200), ("adText", 2000), ("adHeadline", 200), ("link", 500)] {
            if let v = copy[k] { c[k] = DesignWork.clip(v, limit) }
        }
        // The goal is one of lib/ads/plan GOALS; the server drops any other.
        if let g = copy["goal"], !g.isEmpty { c["goal"] = g }
        o["copy"] = c
        o["pages"] = pages.map { p -> [String: Any] in
            var d: [String: Any] = ["id": p.id, "label": DesignWork.clip(p.label, 60), "format": p.format, "frame": ["w": Int(p.w.rounded()), "h": Int(p.h.rounded())], "origin": p.origin, "rev": max(0, p.rev)]
            if let s = p.syncedFrom { d["syncedFrom"] = s }
            return d
        }
        o["master"] = master
        o["thumb"] = thumb
        return MarketingValue(o)
    }

    // MARK: Opening a saved design

    /// A saved design opened: its record and each page's document (design-state.ts fromRecord).
    static func from(_ r: DesignRecord, docs: [String: MarketingValue]) -> DesignWork? {
        var pages: [DesignPageState] = []
        for p in r.pages {
            guard let doc = docs[p.id] else { return nil }
            pages.append(DesignPageState(id: p.id, label: p.label, format: p.format, w: p.w, h: p.h, origin: p.origin, syncedFrom: p.syncedFrom, rev: p.rev, doc: doc))
        }
        guard !pages.isEmpty else { return nil }
        let master = pages.contains { $0.id == r.master } ? r.master : pages[0].id
        var fields = emptyFields()
        for k in fieldKeys { if let v = r.fields[k] { fields[k] = v } }
        let template = pages.first { $0.id == master }?.doc["meta"].s("template") ?? ""
        return DesignWork(id: r.id, name: r.name, folder: r.folder, kind: r.kind, scope: r.scope, source: r.source, fields: fields, copy: r.copy,
                          pages: pages, master: master, active: master, stale: [], fresh: false, dirty: false, template: template.isEmpty ? "headline" : template)
    }
}

// MARK: The saved record (GET /api/design/designs → items[])

/// One `designs` record (lib/design/model.ts DesignRecord), read leniently from the server's JSON.
struct DesignRecord: Identifiable, Equatable {
    struct Page: Equatable {
        var id: String
        var label: String
        var format: String
        var w: Double
        var h: Double
        var origin: String
        var syncedFrom: String?
        var rev: Int
    }
    var id: String
    var name: String
    var folder: String?
    var kind: String
    var scope: String
    var source: [String: String]
    var fields: [String: String]
    var copy: [String: String]
    var pages: [Page]
    var master: String
    /// 'doc:<page>' | 'image:<page>' | 'photo:<id>' → parts.
    var files: [String: Int]
    /// A 200-px JPEG as a data URL, for the grid.
    var thumb: String
    var updated: String
    var by: String

    var isLegacy: Bool { id.hasPrefix("saved:") }
    /// Opening needs a layout for every page (a legacy ad saved without one cannot be opened again).
    var canOpen: Bool { files.keys.contains { $0.hasPrefix("doc:") } }

    init(_ v: MarketingValue) {
        id = v.s("id")
        name = v.s("name")
        folder = v["folder"] == .null || v.s("folder").isEmpty ? nil : v.s("folder")
        kind = v.s("kind", "post")
        scope = v.s("scope", "shop")
        func strings(_ x: MarketingValue) -> [String: String] {
            var out: [String: String] = [:]
            for (k, val) in x.object { if case .string(let s) = val { out[k] = s } }
            return out
        }
        source = strings(v["source"])
        fields = strings(v["fields"])
        copy = strings(v["copy"])
        pages = v["pages"].array.map { p in
            Page(id: p.s("id"), label: p.s("label"), format: p.s("format", "square"), w: p["frame"].n("w", 1080), h: p["frame"].n("h", 1080),
                 origin: p.s("origin", "master"), syncedFrom: p.s("syncedFrom").isEmpty ? nil : p.s("syncedFrom"), rev: Int(p.n("rev")))
        }
        master = v.s("master")
        var f: [String: Int] = [:]
        for (k, val) in v["files"].object { f[k] = Int(val.number) }
        files = f
        thumb = v.s("thumb")
        updated = v.s("updated")
        by = v.s("by")
    }

    /// The thumbnail's picture, decoded from its data URL.
    var thumbImage: UIImage? { DesignThumb.image(thumb) }
}

enum DesignThumb {
    static func image(_ dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ","), dataURL.hasPrefix("data:image/") else { return nil }
        guard let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

/// A folder of `ad_folders`, shared with Saved ads.
struct DesignFolder: Identifiable, Equatable {
    var id: String
    var name: String
    init(_ v: MarketingValue) { id = v.s("id"); name = v.s("name") }
}
