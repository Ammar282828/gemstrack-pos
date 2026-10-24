import SwiftUI
import ERPCore

// An order on the hub: a card of two List rows. The first (who it is for, when it was promised, what it
// is, where it stands and what is owed) opens the order; the second carries the card's one next step
// (components/order/next-step.tsx). Two rows rather than one, because a row that holds both a link
// and buttons answers every tap with all of them; here each row has one kind of control.
//
// The customer and order number lead. Status, money and the promise get separate space, so a narrow
// phone never squeezes progress counts into ellipses. The detail page holds the complete stage track.

/// Calling or writing to the customer from a card's swipe.
enum OrderContactKind {
    case call, whatsApp
}

/// What the hub does with a card. The hub owns the state and the writes.
struct OrderCardActions {
    var advance: (Order) -> Void
    var markReady: (Order) -> Void
    var setStatus: (Order, String) -> Void
    /// Opens one of the order's native places: the order itself, the bench, Finalize.
    var open: (OrdersWebTarget) -> Void
    /// Call or WhatsApp the customer on the order's number.
    var contact: (Order, OrderContactKind) -> Void
}

/// The card's own leading edge, which the next-step row lines up under: the row's inset, the monogram, the gap.
private enum OrderCardMetrics {
    static let inset: CGFloat = 16
    static let monogram: CGFloat = Monogram.Size.row
    static let gap: CGFloat = 12
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
    var standalone = false
    /// The hub grouped by stage already says the stage in the heading: the card keeps only its bars then.
    var showsStage = true

    /// Invoiced, paid or not, is greyed (owner, 2026-10-06): the order's work is done and its money is the invoice's.
    private var greyed: Bool { OrdersLogic.hasInvoice(order) || stage == .done }

    /// Every stage but done and closed has its one action, and an invoiced order its quiet link.
    private var step: OrderNextStep? { OrdersLogic.nextStep(order, stage: stage, owed: owed) }

    private var canAdvance: Bool { OrdersLogic.offersAdvance(order, stage: stage, isOwner: isOwner) }

    private var hasPhone: Bool { !CustomerKit.dialable(order.customerContact).isEmpty }

    var body: some View {
      if standalone {
        VStack(spacing: 12) {
            NavigationLink(value: Route(path: "/orders/\(order.id)")) {
                OrderCardHead(order: order, stage: stage, owed: owed, now: now, greyed: greyed, mine: mine, showsStage: showsStage)
            }
            .buttonStyle(.plain)
            .zoomSource(id: "/orders/\(order.id)")
            Divider()
            HStack(spacing: 8) {
                if let step {
                    OrderNextStepRow(order: order, step: step, canAdvance: canAdvance, busy: busy, actions: actions, showsAdvanceMenu: false)
                } else { Spacer(minLength: 0) }
                Menu { menu } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                    .buttonStyle(.borderless).accessibilityLabel("Actions for \(order.id)")
            }
        }
        .ledgerCard(padding: 20)
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Theme.accent.opacity(mine ? 0.22 : 0.08), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .pointerHover(.rect(cornerRadius: Radius.card, style: .continuous))
        .contextMenu { menu }
      } else {
        NavigationLink(value: Route(path: "/orders/\(order.id)")) {
            OrderCardHead(order: order, stage: stage, owed: owed, now: now, greyed: greyed, mine: mine, showsStage: showsStage)
        }
        .zoomSource(id: "/orders/\(order.id)")
        // The row's own leading inset, so the step row below lines up under the name on every width.
        .listRowInsets(EdgeInsets(top: 16, leading: OrderCardMetrics.inset, bottom: 12, trailing: 16))
        .listRowSeparator(step != nil ? .hidden : .automatic, edges: .bottom)
        .listRowBackground(Theme.card)
        .swipeActions(edge: .leading, allowsFullSwipe: false) { reach }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { swipe }
        .contextMenu { menu }

        if let step {
            OrderNextStepRow(order: order, step: step, canAdvance: canAdvance, busy: busy, actions: actions)
                .listRowSeparator(.hidden, edges: .top)
                .listRowInsets(EdgeInsets(top: 4, leading: OrderCardMetrics.inset, bottom: 12, trailing: 16))
                .listRowBackground(Theme.card)
        }
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
            Button { actions.advance(order) } label: { Label("Advance", systemImage: "banknote") }
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
            Button { actions.advance(order) } label: { Label("Record an advance", systemImage: "banknote") }
        }
        if stage == .karigar {
            Button { actions.markReady(order) } label: { Label("Mark ready", systemImage: "checkmark.circle") }
        }
        Menu {
            ForEach(OrdersLogic.settableStatuses, id: \.self) { s in
                Button(role: s == "Cancelled" ? .destructive : nil) { actions.setStatus(order, s) } label: {
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
    }
}

/// The card's summary. Complete piece, payment and contact details remain on the order.
struct OrderCardHead: View {
    let order: Order
    let stage: OrderStage
    let owed: Double
    let now: Date
    let greyed: Bool
    let mine: Bool
    var showsStage = true
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let counts = pieceCounts(order.items)
        let wide = !typeSize.isAccessibilitySize
        VStack(alignment: .leading, spacing: 10) {
            // Who first, and what is owed beside them; the name takes two lines before the sum gives way.
            let layout = wide
                ? AnyLayout(HStackLayout(alignment: .top, spacing: 12))
                : AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            layout {
                HStack(alignment: .top, spacing: 12) {
                    Monogram(name: OrdersLogic.customerName(order), size: Monogram.Size.row)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(OrdersLogic.customerName(order))
                            .font(.headline)
                            .foregroundStyle(greyed ? Color.secondary : Color.primary)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            Text(order.id).font(.caption).foregroundStyle(.secondary)
                            if mine { MineTag() }
                            if OrdersLogic.isOnline(order) { OrdersOnlineBadge() }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                money
                    .layoutPriority(1)
            }
            let what = OrdersLogic.cardWhat(order)
            // One line: the order's page has the pieces in full.
            Text(what.text + (what.extra.map { " \u{00B7} " + $0 } ?? ""))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            stateRow(counts)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// Where it stands (the four bars, and the stage's word unless the heading says it) and the promise.
    @ViewBuilder
    private func stateRow(_ counts: PieceCounts) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        layout {
            if stage != .closed {
                StageTrack(stage: stage)
                    .frame(width: typeSize.isAccessibilitySize ? nil : 88)
            }
            if showsStage || stage == .closed {
                Text(stageWords(counts))
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(stageTone.color)
                    .lineLimit(2)
                    .contentTransition(.numericText())
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
            promise
        }
    }

    private func stageWords(_ counts: PieceCounts) -> String {
        let title = stage == .closed ? order.status.rawValue : (STAGES[stage]?.title ?? stage.rawValue)
        guard counts.total > 0, !greyed, stage != .closed, stage != .done else { return title }
        return title + " \u{00B7} " + (counts.unassigned > 0 ? "\(counts.unassigned) unassigned" : "\(counts.done) of \(counts.total) done")
    }

    private var stageTone: Tone {
        switch stage {
        case .karigar: return .working
        case .ready, .done: return .settled
        case .transfer, .payment: return .owed
        default: return .quiet
        }
    }

    /// Late is red, today amber, anything else a quiet date.
    @ViewBuilder private var promise: some View {
        let timing = orderTiming(order, now: now)
        let promise = OrdersLogic.promise(order, now: now)
        if OrdersLogic.isOpen(order), let due = timing.due {
            let urgent = promise.chase && (timing.state == .late || timing.state == .today || promise.urgent)
            let words = PromiseWords.say(timing)
            Text(urgent ? words.text : "Due " + OrdersLogic.dueDay(due))
                .font(.caption.weight(urgent ? .semibold : .regular))
                .foregroundStyle(urgent ? words.tone.color : Color.secondary)
                .fixedSize()
        }
    }

    /// What is still owed (amber), what is in credit (teal), or Paid in a pill once nothing is.
    @ViewBuilder private var money: some View {
        if stage != .closed {
            let due = OrdersLogic.stillOwed(order, invoiceOwed: owed)
            if abs(due) >= 1 {
                VStack(alignment: wideAlignment, spacing: 2) {
                    RowAmount(amount: abs(due), tone: due < 0 ? Tone.credit.color : Tone.owed.color)
                    Text(due < 0 ? "In credit" : "Owed")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
            } else {
                Pill("Paid", tone: .settled)
            }
        }
    }

    private var wideAlignment: HorizontalAlignment { typeSize.isAccessibilitySize ? .leading : .trailing }
}

/// One visible next action, with secondary money actions in the overflow menu. An invoiced order
/// links to its invoice, where payments are taken.
struct OrderNextStepRow: View {
    let order: Order
    let step: OrderNextStep
    let canAdvance: Bool
    let busy: Bool
    let actions: OrderCardActions
    var showsAdvanceMenu = true

    /// The invoice an invoiced order's step points at, and what it still has owing.
    private var invoiced: (id: String, owed: Double)? {
        if case let .invoice(id, owed) = step { return (id, owed) }
        return nil
    }

    var body: some View {
        if let inv = invoiced {
            NavigationLink(value: Route(path: "/invoices/\(inv.id)")) {
                invoiceLink(inv.id)
            }
        } else {
            HStack(spacing: 10) {
                primary
                Spacer(minLength: 0)
                if canAdvance && showsAdvanceMenu {
                    Menu {
                        Button("Record an advance", systemImage: "banknote") { actions.advance(order) }
                    } label: {
                        Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("More order actions")
                }
            }
        }
    }

    private func invoiceLink(_ invoiceId: String) -> some View {
        Label("Invoice \(invoiceId)", systemImage: "doc.text")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Theme.accent)
    }

    @ViewBuilder
    private var primary: some View {
        if busy {
            ProgressView().controlSize(.small)
                .frame(minWidth: 44, minHeight: 44)
        } else {
            // A small tinted capsule, so the card's one action reads as a button and not as more words. Not glass
            // (a glass button under an animated swap shrinks into a blob, iphone-app.md "The bubble").
            Button(action: run) { Label(step.title, systemImage: step.symbol) }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(Theme.accent)
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
    }

    private func run() {
        switch step {
        case .checkTransfer:
            // The order's own page has the transfer's moves (OrderOnlineSection, and its bar's Check transfer).
            actions.open(.order(order.id))
        case .giveOut:
            actions.open(.giveOut(order.id))
        case .markReady:
            actions.markReady(order)
        case .finalize:
            actions.open(.finalize(order.id))
        case .invoice:
            break
        }
    }

}
