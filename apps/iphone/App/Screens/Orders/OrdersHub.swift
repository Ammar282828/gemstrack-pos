import SwiftUI
import ERPCore

/// The Orders hub (src/app/orders/page.tsx, docs/decisions.md "Orders hub"): the list by day to start
/// with (the owner, 2026-10-05), or by stage (what is ready to hand over first, each card carrying its
/// one next step), by when it is due (the open orders, Late first), week or month. In the stage view Done
/// and Cancelled fold away: they are history, not work. The signed-in person's own cards are lit in place,
/// not sorted or filtered.
///
/// Laid out as every record list is (RecordList.swift, owner 2026-11-02): the figures, the status chips and the filter
/// line as the list's first rows (pinned, they sat over the large title and greyed it out, 2026-10-09), then a section
/// per group of order rows. Day, Stage, Due, Week or Month is the Filter menu's Group by (the Mac keeps its toolbar
/// switcher).
struct OrdersHub: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL

    /// The Shopify section's own hub (nav entry "shopify", /shopify; owner, 2026-11-09): this same screen over the web orders
    /// ("SHOPIFY-<n>"), with their WhatsApp step, a To confirm chip and an Earlier (invoiced) chip for the old Shopify invoices.
    /// In a house with that section the Orders tab leaves these orders out.
    let shopify: Bool

    init(shopify: Bool = false) { self.shopify = shopify }

    /// The two chips only the Shopify hub has: their `statusFilter` words.
    static let toConfirmKey = "To confirm"
    static let earlierKey = "Earlier"

    @State private var importingCSV = false
    /// The old Shopify invoices by day, per change of the invoices and the search.
    @State private var earlierMemo = Memo<[InvoiceSection]>()
    /// The section's All: the web orders and the old invoices together, a section a day.
    @State private var mixedMemo = Memo<[ShopifyDay]>()
    /// Old Shopify invoices to make orders of (an owner's): set to start the explanation, the delete code and the write.
    @State private var converting: ShopifyConvertRequest?

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
    /// Statuses just chosen, shown before the shelf's copy catches up (order id to status).
    @State private var localStatus: [String: String] = [:]
    @State private var advancing: Order?
    @State private var cancelling: Order?
    @State private var web: OrdersWebTarget?
    /// A card's Print slip goes straight to the share sheet (Print, WhatsApp, Files), without opening it first.
    @State private var slipShare: InvoicePDFTarget?
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

    /// Read once per change of the orders / the invoices, not once per drawing.
    @State private var signature = Memo<Int>()
    @State private var owedMemo = Memo<[String: Double]>()
    /// The strip's figures, per change of the books, Taken by or the day.
    @State private var figuresMemo = Memo<OrdersFigures>()
    /// The searched, filtered and grouped list. Sorting by date parses an ISO string per order, and the body runs for every
    /// tick, toast and busy flag, so it is worked out once per change of the books, the filters or the day.
    @State private var listMemo = Memo<OrdersListSnapshot>()
    /// The Filter menu's months and per-status counts, per change of the orders (each is a pass that parses every date).
    @State private var menuMemo = Memo<OrdersMenuFacts>()
    /// Not the screen on display (another tab, or a page over it): the memos above hand back what they have.
    @State private var covered = false

    var body: some View {
        ShelfState(
            loaded: book.orders.loaded && book.invoices.loaded,
            error: book.orders.error ?? book.invoices.error,
            offline: book.orders.offline,
            shape: .cards
        ) {
            // A new grouping or filter settles in on the enter curve rather than jumping.
            hub.motion([groupingRaw, statusFilter, month, takenBy, payment, String(stageSignature), localStatus.values.joined()])
        }
        .navigationTitle(shopify ? "Shopify" : "Orders")
        .trackCovered($covered)
        .hubTitleDisplay()
        #if os(macOS)
        // The Mac keeps the window toolbar's search; the phone and iPad pull theirs down on the list (hub).
        .searchable(text: $query, placement: .toolbar, prompt: "Order, customer, phone or piece")
        #endif
        .toolbar { hubToolbar }
        .ordersWebDestination($web)
        .pdfQuickShare($slipShare)
        .shopifyConvertFlow($converting) { (r: ShopifyConvertResult) in
            Note.show(r.note, in: $note, reduce: reduceMotion)
        }
        .sheet(item: $advancing) { order in advanceSheet(order).presentationSizing(.form) }
        .sheet(isPresented: $importingCSV) {
            InvoiceCSVImportSheet { (done: InvoiceNote) in
                Note.show(Note(title: done.title, detail: done.detail), in: $note, reduce: reduceMotion)
            }
            .presentationSizing(.form)
        }
        .confirmDestructive(isPresented: cancelShown, title: cancelling.map { "Cancel order \($0.id)?" } ?? "Cancel order?",
                            message: OrdersLogic.cancelWords, action: "Cancel order",
                            perform: cancelAction(cancelling))
        .ordersFailureAlert($failure)
        .noteToast($note)
        .moneyFeedback(success: moneyTick, failure: 0)
        .savedFeedback(trigger: savedTick)
        .onChange(of: stageSignature) { _, _ in
            for o in book.orders.items where localStatus[o.id] == o.status.rawValue { localStatus[o.id] = nil }
        }
        .onChange(of: Outbox.shared.failure?.id) { _, _ in localStatus = [:] }
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
    /// Hashed (not joined into a string) and kept per `orders.revision`, so it costs one pass per change of the orders.
    private var stageSignature: Int {
        signature([book.orders.revision], resting: covered) {
            var h = Hasher()
            for o in book.orders.items {
                h.combine(o.id)
                h.combine(o.status.rawValue)
                h.combine(o.invoiceId ?? "")
            }
            return h.finalize()
        }
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

    /// The orders this hub lists: the Shopify hub's are the web orders alone; Orders' leave them out where the house has the
    /// Shopify section (the Workshop, karigar pages, calendar and customers read the books themselves and keep them).
    private var hubOrders: [Order] {
        let items = book.orders.items
        if shopify { return items.filter { $0.isShopifyOrder } }
        return NavMap.hasShopifySection ? items.filter { !$0.isShopifyOrder } : items
    }

    @ViewBuilder
    private var hub: some View {
        let all = hubOrders
        let owedOn = owedMemo([book.invoices.revision], resting: covered) { OrdersLogic.owedOnInvoices(book.invoices.items) }
        let now = Date()
        let snapshot = listMemo([book.orders.revision, book.invoices.revision, query.hashValue, statusFilter.hashValue, month.hashValue,
                                 takenBy.hashValue, payment.hashValue, groupingRaw.hashValue, localStatus.hashValue,
                                 ERPDate.karachiDay(now).hashValue], resting: covered) {
            let scoped = scope(all)
            let shown: [Order]
            if statusFilter == "All" {
                shown = scoped
            } else if shopify && statusFilter == OrdersHub.earlierKey {
                // The old invoices are listed in place of orders (`earlierSections`).
                shown = []
            } else if shopify && statusFilter == OrdersHub.toConfirmKey {
                shown = scoped.filter { $0.shopifyStage == .toConfirm }
            } else {
                shown = scoped.filter { $0.status.rawValue == statusFilter }
            }
            return OrdersListSnapshot(scoped: scoped, shown: shown, groups: makeSections(shown, owedOn: owedOn, now: now))
        }
        let scoped = snapshot.scoped
        let shown = snapshot.shown
        let groups = snapshot.groups
        // A search or a filter must reach the folded stages too, or its hits hide behind "Show".
        let forceOpen = filtering
        #if os(macOS)
        GeometryReader { geometry in
            if showsBoard(geometry.size.width) {
                stageBoard(groups, owedOn: owedOn, now: now, forceOpen: forceOpen)
            } else {
                list(all: all, scoped: scoped, shown: shown, groups: groups, owedOn: owedOn, now: now, forceOpen: forceOpen)
            }
        }
        #else
        list(all: all, scoped: scoped, shown: shown, groups: groups, owedOn: owedOn, now: now, forceOpen: forceOpen)
        #endif
    }

    /// The record lists' one layout: rows on a phone, a grid of cards on a wide iPad.
    private func list(all: [Order], scoped: [Order], shown: [Order], groups: [OrdersSection], owedOn: [String: Double],
                      now: Date, forceOpen: Bool) -> some View {
        // No figures over the list (owner, 2026-11-03: "remove the upper bar with the summaries in invoices and orders").
        let figures: [ListFigure] = []
        let earlierGroups: [InvoiceSection] = shopify && statusFilter == OrdersHub.earlierKey ? earlierSections(now: now) : []
        // The Shopify section's All: orders and old invoices in one list by day (the stage groups are for the stage chips).
        let mixedAll = shopify && statusFilter == "All"
        let mixed: [ShopifyDay] = mixedAll ? mixedSections(shown, now: now) : []
        let orderGroups: [OrdersSection] = mixedAll ? [] : groups
        return RecordListScaffold(search: $query, prompt: "Order, customer, phone or piece",
                                  isEmpty: orderGroups.isEmpty && earlierGroups.isEmpty && mixed.isEmpty
                                      && (shopify || Outbox.shared.records(kind: "order").isEmpty)) {
            emptyState(nothingOpen: grouping == .due && !shown.isEmpty)
        } rows: {
            head(scoped, figures, inList: true)
            if showsConvertBanner {
                Section { convertBanner }.houseRows()
            }
            if !shopify { PendingRecords(kind: "order") }
            ForEach(mixed) { day in
                Section {
                    ForEach(day.entries) { entry in
                        switch entry {
                        case .order(let order): card(order, owedOn: owedOn, now: now)
                        case .invoice(let inv):
                            InvoiceListRow(invoice: inv, mine: false, dated: false)
                                .zoomSource(id: InvoiceFacts.path(inv.id))
                        }
                    }
                } header: {
                    ListSectionHeader(title: day.title, hint: day.hint, count: day.entries.count,
                                      trailing: Money.pkr(day.worth), value: day.worth)
                }
                .houseRows()
            }
            ForEach(earlierGroups) { g in
                Section {
                    ForEach(g.rows) { inv in
                        InvoiceListRow(invoice: inv, mine: false, dated: false)
                            .zoomSource(id: InvoiceFacts.path(inv.id))
                    }
                } header: {
                    earlierHeading(g)
                }
                .houseRows()
            }
            ForEach(orderGroups) { g in
                section(g, owedOn: owedOn, now: now, forceOpen: forceOpen)
            }
        } cards: { width in
            head(scoped, figures, inList: false)
            if showsConvertBanner { convertBanner }
            if !shopify { PendingRecords(kind: "order", width: width) }
            ForEach(mixed) { day in
                VStack(alignment: .leading, spacing: pt(16)) {
                    ListSectionHeader(title: day.title, hint: day.hint, count: day.entries.count,
                                      trailing: Money.pkr(day.worth), value: day.worth)
                    RecordGrid(items: day.entries, width: width) { (entry: ShopifyEntry) in
                        switch entry {
                        case .order(let order): card(order, owedOn: owedOn, now: now, standalone: true)
                        case .invoice(let inv):
                            RecordCard {
                                InvoiceListRow(invoice: inv, mine: false, dated: false)
                                    .buttonStyle(.pressable)
                                    .zoomSource(id: InvoiceFacts.path(inv.id))
                            }
                        }
                    }
                }
            }
            ForEach(earlierGroups) { g in
                VStack(alignment: .leading, spacing: pt(16)) {
                    earlierHeading(g)
                    RecordGrid(items: g.rows, width: width) { inv in
                        RecordCard {
                            InvoiceListRow(invoice: inv, mine: false, dated: false)
                                .buttonStyle(.pressable)
                                .zoomSource(id: InvoiceFacts.path(inv.id))
                        }
                    }
                }
            }
            ForEach(orderGroups) { g in
                let open = isOpen(g, forceOpen: forceOpen)
                VStack(alignment: .leading, spacing: pt(16)) {
                    groupHeading(g)
                    if g.folds && !forceOpen { foldToggle(g, open: open) }
                    if open {
                        RecordGrid(items: g.orders, width: width) { order in
                            card(order, owedOn: owedOn, now: now, standalone: true)
                        }
                    }
                }
            }
        }
    }

    /// The old Shopify invoices the section's All lists, under the search and the month (an order-only filter, Taken by or
    /// Payment, leaves them out, as it cannot tell them).
    private func shopifyInvoiceRows() -> [Invoice] {
        guard shopify, takenBy.isEmpty, payment == "All" else { return [] }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return book.invoices.items.filter { (inv: Invoice) -> Bool in
            inv.isShopifyOrder
                && (month.isEmpty || InvoiceCalendar.monthKey(inv.createdAt) == month)
                && (q.isEmpty || inv.id.localizedCaseInsensitiveContains(q)
                    || inv.customerName.localizedCaseInsensitiveContains(q)
                    || (inv.shopifyOrderName ?? "").localizedCaseInsensitiveContains(q))
        }
    }

    /// The orders and the old invoices together, newest first, a section a day.
    private func mixedSections(_ orders: [Order], now: Date) -> [ShopifyDay] {
        let invoices = shopifyInvoiceRows()
        let key: [Int] = [book.orders.revision, book.invoices.revision, query.hashValue, month.hashValue, takenBy.hashValue,
                          payment.hashValue, localStatus.hashValue, statusFilter.hashValue, ERPDate.karachiDay(now).hashValue]
        return mixedMemo(key, resting: covered) {
            var rows: [(entry: ShopifyEntry, at: Date?, worth: Double)] = []
            for o in orders { rows.append((entry: ShopifyEntry.order(o), at: ERPDate.parse(o.createdAt), worth: o.subtotal)) }
            for i in invoices { rows.append((entry: ShopifyEntry.invoice(i), at: ERPDate.parse(i.createdAt), worth: invoiceSaleValue(i))) }
            rows.sort { ($0.at ?? Date.distantPast) > ($1.at ?? Date.distantPast) }
            var keys: [String] = []
            var info: [String: InvoiceCalendar.Bucket] = [:]
            var members: [String: [ShopifyEntry]] = [:]
            var worth: [String: Double] = [:]
            for row in rows {
                let b: InvoiceCalendar.Bucket
                if let d = row.at {
                    b = InvoiceCalendar.bucket(d, by: .day, now: now)
                } else {
                    b = InvoiceCalendar.Bucket(key: "undated", title: "No date", hint: "")
                }
                if info[b.key] == nil {
                    info[b.key] = b
                    keys.append(b.key)
                }
                members[b.key, default: []].append(row.entry)
                worth[b.key, default: 0] += row.worth
            }
            let thisYear = String(ERPDate.karachiDay(now).prefix(4))
            return keys.map { (k: String) -> ShopifyDay in
                let b = info[k]!
                return ShopifyDay(id: k, title: b.title, hint: b.hint == thisYear ? "" : b.hint,
                                  entries: members[k] ?? [], worth: worth[k] ?? 0)
            }
        }
    }

    /// Old Shopify invoices an owner can make orders of.
    private var convertible: [Invoice] {
        guard shopify, session.isOwner else { return [] }
        return book.invoices.items.filter { $0.isConvertibleShopifyInvoice }
    }

    private var showsConvertBanner: Bool { !convertible.isEmpty }

    /// "N Shopify sales are still invoices" with the one button that makes them orders.
    private var convertBanner: some View {
        let ids = convertible.map { $0.id }
        let n = ids.count
        return VStack(alignment: .leading, spacing: pt(10)) {
            Label(n == 1 ? "1 Shopify sale is still an invoice" : "\(n) Shopify sales are still invoices", systemImage: "arrow.triangle.2.circlepath")
                .font(.house(.headline))
            Text("Make them orders and their pieces go to the workshop.")
                .font(.house(.subheadline))
                .foregroundStyle(.secondary)
            Button("Make them orders") { converting = ShopifyConvertRequest(ids: ids) }
                .buttonStyle(.houseProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, pt(6))
    }

    private func earlierHeading(_ g: InvoiceSection) -> some View {
        ListSectionHeader(title: g.title, hint: g.hint, count: g.rows.count, trailing: Money.pkr(g.billed), value: g.billed)
    }

    /// Earlier (invoiced): the Shopify invoices from before Shopify's web orders were orders, a section a day, newest first;
    /// each opens its invoice page. The search narrows them; the other filters are the orders'.
    private func earlierSections(now: Date) -> [InvoiceSection] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let invoices = book.invoices.items
        return earlierMemo([book.invoices.revision, q.hashValue], resting: covered) {
            let rows = invoices.filter { (inv: Invoice) -> Bool in
                inv.isShopifyOrder && (q.isEmpty || inv.id.localizedCaseInsensitiveContains(q)
                    || inv.customerName.localizedCaseInsensitiveContains(q)
                    || (inv.shopifyOrderName ?? "").localizedCaseInsensitiveContains(q))
            }.sorted { $0.createdAt > $1.createdAt }
            let stamped = InvoiceStamps(rows)
            var order: [String] = []
            var titles: [String: String] = [:]
            var members: [String: [Invoice]] = [:]
            for inv in rows {
                let key: String
                if let d = stamped.date[inv.id], let day = stamped.day[inv.id] {
                    key = "d" + day
                    if titles[key] == nil { titles[key] = InvoiceCalendar.heading(d, by: .day, now: now) }
                } else {
                    key = "undated"
                    if titles[key] == nil { titles[key] = "No date" }
                }
                if members[key] == nil { order.append(key) }
                members[key, default: []].append(inv)
            }
            return order.map { (key: String) -> InvoiceSection in
                let group = members[key] ?? []
                let billed = group.reduce(0.0) { $0 + invoiceSaleValue($1) }
                let owed = group.reduce(0.0) { $0 + (isOwing($1) ? $1.balanceDue : 0) }
                return InvoiceSection(id: key, title: titles[key] ?? "", hint: "", rows: group, billed: billed, owed: owed)
            }
        }
    }

    /// The strip, the chips and the filter line: the list's first rows, or the grid page's head.
    private func head(_ scoped: [Order], _ figures: [ListFigure], inList: Bool) -> some View {
        RecordListHead(figures: figures, chips: chips(scoped), caption: menuNarrowed ? captionText : nil,
                       clear: { clearMenuFilters() }, inList: inList)
    }

    /// The Mac's stage view is a board of columns; the phone and the iPad keep their lists and card grids.
    private func showsBoard(_ width: CGFloat) -> Bool {
        #if os(macOS)
        return grouping == .stage && width >= 640 && !(shopify && (statusFilter == OrdersHub.earlierKey || statusFilter == "All"))
        #else
        return false
        #endif
    }

    @ViewBuilder
    private func stageBoard(_ groups: [OrdersSection], owedOn: [String: Double], now: Date, forceOpen: Bool) -> some View {
        #if os(macOS)
        VStack(alignment: .leading, spacing: 0) {
            if narrowed { filterSummary.padding(.horizontal, 24).padding(.top, 12) }
            OrdersStageBoard(
                columns: groups.map { OrdersBoardColumn(id: $0.id, title: $0.title, hint: $0.hint, tone: $0.tone, folds: $0.folds, orders: $0.orders) },
                opened: $opened,
                forceOpen: forceOpen
            ) { order in
                card(order, owedOn: owedOn, now: now, standalone: true)
            }
            .overlay { if groups.isEmpty { emptyState(nothingOpen: false) } }
        }
        #else
        EmptyView()
        #endif
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
        // Each date is read once: the comparator would otherwise parse two ISO strings per comparison.
        let dated = orders.map { (order: $0, at: ERPDate.parse($0.createdAt)) }
            .sorted { ($0.at ?? .distantPast) > ($1.at ?? .distantPast) }
        let newest = dated.map { $0.order }
        guard let cut = grouping.calendar else { return stageSections(newest, owedOn) }
        var keys: [String] = []
        var info: [String: InvoiceCalendar.Bucket] = [:]
        var members: [String: [Order]] = [:]
        for (order, at) in dated {
            let b: InvoiceCalendar.Bucket
            if let d = at {
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
            let st = localStage(o, owedOn)
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

    /// A group's rows. Done and Cancelled fold away in the stage view (history, not work) behind one Show row.
    @ViewBuilder
    private func section(_ g: OrdersSection, owedOn: [String: Double], now: Date, forceOpen: Bool) -> some View {
        let open = isOpen(g, forceOpen: forceOpen)
        Section {
            if g.folds && !forceOpen { foldToggle(g, open: open) }
            if open {
                ForEach(g.orders) { order in card(order, owedOn: owedOn, now: now) }
            }
        } header: {
            groupHeading(g)
        }
        .houseRows()
    }

    private func isOpen(_ g: OrdersSection, forceOpen: Bool) -> Bool {
        !g.folds || forceOpen || opened.contains(g.id)
    }

    /// "Show 12 orders" on a folded stage, "Fold away" once it is open.
    private func foldToggle(_ g: OrdersSection, open: Bool) -> some View {
        Button {
            Motion.run(Motion.enter, reduce: reduceMotion) {
                if open { opened.remove(g.id) } else { opened.insert(g.id) }
            }
        } label: {
            Label(open ? "Fold away" : "Show \(g.orders.count) order\(g.orders.count == 1 ? "" : "s")",
                  systemImage: open ? "chevron.up" : "chevron.down")
                .font(.house(.subheadline))
        }
        .buttonStyle(.borderless)
        .frame(minHeight: Metrics.tap)
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

    private func card(_ order: Order, owedOn: [String: Double], now: Date, standalone: Bool = false) -> some View {
            OrderCardRows(
                order: order,
                stage: localStage(order, owedOn),
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

    /// The record lists' one empty state: a search with no hits, filters with Clear, nothing open in the Due view, or
    /// no orders at all with New order.
    private func emptyState(nothingOpen: Bool) -> some View {
        if shopify {
            return RecordEmptyState(
                search: query,
                clear: narrowed ? { clearFilters() } : nil,
                title: "No Shopify orders yet", symbol: "bag",
                message: "Orders from the online store will be here, with the step they are at on WhatsApp.")
        }
        return RecordEmptyState(
            search: nothingOpen ? "" : query,
            clear: !nothingOpen && narrowed ? { clearFilters() } : nil,
            title: nothingOpen ? "Nothing to chase" : "No orders yet",
            symbol: nothingOpen ? "calendar" : "list.clipboard",
            message: nothingOpen ? "Every order here is invoiced or closed. Day and Stage show them all." : "Create a custom order to begin.",
            action: nothingOpen ? nil : .run("New order", { web = .newOrder })
        )
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

    /// Day / Stage / Due: the Mac window toolbar's own switcher (the phone and iPad have it as the Filter menu's Group by).
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

    /// What the Filter menu (not the chips) narrows the list by: the caption's business.
    private var menuNarrowed: Bool { !month.isEmpty || !takenBy.isEmpty || payment != "All" }

    private var captionText: String {
        [month.isEmpty ? nil : InvoiceCalendar.monthLabel(month),
         takenBy.isEmpty ? nil : takenBy,
         payment == "All" ? nil : payment].compactMap { $0 }.joined(separator: " \u{00B7} ")
    }

    private func clearMenuFilters() {
        Motion.run(Motion.enter, reduce: reduceMotion) { month = ""; takenBy = ""; payment = "All" }
    }

    /// What the menu has narrowed the list to, with the way back: the Mac's stage board, which has no list head.
    private var filterSummary: some View {
        ListFilterCaption(text: [statusFilter == "All" ? nil : statusFilter,
                                 month.isEmpty ? nil : InvoiceCalendar.monthLabel(month),
                                 takenBy.isEmpty ? nil : takenBy,
                                 payment == "All" ? nil : payment].compactMap { $0 }.joined(separator: " \u{00B7} ")) {
            statusFilter = "All"; month = ""; takenBy = ""; payment = "All"
        }
    }

    // MARK: The figures and the chips

    /// Owed on the orders (invoiced ones by what their invoice still has owing), how many are open, and how many are
    /// due this week (Late included, in red while any are): the whole book's, or the chosen person's (Taken by), so
    /// they hold still while the list is searched. Due this week taps to the Due view.
    private func summaryFigures(_ all: [Order], owedOn: [String: Double], now: Date) -> [ListFigure] {
        let day = ERPDate.karachiDay(now)
        let f = figuresMemo([book.orders.revision, book.invoices.revision, takenBy.hashValue, day.hashValue], resting: covered) {
            let base = takenBy.isEmpty ? all : all.filter { $0.takenBy == takenBy }
            var f = OrdersFigures()
            for o in base where o.status != .cancelled && o.status != .refunded {
                if OrdersLogic.isOpen(o) { f.open += 1 }
                let due = OrdersLogic.stillOwed(o, invoiceOwed: OrdersLogic.owed(o, owedOn))
                if due >= 1 { f.owed += due; f.owedCount += 1 }
            }
            for g in OrdersLogic.dueGroups(base, now: now) {
                switch g.bucket {
                case .late: f.late += g.orders.count; f.dueSoon += g.orders.count
                case .today, .week: f.dueSoon += g.orders.count
                case .later, .undated: break
                }
            }
            return f
        }
        let dueChosen = grouping == .due
        return [
            ListFigure(id: "owed", title: "Owed on orders", text: Money.pkrLac(f.owed, digits: 1), value: f.owed,
                       tone: f.owed >= 1 ? .owed : nil,
                       spoken: "Owed on orders, \(Money.pkr(f.owed)), \(f.owedCount) order\(f.owedCount == 1 ? "" : "s")"),
            ListFigure(id: "open", title: "Open", text: "\(f.open)", value: Double(f.open),
                       spoken: "\(f.open) open order\(f.open == 1 ? "" : "s")"),
            ListFigure(id: "due", title: "Due this week", text: "\(f.dueSoon)", value: Double(f.dueSoon),
                       tone: f.late > 0 ? .late : nil, chosen: dueChosen,
                       spoken: "Due this week, \(f.dueSoon), \(f.late) late") {
                Motion.run(Motion.enter, reduce: reduceMotion) {
                    groupingRaw = (dueChosen ? OrdersGrouping.day : OrdersGrouping.due).rawValue
                }
            },
        ]
    }

    /// All and the open statuses always; Cancelled and Refunded while there are any (or one is chosen). The counts are
    /// what each would show under the search and the menu's filters.
    private func chips(_ scoped: [Order]) -> [ListChip] {
        var counts: [String: Int] = [:]
        for o in scoped { counts[o.status.rawValue, default: 0] += 1 }
        // The section's All counts the old invoices beside the orders; the stage chips count orders only.
        let allCount = scoped.count + (shopify ? shopifyInvoiceRows().count : 0)
        var out = [ListChip(id: "All", title: "All", count: allCount, chosen: statusFilter == "All") { pickStatus("All") }]
        if shopify {
            // A COD order whose WhatsApp confirmation has not come back.
            let n = scoped.filter { $0.shopifyStage == .toConfirm }.count
            if n > 0 || statusFilter == OrdersHub.toConfirmKey {
                out.append(ListChip(id: OrdersHub.toConfirmKey, title: "To confirm", count: n,
                                    chosen: statusFilter == OrdersHub.toConfirmKey) { pickStatus(OrdersHub.toConfirmKey) })
            }
        }
        for status in OrdersLogic.filterStatuses {
            let n = counts[status] ?? 0
            let always = status == "Pending" || status == "In Progress" || status == "Completed"
            guard always || n > 0 || statusFilter == status else { continue }
            // Sentence case for what a person reads; the filter keeps the ERP's own word.
            let title = status == "In Progress" ? "In progress" : status
            out.append(ListChip(id: status, title: title, count: n, chosen: statusFilter == status) { pickStatus(status) })
        }
        if shopify {
            let n = book.invoices.items.filter { $0.isShopifyOrder }.count
            if n > 0 || statusFilter == OrdersHub.earlierKey {
                out.append(ListChip(id: OrdersHub.earlierKey, title: "Earlier (invoiced)", count: n,
                                    chosen: statusFilter == OrdersHub.earlierKey) { pickStatus(OrdersHub.earlierKey) })
            }
        }
        return out
    }

    private func pickStatus(_ status: String) {
        Motion.run(Motion.enter, reduce: reduceMotion) { statusFilter = status }
    }

    // MARK: The filter menu: how it is grouped, which month, whose, how paid

    private func filterMenu(_ all: [Order]) -> some View {
        let facts = menuMemo([book.orders.revision], resting: covered) {
            var counts: [String: Int] = [:]
            for o in all { counts[o.status.rawValue, default: 0] += 1 }
            return OrdersMenuFacts(months: Array(Set(all.compactMap { InvoiceCalendar.monthKey($0.createdAt) })).sorted(by: >), counts: counts)
        }
        let months = facts.months
        // The house's counter names (the web's Taken by list), not whoever happens to appear in the book.
        let people = session.shop.takenBy
        return RecordFilterMenu(filtering: narrowed) {
            Picker("Status", selection: $statusFilter) {
                Text("All orders (\(all.count))").tag("All")
                ForEach(OrdersLogic.filterStatuses, id: \.self) { status in
                    Text("\(status) (\(facts.counts[status] ?? 0))").tag(status)
                }
                if shopify {
                    Text("To confirm").tag(OrdersHub.toConfirmKey)
                    Text("Earlier (invoiced)").tag(OrdersHub.earlierKey)
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
            if narrowed {
                Button("Clear filters", systemImage: "xmark.circle") { clearFilters() }
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var hubToolbar: some ToolbarContent {
        #if os(macOS)
        // Day, Stage or Due is the window's own control, in the middle of its toolbar.
        ToolbarItem(placement: .principal) {
            groupingPicker
        }
        #endif
        // The record lists' one toolbar: Filter, then +.
        ToolbarItem(placement: .trailingAction) {
            filterMenu(hubOrders)
        }
        if shopify && (session.isOwner || showsAnalytics) {
            ToolbarItem(placement: .trailingAction) { shopifyMenu }
        }
        // The tab's own create menu already offers New order beside the rate chip (iPad): one "+" is enough.
        if !createMenuShown && !shopify {
            ToolbarItem(placement: .trailingAction) {
                RouteLink(value: Route(path: "/orders/add"), row: false) {
                    Label("New order", systemImage: "plus")
                }
            }
        }
        // Online orders wait here until a person confirms them (docs/decisions.md "Online orders"): one tap from
        // the hub while any wait, with how many. A house whose website takes no orders (Mina) has none.
        if session.shop.websiteSelling && inbox.waiting > 0 && !shopify {
            ToolbarItem(placement: .trailingAction) {
                RouteLink(value: Route(path: "/orders/online"), row: false) {
                    // The count is words in the item, never a badge laid over its glass.
                    Text("Online \(inbox.waiting > 99 ? "99+" : "\(inbox.waiting)")")
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(inbox.waiting)))
                }
                .accessibilityLabel("Online orders, \(inbox.waiting) to confirm")
            }
        }
    }

    /// Analytics › Website › Visitors, which for Mina is Shopify's own report; offered only to a role that has it.
    private var showsAnalytics: Bool {
        NavMap.current.visible(to: session.navRole).entry(for: "/website/interest") != nil
    }

    /// The Shopify hub's menu: its analytics, and the CSV import moved here from Invoices (an owner's, as its own write is).
    private var shopifyMenu: some View {
        Menu {
            if showsAnalytics {
                RouteLink(value: Route(path: "/website/interest"), row: false) {
                    Label("Shopify analytics", systemImage: "chart.bar")
                }
            }
            if session.isOwner {
                Button { importingCSV = true } label: { Label("Import Shopify CSV", systemImage: "square.and.arrow.down") }
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    // MARK: Actions

    private var actions: OrderCardActions {
        OrderCardActions(
            advance: { order in advancing = order },
            markReady: { order in setStatus(order, "Completed") },
            setStatus: { order, status in choose(order, status) },
            open: { target in
                if let id = OrdersHub.slipId(target) {
                    slipShare = InvoicePDFTarget(path: "/api/app/pdf/order-slip/" + InvoiceFacts.encode(id),
                                                 fileName: "OrderSlip-\(id).pdf", title: "Slip \(id)")
                } else { web = target }
            },
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
        Motion.run(Motion.enter, reduce: reduceMotion) { localStatus[order.id] = status }
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

    /// The stage with the status just chosen (an invoiced or awaiting-transfer order keeps its own).
    private func localStage(_ order: Order, _ owedOn: [String: Double]) -> OrderStage {
        let base = stageOf(order, owedOnInvoice: OrdersLogic.owed(order, owedOn))
        guard let s = localStatus[order.id], base != .transfer, !OrdersLogic.hasInvoice(order) else { return base }
        switch s {
        case "Cancelled", "Refunded": return .closed
        case "Completed": return .ready
        case "In Progress": return .karigar
        case "Pending": return .new
        default: return base
        }
    }

    private func advanced(_ amount: Double, _ exchanges: [[String: Any]] = []) {
        Note.show(Note(title: "Advance recorded", detail: OrderAdvance.said(amount: amount, exchanges: exchanges)), in: $note, reduce: reduceMotion)
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
                     }) { amount, method, note, exchanges in
            try await OrderAdvance.record(order, amount: amount, method: method, note: note, exchanges: exchanges)
            await MainActor.run { advanced(amount, exchanges) }
        }
    }
}

/// What the hub's list is made of for one state of the books and filters (see `OrdersHub.listMemo`).
private struct OrdersListSnapshot {
    let scoped: [Order]
    let shown: [Order]
    let groups: [OrdersSection]
}

/// The Filter menu's facts about the whole book.
private struct OrdersMenuFacts {
    let months: [String]
    let counts: [String: Int]
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

/// One day of the Shopify section's All: its orders and old invoices, newest first, and what they are worth.
private struct ShopifyDay: Identifiable {
    let id: String
    let title: String
    let hint: String
    let entries: [ShopifyEntry]
    let worth: Double
}

private enum ShopifyEntry: Identifiable {
    case order(Order)
    case invoice(Invoice)

    var id: String {
        switch self {
        case .order(let o): return "o-" + o.id
        case .invoice(let i): return "i-" + i.id
        }
    }
}

/// The strip's figures: owed on the orders, open, due this week (late among them).
private struct OrdersFigures {
    var owed = 0.0
    var owedCount = 0
    var open = 0
    var dueSoon = 0
    var late = 0
}

/// An Orders section's heading: the record lists' one heading (ListSectionHeader), with what its orders are worth.
/// Kept by name for the Mac's stage board (OrdersMacKit).
struct OrdersSectionHeader: View {
    let title: String
    let hint: String
    let count: Int
    let value: Double
    var tone: Tone = .quiet

    var body: some View {
        ListSectionHeader(title: title, hint: hint, count: count, trailing: "worth " + Money.pkrLac(value), value: value,
                          tone: tone, spoken: "\(title), \(count) order\(count == 1 ? "" : "s"), worth \(Money.pkrLac(value))")
    }
}

extension OrdersHub {
    /// "/orders/<id>/slip" → the id: a card's Print slip, shared rather than opened.
    static func slipId(_ target: OrdersWebTarget) -> String? {
        let p = target.path
        guard p.hasPrefix("/orders/"), p.hasSuffix("/slip") else { return nil }
        let id = String(p.dropFirst("/orders/".count).dropLast("/slip".count))
        return id.isEmpty || id.contains("/") ? nil : id
    }
}
