import SwiftUI
import ERPCore

// An order on the hub: the record lists' row (RecordRow, RecordList.swift: the same anatomy as an invoice's and a
// customer's, owner 2026-11-02), then a second List row with the order's one next step
// (components/order/next-step.tsx). Two rows rather than one, because a row that holds both a link
// and buttons answers every tap with all of them; here each row has one kind of control.
//
// The customer and order number lead. The stage is the capsule, the money the trailing column, the promise the
// quiet line (in its colour once it needs someone). The detail page holds the complete stage track.

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

/// The row's own leading edge, which the next-step row lines up under: the row's inset, the monogram, the gap.
private enum OrderCardMetrics {
    static let inset: CGFloat = 16
    static var monogram: CGFloat { RecordRow<EmptyView>.monogram }
    static let gap: CGFloat = 12
    static var stepLeading: CGFloat { inset + monogram + gap }
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

    #if os(macOS)
    /// Lets a card's right-click open the order in a window of its own (the Mac shell provides it).
    @Environment(\.openPlaceWindow) private var openPlaceWindow
    #endif

    var body: some View {
      if standalone {
        // The iPad's grid card and the Mac's board card: the row's anatomy, then the next step and the actions menu.
        RecordCard(mine: mine) {
            RouteLink(value: Route(path: "/orders/\(order.id)")) {
                OrderCardHead(order: order, stage: stage, owed: owed, now: now, greyed: greyed, mine: mine, showsStage: showsStage)
            }
            .buttonStyle(.pressable)
            .zoomSource(id: "/orders/\(order.id)")
        } footer: {
            RecordCardFooter(label: "Actions for \(order.id)") {
                // One tap to the printer: the order's slip, straight to the share sheet (OrdersHub, .pdfQuickShare).
                QuickPrintButton(label: "Print slip \(order.id)") { actions.open(.slip(order.id)) }
                if let step {
                    OrderNextStepRow(order: order, step: step, canAdvance: canAdvance, busy: busy, actions: actions, showsAdvanceMenu: false)
                }
            } actions: {
                menu
            }
        }
        .contextMenu { menu }
      } else {
        HStack(spacing: pt(8)) {
            RouteLink(value: Route(path: "/orders/\(order.id)")) {
                OrderCardHead(order: order, stage: stage, owed: owed, now: now, greyed: greyed, mine: mine, showsStage: showsStage)
            }
            .zoomSource(id: "/orders/\(order.id)")
            // One tap to the printer: the order's slip, straight to the share sheet (OrdersHub, .pdfQuickShare).
            QuickPrintButton(label: "Print slip \(order.id)") { actions.open(.slip(order.id)) }
        }
        .listRowSeparator(step != nil ? .hidden : .automatic, edges: .bottom)
        .swipeActions(edge: .leading, allowsFullSwipe: false) { reach }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { swipe }
        .contextMenu { menu }

        if let step {
            // Under the name, as a quiet second line of the same record.
            OrderNextStepRow(order: order, step: step, canAdvance: canAdvance, busy: busy, actions: actions)
                .listRowSeparator(.hidden, edges: .top)
                .listRowInsets(EdgeInsets(top: 0, leading: OrderCardMetrics.stepLeading, bottom: 8, trailing: 16))
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
        #if os(macOS)
        Button("Open") { actions.open(.order(order.id)) }
        Button("Open in New Window") { openPlaceWindow?(Route(path: "/orders/\(order.id)")) }
            .disabled(openPlaceWindow == nil)
        Button("Print or share slip") { actions.open(.slip(order.id)) }
        Divider()
        #endif
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

/// The order as the record lists' row: who; its number, its promise and how far its pieces are (or what it is); the
/// estimate with what is still owed under it (Paid once nothing is: the owner keeps an order's Paid, 2026-10-17); the
/// stage's words in their colour as the capsule unless the heading already says it. Complete piece, payment and
/// contact details remain on the order.
struct OrderCardHead: View {
    let order: Order
    let stage: OrderStage
    let owed: Double
    let now: Date
    let greyed: Bool
    let mine: Bool
    var showsStage = true

    var body: some View {
        RecordRow(name: OrdersLogic.customerName(order), title: OrdersLogic.customerName(order), subtitle: subtitle,
                  mine: mine, muted: greyed, money: money, status: status) {
            if OrdersLogic.isOnline(order) { OrdersOnlineBadge() }
            // A Shopify order's WhatsApp step (To confirm, Cancel requested, Awaiting transfer, …), as Invoices shows it.
            if order.isShopifyOrder, let chip = whatsappOrderChip(order.whatsappOrder?.state) {
                OrdersWhatsAppBadge(label: chip.label, tone: Tone(chip.tone))
            }
            // Where its TCS parcel is (Delivered, With TCS, Returned…), from Shopify's fulfilments.
            if order.isShopifyOrder, let delivery = order.shopifyDeliveryChip {
                OrdersWhatsAppBadge(label: delivery.label, tone: Tone(delivery.tone))
            }
        }
    }

    /// "ORD-123 · Due Thu 12 Nov · 2 of 4 done": the promise in its colour once it is late, today or close.
    private var subtitle: Text {
        let counts = pieceCounts(order.items)
        let lead = order.id
        let tail: String
        if counts.total > 0, !greyed, stage != .closed, stage != .done {
            tail = counts.unassigned > 0 ? "\(counts.unassigned) unassigned" : "\(counts.done) of \(counts.total) done"
        } else {
            tail = OrdersLogic.cardWhat(order).text
        }
        let timing = orderTiming(order, now: now)
        let promise = OrdersLogic.promise(order, now: now)
        guard OrdersLogic.isOpen(order), let due = timing.due else {
            return Text(verbatim: [lead, tail].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
        }
        let urgent = promise.chase && (timing.state == .late || timing.state == .today || promise.urgent)
        let words = PromiseWords.say(timing)
        let when = Text(verbatim: urgent ? words.text : "Due " + OrdersLogic.dueDay(due))
            .foregroundStyle(urgent ? words.tone.color : Color.secondary)
        let after = tail.isEmpty ? "" : " \u{00B7} " + tail
        return Text("\(Text(verbatim: lead + " \u{00B7} "))\(when)\(Text(verbatim: after))")
    }

    private var stageTone: Tone {
        switch stage {
        case .karigar: return .working
        case .ready, .done: return .settled
        case .transfer, .payment: return .owed
        default: return .quiet
        }
    }

    private var status: RecordStatus? {
        guard showsStage || stage == .closed else { return nil }
        let title = stage == .closed ? order.status.rawValue : (STAGES[stage]?.title ?? stage.rawValue)
        return RecordStatus(text: title, tone: stageTone)
    }

    /// The estimate, and under it what is still owed (amber), in credit (teal), or Paid once nothing is.
    private var money: RecordMoney? {
        guard stage != .closed else { return nil }
        // The whole order, never less the advance (owner, 2026-11-03): the owed line under it says what is left.
        let estimate = OrdersLogic.fullAmount(order)
        var m = RecordMoney(amount: estimate >= 1 ? estimate : nil)
        let due = OrdersLogic.stillOwed(order, invoiceOwed: owed)
        if abs(due) >= 1 {
            m.detail = due < 0 ? "\(Money.pkr(abs(due))) credit" : "\(Money.pkr(due)) owed"
            m.detailTone = due < 0 ? .credit : .owed
        } else {
            m.detail = "Paid"
            m.detailTone = .settled
        }
        return m
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
            RouteLink(value: Route(path: "/invoices/\(inv.id)")) {
                invoiceLink(inv.id)
            }
        } else {
            HStack(spacing: pt(10)) {
                primary
                Spacer(minLength: 0)
                if canAdvance && showsAdvanceMenu {
                    Menu {
                        Button("Record an advance", systemImage: "banknote") { actions.advance(order) }
                    } label: {
                        Image(systemName: "ellipsis").frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("More order actions")
                }
            }
        }
    }

    private func invoiceLink(_ invoiceId: String) -> some View {
        Label("Invoice \(invoiceId)", systemImage: "doc.text")
            .font(.house(.subheadline).weight(.medium))
            .foregroundStyle(Theme.accent)
    }

    @ViewBuilder
    private var primary: some View {
        if busy {
            ProgressView().controlSize(.small)
                .frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
        } else {
            // A small tinted capsule, so the card's one action reads as a button and not as more words. Not glass
            // (a glass button under an animated swap shrinks into a blob, iphone-app.md "The bubble").
            Button(action: run) { Label(step.title, systemImage: step.symbol) }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(Theme.accent)
                .font(.house(.subheadline).weight(.semibold))
                .frame(minHeight: Metrics.tap)
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
