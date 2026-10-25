#if os(macOS)
import SwiftUI
import ERPCore

// The tables of a customer's record window (docs/features/mac-design.md, "Customers"): their invoices, orders, repairs and
// hisaab, one at a time, each sortable and filling the window; the toolbar's segmented control picks which. A row opens in a
// window of its own (double-click, Return, the right-click menu). The rows are the customer page's own facts
// (CustomerScreen `Facts`); nothing is worked out here that the iPhone's page does not.

// MARK: - Invoices

/// One of the customer's invoices as a row.
struct MacCustomerRecordInvoiceRow: Identifiable {
    let invoice: Invoice
    let date: String
    let total: Double
    let paid: Double
    let owed: Double
    let credit: Double
    let state: String
    let tone: Tone
    var id: String { invoice.id }

    init(_ inv: Invoice) {
        invoice = inv
        date = inv.createdAt
        total = inv.grandTotal
        paid = inv.amountPaid
        let line = balanceLine(inv.balanceDue)
        let refunded = inv.status == .refunded
        owed = (!refunded && line.state == .due) ? line.amount : 0
        credit = InvoiceCredit.held(inv)
        if refunded {
            state = "Refunded"
            tone = .quiet
        } else if line.state == .due {
            state = "Owed"
            tone = .owed
        } else if line.state == .credit {
            state = "In credit"
            tone = .credit
        } else {
            state = "Paid"
            tone = .settled
        }
    }
}

struct MacCustomerRecordInvoices: View {
    let invoices: [Invoice]
    /// `Shelf.revision` of the invoices: the rows are made again only when it, or the sort, changes.
    let revision: Int
    @Binding var selection: Set<String>
    let owner: Bool
    let open: (String) -> Void
    let giveBack: (Invoice) -> Void

    @State private var sort = [KeyPathComparator(\MacCustomerRecordInvoiceRow.date, order: .reverse)]
    @State private var made = Memo<[MacCustomerRecordInvoiceRow]>()

    var body: some View {
        let rows = made([revision, invoices.count, sort.hashValue]) {
            invoices.map { (i: Invoice) in MacCustomerRecordInvoiceRow(i) }.sorted(using: sort)
        }
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Invoice", value: \.id) { (r: MacCustomerRecordInvoiceRow) in Text(r.id).monospacedDigit() }
                .width(min: 90, ideal: 120)
            TableColumn("Date", value: \.date) { (r: MacCustomerRecordInvoiceRow) in Text(ShopDate.say(r.date)) }
                .width(min: 80, ideal: 100)
            TableColumn("Total", value: \.total) { (r: MacCustomerRecordInvoiceRow) in money(r.total) }
                .width(min: 90, ideal: 110)
            TableColumn("Paid", value: \.paid) { (r: MacCustomerRecordInvoiceRow) in money(r.paid) }
                .width(min: 90, ideal: 110)
            TableColumn("Owed", value: \.owed) { (r: MacCustomerRecordInvoiceRow) in
                // Only what needs someone is coloured: a settled or refunded bill shows nothing here.
                money(r.owed).foregroundStyle(Tone.owed.color)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Credit", value: \.credit) { (r: MacCustomerRecordInvoiceRow) in
                money(r.credit).foregroundStyle(Tone.credit.color)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Status", value: \.state) { (r: MacCustomerRecordInvoiceRow) in MacStatus(r.state, tone: r.tone) }
                .width(min: 90, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            if let id = ids.first {
                Button("Open in New Window") { for i in ids.prefix(5) { open(i) } }
                if owner, ids.count == 1, let row = rows.first(where: { (r: MacCustomerRecordInvoiceRow) in r.id == id }), row.credit >= 1 {
                    Divider()
                    Button("Give Back \(Money.pkr(row.credit))…") { giveBack(row.invoice) }
                }
                Divider()
                Button("Copy Number") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
            }
        } primaryAction: { (ids: Set<String>) in
            for id in ids.prefix(5) { open(id) }
        }
        .overlay { if rows.isEmpty { ContentUnavailableView("No sales history found for this customer", systemImage: "doc.text") } }
    }

    /// Whole rupees, right-aligned; under one rupee is nothing.
    private func money(_ v: Double) -> some View {
        Text(v >= 1 ? Money.pkr(v) : "")
            .monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - Orders

struct MacCustomerRecordOrderRow: Identifiable {
    let order: Order
    let date: String
    let pieces: Int
    let status: String
    let tone: Tone
    let toPay: Double
    let closed: Bool
    let invoiceId: String
    var id: String { order.id }

    init(_ o: Order) {
        order = o
        date = o.createdAt
        pieces = o.items.count
        status = o.status.rawValue.isEmpty ? "No status" : o.status.rawValue
        tone = Tone(status: o.status)
        // The order's total is stored net of its advances: it is what is still to pay (order-payment.ts).
        toPay = o.grandTotal
        invoiceId = o.invoiceId ?? ""
        closed = o.status == .cancelled || o.status == .refunded || !(o.invoiceId ?? "").isEmpty
    }
}

struct MacCustomerRecordOrders: View {
    let orders: [Order]
    let revision: Int
    @Binding var selection: Set<String>
    let open: (String) -> Void

    @State private var sort = [KeyPathComparator(\MacCustomerRecordOrderRow.date, order: .reverse)]
    @State private var made = Memo<[MacCustomerRecordOrderRow]>()

    var body: some View {
        let rows = made([revision, orders.count, sort.hashValue]) {
            orders.map { (o: Order) in MacCustomerRecordOrderRow(o) }.sorted(using: sort)
        }
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Order", value: \.id) { (r: MacCustomerRecordOrderRow) in Text(r.id).monospacedDigit() }
                .width(min: 90, ideal: 120)
            TableColumn("Taken", value: \.date) { (r: MacCustomerRecordOrderRow) in Text(ShopDate.say(r.date)) }
                .width(min: 80, ideal: 100)
            TableColumn("Pieces", value: \.pieces) { (r: MacCustomerRecordOrderRow) in Text("\(r.pieces)").monospacedDigit() }
                .width(60)
            TableColumn("Status", value: \.status) { (r: MacCustomerRecordOrderRow) in MacStatus(r.status, tone: r.tone) }
                .width(min: 100, ideal: 130)
            TableColumn("Still to pay", value: \.toPay) { (r: MacCustomerRecordOrderRow) in
                Text(Money.pkr(r.toPay))
                    .monospacedDigit()
                    .foregroundStyle(r.closed ? Color.secondary : Color.primary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Invoice", value: \.invoiceId) { (r: MacCustomerRecordOrderRow) in
                Text(r.invoiceId).monospacedDigit().foregroundStyle(.secondary)
            }
            .width(min: 80, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            if !ids.isEmpty {
                Button("Open in New Window") { for i in ids.prefix(5) { open(i) } }
                Divider()
                Button("Copy Number") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
            }
        } primaryAction: { (ids: Set<String>) in
            for id in ids.prefix(5) { open(id) }
        }
        .overlay { if rows.isEmpty { ContentUnavailableView("No orders", systemImage: "shippingbox") } }
    }
}

// MARK: - Repairs

struct MacCustomerRecordRepairRow: Identifiable {
    let repair: Repair
    let piece: String
    let received: String
    let promised: String
    let state: String
    let tone: Tone
    let owed: Double
    var id: String { repair.id }

    init(_ r: Repair) {
        repair = r
        piece = CustomerKit.repairSummary(r)
        received = r.receivedAt
        let open = r.status == .received || r.status == .ready
        promised = open ? (CustomerKit.filled(r.promisedDate) ?? "") : ""
        let s = CustomerKit.repairStatus(r.status)
        state = s.text
        tone = s.tone
        let balance = CustomerKit.repairBalance(r)
        owed = open && balance >= 1 ? balance : 0
    }
}

struct MacCustomerRecordRepairs: View {
    let repairs: [Repair]
    let revision: Int
    @Binding var selection: Set<String>
    let open: (String) -> Void

    @State private var sort = [KeyPathComparator(\MacCustomerRecordRepairRow.received, order: .reverse)]
    @State private var made = Memo<[MacCustomerRecordRepairRow]>()

    var body: some View {
        let rows = made([revision, repairs.count, sort.hashValue]) {
            repairs.map { (r: Repair) in MacCustomerRecordRepairRow(r) }.sorted(using: sort)
        }
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Repair", value: \.piece)
                .width(min: 140, ideal: 220)
            TableColumn("Ticket", value: \.id) { (r: MacCustomerRecordRepairRow) in Text(r.id).monospacedDigit() }
                .width(min: 80, ideal: 100)
            TableColumn("Received", value: \.received) { (r: MacCustomerRecordRepairRow) in Text(ShopDate.say(r.received)) }
                .width(min: 80, ideal: 100)
            TableColumn("Promised", value: \.promised) { (r: MacCustomerRecordRepairRow) in
                Text(r.promised.isEmpty ? "" : ShopDate.say(r.promised))
            }
            .width(min: 80, ideal: 100)
            TableColumn("Status", value: \.state) { (r: MacCustomerRecordRepairRow) in MacStatus(r.state, tone: r.tone) }
                .width(min: 90, ideal: 110)
            TableColumn("Owed", value: \.owed) { (r: MacCustomerRecordRepairRow) in
                Text(r.owed >= 1 ? Money.pkr(r.owed) : "")
                    .monospacedDigit()
                    .foregroundStyle(Tone.owed.color)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            if !ids.isEmpty {
                Button("Open in New Window") { for i in ids.prefix(5) { open(i) } }
                Divider()
                Button("Copy Number") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
            }
        } primaryAction: { (ids: Set<String>) in
            for id in ids.prefix(5) { open(id) }
        }
        .overlay { if rows.isEmpty { ContentUnavailableView("No repairs", systemImage: "wrench.and.screwdriver") } }
    }
}

// MARK: - Hisaab

struct MacCustomerRecordHisaabRow: Identifiable {
    let entry: HisaabEntry
    let date: String
    let what: String
    let metal: String
    let gave: Double
    let got: Double
    let invoiceId: String
    var id: String { entry.id }

    init(_ e: HisaabEntry) {
        entry = e
        date = e.date
        what = CustomerKit.filled(e.description) ?? "Entry"
        // The house's own metal: the hisaab's "gold" columns hold silver in House of Mina (STORE_METAL_WORD).
        var parts: [String] = []
        if e.goldDebitGrams > 0 { parts.append("gave \(CustomerKit.grams(e.goldDebitGrams)) g \(House.metal)") }
        if e.goldCreditGrams > 0 { parts.append("got \(CustomerKit.grams(e.goldCreditGrams)) g \(House.metal)") }
        metal = parts.joined(separator: " \u{00B7} ")
        gave = e.cashDebit
        got = e.cashCredit
        invoiceId = CustomerKit.filled(e.linkedInvoiceId) ?? ""
    }
}

struct MacCustomerRecordHisaab: View {
    let rows: [HisaabEntry]
    let revision: Int
    @Binding var selection: Set<String>
    let openInvoice: (String) -> Void
    let openHisaab: () -> Void

    @State private var sort = [KeyPathComparator(\MacCustomerRecordHisaabRow.date, order: .reverse)]
    @State private var made = Memo<[MacCustomerRecordHisaabRow]>()

    var body: some View {
        let lines = made([revision, rows.count, sort.hashValue]) {
            rows.map { (e: HisaabEntry) in MacCustomerRecordHisaabRow(e) }.sorted(using: sort)
        }
        Table(lines, selection: $selection, sortOrder: $sort) {
            TableColumn("Date", value: \.date) { (r: MacCustomerRecordHisaabRow) in Text(ShopDate.say(r.date)) }
                .width(min: 80, ideal: 100)
            TableColumn("Entry", value: \.what) { (r: MacCustomerRecordHisaabRow) in
                VStack(alignment: .leading, spacing: 1) {
                    Text(r.what)
                    if !r.metal.isEmpty { Text(r.metal).font(.caption).foregroundStyle(.secondary) }
                }
            }
            TableColumn("You gave", value: \.gave) { (r: MacCustomerRecordHisaabRow) in
                Text(r.gave > 0 ? Money.pkr(r.gave) : "")
                    .monospacedDigit()
                    .foregroundStyle(Tone.owed.color)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("You got", value: \.got) { (r: MacCustomerRecordHisaabRow) in
                Text(r.got > 0 ? Money.pkr(r.got) : "")
                    .monospacedDigit()
                    .foregroundStyle(Tone.settled.color)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Invoice", value: \.invoiceId) { (r: MacCustomerRecordHisaabRow) in
                Text(r.invoiceId).monospacedDigit().foregroundStyle(.secondary)
            }
            .width(min: 80, ideal: 100)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            if let eid = ids.first, let inv = lines.first(where: { (r: MacCustomerRecordHisaabRow) in r.id == eid })?.invoiceId, !inv.isEmpty {
                Button("Open Invoice in New Window") { openInvoice(inv) }
            }
            Button("Open Their Hisaab in New Window") { openHisaab() }
        } primaryAction: { (ids: Set<String>) in
            if let eid = ids.first, let inv = lines.first(where: { (r: MacCustomerRecordHisaabRow) in r.id == eid })?.invoiceId, !inv.isEmpty {
                openInvoice(inv)
            } else {
                openHisaab()
            }
        }
        .overlay { if lines.isEmpty { ContentUnavailableView("Nothing in their hisaab", systemImage: "book.closed") } }
    }
}
#endif
