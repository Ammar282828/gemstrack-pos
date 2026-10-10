import SwiftUI
import PhotosUI
import ERPCore

struct StudioScreen: View {
    let path: String
    @State private var model = StudioModel()
    @Environment(Session.self) private var session
    var body: some View {
        Group {
            if session.role == "owner" || session.role == "marketing" {
                VStack(spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach([("plan", "Plan"), ("photos", "Photos"), ("make", "Make"), ("board", "Board"), ("saved", "Saved")], id: \.0) { key, title in
                                FilterChip(title: title, chosen: model.tab == key) { model.tab = key }
                            }
                        }.padding(.horizontal, 20).padding(.vertical, 8)
                    }
                    page
                }
            } else { AdsOwnersOnly() }
        }
        .modifier(HouseGround()).navigationTitle("Studio").navigationBarTitleDisplayMode(.inline)
        .task { await model.load(path: path) }
        .onChange(of: model.tab) { _, tab in
            if tab == "photos", !["picks", "library"].contains(model.part) { model.part = "picks" }
            if tab == "plan", !["plays", "guide", "rivals"].contains(model.part) { model.part = "plays" }
        }
        .navigationDestination(item: $model.route) { PlaceScreen(path: $0.path) }
        .alert("Could not finish", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
        .websiteBusy(model.busy)
    }
    @ViewBuilder private var page: some View {
        switch model.tab {
        case "photos": StudioLibrary(model: model)
        case "make": StudioMaker(model: model)
        case "saved": StudioSaved(model: model)
        case "board": StudioBoards(model: model)
        default: StudioPlan(model: model)
        }
    }
}

struct StudioPlan: View {
    @Bindable var model: StudioModel
    var body: some View {
        List {
            Section {
                Picker("Plan", selection: $model.part) { Text("What to run").tag("plays"); Text("Ad days and rules").tag("guide"); Text("Competitors").tag("rivals") }.pickerStyle(.menu)
            }.houseRows()
            switch model.part {
            case "guide": guide
            case "rivals": StudioRivals()
            default: plays
            }
        }.listStyle(.insetGrouped)
        .task(id: model.part) { if model.part == "guide" { await loadGuide() } }
    }
    @ViewBuilder private var plays: some View {
        ForEach(model.catalogue["stages"].array, id: \.text) { stage in
            LedgerSection(stage.s("title")) {
                ForEach(model.catalogue["plays"].array.filter { $0.s("stage") == stage.s("id") }, id: \.text) { play in
                    VStack(alignment: .leading, spacing: 10) {
                        Label(play.s("title"), systemImage: play["core"].bool ? "star.fill" : "megaphone").font(.headline)
                        Text(play.s("where")).font(.subheadline).foregroundStyle(.secondary)
                        DisclosureGroup("Why, who and budget") {
                            Text(play.s("why"))
                            LabeledContent("Who", value: play.s("who")); LabeledContent("Budget", value: play.s("budget")); LabeledContent("Judge it by", value: play.s("judge"))
                            LabeledContent("Format", value: play.s("format") + (play["pair"].bool ? " + story" : ""))
                            LabeledContent("Layout", value: play.s("template")); LabeledContent("Call to action", value: play.s("cta"))
                        }.font(.subheadline)
                        Button("Make this") { Task { await model.startPlay(play) } }.buttonStyle(.glass)
                    }.padding(.vertical, 6)
                }
            }
        }
    }
    @ViewBuilder private var guide: some View {
        if model.guide != .null {
            LedgerSection("Ad days") { MarketingDetails(fields: model.guide["calendar"].object.mapValues(\.any)) }
        }
        LedgerSection("What our ads say", collapsible: true) {
            Button("Read the account’s winners again") { Task { await model.run("Reading the account’s ads…") { let r = try await MarketingRequest.send("/api/ads/studio/guide"); model.guide["winners"] = r["winners"] } } }
            MarketingDetails(fields: model.guide["winners"].object.mapValues(\.any))
        }
        LedgerSection("This week’s board", collapsible: true) {
            MarketingDetails(fields: model.weekly["weekly"].object.mapValues(\.any))
            Button("Make this week’s board") { weekly("start") }
            Button("Continue designing") { weekly("continue") }
        }
        ForEach(model.catalogue["playbook"].array, id: \.text) { section in
            LedgerSection(section.s("title"), collapsible: true) {
                Text(section.s("lead"))
                ForEach(section["points"].array, id: \.text) { point in VStack(alignment: .leading, spacing: 5) { Text(point.s("head")).font(.headline); Text(point.s("body")).font(.subheadline).foregroundStyle(.secondary) }.padding(.vertical, 5) }
            }
        }
    }
    private func loadGuide() async {
        if House.isDemo { return }
        await model.run("Loading ad days…") {
            model.guide = try await MarketingRequest.get("/api/ads/studio/guide")
            model.weekly = try await MarketingRequest.get("/api/ads/studio/weekly")
        }
    }
    private func weekly(_ action: String) { Task { await model.run("Designing this week’s board…") { model.weekly = try await MarketingRequest.send("/api/ads/studio/weekly", ["action": action]) } } }
}

struct StudioMaker: View {
    @Bindable var model: StudioModel
    @State private var picker: PhotosPickerItem?
    @State private var editing = false
    @State private var share: MarketingFileShare?
    @State private var folders: [MarketingValue] = []
    @State private var start = Date()
    @State private var days = 7
    @State private var photoBrief = ""
    @State private var scene = ""
    private func field(_ key: String) -> Binding<String> { Binding(get: { model.fields[key] ?? "" }, set: { model.fields[key] = $0 }) }
    var body: some View {
        Form {
            if let said = model.said { Section { Text(said).font(.footnote); Button("Dismiss") { model.said = nil } }.houseRows() }
            source
            if model.photo != nil { design; words; ai; checks; destinations; saving }
        }
        .task(id: model.renderKey) { await model.preview() }
        .task { if !House.isDemo { folders = (try? await MarketingRequest.get("/api/ads/studio/saved")["folders"].array) ?? [] } }
        .onChange(of: picker) { _, item in if let item { Task { if let bytes = try? await item.loadTransferable(type: Data.self) { await model.upload(bytes) }; picker = nil } } }
        .sheet(isPresented: $editing) { ArtworkEditor(doc: $model.doc, photos: model.photos, fields: model.fields, ad: true) }
        .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
    }
    private var source: some View {
        Section {
            Button("Choose from the library") { model.tab = "photos"; model.part = "picks" }
            PhotosPicker(selection: $picker, matching: .images) { Label("A photo from this iPhone", systemImage: "photo.badge.plus") }
            if model.asset != .null {
                LabeledContent("Piece", value: model.asset.s("name"))
                if model.asset["original"] != .null { Button("Use clean original from Drive") { Task { await model.choose(model.asset) } } }
                if model.asset.s("source") == "site" { Button("Use the website’s photo") { Task { await model.choose(model.asset, preferOriginal: false) } } }
            }
            if let original = model.originalPhoto, original != model.photo { Button("Restore original photo") { model.photo = original; Task { await model.run("Restoring photo…") { try await model.layout() } } } }
        }.houseRows()
    }
    private var design: some View {
        Section {
            if let image = NativeArtwork.image(model.image) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 420).frame(maxWidth: .infinity) }
            Picker("Shape", selection: $model.format) { ForEach(model.catalogue["formats"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) }; Text("Custom").tag("custom") }
                .onChange(of: model.format) { _, _ in layout() }
            if model.format == "custom" {
                TextField("Width", value: $model.customWidth, format: .number).keyboardType(.numberPad)
                TextField("Height", value: $model.customHeight, format: .number).keyboardType(.numberPad)
                Button("Apply custom shape") { layout() }
            }
            Picker("Layout", selection: $model.template) { ForEach(model.catalogue["templates"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) } }.onChange(of: model.template) { _, _ in layout() }
            Button("Edit design") { editing = true }
            Menu("Share or save image") {
                Button("This size") { export(all: false) }; Button("Every size") { export(all: true) }
            }
        }.houseRows()
    }
    private var words: some View {
        Section {
            TextField("Headline on the picture", text: field("headline"), axis: .vertical)
            DisclosureGroup("Picture words") {
                TextField("Small line", text: field("kicker")); TextField("Specs", text: field("weight"), axis: .vertical)
                if !model.asset.s("specs").isEmpty { Button("Use the ERP’s specs") { model.fields["weight"] = model.asset.s("specs") } }
                TextField("Call to action", text: field("details"), axis: .vertical)
                TextField("Price (optional)", text: $model.price); Button("Put price on the picture") { model.fields["details"] = model.price }
                ForEach(model.catalogue["brand"]["voice"]["ctas"].array, id: \.text) { cta in Button(cta.string) { model.fields["details"] = cta.string } }
            }
            DisclosureGroup("Ad caption and headline") {
                TextField("Primary text", text: $model.text, axis: .vertical).lineLimit(3...12)
                TextField("Ad headline", text: $model.headline, axis: .vertical)
                Button("Write with AI") { Task { await model.writeWords() } }
                ForEach(model.copy["primaryText"].array, id: \.text) { item in Button(item.string) { model.text = item.string } }
                ForEach(model.copy["headlines"].array, id: \.text) { item in Button(item.string) { model.headline = item.string } }
                MarketingDetails(fields: model.copy.object.filter { !["primaryText", "headlines"].contains($0.key) }.mapValues(\.any))
            }
        }.houseRows()
    }
    private var ai: some View {
        Section {
            DisclosureGroup("AI photo and design tools") {
                TextField("Your brief", text: $model.brief, axis: .vertical).lineLimit(2...8)
                Button("Make it with AI") { Task { await model.makeAI(paint: false) } }
                Button("Paint the whole ad") { Task { await model.makeAI(paint: true) } }
                TextField("Photo instructions", text: $photoBrief, axis: .vertical)
                Menu("Photo tools") {
                    Button("Remove logo and labels") { imageAI("enhance", ["tidy": true]) }
                    Button("Enhance") { imageAI("enhance", ["tidy": false]) }
                    Button("Retouch") { imageAI("retouch") }
                    Button("Extend to this shape") { imageAI("reframe", ["aspect": model.formatInfo.s("ai", "4:5"), "tidy": model.marked]) }
                    Button("Ask AI") { imageAI("custom", ["instruction": photoBrief, "aspect": model.formatInfo.s("ai", "4:5")]) }
                }
                Picker("New setting", selection: $scene) { Text("Choose…").tag(""); ForEach(model.catalogue["scenes"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) } }
                Button("Restage") { imageAI("restage", ["sceneId": scene, "scene": photoBrief, "aspect": model.formatInfo.s("ai", "4:5")]) }.disabled(scene.isEmpty && photoBrief.isEmpty)
                if model.direction != .null { MarketingDetails(fields: model.direction.object.mapValues(\.any)) }
                if model.painted != .null {
                    if let bytes = Data(base64Encoded: model.painted["image"].s("data")), let image = UIImage(data: bytes) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 360) }
                    MarketingDetails(fields: model.painted.object.filter { $0.key != "image" }.mapValues(\.any))
                    Button("Use this version") { Task { await model.usePainted() } }
                    Button("Discard version", role: .destructive) { model.painted = .null }
                }
            }
        }.houseRows()
    }
    private var checks: some View {
        Section {
            DisclosureGroup("Check before spending") {
                DatePicker("Start", selection: $start, displayedComponents: .date).environment(\.timeZone, ERPDate.karachi)
                Stepper("\(days) days", value: $days, in: 1...90)
                Button("Check this ad") { Task { await model.checkAd(start: AnaDate.dayKey(start), days: days) } }
                MarketingDetails(fields: model.check.object.mapValues(\.any))
            }
        }.houseRows()
    }
    private var destinations: some View {
        Section {
            Picker("Destination", selection: $model.goal) { ForEach([("whatsapp", "WhatsApp chats"), ("messages", "WhatsApp or Instagram chats"), ("channel", "WhatsApp channel"), ("profile", "Instagram profile"), ("website", "Website"), ("sales", "Online sales")], id: \.0) { key, label in Text(label).tag(key) } }
            if ["website", "sales", "channel"].contains(model.goal) { TextField("Destination link", text: $model.link).textInputAutocapitalization(.never).keyboardType(.URL) }
            if ["portrait", "square"].contains(model.format) { Toggle("Include a 9:16 version", isOn: $model.pair) }
            Button("Continue to New ad") { Task { await model.newAd() } }.buttonStyle(.houseProminent)
            Button("Post it") { Task { await model.post() } }
        }.houseRows()
    }
    private var saving: some View {
        Section {
            Picker("Folder", selection: $model.folder) { Text("No folder").tag(""); ForEach(folders, id: \.text) { Text($0.s("name")).tag($0.s("id")) } }
            Button(model.savedID == nil ? "Save design" : "Save changes") { Task { await model.save(asNew: false) } }
            if model.savedID != nil { Button("Save as a new design") { Task { await model.save(asNew: true) } } }
        }.houseRows()
    }
    private func layout() { Task { await model.run("Updating layout…") { try await model.layout() } } }
    private func imageAI(_ op: String, _ params: [String: Any] = [:]) { Task { await model.imageAI(op, params: params) } }
    private func export(all: Bool) {
        Task { await model.run("Preparing images…") {
            let sizes = all ? model.catalogue["formats"].array.map { $0.s("id") } : [model.format]
            var files: [Any] = []
            for size in sizes { let bytes = try await model.rendered(size); let url = FileManager.default.temporaryDirectory.appendingPathComponent("ad-\(size)-\(UUID().uuidString).jpg"); try bytes.write(to: url); files.append(url) }
            share = MarketingFileShare(items: files)
        } }
    }
}
