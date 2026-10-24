#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's New sale / Edit invoice window (docs/features/mac-app.md): ONE window instead of the phone's four steps.
// Stock to pick from at the left (a search box that a USB barcode scanner types into, then Return, adds the piece), the
// bill at the right always in view (its pieces, then its totals), and under the bill the sale's other sections in one
// scrolling form: customer, rates, discount, exchange, payment, for the shop, delivery. Save is the footer's, and Return
// does it. Every function it calls is SaleForm's own (NewSale.swift, SaleSections.swift); only the arrangement is here.

/// Left | right with a footer under the right side. Holds whether the scanner box has the keyboard, so Return in it adds a
/// piece and never saves the sale.
struct SaleMacSplit<Left: View, Right: View, Footer: View>: View {
    @ViewBuilder let left: (Binding<Bool>) -> Left
    @ViewBuilder let right: () -> Right
    @ViewBuilder let footer: (Bool) -> Footer
    @State private var scanner = false

    var body: some View {
        HSplitView {
            left($scanner)
                .frame(minWidth: 340, idealWidth: 420, maxWidth: 560)
            VStack(spacing: 0) {
                right().frame(maxWidth: .infinity, maxHeight: .infinity)
                footer(scanner)
            }
            .frame(minWidth: 560)
        }
        .background(Theme.ground)
    }
}

// MARK: The stock

/// The piece picker: a search box that is also the scanner's (a USB scanner types the SKU and presses Return, which adds
/// the piece through `submit`, SaleForm.addTyped), and the stock as a table; double-click or Return on a row adds it.
struct SaleMacPicker: View {
    let products: [Product]
    /// SKUs already on the bill.
    let taken: Set<String>
    let pricing: PricingRates
    @Binding var query: String
    let notice: String?
    @Binding var scannerFocused: Bool
    let add: (Product) -> Void
    let submit: () -> Void
    let scan: () -> Void
    let newItem: () -> Void

    @Environment(\.openPlaceWindow) private var openPlace
    @FocusState private var focus: Bool
    @State private var selection = Set<String>()

    private static let cap = 300

    private var rows: [Product] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return Array(products.lazy.filter { !taken.contains($0.sku) }.prefix(Self.cap)) }
        return SaleLookup.matches(q, in: products, excluding: taken, limit: Self.cap)
    }

    var body: some View {
        let shown = rows
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "barcode.viewfinder").foregroundStyle(.secondary)
                    TextField("Scan a tag, or search stock", text: $query)
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .focused($focus)
                        .onSubmit {
                            submit()
                            focus = true
                        }
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                            .help("Clear the search")
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Theme.card, in: .rect(cornerRadius: Radius.chip, style: .continuous))
                if let notice {
                    Label(notice, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(Tone.problem.color)
                }
                HStack(spacing: 8) {
                    Button { scan() } label: { Label("Scan a tag…", systemImage: "qrcode.viewfinder") }
                        .help("Read a photo of a tag, or type its SKU")
                    Button { newItem() } label: { Label("New item", systemImage: "plus.circle") }
                        .help("A piece that is not in stock, described for this bill only")
                    Spacer()
                    Text(query.trimmingCharacters(in: .whitespaces).isEmpty
                         ? "Stock"
                         : "\(shown.count) found")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            Table(shown, selection: $selection) {
                TableColumn("Piece") { p in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.name).lineLimit(1)
                        Text(p.sku).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }
                .width(min: 140, ideal: 190)
                TableColumn("Metal") { p in
                    Text([describeMetal(p.metalType, p.karat),
                          p.metalWeightG > 0 ? SaleNumber.grams(p.metalWeightG) + " g" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
                .width(min: 80, ideal: 110)
                TableColumn("Price") { p in
                    Text(Money.pkr(calculateProductCosts(PricedPiece(p), pricing).totalPrice))
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 80, ideal: 100)
            }
            .contextMenu(forSelectionType: String.self) { skus in
                if !skus.isEmpty {
                    Button(skus.count == 1 ? "Add to the Sale" : "Add \(skus.count) to the Sale") { addAll(skus) }
                    if let sku = skus.first, skus.count == 1 {
                        Button("Open Piece in New Window") { openPlace?(SaleLinks.piece(sku)) }
                        Button("Copy SKU") { UIPasteboard.general.string = sku }
                    }
                }
            } primaryAction: { skus in addAll(skus) }
            .onKeyPress(.return) {
                guard !selection.isEmpty else { return .ignored }
                addAll(selection)
                return .handled
            }
            .overlay {
                if shown.isEmpty {
                    ContentUnavailableView(query.trimmingCharacters(in: .whitespaces).isEmpty ? "No stock to add" : "Nothing matches",
                                           systemImage: "magnifyingglass",
                                           description: Text("Press Return to bill what you typed as a new item."))
                }
            }
            if query.trimmingCharacters(in: .whitespaces).isEmpty && products.count - taken.count > Self.cap {
                Text("The first \(Self.cap) pieces. Search to narrow them down.")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 14).padding(.vertical, 6)
            }
        }
        .background(Theme.ground)
        .task { focus = true }
        .onChange(of: focus) { _, now in scannerFocused = now }
    }

    private func addAll(_ skus: Set<String>) {
        for sku in skus.sorted() {
            if let p = products.first(where: { $0.sku == sku }) { add(p) }
        }
        selection = []
    }
}

// MARK: The bill

/// The bill as it stands: its pieces in a table (double-click edits, right-click removes) and its totals under them,
/// always in view while the form below is filled in.
struct SaleMacBill: View {
    let lines: [SaleLine]
    let figures: SaleFigures
    let spec: (SaleLine) -> String
    let isGone: (SaleLine) -> Bool
    let edit: (SaleLine) -> Void
    let remove: (Set<String>) -> Void

    @Environment(\.openPlaceWindow) private var openPlace
    @State private var selection = Set<String>()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                LedgerHeading(title: "Bill", count: lines.isEmpty ? nil : lines.count)
                Spacer()
                Button { remove(selection); selection = [] } label: { Label("Remove", systemImage: "minus.circle") }
                    .disabled(selection.isEmpty)
                    .help("Take the picked pieces off the sale")
            }
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 6)
            Table(lines, selection: $selection) {
                TableColumn("Piece") { line in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(line.name.isEmpty ? (line.stockSku ?? "New piece") : line.name).fontWeight(.medium)
                        if isGone(line) {
                            Label("No longer in stock", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption).foregroundStyle(Tone.problem.color)
                        } else if line.isCustomPrice {
                            Text("Fixed price").font(.caption).foregroundStyle(Tone.owed.color)
                        }
                    }
                }
                .width(min: 150, ideal: 220)
                TableColumn("Details") { line in Text(spec(line)).font(.callout).foregroundStyle(.secondary).lineLimit(1) }
                    .width(min: 100, ideal: 160)
                TableColumn("Price") { line in
                    Text(figures.hasEstimate ? Money.pkr(figures.price(of: line.sku)) : "—")
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 90, ideal: 110)
            }
            .contextMenu(forSelectionType: String.self) { skus in
                if let sku = skus.first, let line = lines.first(where: { $0.sku == sku }) {
                    if skus.count == 1 { Button("Edit Piece…") { edit(line) } }
                    if skus.count == 1, !line.isOneOff {
                        Button("Open Piece in New Window") { openPlace?(SaleLinks.piece(sku)) }
                        Button("Copy SKU") { UIPasteboard.general.string = sku }
                    }
                    Divider()
                    Button(skus.count == 1 ? "Remove from the Sale" : "Remove \(skus.count) from the Sale", role: .destructive) { remove(skus) }
                }
            } primaryAction: { skus in
                if let sku = skus.first, let line = lines.first(where: { $0.sku == sku }) { edit(line) }
            }
            .onDeleteCommand { if !selection.isEmpty { remove(selection); selection = [] } }
            .overlay {
                if lines.isEmpty {
                    ContentUnavailableView("Nothing on the bill yet", systemImage: "cart",
                                           description: Text("Scan a tag or pick a piece from the stock."))
                }
            }
            totals
        }
    }

    /// Subtotal to balance, as the bill will read.
    private var totals: some View {
        let f = figures
        let line = balanceLine(f.balance)
        return VStack(spacing: 4) {
            totalRow("Subtotal", f.subtotal, f)
            if f.discount != 0 { totalRow("Discount", -f.discount, f, signed: true) }
            if f.exchange != 0 { totalRow("Exchange", -f.exchange, f, signed: true) }
            totalRow("Total", f.total, f, strong: true)
            if f.hasEstimate {
                if f.paidNow > 0 { totalRow("Paid now", f.paidNow, f) }
                if f.overpaid {
                    MoneyRow("More than the total by", abs(f.balance), tone: .problem)
                } else if line.state == .credit {
                    MoneyRow(line.label, line.amount, tone: .credit)
                } else if line.state == .due {
                    MoneyRow(line.label, line.amount, tone: .owed)
                } else {
                    LabeledContent(line.label) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Tone.settled.color) }
                        .font(.subheadline)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 10)
        .background(.bar)
    }

    @ViewBuilder
    private func totalRow(_ label: String, _ value: Double, _ f: SaleFigures, signed: Bool = false, strong: Bool = false) -> some View {
        if f.hasEstimate {
            MoneyRow(label, value, emphasis: strong, signed: signed)
        } else {
            LabeledContent(label) { Text("Pending rates").foregroundStyle(.secondary) }.font(.subheadline)
        }
    }
}
#endif
