import SwiftUI
import Observation
import AVFoundation
import ERPCore
#if canImport(UIKit)
import UIKit
#endif

/// Voice listens the way Siri does (owner, 2026-10-25: "as smooth and continuous and immediate and snappy as Siri"),
/// and since 2026-11-02 it does so over whatever screen is open rather than on a screen of its own (owner: "should
/// work in the background and not have me have to open a whole ass screen"): `VoiceOverlay` is a small glass capsule
/// above the tab bar, driven by the one `VoiceSession` below, which the mic button, ⌘-menu and Siri / the Action
/// button / Control Center all open. The microphone is live within a moment (VoiceEngine.warm has done the waiting),
/// the words stream in as they are said, a second of quiet after speech starts the reading without a tap, the plan
/// appears while the microphone stays open, and the next sentence ("change the amount to 50,000", "also add tea 300",
/// "yes") refines the same plan. Each sentence carries the record on screen (VoiceContext), so "make it 22 karat" needs
/// no name. Speech only prepares a reading; writes still go through ERPAPI (money awaited) or the Outbox (the rest),
/// and the screen beneath shows them as its shelves update.

// MARK: The orb

/// The microphone's level as light: drawn at display rate from the audio thread's own RMS (smoothed quick-up,
/// slow-down in `VoiceAudioTap`), not polled. Thinking breathes. Under Reduce Motion nothing moves or scales: the
/// glow only brightens and dims, a few times a second.
struct VoiceOrb: View {
    enum Mode { case listening, thinking, idle }
    let tap: VoiceAudioTap
    let mode: Mode
    var compact = false
    /// The overlay's orb: a fixed circle this wide (nil: the full-width orb, 96 or 220 high).
    var diameter: CGFloat?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if reduceMotion {
                TimelineView(.periodic(from: .now, by: 0.2)) { context in orb(at: context.date, animated: false) }
            } else {
                TimelineView(.animation) { context in orb(at: context.date, animated: true) }
            }
        }
        .frame(width: diameter, height: diameter ?? (compact ? 96 : 220))
        .overlay {
            Image(systemName: mode == .thinking ? "ellipsis" : "mic.fill")
                .font(diameter != nil ? .callout.weight(.semibold) : compact ? .title3 : .title)
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
            let base = min(size.width, size.height) * (diameter != nil ? 0.3 : compact ? 0.2 : 0.26)
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
struct VoiceShimmer: ViewModifier {
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

/// The one voice conversation, app-wide: the overlay draws it, and the mic button, the menus and the Siri / Action
/// button / Control Center launch (Shared/VoiceLaunch.swift) open it. One instance, so a second launch while it is
/// up only brings it back to listening, and the plan on it survives a page opened beneath it.
@MainActor @Observable
final class VoiceSession {
    enum Phase: Equatable { case starting, listening, paused, thinking, saving, unavailable }

    /// App-wide; a business's plan, so closed on a switch (Businesses.resetPerBusinessState).
    static let shared = VoiceSession()
    static func reset() { shared.dismiss(force: true) }

    /// The overlay is up.
    private(set) var shown = false
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
    /// A page the plan opened by itself ("open Fatema's order", "call her"): the overlay's host opens `openPath` each
    /// time the tick moves, and the overlay stays over it.
    private(set) var openPath: String?
    private(set) var openTick = 0
    /// Why the last request failed; the overlay offers Try again where `canRetry`.
    var failure: String?
    private(set) var canRetry = false

    var liveWords: String { [settled, volatile].filter { !$0.isEmpty }.joined(separator: " ") }

    /// The business open when the overlay opened: every request and save of this conversation goes to it, whatever
    /// happens to the switcher meanwhile (a switch closes the overlay).
    @ObservationIgnored private var business = House.business
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
    @ObservationIgnored private var closed = true
    @ObservationIgnored private lazy var speaker: VoiceSpeaker = {
        let s = VoiceSpeaker()
        s.onFinish = { [weak self] in self?.voiceFinished() }
        return s
    }()
    private var engine: VoiceEngine { VoiceEngine.shared }

    // MARK: Opening and closing

    /// The overlay comes up listening (or, already up, listens again).
    func present() {
        if shown {
            if phase == .paused { resume() }
            return
        }
        settled = ""; volatile = ""; heard = ""; plan = nil; completed = 0
        failure = nil; canRetry = false; unavailable = nil; queued = nil; sent = nil
        failures = 0; closed = false; phase = .starting
        business = House.business
        shown = true
        open()
    }

    /// Closed with its button, Escape, a swipe down, "no" with nothing on it, the lock or a switch. A save already
    /// under way finishes first (a money write is never cut off); `force` is for the switch and the lock, where the
    /// save's own Task still finishes in the background.
    func dismiss(force: Bool = false) {
        guard shown, force || phase != .saving else { return }
        close()
        shown = false
        settled = ""; volatile = ""; heard = ""; plan = nil; completed = 0; failure = nil
        openPath = nil
    }

    /// Everything slow was done when the mic first appeared (`VoiceEngine.warm`).
    private func open() {
        guard phase == .starting, !closed else { return }
        startTick += 1
        engine.warm()
        // The server reads the book's dozen collections in the background now, so the first sentence does not wait for them.
        let business = business
        Task { _ = try? await ERPAPI.shared.send("/api/voice/native", ["warm": true], timeout: 10, business: business) }
        startTask?.cancel()
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

    private func close() {
        closed = true
        startTask?.cancel(); startTask = nil; request?.cancel()
        turnToken = UUID(); turn?.cancel(); turn = nil
        speaker.stop()
        engine.onInterruption = nil
        engine.stop()
    }

    /// The app went behind the lock, the switcher or another app: the microphone closes. A request already out
    /// finishes; its answer waits on the overlay.
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

    /// "Yes" and "no" answer a plan on the overlay; anything else is read (and, with a plan up, changes it). "No"
    /// with nothing on it puts the overlay away, as a person waves Siri off.
    private func route(_ words: String, audio: Data?) {
        if audio == nil, plan != nil, completed == 0 {
            switch voiceReply(words) {
            case .yes: save(); return
            case .no: dismissPlan(); return
            case .other: break
            }
        } else if audio == nil, plan == nil, failure == nil, voiceReply(words) == .no {
            dismiss(); return
        }
        interpret(words, audio: audio)
    }

    private func interpret(_ words: String, audio: Data?) {
        request?.cancel(); speaker.stop(); engine.tap.setMuted(false)
        failure = nil; canRetry = false
        sent = (words, audio)
        heard = words.isEmpty ? "Your recording" : words
        phase = .thinking

        // With a plan not yet saved on the overlay the sentence is a change to it: the earlier words and the model's
        // own reading of them go with it (src/lib/voice/refine.ts).
        let refining = audio == nil && completed == 0 ? plan : nil
        var body: [String: Any]
        if let audio { body = ["audio": audio.base64EncodedString()] } else { body = ["text": words] }
        if let refining, let reading = refining.reading {
            body["previous"] = ["words": String(refining.reviewedWords.suffix(800)), "reading": reading]
        }
        // What is open beneath the overlay: "change the weight to 12 grams" is about this order (context.ts).
        if let focus = VoiceContext.shared.focus { body["context"] = focus.payload }
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
                // A page the plan only opens is opened at once, beneath the overlay, which stays for what comes next.
                if let path = next.opensAlone { openPath = path; openTick += 1 }
                // A "yes" said while this was being read was about the plan before it: never carried onto this one.
                if let more = queued { queued = nil; if voiceReply(more) == .other { route(more, audio: nil) } }
            } catch {
                guard requestToken == token, !Task.isCancelled else { return }
                failure = Self.said(error); canRetry = true; refusedTick += 1
                queued = nil
                settle()
                announce(failure ?? "")
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
    static func spoken(_ plan: NativeVoicePlan) -> String {
        func short(_ text: String) -> String { text.count > 220 ? String(text.prefix(220)) + "…" : text }
        if let answer = plan.answer { return short(answer) }
        if let problem = plan.cards.compactMap(\.problem).first { return short(problem) }
        guard !plan.operations.isEmpty else { return plan.opensAlone != nil ? (plan.cards.first?.summary ?? "") : "" }
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
    /// finishes in the background, and the screen beneath updates as its shelf does.
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
                announce(failure ?? "")
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
    /// The page a plan only opens ("open Fatema's order", "analytics kholo", "call her"): one card, nothing to save,
    /// nothing wrong, no form to fill. Opened at once beneath the overlay.
    var opensAlone: String? {
        guard answer == nil, cards.count == 1, let card = cards.first, card.operations.isEmpty, card.problem == nil,
              card.handoff == nil, let path = card.href, path.hasPrefix("/") || path.hasPrefix("tel:") else { return nil }
        return path
    }
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
