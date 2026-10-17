import SwiftUI
import ERPCore

/// The Workshop board (src/app/workshop/page.tsx): every piece on the bench, by karigar or by stage, what is
/// overdue, what has nobody on it, what has not left the shop. Pieces come from orders, from stock jobs and from
/// invoices (a Shopify sale is an invoice, and any invoice line handed to a karigar). What an owner does to a piece
/// is a write through the ERP: pick the karigar, tick it Given, tick it Done (an order's piece or a sold one); and
/// stock work is assigned (+), its status set and deleted (the delete code); and any piece's making details are changed
/// (Details), as on the web's page.
struct WorkshopBoard: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var filter: WorkshopFilter
    @State private var focus: WorkshopFocus = .all
    /// The list is where the web opens (workshop/page.tsx `view`).
    @State private var grouping: WorkshopGrouping = .list
    @State private var showFree = false
    @State private var showTotals = false
    /// Taken by starts once, on whoever is signed in (lib/people.ts), unless a link asked for a whole bench.
    @State private var seeded = false
    private let asksForWholeBench: Bool
    private let orderId: String?
    /// Pieces with a write in flight.
    @State private var busy: Set<String> = []
    @State private var failure: String?
    @State private var opened: WorkshopPlace?
    @State private var assigning: WorkshopStockJobAsk?
    @State private var editing: KarigarJob?
    @State private var editingPiece: WorkshopPieceAsk?
    @State private var deletion: OwnerDeletion?
    @State private var note: OwnerNote?

    /// `?karigar=<id>` (the karigar page's "On his bench") opens on his whole bench.
    init(path: String) {
        var f = WorkshopFilter()
        f.karigarId = WorkshopLogic.queryValue("karigar", in: path) ?? ""
        orderId = WorkshopLogic.queryValue("order", in: path)
        asksForWholeBench = !f.karigarId.isEmpty || orderId != nil
        _filter = State(initialValue: f)
    }

    var body: some View {
        Group {
            if orderId == nil {
                screen.searchable(text: $filter.query, prompt: "Item, karigar, customer, order")
            } else {
                screen
            }
        }
    }

    private var screen: some View {
        ShelfState(loaded: loaded, error: firstError, offline: book.orders.offline) {
            content
        }
        .navigationTitle(orderId == nil ? "Workshop" : "Give out")
        .navigationBarTitleDisplayMode(.large)
        .toolbar { if orderId == nil { boardToolbar } }
        .modifier(HouseGround())
        .workshopPlaceDestination($opened)
        .workshopFailureAlert($failure)
        .sheet(item: $assigning) { (ask: WorkshopStockJobAsk) in
            WorkshopStockJobSheet(karigars: workshopLive(book.karigars.items), presetKarigarId: ask.karigarId) { (saved: OwnerNote) in
                Note.show(saved, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $editing) { (job: KarigarJob) in
            WorkshopJobDetailsSheet(job: job) { (saved: OwnerNote) in
                Note.show(saved, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $editingPiece) { (ask: WorkshopPieceAsk) in
            WorkshopPieceDetailsSheet(ask: ask) { (saved: OwnerNote) in
                Note.show(saved, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(OwnerNote(title: "Job deleted"), in: $note, reduce: reduceMotion)
            }
        }
        .ownerNote($note)
        .onAppear {
            book.orders.need()
            book.invoices.need()
            book.karigars.need()
            book.karigarJobs.need()
            seedTakenBy()
        }
    }

    /// Whoever is signed in sees their own pieces first, Anyone one tap away; a karigar's whole bench opens on
    /// Anyone, this once (hooks/use-me.ts `useMineFilter`). What is picked after holds while this screen is open.
    private func seedTakenBy() {
        if seeded { return }
        seeded = true
        if asksForWholeBench { return }
        filter.takenBy = session.shop.workshopStart == "anyone" ? "" : (session.shop.person ?? "")
    }

    private var loaded: Bool {
        book.orders.loaded && book.invoices.loaded && book.karigars.loaded && book.karigarJobs.loaded
    }

    private var firstError: String? {
        book.orders.error ?? book.invoices.error ?? book.karigars.error ?? book.karigarJobs.error
    }

    // MARK: The list

    @ViewBuilder
    private var content: some View {
        let live = workshopLive(book.karigars.items)
        let jobs = WorkshopLogic.buildJobs(
            orders: book.orders.items,
            karigarJobs: book.karigarJobs.items,
            karigars: live,
            invoices: book.invoices.items
        )
        let all = orderId.map { id in jobs.filter { $0.orderId == id } } ?? jobs
        let snap = WorkshopSnapshot(all: all, filter: filter)
        board(snap, live)
    }

    private func board(_ snap: WorkshopSnapshot, _ live: [Karigar]) -> some View {
        let focused = snap.focused(focus)
        let busyIds = Set(snap.all.filter { !$0.isDone }.map { $0.karigarId })
        let choices = WorkshopChoices(karigars: live, busyIds: busyIds)
        return List { Group {
            if orderId == nil {
                Section {
                    FigureRow {
                        FigureTile(label: "All active pieces", value: "\(snap.stats.active)")
                        FigureTile(label: "Benches working", value: "\(snap.stats.workers)")
                    }
                    .chipRowInList()
                }
                Section { controlBar(snap).chipRowInList() }
            }
            if let orderId {
                Section {
                    Text(orderId).font(.headline)
                }
            }
            layout(snap, focused: focused, live: live, choices: choices)
            if focused.isEmpty {
                Section { emptyState(snap).listRowBackground(Color.clear) }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private func layout(_ snap: WorkshopSnapshot, focused: [WorkshopJob], live: [Karigar], choices: WorkshopChoices) -> some View {
        switch grouping {
        case .karigar:
            if filter.karigarId.isEmpty || focus == .unassigned {
                karigarSections(snap, focused: focused, live: live, choices: choices)
            } else {
                focusedKarigar(focused, choices: choices)
            }
        case .stage:
            stageSections(focused, choices: choices)
        case .list:
            listSection(focused, choices: choices)
        }
    }

    // MARK: By karigar

    @ViewBuilder
    private func karigarSections(_ snap: WorkshopSnapshot, focused: [WorkshopJob], live: [Karigar], choices: WorkshopChoices) -> some View {
        if focus == .all && !focused.isEmpty {
            glanceSection(WorkshopLogic.groupByKarigar(snap.bench))
        }
        ForEach(WorkshopLogic.groupByKarigar(focused)) { load in
            karigarSection(load, choices: choices)
        }
        if focus == .all && !filter.narrowed && filter.karigarId.isEmpty {
            freeSection(snap, live: live)
        }
    }

    /// The whole bench in figures, folded away: the pieces and the benches are the tiles above (rule 15: not said twice).
    private func glanceSection(_ loads: [WorkshopLoad]) -> some View {
        let late = loads.reduce(0) { $0 + $1.late }
        let critical = loads.reduce(0) { $0 + $1.critical }
        let grams = loads.reduce(0.0) { $0 + $1.totalWeightG }
        let value = loads.reduce(0.0) { $0 + $1.totalValue }
        return Section {
            DisclosureGroup("Bench totals", isExpanded: $showTotals) {
            FigureGrid {
                FigureTile(label: "Late \(WorkshopLogic.warnDays)d+", value: "\(late)", tint: late > 0 ? Tone.owed.color : Color.primary)
                FigureTile(label: "Critical \(WorkshopLogic.criticalDays)d+", value: "\(critical)", tint: critical > 0 ? Tone.late.color : Color.primary)
                FigureTile(label: "Metal out", value: grams > 0 ? WorkshopLogic.number(grams, digits: 1) + "g" : "—")
                if session.isOwner {
                    FigureTile(label: "Value out", value: value > 0 ? Money.pkrLac(value) : "—")
                }
            }
            .padding(.vertical, 4)
            }
            .font(.subheadline)
            .padding(16)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private func karigarSection(_ load: WorkshopLoad, choices: WorkshopChoices) -> some View {
        Section {
            jobCards(WorkshopLogic.byOrder(load.jobs), showKarigar: false, choices: choices)
        } header: {
            karigarHeader(load)
        }
    }

    private func karigarHeader(_ load: WorkshopLoad) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Image(systemName: load.isUnassigned ? "exclamationmark.triangle.fill" : "hammer")
                        .foregroundStyle(load.isUnassigned ? Tone.owed.color : Color.accentColor)
                    Text(load.isUnassigned ? "Unassigned" : load.karigarName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(load.isUnassigned ? Tone.owed.color : Color.primary)
                }
                Text(headerCounts(load))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            WorkshopUrgencyBadges(critical: load.critical, late: load.late)
            if !load.isUnassigned {
                Button { opened = WorkshopPlace.karigar(load.karigarId) } label: {
                    Image(systemName: "person.crop.circle")
                }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Open " + load.karigarName)
            }
        }
        .textCase(nil)
    }

    /// "4 active · 2 in progress · oldest 9d · 12.5g out".
    private func headerCounts(_ load: WorkshopLoad) -> String {
        var parts = ["\(load.active) active"]
        if load.inProgress != load.active && load.inProgress > 0 { parts.append("\(load.inProgress) in progress") }
        if load.oldestActiveDays > 0 { parts.append("oldest \(load.oldestActiveDays)d") }
        if load.active > 0 && load.totalWeightG > 0 { parts.append(WorkshopLogic.number(load.totalWeightG, digits: 1) + "g out") }
        if load.completed > 0 && load.active == 0 { parts.append("\(load.completed) done") }
        return parts.joined(separator: " · ")
    }

    /// The karigars with nothing on the bench: these are the people the next job can go to.
    @ViewBuilder
    private func freeSection(_ snap: WorkshopSnapshot, live: [Karigar]) -> some View {
        let busyIds = Set(snap.bench.filter { !$0.isDone }.map { $0.karigarId })
        let idle = live.filter { !busyIds.contains($0.id) }
        if !idle.isEmpty {
            Section {
                DisclosureGroup(isExpanded: $showFree) {
                    ForEach(idle) { k in
                        NavigationLink(value: Route(path: WorkshopLogic.karigarPath(k.id))) {
                            Label(k.name, systemImage: "hammer")
                        }
                    }
                } label: {
                    Label("\(idle.count) free", systemImage: "moon")
                        .foregroundStyle(.secondary)
                }
            } footer: {
                if !showFree {
                    Text(idle.map { $0.name }.joined(separator: ", "))
                }
            }
        }
    }

    // MARK: One karigar, whole

    /// One karigar selected: their numbers and their pieces sectioned by how long they have sat.
    @ViewBuilder
    private func focusedKarigar(_ focused: [WorkshopJob], choices: WorkshopChoices) -> some View {
        let loads = WorkshopLogic.groupByKarigar(focused)
        if let load = loads.first {
            let active = load.jobs.filter { !$0.isDone }
            let critical = active.filter { $0.urgency == .critical }.sorted { $0.ageDays > $1.ageDays }
            let late = active.filter { $0.urgency == .warning }.sorted { $0.ageDays > $1.ageDays }
            let onTrack = active.filter { $0.urgency == .ok }.sorted { $0.ageDays > $1.ageDays }
            let done = load.jobs.filter { $0.isDone }
            focusedSummary(load, orders: Set(active.compactMap { $0.orderId }).count)
            urgencySection("Critical", hint: "sitting \(WorkshopLogic.criticalDays)+ days", tone: .late, jobs: critical, choices: choices)
            urgencySection("Late", hint: "\(WorkshopLogic.warnDays)–\(WorkshopLogic.criticalDays) days", tone: .owed, jobs: late, choices: choices)
            urgencySection("On track", hint: "", tone: .quiet, jobs: onTrack, choices: choices)
            if filter.status == .all || filter.status == .completed {
                urgencySection("Completed", hint: "", tone: .quiet, jobs: done, choices: choices)
            }
        }
    }

    private func focusedSummary(_ load: WorkshopLoad, orders: Int) -> some View {
        Section {
            Button { opened = WorkshopPlace.karigar(load.karigarId) } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(load.isUnassigned ? "Unassigned work" : load.karigarName).font(.title3.weight(.semibold))
                        let sentence = focusedSentence(load, orders: orders)
                        if !sentence.isEmpty {
                            Text(sentence).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if !load.isUnassigned { Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary) }
                }
            }
            .buttonStyle(.plain)
            .disabled(load.isUnassigned)
            FocusedCells(load: load, showValue: session.isOwner)
        }
    }

    /// How many orders and how old the oldest: the active count is the first figure below (rule 15: not said twice).
    private func focusedSentence(_ load: WorkshopLoad, orders: Int) -> String {
        var parts: [String] = []
        if orders > 0 { parts.append("across \(orders) order\(orders == 1 ? "" : "s")") }
        if load.oldestActiveDays > 0 { parts.append("oldest \(load.oldestActiveDays) days") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func urgencySection(_ title: String, hint: String, tone: Tone, jobs: [WorkshopJob], choices: WorkshopChoices) -> some View {
        if !jobs.isEmpty {
            Section {
                jobCards(WorkshopLogic.byOrder(jobs), showKarigar: false, choices: choices)
            } header: {
                LedgerHeading(title: title, count: jobs.count, trailing: hint.isEmpty ? nil : hint, tone: tone)
            }
        }
    }

    // MARK: By stage

    private struct Stage: Identifiable {
        let status: WorkshopJob.Status
        let title: String
        let symbol: String
        var id: String { title }
    }

    private let stages: [Stage] = [
        Stage(status: .pending, title: "Pending", symbol: "circle"),
        Stage(status: .inProgress, title: "In Progress", symbol: "circle.dotted"),
        Stage(status: .completed, title: "Completed", symbol: "checkmark.circle"),
    ]

    @ViewBuilder
    private func stageSections(_ focused: [WorkshopJob], choices: WorkshopChoices) -> some View {
        ForEach(stages) { stage in
            let jobs = focused.filter { $0.status == stage.status }
            if !jobs.isEmpty {
                Section {
                    jobCards(jobs, showKarigar: true, choices: choices)
                } header: {
                    stageHeader(stage, jobs)
                }
            }
        }
    }

    private func stageHeader(_ stage: Stage, _ jobs: [WorkshopJob]) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Label(stage.title, systemImage: stage.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.primary)
            Spacer(minLength: 8)
            WorkshopUrgencyBadges(
                critical: jobs.filter { $0.urgency == .critical }.count,
                late: jobs.filter { $0.urgency == .warning }.count
            )
            Text("\(jobs.count)").font(.caption).foregroundStyle(.secondary)
        }
        .textCase(nil)
    }

    // MARK: Every piece

    @ViewBuilder
    private func listSection(_ focused: [WorkshopJob], choices: WorkshopChoices) -> some View {
        if !focused.isEmpty {
            Section {
                jobCards(focused, showKarigar: true, choices: choices)
            } header: {
                LedgerHeading(title: "Pieces", count: focused.count)
            }
        }
    }

    // MARK: A piece

    private func jobCards(_ jobs: [WorkshopJob], showKarigar: Bool, choices: WorkshopChoices) -> some View {
        WorkshopCards(items: jobs, minimumWidth: 420) { job in
            jobRow(job, showKarigar: showKarigar, choices: choices)
        }
    }

    private func jobRow(_ job: WorkshopJob, showKarigar: Bool, choices: WorkshopChoices) -> some View {
        WorkshopJobRow(
            job: job,
            showKarigar: showKarigar,
            isOwner: session.isOwner,
            busy: busy.contains(job.id),
            choices: choices,
            actions: actions
        )
    }

    private var actions: WorkshopActions {
        WorkshopActions(
            done: { job, done in setDone(job, done) },
            given: { job, given in setGiven(job, given) },
            assign: { job, karigarId in setKarigar(job, karigarId) },
            status: { job, status in setStatus(job, status) },
            details: { job in openDetails(job) },
            delete: { job in askDelete(job) },
            open: { place in opened = place }
        )
    }

    // MARK: The controls above the list

    private func controlBar(_ snap: WorkshopSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(WorkshopFocus.allCases) { f in
                        // A count only where it asks for a hand (rule 15): All work's is the tile above.
                        FilterChip(title: focusTitle(f), count: f == .all ? nil : snap.count(f), chosen: focus == f) { focus = f }
                    }
                }
            }
            .accessibilityIdentifier("workshop.focus")
            FigureRow {
                Menu {
                    Picker("Group by", selection: $grouping) {
                        ForEach(WorkshopGrouping.allCases) { g in Text(g.title).tag(g) }
                    }
                } label: {
                    Label(grouping == .list ? "All pieces" : grouping.title, systemImage: "rectangle.grid.1x2")
                        .font(.subheadline).frame(minHeight: 44)
                }
                .buttonStyle(.borderless)
                Spacer(minLength: 0)
                if filter.menuCount > 0 {
                    Button("Reset filters") { filter = WorkshopFilter() }
                        .font(.subheadline).frame(minHeight: 44)
                        .buttonStyle(.borderless)
                }
            }
            if !activeFilterWords.isEmpty {
                Text(activeFilterWords).font(.footnote).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !filter.karigarId.isEmpty {
                karigarFilterNote
            }
        }
    }

    private func focusTitle(_ f: WorkshopFocus) -> String {
        switch f {
        case .all: return "All work"
        case .attention: return "Needs attention"
        case .unassigned: return "Unassigned"
        case .notGiven: return "To give"
        }
    }

    private var activeFilterWords: String {
        var words: [String] = []
        if !filter.takenBy.isEmpty { words.append("Taken by " + filter.takenBy) }
        if filter.type != .all { words.append(filter.type.title) }
        if filter.status != .active { words.append(filter.status.title) }
        return words.joined(separator: " · ")
    }

    private var karigarFilterNote: some View {
        let name = book.karigars.item(filter.karigarId)?.name ?? "one karigar"
        return HStack(spacing: 6) {
            Text("Showing " + name).font(.caption).foregroundStyle(.secondary)
            Button("Everyone") { filter.karigarId = "" }
                .font(.caption)
                .buttonStyle(.borderless)
        }
    }

    @ToolbarContentBuilder
    private var boardToolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) { filterMenu }
        if session.isOwner {
            ToolbarItem(placement: .topBarTrailing) {
                // The karigar in focus is the one the work goes to, as the web's "Assign" on his card.
                Button { assigning = WorkshopStockJobAsk(karigarId: filter.karigarId) } label: {
                    Label("Assign stock work", systemImage: "plus")
                }
            }
        }
        ToolbarItem(placement: .topBarTrailing) { moreMenu }
    }

    private var filterMenu: some View {
        let people = session.shop.takenBy
        let live = workshopLive(book.karigars.items)
        return Menu {
            if !people.isEmpty {
                Picker("Taken by", selection: $filter.takenBy) {
                    Text("Anyone").tag("")
                    ForEach(people, id: \.self) { p in
                        Text(p).tag(p)
                    }
                }
            }
            Picker("Work", selection: $filter.type) {
                ForEach(WorkshopTypeFilter.allCases) { t in
                    Text(t.title).tag(t)
                }
            }
            Picker("Karigar", selection: $filter.karigarId) {
                Text("Everyone").tag("")
                ForEach(live) { k in
                    Text(k.name).tag(k.id)
                }
            }
            Picker("Status", selection: $filter.status) {
                ForEach(WorkshopStatusFilter.allCases) { s in
                    Text(s.title).tag(s)
                }
            }
        } label: {
            Label("Filter", systemImage: filter.menuCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    /// The Workshop's other places.
    private var moreMenu: some View {
        Menu {
            if session.isOwner {
                Button { assigning = WorkshopStockJobAsk(karigarId: filter.karigarId) } label: {
                    Label("Assign stock work", systemImage: "plus.circle")
                }
            }
            Button { opened = WorkshopPlace(path: "/karigars") } label: {
                Label("Karigars", systemImage: "person.2")
            }
            Button { opened = WorkshopPlace(path: "/given") } label: {
                Label("Given items", systemImage: "shippingbox")
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }

    @ViewBuilder
    private func emptyState(_ snap: WorkshopSnapshot) -> some View {
        let anyWork = !snap.all.isEmpty
        switch focus {
        case .unassigned:
            ContentUnavailableView("All work is assigned", systemImage: "checkmark.circle", description: Text("No work is awaiting assignment."))
        case .attention:
            ContentUnavailableView("No work requires attention", systemImage: "checkmark.circle", description: Text("No overdue or unassigned work."))
        case .notGiven:
            ContentUnavailableView("Everything assigned has been given", systemImage: "checkmark.circle", description: Text("No piece with a karigar is still in the safe."))
        case .all:
            if anyWork {
                ContentUnavailableView("No jobs match", systemImage: "hammer", description: Text("Try adjusting the search or filters."))
            } else {
                ContentUnavailableView("No pending work", systemImage: "hammer", description: Text("Nothing is on the bench."))
            }
        }
    }

    // MARK: Writes (owners only; the ERP refuses anyone else)

    /// One write for one piece, with its controls off meanwhile. The shelf brings the change back.
    private func write(_ job: WorkshopJob, _ op: String, _ fields: [String: Any]) {
        if busy.contains(job.id) { return }
        busy.insert(job.id)
        Task { @MainActor in
            do {
                // These say the state wanted (done, given, a karigar), so Done → Not done → Done within the ERP's
                // 30-second once-only window is three changes, not a repeat: `seq` makes each its own (busy stops double taps).
                var named = fields
                named["seq"] = UUID().uuidString
                _ = try await ERPAPI.shared.write(op, named)
            } catch {
                failure = error.localizedDescription
            }
            busy.remove(job.id)
        }
    }

    /// Done: an order's piece (its order moves on when every piece is), a sold piece (it leaves the board), or a
    /// stock job (Completed, or back to Pending).
    private func setDone(_ job: WorkshopJob, _ done: Bool) {
        switch WorkshopLogic.writeTarget(job) {
        case .order(let id, let index):
            write(job, "setPieceDone", ["orderId": id, "index": index, "done": done])
        case .invoice(let id, let index):
            write(job, "setInvoicePieceDone", ["invoiceId": id, "index": index, "done": done])
        case .stock(let id):
            write(job, "setStockJobStatus", ["jobId": id, "status": done ? KarigarJobStatus.completed.rawValue : KarigarJobStatus.pending.rawValue])
        case nil:
            return
        }
    }

    private func setGiven(_ job: WorkshopJob, _ given: Bool) {
        // Nobody to have given it to: refused here as on the web.
        if job.isUnassigned && given {
            failure = "Nobody is on this piece yet, so there is no one to have given it to. Assign a karigar first."
            return
        }
        switch WorkshopLogic.writeTarget(job) {
        case .order(let id, let index):
            write(job, "setPieceGiven", ["orderId": id, "index": index, "given": given])
        case .invoice(let id, let index):
            write(job, "setInvoicePieceGiven", ["invoiceId": id, "index": index, "given": given])
        case .stock(let id):
            write(job, "setStockJobGiven", ["jobId": id, "given": given])
        case nil:
            return
        }
    }

    private func setKarigar(_ job: WorkshopJob, _ karigarId: String) {
        switch WorkshopLogic.writeTarget(job) {
        case .order(let id, let index):
            write(job, "setPieceKarigar", ["orderId": id, "index": index, "karigarId": karigarId])
        case .invoice(let id, let index):
            write(job, "setInvoicePieceKarigar", ["invoiceId": id, "index": index, "karigarId": karigarId])
        case .stock, nil:
            // A stock job is written for its karigar; the web offers no reassigning it either.
            return
        }
    }

    private func setStatus(_ job: WorkshopJob, _ status: KarigarJobStatus) {
        guard case .stock(let id) = WorkshopLogic.writeTarget(job) else { return }
        write(job, "setStockJobStatus", ["jobId": id, "status": status.rawValue])
    }

    /// A stock job as it is on file: its sheet edits its own fields (the board's line merges the instructions). An order's
    /// piece or a sold piece opens the Details sheet (the web's Details dialog), the order piece with its sample picture.
    private func openDetails(_ job: WorkshopJob) {
        switch WorkshopLogic.writeTarget(job) {
        case .stock(let id):
            if let held = book.karigarJobs.item(id) {
                editing = held
            } else {
                failure = "This job is no longer on file."
            }
        case .order(let id, let index):
            guard let order = book.orders.item(id), order.items.indices.contains(index) else {
                failure = "This piece is no longer on the order."
                return
            }
            let item = order.items[index]
            editingPiece = WorkshopPieceAsk(job: job, target: .order(id: id, index: index),
                                            samplePhotoId: item.samplePhotoId, sampleImageDataUri: item.sampleImageDataUri)
        case .invoice(let id, let index):
            editingPiece = WorkshopPieceAsk(job: job, target: .invoice(id: id, index: index))
        case nil:
            return
        }
    }

    /// The web's "Delete this job?": the job goes from the Workshop and his page; nothing else is touched.
    private func askDelete(_ job: WorkshopJob) {
        guard case .stock(let id) = WorkshopLogic.writeTarget(job) else { return }
        let who = job.isUnassigned ? "" : " It comes off \(job.karigarName)'s bench."
        deletion = OwnerDeletion(
            what: "Delete this karigar job",
            detail: "\u{201C}\(job.description)\u{201D} will be removed.\(who)"
        ) { code in
            _ = try await ERPAPI.shared.write("deleteStockJob", ["jobId": id, "deleteCode": code])
        }
    }
}

/// Assign Stock Work asked for, with the karigar it goes to when one is in focus ("" for none).
struct WorkshopStockJobAsk: Identifiable {
    let id = UUID()
    let karigarId: String
}

/// The one karigar's cells: only those that say something, and no zero printed as a muted 0.
private struct FocusedCells: View {
    let load: WorkshopLoad
    let showValue: Bool

    private struct Cell: Identifiable {
        let label: String
        let value: String
        let tint: Color
        var id: String { label }
    }

    private var cells: [Cell] {
        var out = [Cell(label: "Active", value: "\(load.active)", tint: Color.primary)]
        if load.inProgress != load.active {
            out.append(Cell(label: "In progress", value: "\(load.inProgress)", tint: Tone.working.color))
        }
        // Late and critical are the sections' own headings below.
        if load.totalWeightG > 0 {
            out.append(Cell(label: "Metal out", value: WorkshopLogic.number(load.totalWeightG, digits: 1) + "g", tint: Color.primary))
        }
        if showValue && load.totalValue > 0 {
            out.append(Cell(label: "Value", value: Money.pkrLac(load.totalValue), tint: Color.primary))
        }
        return out
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 20) {
                ForEach(cells) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.label.uppercased()).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        Text(c.value).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(c.tint)
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }
}
