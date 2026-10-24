import Foundation
import Network
import ERPCore
#if os(macOS)
import AppKit
#endif

/// Tags printed through Label LIVE (label.live), the label printer's app on the Mac at the counter
/// (docs/features/label-live.md). The tag's words and the link are ERPCore's (LabelLive.swift, the web's
/// label-live.ts case for case); this is only how the link reaches Label LIVE:
///
/// - **On that Mac** (the Mac app): Label LIVE's own HTTP API on localhost:11180 first, which answers whether it
///   printed; if it is not reachable, the `labellive://` link handed to macOS, as the web does (Label LIVE opens and
///   prints, but cannot say how it went).
/// - **From any other device** (an iPhone, another Mac): Label LIVE's MQTT broker on the counter Mac (port 1883,
///   switched on in Label LIVE's settings), which takes the same link on `$LL/url` and reports on `$LL/status`.
///   Label LIVE has no iPhone app and no cloud: the counter Mac has to be on and on the same network.
///
/// Label LIVE documents its HTTP API only in part (its guide shows `/api/v1/batch`); the print call below is that
/// guide's link with the scheme swapped, and whether this Mac's Label LIVE took it is remembered, so a version that
/// answers 404 is not asked again until the app restarts.
enum LabelLivePrinter {
    enum Route: String, Codable { case api, link, mqtt }

    struct Outcome: Equatable {
        let ok: Bool
        let route: Route
        /// What Label LIVE said, or why it could not be reached, in the shop's words.
        let message: String
    }

    static let apiPort = 11180
    static let mqttPort: UInt16 = 1883

    /// Where this device sends tags: the counter Mac's name or address for MQTT ("counter-mac.local"), per business.
    static var counterHost: String {
        get { UserDefaults.standard.string(forKey: BizKey("erp.labelLive.counterHost")) ?? "" }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: BizKey("erp.labelLive.counterHost")) }
    }

    /// The tags of these pieces, at today's rates, as one Label LIVE job (a two-tag design fills both tags of a label).
    static func link(for pieces: [Product], settings: Settings, config: LabelLiveConfig, copies: Int? = nil) -> String {
        LabelLive.printURL(config, pieces.map { LabelLive.valuesFor($0, settings) }, copies: copies)
    }

    /// Sends the link by the best way this device has, and notes each piece in this device's print history.
    @MainActor
    static func print(pieces: [Product], settings: Settings, config: LabelLiveConfig, copies: Int? = nil) async -> Outcome {
        let url = link(for: pieces, settings: settings, config: config, copies: copies)
        let outcome = await send(url)
        LabelPrintHistory.note(skus: pieces.map(\.sku), design: config.design, outcome: outcome)
        return outcome
    }

    /// The link itself: a test print, or tags already worked out.
    @MainActor
    static func send(_ url: String) async -> Outcome {
        #if os(macOS)
        let host = counterHost
        // Another Mac at the counter named in Settings: its broker, as an iPhone would.
        if !host.isEmpty, !isThisMac(host) { return await mqtt(url, host: host) }
        if apiAnswers != false, let outcome = await api(url) { return outcome }
        return openLink(url)
        #else
        let host = counterHost
        guard !host.isEmpty else {
            return Outcome(ok: false, route: .mqtt, message: "Name the Mac at the counter in Settings → Labels first (Label LIVE runs there).")
        }
        return await mqtt(url, host: host)
        #endif
    }

    // MARK: - On this Mac

    #if os(macOS)
    /// nil until asked; false once this Mac's Label LIVE answered that it has no such call.
    @MainActor private static var apiAnswers: Bool?

    private static func isThisMac(_ host: String) -> Bool {
        let h = host.lowercased()
        let mine = (Host.current().localizedName ?? "").lowercased().replacingOccurrences(of: " ", with: "-")
        return h == "localhost" || h == "127.0.0.1" || h == "::1" || (!mine.isEmpty && (h == mine || h == mine + ".local"))
    }

    /// Label LIVE's HTTP API: the print link's own query, POSTed. nil when Label LIVE is not reachable (closed, or a
    /// version without the API), so the link is used instead.
    @MainActor
    private static func api(_ link: String) async -> Outcome? {
        guard let q = link.range(of: "?").map({ String(link[$0.upperBound...]) }),
              let url = URL(string: "http://localhost:\(apiPort)/api/v1/print?\(q)") else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "POST"
        do {
            let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 404 || status == 405 { apiAnswers = false; return nil }
            apiAnswers = true
            let said = apiMessage(data)
            if (200..<300).contains(status), said.ok {
                return Outcome(ok: true, route: .api, message: said.text ?? "Printed.")
            }
            return Outcome(ok: false, route: .api, message: said.text ?? "Label LIVE refused it (\(status)).")
        } catch {
            // Not running, or the API is off: the link opens Label LIVE (and starts it if it is closed).
            return nil
        }
    }

    /// Label LIVE answers with JSON saying whether it printed; its exact words are not documented, so the usual names are read.
    private static func apiMessage(_ data: Data) -> (ok: Bool, text: String?) {
        guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (true, text?.isEmpty == false ? String(text!.prefix(200)) : nil)
        }
        let failed = (o["success"] as? Bool) == false || (o["ok"] as? Bool) == false || o["error"] != nil
            || ((o["status"] as? String)?.lowercased()).map { $0.contains("error") || $0.contains("fail") } == true
        let text = (o["message"] as? String) ?? (o["error"] as? String) ?? (o["status"] as? String)
        return (!failed, text)
    }

    @MainActor
    private static func openLink(_ link: String) -> Outcome {
        guard let url = URL(string: link), NSWorkspace.shared.urlForApplication(toOpen: url) != nil else {
            return Outcome(ok: false, route: .link, message: "Label LIVE isn't installed on this Mac (label.live).")
        }
        NSWorkspace.shared.open(url)
        return Outcome(ok: true, route: .link, message: "Sent to Label LIVE. It prints if the design is pinned to its Home screen.")
    }

    /// The Mac's own printers by Label LIVE's ids ("System-<name>", as its Print tab and Integrate link name them),
    /// with Preview first: a picker instead of a pasted id.
    static var systemPrinters: [String] {
        ["Preview"] + NSPrinter.printerNames.map { "System-\($0)" }
    }
    #endif

    // MARK: - Any device: Label LIVE's MQTT broker on the counter Mac

    /// One link to `$LL/url`, then up to four seconds of `$LL/status` for Label LIVE's answer.
    static func mqtt(_ link: String, host: String) async -> Outcome {
        let client = MQTTOnce(host: host, port: mqttPort)
        do {
            let status = try await client.publish(topic: "$LL/url", message: link, listen: "$LL/status", wait: 4)
            if let status, status.lowercased().contains("error") || status.lowercased().contains("fail") {
                return Outcome(ok: false, route: .mqtt, message: status)
            }
            return Outcome(ok: true, route: .mqtt, message: status ?? "Sent to Label LIVE on \(host).")
        } catch {
            return Outcome(ok: false, route: .mqtt, message: "Couldn't reach Label LIVE on \(host): is the Mac on, Label LIVE open, and MQTT switched on in its settings? (\(error.localizedDescription))")
        }
    }
}

/// The tags this device printed, newest first, per business (the web keeps its print history per browser too).
enum LabelPrintHistory {
    struct Entry: Codable, Hashable, Identifiable {
        let sku: String
        let timestamp: String
        let design: String
        let route: LabelLivePrinter.Route
        let ok: Bool
        let message: String
        var id: String { sku + timestamp }
    }

    private static var key: String { BizKey("erp.labelLive.history") }

    static var all: [Entry] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
    }

    static func note(skus: [String], design: String, outcome: LabelLivePrinter.Outcome) {
        let now = ISO8601DateFormatter().string(from: Date())
        let added = skus.map { Entry(sku: $0, timestamp: now, design: design, route: outcome.route, ok: outcome.ok, message: outcome.message) }
        // The last 50, as the web keeps.
        let list = Array((added + all).prefix(50))
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

/// The least of MQTT 3.1.1 (Label LIVE's broker speaks only that): connect, subscribe to the status topic, publish
/// one message at QoS 0, read what comes back for a moment, disconnect. No library: a few packets over Network.
final class MQTTOnce: @unchecked Sendable {
    enum Failure: LocalizedError {
        case refused(UInt8), closed, timeout
        var errorDescription: String? {
            switch self {
            case .refused(let code): return "the broker refused the connection (\(code))"
            case .closed: return "the connection closed"
            case .timeout: return "no answer"
            }
        }
    }

    private let connection: NWConnection
    private let queue = DispatchQueue(label: "erp.labellive.mqtt")
    private var buffer = Data()

    init(host: String, port: UInt16) {
        connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port) ?? 1883, using: .tcp)
    }

    /// The status Label LIVE published after the link, if any came within `wait` seconds.
    func publish(topic: String, message: String, listen: String, wait: TimeInterval) async throws -> String? {
        defer { connection.cancel() }
        try await start()
        try await write(Self.connect(clientID: "erp-" + UUID().uuidString.prefix(8)))
        let ack = try await packet(timeout: 5)
        guard ack.type == 2, ack.body.count >= 2 else { throw Failure.closed }
        if ack.body[1] != 0 { throw Failure.refused(ack.body[1]) }
        try await write(Self.subscribe(topic: listen, id: 1))
        try await write(Self.publish(topic: topic, payload: Data(message.utf8)))
        let deadline = Date().addingTimeInterval(wait)
        while Date() < deadline {
            guard let p = try? await packet(timeout: deadline.timeIntervalSinceNow) else { break }
            // A PUBLISH on the status topic: two bytes of topic length, the topic, then the payload (QoS 0, no id).
            if p.type == 3, p.body.count >= 2 {
                let n = Int(p.body[0]) << 8 | Int(p.body[1])
                guard p.body.count >= 2 + n else { continue }
                let payload = p.body.dropFirst(2 + n)
                if let text = String(data: payload, encoding: .utf8), !text.isEmpty { try? await write(Data([0xE0, 0])); return text }
            }
        }
        try? await write(Data([0xE0, 0]))
        return nil
    }

    // MARK: Packets

    private static func string(_ s: String) -> Data {
        let b = Data(s.utf8)
        return Data([UInt8(b.count >> 8), UInt8(b.count & 0xFF)]) + b
    }

    private static func length(_ n: Int) -> Data {
        var n = n, out = Data()
        repeat {
            var byte = UInt8(n % 128)
            n /= 128
            if n > 0 { byte |= 0x80 }
            out.append(byte)
        } while n > 0
        return out
    }

    private static func packet(_ header: UInt8, _ body: Data) -> Data { Data([header]) + length(body.count) + body }

    static func connect(clientID: String) -> Data {
        // "MQTT", level 4 (3.1.1), clean session, keep-alive 30 s, the client id.
        packet(0x10, string("MQTT") + Data([4, 0x02, 0, 30]) + string(clientID))
    }

    static func subscribe(topic: String, id: UInt16) -> Data {
        packet(0x82, Data([UInt8(id >> 8), UInt8(id & 0xFF)]) + string(topic) + Data([0]))
    }

    static func publish(topic: String, payload: Data) -> Data {
        packet(0x30, string(topic) + payload)
    }

    // MARK: The wire

    private func start() async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            let once = OnceFlag()
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready: if once.take() { done.resume() }
                case .failed(let e), .waiting(let e): if once.take() { done.resume(throwing: e) }
                case .cancelled: if once.take() { done.resume(throwing: Failure.closed) }
                default: break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 6) { if once.take() { done.resume(throwing: Failure.timeout) } }
        }
    }

    private func write(_ data: Data) async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { e in
                if let e { done.resume(throwing: e) } else { done.resume() }
            })
        }
    }

    private func receive(timeout: TimeInterval) async throws -> Data {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Data, Error>) in
            let once = OnceFlag()
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, complete, error in
                guard once.take() else { return }
                if let error { done.resume(throwing: error) }
                else if let data, !data.isEmpty { done.resume(returning: data) }
                else if complete { done.resume(throwing: Failure.closed) }
                else { done.resume(returning: Data()) }
            }
            queue.asyncAfter(deadline: .now() + max(0.1, timeout)) { if once.take() { done.resume(throwing: Failure.timeout) } }
        }
    }

    /// The next whole packet: its type (the header's top four bits) and its body.
    private func packet(timeout: TimeInterval) async throws -> (type: UInt8, body: Data) {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            if let p = Self.take(&buffer) { return p }
            let left = deadline.timeIntervalSinceNow
            if left <= 0 { throw Failure.timeout }
            buffer += try await receive(timeout: left)
        }
    }

    static func take(_ buffer: inout Data) -> (type: UInt8, body: Data)? {
        let bytes = [UInt8](buffer)
        guard bytes.count >= 2 else { return nil }
        var length = 0, multiplier = 1, i = 1
        while true {
            guard i < bytes.count else { return nil }
            let b = bytes[i]
            length += Int(b & 0x7F) * multiplier
            i += 1
            if b & 0x80 == 0 { break }
            multiplier *= 128
            if i > 4 { buffer.removeAll(); return nil }
        }
        guard bytes.count >= i + length else { return nil }
        let body = Data(bytes[i..<(i + length)])
        buffer = Data(bytes[(i + length)...])
        return (bytes[0] >> 4, body)
    }
}

/// True the first time only: a continuation is resumed once whichever of its callbacks comes first.
private final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func take() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}
