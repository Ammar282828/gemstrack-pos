import SwiftUI
import ERPCore

/// A karigar (src/app/karigars/[id]/page.tsx): opens on Now, what he holds of ours and what we owe him
/// (docs/decisions.md "One screen per question", lib/karigar-position.ts): his bench, the pieces' estimated weight
/// beside the gold khata (two measures, never summed), what has been handed to him and not come back, and the
/// hisaab cash. The hisaab, the khata and what has been paid are the owner's: the staff's copy of the books comes
/// without them. An owner also pays him here, as on the web: a payment into his open pay batch (an expense), silver
/// received with its surcharge, starting and settling a pay batch, the settled batches and the payments outside any,
/// deleting a settled batch or a silver entry (the delete code). Every figure is ERPCore KarigarPay's
/// (lib/karigar-pay.ts), the one the ERP writes when a batch is settled. Assigning him stock work is the Workshop's
/// sheet. Removing him stays the ERP's page (see `erpSection`).
struct WorkshopKarigarScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var silverBook = WorkshopSilverBook()
    @State private var ask: WorkshopPayAsk?
    @State private var deletion: OwnerDeletion?
    @Environment(\.dismiss) private var dismissKarigar
    @State private var note: OwnerNote?
    /// The settled batches and the direct payments opened to show their payments.
    @State private var expanded: Set<String> = []

    var body: some View {
        content
            .navigationTitle(book.karigars.item(id)?.name ?? "Karigar")
            .navigationBarTitleDisplayMode(.large)
            .sheet(item: $ask) { (a: WorkshopPayAsk) in
                paySheet(a)
            }
            .sheet(item: $deletion) { (d: OwnerDeletion) in
                OwnerDeleteCodeSheet(deletion: d) {
                    if d.what.hasPrefix("Delete karigar ") {
                        // He is off every list now; Recently removed has him.
                        dismissKarigar()
                    } else {
                        withAnimation { note = OwnerNote(title: d.what == "Delete this silver entry" ? "Silver entry deleted" : "Batch deleted") }
                    }
                }
            }
            .ownerNote($note)
            .onDisappear { silverBook.stop() }
            .onAppear {
                book.karigars.need()
                book.orders.need()
                book.invoices.need()
                book.karigarJobs.need()
                book.givenItems.need()
                if session.isOwner {
                    book.hisaab.need()
                    book.expenses.need()
                    book.karigarBatches.need()
                    silverBook.need()
                }
            }
    }

    @ViewBuilder
    private func paySheet(_ a: WorkshopPayAsk) -> some View {
        let saved: (OwnerNote) -> Void = { n in withAnimation { note = n } }
        if let karigar = book.karigars.item(id) {
            switch a {
            case .pay(let batch):
                WorkshopPaySheet(
                    karigar: karigar, batch: batch,
                    categories: ExpenseFigures.formCategories(shop: session.shop.expenseCategories, expenses: book.expenses.items),
                    partnership: session.shop.partnership, onSaved: saved
                )
            case .silver:
                WorkshopSilverSheet(karigar: karigar, onSaved: saved)
            case .start:
                WorkshopBatchStartSheet(karigar: karigar, onSaved: saved)
            case .settle(let open):
                WorkshopSettleSheet(open: open, onSaved: saved)
            case .assign:
                WorkshopStockJobSheet(karigars: workshopLive(book.karigars.items), presetKarigarId: karigar.id, onSaved: saved)
            }
        }
    }

    private var loaded: Bool {
        let books = book.karigars.loaded && book.orders.loaded && book.invoices.loaded && book.karigarJobs.loaded && book.givenItems.loaded
        if !session.isOwner { return books }
        // His silver is not waited on: its section and its line under Now appear once it has been read.
        return books && book.hisaab.loaded && book.expenses.loaded && book.karigarBatches.loaded
    }

    private var firstError: String? {
        book.karigars.error ?? book.orders.error ?? book.invoices.error ?? book.karigarJobs.error ?? book.givenItems.error
    }

    @ViewBuilder
    private var content: some View {
        ShelfState(loaded: loaded, error: firstError, offline: book.karigars.offline) {
            if let karigar = book.karigars.item(id), (karigar.deletedAt ?? "").isEmpty {
                page(karigar)
            } else {
                ContentUnavailableView(
                    "Karigar not found",
                    systemImage: "person.crop.circle.badge.questionmark",
                    description: Text("They may have been removed. Settings, Recently removed puts them back.")
                )
            }
        }
    }

    // MARK: The page

    private func page(_ karigar: Karigar) -> some View {
        let live = workshopLive(book.karigars.items)
        let jobs = WorkshopLogic.buildJobs(
            orders: book.orders.items,
            karigarJobs: book.karigarJobs.items,
            karigars: live,
            invoices: book.invoices.items
        )
        let position = WorkshopPosition(
            karigarId: karigar.id,
            karigarName: karigar.name,
            jobs: jobs,
            givenItems: book.givenItems.items,
            hisaab: session.isOwner ? book.hisaab.items : []
        )
        let load = WorkshopLogic.groupByKarigar(jobs.filter { $0.karigarId == karigar.id }).first
        // His pay (owners: the batches and the expenses are the owner's books).
        let pay = session.isOwner
            ? KarigarPay.figures(karigarId: karigar.id, expenses: book.expenses.items, batches: book.karigarBatches.items)
            : nil
        let silver = session.isOwner ? KarigarPay.silver(karigarId: karigar.id, rows: silverBook.silver.items) : nil
        return List { Group {
            profileSection(karigar, pay: pay)
            nowSection(karigar, position, open: pay?.open, silver: silver)
            if !position.bench.isEmpty { benchSection(karigar, position) }
            if !position.given.isEmpty { givenSection(karigar, position) }
            stockJobsSection(karigar)
            if session.isOwner { hisaabSection(karigar, position) }
            if let pay { payBatchSection(karigar, pay) }
            if let silver, !silver.rows.isEmpty { silverSection(karigar, silver) }
            if let pay, !pay.settled.isEmpty { settledSection(pay) }
            if let pay, !pay.direct.isEmpty { directSection(pay) }
            if session.isOwner { erpSection(karigar) }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .toolbar {
            if let load, load.active > 0 {
                ToolbarItem(placement: .primaryAction) {
                    // The web copies the list and opens WhatsApp to the karigar; the phone's share sheet does both.
                    ShareLink(item: WorkshopLogic.shareText(load, shopName: session.shop.name)) {
                        Label("Send list", systemImage: "square.and.arrow.up")
                    }
                }
            }
        }
    }

    // MARK: Who he is

    private func profileSection(_ karigar: Karigar, pay: KarigarPay.Figures?) -> some View {
        Section {
            if let contact = karigar.contact, !contact.isEmpty {
                if let url = URL(string: "tel:" + WorkshopLogic.dialable(contact)) {
                    Link(destination: url) {
                        Label(contact, systemImage: "phone")
                    }
                } else {
                    Label(contact, systemImage: "phone")
                }
            }
            if let specialty = karigar.specialty, !specialty.isEmpty {
                Label(specialty, systemImage: "hammer").foregroundStyle(.secondary)
            }
            if let notes = karigar.notes, !notes.isEmpty {
                Label(notes, systemImage: "note.text").foregroundStyle(.secondary)
            }
            if let pay {
                LabeledContent("Total paid (all time)") {
                    Text(Money.pkr(pay.totalPaid)).monospacedDigit().foregroundStyle(Color.red)
                }
                LabeledContent("Active pay batch") {
                    if let open = pay.open, !open.batch.label.isEmpty {
                        Text(open.batch.label)
                    } else {
                        Text("None").foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: Now

    private func nowSection(_ karigar: Karigar, _ p: WorkshopPosition, open: KarigarPay.InBatch?, silver: KarigarPay.Silver?) -> some View {
        let cash = p.cashBalance.rounded()
        return Section {
            NavigationLink(value: Route(path: "/workshop?karigar=" + WorkshopLogic.piece(karigar.id))) {
                TwoLine(
                    title: "On his bench",
                    subtitle: p.bench.isEmpty ? "nothing open" : "oldest \(p.bench[0].ageDays) d",
                    trailing: WorkshopLogic.pieces(p.bench.count)
                )
            }
            TwoLine(
                title: "Pieces weigh (est.)",
                subtitle: weighHint(p),
                trailing: p.metals.isEmpty ? "—" : p.metals.map { WorkshopLogic.grams3($0.grams) }.joined(separator: " · ")
            )
            if session.isOwner {
                NavigationLink(value: Route(path: hisaabPath(karigar))) {
                    TwoLine(
                        title: "Gold khata",
                        subtitle: "given less received, in Hisaab",
                        trailing: WorkshopLogic.grams3(p.khataNet),
                        trailingTint: p.khataNet > 0.0005 ? Color.red : Color.primary
                    )
                }
                NavigationLink(value: Route(path: hisaabPath(karigar))) {
                    TwoLine(
                        title: cash > 0 ? "He holds of ours" : (cash < 0 ? "We owe him" : "Cash"),
                        subtitle: cashHint(open),
                        trailing: cash == 0 ? "Square" : Money.pkr(abs(cash)),
                        trailingTint: cash < 0 ? Color.red : Color.primary
                    )
                }
            }
        } header: {
            LedgerHeading(title: "Now")
        } footer: {
            Text(nowFootnote(silver))
        }
    }

    /// "March 2026: PKR 40,000 paid" while a pay batch is open, else just where the figure comes from.
    private func cashHint(_ open: KarigarPay.InBatch?) -> String {
        guard let open, !open.batch.label.isEmpty else { return "Hisaab cash" }
        return "\(open.batch.label): \(Money.pkr(open.total)) paid"
    }

    private func weighHint(_ p: WorkshopPosition) -> String {
        if p.metals.isEmpty {
            return p.unweighed > 0 ? "\(p.unweighed) unweighed" : "the weights on the jobs"
        }
        var s = p.metals.map { $0.label }.joined(separator: ", ")
        if p.unweighed > 0 { s += " · \(p.unweighed) unweighed" }
        return s
    }

    private func nowFootnote(_ silver: KarigarPay.Silver?) -> String {
        var s = "The pieces' weight is what the jobs say they will weigh"
        if session.isOwner {
            s += "; the gold khata is what was handed over and brought back. Two measures, never added."
        } else {
            s += "."
        }
        if let silver, !silver.rows.isEmpty {
            s += " Silver received: \(WorkshopLogic.grams3(silver.grams)) \u{00B7} \(Money.pkr(silver.surcharge)) surcharge."
        }
        return s
    }

    private func hisaabPath(_ karigar: Karigar) -> String {
        "/hisaab/" + WorkshopLogic.piece(karigar.id) + "?type=karigar"
    }

    // MARK: The bench

    private func benchSection(_ karigar: Karigar, _ p: WorkshopPosition) -> some View {
        Section {
            ForEach(p.bench.prefix(12)) { j in
                NavigationLink(value: Route(path: benchPath(j, karigar))) {
                    benchRow(j)
                }
            }
            if p.bench.count > 12 {
                NavigationLink(value: Route(path: "/workshop?karigar=" + WorkshopLogic.piece(karigar.id))) {
                    Text("All \(p.bench.count) in Workshop").foregroundStyle(Color.accentColor)
                }
            }
        } header: {
            LedgerHeading(title: "On the bench")
        }
    }

    private func benchRow(_ j: WorkshopJob) -> some View {
        var sub: [String] = []
        if let c = j.customerName, !c.isEmpty, j.source != .manual { sub.append(c) }
        if let w = j.weightG, w > 0 { sub.append(WorkshopLogic.grams3(w)) }
        return TwoLine(
            title: j.description,
            subtitle: sub.joined(separator: " · "),
            trailing: "\(j.ageDays) d",
            trailingTint: ageTint(j)
        )
    }

    private func ageTint(_ j: WorkshopJob) -> Color {
        switch j.urgency {
        case .critical: return .red
        case .warning: return .orange
        case .ok: return .primary
        }
    }

    /// The order's page, or the invoice's; a stock job opens his whole bench.
    private func benchPath(_ j: WorkshopJob, _ karigar: Karigar) -> String {
        if let o = j.orderId { return "/orders/" + WorkshopLogic.piece(o) }
        if let i = j.invoiceId { return "/invoices/" + WorkshopLogic.piece(i) }
        return "/workshop?karigar=" + WorkshopLogic.piece(karigar.id)
    }

    // MARK: Handed to him

    private func givenSection(_ karigar: Karigar, _ p: WorkshopPosition) -> some View {
        Section {
            ForEach(p.given) { it in
                NavigationLink(value: Route(path: "/given")) {
                    TwoLine(title: it.description, subtitle: nil, trailing: it.date.isEmpty ? nil : ShopDate.say(it.date))
                }
            }
        } header: {
            LedgerHeading(title: "Handed to him, not back")
        }
    }

    // MARK: His stock jobs

    /// The jobs written up for him that no customer order stands behind: stock pieces, repairs, samples.
    @ViewBuilder
    private func stockJobsSection(_ karigar: Karigar) -> some View {
        let mine = book.karigarJobs.items.filter { $0.karigarId == karigar.id }
        if !mine.isEmpty || session.isOwner {
            Section {
                ForEach(mine.prefix(20)) { j in
                    stockJobRow(j)
                }
                if session.isOwner {
                    // The Workshop's Assign Stock Work, with him chosen (the web's "Assign" on his card).
                    Button { ask = .assign } label: {
                        Label("Assign stock work", systemImage: "plus.circle")
                    }
                }
            } header: {
                LedgerHeading(title: "His jobs")
            } footer: {
                if mine.count > 20 {
                    Text("The latest 20 of \(mine.count). The rest are on the ERP's page.")
                }
            }
        }
    }

    private func stockJobRow(_ j: KarigarJob) -> some View {
        var sub: [String] = []
        if let w = j.weightG, w > 0 { sub.append(WorkshopLogic.grams(w)) }
        if j.assignedDate.isEmpty == false { sub.append("written up " + ShopDate.say(j.assignedDate)) }
        return TwoLine(
            title: j.description,
            subtitle: sub.joined(separator: " · "),
            trailing: statusWords(j.status),
            trailingTint: j.status == .completed ? Color.green : Color.primary
        )
    }

    private func statusWords(_ s: KarigarJobStatus) -> String {
        switch s {
        case .pending: return "Pending"
        case .inProgress: return "In Progress"
        case .completed: return "Completed"
        case .unknown(let raw): return raw
        }
    }

    // MARK: Hisaab (owners only)

    /// The gold khata (Gold Khata on the web): gold handed to him, pieces received back, what is still with him,
    /// and its rows with the cash beside them.
    @ViewBuilder
    private func hisaabSection(_ karigar: Karigar, _ p: WorkshopPosition) -> some View {
        let rows = book.hisaab.items.filter { $0.entityType == .karigar && $0.entityId == karigar.id }
        if !rows.isEmpty {
            Section {
                khataTiles(p)
                ForEach(rows.prefix(8)) { e in
                    hisaabRow(e)
                }
                NavigationLink(value: Route(path: hisaabPath(karigar))) {
                    Text(rows.count > 8 ? "All \(rows.count) entries in Hisaab" : "Open in Hisaab")
                        .foregroundStyle(Color.accentColor)
                }
            } header: {
                LedgerHeading(title: "Hisaab")
            } footer: {
                Text("\(rows.count) entries · net = gold still with the karigar")
            }
        }
    }

    private func khataTiles(_ p: WorkshopPosition) -> some View {
        let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        let net = p.khataNet
        let netTint: Color = net > 0.0005 ? Color.red : (net < -0.0005 ? Color.green : Color.primary)
        return LazyVGrid(columns: columns, spacing: 10) {
            FigureTile(label: "Given", value: WorkshopLogic.grams3(p.khataGiven))
            FigureTile(label: "Received", value: WorkshopLogic.grams3(p.khataBack))
            FigureTile(label: "Net (out)", value: WorkshopLogic.grams3(net), tint: netTint)
        }
        .padding(.vertical, 4)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
    }

    private func hisaabRow(_ e: HisaabEntry) -> some View {
        TwoLine(
            title: e.description.isEmpty ? "Entry" : e.description,
            subtitle: ShopDate.say(e.date),
            trailing: hisaabAmount(e),
            trailingTint: hisaabTint(e)
        )
    }

    /// "↑ 12.500g" gold given, "↓ 3.000g" received, else the cash.
    private func hisaabAmount(_ e: HisaabEntry) -> String {
        if e.goldDebitGrams > 0 { return "↑ " + WorkshopLogic.grams3(e.goldDebitGrams) }
        if e.goldCreditGrams > 0 { return "↓ " + WorkshopLogic.grams3(e.goldCreditGrams) }
        if e.cashDebit > 0 { return Money.pkr(e.cashDebit) }
        if e.cashCredit > 0 { return "− " + Money.pkr(e.cashCredit) }
        return "—"
    }

    private func hisaabTint(_ e: HisaabEntry) -> Color {
        if e.goldDebitGrams > 0 { return .red }
        if e.goldCreditGrams > 0 { return .green }
        return .primary
    }

    // MARK: Pay batch (owners only)

    /// The open pay batch and what is in it, with Add payment, Silver and Settle; or, with none open, the way to
    /// start one (the web's "No active pay batch" card). A payment from here always goes into the open batch.
    @ViewBuilder
    private func payBatchSection(_ karigar: Karigar, _ pay: KarigarPay.Figures) -> some View {
        if let open = pay.open {
            Section {
                LabeledContent("Pay batch total") {
                    Text(PaymentText.pkr(open.total)).monospacedDigit().fontWeight(.semibold).foregroundStyle(Color.red)
                }
                if open.payments.isEmpty {
                    Text("No payments recorded. Select \u{201C}Add payment\u{201D} to record one.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach(open.payments) { e in paymentRow(e) }
                Button { ask = .pay(open.batch) } label: {
                    Label("Add payment", systemImage: "plus.circle")
                }
                Button { ask = .silver } label: {
                    Label("Silver", systemImage: "scalemass")
                }
                Button { ask = .settle(open) } label: {
                    Label("Settle", systemImage: "checkmark.seal")
                }
                .tint(.green)
            } header: {
                HStack(spacing: 6) {
                    Image(systemName: "lock.open")
                    Text(open.batch.label.isEmpty ? "Pay batch" : open.batch.label)
                    StatusBadge("Active", color: .green)
                }
                .textCase(nil)
            } footer: {
                Text(startedWords(open))
            }
        } else {
            Section {
                VStack(alignment: .leading, spacing: 2) {
                    Text("No active pay batch").font(.headline)
                    Text("Start a new hisaab to track payments in batches.").font(.subheadline).foregroundStyle(.secondary)
                }
                Button { ask = .start } label: {
                    Label("Start a pay batch", systemImage: "plus.circle")
                }
            } header: {
                LedgerHeading(title: "Pay batch")
            }
        }
    }

    /// "Started 1 Oct 2026 · 2 payments".
    private func startedWords(_ b: KarigarPay.InBatch) -> String {
        let n = b.payments.count
        let started = OwnerText.shortDate(b.batch.startDate)
        let count = "\(n) payment\(n == 1 ? "" : "s")"
        return started.isEmpty ? count : "Started \(started) \u{00B7} \(count)"
    }

    /// One payment: what it was for, when and under which category, and how much.
    private func paymentRow(_ e: Expense) -> some View {
        TwoLine(
            title: e.description.isEmpty ? (e.category.isEmpty ? "Payment" : e.category) : e.description,
            subtitle: [ShopDate.say(e.date), e.category].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
            trailing: PaymentText.pkr(e.amount)
        )
    }

    // MARK: Silver (owners only)

    private func silverSection(_ karigar: Karigar, _ silver: KarigarPay.Silver) -> some View {
        Section {
            ForEach(silver.rows) { t in
                silverRow(t)
                    .swipeActions {
                        Button(role: .destructive) { askDeleteSilver(t) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button(role: .destructive) { askDeleteSilver(t) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
            Button { ask = .silver } label: {
                Label("Silver", systemImage: "plus")
            }
        } header: {
            LedgerHeading(title: "Silver transactions")
        } footer: {
            Text("\(WorkshopLogic.grams3(silver.grams)) received \u{00B7} \(PaymentText.pkr(silver.surcharge)) surcharge")
        }
    }

    private func silverRow(_ t: KarigarSilverTransaction) -> some View {
        TwoLine(
            title: (t.description ?? "").isEmpty ? "\u{2014}" : (t.description ?? ""),
            subtitle: [ShopDate.say(t.date), "\(WorkshopLogic.grams3(t.silverGrams)) at \(PaymentText.pkr(t.surchargePerGram))/g"]
                .filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
            trailing: PaymentText.pkr(t.totalSurcharge)
        )
    }

    /// The web's "Delete this silver transaction?": the record goes for good, nothing else with it.
    private func askDeleteSilver(_ t: KarigarSilverTransaction) {
        let when = ShopDate.say(t.date)
        deletion = OwnerDeletion(
            what: "Delete this silver entry",
            detail: "\(WorkshopLogic.grams3(t.silverGrams)) received\(when.isEmpty ? "" : " " + when), \(PaymentText.pkr(t.totalSurcharge)) surcharge: the record is removed permanently."
        ) { code in
            _ = try await ERPAPI.shared.write("deleteSilverEntry", ["id": t.id, "deleteCode": code])
        }
    }

    // MARK: Settled pay batches and direct payments (owners only)

    private func settledSection(_ pay: KarigarPay.Figures) -> some View {
        Section {
            ForEach(pay.settled) { s in
                DisclosureGroup(isExpanded: expandedBinding(s.batch.id)) {
                    if s.payments.isEmpty {
                        Text("No payments in this batch.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(s.payments) { e in paymentRow(e) }
                    Button(role: .destructive) { askDeleteBatch(s) } label: {
                        Label("Delete batch", systemImage: "trash")
                    }
                } label: {
                    TwoLine(title: s.batch.label, subtitle: settledWords(s), trailing: PaymentText.pkr(s.total))
                }
            }
        } header: {
            LedgerHeading(title: "Settled pay batches")
        }
    }

    /// "1 Sep 2026 → 30 Sep 2026 · 3 payments".
    private func settledWords(_ s: KarigarPay.InBatch) -> String {
        let from = OwnerText.shortDate(s.batch.startDate)
        let to = OwnerText.shortDate(s.batch.closedDate ?? "")
        let span = to.isEmpty ? from : "\(from) \u{2192} \(to)"
        let n = s.payments.count
        let count = "\(n) payment\(n == 1 ? "" : "s")"
        return span.isEmpty ? count : "\(span) \u{00B7} \(count)"
    }

    /// The web's "Delete Batch": the batch's record goes, and its payments stay in Expenses, unassigned: they
    /// are listed with his direct payments and still count in his total paid (deletePayBatch).
    private func askDeleteBatch(_ s: KarigarPay.InBatch) {
        let n = s.payments.count
        let kept = n == 0
            ? "It has no payments."
            : "Its \(n) payment\(n == 1 ? "" : "s") (\(PaymentText.pkr(s.total))) stay in Expenses and in his total paid, listed with his direct payments."
        deletion = OwnerDeletion(
            what: "Delete this karigar batch",
            detail: "\u{201C}\(s.batch.label)\u{201D} is deleted. \(kept)"
        ) { code in
            _ = try await ERPAPI.shared.write("deletePayBatch", ["batchId": s.batch.id, "deleteCode": code])
        }
    }

    /// Payments made outside any pay batch, folded into one row as the web's card is.
    private func directSection(_ pay: KarigarPay.Figures) -> some View {
        let n = pay.direct.count
        return Section {
            DisclosureGroup(isExpanded: expandedBinding("direct")) {
                ForEach(pay.direct) { e in paymentRow(e) }
            } label: {
                TwoLine(title: "Direct payments", subtitle: "Not part of any hisaab \u{00B7} \(n) payment\(n == 1 ? "" : "s")", trailing: PaymentText.pkr(pay.directTotal))
            }
        } header: {
            LedgerHeading(title: "Direct payments")
        }
    }

    private func expandedBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(key) },
            set: { on in if on { expanded.insert(key) } else { expanded.remove(key) } }
        )
    }

    // MARK: Edit, their view, and what stays on the web

    /// Edit is the karigar form. Removing him (`removeKarigar`, the delete code, the store's words) only hides
    /// him: his jobs, given items and hisaab stay, and Settings, Recently removed puts him back.
    private func erpSection(_ karigar: Karigar) -> some View {
        Section {
            NavigationLink(value: Route(path: "/karigars/" + WorkshopLogic.piece(karigar.id) + "/edit")) {
                Label("Edit karigar", systemImage: "pencil")
            }
            NavigationLink(value: Route(path: "/my-work?preview=" + WorkshopLogic.piece(karigar.id))) {
                Label("Their view", systemImage: "eye")
            }
            if session.isOwner {
                Button(role: .destructive) { askRemove(karigar) } label: {
                    Label("Remove karigar", systemImage: "person.crop.circle.badge.minus")
                }
            }
        } header: {
            LedgerHeading(title: "Karigar")
        }
    }

    private func askRemove(_ karigar: Karigar) {
        let name = karigar.name.isEmpty ? karigar.id : karigar.name
        deletion = OwnerDeletion(
            what: "Delete karigar \(name)",
            detail: "\(name) will be hidden from the lists. His jobs, given items and hisaab stay where they are. Settings, then Recently removed, puts him back.",
            final: false
        ) { code in
            _ = try await ERPAPI.shared.write("removeKarigar", ["karigarId": karigar.id, "deleteCode": code])
        }
    }
}
