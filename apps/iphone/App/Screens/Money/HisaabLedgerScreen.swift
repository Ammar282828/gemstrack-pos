import SwiftUI
import ERPCore

/// Money → Hisaab → one person (src/app/hisaab/[entityId]/page.tsx): what they owe the shop or the
/// shop owes them, and every row of their ledger by date with the balance as it stood.
///
/// "You gave" and "You got" write a row (HisaabEntrySheet; `addHisaabEntry`), and a swipe deletes one: the ERP
/// asks for the delete code with the delete (`deleteHisaabEntry`, lib/writes/hisaab-entries.ts). Both are for a
/// customer or karigar who is on file, as the web's page is: a walk-in's balance has no page to write on.
/// Print is the page's Ledger Statement, drawn by the ERP's server with the page's own drawer and running balance
/// (src/lib/hisaab-pdf.ts, /api/app/pdf/hisaab/[id]). The WhatsApp reminder of what a customer owes is the web's own
/// words, written by the server (/api/app/hisaab/[id]/reminder, hisaab-report.ts reminderMessage), shown before
/// WhatsApp opens on it.
struct HisaabLedgerScreen: View {
    /// "/hisaab/<id>?type=customer|karigar".
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var adding: HisaabEntryMode?
    @State private var deletion: OwnerDeletion?
    @State private var note: Note?
    @State private var statement: InvoicePDFTarget?
    @State private var reminder: HisaabReminder?
    @State private var reminderPhone = ""
    @State private var reminderBusy = false
    @State private var failure: String?
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
            NotAvailableState("Not found", why: "It may have been deleted.", symbol: "person.crop.circle.badge.questionmark")
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

    // MARK: The reminder

    private func fetchReminder(_ id: String, phone: String?) async throws -> HisaabReminder {
        let q = phone.map { (p: String) in "?phone=" + (p.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? p) } ?? ""
        return try await ERPAPI.shared.get("/api/app/hisaab/\(MoneyPaths.component(id))/reminder" + q, as: HisaabReminder.self)
    }

    private func askReminder(_ id: String, phone: String?) async {
        reminderBusy = true
        defer { reminderBusy = false }
        do {
            let r = try await fetchReminder(id, phone: phone)
            if r.message.isEmpty {
                Note.show(Note(title: "Nothing to remind", detail: "They don't owe the shop anything.", failed: true), in: $note, reduce: reduceMotion)
                return
            }
            reminderPhone = r.phone
            reminder = r
        } catch {
            Note.show(Note(title: "The reminder wasn't written", detail: error.localizedDescription, failed: true), in: $note, reduce: reduceMotion)
        }
    }

    private func reminderSheet(_ r: HisaabReminder, id: String) -> some View {
        NavigationStack {
            Form {
                Section {
                    TextField("WhatsApp number", text: $reminderPhone)
                        .keyboardType(.phonePad)
                        .fieldKind(.telephoneNumber)
                        .keyboardDone()
                } header: {
                    LedgerHeading(title: "To")
                } footer: {
                    if reminderPhone.isEmpty { Text("Their record has no number: type the one to send to.") }
                }
                Section {
                    Text(r.message).font(.callout).textSelection(.enabled)
                } header: {
                    LedgerHeading(title: "The message")
                }
            }
            .houseForm()
            .navigationTitle("Remind \(r.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { reminder = nil } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Open WhatsApp") {
                        Task {
                            // The number as typed goes back to the ERP, which makes the wa.me link as the web does.
                            reminderBusy = true
                            let fetched: HisaabReminder?
                            do {
                                fetched = try await fetchReminder(id, phone: reminderPhone)
                            } catch {
                                reminderBusy = false
                                failure = error.localizedDescription
                                return
                            }
                            reminderBusy = false
                            reminder = nil
                            if let r = fetched, !r.url.isEmpty, let url = URL(string: r.url) {
                                openURL(url)
                            } else {
                                Note.show(Note(title: "No usable number", detail: "Type a Pakistani mobile number or one with its country code.", failed: true), in: $note, reduce: reduceMotion)
                            }
                        }
                    }
                    .disabled(reminderPhone.trimmingCharacters(in: .whitespaces).isEmpty || reminderBusy)
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
    }

    // MARK: The ledger

    @ViewBuilder
    private func ledger(name: String, id: String, isCustomer: Bool, rows: [HisaabEntry], onFile: Bool) -> some View {
        let result = HisaabLedger.page(rows)
        ledgerPage(result, name: name, id: id, isCustomer: isCustomer, onFile: onFile)
        .navigationTitle(name.isEmpty ? "Hisaab" : name)
        .sheet(item: $reminder) { (r: HisaabReminder) in reminderSheet(r, id: id) }
        // The page's job is the two entries: pinned where they never scroll away, once (not also in a menu).
        #if !os(macOS)
        .modifier(EntryBar(show: onFile, gave: { adding = .gave }, got: { adding = .got }))
        #endif
        .toolbar {
            #if os(macOS)
            macLedgerToolbar(name: name, id: id, isCustomer: isCustomer, onFile: onFile)
            #else
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        statement = InvoicePDFTarget(path: MoneyPaths.ledgerPDF(id, isCustomer: isCustomer),
                                                     fileName: "Ledger-\(name)-\(MoneyCalendar.pickedDay(Date())).pdf",
                                                     title: "Ledger statement")
                    } label: {
                        Label("Print the ledger", systemImage: "printer")
                    }
                    if isCustomer && id != WALK_IN_ENTITY {
                        // A WhatsApp message of what they owe the shop, opened ready to send.
                        Button { Task { await askReminder(id, phone: nil) } } label: {
                            Label("Send a reminder", systemImage: "message")
                        }
                        .disabled(reminderBusy)
                    }
                } label: {
                    if reminderBusy { ProgressView() } else { Label("More", systemImage: "ellipsis.circle") }
                }
            }
            #endif
        }
        .failureAlert($failure, title: "Not done")
        .destructiveFeedback(trigger: deletion != nil)
        .sheet(item: $adding) { (mode: HisaabEntryMode) in
            HisaabEntrySheet(mode: mode, personId: id, personName: name, isCustomer: isCustomer) { (saved: Note) in
                Note.show(saved, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(Note(title: "Transaction deleted"), in: $note, reduce: reduceMotion)
            }
            .presentationSizing(.form)
        }
        .navigationDestination(item: $statement) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .noteToast($note)
    }

    @ViewBuilder
    private func ledgerPage(_ result: HisaabLedgerPage, name: String, id: String, isCustomer: Bool, onFile: Bool) -> some View {
        #if os(macOS)
        macLedger(result, name: name, id: id, isCustomer: isCustomer, onFile: onFile)
        #else
        // Wide: the figures stand left, the rows of the ledger right.
        WideDetailList(leftWidth: 360) {
            Section {
                tiles(result)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                LedgerHeading(title: isCustomer ? "Customer ledger" : "Karigar ledger")
            }
            .houseRows()
        } right: {
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
                            .contextMenu {
                                if onFile {
                                    Button(role: .destructive) { askToDelete(line.entry) } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                    }
                }
            } header: {
                LedgerHeading(title: "Transactions", count: result.lines.count)
            }
            .houseRows()
        }
        #endif
    }

    private struct EntryBar: ViewModifier {
        let show: Bool
        let gave: () -> Void
        let got: () -> Void
        func body(content: Content) -> some View {
            if show {
                content.actionBar(primary: ActionBar.Action("You gave", systemImage: "arrow.up", action: gave),
                                  secondary: [ActionBar.Action("You got", systemImage: "arrow.down", action: got)])
            } else {
                content
            }
        }
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
        return FigureRow(alignment: .top, spacing: pt(10)) {
            FigureTile(label: "You will get", value: Money.pkr(max(0, r.cash)), detail: getGold, tint: Tone.owed.color)
            FigureTile(label: "You will give", value: Money.pkr(abs(min(0, r.cash))), detail: giveGold, tint: Tone.credit.color)
        }
        .padding(.vertical, pt(4))
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

#if os(macOS)

// MARK: - The Mac ledger

/// One person's ledger as a Mac window: a document header (who, what they owe or are owed) and the ledger as one table filling
/// the window (MacHisaabLedgerView). "You Gave" and "You Got", the reminder and the PDF are the Hisaab menu's and the toolbar's;
/// a row's right-click menu opens its invoice or deletes it (the delete code is asked, as ever).
extension HisaabLedgerScreen {
    private func macLedger(_ r: HisaabLedgerPage, name: String, id: String, isCustomer: Bool, onFile: Bool) -> some View {
        MacHisaabLedgerView(
            page: r, name: name, isCustomer: isCustomer, onFile: onFile,
            base: macBase(name: name, id: id, isCustomer: isCustomer, onFile: onFile),
            deleteEntry: { (e: HisaabEntry) in askToDelete(e) })
    }

    /// The actions that do not depend on a picked row, declared once for the toolbar and the menu bar.
    private func macBase(name: String, id: String, isCustomer: Bool, onFile: Bool) -> [[MacAction]] {
        let gave = MacAction("You Gave\u{2026}", symbol: "arrow.up", shortcut: KeyboardShortcut("g", modifiers: [.shift, .command]),
                             enabled: onFile, id: "gave") { adding = .gave }
        let got = MacAction("You Got\u{2026}", symbol: "arrow.down", shortcut: KeyboardShortcut("r", modifiers: [.shift, .command]),
                            enabled: onFile, id: "got") { adding = .got }
        var more: [MacAction] = []
        if isCustomer && id != WALK_IN_ENTITY {
            // A WhatsApp message of what they owe the shop, opened ready to send.
            more.append(MacAction("Send a Reminder\u{2026}", symbol: "message", enabled: !reminderBusy, id: "remind") {
                Task { await askReminder(id, phone: nil) }
            })
        }
        more.append(MacAction("Print the Ledger\u{2026}", symbol: "printer", id: "print") {
            statement = InvoicePDFTarget(path: MoneyPaths.ledgerPDF(id, isCustomer: isCustomer),
                                         fileName: "Ledger-\(name)-\(MoneyCalendar.pickedDay(Date())).pdf",
                                         title: "Ledger statement")
        })
        return [[gave, got], more]
    }

    @ToolbarContentBuilder
    private func macLedgerToolbar(name: String, id: String, isCustomer: Bool, onFile: Bool) -> some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            ForEach(macBase(name: name, id: id, isCustomer: isCustomer, onFile: onFile).flatMap { (g: [MacAction]) in g }) { (a: MacAction) in
                MacToolbarAction(action: a)
            }
        }
    }
}
#endif

// MARK: One row

/// What was written, when, how much each way, and the balance after it. "You gave" is a debit (owed),
/// "You got" a credit (settled): the web's words in the kit's tones; a positive balance is owed to the shop.
private struct HisaabLedgerRow: View {
    let line: HisaabLedgerLine
    let showGold: Bool

    var body: some View {
        HStack(alignment: .top, spacing: pt(12)) {
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
            Text("You gave \(Money.pkr(e.cashDebit))").font(.subheadline.weight(.semibold)).foregroundStyle(Tone.owed.color)
        }
        if e.cashCredit > 0 {
            Text("You got \(Money.pkr(e.cashCredit))").font(.subheadline.weight(.semibold)).foregroundStyle(Tone.settled.color)
        }
        // One coloured figure per row: the metal's movement is quiet when the cash already moved.
        let cashMoved = e.cashDebit > 0 || e.cashCredit > 0
        if e.goldDebitGrams > 0 {
            Text("You gave \(MoneyFormat.grams(e.goldDebitGrams))").font(.caption)
                .foregroundStyle(cashMoved ? Color.secondary : Tone.owed.color)
        }
        if e.goldCreditGrams > 0 {
            Text("You got \(MoneyFormat.grams(e.goldCreditGrams))").font(.caption)
                .foregroundStyle(cashMoved ? Color.secondary : Tone.settled.color)
        }
    }

    @ViewBuilder
    private var balances: some View {
        // The running balance is a quiet note, not a second coloured figure.
        Text("Balance \(Money.pkr(line.cash))")
            .font(.caption)
            .foregroundStyle(.secondary)
        if showGold {
            Text("\(MoneyFormat.grams(line.gold)) \(MoneyWords.metal)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// /api/app/hisaab/[id]/reminder: the web's reminder words for what a customer owes, and the wa.me link for the number.
struct HisaabReminder: Decodable, Identifiable {
    let due: Double
    let name: String
    let phone: String
    let message: String
    let url: String
    var id: String { name + phone + url }

    private enum K: String, CodingKey { case due, name, phone, message, url }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        due = c.double(.due, default: 0)
        name = c.string(.name, default: "")
        phone = c.string(.phone, default: "")
        message = c.string(.message, default: "")
        url = c.string(.url, default: "")
    }
}
