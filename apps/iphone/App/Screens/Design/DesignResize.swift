import SwiftUI
import Observation

// Resize (src/app/design/resize-sheet.tsx, lib/design/{resize,resize-ai}.ts, POST /api/design/resize). The deterministic part is the
// web's own code, bundled into the artwork engine (scripts/design-engine.ts, actions "resize" and "resizeMerge"): the three layouts
// scored, the best kept, "needs extend" when the piece can't fill the shape. "Smart" then asks the route ONCE for all sizes and an AI
// plan is used only where it scores at least as well (mergePlan). "Extend the photo" is the existing reframe op, run only when pressed
// and kept only if the same-piece check agrees. One model call per user action; nothing is added until the person says "Add".

@MainActor
@Observable
final class DesignResizeModel {
    struct Entry: Identifiable, Equatable {
        let id: String
        let label: String
        let ratio: String
        let w: Double
        let h: Double
        let format: String
    }
    /// A photograph the AI extended for one shape and the check agreed with.
    struct Extra {
        let photoId: String
        let data: Data
    }

    let model: DesignWorkspaceModel
    var picked: [String] = []
    var customs: [Entry] = []
    var customW = ""
    var customH = ""
    var smart = false
    /// "Laying out…" / "Asking the AI…" while it works.
    var busy: String?
    var note = ""
    private(set) var results: [String: MarketingValue] = [:]
    private(set) var images: [String: UIImage] = [:]
    var kept: Set<String> = []
    private(set) var extras: [String: Extra] = [:]
    var extending: String?
    var safe = false
    var added = 0
    var problem: String?
    @ObservationIgnored private var run = 0
    @ObservationIgnored private var small: [String: Data]?

    init(model: DesignWorkspaceModel) { self.model = model }

    private func entry(_ id: String) -> Entry? {
        if let c = customs.first(where: { $0.id == id }) { return c }
        guard let s = DesignSizes.size(id) else { return nil }
        return Entry(id: s.id, label: s.label, ratio: s.ratio, w: s.w, h: s.h, format: s.format)
    }

    func entryFor(_ id: String) -> Entry? { entry(id) }

    func toggle(_ id: String) {
        if let i = picked.firstIndex(of: id) { picked.remove(at: i) } else { picked.append(id) }
    }

    /// The person's own W:H (resize-sheet.tsx addCustom).
    func addCustom() {
        guard let w = Double(customW.replacingOccurrences(of: ",", with: ".")), let h = Double(customH.replacingOccurrences(of: ",", with: ".")),
              w > 0, h > 0, w <= 10_000, h <= 10_000 else {
            problem = "Give a width and a height. For example 7 and 3, or 1200 and 628."
            return
        }
        let size = DesignSizes.custom(Int(w.rounded()), Int(h.rounded()))
        let id = "custom-" + size.ratio
        if !customs.contains(where: { $0.id == id }) {
            customs.append(Entry(id: id, label: size.label, ratio: size.ratio, w: size.w, h: size.h, format: "custom"))
        }
        if !picked.contains(id) { picked.append(id) }
        customW = ""; customH = ""
    }

    /// The photographs the sheet draws from: small copies (the layouts only need their shape), plus any the AI extended.
    private func drawPhotos() -> [String: Data] {
        if small == nil { small = model.photos.mapValues { WebsitePhoto.jpegCopy($0, longestEdge: 1200) ?? $0 } }
        var all = small ?? [:]
        for ex in extras.values { all[ex.photoId] = WebsitePhoto.jpegCopy(ex.data, longestEdge: 1200) ?? ex.data }
        return all
    }

    private func subject(of doc: MarketingValue) -> Any? {
        let s = doc["meta"]["subject"]
        return s == .null ? nil : s.any
    }

    func resizeAll() async {
        guard let w = model.work else { return }
        let chosen = picked.compactMap { entry($0) }
        guard !chosen.isEmpty else { model.say("Pick a size first"); return }
        run += 1
        let mine = run
        busy = "Laying out…"; note = ""; extras = [:]
        let master = w.masterPage.doc
        var options: [String: Any] = ["action": "resize", "targets": chosen.map { ["w": $0.w, "h": $0.h] }, "photoMarked": model.marked]
        if let s = subject(of: master) { options["subject"] = s }
        let answer: MarketingValue
        do {
            answer = try await model.engine.run(doc: master, photos: drawPhotos(), fields: w.fields, options: options)
        } catch {
            busy = nil
            problem = "That didn’t resize. " + error.localizedDescription
            return
        }
        guard mine == run else { return }
        var next: [String: MarketingValue] = [:]
        for (i, e) in chosen.enumerated() { next[e.id] = answer["results"].array[safe: i] ?? .null }
        results = next
        kept = Set(chosen.map(\.id))
        await draw(chosen.map(\.id))
        guard smart else { busy = nil; return }

        busy = "Asking the AI…"
        defer { if mine == run { busy = nil } }
        do {
            let source = answer["source"]
            var src: [String: Any] = ["frame": source["frame"].any, "layers": source["layers"].any]
            if !source.s("thumb").isEmpty { src["thumb"] = source.s("thumb") }
            let targets: [[String: Any]] = chosen.map { e in
                let r = next[e.id] ?? .null
                var t: [String: Any] = ["frame": r["frame"].any, "score": r["score"].number, "problems": r["penalties"].array.map { $0.s("why") },
                                        "layers": r["ai"]["layers"].any, "plan": r["ai"]["plan"].any]
                if !r["ai"].s("thumb").isEmpty { t["thumb"] = r["ai"].s("thumb") }
                return t
            }
            let reply = MarketingValue(try await ERPAPI.shared.send("/api/design/resize", ["source": src, "targets": targets], timeout: 70))
            guard mine == run else { return }
            let plans = reply["plans"].array
            guard !plans.isEmpty else { throw ERPAPI.Failure(status: 0, message: "no answer") }
            let items: [[String: Any]] = chosen.enumerated().map { i, e in
                var det = next[e.id] ?? .null
                det["ai"] = .null
                return ["det": det.any, "plan": (plans[safe: i] ?? .null).any]
            }
            var mergeOptions: [String: Any] = ["action": "resizeMerge", "items": items]
            if let s = subject(of: master) { mergeOptions["subject"] = s }
            let merged = try await model.engine.run(doc: master, photos: drawPhotos(), fields: w.fields, options: mergeOptions)
            guard mine == run else { return }
            var out: [String: MarketingValue] = [:]
            for (i, e) in chosen.enumerated() { out[e.id] = merged["results"].array[safe: i] ?? next[e.id] ?? .null }
            // The AI's layouts keep what the plain pass found about the photo extending, and its thumbs are no longer needed.
            results = out
            await draw(chosen.map(\.id))
            let used = chosen.filter { out[$0.id]?.s("strategy") == "ai" }.count
            note = reply["ai"].bool
                ? (used > 0 ? "The AI refined \(used) of \(chosen.count); the rest keep the plain layout." : "The AI had nothing better, so the plain layouts stay.")
                : "Smart layouts weren’t available just now; these are the plain ones."
        } catch {
            if mine == run { note = "Smart layouts weren’t available just now; these are the plain ones." }
        }
    }

    /// Each result drawn small by the engine (the web's Thumb).
    private func draw(_ ids: [String]) async {
        guard let w = model.work else { return }
        let photos = drawPhotos()
        for id in ids {
            guard let r = results[id], r["doc"] != .null else { continue }
            if let r = try? await model.engine.run(doc: r["doc"], photos: photos, fields: w.fields, options: ["px": 360, "quality": 0.7]),
               let image = NativeArtwork.image(r) { images[id] = image }
        }
    }

    private func photoIdOf(_ doc: MarketingValue) -> String {
        let bg = doc["bg"].s("photoId")
        if !bg.isEmpty { return bg }
        return doc["layers"].array.first { $0.s("kind") == "image" && $0["src"] == .null && !$0.s("photoId").isEmpty }?.s("photoId") ?? "photo"
    }

    /// The existing reframe op on the photograph, for one shape: pressed, never silent, and kept only if it is the same piece.
    func extend(_ id: String) async {
        guard let w = model.work, let e = entry(id), let source = model.photos["photo"] else { return }
        extending = id
        defer { extending = nil }
        do {
            let ai = try await MarketingRequest.ai("reframe", images: [WebsitePhoto.jpegCopy(source, longestEdge: 2048) ?? source],
                                                  params: ["aspect": DesignAspect.nearest(e.w, e.h), "tidy": false])
            let check = ai["check"]
            if check != .null && !check["samePiece"].bool {
                let why = check["differences"].array.prefix(2).map(\.string).joined(separator: "; ")
                model.say("Kept your photo", detail: "The AI changed the piece: " + (why.isEmpty ? "the check says it is not the same" : why) + ".", failed: true)
                return
            }
            guard let data = Data(base64Encoded: ai["image"].s("data")), WebsitePhoto.jpegCopy(data) != nil else {
                throw ERPAPI.Failure(status: 0, message: "The AI sent no image back.")
            }
            let master = w.masterPage.doc
            let from = photoIdOf(master)
            let photoId = String(from.prefix(20)) + "-x" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
            extras[id] = Extra(photoId: photoId, data: data)
            var options: [String: Any] = ["action": "resize", "targets": [["w": e.w, "h": e.h]], "photoMarked": model.marked, "swap": ["from": from, "to": photoId]]
            if let s = subject(of: master) { options["subject"] = s }
            let again = try await model.engine.run(doc: master, photos: drawPhotos(), fields: w.fields, options: options)
            var r = again["results"].array.first ?? .null
            guard r != .null else { throw ERPAPI.Failure(status: 0, message: "That didn’t resize.") }
            r["notes"] = .array([.string("The photo extended to fill this shape, and checked as the same piece.")] + r["notes"].array)
            results[id] = r
            await draw([id])
        } catch {
            extras[id] = nil
            model.say("The photo couldn’t be extended", detail: error.localizedDescription, failed: true)
        }
    }

    var shown: [String] { picked.filter { results[$0] != nil } }
    var accepted: [String] { shown.filter { kept.contains($0) } }

    /// Add what was kept: pages of origin resized, tied to the master, with any extended photograph in the design's library.
    func accept() {
        let pages: [NewDesignPage] = accepted.compactMap { id in
            guard let e = entry(id), let r = results[id] else { return nil }
            if let ex = extras[id] { model.addPhoto(ex.photoId, ex.data) }
            return NewDesignPage(id: nil, label: e.label, format: e.format, w: r["frame"].n("w", e.w), h: r["frame"].n("h", e.h), doc: r["doc"], origin: "resized", syncedFrom: nil)
        }
        guard !pages.isEmpty else { return }
        model.addPages(pages)
        added += 1
        model.say("Added \(pages.count) size" + (pages.count == 1 ? "" : "s"), detail: "Each follows the master until you edit it.")
    }
}

/// lib/ads/studio/templates.ts nearestAiRatio: the AI's own shapes, the nearest to a frame.
enum DesignAspect {
    static let ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
    static func nearest(_ w: Double, _ h: Double) -> String {
        var best = "1:1", diff = Double.infinity
        for r in ratios {
            let p = r.split(separator: ":").compactMap { Double($0) }
            guard p.count == 2, h > 0, w > 0 else { continue }
            let d = abs(log((p[0] / p[1]) / (w / h)))
            if d < diff { diff = d; best = r }
        }
        return best
    }
}

extension Array {
    /// The element, or nil past the end (the engine answers one result per target).
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

// MARK: The sheet

struct DesignResizeSheet: View {
    @State private var r: DesignResizeModel
    @Environment(\.dismiss) private var dismiss
    @State private var note: Note?
    @State private var problem: String?
    private func bind<T>(_ key: ReferenceWritableKeyPath<DesignResizeModel, T>) -> Binding<T> {
        Binding(get: { r[keyPath: key] }, set: { r[keyPath: key] = $0 })
    }
    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    init(model: DesignWorkspaceModel) { _r = State(initialValue: DesignResizeModel(model: model)) }

    private var own: (w: Double, h: Double) {
        let p = r.model.work?.masterPage
        return (p?.w ?? 1080, p?.h ?? 1080)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Make this design in other sizes. The words and the photo stay; the layout follows the new shape.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    sizes
                    ownShape
                    runBar
                    if !r.shown.isEmpty { candidates }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .modifier(HouseGround())
            .navigationTitle("Resize").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .modifier(DesignSpeech(get: { r.model.speak }, set: { r.model.speak = $0 }, note: $note))
            .failureAlert($problem, title: "Could not finish")
            .onChange(of: r.problem) { _, now in if let now { problem = now; r.problem = nil } }
            .sensoryFeedback(.success, trigger: r.added)
        }
        .presentationDetents([.large])
    }

    private var sizes: some View {
        SectionCard("Sizes") {
            ForEach(DesignSizes.groups) { g in
                VStack(alignment: .leading, spacing: 4) {
                    Text(g.title).font(.caption).foregroundStyle(.secondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(g.sizes) { s in
                                FilterChip(title: s.ratio + (s.w == own.w && s.h == own.h ? " (this)" : ""), chosen: r.picked.contains(s.id)) { r.toggle(s.id) }
                            }
                        }
                    }
                }
            }
        }
    }

    private var ownShape: some View {
        SectionCard("Your own shape") {
            HStack(spacing: 8) {
                TextField("W", text: bind(\.customW)).keyboardType(.decimalPad).multilineTextAlignment(.center)
                    .frame(width: 64).textFieldStyle(.roundedBorder).accessibilityLabel("Width")
                Text(":")
                TextField("H", text: bind(\.customH)).keyboardType(.decimalPad).multilineTextAlignment(.center)
                    .frame(width: 64).textFieldStyle(.roundedBorder).accessibilityLabel("Height")
                Button { r.addCustom() } label: { Label("Add", systemImage: "plus") }.buttonStyle(.glass)
            }
            if !r.customs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(r.customs) { c in FilterChip(title: c.ratio, chosen: r.picked.contains(c.id)) { r.toggle(c.id) } } }
                }
            }
        }
    }

    private var runBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: bind(\.smart)) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Smart", systemImage: "sparkles")
                    Text(r.smart ? "Asks the AI once for all sizes; used only where it does better." : "Instant, no AI.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .tint(Theme.accent)
            Button { Task { await r.resizeAll() } } label: {
                HStack {
                    if r.busy != nil { ProgressView() } else { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                    Text(r.busy ?? "Resize" + (r.picked.isEmpty ? "" : " (\(r.picked.count))")).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.houseProminent).controlSize(.large).disabled(r.picked.isEmpty || r.busy != nil)
            if !r.note.isEmpty { Text(r.note).font(.footnote).foregroundStyle(.secondary) }
        }
        .ledgerCard()
    }

    private var candidates: some View {
        SectionCard("Results", count: r.shown.count) {
            if r.shown.contains(where: { id in r.entryFor(id).map { DesignSizes.safeZone(h: $0.h).top > 0 } ?? false }) {
                Toggle("Show safe zones", isOn: bind(\.safe)).font(.subheadline).tint(Theme.accent)
            }
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(r.shown, id: \.self) { id in card(id) }
            }
            HStack {
                Text("\(r.accepted.count) of \(r.shown.count) kept").font(.footnote).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button { r.accept(); dismiss() } label: {
                    Label("Add \(r.accepted.count) size\(r.accepted.count == 1 ? "" : "s")", systemImage: "checkmark")
                }
                .buttonStyle(.houseProminent).disabled(r.accepted.isEmpty || r.busy != nil)
            }
        }
    }

    @ViewBuilder private func card(_ id: String) -> some View {
        if let e = r.entryFor(id), let res = r.results[id] {
            let on = r.kept.contains(id)
            let score = res.n("score")
            let zone = DesignSizes.safeZone(h: e.h)
            VStack(alignment: .leading, spacing: 6) {
                Button { if on { r.kept.remove(id) } else { r.kept.insert(id) } } label: {
                    Group {
                        if let image = r.images[id] {
                            Image(uiImage: image).resizable().scaledToFit()
                                .overlay { if r.safe && zone.top > 0 { ResizeSafeZones(top: zone.top / e.h, bottom: zone.bottom / e.h) } }
                        } else { SkeletonLoading().frame(maxWidth: .infinity, minHeight: 90) }
                    }
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityLabel((on ? "Skip " : "Keep ") + e.label)
                HStack {
                    Text(e.label).font(.caption.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 0)
                    Pill("\(Int(score.rounded()))", tone: score >= 85 ? .settled : score >= 70 ? .owed : .late)
                }
                Text(res["notes"].array.first?.string ?? "").font(.caption2).foregroundStyle(.secondary)
                if res["needsExtend"].bool && r.extras[id] == nil {
                    Text("The piece doesn’t fill this shape; the photo is shown whole.").font(.caption2).foregroundStyle(Tone.owed.color)
                    Button { Task { await r.extend(id) } } label: {
                        HStack { if r.extending == id { ProgressView() } else { Image(systemName: "sparkles") }; Text("Extend the photo") }.font(.caption)
                    }
                    .buttonStyle(.glass).disabled(r.extending != nil || r.busy != nil)
                }
            }
            .padding(8)
            .background(Theme.card, in: .rect(cornerRadius: Radius.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(on ? Theme.accent : Color.secondary.opacity(0.18), lineWidth: on ? 1.5 : 1))
            .opacity(on ? 1 : 0.7)
        }
    }
}

private struct ResizeSafeZones: View {
    let top: Double
    let bottom: Double
    var body: some View {
        GeometryReader { g in
            VStack(spacing: 0) {
                Rectangle().fill(Color.black.opacity(0.35)).frame(height: g.size.height * top)
                Spacer(minLength: 0)
                Rectangle().fill(Color.black.opacity(0.35)).frame(height: g.size.height * bottom)
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}
