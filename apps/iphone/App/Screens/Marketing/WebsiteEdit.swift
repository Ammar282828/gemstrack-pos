import SwiftUI
import Observation
import ERPCore
#if os(macOS)
import AppKit
#endif

/// Website → Edit a piece (src/app/website/edit/page.tsx): every piece on the house's website (taheri.shop, or
/// the House of Mina catalogue), hidden ones too, with what the counter changed. Search, "Changed here",
/// "Hidden" and the collections; a piece opens natively (WebsiteEditPieceScreen) for its words, its weight,
/// hiding it and putting things back, and for re-making its photograph (crop, the weight and the mark stamped
/// on, the designer, the AI: WebsitePhotoEdit, the web's square editor drawn by the bundled engine).
struct WebsiteEditScreen: View {
    private var store: WebsiteEdits { WebsiteEdits.shared }

    enum Filter: String, CaseIterable { case all, changed, hidden }

    @State private var search = ""
    @State private var filter: Filter = .all
    @State private var collection = ""
    @State private var shown = WebsiteEditScreen.pageSize
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    /// The table: what is picked and how it is sorted; the form in the inspector and what it tells the table; the piece the pick
    /// last settled on and the one it was asked to go to while words were unsaved.
    @State private var macSelection = Set<String>()
    @State private var macOrder = MacWebsiteOrder.status
    @State private var macBridge = MacWebsiteEditBridge()
    @State private var macSettled = Set<String>()
    @State private var macPending: Set<String>?
    @State private var macAsk = false
    /// The table's rows and the two counts beside them, made again only when the pieces, the filters or the sort change.
    @State private var macMade = Memo<[MacWebsitePieceRow]>()
    @State private var macTally = Memo<[Int]>()
    #endif

    private static let pageSize = 60

    var body: some View {
        #if os(macOS)
        macBody
        #else
        Group {
            switch store.phase {
            case .off:
                NotAvailableState("This shop doesn't edit its website from here", symbol: "globe")
            case .failed(let message):
                ErrorState(message) { Task { await store.load(fresh: true) } }
            case .idle, .loading:
                SkeletonLoading("Reading \(store.siteName)…").controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                grid
            }
        }
        .navigationTitle("Edit a piece")
        .hubTitleDisplay()
        .searchable(text: $search, prompt: "Name, collection, ruby, Ring 12…")
        .task { await store.load() }
        .onChange(of: search) { _, _ in shown = WebsiteEditScreen.pageSize }
        .onChange(of: filter) { _, _ in shown = WebsiteEditScreen.pageSize }
        .onChange(of: collection) { _, _ in shown = WebsiteEditScreen.pageSize }
        #endif
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
        return macGrid(items: items, changedCount: changedCount, hiddenCount: hiddenCount)
    }

    private func phoneGrid(items: [WebsiteEditPiece], changedCount: Int, hiddenCount: Int) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(14)) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: pt(8)) {
                        MarketingChip(title: "Everything", selected: filter == .all) { filter = .all }
                        MarketingChip(title: "Changed here", count: changedCount > 0 ? changedCount : nil, selected: filter == .changed) { filter = .changed }
                        MarketingChip(title: "Hidden", count: hiddenCount > 0 ? hiddenCount : nil, selected: filter == .hidden) { filter = .hidden }
                    }
                }
                .scrollClipDisabled()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: pt(8)) {
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
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: pt(12))], spacing: pt(14)) {
                        ForEach(Array(items.prefix(shown))) { (p: WebsiteEditPiece) in
                            NavigationLink(value: Route(path: WebsiteEditScreen.piecePath(p.id))) {
                                WebsiteEditTile(piece: p)
                                    .ledgerCard(padding: 10)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if items.count > shown {
                        Button("Show more (\(items.count - shown) left)") { shown += WebsiteEditScreen.pageSize }
                            .buttonStyle(.bordered)
                            .frame(maxWidth: .infinity)
                    }
                }
                if !store.recent.isEmpty { recentCard }
            }
            .padding(.horizontal, pt(16))
            .padding(.bottom, pt(16))
        }
        .refreshable { await store.load(fresh: true) }
    }

    private func macGrid(items: [WebsiteEditPiece], changedCount: Int, hiddenCount: Int) -> some View {
        #if os(macOS)
        macPieces(items)
        #else
        phoneGrid(items: items, changedCount: changedCount, hiddenCount: hiddenCount)
        #endif
    }

    /// "name, hidden · owner@… · Today 4:05 pm".
    static func recentWords(_ r: WebsiteEditRecent) -> String {
        let parts: [String] = [r.what.joined(separator: ", "), r.by, ShopDate.say(r.at, withTime: true)]
        return parts.filter { (s: String) in !s.isEmpty }.joined(separator: " · ")
    }

    var recentCard: some View {
        SectionCard("Recent changes") {
            ForEach(store.recent.prefix(15)) { (r: WebsiteEditRecent) in
                NavigationLink(value: Route(path: WebsiteEditScreen.piecePath(r.key))) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.name.isEmpty ? "A piece" : r.name).foregroundStyle(Theme.accent)
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
    }
}

/// A piece in the grid: its photo as the site shows it, what was changed here, its name and weight.
struct WebsiteEditTile: View {
    let piece: WebsiteEditPiece

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            StockImage(imageUrl: piece.thumb, name: piece.words.name, key: piece.id)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                .opacity(piece.hidden ? 0.45 : 1)
                .overlay(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: pt(4)) {
                        if piece.hidden { badge("Hidden", symbol: "eye.slash") }
                        if piece.photoEdited { badge("New photo", symbol: "photo") }
                        if piece.wordsChanged { badge("Words changed", symbol: "pencil") }
                    }
                    .padding(pt(6))
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
            .foregroundStyle(.primary)
            .padding(.horizontal, pt(6)).padding(.vertical, pt(3))
            .background(Theme.card, in: .capsule)
    }
}

/// Every piece on the house's website with the counter's changes (/api/website/edits), read once for the
/// grid and its pieces, and kept as each save comes back.
@MainActor
@Observable
final class WebsiteEdits {
    /// Replaced, not cleared, when the person switches business (Businesses.switch): none of it is the next one's.
    static var shared = WebsiteEdits()
    static func reset() { shared = WebsiteEdits() }

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

#if os(macOS)
extension WebsiteEditScreen {
    /// Edit a piece as a Mac table (docs/features/mac-design.md, "Marketing › Website"): every piece with its collection, weight
    /// and what was changed here; the inspector changes the picked piece's words, weight and hiding in place and Save to the Website
    /// (⌘S) sends them. Return or a double-click opens the piece in a window of its own; the filters are pop-ups in the toolbar.
    @ViewBuilder
    var macBody: some View {
        macDialogs(
            Group {
                switch store.phase {
                case .off:
                    NotAvailableState("This shop doesn't edit its website from here", symbol: "globe")
                case .failed(let message):
                    ErrorState(message) { Task { await store.load(fresh: true) } }
                case .idle, .loading:
                    SkeletonLoading("Reading \(store.siteName)…").frame(maxWidth: .infinity, maxHeight: .infinity)
                case .loaded:
                    macTable
                }
            }
            .navigationTitle("Edit a piece")
            .navigationSubtitle(store.phase == .loaded ? "\(macRows.count) of \(store.pieces.count) pieces" : "")
            .toolbar { macToolbar }
            .macRecordMenu(macMenu)
            .macRefresh { Task { await store.load(fresh: true) } }
            .task { await store.load() }
        )
    }

    private func macDialogs<Content: View>(_ content: Content) -> some View {
        content.alert("This piece has changes that are not saved", isPresented: $macAsk) {
            Button("Discard Changes", role: .destructive) {
                if let pending = macPending { macSettled = pending; macSelection = pending }
                macPending = nil
            }
            Button("Cancel", role: .cancel) { macPending = nil }
        } message: {
            Text("Save them first (⌘S), or discard them to go to the other piece.")
        }
    }

    // MARK: Actions

    private var macPicked: WebsiteEditPiece? {
        macSelection.count == 1 ? macSelection.first.flatMap { id in store.piece(id) } : nil
    }

    private var macSave: MacAction {
        MacAction("Save to the Website", symbol: "square.and.arrow.down", shortcut: KeyboardShortcut("s", modifiers: .command),
                  enabled: macSelection.count == 1 && macBridge.canSave, isDefault: true) { macBridge.save?() }
    }

    private func macOpenWindowAction(_ p: WebsiteEditPiece?) -> MacAction {
        MacAction("Open in Window", symbol: "macwindow.badge.plus", enabled: p != nil && openPlace != nil, id: "open-window") {
            if let p, let openPlace { openPlace(Route(path: WebsiteEditScreen.piecePath(p.id))) }
        }
    }

    private func macOpenSiteAction(_ p: WebsiteEditPiece?) -> MacAction {
        MacAction("Open on \(store.siteName)", symbol: "safari", enabled: !(p?.url ?? "").isEmpty, id: "open-site") {
            if let p, let url = URL(string: p.url) { NSWorkspace.shared.open(url) }
        }
    }

    private func macCopyNameAction(_ p: WebsiteEditPiece?) -> MacAction {
        MacAction("Copy the Name", symbol: "doc.on.doc", enabled: p != nil, id: "copy-name") { if let p { MacClipboard.copy(p.words.name) } }
    }

    private var macMenu: MacRecordMenu {
        let p = macPicked
        return MacRecordMenu(title: "Piece", groups: [[macSave], [macOpenWindowAction(p), macOpenSiteAction(p), macCopyNameAction(p)]])
    }

    // The filter and the recent changes; saving is the inspector's foot, ⌘S and the Piece menu (not the toolbar's).
    @ToolbarContentBuilder
    private var macToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            macFilterMenu
            if !store.recent.isEmpty {
                Menu {
                    ForEach(store.recent.prefix(15)) { (r: WebsiteEditRecent) in
                        Button((r.name.isEmpty ? "A piece" : r.name) + " · " + WebsiteEditScreen.recentWords(r)) { macSelection = [r.key] }
                    }
                } label: { Label("Recent Changes", systemImage: "clock.arrow.circlepath") }
                .help("What was changed lately, and by whom")
            }
        }
    }

    private var macFilterMenu: some View {
        let tally = macCounts
        return Menu {
            Section("Show") {
                Picker("Show", selection: $filter) {
                    Text("Everything").tag(Filter.all)
                    Text("Changed Here (\(tally.changed))").tag(Filter.changed)
                    Text("Hidden (\(tally.hidden))").tag(Filter.hidden)
                }
                .pickerStyle(.inline)
            }
            Section("Collection") {
                Picker("Collection", selection: $collection) {
                    Text("Every Collection").tag("")
                    ForEach(collections, id: \.self) { (c: String) in Text(c).tag(c) }
                }
                .pickerStyle(.inline)
            }
            Section("Sort by") {
                Picker("Sort by", selection: $macOrder) {
                    ForEach(MacWebsiteOrder.allCases) { (o: MacWebsiteOrder) in Text(o.title).tag(o) }
                }
                .pickerStyle(.inline)
            }
        } label: {
            Label("Filter", systemImage: filter == .all && collection.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("Everything, what was changed here or what is hidden; one collection")
    }

    // MARK: The table

    /// The rows in the table's order.
    private var macRows: [MacWebsitePieceRow] {
        macMade([MacWebsiteKey.pieces(store.pieces), search.hashValue, filter.hashValue, collection.hashValue, macOrder.hashValue]) {
            filtered.map { (p: WebsiteEditPiece) in MacWebsitePieceRow(piece: p) }.sorted(using: macOrder.comparators)
        }
    }

    /// How many pieces were changed here and how many are hidden.
    private var macCounts: (changed: Int, hidden: Int) {
        let both = macTally([MacWebsiteKey.pieces(store.pieces)]) {
            [store.pieces.filter { (p: WebsiteEditPiece) in p.changed }.count, store.pieces.filter { (p: WebsiteEditPiece) in p.hidden }.count]
        }
        return (changed: both[0], hidden: both[1])
    }

    /// Kept for the grid's shared call; the table is made from the memoized rows.
    func macPieces(_ items: [WebsiteEditPiece]) -> some View { macTable }

    private var macTable: some View {
        let rows = macRows
        let tally = macCounts
        return ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(rows) { (r: MacWebsitePieceRow) in macCard(r) }
            }
            .padding(20)
        }
        .background(Theme.ground)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.return) {
            guard !macSelection.isEmpty else { return .ignored }
            for id in macSelection.prefix(3) { openPlace?(Route(path: WebsiteEditScreen.piecePath(id))) }
            return .handled
        }
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView("Nothing matches", systemImage: "square.grid.2x2", description: Text("Clear the search, or pick another collection."))
            }
        }
        .macSearchable(text: $search, prompt: "Name, collection, ruby, Ring 12…")
        .macSummaryBar(["\(rows.count) of \(store.pieces.count) pieces", "\(tally.changed) changed here", "\(tally.hidden) hidden",
                        "It shows on \(store.siteName) within a minute; the original photo is kept to put back"])
        .macInspector { macInspectorBody }
        .onChange(of: macSelection) { _, new in macSelectionChanged(new) }
    }

    /// The iPhone's tile on a card: a click picks it (⌘-click adds), a double-click opens it in a window, right-click gives the rest.
    private func macCard(_ r: MacWebsitePieceRow) -> some View {
        let on = macSelection.contains(r.id)
        return WebsiteEditTile(piece: r.piece)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .houseCard()
            .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Theme.accent, lineWidth: on ? 2 : 0))
            .contentShape(Rectangle())
            .onTapGesture {
                if NSEvent.modifierFlags.contains(.command) {
                    if on { macSelection.remove(r.id) } else { macSelection.insert(r.id) }
                } else {
                    macSelection = [r.id]
                }
            }
            .simultaneousGesture(TapGesture(count: 2).onEnded { openPlace?(Route(path: WebsiteEditScreen.piecePath(r.id))) })
            .pointerHover()
            .contextMenu {
                MacActionItems(groups: [[macOpenWindowAction(r.piece), macOpenSiteAction(r.piece)], [macCopyNameAction(r.piece)]])
            }
    }

    /// Going to another piece while this one has words not saved asks first, as a document does on closing; the pick stays until it is answered.
    private func macSelectionChanged(_ new: Set<String>) {
        if new == macSettled { return }
        if macSettled.count == 1, macBridge.dirty {
            macPending = new
            macSelection = macSettled
            macAsk = true
        } else {
            macSettled = new
        }
    }

    @ViewBuilder
    private var macInspectorBody: some View {
        if macSelection.count == 1, let id = macSelection.first {
            WebsiteEditPieceScreen(id: id, inInspector: true, macBridge: macBridge).id(id)
        } else if macSelection.count > 1 {
            MacInspectorEmpty(title: "\(macSelection.count) pieces picked", detail: "Pick one to change its words, weight or photograph.")
        } else {
            MacInspectorEmpty(title: "No piece picked", detail: "Pick a piece to change what the website says about it.")
        }
    }
}
#endif
