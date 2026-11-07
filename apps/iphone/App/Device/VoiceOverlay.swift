import SwiftUI
import ERPCore

/// Voice over whatever is open (owner, 2026-11-02: "should work in the background and not have me have to open a whole
/// ass screen"): a small glass capsule above the tab bar and the + with the orb, the words as they are heard, then
/// the answer or what is about to be saved and its yes. Several steps open it a little upward, never into a sheet.
/// The page beneath stays live: it scrolls, its buttons work, a page the plan opens is pushed beneath the capsule, and
/// a saved change shows there as its shelf updates. Closed with ✕, Escape, a swipe down or "no"; Siri, the Action
/// button and Control Center open it listening (RootView, MacShell).
///
/// Glass, as the control layer it is (CONVENTIONS rule 4); it appears and goes without a transition of its own, since
/// glass forming mid-fade draws a stray bubble (rule 16), while what is inside it moves on the house's curves.
struct VoiceOverlay: View {
    /// Opens a page beneath the overlay (a path of the ERP).
    let open: (String) -> Void
    /// Whether this copy is the one in front: RootView puts one over the tabs and one inside the page sheet, and only
    /// the frontmost draws.
    var active = true
    /// Room left under the capsule for what the page keeps at its foot (the tab bar and the +, an action bar).
    var bottomInset: CGFloat = 12

    @State private var voice = VoiceSession.shared
    @State private var lock = AppLock.shared
    @State private var typing = false
    @State private var typed = ""
    @State private var drag: CGFloat = 0
    @FocusState private var typingFocused: Bool
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    private var away: Bool { lock.locked || lock.covered }
    private var listeningNow: Bool { voice.phase == .listening || voice.phase == .thinking }

    var body: some View {
        if voice.shown && active {
            capsule
                .frame(maxWidth: 560)
                .padding(.horizontal, pt(12))
                .padding(.bottom, bottomInset)
                .offset(y: max(0, drag))
                // A container a screen reader enters and leaves, named for what it is; the answer is announced
                // (VoiceSession.announce). Not modal: the page beneath is still the person's.
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Voice assistant")
                .accessibilityAction(.escape) { voice.dismiss() }
                .sensoryFeedback(.start, trigger: voice.startTick)
                .moneyFeedback(success: voice.savedTick, failure: voice.refusedTick)
                // Behind the lock or the app switcher's photograph the microphone is closed, and opens again with the app.
                .onChange(of: away) { _, now in now ? voice.pause() : voice.resume() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { voice.pause() } else if phase == .active, !away { voice.resume() }
                }
                .onChange(of: voice.openTick) { _, _ in if let path = voice.openPath { go(path) } }
                .task {
                    book.customers.need(); book.products.need(); book.settings.need()
                }
        }
    }

    /// A page of the ERP opens beneath; "call her" rings.
    private func go(_ path: String) {
        if path.hasPrefix("tel:") {
            if let url = URL(string: path) { openURL(url) }
        } else {
            open(path)
        }
    }

    // MARK: The capsule

    private var capsule: some View {
        VStack(alignment: .leading, spacing: pt(10)) {
            if let message = voice.failure { failureLine(message) }
            if let plan = voice.plan, showsSteps(plan) { steps(plan) }
            if typing || voice.phase == .unavailable { typedField }
            HStack(alignment: .center, spacing: pt(10)) {
                orb
                words.frame(maxWidth: .infinity, alignment: .leading)
                controls
            }
            // A swipe down on the row puts it away (on the row only: the steps above it scroll).
            .gesture(DragGesture(minimumDistance: 12)
                .onChanged { drag = $0.translation.height }
                .onEnded { g in
                    if g.translation.height > 60 { voice.dismiss() }
                    Motion.run(Motion.exit, reduce: reduceMotion) { drag = 0 }
                })
            if let action = primary { doIt(action) }
        }
        .padding(pt(12))
        .glassEffect(.regular, in: .rect(cornerRadius: Radius.card + 6, style: .continuous))
        .motion(voice.plan?.cards.count ?? 0)
        .motion(voice.failure)
        .motion(typing)
    }

    private var orb: some View {
        Button {
            if voice.phase == .paused { voice.resume() } else { voice.finishNow() }
        } label: {
            VoiceOrb(tap: VoiceEngine.shared.tap, mode: orbMode, diameter: 44)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .allowsHitTesting(listeningNow || voice.phase == .paused)
        .accessibilityLabel(orbLabel)
    }

    @ViewBuilder
    private var words: some View {
        VStack(alignment: .leading, spacing: pt(2)) {
            if voice.phase == .thinking {
                Text(voice.heard).font(.house(.subheadline).weight(.medium)).lineLimit(1).truncationMode(.head)
                Text("Reading it…").font(.house(.footnote)).foregroundStyle(.secondary).modifier(VoiceShimmer())
            } else if !voice.liveWords.isEmpty {
                // The newest words are the ones to see: an overflowing sentence loses its start.
                Text(liveText).font(.house(.subheadline).weight(.medium)).lineLimit(2).truncationMode(.head)
                    .accessibilityAddTraits(.updatesFrequently)
            } else if let headline {
                Text(headline).font(.house(.subheadline).weight(.medium)).lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(statusLine).font(.house(.footnote)).foregroundStyle(.secondary).lineLimit(1)
            } else {
                Text(statusLine).font(.house(.subheadline)).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .contentTransition(.opacity)
    }

    private var controls: some View {
        HStack(spacing: pt(2)) {
            Menu {
                Button(typing ? "Hide keyboard" : "Type instead", systemImage: "keyboard") {
                    Motion.run(reduce: reduceMotion) { typing.toggle() }
                    typingFocused = typing
                }
                Button(voice.speakAnswers ? "Stop reading aloud" : "Read answers aloud",
                       systemImage: voice.speakAnswers ? "speaker.slash" : "speaker.wave.2") {
                    voice.setSpeaking(!voice.speakAnswers)
                }
            } label: {
                Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .menuStyle(.button).buttonStyle(.plain)
            .accessibilityLabel("Voice options")
            Button { voice.dismiss() } label: {
                Image(systemName: "xmark").font(.house(.body).weight(.semibold))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(voice.phase == .saving)
            .accessibilityLabel("Close voice")
        }
        .foregroundStyle(.secondary)
    }

    // MARK: What it says

    /// The answer, or what the plan will do, in a line or three.
    private var headline: String? {
        guard let plan = voice.plan else { return nil }
        if let answer = plan.answer { return answer }
        if !plan.operations.isEmpty && voice.completed == plan.operations.count { return "Saved." }
        if plan.cards.count == 1, let card = plan.cards.first { return card.summary }
        if plan.cards.count > 1 { return "\(plan.cards.count) changes" }
        return nil
    }

    private var statusLine: String {
        switch voice.phase {
        case .starting: return "Getting ready…"
        case .paused: return "Tap the mic to listen again"
        case .unavailable: return voice.unavailable ?? "Voice isn't available. You can type."
        case .saving: return "Saving…"
        default:
            guard let plan = voice.plan else {
                if let focus = VoiceContext.shared.focus { return "Listening · about \(focus.label)" }
                return "Say what you need"
            }
            if voice.completed > 0 && voice.completed == plan.operations.count { return "Say what's next" }
            if plan.operations.isEmpty { return plan.opensAlone != nil ? "Opened. Say what's next" : "Ask another, or say what to do" }
            return plan.ready ? "Say “yes” to save, or what to change" : "Say what to change"
        }
    }

    private var orbMode: VoiceOrb.Mode {
        switch voice.phase {
        case .listening: return .listening
        case .thinking, .saving: return .thinking
        default: return .idle
        }
    }

    private var orbLabel: String {
        switch voice.phase {
        case .paused: return "Listen again"
        case .listening: return voice.liveWords.isEmpty ? "Listening" : "Finish speaking"
        case .thinking: return "Reading what you said"
        default: return "Voice"
        }
    }

    /// Settled words firm, the ones still changing quieter: they settle as the recogniser decides.
    private var liveText: AttributedString {
        var text = AttributedString(voice.settled)
        text.foregroundColor = .primary
        if !voice.volatile.isEmpty {
            var rest = AttributedString((voice.settled.isEmpty ? "" : " ") + voice.volatile)
            rest.foregroundColor = .secondary
            text.append(rest)
        }
        return text
    }

    // MARK: Steps, failures, typing

    /// The steps show when there is more than one, or when one needs a look (a problem, a form to fill, a record to open).
    private func showsSteps(_ plan: NativeVoicePlan) -> Bool {
        plan.cards.count > 1 || plan.cards.contains { $0.problem != nil || $0.handoff != nil }
            || (plan.answer != nil && plan.href != nil)
            || (!plan.operations.isEmpty && voice.completed == plan.operations.count && plan.cards.last?.href != nil)
    }

    private func steps(_ plan: NativeVoicePlan) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: pt(8)) {
                if plan.answer != nil, let path = plan.href {
                    Button("Open page", systemImage: "arrow.up.right") { open(path) }.buttonStyle(.bordered)
                }
                ForEach(Array(plan.cards.enumerated()), id: \.offset) { n, card in
                    step(card, number: plan.cards.count > 1 ? n + 1 : nil)
                }
                if !plan.operations.isEmpty && voice.completed == plan.operations.count, let path = plan.cards.last?.href {
                    Button("Open record", systemImage: "arrow.up.right") { go(path) }.buttonStyle(.bordered)
                } else if voice.completed > 0 {
                    Text("\(voice.completed) of \(plan.operations.count) changes saved.").font(.house(.footnote)).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: pt(220))
        .opacity(voice.phase == .thinking ? 0.45 : 1)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func step(_ card: NativeVoiceCard, number: Int?) -> some View {
        VStack(alignment: .leading, spacing: pt(4)) {
            HStack(alignment: .firstTextBaseline, spacing: pt(6)) {
                if let number { Text("\(number)").font(.house(.footnote).weight(.semibold).monospacedDigit()).foregroundStyle(.secondary) }
                Text(card.summary).font(.house(.subheadline)).fixedSize(horizontal: false, vertical: true)
            }
            if let problem = card.problem {
                Label(problem, systemImage: "exclamationmark.circle").font(.house(.footnote)).foregroundStyle(Tone.owed.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if card.operations.isEmpty, let path = card.href, card.problem == nil || card.handoff != nil || path.hasPrefix("/") {
                Button(card.handoff == nil ? "Open record" : "Fill the form", systemImage: "arrow.up.right") {
                    do {
                        try NativeVoiceHandoff.apply(card.handoff, book: book, person: session.shop.person)
                        go(card.handoff == nil ? path : NativeVoiceHandoff.resuming(path))
                    } catch { voice.failure = error.localizedDescription }
                }
                .buttonStyle(.bordered).controlSize(.small)
                .disabled(voice.phase == .saving || !book.customers.loaded || !book.products.loaded || !book.settings.loaded)
            }
        }
    }

    private func failureLine(_ message: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: pt(8)) {
            Label(message, systemImage: "exclamationmark.triangle").font(.house(.footnote)).foregroundStyle(Tone.problem.color)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if voice.canRetry { Button("Try again") { voice.retry() }.buttonStyle(.bordered).controlSize(.small) }
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private var typedField: some View {
        HStack(alignment: .bottom, spacing: pt(8)) {
            TextField("Type what you need…", text: $typed, axis: .vertical)
                .lineLimit(1...3).focused($typingFocused).submitLabel(.send)
                .onSubmit(sendTyped)
            Button("Send", systemImage: "arrow.up") { sendTyped() }
                .labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || voice.phase == .thinking || voice.phase == .saving)
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func sendTyped() {
        let words = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        typed = ""
        voice.submitTyped(words)
    }

    // MARK: Do it

    private struct Primary {
        let title: String
        let busy: Bool
        let second: Bool
    }

    /// "Do it" and "Not now" when the plan is ready to save; the same as saying "yes" or "no".
    private var primary: Primary? {
        guard let plan = voice.plan, plan.ready, !plan.operations.isEmpty, voice.completed < plan.operations.count else { return nil }
        return Primary(title: voice.completed > 0 ? "Save the rest" : "Do it", busy: voice.phase == .saving, second: voice.completed == 0)
    }

    private func doIt(_ action: Primary) -> some View {
        HStack(spacing: pt(8)) {
            if action.second {
                Button("Not now") { voice.dismissPlan() }
                    .buttonStyle(.bordered).disabled(action.busy)
            }
            Spacer(minLength: 0)
            Text("Or say “yes”").font(.house(.footnote)).foregroundStyle(.secondary).opacity(action.busy ? 0 : 1)
            Button {
                voice.save()
            } label: {
                Label(action.title, systemImage: "checkmark").frame(minWidth: 72).busy(action.busy)
            }
            .buttonStyle(.houseProminent)
            .disabled(action.busy || voice.phase == .thinking)
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
}
