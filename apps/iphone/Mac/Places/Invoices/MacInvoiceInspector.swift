#if os(macOS)
import SwiftUI
import ERPCore

// The inspector of the Invoices place (docs/features/mac-design.md, "Invoices"): the picked invoice at the right of the
// list. A plain head (the customer, the number and day, the status and the amount due), the actions that are used after
// a sale, then its pieces and payments as compact rows and its details. Nothing here is edited; the actions start the
// same sheets as the Invoice menu (MacInvoiceMenu), so a payment taken here and one taken from the menu are one thing.

struct MacInvoiceInspector: View {
    /// The one picked, nil with nothing picked or several.
    let invoice: Invoice?
    /// How many are picked.
    let count: Int
    let cx: MacInvoiceContext

    @Environment(Book.self) private var book

    var body: some View {
        if let inv = invoice {
            MacInvoiceInspectorBody(invoice: inv, cx: cx, customer: customerId(inv))
        } else if count > 1 {
            MacInspectorEmpty(title: "\(count) Invoices", detail: "Pick one to see it here.")
        } else {
            MacInspectorEmpty(title: "No Invoice Selected")
        }
    }

    /// The customer's id when the sale has a real one: not a walk-in however it was recorded, and not just a typed name.
    private func customerId(_ inv: Invoice) -> String? {
        let key = saleCustomerKey(inv, currentName: { cid in book.customers.item(cid)?.name })
        if key == WALK_IN_ENTITY || key.hasPrefix("name:") { return nil }
        return key
    }
}

/// The head of an invoice on the house's card, as the iPhone's page has it: the monogram, who and when, what is due as the
/// big figure over the bar of what is paid, then the actions as a row of rounded buttons. The inspector and the invoice's
/// window both use it.
struct MacInvoiceHead: View {
    let invoice: Invoice
    let cx: MacInvoiceContext
    var customerTitleFont: Font = .system(.title3, design: .serif).weight(.semibold)
    /// Call and Message beside the rest: a window has the width, the inspector at its narrowest does not.
    var withContact = false

    @Environment(Book.self) private var book

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                Monogram(name: invoice.customerName, size: Monogram.Size.hero)
                VStack(alignment: .leading, spacing: 3) {
                    Text(InvoiceFacts.customerName(invoice, walkIn: "Walk-in"))
                        .font(customerTitleFont).lineLimit(2).textSelection(.enabled)
                    Text(MacInvoiceWords.subtitle(invoice, withTaker: false))
                        .font(.callout).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                }
                Spacer(minLength: 0)
            }
            Divider()
            lead
            if invoice.status != .refunded {
                PaidBar(paid: invoice.amountPaid, total: invoice.grandTotal)
            }
            actions
        }
        .ledgerCard()
    }

    /// Due while owing (amber, red once old), In credit, or Paid in full; a refunded invoice says Refunded instead.
    @ViewBuilder
    private var lead: some View {
        let line = balanceLine(invoice.balanceDue)
        if invoice.status == .refunded {
            Pill("Refunded", tone: .quiet, symbol: "arrow.uturn.backward")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                switch line.state {
                case .due:
                    Text("Due").font(.callout).foregroundStyle(.secondary)
                    HeroAmount(amount: line.amount, tone: InvoiceFacts.balanceTone(invoice).color)
                case .credit:
                    Text("In credit").font(.callout).foregroundStyle(.secondary)
                    HeroAmount(amount: line.amount, tone: Tone.credit.color)
                case .paid:
                    Text("Paid in full")
                        .font(.system(.title, design: .serif).weight(.semibold))
                        .lineLimit(1)
                }
                Text("Total \(Money.pkr(invoice.grandTotal)) \u{00B7} Paid \(Money.pkr(invoice.amountPaid))")
                    .font(.callout).foregroundStyle(.secondary).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
            }
        }
    }

    /// Take Payment, WhatsApp and PDF, then ring or write the customer: rounded buttons that wrap at the narrowest.
    private var actions: some View {
        let list = MacInvoiceMenu.buttons(invoice, cx)
        let phone = reachablePhone
        return VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                row(list)
                VStack(alignment: .leading, spacing: 8) {
                    row(Array(list.prefix(1)))
                    row(Array(list.dropFirst(1)))
                }
            }
            if withContact, let phone { ContactActions(phone: phone) }
        }
    }

    private func row(_ list: [MacAction]) -> some View {
        HStack(spacing: 8) {
            ForEach(list) { (a: MacAction) in
                QuickAction(title: a.title, symbol: a.symbol ?? "circle", prominent: a.isDefault, action: a.perform)
                    .disabled(!a.enabled)
                    .help(a.help)
            }
        }
    }

    /// The number the bill went to, else the customer's own; nil when there is none to dial.
    private var reachablePhone: String? {
        let own = invoice.customerContact ?? ""
        let theirs = invoice.customerId.flatMap { book.customers.item($0)?.phone } ?? ""
        let phone = own.isEmpty ? theirs : own
        return CustomerKit.dialable(phone).isEmpty ? nil : phone
    }
}

private struct MacInvoiceInspectorBody: View {
    let invoice: Invoice
    let cx: MacInvoiceContext
    let customer: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                MacInvoiceHead(invoice: invoice, cx: cx)
                piecesSection
                paymentsSection
                detailsSection
            }
            .padding(12)
        }
        .background(Theme.ground)
    }

    // MARK: Pieces

    private var piecesSection: some View {
        MacInspectorCard(title: "Pieces", count: invoice.items.count) {
            if invoice.items.isEmpty {
                Text("No pieces on this invoice.").font(.callout).foregroundStyle(.secondary)
            }
            ForEach(Array(invoice.items.enumerated()), id: \.offset) { pair in
                pieceRow(pair.element)
            }
            if invoice.discountAmount > 0 {
                LabeledContent("Discount", value: Money.minus(invoice.discountAmount))
            }
            LabeledContent("Total") {
                Text(Money.pkr(invoice.grandTotal)).monospacedDigit().fontWeight(.semibold)
            }
        }
    }

    private func pieceRow(_ item: InvoiceItem) -> some View {
        let facts = MacInvoiceWords.pieceFacts(item).joined(separator: " · ")
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(MacInvoiceWords.pieceTitle(item)).lineLimit(2)
                if !facts.isEmpty {
                    Text(facts).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            RowAmount(amount: item.itemTotal)
        }
    }

    // MARK: Payments

    private var paymentsSection: some View {
        let held = InvoiceCredit.held(invoice)
        return MacInspectorCard(title: "Payments", count: invoice.paymentHistory.count > 1 ? invoice.paymentHistory.count : nil) {
            if invoice.paymentHistory.isEmpty {
                Text("No payments yet").foregroundStyle(.secondary)
            }
            ForEach(Array(invoice.paymentHistory.enumerated()), id: \.offset) { pair in
                paymentRow(pair.element)
            }
            if balanceLine(invoice.balanceDue).state == .credit && invoice.status != .refunded && !invoice.paymentHistory.isEmpty {
                creditRow(held: held)
            }
        }
    }

    private func paymentRow(_ p: Payment) -> some View {
        let note = MacInvoiceWords.paymentNote(p)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(MacInvoiceWords.paymentTitle(p))
                Text([ShopDate.say(p.date, withTime: true), note].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 8)
            Text(p.amount < 0 ? Money.minus(p.amount) : Money.pkr(p.amount))
                .monospacedDigit()
                .foregroundStyle(p.amount < 0 ? Color.secondary : Color.primary)
        }
    }

    /// Paid past the total: the customer's credit, on their hisaab; an owner hands it back from here.
    @ViewBuilder
    private func creditRow(held: Double) -> some View {
        let line = balanceLine(invoice.balanceDue)
        let who = InvoiceFacts.customerName(invoice, walkIn: "the customer")
        Label("\(line.label), on \(who)'s hisaab", systemImage: "arrow.uturn.left.circle.fill")
            .font(.callout)
            .foregroundStyle(Tone.credit.color)
        if cx.isOwner && held >= 1 {
            Button("Give Back \(Money.pkr(held))…") {
                cx.desk.acting = MacInvoiceAct(act: .giveBack, invoice: invoice)
            }
        }
    }

    // MARK: Details

    private var detailsSection: some View {
        let order = invoice.sourceOrderId ?? ""
        let ship = describeDelivery(invoice.delivery)
        let by = invoice.takenBy ?? ""
        let source = MacInvoiceWords.source(invoice)
        return MacInspectorCard(title: "Details") {
            if let customer {
                LabeledContent("Customer") {
                    MacInvoiceLink(title: InvoiceFacts.customerName(invoice, walkIn: "Walk-in"),
                                   route: Route(path: "/customers/" + InvoiceFacts.encode(customer)))
                }
            }
            if !order.isEmpty {
                LabeledContent("From Order") {
                    MacInvoiceLink(title: order, route: Route(path: "/orders/" + InvoiceFacts.encode(order)))
                }
            }
            if !ship.isEmpty {
                LabeledContent("Deliver To") {
                    Text(ship.joined(separator: "\n")).multilineTextAlignment(.trailing)
                }
            }
            if !by.isEmpty {
                LabeledContent("Taken By", value: by)
            }
            if let source {
                LabeledContent("Source", value: source)
            }
            if let sent = invoice.sentOnWhatsApp {
                LabeledContent("PDF Sent") {
                    Text("\(sent.to) · \(ShopDate.say(sent.at, withTime: true))").multilineTextAlignment(.trailing)
                }
            }
        }
    }
}

/// A section of the inspector as the iPhone's page sets it: the serif heading and a count over rows on the house's card.
struct MacInspectorCard<Content: View>: View {
    let title: String
    var count: Int?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LedgerHeading(title: title, count: count)
            content()
        }
        .ledgerCard()
    }
}
#endif
