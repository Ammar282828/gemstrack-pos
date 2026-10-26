import SwiftUI
import ERPCore

/// One order (src/app/orders/[id]/page.tsx): who it is for, where it stands, its pieces with their
/// karigars, and the money. Setting the status, ticking a piece done, recording an advance, editing,
/// finalizing, the slip, cancelling or unlocking the invoice, refunding, deleting (behind the delete code),
/// booking and tracking the courier and sending the customer an update are native (OrderUndoSheets,
/// OrderCourierSheet, OrderTrackingSheet, OrderLeopardsSheet, OrderNotifySheet), and so is everything else the
/// page does: picking a piece's karigar, giving pieces out (the Workshop board), taking a piece off and deleting
/// an advance (behind the delete code), and each piece's sample photo.
///
/// The page reads as the ledger (App/UI/Ledger.swift, reordered in the iPhone review of 2026-10-12): the hero
/// card first (who it is for, what is owed, when it was promised, how far it has come, how to reach them);
/// the note and where it goes; the online panel; the pieces, open ones first; the money as Total · Paid · Due
/// with its breakdown folded; the quieter facts last. The order's next step is the bar at its foot, as an
/// invoice's Take payment is, with an Advance beside it while the order is being made. Edit is on the bar
/// above; the ⋯ menu keeps everything else, the destructive moves last.
struct OrderScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var web: OrdersWebTarget?
    @State private var advancing = false
    @State private var confirmCancel = false
    @State private var failure: String?
    @State private var undo: OrderUndoAsk?
    @State private var booking = false
    @State private var tracking = false
    @State private var leopardsOpen = false
    @State private var notifying = false
    /// The bar's Check transfer: the transfer's own sheet, as the online section's Transfer received opens it.
    @State private var checkingTransfer = false
    /// What was said once a transfer was booked or an order let lapse, and what an advance, Ready or a cancel did.
    @State private var note: Note?
    /// Counted so each event is felt once: money taken, an order marked ready or a piece ticked.
    @State private var moneyTick = 0
    @State private var savedTick = 0
    /// What the person just did, shown before the shelf's copy catches up (cleared when it matches, or when the
    /// Outbox gives up on the change).
    @State private var localStatus: String?
    @State private var localDone: [Int: Bool] = [:]
    @State private var localKarigar: [Int: String] = [:]
    #if os(macOS)
    /// The Mac's one sheet at a time, the piece picked for the page's right column, and where it opens other records.
    @State private var macSheet: MacOrdersSheet?
    @State private var macPiece: Int?
    /// Whether the window is wide enough for the details to stand beside the lines (else under them). A flag, so only
    /// crossing the line (never each point of a drag) redraws the page.
    @State private var macWide = true
    /// The karigars worked out from the shelf, kept until it changes (never walked while drawing).
    @State private var macKarigars = Memo<[Karigar]>()
    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.openURL) private var openURL
    #endif

    var body: some View {
        // "/orders/" + "add" can reach this screen as an order id: it is New order's form (NewOrderRoutes).
        if id == "add" {
            NewOrder()
        } else {
            screen
        }
    }

    private var screen: some View {
        ShelfState(loaded: book.orders.loaded, error: book.orders.error, offline: book.orders.offline) {
            // Read through `items`: the shelf's lookup is not observed, so a change would not redraw.
            if let order = book.orders.item(id) {
                #if os(macOS)
                macDetail(order)
                #else
                detail(order)
                #endif
            } else {
                ContentUnavailableView("Order not found", systemImage: "list.clipboard", description: Text("\(id) is not in the book."))
            }
        }
        .navigationTitle(id)
        .navigationBarTitleDisplayMode(.inline)
        .zoomDestination(id: "/orders/\(id)")
        .ordersWebDestination($web)
        .orderUndo($undo, open: $web)
        .ordersFailureAlert($failure)
        .onChange(of: shelfSignature) { _, _ in reconcile() }
        .onChange(of: Outbox.shared.failure?.id) { _, _ in localStatus = nil; localDone = [:]; localKarigar = [:] }
        .moneyFeedback(success: moneyTick, failure: 0)
        .savedFeedback(trigger: savedTick)
        .noteToast($note)
        .onAppear {
            book.orders.need()
            book.invoices.need()
            book.karigars.need()
        }
    }

    private func detail(_ order: Order) -> some View {
        let invoice = invoiceOf(order)
        // What the invoice still has owing, by the hub's own rule (isOwing), so the stage reads the same on both.
        let owed = invoice.map { isOwing($0) ? $0.balanceDue : 0 } ?? 0
        let stage = localStage(order, owedOnInvoice: owed)
        let now = Date()
        return WideDetailList {
            heroSection(order, stage: stage, now: now, owed: owed, invoice: invoice)
            noteSection(order)
            if OrdersLogic.isOnline(order) {
                Group {
                    OrderOnlineSection(order: order, leopards: { leopardsOpen = true }) { kind, t in
                        onlineMoved(kind, t)
                    }
                }
                .houseRows()
            }
        } right: {
            Group {
                piecesSection(order)
                if OrdersLogic.hasInvoice(order) {
                    invoiceSection(order, invoice: invoice, owed: owed)
                } else {
                    moneySection(order)
                }
                detailsSection(order)
            }
            .houseRows()
        }
        .safeAreaBar(edge: .bottom, spacing: 0) { actionBar(order, stage: stage, owed: owed) }
        .toolbar { orderToolbar(order, stage: stage, owed: owed) }
        .sheet(isPresented: $advancing) { advanceSheet(order).presentationSizing(.form) }
        .sheet(isPresented: $booking) { OrderCourierSheet(order: order) }
        .sheet(isPresented: $tracking) { OrderTrackingSheet(order: order) }
        .sheet(isPresented: $leopardsOpen) { OrderLeopardsSheet(order: order) }
        .sheet(isPresented: $notifying) { OrderNotifySheet(order: order) }
        .sheet(isPresented: $checkingTransfer) {
            OnlineMoveSheet(order: order, kind: .paid) { t in
                onlineMoved(.paid, t)
            }
        }
        .confirmDestructive(isPresented: $confirmCancel, title: "Cancel order \(order.id)?",
                            message: OrdersLogic.cancelWords, action: "Cancel order") {
            setStatus(order, "Cancelled")
        }
    }

    /// A transfer booked or an order let lapse: said once as a toast, with the tap of what it was. The move
    /// happened even when the customer's WhatsApp did not go.
    private func onlineMoved(_ kind: OnlineMoveSheet.Kind, _ t: OnlineTold) {
        Note.show(Note(title: t.words, failed: !t.ok), in: $note, reduce: reduceMotion)
    }

    private func invoiceOf(_ order: Order) -> Invoice? {
        guard let invoiceId = order.invoiceId, !invoiceId.isEmpty else { return nil }
        return book.invoices.item(invoiceId)
    }

    // MARK: Who, what is owed, when, how far

    @ViewBuilder
    private func heroSection(_ order: Order, stage: OrderStage, now: Date, owed: Double, invoice: Invoice?) -> some View {
        let phone = (order.customerContact ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        Section {
            VStack(alignment: .leading, spacing: pt(16)) {
                who(order, phone: phone)
                heroFigure(order, stage: stage, owed: owed, invoice: invoice)
                promiseRow(order, now: now)
                standingRow(order, stage: stage)
                if !CustomerKit.dialable(phone).isEmpty {
                    ContactActions(phone: phone)
                }
            }
            .heroSheen()
            .ordersCardRow()
        }
    }

    private func who(_ order: Order, phone: String) -> some View {
        let name = OrdersLogic.customerName(order)
        let online = OrdersLogic.isOnline(order)
        let mine = OrdersLogic.isMine(order, person: session.shop.person)
        return HStack(alignment: .top, spacing: pt(14)) {
            Monogram(name: name, size: Monogram.Size.hero)
            VStack(alignment: .leading, spacing: pt(4)) {
                Text(name)
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .lineLimit(2)
                if !phone.isEmpty || online || mine {
                    HStack(spacing: pt(8)) {
                        if !phone.isEmpty {
                            Text(OrdersLogic.phoneWords(phone))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .lineLimit(1)
                        }
                        if online { OrdersOnlineBadge() }
                        if mine { MineTag() }
                    }
                }
                Text(caption(order))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// "ORD-12 · taken Tue 6 Oct · by Sana": the order's number first, for finding it again.
    private func caption(_ order: Order) -> String {
        var parts = [order.id]
        let said = ShopDate.say(order.createdAt)
        if !said.isEmpty {
            parts.append("taken " + (["Today", "Yesterday", "Tomorrow"].contains(said) ? said.lowercased() : said))
        }
        if let by = order.takenBy, !by.isEmpty { parts.append("by " + by) }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// What is still owed, as the page's one big figure (amber), or Paid / In credit in a pill once nothing is.
    /// A cancelled or refunded order has no money left to say.
    @ViewBuilder
    private func heroFigure(_ order: Order, stage: OrderStage, owed: Double, invoice: Invoice?) -> some View {
        if stage != .closed {
            let due = OrdersLogic.hasInvoice(order) ? (invoice?.balanceDue ?? owed) : OrdersLogic.balance(order)
            VStack(alignment: .leading, spacing: pt(4)) {
                if due >= 1 {
                    Text("OWED")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .tracking(0.6)
                    HeroAmount(amount: due, tone: Tone.owed.color)
                } else if isCredit(due) {
                    Pill("In credit", tone: .credit)
                    HeroAmount(amount: -due, tone: Tone.credit.color)
                } else {
                    Pill("Paid", tone: .settled, symbol: "checkmark")
                }
            }
        }
    }

    /// The promised day as a leaf, and how it is going: red once late, amber on the day and inside the bench
    /// week (with "Urgent"), quiet once the order is finished (components/shared/promise-line.tsx).
    private func promiseRow(_ order: Order, now: Date) -> some View {
        let t = orderTiming(order, now: now)
        let p = OrdersLogic.promise(order, now: now)
        let tone = p.tone
        return HStack(spacing: pt(12)) {
            DateLeaf(date: t.due, tone: tone)
            VStack(alignment: .leading, spacing: pt(4)) {
                Text(OrdersLogic.promiseLine(order, now: now))
                    .font(.subheadline.weight(tone == .quiet ? .regular : .semibold))
                    .foregroundStyle(tone == .late ? tone.color : (p.undated ? Color.secondary : Color.primary))
                    .monospacedDigit()
                if p.urgent && t.state != .late {
                    Pill("Urgent", tone: .owed)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// Booked → Making → Ready → Invoiced; a cancelled or refunded order says so instead. The one place the
    /// stage is shown: the status is set from the ⋯ menu.
    @ViewBuilder
    private func standingRow(_ order: Order, stage: OrderStage) -> some View {
        if stage == .closed {
            HStack {
                Pill(shownStatus(order).isEmpty ? "Closed" : shownStatus(order), tone: .quiet)
                Spacer(minLength: 0)
            }
        } else {
            StageTrack(stage: stage, labels: true)
        }
    }

    // MARK: The note and where it goes

    private func noteText(_ order: Order) -> String? {
        let t = (order.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    @ViewBuilder
    private func noteSection(_ order: Order) -> some View {
        if let notes = noteText(order) {
            let shipTo = describeDelivery(order.delivery)
            Section {
                VStack(alignment: .leading, spacing: pt(10)) {
                    VStack(alignment: .leading, spacing: pt(4)) {
                        Label("Note", systemImage: "note.text")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(notes)
                            .font(.subheadline)
                            .textSelection(.enabled)
                    }
                    if !shipTo.isEmpty {
                        Divider()
                        VStack(alignment: .leading, spacing: pt(4)) {
                            Label("Deliver to", systemImage: "mappin.and.ellipse")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(shipTo.joined(separator: "\n"))
                                .font(.subheadline)
                        }
                    }
                }
                .ledgerCard()
                .ordersCardRow()
            }
        }
    }

    // MARK: Money, while it is the order's

    @ViewBuilder
    private func moneySection(_ order: Order) -> some View {
        let subtotal = OrdersLogic.subtotal(order)
        let discount = OrdersLogic.discount(order)
        let exchangeValue = OrdersLogic.exchangeValue(order)
        let lines = OrdersLogic.advanceLines(order)
        let exchanges = orderExchanges(order)
        let rates = OrdersLogic.rateLine(order)
        let canDelete = OrderActions.canDeleteAdvance(order, isOwner: session.isOwner)
        // One advance and no exchange is the split's Paid figure already; the line only says more than that, or
        // carries the advance's delete for an owner.
        let hasGoldLine = lines.contains { !$0.gold.isEmpty }
        let showAdvance = order.advancePayment > 0 && (lines.count > 1 || exchangeValue > 0 || (canDelete && lines.count == 1))
        Section {
            // The page's own sums, so the three always add up: the pieces less the discount, what has come in
            // (the cash advances and the gold taken in exchange: both are payment, decision "Exchange as cash"),
            // and the balance due (OrdersLogic.balance).
            MoneySplit(total: subtotal - discount, paid: order.advancePayment + exchangeValue,
                       due: OrdersLogic.balance(order), paidLabel: "Paid")
                .padding(.vertical, pt(6))
            DisclosureGroup("Breakdown") {
                MoneyRow("Pieces", subtotal)
                if discount > 0 { MoneyRow("Discount", -discount, signed: true) }
                if showAdvance {
                    // One advance: its delete sits on this line; several: each line has its own below.
                    MoneyRow("Advance paid", -order.advancePayment, signed: true)
                        .advanceDeletion(canDelete && lines.count == 1 && !hasGoldLine ? lines.first : nil) { l in undo = OrderUndo.deleteAdvance(order, line: l) }
                }
                // Each advance with its day and how it was paid: these become the invoice's payments.
                if lines.count > 1 || hasGoldLine {
                    ForEach(lines) { l in
                        advanceLine(l)
                            .advanceDeletion(canDelete ? l : nil) { l in undo = OrderUndo.deleteAdvance(order, line: l) }
                    }
                }
                if exchangeValue > 0 { MoneyRow("Taken in exchange", -exchangeValue, signed: true) }
                ForEach(Array(exchanges.enumerated()), id: \.offset) { pair in
                    exchangeLine(pair.element, showValue: exchanges.count > 1)
                }
                if !rates.isEmpty {
                    Text(rates)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                // The shop's margin: owners and staff, never a customer, never in a house that does not cost by
                // gold, and blurred until tapped (docs/decisions.md "Margin").
                if OrdersLogic.marginIsOn(House.margin) {
                    OrdersMarginRow(order: order)
                }
            }
        } header: {
            LedgerHeading(title: "Money")
        }
    }

    private func advanceLine(_ l: OrdersLogic.AdvanceLine) -> some View {
        let words = [ShopDate.say(l.date), l.method, l.note].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(words)
                Spacer(minLength: 8)
                if l.amount > 0 || l.gold.isEmpty { Text(Money.pkr(l.amount)).monospacedDigit() }
            }
            if !l.gold.isEmpty { Text(l.gold) }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    private func exchangeLine(_ e: ExchangeEntry, showValue: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(describeExchangeEntry(e))
            Spacer(minLength: 8)
            if showValue { Text(Money.pkr(e.value)).monospacedDigit() }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    // MARK: Invoiced: the order is locked, the money is the invoice's

    @ViewBuilder
    private func invoiceSection(_ order: Order, invoice: Invoice?, owed: Double) -> some View {
        let invoiceId = order.invoiceId ?? ""
        let rates = OrdersLogic.rateLine(order)
        Section {
            if let inv = invoice {
                MoneySplit(total: inv.grandTotal, paid: inv.amountPaid, due: inv.balanceDue)
                    .padding(.vertical, pt(6))
            }
            if !rates.isEmpty {
                Text(rates)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            NavigationLink(value: Route(path: "/invoices/\(invoiceId)")) {
                // What is owed is the page's big figure and the split above; the link names the invoice only.
                Label("Invoiced \u{00B7} \(invoiceId)", systemImage: "doc.text")
            }
        } header: {
            LedgerHeading(title: "Money")
        } footer: {
            Text(OrderActions.canUndoInvoice(order, isOwner: session.isOwner)
                 ? "To change it, use Unlock & edit."
                 : "The order is locked to its invoice.")
        }
    }

    // MARK: Pieces

    private func piecesSection(_ order: Order) -> some View {
        let invoiced = OrdersLogic.hasInvoice(order)
        let canRemove = OrderActions.canRemovePiece(order, isOwner: session.isOwner)
        // The page's inline picker: an owner's (setPieceKarigar), until the order is invoiced.
        let karigars = session.isOwner && !invoiced ? workshopLive(book.karigars.items) : []
        let counts = LocalPieceCounts(total: order.items.count,
                                 unassigned: order.items.indices.filter { !hasKarigarNow(order, $0) }.count,
                                 done: order.items.indices.filter { isDone(order, $0) }.count)
        // Open pieces first; the finished ones follow, quieter. Each keeps its own index for the tick.
        let unfinished: [Int] = order.items.indices.filter { !isDone(order, $0) }
        let finished: [Int] = order.items.indices.filter { isDone(order, $0) }
        let ordered: [Int] = unfinished + finished
        return Section {
            ForEach(ordered, id: \.self) { i in
                OrderPieceRow(
                    index: i,
                    item: order.items[i],
                    karigar: karigarName(order, i),
                    canTick: session.isOwner && !invoiced,
                    busy: false,
                    showBreakdown: session.isOwner,
                    onTick: { done in tick(order, i, done) },
                    assign: karigars.isEmpty ? nil : OrderPieceAssign(karigars: karigars, busy: false) { kid in
                        assign(order, i, kid)
                    },
                    doneOverride: localDone[i],
                    karigarOverride: localKarigar[i]
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if canRemove {
                        Button(role: .destructive) { undo = OrderUndo.removePiece(order, index: i) } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                }
                .contextMenu {
                    if canRemove {
                        Button(role: .destructive) { undo = OrderUndo.removePiece(order, index: i) } label: {
                            Label("Remove this piece", systemImage: "trash")
                        }
                    }
                }
            }.motion(ordered)
            if order.items.isEmpty {
                Text("No pieces on this order.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if counts.unassigned > 0 && !invoiced {
                Button { web = .giveOut(order.id) } label: {
                    Label("Give out: \(counts.unassigned) without a karigar", systemImage: "person.badge.plus")
                }
            }
        } header: {
            // How far the pieces have come, and its bar; the count is not said twice (CONVENTIONS rule 15).
            VStack(alignment: .leading, spacing: pt(8)) {
                LedgerHeading(title: "Pieces",
                              trailing: counts.total > 0 ? "\(counts.done) of \(counts.total) done" : nil)
                if counts.total > 0 {
                    ProgressView(value: Double(counts.done), total: Double(counts.total))
                        .tint(counts.done == counts.total ? Tone.settled.color : Theme.accent)
                        .accessibilityLabel("\(counts.done) of \(counts.total) pieces done")
                }
            }
            .contentTransition(.numericText(value: Double(counts.done)))
            .motion(counts.done)
        }
    }

    private func karigarName(_ order: Order, _ index: Int) -> String? {
        let item = order.items[index]
        if let kid = localKarigar[index] {
            if kid == "none" { return nil }
            return book.karigars.items.first(where: { $0.id == kid })?.name ?? "Karigar " + kid
        }
        guard OrdersLogic.hasKarigar(item), let kid = item.karigarId else { return nil }
        return book.karigars.items.first(where: { $0.id == kid })?.name ?? "Karigar " + kid
    }

    // MARK: Details: the quieter facts

    /// Who it is for (their page), who took the order and how they found us; where it goes when there is no
    /// note card to hold that; and why it cannot be deleted, when it cannot.
    @ViewBuilder
    private func detailsSection(_ order: Order) -> some View {
        let cid = order.customerId ?? ""
        let by = order.takenBy ?? ""
        let shipTo = noteText(order) == nil ? describeDelivery(order.delivery) : []
        let blocked: String? = session.isOwner ? OrderActions.deleteBlocked(order) : nil
        if !cid.isEmpty || !by.isEmpty || order.source != nil || !shipTo.isEmpty || blocked != nil {
            Section {
                if !cid.isEmpty {
                    NavigationLink(value: Route(path: "/customers/\(cid)")) {
                        LabeledContent("Customer", value: OrdersLogic.customerName(order))
                    }
                }
                if !by.isEmpty {
                    LabeledContent("Taken by", value: by)
                }
                if let source = order.source {
                    LabeledContent("Found us via", value: OrdersLogic.sourceLabel(source))
                }
                if !shipTo.isEmpty {
                    LabeledContent("Deliver to") {
                        Text(shipTo.joined(separator: "\n")).multilineTextAlignment(.trailing)
                    }
                }
            } header: {
                LedgerHeading(title: "Details")
            } footer: {
                if let blocked { Text(blocked) }
            }
        }
    }

    // MARK: The bar: the next step

    /// The order's next step at the foot of the page (OrdersLogic.nextStep, as the hub's card has it), as an
    /// invoice's Take payment: one filled button, and an Advance beside it while the order is being made
    /// (owners). Nothing for a cancelled or refunded order, or for one invoiced and paid. The buttons sit side
    /// by side where they fit and stack where they do not (large text), with their words whole.
    @ViewBuilder
    private func actionBar(_ order: Order, stage: OrderStage, owed: Double) -> some View {
        let step = barStep(order, stage: stage, owed: owed)
        let advance = OrdersLogic.offersAdvance(order, stage: stage, isOwner: session.isOwner)
        if stage != .closed && (step != nil || advance) {
            GlassEffectContainer(spacing: pt(10)) {
                if typeSize.isAccessibilitySize {
                    VStack(spacing: pt(10)) { barButtons(order, step: step, advance: advance) }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: pt(10)) { barButtons(order, step: step, advance: advance) }
                        VStack(spacing: pt(10)) { barButtons(order, step: step, advance: advance) }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, pt(8))
        }
    }

    @ViewBuilder
    private func barButtons(_ order: Order, step: OrderNextStep?, advance: Bool) -> some View {
        if let step {
            stepButton(order, step)
            if advance {
                Button { advancing = true } label: { Label("Advance", systemImage: "banknote").frame(maxWidth: .infinity) }
                    .buttonStyle(.houseGlass)
                    .largeOnPhone()
                    .accessibilityLabel("Record an advance")
            }
        } else {
            Button { advancing = true } label: {
                Label("Record an advance", systemImage: "banknote")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .largeOnPhone()
        }
    }

    /// The hub's step, less what the foot of this page should not offer: an invoice only while it is owed (a
    /// paid one is the money card's link), the transfer only to the accounts the server lets move it
    /// (lib/website/staff-gate.ts).
    private func barStep(_ order: Order, stage: OrderStage, owed: Double) -> OrderNextStep? {
        guard let step = OrdersLogic.nextStep(order, stage: stage, owed: owed) else { return nil }
        switch step {
        case .invoice(_, let due): return due >= 1 ? step : nil
        case .checkTransfer: return session.role == "owner" || session.role == "staff" ? step : nil
        default: return step
        }
    }

    private func invoiceToOpen(_ step: OrderNextStep) -> String? {
        if case let .invoice(id, _) = step { return id }
        return nil
    }

    @ViewBuilder
    private func stepButton(_ order: Order, _ step: OrderNextStep) -> some View {
        if let invoiceId = invoiceToOpen(step) {
            NavigationLink(value: Route(path: "/invoices/\(invoiceId)")) {
                Label(step.title, systemImage: step.symbol)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .largeOnPhone()
        } else {
            Button { run(order, step) } label: {
                Group {
                    Label(step.title, systemImage: step.symbol)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .largeOnPhone()
        }
    }

    private func run(_ order: Order, _ step: OrderNextStep) {
        switch step {
        case .checkTransfer:
            // "Only once you see it in the bank": the sheet says what it books and what the customer is told.
            checkingTransfer = true
        case .giveOut:
            web = .giveOut(order.id)
        case .markReady:
            setStatus(order, "Completed")
        case .finalize:
            web = .finalize(order.id)
        case .invoice:
            break
        }
    }

    // MARK: Toolbar and sheets

    @ToolbarContentBuilder
    private func orderToolbar(_ order: Order, stage: OrderStage, owed: Double) -> some ToolbarContent {
        // Changing an order is an owner's, as in the browser, and only until it is invoiced (Unlock & edit
        // is in the menu then).
        if session.isOwner && !OrdersLogic.hasInvoice(order) {
            ToolbarItem(placement: .trailingAction) {
                Button { web = .edit(order.id) } label: { Label("Edit", systemImage: "pencil") }
                    .accessibilityLabel("Edit order")
            }
        }
        ToolbarItem(placement: .trailingAction) {
            moreMenu(order, stage: stage, owed: owed)
        }
    }

    /// The ⋯ menu in groups: Status, Share, Shipping, More, then what undoes or deletes. The bar's own moves
    /// (Advance, Make invoice) are not repeated here.
    private func moreMenu(_ order: Order, stage: OrderStage, owed: Double) -> some View {
        let step = barStep(order, stage: stage, owed: owed)
        let barOffersAdvance = stage != .closed && OrdersLogic.offersAdvance(order, stage: stage, isOwner: session.isOwner)
        let showAdvance = session.isOwner && OrdersLogic.canAdvance(order) && !barOffersAdvance
        let showFinalize = !OrdersLogic.hasInvoice(order) && (shownStatus(order) == "Completed" || shownStatus(order) == "In Progress")
            && step != .finalize
        let tcs = OrderActions.tcsConsignment(order)
        let canBook = OrderActions.canBookCourier(order, isOwner: session.isOwner)
        let canUndo = OrderActions.canUndoInvoice(order, isOwner: session.isOwner)
        let canChangeRate = session.isOwner && !OrderActions.isClosed(order)
        let canRefund = OrderActions.canRefund(order, isOwner: session.isOwner)
        let canDelete = OrderActions.canDelete(order, isOwner: session.isOwner)
        return Menu {
            Section("Status") {
                ForEach(OrdersLogic.settableStatuses, id: \.self) { s in
                    Button(role: s == "Cancelled" ? .destructive : nil) { choose(order, s) } label: {
                        if s == shownStatus(order) { Label(s, systemImage: "checkmark") } else { Text(s) }
                    }
                        }
            }
            if showAdvance || showFinalize {
                Section {
                    if showAdvance {
                        Button { advancing = true } label: { Label("Record an advance", systemImage: "banknote") }
                    }
                    if showFinalize {
                        Button { web = .finalize(order.id) } label: { Label("Make invoice", systemImage: "doc.text") }
                    }
                }
            }
            Section("Share") {
                // The workshop slip: printed, saved or sent from the share sheet.
                Button { web = .slip(order.id) } label: { Label("Print slip", systemImage: "printer") }
                Button { notifying = true } label: { Label("Message the customer", systemImage: "message") }
            }
            if tcs != nil || canBook {
                Section("Shipping") {
                    if let cn = tcs {
                        Button { tracking = true } label: { Label("Track \(cn)", systemImage: "shippingbox") }
                    }
                    if canBook {
                        Button { booking = true } label: { Label("Book courier", systemImage: "truck.box") }
                    }
                }
            }
            if canChangeRate || canUndo {
                Section("More") {
                    // Gold moves: Edit order (before an invoice) or Edit invoice (after), opened at the rates.
                    if canChangeRate {
                        Button { web = .changeRate(order) } label: { Label("Change rate", systemImage: "percent") }
                    }
                    if canUndo {
                        Button { undo = OrderUndo.unlockAndEdit(order) } label: { Label("Unlock & edit", systemImage: "lock.open") }
                    }
                }
            }
            if canUndo || canRefund || canDelete {
                Section {
                    if canUndo {
                        Button(role: .destructive) { undo = OrderUndo.undoInvoice(order) } label: {
                            Label("Cancel invoice", systemImage: "arrow.uturn.backward")
                        }
                    }
                    if canRefund {
                        Button(role: .destructive) { undo = OrderUndo.refund(order) } label: {
                            Label("Refund order", systemImage: "arrow.uturn.backward")
                        }
                    }
                    if canDelete {
                        Button(role: .destructive) { undo = OrderUndo.delete(order) } label: {
                            Label("Delete order", systemImage: "trash")
                        }
                    }
                }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    private func advanced(_ amount: Double, _ exchanges: [[String: Any]] = []) {
        Note.show(Note(title: "Advance recorded", detail: OrderAdvance.said(amount: amount, exchanges: exchanges)), in: $note, reduce: reduceMotion)
    }

    private func advanceSheet(_ order: Order) -> some View {
        let balance = OrdersLogic.balance(order)
        // The note is the web's own default; it can be changed, and needs three characters (order-dialogs.tsx).
        // Settle gives a remainder under 5,000 off the order's discount (OrderAdvance.settle).
        return PaymentSheet(title: "Record an advance", owed: owesMoney(balance) ? balance : nil, note: "Advance payment received",
                            settle: { amount, method, _, note, remainder in
                                try await OrderAdvance.settle(order, amount: amount, method: method, note: note, remainder: remainder)
                                await MainActor.run { advanced(amount) }
                            }) { amount, method, note, exchanges in
            try await OrderAdvance.record(order, amount: amount, method: method, note: note, exchanges: exchanges)
            // PaymentSheet plays the success tap itself.
            await MainActor.run { advanced(amount, exchanges) }
        }
    }

    // MARK: Writes

    private func choose(_ order: Order, _ status: String) {
        if status == shownStatus(order) { return }
        if status == "Cancelled" { confirmCancel = true } else { setStatus(order, status) }
    }

    private func setStatus(_ order: Order, _ status: String) {
        Motion.run(Motion.enter, reduce: reduceMotion) { localStatus = status }
        savedTick += 1
        if status == "Completed" {
            Note.show(Note(title: "Marked ready", detail: order.id), in: $note, reduce: reduceMotion)
        } else if status == "Cancelled" {
            Note.show(Note(title: "Order cancelled", detail: order.id), in: $note, reduce: reduceMotion)
        } else {
            Note.show(Note(title: "Now " + status.lowercased(), detail: order.id), in: $note, reduce: reduceMotion)
        }
        Outbox.shared.send(op: "setOrderStatus", fields: ["orderId": order.id, "status": status],
                           business: House.business, label: "\(order.id) status")
    }

    /// Owners pick a piece's karigar: the bench's own write, which moves a Pending order on once every piece has
    /// one (lib/writes/order-status.ts).
    private func assign(_ order: Order, _ index: Int, _ karigarId: String) {
        if order.items.indices.contains(index) && (localKarigar[index] ?? order.items[index].karigarId ?? "none") == karigarId { return }
        Motion.run(Motion.enter, reduce: reduceMotion) { localKarigar[index] = karigarId }
        savedTick += 1
        Outbox.shared.send(op: "setPieceKarigar", fields: ["orderId": order.id, "index": index, "karigarId": karigarId],
                           business: House.business, label: "\(order.id) karigar")
    }

    /// Owners tick a piece done; the last one finishes the order, and unticking a finished one sends it
    /// back to the karigars (the server works that out: lib/order-stage.ts).
    private func tick(_ order: Order, _ index: Int, _ done: Bool) {
        Motion.run(Motion.enter, reduce: reduceMotion) { localDone[index] = done }
        savedTick += 1
        Outbox.shared.send(op: "setPieceDone", fields: ["orderId": order.id, "index": index, "done": done],
                           business: House.business, label: "\(order.id) piece \(index + 1)")
    }

    // MARK: What the person just did, before the shelf says so

    private func shownStatus(_ order: Order) -> String { localStatus ?? order.status.rawValue }

    private func isDone(_ order: Order, _ i: Int) -> Bool { localDone[i] ?? order.items[i].isCompleted }

    private func hasKarigarNow(_ order: Order, _ i: Int) -> Bool {
        if let k = localKarigar[i] { return k != "none" && !k.isEmpty }
        return OrdersLogic.hasKarigar(order.items[i])
    }

    /// The stage with the status just chosen (an invoiced or awaiting-transfer order keeps its own).
    private func localStage(_ order: Order, owedOnInvoice: Double) -> OrderStage {
        let base = stageOf(order, owedOnInvoice: owedOnInvoice)
        guard let s = localStatus, base != .transfer, !OrdersLogic.hasInvoice(order) else { return base }
        switch s {
        case "Cancelled", "Refunded": return .closed
        case "Completed": return .ready
        case "In Progress": return .karigar
        case "Pending": return .new
        default: return base
        }
    }

    private var shelfSignature: String {
        guard let o = book.orders.item(id) else { return "" }
        return o.status.rawValue + "|" + o.items.map { "\($0.isCompleted ? 1 : 0)\($0.karigarId ?? "none")" }.joined(separator: ",")
    }

    /// Drop what the shelf now agrees with.
    private func reconcile() {
        guard let o = book.orders.item(id) else { return }
        if localStatus == o.status.rawValue { localStatus = nil }
        for (i, v) in localDone where !o.items.indices.contains(i) || o.items[i].isCompleted == v { localDone[i] = nil }
        for (i, v) in localKarigar where !o.items.indices.contains(i) || (o.items[i].karigarId ?? "none") == v { localKarigar[i] = nil }
    }
}

/// `pieceCounts`, with what the person just ticked or assigned counted in.
private struct LocalPieceCounts { let total: Int; let unassigned: Int; let done: Int }

extension View {
    /// An advance line's delete, when it has one: a swipe and a held press, as a payment's on an invoice.
    @ViewBuilder
    fileprivate func advanceDeletion(_ line: OrdersLogic.AdvanceLine?, _ ask: @escaping (OrdersLogic.AdvanceLine) -> Void) -> some View {
        if let line {
            self
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { ask(line) } label: { Label("Delete", systemImage: "trash") }
                }
                .contextMenu {
                    Button(role: .destructive) { ask(line) } label: { Label("Delete this advance", systemImage: "trash") }
                }
        } else {
            self
        }
    }

    /// A card standing alone in an Orders list: no row background, separator or inset of its own.
    func ordersCardRow() -> some View {
        self
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}


#if os(macOS)
// MARK: The Mac's record window

/// The order as a Mac document (docs/features/mac-design.md, "Orders"): a head (who, which, where it stands, what is owed),
/// the pieces as a table at the page's full width with the picked piece in full in a column at the right, the advances,
/// the money (Total, Paid, Due and what they are made of) and the details, in one scroll. Its actions are the Order menu's
/// (MacOrdersMenu): the toolbar's few, the menu bar's all, the same as the Orders list's. The phone's list is not shown
/// here, at any width.
extension OrderScreen {
    fileprivate func macDetail(_ order: Order) -> some View {
        let invoice = invoiceOf(order)
        let owed = MacOrdersLogic.invoiceOwed(invoice)
        let stage = localStage(order, owedOnInvoice: owed)
        let groups = macGroups(order, stage: stage, owed: owed)
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                macHeader(order, stage: stage, owed: owed, invoice: invoice)
                macColumns(order, stage: stage, owed: owed, invoice: invoice)
            }
            .padding(20)
        }
        .background(Theme.ground)
        .onGeometryChange(for: Bool.self) { $0.size.width >= 1000 } action: { macWide = $0 }
        .navigationSubtitle(OrdersLogic.customerName(order))
        .toolbar { macToolbar(groups) }
        .macRecordMenu(MacRecordMenu(title: "Order", groups: groups))
        .macOrdersSheets($macSheet, advanced: { amount, exchanges in advanced(amount, exchanges) },
                         moved: { kind, told in onlineMoved(kind, told) })
        .confirmDestructive(isPresented: $confirmCancel, title: "Cancel order \(order.id)?",
                            message: OrdersLogic.cancelWords, action: "Cancel order") {
            setStatus(order, "Cancelled")
        }
    }

    // MARK: Head

    /// The iPhone's order page head as a card: the monogram, the name, where it stands (pill, the four steps), the one big
    /// figure, how much of it is paid, and the customer's quick actions.
    private func macHeader(_ order: Order, stage: OrderStage, owed: Double, invoice: Invoice?) -> some View {
        let phone = (order.customerContact ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let subtitle = phone.isEmpty ? caption(order) : caption(order) + " \u{00B7} " + OrdersLogic.phoneWords(phone)
        let headline = macHeadline(order, stage: stage, owed: owed, invoice: invoice)
        let worth = MacOrdersLogic.worth(order, invoice: invoice)
        let paid = invoice.map { $0.amountPaid } ?? MacOrdersLogic.paid(order)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                Monogram(name: OrdersLogic.customerName(order), size: Monogram.Size.hero)
                VStack(alignment: .leading, spacing: 4) {
                    Text(OrdersLogic.customerName(order))
                        .font(.system(.title, design: .serif).weight(.semibold))
                        .lineLimit(2).textSelection(.enabled)
                    Text(subtitle).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                    Pill(macStageWords(order, stage: stage), tone: MacOrdersLogic.tone(stage))
                        .padding(.top, 2)
                }
                Spacer(minLength: 12)
                if let headline {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(headline.label).font(.callout).foregroundStyle(.secondary)
                        HeroAmount(amount: macHeadlineAmount(order, stage: stage, owed: owed, invoice: invoice),
                                   tone: headline.tone == .quiet ? Color.primary : headline.tone.color)
                    }
                }
            }
            if stage != .closed {
                StageTrack(stage: stage, labels: true)
                PaidBar(paid: paid, total: worth)
            }
            ContactActions(phone: phone)
                .frame(maxWidth: 360, alignment: .leading)
        }
        .padding(Metrics.cardPadding + 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }

    /// The figure the head's hero shows (macHeadline's words, as a number).
    private func macHeadlineAmount(_ order: Order, stage: OrderStage, owed: Double, invoice: Invoice?) -> Double {
        let due = OrdersLogic.hasInvoice(order) ? (invoice?.balanceDue ?? owed) : OrdersLogic.balance(order)
        if due >= 1 { return due }
        if isCredit(due) { return -due }
        return MacOrdersLogic.worth(order, invoice: invoice)
    }

    /// A card of the window: the serif heading (a figure beside it), then its content, on the house's card.
    private func macCard<C: View>(_ title: String, trailing: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LedgerHeading(title: title, trailing: trailing)
            content()
        }
        .padding(Metrics.cardPadding + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }

    /// The stage's words, and how far the pieces have come while they are being made.
    private func macStageWords(_ order: Order, stage: OrderStage) -> String {
        let title = MacOrdersLogic.words(order, stage: stage)
        let counts = LocalPieceCounts(total: order.items.count,
                                      unassigned: order.items.indices.filter { !hasKarigarNow(order, $0) }.count,
                                      done: order.items.indices.filter { isDone(order, $0) }.count)
        guard counts.total > 0, stage != .closed, stage != .done, !OrdersLogic.hasInvoice(order) else { return title }
        return title + " \u{00B7} " + (counts.unassigned > 0 ? "\(counts.unassigned) unassigned" : "\(counts.done) of \(counts.total) done")
    }

    /// What is still owed, what is in credit, or what it came to once nothing is; nothing for a cancelled order.
    private func macHeadline(_ order: Order, stage: OrderStage, owed: Double, invoice: Invoice?) -> MacHeadline? {
        if stage == .closed { return nil }
        let due = OrdersLogic.hasInvoice(order) ? (invoice?.balanceDue ?? owed) : OrdersLogic.balance(order)
        if due >= 1 { return MacHeadline("Owed", Money.pkr(due), tone: .owed) }
        if isCredit(due) { return MacHeadline("In credit", Money.pkr(-due), tone: .credit) }
        let total = MacOrdersLogic.worth(order, invoice: invoice)
        return total >= 1 ? MacHeadline("Paid", Money.pkr(total), tone: .settled) : nil
    }

    // MARK: The two columns

    /// The lines at the left and the details at the right; narrower than both read in, the details go under.
    @ViewBuilder
    private func macColumns(_ order: Order, stage: OrderStage, owed: Double, invoice: Invoice?) -> some View {
        if macWide {
            HStack(alignment: .top, spacing: 16) {
                macMain(order, owed: owed, invoice: invoice)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                macSide(order, stage: stage)
                    .frame(width: 320, alignment: .topLeading)
            }
        } else {
            VStack(alignment: .leading, spacing: 16) {
                macMain(order, owed: owed, invoice: invoice)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                macSide(order, stage: stage)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }

    private func macMain(_ order: Order, owed: Double, invoice: Invoice?) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            macPieces(order)
            macAdvances(order)
            macMoney(order, owed: owed, invoice: invoice)
        }
    }

    private func macSide(_ order: Order, stage: OrderStage) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            macPieceDetail(order)
            macDetails(order, stage: stage)
            macOnline(order)
        }
    }

    // MARK: Pieces

    @ViewBuilder
    private func macPieces(_ order: Order) -> some View {
        let invoiced = OrdersLogic.hasInvoice(order)
        let live = macKarigars([book.karigars.revision]) { workshopLive(book.karigars.items) }
        let karigars: [Karigar] = session.isOwner && !invoiced ? live : []
        let doneCount = order.items.indices.filter { isDone(order, $0) }.count
        let rows: [OrderPieceTableRow] = order.items.indices.map { i in
            OrderPieceTableRow(id: i, item: order.items[i], done: isDone(order, i), karigar: karigarName(order, i))
        }
        // Open pieces first; the finished ones follow.
        let ordered: [OrderPieceTableRow] = rows.filter { !$0.done } + rows.filter { $0.done }
        macCard("Pieces", trailing: order.items.isEmpty ? nil : "\(doneCount) of \(order.items.count) done") {
            if order.items.isEmpty {
                Text("No pieces on this order.").foregroundStyle(.secondary)
            } else {
                MacOrdersPiecesGrid(
                    rows: ordered,
                    picked: $macPiece,
                    canTick: session.isOwner && !invoiced,
                    canRemove: OrderActions.canRemovePiece(order, isOwner: session.isOwner),
                    karigars: karigars,
                    karigarId: { i in macKarigarID(order, i) },
                    tick: { i, done in tick(order, i, done) },
                    assign: { i, kid in assign(order, i, kid) },
                    remove: { i in undo = OrderUndo.removePiece(order, index: i) }
                )
            }
        }
    }

    /// The karigar's id now on a piece ("none" when nobody), the one just chosen first.
    private func macKarigarID(_ order: Order, _ index: Int) -> String {
        if let k = localKarigar[index] { return k }
        let item = order.items[index]
        return OrdersLogic.hasKarigar(item) ? (item.karigarId ?? "none") : "none"
    }

    /// The piece picked in the table, else the first still to make.
    private func macPickedIndex(_ order: Order) -> Int? {
        if let p = macPiece, order.items.indices.contains(p) { return p }
        return order.items.indices.first(where: { !isDone(order, $0) }) ?? order.items.indices.first
    }

    @ViewBuilder
    private func macPieceDetail(_ order: Order) -> some View {
        if let i = macPickedIndex(order) {
            MacOrdersPieceDetail(index: i, item: order.items[i], showBreakdown: session.isOwner)
                .id(i)
                .padding(Metrics.cardPadding + 2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .houseCard()
        }
    }

    @ViewBuilder
    private func macAdvances(_ order: Order) -> some View {
        let lines = OrdersLogic.advanceLines(order)
        if !lines.isEmpty && !OrdersLogic.hasInvoice(order) {
            macCard("Advances") {
                MacOrdersAdvancesGrid(lines: lines, canDelete: OrderActions.canDeleteAdvance(order, isOwner: session.isOwner)) { l in
                    undo = OrderUndo.deleteAdvance(order, line: l)
                }
            }
        }
    }

    // MARK: Money

    /// Total, Paid and Due, then what they are made of: the order's own sums until it is invoiced, the invoice's after.
    @ViewBuilder
    private func macMoney(_ order: Order, owed: Double, invoice: Invoice?) -> some View {
        macCard("Money") {
            VStack(alignment: .leading, spacing: 6) {
                if OrdersLogic.hasInvoice(order) {
                    macInvoiceMoney(order, invoice: invoice)
                } else {
                    macOrderMoney(order)
                }
            }
        }
    }

    @ViewBuilder
    private func macOrderMoney(_ order: Order) -> some View {
        let subtotal = OrdersLogic.subtotal(order)
        let discount = OrdersLogic.discount(order)
        let exchangeValue = OrdersLogic.exchangeValue(order)
        let due = OrdersLogic.balance(order)
        let exchanges = orderExchanges(order)
        let rates = OrdersLogic.rateLine(order)
        MacOrdersMoneyRow(label: "Total", value: Money.pkr(subtotal - discount))
        MacOrdersMoneyRow(label: "Paid", value: Money.pkr(order.advancePayment + exchangeValue))
        MacOrdersMoneyRow(label: isCredit(due) ? "In credit" : "Due", value: Money.pkr(abs(due)), strong: true,
                          tone: due >= 1 ? .owed : (isCredit(due) ? .credit : .quiet))
        Divider().padding(.vertical, 2)
        MacOrdersMoneyRow(label: "Pieces", value: Money.pkr(subtotal), small: true)
        if discount > 0 { MacOrdersMoneyRow(label: "Discount", value: "\u{2212} " + Money.pkr(discount), small: true) }
        if order.advancePayment > 0 {
            MacOrdersMoneyRow(label: "Advance paid", value: "\u{2212} " + Money.pkr(order.advancePayment), small: true)
        }
        if exchangeValue > 0 { MacOrdersMoneyRow(label: "Taken in exchange", value: "\u{2212} " + Money.pkr(exchangeValue), small: true) }
        ForEach(Array(exchanges.enumerated()), id: \.offset) { pair in
            MacOrdersMoneyRow(label: describeExchangeEntry(pair.element),
                              value: exchanges.count > 1 ? Money.pkr(pair.element.value) : "", small: true)
        }
        if !rates.isEmpty { Text(rates).font(.caption).foregroundStyle(.secondary) }
        // The shop's margin: owners and staff, never a customer, never in a house that does not cost by gold, and
        // blurred until clicked (docs/decisions.md "Margin").
        if OrdersLogic.marginIsOn(House.margin) { OrdersMarginRow(order: order) }
    }

    @ViewBuilder
    private func macInvoiceMoney(_ order: Order, invoice: Invoice?) -> some View {
        let invoiceId = order.invoiceId ?? ""
        let rates = OrdersLogic.rateLine(order)
        if let inv = invoice {
            MacOrdersMoneyRow(label: "Total", value: Money.pkr(inv.grandTotal))
            MacOrdersMoneyRow(label: "Paid", value: Money.pkr(inv.amountPaid))
            MacOrdersMoneyRow(label: isCredit(inv.balanceDue) ? "In credit" : "Due", value: Money.pkr(abs(inv.balanceDue)), strong: true,
                              tone: inv.balanceDue >= 1 ? .owed : (isCredit(inv.balanceDue) ? .credit : .quiet))
        }
        if !rates.isEmpty { Text(rates).font(.caption).foregroundStyle(.secondary) }
        Button { macOpenRoute("/invoices/\(invoiceId)") } label: {
            Label("Invoiced \u{00B7} \(invoiceId)", systemImage: "doc.text")
        }
        .buttonStyle(.link)
        Text(OrderActions.canUndoInvoice(order, isOwner: session.isOwner)
             ? "To change it, use Unlock & Edit."
             : "The order is locked to its invoice.")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    // MARK: Details

    @ViewBuilder
    private func macDetails(_ order: Order, stage: OrderStage) -> some View {
        let cid = order.customerId ?? ""
        let by = order.takenBy ?? ""
        let shipTo = describeDelivery(order.delivery)
        let note = noteText(order) ?? ""
        let blocked: String? = session.isOwner ? OrderActions.deleteBlocked(order) : nil
        let p = OrdersLogic.promise(order, now: Date())
        macCard("Details") {
            if OrdersLogic.isOpen(order) || !p.undated {
                MacOrdersFact(label: "Promised") {
                    Text(OrdersLogic.promiseLine(order, now: Date()))
                        .foregroundStyle(p.tone == .quiet ? Color.primary : p.tone.color)
                }
            }
            if !cid.isEmpty {
                MacOrdersFact(label: "Customer") {
                    Button(OrdersLogic.customerName(order)) { macOpenRoute("/customers/\(cid)") }
                        .buttonStyle(.link)
                }
            }
            if !by.isEmpty { MacOrdersFact(label: "Taken by") { Text(by) } }
            if let source = order.source { MacOrdersFact(label: "Found us via") { Text(OrdersLogic.sourceLabel(source)) } }
            if !shipTo.isEmpty { MacOrdersFact(label: "Deliver to") { Text(shipTo.joined(separator: "\n")) } }
            if !note.isEmpty { MacOrdersFact(label: "Note") { Text(note).textSelection(.enabled) } }
            if let blocked { Text(blocked).font(.caption).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder
    private func macOnline(_ order: Order) -> some View {
        if OrdersLogic.isOnline(order) {
            OrderOnlineSection(order: order, leopards: { macSheet = .leopards(order) }) { kind, told in
                onlineMoved(kind, told)
            }
        }
    }

    // MARK: Actions

    /// The page's four in the window's toolbar and the rest in one More menu; the menu bar has them all.
    @ToolbarContentBuilder
    private func macToolbar(_ groups: [[MacAction]]) -> some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            ForEach(MacOrdersMenu.pick(groups, MacOrdersMenu.toolbarIDs)) { (a: MacAction) in
                MacToolbarAction(action: a)
            }
            MacOrdersMoreMenu(groups: MacOrdersMenu.rest(groups, excluding: MacOrdersMenu.toolbarIDs))
        }
    }

    private func macGroups(_ order: Order, stage: OrderStage, owed: Double) -> [[MacAction]] {
        let input = MacOrdersMenuInput(order: order, stage: stage, invoiceOwed: owed, status: shownStatus(order),
                                       unassigned: order.items.indices.filter { !hasKarigarNow(order, $0) }.count,
                                       isOwner: session.isOwner, role: session.role)
        return MacOrdersMenu.groups(input, run: macRun(order, stage: stage, owed: owed))
    }

    private func macRun(_ order: Order, stage: OrderStage, owed: Double) -> MacOrdersMenuRun {
        var r = MacOrdersMenuRun()
        r.nextStep = { macNextStep(order, stage: stage, owed: owed) }
        r.advance = { macSheet = .advance(order) }
        r.giveOut = { web = .giveOut(order.id) }
        r.markReady = { setStatus(order, "Completed") }
        r.makeInvoice = { web = .finalize(order.id) }
        r.openInvoice = { if let id = order.invoiceId, !id.isEmpty { macOpenRoute("/invoices/\(id)") } }
        r.printSlip = { web = .slip(order.id) }
        r.message = { macSheet = .notify(order) }
        r.call = { if let url = CustomerKit.callURL(order.customerContact) { openURL(url) } }
        r.whatsApp = { if let url = CustomerKit.whatsAppURL(order.customerContact) { openURL(url) } }
        r.bookCourier = { macSheet = .courier(order) }
        r.track = { macSheet = .tracking(order) }
        r.transfer = { macSheet = .transfer(order) }
        r.lapse = { macSheet = .lapse(order) }
        r.bankDetails = { macBankDetails(order) }
        r.leopards = { macSheet = .leopards(order) }
        r.edit = { web = .edit(order.id) }
        r.changeRate = { web = .changeRate(order) }
        r.unlock = { undo = OrderUndo.unlockAndEdit(order) }
        r.setStatus = { status in choose(order, status) }
        r.cancelInvoice = { undo = OrderUndo.undoInvoice(order) }
        r.cancelOrder = { confirmCancel = true }
        r.refund = { undo = OrderUndo.refund(order) }
        r.delete = { undo = OrderUndo.delete(order) }
        return r
    }

    private func macNextStep(_ order: Order, stage: OrderStage, owed: Double) {
        let input = MacOrdersMenuInput(order: order, stage: stage, invoiceOwed: owed, isOwner: session.isOwner, role: session.role)
        guard let step = MacOrdersMenu.step(input) else { return }
        switch step {
        case .checkTransfer: macSheet = .transfer(order)
        case .giveOut: web = .giveOut(order.id)
        case .markReady: setStatus(order, "Completed")
        case .finalize: web = .finalize(order.id)
        case .invoice(let id, _): macOpenRoute("/invoices/\(id)")
        }
    }

    /// WhatsApp opens with the bank details written in; the person adds the account and presses send there.
    private func macBankDetails(_ order: Order) {
        guard let w = order.website else { return }
        let contact = (order.customerContact ?? "").trimmingCharacters(in: .whitespaces)
        let phone = contact.isEmpty ? (w.customerPhone ?? "") : contact
        let ref = (w.onlineId ?? "").isEmpty ? order.id : (w.onlineId ?? order.id)
        if let url = OnlineOrdersLogic.bankDetailsURL(phone: phone, name: order.customerName ?? "", ref: ref, total: OrdersLogic.onlineTotal(order)) {
            openURL(url)
        }
    }

    /// Another record (a customer, the invoice) in a window of its own.
    private func macOpenRoute(_ path: String) {
        if let openPlace { openPlace(Route(path: path)) } else { web = OrdersWebTarget(path: path, title: path) }
    }
}
#endif
