import Foundation
import ERPCore

// The Website screens' answers, read as leniently as the web reads them: a missing or odd field gives a
// default, never an error that would empty a screen (CONVENTIONS.md rule 2). Field names are the routes' own.

// MARK: Add photos (/api/website/photos, /api/website/photos/names)

/// A collection a photograph can go into ("Earrings/Jhumki"), with how many pieces it holds today.
struct WebsiteCollection: Decodable, Identifiable, Hashable {
    let collection: String
    let category: String
    let count: Int
    /// "Category/Collection": where a new photo goes.
    let folder: String
    /// Where the collection's page is, when the site says (its own catalog-tree.json).
    let path: String?
    var id: String { folder }

    private enum K: String, CodingKey { case collection, category, count, folder, path }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        collection = c.string(.collection, default: "")
        category = c.string(.category, default: "")
        count = c.int(.count) ?? 0
        folder = c.string(.folder, default: "")
        path = c.string(.path)
    }
}

struct WebsiteCollectionsAnswer: Decodable {
    let collections: [WebsiteCollection]
    /// The site's upload secret is set on this ERP: until it is, nothing can be sent.
    let configured: Bool

    private enum K: String, CodingKey { case collections, configured }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        collections = c.list(.collections, of: WebsiteCollection.self).filter { (x: WebsiteCollection) in !x.folder.isEmpty }
        configured = c.bool(.configured, default: true)
    }
}

/// Whether a collection names its photographs by house and model (The Maisons), and the houses.
struct WebsiteMaisonAnswer: Decodable {
    let maison: Bool
    let houses: [String]

    private enum K: String, CodingKey { case maison, houses }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        maison = c.bool(.maison, default: false)
        houses = c.strings(.houses)
    }
}

/// Every photo's file name for a Maisons tray, in its order (lib/website/maison-batch.ts).
struct WebsiteMaisonNames: Decodable {
    let maison: Bool
    let names: [String]

    private enum K: String, CodingKey { case maison, names }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        maison = c.bool(.maison, default: false)
        names = c.strings(.names)
    }
}

/// A photograph the site took (lib/website/upload.ts `SiteUpload`): its key, which the set of the day uses.
struct WebsiteUploaded: Decodable {
    let rel: String
    let collection: String

    private enum K: String, CodingKey { case rel, collection }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        rel = c.string(.rel, default: "")
        collection = c.string(.collection, default: "")
    }
}

/// The AI's retouch (/api/website/post/ai, op retouch): the new photograph and the "same piece?" check.
struct WebsiteRetouched: Decodable {
    let data: Data?
    let samePiece: Bool?
    let confidence: Double?
    let differences: [String]
    let steps: [String]
    /// The check came back (null when it could not be made).
    let checked: Bool

    private enum K: String, CodingKey { case image, check, steps }

    private struct Image: Decodable {
        let data: String
        private enum I: String, CodingKey { case data }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: I.self)
            data = c.string(.data, default: "")
        }
    }

    private struct Check: Decodable {
        let samePiece: Bool
        let confidence: Double
        let differences: [String]
        private enum C: String, CodingKey { case samePiece, confidence, differences }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: C.self)
            samePiece = c.bool(.samePiece, default: false)
            confidence = c.double(.confidence, default: 0)
            differences = c.strings(.differences)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let image = c.object(.image, of: Image.self)
        data = image.flatMap { (i: Image) in Data(base64Encoded: i.data, options: .ignoreUnknownCharacters) }
        let check = c.object(.check, of: Check.self)
        checked = check != nil
        samePiece = check?.samePiece
        confidence = check?.confidence
        differences = check?.differences ?? []
        steps = c.strings(.steps)
    }

    /// The web's bar for "it is the same piece": sure, and at least 80% so.
    var passes: Bool { (samePiece ?? false) && (confidence ?? 0) >= 0.8 }
}

// MARK: Photo weights (/api/website/pieces)

/// One catalogue photograph and its weight: from the photo's own label, from the counter, or none yet.
struct WebsiteWeightPiece: Decodable, Identifiable, Hashable {
    let key: String
    let collection: String
    let file: String
    let thumb: String
    var weightGrams: Double?
    /// "label" (burned into the photo), "pos" (typed here), or nil.
    var source: String?
    let labelWeightGrams: Double?
    var enteredBy: String?
    var enteredAt: String?
    var id: String { key }

    private enum K: String, CodingKey { case key, collection, file, thumb, weightGrams, source, labelWeightGrams, enteredBy, enteredAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        collection = c.string(.collection, default: "")
        file = c.string(.file, default: "")
        thumb = c.string(.thumb, default: "")
        weightGrams = c.double(.weightGrams).flatMap { (g: Double) in g > 0 ? g : nil }
        source = c.string(.source)
        labelWeightGrams = c.double(.labelWeightGrams)
        enteredBy = c.string(.enteredBy)
        enteredAt = c.string(.enteredAt)
    }
}

struct WebsiteWeightsAnswer: Decodable {
    let pieces: [WebsiteWeightPiece]
    private enum K: String, CodingKey { case pieces }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        pieces = c.list(.pieces, of: WebsiteWeightPiece.self).filter { (p: WebsiteWeightPiece) in !p.key.isEmpty }
    }
}

// MARK: Edit a piece (/api/website/edits)

/// What the site says about a piece (site-pieces.ts `PieceWords`): the catalogue's paragraphs and facts,
/// or taheri.shop's tags. A missing tag reads as empty, as the page reads it.
struct WebsiteWords: Decodable, Hashable {
    var name: String
    var about: String
    var facts: [String]
    var stone: String
    var metal: String
    var karat: String
    var cut: String
    var style: String

    private enum K: String, CodingKey { case name, about, facts, stone, metal, karat, cut, style }

    init() {
        name = ""; about = ""; facts = []; stone = ""; metal = ""; karat = ""; cut = ""; style = ""
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        name = c.string(.name, default: "")
        about = c.string(.about, default: "")
        facts = c.strings(.facts)
        stone = c.string(.stone, default: "")
        metal = c.string(.metal, default: "")
        karat = c.string(.karat, default: "")
        cut = c.string(.cut, default: "")
        style = c.string(.style, default: "")
    }

    struct Tag: Hashable, Identifiable {
        let key: String
        let label: String
        var id: String { key }
    }

    /// taheri.shop's tags, in the order the piece page shows them (edit/page.tsx TAGS).
    static let tags: [Tag] = [
        Tag(key: "stone", label: "Stone"), Tag(key: "metal", label: "Metal"), Tag(key: "karat", label: "Karat"),
        Tag(key: "cut", label: "Cut"), Tag(key: "style", label: "Style"),
    ]

    func tag(_ key: String) -> String {
        switch key {
        case "stone": return stone
        case "metal": return metal
        case "karat": return karat
        case "cut": return cut
        case "style": return style
        default: return ""
        }
    }

    mutating func setTag(_ key: String, _ value: String) {
        switch key {
        case "stone": stone = value
        case "metal": metal = value
        case "karat": karat = value
        case "cut": cut = value
        case "style": style = value
        default: break
        }
    }
}

/// The counter's change to a piece, as the site keeps it (site-edits.ts `SiteOverride`): which fields it
/// carries, whether the photo was re-made here, and when.
struct WebsiteEditChange: Decodable, Hashable {
    let keys: Set<String>
    let photoEdited: Bool
    let at: String?
    let weightGrams: Double?
    let weightOnPhoto: Bool

    private struct Photo: Decodable {
        let edited: Bool
        private enum P: String, CodingKey { case edited }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: P.self)
            edited = c.bool(.edited, default: false)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        keys = Set(c.allKeys.map { (k: AnyKey) in k.stringValue })
        photoEdited = c.object(AnyKey("photo"), of: Photo.self)?.edited ?? false
        at = c.string(AnyKey("at"))
        weightGrams = c.double(AnyKey("weightGrams"))
        weightOnPhoto = c.bool(AnyKey("weightOnPhoto"), default: false)
    }

    /// The words the counter can change (edit/page.tsx TEXT_KEYS).
    static let textKeys: Set<String> = ["name", "about", "facts", "stone", "metal", "karat", "cut", "style"]
}

/// A piece on the house's website with the counter's changes (site-pieces.ts `SitePiece`).
struct WebsiteEditPiece: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let url: String
    let image: String
    let thumb: String
    let collection: String
    let weightGrams: Double?
    /// The photo already shows the weight (taheri.shop's burned-in label).
    let weightOnPhoto: Bool
    let facts: [String]
    let imagePath: String?
    /// "attributes" (taheri.shop: tags, the counter's weights) or "pieces" (the catalogue: paragraphs, facts).
    let source: String
    let own: WebsiteWords
    let words: WebsiteWords
    let change: WebsiteEditChange?
    let hidden: Bool
    let photoSource: String?
    let sourceMarked: Bool

    private enum K: String, CodingKey {
        case id, name, url, image, thumb, collection, weightGrams, weightOnPhoto, facts, imagePath, source, own, words, change, hidden, photoSource, sourceMarked
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        name = c.string(.name, default: "")
        url = c.string(.url, default: "")
        image = c.string(.image, default: "")
        let small = c.string(.thumb, default: "")
        thumb = small.isEmpty ? image : small
        collection = c.string(.collection, default: "")
        weightGrams = c.double(.weightGrams).flatMap { (g: Double) in g > 0 ? g : nil }
        weightOnPhoto = c.bool(.weightOnPhoto, default: false)
        facts = c.strings(.facts)
        imagePath = c.string(.imagePath)
        source = c.string(.source, default: "attributes")
        let ownWords = c.object(.own, of: WebsiteWords.self)
        let shown = c.object(.words, of: WebsiteWords.self)
        own = ownWords ?? shown ?? WebsiteEditPiece.blank
        words = shown ?? ownWords ?? WebsiteEditPiece.blank
        change = c.object(.change, of: WebsiteEditChange.self)
        hidden = c.bool(.hidden, default: false)
        photoSource = c.string(.photoSource)
        sourceMarked = c.bool(.sourceMarked, default: false)
    }

    /// A piece with no words at all still opens; its name field starts empty.
    private static var blank: WebsiteWords { WebsiteWords() }

    /// taheri.shop's photographs carry tags; the catalogue's pieces carry paragraphs and a list of facts.
    var hasTags: Bool { source == "attributes" }
    var photoEdited: Bool { change?.photoEdited ?? false }
    var wordsChanged: Bool { !(change?.keys ?? []).isDisjoint(with: WebsiteEditChange.textKeys) }
    /// Anything the counter changed that still shows (edit/page.tsx `changed`).
    var changed: Bool { photoEdited || wordsChanged || hidden || change?.weightGrams != nil }
}

/// One change in the log (site-edits.ts `recentChanges`).
struct WebsiteEditRecent: Decodable, Identifiable, Hashable {
    let key: String
    let name: String
    let what: [String]
    let by: String
    let at: String
    var id: String { key + "|" + at }

    private enum K: String, CodingKey { case key, name, what, by, at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        key = c.string(.key, default: "")
        name = c.string(.name, default: "")
        what = c.strings(.what)
        by = c.string(.by, default: "")
        at = c.string(.at, default: "")
    }
}

struct WebsiteEditsAnswer: Decodable {
    let site: String
    let pieces: [WebsiteEditPiece]
    let recent: [WebsiteEditRecent]

    private enum K: String, CodingKey { case site, pieces, recent }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        site = c.string(.site, default: "")
        pieces = c.list(.pieces, of: WebsiteEditPiece.self).filter { (p: WebsiteEditPiece) in !p.id.isEmpty }
        recent = c.list(.recent, of: WebsiteEditRecent.self)
    }
}

/// GET ?id=: one piece, fresh, and the original photograph's address when the photo was re-made here.
struct WebsiteEditOne: Decodable {
    let piece: WebsiteEditPiece?
    let original: String?
    /// What the AI did to the photo last time (the kept design's `ai`), to say it is not carried over.
    let lastAI: [String]

    private enum K: String, CodingKey { case piece, original, design }

    private struct Design: Decodable {
        let ai: [String]
        private enum D: String, CodingKey { case ai }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: D.self)
            ai = c.strings(.ai)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        piece = c.object(.piece, of: WebsiteEditPiece.self)
        original = c.string(.original)
        lastAI = c.object(.design, of: Design.self)?.ai ?? []
    }
}

/// POST's answer: the piece as it now is, and the ERP's note when nothing had changed.
struct WebsiteEditSaved: Decodable {
    let piece: WebsiteEditPiece?
    let note: String?

    private enum K: String, CodingKey { case piece, note }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        piece = c.object(.piece, of: WebsiteEditPiece.self)
        note = c.string(.note)
    }
}

// MARK: Investments (/api/investments, /schedule, /status)

/// A day's gold post as the routine filed it (lib/investments.ts `InvestmentPost`).
struct WebsiteGoldPost: Decodable, Identifiable, Hashable {
    struct Went: Decodable, Hashable {
        let at: String
        let by: String
        private enum W: String, CodingKey { case at, by }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: W.self)
            at = c.string(.at, default: "")
            by = c.string(.by, default: "")
        }
    }

    let id: String
    let date: String
    let post: String
    let teaser: String
    /// "square", "story".
    let cards: [String]
    let receivedAt: String
    let source: String
    let editedAt: String?
    /// Part (group, channel, teaser, instagram) → when it went.
    let sent: [String: Went]
    let hold: Bool
    let approvedAt: String?

    private enum K: String, CodingKey { case id, date, post, teaser, cards, receivedAt, source, editedAt, sent, hold, approved }

    private struct Approved: Decodable {
        let at: String
        private enum A: String, CodingKey { case at }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: A.self)
            at = c.string(.at, default: "")
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        date = c.string(.date, default: "")
        id = c.string(.id, default: date)
        post = c.string(.post, default: "")
        teaser = c.string(.teaser, default: "")
        cards = c.strings(.cards)
        receivedAt = c.string(.receivedAt, default: "")
        source = c.string(.source, default: "")
        editedAt = c.string(.editedAt)
        let raw = (try? c.decodeIfPresent([String: Lossy<Went>].self, forKey: .sent)) ?? [:]
        var out: [String: Went] = [:]
        for (part, went) in raw { if let w = went.value, !w.at.isEmpty { out[part] = w } }
        sent = out
        hold = c.bool(.hold, default: false)
        let a = c.object(.approved, of: Approved.self)
        approvedAt = (a?.at.isEmpty ?? true) ? nil : a?.at
    }

    /// The first line of the post, without WhatsApp's bold and italic marks.
    var headline: String {
        let line = post.split(separator: "\n").map(String.init).first { (l: String) in !l.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
        return line.replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "_", with: "")
    }
}

struct WebsiteGoldAnswer: Decodable {
    let posts: [WebsiteGoldPost]
    let today: String

    private enum K: String, CodingKey { case posts, today }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        posts = c.list(.posts, of: WebsiteGoldPost.self).filter { (p: WebsiteGoldPost) in !p.id.isEmpty }
        today = c.string(.today, default: "")
    }
}

/// The owner's schedule (lib/investments-schedule.ts `Schedule`), as a draft the screen edits and sends back whole.
struct WebsiteGoldSchedule: Decodable, Equatable {
    struct Plan: Equatable {
        var on: Bool
        /// "HH:MM" Karachi, or "arrival".
        var at: String
    }

    var enabled: Bool
    var days: [Int]
    /// "auto" or "approve".
    var mode: String
    var targets: [String: Plan]
    var lateUntil: String
    let updatedBy: String?
    let lastTick: String?

    private enum K: String, CodingKey { case enabled, days, mode, targets, lateUntil, updatedBy, lastTick }

    private struct RawPlan: Decodable {
        let on: Bool?
        let at: String?
        private enum P: String, CodingKey { case on, at }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: P.self)
            on = c.bool(.on)
            at = c.string(.at)
        }
    }

    /// The schedule's defaults (DEFAULT_SCHEDULE), for a part the answer leaves out.
    static let defaults: [String: Plan] = [
        "group": Plan(on: true, at: "11:30"),
        "channel": Plan(on: false, at: "11:30"),
        "teaser": Plan(on: true, at: "12:00"),
        "instagram": Plan(on: false, at: "13:00"),
    ]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        enabled = c.bool(.enabled, default: false)
        days = c.list(.days, of: Int.self).filter { (d: Int) in (0...6).contains(d) }
        mode = c.string(.mode, default: "auto") == "approve" ? "approve" : "auto"
        let raw = (try? c.decodeIfPresent([String: Lossy<RawPlan>].self, forKey: .targets)) ?? [:]
        var plans: [String: Plan] = [:]
        for (t, d) in WebsiteGoldSchedule.defaults {
            let given = raw[t]?.value
            plans[t] = Plan(on: given?.on ?? d.on, at: given?.at ?? d.at)
        }
        targets = plans
        lateUntil = c.string(.lateUntil, default: "20:00")
        updatedBy = c.string(.updatedBy)
        lastTick = c.string(.lastTick)
    }

    func plan(_ t: String) -> Plan { targets[t] ?? WebsiteGoldSchedule.defaults[t] ?? Plan(on: false, at: "11:30") }

    /// What PUT /api/investments/schedule takes (the server normalises it and keeps the scheduler's heartbeat).
    var body: [String: Any] {
        var plans: [String: Any] = [:]
        for (t, p) in targets { plans[t] = ["on": p.on, "at": p.at] }
        return ["enabled": enabled, "days": days.sorted(), "mode": mode, "targets": plans, "lateUntil": lateUntil]
    }

    /// The parts the owner chose, without the bookkeeping, to tell a changed draft from the saved one.
    func sameChoices(_ other: WebsiteGoldSchedule) -> Bool {
        enabled == other.enabled && days.sorted() == other.days.sorted() && mode == other.mode && targets == other.targets && lateUntil == other.lateUntil
    }
}

struct WebsiteGoldScheduleAnswer: Decodable {
    let schedule: WebsiteGoldSchedule?
    private enum K: String, CodingKey { case schedule }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        schedule = c.object(.schedule, of: WebsiteGoldSchedule.self)
    }
}

/// /api/investments/status: the parts this shop can send, in their order and words, and what the schedule
/// will do with each of today's (statusOf + the page's line, worked out on the server).
struct WebsiteGoldStatus: Decodable {
    struct Target: Decodable, Identifiable, Hashable {
        let id: String
        let label: String
        let to: String
        private enum T: String, CodingKey { case id, label, to }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: T.self)
            id = c.string(.id, default: "")
            label = c.string(.label, default: "")
            to = c.string(.to, default: "")
        }
    }

    struct Part: Decodable, Hashable {
        let kind: String
        let line: String?
        /// "ok", "warn", "muted".
        let tone: String
        private enum P: String, CodingKey { case kind, line }
        private struct Line: Decodable {
            let text: String
            let tone: String
            private enum L: String, CodingKey { case text, tone }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: L.self)
                text = c.string(.text, default: "")
                tone = c.string(.tone, default: "muted")
            }
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: P.self)
            kind = c.string(.kind, default: "")
            let l = c.object(.line, of: Line.self)
            line = (l?.text.isEmpty ?? true) ? nil : l?.text
            tone = l?.tone ?? "muted"
        }
    }

    let today: String
    let enabled: Bool
    let mode: String
    let lastTick: String?
    let targets: [Target]
    let dayId: String?
    let parts: [String: Part]

    private enum K: String, CodingKey { case today, enabled, mode, lastTick, targets, day }

    private struct Day: Decodable {
        let id: String
        let parts: [String: Part]
        private enum D: String, CodingKey { case id, parts }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: D.self)
            id = c.string(.id, default: "")
            let raw = (try? c.decodeIfPresent([String: Lossy<Part>].self, forKey: .parts)) ?? [:]
            var out: [String: Part] = [:]
            for (t, p) in raw { if let v = p.value { out[t] = v } }
            parts = out
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        today = c.string(.today, default: "")
        enabled = c.bool(.enabled, default: false)
        mode = c.string(.mode, default: "auto")
        lastTick = c.string(.lastTick)
        targets = c.list(.targets, of: Target.self).filter { (t: Target) in !t.id.isEmpty }
        let day = c.object(.day, of: Day.self)
        dayId = day?.id
        parts = day?.parts ?? [:]
    }
}
