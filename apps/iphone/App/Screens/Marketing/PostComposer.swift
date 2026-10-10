import SwiftUI
import PhotosUI

struct PostComposerScreen: View {
    let path: String
    @State private var model = PostComposerModel()
    @State private var photos: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var sitePicker = false
    @State private var draftsOpen = false
    @State private var design: String?
    @State private var ai: NativePostAIRequest?
    @State private var share: MarketingFileShare?
    @State private var sharedStory = false
    @State private var confirmation: String?
    @State private var queued: Route?
    @Environment(\.openURL) private var openURL
    private var d: NativePostDraft { model.draft }
    private var form: some View {
        Form {
            if let error = model.error { Section { Text(error).foregroundStyle(.red); Button("Dismiss") { model.error = nil } }.houseRows() }
            if let said = model.said { Section { Text(said) }.houseRows() }
            photoSection
            designSection
            if model.makeSquare { captionSection }
            publishSection
            healthSection
        }
    }
    private var observedForm: some View {
        form
        .modifier(HouseGround()).navigationTitle("Post a piece").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Drafts") { draftsOpen = true }
                    Button("New piece") { Task { await model.startOver() } }
                    Button("Check connections") { Task { await model.refreshConnections() } }
                } label: { Label("More", systemImage: "ellipsis") }
            }
        }
        .task { await model.load(); if let key = AdsQuery.value("studio", in: path), let draft = StudioHandoffs.shared.posts.removeValue(forKey: key) { model.draft = draft; await model.saveNow() }; if AdsQuery.value("new", in: path) == "1", !model.draft.photos.isEmpty { await model.startOver() } }
        .task(id: renderKey) { await model.preview() }
        .onChange(of: model.draft) { _, _ in model.changed() }
        .onChange(of: photos) { _, items in if !items.isEmpty { Task { await take(items) } } }
    }
    private var presentedForm: some View {
        observedForm
        .sheet(isPresented: $camera) { NewOrderCamera { image in camera = false; if let image, let data = WebsitePhoto.jpeg(image) { Task { await model.add(data, name: "Camera photo") } } }.ignoresSafeArea() }
        .sheet(isPresented: $sitePicker) { NativeSitePhotoPicker { piece, data in
            Task { if d.words.s("headline").isEmpty { model.draft.words["headline"] = piece["name"] }; if d.words.s("weight").isEmpty, piece.n("weightGrams") > 0 { model.draft.words["weight"] = .string(WebsiteNumber.grams(piece.n("weightGrams"))) }; await model.add(data, name: piece.s("name"), from: MarketingValue(["id": piece.s("id"), "name": piece.s("name"), "url": piece.s("url"), "marked": piece["photoSource"] == .null || piece["sourceMarked"].bool])) }
        } }
        .sheet(isPresented: $draftsOpen) { draftSheet }
        .sheet(isPresented: Binding(get: { design != nil }, set: { if !$0 { design = nil } })) { ArtworkEditor(doc: Binding(get: { design == "story" ? model.draft.story : model.draft.square }, set: { if design == "story" { model.draft.story = $0 } else { model.draft.square = $0 } }), photos: model.assets, fields: model.fields) }
        .sheet(item: $ai) { NativePostAISheet(request: $0, model: model) }
        .sheet(item: $share) { MarketingShareSheet(items: $0.items) { completed in
            if completed && sharedStory { model.draft.words["storyOut"] = .bool(true); Task { await model.saveNow() } }
            sharedStory = false
        } }
    }
    var body: some View {
        presentedForm
        .navigationDestination(item: $queued) { r in PlaceScreen(path: r.path) }
        .confirmationDialog(confirmation == "queue" ? "Keep this post in the queue?" : "Publish this post?", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
            Button(publishButtonTitle, action: publishConfirmed)
            Button("Cancel", role: .cancel) { confirmation = nil }
        } message: { Text(publishWords) }
        .websiteBusy(model.busy).disabled(!model.loaded)
        .interactiveDismissDisabled(model.busy != nil)
        .onDisappear { Task { await model.saveNow() } }
    }
    private var publishButtonTitle: String { confirmation == "queue" ? "Add to queue" : "Publish" }
    private func publishConfirmed() {
        let queueOnly = confirmation == "queue"
        confirmation = nil
        Task { await model.finish(queueOnly: queueOnly) }
    }
    private var photoSection: some View {
Section {
                TextField("Headline", text: word("headline"), axis: .vertical).font(.title3.weight(.semibold)).lineLimit(1...4)
                if d.photos.isEmpty { ContentUnavailableView("Start with a photo", systemImage: "photo.on.rectangle", description: Text("Choose photos, take one, or bring in a website piece.")) }
                else { photoStrip }
                if !model.frozen {
                    PhotosPicker(selection: $photos, maxSelectionCount: max(1, 12 - d.photos.count), matching: .images) { Label("Add photos", systemImage: "photo.badge.plus") }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) { Button { camera = true } label: { Label("Camera", systemImage: "camera") } }
                    Button { sitePicker = true } label: { Label("From the website", systemImage: "globe") }
                }
                DisclosureGroup("Piece details") {
                    TextField("Small line above the headline", text: word("kicker"))
                    TextField("Weight in grams", text: word("weight")).keyboardType(.decimalPad)
                    Toggle("Weight per piece", isOn: flag("weightEach"))
                    TextField("Metal", text: word("metal")); TextField("Stones", text: word("stones"))
                    TextField("Caption’s extra line", text: word("hook"), axis: .vertical).lineLimit(1...5)
                }
            }.houseRows().disabled(model.frozen)
    }
    private var designSection: some View {
Section {
                Picker("Make", selection: word("formats")) { Text("Post + story").tag("both"); Text("Post only").tag("square"); Text("Story only").tag("story") }.pickerStyle(.menu).disabled(model.frozen)
                if model.makeStory { designPreview("story", response: model.storyPreview) }
                if model.makeSquare { designPreview("square", response: model.squarePreview) }
                if model.hero != nil && !model.frozen {
                    Menu("AI tools") {
                        Button("Write captions") { ai = .init(op: "caption", target: "captions", photoID: nil) }
                        Button("Make the whole story") { ai = .init(op: "whole", target: "story", photoID: nil) }
                        Button("Letter the story") { ai = .init(op: "letter", target: "story", photoID: nil) }
                        Button("Paint the story") { ai = .init(op: "paint", target: "story", photoID: nil) }
                        Button("Paint the post") { ai = .init(op: "paint", target: "post", photoID: nil) }
                    }
                }
            }.houseRows()
    }
    private var publishSection: some View {
Section {
                DisclosureGroup("Where it goes") { destinations.disabled(model.frozen) }
                if model.frozen, let id = d.queuedID {
                    Button("Open queued piece") { queued = Route(path: "/marketing/queue?id=" + id) }
                    if d.queueReady != true { Button("Finish uploading") { Task { await model.finish(queueOnly: true) } } }
                    else { Button("Send what remains") { confirmation = "send" } }
                    Button("Next piece") { Task { await model.startOver() } }
                } else {
                    if !model.problems.isEmpty { Text(model.problems.joined(separator: " ")).font(.footnote).foregroundStyle(.secondary) }
                    Button("Add to queue") { confirmation = "queue" }.disabled(!model.problems.isEmpty)
                    Button("Publish") { confirmation = "send" }.buttonStyle(.houseProminent).disabled(!model.problems.isEmpty)
                    if model.manualStory { Button("Share or save story") { Task { await shareDesign("story") } } }
                }
            }.houseRows()
    }
    private var renderKey: String { d.story.text + d.square.text + MarketingValue.object(d.words.object.filter { !["caption", "captionEdited", "storyOut"].contains($0.key) }).text + d.photos.map { $0.id + $0.name }.joined() + String(d.paintedStory?.count ?? 0) + String(d.paintedSquare?.count ?? 0) }
    private func word(_ key: String) -> Binding<String> { Binding(get: { model.draft.words.s(key) }, set: { model.draft.words[key] = .string($0) }) }
    private func flag(_ key: String) -> Binding<Bool> { Binding(get: { model.draft.words[key].bool }, set: { model.draft.words[key] = .bool($0) }) }
    private var photoStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 16) {
                ForEach(d.photos) { p in VStack(alignment: .leading, spacing: 8) {
                    if let image = WebsitePhoto.thumbnail(p.data, maxPixel: 350) { Image(uiImage: image).resizable().scaledToFit().frame(width: 150, height: 150).background(Theme.ground, in: .rect(cornerRadius: 12)) }
                    Button(model.hero?.id == p.id ? "Lead photo ✓" : "Make lead photo") { model.draft.story["bg"]["photoId"] = .string(p.id) }.font(.subheadline)
                    Toggle("Website", isOn: photoFlag(p.id, site: true)).disabled(model.frozen)
                    Toggle("WhatsApp", isOn: photoFlag(p.id, site: false)).disabled(model.frozen)
                    if let check = p.check, check != .null {
                        DisclosureGroup(check["samePiece"].bool && check.n("confidence") >= 0.8 ? "Piece checked" : "Compare with original") { MarketingDetails(fields: check.object.mapValues(\.any)) }
                    }
                    Menu("Photo tools") {
                        ForEach([("enhance", "Enhance"), ("retouch", "Retouch"), ("reframe", "Extend / change shape"), ("restage", "New setting"), ("custom", "Ask AI")], id: \.0) { op, label in Button(label) { ai = .init(op: op, target: label, photoID: p.id) } }
                        Button("Edit crop") { model.draft.square["bg"]["photoId"] = .string(p.id); design = "square" }
                        Button("Share original") { share = MarketingFileShare(items: [UIImage(data: p.data) as Any]) }
                        Button("Remove photo", role: .destructive) { model.draft.photos.removeAll { $0.id == p.id }; if model.draft.story["bg"].s("photoId") == p.id { model.draft.story["bg"]["photoId"] = .string(model.draft.photos.first?.id ?? "") } }
                    }.disabled(model.frozen)
                }.frame(width: 150) }
            }
        }
    }
    private func photoFlag(_ id: String, site: Bool) -> Binding<Bool> { Binding(get: { guard let p = model.draft.photos.first(where: { $0.id == id }) else { return false }; return site ? p.toSite : p.toWhatsApp }, set: { on in if let i = model.draft.photos.firstIndex(where: { $0.id == id }) { if site { model.draft.photos[i].toSite = on } else { model.draft.photos[i].toWhatsApp = on } } }) }
    private func designPreview(_ kind: String, response: MarketingValue) -> some View {
        DisclosureGroup(kind == "story" ? "Story · 9:16" : "Post · 1:1") {
            if let image = NativeArtwork.image(response) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 420).frame(maxWidth: .infinity) }
            if !model.frozen { Button("Edit design") { design = kind } }
            Button("Share or save") { Task { await shareDesign(kind) } }
            if (kind == "story" ? d.paintedStory : d.paintedSquare) != nil {
                Button("Use our design") { if kind == "story" { model.draft.paintedStory = nil; model.draft.paintedStoryFor = nil } else { model.draft.paintedSquare = nil; model.draft.paintedSquareFor = nil } }.disabled(model.frozen)
                if let checked = d.letteringCheck { DisclosureGroup("Check the AI version") { MarketingDetails(fields: checked.object.filter { $0.key != "image" }.mapValues(\.any)) } }
            }
        }
    }
    private var captionSection: some View {
        Section {
            TextField("Caption", text: Binding(get: { d.words.s("caption") }, set: { model.draft.words["caption"] = .string($0); model.draft.words["captionEdited"] = .bool(true) }), axis: .vertical).lineLimit(4...12)
            Menu("Caption tools") {
                Button("Write with AI") { ai = .init(op: "caption", target: "captions", photoID: nil) }
                Button("Use the shop’s caption") { model.draft.words["captionEdited"] = .bool(false); Task { await model.preview() } }
                Button("Copy") { UIPasteboard.general.string = d.words.s("caption") }
                Button("Share caption") { share = MarketingFileShare(items: [d.words.s("caption")]) }
            }
            if model.aiAnswer["caption"] != .null { DisclosureGroup("AI alternatives") { let c = model.aiAnswer["caption"]; ForEach(c["headlines"].array, id: \.text) { item in Button(item.string) { model.draft.words["headline"] = item } }; MarketingDetails(fields: c.object.filter { !["headlines", "whatsappCaption"].contains($0.key) }.mapValues(\.any)) } }
        } header: { Text("Caption") }.houseRows().disabled(model.frozen)
    }
    @ViewBuilder private var destinations: some View {
        if model.makeSquare {
            if !model.config.s("site").isEmpty {
                Toggle(model.config.s("siteName", "Website"), isOn: flag("toWebsite"))
                if d.words["toWebsite"].bool {
                    Picker("Collection", selection: word("folder")) { Text("Choose…").tag(""); ForEach(model.folders, id: \.text) { f in Text(f.s("collection")).tag(f.s("folder")) } }
                    TextField("Name on the website", text: word("siteName"))
                    if d.words.s("folder").hasSuffix("The Maisons") { TextField("House", text: word("maisonHouse")) }
                    if model.config["featured"].bool { Toggle("Set of the day", isOn: flag("feature")) }
                }
            }
            Toggle("WhatsApp", isOn: flag("toWhatsApp"))
            if d.words["toWhatsApp"].bool {
                ForEach(model.audience["groups"].array, id: \.text) { g in Toggle(g.s("label", g.s("name")), isOn: waTarget(g.s("key"))) }
                if model.audience["channel"] != .null { Toggle(model.audience["channel"].s("name", "Channel"), isOn: waTarget("channel")) }
                if model.audience["community"] == .null { Text("WhatsApp is not connected. Check connections below.").font(.footnote).foregroundStyle(.orange) }
            }
        }
        if model.makeStory {
            Toggle("Post story to Instagram", isOn: flag("toInstagram")).disabled(!model.instagram["connected"].bool)
            if model.instagram["connected"].bool { Text("@" + model.instagram.s("username")).font(.footnote).foregroundStyle(.secondary) }
            else { Button("Connect Instagram") { Task { do { let r = try await MarketingRequest.send("/api/instagram/connect"); if let url = URL(string: r.s("url")) { openURL(url) } } catch { model.error = error.localizedDescription } } } }
            if model.manualStory { Text("Share the story from your phone to add music or stickers.").font(.footnote).foregroundStyle(.secondary) }
        }
        if let link = URL(string: model.config["posting"]["links"].s("waChannel")), link.scheme == "https" { Link("Open WhatsApp channel for manual sharing", destination: link) }
    }
    private func waTarget(_ key: String) -> Binding<Bool> { Binding(get: { d.words["waTargets"].array.contains(.string(key)) }, set: { on in var keys = model.draft.words["waTargets"].array.filter { $0 != .string(key) }; if on { keys.append(.string(key)) }; model.draft.words["waTargets"] = .array(keys) }) }
    private var publishWords: String {
        let places = (model.siteOn ? [model.config.s("siteName", "Website") + " · " + d.words.s("folder")] : []) + (model.igOn ? ["Instagram story · @" + model.instagram.s("username")] : []) + model.waKeys.map { "WhatsApp · " + $0 }
        let blockers = model.health["checks"].array.filter { $0.s("status") == "fail" }.map { $0.s("label") + ": " + $0.s("fix") }
        return places.joined(separator: "\n") + (blockers.isEmpty ? "" : "\n\nNeeds attention:\n" + blockers.joined(separator: "\n")) + (confirmation == "send" ? "\n\nThis sends now. A published post cannot be taken back." : "\n\nIt stays held until you send or schedule it.")
    }
    private var healthSection: some View {
        Section {
            DisclosureGroup("Connections and recent problems") {
                Button("Check again") { Task { await model.checkHealth() } }
                ForEach(model.health["checks"].array, id: \.text) { check in
                    VStack(alignment: .leading, spacing: 5) {
                        Label(check.s("label"), systemImage: check.s("status") == "ok" ? "checkmark.circle" : "exclamationmark.triangle")
                        Text(check.s("detail")).font(.footnote).foregroundStyle(.secondary)
                        if !check.s("fix").isEmpty { Text(check.s("fix")).font(.footnote) }
                    }
                }
                MarketingDetails(fields: ["Recent problems": model.health["errors"].any])
            }
        }.houseRows()
    }
    private var draftSheet: some View {
        NavigationStack { List { ForEach(model.drafts) { saved in Button { Task { await model.open(saved); draftsOpen = false } } label: { VStack(alignment: .leading, spacing: 4) { Text(saved.title); Text(saved.updated, style: .date).font(.caption).foregroundStyle(.secondary); Text("\(saved.photos.count) photos").font(.caption).foregroundStyle(.secondary) } }.swipeActions { Button("Delete", role: .destructive) { Task { await model.remove(saved) } } } }.houseRows() }.modifier(HouseGround()).navigationTitle("Drafts").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { draftsOpen = false } } } }
    }
    private func take(_ items: [PhotosPickerItem]) async { for (i, item) in items.enumerated() { do { if let data = try await item.loadTransferable(type: Data.self) { await model.add(data, name: "Photo \(i + 1)") } } catch { model.error = error.localizedDescription } }; photos = [] }
    private func shareDesign(_ kind: String) async { do { let r = try await model.render(story: kind == "story", photo: model.hero, px: kind == "story" ? 1080 : 1600); guard let bytes = Data(base64Encoded: r.s("image")) else { return }; let url = FileManager.default.temporaryDirectory.appendingPathComponent("piece-\(kind)-\(UUID().uuidString).jpg"); try bytes.write(to: url); sharedStory = kind == "story"; share = MarketingFileShare(items: [url]) } catch { model.error = error.localizedDescription } }
}

struct NativePostAIRequest: Identifiable { var id = UUID(); let op: String; let target: String; let photoID: String? }
struct NativePostAISheet: View {
    let request: NativePostAIRequest
    @Bindable var model: PostComposerModel
    @Environment(\.dismiss) private var dismiss
    @State private var instruction = ""
    @State private var rawPrompt = ""
    @State private var aspect = "9:16"
    @State private var scene = ""
    @State private var tidy = true
    @State private var running = false
    var body: some View {
        NavigationStack {
            Form {
                if let error = model.error { Section { Text(error).foregroundStyle(.red) }.houseRows() }
                Section { TextField(request.op == "letter" ? "Lettering style" : "Your brief", text: $instruction, axis: .vertical).lineLimit(3...8)
                    if ["reframe", "restage", "custom"].contains(request.op) { Picker("Shape", selection: $aspect) { ForEach(["9:16", "4:5", "1:1", "5:4", "3:4", "4:3", "2:3", "3:2", "16:9", "21:9"], id: \.self) { Text($0).tag($0) } } }
                    if request.op == "restage" { Picker("Setting", selection: $scene) { Text("Use my brief").tag(""); ForEach(model.storyPreview["catalogue"]["scenes"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) } } }
                    if ["enhance", "reframe"].contains(request.op) { Toggle("Tidy labels and background", isOn: $tidy) }
                    DisclosureGroup("Edit the full prompt") { TextField("Full prompt (optional)", text: $rawPrompt, axis: .vertical).lineLimit(4...14) }
                    Button("Make \(request.target)") { Task { await run() } }.buttonStyle(.houseProminent).disabled(running)
                }.houseRows()
                Text("A new version is kept beside the original. Check the piece and words before it goes out.").font(.footnote).foregroundStyle(.secondary)
            }.modifier(HouseGround()).navigationTitle(request.target.capitalized).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(running) } }.interactiveDismissDisabled(running)
        }
    }
    private func run() async {
        running = true; defer { running = false }
        var p: [String: Any] = ["instruction": instruction, "brief": instruction, "tidy": tidy, "aspect": request.op == "paint" ? (request.target == "post" ? "1:1" : "9:16") : aspect]
        if !rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { p["rawPrompt"] = rawPrompt }
        if request.op == "restage" { if scene.isEmpty { p["scene"] = instruction } else { p["sceneId"] = scene } }
        if request.op == "caption" || request.op == "whole" { p["headline"] = model.draft.words.s("headline"); p["weight"] = model.validWeight; p["metal"] = model.draft.words.s("metal"); p["stones"] = model.draft.words.s("stones"); p["collection"] = model.draft.words.s("folder"); p["numbers"] = model.config["posting"]["whatsappNumbers"].array.map(\.string); p["link"] = model.hero?.source?.s("url") ?? model.config.s("site") }
        if request.op == "letter" || request.op == "paint" { for (key, value) in model.fields { p[key] = value }; p["specs"] = [model.fields["details"] ?? "", model.validWeight].filter { !$0.isEmpty }.joined(separator: " | "); p["style"] = instruction; p["headlineColour"] = "#FFFFFF"; p["bodyColour"] = "#FFFFFF"; p["align"] = "left"; p["markCorner"] = "top-right" }
        model.error = nil
        await model.runAI(op: request.op == "whole" ? "caption" : request.op, photoID: request.photoID, target: request.target, params: p)
        if request.op == "whole", model.error == nil {
            let c = model.aiAnswer["caption"]
            if model.draft.words.s("kicker").isEmpty { model.draft.words["kicker"] = c["kicker"] }
            do { let r = try await model.artwork.run(doc: model.draft.story, photos: model.assets, fields: model.fields, options: ["action": "preset", "value": c.s("align") == "center" ? "center" : "stack-left", "palette": c.s("paletteId"), "weightOwnLine": c["weightOwnLine"].bool]); model.draft.story = r["doc"] } catch { model.error = error.localizedDescription }
            if model.error == nil { var params: [String: Any] = ["aspect": "9:16", "sceneId": c.s("sceneId")]; if !c.s("sceneBrief").isEmpty { params["scene"] = c.s("sceneBrief") }; await model.runAI(op: "restage", photoID: request.photoID, target: "story", params: params) }
        }
        if model.error == nil { dismiss() }
    }
}

struct NativeSitePhotoPicker: View {
    let picked: (MarketingValue, Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pieces: [MarketingValue] = []
    @State private var q = ""
    @State private var busy: String?
    @State private var error: String?
    var body: some View {
        NavigationStack { List {
            if let error { Text(error).foregroundStyle(.red) }
            ForEach(pieces.filter { q.isEmpty || ($0.s("name") + " " + $0.s("collection")).localizedCaseInsensitiveContains(q) }, id: \.text) { p in
                Button { Task { await take(p) } } label: { HStack(spacing: 12) { MarketingPhoto(path: p.s("thumb", p.s("image"))).frame(width: 64, height: 64); VStack(alignment: .leading, spacing: 4) { Text(p.s("name")).foregroundStyle(.primary); Text(p.s("collection")).font(.caption).foregroundStyle(.secondary) } } }
            }
        }.houseRows().modifier(HouseGround()).searchable(text: $q).navigationTitle("From the website").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }.task { do { pieces = try await MarketingRequest.get("/api/website/site-pieces")["pieces"].array.filter { !$0["hidden"].bool } } catch { self.error = error.localizedDescription } }.websiteBusy(busy) }
    }
    private func take(_ p: MarketingValue) async { busy = "Bringing the photo…"; defer { busy = nil }; do { let data = try await ERPAPI.shared.data("/api/website/site-pieces/image?id=\(AdsQuery.escape(p.s("id")))&size=3000" + (p["photoSource"] == .null ? "" : "&original=1")); picked(p, data) } catch { self.error = error.localizedDescription } }
}
