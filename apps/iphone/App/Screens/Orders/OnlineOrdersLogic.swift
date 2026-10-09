import Foundation
import ERPCore

/// The online inbox's words and small sums, as the web's cards and dialogs have them
/// (components/order/online-inbox.tsx, components/order/website-order-panel.tsx). Nothing here decides
/// money: what a move books and sends is the server's (lib/website/online.ts, fulfilment.ts), and its
/// confirmation shows the server's own words (OnlinePreview).
enum OnlineOrdersLogic {
    /// The web's HOLD_HOURS (online-inbox.tsx): what a confirmation says when the server's preview has not come.
    static let holdHours = 24

    /// The reasons the web offers to decline with (online-inbox.tsx REASONS), sent after "we can't take it as it was placed:".
    static let reasons = [
        "This piece cannot be made in the size asked for",
        "We cannot deliver to this city",
        "We could not reach you on this number",
        "This design is no longer made",
    ]

    /// Declining keeps 300 characters of the reason and needs three (online.ts declineOnlineOrder).
    static let reasonLimit = 300

    static func reasonReady(_ reason: String) -> Bool {
        reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3
    }

    /// Waiting for someone to look: to confirm, or being confirmed by someone a moment ago.
    static func isWaiting(_ r: OnlineOrderRow) -> Bool { r.state == "to_confirm" || r.state == "confirming" }

    /// "Rs 201,500", as the customer's own messages write it (the shop's screens say PKR: Money.pkr).
    static func rs(_ n: Double) -> String { "Rs " + Money.grouped(n) }

    /// "+PKR 3,500" or "−PKR 3,500": how far a price has moved.
    static func signedPKR(_ n: Double) -> String { (n < 0 ? "−" : "+") + Money.pkr(abs(n)) }

    /// The piece's name without the " (size 12)" the site appends: the size has its own line.
    static func pieceName(_ description: String) -> String {
        guard description.hasSuffix(")"), let r = description.range(of: " (size ") else { return description }
        let inner = description[r.upperBound..<description.index(before: description.endIndex)]
        return inner.isEmpty || inner.contains(")") ? description : String(description[..<r.lowerBound])
    }

    /// The sizes asked for, or "none asked" (the confirm dialog's line).
    static func sizes(_ r: OnlineOrderRow) -> String {
        let s = r.lines.compactMap(\.size)
        return s.isEmpty ? "none asked" : s.joined(separator: ", ")
    }

    /// "piece", or "3 pieces".
    static func pieces(_ n: Int) -> String { n == 1 ? "piece" : "\(n) pieces" }

    // MARK: Today's rate

    struct Moved {
        let amount: Double
        let percent: Double
    }

    /// How far gold has moved the same pieces since the customer ordered; nil when today's price is not known.
    static func moved(_ r: OnlineOrderRow) -> Moved? {
        guard let today = r.todayTotal else { return nil }
        let amount = today - r.grandTotal
        return Moved(amount: amount, percent: r.grandTotal != 0 ? amount / r.grandTotal * 100 : 0)
    }

    /// The card's line, from half a percent either way: "At today's rate it is PKR 205,000 (+PKR 3,500, +1.7%).
    /// Confirming holds their price."
    static func movedLine(_ r: OnlineOrderRow) -> String? {
        guard let m = moved(r), let today = r.todayTotal, abs(m.percent) >= 0.5 else { return nil }
        let pct = (m.percent > 0 ? "+" : "") + String(format: "%.1f", m.percent) + "%"
        return "At today's rate it is \(Money.pkr(today)) (\(signedPKR(m.amount)), \(pct)). Confirming holds their price."
    }

    /// The confirm dialog's "Today it would be": only when gold has gone up by half a percent or more.
    static func dearerToday(_ r: OnlineOrderRow) -> Double? {
        guard let m = moved(r), m.amount > 0, abs(m.percent) >= 0.5 else { return nil }
        return r.todayTotal
    }

    // MARK: Words

    /// When it was placed, said the web's way ("2 hours ago").
    static func ago(_ iso: String, now: Date = Date()) -> String {
        guard let d = ERPDate.parse(iso) else { return "" }
        return RelativeDateTimeFormatter().localizedString(for: d, relativeTo: now)
    }

    /// The account that did it, without its domain; nothing for the development bypass.
    static func who(_ email: String?) -> String? {
        guard let e = email, !e.isEmpty, e != "dev-bypass" else { return nil }
        return e.split(separator: "@").first.map(String.init) ?? e
    }

    /// The confirm dialog's description, the web's words; the hold is the server's when its preview has come.
    static func confirmWords(_ r: OnlineOrderRow, holdUntil: String?) -> String {
        let hold = holdWords(holdUntil)
        return "It becomes an order in the book for \(r.customer.name), labelled Online, with its \(pieces(r.lines.count)) at the "
            + "prices they were quoted. They are told on WhatsApp, and you send them your bank details there; they have "
            + "\(hold) to transfer \(Money.pkr(r.grandTotal))."
    }

    /// "until Tue 6 Oct 2:30 pm" from the server's hold, else the web's "24 hours".
    static func holdWords(_ holdUntil: String?) -> String {
        if let iso = holdUntil, let at = until(iso) { return "until " + at }
        return "\(holdHours) hours"
    }

    /// What became of a WhatsApp the server tried to send (the routes' `notified`: nil when it went).
    static func told(_ notified: String?, name: String, sent: String) -> OnlineTold {
        if let n = notified, !n.isEmpty { return OnlineTold(words: "Done, but the WhatsApp did not send (\(n)): tell \(name) yourself.", ok: false) }
        return OnlineTold(words: sent, ok: true)
    }

    // MARK: The bank details, from the shop's phone

    /// WhatsApp to the customer from this phone, the amount and reference written in: the shop sends its bank
    /// details itself (the owner, 2026-10-04), so this only opens the chat ready (lib/website/online-client.ts
    /// `bankDetailsWhatsApp`). The person adds the account and presses send there.
    static func bankDetailsText(name: String, ref: String, total: Double) -> String {
        "Assalamualaikum \(name), your order \(ref) is confirmed. The amount is \(rs(total)). Please transfer it to:\n"
    }

    /// JavaScript's encodeURIComponent leaves these alone.
    private static let componentSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    static func component(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: componentSafe) ?? s
    }

    /// wa.me with the words written in; nil without a usable number.
    static func bankDetailsURL(phone: String, name: String, ref: String, total: Double) -> URL? {
        let number = CustomerKit.whatsAppNumber(phone)
        if number.isEmpty { return nil }
        return URL(string: "https://wa.me/\(number)?text=\(component(bankDetailsText(name: name, ref: ref, total: total)))")
    }

    /// A chat with the customer, nothing written in.
    static func chatURL(_ phone: String) -> URL? { CustomerKit.whatsAppURL(phone) }

    /// A call to the customer.
    static func callURL(_ phone: String) -> URL? { CustomerKit.callURL(phone) }

    /// "Tue 6 Oct 2:30 pm": when a hold ends, said as the shop says a time; nil for a time that does not read.
    static func until(_ iso: String) -> String? {
        let s = ShopDate.say(iso, withTime: true)
        return s.isEmpty ? nil : s
    }
}

/// A move done, said on the screen it was made from: whether the customer's WhatsApp went.
struct OnlineTold: Equatable {
    let words: String
    let ok: Bool
}
