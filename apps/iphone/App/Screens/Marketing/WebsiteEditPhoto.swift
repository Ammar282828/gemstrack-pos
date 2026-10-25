import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import Observation

/// Edit a piece's photograph, re-made on the phone as edit/page.tsx `PieceEditor` re-makes it: always from the photo as
/// the site built it (`site-pieces/image?original=1&size=3000`), the last design kept on the ERP (`/api/website/edits`
/// `design`) so a piece re-opens as it was left and a stamp never goes on twice, its own shape or square, the layouts
/// that stamp the weight and the house's mark (site-design.ts `siteLayouts`, through the bundled engine), the designer,
/// and AI Enhance or Ask AI (`/api/website/post/ai`). The drawing is the web's own engine (NativeArtwork); what goes up is
/// rendered at the web's size and quality and saved with the words in one form (`WebsiteEditPieceScreen.save`).
@MainActor
@Observable
final class WebsitePhotoEdit {
    /// The photo as the site built it; an AI one is `ai-…` and is never kept in the design (toKeep).
    static let sitePhoto = "site"

    struct Photo: Identifiable {
        let id: String
        let label: String
        let data: Data
        /// Its pixels (UIImage(data:) is scale 1), for the frame's own shape and the size it goes up at.
        let size: CGSize
    }

    let pieceID: String
    let engine = NativeArtwork()
    private(set) var photos: [Photo] = []
    var doc: MarketingValue = .null
    private(set) var shape = "own"
    private(set) var layout = "clean"
    private(set) var layouts: [MarketingValue] = []
    /// What the AI did to the photo going up, in the order it was done ("Enhanced", "Changed with AI").
    private(set) var ai: [String] = []
    private(set) var ready = false
    private(set) var loading = false
    private(set) var problem: String?
    /// The last design's AI, said once: editing starts from the original photo.
    private(set) var lastAI: [String] = []
    private(set) var preview: UIImage?
    /// The design and words as they were when editing began or was last saved: a photo goes up only when they differ.
    private var firstSig = ""

    init(pieceID: String) { self.pieceID = pieceID }

    var photoData: [String: Data] { Dictionary(uniqueKeysWithValues: photos.map { (p: Photo) in (p.id, p.data) }) }
    private var base: Photo? { photos.first { (p: Photo) in p.id == Self.sitePhoto } }
    /// The photo on show: the site's, or an AI one chosen over it.
    var current: Photo? { photos.first { (p: Photo) in p.id == doc["bg"].s("photoId") } ?? photos.first }

    // MARK: What the design depends on

    private func bound(_ d: MarketingValue) -> Bool {
        d["layers"].array.contains { (l: MarketingValue) in l.s("kind") == "text" && !l.s("bind").isEmpty && !l["hidden"].bool }
    }
    /// What the photo going up depends on: the design, and the words drawn on it (the web's `sig`).
    func sig(_ fields: [String: String]) -> String {
        doc.text + (bound(doc) ? fields.sorted { (a: (key: String, value: String), b: (key: String, value: String)) in a.key < b.key }.description : "")
    }
    func changed(_ fields: [String: String]) -> Bool { ready && sig(fields) != firstSig }
    /// The weight stamped on the photo going up (the route keeps it, so the site doesn't stamp it again).
    func stamped(_ fields: [String: String]) -> Bool {
        !(fields["weight"] ?? "").isEmpty && doc["layers"].array.contains { (l: MarketingValue) in
            l.s("kind") == "text" && l.s("bind") == "weight" && !l["hidden"].bool
        }
    }
    func saved(_ fields: [String: String]) { firstSig = sig(fields) }
    /// The layouts that show the weight (site-design.ts `showsWeight`).
    var layoutShowsWeight: Bool { layout != "clean" && layout != "mark" && layout != "catalogue-t" }

    // MARK: Frames and documents (edit/page.tsx frameFor, blankDoc, toKeep)

    /// The photo's own shape, 1080 wide (between half and twice as tall as wide), or the square.
    private func frame(_ s: String) -> MarketingValue {
        guard s == "own", let size = base?.size, size.width > 0 else { return MarketingValue(["w": 1080, "h": 1080]) }
        let h = (min(2, max(0.5, Double(size.height / size.width))) * 1080).rounded()
        return MarketingValue(["w": 1080, "h": h])
    }
    private func blank(_ s: String) -> MarketingValue {
        var d = NativeArtwork.blank(photo: Self.sitePhoto, height: 1080)
        d["frame"] = frame(s)
        d["placements"] = .object([:])
        return d
    }
    private static let fill = MarketingValue(["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5])
    /// The placement of the photo on show (editor.ts placementOf).
    private static func placement(_ d: MarketingValue) -> MarketingValue {
        guard d["placements"] != .null else { return d["bg"]["placement"] }
        let id = d["bg"].s("photoId")
        return id.isEmpty || d["placements"][id] == .null ? fill : d["placements"][id]
    }
    /// A design to keep: always over the site's photo (an AI one isn't kept), and only its own crop.
    var kept: MarketingValue {
        var d = doc
        d["bg"]["photoId"] = .string(Self.sitePhoto)
        d["placements"] = .object([Self.sitePhoto: Self.placement(doc)])
        d["layers"] = .array(doc["layers"].array.filter { (l: MarketingValue) in l.s("kind") != "image" || !l.s("src").isEmpty })
        return d
    }

    // MARK: Starting

    /// The piece's last design and its photograph as the site built it; the design starts as it was last left, or with the
    /// house's start layout on the photo as it is.
    func begin(_ piece: WebsiteEditPiece, fields: [String: String]) async {
        guard !loading, !ready else { return }
        loading = true
        problem = nil
        defer { loading = false }
        do {
            let q = WebsiteNumber.query(piece.id)
            async let info = MarketingRequest.get("/api/website/edits?id=\(q)")
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            let bytes = try await ERPAPI.shared.data("/api/website/site-pieces/image?id=\(q)&original=1&size=3000&t=\(stamp)", timeout: 120)
            guard let image = UIImage(data: bytes), image.size.width > 0 else {
                throw ERPAPI.Failure(status: 0, message: "The photograph didn’t come as a picture.")
            }
            // The design is the route's; a failed read starts afresh, as the web does.
            let saved = (try? await info) ?? .null
            photos = [Photo(id: Self.sitePhoto, label: "The website’s photo", data: bytes,
                            size: CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale))]
            let start = try await engine.run(doc: .null, photos: [:], fields: [:], options: [
                "action": "siteLayouts", "sitePiece": ["photoSource": piece.photoSource as Any? ?? NSNull(), "sourceMarked": piece.sourceMarked] as [String: Any],
            ])
            layouts = start["layouts"].array
            layout = start.s("start", "clean")
            let design = saved["design"]
            if design != .null, let text = design["design"].string.data(using: .utf8),
               let keptDoc = try? JSONDecoder().decode(MarketingValue.self, from: text), keptDoc["layers"] != .null {
                shape = design.s("shape", "own") == "square" ? "square" : "own"
                var d = keptDoc
                d["frame"] = frame(shape)
                d["bg"]["photoId"] = .string(Self.sitePhoto)
                doc = d
                lastAI = design["ai"].array.map(\.string).filter { (s: String) in !s.isEmpty }
            } else {
                shape = "own"
                doc = try await square(blank("own"), layout, fields)
            }
            firstSig = sig(fields)
            ready = true
        } catch {
            problem = error.localizedDescription
        }
    }

    /// The Posts tray's Crop & design (src/app/posts/piece-design.tsx): always square, never a kept design; the catalogue's
    /// photo from before it was marked (Mina), anything else as the site shows it (the tray's own copy); the layout the
    /// piece starts with, the weight on it where the card was stamping it.
    func beginSquare(_ piece: PostPiece, sitePhoto: Data, weightOn: Bool, fields: [String: String]) async {
        guard !loading, !ready else { return }
        loading = true
        problem = nil
        defer { loading = false }
        do {
            var bytes = sitePhoto
            // As on Edit a piece, the MINA mark is the catalogue's framing; no server flag names it (photoNote there).
            if House.bundledArt == "mina" && piece.photoSource != nil {
                bytes = try await ERPAPI.shared.data("/api/website/site-pieces/image?id=\(WebsiteNumber.query(piece.id))&original=1&size=3000", timeout: 120)
            }
            guard let image = UIImage(data: bytes), image.size.width > 0 else {
                throw ERPAPI.Failure(status: 0, message: "The photograph didn’t come as a picture.")
            }
            photos = [Photo(id: Self.sitePhoto, label: "The website’s photo", data: bytes,
                            size: CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale))]
            let start = try await engine.run(doc: .null, photos: [:], fields: [:], options: [
                "action": "siteLayouts", "weightOn": weightOn,
                "sitePiece": ["photoSource": piece.photoSource as Any? ?? NSNull(), "sourceMarked": piece.sourceMarked] as [String: Any],
            ])
            layouts = start["layouts"].array
            layout = start.s("start", "clean")
            shape = "square"
            doc = try await square(blank("square"), layout, fields)
            firstSig = sig(fields)
            ready = true
        } catch {
            problem = error.localizedDescription
        }
    }

    /// The tray's design as it goes out: WhatsApp's square, 1600 px (piece-design.tsx SEND_PX).
    func squareJpeg(fields: [String: String]) async throws -> Data {
        let r = try await engine.run(doc: doc, photos: photoData, fields: fields, options: ["px": 1600, "quality": 0.92, "site": true])
        guard let data = Data(base64Encoded: r.s("image")), !data.isEmpty else { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn.") }
        return data
    }

    /// A layout laid on a design (editor.ts applySquarePreset, through the engine).
    private func square(_ d: MarketingValue, _ id: String, _ fields: [String: String]) async throws -> MarketingValue {
        let r = try await engine.run(doc: d, photos: photoData, fields: fields, options: ["action": "square", "value": id, "site": true])
        return r["doc"]
    }

    func chooseLayout(_ id: String, fields: [String: String]) async {
        do {
            let d = try await square(doc, id, fields)
            layout = id
            doc = d
        } catch { problem = error.localizedDescription }
    }

    func chooseShape(_ s: String, fields: [String: String]) async {
        guard s != shape else { return }
        var d = doc
        d["frame"] = frame(s)
        do {
            doc = try await square(d, layout, fields)
            shape = s
        } catch { problem = error.localizedDescription }
    }

    func use(_ id: String) {
        var d = doc
        d["bg"]["photoId"] = .string(id)
        doc = d
    }

    // MARK: Drawing

    func render(fields: [String: String]) async {
        guard ready else { return }
        do {
            let r = try await engine.run(doc: doc, photos: photoData, fields: fields, options: ["px": 900, "site": true])
            guard !Task.isCancelled else { return }
            preview = NativeArtwork.image(r)
            problem = nil
        } catch {
            if !Task.isCancelled { problem = error.localizedDescription }
        }
    }

    /// The photo going up: the site's own size, 3000 px on taheri.shop (the catalogue makes its 2000 from it), never
    /// enlarged past the photo, at least 1080; a JPEG at 0.92, as the web's canvasToJpeg.
    func jpeg(fields: [String: String]) async throws -> Data {
        let px = max(1080, min(3000, Double(current?.size.width ?? 1080)))
        let r = try await engine.run(doc: doc, photos: photoData, fields: fields, options: ["px": px, "quality": 0.92, "site": true])
        guard let data = Data(base64Encoded: r.s("image")), !data.isEmpty else { throw ERPAPI.Failure(status: 0, message: "The photo could not be drawn.") }
        return data
    }

    // MARK: AI on the photo

    /// What the AI sent back, and whether it should be looked at before saving (the web's checkOk and its toast).
    func runAI(_ op: String, params: [String: Any], label: String) async throws -> String? {
        guard let photo = current, let image = UIImage(data: photo.data),
              let jpeg = WebsitePhoto.jpeg(image, longestEdge: 2048, quality: 0.92) else {
            throw ERPAPI.Failure(status: 0, message: "The photo couldn't be read.")
        }
        let raw = try await WebsiteForm.send("/api/website/post/ai", fields: [("op", op), ("params", WebsiteForm.text(params))],
                                             files: [WebsiteForm.File(field: "image", name: "image-0.jpg", type: "image/jpeg", data: jpeg)], timeout: 240)
        let d = try JSONDecoder().decode(MarketingValue.self, from: raw)
        guard let bytes = Data(base64Encoded: d["image"].s("data")), let made = UIImage(data: bytes) else {
            throw ERPAPI.Failure(status: 0, message: "The AI sent no photo back.")
        }
        let id = "ai-" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        photos.append(Photo(id: id, label: label, data: bytes, size: CGSize(width: made.size.width * made.scale, height: made.size.height * made.scale)))
        // The new photo takes the old one's crop.
        var x = doc
        let crop = Self.placement(doc)
        x["bg"]["photoId"] = .string(id)
        if x["placements"] == .null { x["placements"] = .object([:]) }
        x["placements"][id] = crop
        doc = x
        ai.append(label)
        let check = d["check"]
        if check == .null { return "Could not check it: compare it with the original before saving." }
        if check["samePiece"].bool && check.n("confidence") >= 0.8 { return nil }
        let first = check["differences"].array.first?.string ?? ""
        return "Check this one closely: " + (first.isEmpty ? "compare it with the original before saving." : first)
    }
}

/// The photo's controls on Edit a piece: the shape, what goes on it, the designer and the AI (edit/page.tsx's photo card).
struct WebsitePhotoEditRows: View {
    @Bindable var edit: WebsitePhotoEdit
    let fields: [String: String]
    let busy: Bool
    /// The tray's design is always square (WhatsApp only gets 1:1): no shape to choose.
    var shapes = true
    let onAI: (_ op: String, _ params: [String: Any], _ label: String) -> Void
    @State private var designing = false
    @State private var asking = false
    @State private var askText = ""

    var body: some View {
        Group {
            if let image = edit.preview {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                    .accessibilityLabel("The photo as it will go up")
            } else {
                SkeletonLoading().aspectRatio(1, contentMode: .fit)
            }
            if let problem = edit.problem {
                Text(problem).font(.footnote).foregroundStyle(Tone.problem.color)
            }
            if shapes {
                Picker("Shape", selection: Binding(get: { edit.shape }, set: { (s: String) in Task { await edit.chooseShape(s, fields: fields) } })) {
                    Text("Its own shape").tag("own")
                    Text("Square").tag("square")
                }
                #if os(macOS)
                .pickerStyle(.menu)
                #else
                .pickerStyle(.segmented)
                #endif
                .disabled(busy)
            }
            Picker("On the photo", selection: Binding(get: { edit.layout }, set: { (id: String) in Task { await edit.chooseLayout(id, fields: fields) } })) {
                ForEach(edit.layouts, id: \.text) { (x: MarketingValue) in Text(x.s("label")).tag(x.s("id")) }
            }
            .disabled(busy)
            if edit.layoutShowsWeight && (fields["weight"] ?? "").isEmpty {
                Text("Type the weight (below) to put it on.").font(.caption).foregroundStyle(Tone.owed.color)
            }
            Button { designing = true } label: {
                Label("Crop and design", systemImage: "crop")
            }
            .disabled(busy)
            Menu {
                Section("On this photo (about a minute)") {
                    Button { onAI("enhance", ["tidy": false], "Enhanced") } label: { Label("Enhance: light, sparkle, dust", systemImage: "wand.and.stars") }
                    Button { onAI("enhance", ["tidy": true], "Enhanced, labels cleared") } label: { Label("Enhance and clear old labels", systemImage: "wand.and.stars") }
                    Button { askText = ""; asking = true } label: { Label("Ask AI…", systemImage: "text.bubble") }
                }
                if edit.photos.count > 1 {
                    Section("Use") {
                        ForEach(edit.photos) { (p: WebsitePhotoEdit.Photo) in
                            Button { edit.use(p.id) } label: {
                                if edit.current?.id == p.id { Label(p.label, systemImage: "checkmark") } else { Text(p.label) }
                            }
                        }
                    }
                }
            } label: {
                Label("AI", systemImage: "sparkles")
            }
            .disabled(busy)
            if let p = edit.current, p.id != WebsitePhotoEdit.sitePhoto {
                Text("Using: \(p.label).").font(.caption).foregroundStyle(.secondary)
            }
        }
        .task(id: edit.doc.text + fields.sorted { (a: (key: String, value: String), b: (key: String, value: String)) in a.key < b.key }.description + "\(edit.photos.count)") {
            await edit.render(fields: fields)
        }
        .sheet(isPresented: $designing) {
            ArtworkEditor(doc: $edit.doc, photos: edit.photoData, fields: fields, layoutGroup: "siteSquares")
        }
        .alert("Ask AI to change the photo", isPresented: $asking) {
            TextField("Make the background plain white", text: $askText)
            Button("Make it") {
                let text = askText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { onAI("custom", ["instruction": text], "Changed with AI") }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Say what to change: the piece itself stays as it is, and the result is checked against it.")
        }
    }
}
