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
        /// A line under the group (rate-chip.tsx `groups()`).
        var note: String?
        var id: String { title }
    }

    static var main: Field { House.metal == "silver"
        ? Field(key: "silverRatePerGram", label: "Silver", value: \.silverRatePerGram)
        : Field(key: "goldRatePerGram21k", label: "21K", value: \.goldRatePerGram21k) }

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
        ], note: "Left at zero, 18K and 12K palladium are priced from the flat rate.")
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

    /// Made once: a formatter is costly, and every rate row redraws with the sheet.
    private static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "H:mm"
        return f
    }()
    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "EEE"
        return f
    }()
    private static let dayMonthFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM"
        return f
    }()
    private static let readFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 2
        return f
    }()
    private static let typedFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US_POSIX")
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 2
        return f
    }()

    /// "9:40" today, "Tue 9:40" this week, "28 Sep" before (lib/rates.ts whenSet).
    static func whenSet(_ iso: String?, now: Date = Date()) -> String {
        guard let t = ERPDate.parse(iso) else { return "not dated" }
        let time = clockFormatter.string(from: t)
        if ERPDate.karachiDay(t) == ERPDate.karachiDay(now) { return time }
        if now.timeIntervalSince(t) < 6 * 86_400 { return "\(weekdayFormatter.string(from: t)) \(time)" }
        return dayMonthFormatter.string(from: t)
    }

    /// "9:40 · Ammar": when the rate was set and by whom, as the sheets' "Set" line says it.
    static func setLine(_ s: Settings?, now: Date = Date()) -> String {
        [whenSet(s?.ratesUpdatedAt, now: now), s?.ratesUpdatedBy].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// A rate as read: grouped, with its decimals when it has them ("26,250", "345.5"). Silver is a few
    /// hundred rupees a gram, so whole rupees would hide the paisa; the chip rounds, as the web's does.
    static func say(_ n: Double) -> String {
        readFormatter.string(from: NSNumber(value: n)) ?? Money.grouped(n)
    }

    /// A rate not yet set reads as a dash, not a zero.
    static func shown(_ n: Double) -> String { n > 0 ? say(n) : "—" }

    /// A rate as typed into a field: ungrouped, up to two decimals ("26250", "345.5").
    static func plain(_ n: Double) -> String {
        typedFormatter.string(from: NSNumber(value: n)) ?? String(n)
    }

    /// What was typed, to two decimals as the web's amount box allows. The decimal pad follows the
    /// phone's region, so a lone comma with one or two digits after it is a decimal point; any other
    /// comma is grouping ("26,250").
    static func parse(_ text: String) -> Double? {
        var t = text.filter { !$0.isWhitespace }
        guard !t.isEmpty else { return nil }
        if !t.contains("."), t.filter({ $0 == "," }).count == 1, let i = t.lastIndex(of: ","), t.distance(from: i, to: t.endIndex) <= 3 {
            t.replaceSubrange(i...i, with: ".")
        }
        guard let n = Double(t.replacingOccurrences(of: ",", with: "")), n.isFinite else { return nil }
        return (n * 100).rounded() / 100
    }
}

/// The chip in every tab's bar. The ERP shows it to everyone: an owner's opens the form, anyone else's
/// (staff, marketing) a page to read, since the server takes a rate only from an owner.
struct RateChip: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @State private var open = false

    var body: some View {
        let s = book.settings.value
        let today = RateKeys.setToday(s)
        Button { open = true } label: {
            HStack(spacing: 4) {
                if !today {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .symbolEffect(.bounce, value: today)
                }
                Text(RateKeys.main.label).fontWeight(.semibold)
                Text(s.map { Money.grouped($0[keyPath: RateKeys.main.value]) } ?? "—")
                    .monospacedDigit()
                    .contentTransition(.numericText(value: s?[keyPath: RateKeys.main.value] ?? 0))
            }
            .font(.footnote)
            .foregroundStyle(today ? Color.primary : Tone.owed.color)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(accessibility(today: today, rate: s.map { $0[keyPath: RateKeys.main.value] }))
        .onAppear { book.settings.need() }
        .sheet(isPresented: $open) { RateSheetHost() }
    }

    private func accessibility(today: Bool, rate: Double?) -> String {
        let said = rate.map { "\(RateKeys.main.label) \(Money.grouped($0)) rupees a gram. " } ?? ""
        if session.isOwner { return said + (today ? "Today's rate. Tap to change." : "The rate was not set today. Tap to set it.") }
        return said + (today ? "Today's rate. Tap to see when it was set." : "The rate was not set today. Tap to see it.")
    }
}

/// The one rate sheet: the form for an owner, the rates to read for anyone else. The chip and the Home
/// page both present it, so the choice is made in one place.
struct RateSheetHost: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.isOwner { RateSheet() } else { RateReadout() }
    }
}

/// The day's rates to read, for those who cannot set them: the rates, and when and by whom they were set.
struct RateReadout: View {
    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let s = book.settings.value
        NavigationStack {
            Form { Group {
                Section {
                    LabeledContent(RateKeys.main.label, value: "PKR \(RateKeys.shown(s?[keyPath: RateKeys.main.value] ?? 0))")
                    LabeledContent("Set", value: RateKeys.setLine(s))
                } footer: {
                    Text(RateKeys.setToday(s) ? "PKR per gram. Only an owner can change the rate." : "This rate was not set today. An owner sets it.")
                }
                ForEach(RateKeys.groups) { g in
                    Section {
                        ForEach(g.fields) { f in
                            LabeledContent(f.label, value: RateKeys.shown(s?[keyPath: f.value] ?? 0))
                        }
                    } header: {
                        LedgerHeading(title: g.title)
                    } footer: {
                        if let note = g.note { Text(note) }
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .navigationTitle("Today’s rate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct RateSheet: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var typed: [String: String] = [:]
    @State private var saving = false
    @State private var filling = false
    /// The fields hold gold.pk's rates, so the log can say where they came from (the web's `source`).
    @State private var fromGoldPk = false
    @State private var note: String?
    @State private var error: String?
    /// Bumped on each saved write, so the money tap fires on the event, never per keystroke.
    @State private var savedCount = 0
    @FocusState private var focused: String?

    /// gold.pk's answer (/api/gold-rates): per-gram gold rates, divided from its per-tola ones by the server.
    private struct GoldPk: Decodable {
        let goldRatePerGram24k: Double?
        let goldRatePerGram22k: Double?
        let goldRatePerGram21k: Double?
        let goldRatePerGram18k: Double?
    }

    private func stored(_ f: RateKeys.Field) -> Double { book.settings.value?[keyPath: f.value] ?? 0 }
    private func value(_ f: RateKeys.Field) -> Double? { typed[f.key].flatMap(RateKeys.parse) }
    private var changed: [RateKeys.Field] {
        RateKeys.groups.flatMap(\.fields).filter { f in value(f).map { abs($0 - stored(f)) >= 0.005 && $0 > 0 } ?? false }
    }
    /// The button is the owner's, and for a gold house: gold.pk has no silver.
    private var offersGoldPk: Bool { session.isOwner && House.metal == "gold" }

    var body: some View {
        let s = book.settings.value
        NavigationStack {
            Form { Group {
                Section {
                    LabeledContent(RateKeys.main.label, value: "PKR \(RateKeys.say(stored(RateKeys.main)))")
                    LabeledContent("Set", value: RateKeys.setLine(s))
                } footer: {
                    Text("PKR per gram. New sales and the website sell at these rates.")
                }
                if offersGoldPk {
                    Section {
                        Button { Task { await fillFromGoldPk() } } label: {
                            HStack {
                                Label("Fill gold from gold.pk", systemImage: "globe")
                                if filling { Spacer(); SkeletonLoading() }
                            }
                        }
                        .disabled(filling || saving)
                    } footer: {
                        if let note { Text(note) }
                    }
                }
                ForEach(RateKeys.groups) { g in
                    Section {
                        ForEach(g.fields) { f in
                            LabeledContent(f.label) {
                                TextField(RateKeys.say(stored(f)), text: Binding(get: { typed[f.key] ?? "" }, set: { typed[f.key] = $0 }))
                                    // Silver is a few hundred rupees a gram with paisa; the web's box takes two decimals.
                                    .keyboardType(.decimalPad)
                                    .focused($focused, equals: f.key)
                                    .multilineTextAlignment(.trailing)
                                    .monospacedDigit()
                                    .fontWeight(f.key == RateKeys.main.key ? .semibold : .regular)
                            }
                        }
                    } header: {
                        LedgerHeading(title: g.title)
                    } footer: {
                        if let note = g.note { Text(note) }
                    }
                }
                }
                .houseRows()
            }
            .houseForm()
            .failureAlert($error, title: "Rate not saved")
            .moneyFeedback(success: savedCount, failure: error)
            .interactiveDismissDisabled(saving || !changed.isEmpty)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Today’s rate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || filling || s == nil)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focused = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// The web's "Fill gold from gold.pk" (rate-chip.tsx): the ERP's server reads gold.pk, and the four
    /// gold figures are typed in for the owner to check, then save. Nothing is saved by the fetch.
    private func fillFromGoldPk() async {
        filling = true
        error = nil
        note = nil
        defer { filling = false }
        do {
            let d: GoldPk = try await ERPAPI.shared.get("/api/gold-rates")
            let found: [(key: String, rate: Double?)] = [
                ("goldRatePerGram24k", d.goldRatePerGram24k), ("goldRatePerGram22k", d.goldRatePerGram22k),
                ("goldRatePerGram21k", d.goldRatePerGram21k), ("goldRatePerGram18k", d.goldRatePerGram18k),
            ]
            var filled = 0
            for f in found {
                if let rate = f.rate, rate > 0 { typed[f.key] = RateKeys.plain(rate); filled += 1 }
            }
            guard filled > 0 else { throw ERPAPI.Failure(status: 0, message: "It sent no rates.") }
            fromGoldPk = true
            let k21 = d.goldRatePerGram21k.map { " (21K \(RateKeys.say($0)) a gram)" } ?? ""
            note = "gold.pk’s rates are filled in\(k21). Check them, then save."
        } catch {
            self.error = "gold.pk did not answer (\(error.localizedDescription)). Type the rate in instead."
        }
    }

    private func save() async {
        saving = true
        error = nil
        var rates: [String: Any] = [:]
        // Only what moved: a figure left blank or unchanged is never sent back over a newer one.
        for f in changed { rates[f.key] = value(f) }
        var fields: [String: Any] = ["rates": rates]
        if fromGoldPk { fields["source"] = "gold.pk" }
        do {
            try await ERPAPI.shared.write("setRates", fields)
            savedCount += 1
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
