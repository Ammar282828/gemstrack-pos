import Foundation
import ERPCore

// The Orders screens' small rules. Foundation and ERPCore only (no SwiftUI), so they can be
// checked on Linux with the package. The ERP's own rules stay in ERPCore; what is here is only the
// reading of them for a phone: which words, which order, which row.

enum OrdersLogic {
    // MARK: Statuses

    /// What the status menu offers: never a bare "Refunded" (docs/decisions.md "Orders hub"; the
    /// server refuses it too). Refund order is the ERP's own page.
    static let settableStatuses = ["Pending", "In Progress", "Completed", "Cancelled"]

    /// The hub's status filter: the ERP's ORDER_STATUSES, all of them (it filters, it does not write).
    static let filterStatuses = ["Pending", "In Progress", "Completed", "Cancelled", "Refunded"]

    /// Cancelling asks first, on the list and on the order page alike.
    static let cancelWords = "It leaves the Workshop and its Shopify draft is cancelled. It can be set back to Pending later."

    // MARK: What each stage lets you do (components/order/next-step.tsx)

    /// Still being made: an advance can be recorded, and the stage has its one action.
    static func making(_ stage: OrderStage) -> Bool {
        stage == .new || stage == .karigar || stage == .ready
    }

    /// "Record an advance": not once invoiced (money is taken on the invoice only), not once cancelled.
    static func canAdvance(_ order: Order) -> Bool {
        !hasInvoice(order) && order.status != .cancelled && order.status != .refunded
    }

    static func hasInvoice(_ order: Order) -> Bool {
        !(order.invoiceId ?? "").isEmpty
    }

    /// Online orders are the ones placed on the website and confirmed by a person.
    static func isOnline(_ order: Order) -> Bool {
        order.source == .website && order.website != nil
    }

    // MARK: Owing on invoices

    /// What each invoice still has owing (the hub's "Awaiting payment"): `isOwing` is the ERP's rule.
    static func owedOnInvoices(_ invoices: [Invoice]) -> [String: Double] {
        var out: [String: Double] = [:]
        for inv in invoices where isOwing(inv) { out[inv.id] = inv.balanceDue }
        return out
    }

    static func owed(_ order: Order, _ owedOn: [String: Double]) -> Double {
        guard let id = order.invoiceId, !id.isEmpty else { return 0 }
        return owedOn[id] ?? 0
    }

    // MARK: Search

    /// The hub's search: order id, customer, phone, the ONL- number the customer quotes, and the
    /// pieces' words.
    static func matches(_ order: Order, _ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return true }
        if order.id.lowercased().contains(q) { return true }
        if (order.customerName ?? "").lowercased().contains(q) { return true }
        if (order.summary ?? "").lowercased().contains(q) { return true }
        if (order.website?.onlineId ?? "").lowercased().contains(q) { return true }
        if let contact = order.customerContact, !contact.isEmpty {
            if contact.lowercased().contains(q) { return true }
            let wanted = digits(q)
            if wanted.count >= 3, digits(contact).contains(wanted) { return true }
        }
        return order.items.contains { $0.description.lowercased().contains(q) }
    }

    static func digits(_ s: String) -> String { s.filter { $0.isASCII && $0.isNumber } }

    /// A number to dial: digits and a leading plus, nothing else.
    static func dialable(_ phone: String) -> String { phone.filter { $0.isASCII && ($0.isNumber || $0 == "+") } }

    /// "Walk-in" when the order names nobody, or names the placeholder (lib/walk-in.ts: a walk-in is not a customer).
    static func customerName(_ order: Order) -> String {
        let n = (order.customerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty || isWalkInName(n) ? "Walk-in" : n
    }

    // MARK: The promise (components/shared/promise-line.tsx)

    struct Promise {
        /// No promised date on the order.
        let undated: Bool
        let state: PromiseState
        /// "3 days late" / "due today" / "in 5 days"; empty when it says nothing.
        let label: String
        /// Still being chased: a finished order's promise is history.
        let chase: Bool
        /// Promised inside a bench week (or late, or today), and still open.
        let urgent: Bool
        /// Whether the label is shown beside the date.
        let showsLabel: Bool
    }

    static func promise(_ order: Order, now: Date) -> Promise {
        guard let promised = order.promisedDate, !promised.isEmpty else {
            return Promise(undated: true, state: .noPromise, label: "", chase: false, urgent: false, showsLabel: false)
        }
        let t = orderTiming(order, now: now)
        let chase = isActiveOrder(order)
        let hurry = chase && isUrgent(t)
        let shows = chase && (t.state != .upcoming || hurry)
        return Promise(undated: false, state: t.state, label: timingLabel(t), chase: chase, urgent: hurry, showsLabel: shows)
    }

    // MARK: Money, as the order page works it out

    /// Always from the pieces, so it agrees with their estimates (the order page, 2026-10-04); the stored
    /// subtotal stands in for an order whose pieces carry no estimate.
    static func subtotal(_ order: Order) -> Double {
        let live = order.items.reduce(0) { $0 + ($1.totalEstimate ?? 0) }
        return live > 0 ? live : order.subtotal
    }

    static func discount(_ order: Order) -> Double { order.discountAmount ?? 0 }

    static func exchangeValue(_ order: Order) -> Double { order.advanceInExchangeValue ?? 0 }

    /// Pieces − discount − advances − exchange: the big "Balance Due" on the order page.
    static func balance(_ order: Order) -> Double {
        subtotal(order) - discount(order) - order.advancePayment - exchangeValue(order)
    }

    struct AdvanceLine: Identifiable {
        let id: Int
        let date: String
        let method: String
        let note: String
        let amount: Double
    }

    /// The advances as they will land on the invoice: the one taken with the order, then each
    /// recorded after it, each with its day, how it was paid and its note.
    static func advanceLines(_ order: Order) -> [AdvanceLine] {
        orderAdvancePayments(order, label: "").enumerated().map { i, a in
            let raw = a.notes ?? ""
            let clean = raw.hasPrefix(": ") ? String(raw.dropFirst(2)) : raw
            let note = clean.isEmpty ? (a.date == order.createdAt ? "With the order" : "") : clean
            return AdvanceLine(id: i, date: a.date, method: a.method?.rawValue ?? "", note: note, amount: a.amount)
        }
    }

    // MARK: Online orders (components/order/website-order-panel.tsx)

    /// What the customer pays: the pieces and the delivery (the order's grandTotal is the ERP's balance).
    static func onlineTotal(_ order: Order) -> Double {
        if let t = order.website?.total { return t }
        return order.subtotal + (order.website?.deliveryCharge ?? 0)
    }

    static func paymentWords(_ status: WebsitePaymentStatus) -> String {
        switch status {
        case .awaitingTransfer: return "Awaiting transfer"
        case .slipSent: return "Slip sent: check the bank"
        case .transferReceived: return "Transfer received"
        case .refunded: return "Refunded"
        case .expired: return "Lapsed"
        case .unknown(let s): return s
        }
    }

    // MARK: Words and numbers

    /// A figure without trailing zeros: 4.2, 22.5, 8.
    static func number(_ x: Double, maxDigits: Int = 3) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = maxDigits
        return f.string(from: NSNumber(value: x)) ?? String(x)
    }

    static func grams(_ g: Double) -> String { number(g) + " g" }

    static func hasKarigar(_ item: OrderItem) -> Bool {
        guard let id = item.karigarId else { return false }
        return !id.isEmpty && id != "none"
    }

    /// TODO(logic): port CUSTOMER_SOURCE_LABELS (store.ts)
    static func sourceLabel(_ s: CustomerSource) -> String {
        switch s {
        case .taheriSpillover: return "Taheri Spillover"
        case .referral: return "Referral"
        case .walkin: return "Walk-in"
        case .socialMedia: return "Social media"
        case .website: return "Website"
        case .other: return "Other"
        case .unknown(let raw): return raw
        }
    }

    /// TODO(logic): port categorySingular (categories.ts): "Ring" for cat001; the id itself when unknown.
    static func categorySingular(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        let names: [String: String] = [
            "cat001": "Ring", "cat002": "Top", "cat003": "Bali", "cat004": "Locket", "cat005": "Bracelet",
            "cat006": "Bracelet and Ring Set", "cat007": "Bangle", "cat008": "Chain", "cat009": "Band",
            "cat010": "Locket Set without Bangle", "cat011": "Locket Set with Bangle", "cat012": "String Set",
            "cat013": "Stone Necklace Set without Bracelets", "cat014": "Stone Necklace Set with Bracelets",
            "cat015": "Gold Necklace Set with Bracelets", "cat016": "Gold Necklace Set without Bracelets",
            "cat017": "Gold Coin", "cat018": "Men's Ring", "cat019": "Loose Bracelet", "cat020": "Men's Button",
        ]
        return names[id] ?? id
    }

    /// The rates the order was booked at, for the gold karats it uses: "Gold (21K): PKR 33,700/g".
    /// Staff's orders carry no `ratesApplied` (roles.ts), so they get an empty line.
    static func rateLine(_ order: Order) -> String {
        var seen: [String] = []
        var parts: [String] = []
        for item in order.items where item.metalType == .gold {
            guard let karat = item.karat else { continue }
            if seen.contains(karat.rawValue) { continue }
            seen.append(karat.rawValue)
            let r = order.ratesApplied
            var rate: Double?
            switch karat {
            case .k24: rate = r.goldRatePerGram24k
            case .k22: rate = r.goldRatePerGram22k
            case .k21: rate = r.goldRatePerGram21k
            case .k18: rate = r.goldRatePerGram18k
            default: rate = nil
            }
            if let rate, rate > 0 { parts.append("Gold (\(karat.rawValue.uppercased())): \(Money.pkr(rate))/g") }
        }
        return parts.joined(separator: " | ")
    }

    /// The card's line about what the order is: its summary, else its pieces.
    static func whatIsIt(_ order: Order) -> String {
        if let s = order.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty { return s }
        let names = order.items.map { $0.description.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if names.isEmpty { return order.items.isEmpty ? "No pieces" : "\(order.items.count) piece\(order.items.count == 1 ? "" : "s")" }
        let shown = names.prefix(3).joined(separator: ", ")
        return names.count > 3 ? shown + " and \(names.count - 3) more" : shown
    }

    // MARK: Margin (shop screens only)

    /// A house that does not cost by gold (Mina) shows no margin at all (shop-margin.tsx SHOP_MARGIN_ON).
    static func marginIsOn(_ settings: MarginSettings) -> Bool { settings.rattiLess != nil }

    /// What the owner reads when the figure is tapped (shop-margin.tsx MarginFigure).
    static func marginWords(_ m: Margin, settings: MarginSettings) -> String {
        if m.assumed { return "≈ \(percentLabel(m)) (no 24k rate given: assumed)" }
        var s = "\(percentLabel(m)) · \(Money.pkr(m.profit))"
        if m.costedShare < 0.999 {
            let rest = Int(((1 - m.costedShare) * 100).rounded())
            let assumed = Int((settings.assumedMargin * 100).rounded())
            s += " · \(rest)% of it at \(assumed)% (no weight)"
        }
        return s
    }
}
