import Foundation
import FirebaseAuth
import FirebaseCore

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

    func data(_ path: String, method: String = "GET", json: [String: Any]? = nil) async throws -> Data {
        // The demo has no server and no Firebase: every call answers as if offline.
        if House.isDemo || FirebaseApp.app() == nil { throw Failure(status: 0, message: "Not connected to the ERP in the demo.") }
        var request = URLRequest(url: URL(string: path, relativeTo: House.serverURL)!)
        request.httpMethod = method
        request.timeoutInterval = 60
        if let token = try? await Auth.auth().currentUser?.getIDToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw Failure(status: status, message: said ?? "The ERP answered \(status).")
        }
        return data
    }

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(path))
    }

    func post<T: Decodable>(_ path: String, _ json: [String: Any], as type: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(path, method: "POST", json: json))
    }

    @discardableResult
    func send(_ path: String, method: String = "POST", _ json: [String: Any] = [:]) async throws -> [String: Any] {
        let d = try await data(path, method: method, json: json)
        return ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any]) ?? [:]
    }
}
