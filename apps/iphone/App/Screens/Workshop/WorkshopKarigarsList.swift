import SwiftUI
import ERPCore

/// The karigars (src/app/karigars/page.tsx): not a phone book but a list of what each one is holding right now.
/// Working first, the busiest and most overdue on top, then the free ones; each row says how many pieces are on
/// the bench and how many are overdue. A new karigar is the ERP's own form.
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
        .searchable(text: $query, prompt: "Name or contact")
        .toolbar {
            if session.isOwner {
                ToolbarItem(placement: .primaryAction) {
                    // A new karigar stays the ERP's own page for now.
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
        }
    }

    private var loaded: Bool {
        book.karigars.loaded && book.orders.loaded && book.invoices.loaded && book.karigarJobs.loaded
    }

    private var firstError: String? {
        book.karigars.error ?? book.orders.error ?? book.invoices.error ?? book.karigarJobs.error
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
        list(live, loads)
    }

    private func loadsById(_ jobs: [WorkshopJob]) -> [String: WorkshopLoad] {
        var out: [String: WorkshopLoad] = [:]
        for l in WorkshopLogic.groupByKarigar(jobs) { out[l.karigarId] = l }
        return out
    }

    private func list(_ live: [Karigar], _ loads: [String: WorkshopLoad]) -> some View {
        let matched = live.filter { matches($0) }
        let working = matched
            .filter { (loads[$0.id]?.active ?? 0) > 0 }
            .sorted { busier($0, $1, loads) }
        let free = matched.filter { (loads[$0.id]?.active ?? 0) == 0 }
        return List {
            figures(live, loads)
            showPicker
            if show != .free { section("Working", hint: "busiest first", people: working, loads) }
            if show != .working { section("Free", hint: "nothing on the bench", people: free, loads) }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if matched.isEmpty { emptyState }
        }
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

    private func figures(_ live: [Karigar], _ loads: [String: WorkshopLoad]) -> some View {
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
        let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        return Section {
            LazyVGrid(columns: columns, spacing: 10) {
                FigureTile(label: "Working now", value: "\(working)", detail: "of \(live.count) on file")
                FigureTile(label: "Pieces out", value: "\(pieces)", detail: grams > 0 ? WorkshopLogic.number(grams, digits: 0) + "g of metal" : nil)
                FigureTile(label: "Over \(WorkshopLogic.criticalDays) days", value: "\(critical)", tint: critical > 0 ? Color.red : Color.primary)
                FigureTile(label: "Free", value: "\(live.count - working)", detail: "nothing on the bench")
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private var showPicker: some View {
        Section {
            Picker("Show", selection: $show) {
                ForEach(Show.allCases) { s in
                    Text(s.title).tag(s)
                }
            }
            .pickerStyle(.segmented)
        }
        .listRowBackground(Color.clear)
    }

    // MARK: Sections and rows

    @ViewBuilder
    private func section(_ title: String, hint: String, people: [Karigar], _ loads: [String: WorkshopLoad]) -> some View {
        if !people.isEmpty {
            Section {
                ForEach(people) { k in
                    row(k, loads[k.id])
                }
            } header: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary)
                    Text(hint).font(.caption2).foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Text("\(people.count)").font(.caption).foregroundStyle(.secondary)
                }
                .textCase(nil)
            }
        }
    }

    private func row(_ k: Karigar, _ load: WorkshopLoad?) -> some View {
        NavigationLink(value: Route(path: WorkshopLogic.karigarPath(k.id))) {
            VStack(alignment: .leading, spacing: 4) {
                Text(k.name).font(.headline)
                bench(load)
                if let contact = k.contact, !contact.isEmpty {
                    Label(contact, systemImage: "phone").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    /// What this karigar is holding, in one line: "3 pieces · 1 over 14d · 2 late · 8.5g out", or Free.
    @ViewBuilder
    private func bench(_ load: WorkshopLoad?) -> some View {
        if let load, load.active > 0 {
            HStack(spacing: 6) {
                Text(WorkshopLogic.pieces(load.active)).font(.subheadline.weight(.semibold)).monospacedDigit()
                if load.critical > 0 { StatusBadge("\(load.critical) over \(WorkshopLogic.criticalDays)d", color: .red) }
                if load.late > 0 { StatusBadge("\(load.late) late", color: .orange) }
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
