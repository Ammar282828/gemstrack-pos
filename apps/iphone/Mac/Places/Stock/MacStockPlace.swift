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
    @State private var sort = [KeyPathComparator(\MacStockPlaceRow.sku)]
    @State private var made = Memo<MacStockPlaceRows>()
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
        // Every piece is priced at today's rates, so the rows wait for a change of the rates as well as the stock.
        let key: [Int] = [book.products.revision, book.settings.revision, query.hashValue, (category ?? "\u{0}all").hashValue, sort.hashValue]
        return made(key) {
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
            rows.sort(using: sort)
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

    private func worthWords(_ total: Double, known: Bool) -> String { known ? Money.pkrLac(total) : "\u{2014}" }

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
            ContentUnavailableView("No Pieces Yet", systemImage: "tag", description: Text("Choose New Piece to begin."))
        }
    }

    private func table(_ data: MacStockPlaceRows) -> some View {
        Table(data.rows, selection: $selection, sortOrder: $sort) {
            TableColumn("SKU", value: \.sku) { (r: MacStockPlaceRow) in Text(r.sku).monospacedDigit() }
                .width(min: 90, ideal: 110)
            TableColumn("Name", value: \.name) { (r: MacStockPlaceRow) in Text(r.name).lineLimit(1) }
            TableColumn("Category", value: \.category) { (r: MacStockPlaceRow) in Text(r.category).lineLimit(1) }
                .width(min: 80, ideal: 120)
            TableColumn("Metal", value: \.metal) { (r: MacStockPlaceRow) in Text(r.metal).lineLimit(1) }
                .width(min: 70, ideal: 100)
            TableColumn("Weight", value: \.weight) { (r: MacStockPlaceRow) in
                Text(StockKit.grams(r.weight)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Price today", value: \.price) { (r: MacStockPlaceRow) in
                Text(r.price > 0 ? Money.pkr(r.price) : "").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 100, ideal: 130)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if !ids.isEmpty { MacActionItems(groups: actionGroups(Array(ids))) }
        } primaryAction: { ids in
            open(Array(ids))
        }
    }

    // MARK: The gallery

    private func gallery(_ data: MacStockPlaceRows) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130, maximum: 190), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(data.rows) { (r: MacStockPlaceRow) in
                    galleryCell(r, data)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color.clear.contentShape(Rectangle()).onTapGesture { selection = [] })
        }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.return) {
            open(Array(selection))
            return .handled
        }
    }

    private func galleryCell(_ r: MacStockPlaceRow, _ data: MacStockPlaceRows) -> some View {
        let picked = selection.contains(r.id)
        return VStack(spacing: 4) {
            StockImage(imageUrl: r.product.imageUrl, name: r.product.name, key: r.sku)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous)
                        .strokeBorder(Theme.accent, lineWidth: picked ? 3 : 0)
                }
            Text(r.sku).font(.caption.monospaced()).lineLimit(1)
            Text(r.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(6)
        .background(picked ? Theme.accent.opacity(0.14) : Color.clear, in: .rect(cornerRadius: Radius.chip, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { open([r.id]) }
        .onTapGesture { click(r, data.rows) }
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
            .help("The pieces as a table or as photographs")
        }
        ToolbarItem(placement: .automatic) {
            Picker("Category", selection: $category) {
                Text("All Categories").tag(String?.none)
                ForEach(categoryOptions()) { (c: StockKit.Category) in
                    Text(c.title).tag(Optional(c.id))
                }
            }
            .pickerStyle(.menu)
            .help("Show one category")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            MacToolbarAction(action: newAction)
            MacToolbarAction(action: bulkAction)
            MacToolbarAction(action: sellAction(Array(selection)))
            MacToolbarAction(action: printAction(Array(selection), now: false))
        }
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
        return Form {
            Section {
                MacInspectorHeader(
                    title: p.name.isEmpty ? p.sku : p.name,
                    subtitle: p.sku + " \u{00B7} " + StockKit.categoryTitle(p.categoryId),
                    headline: MacHeadline("At today's rates", MacStockPricing.words(MacStockPricing.total(p, settings))),
                    actions: [sellAction(skus), printAction(skus, now: false)]
                )
                photo(p)
            }
            MacStockDetailSections(product: p)
            MacStockPriceSection(product: p, settings: settings)
        }
        .formStyle(.grouped)
    }

    /// The photo: a picture file dropped on it replaces it (the form's own upload, saved at once).
    @ViewBuilder
    private func photo(_ p: Product) -> some View {
        let image = StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku, decodeDataURI: true)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
            .frame(maxWidth: .infinity)
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
        return Form {
            Section {
                MacInspectorHeader(
                    title: "\(picked.count) Pieces",
                    subtitle: StockKit.grams(grams) + " in all",
                    actions: [sellAction(skus), printAction(skus, now: false)]
                )
            }
            Section("Pieces") {
                ForEach(picked.prefix(40)) { (r: MacStockPlaceRow) in
                    LabeledContent(r.sku) { Text(r.name).lineLimit(1).foregroundStyle(.secondary) }
                }
                if picked.count > 40 {
                    Text("and \(picked.count - 40) more").foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }
}
#endif
