import SwiftUI
import Charts
import ERPCore

// "Taken today", opened (owner, 2026-11-03: "Tapping Taken today should open the histogram of per day with all
// details"). A bar for each day of money taken, a segmented 7 days / This month / 30 days / 90 days, and under it the
// chosen day: its total, how it was paid, and every entry.
//
// The entries ARE Home's own events: DashFigures builds "Taken today", This month and the week's bars from
// `DashTaken.entries`, so a day here and the same day on Home are one number to the rupee. Home's figure is the sale
// value (an invoice's `invoiceSaleValue`, a counter order not yet invoiced at its subtotal, Extra revenue with the
// repairs' payments), not the cash drawer; each entry's amount is split by how the books say it was paid, and what
// is not paid yet is its own line, so the split always adds up to the day. Today's cash (the drawer) is the other screen.
// The server's src/lib/taken-by-day.ts follows the same rules.

// MARK: How it was paid

enum DashTakenMethod: Int, CaseIterable, Hashable {
    case cash, bank, card, other, unpaid

    var label: String {
        switch self {
        case .cash: return "Cash"
        case .bank: return "Bank"
        case .card: return "Card"
        case .other: return "Other"
        case .unpaid: return "Not paid yet"
        }
    }

    /// Cheques, gold in exchange, a payment with no method and Extra revenue with none recorded are Other.
    static func of(_ m: PaymentType?) -> DashTakenMethod {
        switch m {
        case .cash?: return .cash
        case .bankTransfer?: return .bank
        case .card?: return .card
        default: return .other
        }
    }
}

enum DashTakenKind: Int, CaseIterable, Hashable {
    case sale, order, repair, extra

    func noun(_ n: Int) -> String {
        switch self {
        case .sale: return n == 1 ? "sale" : "sales"
        case .order: return n == 1 ? "order" : "orders"
        case .repair: return n == 1 ? "repair payment" : "repair payments"
        case .extra: return n == 1 ? "extra revenue" : "extra revenues"
        }
    }

    var symbol: String {
        switch self {
        case .sale: return "receipt"
        case .order: return "list.clipboard"
        case .repair: return "wrench.and.screwdriver"
        case .extra: return "plus.circle"
        }
    }
}

// MARK: One entry, one day

/// One thing that counted toward a day: a sale, a counter order not yet invoiced, a repair's payment, Extra revenue.
struct DashTakenEntry: Identifiable {
    let id: String
    let kind: DashTakenKind
    /// The instant it counts on (a sale from an order counts on its order's day, as Home does).
    let at: Date
    /// The ISO text it came from, for the clock (a bare day has no time to show).
    let atISO: String
    /// Who took it; empty when the books do not say.
    let who: String
    let customer: String
    let what: String
    let ref: String
    /// Where it opens; nil for Extra revenue, which has no page of its own.
    let path: String?
    let amount: Double
    /// How the amount was paid. Adds up to `amount`.
    let split: [DashTakenMethod: Double]

    var time: String { atISO.count > 10 ? DashDate.clock(iso: atISO) : "" }

    /// "Cash", "Cash + Card", "Not paid yet".
    var methodText: String {
        let parts = DashTakenMethod.allCases.filter { (split[$0] ?? 0) >= 0.5 }
        return parts.isEmpty ? "Not paid yet" : parts.map { $0.label }.joined(separator: " + ")
    }
}

struct DashTakenDay: Identifiable {
    let day: Date
    let total: Double
    let bySplit: [DashTakenMethod: Double]
    /// How many entries were paid, wholly or partly, each way.
    let splitCounts: [DashTakenMethod: Int]
    let kindCounts: [DashTakenKind: Int]
    /// Newest first.
    let entries: [DashTakenEntry]
    var id: Date { day }
}

enum DashTaken {
    // MARK: The entries (Home's events)

    /// Home's events, with the words and the split each carries. `jewellery` is the invoices after the coins are taken
    /// out (AnaCoins.splitAll), exactly as Home counts them. Same filters, same amounts, same order as DashFigures
    /// had them before: invoices, booked orders, Extra revenue.
    static func entries(jewellery: [Invoice], orders: [Order], ordersById: [String: Order], revenues: [AdditionalRevenue],
                        repairs: [Repair]) -> [DashTakenEntry] {
        var out: [DashTakenEntry] = []
        for inv in jewellery where inv.status != .refunded && !inv.createdAt.isEmpty {
            let iso = DashRules.revenueDate(of: inv, orders: ordersById)
            guard let at = DashDate.parseISO(iso) else { continue }
            let value = invoiceSaleValue(inv)
            out.append(DashTakenEntry(
                id: "i" + inv.id, kind: .sale, at: at, atISO: iso, who: inv.takenBy ?? "", customer: DashText.name(inv.customerName),
                what: InvoiceFacts.whatSold(inv) ?? inv.id, ref: inv.id, path: DashPath.invoice(inv.id), amount: value,
                split: split(value: value, payments: inv.paymentHistory, exchange: exchangeTotal(invoiceExchanges(inv)))))
        }
        // A counter order not yet invoiced is a sale once taken (bookedAsSale); an online one waits for its transfer.
        for o in orders where bookedAsSale(o) {
            guard let at = DashDate.parseISO(o.createdAt) else { continue }
            let value = o.subtotal.isNaN ? 0 : o.subtotal
            out.append(DashTakenEntry(
                id: "o" + o.id, kind: .order, at: at, atISO: o.createdAt, who: o.takenBy ?? "", customer: DashText.name(o.customerName),
                what: OrdersLogic.cardWhat(o).text.isEmpty ? "Order" : OrdersLogic.cardWhat(o).text, ref: o.id,
                path: DashPath.order(o.id), amount: value,
                split: split(value: value, payments: orderAdvancePayments(o), exchange: exchangeTotal(orderExchanges(o)))))
        }
        // A repair's money is written to Extra revenue with its repairId; the method and the person are on the repair.
        var repairOf: [String: (repair: Repair, method: PaymentType?)] = [:]
        for r in repairs {
            for p in r.payments { if let rid = p.revenueId, !rid.isEmpty { repairOf[rid] = (r, p.method) } }
        }
        for r in revenues {
            guard let at = DashDate.parseISO(r.date) else { continue }
            let value = r.amount.isNaN ? 0 : r.amount
            if let repairId = r.repairId, !repairId.isEmpty {
                let found = repairOf[r.id]
                let customer = found.map { DashText.name($0.repair.customerName) } ?? "Walk-in"
                out.append(DashTakenEntry(
                    id: "r" + r.id, kind: .repair, at: at, atISO: r.date, who: found?.repair.takenBy ?? "", customer: customer,
                    what: r.description.isEmpty ? "Repair payment" : r.description, ref: repairId, path: DashPath.repair(repairId),
                    amount: value, split: value == 0 ? [:] : [DashTakenMethod.of(found?.method): value]))
            } else {
                out.append(DashTakenEntry(
                    id: "x" + r.id, kind: .extra, at: at, atISO: r.date, who: "", customer: "",
                    what: r.description.isEmpty ? "Extra revenue" : r.description, ref: "", path: nil,
                    amount: value, split: value == 0 ? [:] : [.other: value]))
            }
        }
        return out
    }

    /// How a sale's value was paid: each payment by its own method (its exchange part, and any gold taken in exchange,
    /// is Other), and the rest is Not paid yet. Payments past the value are scaled back so the parts always add up to it.
    static func split(value: Double, payments: [Payment], exchange: Double) -> [DashTakenMethod: Double] {
        guard value > 0 else { return [:] }
        var paid: [DashTakenMethod: Double] = [:]
        for p in payments {
            let amount = p.amount.isNaN ? 0 : p.amount
            let gold = min(max(0, paymentExchangePart(p)), max(0, amount))
            if amount - gold > 0 { paid[DashTakenMethod.of(p.method), default: 0] += amount - gold }
            if gold > 0 { paid[.other, default: 0] += gold }
        }
        if exchange > 0 { paid[.other, default: 0] += exchange }
        let sum = paid.values.reduce(0, +)
        if sum > value {
            let scale = value / sum
            return paid.mapValues { $0 * scale }
        }
        if value - sum >= 0.005 { paid[.unpaid] = value - sum }
        return paid
    }

    // MARK: The days

    /// One bar a day, `count` days ending on the day of `now` (Karachi's), oldest first. A day with nothing is still a day.
    static func days(_ entries: [DashTakenEntry], endingOn now: Date, count: Int) -> [DashTakenDay] {
        guard count > 0 else { return [] }
        let cal = DashDate.karachi
        let today = DashDate.startOfDay(now)
        let start = DashDate.adding(days: -(count - 1), to: today)
        var buckets = [[DashTakenEntry]](repeating: [], count: count)
        for e in entries where e.at >= start {
            let index = cal.dateComponents([.day], from: start, to: DashDate.startOfDay(e.at)).day ?? -1
            if index >= 0 && index < count { buckets[index].append(e) }
        }
        return (0..<count).map { (i: Int) -> DashTakenDay in
            let list = buckets[i].sorted { (a: DashTakenEntry, b: DashTakenEntry) -> Bool in a.at > b.at }
            var by: [DashTakenMethod: Double] = [:]
            var counts: [DashTakenMethod: Int] = [:]
            var kinds: [DashTakenKind: Int] = [:]
            var total = 0.0
            for e in list {
                total += e.amount
                kinds[e.kind, default: 0] += 1
                for (m, v) in e.split where v >= 0.005 {
                    by[m, default: 0] += v
                    counts[m, default: 0] += 1
                }
            }
            return DashTakenDay(day: DashDate.adding(days: i, to: start), total: total, bySplit: by, splitCounts: counts,
                                kindCounts: kinds, entries: list)
        }
    }
}

// MARK: The sheet

struct DashTakenSheet: View {
    /// Up to 90 days, today last, from DashFigures (worked out off the main thread with the rest of Home).
    let days: [DashTakenDay]
    /// The days of this month so far, today included.
    let monthLength: Int

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var range = Span.week
    @State private var selectedKey: String?

    enum Span: String, CaseIterable, Identifiable {
        case week = "7 days", month = "This month", thirty = "30 days", ninety = "90 days"
        var id: String { rawValue }
    }

    private func shown() -> [DashTakenDay] {
        switch range {
        case .week: return Array(days.suffix(7))
        case .month: return Array(days.suffix(max(1, monthLength)))
        case .thirty: return Array(days.suffix(30))
        case .ninety: return days
        }
    }

    private static func key(_ d: DashTakenDay) -> String { String(Int(d.day.timeIntervalSince1970)) }

    var body: some View {
        let list = shown()
        let chosen = list.first(where: { Self.key($0) == selectedKey }) ?? list.last
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: pt(16)) {
                    Picker("Range", selection: $range) {
                        ForEach(Span.allCases) { (r: Span) in Text(r.rawValue).tag(r) }
                    }
                    .pickerStyle(.segmented)
                    .selectionFeedback(trigger: range)

                    summary(list)
                    chart(list, chosen: chosen)
                    if let chosen { detail(chosen) }
                }
                .padding(.horizontal, pt(16))
                .padding(.vertical, pt(12))
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Taken")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
            }
            .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
            .onChange(of: range) { _, _ in selectedKey = nil }
        }
        #if !os(macOS)
        .presentationSizing(.page)
        #endif
    }

    // MARK: The head and the chart

    private func summary(_ list: [DashTakenDay]) -> some View {
        let total = list.reduce(0.0) { (acc: Double, d: DashTakenDay) -> Double in acc + d.total }
        let busy = list.filter { $0.total > 0 }.count
        let average = busy > 0 ? total / Double(busy) : 0
        return VStack(alignment: .leading, spacing: pt(4)) {
            DashLabel(range.rawValue == "This month" ? "Taken this month" : "Taken, last \(range.rawValue)")
            Text(Money.pkrLac(total))
                .font(.title2.weight(.semibold))
                .monospacedDigit()
                .contentTransition(.numericText(value: total))
                .motion(total)
            if busy > 0 {
                Text("\(Money.pkrLac(average)) on an average day with sales")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func chart(_ list: [DashTakenDay], chosen: DashTakenDay?) -> some View {
        let chosenKey = chosen.map { Self.key($0) }
        let labels = Dictionary(uniqueKeysWithValues: list.map { (Self.key($0), DashDate.dayMonth($0.day)) })
        // About six labels along the bottom, and always today's.
        let step = max(1, Int((Double(list.count) / 6).rounded(.up)))
        let ticks = list.indices.filter { (list.count - 1 - $0) % step == 0 }.map { Self.key(list[$0]) }
        return Chart {
            ForEach(list) { (d: DashTakenDay) in
                BarMark(x: .value("Day", Self.key(d)), y: .value("Taken", d.total))
                    .foregroundStyle(Self.key(d) == chosenKey ? Theme.accent : Theme.accent.opacity(0.3))
                    .cornerRadius(3)
            }
            RuleMark(y: .value("Nothing", 0.0))
                .lineStyle(StrokeStyle(lineWidth: 1))
                .foregroundStyle(Color.secondary.opacity(0.2))
        }
        .chartXAxis {
            AxisMarks(values: ticks) { (v: AxisValue) in
                AxisValueLabel {
                    if let k = v.as(String.self) { Text(labels[k] ?? "").font(.caption2) }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { (v: AxisValue) in
                AxisGridLine()
                AxisValueLabel {
                    if let n = v.as(Double.self) { Text(Money.axisLac(n)).font(.caption2) }
                }
            }
        }
        .chartOverlay { (proxy: ChartProxy) in
            GeometryReader { (geo: GeometryProxy) in
                // A tap or a drag across the bars picks the day under the finger.
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0).onChanged { (g: DragGesture.Value) in
                        guard let frame = proxy.plotFrame else { return }
                        let x = g.location.x - geo[frame].origin.x
                        if let k: String = proxy.value(atX: x), labels[k] != nil, k != selectedKey {
                            Motion.run(reduce: reduceMotion) { selectedKey = k }
                        }
                    })
            }
        }
        .frame(height: 220)
        .accessibilityLabel("Money taken each day, \(range.rawValue)")
        .accessibilityValue(ChartSummary.say(list.map { (label: DashDate.dayMonth($0.day), value: $0.total) }))
    }

    // MARK: A day

    private func detail(_ d: DashTakenDay) -> some View {
        VStack(alignment: .leading, spacing: pt(14)) {
            VStack(alignment: .leading, spacing: pt(4)) {
                DashLabel(DashDate.longDay(d.day))
                Text(Money.pkr(d.total))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: d.total))
                    .motion(d.total)
                if !d.entries.isEmpty {
                    Text(countsLine(d))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)

            if d.entries.isEmpty {
                Text("Nothing was taken this day.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                splitCard(d)
                VStack(spacing: 0) {
                    ForEach(d.entries) { (e: DashTakenEntry) in
                        entryRow(e)
                        if e.id != d.entries.last?.id { Divider() }
                    }
                }
                .ledgerCard()
            }
        }
    }

    /// "3 sales · 1 order · 2 repair payments".
    private func countsLine(_ d: DashTakenDay) -> String {
        DashTakenKind.allCases.compactMap { (k: DashTakenKind) -> String? in
            guard let n = d.kindCounts[k], n > 0 else { return nil }
            return "\(n) \(k.noun(n))"
        }.joined(separator: " \u{00B7} ")
    }

    /// The day by how it was paid, with how many entries each way.
    private func splitCard(_ d: DashTakenDay) -> some View {
        VStack(spacing: pt(10)) {
            ForEach(DashTakenMethod.allCases, id: \.self) { (m: DashTakenMethod) in
                if let v = d.bySplit[m], v >= 0.5 {
                    let n = d.splitCounts[m] ?? 0
                    HStack(alignment: .firstTextBaseline) {
                        Text(m.label)
                            .foregroundStyle(m == .unpaid ? Tone.owed.color : Color.primary)
                        Text("\(n)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        Spacer(minLength: 8)
                        RowAmount(amount: v, tone: m == .unpaid ? Tone.owed.color : Color.primary)
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .ledgerCard()
    }

    private func entryRow(_ e: DashTakenEntry) -> some View {
        let line = [e.time, e.who].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        let label = e.customer.isEmpty ? e.what : e.customer
        let content = HStack(alignment: .top, spacing: pt(12)) {
            Image(systemName: e.kind.symbol)
                .foregroundStyle(.secondary)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(e.customer.isEmpty ? e.methodText : [e.what, e.ref].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                Text(line.isEmpty ? e.methodText : line + " \u{00B7} " + e.methodText)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 8)
            RowAmount(amount: e.amount)
            if e.path != nil { DashChevron() }
        }
        .padding(.vertical, pt(10))
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label), \(e.what), \(Spoken.rupees(e.amount, lac: false)), \(e.methodText)")
        return Group {
            if let path = e.path {
                NavigationLink(value: Route(path: path)) { content }.buttonStyle(.plain).zoomSource(id: path)
            } else {
                content
            }
        }
    }
}
