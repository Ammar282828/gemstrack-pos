import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// The designer on one board design (board.tsx FrameEditor), made for a finger: the design itself is the canvas
/// (tap any layer to change it, drag it, pull its corner, turn its knob) and every tool sits beside it on an iPad or
/// rises from the bar under it on an iPhone. Words, pictures (the main photo and every inset, from the library, the
/// phone or the AI) and layers are all editable; nothing leaves the phone until Save, which uploads what is new
/// (/api/ads/studio/uploads → "up:<id>") and writes the board once (`put`, by "page"), as the page does.
struct StudioBoardEditor: View {
    let frameID: String
    let board: StudioBoardModel

    /// Everything Save writes, so undo, redo and "unsaved changes" are one comparison.
    struct Design: Equatable {
        var doc = MarketingValue.null
        var fields: [String: String] = [:]
        var template = "headline"
        var label = ""
        /// The main photo: a library id, or "local:<uuid>" for a picture from the phone or the AI not yet uploaded.
        var asset = ""
        var marked = false
    }
    enum Pane: String, CaseIterable, Identifiable {
        case add, edit, words, photo, page
        var id: String { rawValue }
        var title: String { ["add": "Add", "edit": "Edit", "words": "Words", "photo": "Photo", "page": "Page"][rawValue] ?? rawValue }
        var symbol: String { ["add": "plus.circle", "edit": "slider.horizontal.3", "words": "textformat", "photo": "photo", "page": "rectangle.portrait"][rawValue] ?? "circle" }
    }
    /// Where a chosen picture goes: the main photo, one inset (by layer id), or a new inset.
    enum Target: Hashable, Identifiable {
        case main, inset(String), add
        var id: String { switch self { case .main: "main"; case .inset(let l): "inset-" + l; case .add: "add" } }
    }
    struct Candidate: Identifiable {
        let id = UUID()
        let target: Target
        let before: Data?
        let data: Data
        let warning: String?
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var engine = NativeArtwork()
    @State private var design = Design()
    @State private var initial = Design()
    @State private var undo: [Design] = []
    @State private var redo: [Design] = []
    @State private var coalesceKey = ""
    @State private var coalesceAt = Date.distantPast
    @State private var gestureStart: Design?
    /// Every picture this design has held while open, by asset id, so undo and "back to the original" find theirs.
    @State private var pictures: [String: Data] = [:]
    @State private var response = MarketingValue.null
    @State private var selected: String?
    @State private var tab: Pane = .edit
    @State private var panelShown = false
    @State private var ready = false
    @State private var problem: String?
    @State private var busy: String?
    @State private var asking = false
    @State private var picking: Target?
    @State private var deviceTarget: Target?
    @State private var device: PhotosPickerItem?
    @State private var pickerOpen = false
    @State private var logoOpen = false
    /// The framed picture whose photo a drag slides and a pinch zooms inside its frame.
    @State private var cropping: String?
    @State private var advanced = false
    @State private var advancedStart: Design?
    @State private var candidate: Candidate?
    @State private var wordOptions: [[String: String]] = []
    @State private var instruction = ""
    @State private var scene = ""
    /// An inset's picture before it was first replaced, to put back.
    @State private var insetOriginals: [String: MarketingValue] = [:]
    @State private var shareFiles: MarketingFileShare?
    /// Haptics: a layer added, a layer removed, the design saved.
    @State private var addedTick = 0
    @State private var removedTick = 0
    @State private var savedTick = 0
    @FocusState private var typing: Bool

    private var frame: MarketingValue { board.frame(frameID) ?? .null }
    private var regular: Bool { sizeClass == .regular }
    private var dirty: Bool { ready && design != initial }
    private var layers: [MarketingValue] { design.doc["layers"].array }
    private var frameSize: CGSize { CGSize(width: design.doc["frame"].n("w", 1080), height: design.doc["frame"].n("h", 1350)) }
    private var catalogue: MarketingValue { board.catalogue["fonts"] != .null ? board.catalogue : response["catalogue"] }
    private var info: MarketingValue { board.formatInfo(frame.s("format", "portrait")) }
    private var renderKey: String { design.doc.text + MarketingValue(design.fields).text + design.asset + pictures.keys.sorted().joined() }
    /// The engine's photos: the main one as "photo" and every picture held as "lib:<id>", so any can be an inset.
    private var allPhotos: [String: Data] {
        var out: [String: Data] = [:]
        if let p = pictures[design.asset] { out["photo"] = p }
        let used = Set(layers.map { $0.s("photoId") })
        for (key, data) in pictures where key != design.asset || used.contains("lib:" + key) { out["lib:" + key] = data }
        return out
    }
    private var demoNote: String { "The demo saves and uploads nothing, and its AI is off: every tool works on this phone only." }

    var body: some View {
        NavigationStack {
            presenting(main, active: !(panelShown && !regular))
                .navigationTitle(design.label.isEmpty ? "Design" : design.label)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if dirty { asking = true } else { dismiss() } } }
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button { history(true) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }.disabled(undo.isEmpty).keyboardShortcut("z", modifiers: .command)
                        Button { history(false) } label: { Label("Redo", systemImage: "arrow.uturn.forward") }.disabled(redo.isEmpty).keyboardShortcut("z", modifiers: [.command, .shift])
                        Button { shareDesign() } label: { Label("Share", systemImage: "square.and.arrow.up") }.disabled(!ready || NativeArtwork.image(response) == nil)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { Task { await save() } }.disabled(!ready || busy != nil || House.isDemo).keyboardShortcut("s", modifiers: .command)
                    }
                }
                .confirmationDialog("Discard the changes to this design?", isPresented: $asking, titleVisibility: .visible) {
                    Button("Discard changes", role: .destructive) { dismiss() }
                    Button("Keep editing", role: .cancel) {}
                }
                .sheet(isPresented: Binding(get: { panelShown && !regular }, set: { panelShown = $0 })) {
                    NavigationStack {
                        presenting(panel, active: true)
                            .navigationTitle(tab.title).navigationBarTitleDisplayMode(.inline)
                            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { typing = false; panelShown = false } } }
                    }
                    .presentationDetents([.fraction(0.45), .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.45)))
                    .interactiveDismissDisabled(false)
                }
        }
        .presentationSizing(.page)
        .interactiveDismissDisabled(dirty || busy != nil)
        .websiteBusy(busy)
        .task { await load() }
        .task(id: renderKey) { await draw() }
        .sensoryFeedback(.impact(weight: .light), trigger: addedTick)
        .sensoryFeedback(.impact(weight: .medium), trigger: removedTick)
        .sensoryFeedback(.success, trigger: savedTick)
        .onChange(of: device) { _, item in if let item { Task { await take(item) } } }
        .onChange(of: selected) { _, id in
            if id != cropping { cropping = nil }
            if id != nil && (tab == .add || regular) { tab = .edit }
        }
    }

    private var main: some View {
        Group {
            if regular {
                HStack(spacing: 0) {
                    canvasArea
                    Divider()
                    panel.frame(width: 390)
                }
            } else {
                // With the tools up, the design shrinks into the room above them so the chosen layer stays in sight.
                GeometryReader { g in
                    canvasArea.padding(.bottom, panelShown ? g.size.height * 0.46 : 0)
                }
                .safeAreaInset(edge: .bottom) { if !panelShown { phoneBar } }
            }
        }
        .background(Theme.ground)
    }

    // MARK: The canvas

    private var canvasArea: some View {
        VStack(spacing: 8) {
            if House.isDemo { Label(demoNote, systemImage: "info.circle").font(.footnote).foregroundStyle(.secondary).padding(.horizontal) }
            if let problem { Label(problem, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange).padding(.horizontal) }
            if ready {
                StudioBoardCanvas(image: NativeArtwork.image(response), boxes: response["boxes"].array, layers: layers, frameSize: frameSize, selected: $selected,
                                  changed: { design.doc["layers"] = .array($0) },
                                  ended: endGesture,
                                  began: { gestureStart = design },
                                  openText: { _ in show(.edit); typing = true },
                                  cropping: cropping,
                                  naturalSize: { l in source(.inset(l.s("id"))).flatMap { ArtworkPixels.size($0) } })
                    .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                    .padding(regular ? 28 : 14)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if problem == nil {
                SkeletonLoading("Opening the design").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Spacer()
            }
        }
        .background { shortcuts }
    }

    /// Keys for an iPad keyboard: duplicate, delete, a step up or down the stack.
    private var shortcuts: some View {
        Group {
            Button("Duplicate") { if let s = selected { duplicate(s) } }.keyboardShortcut("d", modifiers: .command)
            Button("Remove") { if let s = selected { remove(s) } }.keyboardShortcut(.delete, modifiers: .command)
            Button("Bring forward") { if let s = selected { step(s, 1) } }.keyboardShortcut("]", modifiers: .command)
            Button("Send backward") { if let s = selected { step(s, -1) } }.keyboardShortcut("[", modifiers: .command)
        }
        .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true).disabled(selected == nil)
    }

    private var phoneBar: some View {
        VStack(spacing: 8) {
            if let id = selected, layer(id) != nil {
                GlassEffectContainer {
                    HStack(spacing: 4) {
                        quick("Edit", "slider.horizontal.3") { show(.edit) }
                        quick("Forward", "square.2.layers.3d.top.filled") { step(id, 1) }
                        quick("Back", "square.2.layers.3d.bottom.filled") { step(id, -1) }
                        quick("Copy", "plus.square.on.square") { duplicate(id) }
                        quick(layer(id)?["locked"].bool == true ? "Unlock" : "Lock", layer(id)?["locked"].bool == true ? "lock.fill" : "lock.open") { updateLayer(id) { $0["locked"] = .bool(!$0["locked"].bool) } }
                        quick("Remove", "trash") { remove(id) }
                    }
                    .padding(6).glassEffect(.regular, in: .capsule)
                }
            }
            GlassEffectContainer {
                HStack(spacing: 0) {
                    ForEach(Pane.allCases) { p in
                        Button { show(p) } label: {
                            VStack(spacing: 3) {
                                // Add is the one obvious way to put something new on the design.
                                if p == .add { Image(systemName: "plus").font(.body.weight(.bold)).foregroundStyle(Theme.onAccent).frame(width: 30, height: 30).background(Theme.accent, in: Circle()) }
                                else { Image(systemName: p.symbol).font(.body.weight(.medium)).frame(height: 30) }
                                Text(p.title).font(.caption2)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(panelShown && tab == p ? Theme.accent : .primary)
                        .accessibilityAddTraits(panelShown && tab == p ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 6).glassEffect(.regular, in: .capsule)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 6)
        .disabled(!ready)
    }

    private func quick(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 44, height: 36) }
            .buttonStyle(.plain).accessibilityLabel(title)
    }

    private func show(_ p: Pane) { tab = p; if !regular { panelShown = true } }

    // MARK: The panel

    private var panel: some View {
        VStack(spacing: 0) {
            Picker("Tools", selection: $tab) { ForEach(Pane.allCases) { Text($0.title).tag($0) } }
                .pickerStyle(.segmented).padding(.horizontal).padding(.vertical, 10)
            Form {
                switch tab {
                case .add: addPane
                case .edit: editPane
                case .words: wordsPane
                case .photo: photoPane
                case .page: pagePane
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .modifier(HouseGround())
            .disabled(!ready)
        }
    }

    /// Sheets the panel's tools open, attached where they can show (the panel when it is itself a sheet).
    private func presenting<V: View>(_ content: V, active: Bool) -> some View {
        content
            .sheet(item: Binding(get: { active ? picking : nil }, set: { picking = $0 })) { target in
                StudioBoardPhotoPicker(board: board, title: target == .main ? "Replace the photo" : target == .add ? "Add a picture" : "Replace the picture", choosesShape: false) { item, _ in
                    picking = nil
                    Task { await useLibrary(item, target) }
                }
            }
            .photosPicker(isPresented: Binding(get: { active && pickerOpen }, set: { pickerOpen = $0 }), selection: $device, matching: .images)
            .fileImporter(isPresented: Binding(get: { active && logoOpen }, set: { logoOpen = $0 }), allowedContentTypes: [.svg, .png]) { takeLogo($0) }
            .sheet(isPresented: Binding(get: { active && advanced }, set: { advanced = $0 }), onDismiss: advancedClosed) {
                ArtworkEditor(doc: $design.doc, photos: allPhotos, fields: design.fields, ad: true)
            }
            .sheet(item: Binding(get: { active ? candidate : nil }, set: { candidate = $0 })) { c in candidateSheet(c) }
            .sheet(item: Binding(get: { active ? shareFiles : nil }, set: { shareFiles = $0 })) { files in MarketingShareSheet(items: files.items) }
    }

    // MARK: Add

    @ViewBuilder private var addPane: some View {
        Section {
            Button("Heading", systemImage: "textformat.size.larger") { act("text", "heading") }
            Button("Subheading", systemImage: "textformat.size") { act("text", "subheading") }
            Button("Body text", systemImage: "textformat.size.smaller") { act("text", "body") }
            if !catalogue["textStyles"].array.isEmpty {
                // The house's ready-made lines sit one tap further in, so Add stays short.
                Menu { ForEach(catalogue["textStyles"].array, id: \.text) { i in Button(i.s("label")) { act("textStyle", i.s("id")) } } } label: { Label("Styled lines", systemImage: "character.textbox") }
            }
        } header: { LedgerHeading(title: "Text") }.houseRows()
        Section {
            Button("A picture from the library", systemImage: "photo.on.rectangle") { picking = .add }
            Button("A picture from this phone", systemImage: "iphone") { deviceTarget = .add; pickerOpen = true }
            if !design.asset.isEmpty {
                Menu {
                    Button("Rectangle") { act("image", "rounded", ["photoId": "photo"]) }
                    ForEach(catalogue["masks"].array, id: \.text) { m in Button(ArtworkProperties.label(m.string)) { act("image", m.string, ["photoId": "photo"]) } }
                } label: { Label("The design’s photo, framed", systemImage: "square.on.circle") }
            }
        } header: { LedgerHeading(title: "Pictures") } footer: { Text("Pictures from this phone are uploaded when you save.") }.houseRows()
        Section {
            ForEach(["rect", "circle", "line", "arrow"], id: \.self) { key in Button(ArtworkProperties.label(key), systemImage: ["rect": "rectangle", "circle": "circle", "line": "line.diagonal", "arrow": "arrow.up.right"][key] ?? "square") { act("shape", key) } }
            Menu { ForEach(catalogue["shapes"].array, id: \.text) { i in Button(i.s("label")) { act("shape", i.s("id")) } } } label: { Label("More shapes", systemImage: "star") }
            Button("Dashed line", systemImage: "line.3.horizontal") { act("line", "dash") }
            Button("Dotted line", systemImage: "ellipsis") { act("line", "dot") }
        } header: { LedgerHeading(title: "Shapes and lines") }.houseRows()
        Section {
            Menu { ForEach(catalogue["badges"].array, id: \.text) { i in Button(i.s("label")) { act("badge", i.s("id")) } } } label: { Label("Badges", systemImage: "seal") }
            Button("Full logo, top right", systemImage: "signature") { act("mark", "top") }
            Button("Full logo, bottom right", systemImage: "signature") { act("mark", "bottom") }
            Button("Monogram", systemImage: "t.square") { addLayer(ArtworkLogo.monogram(ink: ArtworkLogo.ink(for: design.doc))) }
            Button("Logo file (SVG or PNG)", systemImage: "square.and.arrow.down") { logoOpen = true }
            Button("Link pill", systemImage: "link") { act("link", "Ask us on WhatsApp") }
        } header: { LedgerHeading(title: "Elements") }.houseRows()
        Section {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 8)], spacing: 8) {
                ForEach(Self.stickers, id: \.self) { glyph in
                    Button { sticker(glyph) } label: {
                        Text(glyph).font(.title2).frame(maxWidth: .infinity, minHeight: 48)
                            .background(Theme.card, in: .rect(cornerRadius: 10))
                    }
                    .buttonStyle(.plain).accessibilityLabel("Sticker " + glyph)
                }
            }
            .padding(.vertical, 4)
        } header: { LedgerHeading(title: "Stickers") } footer: { Text("Each is a text layer: size, colour and turn it like any words.") }.houseRows()
    }

    // MARK: Edit (the chosen layer, or the list of layers)

    @ViewBuilder private var editPane: some View {
        if let id = selected, let l = layer(id) {
            layerPane(id, l)
        } else {
            Section {
                Text("Tap anything on the design to change it, or choose it here. Drag to move, pull the corner to resize, turn with the knob above.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.houseRows()
            layersList
        }
    }

    private var layersList: some View {
        Section {
            ForEach(layers.reversed().map { $0.s("id") }, id: \.self) { id in
                let l = layer(id) ?? .null
                HStack {
                    Button { selected = id } label: {
                        Label(StudioBoardCanvas.name(l), systemImage: Self.symbol(l)).foregroundStyle(l["hidden"].bool ? .secondary : .primary)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Button { updateLayer(id) { $0["hidden"] = .bool(!l["hidden"].bool) } } label: { Image(systemName: l["hidden"].bool ? "eye.slash" : "eye") }
                        .buttonStyle(.borderless).accessibilityLabel(l["hidden"].bool ? "Show" : "Hide")
                    Button { updateLayer(id) { $0["locked"] = .bool(!l["locked"].bool) } } label: { Image(systemName: l["locked"].bool ? "lock" : "lock.open") }
                        .buttonStyle(.borderless).accessibilityLabel(l["locked"].bool ? "Unlock" : "Lock")
                }
            }
        } header: { LedgerHeading(title: "Layers · \(layers.count)") }.houseRows()
    }

    @ViewBuilder private func layerPane(_ id: String, _ l: MarketingValue) -> some View {
        let kind = l.s("kind")
        Section {
            HStack {
                Label(StudioBoardCanvas.name(l), systemImage: Self.symbol(l)).font(.headline)
                Spacer()
                Button { selected = nil } label: { Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.secondary) }
                    .buttonStyle(.borderless).accessibilityLabel("Choose nothing")
            }
            if l["locked"].bool {
                Text("Locked: unlock it to change it.").font(.footnote).foregroundStyle(.secondary)
                Button("Unlock", systemImage: "lock.open") { updateLayer(id) { $0["locked"] = .bool(false) } }
            }
        }.houseRows()
        if !l["locked"].bool {
            switch kind {
            case "text": textSections(id, l)
            case "image": imageSections(id, l)
            case "wordmark":
                Section {
                    Toggle("Ink from the photo", isOn: flag(id, "autoColor"))
                    if !l["autoColor"].bool { ColorPicker("Colour", selection: color(id, "color"), supportsOpacity: false) }
                    slider("Width", num(id, "width", 300), 60...1080)
                } header: { LedgerHeading(title: "Logo") }.houseRows()
            default: shapeSections(id, l)
            }
            Section {
                slider("Opacity", num(id, "opacity", 1), 0...1, step: 0.05, format: "%.2f")
                slider("Rotation", num(id, "rotate", 0), -180...180, format: "%.0f°")
                Toggle("Hidden", isOn: flag(id, "hidden"))
                Toggle("Locked", isOn: flag(id, "locked"))
            } header: { LedgerHeading(title: "Look") }.houseRows()
            arrangeSection(id)
        }
        Section {
            Button("All settings for this layer…", systemImage: "slider.horizontal.below.square.and.square.filled") { openAdvanced() }
        } footer: { Text("Effects, photo filters, grouping, choosing several layers and every number are there.") }.houseRows()
    }

    @ViewBuilder private func textSections(_ id: String, _ l: MarketingValue) -> some View {
        let bind = l.s("bind")
        Section {
            if !bind.isEmpty {
                TextField(Self.fieldName(bind), text: field(bind), axis: .vertical).lineLimit(1...6).focused($typing)
                Text("The design’s \(Self.fieldName(bind).lowercased()): the Words panel and the layouts use it too.").font(.footnote).foregroundStyle(.secondary)
                Button("AI words for this design", systemImage: "sparkles") { show(.words) }
                Button("Make it its own text", systemImage: "link.badge.plus") {
                    let words = design.fields[bind] ?? ""
                    updateLayer(id) { $0["text"] = .string(words); $0["bind"] = .null; $0["flow"] = .null }
                }
            } else {
                TextField("Words", text: str(id, "text"), axis: .vertical).lineLimit(1...8).focused($typing)
            }
        } header: { LedgerHeading(title: "Words") }.houseRows()
        Section {
            Picker("Font", selection: str(id, "font", "regular")) {
                ForEach(fonts, id: \.0) { Text($0.1).tag($0.0) }
            }
            slider("Size", num(id, "size", 80), 12...600)
            ColorPicker("Colour", selection: color(id, "color"), supportsOpacity: false)
            Picker("Alignment", selection: str(id, "align", "left")) {
                Image(systemName: "text.alignleft").tag("left").accessibilityLabel("Left")
                Image(systemName: "text.aligncenter").tag("center").accessibilityLabel("Centre")
                Image(systemName: "text.alignright").tag("right").accessibilityLabel("Right")
            }.pickerStyle(.segmented)
            slider("Letter spacing", num(id, "spacing", 0), -0.1...0.6, step: 0.01, format: "%.2f")
            slider("Line spacing", num(id, "lineHeight", 1.15), 0.7...2.2, step: 0.05, format: "%.2f")
            slider("Line width", num(id, "width", 888), 80...max(240, frameSize.width * 1.5))
            Toggle("Capitals", isOn: flag(id, "upper"))
            Toggle("Underline", isOn: flag(id, "underline"))
            Toggle("Shrink to fit the width", isOn: flag(id, "fit"))
            Toggle("Ink from the photo", isOn: flag(id, "autoColor"))
        } header: { LedgerHeading(title: "Type") }.houseRows()
        Section {
            Picker("Effect", selection: Binding(get: { l["effect"].s("kind", l["shadow"].bool ? "shadow" : "none") }, set: { kind in
                updateLayer(id) { $0["effect"] = kind == "none" ? .null : MarketingValue(["kind": kind, "color": "#000000", "offset": 30, "angle": 45, "blur": 20, "thickness": 40, "transparency": 50]); if kind == "none" { $0["shadow"] = .bool(false) } }
            })) {
                Text("None").tag("none")
                ForEach(catalogue["effects"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) }
            }
            if l["effect"] != .null { ColorPicker("Effect colour", selection: Binding(get: { Color(hex: l["effect"].s("color")) ?? .black }, set: { c in updateLayer(id) { $0["effect"]["color"] = .string(ArtworkProperties.hex(c)) } }), supportsOpacity: false) }
            Toggle("Box behind the words", isOn: Binding(get: { l["box"] != .null }, set: { on in updateLayer(id) { $0["box"] = on ? MarketingValue(["color": "#FFFFFF", "radius": 24, "pad": 20]) : .null } }))
            if l["box"] != .null { ColorPicker("Box colour", selection: Binding(get: { Color(hex: l["box"].s("color")) ?? .white }, set: { c in updateLayer(id) { $0["box"]["color"] = .string(ArtworkProperties.hex(c)) } }), supportsOpacity: false) }
            slider("Bend", num(id, "curve", 0), -100...100)
        } header: { LedgerHeading(title: "Effects") }.houseRows()
    }

    @ViewBuilder private func imageSections(_ id: String, _ l: MarketingValue) -> some View {
        Section {
            if let data = source(.inset(id)) {
                if let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 140).clipShape(.rect(cornerRadius: 8)).frame(maxWidth: .infinity)
                } else {
                    // An SVG logo has no bitmap to show; the design itself draws it.
                    Label("A vector logo: no preview here, the design shows it.", systemImage: "doc.richtext").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Button("Replace from the library", systemImage: "photo.on.rectangle") { picking = .inset(id) }
            Button("Replace from this phone", systemImage: "iphone") { deviceTarget = .inset(id); pickerOpen = true }
            if let was = insetOriginals[id], was.s("photoId") != l.s("photoId") || was.s("src") != l.s("src") {
                Button("Back to the original picture", systemImage: "arrow.uturn.backward") { restoreInset(id) }
            }
        } header: { LedgerHeading(title: "Picture") }.houseRows()
        Section {
            Picker("Frame", selection: Binding(get: { l.s("mask") }, set: { v in updateLayer(id) { $0["mask"] = v.isEmpty ? .null : .string(v) } })) {
                Text("Rectangle").tag("")
                ForEach(catalogue["masks"].array, id: \.text) { Text(ArtworkProperties.label($0.string)).tag($0.string) }
            }
            slider("Width", num(id, "w", 380), 40...max(400, frameSize.width * 1.5))
            if l["h"] != .null {
                slider("Height", num(id, "h", 380), 40...max(400, frameSize.height * 1.5))
                slider("Crop across", num(id, "fx", 0.5), 0...1, step: 0.01, format: "%.2f")
                slider("Crop down", num(id, "fy", 0.5), 0...1, step: 0.01, format: "%.2f")
                // iz: drawn as the cover scale times this (src/lib/social: ImageLayer.iz).
                slider("Zoom in frame", num(id, "iz", 1), 1...4, step: 0.05, format: "%.2f×")
                Button(cropping == id ? "Done moving the photo" : "Move photo in frame", systemImage: "arrow.up.and.down.and.arrow.left.and.right") { cropping = cropping == id ? nil : id }
                if cropping == id { Text("Drag the design to slide the photo inside its frame; pinch to zoom it.").font(.footnote).foregroundStyle(.secondary) }
            }
            slider("Corners", num(id, "radius", 0), 0...300)
            Toggle("Border", isOn: Binding(get: { l["border"] != .null }, set: { on in updateLayer(id) { $0["border"] = on ? .string("#FFFFFF") : .null } }))
            if l["border"] != .null { ColorPicker("Border colour", selection: color(id, "border"), supportsOpacity: false) }
            Toggle("Shadow", isOn: flag(id, "shadow"))
        } header: { LedgerHeading(title: "Frame and crop") }.houseRows()
        Section {
            ArtworkShadeControls(shade: l["shade"]) { v, key in updateLayer(id, key.map { "shade-" + $0 }) { $0["shade"] = v } }
        } header: { LedgerHeading(title: "Gradient") }.houseRows()
        aiPhotoSection(.inset(id))
    }

    @ViewBuilder private func shapeSections(_ id: String, _ l: MarketingValue) -> some View {
        Section {
            ColorPicker("Line colour", selection: color(id, "color"), supportsOpacity: false)
            slider("Line width", num(id, "stroke", 4), 0...60)
            if ["rect", "circle", "shape"].contains(l.s("kind")) {
                Toggle("Filled", isOn: Binding(get: { l["fill"] != .null }, set: { on in updateLayer(id) { $0["fill"] = on ? .string("#FFFFFF") : .null } }))
                if l["fill"] != .null {
                    ColorPicker("Fill", selection: color(id, "fill"), supportsOpacity: false)
                    Toggle("Gradient fill", isOn: Binding(get: { l["fill2"] != .null }, set: { on in updateLayer(id) { $0["fill2"] = on ? .string("#111111") : .null } }))
                    if l["fill2"] != .null { ColorPicker("Gradient end", selection: color(id, "fill2"), supportsOpacity: false) }
                }
                slider("Corners", num(id, "radius", 0), 0...300)
            } else {
                slider("Bow", num(id, "curve", 0), -300...300)
            }
            Picker("Stroke", selection: str(id, "dash", "solid")) { ForEach(["solid", "dash", "dot"], id: \.self) { Text(ArtworkProperties.label($0)).tag($0) } }.pickerStyle(.segmented)
        } header: { LedgerHeading(title: "Shape") }.houseRows()
    }

    private func arrangeSection(_ id: String) -> some View {
        Section {
            HStack {
                Button { step(id, 1) } label: { Label("Forward", systemImage: "square.2.layers.3d.top.filled") }
                Spacer()
                Button { step(id, -1) } label: { Label("Backward", systemImage: "square.2.layers.3d.bottom.filled") }
            }.buttonStyle(.borderless)
            HStack {
                Button { toEnd(id, front: true) } label: { Label("To front", systemImage: "square.3.layers.3d.top.filled") }
                Spacer()
                Button { toEnd(id, front: false) } label: { Label("To back", systemImage: "square.3.layers.3d.bottom.filled") }
            }.buttonStyle(.borderless)
            Menu {
                ForEach(["left", "center", "right", "top", "middle", "bottom"], id: \.self) { key in Button(ArtworkProperties.label(key)) { act("align", key, ["toPage": true]) } }
            } label: { Label("Align to the page", systemImage: "align.horizontal.center") }
            Button("Duplicate", systemImage: "plus.square.on.square") { duplicate(id) }
            Button("Remove", systemImage: "trash", role: .destructive) { remove(id) }
        } header: { LedgerHeading(title: "Arrange") }.houseRows()
    }

    // MARK: Words

    @ViewBuilder private var wordsPane: some View {
        Section {
            TextField("Small line", text: field("kicker"))
            TextField("Headline on the picture", text: field("headline"), axis: .vertical)
            TextField("Specs", text: field("weight"), axis: .vertical)
            TextField("Call to action", text: field("details"), axis: .vertical)
        } header: { LedgerHeading(title: "Words on the design") }.houseRows()
        Section {
            Button("Write three options", systemImage: "sparkles") { Task { await writeWords() } }.disabled(House.isDemo || busy != nil)
            if House.isDemo { Text("The demo’s AI is off.").font(.footnote).foregroundStyle(.secondary) }
            ForEach(Array(wordOptions.enumerated()), id: \.offset) { _, option in
                VStack(alignment: .leading, spacing: 4) {
                    if !(option["kicker"] ?? "").isEmpty { Text(option["kicker"] ?? "").font(.caption).foregroundStyle(.secondary) }
                    Text(option["headline"] ?? "").font(.headline)
                    if !(option["details"] ?? "").isEmpty { Text(option["details"] ?? "").font(.subheadline) }
                    Button("Use these words") { edit { d in for (k, v) in option where !v.isEmpty { d.fields[k] = v } } }
                        .buttonStyle(.borderless).padding(.top, 2)
                }
                .padding(.vertical, 4)
            }
        } header: { LedgerHeading(title: "AI words") } footer: { Text("Each option is written from a different angle for this design’s shape. Nothing changes until you use one.") }.houseRows()
    }

    // MARK: Photo

    @ViewBuilder private var photoPane: some View {
        Section {
            if let data = pictures[design.asset], let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).clipShape(.rect(cornerRadius: 10)).frame(maxWidth: .infinity)
                Text(Self.origin(design.asset)).font(.footnote).foregroundStyle(.secondary)
            } else {
                Text(design.asset.isEmpty ? "This design has no photo." : "The photo couldn’t be fetched.").foregroundStyle(.secondary)
            }
            Button("Replace from the library", systemImage: "photo.on.rectangle") { picking = .main }
            Button("Replace from this phone", systemImage: "iphone") { deviceTarget = .main; pickerOpen = true }
            if design.asset != initial.asset && !initial.asset.isEmpty {
                Button("Back to the original photo", systemImage: "arrow.uturn.backward") { edit { $0.asset = initial.asset; $0.marked = initial.marked } }
            }
        } header: { LedgerHeading(title: "Main photo") }.houseRows()
        if !design.asset.isEmpty {
            Section {
                Picker("Placement", selection: placementString("mode", "fill")) { Text("Fill").tag("fill"); Text("Fit").tag("fit") }.pickerStyle(.segmented)
                slider("Zoom", placementNumber("zoom", 1), 1...4, step: 0.05, format: "%.2f×")
                slider("Focus across", placementNumber("focusX", 0.5), 0...1, step: 0.01, format: "%.2f")
                slider("Focus down", placementNumber("focusY", 0.5), 0...1, step: 0.01, format: "%.2f")
            } header: { LedgerHeading(title: "Crop and placement") }.houseRows()
            Section {
                ArtworkShadeControls(shade: design.doc["bg"]["shade"]) { v, key in edit(key.map { "bg-shade-" + $0 }) { $0.doc["bg"]["shade"] = v } }
            } header: { LedgerHeading(title: "Gradient") }.houseRows()
            aiPhotoSection(.main)
        }
    }

    @ViewBuilder private func aiPhotoSection(_ target: Target) -> some View {
        let off = House.isDemo || busy != nil || source(target).map({ WebsitePhoto.kind(of: $0) == nil }) ?? true
        let aspect = target == .main ? info.s("ai", "4:5") : "1:1"
        Section {
            Button("Remove logo and labels", systemImage: "eraser") { ai("enhance", ["tidy": true], target) }.disabled(off)
            Button("Enhance", systemImage: "wand.and.stars") { ai("enhance", ["tidy": false], target) }.disabled(off)
            Button("Retouch", systemImage: "sparkles") { ai("retouch", [:], target) }.disabled(off)
            if target == .main { Button("Extend to this shape", systemImage: "arrow.up.left.and.arrow.down.right") { ai("reframe", ["aspect": aspect, "tidy": design.marked], target) }.disabled(off) }
            Picker("Scene", selection: $scene) {
                Text("Choose a scene").tag("")
                ForEach(catalogue["scenes"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) }
            }
            Button("Restage in this scene", systemImage: "photo.artframe") { ai("restage", ["sceneId": scene, "scene": instruction, "aspect": aspect], target) }.disabled(off || (scene.isEmpty && instruction.isEmpty))
            TextField("Or ask: “a softer, warmer light”", text: $instruction, axis: .vertical)
            Button("Ask AI", systemImage: "text.bubble") { ai("custom", ["instruction": instruction, "aspect": aspect], target) }.disabled(off || instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if House.isDemo { Text("The demo’s AI is off.").font(.footnote).foregroundStyle(.secondary) }
        } header: { LedgerHeading(title: "AI photo tools") } footer: { Text("You see the new version beside the old before choosing it; the original stays until you save.") }.houseRows()
    }

    // MARK: Page

    @ViewBuilder private var pagePane: some View {
        Section {
            TextField("Design name", text: Binding(get: { design.label }, set: { v in edit("label") { $0.label = v } }))
            Text(info.s("label")).font(.footnote).foregroundStyle(.secondary)
        } header: { LedgerHeading(title: "Design") }.houseRows()
        Section {
            Menu {
                ForEach(catalogue["templates"].array, id: \.text) { t in Button(t.s("label")) { apply(t.s("id")) } }
            } label: { LabeledContent("Layout", value: board.templateLabel(design.template)) }
            Menu {
                ForEach(catalogue["palettes"].array, id: \.text) { p in Button(p.s("label")) { act("palette", "", ["palette": p.s("id")]) } }
            } label: { Label("Colours", systemImage: "paintpalette") }
        } header: { LedgerHeading(title: "Layout") } footer: { Text("A new layout lays the words and photo out again; undo brings this one back.") }.houseRows()
        Section {
            ColorPicker("Background", selection: Binding(get: { Color(hex: design.doc["bg"].s("color")) ?? .white }, set: { c in edit("bg-color") { $0.doc["bg"]["color"] = .string(ArtworkProperties.hex(c)) } }), supportsOpacity: false)
            Toggle("Gradient", isOn: Binding(get: { design.doc["bg"]["color2"] != .null }, set: { on in edit { $0.doc["bg"]["color2"] = on ? .string("#111111") : .null } }))
            if design.doc["bg"]["color2"] != .null {
                ColorPicker("Gradient end", selection: Binding(get: { Color(hex: design.doc["bg"].s("color2")) ?? .black }, set: { c in edit("bg-color2") { $0.doc["bg"]["color2"] = .string(ArtworkProperties.hex(c)) } }), supportsOpacity: false)
            }
            Picker("Shade for the words", selection: Binding(get: { design.doc["bg"].s("gradient", "none") }, set: { v in edit { $0.doc["bg"]["gradient"] = .string(v) } })) {
                ForEach(["none", "top", "bottom", "both"], id: \.self) { Text(ArtworkProperties.label($0)).tag($0) }
            }
            slider("Darken the photo", Binding(get: { design.doc["bg"].n("dim") }, set: { v in edit("bg-dim") { $0.doc["bg"]["dim"] = .number(v) } }), 0...0.8, step: 0.05, format: "%.2f")
        } header: { LedgerHeading(title: "Background") }.houseRows()
        Section {
            Button("All settings…", systemImage: "slider.horizontal.below.square.and.square.filled") { openAdvanced() }
        } footer: { Text("The full designer: photo filters, effects, grouping and several layers at once.") }.houseRows()
    }

    private func candidateSheet(_ c: Candidate) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let warning = c.warning { Label(warning, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.subheadline) }
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 12) { versions(c) }
                        VStack(spacing: 12) { versions(c) }
                    }
                }
                .padding(20)
            }
            .background(Theme.ground)
            .navigationTitle("The AI’s version").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Keep the original") { candidate = nil } }
                ToolbarItem(placement: .confirmationAction) { Button("Use this version") { accept(c) } }
            }
        }
        .presentationSizing(.page)
    }

    @ViewBuilder private func versions(_ c: Candidate) -> some View {
        ForEach([("Before", c.before), ("After", Optional(c.data))], id: \.0) { title, data in
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if let data, let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFit().clipShape(.rect(cornerRadius: 10)) }
            }
            .frame(maxWidth: 520)
        }
    }

    // MARK: Bindings

    private var fonts: [(String, String)] {
        let list = catalogue["fonts"].array.map { ($0.s("id"), $0.s("label")) }
        return list.isEmpty ? (ArtworkProperties.choices["font"] ?? []).map { ($0, ArtworkProperties.label($0)) } : list
    }
    private func layer(_ id: String) -> MarketingValue? { layers.first { $0.s("id") == id } }
    private func field(_ key: String) -> Binding<String> {
        Binding(get: { design.fields[key] ?? "" }, set: { v in edit("field-" + key) { $0.fields[key] = v } })
    }
    private func num(_ id: String, _ key: String, _ fallback: Double) -> Binding<Double> {
        Binding(get: { layer(id)?.n(key, fallback) ?? fallback }, set: { v in updateLayer(id, key) { $0[key] = .number(v) } })
    }
    private func str(_ id: String, _ key: String, _ fallback: String = "") -> Binding<String> {
        Binding(get: { layer(id)?.s(key, fallback) ?? fallback }, set: { v in updateLayer(id, key) { $0[key] = .string(v) } })
    }
    private func flag(_ id: String, _ key: String) -> Binding<Bool> {
        Binding(get: { layer(id)?[key].bool ?? false }, set: { v in updateLayer(id) { $0[key] = .bool(v) } })
    }
    private func color(_ id: String, _ key: String) -> Binding<Color> {
        Binding(get: { Color(hex: layer(id)?.s(key)) ?? .white }, set: { c in updateLayer(id, key) { $0[key] = .string(ArtworkProperties.hex(c)) } })
    }
    /// The main photo's crop: a square design keeps one per photo (`placements`), the rest one on the background.
    private var placement: MarketingValue {
        let d = design.doc, pid = d["bg"].s("photoId")
        if d["placements"] != .null { return d["placements"][pid] == .null ? MarketingValue(["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5]) : d["placements"][pid] }
        return d["bg"]["placement"] == .null ? MarketingValue(["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5]) : d["bg"]["placement"]
    }
    private func setPlacement(_ key: String, _ value: MarketingValue) {
        edit("placement-" + key) { d in
            var p = placement; p[key] = value
            let pid = d.doc["bg"].s("photoId")
            if d.doc["placements"] != .null && !pid.isEmpty { d.doc["placements"][pid] = p } else { d.doc["bg"]["placement"] = p }
        }
    }
    private func placementNumber(_ key: String, _ fallback: Double) -> Binding<Double> {
        Binding(get: { placement.n(key, fallback) }, set: { setPlacement(key, .number($0)) })
    }
    private func placementString(_ key: String, _ fallback: String) -> Binding<String> {
        Binding(get: { placement.s(key, fallback) }, set: { setPlacement(key, .string($0)) })
    }

    private func slider(_ title: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, step: Double = 1, format: String = "%.0f") -> some View {
        let clamped = Binding(get: { min(range.upperBound, max(range.lowerBound, value.wrappedValue)) }, set: { value.wrappedValue = $0 })
        return VStack(alignment: .leading, spacing: 2) {
            HStack { Text(title); Spacer(); Text(String(format: format, value.wrappedValue)).monospacedDigit().foregroundStyle(.secondary) }
            Slider(value: clamped, in: range, step: step) { Text(title) }
        }
    }

    // MARK: Changing, with undo

    /// One change of the design. Changes with the same key close together (typing, a slider) are one undo step.
    private func edit(_ key: String? = nil, _ body: (inout Design) -> Void) {
        var next = design
        body(&next)
        guard next != design else { return }
        let now = Date()
        if !(key != nil && key == coalesceKey && now.timeIntervalSince(coalesceAt) < 1.2) {
            undo.append(design)
            if undo.count > 100 { undo.removeFirst() }
        }
        coalesceKey = key ?? ""; coalesceAt = now
        redo = []
        design = next
    }
    private func updateLayer(_ id: String, _ key: String? = nil, _ body: @escaping (inout MarketingValue) -> Void) {
        edit(key.map { "layer-\(id)-\($0)" }) { d in
            d.doc["layers"] = .array(d.doc["layers"].array.map { l in var n = l; if l.s("id") == id { body(&n) }; return n })
        }
    }
    private func history(_ back: Bool) {
        coalesceKey = ""
        if back, let d = undo.popLast() { redo.append(design); design = d }
        if !back, let d = redo.popLast() { undo.append(design); design = d }
        if let s = selected, layer(s) == nil { selected = nil }
    }
    private func endGesture() {
        if let s = gestureStart, s != design { undo.append(s); redo = []; coalesceKey = "" }
        gestureStart = nil
    }
    private func openAdvanced() { advancedStart = design; advanced = true }
    private func advancedClosed() {
        if let s = advancedStart, s.doc != design.doc { undo.append(s); redo = [] }
        advancedStart = nil
        if let s = selected, layer(s) == nil { selected = nil }
    }

    private func step(_ id: String, _ by: Int) {
        edit { d in
            var a = d.doc["layers"].array
            guard let i = a.firstIndex(where: { $0.s("id") == id }), a.indices.contains(i + by) else { return }
            a.swapAt(i, i + by); d.doc["layers"] = .array(a)
        }
    }
    private func toEnd(_ id: String, front: Bool) {
        edit { d in
            let a = d.doc["layers"].array, own = a.filter { $0.s("id") == id }, rest = a.filter { $0.s("id") != id }
            d.doc["layers"] = .array(front ? rest + own : own + rest)
        }
    }
    private func duplicate(_ id: String) {
        guard let l = layer(id) else { return }
        var n = l
        n["id"] = .string(l.s("kind") + "-" + StudioBoardModel.shortID())
        n["x"] = .number(l.n("x") + 24); n["y"] = .number(l.n("y") + 24)
        n["locked"] = .bool(false); n["group"] = .null; n["flow"] = .null
        edit { d in
            var a = d.doc["layers"].array
            let i = a.firstIndex { $0.s("id") == id } ?? a.count - 1
            a.insert(n, at: min(a.count, i + 1)); d.doc["layers"] = .array(a)
        }
        selected = n.s("id")
        addedTick += 1
    }
    private func remove(_ id: String) {
        edit { d in d.doc["layers"] = .array(d.doc["layers"].array.filter { $0.s("id") != id }) }
        selected = nil
        removedTick += 1
    }

    /// An engine action (a new layer, a palette, an alignment), applied as one step.
    private func act(_ action: String, _ value: String, _ extra: [String: Any] = [:]) {
        Task {
            do {
                var o = extra
                o["action"] = action; o["value"] = value; o["selected"] = selected.map { [$0] } ?? []
                let r = try await engine.run(doc: design.doc, photos: allPhotos, fields: design.fields, options: o)
                edit { $0.doc = r["doc"] }
                response = r
                if let added = r["added"].array.first?.string { selected = added; tab = .edit; addedTick += 1 }
                problem = nil
            } catch { problem = error.localizedDescription }
        }
    }
    /// Another layout over the same document (the page's onPreset): the shape stays, the words and photo carry over.
    private func apply(_ template: String) {
        Task {
            do {
                let r = try await engine.run(doc: design.doc, photos: allPhotos, fields: design.fields, options: ["action": "ad", "value": template, "photoMarked": design.marked])
                edit { $0.doc = r["doc"]; $0.template = template }
                selected = nil
                response = r
            } catch { problem = error.localizedDescription }
        }
    }

    static let stickers = ["✦", "★", "♥", "✓", "◆", "✿", "❝", "→", "💍", "💎", "✨", "🎁", "🌙", "🌸", "🔥", "⭐️"]

    /// A sticker: a new text layer holding one glyph, put in the middle of the page.
    private func sticker(_ glyph: String) {
        Task {
            do {
                let r = try await engine.run(doc: design.doc, photos: allPhotos, fields: design.fields, options: ["action": "text", "value": "heading", "selected": [String]()])
                guard let added = r["added"].array.first?.string else { return }
                var doc = r["doc"]
                doc["layers"] = .array(doc["layers"].array.map { l in
                    guard l.s("id") == added else { return l }
                    var n = l
                    n["text"] = .string(glyph); n["name"] = .string("Sticker"); n["size"] = .number(220); n["width"] = .number(320)
                    n["align"] = .string("center"); n["bind"] = .null; n["flow"] = .null; n["fit"] = .bool(false)
                    n["x"] = .number(frameSize.width / 2 - 160); n["y"] = .number(frameSize.height / 2 - 120)
                    return n
                })
                edit { $0.doc = doc }
                selected = added; tab = .edit; addedTick += 1
                problem = nil
            } catch { problem = error.localizedDescription }
        }
    }

    /// The design as it stands, drawn and handed to the share sheet (saved or not).
    private func shareDesign() {
        Task {
            busy = "Drawing…"; defer { busy = nil }
            do {
                let r = try await engine.run(doc: design.doc, photos: allPhotos, fields: design.fields, options: ["px": 1080])
                guard let jpeg = NativeArtwork.image(r)?.jpegData(compressionQuality: 0.92) else { throw ERPAPI.Failure(status: 0, message: "The design could not be drawn.") }
                let base = (design.fields["headline"] ?? "").isEmpty ? (design.label.isEmpty ? "design" : design.label) : design.fields["headline"] ?? "design"
                shareFiles = MarketingFileShare(items: [try SettingsFiles.save(jpeg, named: base + "-" + frame.s("format", "design") + ".jpg")])
            } catch { problem = error.localizedDescription }
        }
    }

    // MARK: Pictures

    private func source(_ target: Target) -> Data? {
        switch target {
        case .main, .add: return pictures[design.asset]
        case .inset(let id):
            guard let l = layer(id) else { return nil }
            let pid = l.s("photoId")
            if pid == "photo" { return pictures[design.asset] }
            if pid.hasPrefix("lib:") { return pictures[String(pid.dropFirst(4))] }
            return Self.dataURL(l.s("src"))
        }
    }

    /// A picture into its place: the main photo, an inset (keeping its frame, crop and spot), or a new inset.
    private func place(_ key: String, _ target: Target, marked: Bool = false) {
        switch target {
        case .main: edit { $0.asset = key; $0.marked = marked }
        case .inset(let id):
            if insetOriginals[id] == nil, let l = layer(id) { insetOriginals[id] = MarketingValue(["photoId": l.s("photoId"), "src": l["src"].any]) }
            updateLayer(id) { n in
                n["photoId"] = .string("lib:" + key)
                var o = n.object; o["src"] = nil; n = .object(o)
            }
        case .add: act("image", "rounded", ["photoId": "lib:" + key])
        }
    }
    private func addLayer(_ n: MarketingValue) {
        edit { $0.doc["layers"] = .array($0.doc["layers"].array + [n]) }
        selected = n.s("id"); tab = .edit; addedTick += 1; problem = nil
    }
    /// A logo file (newUploadLayer): an image layer holding the SVG or PNG as a data: URL, uploaded when you save.
    private func takeLogo(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            guard let n = ArtworkLogo.uploadLayer(data, frame: frameSize) else { throw ERPAPI.Failure(status: 0, message: "Choose an SVG or PNG logo.") }
            addLayer(n)
        } catch { if (error as? CocoaError)?.code != .userCancelled { problem = error.localizedDescription } }
    }
    private func restoreInset(_ id: String) {
        guard let was = insetOriginals[id] else { return }
        updateLayer(id) { n in
            n["photoId"] = .string(was.s("photoId"))
            var o = n.object; o["src"] = was["src"] == .null ? nil : was["src"]; n = .object(o)
        }
    }
    private func useLibrary(_ item: MarketingValue, _ target: Target) async {
        let original = item["original"].s("id")
        let asset = original.isEmpty ? item.s("id") : original
        do {
            busy = "Bringing the photo…"; defer { busy = nil }
            pictures[asset] = try await board.photoData(asset)
            place(asset, target, marked: item.s("source") == "site" && original.isEmpty)
        } catch { problem = error.localizedDescription }
    }
    private func take(_ item: PhotosPickerItem) async {
        defer { device = nil }
        guard let target = deviceTarget else { return }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let jpeg = WebsitePhoto.jpegCopy(data, longestEdge: 2400) else { throw ERPAPI.Failure(status: 0, message: "Choose a readable photo.") }
            let key = "local:" + UUID().uuidString
            pictures[key] = jpeg
            place(key, target)
        } catch { problem = error.localizedDescription }
    }

    // MARK: AI

    private func ai(_ op: String, _ params: [String: Any], _ target: Target) {
        guard let data = source(target) else { problem = "There is no picture to work from."; return }
        Task {
            busy = "Making a photo version…"; defer { busy = nil }
            do {
                let r = try await MarketingRequest.ai(op, images: [data], params: params)
                guard let bytes = Data(base64Encoded: r["image"].s("data")) else { throw ERPAPI.Failure(status: 0, message: "The AI returned no photo.") }
                let check = r["check"]
                var warning: String?
                if check != .null && !check["samePiece"].bool {
                    let diffs = check["differences"].array.map(\.string).filter { !$0.isEmpty }
                    warning = "The check says the piece changed" + (diffs.isEmpty ? "." : ": " + diffs.joined(separator: "; ") + ".") + " Compare before choosing it."
                }
                candidate = Candidate(target: target, before: data, data: bytes, warning: warning)
                problem = nil
            } catch { problem = error.localizedDescription }
        }
    }
    private func accept(_ c: Candidate) {
        let key = "local:" + UUID().uuidString
        pictures[key] = WebsitePhoto.jpegCopy(c.data) ?? c.data
        place(key, c.target)
        candidate = nil
    }
    private func writeWords() async {
        busy = "Writing options…"; defer { busy = nil }
        let f = design.fields, i = info
        let base: [String: Any] = [
            "name": design.label, "collection": f["kicker"] ?? "", "specs": f["weight"] ?? "", "price": "", "format": frame.s("format", "portrait"),
            "aspect": i.s("ai", "4:5"), "shape": i.s("label"), "trimTo": i.s("short"), "destination": "whatsapp", "goal": "whatsapp",
            "kicker": f["kicker"] ?? "", "headline": f["headline"] ?? "", "cta": f["details"] ?? "",
        ]
        let angles = ["", "bold and graphic, one strong line", "quiet luxury — very few words"]
        let got = await withTaskGroup(of: (Int, [String: String]?).self) { group in
            for (n, angle) in angles.enumerated() {
                var p = base; p["brief"] = angle
                group.addTask { @MainActor in
                    guard let words = try? await MarketingRequest.send("/api/ads/studio/copy", p)["onImage"], !words.s("headline").isEmpty else { return (n, nil) }
                    return (n, ["kicker": words.s("kicker"), "headline": words.s("headline"), "details": words.s("details")])
                }
            }
            var out: [(Int, [String: String]?)] = []
            for await r in group { out.append(r) }
            return out.sorted { $0.0 < $1.0 }.compactMap(\.1)
        }
        var seen: Set<String> = []
        wordOptions = got.filter { seen.insert($0["headline"] ?? "").inserted }
        problem = wordOptions.isEmpty ? "No words came. Try again in a minute." : nil
    }

    // MARK: Opening, drawing, saving

    private func load() async {
        let f = frame
        guard f != .null else { problem = "This design is no longer on the board."; return }
        var d = Design(doc: .null, fields: board.fields(f), template: f.s("template", "headline"), label: f.s("label"), asset: f.s("assetId"), marked: f["marked"].bool)
        do {
            let set = try await board.photoSet(f)
            for (k, v) in set { if k == "photo" { pictures[d.asset] = v } else if k.hasPrefix("lib:") { pictures[String(k.dropFirst(4))] = v } }
            d.doc = f["doc"] != .null ? f["doc"] : try await board.layOut(f, photos: set)
        } catch {
            problem = error.localizedDescription
            guard f["doc"] != .null else { return }
            d.doc = f["doc"]
        }
        design = d; initial = d; ready = true
        demoOpen()
    }

    /// The simulator check opens the designer on a panel (`-ERPDemoBoardEditor text|add|words|photo|page`).
    private func demoOpen() {
        guard House.isDemo, let v = UserDefaults.standard.string(forKey: "ERPDemoBoardEditor") else { return }
        if v == "text" || v == "edit" {
            selected = layers.last { $0.s("kind") == "text" && $0.s("bind") == "headline" }?.s("id") ?? layers.last { $0.s("kind") == "text" }?.s("id")
            show(.edit)
        } else if let p = Pane(rawValue: v) { show(p) }
    }

    private func draw() async {
        guard ready, design.doc != .null else { return }
        // While a finger moves a layer, drawings that would be stale at once are skipped.
        if gestureStart != nil { do { try await Task.sleep(for: .milliseconds(30)) } catch { return } }
        do {
            let r = try await engine.run(doc: design.doc, photos: allPhotos, fields: design.fields, options: ["px": gestureStart != nil ? 720 : 1080])
            guard !Task.isCancelled else { return }
            response = r
            if problem?.hasPrefix("The design could not") == true { problem = nil }
        } catch { if !Task.isCancelled { problem = error.localizedDescription } }
    }

    /// Upload what is new (the phone's and the AI's pictures, and any picture the full designer embedded), rewrite
    /// them to library ids, then write the board once.
    private func save() async {
        guard !House.isDemo else { return }
        busy = "Saving…"; problem = nil
        defer { busy = nil }
        do {
            var d = design
            var ids: [String: String] = [:]
            let name = d.label.isEmpty ? "Board design" : d.label
            func uploaded(_ key: String) async throws -> String {
                if let id = ids[key] { return id }
                guard let data = pictures[key] else { throw ERPAPI.Failure(status: 0, message: "A picture on this design went missing; choose it again.") }
                let id = try await board.upload(data, name: name)
                ids[key] = id; pictures[id] = data
                return id
            }
            if d.asset.hasPrefix("local:") { d.asset = try await uploaded(d.asset); d.marked = false }
            var bySrc: [String: String] = [:]
            var list = d.doc["layers"].array
            for i in list.indices where list[i].s("kind") == "image" {
                let pid = list[i].s("photoId"), src = list[i].s("src")
                if pid.hasPrefix("lib:local:") { list[i]["photoId"] = .string("lib:" + (try await uploaded(String(pid.dropFirst(4))))) }
                if !src.isEmpty {
                    if bySrc[src] == nil {
                        guard let data = Self.dataURL(src) else { throw ERPAPI.Failure(status: 0, message: "An uploaded picture couldn’t be read; replace it and save again.") }
                        // A PNG or SVG goes up as it is (the server draws and flattens it, as for the web's logo files);
                        // a photo is re-made as a JPEG first.
                        let mime = Self.dataURLMime(src)
                        let raw = ["image/png", "image/svg+xml"].contains(mime) ? mime : nil
                        let id = try await board.upload(data, name: name, rawType: raw)
                        // The server keeps a raw logo as a JPEG, so that is the copy to draw from if the write below fails.
                        if raw == nil { pictures[id] = data } else if let kept = try? await board.photoData(id) { pictures[id] = kept }
                        bySrc[src] = id
                    }
                    var o = list[i].object; o["src"] = nil; o["photoId"] = .string("lib:" + (bySrc[src] ?? "")); list[i] = .object(o)
                }
            }
            d.doc["layers"] = .array(list)
            // Uploaded once: a failed write below doesn't upload them again.
            if d != design { design = d }
            let clean = d.label.trimmingCharacters(in: .whitespacesAndNewlines)
            let patch: [String: Any] = [
                "doc": d.doc.any, "fields": d.fields, "template": d.template, "label": clean.isEmpty ? frame.s("label") : clean,
                "assetId": d.asset.isEmpty ? NSNull() as Any : d.asset, "marked": d.marked, "by": "page",
            ]
            board.error = nil
            await board.change([["op": "put", "id": frameID, "patch": patch]])
            if let e = board.error { problem = e; return }
            initial = design
            savedTick += 1
            dismiss()
        } catch { problem = error.localizedDescription }
    }

    // MARK: Small helpers

    static func dataURLMime(_ src: String) -> String {
        guard src.hasPrefix("data:"), let end = src.firstIndex(where: { $0 == ";" || $0 == "," }) else { return "" }
        return String(src[src.index(src.startIndex, offsetBy: 5)..<end]).lowercased()
    }
    static func dataURL(_ src: String) -> Data? {
        guard src.hasPrefix("data:"), let comma = src.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(src[src.index(after: comma)...]))
    }
    static func fieldName(_ key: String) -> String { ["kicker": "Small line", "headline": "Headline", "weight": "Specs", "details": "Call to action"][key] ?? ArtworkProperties.label(key) }
    static func origin(_ asset: String) -> String {
        if asset.hasPrefix("local:") { return "New: uploaded when you save." }
        if asset.hasPrefix("up:") { return "Uploaded picture" }
        if asset.hasPrefix("site:") { return "From the website" }
        if asset.hasPrefix("drive:") { return "From Drive" }
        return "From the library"
    }
    static func symbol(_ l: MarketingValue) -> String {
        switch l.s("kind") {
        case "text": return "textformat"
        case "image": return "photo"
        case "wordmark": return "signature"
        case "circle": return "circle"
        case "line", "arrow": return "line.diagonal"
        default: return "square.on.circle"
        }
    }
}

/// Queue a post from a board design (board.tsx QueueDialog): it waits in Posts → Hub, held, to be sent now or
/// at a time from there. Nothing goes out from here.
struct StudioBoardQueueSheet: View {
    let frame: MarketingValue
    let board: StudioBoardModel
    @Environment(\.dismiss) private var dismiss
    @State private var places: [MarketingValue]?
    @State private var problem: String?
    @State private var chosen: Set<String> = []
    @State private var instagram = false
    @State private var caption = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("It waits in Posts → Hub, held: send it now or set a time there.").font(.footnote).foregroundStyle(.secondary)
                    if let places {
                        if places.isEmpty && problem == nil {
                            Text("No WhatsApp channel or group is connected; the story can still be queued.").font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(places.map { $0.s("key") }, id: \.self) { key in
                            let p = places.first { $0.s("key") == key } ?? .null
                            Toggle(isOn: Binding(get: { chosen.contains(key) }, set: { if $0 { chosen.insert(key) } else { chosen.remove(key) } })) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.s("name"))
                                    if p["size"] != .null { Text("\(Int(p.n("size"))) people").font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                        Toggle(isOn: $instagram) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Instagram story")
                                Text("The same design at 9:16").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } else if problem == nil {
                        SkeletonLoading("Finding the WhatsApp places")
                    }
                    if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
                } header: { LedgerHeading(title: "Where") }.houseRows()
                Section {
                    TextField("Caption", text: $caption, axis: .vertical).lineLimit(4...12)
                } header: { LedgerHeading(title: "Caption") }.houseRows()
            }
            .modifier(HouseGround())
            .navigationTitle("Queue a post").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Queue it") {
                        let whatsapp = (places ?? []).map { $0.s("key") }.filter { chosen.contains($0) }
                        let ig = instagram, words = caption, f = frame
                        dismiss()
                        Task { await board.queue(f, whatsapp: whatsapp, instagram: ig, caption: words) }
                    }.disabled(chosen.isEmpty && !instagram)
                }
            }
        }
        .presentationSizing(.form)
        .task { await load() }
    }

    private func load() async {
        let f = board.fields(frame)
        caption = [f["headline"] ?? "", f["weight"] ?? "", f["details"] ?? ""].filter { !$0.isEmpty }.joined(separator: "\n")
        do {
            let r = try await MarketingRequest.get("/api/website/post")
            var list: [MarketingValue] = []
            if r["channel"] != .null { list.append(MarketingValue(["key": "channel", "name": r["channel"].s("name"), "size": r["channel"]["followers"].any])) }
            list += r["groups"].array
            places = list
            if list.contains(where: { $0.s("key") == "channel" }) { chosen = ["channel"] }
        } catch { problem = error.localizedDescription; places = [] }
    }
}

/// A library photo for a new board design (board.tsx PhotoPicker): best for ads first, in the shape chosen.
struct StudioBoardPhotoPicker: View {
    let board: StudioBoardModel
    var title = "Add a photo"
    /// A new design chooses its shape here; a replaced picture keeps the design's.
    var choosesShape = true
    let pick: (MarketingValue, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var format = "portrait"
    @State private var items: [MarketingValue]?
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if choosesShape {
                        Picker("Shape", selection: $format) {
                            ForEach(board.formats.map { $0.s("id") }, id: \.self) { Text(board.formatInfo($0).s("label", $0)).tag($0) }
                        }
                        .pickerStyle(.menu)
                    }
                    if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
                    if let items {
                        if items.isEmpty && problem == nil {
                            Text(q.isEmpty ? "The library has no photos yet." : "Nothing matches “\(q)”.").foregroundStyle(.secondary)
                        }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
                            ForEach(items.map { $0.s("id") }, id: \.self) { id in
                                let item = items.first { $0.s("id") == id } ?? .null
                                Button { pick(item, format) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        MarketingPhoto(path: item.s("thumb")).frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit).clipShape(.rect(cornerRadius: 10))
                                        Text(item.s("name")).font(.caption).lineLimit(2).foregroundStyle(.primary)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel((choosesShape ? "Add " : "Use ") + item.s("name"))
                            }
                        }
                    } else if problem == nil {
                        SkeletonLoading("Loading the photos")
                    }
                }
                .padding(20)
            }
            .background(Theme.ground)
            .searchable(text: $q, prompt: "Search — ring, emerald, bangles…")
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .presentationSizing(.page)
        .task(id: q) {
            if House.isDemo { items = []; problem = "The demo has no photo library."; return }
            if !q.isEmpty { do { try await Task.sleep(for: .milliseconds(300)) } catch { return } }
            do {
                let r = try await MarketingRequest.get("/api/ads/studio/library?view=all&sort=score&limit=48&q=" + AdsQuery.escape(q))
                guard !Task.isCancelled else { return }
                items = r["items"].array; problem = nil
            } catch { if !Task.isCancelled { problem = error.localizedDescription } }
        }
    }
}
