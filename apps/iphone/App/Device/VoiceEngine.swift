import Foundation
import AVFoundation
import Speech

// The ears of the native voice sheet (NativeVoice.swift): everything between the microphone and the words.
// Owner, 2026-10-25: "The voice function on iOS should be as smooth and continuous and immediate and snappy as Siri."
// Nothing here waits for the tap: permissions are asked once and remembered, the audio session's category, the engine
// graph and the on-device speech model are made ready when the mic first appears (`VoiceEngine.warm`), and the
// microphone stays open across a whole conversation, one recogniser "turn" per sentence.
// Compiles on the Mac too (AVAudioSession is the phone's only: guarded, as the rest of App/Device does).

/// Runs `work` on the main actor from any thread, in the order it was called (a queue hop, not a Task: a recogniser's
/// partial results must not overtake one another).
func onMain(_ work: @escaping @MainActor () -> Void) {
    DispatchQueue.main.async { MainActor.assumeIsolated { work() } }
}

// MARK: Permissions

/// Asked on the first use only. A granted or refused answer is read back from the system, never asked again.
@MainActor
enum VoicePermission {
    static var microphoneGranted: Bool { AVAudioApplication.shared.recordPermission == .granted }

    static func ensureMicrophone() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        default:
            return await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
            }
        }
    }

    /// Speech recognition is the fallback recogniser's (and a refusal costs nothing: the on-device transcriber, or the
    /// recording itself, still work), so it is asked together with the microphone, once, and then left alone.
    static func ensureSpeech() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
            }
        default: return false
        }
    }
}

// MARK: The on-device model

/// iOS 26's SpeechTranscriber: on-device, volatile then final results, built for long speech. Its language model is
/// a download the first time, so it is fetched when the mic first appears, not when it is tapped. Until it is ready
/// (or where the device has none) the turn falls back to SFSpeechRecognizer, on device where that supports it.
@MainActor
enum VoiceAssets {
    /// The shop writes Roman script, English and Urdu mixed; the web listens in English (India) for the same reason
    /// (lib/voice/live.ts).
    static let locale = Locale(identifier: "en-IN")
    /// Set once the model for the shop's language is installed.
    private(set) static var analyzerLocale: Locale?
    private(set) static var analyzerFormat: AVAudioFormat?
    /// A recogniser that failed outright is not tried again in this run.
    static var analyzerBroken = false
    static var speechBroken = false
    private static var preparing = false

    static func prepare() {
        guard !preparing, analyzerLocale == nil, !analyzerBroken else { return }
        preparing = true
        Task {
            defer { preparing = false }
            guard SpeechTranscriber.isAvailable,
                  let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else { return }
            let probe = SpeechTranscriber(locale: supported, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
            let installed = await SpeechTranscriber.installedLocales
            if !installed.contains(where: { $0.identifier(.bcp47) == supported.identifier(.bcp47) }) {
                do {
                    if let request = try await AssetInventory.assetInstallationRequest(supporting: [probe]) {
                        try await request.downloadAndInstall()
                    }
                } catch { return }
            }
            let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [probe])
            // Loads the model now, so the first sentence does not pay for it.
            let spare = SpeechAnalyzer(modules: [probe])
            try? await spare.prepareToAnalyze(in: format)
            await spare.cancelAndFinishNow()
            analyzerFormat = format
            analyzerLocale = supported
        }
    }
}

// MARK: One sentence's recogniser

/// What the microphone's buffers are handed to. Appended on the audio thread; results come back through `onText`
/// (settled words, words still changing) on the main actor.
protocol VoiceRecognizing: AnyObject {
    func append(_ buffer: AVAudioPCMBuffer)
    /// No more audio: let the last words settle.
    func finish()
    func cancel()
}

/// SpeechAnalyzer + SpeechTranscriber (iOS 26, macOS 26): volatile results as the words are said, final ones as they settle.
final class AnalyzerTurn: VoiceRecognizing, @unchecked Sendable {
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private let stream: AsyncStream<AnalyzerInput>
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let lock = NSLock()
    private var ready = false
    private var target: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var pending: [AVAudioPCMBuffer] = []
    private var closed = false
    private var results: Task<Void, Never>?

    init(locale: Locale, format: AVAudioFormat?,
         onText: @escaping @MainActor (String, String) -> Void, onFail: @escaping @MainActor (Bool) -> Void) {
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (stream, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
        self.transcriber = transcriber; self.analyzer = analyzer; self.stream = stream; self.input = input

        // Each result replaces the words still changing; a final one joins the settled words.
        results = Task { @MainActor in
            var settled = ""
            do {
                for try await result in transcriber.results {
                    let words = String(result.text.characters)
                    if result.isFinal { settled += (settled.isEmpty ? "" : " ") + words; onText(settled, "") }
                    else { onText(settled, words) }
                }
            } catch { if !Task.isCancelled { onFail(true) } }
        }
        Task {
            do {
                let best: AVAudioFormat?
                if let format { best = format } else { best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) }
                self.become(ready: best)
                try await analyzer.start(inputSequence: stream)
            } catch { await onFail(true) }
        }
    }

    /// The analyzer's own format is known: buffers that came before it are converted and sent, in order.
    private func become(ready format: AVAudioFormat?) {
        lock.lock(); defer { lock.unlock() }
        target = format; ready = true
        let queued = pending; pending = []
        for buffer in queued { send(buffer) }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return }
        if ready { send(buffer) } else { pending.append(buffer) }
    }

    /// Called with the lock held.
    private func send(_ buffer: AVAudioPCMBuffer) {
        guard let target, buffer.format != target else { input.yield(AnalyzerInput(buffer: buffer)); return }
        if converter == nil { converter = AVAudioConverter(from: buffer.format, to: target) }
        guard let converter else { return }
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate).rounded(.up)) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var supplied = false
        var failure: NSError?
        let status = converter.convert(to: out, error: &failure) { _, inputStatus in
            if supplied { inputStatus.pointee = .noDataNow; return nil }
            supplied = true; inputStatus.pointee = .haveData; return buffer
        }
        guard status != .error, failure == nil, out.frameLength > 0 else { return }
        input.yield(AnalyzerInput(buffer: out))
    }

    func finish() {
        lock.lock(); closed = true; lock.unlock()
        input.finish()
        let analyzer = analyzer
        Task { try? await analyzer.finalizeAndFinishThroughEndOfInput() }
    }

    func cancel() {
        lock.lock(); closed = true; lock.unlock()
        input.finish(); results?.cancel()
        let analyzer = analyzer
        Task { await analyzer.cancelAndFinishNow() }
    }
}

/// SFSpeechRecognizer where the transcriber is not ready or not there: on the phone where it can be, as the web's
/// recogniser is (the sentence never leaves the phone to be read).
final class SFTurn: VoiceRecognizing, @unchecked Sendable {
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var cancelled = false
    private let started = Date()

    init?(recognizer: SFSpeechRecognizer?, onText: @escaping @MainActor (String, String) -> Void, onFail: @escaping @MainActor (Bool) -> Void) {
        guard let recognizer, recognizer.isAvailable else { return nil }
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        let started = started
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            onMain {
                guard let self, !self.cancelled else { return }
                if let text {
                    if isFinal { onText(text, "") } else { onText("", text) }
                }
                // A task that dies at once is a real failure; one that ends after a quiet spell is only the
                // system's timeout, and the next sentence gets a new one.
                if failed || isFinal { onFail(Date().timeIntervalSince(started) < 1) }
            }
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) { request.append(buffer) }
    func finish() { request.endAudio() }
    func cancel() { cancelled = true; request.endAudio(); task?.cancel() }
}

/// No recogniser at all (speech refused, the model not there): the sentence is recorded and Gemini listens to it.
final class ClipTurn: VoiceRecognizing, @unchecked Sendable {
    private let url = FileManager.default.temporaryDirectory.appendingPathComponent("erp-voice-\(UUID().uuidString).m4a")
    private let lock = NSLock()
    private var file: AVAudioFile?
    private var done = false

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard !done else { return }
        if file == nil {
            let f = buffer.format
            file = try? AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: f.sampleRate,
                                                                AVNumberOfChannelsKey: f.channelCount],
                                    commonFormat: f.commonFormat, interleaved: f.isInterleaved)
        }
        try? file?.write(from: buffer)
    }

    func finish() { lock.lock(); done = true; file = nil; lock.unlock() }
    func cancel() { finish(); try? FileManager.default.removeItem(at: url) }

    /// The recording, once finished; removed from disk as it is read.
    func take() -> Data? {
        defer { try? FileManager.default.removeItem(at: url) }
        guard let data = try? Data(contentsOf: url), data.count > 1000 else { return nil }
        return data
    }
}

// MARK: The audio thread

/// Everything the audio thread does with a buffer: the level the orb draws, whether someone is talking, when they
/// stopped, and the hand-off to the recogniser. Plain and lock-guarded (no actor): the tap calls it ~10-50 times a second.
final class VoiceAudioTap: @unchecked Sendable {
    private let lock = NSLock()
    private var sink: ((AVAudioPCMBuffer) -> Void)?
    private var noiseDb: Float = -55
    private var voiced: Double = 0
    private var silent: Double = 0
    private var fired = false
    private var muted = false
    private var raw: Float = 0
    private var shown: Float = 0
    private var shownAt: TimeInterval = 0
    /// Quiet after speech that ends a sentence (Siri waits about as long): short enough to feel immediate, long enough
    /// not to cut a person who is thinking of the next figure.
    var silenceToEnd: Double = 1.0
    private var endpoint: (@Sendable () -> Void)?

    /// Called on the audio thread, once per sentence. Hop to the main actor with `onMain`.
    func setEndpoint(_ new: (@Sendable () -> Void)?) { lock.lock(); endpoint = new; lock.unlock() }
    func setSink(_ new: ((AVAudioPCMBuffer) -> Void)?) { lock.lock(); sink = new; lock.unlock() }
    func setMuted(_ on: Bool) { lock.lock(); muted = on; if on { raw = 0 }; lock.unlock() }

    /// A new sentence: the quiet and the talk so far are forgotten.
    func resetTurn() { lock.lock(); voiced = 0; silent = 0; fired = false; lock.unlock() }

    func feed(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        let n = Int(buffer.frameLength)
        var sum: Float = 0
        for i in 0..<n { let v = channel[i]; sum += v * v }
        let db = 20 * log10(max((sum / Float(n)).squareRoot(), 0.000_01))
        let seconds = Double(n) / buffer.format.sampleRate

        lock.lock()
        if muted { lock.unlock(); return }
        // Someone is talking when the sound stands 10 dB above the room, which the quiet moments keep measuring.
        let isVoice = db > max(-48, noiseDb + 10)
        if !isVoice { noiseDb = min(-35, max(-70, noiseDb * 0.97 + db * 0.03)) }
        raw = max(0, min(1, (db - noiseDb - 4) / 30))
        var ended = false
        if isVoice { voiced += seconds; silent = 0 } else if voiced > 0.2 { silent += seconds }
        if !fired, voiced >= 0.2, silent >= silenceToEnd { fired = true; ended = true }
        let forward = sink
        let callback = endpoint
        lock.unlock()

        forward?(buffer)
        if ended { callback?() }
    }

    /// The level to draw this frame, 0...1: quick to rise, slow to fall, so a word is a pulse and not a flicker.
    /// Called by the orb at display rate.
    func smoothedLevel() -> Float {
        lock.lock(); defer { lock.unlock() }
        let now = ProcessInfo.processInfo.systemUptime
        let dt = Float(min(0.1, max(0, now - shownAt)))
        shownAt = now
        let rate: Float = raw > shown ? 22 : 6
        shown += (raw - shown) * min(1, rate * dt)
        return shown
    }
}

// MARK: The engine

/// One AVAudioEngine for the app's voice: the graph is prepared early and kept, the tap feeds `VoiceAudioTap`.
@MainActor
final class VoiceEngine {
    static let shared = VoiceEngine()

    let tap = VoiceAudioTap()
    private var engine: AVAudioEngine?
    private(set) var running = false
    private var wantsRunning = false
    private var observers: [NSObjectProtocol] = []
    /// The phone took the microphone (a call, Siri) or gave it back.
    var onInterruption: ((_ began: Bool) -> Void)?

    /// Cheap and repeatable. Called when the mic first appears: the speech model is fetched, the audio session's
    /// category set, the engine's graph prepared, so a tap only has to start it.
    func warm() {
        VoiceAssets.prepare()
        guard VoicePermission.microphoneGranted, !running else { return }
        configureSession()
        if engine == nil { engine = AVAudioEngine() }
        // Touching the input node builds the microphone's side of the graph now, not at the tap.
        _ = engine?.inputNode
        engine?.prepare()
    }

    private func configureSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        // Other audio dips while the sheet is open and comes back when it closes; nothing is stopped.
        try? session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP])
        // The taps for a saved plan or a refusal still fire while the microphone is open.
        try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        try? session.setPreferredIOBufferDuration(0.02)
        #endif
    }

    func start() throws {
        wantsRunning = true
        guard !running else { return }
        configureSession()
        #if os(iOS)
        try AVAudioSession.sharedInstance().setActive(true)
        #endif
        let engine = self.engine ?? AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw ERPAPI.Failure(status: 0, message: "The microphone could not start. You can type instead.")
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tapBlock(tap))
        engine.prepare()
        try engine.start()
        running = true
        observe(engine)
    }

    func stop() {
        wantsRunning = false
        tap.setSink(nil)
        tap.setEndpoint(nil)
        tap.setMuted(false)
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers = []
        guard running else { return }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        running = false
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    /// Made outside the main actor on purpose: the block runs on the audio thread.
    nonisolated private static func tapBlock(_ tap: VoiceAudioTap) -> AVAudioNodeTapBlock {
        { buffer, _ in tap.feed(buffer) }
    }

    private func observe(_ engine: AVAudioEngine) {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        // A route change (AirPods in, a headset out) stops the engine: start it again on the new route.
        var list: [NSObjectProtocol] = [
            NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, self.wantsRunning else { return }
                    self.running = false
                    try? self.start()
                }
            },
        ]
        #if os(iOS)
        list.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            MainActor.assumeIsolated {
                guard let self, let raw, let kind = AVAudioSession.InterruptionType(rawValue: raw) else { return }
                if kind == .began { self.running = false }
                self.onInterruption?(kind == .began)
            }
        })
        #endif
        observers = list
    }

    /// The recogniser for the next sentence: the transcriber when its model is installed, else the phone's recogniser,
    /// else just the recording.
    func makeTurn(onText: @escaping @MainActor (String, String) -> Void, onFail: @escaping @MainActor (Bool) -> Void) -> VoiceRecognizing {
        if !VoiceAssets.analyzerBroken, let locale = VoiceAssets.analyzerLocale {
            return AnalyzerTurn(locale: locale, format: VoiceAssets.analyzerFormat, onText: onText, onFail: onFail)
        }
        if !VoiceAssets.speechBroken, SFSpeechRecognizer.authorizationStatus() == .authorized,
           let turn = SFTurn(recognizer: SFSpeechRecognizer(locale: VoiceAssets.locale) ?? SFSpeechRecognizer(), onText: onText, onFail: onFail) {
            return turn
        }
        return ClipTurn()
    }
}
