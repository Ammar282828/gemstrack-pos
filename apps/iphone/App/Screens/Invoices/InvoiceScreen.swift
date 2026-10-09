import SwiftUI
import ERPCore

/// An invoice, for the shop (src/components/invoice/invoice-viewer.tsx): its pieces and figures,
/// payments, taking a payment, the customer's page to share, and who it was for (named or changed
/// here, set-customer-dialog.tsx). The PDF is the ERP page's own (lib/invoice-pdf.ts draws it in the
/// browser, and the server has no copy): Print and Taheri's WhatsApp send open that page doing it
/// (`?do=print`, `?do=share`), and House of Mina's link goes from here. Edit, the discount, refund and
/// delete open the ERP's own page (they need its delete code).
struct InvoiceScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var paying: Invoice?
    @State private var web: Route?
    @State private var settingCustomer = false
    /// Taheri's send from the shop's line, asked first: it really sends.
    @State private var confirmingSend = false
    /// House of Mina's: the number and the words, then WhatsApp on this phone.
    @State private var sendingLink = false
    @State private var note: InvoiceNote?

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
        List { Group {
            headerSection(inv)
            shopSection(inv)
            deliverySection(inv)
            piecesSection(inv)
            ratesSection(inv)
            totalsSection(inv)
            paymentsSection(inv)
            sentSection(inv)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
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
        .invoicePaymentSheet(for: $paying)
        .sheet(isPresented: $settingCustomer) {
            InvoiceCustomerSheet(invoice: inv) { (saved: InvoiceNote) in
                withAnimation { note = saved }
            }
        }
        .sheet(isPresented: $sendingLink) {
            InvoiceWhatsAppSheet(invoice: inv, phone: whatsAppPhone(inv))
        }
        .confirmationDialog(sendTitle(inv), isPresented: $confirmingSend, titleVisibility: .visible) {
            Button(inv.sentOnWhatsApp == nil ? "Send the PDF" : "Send it again") { openWeb(inv, doing: "share") }
            // The ERP page's box takes another number; its Send goes to whatever is typed there.
            Button("Another number…") { openWeb(inv) }
        } message: {
            Text(sendWords(inv))
        }
        .overlay(alignment: .top) {
            if let note {
                InvoiceNoteBanner(note: note)
                    .padding(.horizontal)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        // Said for a few seconds, like the web's toast, then gone.
        .task(id: note) {
            guard note != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { withAnimation { note = nil } }
        }
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

    // MARK: Header

    @ViewBuilder
    private func headerSection(_ inv: Invoice) -> some View {
        Section {
            // The number is in the title already: the head of the page is who and how much, as Wallet shows a payment.
            VStack(spacing: 8) {
                Initials(name: InvoiceFacts.customerName(inv, walkIn: "Walk-in"), size: 52)
                Text(Money.pkr(inv.grandTotal))
                    .font(.system(.largeTitle, design: .rounded).weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                HStack(spacing: 6) {
                    balanceBadge(inv)
                    if inv.status == .refunded { StatusBadge("Refunded", color: .purple) }
                    if (inv.source ?? "").hasPrefix("shopify") { StatusBadge("Shopify", color: .green) }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            customerRow(inv)
            let when = ShopDate.say(inv.createdAt, withTime: true)
            if !when.isEmpty { LabeledContent("Date", value: when) }
            if let by = inv.takenBy, !by.isEmpty { LabeledContent("Taken by", value: by) }
            if let order = inv.sourceOrderId, !order.isEmpty {
                NavigationLink(value: Route(path: "/orders/" + InvoiceFacts.encode(order))) {
                    LabeledContent("From order", value: order)
                }
            }
        }
    }

    @ViewBuilder
    private func balanceBadge(_ inv: Invoice) -> some View {
        let line = balanceLine(inv.balanceDue)
        switch line.state {
        case .due:
            StatusBadge("\(Money.pkr(line.amount)) due", color: InvoiceFacts.tone(inv))
        case .credit:
            StatusBadge("\(Money.pkr(line.amount)) in credit", color: .green)
        case .paid:
            StatusBadge("Paid in full", color: .green)
        }
    }

    /// The customer, linked unless the sale was to nobody in particular (lib/walk-in.ts).
    @ViewBuilder
    private func customerRow(_ inv: Invoice) -> some View {
        let name = InvoiceFacts.customerName(inv, walkIn: "Walk-in Customer")
        if let customerId = linkableCustomer(inv) {
            NavigationLink(value: Route(path: "/customers/" + InvoiceFacts.encode(customerId))) {
                LabeledContent("Customer", value: name)
            }
        } else {
            LabeledContent("Customer", value: name)
        }
    }

    /// The customer's id when the sale has a real one: not a walk-in however it was recorded, and
    /// not just a typed name (saleCustomerKey says which).
    private func linkableCustomer(_ inv: Invoice) -> String? {
        let key = saleCustomerKey(inv, currentName: { cid in book.customers.item(cid)?.name })
        if key == WALK_IN_ENTITY || key.hasPrefix("name:") { return nil }
        return key
    }

    // MARK: For the shop

    /// The note nobody but the shop reads, and the shop's margin (owners and staff; blurred until tapped).
    @ViewBuilder
    private func shopSection(_ inv: Invoice) -> some View {
        let note = (inv.internalNote ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty || showsMargin {
            Section {
                if !note.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("For the shop (never printed)", systemImage: "lock.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.orange)
                        Text(note)
                    }
                }
                if showsMargin { InvoiceMarginRow(invoice: inv) }
            }
        }
    }

    @ViewBuilder
    private func deliverySection(_ inv: Invoice) -> some View {
        let lines = describeDelivery(inv.delivery)
        if !lines.isEmpty {
            Section("Deliver to") {
                Text(lines.joined(separator: "\n"))
            }
        }
    }

    // MARK: Pieces and rates

    @ViewBuilder
    private func piecesSection(_ inv: Invoice) -> some View {
        Section("Pieces") {
            ForEach(Array(inv.items.enumerated()), id: \.offset) { pair in
                InvoicePieceRow(item: pair.element)
            }
        }
    }

    /// The rates the sale was priced at, as the printed bill says them, unless it leaves them off
    /// (`hideRates`: the bill is priced at these rates and just does not say so).
    @ViewBuilder
    private func ratesSection(_ inv: Invoice) -> some View {
        let rates = appliedRates(inv)
        if !inv.hideRates && !rates.isEmpty {
            Section("Rates applied") {
                Text(rates.joined(separator: "  ·  ")).monospacedDigit()
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

    // MARK: Totals

    @ViewBuilder
    private func totalsSection(_ inv: Invoice) -> some View {
        let exchanges = invoiceExchanges(inv)
        let exchanged = exchangeTotal(exchanges)
        let adjustments = inv.adjustmentsAmount ?? 0
        let line = balanceLine(inv.balanceDue)
        Section {
            LabeledContent("Subtotal") { MoneyText(amount: inv.subtotal, exact: true) }
            if inv.discountAmount > 0 {
                LabeledContent("Discount") { Text("- " + Money.pkr(inv.discountAmount)).monospacedDigit() }
            }
            if exchanged > 0 {
                exchangeRow(exchanges, total: exchanged)
            }
            if adjustments != 0 {
                LabeledContent("Adjustments") { MoneyText(amount: adjustments, exact: true) }
            }
            LabeledContent("Grand total") { MoneyText(amount: inv.grandTotal, exact: true) }
                .font(.headline)
            if inv.amountPaid > 0 {
                LabeledContent("Paid") { MoneyText(amount: inv.amountPaid, exact: true) }
                    .foregroundStyle(.green)
            }
            balanceRow(inv, line: line)
        }
    }

    /// The trade-in taken off the total, a line each when there are several (lib/exchange.ts).
    private func exchangeRow(_ rows: [ExchangeEntry], total: Double) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Exchange")
                ForEach(Array(rows.enumerated()), id: \.offset) { pair in
                    Text(exchangeLine(pair.element, many: rows.count > 1))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text("- " + Money.pkr(total)).monospacedDigit()
        }
    }

    private func exchangeLine(_ e: ExchangeEntry, many: Bool) -> String {
        let said = describeExchangeEntry(e)
        return many ? "\(said) — \(Money.grouped(e.value))" : said
    }

    /// "Balance due", "Credit to customer" or "Paid in full" (invoice-credit.ts), never a negative balance.
    @ViewBuilder
    private func balanceRow(_ inv: Invoice, line: BalanceLine) -> some View {
        switch line.state {
        case .paid:
            LabeledContent(line.label) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            }
        case .due, .credit:
            LabeledContent(line.label) { MoneyText(amount: line.amount, exact: true) }
                .font(.headline)
                .foregroundStyle(InvoiceFacts.tone(inv))
        }
    }

    // MARK: Payments

    @ViewBuilder
    private func paymentsSection(_ inv: Invoice) -> some View {
        if !inv.paymentHistory.isEmpty {
            Section("Payments") {
                ForEach(Array(inv.paymentHistory.enumerated()), id: \.offset) { pair in
                    InvoicePaymentRow(payment: pair.element)
                }
            }
        }
    }

    /// Whoever opens it next sees the PDF went, so it is not sent twice.
    @ViewBuilder
    private func sentSection(_ inv: Invoice) -> some View {
        if let sent = inv.sentOnWhatsApp {
            Section {
                Label("PDF sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))", systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Taking money

    private func owing(_ inv: Invoice) -> Bool { isOwing(inv) }

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

    // MARK: Send on WhatsApp

    /// The number the ERP page's box starts with: the invoice's, else its customer's.
    private func whatsAppPhone(_ inv: Invoice) -> String {
        InvoiceFacts.whatsAppPhone(inv, customer: inv.customerId.flatMap { book.customers.item($0) })
    }

    /// The ERP page's Send via WhatsApp, by house (STORE_INVOICE_WHATSAPP_PDF). Taheri sends the PDF itself from
    /// the shop's line: the page draws it (Print's PDF), the ERP sends it and notes the send on the invoice, so it
    /// is asked first and then done there, as the voice assistant does it. With no number on file the page opens
    /// for one to be typed. House of Mina writes the message and the customer's link into WhatsApp here, unless the
    /// invoice predates its link's key, which the page makes as it sends.
    private func sendOnWhatsApp(_ inv: Invoice) {
        if session.shop.invoiceWhatsappPdf {
            if CustomerKit.whatsAppNumber(whatsAppPhone(inv)).isEmpty { openWeb(inv) } else { confirmingSend = true }
        } else if InvoiceFacts.shareURL(inv) == nil {
            openWeb(inv, doing: "share")
        } else {
            sendingLink = true
        }
    }

    private func sendTitle(_ inv: Invoice) -> String {
        let to = whatsAppPhone(inv)
        return inv.sentOnWhatsApp == nil ? "Send the PDF to \(to)?" : "Send the PDF to \(to) again?"
    }

    /// What happens, and that it went before (the web shows the send under its button so nobody sends twice).
    private func sendWords(_ inv: Invoice) -> String {
        var s = "From the shop's own WhatsApp, with what is owed written under it. The ERP's page draws the PDF and sends it."
        if let sent = inv.sentOnWhatsApp {
            s += " Already sent to \(sent.to) · \(ShopDate.say(sent.at, withTime: true))."
        }
        return s
    }

    @ViewBuilder
    private func menuItems(_ inv: Invoice) -> some View {
        if canPay && (owing(inv) || canHoldCredit(inv.customerId)) {
            Button { paying = inv } label: {
                Label(owing(inv) ? "Take payment" : "Take payment as credit", systemImage: "banknote")
            }
            Divider()
        }
        // The PDF Print saves, drawn by the ERP's page and handed to the share sheet (Print, Files, AirDrop).
        Button { openWeb(inv, doing: "print") } label: { Label("Print / PDF", systemImage: "printer") }
        Button { sendOnWhatsApp(inv) } label: {
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
            Button { openWeb(inv) } label: { Label("Change the discount", systemImage: "percent") }
        }
        if !inv.paymentHistory.isEmpty {
            Button(role: .destructive) { openWeb(inv) } label: { Label("Delete a payment", systemImage: "banknote") }
        }
        Divider()
        if inv.status != .refunded {
            Button(role: .destructive) { openWeb(inv) } label: { Label("Refund", systemImage: "arrow.uturn.backward") }
        }
        Button(role: .destructive) { openWeb(inv) } label: { Label("Delete", systemImage: "trash") }
    }
}

// MARK: Rows

/// One piece: what it is, in what metal and weight, and its price; the breakdown the printed bill carries.
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    if let category {
                        Text(category)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                    }
                    Text(item.name).font(.headline)
                }
                Spacer(minLength: 8)
                MoneyText(amount: item.itemTotal, exact: true)
                    .font(.headline)
            }
            if !specs.isEmpty {
                Text(specs.joined(separator: " · "))
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
        .padding(.vertical, 2)
    }

    /// The category in words ("Ring" for cat001), or what the piece carries when it is not one of the
    /// ERP's own (invoice-viewer.tsx: `categorySingular(id) || id`).
    private var category: String? {
        guard let c = item.itemCategory?.trimmingCharacters(in: .whitespacesAndNewlines), !c.isEmpty else { return nil }
        return OrdersLogic.categorySingular(c)
    }

    /// Metal and karat, weight, size, finish, stone weight, and the stock number when it is one.
    private var specs: [String] {
        var out: [String] = [describeMetal(item.metalType, item.karat)]
        if item.metalWeightG > 0 { out.append(Self.say(item.metalWeightG) + " g") }
        if let size = item.size, !size.isEmpty { out.append("Size " + size) }
        if let finish = describePlating(item) { out.append(finish) }
        if item.stoneWeightG > 0 { out.append("Stone " + Self.say(item.stoneWeightG) + " g") }
        if let sku = stockSku(item.sku) { out.append(sku) }
        return out.filter { !$0.isEmpty }
    }

    /// What is set into it (diamonds, stones), less the lines the specs already say.
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

/// One payment: when, how it came, any reference or note, and the amount.
private struct InvoicePaymentRow: View {
    let payment: Payment

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ShopDate.say(payment.date, withTime: true))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            MoneyText(amount: payment.amount, exact: true)
                .fontWeight(.medium)
        }
    }

    /// The method (older records predate payment types and have none), the reference, a note that says more.
    private var detail: String {
        var parts: [String] = [payment.method?.rawValue ?? "—"]
        if let ref = payment.reference, !ref.isEmpty { parts.append(ref) }
        if let note = payment.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty, !note.hasPrefix("Payment received") {
            parts.append(note)
        }
        return parts.joined(separator: " · ")
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
                Label("We earn", systemImage: "lock.fill")
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                figure
            }
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
        if m.assumed { return Color.secondary }
        return m.percent < 0 ? Color.red : Color.green
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
