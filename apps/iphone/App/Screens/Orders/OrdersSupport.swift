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

    /// The order's own ERP page: edit, give out, finalize, refund, delete.
    static func orderPage(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)", title: id) }
    /// The same page with the Finalize & invoice dialog open (the page reads ?do=finalize).
    static func finalize(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)?do=finalize", title: id) }
    /// New order's form on the order on file (NewOrderEdit).
    static func edit(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/edit", title: "Edit \(id)", native: true) }
}

extension View {
    /// The destination for an `OrdersWebTarget` set by a button.
    func ordersWebDestination(_ target: Binding<OrdersWebTarget?>) -> some View {
        navigationDestination(item: target) { t in
            if t.native {
                ScreenRegistry.view(for: t.path)
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

/// Paid / Partial / Unpaid, from the one number that already knows (lib/order-payment.ts).
struct OrdersPaymentBadge: View {
    let order: Order

    var body: some View {
        let status = getOrderPaymentStatus(order)
        StatusBadge(status.rawValue, color: color(status))
    }

    private func color(_ s: PaymentStatus) -> Color {
        switch s {
        case .paid: return .green
        case .partial: return .orange
        case .unpaid: return .red
        }
    }
}

/// "Online": an order that came from the website and was confirmed by a person.
struct OrdersOnlineBadge: View {
    var body: some View {
        Label("Online", systemImage: "globe")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(.blue)
            .background(Color.blue.opacity(0.12), in: .capsule)
    }
}

/// The promised date and how it is going, in the web's colours: red when late, orange on the day,
/// red for a bench week, quiet otherwise (components/shared/promise-line.tsx).
struct OrdersPromiseText: View {
    let order: Order
    let now: Date
    var font: Font = .caption

    var body: some View {
        let p = OrdersLogic.promise(order, now: now)
        if p.undated {
            Text("no due date").font(font).foregroundStyle(.secondary)
        } else {
            HStack(spacing: 6) {
                if p.urgent {
                    Text("URGENT")
                        .font(.system(size: 9, weight: .bold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .foregroundStyle(.white)
                        .background(Color.red, in: .rect(cornerRadius: 3))
                }
                Text(line(p))
                    .font(font)
                    .fontWeight(emphasised(p) ? .semibold : .regular)
                    .foregroundStyle(tone(p))
                    .monospacedDigit()
            }
        }
    }

    private func line(_ p: OrdersLogic.Promise) -> String {
        var s: String
        if p.state == .today {
            s = "due today"
        } else {
            s = "due " + day(order.promisedDate)
            if p.showsLabel, !p.label.isEmpty { s += " · " + p.label }
        }
        return s
    }

    /// "Sat 10 Oct", or the word when it is today's, tomorrow's or yesterday's.
    private func day(_ iso: String?) -> String {
        let said = ShopDate.say(iso)
        return ["Today", "Tomorrow", "Yesterday"].contains(said) ? said.lowercased() : said
    }

    private func emphasised(_ p: OrdersLogic.Promise) -> Bool {
        p.chase && (p.state == .late || p.state == .today)
    }

    private func tone(_ p: OrdersLogic.Promise) -> Color {
        if p.chase && p.state == .late { return .red }
        if p.chase && p.state == .today { return .orange }
        return p.urgent ? .red : .secondary
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
        return m.percent < 0 ? .red : .green
    }
}
