import SwiftUI
import Observation
import AVFoundation
import ERPCore

/// Voice is a native sheet. Speech only prepares a reading; writes still go through ERPAPI.
struct NativeVoiceScreen: View {
    let open: (String) -> Void
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var voice = NativeVoiceSession()
    @State private var language = "en-PK"
    @State private var speakAnswers = true

    var body: some View {
        Form {
            Section {
                VStack(spacing: 16) {
                    Button { voice.listening ? voice.finish() : voice.start(language: language) } label: {
                        Image(systemName: voice.listening ? "stop.fill" : "mic.fill")
                            .font(.system(size: 28)).frame(width: 72, height: 72)
                    }
                    .buttonStyle(.houseProminent).buttonBorderShape(.circle)
                    .disabled(voice.busy)
                    .accessibilityLabel(voice.listening ? "Stop and review" : "Start recording")
                    Text(voice.listening ? "Listening… tap stop when done" : "Talk to the book")
                        .font(.headline)
                    if voice.listening {
                        HStack(alignment: .center, spacing: 4) {
                            ForEach(0..<15) { n in
                                Capsule().fill(Theme.accent)
                                    .frame(width: 4, height: 6 + CGFloat(voice.level) * CGFloat(8 + (n * 7) % 29))
                            }
                        }.frame(height: 42).accessibilityHidden(true)
                    } else {
                        Text("Ask a question, record a payment, or open a page.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                Picker("Live words", selection: $language) {
                    Text("English").tag("en-PK")
                    Text("Urdu").tag("ur-PK")
                }.disabled(voice.listening || voice.busy)
                Toggle("Read answers aloud", isOn: $speakAnswers)
            }.houseRows()

            Section {
                TextField("Or type what you need…", text: $voice.words, axis: .vertical)
                    .lineLimit(3...8).disabled(voice.listening || voice.busy || voice.completed > 0)
                Button(voice.plan == nil ? "Review" : "Read again", systemImage: "arrow.clockwise") {
                    voice.readText(speak: speakAnswers)
                }
                .disabled(voice.words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || voice.listening || voice.busy || voice.completed > 0)
            } header: { LedgerHeading(title: "Your words") } footer: {
                Text("Check the reading below before saving. Recording stops after one minute.")
            }.houseRows()

            if voice.busy {
                Section { HStack(spacing: 12) { SkeletonLoading(); Text(voice.writing ? "Saving…" : "Reading…") } }.houseRows()
            }
            if let error = voice.failure {
                Section { Text(error).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }.houseRows()
            }
            if let plan = voice.plan {
                if let answer = plan.answer {
                    LedgerSection("Answer") {
                        Text(answer).fixedSize(horizontal: false, vertical: true)
                        if let path = plan.href { Button("Open page", systemImage: "arrow.up.right") { open(path) } }
                    }
                }
                ForEach(Array(plan.cards.enumerated()), id: \.offset) { _, card in
                    LedgerSection(card.title.capitalized) {
                        Text(card.summary).fixedSize(horizontal: false, vertical: true)
                        if let problem = card.problem { Text(problem).font(.subheadline).foregroundStyle(.orange) }
                        if card.operations.isEmpty, let path = card.href {
                            Button(card.handoff == nil ? "Open record" : "Fill the form", systemImage: "arrow.up.right") {
                                do { try NativeVoiceHandoff.apply(card.handoff, book: book, person: session.shop.person); open(path) }
                                catch { voice.failure = error.localizedDescription }
                            }.disabled(voice.busy || !book.customers.loaded || !book.products.loaded || !book.settings.loaded)
                        }
                    }
                }
                if !plan.operations.isEmpty {
                    Section {
                        if voice.completed == plan.operations.count {
                            Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                            if let path = plan.cards.last?.href { Button("Open record") { open(path) } }
                            Button("Another request") { voice.reset() }
                        } else {
                            Button(voice.completed > 0 ? "Save remaining changes" : "Confirm and save", systemImage: "checkmark") { voice.save() }
                                .disabled(voice.busy || !plan.ready || voice.words != plan.reviewedWords)
                            if voice.completed > 0 { Text("\(voice.completed) of \(plan.operations.count) changes saved.").font(.footnote) }
                        }
                    } footer: {
                        if !plan.ready { Text("Resolve every step before saving, or change the sentence and read it again.") }
                        else if voice.words != plan.reviewedWords { Text("Your words changed. Read them again before saving.") }
                    }.houseRows()
                }
            }
        }
        .modifier(HouseGround())
        .navigationTitle("Voice").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() }.disabled(voice.writing) } }
        .interactiveDismissDisabled(voice.writing)
        .onDisappear { voice.close() }
        .onChange(of: speakAnswers) { _, on in voice.readAloud = on; if !on { voice.silence() } }
        .task { book.customers.need(); book.products.need(); book.settings.need() }
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
    var operations: [(op: String, fields: [String: Any])] { cards.flatMap(\.operations) }
    var ready: Bool { cards.allSatisfy { $0.problem == nil && $0.handoff == nil } }
    init(_ raw: [String: Any], words: String) {
        reviewedWords = words
        cards = (raw["cards"] as? [[String: Any]] ?? []).map(NativeVoiceCard.init)
        answer = raw["answer"] as? String
        href = raw["href"] as? String
    }
}

@MainActor @Observable
final class NativeVoiceSession {
    var words = ""
    var listening = false
    var starting = false
    var thinking = false
    var writing = false
    var failure: String?
    var plan: NativeVoicePlan?
    var completed = 0
    var level: Float = 0
    var readAloud = true
    var busy: Bool { starting || thinking || writing }
    private var recorder: AVAudioRecorder?
    private var file: URL?
    private var speech: SpeechEngine?
    private var work: Task<Void, Never>?
    private var meter: Task<Void, Never>?
    private let speaker = AVSpeechSynthesizer()
    private var generation = UUID()

    func start(language: String) {
        guard !busy, !listening else { return }
        reset(); starting = true
        let id = generation
        work = Task {
            let allowed = await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
            }
            guard generation == id, !Task.isCancelled else { return }
            starting = false
            guard allowed else { failure = "Turn on Microphone for this app in Settings, or type your request."; return }
            do {
                let audio = AVAudioSession.sharedInstance()
                try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers])
                try audio.setActive(true)
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("erp-voice-\(UUID().uuidString).m4a")
                file = url
                let r = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
                r.isMeteringEnabled = true
                guard r.record() else { throw ERPAPI.Failure(status: 0, message: "The microphone could not start. You can type instead.") }
                recorder = r; listening = true
                speech = SpeechEngine { [weak self] event, data in
                    guard let self, self.listening, self.generation == id else { return }
                    if event == "speech", let text = data["transcript"] as? String { self.words = text }
                }
                // The audio still works if live transcription is unavailable or refused.
                speech?.start(lang: language) { _ in }
                meter = Task {
                    let deadline = Date().addingTimeInterval(60)
                    while listening, !Task.isCancelled {
                        r.updateMeters(); level = max(0, min(1, (r.averagePower(forChannel: 0) + 55) / 55))
                        if Date() >= deadline { finish(); break }
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                }
            } catch { failure = error.localizedDescription; releaseAudio() }
        }
    }

    func finish() {
        guard listening else { return }
        recorder?.stop(); speech?.stop(notify: false); listening = false; meter?.cancel()
        let data = file.flatMap { try? Data(contentsOf: $0) }
        releaseAudio()
        guard let data, data.count > 1000 else { failure = "Nothing was recorded. Try again or type your request."; return }
        interpret(["audio": data.base64EncodedString()])
    }

    func readText(speak: Bool) {
        guard !busy, !listening, completed == 0 else { return }
        readAloud = speak
        interpret(["text": words.trimmingCharacters(in: .whitespacesAndNewlines)])
    }

    private func interpret(_ input: [String: Any]) {
        work?.cancel(); silence(); failure = nil; plan = nil; completed = 0; thinking = true
        let id = generation
        work = Task {
            defer { if generation == id { thinking = false } }
            do {
                let raw = try await ERPAPI.shared.send("/api/voice/native", input, timeout: 120)
                guard !Task.isCancelled, generation == id else { return }
                if let transcript = raw["transcript"] as? String, !transcript.isEmpty { words = transcript }
                plan = NativeVoicePlan(raw, words: words)
                if readAloud, let answer = plan?.answer { say(answer) }
            } catch { if !Task.isCancelled, generation == id { failure = error.localizedDescription } }
        }
    }

    func save() {
        guard let plan, plan.ready, words == plan.reviewedWords, !busy, !listening else { return }
        silence(); writing = true; failure = nil
        work = Task {
            defer { writing = false }
            do {
                for operation in plan.operations.dropFirst(completed) {
                    _ = try await ERPAPI.shared.write(operation.op, operation.fields)
                    completed += 1
                }
            } catch { failure = error.localizedDescription }
        }
    }

    func reset() {
        guard !writing else { return }
        generation = UUID(); work?.cancel(); releaseAudio(); silence()
        words = ""; failure = nil; plan = nil; completed = 0; starting = false; thinking = false
    }
    func close() { guard !writing else { return }; generation = UUID(); work?.cancel(); releaseAudio(); silence() }
    func silence() { speaker.stopSpeaking(at: .immediate) }
    private func say(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
        speaker.speak(utterance)
    }
    private func releaseAudio() {
        meter?.cancel(); recorder?.stop(); recorder = nil; speech?.stop(notify: false); speech = nil
        listening = false; level = 0
        if let file { try? FileManager.default.removeItem(at: file) }; file = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

enum NativeVoiceHandoff {
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
                    draft.pieces[firstPiece + i].manualPrice = NewOrderSlip.jsNumber(price)
                }
            }
            if let method = payload["advanceMethod"] as? String { draft.advanceMethod = method }
            if draft.takenBy.isEmpty { draft.takenBy = person ?? "" }
            NewOrderDraftStore.save(draft)
        } else if kind == "sale" {
            var raw = payload
            raw["amountPaid"] = payload["paid"]
            let answer = try JSONDecoder().decode(SaleBillAnswer.self, from: JSONSerialization.data(withJSONObject: raw))
            let reading = SaleBillReading.resolve(answer, customers: book.customers.items)
            var draft = SaleDraftStore.load() ?? SaleDraft()
            _ = draft.fill(fromBill: reading, customer: (payload["customerId"] as? String).flatMap { book.customers.item($0) }, fallbackMetal: House.metal)
            if let method = payload["method"] as? String, !draft.payments.isEmpty { draft.payments[0].method = method }
            if draft.takenBy.isEmpty { draft.takenBy = person ?? "" }
            SaleDraftStore.save(draft)
            for sku in payload["skus"] as? [String] ?? [] {
                guard let product = book.products.items.first(where: { $0.sku == sku }) else { continue }
                SaleDraftStore.add(product)
            }
        } else {
            throw ERPAPI.Failure(status: 0, message: "Open the native form and enter the details shown above.")
        }
    }
}
