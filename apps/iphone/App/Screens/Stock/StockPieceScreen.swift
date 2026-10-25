import SwiftUI
import ERPCore

/// One piece in stock (src/app/products/[sku]/page.tsx): its photo, what it sells for at today's
/// rates and how that adds up, and what it is made of. Selling it opens the sale form and Edit the
/// native product form (StockPieceForm); Print tag its QR and its label CSV (StockPieceTagSheet), and
/// Delete asks for the delete code and the ERP deletes it (`deleteProduct`). A piece that has left the
/// stock reads "Sold", with the invoice it went out on.
struct StockPieceScreen: View {
    let sku: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var go: Route?
    @State private var tagging: Product?
    @State private var deletion: OwnerDeletion?
    /// Set once the ERP has deleted the piece: the page goes back to the list as the code's sheet closes, as the
    /// web's goes to /products.
    @State private var deleted = false
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0
    #if os(macOS)
    /// "Replace photo…" asked for: the file chooser (a picture dropped on the photo needs no asking).
    @State private var replacing = false
    /// A record opens in a window of its own where the window has the means to (MacShell's main window).
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    /// A wide window: the photo and facts on the left, the price and how it adds up on the right.
    private var twoColumns: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

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
        .zoomDestination(id: StockKit.piecePath(sku))
        .stockDestination($go)
        .sheet(item: $tagging) { (p: Product) in
            StockPieceTagSheet(product: p)
        }
        .sheet(item: $deletion, onDismiss: { if deleted { dismiss() } }) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) { deleted = true }
        }
        .destructiveFeedback(trigger: deleted)
        .task {
            book.products.need()
            book.settings.need()
        }
    }

    // MARK: The page

    private func detail(_ p: Product) -> some View {
        #if os(macOS)
        macDetail(p)
        #else
        let settings: Settings? = book.settings.value
        let rates: PricingRates? = StockKit.rates(settings) ?? (p.isCustomPrice ? PricingRates() : nil)
        let costs: ProductCosts? = rates.map { StockKit.costs(p, $0) }
        return pageBody(p, costs, settings)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // Selling is the owners' (createInvoice is owner-only): staff read the piece without a Sell they cannot finish.
        .safeAreaBar(edge: .bottom, spacing: 0) { if session.isOwner { sellBar(p) } }
        .toolbar { if session.isOwner { ToolbarItem(placement: .primaryAction) { actionsMenu(p) } } }
        #endif
    }

    @ViewBuilder
    private func pageBody(_ p: Product, _ costs: ProductCosts?, _ settings: Settings?) -> some View {
        if twoColumns {
            HStack(spacing: 0) {
                List { Group {
                    heroSection(p)
                    if !p.isCustomPrice { specsSection(p) }
                    }
                    .houseRows()
                }
                .listStyle(.insetGrouped)
                .frame(width: min(420, width * 0.4))
                Divider()
                List { Group {
                    priceSection(p, costs, settings)
                    }
                    .houseRows()
                }
                .listStyle(.insetGrouped)
            }
        } else {
            List { Group {
                heroSection(p)
                priceSection(p, costs, settings)
                if !p.isCustomPrice { specsSection(p) }
                }
                .houseRows()
            }
            .listStyle(.insetGrouped)
        }
    }

    /// Sell puts the piece on the sale in progress (the New sale screen's own draft, as Scan does) and opens it.
    private func sellBar(_ p: Product) -> some View {
        ActionBar(primary: ActionBar.Action("Sell", systemImage: "cart") {
            SaleDraftStore.add(p)
            go = Route(path: StockKit.newSalePath)
        })
    }

    // MARK: Photo and name

    private func heroSection(_ p: Product) -> some View {
        Section {
            StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku, decodeDataURI: true)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
                .frame(maxHeight: 340)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            // The SKU is the page's title, so it is not said again under the name.
            VStack(alignment: .leading, spacing: pt(6)) {
                Pill(StockKit.categoryTitle(p.categoryId), tone: .house)
                Text(p.name).font(.title2.weight(.bold))
            }
            .padding(.vertical, pt(2))
        }
    }

    // MARK: Price

    /// The total large, then how it adds up. A fixed-price piece shows its description instead of
    /// the weights, as the web does.
    @ViewBuilder
    private func priceSection(_ p: Product, _ costs: ProductCosts?, _ settings: Settings?) -> some View {
        LedgerSection("Price") {
            VStack(spacing: pt(4)) {
                Text(p.isCustomPrice ? "Fixed price" : "At today's rates")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let costs, costs.totalPrice > 0 {
                    HeroAmount(amount: costs.totalPrice)
                } else {
                    Text(totalLine(costs))
                        .font(.system(.largeTitle, design: .serif).weight(.semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, pt(6))

            if p.isCustomPrice {
                if let note = StockKit.filled(p.description) {
                    VStack(alignment: .leading, spacing: pt(4)) {
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

    /// Metal, wastage, making, diamonds, stones and sundries (the total is the hero). Silver has no wastage
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
        // The total is the hero above: not said twice.
    }

    private func moneyRow(_ label: String, _ amount: Double) -> some View {
        MoneyRow(label, amount)
    }

    // MARK: What it is made of

    @ViewBuilder
    private func specsSection(_ p: Product) -> some View {
        LedgerSection("Details", collapsible: true) {
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
        VStack(alignment: .leading, spacing: pt(4)) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Text(text)
        }
    }

    // MARK: Edit, the tag and Delete

    /// Edit is the native product form; Print tag the tag's QR and the CSV its label printer takes; Delete asks
    /// for the delete code, which the ERP checks as it deletes ("The piece is gone for good"). Owners only (Stock is theirs).
    private func actionsMenu(_ p: Product) -> some View {
        Menu {
            Button { go = Route(path: StockKit.editPath(p.sku)) } label: { Label("Edit", systemImage: "pencil") }
            Button { tagging = p } label: { Label("Print tag", systemImage: "printer") }
            Divider()
            Button(role: .destructive) { deletion = StockKit.deletion(p) } label: { Label("Delete", systemImage: "trash") }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }
}

// MARK: Sold

/// A piece that is not in the stock: sold, if an invoice carries its SKU. The invoices are read
/// only now, so an ordinary piece page does not pay for the whole book.
private struct StockSoldView: View {
    let sku: String
    @Environment(Book.self) private var book
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Bumped as the page appears, so the seal bounces once (not under Reduce Motion).
    @State private var sealed = 0
    /// The invoices that carry this piece, found once per change of the invoices (every invoice's every line was
    /// read on each drawing of the page).
    @State private var found = Memo<[Invoice]>()
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    var body: some View {
        content
            .task { book.invoices.need() }
    }

    @ViewBuilder
    private var content: some View {
        if !book.invoices.loaded {
            SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            let sales: [Invoice] = found([book.invoices.revision, sku.hashValue]) {
                book.invoices.items.filter { (inv: Invoice) -> Bool in
                    inv.items.contains { (item: InvoiceItem) -> Bool in item.sku == sku }
                }
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
                #if os(macOS)
                macSold(sales)
                #else
                soldList(sales)
                #endif
            }
        }
    }

    private func soldList(_ sales: [Invoice]) -> some View {
        List { Group {
            Section {
                VStack(spacing: pt(6)) {
                    Image(systemName: "checkmark.seal").font(.largeTitle).foregroundStyle(Tone.settled.color)
                        .symbolEffect(.bounce, value: reduceMotion ? 0 : sealed)
                        .onAppear { sealed += 1 }
                    // The SKU is the page's title: not said again.
                    Text("Sold").font(.title2.weight(.bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, pt(8))
            }
            LedgerSection(sales.count == 1 ? "Sold on" : "Sold on these invoices") {
                ForEach(sales) { (inv: Invoice) in
                    NavigationLink(value: Route(path: "/invoices/" + StockKit.encode(inv.id))) {
                        saleRow(inv)
                    }
                    #if os(macOS)
                    .macOpenInWindowMenu("/invoices/" + StockKit.encode(inv.id))
                    #endif
                }
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        #if os(macOS)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        #endif
    }

    private func saleRow(_ inv: Invoice) -> some View {
        let item: InvoiceItem? = inv.items.first { (i: InvoiceItem) -> Bool in i.sku == sku }
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        let who = name.isEmpty || isWalkInName(name) ? "Walk-in" : name
        let when = ShopDate.say(inv.createdAt)
        let subtitle = when.isEmpty ? who : "\(who) · \(when)"
        return HStack(alignment: .firstTextBaseline) {
            TwoLine(title: inv.id, subtitle: subtitle, trailing: item.map { Money.pkr($0.itemTotal) })
            if inv.status == .refunded { Pill("Refunded", tone: .quiet) }
        }
    }
}

// MARK: The Mac's record window

#if os(macOS)
extension StockPieceScreen {
    /// The piece as a record window (docs/features/mac-design.md, "Stock"): a document head (its name, SKU and category,
    /// and what it sells for today), its photo (a picture dropped on it replaces it) and what it is made of on the left, the
    /// price at today's rates and how it adds up at the right as plain rows. Its actions are declared once: the window's
    /// toolbar, the Piece menu and the photo's right-click menu share them.
    func macDetail(_ p: Product) -> some View {
        let settings: Settings? = book.settings.value
        return VStack(spacing: 0) {
            MacDocumentHeader(
                title: p.name.isEmpty ? p.sku : p.name,
                subtitle: p.sku + " \u{00B7} " + StockKit.categoryTitle(p.categoryId),
                headline: MacHeadline("At today's rates", MacStockPricing.words(MacStockPricing.total(p, settings)))
            )
            Divider()
            HStack(alignment: .top, spacing: 0) {
                Form {
                    Section { macPhoto(p) }
                    MacStockDetailSections(product: p)
                }
                .formStyle(.grouped)
                .frame(minWidth: 380, maxWidth: .infinity)
                Divider()
                Form {
                    MacStockPriceSection(product: p, settings: settings)
                }
                .formStyle(.grouped)
                .frame(width: 340)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                MacToolbarAction(action: macSellAction(p))
                MacToolbarAction(action: macEditAction(p))
                MacToolbarAction(action: macPrintAction(p))
                MacToolbarAction(action: macDeleteAction(p))
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Piece", groups: macGroups(p)))
    }

    /// The photo; owners drop a picture on it or choose one from its right-click menu.
    @ViewBuilder
    private func macPhoto(_ p: Product) -> some View {
        let image = StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku, decodeDataURI: true)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(.rect(cornerRadius: Radius.chip, style: .continuous))
            .frame(maxWidth: 360)
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

    // MARK: The actions, declared once

    private func macSellAction(_ p: Product) -> MacAction {
        MacAction("Sell", symbol: "cart", enabled: session.isOwner, isDefault: true) { macSell(p) }
    }

    private func macEditAction(_ p: Product) -> MacAction {
        MacAction("Edit", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command), enabled: session.isOwner) { macOpen(StockKit.editPath(p.sku)) }
    }

    private func macPrintAction(_ p: Product) -> MacAction {
        MacAction("Print Tag\u{2026}", symbol: "printer", shortcut: KeyboardShortcut("p", modifiers: .command)) {
            MacPrint.print(Route(path: StockKit.piecePath(p.sku)))
        }
    }

    private func macDeleteAction(_ p: Product) -> MacAction {
        MacAction("Delete\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive,
                  enabled: session.isOwner) { deletion = StockKit.deletion(p) }
    }

    private func macGroups(_ p: Product) -> [[MacAction]] {
        let sku = p.sku
        let printNow = MacAction("Print Tag Now", symbol: "printer.fill", shortcut: KeyboardShortcut("p", modifiers: [.command, .option])) {
            Task { await MacPrint.printTags([sku], now: true) }
        }
        let copying = MacAction("Copy SKU", symbol: "doc.on.doc") { UIPasteboard.general.string = sku }
        let showing = MacAction("Show QR\u{2026}", symbol: "qrcode") { tagging = p }
        let exporting = MacAction("Export Tag CSV\u{2026}", symbol: "arrow.down.doc") { tagging = p }
        let replaceAction = MacAction("Replace Photo\u{2026}", symbol: "photo", enabled: session.isOwner) { replacing = true }
        let printing: [MacAction] = [macPrintAction(p), printNow, macEditAction(p)]
        let tag: [MacAction] = [copying, showing, exporting, replaceAction]
        return [[macSellAction(p)], printing, tag, [macDeleteAction(p)]]
    }

    /// Selling and editing open in a window of their own where the window can; otherwise in this one, as before.
    private func macOpen(_ path: String) {
        if let openPlace { openPlace(Route(path: path)) } else { go = Route(path: path) }
    }

    private func macSell(_ p: Product) {
        SaleDraftStore.add(p)
        macOpen(StockKit.newSalePath)
    }
}

extension StockSoldView {
    /// A piece that is gone: a document head saying so, and the invoices it went out on.
    func macSold(_ sales: [Invoice]) -> some View {
        VStack(spacing: 0) {
            MacDocumentHeader(title: sku, subtitle: sales.count == 1 ? "Sold on 1 invoice" : "Sold on \(sales.count) invoices",
                              status: MacStatus("Sold", tone: .settled))
            Divider()
            Form {
                Section(sales.count == 1 ? "Sold on" : "Sold on These Invoices") {
                    ForEach(sales) { (inv: Invoice) in
                        macSaleLink(inv)
                    }
                }
            }
            .formStyle(.grouped)
        }
    }

    @ViewBuilder
    private func macSaleLink(_ inv: Invoice) -> some View {
        let path = "/invoices/" + StockKit.encode(inv.id)
        if let openPlace {
            Button { openPlace(Route(path: path)) } label: { saleRow(inv) }
                .buttonStyle(.plain)
        } else {
            NavigationLink(value: Route(path: path)) { saleRow(inv) }
        }
    }
}
#endif
