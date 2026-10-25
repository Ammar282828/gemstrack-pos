import SwiftUI
import PhotosUI

// The AI picture tools in the workspace's photograph card (src/app/design/{ai-tools,design-piece}.tsx). Nothing new server-side: every tool
// calls the route it always called, through the app's own sender (MarketingRequest.ai, the one Post a piece and Edit a piece use):
//   Enhance · Logo and labels off · Extend to this shape · Retouch · New setting… · Ask AI…  POST /api/website/post/ai  op enhance | reframe |
//        retouch | restage | custom, the photograph at most 2048 px; every result comes back with a same-piece check.
//   Remove background  POST /api/design/remove-background (Magnific; a PNG with alpha, no pixel redrawn, so no check)
//   Flat image → layers  POST /api/design/layers (owner and marketing)
//   Make the ad with AI  POST /api/ads/studio/auto op direct (owner and marketing, an ad), as the Studio's "Make it with AI"
// One tool at a time (the Vertex quota is tiny); a result the check doubts waits for a look instead of going in unseen.

/// The photograph before an AI one, for "Back to the photo before".
struct DesignPhotoStep {
    var data: Data
    var marked: Bool
    var check: MarketingValue?
}

/// An AI picture waiting for a look: the check doubted it.
struct DesignCandidate: Identifiable {
    let id = UUID().uuidString
    var data: Data
    var label: String
    /// It carries none of the website's marks.
    var clean: Bool
    var check: MarketingValue?
}

enum DesignPhotoOp {
    case enhance, clean, extend, retouch
    case setting(sceneId: String?, scene: String?, aspect: String)
    case ask(String, aspect: String?)
}

enum DesignAIRules {
    /// ai-tools.tsx checkOk: the same piece, and sure enough.
    static func checkOK(_ check: MarketingValue?) -> Bool {
        guard let c = check, c != .null else { return false }
        return c["samePiece"].bool && (c["confidence"] == .null ? 1 : c.n("confidence")) >= 0.8
    }
    /// What the ad's goal sends people to, as the art director is told it (lib/ads/plan.ts GOALS `hint`).
    static let goalHints: [String: String] = [
        "whatsapp": "People tap and start a WhatsApp chat with the shop.",
        "messages": "Each person gets the app they use — WhatsApp or Instagram Direct.",
        "instagram_dm": "People tap and message the shop on Instagram.",
        "website": "People tap through to the piece on the website.",
        "sales": "Meta looks for people who buy on the website — needs its pixel recording orders.",
        "channel": "People tap through to the shop’s WhatsApp channel and follow it.",
        "profile": "People tap through to the shop’s Instagram profile.",
        "engagement": "More people engage with the post itself.",
        "reach": "As many different people as the budget allows.",
    ]
    static let askIdeas = ["Remove the hand and props", "Warmer, golden-hour light", "Deep green velvet background", "Soft bokeh lights behind", "Clean white studio background", "Add a subtle reflection below"]
}

extension DesignWorkspaceModel {
    /// A photograph as the AI is sent it: at most 2048 px on the long side.
    private func forAI(_ data: Data) -> Data { WebsitePhoto.jpegCopy(data, longestEdge: 2048) ?? data }

    /// One tool at a time: nothing starts while another runs.
    private func guarded(_ what: String, _ work: () async -> Void) async {
        guard aiBusy == nil else { return }
        aiBusy = what
        await work()
        aiBusy = nil
    }

    private func explain(_ e: Error) {
        let status = (e as? ERPAPI.Failure)?.status ?? 0
        let hint = status == 429 ? "The AI limit for now is reached. Try again in a few minutes." : e.localizedDescription
        say("The AI couldn’t do that", detail: hint, failed: true)
    }

    /// The photograph's tools (ai-tools.tsx `photo`).
    func photoTool(_ op: DesignPhotoOp) async {
        guard let w = work, let source = photos["photo"] else { return }
        let page = w.activePage
        let aspect = DesignAspect.nearest(page.w, page.h)
        var label = "", wait = "", clean = false
        switch op {
        case .enhance: (label, wait, clean) = ("Enhanced", "Enhancing the photograph, about a minute", tidy)
        case .clean: (label, wait, clean) = ("Logo and labels off", "Taking the logo and labels off, about a minute", true)
        case .extend: (label, wait, clean) = ("Extended \(aspect)", "Extending the photograph, about a minute", true)
        case .retouch: (label, wait, clean) = ("Retouched", "Retouching: piece, background and light, about two minutes", tidy)
        case .setting(let sceneId, let scene, _):
            let known = catalogue["scenes"].array.first { $0.s("id") == sceneId }?.s("label")
            (label, wait, clean) = (scene != nil ? "New setting" : (known ?? "New setting"), "Photographing it in the new setting, about a minute", true)
        case .ask(let instruction, _): (label, wait, clean) = (String(instruction.prefix(28)).isEmpty ? "Your edit" : String(instruction.prefix(28)), "Doing what you asked, about a minute", false)
        }
        await guarded(wait) {
            do {
                let image = forAI(source)
                let r: MarketingValue
                switch op {
                case .enhance: r = try await MarketingRequest.ai("enhance", images: [image], params: ["tidy": tidy])
                case .clean: r = try await MarketingRequest.ai("enhance", images: [image], params: ["tidy": true])
                case .extend: r = try await MarketingRequest.ai("reframe", images: [image], params: ["aspect": aspect, "tidy": marked || tidy])
                case .retouch: r = try await MarketingRequest.ai("retouch", images: [image], params: ["tidy": tidy])
                case .setting(let sceneId, let scene, let shape):
                    var p: [String: Any] = ["aspect": shape]
                    if let scene, !scene.isEmpty { p["scene"] = scene } else if let sceneId { p["sceneId"] = sceneId }
                    r = try await MarketingRequest.ai("restage", images: [image], params: p)
                case .ask(let instruction, let shape):
                    var p: [String: Any] = ["instruction": instruction.trimmingCharacters(in: .whitespacesAndNewlines)]
                    if let shape { p["aspect"] = shape }
                    r = try await MarketingRequest.ai("custom", images: [image], params: p)
                }
                guard let data = Data(base64Encoded: r["image"].s("data")), WebsitePhoto.jpegCopy(data) != nil else {
                    throw ERPAPI.Failure(status: 0, message: "The AI sent no image back.")
                }
                let check = r["check"] == .null ? nil : r["check"]
                if check != nil && !DesignAIRules.checkOK(check) {
                    candidate = DesignCandidate(data: data, label: label, clean: clean, check: check)
                    say("Check this one before it goes in", detail: check?["differences"].array.first?.string ?? "The AI may have changed the piece.", failed: true)
                    return
                }
                takeAIPhoto(data, check: check, clean: clean)
                say(label + ": done", detail: check != nil ? "The check: the same piece as before." : "Not checked: compare it with the original.")
            } catch { explain(error) }
        }
    }

    /// Make the ad with AI (ai-tools.tsx `makeAd`, the Studio's "Make it with AI", /api/ads/studio/auto op `direct`): an art
    /// director's layout and words from the photograph and its details, the logo off and the photo extended when the shape needs
    /// it, then the same layout on every size. A prepared photo the check doubts is not used: the words and layout go in on the
    /// photograph as it was.
    func makeAd(brief: String) async {
        guard let w = work, w.kind == "ad", let source = photos["photo"], let image = UIImage(data: source), image.size.height > 0 else { return }
        let page = w.activePage
        let aspect = DesignAspect.nearest(page.w, page.h)
        let format = catalogue["formats"].array.first { $0.s("id") == page.format } ?? .null
        let params: [String: Any] = [
            "name": w.name.isEmpty ? (w.fields["headline"] ?? "") : w.name, "collection": "", "specs": w.fields["weight"] ?? "",
            "price": w.copy["price"] ?? "", "brief": brief, "format": page.format, "aspect": aspect,
            "shape": format.s("label", page.label), "trimTo": format.s("short"),
            "destination": DesignAIRules.goalHints[w.copy["goal"] ?? "whatsapp"] ?? "a WhatsApp chat with the shop",
            "kicker": w.fields["kicker"] ?? "", "headline": w.fields["headline"] ?? "", "cta": w.fields["details"] ?? "",
        ]
        let ratio = Double(image.size.width / image.size.height) / (page.w / max(1, page.h))
        let extend = ratio > 1.3 || ratio < 0.77
        let isMarked = marked
        await guarded("Designing the ad from the photo and its details, about a minute") {
            do {
                let picture = forAI(source)
                // The photograph is prepared beside the direction, as the web does: extended to the shape, or its marks taken off.
                let prepared = Task { () -> MarketingValue? in
                    if extend { return try? await MarketingRequest.ai("reframe", images: [picture], params: ["aspect": aspect, "tidy": isMarked]) }
                    if isMarked { return try? await MarketingRequest.ai("enhance", images: [picture], params: ["tidy": true]) }
                    return nil
                }
                let bytes = try await WebsiteForm.send("/api/ads/studio/auto", fields: [("op", "direct"), ("params", WebsiteForm.text(params))],
                                                       files: [.init(field: "image", name: "photo.jpg", type: "image/jpeg", data: picture)], timeout: 300)
                let d = try JSONDecoder().decode(MarketingValue.self, from: bytes)["direction"]
                let fixed = await prepared.value
                var next = w.fields
                for (key, from) in [("kicker", "kicker"), ("headline", "headline"), ("details", "cta")] where !d.s(from).isEmpty { next[key] = d.s(from) }
                for (k, v) in next where v != w.fields[k] { setField(k, v) }
                if let text = d["primaryText"].array.first?.string, !text.isEmpty { setCopy("adText", text) }
                if let headline = d["adHeadlines"].array.first?.string, !headline.isEmpty { setCopy("adHeadline", headline) }
                // The photograph's "same piece?" check decides: a result that changed the piece never goes into an ad unseen.
                let check = fixed.flatMap { $0["check"] == .null ? nil : $0["check"] }
                let changed = check.map { !$0["samePiece"].bool } ?? false
                if let fixed, !changed, let data = Data(base64Encoded: fixed["image"].s("data")), WebsitePhoto.jpegCopy(data) != nil {
                    takeAIPhoto(data, check: check, clean: true)
                }
                // The same layout on every size of the design, each from a blank page that keeps its photograph's placement.
                let layout = d.s("layout").isEmpty ? (page.doc["meta"].s("template")) : d.s("layout")
                if !layout.isEmpty, let now = work {
                    for p in now.pages {
                        var blank = p
                        var doc = DesignWork.blankDoc(w: p.w, h: p.h)
                        if p.doc["bg"]["placement"] != .null { doc["bg"]["placement"] = p.doc["bg"]["placement"] }
                        blank.doc = doc
                        let laid = try await layOut(blank, template: layout, fields: now.fields)
                        setDoc(p.id, laid)
                    }
                }
                if changed {
                    say("Kept your photo", detail: "The AI changed the piece: \((check?["differences"].array.prefix(2).map(\.string) ?? []).joined(separator: "; ")). The words and layout are in.", failed: true)
                } else {
                    let scene = catalogue["scenes"].array.first { $0.s("id") == d.s("scene") }?.s("label")
                    say("The ad is made", detail: [d.s("why"), scene.map { "A new setting would suit it: \($0) (New setting…)." } ?? ""].filter { !$0.isEmpty }.joined(separator: " "))
                }
            } catch { explain(error) }
        }
    }

    /// "Use it" on a picture that waited for a look.
    func useCandidate() {
        guard let c = candidate else { return }
        candidate = nil
        takeAIPhoto(c.data, check: c.check, clean: c.clean)
    }

    /// Remove background (design-piece.tsx cutOut): the piece laid on this page as a picture layer over the house's ground, where the
    /// photograph was. Nothing is drawn by the AI; the photograph itself is kept (lay the page out again to see it).
    func cutOut() async {
        guard let w = work, let source = photos["photo"], let image = UIImage(data: source), image.size.height > 0 else { return }
        let page = w.activePage
        await guarded("Cutting the piece out, about ten seconds") {
            do {
                let png = try await WebsiteForm.send("/api/design/remove-background", fields: [], files: [.init(field: "file", name: "photo.jpg", type: "image/jpeg", data: forAI(source))], timeout: 100)
                guard UIImage(data: png) != nil else { throw ERPAPI.Failure(status: 0, message: "The cut-out didn’t come.") }
                let placement = page.doc["bg"]["placement"]
                let ar = Double(image.size.width / image.size.height)
                let zoom = placement.n("zoom", 1)
                let cover = max(page.w, page.h * ar) * (placement.s("mode") == "fit" ? 1 : max(1, zoom == 0 ? 1 : zoom))
                let dw = cover, dh = cover / ar
                let fx = placement["focusX"] == .null ? 0.5 : placement.n("focusX"), fy = placement["focusY"] == .null ? 0.5 : placement.n("focusY")
                let layer = MarketingValue(["id": "image-cut" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36), "kind": "image", "role": "photo", "photoId": "cutout",
                                            "src": "data:image/png;base64," + png.base64EncodedString(),
                                            "x": ((page.w - dw) * fx).rounded(), "y": ((page.h - dh) * fy).rounded(), "w": dw.rounded(), "h": dh.rounded(),
                                            "radius": 0, "border": NSNull(), "shadow": false, "rotate": 0, "opacity": 1, "cutout": true, "name": "Piece"] as [String: Any])
                var doc = page.doc
                doc["bg"]["photoId"] = .null
                doc["layers"] = .array([layer] + doc["layers"].array)
                setDoc(page.id, doc)
                say("Background removed", detail: "The piece is a layer on the house’s ground. No part of it was redrawn.")
            } catch { say("The background wasn’t removed", detail: error.localizedDescription, failed: true) }
        }
    }

    /// Flat image → layers (owner and marketing): the photograph read once, then reviewed before a design is started from it.
    func splitLayers() async {
        guard let source = photos["photo"] else { return }
        await guarded("Splitting into layers, about a minute") {
            do {
                let bytes = try await WebsiteForm.send("/api/design/layers", fields: [], files: [.init(field: "file", name: "photo.jpg", type: "image/jpeg", data: forAI(source))], timeout: 110)
                let plan = try JSONDecoder().decode(MarketingValue.self, from: bytes)
                sheet = DesignSheet(title: "Layers") { DesignLayersSheet(model: self, plan: plan, photo: source) }
            } catch { say("It couldn’t be split", detail: error.localizedDescription, failed: true) }
        }
    }
}

// MARK: Flat image → layers (flat-ad.ts)

enum DesignLayerPlan {
    /// The design a reviewed plan starts: the cut-out piece on the picture's own edge colour, the lettering it found as text layers.
    static func request(plan: MarketingValue, photo data: Data, name rawName: String, keep keepIds: Set<String>) -> DesignStartRequest {
        let width = max(1, plan.n("width", 1080)), height = max(1, plan.n("height", 1080))
        let h = max(1, min(100, Int((100 / (width / height)).rounded())))
        let keep = plan["layers"].array.filter { keepIds.contains($0.s("id")) }
        let cutout: String? = plan["cutout"] != .null && !plan["cutout"].s("data").isEmpty ? "data:\(plan["cutout"].s("mimeType", "image/png"));base64,\(plan["cutout"].s("data"))" : nil
        let ground = cutout == nil ? nil : DesignSmartModel.edgeColour(data)
        let headline = keep.first { $0.s("role") == "headline" }?.s("text") ?? ""
        let subject = plan["subject"]
        let name = rawName.replacingOccurrences(of: "\\.[A-Za-z0-9]+$", with: "", options: .regularExpression)
        var req = DesignStartRequest(kind: "custom", sizes: [DesignSizeChoice(id: "custom", customW: 100, customH: h)],
                                     photo: DesignStartPhoto(label: name.isEmpty ? "Picture" : name, load: { data }), fields: headline.isEmpty ? [:] : ["headline": headline])
        req.compose = { page in
            var doc = DesignWork.blankDoc(w: page.w, h: page.h)
            let k = page.w / width
            var layers: [MarketingValue] = []
            if let cutout {
                layers.append(MarketingValue(["id": "image-cutout", "kind": "image", "role": "photo", "photoId": "cutout", "src": cutout, "x": 0, "y": 0, "w": page.w, "h": page.h,
                                              "radius": 0, "border": NSNull(), "shadow": false, "rotate": 0, "opacity": 1, "cutout": true, "name": "Piece"] as [String: Any]))
            }
            for l in keep {
                var t = l
                t["x"] = .number((l.n("x") * k).rounded())
                t["y"] = .number((l.n("y") * k).rounded())
                t["size"] = .number(max(12, (l.n("size") * k).rounded()))
                if l.n("width") > 0 { t["width"] = .number((l.n("width") * k).rounded()) }
                layers.append(t)
            }
            if cutout != nil { doc["bg"]["photoId"] = .null; doc["bg"]["color"] = .string(ground ?? "#1B1B1B") }
            doc["layers"] = .array(layers)
            doc["meta"] = subject == .null ? MarketingValue([String: Any]()) : MarketingValue(["subject": subject.any] as [String: Any])
            return doc
        }
        return req
    }
}

/// The review of a split picture, in the smart input's sheet and in the workspace's own.
struct DesignLayerReviewCard: View {
    let plan: MarketingValue
    @Binding var keep: Set<String>
    let onCancel: () -> Void
    let onStart: () -> Void
    /// The sheet pins "Start a design from this" in its action bar; inline (Smart) the card carries its own buttons.
    var showsActions = true

    var body: some View {
        SectionCard("Rebuilt as layers") {
            Text(plan["cutout"] != .null ? "The piece is cut out and stands on the picture’s own colour. No part of it was redrawn." : "The photograph stays whole, with the lettering as layers above it.")
                .font(.footnote).foregroundStyle(.secondary)
            ForEach(plan["layers"].array, id: \.text) { l in
                Toggle(isOn: Binding(get: { keep.contains(l.s("id")) }, set: { on in if on { keep.insert(l.s("id")) } else { keep.remove(l.s("id")) } })) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(l.s("text")).font(.subheadline).lineLimit(2)
                        Text(l.s("role")).font(.caption2).foregroundStyle(.secondary)
                    }
                }.tint(Theme.accent)
            }
            ForEach(plan["notes"].array.map(\.string), id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
            if showsActions {
                HStack {
                    Button("Cancel", action: onCancel).buttonStyle(.bordered)
                    Button(action: onStart) { Label("Start a design from this", systemImage: "square.3.layers.3d").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered).tint(Theme.accent)
                }
            }
        }
    }
}

/// From the workspace: the split picture reviewed, then a new design started from it (the open one stays as a draft on this phone).
struct DesignLayersSheet: View {
    let model: DesignWorkspaceModel
    let plan: MarketingValue
    let photo: Data
    @Environment(\.dismiss) private var dismiss
    @State private var keep: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                DesignLayerReviewCard(plan: plan, keep: $keep, onCancel: { dismiss() }, onStart: start, showsActions: false)
                    .padding(.horizontal, pt(16)).padding(.vertical, pt(12))
            }
            .modifier(HouseGround())
            .navigationTitle("Layers").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .actionBar(primary: .init("Start a design from this", systemImage: "square.3.layers.3d", isDisabled: keep.isEmpty, action: start))
            .onAppear { keep = Set(plan["layers"].array.map { $0.s("id") }) }
        }
    }

    private func start() {
        let req = DesignLayerPlan.request(plan: plan, photo: photo, name: model.work?.displayName ?? "Picture", keep: keep)
        dismiss()
        Task {
            await model.flush()
            if await model.start(req) { model.say("A new design from the picture", detail: "The one you had is kept as a draft on this phone.") }
        }
    }
}

// MARK: The card's AI group and the picture waiting for a look

struct DesignAITools: View {
    let model: DesignWorkspaceModel
    let access: DesignAccess

    var body: some View {
        VStack(alignment: .leading, spacing: pt(10)) {
            Label("With AI: the piece stays as it is", systemImage: "wand.and.stars").font(.subheadline.weight(.semibold))
            if let check = model.photoCheck {
                let ok = DesignAIRules.checkOK(check)
                Label(ok ? "Same piece" : (check["differences"].array.first?.string ?? "Look closely"), systemImage: ok ? "checkmark.shield" : "exclamationmark.shield")
                    .font(.footnote).foregroundStyle(ok ? Tone.settled.color : Tone.owed.color)
            }
            let off = model.aiBusy != nil || model.photos["photo"] == nil
            if model.photos["photo"] == nil { Text("Add a photograph first.").font(.footnote).foregroundStyle(.secondary) }
            VStack(spacing: pt(8)) {
                tool("Enhance: clean, colour, sparkle", "sparkles", off) { Task { await model.photoTool(.enhance) } }
                tool("Logo and labels off", "eraser", off) { Task { await model.photoTool(.clean) } }
                tool("Extend to this shape", "arrow.up.left.and.arrow.down.right", off) { Task { await model.photoTool(.extend) } }
                tool("Retouch: piece, background, light", "wand.and.sparkles", off) { Task { await model.photoTool(.retouch) } }
                tool("New setting…", "photo.artframe", off) { model.sheet = DesignSheet(title: "New setting") { DesignSettingSheet(model: model) } }
                tool("Ask AI… (anything, in your words)", "text.bubble", off) { model.sheet = DesignSheet(title: "Ask AI") { DesignAskSheet(model: model) } }
                tool("Remove background", "scissors", off) { Task { await model.cutOut() } }
                if access.ads { tool("Flat image → layers", "square.3.layers.3d", off) { Task { await model.splitLayers() } } }
                if access.ads && model.work?.kind == "ad" {
                    tool("Make the ad with AI…", "wand.and.rays", off) { model.sheet = DesignSheet(title: "Make it with AI") { DesignMakeAdSheet(model: model) } }
                }
                if model.canUndoPhoto {
                    Button { model.undoPhoto() } label: { Label("Back to the photo before", systemImage: "arrow.uturn.backward").frame(maxWidth: .infinity, alignment: .leading) }
                        .buttonStyle(.borderless).disabled(model.aiBusy != nil).font(.subheadline)
                }
            }
            Toggle("Also remove tags and strings", isOn: Binding(get: { model.tidy }, set: { model.setTidy($0) })).font(.footnote).tint(Theme.accent)
            if let busy = model.aiBusy {
                HStack(spacing: pt(8)) { ProgressView(); Text(busy + "…").font(.footnote).foregroundStyle(.secondary) }
            }
            Text("Every result is compared with your photo; one that changed the piece waits for your say.").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(pt(10))
        .background(Theme.ground, in: .rect(cornerRadius: Radius.tile, style: .continuous))
    }

    private func tool(_ title: String, _ symbol: String, _ off: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 36)
        }
        .buttonStyle(.bordered).disabled(off)
    }
}

/// An AI picture waiting for a look, between the page strip and the page: "Use it" puts it in; nothing the check doubted goes in on its own.
struct DesignCandidateBanner: View {
    let model: DesignWorkspaceModel

    var body: some View {
        if let c = model.candidate {
            let same = c.check.map { DesignAIRules.checkOK($0) }
            VStack(alignment: .leading, spacing: pt(10)) {
                Text("\(c.label): to look at").font(.headline)
                if let image = WebsitePhoto.thumbnail(c.data, maxPixel: 900) {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 280).clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                }
                if same == true {
                    Label("The same piece as the photograph.", systemImage: "checkmark.shield").font(.footnote).foregroundStyle(Tone.settled.color)
                } else if let check = c.check {
                    let diffs = check["differences"].array.prefix(3).map(\.string).joined(separator: "; ")
                    Label("The piece may have changed: " + (diffs.isEmpty ? "compare it with your photograph" : diffs) + ".", systemImage: "exclamationmark.shield")
                        .font(.footnote).foregroundStyle(Tone.problem.color)
                } else {
                    Label("Not checked: compare the piece with your photograph.", systemImage: "exclamationmark.shield").font(.footnote).foregroundStyle(Tone.owed.color)
                }
                HStack(spacing: pt(10)) {
                    if same == false || same == nil {
                        Button("Use it anyway") { model.useCandidate() }.buttonStyle(.bordered)
                    } else {
                        Button("Use it") { model.useCandidate() }.buttonStyle(.bordered).tint(Theme.accent)
                    }
                    Button("Discard") { model.candidate = nil }.buttonStyle(.bordered)
                }
            }
            .ledgerCard()
            .accessibilityElement(children: .contain)
            .accessibilityLabel("An AI picture to look at")
        }
    }
}

// MARK: New setting and Ask AI

struct DesignSettingSheet: View {
    let model: DesignWorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var sceneId = ""
    @State private var custom = ""
    @State private var shape = ""

    private var own: String { model.work.map { DesignAspect.nearest($0.activePage.w, $0.activePage.h) } ?? "1:1" }
    private var shapes: [String] { var s = ["9:16", "4:5", "1:1"]; if !s.contains(own) { s.insert(own, at: 0) }; return s }
    private var scenes: [MarketingValue] { model.catalogue["scenes"].array }
    private static func shapeName(_ s: String) -> String {
        switch s {
        case "9:16": return "Story 9:16"
        case "4:5": return "Portrait 4:5"
        case "1:1": return "Square"
        default: return s
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("The piece stays exactly as photographed; AI photographs it again in the setting you choose, then checks it is still the same piece.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("A setting") {
                    ForEach(scenes, id: \.text) { s in
                        Button { sceneId = s.s("id"); custom = "" } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.s("label")).foregroundStyle(.primary)
                                    Text(s.s("suits")).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                if sceneId == s.s("id") && custom.isEmpty { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                            }
                        }
                        .accessibilityAddTraits(sceneId == s.s("id") && custom.isEmpty ? .isSelected : [])
                    }
                }
                Section("Or say it") {
                    TextField("A velvet tray in window light…", text: $custom, axis: .vertical).lineLimit(1...4)
                }
                Section("Shape") {
                    Picker("Shape", selection: $shape) { ForEach(shapes, id: \.self) { Text(Self.shapeName($0)).tag($0) } }
                        #if os(macOS)
                        .pickerStyle(.menu)
                        #else
                        .pickerStyle(.segmented)
                        #endif
                }
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("New setting").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .actionBar(primary: .init("Photograph it", systemImage: "photo.artframe", isDisabled: sceneId.isEmpty && custom.trimmingCharacters(in: .whitespaces).isEmpty, action: go))
            .onAppear { if shape.isEmpty { shape = own }; if sceneId.isEmpty { sceneId = scenes.first?.s("id") ?? "" } }
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }

    private func go() {
        let text = custom.trimmingCharacters(in: .whitespacesAndNewlines)
        let op = DesignPhotoOp.setting(sceneId: text.isEmpty ? sceneId : nil, scene: text.isEmpty ? nil : text, aspect: shape.isEmpty ? own : shape)
        dismiss()
        Task { await model.photoTool(op) }
    }
}

struct DesignAskSheet: View {
    let model: DesignWorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var shape = "same"

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Say it the way you’d tell a photographer. The piece itself is protected, and the result is checked against the original.")
                        .font(.footnote).foregroundStyle(.secondary)
                    TextField("What should change?", text: $text, axis: .vertical).lineLimit(2...6)
                }
                Section("Ideas") {
                    ForEach(DesignAIRules.askIdeas, id: \.self) { idea in
                        Button(idea) { text = idea }.foregroundStyle(.primary)
                    }
                }
                Section("Shape") {
                    Picker("Shape", selection: $shape) {
                        Text("Same shape").tag("same"); Text("Story 9:16").tag("9:16"); Text("Portrait 4:5").tag("4:5"); Text("Square").tag("1:1")
                    }
                    #if os(macOS)
                    .pickerStyle(.menu)
                    #else
                    .pickerStyle(.segmented)
                    #endif
                }
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Ask AI").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .actionBar(primary: .init("Do it", systemImage: "text.bubble", isDisabled: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, action: go))
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }

    private func go() {
        let instruction = text
        let op = DesignPhotoOp.ask(instruction, aspect: shape == "same" ? nil : shape)
        dismiss()
        Task { await model.photoTool(op) }
    }
}

/// "Make the ad with AI" (ai-tools.tsx, the make dialog for an ad): an aim, if there is one, then the art director.
struct DesignMakeAdSheet: View {
    let model: DesignWorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var brief = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Aim (optional), e.g. Eid gifting", text: $brief, axis: .vertical).lineLimit(1...4)
                } footer: {
                    Text("Lays the ad out from the photograph and its details: the layout, the words on the picture and the ad’s own text and headline, on every size. The photo is extended to the shape if it needs it. Then you look at it.")
                }
            }
            .houseForm()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Make the ad with AI").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .actionBar(primary: .init("Make it", systemImage: "wand.and.rays", action: go))
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }

    private func go() {
        let aim = brief
        dismiss()
        Task { await model.makeAd(brief: aim) }
    }
}
