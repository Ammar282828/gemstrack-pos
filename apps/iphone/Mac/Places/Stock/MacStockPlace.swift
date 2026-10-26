#if os(macOS)
import SwiftUI
import AppKit
import ERPCore

// Stock on the Mac (docs/features/mac-design.md, "Stock"): the pieces in the shop as a Table or a Gallery (the toolbar's
// switch, remembered), a Category pop-up and the toolbar's search, the picked pieces in the inspector (their photo, what
// they are made of, what they sell for at today's rates and how that adds up), and every action of a piece declared once
// as a `MacAction` in the Piece menu, the toolbar, the right-click menu and the inspector. It replaces MacHub's
// `MacStockTable`. The logic is the iPhone's: StockKit's pricing, SaleDraftStore for Sell, `StockKit.deletion` for the
// delete code, MacPrint for the tags, StockPhotoDrop for the photo.

/// The two views of Stock, chosen in the toolbar.
enum MacStockView: String, CaseIterable, Identifiable {
    case table, gallery
    /// The key the choice is kept under (this Mac's), which View › as Table / as Gallery writes too.
    static let key = "mac.stock.view"
    var id: String { rawValue }
    var title: String { self == .table ? "Table" : "Gallery" }
    var symbol: String { self == .table ? "list.bullet" : "square.grid.2x2" }
}

/// One piece as a row: the words its columns sort by, and what it sells for at today's rates.
struct MacStockPlaceRow: Identifiable {
    let product: Product
    /// What it sells for at today's rates; 0 while the rates have not arrived or when it prices at nothing.
    let price: Double
    let category: String
    let metal: String
    var id: String { product.sku }
    var sku: String { product.sku }
    var name: String { product.name }
    var weight: Double { product.metalWeightG }

    init(_ p: Product, rates: PricingRates?) {
        product = p
        price = rates.map { StockKit.costs(p, $0).totalPrice } ?? 0
        category = StockKit.categoryTitle(p.categoryId)
        metal = StockKit.metalLine(p)
    }
}

/// The rows Stock shows, worked out once per change of the stock, the rates, the search, the category and the sort.
struct MacStockPlaceRows {
    var rows: [MacStockPlaceRow] = []
    var byId: [String: MacStockPlaceRow] = [:]
    /// What the pieces shown would sell for today; nil while the rates have not arrived.
    var worth: Double?
}

struct MacStockPlace: View {
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openPlaceWindow) private var openPlace
    @AppStorage(MacStockView.key) private var viewRaw = MacStockView.table.rawValue
    @State private var query = ""
    /// nil is every category; "" is the pieces with none.
    @State private var category: String?
    @State private var selection = Set<String>()
    /// Where a shift-click in the gallery starts from.
    @State private var anchor: String?
    /// The shelf's own order (the iPhone's) unless the Filter menu says otherwise.
    @State private var sort: [KeyPathComparator<MacStockPlaceRow>] = []
    @State private var made = Memo<MacStockPlaceRows>()
    /// The rows in the table's order: a change of sort sorts again, it never prices the pieces again.
    @State private var ordered = Memo<[MacStockPlaceRow]>()
    @State private var categories = Memo<[StockKit.Category]>()
    @State private var deletion: OwnerDeletion?
    @State private var tagging: Product?
    @State private var replacing = false

    private var layout: MacStockView { MacStockView(rawValue: viewRaw) ?? .table }

    var body: some View {
        let data = rowData()
        ShelfState(loaded: book.products.loaded, error: book.products.error, offline: book.products.offline) {
            content(data)
        }
        .navigationTitle("Stock")
        .navigationSubtitle(subtitle(data))
        .macSearchable(text: $query, prompt: "Search Stock")
        .toolbar { toolbarItems(data) }
        .macInspector { inspector(data) }
        .macRecordMenu(MacRecordMenu(title: "Piece", groups: actionGroups(Array(selection))))
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) { selection = [] }
        }
        .sheet(item: $tagging) { (p: Product) in
            StockPieceTagSheet(product: p)
                .frame(minWidth: 460, minHeight: 520)
        }
        .task {
            book.products.need()
            book.settings.need()
        }
    }

    // MARK: The rows

    private func rowData() -> MacStockPlaceRows {
        // Every piece is priced at today's rates, so the rows wait for a change of the rates as well as the stock; the
        // pricing is kept across a change of the sort (only the order is made again).
        let key: [Int] = [book.products.revision, book.settings.revision, query.hashValue, (category ?? "\u{0}all").hashValue]
        let base = made(key) {
            let rates = StockKit.rates(book.settings.value)
            let words = query.lowercased().split(separator: " ").map(String.init)
            var out = MacStockPlaceRows()
            var rows: [MacStockPlaceRow] = []
            for p in book.products.items {
                if let category, p.categoryId != category { continue }
                if !words.isEmpty {
                    let fields: [String] = [p.sku, p.name, StockKit.categoryTitle(p.categoryId), p.description ?? "", p.stoneDetails ?? ""]
                    let text = fields.joined(separator: " ").lowercased()
                    if !words.allSatisfy({ text.contains($0) }) { continue }
                }
                rows.append(MacStockPlaceRow(p, rates: rates))
            }
            var byId: [String: MacStockPlaceRow] = [:]
            var worth = 0.0
            for r in rows {
                byId[r.id] = r
                worth += r.price
            }
            out.rows = rows
            out.byId = byId
            out.worth = rates == nil ? nil : worth
            return out
        }
        var out = base
        out.rows = ordered(key + [sort.hashValue]) { base.rows.sorted(using: sort) }
        return out
    }

    /// The categories that have pieces, in the ERP's order (a chosen one stays even when emptied).
    private func categoryOptions() -> [StockKit.Category] {
        let key: [Int] = [book.products.revision, (category ?? "\u{0}all").hashValue]
        return categories(key) {
            var counts: [String: Int] = [:]
            for p in book.products.items { counts[p.categoryId, default: 0] += 1 }
            return StockKit.categoryOptions(counts: counts, keep: category)
        }
    }

    private func subtitle(_ data: MacStockPlaceRows) -> String {
        let n = data.rows.count
        return "\(n) piece\(n == 1 ? "" : "s")"
    }

    private func summary(_ data: MacStockPlaceRows) -> [String] {
        let picked = selection.compactMap { data.byId[$0] }
        if !picked.isEmpty {
            var parts = ["\(picked.count) of \(data.rows.count) selected"]
            if session.isOwner { parts.append(worthWords(picked.reduce(0) { $0 + $1.price }, known: data.worth != nil) + " today") }
            return parts
        }
        var parts = ["\(data.rows.count) piece\(data.rows.count == 1 ? "" : "s")"]
        if session.isOwner { parts.append(worthWords(data.worth ?? 0, known: data.worth != nil) + " worth today") }
        return parts
    }

    private func worthWords(_ total: Double, known: Bool) -> String { known ? Money.pkrLac(total, digits: 1) : "\u{2014}" }

    // MARK: The content

    @ViewBuilder
    private func content(_ data: MacStockPlaceRows) -> some View {
        Group {
            if layout == .gallery { gallery(data) } else { table(data) }
        }
        .overlay {
            if data.rows.isEmpty { emptyState.allowsHitTesting(false) }
        }
        .macSummaryBar(summary(data))
    }

    @ViewBuilder
    private var emptyState: some View {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            ContentUnavailableView.search(text: typed)
        } else if category != nil {
            ContentUnavailableView("No Pieces Here", systemImage: "tag", description: Text("Nothing is in this category."))
        } else {
            ContentUnavailableView("No Pieces Yet", systemImage: "tag",
                                   description: Text(session.isOwner ? "Make a piece with \u{2303}\u{2318}N." : "The owner adds pieces to the stock."))
        }
    }

    /// The iPhone's rows: the photo, the name over its SKU and what it is made of, today's price at the right.
    private func table(_ data: MacStockPlaceRows) -> some View {
        List(selection: $selection) {
            ForEach(data.rows) { (r: MacStockPlaceRow) in
                listRow(r)
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.isEmpty {
                // The empty part of the table: what is not about one piece.
                MacActionItems(groups: [[newAction, bulkAction]])
            } else {
                MacActionItems(groups: actionGroups(Array(ids)))
            }
        } primaryAction: { ids in
            open(Array(ids))
        }
        .macOpensOnReturn(selection) { (ids: Set<String>) in open(Array(ids)) }
    }

    private func listRow(_ r: MacStockPlaceRow) -> some View {
        HStack(spacing: 10) {
            StockImage(imageUrl: r.product.imageUrl, name: r.product.name, key: r.sku)
                .frame(width: 36, height: 36)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name.isEmpty ? r.sku : r.name).font(.body).lineLimit(1)
                Text(r.sku + " \u{00B7} " + detail(r)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            price(r)
        }
        .padding(.vertical, 3)
        .tag(r.id)
        .houseRows()
    }

    /// "Gold 21K \u{00B7} 3.4g \u{00B7} Rings".
    private func detail(_ r: MacStockPlaceRow) -> String {
        [r.metal, StockKit.grams(r.weight), r.category].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    /// A price, or why there is none: "Price N/A" for a piece that prices at nothing, a dash while the rates have not come.
    @ViewBuilder
    private func price(_ r: MacStockPlaceRow) -> some View {
        if r.price > 0 {
            RowAmount(amount: r.price)
        } else {
            Text(rates == nil ? "\u{2014}" : "Price N/A").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var rates: PricingRates? { StockKit.rates(book.settings.value) }

    /// The Sort by pick: 0 is the shelf's order.
    private var sortChoice: Binding<Int> {
        Binding(
            get: {
                guard let first = sort.first else { return 0 }
                let k: AnyKeyPath = first.keyPath
                if k == (\MacStockPlaceRow.sku as AnyKeyPath) { return 1 }
                if k == (\MacStockPlaceRow.name as AnyKeyPath) { return 2 }
                if k == (\MacStockPlaceRow.price as AnyKeyPath) { return 3 }
                return 4
            },
            set: { (n: Int) in
                switch n {
                case 1: sort = [KeyPathComparator(\MacStockPlaceRow.sku)]
                case 2: sort = [KeyPathComparator(\MacStockPlaceRow.name)]
                case 3: sort = [KeyPathComparator(\MacStockPlaceRow.price, order: .reverse)]
                case 4: sort = [KeyPathComparator(\MacStockPlaceRow.weight, order: .reverse)]
                default: sort = []
                }
            }
        )
    }

    // MARK: The gallery

    private func gallery(_ data: MacStockPlaceRows) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 240), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(data.rows) { (r: MacStockPlaceRow) in
                    galleryCell(r, data)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color.clear.contentShape(Rectangle()).onTapGesture { selection = [] })
        }
        .background(Theme.ground)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.return) {
            open(Array(selection))
            return .handled
        }
    }

    private func galleryCell(_ r: MacStockPlaceRow, _ data: MacStockPlaceRows) -> some View {
        let picked = selection.contains(r.id)
        return VStack(alignment: .leading, spacing: 6) {
            StockImage(imageUrl: r.product.imageUrl, name: r.product.name, key: r.sku)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            Text(r.name.isEmpty ? r.sku : r.name).font(.body.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
            Text(r.sku).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
            Text(r.metal + " \u{00B7} " + StockKit.grams(r.weight)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            price(r)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Theme.accent, lineWidth: picked ? 2.5 : 0)
                .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        // The click picks at once; the second click of a double-click opens (two exclusive gestures would hold the pick back
        // by the double-click interval).
        .onTapGesture { click(r, data.rows) }
        .simultaneousGesture(TapGesture(count: 2).onEnded { open([r.id]) })
        .contextMenu {
            MacActionItems(groups: actionGroups(selection.contains(r.id) ? Array(selection) : [r.id]))
        }
        .help(r.name.isEmpty ? r.sku : r.name)
    }

    /// A click picks the piece; ⌘ adds it to or takes it from the pieces picked; ⇧ picks everything between.
    private func click(_ r: MacStockPlaceRow, _ rows: [MacStockPlaceRow]) {
        let flags = NSEvent.modifierFlags
        if flags.contains(.command) {
            if selection.contains(r.id) { selection.remove(r.id) } else { selection.insert(r.id) }
            anchor = r.id
        } else if flags.contains(.shift), let a = anchor,
                  let i = rows.firstIndex(where: { $0.id == a }), let j = rows.firstIndex(where: { $0.id == r.id }) {
            selection = Set(rows[min(i, j)...max(i, j)].map { $0.id })
        } else {
            selection = [r.id]
            anchor = r.id
        }
    }

    // MARK: The toolbar

    @ToolbarContentBuilder
    private func toolbarItems(_ data: MacStockPlaceRows) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("View", selection: $viewRaw) {
                ForEach(MacStockView.allCases) { (v: MacStockView) in
                    Label(v.title, systemImage: v.symbol).tag(v.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .help("The pieces as a table or as photographs (\u{2303}\u{2318}1, \u{2303}\u{2318}2)")
        }
        // New and the one filter, as every list has them. The picked pieces' Sell and Print are the inspector's, the Piece
        // menu's and the right-click menu's, never the toolbar's; Add in Bulk is the Piece menu's and the empty table's.
        ToolbarItemGroup(placement: .automatic) {
            Button { openRoute(StockKit.addPath) } label: { Label("New Piece", systemImage: "plus") }
                .disabled(!session.isOwner)
                .help("New piece (\u{2303}\u{2318}N)")
            filterMenu
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("Category", selection: $category) {
                Text("All Categories").tag(String?.none)
                ForEach(categoryOptions()) { (c: StockKit.Category) in
                    Text(c.title).tag(Optional(c.id))
                }
            }
            .pickerStyle(.inline)
            Divider()
            Picker("Sort by", selection: sortChoice) {
                Text("As the Shelf Has Them").tag(0)
                Text("SKU").tag(1)
                Text("Name").tag(2)
                Text("Price, Highest First").tag(3)
                Text("Weight, Heaviest First").tag(4)
            }
            .pickerStyle(.inline)
        } label: {
            Label("Filter", systemImage: category == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("Show one category")
    }

    // MARK: The actions, declared once

    private var newAction: MacAction {
        MacAction("New Piece\u{2026}", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                  enabled: session.isOwner) { openRoute(StockKit.addPath) }
    }

    private var bulkAction: MacAction {
        MacAction("Add in Bulk\u{2026}", symbol: "square.stack.3d.up", enabled: session.isOwner) { openRoute(StockKit.bulkAddPath) }
    }

    private func sellAction(_ skus: [String]) -> MacAction {
        MacAction("Sell", symbol: "cart", enabled: session.isOwner && !skus.isEmpty, isDefault: true) { sell(skus) }
    }

    private func printAction(_ skus: [String], now: Bool) -> MacAction {
        if now {
            return MacAction(skus.count > 1 ? "Print \(skus.count) Tags Now" : "Print Tag Now", symbol: "printer.fill",
                             shortcut: KeyboardShortcut("p", modifiers: [.command, .option]), enabled: !skus.isEmpty) { printTags(skus, now: true) }
        }
        return MacAction(skus.count > 1 ? "Print \(skus.count) Tags\u{2026}" : "Print Tag\u{2026}", symbol: "printer",
                         shortcut: KeyboardShortcut("p", modifiers: .command), enabled: !skus.isEmpty) { printTags(skus, now: false) }
    }

    /// Every action of a piece, for the menu bar (the pieces picked) and the right-click menu (the pieces clicked).
    private func actionGroups(_ skus: [String]) -> [[MacAction]] {
        let owner = session.isOwner
        let one = skus.count == 1
        let some = !skus.isEmpty
        let making: [MacAction] = [newAction, bulkAction]
        let selling: [MacAction] = [sellAction(skus), printAction(skus, now: false), printAction(skus, now: true)]
        let editAction = MacAction("Edit", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command), enabled: owner && one) { edit(skus) }
        let windowAction = MacAction("Open in New Window", symbol: "macwindow.badge.plus", enabled: some) { open(skus) }
        let copyAction = MacAction(skus.count > 1 ? "Copy SKUs" : "Copy SKU", symbol: "doc.on.doc", enabled: some) { copy(skus) }
        let qrAction = MacAction("Show QR\u{2026}", symbol: "qrcode", enabled: one) { showTag(skus) }
        let csvAction = MacAction("Export Tag CSV\u{2026}", symbol: "arrow.down.doc", enabled: one) { showTag(skus) }
        let deleteAction = MacAction("Delete\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive,
                               enabled: owner && one) { remove(skus) }
        return [making, selling, [editAction, windowAction], [copyAction, qrAction, csvAction], [deleteAction]]
    }

    // MARK: What the actions do

    private func openRoute(_ path: String) { openPlace?(Route(path: path)) }

    /// Return and a double-click open the piece in a window of its own (up to five at once).
    private func open(_ skus: [String]) {
        for sku in skus.sorted().prefix(5) { openRoute(StockKit.piecePath(sku)) }
    }

    private func edit(_ skus: [String]) {
        guard session.isOwner, skus.count == 1, let sku = skus.first else { return }
        openRoute(StockKit.editPath(sku))
    }

    /// Puts the pieces on the sale in progress (the New sale window's own draft, as Scan does) and opens it.
    private func sell(_ skus: [String]) {
        guard session.isOwner else { return }
        for sku in skus.sorted() {
            if let p = book.products.item(sku) { SaleDraftStore.add(p) }
        }
        openRoute(StockKit.newSalePath)
    }

    private func printTags(_ skus: [String], now: Bool) {
        let list = skus.sorted()
        Task { await MacPrint.printTags(list, now: now) }
    }

    private func copy(_ skus: [String]) {
        UIPasteboard.general.string = skus.sorted().joined(separator: "\n")
    }

    private func showTag(_ skus: [String]) {
        guard skus.count == 1, let sku = skus.first, let p = book.products.item(sku) else { return }
        tagging = p
    }

    private func remove(_ skus: [String]) {
        guard session.isOwner, skus.count == 1, let sku = skus.first, let p = book.products.item(sku) else { return }
        deletion = StockKit.deletion(p)
    }

    // MARK: The inspector

    @ViewBuilder
    private func inspector(_ data: MacStockPlaceRows) -> some View {
        let picked = selection.compactMap { data.byId[$0] }
        if picked.count == 1, let row = picked.first {
            pieceInspector(row.product)
        } else if picked.isEmpty {
            MacInspectorEmpty(title: "No Piece Selected", detail: "Pick a piece to see its photo, what it is made of and what it sells for today.")
        } else {
            manyInspector(picked)
        }
    }

    private func pieceInspector(_ p: Product) -> some View {
        let settings = book.settings.value
        let skus = [p.sku]
        return MacWorkPage {
            photo(p)
            MacWorkHead(
                title: p.name.isEmpty ? p.sku : p.name,
                subtitle: p.sku + " \u{00B7} " + StockKit.categoryTitle(p.categoryId),
                figure: MacHeadline("At today's rates", MacStockPricing.words(MacStockPricing.total(p, settings)))
            ) {
                EmptyView()
            }
            MacActionButtons(actions: [sellAction(skus), printAction(skus, now: false)])
            MacStockDetailSections(product: p)
            MacStockPriceSection(product: p, settings: settings)
        }
    }

    /// The photo: a picture file dropped on it replaces it (the form's own upload, saved at once).
    @ViewBuilder
    private func photo(_ p: Product) -> some View {
        let image = StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku, decodeDataURI: true)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
            .frame(maxWidth: 240)
            .frame(maxWidth: .infinity)
            .padding(Metrics.cardPadding)
            .houseCard()
        if session.isOwner {
            image
                .modifier(StockPhotoDrop(sku: p.sku, choosing: $replacing))
                .contextMenu { Button("Replace Photo\u{2026}") { replacing = true } }
                .help("Drop a picture here to replace the photo")
        } else {
            image
        }
    }

    private func manyInspector(_ picked: [MacStockPlaceRow]) -> some View {
        let skus = picked.map { $0.id }
        let grams = picked.reduce(0) { $0 + $1.weight }
        return MacWorkPage {
            MacWorkHead(title: "\(picked.count) Pieces", subtitle: StockKit.grams(grams) + " in all") {
                Image(systemName: "square.stack.3d.up").font(.title2).foregroundStyle(Theme.accent)
            }
            MacActionButtons(actions: [sellAction(skus), printAction(skus, now: false)])
            MacWorkCard("Pieces", count: picked.count) {
                ForEach(picked.prefix(40)) { (r: MacStockPlaceRow) in
                    MacWorkFact(r.sku, r.name)
                }
                if picked.count > 40 {
                    Text("and \(picked.count - 40) more").foregroundStyle(.secondary)
                }
            }
        }
    }
}
#endif
