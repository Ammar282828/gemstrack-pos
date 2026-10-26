#if os(macOS)
import SwiftUI
import AppKit
import ERPCore

// The Workshop's board on the Mac (docs/features/mac-design.md, "Workshop"): a column for each karigar (and Needs a karigar,
// Free and Done), compact selectable rows, and a row dragged onto a column is given to that karigar or marked done. The
// board draws and reports; the writes are the Workshop screen's own (WorkshopBoard's setKarigar / setDone), passed in.

/// The two views of the Workshop, chosen in the toolbar.
enum MacWorkshopView: String, CaseIterable, Identifiable {
    case board, table
    /// The key the choice is kept under (this Mac's), which View › as Board / as Table writes too.
    static let key = "mac.workshop.view"
    var id: String { rawValue }
    var title: String { self == .board ? "Board" : "Table" }
    var symbol: String { self == .board ? "rectangle.split.3x1" : "list.bullet" }
}

/// One column of the board.
struct MacWorkshopColumn: Identifiable {
    enum Kind { case needs, karigar, free, done }
    let id: String
    let title: String
    let kind: Kind
    /// The karigar this column gives work to (a karigar's own column).
    var karigarId: String?
    var subtitle = ""
    var critical = 0
    var late = 0
    var jobs: [WorkshopJob] = []
    /// The karigars with nothing on the bench (the Free column): each one is a place to drop a piece.
    var free: [Karigar] = []
}

/// Everything the Workshop shows, worked out once per change of the books, the filters and the sort.
struct MacWorkshopData {
    var live: [Karigar] = []
    var snap: WorkshopSnapshot
    var focused: [WorkshopJob] = []
    var sorted: [WorkshopJob] = []
    var byId: [String: WorkshopJob] = [:]
    var columns: [MacWorkshopColumn] = []
    /// How many pieces each "Show" choice holds (for the Filter menu), counted once with the rest.
    var counts: [WorkshopFocus: Int] = [:]
    /// Metal on the bench, in grams, and what it is worth (the whole bench, not the filter).
    var grams = 0.0
    var value = 0.0
}

/// A piece's right-click menu: Give To as a submenu of the karigars, then the piece's other actions. The actions are made
/// when the menu opens (a closure), not for every row each time the board draws.
struct MacWorkshopJobMenu: View {
    let give: () -> [MacAction]
    let groups: () -> [[MacAction]]

    var body: some View {
        let toGive = give()
        if !toGive.isEmpty {
            Menu("Give To") {
                ForEach(toGive) { (a: MacAction) in MacActionMenuItem(action: a) }
            }
            Divider()
        }
        MacActionItems(groups: groups())
    }
}

/// The columns across the window. A click picks a piece (⌘ adds one), a double-click opens its order, a drag moves it.
struct MacWorkshopBoardView: View {
    let columns: [MacWorkshopColumn]
    @Binding var picked: Set<String>
    let give: (WorkshopJob) -> [MacAction]
    let groups: (WorkshopJob) -> [[MacAction]]
    /// Pieces dropped: their ids, the column's kind, and the karigar named (a karigar's column, or one in Free).
    let drop: ([String], MacWorkshopColumn.Kind, String?) -> Bool
    let open: (WorkshopJob) -> Void
    let openKarigar: (String) -> Void

    @State private var targeted: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(columns) { (col: MacWorkshopColumn) in column(col) }
            }
            .padding(14)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .background(Theme.ground)
    }

    // MARK: A column

    /// A column is a card on the ground: the karigar's monogram and name over his load, his pieces as cards inside.
    private func column(_ col: MacWorkshopColumn) -> some View {
        VStack(spacing: 0) {
            header(col)
            ScrollView {
                LazyVStack(spacing: 8) { rows(col) }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
            }
        }
        .frame(width: 280)
        .frame(maxHeight: .infinity, alignment: .top)
        .houseCard()
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Theme.accent.opacity(targeted == col.id ? 0.7 : 0), lineWidth: 2)
                .allowsHitTesting(false)
        }
        .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
            col.kind == .free ? false : drop(ids, col.kind, col.karigarId)
        } isTargeted: { (on: Bool) in
            if on { targeted = col.id } else if targeted == col.id { targeted = nil }
        }
    }

    private func header(_ col: MacWorkshopColumn) -> some View {
        HStack(alignment: .top, spacing: 8) {
            columnMark(col)
            VStack(alignment: .leading, spacing: 2) {
                LedgerHeading(title: col.title, count: col.kind == .free ? col.free.count : col.jobs.count)
                if !col.subtitle.isEmpty {
                    Text(col.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                if col.critical > 0 || col.late > 0 {
                    HStack(spacing: 4) {
                        if col.critical > 0 { Pill("\(col.critical) critical", tone: .late) }
                        if col.late > 0 { Pill("\(col.late) late", tone: .owed) }
                    }
                    .padding(.top, 2)
                }
            }
            if col.kind == .karigar, let id = col.karigarId {
                Button { openKarigar(id) } label: { Image(systemName: "chevron.right.circle") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .help("Open " + col.title)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 12)
        // Every column's head is as tall as the tallest (a karigar's with his load and his pills), so the first pieces of the
        // columns start level.
        .frame(maxWidth: .infinity, minHeight: 82, alignment: .topLeading)
    }

    @ViewBuilder
    private func columnMark(_ col: MacWorkshopColumn) -> some View {
        switch col.kind {
        case .karigar:
            Monogram(name: col.title, size: Monogram.Size.card)
        case .needs:
            markSymbol("person.badge.plus", Tone.owed.color)
        case .free:
            markSymbol("hammer", Color.secondary)
        case .done:
            markSymbol("checkmark.circle", Tone.settled.color)
        }
    }

    private func markSymbol(_ name: String, _ tint: Color) -> some View {
        Image(systemName: name)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: Monogram.Size.card, height: Monogram.Size.card)
            .background(tint.opacity(0.13), in: .circle)
    }

    @ViewBuilder
    private func rows(_ col: MacWorkshopColumn) -> some View {
        if col.kind == .free {
            ForEach(col.free) { (k: Karigar) in freeRow(k) }
            if col.free.isEmpty {
                Text("Everyone has work").font(.callout).foregroundStyle(.secondary).padding(.top, 6)
            }
        } else if col.jobs.isEmpty {
            Text(col.kind == .done ? "Drop a piece here to mark it done" : "Nothing here")
                .font(.callout).foregroundStyle(.secondary).padding(.top, 6)
        } else {
            ForEach(col.jobs) { (job: WorkshopJob) in jobRow(job) }
        }
    }

    // MARK: A piece

    /// The iPhone's job card at a pointer's size: the piece, its stage and age, the order it came off and who ordered it.
    private func jobRow(_ job: WorkshopJob) -> some View {
        let isPicked = picked.contains(job.id)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(job.description).font(.body.weight(.semibold)).lineLimit(2)
                Spacer(minLength: 4)
                WorkshopAgeBadge(job: job)
                if !job.isDone && job.urgency == .ok {
                    Text("\(job.ageDays)d").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            Text(reference(job)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            HStack(spacing: 8) {
                Label(stageWords(job), systemImage: stageSymbol(job))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(stageTone(job))
                    .lineLimit(1)
                if job.isOnline {
                    Image(systemName: "bag").font(.caption).foregroundStyle(.secondary).help("Online sale")
                }
                Spacer(minLength: 0)
                if (job.weightG ?? 0) > 0 {
                    Text(WorkshopLogic.number(job.weightG ?? 0, digits: 1) + "g")
                        .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: .rect(cornerRadius: Radius.card - 4, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card - 4, style: .continuous)
                .strokeBorder(isPicked ? Theme.accent : Color.primary.opacity(0.07), lineWidth: isPicked ? 2 : 0.5)
        }
        .contentShape(Rectangle())
        // The click picks at once; the second click of a double-click opens.
        .onTapGesture { click(job) }
        .simultaneousGesture(TapGesture(count: 2).onEnded { open(job) })
        .draggable(job.id)
        .contextMenu { MacWorkshopJobMenu(give: { give(job) }, groups: { groups(job) }) }
    }

    private func stageWords(_ job: WorkshopJob) -> String {
        if job.isDone { return "Completed" }
        if job.isUnassigned { return "Needs a karigar" }
        return job.hasGiven ? "On the bench" : "Ready to give"
    }

    private func stageSymbol(_ job: WorkshopJob) -> String {
        if job.isDone { return "checkmark.circle" }
        if job.isUnassigned { return "person.badge.plus" }
        return job.hasGiven ? "hammer" : "shippingbox"
    }

    private func stageTone(_ job: WorkshopJob) -> Color {
        if job.isDone { return Color.secondary }
        if job.isUnassigned { return Tone.owed.color }
        return job.hasGiven ? Theme.accent : Tone.owed.color
    }

    /// "ORD-12 · Sana Demo", or "Stock work".
    private func reference(_ job: WorkshopJob) -> String {
        let place = job.invoiceId ?? job.orderId
        guard let place else { return "Stock work" }
        let who = (job.customerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return who.isEmpty ? place : place + " \u{00B7} " + who
    }

    /// A click picks the piece; ⌘ adds it to or takes it from the pieces picked.
    private func click(_ job: WorkshopJob) {
        if NSEvent.modifierFlags.contains(.command) {
            if picked.contains(job.id) { picked.remove(job.id) } else { picked.insert(job.id) }
        } else {
            picked = [job.id]
        }
    }

    private func freeRow(_ k: Karigar) -> some View {
        let key = "free:" + k.id
        return HStack(spacing: 8) {
            Monogram(name: k.name, size: Monogram.Size.row)
            Text(k.name).font(.body)
            Spacer(minLength: 0)
        }
            .padding(8)
            .background(targeted == key ? Theme.accent.opacity(0.25) : Theme.elevated, in: .rect(cornerRadius: Radius.card - 4, style: .continuous))
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { openKarigar(k.id) }
            .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
                drop(ids, .free, k.id)
            } isTargeted: { (on: Bool) in
                if on { targeted = key } else if targeted == key { targeted = nil }
            }
            .help("Drop a piece on " + k.name + " to give it to them")
    }
}
#endif
