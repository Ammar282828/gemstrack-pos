import SwiftUI
import ERPCore

// An order on the hub: a card of two List rows. The first (the order, with what it is, who it is
// for, its promise, its balance) opens the order; the second carries the card's one next step
// (components/order/next-step.tsx). Two rows rather than one, because a row that holds both a link
// and buttons answers every tap with all of them; here each row has one kind of control.

/// What the hub does with a card. The hub owns the state and the writes.
struct OrderCardActions {
    var advance: (Order) -> Void
    var markReady: (Order) -> Void
    var setStatus: (Order, String) -> Void
    var openWeb: (OrdersWebTarget) -> Void
}

struct OrderCardRows: View {
    let order: Order
    let stage: OrderStage
    /// What the order's invoice still has owing.
    let owed: Double
    let now: Date
    let isOwner: Bool
    /// Taken by the signed-in person: the card is lit in place (docs/decisions.md "Signed-in defaults").
    let mine: Bool
    let busy: Bool
    let actions: OrderCardActions

    /// Invoiced, paid or not, is greyed (owner, 2026-10-06): the order's work is done and its money is the invoice's.
    private var greyed: Bool { OrdersLogic.hasInvoice(order) || stage == .done }

    /// Every stage but done and closed has its one action, and an invoiced order its quiet link.
    private var hasStep: Bool {
        OrdersLogic.hasInvoice(order) || stage == .transfer || stage == .new || stage == .karigar || stage == .ready
    }

    private var canAdvance: Bool {
        isOwner && OrdersLogic.making(stage) && OrdersLogic.canAdvance(order)
    }

    var body: some View {
        NavigationLink(value: Route(path: "/orders/\(order.id)")) {
            OrderCardHead(order: order, now: now, greyed: greyed)
        }
        .listRowSeparator(hasStep ? .hidden : .automatic, edges: .bottom)
        .mineRow(mine)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { swipe }
        .contextMenu { menu }

        if hasStep {
            OrderNextStepRow(order: order, stage: stage, owed: owed, canAdvance: canAdvance, busy: busy, actions: actions)
                .listRowSeparator(.hidden, edges: .top)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 10, trailing: 16))
                // Its own row, so it is lit with the card above it.
                .mineRow(mine)
        }
    }

    @ViewBuilder
    private var swipe: some View {
        if canAdvance {
            Button { actions.advance(order) } label: { Label("Advance", systemImage: "creditcard") }
                .tint(.indigo)
        }
        if stage == .karigar {
            Button { actions.markReady(order) } label: { Label("Ready", systemImage: "checkmark.circle") }
                .tint(.green)
        }
    }

    @ViewBuilder
    private var menu: some View {
        if canAdvance {
            Button { actions.advance(order) } label: { Label("Record an advance", systemImage: "creditcard") }
        }
        if stage == .karigar {
            Button { actions.markReady(order) } label: { Label("Mark ready", systemImage: "checkmark.circle") }
        }
        Menu {
            ForEach(OrdersLogic.settableStatuses, id: \.self) { s in
                Button { actions.setStatus(order, s) } label: {
                    if s == order.status.rawValue { Label(s, systemImage: "checkmark") } else { Text(s) }
                }
            }
        } label: {
            Label("Set status", systemImage: "arrow.triangle.2.circlepath")
        }
        Button { actions.openWeb(.orderPage(order.id)) } label: { Label("Open in the ERP", systemImage: "globe") }
    }
}

/// The card's face: id and badges, what it is, who for, balance, promise, and the pieces' progress.
struct OrderCardHead: View {
    let order: Order
    let now: Date
    let greyed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            topLine
            Text(OrdersLogic.whatIsIt(order))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            customerLine
            moneyLine
            OrdersPromiseText(order: order, now: now)
            progress
        }
        .opacity(greyed ? 0.55 : 1)
        .padding(.vertical, 2)
    }

    private var topLine: some View {
        HStack(spacing: 8) {
            Text(order.id)
                .font(.headline)
                .monospacedDigit()
            Spacer(minLength: 4)
            OrdersPaymentBadge(order: order)
            StatusBadge(order: order.status)
        }
    }

    private var customerLine: some View {
        HStack(spacing: 6) {
            Text(OrdersLogic.customerName(order))
                .lineLimit(1)
            if let phone = order.customerContact, !phone.isEmpty {
                Text(phone)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if OrdersLogic.isOnline(order) { OrdersOnlineBadge() }
        }
        .font(.subheadline)
    }

    private var moneyLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("Taken " + ShopDate.say(order.createdAt))
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text("Balance")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(Money.pkr(order.grandTotal))
                .font(.headline)
                .monospacedDigit()
        }
    }

    @ViewBuilder
    private var progress: some View {
        let counts = pieceCounts(order.items)
        if counts.total > 0 {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text("\(counts.done) of \(counts.total) done")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if counts.unassigned > 0 && order.status != .completed {
                        Text("\(counts.unassigned) unassigned")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.red)
                    }
                }
                ProgressView(value: Double(counts.done), total: Double(counts.total))
            }
        }
    }
}

/// The one thing to do next (components/order/next-step.tsx):
///   Awaiting transfer  Check transfer (the ERP's page: the slips, Transfer received, Let it lapse)
///   Not started        Give out (the ERP's page: the karigar pickers)
///   With karigars      Mark ready (Completed, every piece ticked)
///   Ready to hand over Finalize & invoice (the ERP's page, with the dialog open)
///   Invoiced           nothing to do here: money is taken on the invoice only, so a quiet link to it
/// and an Advance from any order still being made (owners).
struct OrderNextStepRow: View {
    let order: Order
    let stage: OrderStage
    let owed: Double
    let canAdvance: Bool
    let busy: Bool
    let actions: OrderCardActions

    var body: some View {
        if let invoiceId = order.invoiceId, !invoiceId.isEmpty {
            NavigationLink(value: Route(path: "/invoices/\(invoiceId)")) {
                invoiceLink(invoiceId)
            }
        } else {
            HStack(spacing: 10) {
                primary
                Spacer(minLength: 0)
                if canAdvance { advanceButton }
            }
        }
    }

    private func invoiceLink(_ invoiceId: String) -> some View {
        HStack {
            Text("Invoiced · \(invoiceId)")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if owed > 0.5 {
                Text(Money.pkr(owed) + " owed")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.orange)
                    .monospacedDigit()
            }
        }
    }

    private var slipIn: Bool { order.website?.paymentStatus == .slipSent }

    @ViewBuilder
    private var primary: some View {
        switch stage {
        case .transfer:
            stepButton(slipIn ? "Slip in: check" : "Check transfer", symbol: "banknote", prominent: slipIn) {
                actions.openWeb(.orderPage(order.id))
            }
        case .new:
            stepButton("Give out", symbol: "person.badge.plus", prominent: true) {
                actions.openWeb(.orderPage(order.id))
            }
        case .karigar:
            if busy {
                ProgressView().controlSize(.small)
            } else {
                stepButton("Mark ready", symbol: "checkmark.circle", prominent: false) {
                    actions.markReady(order)
                }
            }
        case .ready:
            stepButton("Finalize & invoice", symbol: "doc.text", prominent: true) {
                actions.openWeb(.finalize(order.id))
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func stepButton(_ title: String, symbol: String, prominent: Bool, action: @escaping () -> Void) -> some View {
        if prominent {
            Button(action: action) { Label(title, systemImage: symbol) }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        } else {
            Button(action: action) { Label(title, systemImage: symbol) }
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
    }

    private var advanceButton: some View {
        Button { actions.advance(order) } label: { Label("Advance", systemImage: "creditcard") }
            .buttonStyle(.borderless)
            .font(.footnote)
            .tint(.secondary)
            .accessibilityLabel("Record an advance")
    }
}
