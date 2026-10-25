import SwiftUI
import ERPCore

/// Scan a tag (src/app/scan/page.tsx, `/scan`): read a piece's tag, see the piece, then add it to a
/// new sale or open its page. The web page keeps a cart beside the scanner; here the sale is the
/// phone's own unfinished one (`SaleDraftStore`), which New sale opens.
///
/// A tag that is not in stock may already be sold: the screen says which sale it went out on.
struct ScanTag: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    /// What the last tag turned out to be.
    private enum Found: Equatable {
        case piece(String)
        case sold(code: String, invoice: String)
        case unknown(String)
    }

    @State private var found: Found?
    /// The SKU just put on the sale, so its card says so instead of offering it again.
    @State private var addedSku: String?
    @State private var onSale = 0
    /// Bumped on a tag found or a piece put on the sale (success) and on one that is not in stock (warning).
    @State private var hits = 0
    @State private var misses = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The new sale, opened from the bar's Open the sale.
    @State private var openSale: Route?

    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    /// A wide iPad window: the camera takes the room, what it found stands at its side.
    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    var body: some View {
        #if os(macOS)
        macBody
        #else
        ScrollView {
            if wide {
                HStack(alignment: .top, spacing: 20) {
                    TagScanner(active: found == nil, height: 560) { code in handle(code) }
                        .frame(maxWidth: .infinity)
                    VStack(spacing: 16) { foundBlock }
                        .frame(width: 360)
                }
                .padding(20)
            } else {
                VStack(spacing: 16) {
                    TagScanner(active: found == nil) { code in handle(code) }
                    foundBlock
                }
                .padding(16)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if let primary = barAction { ActionBar(primary: primary) }
        }
        .navigationTitle("Scan a tag")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openSale) { r in ScreenRegistry.view(for: r.path) }
        .sensoryFeedback(.success, trigger: hits)
        .sensoryFeedback(.warning, trigger: misses)
        .onAppear { onSale = SaleDraftStore.load()?.lines.count ?? 0 }
        .task {
            book.products.need()
            book.invoices.need()
            book.settings.need()
        }
        #endif
    }

    /// What the last tag turned out to be, and the sale waiting.
    @ViewBuilder
    private var foundBlock: some View {
        if let found { result(found).transition(.opacity) }
        if found == nil && onSale > 0 && session.isOwner { saleCard }
    }

    // MARK: Reading a tag

    private func handle(_ code: String) {
        let sku = TagCode.sku(from: code)
        guard !sku.isEmpty else { return }
        addedSku = nil
        let next: Found
        if let p = SaleLookup.find(sku, in: book.products.items) {
            next = .piece(p.sku)
            hits += 1
        } else if let inv = SaleLookup.soldOn(sku, invoices: book.invoices.items) {
            next = .sold(code: sku, invoice: inv.id)
            misses += 1
        } else {
            next = .unknown(sku)
            misses += 1
        }
        Motion.run(reduce: reduceMotion) { found = next }
    }

    /// The one primary action of the screen, pinned at the foot: put the piece found on a new sale, or open that sale.
    private var barAction: ActionBar.Action? {
        guard session.isOwner, case .piece(let sku)? = found, let p = book.products.item(sku) else { return nil }
        if addedSku == p.sku {
            return ActionBar.Action("Open the sale") { openSale = SaleLinks.newSale }
        }
        return ActionBar.Action("Add to a new sale", systemImage: "cart.badge.plus") { addToSale(p) }
    }

    private func scanAnother() {
        Motion.run(reduce: reduceMotion) {
            found = nil
            addedSku = nil
        }
    }

    private func addToSale(_ p: Product) {
        SaleDraftStore.add(p)
        addedSku = p.sku
        onSale = SaleDraftStore.load()?.lines.count ?? 0
        hits += 1
    }

    // MARK: What it found

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .ledgerCard()
    }

    @ViewBuilder
    private func result(_ f: Found) -> some View {
        switch f {
        case .piece(let sku):
            if let p = book.products.item(sku) { pieceCard(p) } else { unknownCard(sku) }
        case .sold(let code, let invoiceId):
            soldCard(code: code, invoiceId: invoiceId)
        case .unknown(let code):
            unknownCard(code)
        }
    }

    private func spec(_ p: Product) -> String {
        var parts: [String] = [describeMetal(p.metalType, p.karat)]
        if p.metalWeightG > 0 { parts.append(SaleNumber.grams(p.metalWeightG) + "g") }
        if let size = p.size, !size.isEmpty { parts.append("Size \(size)") }
        return parts.joined(separator: " · ")
    }

    private func pieceCard(_ p: Product) -> some View {
        let price: Double? = book.settings.value.map { calculateProductCosts(PricedPiece(p), PricingRates($0)).totalPrice }
        let added = addedSku == p.sku
        return card {
            HStack(alignment: .top, spacing: 12) {
                if !(p.imageUrl ?? "").isEmpty {
                    StockImage(imageUrl: p.imageUrl, name: p.name, key: p.sku)
                        .frame(width: 72, height: 72)
                        .clipShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(p.name).font(.headline)
                    Text(p.sku).font(.subheadline.monospaced()).foregroundStyle(.secondary)
                    Text(spec(p)).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            if let price {
                LabeledContent("Price today") { Text(Money.pkr(price)).font(.headline).monospacedDigit() }
            }
            pieceActions(p, added: added)
        }
    }

    @ViewBuilder
    private func pieceActions(_ p: Product, added: Bool) -> some View {
        if session.isOwner && added {
            Label("On the new sale · \(onSale) piece\(onSale == 1 ? "" : "s")", systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Tone.settled.color)
        }
        NavigationLink(value: SaleLinks.piece(p.sku)) {
            Label("Open the piece", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .largeOnPhone()
        Button("Scan another") { scanAnother() }
            .buttonStyle(.borderless)
            .frame(maxWidth: .infinity)
    }

    private func soldCard(code: String, invoiceId: String) -> some View {
        let inv = book.invoices.item(invoiceId)
        return card {
            Label("\(code) is not in stock", systemImage: "magnifyingglass").font(.headline)
            if let inv {
                let who = isWalkInName(inv.customerName) || inv.customerName.isEmpty ? "Walk-in" : inv.customerName
                Text("It was sold on \(inv.id) · \(ShopDate.say(inv.createdAt)) · \(who).")
                    .foregroundStyle(.secondary)
            } else {
                Text("It was sold on \(invoiceId).").foregroundStyle(.secondary)
            }
            NavigationLink(value: SaleLinks.invoice(invoiceId)) {
                Text("Open \(invoiceId)").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .largeOnPhone()
            Button("Scan another") { scanAnother() }
                .buttonStyle(.borderless)
                .frame(maxWidth: .infinity)
        }
    }

    private func unknownCard(_ code: String) -> some View {
        card {
            Label("No piece \(code) in stock", systemImage: "magnifyingglass").font(.headline)
            Text("It may be a one-off piece that was billed without being stocked, or it is not entered yet.")
                .foregroundStyle(.secondary)
            Button("Scan another") { scanAnother() }
                .buttonStyle(.bordered)
                .largeOnPhone()
                .frame(maxWidth: .infinity)
        }
    }

    /// Pieces already waiting on the new sale.
    private var saleCard: some View {
        card {
            Label("\(onSale) piece\(onSale == 1 ? "" : "s") on the new sale", systemImage: "cart").font(.headline)
            NavigationLink(value: SaleLinks.newSale) {
                Text("Open the sale").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .largeOnPhone()
        }
    }
}

// MARK: - The Mac: a scanner window

#if os(macOS)
/// Scan a tag on the Mac: a window with the scanner's box already in focus (a USB barcode scanner types the SKU and
/// presses Return, and the piece is found), the tags read this time listed under it, and what the last one turned out
/// to be at the right. ⌘Return puts a found piece on a new sale; the next tag scanned simply replaces the card.
extension ScanTag {
    @ViewBuilder
    var macBody: some View {
        HSplitView {
            ScanTagMacScanner(
                read: { code in handle(code) },
                title: { sku in book.products.item(sku)?.name ?? "" })
                .frame(minWidth: 400, idealWidth: 460, maxWidth: 560)
            ScrollView {
                VStack(spacing: 16) { foundBlock }
                    .frame(maxWidth: 520)
                    .padding(24)
                    .frame(maxWidth: .infinity)
            }
            .frame(minWidth: 380)
            .overlay {
                if found == nil && !(onSale > 0 && session.isOwner) {
                    ContentUnavailableView("Scan a tag", systemImage: "barcode.viewfinder",
                                           description: Text("The piece it belongs to shows here."))
                }
            }
        }
        .background(Theme.ground)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if let primary = barAction {
                    Button { primary.action() } label: { Label(primary.title, systemImage: primary.systemImage ?? "cart.badge.plus") }
                        .keyboardShortcut(.return, modifiers: .command)
                        .help("\(primary.title) (⌘↩)")
                }
                if found != nil {
                    Button { scanAnother() } label: { Label("Clear", systemImage: "xmark.circle") }
                        .help("Clear the card")
                }
            }
        }
        .navigationTitle("Scan a tag")
        .navigationDestination(item: $openSale) { r in ScreenRegistry.view(for: r.path) }
        .sensoryFeedback(.success, trigger: hits)
        .sensoryFeedback(.warning, trigger: misses)
        .onAppear { onSale = SaleDraftStore.load()?.lines.count ?? 0 }
        .task {
            book.products.need()
            book.invoices.need()
            book.settings.need()
        }
    }
}

/// The scanner's side of the window: the tag reader (its box takes the keyboard), and every tag read this time, newest
/// first, to read again with a click.
private struct ScanTagMacScanner: View {
    let read: (String) -> Void
    let title: (String) -> String
    @State private var history: [String] = []

    var body: some View {
        VStack(spacing: 0) {
            TagScanner(active: true, height: 200) { code in
                let sku = TagCode.sku(from: code)
                guard !sku.isEmpty else { return }
                history.removeAll { $0 == sku }
                history.insert(sku, at: 0)
                read(code)
            }
            .padding(20)
            Divider()
            List {
                Section {
                    ForEach(history, id: \.self) { sku in
                        Button { read(sku) } label: {
                            HStack {
                                Text(sku).font(.body.monospaced())
                                Text(title(sku)).foregroundStyle(.secondary).lineLimit(1)
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .contextMenu { Button("Copy SKU") { UIPasteboard.general.string = sku } }
                    }
                } header: {
                    Text(history.isEmpty ? "Nothing scanned yet" : "Scanned this time")
                }
            }
            .listStyle(.inset)
        }
    }
}
#endif
