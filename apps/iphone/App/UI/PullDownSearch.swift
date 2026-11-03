import SwiftUI

// iOS's own pull-down search (owner, 2026-11-02: "a search bar that only showed up on pulling the screen down"): no
// bar and no reserved room until the person drags the list down past its top; then a glass field slides in under the
// navigation bar, takes the keyboard, and gives one light tap. It stays while it holds words or the keyboard, and goes
// again on Cancel, or when the list is scrolled away from with nothing typed. `.searchable(.navigationBarDrawer(.automatic))`
// is not this: it shows the bar first and only tucks it away on a scroll.
//
// Why it is built the way it is (owner, 2026-11-03: "pull to search is still stuttery"): NOTHING that SwiftUI tracks changes
// while a finger is down. The bar is mounted once, hidden, in a fixed 52 pt slot under the navigation bar; the drag moves
// it by a transform (and alpha) set straight on its UIKit view from the scroll-geometry callback, so no body is
// re-evaluated and the list beneath is never re-rendered. The one state change of a gesture is `revealed = true`, when the
// finger lifts past the line.
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
import UIKit

/// What the bar and the pull-reader share. A screen that swaps its scroll view for another while the person types
/// (Home, into the whole ERP's results) owns one of these, so the bar, its focus and its keyboard outlive the swap.
///
/// Only `revealed` is observed: it changes once per gesture (the finger lifted past the line, Cancel, scrolled away).
/// Everything else is plain storage written during a drag, so a drag re-evaluates no view.
@MainActor
@Observable
final class PullDownSearchState {
    /// The bar is out (it also shows whenever there are words).
    var revealed = false

    /// Words or the keyboard are in it: scrolling away must not take it.
    @ObservationIgnored var holding = false
    /// When it came out: the list's own inset settling at that moment must not read as scrolling away.
    @ObservationIgnored var revealedAt = Date.distantPast
    /// A finger is on the list. A bounce after a flick up to the top is not a pull.
    @ObservationIgnored var touching = false
    /// The list is moving by the person's hand (dragging or still gliding). A list that got shorter under a filter
    /// jumps its offset by itself; that is not scrolling away and must never take the bar or the keyboard
    /// (owner, 2026-11-03: "after one letter keyboard vanishes").
    @ObservationIgnored var scrolling = false
    /// The pull went past the line with the finger down: the bar comes out when the finger lifts, as iOS's own search
    /// does, so the list's inset never changes under the finger.
    @ObservationIgnored var armed = false
    /// The bar's UIKit view, moved by the drag directly (a transform and an alpha; never a state).
    @ObservationIgnored private weak var bar: UIView?
    /// 0 hidden ... 1 out, as last drawn.
    @ObservationIgnored private var posed: CGFloat = 0
    @ObservationIgnored private let tap = UIImpactFeedbackGenerator(style: .light)

    // MARK: The state changes (once per gesture)

    func reveal() {
        guard !revealed else { return }
        revealedAt = Date()
        withAnimation(PullDownSearchTuning.slide) { revealed = true }
    }

    func hide() {
        holding = false
        guard revealed else { return }
        withAnimation(PullDownSearchTuning.slide) { revealed = false }
    }

    // MARK: The drag (no state)

    func attach(_ view: UIView, shown: Bool) {
        bar = view
        posed = shown ? 1 : 0
        place(posed)
    }

    /// The pull, in points past the top (0 ... the line), once per scroll frame. Moves the bar by transform and alpha.
    func pulled(_ pull: CGFloat) {
        // Words already hold the bar out (posed 1): a pull has nothing to reveal.
        guard touching, !revealed, posed == 0 else { return }
        let line = PullDownSearchTuning.threshold
        if pull > 0, posed == 0 { tap.prepare() }
        let t = min(pull / PullDownSearchTuning.barHeight, 1)
        place(t)
        let past = pull >= line
        if past, !armed { tap.impactOccurred() }
        armed = past
    }

    /// The finger went down or came up. Lifted past the line: out. Lifted short of it: back where it was.
    func touch(_ down: Bool) {
        guard down != touching else { return }
        touching = down
        guard !down else { return }
        if armed, !revealed {
            armed = false
            reveal()
        } else if !revealed, posed == 0 {
            armed = false
            settle(to: 0)
        }
    }

    /// Follows `shown` (revealed, or words in the field) with one animation.
    func setShown(_ shown: Bool) {
        let target: CGFloat = shown ? 1 : 0
        guard !touching || shown else { return }
        guard posed != target else { return }
        settle(to: target)
    }

    private func settle(to target: CGFloat) {
        posed = target
        let reduce = UIAccessibility.isReduceMotionEnabled
        UIView.animate(withDuration: reduce ? 0.12 : 0.3, delay: 0,
                       options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut]) {
            self.place(target)
        }
    }

    private func place(_ t: CGFloat) {
        guard let bar else { return }
        bar.transform = CGAffineTransform(translationX: 0, y: (t - 1) * PullDownSearchTuning.barHeight)
        bar.alpha = t
    }
}

/// Reads the pull: down past the top by this much (points) brings the bar out; this far down the list, it may go.
private enum PullDownSearchTuning {
    static let threshold: CGFloat = 64
    static let awayFrom: CGFloat = 40
    static let settle: TimeInterval = 0.8
    /// The bar's slot: a 40 pt field and 6 pt above and below. It never changes, so nothing is laid out by the pull.
    static let barHeight: CGFloat = 52

    /// The app's travel curve (no bounce: the list is settling from its pull), the short exit curve under Reduce Motion.
    static var slide: Animation {
        UIAccessibility.isReduceMotionEnabled ? Motion.exit : Motion.travel
    }
}

/// The two halves together, for the common screen.
private struct PullDownSearch: ViewModifier {
    @Binding var text: String
    let prompt: LocalizedStringKey
    var summon: Binding<Bool>?
    let enabled: Bool
    @State private var state = PullDownSearchState()

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .pullDownSearchReader($state, hasText: !text.isEmpty)
                .pullDownSearchField(text: $text, prompt: prompt, state: $state)
                // VoiceOver cannot pull a list past its top: the same bar, from the rotor's actions.
                .accessibilityAction(named: Text("Search")) { state.reveal() }
                .onChange(of: summon?.wrappedValue ?? false) { _, asked in
                    guard asked else { return }
                    summon?.wrappedValue = false
                    state.reveal()
                }
        } else {
            content
        }
    }
}

extension View {
    /// Reads the drag at the top of the scroll view this sits on and moves the bar with it. `onScrollGeometryChange`
    /// hears the scroll views inside the view it is given. Its action runs per frame only while the list is pulled
    /// down (the value is 0 otherwise, and an unchanged value calls nothing) and touches no state: it sets a transform.
    func pullDownSearchReader(_ state: Binding<PullDownSearchState>, hasText: Bool) -> some View {
        modifier(PullDownSearchReader(state: state.wrappedValue, hasText: hasText))
    }

    /// The bar itself: mounted once in a fixed slot under the navigation bar, plus the room it takes once out.
    func pullDownSearchField(text: Binding<String>, prompt: LocalizedStringKey, state: Binding<PullDownSearchState>) -> some View {
        modifier(PullDownSearchField(text: text, prompt: prompt, state: state.wrappedValue))
    }
}

private struct PullDownSearchReader: ViewModifier {
    let state: PullDownSearchState
    let hasText: Bool

    /// What the scroll view says, coarsely: how far past the top it is pulled (capped at the line and rounded to half a
    /// point, so a normal scroll is the same value on every frame and calls nothing), and whether it is scrolled away.
    private struct Reading: Equatable {
        var pull: CGFloat
        var away: Bool
    }

    func body(content: Content) -> some View {
        content
            // contentOffset.y + contentInsets.top is 0 at rest and negative past the top.
            .onScrollGeometryChange(for: Reading.self) { geo in
                let y = geo.contentOffset.y + geo.contentInsets.top
                let pull = min(max(-y, 0), PullDownSearchTuning.threshold)
                return Reading(pull: (pull * 2).rounded() / 2, away: y > PullDownSearchTuning.awayFrom)
            } action: { old, new in
                if new.pull != old.pull { state.pulled(new.pull) }
                // Only a scroll by hand hides it, and only with nothing typed and no keyboard up.
                if new.away, !old.away, state.scrolling, state.revealed, !state.holding, !hasText,
                   Date().timeIntervalSince(state.revealedAt) > PullDownSearchTuning.settle {
                    state.hide()
                }
            }
            .onScrollPhaseChange { _, phase in
                state.scrolling = phase != .idle
                state.touch(phase == .interacting || phase == .tracking)
            }
    }
}

private struct PullDownSearchField: ViewModifier {
    @Binding var text: String
    let prompt: LocalizedStringKey
    let state: PullDownSearchState

    private var shown: Bool { state.revealed || !text.isEmpty }

    func body(content: Content) -> some View {
        content
            // The room the bar takes once it is out. It changes once, when the finger has lifted, never under a drag.
            .safeAreaInset(edge: .top, spacing: 0) {
                Color.clear.frame(height: shown ? PullDownSearchTuning.barHeight : 0).allowsHitTesting(false)
            }
            .overlay(alignment: .top) {
                PullBarSlot(text: $text, prompt: prompt, shown: shown, state: state)
                    .frame(height: PullDownSearchTuning.barHeight)
                    .allowsHitTesting(shown)
                    .accessibilityHidden(!shown)
            }
    }
}

/// The bar's UIKit home: a clipping container of the slot's size holding the SwiftUI field. The drag moves the field's
/// view inside it, so a hidden bar is simply out of the container's bounds.
private final class PullBarController: UIViewController {
    let host: UIHostingController<PullBarContent>

    init(root: PullBarContent) {
        host = UIHostingController(rootView: root)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var bar: UIView { host.view }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.clipsToBounds = true
        view.backgroundColor = .clear
        addChild(host)
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        // Constraints, not a frame: the drag sets a transform on this view, and a frame is undefined under one.
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
    }
}

private struct PullBarSlot: UIViewControllerRepresentable {
    let text: Binding<String>
    let prompt: LocalizedStringKey
    let shown: Bool
    let state: PullDownSearchState

    private var content: PullBarContent { PullBarContent(text: text, prompt: prompt, shown: shown, state: state) }

    func makeUIViewController(context: Context) -> PullBarController {
        let controller = PullBarController(root: content)
        controller.loadViewIfNeeded()
        state.attach(controller.bar, shown: shown)
        return controller
    }

    func updateUIViewController(_ controller: PullBarController, context: Context) {
        controller.host.rootView = content
        state.setShown(shown)
    }
}

/// The field. Its words are its own (`draft`) until a short pause, Return or the keyboard going: the screen's search
/// text, and so its filter, is written once per pause, not per keystroke.
private struct PullBarContent: View {
    @Binding var text: String
    let prompt: LocalizedStringKey
    let shown: Bool
    let state: PullDownSearchState
    @State private var draft: String
    /// The last words handed to the screen: a change of the screen's text that is not this one came from outside.
    @State private var pushed: String
    @FocusState private var focused: Bool

    init(text: Binding<String>, prompt: LocalizedStringKey, shown: Bool, state: PullDownSearchState) {
        _text = text
        self.prompt = prompt
        self.shown = shown
        self.state = state
        _draft = State(initialValue: text.wrappedValue)
        _pushed = State(initialValue: text.wrappedValue)
    }

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("", text: $draft, prompt: Text(prompt))
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit { push() }
                if !draft.isEmpty {
                    Button { draft = ""; push() } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            // A solid fill, not glass or material: the list scrolls under this (CONVENTIONS rule 16).
            .background(Theme.card, in: .capsule)
            Button("Cancel") { cancel() }
                .tint(Theme.accent)
        }
        .padding(.horizontal, 16)
        .frame(height: PullDownSearchTuning.barHeight)
        .task(id: draft) {
            try? await Task.sleep(for: .milliseconds(140))
            guard !Task.isCancelled else { return }
            push()
        }
        .onChange(of: text) { _, now in
            // The screen cleared or set the words itself.
            if now != pushed { pushed = now; draft = now }
        }
        .onChange(of: draft) { _, _ in syncHolding() }
        .onChange(of: focused) { _, now in
            syncHolding()
            if !now { push() }
            // The keyboard went and nothing was typed: the bar has done its job.
            if !now, draft.isEmpty, shown { state.hide() }
        }
        .onChange(of: shown) { _, now in
            // Out by a pull or the rotor (not because words were set): take the keyboard. The field exists already, so
            // there is nothing to wait for.
            if now, draft.isEmpty { focused = true }
        }
    }

    private func push() {
        guard text != draft else { return }
        pushed = draft
        text = draft
    }

    private func syncHolding() {
        state.holding = !draft.isEmpty || focused
    }

    private func cancel() {
        draft = ""
        push()
        focused = false
        state.hide()
    }
}

#endif
