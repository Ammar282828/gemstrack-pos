#if os(macOS)
import SwiftUI
import ERPCore

// What the karigars list's inspector and a karigar's own window say the same way (docs/features/mac-design.md, "Workshop"):
// his details as plain rows, and the one figure that matters, what he holds of ours or what we owe him.

enum MacKarigarFigures {
    /// "He holds of ours PKR 5,000", "We owe him PKR 3,000", "Square": his hisaab cash (WorkshopPosition.cashBalance, positive
    /// when he holds the shop's money), whole rupees.
    static func headline(cash: Double) -> MacHeadline {
        let rounded = cash.rounded()
        let label = rounded > 0 ? "He holds of ours" : (rounded < 0 ? "We owe him" : "Square")
        return MacHeadline(label, Money.pkr(abs(rounded)), tone: rounded < 0 ? .owed : .quiet)
    }
}

/// A karigar's details as rows for a grouped Form: only those that say something.
struct MacKarigarDetailRows: View {
    let karigar: Karigar

    var body: some View {
        let k = karigar
        if let v = k.contact, !v.isEmpty { LabeledContent("Phone", value: v) }
        if let v = k.altPhone, !v.isEmpty { LabeledContent("Second number", value: v) }
        if let v = k.email, !v.isEmpty { LabeledContent("Google login", value: v) }
        if let v = k.specialty, !v.isEmpty { LabeledContent("Specialty", value: v) }
        if let v = k.workshop, !v.isEmpty { LabeledContent("Workshop", value: v) }
        if let v = k.city, !v.isEmpty { LabeledContent("City", value: v) }
        if let v = k.address, !v.isEmpty { LabeledContent("Address", value: v) }
        if let v = k.notes, !v.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text("Notes").font(.callout).foregroundStyle(.secondary)
                Text(v).textSelection(.enabled)
            }
        }
    }
}
#endif
