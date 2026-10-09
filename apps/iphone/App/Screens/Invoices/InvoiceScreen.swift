import SwiftUI
import ERPCore

/// An invoice, for the shop (src/components/invoice/invoice-viewer.tsx): its pieces and figures,
/// payments, taking a payment, the customer's page to share, and who it was for (named or changed
/// here, set-customer-dialog.tsx). The PDF is the one Print saves (lib/invoice-pdf.ts), drawn on the ERP's
/// server and shown here (PDFDocumentScreen), to print or share; Taheri's WhatsApp send has the server draw
/// and send it from the shop's line, and House of Mina's link goes from here. Edit is New sale's own form;
/// the discount, deleting a payment, a refund and deleting the invoice are native sheets (InvoiceAction*,
/// owners, the last three behind the delete code).
///
/// Laid out as the ledger (Ledger.swift, 2026-10-09): who and how much at the head, with what has been paid
/// and what is still due beside the total; the things done most after a sale (take the money, send the bill,
/// print it, ring the customer) one tap under it; then the pieces as the bill reads them, the payments, and the
/// shop's own lines (rates, margin, note, delivery) quieter at the foot.
struct InvoiceScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    @State private var paying: Invoice?
    @State private var web: Route?
    @State private var settingCustomer = false
    /// Send on WhatsApp, by house (InvoiceWhatsAppSend): set to start it.
    @State private var sending: Invoice?
    @State private var pdf: InvoicePDFTarget?
    @State private var note: InvoiceNote?
    @State private var acting: InvoiceAct?

    private var canPay: Bool { InvoiceFacts.mayTakePayments(role: session.role) }

    /// The margin is the shop's own (lib/margin.ts): owners and staff see it, blurred until tapped, and
    /// never a customer (docs/decisions.md "Margin"). Mina's silver is not costed that way: its web page
    /// shows none (NEXT_PUBLIC_STORE_COST_RATTI_LESS "none").
    private var showsMargin: Bool { House.margin.rattiLess != nil }

    var body: some View {
        let invoice = book.invoices.items.first { $0.id == id }
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
        .task {
            book.invoices.need()
            book.customers.need()
        }
    }

    /// An invoice the books do not hold: refunded in full, which removes it (the ERP's words).
    private var notFound: some View {
        ContentUnavailableView {
            Label("Invoice \(id) not found", systemImage: "doc.questionmark")
        } description: {
            Text("It may have been refunded in full, which removes it.")
        } actions: {
            NavigationLink(value: Route(path: "/invoices")) { Text("All invoices") }
            NavigationLink(value: Route(path: "/invoices/new")) { Text("New sale") }
        }
    }

    // MARK: The page

    private func detail(_ inv: Invoice) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                heroCard(inv)
                quickActions(inv)
                piecesCard(inv)
                paymentsCard(inv)
                ratesCard(inv)
                shopCard(inv)
                deliveryCard(inv)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .safeAreaBar(edge: .bottom, spacing: 0) { paymentBar(inv) }
        .toolbar {
            ToolbarItem(placement: .principal) { titleView(inv) }
            ToolbarItemGroup(placement: .primaryAction) { toolbarButtons(inv) }
        }
        .navigationDestination(item: $web) { r in
            ScreenRegistry.view(for: r.path)
                .navigationTitle(inv.id)
                .navigationBarTitleDisplayMode(.inline)
        }
        .navigationDestination(item: $pdf) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .invoicePaymentSheet(for: $paying)
        .sheet(isPresented: $settingCustomer) {
            InvoiceCustomerSheet(invoice: inv) { (saved: InvoiceNote) in
                withAnimation { note = saved }
            }
        }
        .sheet(item: $acting) { a in
            switch a {
            case .discount: InvoiceActionDiscountSheet(invoice: inv, onDone: acted)
            case .payment: InvoiceActionPaymentSheet(invoice: inv, onDone: acted)
            case .refund: InvoiceActionRefundSheet(invoice: inv, onDone: acted)
            case .delete: InvoiceActionDeleteSheet(invoice: inv, onDone: acted)
            }
        }
        .invoiceWhatsAppSend($sending, web: $web) { sent in withAnimation { note = sent } }
        .invoiceNoteBanner($note)
    }

    private func titleView(_ inv: Invoice) -> some View {
        VStack(spacing: 0) {
            Text(inv.id).font(.headline).monospacedDigit()
            Text(InvoiceFacts.customerName(inv, walkIn: "Walk-in Customer"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    // MARK: Who and how much

    /// Who it was for and when, the total in the serif, and Total · Paid · Due under it (credit as In credit).
    private func heroCard(_ inv: Invoice) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 14) {
                Monogram(name: inv.customerName, size: 56)
                VStack(alignment: .leading, spacing: 4) {
                    customerTitle(inv)
                    Text(heroCaption(inv))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            // A sale to nobody in particular, named once the bill is out (decision "Name a sale"): an owner's, as on the web.
            if session.isOwner && unnamed(inv) && inv.status != .refunded {
                Button { settingCustomer = true } label: {
                    Label("Name the customer", systemImage: "person.crop.circle.badge.plus")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Theme.accent.opacity(0.12), in: .capsule)
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 6) {
                if inv.status == .refunded {
                    Pill("Refunded", tone: .quiet, symbol: "arrow.uturn.backward")
                }
                HeroAmount(amount: inv.grandTotal)
            }
            MoneySplit(total: inv.grandTotal, paid: inv.amountPaid, due: inv.balanceDue)
            if let order = inv.sourceOrderId, !order.isEmpty {
                Divider()
                NavigationLink(value: Route(path: "/orders/" + InvoiceFacts.encode(order))) {
                    InvoiceLinkLine(title: "From order", value: order, symbol: "shippingbox")
                }
                .buttonStyle(.plain)
            }
        }
        .ledgerCard(padding: 18)
    }

    /// The customer's name in the serif, linked to their page unless the sale was to nobody in particular (lib/walk-in.ts).
    @ViewBuilder
    private func customerTitle(_ inv: Invoice) -> some View {
        let name = InvoiceFacts.customerName(inv, walkIn: "Walk-in")
        let title = Text(name)
            .font(.system(.title2, design: .serif).weight(.semibold))
            .foregroundStyle(Color.primary)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
        if let customerId = linkableCustomer(inv) {
            NavigationLink(value: Route(path: "/customers/" + InvoiceFacts.encode(customerId))) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    title
                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
        } else {
            title
        }
    }

    /// "INV-000123 · Today 3:45 pm · Taken by Demo", and "· Shopify" for an import.
    private func heroCaption(_ inv: Invoice) -> String {
        var parts = [inv.id]
        let when = ShopDate.say(inv.createdAt, withTime: true)
        if !when.isEmpty { parts.append(when) }
        if let by = inv.takenBy, !by.isEmpty { parts.append("Taken by " + by) }
        if (inv.source ?? "").hasPrefix("shopify") { parts.append("Shopify") }
        return parts.joined(separator: " · ")
    }

    /// The customer's id when the sale has a real one: not a walk-in however it was recorded, and
    /// not just a typed name (saleCustomerKey says which).
    private func linkableCustomer(_ inv: Invoice) -> String? {
        let key = saleCustomerKey(inv, currentName: { cid in book.customers.item(cid)?.name })
        if key == WALK_IN_ENTITY || key.hasPrefix("name:") { return nil }
        return key
    }

    // MARK: What is done most, one tap away

    /// Take the money, send the bill, print it, ring the customer: the things the counter does after a sale,
    /// where the ⋯ menu used to hide the send.
    private func quickActions(_ inv: Invoice) -> some View {
        let call = CustomerKit.callURL(whatsAppPhone(inv))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                if mayTakePayment(inv) {
                    QuickAction(title: "Payment", symbol: "banknote.fill", prominent: owing(inv)) { paying = inv }
                }
                QuickAction(title: "WhatsApp", symbol: "message.fill") { sending = inv }
                QuickAction(title: "PDF", symbol: "printer.fill") {
                    pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer)
                }
                if let call {
                    QuickAction(title: "Call", symbol: "phone.fill") { openURL(call) }
                }
            }
            // Whoever opens it next sees the PDF went, so it is not sent twice.
            if let sent = inv.sentOnWhatsApp {
                Label("PDF sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            }
        }
    }

    // MARK: The pieces, as the bill reads them

    private func piecesCard(_ inv: Invoice) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            LedgerHeading(title: inv.items.count == 1 ? "Piece" : "Pieces", count: inv.items.count > 1 ? inv.items.count : nil)
            if inv.items.isEmpty {
                Text("No pieces on this invoice.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(inv.items.enumerated()), id: \.offset) { pair in
                if pair.offset > 0 { Divider() }
                InvoicePieceRow(item: pair.element)
            }
            Divider()
            InvoiceTotals(invoice: inv)
        }
        .ledgerCard()
    }

    /// The rates the sale was priced at, as the printed bill says them, unless it leaves them off
    /// (`hideRates`: the bill is priced at these rates and just does not say so).
    @ViewBuilder
    private func ratesCard(_ inv: Invoice) -> some View {
        let rates = appliedRates(inv)
        if !inv.hideRates && !rates.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                InvoiceQuietHeading(title: "Rates applied", symbol: "chart.line.uptrend.xyaxis")
                Text(rates.joined(separator: "  ·  "))
                    .font(.subheadline)
                    .monospacedDigit()
            }
            .ledgerCard()
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

    @ViewBuilder
    private func paymentsCard(_ inv: Invoice) -> some View {
        if !inv.paymentHistory.isEmpty {
            let line = balanceLine(inv.balanceDue)
            VStack(alignment: .leading, spacing: 12) {
                LedgerHeading(title: "Payments", count: inv.paymentHistory.count > 1 ? inv.paymentHistory.count : nil,
                              trailing: Money.pkr(inv.amountPaid))
                ForEach(Array(inv.paymentHistory.enumerated()), id: \.offset) { pair in
                    if pair.offset > 0 { Divider() }
                    InvoicePaymentRow(payment: pair.element)
                }
                // Paid past the total: the customer's credit, on their hisaab (decision "Invoice credit").
                if line.state == .credit && inv.status != .refunded {
                    Divider()
                    Label("\(line.label) · \(Money.pkr(line.amount)), on \(InvoiceFacts.customerName(inv, walkIn: "the customer"))'s hisaab",
                          systemImage: "arrow.uturn.left.circle.fill")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Tone.credit.color)
                }
            }
            .ledgerCard()
        }
    }

    // MARK: For the shop

    /// The shop's margin (owners and staff; blurred until tapped) and the note nobody but the shop reads.
    @ViewBuilder
    private func shopCard(_ inv: Invoice) -> some View {
        let note = (inv.internalNote ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty || showsMargin {
            VStack(alignment: .leading, spacing: 12) {
                InvoiceQuietHeading(title: "For the shop (never printed)", symbol: "lock.fill")
                if showsMargin { InvoiceMarginRow(invoice: inv) }
                if showsMargin && !note.isEmpty { Divider() }
                if !note.isEmpty {
                    Text(note).font(.subheadline)
                }
            }
            .ledgerCard()
        }
    }

    @ViewBuilder
    private func deliveryCard(_ inv: Invoice) -> some View {
        let lines = describeDelivery(inv.delivery)
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                InvoiceQuietHeading(title: "Deliver to", symbol: "shippingbox")
                Text(lines.joined(separator: "\n")).font(.subheadline)
            }
            .ledgerCard()
        }
    }

    // MARK: Taking money

    private func owing(_ inv: Invoice) -> Bool { isOwing(inv) }

    /// Owed, or a named customer's money over the total, taken as credit (invoice-credit.ts).
    private func mayTakePayment(_ inv: Invoice) -> Bool {
        canPay && (owing(inv) || canHoldCredit(inv.customerId))
    }

    /// Taking a payment is THE action of an invoice that is owed.
    @ViewBuilder
    private func paymentBar(_ inv: Invoice) -> some View {
        if canPay && owing(inv) {
            Button { paying = inv } label: {
                Label("Take payment · \(Money.pkr(inv.balanceDue))", systemImage: "banknote")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }

    // MARK: The bar

    /// The customer's page to share, and the menu of what the ERP's own page does.
    @ViewBuilder
    private func toolbarButtons(_ inv: Invoice) -> some View {
        if let url = InvoiceFacts.shareURL(inv) {
            ShareLink(item: url,
                      subject: Text(InvoiceFacts.shareTitle(inv, byCustomer: session.shop.invoiceByCustomer)),
                      message: Text(InvoiceFacts.shareMessage(inv, shopName: session.shop.name,
                                                              byCustomer: session.shop.invoiceByCustomer))) {
                Label("Share the customer's page", systemImage: "square.and.arrow.up")
            }
        }
        Menu {
            menuItems(inv)
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    /// A sale to nobody in particular: the ERP page offers "Name them" (decisions: Name a sale).
    private func unnamed(_ inv: Invoice) -> Bool {
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || isWalkInName(name)
    }

    /// The ERP's own page for this invoice; `doing` is what it does as it opens (InvoiceFacts.path).
    private func openWeb(_ inv: Invoice, doing: String? = nil) {
        web = Route(path: InvoiceFacts.path(inv.id, web: true, doing: doing))
    }

    /// The number the ERP page's box starts with: the invoice's, else its customer's.
    private func whatsAppPhone(_ inv: Invoice) -> String {
        InvoiceFacts.whatsAppPhone(inv, customer: inv.customerId.flatMap { book.customers.item($0) })
    }

    @ViewBuilder
    private func menuItems(_ inv: Invoice) -> some View {
        if mayTakePayment(inv) {
            Button { paying = inv } label: {
                Label(owing(inv) ? "Take payment" : "Take payment as credit", systemImage: "banknote")
            }
            Divider()
        }
        // The PDF Print saves, drawn on the ERP's server and shown here: Print, Files, AirDrop from its share sheet.
        Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer) } label: {
            Label("Print / PDF", systemImage: "printer")
        }
        // The split button's other half (print-button.tsx): one invoice per piece, for pieces bought for several people.
        if inv.items.count > 1 {
            Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer, perPiece: true) } label: {
                Label("Print per piece", systemImage: "doc.on.doc")
            }
        }
        Button { sending = inv } label: {
            Label(inv.sentOnWhatsApp == nil ? "Send on WhatsApp" : "Send again on WhatsApp", systemImage: "message")
        }
        Button { web = Route(path: InvoiceFacts.editPath(inv.id)) } label: { Label("Edit", systemImage: "pencil") }
        if inv.status != .refunded {
            // The store's own Firestore write on the web, which the shop floor cannot make: an owner's.
            if session.isOwner {
                Button { settingCustomer = true } label: {
                    Label(unnamed(inv) ? "Name the customer" : "Change the customer", systemImage: "person.crop.circle")
                }
            }
            Button { act(.discount, inv) } label: { Label("Change the discount", systemImage: "percent") }
        }
        if !inv.paymentHistory.isEmpty {
            Button(role: .destructive) { act(.payment, inv) } label: { Label("Delete a payment", systemImage: "banknote") }
        }
        Divider()
        if inv.status != .refunded {
            Button(role: .destructive) { act(.refund, inv) } label: { Label("Refund", systemImage: "arrow.uturn.backward") }
        }
        Button(role: .destructive) { act(.delete, inv) } label: { Label("Delete", systemImage: "trash") }
    }

    /// An owner's sheet; the shop floor keeps the ERP's page, which says it is an owner's (the server refuses
    /// staff either way).
    private func act(_ a: InvoiceAct, _ inv: Invoice) {
        if session.isOwner { acting = a } else { openWeb(inv) }
    }

    /// After a sheet: its note on the page, or back to the list when the invoice is gone.
    private func acted(_ o: InvoiceActionOutcome) {
        if o.removed { dismiss() } else { withAnimation { note = o.note } }
    }
}

// MARK: Lines of the cards

/// A quiet card's heading: a small symbol and its words, in the secondary colour.
private struct InvoiceQuietHeading: View {
    let title: String
    let symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A line that opens something: its word, the value, a chevron.
private struct InvoiceLinkLine: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        HStack(spacing: 10) {
            Label(title, systemImage: symbol)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .lineLimit(1)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

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

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(title)
                    .font(.headline)
                Spacer(minLength: 8)
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
            if !costs.isEmpty {
                Text(costs.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
        }
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

/// Under the pieces, as the printed bill: the subtotal, the discount, each exchange row on its own line (what was
/// taken in, lib/exchange.ts), any adjustment, and the total. Figures to the right, quiet but for the total.
private struct InvoiceTotals: View {
    let invoice: Invoice

    var body: some View {
        let exchanges = invoiceExchanges(invoice)
        let exchanged = exchangeTotal(exchanges)
        let adjustments = invoice.adjustmentsAmount ?? 0
        VStack(alignment: .trailing, spacing: 7) {
            line("Subtotal", Money.pkr(invoice.subtotal))
            if invoice.discountAmount > 0 {
                line("Discount", "− " + Money.pkr(invoice.discountAmount))
            }
            if exchanged > 0 {
                ForEach(Array(exchanges.enumerated()), id: \.offset) { pair in
                    line("Exchange", pair.element.value > 0 ? "− " + Money.pkr(pair.element.value) : "—",
                         detail: describeExchangeEntry(pair.element))
                }
            }
            if adjustments != 0 {
                line("Adjustments", Money.pkr(adjustments))
            }
            line("Total", Money.pkr(invoice.grandTotal), strong: true)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func line(_ label: String, _ value: String, detail: String? = nil, strong: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 1) {
                Text(label)
                    .font(strong ? Font.subheadline.weight(.semibold) : Font.subheadline)
                    .foregroundStyle(strong ? Color.primary : Color.secondary)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.trailing)
                }
            }
            Text(value)
                .font(strong ? Font.headline : Font.subheadline)
                .monospacedDigit()
                .foregroundStyle(strong ? Color.primary : Color.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(minWidth: 110, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One payment: how it came (its symbol), when, any reference or note, and the amount. A refund (a row below
/// zero, lib/writes/invoice-refund.ts) reads as one, quietly.
private struct InvoicePaymentRow: View {
    let payment: Payment

    private var refund: Bool { payment.amount < 0 }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tone.color)
                .frame(width: 34, height: 34)
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
            Text(refund ? "− " + Money.pkr(-payment.amount) : Money.pkr(payment.amount))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(refund ? Color.secondary : Color.primary)
                .lineLimit(1)
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
        if refund { return "Refund" }
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
            if refund, note.hasPrefix("Refund") {
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

    var body: some View {
        Button { shown.toggle() } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Label("We earn", systemImage: shown ? "eye.slash" : "eye")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                figure
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(shown ? "Hide our margin" : "Show our margin")
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
            Text("00.0% · PKR 00,000")
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
    case discount, payment, refund, delete
    var id: String { rawValue }
}
