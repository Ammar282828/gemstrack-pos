import SwiftUI
import UIKit
import Observation
import ERPCore

// The Posts tray (src/app/posts/page.tsx and ./piece-card.tsx), natively: website pieces picked one or a few at a
// time, each a card of its own with its weight, its caption and its story, and one Send that takes them all to the
// same groups and the channel, one after another, after one confirm, or Later, into the queue. The sending is the
// server's (POST /api/website/post, the queue's routes); the caption and the stamped photo are the web's own code,
// run by the bundled engine (design-engine.ts `siteCaption`, `stamp`, `siteStory`), so the phone sends what the web does.

/// One piece in the tray: what the web's card keeps while the counter looks at another.
@MainActor
@Observable
final class PostTrayCard: Identifiable {
    let piece: PostPiece
    var id: String { piece.id }
    /// As typed; it starts as the site's, and a different one is this post's alone (site-weight.ts).
    var weight: String
    /// The weight stamped on the photo, on by default only where the photo doesn't show it.
    var overlay: Bool
    /// stampPhoto's colour: "auto", "white" or "dark".
    var ink = "auto"
    /// The AI's line and facts, in the house's frame in place of the site's own, while they are used.
    var aiLine: String?
    var aiFacts: String?
    /// Typed over: a new weight then leaves the caption as it is.
    var edited = false
    var caption = ""
    /// The photo that goes, when it isn't the website's own (the weight stamped on).
    var preview: UIImage?
    var sending = false
    /// Why the last send of this piece failed.
    var failed: String?
    @ObservationIgnored var stamped: (key: String, data: Data)?
    /// Crop & design (piece-design.tsx): while there is one, it is the photo that goes, square, to the groups and the
    /// story. nil is the photo as the website has it.
    var design: WebsitePhotoEdit?
    /// The name drawn on the design; the piece's own to start with.
    var designName: String

    init(_ piece: PostPiece) {
        self.piece = piece
        designName = piece.name
        weight = piece.weightGrams.map { (g: Double) in WebsiteNumber.grams(g) } ?? ""
        overlay = (piece.weightGrams ?? 0) > 0 && !piece.weightOnPhoto
    }

    var weightOK: Bool { validWeight(weight) }
    var grams: String { weight.trimmingCharacters(in: .whitespaces) + "g" }
    var stamps: Bool { design == nil && overlay && weightOK }
    var designed: Bool { design?.ready == true }

    /// What the design's words read (piece-design.tsx `fields`): the line under the name carries the weight only when
    /// nothing else on the photo does.
    func designFields(metal: String) -> [String: String] {
        let w = weightOK ? grams : ""
        let stampedOn = design?.doc["layers"].array.contains { (l: MarketingValue) in l.s("kind") == "text" && l.s("bind") == "weight" && !l["hidden"].bool } ?? false
        // site-design.ts siteDetailsLine: the Maisons are the great houses' pieces, not the house's own metal.
        let details = [piece.collection.range(of: "maison", options: .caseInsensitive) != nil ? "" : metal, stampedOn ? "" : w]
            .filter { !$0.isEmpty }.joined(separator: " | ")
        return ["kicker": piece.collection, "headline": designName, "weight": w, "details": details]
    }

    /// The weight shows on the design: its own stamp, or in the line under the name.
    var designShowsWeight: Bool {
        weightOK && (design?.doc["layers"].array.contains { (l: MarketingValue) in
            l.s("kind") == "text" && !l["hidden"].bool && (l.s("bind") == "weight" || l.s("bind") == "details")
        } ?? false)
    }
    /// What the confirm says goes: "The photo with 3.84g on it".
    var going: String { designed ? "Your design of the photo" : stamps ? "The photo with \(grams) on it" : "The photo as it is on the website" }
    /// The weight the website keeps when this goes (taheri.shop's own photographs that have none).
    var newWeight: Double? { weightForSite(source: piece.source, siteGrams: piece.weightGrams, typed: weight) }
    var postOnly: Bool { postOnlyWeight(siteGrams: piece.weightGrams, typed: weight) }
}

@MainActor
@Observable
final class PostTrayModel {
    /// Enough for one sitting; more is the queue's to spread (page.tsx MAX_PICK).
    static let maxPick = 10
    /// Pieces posted within this many days are skipped by Shuffle (page.tsx FRESH_DAYS).
    static let freshDays = 30

    private(set) var cards: [PostTrayCard] = []
    var active: String?
    /// WhatsApp destination keys, in the order they are offered: the groups, then the channel.
    private(set) var targets: [String] = []
    /// "send" or "queue" while the tray goes.
    private(set) var busy: String?
    private(set) var instagram = MarketingValue.null
    private(set) var posting = MarketingValue.null

    let engine = NativeArtwork()
    @ObservationIgnored private var photos: [String: Data] = [:]
    @ObservationIgnored private var ready = false
    private var store: PostsStore { PostsStore.shared }

    var audience: PostAudience { store.audience }
    var activeCard: PostTrayCard? { cards.first { (c: PostTrayCard) in c.id == active } ?? cards.first }
    var canSend: Bool { audience.canSend && !targets.isEmpty && !cards.isEmpty && busy == nil }

    /// Where a post goes is this phone's choice, kept for the next sitting (the web keeps it on the device too).
    private var targetsKey: String { BizKey("erp.postTargets") }

    // MARK: Starting

    func setUp() async {
        guard !ready else { return }
        ready = true
        async let pieces: Void = store.load()
        async let places: Void = store.refreshAudience()
        async let config = MarketingRequest.get("/api/app/website")
        async let ig = MarketingRequest.get("/api/instagram/status")
        _ = await (pieces, places)
        posting = (try? await config)?["posting"] ?? .null
        instagram = (try? await ig) ?? .null
        chooseTargets()
        for c in cards { await refresh(c) }
    }

    private var keys: [String] { audience.groups.map(\.key) + (audience.channelName != nil ? ["channel"] : []) }

    private func chooseTargets() {
        let saved = (UserDefaults.standard.stringArray(forKey: targetsKey) ?? []).filter { (k: String) in keys.contains(k) }
        targets = saved.isEmpty ? Array(audience.groups.prefix(1).map(\.key)) + (audience.channelName != nil ? ["channel"] : []) : saved
    }

    func toggle(_ key: String) {
        let next = targets.contains(key) ? targets.filter { (k: String) in k != key } : targets + [key]
        targets = keys.filter { (k: String) in next.contains(k) }
        UserDefaults.standard.set(targets, forKey: targetsKey)
    }

    /// A destination's name on the page: "the channel", or the group's label.
    func label(_ key: String) -> String {
        key == "channel" ? "the channel" : audience.groups.first { (g: PostAudience.Place) in g.key == key }?.label ?? key
    }

    func reach(_ key: String) -> Int? {
        key == "channel" ? audience.channelFollowers : audience.groups.first { (g: PostAudience.Place) in g.key == key }?.size
    }

    /// The posting lines' checks that would stop a WhatsApp send now.
    var blockers: [PostCheck] { store.failingChecks.filter { (c: PostCheck) in c.group == "WhatsApp" } }

    // MARK: Picking

    func has(_ id: String) -> Bool { cards.contains { (c: PostTrayCard) in c.id == id } }

    /// Into the tray, or out again; nil, or why it can't go in.
    @discardableResult
    func pick(_ p: PostPiece) -> String? {
        if busy != nil { return nil }
        if has(p.id) { take(p.id); return nil }
        if cards.count >= Self.maxPick { return "\(Self.maxPick) at a time. Send or queue these first: the queue can spread them over the day." }
        let card = PostTrayCard(p)
        cards.append(card)
        active = p.id
        Task { await refresh(card) }
        return nil
    }

    func take(_ id: String) {
        cards.removeAll { (c: PostTrayCard) in c.id == id }
        if active == id { active = cards.last?.id }
    }

    func clear() { cards = []; active = nil }

    /// A piece at random from the website: not one posted lately, unless there are none.
    private func randomPiece() -> PostPiece? {
        let open = store.pieces.filter { (p: PostPiece) in !has(p.id) }
        let fresh = open.filter { (p: PostPiece) in (MarketingTime.daysAgo(store.posted[p.id]) ?? Self.freshDays) >= Self.freshDays }
        return (fresh.isEmpty ? open : fresh).randomElement()
    }

    func shuffle() -> String? {
        if cards.count >= Self.maxPick { return "\(Self.maxPick) at a time." }
        guard let p = randomPiece() else { return "Nothing to shuffle." }
        return pick(p)
    }

    /// Another piece in this card's place.
    func another(_ card: PostTrayCard) -> String? {
        guard let p = randomPiece(), let i = cards.firstIndex(where: { (c: PostTrayCard) in c.id == card.id }) else { return "Nothing else to shuffle to." }
        let next = PostTrayCard(p)
        cards[i] = next
        active = p.id
        Task { await refresh(next) }
        return nil
    }

    // MARK: A card's words and photo

    /// The house's caption, and the photo with the weight on it, as they are now.
    func refresh(_ card: PostTrayCard) async {
        // Read again after the engine answers: what the counter typed meanwhile is kept.
        if !card.edited, let words = try? await houseCaption(card), !card.edited { card.caption = words }
        if card.stamps, let data = try? await outgoing(card) { card.preview = UIImage(data: data) } else { card.preview = nil }
    }

    /// sitePieceCaption with this house's lines (/api/app/website `posting`), the weight as typed and the AI's words if used.
    private func houseCaption(_ card: PostTrayCard) async throws -> String {
        let p = card.piece
        var piece: [String: Any] = ["name": p.name, "url": p.url, "facts": card.aiFacts.map { (f: String) in [f] } ?? p.facts, "about": card.aiLine ?? p.about]
        piece["weightGrams"] = card.weightOK ? Self.typedGrams(card.weight) : NSNull()
        let context: [String: Any] = ["metal": posting.s("metal"), "tagline": posting.s("tagline"), "footer": posting.s("footer"),
                                      "whatsappNumbers": posting["whatsappNumbers"].array.map(\.string)]
        let r = try await engine.run(doc: .null, photos: [:], fields: [:], options: ["action": "siteCaption", "sitePiece": piece, "context": context])
        return r.s("caption")
    }

    func houseWords(_ card: PostTrayCard) async {
        card.aiLine = nil
        card.aiFacts = nil
        card.edited = false
        await refresh(card)
    }

    /// The AI's line and facts for the piece (/api/website/site-pieces/caption), put in the house's frame.
    func writeWithAI(_ card: PostTrayCard) async throws {
        let d = try await MarketingRequest.send("/api/website/site-pieces/caption", ["id": card.id, "weight": card.weightOK ? card.grams : ""])
        card.aiLine = d.s("line")
        card.aiFacts = d.s("facts")
        card.edited = false
        await refresh(card)
    }

    /// The website's photograph, fetched once through the ERP (the site doesn't share it with the app).
    func photo(_ id: String) async throws -> Data {
        if let have = photos[id] { return have }
        let data = try await ERPAPI.shared.data("/api/website/site-pieces/image?id=\(AdsQuery.escape(id))", timeout: 120)
        photos[id] = data
        return data
    }

    /// The photo that goes out: stamped with the weight while the overlay is on, else the site's own.
    func outgoing(_ card: PostTrayCard) async throws -> Data {
        if let d = card.design, d.ready { return try await d.squareJpeg(fields: card.designFields(metal: posting.s("metal"))) }
        let base = try await photo(card.id)
        guard card.stamps else { return base }
        let key = card.grams + "|" + card.ink
        if let s = card.stamped, s.key == key { return s.data }
        let r = try await engine.run(doc: .null, photos: ["site": base], fields: [:], options: ["action": "stamp", "photoId": "site", "text": card.grams, "colour": card.ink])
        guard let data = Data(base64Encoded: r.s("image")) else { throw ERPAPI.Failure(status: 0, message: "Could not put the weight on.") }
        card.stamped = (key, data)
        return data
    }

    /// Crop & design, the first time on the layout this piece starts with (the weight on it where the card stamped it).
    /// nil, or why the photo didn't come.
    func startDesign(_ card: PostTrayCard) async -> String? {
        let edit = card.design ?? WebsitePhotoEdit(pieceID: card.id)
        card.design = edit
        do {
            let base = try await photo(card.id)
            await edit.beginSquare(card.piece, sitePhoto: base, weightOn: card.overlay && card.weightOK, fields: card.designFields(metal: posting.s("metal")))
        } catch {
            card.design = nil
            return error.localizedDescription
        }
        if let problem = edit.problem, !edit.ready {
            card.design = nil
            return problem
        }
        return nil
    }

    /// Back to the photo as the website has it: the design is dropped.
    func dropDesign(_ card: PostTrayCard) {
        card.design = nil
        card.designName = card.piece.name
    }

    /// The piece as a 9:16 story: the photo that would go to WhatsApp, whole, with the name and the weight.
    func story(_ card: PostTrayCard) async throws -> Data {
        let photo = try await outgoing(card)
        let r = try await engine.run(doc: .null, photos: ["site": photo], fields: [:], options: [
            "action": "siteStory", "photoId": "site", "headline": card.designed ? (card.designName.trimmingCharacters(in: .whitespaces).isEmpty ? card.piece.name : card.designName) : card.piece.name, "collection": card.piece.collection,
            "metal": posting.s("metal"), "weight": card.weightOK ? card.grams : "",
        ])
        guard let data = Data(base64Encoded: r.s("image")) else { throw ERPAPI.Failure(status: 0, message: "Couldn't make the story.") }
        return data
    }

    // MARK: Sending

    /// How a send or a queue went, said once at the end.
    struct Outcome {
        var notes: [Note] = []
    }

    /// Every piece in the tray, one after another, each to the chosen places. Stops at the first that fails; one that
    /// some places took has gone, so it leaves the tray (sending it again would post twice).
    func send() async -> Outcome {
        busy = "send"
        defer { busy = nil }
        var done: [PostTrayCard] = []
        var partly: [String] = []
        var weighed: [String] = []
        var unweighed: [String] = []
        var stopped: (name: String, why: String)?
        let places = targets
        // A card whose caption the engine never wrote (it was still starting) gets it now: nothing goes without one.
        for card in cards where card.caption.isEmpty && !card.edited { await refresh(card) }
        for card in cards {
            card.sending = true
            card.failed = nil
            defer { card.sending = false }
            do {
                let photo = try await outgoing(card)
                let fields: [(String, String)] = [("caption", card.caption), ("sitePiece", card.id), ("targets", places.joined(separator: ","))]
                let bytes = try await WebsiteForm.send("/api/website/post", fields: fields,
                                                       files: [.init(field: "file", name: Self.slug(card.piece) + ".jpg", type: "image/jpeg", data: photo)], timeout: 300)
                let answer = (try? JSONDecoder().decode(MarketingValue.self, from: bytes)) ?? .null
                let missed = answer["results"].array.filter { (r: MarketingValue) in !r["ok"].bool }
                if let first = missed.first {
                    partly.append("\(card.piece.name) didn't go to \(Self.listOf(missed.map { (r: MarketingValue) in label(r.s("key")) })): \(first.s("error"))")
                }
                switch await keepWeight(card) {
                case .some(true): weighed.append(card.piece.name)
                case .some(false): unweighed.append(card.piece.name)
                case .none: break
                }
                done.append(card)
            } catch {
                card.failed = error.localizedDescription
                stopped = (card.piece.name, error.localizedDescription)
                break
            }
        }
        cards.removeAll { (c: PostTrayCard) in done.contains { $0 === c } }
        if let a = active, !has(a) { active = cards.first?.id }
        if !done.isEmpty { await store.afterSending() }

        var out = Outcome()
        let n = done.count
        if let s = stopped {
            out.notes.append(Note(title: n > 0 ? "\(n) sent, then \(s.name) didn't go" : "\(s.name) didn't go",
                                  detail: s.why + (cards.count > 1 ? " The rest are still in the tray." : ""), failed: true))
        } else if !partly.isEmpty {
            out.notes.append(Note(title: "Sent \(n) \(Self.noun(n)), not everywhere", detail: partly.joined(separator: " · "), failed: true))
        } else if n > 0 {
            out.notes.append(Note(title: "Sent \(n) \(Self.noun(n)) to \(Self.listOf(places.map(label)))",
                                  detail: n == 1 ? "\(done[0].piece.name), with its link." : "Each with its own caption and link."))
        }
        if !weighed.isEmpty {
            out.notes.append(Note(title: "Weight saved on \(store.siteName)", detail: "\(Self.listOf(weighed)) now \(weighed.count == 1 ? "shows its" : "show their") weight on the website."))
        }
        if !unweighed.isEmpty {
            out.notes.append(Note(title: "The weight wasn't saved on \(store.siteName)", detail: "\(Self.listOf(unweighed)): add it in Website → Weights.", failed: true))
        }
        return out
    }

    /// Into the queue, to send later or spread over the day: each piece exactly as its card makes it now.
    func queue() async -> Outcome {
        busy = "queue"
        defer { busy = nil }
        var done: [PostTrayCard] = []
        var problem: String?
        for card in cards where card.caption.isEmpty && !card.edited { await refresh(card) }
        for card in cards {
            card.sending = true
            card.failed = nil
            defer { card.sending = false }
            do {
                let photo = try await outgoing(card)
                let thumb = UIImage(data: photo).flatMap { (img: UIImage) in AdsPhotoCodec.thumbnail(from: img) }
                _ = try await DesignSend.queue(headline: card.piece.name, caption: card.caption, fileBase: Self.slug(card.piece), sitePiece: card.id,
                                               website: nil, whatsapp: targets, count: 1, images: ["wa-0": photo], thumb: thumb, dueAt: nil)
                // Queued is as good as typed in for good: the website keeps the weight now, not when the post goes.
                _ = await keepWeight(card)
                done.append(card)
            } catch {
                card.failed = error.localizedDescription
                problem = error.localizedDescription
                break
            }
        }
        cards.removeAll { (c: PostTrayCard) in done.contains { $0 === c } }
        if let a = active, !has(a) { active = cards.first?.id }
        await store.refreshQueue()
        var out = Outcome()
        if !done.isEmpty {
            out.notes.append(Note(title: "\(done.count) \(Self.noun(done.count)) in the queue", detail: "Send them now, give each a time, or spread them over the day: they go by themselves."))
        }
        if let problem { out.notes.append(Note(title: "Could not queue it", detail: problem, failed: true)) }
        return out
    }

    /// A weight typed for a piece the website has none for, kept there as Website → Weights keeps it. The post has
    /// gone either way: true saved, false not, nil when there was nothing to keep.
    private func keepWeight(_ card: PostTrayCard) async -> Bool? {
        guard let grams = card.newWeight else { return nil }
        do {
            _ = try await ERPAPI.shared.send("/api/website/pieces", method: "PUT", ["key": card.id, "weightGrams": grams])
            return true
        } catch { return false }
    }

    // MARK: Words

    static func noun(_ n: Int) -> String { n == 1 ? "piece" : "pieces" }

    /// The weight as the caption takes it: Number(typed), as the web's card passes it.
    static func typedGrams(_ typed: String) -> Double { Double(typed.trimmingCharacters(in: .whitespaces)) ?? 0 }

    /// "a", "a and b", "a, b and c" (queue-panel.tsx listOf).
    static func listOf(_ xs: [String]) -> String {
        guard xs.count > 1 else { return xs.first ?? "" }
        return xs.dropLast().joined(separator: ", ") + " and " + xs[xs.count - 1]
    }

    /// The file's name, from the piece's own address (piece-card.tsx slugOf).
    static func slug(_ p: PostPiece) -> String {
        let last = p.url.split(separator: "/").last.map(String.init) ?? ""
        let s = String(last.replacingOccurrences(of: #"[^\w-]+"#, with: "-", options: .regularExpression).prefix(100))
        return s.isEmpty ? "piece" : s
    }
}
