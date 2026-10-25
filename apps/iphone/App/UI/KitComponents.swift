import SwiftUI
import ERPCore

// Shared pieces added in the iPhone review (2026-10-12). CONVENTIONS.md "Kit components" says which to
// reach for; the colours and corners they use are Ledger.swift's `Tone` and `Radius`.

// MARK: Words for money and weight

extension Money {
    /// "+ PKR 30,000" / "− PKR 30,000": the sign said by the amount, the minus a real minus (U+2212).
    static func signed(_ n: Double) -> String { "\(n < 0 ? "\u{2212}" : "+") \(pkr(abs(n)))" }

    /// "− PKR 30,000" whatever the sign of `n`: a line that takes away (a discount, an exchange).
    static func minus(_ n: Double) -> String { "\u{2212} \(pkr(abs(n)))" }
}

/// Weights the way the shop says them.
enum Weight {
    /// "12.5 g · 1.072 tola" (ERPCore's `formatWeight`): grams first, because that is what was weighed.
    static func grams(_ g: Double) -> String { formatWeight(g) }
}

// MARK: Cards

/// A titled card: `LedgerHeading` over the content, on the house's card. Use it for a block of rows or
/// figures on a page of cards (a List uses `LedgerSection`).
struct SectionCard<Content: View>: View {
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
        VStack(alignment: .leading, spacing: pt(12)) {
            LedgerHeading(title: title, count: count, trailing: trailing)
            content()
        }
        .ledgerCard()
    }
}

/// The one hero card of a screen: a faint wash of the house's accent from the top corner and a hairline edge.
/// Flat under Reduce Transparency or Increase Contrast. Once per screen; every other card is `ledgerCard`.
struct HeroSheen: ViewModifier {
    var padding: CGFloat = Metrics.cardPadding
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        let flat = reduceTransparency || contrast == .increased
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: shape)
            .overlay {
                if !flat {
                    shape.fill(LinearGradient(colors: [Theme.accent.opacity(0.10), .clear],
                                              startPoint: .topLeading, endPoint: .center))
                        .allowsHitTesting(false)
                }
            }
            .overlay {
                shape.strokeBorder(Theme.accent.opacity(contrast == .increased ? 0.4 : 0.18), lineWidth: 0.5)
                    .allowsHitTesting(false)
            }
    }
}

/// A dashed hairline, like the tear on a receipt: between a bill's lines and its totals.
struct PerforationDivider: View {
    var body: some View {
        PerforationLine()
            .stroke(Color.secondary.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

private struct PerforationLine: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}

// MARK: Money rows and the paid ring

/// A label and its sum: label leading, amount trailing, in the shared money words. Stacks at accessibility
/// text sizes. `tone` colours the amount (`.quiet` keeps it primary); `signed` says "+ PKR" / "− PKR".
struct MoneyRow: View {
    let label: String
    let amount: Double
    var tone: Tone = .quiet
    var lac = false
    var emphasis = false
    var signed = false
    @Environment(\.dynamicTypeSize) private var typeSize

    init(_ label: String, _ amount: Double, tone: Tone = .quiet, lac: Bool = false, emphasis: Bool = false, signed: Bool = false) {
        self.label = label
        self.amount = amount
        self.tone = tone
        self.lac = lac
        self.emphasis = emphasis
        self.signed = signed
    }

    private var words: String {
        signed ? Money.signed(amount) : (lac ? Money.pkrLac(amount) : Money.pkr(amount))
    }

    var body: some View {
        let figure = Text(words)
            .font(emphasis ? Font.headline : Font.subheadline.weight(.medium))
            .monospacedDigit()
            .contentTransition(.numericText(value: amount))
            .foregroundStyle(tone == .quiet ? Color.primary : tone.color)
        let name = Text(label)
            .font(emphasis ? Font.headline : Font.subheadline)
            .foregroundStyle(emphasis ? Color.primary : Color.secondary)
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) { name; figure }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: pt(12)) {
                    name.fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    figure.multilineTextAlignment(.trailing)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue([Spoken.rupees(amount, lac: lac, signed: signed), tone.spokenWord].compactMap { $0 }.joined(separator: ", "))
    }
}

/// What has been paid of a total, as a ring: the house's accent while owed, green with a tick once settled.
/// The ring travels on the kit's curve; under Reduce Motion it jumps and the tick does not bounce.
struct PaidRing: View {
    let paid: Double
    let total: Double
    var size: CGFloat = 64
    @Environment(\.accessibilityReduceMotion) private var reduce

    init(paid: Double, total: Double, size: CGFloat = 64) {
        self.paid = paid
        self.total = total
        self.size = size
    }

    private var settled: Bool { total > 0 && total - paid < 1 }
    private var fraction: Double { total > 0 ? min(max(paid / total, 0), 1) : 0 }

    var body: some View {
        let colour = settled ? Tone.settled.color : Theme.accent
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.18), lineWidth: 7)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(colour, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            // Always in the tree, so the bounce has an image to play on when it turns on.
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.32, weight: .bold))
                .foregroundStyle(colour)
                .opacity(settled ? 1 : 0)
                .symbolEffect(.bounce, value: reduce ? false : settled)
        }
        .padding(pt(3.5))
        .frame(width: size, height: size)
        .animation(reduce ? nil : Motion.travel, value: fraction)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Paid \(Spoken.rupees(paid)) of \(Spoken.rupees(total))")
    }
}

// MARK: Not done, not here

extension View {
    /// An alert for a refused or failed action, shown while `message` is set and clearing it on OK. Sets the
    /// error tap with it.
    func failureAlert(_ message: Binding<String?>, title: String = "Not done") -> some View {
        alert(title, isPresented: Binding(
            get: { message.wrappedValue != nil },
            set: { if !$0 { message.wrappedValue = nil } }
        ), presenting: message.wrappedValue) { _ in
            Button("OK", role: .cancel) {}
        } message: { text in
            Text(text)
        }
        .sensoryFeedback(.error, trigger: message.wrappedValue) { _, now in now != nil }
    }
}

/// A page or section the signed-in person cannot have, or that has nothing to show: the system's own
/// unavailable state, in the ERP's words.
struct NotAvailableState: View {
    let title: String
    var why: String?
    var symbol: String

    init(_ title: String, why: String? = nil, symbol: String = "lock") {
        self.title = title
        self.why = why
        self.symbol = symbol
    }

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            if let why { Text(why) }
        }
    }
}

// MARK: Haptics

extension View {
    /// A tap for money: success when `success` changes, an error when `failure` changes. Pass values that change
    /// only on the event (a counter bumped on a taken payment, a failure message set), never one that also
    /// changes while typing.
    func moneyFeedback<S: Equatable, F: Equatable>(success: S, failure: F) -> some View {
        self
            .sensoryFeedback(.success, trigger: success)
            .sensoryFeedback(.error, trigger: failure)
    }

    /// A warning tap as a destructive step is reached (the delete code asked, a refund confirmed).
    func destructiveFeedback<T: Equatable>(trigger: T) -> some View {
        sensoryFeedback(.warning, trigger: trigger)
    }

    /// The ONE hero card of a screen (see `HeroSheen`).
    func heroSheen(padding: CGFloat = Metrics.cardPadding) -> some View {
        modifier(HeroSheen(padding: padding))
    }
}

// MARK: Zoom from a row to its page

private struct ZoomNamespaceKey: EnvironmentKey { static let defaultValue: Namespace.ID? = nil }

extension EnvironmentValues {
    /// The namespace of the navigation stack this view is in; nil outside one that has `zoomScope()`.
    var zoomNamespace: Namespace.ID? {
        get { self[ZoomNamespaceKey.self] }
        set { self[ZoomNamespaceKey.self] = newValue }
    }
}

/// Puts a namespace in the environment for `zoomSource` / `zoomDestination`.
struct ZoomScope: ViewModifier {
    @Namespace private var namespace
    func body(content: Content) -> some View { content.environment(\.zoomNamespace, namespace) }
}

/// A row that its page grows from.
struct ZoomSource: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var namespace

    func body(content: Content) -> some View {
        if let namespace {
            // No gesture of its own: a tap recogniser beside a List row's link took taps from it, so a card
            // lit up and did not open (owner, 2026-10-17: "tapping order card and invoice card feels buggy").
            content.matchedTransitionSource(id: id, in: namespace)
                .onAppear { ZoomTap.shown(id) }
                .onDisappear { ZoomTap.hidden(id) }
        } else { content }
    }
}

/// The rows on screen. A page zooms only out of its own row while that row is showing: opened any other way
/// (after a save, from a link, a notification) iOS has no row to grow from and zooms from a stray bubble instead
/// (owner, 2026-10-15: "a weird animation bubble" when finishing an order or invoice). A page is made before the
/// row under it disappears, so the row that opened it is still counted.
enum ZoomTap {
    // Only ever touched on the main thread (a row appearing, a view being made).
    nonisolated(unsafe) private static var showing: [String: Int] = [:]
    static func shown(_ id: String) { showing[id, default: 0] += 1 }
    static func hidden(_ id: String) {
        let n = (showing[id] ?? 0) - 1
        showing[id] = n > 0 ? n : nil
    }
    /// True when a row for this page is on screen.
    static func take(_ id: String) -> Bool { (showing[id] ?? 0) > 0 }
}

/// A page that grows from the row with the same id, when that row opened it.
struct ZoomDestination: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var namespace
    @State private var fromRow: Bool

    init(id: String) {
        self.id = id
        _fromRow = State(initialValue: ZoomTap.take(id))
    }

    func body(content: Content) -> some View {
        #if os(iOS)
        if fromRow, let namespace { content.navigationTransition(.zoom(sourceID: id, in: namespace)) } else { content }
        #else
        // A Mac's pages open in place or in their own window: nothing grows from a row.
        content
        #endif
    }
}

extension View {
    /// Set once per NavigationStack, on the stack itself (RootView does it for the tabs and PlaceStack; never a
    /// sheet); screens never call it.
    func zoomScope() -> some View { modifier(ZoomScope()) }

    /// On a row (or card) that opens a page: the page zooms out of it. Use the destination's route path as
    /// the id. Does nothing where there is no `zoomScope()`.
    func zoomSource(id: String) -> some View { modifier(ZoomSource(id: id)) }

    /// On the page's root view: it zooms out of the row with the same id. Does nothing where there is no
    /// `zoomScope()`; Reduce Motion is the system's own fallback.
    func zoomDestination(id: String) -> some View { modifier(ZoomDestination(id: id)) }
}

// MARK: Money said aloud

/// What VoiceOver reads for a sum: "15,000 rupees", not "P K R 15,000".
enum Spoken {
    /// A line of words with sums in it ("PKR 86,000 due"): the sums said as rupees.
    static func text(_ s: String) -> String {
        s.replacingOccurrences(of: #"PKR (-?[0-9][0-9,.]*(?: lac| crore)?)"#, with: "$1 rupees", options: .regularExpression)
            .replacingOccurrences(of: "\u{2212}", with: "minus ")
    }

    static func rupees(_ amount: Double, lac: Bool = false, signed: Bool = false) -> String {
        let a = abs(amount)
        let body = (lac ? Money.lacCrore(a) : Money.grouped(a)) + " rupees"
        if amount < 0 { return "minus " + body }
        return signed && amount > 0 ? "plus " + body : body
    }
}

extension Tone {
    /// The word for a tone that matters, so colour is not the only carrier; nil for the quiet ones.
    var spokenWord: String? {
        switch self {
        case .late: return "late"
        case .owed: return "owed"
        case .credit: return "in credit"
        case .problem: return "problem"
        default: return nil
        }
    }
}

/// A chart's numbers in a sentence for VoiceOver (the marks themselves are not reachable): how many, the total,
/// the highest, the lowest and the latest. `money` says them as rupees.
enum ChartSummary {
    static func day(_ d: Date) -> String { d.formatted(.dateTime.day().month(.abbreviated)) }

    static func say(_ points: [(label: String, value: Double)], money: Bool = true, total: Bool = true) -> String {
        guard let high = points.max(by: { $0.value < $1.value }), let low = points.min(by: { $0.value < $1.value }), let last = points.last else {
            return "No figures"
        }
        func v(_ x: Double) -> String { money ? Spoken.rupees(x, lac: true) : Money.grouped(x) }
        var parts = ["\(points.count) values"]
        if total { parts.append("total " + v(points.reduce(0) { $0 + $1.value })) }
        parts.append("highest \(high.label), \(v(high.value))")
        parts.append("lowest \(low.label), \(v(low.value))")
        parts.append("latest \(last.label), \(v(last.value))")
        return parts.joined(separator: ". ")
    }
}
