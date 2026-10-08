import SwiftUI
import ERPCore

/// A karigar (src/app/karigars/[id]/page.tsx): opens on Now, what he holds of ours and what we owe him
/// (docs/decisions.md "One screen per question", lib/karigar-position.ts): his bench, the pieces' estimated weight
/// beside the gold khata (two measures, never summed), what has been handed to him and not come back, and the
/// hisaab cash. Read only. The hisaab, the khata and what has been paid are the owner's: the staff's copy of the
/// books comes without them. Edit, pay and the pay batches are the ERP's own page.
struct WorkshopKarigarScreen: View {
    let id: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    var body: some View {
        content
            .navigationTitle(book.karigars.item(id)?.name ?? "Karigar")
            .navigationBarTitleDisplayMode(.large)
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
                }
            }
    }

    private var loaded: Bool {
        let books = book.karigars.loaded && book.orders.loaded && book.invoices.loaded && book.karigarJobs.loaded && book.givenItems.loaded
        if !session.isOwner { return books }
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
        // His open pay batch and what has been paid inside it so far (owners: the batches are the owner's books).
        let batch = session.isOwner ? WorkshopLogic.openBatches(book.karigarBatches.items)[karigar.id] : nil
        let paidSoFar = batch.map { WorkshopLogic.paidInBatch($0, expenses: book.expenses.items) } ?? 0
        return List {
            profileSection(karigar, batch: batch)
            nowSection(karigar, position, batch: batch, paidSoFar: paidSoFar)
            if !position.bench.isEmpty { benchSection(karigar, position) }
            if !position.given.isEmpty { givenSection(karigar, position) }
            stockJobsSection(karigar)
            if session.isOwner { hisaabSection(karigar, position) }
            if session.isOwner { erpSection(karigar) }
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

    private func profileSection(_ karigar: Karigar, batch: KarigarBatch?) -> some View {
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
            if session.isOwner {
                LabeledContent("Total paid (all time)") {
                    Text(Money.pkr(totalPaid(karigar))).monospacedDigit().foregroundStyle(Color.red)
                }
                LabeledContent("Active pay batch") {
                    if let batch, !batch.label.isEmpty {
                        Text(batch.label)
                    } else {
                        Text("None").foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    /// Every payment made to him, in the batches and outside them.
    private func totalPaid(_ karigar: Karigar) -> Double {
        book.expenses.items.reduce(0) { $0 + ($1.karigarId == karigar.id ? $1.amount : 0) }
    }

    // MARK: Now

    private func nowSection(_ karigar: Karigar, _ p: WorkshopPosition, batch: KarigarBatch?, paidSoFar: Double) -> some View {
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
                        subtitle: cashHint(batch, paidSoFar),
                        trailing: cash == 0 ? "Square" : Money.pkr(abs(cash)),
                        trailingTint: cash < 0 ? Color.red : Color.primary
                    )
                }
            }
        } header: {
            Text("Now")
        } footer: {
            Text(nowFootnote)
        }
    }

    /// "March 2026: PKR 40,000 paid" while a pay batch is open, else just where the figure comes from.
    private func cashHint(_ batch: KarigarBatch?, _ paidSoFar: Double) -> String {
        guard let batch, !batch.label.isEmpty else { return "Hisaab cash" }
        return "\(batch.label): \(Money.pkr(paidSoFar)) paid"
    }

    private func weighHint(_ p: WorkshopPosition) -> String {
        if p.metals.isEmpty {
            return p.unweighed > 0 ? "\(p.unweighed) unweighed" : "the weights on the jobs"
        }
        var s = p.metals.map { $0.label }.joined(separator: ", ")
        if p.unweighed > 0 { s += " · \(p.unweighed) unweighed" }
        return s
    }

    private var nowFootnote: String {
        var s = "The pieces' weight is what the jobs say they will weigh"
        if session.isOwner {
            s += "; the gold khata is what was handed over and brought back. Two measures, never added."
        } else {
            s += "."
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
            Text("On the bench")
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
            Text("Handed to him, not back")
        }
    }

    // MARK: His stock jobs

    /// The jobs written up for him that no customer order stands behind: stock pieces, repairs, samples.
    @ViewBuilder
    private func stockJobsSection(_ karigar: Karigar) -> some View {
        let mine = book.karigarJobs.items.filter { $0.karigarId == karigar.id }
        if !mine.isEmpty {
            Section {
                ForEach(mine.prefix(20)) { j in
                    stockJobRow(j)
                }
            } header: {
                Text("His jobs")
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
                Text("Hisaab")
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

    // MARK: What stays on the web

    /// Edit, pay and the pay batches have no native screen yet; these open the ERP's own pages.
    private func erpSection(_ karigar: Karigar) -> some View {
        Section {
            NavigationLink(value: Route(path: "/karigars/" + WorkshopLogic.piece(karigar.id) + "/edit")) {
                Label("Edit karigar", systemImage: "pencil")
            }
            NavigationLink(value: Route(path: "/karigars/" + WorkshopLogic.piece(karigar.id) + "?web=1")) {
                Label("Pay, pay batches and silver", systemImage: "banknote")
            }
            NavigationLink(value: Route(path: "/my-work?preview=" + WorkshopLogic.piece(karigar.id))) {
                Label("Their view", systemImage: "eye")
            }
        } header: {
            Text("In the ERP")
        }
    }
}
