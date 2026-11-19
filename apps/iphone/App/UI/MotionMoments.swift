import SwiftUI

// The principles of motion, second pass (owner, 2026-11-19, relayed from the web's "Motion, second pass"; decisions.md
// "Motion"). What SwiftUI does not already give: rows that come in one after another the first time a list is shown
// (staggering, frequency of use), and a success moment at the end of a sale, an order or a payment (peak-end,
// follow-through). Zoom from the tapped card (origin awareness) was already here (KitComponents `zoomSource`). Reduce
// Motion plays none of it.

/// The screens whose rows have come in once since launch: a screen used all day shows its rows at once after the first time.
@MainActor
enum FirstShow {
    private static var seen: Set<String> = []
    /// True the first time this launch; false ever after.
    static func take(_ key: String) -> Bool { seen.insert(key).inserted }
}

/// Hands out the rows' delays on a list's first showing: 30 ms apart, the first eight only, and only while the list is
/// being laid out (a row scrolled to later comes in at once). Eight rows are in inside 300 ms.
@MainActor
final class StaggerClock {
    private var count = 0
    private let started = Date()

    func delay() -> Double? {
        guard count < 8, Date().timeIntervalSince(started) < 0.4 else { return nil }
        defer { count += 1 }
        return Double(count) * 0.03
    }
}

/// One clock per list, decided once: a clock on the screen's first showing this launch, none after.
@MainActor
final class StaggerBox {
    private var decided = false
    private var clock: StaggerClock?

    func clock(for key: String) -> StaggerClock? {
        if !decided {
            decided = true
            clock = FirstShow.take(key) ? StaggerClock() : nil
        }
        return clock
    }
}

private struct StaggerClockKey: EnvironmentKey { static let defaultValue: StaggerClock? = nil }
private struct JustSavedKey: EnvironmentKey { static let defaultValue: Note? = nil }

extension EnvironmentValues {
    /// The list's clock on its first showing (RecordListScaffold); nil otherwise: rows appear at once.
    var staggerClock: StaggerClock? {
        get { self[StaggerClockKey.self] }
        set { self[StaggerClockKey.self] = newValue }
    }

    /// Set by the form that just made this record (New sale, New order): the page it gives way to says it with the
    /// success moment.
    var justSaved: Note? {
        get { self[JustSavedKey.self] }
        set { self[JustSavedKey.self] = newValue }
    }
}

/// A row coming in: up 8 pt and from clear, on the enter curve, after its turn. Nothing under Reduce Motion, nothing
/// without a clock.
struct StaggerIn: ViewModifier {
    @Environment(\.staggerClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var hidden = false

    func body(content: Content) -> some View {
        content
            .opacity(hidden ? 0 : 1)
            .offset(y: hidden ? pt(8) : 0)
            .onAppear {
                guard !reduce, let wait = clock?.delay() else { return }
                hidden = true
                DispatchQueue.main.async {
                    withAnimation(Motion.enter.delay(wait)) { hidden = false }
                }
            }
    }
}

/// The page a form gave way to says what was just made, once, with the success moment (`Note.peak`).
struct JustSavedNote: ViewModifier {
    @Binding var note: Note?
    @Environment(\.justSaved) private var justSaved
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var said = false

    func body(content: Content) -> some View {
        content.task {
            guard !said, let j = justSaved else { return }
            said = true
            Note.show(j, in: $note, reduce: reduce)
        }
    }
}

extension View {
    /// On a list row: it comes in in its turn on the list's first showing this launch.
    func staggerIn() -> some View { modifier(StaggerIn()) }

    /// On a record's page, with its note binding: says `justSaved` when a form gave way to it.
    func justSavedNote(_ note: Binding<Note?>) -> some View { modifier(JustSavedNote(note: note)) }
}

/// The tick of a peak note: lands with a slight overshoot and a bounce, felt with the note's success tap. Still under
/// Reduce Motion.
struct PeakTick: View {
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var landed = false
    @State private var bounce = 0

    var body: some View {
        Image(systemName: "checkmark.circle.fill")
            .foregroundStyle(Tone.settled.ink)
            .scaleEffect(reduce || landed ? 1 : 0.5)
            .symbolEffect(.bounce, options: .nonRepeating, value: bounce)
            .onAppear {
                guard !reduce else { return }
                withAnimation(.spring(response: 0.28, dampingFraction: 0.55)) { landed = true }
                bounce += 1
            }
    }
}
