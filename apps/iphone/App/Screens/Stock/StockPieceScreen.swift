import SwiftUI
import ERPCore

/// One piece in stock (src/app/products/[sku]/page.tsx): its photo, what it sells for at today's
/// rates and how that adds up, and what it is made of. Selling it opens the sale form; printing its
/// tag, editing and deleting (which asks for the delete code) are the ERP's own pages. A piece that
/// has left the stock reads "Sold", with the invoice it went out on.
struct StockPieceScreen: View {
    let sku: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var go: Route?

    var body: some View {
        ShelfState(loaded: book.products.loaded, error: book.products.error, offline: book.products.offline) {
            if let product = book.products.item(sku) {
                detail(product)
            } else {
                StockSoldView(sku: sku)
            }
        }
        .navigationTitle(sku)
        .navigationBarTitleDisplayMode(.inline)
        .stockDestination($go)
        .task {
            book.products.need()
            book.settings.need()
        }
    }

    // MARK: The page

    private func detail(_ p: Product) -> some View {
        let settings: Settings? = book.settings.value
        let rates: PricingRates? = StockKit.rates(settings) ?? (p.isCustomPrice ? PricingRates() : nil)
        let costs: ProductCosts? = rates.map { StockKit.costs(p, $0) }
        return List { Group {
            heroSection(p)
            priceSection(p, costs, settings)
            if !p.isCustomPrice { specsSection(p) }
            if session.isOwner { erpSection(p) }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .bottom, spacing: 0) { sellBar(p) }
    }

    /// Sell puts the piece on the sale in progress (the New sale screen's own draft, as Scan does) and opens it.
    private func sellBar(_ p: Product) -> some View {
        Button {
            SaleDraftStore.add(p)
            go = Route(path: StockKit.newSalePath)
        } label: {
            Label("Sell", systemImage: "cart").frame(maxWidth: .infinity)
        }
        .buttonStyle(.houseProminent)
        .controlSize(.large)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: Photo and name

    private func heroSection(_ p: Product) -> some View {
        Section {
            StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku, decodeDataURI: true)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 14))
                .frame(maxHeight: 340)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            VStack(alignment: .leading, spacing: 6) {
                StatusBadge(StockKit.categoryTitle(p.categoryId), color: .accentColor)
                Text(p.name).font(.title2.weight(.bold))
                Text(p.sku).font(.subheadline.monospaced()).foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
        }
    }

    // MARK: Price

    /// The total large, then how it adds up. A fixed-price piece shows its description instead of
    /// the weights, as the web does.
    @ViewBuilder
    private func priceSection(_ p: Product, _ costs: ProductCosts?, _ settings: Settings?) -> some View {
        Section("Price") {
            VStack(spacing: 4) {
                Text(p.isCustomPrice ? "Fixed price" : "At today's rates")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(totalLine(costs))
                    .font(.largeTitle.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText(value: costs?.totalPrice ?? 0))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)

            if p.isCustomPrice {
                if let note = StockKit.filled(p.description) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Description").font(.subheadline).foregroundStyle(.secondary)
                        Text(note)
                    }
                }
            } else if let costs {
                breakdown(p, costs, settings)
            }
        }
    }

    private func totalLine(_ costs: ProductCosts?) -> String {
        guard let costs else { return "—" }
        return costs.totalPrice > 0 ? Money.pkr(costs.totalPrice) : "Price N/A"
    }

    /// Metal, wastage, making, diamonds, stones and sundries, then the total. Silver has no wastage
    /// or making line: its rate carries them (lib/pricing.ts).
    @ViewBuilder
    private func breakdown(_ p: Product, _ c: ProductCosts, _ settings: Settings?) -> some View {
        if let settings, let rate = StockKit.rateLine(p, settings) {
            LabeledContent(rate.label) { Text("\(Money.pkr(rate.perGram)) / gram").monospacedDigit() }
        }
        moneyRow("Metal cost", c.metalCost)
        if p.metalType != .silver {
            moneyRow("Wastage cost", c.wastageCost)
            moneyRow("Making charges", c.makingCharges)
        }
        if p.hasDiamonds { moneyRow("Diamond charges", c.diamondCharges) }
        moneyRow(p.hasDiamonds ? "Other stone charges" : "Stone charges", c.stoneCharges)
        moneyRow("Misc. charges", c.miscCharges)
        LabeledContent("Total") { Text(Money.pkr(c.totalPrice)).font(.body.weight(.semibold)).monospacedDigit() }
    }

    private func moneyRow(_ label: String, _ amount: Double) -> some View {
        LabeledContent(label) { Text(Money.pkr(amount)).monospacedDigit() }
    }

    // MARK: What it is made of

    @ViewBuilder
    private func specsSection(_ p: Product) -> some View {
        Section("Details") {
            LabeledContent("Metal", value: capitalised(p.metalType.rawValue))
            if p.metalType == .gold, let k = p.karat, !k.rawValue.isEmpty {
                LabeledContent("Karat", value: k.rawValue.uppercased())
            }
            LabeledContent("Weight", value: StockKit.grams(p.metalWeightG))
            if let second = p.secondaryMetalType, !second.rawValue.isEmpty, (p.secondaryMetalWeightG ?? 0) > 0 {
                LabeledContent("Second metal", value: capitalised(second.rawValue))
                if second == .gold, let k = p.secondaryMetalKarat, !k.rawValue.isEmpty {
                    LabeledContent("Second metal karat", value: k.rawValue.uppercased())
                }
                LabeledContent("Second metal weight", value: StockKit.grams(p.secondaryMetalWeightG ?? 0))
            }
            if p.metalType != .silver {
                LabeledContent("Wastage", value: StockKit.percent(p.wastagePercentage))
            }
            LabeledContent("Diamonds", value: p.hasDiamonds ? "Yes" : "No")
            if p.stoneWeightG > 0 {
                LabeledContent("Stone weight", value: StockKit.grams(p.stoneWeightG))
            }
            if let size = StockKit.filled(p.size) { LabeledContent("Size", value: size) }
            if let finish = describePlating(p) { LabeledContent("Finish", value: finish) }
            if let stones = StockKit.filled(p.stoneDetails) { textBlock("Stones and second metal", stones) }
            if let diamonds = StockKit.filled(p.diamondDetails) { textBlock("Diamond details", diamonds) }
            if let about = StockKit.filled(p.description) { textBlock("Description", about) }
        }
    }

    private func capitalised(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    private func textBlock(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Text(text)
        }
    }

    // MARK: The ERP's own pages

    /// Print tag, Edit and Delete are the ERP's pages: its label printer takes the tag's QR and CSV,
    /// the form is its own, and Delete asks for the delete code there. Owners only (Stock is theirs).
    private func erpSection(_ p: Product) -> some View {
        Section {
            NavigationLink(value: Route(path: StockKit.piecePath(p.sku, web: true))) {
                Label("Print tag", systemImage: "printer")
            }
            NavigationLink(value: Route(path: StockKit.editPath(p.sku))) {
                Label("Edit", systemImage: "pencil")
            }
            NavigationLink(value: Route(path: StockKit.piecePath(p.sku, web: true))) {
                Label("Delete", systemImage: "trash").foregroundStyle(.red)
            }
        } header: {
            Text("On the ERP's page")
        } footer: {
            Text("These open the ERP's own page. Delete asks for the delete code there.")
        }
    }
}

// MARK: Sold

/// A piece that is not in the stock: sold, if an invoice carries its SKU. The invoices are read
/// only now, so an ordinary piece page does not pay for the whole book.
private struct StockSoldView: View {
    let sku: String
    @Environment(Book.self) private var book

    var body: some View {
        content
            .task { book.invoices.need() }
    }

    @ViewBuilder
    private var content: some View {
        if !book.invoices.loaded {
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            let sales: [Invoice] = book.invoices.items.filter { (inv: Invoice) -> Bool in
                inv.items.contains { (item: InvoiceItem) -> Bool in item.sku == sku }
            }
            if sales.isEmpty {
                ContentUnavailableView {
                    Label("Not in stock", systemImage: "shippingbox")
                } description: {
                    Text(book.invoices.error ?? "No piece with the SKU \(sku) is in stock, and no invoice carries it.")
                } actions: {
                    NavigationLink(value: Route(path: "/products")) { Text("All stock") }
                }
            } else {
                soldList(sales)
            }
        }
    }

    private func soldList(_ sales: [Invoice]) -> some View {
        List { Group {
            Section {
                VStack(spacing: 6) {
                    Image(systemName: "checkmark.seal").font(.largeTitle).foregroundStyle(.green)
                    Text("Sold").font(.title2.weight(.bold))
                    Text("\(sku) is no longer in stock.").font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            Section(sales.count == 1 ? "Sold on" : "Sold on these invoices") {
                ForEach(sales) { (inv: Invoice) in
                    NavigationLink(value: Route(path: "/invoices/" + StockKit.encode(inv.id))) {
                        saleRow(inv)
                    }
                }
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    private func saleRow(_ inv: Invoice) -> some View {
        let item: InvoiceItem? = inv.items.first { (i: InvoiceItem) -> Bool in i.sku == sku }
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        let who = name.isEmpty || isWalkInName(name) ? "Walk-in" : name
        let when = ShopDate.say(inv.createdAt)
        let subtitle = when.isEmpty ? who : "\(who) · \(when)"
        return HStack(alignment: .firstTextBaseline) {
            TwoLine(title: inv.id, subtitle: subtitle, trailing: item.map { Money.pkr($0.itemTotal) })
            if inv.status == .refunded { StatusBadge("Refunded", color: .purple) }
        }
    }
}
