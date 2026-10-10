import SwiftUI
import PhotosUI

struct ArtworkEditor: View {
    @Binding var doc: MarketingValue
    let photos: [String: Data]
    let fields: [String: String]
    var ad = false
    @Environment(\.dismiss) private var dismiss
    @State private var engine = NativeArtwork()
    @State private var response = MarketingValue.null
    @State private var selected: Set<String> = []
    @State private var undo: [MarketingValue] = []
    @State private var redo: [MarketingValue] = []
    @State private var dragStart: MarketingValue?
    @State private var problem: String?
    @State private var importing: PhotosPickerItem?
    @State private var busy = false
    @State private var share: MarketingFileShare?
    @State private var clipboard = ArtworkClipboard.shared
    @State private var resizing: MarketingValue?
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
        NavigationStack {
            Form {
                Section { preview.listRowInsets(EdgeInsets()); if let problem { Text(problem).foregroundStyle(.red).font(.footnote) } }.houseRows()
                Section {
                    Menu("Add") { addMenu }
                    Menu("Layout") {
                        let group = ad ? "templates" : (height < 1400 ? "squares" : "presets")
                        ForEach(catalogue[group].array, id: \.text) { i in Button(i.s("label")) { act(ad ? "ad" : (height < 1400 ? "square" : "preset"), i.s("id")) } }
                    }
                    Menu("Colours") { ForEach(catalogue["palettes"].array, id: \.text) { p in Button(p.s("label")) { act("palette", "", ["palette": p.s("id")]) } } }
                    if !selected.isEmpty { selectionTools }
                    if !clipboard.layers.isEmpty { Button("Paste copied layers") { act("carry", "", ["layers": clipboard.layers.map(\.any), "fromFrame": clipboard.frame.any]) } }
                }.houseRows()
                if let layer { controls(layer) }
                Section {
                    DisclosureGroup("Background and crop") {
                        Picker("Photo", selection: Binding(get: { doc["bg"].s("photoId") }, set: { var d = doc; d["bg"]["photoId"] = $0.isEmpty ? .null : .string($0); change(d) })) {
                            Text("No photo").tag(""); ForEach(photos.keys.sorted(), id: \.self) { Text(photoName($0)).tag($0) }
                        }
                        ArtworkProperties(value: nested("bg"), keys: ["color", "color2", "dim", "gradient"])
                        ArtworkProperties(value: placement, keys: ["mode", "zoom", "focusX", "focusY"])
                        filters(nested("bg"))
                        Button("Add background gradient") { var d = doc; d["bg"]["color2"] = .string("#111111"); change(d) }
                    }
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
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button { history(true) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }.disabled(undo.isEmpty)
                        Button { history(false) } label: { Label("Redo", systemImage: "arrow.uturn.forward") }.disabled(redo.isEmpty)
                        Button { Task { await export() } } label: { Label("Share", systemImage: "square.and.arrow.up") }.disabled(busy)
                    }
                }.task(id: doc.text + fields.sorted(by: { $0.key < $1.key }).description) { await render() }
                .onChange(of: importing) { _, item in if let item { Task { await take(item) } } }
                .sheet(item: $share) { MarketingShareSheet(items: $0.items) }.websiteBusy(busy ? "Preparing…" : nil)
        }
    }
    private var preview: some View {
        GeometryReader { g in
            let scale = g.size.width / pageWidth
            ZStack(alignment: .topLeading) {
                if let image = NativeArtwork.image(response) { Image(uiImage: image).resizable().scaledToFit().onTapGesture { selected = [] } } else { SkeletonLoading().frame(maxWidth: .infinity, maxHeight: .infinity) }
                ForEach(response["boxes"].array, id: \.text) { b in
                    let id = b.s("id"), l = layers.first { $0.s("id") == id } ?? .null
                    if !l["hidden"].bool {
                        Rectangle().fill(.clear).overlay { if selected.contains(id) { Rectangle().stroke(Theme.accent, lineWidth: 2) } }.contentShape(Rectangle())
                            .frame(width: max(22, b.n("w") * scale), height: max(22, b.n("h") * scale)).rotationEffect(.degrees(l.n("rotate")))
                            .offset(x: b.n("x") * scale, y: b.n("y") * scale)
                            .onTapGesture { select(id, multiple: false) }.onLongPressGesture { select(id, multiple: true) }
                            .gesture(DragGesture(minimumDistance: 3).onChanged { v in
                                guard !l["locked"].bool else { return }
                                if dragStart == nil { select(id, multiple: false); dragStart = response["doc"] == .null ? doc : response["doc"] }
                                guard let start = dragStart else { return }
                                doc["layers"] = .array(start["layers"].array.map { source in
                                    guard selected.contains(source.s("id")), !source["locked"].bool else { return source }
                                    var n = source; n["x"] = .number(source.n("x") + v.translation.width / scale); n["y"] = .number(source.n("y") + v.translation.height / scale); n["flow"] = .null; return n
                                })
                            }.onEnded { _ in if let start = dragStart, start != doc { undo.append(start); redo = [] }; dragStart = nil }).accessibilityLabel(name(l))
                    }
                }
            }
        }.aspectRatio(pageWidth / height, contentMode: .fit)
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
        Menu("Full logo") { Button("Top right") { act("mark", "top") }; Button("Bottom right") { act("mark", "bottom") } }
        Menu("Photo inset") {
            ForEach(photos.keys.sorted(), id: \.self) { key in Menu(photoName(key)) {
                Button("Rectangle") { act("image", "", ["photoId": key]) }
                ForEach(catalogue["masks"].array, id: \.text) { m in Button(ArtworkProperties.label(m.string)) { act("image", m.string, ["photoId": key]) } }
            } }
        }
        PhotosPicker(selection: $importing, matching: .images) { Label("Upload image", systemImage: "photo.on.rectangle") }
        Button("Link pill") { act("link", "Ask us on WhatsApp") }
    }
    private var selectionTools: some View {
        Menu("Arrange · \(selected.count) selected") {
            Button("Select all") { selected = Set(layers.map { $0.s("id") }) }
            Button("Bring to front") { reorder(true) }; Button("Send to back") { reorder(false) }
            Button("Group") { set(["group": .string(UUID().uuidString)]) }; Button("Ungroup") { set(["group": .null]) }
            Button("Mirror across") { flip("flipX") }; Button("Mirror down") { flip("flipY") }
            Menu("Align to page") { alignMenu(page: true) }; if selected.count > 1 { Menu("Align selection") { alignMenu(page: false) } }
            if selected.count >= 3 { Button("Space evenly across") { act("distribute", "h") }; Button("Space evenly down") { act("distribute", "v") } }
            Button("Larger") { act("scale", "", ["factor": 1.1]) }; Button("Smaller") { act("scale", "", ["factor": 0.9]) }
            Button("Copy") { clipboard.layers = layers.filter { selected.contains($0.s("id")) }; clipboard.frame = doc["frame"]; clipboard.photos = photos }; Button("Duplicate") { duplicate(layers.filter { selected.contains($0.s("id")) }) }
            Button("Lock") { set(["locked": .bool(true)]) }
            Button("Remove", role: .destructive) { var d = doc; d["layers"] = .array(layers.filter { !selected.contains($0.s("id")) || $0["locked"].bool }); change(d); selected = [] }
        }
    }
    private func alignMenu(page: Bool) -> some View { ForEach(["left", "center", "right", "top", "middle", "bottom"], id: \.self) { key in Button(ArtworkProperties.label(key)) { act("align", key, ["toPage": page]) } } }
    @ViewBuilder private func controls(_ l: Binding<MarketingValue>) -> some View {
        Section {
            if l.wrappedValue["locked"].bool { Button("Unlock") { l.wrappedValue["locked"] = .bool(false) } }
            else {
                if !l.wrappedValue.s("bind").isEmpty {
                    Text("Uses the piece’s \(l.wrappedValue.s("bind")); edit it on the piece.").font(.footnote).foregroundStyle(.secondary)
                    Button("Make independent text") { let key = l.wrappedValue.s("bind"); l.wrappedValue["text"] = .string(fields[key] ?? ""); l.wrappedValue["bind"] = .null }
                }
                ArtworkProperties(value: l, keys: l.wrappedValue.object.keys.filter { !["id", "kind", "bind", "photoId", "src", "mark", "flow", "group", "effect", "adjust", "box"].contains($0) }.sorted())
                if l.wrappedValue.s("kind") == "text" {
                    Picker("Text effect", selection: Binding(get: { l.wrappedValue["effect"].s("kind", "none") }, set: { kind in l.wrappedValue["effect"] = kind == "none" ? .null : MarketingValue(["kind": kind, "color": "#000000", "offset": 30, "angle": 45, "blur": 20, "thickness": 40, "transparency": 50]) })) { ForEach(catalogue["effects"].array, id: \.text) { Text($0.s("label")).tag($0.s("id")) } }
                    ArtworkProperties(value: Binding(get: { l.wrappedValue["effect"] }, set: { l.wrappedValue["effect"] = $0 }), keys: ["color", "offset", "angle", "blur", "thickness", "transparency"])
                    Toggle("Text box", isOn: Binding(get: { l.wrappedValue["box"] != .null }, set: { l.wrappedValue["box"] = $0 ? MarketingValue(["color": "#FFFFFF", "radius": 24, "pad": 20]) : .null }))
                    ArtworkProperties(value: l, keys: ["box"])
                    Button("Underline") { l.wrappedValue["underline"] = .bool(!l.wrappedValue["underline"].bool) }
                    if l.wrappedValue["curve"] == .null { Button("Bend text") { l.wrappedValue["curve"] = .number(20) } }
                }
                if l.wrappedValue.s("kind") == "image" { filters(l); Picker("Frame", selection: Binding(get: { l.wrappedValue.s("mask") }, set: { l.wrappedValue["mask"] = $0.isEmpty ? .null : .string($0) })) { Text("Rectangle").tag(""); ForEach(catalogue["masks"].array, id: \.text) { Text(ArtworkProperties.label($0.string)).tag($0.string) } } }
                if ["shape", "rect", "circle"].contains(l.wrappedValue.s("kind")) {
                    Toggle("Filled shape", isOn: Binding(get: { l.wrappedValue["fill"] != .null }, set: { l.wrappedValue["fill"] = $0 ? .string("#FFFFFF") : .null }))
                    if l.wrappedValue["fill"] != .null { ArtworkProperties(value: l, keys: ["fill"]) }
                    Toggle("Gradient fill", isOn: Binding(get: { l.wrappedValue["fill2"] != .null }, set: { l.wrappedValue["fill2"] = $0 ? .string("#111111") : .null }))
                }
            }
        } header: { Text(name(l.wrappedValue)) }.houseRows()
    }
    private func filters(_ v: Binding<MarketingValue>) -> some View {
        DisclosureGroup("Photo filters") {
            Menu("Choose filter") { ForEach(catalogue["filters"].array, id: \.text) { f in Button(f.s("label")) { v.wrappedValue["adjust"] = f["adjust"] } } }
            if v.wrappedValue["adjust"] == .null { Button("Adjust by hand") { v.wrappedValue["adjust"] = MarketingValue(["brightness": 0, "contrast": 0, "saturation": 0, "warmth": 0, "fade": 0, "vignette": 0]) } }
            ArtworkProperties(value: Binding(get: { v.wrappedValue["adjust"] }, set: { v.wrappedValue["adjust"] = $0 }), keys: ["brightness", "contrast", "saturation", "warmth", "fade", "vignette"])
        }
    }
    private func nested(_ key: String) -> Binding<MarketingValue> { Binding(get: { doc[key] }, set: { var d = doc; d[key] = $0; change(d) }) }
    private func name(_ l: MarketingValue) -> String { if !l.s("name").isEmpty { return l.s("name") }; if !l.s("bind").isEmpty { return ArtworkProperties.label(l.s("bind")) }; return l.s("text").isEmpty ? ArtworkProperties.label(l.s("kind")) : l.s("text") }
    private func photoName(_ key: String) -> String { "Photo \((photos.keys.sorted().firstIndex(of: key) ?? 0) + 1)" }
    private func select(_ id: String, multiple: Bool) { if multiple { if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }; return }; if selected.contains(id), selected.count > 1 { return }; let group = layers.first { $0.s("id") == id }?.s("group") ?? ""; selected = group.isEmpty ? [id] : Set(layers.filter { $0.s("group") == group }.map { $0.s("id") }) }
    private func change(_ d: MarketingValue) { guard d != doc else { return }; undo.append(doc); if undo.count > 80 { undo.removeFirst() }; redo = []; doc = d }
    private func history(_ back: Bool) { if back, let d = undo.popLast() { redo.append(doc); doc = d }; if !back, let d = redo.popLast() { undo.append(doc); doc = d } }
    private func patch(_ id: String, _ fields: [String: MarketingValue]) { var d = doc; d["layers"] = .array(layers.map { l in var n = l; if l.s("id") == id { for (k, v) in fields { n[k] = v } }; return n }); change(d) }
    private func set(_ fields: [String: MarketingValue]) { var d = doc; d["layers"] = .array(layers.map { l in var n = l; if selected.contains(l.s("id")), !l["locked"].bool { for (k, v) in fields { n[k] = v } }; return n }); change(d) }
    private func flip(_ key: String) { for l in layers where selected.contains(l.s("id")) && !l["locked"].bool { patch(l.s("id"), [key: .bool(!l[key].bool)]) } }
    private func reorder(_ front: Bool) { let kept = layers.filter { !selected.contains($0.s("id")) }, own = layers.filter { selected.contains($0.s("id")) }; var d = doc; d["layers"] = .array(front ? kept + own : own + kept); change(d) }
    private func duplicate(_ source: [MarketingValue]) { var groups: [String: String] = [:]; let made = source.map { l -> MarketingValue in var n = l; n["id"] = .string(UUID().uuidString); n["x"] = .number(l.n("x") + 24); n["y"] = .number(l.n("y") + 24); n["locked"] = .bool(false); let g = l.s("group"); if !g.isEmpty { groups[g] = groups[g] ?? UUID().uuidString; n["group"] = .string(groups[g]!) }; return n }; var d = doc; d["layers"] = .array(layers + made); change(d); selected = Set(made.map { $0.s("id") }) }
    private func act(_ action: String, _ value: String, _ extra: [String: Any] = [:]) { Task { do { var o = extra; o["action"] = action; o["value"] = value; o["selected"] = Array(selected); let r = try await engine.run(doc: doc, photos: allPhotos, fields: fields, options: o); change(r["doc"]); response = r; if !r["added"].array.isEmpty { selected = Set(r["added"].array.map(\.string)) }; problem = nil } catch { problem = error.localizedDescription } } }
    private func render() async { do { let r = try await engine.run(doc: doc, photos: allPhotos, fields: fields); guard !Task.isCancelled else { return }; response = r; problem = nil } catch { if !Task.isCancelled { problem = error.localizedDescription } } }
    private func take(_ item: PhotosPickerItem) async { defer { importing = nil }; do { guard let data = try await item.loadTransferable(type: Data.self), let jpeg = WebsitePhoto.jpegCopy(data), let image = UIImage(data: jpeg) else { throw ERPAPI.Failure(status: 0, message: "Choose a readable photo.") }; let n = MarketingValue(["id": UUID().uuidString, "kind": "image", "photoId": "", "src": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "x": 240, "y": height * 0.35, "w": 600, "h": 600 * image.size.height / image.size.width, "radius": 0, "rotate": 0, "opacity": 1, "shadow": false, "name": "Uploaded image"]); var d = doc; d["layers"] = .array(layers + [n]); change(d); selected = [n.s("id")] } catch { problem = error.localizedDescription } }
    private func export() async { busy = true; defer { busy = false }; do { let r = try await engine.run(doc: doc, photos: allPhotos, fields: fields, options: ["px": 1080]); guard let data = Data(base64Encoded: r.s("image")) else { return }; let url = FileManager.default.temporaryDirectory.appendingPathComponent("design-\(UUID().uuidString).jpg"); try data.write(to: url); share = MarketingFileShare(items: [url]) } catch { problem = error.localizedDescription } }
}
