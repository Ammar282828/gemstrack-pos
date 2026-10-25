#if os(macOS)
import SwiftUI
import AppKit
import ERPCore

// The Orders place (docs/features/mac-design.md, "Orders"): the saved list the sidebar names, as a Table or a Board
// (the toolbar's segmented control, kept per Mac), with the picked order in the inspector. Every action of an order is
// declared once (MacOrdersMenu) and drawn in the toolbar, the menu bar's Order menu, the right-click menu and the
// inspector. A record opens whole in a window of its own (Return, a double-click, Open in New Window).
//
// The writes are the iPhone's: the status through the Outbox's setOrderStatus (OrdersHub.setStatus), an advance through
// OrderAdvance, the undoing moves through OrderUndo behind the delete code.

/// The place's two views.
enum MacOrdersView: String, CaseIterable, Identifiable {
    case table, board
    var id: String { rawValue }
    var title: String { self == .table ? "Table" : "Board" }
    var symbol: String { self == .table ? "tablecells" : "rectangle.split.3x1" }
}

struct MacOrdersPlace: View {
    /// The sidebar's path: "/orders", or "/orders?list=late".
    let path: String

    /// The key the view is kept under; View › as Table / as Board writes it too.
    static let viewKey = "mac.orders.view"

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @AppStorage(MacOrdersPlace.viewKey) private var viewRaw = MacOrdersView.table.rawValue
    @State private var selection = Set<String>()
    @State private var query = ""
    @State private var takenBy = ""
    @State private var made = Memo<MacOrdersBase>()
    /// Statuses just chosen, shown before the shelf's copy catches up (order id to status).
    @State private var localStatus: [String: String] = [:]
    @State private var sheet: MacOrdersSheet?
    @State private var cancelling: Order?
    @State private var undo: OrderUndoAsk?
    @State private var web: OrdersWebTarget?
    @State private var note: Note?

    private var view: MacOrdersView { MacOrdersView(rawValue: viewRaw) ?? .table }
    private var list: String? { MacLists.list(in: path) }

    var body: some View {
        let key = baseKey
        let base = made(key) {
            MacOrdersLogic.base(orders: book.orders.items, invoices: book.invoices.items, karigars: book.karigars.items,
                                localStatus: localStatus, query: query, takenBy: takenBy, list: list, now: Date())
        }
        ShelfState(
            loaded: book.orders.loaded && book.invoices.loaded,
            error: book.orders.error ?? book.invoices.error,
            offline: book.orders.offline
        ) {
            content(base, key: key)
        }
        .navigationTitle(title)
        .navigationSubtitle(subtitle(base))
        .macSearchable(text: $query, prompt: "Order, customer, phone or piece")
        .toolbar { placeToolbar(base) }
        .macInspector { inspectorPanel(base) }
        .macRecordMenu(MacRecordMenu(title: "Order", groups: pickedGroups))
        .macOrdersSheets($sheet, advanced: advanced, moved: onlineMoved)
        .orderUndo($undo, open: $web)
        .ordersWebDestination($web)
        .confirmDestructive(isPresented: cancelShown, title: cancelling.map { "Cancel order \($0.id)?" } ?? "Cancel order?",
                            message: OrdersLogic.cancelWords, action: "Cancel order", perform: cancelAction(cancelling))
        .noteToast($note)
        .onChange(of: book.orders.revision) { _, _ in reconcile() }
        .onChange(of: Outbox.shared.failure?.id) { _, _ in localStatus = [:] }
        .onAppear {
            book.orders.need()
            book.invoices.need()
            book.karigars.need()
        }
    }

    // MARK: The title

    private var title: String {
        guard let list, let saved = MacLists.lists(for: "/orders").first(where: { $0.id == list }) else { return "Orders" }
        return saved.title
    }

    private func subtitle(_ base: MacOrdersBase) -> String {
        let n = base.rows.count
        return n == 1 ? "1 order" : "\(n) orders"
    }

    /// What the rows were made from: a change of any makes them again.
    private var baseKey: [Int] {
        [book.orders.revision, book.invoices.revision, book.karigars.revision, query.hashValue, takenBy.hashValue,
         (list ?? "").hashValue, localStatus.hashValue, ERPDate.karachiDay(Date()).hashValue]
    }

    // MARK: The content

    @ViewBuilder
    private func content(_ base: MacOrdersBase, key: [Int]) -> some View {
        Group {
            if view == .table {
                MacOrdersTableView(rows: base.rows, version: key, selection: $selection, open: openPicked) { ids in
                    rowMenu(ids)
                }
            } else {
                MacOrdersBoard(working: base.working, closed: base.closed,
                               searching: !query.trimmingCharacters(in: .whitespaces).isEmpty,
                               selection: $selection, open: { id in openOrder(id) }, drop: dropOrders) { id in
                    rowMenu([id])
                }
            }
        }
        .overlay {
            if base.rows.isEmpty { empty(base) }
        }
        .macSummaryBar(summary(base))
    }

    @ViewBuilder
    private func empty(_ base: MacOrdersBase) -> some View {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            ContentUnavailableView(list == nil ? "No Orders Yet" : "Nothing in \(title)", systemImage: "list.clipboard",
                                   description: Text(list == nil ? "Make an order with \u{21E7}\u{2318}N." : "No order is in this list now."))
        }
    }

    /// "214 orders · PKR 32.4 lac worth · PKR 1.2 lac owed"; with rows picked, the picked ones' sums.
    private func summary(_ base: MacOrdersBase) -> [String] {
        if selection.isEmpty {
            return [base.rows.count == 1 ? "1 order" : "\(base.rows.count) orders",
                    "\(Money.pkrLac(base.worth)) worth", "\(Money.pkrLac(base.owed)) owed"]
        }
        let picked = base.rows.filter { selection.contains($0.id) && $0.stage != .closed }
        let worth = picked.reduce(0) { $0 + $1.worth }
        let owed = picked.reduce(0) { $0 + max($1.owed, 0) }
        return ["\(selection.count) of \(base.rows.count) picked", "\(Money.pkrLac(worth)) worth", "\(Money.pkrLac(owed)) owed"]
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private func placeToolbar(_ base: MacOrdersBase) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("View", selection: $viewRaw) {
                ForEach(MacOrdersView.allCases) { (v: MacOrdersView) in
                    Label(v.title, systemImage: v.symbol).tag(v.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .help("The orders as a table or by stage (\u{2303}\u{2318}1, \u{2303}\u{2318}2)")
        }
        // New and the one filter; the picked order's actions are the inspector's, the Order menu's and the right-click
        // menu's, never the toolbar's (a Tahoe toolbar of nine capsules overflowed a 13-inch screen).
        ToolbarItemGroup(placement: .automatic) {
            Button { newOrder() } label: { Label("New Order", systemImage: "plus") }
                .help("New order (\u{21E7}\u{2318}N)")
            filterMenu(base)
        }
    }

    private func filterMenu(_ base: MacOrdersBase) -> some View {
        let people = session.shop.takenBy.isEmpty ? base.people : session.shop.takenBy
        return Menu {
            Picker("Taken by", selection: $takenBy) {
                Text("Anyone").tag("")
                ForEach(people, id: \.self) { (p: String) in Text(p).tag(p) }
            }
            .pickerStyle(.inline)
        } label: {
            Label("Filter", systemImage: takenBy.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("Show one person's orders")
    }

    // MARK: The inspector

    @ViewBuilder
    private func inspectorPanel(_ base: MacOrdersBase) -> some View {
        if selection.count == 1, let id = selection.first {
            MacOrderInspector(orderID: id, localStatus: localStatus,
                              actions: { (o: Order, st: OrderStage, owed: Double) in actionGroups(o, stage: st, invoiceOwed: owed) },
                              openRoute: { (p: String) in openRoute(p) })
                .id(id)
        } else if selection.count > 1 {
            MacInspectorEmpty(title: "\(selection.count) Orders Picked", detail: "Pick one to see its pieces and next step.")
        } else {
            MacInspectorEmpty(title: "No Order Picked", detail: "Click an order to see its pieces, advances and next step.")
        }
    }

    // MARK: The actions

    /// The one order picked (the menu bar's Order menu acts on it), nil when none or several are.
    private var picked: Order? {
        guard selection.count == 1, let id = selection.first else { return nil }
        return book.orders.item(id)
    }

    /// The Order menu for the picked order; every action there and shut while nothing is picked.
    private var pickedGroups: [[MacAction]] {
        guard let order = picked else { return MacOrdersMenu.groups(MacOrdersMenuInput(), run: MacOrdersMenuRun()) }
        let owed = MacOrdersLogic.invoiceOwed(order.invoiceId.flatMap { $0.isEmpty ? nil : book.invoices.item($0) })
        let stage = MacOrdersLogic.stage(order, invoiceOwed: owed, local: localStatus[order.id])
        return actionGroups(order, stage: stage, invoiceOwed: owed)
    }

    private func actionGroups(_ order: Order, stage: OrderStage, invoiceOwed: Double) -> [[MacAction]] {
        let input = MacOrdersMenuInput(order: order, stage: stage, invoiceOwed: invoiceOwed,
                                       status: localStatus[order.id] ?? order.status.rawValue,
                                       unassigned: pieceCounts(order.items).unassigned,
                                       isOwner: session.isOwner, role: session.role)
        return MacOrdersMenu.groups(input, run: run(order, stage: stage, invoiceOwed: invoiceOwed))
    }

    private func run(_ order: Order, stage: OrderStage, invoiceOwed: Double) -> MacOrdersMenuRun {
        var r = MacOrdersMenuRun()
        r.nextStep = { nextStep(order, stage: stage, invoiceOwed: invoiceOwed) }
        r.advance = { sheet = .advance(order) }
        r.giveOut = { open(.giveOut(order.id)) }
        r.markReady = { setStatus(order, "Completed") }
        r.makeInvoice = { open(.finalize(order.id)) }
        r.openInvoice = { if let id = order.invoiceId, !id.isEmpty { openRoute("/invoices/\(id)") } }
        r.printSlip = { open(.slip(order.id)) }
        r.message = { sheet = .notify(order) }
        r.call = { reach(order, call: true) }
        r.whatsApp = { reach(order, call: false) }
        r.bookCourier = { sheet = .courier(order) }
        r.track = { sheet = .tracking(order) }
        r.transfer = { sheet = .transfer(order) }
        r.lapse = { sheet = .lapse(order) }
        r.bankDetails = { bankDetails(order) }
        r.leopards = { sheet = .leopards(order) }
        r.edit = { open(.edit(order.id)) }
        r.changeRate = { open(.changeRate(order)) }
        r.unlock = { undo = OrderUndo.unlockAndEdit(order) }
        r.setStatus = { status in choose(order, status) }
        r.cancelInvoice = { undo = OrderUndo.undoInvoice(order) }
        r.cancelOrder = { cancelling = order }
        r.refund = { undo = OrderUndo.refund(order) }
        r.delete = { undo = OrderUndo.delete(order) }
        return r
    }

    /// The right-click menu: the Order menu for one order, or the few things that fit several.
    @ViewBuilder
    private func rowMenu(_ ids: Set<String>) -> some View {
        if ids.count == 1, let id = ids.first, let order = book.orders.item(id) {
            let owed = MacOrdersLogic.invoiceOwed(order.invoiceId.flatMap { $0.isEmpty ? nil : book.invoices.item($0) })
            let stage = MacOrdersLogic.stage(order, invoiceOwed: owed, local: localStatus[order.id])
            Button("Open in New Window") { openOrder(id) }
                .disabled(openPlace == nil)
            Divider()
            MacActionItems(groups: actionGroups(order, stage: stage, invoiceOwed: owed))
        } else if !ids.isEmpty {
            Button("Open in New Window") { openPicked(ids) }
                .disabled(openPlace == nil)
            Button("Copy Numbers") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
        }
    }

    // MARK: Doing things

    private func newOrder() {
        open(.newOrder)
    }

    /// Opens an order's page, or a form of it, in a window of its own (here, as a sheet, where no window can be made).
    private func open(_ target: OrdersWebTarget) {
        if let openPlace { openPlace(Route(path: target.path)) } else { web = target }
    }

    private func openRoute(_ path: String) {
        openPlace?(Route(path: path))
    }

    private func openOrder(_ id: String) {
        openRoute("/orders/\(id)")
    }

    private func openPicked(_ ids: Set<String>) {
        for id in ids.sorted().prefix(5) { openOrder(id) }
    }

    private func nextStep(_ order: Order, stage: OrderStage, invoiceOwed: Double) {
        let input = MacOrdersMenuInput(order: order, stage: stage, invoiceOwed: invoiceOwed, isOwner: session.isOwner, role: session.role)
        guard let step = MacOrdersMenu.step(input) else { return }
        switch step {
        case .checkTransfer: sheet = .transfer(order)
        case .giveOut: open(.giveOut(order.id))
        case .markReady: setStatus(order, "Completed")
        case .finalize: open(.finalize(order.id))
        case .invoice(let id, _): openRoute("/invoices/\(id)")
        }
    }

    private func reach(_ order: Order, call: Bool) {
        let url = call ? CustomerKit.callURL(order.customerContact) : CustomerKit.whatsAppURL(order.customerContact)
        if let url { openURL(url) }
    }

    /// WhatsApp opens with the bank details written in; the person adds the account and presses send there.
    private func bankDetails(_ order: Order) {
        guard let w = order.website else { return }
        let contact = (order.customerContact ?? "").trimmingCharacters(in: .whitespaces)
        let phone = contact.isEmpty ? (w.customerPhone ?? "") : contact
        let ref = (w.onlineId ?? "").isEmpty ? order.id : (w.onlineId ?? order.id)
        if let url = OnlineOrdersLogic.bankDetailsURL(phone: phone, name: order.customerName ?? "", ref: ref, total: OrdersLogic.onlineTotal(order)) {
            openURL(url)
        }
    }

    // MARK: Status

    /// Cancelling asks first; every other status is one click.
    private func choose(_ order: Order, _ status: String) {
        if status == (localStatus[order.id] ?? order.status.rawValue) { return }
        if status == "Cancelled" { cancelling = order } else { setStatus(order, status) }
    }

    private func setStatus(_ order: Order, _ status: String) {
        Motion.run(Motion.enter, reduce: reduceMotion) { localStatus[order.id] = status }
        if status == "Completed" {
            Note.show(Note(title: "Marked ready", detail: order.id), in: $note, reduce: reduceMotion)
        } else if status == "Cancelled" {
            Note.show(Note(title: "Order cancelled", detail: order.id), in: $note, reduce: reduceMotion)
        } else {
            Note.show(Note(title: "Now " + status.lowercased(), detail: order.id), in: $note, reduce: reduceMotion)
        }
        MacOrdersWrites.setStatus(order, status)
    }

    private var cancelShown: Binding<Bool> {
        Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } })
    }

    /// Cancelling the order the dialog was raised for, fixed when the dialog is built (its binding clears
    /// `cancelling` as it closes).
    private func cancelAction(_ order: Order?) -> () -> Void {
        { if let order { setStatus(order, "Cancelled") } }
    }

    /// Drop what the shelf now agrees with.
    private func reconcile() {
        for o in book.orders.items where localStatus[o.id] == o.status.rawValue { localStatus[o.id] = nil }
    }

    /// Orders dragged onto a column of the board: From With karigars onto Ready to hand over marks them ready, and back
    /// again. Nothing else moves by dragging.
    private func dropOrders(_ ids: [String], onto target: OrderStage) -> Bool {
        var moved = false
        for id in ids {
            guard let order = book.orders.item(id) else { continue }
            let invoiceOwed = MacOrdersLogic.invoiceOwed(order.invoiceId.flatMap { $0.isEmpty ? nil : book.invoices.item($0) })
            let stage = MacOrdersLogic.stage(order, invoiceOwed: invoiceOwed, local: localStatus[order.id])
            if target == .ready && stage == .karigar {
                setStatus(order, "Completed")
                moved = true
            } else if target == .karigar && stage == .ready {
                setStatus(order, "In Progress")
                moved = true
            }
        }
        return moved
    }

    // MARK: What the sheets said

    private func advanced(_ amount: Double, _ exchanges: [[String: Any]]) {
        Note.show(Note(title: "Advance recorded", detail: OrderAdvance.said(amount: amount, exchanges: exchanges)), in: $note, reduce: reduceMotion)
    }

    private func onlineMoved(_ kind: OnlineMoveSheet.Kind, _ t: OnlineTold) {
        Note.show(Note(title: t.words, failed: !t.ok), in: $note, reduce: reduceMotion)
    }
}
#endif
