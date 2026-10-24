import Foundation
import AuthenticationServices
import CryptoKit
#if canImport(UIKit)
import UIKit
#endif

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
    /// The ID token in hand, per business: each has its own Google client and its own sign-in.
    private var cached: [String: (tokens: Tokens, until: Date)] = [:]

    /// The keychain account of a business's refresh token. The single-house builds kept it as "google.refresh";
    /// Businesses moves that to Taheri's (the only business an earlier install had).
    nonisolated static func refreshAccount(_ id: String) -> String { "google.refresh.\(id)" }

    private func clientID(_ b: Business) -> String { b.ios.googleClientId }
    private func scheme(_ b: Business) -> String { "com.googleusercontent.apps." + clientID(b).replacingOccurrences(of: ".apps.googleusercontent.com", with: "") }
    private func redirect(_ b: Business) -> String { scheme(b) + ":/oauth2redirect" }

    func canRefreshSilently(_ b: Business = House.business) -> Bool { Keychain.get(Self.refreshAccount(b.id)) != nil }

    /// A Google ID token for a business (the open one unless said): the one in hand if it has ten minutes left,
    /// else a silent refresh, else the sheet.
    func idToken(interactive: Bool = true, business b: Business = House.business) async throws -> Tokens {
        if let c = cached[b.id], c.until > Date().addingTimeInterval(600) { return c.tokens }
        if let refresh = Keychain.get(Self.refreshAccount(b.id)), let t = try? await exchange(["grant_type": "refresh_token", "refresh_token": refresh], business: b) { return t }
        guard interactive else { throw Failure.failed("Sign in again.") }
        return try await signIn(business: b)
    }

    func signIn(business b: Business = House.business) async throws -> Tokens {
        let cid = clientID(b), sch = scheme(b), red = redirect(b)
        guard cid.hasSuffix(".apps.googleusercontent.com") else { throw Failure.notConfigured }
        let verifier = Self.randomURLSafe(32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomURLSafe(16)
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            .init(name: "client_id", value: cid), .init(name: "redirect_uri", value: red),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state), .init(name: "prompt", value: "select_account"),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: sch) { url, error in
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
        return try await exchange(["grant_type": "authorization_code", "code": code, "code_verifier": verifier, "redirect_uri": red], business: b)
    }

    func signOut(_ b: Business = House.business) {
        cached[b.id] = nil
        Keychain.set(nil, for: Self.refreshAccount(b.id))
    }

    private func exchange(_ form: [String: String], business b: Business) async throws -> Tokens {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        request.httpBody = (form.merging(["client_id": clientID(b)]) { a, _ in a })
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? $0.value)" }
            .joined(separator: "&").data(using: .utf8)
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let id = json["id_token"] as? String else {
            if form["grant_type"] == "refresh_token" { Keychain.set(nil, for: Self.refreshAccount(b.id)) }
            throw Failure.failed("Google didn't sign you in (\(json["error_description"] as? String ?? json["error"] as? String ?? "no token")).")
        }
        if let r = json["refresh_token"] as? String { Keychain.set(r, for: Self.refreshAccount(b.id)) }
        let tokens = Tokens(idToken: id, accessToken: json["access_token"] as? String ?? "")
        cached[b.id] = (tokens, Date().addingTimeInterval(TimeInterval((json["expires_in"] as? Int) ?? 3600)))
        return tokens
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if os(macOS)
            // The window the person clicked Sign in from; any of the app's windows otherwise.
            return NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? NSWindow()
            #else
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return key }
            // Sign-in is only ever started from a screen, so there is always a scene to anchor to.
            return UIWindow(windowScene: scenes[0])
            #endif
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
