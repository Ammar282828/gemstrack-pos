import SwiftUI

// Loading, one rule (owner, 2026-11-03: "skeleton for known state, and loading circle for unknown state").
//
// KNOWN shape (a list of records, a record's page, cards, figure tiles, a form's fields, a chart frame, a thumbnail
// of known size, a settings section): a skeleton built from the pieces below, at the real content's heights, so
// nothing jumps when it arrives. The shimmer is one soft pulse on the whole group and stops under Reduce Motion.
// UNKNOWN shape (an action under way: sending, saving, preparing a PDF, an AI scan, signing in, connecting, a search
// on the server, "checking…"): a circular `ProgressView` with a few words if it lasts (`BusySpinner`), and inside a
// button the spinner takes the label's place (`.busy(_:)`). Never a spinner for a page whose shape is known, never a
// skeleton for an action. Offline and failed states stay `ShelfState`'s / `ErrorState`'s.

/// The one soft pulse on a skeleton. Nothing at all under Reduce Motion.
private struct SkeletonShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(reduce ? 1 : (dim ? 0.5 : 1))
            .animation(reduce ? nil : Animation.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: dim)
            .onAppear { if !reduce { dim = true } }
            .allowsHitTesting(false)
    }
}

extension View {
    /// The skeleton's pulse, on the whole group once (never per bar).
    func skeletonShimmer() -> some View { modifier(SkeletonShimmer()) }
}

/// A text line: a rounded bar.
struct SkeletonBar: View {
    var width: CGFloat?
    var height: CGFloat = 11
    var body: some View {
        RoundedRectangle(cornerRadius: height / 2.5, style: .continuous)
            .fill(.secondary.opacity(0.12))
            .frame(width: width, height: height)
    }
}

/// A block of known size: a photo, a thumb, a chart frame.
struct SkeletonBlock: View {
    var radius: CGFloat = Radius.thumb
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(.secondary.opacity(0.12))
    }
}

/// One list row: a monogram circle, two lines, a figure on the right (64 pt, as the real rows).
struct SkeletonRow: View {
    var monogram = true
    var trailing = true
    var index = 0
    var body: some View {
        HStack(spacing: pt(12)) {
            if monogram { Circle().fill(.secondary.opacity(0.12)).frame(width: Monogram.Size.row, height: Monogram.Size.row) }
            VStack(alignment: .leading, spacing: pt(8)) {
                SkeletonBar(width: index % 3 == 1 ? 120 : 150, height: 11)
                SkeletonBar(width: 90, height: 9)
            }
            Spacer(minLength: 8)
            if trailing { SkeletonBar(width: 56, height: 11) }
        }
        .frame(height: pt(64))
    }
}

/// A list's rows while the books are not in. Inside a `List` section or a card.
struct SkeletonRows: View {
    var count = 5
    var monogram = true
    var trailing = true
    var label = "Loading"
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { SkeletonRow(monogram: monogram, trailing: trailing, index: $0) }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// Cards of a known height (an order card, a campaign, a piece).
struct SkeletonCards: View {
    var count = 3
    var height: CGFloat = 120
    var label = "Loading"
    var body: some View {
        VStack(spacing: pt(10)) {
            ForEach(0..<count, id: \.self) { _ in
                VStack(alignment: .leading, spacing: pt(10)) {
                    SkeletonBar(width: 130, height: 12)
                    SkeletonBar(width: 190, height: 10)
                    Spacer(minLength: 0)
                    SkeletonBar(width: 84, height: 10)
                }
                .padding(Metrics.cardPadding)
                .frame(maxWidth: .infinity, minHeight: pt(height), alignment: .topLeading)
                .background(Theme.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// Figure tiles: a label and a figure, two to a row.
struct SkeletonFigures: View {
    var count = 4
    var columns = 2
    var label = "Loading"
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: pt(10)), count: max(columns, 1)), spacing: pt(10)) {
            ForEach(0..<count, id: \.self) { _ in
                VStack(alignment: .leading, spacing: pt(10)) {
                    SkeletonBar(width: 64, height: 9)
                    SkeletonBar(width: 96, height: 20)
                }
                .padding(Metrics.cardPadding)
                .frame(maxWidth: .infinity, minHeight: pt(78), alignment: .leading)
                .background(Theme.card, in: .rect(cornerRadius: Radius.tile, style: .continuous))
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A record's page: the header (monogram, name, a line), two figure tiles, a section title and its rows.
struct SkeletonRecord: View {
    var rows = 4
    var label = "Loading"
    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            HStack(spacing: pt(14)) {
                Circle().fill(.secondary.opacity(0.12)).frame(width: Monogram.Size.hero, height: Monogram.Size.hero)
                VStack(alignment: .leading, spacing: pt(8)) {
                    SkeletonBar(width: 160, height: 16)
                    SkeletonBar(width: 100, height: 10)
                }
            }
            HStack(spacing: pt(10)) {
                ForEach(0..<2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: pt(10)) {
                        SkeletonBar(width: 64, height: 9)
                        SkeletonBar(width: 96, height: 20)
                    }
                    .padding(Metrics.cardPadding)
                    .frame(maxWidth: .infinity, minHeight: pt(78), alignment: .leading)
                    .background(Theme.card, in: .rect(cornerRadius: Radius.tile, style: .continuous))
                }
            }
            SkeletonBar(width: 96, height: 12).padding(.top, pt(6))
            VStack(spacing: 0) {
                ForEach(0..<rows, id: \.self) { SkeletonRow(index: $0) }
            }
        }
        .padding(.horizontal, pt(16))
        .padding(.top, pt(8))
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A grid of square thumbnails (photos, pieces, artwork).
struct SkeletonThumbGrid: View {
    var count = 12
    var columns = 3
    var spacing: CGFloat = 6
    var label = "Loading"
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: pt(spacing)), count: max(columns, 1)), spacing: pt(spacing)) {
            ForEach(0..<count, id: \.self) { _ in
                SkeletonBlock().aspectRatio(1, contentMode: .fit)
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A chart's frame: the plot area with bars of a plausible shape, at the chart's own height.
struct SkeletonChart: View {
    var height: CGFloat = 180
    var label = "Loading"
    private let shape: [CGFloat] = [0.35, 0.55, 0.45, 0.7, 0.5, 0.85, 0.6, 0.4, 0.75, 0.55]
    var body: some View {
        HStack(alignment: .bottom, spacing: pt(8)) {
            ForEach(0..<shape.count, id: \.self) { i in
                RoundedRectangle(cornerRadius: Radius.thumb / 2, style: .continuous)
                    .fill(.secondary.opacity(0.12))
                    .frame(maxWidth: .infinity)
                    .frame(height: pt(height) * shape[i] * 0.85)
            }
        }
        .frame(maxWidth: .infinity, minHeight: pt(height), maxHeight: pt(height), alignment: .bottom)
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A photo of a known frame (the frame's ratio, or a fixed size where the caller frames it).
struct SkeletonPhoto: View {
    var ratio: CGFloat? = 1
    var radius: CGFloat = Radius.thumb
    var label = "Loading the photo"
    var body: some View {
        Group {
            if let ratio { SkeletonBlock(radius: radius).aspectRatio(ratio, contentMode: .fit) } else { SkeletonBlock(radius: radius) }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A form's fields: a label and a field bar each, at a Form row's height.
struct SkeletonForm: View {
    var rows = 5
    var label = "Loading"
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<rows, id: \.self) { i in
                HStack {
                    SkeletonBar(width: i % 2 == 0 ? 90 : 120, height: 11)
                    Spacer(minLength: 8)
                    SkeletonBar(width: i % 3 == 1 ? 70 : 110, height: 11)
                }
                .frame(height: pt(48))
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// What a `ShelfState` shows until the books are in: the shape of the screen it stands for.
enum SkeletonShape {
    case page, list, cards, figures, record, grid, form
}

/// The skeleton for a shape, as a page (pinned to the top, on the page's own margins).
struct SkeletonPage: View {
    var shape: SkeletonShape = .page
    var body: some View {
        switch shape {
        case .page:
            SkeletonLoading().controlSize(.large)
        case .list:
            SkeletonRows(count: 8).padding(.horizontal, pt(16)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        case .cards:
            SkeletonCards(count: 4).padding(.horizontal, pt(16)).padding(.top, pt(8)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        case .figures:
            VStack(spacing: pt(16)) {
                SkeletonFigures(count: 4)
                SkeletonRows(count: 4)
            }
            .padding(.horizontal, pt(16)).padding(.top, pt(8)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        case .record:
            SkeletonRecord().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        case .grid:
            SkeletonThumbGrid(count: 18).padding(.horizontal, pt(16)).padding(.top, pt(8)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        case .form:
            SkeletonForm(rows: 8).padding(.horizontal, pt(16)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

// MARK: Unknown shape: the circle

/// An action under way, whose result cannot be known: the system's circle, and a few words if it lasts
/// ("Preparing PDF…"). A column by default (the caller centres it with a frame); `inline` puts it in a row.
struct BusySpinner: View {
    let text: String?
    var inline = false
    init(_ text: String? = nil, inline: Bool = false) {
        self.text = text
        self.inline = inline
    }

    var body: some View {
        Group {
            if inline {
                HStack(spacing: pt(10)) {
                    ProgressView()
                    if let text { Text(text).font(.footnote).foregroundStyle(.secondary) }
                }
            } else {
                VStack(spacing: pt(10)) {
                    ProgressView().controlSize(.large)
                    if let text { Text(text).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center) }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text ?? "Working")
    }
}

private struct BusyLabel: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        content
            .opacity(on ? 0 : 1)
            .overlay { if on { ProgressView() } }
    }
}

extension View {
    /// In a button: the spinner replaces the label in place (the label keeps its size). Put `.disabled(busy)` on the button.
    func busy(_ on: Bool) -> some View { modifier(BusyLabel(on: on)) }
}
