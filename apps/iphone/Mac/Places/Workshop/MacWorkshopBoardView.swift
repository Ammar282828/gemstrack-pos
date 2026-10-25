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
    /// Metal on the bench, in grams, and what it is worth (the whole bench, not the filter).
    var grams = 0.0
    var value = 0.0
}

/// A piece's right-click menu: Give To as a submenu of the karigars, then the piece's other actions.
struct MacWorkshopJobMenu: View {
    let give: [MacAction]
    let groups: [[MacAction]]

    var body: some View {
        if !give.isEmpty {
            Menu("Give To") {
                ForEach(give) { (a: MacAction) in MacActionMenuItem(action: a) }
            }
            Divider()
        }
        MacActionItems(groups: groups)
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
    }

    // MARK: A column

    private func column(_ col: MacWorkshopColumn) -> some View {
        VStack(spacing: 0) {
            header(col)
            Divider()
            ScrollView {
                LazyVStack(spacing: 2) { rows(col) }
                    .padding(6)
            }
        }
        .frame(width: 270)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(targeted == col.id ? Theme.accent.opacity(0.12) : Color.secondary.opacity(0.07),
                    in: .rect(cornerRadius: Radius.card, style: .continuous))
        .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
            col.kind == .free ? false : drop(ids, col.kind, col.karigarId)
        } isTargeted: { (on: Bool) in
            if on { targeted = col.id } else if targeted == col.id { targeted = nil }
        }
    }

    private func header(_ col: MacWorkshopColumn) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(col.title).font(.headline).lineLimit(1)
                Text("\(col.kind == .free ? col.free.count : col.jobs.count)")
                    .foregroundStyle(.secondary).monospacedDigit()
                Spacer(minLength: 4)
                if col.critical > 0 { Text("\(col.critical) critical").font(.caption).foregroundStyle(Tone.late.color) }
                if col.late > 0 { Text("\(col.late) late").font(.caption).foregroundStyle(Tone.owed.color) }
                if col.kind == .karigar, let id = col.karigarId {
                    Button { openKarigar(id) } label: { Image(systemName: "person.crop.circle") }
                        .buttonStyle(.borderless)
                        .help("Open " + col.title)
                }
            }
            if !col.subtitle.isEmpty {
                Text(col.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func rows(_ col: MacWorkshopColumn) -> some View {
        if col.kind == .free {
            ForEach(col.free) { (k: Karigar) in freeRow(k) }
            if col.free.isEmpty {
                Text("Everyone has work").font(.callout).foregroundStyle(.secondary).padding(.top, 10)
            }
        } else if col.jobs.isEmpty {
            Text(col.kind == .done ? "Drop a piece here to mark it done" : "Nothing here")
                .font(.callout).foregroundStyle(.secondary).padding(.top, 10)
        } else {
            ForEach(col.jobs) { (job: WorkshopJob) in jobRow(job) }
        }
    }

    // MARK: A piece

    private func jobRow(_ job: WorkshopJob) -> some View {
        let isPicked = picked.contains(job.id)
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text(job.description).font(.callout.weight(.medium)).lineLimit(2)
                Text(reference(job)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            if !job.isDone && !job.isUnassigned && !job.hasGiven {
                Image(systemName: "shippingbox").font(.caption).foregroundStyle(Tone.owed.color)
                    .help("Not given to the karigar yet")
            }
            if !job.isDone {
                Text("\(job.ageDays)d").font(.caption).monospacedDigit().foregroundStyle(ageTone(job))
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(isPicked ? Theme.accent.opacity(0.2) : Color.clear, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { open(job) }
        .onTapGesture { click(job) }
        .draggable(job.id)
        .contextMenu { MacWorkshopJobMenu(give: give(job), groups: groups(job)) }
    }

    /// "ORD-12 · Sana Demo", or "Stock work".
    private func reference(_ job: WorkshopJob) -> String {
        let place = job.invoiceId ?? job.orderId
        guard let place else { return "Stock work" }
        let who = (job.customerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return who.isEmpty ? place : place + " \u{00B7} " + who
    }

    private func ageTone(_ job: WorkshopJob) -> Color {
        switch job.urgency {
        case .critical: return Tone.late.color
        case .warning: return Tone.owed.color
        case .ok: return Color.secondary
        }
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
        return Label(k.name, systemImage: "hammer")
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(targeted == key ? Theme.accent.opacity(0.25) : Color.clear, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
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
