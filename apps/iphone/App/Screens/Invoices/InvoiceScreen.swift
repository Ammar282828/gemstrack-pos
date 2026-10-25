import SwiftUI
import ERPCore

/// An invoice, for the shop (src/components/invoice/invoice-viewer.tsx): its pieces and figures,
/// payments, taking a payment, the customer's page to share, and who it was for (named or changed
/// here, set-customer-dialog.tsx). The PDF is the one Print saves (lib/invoice-pdf.ts), drawn on the ERP's
/// server and shown here (PDFDocumentScreen), to print or share; Taheri's WhatsApp send has the server draw
/// and send it from the shop's line, and House of Mina's link goes from here. Edit is New sale's own form;
/// the discount, deleting a payment, a refund and deleting the invoice are native sheets (InvoiceAction*,
/// owners, the last three behind the delete code); the Shopify payment link is made here too
/// (InvoicePaymentLink). Nothing opens the ERP's page.
///
/// Laid out as the order's page is (a List on the house's ground, 2026-10-12): one receipt at the head (who,
/// when, what is still due beside a ring of what is paid), the quick row (ring, write, print), then the pieces
/// as the bill reads them with its totals, the payments, the details, and the shop's own lines at the foot.
/// Take payment is the bar at the foot while money is owed; the ⋯ menu keeps everything else.
struct InvoiceScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var paying: Invoice?
    @State private var web: Route?
    @State private var settingCustomer = false
    /// Send on WhatsApp, by house (InvoiceWhatsAppSend): set to start it.
    @State private var sending: Invoice?
    @State private var pdf: InvoicePDFTarget?
    @State private var note: Note?
    @State private var acting: InvoiceAct?
    /// Past the first five pieces, shown on request.
    @State private var allPieces = false
    /// A payment swiped away: the delete code is asked for it straight away (InvoiceActionPaymentSheet.deletion).
    @State private var paymentDeletion: OwnerDeletion?
    @State private var paymentOutcome: InvoiceActionOutcome?
    /// The shop floor's answer to an owner's move: the server refuses staff, so it is said here instead.
    @State private var ownersOnly: String?
    /// The payment link to make (InvoicePaymentLink): set to start it.
    @State private var linking: Invoice?

    private var canPay: Bool { InvoiceFacts.mayTakePayments(role: session.role) }

    /// The margin is the shop's own (lib/margin.ts): owners and staff see it, blurred until tapped, and
    /// never a customer (docs/decisions.md "Margin"). Mina's silver is not costed that way: its web page
    /// shows none (NEXT_PUBLIC_STORE_COST_RATTI_LESS "none").
    private var showsMargin: Bool { House.margin.rattiLess != nil }

    /// Pieces shown before "Show N more".
    private let firstPieces = 5

    var body: some View {
        #if os(macOS)
        macBody
        #else
        let invoice = book.invoices.item(id)
        Group {
            if let invoice {
                detail(invoice)
            } else {
                ShelfState(loaded: book.invoices.loaded, error: book.invoices.error, offline: book.invoices.offline) {
                    notFound
                }
            }
        }
        .navigationTitle(id)
        .navigationBarTitleDisplayMode(.inline)
        // The page grows out of its row on the list (the row's id is this route's path).
        .zoomDestination(id: InvoiceFacts.path(id))
        .task {
            book.invoices.need()
            book.customers.need()
        }
        #endif
    }

    /// An invoice the books do not hold: refunded in full, which removes it (the ERP's words).
    private var notFound: some View {
        ContentUnavailableView {
            Label("Invoice \(id) not found", systemImage: "doc.questionmark")
        } description: {
            Text("It may have been refunded in full, which removes it.")
        } actions: {
            NavigationLink(value: Route(path: "/invoices/new")) { Text("New sale") }
                .buttonStyle(.houseProminent)
            NavigationLink(value: Route(path: "/invoices")) { Text("All invoices") }
                .buttonStyle(.bordered)
        }
    }

    // MARK: The page

    private func detail(_ inv: Invoice) -> some View {
        // On an iPad's wide window the receipt and the quick row stand left, the bill and its payments right.
        WideDetailList {
            // The receipt and the quick row carry their own surface; the rest sit on the house's cards.
            heroSection(inv)
            quickSection(inv)
        } right: {
            Group {
                piecesSection(inv)
                paymentsSection(inv)
                detailsSection(inv)
                shopSection(inv)
            }
            .houseRows()
        }
        .safeAreaBar(edge: .bottom, spacing: 0) { paymentBar(inv) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    menuItems(inv)
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
        .navigationDestination(item: $web) { r in
            ScreenRegistry.view(for: r.path)
                .navigationTitle(inv.id)
                .navigationBarTitleDisplayMode(.inline)
        }
        .navigationDestination(item: $pdf) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .invoicePaymentSheet(for: $paying) { paid, amount in recorded(paid, amount) }
        .sheet(isPresented: $settingCustomer) {
            InvoiceCustomerSheet(invoice: inv) { (saved: InvoiceNote) in say(saved) }
                .presentationSizing(.form)
        }
        .sheet(item: $acting) { a in
            Group {
                switch a {
                case .discount: InvoiceActionDiscountSheet(invoice: inv, onDone: acted)
                case .giveBack: InvoiceActionCreditSheet(invoice: inv, onDone: acted)
                case .refund: InvoiceActionRefundSheet(invoice: inv, onDone: acted)
                case .delete: InvoiceActionDeleteSheet(invoice: inv, onDone: acted)
                }
            }
            .presentationSizing(.form)
        }
        .invoiceActionCode($paymentDeletion) {
            if let outcome = paymentOutcome { acted(outcome) }
        }
        .invoiceWhatsAppSend($sending) { sent in say(sent) }
        .invoicePaymentLink($linking) { made in say(made) }
        .failureAlert($ownersOnly, title: "Owners only")
        .noteToast($note)
    }

    /// Say a note from a sheet or a send on the page's toast.
    private func say(_ n: InvoiceNote) {
        Note.show(Note(title: n.title, detail: n.detail), in: $note, reduce: reduceMotion)
    }

    /// A payment taken from this page: what is left, said as the sheet closes.
    private func recorded(_ inv: Invoice, _ amount: Double) {
        let line = balanceLine(inv.balanceDue - amount)
        let detail: String
        switch line.state {
        case .due: detail = "\(Money.pkr(line.amount)) still due"
        case .credit: detail = "Paid in full, \(Money.pkr(line.amount)) in credit"
        case .paid: detail = "Paid in full"
        }
        Note.show(Note(title: "Payment recorded", detail: detail), in: $note, reduce: reduceMotion)
    }

    // MARK: The receipt: who, when, what is due

    /// Who it was for and when, then what is still due (or credit, or paid in full) beside the ring of what is
    /// paid, with the total and the paid sum under it.
    private func heroSection(_ inv: Invoice) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        let when = ShopDate.say(inv.createdAt, withTime: true)
        return Section {
            VStack(alignment: .leading, spacing: 14) {
                layout {
                    Monogram(name: inv.customerName, size: Monogram.Size.hero)
                    VStack(alignment: .leading, spacing: 4) {
                        customerTitle(inv)
                        if !when.isEmpty {
                            Text(when)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        HStack(spacing: 6) {
                            Text(piecesLine(inv))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
                // A sale to nobody in particular, named once the bill is out (decision "Name a sale"): an owner's, as on the web.
                if session.isOwner && unnamed(inv) && inv.status != .refunded {
                    Button { settingCustomer = true } label: {
                        Label("Name the customer", systemImage: "person.crop.circle.badge.plus")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
                    .frame(minHeight: 44)
                }
                PerforationDivider()
                figures(inv)
                // Whoever opens it next sees the PDF went, so it is not sent twice.
                if let sent = inv.sentOnWhatsApp {
                    Label("PDF sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .heroSheen(padding: 18)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    /// "3 pieces · Taken by Demo".
    private func piecesLine(_ inv: Invoice) -> String {
        let n = inv.items.count
        var parts = ["\(n) piece\(n == 1 ? "" : "s")"]
        if let by = inv.takenBy, !by.isEmpty { parts.append("Taken by " + by) }
        return parts.joined(separator: " · ")
    }

    private func isShopify(_ inv: Invoice) -> Bool { (inv.source ?? "").hasPrefix("shopify") }

    /// What is due as the big figure, the ring of what is paid beside it, and both sums in a line under.
    private func figures(_ inv: Invoice) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        return layout {
            VStack(alignment: .leading, spacing: 4) {
                leadFigure(inv)
                // Paid in full says it once, in the lead; the sums are under Pieces and Payments (rule 15).
                if balanceLine(inv.balanceDue).state != .paid || inv.status == .refunded {
                    Text("Total \(Money.pkr(inv.grandTotal)) · Paid \(Money.pkr(inv.amountPaid))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .contentTransition(.numericText(value: inv.balanceDue))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            PaidRing(paid: inv.amountPaid, total: inv.grandTotal)
        }
        // The figures roll to their new numbers as a payment or a discount lands: on them, not on the whole list.
        .motion(inv.balanceDue)
    }

    /// Due while owing (amber, red once old), In credit, or Paid in full; a refunded invoice says Refunded instead.
    @ViewBuilder
    private func leadFigure(_ inv: Invoice) -> some View {
        let line = balanceLine(inv.balanceDue)
        if inv.status == .refunded {
            Pill("Refunded", tone: .quiet, symbol: "arrow.uturn.backward")
        } else {
            switch line.state {
            case .due:
                Text("Due").font(.subheadline).foregroundStyle(.secondary)
                HeroAmount(amount: line.amount, tone: InvoiceFacts.balanceTone(inv).color)
            case .credit:
                Text("In credit").font(.subheadline).foregroundStyle(.secondary)
                HeroAmount(amount: line.amount, tone: Tone.credit.color)
            case .paid:
                // Paid is what an invoice is meant to be: said in the ink, not as a green badge (CONVENTIONS rule 15).
                Text("Paid in full")
                    .font(.system(.largeTitle, design: .serif).weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }

    /// The customer's name in the serif. Their page is the Details section's first row: a link inside the receipt's
    /// row would make the whole row a link, and take the Name the customer button's tap with it.
    private func customerTitle(_ inv: Invoice) -> some View {
        Text(InvoiceFacts.customerName(inv, walkIn: "Walk-in"))
            .font(.system(.title2, design: .serif).weight(.semibold))
            .foregroundStyle(Color.primary)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
    }

    /// The customer's id when the sale has a real one: not a walk-in however it was recorded, and
    /// not just a typed name (saleCustomerKey says which).
    private func linkableCustomer(_ inv: Invoice) -> String? {
        let key = saleCustomerKey(inv, currentName: { cid in book.customers.item(cid)?.name })
        if key == WALK_IN_ENTITY || key.hasPrefix("name:") { return nil }
        return key
    }

    // MARK: What is done most, one tap away

    /// Ring, write or message the customer, and the PDF: the things the counter does after a sale. Taking the
    /// money is the bar at the foot, so it has no tile here.
    private func quickSection(_ inv: Invoice) -> some View {
        let phone = whatsAppPhone(inv)
        let reachable = !CustomerKit.dialable(phone).isEmpty
        return Section {
            HStack(alignment: .top, spacing: 10) {
                if reachable { ContactActions(phone: phone) }
                QuickAction(title: "PDF", symbol: "doc.richtext") {
                    pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer)
                }
                .frame(maxWidth: reachable ? 88 : 110)
                if !reachable { Spacer(minLength: 0) }
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    // MARK: The pieces, as the bill reads them

    @ViewBuilder
    private func piecesSection(_ inv: Invoice) -> some View {
        let items = Array(inv.items.enumerated())
        let shown = allPieces ? items : Array(items.prefix(firstPieces))
        Section {
            if inv.items.isEmpty {
                Text("No pieces on this invoice.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(shown, id: \.offset) { pair in
                InvoicePieceRow(item: pair.element, showBreakdown: session.isOwner)
            }
            if !allPieces && items.count > firstPieces {
                Button("Show \(items.count - firstPieces) more") {
                    Motion.run(Motion.enter, reduce: reduceMotion) { allPieces = true }
                }
            }
            totalRows(inv)
        } header: {
            LedgerHeading(title: "Pieces", count: inv.items.count)
        }
    }

    /// Under the pieces, as the printed bill: the subtotal, the discount, each exchange row on its own line (what was
    /// taken in, lib/exchange.ts), any adjustment, and the one Total; the rates it was priced at, unless it leaves
    /// them off (`hideRates`: the bill is priced at these rates and just does not say so).
    @ViewBuilder
    private func totalRows(_ inv: Invoice) -> some View {
        let exchanges = invoiceExchanges(inv)
        let adjustments = inv.adjustmentsAmount ?? 0
        let rates = appliedRates(inv)
        MoneyRow("Subtotal", inv.subtotal)
        if inv.discountAmount > 0 {
            MoneyRow("Discount", -inv.discountAmount, signed: true)
        }
        if exchangeTotal(exchanges) > 0 {
            ForEach(Array(exchanges.enumerated()), id: \.offset) { pair in
                exchangeRow(pair.element)
            }
        }
        if adjustments != 0 {
            MoneyRow("Adjustments", adjustments, signed: true)
        }
        MoneyRow("Total", inv.grandTotal, emphasis: true)
        if !inv.hideRates && !rates.isEmpty {
            Text("Rates applied · " + rates.joined(separator: "  ·  "))
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }

    private func exchangeRow(_ e: ExchangeEntry) -> some View {
        let said = describeExchangeEntry(e)
        return VStack(alignment: .leading, spacing: 2) {
            if e.value > 0 {
                MoneyRow("Exchange", -e.value, signed: true)
            } else {
                LabeledContent("Exchange", value: "—")
            }
            if !said.isEmpty {
                Text(said).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func appliedRates(_ inv: Invoice) -> [String] {
        let used = Set(inv.items.filter { $0.metalType == .gold }.compactMap { $0.karat })
        let r = inv.ratesApplied
        var out: [String] = []
        if used.contains(.k24), let v = r.goldRatePerGram24k, v > 0 { out.append("24k \(Money.grouped(v))/g") }
        if used.contains(.k22), let v = r.goldRatePerGram22k, v > 0 { out.append("22k \(Money.grouped(v))/g") }
        if used.contains(.k21), let v = r.goldRatePerGram21k, v > 0 { out.append("21k \(Money.grouped(v))/g") }
        if used.contains(.k18), let v = r.goldRatePerGram18k, v > 0 { out.append("18k \(Money.grouped(v))/g") }
        return out
    }

    // MARK: Payments

    /// Always there: what came in, or that nothing has. An owner swipes a payment to delete it (the delete code
    /// is asked next, saying what the invoice will read after).
    @ViewBuilder
    private func paymentsSection(_ inv: Invoice) -> some View {
        let line = balanceLine(inv.balanceDue)
        Section {
            if inv.paymentHistory.isEmpty {
                Text("No payments yet").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(inv.paymentHistory.enumerated()), id: \.offset) { pair in
                paymentRow(inv, index: pair.offset, payment: pair.element)
            }
            // While money is owed the bar at the foot is the one Take payment; this row is for a paid invoice (credit).
            if mayTakePayment(inv) && !owing(inv) {
                Button { paying = inv } label: {
                    Label("Take payment as credit", systemImage: "banknote")
                }
            }
            // Paid past the total: the customer's credit, on their hisaab (decision "Invoice credit"). The sum is the
            // receipt's figure, so it is not said again here (CONVENTIONS rule 15).
            if line.state == .credit && inv.status != .refunded && !inv.paymentHistory.isEmpty {
                Label("\(line.label), on \(InvoiceFacts.customerName(inv, walkIn: "the customer"))'s hisaab",
                      systemImage: "arrow.uturn.left.circle.fill")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Tone.credit.color)
                // Finish the credit by handing the money over (an owner's; a walk-in holds none).
                if session.isOwner && InvoiceCredit.held(inv) >= 1 {
                    Button { act(.giveBack, inv) } label: {
                        Label("Give back \(Money.pkr(InvoiceCredit.held(inv)))", systemImage: "banknote")
                    }
                }
            }
        } header: {
            // What was paid is the receipt's own line; the heading keeps the count.
            LedgerHeading(title: "Payments", count: inv.paymentHistory.count > 1 ? inv.paymentHistory.count : nil)
        }
    }

    @ViewBuilder
    private func paymentRow(_ inv: Invoice, index: Int, payment: Payment) -> some View {
        if session.isOwner {
            InvoicePaymentRow(payment: payment)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { askDelete(inv, index: index, payment: payment) } label: {
                        Label("Delete payment", systemImage: "trash")
                    }
                }
                .contextMenu {
                    Button(role: .destructive) { askDelete(inv, index: index, payment: payment) } label: {
                        Label("Delete payment", systemImage: "trash")
                    }
                }
        } else {
            InvoicePaymentRow(payment: payment)
        }
    }

    /// The existing delete-a-payment flow, started on this payment: the delete code says what the invoice reads after.
    private func askDelete(_ inv: Invoice, index: Int, payment: Payment) {
        guard let ask = InvoiceActionPaymentSheet.deleting(inv, index: index, payment: payment) else { return }
        paymentOutcome = ask.outcome
        paymentDeletion = ask.deletion
    }

    // MARK: Details

    /// Where it came from, where it goes, who took it and how it reached us: the quiet facts.
    @ViewBuilder
    private func detailsSection(_ inv: Invoice) -> some View {
        let order = inv.sourceOrderId ?? ""
        let ship = describeDelivery(inv.delivery)
        let by = inv.takenBy ?? ""
        let source = sourceWords(inv)
        let customerId = linkableCustomer(inv)
        if customerId != nil || !order.isEmpty || !ship.isEmpty || !by.isEmpty || source != nil {
            Section {
                if let customerId {
                    NavigationLink(value: Route(path: "/customers/" + InvoiceFacts.encode(customerId))) {
                        LabeledContent("Customer", value: InvoiceFacts.customerName(inv, walkIn: "Walk-in"))
                    }
                }
                if !order.isEmpty {
                    NavigationLink(value: Route(path: "/orders/" + InvoiceFacts.encode(order))) {
                        LabeledContent("From order", value: order)
                    }
                }
                if !ship.isEmpty {
                    LabeledContent("Deliver to") {
                        Text(ship.joined(separator: "\n")).multilineTextAlignment(.trailing)
                    }
                }
                if !by.isEmpty {
                    LabeledContent("Taken by", value: by)
                }
                if let source {
                    LabeledContent("Source", value: source)
                }
            } header: {
                LedgerHeading(title: "Details")
            }
        }
    }

    /// Shopify's import, else the channel the customer came by.
    private func sourceWords(_ inv: Invoice) -> String? {
        if isShopify(inv) { return "Shopify" }
        return inv.acquisitionSource.map { OrdersLogic.sourceLabel($0) }
    }

    // MARK: For the shop

    /// The shop's margin (owners and staff; blurred until tapped) and the note nobody but the shop reads.
    @ViewBuilder
    private func shopSection(_ inv: Invoice) -> some View {
        let shopNote = (inv.internalNote ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !shopNote.isEmpty || showsMargin {
            Section {
                if showsMargin { InvoiceMarginRow(invoice: inv) }
                if !shopNote.isEmpty {
                    Text(shopNote).font(.subheadline)
                }
            } header: {
                LedgerHeading(title: "For the shop (never printed)")
            }
        }
    }

    // MARK: Taking money

    private func owing(_ inv: Invoice) -> Bool { isOwing(inv) }

    /// Owed, or a named customer's money over the total, taken as credit (invoice-credit.ts).
    private func mayTakePayment(_ inv: Invoice) -> Bool {
        canPay && (owing(inv) || canHoldCredit(inv.customerId))
    }

    /// Taking a payment is THE action of an invoice that is owed: the kit's action bar (it stacks at accessibility sizes).
    @ViewBuilder
    private func paymentBar(_ inv: Invoice) -> some View {
        if canPay && owing(inv) {
            ActionBar(primary: ActionBar.Action("Take payment · \(Money.pkr(inv.balanceDue))", systemImage: "banknote") {
                paying = inv
            })
        }
    }

    // MARK: The menu

    /// A sale to nobody in particular: the ERP page offers "Name them" (decisions: Name a sale).
    private func unnamed(_ inv: Invoice) -> Bool {
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || isWalkInName(name)
    }

    /// The number the ERP page's box starts with: the invoice's, else its customer's.
    private func whatsAppPhone(_ inv: Invoice) -> String {
        InvoiceFacts.whatsAppPhone(inv, customer: inv.customerId.flatMap { book.customers.item($0) })
    }

    /// Share, Change, More, then the two that cannot be taken back. Taking a payment is the bar (and, for a paid
    /// invoice, the Payments section); deleting a payment is a swipe on its row.
    @ViewBuilder
    private func menuItems(_ inv: Invoice) -> some View {
        Section("Share") {
            // The PDF Print saves, drawn on the ERP's server and shown here: Print, Files, AirDrop from its share sheet.
            Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer) } label: {
                Label("PDF", systemImage: "doc.richtext")
            }
            // The split button's other half (print-button.tsx): one invoice per piece, for pieces bought for several people.
            if inv.items.count > 1 {
                Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer, perPiece: true) } label: {
                    Label("PDF per piece", systemImage: "doc.on.doc")
                }
            }
            Button { sending = inv } label: {
                Label(inv.sentOnWhatsApp == nil ? "WhatsApp" : "WhatsApp again", systemImage: "message")
            }
            if let url = InvoiceFacts.shareURL(inv) {
                ShareLink(item: url,
                          subject: Text(InvoiceFacts.shareTitle(inv, byCustomer: session.shop.invoiceByCustomer)),
                          message: Text(InvoiceFacts.shareMessage(inv, shopName: session.shop.name,
                                                                  byCustomer: session.shop.invoiceByCustomer))) {
                    Label("Customer link", systemImage: "link")
                }
            }
            // Shopify's checkout for what is owed, made fresh each time and copied (invoices/page.tsx).
            if InvoiceFacts.offersPaymentLink(inv) {
                Button { linking = inv } label: { Label(InvoiceFacts.paymentLinkTitle(inv), systemImage: "link.badge.plus") }
            }
        }
        Section("Change") {
            Button { web = Route(path: InvoiceFacts.editPath(inv.id)) } label: { Label("Edit", systemImage: "pencil") }
            // Gold moves: the same edit, at its rates (an owner's, as Edit invoice is).
            if session.isOwner {
                Button { web = Route(path: InvoiceFacts.changeRatePath(inv.id)) } label: { Label("Change rate", systemImage: "percent") }
            }
            if inv.status != .refunded {
                // The store's own Firestore write on the web, which the shop floor cannot make: an owner's.
                if session.isOwner {
                    Button { settingCustomer = true } label: {
                        Label(unnamed(inv) ? "Name the customer" : "Change customer", systemImage: "person.crop.circle")
                    }
                }
                if session.isOwner {
                    Button { act(.discount, inv) } label: { Label("Change discount", systemImage: "percent") }
                }
            }
        }
        // Owners' only (the server refuses staff): not offered to the shop floor at all.
        if session.isOwner {
            Section {
                if inv.status != .refunded {
                    Button(role: .destructive) { act(.refund, inv) } label: { Label("Refund…", systemImage: "arrow.uturn.backward") }
                }
                Button(role: .destructive) { act(.delete, inv) } label: { Label("Delete invoice…", systemImage: "trash") }
            }
        }
    }

    /// An owner's sheet; the shop floor is told so here, as the server would refuse it (each is the store's own
    /// Firestore write on the web, which staff cannot make).
    private func act(_ a: InvoiceAct, _ inv: Invoice) {
        if session.isOwner { acting = a } else { ownersOnly = a.ownersOnly }
    }

    /// After a sheet: its note on the page, or back to the list when the invoice is gone.
    private func acted(_ o: InvoiceActionOutcome) {
        // Said either way: after a delete or a full refund the page stays a moment under its toast, then goes.
        say(o.note)
        if o.removed {
            Task {
                try? await Task.sleep(for: .seconds(1.6))
                dismiss()
            }
        }
    }
}

// MARK: Lines of the cards

/// One piece: what it is and its price, then its metal, weight and stock number, what is set into it, and the
/// breakdown the printed bill carries.
private struct InvoicePieceRow: View {
    let item: InvoiceItem

    /// Grams, to three places at most: 3.9, 12.345.
    private static let grams: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 3
        return f
    }()

    private static func say(_ v: Double) -> String {
        grams.string(from: NSNumber(value: v)) ?? String(v)
    }

    /// Owners see the price broken into metal, wastage, making and stones, as the order's pieces do.
    var showBreakdown = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // The name leading and the price trailing; at accessibility sizes the price goes under the name.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
            layout {
                Text(title)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
                RowAmount(amount: item.itemTotal)
            }
            if !facts.isEmpty {
                Text(facts.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(settings, id: \.self) { line in
                Text(line).font(.caption).foregroundStyle(.secondary)
            }
            if showBreakdown && !costs.isEmpty {
                Text(costs.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// The piece's name, else its category, else its stock number.
    private var title: String {
        let name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return category ?? (item.sku.isEmpty ? "Piece" : item.sku)
    }

    /// The category in words ("Ring" for cat001), or what the piece carries when it is not one of the
    /// ERP's own (invoice-viewer.tsx: `categorySingular(id) || id`).
    private var category: String? {
        guard let c = item.itemCategory?.trimmingCharacters(in: .whitespacesAndNewlines), !c.isEmpty else { return nil }
        return OrdersLogic.categorySingular(c)
    }

    /// The category (unless the name already says it), metal and karat, weight, size, finish, stone weight, and
    /// the stock number when it is one.
    private var facts: [String] {
        var out: [String] = []
        if let category, title != category, !title.localizedCaseInsensitiveContains(category) { out.append(category) }
        out.append(describeMetal(item.metalType, item.karat))
        if item.metalWeightG > 0 { out.append(Self.say(item.metalWeightG) + " g") }
        if let size = item.size, !size.isEmpty { out.append("Size " + size) }
        if let finish = describePlating(item) { out.append(finish) }
        if item.stoneWeightG > 0 { out.append("Stone " + Self.say(item.stoneWeightG) + " g") }
        if let sku = stockSku(item.sku) { out.append(sku) }
        return out.filter { !$0.isEmpty }
    }

    /// What is set into it (diamonds, stones), less the lines the facts already say.
    private var settings: [String] {
        describeSettings(item).filter { !$0.hasPrefix("Finish:") && !$0.hasPrefix("Stone weight:") }
    }

    private var costs: [String] {
        var out: [String] = []
        if item.metalCost > 0 { out.append("Metal " + Money.grouped(item.metalCost)) }
        if item.wastageCost > 0 {
            let percent = Self.say(item.wastagePercentage)
            out.append("Wastage (\(percent)%) \(Money.grouped(item.wastageCost))")
        }
        if item.makingCharges > 0 { out.append("Making " + Money.grouped(item.makingCharges)) }
        if item.diamondChargesIfAny > 0 { out.append("Diamonds " + Money.grouped(item.diamondChargesIfAny)) }
        if item.stoneChargesIfAny > 0 { out.append("Stones " + Money.grouped(item.stoneChargesIfAny)) }
        if item.miscChargesIfAny > 0 { out.append("Misc " + Money.grouped(item.miscChargesIfAny)) }
        return out
    }

    /// The SKU worth showing a person: a one-off key (NEW-…, BILL-…) is not a stock number.
    private func stockSku(_ sku: String) -> String? {
        // TODO(logic): port stockSku / isOneOffSku (lib/sku.ts).
        if sku.isEmpty || sku.hasPrefix("NEW-") || sku.hasPrefix("BILL-") { return nil }
        return sku
    }
}

/// One payment: how it came (its symbol), when, any reference or note, and the amount. A refund (a row below
/// zero, lib/writes/invoice-refund.ts) reads as one, quietly.
private struct InvoicePaymentRow: View {
    let payment: Payment

    private var refund: Bool { payment.amount < 0 }
    /// Credit handed back (lib/writes/invoice-credit-payback.ts): also a negative line, but not a refund of the sale.
    private var paidBack: Bool { refund && (payment.notes ?? "").hasPrefix("Credit paid back") }
    @ScaledMetric(relativeTo: .subheadline) private var iconSize: CGFloat = 34

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone.color)
                .frame(width: iconSize, height: iconSize)
                .background(tone.color.opacity(0.12), in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if refund {
                Text(Money.minus(payment.amount))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            } else {
                RowAmount(amount: payment.amount)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var tone: Tone { refund ? .quiet : .settled }

    private var symbol: String {
        if refund { return "arrow.uturn.backward" }
        switch payment.method {
        case .cash?: return "banknote"
        case .card?: return "creditcard"
        case .bankTransfer?: return "building.columns"
        case .cheque?: return "doc.text"
        case .unknown?, nil: return "arrow.down.circle"
        }
    }

    /// The method (older records predate payment types and have none), or Refund.
    private var title: String {
        if refund { return paidBack ? "Credit paid back" : "Refund" }
        let method = payment.method?.rawValue ?? ""
        return method.isEmpty ? "Payment" : method
    }

    /// When, the reference, and a note that says more than the method does.
    private var detail: String {
        var parts: [String] = []
        let when = ShopDate.say(payment.date, withTime: true)
        if !when.isEmpty { parts.append(when) }
        if let ref = payment.reference, !ref.isEmpty { parts.append(ref) }
        if var note = payment.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty, !note.hasPrefix("Payment received") {
            if paidBack {
                note = payment.method?.rawValue ?? ""
            } else if refund, note.hasPrefix("Refund") {
                note = String(note.dropFirst("Refund".count)).trimmingCharacters(in: CharacterSet(charactersIn: ": ").union(.whitespaces))
            }
            if !note.isEmpty { parts.append(note) }
        }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }
}

/// What the shop earns on this sale (lib/margin.ts), for owners and staff and blurred until tapped: the
/// counter turns its screen to show a customer the bill, and a margin beside the total is the one
/// thing they must not read. The figure is not worked out until then, and it is in nothing that is
/// printed, shared or linked.
private struct InvoiceMarginRow: View {
    let invoice: Invoice
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button { Motion.run(Motion.enter, reduce: reduceMotion) { shown.toggle() } } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Label("We earn", systemImage: shown ? "eye.slash" : "eye")
                    .contentTransition(.symbolEffect(.replace))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                figure
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(shown ? "Hide our margin" : "Show our margin")
        .selectionFeedback(trigger: shown)
    }

    @ViewBuilder
    private var figure: some View {
        if shown {
            let m = invoiceMargin(invoice, settings: House.margin)
            Text(words(m))
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(tone(m))
        } else {
            Text("00.0% · \(Money.pkr(0))")
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .blur(radius: 6)
                .accessibilityHidden(true)
        }
    }

    private func tone(_ m: Margin) -> Color {
        if m.assumed { return Tone.quiet.color }
        return m.percent < 0 ? Tone.late.color : Tone.settled.color
    }

    private func words(_ m: Margin) -> String {
        if m.assumed { return "≈ \(percentLabel(m)) (no 24k rate given — assumed)" }
        var s = "\(percentLabel(m)) · \(Money.pkr(m.profit))"
        if m.costedShare < 0.999 {
            let rest = Int(((1 - m.costedShare) * 100).rounded())
            let assumed = Int((House.margin.assumedMargin * 100).rounded())
            s += " · \(rest)% of it at \(assumed)% (no weight)"
        }
        return s
    }
}

/// The invoice's own actions, each a sheet (InvoiceAction*).
enum InvoiceAct: String, Identifiable {
    case discount, giveBack, refund, delete
    var id: String { rawValue }

    /// What the shop floor is told: each is an owner's (ops-invoice-actions.ts), and the server refuses staff.
    var ownersOnly: String {
        switch self {
        case .discount: return "Changing the discount is an owner's. Ask an owner to change it."
        case .giveBack: return "Giving credit back is an owner's. Ask an owner to hand it back."
        case .refund: return "A refund is an owner's. Ask an owner to refund this invoice."
        case .delete: return "Deleting an invoice is an owner's. Ask an owner to delete it."
        }
    }
}

// MARK: - The Mac: the invoice as a record window

#if os(macOS)
/// The Mac's invoice (docs/features/mac-app.md): a record window. Who it was for, what is due and the totals stand in a
/// column at the left; the pieces and the payments are tables at the right, with a right-click on every row. The actions
/// are the toolbar's (Take payment, Edit, Discount, Refund, Send on WhatsApp, PDF, and the rest under More); ⌘P prints the
/// bill (MacCommands). Every action is the iPhone's own function and sheet.
extension InvoiceScreen {
    @ViewBuilder
    var macBody: some View {
        let invoice = book.invoices.item(id)
        return Group {
            if let invoice {
                macDetail(invoice)
            } else {
                ShelfState(loaded: book.invoices.loaded, error: book.invoices.error, offline: book.invoices.offline) {
                    notFound
                }
            }
        }
        .navigationTitle(id)
        .task {
            book.invoices.need()
            book.customers.need()
        }
    }

    private func macDetail(_ inv: Invoice) -> some View {
        let line = balanceLine(inv.balanceDue)
        let subtitle: String = {
            if inv.status == .refunded { return "Refunded" }
            switch line.state {
            case .due: return "Due \(Money.pkr(line.amount))"
            case .credit: return "In credit \(Money.pkr(line.amount))"
            case .paid: return "Paid in full"
            }
        }()
        return macSheets(
            GeometryReader { geo in
                // In the Invoices hub's pane the window is narrow: the summary goes above the tables.
                if geo.size.width >= 760 {
                    HStack(spacing: 0) {
                        macSummary(inv).frame(width: 340)
                        Divider()
                        macTables(inv).frame(maxWidth: .infinity)
                    }
                } else {
                    VStack(spacing: 0) {
                        macSummary(inv).frame(height: min(geo.size.height * 0.45, 360))
                        Divider()
                        macTables(inv).frame(maxHeight: .infinity)
                    }
                }
            }
            .background(Theme.ground)
            .navigationSubtitle(subtitle)
            .toolbar { macToolbar(inv) },
            inv)
    }

    /// The pages and sheets the invoice opens: the same ones the iPhone's page presents.
    private func macSheets<V: View>(_ content: V, _ inv: Invoice) -> some View {
        content
            .navigationDestination(item: $web) { r in
                ScreenRegistry.view(for: r.path)
                    .navigationTitle(inv.id)
            }
            .navigationDestination(item: $pdf) { t in
                PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
            }
            .invoicePaymentSheet(for: $paying) { paid, amount in recorded(paid, amount) }
            .sheet(isPresented: $settingCustomer) {
                InvoiceCustomerSheet(invoice: inv) { (saved: InvoiceNote) in say(saved) }
                    .presentationSizing(.form)
            }
            .sheet(item: $acting) { a in
                Group {
                    switch a {
                    case .discount: InvoiceActionDiscountSheet(invoice: inv, onDone: acted)
                    case .giveBack: InvoiceActionCreditSheet(invoice: inv, onDone: acted)
                    case .refund: InvoiceActionRefundSheet(invoice: inv, onDone: acted)
                    case .delete: InvoiceActionDeleteSheet(invoice: inv, onDone: acted)
                    }
                }
                .presentationSizing(.form)
            }
            .invoiceActionCode($paymentDeletion) {
                if let outcome = paymentOutcome { acted(outcome) }
            }
            .invoiceWhatsAppSend($sending) { sent in say(sent) }
            .invoicePaymentLink($linking) { made in say(made) }
            .failureAlert($ownersOnly, title: "Owners only")
            .noteToast($note)
    }

    // MARK: The toolbar

    @ToolbarContentBuilder
    private func macToolbar(_ inv: Invoice) -> some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if mayTakePayment(inv) {
                Button { paying = inv } label: {
                    Label(owing(inv) ? "Take payment · \(Money.pkr(inv.balanceDue))" : "Take payment as credit", systemImage: "banknote")
                }
                .keyboardShortcut("p", modifiers: [.command, .option])
                .help("Take a payment on this invoice (⌥⌘P)")
            }
            Button { web = Route(path: InvoiceFacts.editPath(inv.id)) } label: { Label("Edit", systemImage: "pencil") }
                .keyboardShortcut("e", modifiers: .command)
                .help("Change this invoice's pieces, payment or customer (⌘E)")
            if session.isOwner && inv.status != .refunded {
                Button { act(.discount, inv) } label: { Label("Discount", systemImage: "percent") }
                    .keyboardShortcut("d", modifiers: [.command, .shift])
                    .help("Change the discount (⇧⌘D)")
                Button { act(.refund, inv) } label: { Label("Refund…", systemImage: "arrow.uturn.backward") }
                    .help("Refund all or part of this invoice")
            }
            Button { sending = inv } label: { Label("Send on WhatsApp", systemImage: "message") }
                .keyboardShortcut("k", modifiers: [.command, .shift])
                .help(inv.sentOnWhatsApp == nil ? "Send the PDF to the customer on WhatsApp (⇧⌘K)" : "Send the PDF again on WhatsApp (⇧⌘K)")
            Menu {
                Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer) } label: {
                    Label("PDF", systemImage: "doc.richtext")
                }
                if inv.items.count > 1 {
                    Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer, perPiece: true) } label: {
                        Label("PDF per piece", systemImage: "doc.on.doc")
                    }
                }
            } label: {
                Label("PDF", systemImage: "doc.richtext")
            }
            .help("The bill as a PDF (⌘P prints it)")
            Menu {
                macMoreItems(inv)
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
        }
    }

    /// What the toolbar does not carry: the customer link, the payment link, naming the customer, deleting the invoice.
    @ViewBuilder
    private func macMoreItems(_ inv: Invoice) -> some View {
        if let url = InvoiceFacts.shareURL(inv) {
            Button { UIPasteboard.general.string = url.absoluteString } label: { Label("Copy the customer's link", systemImage: "link") }
        }
        if InvoiceFacts.offersPaymentLink(inv) {
            Button { linking = inv } label: { Label(InvoiceFacts.paymentLinkTitle(inv), systemImage: "link.badge.plus") }
        }
        if session.isOwner && inv.status != .refunded {
            Button { settingCustomer = true } label: {
                Label(unnamed(inv) ? "Name the customer" : "Change customer", systemImage: "person.crop.circle")
            }
        }
        Button { UIPasteboard.general.string = inv.id } label: { Label("Copy the number", systemImage: "doc.on.doc") }
        if session.isOwner {
            Divider()
            Button(role: .destructive) { act(.delete, inv) } label: { Label("Delete invoice…", systemImage: "trash") }
        }
    }

    // MARK: The summary column

    /// Who and when, what is due, the totals as the bill reads them, and the quiet facts.
    private func macSummary(_ inv: Invoice) -> some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .center, spacing: 14) {
                        Monogram(name: inv.customerName, size: Monogram.Size.hero)
                        VStack(alignment: .leading, spacing: 4) {
                            customerTitle(inv)
                            let when = ShopDate.say(inv.createdAt, withTime: true)
                            if !when.isEmpty {
                                Text(when).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                            }
                            Text(piecesLine(inv)).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    if session.isOwner && unnamed(inv) && inv.status != .refunded {
                        Button { settingCustomer = true } label: {
                            Label("Name the customer", systemImage: "person.crop.circle.badge.plus")
                        }
                        .buttonStyle(.bordered)
                    }
                    PerforationDivider()
                    figures(inv)
                    if let sent = inv.sentOnWhatsApp {
                        Label("PDF sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))", systemImage: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            Section {
                totalRows(inv)
            } header: {
                LedgerHeading(title: "Bill")
            }
            detailsSection(inv)
            shopSection(inv)
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }

    // MARK: The tables column

    private func macTables(_ inv: Invoice) -> some View {
        let line = balanceLine(inv.balanceDue)
        let credit = line.state == .credit && inv.status != .refunded && !inv.paymentHistory.isEmpty
        let who = InvoiceFacts.customerName(inv, walkIn: "the customer")
        return MacInvoiceTables(
            invoice: inv,
            isOwner: session.isOwner,
            creditNote: credit ? "\(line.label), on \(who)'s hisaab" : nil,
            giveBack: credit && session.isOwner && InvoiceCredit.held(inv) >= 1
                ? (label: "Give back \(Money.pkr(InvoiceCredit.held(inv)))", run: { act(.giveBack, inv) })
                : nil,
            onDeletePayment: { index, payment in askDelete(inv, index: index, payment: payment) })
    }
}

/// The pieces and the payments of an invoice as two tables, one above the other.
private struct MacInvoiceTables: View {
    let invoice: Invoice
    let isOwner: Bool
    let creditNote: String?
    let giveBack: (label: String, run: () -> Void)?
    let onDeletePayment: (Int, Payment) -> Void

    @Environment(\.openPlaceWindow) private var openPlace
    @State private var pieceSelection = Set<Int>()
    @State private var paymentSelection = Set<Int>()

    private struct PieceRow: Identifiable {
        let id: Int
        let item: InvoiceItem
        var row: InvoicePieceRow { InvoicePieceRow(item: item) }
    }

    private struct PaymentRow: Identifiable {
        let id: Int
        let payment: Payment
        var row: InvoicePaymentRow { InvoicePaymentRow(payment: payment) }
    }

    private var pieces: [PieceRow] { invoice.items.enumerated().map { PieceRow(id: $0.offset, item: $0.element) } }
    private var payments: [PaymentRow] { invoice.paymentHistory.enumerated().map { PaymentRow(id: $0.offset, payment: $0.element) } }

    var body: some View {
        VSplitView {
            piecesBlock.frame(minHeight: 220)
            paymentsBlock.frame(minHeight: 150, idealHeight: 210)
        }
    }

    // MARK: Pieces

    private var piecesBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            LedgerHeading(title: "Pieces", count: invoice.items.count)
                .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 6)
            Table(pieces, selection: $pieceSelection) {
                TableColumn("Piece") { r in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.row.macTitle).fontWeight(.medium)
                        if let sub = r.row.macSubtitle { Text(sub).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                .width(min: 160, ideal: 240)
                TableColumn("Metal") { r in Text(r.row.macMetal) }.width(min: 80, ideal: 110)
                TableColumn("Weight") { r in Text(r.row.macWeight).monospacedDigit() }.width(min: 60, ideal: 80)
                TableColumn("Size") { r in Text(r.item.size ?? "") }.width(min: 40, ideal: 60)
                TableColumn("Total") { r in
                    Text(Money.pkr(r.item.itemTotal)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 100, ideal: 120)
            }
            .contextMenu(forSelectionType: Int.self) { ids in
                if let i = ids.first, invoice.items.indices.contains(i) {
                    let item = invoice.items[i]
                    let sku = InvoicePieceRow(item: item).macStock
                    if let sku {
                        Button("Open Piece in New Window") { openPlace?(SaleLinks.piece(sku)) }
                        Button("Copy SKU") { UIPasteboard.general.string = sku }
                    }
                    Button("Copy Name") { UIPasteboard.general.string = item.name }
                }
            } primaryAction: { ids in
                if let i = ids.first, invoice.items.indices.contains(i),
                   let sku = InvoicePieceRow(item: invoice.items[i]).macStock {
                    openPlace?(SaleLinks.piece(sku))
                }
            }
            .overlay { if invoice.items.isEmpty { Text("No pieces on this invoice.").foregroundStyle(.secondary) } }
            pieceDetail
        }
    }

    /// The picked piece's own facts: what is set into it and, for owners, the price broken into its parts.
    @ViewBuilder
    private var pieceDetail: some View {
        if pieceSelection.count == 1, let i = pieceSelection.first, invoice.items.indices.contains(i) {
            let row = InvoicePieceRow(item: invoice.items[i], showBreakdown: isOwner)
            let lines = row.macSettings + (isOwner ? [row.macCosts.joined(separator: " · ")] : [])
            let facts = row.macFacts.joined(separator: " · ")
            if !lines.filter({ !$0.isEmpty }).isEmpty || !facts.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    if !facts.isEmpty { Text(facts).font(.callout) }
                    ForEach(lines.filter { !$0.isEmpty }, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.vertical, 8)
                .background(.bar)
            }
        }
    }

    // MARK: Payments

    private var paymentsBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            LedgerHeading(title: "Payments", count: invoice.paymentHistory.count > 1 ? invoice.paymentHistory.count : nil)
                .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 6)
            Table(payments, selection: $paymentSelection) {
                TableColumn("When") { r in Text(ShopDate.say(r.payment.date, withTime: true)).monospacedDigit() }
                    .width(min: 120, ideal: 160)
                TableColumn("Method") { r in Text(r.row.macTitle) }.width(min: 90, ideal: 120)
                TableColumn("Reference and note") { r in Text(r.row.macNote).foregroundStyle(.secondary) }
                TableColumn("Amount") { r in
                    Text(r.payment.amount < 0 ? Money.minus(r.payment.amount) : Money.pkr(r.payment.amount))
                        .monospacedDigit()
                        .foregroundStyle(r.payment.amount < 0 ? Color.secondary : Color.primary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 100, ideal: 120)
            }
            .contextMenu(forSelectionType: Int.self) { ids in
                if let i = ids.first, invoice.paymentHistory.indices.contains(i) {
                    let p = invoice.paymentHistory[i]
                    Button("Copy Amount") { UIPasteboard.general.string = String(Int(p.amount.rounded())) }
                    if isOwner {
                        Divider()
                        Button("Delete Payment…", role: .destructive) { onDeletePayment(i, p) }
                    }
                }
            }
            .onDeleteCommand {
                // ⌫ asks the delete code too (decision "Delete code"): the owner's, on the payment picked.
                if isOwner, paymentSelection.count == 1, let i = paymentSelection.first, invoice.paymentHistory.indices.contains(i) {
                    onDeletePayment(i, invoice.paymentHistory[i])
                }
            }
            .overlay { if invoice.paymentHistory.isEmpty { Text("No payments yet").foregroundStyle(.secondary) } }
            if let creditNote {
                HStack(spacing: 12) {
                    Label(creditNote, systemImage: "arrow.uturn.left.circle.fill")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Tone.credit.color)
                    Spacer()
                    if let giveBack {
                        Button(giveBack.label, action: giveBack.run).controlSize(.small)
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 8)
                .background(.bar)
            }
        }
    }
}

extension InvoicePieceRow {
    var macTitle: String { title }
    /// The category beside the name when the name does not already say it.
    var macSubtitle: String? {
        guard let category, title != category, !title.localizedCaseInsensitiveContains(category) else { return nil }
        return category
    }
    var macMetal: String { describeMetal(item.metalType, item.karat) }
    var macWeight: String { item.metalWeightG > 0 ? Self.say(item.metalWeightG) + " g" : "" }
    var macStock: String? { stockSku(item.sku) }
    var macFacts: [String] { facts }
    var macSettings: [String] { settings }
    var macCosts: [String] { costs }
}

extension InvoicePaymentRow {
    var macTitle: String { title }
    /// The reference and any note, without the date (its own column).
    var macNote: String {
        let when = ShopDate.say(payment.date, withTime: true)
        var d = detail
        if !when.isEmpty, d.hasPrefix(when) {
            d = String(d.dropFirst(when.count)).trimmingCharacters(in: CharacterSet(charactersIn: " ·"))
        }
        return d == "—" ? "" : d
    }
}
#endif
