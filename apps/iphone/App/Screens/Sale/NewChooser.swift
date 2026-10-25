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
        #if os(macOS)
        macBody
        #else
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
        #endif
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
        return NavigationLink(value: SaleLinks.continueSale) {
            HStack(spacing: pt(12)) {
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

    /// An order left half-typed, one tap away like the sale (it is continued on purpose: a New order is blank).
    private var orderProgressRow: some View {
        NavigationLink(value: Route(path: "/orders/add?resume=1")) {
            HStack(spacing: pt(12)) {
                Image(systemName: "list.clipboard").font(.title3).foregroundStyle(Tone.owed.color)
                Text("An order in progress").font(.headline)
            }
        }
    }

    /// An icon in its own colour, the title and one line: Settings' and Files' rows.
    private func choice(path: String, icon: String, title: String, tint: Color, blurb: String) -> some View {
        NavigationLink(value: Route(path: path)) {
            HStack(spacing: pt(14)) {
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
            .padding(.vertical, pt(4))
        }
    }
}

// MARK: - The Mac: what is it?

#if os(macOS)
/// New on the Mac: the three kinds of sale as cards across one window, the sale or order half done above them, and the
/// other ways in (a tag, a written bill, a slip, Drafts) as buttons. ⌘N, ⇧⌘N and ⌥⌘N make them straight from the menu;
/// this is the page behind the sidebar's New.
extension NewChooser {
    @ViewBuilder
    var macBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let draft = inProgress, !draft.lines.isEmpty {
                    macBanner { progressRow(draft) }
                }
                if orderInProgress {
                    macBanner { orderProgressRow }
                }
                VStack(alignment: .leading, spacing: 12) {
                    LedgerHeading(title: "What is it?")
                    HStack(alignment: .top, spacing: 16) {
                        MacChoiceCard(path: "/invoices/new", icon: "doc.text.fill", title: "Sale", tint: Theme.accent,
                                      blurb: "Buying now: pieces, payment, the invoice", shortcut: "⌘N")
                        MacChoiceCard(path: "/orders/add", icon: "list.clipboard.fill", title: "Order", tint: Tone.working.color,
                                      blurb: "To be made: sizes, an advance, the workshop", shortcut: "⇧⌘N")
                        MacChoiceCard(path: "/repairs?new=1", icon: "wrench.and.screwdriver.fill", title: "Repair", tint: Tone.credit.color,
                                      blurb: "Brought in to be fixed: pieces, price, ready-by", shortcut: "⌥⌘N")
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    LedgerHeading(title: "Other ways in")
                    HStack(spacing: 12) {
                        NavigationLink(value: Route(path: "/scan")) { Label("Scan a tag", systemImage: "qrcode.viewfinder") }
                        NavigationLink(value: SaleLinks.readBill) { Label("Read a written bill", systemImage: "camera.viewfinder") }
                        NavigationLink(value: Route(path: "/orders/add?scan=parchi")) { Label("Read a slip", systemImage: "doc.text.viewfinder") }
                        NavigationLink(value: Route(path: "/drafts")) { Label("Drafts", systemImage: "tray.full") }
                    }
                    .buttonStyle(.bordered)
                    .largeOnPhone()
                }
            }
            .frame(maxWidth: 860, alignment: .leading)
            .padding(28)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
        .navigationTitle("New")
        .onAppear {
            inProgress = SaleDraftStore.load()
            orderInProgress = NewOrderDraftStore.orderInProgress
        }
        .task { book.settings.need() }
    }

    private func macBanner<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)
            .ledgerCard(padding: 16)
            .cardHover()
    }
}

/// One kind of sale as a card: a click opens it, right-click offers a window of its own.
private struct MacChoiceCard: View {
    let path: String
    let icon: String
    let title: String
    let tint: Color
    let blurb: String
    let shortcut: String
    @Environment(\.openPlaceWindow) private var openPlace

    var body: some View {
        NavigationLink(value: Route(path: path)) {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: icon)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(tint == Theme.accent ? Theme.onAccent : Color.white)
                    .frame(width: 44, height: 44)
                    .background(tint.gradient, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.title3.weight(.semibold))
                    Text(blurb).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Text(shortcut).font(.caption.monospaced()).foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .ledgerCard(padding: 18)
        .cardHover()
        .contextMenu {
            Button("Open in New Window") { openPlace?(Route(path: path)) }
        }
    }
}
#endif
