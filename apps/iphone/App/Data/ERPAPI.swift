import Foundation
import FirebaseAuth

/// The ERP's server routes, as the signed-in person (their Firebase ID token). Every write that
/// moves money goes this way (CONVENTIONS.md rule 1): the rules live once, in the ERP.
@MainActor
final class ERPAPI {
    static let shared = ERPAPI()

    struct Failure: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }

    /// `timeout` is how long the ERP may take to answer: a minute, save for a send to WhatsApp that the server
    /// lets run for five (a queued piece's photos to every group, one after another).
    ///
    /// `business` is the one asked (its server, its sign-in); omitted, the one open now. A change already on its
    /// way when the person switches business names its own (WorkDraftSync), so it never lands in the next one.
    func data(_ path: String, method: String = "GET", json: [String: Any]? = nil, timeout: TimeInterval = 60, business: Business? = nil) async throws -> Data {
        let biz = business ?? House.business
        // The demo has no server and no Firebase: every call answers as if offline.
        if House.isDemo || biz.isDemo { throw Failure(status: 0, message: "Not connected to the ERP in the demo.") }
        guard let auth = Businesses.shared.auth(for: biz) else { throw Failure(status: 0, message: "\(biz.displayName) isn't set up for sign-in in this build.") }
        // The sign-in token goes to the business's own ERP and nowhere else, whatever path is passed in.
        guard let url = URL(string: path, relativeTo: biz.url)?.absoluteURL,
              url.scheme == "https", url.host == biz.url.host else {
            throw Failure(status: 0, message: "Not an address of this ERP.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        if let token = try? await auth.currentUser?.getIDToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await Self.session.data(for: request, delegate: StayOnHost.shared)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw Failure(status: status, message: said ?? "The ERP answered \(status).")
        }
        return data
    }

    /// The books' answers are never written to the phone's HTTP cache (staff's copy of the books
    /// comes this way), and no cookie or credential outlives the app: an ephemeral session.
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpCookieAcceptPolicy = .never
        return URLSession(configuration: c)
    }()

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self, business: Business? = nil) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(path, business: business))
    }

    func post<T: Decodable>(_ path: String, _ json: [String: Any], as type: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(path, method: "POST", json: json))
    }

    /// The person switched business: the names handed to recent changes were that business's.
    func reset() { recent = [:] }

    /// A change to the books (/api/app/write): the ERP runs its own shared write, then names what
    /// the browser would do next (the WhatsApp alert, a Shopify sync). Those are sent here without
    /// waiting, so a slow PDF never holds the sale up.
    @discardableResult
    func write(_ op: String, _ fields: [String: Any]) async throws -> [String: Any] {
        var body = fields
        body["op"] = op
        body["requestId"] = requestId(for: body)
        let out = try await send("/api/app/write", body)
        // Staff read the books every 25 seconds: fetch them now, so the balance just paid is never
        // left on screen to be paid again.
        ServerShelf.wake()
        for f in out["followUps"] as? [[String: Any]] ?? [] {
            guard let path = f["path"] as? String, path.hasPrefix("/api/"), let b = f["body"] as? [String: Any] else { continue }
            Task { _ = try? await self.send(path, b) }
        }
        return out
    }

    /// The same change asked for again within half a minute (a double tap, the sheet opened again over
    /// a balance not yet refreshed, a retry after the line dropped) goes with the same name, and the ERP
    /// records it once (/api/app/write refuses a name it has seen). A second, genuinely separate payment
    /// of the same amount is entered after that.
    private var recent: [String: (id: String, at: Date)] = [:]

    private func requestId(for body: [String: Any]) -> String {
        let now = Date()
        recent = recent.filter { now.timeIntervalSince($0.value.at) < 30 }
        // "When" is not part of what the change is: two taps a second apart are the same payment.
        var what = body
        for k in ["date", "createdAt", "at", "now"] { what[k] = nil }
        let key = (try? JSONSerialization.data(withJSONObject: what, options: [.sortedKeys]))
            .map { String(decoding: $0, as: UTF8.self) } ?? UUID().uuidString
        let id = recent[key]?.id ?? UUID().uuidString
        recent[key] = (id, now)
        return id
    }

    @discardableResult
    func send(_ path: String, method: String = "POST", _ json: [String: Any] = [:], timeout: TimeInterval = 60, business: Business? = nil) async throws -> [String: Any] {
        let d = try await data(path, method: method, json: json, timeout: timeout, business: business)
        return ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any]) ?? [:]
    }
}

/// A redirect off the request's own host (or off https) is refused, so the Authorization header never
/// follows one somewhere else. The host is read per request (the business changes at run time), and must be
/// one of the businesses this phone knows.
final class StayOnHost: NSObject, URLSessionTaskDelegate, Sendable {
    static let shared = StayOnHost()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? {
        guard let url = request.url, url.scheme == "https", let host = url.host,
              host == task.originalRequest?.url?.host, BusinessBox.shared.hosts.contains(host) else { return nil }
        return request
    }
}
