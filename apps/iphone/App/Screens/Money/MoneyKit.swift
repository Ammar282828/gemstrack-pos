import SwiftUI
import ERPCore

/// What the three Money screens share. The books of money are the owners' (the web hides them from
/// staff, and staff's shelves arrive without them), so each screen shows anyone else one line.
struct MoneyOwnersOnly: View {
    let title: String

    var body: some View {
        ContentUnavailableView("Owners only", systemImage: "lock")
            .navigationTitle(title)
    }
}

enum MoneyWords {
    /// The house's own metal for lines that name it ("12.500 g gold"): "silver" in a silver house.
    static var metal: String { House.metal == "silver" ? "silver" : "gold" }
}
