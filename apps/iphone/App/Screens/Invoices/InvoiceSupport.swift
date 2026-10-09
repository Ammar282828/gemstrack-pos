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
    /// screen's "Open in the ERP": print, send, refund, delete). `doing` is what that page does as it
    /// opens, once (invoice-viewer.tsx `?do=`, the voice assistant's): "print" draws the PDF Print saves
    /// and hands it to the phone's share sheet; "share" sends it on WhatsApp.
    static func path(_ id: String, web: Bool = false, doing: String? = nil) -> String {
        var query: [String] = []
        if web { query.append("web=1") }
        if let doing { query.append("do=" + doing) }
        return "/invoices/" + encode(id) + (query.isEmpty ? "" : "?" + query.joined(separator: "&"))
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

    // MARK: What goes out with the link (lib/invoice-share.ts, the viewer's estimateMessage)

    /// Characters no phone or computer allows in a file's name, and runs of spaces (invoice-share.ts `clean`).
    private static func clean(_ s: String) -> String {
        let blocked = Set("\\/:*?\"<>|")
        let spaced = String(s.map { c in
            blocked.contains(c) || (c.asciiValue.map { $0 < 0x20 } ?? false) ? " " : c
        })
        return spaced.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static let karachiDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM yyyy"
        return f
    }()

    /// The subject of a share. Where an invoice is named after its customer (`byCustomer`,
    /// STORE_INVOICE_BY_CUSTOMER: Taheri): "Invoice - Fatima Hussain", never the number, and a walk-in
    /// (no name to give) carries its day instead: "Invoice - 5 Oct 2026". Elsewhere (House of Mina) the
    /// file is "Invoice-<number>", as invoice-pdf.ts names it.
    static func shareTitle(_ inv: Invoice, byCustomer: Bool) -> String {
        if !byCustomer { return "Invoice-" + inv.id }
        let name = String(clean(inv.customerName).prefix(80))
        if !name.isEmpty && !isWalkInName(name) { return "Invoice - \(name)" }
        guard let made = ERPDate.parse(inv.createdAt) else { return "Invoice" }
        return "Invoice - " + karachiDay.string(from: made)
    }

    /// toLocaleString(undefined, { minimumFractionDigits: 2 }): 12,345.00, as the estimate says it.
    private static func twoPlaces(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 3
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    /// The words that go with the link: who it is for and what is owed. Where invoices are named after
    /// the customer (`byCustomer`, Taheri) they carry no number (invoice-share.ts `invoiceWhatsAppCaption`,
    /// "is at the link below"); elsewhere (House of Mina) they are the counter's own (the viewer's
    /// `estimateMessage`: "estimate", its ID, what is owed, and the name as the bill has it). `shopName` is
    /// the shop's, never "… ERP".
    static func shareMessage(_ inv: Invoice, shopName: String, byCustomer: Bool) -> String {
        let line = balanceLine(inv.balanceDue)
        if !byCustomer {
            // `inv.customerName || 'Customer'`: a walk-in's bill reads "Dear Walk-in Customer", as the web's does.
            let named = inv.customerName.isEmpty ? "Customer" : inv.customerName
            var m = "Dear \(named),\n\nHere is your estimate from \(shopName).\n\n*Estimate ID:* \(inv.id)\n*Total Amount:* PKR \(twoPlaces(inv.grandTotal))\n"
            if inv.amountPaid > 0 {
                m += "*Amount Paid:* PKR \(twoPlaces(inv.amountPaid))\n*Balance Due:* PKR \(twoPlaces(inv.balanceDue))\n\n"
            } else {
                m += "*Amount Due:* PKR \(twoPlaces(inv.grandTotal))\n\n"
            }
            return m + "Thank you for your business."
        }
        let name = clean(inv.customerName)
        let who = name.isEmpty || isWalkInName(name) ? "Customer" : name
        var lines = ["Dear \(who),", "", "Your invoice from \(shopName) is at the link below.", "", "*Total:* \(Money.pkr(inv.grandTotal))"]
        if inv.amountPaid > 0 {
            lines.append("*Paid:* \(Money.pkr(inv.amountPaid))")
            lines.append(line.state == .credit ? "*Credit to you:* \(Money.pkr(line.amount))" : "*Balance due:* \(Money.pkr(inv.balanceDue))")
        }
        lines.append("")
        lines.append("Thank you for your business.")
        return lines.joined(separator: "\n")
    }

    // MARK: Send on WhatsApp (invoice-viewer.tsx)

    /// The number the ERP page's WhatsApp box starts with: the invoice's own, else its customer's, as the ERP
    /// keeps numbers (+92…).
    static func whatsAppPhone(_ inv: Invoice, customer: Customer?) -> String {
        let own = inv.customerContact ?? ""
        return pakistanE164(own.isEmpty ? (customer?.phone ?? "") : own)
    }

    /// What goes on WhatsApp from the phone (`openWhatsAppWithLink`): the words, then the customer's link,
    /// bare where invoices are named after the customer (Taheri), after "View estimate: " elsewhere.
    static func whatsAppText(_ inv: Invoice, link: URL, shopName: String, byCustomer: Bool) -> String {
        shareMessage(inv, shopName: shopName, byCustomer: byCustomer) + "\n\n" + (byCustomer ? "" : "View estimate: ") + link.absoluteString
    }

    /// wa.me with the number and the words written in (lib/whatsapp.ts `whatsAppLink`); nil without a usable number.
    static func whatsAppURL(phone: String, text: String) -> URL? {
        let number = CustomerKit.whatsAppNumber(phone)
        if number.isEmpty { return nil }
        return URL(string: "https://wa.me/\(number)?text=\(component(text))")
    }
}

/// A change that has landed, said for a few seconds over the invoice like the web's toast.
struct InvoiceNote: Equatable, Identifiable {
    let id = UUID()
    let title: String
    let detail: String
}

struct InvoiceNoteBanner: View {
    let note: InvoiceNote

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 1) {
                Text(note.title).font(.subheadline.weight(.semibold))
                Text(note.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

extension View {
    /// The payment sheet for an invoice (Kit's PaymentSheet), the balance one tap away. Closing it
    /// with a refusal showing keeps the sheet open with the ERP's own words.
    func invoicePaymentSheet(for invoice: Binding<Invoice?>) -> some View {
        sheet(item: invoice) { inv in
            // Money over the balance is a named customer's credit; a walk-in's is refused (invoice-credit.ts).
            PaymentSheet(title: "Take payment · \(inv.id)", owed: inv.balanceDue > 0.5 ? inv.balanceDue : nil,
                         customer: PaymentCustomer(name: inv.customerName, canHoldCredit: canHoldCredit(inv.customerId))) { amount, method, reference in
                try await InvoiceFacts.record(inv, amount: amount, method: method, reference: reference)
            }
        }
    }
}
