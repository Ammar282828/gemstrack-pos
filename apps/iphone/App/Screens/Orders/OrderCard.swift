import SwiftUI
import ERPCore

// An order on the hub: a card of two List rows. The first (who it is for, when it was promised, what it
// is, where it stands and what is owed) opens the order; the second carries the card's one next step
// (components/order/next-step.tsx). Two rows rather than one, because a row that holds both a link
// and buttons answers every tap with all of them; here each row has one kind of control.
//
// The customer and what is owed lead; one quiet line follows (CONVENTIONS rule 15). The detail page holds the
// stage track, the pieces' progress and the contact.

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

/// The card's own leading edge, which the next-step row lines up under: the row's inset, so the step sits under the name.
private enum OrderCardMetrics {
    static let inset: CGFloat = 16
}

struct OrderCardRows: View {
    let order: Order
    let stage: OrderStage
    /// What the order's invoice still has owing.
    let owed: Double
    let now: Date
    let isOwner: Bool
    /// Taken by the signed-in person: a small glyph on the card (docs/decisions.md "Signed-in defaults").
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
            HStack(spacing: 8) {
                if let step {
                    OrderNextStepRow(order: order, step: step, canAdvance: canAdvance, busy: busy, actions: actions, showsAdvanceMenu: false)
                } else { Spacer(minLength: 0) }
                Menu { menu } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                    .buttonStyle(.borderless).accessibilityLabel("Actions for \(order.id)")
            }
        }
        // No rule and no lit edge (CONVENTIONS rule 15): the row's own glyph says whose it is.
        .ledgerCard(padding: 16)
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
    }
}

/// The card's summary in two lines (CONVENTIONS rule 15): who and what is still owed; then what it is, its number,
/// the stage (unless the heading says it) and the promised day, with small glyphs for an online order and one taken
/// by whoever is signed in. One thing is coloured: a missed or today's promise if there is one, else what is owed
/// (amber) or in credit (teal). Paid says nothing. The pieces, the track and the contact are the order's own page.
struct OrderCardHead: View {
    let order: Order
    let stage: OrderStage
    let owed: Double
    let now: Date
    let greyed: Bool
    let mine: Bool
    var showsStage = true

    var body: some View {
        let chase = chasedPromise
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(OrdersLogic.customerName(order))
                    .font(.headline)
                    .foregroundStyle(greyed ? Color.secondary : Color.primary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                money(coloured: chase == nil)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(reference(promised: chase == nil))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if OrdersLogic.isOnline(order) { OrdersOnlineBadge() }
                if mine { MineTag() }
                Spacer(minLength: 8)
                if let chase {
                    Text(chase.text)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(chase.tone.color)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// "Gold ring +1 more · ORD-12 · Making · Due 14 Oct": the quiet line. The day goes here unless it is late or
    /// today, which is the row's coloured word instead.
    private func reference(promised: Bool) -> String {
        let what = OrdersLogic.cardWhat(order)
        var parts = [what.text + (what.extra.map { " \u{00B7} " + $0 } ?? ""), order.id]
        if showsStage || stage == .closed {
            parts.append(stage == .closed ? order.status.rawValue : (STAGES[stage]?.title ?? stage.rawValue))
        }
        if promised, OrdersLogic.isOpen(order), let due = orderTiming(order, now: now).due {
            parts.append("Due " + OrdersLogic.dueDay(due))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    /// A promise that needs chasing (late, today, or urgent inside the bench week): its words and colour.
    private var chasedPromise: (text: String, tone: Tone)? {
        guard OrdersLogic.isOpen(order) else { return nil }
        let timing = orderTiming(order, now: now)
        let promise = OrdersLogic.promise(order, now: now)
        guard timing.due != nil, promise.chase, timing.state == .late || timing.state == .today || promise.urgent else { return nil }
        let words = PromiseWords.say(timing)
        return (words.text, words.tone)
    }

    /// What is still owed or in credit; nothing once paid, and nothing for a cancelled or refunded order. In the
    /// ink when the promise is the row's coloured word.
    @ViewBuilder private func money(coloured: Bool) -> some View {
        if stage != .closed {
            let due = OrdersLogic.stillOwed(order, invoiceOwed: owed)
            if abs(due) > 0.5 {
                RowAmount(amount: abs(due), tone: coloured ? (due < 0 ? Tone.credit.color : Tone.owed.color) : Color.primary)
                    .accessibilityLabel((due < 0 ? "In credit " : "Owed ") + Money.pkr(abs(due)))
            }
        }
    }
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
            Button(action: run) { Label(step.title, systemImage: step.symbol) }
                .buttonStyle(.borderless)
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
