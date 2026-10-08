import Foundation
import AuthenticationServices
import CryptoKit
import UIKit

/// Google sign-in the way Google allows it in an app: Apple's sign-in sheet (Safari's engine and
/// cookies), the house's iOS OAuth client, PKCE. Google's ID token signs Firebase in (Session), and
/// the refresh token it also gives lets the app hand a fresh ID token to the ERP pages it shows
/// (Web/WebBridge.swift) without the sheet again. Carried over from the Capacitor shell (apps/ios).
@MainActor
final class GoogleAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleAuth()

    struct Tokens { let idToken: String; let accessToken: String }

    enum Failure: LocalizedError {
        case cancelled, notConfigured, failed(String)
        var errorDescription: String? {
            switch self {
            case .cancelled: return "Sign-in cancelled."
            case .notConfigured: return "Google sign-in isn't set up in this build."
            case .failed(let why): return why
            }
        }
        var code: String {
            switch self { case .cancelled: return "cancelled"; case .notConfigured: return "not-configured"; case .failed: return "failed" }
        }
    }

    private var session: ASWebAuthenticationSession?
    private var cached: (tokens: Tokens, until: Date)?
    private let refreshKey = "google.refresh"

    private var clientID: String { House.googleClientID }
    private var scheme: String { "com.googleusercontent.apps." + clientID.replacingOccurrences(of: ".apps.googleusercontent.com", with: "") }
    private var redirect: String { scheme + ":/oauth2redirect" }

    var canRefreshSilently: Bool { Keychain.get(refreshKey) != nil }

    /// A Google ID token: the one in hand if it has ten minutes left, else a silent refresh, else the sheet.
    func idToken(interactive: Bool = true) async throws -> Tokens {
        if let c = cached, c.until > Date().addingTimeInterval(600) { return c.tokens }
        if let refresh = Keychain.get(refreshKey), let t = try? await exchange(["grant_type": "refresh_token", "refresh_token": refresh]) { return t }
        guard interactive else { throw Failure.failed("Sign in again.") }
        return try await signIn()
    }

    func signIn() async throws -> Tokens {
        guard clientID.hasSuffix(".apps.googleusercontent.com") else { throw Failure.notConfigured }
        let verifier = Self.randomURLSafe(32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomURLSafe(16)
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state), .init(name: "prompt", value: "select_account"),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: scheme) { url, error in
                if let error {
                    cont.resume(throwing: (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin ? Failure.cancelled : Failure.failed(error.localizedDescription))
                } else if let url { cont.resume(returning: url) } else { cont.resume(throwing: Failure.failed("No answer from Google.")) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() { cont.resume(throwing: Failure.failed("Couldn't open Google sign-in.")) }
        }
        session = nil
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (n: String) in items.first { $0.name == n }?.value }
        if let e = value("error") { throw e == "access_denied" ? Failure.cancelled : Failure.failed("Google said: \(e)") }
        guard value("state") == state, let code = value("code") else { throw Failure.failed("Google's answer didn't match this sign-in.") }
        return try await exchange(["grant_type": "authorization_code", "code": code, "code_verifier": verifier, "redirect_uri": redirect])
    }

    func signOut() {
        cached = nil
        Keychain.set(nil, for: refreshKey)
    }

    private func exchange(_ form: [String: String]) async throws -> Tokens {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        request.httpBody = (form.merging(["client_id": clientID]) { a, _ in a })
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? $0.value)" }
            .joined(separator: "&").data(using: .utf8)
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let id = json["id_token"] as? String else {
            if form["grant_type"] == "refresh_token" { Keychain.set(nil, for: refreshKey) }
            throw Failure.failed("Google didn't sign you in (\(json["error_description"] as? String ?? json["error"] as? String ?? "no token")).")
        }
        if let r = json["refresh_token"] as? String { Keychain.set(r, for: refreshKey) }
        let tokens = Tokens(idToken: id, accessToken: json["access_token"] as? String ?? "")
        cached = (tokens, Date().addingTimeInterval(TimeInterval((json["expires_in"] as? Int) ?? 3600)))
        return tokens
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return key }
            // Sign-in is only ever started from a screen, so there is always a scene to anchor to.
            return UIWindow(windowScene: scenes[0])
        }
    }

    private static func randomURLSafe(_ n: Int) -> String {
        var d = Data(count: n)
        _ = d.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, n, $0.baseAddress!) }
        return base64URL(d)
    }

    private static func base64URL(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
