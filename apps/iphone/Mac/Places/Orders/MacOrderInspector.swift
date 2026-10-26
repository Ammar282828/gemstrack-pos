#if os(macOS)
import SwiftUI
import ERPCore

// The Orders inspector (docs/features/mac-design.md, "Orders"): the picked order at the right of the list. A plain head
// (customer, number, stage, the figure that matters, its next step as the default button), then its promise, its pieces
// with the karigar a pop-up and the done tick inline, its advances and its details, as a grouped form. The writes are the
// order page's own (setPieceDone, setPieceKarigar through the Outbox); the order's other actions are the place's.

struct MacOrderInspector: View {
    let orderID: String
    /// Statuses just chosen in the place, shown before the shelf's copy catches up.
    let localStatus: [String: String]
    /// The Order menu's actions for this order, as the place builds them (its sheets and windows are the place's).
    let actions: (Order, OrderStage, Double) -> [[MacAction]]
    /// Opens a record (a customer, the invoice) in a window of its own.
    let openRoute: (String) -> Void

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    /// What the person just did, shown before the shelf's copy catches up (dropped once the shelf agrees).
    @State private var localDone: [Int: Bool] = [:]
    @State private var localKarigar: [Int: String] = [:]
    /// The karigars worked out from the shelf, kept until it changes (never walked while drawing).
    @State private var liveKarigars = Memo<[Karigar]>()
    @State private var karigarNames = Memo<[String: String]>()

    var body: some View {
        Group {
            if let order = book.orders.item(orderID) {
                panel(order)
            } else {
                MacInspectorEmpty(title: "Order Not Found", detail: "\(orderID) is not in the book.")
            }
        }
        .onAppear {
            book.karigars.need()
            book.invoices.need()
        }
    }

    // MARK: The panel

    private func panel(_ order: Order) -> some View {
        let invoice = invoiceOf(order)
        let invoiceOwed = MacOrdersLogic.invoiceOwed(invoice)
        let stage = MacOrdersLogic.stage(order, invoiceOwed: invoiceOwed, local: localStatus[order.id])
        let owed = MacOrdersLogic.owed(order, stage: stage, invoiceOwed: invoiceOwed)
        let worth = MacOrdersLogic.worth(order, invoice: invoice)
        let buttons = MacOrdersMenu.pick(actions(order, stage, invoiceOwed), ["next", "advance"]).filter { $0.enabled }.map(shortened)
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                head(order, invoice: invoice, stage: stage, owed: owed, worth: worth, buttons: buttons)
                cards(order, invoice: invoice, stage: stage, worth: worth)
            }
            .padding(14)
        }
        .background(Theme.ground)
        .onChange(of: signature(order)) { _, _ in reconcile(order) }
    }

    // MARK: The head: the iPhone's order page head at an inspector's width

    private func head(_ order: Order, invoice: Invoice?, stage: OrderStage, owed: Double, worth: Double, buttons: [MacAction]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Monogram(name: OrdersLogic.customerName(order), size: Monogram.Size.hero)
                VStack(alignment: .leading, spacing: 3) {
                    Text(OrdersLogic.customerName(order))
                        .font(.system(.title3, design: .serif).weight(.semibold))
                        .lineLimit(2).textSelection(.enabled)
                    Text(caption(order)).font(.callout).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Pill(MacOrdersLogic.words(order, stage: stage), tone: MacOrdersLogic.tone(stage))
                Spacer(minLength: 0)
            }
            if stage != .closed {
                hero(owed: owed, worth: worth)
                StageTrack(stage: stage, labels: true)
                PaidBar(paid: paidSoFar(order, invoice: invoice), total: worth)
            }
            if !buttons.isEmpty { MacActionButtons(actions: buttons) }
            reach(order)
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }

    /// The one big figure: what is owed, what is in credit, or the total once paid.
    private func hero(owed: Double, worth: Double) -> some View {
        let label = owed >= 1 ? "Owed" : (isCredit(owed) ? "In credit" : "Paid")
        let amount = owed >= 1 ? owed : (isCredit(owed) ? -owed : worth)
        let tone: Color = owed >= 1 ? Tone.owed.color : (isCredit(owed) ? Tone.credit.color : Tone.settled.color)
        return VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text("PKR").font(.system(.callout, design: .serif).weight(.medium)).foregroundStyle(.secondary)
                Text(HeroAmount.figure(amount, lac: false))
                    .font(.system(.title, design: .serif).weight(.semibold))
                    .foregroundStyle(tone).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            }
        }
    }

    private func paidSoFar(_ order: Order, invoice: Invoice?) -> Double {
        invoice.map { $0.amountPaid } ?? MacOrdersLogic.paid(order)
    }

    /// Call and WhatsApp, the iPhone's quick actions as a row of buttons.
    @ViewBuilder
    private func reach(_ order: Order) -> some View {
        if !CustomerKit.dialable(order.customerContact).isEmpty {
            HStack(spacing: 8) {
                QuickAction(title: "Call", symbol: "phone.fill") { go(CustomerKit.callURL(order.customerContact)) }
                QuickAction(title: "WhatsApp", symbol: "message.fill") { go(CustomerKit.whatsAppURL(order.customerContact)) }
            }
        }
    }

    private func go(_ url: URL?) {
        if let url { openURL(url) }
    }

    // MARK: The cards

    private func cards(_ order: Order, invoice: Invoice?, stage: OrderStage, worth: Double) -> some View {
        let invoiced = OrdersLogic.hasInvoice(order)
        let counts = pieceCounts(order.items)
        let live = liveKarigars([book.karigars.revision]) { workshopLive(book.karigars.items) }
        let karigars: [Karigar] = session.isOwner && !invoiced ? live : []
        let lines = OrdersLogic.advanceLines(order)
        return VStack(alignment: .leading, spacing: 14) {
            promiseSection(order)
            card("Pieces", trailing: counts.total > 0 ? "\(doneCount(order)) of \(counts.total) done" : nil) {
                if order.items.isEmpty {
                    Text("No pieces on this order.").foregroundStyle(.secondary)
                }
                ForEach(order.items.indices, id: \.self) { (i: Int) in
                    if i > 0 { Divider() }
                    pieceRow(order, i, invoiced: invoiced, karigars: karigars)
                }
            }
            if !lines.isEmpty && !invoiced {
                card("Advances") {
                    ForEach(lines) { (l: OrdersLogic.AdvanceLine) in
                        if l.id != lines.first?.id { Divider() }
                        advanceRow(l)
                    }
                }
            }
            moneySection(order, worth: worth, invoice: invoice, stage: stage)
            detailsSection(order, invoice: invoice)
        }
    }

    /// A card: its heading in the serif with a figure beside it, then its rows.
    private func card<C: View>(_ title: String, trailing: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LedgerHeading(title: title, trailing: trailing)
            content()
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }

    /// A label and its value on one line.
    private func line<V: View>(_ label: String, @ViewBuilder _ value: () -> V) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            value().multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }

    /// "Next Step: Make invoice" is too long for two buttons side by side in the inspector's column: the step's own words.
    private func shortened(_ a: MacAction) -> MacAction {
        guard a.id == "next" else { return a }
        var b = a
        b.title = a.title.replacingOccurrences(of: "Next Step: ", with: "")
        return b
    }

    private func headline(owed: Double, worth: Double, stage: OrderStage) -> MacHeadline? {
        if stage == .closed { return nil }
        if owed >= 1 { return MacHeadline("Owed", Money.pkr(owed), tone: .owed) }
        if isCredit(owed) { return MacHeadline("In credit", Money.pkr(-owed), tone: .credit) }
        return worth >= 1 ? MacHeadline("Paid", Money.pkr(worth), tone: .settled) : nil
    }

    /// "ORD-12 · taken Tue 6 Oct · by Sana".
    private func caption(_ order: Order) -> String {
        var parts = [order.id]
        let said = ShopDate.say(order.createdAt)
        if !said.isEmpty {
            parts.append("taken " + (["Today", "Yesterday", "Tomorrow"].contains(said) ? said.lowercased() : said))
        }
        if let by = order.takenBy, !by.isEmpty { parts.append("by " + by) }
        return parts.joined(separator: " \u{00B7} ")
    }

    private func invoiceOf(_ order: Order) -> Invoice? {
        guard let id = order.invoiceId, !id.isEmpty else { return nil }
        return book.invoices.item(id)
    }

    // MARK: The promise

    @ViewBuilder
    private func promiseSection(_ order: Order) -> some View {
        let p = OrdersLogic.promise(order, now: Date())
        if OrdersLogic.isOpen(order) || !p.undated {
            card("Promised") {
                Text(OrdersLogic.promiseLine(order, now: Date()))
                    .font(.callout)
                    .foregroundStyle(p.tone == .quiet ? Color.primary : p.tone.color)
                if p.urgent && p.state != .late {
                    Text("Inside the bench week").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Pieces

    private func doneCount(_ order: Order) -> Int {
        order.items.indices.filter { localDone[$0] ?? order.items[$0].isCompleted }.count
    }

    private func karigarID(_ item: OrderItem) -> String {
        OrdersLogic.hasKarigar(item) ? (item.karigarId ?? "none") : "none"
    }

    private func pieceRow(_ order: Order, _ i: Int, invoiced: Bool, karigars: [Karigar]) -> some View {
        let item = order.items[i]
        let done = localDone[i] ?? item.isCompleted
        let facts = OrderPieceRow.facts(item).joined(separator: " \u{00B7} ")
        return HStack(alignment: .top, spacing: 8) {
            tick(order, i, done: done, canTick: session.isOwner && !invoiced)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.description.isEmpty ? "Piece \(i + 1)" : item.description)
                    .foregroundStyle(done ? Color.secondary : Color.primary)
                    .lineLimit(2)
                if !facts.isEmpty {
                    Text(facts).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                karigarCell(order, i, item: item, done: done, karigars: karigars)
            }
            Spacer(minLength: 4)
            if let total = item.totalEstimate {
                Text(Money.pkr(total)).monospacedDigit().font(.callout)
            }
        }
    }

    @ViewBuilder
    private func tick(_ order: Order, _ i: Int, done: Bool, canTick: Bool) -> some View {
        if canTick {
            Button {
                localDone[i] = !done
                MacOrdersWrites.tick(order, i, !done)
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? Tone.settled.color : Color.secondary)
            }
            .buttonStyle(.borderless)
            .help(done ? "Done: click to mark not done" : "Mark as complete")
        } else {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? Tone.settled.color : Color.secondary.opacity(0.5))
        }
    }

    @ViewBuilder
    private func karigarCell(_ order: Order, _ i: Int, item: OrderItem, done: Bool, karigars: [Karigar]) -> some View {
        let current = localKarigar[i] ?? karigarID(item)
        if !karigars.isEmpty {
            Picker("Karigar", selection: Binding(get: { current }, set: { assign(order, i, $0) })) {
                Text("Unassigned").tag("none")
                ForEach(karigars) { (k: Karigar) in Text(k.name).tag(k.id) }
                if current != "none" && !karigars.contains(where: { $0.id == current }) {
                    Text(karigarName(current)).tag(current)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .controlSize(.small)
            .frame(maxWidth: 200, alignment: .leading)
        } else if current != "none" {
            Text(karigarName(current)).font(.callout).foregroundStyle(.secondary)
        } else if !done {
            Text("Not given out").font(.callout).foregroundStyle(Tone.owed.color)
        }
    }

    private func karigarName(_ id: String) -> String {
        let names = karigarNames([book.karigars.revision]) { () -> [String: String] in
            var out: [String: String] = [:]
            for k in book.karigars.items where out[k.id] == nil { out[k.id] = k.name }
            return out
        }
        return names[id] ?? "Karigar " + id
    }

    private func assign(_ order: Order, _ i: Int, _ karigarId: String) {
        guard order.items.indices.contains(i), (localKarigar[i] ?? karigarID(order.items[i])) != karigarId else { return }
        localKarigar[i] = karigarId
        MacOrdersWrites.assign(order, i, karigarId)
    }

    private func signature(_ order: Order) -> String {
        order.items.map { "\($0.isCompleted ? 1 : 0)\($0.karigarId ?? "none")" }.joined(separator: ",")
    }

    /// Drop what the shelf now agrees with.
    private func reconcile(_ order: Order) {
        for (i, v) in localDone where !order.items.indices.contains(i) || order.items[i].isCompleted == v { localDone[i] = nil }
        for (i, v) in localKarigar where !order.items.indices.contains(i) || karigarID(order.items[i]) == v { localKarigar[i] = nil }
    }

    // MARK: Advances, money

    private func advanceRow(_ l: OrdersLogic.AdvanceLine) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text([ShopDate.say(l.date), l.method].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                Spacer(minLength: 8)
                if l.amount > 0 || l.gold.isEmpty { Text(Money.pkr(l.amount)).monospacedDigit() }
            }
            if !l.note.isEmpty { Text(l.note).font(.caption).foregroundStyle(.secondary) }
            if !l.gold.isEmpty { Text(l.gold).font(.caption).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder
    private func moneySection(_ order: Order, worth: Double, invoice: Invoice?, stage: OrderStage) -> some View {
        if stage != .closed {
            card("Money") {
                line("Total") { Text(Money.pkr(worth)).monospacedDigit() }
                if invoice == nil && OrdersLogic.discount(order) > 0 {
                    line("Discount") { Text("\u{2212} " + Money.pkr(OrdersLogic.discount(order))).monospacedDigit() }
                }
                line("Paid") { Text(Money.pkr(paidSoFar(order, invoice: invoice))).monospacedDigit() }
            }
        }
    }

    // MARK: Details

    @ViewBuilder
    private func detailsSection(_ order: Order, invoice: Invoice?) -> some View {
        let cid = order.customerId ?? ""
        let phone = (order.customerContact ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let by = order.takenBy ?? ""
        let shipTo = describeDelivery(order.delivery)
        let note = (order.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        card("Details") {
            if !cid.isEmpty {
                line("Customer") {
                    Button(OrdersLogic.customerName(order)) { openRoute("/customers/\(cid)") }.buttonStyle(.link)
                }
            }
            if !phone.isEmpty { line("Phone") { Text(OrdersLogic.phoneWords(phone)) } }
            if !by.isEmpty { line("Taken by") { Text(by) } }
            if let source = order.source { line("Found us via") { Text(OrdersLogic.sourceLabel(source)) } }
            if !shipTo.isEmpty {
                line("Deliver to") { Text(shipTo.joined(separator: "\n")) }
            }
            if let id = order.invoiceId, !id.isEmpty {
                line("Invoice") { Button(id) { openRoute("/invoices/\(id)") }.buttonStyle(.link) }
            }
            if !note.isEmpty {
                line("Note") { Text(note).textSelection(.enabled) }
            }
        }
    }
}
#endif
