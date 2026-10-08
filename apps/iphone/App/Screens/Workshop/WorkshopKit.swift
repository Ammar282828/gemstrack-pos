import SwiftUI
import ERPCore

// The few views the Workshop screens share. Types here carry the word Workshop so they cannot meet
// another group's helpers in the one module.

/// An ERP place to open from inside a row, where a NavigationLink would turn the whole row into one tap
/// (a row of controls cannot also be a link). The title is for the ERP's own pages ("?web=1"), which have
/// none; a native screen names itself.
struct WorkshopPlace: Identifiable, Hashable {
    let path: String
    var title: String = ""
    var id: String { path }

    static func invoice(_ id: String) -> WorkshopPlace {
        WorkshopPlace(path: "/invoices/" + WorkshopLogic.piece(id) + "?web=1", title: id)
    }
    static func order(_ id: String) -> WorkshopPlace {
        WorkshopPlace(path: "/orders/" + WorkshopLogic.piece(id))
    }
    static func karigar(_ id: String) -> WorkshopPlace {
        WorkshopPlace(path: WorkshopLogic.karigarPath(id))
    }
    /// The ERP's own Workshop page, where stock work is assigned, changed and deleted.
    static let workshopPage = WorkshopPlace(path: "/workshop?web=1", title: "Workshop")
    /// The ERP's own Given page, where an entry is edited or deleted.
    static let givenPage = WorkshopPlace(path: "/given?web=1", title: "Given items")
}

private struct WorkshopPlaceView: View {
    let place: WorkshopPlace

    var body: some View {
        if place.title.isEmpty {
            ScreenRegistry.view(for: place.path)
        } else {
            ScreenRegistry.view(for: place.path)
                .navigationTitle(place.title)
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

extension View {
    /// The destination for a `WorkshopPlace` set by a button.
    func workshopPlaceDestination(_ place: Binding<WorkshopPlace?>) -> some View {
        navigationDestination(item: place) { p in
            WorkshopPlaceView(place: p)
        }
    }

    /// The ERP's own words when a write is refused.
    func workshopFailureAlert(_ message: Binding<String?>, title: String = "Not changed") -> some View {
        modifier(WorkshopFailureAlert(message: message, title: title))
    }
}

private struct WorkshopFailureAlert: ViewModifier {
    @Binding var message: String?
    let title: String

    func body(content: Content) -> some View {
        content.alert(title, isPresented: shown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    private var shown: Binding<Bool> {
        Binding(get: { message != nil }, set: { if !$0 { message = nil } })
    }
}

/// How old a piece is, in the colour every workshop surface uses: grey, orange from a week, red from two.
struct WorkshopAgeBadge: View {
    let job: WorkshopJob

    var body: some View {
        if job.isDone {
            StatusBadge("Done", color: .green)
        } else {
            StatusBadge("\(job.ageDays)d", color: tone)
                .monospacedDigit()
        }
    }

    private var tone: Color {
        switch job.urgency {
        case .critical: return .red
        case .warning: return .orange
        case .ok: return .secondary
        }
    }
}

/// A count in the colour of its urgency, for section headers: "2 critical", "3 late".
struct WorkshopUrgencyBadges: View {
    let critical: Int
    let late: Int

    var body: some View {
        HStack(spacing: 6) {
            if critical > 0 { StatusBadge("\(critical) critical", color: .red) }
            if late > 0 { StatusBadge("\(late) late", color: .orange) }
        }
    }
}

/// Who a piece can be given to: the karigars with work first, then the others.
struct WorkshopChoices {
    let working: [Karigar]
    let others: [Karigar]

    init(karigars: [Karigar], busyIds: Set<String>) {
        working = karigars.filter { busyIds.contains($0.id) }
        others = karigars.filter { !busyIds.contains($0.id) }
    }
}

/// What a piece's controls can do. Each is one write through the ERP; the shelf brings the change back.
struct WorkshopActions {
    let done: (WorkshopJob, Bool) -> Void
    let given: (WorkshopJob, Bool) -> Void
    /// "none" clears the karigar.
    let assign: (WorkshopJob, String) -> Void
    let open: (WorkshopPlace) -> Void
}

/// A karigar who is on the books: removal hides (`deletedAt`), as the web store's live list does.
func workshopLive(_ karigars: [Karigar]) -> [Karigar] {
    karigars.filter { ($0.deletedAt ?? "").isEmpty }
}
