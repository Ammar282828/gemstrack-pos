import SwiftUI
import Observation
import ERPCore

/// Website → Edit a piece (src/app/website/edit/page.tsx): every piece on the house's website (taheri.shop, or
/// the House of Mina catalogue), hidden ones too, with what the counter changed. Search, "Changed here",
/// "Hidden" and the collections; a piece opens natively (WebsiteEditPieceScreen) for its words, its weight,
/// hiding it and putting things back. Re-making its photograph (crop, the weight and the mark stamped on,
/// the designer, the AI) is the ERP's square editor, opened in the app from the piece.
struct WebsiteEditScreen: View {
    private var store: WebsiteEdits { WebsiteEdits.shared }

    enum Filter: String, CaseIterable { case all, changed, hidden }

    @State private var search = ""
    @State private var filter: Filter = .all
    @State private var collection = ""
    @State private var shown = WebsiteEditScreen.pageSize

    private static let pageSize = 60

    var body: some View {
        Group {
            switch store.phase {
            case .off:
                ContentUnavailableView("This shop doesn't edit its website from here", systemImage: "globe")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't read the website", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") { Task { await store.load(fresh: true) } }.buttonStyle(.glass)
                }
            case .idle, .loading:
                ProgressView("Reading \(store.siteName)…").controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                grid
            }
        }
        .navigationTitle("Edit a piece")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "Name, collection, ruby, Ring 12…")
        .task { await store.load() }
        .onChange(of: search) { _, _ in shown = WebsiteEditScreen.pageSize }
        .onChange(of: filter) { _, _ in shown = WebsiteEditScreen.pageSize }
        .onChange(of: collection) { _, _ in shown = WebsiteEditScreen.pageSize }
    }

    /// One piece's own screen. Its id is a path on the site ("Rings/DSC0912.webp"), escaped whole.
    static func piecePath(_ id: String) -> String { "/website/edit?id=\(WebsiteNumber.query(id))" }

    // MARK: The grid

    private var collections: [String] {
        Array(Set(store.pieces.map { (p: WebsiteEditPiece) in p.collection }.filter { (c: String) in !c.isEmpty })).sorted()
    }

    private var filtered: [WebsiteEditPiece] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        return store.pieces.filter { (p: WebsiteEditPiece) in
            if !collection.isEmpty, p.collection != collection { return false }
            switch filter {
            case .all: break
            case .changed: if !p.changed { return false }
            case .hidden: if !p.hidden { return false }
            }
            if words.isEmpty { return true }
            let text = "\(p.words.name) \(p.collection) \(p.facts.joined(separator: " ")) \(p.id)".lowercased()
            return words.allSatisfy { (w: String) in text.contains(w) }
        }
    }

    private var grid: some View {
        let items = filtered
        let changedCount = store.pieces.filter { (p: WebsiteEditPiece) in p.changed }.count
        let hiddenCount = store.pieces.filter { (p: WebsiteEditPiece) in p.hidden }.count
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        MarketingChip(title: "Everything", selected: filter == .all) { filter = .all }
                        MarketingChip(title: "Changed here", count: changedCount > 0 ? changedCount : nil, selected: filter == .changed) { filter = .changed }
                        MarketingChip(title: "Hidden", count: hiddenCount > 0 ? hiddenCount : nil, selected: filter == .hidden) { filter = .hidden }
                    }
                }
                .scrollClipDisabled()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        MarketingChip(title: "Every collection", selected: collection.isEmpty) { collection = "" }
                        ForEach(collections, id: \.self) { (c: String) in
                            MarketingChip(title: c, selected: collection == c) { collection = c }
                        }
                    }
                }
                .scrollClipDisabled()
                Text("\(items.count) of \(store.pieces.count) pieces · it shows on \(store.siteName) within a minute; the original photo is kept to put back")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if items.isEmpty {
                    ContentUnavailableView("Nothing matches", systemImage: "square.grid.2x2",
                                           description: Text("Clear the search, or pick another collection."))
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 14) {
                        ForEach(Array(items.prefix(shown))) { (p: WebsiteEditPiece) in
                            NavigationLink(value: Route(path: WebsiteEditScreen.piecePath(p.id))) {
                                WebsiteEditTile(piece: p)
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Theme.card, in: .rect(cornerRadius: 16))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if items.count > shown {
                        Button("Show more (\(items.count - shown) left)") { shown += WebsiteEditScreen.pageSize }
                            .buttonStyle(.glass)
                            .frame(maxWidth: .infinity)
                    }
                }
                if !store.recent.isEmpty { recentCard }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .refreshable { await store.load(fresh: true) }
    }

    /// "name, hidden · owner@… · Today 4:05 pm".
    static func recentWords(_ r: WebsiteEditRecent) -> String {
        let parts: [String] = [r.what.joined(separator: ", "), r.by, ShopDate.say(r.at, withTime: true)]
        return parts.filter { (s: String) in !s.isEmpty }.joined(separator: " · ")
    }

    private var recentCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Recent changes", systemImage: "clock.arrow.circlepath").font(.headline)
            ForEach(store.recent.prefix(15)) { (r: WebsiteEditRecent) in
                NavigationLink(value: Route(path: WebsiteEditScreen.piecePath(r.key))) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.name.isEmpty ? "A piece" : r.name).foregroundStyle(Theme.accent).lineLimit(1)
                        Text(WebsiteEditScreen.recentWords(r))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: .rect(cornerRadius: 16))
    }
}

/// A piece in the grid: its photo as the site shows it, what was changed here, its name and weight.
struct WebsiteEditTile: View {
    let piece: WebsiteEditPiece

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            StockImage(imageUrl: piece.thumb, name: piece.words.name, key: piece.id)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 12))
                .opacity(piece.hidden ? 0.45 : 1)
                .overlay(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: 4) {
                        if piece.hidden { badge("Hidden", symbol: "eye.slash") }
                        if piece.photoEdited { badge("New photo", symbol: "photo") }
                        if piece.wordsChanged { badge("Words changed", symbol: "pencil") }
                    }
                    .padding(6)
                }
            Text(piece.words.name.isEmpty ? "A piece" : piece.words.name)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    /// "Rings · 4.2g".
    private var detail: String {
        var parts: [String] = []
        if !piece.collection.isEmpty { parts.append(piece.collection) }
        if let g = piece.weightGrams { parts.append(WebsiteNumber.grams(g) + "g") }
        return parts.joined(separator: " · ")
    }

    private func badge(_ text: String, symbol: String) -> some View {
        Label(text, systemImage: symbol)
            .font(.caption2.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Color.black.opacity(0.6), in: .capsule)
    }
}

/// Every piece on the house's website with the counter's changes (/api/website/edits), read once for the
/// grid and its pieces, and kept as each save comes back.
@MainActor
@Observable
final class WebsiteEdits {
    static let shared = WebsiteEdits()

    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
        /// The house doesn't edit its website from the ERP (the route answers 404).
        case off
    }

    private(set) var phase: Phase = .idle
    private(set) var site = ""
    private(set) var pieces: [WebsiteEditPiece] = []
    private(set) var recent: [WebsiteEditRecent] = []
    @ObservationIgnored private var loading = false
    @ObservationIgnored private var loadedAt: Date?

    var siteName: String {
        guard let host = URL(string: site)?.host else { return WebsiteStore.shared.siteName }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// The list, unless it was read in the last minute; `fresh` asks the site again past the ERP's cache.
    func load(fresh: Bool = false) async {
        guard !loading else { return }
        if !fresh, phase == .loaded, let at = loadedAt, Date().timeIntervalSince(at) < 60 { return }
        loading = true
        defer { loading = false }
        if phase != .loaded { phase = .loading }
        do {
            let a = try await ERPAPI.shared.get(fresh ? "/api/website/edits?fresh=1" : "/api/website/edits", as: WebsiteEditsAnswer.self)
            site = a.site
            pieces = a.pieces
            recent = a.recent
            phase = .loaded
            loadedAt = Date()
        } catch let f as ERPAPI.Failure where f.status == 404 {
            phase = .off
        } catch {
            if pieces.isEmpty { phase = .failed(error.localizedDescription) }
        }
    }

    func piece(_ id: String) -> WebsiteEditPiece? { pieces.first { (p: WebsiteEditPiece) in p.id == id } }

    /// A piece as a save left it; the change log is read again behind it.
    func replace(_ p: WebsiteEditPiece) {
        if let k = pieces.firstIndex(where: { (x: WebsiteEditPiece) in x.id == p.id }) { pieces[k] = p } else { pieces.append(p) }
        loadedAt = nil
        Task { await self.load() }
    }
}
