import SwiftUI
import ERPCore

/// A filter chip: the accent filled when chosen, a quiet capsule otherwise (content, not glass).
struct AnaChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        FilterChip(title: title, chosen: selected, action: action)
    }
}

/// A row of chips for a sort (Revenue, Quantity sold…): the index of the chosen one.
struct AnaSortChips: View {
    let titles: [String]
    let selected: Int
    let pick: (Int) -> Void

    var body: some View {
        ChipRow {
            ForEach(0..<titles.count, id: \.self) { (i: Int) in
                AnaChip(title: titles[i], selected: i == selected) { pick(i) }
            }
        }
    }
}

/// The period the five tabs share (the web's "Quick:" chips and its date range). The choice is kept in
/// `@AppStorage("erp.analytics.range")` by the screen; this only writes it.
struct AnaPeriodBar: View {
    @Binding var key: String
    @Binding var from: String
    @Binding var to: String
    let state: AnaPeriodState

    @State private var choosing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ChipRow {
                ForEach(AnaPeriod.quick) { (q: AnaPeriod.Quick) in
                    AnaChip(title: q.label, selected: state.key == q.key) { key = q.key }
                }
                // A year picked from the Yearly table has no quick chip of its own; it shows, but there is nothing to press.
                if let year = AnaPeriod.year(state.key) {
                    AnaChip(title: String(year), selected: true) { }
                        .allowsHitTesting(false)
                }
                AnaChip(title: customTitle, selected: state.key == "custom") { choosing = true }
            }
            Text(AnaPeriod.describe(state.range))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
        }
        .sheet(isPresented: $choosing) {
            AnaCustomPeriod(start: state.range?.from ?? AnaDate.adding(days: -29, to: Date()),
                            end: state.range?.to ?? Date()) { (a: Date, b: Date) in
                from = AnaDate.dayKey(a)
                to = AnaDate.dayKey(b)
                key = "custom"
            }
        }
    }

    private var customTitle: String {
        guard state.key == "custom", let r = state.range else { return "Custom" }
        let a = AnaDate.dayMonth(r.from)
        let b = AnaDate.dayMonth(r.to)
        return a == b ? a : "\(a) to \(b)"
    }
}

/// Two days to look between.
struct AnaCustomPeriod: View {
    @Environment(\.dismiss) private var dismiss
    @State private var start: Date
    @State private var end: Date
    let apply: (Date, Date) -> Void

    init(start: Date, end: Date, apply: @escaping (Date, Date) -> Void) {
        _start = State(initialValue: start)
        _end = State(initialValue: end)
        self.apply = apply
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                DatePicker("From", selection: $start, in: ...Date(), displayedComponents: .date)
                DatePicker("To", selection: $end, in: start..., displayedComponents: .date)
            }.houseRows()
            }
            .houseForm()
            .environment(\.calendar, AnaDate.karachi)
            .environment(\.timeZone, ERPDate.karachi)
            .onChange(of: start) { _, newStart in
                if end < newStart { end = newStart }
            }
            .navigationTitle("Custom period")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        apply(start, end)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationSizing(.form)
    }
}
