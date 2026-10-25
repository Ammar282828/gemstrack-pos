#if os(macOS)
import SwiftUI
import ERPCore

// One person's hisaab ledger as a Mac record window (docs/features/mac-design.md, "Money"): a document header (who, what they owe
// or are owed), the ledger as one sortable table filling the window, and the Hisaab menu. The rows, the running balances and
// the writes are the ledger page's own (HisaabLedgerScreen): this view only lays them out. It holds the table's picked row
// and sort itself, so a click on a row redraws this view and not the page, which would walk every ledger row of the book.

/// One row of the ledger as a table row, to sort by.
struct MacHisaabLedgerRow: Identifiable {
    let line: HisaabLedgerLine
    let date: String
    let what: String
    let gave: Double
    let got: Double
    let balance: Double
    let invoiceId: String
    var id: String { line.entry.id }

    init(_ l: HisaabLedgerLine) {
        line = l
        date = l.entry.date
        what = l.entry.description.isEmpty ? "No description" : l.entry.description
        gave = l.entry.cashDebit
        got = l.entry.cashCredit
        balance = l.cash
        invoiceId = CustomerKit.filled(l.entry.linkedInvoiceId) ?? ""
    }
}

struct MacHisaabLedgerView: View {
    let page: HisaabLedgerPage
    let name: String
    let isCustomer: Bool
    let onFile: Bool
    /// The actions that do not depend on a picked row (You Gave, You Got, the reminder, the PDF), declared by the page so its
    /// toolbar and this menu are the same ones.
    let base: [[MacAction]]
    let deleteEntry: (HisaabEntry) -> Void

    @Environment(Book.self) private var book
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var selection = Set<String>()
    @State private var sort = [KeyPathComparator(\MacHisaabLedgerRow.date, order: .reverse)]
    @State private var made = Memo<[MacHisaabLedgerRow]>()
    @State private var pushed: Route?

    var body: some View {
        let rows = made([book.hisaab.revision, page.lines.count, sort.hashValue]) {
            page.lines.map { (l: HisaabLedgerLine) in MacHisaabLedgerRow(l) }.sorted(using: sort)
        }
        VStack(spacing: 0) {
            MacDocumentHeader(title: name.isEmpty ? "Hisaab" : name, subtitle: isCustomer ? "Customer ledger" : "Karigar ledger", headline: headline)
            Divider()
            table(rows)
        }
        .macSummaryBar(summary)
        .macRecordMenu(MacRecordMenu(title: "Hisaab", groups: base + selected(selection)))
        .navigationDestination(item: $pushed) { (r: Route) in PlaceScreen(path: r.path) }
    }

    // MARK: The table

    private func table(_ rows: [MacHisaabLedgerRow]) -> some View {
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Date", value: \.date) { (r: MacHisaabLedgerRow) in Text(ShopDate.say(r.date)) }
                .width(min: 80, ideal: 100)
            TableColumn("Entry", value: \.what)
                .width(min: 160, ideal: 320)
            TableColumn("You gave", value: \.gave) { (r: MacHisaabLedgerRow) in
                moves(cash: r.line.entry.cashDebit, grams: r.line.entry.goldDebitGrams, tone: Tone.owed.color)
            }
            .width(min: 100, ideal: 120)
            TableColumn("You got", value: \.got) { (r: MacHisaabLedgerRow) in
                moves(cash: r.line.entry.cashCredit, grams: r.line.entry.goldCreditGrams, tone: Tone.settled.color)
            }
            .width(min: 100, ideal: 120)
            TableColumn("Balance", value: \.balance) { (r: MacHisaabLedgerRow) in
                VStack(alignment: .trailing, spacing: 1) {
                    Text(Money.pkr(r.line.cash))
                    if page.hasGold {
                        Text("\(MoneyFormat.grams(r.line.gold)) \(MoneyWords.metal)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .monospacedDigit()
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 120, ideal: 150)
            TableColumn("Invoice", value: \.invoiceId) { (r: MacHisaabLedgerRow) in
                Text(r.invoiceId).monospacedDigit().foregroundStyle(.secondary)
            }
            .width(min: 80, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            MacActionItems(groups: base + selected(ids))
            if let e = entry(ids) {
                Divider()
                Button("Copy Entry") { UIPasteboard.general.string = e.description }
            }
        } primaryAction: { (ids: Set<String>) in
            if let inv = invoice(ids) { go(Route(path: MoneyPaths.invoice(inv))) }
        }
        .onDeleteCommand {
            if onFile, let e = entry(selection) { deleteEntry(e) }
        }
        .overlay { if rows.isEmpty { ContentUnavailableView("No transactions found", systemImage: "book.closed") } }
    }

    /// Cash (and the metal under it) one way: "You gave" or "You got".
    private func moves(cash: Double, grams: Double, tone: Color) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            if cash > 0 { Text(Money.pkr(cash)).foregroundStyle(tone) }
            if grams > 0 { Text("\(MoneyFormat.grams(grams)) g").font(.caption).foregroundStyle(.secondary) }
        }
        .monospacedDigit()
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // MARK: Head and foot

    /// You will get (a positive balance: they owe the shop) or you will give, the metal beside the cash.
    private var headline: MacHeadline? {
        guard abs(page.cash) >= 1 || abs(page.gold) > 0.0005 else { return nil }
        var value = abs(page.cash) >= 1 ? Money.pkr(abs(page.cash)) : ""
        if abs(page.gold) > 0.0005 {
            let metal = "\(MoneyFormat.grams(abs(page.gold))) \(MoneyWords.metal)"
            value = value.isEmpty ? metal : value + " + " + metal
        }
        let gets = page.cash >= 1 || (abs(page.cash) < 1 && page.gold > 0)
        return gets ? MacHeadline("You will get", value, tone: .owed) : MacHeadline("You will give", value, tone: .credit)
    }

    private var summary: [String] {
        let n = page.lines.count
        var parts = ["\(n) transaction\(n == 1 ? "" : "s")", "Balance \(Money.pkr(page.cash))"]
        if page.hasGold { parts.append("\(MoneyFormat.grams(page.gold)) \(MoneyWords.metal)") }
        return parts
    }

    // MARK: The row's actions

    private func entry(_ ids: Set<String>) -> HisaabEntry? {
        guard ids.count == 1, let id = ids.first else { return nil }
        return book.hisaab.item(id)
    }

    private func invoice(_ ids: Set<String>) -> String? {
        entry(ids).flatMap { (e: HisaabEntry) -> String? in CustomerKit.filled(e.linkedInvoiceId) }
    }

    private func selected(_ ids: Set<String>) -> [[MacAction]] {
        let e = entry(ids)
        let inv = invoice(ids)
        let open = MacAction("Open Invoice", symbol: "doc.text", shortcut: KeyboardShortcut(.return, modifiers: []),
                             enabled: inv != nil, id: "invoice") {
            if let inv { go(Route(path: MoneyPaths.invoice(inv))) }
        }
        let delete = MacAction("Delete Entry\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: onFile && e != nil, id: "delete") {
            if let e { deleteEntry(e) }
        }
        return [[open], [delete]]
    }

    /// The invoice in a window of its own; in the stack where windows are not offered.
    private func go(_ route: Route) {
        if let openPlace { openPlace(route) } else { pushed = route }
    }
}
#endif
