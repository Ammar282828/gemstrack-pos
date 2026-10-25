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
            VStack(alignment: .leading, spacing: 16) {
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
        return HStack(alignment: .top, spacing: 14) {
            Monogram(name: name, size: Monogram.Size.hero)
            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .lineLimit(2)
                if !phone.isEmpty || online || mine {
                    HStack(spacing: 8) {
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
            VStack(alignment: .leading, spacing: 4) {
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
        return HStack(spacing: 12) {
            DateLeaf(date: t.due, tone: tone)
            VStack(alignment: .leading, spacing: 4) {
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
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Note", systemImage: "note.text")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(notes)
                            .font(.subheadline)
                            .textSelection(.enabled)
                    }
                    if !shipTo.isEmpty {
                        Divider()
                        VStack(alignment: .leading, spacing: 4) {
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
                .padding(.vertical, 6)
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
                    .padding(.vertical, 6)
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
            VStack(alignment: .leading, spacing: 8) {
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
            GlassEffectContainer(spacing: 10) {
                if typeSize.isAccessibilitySize {
                    VStack(spacing: 10) { barButtons(order, step: step, advance: advance) }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { barButtons(order, step: step, advance: advance) }
                        VStack(spacing: 10) { barButtons(order, step: step, advance: advance) }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
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
            ToolbarItem(placement: .primaryAction) {
                Button { web = .edit(order.id) } label: { Label("Edit", systemImage: "pencil") }
                    .accessibilityLabel("Edit order")
            }
        }
        ToolbarItem(placement: .primaryAction) {
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

/// The order as a Mac record (apps/iphone/Mac/MAC-CONVENTIONS.md): who it is for, where it stands and the money in a
/// left column; the pieces as a table (right-click each) with the advances under it; the order's moves in the toolbar
/// (the next step, Take advance, Print slip, Edit, More). In a hub's narrow side pane it is the phone's one list.
extension OrderScreen {
    fileprivate func macDetail(_ order: Order) -> some View {
        let invoice = invoiceOf(order)
        let owed = invoice.map { isOwing($0) ? $0.balanceDue : 0 } ?? 0
        let stage = localStage(order, owedOnInvoice: owed)
        let now = Date()
        return MacRecordSplit {
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
        } rest: {
            Group {
                if OrdersLogic.hasInvoice(order) {
                    invoiceSection(order, invoice: invoice, owed: owed)
                } else {
                    moneySection(order)
                }
                detailsSection(order)
            }
            .houseRows()
        } lines: {
            Group { piecesSection(order) }.houseRows()
        } wide: {
            macLines(order)
        }
        .navigationSubtitle(OrdersLogic.customerName(order))
        .toolbar { macToolbar(order, stage: stage, owed: owed) }
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

    /// The wide page's right side: how far the pieces have come, the pieces, the advances.
    @ViewBuilder
    fileprivate func macLines(_ order: Order) -> some View {
        let invoiced = OrdersLogic.hasInvoice(order)
        let karigars: [Karigar] = session.isOwner && !invoiced ? workshopLive(book.karigars.items) : []
        let counts = LocalPieceCounts(total: order.items.count,
                                      unassigned: order.items.indices.filter { !hasKarigarNow(order, $0) }.count,
                                      done: order.items.indices.filter { isDone(order, $0) }.count)
        let rows: [OrderPieceTableRow] = order.items.indices.map { i in
            OrderPieceTableRow(id: i, item: order.items[i], done: isDone(order, i), karigar: karigarName(order, i))
        }
        let ordered: [OrderPieceTableRow] = rows.filter { !$0.done } + rows.filter { $0.done }
        let lines = OrdersLogic.advanceLines(order)
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                LedgerHeading(title: "Pieces",
                              trailing: counts.total > 0 ? "\(counts.done) of \(counts.total) done" : nil)
                if counts.total > 0 {
                    ProgressView(value: Double(counts.done), total: Double(counts.total))
                        .tint(counts.done == counts.total ? Tone.settled.color : Theme.accent)
                        .accessibilityLabel("\(counts.done) of \(counts.total) pieces done")
                }
            }
            if order.items.isEmpty {
                Text("No pieces on this order.")
                    .foregroundStyle(.secondary)
            } else {
                OrderPiecesTable(
                    rows: ordered,
                    canTick: session.isOwner && !invoiced,
                    canRemove: OrderActions.canRemovePiece(order, isOwner: session.isOwner),
                    karigars: karigars,
                    karigarId: { i in localKarigar[i] ?? order.items[i].karigarId ?? "none" },
                    tick: { i, done in tick(order, i, done) },
                    assign: { i, kid in assign(order, i, kid) },
                    remove: { i in undo = OrderUndo.removePiece(order, index: i) }
                ) { i in
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
                }
            }
            if counts.unassigned > 0 && !invoiced {
                Button { web = .giveOut(order.id) } label: {
                    Label("Give out: \(counts.unassigned) without a karigar", systemImage: "person.badge.plus")
                }
            }
            if !lines.isEmpty && !invoiced {
                VStack(alignment: .leading, spacing: 8) {
                    LedgerHeading(title: "Advances")
                    OrderAdvancesTable(lines: lines,
                                       canDelete: OrderActions.canDeleteAdvance(order, isOwner: session.isOwner)) { l in
                        undo = OrderUndo.deleteAdvance(order, line: l)
                    }
                }
            }
        }
    }

    /// The order's moves in the window's toolbar: the next step first (as the phone's bar has it), then Take advance,
    /// Print slip and Edit, and the ⋯ menu for the rest.
    @ToolbarContentBuilder
    fileprivate func macToolbar(_ order: Order, stage: OrderStage, owed: Double) -> some ToolbarContent {
        let step = barStep(order, stage: stage, owed: owed)
        let advance = stage != .closed && OrdersLogic.offersAdvance(order, stage: stage, isOwner: session.isOwner)
        let editable = session.isOwner && !OrdersLogic.hasInvoice(order)
        ToolbarItemGroup(placement: .primaryAction) {
            if stage != .closed, let step {
                if let invoiceId = invoiceToOpen(step) {
                    NavigationLink(value: Route(path: "/invoices/\(invoiceId)")) {
                        Label(step.title, systemImage: step.symbol).labelStyle(.titleAndIcon)
                    }
                    .keyboardShortcut(.return, modifiers: .command)
                    .help(step.title)
                } else {
                    Button { run(order, step) } label: {
                        Label(step.title, systemImage: step.symbol).labelStyle(.titleAndIcon)
                    }
                    .keyboardShortcut(.return, modifiers: .command)
                    .help(step.title + " (\u{2318}\u{21A9})")
                }
            }
            if advance {
                Button { advancing = true } label: {
                    Label("Take advance", systemImage: "banknote").labelStyle(.titleAndIcon)
                }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .help("Record an advance (\u{21E7}\u{2318}A)")
            }
            Button { web = .slip(order.id) } label: { Label("Print slip", systemImage: "printer") }
                .help("Show the workshop slip to print or save")
            if editable {
                Button { web = .edit(order.id) } label: { Label("Edit", systemImage: "pencil") }
                    .keyboardShortcut("e", modifiers: .command)
                    .help("Change this order (\u{2318}E)")
            }
            moreMenu(order, stage: stage, owed: owed)
        }
    }
}
#endif
