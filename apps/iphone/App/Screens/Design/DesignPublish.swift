import SwiftUI
import Observation
import UIKit

// The Publish sheet's engine (src/app/design/publish-sheet.tsx, lib/design/{destinations,publish}.ts), ported line for line: the rows come from
// GET /api/design/destinations (a place the house or the role lacks is a row with its reason), each place says which picture it needs
// (WhatsApp and the website only ever get 1:1: "Make 1:1 from this"), and the send is a plan of STEPS run one at a time. A step that went
// leaves its result in `memory` and is never run again, so Retry runs only what failed and a group is never posted twice. Every success is
// noted on the saved design (PATCH { published }).
//
// The senders are the app's own, where it has them (WebsiteForm for the multipart routes the Add photos and Post a piece screens use,
// MarketingRequest / ERPAPI for JSON, WebsiteStore for the set of the day, StudioHandoffs for the Meta ad's hand-off to New ad, the queue's
// routes as Post a piece and the Board call them). The route and the fields are the web client's:
//   website        POST /api/website/photos        folder, name, file            -> { rel }
//   set of the day PUT  /api/website/featured      { key: rel }                  (WebsiteStore.feature)
//   WhatsApp       POST /api/website/post          file, caption, targets=<key>, sitePiece   (one step per place; the community twin mirrors)
//   story          POST /api/instagram/story       file                          (Mina: the share sheet)
//   feed post      POST /api/instagram/post        file, caption                 (Mina: the share sheet)
//   Meta ad        POST /api/ads/images (file) -> hash/url, POST /api/ads/studio/creatives, then StudioHandoffs -> /ads/new?studio=
//   replace photo  POST /api/website/edits         id, file, stamped, design, shape=own, ai=[]
//   queue          POST /api/website/post/queue (+ /<id> files, PATCH ready, PATCH schedule), DELETE the half-made entry on failure
//   save           the workspace's own Save (POST /api/design/designs)

/// lib/design/destinations.ts, for pages.
enum DesignDestinations {
    static let order = ["website", "featured", "whatsapp", "channel", "instagram-story", "instagram-post", "meta-ad", "site-replace"]
    /// What each place takes: the ratio and the width it is drawn at (for "any", the longest side it may have).
    static let needs: [String: (ratio: String, maxPx: Int)] = [
        "website": ("1:1", 3000), "featured": ("1:1", 3000), "whatsapp": ("1:1", 1600), "channel": ("1:1", 1600),
        "instagram-story": ("9:16", 1080), "instagram-post": ("1:1", 1440), "meta-ad": ("any", 2160), "site-replace": ("any", 3000),
    ]
    /// sizes.ts DEST_SIZE.
    static let sizeId: [String: String] = [
        "website": "website", "featured": "website", "whatsapp": "whatsapp", "channel": "whatsapp", "instagram-story": "story",
        "instagram-post": "square", "meta-ad": "portrait", "site-replace": "website",
    ]
    static let ownPage: Set<String> = ["website", "featured", "site-replace"]

    static func size(for dest: String) -> DesignSize? { sizeId[dest].flatMap { DesignSizes.size($0) } }

    static func matches(_ p: DesignPageState, _ ratio: String) -> Bool {
        switch ratio {
        case "1:1": return abs(p.w / max(1, p.h) - 1) < 0.01
        case "9:16": return abs(p.w / max(1, p.h) - 9.0 / 16.0) < 0.01
        default: return true
        }
    }

    /// The page a place takes: the master when it fits, else the first that does; none gives the size to make. The website takes the page
    /// made for it ("Website 1:1", the catalogue stamp) before any other square.
    static func pageFor(_ pages: [DesignPageState], master: String, _ dest: String) -> (page: DesignPageState?, missing: DesignSize?) {
        let ratio = needs[dest]?.ratio ?? "any"
        let fits = pages.filter { matches($0, ratio) }
        let own = ownPage.contains(dest) ? fits.first { $0.label == size(for: dest)?.label } : nil
        if let page = own ?? fits.first(where: { $0.id == master }) ?? fits.first { return (page, nil) }
        return (nil, size(for: dest))
    }

    static func storyPage(_ pages: [DesignPageState]) -> DesignPageState? { pages.first { matches($0, "9:16") } }

    static func outputPx(_ dest: String, _ page: DesignPageState) -> Int {
        guard let n = needs[dest] else { return 1080 }
        if n.ratio != "any" { return n.maxPx }
        return min(n.maxPx, Int(DesignSizes.size(page.format)?.px ?? 1080))
    }

    /// Places that want a story-shaped picture etc. are known by their rows; this is the caption each takes.
    static func slug(_ s: String) -> String {
        let cleaned = s.replacingOccurrences(of: "[^\\w\\s-]+", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        let cut = String(cleaned.prefix(60))
        return cut.isEmpty ? "design" : cut
    }

    static func isMaisonFolder(_ folder: String) -> Bool { folder == "The Maisons" || folder.hasSuffix("/The Maisons") }
}

@MainActor
@Observable
final class DesignPublishModel {
    struct Target: Hashable {
        let key: String
        let label: String
    }
    struct Row: Identifiable {
        let id: String
        let label: String
        let available: Bool
        let reason: String?
        /// Instagram rows: "api" (the house's connection) or "share" (the phone's share sheet).
        let mode: String?
        let targets: [Target]
        let connectable: Bool
        init(_ v: MarketingValue) {
            id = v.s("id")
            label = v.s("label")
            available = v["available"].bool
            reason = v.s("reason").isEmpty ? nil : v.s("reason")
            mode = v.s("mode").isEmpty ? nil : v.s("mode")
            targets = v["targets"].array.map { Target(key: $0.s("key"), label: $0.s("label")) }
            connectable = v["connectable"].bool
        }
    }
    struct SiteCollection: Identifiable, Hashable {
        let folder: String
        let category: String
        let collection: String
        var id: String { folder }
        var title: String { category == collection ? collection : "\(category) · \(collection)" }
    }
    enum Status { case waiting, running, done, failed, manual }
    struct StepState {
        var status: Status = .waiting
        var error: String?
    }
    struct Step {
        let id: String
        let dest: String
        let label: String
        var after: [String] = []
        /// Not run by `run()`: it waits for the person's own tap (the phone's share sheet).
        var manual = false
        /// For a manual step: the picture to hand to the share sheet.
        var share: (() async throws -> (data: Data, name: String))?
        let run: () async throws -> String
    }
    struct Missing {
        let dest: String
        let size: DesignSize
        var label: String { "Make \(size.ratio) from this" }
    }

    let model: DesignWorkspaceModel

    // What the server says
    private(set) var rows: [Row] = []
    private(set) var collections: [SiteCollection] = []
    private(set) var loaded = false
    var loadError: String?
    private(set) var config = MarketingValue.null
    private(set) var checks: [MarketingValue] = []
    private(set) var healthLoading = true
    var healthFailed: String?

    // The choices
    var folder = ""
    var websiteOn: Bool
    var featured = false
    var siteName = ""
    var renaming = false
    var house = ""
    var waOn: Bool
    var waKeys: [String] = []
    var storyOn: Bool
    var postOn: Bool
    var metaOn: Bool
    var replaceOn = false
    var saveOn = false
    /// "now" | "hold" | "schedule"
    var when = "now"
    var due = Date().addingTimeInterval(3600)
    var wa: String
    var ig: String
    var adText: String
    var adHeadline: String

    // The send
    private(set) var memory: [String: String]
    private(set) var states: [String: StepState] = [:]
    var busy = false
    var confirming = false
    var aiBusy = false
    var note: String?
    var wordIssues: [String] = []
    /// Bumped on a whole send that went and on a refusal: the sheet's haptics (moneyFeedback).
    var sent = 0
    var failures = 0
    var finished = false
    var metaPath: String?
    @ObservationIgnored private var seeded = false
    @ObservationIgnored private let memoryKey: String
    @ObservationIgnored private var cache: [String: Data] = [:]

    init(model: DesignWorkspaceModel) {
        self.model = model
        let w = model.work
        let kind = w?.kind ?? "post"
        let d = Self.defaults(kind)
        websiteOn = d.website; waOn = d.wa; storyOn = d.story; postOn = d.post; metaOn = d.meta
        wa = w?.copy["wa"] ?? ""
        ig = w?.copy["ig"] ?? ""
        adText = w?.copy["adText"] ?? ""
        adHeadline = w?.copy["adHeadline"] ?? (w?.fields["headline"] ?? "")
        let key = "design.publish." + (w?.id ?? w?.displayName ?? "design")
        memoryKey = key
        memory = (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
    }

    /// What each kind of design ticks to begin with; the person changes it.
    static func defaults(_ kind: String) -> (website: Bool, wa: Bool, story: Bool, post: Bool, meta: Bool) {
        switch kind {
        case "piece": return (true, true, true, false, false)
        case "story": return (false, false, true, false, false)
        case "post": return (false, true, false, true, false)
        case "whatsapp": return (false, true, false, false, false)
        case "site": return (true, false, false, false, false)
        case "ad": return (false, false, false, false, true)
        default: return (false, false, false, false, false)
        }
    }

    var work: DesignWork? { model.work }
    var pages: [DesignPageState] { model.work?.pages ?? [] }
    var fromSite: Bool { !(model.work?.source["siteId"] ?? "").isEmpty }
    var sitePiece: String? { fromSite ? model.work?.source["siteId"] : nil }

    func row(_ id: String) -> Row? { rows.first { $0.id == id } }
    func ok(_ id: String) -> Bool { row(id)?.available == true }
    func igMode(_ id: String) -> String { row(id)?.mode ?? "share" }
    var siteLink: String { work?.copy["link"].flatMap { $0.isEmpty ? nil : $0 } ?? config.s("site") }
    var isMaison: Bool { DesignDestinations.isMaisonFolder(folder) }

    // MARK: Loading

    func load() async {
        do {
            let d = try await MarketingRequest.get("/api/design/destinations?collections=1" + (fromSite ? "&fromSite=1" : ""))
            rows = d["rows"].array.map { Row($0) }
            collections = d["collections"].array.map { SiteCollection(folder: $0.s("folder"), category: $0.s("category"), collection: $0.s("collection")) }
            seed()
            loaded = true
        } catch {
            loadError = error.localizedDescription
        }
        config = (try? await MarketingRequest.get("/api/app/website")) ?? .null
        await WebsiteStore.shared.loadSettings()
        await refreshHealth()
    }

    /// The remembered collection and WhatsApp places, once the rows say what exists.
    private func seed() {
        let last = UserDefaults.standard.string(forKey: "taheri_post_folder") ?? ""
        if !last.isEmpty, collections.contains(where: { $0.folder == last }) { folder = last }
        let all = (row("whatsapp")?.targets ?? []) + (row("channel")?.targets ?? [])
        let wanted = (UserDefaults.standard.string(forKey: "design_wa_targets") ?? "").split(separator: ",").map(String.init).filter { k in all.contains { $0.key == k } }
        waKeys = wanted.isEmpty ? Array((row("whatsapp")?.targets ?? []).prefix(1)).map(\.key) + (row("channel")?.targets ?? []).map(\.key) : wanted
        if !ok("website") { websiteOn = false }
        if !ok("whatsapp") && !ok("channel") { waOn = false }
        if !ok("meta-ad") { metaOn = false }
        seeded = true
    }

    /// The collection and the WhatsApp places are remembered on this device, as the web's sheet does.
    func remember() {
        guard seeded else { return }
        if !folder.isEmpty { UserDefaults.standard.set(folder, forKey: "taheri_post_folder") }
        if !waKeys.isEmpty { UserDefaults.standard.set(waKeys.joined(separator: ","), forKey: "design_wa_targets") }
    }

    func refreshHealth() async {
        healthLoading = true
        do {
            let r = try await MarketingRequest.get("/api/website/post/health")
            checks = r["checks"].array
            healthFailed = nil
        } catch { healthFailed = "The checks could not run. " + error.localizedDescription }
        healthLoading = false
    }

    // MARK: Choices → steps

    private func label(of key: String) -> String {
        if key == "channel" { return "WhatsApp channel" }
        return "WhatsApp · " + (((row("whatsapp")?.targets ?? []) + (row("channel")?.targets ?? [])).first { $0.key == key }?.label ?? key)
    }

    /// The WhatsApp places that are on, held to what the house has.
    var whatsappChoice: [String] {
        waOn ? waKeys.filter { $0 == "channel" ? ok("channel") : ok("whatsapp") } : []
    }
    var websiteOK: Bool { websiteOn && ok("website") && !folder.isEmpty }

    func pick(_ dest: String) -> (page: DesignPageState?, missing: DesignSize?) { DesignDestinations.pageFor(pages, master: work?.master ?? "", dest) }
    func missing(_ dest: String) -> Missing? { pick(dest).missing.map { Missing(dest: dest, size: $0) } }

    /// "Make 1:1 from this": the page for a destination's shape, by the resize engine (or the catalogue's own for the website).
    func make(_ m: Missing) async {
        await model.makeSize(m.size.id)
        cache = [:]
    }

    private func picture(_ pageId: String, _ px: Int) async throws -> Data {
        let key = "\(pageId)@\(px)"
        if let c = cache[key] { return c }
        let data = try await model.render(pageId: pageId, px: px)
        cache[key] = data
        return data
    }

    private func morePicture(_ pageId: String, _ photoId: String, _ px: Int) async throws -> Data {
        let key = "\(pageId)@\(px)#\(photoId)"
        if let c = cache[key] { return c }
        let data = try await model.renderWith(pageId: pageId, photoId: photoId, px: px)
        cache[key] = data
        return data
    }

    private func siteBase() -> String { (siteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (work?.fields["headline"] ?? "") : siteName).trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The files the site sees: "Bangle and Ring.jpg", a Maisons piece "<House> — <Model>.jpg" (the bundled engine's own names).
    private func siteNames(count: Int) async throws -> [String] {
        let name = siteBase().isEmpty ? (work?.displayName ?? "design") : siteBase()
        let r = try await model.engine.run(doc: NativeArtwork.blank(photo: nil, height: 1080), photos: [:], fields: work?.fields ?? [:],
                                           options: ["px": 120, "name": name, "count": max(1, count), "folder": folder, "maisonHouse": house])
        let names = r["names"].array.map(\.string)
        guard names.count >= count else { throw ERPAPI.Failure(status: 0, message: "The website names could not be made.") }
        return names
    }

    var queued: Bool { when != "now" }

    struct Plan {
        var steps: [Step]
        var missing: [Missing]
    }

    /// publish.ts buildPlan.
    func plan() -> Plan {
        guard let w = work else { return Plan(steps: [], missing: []) }
        var steps: [Step] = []
        var missing: [Missing] = []
        let base = DesignDestinations.slug(w.fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? w.displayName)
        let master = w.master
        func pageOf(_ dest: String) -> DesignPageState? {
            let p = DesignDestinations.pageFor(w.pages, master: master, dest)
            if let page = p.page { return page }
            if let size = p.missing, !missing.contains(where: { $0.dest == dest }) { missing.append(Missing(dest: dest, size: size)) }
            return nil
        }
        let moreIds = model.moreIds
        let extras = Array(0..<moreIds.count).map { $0 + 1 }
        let wa = whatsappChoice.filter { $0 != "channel" }
        let channel = whatsappChoice.contains("channel")
        let website = websiteOK ? pageOf("website") : nil
        let waPage: DesignPageState? = (!wa.isEmpty || channel) ? pageOf(wa.isEmpty ? "channel" : "whatsapp") : nil
        let storyDest = storyOn ? pageOf("instagram-story") : nil
        let postDest = postOn ? pageOf("instagram-post") : nil
        let metaDest = metaOn && ok("meta-ad") ? pageOf("meta-ad") : nil
        let replaceDest: DesignPageState? = (replaceOn && ok("site-replace") && sitePiece != nil) ? pageOf("site-replace") : nil
        let featuredPage = websiteOK && featured && ok("featured") ? website : nil
        let q = queued
        let folder = self.folder
        let wasFeatured = featuredPage != nil

        if saveOn {
            steps.append(Step(id: "save", dest: "save", label: "Save the design", run: { [self] in
                guard let record = await model.saveToShop() else {
                    let why = model.error ?? "The design could not be saved."
                    model.error = nil
                    throw ERPAPI.Failure(status: 0, message: why)
                }
                return record.id
            }))
        }

        let storyQueued = q && igMode("instagram-story") == "api" ? storyDest : nil

        if !q, let website {
            let count = 1 + extras.count
            steps.append(Step(id: "website", dest: "website", label: "Website", run: { [self] in
                let names = try await siteNames(count: count)
                return try await DesignSend.website(try await picture(website.id, DesignDestinations.outputPx("website", website)), folder: folder, name: names[0])
            }))
            for i in extras {
                steps.append(Step(id: "website:\(i)", dest: "website", label: "Website · photo \(i + 1)", after: ["website"], run: { [self] in
                    let names = try await siteNames(count: count)
                    return try await DesignSend.website(try await morePicture(website.id, moreIds[i - 1], DesignDestinations.outputPx("website", website)), folder: folder, name: names[i])
                }))
            }
            if wasFeatured {
                steps.append(Step(id: "featured", dest: "featured", label: "Set of the day", after: ["website"], run: { [self] in
                    guard let rel = memory["website"] else { throw ERPAPI.Failure(status: 0, message: "The website photo has not gone yet.") }
                    try await WebsiteStore.shared.feature(rel)
                    return rel
                }))
            }
        }
        if let storyDest, storyQueued == nil {
            let manual = igMode("instagram-story") == "share"
            steps.append(Step(id: "instagram-story", dest: "instagram-story", label: "Instagram story", manual: manual,
                              share: { [self] in (try await picture(storyDest.id, DesignDestinations.outputPx("instagram-story", storyDest)), base + "-story.jpg") },
                              run: { [self] in try await DesignSend.story(try await picture(storyDest.id, DesignDestinations.outputPx("instagram-story", storyDest))) }))
        }
        // Each place its own step, so one that fails is retried alone: never a group twice.
        if !q, let waPage {
            let caption = self.wa
            let sp = sitePiece
            for key in wa + (channel ? ["channel"] : []) {
                let dest = key == "channel" ? "channel" : "whatsapp"
                steps.append(Step(id: "wa:\(key)", dest: dest, label: label(of: key), run: { [self] in
                    // 1600 px: WhatsApp makes no preview for images over 3000 px and shrinks everything to about this anyway.
                    try await DesignSend.whatsapp(key: key, try await picture(waPage.id, DesignDestinations.outputPx("whatsapp", waPage)), name: base + ".jpg", caption: caption, sitePiece: sp)
                }))
                for i in extras {
                    steps.append(Step(id: "wa:\(key):\(i)", dest: dest, label: label(of: key) + " · photo \(i + 1)", after: ["wa:\(key)"], run: { [self] in
                        try await DesignSend.whatsapp(key: key, try await morePicture(waPage.id, moreIds[i - 1], DesignDestinations.outputPx("whatsapp", waPage)), name: "\(base)-\(i + 1).jpg", caption: "", sitePiece: sp)
                    }))
                }
            }
        }
        if q, website != nil || waPage != nil || storyQueued != nil {
            // One queue entry carries the website, WhatsApp and story sends; the tick (or "send now") makes them, and retries only what failed.
            let dueAt: String? = when == "schedule" ? due.ISO8601Format() : nil
            let caption = self.wa
            let keys = waPage != nil ? wa + (channel ? ["channel"] : []) : []
            let count = 1 + extras.count
            let sp = sitePiece
            steps.append(Step(id: "queue", dest: "queue", label: dueAt != nil ? "Schedule in the post queue" : "Hold in the post queue", run: { [self] in
                var images: [String: Data] = [:]
                if let website { images["site-0"] = try await picture(website.id, DesignDestinations.outputPx("website", website)) }
                if let waPage { images["wa-0"] = try await picture(waPage.id, DesignDestinations.outputPx("whatsapp", waPage)) }
                for i in extras {
                    if let website { images["site-\(i)"] = try await morePicture(website.id, moreIds[i - 1], DesignDestinations.outputPx("website", website)) }
                    if let waPage { images["wa-\(i)"] = try await morePicture(waPage.id, moreIds[i - 1], DesignDestinations.outputPx("whatsapp", waPage)) }
                }
                if let storyQueued { images["story"] = try await picture(storyQueued.id, DesignDestinations.outputPx("instagram-story", storyQueued)) }
                let lead = website ?? waPage ?? storyQueued
                var thumb: Data?
                if let lead { thumb = try? await picture(lead.id, 240) }
                var names: [String] = []
                if website != nil { names = try await siteNames(count: count) }
                return try await DesignSend.queue(headline: w.fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? w.displayName, caption: caption, fileBase: base, sitePiece: sp,
                                                  website: website != nil ? (folder: folder, names: names, featured: wasFeatured) : nil, whatsapp: keys, count: count,
                                                  images: images, thumb: thumb, dueAt: dueAt)
            }))
        }
        // A feed post is never queued (the queue carries stories): it goes now, whichever way the rest goes.
        if let postDest {
            let caption = ig
            steps.append(Step(id: "instagram-post", dest: "instagram-post", label: "Instagram post", manual: igMode("instagram-post") == "share",
                              share: { [self] in (try await picture(postDest.id, DesignDestinations.outputPx("instagram-post", postDest)), base + "-post.jpg") },
                              run: { [self] in try await DesignSend.post(try await picture(postDest.id, DesignDestinations.outputPx("instagram-post", postDest)), caption: caption) }))
        }
        if let metaDest {
            let text = adText.isEmpty ? [w.fields["headline"], w.fields["weight"], w.fields["details"]].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n") : adText
            let headline = adHeadline.isEmpty ? (w.fields["headline"] ?? "") : adHeadline
            let goal = w.copy["goal"].flatMap { $0.isEmpty ? nil : $0 } ?? "whatsapp"
            let link = siteLink
            steps.append(Step(id: "meta-ad", dest: "meta-ad", label: "Meta ad", run: { [self] in
                // One ad, both sizes: a feed-shaped main picture gets the 9:16 page as its second asset.
                let feed = metaDest.format == "portrait" || metaDest.format == "square"
                var vertical: Data?
                if feed, let story = DesignDestinations.storyPage(w.pages) { vertical = try await picture(story.id, 1080) }
                let main = try await picture(metaDest.id, DesignDestinations.outputPx("meta-ad", metaDest))
                return try await DesignSend.metaAd(main: main, vertical: vertical, name: w.displayName, headline: headline, text: text, goal: goal, link: link, format: metaDest.format)
            }))
        }
        if let replaceDest, let sp = sitePiece {
            let stamped = model.marked
            steps.append(Step(id: "site-replace", dest: "site-replace", label: "Replace the photo on the website", run: { [self] in
                try await DesignSend.siteReplace(id: sp, try await picture(replaceDest.id, DesignDestinations.outputPx("site-replace", replaceDest)), stamped: stamped, doc: replaceDest.doc)
            }))
        }
        return Plan(steps: steps, missing: missing)
    }

    // MARK: Reading the state

    func state(_ s: Step) -> StepState {
        if memory[s.id] != nil { return StepState(status: .done) }
        return states[s.id] ?? StepState(status: s.manual ? .manual : .waiting)
    }

    func ref(_ id: String) -> String? { memory[id] }

    /// Problems that stop a send before it starts.
    func problems(_ p: Plan) -> [String] {
        var out: [String] = []
        if websiteOn && ok("website") && folder.isEmpty { out.append("Choose a website collection, or switch the website off.") }
        if websiteOn && ok("website") && isMaison && house.isEmpty { out.append("Choose the piece’s house for The Maisons.") }
        if waOn && ok("whatsapp") && whatsappChoice.isEmpty { out.append("Choose a WhatsApp group or the channel, or switch WhatsApp off.") }
        if when == "schedule" && due <= Date() { out.append("Choose a time to send it.") }
        if p.steps.isEmpty && p.missing.isEmpty { out.append("Choose where it goes.") }
        return out
    }

    /// The house rules on the words about to go out (the bundled engine's wordProblems): sale words, hashtags, figures the specs don't give.
    func checkWords() async {
        let texts: [String: Any] = [
            "WhatsApp caption": whatsappChoice.isEmpty ? "" : wa, "Instagram caption": postOn ? ig : "",
            "ad text": metaOn && ok("meta-ad") ? adText : "", "ad headline": metaOn && ok("meta-ad") ? adHeadline : "",
        ]
        guard texts.values.contains(where: { !(($0 as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty }) else { wordIssues = []; return }
        do {
            let r = try await model.engine.run(doc: NativeArtwork.blank(photo: nil, height: 1080), photos: [:], fields: [:], options: ["action": "words", "px": 120, "texts": texts, "facts": work?.fields["weight"] ?? ""])
            wordIssues = r["problems"].array.map(\.string)
        } catch { wordIssues = [] }
    }

    func failingGroups(_ p: Plan) -> [String] {
        var groups: [String] = []
        for s in p.steps where memory[s.id] == nil {
            let g: String?
            switch s.dest {
            case "website", "featured", "site-replace": g = "Website"
            case "whatsapp", "channel": g = "WhatsApp"
            case "instagram-story", "instagram-post": g = "Instagram"
            default: g = nil
            }
            if let g, !groups.contains(g), checks.contains(where: { $0.s("status") == "fail" && $0.s("group") == g }) { groups.append(g) }
        }
        return groups
    }

    // MARK: Running

    private func saveMemory() { UserDefaults.standard.set(memory, forKey: memoryKey) }

    /// Runs what is left. A step with a result in `memory` is done and skipped; a manual step waits for the person; a step whose `after`
    /// has no result fails without running; the others run one at a time, each result going into `memory` before the next begins. A failure
    /// does not stop the rest. Called again, it retries only the failures (or just `only`).
    func run(only: String? = nil) async {
        busy = true; confirming = false; note = nil
        let p = plan()
        var failed = false
        for step in p.steps {
            if let only, step.id != only { continue }
            if memory[step.id] != nil || step.manual { continue }
            if let blocked = step.after.first(where: { memory[$0] == nil }) {
                states[step.id] = StepState(status: .failed, error: "\(p.steps.first { $0.id == blocked }?.label ?? "The step before it") has not gone yet.")
                failed = true
                continue
            }
            states[step.id] = StepState(status: .running)
            do {
                let ref = try await step.run()
                memory[step.id] = ref.isEmpty ? "sent" : ref
                saveMemory()
                states[step.id] = StepState(status: .done)
                if step.id == "meta-ad" { metaPath = memory[step.id] }
                if step.id != "save" { await model.recordPublish(dest: step.id, ok: true, ref: memory[step.id]) }
            } catch {
                states[step.id] = StepState(status: .failed, error: error.localizedDescription)
                failed = true
            }
        }
        busy = false
        if failed { failures += 1 }
        let left = plan().steps.filter { memory[$0.id] == nil }
        if !left.isEmpty || failed { await refreshHealth() }
        if left.isEmpty && !p.steps.isEmpty && !failed {
            sent += 1
            finished = true
            if model.work?.id != nil { model.finish() }
            model.say("Sent", detail: "Everything you chose has gone.")
        }
    }

    /// The person did the step themselves (shared the story from the phone).
    func markDone(_ id: String, _ ref: String = "shared") {
        memory[id] = ref
        saveMemory()
        states[id] = StepState(status: .done)
        Task { await model.recordPublish(dest: id, ok: true, ref: ref) }
    }

    func forgetAll() {
        memory = [:]
        states = [:]
        saveMemory()
        finished = false
    }

    // MARK: Words and pictures to hand over

    /// Both captions, written from the picture (the same op Post a piece's caption writer calls).
    func writeCaptions() async {
        guard let w = work, let page = pages.first(where: { $0.id == w.master }) ?? pages.first else { return }
        aiBusy = true; note = nil
        defer { aiBusy = false }
        do {
            let image = try await model.render(pageId: page.id, px: 1024)
            let numbers = config["posting"]["whatsappNumbers"].array.map(\.string)
            let r = try await MarketingRequest.ai("caption", images: [image], params: [
                "headline": w.fields["headline"] ?? "", "weight": w.fields["weight"] ?? "", "metal": "", "stones": "",
                "collection": folder.split(separator: "/").dropFirst().first.map(String.init) ?? "", "numbers": numbers, "link": config.s("site"), "brief": "",
            ])
            let c = r["caption"]
            if !c.s("whatsappCaption").isEmpty { wa = c.s("whatsappCaption") }
            if !c.s("instagramCaption").isEmpty { ig = c.s("instagramCaption") }
            await checkWords()
        } catch { note = error.localizedDescription }
    }

    func connectInstagram() async -> URL? {
        do {
            let r = try await MarketingRequest.send("/api/instagram/connect")
            guard let url = URL(string: r.s("url")) else { throw ERPAPI.Failure(status: 0, message: "Instagram sent no address to connect.") }
            return url
        } catch { note = error.localizedDescription; return nil }
    }

    /// Every size as files for the share sheet ("Save all to Photos", "Download every size").
    func allSizes() async throws -> [URL] {
        guard let w = work else { return [] }
        let base = DesignDestinations.slug(w.fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? w.displayName)
        var urls: [URL] = []
        for p in w.pages {
            let px = Int(DesignSizes.size(p.format)?.px ?? 1080)
            urls.append(try Self.tempFile(try await picture(p.id, px), "\(base)-\(DesignDestinations.slug(p.label)).jpg"))
        }
        return urls
    }

    /// The WhatsApp picture with its caption (the caption is on the clipboard too: WhatsApp often drops text shared with a file).
    func captioned() async throws -> [URL] {
        guard let page = pick("whatsapp").page, let w = work else { throw ERPAPI.Failure(status: 0, message: "Make a 1:1 size first (Make 1:1 from this).") }
        let base = DesignDestinations.slug(w.fields["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? w.displayName)
        UIPasteboard.general.string = wa
        return [try Self.tempFile(try await picture(page.id, 1600), base + ".jpg")]
    }

    func shareFile(_ step: Step) async throws -> URL {
        guard let share = step.share else { throw ERPAPI.Failure(status: 0, message: "There is nothing to share.") }
        let r = try await share()
        if step.id == "instagram-post", !ig.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            UIPasteboard.general.string = ig.trimmingCharacters(in: .whitespacesAndNewlines)
            note = "The caption is copied: paste it in Instagram."
        }
        return try Self.tempFile(r.data, r.name)
    }

    static func tempFile(_ data: Data, _ name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try data.write(to: url, options: .atomic)
        return url
    }
}

// MARK: The senders

@MainActor
enum DesignSend {
    private static func jpeg(_ data: Data, _ name: String = "photo.jpg") -> WebsiteForm.File { .init(field: "file", name: name, type: "image/jpeg", data: data) }
    private static func value(_ bytes: Data) -> MarketingValue { (try? JSONDecoder().decode(MarketingValue.self, from: bytes)) ?? .null }

    static func website(_ data: Data, folder: String, name: String) async throws -> String {
        let r = value(try await WebsiteForm.send("/api/website/photos", fields: [("folder", folder), ("name", name)], files: [jpeg(data)], timeout: 120))
        return r.s("rel", "uploaded")
    }

    static func whatsapp(key: String, _ data: Data, name: String, caption: String, sitePiece: String?) async throws -> String {
        var fields: [(String, String)] = []
        if !caption.isEmpty { fields.append(("caption", caption)) }
        fields.append(("targets", key))
        if let sitePiece, !sitePiece.isEmpty { fields.append(("sitePiece", sitePiece)) }
        let r = value(try await WebsiteForm.send("/api/website/post", fields: fields, files: [jpeg(data, "photo.jpg")], timeout: 300))
        return r.s("idMessage", "sent")
    }

    static func story(_ data: Data) async throws -> String {
        value(try await WebsiteForm.send("/api/instagram/story", fields: [], files: [jpeg(data)], timeout: 180)).s("mediaId", "posted")
    }

    static func post(_ data: Data, caption: String) async throws -> String {
        let text = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        return value(try await WebsiteForm.send("/api/instagram/post", fields: text.isEmpty ? [] : [("caption", text)], files: [jpeg(data, "post.jpg")], timeout: 180)).s("mediaId", "posted")
    }

    static func siteReplace(id: String, _ data: Data, stamped: Bool, doc: MarketingValue) async throws -> String {
        _ = try await WebsiteForm.send("/api/website/edits", fields: [("id", id), ("stamped", stamped ? "1" : "0"), ("design", doc.text), ("shape", "own"), ("ai", "[]")], files: [jpeg(data)], timeout: 130)
        return id
    }

    /// The ad in the ad account's library and the hand-off New ad reads (as the Studio's own `newAd`); resolves to the address to open.
    static func metaAd(main: Data, vertical: Data?, name: String, headline: String, text: String, goal: String, link: String, format: String) async throws -> String {
        func upload(_ data: Data, _ n: String) async throws -> MarketingValue {
            value(try await WebsiteForm.send("/api/ads/images", fields: [], files: [jpeg(data, n)]))
        }
        let base = DesignDestinations.slug(headline.isEmpty ? name : headline)
        let up = try await upload(main, base + ".jpg")
        var vert = MarketingValue.null
        if let vertical { vert = try await upload(vertical, base + "-9x16.jpg") }
        _ = try? await MarketingRequest.send("/api/ads/studio/creatives", ["assets": [Any](), "hash": up.s("hash"), "url": up["url"].any, "format": format, "name": headline])
        let key = String(UUID().uuidString.prefix(8)).lowercased()
        var photo: [String: Any] = ["hash": up.s("hash"), "url": up["url"].any, "headline": headline]
        if !link.isEmpty { photo["link"] = link }
        var second: Any = NSNull()
        if vert != .null { second = ["hash": vert.s("hash"), "url": vert["url"].any] as [String: Any] }
        var handoff: [String: Any] = ["photos": [photo], "vertical": second, "text": text, "headline": headline, "goal": goal, "name": name + (vert == .null ? "" : " + 9:16")]
        if !link.isEmpty { handoff["link"] = link }
        StudioHandoffs.shared.ads[key] = MarketingValue(handoff)
        return "/ads/new?studio=" + key
    }

    /// The post queue (as Post a piece and the Board call it): the entry, its pictures, then "ready" (held), then a time if there is one.
    static func queue(headline: String, caption: String, fileBase: String, sitePiece: String?, website: (folder: String, names: [String], featured: Bool)?, whatsapp: [String],
                      count: Int, images: [String: Data], thumb: Data?, dueAt: String?) async throws -> String {
        var qid: String?
        do {
            let counts: [String: Any] = ["site": website != nil ? count : 0, "wa": whatsapp.isEmpty ? 0 : count, "story": images["story"] != nil]
            var body: [String: Any] = ["headline": headline, "caption": caption, "fileBase": fileBase, "counts": counts, "instagram": images["story"] != nil, "whatsapp": whatsapp]
            if let w = website {
                body["website"] = ["folder": w.folder, "collection": w.folder.split(separator: "/").dropFirst().first.map(String.init) ?? w.folder, "names": w.names, "featured": w.featured] as [String: Any]
            } else { body["website"] = NSNull() }
            if let thumb { body["thumb"] = thumb.base64EncodedString() }
            if let sitePiece, !sitePiece.isEmpty { body["sitePiece"] = sitePiece }
            let made = try await MarketingRequest.send("/api/website/post/queue", body)
            qid = made["item"].s("id")
            guard let id = qid, !id.isEmpty else { throw ERPAPI.Failure(status: 0, message: "The queue gave no entry.") }
            for key in images.keys.sorted() {
                _ = try await WebsiteForm.send("/api/website/post/queue/" + id, fields: [("key", key)], files: [.init(field: "file", name: key + ".jpg", type: "image/jpeg", data: images[key]!)])
            }
            // 'ready' puts the draft in the queue, held; a time then schedules it.
            _ = try await MarketingRequest.send("/api/website/post/queue/" + id, ["action": "ready"], method: "PATCH")
            if let dueAt { _ = try await MarketingRequest.send("/api/website/post/queue/" + id, ["action": "schedule", "dueAt": dueAt], method: "PATCH") }
            return id
        } catch {
            // Nothing has gone: take the half-made entry out so the retry starts clean.
            if let id = qid, !id.isEmpty { _ = try? await MarketingRequest.send("/api/website/post/queue/" + id, method: "DELETE") }
            throw error
        }
    }
}
