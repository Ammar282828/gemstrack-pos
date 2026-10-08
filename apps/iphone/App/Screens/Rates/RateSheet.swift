import SwiftUI
import ERPCore

/// The day's rates (the ERP's rate chip and sheet, components/rates/rate-chip.tsx): the house's own
/// rate always in sight, amber when it was not set on Karachi's today, and a sheet to set it or to
/// confirm it unchanged. Saved through the ERP (/api/app/write setRates, lib/writes/rates.ts),
/// which stamps who and when and logs it, exactly as the browser's sheet does.
enum RateKeys {
    struct Field: Identifiable {
        let key: String
        let label: String
        let value: KeyPath<Settings, Double>
        var id: String { key }
    }

    struct Group: Identifiable {
        let title: String
        let fields: [Field]
        var id: String { title }
    }

    static let main: Field = House.metal == "silver"
        ? Field(key: "silverRatePerGram", label: "Silver", value: \.silverRatePerGram)
        : Field(key: "goldRatePerGram21k", label: "21K", value: \.goldRatePerGram21k)

    /// The house's own metal first: a silver house files silver under Silver, not "Other metals".
    static var groups: [Group] {
        let gold = Group(title: "Gold", fields: [
            Field(key: "goldRatePerGram24k", label: "24K", value: \.goldRatePerGram24k),
            Field(key: "goldRatePerGram22k", label: "22K", value: \.goldRatePerGram22k),
            Field(key: "goldRatePerGram21k", label: "21K", value: \.goldRatePerGram21k),
            Field(key: "goldRatePerGram18k", label: "18K", value: \.goldRatePerGram18k),
        ])
        let palladium = Group(title: "Palladium", fields: [
            Field(key: "palladiumRatePerGram18k", label: "18K", value: \.palladiumRatePerGram18k),
            Field(key: "palladiumRatePerGram12k", label: "12K", value: \.palladiumRatePerGram12k),
            Field(key: "palladiumRatePerGram", label: "Flat", value: \.palladiumRatePerGram),
        ])
        if House.metal == "silver" {
            return [Group(title: "Silver", fields: [Field(key: "silverRatePerGram", label: "Per gram", value: \.silverRatePerGram)]),
                    gold, palladium, Group(title: "Other metals", fields: [Field(key: "platinumRatePerGram", label: "Platinum", value: \.platinumRatePerGram)])]
        }
        return [gold, palladium, Group(title: "Other metals", fields: [
            Field(key: "silverRatePerGram", label: "Silver", value: \.silverRatePerGram),
            Field(key: "platinumRatePerGram", label: "Platinum", value: \.platinumRatePerGram),
        ])]
    }

    /// Set on Karachi's today (lib/rates.ts ratesSetToday).
    static func setToday(_ s: Settings?, now: Date = Date()) -> Bool {
        guard let d = ERPDate.parse(s?.ratesUpdatedAt) else { return false }
        return ERPDate.karachiDay(d) == ERPDate.karachiDay(now)
    }

    /// "9:40" today, "Tue 9:40" this week, "28 Sep" before (lib/rates.ts whenSet).
    static func whenSet(_ iso: String?, now: Date = Date()) -> String {
        guard let t = ERPDate.parse(iso) else { return "not dated" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "H:mm"
        let time = f.string(from: t)
        if ERPDate.karachiDay(t) == ERPDate.karachiDay(now) { return time }
        if now.timeIntervalSince(t) < 6 * 86_400 { f.dateFormat = "EEE"; return "\(f.string(from: t)) \(time)" }
        f.dateFormat = "d MMM"
        return f.string(from: t)
    }
}

/// The chip in every screen's bar, for owners.
struct RateChip: View {
    @Environment(Book.self) private var book
    @State private var open = false

    var body: some View {
        let s = book.settings.value
        let today = RateKeys.setToday(s)
        Button { open = true } label: {
            HStack(spacing: 4) {
                if !today { Image(systemName: "exclamationmark.triangle.fill") }
                Text(RateKeys.main.label).fontWeight(.semibold)
                Text(s.map { Money.grouped($0[keyPath: RateKeys.main.value]) } ?? "—").monospacedDigit()
            }
            .font(.footnote)
            .foregroundStyle(today ? Color.primary : Color.orange)
        }
        .accessibilityLabel(today ? "Today's rate. Tap to change." : "The rate was not set today. Tap to set it.")
        .onAppear { book.settings.need() }
        .sheet(isPresented: $open) { RateSheet() }
    }
}

struct RateSheet: View {
    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var typed: [String: String] = [:]
    @State private var saving = false
    @State private var error: String?

    private func stored(_ f: RateKeys.Field) -> Double { book.settings.value?[keyPath: f.value] ?? 0 }
    private func value(_ f: RateKeys.Field) -> Double? {
        guard let t = typed[f.key], !t.isEmpty else { return nil }
        return Double(t.replacingOccurrences(of: ",", with: ""))
    }
    private var changed: [RateKeys.Field] {
        RateKeys.groups.flatMap(\.fields).filter { f in value(f).map { abs($0 - stored(f)) >= 0.005 && $0 > 0 } ?? false }
    }

    var body: some View {
        let s = book.settings.value
        NavigationStack {
            Form {
                Section {
                    LabeledContent(RateKeys.main.label, value: Money.pkr(stored(RateKeys.main)))
                    LabeledContent("Set", value: [RateKeys.whenSet(s?.ratesUpdatedAt), s?.ratesUpdatedBy].compactMap { $0 }.joined(separator: " · "))
                } footer: {
                    Text("New sales and the website sell at these rates, per gram.")
                }
                ForEach(RateKeys.groups) { g in
                    Section(g.title) {
                        ForEach(g.fields) { f in
                            LabeledContent(f.label) {
                                TextField(Money.grouped(stored(f)), text: Binding(get: { typed[f.key] ?? "" }, set: { typed[f.key] = $0 }))
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .monospacedDigit()
                                    .fontWeight(f.key == RateKeys.main.key ? .semibold : .regular)
                            }
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Today's rate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(changed.isEmpty ? "Same today" : "Save") { Task { await save() } }
                        .disabled(saving || s == nil)
                }
            }
        }
        .presentationDetents([.large])
    }

    private func save() async {
        saving = true
        error = nil
        var rates: [String: Any] = [:]
        // Only what moved: a figure left blank or unchanged is never sent back over a newer one.
        for f in changed { rates[f.key] = value(f) }
        do {
            try await ERPAPI.shared.write("setRates", ["rates": rates])
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
