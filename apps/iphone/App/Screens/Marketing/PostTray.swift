import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
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
    /// The photos that go, in order: the lead (this card's own photo), the piece's others, then any added (1 to Album.max).
    var album: [PostAlbumPhoto]

    init(_ piece: PostPiece) {
        self.piece = piece
        album = PostAlbumPhoto.start(piece)
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
    var going: String {
        let lead = designed ? "Your design of the photo" : stamps ? "The photo with \(grams) on it" : "The photo as it is on the website"
        return lead + (album.count > 1 ? ", then \(album.count - 1) more (\(Album.photosLabel(album.count)) in all)" : "")
    }
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
    /// "Instagram post" is chosen: the photos also go as one carousel (a device choice, kept for the next sitting).
    private(set) var instagramPost = false

    let engine = NativeArtwork()
    @ObservationIgnored private var photos: [String: Data] = [:]
    @ObservationIgnored private var ready = false
    private var store: PostsStore { PostsStore.shared }

    var audience: PostAudience { store.audience }
    var activeCard: PostTrayCard? { cards.first { (c: PostTrayCard) in c.id == active } ?? cards.first }
    /// Instagram only while it is connected (the chip is hidden otherwise).
    var toInstagram: Bool { instagramPost && instagram["connected"].bool }
    /// WhatsApp places to send to: needs the community, as the web's `audience.community`.
    var whatsappPlaces: [String] { audience.canSend ? targets : [] }
    var canSend: Bool { (!whatsappPlaces.isEmpty || toInstagram) && !cards.isEmpty && busy == nil }
    /// Where a send goes, in words: the WhatsApp places, then Instagram.
    var placeNames: [String] { whatsappPlaces.map(label) + (toInstagram ? ["Instagram"] : []) }

    /// Where a post goes is this phone's choice, kept for the next sitting (the web keeps it on the device too).
    private var targetsKey: String { BizKey("erp.postTargets") }
    private var instagramKey: String { BizKey("erp.postInstagramPost") }

    func chooseInstagram() {
        instagramPost.toggle()
        UserDefaults.standard.set(instagramPost, forKey: instagramKey)
    }

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
        instagramPost = UserDefaults.standard.bool(forKey: instagramKey)
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
    func photo(_ id: String, n: Int? = nil) async throws -> Data {
        let key = n.map { (k: Int) in "\(id)#\(k)" } ?? id
        if let have = photos[key] { return have }
        let more = n.map { (k: Int) in "&photo=\(k)" } ?? ""
        let data = try await ERPAPI.shared.data("/api/website/site-pieces/image?id=\(AdsQuery.escape(id))" + more, timeout: 120)
        photos[key] = data
        return data
    }

    // MARK: A card's photos (piece-photos.tsx)

    /// Every photo, in order, as it goes: the lead as the card makes it (design, weight), the rest as the site or the phone has them.
    func albumData(_ card: PostTrayCard) async throws -> [Data] {
        var out: [Data] = []
        for x in card.album {
            switch x.kind {
            case .lead: out.append(try await outgoing(card))
            case .angle(let n): out.append(try await photo(card.id, n: n))
            case .site(let id): out.append(try await photo(id))
            case .device(let data): out.append(data)
            }
        }
        return out
    }

    /// The first photo: what a one-photo place (the Instagram story) takes.
    func firstPhoto(_ card: PostTrayCard) async throws -> Data {
        guard let x = card.album.first else { return try await outgoing(card) }
        switch x.kind {
        case .lead: return try await outgoing(card)
        case .angle(let n): return try await photo(card.id, n: n)
        case .site(let id): return try await photo(id)
        case .device(let data): return data
        }
    }

    func move(_ card: PostTrayCard, _ id: String, by step: Int) {
        guard let i = card.album.firstIndex(where: { (x: PostAlbumPhoto) in x.id == id }) else { return }
        let j = i + step
        guard j >= 0, j < card.album.count else { return }
        Motion.run(Motion.travel, reduce: UIAccessibility.isReduceMotionEnabled) { card.album.swapAt(i, j) }
    }

    /// A drag: the dragged photo goes in front of the one it was dropped on.
    func reorder(_ card: PostTrayCard, moving id: String, before target: String) {
        guard id != target, let from = card.album.firstIndex(where: { (x: PostAlbumPhoto) in x.id == id }),
              card.album.contains(where: { (x: PostAlbumPhoto) in x.id == target }) else { return }
        Motion.run(Motion.travel, reduce: UIAccessibility.isReduceMotionEnabled) {
            let moved = card.album.remove(at: from)
            let to = card.album.firstIndex { (x: PostAlbumPhoto) in x.id == target } ?? card.album.count
            card.album.insert(moved, at: to)
        }
    }

    func remove(_ card: PostTrayCard, _ id: String) {
        guard card.album.count > 1, let x = card.album.first(where: { (y: PostAlbumPhoto) in y.id == id }), !x.isLead else { return }
        Motion.run(Motion.travel, reduce: UIAccessibility.isReduceMotionEnabled) { card.album.removeAll { (y: PostAlbumPhoto) in y.id == id } }
    }

    /// Another website piece's photograph in, or out again; nil, or why it can't go in.
    func toggleSite(_ card: PostTrayCard, _ p: PostPiece) -> String? {
        if card.album.contains(where: { (x: PostAlbumPhoto) in x.pieceID == p.id }) {
            card.album.removeAll { (x: PostAlbumPhoto) in x.pieceID == p.id }
            return nil
        }
        if card.album.count >= Album.max { return "\(Album.max) photos at most" }
        card.album.append(PostAlbumPhoto(id: "site-" + p.id, kind: .site(p.id), thumb: p.thumb, image: nil, label: p.name))
        return nil
    }

    /// Photos from this phone, as JPEGs; nil, or why not all went in.
    func addDevice(_ card: PostTrayCard, _ jpegs: [Data]) -> String? {
        var refused = false
        for data in jpegs {
            if card.album.count >= Album.max { refused = true; break }
            card.album.append(PostAlbumPhoto(id: "device-" + UUID().uuidString, kind: .device(data), thumb: nil, image: UIImage(data: data), label: "A photo from this phone"))
        }
        return refused ? "\(Album.max) photos at most" : nil
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
        let photo = try await firstPhoto(card)
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

    /// Every piece in the tray, one after another, each to the chosen places. The tray clears at once and the whole
    /// send runs in the Outbox (owner, 2026-10-23: instant); "Posted to …" or the place that failed comes back from
    /// there, with Retry. Stops at the first that fails; one that some places took has gone, so a retry never posts it twice.
    func send() async -> Outcome {
        let batch = cards
        guard !batch.isEmpty else { return Outcome() }
        let places = whatsappPlaces
        let toIg = toInstagram
        let names = placeNamesSent(places, toIg)
        cards = []
        active = nil
        var finished = Set<String>()
        Outbox.shared.post(label: "Post \(batch.count) \(Self.noun(batch.count)) to \(Self.listOf(names))") { [self] in
            try await deliver(batch, places: places, toIg: toIg, finished: &finished)
        }
        var out = Outcome()
        out.notes.append(Note(title: "Sending to \(names.count) \(names.count == 1 ? "place" : "places")…", detail: "You can carry on: it says here when it has gone."))
        return out
    }

    /// The send itself. `finished` is what has gone already, so the Outbox's Retry skips it.
    private func deliver(_ batch: [PostTrayCard], places: [String], toIg: Bool, finished: inout Set<String>) async throws -> String {
        var done: [PostTrayCard] = []
        var partly: [String] = []
        var weighed: [String] = []
        var unweighed: [String] = []
        var photoCounts: [String: Int] = [:]
        var igSaid: [String] = []
        var stopped: (name: String, why: String)?
        // A card whose caption the engine never wrote (it was still starting) gets it now: nothing goes without one.
        for card in batch where card.caption.isEmpty && !card.edited && !finished.contains(card.id) { await refresh(card) }
        for card in batch where !finished.contains(card.id) {
            do {
                let blobs = try await albumData(card)
                var wentSomewhere = false
                if !places.isEmpty {
                    let sent = try await sendWhatsApp(card, blobs, places)
                    wentSomewhere = !sent.got.isEmpty
                    // Some places took it and some didn't: it has gone, so it is not sent again.
                    let missed = places.filter { (k: String) in sent.got[k] == nil }
                    if let first = missed.first {
                        partly.append("\(card.piece.name) didn't go to \(Self.listOf(missed.map(label))): \(sent.failed[first] ?? "Send failed")")
                    }
                    let short = places.filter { (k: String) in (sent.got[k] ?? 0) > 0 && (sent.got[k] ?? 0) < blobs.count }
                    if let first = short.first {
                        partly.append("\(Self.listOf(short.map(label))) got \(sent.got[first] ?? 0) of \(blobs.count) photos of \(card.piece.name): \(sent.failed[first] ?? "Send failed")")
                    }
                }
                if toIg {
                    do {
                        let ig = try await sendInstagram(card, blobs)
                        wentSomewhere = true
                        if ig.left > 0 {
                            partly.append("Instagram took the first \(ig.took) of \(ig.took + ig.left) photos of \(card.piece.name) (its limit).")
                        } else if ig.took > 1 {
                            igSaid.append("Instagram: \(Album.photosLabel(ig.took)) as one post.")
                        }
                    } catch {
                        // WhatsApp has it already: said beside it, not fatal. Instagram alone: the batch stops.
                        if !wentSomewhere { throw error }
                        partly.append("\(card.piece.name) didn't go to Instagram: \(error.localizedDescription)")
                    }
                }
                photoCounts[card.id] = blobs.count
                switch await keepWeight(card) {
                case .some(true): weighed.append(card.piece.name)
                case .some(false): unweighed.append(card.piece.name)
                case .none: break
                }
                finished.insert(card.id)
                done.append(card)
            } catch {
                stopped = (card.piece.name, error.localizedDescription)
                break
            }
        }
        if !done.isEmpty { await store.afterSending() }
        let n = done.count
        // A 400 is never retried by itself (a post must not go twice); the banner's Retry sends only what is left.
        if let s = stopped {
            throw ERPAPI.Failure(status: 400, message: (n > 0 ? "\(n) sent, then \(s.name) didn't go: " : "\(s.name) didn't go: ") + s.why)
        }
        if !partly.isEmpty {
            throw ERPAPI.Failure(status: 400, message: "Sent \(n) \(Self.noun(n)), not everywhere: " + partly.joined(separator: " · "))
        }
        var said = n == 0 ? "Nothing left to send" : "Posted \(n) \(Self.noun(n)) to \(Self.listOf(placeNamesSent(places, toIg)))"
        if !igSaid.isEmpty { said += ". " + igSaid.joined(separator: " ") }
        if !unweighed.isEmpty { said += ". The weight wasn't saved on \(store.siteName) for \(Self.listOf(unweighed)): add it in Website → Weights." }
        else if !weighed.isEmpty { said += ". Weight saved on \(store.siteName)." }
        return said
    }

    private func placeNamesSent(_ places: [String], _ toIg: Bool) -> [String] { places.map(label) + (toIg ? ["Instagram"] : []) }

    /// One piece's photos to the chosen WhatsApp places: photo by photo, each to every place still going, the caption
    /// under the first only (album.ts) — one request a photo. A place that fails a photo gets none of the rest.
    private func sendWhatsApp(_ card: PostTrayCard, _ blobs: [Data], _ places: [String]) async throws -> (got: [String: Int], failed: [String: String]) {
        let captions = Album.captions(card.caption, count: blobs.count)
        let base = Self.slug(card.piece)
        var failed: [String: String] = [:]
        var got: [String: Int] = [:]
        for i in blobs.indices {
            let live = Album.placesFor(places, failed: Set(failed.keys))
            if live.isEmpty { break }
            let fields: [(String, String)] = [("caption", captions[i]), ("sitePiece", card.id), ("targets", live.joined(separator: ","))]
            let file = WebsiteForm.File(field: "file", name: Album.fileName(base, i), type: "image/jpeg", data: blobs[i])
            let bytes: Data
            do {
                bytes = try await WebsiteForm.send("/api/website/post", fields: fields, files: [file], timeout: 300)
            } catch {
                // Nothing took the first photo: nothing went, and the batch stops here. Later: the places left miss the rest.
                if i == 0 { throw error }
                for k in live { failed[k] = error.localizedDescription }
                break
            }
            let answer = (try? JSONDecoder().decode(MarketingValue.self, from: bytes)) ?? .null
            let results = answer["results"].array
            if results.isEmpty {
                for k in live { got[k, default: 0] += 1 }
            }
            for r in results {
                let key = r.s("key")
                if r["ok"].bool {
                    got[key, default: 0] += 1
                } else {
                    let why = r.s("error")
                    failed[key] = why.isEmpty ? "Send failed" : why
                }
            }
        }
        return (got, failed)
    }

    /// One piece's photos as one Instagram post: a carousel of the first ten, the caption once, WhatsApp's markers off.
    /// How many photos went in the post, and how many were left out.
    private func sendInstagram(_ card: PostTrayCard, _ blobs: [Data]) async throws -> (took: Int, left: Int) {
        let plan = Album.carouselPlan(blobs.count)
        let base = Self.slug(card.piece)
        var files: [WebsiteForm.File] = []
        for i in 0..<plan.take {
            files.append(WebsiteForm.File(field: "file", name: Album.fileName(base, i), type: "image/jpeg", data: Self.feedJpeg(blobs[i])))
        }
        let fields: [(String, String)] = [("caption", Album.instagramText(card.caption)), ("fit", "crop"), ("sitePiece", card.id)]
        let bytes = try await WebsiteForm.send("/api/instagram/post", fields: fields, files: files, timeout: 300)
        let answer = (try? JSONDecoder().decode(MarketingValue.self, from: bytes)) ?? .null
        // The answer's own count wins; a one-photo post says neither.
        let took = answer["photos"] == .null ? plan.take : Int(answer.n("photos"))
        let left = answer["dropped"] == .null ? plan.dropped : Int(answer.n("dropped"))
        return (took, left)
    }

    /// A photo as Instagram's feed takes it: JPEG, at most 1440 px on its long side.
    private static func feedJpeg(_ data: Data) -> Data {
        guard let image = UIImage(data: data) else { return data }
        let side = max(image.size.width, image.size.height)
        guard side > 1440 else { return data }
        let scale = 1440 / side
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return small.jpegData(compressionQuality: 0.9) ?? data
    }

    /// Into the queue, to send later or spread over the day: each piece exactly as its card makes it now, every photo
    /// of it (up to Album.max), with an Instagram post when it is chosen. The tray clears at once; the Outbox does it.
    func queue() async -> Outcome {
        let batch = cards
        guard !batch.isEmpty else { return Outcome() }
        let places = whatsappPlaces
        let toIg = toInstagram
        cards = []
        active = nil
        var finished = Set<String>()
        Outbox.shared.post(label: "Queue \(batch.count) \(Self.noun(batch.count))") { [self] in
            for card in batch where card.caption.isEmpty && !card.edited && !finished.contains(card.id) { await refresh(card) }
            for card in batch where !finished.contains(card.id) {
                let blobs = try await albumData(card)
                let thumb = blobs.first.flatMap { (d: Data) in UIImage(data: d) }.flatMap { (img: UIImage) in AdsPhotoCodec.thumbnail(from: img) }
                try await enqueue(card, blobs: blobs, thumb: thumb, places: places, instagramPost: toIg)
                // Queued is as good as typed in for good: the website keeps the weight now, not when the post goes.
                _ = await keepWeight(card)
                finished.insert(card.id)
            }
            await store.refreshQueue()
            return "\(batch.count) \(Self.noun(batch.count)) in the queue"
        }
        var out = Outcome()
        out.notes.append(Note(title: "Queueing \(batch.count) \(Self.noun(batch.count))…", detail: "They go to the queue in the background."))
        return out
    }

    /// The queue's entry for a piece (DesignSend.queue's steps): the entry, each photo as "wa-<i>", then "ready" (held).
    /// A failure takes the half-made entry out so the retry starts clean.
    private func enqueue(_ card: PostTrayCard, blobs: [Data], thumb: Data?, places: [String], instagramPost: Bool) async throws {
        var qid: String?
        do {
            let counts: [String: Any] = ["site": 0, "wa": blobs.count, "story": false]
            var body: [String: Any] = ["headline": card.piece.name, "caption": card.caption, "fileBase": Self.slug(card.piece), "counts": counts,
                                       "instagram": false, "whatsapp": places, "website": NSNull(), "sitePiece": card.id]
            if instagramPost { body["instagramPost"] = true }
            if let thumb { body["thumb"] = thumb.base64EncodedString() }
            let made = try await MarketingRequest.send("/api/website/post/queue", body)
            qid = made["item"].s("id")
            guard let id = qid, !id.isEmpty else { throw ERPAPI.Failure(status: 0, message: "The queue gave no entry.") }
            for (i, data) in blobs.enumerated() {
                let key = "wa-\(i)"
                _ = try await WebsiteForm.send("/api/website/post/queue/" + id, fields: [("key", key)],
                                               files: [WebsiteForm.File(field: "file", name: key + ".jpg", type: "image/jpeg", data: data)])
            }
            _ = try await MarketingRequest.send("/api/website/post/queue/" + id, ["action": "ready"], method: "PATCH")
        } catch {
            if let id = qid, !id.isEmpty { _ = try? await MarketingRequest.send("/api/website/post/queue/" + id, method: "DELETE") }
            throw error
        }
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
    static func typedGrams(_ typed: String) -> Double { ShopNumber.parse(typed) ?? 0 }

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
