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
        if let v = k.contact, !v.isEmpty { MacWorkFact("Phone", v) }
        if let v = k.altPhone, !v.isEmpty { MacWorkFact("Second number", v) }
        if let v = k.email, !v.isEmpty { MacWorkFact("Google login", v) }
        if let v = k.specialty, !v.isEmpty { MacWorkFact("Specialty", v) }
        if let v = k.workshop, !v.isEmpty { MacWorkFact("Workshop", v) }
        if let v = k.city, !v.isEmpty { MacWorkFact("City", v) }
        if let v = k.address, !v.isEmpty { MacWorkFact("Address", v) }
        if let v = k.notes, !v.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text("Notes").font(.callout).foregroundStyle(.secondary)
                Text(v).textSelection(.enabled)
            }
        }
    }
}

// MARK: Cards for the record pages (the iPhone's record page, at a pointer's size)

/// A titled card on the ground: `LedgerHeading` over its content, `.houseCard()` round it. Used by every record page and
/// inspector of Workshop, Stock and Work.
struct MacWorkCard<Content: View>: View {
    let title: String
    var count: Int?
    var trailing: String?
    @ViewBuilder let content: () -> Content

    init(_ title: String, count: Int? = nil, trailing: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.count = count
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !title.isEmpty { LedgerHeading(title: title, count: count, trailing: trailing) }
            content()
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }
}

/// One fact of a card: its name in grey, its value at the right.
struct MacWorkFact: View {
    let label: String
    let value: String
    var tone: Tone = .quiet

    init(_ label: String, _ value: String, tone: Tone = .quiet) {
        self.label = label
        self.value = value
        self.tone = tone
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).font(.callout).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value).font(.callout).multilineTextAlignment(.trailing)
                .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
                .textSelection(.enabled)
        }
    }
}

/// A record page's head: the leading mark (monogram, symbol or photo), the name over its line, a pill, and the one figure.
struct MacWorkHead<Lead: View>: View {
    let title: String
    var subtitle: String?
    var pill: String?
    var pillTone: Tone = .quiet
    var figure: MacHeadline?
    @ViewBuilder let lead: () -> Lead

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                lead()
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(.title3, design: .serif).weight(.semibold)).lineLimit(2).textSelection(.enabled)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.callout).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                    }
                }
                Spacer(minLength: 4)
                if let pill, !pill.isEmpty { Pill(pill, tone: pillTone) }
            }
            if let figure {
                VStack(alignment: .leading, spacing: 2) {
                    Text(figure.label).font(.callout).foregroundStyle(.secondary)
                    Text(figure.value)
                        .font(.system(.title, design: .serif).weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(figure.tone == .quiet ? Color.primary : figure.tone.color)
                }
            }
        }
        .padding(Metrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .houseCard()
    }
}

/// The scroll view every card page and inspector is: cards on the ground.
struct MacWorkPage<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) { content() }
                .padding(12)
        }
        .background(Theme.ground)
    }
}
#endif
