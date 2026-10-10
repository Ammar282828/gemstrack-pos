import Foundation
import Speech
import AVFoundation

/// Apple's recogniser, for live words (the ERP's voice, lib/voice/live.ts): "speech" with the
/// session's words so far, "speechEnd" when it stops. Shares the microphone with a recording the
/// page may be making (the voice note Gemini reads) and never ends the audio session under it.
/// Carried over from the Capacitor shell (apps/ios ERP.swift).
final class SpeechEngine {
    private let emit: (String, [String: Any]) -> Void
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var generation = UUID()

    init(emit: @escaping (String, [String: Any]) -> Void) { self.emit = emit }

    /// `done` gets nil when listening, or (code, message).
    func start(lang: String, done: @escaping ((String, String)?) -> Void) {
        generation = UUID()
        let id = generation
        SFSpeechRecognizer.requestAuthorization { status in
            guard self.generation == id else { return }
            guard status == .authorized else { return DispatchQueue.main.async { done(("not-allowed", "Speech recognition is off for this app in Settings.")) } }
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard self.generation == id else { return }
                    guard granted else { return done(("not-allowed", "The microphone is off for this app in Settings.")) }
                    do { try self.begin(lang: lang); done(nil) } catch { done(("audio-capture", error.localizedDescription)) }
                }
            }
        }
    }

    private func begin(lang: String) throws {
        stop(notify: false)
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            throw NSError(domain: "ERP", code: 1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition isn't available right now."])
        }
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord { try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker]) }
        try session.setActive(true)
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
        engine.prepare()
        try engine.start()
        request = req
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.request === req else { return }
                if let result { self.emit("speech", ["transcript": result.bestTranscription.formattedString, "isFinal": result.isFinal]) }
                if error != nil || result?.isFinal == true { self.stop(notify: true, error: error) }
            }
        }
    }

    func stop(notify: Bool, error: Error? = nil) {
        generation = UUID()
        guard request != nil else { return }
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        if notify { emit("speechEnd", error.map { ["error": $0.localizedDescription] } ?? [:]) }
    }
}
