import SwiftUI
import Observation
import FirebaseCore
import FirebaseAuth
import FirebaseFirestore

/// Where the businesses are kept, readable from any thread (the box in House.swift starts from here, before
/// the main-actor store exists).
enum BusinessStorage {
    /// The built-ins, as the ERP would describe them (Resources/businesses.json, written by
    /// scripts/businesses.mjs from houses.json and the palettes). They ship with the app, so the first launch
    /// needs no network and the two houses keep their bundled art.
    static func bundled() -> [Business] {
        guard let url = Bundle.main.url(forResource: "businesses", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Business].self, from: data), !list.isEmpty else {
            fatalError("Resources/businesses.json is missing or unreadable: run `node scripts/businesses.mjs`.")
        }
        return list
    }

    struct File: Codable {
        var businesses: [Business]
        /// Built-ins the person removed: not offered again by an update of the app.
        var removed: [String]
    }

    static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("businesses.json")
    }

    static let currentKey = "erp.business.current"

    /// The persisted list with the bundled built-ins that are not in it (and not removed) added.
    static func merged() -> (list: [Business], removed: [String]) {
        let file = (try? Data(contentsOf: fileURL)).flatMap { try? JSONDecoder().decode(File.self, from: $0) }
        var list = file?.businesses ?? []
        let removed = file?.removed ?? []
        for b in bundled() where !list.contains(where: { $0.id == b.id }) && !removed.contains(b.id) { list.append(b) }
        if list.isEmpty { list = bundled() }
        return (list, removed)
    }

    /// The demo's one business: Taheri's look, no Firebase, never saved.
    static func demo() -> Business {
        var b = bundled().first { $0.id == "taheri" } ?? bundled()[0]
        b.id = Business.demoID
        b.ios.firebase.appId = ""
        return b
    }

    static func start() -> (list: [Business], current: Business) {
        if UserDefaults.standard.bool(forKey: "ERPDemo") { let d = demo(); return ([d], d) }
        let list = merged().list
        let id = UserDefaults.standard.string(forKey: currentKey)
        return (list, list.first { $0.id == id } ?? list.first { $0.id == "taheri" } ?? list[0])
    }
}

/// The businesses this phone knows and the one that is open. One app, many businesses: Taheri and House of Mina
/// ship in it, any other is added by typing its ERP's address (the ERP describes itself at
/// `GET /api/app/business`). Everything per business hangs off the id: its Firebase app (and so its sign-in,
/// independently of the others), its Google refresh token, its settings (`BizKey`), its books.
@MainActor
@Observable
final class Businesses {
    static let shared = Businesses()

    private(set) var list: [Business]
    private(set) var current: Business
    @ObservationIgnored private var removed: [String]
    /// The "Businesses" sheet is open (the chip, the sign-in page and Settings open it; ERPApp's BusinessHost presents it
    /// above the screens, which a switch rebuilds underneath).
    var switcherOpen = false

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    private init() {
        Businesses.migrateLegacy()
        let m = BusinessStorage.merged()
        let s = BusinessStorage.start()
        list = s.list
        current = s.current
        removed = m.removed
        BusinessBox.shared.set(current: current, list: list)
    }

    func business(_ id: String) -> Business? { list.first { $0.id == id } }

    // MARK: Adding

    /// Reads and judges the business whose ERP is at `address` ("erp.example.shop", "https://erp.example.shop/anything"):
    /// the origin over https, its descriptor fetched and checked. Keeps nothing: the Businesses sheet shows what comes
    /// back as a preview card, and `add` keeps it.
    func describe(address: String) async throws -> Business {
        guard !House.isDemo else { throw Failure("The demo can't add a business.") }
        let origin = try Self.origin(of: address)
        var request = URLRequest(url: origin.appendingPathComponent("api/app/business"))
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let result: (Data, URLResponse)
        do { result = try await Self.session.data(for: request) }
        catch { throw Failure("Couldn't reach \(origin.host ?? "that address"). Check it and the internet.") }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), response.url?.host == origin.host else {
            throw Failure("That address isn't an ERP this app can open.")
        }
        guard var b = try? JSONDecoder().decode(Business.self, from: data) else { throw Failure("That address isn't an ERP this app can open.") }
        // The descriptor speaks for the host it came from and no other: it could otherwise point the sign-in
        // token at a stranger's server.
        guard URL(string: b.serverURL)?.host == origin.host else { throw Failure("That ERP names a different address for itself.") }
        b.serverURL = "https://\(origin.host ?? "")"
        if b.id == Business.demoID { b.id = "demo-" + (origin.host ?? "").replacingOccurrences(of: ".", with: "-") }
        if let existing = business(b.id), existing.host != b.host {
            // Same brand id on another address (a second Taheri-like ERP): a business of its own.
            b.id = Self.slug(b.id + "-" + (origin.host ?? ""))
        }
        if let why = b.problem { throw Failure(why) }
        return b
    }

    /// Adds the business whose ERP is at `address` (see `describe`), kept. An address already added is refreshed.
    /// Does not switch to it; the caller does.
    @discardableResult
    func add(address: String) async throws -> Business {
        let b = try await describe(address: address)
        if let i = list.firstIndex(where: { $0.id == b.id }) {
            list[i] = Self.keepingIdentity(of: list[i], updatedBy: b)
            if current.id == b.id { current = list[i] }
        } else {
            list.append(b)
        }
        removed.removeAll { $0 == b.id }
        persist()
        return business(b.id) ?? b
    }

    /// `https://host` from what a person types; nothing else survives (path, query, port, scheme).
    nonisolated static func origin(of address: String) throws -> URL {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { throw Failure("Type the ERP's address.") }
        if !text.contains("://") { text = "https://" + text }
        guard let parts = URLComponents(string: text), let host = parts.host?.lowercased(),
              host.contains("."), host.range(of: "^[a-z0-9.-]+$", options: .regularExpression) != nil,
              parts.port == nil || parts.port == 443 else { throw Failure("That doesn't look like an ERP address.") }
        guard let url = URL(string: "https://\(host)") else { throw Failure("That doesn't look like an ERP address.") }
        return url
    }

    nonisolated static func slug(_ text: String) -> String {
        let s = text.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        let collapsed = s.replacingOccurrences(of: "-+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return String(collapsed.prefix(40))
    }

    /// A refresh never moves what a Firebase app is already configured with, nor the address the sign-in token goes to.
    private static func keepingIdentity(of old: Business, updatedBy new: Business) -> Business {
        var b = new
        b.id = old.id
        b.serverURL = old.serverURL
        b.ios = old.ios
        if old.art != nil { b.storeName = old.storeName }
        return b
    }

    /// Never follows a cookie or keeps one: the descriptor is public and asked for before anyone has signed in.
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.httpCookieAcceptPolicy = .never
        return URLSession(configuration: c)
    }()

    // MARK: Removing

    /// Forgets a business on this phone: its sign-in, its books on disk, its settings and its logo. The last one
    /// cannot go. If it is the open one, the first of the others opens.
    func remove(_ id: String) async {
        guard list.count > 1, let gone = business(id), !House.isDemo else { return }
        if current.id == id, let next = list.first(where: { $0.id != id }) { `switch`(to: next.id) }
        await Sessions.shared.signOutForRemoval(gone)
        ERPWidgetLink.remove(id: id)
        list.removeAll { $0.id == id }
        if Business.bundledIDs.contains(id) { removed.append(id) }
        persist()
        BizDefaults.forget(id)
        BusinessLogos.forget(gone)
        Keychain.set(nil, for: GoogleAuth.refreshAccount(id))
        Sessions.shared.drop(id)
        // The default Firebase app (Taheri's) cannot be deleted while the app runs; a named one can.
        if gone.id != Self.defaultAppBusinessID, let app = FirebaseApp.app(name: Self.appName(gone)) { _ = await app.delete() }
    }

    // MARK: Switching

    /// Opens another business. Everything that belonged to the one left is let go (the books, the shared
    /// stores, the router, the change names), and the root view is rebuilt on the new id (ERPApp), so every
    /// screen starts from nothing. Each business's sign-in stays: coming back needs no Google sheet.
    func `switch`(to id: String) {
        guard !House.isDemo, id != current.id, let next = business(id) else { return }
        let left = current
        // Open work is saved under the business it was typed in, before the open business changes.
        BusinessSwitchPin.leaving(left)
        WorkDraftSync.order.flush(leaving: left)
        WorkDraftSync.sale.flush(leaving: left)
        UserDefaults.standard.set(id, forKey: BusinessStorage.currentKey)
        BusinessBox.shared.set(current: next, list: list)
        Sessions.shared.deactivate(left.id)
        Self.resetPerBusinessState()
        // The next business's session now, from its cached answer (as a cold start opens), rather than while
        // the screen is being drawn; then the screen is rebuilt on it.
        _ = Sessions.shared.session(for: next)
        current = next
    }

    /// The main-actor singletons that hold one business's data. Replaced, not cleared, so work still in flight
    /// for the business left lands in an instance nobody reads.
    static func resetPerBusinessState() {
        Book.shared.signedOut()
        OnlineInbox.reset()
        OnlineOrdersStore.reset()
        PostsStore.reset()
        WebsiteStore.reset()
        WebsiteEdits.reset()
        WebsiteGold.reset()
        StudioHandoffs.reset()
        DesignHooks.reset()
        ArtworkClipboard.reset()
        AppRouter.shared.open = nil
        ERPAPI.shared.reset()
        WorkDraftSync.order.reset()
        WorkDraftSync.sale.reset()
        NavMap.invalidate()
    }

    // MARK: Refreshing

    /// Asks every business to describe itself again, quietly: a new colour, name, logo or switch arrives
    /// without an app update. Anything that fails or looks wrong leaves what the phone has.
    func refresh() async {
        guard !House.isDemo else { return }
        for old in list {
            guard let url = URL(string: "api/app/business", relativeTo: old.url)?.absoluteURL else { continue }
            var request = URLRequest(url: url)
            request.timeoutInterval = 10
            request.cachePolicy = .reloadIgnoringLocalCacheData
            guard let (data, response) = try? await Self.session.data(for: request),
                  (response as? HTTPURLResponse)?.statusCode == 200, response.url?.host == old.host,
                  var fresh = try? JSONDecoder().decode(Business.self, from: data),
                  URL(string: fresh.serverURL)?.host == old.host, fresh.id == old.id else { continue }
            fresh.serverURL = old.serverURL
            let merged = Self.keepingIdentity(of: old, updatedBy: fresh)
            guard merged.problem == nil, merged != old, let i = list.firstIndex(where: { $0.id == old.id }) else { continue }
            list[i] = merged
            if current.id == old.id { current = merged }
        }
        BusinessBox.shared.set(current: current, list: list)
        persist()
        WidgetLinker.sync(list)
    }

    private func persist() {
        guard !House.isDemo else { return }
        BusinessBox.shared.set(current: current, list: list)
        let file = BusinessStorage.File(businesses: list, removed: removed)
        if let data = try? JSONEncoder().encode(file) { try? data.write(to: BusinessStorage.fileURL, options: .atomic) }
    }

    // MARK: Firebase, one app per business

    /// Taheri keeps the default Firebase app, as before the merge: its signed-in person (kept by Firebase under
    /// the default app's name) stays signed in through the update. Every other business has an app named for it.
    nonisolated static let defaultAppBusinessID = "taheri"
    nonisolated static func appName(_ b: Business) -> String { "b-" + b.id }

    /// The business's Firebase app, made the first time it is asked for. Nil in the demo, or until the
    /// business's iOS app is registered in Firebase.
    func firebaseApp(for b: Business) -> FirebaseApp? {
        if House.isDemo || b.isDemo { return nil }
        guard let options = b.firebaseOptions else { return nil }
        if b.id == Self.defaultAppBusinessID {
            if FirebaseApp.app() == nil { FirebaseApp.configure(options: options) }
            return FirebaseApp.app()
        }
        let name = Self.appName(b)
        if let app = FirebaseApp.app(name: name) { return app }
        FirebaseApp.configure(name: name, options: options)
        return FirebaseApp.app(name: name)
    }

    func auth(for b: Business) -> Auth? { firebaseApp(for: b).map { Auth.auth(app: $0) } }

    /// The business's Firestore with the phone's own copy on disk (so the app opens with yesterday's books and no
    /// connection). Settings can only be given before an instance is first used, so they are set when this
    /// finds an instance it has not set up (a fresh one after `FirestoreSource.forget`).
    func firestore(for b: Business) -> Firestore? {
        guard let app = firebaseApp(for: b) else { return nil }
        let db = Firestore.firestore(app: app)
        if configured[b.id] != ObjectIdentifier(db) {
            let s = FirestoreSettings()
            s.cacheSettings = PersistentCacheSettings(sizeBytes: NSNumber(value: 512 * 1024 * 1024))
            s.dispatchQueue = FirestoreSource.queue
            db.settings = s
            configured[b.id] = ObjectIdentifier(db)
        }
        return db
    }

    @ObservationIgnored private var configured: [String: ObjectIdentifier] = [:]

    /// The open business's own.
    var firebaseApp: FirebaseApp? { firebaseApp(for: current) }
    var auth: Auth? { auth(for: current) }
    var firestore: Firestore? { firestore(for: current) }

    /// Businesses with somebody signed in on this phone (their push registration, their widget).
    func signedInBusinesses() -> [Business] {
        list.filter { auth(for: $0)?.currentUser != nil }
    }

    // MARK: Moving the single-house builds' settings

    /// What the one-house builds kept under unsuffixed names now belongs to Taheri, the business every earlier
    /// install was (the Mina app was a different app, with its own storage). Once.
    private static func migrateLegacy() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: "erp.business.migrated") else { return }
        defer { d.set(true, forKey: "erp.business.migrated") }
        if d.bool(forKey: "ERPDemo") { return }
        BizDefaults.moveLegacy(to: Self.defaultAppBusinessID)
        if let old = Keychain.get("google.refresh"), Keychain.get(GoogleAuth.refreshAccount("taheri")) == nil {
            Keychain.set(old, for: GoogleAuth.refreshAccount("taheri"))
        }
        Keychain.set(nil, for: "google.refresh")
    }
}

/// The settings that belong to a business (`BizKey`), and how the old unsuffixed ones move.
enum BizDefaults {
    /// Exact keys the single-house builds wrote, and WorkDraftSync's.
    static let legacyKeys = [
        "erp.orderDraft", "erp.saleDraft", "erp.saleBillRates", "erp.website.photoFolder", "design_wa_targets",
        "taheri_post_folder", "ads.newAd.last", "erp.lastMe",
        "erp.orderDraft.remoteId", "erp.orderDraft.remoteCreatedAt", "erp.orderDraft.remoteLanded",
        "erp.saleDraft.remoteId", "erp.saleDraft.remoteCreatedAt", "erp.saleDraft.remoteLanded",
    ]
    /// Families of keys with a tail ("design.publish.<design id>").
    static let legacyPrefixes = ["design.publish."]

    static func moveLegacy(to id: String) {
        let d = UserDefaults.standard
        func move(_ old: String) {
            guard let value = d.object(forKey: old) else { return }
            let new = BizKey(old, id)
            if d.object(forKey: new) == nil { d.set(value, forKey: new) }
            d.removeObject(forKey: old)
        }
        legacyKeys.forEach(move)
        for key in d.dictionaryRepresentation().keys where legacyPrefixes.contains(where: key.hasPrefix) {
            // A key already carrying a business id is the new kind (a rerun).
            if key.hasSuffix("." + id) { continue }
            move(key)
        }
    }

    /// Everything one business kept on this phone's defaults.
    static func forget(_ id: String) {
        let d = UserDefaults.standard
        for key in d.dictionaryRepresentation().keys where key.hasSuffix("." + id) && (
            legacyKeys.contains { key == BizKey($0, id) } || legacyPrefixes.contains { key.hasPrefix($0) }
            || key == "studio.board.last." + id || key == "design.draft.current." + id) {
            d.removeObject(forKey: key)
        }
    }
}

/// A business's logo from its ERP, kept on disk (Caches) so the sign-in page is not blank offline.
/// The built-ins use the bundled BrandLogo-<id> and never come here.
enum BusinessLogos {
    private static var folder: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("BusinessLogos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func address(_ b: Business, dark: Bool) -> String? {
        let url = dark ? (b.logo.dark ?? b.logo.light) : (b.logo.light ?? b.logo.dark)
        guard let url, let u = URL(string: url), u.scheme == "https" else { return nil }
        return url
    }

    /// The file's name carries a hash of the address, so a changed logo is fetched afresh.
    private static func file(_ b: Business, _ address: String, dark: Bool) -> URL {
        var h: UInt64 = 5381
        for u in address.utf8 { h = (h &* 33) &+ UInt64(u) }
        return folder.appendingPathComponent("\(b.id)-\(dark ? "dark" : "light")-\(String(h, radix: 36))")
    }

    static func load(_ b: Business, dark: Bool) async -> UIImage? {
        guard let address = address(b, dark: dark), let url = URL(string: address) else { return nil }
        let path = file(b, address, dark: dark)
        if let data = try? Data(contentsOf: path), let image = UIImage(data: data) { return image }
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data) else { return nil }
        try? data.write(to: path, options: .atomic)
        return image
    }

    static func forget(_ b: Business) {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        for f in files where f.lastPathComponent.hasPrefix(b.id + "-") { try? FileManager.default.removeItem(at: f) }
    }
}
