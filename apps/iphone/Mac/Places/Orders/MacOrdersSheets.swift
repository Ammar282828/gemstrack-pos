#if os(macOS)
import SwiftUI
import ERPCore

// The short modal tasks an order's actions open (docs/features/mac-design.md, rule 7): take an advance, book the
// courier, track a parcel, message the customer, check a transfer. Each is the iPhone's own sheet, shown at a Mac sheet's
// size from one `.sheet(item:)` on the place or the record window; none opens another sheet.

enum MacOrdersSheet: Identifiable {
    case advance(Order)
    case courier(Order)
    case tracking(Order)
    case notify(Order)
    case leopards(Order)
    case transfer(Order)
    case lapse(Order)

    var id: String {
        switch self {
        case .advance(let o): return "advance-" + o.id
        case .courier(let o): return "courier-" + o.id
        case .tracking(let o): return "tracking-" + o.id
        case .notify(let o): return "notify-" + o.id
        case .leopards(let o): return "leopards-" + o.id
        case .transfer(let o): return "transfer-" + o.id
        case .lapse(let o): return "lapse-" + o.id
        }
    }
}

/// An advance on an order: the payment sheet with the order's own writes (`OrderAdvance.record`, and `settle` for a
/// remainder under 5,000 given off), as the order page and the hub's card take it.
struct MacOrdersAdvanceSheet: View {
    let order: Order
    /// What was recorded (the amount and the gold rows), once it has gone through.
    let done: (Double, [[String: Any]]) -> Void

    var body: some View {
        let balance = OrdersLogic.balance(order)
        PaymentSheet(title: "Advance on \(order.id)", owed: owesMoney(balance) ? balance : nil, note: "Advance payment received",
                     settle: { amount, method, _, note, remainder in
                         try await OrderAdvance.settle(order, amount: amount, method: method, note: note, remainder: remainder)
                         await MainActor.run { done(amount, []) }
                     }) { amount, method, note, exchanges in
            try await OrderAdvance.record(order, amount: amount, method: method, note: note, exchanges: exchanges)
            await MainActor.run { done(amount, exchanges) }
        }
        .ordersMacSheet(width: 460, height: 560)
    }
}

/// The sheet a `MacOrdersSheet` names.
struct MacOrdersSheetContent: View {
    let sheet: MacOrdersSheet
    let advanced: (Double, [[String: Any]]) -> Void
    let moved: (OnlineMoveSheet.Kind, OnlineTold) -> Void

    var body: some View {
        switch sheet {
        case .advance(let o):
            MacOrdersAdvanceSheet(order: o, done: advanced)
        case .courier(let o):
            OrderCourierSheet(order: o)
        case .tracking(let o):
            OrderTrackingSheet(order: o)
        case .notify(let o):
            OrderNotifySheet(order: o)
        case .leopards(let o):
            OrderLeopardsSheet(order: o)
        case .transfer(let o):
            OnlineMoveSheet(order: o, kind: .paid) { t in moved(.paid, t) }
        case .lapse(let o):
            OnlineMoveSheet(order: o, kind: .lapse) { t in moved(.lapse, t) }
        }
    }
}

extension View {
    /// The order sheets, from one binding.
    func macOrdersSheets(_ sheet: Binding<MacOrdersSheet?>,
                         advanced: @escaping (Double, [[String: Any]]) -> Void,
                         moved: @escaping (OnlineMoveSheet.Kind, OnlineTold) -> Void) -> some View {
        self.sheet(item: sheet) { (s: MacOrdersSheet) in
            MacOrdersSheetContent(sheet: s, advanced: advanced, moved: moved)
        }
    }
}
#endif
