import Foundation
import ERPCore

/// The words the Contact control's WhatsApp and Message open with (owner, 2026-11-14: "have pre-created messages … if an
/// order is done and I press the message on WhatsApp … your order is ready at Taheri, please collect it, or something
/// professional"). The web's `lib/customer-messages.ts`, word for word: one message per moment of an order, invoice or
/// repair, typed and ready to change or send. Nothing is sent by itself.
enum CustomerMessages {
    /// "Assalam o Alaikum Sana," — the name only for a named customer, never "Walk-in Customer".
    private static func greet(_ name: String?) -> String {
        let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return "Assalam o Alaikum" + (n.isEmpty || isWalkInName(n) ? "" : " " + n) + ","
    }

    /// Whole rupees owed; 0 when nothing (under a rupee is settled).
    private static func owes(_ n: Double) -> Double { n >= 1 ? n.rounded() : 0 }

    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "EEEE d MMMM"
        return f
    }()
    private static func promised(_ ymd: String?) -> String {
        guard let s = ymd, s.count >= 10 else { return "" }
        let p = DateFormatter()
        p.locale = Locale(identifier: "en_US_POSIX")
        p.timeZone = ERPDate.karachi
        p.dateFormat = "yyyy-MM-dd"
        guard let d = p.date(from: String(s.prefix(10))) else { return "" }
        return day.string(from: d)
    }

    /// An order's message for where it stands. `balance`: what is still to pay (on its invoice once invoiced).
    static func order(_ o: Order, stage: OrderStage, balance: Double, shop: String) -> String {
        let hi = greet(o.customerName)
        let due = owes(balance)
        switch stage {
        case .ready:
            return "\(hi) your order \(o.id) is ready at \(shop). Please collect it at your convenience." + (due > 0 ? " The balance is \(Money.pkr(due))." : "") + " Thank you."
        case .new, .karigar:
            let by = promised(o.promisedDate)
            return "\(hi) thank you for your order with \(shop). Your order \(o.id) is being made" + (by.isEmpty ? "" : " and is expected to be ready by \(by)") + ". We will let you know as soon as it is ready."
        case .transfer:
            return "\(hi) thank you for your order \(o.id) with \(shop). We will confirm it as soon as your transfer reaches us."
        case .payment:
            return "\(hi) a gentle reminder from \(shop): \(Money.pkr(due)) is still to be paid on your order \(o.id). Thank you."
        case .done:
            return "\(hi) thank you for choosing \(shop). We hope you enjoy your jewellery, and look forward to seeing you again."
        case .closed:
            return ""
        }
    }

    /// An invoice's message: a gentle reminder while money is owed, thanks once it is paid.
    static func invoice(_ i: Invoice, shop: String) -> String {
        let hi = greet(i.customerName)
        let due = owes(i.balanceDue)
        return due > 0
            ? "\(hi) a gentle reminder from \(shop): \(Money.pkr(due)) is still to be paid on your invoice \(i.id). Thank you."
            : "\(hi) thank you for choosing \(shop). We hope you enjoy your jewellery, and look forward to seeing you again."
    }

    /// A repair ticket's message: received while in the shop, ready for collection once ready.
    /// `status`: the ticket's status as the screen has it (a change just made counts).
    static func repair(_ r: Repair, status: RepairStatus, shop: String) -> String {
        let hi = greet(r.customerName)
        let one = r.pieces.count == 1
        let what = one ? "your " + r.pieces[0].item.lowercased() : (r.pieces.isEmpty ? "your pieces" : "your \(r.pieces.count) pieces")
        let due = owes(repairBalance(r))
        switch status {
        case .ready:
            return "\(hi) \(what) \(one ? "is" : "are") ready for collection at \(shop) (repair \(r.id))." + (due > 0 ? " Balance: \(Money.pkr(due))." : "") + " Please bring your receipt."
        case .collected:
            return "\(hi) thank you for choosing \(shop). We hope you are happy with the work."
        case .cancelled:
            return ""
        default:
            return "\(hi) we have received \(what) for repair at \(shop) (repair \(r.id)). We will let you know as soon as \(one ? "it is" : "they are") ready."
        }
    }
}
