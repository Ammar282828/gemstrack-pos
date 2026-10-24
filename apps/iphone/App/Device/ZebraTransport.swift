import Foundation
import Network
import ERPCore
#if os(macOS)
import CCUPS
#endif

/// A printer Zebra Browser Print can see (its `/available` list): USB or network, any Zebra on this Mac.
struct BrowserPrintDevice: Identifiable, Hashable {
    let uid: String
    let name: String
    /// "usb", "network", "bluetooth" as Browser Print says it; empty when it doesn't.
    let connection: String
    let manufacturer: String
    /// The device exactly as Browser Print gave it: `/write` and `/read` want it back whole.
    let raw: Data

    var id: String { uid }
}

/// How ZPL gets to a Zebra (`TagPrinter.Route`), the shop's words when it can't:
///
/// - **Zebra Browser Print** (Mac only): Zebra's free helper listens on 127.0.0.1:9100. `GET /available` answers
///   `{"printer":[device, …]}`, `GET /default?type=printer` one device (empty when none), `POST /write` takes
///   `{"device": <the device>, "data": "<zpl>"}` and `POST /read` `{"device": …}` and answers what the printer said.
///   The same calls the web's zebra-printer.ts makes through Zebra's script.
/// - **A Mac printer** (CUPS, raw): the job goes as `application/vnd.cups-raw`, so no driver redraws the ZPL.
/// - **A network address** (both): TCP, port 9100 by default, the ZPL written and the connection closed.
enum ZebraTransport {
    static let browserPrintBase = "http://127.0.0.1:9100"
    static let browserPrintDownload = "https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html"

    // MARK: Sending

    @MainActor
    static func send(_ zpl: String, to route: TagPrinter.Route) async -> TagPrinter.Outcome {
        switch route {
        case .browserPrint(let uid):
            #if os(macOS)
            return await browserPrintSend(zpl, uid: uid)
            #else
            return TagPrinter.Outcome(ok: false, message: "Zebra Browser Print runs on a Mac. On the iPhone, use the Zebra's network address, or Label LIVE through the Mac at the counter.")
            #endif
        case .systemQueue(let name):
            #if os(macOS)
            return await systemQueueSend(zpl, queue: name)
            #else
            return TagPrinter.Outcome(ok: false, message: "This iPhone can't use a Mac's printers. Use the Zebra's network address, or Label LIVE through the Mac at the counter.")
            #endif
        case .network(let host, let port):
            return await networkSend(zpl, host: host, port: port)
        }
    }

    /// The printer's own answer to a status question, in the shop's words; nil when this way can't ask (a Mac printer
    /// queue is one-way) or the printer said nothing. "Ready." when nothing is wrong.
    static func status(_ route: TagPrinter.Route) async -> String? {
        switch route {
        case .systemQueue: return nil
        case .browserPrint(let uid):
            #if os(macOS)
            guard let device = await browserPrintResolve(uid: uid).device else { return nil }
            _ = try? await browserPrintCall("/write", ["device": device.json, "data": "~HS"])
            // The printer needs a moment to answer.
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard let data = try? await browserPrintCall("/read", ["device": device.json]),
                  let text = String(data: data, encoding: .utf8) else { return nil }
            return describe(hostStatus: text)
            #else
            return nil
            #endif
        case .network(let host, let port):
            guard let answer = try? await ZebraSocket(host: host, port: port).exchange(Data("~HS".utf8), reply: 2.0) else { return nil }
            return describe(hostStatus: String(decoding: answer, as: UTF8.self))
        }
    }

    // MARK: Status words

    /// `~HS` answers three lines, each framed STX … ETX: line 1 `comm,paper out,pause,…`, line 2 `…,head up,ribbon out,…`.
    /// (Zebra's ZPL guide, Host Status Return.) Not enough fields means it wasn't a Zebra's answer.
    static func describe(hostStatus text: String) -> String? {
        let lines = text.split(whereSeparator: { $0.isNewline || $0 == "\u{02}" || $0 == "\u{03}" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard lines.count >= 2 else { return nil }
        let a = lines[0].split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        let b = lines[1].split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        guard a.count >= 3, b.count >= 4 else { return nil }
        var problems: [String] = []
        if a[1] == "1" { problems.append("out of labels") }
        if b[2] == "1" { problems.append("the print head is open") }
        if b[3] == "1" { problems.append("out of ribbon") }
        if a[2] == "1" { problems.append("paused") }
        if problems.isEmpty { return "Ready." }
        let first = problems[0].prefix(1).uppercased() + problems[0].dropFirst()
        return ([first] + problems.dropFirst()).joined(separator: ", ") + "."
    }

    // MARK: Zebra Browser Print (Mac)

    static func browserPrintDevices() async -> [BrowserPrintDevice] {
        #if os(macOS)
        guard let data = try? await browserPrintGet("/available"),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [] }
        let list = (object["printer"] as? [[String: Any]]) ?? []
        return list.compactMap(device(from:))
        #else
        return []
        #endif
    }

    #if os(macOS)
    private static func device(from d: [String: Any]) -> BrowserPrintDevice? {
        guard let uid = d["uid"] as? String, !uid.isEmpty,
              let raw = try? JSONSerialization.data(withJSONObject: d) else { return nil }
        return BrowserPrintDevice(uid: uid, name: (d["name"] as? String) ?? uid, connection: (d["connection"] as? String) ?? "",
                                  manufacturer: (d["manufacturer"] as? String) ?? "", raw: raw)
    }

    private static let notRunning = "Zebra Browser Print isn't running on this Mac. Open it (Zebra's free helper, in the menu bar), or get it from zebra.com."

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 5
        c.timeoutIntervalForResource = 8
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    private static func browserPrintGet(_ path: String) async throws -> Data {
        guard let url = URL(string: browserPrintBase + path) else { throw URLError(.badURL) }
        let (data, response) = try await session.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        return data
    }

    private static func browserPrintCall(_ path: String, _ body: [String: Any]) async throws -> Data {
        guard let url = URL(string: browserPrintBase + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        request.httpMethod = "POST"
        // Browser Print reads the body as text; its own script posts it as text/plain.
        request.setValue("text/plain;charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "BrowserPrint", code: (response as? HTTPURLResponse)?.statusCode ?? 0,
                          userInfo: [NSLocalizedDescriptionKey: String(data: data, encoding: .utf8) ?? "refused"])
        }
        return data
    }

    /// A device as Browser Print gave it, ready to hand back in a body.
    private struct Resolved {
        let json: [String: Any]
        let name: String
    }

    private static func browserPrintResolve(uid: String?) async -> (device: Resolved?, failure: String?) {
        let devices = await browserPrintDevices()
        func resolved(_ d: BrowserPrintDevice) -> Resolved? {
            guard let o = (try? JSONSerialization.jsonObject(with: d.raw)) as? [String: Any] else { return nil }
            return Resolved(json: o, name: d.name)
        }
        if let uid, !uid.isEmpty {
            if let d = devices.first(where: { $0.uid == uid }), let r = resolved(d) { return (r, nil) }
            if (try? await browserPrintGet("/available")) == nil { return (nil, notRunning) }
            return (nil, "Browser Print doesn't see that Zebra now. Switch it on and plug it in, then choose it again in Settings → Labels → Printer.")
        }
        // No printer chosen: Browser Print's own default.
        if let data = try? await browserPrintGet("/default?type=printer"),
           let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let uid = o["uid"] as? String, !uid.isEmpty {
            return (Resolved(json: o, name: (o["name"] as? String) ?? uid), nil)
        }
        if let first = devices.first, let r = resolved(first) { return (r, nil) }
        if (try? await browserPrintGet("/available")) == nil { return (nil, notRunning) }
        return (nil, "Browser Print doesn't see a Zebra. Switch the printer on and plug it in.")
    }

    private static func browserPrintSend(_ zpl: String, uid: String?) async -> TagPrinter.Outcome {
        let found = await browserPrintResolve(uid: uid)
        guard let device = found.device else {
            return TagPrinter.Outcome(ok: false, message: found.failure ?? notRunning)
        }
        do {
            _ = try await browserPrintCall("/write", ["device": device.json, "data": zpl])
            return TagPrinter.Outcome(ok: true, message: "Sent to \(device.name).")
        } catch let e as URLError where e.code == .cannotConnectToHost || e.code == .timedOut || e.code == .networkConnectionLost {
            return TagPrinter.Outcome(ok: false, message: notRunning)
        } catch {
            return TagPrinter.Outcome(ok: false, message: "Browser Print couldn't print: \(error.localizedDescription)")
        }
    }

    // MARK: A Mac printer, raw (CUPS)

    /// The printers macOS knows (System Settings → Printers), by queue name.
    static func systemQueues() -> [String] {
        var dests: UnsafeMutablePointer<cups_dest_t>?
        let n = cupsGetDests(&dests)
        defer { cupsFreeDests(n, dests) }
        guard n > 0, let dests else { return [] }
        return (0..<Int(n)).compactMap { dests[$0].name.map { String(cString: $0) } }.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private static func systemQueueSend(_ zpl: String, queue: String) async -> TagPrinter.Outcome {
        await Task.detached(priority: .userInitiated) { rawJob(zpl, queue: queue) }.value
    }

    /// One raw CUPS job: create, start the document as raw, write, finish. CUPS' own words are kept when it refuses.
    private static func rawJob(_ zpl: String, queue: String) -> TagPrinter.Outcome {
        guard systemQueues().contains(queue) else {
            return TagPrinter.Outcome(ok: false, message: "This Mac has no printer called \"\(queue)\" now. Choose it again in Settings → Labels → Printer.")
        }
        let job = cupsCreateJob(nil, queue, "ERP tags", 0, nil)
        guard job > 0 else {
            return TagPrinter.Outcome(ok: false, message: "The Mac wouldn't start the job: \(String(cString: cupsLastErrorString()))")
        }
        let bytes = Array(zpl.utf8)
        let started = cupsStartDocument(nil, queue, job, "tags.zpl", "application/vnd.cups-raw", 1)
        guard started == HTTP_STATUS_CONTINUE else {
            return TagPrinter.Outcome(ok: false, message: "The Mac wouldn't take the tags: \(String(cString: cupsLastErrorString()))")
        }
        // In chunks so a long roll of tags doesn't sit in one write.
        var offset = 0
        while offset < bytes.count {
            let n = min(16_384, bytes.count - offset)
            let wrote = bytes.withUnsafeBufferPointer { cupsWriteRequestData(nil, $0.baseAddress! + offset, n) }
            guard wrote == HTTP_STATUS_CONTINUE else {
                _ = cupsFinishDocument(nil, queue)
                return TagPrinter.Outcome(ok: false, message: "The Mac stopped partway: \(String(cString: cupsLastErrorString()))")
            }
            offset += n
        }
        let done = cupsFinishDocument(nil, queue)
        if done.rawValue >= IPP_STATUS_REDIRECTION_OTHER_SITE.rawValue {
            return TagPrinter.Outcome(ok: false, message: "The Mac's printer refused it: \(String(cString: cupsLastErrorString()))")
        }
        return TagPrinter.Outcome(ok: true, message: "Sent to \(queue).")
    }
    #else
    static func systemQueues() -> [String] { [] }
    #endif

    // MARK: A network address (both)

    static func networkSend(_ zpl: String, host: String, port: Int) async -> TagPrinter.Outcome {
        let host = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else { return TagPrinter.Outcome(ok: false, message: "Type the Zebra's address first (Settings → Labels → Printer).") }
        do {
            try await ZebraSocket(host: host, port: port).exchange(Data(zpl.utf8), reply: 0)
            return TagPrinter.Outcome(ok: true, message: "Sent to \(host).")
        } catch ZebraSocket.Failure.timeout {
            return TagPrinter.Outcome(ok: false, message: "No answer from \(host) in six seconds. Is the Zebra on, and on the same network as this device?")
        } catch {
            return TagPrinter.Outcome(ok: false, message: "Couldn't reach the Zebra at \(host) (port \(port)): is it on, on this network, and the address right? (\(error.localizedDescription))")
        }
    }
}

/// One TCP conversation with a Zebra's raw port: connect, write, optionally listen for a moment, close.
final class ZebraSocket: @unchecked Sendable {
    enum Failure: Error { case timeout, closed }

    private let connection: NWConnection
    private let queue = DispatchQueue(label: "erp.zebra.socket")

    init(host: String, port: Int) {
        let p = NWEndpoint.Port(rawValue: UInt16(clamping: port > 0 ? port : 9100)) ?? 9100
        connection = NWConnection(host: NWEndpoint.Host(host), port: p, using: .tcp)
    }

    /// Writes `data`; when `reply` > 0 waits up to that many seconds for the printer to say something and returns it.
    /// Connecting is given six seconds.
    @discardableResult
    func exchange(_ data: Data, reply: TimeInterval) async throws -> Data {
        defer { connection.cancel() }
        try await connect()
        try await write(data)
        guard reply > 0 else { return Data() }
        return (try? await read(timeout: reply)) ?? Data()
    }

    private func connect() async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            let once = ZebraOnce()
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

    private func read(timeout: TimeInterval) async throws -> Data {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Data, Error>) in
            let once = ZebraOnce()
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, _, error in
                guard once.take() else { return }
                if let error { done.resume(throwing: error) } else { done.resume(returning: data ?? Data()) }
            }
            queue.asyncAfter(deadline: .now() + timeout) { if once.take() { done.resume(throwing: Failure.timeout) } }
        }
    }
}

private final class ZebraOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func take() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}

// MARK: - The test print

extension TagPrinter {
    /// A small tag to prove the Zebra works: the shop's name, today's date, a QR of "TEST". It takes the shop's tag size
    /// and printer options (so media, darkness and offsets are tried too) but none of its fields.
    static func testZpl(shopName: String, layout: LabelLayout, now: Date = Date()) -> String {
        let w = layout.hasSize ? layout.widthDots : 664
        let h = layout.hasSize ? layout.heightDots : 296
        let test = LabelLayout(
            id: "test", name: "Test", widthDots: w, heightDots: h, dpi: layout.dpi, tags: 1, printer: layout.printer,
            fields: [
                LabelLayoutField(id: "shop", type: .text, x: 30, y: 30, data: shopName.isEmpty ? "Test print" : shopName, fontSize: 30),
                LabelLayoutField(id: "date", type: .text, x: 30, y: 90, data: "{date:d MMM yyyy}", fontSize: 24),
                LabelLayoutField(id: "qr", type: .qr, x: max(30, w - 200), y: 30, data: "TEST", qrMagnification: 4),
            ])
        return Zpl.render(test, pieces: [[:]], now: now)
    }
}
