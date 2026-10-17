import SwiftUI
import FirebaseAuth
import Observation

/// One `Session` per business: who is signed in to it and what they are there (the ERP says: /api/app/me).
/// Firebase keeps each business's sign-in in its own app, so every business stays signed in independently;
/// only the open business's session is live at a time (`Sessions.current`). Switching drops the one left and
/// opens the next from its cached answer, as a cold start does.
@MainActor
final class Sessions {
    static let shared = Sessions()
    private var all: [String: Session] = [:]

    /// The open business's session, made the first time it is asked for. Reading it in a view's body also
    /// reads `Businesses.current`, so the view redraws when the business changes.
    var current: Session { session(for: Businesses.shared.current) }

    func session(for b: Business) -> Session {
        if let s = all[b.id] { return s }
        let s = Session(business: b)
        all[b.id] = s
        return s
    }

    /// The business was left: its session is not kept (Book and the stores start again for the next one).
    func deactivate(_ id: String) { all[id] = nil }
    func drop(_ id: String) { all[id] = nil }

    /// A business is being removed from this phone: sign it out (the server forgets this phone's alerts, Firebase
    /// forgets the person, the books on disk are erased) without touching the open business.
    func signOutForRemoval(_ b: Business) async {
        guard !House.isDemo, let auth = Businesses.shared.auth(for: b), auth.currentUser != nil else {
            GoogleAuth.shared.signOut(b)
            return
        }
        await DeviceLinks.beforeSignOut(unregister: true, business: b)
        try? auth.signOut()
        GoogleAuth.shared.signOut(b)
        await FirestoreSource.forget(b)
        UserDefaults.standard.removeObject(forKey: BizKey("erp.lastMe", b.id))
    }
}

/// Who is signed in and what they are to one business (the ERP says: /api/app/me). Owners get the
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
        /// Where the Workshop starts: "you" (this account's own pieces) or "anyone" (STORE_WORKSHOP_START). Absent in an older answer: "you".
        var workshopStart: String?

        /// Before the ERP has answered (the demo, an old cached answer): nothing assumed beyond the business. Its own
        /// switches are the descriptor's `flags` (the built-ins' businesses.json, an added business's /api/app/business);
        /// a missing one is Taheri's, the code's default.
        static var fallback: Shop {
            let b = House.business, f = b.flags
            return Shop(name: b.name, person: nil, takenBy: [], expenseCategories: [],
                        partnership: f?.partnership ?? false, websiteSelling: f?.websiteSelling ?? true,
                        invoiceByCustomer: f?.invoiceByCustomer ?? true, invoiceWhatsappPdf: f?.invoiceWhatsappPdf ?? true,
                        sizeToProfile: f?.sizeToProfile ?? true, workshopStart: f?.workshopStart)
        }

        static var demo: Shop {
            var s = fallback
            s.name = "DEMO"; s.person = "Demo"; s.takenBy = ["Demo", "Counter Two", "Counter Three"]
            s.expenseCategories = ["Shop", "Utilities", "Karigar", "Rent", "Partner Drawings", "Partner Salary", "Other"]
            return s
        }
    }

    /// The business this session is for.
    let business: Business

    /// The last answer, for opening with no connection: the role is the server's, never assumed. One per
    /// business (`erp.lastMe.<id>`; Businesses moves the old `erp.lastMe` to Taheri's).
    private var lastMe: Me? {
        get { UserDefaults.standard.data(forKey: BizKey("erp.lastMe", business.id)).flatMap { try? JSONDecoder().decode(Me.self, from: $0) } }
        set { UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: BizKey("erp.lastMe", business.id)) }
    }

    private var isActive: Bool { Businesses.shared.current.id == business.id }

    /// This business's Firebase sign-in (nil in the demo, or until its iOS app is registered).
    private var auth: Auth? { Businesses.shared.auth(for: business) }

    var state: State = .starting
    var me: Me?
    var error: String?

    var role: String { me?.role ?? "none" }
    var isOwner: Bool { role == "owner" }
    /// The house's settings for the screens (see Shop).
    var shop: Shop { me?.shop ?? .fallback }

    /// The first frame is the app itself, not a wait: the demo, and anyone the ERP answered for last time
    /// (the same answer the app already opens on offline), start signed in, so a cold start draws the
    /// shop's own pages (their skeletons while the books arrive) straight after the launch screen.
    /// `start()` then checks Firebase's sign-in and asks the ERP again; a changed role or a removed account
    /// is applied as soon as it answers. Nothing here touches Firebase: the business's app is made when
    /// `start()` first asks for it.
    init(business: Business) {
        self.business = business
        if House.isDemo {
            me = Me(email: "owner@example.com", role: "owner", karigar: nil, shop: .demo)
            Book.shared.signedIn(role: "owner")
            state = .signedIn
        } else if business.firebaseOptions == nil {
            state = .needsSetup
        } else if let last = lastMe, last.role != "none" {
            me = last
            Book.shared.signedIn(role: last.role)
            state = .signedIn
        }
        Task { await start() }
    }

    func start() async {
        if House.isDemo { return }
        guard let auth else { state = .needsSetup; return }
        guard let user = auth.currentUser else {
            // Opened on the cached answer, but Firebase has nobody signed in: back to the sign-in page.
            if me != nil { me = nil; lastMe = nil; Book.shared.signedOut() }
            state = .signedOut
            return
        }
        if let me, me.email.lowercased() != user.email?.lowercased() {
            // The cached answer was someone else's: show nothing of theirs while the ERP is asked.
            self.me = nil
            Book.shared.signedOut()
            state = .starting
        }
        await loadMe()
    }

    func signIn() async {
        guard let auth else { state = .needsSetup; return }
        state = .signingIn
        error = nil
        do {
            let t = try await GoogleAuth.shared.signIn(business: business)
            _ = try await auth.signIn(with: GoogleAuthProvider.credential(withIDToken: t.idToken, accessToken: t.accessToken))
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
            let me: Me = try await ERPAPI.shared.get("/api/app/me", business: business)
            // The person switched business while the ERP was answering: this answer is not for the books now open.
            guard isActive else { return }
            if me.role == "none" {
                error = "\(me.email) isn't on \(business.displayName)'s list. Ask the shop to add this Gmail."
                signOut()
                return
            }
            self.me = me
            lastMe = me
            Book.shared.signedIn(role: me.role)
            state = .signedIn
            if me.role == "owner" { await DeviceLinks.afterSignIn() }
        } catch {
            guard isActive else { return }
            // The ERP refused the sign-in and Google says the account itself is gone or disabled: not "offline".
            if let f = error as? ERPAPI.Failure, f.status == 401 || f.status == 403, await accountGone() {
                self.error = "This sign-in is no longer valid. Sign in again."
                signOut(unregister: false)
                return
            }
            // No answer (offline, or the server restarting): stay signed in as the ERP last said.
            if let last = lastMe, last.email.lowercased() == auth?.currentUser?.email?.lowercased() {
                me = last
                Book.shared.signedIn(role: last.role)
                state = .signedIn
            } else {
                self.error = Self.say(error)
                state = .signedOut
            }
        }
    }

    /// `unregister: false` when Google already refused the account: its token can't delete anything.
    func signOut(unregister: Bool = true) {
        // The screen leaves at once; the phone is unregistered for alerts while its sign-in token is still good
        // (after Firebase's sign-out the request would go without one, be refused, and alerts would keep coming).
        lastMe = nil
        Book.shared.signedOut()
        me = nil
        state = .signedOut
        let biz = business
        let auth = self.auth
        let leaving = auth?.currentUser?.uid
        Task {
            await DeviceLinks.beforeSignOut(unregister: unregister, business: biz)
            // Only the account that was leaving: a quick sign-in again meanwhile is not undone.
            if let auth, auth.currentUser?.uid == leaving { try? auth.signOut() }
            if state != .signedIn && state != .signingIn { GoogleAuth.shared.signOut(biz) }
            // The owner's books stay on no phone after sign-out: Firestore's copy on disk is erased too.
            if state == .signedOut { await FirestoreSource.forget(biz) }
        }
    }

    /// Whether a refusal means the account is really over: a forced token refresh that Firebase rejects for
    /// the user (disabled, deleted, its token revoked). A network failure is not that.
    private func accountGone() async -> Bool {
        guard let user = auth?.currentUser else { return true }
        do {
            _ = try await user.getIDToken(forcingRefresh: true)
            return false
        } catch {
            let ns = error as NSError
            guard ns.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: ns.code) else { return false }
            switch code {
            case .userDisabled, .userNotFound, .userTokenExpired, .invalidUserToken: return true
            default: return false
            }
        }
    }

    /// The Firebase ID token the ERP's server routes check.
    func idToken() async -> String? {
        if House.isDemo { return nil }
        return try? await auth?.currentUser?.getIDToken()
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
