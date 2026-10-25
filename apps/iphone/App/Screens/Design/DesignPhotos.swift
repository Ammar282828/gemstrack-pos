import SwiftUI

/// Photos (src/app/design/photos-section.tsx): where a design's photograph comes from. The website's own pieces for everyone who
/// may design; the Ad studio's library ("Best for ads", "Every photo") for owner and marketing. Choosing a photograph hands
/// it back (`onPick`); nothing is made here.
struct DesignPhotosView: View {
    let access: DesignAccess
    @Binding var part: DesignPhotoPart
    let onPick: (DesignStartPhoto) -> Void

    var body: some View {
        VStack(spacing: 0) {
            if DesignPhotoPart.offered(access).count > 1 {
                #if os(macOS)
                Picker("Photos from", selection: $part) {
                    ForEach(DesignPhotoPart.offered(access)) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden()
                .frame(maxWidth: 420)
                .padding(.vertical, 10)
                #else
                ChipRow {
                    ForEach(DesignPhotoPart.offered(access)) { p in FilterChip(title: p.title, chosen: part == p) { part = p } }
                }
                .padding(.vertical, pt(4))
                #endif
            }
            switch part {
            case .site: DesignSitePieces(onPick: onPick)
            case .picks, .library: DesignLibraryPhotos(all: part == .library, onPick: onPick)
            }
        }
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
            let all = try await MarketingRequest.get("/api/website/site-pieces")["pieces"].array.filter { !$0["hidden"].bool }
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

    private var key: String { "\(all)|\(q)|\(placement)" }

    var body: some View {
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
