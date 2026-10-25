import SwiftUI
import Observation
import AVFoundation
import ERPCore
#if canImport(UIKit)
import UIKit
#endif

/// Voice is a native sheet that listens the way Siri does (owner, 2026-10-25: "as smooth and continuous and immediate
/// and snappy as Siri"). The microphone is live within a moment of the tap (VoiceEngine.warm has done the waiting),
/// the words stream in as they are said, a second of quiet after speech starts the reading without a tap, the plan
/// appears while the microphone stays open, and the next sentence ("change the amount to 50,000", "also add tea 300",
/// "yes") refines the same plan. Speech only prepares a reading; writes still go through ERPAPI (money awaited) or the
/// Outbox (everything else).
struct NativeVoiceScreen: View {
    let open: (String) -> Void
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var lock = AppLock.shared
    @State private var voice = NativeVoiceSession()
    @State private var typing = false
    @State private var typed = ""
    @FocusState private var typingFocused: Bool

    private var away: Bool { lock.locked || lock.covered }
    private var listeningNow: Bool { voice.phase == .listening || voice.phase == .thinking }

    var body: some View {
        VStack(spacing: 0) {
            hero
            ScrollView {
                VStack(spacing: 12) {
                    if typing || voice.phase == .unavailable { typedField }
                    if let message = voice.failure { failureCard(message) }
                    if let plan = voice.plan { planCards(plan) }
                }
                .padding(.horizontal).padding(.bottom, 16)
                .opacity(voice.phase == .thinking && voice.plan != nil ? 0.45 : 1)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .modifier(VoiceDoIt(primary: doIt, secondary: notNow, summary: doItSummary))
        .navigationTitle("Voice").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { dismiss() }.disabled(voice.phase == .saving)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button(typing ? "Hide keyboard" : "Type instead", systemImage: "keyboard") {
                    typing.toggle()
                    typingFocused = typing
                }
                Button(voice.speakAnswers ? "Reading aloud is on" : "Reading aloud is off",
                       systemImage: voice.speakAnswers ? "speaker.wave.2.fill" : "speaker.slash") {
                    voice.setSpeaking(!voice.speakAnswers)
                }
            }
        }
        .interactiveDismissDisabled(voice.phase == .saving)
        // One tick as the microphone opens (the sheet itself is the first sign); a saved plan or a refusal has its own.
        .sensoryFeedback(.start, trigger: voice.startTick)
        .moneyFeedback(success: voice.savedTick, failure: voice.refusedTick)
        .onDisappear { voice.close() }
        // Behind the lock or the app switcher's photograph the microphone is closed, and opens again with the app.
        .onChange(of: away) { _, now in now ? voice.pause() : voice.resume() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { voice.pause() } else if phase == .active, !away { voice.resume() }
        }
        .task {
            book.customers.need(); book.products.need(); book.settings.need()
            voice.open()
        }
    }

    // MARK: The orb, the words

    private var hero: some View {
        VStack(spacing: 10) {
            Button {
                if voice.phase == .paused { voice.resume() } else { voice.finishNow() }
            } label: {
                VoiceOrb(tap: VoiceEngine.shared.tap, mode: orbMode, compact: voice.plan != nil)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .allowsHitTesting(listeningNow || voice.phase == .paused)
            .accessibilityLabel(orbLabel)

            Group {
                if voice.phase == .thinking {
                    VStack(spacing: 4) {
                        Text(voice.heard).font(.title3.weight(.medium)).multilineTextAlignment(.center)
                        Text("Reading it…").font(.subheadline).foregroundStyle(.secondary).modifier(VoiceShimmer())
                    }
                } else if !voice.liveWords.isEmpty {
                    Text(liveText).font(.title2.weight(.medium)).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.updatesFrequently)
                } else {
                    Text(statusLine).font(.title3).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 24).frame(maxWidth: .infinity, minHeight: 56)

            if !voice.liveWords.isEmpty && voice.phase == .listening {
                Button("Done", systemImage: "checkmark") { voice.finishNow() }
                    .buttonStyle(.glass).controlSize(.large)
                    .transition(.opacity)
            }
        }
        .padding(.top, 8).padding(.bottom, 12)
        .motion(voice.liveWords.isEmpty)
        .motion(voice.phase)
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

    private var statusLine: String {
        switch voice.phase {
        case .starting: return "Getting ready…"
        case .paused: return "Tap to listen again"
        case .unavailable: return voice.unavailable ?? "Voice isn't available. You can type."
        case .saving: return "Saving…"
        default:
            guard let plan = voice.plan else { return "Say what you need" }
            if voice.completed > 0 && voice.completed == plan.operations.count { return "Saved. Say what's next." }
            if plan.operations.isEmpty { return "Ask another question, or say what to do" }
            return plan.ready ? "Say “yes” to save, or what to change" : "Say what to change"
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

    // MARK: Typed, failed

    private var typedField: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Type what you need…", text: $typed, axis: .vertical)
                .lineLimit(1...4).focused($typingFocused).submitLabel(.send)
                .onSubmit(sendTyped)
            Button("Send", systemImage: "arrow.up") { sendTyped() }
                .labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || voice.phase == .thinking || voice.phase == .saving)
        }
        .ledgerCard()
    }

    private func sendTyped() {
        let words = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        typed = ""
        voice.submitTyped(words)
    }

    private func failureCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(Tone.problem.color)
                .fixedSize(horizontal: false, vertical: true)
            if voice.canRetry { Button("Try again", systemImage: "arrow.clockwise") { voice.retry() }.buttonStyle(.bordered) }
        }
        .ledgerCard()
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    // MARK: The plan

    @ViewBuilder
    private func planCards(_ plan: NativeVoicePlan) -> some View {
        if let answer = plan.answer {
            VStack(alignment: .leading, spacing: 10) {
                LedgerHeading(title: "Answer")
                Text(answer).fixedSize(horizontal: false, vertical: true)
                if let path = plan.href { Button("Open page", systemImage: "arrow.up.right") { open(path) }.buttonStyle(.bordered) }
            }
            .ledgerCard().transition(cardTransition)
        }
        ForEach(Array(plan.cards.enumerated()), id: \.offset) { _, card in
            VStack(alignment: .leading, spacing: 8) {
                LedgerHeading(title: card.title.capitalized)
                Text(card.summary).fixedSize(horizontal: false, vertical: true)
                if let problem = card.problem {
                    Label(problem, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Tone.owed.color)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if card.operations.isEmpty, let path = card.href {
                    Button(card.handoff == nil ? "Open record" : "Fill the form", systemImage: "arrow.up.right") {
                        do { try NativeVoiceHandoff.apply(card.handoff, book: book, person: session.shop.person); open(card.handoff == nil ? path : NativeVoiceHandoff.resuming(path)) }
                        catch { voice.failure = error.localizedDescription }
                    }
                    .buttonStyle(.bordered)
                    .disabled(voice.phase == .saving || !book.customers.loaded || !book.products.loaded || !book.settings.loaded)
                }
            }
            .ledgerCard().transition(cardTransition)
        }
        if !plan.operations.isEmpty && voice.completed == plan.operations.count {
            VStack(alignment: .leading, spacing: 10) {
                Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(Tone.settled.color)
                if let path = plan.cards.last?.href { Button("Open record", systemImage: "arrow.up.right") { open(path) }.buttonStyle(.bordered) }
            }
            .ledgerCard().transition(cardTransition)
        } else if voice.completed > 0 {
            Text("\(voice.completed) of \(plan.operations.count) changes saved.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var cardTransition: AnyTransition { .opacity.combined(with: .offset(y: 14)) }

    // MARK: Do it

    private var savable: Bool {
        guard let plan = voice.plan else { return false }
        return plan.ready && !plan.operations.isEmpty && voice.completed < plan.operations.count
    }

    private var doIt: ActionBar.Action? {
        guard savable else { return nil }
        return ActionBar.Action(voice.completed > 0 ? "Save the rest" : "Do it", systemImage: "checkmark",
                                isBusy: voice.phase == .saving, isDisabled: voice.phase == .thinking) { voice.save() }
    }

    private var notNow: [ActionBar.Action] {
        guard savable, voice.completed == 0 else { return [] }
        return [ActionBar.Action("Not now", isDisabled: voice.phase == .saving) { voice.dismissPlan() }]
    }

    private var doItSummary: String? { savable && voice.phase != .saving ? "Or say “yes”" : nil }
}

/// The page's one primary action when there is one, and nothing (no empty bar) when there is not: the content is
/// the same view either way, so the orb, the scroll and the keyboard are not rebuilt as a plan comes and goes.
private struct VoiceDoIt: ViewModifier {
    let primary: ActionBar.Action?
    let secondary: [ActionBar.Action]
    let summary: String?

    func body(content: Content) -> some View {
        #if os(macOS)
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if let primary { MacActionFooter(primary: primary, secondary: secondary, summary: summary) }
        }
        #else
        content.safeAreaBar(edge: .bottom, spacing: 0) {
            if let primary { ActionBar(primary: primary, secondary: secondary, summary: summary) }
        }
        #endif
    }
}

// MARK: The orb

/// The microphone's level as light: drawn at display rate from the audio thread's own RMS (smoothed quick-up,
/// slow-down in `VoiceAudioTap`), not polled. Thinking breathes. Under Reduce Motion nothing moves or scales: the
/// glow only brightens and dims, a few times a second.
struct VoiceOrb: View {
    enum Mode { case listening, thinking, idle }
    let tap: VoiceAudioTap
    let mode: Mode
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if reduceMotion {
                TimelineView(.periodic(from: .now, by: 0.2)) { context in orb(at: context.date, animated: false) }
            } else {
                TimelineView(.animation) { context in orb(at: context.date, animated: true) }
            }
        }
        .frame(height: compact ? 96 : 220)
        .overlay {
            Image(systemName: mode == .thinking ? "ellipsis" : "mic.fill")
                .font(compact ? .title3 : .title)
                .foregroundStyle(Theme.onAccent)
                .contentTransition(.symbolEffect(.replace))
        }
        .accessibilityHidden(true)
    }

    private func orb(at date: Date, animated: Bool) -> some View {
        let t = date.timeIntervalSinceReferenceDate
        let heard = mode == .listening ? CGFloat(tap.smoothedLevel()) : 0
        let level: CGFloat = mode == .thinking ? (animated ? 0.2 + 0.1 * CGFloat(sin(t * 3)) : 0.25) : heard
        let accent = Theme.accent
        return Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let base = min(size.width, size.height) * (compact ? 0.2 : 0.26)
            for i in 0..<3 {
                let wobble = animated ? CGFloat(sin(t * (0.9 + Double(i) * 0.4) + Double(i) * 2.0)) * 0.05 : 0
                let grow = animated ? level * (0.5 + 0.2 * CGFloat(i)) : 0
                let radius = base * (1.2 + 0.35 * CGFloat(i)) * (1 + grow + wobble)
                let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
                let strength: Double = (animated ? 0.3 : 0.12 + 0.3 * Double(level)) / Double(i + 1)
                context.fill(Path(ellipseIn: rect),
                             with: .radialGradient(Gradient(colors: [accent.opacity(strength), accent.opacity(0)]),
                                                   center: center, startRadius: 0, endRadius: radius))
            }
            let core = base * (1 + (animated ? level * 0.25 : 0))
            let coreRect = CGRect(x: center.x - core, y: center.y - core, width: core * 2, height: core * 2)
            context.fill(Path(ellipseIn: coreRect),
                         with: .radialGradient(Gradient(colors: [accent.opacity(0.95), accent.opacity(0.6)]),
                                               center: center, startRadius: 0, endRadius: core))
        }
    }
}

/// A band of light across waiting words; plain under Reduce Motion.
private struct VoiceShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            TimelineView(.animation) { context in
                let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.4) / 1.4
                content.overlay {
                    GeometryReader { geometry in
                        LinearGradient(colors: [.clear, Color.primary.opacity(0.8), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 0.5)
                            .offset(x: (CGFloat(phase) * 1.5 - 0.5) * geometry.size.width)
                    }
                    .mask(content)
                }
            }
        }
    }
}

/// Reads a result aloud, and keeps the microphone from hearing it: the ear closes while the voice speaks and a
/// fresh sentence begins when it stops. The session's category already ducks other audio (VoiceEngine), so music
/// dips and returns.
@MainActor
final class VoiceSpeaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    /// The voice has finished (or been cut off).
    var onFinish: (() -> Void)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    var speaking: Bool { synthesizer.isSpeaking }

    func say(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-IN") ?? AVSpeechSynthesisVoice(language: "en-GB")
        synthesizer.speak(utterance)
    }

    func stop() { synthesizer.stopSpeaking(at: .immediate) }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onMain { self.onFinish?() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        onMain { self.onFinish?() }
    }
}

@MainActor @Observable
final class NativeVoiceSession {
    enum Phase: Equatable { case starting, listening, paused, thinking, saving, unavailable }

    private(set) var phase: Phase = .starting
    /// The sentence being said: words the recogniser has settled, then the ones it is still deciding.
    private(set) var settled = ""
    private(set) var volatile = ""
    /// The words just sent to be read; the plan on screen answers them.
    private(set) var heard = ""
    private(set) var plan: NativeVoicePlan?
    private(set) var completed = 0
    private(set) var unavailable: String?
    private(set) var startTick = 0
    private(set) var savedTick = 0
    private(set) var refusedTick = 0
    private(set) var speakAnswers = UserDefaults.standard.object(forKey: "erp.voice.speak") as? Bool ?? true
    /// Why the last request failed; the screen offers Try again where `canRetry`.
    var failure: String?
    private(set) var canRetry = false

    var liveWords: String { [settled, volatile].filter { !$0.isEmpty }.joined(separator: " ") }

    /// The business open when the sheet opened: every request and save of this sheet goes to it, whatever happens
    /// to the switcher meanwhile (the sheet itself closes on a switch).
    private let business = House.business
    @ObservationIgnored private var turn: VoiceRecognizing?
    @ObservationIgnored private var turnToken = UUID()
    @ObservationIgnored private var failures = 0
    @ObservationIgnored private var startTask: Task<Void, Never>?
    @ObservationIgnored private var request: Task<Void, Never>?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var requestToken = UUID()
    @ObservationIgnored private var sent: (words: String, audio: Data?)?
    /// What was said while the last request was out: read next, in order.
    @ObservationIgnored private var queued: String?
    @ObservationIgnored private var closed = false
    @ObservationIgnored private lazy var speaker: VoiceSpeaker = {
        let s = VoiceSpeaker()
        s.onFinish = { [weak self] in self?.voiceFinished() }
        return s
    }()
    private var engine: VoiceEngine { VoiceEngine.shared }

    // MARK: Opening and closing

    /// The sheet is up. Everything slow was done when the mic first appeared (`VoiceEngine.warm`).
    func open() {
        guard phase == .starting, startTask == nil else { return }
        startTick += 1
        engine.warm()
        // The server reads the book's dozen collections in the background now, so the first sentence does not wait for them.
        let business = business
        Task { _ = try? await ERPAPI.shared.send("/api/voice/native", ["warm": true], timeout: 10, business: business) }
        startTask = Task { await listen() }
    }

    /// Permissions (asked once, remembered), the engine, a first sentence.
    private func listen() async {
        guard await VoicePermission.ensureMicrophone() else {
            unavailable = "Turn on Microphone for this app in Settings, or type your request."
            phase = .unavailable; return
        }
        _ = await VoicePermission.ensureSpeech()
        guard !closed, !Task.isCancelled else { return }
        do {
            engine.onInterruption = { [weak self] began in if began { self?.pause() } else { self?.resume() } }
            try engine.start()
        } catch {
            unavailable = error.localizedDescription
            phase = .unavailable; return
        }
        engine.tap.setEndpoint { [weak self] in onMain { self?.endpointDetected() } }
        beginTurn()
        if phase == .starting || phase == .paused { phase = .listening }
    }

    func close() {
        guard phase != .saving else { return }
        closed = true
        startTask?.cancel(); request?.cancel()
        turnToken = UUID(); turn?.cancel(); turn = nil
        speaker.stop()
        engine.onInterruption = nil
        engine.stop()
    }

    /// The app went behind the lock, the switcher or another app: the microphone closes. A request already out
    /// finishes; its answer waits on screen.
    func pause() {
        guard !closed, engine.running || phase == .listening else { return }
        turnToken = UUID(); turn?.cancel(); turn = nil
        speaker.stop()
        engine.stop()
        settled = ""; volatile = ""
        if phase == .listening { phase = .paused }
    }

    func resume() {
        guard !closed, !engine.running, phase != .starting, phase != .unavailable else { return }
        startTask?.cancel()
        startTask = Task { await listen() }
    }

    func setSpeaking(_ on: Bool) {
        speakAnswers = on
        UserDefaults.standard.set(on, forKey: "erp.voice.speak")
        if !on { speaker.stop(); engine.tap.setMuted(false) }
    }

    // MARK: Hearing

    /// A new sentence: a fresh recogniser, the quiet counted from nothing.
    private func beginTurn() {
        guard !closed else { return }
        turn?.cancel()
        settled = ""; volatile = ""
        let token = UUID()
        turnToken = token
        let next = engine.makeTurn(
            onText: { [weak self] settled, volatile in
                guard let self, self.turnToken == token else { return }
                self.failures = 0
                self.settled = settled.trimmingCharacters(in: .whitespacesAndNewlines)
                self.volatile = volatile.trimmingCharacters(in: .whitespacesAndNewlines)
            },
            onFail: { [weak self] blame in
                guard let self, self.turnToken == token else { return }
                self.turnFailed(blame: blame)
            })
        turn = next
        engine.tap.resetTurn()
        engine.tap.setSink { [weak next] buffer in next?.append(buffer) }
    }

    /// A recogniser that died at once is set aside for this run (the next kind takes over; the last is just the
    /// recording); one that merely timed out after a quiet spell is replaced.
    private func turnFailed(blame: Bool) {
        if blame {
            if turn is AnalyzerTurn { VoiceAssets.analyzerBroken = true }
            else if turn is SFTurn { VoiceAssets.speechBroken = true }
        }
        failures += 1
        guard failures < 6 else {
            unavailable = "Listening stopped working. You can type instead."
            turn?.cancel(); turn = nil; engine.stop()
            phase = .unavailable
            return
        }
        beginTurn()
    }

    /// A second of quiet after speech (VoiceAudioTap).
    private func endpointDetected() { finishTurn() }

    /// Done: whatever has been said is read now.
    func finishNow() {
        guard phase == .listening || phase == .thinking else { return }
        finishTurn()
    }

    private func finishTurn() {
        guard !closed, phase == .listening || phase == .thinking else { return }
        let words = liveWords
        let clip = turn as? ClipTurn
        if words.isEmpty && clip == nil {
            // A cough or a click, not a sentence: listen on.
            beginTurn(); return
        }
        turn?.finish()
        let audio = clip?.take()
        turn = nil
        if words.isEmpty && audio == nil { beginTurn(); return }
        // The microphone stays open for what comes next (a change, "yes"), whatever happens to this sentence.
        beginTurn()
        if phase == .thinking {
            if voiceReply(words) == .other { queued = [queued, words].compactMap { $0 }.joined(separator: " ") }
            return
        }
        route(words, audio: audio)
    }

    /// Typed words go the same way as spoken ones.
    func submitTyped(_ words: String) {
        guard phase != .thinking, phase != .saving else { return }
        route(words, audio: nil)
    }

    // MARK: Reading

    /// "Yes" and "no" answer a plan on screen; anything else is read (and, with a plan on screen, changes it).
    private func route(_ words: String, audio: Data?) {
        if audio == nil, plan != nil, completed == 0 {
            switch voiceReply(words) {
            case .yes: save(); return
            case .no: dismissPlan(); return
            case .other: break
            }
        }
        interpret(words, audio: audio)
    }

    private func interpret(_ words: String, audio: Data?) {
        request?.cancel(); speaker.stop(); engine.tap.setMuted(false)
        failure = nil; canRetry = false
        sent = (words, audio)
        heard = words.isEmpty ? "Your recording" : words
        phase = .thinking

        // With a plan not yet saved on screen the sentence is a change to it: the earlier words and the model's own
        // reading of them go with it (src/lib/voice/refine.ts).
        let refining = audio == nil && completed == 0 ? plan : nil
        var body: [String: Any]
        if let audio { body = ["audio": audio.base64EncodedString()] } else { body = ["text": words] }
        if let refining, let reading = refining.reading {
            body["previous"] = ["words": String(refining.reviewedWords.suffix(800)), "reading": reading]
        }
        let cumulative = refining.map { "\($0.reviewedWords), \(words)" } ?? words
        let token = UUID()
        requestToken = token
        let business = business
        let payload = body
        request = Task {
            do {
                // Half a minute is long: the model answers in about a second, so a request this slow has lost its line.
                let raw = try await ERPAPI.shared.send("/api/voice/native", payload, timeout: 30, business: business)
                guard requestToken == token, !Task.isCancelled else { return }
                let heardByServer = (raw["transcript"] as? String) ?? ""
                let reviewed = audio != nil && !heardByServer.isEmpty ? heardByServer : cumulative
                let next = NativeVoicePlan(raw, words: reviewed)
                if audio != nil && !heardByServer.isEmpty { heard = heardByServer }
                Motion.run(reduce: UIAccessibility.isReduceMotionEnabled) {
                    plan = next; completed = 0
                }
                settle()
                announce(Self.spoken(next))
                // A "yes" said while this was being read was about the plan before it: never carried onto this one.
                if let more = queued { queued = nil; if voiceReply(more) == .other { route(more, audio: nil) } }
            } catch {
                guard requestToken == token, !Task.isCancelled else { return }
                failure = Self.said(error); canRetry = true; refusedTick += 1
                queued = nil
                settle()
            }
        }
    }

    func retry() {
        guard phase != .thinking, let sent else { return }
        interpret(sent.words, audio: sent.audio)
    }

    /// The request is over: listening again, or paused if the app went away meanwhile.
    private func settle() {
        guard phase == .thinking || phase == .saving else { return }
        phase = engine.running ? .listening : .paused
    }

    private static func said(_ error: Error) -> String {
        if (error as? URLError)?.code == .timedOut { return "That took too long. Check the connection and try again." }
        return error.localizedDescription
    }

    /// One short line: the answer, the first thing wrong, or what is about to be saved.
    private static func spoken(_ plan: NativeVoicePlan) -> String {
        func short(_ text: String) -> String { text.count > 220 ? String(text.prefix(220)) + "…" : text }
        if let answer = plan.answer { return short(answer) }
        if let problem = plan.cards.compactMap(\.problem).first { return short(problem) }
        guard !plan.operations.isEmpty else { return "" }
        if plan.cards.count == 1 { return short(plan.cards[0].summary) + ". Save it?" }
        return "\(plan.cards.count) changes. Save them?"
    }

    func dismissPlan() {
        speaker.stop(); engine.tap.setMuted(false)
        Motion.run(reduce: UIAccessibility.isReduceMotionEnabled) { plan = nil; completed = 0; failure = nil }
        heard = ""
    }

    // MARK: Saving

    /// Money is awaited, as everywhere (the ERP's answer is the person's); the rest leaves through the Outbox and
    /// finishes in the background.
    func save() {
        guard let plan, plan.ready, !plan.operations.isEmpty, completed < plan.operations.count,
              phase == .listening || phase == .paused else { return }
        speaker.stop(); engine.tap.setMuted(false)
        failure = nil; canRetry = false
        phase = .saving
        let business = business
        saveTask = Task {
            do {
                var index = 0
                for card in plan.cards {
                    for operation in card.operations {
                        defer { index += 1 }
                        if index < completed { continue }
                        if Outbox.moneyOps.contains(operation.op) {
                            _ = try await ERPAPI.shared.write(operation.op, operation.fields, business: business)
                        } else {
                            Outbox.shared.send(op: operation.op, fields: operation.fields, business: business, label: card.title)
                        }
                        completed += 1
                    }
                }
                savedTick += 1
                settle()
                announce("Saved.")
            } catch {
                failure = Self.said(error); canRetry = false; refusedTick += 1
                settle()
            }
        }
    }

    // MARK: Speaking

    /// Aloud when reading aloud is on (the microphone closes meanwhile); to a screen reader as an announcement instead,
    /// which would otherwise say it twice.
    private func announce(_ text: String) {
        guard !text.isEmpty, !closed else { return }
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text); return
        }
        guard speakAnswers else { return }
        engine.tap.setMuted(true)
        speaker.say(text)
    }

    private func voiceFinished() {
        guard !closed else { return }
        engine.tap.setMuted(false)
        if phase == .listening || phase == .thinking { beginTurn() }
    }
}

struct NativeVoiceCard {
    let title: String
    let summary: String
    let problem: String?
    let operations: [(op: String, fields: [String: Any])]
    let href: String?
    let handoff: [String: Any]?
    init(_ raw: [String: Any]) {
        title = raw["title"] as? String ?? "Review"
        summary = raw["summary"] as? String ?? ""
        problem = raw["problem"] as? String
        operations = (raw["operations"] as? [[String: Any]] ?? []).compactMap {
            guard let op = $0["op"] as? String, let fields = $0["fields"] as? [String: Any] else { return nil }
            return (op, fields)
        }
        href = raw["href"] as? String
        handoff = raw["handoff"] as? [String: Any]
    }
}

struct NativeVoicePlan {
    var reviewedWords: String
    let cards: [NativeVoiceCard]
    let answer: String?
    let href: String?
    /// The model's own reading, sent back with the next change so one plan is refined (src/lib/voice/refine.ts).
    let reading: [String: Any]?
    var operations: [(op: String, fields: [String: Any])] { cards.flatMap(\.operations) }
    var ready: Bool { cards.allSatisfy { $0.problem == nil && $0.handoff == nil } }
    init(_ raw: [String: Any], words: String) {
        reviewedWords = words
        reading = raw["reading"] as? [String: Any]
        cards = (raw["cards"] as? [[String: Any]] ?? []).map(NativeVoiceCard.init)
        answer = raw["answer"] as? String
        href = raw["href"] as? String
    }
}


enum NativeVoiceHandoff {
    /// The filled order or sale form opens on the draft just written (`?resume=1`), not blank (decisions.md "Drafts").
    static func resuming(_ path: String) -> String {
        let bare = ScreenRoute.bare(path)
        guard bare == "/orders/add" || bare == "/invoices/new" else { return path }
        return path + (path.contains("?") ? "&" : "?") + "resume=1"
    }

    @MainActor static func apply(_ handoff: [String: Any]?, book: Book, person: String?) throws {
        guard let handoff else { return }
        let kind = handoff["kind"] as? String ?? ""
        let payload = handoff["payload"] as? [String: Any] ?? [:]
        if kind == "order" {
            let customerId = ((payload["customer"] as? [String: Any])?["pinned"] as? [String: Any])?["id"] as? String ?? ""
            let karigarId = ((payload["karigar"] as? [String: Any])?["pinned"] as? [String: Any])?["id"] as? String ?? ""
            let scan = try JSONDecoder().decode(NewOrderScanAnswer.self, from: JSONSerialization.data(withJSONObject: payload))
            var draft = NewOrderDraftStore.load() ?? NewOrderDraft()
            let firstPiece = draft.pieces.count
            draft.fill(fromSlip: scan, customer: book.customers.item(customerId), heardCustomer: nil, karigarId: karigarId,
                       photos: [], fallbackMetal: House.metal, settings: book.settings.value)
            for (i, piece) in scan.items.enumerated() {
                if let price = piece.lineTotal, price > 0, firstPiece + i < draft.pieces.count {
                    draft.pieces[firstPiece + i].manual = true
                    draft.pieces[firstPiece + i].manualPrice = NewOrderSlip.jsNumber(rupees(price))
                }
            }
            if let method = payload["advanceMethod"] as? String { draft.advanceMethod = method }
            if draft.takenBy.isEmpty { draft.takenBy = person ?? "" }
            NewOrderDraftStore.save(draft, business: House.business.id)
        } else if kind == "sale" {
            var raw = payload
            raw["amountPaid"] = payload["paid"]
            let answer = try JSONDecoder().decode(SaleBillAnswer.self, from: JSONSerialization.data(withJSONObject: raw))
            let reading = SaleBillReading.resolve(answer, customers: book.customers.items)
            var draft = SaleDraftStore.load() ?? SaleDraft()
            _ = draft.fill(fromBill: reading, customer: (payload["customerId"] as? String).flatMap { book.customers.item($0) }, fallbackMetal: House.metal)
            if let method = payload["method"] as? String, !draft.payments.isEmpty { draft.payments[0].method = method }
            if draft.takenBy.isEmpty { draft.takenBy = person ?? "" }
            SaleDraftStore.save(draft, business: House.business.id)
            for sku in payload["skus"] as? [String] ?? [] {
                guard let product = book.products.items.first(where: { $0.sku == sku }) else { continue }
                SaleDraftStore.add(product)
            }
        } else if kind == "piece" {
            // A new piece for stock: the product form opens on it (/products/add?voice=1, StockPieceForm).
            StockVoiceSeed.put(payload)
        } else {
            throw ERPAPI.Failure(status: 0, message: "Open the native form and enter the details shown above.")
        }
    }
}
