#if os(macOS)
import SwiftUI
import AppKit

// A place's records drawn two ways from one source (owner, 2026-11-15: "add cards for every available view … the list view
// looks very dated, i want a list view also but a better more modern one that matches ui elements"):
//
// - List: one column of tiles, each record on its own rounded surface with room around it, as Tahoe's Reminders and the
//   iPhone's record rows are, in place of an inset List with hairline separators.
// - Cards: the same records as cards in a grid, the iPad's `RecordCard` anatomy at a pointer's scale.
//
// Both are the CONTENT layer, so they are opaque surfaces, never Liquid Glass (HIG Materials, "Don't use Liquid Glass in the
// content layer"; the design audit of 2026-11-15, docs/features/mac-design-audit.md): the glass is the window's functional
// layer (sidebar, toolbar, inspector, the summary capsule), floating over these on the house's ambient ground.
//
// The behaviour a Mac list has, kept for both: a click picks, ⌘-click adds or removes, ⇧-click picks the run; double-click
// or Return opens; ↑ ↓ (and ← → among cards) move the pick; Esc clears it; ⌘A picks all; right-click is the row's menu;
// ⌘C copies the picked as lines; a record drags out as its line; a group can fold (Done, Cancelled) and opens while searching.

/// How a place shows its records.
enum MacRecordLayout: String {
    case list, cards
}

/// One group of records with its heading (a stage, a day, a letter). `folds`: closed until opened (history).
struct MacRecordSection<Item: Identifiable>: Identifiable where Item.ID == String {
    let id: String
    var title: String = ""
    var count: Int?
    var trailing: String?
    var hint: String = ""
    var folds = false
    let items: [Item]
}

struct MacRecordCollection<Item: Identifiable, Face: View, RowMenu: View>: View where Item.ID == String {
    let layout: MacRecordLayout
    let sections: [MacRecordSection<Item>]
    var searching = false
    @Binding var selection: Set<String>
    /// The place's records come in one after another the first time this key shows records in a launch (nil: never;
    /// the iPhone's lists' clock, `StaggerBox` in MotionMoments.swift).
    var staggerKey: String?
    let open: (Set<String>) -> Void
    /// ⌘C: the picked records as lines of text.
    var lines: (Set<String>) -> [String] = { _ in [] }
    /// What a record drags out as.
    var dragText: (Item) -> String = { $0.id }
    /// The record's face, drawn on its tile or card.
    @ViewBuilder let face: (Item) -> Face
    /// The right-click menu for the records it is about.
    @ViewBuilder let menu: (Set<String>) -> RowMenu

    @State private var unfolded = Set<String>()
    /// Where a ⇧-click run starts and the arrow keys move from.
    @State private var anchor: String?
    @FocusState private var focused: Bool
    /// The first showing's clock, decided when the records first draw (not while the place is still loading, so they
    /// come in when they land).
    @State private var stagger = StaggerBox()

    private var radius: CGFloat { layout == .cards ? Radius.card : 14 }
    private static var gap: CGFloat { 12 }

    var body: some View {
        GeometryReader { (geo: GeometryProxy) in
            let count = columnCount(geo.size.width)
            ScrollViewReader { (proxy: ScrollViewProxy) in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: layout == .cards ? 26 : 20) {
                        ForEach(sections) { (s: MacRecordSection<Item>) in
                            sectionView(s, count: count)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
                .focusable()
                .focused($focused)
                .focusEffectDisabled()
                .onKeyPress(.upArrow) { step(-count, proxy) }
                .onKeyPress(.downArrow) { step(count, proxy) }
                .onKeyPress(.leftArrow) { count > 1 ? step(-1, proxy) : .ignored }
                .onKeyPress(.rightArrow) { count > 1 ? step(1, proxy) : .ignored }
                .onKeyPress(.return) {
                    guard !selection.isEmpty else { return .ignored }
                    open(selection)
                    return .handled
                }
                .onKeyPress(.escape) {
                    guard !selection.isEmpty else { return .ignored }
                    selection = []
                    return .handled
                }
            }
        }
        .environment(\.staggerClock, clock)
        .onCommand(#selector(NSResponder.selectAll(_:))) { selection = Set(visibleIDs) }
        .macCopiesSelection(selection, lines)
    }

    // MARK: Columns

    /// One column of tiles in List; in Cards as many 280-point-or-wider cards as the width holds.
    private func columnCount(_ width: CGFloat) -> Int {
        guard layout == .cards else { return 1 }
        let room = width - 40 + Self.gap
        return max(1, min(5, Int(room / (280 + Self.gap))))
    }

    private func columns(_ count: Int) -> [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: Self.gap, alignment: .top), count: count)
    }

    // MARK: A group

    private func isOpen(_ s: MacRecordSection<Item>) -> Bool {
        !s.folds || searching || unfolded.contains(s.id)
    }

    @ViewBuilder
    private func sectionView(_ s: MacRecordSection<Item>, count: Int) -> some View {
        let shown = isOpen(s)
        VStack(alignment: .leading, spacing: 10) {
            if !s.title.isEmpty { header(s, shown: shown) }
            if shown {
                LazyVGrid(columns: columns(count), alignment: .leading, spacing: layout == .cards ? Self.gap : 8) {
                    ForEach(s.items) { (item: Item) in
                        cell(item)
                    }
                }
            }
        }
    }

    private func header(_ s: MacRecordSection<Item>, shown: Bool) -> some View {
        Button {
            guard s.folds, !searching else { return }
            if unfolded.contains(s.id) { unfolded.remove(s.id) } else { unfolded.insert(s.id) }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if s.folds && !searching {
                    Image(systemName: "chevron.right")
                        .font(.house(.caption).weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(shown ? 90 : 0))
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    LedgerHeading(title: s.title, count: s.count ?? s.items.count, trailing: s.trailing)
                    if !s.hint.isEmpty {
                        Text(s.hint).font(.house(.caption)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!s.folds || searching)
        .accessibilityLabel(s.folds ? (shown ? "Hide \(s.title)" : "Show \(s.title)") : s.title)
    }

    // MARK: A record

    private func cell(_ item: Item) -> some View {
        let picked = selection.contains(item.id)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return face(item)
            .padding(.horizontal, layout == .cards ? 16 : 14)
            .padding(.vertical, layout == .cards ? 14 : 10)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background {
                // The content layer: the house's card colour, opaque, with the picked one washed in the accent.
                shape.fill(Theme.card)
                    .overlay { shape.fill(Theme.accent.opacity(picked ? 0.09 : 0)) }
            }
            .overlay {
                shape.strokeBorder(picked ? Theme.accent : Color.primary.opacity(0.08), lineWidth: picked ? 2 : 0.5)
                    .allowsHitTesting(false)
            }
            // The first showing (motion principles, staggering with frequency of use): the first eight 30 ms apart, as the
            // iPhone's rows; at once ever after in this launch, and under Reduce Motion.
            .staggerIn()
            .contentShape(shape)
            // The click picks at once; the second click of a double-click opens (two exclusive gestures would hold the
            // pick back by the double-click interval), as Stock's gallery does.
            .onTapGesture { pick(item.id) }
            .simultaneousGesture(TapGesture(count: 2).onEnded { open([item.id]) })
            .draggable(dragText(item))
            .contextMenu { menu(selection.contains(item.id) ? selection : [item.id]) }
            .pointerHover(.rect(cornerRadius: radius, style: .continuous))
            .accessibilityAddTraits(picked ? [.isSelected, .isButton] : .isButton)
            .accessibilityAction { open([item.id]) }
            .id(item.id)
    }

    /// The first showing's clock: asked for only once there are records, so a place still loading spends nothing.
    private var clock: StaggerClock? {
        guard let staggerKey, sections.contains(where: { !$0.items.isEmpty }) else { return nil }
        return stagger.clock(for: "mac|" + staggerKey)
    }

    // MARK: Picking

    private var visibleIDs: [String] {
        sections.filter { isOpen($0) }.flatMap { (s: MacRecordSection<Item>) -> [String] in s.items.map(\.id) }
    }

    /// A click picks the one; ⌘ adds it to or takes it from the picked; ⇧ picks the run from the last one picked.
    private func pick(_ id: String) {
        focused = true
        let flags = NSEvent.modifierFlags
        if flags.contains(.command) {
            if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
            anchor = id
        } else if flags.contains(.shift), let from = anchor, let run = run(from, id) {
            selection = Set(run)
        } else {
            selection = [id]
            anchor = id
        }
    }

    private func run(_ a: String, _ b: String) -> [String]? {
        let ids = visibleIDs
        guard let i = ids.firstIndex(of: a), let j = ids.firstIndex(of: b) else { return nil }
        return Array(ids[min(i, j)...max(i, j)])
    }

    /// The arrow keys: the next record by `delta` places (a row of cards is `count` places), picked and scrolled to.
    private func step(_ delta: Int, _ proxy: ScrollViewProxy) -> KeyPress.Result {
        let ids = visibleIDs
        guard !ids.isEmpty else { return .ignored }
        let current = anchor.flatMap { ids.firstIndex(of: $0) } ?? (delta > 0 ? -1 : ids.count)
        let next = min(max(current + delta, 0), ids.count - 1)
        let id = ids[next]
        selection = [id]
        anchor = id
        proxy.scrollTo(id)
        return .handled
    }
}

// MARK: A card's picture

/// A card's picture across its top (HIG Collections: a collection is for what is seen; the List is for what is read): the
/// piece's photo, read once through `PieceGalleryStore` (an order's own reference photos, or a stock piece's), filling a
/// 16:10 frame. A quiet photo mark while it reads or when the record has none, so the cards of a row keep one height.
/// Only the cards on screen read theirs (the grid is lazy), at about a card's width on a Retina screen.
struct MacCardPhoto: View {
    let source: PhotoSource?
    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(.quaternary)
            .aspectRatio(16.0 / 10.0, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if source == nil {
                    Image(systemName: "photo").font(.title2).foregroundStyle(.tertiary)
                }
            }
            .clipShape(.rect(cornerRadius: Radius.tile, style: .continuous))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task(id: source?.id) {
                guard let source else { image = nil; return }
                let pixels = 760
                if let hit = PieceGalleryStore.cachedImage(of: source, maxPixel: pixels) { image = hit; return }
                image = await PieceGalleryStore.image(of: source, maxPixel: pixels)
            }
    }
}

// MARK: The toolbar's layout control

/// One way a place can show its records, as its toolbar control and the View menu name it.
struct MacLayoutChoice: Identifiable, Hashable {
    /// What is stored ("table" for the first way whatever it is drawn as; "cards", "board", "gallery").
    let raw: String
    let title: String
    let symbol: String
    var id: String { raw }

    static let list = MacLayoutChoice(raw: "table", title: "List", symbol: "list.bullet")
    static let cards = MacLayoutChoice(raw: "cards", title: "Cards", symbol: "square.grid.2x2")
    static let board = MacLayoutChoice(raw: "board", title: "Board", symbol: "rectangle.split.3x1")
}

/// The place's ways in the toolbar's centre: a segmented control, which Tahoe draws on the toolbar's glass.
struct MacLayoutPicker: View {
    @Binding var selection: String
    let choices: [MacLayoutChoice]

    var body: some View {
        Picker("View", selection: $selection) {
            ForEach(choices) { (c: MacLayoutChoice) in
                Label(c.title, systemImage: c.symbol).tag(c.raw)
            }
        }
        .pickerStyle(.segmented)
        .help("Show these as " + choices.map(\.title).joined(separator: ", ") + " (also in the View menu)")
    }
}
#endif
