import SwiftUI
import ERPCore

/// One order (src/app/orders/[id]/page.tsx): who it is for, where it stands, its pieces with their
/// karigars, and the money. Setting the status, ticking a piece done and recording an advance are
/// native; edit, give out, finalize, refund and delete are the ERP's own page, one tap away.
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
        .ordersFailureAlert($failure)
        .onAppear {
            book.orders.need()
            book.invoices.need()
            book.karigars.need()
        }
    }

    private func detail(_ order: Order) -> some View {
        List { Group {
            headerSection(order)
            if OrdersLogic.hasInvoice(order) { invoiceSection(order) }
            if OrdersLogic.isOnline(order) {
                OrderOnlineSection(order: order) { target in web = target }
            }
            piecesSection(order)
            if !OrdersLogic.hasInvoice(order) { moneySection(order) }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .toolbar { orderToolbar(order) }
        .sheet(isPresented: $advancing) { advanceSheet(order) }
        .confirmationDialog("Cancel order \(order.id)?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel order", role: .destructive) { setStatus(order, "Cancelled") }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text(OrdersLogic.cancelWords)
        }
    }

    // MARK: Header

    @ViewBuilder
    private func headerSection(_ order: Order) -> some View {
        Section {
            titleBlock(order)
            customerRow(order)
            contactRow(order)
            statusRow(order)
            LabeledContent("Promised") {
                OrdersPromiseText(order: order, now: Date(), font: .subheadline)
            }
            factRows(order)
        }
    }

    private func titleBlock(_ order: Order) -> some View {
        // Who and how much, as the invoice's page opens: the number is in the title.
        VStack(spacing: 8) {
            Initials(name: OrdersLogic.customerName(order), size: 52)
            Text(Money.pkr(order.grandTotal))
                .font(.system(.largeTitle, design: .rounded).weight(.bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: 6) {
                if OrdersLogic.isOnline(order) { OrdersOnlineBadge() }
                OrdersPaymentBadge(order: order)
            }
            Text("Taken " + ShopDate.say(order.createdAt))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            let rates = OrdersLogic.rateLine(order)
            if !rates.isEmpty {
                Text(rates)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func customerRow(_ order: Order) -> some View {
        let name = OrdersLogic.customerName(order)
        if let cid = order.customerId, !cid.isEmpty {
            NavigationLink(value: Route(path: "/customers/\(cid)")) {
                LabeledContent("Customer", value: name)
            }
        } else {
            LabeledContent("Customer", value: name)
        }
    }

    @ViewBuilder
    private func contactRow(_ order: Order) -> some View {
        if let phone = order.customerContact, !phone.isEmpty {
            LabeledContent("Contact") {
                if let url = URL(string: "tel:" + OrdersLogic.dialable(phone)) {
                    Link(phone, destination: url)
                } else {
                    Text(phone)
                }
            }
        }
    }

    /// The status is a menu: Pending, In Progress, Completed, Cancelled. Never a bare Refunded
    /// (Refund order in the ERP does a refund). Cancel asks first.
    private func statusRow(_ order: Order) -> some View {
        LabeledContent("Status") {
            if updatingStatus {
                ProgressView()
            } else {
                Menu {
                    ForEach(OrdersLogic.settableStatuses, id: \.self) { s in
                        Button { choose(order, s) } label: {
                            if s == order.status.rawValue { Label(s, systemImage: "checkmark") } else { Text(s) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        StatusBadge(order: order.status)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    /// What the form captured and the bench and the counter both need: who took the order, how they
    /// found us, where it goes, any notes.
    @ViewBuilder
    private func factRows(_ order: Order) -> some View {
        if let by = order.takenBy, !by.isEmpty {
            LabeledContent("Taken by", value: by)
        }
        if let source = order.source {
            LabeledContent("Found us via", value: OrdersLogic.sourceLabel(source))
        }
        let shipTo = describeDelivery(order.delivery)
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
    }

    // MARK: Invoiced: the order is locked, the money is the invoice's

    @ViewBuilder
    private func invoiceSection(_ order: Order) -> some View {
        let invoiceId = order.invoiceId ?? ""
        let invoice = book.invoices.items.first(where: { $0.id == invoiceId })
        Section {
            NavigationLink(value: Route(path: "/invoices/\(invoiceId)")) {
                Label("Invoiced as \(invoiceId)", systemImage: "doc.text")
            }
            if let inv = invoice {
                LabeledContent("Subtotal", value: Money.pkr(inv.subtotal))
                if inv.discountAmount > 0 {
                    LabeledContent("Discount") {
                        Text("- " + Money.pkr(inv.discountAmount)).foregroundStyle(.red)
                    }
                }
                LabeledContent("Grand total", value: Money.pkr(inv.grandTotal))
                if inv.amountPaid > 0 {
                    LabeledContent("Paid") {
                        Text(Money.pkr(inv.amountPaid)).foregroundStyle(.green)
                    }
                }
                invoiceBalance(inv)
            }
            Button { web = .orderPage(order.id) } label: {
                Label("Cancel the invoice or unlock the order in the ERP", systemImage: "lock.open")
            }
        } header: {
            Text("Invoice")
        } footer: {
            Text("The order is locked. To change it, revert the invoice in the ERP.")
        }
    }

    private func invoiceBalance(_ inv: Invoice) -> some View {
        let line = balanceLine(inv.balanceDue)
        return LabeledContent(line.label) {
            MoneyText(amount: line.amount, exact: true)
                .font(.title3.weight(.bold))
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
            if counts.unassigned > 0 && !invoiced {
                Button { web = .orderPage(order.id) } label: {
                    Label("Give out: \(counts.unassigned) without a karigar", systemImage: "person.badge.plus")
                }
            }
        } header: {
            HStack {
                Text("Pieces (\(counts.total))")
                Spacer()
                Text("\(counts.done) of \(counts.total) done")
            }
        }
    }

    private func karigarName(_ item: OrderItem) -> String? {
        guard OrdersLogic.hasKarigar(item), let kid = item.karigarId else { return nil }
        return book.karigars.items.first(where: { $0.id == kid })?.name ?? "Karigar " + kid
    }

    // MARK: Money

    @ViewBuilder
    private func moneySection(_ order: Order) -> some View {
        let discount = OrdersLogic.discount(order)
        let exchangeValue = OrdersLogic.exchangeValue(order)
        let lines = OrdersLogic.advanceLines(order)
        let exchanges = orderExchanges(order)
        Section("Money") {
            LabeledContent("Subtotal", value: Money.pkr(OrdersLogic.subtotal(order)))
            if discount > 0 {
                LabeledContent("Discount") {
                    Text("- " + Money.pkr(discount)).foregroundStyle(.red)
                }
            }
            LabeledContent("Advance paid") {
                Text("- " + Money.pkr(order.advancePayment)).foregroundStyle(.red)
            }
            // Each advance with its day and how it was paid: these become the invoice's payments. One
            // advance is the "Advance paid" line above, so it is listed only when there are several.
            if lines.count > 1 {
                ForEach(lines) { l in advanceLine(l) }
            }
            if exchangeValue > 0 {
                LabeledContent("Taken in exchange") {
                    Text("- " + Money.pkr(exchangeValue)).foregroundStyle(.red)
                }
            }
            ForEach(Array(exchanges.enumerated()), id: \.offset) { pair in
                exchangeLine(pair.element, showValue: exchanges.count > 1)
            }
            LabeledContent("Balance due") {
                MoneyText(amount: OrdersLogic.balance(order), exact: true)
                    .font(.title3.weight(.bold))
            }
            // The shop's margin: owners and staff, never a customer, never in a house that does not cost by
            // gold, and blurred until tapped (docs/decisions.md "Margin").
            if OrdersLogic.marginIsOn(House.margin) {
                OrdersMarginRow(order: order)
            }
            if session.isOwner && OrdersLogic.canAdvance(order) {
                Button { advancing = true } label: {
                    Label("Record an advance", systemImage: "creditcard")
                }
            }
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
                // The whole page: edit, give out, finalize, refund, delete.
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
