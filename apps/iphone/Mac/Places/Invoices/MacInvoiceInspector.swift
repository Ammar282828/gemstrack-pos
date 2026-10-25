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

private struct MacInvoiceInspectorBody: View {
    let invoice: Invoice
    let cx: MacInvoiceContext
    let customer: String?

    var body: some View {
        let status = MacInvoiceWords.status(invoice)
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                MacInspectorHeader(title: InvoiceFacts.customerName(invoice, walkIn: "Walk-in"),
                                   subtitle: MacInvoiceWords.subtitle(invoice, withTaker: false),
                                   status: MacStatus(status.text, tone: status.tone),
                                   headline: MacInvoiceWords.headline(invoice))
                buttons
            }
            .padding(16)
            Divider()
            Form {
                piecesSection
                paymentsSection
                detailsSection
            }
            .formStyle(.grouped)
        }
    }

    /// Take Payment, WhatsApp and PDF in a row, or in two when the inspector is at its narrowest.
    private var buttons: some View {
        let actions = MacInvoiceMenu.buttons(invoice, cx)
        return ViewThatFits(in: .horizontal) {
            MacActionButtons(actions: actions)
            VStack(alignment: .leading, spacing: 6) {
                MacActionButtons(actions: Array(actions.prefix(1)))
                MacActionButtons(actions: Array(actions.dropFirst(1)))
            }
        }
    }

    // MARK: Pieces

    private var piecesSection: some View {
        Section("Pieces") {
            if invoice.items.isEmpty {
                Text("No pieces on this invoice.").foregroundStyle(.secondary)
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
            Text(Money.pkr(item.itemTotal)).monospacedDigit()
        }
    }

    // MARK: Payments

    private var paymentsSection: some View {
        let held = InvoiceCredit.held(invoice)
        return Section("Payments") {
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
        return Section("Details") {
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
#endif
