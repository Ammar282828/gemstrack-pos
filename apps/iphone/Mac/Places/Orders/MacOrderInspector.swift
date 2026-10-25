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
        return VStack(spacing: 0) {
            MacInspectorHeader(
                title: OrdersLogic.customerName(order),
                subtitle: caption(order),
                status: MacStatus(MacOrdersLogic.words(order, stage: stage), tone: MacOrdersLogic.tone(stage)),
                headline: headline(owed: owed, worth: worth, stage: stage),
                actions: buttons
            )
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            Divider()
            form(order, invoice: invoice, stage: stage, worth: worth)
        }
        .onChange(of: signature(order)) { _, _ in reconcile(order) }
    }

    private func form(_ order: Order, invoice: Invoice?, stage: OrderStage, worth: Double) -> some View {
        let invoiced = OrdersLogic.hasInvoice(order)
        let counts = pieceCounts(order.items)
        let live = liveKarigars([book.karigars.revision]) { workshopLive(book.karigars.items) }
        let karigars: [Karigar] = session.isOwner && !invoiced ? live : []
        let lines = OrdersLogic.advanceLines(order)
        return Form {
            promiseSection(order)
            Section {
                if order.items.isEmpty {
                    Text("No pieces on this order.").foregroundStyle(.secondary)
                }
                ForEach(order.items.indices, id: \.self) { (i: Int) in
                    pieceRow(order, i, invoiced: invoiced, karigars: karigars)
                }
            } header: {
                Text(counts.total > 0 ? "Pieces \u{00B7} \(doneCount(order)) of \(counts.total) done" : "Pieces")
            }
            if !lines.isEmpty && !invoiced {
                Section("Advances") {
                    ForEach(lines) { (l: OrdersLogic.AdvanceLine) in advanceRow(l) }
                }
            }
            moneySection(order, worth: worth, invoice: invoice, stage: stage)
            detailsSection(order, invoice: invoice)
        }
        .formStyle(.grouped)
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
            Section {
                LabeledContent("Promised") {
                    Text(OrdersLogic.promiseLine(order, now: Date()))
                        .foregroundStyle(p.tone == .quiet ? Color.primary : p.tone.color)
                        .multilineTextAlignment(.trailing)
                }
                if p.urgent && p.state != .late {
                    LabeledContent("Urgent", value: "Inside the bench week")
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
            Section("Money") {
                LabeledContent("Total", value: Money.pkr(worth))
                if let inv = invoice {
                    LabeledContent("Paid", value: Money.pkr(inv.amountPaid))
                } else {
                    if OrdersLogic.discount(order) > 0 {
                        LabeledContent("Discount", value: "\u{2212} " + Money.pkr(OrdersLogic.discount(order)))
                    }
                    LabeledContent("Paid", value: Money.pkr(MacOrdersLogic.paid(order)))
                }
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
        Section("Details") {
            if !cid.isEmpty {
                LabeledContent("Customer") {
                    Button(OrdersLogic.customerName(order)) { openRoute("/customers/\(cid)") }
                        .buttonStyle(.link)
                }
            }
            if !phone.isEmpty { LabeledContent("Phone", value: OrdersLogic.phoneWords(phone)) }
            if !by.isEmpty { LabeledContent("Taken by", value: by) }
            if let source = order.source { LabeledContent("Found us via", value: OrdersLogic.sourceLabel(source)) }
            if !shipTo.isEmpty {
                LabeledContent("Deliver to") {
                    Text(shipTo.joined(separator: "\n")).multilineTextAlignment(.trailing)
                }
            }
            if let id = order.invoiceId, !id.isEmpty {
                LabeledContent("Invoice") {
                    Button(id) { openRoute("/invoices/\(id)") }.buttonStyle(.link)
                }
            }
            if !note.isEmpty {
                LabeledContent("Note") {
                    Text(note).multilineTextAlignment(.trailing).textSelection(.enabled)
                }
            }
        }
    }
}
#endif
