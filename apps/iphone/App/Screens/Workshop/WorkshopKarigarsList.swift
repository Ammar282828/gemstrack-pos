import SwiftUI
import ERPCore

/// The karigars (src/app/karigars/page.tsx): not a phone book but a list of what each one is holding right now.
/// Working first, the busiest and most overdue on top, then the free ones; each row says how many pieces are on
/// the bench and how many are overdue. A new karigar is the karigar form (owners).
struct WorkshopKarigarsList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var query = ""
    @State private var show: Show = .everyone

    private enum Show: String, CaseIterable, Identifiable {
        case everyone, working, free
        var id: String { rawValue }
        var title: String {
            switch self {
            case .everyone: return "Everyone"
            case .working: return "Working"
            case .free: return "Free"
            }
        }
    }

    var body: some View {
        ShelfState(loaded: loaded, error: firstError, offline: book.karigars.offline) {
            content
        }
        .navigationTitle("Karigars")
        .navigationBarTitleDisplayMode(.large)
        .modifier(HouseGround())
        .searchable(text: $query, prompt: "Name or contact")
        .toolbar {
            if session.isOwner {
                ToolbarItem(placement: .primaryAction) {
                    // The karigar form: an owner's, as the ERP's menu has it.
                    NavigationLink(value: Route(path: "/karigars/add")) {
                        Label("Add karigar", systemImage: "plus")
                    }
                }
            }
        }
        .onAppear {
            book.karigars.need()
            book.orders.need()
            book.invoices.need()
            book.karigarJobs.need()
            // The pay batches are the owner's books: the staff's copy comes without them.
            if session.isOwner { book.karigarBatches.need() }
        }
    }

    private var loaded: Bool {
        let books = book.karigars.loaded && book.orders.loaded && book.invoices.loaded && book.karigarJobs.loaded
        return session.isOwner ? books && book.karigarBatches.loaded : books
    }

    private var firstError: String? {
        let books = book.karigars.error ?? book.orders.error ?? book.invoices.error ?? book.karigarJobs.error
        return session.isOwner ? books ?? book.karigarBatches.error : books
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
        let loads = loadsById(jobs)
        // Who has a hisaab open, and under what name (karigars/page.tsx activeHisaabMap).
        let batches = session.isOwner ? WorkshopLogic.openBatches(book.karigarBatches.items) : [:]
        list(live, loads, batches)
    }

    private func loadsById(_ jobs: [WorkshopJob]) -> [String: WorkshopLoad] {
        var out: [String: WorkshopLoad] = [:]
        for l in WorkshopLogic.groupByKarigar(jobs) { out[l.karigarId] = l }
        return out
    }

    private func list(_ live: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        let matched = live.filter { matches($0) }
        let working = matched
            .filter { (loads[$0.id]?.active ?? 0) > 0 }
            .sorted { busier($0, $1, loads) }
        let free = matched.filter { (loads[$0.id]?.active ?? 0) == 0 }
        return List { Group {
            figures(live, loads, batches)
            showPicker
            if show != .free { section("Working", hint: "busiest first", people: working, loads, batches) }
            if show != .working { section("Free", hint: "nothing on the bench", people: free, loads, batches) }
            if (show == .working && working.isEmpty) || (show == .free && free.isEmpty) || matched.isEmpty {
                Section { emptyState.listRowBackground(Color.clear) }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
    }

    /// The one holding the most, and the most overdue, is the one to look at.
    private func busier(_ a: Karigar, _ b: Karigar, _ loads: [String: WorkshopLoad]) -> Bool {
        let ca = loads[a.id]?.critical ?? 0
        let cb = loads[b.id]?.critical ?? 0
        if ca != cb { return ca > cb }
        let na = loads[a.id]?.active ?? 0
        let nb = loads[b.id]?.active ?? 0
        if na != nb { return na > nb }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    private func matches(_ k: Karigar) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return true }
        if k.name.localizedCaseInsensitiveContains(q) { return true }
        return (k.contact ?? "").contains(q)
    }

    // MARK: Figures

    private func figures(_ live: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        var pieces = 0
        var critical = 0
        var grams = 0.0
        var working = 0
        for k in live {
            guard let l = loads[k.id] else { continue }
            pieces += l.active
            critical += l.critical
            grams += l.totalWeightG
            if l.active > 0 { working += 1 }
        }
        return Section {
            FigureGrid {
                FigureTile(label: "Working now", value: "\(working)", detail: "of \(live.count) on file")
                FigureTile(label: "Pieces out", value: "\(pieces)", detail: grams > 0 ? WorkshopLogic.number(grams, digits: 0) + "g of metal" : nil)
                FigureTile(label: "Over \(WorkshopLogic.criticalDays) days", value: "\(critical)", tint: critical > 0 ? Color.red : Color.primary)
                if session.isOwner {
                    FigureTile(label: "Open hisaabs", value: "\(batches.count)")
                } else {
                    FigureTile(label: "Free", value: "\(live.count - working)", detail: "nothing on the bench")
                }
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private var showPicker: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Show.allCases) { s in
                        FilterChip(title: s.title, chosen: show == s) { show = s }
                    }
                }
            }
            .chipRowInList()
        }
        .listRowBackground(Color.clear)
    }

    // MARK: Sections and rows

    @ViewBuilder
    private func section(_ title: String, hint: String, people: [Karigar], _ loads: [String: WorkshopLoad], _ batches: [String: KarigarBatch]) -> some View {
        if !people.isEmpty {
            Section {
                WorkshopCards(items: people) { k in
                    row(k, loads[k.id], batches[k.id])
                }
            } header: {
                LedgerHeading(title: title, count: people.count)
            }
        }
    }

    private func row(_ k: Karigar, _ load: WorkshopLoad?, _ batch: KarigarBatch?) -> some View {
        NavigationLink(value: Route(path: WorkshopLogic.karigarPath(k.id))) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 8) {
                    Text(k.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                bench(load)
                if let batch, !batch.label.isEmpty {
                    Label(batch.label, systemImage: "book.closed")
                        .font(.caption).foregroundStyle(Theme.accent)
                }
                if let contact = k.contact, !contact.isEmpty {
                    Label(contact, systemImage: "phone").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// What this karigar is holding, in one line: "3 pieces · 1 over 14d · 2 late · 8.5g out", or Free.
    @ViewBuilder
    private func bench(_ load: WorkshopLoad?) -> some View {
        if let load, load.active > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text(WorkshopLogic.pieces(load.active)).font(.subheadline.weight(.semibold)).monospacedDigit()
                FigureRow(spacing: 8) {
                    if load.critical > 0 { StatusBadge("\(load.critical) over \(WorkshopLogic.criticalDays)d", color: .red) }
                    if load.late > 0 { StatusBadge("\(load.late) late", color: .orange) }
                }
                if load.totalWeightG > 0 {
                    Text(WorkshopLogic.number(load.totalWeightG, digits: 1) + "g out")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        } else {
            Text("Free").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var emptyState: some View {
        let filtering = !query.isEmpty
        return ContentUnavailableView(
            "No karigars found",
            systemImage: "person.2",
            description: Text(filtering ? "Try a different search term." : "Add a karigar to begin.")
        )
    }
}
