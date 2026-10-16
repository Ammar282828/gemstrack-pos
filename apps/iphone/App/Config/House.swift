import Foundation
import FirebaseCore
import ERPCore

/// The business that is open, as the ~150 places that say `House.id`, `House.serverURL`, `House.margin` read it.
/// One app now holds many businesses (Businesses.swift); this is a thin facade over the current one, so nothing
/// that reads it can freeze a business's values at first use: every property is computed, per call.
/// Read from any thread (the box below is locked), changed only by `Businesses.switch(to:)`.
enum House {
    /// The whole descriptor of the business open now.
    static var business: Business { BusinessBox.shared.current }

    static var id: String { business.id }
    /// "Taheri ERP": the ERP's own name. Anything a customer or a karigar reads says `session.shop.name`.
    static var storeName: String { business.displayName }
    static var serverURL: URL { business.url }
    static var metal: String { business.metal }
    static var googleClientID: String { business.ios.googleClientId }

    /// The id of the bundled art this business wears ("taheri", "mina"); an added business has none and
    /// takes Taheri's for the files that ship with the app (nav menus, the artwork engine).
    static var art: String { business.art ?? "taheri" }
    /// The same, but nil for an added business: for a screen that belongs to one of the built-ins (the Taheri Software
    /// import) and must not appear for a business that merely borrows Taheri's files.
    static var bundledArt: String? { business.art }

    /// How the shop's own margin is worked out (lib/margin.ts, the house's COST_RATTI_LESS and
    /// STORE_EST_MARGIN): Taheri costs a sale at 24K less 6 ratti, else 10%; Mina has no costing, 40%.
    /// Shop screens only: a customer never sees a margin.
    static var margin: MarginSettings { business.margin.settings }

    /// Launched with `-ERPDemo YES` (the simulator check): made-up data, no sign-in, no Firebase. A launch flag,
    /// not a business to switch to: the demo's one business wears Taheri's look (Businesses.demo).
    static let isDemo = UserDefaults.standard.bool(forKey: "ERPDemo")

    /// Firebase options for this business's project. Nil until its iOS app is registered in Firebase: the app
    /// then says so on its sign-in screen.
    static var firebaseOptions: FirebaseOptions? { business.firebaseOptions }

    /// Still the build's (Info.plist `ERPSharedKeychainGroup`): the widget's key is shared through it.
    static let sharedKeychainGroup: String? = {
        let g = (Bundle.main.object(forInfoDictionaryKey: "ERPSharedKeychainGroup") as? String ?? "").trimmingCharacters(in: .whitespaces)
        return g.isEmpty || g.hasPrefix(".") || g.contains("$(") ? nil : g
    }()
}

/// The current business and every known host, readable from any thread. `Businesses` (main actor) writes it;
/// `House`, `Theme`, `StayOnHost` and the Keychain helpers read it. Starts from the same file and setting
/// `Businesses` starts from, so the first read before anything has run is already right.
final class BusinessBox: @unchecked Sendable {
    static let shared = BusinessBox()

    private let lock = NSLock()
    private var _current: Business
    private var _hosts: Set<String>

    private init() {
        let start = BusinessStorage.start()
        _current = start.current
        _hosts = Set(start.list.map(\.host))
    }

    var current: Business { lock.lock(); defer { lock.unlock() }; return _current }
    var hosts: Set<String> { lock.lock(); defer { lock.unlock() }; return _hosts }

    func set(current: Business, list: [Business]) {
        lock.lock(); defer { lock.unlock() }
        _current = current
        _hosts = Set(list.map(\.host))
    }
}
