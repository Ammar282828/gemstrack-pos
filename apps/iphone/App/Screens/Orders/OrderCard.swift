import SwiftUI
import ERPCore

// An order on the hub: a card of two List rows. The first (who it is for, when it was promised, what it
// is, where it stands and what is owed) opens the order; the second carries the card's one next step
// (components/order/next-step.tsx). Two rows rather than one, because a row that holds both a link
// and buttons answers every tap with all of them; here each row has one kind of control.
//
// The card reads as the ledger does (App/UI/Ledger.swift, 2026-10-09): the person first, the promise
// beside them, the stage as a track rather than a pair of coloured words, the money on the right, and the
// order's number as the quiet line underneath, for finding it again.

/// Calling or writing to the customer from a card's swipe.
enum OrderContactKind {
    case call, whatsApp
}

/// What the hub does with a card. The hub owns the state and the writes.
struct OrderCardActions {
    var advance: (Order) -> Void
    var markReady: (Order) -> Void
    var setStatus: (Order, String) -> Void
    var openWeb: (OrdersWebTarget) -> Void
    /// Call or WhatsApp the customer on the order's number.
    var contact: (Order, OrderContactKind) -> Void
}

/// The card's own leading edge, which the next-step row lines up under: the row's inset, the monogram, the gap.
private enum OrderCardMetrics {
    static let inset: CGFloat = 16
    static let monogram: CGFloat = 40
    static let gap: CGFloat = 12
    static var textColumn: CGFloat { inset + monogram + gap }
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
    private var step: OrderNextStep? { OrdersLogic.nextStep(order, stage: stage, owed: owed) }

    private var canAdvance: Bool { OrdersLogic.offersAdvance(order, stage: stage, isOwner: isOwner) }

    private var hasPhone: Bool { !CustomerKit.dialable(order.customerContact).isEmpty }

    var body: some View {
        NavigationLink(value: Route(path: "/orders/\(order.id)")) {
            OrderCardHead(order: order, stage: stage, owed: owed, now: now, greyed: greyed, mine: mine)
        }
        // The row's own leading inset, so the step row below lines up under the name on every width.
        .listRowInsets(EdgeInsets(top: 10, leading: OrderCardMetrics.inset, bottom: step != nil ? 6 : 10, trailing: 16))
        .listRowSeparator(step != nil ? .hidden : .automatic, edges: .bottom)
        .mineRow(mine)
        .swipeActions(edge: .leading, allowsFullSwipe: false) { reach }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { swipe }
        .contextMenu { menu }

        if let step {
            OrderNextStepRow(order: order, step: step, canAdvance: canAdvance, busy: busy, actions: actions)
                .listRowSeparator(.hidden, edges: .top)
                .listRowInsets(EdgeInsets(top: 0, leading: OrderCardMetrics.textColumn, bottom: 12, trailing: 16))
                // Its own row, so it is lit with the card above it.
                .mineRow(mine)
        }
    }

    /// Swiped from the left: the customer, on the order's number.
    @ViewBuilder
    private var reach: some View {
        if hasPhone {
            Button { actions.contact(order, .call) } label: { Label("Call", systemImage: "phone.fill") }
                .tint(Tone.settled.color)
            Button { actions.contact(order, .whatsApp) } label: { Label("WhatsApp", systemImage: "message.fill") }
                .tint(Tone.credit.color)
        }
    }

    /// Swiped from the right: the money and the bench.
    @ViewBuilder
    private var swipe: some View {
        if canAdvance {
            // Not the accent: a swipe's words are white, which Taheri's light dark-mode gold does not carry.
            Button { actions.advance(order) } label: { Label("Advance", systemImage: "creditcard") }
                .tint(Tone.working.color)
        }
        if stage == .karigar {
            Button { actions.markReady(order) } label: { Label("Ready", systemImage: "checkmark.circle") }
                .tint(Tone.settled.color)
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
        if hasPhone {
            Button { actions.contact(order, .call) } label: { Label("Call", systemImage: "phone") }
            Button { actions.contact(order, .whatsApp) } label: { Label("WhatsApp", systemImage: "message") }
        }
        Button { actions.openWeb(.orderPage(order.id)) } label: { Label("Open in the ERP", systemImage: "globe") }
    }
}

/// The card's face:
///   who it is for                       the promise, when it presses
///   what it is
///   the stage track · pieces done        what is still owed
///   ORD-… · Taken today · Online · You
struct OrderCardHead: View {
    let order: Order
    let stage: OrderStage
    /// What the order's invoice still has owing.
    let owed: Double
    let now: Date
    let greyed: Bool
    let mine: Bool

    var body: some View {
        let name = OrdersLogic.customerName(order)
        HStack(alignment: .top, spacing: OrderCardMetrics.gap) {
            Monogram(name: name, size: OrderCardMetrics.monogram)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(name)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    // The promise keeps its words; a long name gives way first.
                    promise.fixedSize()
                }
                whatLine
                standing
                quietLine
            }
        }
        .opacity(greyed ? 0.55 : 1)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    // MARK: When

    /// Late, today or inside the bench week: a pill in the promise's tone. Otherwise the day, quietly, while the
    /// order is still open; nothing once it is invoiced or closed (its promise is history).
    @ViewBuilder
    private var promise: some View {
        let t = orderTiming(order, now: now)
        let p = OrdersLogic.promise(order, now: now)
        if OrdersLogic.isOpen(order), let due = t.due {
            if p.chase && (t.state == .late || t.state == .today || p.urgent) {
                let said = PromiseWords.say(t)
                Pill(said.text, tone: said.tone)
            } else {
                Text("Due " + OrdersLogic.dueDay(due))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    // MARK: What

    private var whatLine: some View {
        let what = OrdersLogic.cardWhat(order)
        return HStack(spacing: 4) {
            Text(what.text)
                .lineLimit(1)
            if let extra = what.extra {
                Text(extra)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    // MARK: Where it stands, and what is owed

    private var standing: some View {
        let counts = pieceCounts(order.items)
        return HStack(alignment: .center, spacing: 8) {
            if stage == .closed {
                Pill(order.status.rawValue.isEmpty ? "Closed" : order.status.rawValue, tone: .quiet)
            } else {
                StageTrack(stage: stage)
                    .frame(width: 96)
                if counts.total > 0 {
                    Text("\(counts.done) of \(counts.total) done")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .lineLimit(1)
                }
                // Amber, not red: a piece nobody has yet is work to hand out, not a promise missed.
                if counts.unassigned > 0 && !greyed && order.status != .completed {
                    Text("\(counts.unassigned) unassigned")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Tone.owed.color)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            money.fixedSize()
        }
    }

    /// The order's balance until it is invoiced, then what its invoice still asks for; Paid once nothing is
    /// owed. A cancelled or refunded order owes nothing to show.
    @ViewBuilder
    private var money: some View {
        if stage != .closed {
            let due = OrdersLogic.stillOwed(order, invoiceOwed: owed)
            if due > 0.5 {
                VStack(alignment: .trailing, spacing: 0) {
                    RowAmount(amount: due)
                    Text("due")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else if due < -0.5 {
                VStack(alignment: .trailing, spacing: 0) {
                    RowAmount(amount: -due, tone: Tone.credit.color)
                    Text("in credit")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Pill("Paid", tone: .settled)
            }
        }
    }

    // MARK: For finding it again

    private var quietLine: some View {
        HStack(spacing: 6) {
            Text(order.id + " · Taken " + ShopDate.say(order.createdAt))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .monospacedDigit()
                .lineLimit(1)
            if OrdersLogic.isOnline(order) { OrdersOnlineBadge() }
            if mine { MineTag() }
        }
    }
}

/// The one thing to do next (OrdersLogic.nextStep), as one filled capsule, and an Advance beside it on any
/// order still being made (owners). An invoiced order's step is a quiet link to its invoice: money is taken
/// there only.
struct OrderNextStepRow: View {
    let order: Order
    let step: OrderNextStep
    let canAdvance: Bool
    let busy: Bool
    let actions: OrderCardActions

    /// The invoice an invoiced order's step points at, and what it still has owing.
    private var invoiced: (id: String, owed: Double)? {
        if case let .invoice(id, owed) = step { return (id, owed) }
        return nil
    }

    var body: some View {
        if let inv = invoiced {
            NavigationLink(value: Route(path: "/invoices/\(inv.id)")) {
                invoiceLink(inv.id, owed: inv.owed)
            }
        } else {
            HStack(spacing: 10) {
                primary
                Spacer(minLength: 0)
                if canAdvance { advanceButton }
            }
        }
    }

    private func invoiceLink(_ invoiceId: String, owed: Double) -> some View {
        HStack {
            Label("Invoiced · \(invoiceId)", systemImage: "doc.text")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if owed > 0.5 {
                Text(Money.pkr(owed) + " owed")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Tone.owed.color)
                    .monospacedDigit()
            }
        }
    }

    @ViewBuilder
    private var primary: some View {
        if busy {
            ProgressView().controlSize(.small)
        } else {
            Button(action: run) { Label(step.title, systemImage: step.symbol) }
                .buttonStyle(.houseProminent)
                .controlSize(.small)
        }
    }

    private func run() {
        switch step {
        case .checkTransfer:
            // The order's own page has the transfer's moves (OrderOnlineSection, and its bar's Check transfer).
            actions.openWeb(OrdersWebTarget(path: "/orders/\(order.id)", title: order.id, native: true))
        case .giveOut:
            actions.openWeb(.orderPage(order.id))
        case .markReady:
            actions.markReady(order)
        case .finalize:
            actions.openWeb(.finalize(order.id))
        case .invoice:
            break
        }
    }

    private var advanceButton: some View {
        Button { actions.advance(order) } label: { Label("Advance", systemImage: "creditcard") }
            .buttonStyle(.borderless)
            .font(.footnote.weight(.medium))
            .tint(.secondary)
            .accessibilityLabel("Record an advance")
    }
}
