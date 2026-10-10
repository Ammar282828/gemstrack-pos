import SwiftUI
import ERPCore

/// One order (src/app/orders/[id]/page.tsx): who it is for, where it stands, its pieces with their
/// karigars, and the money. Setting the status, ticking a piece done, recording an advance, editing,
/// finalizing, the slip, cancelling or unlocking the invoice, refunding, deleting (behind the delete code),
/// booking and tracking the courier and sending the customer an update are native (OrderUndoSheets,
/// OrderCourierSheet, OrderTrackingSheet, OrderLeopardsSheet, OrderNotifySheet); giving a piece out is the
/// ERP's own page, one tap away.
///
/// The page reads as the ledger (App/UI/Ledger.swift, 2026-10-09): first who it is for and how to reach them,
/// when it was promised and how far it has come; then the money as Total · Paid · Due (what is owed stands
/// out, not the total); the pieces; the quieter facts last. The order's next step is the bar at its foot, as an
/// invoice's Take payment is, with an Advance beside it while the order is being made. The ⋯ menu keeps
/// everything else.
struct OrderScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var web: OrdersWebTarget?
    @State private var advancing = false
    @State private var confirmCancel = false
    @State private var updatingStatus = false
    @State private var ticking: Int?
    @State private var failure: String?
    @State private var undo: OrderUndoAsk?
    @State private var booking = false
    @State private var tracking = false
    @State private var leopardsOpen = false
    @State private var notifying = false
    /// The bar's Check transfer: the transfer's own sheet, as the online section's Transfer received opens it.
    @State private var checkingTransfer = false
    /// What that sheet said once the transfer was booked.
    @State private var told: OnlineTold?

    var body: some View {
        // New order is the ERP's own page, and "/orders/" + "add" reaches this screen as an order id.
        if id == "add" {
            WebScreen(path: "/orders/add")
        } else {
            screen
        }
    }

    private var screen: some View {
        ShelfState(loaded: book.orders.loaded, error: book.orders.error, offline: book.orders.offline) {
            // Read through `items`: the shelf's lookup is not observed, so a change would not redraw.
            if let order = book.orders.items.first(where: { $0.id == id }) {
                detail(order)
            } else {
                ContentUnavailableView("Order not found", systemImage: "list.clipboard", description: Text("\(id) is not in the book."))
            }
        }
        .navigationTitle(id)
        .navigationBarTitleDisplayMode(.inline)
        .ordersWebDestination($web)
        .orderUndo($undo, open: $web)
        .ordersFailureAlert($failure)
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
        let stage = stageOf(order, owedOnInvoice: owed)
        let now = Date()
        return List { Group {
            heroSection(order, stage: stage, now: now)
            if OrdersLogic.hasInvoice(order) {
                invoiceSection(order, invoice: invoice, owed: owed)
            } else {
                moneySection(order)
            }
            if let told { toldSection(told) }
            if OrdersLogic.isOnline(order) {
                OrderOnlineSection(order: order, openWeb: { web = $0 }, leopards: { leopardsOpen = true })
            }
            piecesSection(order)
            detailsSection(order)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .modifier(HouseGround())
        .safeAreaBar(edge: .bottom, spacing: 0) { actionBar(order, stage: stage, owed: owed) }
        .toolbar { orderToolbar(order) }
        .sheet(isPresented: $advancing) { advanceSheet(order) }
        .sheet(isPresented: $booking) { OrderCourierSheet(order: order) }
        .sheet(isPresented: $tracking) { OrderTrackingSheet(order: order) }
        .sheet(isPresented: $leopardsOpen) { OrderLeopardsSheet(order: order) }
        .sheet(isPresented: $notifying) { OrderNotifySheet(order: order) }
        .sheet(isPresented: $checkingTransfer) {
            OnlineMoveSheet(order: order, kind: .paid) { t in told = t }
        }
        .confirmationDialog("Cancel order \(order.id)?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel order", role: .destructive) { setStatus(order, "Cancelled") }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text(OrdersLogic.cancelWords)
        }
    }

    private func invoiceOf(_ order: Order) -> Invoice? {
        guard let invoiceId = order.invoiceId, !invoiceId.isEmpty else { return nil }
        return book.invoices.items.first(where: { $0.id == invoiceId })
    }

    // MARK: Who, when, how far

    @ViewBuilder
    private func heroSection(_ order: Order, stage: OrderStage, now: Date) -> some View {
        let phone = (order.customerContact ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        Section {
            whoRow(order, phone: phone)
                .listRowSeparator(.hidden)
            if !CustomerKit.dialable(phone).isEmpty {
                ContactActions(phone: phone)
                    .padding(.bottom, 4)
                    .listRowSeparator(.hidden)
            }
            promiseRow(order, now: now)
                .listRowSeparator(.hidden)
            standingRow(order, stage: stage)
        }
    }

    /// The customer's name opens their page, as it did on the old Customer row.
    @ViewBuilder
    private func whoRow(_ order: Order, phone: String) -> some View {
        if let cid = order.customerId, !cid.isEmpty {
            NavigationLink(value: Route(path: "/customers/\(cid)")) {
                who(order, phone: phone)
            }
        } else {
            who(order, phone: phone)
        }
    }

    private func who(_ order: Order, phone: String) -> some View {
        let name = OrdersLogic.customerName(order)
        let online = OrdersLogic.isOnline(order)
        return HStack(spacing: 14) {
            Monogram(name: name, size: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .lineLimit(2)
                if !phone.isEmpty || online {
                    HStack(spacing: 8) {
                        if !phone.isEmpty {
                            Text(OrdersLogic.phoneWords(phone))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .lineLimit(1)
                        }
                        if online { OrdersOnlineBadge() }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
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

    /// Booked → Making → Ready → Invoiced; a cancelled or refunded order says so instead.
    @ViewBuilder
    private func standingRow(_ order: Order, stage: OrderStage) -> some View {
        if stage == .closed {
            HStack {
                Pill(order.status.rawValue.isEmpty ? "Closed" : order.status.rawValue, tone: .quiet)
                Spacer(minLength: 0)
            }
        } else {
            StageTrack(stage: stage, labels: true)
                .padding(.vertical, 4)
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
        Section {
            // The page's own sums, so the three always add up: the pieces less the discount, what has come in
            // (the cash advances and the gold taken in exchange), and the balance due (OrdersLogic.balance).
            MoneySplit(total: subtotal - discount, paid: order.advancePayment + exchangeValue,
                       due: OrdersLogic.balance(order), paidLabel: "Advance")
                .padding(.vertical, 6)
            if !rates.isEmpty {
                Text(rates)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            LabeledContent("Pieces", value: Money.pkr(subtotal))
            if discount > 0 { deduction("Discount", discount) }
            if order.advancePayment > 0 { deduction("Advance paid", order.advancePayment) }
            // Each advance with its day and how it was paid: these become the invoice's payments. One advance is
            // the "Advance paid" line above, so it is listed only when there are several.
            if lines.count > 1 {
                ForEach(lines) { l in advanceLine(l) }
            }
            if exchangeValue > 0 { deduction("Taken in exchange", exchangeValue) }
            ForEach(Array(exchanges.enumerated()), id: \.offset) { pair in
                exchangeLine(pair.element, showValue: exchanges.count > 1)
            }
            // The shop's margin: owners and staff, never a customer, never in a house that does not cost by
            // gold, and blurred until tapped (docs/decisions.md "Margin").
            if OrdersLogic.marginIsOn(House.margin) {
                OrdersMarginRow(order: order)
            }
        } header: {
            LedgerHeading(title: "Money")
        }
    }

    /// A sum taken off the pieces: quiet, with a real minus. Red is for what is late, never for a discount.
    private func deduction(_ label: String, _ amount: Double) -> some View {
        LabeledContent(label) {
            Text("\u{2212} " + Money.pkr(amount))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }

    private func advanceLine(_ l: OrdersLogic.AdvanceLine) -> some View {
        let words = [ShopDate.say(l.date), l.method, l.note].filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(alignment: .firstTextBaseline) {
            Text(words)
            Spacer(minLength: 8)
            Text(Money.pkr(l.amount)).monospacedDigit()
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
                HStack {
                    Label("Invoiced · \(invoiceId)", systemImage: "doc.text")
                    Spacer(minLength: 8)
                    if owed > 0.5 {
                        Text(Money.pkr(owed) + " owed")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Tone.owed.color)
                            .monospacedDigit()
                    }
                }
            }
            if let inv = invoice, inv.discountAmount > 0 {
                LabeledContent("Pieces", value: Money.pkr(inv.subtotal))
                deduction("Discount", inv.discountAmount)
            }
            if OrderActions.canUndoInvoice(order, isOwner: session.isOwner) {
                Button(role: .destructive) { undo = OrderUndo.undoInvoice(order) } label: {
                    Label("Cancel invoice", systemImage: "arrow.uturn.backward")
                }
                Button { undo = OrderUndo.unlockAndEdit(order) } label: {
                    Label("Unlock & edit", systemImage: "lock.open")
                }
            }
        } header: {
            LedgerHeading(title: "Money")
        } footer: {
            Text("The order is locked; to change it, revert the invoice first.")
        }
    }

    /// What the bar's Check transfer said once the transfer was booked, as the online section says it.
    private func toldSection(_ t: OnlineTold) -> some View {
        Section {
            Label(t.words, systemImage: t.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.subheadline)
                .foregroundStyle(t.ok ? Tone.settled.color : Tone.owed.color)
        }
    }

    // MARK: Pieces

    private func piecesSection(_ order: Order) -> some View {
        let invoiced = OrdersLogic.hasInvoice(order)
        let counts = pieceCounts(order.items)
        return Section {
            ForEach(order.items.indices, id: \.self) { i in
                OrderPieceRow(
                    index: i,
                    item: order.items[i],
                    karigar: karigarName(order.items[i]),
                    canTick: session.isOwner && !invoiced,
                    busy: ticking == i,
                    showBreakdown: session.isOwner
                ) { done in
                    tick(order, i, done)
                }
            }
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
            LedgerHeading(title: "Pieces", count: counts.total,
                          trailing: counts.total > 0 ? "\(counts.done) of \(counts.total) done" : nil)
        }
    }

    private func karigarName(_ item: OrderItem) -> String? {
        guard OrdersLogic.hasKarigar(item), let kid = item.karigarId else { return nil }
        return book.karigars.items.first(where: { $0.id == kid })?.name ?? "Karigar " + kid
    }

    // MARK: Details: the quieter facts

    /// What the form captured and the bench and the counter both need: the status, who took the order and
    /// when, how they found us, where it goes, any notes.
    @ViewBuilder
    private func detailsSection(_ order: Order) -> some View {
        let taken = ShopDate.say(order.createdAt, withTime: true)
        let shipTo = describeDelivery(order.delivery)
        Section {
            statusRow(order)
            if let by = order.takenBy, !by.isEmpty {
                LabeledContent("Taken by", value: by)
            }
            if !taken.isEmpty {
                LabeledContent("Taken on", value: taken)
            }
            if let source = order.source {
                LabeledContent("Found us via", value: OrdersLogic.sourceLabel(source))
            }
            if !shipTo.isEmpty {
                LabeledContent("Deliver to") {
                    Text(shipTo.joined(separator: "\n")).multilineTextAlignment(.trailing)
                }
            }
            if let notes = order.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Notes").font(.caption).foregroundStyle(.secondary)
                    Text(notes)
                }
            }
        } header: {
            LedgerHeading(title: "Details")
        }
    }

    /// The status is a menu: Pending, In Progress, Completed, Cancelled. Never a bare Refunded
    /// (Refund order in the ERP does a refund). Cancel asks first.
    private func statusRow(_ order: Order) -> some View {
        LabeledContent("Status") {
            if updatingStatus {
                SkeletonLoading()
            } else {
                Menu {
                    ForEach(OrdersLogic.settableStatuses, id: \.self) { s in
                        Button { choose(order, s) } label: {
                            if s == order.status.rawValue { Label(s, systemImage: "checkmark") } else { Text(s) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Pill(order.status.rawValue.isEmpty ? "No status" : order.status.rawValue,
                             tone: OrdersTone.status(order.status))
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityLabel("Status: \(order.status.rawValue)")
            }
        }
    }

    // MARK: The bar: the next step

    /// The order's next step at the foot of the page (OrdersLogic.nextStep, as the hub's card has it), as an
    /// invoice's Take payment: one filled button, and an Advance beside it while the order is being made
    /// (owners). Nothing for a cancelled or refunded order, or for one invoiced and paid.
    @ViewBuilder
    private func actionBar(_ order: Order, stage: OrderStage, owed: Double) -> some View {
        let step = barStep(order, stage: stage, owed: owed)
        let advance = OrdersLogic.offersAdvance(order, stage: stage, isOwner: session.isOwner)
        if stage != .closed && (step != nil || advance) {
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    if let step {
                        stepButton(order, step)
                        if advance {
                            Button { advancing = true } label: { Label("Advance", systemImage: "creditcard") }
                                .buttonStyle(.glass)
                                .controlSize(.large)
                                .accessibilityLabel("Record an advance")
                        }
                    } else {
                        Button { advancing = true } label: {
                            Label("Record an advance", systemImage: "creditcard")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.houseProminent)
                        .controlSize(.large)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }

    /// The hub's step, less what the foot of this page should not offer: an invoice only while it is owed (a
    /// paid one is the money card's link), the transfer only to the accounts the server lets move it
    /// (lib/website/staff-gate.ts).
    private func barStep(_ order: Order, stage: OrderStage, owed: Double) -> OrderNextStep? {
        guard let step = OrdersLogic.nextStep(order, stage: stage, owed: owed) else { return nil }
        switch step {
        case .invoice(_, let due): return due > 0.5 ? step : nil
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
        } else {
            Button { run(order, step) } label: {
                Group {
                    if updatingStatus && step == .markReady {
                        SkeletonLoading()
                    } else {
                        Label(step.title, systemImage: step.symbol)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .disabled(updatingStatus)
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
    private func orderToolbar(_ order: Order) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                if session.isOwner && OrdersLogic.canAdvance(order) {
                    Button { advancing = true } label: { Label("Record an advance", systemImage: "creditcard") }
                }
                if !OrdersLogic.hasInvoice(order) && (order.status == .completed || order.status == .inProgress) {
                    Button { web = .finalize(order.id) } label: { Label("Finalize & invoice", systemImage: "doc.text") }
                }
                // Changing an order is an owner's, as in the browser.
                if session.isOwner && !OrdersLogic.hasInvoice(order) {
                    Button { web = .edit(order.id) } label: { Label("Edit order", systemImage: "pencil") }
                }
                // The workshop slip: printed, saved or sent from the share sheet.
                Button { web = .slip(order.id) } label: { Label("Print slip", systemImage: "printer") }
                Button { notifying = true } label: { Label("Send to customer", systemImage: "message") }
                if let cn = OrderActions.tcsConsignment(order) {
                    Button { tracking = true } label: { Label("Track \(cn)", systemImage: "shippingbox") }
                }
                if OrderActions.canBookCourier(order, isOwner: session.isOwner) {
                    Button { booking = true } label: { Label("Book courier", systemImage: "truck.box") }
                }
                if session.isOwner { Divider() }
                if OrderActions.canRefund(order, isOwner: session.isOwner) {
                    Button(role: .destructive) { undo = OrderUndo.refund(order) } label: { Label("Refund order", systemImage: "arrow.uturn.backward") }
                }
                if session.isOwner, let why = OrderActions.deleteBlocked(order) {
                    Button {} label: { Label(why, systemImage: "trash") }.disabled(true)
                } else if OrderActions.canDelete(order, isOwner: session.isOwner) {
                    Button(role: .destructive) { undo = OrderUndo.delete(order) } label: { Label("Delete order", systemImage: "trash") }
                }
                Divider()
                // Giving a piece out, and anything else the page has.
                Button { web = .orderPage(order.id) } label: { Label("Open in the ERP", systemImage: "globe") }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
        }
    }

    private func advanceSheet(_ order: Order) -> some View {
        let balance = OrdersLogic.balance(order)
        // The note is the web's own default; it can be changed, and needs three characters (order-dialogs.tsx).
        return PaymentSheet(title: "Record an advance", owed: balance > 0 ? balance : nil, note: "Advance payment received") { amount, method, note in
            _ = try await ERPAPI.shared.write("recordOrderAdvance", [
                "orderId": order.id,
                "amount": amount,
                "method": method,
                "notes": note,
            ])
        }
    }

    // MARK: Writes

    private func choose(_ order: Order, _ status: String) {
        if status == order.status.rawValue { return }
        if status == "Cancelled" { confirmCancel = true } else { setStatus(order, status) }
    }

    private func setStatus(_ order: Order, _ status: String) {
        if updatingStatus { return }
        updatingStatus = true
        Task { @MainActor in
            do {
                _ = try await ERPAPI.shared.write("setOrderStatus", ["orderId": order.id, "status": status])
            } catch {
                failure = error.localizedDescription
            }
            updatingStatus = false
        }
    }

    /// Owners tick a piece done; the last one finishes the order, and unticking a finished one sends it
    /// back to the karigars (the server works that out: lib/order-stage.ts).
    private func tick(_ order: Order, _ index: Int, _ done: Bool) {
        if ticking != nil { return }
        ticking = index
        Task { @MainActor in
            do {
                _ = try await ERPAPI.shared.write("setPieceDone", ["orderId": order.id, "index": index, "done": done])
            } catch {
                failure = error.localizedDescription
            }
            ticking = nil
        }
    }
}
