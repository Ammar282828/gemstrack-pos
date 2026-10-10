import SwiftUI
import ERPCore

/// Money → Hisaab → one person (src/app/hisaab/[entityId]/page.tsx): what they owe the shop or the
/// shop owes them, and every row of their ledger by date with the balance as it stood.
///
/// "You gave" and "You got" write a row (HisaabEntrySheet; `addHisaabEntry`), and a swipe deletes one: the ERP
/// asks for the delete code with the delete (`deleteHisaabEntry`, lib/writes/hisaab-entries.ts). Both are for a
/// customer or karigar who is on file, as the web's page is: a walk-in's balance has no page to write on.
/// The ledger PDF is built by the ERP's page in the browser (jsPDF, no server copy), so Print opens that page,
/// and so does the WhatsApp reminder.
struct HisaabLedgerScreen: View {
    /// "/hisaab/<id>?type=customer|karigar".
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var adding: HisaabEntryMode?
    @State private var deletion: OwnerDeletion?
    @State private var note: OwnerNote?

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
            ledger(name: name, id: id, isCustomer: isCustomer, rows: rows, onFile: onFile(id: id, isCustomer: isCustomer, customer: customer, karigar: karigar))
        }
    }

    /// Whether the person is a live record the web's page would find: a removed one, and a walk-in, are not, and
    /// the web writes nothing on them.
    private func onFile(id: String, isCustomer: Bool, customer: Customer?, karigar: Karigar?) -> Bool {
        if id == WALK_IN_ENTITY { return false }
        if isCustomer { return customer.map { !CustomerKit.isRemoved($0) } ?? false }
        return karigar.map { ($0.deletedAt ?? "").isEmpty } ?? false
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
    private func ledger(name: String, id: String, isCustomer: Bool, rows: [HisaabEntry], onFile: Bool) -> some View {
        let result = HisaabLedger.page(rows)
        // The ERP's own page: the ledger PDF and the WhatsApp reminder are built there, in the browser.
        let printPath = MoneyPaths.ledger(id, isCustomer: isCustomer, web: true)
        List { Group {
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
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if onFile {
                                    Button(role: .destructive) { askToDelete(line.entry) } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                    }
                }
            } header: {
                LedgerHeading(title: "Transactions · \(result.lines.count)")
            } footer: {
                if onFile && !result.lines.isEmpty {
                    Text("Swipe a transaction to delete it. It asks for the delete code.")
                }
            }
            if onFile {
                Section {
                    Button { adding = .gave } label: {
                        Label("You gave", systemImage: "arrow.up")
                    }
                    Button { adding = .got } label: {
                        Label("You got", systemImage: "arrow.down")
                    }
                } footer: {
                    Text("Writes a row in their hisaab, dated today.")
                }
            }
            Section {
                NavigationLink(value: Route(path: printPath)) {
                    Label("Print the ledger or send a reminder", systemImage: "printer")
                }
            } footer: {
                Text("The ledger PDF and the WhatsApp reminder are made on the ERP's own page.")
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .navigationTitle(name.isEmpty ? "Hisaab" : name)
        .toolbar {
            if onFile {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { adding = .gave } label: { Label("You gave", systemImage: "arrow.up") }
                        Button { adding = .got } label: { Label("You got", systemImage: "arrow.down") }
                    } label: {
                        Label("Add entry", systemImage: "plus")
                    }
                }
            }
        }
        .sheet(item: $adding) { (mode: HisaabEntryMode) in
            HisaabEntrySheet(mode: mode, personId: id, personName: name, isCustomer: isCustomer) { (saved: OwnerNote) in
                withAnimation { note = saved }
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                withAnimation { note = OwnerNote(title: "Transaction deleted") }
            }
        }
        .ownerNote($note)
    }

    /// The web's confirmation, then the delete code with the delete. A row that follows an invoice's balance is
    /// put back by the ERP while the invoice still owes, so the sheet says so.
    private func askToDelete(_ entry: HisaabEntry) {
        let said = entry.description.isEmpty ? "No description" : entry.description
        var detail = "Delete this transaction? \u{201C}\(said)\u{201D}"
        if let invoice = entry.linkedInvoiceId, !invoice.isEmpty {
            detail += " It follows the balance of invoice \(invoice), so the ERP writes it again while the invoice still owes."
        }
        deletion = OwnerDeletion(what: "Delete this ledger entry", detail: detail) { code in
            _ = try await ERPAPI.shared.write("deleteHisaabEntry", ["entryId": entry.id, "deleteCode": code])
        }
    }

    /// You will get (positive balance) beside You will give, the metal under each.
    private func tiles(_ r: HisaabLedgerPage) -> some View {
        let getGold: String? = r.gold > 0 ? "\(MoneyFormat.grams(r.gold)) \(MoneyWords.metal)" : nil
        let giveGold: String? = r.gold < 0 ? "\(MoneyFormat.grams(abs(r.gold))) \(MoneyWords.metal)" : nil
        return FigureRow(alignment: .top, spacing: 10) {
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
