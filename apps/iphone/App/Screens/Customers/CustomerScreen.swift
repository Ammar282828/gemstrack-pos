import SwiftUI
import ERPCore

/// One customer (src/app/customers/[id]/page.tsx), and what the web page leaves you to hunt for:
/// what they owe (the list's own figure, lib/owed.ts), their repairs, and a hisaab for owners.
/// A removed customer is not shown (store.ts splitRemoved): the web says "not found"; this says
/// they were removed, since Settings > Recently removed puts them back.
struct CustomerScreen: View {
    let id: String
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    /// A customer just made on this phone, shown until the shelf brings them (staff poll every 25 seconds).
    private let seed: Customer?

    init(id: String, seed: Customer? = nil) {
        self.id = id
        self.seed = seed
    }

    private struct Facts {
        let customer: Customer
        let invoices: [Invoice]
        let orders: [Order]
        let repairs: [Repair]
        let hisaab: [HisaabEntry]
        let owing: CustomerKit.Owing
    }

    // `items`, not `item(_:)`: the shelf's lookup is not observed, so it would not redraw when they arrive.
    private var customer: Customer? { book.customers.items.first { $0.id == id } ?? seed }

    private var ledger: [HisaabEntry]? { session.isOwner ? book.hisaab.items : nil }

    private var loaded: Bool {
        if seed != nil { return true }
        return book.customers.loaded && book.invoices.loaded && book.orders.loaded && book.repairs.loaded
            && (!session.isOwner || book.hisaab.loaded)
    }

    private var failure: String? {
        book.customers.error ?? book.invoices.error ?? book.orders.error ?? book.repairs.error
            ?? (session.isOwner ? book.hisaab.error : nil)
    }

    var body: some View {
        ShelfState(loaded: loaded, error: failure, offline: book.customers.offline) {
            content
        }
        .navigationTitle(customer.map { CustomerKit.shown($0) } ?? "Customer")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if let c = customer, !CustomerKit.isRemoved(c) {
                    // The ERP's own edit form: the sizes, dates and notes are more than a native form carries yet.
                    NavigationLink(value: Route(path: CustomerKit.path(c.id, suffix: "/edit"))) {
                        Text("Edit")
                    }
                }
            }
        }
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
            book.repairs.need()
            if session.isOwner { book.hisaab.need() }
        }
    }

    @ViewBuilder private var content: some View {
        if let c = customer {
            if CustomerKit.isRemoved(c) {
                ContentUnavailableView("Removed", systemImage: "person.crop.circle.badge.minus",
                                       description: Text("\(CustomerKit.shown(c)) was removed. Settings, then Recently removed, puts them back."))
            } else {
                page(facts(for: c))
            }
        } else {
            ContentUnavailableView("Customer not found", systemImage: "person.crop.circle.badge.questionmark",
                                   description: Text("They are not in the book on this phone."))
        }
    }

    private func facts(for c: Customer) -> Facts {
        let owed = CustomerKit.owed(invoices: book.invoices.items, customers: book.customers.items, ledger: ledger)
        let mine = book.hisaab.items.filter { $0.entityType == .customer && $0.entityId == c.id }
        return Facts(
            customer: c,
            invoices: book.invoices.items.filter { $0.customerId == c.id },
            orders: book.orders.items.filter { $0.customerId == c.id },
            repairs: book.repairs.items.filter { $0.customerId == c.id },
            hisaab: session.isOwner ? mine : [],
            owing: CustomerKit.owing(c.id, owed: owed, ledger: ledger)
        )
    }

    private func page(_ f: Facts) -> some View {
        List {
            Section {
                header(f.customer)
                    .listRowBackground(Color.clear)
            }
            owedSection(f.owing)
            detailsSection(f.customer)
            sizesSection(f.customer)
            invoicesSection(f.invoices)
            ordersSection(f.orders)
            repairsSection(f.repairs)
            if session.isOwner { hisaabSection(f.hisaab, id: f.customer.id) }
            Section {
                // Removing asks for the delete code, which only the ERP's page takes.
                NavigationLink(value: Route(path: CustomerKit.path(f.customer.id, suffix: "?web=1"))) {
                    Label("Remove this customer", systemImage: "person.badge.minus")
                }
            } footer: {
                Text("Removing hides them; their invoices, orders and hisaab stay. It asks for the delete code, so it opens on the ERP's own page.")
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: Who, and how to reach them

    private func header(_ c: Customer) -> some View {
        VStack(spacing: 14) {
            VStack(spacing: 4) {
                Text(CustomerKit.shown(c))
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                if let phone = CustomerKit.filled(c.phone) {
                    Text(phone).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            HStack(spacing: 10) {
                contact("Call", "phone.fill", CustomerKit.callURL(c.phone))
                contact("WhatsApp", "message.fill", CustomerKit.whatsAppURL(c.phone))
                contact("Message", "text.bubble.fill", CustomerKit.messageURL(c.phone))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    private func contact(_ title: String, _ symbol: String, _ url: URL?) -> some View {
        Button {
            if let url { openURL(url) }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .disabled(url == nil)
    }

    // MARK: Owed

    @ViewBuilder private func owedSection(_ o: CustomerKit.Owing) -> some View {
        Section {
            FigureTile(label: "Owed to you", value: Money.pkr(o.total), detail: owedDetail(o), tint: o.total > 0.5 ? .red : .primary)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
        }
    }

    private func owedDetail(_ o: CustomerKit.Owing) -> String {
        var parts: [String] = []
        if o.total <= 0.5 && o.shopOwesThem <= 0.5 { parts.append("Nothing outstanding") }
        if o.onInvoices > 0.5 {
            parts.append("On \(o.invoiceCount) invoice\(o.invoiceCount == 1 ? "" : "s") \(Money.pkr(o.onInvoices))")
        }
        if o.inHisaab > 0.5 { parts.append("In the hisaab \(Money.pkr(o.inHisaab))") }
        if o.shopOwesThem > 0.5 { parts.append("The hisaab owes them \(Money.pkr(o.shopOwesThem))") }
        return parts.joined(separator: " · ")
    }

    // MARK: Details and sizes

    private func detailsSection(_ c: Customer) -> some View {
        let address = [c.address, c.city, c.country].compactMap { CustomerKit.filled($0) }.joined(separator: ", ")
        return Section("Details") {
            LabeledContent("Phone", value: CustomerKit.filled(c.phone) ?? "—")
            if let alt = CustomerKit.filled(c.altPhone) { LabeledContent("Second number", value: alt) }
            LabeledContent("Email", value: CustomerKit.filled(c.email) ?? "—")
            LabeledContent("Address", value: address.isEmpty ? "—" : address)
            if let source = c.source { LabeledContent("Source", value: CustomerKit.sourceLabel(source)) }
            if let birthday = CustomerKit.filled(c.birthday) { LabeledContent("Birthday", value: CustomerKit.day(birthday)) }
            if let anniversary = CustomerKit.filled(c.anniversary) { LabeledContent("Anniversary", value: CustomerKit.day(anniversary)) }
            if let preference = CustomerKit.filled(c.preference) { LabeledContent("Prefers", value: preference) }
            if let notes = CustomerKit.filled(c.notes) { LabeledContent("Notes", value: notes) }
        }
    }

    /// One line on the web ("Ring 14 · Bangle 2.6"): here a row each, and no section when none is on file.
    @ViewBuilder private func sizesSection(_ c: Customer) -> some View {
        let ring = CustomerKit.filled(c.ringSize)
        let bangle = CustomerKit.filled(c.bangleSize)
        let bracelet = CustomerKit.filled(c.braceletSize)
        let chain = CustomerKit.filled(c.chainLength)
        if ring != nil || bangle != nil || bracelet != nil || chain != nil {
            Section("Sizes") {
                if let ring { LabeledContent("Ring", value: ring) }
                if let bangle { LabeledContent("Bangle", value: bangle) }
                if let bracelet { LabeledContent("Bracelet", value: bracelet) }
                if let chain { LabeledContent("Chain", value: chain) }
            }
        }
    }

    // MARK: Their invoices, orders, repairs

    private func invoicesSection(_ list: [Invoice]) -> some View {
        Section {
            if list.isEmpty {
                Text("No sales history found for this customer.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { inv in
                    NavigationLink(value: CustomerKit.place("/invoices/", inv.id)) {
                        CustInvoiceRow(invoice: inv)
                    }
                }
            }
        } header: {
            Text("Invoices · \(list.count)")
        }
    }

    private func ordersSection(_ list: [Order]) -> some View {
        Section {
            if list.isEmpty {
                Text("No custom orders found for this customer.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { order in
                    NavigationLink(value: CustomerKit.place("/orders/", order.id)) {
                        CustOrderRow(order: order)
                    }
                }
            }
        } header: {
            Text("Orders · \(list.count)")
        }
    }

    private func repairsSection(_ list: [Repair]) -> some View {
        Section {
            if list.isEmpty {
                Text("No repairs for this customer.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { repair in
                    NavigationLink(value: CustomerKit.place("/repairs?id=", repair.id)) {
                        CustRepairRow(repair: repair)
                    }
                }
            }
        } header: {
            Text("Repairs · \(list.count)")
        }
    }

    // MARK: Hisaab (owners)

    private static let hisaabShown = 12

    private func hisaabSection(_ rows: [HisaabEntry], id: String) -> some View {
        Section {
            if rows.isEmpty {
                Text("Nothing is written in their hisaab.").foregroundStyle(.secondary)
            }
            ForEach(rows.prefix(Self.hisaabShown)) { row in
                CustHisaabRow(entry: row)
            }
            NavigationLink(value: Route(path: CustomerKit.hisaabPath(id))) {
                Label(rows.count > Self.hisaabShown ? "All \(rows.count) rows in their hisaab" : "Open their hisaab", systemImage: "book.closed")
            }
        } header: {
            Text("Hisaab")
        }
    }
}

// MARK: Rows

private struct CustInvoiceRow: View {
    let invoice: Invoice

    private var line: BalanceLine { balanceLine(invoice.balanceDue) }
    private var refunded: Bool { invoice.status == .refunded }

    private var subtitle: String {
        var parts = [ShopDate.say(invoice.createdAt)]
        if refunded {
            parts.append("refunded")
        } else if line.state == .due {
            parts.append("owes \(Money.pkr(line.amount))")
        } else if line.state == .credit {
            parts.append("credit \(Money.pkr(line.amount))")
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        TwoLine(title: invoice.id, subtitle: subtitle, trailing: Money.pkr(invoice.grandTotal),
                trailingTint: (!refunded && line.state == .due) ? .red : .primary)
    }
}

private struct CustOrderRow: View {
    let order: Order

    private var closed: Bool { order.status == .cancelled || order.status == .refunded }
    private var invoiced: Bool { !(order.invoiceId ?? "").isEmpty }

    private var subtitle: String {
        var parts = [ShopDate.say(order.createdAt)]
        let n = order.items.count
        if n > 0 { parts.append("\(n) piece\(n == 1 ? "" : "s")") }
        if invoiced { parts.append("invoiced") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        // The order's total is stored net of its advances, so it is the balance still to pay (order-payment.ts).
        HStack(spacing: 8) {
            TwoLine(title: order.id, subtitle: subtitle, trailing: Money.pkr(order.grandTotal),
                    trailingTint: (closed || invoiced) ? .secondary : .primary)
            StatusBadge(order: order.status)
        }
    }
}

private struct CustRepairRow: View {
    let repair: Repair

    private var balance: Double { CustomerKit.repairBalance(repair) }
    private var open: Bool { repair.status == .received || repair.status == .ready }

    private var subtitle: String {
        var parts = [repair.id, ShopDate.say(repair.receivedAt)]
        if open, let promised = CustomerKit.filled(repair.promisedDate) { parts.append("promised \(ShopDate.say(promised))") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        let status = CustomerKit.repairStatus(repair.status)
        HStack(spacing: 8) {
            TwoLine(title: CustomerKit.repairSummary(repair), subtitle: subtitle,
                    trailing: (open && balance > 0) ? Money.pkr(balance) : nil, trailingTint: .red)
            StatusBadge(status.text, color: status.color)
        }
    }
}

private struct CustHisaabRow: View {
    let entry: HisaabEntry

    private var net: Double { entry.cashDebit - entry.cashCredit }

    private var subtitle: String {
        var parts = [ShopDate.say(entry.date)]
        // The house's own metal: the hisaab's "gold" columns hold silver in House of Mina (STORE_METAL_WORD).
        if entry.goldDebitGrams > 0 { parts.append("gave \(CustomerKit.grams(entry.goldDebitGrams)) g \(House.metal)") }
        if entry.goldCreditGrams > 0 { parts.append("got \(CustomerKit.grams(entry.goldCreditGrams)) g \(House.metal)") }
        if let inv = CustomerKit.filled(entry.linkedInvoiceId) { parts.append("invoice \(inv)") }
        return parts.joined(separator: " · ")
    }

    /// What they owe goes up (+), what they pay comes off (-): debit less credit, as the ERP keeps it.
    private var amount: String? {
        if abs(net) < 0.5 { return nil }
        return (net > 0 ? "+" : "-") + Money.pkr(abs(net))
    }

    var body: some View {
        TwoLine(title: CustomerKit.filled(entry.description) ?? "Entry", subtitle: subtitle,
                trailing: amount, trailingTint: net > 0 ? .red : .green)
    }
}
