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
/// are the native product form (StockPieceForm); bulk adding, deleting and the label printer stay the
/// ERP's pages.
struct StockList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @AppStorage("stock.layout") private var layoutRaw = StockLayout.list.rawValue
    @State private var search = ""
    /// nil is every category; "" is the pieces with none.
    @State private var category: String?
    @State private var go: Route?

    private var layout: StockLayout { StockLayout(rawValue: layoutRaw) ?? .list }

    var body: some View {
        ShelfState(loaded: book.products.loaded, error: book.products.error, offline: book.products.offline) {
            content
        }
        .navigationTitle("Stock")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "Search by name or SKU")
        .toolbar { toolbarButtons }
        .stockDestination($go)
        .task {
            book.products.need()
            book.settings.need()
        }
    }

    @ToolbarContentBuilder
    private var toolbarButtons: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                layoutRaw = layout == .grid ? StockLayout.list.rawValue : StockLayout.grid.rawValue
            } label: {
                Label(layout == .grid ? "List" : "Grid", systemImage: layout == .grid ? "list.bullet" : "square.grid.2x2")
            }
            if session.isOwner {
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
        List {
            Section { header(all, shown) }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            if shown.isEmpty {
                Section { emptyState }
            } else {
                Section {
                    ForEach(shown) { row in
                        StockRow(row: row, go: $go, mayEdit: session.isOwner)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func gridView(_ all: [Product], _ shown: [StockRowModel]) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                header(all, shown)
                if shown.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                        ForEach(shown) { row in
                            StockCard(row: row)
                                .stockContextMenu(row.product, go: $go, mayEdit: session.isOwner)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "No pieces found",
            systemImage: "tag",
            description: Text(isFiltering ? "Try adjusting your search or filter." : "Add a piece to begin.")
        )
    }

    // MARK: Count and worth

    /// "N pieces in stock" (the web's subtitle) and, for an owner, what they would sell for today.
    /// While a category or a search is on, both figures are of what is shown.
    private func header(_ all: [Product], _ shown: [StockRowModel]) -> some View {
        HStack(spacing: 12) {
            FigureTile(
                label: "In stock",
                value: "\(shown.count) piece\(shown.count == 1 ? "" : "s")",
                detail: isFiltering ? "of \(all.count) in the shop" : nil
            )
            if session.isOwner {
                FigureTile(label: "Worth today", value: worth(shown), detail: "at today's rates")
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

    private func chipRow(_ all: [Product]) -> some View {
        let counts: [String: Int] = categoryCounts(all)
        let options: [StockKit.Category] = StockKit.categoryOptions(counts: counts, keep: category)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chipButton("All", count: all.count, id: nil)
                ForEach(options) { (c: StockKit.Category) in
                    chipButton(c.title, count: counts[c.id] ?? 0, id: c.id)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private func chipButton(_ title: String, count: Int, id: String?) -> some View {
        if category == id {
            Button { category = id } label: { chipLabel(title, count: count) }
                .buttonStyle(.houseProminent)
        } else {
            Button { category = id } label: { chipLabel(title, count: count) }
                .buttonStyle(.glass)
        }
    }

    private func chipLabel(_ title: String, count: Int) -> some View {
        HStack(spacing: 5) {
            Text(title)
            Text("\(count)").font(.caption).monospacedDigit().opacity(0.7)
        }
        .font(.subheadline.weight(.medium))
    }
}

// MARK: Rows

extension View {
    /// What a long press offers on a piece: sell it (onto the sale in progress, as Scan does), or
    /// (owners) edit it (the native form) or delete it (the ERP's page, which asks for the delete code).
    fileprivate func stockContextMenu(_ p: Product, go: Binding<Route?>, mayEdit: Bool) -> some View {
        contextMenu {
            Button {
                SaleDraftStore.add(p)
                go.wrappedValue = Route(path: StockKit.newSalePath)
            } label: {
                Label("Sell", systemImage: "cart")
            }
            if mayEdit {
                Button { go.wrappedValue = Route(path: StockKit.editPath(p.sku)) } label: { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive) { go.wrappedValue = Route(path: StockKit.piecePath(p.sku, web: true)) } label: {
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
                .lineLimit(1)
                .minimumScaleFactor(0.7)
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

    var body: some View {
        let p = row.product
        NavigationLink(value: Route(path: StockKit.piecePath(p.sku))) {
            HStack(spacing: 12) {
                StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku)
                    .frame(width: 52, height: 52)
                    .clipShape(.rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(.body.weight(.medium)).lineLimit(2)
                    Text(p.sku).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                    Text(detail(p)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                StockPrice(price: row.price).layoutPriority(1)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button {
                SaleDraftStore.add(p)
                go = Route(path: StockKit.newSalePath)
            } label: {
                Label("Sell", systemImage: "cart")
            }
            .tint(.green)
            if mayEdit {
                Button { go = Route(path: StockKit.editPath(p.sku)) } label: { Label("Edit", systemImage: "pencil") }
                    .tint(.orange)
            }
        }
        .stockContextMenu(p, go: $go, mayEdit: mayEdit)
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
                    .clipShape(.rect(cornerRadius: 12))
                Text(p.name).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                Text(p.sku).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                Text("\(StockKit.metalLine(p)) · \(StockKit.grams(p.metalWeightG))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                StockPrice(price: row.price)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: .rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }
}
