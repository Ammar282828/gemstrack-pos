import SwiftUI

/// Photos (src/app/design/photos-section.tsx): where a design's photograph comes from. The website's own pieces for everyone who
/// may design; the Ad studio's library ("Best for ads", "Every photo") for owner and marketing. Choosing a photograph hands
/// it back (`onPick`); nothing is made here.
struct DesignPhotosView: View {
    let access: DesignAccess
    @Binding var part: DesignPhotoPart
    let onPick: (DesignStartPhoto) -> Void

    var body: some View {
        #if os(macOS)
        macBody
        #else
        VStack(spacing: 0) {
            if DesignPhotoPart.offered(access).count > 1 {
                ChipRow {
                    ForEach(DesignPhotoPart.offered(access)) { p in FilterChip(title: p.title, chosen: part == p) { part = p } }
                }
                .padding(.vertical, pt(4))
            }
            switch part {
            case .site: DesignSitePieces(onPick: onPick)
            case .picks, .library: DesignLibraryPhotos(all: part == .library, onPick: onPick)
            }
        }
        #endif
    }
}

// MARK: The website's pieces

struct DesignSitePieces: View {
    let onPick: (DesignStartPhoto) -> Void
    @State private var pieces: [MarketingValue] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var q = ""
    @State private var collection = "__new__"
    @State private var shown = 60
    @State private var loading: String?
    #if os(macOS)
    @State private var chosen: String?
    @FocusState private var galleryFocus: Bool
    /// The gallery's pieces, filtered again only when the pieces, the search or the collection change (a click on a photo
    /// redraws the page and must not walk and lowercase every piece).
    @State private var macMade = Memo<[DesignPhotosMacItem]>()
    #endif

    private var hasNew: Bool { pieces.contains { $0["newArrival"].bool } }
    private var showing: String { collection == "__new__" && !hasNew ? "" : collection }
    private var collections: [String] { Array(Set(pieces.map { $0.s("collection") }.filter { !$0.isEmpty })).sorted() }
    private var filtered: [MarketingValue] {
        let words = q.lowercased().split(separator: " ").map(String.init)
        return pieces.filter { p in
            let inCollection = showing == "__new__" ? p["newArrival"].bool : (showing.isEmpty || p.s("collection") == showing)
            let hay = ([p.s("name"), p.s("collection")] + p["facts"].array.map(\.string)).joined(separator: " ").lowercased()
            return inCollection && words.allSatisfy { hay.contains($0) }
        }
    }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    private var phoneBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(12)) {
                ChipRow {
                    if hasNew { FilterChip(title: "New arrivals", chosen: showing == "__new__") { collection = "__new__" } }
                    FilterChip(title: "Everything", chosen: showing.isEmpty) { collection = "" }
                    ForEach(collections, id: \.self) { c in FilterChip(title: c, chosen: showing == c) { collection = c } }
                }
                if let error { ErrorState(error) { Task { await load() } } }
                else if !loaded { SkeletonLoading("Reading the website").padding(.horizontal, pt(16)) }
                else if filtered.isEmpty { EmptyState("No pieces", symbol: "globe", message: "Nothing on the website matches.") }
                else {
                    Text("\(filtered.count) of \(pieces.count) pieces. \(DesignPhotoGrid.pickVerb) one to design it.").font(.footnote).foregroundStyle(.secondary).padding(.horizontal, pt(16))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: DesignPhotoGrid.cell), spacing: pt(10))], spacing: pt(10)) {
                        ForEach(Array(filtered.prefix(shown)), id: \.text) { p in
                            Button { onPick(DesignPhotoSources.site(p)) } label: { PieceCell(name: p.s("name"), sub: p.s("collection"), thumb: p.s("thumb", p.s("image"))) }
                                .buttonStyle(.plain)
                                .designPieceMenu { onPick(DesignPhotoSources.site(p)) }
                        }
                    }.padding(.horizontal, pt(16))
                    if filtered.count > shown { Button("Show more (\(filtered.count - shown) left)") { shown += 60 }.frame(maxWidth: .infinity) }
                }
            }
            .padding(.vertical, pt(8))
        }
        .searchable(text: $q, prompt: "Ruby, kara, jhumka")
        .onChange(of: q) { _, _ in shown = 60 }
        .onChange(of: collection) { _, _ in shown = 60 }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if House.isDemo { loaded = true; return }
        do {
            let all = try await MarketingRequest.get("/api/website/site-pieces?lean=1")["pieces"].array.filter { !$0["hidden"].bool }
            // New arrivals first (lib/website/new-arrivals.ts byNewest): the later `added`, then the name.
            pieces = all.sorted { a, b in a.n("added") != b.n("added") ? a.n("added") > b.n("added") : a.s("name") < b.s("name") }
            error = nil
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
}

private struct PieceCell: View {
    let name: String
    let sub: String
    let thumb: String
    var body: some View {
        VStack(alignment: .leading, spacing: pt(4)) {
            MarketingPhoto(path: thumb)
                .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                .background(Theme.ground).clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            Text(name).font(.caption.weight(.medium)).lineLimit(2).multilineTextAlignment(.leading)
            if !sub.isEmpty { Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

// MARK: The ad studio's library (owner and marketing)

struct DesignLibraryPhotos: View {
    let all: Bool
    let onPick: (DesignStartPhoto) -> Void
    @State private var rows: [MarketingValue] = []
    @State private var total = 0
    @State private var loaded = false
    @State private var error: String?
    @State private var q = ""
    @State private var placement = "portrait"
    #if os(macOS)
    @State private var chosen: String?
    @FocusState private var galleryFocus: Bool
    #endif

    private var key: String { "\(all)|\(q)|\(placement)" }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        phoneBody
        #endif
    }

    private var phoneBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(12)) {
                Picker("Placement", selection: $placement) {
                    Text("Feed 4:5").tag("portrait"); Text("Feed 1:1").tag("square"); Text("Stories 9:16").tag("story")
                }.pickerStyle(.segmented).padding(.horizontal, pt(16))
                if let error { ErrorState(error) { Task { await load(more: false) } } }
                else if !loaded { SkeletonLoading("Loading the photos").padding(.horizontal, pt(16)) }
                else if rows.isEmpty { EmptyState("No photos", symbol: "photo", message: "No photos match.") }
                else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: DesignPhotoGrid.cell), spacing: pt(10))], spacing: pt(10)) {
                        ForEach(rows, id: \.text) { item in
                            Button { onPick(DesignPhotoSources.library(item)) } label: {
                                PieceCell(name: item.s("name"), sub: item["adScore"] == .null ? item.s("collection") : "Ad score \(Int(item.n("adScore")))", thumb: item.s("thumb"))
                            }.buttonStyle(.plain)
                                .designPieceMenu { onPick(DesignPhotoSources.library(item)) }
                        }
                    }.padding(.horizontal, pt(16))
                    if rows.count < total { Button("Show more") { Task { await load(more: true) } }.frame(maxWidth: .infinity) }
                }
            }
            .padding(.vertical, pt(8))
        }
        .searchable(text: $q, prompt: "Name, subject or collection")
        .task(id: key) {
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            await load(more: false)
        }
    }

    /// The Studio's own call (StudioLibrary.load): the same route and parameters.
    private func load(more: Bool) async {
        if House.isDemo { loaded = true; return }
        let params = ["view": all ? "all" : "picks", "placement": placement, "source": "all", "filter": "all", "collection": "", "q": q, "sort": "newest",
                      "offset": more ? String(rows.count) : "0", "limit": "60", "fresh": "0"]
        let path = "/api/ads/studio/library?" + params.sorted { $0.key < $1.key }.map { $0.key + "=" + AdsQuery.escape($0.value) }.joined(separator: "&")
        do {
            let r = try await MarketingRequest.get(path)
            guard !Task.isCancelled else { return }
            rows = more ? rows + r["items"].array : r["items"].array
            total = Int(r.n("total"))
            error = nil
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        loaded = true
    }
}


/// The photograph grids: bigger cells and "click" on the Mac, and a right-click menu to design the piece.
enum DesignPhotoGrid {
    static var cell: CGFloat {
        #if os(macOS)
        150
        #else
        104
        #endif
    }
    static var pickVerb: String {
        #if os(macOS)
        "Click"
        #else
        "Tap"
        #endif
    }
}

private extension View {
    @ViewBuilder func designPieceMenu(_ use: @escaping () -> Void) -> some View {
        #if os(macOS)
        self.pointerHover().contextMenu { Button("Design this piece", systemImage: "wand.and.stars", action: use) }
        #else
        self
        #endif
    }
}

#if os(macOS)
// MARK: - The Mac's Photos (docs/features/mac-design.md): a gallery with its pop-ups in the toolbar

/// A photograph of the gallery: the website's piece or the library's item, by its id.
private struct DesignPhotosMacItem: Identifiable {
    let id: String
    let value: MarketingValue
}

private func designPhotosMacCell(_ item: DesignPhotosMacItem, name: String, sub: String, thumb: String, on: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        MarketingPhoto(path: thumb)
            .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
            .background(Theme.ground).clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).strokeBorder(on ? Theme.accent : Color.clear, lineWidth: 2.5))
        Text(name).font(.caption.weight(.medium)).lineLimit(2).multilineTextAlignment(.leading)
        if !sub.isEmpty { Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(on ? .isSelected : [])
}

extension DesignPhotosView {
    /// The source (the website, best for ads, every photo) is a pop-up in the toolbar, not a row of chips in the page.
    fileprivate var macBody: some View {
        VStack(spacing: 0) {
            switch part {
            case .site: DesignSitePieces(onPick: onPick)
            case .picks, .library: DesignLibraryPhotos(all: part == .library, onPick: onPick)
            }
        }
        .toolbar {
            if DesignPhotoPart.offered(access).count > 1 {
                ToolbarItem(placement: .automatic) {
                    Menu {
                        Picker("Photos from", selection: $part) {
                            ForEach(DesignPhotoPart.offered(access)) { (p: DesignPhotoPart) in Text(p.title).tag(p) }
                        }
                        .pickerStyle(.inline)
                    } label: {
                        Label("Source", systemImage: "photo.stack")
                    }
                    .help("Where the photographs come from")
                }
            }
        }
    }
}

extension DesignSitePieces {
    private var items: [DesignPhotosMacItem] {
        var h = Hasher()
        for p in pieces {
            h.combine(p.s("id"))
            h.combine(p.s("name"))
            h.combine(p.s("collection"))
        }
        return macMade([h.finalize(), q.hashValue, showing.hashValue]) {
            filtered.map { (p: MarketingValue) in DesignPhotosMacItem(id: p.s("id").isEmpty ? p.s("name") : p.s("id"), value: p) }
        }
    }
    private var chosenItem: DesignPhotosMacItem? { chosen.flatMap { id in items.first { $0.id == id } } }

    private var designAction: MacAction {
        MacAction("Design This Piece", symbol: "wand.and.stars", shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: chosenItem != nil, isDefault: true) {
            if let item = chosenItem { onPick(DesignPhotoSources.site(item.value)) }
        }
    }

    fileprivate var macBody: some View {
        let list = items
        return Group {
            if let error {
                ErrorState(error) { Task { await load() } }
            } else if !loaded {
                SkeletonLoading("Reading the website").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if list.isEmpty {
                ContentUnavailableView("No pieces", systemImage: "globe", description: Text("Nothing on the website matches."))
            } else {
                macGallery(list)
            }
        }
        .macSummaryBar(loaded ? ["\(list.count) of \(pieces.count) pieces"] : [])
        .macSearchable(text: $q, prompt: "Ruby, kara, jhumka")
        .navigationSubtitle("Photos from the website")
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                MacToolbarAction(action: designAction)
                Menu {
                    Picker("Collection", selection: Binding<String>(get: { showing }, set: { (v: String) in collection = v })) {
                        if hasNew { Text("New Arrivals").tag("__new__") }
                        Text("Everything").tag("")
                        ForEach(collections, id: \.self) { (c: String) in Text(c).tag(c) }
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label("Filter", systemImage: showing == (hasNew ? "__new__" : "") ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .help("Show one collection")
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Photo", groups: [[designAction]]))
        .macRefresh { Task { await load() } }
        .task { await load() }
    }

    private func macGallery(_ list: [DesignPhotosMacItem]) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(list) { (item: DesignPhotosMacItem) in
                    designPhotosMacCell(item, name: item.value.s("name"), sub: item.value.s("collection"), thumb: item.value.s("thumb", item.value.s("image")), on: chosen == item.id)
                        .onTapGesture { chosen = item.id; galleryFocus = true }
                        .simultaneousGesture(TapGesture(count: 2).onEnded { onPick(DesignPhotoSources.site(item.value)) })
                        .pointerHover()
                        .contextMenu { MacActionItems(groups: [[MacAction("Design This Piece", symbol: "wand.and.stars") { onPick(DesignPhotoSources.site(item.value)) }]]) }
                }
            }
            .padding(20)
        }
        .focusable()
        .focused($galleryFocus)
        .focusEffectDisabled()
        .onKeyPress(.return) {
            guard let item = chosenItem else { return .ignored }
            onPick(DesignPhotoSources.site(item.value))
            return .handled
        }
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { (press: KeyPress) in
            guard !list.isEmpty else { return .ignored }
            let at = list.firstIndex(where: { $0.id == chosen }) ?? (press.key == .rightArrow ? -1 : list.count)
            chosen = list[min(list.count - 1, max(0, at + (press.key == .rightArrow ? 1 : -1)))].id
            return .handled
        }
    }
}

extension DesignLibraryPhotos {
    private var items: [DesignPhotosMacItem] {
        rows.map { (r: MarketingValue) in DesignPhotosMacItem(id: r.s("id").isEmpty ? r.s("name") : r.s("id"), value: r) }
    }
    private var chosenItem: DesignPhotosMacItem? { chosen.flatMap { id in items.first { $0.id == id } } }

    private var designAction: MacAction {
        MacAction("Design This Photo", symbol: "wand.and.stars", shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: chosenItem != nil, isDefault: true) {
            if let item = chosenItem { onPick(DesignPhotoSources.library(item.value)) }
        }
    }

    fileprivate var macBody: some View {
        let list = items
        return Group {
            if let error {
                ErrorState(error) { Task { await load(more: false) } }
            } else if !loaded {
                SkeletonLoading("Loading the photos").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if list.isEmpty {
                ContentUnavailableView("No photos", systemImage: "photo", description: Text("No photos match."))
            } else {
                macGallery(list)
            }
        }
        .macSummaryBar(loaded ? ["\(rows.count) of \(total) photos"] : [])
        .macSearchable(text: $q, prompt: "Name, subject or collection")
        .navigationSubtitle(all ? "Every photo" : "Best for ads")
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                MacToolbarAction(action: designAction)
                Menu {
                    Picker("Placement", selection: $placement) {
                        Text("Feed 4:5").tag("portrait")
                        Text("Feed 1:1").tag("square")
                        Text("Stories 9:16").tag("story")
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label("Shape", systemImage: "aspectratio")
                }
                .help("Which shape the scores are for")
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Photo", groups: [[designAction]]))
        .macRefresh { Task { await load(more: false) } }
        .task(id: key) {
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            await load(more: false)
        }
    }

    private func macGallery(_ list: [DesignPhotosMacItem]) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(list) { (item: DesignPhotosMacItem) in
                    designPhotosMacCell(item, name: item.value.s("name"),
                                        sub: item.value["adScore"] == .null ? item.value.s("collection") : "Ad score \(Int(item.value.n("adScore")))",
                                        thumb: item.value.s("thumb"), on: chosen == item.id)
                        .onTapGesture { chosen = item.id; galleryFocus = true }
                        .simultaneousGesture(TapGesture(count: 2).onEnded { onPick(DesignPhotoSources.library(item.value)) })
                        .pointerHover()
                        .contextMenu { MacActionItems(groups: [[MacAction("Design This Photo", symbol: "wand.and.stars") { onPick(DesignPhotoSources.library(item.value)) }]]) }
                }
            }
            .padding(20)
            if rows.count < total {
                Button("Show More") { Task { await load(more: true) } }.padding(.bottom, 20)
            }
        }
        .focusable()
        .focused($galleryFocus)
        .focusEffectDisabled()
        .onKeyPress(.return) {
            guard let item = chosenItem else { return .ignored }
            onPick(DesignPhotoSources.library(item.value))
            return .handled
        }
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { (press: KeyPress) in
            guard !list.isEmpty else { return .ignored }
            let at = list.firstIndex(where: { $0.id == chosen }) ?? (press.key == .rightArrow ? -1 : list.count)
            chosen = list[min(list.count - 1, max(0, at + (press.key == .rightArrow ? 1 : -1)))].id
            return .handled
        }
    }
}
#endif
