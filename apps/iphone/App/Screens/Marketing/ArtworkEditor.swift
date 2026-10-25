import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#endif

struct ArtworkEditor: View {
    @Binding var doc: MarketingValue
    let photos: [String: Data]
    let fields: [String: String]
    var ad = false
    /// The catalogue's list the Layout menu offers as square layouts, in place of the frame's own (Edit a piece: "siteSquares",
    /// its website photo's layouts, in its own shape as well as square).
    var layoutGroup: String? = nil
    #if os(macOS)
    /// Set by the design window: the editor is then the window's own centre and inspector (no sheet, no Cancel).
    var macEmbed: MacArtworkEmbed? = nil
    #endif
    @Environment(\.dismiss) private var dismiss
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    /// The sheet's own width: on an iPad's page sheet the artwork is pinned on the left and the tools sit beside it.
    @State private var sheetWidth: CGFloat = 0
    @State private var engine = NativeArtwork()
    @State private var response = MarketingValue.null
    @State private var selected: Set<String> = []
    @State private var undo: [MarketingValue] = []
    @State private var redo: [MarketingValue] = []
    @State private var dragStart: MarketingValue?
    @State private var problem: String?
    @State private var confirmingDiscard = false
    @State private var importing: PhotosPickerItem?
    @State private var busy = false
    @State private var share: MarketingFileShare?
    @State private var clipboard = ArtworkClipboard.shared
    @State private var resizing: MarketingValue?
    @State private var logoOpen = false
    /// Slider steps close together are one undo step, as on the board designer.
    @State private var coalesceKey = ""
    @State private var coalesceAt = Date.distantPast
    /// The design as it came in, so Cancel can put it back (the editor writes to the live design as it goes).
    @State private var original: MarketingValue?
    /// Designer v2: a slider's steps folded into one undo (see `fold`), snapping while a layer is dragged, the order layers
    /// were picked in (for "match the first one picked"), and the QR code being typed.
    @State private var pendingKey: String?
    @AppStorage("artwork.snap") private var snapping = true
    @State private var snapX: Double?
    @State private var snapY: Double?
    @State private var dragMoving: ArtworkBox?
    @State private var dragLines: ArtworkSnap.Lines?
    @State private var picks: [String] = []
    @State private var qrOpen = false
    @State private var qrText = ""
    #if os(macOS)
    /// The chosen layers waiting for the yes that removes them (the sheet's ⌘⌫ or its right-click menu).
    @State private var removing = false
    /// The inspector's tab, the page's zoom (and a pinch in progress), the marquee being dragged, the photo picker, and where the
    /// keyboard is: in the layer's words (a double-click on a text layer) or on the page (arrows nudge, ⌫ removes).
    @State private var macPane = "layer"
    @State private var macZoom = 1.0
    @State private var macPinch = 1.0
    @State private var macMarquee: CGRect?
    @State private var macPicking = false
    @FocusState private var macTextFocus: Bool
    @FocusState private var macCanvasFocus: Bool
    @AppStorage(MacInspector.key) private var macInspectorShown = true
    #endif
    private var sideBySide: Bool { sizeClass.isPadLayout && sheetWidth >= 820 && !typeSize.isAccessibilitySize }
    private var pageWidth: Double { doc["frame"].n("w", 1080) }
    private var allPhotos: [String: Data] { clipboard.photos.merging(photos) { _, current in current } }
    private var placement: Binding<MarketingValue> {
        Binding(get: {
            let id = doc["bg"].s("photoId")
            if doc["placements"] != .null { return doc["placements"][id] == .null ? MarketingValue(["mode": "fill", "zoom": 1, "focusX": 0.5, "focusY": 0.5]) : doc["placements"][id] }
            return doc["bg"]["placement"]
        }, set: { value in
            var d = doc; let id = d["bg"].s("photoId")
            if d["placements"] != .null && !id.isEmpty { d["placements"][id] = value }
            else { d["bg"]["placement"] = value }
            change(d)
        })
    }
    private var layers: [MarketingValue] { doc["layers"].array }
    private var height: Double { doc["frame"].n("h", 1920) }
    private var catalogue: MarketingValue { response["catalogue"] }
    private var layer: Binding<MarketingValue>? {
        guard selected.count == 1, let id = selected.first, let i = layers.firstIndex(where: { $0.s("id") == id }) else { return nil }
        return Binding(get: { doc["layers"].array.indices.contains(i) ? doc["layers"].array[i] : .null }, set: { v in var d = doc; var a = layers; guard a.indices.contains(i) else { return }; a[i] = v; d["layers"] = .array(a); change(d) })
    }
    var body: some View {
        #if os(macOS)
        macBody
        #else
        NavigationStack {
            Form {
                Section {
                    Menu("Add") { addMenu }
                    Menu("Layout") {
                        let group = layoutGroup ?? (ad ? "templates" : (height < 1400 ? "squares" : "presets"))
                        let action = layoutGroup != nil ? "square" : ad ? "ad" : (height < 1400 ? "square" : "preset")
                        ForEach(catalogue[group].array, id: \.text) { i in Button(i.s("label")) { act(action, i.s("id")) } }
                    }
                    Menu("Colours") { ForEach(catalogue["palettes"].array, id: \.text) { p in Button(p.s("label")) { act("palette", "", ["palette": p.s("id")]) } } }
                    if !selected.isEmpty { selectionTools }
                    if !clipboard.layers.isEmpty { Button("Paste copied layers") { act("carry", "", ["layers": clipboard.layers.map(\.any), "fromFrame": clipboard.frame.any]) } }
                }.houseRows()
                if let layer { controls(layer) }
                else if let style = selectionStyle {
                    Section { ArtworkEffectsRows(layer: style, fold: fold) } header: { LedgerHeading(title: "Blend and effects · \(selected.count) selected") }.houseRows()
                }
                Section {
                    DisclosureGroup("Background and crop") {
                        Picker("Photo", selection: Binding(get: { doc["bg"].s("photoId") }, set: { var d = doc; d["bg"]["photoId"] = $0.isEmpty ? .null : .string($0); change(d) })) {
                            Text("No photo").tag(""); ForEach(photos.keys.sorted(), id: \.self) { Text(photoName($0)).tag($0) }
                        }
                        ArtworkProperties(value: nested("bg"), keys: ["color", "color2", "dim", "gradient"])
                        ArtworkProperties(value: placement, keys: ["mode", "zoom", "focusX", "focusY"])
                        if !doc["bg"].s("photoId").isEmpty {
                            ArtworkShadeControls(shade: doc["bg"]["shade"]) { v, key in var d = doc; d["bg"]["shade"] = v; change(d, key: key.map { "bg-shade-" + $0 }) }
                        }
                        filters(nested("bg"))
                        Button("Add background gradient") { var d = doc; d["bg"]["color2"] = .string("#111111"); change(d) }
                        Toggle("Multi-colour gradient base", isOn: Binding(get: { doc["bg"]["fill"] != .null }, set: { on in
                            var d = doc
                            if on { d["bg"]["fill"] = ArtworkGradients.make(angle: 180, [ArtworkStop(at: 0, color: doc["bg"].s("color", "#EDE6DA"), alpha: nil), ArtworkStop(at: 1, color: doc["bg"].s("color2", "#111111"), alpha: nil)]) }
                            else { var bg = d["bg"]; bg.artworkDrop("fill"); d["bg"] = bg }
                            change(d)
                        }))
                        if doc["bg"]["fill"] != .null {
                            ArtworkGradientRows(gradient: Binding(get: { doc["bg"]["fill"] }, set: { g in var d = doc; d["bg"]["fill"] = g; change(d) }), fold: fold)
                        }
                    }
                }.houseRows()
                Section {
                    DisclosureGroup("Guides and grid") { ArtworkGuideRows(doc: Binding(get: { doc }, set: { change($0) })) }
                }.houseRows()
                Section {
                    DisclosureGroup("Layers · \(layers.count)") {
                        ForEach(layers.reversed(), id: \.text) { l in
                            Button { select(l.s("id"), multiple: false) } label: {
                                HStack { Image(systemName: selected.contains(l.s("id")) ? "checkmark.circle.fill" : "circle"); Text(name(l)).foregroundStyle(.primary); Spacer(); if l["locked"].bool { Image(systemName: "lock") }; if l["hidden"].bool { Image(systemName: "eye.slash") } }
                            }.contextMenu {
                                Button("Select together") { select(l.s("id"), multiple: true) }
                                Button(l["locked"].bool ? "Unlock" : "Lock") { patch(l.s("id"), ["locked": .bool(!l["locked"].bool)]) }
                                Button(l["hidden"].bool ? "Show" : "Hide") { patch(l.s("id"), ["hidden": .bool(!l["hidden"].bool)]) }
                            }
                        }
                    }
                }.houseRows()
            }.modifier(HouseGround()).navigationTitle("Design").navigationBarTitleDisplayMode(.inline)
                .scrollDismissesKeyboard(.interactively)
                // The artwork stays on screen while a property is changed: it is pinned above the Form, never a row that scrolls away.
                .safeAreaInset(edge: .top, spacing: 0) {
                    if !sideBySide {
                        preview.frame(maxWidth: .infinity)
                            .containerRelativeFrame(.vertical) { length, _ in length * 0.36 }
                            .padding(.vertical, 8)
                            .background(Theme.ground)
                    }
                }
                // An iPad: the artwork on the left at its own size, the tools in the column beside it.
                .safeAreaInset(edge: .leading, spacing: 0) {
                    if sideBySide {
                        preview.padding(24)
                            .frame(width: max(360, sheetWidth * 0.56))
                            .frame(maxHeight: .infinity)
                            .background(Theme.ground)
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if let original, original != doc { confirmingDiscard = true } else { dismiss() } } }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button { history(true) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }.disabled(undo.isEmpty)
                        Button { history(false) } label: { Label("Redo", systemImage: "arrow.uturn.forward") }.disabled(redo.isEmpty)
                        Menu {
                            Button { Task { await export() } } label: { Label("Share", systemImage: "square.and.arrow.up") }.disabled(busy)
                        } label: { Label("More", systemImage: "ellipsis") }
                    }
                }
                .sensoryFeedback(.alignment, trigger: snapX) { _, now in now != nil }
                .sensoryFeedback(.alignment, trigger: snapY) { _, now in now != nil }
                .confirmDestructive(isPresented: $confirmingDiscard, title: "Discard your changes?", message: "The design goes back to how it was when you opened it.",
                                    action: "Discard changes") { if let original { doc = original }; dismiss() }
                .failureAlert($problem, title: "Could not finish").task(id: doc.text + fields.sorted(by: { $0.key < $1.key }).description) { await render() }
                .onChange(of: importing) { _, item in if let item { Task { await take(item) } } }
                .fileImporter(isPresented: $logoOpen, allowedContentTypes: [.svg, .png]) { takeLogo($0) }
                .onAppear { if original == nil { original = doc } }
                .onChange(of: selected) { _, new in picks = picks.filter { new.contains($0) } + new.subtracting(picks).sorted() }
                .interactiveDismissDisabled(original != nil && original != doc)
                .sheet(item: $share) { MarketingShareSheet(items: $0.items) }.websiteBusy(busy ? "Preparing…" : nil)
                .alert("QR code", isPresented: $qrOpen) {
                    TextField("Link or words", text: $qrText)
                    Button("Add") {
                        let text = qrText.trimmingCharacters(in: .whitespacesAndNewlines)
                        if let why = ArtworkQR.problem(text) { problem = why } else { addLayer(ArtworkQR.layer(text, frame: CGSize(width: pageWidth, height: height))) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: { Text("What the code opens: a link, a number or any words. Dark on light reads on every phone.") }
        }
        .presentationSizing(.page)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { sheetWidth = $0 }
        #endif
    }
    private var preview: some View {
        GeometryReader { g in
            let scale = g.size.width / pageWidth
            ZStack(alignment: .topLeading) {
                if let image = NativeArtwork.image(response) { Image(uiImage: image).resizable().scaledToFit().onTapGesture { selected = [] } } else { SkeletonLoading().frame(maxWidth: .infinity, maxHeight: .infinity) }
                ArtworkGuideOverlay(width: pageWidth, scale: scale, guideX: ArtworkSnap.guides(doc, "x"), guideY: ArtworkSnap.guides(doc, "y"), grid: ArtworkSnap.grid(doc), snapX: snapX, snapY: snapY)
                ForEach(response["boxes"].array, id: \.text) { b in
                    let id = b.s("id"), l = layers.first { $0.s("id") == id } ?? .null
                    if !l["hidden"].bool {
                        Rectangle().fill(.clear).overlay { if selected.contains(id) { Rectangle().stroke(Theme.accent, lineWidth: 2) } }.contentShape(Rectangle())
                            .frame(width: max(22, b.n("w") * scale), height: max(22, b.n("h") * scale)).rotationEffect(.degrees(l.n("rotate")))
                            .offset(x: b.n("x") * scale, y: b.n("y") * scale)
                            #if os(macOS)
                            // A click picks the layer (⇧ adds to the pick), a double-click goes to its words; right-click gives the menu.
                            .onTapGesture { macClick(id) }
                            .simultaneousGesture(TapGesture(count: 2).onEnded { macEditWords(id) })
                            .contextMenu { macLayerMenu(id, l) }
                            #else
                            .onTapGesture { select(id, multiple: false) }.onLongPressGesture { select(id, multiple: true) }
                            #endif
                            .gesture(DragGesture(minimumDistance: 3, coordinateSpace: dragSpace).onChanged { v in
                                guard !l["locked"].bool else { return }
                                if dragStart == nil { select(id, multiple: false); dragStart = response["doc"] == .null ? doc : response["doc"]; prepareSnap() }
                                guard let start = dragStart else { return }
                                var dx = v.translation.width / scale, dy = v.translation.height / scale
                                // Designer v2 snapping: the page's middle and margins, other layers, the grid and the guides (8 points).
                                if snapping, let moving = dragMoving, let lines = dragLines {
                                    let nudge = ArtworkSnap.snap(ArtworkBox(x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h), lines, threshold: 8 / scale)
                                    dx += nudge.dx; dy += nudge.dy; snapX = nudge.v; snapY = nudge.h
                                }
                                let moveX = dx, moveY = dy
                                doc["layers"] = .array(start["layers"].array.map { source in
                                    guard selected.contains(source.s("id")), !source["locked"].bool else { return source }
                                    var n = source; n["x"] = .number(source.n("x") + moveX); n["y"] = .number(source.n("y") + moveY); n["flow"] = .null; return n
                                })
                            }.onEnded { _ in if let start = dragStart, start != doc { undo.append(start); redo = [] }; dragStart = nil; snapX = nil; snapY = nil; dragMoving = nil; dragLines = nil }).accessibilityLabel(name(l))
                    }
                }
                #if os(macOS)
                if let m = macMarquee {
                    Rectangle().fill(Theme.accent.opacity(0.12))
                        .overlay { Rectangle().stroke(Theme.accent, lineWidth: 1) }
                        .frame(width: m.width, height: m.height)
                        .offset(x: m.minX, y: m.minY)
                        .allowsHitTesting(false)
                }
                #endif
            }
            #if os(macOS)
            // A drag that starts on the page itself (a layer's box takes its own) is a marquee that picks what it touches.
            .gesture(macMarqueeGesture(scale: scale))
            #endif
        }.aspectRatio(pageWidth / height, contentMode: .fit)
    }
    /// Where a drag is measured: the layer's own space on a phone; on the Mac the window's, so a box redrawn under the pointer
    /// as the layer moves cannot shift the drag.
    private var dragSpace: CoordinateSpace {
        #if os(macOS)
        .global
        #else
        .local
        #endif
    }
    @ViewBuilder private var addMenu: some View {
        Menu("Text") {
            ForEach(["heading", "subheading", "body"], id: \.self) { key in Button(ArtworkProperties.label(key)) { act("text", key) } }
            ForEach(catalogue["textStyles"].array, id: \.text) { i in Button(i.s("label")) { act("textStyle", i.s("id")) } }
        }
        Menu("Shapes and lines") {
            ForEach(["arrow", "line", "rect", "circle"], id: \.self) { key in Button(ArtworkProperties.label(key)) { act("shape", key) } }
            ForEach(catalogue["shapes"].array, id: \.text) { i in Button(i.s("label")) { act("shape", i.s("id")) } }
            ForEach(["dash", "dot"], id: \.self) { key in Button(ArtworkProperties.label(key) + " line") { act("line", key) } }
        }
        Menu("Badges") { ForEach(catalogue["badges"].array, id: \.text) { i in Button(i.s("label")) { act("badge", i.s("id")) } } }
        Menu("Full logo") { Button("Top right") { act("mark", "top") }; Button("Bottom right") { act("mark", "bottom") }; Button("Monogram") { addLayer(ArtworkLogo.monogram(ink: ArtworkLogo.ink(for: doc))) } }
        Menu("Photo inset") {
            ForEach(photos.keys.sorted(), id: \.self) { key in Menu(photoName(key)) {
                Button("Rectangle") { act("image", "", ["photoId": key]) }
                ForEach(catalogue["masks"].array, id: \.text) { m in Button(ArtworkProperties.label(m.string)) { act("image", m.string, ["photoId": key]) } }
            } }
        }
        #if os(macOS)
        // A picker kept inside a menu loses its window when the menu closes: the menu asks, the editor presents it.
        Button { macPicking = true } label: { Label("Upload image", systemImage: "photo.on.rectangle") }
        #else
        PhotosPicker(selection: $importing, matching: .images) { Label("Upload image", systemImage: "photo.on.rectangle") }
        #endif
        Button { logoOpen = true } label: { Label("Logo file (SVG or PNG)", systemImage: "square.and.arrow.down") }
        Button("Link pill") { act("link", "Ask us on WhatsApp") }
        Button { qrText = ""; qrOpen = true } label: { Label("QR code", systemImage: "qrcode") }
    }
    private var selectionTools: some View {
        Menu("Arrange · \(selected.count) selected") {
            Button("Select all") { selected = Set(layers.map { $0.s("id") }) }
            Button("Bring to front") { reorder(true) }; Button("Send to back") { reorder(false) }
            Button("Bring forward") { step(1) }; Button("Send backward") { step(-1) }
            Button("Group") { set(["group": .string(UUID().uuidString)]) }; Button("Ungroup") { set(["group": .null]) }
            Button("Mirror across") { flip("flipX") }; Button("Mirror down") { flip("flipY") }
            Menu("Align to page") { alignMenu(page: true) }; if selected.count > 1 { Menu("Align selection") { alignMenu(page: false) } }
            if selected.count > 1 { Menu("Match the first one picked") { ForEach(ArtworkMatch.hows, id: \.0) { h in Button(h.label) { match(h.id) } } } }
            if selected.count >= 3 { Button("Space evenly across") { act("distribute", "h") }; Button("Space evenly down") { act("distribute", "v") } }
            Button("Larger") { act("scale", "", ["factor": 1.1]) }; Button("Smaller") { act("scale", "", ["factor": 0.9]) }
            Button("Copy") { clipboard.layers = layers.filter { selected.contains($0.s("id")) }; clipboard.frame = doc["frame"]; clipboard.photos = photos }; Button("Duplicate") { duplicate(layers.filter { selected.contains($0.s("id")) }) }
            Button("Lock") { set(["locked": .bool(true)]) }
            Button("Remove", role: .destructive) { var d = doc; d["layers"] = .array(layers.filter { !selected.contains($0.s("id")) || $0["locked"].bool }); change(d); selected = [] }
        }
    }
    private func alignMenu(page: Bool) -> some View { ForEach(["left", "center", "right", "top", "middle", "bottom"], id: \.self) { key in Button(ArtworkProperties.label(key)) { act("align", key, ["toPage": page]) } } }
    /// The fields the generic "All settings" rows still show: everything that has no proper control of its own.
    private func genericKeys(_ l: MarketingValue) -> [String] {
        // Designer v2's fields each have a control below: blend, opacity, layerFx, runs, list, fillGradient, font, cutout; a QR's own four.
        var skip: Set<String> = ["id", "kind", "bind", "photoId", "src", "mark", "flow", "group", "effect", "adjust", "box", "shade", "iz",
                                 "blend", "opacity", "layerFx", "runs", "list", "fillGradient", "font", "cutout"]
        if l.s("kind") == "qr" { skip.formUnion(["value", "fg", "bg", "quiet"]) }
        return l.object.keys.filter { !skip.contains($0) }.sorted()
    }
    @ViewBuilder private func controls(_ l: Binding<MarketingValue>) -> some View {
        Section {
            if l.wrappedValue["locked"].bool { Button("Unlock") { l.wrappedValue["locked"] = .bool(false) } }
            else {
                if !l.wrappedValue.s("bind").isEmpty {
                    Text("Uses the piece’s \(l.wrappedValue.s("bind")); edit it on the piece.").font(.footnote).foregroundStyle(.secondary)
                    Button("Make independent text") { let key = l.wrappedValue.s("bind"); l.wrappedValue["text"] = .string(fields[key] ?? ""); l.wrappedValue["bind"] = .null }
                }
                if l.wrappedValue.s("kind") == "text" {
                    // The six Designer v2 faces come with the other fourteen, named as the web names them.
                    let font = l.wrappedValue.s("font", "regular")
                    Picker("Font", selection: Binding(get: { font }, set: { l.wrappedValue["font"] = .string($0) })) {
                        ForEach(ArtworkFont.faces, id: \.0) { Text($0.label).tag($0.id) }
                        if !ArtworkFont.faces.contains(where: { $0.id == font }) { Text(ArtworkFont.label(font)).tag(font) }
                    }
                }
                ArtworkProperties(value: l, keys: genericKeys(l.wrappedValue))
                if l.wrappedValue.s("kind") == "text" {
                    ArtworkTextEffectRows(layer: l, fold: fold)
                    Toggle("Text box", isOn: Binding(get: { l.wrappedValue["box"] != .null }, set: { l.wrappedValue["box"] = $0 ? MarketingValue(["color": "#FFFFFF", "radius": 24, "pad": 20]) : .null }))
                    ArtworkProperties(value: l, keys: ["box"])
                    Button("Underline") { l.wrappedValue["underline"] = .bool(!l.wrappedValue["underline"].bool) }
                    if l.wrappedValue["curve"] == .null { Button("Bend text") { l.wrappedValue["curve"] = .number(20) } }
                }
                if l.wrappedValue.s("kind") == "image" {
                    filters(l)
                    Toggle("Cut out (transparent background)", isOn: Binding(get: { l.wrappedValue["cutout"].bool }, set: { on in if on { l.wrappedValue["cutout"] = .bool(true) } else { l.wrappedValue.artworkDrop("cutout") } }))
                    // Frames (a layer with a height) show the photo covering the frame; zoom goes past that.
                    if l.wrappedValue["h"] != .null {
                        ArtworkSlider(title: "Zoom in frame", value: Binding(get: { l.wrappedValue.n("iz", 1) }, set: { l.wrappedValue["iz"] = .number($0) }), range: 1...4, step: 0.05, format: "%.2f×")
                    }
                    ArtworkShadeControls(shade: l.wrappedValue["shade"]) { v, key in
                        let id = l.wrappedValue.s("id")
                        var d = doc; d["layers"] = .array(layers.map { var n = $0; if n.s("id") == id { n["shade"] = v }; return n })
                        change(d, key: key.map { "shade-\(id)-" + $0 })
                    }
                    Picker("Frame", selection: Binding(get: { l.wrappedValue.s("mask") }, set: { l.wrappedValue["mask"] = $0.isEmpty ? .null : .string($0) })) { Text("Rectangle").tag(""); ForEach(catalogue["masks"].array, id: \.text) { Text(ArtworkProperties.label($0.string)).tag($0.string) } } }
                if ["shape", "rect", "circle"].contains(l.wrappedValue.s("kind")) {
                    Toggle("Filled shape", isOn: Binding(get: { l.wrappedValue["fill"] != .null }, set: { l.wrappedValue["fill"] = $0 ? .string("#FFFFFF") : .null }))
                    if l.wrappedValue["fill"] != .null { ArtworkProperties(value: l, keys: ["fill"]) }
                    Toggle("Gradient fill", isOn: Binding(get: { l.wrappedValue["fill2"] != .null }, set: { l.wrappedValue["fill2"] = $0 ? .string("#111111") : .null }))
                    // Designer v2: any angle, radial, many stops; it replaces the two-colour fill.
                    Toggle("Multi-stop gradient fill", isOn: Binding(get: { l.wrappedValue["fillGradient"] != .null }, set: { on in
                        if on { l.wrappedValue["fillGradient"] = ArtworkGradients.foils[0].gradient } else { l.wrappedValue.artworkDrop("fillGradient") }
                    }))
                    if l.wrappedValue["fillGradient"] != .null {
                        ArtworkGradientRows(gradient: Binding(get: { l.wrappedValue["fillGradient"] }, set: { l.wrappedValue["fillGradient"] = $0 }), fold: fold)
                    }
                }
            }
        } header: { LedgerHeading(title: name(l.wrappedValue)) }.houseRows()
        if !l.wrappedValue["locked"].bool {
            Section { ArtworkEffectsRows(layer: l, fold: fold) } header: { LedgerHeading(title: "Blend and effects") }.houseRows()
            if l.wrappedValue.s("kind") == "text" {
                Section { ArtworkRunsRows(layer: l, words: l.wrappedValue.s("bind").isEmpty ? l.wrappedValue.s("text") : (fields[l.wrappedValue.s("bind")] ?? ""), fold: fold).id(l.wrappedValue.s("id")) } header: { LedgerHeading(title: "Rich text") }.houseRows()
            }
            if l.wrappedValue.s("kind") == "qr" {
                Section { ArtworkQRRows(layer: l, fold: fold) } header: { LedgerHeading(title: "QR code") }.houseRows()
            }
        }
    }
    /// Photo adjustments (filters, quick fixes and every slider), for the background and for a picture.
    private func filters(_ v: Binding<MarketingValue>) -> some View {
        DisclosureGroup("Photo filters and adjustments") {
            ArtworkAdjustRows(adjust: Binding(get: { v.wrappedValue["adjust"] }, set: { v.wrappedValue["adjust"] = $0 }), filters: catalogue["filters"].array, fold: fold)
        }
    }
    /// Runs a change and folds the steps of one slider into a single undo (the key also names the layer).
    private func fold(_ key: String, _ body: () -> Void) {
        pendingKey = key + "-" + selected.sorted().joined(separator: ",")
        body()
        pendingKey = nil
    }
    /// The first selected layer, standing for several: what is set on it (blend, opacity, shadow, glow, outline) is copied to the rest.
    private var selectionStyle: Binding<MarketingValue>? {
        guard selected.count > 1, let first = layers.first(where: { selected.contains($0.s("id")) }) else { return nil }
        return Binding(get: { layers.first { selected.contains($0.s("id")) } ?? first }, set: { v in
            var d = doc
            d["layers"] = .array(layers.map { l -> MarketingValue in
                guard selected.contains(l.s("id")), !l["locked"].bool else { return l }
                var n = l
                for key in ["blend", "opacity"] { if v[key] == .null { n.artworkDrop(key) } else { n[key] = v[key] } }
                if l.s("kind") != "text" { if v["layerFx"] == .null { n.artworkDrop("layerFx") } else { n["layerFx"] = v["layerFx"] } }
                return n
            })
            change(d)
        })
    }
    /// What `match` and a drag's snapping need: the engine's boxes by layer id.
    private func boxes() -> [String: ArtworkBox] {
        var out: [String: ArtworkBox] = [:]
        for b in response["boxes"].array { out[b.s("id")] = ArtworkBox(b) }
        return out
    }
    private func prepareSnap() {
        let all = boxes()
        dragMoving = ArtworkBox.union(selected.compactMap { all[$0] })
        let others = layers.filter { !selected.contains($0.s("id")) && !$0["hidden"].bool }.compactMap { all[$0.s("id")] }
        dragLines = ArtworkSnap.lines(width: pageWidth, height: height, margin: ArtworkSnap.margin(height: height), others: others,
                                      grid: ArtworkSnap.grid(doc), guideX: ArtworkSnap.guides(doc, "x"), guideY: ArtworkSnap.guides(doc, "y"))
    }
    /// "Match the first one picked": the others take its width, height, size, left or top edge, or place.
    private func match(_ how: String) {
        guard let reference = picks.first(where: { selected.contains($0) }) else { return }
        var d = doc
        d["layers"] = .array(ArtworkMatch.apply(how, reference: reference, layers: layers, selected: selected, boxes: boxes()))
        change(d)
    }
    private func nested(_ key: String) -> Binding<MarketingValue> { Binding(get: { doc[key] }, set: { var d = doc; d[key] = $0; change(d) }) }
    private func name(_ l: MarketingValue) -> String { if !l.s("name").isEmpty { return l.s("name") }; if !l.s("bind").isEmpty { return ArtworkProperties.label(l.s("bind")) }; return l.s("text").isEmpty ? ArtworkProperties.label(l.s("kind")) : l.s("text") }
    private func photoName(_ key: String) -> String { "Photo \((photos.keys.sorted().firstIndex(of: key) ?? 0) + 1)" }
    private func select(_ id: String, multiple: Bool) { if multiple { if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }; return }; if selected.contains(id), selected.count > 1 { return }; let group = layers.first { $0.s("id") == id }?.s("group") ?? ""; selected = group.isEmpty ? [id] : Set(layers.filter { $0.s("group") == group }.map { $0.s("id") }) }
    private func change(_ d: MarketingValue, key: String? = nil) {
        guard d != doc else { return }
        let folded = key ?? pendingKey
        let now = Date()
        defer { coalesceAt = now }
        if let folded, folded == coalesceKey, now.timeIntervalSince(coalesceAt) < 1.2 { redo = []; doc = d; return }
        coalesceKey = folded ?? ""
        undo.append(doc); if undo.count > 80 { undo.removeFirst() }; redo = []; doc = d
    }
    private func addLayer(_ n: MarketingValue) { var d = doc; d["layers"] = .array(layers + [n]); change(d); selected = [n.s("id")]; problem = nil }
    /// A logo file (newUploadLayer): an image layer holding the SVG or PNG as a data: URL.
    private func takeLogo(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            guard let n = ArtworkLogo.uploadLayer(data, frame: CGSize(width: pageWidth, height: height)) else { throw ERPAPI.Failure(status: 0, message: "Choose an SVG or PNG logo.") }
            addLayer(n)
        } catch { if (error as? CocoaError)?.code != .userCancelled { problem = error.localizedDescription } }
    }
    private func history(_ back: Bool) { coalesceKey = ""; if back, let d = undo.popLast() { redo.append(doc); doc = d }; if !back, let d = redo.popLast() { undo.append(doc); doc = d } }
    private func patch(_ id: String, _ fields: [String: MarketingValue]) { var d = doc; d["layers"] = .array(layers.map { l in var n = l; if l.s("id") == id { for (k, v) in fields { n[k] = v } }; return n }); change(d) }
    private func set(_ fields: [String: MarketingValue]) { var d = doc; d["layers"] = .array(layers.map { l in var n = l; if selected.contains(l.s("id")), !l["locked"].bool { for (k, v) in fields { n[k] = v } }; return n }); change(d) }
    private func flip(_ key: String) { for l in layers where selected.contains(l.s("id")) && !l["locked"].bool { patch(l.s("id"), [key: .bool(!l[key].bool)]) } }
    private func reorder(_ front: Bool) { let kept = layers.filter { !selected.contains($0.s("id")) }, own = layers.filter { selected.contains($0.s("id")) }; var d = doc; d["layers"] = .array(front ? kept + own : own + kept); change(d) }
    /// One place up or down the stack for each chosen layer (the page's ↑/↓), the others keeping their order.
    private func step(_ by: Int) { var a = layers; let order = by > 0 ? Array(a.indices.reversed()) : Array(a.indices); for i in order where selected.contains(a[i].s("id")) { let j = i + by; guard a.indices.contains(j), !selected.contains(a[j].s("id")) else { continue }; a.swapAt(i, j) }; var d = doc; d["layers"] = .array(a); change(d) }
    private func duplicate(_ source: [MarketingValue]) { var groups: [String: String] = [:]; let made = source.map { l -> MarketingValue in var n = l; n["id"] = .string(UUID().uuidString); n["x"] = .number(l.n("x") + 24); n["y"] = .number(l.n("y") + 24); n["locked"] = .bool(false); let g = l.s("group"); if !g.isEmpty { groups[g] = groups[g] ?? UUID().uuidString; n["group"] = .string(groups[g]!) }; return n }; var d = doc; d["layers"] = .array(layers + made); change(d); selected = Set(made.map { $0.s("id") }) }
    private func act(_ action: String, _ value: String, _ extra: [String: Any] = [:]) { Task { do { var o = extra; o["action"] = action; o["value"] = value; o["selected"] = Array(selected); let r = try await engine.run(doc: doc, photos: allPhotos, fields: fields, options: o); change(r["doc"]); response = r; if !r["added"].array.isEmpty { selected = Set(r["added"].array.map(\.string)) }; problem = nil } catch { problem = error.localizedDescription } } }
    private func render() async { do { let r = try await engine.run(doc: doc, photos: allPhotos, fields: fields); guard !Task.isCancelled else { return }; response = r; problem = nil } catch { if !Task.isCancelled { problem = error.localizedDescription } } }
    private func take(_ item: PhotosPickerItem) async { defer { importing = nil }; do { guard let data = try await item.loadTransferable(type: Data.self), let jpeg = WebsitePhoto.jpegCopy(data), let image = UIImage(data: jpeg) else { throw ERPAPI.Failure(status: 0, message: "Choose a readable photo.") }; let n = MarketingValue(["id": UUID().uuidString, "kind": "image", "photoId": "", "src": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "x": 240, "y": height * 0.35, "w": 600, "h": 600 * image.size.height / image.size.width, "radius": 0, "rotate": 0, "opacity": 1, "shadow": false, "name": "Uploaded image"]); var d = doc; d["layers"] = .array(layers + [n]); change(d); selected = [n.s("id")] } catch { problem = error.localizedDescription } }
    private func export() async { busy = true; defer { busy = false }; do { let r = try await engine.run(doc: doc, photos: allPhotos, fields: fields, options: ["px": 1080]); guard let data = Data(base64Encoded: r.s("image")) else { problem = "The design could not be drawn."; return }; let url = FileManager.default.temporaryDirectory.appendingPathComponent("design-\(UUID().uuidString).jpg"); try data.write(to: url); share = MarketingFileShare(items: [url]) } catch { problem = error.localizedDescription } }
}

#if os(macOS)
// MARK: - The editor on a Mac (docs/features/mac-design.md, "Marketing › Design")
//
// The page in the middle, live: a click picks a layer (⇧ adds to the pick, a drag on the page's empty part is a marquee), a
// drag moves it with the editor's snapping, a double-click goes to its words, the arrows nudge (⇧ by 10), ⌘-scroll or a pinch
// zooms. The inspector at the right has its tabs in its head: Layer, then what the design window adds (Words, Photo, AI), then
// Page. Inside the design window (`macEmbed`) it is the window's own; in a sheet (the Board, Post a piece, Edit a piece) it has
// Cancel and Done. The logic is the iPhone's: every change goes through `change`, `act`, `select` and the rest.
extension ArtworkEditor {
    @ViewBuilder
    var macBody: some View {
        if macEmbed != nil {
            macInline
        } else {
            macSheet
        }
    }

    private var macInline: some View {
        macEffects(macWorkbench)
            .toolbar { macToolbar }
            .macRecordMenu(macMenu)
    }

    private var macSheet: some View {
        NavigationStack {
            macEffects(macWorkbench)
                .navigationTitle("Design")
                .toolbar { macToolbar }
                .toolbar { macSheetToolbar }
                .background { macShortcuts }
                .confirmDestructive(isPresented: $confirmingDiscard, title: "Discard your changes?", message: "The design goes back to how it was when you opened it.",
                                    action: "Discard changes") { if let original { doc = original }; dismiss() }
                .confirmDestructive(isPresented: $removing, title: "Remove \(selected.count == 1 ? "this layer" : "these \(selected.count) layers")?",
                                    message: "Undo (⌘Z) brings \(selected.count == 1 ? "it" : "them") back.", action: "Remove") { macRemoveSelected() }
        }
        .presentationSizing(.page)
        .frame(minWidth: 560, idealWidth: 1180, minHeight: 520, idealHeight: 820)
        .interactiveDismissDisabled(original != nil && original != doc)
    }

    /// What both ways of having the editor do: draw the page, take a picture or a logo, say what went wrong.
    private func macEffects<Content: View>(_ content: Content) -> some View {
        macAlerts(
            content
                .failureAlert($problem, title: "Could not finish")
                .task(id: doc.text + fields.sorted(by: { $0.key < $1.key }).description) { await render() }
                .onChange(of: importing) { _, item in if let item { Task { await take(item) } } }
                .fileImporter(isPresented: $logoOpen, allowedContentTypes: [.svg, .png]) { takeLogo($0) }
                .photosPicker(isPresented: $macPicking, selection: $importing, matching: .images)
                .onAppear { if original == nil { original = doc } }
                .onChange(of: selected) { _, new in picks = picks.filter { new.contains($0) } + new.subtracting(picks).sorted() }
                .onChange(of: macEmbed?.pageId) { _, _ in macPageChanged() }
        )
    }

    private func macAlerts<Content: View>(_ content: Content) -> some View {
        content
            .sheet(item: $share) { MarketingShareSheet(items: $0.items) }
            .websiteBusy(busy ? "Preparing…" : nil)
            .alert("QR code", isPresented: $qrOpen) {
                TextField("Link or words", text: $qrText)
                Button("Add") {
                    let text = qrText.trimmingCharacters(in: .whitespacesAndNewlines)
                    if let why = ArtworkQR.problem(text) { problem = why } else { addLayer(ArtworkQR.layer(text, frame: CGSize(width: pageWidth, height: height))) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("What the code opens: a link, a number or any words. Dark on light reads on every phone.") }
    }

    /// Another page of the design is now the one edited: the pick, the undo steps and the zoom belong to the page that went.
    private func macPageChanged() {
        selected = []
        undo = []
        redo = []
        dragStart = nil
        macMarquee = nil
        macZoom = 1
        response = .null
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var macToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Menu { addMenu } label: { Label("Add", systemImage: "plus.square") }
                .help("Add text, a shape, a badge, a logo, a picture, a link or a QR code")
            Button { history(true) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                .disabled(undo.isEmpty)
                .keyboardShortcut("z", modifiers: .command)
                .help("Undo (⌘Z)")
            Button { history(false) } label: { Label("Redo", systemImage: "arrow.uturn.forward") }
                .disabled(redo.isEmpty)
                .keyboardShortcut("z", modifiers: [.command, .shift])
                .help("Redo (⇧⌘Z)")
            // The design window: everything else its toolbar used to carry sits in one More menu (four items and More, and the
            // inspector's own toggle is `.macInspector`'s).
            if macEmbed != nil { macMoreMenu }
        }
    }

    @ToolbarContentBuilder
    private var macSheetToolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { if let original, original != doc { confirmingDiscard = true } else { dismiss() } }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }
        }
    }

    /// The design window's Layout, Sizes…, Safe Zones and Share, in one menu.
    private var macMoreMenu: some View {
        Menu {
            if let e = macEmbed {
                Menu("Layout") {
                    ForEach(e.layouts) { (item: MacArtworkLayout) in Button(item.label) { e.applyLayout(item.id) } }
                    if e.layouts.isEmpty { Text("Layouts are loading") }
                }
                ForEach(e.trailing.filter { (a: MacAction) in !e.shareExtras.contains { (x: MacAction) in x.id == a.id } }) { (a: MacAction) in
                    Button(a.title) { a.perform() }.disabled(!a.enabled)
                }
                if e.safeTop > 0 {
                    Toggle("Safe Zones", isOn: Binding(get: { e.showSafe }, set: { e.setSafe($0) }))
                }
                Divider()
            }
            Button("Share This Page…") { Task { await export() } }.disabled(busy)
            ForEach(macEmbed?.shareExtras ?? []) { (a: MacAction) in
                Button(a.title) { a.perform() }.disabled(!a.enabled)
            }
        } label: { Label("More", systemImage: "ellipsis.circle") }
            .help("Layout, sizes, safe zones, and sharing this page or every size")
    }

    // MARK: The menu bar

    /// The Design menu: the window's own actions (Publish…, Save, Sizes…, Export…) around the layer's. The layer's are disabled
    /// while nothing is picked; ⌫ answers only while the keyboard is on the page, so it never takes a word's letters.
    private var macMenu: MacRecordMenu {
        let hasPick = !selected.isEmpty
        let picked = layers.filter { selected.contains($0.s("id")) }
        let allLocked = !picked.isEmpty && picked.allSatisfy { $0["locked"].bool }
        var groups: [[MacAction]] = []
        groups.append(macEmbed?.leading ?? [])
        groups.append([
            MacAction("Duplicate Layer", symbol: "plus.square.on.square", shortcut: KeyboardShortcut("d", modifiers: .command), enabled: hasPick) {
                duplicate(layers.filter { selected.contains($0.s("id")) })
            },
            MacAction("Delete Layer", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: []), role: .destructive,
                      enabled: hasPick && macCanvasFocus) { macRemoveSelected() },
        ])
        groups.append([
            MacAction("Bring Forward", symbol: "square.2.layers.3d.top.filled", shortcut: KeyboardShortcut("f", modifiers: [.command, .option, .shift]), enabled: hasPick) { step(1) },
            MacAction("Send Backward", symbol: "square.2.layers.3d.bottom.filled", shortcut: KeyboardShortcut("b", modifiers: [.command, .option, .shift]), enabled: hasPick) { step(-1) },
            MacAction("Group", symbol: "square.on.square.dashed", shortcut: KeyboardShortcut("g", modifiers: [.command, .option]), enabled: hasPick) {
                set(["group": .string(UUID().uuidString)])
            },
            MacAction("Ungroup", symbol: "square.on.square", shortcut: KeyboardShortcut("g", modifiers: [.command, .option, .shift]), enabled: hasPick) {
                set(["group": .null])
            },
            MacAction(allLocked ? "Unlock" : "Lock", symbol: allLocked ? "lock.open" : "lock", shortcut: KeyboardShortcut("l", modifiers: .command), enabled: hasPick, id: "lock") {
                macToggleLock()
            },
        ])
        groups.append([
            MacAction("Zoom In", symbol: "plus.magnifyingglass", shortcut: KeyboardShortcut("=", modifiers: .command)) { macZoomBy(1.25) },
            MacAction("Zoom Out", symbol: "minus.magnifyingglass", shortcut: KeyboardShortcut("-", modifiers: .command)) { macZoomBy(0.8) },
            MacAction("Zoom to Fit", symbol: "arrow.up.left.and.down.right.magnifyingglass", shortcut: KeyboardShortcut("0", modifiers: .command)) { macZoom = 1 },
        ])
        groups.append(macEmbed?.trailing ?? [])
        return MacRecordMenu(title: "Design", groups: groups.filter { !$0.isEmpty })
    }

    private func macToggleLock() {
        let picked = layers.filter { selected.contains($0.s("id")) }
        guard !picked.isEmpty else { return }
        let lock = !picked.allSatisfy { $0["locked"].bool }
        var d = doc
        d["layers"] = .array(layers.map { (l: MarketingValue) -> MarketingValue in
            guard selected.contains(l.s("id")) else { return l }
            var n = l
            n["locked"] = .bool(lock)
            return n
        })
        change(d)
    }

    private func macRemoveSelected() {
        var d = doc
        d["layers"] = .array(layers.filter { !selected.contains($0.s("id")) || $0["locked"].bool })
        change(d)
        selected = []
    }

    private func macZoomBy(_ factor: Double) { macZoom = min(8, max(0.25, macZoom * factor)) }

    // MARK: The page

    /// The design window's inspector is the kit's (`.macInspector`: its toggle, its remembered state, its column width); a sheet
    /// has no window of its own to hold one, so there the pane sits beside the page and gives way before the page does.
    @ViewBuilder
    private var macWorkbench: some View {
        if macEmbed != nil {
            macCanvasArea
                .macInspector { macInspectorPane }
        } else {
            HStack(spacing: 0) {
                macCanvasArea
                Divider()
                macInspectorPane.frame(minWidth: 260, idealWidth: 300, maxWidth: 360)
            }
        }
    }

    private var macCanvasArea: some View {
        GeometryReader { avail in
            let availW = Double(avail.size.width), availH = Double(avail.size.height)
            let fit = max(0.05, min((availW - 56) / max(1, pageWidth), (availH - 56) / max(1, height)))
            let scale = fit * macZoom * macPinch
            ScrollView([.horizontal, .vertical]) {
                macPage(width: pageWidth * scale, height: height * scale)
                    .padding(28)
                    .frame(minWidth: avail.size.width, minHeight: avail.size.height)
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .macScrollZoom { (factor: Double) in macZoomBy(factor) }
        .simultaneousGesture(
            MagnifyGesture()
                .onChanged { (v: MagnifyGesture.Value) in macPinch = Double(v.magnification) }
                .onEnded { (v: MagnifyGesture.Value) in macZoom = min(8, max(0.25, macZoom * Double(v.magnification))); macPinch = 1 }
        )
        .focusable()
        .focused($macCanvasFocus)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { (press: KeyPress) in macKey(press) }
    }

    private func macPage(width w: Double, height h: Double) -> some View {
        preview
            .frame(width: w, height: h)
            .overlay { macSafeZones }
            .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
    }

    @ViewBuilder
    private var macSafeZones: some View {
        if let e = macEmbed, e.showSafe, e.safeTop > 0 {
            MacArtworkSafeZones(top: e.safeTop, bottom: e.safeBottom)
        }
    }

    /// The arrows move what is picked a point (⇧: ten); the editor's `nudge` moves it four points per step.
    private func macKey(_ press: KeyPress) -> KeyPress.Result {
        guard !selected.isEmpty else { return .ignored }
        let step = press.modifiers.contains(.shift) ? 10.0 : 1.0
        switch press.key {
        case .leftArrow: nudge(-step / 4, 0)
        case .rightArrow: nudge(step / 4, 0)
        case .upArrow: nudge(0, -step / 4)
        case .downArrow: nudge(0, step / 4)
        default: return .ignored
        }
        return .handled
    }

    /// A click on a layer's box: it is picked (⇧ adds it to the pick) and the inspector turns to it.
    func macClick(_ id: String) {
        select(id, multiple: NSEvent.modifierFlags.contains(.shift))
        macCanvasFocus = true
        if macPane == "page" { macPane = "layer" }
    }

    /// A double-click on a layer's box: a text layer's words take the keyboard in the inspector. A layer bound to the piece's
    /// words (the headline) sends the keyboard to that field in the Words tab.
    func macEditWords(_ id: String) {
        select(id, multiple: false)
        guard let l = layers.first(where: { $0.s("id") == id }), l.s("kind") == "text" else { return }
        let bound = l.s("bind")
        let embed = macEmbed
        macInspectorShown = true
        if !bound.isEmpty, let embed {
            macPane = embed.tabs.contains(where: { $0.id == "words" }) ? "words" : "layer"
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(120))
                embed.focusWord(bound)
            }
            return
        }
        macPane = "layer"
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(120))
            macTextFocus = true
        }
    }

    /// A drag on the page's empty part: a rectangle that picks every layer it touches.
    func macMarqueeGesture(scale: Double) -> some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { (v: DragGesture.Value) in
                macMarquee = CGRect(x: min(v.startLocation.x, v.location.x), y: min(v.startLocation.y, v.location.y),
                                    width: abs(v.location.x - v.startLocation.x), height: abs(v.location.y - v.startLocation.y))
            }
            .onEnded { (v: DragGesture.Value) in
                let rect = CGRect(x: min(v.startLocation.x, v.location.x), y: min(v.startLocation.y, v.location.y),
                                  width: abs(v.location.x - v.startLocation.x), height: abs(v.location.y - v.startLocation.y))
                macMarquee = nil
                var ids = Set<String>()
                for b in response["boxes"].array {
                    let id = b.s("id")
                    let box = CGRect(x: b.n("x") * scale, y: b.n("y") * scale, width: b.n("w") * scale, height: b.n("h") * scale)
                    guard box.intersects(rect), let l = layers.first(where: { $0.s("id") == id }), !l["hidden"].bool else { continue }
                    ids.insert(id)
                }
                selected = ids
                macCanvasFocus = true
            }
    }

    // MARK: The inspector

    private var macTabs: [MacArtworkTab] {
        [MacArtworkTab(id: "layer", title: "Layer", symbol: "square.stack.3d.up")]
            + (macEmbed?.tabs ?? [])
            + [MacArtworkTab(id: "page", title: "Page", symbol: "doc")]
    }

    private var macInspectorPane: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $macPane) {
                ForEach(macTabs) { (t: MacArtworkTab) in
                    Label(t.title, systemImage: t.symbol).labelStyle(.iconOnly).help(t.title).tag(t.id)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            Divider()
            macPaneBody
        }
        .frame(maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder
    private var macPaneBody: some View {
        if macPane == "page" {
            macPagePane
        } else if let tab = macEmbed?.tabs.first(where: { $0.id == macPane }), let content = tab.content {
            content
        } else {
            macLayerPane
        }
    }

    // MARK: Layer

    @ViewBuilder
    private var macLayerPane: some View {
        Form {
            if let layer {
                macLayerSections(layer)
            } else if let style = selectionStyle {
                Section("Blend and effects · \(selected.count) selected") { ArtworkEffectsRows(layer: style, fold: fold) }
            } else {
                Section { Text("Click a layer on the page to change it, or drag across the page to pick several.").foregroundStyle(.secondary) }
            }
            if !selected.isEmpty { Section { selectionTools } }
            Section("Layers · \(layers.count)") { macLayerList }
        }
        .formStyle(.grouped)
    }

    /// A layer's own settings: the iPhone's `controls`, with a Mac form's plain headers and its words as a field the keyboard can be sent to.
    @ViewBuilder
    private func macLayerSections(_ l: Binding<MarketingValue>) -> some View {
        Section(name(l.wrappedValue)) {
            if l.wrappedValue["locked"].bool {
                Button("Unlock") { l.wrappedValue["locked"] = .bool(false) }
            } else {
                if !l.wrappedValue.s("bind").isEmpty {
                    Text("Uses the piece’s \(l.wrappedValue.s("bind")); edit it on the piece.").font(.callout).foregroundStyle(.secondary)
                    Button("Make Independent Text") { let key = l.wrappedValue.s("bind"); l.wrappedValue["text"] = .string(fields[key] ?? ""); l.wrappedValue["bind"] = .null }
                }
                if l.wrappedValue.s("kind") == "text" {
                    if l.wrappedValue.s("bind").isEmpty {
                        TextField("Words", text: Binding(get: { l.wrappedValue.s("text") }, set: { (v: String) in fold("text") { l.wrappedValue["text"] = .string(v) } }), axis: .vertical)
                            .lineLimit(1...6)
                            .focused($macTextFocus)
                    }
                    let font = l.wrappedValue.s("font", "regular")
                    Picker("Font", selection: Binding(get: { font }, set: { l.wrappedValue["font"] = .string($0) })) {
                        ForEach(ArtworkFont.faces, id: \.0) { Text($0.label).tag($0.id) }
                        if !ArtworkFont.faces.contains(where: { $0.id == font }) { Text(ArtworkFont.label(font)).tag(font) }
                    }
                }
                ArtworkProperties(value: l, keys: genericKeys(l.wrappedValue).filter { $0 != "text" })
                macTextRows(l)
                macImageRows(l)
                macShapeRows(l)
            }
        }
        if !l.wrappedValue["locked"].bool {
            Section("Blend and effects") { ArtworkEffectsRows(layer: l, fold: fold) }
            if l.wrappedValue.s("kind") == "text" {
                Section("Rich text") {
                    ArtworkRunsRows(layer: l, words: l.wrappedValue.s("bind").isEmpty ? l.wrappedValue.s("text") : (fields[l.wrappedValue.s("bind")] ?? ""), fold: fold).id(l.wrappedValue.s("id"))
                }
            }
            if l.wrappedValue.s("kind") == "qr" {
                Section("QR code") { ArtworkQRRows(layer: l, fold: fold) }
            }
        }
    }

    @ViewBuilder
    private func macTextRows(_ l: Binding<MarketingValue>) -> some View {
        if l.wrappedValue.s("kind") == "text" {
            ArtworkTextEffectRows(layer: l, fold: fold)
            Toggle("Text box", isOn: Binding(get: { l.wrappedValue["box"] != .null }, set: { l.wrappedValue["box"] = $0 ? MarketingValue(["color": "#FFFFFF", "radius": 24, "pad": 20]) : .null }))
            ArtworkProperties(value: l, keys: ["box"])
            Button("Underline") { l.wrappedValue["underline"] = .bool(!l.wrappedValue["underline"].bool) }
            if l.wrappedValue["curve"] == .null { Button("Bend Text") { l.wrappedValue["curve"] = .number(20) } }
        }
    }

    @ViewBuilder
    private func macImageRows(_ l: Binding<MarketingValue>) -> some View {
        if l.wrappedValue.s("kind") == "image" {
            filters(l)
            Toggle("Cut out (transparent background)", isOn: Binding(get: { l.wrappedValue["cutout"].bool }, set: { on in if on { l.wrappedValue["cutout"] = .bool(true) } else { l.wrappedValue.artworkDrop("cutout") } }))
            if l.wrappedValue["h"] != .null {
                ArtworkSlider(title: "Zoom in frame", value: Binding(get: { l.wrappedValue.n("iz", 1) }, set: { l.wrappedValue["iz"] = .number($0) }), range: 1...4, step: 0.05, format: "%.2f×")
            }
            ArtworkShadeControls(shade: l.wrappedValue["shade"]) { v, key in
                let id = l.wrappedValue.s("id")
                var d = doc; d["layers"] = .array(layers.map { var n = $0; if n.s("id") == id { n["shade"] = v }; return n })
                change(d, key: key.map { "shade-\(id)-" + $0 })
            }
            Picker("Frame", selection: Binding(get: { l.wrappedValue.s("mask") }, set: { l.wrappedValue["mask"] = $0.isEmpty ? .null : .string($0) })) {
                Text("Rectangle").tag("")
                ForEach(catalogue["masks"].array, id: \.text) { Text(ArtworkProperties.label($0.string)).tag($0.string) }
            }
        }
    }

    @ViewBuilder
    private func macShapeRows(_ l: Binding<MarketingValue>) -> some View {
        if ["shape", "rect", "circle"].contains(l.wrappedValue.s("kind")) {
            Toggle("Filled shape", isOn: Binding(get: { l.wrappedValue["fill"] != .null }, set: { l.wrappedValue["fill"] = $0 ? .string("#FFFFFF") : .null }))
            if l.wrappedValue["fill"] != .null { ArtworkProperties(value: l, keys: ["fill"]) }
            Toggle("Gradient fill", isOn: Binding(get: { l.wrappedValue["fill2"] != .null }, set: { l.wrappedValue["fill2"] = $0 ? .string("#111111") : .null }))
            Toggle("Multi-stop gradient fill", isOn: Binding(get: { l.wrappedValue["fillGradient"] != .null }, set: { on in
                if on { l.wrappedValue["fillGradient"] = ArtworkGradients.foils[0].gradient } else { l.wrappedValue.artworkDrop("fillGradient") }
            }))
            if l.wrappedValue["fillGradient"] != .null {
                ArtworkGradientRows(gradient: Binding(get: { l.wrappedValue["fillGradient"] }, set: { l.wrappedValue["fillGradient"] = $0 }), fold: fold)
            }
        }
    }

    // MARK: The layers

    @ViewBuilder
    private var macLayerList: some View {
        let all = layers
        if all.isEmpty { Text("Nothing on the page yet. Use Add in the toolbar.").foregroundStyle(.secondary) }
        ForEach(Array(all.enumerated().reversed()), id: \.offset) { (pair: (offset: Int, element: MarketingValue)) in
            macLayerRow(pair.element)
        }
    }

    private func macLayerRow(_ l: MarketingValue) -> some View {
        let id = l.s("id")
        let on = selected.contains(id)
        return HStack(spacing: 8) {
            Image(systemName: macSymbol(l.s("kind"))).frame(width: 18).foregroundStyle(.secondary)
            Text(name(l)).lineLimit(1)
            Spacer(minLength: 4)
            if l["locked"].bool { Image(systemName: "lock.fill").font(.caption).foregroundStyle(.secondary) }
            if l["hidden"].bool { Image(systemName: "eye.slash").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 4)
        .background(on ? Theme.accent.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { macClick(id) }
        .contextMenu { macLayerMenu(id, l) }
    }

    private func macSymbol(_ kind: String) -> String {
        switch kind {
        case "text": return "textformat"
        case "image": return "photo"
        case "wordmark": return "t.square"
        case "qr": return "qrcode"
        case "line", "arrow": return "line.diagonal"
        case "circle": return "circle"
        default: return "square"
        }
    }

    // MARK: Page

    @ViewBuilder
    private var macPagePane: some View {
        Form {
            Section("Page") {
                LabeledContent("Size", value: "\(Int(pageWidth)) × \(Int(height))")
                macLayoutMenu
                Menu("Colours") { ForEach(catalogue["palettes"].array, id: \.text) { p in Button(p.s("label")) { act("palette", "", ["palette": p.s("id")]) } } }
                if !clipboard.layers.isEmpty {
                    Button("Paste Copied Layers") { act("carry", "", ["layers": clipboard.layers.map(\.any), "fromFrame": clipboard.frame.any]) }
                }
            }
            if let e = macEmbed, e.safeTop > 0 {
                Section("Safe zones") {
                    Toggle("Show the bands Instagram covers", isOn: Binding(get: { e.showSafe }, set: { e.setSafe($0) }))
                }
            }
            Section("Background") {
                Picker("Photo", selection: Binding(get: { doc["bg"].s("photoId") }, set: { var d = doc; d["bg"]["photoId"] = $0.isEmpty ? .null : .string($0); change(d) })) {
                    Text("No photo").tag("")
                    ForEach(photos.keys.sorted(), id: \.self) { Text(photoName($0)).tag($0) }
                }
                ArtworkProperties(value: nested("bg"), keys: ["color", "color2", "dim", "gradient"])
                ArtworkProperties(value: placement, keys: ["mode", "zoom", "focusX", "focusY"])
                macBackgroundRows
            }
            Section("Guides and grid") { ArtworkGuideRows(doc: Binding(get: { doc }, set: { change($0) })) }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private var macBackgroundRows: some View {
        if !doc["bg"].s("photoId").isEmpty {
            ArtworkShadeControls(shade: doc["bg"]["shade"]) { v, key in var d = doc; d["bg"]["shade"] = v; change(d, key: key.map { "bg-shade-" + $0 }) }
        }
        filters(nested("bg"))
        Button("Add Background Gradient") { var d = doc; d["bg"]["color2"] = .string("#111111"); change(d) }
        Toggle("Multi-colour gradient base", isOn: Binding(get: { doc["bg"]["fill"] != .null }, set: { on in
            var d = doc
            if on { d["bg"]["fill"] = ArtworkGradients.make(angle: 180, [ArtworkStop(at: 0, color: doc["bg"].s("color", "#EDE6DA"), alpha: nil), ArtworkStop(at: 1, color: doc["bg"].s("color2", "#111111"), alpha: nil)]) }
            else { var bg = d["bg"]; bg.artworkDrop("fill"); d["bg"] = bg }
            change(d)
        }))
        if doc["bg"]["fill"] != .null {
            ArtworkGradientRows(gradient: Binding(get: { doc["bg"]["fill"] }, set: { g in var d = doc; d["bg"]["fill"] = g; change(d) }), fold: fold)
        }
    }

    /// The design window's layouts (the same list as its toolbar), or, in a sheet, the editor's own for this shape of page.
    @ViewBuilder
    private var macLayoutMenu: some View {
        if let e = macEmbed {
            Menu("Layout") {
                ForEach(e.layouts) { (item: MacArtworkLayout) in Button(item.label) { e.applyLayout(item.id) } }
                if e.layouts.isEmpty { Text("Layouts are loading") }
            }
        } else {
            Menu("Layout") {
                let group = layoutGroup ?? (ad ? "templates" : (height < 1400 ? "squares" : "presets"))
                let action = layoutGroup != nil ? "square" : ad ? "ad" : (height < 1400 ? "square" : "preset")
                ForEach(catalogue[group].array, id: \.text) { i in Button(i.s("label")) { act(action, i.s("id")) } }
            }
        }
    }

    // MARK: Keys and the right-click menu (the sheet's; the design window's are the Design menu's)

    /// Keys for the sheet: duplicate, remove (asks), a step up or down the stack, nudge by ⌥ and an arrow.
    @ViewBuilder
    var macShortcuts: some View {
        Group {
            Button("Duplicate") { duplicate(layers.filter { selected.contains($0.s("id")) }) }.keyboardShortcut("d", modifiers: .command)
            Button("Remove") { removing = true }.keyboardShortcut(.delete, modifiers: .command)
            Button("Bring forward") { step(1) }.keyboardShortcut("f", modifiers: [.command, .option, .shift])
            Button("Send backward") { step(-1) }.keyboardShortcut("b", modifiers: [.command, .option, .shift])
            Button("Nudge left") { nudge(-1, 0) }.keyboardShortcut(.leftArrow, modifiers: .option)
            Button("Nudge right") { nudge(1, 0) }.keyboardShortcut(.rightArrow, modifiers: .option)
            Button("Nudge up") { nudge(0, -1) }.keyboardShortcut(.upArrow, modifiers: .option)
            Button("Nudge down") { nudge(0, 1) }.keyboardShortcut(.downArrow, modifiers: .option)
        }
        .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true).disabled(selected.isEmpty)
    }

    /// The chosen layers a few points over (⌥ and an arrow, or an arrow on the page), one undo step for a run of them.
    private func nudge(_ dx: Double, _ dy: Double) {
        var d = doc
        d["layers"] = .array(layers.map { l in
            guard selected.contains(l.s("id")), !l["locked"].bool else { return l }
            var n = l; n["x"] = .number(l.n("x") + dx * 4); n["y"] = .number(l.n("y") + dy * 4); n["flow"] = .null
            return n
        })
        change(d, key: "nudge-" + selected.sorted().joined(separator: ","))
    }

    /// Right-click on a layer's box on the artwork, or on its row in the list.
    @ViewBuilder
    func macLayerMenu(_ id: String, _ l: MarketingValue) -> some View {
        // Two groups: a ViewBuilder block holds at most ten views.
        Group {
            Button("Select") { select(id, multiple: false) }
            Button("Select Together") { select(id, multiple: true) }
            Divider()
            Button("Duplicate") { select(id, multiple: false); duplicate(layers.filter { $0.s("id") == id }) }
            Button(l["locked"].bool ? "Unlock" : "Lock") { patch(id, ["locked": .bool(!l["locked"].bool)]) }
            Button(l["hidden"].bool ? "Show" : "Hide") { patch(id, ["hidden": .bool(!l["hidden"].bool)]) }
        }
        Group {
            Divider()
            Button("Bring Forward") { select(id, multiple: false); step(1) }
            Button("Send Backward") { select(id, multiple: false); step(-1) }
            Divider()
            Button(macEmbed == nil ? "Remove…" : "Remove", role: .destructive) {
                select(id, multiple: false)
                if macEmbed == nil { removing = true } else { macRemoveSelected() }
            }
        }
    }
}
#endif
