import SwiftUI
import FirebaseAuth
import FirebaseCore
import Observation

/// Who is signed in and what they are to this house (the ERP says: /api/app/me). Owners get the
/// whole app; a karigar gets their work portal; anyone else is signed out again with the reason.
@MainActor
@Observable
final class Session {
    enum State { case starting, signedOut, signingIn, signedIn, needsSetup }

    struct Me: Codable {
        let email: String
        let role: String
        let karigar: Karigar?
        struct Karigar: Codable { let id: String; let name: String }
    }

    /// The last answer, for opening with no connection: the role is the server's, never assumed.
    private static let lastMeKey = "erp.lastMe"
    private static var lastMe: Me? {
        get { UserDefaults.standard.data(forKey: lastMeKey).flatMap { try? JSONDecoder().decode(Me.self, from: $0) } }
        set { UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: lastMeKey) }
    }

    var state: State = .starting
    var me: Me?
    var error: String?

    var role: String { me?.role ?? "none" }
    var isOwner: Bool { role == "owner" }

    init() { Task { await start() } }

    func start() async {
        if House.isDemo {
            me = Me(email: "owner@example.com", role: "owner", karigar: nil)
            Book.shared.signedIn(role: "owner")
            state = .signedIn
            return
        }
        guard House.firebaseOptions != nil else { state = .needsSetup; return }
        if Auth.auth().currentUser != nil { await loadMe() } else { state = .signedOut }
    }

    func signIn() async {
        guard FirebaseApp.app() != nil else { state = .needsSetup; return }
        state = .signingIn
        error = nil
        do {
            let t = try await GoogleAuth.shared.signIn()
            _ = try await Auth.auth().signIn(with: GoogleAuthProvider.credential(withIDToken: t.idToken, accessToken: t.accessToken))
            await loadMe()
        } catch let e as GoogleAuth.Failure {
            if case .cancelled = e { state = .signedOut } else { error = e.localizedDescription; state = .signedOut }
        } catch {
            self.error = Self.say(error)
            state = .signedOut
        }
    }

    private func loadMe() async {
        do {
            let me: Me = try await ERPAPI.shared.get("/api/app/me")
            if me.role == "none" {
                error = "\(me.email) isn't on \(House.storeName)'s list. Ask the shop to add this Gmail."
                signOut()
                return
            }
            self.me = me
            Self.lastMe = me
            Book.shared.signedIn(role: me.role)
            state = .signedIn
            if me.role == "owner" { await DeviceLinks.afterSignIn() }
        } catch {
            // No answer (offline, or the server restarting): stay signed in as the ERP last said.
            if let last = Self.lastMe, last.email.lowercased() == Auth.auth().currentUser?.email?.lowercased() {
                me = last
                Book.shared.signedIn(role: last.role)
                state = .signedIn
            } else {
                self.error = Self.say(error)
                state = .signedOut
            }
        }
    }

    func signOut() {
        Task { await DeviceLinks.beforeSignOut() }
        if FirebaseApp.app() != nil { try? Auth.auth().signOut() }
        GoogleAuth.shared.signOut()
        Self.lastMe = nil
        Book.shared.signedOut()
        me = nil
        state = .signedOut
    }

    /// The Firebase ID token the ERP's server routes check.
    func idToken() async -> String? {
        if House.isDemo { return nil }
        return try? await Auth.auth().currentUser?.getIDToken()
    }

    static func say(_ error: Error) -> String {
        let ns = error as NSError
        if ns.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: ns.code) {
            switch code {
            case .networkError: return "No connection to Google. Check the internet and try again."
            case .adminRestrictedOperation: return "This Google account hasn't been let in yet: the shop has to allow new sign-ins first."
            case .tooManyRequests: return "Too many tries. Wait a minute, then try again."
            default: break
            }
        }
        return error.localizedDescription
    }
}
