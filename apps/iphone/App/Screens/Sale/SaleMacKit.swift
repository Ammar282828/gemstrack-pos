#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's New sale / Edit invoice window, its stock and its bill (docs/features/mac-design.md, "New sale"). Three regions
// in one document window: the stock at the left (the scanner's box, a table of the pieces), the bill in the centre (the
// pieces as a table, the totals under it), and the sale's panel at the right (Mac/Places/Sale/SaleMacPanel.swift). Every
// function the window calls is SaleForm's own (NewSale.swift, SaleSections.swift); only the arrangement is here.

// MARK: The stock

/// One piece of the stock as the table shows it, priced once for the rates in force.
struct SaleMacStockRow: Identifiable {
    let product: Product
    let price: Double
    let metal: String
    var id: String { product.sku }
    var sku: String { product.sku }
    var name: String { product.name }
    var weight: Double { product.metalWeightG }

    init(_ p: Product, rates: PricingRates) {
        product = p
        price = calculateProductCosts(PricedPiece(p), rates).totalPrice
        metal = describeMetal(p.metalType, p.karat)
    }
}

/// The stock column: the scanner's box (a USB barcode scanner types the SKU and presses Return, which adds the piece
/// exactly as typing it does), the stock as a sortable table (double-click or Return on a row adds it), Scan a Tag… and New
/// Item. The rows are made once per change of the stock, the rates, the search, the sort or the bill (`Memo`), never once
/// per drawing.
struct SaleMacStock: View {
    let products: [Product]
    /// `book.products.revision`: what the rows are keyed on, with the rates, the search, the sort and the bill's SKUs.
    let revision: Int
    /// SKUs already on the bill.
    let taken: Set<String>
    let pricing: PricingRates
    @Binding var query: String
    let notice: String?
    /// Goes up on Add Piece (⌘L): the box takes the keyboard.
    let focusAsks: Int
    let add: (Product) -> Void
    /// Return with something typed: SaleForm.addTyped.
    let submit: () -> Void
    /// Return with the box empty: Save Sale (it does nothing until the sale can be saved).
    let saveWhenEmpty: () -> Void
    let scan: () -> Void
    let newItem: () -> Void

    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.openWindow) private var openWindow
    @FocusState private var focus: Bool
    @State private var selection = Set<String>()
    @State private var sort: [KeyPathComparator<SaleMacStockRow>] = []
    @State private var priced = Memo<[String: SaleMacStockRow]>()
    @State private var shown = Memo<[SaleMacStockRow]>()
    /// When a piece last went on the sale: a scanner that ends its code with Return and a line feed presses Return twice,
    /// and the second one must never save the sale.
    @State private var lastAdded = Date.distantPast

    var body: some View {
        let rows = currentRows()
        VStack(spacing: 0) {
            scannerBox
            table(rows)
        }
        .macSummaryBar(summary(rows.count))
        .task {
            try? await Task.sleep(for: .milliseconds(200))
            focus = true
        }
        .onChange(of: focusAsks) { _, _ in focus = true }
    }

    // MARK: The rows

    private func currentRows() -> [SaleMacStockRow] {
        let rates = pricing
        let list = products
        let bySku = priced([revision, rates.hashValue]) { Self.priceAll(list, rates) }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let order = sort
        let skipped = taken
        return shown([revision, rates.hashValue, q.hashValue, skipped.hashValue, order.hashValue]) {
            Self.choose(list, bySku, q, skipped, order)
        }
    }

    private static func priceAll(_ products: [Product], _ rates: PricingRates) -> [String: SaleMacStockRow] {
        var out: [String: SaleMacStockRow] = [:]
        out.reserveCapacity(products.count)
        for p in products where out[p.sku] == nil {
            out[p.sku] = SaleMacStockRow(p, rates: rates)
        }
        return out
    }

    private static func choose(_ products: [Product], _ bySku: [String: SaleMacStockRow], _ q: String,
                               _ taken: Set<String>, _ order: [KeyPathComparator<SaleMacStockRow>]) -> [SaleMacStockRow] {
        let base: [Product]
        if q.isEmpty {
            base = products.filter { !taken.contains($0.sku) }
        } else {
            base = SaleLookup.matches(q, in: products, excluding: taken, limit: Int.max)
        }
        let rows = base.compactMap { bySku[$0.sku] }
        return order.isEmpty ? rows : rows.sorted(using: order)
    }

    private func summary(_ shownCount: Int) -> [String] {
        let left = max(0, products.count - taken.count)
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var parts = [q.isEmpty ? (left == 1 ? "1 piece" : "\(left) pieces") : "\(shownCount) of \(left) pieces"]
        if selection.count > 1 { parts.append("\(selection.count) picked") }
        return parts
    }

    // MARK: The box and its buttons

    private var scannerBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                TextField("Scan a tag, or search stock", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .focused($focus)
                    .onSubmit { returned() }
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .help("Clear the search")
                }
            }
            if let notice {
                Label(notice, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(Tone.problem.color)
            }
            HStack(spacing: 8) {
                Button { scan() } label: { Label("Scan a Tag…", systemImage: "qrcode.viewfinder") }
                    .help("Read a photo of a tag, or type its SKU")
                Button { newItem() } label: { Label("New Item", systemImage: "plus.circle") }
                    .help("A piece that is not in stock, described for this bill only")
                Spacer(minLength: 0)
            }
        }
        .padding(12)
    }

    /// Return in the box: with something typed it adds the piece; with the box empty it saves the sale, unless a piece
    /// went on a moment ago (a scanner's second Return).
    private func returned() {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.isEmpty {
            if Date().timeIntervalSince(lastAdded) > 2 { saveWhenEmpty() }
        } else {
            lastAdded = Date()
            submit()
        }
        focus = true
    }

    // MARK: The table

    private func table(_ rows: [SaleMacStockRow]) -> some View {
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Piece", value: \.name) { (row: SaleMacStockRow) in pieceCell(row) }
                .width(min: 120, ideal: 170)
            TableColumn("Weight", value: \.weight) { (row: SaleMacStockRow) in
                Text(row.weight > 0 ? SaleNumber.grams(row.weight) + " g" : "").monospacedDigit().lineLimit(1)
            }
            .width(min: 48, ideal: 62)
            TableColumn("Price", value: \.price) { (row: SaleMacStockRow) in
                MacAmount(row.price > 0 ? row.price : nil)
            }
            .width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: String.self) { skus in
            if !skus.isEmpty { MacActionItems(groups: menuGroups(for: skus)) }
        } primaryAction: { skus in addAll(skus) }
        .onKeyPress(.return) {
            guard !selection.isEmpty else { return .ignored }
            addAll(selection)
            return .handled
        }
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView(query.trimmingCharacters(in: .whitespaces).isEmpty ? "No stock to add" : "Nothing matches",
                                       systemImage: "magnifyingglass",
                                       description: Text("Press Return to bill what you typed as a new item."))
            }
        }
    }

    private func pieceCell(_ row: SaleMacStockRow) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(row.name).lineLimit(1)
            Text(row.metal.isEmpty ? row.sku : row.sku + " \u{00B7} " + row.metal)
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    /// The right-click menu of the picked pieces, as actions.
    private func menuGroups(for skus: Set<String>) -> [[MacAction]] {
        let one = skus.count == 1 ? skus.first : nil
        var groups: [[MacAction]] = [[
            MacAction(skus.count == 1 ? "Add to the Sale" : "Add \(skus.count) to the Sale", symbol: "plus") { addAll(skus) }
        ]]
        if let sku = one {
            groups.append([
                MacAction("Open Piece in New Window", symbol: "macwindow") { openPiece(sku) },
                MacAction("Copy SKU", symbol: "doc.on.doc") { UIPasteboard.general.string = sku },
            ])
        }
        return groups
    }

    private func addAll(_ skus: Set<String>) {
        for sku in skus.sorted() {
            if let p = products.first(where: { $0.sku == sku }) { add(p) }
        }
        lastAdded = Date()
        selection = []
    }

    private func openPiece(_ sku: String) {
        let route = SaleLinks.piece(sku)
        if let openPlace {
            openPlace(route)
        } else {
            openWindow(id: MacWindows.place, value: route)
        }
    }
}

// MARK: The bill

/// The bill as it stands: its pieces in a table (double-click or Return edits, ⌫ takes the picked off) with the totals
/// under it, always in view while the sale's panel is filled in.
struct SaleMacBill: View {
    let lines: [SaleLine]
    let figures: SaleFigures
    let spec: (SaleLine) -> String
    let isGone: (SaleLine) -> Bool
    @Binding var picked: Set<String>
    let edit: (SaleLine) -> Void
    let remove: (Set<String>) -> Void

    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 0) {
            table
            SaleMacTotals(figures: figures, pieces: lines.count)
        }
    }

    private var table: some View {
        Table(lines, selection: $picked) {
            TableColumn("Piece") { (line: SaleLine) in pieceCell(line) }
                .width(min: 120, ideal: 220)
            TableColumn("Details") { (line: SaleLine) in
                Text(spec(line)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            .width(min: 80, ideal: 160)
            TableColumn("Price") { (line: SaleLine) in
                MacAmount(figures.hasEstimate ? figures.price(of: line.sku) : nil)
            }
            .width(min: 70, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { skus in
            if !skus.isEmpty { MacActionItems(groups: menuGroups(for: skus)) }
        } primaryAction: { skus in
            if skus.count == 1, let sku = skus.first, let line = lines.first(where: { $0.sku == sku }) { edit(line) }
        }
        .onDeleteCommand { removePicked() }
        .overlay {
            if lines.isEmpty {
                ContentUnavailableView("Nothing on the bill yet", systemImage: "cart",
                                       description: Text("Scan a tag or pick a piece from the stock."))
            }
        }
    }

    private func pieceCell(_ line: SaleLine) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(line.name.isEmpty ? (line.stockSku ?? "New piece") : line.name).fontWeight(.medium).lineLimit(1)
            if isGone(line) {
                Label("No longer in stock", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Tone.problem.color)
            } else if line.isCustomPrice {
                Text("Fixed price").font(.caption).foregroundStyle(Tone.owed.color)
            }
        }
    }

    /// The right-click menu of the picked pieces, as actions.
    private func menuGroups(for skus: Set<String>) -> [[MacAction]] {
        var groups: [[MacAction]] = []
        if skus.count == 1, let sku = skus.first, let line = lines.first(where: { $0.sku == sku }) {
            groups.append([MacAction("Edit Piece…", symbol: "pencil") { edit(line) }])
            if !line.isOneOff {
                groups.append([
                    MacAction("Open Piece in New Window", symbol: "macwindow") { openPiece(sku) },
                    MacAction("Copy SKU", symbol: "doc.on.doc") { UIPasteboard.general.string = sku },
                ])
            }
        }
        groups.append([
            MacAction(skus.count == 1 ? "Remove from the Sale" : "Remove \(skus.count) from the Sale", symbol: "minus.circle", role: .destructive) {
                remove(skus)
            }
        ])
        return groups
    }

    private func removePicked() {
        guard !picked.isEmpty else { return }
        remove(picked)
        picked = []
    }

    private func openPiece(_ sku: String) {
        let route = SaleLinks.piece(sku)
        if let openPlace {
            openPlace(route)
        } else {
            openWindow(id: MacWindows.place, value: route)
        }
    }
}

/// Subtotal to balance, as the bill will read: a block of plain rows at the right, under the Price column.
struct SaleMacTotals: View {
    let figures: SaleFigures
    let pieces: Int

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(alignment: .top, spacing: 16) {
                Text(pieces == 1 ? "1 piece" : "\(pieces) pieces")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                rows.frame(minWidth: 220, idealWidth: 300, maxWidth: 300)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    private var rows: some View {
        let f = figures
        return VStack(spacing: 3) {
            row("Subtotal", money(f.subtotal))
            row("Discount", f.discount != 0 ? money(-f.discount, signed: true) : "—")
            row("Exchange", f.exchange != 0 ? money(-f.exchange, signed: true) : "—")
            row("Total", money(f.total), strong: true)
            row("Paid now", f.paidNow > 0 ? money(f.paidNow) : "—")
            balanceRow
        }
    }

    /// A sum, or the words for a sale that cannot be priced yet.
    private func money(_ value: Double, signed: Bool = false) -> String {
        guard figures.hasEstimate else { return "Pending rates" }
        return signed ? Money.signed(value) : Money.pkr(value)
    }

    @ViewBuilder
    private var balanceRow: some View {
        let f = figures
        if f.hasEstimate {
            let line = balanceLine(f.balance)
            if f.overpaid {
                row("More than the total by", Money.pkr(abs(f.balance)), tone: Tone.problem.color)
            } else if line.state == .credit {
                row(line.label, Money.pkr(line.amount), tone: Tone.credit.color)
            } else if line.state == .due {
                row(line.label, Money.pkr(line.amount), tone: Tone.owed.color)
            } else {
                row("Balance", line.label, tone: Tone.settled.color)
            }
        } else {
            row("Balance", "Pending rates")
        }
    }

    private func row(_ label: String, _ value: String, strong: Bool = false, tone: Color = .primary) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).foregroundStyle(strong ? Color.primary : Color.secondary)
            Spacer(minLength: 8)
            Text(value).monospacedDigit().foregroundStyle(tone)
        }
        .font(strong ? .headline : .callout)
    }
}
#endif
