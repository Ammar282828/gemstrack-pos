import SwiftUI
import ERPCore

/// Money → Hisaab → one person (src/app/hisaab/[entityId]/page.tsx): what they owe the shop or the
/// shop owes them, and every row of their ledger by date with the balance as it stood. Read only:
/// "You gave", "You got" and Delete ask for the delete code, so they are the ERP's page; so are the
/// ledger PDF and the WhatsApp reminder.
struct HisaabLedgerScreen: View {
    /// "/hisaab/<id>?type=customer|karigar".
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    private var entityId: String { MoneyPaths.ledgerID(fromPath: path) ?? "" }

    var body: some View {
        if session.isOwner {
            owners
        } else {
            MoneyOwnersOnly(title: "Hisaab")
        }
    }

    private var ready: Bool {
        book.hisaab.loaded && book.customers.loaded && book.karigars.loaded
    }

    private var owners: some View {
        ShelfState(loaded: ready, error: book.hisaab.error, offline: book.hisaab.offline) {
            page
        }
        .task {
            book.hisaab.need()
            book.customers.need()
            book.karigars.need()
        }
    }

    // MARK: The person

    @ViewBuilder
    private var page: some View {
        let id = entityId
        let rows = book.hisaab.items.filter { $0.entityId == id }
        let customer = book.customers.item(id)
        let karigar = book.karigars.item(id)
        let isCustomer = personIsCustomer(rows: rows, customer: customer, karigar: karigar)
        let name = personName(id: id, rows: rows, isCustomer: isCustomer, customer: customer, karigar: karigar)
        if name.isEmpty && rows.isEmpty {
            // The web says "Entity not found. It may have been deleted."
            ContentUnavailableView("Not found", systemImage: "person.crop.circle.badge.questionmark", description: Text("It may have been deleted."))
                .navigationTitle("Hisaab")
        } else {
            ledger(name: name, id: id, isCustomer: isCustomer, rows: rows)
        }
    }

    /// `?type=` says which book the person is in; without it the rows, then the records, decide.
    private func personIsCustomer(rows: [HisaabEntry], customer: Customer?, karigar: Karigar?) -> Bool {
        switch MoneyPaths.query("type", in: path) ?? "" {
        case "karigar": return false
        case "customer": return true
        default: break
        }
        if let first = rows.first {
            if case .karigar = first.entityType { return false }
            if case .customer = first.entityType { return true }
        }
        return !(karigar != nil && customer == nil)
    }

    private func personName(id: String, rows: [HisaabEntry], isCustomer: Bool, customer: Customer?, karigar: Karigar?) -> String {
        if id == WALK_IN_ENTITY { return WALK_IN_NAME }
        let own = isCustomer ? customer?.name : karigar?.name
        let other = isCustomer ? karigar?.name : customer?.name
        let named = own ?? other ?? rows.first?.entityName ?? ""
        return named.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: The ledger

    @ViewBuilder
    private func ledger(name: String, id: String, isCustomer: Bool, rows: [HisaabEntry]) -> some View {
        let result = HisaabLedger.page(rows)
        let addPath = MoneyPaths.ledger(id, isCustomer: isCustomer, web: true)
        List {
            Section {
                tiles(result)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text(isCustomer ? "Customer ledger" : "Karigar ledger").textCase(nil)
            }
            Section {
                if result.lines.isEmpty {
                    Text("No transactions found.").foregroundStyle(.secondary)
                } else {
                    ForEach(result.lines) { line in
                        lineRow(line, showGold: result.hasGold)
                    }
                }
            } header: {
                Text("Transactions · \(result.lines.count)")
            }
            Section {
                NavigationLink(value: Route(path: addPath)) {
                    Label("Add an entry, print or remind", systemImage: "safari")
                }
            } footer: {
                Text("“You gave”, “You got” and Delete ask for the delete code, so they stay on the ERP's page.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(name.isEmpty ? "Hisaab" : name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route(path: addPath)) {
                    Label("Add entry", systemImage: "plus")
                }
            }
        }
    }

    /// You will get (positive balance) beside You will give, the metal under each.
    private func tiles(_ r: HisaabLedgerPage) -> some View {
        let getGold: String? = r.gold > 0 ? "\(MoneyFormat.grams(r.gold)) \(MoneyWords.metal)" : nil
        let giveGold: String? = r.gold < 0 ? "\(MoneyFormat.grams(abs(r.gold))) \(MoneyWords.metal)" : nil
        return HStack(alignment: .top, spacing: 10) {
            FigureTile(label: "You will get", value: Money.pkr(max(0, r.cash)), detail: getGold, tint: .green)
            FigureTile(label: "You will give", value: Money.pkr(abs(min(0, r.cash))), detail: giveGold, tint: .red)
        }
        .padding(.vertical, 4)
    }

    /// A row that is an invoice's own balance opens the invoice (the web's link beside it).
    @ViewBuilder
    private func lineRow(_ line: HisaabLedgerLine, showGold: Bool) -> some View {
        if let invoiceId = line.entry.linkedInvoiceId, !invoiceId.isEmpty {
            NavigationLink(value: Route(path: MoneyPaths.invoice(invoiceId))) {
                HisaabLedgerRow(line: line, showGold: showGold)
            }
        } else {
            HisaabLedgerRow(line: line, showGold: showGold)
        }
    }
}

// MARK: One row

/// What was written, when, how much each way, and the balance after it. "You gave" is a debit (red),
/// "You got" a credit (green): the web's words and colours; a positive balance is owed to the shop.
private struct HisaabLedgerRow: View {
    let line: HisaabLedgerLine
    let showGold: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(line.entry.description.isEmpty ? "No description" : line.entry.description)
                    .font(.body.weight(.medium))
                    .lineLimit(2)
                Text(ShopDate.say(line.entry.date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                moves
                balances
            }
        }
    }

    @ViewBuilder
    private var moves: some View {
        let e = line.entry
        if e.cashDebit > 0 {
            Text("You gave \(Money.pkr(e.cashDebit))").font(.subheadline.weight(.semibold)).foregroundStyle(.red)
        }
        if e.cashCredit > 0 {
            Text("You got \(Money.pkr(e.cashCredit))").font(.subheadline.weight(.semibold)).foregroundStyle(.green)
        }
        if e.goldDebitGrams > 0 {
            Text("You gave \(MoneyFormat.grams(e.goldDebitGrams))").font(.caption).foregroundStyle(.red)
        }
        if e.goldCreditGrams > 0 {
            Text("You got \(MoneyFormat.grams(e.goldCreditGrams))").font(.caption).foregroundStyle(.green)
        }
    }

    @ViewBuilder
    private var balances: some View {
        Text("Balance \(Money.pkr(line.cash))")
            .font(.caption)
            .foregroundStyle(tone(line.cash))
        if showGold {
            Text("\(MoneyFormat.grams(line.gold)) \(MoneyWords.metal)")
                .font(.caption)
                .foregroundStyle(tone(line.gold))
        }
    }

    private func tone(_ balance: Double) -> Color {
        if abs(balance) < 0.001 { return Color.secondary }
        return balance > 0 ? Color.green : Color.red
    }
}
