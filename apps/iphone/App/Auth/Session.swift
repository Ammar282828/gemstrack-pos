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
        /// The house's own settings (/api/app/me `shop`); missing from an answer cached by an older build.
        var shop: Shop?
        struct Karigar: Codable { let id: String; let name: String }
    }

    /// What the web reads from its build (lib/store-config.ts) and the screens must follow, per house.
    struct Shop: Codable, Equatable {
        /// The shop's own name ("TAHERI"), for what goes to a customer or a karigar: never "… ERP".
        var name: String
        /// This account's counter name, when it has one on the house's list (lib/people.ts).
        var person: String?
        /// The counter names "Taken by" offers (STORE_TAKEN_BY).
        var takenBy: [String]
        var expenseCategories: [String]
        /// Partners pay expenses and draw (STORE_PARTNERSHIP, House of Mina).
        var partnership: Bool
        /// The website takes orders, so online orders wait to be confirmed (STORE_WEBSITE_SELLING).
        var websiteSelling: Bool
        /// An invoice is named after its customer ("Invoice - <name>") (STORE_INVOICE_BY_CUSTOMER).
        var invoiceByCustomer: Bool
        var invoiceWhatsappPdf: Bool
        /// Sizes on an order are offered to the customer's profile (STORE_SIZE_TO_PROFILE).
        var sizeToProfile: Bool

        /// Before the ERP has answered (the demo, an old cached answer): nothing assumed beyond the house.
        static var fallback: Shop {
            Shop(name: House.id == "mina" ? "MINA" : "TAHERI", person: nil, takenBy: [], expenseCategories: [],
                 partnership: House.id == "mina", websiteSelling: House.id != "mina", invoiceByCustomer: House.id != "mina",
                 invoiceWhatsappPdf: House.id != "mina", sizeToProfile: House.id != "mina")
        }

        static let demo = Shop(name: "DEMO", person: "Demo", takenBy: ["Demo", "Counter Two", "Counter Three"],
                               expenseCategories: ["Shop", "Utilities", "Karigar", "Rent", "Partner Drawings", "Partner Salary", "Other"],
                               partnership: House.id == "mina", websiteSelling: House.id != "mina", invoiceByCustomer: House.id != "mina",
                               invoiceWhatsappPdf: House.id != "mina", sizeToProfile: House.id != "mina")
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
    /// The house's settings for the screens (see Shop).
    var shop: Shop { me?.shop ?? .fallback }

    init() { Task { await start() } }

    func start() async {
        if House.isDemo {
            me = Me(email: "owner@example.com", role: "owner", karigar: nil, shop: .demo)
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
        // The owner's books stay on no phone after sign-out: Firestore's copy on disk is erased too.
        Task { await FirestoreSource.forget() }
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
