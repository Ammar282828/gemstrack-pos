#if os(macOS)
import SwiftUI
import ERPCore

// New order, the left column (docs/features/mac-design.md, "New order"): who the order is for and when it is promised, as
// sections of one grouped form. They read and write the same `NewOrderDraft` the phone's sections do; nothing is decided here.

// MARK: Who it is for

struct MacNewOrderCustomerSection: View {
    @Binding var draft: NewOrderDraft
    /// Customers who are people: not removed, not the old "Walk-in Customer" records.
    let people: [Customer]
    /// The house's counter names (`Session.Shop.takenBy`); free text only where the house has no list.
    let takenBy: [String]
    var recent: () -> [Customer] = { [] }
    var recentKey: [Int] = []

    /// A typed number already on file is that customer (lib/walk-in.ts): said here, so it is no surprise.
    private var numberMatch: Customer? {
        guard draft.customerId.isEmpty, !phoneKey(draft.customerPhone).isEmpty else { return nil }
        let r = resolveSaleCustomer(selectedId: nil, typedName: draft.customerName, typedPhone: draft.customerPhone, customers: people)
        guard let id = r.id else { return nil }
        return people.first { $0.id == id }
    }

    var body: some View {
        Section("Customer") {
            MacNewOrderCustomerBox(
                name: draft.customerName,
                pickedId: draft.customerId.isEmpty ? nil : draft.customerId,
                phone: $draft.customerPhone,
                book: people,
                recent: recent,
                recentKey: recentKey,
                type: { draft.typeCustomerName($0) },
                pick: { c in
                    if let c {
                        draft.choose(c)
                    } else {
                        draft.customerName = ""
                        draft.customerId = ""
                        draft.customerPhone = ""
                    }
                }
            )
            if let match = numberMatch {
                Label("This number is \(match.name)'s: the order goes to them.", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Picker("How they found us", selection: $draft.source) {
                Text("Not specified").tag("")
                ForEach(NewOrderWords.sources) { s in
                    Text(s.label).tag(s.id)
                }
            }
            takenByRow
        }
    }

    /// Counted by name, so the list is fixed and "Ammar" typed three ways is not three people to a filter
    /// (taken-by-picker.tsx). It starts on the signed-in person, and always shows who it is.
    @ViewBuilder
    private var takenByRow: some View {
        if takenBy.isEmpty {
            LabeledContent("Taken by") {
                TextField("Taken by", text: $draft.takenBy, prompt: Text("Not set"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
            }
        } else {
            Picker("Taken by", selection: $draft.takenBy) {
                Text("Not set").tag("")
                ForEach(takenBy, id: \.self) { name in
                    Text(name).tag(name)
                }
            }
        }
    }
}

// MARK: When

struct MacNewOrderPromisedSection: View {
    @Binding var draft: NewOrderDraft

    private var days: Int? { NewOrderDay.daysAway(draft.promised) }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { NewOrderDay.date(draft.promised) ?? Date() },
            set: { draft.promised = NewOrderDay.string($0) }
        )
    }

    /// Inside a bench week, or already behind: said at the moment of choosing, so the counter sees what it is committing
    /// the workshop to.
    private func urgentWords(_ d: Int) -> String {
        if d < 0 { return "Past the date" }
        if d == 0 { return "Today" }
        if d == 1 { return "Tomorrow" }
        return "In \(d) days"
    }

    var body: some View {
        Section {
            LabeledContent("Promised") {
                HStack(spacing: 6) {
                    if draft.promised.isEmpty {
                        Text("No date").foregroundStyle(.secondary)
                    } else {
                        DatePicker("Promised", selection: dateBinding, displayedComponents: .date)
                            .labelsHidden()
                            .datePickerStyle(.field)
                            .environment(\.timeZone, ERPDate.karachi)
                    }
                    quick
                }
            }
            if let d = days, d <= URGENT_WINDOW_DAYS {
                // Soon is amber, as the order page's "Urgent" pill: red is kept for what is already late.
                LabeledContent("Urgent") {
                    Text(urgentWords(d))
                        .foregroundStyle(d < 0 ? Tone.late.color : Tone.owed.color)
                }
            }
        } header: {
            Text("Promised For")
        } footer: {
            Text("What the piece is chased against. Within \(URGENT_WINDOW_DAYS) days is marked urgent.")
        }
    }

    /// Seven, ten and fourteen days are what the counter actually says to a customer.
    private var quick: some View {
        Menu("Quick") {
            ForEach([7, 10, 14], id: \.self) { d in
                Button("\(d) days") { draft.promised = NewOrderDay.after(d) }
            }
            Divider()
            Button("No date") { draft.promised = "" }
        }
        .fixedSize()
    }
}
#endif
