import SwiftUI
import ERPCore

/// The one way into a sale (src/app/new/page.tsx). The decision is the thing you know first: the
/// customer is either buying now, commissioning a piece, or bringing one in to be fixed, and it
/// changes which fields matter. So it is asked first, and each answer continues on its own screen.
/// Beside the three: a tag scanned, and the paper the counter already wrote.
struct NewChooser: View {
    @Environment(Book.self) private var book

    /// This phone's unfinished sale, if it has pieces.
    @State private var inProgress: SaleDraft?
    /// An order half typed on this phone.
    @State private var orderInProgress = false

    var body: some View {
        List { Group {
            if let draft = inProgress, !draft.lines.isEmpty {
                Section { progressRow(draft) }
            }
            if orderInProgress {
                Section { orderProgressRow }
            }

            // One line each, as the system's own "New" menus put it.
            Section {
                choice(path: "/invoices/new", icon: "doc.text.fill", title: "Sale", tint: Theme.accent,
                       blurb: "Buying now: pieces, payment, the invoice")
                choice(path: "/orders/add", icon: "list.clipboard.fill", title: "Order", tint: Tone.working.color,
                       blurb: "To be made: sizes, an advance, the workshop")
                choice(path: "/repairs?new=1", icon: "wrench.and.screwdriver.fill", title: "Repair", tint: Tone.credit.color,
                       blurb: "Brought in to be fixed: pieces, price, ready-by")
            } header: {
                LedgerHeading(title: "What is it?")
            }

            // The other ways in. Reading a written bill and a parchi are the ERP's AI scanners: its pages.
            LedgerSection("Other ways in") {
                NavigationLink(value: Route(path: "/scan")) {
                    Label("Scan a tag", systemImage: "qrcode.viewfinder")
                }
                NavigationLink(value: SaleLinks.readBill) {
                    Label("Read a written bill", systemImage: "camera.viewfinder")
                }
                NavigationLink(value: Route(path: "/orders/add?scan=parchi")) {
                    Label("Read a slip", systemImage: "doc.text.viewfinder")
                }
            }

            Section {
                NavigationLink(value: Route(path: "/drafts")) {
                    Label("Drafts", systemImage: "tray.full")
                }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .navigationTitle("New")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            inProgress = SaleDraftStore.load()
            orderInProgress = NewOrderDraftStore.orderInProgress
        }
        .task { book.settings.need() }
    }

    // MARK: Parts

    /// A bill left half-finished should be obvious, and one tap from here. Its figure is the pieces at
    /// today's rates, as the web's card shows it.
    private func progressRow(_ draft: SaleDraft) -> some View {
        let n = draft.lines.count
        var subtotal = 0.0
        if let s = book.settings.value {
            let rates = PricingRates(s)
            for line in draft.lines { subtotal += calculateProductCosts(line.priced, rates).totalPrice }
        }
        return NavigationLink(value: SaleLinks.newSale) {
            HStack(spacing: 12) {
                Image(systemName: "cart").font(.title3).foregroundStyle(Tone.owed.color)
                VStack(alignment: .leading, spacing: 2) {
                    Text("A sale in progress").font(.headline)
                    Text("\(n) piece\(n == 1 ? "" : "s")" + (subtotal > 0 ? " · \(Money.pkr(subtotal))" : ""))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
    }

    /// An order left half-typed, one tap away like the sale.
    private var orderProgressRow: some View {
        NavigationLink(value: Route(path: "/orders/add")) {
            HStack(spacing: 12) {
                Image(systemName: "list.clipboard").font(.title3).foregroundStyle(Tone.owed.color)
                Text("An order in progress").font(.headline)
            }
        }
    }

    /// An icon in its own colour, the title and one line: Settings' and Files' rows.
    private func choice(path: String, icon: String, title: String, tint: Color, blurb: String) -> some View {
        NavigationLink(value: Route(path: path)) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    // A glyph on a filled tile: the house's own words on its accent, white on the other tones.
                    .foregroundStyle(tint == Theme.accent ? Theme.onAccent : Color.white)
                    .frame(width: 36, height: 36)
                    .background(tint.gradient, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(blurb)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
    }
}
