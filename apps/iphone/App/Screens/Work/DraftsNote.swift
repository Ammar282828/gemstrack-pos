import SwiftUI
import FirebaseFirestore

/// How many drafts the shop has, counted by Firestore without reading them (a draft with photos weighs a megabyte).
/// Asked when a New order or New sale opens; the form reads it for its quiet line (`DraftsNote`).
@MainActor @Observable
final class DraftsCount {
    static let shared = DraftsCount()

    private(set) var count = 0
    /// The business the count is of: a count from the one left is not shown in the next.
    private(set) var business = ""

    func refresh() async {
        let biz = House.business.id
        guard !House.isDemo, let db = Businesses.shared.firestore else { return }
        guard let snap = try? await db.collection("drafts").count.getAggregation(source: .server) else { return }
        count = snap.count.intValue
        business = biz
    }

    var shown: Int { business == House.business.id ? count : 0 }
}

/// On a blank New sale or New order, when there are drafts: one quiet line to Drafts (owner, 2026-10-25: a new form
/// is blank, and the unfinished ones are in Drafts). No modal, no prompt; gone as soon as something is typed.
/// Owners only: staff have no Firestore to read the drafts from.
struct DraftsNote: View {
    @Environment(Session.self) private var session

    var body: some View {
        let n = DraftsCount.shared.shown
        if session.isOwner && n > 0 {
            Section {
                NavigationLink(value: Route(path: "/drafts")) {
                    Label(n == 1 ? "1 draft" : "\(n) drafts", systemImage: "doc.on.doc")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
