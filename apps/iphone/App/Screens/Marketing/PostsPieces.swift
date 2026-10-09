import SwiftUI
import ERPCore

/// The website's pieces as a photo grid (the hub's "From the website" grid): search, a collection chip
/// row that opens on the new arrivals, and the web's default of hiding what went out in the last 30 days.
/// Tapping one opens the piece; sending it is the ERP's tray, which this screen does not imitate.
struct PostPiecesScreen: View {
    private var store: PostsStore { PostsStore.shared }

    /// The "new arrivals" chip; "" is everything.
    private static let newKey = "__new"
    /// Pieces posted within this many days are hidden by default (page.tsx FRESH_DAYS).
    private static let freshDays = 30
    private static let pageSize = 60

    @State private var search = ""
    @State private var collection = PostPiecesScreen.newKey
    @State private var freshOnly = true
    @State private var shown = PostPiecesScreen.pageSize

    var body: some View {
        Group {
            switch store.piecesPhase {
            case .off:
                ContentUnavailableView("This shop doesn't post its website's pieces", systemImage: "globe")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't read the website", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") { Task { await store.load() } }.buttonStyle(.glass)
                }
            case .idle, .loading:
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                grid
            }
        }
        .navigationTitle("Pieces")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search: ruby, kara, jhumka…")
        .task { await store.load() }
        .onChange(of: search) { _, _ in shown = PostPiecesScreen.pageSize }
        .onChange(of: collection) { _, _ in shown = PostPiecesScreen.pageSize }
        .onChange(of: freshOnly) { _, _ in shown = PostPiecesScreen.pageSize }
    }

    // MARK: The grid

    private var hasNew: Bool { store.pieces.contains { (p: PostPiece) in p.newArrival } }

    /// A site that gives no dates has no new arrivals: the grid shows everything instead.
    private var showing: String { collection == PostPiecesScreen.newKey && !hasNew ? "" : collection }

    private var collections: [String] {
        Array(Set(store.pieces.map { (p: PostPiece) in p.collection }.filter { (c: String) in !c.isEmpty })).sorted()
    }

    private func recent(_ p: PostPiece) -> Bool {
        guard let days = MarketingTime.daysAgo(store.posted[p.id]) else { return false }
        return days < PostPiecesScreen.freshDays
    }

    private var filtered: [PostPiece] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        let chosen = showing
        return store.pieces.filter { (p: PostPiece) in
            if chosen == PostPiecesScreen.newKey { if !p.newArrival { return false } }
            else if !chosen.isEmpty, p.collection != chosen { return false }
            if freshOnly, recent(p) { return false }
            if words.isEmpty { return true }
            let text = "\(p.name) \(p.collection) \(p.facts.joined(separator: " "))".lowercased()
            return words.allSatisfy { (w: String) in text.contains(w) }
        }
    }

    private var grid: some View {
        let items = filtered
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                chips
                Toggle("Hide pieces posted in the last \(PostPiecesScreen.freshDays) days", isOn: $freshOnly)
                    .tint(Theme.accent)
                    .padding(14)
                    .background(Theme.card, in: .rect(cornerRadius: 16))
                Text("\(items.count) of \(store.pieces.count) pieces")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if items.isEmpty {
                    ContentUnavailableView("Nothing matches", systemImage: "square.grid.2x2",
                                           description: Text("Clear the search, pick another collection, or show what went out lately."))
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 14) {
                        ForEach(Array(items.prefix(shown))) { (p: PostPiece) in
                            NavigationLink(value: Route(path: MarketingKit.piecePath(p.id))) {
                                PostPieceTile(piece: p, posted: store.posted[p.id])
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Theme.card, in: .rect(cornerRadius: 16))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if items.count > shown {
                        Button("Show more (\(items.count - shown) left)") { shown += PostPiecesScreen.pageSize }
                            .buttonStyle(.glass)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .refreshable { await store.load() }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if hasNew {
                    MarketingChip(title: "New arrivals", selected: showing == PostPiecesScreen.newKey) { collection = PostPiecesScreen.newKey }
                }
                MarketingChip(title: "Everything", selected: showing.isEmpty) { collection = "" }
                ForEach(collections, id: \.self) { (c: String) in
                    MarketingChip(title: c, selected: showing == c) { collection = c }
                }
            }
        }
        .scrollClipDisabled()
    }
}

/// One website piece (the hub's piece card without its tray): the photograph, the words the site has
/// for it, when it went out, and the ERP pages that act on it.
struct PostPieceScreen: View {
    let id: String
    @Environment(Session.self) private var session
    private var store: PostsStore { PostsStore.shared }

    var body: some View {
        Group {
            if let piece = store.piece(id) {
                detail(piece)
            } else if store.piecesPhase == .loaded {
                ContentUnavailableView("That piece is not on the website any more", systemImage: "photo")
            } else {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(store.piece(id)?.name ?? "Piece")
        .navigationBarTitleDisplayMode(.inline)
        .task { if store.piece(id) == nil { await store.load() } }
    }

    private func detail(_ p: PostPiece) -> some View {
        List {
            Group {
                Section {
                    StockImage(imageUrl: p.image, name: p.name, key: p.id)
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 14))
                        .frame(maxHeight: 360)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
                Section {
                    LabeledContent("Collection", value: p.collection.isEmpty ? "None" : p.collection)
                    if let grams = p.weightGrams, grams > 0 {
                        LabeledContent("Weight") { Text("\(trimmed(grams)) g").monospacedDigit() }
                    }
                    if let added = p.added, added > 0 {
                        LabeledContent("On the site since", value: ShopDate.say(ERPDate.iso(Date(timeIntervalSince1970: added / 1000))))
                    }
                    LabeledContent("Last posted", value: lastPosted(p))
                    if p.newArrival { LabeledContent("New arrival", value: "Yes") }
                }
                if !p.facts.isEmpty {
                    Section("Details") {
                        ForEach(p.facts, id: \.self) { (f: String) in Text(f) }
                    }
                }
                if !p.about.isEmpty {
                    Section("About") { Text(p.about) }
                }
                actions(p)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private func actions(_ p: PostPiece) -> some View {
        Section {
            MarketingLink(title: "Send or queue it", subtitle: "Pick it in the ERP's tray, write the caption", symbol: "paperplane", path: MarketingKit.postsWeb)
            if MarketingKit.has("/website/edit", role: session.role) {
                MarketingLink(title: "Edit this piece", subtitle: "Its name, words, photo or weight on the site", symbol: "pencil.line", path: editPath(p))
            }
            if let url = URL(string: p.url), !p.url.isEmpty {
                Link(destination: url) {
                    Label("Open on \(store.siteName)", systemImage: "safari")
                }
            }
        }
    }

    private func editPath(_ p: PostPiece) -> String {
        let escaped = p.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return "/website/edit?id=\(escaped)"
    }

    private func lastPosted(_ p: PostPiece) -> String {
        guard let at = store.posted[p.id], let words = MarketingTime.postedAgo(at) else { return "Never from here" }
        return words.replacingOccurrences(of: "posted ", with: "").capitalizedFirst
    }

    /// 3.84, 12 (no trailing zeros).
    private func trimmed(_ v: Double) -> String {
        var s = String(format: "%.2f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
