import SwiftUI
import PhotosUI
import Observation

/// The start screen's choices (src/app/design/start.tsx): the kind, the sizes it starts with, the photograph and the words found.
@MainActor
@Observable
final class DesignStartModel {
    var kind = "piece"
    var sizes: [String] = DesignKinds.card("piece").sizes
    var customW = 4
    var customH = 5
    /// Words found (kicker, headline, weight, details) and the price, by the smart input.
    var fields: [String: String] = [:]
    var price = ""
    var photo: DesignStartPhoto?
    var sheet: DesignSheet?
    /// Pieces the smart input found beyond the one in use: they wait on the start screen for their own turn.
    var waiting: [DesignFound] = []
    /// Ads → Plan's "Make this" (?play=): the Ad starts at the play's shape(s), layout and goal (start.tsx `play`).
    var play: MarketingValue?
    /// Owner and marketing: the Ad kind is theirs, so a suggestion of it is taken only by them.
    var adsAllowed = false
    @ObservationIgnored var speak: ((Note) -> Void)?
    /// Starts a design from a request built elsewhere (a flat picture rebuilt as layers); the screen sets it.
    @ObservationIgnored var launch: ((DesignStartRequest) -> Void)?

    func say(_ title: String, detail: String = "", failed: Bool = false) { speak?(Note(title: title, detail: detail, failed: failed)) }

    func choose(_ k: String) {
        kind = k
        sizes = DesignKinds.card(k).sizes
        if k != "ad" { play = nil }
    }

    /// start.tsx playSizes: the play's format, and the 9:16 beside it when it goes out as a pair.
    func usePlay(_ p: MarketingValue) {
        play = p
        kind = "ad"
        let ids = [p.s("format")] + (p["pair"].bool && p.s("format") != "story" ? ["story"] : [])
        let valid = ids.filter { $0 != "custom" && DesignSizes.size($0) != nil }
        sizes = valid.isEmpty ? DesignKinds.card("ad").sizes : valid
    }

    func toggle(_ id: String) {
        if let i = sizes.firstIndex(of: id) { if sizes.count > 1 { sizes.remove(at: i) } }
        else { sizes.append(id) }
    }

    var choices: [DesignSizeChoice] { sizes.map { DesignSizeChoice(id: $0, customW: min(100, max(1, customW)), customH: min(100, max(1, customH))) } }
    var summary: String { choices.map { $0.size.ratio }.joined(separator: " + ") }

    var request: DesignStartRequest {
        var copy: [String: String] = [:]
        if !price.trimmingCharacters(in: .whitespaces).isEmpty { copy["price"] = price }
        let playing = kind == "ad" ? play : nil
        if let playing, !playing.s("goal").isEmpty { copy["goal"] = playing.s("goal") }
        return DesignStartRequest(kind: kind, sizes: choices, photo: photo, fields: fields, copy: copy, template: playing.map { $0.s("template", "headline") } ?? "headline")
    }

    /// PHASE 2: what the smart input found fills the form, as start.tsx `use` does: its words, its main photograph, its price,
    /// and the kind it suggests (an Ad only for owner and marketing: the caller checks).
    func apply(fields found: [String: String], price foundPrice: String = "", photo: DesignStartPhoto? = nil, kind suggested: String? = nil) {
        fields = found.filter { !$0.value.isEmpty }
        price = foundPrice
        if let photo { self.photo = photo }
        if let suggested, DesignKinds.valid.contains(suggested), adsAllowed || suggested != "ad" { choose(suggested) }
    }

    /// One found piece becomes the form (start.tsx `use`).
    func use(_ f: DesignFound) {
        apply(fields: f.fields, price: f.price, photo: f.photo, kind: f.kind)
    }
}

/// The three places a photograph comes from, as start photographs (start.tsx startPhotoFromSite, photos-section.tsx startPhotoFromWork).
@MainActor
enum DesignPhotoSources {
    /// A website piece. `data` when the picker already brought the photograph.
    static func site(_ p: MarketingValue, data: Data? = nil) -> DesignStartPhoto {
        let original = truthy(p["photoSource"])
        let id = p.s("id")
        var fields: [String: String] = ["headline": headline(of: p.s("name"))]
        let collection = p.s("collection")
        fields["kicker"] = !collection.isEmpty && collection != "Website" ? collection : ""
        let facts = p["facts"].array.map(\.string).filter { !$0.isEmpty }
        if !facts.isEmpty { fields["weight"] = facts.joined(separator: " · ") }
        return DesignStartPhoto(
            label: p.s("name"),
            load: {
                if let data { return data }
                return try await ERPAPI.shared.data("/api/website/site-pieces/image?id=\(AdsQuery.escape(id))&size=3000" + (original ? "&original=1" : ""))
            },
            // `siteFrom`: a piece with a separate source photograph says whether it carries the marks; one without carries them.
            marked: original ? p["sourceMarked"].bool : true,
            fields: fields,
            source: ["siteId": id])
    }

    /// A library photograph (owner and marketing).
    static func library(_ a: MarketingValue) -> DesignStartPhoto {
        let original = a["original"] != .null ? a["original"].s("id") : ""
        let id = a.s("id")
        var fields: [String: String] = [:]
        let assessed = a["assessment"].s("headline")
        fields["headline"] = assessed.isEmpty ? a.s("name") : assessed
        fields["kicker"] = a.s("source") == "site" && a.s("collection") != "Website" ? a.s("collection") : ""
        if !a.s("specs").isEmpty { fields["weight"] = a.s("specs") }
        return DesignStartPhoto(
            label: a.s("name", "Photo"),
            load: {
                if !original.isEmpty, let data = try? await ERPAPI.shared.data("/api/ads/studio/image?id=\(AdsQuery.escape(original))&size=2048") { return data }
                return try await ERPAPI.shared.data("/api/ads/studio/image?id=\(AdsQuery.escape(id))&size=2048")
            },
            // A clean Drive original carries no mark; the site's own photo, or one with burned-in lettering, does.
            marked: original.isEmpty && (a.s("source") == "site" || a["assessment"]["burnedText"].bool),
            fields: fields,
            source: ["assetId": id])
    }

    static func device(_ data: Data, name: String) -> DesignStartPhoto { DesignStartPhoto(label: name, load: { data }) }

    /// lib/website/site-photo.ts headlineOf: a camera file name is no headline.
    static func headline(of name: String) -> String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty { return "" }
        if n.range(of: "^(dsc|img|pxl|photo|image|mvimg|whatsapp image)[\\s_-]*[\\d_ -]*$", options: [.regularExpression, .caseInsensitive]) != nil { return "" }
        if n.range(of: "^[\\d\\s_-]+$", options: .regularExpression) != nil { return "" }
        return n
    }

    private static func truthy(_ v: MarketingValue) -> Bool {
        switch v {
        case .null: return false
        case .string(let s): return !s.isEmpty
        case .bool(let b): return b
        case .number(let n): return n != 0
        default: return true
        }
    }
}

// MARK: The start screen

struct DesignStartView: View {
    @Bindable var start: DesignStartModel
    let access: DesignAccess
    let role: String
    let shelf: DesignShelf
    let starting: Bool
    /// To the Photos section, which hands a photograph back.
    let onBrowse: () -> Void
    let onBegin: () -> Void
    let onOpenDraft: (DesignDraftRow) -> Void
    let onOpenSaved: (DesignRecord) -> Void
    let onSeeAll: () -> Void

    @State private var picked: PhotosPickerItem?
    @State private var sitePicker = false
    @State private var camera = false
    @State private var problem: String?
    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    private var cards: [DesignKindCard] { DesignKinds.cards.filter { access.ads || !$0.ads } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                anything
                making
                photograph
                investments
                leftOff
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .readableColumn(760)
        .keyboardDone()
        // The one primary action stays at the foot, below the choices that decide it (rule 16).
        .actionBar(primary: .init("Continue", isBusy: starting, action: onBegin))
        // "Where you left off" reads the shelf and the phone's drafts each time the start screen comes up.
        .task { await shelf.load(); await shelf.loadDrafts() }
        .onAppear { start.adsAllowed = access.ads }
        .onChange(of: picked) { _, item in if let item { Task { await take(item) } } }
        .sheet(isPresented: $sitePicker) {
            NativeSitePhotoPicker { piece, data in
                sitePicker = false
                start.photo = DesignPhotoSources.site(piece, data: data)
            }
            .presentationSizing(.page)
        }
        .sheet(isPresented: $camera) {
            NewOrderCamera { image in
                camera = false
                if let image, let data = WebsitePhoto.jpeg(image) { start.photo = DesignPhotoSources.device(data, name: "Camera photo") }
            }.ignoresSafeArea()
        }
        .sheet(item: $start.sheet) { $0.shown }
        .failureAlert($problem, title: "Could not use that photograph")
    }

    // "Start with anything": the smart input is phase 2 (DesignHooks.startWithAnything).
    private var anything: some View {
        SectionCard("Start with anything") {
            Text("Paste a caption, a forwarded WhatsApp message, a link or a SKU, or drop photos.")
                .font(.subheadline).foregroundStyle(.secondary)
            Button { DesignHooks.shared.startWithAnything(start) } label: {
                Label("Paste or describe a piece…", systemImage: "sparkles").frame(maxWidth: .infinity)
            }.buttonStyle(.bordered).controlSize(.large)
            let found = start.fields.filter { !$0.value.isEmpty }
            if !found.isEmpty || !start.price.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(foundLine).font(.footnote).foregroundStyle(.secondary)
                    Button("Clear") { start.fields = [:]; start.price = "" }.font(.footnote).frame(minHeight: 44)
                }
            }
            if !start.waiting.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Also found").font(.caption).foregroundStyle(.secondary)
                    ForEach(start.waiting) { f in
                        HStack {
                            Text(f.name.isEmpty ? "A piece" : f.name).font(.subheadline).lineLimit(1)
                            Spacer(minLength: 0)
                            Button("Use") { start.use(f); start.waiting.removeAll { $0.id == f.id } }.buttonStyle(.bordered)
                            Button { start.waiting.removeAll { $0.id == f.id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).frame(minWidth: 44, minHeight: 44) }
                                .buttonStyle(.plain).accessibilityLabel("Put it aside")
                        }
                    }
                }
            }
        }
    }

    private var foundLine: String {
        var parts: [String] = []
        for (key, value) in start.fields.sorted(by: { $0.key < $1.key }) where !value.isEmpty {
            parts.append((key == "weight" ? "specs" : key) + " “" + String(value.prefix(40)) + "”")
        }
        if !start.price.isEmpty { parts.append("price “" + start.price + "”") }
        return "Found: " + parts.joined(separator: " · ")
    }

    private var making: some View {
        SectionCard("What are you making?") {
            if let play = start.play, start.kind == "ad" {
                HStack(spacing: 8) {
                    Text("Making ").font(.subheadline) + Text(play.s("title")).font(.subheadline.weight(.semibold)) + Text(" — “\(play.s("cta"))” · \(play.s("where"))").font(.subheadline)
                    Spacer(minLength: 0)
                    Button("Not this play") { start.play = nil }.font(.footnote).frame(minHeight: 44)
                }
                .padding(10).background(Theme.accent.opacity(0.12), in: .rect(cornerRadius: Radius.tile, style: .continuous))
            }
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(cards) { c in
                    Button { start.choose(c.kind) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(c.title).font(.headline)
                            Text(c.note).font(.footnote).opacity(0.8)
                        }
                        .foregroundStyle(start.kind == c.kind ? Theme.onAccent : Color.primary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .background(start.kind == c.kind ? Theme.accent : Theme.ground, in: .rect(cornerRadius: Radius.chip, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(start.kind == c.kind ? .isSelected : [])
                    .sensoryFeedback(.selection, trigger: start.kind) { _, now in now == c.kind }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text("Sizes").font(.subheadline.weight(.medium)); Text(start.summary).font(.subheadline).foregroundStyle(.secondary) }
                ForEach(DesignSizes.groups) { g in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(g.title).font(.caption).foregroundStyle(.secondary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(g.sizes) { s in FilterChip(title: s.ratio, chosen: start.sizes.contains(s.id)) { start.toggle(s.id) } }
                            }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your own").font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        FilterChip(title: "W:H", chosen: start.sizes.contains("custom")) { start.toggle("custom") }
                        if start.sizes.contains("custom") {
                            TextField("W", value: $start.customW, format: .number).keyboardType(.numberPad).multilineTextAlignment(.center)
                                .frame(width: 56).textFieldStyle(.roundedBorder).accessibilityLabel("Width")
                            Text(":")
                            TextField("H", value: $start.customH, format: .number).keyboardType(.numberPad).multilineTextAlignment(.center)
                                .frame(width: 56).textFieldStyle(.roundedBorder).accessibilityLabel("Height")
                        }
                    }
                }
            }
        }
    }

    private var photograph: some View {
        SectionCard("The photograph") {
            if let photo = start.photo {
                HStack(spacing: 10) {
                    Image(systemName: "photo").foregroundStyle(Theme.accent)
                    Text(photo.label).font(.subheadline.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 0)
                    Button { start.photo = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).frame(minWidth: 44, minHeight: 44) }
                        .buttonStyle(.plain).accessibilityLabel("Choose another photograph")
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip("Browse photos", "photo.on.rectangle", onBrowse)
                        chip("From the website", "globe") { sitePicker = true }
                        PhotosPicker(selection: $picked, matching: .images) { chipLabel("This device", "iphone") }.buttonStyle(.plain)
                        if UIImagePickerController.isSourceTypeAvailable(.camera) { chip("Camera", "camera") { camera = true } }
                    }
                }
                Text("A photograph is optional: without one the design starts on the house’s ground.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func chip(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { chipLabel(title, symbol) }.buttonStyle(.plain)
    }

    private func chipLabel(_ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.medium)).foregroundStyle(Color.primary)
            .padding(.horizontal, 13).padding(.vertical, 7).frame(minHeight: 44)
            .background(Theme.ground, in: .capsule)
            .overlay(Capsule().strokeBorder(Color.secondary.opacity(0.18), lineWidth: 1))
    }

    @ViewBuilder private var investments: some View {
        // The Investments link of start.tsx, only where the person's map has it (Taheri).
        if MarketingKit.has("/website/investments", role: role) {
            let path = "/website/investments"
            NavigationLink(value: Route(path: path)) {
                Label("Gold investment posts: Investments", systemImage: "chart.line.uptrend.xyaxis")
                    .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
            }
            .zoomSource(id: path)
            .padding(.horizontal, 4)
        }
    }

    @ViewBuilder private var leftOff: some View {
        let drafts = Array(shelf.draftRows.prefix(3))
        let recent = Array(shelf.items.prefix(4))
        if !drafts.isEmpty || !recent.isEmpty {
            SectionCard("Where you left off") {
                ForEach(drafts) { d in
                    Button { onOpenDraft(d) } label: { DesignDraftLine(row: d) }.buttonStyle(.plain)
                }
                ForEach(recent) { r in
                    Button { onOpenSaved(r) } label: { DesignRecordLine(record: r) }.buttonStyle(.plain)
                }
                Button("See all saved", action: onSeeAll).font(.subheadline)
            }
        }
    }

    private func take(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), WebsitePhoto.jpegCopy(data) != nil else {
                throw ERPAPI.Failure(status: 0, message: "Choose a readable photo, or save it to Photos first.")
            }
            start.photo = DesignPhotoSources.device(data, name: "Photo from this iPhone")
        } catch { problem = error.localizedDescription }
    }
}

/// A device draft as a line.
struct DesignDraftLine: View {
    let row: DesignDraftRow
    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let image = row.thumb { Image(uiImage: image).resizable().scaledToFill() }
                else { Image(systemName: "iphone").foregroundStyle(.secondary) }
            }
            .frame(width: 44, height: 44).background(Theme.ground).clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).font(.subheadline.weight(.medium)).lineLimit(1)
                Text((row.old == nil ? "Draft on this phone" : "Earlier Post a piece draft") + " · " + ShopDate.stamp(row.updated, withTime: false))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }
}

/// A saved design as a line.
struct DesignRecordLine: View {
    let record: DesignRecord
    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let image = record.thumbImage { Image(uiImage: image).resizable().scaledToFill() }
                else { Image(systemName: "photo").foregroundStyle(.secondary) }
            }
            .frame(width: 44, height: 44).background(Theme.ground).clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(record.name).font(.subheadline.weight(.medium)).lineLimit(1)
                Text(DesignKinds.label(record.kind) + " · \(record.pages.count) size" + (record.pages.count == 1 ? "" : "s") + " · " + ShopDate.say(record.updated))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }
}
