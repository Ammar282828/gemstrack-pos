import SwiftUI
import ERPCore

/// The Orders hub (src/app/orders/page.tsx, docs/decisions.md "Orders hub"): the list by day to start
/// with (the owner, 2026-10-05), or by stage (what is ready to hand over first, each card carrying its
/// one next step), by when it is due (the open orders, Late first), week or month. In the stage view Done
/// and Cancelled fold away: they are history, not work. The signed-in person's own cards are lit in place,
/// not sorted or filtered.
///
/// The switcher and the status chips are the list's first rows, not a bar pinned over it: pinned, they
/// sat over the large title and greyed it out (2026-10-09).
struct OrdersHub: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL

    @State private var query = ""
    @State private var statusFilter = "All"
    /// Day, Stage or Due (or Week or Month, from the menu), kept on this phone: the owner's Day to start.
    @AppStorage("orders.grouping") private var groupingRaw = OrdersGrouping.day.rawValue
    /// "" is all time, else "yyyy-MM".
    @State private var month = ""
    /// "" is Anyone: everyone's orders to start with, the signed-in person's lit (2026-10-05).
    @State private var takenBy = ""
    /// "All", or Paid / Partial / Unpaid.
    @State private var payment = "All"
    /// The folded stages a person has opened.
    @State private var opened: Set<String> = []
    /// Orders with a write in flight.
    @State private var busy: Set<String> = []
    @State private var advancing: Order?
    @State private var cancelling: Order?
    @State private var web: OrdersWebTarget?
    @State private var failure: String?
    /// Counted so each event is felt once: an advance taken, a status moved.
    @State private var moneyTick = 0
    @State private var savedTick = 0
    /// What an advance or a status move said, as a toast.
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.createMenuShown) private var createMenuShown

    private var inbox: OnlineInbox { .shared }

    var body: some View {
        ShelfState(
            loaded: book.orders.loaded && book.invoices.loaded,
            error: book.orders.error ?? book.invoices.error,
            offline: book.orders.offline
        ) {
            // A new grouping or filter settles in on the enter curve rather than jumping.
            hub.motion([groupingRaw, statusFilter, month, takenBy, payment, stageSignature])
        }
        .navigationTitle("Orders")
        .hubTitleDisplay()
        .searchable(text: $query, prompt: "Order, customer, phone or piece")
        .toolbar { hubToolbar }
        .ordersWebDestination($web)
        .sheet(item: $advancing) { order in advanceSheet(order) }
        .confirmDestructive(isPresented: cancelShown, title: cancelling.map { "Cancel order \($0.id)?" } ?? "Cancel order?",
                            message: OrdersLogic.cancelWords, action: "Cancel order",
                            perform: cancelAction(cancelling))
        .ordersFailureAlert($failure)
        .noteToast($note)
        .moneyFeedback(success: moneyTick, failure: 0)
        .savedFeedback(trigger: savedTick)
        .selectionFeedback(trigger: groupingRaw)
        .onAppear {
            book.orders.need()
            book.invoices.need()
        }
    }

    /// Cancelling the order the dialog was raised for, fixed when the dialog is built (its binding clears
    /// `cancelling` as it closes).
    private func cancelAction(_ order: Order?) -> () -> Void {
        { if let order { setStatus(order, "Cancelled") } }
    }

    /// Every order's status and invoice, so a stage move (Ready, Cancelled, invoiced) settles in on the enter curve.
    private var stageSignature: String {
        book.orders.items.map { $0.id + ($0.status.rawValue) + ($0.invoiceId ?? "") }.joined(separator: "|")
    }

    private var grouping: OrdersGrouping { OrdersGrouping(rawValue: groupingRaw) ?? .day }

    private var groupingChoice: Binding<OrdersGrouping> {
        Binding(get: { grouping }, set: { groupingRaw = $0.rawValue })
    }

    // MARK: The list

    /// Anything narrowing the list: the folded stages and the empty state both ask.
    private var filtering: Bool {
        !query.trimmingCharacters(in: .whitespaces).isEmpty || statusFilter != "All"
            || !month.isEmpty || !takenBy.isEmpty || payment != "All"
    }

    @ViewBuilder
    private var hub: some View {
        let all = book.orders.items
        let owedOn = OrdersLogic.owedOnInvoices(book.invoices.items)
        let scoped = scope(all)
        let shown = statusFilter == "All" ? scoped : scoped.filter { $0.status.rawValue == statusFilter }
        let now = Date()
        let groups = makeSections(shown, owedOn: owedOn, now: now)
        // A search or a filter must reach the folded stages too, or its hits hide behind "Show".
        let forceOpen = filtering
        GeometryReader { geometry in
          if geometry.size.width >= 760 && !typeSize.isAccessibilitySize {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    gridControls()
                    ForEach(groups) { g in
                        VStack(alignment: .leading, spacing: 16) {
                            groupHeading(g)
                            if g.folds {
                                DisclosureGroup(isExpanded: expansion(g.id, forceOpen: forceOpen)) {
                                    cardGrid(g.orders, owedOn: owedOn, now: now, width: geometry.size.width - 48)
                                } label: { Text("\(g.orders.count) orders").font(.subheadline).foregroundStyle(.secondary) }
                            } else { cardGrid(g.orders, owedOn: owedOn, now: now, width: geometry.size.width - 48) }
                        }
                    }
                    if groups.isEmpty { emptyState(nothingOpen: grouping == .due && !shown.isEmpty) }
                }
                .padding(24)
            }
          } else {
            List {
            listControls()
            ForEach(groups) { g in
                section(g, owedOn: owedOn, now: now, forceOpen: forceOpen)
            }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if groups.isEmpty { emptyState(nothingOpen: grouping == .due && !shown.isEmpty) }
            }
          }
        }
    }

    /// Search, Month, Taken by and Payment: everything but the status chip, so the chips can count what
    /// they would show (the web's filteredOrders, orders/page.tsx).
    private func scope(_ all: [Order]) -> [Order] {
        all.filter { order in
            OrdersLogic.matches(order, query)
                && (month.isEmpty || InvoiceCalendar.monthKey(order.createdAt) == month)
                && (takenBy.isEmpty || order.takenBy == takenBy)
                && (payment == "All" || getOrderPaymentStatus(order).rawValue == payment)
        }
    }

    /// Newest first inside every group, as the web sorts before it groups; the Due view soonest first.
    private func makeSections(_ orders: [Order], owedOn: [String: Double], now: Date) -> [OrdersSection] {
        if grouping == .due { return dueSections(orders, now: now) }
        let newest = orders.sorted { OrdersLogic.takenAt($0) > OrdersLogic.takenAt($1) }
        guard let cut = grouping.calendar else { return stageSections(newest, owedOn) }
        var keys: [String] = []
        var info: [String: InvoiceCalendar.Bucket] = [:]
        var members: [String: [Order]] = [:]
        for order in newest {
            let b: InvoiceCalendar.Bucket
            if let d = ERPDate.parse(order.createdAt) {
                b = InvoiceCalendar.bucket(d, by: cut, now: now)
            } else {
                b = InvoiceCalendar.Bucket(key: "undated", title: "No date", hint: "")
            }
            if info[b.key] == nil {
                info[b.key] = b
                keys.append(b.key)
            }
            members[b.key, default: []].append(order)
        }
        // A bare year under a heading says something only when it is not this one.
        let thisYear = String(ERPDate.karachiDay(now).prefix(4))
        return keys.map { key in
            let b = info[key]!
            return OrdersSection(id: key, title: b.title, hint: b.hint == thisYear ? "" : b.hint, tone: .quiet,
                                 folds: false, orders: members[key] ?? [])
        }
    }

    /// The open orders by their promise: Late, Today, This week, Later, No date. Invoiced and closed orders
    /// have no promise left to keep; Day and Stage still show them.
    private func dueSections(_ orders: [Order], now: Date) -> [OrdersSection] {
        OrdersLogic.dueGroups(orders, now: now).map { g in
            OrdersSection(
                id: "due-" + g.bucket.rawValue,
                title: g.bucket.title,
                hint: g.bucket.hint,
                tone: g.bucket == .late ? .late : .quiet,
                folds: false,
                orders: g.orders
            )
        }
    }

    private func stageSections(_ orders: [Order], _ owedOn: [String: Double]) -> [OrdersSection] {
        var byStage: [OrderStage: [Order]] = [:]
        for o in orders {
            let st = stageOf(o, owedOnInvoice: OrdersLogic.owed(o, owedOn))
            byStage[st, default: []].append(o)
        }
        return STAGE_ORDER.compactMap { (st: OrderStage) -> OrdersSection? in
            guard let rows = byStage[st], !rows.isEmpty else { return nil }
            let info = STAGES[st]
            return OrdersSection(
                id: st.rawValue,
                title: info?.title ?? st.rawValue,
                hint: info?.hint ?? "",
                tone: .quiet,
                folds: st == .done || st == .closed,
                orders: rows
            )
        }
    }

    @ViewBuilder
    private func section(_ g: OrdersSection, owedOn: [String: Double], now: Date, forceOpen: Bool) -> some View {
        if g.folds {
            Section {
                DisclosureGroup(isExpanded: expansion(g.id, forceOpen: forceOpen)) {
                    VStack(spacing: 16) {
                        ForEach(g.orders) { order in card(order, owedOn: owedOn, now: now, standalone: true) }
                    }.padding(.top, 12)
                } label: {
                    Text("\(g.orders.count) order\(g.orders.count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                }
                .houseRows()
                .listRowBackground(Theme.ground)
            } header: { groupHeading(g) }
        } else {
            ForEach(Array(g.orders.enumerated()), id: \.element.id) { index, order in
                Section {
                    card(order, owedOn: owedOn, now: now)
                } header: {
                    if index == 0 { groupHeading(g) }
                }
            }
        }
    }

    private func groupHeading(_ g: OrdersSection) -> some View {
        OrdersSectionHeader(
                title: g.title,
                hint: g.hint,
                count: g.orders.count,
                value: g.orders.reduce(0) { $0 + $1.subtotal },
                tone: g.tone
        )
    }

    /// The same columns for every group, so a day with one order keeps a card's width rather than the window's.
    private func cardGrid(_ orders: [Order], owedOn: [String: Double], now: Date, width: CGFloat) -> some View {
        LazyVGrid(columns: CardColumns.grid(width), alignment: .leading, spacing: 20) {
            ForEach(orders) { order in card(order, owedOn: owedOn, now: now, standalone: true) }
        }
    }

    @ViewBuilder
    private func cards(_ orders: [Order], owedOn: [String: Double], now: Date) -> some View {
        ForEach(orders) { order in
            card(order, owedOn: owedOn, now: now)
        }
    }

    private func card(_ order: Order, owedOn: [String: Double], now: Date, standalone: Bool = false) -> some View {
            OrderCardRows(
                order: order,
                stage: stageOf(order, owedOnInvoice: OrdersLogic.owed(order, owedOn)),
                owed: OrdersLogic.owed(order, owedOn),
                now: now,
                isOwner: session.isOwner,
                mine: OrdersLogic.isMine(order, person: session.shop.person),
                busy: busy.contains(order.id),
                actions: actions,
                standalone: standalone,
                showsStage: grouping != .stage
            )
    }

    private func expansion(_ id: String, forceOpen: Bool) -> Binding<Bool> {
        Binding(
            get: { forceOpen || opened.contains(id) },
            set: { open in
                if open { opened.insert(id) } else { opened.remove(id) }
            }
        )
    }

    private func emptyState(nothingOpen: Bool) -> some View {
        Group {
            if !nothingOpen && !query.trimmingCharacters(in: .whitespaces).isEmpty && !narrowed {
                ContentUnavailableView.search(text: query)
            } else if nothingOpen {
                ContentUnavailableView(
                    "Nothing to chase",
                    systemImage: "calendar",
                    description: Text("Every order here is invoiced or closed. Day and Stage show them all.")
                )
            } else {
                ContentUnavailableView {
                    Label("No orders found", systemImage: "list.clipboard")
                } description: {
                    Text(filtering ? "Try adjusting the search or filters." : "Create a custom order to begin.")
                } actions: {
                    if filtering {
                        Button("Clear filters") { clearFilters() }
                            .buttonStyle(.glass)
                    }
                    Button("New order") {
                        web = .newOrder
                    }
                    .buttonStyle(.houseProminent)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    /// Everything that narrows the list, put back: the search, the status, the month, whose and how paid.
    private func clearFilters() {
        query = ""
        statusFilter = "All"
        month = ""
        takenBy = ""
        payment = "All"
    }

    // MARK: Grouping and active filters

    /// Day / Stage / Due: always visible; status and the other filters share the toolbar menu.
    private var groupingPicker: some View {
        let cut = grouping.calendarCut
        let picker = Picker("Show by", selection: groupingChoice) {
            Text(cut.title).tag(cut)
            Text(OrdersGrouping.stage.title).tag(OrdersGrouping.stage)
            Text(OrdersGrouping.due.title).tag(OrdersGrouping.due)
        }
        return Group {
            // Three words do not fit a segmented control at accessibility sizes: a menu then.
            if typeSize.isAccessibilitySize {
                picker.pickerStyle(.menu)
            } else {
                picker.pickerStyle(.segmented)
            }
        }
        // Three words need no more than a phone's width, wherever they are.
        .frame(maxWidth: 480, alignment: .leading)
    }

    private var narrowed: Bool { statusFilter != "All" || !month.isEmpty || !takenBy.isEmpty || payment != "All" }

    /// What the menu has narrowed the list to, with the way back.
    private var filterSummary: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text([statusFilter == "All" ? nil : statusFilter,
                  month.isEmpty ? nil : InvoiceCalendar.monthLabel(month),
                  takenBy.isEmpty ? nil : takenBy,
                  payment == "All" ? nil : payment].compactMap { $0 }.joined(separator: " \u{00B7} "))
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Clear") { statusFilter = "All"; month = ""; takenBy = ""; payment = "All" }
                .font(.footnote.weight(.medium)).buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
        }
    }

    /// The controls as the list's first rows.
    private func listControls() -> some View {
        Section {
            groupingPicker
                .padding(.horizontal, 16)
                .chipRowInList()
            if narrowed {
                filterSummary
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
    }

    /// The same controls on the wide window's page: no list rows, so no list modifiers, and the page's own padding.
    private func gridControls() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            groupingPicker
            if narrowed { filterSummary }
        }
    }

    // MARK: The filter menu: how it is grouped, which month, whose, how paid

    private func filterMenu(_ all: [Order]) -> some View {
        let months = Array(Set(all.compactMap { InvoiceCalendar.monthKey($0.createdAt) })).sorted(by: >)
        // The house's counter names (the web's Taken by list), not whoever happens to appear in the book.
        let people = session.shop.takenBy
        let narrowed = statusFilter != "All" || !month.isEmpty || !takenBy.isEmpty || payment != "All"
        return Menu {
            Picker("Status", selection: $statusFilter) {
                Text("All orders (\(all.count))").tag("All")
                ForEach(OrdersLogic.filterStatuses, id: \.self) { status in
                    Text("\(status) (\(all.filter { $0.status.rawValue == status }.count))").tag(status)
                }
            }
            Picker("Group by", selection: groupingChoice) {
                ForEach(OrdersGrouping.allCases) { g in Text(g.title).tag(g) }
            }
            Picker("Month", selection: $month) {
                Text("All time").tag("")
                ForEach(months, id: \.self) { m in Text(InvoiceCalendar.monthLabel(m)).tag(m) }
            }
            if !people.isEmpty {
                Picker("Taken by", selection: $takenBy) {
                    Text("Anyone").tag("")
                    ForEach(people, id: \.self) { p in Text(p).tag(p) }
                }
            }
            Picker("Payment", selection: $payment) {
                Text("Any payment").tag("All")
                ForEach(OrdersLogic.filterPayments, id: \.self) { p in Text(p).tag(p) }
            }
        } label: {
            Label("Filter", systemImage: narrowed ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var hubToolbar: some ToolbarContent {
        // The tab's own create menu already offers New order beside the rate chip (iPad): one "+" is enough.
        if !createMenuShown {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route(path: "/orders/add")) {
                    Label("New order", systemImage: "plus")
                }
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            filterMenu(book.orders.items)
        }
        // Online orders wait here until a person confirms them (docs/decisions.md "Online orders"): one tap from
        // the hub while any wait, with how many. A house whose website takes no orders (Mina) has none.
        if session.shop.websiteSelling && inbox.waiting > 0 {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route(path: "/orders/online")) {
                    // The count is words in the item, never a badge laid over its glass.
                    Text("Online \(inbox.waiting > 99 ? "99+" : "\(inbox.waiting)")")
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(inbox.waiting)))
                }
                .accessibilityLabel("Online orders, \(inbox.waiting) to confirm")
            }
        }
    }

    // MARK: Actions

    private var actions: OrderCardActions {
        OrderCardActions(
            advance: { order in advancing = order },
            markReady: { order in setStatus(order, "Completed") },
            setStatus: { order, status in choose(order, status) },
            open: { target in web = target },
            contact: { order, kind in reach(order, kind) }
        )
    }

    /// The customer on the order's number: the phone, or their WhatsApp chat.
    private func reach(_ order: Order, _ kind: OrderContactKind) {
        let url = kind == .call ? CustomerKit.callURL(order.customerContact) : CustomerKit.whatsAppURL(order.customerContact)
        if let url { openURL(url) }
    }

    private var cancelShown: Binding<Bool> {
        Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } })
    }

    /// Cancelling asks first; every other status is one tap.
    private func choose(_ order: Order, _ status: String) {
        if status == order.status.rawValue { return }
        if status == "Cancelled" { cancelling = order } else { setStatus(order, status) }
    }

    private func setStatus(_ order: Order, _ status: String) {
        if busy.contains(order.id) { return }
        busy.insert(order.id)
        Task { @MainActor in
            do {
                _ = try await ERPAPI.shared.write("setOrderStatus", ["orderId": order.id, "status": status])
                savedTick += 1
                if status == "Completed" {
                    Note.show(Note(title: "Marked ready", detail: order.id), in: $note, reduce: reduceMotion)
                } else if status == "Cancelled" {
                    Note.show(Note(title: "Order cancelled", detail: order.id), in: $note, reduce: reduceMotion)
                } else {
                    Note.show(Note(title: "Now " + status.lowercased(), detail: order.id), in: $note, reduce: reduceMotion)
                }
            } catch {
                failure = error.localizedDescription
            }
            busy.remove(order.id)
        }
    }

    private func advanced(_ amount: Double) {
        moneyTick += 1
        Note.show(Note(title: "Advance recorded", detail: Money.pkr(amount)), in: $note, reduce: reduceMotion)
    }

    /// An advance from the card: owners only (the ERP refuses anyone else), and never once invoiced.
    /// It carries a note, the web's "Advance payment received" unless the person writes their own.
    private func advanceSheet(_ order: Order) -> some View {
        PaymentSheet(title: "Advance on \(order.id)", owed: order.grandTotal, note: "Advance payment received",
                     settle: { amount, method, _, note, remainder in
                         do {
                             try await OrderAdvance.settle(order, amount: amount, method: method, note: note, remainder: remainder)
                         } catch let e as SettleNotGiven {
                             await MainActor.run { moneyTick += 1 }
                             throw e
                         }
                         await MainActor.run { advanced(amount) }
                     }) { amount, method, note in
            try await OrderAdvance.record(order, amount: amount, method: method, note: note)
            await MainActor.run { advanced(amount) }
        }
    }
}

/// One section of the hub: a stage, a day, week or month, or how soon it is due. Done and Closed fold in
/// the stage view.
private struct OrdersSection: Identifiable {
    let id: String
    let title: String
    let hint: String
    /// Late is red; nothing else is.
    let tone: Tone
    let folds: Bool
    let orders: [Order]
}

/// A section's name in the serif with how many orders it holds beside it and what they come to on the right,
/// and its hint under it ("finished: invoice it", "past the day promised").
struct OrdersSectionHeader: View {
    let title: String
    let hint: String
    let count: Int
    let value: Double
    var tone: Tone = .quiet

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            LedgerHeading(title: title, count: count, trailing: "worth " + Money.pkrLac(value), tone: tone)
                .accessibilityLabel("\(title), \(count) order\(count == 1 ? "" : "s"), worth \(Money.pkrLac(value))")
            if !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .textCase(nil)
        .padding(.top, 4)
        .contentTransition(.numericText(value: value))
        .motion(value)
    }
}
