import SwiftUI
import ERPCore

/// What the Invoices list and the invoice page say the same way: who a sale was for, where an
/// invoice lives, how its balance is coloured, the customer's link, and how a payment is taken.
enum InvoiceFacts {
    /// The name on the bill, or "Walk-in" for a sale to nobody in particular (lib/walk-in.ts:
    /// no name, or the placeholder, however it is spelled; "Walk-in Customer - 0300…" is a person).
    static func customerName(_ inv: Invoice, walkIn: String = "Walk-in") -> String {
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || isWalkInName(name) ? walkIn : name
    }

    /// One part of a path: an id with a "/" or "?" in it must not split the address.
    static func encode(_ part: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        return part.addingPercentEncoding(withAllowedCharacters: allowed) ?? part
    }

    /// "/invoices/INV-000123": the invoice page. `web` asks for the ERP's own page (a native
    /// screen's "Open in the ERP": print, send, refund, delete).
    static func path(_ id: String, web: Bool = false) -> String {
        "/invoices/" + encode(id) + (web ? "?web=1" : "")
    }

    /// The sale form on an invoice (components/sale/sale-page.tsx), which has no native screen.
    static func editPath(_ id: String) -> String { "/invoices/" + encode(id) + "/edit" }

    /// Still owing after this many days reads red, not orange. A way to see the old debts at a
    /// glance (the Awaiting payment section is oldest first for the same reason), not a rule.
    static let staleDays = 30

    /// The colour of an invoice's balance: owed in orange, red once it is old, credit green.
    static func tone(_ inv: Invoice, now: Date = Date()) -> Color {
        if inv.status == .refunded { return Color.secondary }
        switch balanceLine(inv.balanceDue).state {
        case .due:
            guard let made = ERPDate.parse(inv.createdAt) else { return Color.orange }
            let age = now.timeIntervalSince(made)
            return age > Double(staleDays) * 86_400 ? Color.red : Color.orange
        case .credit:
            return Color.green
        case .paid:
            return Color.secondary
        }
    }

    /// Who may take a payment (/api/app/write recordPayment): owners and staff.
    static func mayTakePayments(role: String) -> Bool { role == "owner" || role == "staff" }

    /// Take a payment, as the invoice page and the list's "Mark paid" do. The server writes it
    /// (lib/writes/invoice-payment.ts) but does not check who may hold credit, so the ERP page's
    /// rule is kept here: money over the balance is a named customer's credit; from nobody in
    /// particular it is change to hand back, so it is refused (invoice-credit.ts).
    @MainActor
    static func record(_ inv: Invoice, amount: Double, method: String, reference: String) async throws {
        let due = max(0, inv.balanceDue)
        if amount > due + 0.5 && !canHoldCredit(inv.customerId) {
            throw ERPAPI.Failure(status: 400, message: "More than the balance of \(Money.pkr(due)). Credit needs a customer: name who this invoice is for first.")
        }
        var fields: [String: Any] = ["invoiceId": inv.id, "amount": amount, "method": method]
        let ref = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        if method != "Cash" && !ref.isEmpty { fields["reference"] = ref }
        try await ERPAPI.shared.write("recordPayment", fields)
    }

    // MARK: The customer's link

    /// JavaScript's encodeURIComponent leaves these alone.
    private static let componentSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    private static func component(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: componentSafe) ?? s
    }

    /// The page a customer is sent (lib/share-token.ts `invoiceShareUrl`): `/view-invoice/<id>?t=<key>`.
    /// That page answers only to the invoice's own key, so an invoice from before keys existed has
    /// no link here: the ERP page makes its key as it sends (Send on WhatsApp).
    static func shareURL(_ inv: Invoice) -> URL? {
        guard let key = inv.shareToken, !key.isEmpty else { return nil }
        var origin = House.serverURL.absoluteString
        while origin.hasSuffix("/") { origin.removeLast() }
        return URL(string: "\(origin)/view-invoice/\(component(inv.id))?t=\(component(key))")
    }

    // TODO(logic): port invoiceTitle / invoiceWhatsAppCaption (lib/invoice-share.ts) and the viewer's estimateMessage.
    /// "Invoice - Fatima Hussain": the customer is never given the number as its name
    /// (decisions: Invoice PDF). A walk-in has no name to give.
    static func shareTitle(_ inv: Invoice) -> String {
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || isWalkInName(name) { return "Invoice" }
        return "Invoice - \(name)"
    }

    /// The words that go with the link: who it is for and what is owed. Taheri's carry no number;
    /// House of Mina's are the counter's own ("estimate", its ID, what is owed).
    static func shareMessage(_ inv: Invoice, shopName: String) -> String {
        let name = inv.customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        let who = name.isEmpty || isWalkInName(name) ? "Customer" : name
        let line = balanceLine(inv.balanceDue)
        if House.id == "mina" {
            var m = "Dear \(who),\n\nHere is your estimate from \(shopName).\n\n*Estimate ID:* \(inv.id)\n*Total Amount:* \(Money.pkr(inv.grandTotal))\n"
            if inv.amountPaid > 0 {
                m += "*Amount Paid:* \(Money.pkr(inv.amountPaid))\n*Balance Due:* \(Money.pkr(inv.balanceDue))\n\n"
            } else {
                m += "*Amount Due:* \(Money.pkr(inv.grandTotal))\n\n"
            }
            return m + "Thank you for your business."
        }
        var lines = ["Dear \(who),", "", "Your invoice from \(shopName) is at the link below.", "", "*Total:* \(Money.pkr(inv.grandTotal))"]
        if inv.amountPaid > 0 {
            lines.append("*Paid:* \(Money.pkr(inv.amountPaid))")
            lines.append(line.state == .credit ? "*Credit to you:* \(Money.pkr(line.amount))" : "*Balance due:* \(Money.pkr(inv.balanceDue))")
        }
        lines.append("")
        lines.append("Thank you for your business.")
        return lines.joined(separator: "\n")
    }
}

extension View {
    /// The payment sheet for an invoice (Kit's PaymentSheet), the balance one tap away. Closing it
    /// with a refusal showing keeps the sheet open with the ERP's own words.
    func invoicePaymentSheet(for invoice: Binding<Invoice?>) -> some View {
        sheet(item: invoice) { inv in
            PaymentSheet(title: "Take payment · \(inv.id)", owed: inv.balanceDue > 0.5 ? inv.balanceDue : nil) { amount, method, reference in
                try await InvoiceFacts.record(inv, amount: amount, method: method, reference: reference)
            }
        }
    }
}
