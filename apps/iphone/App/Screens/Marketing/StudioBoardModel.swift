import SwiftUI
import Observation
import ERPCore

/// Studio → Board on the phone (src/app/ads/studio/board.tsx): the same boards the browser and a connected
/// agent (Claude Code over /api/studio/mcp) change. Every change is a list of board-shape.ts operations the
/// server applies in a transaction, so this phone, the web page and the agent never overwrite each other.
/// Like the page, the phone lays out a design the agent put down without a layout, draws every design with
/// the shared engine (NativeArtwork), and sends each drawing back for the agent to look at.
@MainActor @Observable
final class StudioBoardModel {
    var boards: [MarketingValue] = []
    var current = ""
    var value = MarketingValue.null
    /// The revs already drawn for the agent, per design (the GET's `drawn`).
    var drawn: [String: Double] = [:]
    /// Each design's picture as last drawn, and the rev it shows.
    var pictures: [String: UIImage] = [:]
    var pictureRevs: [String: Int] = [:]
    var problems: [String: String] = [:]
    /// Designs an agent or the AI changed since the last look: they glow for a moment.
    var fresh: Set<String> = []
    /// A board made elsewhere (by the agent, or another phone) while this one was open.
    var offer: MarketingValue?
    /// The catalogue of formats and layouts (the engine's), handed over by the Studio.
    var catalogue = MarketingValue.null
    var loaded = false
    /// A short wait that blocks the board (saving, deleting).
    var busy: String?
    /// A long one that doesn't (Let it cook, this week's board): the board stays usable.
    var working: String?
    var error: String?
    var said: String?
    /// The list of boards couldn't be read: the canvas says so (with Try again) rather than offering a first board.
    var listProblem: String?

    @ObservationIgnored let engine = NativeArtwork()
    @ObservationIgnored private var photos: [String: Data] = [:]
    @ObservationIgnored private var pending = 0
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var layingOut: Set<String> = []
    @ObservationIgnored private var sendingView: [String: Int] = [:]
    @ObservationIgnored private var drawing = false
    @ObservationIgnored private var drawAgain = false
    @ObservationIgnored private var known: Set<String>?
    @ObservationIgnored private var ticks = 0

    private static var lastKey: String { "studio.board.last." + House.id }
    /// Board units per design pixel (board-shape.ts BOARD_SCALE), the label strip above a design, and a note's size.
    static let scale = 1.0 / 3.0
    static let label = 28.0
    static let noteSize = CGSize(width: 240, height: 160)
    /// The size each design is drawn at for the board, and for the agent to look at (board.tsx SHOW_PX, VIEW_PX).
    static let showPx = 540
    static let viewPx = 720
    /// Angles for Let it cook: each variant asked for the owner's brief from a different side (board.tsx ANGLES).
    static let angles = ["", "bold and graphic, one strong line", "quiet luxury — very few words", "heritage and trust", "as a gift", "the craft, up close"]

    var frames: [MarketingValue] { value["frames"].array }
    var notes: [MarketingValue] { value["notes"].array }
    func frame(_ id: String) -> MarketingValue? { frames.first { $0.s("id") == id } }
    func note(_ id: String) -> MarketingValue? { notes.first { $0.s("id") == id } }

    /// An agent changed the board in the last two minutes: asked for more often, and said so.
    var agentBusy: Bool {
        guard value.s("by").hasPrefix("agent:"), let at = ERPDate.parse(value.s("updated")) else { return false }
        return Date().timeIntervalSince(at) < 120
    }

    // MARK: Shapes

    func formatInfo(_ format: String) -> MarketingValue {
        let all = catalogue["formats"].array
        return all.first { $0.s("id") == format } ?? all.first { $0.s("id") == "portrait" } ?? MarketingValue(["label": "Feed · 4:5", "short": "4:5", "ai": "4:5", "frame": ["w": 1080, "h": 1350]])
    }
    var formats: [MarketingValue] { catalogue["formats"].array.filter { $0.s("id") != "custom" } }
    func templateLabel(_ id: String) -> String { catalogue["templates"].array.first { $0.s("id") == id }?.s("label") ?? id }

    /// The design's size in pixels: its document's frame, else its format's (board-shape.ts framePx).
    func pixels(_ f: MarketingValue) -> CGSize {
        let docFrame = f["doc"]["frame"]
        if docFrame != .null { return CGSize(width: docFrame.n("w", 1080), height: docFrame.n("h", 1350)) }
        let frame = formatInfo(f.s("format", "portrait"))["frame"]
        return CGSize(width: frame.n("w", 1080), height: frame.n("h", 1350))
    }

    /// Every design and note, in board units, with the strip each design's label takes above it.
    private var rects: [CGRect] {
        frames.map { f in let p = pixels(f); return CGRect(x: f.n("x"), y: f.n("y") - Self.label, width: p.width * Self.scale, height: p.height * Self.scale + Self.label) }
        + notes.map { CGRect(x: $0.n("x"), y: $0.n("y"), width: Self.noteSize.width, height: Self.noteSize.height) }
    }
    /// The board's top-left corner and size, padded, so the canvas scrolls over exactly what is on it.
    var bounds: CGRect {
        let all = rects
        guard let first = all.first else { return CGRect(x: -40, y: -40, width: 800, height: 600) }
        return all.dropFirst().reduce(first) { $0.union($1) }.insetBy(dx: -80, dy: -80)
    }
    func fitZoom(in size: CGSize) -> Double {
        let b = bounds
        guard b.width > 0, b.height > 0, size.width > 0, size.height > 0 else { return 0.55 }
        return min(1.5, max(0.08, min(size.width / b.width, size.height / b.height)))
    }

    /// A layout that works for the photo and the shape (board-shape.ts safeTemplate): the full-bleed layouts
    /// cut the mark taheri.shop burns into its photos and put the words across the piece on a 9:16.
    static func safeTemplate(_ template: String, marked: Bool, format: String) -> String {
        (marked || format == "story") && ["headline", "clean", "band", "certified"].contains(template) ? "framed" : template
    }

    // MARK: Reading

    func run(_ title: String, _ work: () async throws -> Void) async {
        guard busy == nil else { return }
        busy = title; error = nil; defer { busy = nil }
        do { try await work() } catch { self.error = error.localizedDescription }
    }

    func loadList(initial: Bool = false) async {
        if House.isDemo { demo(); return }
        do {
            let list = try await MarketingRequest.get("/api/ads/studio/boards")["boards"].array
            boards = list
            let ids = Set(list.map { $0.s("id") })
            if let seen = known, let new = list.first(where: { !seen.contains($0.s("id")) }) {
                offer = new
                if current.isEmpty { await choose(new.s("id")) }
            }
            known = ids
            listProblem = nil
            if initial || (!current.isEmpty && !ids.contains(current)) {
                let last = UserDefaults.standard.string(forKey: Self.lastKey) ?? ""
                let pick = ids.contains(current) ? current : ids.contains(last) ? last : list.first?.s("id") ?? ""
                if pick != current || value == .null { await choose(pick) }
            }
            loaded = true
        } catch { if initial || boards.isEmpty { listProblem = error.localizedDescription }; loaded = true }
    }

    func choose(_ id: String) async {
        generation += 1
        current = id; value = .null; drawn = [:]; pictures = [:]; pictureRevs = [:]; problems = [:]; fresh = []
        layingOut = []; sendingView = [:]
        if offer?.s("id") == id { offer = nil }
        guard !id.isEmpty else { return }
        UserDefaults.standard.set(id, forKey: Self.lastKey)
        await load()
    }

    func load() async {
        guard !current.isEmpty, !House.isDemo else { return }
        let asked = generation, id = current
        do {
            let r = try await MarketingRequest.get("/api/ads/studio/boards/" + AdsQuery.escape(id))
            guard asked == generation else { return }
            value = r["board"]; drawn = r["drawn"].object.mapValues(\.number)
            draw()
        } catch {
            guard asked == generation else { return }
            self.error = error.localizedDescription
        }
    }

    /// What an agent or another phone changed (the page's poll): nothing is sent back when nothing moved.
    func refresh(force: Bool = false) async {
        ticks += 1
        if ticks % 2 == 0 || force { await loadList() }
        guard !current.isEmpty, !House.isDemo, pending == 0 || force else { return }
        if force { await load(); return }
        let asked = generation, id = current, rev = Int(value.n("rev"))
        do {
            let r = try await MarketingRequest.get("/api/ads/studio/boards/" + AdsQuery.escape(id) + "?since=\(rev)")
            guard asked == generation, pending == 0, r["board"] != .null else { return }
            let before = Dictionary(frames.map { ($0.s("id"), Int($0.n("rev"))) }, uniquingKeysWith: { a, _ in a })
            let next = r["board"]
            let changed = next["frames"].array.filter { before[$0.s("id")] != Int($0.n("rev")) && $0.s("by") != "page" }.map { $0.s("id") }
            value = next
            if r["drawn"] != .null { drawn = r["drawn"].object.mapValues(\.number) }
            if !changed.isEmpty {
                fresh = Set(changed)
                Task { try? await Task.sleep(for: .seconds(2.5)); if fresh == Set(changed) { fresh = [] } }
            }
            draw()
        } catch { /* the next poll */ }
    }

    // MARK: Changing

    /// Change the board: shown at once where the change is simple, then applied on the server, whose answer is the truth.
    @discardableResult
    func change(_ ops: [[String: Any]]) async -> [String] {
        guard !current.isEmpty else { return [] }
        if House.isDemo { error = "The demo board is read-only."; return [] }
        let asked = generation, id = current
        applyLocally(ops)
        pending += 1
        defer { pending -= 1 }
        do {
            let r = try await MarketingRequest.send("/api/ads/studio/boards/" + AdsQuery.escape(id), ["ops": ops], method: "PATCH")
            guard asked == generation else { return [] }
            value = r["board"]
            draw()
            return r["added"].array.map(\.string)
        } catch {
            guard asked == generation else { return [] }
            self.error = error.localizedDescription
            await load()
            return []
        }
    }

    /// The simple operations, as board-shape.ts applies them, so a move or an edit doesn't wait for the server.
    private func applyLocally(_ ops: [[String: Any]]) {
        var next = value
        for o in ops {
            let op = o["op"] as? String ?? "", id = o["id"] as? String ?? ""
            func edit(_ key: String, _ body: (inout MarketingValue) -> Void) {
                next[key] = .array(next[key].array.map { var item = $0; if item.s("id") == id { body(&item) }; return item })
            }
            switch op {
            case "move": edit("frames") { $0["x"] = .number(o["x"] as? Double ?? $0.n("x")); $0["y"] = .number(o["y"] as? Double ?? $0.n("y")) }
            case "noteMove": edit("notes") { $0["x"] = .number(o["x"] as? Double ?? $0.n("x")); $0["y"] = .number(o["y"] as? Double ?? $0.n("y")) }
            case "noteText": edit("notes") { $0["text"] = .string(o["text"] as? String ?? $0.s("text")) }
            case "remove": next["frames"] = .array(next["frames"].array.filter { $0.s("id") != id })
            case "noteRemove": next["notes"] = .array(next["notes"].array.filter { $0.s("id") != id })
            case "rename": if let name = o["name"] as? String, !name.trimmingCharacters(in: .whitespaces).isEmpty { next["name"] = .string(name) }
            case "put": if let patch = o["patch"] as? [String: Any], let label = patch["label"] as? String, patch.count == 1 { edit("frames") { $0["label"] = .string(label) } }
            default: break
            }
        }
        value = next
    }

    func create(_ name: String) async {
        if House.isDemo { error = "The demo board is read-only."; return }
        await run("Making the board…") {
            let r = try await MarketingRequest.send("/api/ads/studio/boards", ["name": name])
            await loadList()
            await choose(r["board"].s("id"))
        }
    }

    func delete() async {
        guard !current.isEmpty else { return }
        if House.isDemo { error = "The demo board is read-only."; return }
        await run("Deleting the board…") {
            _ = try await MarketingRequest.send("/api/ads/studio/boards/" + AdsQuery.escape(current), method: "DELETE")
            UserDefaults.standard.removeObject(forKey: Self.lastKey)
            await choose("")
            await loadList(initial: true)
        }
    }

    func rename(_ name: String) async {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean != value.s("name") else { return }
        await change([["op": "rename", "name": clean]])
        await loadList()
    }

    /// This week's board, now (weekly.ts; the tick makes one itself on Mondays from 9:00): designed a few at a
    /// time while the phone waits; it opens as soon as it exists.
    func weekly() async {
        if House.isDemo { error = "The demo board is read-only."; return }
        guard working == nil else { return }
        working = "Starting this week’s board…"; defer { working = nil }
        do {
            var action = "start", lastDone = -1.0
            for i in 0..<12 {
                let w = try await MarketingRequest.send("/api/ads/studio/weekly", ["action": action])["weekly"]
                if i == 0, !w.s("board").isEmpty { await loadList(); await choose(w.s("board")) }
                action = "continue"
                let failed = w["failed"].array.count, done = w.n("done")
                if w["pending"].array.isEmpty {
                    said = "This week’s board is ready: \(Int(done)) piece\(done == 1 ? "" : "s") designed" + (failed > 0 ? "; \(failed) couldn’t be." : ".")
                    break
                }
                working = "\(Int(done)) designed, \(w["pending"].array.count) to go…"
                // Nothing new this round (the AI's per-minute quota, or the tick at it): wait before asking again.
                let stuck = done == lastDone
                lastDone = done
                if w["busy"].bool || stuck { try await Task.sleep(for: .seconds(w["busy"].bool ? 15 : 60)) }
                await refresh(force: true)
            }
        } catch { if !(error is CancellationError) { self.error = error.localizedDescription } }
    }

    /// A library photo as a new design (board.tsx addPhoto): the website photo's unmarked Drive original when
    /// there is one, so the frame never cuts a burned-in wordmark.
    @discardableResult
    func add(_ item: MarketingValue, format: String) async -> String? {
        let original = item["original"].s("id")
        let marked = item.s("source") == "site" && original.isEmpty
        let fid = "frame-" + Self.shortID()
        let kicker = item.s("source") == "site" && item.s("collection") != "Website" ? item.s("collection") : ""
        let cta = (catalogue["brand"]["voice"]["ctas"].array.first?.string ?? "Message us").replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression)
        let headline = item["assessment"].s("headline").isEmpty ? item.s("name") : item["assessment"].s("headline")
        let frame: [String: Any] = [
            "id": fid, "assetId": original.isEmpty ? item.s("id") : original, "marked": marked, "format": format,
            "template": Self.safeTemplate("headline", marked: marked, format: format), "label": item.s("name"), "by": "page", "doc": NSNull(),
            "fields": ["kicker": kicker, "headline": headline, "weight": item.s("specs"), "details": cta],
        ]
        let added = await change([["op": "add", "frame": frame]])
        return added.first
    }

    /// A note in the server's own spot for it: down the left of the board, beside the designs.
    func addNote() async -> String? {
        let nid = "note-" + Self.shortID()
        let note: [String: Any] = ["id": nid, "text": "Note"]
        let added = await change([["op": "note", "note": note]])
        return added.first
    }

    /// The same design again beside it, or the same layout in another shape (laid out afresh for that shape).
    func duplicate(_ f: MarketingValue, format: String? = nil) async {
        var frame = f.object.filter { !["id", "rev", "x", "y"].contains($0.key) }.mapValues(\.any)
        frame["by"] = "page"
        if let format {
            frame["format"] = format; frame["doc"] = NSNull()
            frame["template"] = Self.safeTemplate(f.s("template", "headline"), marked: f["marked"].bool, format: format)
            frame["label"] = f.s("label") + " · " + formatInfo(format).s("short", format)
        } else {
            frame["label"] = f.s("label") + " · copy"
        }
        await change([["op": "add", "near": f.s("id"), "frame": frame]])
    }

    /// Let it cook (board.tsx cook): the AI designs n variants of this design, each from a different angle, three
    /// at a time (the AI key's per-minute quota is shared with the counter); the server puts each beside the last.
    func cook(_ f: MarketingValue, count: Int, brief: String) async {
        guard working == nil else { return }
        let asset = f.s("assetId")
        guard !asset.isEmpty else { error = "This design has no photo to work from."; return }
        working = "Cooking \(count) variants — about a minute…"; defer { working = nil }
        do {
            let photo = try await photoData(asset)
            let info = formatInfo(f.s("format", "portrait"))
            let fields = f["fields"]
            var directions: [MarketingValue?] = []
            var start = 0
            while start < count {
                let batch = Array(start..<min(start + 3, count))
                let got = await withTaskGroup(of: (Int, MarketingValue?).self) { group in
                    for i in batch {
                        let params: [String: Any] = [
                            "name": f.s("label"), "collection": fields.s("kicker"), "specs": fields.s("weight"), "price": "", "format": f.s("format", "portrait"),
                            "aspect": info.s("ai", "4:5"), "shape": info.s("label"),
                            "brief": [brief.trimmingCharacters(in: .whitespacesAndNewlines), Self.angles[i % Self.angles.count]].filter { !$0.isEmpty }.joined(separator: " — "),
                            "destination": "a WhatsApp chat with the shop", "kicker": fields.s("kicker"), "headline": fields.s("headline"), "cta": fields.s("details"),
                        ]
                        group.addTask { @MainActor in
                            do {
                                let bytes = try await WebsiteForm.send("/api/ads/studio/auto", fields: [("op", "direct"), ("params", WebsiteForm.text(params))], files: [.init(field: "image", name: "photo.jpg", type: "image/jpeg", data: photo)], timeout: 300)
                                return (i, try JSONDecoder().decode(MarketingValue.self, from: bytes)["direction"])
                            } catch { return (i, nil) }
                        }
                    }
                    var out: [(Int, MarketingValue?)] = []
                    for await r in group { out.append(r) }
                    return out.sorted { $0.0 < $1.0 }.map(\.1)
                }
                directions += got
                start += 3
            }
            var near = f.s("id"), made = 0
            for (i, d) in directions.enumerated() {
                guard let d, d != .null else { continue }
                var frame = f.object.filter { !["id", "rev", "x", "y"].contains($0.key) }.mapValues(\.any)
                frame["by"] = "ai"; frame["doc"] = NSNull(); frame["why"] = d.s("why"); frame["label"] = f.s("label") + " · \(i + 1)"
                frame["template"] = Self.safeTemplate(d.s("layout", f.s("template", "headline")), marked: f["marked"].bool, format: f.s("format", "portrait"))
                frame["fields"] = ["kicker": d.s("kicker"), "headline": d.s("headline").isEmpty ? fields.s("headline") : d.s("headline"),
                                   "weight": fields.s("weight"), "details": d.s("cta").isEmpty ? fields.s("details") : d.s("cta")]
                let added = await change([["op": "add", "near": near, "frame": frame]])
                if let first = added.first { near = first; made += 1 }
            }
            let missing = directions.filter { $0 == nil || $0 == .null }.count
            said = made > 0 ? "\(made) variant\(made == 1 ? "" : "s") on the board" + (missing > 0 ? "; \(missing) didn’t come." : ".") : "No variants came. Try again in a minute."
        } catch { self.error = error.localizedDescription }
    }

    // MARK: Photos and drawing

    func photoData(_ asset: String) async throws -> Data {
        if let data = photos[asset] { return data }
        let data = try await ERPAPI.shared.data("/api/ads/studio/image?id=" + AdsQuery.escape(asset) + "&size=1600")
        photos[asset] = data
        return data
    }

    /// The design's photos as the engine takes them: its own as "photo", and any other library photos it holds as
    /// image layers ("lib:<asset>", a product shot beside the hand that wears it).
    func photoSet(_ f: MarketingValue, doc: MarketingValue? = nil) async throws -> [String: Data] {
        var out: [String: Data] = [:]
        if !f.s("assetId").isEmpty { out["photo"] = try await photoData(f.s("assetId")) }
        let layers = (doc ?? f["doc"])["layers"].array
        for l in layers where l.s("kind") == "image" && l["src"] == .null && l.s("photoId").hasPrefix("lib:") {
            let id = l.s("photoId")
            if out[id] == nil, let data = try? await photoData(String(id.dropFirst(4))) { out[id] = data }
        }
        return out
    }

    func fields(_ f: MarketingValue) -> [String: String] {
        var out = ["kicker": "", "headline": "", "weight": "", "details": ""]
        for (k, v) in f["fields"].object { out[k] = v.string }
        return out
    }

    /// The template laid out on a blank of the design's shape (board.tsx layOut).
    func layOut(_ f: MarketingValue, format: String? = nil, template: String? = nil, photos: [String: Data]) async throws -> MarketingValue {
        let shape = format ?? f.s("format", "portrait")
        let t = template ?? (format == nil ? f.s("template", "headline") : Self.safeTemplate(f.s("template", "headline"), marked: f["marked"].bool, format: shape))
        let r = try await engine.run(doc: NativeArtwork.blank(photo: "photo"), photos: photos, fields: fields(f), options: ["action": "ad", "value": t, "format": shape, "photoMarked": f["marked"].bool])
        return r["doc"]
    }

    /// The design as a JPEG at full size (or the same layout in another shape: the story for Instagram).
    func render(_ f: MarketingValue, shape: String? = nil, px: Int? = nil, quality: Double = 0.92) async throws -> (jpeg: Data, doc: MarketingValue, photo: Data?) {
        let set = try await photoSet(f)
        let doc: MarketingValue
        if let shape, shape != f.s("format") { doc = try await layOut(f, format: shape, photos: set) }
        else if f["doc"] != .null { doc = f["doc"] }
        else { doc = try await layOut(f, photos: set) }
        let width = px ?? Int(doc["frame"].n("w", pixels(f).width))
        let r = try await engine.run(doc: doc, photos: set, fields: fields(f), options: ["px": width, "quality": quality])
        guard let bytes = Data(base64Encoded: r.s("image")) else { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn.") }
        return (bytes, doc, set["photo"])
    }

    /// Draw every design whose picture is behind its rev, one at a time (one engine); a design without a layout
    /// is laid out once and the layout saved, as the page does for an agent's designs.
    func draw() {
        if drawing { drawAgain = true; return }
        drawing = true
        Task {
            defer { drawing = false; if drawAgain { drawAgain = false; draw() } }
            let asked = generation, board = current
            for f in frames {
                guard asked == generation else { return }
                let id = f.s("id"), rev = Int(f.n("rev"))
                if pictureRevs[id] == rev && (f["doc"] == .null || Int(drawn[id] ?? -1) == rev || sendingView[id] == rev) { continue }
                do {
                    let set = try await photoSet(f)
                    guard asked == generation else { return }
                    if f["doc"] == .null {
                        let key = "\(id):\(rev)"
                        guard !layingOut.contains(key) else { continue }
                        layingOut.insert(key)
                        let doc = try await layOut(f, photos: set)
                        let shown = try await engine.run(doc: doc, photos: set, fields: fields(f), options: ["px": Self.showPx, "quality": 0.86])
                        if let image = NativeArtwork.image(shown) { pictures[id] = image; pictureRevs[id] = rev }
                        Task { await change([["op": "put", "id": id, "patch": ["doc": doc.any]]]) }
                        continue
                    }
                    if pictureRevs[id] != rev {
                        let shown = try await engine.run(doc: f["doc"], photos: set, fields: fields(f), options: ["px": Self.showPx, "quality": 0.86])
                        guard asked == generation else { return }
                        if let image = NativeArtwork.image(shown) { pictures[id] = image; pictureRevs[id] = rev; problems[id] = nil }
                    }
                    // The agent's copy: drawn again only when the design has changed since.
                    if Int(drawn[id] ?? -1) != rev, sendingView[id] != rev, !House.isDemo {
                        sendingView[id] = rev
                        let view = try await engine.run(doc: f["doc"], photos: set, fields: fields(f), options: ["px": Self.viewPx, "quality": 0.85])
                        if let jpeg = Data(base64Encoded: view.s("image")) {
                            do {
                                _ = try await WebsiteForm.send("/api/ads/studio/boards/" + AdsQuery.escape(board) + "/view", fields: [("frame", id), ("rev", String(rev))], files: [.init(field: "image", name: "view.jpg", type: "image/jpeg", data: jpeg)])
                                if asked == generation { drawn[id] = Double(rev) }
                            } catch { sendingView[id] = nil }
                        }
                    }
                } catch {
                    if asked == generation { problems[id] = error.localizedDescription }
                }
            }
        }
    }

    // MARK: Out of the board (board.tsx: Saved ads, a new Meta ad, the post queue)

    func saveToSaved(_ f: MarketingValue) async {
        await run("Saving to Saved ads…") {
            let full = try await render(f)
            let thumb = try await render(f, px: 200, quality: 0.7)
            let fieldValues = fields(f)
            let meta: [String: Any] = [
                "folder": NSNull(), "name": fieldValues["headline"].flatMap { $0.isEmpty ? nil : $0 } ?? (f.s("label").isEmpty ? "Board design" : f.s("label")),
                "format": f.s("format", "portrait"), "template": f.s("template", "headline"), "fields": fieldValues, "price": "", "text": "",
                "headline": fieldValues["headline"] ?? "", "goal": "whatsapp", "link": "",
                "asset": f.s("assetId").isEmpty ? NSNull() as Any : ["id": f.s("assetId"), "name": f.s("label")] as Any,
                "thumb": "data:image/jpeg;base64," + thumb.jpeg.base64EncodedString(),
            ]
            var files: [WebsiteForm.File] = [.init(field: "image", name: "ad.jpg", type: "image/jpeg", data: full.jpeg)]
            if let photo = full.photo { files.append(.init(field: "photo", name: "photo.jpg", type: WebsitePhoto.kind(of: photo)?.mime ?? "image/jpeg", data: photo)) }
            files.append(.init(field: "doc", name: "doc.json", type: "application/json", data: full.doc.data))
            _ = try await WebsiteForm.send("/api/ads/studio/saved", fields: [("meta", WebsiteForm.text(meta))], files: files)
            said = "Saved, in Studio → Saved."
        }
    }

    /// The design (and its 9:16 for a feed shape) uploaded to the ad account, then handed to New ad.
    func newAd(_ f: MarketingValue) async -> Route? {
        var route: Route?
        await run("Putting it in a new ad…") {
            func upload(_ data: Data, _ name: String) async throws -> MarketingValue {
                try JSONDecoder().decode(MarketingValue.self, from: await WebsiteForm.send("/api/ads/images", fields: [], files: [.init(field: "file", name: name, type: "image/jpeg", data: data)]))
            }
            let fieldValues = fields(f), headline = fieldValues["headline"] ?? ""
            let feed = ["portrait", "square"].contains(f.s("format"))
            let up = try await upload(render(f).jpeg, "ad.jpg")
            var vertical = MarketingValue.null
            if feed { vertical = try await upload(render(f, shape: "story").jpeg, "ad-9x16.jpg") }
            var link = ""
            if let site = try? await MarketingRequest.get("/api/app/website") { link = site.s("site") }
            _ = try? await MarketingRequest.send("/api/ads/studio/creatives", ["assets": f.s("assetId").isEmpty ? [] : [f.s("assetId")], "hash": up.s("hash"), "url": up["url"].any, "format": f.s("format"), "name": headline])
            let key = UUID().uuidString
            var verticalAny: Any = NSNull()
            if vertical != .null { verticalAny = ["hash": vertical.s("hash"), "url": vertical["url"].any] as [String: Any] }
            let photo: [String: Any] = ["hash": up.s("hash"), "url": up["url"].any, "headline": headline, "link": link]
            StudioHandoffs.shared.ads[key] = MarketingValue([
                "photos": [photo],
                "vertical": verticalAny,
                "text": [fieldValues["headline"] ?? "", fieldValues["weight"] ?? "", fieldValues["details"] ?? ""].filter { !$0.isEmpty }.joined(separator: "\n"),
                "headline": headline, "goal": "whatsapp", "link": link,
                "name": (headline.isEmpty ? f.s("label") : headline) + " · " + formatInfo(f.s("format")).s("short") + (feed ? " + 9:16" : ""),
            ])
            route = Route(path: "/ads/new?studio=" + key)
        }
        return route
    }

    /// Into the post queue, held: it waits in Posts → Hub to be sent now or at a time. Nothing goes out from here.
    func queue(_ f: MarketingValue, whatsapp: [String], instagram: Bool, caption: String) async {
        await run("Queuing the post…") {
            var qid: String?
            do {
                let fieldValues = fields(f)
                let name = (fieldValues["headline"] ?? "").isEmpty ? f.s("label") : fieldValues["headline"] ?? ""
                var wa: Data?, story: Data?
                if !whatsapp.isEmpty { wa = try await render(f).jpeg }
                if instagram { story = try await render(f, shape: "story", px: 1080).jpeg }
                let thumb = try await render(f, px: 240, quality: 0.7).jpeg.base64EncodedString()
                let fileBase = name.lowercased().replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
                let item = try await MarketingRequest.send("/api/website/post/queue", [
                    "headline": name, "caption": caption, "fileBase": fileBase.isEmpty ? "design" : fileBase,
                    "counts": ["site": 0, "wa": wa == nil ? 0 : 1, "story": story != nil] as [String: Any], "website": NSNull(), "instagram": story != nil, "whatsapp": whatsapp, "thumb": thumb,
                ])["item"]
                qid = item.s("id")
                guard let id = qid, !id.isEmpty else { throw ERPAPI.Failure(status: 0, message: "The queue gave no entry.") }
                for (key, data) in [("wa-0", wa), ("story", story)] {
                    guard let data else { continue }
                    _ = try await WebsiteForm.send("/api/website/post/queue/" + id, fields: [("key", key)], files: [.init(field: "file", name: key + ".jpg", type: "image/jpeg", data: data)])
                }
                _ = try await MarketingRequest.send("/api/website/post/queue/" + id, ["action": "ready"], method: "PATCH")
                said = "In the post queue: Posts → Hub, send it now or set a time."
            } catch {
                if let id = qid, !id.isEmpty { _ = try? await MarketingRequest.send("/api/website/post/queue/" + id, method: "DELETE") }
                throw error
            }
        }
    }

    // MARK: The demo

    /// The simulator's demo: a sample board to look at, drawn locally; nothing is sent.
    private func demo() {
        guard value == .null else { loaded = true; return }
        boards = [MarketingValue(["id": "demo-board", "name": "Eid ideas", "frames": 2, "notes": 2, "updated": "", "by": "page"])]
        current = "demo-board"
        let fields: [String: Any] = ["kicker": "New in", "headline": "Emerald halo ring", "weight": "4.2 g · 21k", "details": "Message us"]
        let frames: [[String: Any]] = [
            ["id": "frame-demo1", "x": 0, "y": 0, "label": "Emerald halo", "format": "portrait", "assetId": NSNull(), "marked": false, "template": "headline", "fields": fields, "doc": NSNull(), "by": "page", "rev": 1],
            ["id": "frame-demo2", "x": 408, "y": 0, "label": "Emerald halo · 1", "format": "square", "assetId": NSNull(), "marked": false, "template": "framed", "fields": fields, "doc": NSNull(), "by": "ai", "rev": 1, "why": "A quiet frame lets the stone lead."],
        ]
        let notes: [[String: Any]] = [
            ["id": "note-demo1", "x": -280, "y": 0, "text": "Eid gifting: rings under 5 g first.", "by": "page"],
            ["id": "note-demo2", "x": -280, "y": 200, "text": "Try the framed layout for site photos.", "by": "agent"],
        ]
        let board: [String: Any] = ["id": "demo-board", "name": "Eid ideas", "rev": 3, "updated": "", "by": "page", "frames": frames, "notes": notes]
        value = MarketingValue(board)
        loaded = true
        drawDemo()
    }

    private func drawDemo() {
        Task {
            for f in frames {
                do {
                    let doc = try await layOut(f, photos: [:])
                    let shown = try await engine.run(doc: doc, photos: [:], fields: fields(f), options: ["px": Self.showPx, "quality": 0.86])
                    if let image = NativeArtwork.image(shown) { pictures[f.s("id")] = image; pictureRevs[f.s("id")] = Int(f.n("rev")) }
                } catch { problems[f.s("id")] = error.localizedDescription }
            }
        }
    }

    static func shortID() -> String { String(UUID().uuidString.lowercased().filter(\.isLetter).prefix(4) + UUID().uuidString.lowercased().filter(\.isNumber).prefix(3)) }
}
