#if os(macOS)
import SwiftUI
import ERPCore

// What the Orders place reads of an order (docs/features/mac-design.md, "Orders"): one row of the table, a card of the
// board, the sums of the summary bar. Nothing here decides anything the iPhone decides otherwise: the stage is ERPCore's
// `stageOf`, the promise is `orderTiming` / `OrdersLogic.promise`, the money is the order page's own sums
// (`OrdersLogic.subtotal`, `discount`, `balance`) and, once invoiced, the invoice's.

enum MacOrdersLogic {
    // MARK: The stage

    /// Where the table's Stage column sorts: the order they are worked in.
    static func stageRank(_ s: OrderStage) -> Int {
        switch s {
        case .transfer: return 0
        case .new: return 1
        case .karigar: return 2
        case .ready: return 3
        case .payment: return 4
        case .done: return 5
        case .closed: return 6
        }
    }

    /// The tone of a stage's dot (the card's own: with karigars is blue, ready and done green, waiting on money amber).
    static func tone(_ s: OrderStage) -> Tone {
        switch s {
        case .karigar: return .working
        case .ready, .done: return .settled
        case .transfer, .payment: return .owed
        case .new, .closed: return .quiet
        }
    }

    /// The stage's words from ERPCore's `STAGES`; a cancelled or refunded order says which.
    static func words(_ order: Order, stage: OrderStage) -> String {
        if stage == .closed {
            let s = order.status.rawValue
            return s.isEmpty ? "Closed" : s
        }
        return STAGES[stage]?.title ?? stage.rawValue
    }

    /// The stage with the status just chosen shown before the shelf catches up (the hub's own rule: an invoiced or
    /// awaiting-transfer order keeps its own).
    static func stage(_ order: Order, owedOn: [String: Double], local: String?) -> OrderStage {
        stage(order, invoiceOwed: OrdersLogic.owed(order, owedOn), local: local)
    }

    static func stage(_ order: Order, invoiceOwed: Double, local: String?) -> OrderStage {
        let base = stageOf(order, owedOnInvoice: invoiceOwed)
        guard let s = local, base != .transfer, !OrdersLogic.hasInvoice(order) else { return base }
        switch s {
        case "Cancelled", "Refunded": return .closed
        case "Completed": return .ready
        case "In Progress": return .karigar
        case "Pending": return .new
        default: return base
        }
    }

    // MARK: The money

    /// What the order is worth: the pieces less the discount (the order page's Total), or the invoice's total once it is
    /// invoiced. `Order.grandTotal` is the balance, never this.
    static func worth(_ order: Order, invoice: Invoice?) -> Double {
        if OrdersLogic.hasInvoice(order), let invoice { return invoice.grandTotal }
        return max(OrdersLogic.subtotal(order) - OrdersLogic.discount(order), 0)
    }

    /// What has come in against it: the cash advances and the gold taken in exchange (both are payment).
    static func paid(_ order: Order) -> Double {
        order.advancePayment + OrdersLogic.exchangeValue(order)
    }

    /// What is still owed: the order's balance until it is invoiced, then what the invoice has owing; nothing for a
    /// cancelled or refunded order. Below zero is credit.
    static func owed(_ order: Order, stage: OrderStage, invoiceOwed: Double) -> Double {
        if stage == .closed { return 0 }
        return OrdersLogic.hasInvoice(order) ? invoiceOwed : OrdersLogic.balance(order)
    }

    /// What an invoice has owing, by the hub's rule (`isOwing`).
    static func invoiceOwed(_ invoice: Invoice?) -> Double {
        guard let invoice, isOwing(invoice) else { return 0 }
        return invoice.balanceDue
    }

    // MARK: The pieces' karigars

    /// The karigars on an order's pieces, in the order they first appear: "Sana, Bilal".
    static func karigarNames(_ order: Order, names: [String: String]) -> String {
        var seen: [String] = []
        for item in order.items where OrdersLogic.hasKarigar(item) {
            guard let id = item.karigarId, !seen.contains(id) else { continue }
            seen.append(id)
        }
        return seen.map { names[$0] ?? "Karigar " + $0 }.joined(separator: ", ")
    }
}

/// One order as the table and the board read it. Made once per change of the books (a `Memo` in the place), never
/// per drawing.
struct MacOrdersListRow: Identifiable {
    let id: String
    let customer: String
    let createdAt: String
    let stage: OrderStage
    let stageRank: Int
    let stageWords: String
    let stageTone: Tone
    /// "yyyy-MM-dd" for the sort; a far day when nothing was promised, so undated orders sort last.
    let promisedKey: String
    /// "Thu 12 Oct", empty when nothing was promised.
    let promisedDay: String
    /// The card's words: "Late 3 days", "Due today", "Due Thu 12 Oct".
    let promisedWords: String
    let promisedTone: Tone
    /// The order page's promise line, for a tooltip.
    let promisedHelp: String
    let pieces: Int
    let karigars: String
    let worth: Double
    let advance: Double
    let owed: Double
    /// What it is, in a line: "Ring +2 more".
    let what: String
    let takenBy: String

    init(_ o: Order, stage: OrderStage, invoice: Invoice?, invoiceOwed: Double, names: [String: String], now: Date) {
        let timing = orderTiming(o, now: now)
        let promise = OrdersLogic.promise(o, now: now)
        var day = ""
        var words = ""
        var tone = Tone.quiet
        if let due = timing.due {
            day = OrdersLogic.dueDay(due)
            words = "Due " + day
            if OrdersLogic.isOpen(o) {
                let urgent = promise.chase && (timing.state == .late || timing.state == .today || promise.urgent)
                if urgent {
                    let said = PromiseWords.say(timing)
                    words = said.text
                    tone = said.tone
                }
            }
        }
        let what = OrdersLogic.cardWhat(o)
        let promised = (o.promisedDate ?? "").trimmingCharacters(in: .whitespaces)

        id = o.id
        customer = OrdersLogic.customerName(o)
        createdAt = o.createdAt
        self.stage = stage
        stageRank = MacOrdersLogic.stageRank(stage)
        stageWords = MacOrdersLogic.words(o, stage: stage)
        stageTone = MacOrdersLogic.tone(stage)
        promisedKey = promised.isEmpty ? "9999-12-31" : promised
        promisedDay = day
        promisedWords = words
        promisedTone = tone
        promisedHelp = OrdersLogic.promiseLine(o, now: now)
        pieces = o.items.count
        karigars = MacOrdersLogic.karigarNames(o, names: names)
        worth = MacOrdersLogic.worth(o, invoice: invoice)
        advance = MacOrdersLogic.paid(o)
        owed = MacOrdersLogic.owed(o, stage: stage, invoiceOwed: invoiceOwed)
        self.what = what.text + (what.extra.map { " " + $0 } ?? "")
        takenBy = o.takenBy ?? ""
    }
}

/// A column of the board: one stage and the orders in it.
struct MacOrdersBoardColumn: Identifiable {
    let stage: OrderStage
    let title: String
    let rows: [MacOrdersListRow]
    let worth: Double
    var id: String { stage.rawValue }
}

/// Everything the table, the board and the summary bar read, worked out once per change of the books.
struct MacOrdersBase {
    var rows: [MacOrdersListRow] = []
    /// The board: the stages being worked, then Done and Cancelled (folded away).
    var working: [MacOrdersBoardColumn] = []
    var closed: [MacOrdersBoardColumn] = []
    var worth = 0.0
    var owed = 0.0
    /// The counter names Taken by offers.
    var people: [String] = []
}

extension MacOrdersLogic {
    /// The stages the board shows as columns (Awaiting transfer joins them when any order is in it).
    static let boardStages: [OrderStage] = [.new, .karigar, .ready, .payment]

    @MainActor
    static func base(orders: [Order], invoices: [Invoice], karigars: [Karigar], localStatus: [String: String],
                     query: String, takenBy: String, list: String?, now: Date) -> MacOrdersBase {
        let owedOn = OrdersLogic.owedOnInvoices(invoices)
        var byInvoice: [String: Invoice] = [:]
        for inv in invoices where byInvoice[inv.id] == nil { byInvoice[inv.id] = inv }
        var names: [String: String] = [:]
        for k in karigars where names[k.id] == nil { names[k.id] = k.name }

        let scoped = MacLists.orders(orders, list: list, invoices: invoices, now: now)
        var out = MacOrdersBase()
        var people = Set<String>()
        for o in orders { if let by = o.takenBy, !by.isEmpty { people.insert(by) } }
        out.people = people.sorted()

        var rows: [MacOrdersListRow] = []
        rows.reserveCapacity(scoped.count)
        for o in scoped {
            if !takenBy.isEmpty && o.takenBy != takenBy { continue }
            if !OrdersLogic.matches(o, query) { continue }
            let invoice = o.invoiceId.flatMap { byInvoice[$0] }
            let st = stage(o, owedOn: owedOn, local: localStatus[o.id])
            rows.append(MacOrdersListRow(o, stage: st, invoice: invoice, invoiceOwed: OrdersLogic.owed(o, owedOn), names: names, now: now))
        }
        out.rows = rows
        for r in rows where r.stage != .closed {
            out.worth += r.worth
            out.owed += max(r.owed, 0)
        }

        var byStage: [OrderStage: [MacOrdersListRow]] = [:]
        for r in rows { byStage[r.stage, default: []].append(r) }
        func column(_ st: OrderStage) -> MacOrdersBoardColumn {
            // Soonest promised first; the same day, newest taken first.
            let inColumn = (byStage[st] ?? []).sorted { a, b in
                a.promisedKey == b.promisedKey ? a.createdAt > b.createdAt : a.promisedKey < b.promisedKey
            }
            let title = st == .closed ? "Cancelled or refunded" : (STAGES[st]?.title ?? st.rawValue)
            return MacOrdersBoardColumn(stage: st, title: title, rows: inColumn, worth: inColumn.reduce(0) { $0 + $1.worth })
        }
        var stages = boardStages
        if !(byStage[.transfer] ?? []).isEmpty { stages.insert(.transfer, at: 0) }
        out.working = stages.map(column)
        out.closed = [column(.done), column(.closed)]
        return out
    }
}

// MARK: The writes the place makes itself

/// The status and piece moves, as the hub's cards and the order page make them: the same Outbox ops with the same
/// fields (OrdersHub.setStatus, OrderScreen.tick / assign), because those are private to their screens' state.
@MainActor
enum MacOrdersWrites {
    static func setStatus(_ order: Order, _ status: String) {
        Outbox.shared.send(op: "setOrderStatus", fields: ["orderId": order.id, "status": status],
                           business: House.business, label: "\(order.id) status")
    }

    static func tick(_ order: Order, _ index: Int, _ done: Bool) {
        Outbox.shared.send(op: "setPieceDone", fields: ["orderId": order.id, "index": index, "done": done],
                           business: House.business, label: "\(order.id) piece \(index + 1)")
    }

    static func assign(_ order: Order, _ index: Int, _ karigarId: String) {
        Outbox.shared.send(op: "setPieceKarigar", fields: ["orderId": order.id, "index": index, "karigarId": karigarId],
                           business: House.business, label: "\(order.id) karigar")
    }
}
#endif
