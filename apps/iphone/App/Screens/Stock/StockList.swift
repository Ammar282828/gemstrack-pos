import SwiftUI
import ERPCore

/// Grid or list, as the web offers (products/page.tsx `viewMode`). The web starts on the grid; a
/// phone starts on the list, which reads more pieces at a glance, and keeps the person's choice.
enum StockLayout: String {
    case list, grid
}

/// A piece with what it sells for today (nil until the shop's rates have arrived).
struct StockRowModel: Identifiable {
    let product: Product
    let price: Double?
    var id: String { product.sku }
}

/// Stock: every piece in the shop, what each sells for at today's rates, and what they come to
/// (src/app/products/page.tsx). Owners' screen by the ERP's own choice (nav.ts: staff read pieces
/// to sell them, but Stock is where pieces are priced, edited and removed). Adding and editing a piece
/// are the native product form (StockPieceForm), adding many at once is StockBulkAdd; a long press deletes one
/// behind the delete code (`deleteProduct`), as the piece page does.
struct StockList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @AppStorage("stock.layout") private var layoutRaw = StockLayout.list.rawValue
    @State private var search = ""
    /// nil is every category; "" is the pieces with none.
    @State private var category: String?
    @State private var go: Route?
    @State private var deletion: OwnerDeletion?
    @State private var note: Note?

    @Environment(\.layoutWidthClass) private var sizeClass
    @State private var width: CGFloat = 0
    @FocusState private var searching: Bool

    /// A window wide enough for cards (measured, not the size class alone: this screen is also a split view's ~400 pt
    /// content column, which stays a List).
    private var wide: Bool { sizeClass.isPadLayout && width >= 620 }

    private var layout: StockLayout {
        if wide { return .grid }
        return StockLayout(rawValue: layoutRaw) ?? .list
    }

    var body: some View {
        ShelfState(loaded: book.products.loaded, error: book.products.error, offline: book.products.offline) {
            content
        }
        .navigationTitle("Stock")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "Search by name or SKU")
        .searchFocused($searching)
        .background {
            Button("Search") { searching = true }
                .keyboardShortcut("f", modifiers: .command).opacity(0).accessibilityHidden(true)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .toolbar { toolbarButtons }
        .stockDestination($go)
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
        }
        .noteToast($note)
        .task {
            book.products.need()
            book.settings.need()
        }
    }

    @ToolbarContentBuilder
    private var toolbarButtons: some ToolbarContent {
        // A wide window is always cards, so the switch is for the narrow one.
        if !wide {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Motion.run(reduce: reduceMotion) {
                        layoutRaw = layout == .grid ? StockLayout.list.rawValue : StockLayout.grid.rawValue
                    }
                } label: {
                    Label(layout == .grid ? "List" : "Grid", systemImage: layout == .grid ? "list.bullet" : "square.grid.2x2")
                }
            }
        }
        if session.isOwner {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route(path: StockKit.addPath)) {
                    Label("Add piece", systemImage: "plus")
                }
            }
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let all: [Product] = book.products.items
        let rates: PricingRates? = StockKit.rates(book.settings.value)
        let shown: [StockRowModel] = rows(all, rates)
        Group {
            switch layout {
            case .list: listView(all, shown)
            case .grid: gridView(all, shown)
            }
        }
        .safeAreaBar(edge: .top, spacing: 0) { chipRow(all) }
    }

    /// Category and search, then each piece priced at today's rates.
    private func rows(_ all: [Product], _ rates: PricingRates?) -> [StockRowModel] {
        var kept: [Product] = all
        if let category {
            kept = kept.filter { $0.categoryId == category }
        }
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty {
            kept = kept.filter { StockKit.matches($0, q) }
        }
        return kept.map { (p: Product) -> StockRowModel in
            StockRowModel(product: p, price: rates.map { StockKit.costs(p, $0).totalPrice })
        }
    }

    private var isFiltering: Bool {
        category != nil || !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func listView(_ all: [Product], _ shown: [StockRowModel]) -> some View {
        List { Group {
            Section { header(all, shown) }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            if !shown.isEmpty {
                Section {
                    ForEach(shown) { row in
                        StockRow(row: row, go: $go, mayEdit: session.isOwner, onDelete: askToDelete)
                    }
                }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay { if shown.isEmpty { emptyState } }
    }

    private func gridView(_ all: [Product], _ shown: [StockRowModel]) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                header(all, shown)
                if !shown.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: wide ? 220 : 160), spacing: 12)], spacing: 12) {
                        ForEach(shown) { row in
                            StockCard(row: row)
                                .stockContextMenu(row.product, go: $go, mayEdit: session.isOwner, onDelete: askToDelete)
                        }
                    }
                }
            }
            .padding(.horizontal, wide ? 24 : 16)
            .padding(.bottom, 16)
        }
        .overlay { if shown.isEmpty { emptyState } }
    }

    /// Nothing to show, over the list: a search with no hits, a category with none, or an empty shelf.
    @ViewBuilder
    private var emptyState: some View {
        let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            ContentUnavailableView.search(text: typed)
        } else if category != nil {
            EmptyState("No pieces here", symbol: "tag", message: "Nothing is in this category.",
                       action: (title: "Show all", run: { category = nil }))
        } else {
            EmptyState("No pieces yet", symbol: "tag", message: "Add a piece to begin.")
        }
    }

    // MARK: Count and worth

    /// "N pieces in stock" (the web's subtitle) and, for an owner, what they would sell for today.
    /// While a category or a search is on, both figures are of what is shown.
    private func header(_ all: [Product], _ shown: [StockRowModel]) -> some View {
        FigureRow(spacing: 12) {
            FigureTile(
                label: "In stock",
                value: "\(shown.count) piece\(shown.count == 1 ? "" : "s")"
            )
            if session.isOwner {
                FigureTile(label: "Worth today", value: worth(shown))
            }
        }
    }

    private func worth(_ shown: [StockRowModel]) -> String {
        var total = 0.0
        for row in shown {
            guard let price = row.price else { return "—" }
            total += price
        }
        return Money.pkrLac(total)
    }

    // MARK: Category chips

    /// How many pieces each category holds (the web counts the whole stock, whatever is searched).
    private func categoryCounts(_ all: [Product]) -> [String: Int] {
        var counts: [String: Int] = [:]
        for p in all { counts[p.categoryId, default: 0] += 1 }
        return counts
    }

    /// A chip names its category without a count: the header already says how many are shown (rule 15).
    private func chipRow(_ all: [Product]) -> some View {
        let counts: [String: Int] = categoryCounts(all)
        let options: [StockKit.Category] = StockKit.categoryOptions(counts: counts, keep: category)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chipButton("All", id: nil)
                ForEach(options) { (c: StockKit.Category) in
                    chipButton(c.title, id: c.id)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    private func chipButton(_ title: String, id: String?) -> some View {
        FilterChip(title: title, chosen: category == id) { category = id }
    }

    // MARK: Delete

    /// The code first, then the ERP deletes it; the owners' shelf is live, so the row goes by itself. The web's toast.
    private func askToDelete(_ p: Product) {
        deletion = StockKit.deletion(p) {
            Note.show(Note(title: "Piece deleted", detail: "\(p.sku) is deleted."), in: $note, reduce: reduceMotion)
        }
    }
}

// MARK: Rows

extension View {
    /// What a long press offers on a piece: sell it (onto the sale in progress, as Scan does), or
    /// (owners) edit it (the native form) or delete it (`onDelete`, which asks for the delete code).
    fileprivate func stockContextMenu(_ p: Product, go: Binding<Route?>, mayEdit: Bool, onDelete: @escaping (Product) -> Void) -> some View {
        contextMenu {
            // Selling is the owners' (createInvoice): staff are not offered a sale they cannot save.
            if mayEdit {
                Button {
                    SaleDraftStore.add(p)
                    go.wrappedValue = Route(path: StockKit.newSalePath)
                } label: {
                    Label("Sell", systemImage: "cart")
                }
            }
            if mayEdit {
                Button { go.wrappedValue = Route(path: StockKit.editPath(p.sku)) } label: { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive) { onDelete(p) } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }
}

/// A price, or why there is none: "Price N/A" for a piece that prices at nothing, a dash while the
/// rates have not arrived.
private struct StockPrice: View {
    let price: Double?

    var body: some View {
        if let price, price > 0 {
            Text(Money.pkr(price))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        } else {
            Text(price == nil ? "—" : "Price N/A")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// One piece in the list: its photo, name and SKU, its metal, weight and category, today's price.
private struct StockRow: View {
    let row: StockRowModel
    @Binding var go: Route?
    let mayEdit: Bool
    let onDelete: (Product) -> Void

    var body: some View {
        let p = row.product
        NavigationLink(value: Route(path: StockKit.piecePath(p.sku))) {
            HStack(spacing: 12) {
                StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku)
                    .frame(width: 52, height: 52)
                    .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                    .zoomSource(id: StockKit.piecePath(p.sku))
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(.body.weight(.medium)).lineLimit(2)
                    Text(p.sku).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                    Text(detail(p)).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                StockPrice(price: row.price).layoutPriority(1)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if mayEdit {
                Button {
                    SaleDraftStore.add(p)
                    go = Route(path: StockKit.newSalePath)
                } label: {
                    Label("Sell", systemImage: "cart")
                }
                .tint(Tone.settled.color)
            }
            if mayEdit {
                Button { go = Route(path: StockKit.editPath(p.sku)) } label: { Label("Edit", systemImage: "pencil") }
                    .tint(Theme.accent)
                // The delete code is asked next (OwnerDeleteCodeSheet): that is the confirmation.
                Button(role: .destructive) { onDelete(p) } label: { Label("Delete", systemImage: "trash") }
            }
        }
        .stockContextMenu(p, go: $go, mayEdit: mayEdit, onDelete: onDelete)
    }

    /// "Gold 21K · 3.4g · Rings".
    private func detail(_ p: Product) -> String {
        [StockKit.metalLine(p), StockKit.grams(p.metalWeightG), StockKit.categoryTitle(p.categoryId)].joined(separator: " · ")
    }
}

/// One piece as a card in the grid.
private struct StockCard: View {
    let row: StockRowModel

    var body: some View {
        let p = row.product
        NavigationLink(value: Route(path: StockKit.piecePath(p.sku))) {
            VStack(alignment: .leading, spacing: 6) {
                StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
                    .zoomSource(id: StockKit.piecePath(p.sku))
                Text(p.name).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                Text(p.sku).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                Text("\(StockKit.metalLine(p)) · \(StockKit.grams(p.metalWeightG))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                StockPrice(price: row.price)
            }
            .ledgerCard(padding: 10)
        }
        .buttonStyle(.plain)
        .hoverEffect()
    }
}
