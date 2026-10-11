import SwiftUI

/// The designer on one board design (board.tsx FrameEditor): its words, its layout and every layer, drawn by the
/// shared engine; saved back to the board as one `put`, which the server applies over whatever else changed.
struct StudioBoardEditor: View {
    let frameID: String
    let board: StudioBoardModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var doc = MarketingValue.null
    @State private var fields: [String: String] = [:]
    @State private var template = "headline"
    @State private var label = ""
    @State private var photos: [String: Data] = [:]
    @State private var ready = false
    @State private var preview: UIImage?
    @State private var problem: String?
    @State private var editing = false

    private var frame: MarketingValue { board.frame(frameID) ?? .null }
    private var renderKey: String { doc.text + MarketingValue(fields).text }
    /// Layers carrying an uploaded picture: a board keeps only library photos (board-shape.ts cleanDoc drops them).
    private var uploads: Int { doc["layers"].array.filter { $0.s("kind") == "image" && $0["src"] != .null }.count }

    var body: some View {
        NavigationStack {
            Group {
                if sizeClass == .regular {
                    HStack(spacing: 0) {
                        picture.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.ground)
                        Divider()
                        form.frame(width: 420)
                    }
                } else {
                    form
                }
            }
            .navigationTitle(label.isEmpty ? "Design" : label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save to the board") { save() }.disabled(!ready) }
            }
            .sheet(isPresented: $editing) { ArtworkEditor(doc: $doc, photos: photos, fields: fields, ad: true) }
        }
        .presentationSizing(.page)
        .task { await load() }
        .task(id: renderKey) { await draw() }
    }

    @ViewBuilder private var picture: some View {
        if let preview { Image(uiImage: preview).resizable().scaledToFit().frame(maxHeight: sizeClass == .regular ? .infinity : 420).frame(maxWidth: .infinity) }
        else if let problem { Label(problem, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary) }
        else { SkeletonLoading(ready ? "Drawing" : "Fetching the photo").frame(height: 260) }
    }

    private var form: some View {
        Form {
            if sizeClass != .regular { Section { picture }.houseRows() }
            Section {
                TextField("Design name", text: $label)
                Text(board.formatInfo(frame.s("format", "portrait")).s("label")).font(.footnote).foregroundStyle(.secondary)
            }.houseRows()
            Section {
                TextField("Small line", text: binding("kicker"))
                TextField("Headline on the picture", text: binding("headline"), axis: .vertical)
                TextField("Specs", text: binding("weight"), axis: .vertical)
                TextField("Call to action", text: binding("details"), axis: .vertical)
            } header: { LedgerHeading(title: "Words") }.houseRows()
            Section {
                Picker("Layout", selection: $template) {
                    ForEach(board.catalogue["templates"].array.map { $0.s("id") }, id: \.self) { Text(board.templateLabel($0)).tag($0) }
                }
                .onChange(of: template) { old, new in if ready && old != new { Task { await apply(new) } } }
                Button("Edit layers and crop", systemImage: "slider.horizontal.3") { editing = true }.disabled(!ready)
                if uploads > 0 {
                    Text("\(uploads) uploaded picture\(uploads == 1 ? "" : "s") won’t be kept: a board holds library photos only.").font(.footnote).foregroundStyle(.orange)
                }
            } header: { LedgerHeading(title: "Layout") }.houseRows()
        }
        .modifier(HouseGround())
        .websiteBusy(ready ? nil : "Opening the design…")
    }

    private func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0 }) }

    private func load() async {
        let f = frame
        guard f != .null else { problem = "This design is no longer on the board."; return }
        fields = board.fields(f); template = f.s("template", "headline"); label = f.s("label")
        do {
            photos = try await board.photoSet(f)
            doc = f["doc"] != .null ? f["doc"] : try await board.layOut(f, photos: photos)
            ready = true
        } catch { problem = error.localizedDescription; ready = f["doc"] != .null; if ready { doc = f["doc"] } }
    }

    private func draw() async {
        guard doc != .null else { return }
        do {
            let r = try await board.engine.run(doc: doc, photos: photos, fields: fields, options: ["px": 900])
            guard !Task.isCancelled else { return }
            preview = NativeArtwork.image(r); problem = nil
        } catch { if !Task.isCancelled { problem = error.localizedDescription } }
    }

    /// Another layout over the same document (the page's onPreset): the shape stays, the words and photo carry over.
    private func apply(_ id: String) async {
        do {
            let r = try await board.engine.run(doc: doc, photos: photos, fields: fields, options: ["action": "ad", "value": id, "photoMarked": frame["marked"].bool])
            doc = r["doc"]
        } catch { problem = error.localizedDescription }
    }

    private func save() {
        var clean = doc
        clean["layers"] = .array(doc["layers"].array.filter { !($0.s("kind") == "image" && $0["src"] != .null) })
        let patch: [String: Any] = ["doc": clean.any, "fields": fields, "template": template, "label": label.trimmingCharacters(in: .whitespacesAndNewlines), "by": "page"]
        let id = frameID
        Task { await board.change([["op": "put", "id": id, "patch": patch]]) }
        dismiss()
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
                    Picker("Shape", selection: $format) {
                        ForEach(board.formats.map { $0.s("id") }, id: \.self) { Text(board.formatInfo($0).s("label", $0)).tag($0) }
                    }
                    .pickerStyle(.menu)
                    if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
                    if let items {
                        if items.isEmpty { Text("Nothing matches.").foregroundStyle(.secondary) }
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
                                .accessibilityLabel("Add " + item.s("name"))
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
            .navigationTitle("Add a photo").navigationBarTitleDisplayMode(.inline)
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
