import Foundation
import ERPCore

// The Orders screens' small rules. Foundation and ERPCore only (no SwiftUI), so they can be
// checked on Linux with the package. The ERP's own rules stay in ERPCore; what is here is only the
// reading of them for a phone: which words, which order, which row.

/// How the hub is broken up (orders/page.tsx `groupBy`): by day to start with (the owner, 2026-10-05),
/// or by stage, which is the hub proper, or by week or month. The calendar ones are the Invoices
/// list's, so a day, a week and a month are named and cut the same on both. Due is the phone's own
/// (2026-10-09): the open orders by how soon each was promised, Late first.
enum OrdersGrouping: String, CaseIterable, Identifiable {
    case stage, day, week, month, due

    var id: String { rawValue }

    /// The web lists Stage first, then the graduations (GRADUATIONS: Day, Week, Month).
    var title: String {
        switch self {
        case .stage: return "Stage"
        case .day: return "Day"
        case .week: return "Week"
        case .month: return "Month"
        case .due: return "Due"
        }
    }

    /// The calendar cut, nil for Stage and Due.
    var calendar: InvoiceGrouping? {
        switch self {
        case .stage, .due: return nil
        case .day: return .day
        case .week: return .week
        case .month: return .month
        }
    }

    /// The switcher's first segment: the calendar cut in use, Day unless Week or Month was picked from the menu.
    var calendarCut: OrdersGrouping { calendar == nil ? .day : self }
}

/// The Due view's sections, in the order they are chased. "This week" is the bench week the ERP calls
/// urgent (URGENT_WINDOW_DAYS), so a card in it carries the same amber promise as anywhere else.
enum OrdersDueBucket: String, CaseIterable {
    case late, today, week, later, undated

    var title: String {
        switch self {
        case .late: return "Late"
        case .today: return "Today"
        case .week: return "This week"
        case .later: return "Later"
        case .undated: return "No date"
        }
    }

    var hint: String {
        switch self {
        case .late: return "past the day promised"
        case .today: return "promised for today"
        case .week: return "in the next \(URGENT_WINDOW_DAYS) days: start them now"
        case .later: return "more than a week away"
        case .undated: return "no day promised: oldest first"
        }
    }
}

/// What an order asks for next (components/order/next-step.tsx): the one reading the hub's cards and the
/// order page's bar both use.
///   Awaiting transfer  Check transfer (the transfer's moves: the slips, Transfer received, Let it lapse)
///   Not started        Give out (native workshop assignment for this order)
///   With karigars      Mark ready (Completed, every piece ticked)
///   Ready to hand over Finalize & invoice
///   Invoiced           the invoice: money is taken there only (decision "Orders hub", 2026-10-06)
enum OrderNextStep: Equatable {
    case checkTransfer(slipIn: Bool)
    case giveOut
    case markReady
    case finalize
    case invoice(id: String, owed: Double)

    var title: String {
        switch self {
        case .checkTransfer(let slipIn): return slipIn ? "Slip in: check" : "Check transfer"
        case .giveOut: return "Give out"
        case .markReady: return "Mark ready"
        case .finalize: return "Finalize & invoice"
        case .invoice(let id, let owed): return owed > 0.5 ? "Open \(id) · \(Money.pkr(owed)) due" : "Open \(id)"
        }
    }

    var symbol: String {
        switch self {
        case .checkTransfer: return "banknote"
        case .giveOut: return "person.badge.plus"
        case .markReady: return "checkmark.circle"
        case .finalize, .invoice: return "doc.text"
        }
    }
}

enum OrdersLogic {
    // MARK: Statuses

    /// What the status menu offers: never a bare "Refunded" (docs/decisions.md "Orders hub"; the
    /// server refuses it too). Refund order is the ERP's own page.
    static let settableStatuses = ["Pending", "In Progress", "Completed", "Cancelled"]

    /// The hub's status filter: the ERP's ORDER_STATUSES, all of them (it filters, it does not write).
    static let filterStatuses = ["Pending", "In Progress", "Completed", "Cancelled", "Refunded"]

    /// The hub's payment filter: Any payment, then these (getOrderPaymentStatus).
    static let filterPayments = ["Paid", "Partial", "Unpaid"]

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

    /// The order's one next step; nil once it is closed, or paid and done with no invoice to point at.
    /// `owed` is what its invoice still has owing.
    static func nextStep(_ order: Order, stage: OrderStage, owed: Double) -> OrderNextStep? {
        if let id = order.invoiceId, !id.isEmpty { return .invoice(id: id, owed: owed) }
        switch stage {
        case .transfer: return .checkTransfer(slipIn: order.website?.paymentStatus == .slipSent)
        case .new: return .giveOut
        case .karigar: return .markReady
        case .ready: return .finalize
        case .payment, .done, .closed: return nil
        }
    }

    /// The Advance beside the step: an owner's (the ERP refuses anyone else), on an order still being made.
    static func offersAdvance(_ order: Order, stage: OrderStage, isOwner: Bool) -> Bool {
        isOwner && making(stage) && canAdvance(order)
    }

    /// Still to be handed over: not invoiced, not cancelled or refunded. A finished piece not yet invoiced
    /// still has its promise to keep.
    static func isOpen(_ order: Order) -> Bool {
        !hasInvoice(order) && order.status != .cancelled && order.status != .refunded
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

    /// What the customer still owes on the order as the list shows it: the order's own balance (its
    /// `grandTotal`) until it is invoiced, then what the invoice still has owing. Below zero is credit.
    static func stillOwed(_ order: Order, invoiceOwed: Double) -> Double {
        hasInvoice(order) ? invoiceOwed : order.grandTotal
    }

    // MARK: The Due view

    static func dueBucket(_ t: OrderTiming) -> OrdersDueBucket {
        // An order with no day promised is undated here, whatever the age rule calls it.
        guard t.due != nil else { return .undated }
        switch t.state {
        case .late: return .late
        case .today: return .today
        case .upcoming: return -t.daysLate <= URGENT_WINDOW_DAYS ? .week : .later
        case .noPromise: return .undated
        }
    }

    /// The open orders by how soon they were promised: in each section the soonest promise first (so the
    /// latest of the late), and the undated oldest first, as they have waited longest.
    static func dueGroups(_ orders: [Order], now: Date) -> [(bucket: OrdersDueBucket, orders: [Order])] {
        var members: [OrdersDueBucket: [(order: Order, due: Date?)]] = [:]
        for o in orders where isOpen(o) {
            let t = orderTiming(o, now: now)
            members[dueBucket(t), default: []].append((o, t.due))
        }
        return OrdersDueBucket.allCases.compactMap { b in
            guard let rows = members[b], !rows.isEmpty else { return nil }
            let sorted = rows.sorted { a, c in
                if let da = a.due, let dc = c.due, da != dc { return da < dc }
                let ta = takenAt(a.order), tc = takenAt(c.order)
                if ta != tc { return ta < tc }
                return a.order.id < c.order.id
            }
            return (b, sorted.map(\.order))
        }
    }

    // MARK: Whose it is

    /// Taken by the signed-in person, whose rows are lit in place (docs/decisions.md "Signed-in defaults").
    /// Nobody is lit when this account has no counter name.
    static func isMine(_ order: Order, person: String?) -> Bool {
        guard let person, !person.isEmpty, let by = order.takenBy else { return false }
        return by == person
    }

    /// When the order was taken, for newest first; an order with no readable date sorts last.
    static func takenAt(_ order: Order) -> Date {
        ERPDate.parse(order.createdAt) ?? .distantPast
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

    /// Always from the pieces, so it agrees with their estimates (the order page, 2026-10-04), and never
    /// from the stored subtotal: the page sums `totalEstimate` and nothing else, so a piece without an
    /// estimate counts for nothing there, and the balance must read the same here.
    static func subtotal(_ order: Order) -> Double {
        order.items.reduce(0) { $0 + ($1.totalEstimate ?? 0) }
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

    /// categorySingular (lib/categories.ts): "Ring" for cat001; the id itself when unknown, as the web's
    /// `categorySingular(id) || id` shows it. Both the order page and the invoice page read it.
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

    /// The card's one line about what the order is: its summary, else its first piece, and how many
    /// more pieces there are beside it ("3 pieces", "+2 more").
    static func cardWhat(_ order: Order) -> (text: String, extra: String?) {
        let count = order.items.count
        if let s = order.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
            return (s, count > 1 ? "\(count) pieces" : nil)
        }
        let names = order.items.map { $0.description.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard let first = names.first else {
            return (count == 0 ? "No pieces" : "\(count) piece\(count == 1 ? "" : "s")", nil)
        }
        return (first, count > 1 ? "+\(count - 1) more" : nil)
    }

    private static let dueDayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "EEE d MMM"
        return f
    }()

    /// "Thu 12 Oct", the promised day as the cards and the order page say it.
    static func dueDay(_ d: Date) -> String { dueDayFormat.string(from: d) }

    /// The order page's promise in words: "Due today", "Due Mon 12 Oct · in 3 days", "Due Wed 7 Oct · 2 days
    /// late"; how far off it is only while the order is still being chased (promise-line.tsx).
    static func promiseLine(_ order: Order, now: Date) -> String {
        let p = promise(order, now: now)
        let t = orderTiming(order, now: now)
        if p.undated {
            // The ERP's age rule still counts an old undated order as late; say how old, quietly.
            return isActiveOrder(order) && t.state == .late ? "No day promised · " + timingLabel(t) : "No day promised"
        }
        if t.state == .today { return "Due today" }
        var s = t.due.map { "Due " + dueDay($0) } ?? "No day promised"
        if p.chase, !p.label.isEmpty, t.state != .today { s += " · " + p.label }
        return s
    }

    /// A number as the shop writes one: "0300 1234567", "+92 300 1234567"; anything else as it was typed.
    static func phoneWords(_ phone: String?) -> String {
        let raw = (phone ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard raw.allSatisfy({ ($0.isASCII && $0.isNumber) || $0 == " " || $0 == "-" || $0 == "+" }) else { return raw }
        let d = digits(raw)
        if d.count == 12, d.hasPrefix("92"), d.dropFirst(2).hasPrefix("3"), !raw.hasPrefix("0") {
            return "+92 \(d.dropFirst(2).prefix(3)) \(d.dropFirst(5))"
        }
        if d.count == 11, d.hasPrefix("03") {
            return "\(d.prefix(4)) \(d.dropFirst(4))"
        }
        return raw
    }

    // MARK: Margin (shop screens only)

    /// A house that does not cost by gold (Mina) shows no margin at all (shop-margin.tsx SHOP_MARGIN_ON).
    /// Everyone else in the shop sees it, owner or staff, blurred until tapped; never a customer.
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
