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
    /// The board or the table, remembered on this Mac.
    @AppStorage(MacWorkshopView.key) private var macViewRaw = MacWorkshopView.board.rawValue
    /// What the pieces and the board come to, worked out once per change of the books, the filters and the sort.
    @State private var macJobsMemo = Memo<[WorkshopJob]>()
    @State private var macDataMemo = Memo<MacWorkshopData>()
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
                #if os(macOS)
                screen.macSearchable(text: $filter.query, prompt: "Search Workshop")
                #else
                screen.searchable(text: $filter.query, prompt: "Item, karigar, customer, order")
                #endif
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
        #if !os(macOS)
        // The Mac's toolbar is the board's own (Board / Table, Show, Filter, Give To, Mark Done): not the phone's menus too.
        .toolbar { if orderId == nil { boardToolbar } }
        #endif
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
        #if os(macOS)
        macContent
        #else
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
        ToolbarItem(placement: .trailingAction) { filterMenu }
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
// The Mac's Workshop (docs/features/mac-design.md, "Workshop"): the board (a column for each karigar, Needs a karigar, Free and
// Done, compact rows, a row dragged onto a column is given to that karigar or marked done) or a table of every piece (the
// karigar a pop-up cell, Done a checkbox cell), the picked piece in the inspector, a summary bar at the foot, and every
// action declared once for the Job menu, the toolbar, the right-click menu and the inspector. The writes are the screen's
// own (setKarigar, setDone, setGiven, openDetails, askDelete): this is arrangement only.
extension WorkshopBoard {
    var macContent: some View {
        let data = macData()
        return VStack(spacing: 0) {
            if macTable { macTableView(data) } else { macBoardView(data) }
        }
        .overlay {
            if macTable && data.focused.isEmpty { macEmpty(data.snap).allowsHitTesting(false) }
        }
        .modifier(MacWorkshopSummary(parts: orderId == nil ? macSummary(data) : []))
        .toolbar { macToolbar(data) }
        .macInspector { macInspectorPanel(data) }
        .macRecordMenu(MacRecordMenu(title: "Job", groups: macJobGroups(macPickedJobs(data), data.live, flatGive: true)))
    }

    /// The table, for the board's "Give out" mode (one order's pieces) and when the Table view is chosen.
    private var macTable: Bool { orderId != nil || macViewRaw == MacWorkshopView.table.rawValue }

    // MARK: The pieces, worked out once

    /// What the patches say, as a number: when a piece is moved the board redraws from the books and the patch together.
    private var macPatchStamp: Int {
        patches.map { "\($0.key)|\($0.value.to.status)|\($0.value.to.given)|\($0.value.to.karigarId)" }
            .sorted().joined(separator: ",").hashValue
    }

    private func macData() -> MacWorkshopData {
        let jobsKey: [Int] = [book.orders.revision, book.invoices.revision, book.karigars.revision, book.karigarJobs.revision, macPatchStamp]
        let jobs: [WorkshopJob] = macJobsMemo(jobsKey) {
            let live = workshopLive(book.karigars.items)
            let built = WorkshopLogic.buildJobs(
                orders: book.orders.items,
                karigarJobs: book.karigarJobs.items,
                karigars: live,
                invoices: book.invoices.items
            )
            let shown = patches.isEmpty ? built : built.map { patched($0) }
            return orderId.map { id in shown.filter { $0.orderId == id } } ?? shown
        }
        let stamp: Int = [filter.query, filter.status.rawValue, filter.type.rawValue, filter.takenBy, filter.karigarId]
            .joined(separator: "\u{1}").hashValue
        let key: [Int] = jobsKey + [stamp, focus.hashValue, macViewRaw.hashValue, macSort.hashValue]
        return macDataMemo(key) {
            let live = workshopLive(book.karigars.items)
            let snap = WorkshopSnapshot(all: jobs, filter: filter)
            let focused = snap.focused(focus)
            let loads = WorkshopLogic.groupByKarigar(snap.bench)
            var byId: [String: WorkshopJob] = [:]
            for j in jobs { byId[j.id] = j }
            let columns = macTable ? [] : macColumns(snap, focused: focused, live: live)
            return MacWorkshopData(
                live: live, snap: snap, focused: focused,
                sorted: macSort.isEmpty ? focused : focused.sorted(using: macSort),
                byId: byId, columns: columns,
                counts: Dictionary(uniqueKeysWithValues: WorkshopFocus.allCases.map { ($0, snap.count($0)) }),
                grams: loads.reduce(0.0) { $0 + $1.totalWeightG },
                value: loads.reduce(0.0) { $0 + $1.totalValue }
            )
        }
    }

    /// A column for each karigar with work (the one most at risk first), Needs a karigar before them, the karigars with
    /// nothing on the bench together as Free, and Done last.
    private func macColumns(_ snap: WorkshopSnapshot, focused: [WorkshopJob], live: [Karigar]) -> [MacWorkshopColumn] {
        var needs = MacWorkshopColumn(id: "needs", title: "Needs a karigar", kind: .needs)
        var people: [MacWorkshopColumn] = []
        for load in WorkshopLogic.groupByKarigar(focused.filter { !$0.isDone }) {
            if load.isUnassigned {
                needs.jobs = WorkshopLogic.byOrder(load.jobs)
                needs.critical = load.critical
                needs.late = load.late
            } else {
                people.append(MacWorkshopColumn(id: load.karigarId, title: load.karigarName, kind: .karigar, karigarId: load.karigarId,
                                                subtitle: headerCounts(load), critical: load.critical, late: load.late,
                                                jobs: WorkshopLogic.byOrder(load.jobs)))
            }
        }
        var out: [MacWorkshopColumn] = [needs]
        out.append(contentsOf: people)
        if focus == .all && !filter.narrowed && filter.karigarId.isEmpty {
            let busyIds = Set(snap.bench.filter { !$0.isDone }.map { $0.karigarId })
            let idle = live.filter { !busyIds.contains($0.id) }
            if !idle.isEmpty {
                out.append(MacWorkshopColumn(id: "free", title: "Free", kind: .free, subtitle: "Nothing on the bench", free: idle))
            }
        }
        out.append(MacWorkshopColumn(id: "done", title: "Done", kind: .done, jobs: focused.filter { $0.isDone }))
        return out
    }

    private func macPickedJobs(_ data: MacWorkshopData) -> [WorkshopJob] {
        macPicked.compactMap { data.byId[$0] }.sorted { $0.id < $1.id }
    }

    private func macSummary(_ data: MacWorkshopData) -> [String] {
        let picked = macPickedJobs(data)
        if !picked.isEmpty {
            var parts = ["\(picked.count) selected"]
            let grams = picked.reduce(0.0) { $0 + ($1.weightG ?? 0) }
            if grams > 0 { parts.append(WorkshopLogic.number(grams, digits: 1) + "g") }
            return parts
        }
        let stats = data.snap.stats
        var parts = ["\(stats.active) active"]
        if stats.overdue > 0 { parts.append("\(stats.overdue) late") }
        if stats.unassigned > 0 { parts.append("\(stats.unassigned) need a karigar") }
        if data.grams > 0 { parts.append(WorkshopLogic.number(data.grams, digits: 1) + "g of metal out") }
        if session.isOwner && data.value > 0 { parts.append(Money.pkrLac(data.value) + " out") }
        return parts
    }

    // MARK: The board

    private func macBoardView(_ data: MacWorkshopData) -> some View {
        MacWorkshopBoardView(
            columns: data.columns,
            picked: $macPicked,
            give: { (job: WorkshopJob) in macGiveActions(macClicked(job, data), data.live, flat: false) },
            groups: { (job: WorkshopJob) in macJobGroups(macClicked(job, data), data.live, flatGive: false) },
            drop: { (ids: [String], kind: MacWorkshopColumn.Kind, karigarId: String?) in macDrop(ids, kind, karigarId, data) },
            open: { (job: WorkshopJob) in macOpenJob(job) },
            openKarigar: { (id: String) in macOpen(WorkshopPlace.karigar(id)) }
        )
    }

    /// The pieces a right-click on `job` is about: the pieces picked when it is one of them, else it alone.
    private func macClicked(_ job: WorkshopJob, _ data: MacWorkshopData) -> [WorkshopJob] {
        macPicked.contains(job.id) ? macPickedJobs(data) : [job]
    }

    /// Pieces dropped on a column: given to its karigar, taken off a karigar, or marked done. A stock job keeps the karigar
    /// it was written for (the web offers no reassigning it either), so it only goes to Done.
    private func macDrop(_ ids: [String], _ kind: MacWorkshopColumn.Kind, _ karigarId: String?, _ data: MacWorkshopData) -> Bool {
        guard session.isOwner else {
            failure = "Only an owner can move work."
            return false
        }
        var moved = false
        var refused = false
        for id in ids {
            guard let job = data.byId[id] else { continue }
            switch kind {
            case .done:
                if !job.isDone && macCanWrite(job) {
                    setDone(job, true)
                    moved = true
                }
            case .needs:
                if job.isUnassigned { continue }
                if macCanAssign(job) {
                    setKarigar(job, "none")
                    moved = true
                } else {
                    refused = true
                }
            case .karigar, .free:
                guard let target = karigarId, job.karigarId != target else { continue }
                if macCanAssign(job) {
                    setKarigar(job, target)
                    moved = true
                } else {
                    refused = true
                }
            }
        }
        if refused { failure = "A stock job stays with the karigar it was written for." }
        return moved
    }

    // MARK: The table

    /// The pieces as the iPhone's rows: Done, the piece over its order and customer, the karigar, the stage and the age.
    private func macTableView(_ data: MacWorkshopData) -> some View {
        List(selection: $macPicked) {
            ForEach(data.sorted) { (j: WorkshopJob) in
                macJobListRow(j, data.live)
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .contextMenu(forSelectionType: String.self) { ids in
            let jobs = ids.compactMap { data.byId[$0] }
            if !jobs.isEmpty {
                MacWorkshopJobMenu(give: { macGiveActions(jobs, data.live, flat: false) },
                                   groups: { macJobGroups(jobs, data.live, flatGive: false) })
            }
        } primaryAction: { ids in
            if ids.count == 1, let id = ids.first, let job = data.byId[id] { macOpenJob(job) }
        }
    }

    private func macJobListRow(_ j: WorkshopJob, _ live: [Karigar]) -> some View {
        HStack(spacing: 10) {
            macDoneCell(j)
            VStack(alignment: .leading, spacing: 2) {
                macPieceCell(j)
                Text(macReference(j)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            macKarigarCell(j, live).frame(maxWidth: 170, alignment: .trailing)
            Pill(macStageWords(j), tone: macStageTone(j))
            WorkshopAgeBadge(job: j)
        }
        .padding(.vertical, 3)
        .tag(j.id)
        .houseRows()
    }

    /// The piece, with its weight in grey beside it.
    /// The Sort by pick: the iPhone's order (the board's own) when none is set.
    private var macSortChoice: Binding<Int> {
        Binding(
            get: {
                guard let first = macSort.first else { return 0 }
                let k: AnyKeyPath = first.keyPath
                if k == (\WorkshopJob.description as AnyKeyPath) { return 1 }
                if k == (\WorkshopJob.karigarName as AnyKeyPath) { return 2 }
                return 3
            },
            set: { (n: Int) in
                switch n {
                case 1: macSort = [KeyPathComparator(\WorkshopJob.description)]
                case 2: macSort = [KeyPathComparator(\WorkshopJob.karigarName)]
                case 3: macSort = [KeyPathComparator(\WorkshopJob.ageDays, order: .reverse)]
                default: macSort = []
                }
            }
        )
    }

    private func macPieceCell(_ j: WorkshopJob) -> some View {
        HStack(spacing: 6) {
            Text(j.description).fontWeight(.medium).lineLimit(1)
            if (j.weightG ?? 0) > 0 {
                Text(WorkshopLogic.number(j.weightG ?? 0, digits: 1) + "g")
                    .monospacedDigit().lineLimit(1).foregroundStyle(.secondary).layoutPriority(1)
            }
        }
    }

    /// Done as a checkbox, where the ERP can write it (an order's piece, a sold piece, a stock job).
    private func macDoneCell(_ j: WorkshopJob) -> some View {
        Toggle("Done", isOn: Binding(get: { j.isDone }, set: { on in setDone(j, on) }))
            .labelsHidden()
            .toggleStyle(.checkbox)
            .disabled(!macCanWrite(j) || busy.contains(j.id))
            .help(j.isDone ? "Done. Click to put it back on the bench." : "Mark done")
    }

    /// The karigar as a pop-up where the piece can be given to someone else; a stock job's is fixed.
    @ViewBuilder
    private func macKarigarCell(_ j: WorkshopJob, _ live: [Karigar]) -> some View {
        if macCanAssign(j) && !j.isDone {
            Picker("Karigar", selection: Binding(
                get: { j.karigarId },
                set: { id in
                    if id != j.karigarId { setKarigar(j, id == WorkshopLogic.unassigned ? "none" : id) }
                }
            )) {
                Text("Needs a karigar").tag(WorkshopLogic.unassigned)
                if !j.isUnassigned && !live.contains(where: { $0.id == j.karigarId }) {
                    Text(j.karigarName).tag(j.karigarId)
                }
                ForEach(live) { (k: Karigar) in Text(k.name).tag(k.id) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
        } else {
            Text(j.isUnassigned ? "Needs a karigar" : j.karigarName)
                .foregroundStyle(j.isUnassigned ? Tone.owed.color : Color.primary)
        }
    }

    private func macStageWords(_ j: WorkshopJob) -> String {
        if j.isDone { return "Completed" }
        if j.isUnassigned { return "Needs a karigar" }
        return j.hasGiven ? "On the bench" : "Ready to give"
    }

    private func macStageTone(_ j: WorkshopJob) -> Tone {
        if j.isDone { return .quiet }
        if j.isUnassigned { return .owed }
        return j.hasGiven ? .working : .owed
    }

    private func macAgeColor(_ j: WorkshopJob) -> Color {
        if j.isDone { return Color.secondary }
        switch j.urgency {
        case .critical: return Tone.late.color
        case .warning: return Tone.owed.color
        case .ok: return Color.primary
        }
    }

    // MARK: The toolbar

    @ToolbarContentBuilder
    private func macToolbar(_ data: MacWorkshopData) -> some ToolbarContent {
        // The view switch, then New (stock work for a karigar) and the one filter. The picked pieces' Give To and Done are
        // the inspector's, the Job menu's and the right-click menu's, never the toolbar's. The one order's "Give out" page
        // has none: its pieces are given in the table.
        if orderId == nil {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $macViewRaw) {
                    ForEach(MacWorkshopView.allCases) { (v: MacWorkshopView) in
                        Label(v.title, systemImage: v.symbol).tag(v.rawValue)
                    }
                }
                .pickerStyle(.segmented)
                .help("A column for each karigar, or a table of every piece")
            }
            ToolbarItemGroup(placement: .automatic) {
                let assign = macAssignStockAction(macPickedJobs(data))
                Button(action: assign.perform) { Label("Assign Stock Work", systemImage: "plus") }
                    .disabled(!assign.enabled)
                    .help(assign.help)
                macFilterMenu(data)
            }
        }
    }

    /// One Filter menu: what to show, and the people, kind of work, karigar and status, each an inline pick.
    private func macFilterMenu(_ data: MacWorkshopData) -> some View {
        let people = session.shop.takenBy
        let on = filter.menuCount > 0 || focus != .all
        return Menu {
            Section("Show") {
                Picker("Show", selection: $focus) {
                    ForEach(WorkshopFocus.allCases) { (f: WorkshopFocus) in
                        Text(f == .all ? focusTitle(f) : "\(focusTitle(f)) (\(data.counts[f] ?? 0))").tag(f)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            if !people.isEmpty {
                Section("Taken by") {
                    Picker("Taken by", selection: $filter.takenBy) {
                        Text("Anyone").tag("")
                        ForEach(people, id: \.self) { (p: String) in Text(p).tag(p) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
            }
            Section("Work") {
                Picker("Work", selection: $filter.type) {
                    ForEach(WorkshopTypeFilter.allCases) { (t: WorkshopTypeFilter) in Text(t.title).tag(t) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Karigar") {
                Picker("Karigar", selection: $filter.karigarId) {
                    Text("Everyone").tag("")
                    ForEach(data.live) { (k: Karigar) in Text(k.name).tag(k.id) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            if macTable {
                Section("Sort by") {
                    Picker("Sort by", selection: macSortChoice) {
                        Text("As the board has it").tag(0)
                        Text("Piece").tag(1)
                        Text("Karigar").tag(2)
                        Text("Age").tag(3)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
            }
            Section("Status") {
                Picker("Status", selection: $filter.status) {
                    ForEach(WorkshopStatusFilter.allCases) { (s: WorkshopStatusFilter) in Text(s.title).tag(s) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            if on {
                Divider()
                Button("Reset Filters", systemImage: "arrow.counterclockwise") {
                    filter = WorkshopFilter()
                    focus = .all
                }
            }
        } label: {
            Label("Filter", systemImage: on ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .help("What to show, taken by, kind of work, karigar and status")
    }

    /// The Mac's empty table: a line saying what is missing and how to make some.
    @ViewBuilder
    private func macEmpty(_ snap: WorkshopSnapshot) -> some View {
        let searching = !filter.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        switch focus {
        case .unassigned:
            ContentUnavailableView("All Work Is Assigned", systemImage: "checkmark.circle", description: Text("No work is awaiting a karigar."))
        case .attention:
            ContentUnavailableView("Nothing Needs Attention", systemImage: "checkmark.circle", description: Text("No work is overdue or without a karigar."))
        case .notGiven:
            ContentUnavailableView("Everything Is Given", systemImage: "checkmark.circle", description: Text("No piece with a karigar is still in the safe."))
        case .all:
            if searching {
                ContentUnavailableView.search(text: filter.query)
            } else if !snap.all.isEmpty {
                ContentUnavailableView("No Jobs Match", systemImage: "hammer", description: Text("Change the filters, or choose Reset Filters."))
            } else {
                ContentUnavailableView("No Pending Work", systemImage: "hammer",
                                       description: Text("Give an order's piece to a karigar, or assign stock work with \u{2303}\u{2318}N."))
            }
        }
    }

    // MARK: The actions, declared once

    private func macCanWrite(_ job: WorkshopJob) -> Bool {
        session.isOwner && WorkshopLogic.writeTarget(job) != nil
    }

    /// An order's piece or a sold piece can be given to another karigar; a stock job keeps the one it was written for.
    private func macCanAssign(_ job: WorkshopJob) -> Bool {
        guard session.isOwner, let target = WorkshopLogic.writeTarget(job) else { return false }
        if case .stock = target { return false }
        return true
    }

    private func macDoneAction(_ jobs: [WorkshopJob]) -> MacAction {
        let writable = !jobs.isEmpty && jobs.allSatisfy { macCanWrite($0) }
        let allDone = !jobs.isEmpty && jobs.allSatisfy { $0.isDone }
        return MacAction(allDone ? "Mark Not Done" : "Mark Done", symbol: allDone ? "circle" : "checkmark.circle",
                         shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: writable, isDefault: true) {
            for j in jobs { setDone(j, !allDone) }
        }
    }

    private func macAssignStockAction(_ jobs: [WorkshopJob]) -> MacAction {
        var preset = filter.karigarId
        if jobs.count == 1, let j = jobs.first, !j.isUnassigned { preset = j.karigarId }
        let karigarId = preset
        return MacAction("Assign Stock Work\u{2026}", symbol: "plus.circle", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                         enabled: session.isOwner) { assigning = WorkshopStockJobAsk(karigarId: karigarId) }
    }

    /// The karigars the pieces can be given to (and taking them off). "Give to Ustad Demo" in the menu bar, just the name
    /// in the right-click menu's Give To submenu.
    private func macGiveActions(_ jobs: [WorkshopJob], _ live: [Karigar], flat: Bool) -> [MacAction] {
        let can = !jobs.isEmpty && jobs.allSatisfy { macCanAssign($0) }
        let only: String? = jobs.count == 1 ? jobs.first?.karigarId : nil
        var out: [MacAction] = []
        for k in live {
            let id = k.id
            out.append(MacAction((flat ? "Give to " : "") + k.name, symbol: only == id ? "checkmark" : nil, enabled: can, id: "give:" + id) {
                for j in jobs where j.karigarId != id { setKarigar(j, id) }
            })
        }
        out.append(MacAction(flat ? "Take Off the Karigar" : "No Karigar", symbol: "person.badge.minus", enabled: can, id: "give:none") {
            for j in jobs where !j.isUnassigned { setKarigar(j, "none") }
        })
        return out
    }

    /// Every action of a piece, for the Job menu (`flatGive`: the karigars listed as items) and the right-click menu (Give To
    /// is its own submenu there).
    private func macJobGroups(_ jobs: [WorkshopJob], _ live: [Karigar], flatGive: Bool) -> [[MacAction]] {
        let single: WorkshopJob? = jobs.count == 1 ? jobs.first : nil
        let writable = !jobs.isEmpty && jobs.allSatisfy { macCanWrite($0) }
        let givable = writable && jobs.allSatisfy { !$0.isDone && !$0.isUnassigned }
        let allGiven = !jobs.isEmpty && jobs.allSatisfy { $0.hasGiven }
        let inStock: Bool = {
            guard let j = single, session.isOwner, let target = WorkshopLogic.writeTarget(j) else { return false }
            if case .stock = target { return true }
            return false
        }()
        var groups: [[MacAction]] = []
        if flatGive { groups.append(macGiveActions(jobs, live, flat: true)) }
        groups.append([
            macDoneAction(jobs),
            MacAction(allGiven ? "Mark Not Given" : "Mark Given", symbol: "shippingbox", enabled: givable) {
                for j in jobs { setGiven(j, !allGiven) }
            },
        ])
        groups.append([
            MacAction("Making Details\u{2026}", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command),
                      enabled: single != nil && writable) { if let j = single { openDetails(j) } },
            MacAction(single?.invoiceId != nil ? "Open Invoice" : "Open Order", symbol: "doc.text",
                      enabled: single.map { $0.invoiceId != nil || $0.orderId != nil } ?? false) { if let j = single { macOpenJob(j) } },
            MacAction("Open Karigar", symbol: "hammer",
                      enabled: single.map { !$0.isUnassigned } ?? false) {
                if let j = single { macOpen(WorkshopPlace.karigar(j.karigarId)) }
            },
        ])
        groups.append([
            macAssignStockAction(jobs),
            MacAction("Delete Job\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command), role: .destructive,
                      enabled: inStock) { if let j = single { askDelete(j) } },
        ])
        return groups
    }

    // MARK: Opening

    /// A place opens in a window of its own where the window can; otherwise in this one, as before.
    private func macOpen(_ place: WorkshopPlace) {
        if let openPlace { openPlace(Route(path: place.path)) } else { opened = place }
    }

    /// Return and a double-click: the order (or the invoice) the piece is on; stock work has none, so its karigar.
    private func macOpenJob(_ job: WorkshopJob) {
        if let inv = job.invoiceId {
            macOpen(WorkshopPlace(path: "/invoices/" + WorkshopLogic.piece(inv)))
        } else if let ord = job.orderId {
            macOpen(WorkshopPlace.order(ord))
        } else if !job.isUnassigned {
            macOpen(WorkshopPlace.karigar(job.karigarId))
        }
    }

    // MARK: The inspector

    @ViewBuilder
    private func macInspectorPanel(_ data: MacWorkshopData) -> some View {
        let jobs = macPickedJobs(data)
        if jobs.count == 1, let job = jobs.first {
            macJobInspector(job, data)
        } else if jobs.isEmpty {
            MacInspectorEmpty(title: "No Piece Selected", detail: "Pick a piece to see who has it and what it needs.")
        } else {
            macManyInspector(jobs, data)
        }
    }

    private func macJobInspector(_ job: WorkshopJob, _ data: MacWorkshopData) -> some View {
        let jobs = [job]
        let writable = macCanWrite(job)
        return MacWorkPage {
            MacWorkHead(
                title: job.description,
                subtitle: macReference(job),
                pill: macStageWords(job),
                pillTone: macStageTone(job),
                figure: job.isDone ? nil : MacHeadline("With the shop for", job.ageDays == 1 ? "1 day" : "\(job.ageDays) days", tone: macAgeTone(job))
            ) {
                Monogram(name: job.customerName ?? "", size: Monogram.Size.hero)
            }
            MacActionButtons(actions: [macDoneAction(jobs)])
            MacWorkCard("Who has it") {
                macKarigarRow(job, data.live)
                if writable && !job.isDone && !job.isUnassigned {
                    Toggle(job.hasGiven ? "Given " + ShopDate.say(job.givenAt) : "Given to the karigar", isOn: Binding(
                        get: { job.hasGiven },
                        set: { on in setGiven(job, on) }
                    ))
                    .disabled(busy.contains(job.id))
                }
            }
            MacWorkCard("Making") { macMakingRows(job) }
            if writable {
                MacWorkCard("") {
                    HStack(spacing: 8) {
                        Button("Making Details\u{2026}") { openDetails(job) }
                        if job.source == .manual {
                            Button("Delete Job\u{2026}", role: .destructive) { askDelete(job) }
                        }
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private func macManyInspector(_ jobs: [WorkshopJob], _ data: MacWorkshopData) -> some View {
        let grams = jobs.reduce(0.0) { $0 + ($1.weightG ?? 0) }
        return MacWorkPage {
            MacWorkHead(
                title: "\(jobs.count) Pieces",
                subtitle: grams > 0 ? WorkshopLogic.number(grams, digits: 1) + "g in all" : nil
            ) {
                Image(systemName: "square.stack.3d.up").font(.title2).foregroundStyle(Theme.accent)
            }
            MacActionButtons(actions: [macDoneAction(jobs)])
            MacWorkCard("Pieces", count: jobs.count) {
                ForEach(jobs.prefix(40)) { (j: WorkshopJob) in
                    MacWorkFact(j.description, j.isUnassigned ? "Needs a karigar" : j.karigarName)
                }
            }
        }
    }

    private func macReference(_ job: WorkshopJob) -> String {
        guard let place = job.invoiceId ?? job.orderId else { return "Stock work" }
        let who = (job.customerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return who.isEmpty ? place : place + " \u{00B7} " + who
    }

    private func macAgeTone(_ job: WorkshopJob) -> Tone {
        switch job.urgency {
        case .critical: return .late
        case .warning: return .owed
        case .ok: return .quiet
        }
    }

    @ViewBuilder
    private func macKarigarRow(_ job: WorkshopJob, _ live: [Karigar]) -> some View {
        if macCanAssign(job) && !job.isDone {
            Picker("Karigar", selection: Binding(
                get: { job.karigarId },
                set: { id in
                    if id != job.karigarId { setKarigar(job, id == WorkshopLogic.unassigned ? "none" : id) }
                }
            )) {
                Text("Needs a karigar").tag(WorkshopLogic.unassigned)
                if !job.isUnassigned && !live.contains(where: { $0.id == job.karigarId }) {
                    Text(job.karigarName).tag(job.karigarId)
                }
                ForEach(live) { (k: Karigar) in Text(k.name).tag(k.id) }
            }
            .pickerStyle(.menu)
            .disabled(busy.contains(job.id))
        } else {
            MacWorkFact("Karigar", job.isUnassigned ? "Needs a karigar" : job.karigarName, tone: job.isUnassigned ? .owed : .quiet)
        }
    }

    /// The making details the karigar sees: what it is, its size, weight, finish, and the instructions.
    @ViewBuilder
    private func macMakingRows(_ job: WorkshopJob) -> some View {
        if let c = job.category, !c.isEmpty { MacWorkFact("Kind", c) }
        if let s = job.size, !s.isEmpty { MacWorkFact("Size", s) }
        if let w = job.weightG, w > 0 { MacWorkFact("Weight", WorkshopLogic.grams(w)) }
        if let k = job.karat, !k.isEmpty { MacWorkFact("Karat", k.uppercased()) }
        if let p = job.plating, !p.isEmpty { MacWorkFact("Finish", p) }
        if let r = job.referenceSku, !r.isEmpty { MacWorkFact("Reference", r) }
        if let by = job.takenBy, !by.isEmpty { MacWorkFact("Taken by", by) }
        if let notes = job.notes, !notes.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Instructions").font(.callout).foregroundStyle(.secondary)
                Text(notes).textSelection(.enabled)
            }
        }
    }
}

/// The summary bar at the foot of the Workshop, or nothing for the one order's "Give out" page.
private struct MacWorkshopSummary: ViewModifier {
    let parts: [String]

    func body(content: Content) -> some View {
        if parts.isEmpty { content } else { content.macSummaryBar(parts) }
    }
}
#endif
