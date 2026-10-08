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

/// The date filter of a custom span, as the web's range picker works: nothing is bound until a start
/// date is chosen, and with no end date the span runs to the end of today. Put it in a Section.
struct MoneyRangeFields: View {
    @Binding var filter: MoneyCustomRange

    var body: some View {
        Group {
            Toggle("From a date", isOn: $filter.useFrom)
            if filter.useFrom {
                DatePicker("From", selection: $filter.from, in: ...Date(), displayedComponents: .date)
                    .onChange(of: filter.from) { _, picked in
                        if filter.to < picked { filter.to = picked }
                    }
                Toggle("To a date", isOn: $filter.useTo)
                if filter.useTo {
                    DatePicker("To", selection: $filter.to, in: filter.from...max(Date(), filter.from), displayedComponents: .date)
                }
            }
        }
    }
}
