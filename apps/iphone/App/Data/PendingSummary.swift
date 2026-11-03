import Foundation

/// What a change waiting in the Outbox is, in the words a list reads: "Order for Ali", "Sale to Sara", "Payment on
/// INV-000123". Kept on disk beside the change, so a row "Waiting to send" survives the app being killed.
/// `kind` is "order" or "invoice" for a new record (shown at the top of Orders / Invoices as a pending row), and
/// "payment", "advance", "send" or "change" for the rest (shown in Waiting to send only).
struct PendingSummary: Codable, Equatable {
    var kind: String
    /// Who it is for ("Ali", "Walk-in") or, for a change, what it does.
    var title: String
    var detail: String = ""
    /// The record's total, or the payment's amount.
    var amount: Double?
    /// The invoice or order a payment is on.
    var target: String?

    /// The one line the failure banner and the queue say ("Not saved: Order for Ali").
    var label: String {
        switch kind {
        case "order": return "Order for \(title)"
        case "invoice": return "Sale to \(title)"
        case "payment": return "Payment on \(target ?? title)"
        case "advance": return "Advance on \(target ?? title)"
        default: return title
        }
    }

    /// A summary made from the request itself, for a write whose screen did not say what it is.
    static func make(op: String, fields: [String: Any]) -> PendingSummary {
        func text(_ v: Any?) -> String { ((v as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        func number(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
        func pieces(_ n: Int) -> String { n == 1 ? "1 piece" : "\(n) pieces" }
        switch op {
        case "createOrder":
            let o = fields["order"] as? [String: Any] ?? [:]
            let name = text(o["customerName"])
            return PendingSummary(kind: "order", title: name.isEmpty ? "Walk-in" : name,
                                  detail: pieces((o["items"] as? [Any])?.count ?? 0), amount: number(o["subtotal"]))
        case "createInvoice":
            let existing = text(fields["existingInvoiceId"])
            if !existing.isEmpty { return PendingSummary(kind: "change", title: "Changes to \(existing)") }
            let name = text((fields["customer"] as? [String: Any])?["name"])
            return PendingSummary(kind: "invoice", title: name.isEmpty ? "Walk-in" : name,
                                  detail: pieces((fields["cart"] as? [Any])?.count ?? 0))
        case "recordPayment":
            let id = text(fields["invoiceId"])
            return PendingSummary(kind: "payment", title: id, detail: text(fields["method"]), amount: number(fields["amount"]), target: id)
        case "recordOrderAdvance":
            let id = text(fields["orderId"])
            return PendingSummary(kind: "advance", title: id, detail: text(fields["method"]), amount: number(fields["amount"]), target: id)
        case "updateOrder":
            return PendingSummary(kind: "change", title: "Changes to order \(text(fields["orderId"]))")
        default:
            return PendingSummary(kind: "change", title: words(op))
        }
    }

    /// "addExtraRevenue" -> "Add extra revenue".
    static func words(_ op: String) -> String {
        var out = ""
        for ch in op {
            if ch.isUppercase, !out.isEmpty { out += " " }
            out += String(ch).lowercased()
        }
        return out.prefix(1).uppercased() + out.dropFirst()
    }
}
