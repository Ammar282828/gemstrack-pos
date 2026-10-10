import SwiftUI
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
    func attach<T: Decodable>(_ name: String, docId: String? = nil, deliver: @escaping @MainActor (Delivery<T>) -> Void) -> () -> Void {
        switch source {
        case .demo:
            // Decoded off the main thread, as the owners' Firestore answers are: thousands of documents
            // (`-ERPDemoScale`) must not hold up the first frame.
            let task = Task.detached(priority: .userInitiated) {
                let docs = Demo.docs(name)
                let items: [T] = docId.map { id in
                    docs.filter { ($0["id"] as? String) == id }.compactMap { DocJSON.decode(T.self, id: id, data: $0) }
                } ?? docs.compactMap { d in DocJSON.decode(T.self, id: d["id"] as? String ?? "", data: d) }
                guard !Task.isCancelled else { return }
                await MainActor.run { deliver(.all(items, offline: false)) }
            }
            return { task.cancel() }
        case .server:
            return ServerShelf.poll(name: name == Collections.settings ? "settings" : name, single: docId != nil, deliver: deliver)
        case .firestore:
            return FirestoreSource.listen(name, docId: docId, deliver: deliver)
        }
    }
}

/// What a source hands a shelf.
enum Delivery<T> {
    /// Everything there is (a first answer, a poll, the demo).
    case all([T], offline: Bool)
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

    init(_ name: String, sort before: @escaping (T, T) -> Bool) {
        self.name = name
        self.before = before
    }

    /// Start filling, once. Every screen that shows this collection calls it on appear.
    func need() {
        guard stop == nil else { return }
        stop = Book.shared.attach(name) { [weak self] (d: Delivery<T>) in self?.take(d) }
    }

    /// One document by id. Reads `items` first so a screen showing one document redraws when it changes
    /// (the lookup table itself is not observed).
    func item(_ id: String) -> T? {
        _ = items.count
        return byId[id]
    }

    func reset() {
        stop?()
        stop = nil
        byId = [:]
        items = []
        revision += 1
        loaded = false
        offline = false
        error = nil
    }

    private func take(_ d: Delivery<T>) {
        switch d {
        case .all(let list, let off):
            byId = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            publish(off)
        case .changes(let upserts, let removed, let off):
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
        case .failed(let message):
            // Keep what is on screen: a dropped connection is no reason to blank the list being read.
            error = message
            loaded = true
        }
    }

    private func publish(_ off: Bool) {
        items = byId.values.sorted(by: before)
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
    @ObservationIgnored private var stop: (() -> Void)?

    init(_ collection: String, _ docId: String) {
        self.collection = collection
        self.docId = docId
    }

    func need() {
        guard stop == nil else { return }
        stop = Book.shared.attach(collection, docId: docId) { [weak self] (d: Delivery<T>) in
            guard let self else { return }
            switch d {
            case .all(let list, _): value = list.first ?? value; loaded = true; error = nil
            case .changes(let upserts, _, _): value = upserts.first ?? value; loaded = true; error = nil
            case .failed(let m): error = m; loaded = true
            }
        }
    }

    func reset() {
        stop?()
        stop = nil
        value = nil
        loaded = false
        error = nil
    }
}

/// Staff and marketing: the ERP's server, polled (store.ts attachStaffPoll, 25 s).
enum ServerShelf {
    static let every: Duration = .seconds(25)
    /// Bumped after every change the phone makes: each poller stops waiting and reads again.
    @MainActor private static var nudges = 0

    @MainActor static func wake() { nudges += 1 }

    @MainActor
    static func poll<T: Decodable>(name: String, single: Bool, deliver: @escaping @MainActor (Delivery<T>) -> Void) -> () -> Void {
        let task = Task { @MainActor in
            while !Task.isCancelled {
                do {
                    let data = try await ERPAPI.shared.data("/api/staff/collections?name=\(name)")
                    // Read and decoded off the main thread: staff's whole copy arrives every 25 seconds.
                    let items: [T] = await Task.detached(priority: .userInitiated) {
                        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                        if single {
                            let doc = json["doc"] as? [String: Any] ?? [:]
                            return DocJSON.decode(T.self, id: doc["id"] as? String ?? "global", data: doc).map { [$0] } ?? []
                        }
                        return DocJSON.decodeList(T.self, from: json["docs"] as? [Any] ?? [])
                    }.value
                    deliver(.all(items, offline: false))
                } catch let e as ERPAPI.Failure where e.status == 403 {
                    // Not this person's to read (a marketing account and the books): an empty shelf, not an error.
                    deliver(.all([], offline: false))
                    return
                } catch {
                    deliver(.failed(error.localizedDescription))
                }
                // Wait out the interval, unless a change made on this phone asks for the books now.
                let seen = nudges
                for _ in 0..<25 where !Task.isCancelled && nudges == seen {
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
