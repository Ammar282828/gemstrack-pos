import Foundation
import ERPCore
#if canImport(UIKit)
import UIKit
#endif

/// The phone's unfinished order and sale in the ERP's Drafts too (Firestore `drafts`; decisions.md "Drafts":
/// "every device in the shop sees the same list and a sale started on a phone is finished at the counter").
///
/// Saved at every moment (owner, 2026-10-25: "auto save at every moment so even if I've just written the name a draft
/// gets saved. However don't auto open the draft"). The phone keeps its own copy as it always has (NewOrderDraftStore,
/// SaleDraftStore), written at once on every change; this sends the same work, in the web form's own shape
/// (NewOrderWebDraft, SaleWebDraft), to /api/app/drafts within a third of a second of a change, as one write for a
/// burst of keys (the newest work wins) and never more than one write on its way; the app leaving, the screen going
/// and a business switch send it at once. A send that fails (no line) is kept on disk and tried again, so the
/// phone's copy reaches Drafts when the line is back (`resume`, and a retry with backoff).
///
/// Never auto-opened: a New order or New sale starts blank. The draft this phone was holding is made sure of in
/// Drafts (`release`) and its id forgotten, so the new form's first change is a NEW draft and never writes over
/// the old one. A draft is continued only on purpose: from Drafts (`adopt`: from then on this phone's work is that
/// draft) or from a screen that puts a piece on the sale in progress (Scan, Stock, the voice assistant: `?resume=1`).
/// Saving the order or sale removes only its own draft (`drop`).
///
/// Per kind and business there is one current draft: its id (the web's `newDraftId` form) is kept beside the
/// phone's copy. Sends go one at a time, in order, so an older draft never lands after a newer one or after the
/// remove; a draft removed while a send of it is waiting is never sent (the web's `finish`).
@MainActor
final class WorkDraftSync {
    static let order = WorkDraftSync(kind: "order")
    static let sale = WorkDraftSync(kind: "sale")

    /// A change reaches Drafts within this long; changes inside it are one write.
    static let interval: TimeInterval = 0.3
    /// A draft heavy with photos is sent at most this often, so typing is not a steady upload.
    private static let heavyInterval: TimeInterval = 1.5
    private static let heavyBytes = 250_000

    let kind: String
    /// Per business (BizKey): the draft in one business's Drafts is not another's. Always asked for a business:
    /// the one a piece of work was begun in, never "whichever is open when this runs".
    private func idKey(_ b: String) -> String { BizKey("erp.\(kind)Draft.remoteId", b) }
    private func createdKey(_ b: String) -> String { BizKey("erp.\(kind)Draft.remoteCreatedAt", b) }
    /// Set once a send has landed: until then "not in Drafts" says nothing about the phone's copy.
    private func landedKey(_ b: String) -> String { BizKey("erp.\(kind)Draft.remoteLanded", b) }

    /// A save on its way to /api/app/drafts. `text` is the form's values as sorted JSON: the same work is not sent twice.
    private struct Outgoing {
        let id: String
        let body: [String: Any]
        let biz: Business
        let text: String
    }

    /// The newest work not yet handed to the line: what the switch sends at once for the business being left.
    private var latest: (make: () -> Snapshot, biz: Business)?
    /// The write that is due (the newest work goes in it).
    private var waiting: Task<Void, Never>?
    private var lastStart = Date.distantPast
    /// The last draft sent, as text: the same work is not sent twice.
    private var lastSent = ""
    /// The newest save of each draft that has not started: a newer one takes the place of an older one.
    private var slots: [String: Outgoing] = [:]
    /// Saves of a draft that are on the line or waiting for it (`resume` leaves such a draft alone).
    private var busy: [String: Int] = [:]
    /// Drafts removed (saved, discarded, started over): never written again, whatever is still on its way.
    private var removed: Set<String> = []
    private var line: Task<Void, Never>?
    private var retrying: Task<Void, Never>?
    private var failures = 0

    private init(kind: String) {
        self.kind = kind
    }

    /// The person switched business: what was waiting to be sent is the old business's, and goes nowhere.
    /// A send already on its way is pinned to its own business (`Business` captured below) and lands there.
    func reset() {
        waiting?.cancel()
        waiting = nil
        latest = nil
        lastSent = ""
    }

    /// Called by `Businesses.switch` before the business changes: work waiting for its moment is sent now, to the
    /// business it was typed in. (Screens going away after the switch are pinned the same way: BusinessSwitchPin.)
    func flush(leaving left: Business) {
        guard let l = latest, l.biz.id == left.id else { return }
        waiting?.cancel()
        waiting = nil
        latest = nil
        send(l.make(), biz: left)
    }

    /// This phone's draft in Drafts, once it has been sent.
    var id: String? { UserDefaults.standard.string(forKey: idKey(House.business.id)) }

    /// What goes to Drafts: the web form's values, and the card's total and name.
    struct Snapshot {
        let values: [String: Any]
        let total: Double
        let customerName: String
    }

    /// The work as it stands, at the next moment (`interval` after the last write began; at once if none has been
    /// for a while) or `now`, as the screen or the app goes. `make` is asked for the work then, not on every key, so
    /// a burst is one write of the newest. Blank work is nothing worth keeping: the Drafts copy goes.
    /// Nothing is sent where the shop has turned drafts off (Settings, `autoDraftForms`).
    func push(blank: Bool, enabled: Bool, now: Bool = false, business: Business? = nil, _ make: @escaping () -> Snapshot) {
        // The demo's made-up books never leave the phone.
        guard enabled, !House.isDemo else {
            waiting?.cancel()
            waiting = nil
            latest = nil
            return
        }
        // A screen going away just after a switch (`now`) writes for the business it was in.
        let biz = business ?? (now ? BusinessSwitchPin.business() : House.business)
        if blank {
            waiting?.cancel()
            waiting = nil
            latest = nil
            if UserDefaults.standard.string(forKey: idKey(biz.id)) != nil { drop(biz) }
            return
        }
        latest = (make, biz)
        if now {
            waiting?.cancel()
            waiting = nil
            sendLatest()
            return
        }
        // A write is already due: it takes the newest work (a burst of keys is one write).
        guard waiting == nil else { return }
        let wait = max(0, Self.interval - Date().timeIntervalSince(lastStart))
        waiting = Task { [weak self] in
            if wait > 0 {
                do { try await Task.sleep(for: .seconds(wait)) } catch { return }
            }
            guard let self, !Task.isCancelled else { return }
            self.waiting = nil
            self.sendLatest()
        }
    }

    private func sendLatest() {
        guard let l = latest else { return }
        latest = nil
        send(l.make(), biz: l.biz)
    }

    /// The order or sale was saved, or started over: its Drafts copy goes, and the next is a new draft.
    func drop(business: Business? = nil) { drop(business ?? House.business) }

    private func drop(_ biz: Business) {
        waiting?.cancel()
        waiting = nil
        latest = nil
        lastSent = ""
        guard let gone = UserDefaults.standard.string(forKey: idKey(biz.id)) else { return }
        forget(biz.id)
        abandon(gone)
        enqueue { _ = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": gone], business: biz) }
    }

    /// A draft that is gone (discarded from Drafts, saved): nothing of it is sent or retried any more.
    func abandon(_ draftId: String) {
        removed.insert(draftId)
        slots.removeValue(forKey: draftId)
        DraftOutboxFiles.remove(draftId)
    }

    /// Lets go of the Drafts copy without touching it: it was finished or thrown away on another device, or it
    /// stays in Drafts and the next form is a new draft.
    func forget(_ business: String? = nil) {
        let b = business ?? House.business.id
        UserDefaults.standard.removeObject(forKey: idKey(b))
        UserDefaults.standard.removeObject(forKey: createdKey(b))
        UserDefaults.standard.removeObject(forKey: landedKey(b))
        lastSent = ""
    }

    /// A New order / New sale is opening blank while this phone holds work from before: that work is made sure of in
    /// Drafts (sent now, and kept on disk until it has landed, so a kill or no line loses nothing), and this phone
    /// lets go of its id, so the new form's first change is a new draft. `snapshot` is the held work as it stands (nil
    /// when only an id is left). The caller clears the phone's own copy.
    func release(business biz: Business, enabled: Bool, snapshot: (() -> Snapshot)?) {
        waiting?.cancel()
        waiting = nil
        let pending = latest
        latest = nil
        if enabled, !House.isDemo {
            // What was typed last, whichever copy is newest: the form's own pending work, else the phone's copy.
            if let pending, pending.biz.id == biz.id { send(pending.make(), biz: biz, durable: true) }
            else if let snapshot { send(snapshot(), biz: biz, durable: true) }
        }
        forget(biz.id)
    }

    /// Whether this phone's draft is still in Drafts. Nil when none has landed there, or there is no answer:
    /// the phone's copy then stands.
    func stillThere(business: Business? = nil) async -> Bool? {
        let biz = business ?? House.business
        guard let draftId = UserDefaults.standard.string(forKey: idKey(biz.id)), UserDefaults.standard.bool(forKey: landedKey(biz.id)) else { return nil }
        guard let out = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "check", "id": draftId], business: biz) else { return nil }
        return out["exists"] as? Bool
    }

    /// A draft from Drafts continued on this phone (DraftsScreen): from now on this phone's work is that draft, so the
    /// next change writes over it and saving the order or sale removes it, as the web's form does with `?draft=`.
    /// The phone's own draft before it was released first (`release`) and stays in Drafts as it was.
    func adopt(id draftId: String, createdAt: String) {
        waiting?.cancel()
        waiting = nil
        latest = nil
        lastSent = ""
        removed.remove(draftId)
        let b = House.business.id
        UserDefaults.standard.set(draftId, forKey: idKey(b))
        UserDefaults.standard.set(createdAt.isEmpty ? Date().ISO8601Format() : createdAt, forKey: createdKey(b))
        // It is in Drafts already: one finished at the counter since lets go of the phone's copy too.
        UserDefaults.standard.set(true, forKey: landedKey(b))
    }

    // MARK: Sending

    private func send(_ snap: Snapshot, biz: Business, durable: Bool = false) {
        let values = snap.values
        guard JSONSerialization.isValidJSONObject(values),
              let json = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]) else { return }
        let text = String(decoding: json, as: UTF8.self)
        // `lastSent` is the open business's; a send for the one just left leaves it alone.
        let open = biz.id == House.business.id
        if open && !durable { guard text != lastSent else { return } }
        let draftId = UserDefaults.standard.string(forKey: idKey(biz.id)) ?? Self.newId(kind)
        let created = UserDefaults.standard.string(forKey: createdKey(biz.id)) ?? Date().ISO8601Format()
        UserDefaults.standard.set(draftId, forKey: idKey(biz.id))
        UserDefaults.standard.set(created, forKey: createdKey(biz.id))
        if open { lastSent = text }
        // A heavy draft (sample photos) is not sent again straight away.
        lastStart = json.count > Self.heavyBytes ? Date().addingTimeInterval(Self.heavyInterval - Self.interval) : Date()
        let body: [String: Any] = [
            "action": "save", "id": draftId, "kind": kind, "data": values,
            "total": snap.total.isFinite ? snap.total : 0, "customerName": snap.customerName,
            "device": UIDevice.current.model, "createdAt": created,
        ]
        submit(Outgoing(id: draftId, body: body, biz: biz, text: text), durable: durable)
    }

    private func submit(_ o: Outgoing, durable: Bool) {
        slots[o.id] = o
        busy[o.id, default: 0] += 1
        if durable { DraftOutboxFiles.write(id: o.id, kind: kind, biz: o.biz.id, body: o.body) }
        enqueue { [weak self] in await self?.deliver(o.id) }
    }

    /// One save at a time on the line; a newer save of the same draft that arrived meanwhile is the one sent.
    private func deliver(_ id: String) async {
        defer {
            busy[id, default: 1] -= 1
            if busy[id] ?? 0 <= 0 { busy.removeValue(forKey: id) }
        }
        guard let o = slots.removeValue(forKey: id), !removed.contains(id) else { return }
        // Leaving the app mid-send must not cut it off: the phone lends a few seconds.
        var bg = UIBackgroundTaskIdentifier.invalid
        bg = UIApplication.shared.beginBackgroundTask(withName: "erp.draft") {
            UIApplication.shared.endBackgroundTask(bg)
            bg = .invalid
        }
        defer { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) } }
        do {
            _ = try await ERPAPI.shared.send("/api/app/drafts", o.body, business: o.biz)
            failures = 0
            if slots[id] == nil { DraftOutboxFiles.remove(id) }
            if UserDefaults.standard.string(forKey: idKey(o.biz.id)) == id { UserDefaults.standard.set(true, forKey: landedKey(o.biz.id)) }
        } catch {
            // Not sent (no line, the server busy): the phone's copy is the truth. This body is kept on disk and
            // sent again, here by the backoff and when the app comes forward, unless a newer one has taken its place.
            if o.biz.id == House.business.id, lastSent == o.text { lastSent = "" }
            if !removed.contains(id), slots[id] == nil {
                DraftOutboxFiles.write(id: id, kind: kind, biz: o.biz.id, body: o.body)
                scheduleRetry()
            }
        }
    }

    /// Tries again what could not be sent: saves kept on disk after a failure or a hand-off. Called when the app comes
    /// forward, when Drafts or a form opens, and by the backoff.
    func resume() {
        for rec in DraftOutboxFiles.all(kind: kind) where !removed.contains(rec.id) && busy[rec.id] == nil {
            guard let biz = Businesses.shared.business(rec.biz) else { continue }
            submit(Outgoing(id: rec.id, body: rec.body, biz: biz, text: ""), durable: false)
        }
    }

    static func resumeAll() {
        order.resume()
        sale.resume()
    }

    private func scheduleRetry() {
        guard retrying == nil else { return }
        failures += 1
        let wait = min(120, 5 * pow(2, Double(min(failures, 5) - 1)))
        retrying = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(wait)) } catch { return }
            self?.retrying = nil
            self?.resume()
        }
    }

    private func enqueue(_ work: @escaping () async -> Void) {
        let previous = line
        line = Task {
            await previous?.value
            await work()
        }
    }

    /// The web's `newDraftId`: "<kind>-<ms in base 36>-<five letters>".
    static func newId(_ kind: String) -> String {
        let ms = UInt64(max(0, Date().timeIntervalSince1970 * 1000))
        let letters = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        let tail = String((0..<5).map { _ in letters.randomElement()! })
        return "\(kind)-\(String(ms, radix: 36))-\(tail)"
    }
}

// MARK: - What a draft holds, as Drafts' card

extension WorkDraftSync {
    /// A New order as it stands, in the web form's shape, with its balance as the card's total.
    static func snapshot(_ d: NewOrderDraft, settings: Settings?) -> Snapshot {
        Snapshot(values: d.webValues(settings: settings), total: NewOrderMath.totals(d, settings).balance, customerName: d.customerName)
    }

    /// A New sale as it stands, in the sale page's shape, with its subtotal as the card's total.
    static func snapshot(_ d: SaleDraft, settings: Settings?, customers: [Customer]) -> Snapshot {
        let subtotal = SaleFigures(draft: d, settings: settings, customers: customers, marginSettings: House.margin).subtotal
        return Snapshot(values: d.webValues(subtotal: subtotal), total: subtotal, customerName: d.customerName)
    }
}

// MARK: - Sends that have not landed

/// Saves that did not reach Drafts (no line), and the held work of a form that was left, kept as files until they
/// land: one JSON file per draft id under Application Support/erp-drafts/outbox, written off the main thread in order.
private enum DraftOutboxFiles {
    private static let queue = DispatchQueue(label: "erp.draftOutbox", qos: .utility)

    private static var dir: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("erp-drafts", isDirectory: true)
            .appendingPathComponent("outbox", isDirectory: true)
    }

    private static func safe(_ id: String) -> String {
        String(id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }

    static func write(id: String, kind: String, biz: String, body: [String: Any]) {
        let record: [String: Any] = ["id": id, "kind": kind, "biz": biz, "body": body]
        guard JSONSerialization.isValidJSONObject(record), let data = try? JSONSerialization.data(withJSONObject: record) else { return }
        queue.async {
            guard let dir else { return }
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? data.write(to: dir.appendingPathComponent(safe(id) + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    static func remove(_ id: String) {
        queue.async {
            guard let dir else { return }
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(safe(id) + ".json"))
        }
    }

    /// The kept saves of one kind. Read after every write and remove already asked for (the same queue).
    static func all(kind: String) -> [(id: String, biz: String, body: [String: Any])] {
        queue.sync {
            guard let dir else { return [] }
            var out: [(id: String, biz: String, body: [String: Any])] = []
            for name in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where name.hasSuffix(".json") {
                guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)),
                      let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      record["kind"] as? String == kind, let id = record["id"] as? String,
                      let biz = record["biz"] as? String, let body = record["body"] as? [String: Any] else { continue }
                out.append((id, biz, body))
            }
            return out
        }
    }
}

/// Screens go away after `Businesses.switch` has already made the next business the open one, and write what
/// they hold on the way out. For a moment after a switch, "the business" for such a write is the one just left.
enum BusinessSwitchPin {
    private static let lock = NSLock()
    private static var left: (business: Business, at: Date)?

    /// Called before the open business changes.
    static func leaving(_ b: Business) {
        lock.lock(); left = (b, Date()); lock.unlock()
    }

    /// The business a draft write belongs to: the one just left inside the window, else the open one.
    static func business(within window: TimeInterval = 2) -> Business {
        lock.lock(); defer { lock.unlock() }
        if let l = left, Date().timeIntervalSince(l.at) < window { return l.business }
        return House.business
    }

    /// For a store keyed by id (BizKey).
    static func id(within window: TimeInterval = 2) -> String { business(within: window).id }
}
