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
    @State private var tick = 0

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                TagScanner(active: found == nil) { code in handle(code) }
                if let found { result(found) }
                if found == nil && onSale > 0 && session.isOwner { saleCard }
            }
            .padding(16)
        }
        .navigationTitle("Scan a tag")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.success, trigger: tick)
        .onAppear { onSale = SaleDraftStore.load()?.lines.count ?? 0 }
        .task {
            book.products.need()
            book.invoices.need()
            book.settings.need()
        }
    }

    // MARK: Reading a tag

    private func handle(_ code: String) {
        let sku = TagCode.sku(from: code)
        guard !sku.isEmpty else { return }
        addedSku = nil
        if let p = SaleLookup.find(sku, in: book.products.items) {
            found = .piece(p.sku)
        } else if let inv = SaleLookup.soldOn(sku, invoices: book.invoices.items) {
            found = .sold(code: sku, invoice: inv.id)
        } else {
            found = .unknown(sku)
        }
        tick += 1
    }

    private func scanAnother() {
        found = nil
        addedSku = nil
    }

    private func addToSale(_ p: Product) {
        SaleDraftStore.add(p)
        addedSku = p.sku
        onSale = SaleDraftStore.load()?.lines.count ?? 0
        tick += 1
    }

    // MARK: What it found

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: .rect(cornerRadius: 18))
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
                if let url = p.imageUrl.flatMap({ URL(string: $0) }) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Rectangle().fill(.quaternary)
                    }
                    .frame(width: 72, height: 72)
                    .clipShape(.rect(cornerRadius: 12))
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
        if session.isOwner {
            if added {
                Label("On the new sale · \(onSale) piece\(onSale == 1 ? "" : "s")", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
                NavigationLink(value: SaleLinks.newSale) {
                    Text("Open the sale").frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
            } else {
                Button { addToSale(p) } label: {
                    Label("Add to a new sale", systemImage: "cart.badge.plus").frame(maxWidth: .infinity)
                }
                .buttonStyle(.houseProminent)
                .controlSize(.large)
            }
        }
        NavigationLink(value: SaleLinks.piece(p.sku)) {
            Label("Open the piece", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
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
            .buttonStyle(.glass)
            .controlSize(.large)
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
                .buttonStyle(.glass)
                .controlSize(.large)
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
            .buttonStyle(.glass)
            .controlSize(.large)
        }
    }
}
