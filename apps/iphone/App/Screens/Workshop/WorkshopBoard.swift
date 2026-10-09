import SwiftUI
import ERPCore

/// The Workshop board (src/app/workshop/page.tsx): every piece on the bench, by karigar or by stage, what is
/// overdue, what has nobody on it, what has not left the shop. Pieces come from orders, from stock jobs and from
/// invoices (a Shopify sale is an invoice, and any invoice line handed to a karigar). The three things an owner does
/// to an order's piece (pick the karigar, tick it Given, tick it Done) are writes through the ERP; the same on an
/// invoice's piece is the ERP's page for now.
struct WorkshopBoard: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var filter: WorkshopFilter
    @State private var focus: WorkshopFocus = .all
    /// The list is where the web opens (workshop/page.tsx `view`).
    @State private var grouping: WorkshopGrouping = .list
    @State private var showFree = false
    /// Taken by starts once, on whoever is signed in (lib/people.ts), unless a link asked for a whole bench.
    @State private var seeded = false
    private let asksForWholeBench: Bool
    /// Pieces with a write in flight.
    @State private var busy: Set<String> = []
    @State private var failure: String?
    @State private var opened: WorkshopPlace?

    /// `?karigar=<id>` (the karigar page's "On his bench") opens on his whole bench.
    init(path: String) {
        var f = WorkshopFilter()
        f.karigarId = WorkshopLogic.queryValue("karigar", in: path) ?? ""
        asksForWholeBench = !f.karigarId.isEmpty
        _filter = State(initialValue: f)
    }

    var body: some View {
        ShelfState(loaded: loaded, error: firstError, offline: book.orders.offline) {
            content
        }
        .navigationTitle("Workshop")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $filter.query, prompt: "Item, karigar, customer, order")
        .toolbar { boardToolbar }
        .workshopPlaceDestination($opened)
        .workshopFailureAlert($failure)
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
        filter.takenBy = session.shop.person ?? ""
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
        let all = WorkshopLogic.buildJobs(
            orders: book.orders.items,
            karigarJobs: book.karigarJobs.items,
            karigars: live,
            invoices: book.invoices.items
        )
        let snap = WorkshopSnapshot(all: all, filter: filter)
        board(snap, live)
    }

    private func board(_ snap: WorkshopSnapshot, _ live: [Karigar]) -> some View {
        let focused = snap.focused(focus)
        let busyIds = Set(snap.all.filter { !$0.isDone }.map { $0.karigarId })
        let choices = WorkshopChoices(karigars: live, busyIds: busyIds)
        return List {
            layout(snap, focused: focused, live: live, choices: choices)
        }
        .listStyle(.insetGrouped)
        .overlay {
            if focused.isEmpty { emptyState(snap) }
        }
        .safeAreaBar(edge: .top, spacing: 0) {
            controlBar(snap)
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

    /// The whole bench in six figures: the numbers keep showing everyone while one karigar is focused.
    private func glanceSection(_ loads: [WorkshopLoad]) -> some View {
        let active = loads.reduce(0) { $0 + $1.active }
        let late = loads.reduce(0) { $0 + $1.late }
        let critical = loads.reduce(0) { $0 + $1.critical }
        let grams = loads.reduce(0.0) { $0 + $1.totalWeightG }
        let value = loads.reduce(0.0) { $0 + $1.totalValue }
        let working = loads.filter { !$0.isUnassigned && $0.active > 0 }.count
        let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        return Section {
            LazyVGrid(columns: columns, spacing: 10) {
                FigureTile(label: "Pieces out", value: "\(active)")
                FigureTile(label: "Benches working", value: "\(working)")
                FigureTile(label: "Late \(WorkshopLogic.warnDays)d+", value: "\(late)", tint: late > 0 ? Color.orange : Color.primary)
                FigureTile(label: "Critical \(WorkshopLogic.criticalDays)d+", value: "\(critical)", tint: critical > 0 ? Color.red : Color.primary)
                FigureTile(label: "Metal out", value: grams > 0 ? WorkshopLogic.number(grams, digits: 1) + "g" : "—")
                if session.isOwner {
                    FigureTile(label: "Value out", value: value > 0 ? Money.pkrLac(value) : "—")
                }
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private func karigarSection(_ load: WorkshopLoad, choices: WorkshopChoices) -> some View {
        Section {
            ForEach(WorkshopLogic.byOrder(load.jobs)) { job in
                jobRow(job, showKarigar: false, choices: choices)
            }
        } header: {
            karigarHeader(load)
        }
    }

    private func karigarHeader(_ load: WorkshopLoad) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Image(systemName: load.isUnassigned ? "exclamationmark.triangle.fill" : "hammer")
                        .foregroundStyle(load.isUnassigned ? Color.red : Color.accentColor)
                    Text(load.isUnassigned ? "Unassigned" : load.karigarName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(load.isUnassigned ? Color.red : Color.primary)
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
            urgencySection("Critical", hint: "sitting \(WorkshopLogic.criticalDays)+ days", tone: Color.red, jobs: critical, choices: choices)
            urgencySection("Late", hint: "\(WorkshopLogic.warnDays)–\(WorkshopLogic.criticalDays) days", tone: Color.orange, jobs: late, choices: choices)
            urgencySection("On track", hint: "", tone: Color.primary, jobs: onTrack, choices: choices)
            if filter.status == .all || filter.status == .completed {
                urgencySection("Completed", hint: "", tone: Color.secondary, jobs: done, choices: choices)
            }
        }
    }

    private func focusedSummary(_ load: WorkshopLoad, orders: Int) -> some View {
        Section {
            Button { opened = WorkshopPlace.karigar(load.karigarId) } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(load.isUnassigned ? "Unassigned work" : load.karigarName).font(.title3.weight(.semibold))
                        Text(focusedSentence(load, orders: orders)).font(.subheadline).foregroundStyle(.secondary)
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

    private func focusedSentence(_ load: WorkshopLoad, orders: Int) -> String {
        var s = "\(load.active) active job\(load.active == 1 ? "" : "s")"
        if orders > 0 { s += " across \(orders) order\(orders == 1 ? "" : "s")" }
        if load.oldestActiveDays > 0 { s += " · oldest \(load.oldestActiveDays) days" }
        return s
    }

    @ViewBuilder
    private func urgencySection(_ title: String, hint: String, tone: Color, jobs: [WorkshopJob], choices: WorkshopChoices) -> some View {
        if !jobs.isEmpty {
            Section {
                ForEach(WorkshopLogic.byOrder(jobs)) { job in
                    jobRow(job, showKarigar: false, choices: choices)
                }
            } header: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(tone)
                    if !hint.isEmpty { Text(hint).font(.caption2).foregroundStyle(.secondary) }
                    Spacer(minLength: 8)
                    Text("\(jobs.count)").font(.caption).foregroundStyle(.secondary)
                }
                .textCase(nil)
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
                    ForEach(jobs) { job in
                        jobRow(job, showKarigar: true, choices: choices)
                    }
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
                ForEach(focused) { job in
                    jobRow(job, showKarigar: true, choices: choices)
                }
            }
        }
    }

    // MARK: A piece

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
            open: { place in opened = place }
        )
    }

    // MARK: The controls above the list

    private func controlBar(_ snap: WorkshopSnapshot) -> some View {
        VStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(WorkshopFocus.allCases) { f in
                            chip(f, count: snap.count(f))
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            Picker("Group by", selection: $grouping) {
                ForEach(WorkshopGrouping.allCases) { g in
                    Text(g.title).tag(g)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            Text(summaryLine(snap.stats))
                .font(.caption)
                .foregroundStyle(.secondary)
            if !filter.karigarId.isEmpty {
                karigarFilterNote
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func chip(_ f: WorkshopFocus, count: Int) -> some View {
        let title = count > 0 ? "\(f.title) \(count)" : f.title
        if focus == f {
            Button(title) { focus = f }
                .buttonStyle(.houseProminent)
        } else {
            Button(title) { focus = f }
                .buttonStyle(.glass)
        }
    }

    /// "12 active · 3 in progress · 4 late · 2 critical · 5 unassigned": the counts read as a sentence.
    private func summaryLine(_ s: WorkshopStats) -> String {
        var parts = ["\(s.active) active"]
        if s.inProgress != s.active { parts.append("\(s.inProgress) in progress") }
        if s.overdue > 0 { parts.append("\(s.overdue) late") }
        if s.critical > 0 { parts.append("\(s.critical) critical") }
        if s.unassigned > 0 { parts.append("\(s.unassigned) unassigned") }
        return parts.joined(separator: " · ")
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
            ToolbarItem(placement: .topBarTrailing) { moreMenu }
        }
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

    /// What the phone cannot do yet: stock work is assigned, changed and deleted on the ERP's own page.
    private var moreMenu: some View {
        Menu {
            Button { opened = WorkshopPlace.workshopPage } label: {
                Label("Assign stock work in the ERP", systemImage: "plus.circle")
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
                _ = try await ERPAPI.shared.write(op, fields)
            } catch {
                failure = error.localizedDescription
            }
            busy.remove(job.id)
        }
    }

    private func setDone(_ job: WorkshopJob, _ done: Bool) {
        guard let orderId = job.orderId, let index = job.itemIndex else { return }
        write(job, "setPieceDone", ["orderId": orderId, "index": index, "done": done])
    }

    private func setGiven(_ job: WorkshopJob, _ given: Bool) {
        guard let orderId = job.orderId, let index = job.itemIndex else { return }
        // Nobody to have given it to: refused here as on the web.
        if job.isUnassigned && given {
            failure = "Nobody is on this piece yet, so there is no one to have given it to. Assign a karigar first."
            return
        }
        write(job, "setPieceGiven", ["orderId": orderId, "index": index, "given": given])
    }

    private func setKarigar(_ job: WorkshopJob, _ karigarId: String) {
        guard let orderId = job.orderId, let index = job.itemIndex else { return }
        write(job, "setPieceKarigar", ["orderId": orderId, "index": index, "karigarId": karigarId])
    }
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
            out.append(Cell(label: "In progress", value: "\(load.inProgress)", tint: Color.blue))
        }
        if load.late > 0 {
            out.append(Cell(label: "Late \(WorkshopLogic.warnDays)d+", value: "\(load.late)", tint: Color.orange))
        }
        if load.critical > 0 {
            out.append(Cell(label: "Critical \(WorkshopLogic.criticalDays)d+", value: "\(load.critical)", tint: Color.red))
        }
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
