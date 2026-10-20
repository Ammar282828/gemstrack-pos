import Foundation
import UIKit
import CryptoKit
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
        try await raw(path, method: method, json: json, timeout: timeout, business: business, ifNoneMatch: nil).data
    }

    /// A read the ERP may answer "unchanged" (304) when `ifNoneMatch` is the ETag of the last answer: `data` is
    /// then empty and `etag` is the one passed in. The staff poll uses it so a quiet shop costs a header.
    func conditional(_ path: String, ifNoneMatch: String?, business: Business? = nil) async throws -> (data: Data, etag: String?, unchanged: Bool) {
        let r = try await raw(path, method: "GET", json: nil, timeout: 60, business: business, ifNoneMatch: ifNoneMatch)
        return (r.data, r.etag, r.status == 304)
    }

    private func raw(_ path: String, method: String, json: [String: Any]?, timeout: TimeInterval, business: Business?, ifNoneMatch: String?) async throws -> (data: Data, status: Int, etag: String?) {
        let biz = business ?? House.business
        // The demo has no server and no Firebase: every call answers as if offline.
        if House.isDemo || biz.isDemo { throw Failure(status: 0, message: "Not connected to the ERP in the demo.") }
        guard let auth = Businesses.shared.auth(for: biz) else { throw Failure(status: 0, message: "\(biz.displayName) isn't set up for sign-in in this build.") }
        // The sign-in token goes to the business's own ERP and nowhere else, whatever path is passed in.
        guard let url = URL(string: path, relativeTo: biz.url)?.absoluteURL,
              url.scheme == "https", url.host == biz.url.host else {
            throw Failure(status: 0, message: "Not an address of this ERP.")
        }
        // A 401 is an expired or revoked token the SDK had not noticed: one retry with a forced refresh.
        var refresh = false
        while true {
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = timeout
            if let token = try? await auth.currentUser?.getIDToken(forcingRefresh: refresh) {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            if let json {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: json)
            }
            if let ifNoneMatch { request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match") }
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await Self.session.data(for: request, delegate: StayOnHost.shared)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let etag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag")
            if status == 304, ifNoneMatch != nil { return (Data(), 304, ifNoneMatch) }
            if status == 401, !refresh, auth.currentUser != nil { refresh = true; continue }
            guard (200..<300).contains(status) else {
                let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
                throw Failure(status: status, message: said ?? "The ERP answered \(status).")
            }
            return (data, status, etag)
        }
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

    /// The person switched business: ids are kept per business on disk (below), so nothing is held here.
    func reset() {}

    /// A change to the books (/api/app/write): the ERP runs its own shared write, then names what
    /// the browser would do next (the WhatsApp alert, a Shopify sync). Those are sent here without
    /// waiting, so a slow PDF never holds the sale up.
    ///
    /// `requestId` is the one name for one intent: the caller keeps it for as long as the person's tap lives
    /// (a sheet, a draft) and the ERP records the change once however often it is sent. Without one, the
    /// name is remembered here (`WriteIntents`), on disk, against what the change is, until the ERP has
    /// answered: a retry after a timeout, or after the app was killed, goes with the same name.
    ///
    /// The business is the one open when the tap was made: the answer's follow-ups go there, not to
    /// whichever business is open when it comes back.
    @discardableResult
    func write(_ op: String, _ fields: [String: Any], requestId explicit: String? = nil) async throws -> [String: Any] {
        let biz = House.business
        var body = fields
        body["op"] = op
        let intent = explicit == nil ? WriteIntents.key(for: body) : nil
        body["requestId"] = explicit ?? WriteIntents.id(for: intent ?? "", business: biz.id)
        // Leaving the app mid-save must not cut the request off: the phone lends a few seconds.
        var bg = UIBackgroundTaskIdentifier.invalid
        bg = UIApplication.shared.beginBackgroundTask(withName: "erp.write") {
            UIApplication.shared.endBackgroundTask(bg)
            bg = .invalid
        }
        defer { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) } }
        let out: [String: Any]
        do {
            out = try await send("/api/app/write", body, business: biz)
        } catch let e as Failure where e.status == 409 {
            // "Already sent and recorded": the earlier try went through. The intent is done.
            if let intent { WriteIntents.clear(intent, business: biz.id) }
            throw e
        }
        if let intent { WriteIntents.clear(intent, business: biz.id) }
        // Staff read the books every 25 seconds: fetch them now, so the balance just paid is never
        // left on screen to be paid again.
        ServerShelf.wake()
        for f in out["followUps"] as? [[String: Any]] ?? [] {
            guard let path = f["path"] as? String, path.hasPrefix("/api/"), let b = f["body"] as? [String: Any] else { continue }
            Task { _ = try? await self.send(path, b, business: biz) }
        }
        return out
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

/// The names given to changes on their way, per business on disk: the same change asked for again
/// (a double tap, a retry after the line dropped, after the app was killed) keeps its name until the ERP
/// has answered, so it is recorded once. "When" is not part of what the change is. A name is forgotten
/// after a day, and on the answer (success, or "already recorded"); a second, separate payment of the same
/// amount is entered after that and gets its own.
enum WriteIntents {
    private static let keep: TimeInterval = 24 * 3600
    private static func defaultsKey(_ business: String) -> String { BizKey("erp.writeIntents", business) }

    static func key(for body: [String: Any]) -> String {
        var what = body
        for k in ["date", "createdAt", "at", "now", "requestId"] { what[k] = nil }
        let data = (try? JSONSerialization.data(withJSONObject: what, options: [.sortedKeys])) ?? Data(UUID().uuidString.utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Entries are "<id>|<seconds>".
    static func id(for key: String, business: String) -> String {
        let now = Date().timeIntervalSince1970
        var map = UserDefaults.standard.dictionary(forKey: defaultsKey(business)) as? [String: String] ?? [:]
        map = map.filter { _, v in
            Double(v.split(separator: "|").last.map(String.init) ?? "").map { now - $0 < keep } ?? false
        }
        let id = map[key].flatMap { $0.split(separator: "|").first.map(String.init) } ?? UUID().uuidString
        map[key] = "\(id)|\(Int(now))"
        UserDefaults.standard.set(map, forKey: defaultsKey(business))
        return id
    }

    static func clear(_ key: String, business: String) {
        var map = UserDefaults.standard.dictionary(forKey: defaultsKey(business)) as? [String: String] ?? [:]
        guard map.removeValue(forKey: key) != nil else { return }
        UserDefaults.standard.set(map, forKey: defaultsKey(business))
    }
}
