import SwiftUI

// iOS's own pull-down search (owner, 2026-11-02: "a search bar that only showed up on pulling the screen down"): no
// bar and no reserved room until the person drags the list down past its top; then a glass field slides in under the
// navigation bar, takes the keyboard, and gives one light tap. It stays while it holds words or the keyboard, and goes
// again on Cancel, or when the list is scrolled away from with nothing typed. `.searchable(.navigationBarDrawer(.automatic))`
// is not this: it shows the bar first and only tucks it away on a scroll.
//
// A Mac keeps the window toolbar's search (`.searchable`, placement `.toolbar`); every iOS screen gets this one.

extension View {
    /// The pull-down search for a screen whose content is a `List` or `ScrollView`. Put it ON that scroll container
    /// (the last modifiers of the `List`/`ScrollView`) so the pull is read from the scroll view itself; the words are
    /// the caller's to filter by.
    ///
    /// `summon`: a hardware key (⌘F on an iPad) sets it true to bring the bar out without a pull; it is put back to false.
    /// `enabled: false` leaves the screen without one (the Workshop board, when it is giving out a single order).
    func pullDownSearch(text: Binding<String>, prompt: LocalizedStringKey = "Search", summon: Binding<Bool>? = nil,
                        enabled: Bool = true) -> some View {
        #if os(iOS)
        modifier(PullDownSearch(text: text, prompt: prompt, summon: summon, enabled: enabled))
        #else
        modifier(MacSearch(text: text, prompt: prompt, enabled: enabled))
        #endif
    }
}

#if os(macOS)
/// A Mac keeps the window toolbar's search.
private struct MacSearch: ViewModifier {
    @Binding var text: String
    let prompt: LocalizedStringKey
    let enabled: Bool
    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled { content.searchable(text: $text, placement: .toolbar, prompt: prompt) } else { content }
    }
}
#endif

#if os(iOS)

/// What the field and the pull-reader share. A screen that swaps its scroll view for another while the person types
/// (Home, into the whole ERP's results) owns one of these, so the field, its focus and its keyboard outlive the swap.
struct PullDownSearchState: Equatable {
    /// The bar is out (it also shows whenever there are words).
    var shown = false
    /// Words or the keyboard are in it: scrolling away must not take it.
    var holding = false
    /// When it came out: the list's own inset settling at that moment must not read as scrolling away.
    var revealedAt = Date.distantPast
    /// Counts the pulls, for the one light tap.
    var buzz = 0
}

/// Reads the pull: down past the top by this much (points) brings the bar out; this far down the list, it may go.
private enum PullDownSearchTuning {
    static let threshold: CGFloat = 64
    static let awayFrom: CGFloat = 40
    static let settle: TimeInterval = 0.8
}

/// The two halves together, for the common screen.
private struct PullDownSearch: ViewModifier {
    @Binding var text: String
    let prompt: LocalizedStringKey
    var summon: Binding<Bool>?
    let enabled: Bool
    @State private var state = PullDownSearchState()
    @Environment(\.accessibilityReduceMotion) private var reduce

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .pullDownSearchReader($state, hasText: !text.isEmpty)
                .pullDownSearchField(text: $text, prompt: prompt, state: $state)
                // VoiceOver cannot pull a list past its top: the same bar, from the rotor's actions.
                .accessibilityAction(named: Text("Search")) {
                    guard !state.shown else { return }
                    withAnimation(PullDownSearchField.slide(reduce: reduce)) {
                        state.shown = true
                        state.revealedAt = Date()
                    }
                }
                .onChange(of: summon?.wrappedValue ?? false) { _, asked in
                    guard asked else { return }
                    summon?.wrappedValue = false
                    guard !state.shown else { return }
                    withAnimation(PullDownSearchField.slide(reduce: reduce)) {
                        state.shown = true
                        state.revealedAt = Date()
                    }
                }
        } else {
            content
        }
    }
}

extension View {
    /// Reads the drag at the top of the scroll view this sits on and brings the bar out (`state.shown`) / sends it away.
    /// `onScrollGeometryChange` hears the scroll views inside the view it is given; the value is a Bool, so the action
    /// fires only when the pull crosses the threshold, never per frame.
    func pullDownSearchReader(_ state: Binding<PullDownSearchState>, hasText: Bool) -> some View {
        modifier(PullDownSearchReader(state: state, hasText: hasText))
    }

    /// The bar itself: inset under the navigation bar so the list moves down beneath it, plus focus, Cancel and the tap.
    func pullDownSearchField(text: Binding<String>, prompt: LocalizedStringKey, state: Binding<PullDownSearchState>) -> some View {
        modifier(PullDownSearchField(text: text, prompt: prompt, state: state))
    }
}

private struct PullDownSearchReader: ViewModifier {
    @Binding var state: PullDownSearchState
    let hasText: Bool
    @Environment(\.accessibilityReduceMotion) private var reduce
    /// A finger is on the list: a bounce after a flick up to the top is not a pull.
    @State private var dragging = false

    func body(content: Content) -> some View {
        content
            // contentOffset.y + contentInsets.top is 0 at rest and negative past the top.
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top < -PullDownSearchTuning.threshold
            } action: { _, pulled in
                guard pulled, dragging, !state.shown else { return }
                withAnimation(PullDownSearchField.slide(reduce: reduce)) {
                    state.shown = true
                    state.revealedAt = Date()
                }
                state.buzz += 1
            }
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > PullDownSearchTuning.awayFrom
            } action: { _, away in
                guard away, state.shown, !state.holding, !hasText,
                      Date().timeIntervalSince(state.revealedAt) > PullDownSearchTuning.settle else { return }
                withAnimation(PullDownSearchField.slide(reduce: reduce)) { state.shown = false }
            }
            .onScrollPhaseChange { _, phase in
                dragging = phase == .interacting
            }
    }
}

private struct PullDownSearchField: ViewModifier {
    @Binding var text: String
    let prompt: LocalizedStringKey
    @Binding var state: PullDownSearchState
    @Environment(\.accessibilityReduceMotion) private var reduce
    @FocusState private var focused: Bool

    /// A spring in, nothing but a fade under Reduce Motion.
    static func slide(reduce: Bool) -> Animation {
        reduce ? .easeOut(duration: 0.12) : .spring(duration: 0.38, bounce: 0.18)
    }

    private var visible: Bool { state.shown || !text.isEmpty }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if visible { bar }
            }
            .sensoryFeedback(.impact(weight: .light), trigger: state.buzz)
            .onChange(of: text) { _, _ in syncHolding() }
            .onChange(of: focused) { _, now in
                syncHolding()
                // The keyboard went and nothing was typed: the bar has done its job.
                if !now, text.isEmpty { hide() }
            }
    }

    private var bar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("", text: $text, prompt: Text(prompt))
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                if !text.isEmpty {
                    Button { text = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .glassEffect(.regular, in: .capsule)
            Button("Cancel") { cancel() }
                .tint(Theme.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .transition(reduce ? .opacity : .move(edge: .top).combined(with: .opacity))
        .onAppear {
            // The field has to exist before it can take the keyboard.
            guard text.isEmpty else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(120))
                focused = true
            }
        }
    }

    private func syncHolding() {
        let now = !text.isEmpty || focused
        if state.holding != now { state.holding = now }
    }

    private func hide() {
        withAnimation(Self.slide(reduce: reduce)) {
            state.shown = false
            state.holding = false
        }
    }

    private func cancel() {
        text = ""
        focused = false
        hide()
    }
}

#endif
