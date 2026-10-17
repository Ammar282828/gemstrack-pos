import SwiftUI
import PhotosUI
import Observation
import UIKit

// Start with anything (src/app/design/smart-input.tsx; POST /api/design/{parse,analyze,layers}, GET /api/design/fetch). Paste a caption, a
// forwarded WhatsApp message, a link or a SKU, or choose photos: the server reads them and this shows what it understood BEFORE anything
// is used, each field with a tick (and editable). The server holds every field against the input ("no figure that isn't in the input":
// inventedFigures / breaksHouseRule); its warnings are shown as it sent them. A photograph is analysed once, resized to 1600 px first
// (the 2026-10-01 out-of-memory lesson). Nothing here writes a figure of its own.

/// One piece the smart input found, ready to become the start screen's form (use-design.ts startPhotoOf, start.tsx `use`).
struct DesignFound: Identifiable {
    let id = UUID().uuidString
    var name: String
    var fields: [String: String]
    var price: String
    var photo: DesignStartPhoto?
    var kind: String?
}

@MainActor
@Observable
final class DesignSmartModel {
    struct Photo: Identifiable {
        let id = UUID().uuidString
        var name: String
        var data: Data
        /// `site:<id>` for a website piece's photograph, `url:<address>` for one fetched.
        var ref: String?
        var fromSite: Bool
        var image: UIImage?
    }
    struct Item: Identifiable {
        let id = UUID().uuidString
        var parsed: MarketingValue
        var fields: [String: String]
        var accept: [String: Bool]
        var photos: [Photo]
        var main = 0
        var analysis: MarketingValue?
    }
    /// A flat picture split into layers, waiting for a look (flat-ad.ts PlanReview).
    struct LayerReview {
        var plan: MarketingValue
        var photo: Photo
        var keep: Set<String>
    }

    static let fieldOrder = ["headline", "weight", "kicker", "details"]
    static let fieldLabel = ["kicker": "Small line", "headline": "Headline", "weight": "Specs line", "details": "Button line"]

    let start: DesignStartModel
    let allowLayers: Bool
    var text = ""
    var busy: String?
    var error: String?
    var notes: [String] = []
    var items: [Item] = []
    var review: LayerReview?
    var used = 0

    init(start: DesignStartModel, allowLayers: Bool) {
        self.start = start
        self.allowLayers = allowLayers
    }

    // MARK: Reading

    private static func prepared(_ data: Data) -> Data? { WebsitePhoto.jpegCopy(data, longestEdge: 1600) }

    /// A photograph the parse found, fetched through the ERP (a website piece's own, or an outside address).
    private func fetchPhoto(ref: String, name: String) async -> Photo? {
        let path: String
        var site = false
        if ref.hasPrefix("site:") {
            path = "/api/website/site-pieces/image?id=\(AdsQuery.escape(String(ref.dropFirst(5))))&size=3000&original=1"
            site = true
        } else if ref.hasPrefix("url:") {
            path = "/api/design/fetch?url=\(AdsQuery.escape(String(ref.dropFirst(4))))"
        } else { return nil }
        guard let data = try? await ERPAPI.shared.data(path, timeout: 60), let image = WebsitePhoto.thumbnail(data, maxPixel: 400) else { return nil }
        return Photo(name: name, data: data, ref: ref, fromSite: site, image: image)
    }

    /// One picture, read once: the subject box, lettering burned into it, its category and a headline.
    private func analyse(_ photo: Photo) async -> MarketingValue? {
        guard let small = Self.prepared(photo.data) else { return nil }
        guard let bytes = try? await WebsiteForm.send("/api/design/analyze", fields: [], files: [.init(field: "file", name: "photo.jpg", type: "image/jpeg", data: small)], timeout: 90),
              let answer = try? JSONDecoder().decode(MarketingValue.self, from: bytes) else { return nil }
        let a = answer["analysis"]
        return a == .null ? nil : a
    }

    private func item(_ parsed: MarketingValue, photos: [Photo], analysis: MarketingValue?) -> Item {
        var fields: [String: String] = [:]
        for k in Self.fieldOrder { let v = parsed["fields"].s(k); if !v.isEmpty { fields[k] = v } }
        if (fields["headline"] ?? "").isEmpty, let h = analysis?.s("headline"), !h.isEmpty { fields["headline"] = h }
        var accept: [String: Bool] = [:]
        for k in Self.fieldOrder { accept[k] = !(fields[k] ?? "").isEmpty }
        accept["price"] = parsed["price"] != .null
        return Item(parsed: parsed, fields: fields, accept: accept, photos: photos, analysis: analysis)
    }

    /// Words and/or photographs → what was understood. Photos typed with words describe that piece; alone, each is its own.
    func read(photos picked: [(name: String, data: Data)] = []) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !picked.isEmpty else { error = "Type, paste or choose something first."; return }
        error = nil; notes = []
        var out: [Item] = []
        do {
            if !t.isEmpty {
                busy = "Reading…"
                let answer = try await MarketingRequest.send("/api/design/parse", ["input": t])
                if answer["drive"] != .null { notes = ["That is a Drive folder; it goes to the library."] }
                for p in answer["pieces"].array {
                    busy = "Getting the photo…"
                    var photos: [Photo] = []
                    for ph in p["photos"].array.prefix(3) {
                        if let got = await fetchPhoto(ref: ph.s("ref"), name: p.s("name", "photo")) { photos.append(got) }
                    }
                    out.append(item(p, photos: photos, analysis: nil))
                }
                let found = answer["pieces"].array
                notes = found.isEmpty ? answer["warnings"].array.map(\.string) : found.flatMap { $0["warnings"].array.map(\.string) }
            }
            if !picked.isEmpty {
                var photos: [Photo] = []
                for (i, p) in picked.enumerated() {
                    photos.append(Photo(name: p.name.isEmpty ? "Photo \(i + 1)" : p.name, data: p.data, ref: nil, fromSite: false, image: WebsitePhoto.thumbnail(p.data, maxPixel: 400)))
                }
                if !t.isEmpty && out.count == 1 {
                    busy = "Looking at the photo…"
                    let analysis = await analyse(photos[0])
                    out[0].photos = photos + out[0].photos
                    out[0].analysis = analysis
                    if (out[0].fields["headline"] ?? "").isEmpty, let h = analysis?.s("headline"), !h.isEmpty { out[0].fields["headline"] = h; out[0].accept["headline"] = true }
                } else {
                    // One picture at a time, and only the main one: the server holds one image in memory per request.
                    for p in photos {
                        busy = "Looking at \(p.name)…"
                        let analysis = await analyse(p)
                        var warnings: [String] = []
                        if analysis == nil { warnings = ["The picture was not read (no AI just now); add the words yourself."] }
                        else if analysis?["burnedText"].bool == true { warnings = ["There is lettering on this photo."] }
                        let parsed = MarketingValue(["name": analysis?.s("headline") ?? "", "fields": [String: Any](), "specs": [String: Any](), "photos": [Any](),
                                                     "confidence": analysis == nil ? 0.3 : 0.6, "warnings": warnings] as [String: Any])
                        out.append(item(parsed, photos: [p], analysis: analysis))
                    }
                }
            }
            items = Array((out + items).prefix(12))
            text = ""
        } catch {
            self.error = error.localizedDescription
        }
        busy = nil
    }

    // MARK: Using

    func found(_ i: Item) -> DesignFound {
        var fields: [String: String] = [:]
        for k in Self.fieldOrder where i.accept[k] == true {
            let v = (i.fields[k] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !v.isEmpty { fields[k] = v }
        }
        var price = ""
        if i.accept["price"] == true, i.parsed["price"] != .null {
            let p = i.parsed["price"]
            price = p.s("text").isEmpty ? "PKR " + DesignSmartModel.grouped(p.n("amount")) : p.s("text")
        }
        var photo: DesignStartPhoto?
        if i.photos.indices.contains(i.main) {
            let main = i.photos[i.main]
            let data = main.data
            var source: [String: String] = [:]
            if let ref = main.ref, ref.hasPrefix("site:") { source["siteId"] = String(ref.dropFirst(5)) }
            photo = DesignStartPhoto(label: main.fromSite ? "From the website" : (main.name.isEmpty ? "Photo" : main.name), load: { data }, source: source)
        }
        let kind = i.parsed.s("suggestedKind")
        return DesignFound(name: fields["headline"] ?? i.parsed.s("name"), fields: fields, price: price, photo: photo, kind: kind.isEmpty ? nil : kind)
    }

    private static func grouped(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_PK")
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: n)) ?? String(Int(n))
    }

    /// One piece is used at once; the rest wait on the start screen for their own turn.
    func use(_ list: [Item]) {
        guard !list.isEmpty else { return }
        let all = list.map { found($0) }
        start.use(all[0])
        start.waiting = Array(all.dropFirst()) + start.waiting
        let ids = Set(list.map(\.id))
        items.removeAll { ids.contains($0.id) }
        used += 1
    }

    // MARK: Flat picture → layers (owner and marketing)

    func split(_ photo: Photo) async {
        guard let small = Self.prepared(photo.data) else { return }
        error = nil; busy = "Splitting into layers…"
        defer { busy = nil }
        do {
            let bytes = try await WebsiteForm.send("/api/design/layers", fields: [], files: [.init(field: "file", name: "photo.jpg", type: "image/jpeg", data: small)], timeout: 100)
            let plan = try JSONDecoder().decode(MarketingValue.self, from: bytes)
            notes = plan["notes"].array.map(\.string)
            review = LayerReview(plan: plan, photo: photo, keep: Set(plan["layers"].array.map { $0.s("id") }))
        } catch { self.error = error.localizedDescription }
    }

    /// Start a design from the reviewed plan (DesignLayerPlan, flat-ad.ts flatAdRequest).
    func startFromReview() {
        guard let rev = review else { return }
        let req = DesignLayerPlan.request(plan: rev.plan, photo: rev.photo.data, name: rev.photo.name, keep: rev.keep)
        review = nil
        start.launch?(req)
    }

    /// The average colour round the picture's edge as #RRGGBB: the ground the cut-out piece stands on (flat-ad.ts edgeColour).
    nonisolated static func edgeColour(_ data: Data) -> String {
        guard let image = UIImage(data: data)?.cgImage else { return "#1B1B1B" }
        let n = 48
        var pixels = [UInt8](repeating: 0, count: n * n * 4)
        guard let ctx = CGContext(data: &pixels, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return "#1B1B1B" }
        ctx.interpolationQuality = .medium
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: n, height: n))
        var r = 0, g = 0, b = 0, count = 0
        for y in 0..<n { for x in 0..<n where x <= 1 || y <= 1 || x >= n - 2 || y >= n - 2 {
            let i = (y * n + x) * 4
            r += Int(pixels[i]); g += Int(pixels[i + 1]); b += Int(pixels[i + 2]); count += 1
        } }
        guard count > 0 else { return "#1B1B1B" }
        return String(format: "#%02X%02X%02X", r / count, g / count, b / count)
    }
}

// MARK: The sheet

struct DesignSmartSheet: View {
    @State private var m: DesignSmartModel
    @Environment(\.dismiss) private var dismiss
    @State private var picked: [PhotosPickerItem] = []
    @State private var note: Note?

    init(start: DesignStartModel, allowLayers: Bool) { _m = State(initialValue: DesignSmartModel(start: start, allowLayers: allowLayers)) }

    private func bind<T>(_ key: ReferenceWritableKeyPath<DesignSmartModel, T>) -> Binding<T> {
        Binding(get: { m[keyPath: key] }, set: { m[keyPath: key] = $0 })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    input
                    if let error = m.error { Text(error).font(.subheadline).foregroundStyle(Tone.problem.color) }
                    if !m.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 4) { ForEach(m.notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) } }
                    }
                    if let review = m.review { layerReview(review) }
                    ForEach(m.items) { item in card(item) }
                    if m.items.count > 1 {
                        Button { m.use(m.items) ; dismiss() } label: { Label("Use all \(m.items.count) pieces", systemImage: "checkmark").frame(maxWidth: .infinity) }
                            .buttonStyle(.houseProminent).controlSize(.large).disabled(m.busy != nil)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .modifier(HouseGround())
            .navigationTitle("Start with anything").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .modifier(DesignSpeech(get: { m.start.speak }, set: { m.start.speak = $0 }, note: $note))
            .onChange(of: picked) { _, items in if !items.isEmpty { Task { await takePhotos(items) } } }
            .sensoryFeedback(.success, trigger: m.used)
        }
        .presentationDetents([.large])
    }

    private var input: some View {
        SectionCard("Paste anything") {
            TextField("A caption, a WhatsApp message, a link or a SKU. Or type it: “ruby ring 21k 12.35g”.", text: bind(\.text), axis: .vertical)
                .lineLimit(3...8)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Theme.ground, in: .rect(cornerRadius: Radius.tile, style: .continuous))
                .disabled(m.busy != nil)
            HStack(spacing: 10) {
                Button { Task { await m.read() } } label: {
                    HStack { if m.busy != nil { ProgressView() } else { Image(systemName: "sparkles") }; Text(m.busy ?? "Read it") }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent).controlSize(.large)
                .disabled(m.busy != nil || m.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                PhotosPicker(selection: $picked, maxSelectionCount: 8, matching: .images) {
                    Label("Photos", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass).controlSize(.large).disabled(m.busy != nil)
            }
            Text("Nothing is used until you tick it. No figure appears that is not in what you gave.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func takePhotos(_ items: [PhotosPickerItem]) async {
        defer { picked = [] }
        var out: [(name: String, data: Data)] = []
        for (i, item) in items.enumerated() {
            if let data = try? await item.loadTransferable(type: Data.self), WebsitePhoto.jpegCopy(data) != nil { out.append(("Photo \(i + 1)", data)) }
        }
        guard !out.isEmpty else { m.error = "Choose readable photos, or save them to Photos first."; return }
        await m.read(photos: out)
    }

    private func card(_ item: DesignSmartModel.Item) -> some View {
        let sure = item.parsed.n("confidence") >= 0.6
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Pill((sure ? "Sure" : "Check this") + " · \(Int((item.parsed.n("confidence") * 100).rounded()))%", tone: sure ? .settled : .owed)
                if !item.parsed.s("suggestedKind").isEmpty { Text("suggests: " + item.parsed.s("suggestedKind")).font(.caption).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
                Button { m.items.removeAll { $0.id == item.id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.plain).accessibilityLabel("Remove")
            }
            if !item.photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(item.photos.enumerated()), id: \.element.id) { n, p in
                            VStack(spacing: 4) {
                                Button { set(item.id) { $0.main = n } } label: {
                                    Group { if let image = p.image { Image(uiImage: image).resizable().scaledToFill() } else { Rectangle().fill(Theme.ground) } }
                                        .frame(width: 76, height: 76).clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).strokeBorder(n == item.main ? Theme.accent : .clear, lineWidth: 2))
                                }.buttonStyle(.plain).accessibilityLabel(n == item.main ? "Main photo" : "Use as the main photo")
                                if m.allowLayers && n == item.main {
                                    Button { Task { await m.split(p) } } label: { Label("Layers", systemImage: "square.3.layers.3d").font(.caption2) }
                                        .buttonStyle(.glass).disabled(m.busy != nil)
                                }
                            }
                        }
                    }
                }
            }
            ForEach(DesignSmartModel.fieldOrder, id: \.self) { k in
                if item.fields[k] != nil || item.accept[k] == true {
                    HStack(spacing: 8) {
                        Toggle("", isOn: Binding(get: { item.accept[k] == true }, set: { on in set(item.id) { $0.accept[k] = on } })).labelsHidden().tint(Theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(DesignSmartModel.fieldLabel[k] ?? k).font(.caption).foregroundStyle(.secondary)
                            TextField("", text: Binding(get: { item.fields[k] ?? "" }, set: { v in set(item.id) { $0.fields[k] = v; $0.accept[k] = true } }), axis: .vertical)
                                .lineLimit(1...3)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(Theme.ground, in: .rect(cornerRadius: Radius.tile, style: .continuous))
                        }
                    }
                }
            }
            if item.parsed["price"] != .null {
                HStack(spacing: 8) {
                    Toggle("", isOn: Binding(get: { item.accept["price"] == true }, set: { on in set(item.id) { $0.accept["price"] = on } })).labelsHidden().tint(Theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Price").font(.caption).foregroundStyle(.secondary)
                        Text(item.parsed["price"].s("text", "PKR " + String(Int(item.parsed["price"].n("amount"))))).font(.subheadline)
                    }
                }
            }
            if item.parsed["specs"].n("weightG") > 0 && (item.fields["weight"] ?? "").isEmpty {
                Text("Weight \(WebsiteNumber.grams(item.parsed["specs"].n("weightG"))) g was read but left off the design: check it, then type the specs line.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(item.parsed["warnings"].array.map(\.string), id: \.self) { w in
                Label(w, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Tone.owed.color)
            }
            Button { m.use([item]); dismiss() } label: { Label("Use this", systemImage: "checkmark").frame(maxWidth: .infinity) }
                .buttonStyle(.houseProminent).disabled(m.busy != nil)
        }
        .ledgerCard()
    }

    private func set(_ id: String, _ change: (inout DesignSmartModel.Item) -> Void) {
        guard let i = m.items.firstIndex(where: { $0.id == id }) else { return }
        change(&m.items[i])
    }

    private func layerReview(_ rev: DesignSmartModel.LayerReview) -> some View {
        DesignLayerReviewCard(plan: rev.plan, keep: Binding(get: { m.review?.keep ?? [] }, set: { m.review?.keep = $0 }),
                              onCancel: { m.review = nil }, onStart: { m.startFromReview(); dismiss() })
    }
}
