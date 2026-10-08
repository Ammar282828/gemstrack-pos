import SwiftUI
import ERPCore

/// The Orders hub (src/app/orders/page.tsx, docs/decisions.md "Orders hub"): the list grouped by
/// stage, what is ready to hand over first, each card carrying its one next step. Done and
/// Cancelled fold away: they are history, not work.
struct OrdersHub: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var query = ""
    @State private var statusFilter = "All"
    /// The folded stages a person has opened.
    @State private var opened: Set<String> = []
    /// Orders with a write in flight.
    @State private var busy: Set<String> = []
    @State private var advancing: Order?
    @State private var cancelling: Order?
    @State private var web: OrdersWebTarget?
    @State private var failure: String?

    var body: some View {
        ShelfState(
            loaded: book.orders.loaded && book.invoices.loaded,
            error: book.orders.error ?? book.invoices.error,
            offline: book.orders.offline
        ) {
            hub
        }
        .navigationTitle("Orders")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Order, customer, phone or piece")
        .toolbar { hubToolbar }
        .ordersWebDestination($web)
        .sheet(item: $advancing) { order in advanceSheet(order) }
        .confirmationDialog("Cancel this order?", isPresented: cancelShown, titleVisibility: .visible, presenting: cancelling) { order in
            Button("Cancel order \(order.id)", role: .destructive) { setStatus(order, "Cancelled") }
            Button("Keep it", role: .cancel) {}
        } message: { _ in
            Text(OrdersLogic.cancelWords)
        }
        .ordersFailureAlert($failure)
        .onAppear {
            book.orders.need()
            book.invoices.need()
        }
    }

    // MARK: The list

    @ViewBuilder
    private var hub: some View {
        let all = book.orders.items
        let owedOn = OrdersLogic.owedOnInvoices(book.invoices.items)
        let searched = all.filter { OrdersLogic.matches($0, query) }
        let shown = statusFilter == "All" ? searched : searched.filter { $0.status.rawValue == statusFilter }
        let groups = stageGroups(shown, owedOn)
        let now = Date()
        // A search or a status must reach the folded stages too, or its hits hide behind "Show".
        let forceOpen = !query.trimmingCharacters(in: .whitespaces).isEmpty || statusFilter != "All"
        List {
            ForEach(groups) { g in
                stageSection(g, owedOn: owedOn, now: now, forceOpen: forceOpen)
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if groups.isEmpty { emptyState }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            filterBar(searched: searched, shown: shown.count, total: all.count)
        }
    }

    private func stageGroups(_ orders: [Order], _ owedOn: [String: Double]) -> [OrdersStageGroup] {
        var byStage: [OrderStage: [Order]] = [:]
        for o in orders {
            let st = stageOf(o, owedOnInvoice: OrdersLogic.owed(o, owedOn))
            byStage[st, default: []].append(o)
        }
        return STAGE_ORDER.compactMap { (st: OrderStage) -> OrdersStageGroup? in
            guard let rows = byStage[st], !rows.isEmpty else { return nil }
            return OrdersStageGroup(stage: st, orders: rows)
        }
    }

    @ViewBuilder
    private func stageSection(_ g: OrdersStageGroup, owedOn: [String: Double], now: Date, forceOpen: Bool) -> some View {
        let info = STAGES[g.stage]
        Section {
            if g.stage == .done || g.stage == .closed {
                DisclosureGroup(isExpanded: expansion(g.stage, forceOpen: forceOpen)) {
                    cards(g.orders, owedOn: owedOn, now: now)
                } label: {
                    Text("\(g.orders.count) order\(g.orders.count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                }
            } else {
                cards(g.orders, owedOn: owedOn, now: now)
            }
        } header: {
            OrdersStageHeader(
                title: info?.title ?? g.stage.rawValue,
                hint: info?.hint ?? "",
                count: g.orders.count,
                value: g.orders.reduce(0) { $0 + $1.subtotal },
                danger: g.stage == .new || g.stage == .transfer
            )
        }
    }

    @ViewBuilder
    private func cards(_ orders: [Order], owedOn: [String: Double], now: Date) -> some View {
        ForEach(orders) { order in
            OrderCardRows(
                order: order,
                stage: stageOf(order, owedOnInvoice: OrdersLogic.owed(order, owedOn)),
                owed: OrdersLogic.owed(order, owedOn),
                now: now,
                isOwner: session.isOwner,
                busy: busy.contains(order.id),
                actions: actions
            )
        }
    }

    private func expansion(_ stage: OrderStage, forceOpen: Bool) -> Binding<Bool> {
        Binding(
            get: { forceOpen || opened.contains(stage.rawValue) },
            set: { open in
                if open { opened.insert(stage.rawValue) } else { opened.remove(stage.rawValue) }
            }
        )
    }

    private var emptyState: some View {
        let filtering = !query.isEmpty || statusFilter != "All"
        return ContentUnavailableView(
            "No orders found",
            systemImage: "list.clipboard",
            description: Text(filtering ? "Try adjusting the search or filters." : "Create a custom order to begin.")
        )
    }

    // MARK: The status filter, as glass chips

    private func filterBar(searched: [Order], shown: Int, total: Int) -> some View {
        VStack(spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        chip("All", count: searched.count)
                        ForEach(OrdersLogic.filterStatuses, id: \.self) { s in
                            let n = searched.filter { $0.status.rawValue == s }.count
                            if n > 0 || statusFilter == s { chip(s, count: n) }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            Text(summary(shown: shown, total: total, searched: searched))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func chip(_ status: String, count: Int) -> some View {
        let title = "\(status) \(count)"
        if statusFilter == status {
            Button(title) { statusFilter = status }
                .buttonStyle(.glassProminent)
        } else {
            Button(title) { statusFilter = status }
                .buttonStyle(.glass)
        }
    }

    /// "124 orders · 12 in progress", or "5 of 124 orders" while filtering.
    private func summary(shown: Int, total: Int, searched: [Order]) -> String {
        var s = shown == total ? "\(total) order\(total == 1 ? "" : "s")" : "\(shown) of \(total) orders"
        let active = searched.filter { $0.status == .pending || $0.status == .inProgress }.count
        if active > 0 && statusFilter == "All" { s += " · \(active) in progress" }
        return s
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var hubToolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            // New order stays the ERP's own page for now.
            NavigationLink(value: Route(path: "/orders/add")) {
                Label("New order", systemImage: "plus")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                // Online orders wait here until a person confirms them (docs/decisions.md "Online orders").
                Button { web = OrdersWebTarget(path: "/orders", title: "Orders") } label: {
                    Label("Online orders to confirm", systemImage: "globe")
                }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
        }
    }

    // MARK: Actions

    private var actions: OrderCardActions {
        OrderCardActions(
            advance: { order in advancing = order },
            markReady: { order in setStatus(order, "Completed") },
            setStatus: { order, status in choose(order, status) },
            openWeb: { target in web = target }
        )
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
            } catch {
                failure = error.localizedDescription
            }
            busy.remove(order.id)
        }
    }

    /// An advance from the card: owners only (the ERP refuses anyone else), and never once invoiced.
    private func advanceSheet(_ order: Order) -> some View {
        PaymentSheet(title: "Advance on \(order.id)", owed: order.grandTotal, askReference: false) { amount, method, _ in
            _ = try await ERPAPI.shared.write("recordOrderAdvance", [
                "orderId": order.id,
                "amount": amount,
                "method": method,
                "notes": "Advance payment received",
            ])
        }
    }
}

private struct OrdersStageGroup: Identifiable {
    let stage: OrderStage
    let orders: [Order]
    var id: String { stage.rawValue }
}

/// A stage's title and hint, how many orders it holds and what they come to.
struct OrdersStageHeader: View {
    let title: String
    let hint: String
    let count: Int
    let value: Double
    let danger: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(danger ? Color.red : Color.primary)
                if !hint.isEmpty {
                    Text(hint)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text("\(count)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(Money.pkrLac(value))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
        .textCase(nil)
    }
}
