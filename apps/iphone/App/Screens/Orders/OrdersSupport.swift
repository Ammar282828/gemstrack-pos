import SwiftUI
import ERPCore

// The few views the two Orders screens share. Types here carry the word Order(s) so they cannot
// meet another group's helpers in the one module.

/// A place an Orders button opens: the registry's native screen for its path (the order, the bench, the slip,
/// Finalize, Edit order). Every one is native now, so nothing here opens the ERP's page.
struct OrdersWebTarget: Hashable, Identifiable {
    let path: String
    let title: String
    var id: String { path }

    /// The order's own page (OrderScreen).
    static func order(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)", title: id) }
    /// The native bench, limited to this order: assign a karigar and record the handover separately.
    static func giveOut(_ id: String) -> OrdersWebTarget {
        OrdersWebTarget(path: "/workshop?order=" + WorkshopLogic.piece(id), title: "Give out")
    }
    /// The workshop slip, native: drawn on the ERP's server by the one builder (lib/order-slip-pdf.ts), shown
    /// here and printed or shared from the share sheet (NewOrderRoutes `slipScreen`). The ERP's page still
    /// draws it for `?do=slip`, for an app from before.
    static func slip(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/slip", title: "Slip \(id)") }
    /// Finalize & invoice, native (OrderFinalizeScreen; the web's page reads ?do=finalize for the same dialog).
    static func finalize(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/finalize", title: id) }
    /// New order's form on the order on file (NewOrderEdit).
    static func edit(_ id: String) -> OrdersWebTarget { OrdersWebTarget(path: "/orders/\(id)/edit", title: "Edit \(id)") }
    /// Change rate: Edit order, or Edit invoice once it is invoiced, opened at its rates (`?rates=1`).
    static func changeRate(_ order: Order) -> OrdersWebTarget {
        if let inv = order.invoiceId, !inv.isEmpty {
            return OrdersWebTarget(path: InvoiceFacts.changeRatePath(inv), title: "Edit \(inv)")
        }
        return OrdersWebTarget(path: "/orders/\(order.id)/edit?rates=1", title: "Edit \(order.id)")
    }
    /// New order's form (NewOrder).
    static let newOrder = OrdersWebTarget(path: "/orders/add", title: "New order")
}

extension View {
    /// The destination for an `OrdersWebTarget` set by a button.
    func ordersWebDestination(_ target: Binding<OrdersWebTarget?>) -> some View {
        #if os(macOS)
        return modifier(OrdersMacDestination(target: target))
        #else
        return navigationDestination(item: target) { t in
            ScreenRegistry.view(for: t.path)
                .modifier(HouseGround())
        }
        #endif
    }

    /// The sheet's one action in the kit's bar (rule 16), or no bar while there is none (a sheet whose second step
    /// has nothing to offer). The bar is the same `ActionBar` `.actionBar` pins; only its presence changes, so the
    /// form beneath keeps its place.
    func ordersBar(_ primary: ActionBar.Action?) -> some View {
        safeAreaBar(edge: .bottom, spacing: 0) {
            if let primary { ActionBar(primary: primary) }
        }
    }

    /// The ERP's own words when a write is refused (the kit's `failureAlert`, which also taps an error).
    func ordersFailureAlert(_ message: Binding<String?>, title: String = "Not changed") -> some View {
        failureAlert(message, title: title)
    }
}

/// "Online": an order that came from the website and was confirmed by a person. A quiet label rather than a
/// capsule, so a card keeps to one badge (App/UI/Ledger.swift).
struct OrdersOnlineBadge: View {
    var body: some View {
        Label("Online", systemImage: "globe")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Tone.working.color)
            .lineLimit(1)
    }
}

/// The colours the Orders screens give what they say, from the ledger's tones only.
enum OrdersTone {
    /// The status picker's pill: amber while waiting to start, blue with the karigars, green once finished.
    static func status(_ s: OrderStatus) -> Tone {
        switch s {
        case .pending: return .owed
        case .inProgress: return .working
        case .completed: return .settled
        case .cancelled, .refunded, .unknown: return .quiet
        }
    }
}

extension OrdersLogic.Promise {
    /// The web's colours for a promise (components/shared/promise-line.tsx): red once late, amber on the day and
    /// inside the bench week, quiet once the order is finished or when nothing was promised.
    var tone: Tone {
        if chase && state == .late { return .late }
        if chase && state == .today { return .owed }
        return urgent ? .owed : .quiet
    }
}

/// What the shop earns on an order, blurred until tapped: the counter turns its screen to show a
/// customer the bill, and a margin beside the total is the one thing they must not read off it. The
/// figure is not in the view until it is tapped (shop-margin.tsx MarginFigure). Shop screens only.
struct OrdersMarginRow: View {
    let order: Order
    @State private var shown = false

    var body: some View {
        let m = orderMargin(order, settings: House.margin)
        Button {
            shown.toggle()
        } label: {
            HStack {
                Label("We earn", systemImage: "lock.fill")
                    .foregroundStyle(.secondary)
                Spacer()
                Text(shown ? OrdersLogic.marginWords(m, settings: House.margin) : "00.0% · PKR 00,000")
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(tone(m))
                    .blur(radius: shown ? 0 : 5)
            }
            .font(.subheadline)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(shown ? "Hide our margin" : "Show our margin")
    }

    private func tone(_ m: Margin) -> Color {
        if m.assumed { return .secondary }
        return m.percent < 0 ? Tone.late.color : Tone.settled.color
    }
}

// MARK: An advance that settles the order

/// An order's advance, and the Settle beside it (order-dialogs.tsx RecordAdvanceDialog): the advance as Save takes it
/// (`recordOrderAdvance`), or the advance and the remainder added to the order's discount in one write
/// (`settleOrderAdvance`, lib/writes/settle.ts), never a payment that was not made; the invoice made from the order
/// carries the discount (Order to invoice). Settle is owners only, as the write is.
enum OrderAdvance {
    /// Cash and/or gold handed over (`exchanges`, the rows as the order keeps them): the cash may be 0 when gold is
    /// given, and one of the two must be above 0 (lib/writes/order-advance.ts). The gold joins the order's exchange,
    /// comes off the balance, and is carried to the invoice.
    static func record(_ order: Order, amount: Double, method: String, note: String, exchanges: [[String: Any]] = []) async throws {
        var fields: [String: Any] = [
            "orderId": order.id,
            "amount": amount,
            "method": method,
            "notes": note,
        ]
        if !exchanges.isEmpty { fields["exchanges"] = exchanges }
        _ = try await ERPAPI.shared.write("recordOrderAdvance", fields)
    }

    /// What was recorded, in words: the cash, the gold, or both ("PKR 50,000 cash + PKR 100,000 gold").
    static func said(amount: Double, exchanges: [[String: Any]]) -> String {
        let gold = exchanges.reduce(0.0) { $0 + (($1["value"] as? Double) ?? 0) }
        if gold <= 0 { return Money.pkr(amount) }
        return amount > 0 ? "\(Money.pkr(amount)) cash + \(Money.pkr(gold)) gold" : "\(Money.pkr(gold)) gold"
    }

    /// One exchange row as the write takes it (as the new order sends its rows).
    static func exchangeJSON(_ e: ExchangeEntry) -> [String: Any] {
        var o: [String: Any] = ["description": e.description, "value": e.value]
        if let k = e.karat, !k.isEmpty { o["karat"] = k }
        if let w = e.weightG, w > 0 { o["weightG"] = w }
        if let r = e.ratePerGram, r > 0 { o["ratePerGram"] = r }
        return o
    }

    static func settle(_ order: Order, amount: Double, method: String, note: String, remainder: Double) async throws {
        _ = try await ERPAPI.shared.write("settleOrderAdvance", [
            "orderId": order.id,
            "amount": amount,
            "extra": remainder,
            "method": method,
            "notes": note,
        ])
    }
}

// MARK: Gold handed over with an advance

/// The advance sheet's "Exchanged gold": the New order exchange line (what it is + the amount; karat, grams and
/// rate fold away and fill the amount until someone types their own, ERPCore's `applyExchangeRowChange`), for a
/// sheet that holds plain rows rather than a draft (components/shared/exchange-rows.tsx in RecordAdvanceDialog).
struct OrderAdvanceExchange: View {
    @Binding var rows: [ExchangeRow]
    @State private var opened: Set<String> = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let karats = ["24k", "22k", "21k", "18k"]

    var body: some View {
        Section {
            ForEach(rows) { row in
                exchangeRow(row)
            }
            Button {
                Motion.run(reduce: reduceMotion) { rows.append(blankExchangeRow()) }
            } label: {
                Label("Add another exchange", systemImage: "plus")
            }
            if rows.count > 1 && total > 0 {
                LabeledContent("Exchange total") {
                    Text(Money.pkr(total)).monospacedDigit().fontWeight(.medium)
                }
            }
        } header: {
            Text("Exchanged gold")
        } footer: {
            Text("Gold handed over now comes off the balance, and goes to the invoice with the order.")
        }
        .motion(rows.count)
        .motion(opened)
    }

    private var total: Double { exchangeRowsTotal(rows) }

    private func text(_ id: String, _ read: @escaping (ExchangeRow) -> String, _ patch: @escaping (String) -> ExchangeRowPatch) -> Binding<String> {
        Binding(
            get: { rows.first { $0.id == id }.map(read) ?? "" },
            set: { typed in rows = rows.map { $0.id == id ? applyExchangeRowChange($0, patch(typed)) : $0 } }
        )
    }

    private func remove(_ id: String) {
        Motion.run(reduce: reduceMotion) {
            if rows.count > 1 { rows.removeAll { $0.id == id } } else { rows = [blankExchangeRow()] }
        }
    }

    @ViewBuilder
    private func exchangeRow(_ row: ExchangeRow) -> some View {
        let showDetails = opened.contains(row.id) || !row.karat.isEmpty || !row.weightG.isEmpty || !row.ratePerGram.isEmpty
        VStack(alignment: .leading, spacing: 8) {
            AdaptiveStack(spacing: 10, alignment: .firstTextBaseline) {
                TextField("What it is", text: text(row.id, { $0.description }, { ExchangeRowPatch(description: $0) }),
                          prompt: Text("What it is (e.g. old ring)"))
                TextField("Amount", text: text(row.id, { $0.value }, { ExchangeRowPatch(value: $0) }).wholeRupees, prompt: Text("Amount"))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            }
            if showDetails {
                details(row)
            } else {
                Button { opened.insert(row.id) } label: {
                    Label("Weight & rate", systemImage: "plus")
                }
                .font(.footnote)
                .buttonStyle(.borderless)
            }
        }
        .swipeActions {
            Button(role: .destructive) { remove(row.id) } label: {
                Label("Remove", systemImage: "trash")
            }
        }
        #if os(macOS)
        .contextMenu {
            Button(role: .destructive) { remove(row.id) } label: {
                Label("Remove this exchange", systemImage: "trash")
            }
        }
        #endif
    }

    @ViewBuilder
    private func details(_ row: ExchangeRow) -> some View {
        let computed = !row.valueTyped && NewOrderFormat.num(row.weightG) > 0 && NewOrderFormat.num(row.ratePerGram) > 0
        HStack(spacing: 10) {
            // Karat only means something where the house sells gold; a silver house weighs without it.
            if House.metal == "gold" {
                Picker("Karat", selection: text(row.id, { $0.karat }, { ExchangeRowPatch(karat: $0) })) {
                    Text("Karat").tag("")
                    ForEach(karats, id: \.self) { k in
                        Text(k).tag(k)
                    }
                }
                .labelsHidden()
            }
            TextField("Grams", text: text(row.id, { $0.weightG }, { ExchangeRowPatch(weightG: $0) }), prompt: Text("Grams"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
            TextField("Rate", text: text(row.id, { $0.ratePerGram }, { ExchangeRowPatch(ratePerGram: $0) }), prompt: Text("Rate / g"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
        if computed {
            Text("Amount = grams × rate: type an amount to change it.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

#if os(macOS)
/// What an Orders button opens, on a Mac: an order's own page pushes into the window; Edit, Finalize, the slip, the
/// bench and New order are forms and documents, so they open as a window-sized sheet (one window form, closed with Esc).
struct OrdersMacDestination: ViewModifier {
    @Binding var target: OrdersWebTarget?

    private static func isPage(_ t: OrdersWebTarget) -> Bool {
        guard t.path.hasPrefix("/orders/"), t.path != "/orders/add" else { return false }
        return !t.path.dropFirst("/orders/".count).contains("/")
    }

    private var pushed: Binding<OrdersWebTarget?> {
        Binding(get: { target.flatMap { Self.isPage($0) ? $0 : nil } },
                set: { if $0 == nil, let t = target, Self.isPage(t) { target = nil } })
    }

    private var sheeted: Binding<OrdersWebTarget?> {
        Binding(get: { target.flatMap { Self.isPage($0) ? nil : $0 } },
                set: { if $0 == nil, let t = target, !Self.isPage(t) { target = nil } })
    }

    func body(content: Content) -> some View {
        content
            .navigationDestination(item: pushed) { t in
                ScreenRegistry.view(for: t.path)
                    .modifier(HouseGround())
            }
            .sheet(item: sheeted) { t in
                NavigationStack {
                    ScreenRegistry.view(for: t.path)
                        .modifier(HouseGround())
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Close") { target = nil }.keyboardShortcut(.cancelAction)
                            }
                        }
                }
                .frame(minWidth: 900, idealWidth: 980, minHeight: 660, idealHeight: 760)
            }
    }
}
#endif
