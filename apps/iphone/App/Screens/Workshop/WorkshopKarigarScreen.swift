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
/// sheet. Editing him, his own view and removing him (the delete code) are the last section (`erpSection`).
struct WorkshopKarigarScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var silverBook = WorkshopSilverBook()
    @State private var ask: WorkshopPayAsk?
    @State private var deletion: OwnerDeletion?
    @Environment(\.dismiss) private var dismissKarigar
    @State private var note: Note?
    @State private var confirmingRemove = false
    /// The settled batches and the direct payments opened to show their payments.
    @State private var expanded: Set<String> = []
    @State private var showingAccounts = false
    @State private var width: CGFloat = 0
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    #if os(macOS)
    /// The rows picked in his Work table and in his Payments table.
    @State private var macWorkPick = Set<String>()
    @State private var macPayPick = Set<String>()
    @State private var macWorkSort = [KeyPathComparator(\MacKarigarWorkRow.ageDays, order: .reverse)]
    @State private var macPaySort = [KeyPathComparator(\MacKarigarPayRow.date, order: .reverse)]
    /// What his page comes to, worked out once per change of the books and the sorts.
    @State private var macPageMemo = Memo<MacKarigarPageData>()
    /// The two tables in their sorted order: a sort sorts these, it never works his page out again.
    @State private var macWorkSorted = Memo<[MacKarigarWorkRow]>()
    @State private var macPaySorted = Memo<[MacKarigarPayRow]>()
    @State private var macOpened: Route?
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    var body: some View {
        content
            .navigationTitle(book.karigars.item(id)?.name ?? "Karigar")
            .hubTitleDisplay()
            .modifier(HouseGround())
            .zoomDestination(id: WorkshopLogic.karigarPath(id))
            .sheet(item: $ask) { (a: WorkshopPayAsk) in
                paySheet(a)
            }
            .sheet(item: $deletion) { (d: OwnerDeletion) in
                OwnerDeleteCodeSheet(deletion: d) {
                    if d.what.hasPrefix("Delete karigar ") {
                        // He is off every list now; Recently removed has him.
                        dismissKarigar()
                    } else {
                        Note.show(Note(title: d.what == "Delete this silver entry" ? "Silver entry deleted" : "Batch deleted"), in: $note, reduce: reduceMotion)
                    }
                }
            }
            .noteToast($note)
            .selectionFeedback(trigger: showingAccounts)
            // The warning tap as a delete is asked for (the delete code sheet opens).
            .sensoryFeedback(.warning, trigger: deletion != nil) { _, now in now }
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
        let saved: (Note) -> Void = { n in Note.show(n, in: $note, reduce: reduceMotion) }
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

    /// Owners' books too: a failed hisaab or pay-batch read must say so, not read as "Square" or "No active pay
    /// batch" (and invite a second batch).
    private var firstError: String? {
        let core = book.karigars.error ?? book.orders.error ?? book.invoices.error ?? book.karigarJobs.error ?? book.givenItems.error
        guard session.isOwner else { return core }
        return core ?? book.hisaab.error ?? book.expenses.error ?? book.karigarBatches.error
    }

    @ViewBuilder
    private var content: some View {
        ShelfState(loaded: loaded, error: firstError, offline: book.karigars.offline) {
            if let karigar = book.karigars.item(id), (karigar.deletedAt ?? "").isEmpty {
                page(karigar)
            } else {
                EmptyState("Karigar not found", symbol: "person.crop.circle.badge.questionmark",
                           message: "They may have been removed. Settings, Recently removed puts them back.")
            }
        }
    }

    // MARK: The page

    private func page(_ karigar: Karigar) -> some View {
        #if os(macOS)
        return macPage(karigar)
        #else
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
        @ViewBuilder func head() -> some View {
            if session.isOwner {
                Section {
                    Picker("Karigar view", selection: Binding(
                        get: { showingAccounts },
                        set: { on in Motion.run(reduce: reduceMotion) { showingAccounts = on } }
                    )) {
                        Text("Work").tag(false)
                        Text("Payments").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .chipRowInList()
                }
            }
            contactSection(karigar)
            nowSection(karigar, position, open: pay?.open, silver: silver)
        }
        @ViewBuilder func work() -> some View {
            if !showingAccounts || !session.isOwner {
                if !position.bench.isEmpty { benchSection(karigar, position) }
                if !position.given.isEmpty { givenSection(karigar, position) }
                stockJobsSection(karigar)
            } else {
                hisaabSection(karigar, position)
                if let pay { payBatchSection(karigar, pay) }
                if let silver, !silver.rows.isEmpty { silverSection(karigar, silver) }
                if let pay, !pay.settled.isEmpty { settledSection(pay) }
                if let pay, !pay.direct.isEmpty { directSection(pay) }
            }
        }
        @ViewBuilder func tail() -> some View {
            profileSection(karigar, pay: showingAccounts ? pay : nil)
            if session.isOwner { erpSection(karigar) }
            if session.isOwner { removeSection(karigar) }
        }
        return Group {
            if wide {
                // An iPad: who he is and where he stands on the left, his work or his payments beside it.
                HStack(alignment: .top, spacing: 0) {
                    List { Group { head(); tail() }.houseRows() }
                        .listStyle(.insetGrouped)
                        .frame(maxWidth: 440)
                    List { Group { work() }.houseRows() }
                        .listStyle(.insetGrouped)
                }
            } else {
                List { Group { head(); work(); tail() }.houseRows() }
                    .listStyle(.insetGrouped)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // Add payment never scrolls away from the Payments view while a batch is open.
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if showingAccounts, session.isOwner, let open = pay?.open {
                ActionBar(
                    primary: .init("Add payment", systemImage: "plus") { ask = .pay(open.batch) },
                    secondary: [.init("Silver", systemImage: "scalemass") { ask = .silver }],
                    summary: (open.batch.label.isEmpty ? "Pay batch" : open.batch.label) + ": " + Money.pkr(open.total) + " paid"
                )
            }
        }
        .confirmDestructive(
            isPresented: $confirmingRemove,
            title: "Remove \(karigar.name.isEmpty ? "this karigar" : karigar.name)?",
            message: "He is hidden from the lists. His jobs, given items and hisaab stay. Settings, then Recently removed, puts him back.",
            action: "Remove karigar"
        ) { askRemove(karigar) }
        .accessibilityIdentifier("workshop.karigar")
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
        #endif
    }

    // MARK: Who he is

    /// Call and WhatsApp first: the number is what is reached for most.
    @ViewBuilder
    private func contactSection(_ karigar: Karigar) -> some View {
        if let contact = karigar.contact, !contact.isEmpty {
            Section {
                ContactActions(phone: contact)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .listRowBackground(Color.clear)
            }
        }
    }

    private func profileSection(_ karigar: Karigar, pay: KarigarPay.Figures?) -> some View {
        Section {
            if let contact = karigar.contact, !contact.isEmpty {
                Label(contact, systemImage: "phone")
            }
            if let specialty = karigar.specialty, !specialty.isEmpty {
                Label(specialty, systemImage: "hammer").foregroundStyle(.secondary)
            }
            if let notes = karigar.notes, !notes.isEmpty {
                Label(notes, systemImage: "note.text").foregroundStyle(.secondary)
            }
            if let pay {
                MoneyRow("Total paid (all time)", pay.totalPaid)
                LabeledContent("Active pay batch") {
                    if let open = pay.open, !open.batch.label.isEmpty {
                        Text(open.batch.label)
                    } else {
                        Text("None").foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            LedgerHeading(title: "Details")
        }
    }

    // MARK: Now

    private func nowSection(_ karigar: Karigar, _ p: WorkshopPosition, open: KarigarPay.InBatch?, silver: KarigarPay.Silver?) -> some View {
        let cash = p.cashBalance.rounded()
        let footnote = nowFootnote(silver)
        return Section {
            if session.isOwner {
                cashHero(cash, open)
            }
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
                trailing: p.metals.isEmpty ? "\u{2014}" : p.metals.map { WorkshopLogic.grams3($0.grams) }.joined(separator: " \u{00B7} ")
            )
            if session.isOwner {
                NavigationLink(value: Route(path: hisaabPath(karigar))) {
                    TwoLine(
                        title: "Gold khata",
                        subtitle: "given less received, in Hisaab",
                        trailing: WorkshopLogic.grams3(p.khataNet),
                        trailingTint: p.khataNet > 0.0005 ? Tone.owed.color : Color.primary
                    )
                }
            }
        } header: {
            LedgerHeading(title: "Now")
        } footer: {
            if !footnote.isEmpty { Text(footnote) }
        }
    }

    /// What he holds of ours, or what we owe him: the page's one big figure.
    private func cashHero(_ cash: Double, _ open: KarigarPay.InBatch?) -> some View {
        VStack(alignment: .leading, spacing: pt(4)) {
            Text(cash > 0 ? "He holds of ours" : (cash < 0 ? "We owe him" : "Square"))
                .font(.subheadline).foregroundStyle(.secondary)
            HeroAmount(amount: abs(cash), tone: cash < 0 ? Tone.owed.color : Color.primary)
            Text(cashHint(open)).font(.footnote).foregroundStyle(.secondary)
        }
        .heroSheen()
        .accessibilityElement(children: .combine)
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        .listRowBackground(Color.clear)
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

    /// Only staff's silver line is said here; an owner reads silver in its own section (rule 15: not said twice).
    private func nowFootnote(_ silver: KarigarPay.Silver?) -> String {
        guard !session.isOwner, let silver, !silver.rows.isEmpty else { return "" }
        return "Silver received: \(WorkshopLogic.grams3(silver.grams)) \u{00B7} \(Money.pkr(silver.surcharge)) surcharge."
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
                    Text("All \(p.bench.count) in Workshop").foregroundStyle(Theme.accent)
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
        case .critical: return Tone.late.color
        case .warning: return Tone.owed.color
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
                ForEach(mine) { j in
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
            trailingTint: Color.primary
        )
    }

    private func statusWords(_ s: KarigarJobStatus) -> String {
        switch s {
        case .pending: return "Pending"
        case .inProgress: return "In progress"
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
                        .foregroundStyle(Theme.accent)
                }
            } header: {
                LedgerHeading(title: "Hisaab")
            }
        }
    }

    private func khataTiles(_ p: WorkshopPosition) -> some View {
        // The net is Now's Gold khata above: said once (rule 15).
        let columns = [GridItem(.flexible(), spacing: pt(10)), GridItem(.flexible(), spacing: pt(10))]
        return LazyVGrid(columns: columns, spacing: pt(10)) {
            FigureTile(label: "Given", value: WorkshopLogic.grams3(p.khataGiven))
            FigureTile(label: "Received", value: WorkshopLogic.grams3(p.khataBack))
        }
        .padding(.vertical, pt(4))
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
        // The arrows are for the eye; VoiceOver is told what they mean.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([e.description.isEmpty ? "Entry" : e.description, ShopDate.say(e.date), hisaabSpoken(e)]
            .filter { !$0.isEmpty }.joined(separator: ", "))
    }

    private func hisaabSpoken(_ e: HisaabEntry) -> String {
        if e.goldDebitGrams > 0 { return "gold given " + WorkshopLogic.grams3(e.goldDebitGrams) }
        if e.goldCreditGrams > 0 { return "gold received " + WorkshopLogic.grams3(e.goldCreditGrams) }
        if e.cashDebit > 0 { return Money.pkr(e.cashDebit) }
        if e.cashCredit > 0 { return "minus " + Money.pkr(e.cashCredit) }
        return ""
    }

    /// "↑ 12.500g" gold given, "↓ 3.000g" received, else the cash.
    private func hisaabAmount(_ e: HisaabEntry) -> String {
        if e.goldDebitGrams > 0 { return "↑ " + WorkshopLogic.grams3(e.goldDebitGrams) }
        if e.goldCreditGrams > 0 { return "↓ " + WorkshopLogic.grams3(e.goldCreditGrams) }
        if e.cashDebit > 0 { return Money.pkr(e.cashDebit) }
        if e.cashCredit > 0 { return Money.minus(e.cashCredit) }
        return "—"
    }

    private func hisaabTint(_ e: HisaabEntry) -> Color {
        if e.goldDebitGrams > 0 { return Tone.owed.color }
        if e.goldCreditGrams > 0 { return Tone.settled.color }
        return .primary
    }

    // MARK: Pay batch (owners only)

    /// The open pay batch and what is in it, with Add payment, Silver and Settle; or, with none open, the way to
    /// start one (the web's "No active pay batch" card). A payment from here always goes into the open batch.
    @ViewBuilder
    private func payBatchSection(_ karigar: Karigar, _ pay: KarigarPay.Figures) -> some View {
        if let open = pay.open {
            Section {
                MoneyRow("Pay batch total", open.total, emphasis: true)
                if open.payments.isEmpty {
                    Text("No payments recorded. Select \u{201C}Add payment\u{201D} to record one.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach(open.payments) { e in paymentRow(e) }
                // Add payment and Silver are the bar below; closing the batch is its own, last row.
                Button { ask = .settle(open) } label: {
                    Label("Settle", systemImage: "checkmark.seal")
                }
                .tint(Tone.settled.color)
            } header: {
                AdaptiveStack(spacing: pt(6), alignment: .center) {
                    Image(systemName: "lock.open").foregroundStyle(.secondary)
                    LedgerHeading(title: open.batch.label.isEmpty ? "Pay batch" : open.batch.label)
                }
            } footer: {
                Text(startedWords(open))
            }
        } else {
            Section {
                ContentUnavailableView {
                    Label("No active pay batch", systemImage: "book.closed")
                } actions: {
                    Button("Start a pay batch") { ask = .start }.buttonStyle(.bordered)
                }
                .listRowBackground(Color.clear)
            } header: {
                LedgerHeading(title: "Pay batch")
            }
        }
    }

    /// "Started 1 Oct 2026 · 2 payments".
    private func startedWords(_ b: KarigarPay.InBatch) -> String {
        let n = b.payments.count
        let started = ShopDate.say(b.batch.startDate)
        let count = "\(n) payment\(n == 1 ? "" : "s")"
        return started.isEmpty ? count : "Started \(started) \u{00B7} \(count)"
    }

    /// One payment: what it was for, when and under which category, and how much.
    private func paymentRow(_ e: Expense) -> some View {
        TwoLine(
            title: e.description.isEmpty ? (e.category.isEmpty ? "Payment" : e.category) : e.description,
            subtitle: [ShopDate.say(e.date), e.category].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
            trailing: Money.pkr(e.amount)
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
            Text("\(WorkshopLogic.grams3(silver.grams)) received \u{00B7} \(Money.pkr(silver.surcharge)) surcharge")
        }
    }

    private func silverRow(_ t: KarigarSilverTransaction) -> some View {
        TwoLine(
            title: (t.description ?? "").isEmpty ? "\u{2014}" : (t.description ?? ""),
            subtitle: [ShopDate.say(t.date), "\(WorkshopLogic.grams3(t.silverGrams)) at \(Money.pkr(t.surchargePerGram))/g"]
                .filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
            trailing: Money.pkr(t.totalSurcharge)
        )
    }

    /// The web's "Delete this silver transaction?": the record goes for good, nothing else with it.
    private func askDeleteSilver(_ t: KarigarSilverTransaction) {
        let when = ShopDate.say(t.date)
        deletion = OwnerDeletion(
            what: "Delete this silver entry",
            detail: "\(WorkshopLogic.grams3(t.silverGrams)) received\(when.isEmpty ? "" : " " + when), \(Money.pkr(t.totalSurcharge)) surcharge: the record is removed permanently."
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
                    TwoLine(title: s.batch.label, subtitle: settledWords(s), trailing: Money.pkr(s.total))
                }
            }
        } header: {
            LedgerHeading(title: "Settled pay batches")
        }
    }

    /// "1 Sep 2026 → 30 Sep 2026 · 3 payments".
    private func settledWords(_ s: KarigarPay.InBatch) -> String {
        let from = ShopDate.say(s.batch.startDate)
        let to = ShopDate.say(s.batch.closedDate ?? "")
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
            : "Its \(n) payment\(n == 1 ? "" : "s") (\(Money.pkr(s.total))) stay in Expenses and in his total paid, listed with his direct payments."
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
                TwoLine(title: "Direct payments", subtitle: "Not part of any hisaab \u{00B7} \(n) payment\(n == 1 ? "" : "s")", trailing: Money.pkr(pay.directTotal))
            }
        } header: {
            LedgerHeading(title: "Direct payments")
        }
    }

    private func expandedBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(key) },
            set: { on in
                Motion.run(reduce: reduceMotion) {
                    if on { expanded.insert(key) } else { expanded.remove(key) }
                }
            }
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
        } header: {
            LedgerHeading(title: "Karigar")
        }
    }

    /// Alone, last: it asks first, then the delete code.
    private func removeSection(_ karigar: Karigar) -> some View {
        Section {
            Button(role: .destructive) { confirmingRemove = true } label: {
                Label("Remove karigar", systemImage: "person.crop.circle.badge.minus")
            }
        } footer: {
            Text("He is hidden from the lists; his jobs, given items and hisaab stay.")
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

#if os(macOS)
/// One line of his Work table: a piece on his bench, something handed to him, a finished stock job.
private struct MacKarigarWorkRow: Identifiable {
    let id: String
    let kind: String
    let title: String
    let forWhom: String
    let order: String
    let weight: Double
    let ageDays: Int
    let status: String
    let urgency: WorkshopJob.Urgency
    /// Where a double-click goes.
    let path: String
}

/// One line of his Payments table: a payment in a pay batch or outside any, or a silver entry.
private struct MacKarigarPayRow: Identifiable {
    let id: String
    let date: String
    let what: String
    let group: String
    let category: String
    let amount: Double
    var silverId: String?
    /// The settled pay batch it is in (a right-click can delete the batch).
    var batchId: String?
}

/// His page, worked out once per change of the books and the sorts.
private struct MacKarigarPageData {
    var position: WorkshopPosition
    var load: WorkshopLoad?
    var pay: KarigarPay.Figures?
    var silver: KarigarPay.Silver?
    var work: [MacKarigarWorkRow] = []
    var payments: [MacKarigarPayRow] = []
}

// The Mac's karigar, a record window (docs/features/mac-design.md, "Workshop"): a document head (his name, and what he holds of ours
// or we owe him), one table filling the window for the segment chosen in the toolbar (Work: what is on his bench, what was handed to
// him, his finished jobs; Payments: every payment, in a pay batch or direct, and his silver), and his Now and details in a
// column at the right. His actions are declared once for the Karigar menu, the toolbar and the right-click menu. The writes are the
// page's own; the pay sheets state the amount on their button and ask nothing more.
extension WorkshopKarigarScreen {
    func macPage(_ karigar: Karigar) -> some View {
        let data = macPageData(karigar)
        return VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                MacWorkHead(
                    title: karigar.name,
                    subtitle: [karigar.contact ?? "", karigar.specialty ?? ""].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "),
                    pill: (data.load?.active ?? 0) > 0 ? WorkshopLogic.pieces(data.load?.active ?? 0) + " out" : "Free",
                    pillTone: (data.load?.critical ?? 0) > 0 ? .late : ((data.load?.active ?? 0) > 0 ? .working : .quiet),
                    figure: session.isOwner ? MacKarigarFigures.headline(cash: data.position.cashBalance) : nil
                ) {
                    Monogram(name: karigar.name, size: Monogram.Size.hero)
                }
                ContactActions(phone: karigar.contact)
                    .padding(.top, 6)
            }
            .padding([.horizontal, .top], 12)
            HStack(alignment: .top, spacing: 0) {
                Group {
                    if showingAccounts && session.isOwner { macPaymentsTable(data) } else { macWorkTable(karigar, data) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                MacWorkPage {
                    MacWorkCard("Now") { macNowRows(data) }
                    MacWorkCard("Details") { MacKarigarDetailRows(karigar: karigar) }
                }
                .frame(minWidth: 250, idealWidth: 300, maxWidth: 340)
            }
            .macSummaryBar(macSummary(data))
        }
        .background(Theme.ground)
        .navigationDestination(item: $macOpened) { (r: Route) in PlaceScreen(path: r.path) }
        .accessibilityIdentifier("workshop.karigar")
        .toolbar { macToolbar(karigar, data) }
        .macRecordMenu(MacRecordMenu(title: "Karigar", groups: macGroups(karigar, data)))
    }

    // MARK: His page, worked out once

    private func macPageData(_ karigar: Karigar) -> MacKarigarPageData {
        let owner = session.isOwner
        let key: [Int] = [book.orders.revision, book.invoices.revision, book.karigars.revision, book.karigarJobs.revision,
                   book.givenItems.revision, book.hisaab.revision, book.expenses.revision, book.karigarBatches.revision,
                   silverBook.silver.revision, owner ? 1 : 0, karigar.id.hashValue]
        let base = macPageMemo(key) {
            let live = workshopLive(book.karigars.items)
            let jobs = WorkshopLogic.buildJobs(
                orders: book.orders.items,
                karigarJobs: book.karigarJobs.items,
                karigars: live,
                invoices: book.invoices.items
            )
            let position = WorkshopPosition(
                karigarId: karigar.id, karigarName: karigar.name, jobs: jobs,
                givenItems: book.givenItems.items, hisaab: owner ? book.hisaab.items : []
            )
            let load = WorkshopLogic.groupByKarigar(jobs.filter { $0.karigarId == karigar.id }).first
            let pay = owner ? KarigarPay.figures(karigarId: karigar.id, expenses: book.expenses.items, batches: book.karigarBatches.items) : nil
            let silver = owner ? KarigarPay.silver(karigarId: karigar.id, rows: silverBook.silver.items) : nil
            var out = MacKarigarPageData(position: position, load: load, pay: pay, silver: silver)
            out.work = macWorkRows(karigar, position)
            out.payments = macPayRows(pay, silver)
            return out
        }
        var out = base
        out.work = macWorkSorted(key + [macWorkSort.hashValue]) { base.work.sorted(using: macWorkSort) }
        out.payments = macPaySorted(key + [macPaySort.hashValue]) { base.payments.sorted(using: macPaySort) }
        return out
    }

    private func macWorkRows(_ karigar: Karigar, _ p: WorkshopPosition) -> [MacKarigarWorkRow] {
        var out: [MacKarigarWorkRow] = []
        for j in p.bench {
            let stock = j.source == .manual
            out.append(MacKarigarWorkRow(
                id: "bench:" + j.id, kind: stock ? "Stock job" : "On the bench", title: j.description,
                forWhom: stock ? "Stock work" : (j.customerName ?? ""), order: j.orderId ?? j.invoiceId ?? "",
                weight: j.weightG ?? 0, ageDays: j.ageDays, status: j.hasGiven ? "Given " + ShopDate.say(j.givenAt) : "Not given yet",
                urgency: j.urgency, path: benchPath(j, karigar)
            ))
        }
        for g in p.given {
            out.append(MacKarigarWorkRow(
                id: "given:" + g.id, kind: "Handed to him", title: g.description, forWhom: "", order: "", weight: 0,
                ageDays: WorkshopLogic.daysSince(g.date), status: g.date.isEmpty ? "" : ShopDate.say(g.date),
                urgency: .ok, path: "/given"
            ))
        }
        for j in book.karigarJobs.items where j.karigarId == karigar.id && j.status == .completed {
            out.append(MacKarigarWorkRow(
                id: "done:" + j.id, kind: "Stock job", title: j.description, forWhom: "Stock work", order: "",
                weight: j.weightG ?? 0, ageDays: WorkshopLogic.daysSince(j.assignedDate), status: "Completed",
                urgency: .ok, path: "/workshop?karigar=" + WorkshopLogic.piece(karigar.id)
            ))
        }
        return out
    }

    private func macPayRows(_ pay: KarigarPay.Figures?, _ silver: KarigarPay.Silver?) -> [MacKarigarPayRow] {
        var out: [MacKarigarPayRow] = []
        func row(_ e: Expense, group: String, batchId: String? = nil) -> MacKarigarPayRow {
            MacKarigarPayRow(
                id: "pay:" + e.id, date: e.date,
                what: e.description.isEmpty ? (e.category.isEmpty ? "Payment" : e.category) : e.description,
                group: group, category: e.category, amount: e.amount, batchId: batchId
            )
        }
        if let pay {
            if let open = pay.open {
                for e in open.payments { out.append(row(e, group: (open.batch.label.isEmpty ? "Pay batch" : open.batch.label) + " (open)")) }
            }
            for s in pay.settled {
                for e in s.payments { out.append(row(e, group: s.batch.label, batchId: s.batch.id)) }
            }
            for e in pay.direct { out.append(row(e, group: "Direct payment")) }
        }
        if let silver {
            for t in silver.rows {
                let note = (t.description ?? "").isEmpty ? "" : " \u{2014} " + (t.description ?? "")
                out.append(MacKarigarPayRow(
                    id: "silver:" + t.id, date: t.date,
                    what: "Silver " + WorkshopLogic.grams3(t.silverGrams) + " at " + Money.pkr(t.surchargePerGram) + "/g" + note,
                    group: "Silver", category: "", amount: t.totalSurcharge, silverId: t.id
                ))
            }
        }
        return out
    }

    private func macSummary(_ data: MacKarigarPageData) -> [String] {
        if showingAccounts && session.isOwner {
            var parts: [String] = []
            if let open = data.pay?.open {
                parts.append((open.batch.label.isEmpty ? "Pay batch" : open.batch.label) + ": " + Money.pkr(open.total) + " paid")
            }
            if let pay = data.pay { parts.append(Money.pkr(pay.totalPaid) + " paid in all") }
            if let silver = data.silver, !silver.rows.isEmpty {
                parts.append(WorkshopLogic.grams3(silver.grams) + " of silver, " + Money.pkr(silver.surcharge) + " surcharge")
            }
            return parts
        }
        let p = data.position
        var parts = [WorkshopLogic.pieces(p.bench.count) + " on his bench"]
        if let first = p.bench.first { parts.append("oldest \(first.ageDays) d") }
        if !p.given.isEmpty { parts.append("\(p.given.count) handed to him, not back") }
        return parts
    }

    // MARK: The tables

    /// His pieces as the iPhone's rows: the piece over whom it is for, what it is and how old at the right.
    private func macWorkTable(_ karigar: Karigar, _ data: MacKarigarPageData) -> some View {
        List(selection: $macWorkPick) {
            ForEach(data.work) { (r: MacKarigarWorkRow) in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(r.title).font(.body).lineLimit(1)
                            if r.weight > 0 {
                                Text(WorkshopLogic.grams3(r.weight)).font(.callout).monospacedDigit().foregroundStyle(.secondary).layoutPriority(1)
                            }
                        }
                        Text(macWorkLine(r)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(r.status).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    switch r.urgency {
                    case .critical: Pill("\(r.ageDays)d", tone: .late)
                    case .warning: Pill("\(r.ageDays)d", tone: .owed)
                    case .ok: Text("\(r.ageDays)d").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 3)
                .tag(r.id)
                .houseRows()
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first, let r = data.work.first(where: { $0.id == id }) {
                Button("Open") { macOpenPath(r.path) }
            }
        } primaryAction: { ids in
            if ids.count == 1, let id = ids.first, let r = data.work.first(where: { $0.id == id }) { macOpenPath(r.path) }
        }
        .overlay {
            if data.work.isEmpty {
                ContentUnavailableView("Nothing Is With Him", systemImage: "hammer",
                                       description: Text(session.isOwner ? "Give him a piece from the Workshop, or assign stock work with \u{2303}\u{2318}N." : "Nothing is on his bench."))
                    .allowsHitTesting(false)
            }
        }
    }

    /// "On the bench \u{00B7} Sana Demo \u{00B7} ORD-12".
    private func macWorkLine(_ r: MacKarigarWorkRow) -> String {
        var parts = [r.kind]
        if !r.forWhom.isEmpty { parts.append(r.forWhom) }
        if !r.order.isEmpty { parts.append(r.order) }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// Four columns; the category rides beside what the payment was for.
    private func macPaymentsTable(_ data: MacKarigarPageData) -> some View {
        List(selection: $macPayPick) {
            ForEach(data.payments) { (r: MacKarigarPayRow) in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.what).font(.body).lineLimit(1)
                        Text(ShopDate.say(r.date) + (r.group.isEmpty ? "" : " \u{00B7} " + r.group))
                            .font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if !r.category.isEmpty && r.category != r.what {
                        Text(r.category).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    RowAmount(amount: r.amount)
                }
                .padding(.vertical, 3)
                .tag(r.id)
                .houseRows()
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first, let r = data.payments.first(where: { $0.id == id }) {
                macPayRowMenu(r, data)
            }
        }
        .overlay {
            if data.payments.isEmpty {
                ContentUnavailableView("No Payments Yet", systemImage: "banknote",
                                       description: Text(session.isOwner ? "Add one with \u{2325}\u{2318}P once a pay batch is open." : ""))
                    .allowsHitTesting(false)
            }
        }
    }

    @ViewBuilder
    private func macPayRowMenu(_ r: MacKarigarPayRow, _ data: MacKarigarPageData) -> some View {
        if let sid = r.silverId, let t = data.silver?.rows.first(where: { $0.id == sid }) {
            Button(role: .destructive) { askDeleteSilver(t) } label: { Label("Delete Silver Entry\u{2026}", systemImage: "trash") }
        }
        if let bid = r.batchId, let s = data.pay?.settled.first(where: { $0.batch.id == bid }) {
            Button(role: .destructive) { askDeleteBatch(s) } label: { Label("Delete Batch \u{201C}\(s.batch.label)\u{201D}\u{2026}", systemImage: "trash") }
        }
    }

    private func macAgeColor(_ u: WorkshopJob.Urgency) -> Color {
        switch u {
        case .critical: return Tone.late.color
        case .warning: return Tone.owed.color
        case .ok: return Color.primary
        }
    }

    // MARK: Now

    @ViewBuilder
    private func macNowRows(_ data: MacKarigarPageData) -> some View {
        let p = data.position
        MacWorkFact("On his bench", p.bench.isEmpty ? "nothing open" : WorkshopLogic.pieces(p.bench.count) + " \u{00B7} oldest \(p.bench[0].ageDays) d")
        MacWorkFact("Pieces weigh (est.)", p.metals.isEmpty ? "\u{2014}" : p.metals.map { WorkshopLogic.grams3($0.grams) }.joined(separator: " \u{00B7} "))
        if session.isOwner {
            MacWorkFact("Gold khata", WorkshopLogic.grams3(p.khataNet), tone: p.khataNet > 0.0005 ? .owed : .quiet)
            if let pay = data.pay {
                MacWorkFact("Active pay batch", (pay.open?.batch.label).flatMap { $0.isEmpty ? nil : $0 } ?? "None")
                MacWorkFact("Total paid (all time)", Money.pkr(pay.totalPaid))
            }
        } else if let silver = data.silver, !silver.rows.isEmpty {
            MacWorkFact("Silver received", WorkshopLogic.grams3(silver.grams) + " \u{00B7} " + Money.pkr(silver.surcharge) + " surcharge")
        }
    }

    // MARK: The toolbar and the actions

    @ToolbarContentBuilder
    private func macToolbar(_ karigar: Karigar, _ data: MacKarigarPageData) -> some ToolbarContent {
        if session.isOwner {
            ToolbarItem(placement: .principal) {
                Picker("Karigar view", selection: Binding(
                    get: { showingAccounts },
                    set: { on in showingAccounts = on }
                )) {
                    Text("Work").tag(false)
                    Text("Payments").tag(true)
                }
                .pickerStyle(.segmented)
                .help("What is on his bench, or what he has been paid")
            }
        }
        // Up to four actions, the rest in More: the payments' main one is Add Payment, the silver and the batch are in More.
        ToolbarItemGroup(placement: .automatic) {
            if showingAccounts && session.isOwner {
                MacToolbarAction(action: macAddPaymentAction(data))
                Menu {
                    MacActionMenuItem(action: macSilverAction)
                    MacActionMenuItem(action: macBatchAction(data))
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .help("Silver and the pay batch")
            } else {
                MacToolbarAction(action: macAssignAction)
                if let load = data.load, load.active > 0 {
                    ShareLink(item: WorkshopLogic.shareText(load, shopName: session.shop.name)) {
                        Label("Send list", systemImage: "square.and.arrow.up")
                    }
                    .help("Send his list of pieces")
                }
            }
        }
    }

    private func macAddPaymentAction(_ data: MacKarigarPageData) -> MacAction {
        let open = data.pay?.open
        return MacAction("Add Payment\u{2026}", symbol: "plus", shortcut: KeyboardShortcut("p", modifiers: [.command, .option]),
                         enabled: session.isOwner && open != nil) { if let open { ask = .pay(open.batch) } }
    }

    private var macSilverAction: MacAction {
        MacAction("Silver\u{2026}", symbol: "scalemass", enabled: session.isOwner) { ask = .silver }
    }

    private func macBatchAction(_ data: MacKarigarPageData) -> MacAction {
        if let open = data.pay?.open {
            return MacAction("Settle Pay Batch\u{2026}", symbol: "checkmark.seal", enabled: session.isOwner) { ask = .settle(open) }
        }
        return MacAction("Start a Pay Batch\u{2026}", symbol: "book.closed", enabled: session.isOwner) { ask = .start }
    }

    private var macAssignAction: MacAction {
        MacAction("Assign Stock Work\u{2026}", symbol: "plus.circle", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                  enabled: session.isOwner) { ask = .assign }
    }

    private func macGroups(_ karigar: Karigar, _ data: MacKarigarPageData) -> [[MacAction]] {
        let owner = session.isOwner
        let payRow: MacKarigarPayRow? = macPayPick.count == 1 ? macPayPick.first.flatMap { id in data.payments.first { $0.id == id } } : nil
        let silverEntry: KarigarSilverTransaction? = payRow?.silverId.flatMap { sid in data.silver?.rows.first { $0.id == sid } }
        let settled: KarigarPay.InBatch? = payRow?.batchId.flatMap { bid in data.pay?.settled.first { $0.batch.id == bid } }
        let activeWork = (data.load?.active ?? 0) > 0
        let copying = MacAction("Copy Work List", symbol: "doc.on.doc", enabled: activeWork) {
            if let load = data.load { UIPasteboard.general.string = WorkshopLogic.shareText(load, shopName: session.shop.name) }
        }
        let editing = MacAction("Edit Karigar\u{2026}", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command), enabled: owner) {
            macOpenPath("/karigars/" + WorkshopLogic.piece(karigar.id) + "/edit")
        }
        let preview = MacAction("Their View", symbol: "eye", enabled: owner) {
            macOpenPath("/my-work?preview=" + WorkshopLogic.piece(karigar.id))
        }
        let deletingSilver = MacAction("Delete Silver Entry\u{2026}", symbol: "trash", role: .destructive, enabled: owner && silverEntry != nil) {
            if let silverEntry { askDeleteSilver(silverEntry) }
        }
        let deletingBatch = MacAction("Delete Batch\u{2026}", symbol: "trash", role: .destructive, enabled: owner && settled != nil) {
            if let settled { askDeleteBatch(settled) }
        }
        // The delete code is the confirmation: its sheet says what is removed.
        let removing = MacAction("Remove Karigar\u{2026}", symbol: "person.crop.circle.badge.minus",
                                 shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive, enabled: owner) {
            askRemove(karigar)
        }
        let paying: [MacAction] = [macAddPaymentAction(data), macSilverAction, macBatchAction(data), macAssignAction]
        let changing: [MacAction] = [copying, editing, preview]
        let deleting: [MacAction] = [deletingSilver, deletingBatch, removing]
        return [paying, changing, deleting]
    }

    /// A page opens in a window of its own where the window can; otherwise in this one, as before.
    private func macOpenPath(_ path: String) {
        if let openPlace { openPlace(Route(path: path)) } else { macOpened = Route(path: path) }
    }
}
#endif
