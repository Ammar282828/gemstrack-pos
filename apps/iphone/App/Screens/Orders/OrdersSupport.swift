import SwiftUI
import ERPCore

// The few views the two Orders screens share. Types here carry the word Order(s) so they cannot
// meet another group's helpers in the one module.

/// An ERP page to open inside the app, whatever the registry would do with its path. The registry
/// ignores a query (ScreenRoute.bare), so "/orders/ORD-1?web=1" would come back to the native order
/// screen; pushing WebScreen directly is what reaches the ERP's own page.
struct OrdersWebTarget: Hashable, Identifiable {
    let path: String
    let title: String
    /// A place with a native screen of its own (Edit order): the registry's screen, not the ERP's page.
    var native = false
    var id: String { path }

    /// Explicit access to the order's full ERP page.
    static func orderPage(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)", title: id) }
    /// The native bench, limited to this order: assign a karigar and record the handover separately.
    static func giveOut(_ id: String) -> OrdersWebTarget {
        OrdersWebTarget(path: "/workshop?order=" + WorkshopLogic.piece(id), title: "Give out", native: true)
    }
    /// The workshop slip, native: drawn on the ERP's server by the one builder (lib/order-slip-pdf.ts), shown
    /// here and printed or shared from the share sheet (NewOrderRoutes `slipScreen`). The ERP's page still
    /// draws it for `?do=slip`, for an app from before.
    static func slip(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/slip", title: "Slip \(id)", native: true) }
    /// Finalize & invoice, native (OrderFinalizeScreen; the web's page reads ?do=finalize for the same dialog).
    static func finalize(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/finalize", title: id, native: true) }
    /// New order's form on the order on file (NewOrderEdit).
    static func edit(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/edit", title: "Edit \(id)", native: true) }
}

extension View {
    /// The destination for an `OrdersWebTarget` set by a button.
    func ordersWebDestination(_ target: Binding<OrdersWebTarget?>) -> some View {
        navigationDestination(item: target) { t in
            if t.native {
                ScreenRegistry.view(for: t.path)
                    .modifier(HouseGround())
            } else {
                WebScreen(path: t.path)
                    .navigationTitle(t.title)
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    /// The ERP's own words when a write is refused.
    func ordersFailureAlert(_ message: Binding<String?>, title: String = "Not changed") -> some View {
        modifier(OrdersFailureAlert(message: message, title: title))
    }
}

private struct OrdersFailureAlert: ViewModifier {
    @Binding var message: String?
    let title: String

    func body(content: Content) -> some View {
        content.alert(title, isPresented: shown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    private var shown: Binding<Bool> {
        Binding(get: { message != nil }, set: { if !$0 { message = nil } })
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
