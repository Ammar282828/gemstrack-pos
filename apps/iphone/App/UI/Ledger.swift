import SwiftUI
import ERPCore

// The ledger: the look of Home, Orders and Invoices (redesigned 2026-10-09, owner: "the orders/invoice/
// dashboard screen ui needs a major overhaul, aesthetically and functionally"). docs/features/iphone-app.md
// "The ledger" has the why; in short:
//
// - Money is the subject. A screen's one big figure is set in the serif (New York, the system's own, so it
//   scales with the reader's text size) and everything around it in SF; digits never jump (monospaced).
// - Colour means something or it is not used. The house's accent marks what can be pressed and what is
//   chosen; red is late, amber is owed or due soon, green is paid or done. A sum is never red for being large.
// - A person comes before a number: rows lead with who (a monogram and the name); the record's id is the
//   quiet line underneath, for finding it again.
// - One badge at most on a card. Where an order stands is the stage track, not a pair of coloured words.
// - Content sits on the house's ground and cards; glass stays on the controls that float (CONVENTIONS rule 4).

// MARK: Tones

/// What a colour means on these screens. Nothing else picks a colour.
enum Tone {
    /// Late: a promise missed, a piece sitting too long.
    case late
    /// Soon or owed: due today, money still to come.
    case owed
    /// Settled: paid, done, ready.
    case settled
    /// In credit: the shop owes the customer.
    case credit
    /// Being made: with the karigars.
    case working
    /// Nothing to say.
    case quiet
    /// The house's own: what is chosen, what is the shop's.
    case house

    var color: Color {
        switch self {
        case .late: return .red
        case .owed: return .orange
        case .settled: return .green
        case .credit: return .teal
        case .working: return .blue
        case .quiet: return Color.secondary
        case .house: return Theme.accent
        }
    }
}

// MARK: Words in a capsule

/// A short state in its tone's colour: "Paid", "PKR 86,000 due", "Late 2 days". At most one to a card.
struct Pill: View {
    let text: String
    var tone: Tone = .quiet
    var symbol: String?

    init(_ text: String, tone: Tone = .quiet, symbol: String? = nil) {
        self.text = text
        self.tone = tone
        self.symbol = symbol
    }

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text).monospacedDigit()
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(tone.color)
        .background(tone.color.opacity(0.13), in: .capsule)
    }
}

// MARK: Who

/// A person's initials in the house's accent, or a figure for a walk-in: what a row leads with.
struct Monogram: View {
    let name: String
    var size: CGFloat = 40

    var body: some View {
        let letters = Self.letters(name)
        ZStack {
            Circle().fill(Theme.accent.opacity(0.13))
            if letters.isEmpty {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.42))
                    .foregroundStyle(Theme.accent.opacity(0.8))
            } else {
                Text(letters)
                    .font(.system(size: size * 0.38, weight: .semibold, design: .serif))
                    .foregroundStyle(Theme.accent)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    /// "Sana Demo" → "SD", "M. Hussain" → "MH", a walk-in or no name → "".
    static func letters(_ name: String) -> String {
        if isWalkInName(name) { return "" }
        let words = name.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "-" })
            .filter { $0.first?.isLetter == true }
        return words.prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()
    }
}

// MARK: Money

/// A screen's one big sum: the serif, the rupees exact, "PKR" set small beside it.
struct HeroAmount: View {
    let amount: Double
    var tone: Color = .primary
    /// "4.5 lac" rather than the rupees: for a figure read at a glance (Home).
    var lac = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("PKR")
                .font(.system(.title3, design: .serif).weight(.medium))
                .foregroundStyle(.secondary)
            Text(Self.figure(amount, lac: lac))
                .font(.system(.largeTitle, design: .serif).weight(.semibold))
                .foregroundStyle(tone)
                .monospacedDigit()
                .contentTransition(.numericText(value: amount))
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .accessibilityElement(children: .combine)
    }

    /// The number without its "PKR ".
    static func figure(_ amount: Double, lac: Bool) -> String {
        let s = lac ? Money.pkrLac(amount) : Money.pkr(amount)
        return s.hasPrefix("PKR ") ? String(s.dropFirst(4)) : s
    }
}

/// A row's sum: semibold, digits steady.
struct RowAmount: View {
    let amount: Double
    var lac = false
    var tone: Color = .primary

    var body: some View {
        Text(lac ? Money.pkrLac(amount) : Money.pkr(amount))
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(tone)
            .lineLimit(1)
    }
}

/// What has been paid of a total, as a thin bar: the house's accent while owed, green once settled.
struct PaidBar: View {
    let paid: Double
    let total: Double

    var body: some View {
        let whole = max(total, 1)
        let done = paid >= total - 0.5
        ProgressView(value: min(max(paid, 0), whole), total: whole)
            .tint(done ? Color.green : Theme.accent)
            .accessibilityLabel(done ? "Paid in full" : "Paid \(Money.pkr(paid)) of \(Money.pkr(total))")
    }
}

/// Total · Paid · Due (or In credit): the three sums of an order or an invoice, side by side, over the bar.
struct MoneySplit: View {
    let total: Double
    let paid: Double
    /// What is still owed; below zero is the customer's credit.
    let due: Double
    var totalLabel = "Total"
    var paidLabel = "Paid"

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top, spacing: 0) {
                cell(totalLabel, Money.pkr(total), .primary, .leading)
                cell(paidLabel, Money.pkr(paid), .secondary, .center)
                if due < -0.5 {
                    cell("In credit", Money.pkr(-due), Tone.credit.color, .trailing)
                } else if due > 0.5 {
                    cell("Due", Money.pkr(due), Tone.owed.color, .trailing)
                } else {
                    cell("Due", "Nil", Tone.settled.color, .trailing)
                }
            }
            PaidBar(paid: paid, total: total)
        }
    }

    private func cell(_ label: String, _ value: String, _ tint: Color, _ align: HorizontalAlignment) -> some View {
        VStack(alignment: align, spacing: 3) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .tracking(0.6)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: align, vertical: .top))
    }
}

// MARK: When

/// A promised day as a small calendar leaf: the weekday over the date, in the promise's tone. "—" when none.
struct DateLeaf: View {
    let date: Date?
    var tone: Tone = .quiet
    var size: CGFloat = 44

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let weekday = formatter("EEE")
    private static let day = formatter("d")
    private static let month = formatter("MMM")

    var body: some View {
        VStack(spacing: 0) {
            if let date {
                Text(Self.weekday.string(from: date).uppercased())
                    .font(.system(size: size * 0.2, weight: .bold))
                    .foregroundStyle(tone == .quiet ? Color.secondary : tone.color)
                Text(Self.day.string(from: date))
                    .font(.system(size: size * 0.42, weight: .semibold, design: .serif))
                    .monospacedDigit()
                    .foregroundStyle(tone == .late ? tone.color : Color.primary)
                Text(Self.month.string(from: date).uppercased())
                    .font(.system(size: size * 0.16, weight: .semibold))
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "calendar")
                    .font(.system(size: size * 0.36))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: size, height: size + 6)
        .background((tone == .quiet ? Color.secondary : tone.color).opacity(0.1), in: .rect(cornerRadius: 10, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// An order's promise as words and a tone: "Late 2 days", "Due today", "Due Thu 12 Oct", "No date".
enum PromiseWords {
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "EEE d MMM"
        return f
    }()

    static func say(_ t: OrderTiming) -> (text: String, tone: Tone) {
        switch t.state {
        case .late:
            let d = max(t.daysLate, 1)
            return ("Late \(d) day\(d == 1 ? "" : "s")", .late)
        case .today:
            return ("Due today", .owed)
        case .upcoming:
            guard let due = t.due else { return ("No date", .quiet) }
            return ("Due " + dayFormatter.string(from: due), isUrgent(t) ? .owed : .quiet)
        case .noPromise:
            return ("No date", .quiet)
        }
    }
}

// MARK: Where an order stands

/// Booked → Making → Ready → Invoiced, as four short bars: how far an order has come, at a glance.
/// Awaiting an online transfer stands at Booked; a cancelled or refunded order shows no track.
struct StageTrack: View {
    let stage: OrderStage
    /// The step names under the bars (the order's page); the card shows the bars alone.
    var labels = false

    static let steps = ["Booked", "Making", "Ready", "Invoiced"]

    static func step(_ s: OrderStage) -> Int {
        switch s {
        case .transfer, .new: return 0
        case .karigar: return 1
        case .ready: return 2
        case .payment, .done: return 3
        case .closed: return -1
        }
    }

    var body: some View {
        let at = Self.step(stage)
        HStack(alignment: .top, spacing: 4) {
            ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, name in
                VStack(alignment: .leading, spacing: 4) {
                    Capsule()
                        .fill(index <= at ? Theme.accent : Color.secondary.opacity(0.18))
                        .frame(height: labels ? 5 : 4)
                    if labels {
                        Text(name)
                            .font(.caption2.weight(index == at ? .semibold : .regular))
                            .foregroundStyle(index == at ? Color.primary : Color.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(at < 0 ? "Closed" : "Stage: " + Self.steps[min(at, Self.steps.count - 1)])
    }
}

// MARK: Headings and cards

/// A section's heading: its name in the serif, a count, and what it comes to on the right.
struct LedgerHeading: View {
    let title: String
    var count: Int?
    var trailing: String?
    var tone: Tone = .quiet
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) {
                    heading
                    total
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    heading
                    Spacer(minLength: 8)
                    total.fixedSize(horizontal: true, vertical: false)
                }
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var heading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title)
                .font(.system(.title3, design: .serif).weight(.semibold))
                .foregroundStyle(tone == .late ? tone.color : Color.primary)
            if let count, count > 0 {
                Text("\(count)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var total: some View {
        if let trailing {
            Text(trailing)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }
}

/// Secondary pages use the same headings and row surfaces as the main ledger.
struct LedgerSection<Content: View, Footer: View>: View {
    let title: String
    var collapsible: Bool = false
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    init(_ title: String, collapsible: Bool = false, @ViewBuilder content: @escaping () -> Content) where Footer == EmptyView {
        self.title = title
        self.collapsible = collapsible
        self.content = content
        self.footer = { EmptyView() }
    }

    init(_ title: String, collapsible: Bool = false, @ViewBuilder content: @escaping () -> Content,
         @ViewBuilder footer: @escaping () -> Footer) {
        self.title = title
        self.collapsible = collapsible
        self.content = content
        self.footer = footer
    }

    var body: some View {
        Section {
            if collapsible {
                DisclosureGroup(title) {
                    content()
                    footer().font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                content()
            }
        } header: {
            if !collapsible { LedgerHeading(title: title) }
        } footer: {
            if !collapsible { footer() }
        }
        .houseRows()
    }
}

extension View {
    /// Content on the house's card: the padding and corner every ledger card shares.
    func ledgerCard(padding: CGFloat = 16) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: .rect(cornerRadius: 22, style: .continuous))
    }
}

// MARK: Reaching the customer

/// Call, WhatsApp and Message for a number, as the round buttons under a contact's name in Contacts.
/// Nothing is shown without a number.
struct ContactActions: View {
    let phone: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        let raw = (phone ?? "").trimmingCharacters(in: .whitespaces)
        let digits = raw.filter { $0.isNumber || $0 == "+" }
        if !digits.isEmpty {
            HStack(spacing: 10) {
                QuickAction(title: "Call", symbol: "phone.fill") { open("tel:" + digits) }
                QuickAction(title: "WhatsApp", symbol: "message.fill") {
                    let wa = CustomerKit.whatsAppNumber(raw)
                    open("https://wa.me/" + (wa.isEmpty ? digits.filter(\.isNumber) : wa))
                }
                QuickAction(title: "Message", symbol: "text.bubble.fill") { open("sms:" + digits) }
            }
        }
    }

    private func open(_ s: String) {
        if let url = URL(string: s) { openURL(url) }
    }
}

/// A round action with its word under it: the detail pages' row of what can be done at once.
struct QuickAction: View {
    let title: String
    let symbol: String
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(prominent ? Theme.onAccent : Theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(prominent ? Theme.accent : Theme.accent.opacity(0.12), in: .rect(cornerRadius: 14, style: .continuous))
                Text(title)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(prominent ? Theme.accent : Color.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

// MARK: The signed-in person's own

/// "You", beside a row taken by whoever is signed in (decision "Signed-in defaults": lit in place, never
/// sorted or filtered). It replaces the tinted row and its bar.
struct MineTag: View {
    var body: some View {
        Text("You")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.5), lineWidth: 1))
            .accessibilityLabel("Taken by you")
    }
}

// MARK: A list's chips, inside the list

/// A row of filter chips that scrolls with the list rather than floating over it: a bar pinned under the
/// navigation bar sat over the large title and greyed it out (Orders and Invoices, before 2026-10-09).
/// Use as the first row of a List: `Section { ChipRow { … } }` with `.chipRowInList()`.
struct ChipRow<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { content() }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
        }
    }
}

/// One chip: the accent filled when chosen, a quiet capsule otherwise; its count beside its word.
struct FilterChip: View {
    let title: String
    var count: Int?
    let chosen: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .foregroundStyle(chosen ? Theme.onAccent.opacity(0.8) : Color.secondary)
                }
            }
            .font(.subheadline.weight(chosen ? .semibold : .medium))
            .foregroundStyle(chosen ? Theme.onAccent : Color.primary)
            .padding(.horizontal, 13)
            .padding(.vertical, 7)
            .frame(minHeight: 44)
            .background(chosen ? Theme.accent : Theme.card, in: .capsule)
            .overlay(Capsule().strokeBorder(Color.secondary.opacity(chosen ? 0 : 0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

extension View {
    /// The chip row's place in a List: full width, no card behind it, no separators.
    func chipRowInList() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}
