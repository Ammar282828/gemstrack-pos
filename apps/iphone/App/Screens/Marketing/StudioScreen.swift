import SwiftUI
import PhotosUI
import ERPCore

struct StudioScreen: View {
    let path: String
    @State private var model = StudioModel()
    @Environment(Session.self) private var session
    var body: some View {
        #if os(macOS)
        macRedirect
        #else
        phoneBody
        #endif
    }

    #if os(macOS)
    /// The legacy Studio shell is gone on the Mac (docs/features/mac-design.md): its address opens the place that took over its
    /// part. Plan is Ads › Plan; Photos, Make, Board and Saved are Design's.
    private var designPath: String {
        switch AdsQuery.value("v", in: path) ?? "plan" {
        case "plan": return "/ads/plan"
        case "guide": return "/ads/plan?s=guide"
        case "rivals": return "/ads/plan?s=rivals"
        case "photos", "picks", "library": return "/design?v=photos"
        case "board": return "/design?v=board"
        case "saved": return "/design?v=saved"
        default: return "/design?v=make"
        }
    }

    private var macRedirect: some View { ScreenRegistry.view(for: designPath) }
    #endif

    @ViewBuilder
    private var phoneBody: some View {
        Group {
            if session.role == "owner" || session.role == "marketing" {
                #if os(macOS)
                // The five tabs are a segmented control in the window's toolbar.
                page
                #else
                VStack(spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: pt(8)) {
                            ForEach([("plan", "Plan"), ("photos", "Photos"), ("make", "Make"), ("board", "Board"), ("saved", "Saved")], id: \.0) { key, title in
                                FilterChip(title: title, chosen: model.tab == key) { model.tab = key }
                            }
                        }.padding(.horizontal, pt(20)).padding(.vertical, pt(8))
                    }
                    page
                }
                #endif
            } else { AdsOwnersOnly() }
        }
        .modifier(HouseGround()).navigationTitle("Studio").navigationBarTitleDisplayMode(.inline)
        #if os(macOS)
        .toolbar {
            if session.role == "owner" || session.role == "marketing" {
                ToolbarItem(placement: .principal) {
                    Picker("Studio", selection: $model.tab) {
                        Text("Plan").tag("plan"); Text("Photos").tag("photos"); Text("Make").tag("make")
                        Text("Board").tag("board"); Text("Saved").tag("saved")
                    }
                    .pickerStyle(.segmented)
                    .frame(minWidth: 380)
                    .help("The studio's parts")
                }
            }
        }
        #endif
        .task { await model.load(path: path) }
        .onChange(of: model.tab) { _, tab in
            if tab == "photos", !["picks", "library"].contains(model.part) { model.part = "picks" }
            if tab == "plan", !["plays", "guide", "rivals"].contains(model.part) { model.part = "plays" }
        }
        .navigationDestination(item: $model.route) { PlaceScreen(path: $0.path) }
        .failureAlert($model.error)
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
    #if os(macOS)
    @State private var macPicked = Set<String>()
    @State private var macOrder = [KeyPathComparator(\StudioMacPlay.stageOrder)]
    #endif
    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }
    @ViewBuilder
    private var phoneBody: some View {
        List {
            Section {
                #if os(macOS)
                Picker("Plan", selection: $model.part) { Text("What to run").tag("plays"); Text("Ad days and rules").tag("guide"); Text("Competitors").tag("rivals") }.pickerStyle(.segmented).labelsHidden()
                #else
                Picker("Plan", selection: $model.part) { Text("What to run").tag("plays"); Text("Ad days and rules").tag("guide"); Text("Competitors").tag("rivals") }.pickerStyle(.menu)
                #endif
            }.houseRows()
            switch model.part {
            case "guide": guide
            case "rivals": StudioRivals()
            default: plays
            }
        }.listStyle(.insetGrouped)
        #if os(macOS)
        .frame(maxWidth: .infinity)
        #endif
        .task(id: model.part) { if model.part == "guide" { await loadGuide() } }
    }
    @ViewBuilder private var plays: some View {
        ForEach(model.catalogue["stages"].array, id: \.text) { stage in
            LedgerSection(stage.s("title")) {
                ForEach(model.catalogue["plays"].array.filter { $0.s("stage") == stage.s("id") }, id: \.text) { play in
                    VStack(alignment: .leading, spacing: pt(10)) {
                        Label(play.s("title"), systemImage: play["core"].bool ? "star.fill" : "megaphone").font(.headline)
                        Text(play.s("where")).font(.subheadline).foregroundStyle(.secondary)
                        DisclosureGroup("Why, who and budget") {
                            Text(play.s("why"))
                            LabeledContent("Who", value: play.s("who")); LabeledContent("Budget", value: play.s("budget")); LabeledContent("Judge it by", value: play.s("judge"))
                            LabeledContent("Format", value: play.s("format") + (play["pair"].bool ? " + story" : ""))
                            LabeledContent("Layout", value: play.s("template")); LabeledContent("Call to action", value: play.s("cta"))
                        }.font(.subheadline)
                        Button("Make this") { model.route = Route(path: "/design?v=make&kind=ad&play=" + (play.s("id").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? play.s("id"))) }.buttonStyle(.bordered)
                    }.padding(.vertical, pt(6))
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
                ForEach(section["points"].array, id: \.text) { point in VStack(alignment: .leading, spacing: pt(5)) { Text(point.s("head")).font(.headline); Text(point.s("body")).font(.subheadline).foregroundStyle(.secondary) }.padding(.vertical, pt(5)) }
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
    @State private var discarding = false
    private func field(_ key: String) -> Binding<String> { Binding(get: { model.fields[key] ?? "" }, set: { model.fields[key] = $0 }) }
    var body: some View {
        makerForm
        .toolbar {
            if model.photo != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button(model.savedID == nil ? "Save design" : "Save changes") { Task { await model.save(asNew: false) } }
                        .disabled(model.busy != nil)
                        #if os(macOS)
                        .keyboardShortcut("s", modifiers: .command)
                        #endif
                }
            }
        }
        .task(id: model.renderKey) { await model.preview() }
        .task { if !House.isDemo { folders = (try? await MarketingRequest.get("/api/ads/studio/saved")["folders"].array) ?? [] } }
        .onChange(of: picker) { _, item in if let item { Task { if let bytes = try? await item.loadTransferable(type: Data.self) { await model.upload(bytes) } else { model.error = "Couldn’t read that photo. Try another, or save it to Photos first." }; picker = nil } } }
        .sheet(isPresented: $editing) { ArtworkEditor(doc: $model.doc, photos: model.photos, fields: model.fields, ad: true) }
        .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
    }
    private var form: some View {
        Form {
            if let said = model.said { Section { Text(said).font(.footnote); Button("Dismiss") { model.said = nil } }.houseRows() }
            source
            if model.photo != nil { design; words; ai; checks; destinations; saving }
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
    }

    @ViewBuilder
    private var makerForm: some View {
        #if os(macOS)
        // The form on the left, the picture as it will be on the right.
        MacTwoPane(sideWidth: 480, sideOnRight: true) {
            ScrollView {
                if let image = NativeArtwork.image(model.image) {
                    Image(uiImage: image).resizable().scaledToFit()
                        .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                        .padding(20)
                } else {
                    ContentUnavailableView("No picture yet", systemImage: "photo", description: Text("Choose a photo to start."))
                        .padding(.top, 60)
                }
            }
            .background(Theme.ground)
        } main: {
            form.formStyle(.grouped)
        }
        .actionBar(primary: .init("Continue to New ad", systemImage: "arrow.right", isBusy: model.busy != nil, isDisabled: model.photo == nil) { Task { await model.newAd() } })
        #else
        form
            .safeAreaBar(edge: .bottom, spacing: 0) {
                if model.photo != nil {
                    ActionBar(primary: .init("Continue to New ad", systemImage: "arrow.right", isBusy: model.busy != nil) { Task { await model.newAd() } })
                }
            }
        #endif
    }

    private var source: some View {
        Section {
            Button("Choose from the library") { model.tab = "photos"; model.part = "picks" }
            PhotosPicker(selection: $picker, matching: .images) {
                #if os(macOS)
                Label("A photo from Photos", systemImage: "photo.badge.plus")
                #else
                Label("A photo from this iPhone", systemImage: "photo.badge.plus")
                #endif
            }
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
            #if !os(macOS)
            if let image = NativeArtwork.image(model.image) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 420).frame(maxWidth: .infinity) }
            #endif
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
                    Button("Discard version", role: .destructive) { discarding = true }
                        .confirmationDialog("Discard this version? It can’t be brought back.", isPresented: $discarding, titleVisibility: .visible) {
                            Button("Discard version", role: .destructive) { model.painted = .null }
                        }
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
            Button("Post it") { Task { await model.post() } }
        }.houseRows()
    }
    private var saving: some View {
        Section {
            Picker("Folder", selection: $model.folder) { Text("No folder").tag(""); ForEach(folders, id: \.text) { Text($0.s("name")).tag($0.s("id")) } }
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

#if os(macOS)
/// One play of the plan as a row of the table.
struct StudioMacPlay: Identifiable {
    let id: String
    let stage: String
    let stageOrder: Int
    let title: String
    let place: String
    let format: String
    let budget: String
    let core: Bool
    let value: MarketingValue
}

// MARK: - The Mac's Plan: the plays as a table with the picked one's reasons in the inspector, the ad days and rules as a
// form, and the toolbar's segmented control for the three parts (docs/features/mac-design.md, "Ads").

extension StudioPlan {
    @ViewBuilder
    var macBody: some View {
        Group {
            switch model.part {
            case "guide": macGuide
            case "rivals": StudioRivals()
            default: macPlays
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Plan", selection: $model.part) {
                    Text("What to Run").tag("plays")
                    Text("Ad Days and Rules").tag("guide")
                    Text("Competitors").tag("rivals")
                }
                .pickerStyle(.segmented)
                .help("What to run, the ad days and rules, or the competitors")
            }
        }
        .task(id: model.part) { if model.part == "guide" { await loadGuide() } }
    }

    // MARK: What to run

    private var macPlayRows: [StudioMacPlay] {
        var out: [StudioMacPlay] = []
        let stages = model.catalogue["stages"].array
        for (i, stage) in stages.enumerated() {
            for play in model.catalogue["plays"].array where play.s("stage") == stage.s("id") {
                out.append(StudioMacPlay(id: play.s("id"), stage: stage.s("title"), stageOrder: i, title: play.s("title"),
                                         place: play.s("where"), format: play.s("format") + (play["pair"].bool ? " + story" : ""),
                                         budget: play.s("budget"), core: play["core"].bool, value: play))
            }
        }
        return out.sorted(using: macOrder)
    }

    private func macMakeAction(_ picked: [StudioMacPlay]) -> MacAction {
        let one: StudioMacPlay? = picked.count == 1 ? picked[0] : nil
        return MacAction("Make This", symbol: "wand.and.stars", shortcut: KeyboardShortcut(.return, modifiers: .command),
                         enabled: one != nil, isDefault: true) {
            if let p = one {
                model.route = Route(path: "/design?v=make&kind=ad&play=" + (p.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? p.id))
            }
        }
    }

    private var macPlays: some View {
        let rows = macPlayRows
        let picked = rows.filter { (p: StudioMacPlay) in macPicked.contains(p.id) }
        let make = macMakeAction(picked)
        return Table(rows, selection: $macPicked, sortOrder: $macOrder) {
            TableColumn("Play", value: \.title) { (p: StudioMacPlay) in
                HStack(spacing: 6) {
                    Image(systemName: p.core ? "star.fill" : "megaphone").foregroundStyle(p.core ? Tone.owed.color : Color.secondary).frame(width: 16)
                    Text(p.title).lineLimit(1)
                }
            }
            .width(min: 180, ideal: 280)
            TableColumn("Stage", value: \.stageOrder) { (p: StudioMacPlay) in Text(p.stage).lineLimit(1) }
                .width(min: 90, ideal: 130)
            TableColumn("Where It Runs", value: \.place) { (p: StudioMacPlay) in Text(p.place).foregroundStyle(.secondary).lineLimit(1) }
                .width(min: 120, ideal: 240)
            TableColumn("Format", value: \.format) { (p: StudioMacPlay) in Text(p.format).lineLimit(1) }
                .width(min: 80, ideal: 120)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            let hit = rows.filter { (p: StudioMacPlay) in ids.contains(p.id) }
            MacActionItems(groups: [[macMakeAction(hit)]])
        } primaryAction: { (ids: Set<String>) in
            let hit = rows.filter { (p: StudioMacPlay) in ids.contains(p.id) }
            macMakeAction(hit).perform()
        }
        .overlay {
            if rows.isEmpty { MarketingReading(text: "Reading the plan…") }
        }
        .macInspector { macPlayInspector(picked, make) }
        .macRecordMenu(MacRecordMenu(title: "Play", groups: [[make]]))
        .macSummaryBar(["\(rows.count) plays", "\(rows.filter { (p: StudioMacPlay) in p.core }.count) core"])
        .toolbar {
            ToolbarItem(placement: .primaryAction) { MacToolbarAction(action: make) }
        }
    }

    @ViewBuilder
    private func macPlayInspector(_ picked: [StudioMacPlay], _ make: MacAction) -> some View {
        if picked.count == 1, let p = picked.first {
            VStack(spacing: 0) {
                MacInspectorHeader(title: p.title, subtitle: p.stage + (p.core ? " · core" : ""), actions: [make])
                    .padding(16)
                Divider()
                Form {
                    Section("Where It Runs") { Text(p.place) }
                    Section("Why") { Text(p.value.s("why")) }
                    Section {
                        LabeledContent("Who", value: p.value.s("who"))
                        LabeledContent("Budget", value: p.budget)
                        LabeledContent("Judge it by", value: p.value.s("judge"))
                        LabeledContent("Format", value: p.format)
                        LabeledContent("Layout", value: p.value.s("template"))
                        LabeledContent("Call to action", value: p.value.s("cta"))
                    }
                }
                .formStyle(.grouped)
            }
        } else {
            MacInspectorEmpty(title: macPicked.count > 1 ? "\(macPicked.count) Selected" : "No Play Selected",
                              detail: "Click a play to see why, for whom and for how much. Make This opens Design on it.")
        }
    }

    // MARK: Ad days and rules

    private func macReadWinners() {
        Task {
            await model.run("Reading the account's ads…") {
                let r = try await MarketingRequest.send("/api/ads/studio/guide")
                model.guide["winners"] = r["winners"]
            }
        }
    }

    private var macGuide: some View {
        Form {
            if model.guide != .null {
                Section("Ad Days") { MarketingDetails(fields: model.guide["calendar"].object.mapValues(\.any)) }
            }
            Section("What Our Ads Say") { MarketingDetails(fields: model.guide["winners"].object.mapValues(\.any)) }
            Section("This Week's Board") { MarketingDetails(fields: model.weekly["weekly"].object.mapValues(\.any)) }
            ForEach(model.catalogue["playbook"].array, id: \.text) { (section: MarketingValue) in
                Section(section.s("title")) {
                    Text(section.s("lead")).foregroundStyle(.secondary)
                    ForEach(section["points"].array, id: \.text) { (point: MarketingValue) in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(point.s("head")).fontWeight(.semibold)
                            Text(point.s("body")).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Read the Account's Winners Again") { macReadWinners() }
                    Divider()
                    Button("Make This Week's Board") { weekly("start") }
                    Button("Continue Designing") { weekly("continue") }
                } label: {
                    Label("Board and Winners", systemImage: "ellipsis.circle")
                }
                .help("Read the account's winners again, or design this week's board")
            }
        }
    }
}
#endif

/// Ads → Plan (src/app/ads/plan/page.tsx): what to run, ad days and rules, competitors. It was Studio's Plan tab; the
/// web moved it to its own page on 2026-10-12 and the app kept opening that page in a web view until 2026-10-17 (owner:
/// "Check for others also and natively port them to ios"). `?s=plays|guide|rivals` picks the section, as on the web;
/// "Make this" opens Design on the play.
struct AdsPlanScreen: View {
    let path: String
    @State private var model = StudioModel()
    @Environment(Session.self) private var session
    var body: some View {
        Group {
            if session.role == "owner" || session.role == "marketing" {
                StudioPlan(model: model)
            } else { AdsOwnersOnly() }
        }
        .modifier(HouseGround()).navigationTitle("Plan").navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load(path: "/ads/studio?v=plan")
            let s = AdsQuery.value("s", in: path) ?? "plays"
            model.part = ["plays", "guide", "rivals"].contains(s) ? s : "plays"
        }
        .navigationDestination(item: $model.route) { PlaceScreen(path: $0.path) }
        .failureAlert($model.error)
        .websiteBusy(model.busy)
    }
}
