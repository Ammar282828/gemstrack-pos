import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
import Observation
import ERPCore

/// The shop's books on the phone: one shelf per Firestore collection, kept live.
///
/// Where a shelf fills from depends on who is signed in, exactly as the web store decides
/// (store.ts `readsThroughServer`):
/// - an owner reads Firestore itself, live, with the phone's own copy for opening offline;
/// - staff and marketing have no Firestore access (firestore.rules): their shelves come from the
///   ERP's server (/api/staff/collections), which strips the cost side, every 25 seconds;
/// - the demo (`-ERPDemo YES`) reads made-up documents from the app (Resources/demo.json).
///
/// A shelf is read only once a screen asks for it (`need()`), so nobody pays for a collection
/// they never open. Reads only: every write goes through the ERP's server (CONVENTIONS.md rule 1),
/// and the change comes back down the shelf like anyone else's.
@MainActor
@Observable
final class Book {
    static let shared = Book()

    enum Source { case firestore, server, demo }

    @ObservationIgnored private(set) var source: Source = House.isDemo ? .demo : .firestore

    let orders = Shelf<Order>(Collections.orders) { $0.createdAt > $1.createdAt }
    let invoices = Shelf<Invoice>(Collections.invoices) { $0.createdAt > $1.createdAt }
    let customers = Shelf<Customer>(Collections.customers) { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    let karigars = Shelf<Karigar>(Collections.karigars) { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    let hisaab = Shelf<HisaabEntry>(Collections.hisaab) { $0.date > $1.date }
    let expenses = Shelf<Expense>(Collections.expenses) { $0.date > $1.date }
    let revenue = Shelf<AdditionalRevenue>(Collections.additionalRevenue) { $0.date > $1.date }
    let products = Shelf<Product>(Collections.products) { $0.sku.localizedStandardCompare($1.sku) == .orderedAscending }
    let repairs = Shelf<Repair>(Collections.repairs) { $0.receivedAt > $1.receivedAt }
    let givenItems = Shelf<GivenItem>(Collections.givenItems) { $0.date > $1.date }
    let karigarJobs = Shelf<KarigarJob>(Collections.karigarJobs) { $0.id > $1.id }
    let karigarBatches = Shelf<KarigarBatch>(Collections.karigarBatches) { $0.startDate > $1.startDate }
    let settings = Single<Settings>(Collections.settings, Collections.globalSettingsDoc)

    private var all: [any Resettable] { [orders, invoices, customers, karigars, hisaab, expenses, revenue, products, repairs, givenItems, karigarJobs, karigarBatches, settings] }

    /// Who is reading, once the ERP has said (Session.loadMe). Shelves already filled for someone
    /// else start again.
    func signedIn(role: String) {
        let next: Source = House.isDemo ? .demo : (role == "owner" ? .firestore : .server)
        if next != source { all.forEach { $0.reset() } }
        source = next
    }

    func signedOut() { all.forEach { $0.reset() } }

    /// Where a shelf's documents come from; the shelf calls it on its first `need()` and keeps the
    /// returned stop for `reset()`.
    func attach<T: Decodable>(_ name: String, docId: String? = nil, sort: ((T, T) -> Bool)? = nil, deliver: @escaping @MainActor (Delivery<T>) -> Void) -> () -> Void {
        switch source {
        case .demo:
            // Decoded off the main thread, as the owners' Firestore answers are: thousands of documents
            // (`-ERPDemoScale`) must not hold up the first frame.
            let task = Task.detached(priority: .userInitiated) {
                let docs = Demo.docs(name)
                var items: [T] = docId.map { id in
                    docs.filter { ($0["id"] as? String) == id }.compactMap { DocJSON.decode(T.self, id: id, data: $0) }
                } ?? docs.compactMap { d in DocJSON.decode(T.self, id: d["id"] as? String ?? "", data: d) }
                if let sort { items.sort(by: sort) }
                guard !Task.isCancelled else { return }
                await MainActor.run { deliver(.all(items, offline: false, source: "demo")) }
            }
            return { task.cancel() }
        case .server:
            return ServerShelf.poll(name: name == Collections.settings ? "settings" : name, single: docId != nil, sort: sort, deliver: deliver)
        case .firestore:
            return FirestoreSource.listen(name, docId: docId, sort: sort, deliver: deliver)
        }
    }
}

/// What a source hands a shelf.
enum Delivery<T> {
    /// Everything there is (a first answer, a poll, the demo), already in the shelf's order (sorted by the source,
    /// off the main thread). `source` says where it came from for the launch report ("snapshot", "server", "demo");
    /// nil means the shelf works it out from the source and the cache flag.
    case all([T], offline: Bool, source: String? = nil)
    /// What changed since the last answer (Firestore's document changes).
    case changes(upserts: [T], removed: [String], offline: Bool)
    case failed(String)
}

@MainActor
protocol Resettable: AnyObject { func reset() }

/// One collection, live, sorted for its screens.
@MainActor
@Observable
final class Shelf<T: Decodable & Identifiable>: Resettable where T.ID == String {
    let name: String
    private(set) var items: [T] = []
    private(set) var loaded = false
    /// The last answer came from the phone's cache; this alone does not mean the network is offline.
    private(set) var offline = false
    private(set) var error: String?
    /// Goes up on every change to the items: a screen keys what it works out from them on this (Memo), so
    /// a figure is reckoned once per change of the books, not once per drawing of the screen.
    private(set) var revision = 0

    private let before: (T, T) -> Bool
    @ObservationIgnored private var byId: [String: T] = [:]
    @ObservationIgnored private var stop: (() -> Void)?
    /// Goes up on every reset: a delivery from a source attached before it (a slow answer for the business
    /// left) is dropped, not painted into the books now open.
    @ObservationIgnored private var epoch = 0

    init(_ name: String, sort before: @escaping (T, T) -> Bool) {
        self.name = name
        self.before = before
    }

    /// Start filling, once. Every screen that shows this collection calls it on appear.
    func need() {
        guard stop == nil else { return }
        let mine = epoch
        stop = Book.shared.attach(name, sort: before) { [weak self] (d: Delivery<T>) in
            guard let self, self.epoch == mine else { return }
            self.take(d)
        }
    }

    /// One document by id. Reads `items` first so a screen showing one document redraws when it changes
    /// (the lookup table itself is not observed).
    func item(_ id: String) -> T? {
        _ = items.count
        return byId[id]
    }

    func reset() {
        epoch += 1
        stop?()
        stop = nil
        byId = [:]
        items = []
        revision += 1
        loaded = false
        offline = false
        error = nil
    }

    @ObservationIgnored private var firstMarked = false
    @ObservationIgnored private var liveMarked = false

    /// The launch report's two stamps for this shelf: its first books (from the snapshot or a source), and the first
    /// that were not the snapshot.
    private func stamp(_ source: String) {
        let detail = "\(items.count) \(source)"
        if !firstMarked { firstMarked = true; LaunchClock.mark("shelf:" + name, detail) }
        if !liveMarked && source != "snapshot" { liveMarked = true; LaunchClock.mark("shelf:" + name + ":live", detail) }
    }

    private func take(_ d: Delivery<T>) {
        switch d {
        case .all(let list, let off, let tag):
            byId = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            // Sources hand the list sorted; only a list with repeated ids (one wins, as above) is sorted again here.
            publish(off, presorted: byId.count == list.count ? list : nil)
            stamp(tag ?? (Book.shared.source == .demo ? "demo" : Book.shared.source == .server ? "server" : off ? "cache" : "server"))
        case .changes(let upserts, let removed, let off):
            // Only the cache flag moved (Firestore's metadata change): no new books, so nothing re-reckoned.
            if upserts.isEmpty && removed.isEmpty { offline = off; error = nil; return }
            for x in upserts { byId[x.id] = x }
            for id in removed { byId[id] = nil }
            // A handful of documents changed (a payment, a status): placed where they sort, rather than
            // sorting the whole collection again on the main thread.
            if loaded, upserts.count + removed.count <= 32 {
                let gone = Set(upserts.map(\.id)).union(removed)
                var next = items.filter { !gone.contains($0.id) }
                for x in upserts {
                    var lo = 0, hi = next.count
                    while lo < hi { let mid = (lo + hi) / 2; if before(next[mid], x) { lo = mid + 1 } else { hi = mid } }
                    next.insert(x, at: lo)
                }
                items = next
                revision += 1
                offline = off
                error = nil
            } else {
                publish(off)
            }
            stamp(Book.shared.source == .server ? "server" : off ? "cache" : "server")
        case .failed(let message):
            // Keep what is on screen: a dropped connection is no reason to blank the list being read.
            error = message
            loaded = true
        }
    }

    private func publish(_ off: Bool, presorted: [T]? = nil) {
        items = presorted ?? byId.values.sorted(by: before)
        revision += 1
        offline = off
        loaded = true
        error = nil
    }
}

/// One document, live (the shop's settings: its rates and switches).
@MainActor
@Observable
final class Single<T: Decodable>: Resettable {
    let collection: String
    let docId: String
    private(set) var value: T?
    private(set) var loaded = false
    private(set) var error: String?
    /// Goes up whenever the value is replaced, as `Shelf.revision` does: what a Memo keys a figure on.
    private(set) var revision = 0
    @ObservationIgnored private var stop: (() -> Void)?
    @ObservationIgnored private var epoch = 0

    init(_ collection: String, _ docId: String) {
        self.collection = collection
        self.docId = docId
    }

    func need() {
        guard stop == nil else { return }
        let mine = epoch
        stop = Book.shared.attach(collection, docId: docId) { [weak self] (d: Delivery<T>) in
            guard let self, self.epoch == mine else { return }
            switch d {
            case .all(let list, _, _): value = list.first ?? value; revision += 1; loaded = true; error = nil
            case .changes(let upserts, _, _): value = upserts.first ?? value; revision += 1; loaded = true; error = nil
            case .failed(let m): error = m; loaded = true
            }
        }
    }

    func reset() {
        epoch += 1
        stop?()
        stop = nil
        value = nil
        revision += 1
        loaded = false
        error = nil
    }
}

/// Staff and marketing: the ERP's server, polled (store.ts attachStaffPoll, 25 s).
///
/// Only while the app is in the foreground: in the background the phone asks for nothing, and coming back asks
/// at once. The ERP answers 304 to the last answer's ETag when the collection has not changed, so a quiet shop
/// costs a header, nothing is decoded, and the shelf is not handed the same books again.
enum ServerShelf {
    static let every: Duration = .seconds(25)
    /// Bumped after every change the phone makes (and on coming back to the front): each poller stops waiting
    /// and reads again.
    @MainActor private static var nudges = 0
    @MainActor private static var foreground = true
    @MainActor private static var observing = false

    @MainActor static func wake() { nudges += 1 }

    @MainActor private static func observe() {
        guard !observing else { return }
        observing = true
        foreground = UIApplication.shared.applicationState != .background
        let c = NotificationCenter.default
        #if os(macOS)
        // A Mac behind another window still shows the books (the counter Mac, with Label LIVE in front), so only a
        // hidden app (⌘H) rests the polls; coming forward or unhiding reads again at once.
        c.addObserver(forName: NSApplication.didHideNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in foreground = false }
        }
        c.addObserver(forName: NSApplication.didUnhideNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in foreground = true; nudges += 1 }
        }
        c.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in foreground = true; nudges += 1 }
        }
        #else
        c.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in foreground = false }
        }
        c.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in foreground = true; nudges += 1 }
        }
        #endif
    }

    @MainActor
    static func poll<T: Decodable>(name: String, single: Bool, sort: ((T, T) -> Bool)? = nil, deliver: @escaping @MainActor (Delivery<T>) -> Void) -> () -> Void {
        observe()
        let business = Businesses.shared.current.id
        let task = Task { @MainActor in
            // The last poll's books from disk, before the network is asked (read and decoded off the main thread).
            let snap: [T]? = await Task.detached(priority: .userInitiated) {
                guard let data = ShelfSnapshots.read(.server, business: business, collection: name, docId: nil) else { return nil }
                guard var items = DocJSON.decodeArray(T.self, json: data) else {
                    ShelfSnapshots.discard(.server, business: business, collection: name, docId: nil)
                    return nil
                }
                if let sort { items.sort(by: sort) }
                return items
            }.value
            if let snap, !Task.isCancelled { deliver(.all(snap, offline: true, source: "snapshot")) }
            var written: [Data] = []
            var etag: String?
            while !Task.isCancelled {
                // Not in the foreground: nothing is asked until the app is back (which nudges).
                while !foreground && !Task.isCancelled { try? await Task.sleep(for: .seconds(1)) }
                if Task.isCancelled { return }
                do {
                    let answer = try await ERPAPI.shared.conditional("/api/staff/collections?name=\(name)", ifNoneMatch: etag)
                    if Task.isCancelled { return }
                    if answer.unchanged {
                        // The books are as they were: the shelf only learns it is live, not offline.
                        deliver(.changes(upserts: [], removed: [], offline: false))
                    } else {
                        let data = answer.data
                        // Read and decoded off the main thread: staff's whole copy arrives when it has changed.
                        let (items, bytes): ([T], [Data]) = await Task.detached(priority: .userInitiated) {
                            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                            var bytes: [Data]
                            if single {
                                let doc = json["doc"] as? [String: Any] ?? [:]
                                bytes = [DocJSON.json(id: doc["id"] as? String ?? "global", data: doc)].compactMap { $0 }
                            } else {
                                bytes = DocJSON.jsonList(from: json["docs"] as? [Any] ?? [])
                            }
                            var items = bytes.compactMap { DocJSON.decode(T.self, json: $0) }
                            if let sort { items.sort(by: sort) }
                            return (items, bytes)
                        }.value
                        if Task.isCancelled { return }
                        etag = answer.etag
                        deliver(.all(items, offline: false, source: "server"))
                        // Kept for the next cold start; only when the books changed, and off the main thread.
                        if bytes != written {
                            written = bytes
                            Task.detached(priority: .utility) {
                                ShelfSnapshots.write(.server, business: business, collection: name, docId: nil, documents: bytes)
                            }
                        }
                    }
                } catch let e as ERPAPI.Failure where e.status == 403 {
                    // Not this person's to read (a marketing account and the books): an empty shelf, not an error.
                    if !Task.isCancelled { deliver(.all([], offline: false, source: "server")) }
                    return
                } catch {
                    if Task.isCancelled { return }
                    deliver(.failed(error.localizedDescription))
                }
                // Wait out the interval, unless a change made on this phone (or coming back to the front) asks now.
                let seen = nudges
                for _ in 0..<25 where !Task.isCancelled && nudges == seen && foreground {
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        }
        return { task.cancel() }
    }
}

/// A figure worked out from the books, kept until one of the things it was worked out from changes
/// (`Shelf.revision`, a day, a setting). Held in a screen's `@State`; reading it does not redraw anything.
@MainActor
final class Memo<Value> {
    private var key: [Int]?
    private var value: Value?

    func callAsFunction(_ key: [Int], _ make: () -> Value) -> Value {
        if let value, self.key == key { return value }
        let made = make()
        self.key = key
        value = made
        return made
    }
}
