import SwiftUI
import ERPCore

// The few views the two Orders screens share. Types here carry the word Order(s) so they cannot
// meet another group's helpers in the one module.

/// A place an Orders button opens: the registry's native screen for its path (the order, the bench, the slip,
/// Finalize, Edit order). Every one is native now, so nothing here opens the ERP's page.
struct OrdersWebTarget: Hashable, Identifiable {
    let path: String
    let title: String
    var id: String { path }

    /// The order's own page (OrderScreen).
    static func order(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)", title: id) }
    /// The native bench, limited to this order: assign a karigar and record the handover separately.
    static func giveOut(_ id: String) -> OrdersWebTarget {
        OrdersWebTarget(path: "/workshop?order=" + WorkshopLogic.piece(id), title: "Give out")
    }
    /// The workshop slip, native: drawn on the ERP's server by the one builder (lib/order-slip-pdf.ts), shown
    /// here and printed or shared from the share sheet (NewOrderRoutes `slipScreen`). The ERP's page still
    /// draws it for `?do=slip`, for an app from before.
    static func slip(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/slip", title: "Slip \(id)") }
    /// Finalize & invoice, native (OrderFinalizeScreen; the web's page reads ?do=finalize for the same dialog).
    static func finalize(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/finalize", title: id) }
    /// New order's form on the order on file (NewOrderEdit).
    static func edit(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/edit", title: "Edit \(id)") }
    /// New order's form (NewOrder).
    static let newOrder = OrdersWebTarget(path: "/orders/add", title: "New order")
}

extension View {
    /// The destination for an `OrdersWebTarget` set by a button.
    func ordersWebDestination(_ target: Binding<OrdersWebTarget?>) -> some View {
        navigationDestination(item: target) { t in
            ScreenRegistry.view(for: t.path)
                .modifier(HouseGround())
        }
    }

    /// The ERP's own words when a write is refused (the kit's `failureAlert`, which also taps an error).
    func ordersFailureAlert(_ message: Binding<String?>, title: String = "Not changed") -> some View {
        failureAlert(message, title: title)
    }
}

/// "Online": an order that came from the website and was confirmed by a person. A quiet label rather than a
/// capsule, so a card keeps to one badge (App/UI/Ledger.swift).
struct OrdersOnlineBadge: View {
    var body: some View {
        Label("Online", systemImage: "globe")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Tone.working.color)
            .lineLimit(1)
    }
}

/// The colours the Orders screens give what they say, from the ledger's tones only.
enum OrdersTone {
    /// The status picker's pill: amber while waiting to start, blue with the karigars, green once finished.
    static func status(_ s: OrderStatus) -> Tone {
        switch s {
        case .pending: return .owed
        case .inProgress: return .working
        case .completed: return .settled
        case .cancelled, .refunded, .unknown: return .quiet
        }
    }
}

extension OrdersLogic.Promise {
    /// The web's colours for a promise (components/shared/promise-line.tsx): red once late, amber on the day and
    /// inside the bench week, quiet once the order is finished or when nothing was promised.
    var tone: Tone {
        if chase && state == .late { return .late }
        if chase && state == .today { return .owed }
        return urgent ? .owed : .quiet
    }
}

/// What the shop earns on an order, blurred until tapped: the counter turns its screen to show a
/// customer the bill, and a margin beside the total is the one thing they must not read off it. The
/// figure is not in the view until it is tapped (shop-margin.tsx MarginFigure). Shop screens only.
struct OrdersMarginRow: View {
    let order: Order
    @State private var shown = false

    var body: some View {
        let m = orderMargin(order, settings: House.margin)
        Button {
            shown.toggle()
        } label: {
            HStack {
                Label("We earn", systemImage: "lock.fill")
                    .foregroundStyle(.secondary)
                Spacer()
                Text(shown ? OrdersLogic.marginWords(m, settings: House.margin) : "00.0% · PKR 00,000")
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(tone(m))
                    .blur(radius: shown ? 0 : 5)
            }
            .font(.subheadline)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(shown ? "Hide our margin" : "Show our margin")
    }

    private func tone(_ m: Margin) -> Color {
        if m.assumed { return .secondary }
        return m.percent < 0 ? Tone.late.color : Tone.settled.color
    }
}

// MARK: An advance that settles the order

/// An order's advance, and the Settle beside it (order-dialogs.tsx RecordAdvanceDialog): the advance as Save takes it
/// (`recordOrderAdvance`), then the remainder added to the order's discount and its balance brought down with it,
/// never a payment that was not made; the invoice made from the order carries the discount (Order to invoice).
/// The web saves that through the store's updateOrder (lib/writes/update-order.ts); the phone sends the same edit
/// through `updateOrder` (/api/app/write runs that very write), each piece sent by its place alone so the stored
/// pieces stay exactly as they are. Owners only, as both writes are.
enum OrderAdvance {
    static func record(_ order: Order, amount: Double, method: String, note: String) async throws {
        _ = try await ERPAPI.shared.write("recordOrderAdvance", [
            "orderId": order.id,
            "amount": amount,
            "method": method,
            "notes": note,
        ])
    }

    static func settle(_ order: Order, amount: Double, method: String, note: String, remainder: Double) async throws {
        try await record(order, amount: amount, method: method, note: note)
        let edit: [String: Any] = [
            "items": order.items.indices.map { ["editIndex": $0] },
            "discountAmount": rupees(order.discountAmount) + remainder,
            // The web's figure; the ERP refuses a negative one, and the remainder came from this same balance.
            "grandTotal": max(0, rupees(order.grandTotal) - rupees(amount) - remainder),
        ]
        do {
            _ = try await ERPAPI.shared.write("updateOrder", ["orderId": order.id, "order": edit])
        } catch {
            throw SettleNotGiven(paid: amount, remainder: remainder, why: error.localizedDescription)
        }
    }
}
