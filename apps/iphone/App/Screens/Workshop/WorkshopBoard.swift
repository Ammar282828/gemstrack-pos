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
    /// What the person just did to a piece, shown while the shelf's copy is still the old one.
    @State private var patches: [String: JobPatch] = [:]
    @State private var failure: String?
    @State private var opened: WorkshopPlace?
    @State private var assigning: WorkshopStockJobAsk?
    @State private var editing: KarigarJob?
    @State private var editingPiece: WorkshopPieceAsk?
    @State private var deletion: OwnerDeletion?
    @State private var note: Note?
    /// Bumped when a piece's write goes through (done, given, a karigar): the success tap.
    @State private var saved = 0
    #if os(macOS)
    @State private var macPicked = Set<String>()
    @State private var macSort: [KeyPathComparator<WorkshopJob>] = []
    @State private var macInspector = true
    @Environment(\.openPlaceWindow) private var openPlace
    #endif

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
        .hubTitleDisplay()
        .navigationSubtitle(orderId ?? "")
        .toolbar { if orderId == nil { boardToolbar } }
        .modifier(HouseGround())
        .workshopPlaceDestination($opened)
        .workshopFailureAlert($failure)
        .sheet(item: $assigning) { (ask: WorkshopStockJobAsk) in
            WorkshopStockJobSheet(karigars: workshopLive(book.karigars.items), presetKarigarId: ask.karigarId) { (said: Note) in
                Note.show(said, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $editing) { (job: KarigarJob) in
            WorkshopJobDetailsSheet(job: job) { (said: Note) in
                Note.show(said, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $editingPiece) { (ask: WorkshopPieceAsk) in
            WorkshopPieceDetailsSheet(ask: ask) { (said: Note) in
                Note.show(said, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(Note(title: "Job deleted"), in: $note, reduce: reduceMotion)
            }
        }
        .noteToast($note)
        .savedFeedback(trigger: saved)
        .onChange(of: Outbox.shared.failure?.id) { _, _ in patches = [:] }
        // The warning tap as a delete is asked for (the delete code sheet opens).
        .sensoryFeedback(.warning, trigger: deletion != nil) { _, now in now }
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
        let shownJobs = patches.isEmpty ? jobs : jobs.map { patched($0) }
        let all = orderId.map { id in shownJobs.filter { $0.orderId == id } } ?? shownJobs
        let snap = WorkshopSnapshot(all: all, filter: filter)
        #if os(macOS)
        macBoard(snap, live)
        #else
        board(snap, live)
        #endif
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
            layout(snap, focused: focused, live: live, choices: choices)
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if focused.isEmpty {
                // Centred over the list, not a row in it; nothing in it is pressed, so the chips stay reachable.
                emptyState(snap).allowsHitTesting(false)
            }
        }
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
            DisclosureGroup("Bench totals", isExpanded: Binding(
                get: { showTotals },
                set: { on in Motion.run(reduce: reduceMotion) { showTotals = on } }
            )) {
            FigureGrid {
                FigureTile(label: "Late \(WorkshopLogic.warnDays)d+", value: "\(late)", tint: late > 0 ? Tone.owed.color : Color.primary)
                FigureTile(label: "Critical \(WorkshopLogic.criticalDays)d+", value: "\(critical)", tint: critical > 0 ? Tone.late.color : Color.primary)
                FigureTile(label: "Metal out", value: grams > 0 ? WorkshopLogic.number(grams, digits: 1) + "g" : "—")
                if session.isOwner {
                    FigureTile(label: "Value out", value: value > 0 ? Money.pkrLac(value) : "—")
                }
            }
            .padding(.vertical, pt(4))
            }
            .font(.subheadline)
            .padding(pt(16))
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
        VStack(alignment: .leading, spacing: 2) {
            AdaptiveStack(spacing: pt(8), alignment: .center) {
                HStack(spacing: pt(6)) {
                    Image(systemName: load.isUnassigned ? "exclamationmark.triangle.fill" : "hammer")
                        .foregroundStyle(load.isUnassigned ? Tone.owed.color : Theme.accent)
                    LedgerHeading(title: load.isUnassigned ? "Unassigned" : load.karigarName)
                }
                Spacer(minLength: 8)
                WorkshopUrgencyBadges(critical: load.critical, late: load.late)
                if !load.isUnassigned {
                    Button { opened = WorkshopPlace.karigar(load.karigarId) } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .buttonStyle(.borderless)
                    .frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
                    .accessibilityLabel("Open " + load.karigarName)
                }
            }
            Text(headerCounts(load))
                .font(.caption)
                .foregroundStyle(.secondary)
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
                DisclosureGroup(isExpanded: Binding(
                    get: { showFree },
                    set: { on in Motion.run(reduce: reduceMotion) { showFree = on } }
                )) {
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
        Stage(status: .inProgress, title: "In progress", symbol: "circle.dotted"),
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
        AdaptiveStack(spacing: pt(8), alignment: .center) {
            HStack(spacing: pt(6)) {
                Image(systemName: stage.symbol).foregroundStyle(.secondary)
                LedgerHeading(title: stage.title, count: jobs.count)
            }
            Spacer(minLength: 8)
            WorkshopUrgencyBadges(
                critical: jobs.filter { $0.urgency == .critical }.count,
                late: jobs.filter { $0.urgency == .warning }.count
            )
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

    /// Only the Focus chips live in the list; the rest of the filtering (and Group by, and Reset) is the toolbar's Filter menu.
    private func controlBar(_ snap: WorkshopSnapshot) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: pt(8)) {
                ForEach(WorkshopFocus.allCases) { f in
                    // A count only where it asks for a hand (rule 15): All work's is the tile above.
                    FilterChip(title: focusTitle(f), count: f == .all ? nil : snap.count(f), chosen: focus == f) {
                        Motion.run(reduce: reduceMotion) { focus = f }
                    }
                }
            }
        }
        .accessibilityIdentifier("workshop.focus")
    }

    private func focusTitle(_ f: WorkshopFocus) -> String {
        switch f {
        case .all: return "All work"
        case .attention: return "Needs attention"
        case .unassigned: return "Unassigned"
        case .notGiven: return "To give"
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
            Picker("Group by", selection: Binding(
                get: { grouping },
                set: { g in Motion.run(reduce: reduceMotion) { grouping = g } }
            )) {
                ForEach(WorkshopGrouping.allCases) { g in Text(g.title).tag(g) }
            }
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
            if filter.menuCount > 0 {
                Divider()
                Button("Reset filters", systemImage: "arrow.counterclockwise") {
                    Motion.run(reduce: reduceMotion) { filter = WorkshopFilter() }
                }
            }
        } label: {
            Label("Filter", systemImage: filter.menuCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    /// The Workshop's other places.
    private var moreMenu: some View {
        Menu {
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
        let searching = !filter.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        switch focus {
        case .unassigned:
            EmptyState("All work is assigned", symbol: "checkmark.circle", message: "No work is awaiting assignment.")
        case .attention:
            EmptyState("No work requires attention", symbol: "checkmark.circle", message: "No overdue or unassigned work.")
        case .notGiven:
            EmptyState("Everything assigned has been given", symbol: "checkmark.circle", message: "No piece with a karigar is still in the safe.")
        case .all:
            if searching {
                ContentUnavailableView.search(text: filter.query)
            } else if anyWork {
                EmptyState("No jobs match", symbol: "hammer", message: "Try adjusting the filters.")
            } else {
                EmptyState("No pending work", symbol: "hammer", message: "Nothing is on the bench.")
            }
        }
    }

    // MARK: Writes (owners only; the ERP refuses anyone else)

    /// One write for one piece: the board shows it at once and the Outbox carries it (the shelf brings the real copy).
    private func write(_ job: WorkshopJob, _ op: String, _ fields: [String: Any],
                       status: WorkshopJob.Status? = nil, given: Bool? = nil, karigarId: String? = nil) {
        // These say the state wanted (done, given, a karigar), so Done → Not done → Done within the ERP's
        // 30-second once-only window is three changes, not a repeat: `seq` makes each its own.
        var named = fields
        named["seq"] = UUID().uuidString
        let from = patches[job.id]?.from ?? JobSig(job)
        var to = patches[job.id]?.to ?? from
        var name = patches[job.id]?.toName
        if let status { to.status = status }
        if let given { to.given = given }
        if let karigarId {
            to.karigarId = karigarId == "none" ? WorkshopLogic.unassigned : karigarId
            name = karigarId == "none" ? "Unassigned" : (book.karigars.items.first { $0.id == karigarId }?.name ?? job.karigarName)
        }
        Motion.run(Motion.enter, reduce: reduceMotion) { patches[job.id] = JobPatch(from: from, to: to, toName: name) }
        saved += 1
        Outbox.shared.send(op: op, fields: named, business: House.business, label: job.description)
    }

    /// The piece as the person left it, until the shelf's copy has moved off the one it was.
    private func patched(_ job: WorkshopJob) -> WorkshopJob {
        guard let p = patches[job.id], JobSig(job) == p.from else { return job }
        var j = WorkshopJob(id: job.id, source: job.source, karigarId: p.to.karigarId, karigarName: p.toName ?? job.karigarName,
                            description: job.description, status: p.to.status, assignedDate: job.assignedDate)
        j.orderId = job.orderId; j.invoiceId = job.invoiceId; j.takenBy = job.takenBy; j.isOnline = job.isOnline
        j.itemIndex = job.itemIndex; j.customerName = job.customerName; j.category = job.category
        j.metalType = job.metalType; j.karat = job.karat; j.weightG = job.weightG; j.quantity = job.quantity
        j.size = job.size; j.referenceSku = job.referenceSku; j.plating = job.plating; j.value = job.value; j.notes = job.notes
        j.givenAt = p.to.given ? (job.hasGiven ? job.givenAt : ERPDate.iso(Date())) : nil
        return j
    }

    /// Done: an order's piece (its order moves on when every piece is), a sold piece (it leaves the board), or a
    /// stock job (Completed, or back to Pending).
    private func setDone(_ job: WorkshopJob, _ done: Bool) {
        switch WorkshopLogic.writeTarget(job) {
        case .order(let id, let index):
            write(job, "setPieceDone", ["orderId": id, "index": index, "done": done], status: done ? .completed : .pending)
        case .invoice(let id, let index):
            write(job, "setInvoicePieceDone", ["invoiceId": id, "index": index, "done": done], status: done ? .completed : .pending)
        case .stock(let id):
            write(job, "setStockJobStatus", ["jobId": id, "status": done ? KarigarJobStatus.completed.rawValue : KarigarJobStatus.pending.rawValue],
                  status: done ? .completed : .pending)
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
            write(job, "setPieceGiven", ["orderId": id, "index": index, "given": given], given: given)
        case .invoice(let id, let index):
            write(job, "setInvoicePieceGiven", ["invoiceId": id, "index": index, "given": given], given: given)
        case .stock(let id):
            write(job, "setStockJobGiven", ["jobId": id, "given": given], given: given)
        case nil:
            return
        }
    }

    private func setKarigar(_ job: WorkshopJob, _ karigarId: String) {
        switch WorkshopLogic.writeTarget(job) {
        case .order(let id, let index):
            write(job, "setPieceKarigar", ["orderId": id, "index": index, "karigarId": karigarId], karigarId: karigarId)
        case .invoice(let id, let index):
            write(job, "setInvoicePieceKarigar", ["invoiceId": id, "index": index, "karigarId": karigarId], karigarId: karigarId)
        case .stock, nil:
            // A stock job is written for its karigar; the web offers no reassigning it either.
            return
        }
    }

    private func setStatus(_ job: WorkshopJob, _ status: KarigarJobStatus) {
        guard case .stock(let id) = WorkshopLogic.writeTarget(job) else { return }
        write(job, "setStockJobStatus", ["jobId": id, "status": status.rawValue],
              status: status == .completed ? .completed : (status == .inProgress ? .inProgress : .pending))
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

/// Assign stock work asked for, with the karigar it goes to when one is in focus ("" for none).
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
            HStack(spacing: pt(20)) {
                ForEach(cells) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.label.uppercased()).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        Text(c.value).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(c.tint)
                    }
                }
            }
            .padding(.vertical, pt(2))
        }
    }
}

/// A piece's state in the three things a tap can change.
private struct JobSig: Equatable {
    var status: WorkshopJob.Status
    var given: Bool
    var karigarId: String
    init(_ job: WorkshopJob) { status = job.status; given = job.hasGiven; karigarId = job.karigarId }
}

/// A piece as the person left it (`to`), good while the shelf's copy still reads `from`.
private struct JobPatch {
    let from: JobSig
    let to: JobSig
    let toName: String?
}

#if os(macOS)
/// One column of the Mac's board: a karigar's bench, a stage, an urgency, or the benches with nothing on them.
private struct MacBenchColumn: Identifiable {
    let id: String
    let title: String
    let symbol: String
    var tone: Tone = .quiet
    var subtitle = ""
    var critical = 0
    var late = 0
    /// Opens his page.
    var karigarId: String?
    var jobs: [WorkshopJob] = []
    var showKarigar = false
    /// The karigars with nothing on the bench (the free column).
    var free: [Karigar] = []
}

// The Mac's workshop board: columns across the window (a karigar's bench each, or a stage each; the pieces keep every control
// the iPhone's card has, and its right-click menu), or a Table of every piece with the picked one's card in an inspector. The
// figures sit in a strip above; the focus, grouping, filters and "Assign stock work" are in the toolbar. The iPhone moves a
// piece with a menu, not a drag, so the Mac does too: assign a karigar, Given and Done are on each card and in its menu.
extension WorkshopBoard {
    func macBoard(_ snap: WorkshopSnapshot, _ live: [Karigar]) -> some View {
        let focused = snap.focused(focus)
        let busyIds = Set(snap.all.filter { !$0.isDone }.map { $0.karigarId })
        let choices = WorkshopChoices(karigars: live, busyIds: busyIds)
        return VStack(spacing: 0) {
            if orderId == nil {
                macSummary(snap)
                Divider()
            }
            Group {
                if grouping == .list {
                    macList(focused, choices: choices)
                } else {
                    macColumnsView(macColumns(snap, focused: focused, live: live), choices: choices)
                }
            }
            .overlay {
                if focused.isEmpty { emptyState(snap).allowsHitTesting(false) }
            }
        }
        .toolbar {
            if orderId == nil {
                ToolbarItem(placement: .principal) {
                    Picker("Layout", selection: Binding(
                        get: { grouping },
                        set: { g in Motion.run(reduce: reduceMotion) { grouping = g } }
                    )) {
                        Text("Karigars").tag(WorkshopGrouping.karigar)
                        Text("Stages").tag(WorkshopGrouping.stage)
                        Text("Pieces").tag(WorkshopGrouping.list)
                    }
                    .pickerStyle(.segmented)
                    .help("A column for each karigar or stage, or a table of every piece")
                }
                ToolbarItem(placement: .automatic) {
                    Picker("Show", selection: Binding(
                        get: { focus },
                        set: { f in Motion.run(reduce: reduceMotion) { focus = f } }
                    )) {
                        ForEach(WorkshopFocus.allCases) { f in
                            Text(f == .all ? focusTitle(f) : "\(focusTitle(f)) (\(snap.count(f)))").tag(f)
                        }
                    }
                    .help("All the work, or only what needs a hand")
                }
            }
        }
        .inspector(isPresented: Binding(
            get: { grouping == .list && macInspector && macPicked.count == 1 },
            set: { macInspector = $0 }
        )) {
            if grouping == .list, macPicked.count == 1, let id = macPicked.first, let job = focused.first(where: { $0.id == id }) {
                ScrollView {
                    jobRow(job, showKarigar: true, choices: choices).padding(16)
                }
                .inspectorColumnWidth(min: 300, ideal: 360, max: 460)
            }
        }
        .onChange(of: macPicked) { _, _ in macInspector = true }
    }

    // MARK: The strip

    private func macSummary(_ snap: WorkshopSnapshot) -> some View {
        let loads = WorkshopLogic.groupByKarigar(snap.bench)
        let grams = loads.reduce(0.0) { $0 + $1.totalWeightG }
        let value = loads.reduce(0.0) { $0 + $1.totalValue }
        let critical = snap.stats.critical
        let late = snap.stats.overdue - critical
        return HStack(alignment: .top, spacing: 10) {
            FigureTile(label: "All active pieces", value: "\(snap.stats.active)")
            FigureTile(label: "Benches working", value: "\(snap.stats.workers)")
            FigureTile(label: "Late \(WorkshopLogic.warnDays)d+", value: "\(late)", tint: late > 0 ? Tone.owed.color : Color.primary)
            FigureTile(label: "Critical \(WorkshopLogic.criticalDays)d+", value: "\(critical)", tint: critical > 0 ? Tone.late.color : Color.primary)
            FigureTile(label: "Metal out", value: grams > 0 ? WorkshopLogic.number(grams, digits: 1) + "g" : "\u{2014}")
            if session.isOwner {
                FigureTile(label: "Value out", value: value > 0 ? Money.pkrLac(value) : "\u{2014}")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    // MARK: The columns

    private func macColumns(_ snap: WorkshopSnapshot, focused: [WorkshopJob], live: [Karigar]) -> [MacBenchColumn] {
        func urgent(_ jobs: [WorkshopJob]) -> (Int, Int) {
            (jobs.filter { !$0.isDone && $0.urgency == .critical }.count, jobs.filter { !$0.isDone && $0.urgency == .warning }.count)
        }
        switch grouping {
        case .list:
            return []
        case .stage:
            return stages.map { (st: Stage) -> MacBenchColumn in
                let jobs = focused.filter { $0.status == st.status }
                let u = urgent(jobs)
                return MacBenchColumn(id: st.id, title: st.title, symbol: st.symbol, critical: u.0, late: u.1, jobs: jobs, showKarigar: true)
            }
        case .karigar:
            if !filter.karigarId.isEmpty && focus != .unassigned {
                // One karigar chosen: his bench by how long each piece has sat.
                let active = focused.filter { !$0.isDone }
                let byAge = { (a: WorkshopJob, b: WorkshopJob) in a.ageDays > b.ageDays }
                var out: [MacBenchColumn] = []
                let critical = active.filter { $0.urgency == .critical }.sorted(by: byAge)
                let late = active.filter { $0.urgency == .warning }.sorted(by: byAge)
                if !critical.isEmpty {
                    out.append(MacBenchColumn(id: "critical", title: "Critical", symbol: "flame", tone: .late,
                                              subtitle: "sitting \(WorkshopLogic.criticalDays)+ days", jobs: critical))
                }
                if !late.isEmpty {
                    out.append(MacBenchColumn(id: "late", title: "Late", symbol: "clock", tone: .owed,
                                              subtitle: "\(WorkshopLogic.warnDays)\u{2013}\(WorkshopLogic.criticalDays) days", jobs: late))
                }
                out.append(MacBenchColumn(id: "ontrack", title: "On track", symbol: "hammer",
                                          jobs: active.filter { $0.urgency == .ok }.sorted(by: byAge)))
                if filter.status == .all || filter.status == .completed {
                    out.append(MacBenchColumn(id: "done", title: "Completed", symbol: "checkmark.circle", jobs: focused.filter { $0.isDone }))
                }
                return out
            }
            var out = WorkshopLogic.groupByKarigar(focused).map { (load: WorkshopLoad) -> MacBenchColumn in
                MacBenchColumn(id: load.karigarId, title: load.isUnassigned ? "Unassigned" : load.karigarName,
                               symbol: load.isUnassigned ? "exclamationmark.triangle.fill" : "hammer",
                               tone: load.isUnassigned ? .owed : .house, subtitle: headerCounts(load),
                               critical: load.critical, late: load.late,
                               karigarId: load.isUnassigned ? nil : load.karigarId,
                               jobs: WorkshopLogic.byOrder(load.jobs))
            }
            if focus == .all && !filter.narrowed && filter.karigarId.isEmpty {
                let busyIds = Set(snap.bench.filter { !$0.isDone }.map { $0.karigarId })
                let idle = live.filter { !busyIds.contains($0.id) }
                if !idle.isEmpty {
                    out.append(MacBenchColumn(id: "free", title: "Free", symbol: "moon", subtitle: "Nothing on the bench: the next job can go here", free: idle))
                }
            }
            return out
        }
    }

    private func macColumnsView(_ columns: [MacBenchColumn], choices: WorkshopChoices) -> some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(columns) { (col: MacBenchColumn) in macColumn(col, choices: choices) }
            }
            .padding(16)
            .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    private func macColumn(_ col: MacBenchColumn, choices: WorkshopChoices) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Image(systemName: col.symbol)
                        .foregroundStyle(col.tone == .quiet ? Color.secondary : col.tone.color)
                    Text(col.title).font(.headline).lineLimit(1)
                    Text("\(col.free.isEmpty ? col.jobs.count : col.free.count)")
                        .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                    Spacer(minLength: 4)
                    WorkshopUrgencyBadges(critical: col.critical, late: col.late)
                    if let id = col.karigarId {
                        Button { opened = WorkshopPlace.karigar(id) } label: { Image(systemName: "person.crop.circle") }
                            .buttonStyle(.borderless)
                            .help("Open " + col.title)
                    }
                }
                if !col.subtitle.isEmpty {
                    Text(col.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            Divider()
            ScrollView {
                LazyVStack(spacing: 10) {
                    if !col.free.isEmpty {
                        ForEach(col.free) { (k: Karigar) in
                            Button { opened = WorkshopPlace.karigar(k.id) } label: {
                                Label(k.name, systemImage: "hammer").frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .ledgerCard(padding: 12)
                            .cardHover()
                        }
                    } else if col.jobs.isEmpty {
                        Text("Nothing here").font(.callout).foregroundStyle(.secondary).padding(.top, 12)
                    } else {
                        ForEach(col.jobs) { (job: WorkshopJob) in
                            jobRow(job, showKarigar: col.showKarigar, choices: choices)
                                .ledgerCard(padding: 12)
                        }
                    }
                }
                .padding(10)
            }
        }
        .frame(width: 360)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.secondary.opacity(0.07), in: .rect(cornerRadius: Radius.card, style: .continuous))
    }

    // MARK: The table

    private func macStage(_ job: WorkshopJob) -> String {
        if job.isDone { return "Completed" }
        if job.isUnassigned { return "Needs a karigar" }
        return job.hasGiven ? "On the bench" : "Ready to give"
    }

    private func macList(_ focused: [WorkshopJob], choices: WorkshopChoices) -> some View {
        let ordered = macSort.isEmpty ? focused : focused.sorted(using: macSort)
        return Table(ordered, selection: $macPicked, sortOrder: $macSort) {
            TableColumn("Piece", value: \.description) { (j: WorkshopJob) in Text(j.description).fontWeight(.medium).lineLimit(1) }
                .width(min: 180, ideal: 280)
            TableColumn("Order") { (j: WorkshopJob) in
                Text(j.invoiceId ?? j.orderId ?? "Stock work").monospacedDigit().foregroundStyle(.secondary)
            }
            .width(min: 90, ideal: 120)
            TableColumn("Customer") { (j: WorkshopJob) in Text(j.customerName ?? "").foregroundStyle(.secondary).lineLimit(1) }
                .width(min: 100, ideal: 160)
            TableColumn("Karigar", value: \.karigarName) { (j: WorkshopJob) in
                Text(j.isUnassigned ? "Unassigned" : j.karigarName)
                    .foregroundStyle(j.isUnassigned ? Tone.owed.color : Color.primary)
            }
            .width(min: 100, ideal: 140)
            TableColumn("Stage") { (j: WorkshopJob) in
                Text(macStage(j)).foregroundStyle(j.isDone ? Color.secondary : (j.isUnassigned || !j.hasGiven ? Tone.owed.color : Theme.accent))
            }
            .width(min: 100, ideal: 120)
            TableColumn("Age", value: \.ageDays) { (j: WorkshopJob) in
                HStack(spacing: 6) {
                    Text(j.isDone ? "" : "\(j.ageDays)d").monospacedDigit()
                    WorkshopAgeBadge(job: j)
                }
            }
            .width(min: 80, ideal: 100)
            TableColumn("Weight") { (j: WorkshopJob) in
                Text((j.weightG ?? 0) > 0 ? WorkshopLogic.number(j.weightG ?? 0, digits: 1) + "g" : "").monospacedDigit()
            }
            .width(min: 60, ideal: 80)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first, let job = focused.first(where: { $0.id == id }) {
                WorkshopJobRow(job: job, showKarigar: true, isOwner: session.isOwner, busy: busy.contains(job.id),
                               choices: choices, actions: actions).menuItems
                if let path = job.invoiceId.map({ "/invoices/" + WorkshopLogic.piece($0) }) ?? job.orderId.map({ "/orders/" + WorkshopLogic.piece($0) }) {
                    Button { openPlace?(Route(path: path)) } label: {
                        Label("Open in New Window", systemImage: "macwindow.badge.plus")
                    }
                }
            }
        } primaryAction: { ids in
            if ids.count == 1, let id = ids.first, let job = focused.first(where: { $0.id == id }),
               let path = job.invoiceId.map({ "/invoices/" + WorkshopLogic.piece($0) }) ?? job.orderId.map({ "/orders/" + WorkshopLogic.piece($0) }) {
                openPlace?(Route(path: path))
            }
        }
    }
}
#endif
