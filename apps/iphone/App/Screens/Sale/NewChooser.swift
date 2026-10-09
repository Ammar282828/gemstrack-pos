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

    var body: some View {
        List {
            Section {
                Text("What is this? You add the pieces once you have picked.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            }

            if let draft = inProgress, !draft.lines.isEmpty {
                Section { progressRow(draft) } footer: {
                    Text("Kept on this phone, and in Drafts for the counter.")
                }
            }

            Section {
                NavigationLink(value: Route(path: "/drafts")) {
                    Label("Drafts", systemImage: "tray.full")
                }
            } footer: {
                Text("Orders and sales not yet saved, from every device in the shop.")
            }

            choice(
                path: "/invoices/new", icon: "doc.text", title: "Sale", primary: true,
                blurb: "The customer is buying now.",
                points: ["Add each piece with its details and price", "Take payment in full or leave a balance", "Prints an invoice and records the sale"]
            )
            choice(
                path: "/orders/add", icon: "list.clipboard", title: "Order", primary: false,
                blurb: "A piece to be made, delivered later.",
                points: ["Describe what is being made, with sizes and instructions", "Take an advance now, the balance on delivery", "Goes to the workshop and can be assigned to a karigar"]
            )
            choice(
                path: "/repairs?new=1", icon: "wrench.and.screwdriver", title: "Repair", primary: false,
                blurb: "A piece brought in to be fixed.",
                points: ["One customer, any number of pieces", "What to do, a price and a ready-by date", "In the shop → Ready → Collected"]
            )

            // The other ways in. Reading a written bill and a parchi are the ERP's AI scanners: its pages.
            Section("Other ways in") {
                NavigationLink(value: Route(path: "/scan")) {
                    Label("Scan a tag", systemImage: "qrcode.viewfinder")
                }
                NavigationLink(value: SaleLinks.webBill) {
                    Label("Read a written bill", systemImage: "camera.viewfinder")
                }
                NavigationLink(value: Route(path: "/orders/add?web=1&scan=parchi")) {
                    Label("Scan a parchi", systemImage: "doc.text.viewfinder")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("New sale")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { inProgress = SaleDraftStore.load() }
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
                Image(systemName: "cart").font(.title3).foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text("A sale in progress").font(.headline)
                    Text("\(n) piece\(n == 1 ? "" : "s")" + (subtotal > 0 ? " · \(Money.pkr(subtotal))" : ""))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Text("Continue").font(.subheadline.weight(.semibold))
            }
        }
    }

    private func choice(path: String, icon: String, title: String, primary: Bool, blurb: String, points: [String]) -> some View {
        Section {
            NavigationLink(value: Route(path: path)) {
                HStack(alignment: .top, spacing: 14) {
                    iconTile(icon, primary: primary)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title).font(.title2.weight(.bold))
                        Text(blurb).font(.subheadline).foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(points, id: \.self) { p in
                                HStack(alignment: .top, spacing: 8) {
                                    Text("•").foregroundStyle(.tint)
                                    Text(p).font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.top, 2)
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }

    @ViewBuilder
    private func iconTile(_ symbol: String, primary: Bool) -> some View {
        if primary {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Theme.onAccent)
                .frame(width: 44, height: 44)
                .background(.tint, in: .rect(cornerRadius: 12))
        } else {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.primary)
                .frame(width: 44, height: 44)
                .background(.quaternary, in: .rect(cornerRadius: 12))
        }
    }
}
