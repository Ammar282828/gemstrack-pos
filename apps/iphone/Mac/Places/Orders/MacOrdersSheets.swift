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
    case sendKarigar(Order)
    case leopards(Order)
    case transfer(Order)
    case lapse(Order)
    /// The customer's order PDF from the shop's line (the one Contact order's Send PDF).
    case sendPDF(Order)
    /// The customer's order PDF to read, print or share (never the workshop slip).
    case orderPDF(Order)

    var id: String {
        switch self {
        case .advance(let o): return "advance-" + o.id
        case .courier(let o): return "courier-" + o.id
        case .tracking(let o): return "tracking-" + o.id
        case .notify(let o): return "notify-" + o.id
        case .sendKarigar(let o): return "send-karigar-" + o.id
        case .leopards(let o): return "leopards-" + o.id
        case .transfer(let o): return "transfer-" + o.id
        case .lapse(let o): return "lapse-" + o.id
        case .sendPDF(let o): return "send-pdf-" + o.id
        case .orderPDF(let o): return "order-pdf-" + o.id
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
        .ordersMacSheet(width: 460, height: 520)
    }
}

/// The sheet a `MacOrdersSheet` names.
struct MacOrdersSheetContent: View {
    let sheet: MacOrdersSheet
    let advanced: (Double, [[String: Any]]) -> Void
    let moved: (OnlineMoveSheet.Kind, OnlineTold) -> Void
    var sent: (String) -> Void = { _ in }

    @Environment(Session.self) private var session

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
        case .sendKarigar(let o):
            SendToKarigarSheet(order: o)
        case .leopards(let o):
            OrderLeopardsSheet(order: o)
        case .transfer(let o):
            OnlineMoveSheet(order: o, kind: .paid) { t in moved(.paid, t) }
        case .lapse(let o):
            OnlineMoveSheet(order: o, kind: .lapse) { t in moved(.lapse, t) }
        case .sendPDF(let o):
            SendDocSheet(doc: .order(o, byCustomer: session.shop.invoiceByCustomer),
                         phone: MacContact.number(o.customerContact, customerId: o.customerId, customerName: o.customerName),
                         customerName: o.customerName, sent: sent)
                .frame(minWidth: 440, idealWidth: 480, minHeight: 240)
        case .orderPDF(let o):
            let doc = CustomerDoc.order(o, byCustomer: session.shop.invoiceByCustomer)
            MacInvoicePDFSheet(target: InvoicePDFTarget(path: doc.pdfPath, fileName: doc.fileName, title: o.id))
        }
    }
}

extension View {
    /// The order sheets, from one binding.
    func macOrdersSheets(_ sheet: Binding<MacOrdersSheet?>,
                         advanced: @escaping (Double, [[String: Any]]) -> Void,
                         moved: @escaping (OnlineMoveSheet.Kind, OnlineTold) -> Void,
                         sent: @escaping (String) -> Void = { _ in }) -> some View {
        self.sheet(item: sheet) { (s: MacOrdersSheet) in
            MacOrdersSheetContent(sheet: s, advanced: advanced, moved: moved, sent: sent)
        }
    }
}
#endif
