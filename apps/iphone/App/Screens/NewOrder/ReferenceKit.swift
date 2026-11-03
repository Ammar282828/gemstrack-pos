import SwiftUI
import ERPCore

// A reference photo printed on the bill (owner, 2026-11-03: "print the reference image onto the bill next to the
// icon and allow me to pick reference image from my catalogue (only show that category's photos) and make it
// super easy to filter and search"). The piece's rows (a toggle, a preview, "Pick from catalogue") and the sheet
// that picks. `referenceImage` is an https address from the catalogue; `printReference` says to print one (a piece
// on an order with no pick prints its own first reference photo).

// MARK: The catalogue

struct CataloguePiece: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let category: String
    /// The full picture, what the bill prints.
    let image: String
    /// A small one for the grid.
    let thumb: String
    /// The piece's type and stones as the server names them (ids of the facets); empty from an older server.
    var type = ""
    var stones: [String] = []
    /// Lower-cased words the search looks through: title, category, type and stones, built once at decode.
    var haystack = ""
}

/// One chip of a facet row: the server's id and label, and how many pieces carry it in the loaded category.
struct CatalogueFacet: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let count: Int
}

/// A category's pieces with the facets the server offered for them (empty from an older server: the rows hide).
struct CatalogueSet: Sendable {
    var pieces: [CataloguePiece] = []
    var types: [CatalogueFacet] = []
    var stones: [CatalogueFacet] = []
}

/// What the picker narrows the loaded set by, instantly and on the phone: words, types (any of), stones (all of, as the server).
struct CatalogueFilter: Equatable, Sendable {
    var query = ""
    var types: Set<String> = []
    var stones: Set<String> = []

    var isEmpty: Bool { query.trimmingCharacters(in: .whitespaces).isEmpty && types.isEmpty && stones.isEmpty }

    /// Every typed word must be somewhere in the piece's words.
    private var words: [String] {
        query.lowercased().split(whereSeparator: { $0 == " " || $0 == "," }).map(String.init)
    }

    /// The server's rule: one of the types, and every chosen stone (a stone chip narrows, as the web's does), and every typed word.
    func matches(_ p: CataloguePiece, words: [String], extraStone: String? = nil, ignoringTypes: Bool = false) -> Bool {
        if !ignoringTypes, !types.isEmpty, !types.contains(p.type) { return false }
        for s in stones where !p.stones.contains(s) { return false }
        if let extraStone, !p.stones.contains(extraStone) { return false }
        for w in words where !p.haystack.contains(w) { return false }
        return true
    }

    func apply(_ pieces: [CataloguePiece]) -> [CataloguePiece] {
        if isEmpty { return pieces }
        let w = words
        return pieces.filter { matches($0, words: w) }
    }

    /// The facets with the count each chip would show if tapped now (the other row and the words kept), in the server's order.
    func recount(_ facets: [CatalogueFacet], in pieces: [CataloguePiece], stonesRow: Bool) -> [CatalogueFacet] {
        let w = words
        if stonesRow {
            return facets.map { (f: CatalogueFacet) -> CatalogueFacet in
                let n = pieces.reduce(0) { (acc: Int, p: CataloguePiece) -> Int in acc + (matches(p, words: w, extraStone: f.id) ? 1 : 0) }
                return CatalogueFacet(id: f.id, label: f.label, count: n)
            }
        }
        var counts: [String: Int] = [:]
        for p in pieces where matches(p, words: w, ignoringTypes: true) { counts[p.type, default: 0] += 1 }
        return facets.map { CatalogueFacet(id: $0.id, label: $0.label, count: counts[$0.id] ?? 0) }
    }
}

/// `GET /api/app/catalogue?category=`, kept in memory for the session so a category seen before is instant. The words, types
/// and stones are filtered on the loaded set (CatalogueFilter), so only a new category asks the server again.
@MainActor
final class CatalogueStore {
    static let shared = CatalogueStore()
    private var cache: [String: CatalogueSet] = [:]
    private init() {}

    private func key(_ category: String) -> String { House.business.id + "|" + category }

    func cached(category: String) -> CatalogueSet? { cache[key(category)] }

    func fetch(category: String) async throws -> CatalogueSet {
        let k = key(category)
        if let hit = cache[k] { return hit }
        var comps = URLComponents()
        comps.path = "/api/app/catalogue"
        if !category.isEmpty { comps.queryItems = [URLQueryItem(name: "category", value: category)] }
        let data = try await ERPAPI.shared.data(comps.string ?? "/api/app/catalogue")
        let set = await Task.detached { CatalogueStore.parse(data) }.value
        cache[k] = set
        return set
    }

    nonisolated static func parse(_ data: Data) -> CatalogueSet {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let rows = root["pieces"] as? [[String: Any]] else { return CatalogueSet() }
        var out: [CataloguePiece] = []
        for r in rows {
            let image = (r["image"] as? String) ?? ""
            let thumb = (r["thumb"] as? String) ?? ""
            guard image.hasPrefix("http") || thumb.hasPrefix("http") else { continue }
            let id = (r["id"] as? String) ?? image
            let title = (r["title"] as? String) ?? ""
            let category = (r["category"] as? String) ?? ""
            let type = (r["type"] as? String) ?? ""
            let stones = ((r["stones"] as? [Any]) ?? []).compactMap { $0 as? String }
            var p = CataloguePiece(id: id, title: title, category: category,
                                   image: image.isEmpty ? thumb : image, thumb: thumb.isEmpty ? image : thumb,
                                   type: type, stones: stones)
            p.haystack = ([title, category, type] + stones).joined(separator: " ").lowercased()
            out.append(p)
        }
        let facets = root["facets"] as? [String: Any]
        let types = facetList(facets?["types"], into: &out, stones: false)
        let stoneFacets = facetList(facets?["stones"], into: &out, stones: true)
        return CatalogueSet(pieces: out, types: types, stones: stoneFacets)
    }

    /// The facet rows, decoded leniently; their labels also join each piece's search words ("emerald" finds a stone id "emerald").
    private nonisolated static func facetList(_ any: Any?, into pieces: inout [CataloguePiece], stones: Bool) -> [CatalogueFacet] {
        guard let rows = any as? [[String: Any]] else { return [] }
        var list: [CatalogueFacet] = []
        for r in rows {
            guard let id = r["id"] as? String, !id.isEmpty else { continue }
            let label = (r["label"] as? String) ?? id
            let count: Int
            if let n = r["count"] as? Int { count = n } else if let d = r["count"] as? Double { count = Int(d) } else { count = 0 }
            list.append(CatalogueFacet(id: id, label: label, count: count))
        }
        if !list.isEmpty {
            let labels = Dictionary(list.map { ($0.id, $0.label.lowercased()) }, uniquingKeysWith: { a, _ in a })
            for i in pieces.indices {
                if stones {
                    for s in pieces[i].stones { if let l = labels[s] { pieces[i].haystack += " " + l } }
                } else if let l = labels[pieces[i].type] {
                    pieces[i].haystack += " " + l
                }
            }
        }
        return list
    }
}

// MARK: The rows on a piece

/// The toggle, the picked picture, and the way to pick one. Sits in a Form section on the piece or line editor.
struct ReferencePrintRows: View {
    @Binding var image: String?
    @Binding var printIt: Bool
    /// The piece's category id: the sheet opens on it.
    let category: String
    /// What prints when nothing is picked ("The piece's own first reference photo is printed"), or empty for nothing.
    var fallbackNote = ""

    @State private var picking = false

    private var picked: String { (image ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Toggle("Print reference photo on the bill", isOn: $printIt)
        if let url = URL(string: picked), picked.hasPrefix("http") {
            HStack(spacing: pt(12)) {
                StockRemoteImage(url: url, name: "", maxPixel: 320)
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("From the catalogue")
                    if printIt {
                        Text("Printed beside the piece").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                Button("Remove", role: .destructive) { image = nil }
                    .buttonStyle(.borderless)
            }
        } else if printIt && !fallbackNote.isEmpty {
            Text(fallbackNote).font(.caption).foregroundStyle(.secondary)
        }
        Button {
            picking = true
        } label: {
            Label(picked.isEmpty ? "Pick from catalogue" : "Change from catalogue", systemImage: "photo.on.rectangle.angled")
        }
        .sheet(isPresented: $picking) {
            ReferencePickerSheet(category: category, current: picked) { chosen in
                // Picking a photo does not turn printing on (owner, 2026-11-03): the toggle alone does.
                image = chosen
            }
        }
    }
}

// MARK: The sheet

/// The catalogue as a grid of pictures: this piece's category first, a chip row to widen it, a search, one tap to pick.
struct ReferencePickerSheet: View {
    let category: String
    let current: String
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    private let store = CatalogueStore.shared
    @State private var scope: String
    @State private var filter = CatalogueFilter()
    @State private var catalogue = CatalogueSet()
    @State private var loading = true
    @State private var failure: String?
    @State private var picked = 0

    init(category: String, current: String, onPick: @escaping (String) -> Void) {
        self.category = category
        self.current = current
        self.onPick = onPick
        _scope = State(initialValue: category)
    }

    /// This piece's category leads, then the others in the shop's order.
    private var chips: [NewOrderChoice] {
        let all = NewOrderWords.categories
        guard let mine = all.first(where: { $0.id == category }) else { return all }
        return [mine] + all.filter { $0.id != category }
    }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: sizeClass == .regular ? 168 : 104), spacing: pt(12))]
    }

    var body: some View {
        NavigationStack {
            // Narrowed once per body from the loaded set; the grid below is lazy, so a long catalogue stays light.
            let shown = filter.apply(catalogue.pieces)
            ScrollView {
                LazyVGrid(columns: columns, spacing: pt(14)) {
                    ForEach(shown) { piece in
                        Button {
                            picked += 1
                            onPick(piece.image)
                            dismiss()
                        } label: {
                            cell(piece)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(piece.title.isEmpty ? "Catalogue piece" : piece.title)
                    }
                }
                .padding(.horizontal, pt(16))
                .padding(.vertical, pt(12))
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    ScrollView(.horizontal) {
                        HStack(spacing: pt(8)) {
                            FilterChip(title: "All pieces", chosen: scope.isEmpty) { scope = "" }
                            ForEach(chips) { c in
                                FilterChip(title: c.label, chosen: scope == c.id) { scope = c.id }
                            }
                        }
                        .padding(.horizontal, pt(16))
                        .padding(.vertical, pt(8))
                    }
                    .scrollIndicators(.hidden)
                    facetRow(catalogue.types, chosen: filter.types, stonesRow: false)
                    facetRow(catalogue.stones, chosen: filter.stones, stonesRow: true)
                }
                .background(.bar)
            }
            .overlay {
                if let failure, catalogue.pieces.isEmpty {
                    ErrorState(failure) { Task { await load() } }
                } else if loading && catalogue.pieces.isEmpty {
                    SkeletonThumbGrid(count: 12, columns: 3, label: "Loading the pictures").padding(.horizontal, pt(16)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                } else if shown.isEmpty {
                    if filter.isEmpty {
                        ContentUnavailableView("No pictures here", systemImage: "photo.on.rectangle.angled",
                                               description: Text(scope.isEmpty ? "The catalogue has no pieces yet." : "Try All pieces."))
                    } else if filter.query.trimmingCharacters(in: .whitespaces).isEmpty {
                        ContentUnavailableView("No pictures match", systemImage: "line.3.horizontal.decrease.circle",
                                               description: Text("Try fewer types or stones."))
                    } else {
                        ContentUnavailableView.search(text: filter.query)
                    }
                }
            }
            .searchable(text: $filter.query, prompt: "Search by name, type or stone")
            .selectionFeedback(trigger: picked)
            .navigationTitle("Reference photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task(id: scope) {
                // A category is the only thing that asks the server; the words and chips filter what is loaded.
                filter.types = []
                filter.stones = []
                await load()
            }
        }
        #if !os(macOS)
        .presentationSizing(.page)
        #endif
    }

    /// A row of multi-select chips (types, or stones) with how many pieces each would show now; hidden when the server sent none.
    @ViewBuilder
    private func facetRow(_ facets: [CatalogueFacet], chosen: Set<String>, stonesRow: Bool) -> some View {
        if !facets.isEmpty {
            let counted = filter.recount(facets, in: catalogue.pieces, stonesRow: stonesRow)
            ScrollView(.horizontal) {
                HStack(spacing: pt(8)) {
                    // A chip that would show nothing stays only while chosen, so the way back is always there.
                    ForEach(counted.filter { $0.count > 0 || chosen.contains($0.id) }) { f in
                        FilterChip(title: f.label, count: f.count, chosen: chosen.contains(f.id)) { toggle(f.id, stonesRow: stonesRow) }
                    }
                }
                .padding(.horizontal, pt(16))
                .padding(.bottom, pt(8))
            }
            .scrollIndicators(.hidden)
            .accessibilityLabel(stonesRow ? "Stones" : "Types")
        }
    }

    private func toggle(_ id: String, stonesRow: Bool) {
        if stonesRow {
            if filter.stones.contains(id) { filter.stones.remove(id) } else { filter.stones.insert(id) }
        } else {
            if filter.types.contains(id) { filter.types.remove(id) } else { filter.types.insert(id) }
        }
    }

    private func load() async {
        if let hit = store.cached(category: scope) {
            catalogue = hit
            failure = nil
            loading = false
            return
        }
        loading = true
        do {
            let got = try await store.fetch(category: scope)
            if Task.isCancelled { return }
            catalogue = got
            failure = nil
        } catch {
            if Task.isCancelled { return }
            failure = "The catalogue could not be read."
        }
        loading = false
    }

    private func cell(_ piece: CataloguePiece) -> some View {
        let chosen = !current.isEmpty && piece.image == current
        return VStack(alignment: .leading, spacing: pt(6)) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let url = URL(string: piece.thumb) {
                        StockRemoteImage(url: url, name: piece.title, maxPixel: 480)
                    }
                }
                .background(Rectangle().fill(.quaternary))
                .clipShape(RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous))
                .overlay {
                    if chosen {
                        RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).stroke(Theme.accent, lineWidth: 3)
                    }
                }
            if !piece.title.isEmpty {
                Text(piece.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}
