import SwiftUI

// One layout for the record lists: Invoices, Orders and Customers (owner, 2026-11-02: "Invoices and orders page and
// customers page should look similar follow the same basic layout"). Each screen keeps its own books, filters and
// actions; how it is laid out is these pieces, so the three cannot drift apart again. Top to bottom:
//
//   ListSummaryStrip   two or three figures in one slim card (the owed one first, in its tone)
//   ListChipRow        the main status filters, as chips
//   ListFilterCaption  what the Filter menu narrowed the list to, and Clear (only while it does)
//   ListSectionHeader  each section's name, a quiet hint, its count and what it comes to on the right
//   RecordRow          a monogram, who, a quiet line, and the money with a capsule on the trailing side
//
// The toolbar carries `RecordFilterMenu` (Status, Group by, Month/Range, Taken by) then the screen's +. A wide iPad
// gets the same pieces as a grid of `RecordCard`s (`RecordListScaffold` decides); nothing is ever a row of its own
// state: an empty list is `RecordEmptyState` over it, loading is `ShelfState`'s skeleton.

// MARK: The figures over the list

/// One figure of the strip. `pick` makes it a tap that shows what it counts; `chosen` lights it while it does.
struct ListFigure: Identifiable {
    let id: String
    let title: String
    /// The figure as read ("PKR 4.5 lac", "12").
    let text: String
    /// For the digits' roll as it changes.
    var value: Double = 0
    /// Colour only for what needs someone (owed, late); nil is the primary colour.
    var tone: Tone?
    var chosen = false
    /// What VoiceOver says, when the words on the strip are not enough ("Owed to you, 4,000 rupees, 3 invoices").
    var spoken: String?
    var pick: (() -> Void)?
}

/// Two or three figures side by side in one slim card (owner, 2026-10-17: "this takes too much space"), stacked at
/// accessibility sizes; a quiet line under them for what the figure holds that the list does not show.
struct ListSummaryStrip: View {
    let figures: [ListFigure]
    var note: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            FigureRow(alignment: .center, spacing: 0) {
                ForEach(figures) { f in
                    // A hairline between the figures; stacked at accessibility sizes there is nothing to divide.
                    if f.id != figures.first?.id && !typeSize.isAccessibilitySize {
                        Divider().frame(height: 34)
                    }
                    cell(f)
                }
            }
            if let note, !note.isEmpty {
                Text(note)
                    .font(.house(.caption))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, pt(8))
            }
        }
        .padding(.vertical, pt(10))
        .padding(.horizontal, pt(6))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: .rect(cornerRadius: Radius.chip, style: .continuous))
    }

    @ViewBuilder
    private func cell(_ f: ListFigure) -> some View {
        if let pick = f.pick {
            Button(action: pick) { face(f) }
                .buttonStyle(.pressable)
                .accessibilityLabel(f.spoken ?? "\(f.title), \(f.text)")
                .accessibilityAddTraits(f.chosen ? .isSelected : [])
        } else {
            face(f)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(f.spoken ?? "\(f.title), \(f.text)")
        }
    }

    private func face(_ f: ListFigure) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(f.title)
                .font(.house(.caption))
                .foregroundStyle(f.chosen ? Theme.accent : Color.secondary)
                .lineLimit(2)
            Text(f.text)
                .font(.house(.subheadline).weight(.semibold))
                .foregroundStyle(f.tone?.color ?? Color.primary)
                .monospacedDigit()
                .contentTransition(.numericText(value: f.value))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, pt(8))
        .padding(.vertical, pt(4))
        .background {
            if f.chosen {
                RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).fill(Theme.accent.opacity(0.12))
            }
        }
        .contentShape(Rectangle())
    }
}

// MARK: The chips

/// One status chip: its word, a count where the count is not said elsewhere on the screen (rule 15).
struct ListChip: Identifiable {
    let id: String
    let title: String
    var count: Int?
    let chosen: Bool
    let pick: () -> Void
}

/// The list's main status filters, as one scrolling row of chips (FilterChip), in the same place on every list.
struct ListChipRow: View {
    let chips: [ListChip]

    var body: some View {
        ChipRow {
            ForEach(chips) { c in
                FilterChip(title: c.title, count: c.count, chosen: c.chosen, action: c.pick)
            }
        }
    }
}

/// What the Filter menu has narrowed the list to, and the way back. Shown only while something narrows it.
struct ListFilterCaption: View {
    let text: String
    let clear: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: pt(12)) {
            Text(text)
                .font(.house(.footnote))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Clear", action: clear)
                .font(.house(.footnote).weight(.semibold))
                .buttonStyle(.borderless)
                .frame(minWidth: Metrics.tap, minHeight: Metrics.tap)
        }
    }
}

/// The list's head, as its first rows (a bar pinned over a list greyed the large title out, 2026-10-09): the strip,
/// the chips, and the filter caption while there is one. `inList` false lays the same out for the iPad's grid page.
struct RecordListHead: View {
    let figures: [ListFigure]
    var note: String?
    let chips: [ListChip]
    /// What the Filter menu narrows the list to; nil while nothing does.
    var caption: String?
    var clear: () -> Void = {}
    var inList = true

    var body: some View {
        if inList {
            Section {
                if !figures.isEmpty { ListSummaryStrip(figures: figures, note: note).stripRow() }
                ListChipRow(chips: chips).chipRowInList()
                if let caption { ListFilterCaption(text: caption, clear: clear).stripRow() }
            }
        } else {
            VStack(alignment: .leading, spacing: pt(12)) {
                if !figures.isEmpty { ListSummaryStrip(figures: figures, note: note) }
                // The chips pad themselves; on the page they line up with its edge.
                ListChipRow(chips: chips).padding(.horizontal, -Metrics.cardPadding)
                if let caption { ListFilterCaption(text: caption, clear: clear) }
            }
        }
    }
}

extension View {
    /// A row of the list's head that sits on the ground: the page's margin, no card, no rule.
    func stripRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

// MARK: Section headings

/// A section's name in the serif with its count beside it and what it comes to on the right, and a quiet hint under it
/// ("Oldest first", "past the day promised", "no sale in a year"). The one heading of the record lists.
struct ListSectionHeader: View {
    let title: String
    var hint = ""
    var count: Int?
    var trailing: String?
    /// For the trailing figure's roll as it changes.
    var value: Double = 0
    /// Late is red; nothing else is.
    var tone: Tone = .quiet
    var spoken: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            heading
            if !hint.isEmpty {
                Text(hint)
                    .font(.house(.caption))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .textCase(nil)
        .padding(.top, pt(4))
        .padding(.bottom, pt(2))
        .contentTransition(.numericText(value: value))
        .motion(value)
    }

    @ViewBuilder private var heading: some View {
        let h = LedgerHeading(title: title, count: count, trailing: trailing, tone: tone)
        if let spoken { h.accessibilityLabel(spoken) } else { h }
    }
}

// MARK: A record

/// The money on a row's trailing side: the sum, and under it what is still owed (or in credit) in its tone.
struct RecordMoney {
    var amount: Double?
    var lac = false
    /// nil is the primary colour.
    var tone: Tone?
    var detail: String?
    var detailTone: Tone = .quiet
}

/// A small state in a capsule: at most one to a row, none for the expected state (rule 15).
struct RecordStatus {
    let text: String
    let tone: Tone
    var symbol: String?
}

/// One record of a list: who (a monogram in the house's accent and the name), a quiet line under it, and on the
/// trailing side the money with a small capsule. The same for an invoice, an order and a customer, in a List row
/// or inside a `RecordCard`. `accessory` sits on the quiet line (an Online badge).
struct RecordRow<Accessory: View>: View {
    /// Whose initials lead.
    let name: String
    let title: String
    let subtitle: Text
    /// Taken by whoever is signed in: a small quiet glyph, lit in place (decision "Signed-in defaults").
    var mine = false
    /// History rather than work (an invoiced order): the name in the quiet colour.
    var muted = false
    var money: RecordMoney?
    var status: RecordStatus?
    @ViewBuilder var accessory: () -> Accessory
    @Environment(\.dynamicTypeSize) private var typeSize

    #if os(macOS)
    static var monogram: CGFloat { Monogram.Size.row }
    #else
    static var monogram: CGFloat { 36 }
    #endif

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: pt(8)))
            : AnyLayout(HStackLayout(alignment: .top, spacing: pt(12)))
        layout {
            HStack(alignment: .top, spacing: pt(12)) {
                Monogram(name: name, size: Self.monogram)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.house(.headline))
                        .foregroundStyle(muted ? Color.secondary : Color.primary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(alignment: .firstTextBaseline, spacing: pt(6)) {
                        subtitle
                            .font(.house(.caption))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        if mine { MineTag() }
                        accessory()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing(stacked)
        }
        .padding(.vertical, pt(2))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func trailing(_ stacked: Bool) -> some View {
        if money != nil || status != nil {
            VStack(alignment: stacked ? .leading : .trailing, spacing: pt(4)) {
                if let money {
                    if let amount = money.amount {
                        RowAmount(amount: amount, lac: money.lac, tone: money.tone?.color ?? .primary)
                    }
                    if let detail = money.detail, !detail.isEmpty {
                        Text(detail)
                            .font(.house(.caption).weight(money.detailTone == .quiet ? .regular : .semibold))
                            .foregroundStyle(money.detailTone.color)
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                }
                if let status {
                    Pill(status.text, tone: status.tone, symbol: status.symbol)
                }
            }
            .fixedSize(horizontal: !stacked, vertical: true)
            .layoutPriority(1)
        }
    }
}

extension RecordRow where Accessory == EmptyView {
    init(name: String, title: String, subtitle: Text, mine: Bool = false, muted: Bool = false,
         money: RecordMoney? = nil, status: RecordStatus? = nil) {
        self.init(name: name, title: title, subtitle: subtitle, mine: mine, muted: muted, money: money, status: status,
                  accessory: { EmptyView() })
    }
}

/// A record as a card for the iPad's grid: the row's own anatomy on the house's card, a rule, then its footer (the one
/// next step, the actions menu). The card carries the row's actions in its context menu (rule 16), added by the screen.
struct RecordCard<Row: View, Footer: View>: View {
    var mine = false
    @ViewBuilder let row: () -> Row
    @ViewBuilder let footer: () -> Footer

    var body: some View {
        VStack(alignment: .leading, spacing: pt(12)) {
            row()
            if Footer.self != EmptyView.self {
                Divider()
                footer()
            }
        }
        // Glass under Liquid Glass, grouped by RecordGrid so a page of cards is sampled once.
        .ledgerCard(padding: 20, glass: .card)
        .overlay {
            // The signed-in person's own card is lit in place, never sorted or filtered.
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Theme.accent.opacity(mine ? 0.22 : 0.08), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .pointerHover(.rect(cornerRadius: Radius.card, style: .continuous))
    }
}

extension RecordCard where Footer == EmptyView {
    init(mine: Bool = false, @ViewBuilder row: @escaping () -> Row) {
        self.init(mine: mine, row: row, footer: { EmptyView() })
    }
}

/// A card's footer: its one action on the leading side and the actions menu (…) on the trailing.
struct RecordCardFooter<Lead: View, Actions: View>: View {
    let label: String
    @ViewBuilder let lead: () -> Lead
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(spacing: pt(8)) {
            lead()
            Spacer(minLength: 0)
            Menu { actions() } label: {
                Image(systemName: "ellipsis").frame(width: Metrics.tap, height: Metrics.tap)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(label)
        }
    }
}

/// The grid of cards a section holds on a wide iPad: the same columns for every section, so a day with one record
/// keeps a card's width rather than the window's.
struct RecordGrid<Item: Identifiable, Card: View>: View {
    let items: [Item]
    let width: CGFloat
    @ViewBuilder let card: (Item) -> Card

    var body: some View {
        GlassGroup {
            LazyVGrid(columns: CardColumns.grid(width), alignment: .leading, spacing: pt(20)) {
                ForEach(items) { item in card(item) }
            }
        }
    }
}

// MARK: The toolbar's Filter menu

/// The Filter menu of every record list: Status, Group by, Month or range, Taken by, in that order, with the same
/// symbol (filled while something narrows the list) in the same place, before the screen's +.
struct RecordFilterMenu<Content: View>: View {
    let filtering: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        Menu { content() } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }
}

// MARK: Nothing to show

/// The empty list, one way for every record list, as an overlay of the list (rule 16): a search with no hits is the
/// system's own; narrowed by filters, "No matches" and Clear filters; otherwise the screen's words and its New.
struct RecordEmptyState: View {
    enum Action {
        case link(String, Route)
        case run(String, () -> Void)
    }

    var search = ""
    /// Clear filters, when filters are what emptied the list.
    var clear: (() -> Void)?
    let title: String
    let symbol: String
    let message: String
    var action: Action?

    var body: some View {
        let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
        Group {
            if !words.isEmpty && clear == nil {
                ContentUnavailableView.search(text: words)
            } else if let clear {
                ContentUnavailableView {
                    Label("No matches", systemImage: "line.3.horizontal.decrease.circle")
                } description: {
                    Text("Try adjusting your search or filters.")
                } actions: {
                    Button("Clear filters", action: clear).buttonStyle(.bordered)
                }
            } else {
                ContentUnavailableView {
                    Label(title, systemImage: symbol)
                } description: {
                    Text(message)
                } actions: {
                    switch action {
                    case .link(let words, let route)?:
                        RouteLink(value: route, row: false) { Text(words) }.buttonStyle(.houseProminent)
                    case .run(let words, let run)?:
                        Button(words, action: run).buttonStyle(.houseProminent)
                    case nil:
                        EmptyView()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: List or grid

/// Whether a list is laid out as the iPad's grid of cards: a wide window, not at accessibility sizes.
enum RecordLayout {
    static func isGrid(_ width: CGFloat, _ typeSize: DynamicTypeSize) -> Bool {
        width >= 760 && !typeSize.isAccessibilitySize
    }
}

/// The record list's container: an inset-grouped List of `rows`, or on a wide iPad a page of `cards` (handed the width
/// the grid has), both with the pull-down search on the scroll container itself, and `empty` over either.
struct RecordListScaffold<Rows: View, Cards: View, Empty: View>: View {
    @Binding var search: String
    let prompt: LocalizedStringKey
    let isEmpty: Bool
    @ViewBuilder let empty: () -> Empty
    @ViewBuilder let rows: () -> Rows
    @ViewBuilder let cards: (CGFloat) -> Cards
    /// The width, for the grid (kept in state: a GeometryReader around the whole list re-ran it on every pass).
    @State private var width: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if RecordLayout.isGrid(width, typeSize) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: pt(24)) {
                        cards(width - pt(24) * 2)
                    }
                    .padding(pt(24))
                }
                // Pulled down from the top, as iOS's own search (PullDownSearch.swift); on the ScrollView so the pull is read there.
                .pullDownSearch(text: $search, prompt: prompt)
            } else {
                List {
                    rows()
                }
                .listStyle(.insetGrouped)
                // On the List so the pull is read there.
                .pullDownSearch(text: $search, prompt: prompt)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // Nothing to show is an overlay of the list, never a row inside it (rule 16).
        .overlay {
            if isEmpty { empty().padding(.top, pt(120)) }
        }
    }
}
