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
}

/// `GET /api/app/catalogue?category=&q=`, kept in memory for the session so a chip or a search typed before is instant.
@MainActor
final class CatalogueStore {
    static let shared = CatalogueStore()
    private var cache: [String: [CataloguePiece]] = [:]
    private init() {}

    private func key(_ category: String, _ q: String) -> String { House.business.id + "|" + category + "|" + q.lowercased() }

    func cached(category: String, q: String) -> [CataloguePiece]? { cache[key(category, q)] }

    func fetch(category: String, q: String) async throws -> [CataloguePiece] {
        let k = key(category, q)
        if let hit = cache[k] { return hit }
        var comps = URLComponents()
        comps.path = "/api/app/catalogue"
        var items: [URLQueryItem] = []
        if !category.isEmpty { items.append(URLQueryItem(name: "category", value: category)) }
        if !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        comps.queryItems = items.isEmpty ? nil : items
        let data = try await ERPAPI.shared.data(comps.string ?? "/api/app/catalogue")
        let pieces = await Task.detached { CatalogueStore.parse(data) }.value
        cache[k] = pieces
        return pieces
    }

    nonisolated static func parse(_ data: Data) -> [CataloguePiece] {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let rows = root["pieces"] as? [[String: Any]] else { return [] }
        var out: [CataloguePiece] = []
        for r in rows {
            let image = (r["image"] as? String) ?? ""
            let thumb = (r["thumb"] as? String) ?? ""
            guard image.hasPrefix("http") || thumb.hasPrefix("http") else { continue }
            let id = (r["id"] as? String) ?? image
            out.append(CataloguePiece(id: id, title: (r["title"] as? String) ?? "", category: (r["category"] as? String) ?? "",
                                      image: image.isEmpty ? thumb : image, thumb: thumb.isEmpty ? image : thumb))
        }
        return out
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
                image = chosen
                printIt = true
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
    @State private var query = ""
    @State private var pieces: [CataloguePiece] = []
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

    private struct LoadKey: Equatable {
        let scope: String
        let query: String
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: pt(14)) {
                    ForEach(pieces) { piece in
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
                .background(.bar)
            }
            .overlay {
                if let failure, pieces.isEmpty {
                    ErrorState(failure) { Task { await load() } }
                } else if loading && pieces.isEmpty {
                    SkeletonThumbGrid(count: 12, columns: 3, label: "Loading the pictures").padding(.horizontal, pt(16)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                } else if pieces.isEmpty {
                    if query.isEmpty {
                        ContentUnavailableView("No pictures here", systemImage: "photo.on.rectangle.angled",
                                               description: Text(scope.isEmpty ? "The catalogue has no pieces yet." : "Try All pieces."))
                    } else {
                        ContentUnavailableView.search(text: query)
                    }
                }
            }
            .searchable(text: $query, prompt: "Search the catalogue")
            .selectionFeedback(trigger: picked)
            .navigationTitle("Reference photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task(id: LoadKey(scope: scope, query: query)) {
                // A pause after the last letter, so typing is one request; a chip is at once.
                if !query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(300))
                    if Task.isCancelled { return }
                }
                await load()
            }
        }
        #if !os(macOS)
        .presentationSizing(.page)
        #endif
    }

    private func load() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if let hit = store.cached(category: scope, q: q) {
            pieces = hit
            failure = nil
            loading = false
            return
        }
        loading = true
        do {
            let got = try await store.fetch(category: scope, q: q)
            if Task.isCancelled { return }
            pieces = got
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
