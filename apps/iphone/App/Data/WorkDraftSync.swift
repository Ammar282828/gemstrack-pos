import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The phone's unfinished order and sale in the ERP's Drafts too (Firestore `drafts`; decisions.md "Drafts":
/// "every device in the shop sees the same list and a sale started on a phone is finished at the counter").
///
/// The phone keeps its own copy as it always has (NewOrderDraftStore, SaleDraftStore): that is what the screen
/// opens on, and it works with no connection. This sends the same work, in the web form's own shape
/// (NewOrderWebDraft, SaleWebDraft), to /api/app/drafts a second after the last change, as the web's forms do;
/// removes it once the order or sale is saved or started over; and asks, when the screen opens, whether it is
/// still there, since an order finished at the counter must not stay on the phone to be saved a second time.
///
/// One draft of each kind, as the phone has one of each. Its id (the web's `newDraftId` form) is kept beside
/// the phone's copy. Sends go one at a time, in order, so an older draft never lands after a newer one or after
/// the remove; one still on its way when the work is saved is taken back out (the web's `finish`).
@MainActor
final class WorkDraftSync {
    static let order = WorkDraftSync(kind: "order")
    static let sale = WorkDraftSync(kind: "sale")

    let kind: String
    /// Per business (BizKey): the draft in one business's Drafts is not another's. Always asked for a business:
    /// the one a piece of work was begun in, never "whichever is open when this runs".
    private func idKey(_ b: String) -> String { BizKey("erp.\(kind)Draft.remoteId", b) }
    private func createdKey(_ b: String) -> String { BizKey("erp.\(kind)Draft.remoteCreatedAt", b) }
    /// Set once a send has landed: until then "not in Drafts" says nothing about the phone's copy.
    private func landedKey(_ b: String) -> String { BizKey("erp.\(kind)Draft.remoteLanded", b) }
    /// A push waiting out its second: what the switch sends at once, for the business being left.
    private var pending: (make: () -> Snapshot, gen: Int, biz: Business)?
    /// The last draft sent, as text: the same work is not sent twice.
    private var lastSent = ""
    private var waiting: Task<Void, Never>?
    private var line: Task<Void, Never>?
    /// Moves on each remove: a send begun before it is taken back out.
    private var generation = 0

    private init(kind: String) {
        self.kind = kind
    }

    /// The person switched business: what was waiting to be sent is the old business's, and goes nowhere.
    /// A send already on its way is pinned to its own business (`Business` captured below) and lands there.
    func reset() {
        waiting?.cancel()
        waiting = nil
        pending = nil
        lastSent = ""
    }

    /// Called by `Businesses.switch` before the business changes: work waiting for its second is sent now, to the
    /// business it was typed in. (Screens going away after the switch are pinned the same way: BusinessSwitchPin.)
    func flush(leaving left: Business) {
        guard let p = pending, p.biz.id == left.id else { return }
        waiting?.cancel()
        waiting = nil
        pending = nil
        send(p.make(), gen: p.gen, biz: left)
    }

    /// This phone's draft in Drafts, once it has been sent.
    var id: String? { UserDefaults.standard.string(forKey: idKey(House.business.id)) }

    /// What goes to Drafts: the web form's values, and the card's total and name.
    struct Snapshot {
        let values: [String: Any]
        let total: Double
        let customerName: String
    }

    /// The work as it stands, a second after the last change (or `now`, as the screen or the app goes); `make`
    /// is asked for it then, not on every key. Blank work is nothing worth keeping: the Drafts copy goes.
    /// Nothing is sent where the shop has turned drafts off (Settings, `autoDraftForms`).
    func push(blank: Bool, enabled: Bool, now: Bool = false, business: Business? = nil, _ make: @escaping () -> Snapshot) {
        waiting?.cancel()
        // The demo's made-up books never leave the phone.
        guard enabled, !House.isDemo else { return }
        // A screen going away just after a switch (`now`) writes for the business it was in.
        let biz = business ?? (now ? BusinessSwitchPin.business() : House.business)
        if blank {
            if UserDefaults.standard.string(forKey: idKey(biz.id)) != nil { drop(biz) }
            return
        }
        let gen = generation
        if !now { pending = (make, gen, biz) } else { pending = nil }
        waiting = Task { [weak self] in
            if !now {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
            self?.pending = nil
            self?.send(make(), gen: gen, biz: biz)
        }
    }

    /// The order or sale was saved, or started over: its Drafts copy goes, and the next is a new draft.
    func drop(business: Business? = nil) { drop(business ?? House.business) }

    private func drop(_ biz: Business) {
        waiting?.cancel()
        pending = nil
        generation += 1
        lastSent = ""
        guard let gone = UserDefaults.standard.string(forKey: idKey(biz.id)) else { return }
        forget(biz.id)
        enqueue { _ = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": gone], business: biz) }
    }

    /// Lets go of the Drafts copy without touching it: it was finished or thrown away on another device.
    func forget(_ business: String? = nil) {
        let b = business ?? House.business.id
        UserDefaults.standard.removeObject(forKey: idKey(b))
        UserDefaults.standard.removeObject(forKey: createdKey(b))
        UserDefaults.standard.removeObject(forKey: landedKey(b))
        lastSent = ""
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
    /// The phone's own draft before it, if it was sent, stays in Drafts as it was.
    func adopt(id draftId: String, createdAt: String) {
        waiting?.cancel()
        lastSent = ""
        let b = House.business.id
        UserDefaults.standard.set(draftId, forKey: idKey(b))
        UserDefaults.standard.set(createdAt.isEmpty ? Date().ISO8601Format() : createdAt, forKey: createdKey(b))
        // It is in Drafts already: one finished at the counter since lets go of the phone's copy too.
        UserDefaults.standard.set(true, forKey: landedKey(b))
    }

    private func send(_ snap: Snapshot, gen: Int, biz: Business) {
        let values = snap.values
        guard gen == generation, JSONSerialization.isValidJSONObject(values),
              let json = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]) else { return }
        let text = String(decoding: json, as: UTF8.self)
        // `lastSent` is the open business's; a send for the one just left leaves it alone.
        let open = biz.id == House.business.id
        if open { guard text != lastSent else { return } }
        let draftId = UserDefaults.standard.string(forKey: idKey(biz.id)) ?? Self.newId(kind)
        let created = UserDefaults.standard.string(forKey: createdKey(biz.id)) ?? Date().ISO8601Format()
        UserDefaults.standard.set(draftId, forKey: idKey(biz.id))
        UserDefaults.standard.set(created, forKey: createdKey(biz.id))
        if open { lastSent = text }
        let body: [String: Any] = [
            "action": "save", "id": draftId, "kind": kind, "data": values,
            "total": snap.total.isFinite ? snap.total : 0, "customerName": snap.customerName,
            "device": UIDevice.current.model, "createdAt": created,
        ]
        enqueue { [weak self] in
            do {
                _ = try await ERPAPI.shared.send("/api/app/drafts", body, business: biz)
                if let self, UserDefaults.standard.string(forKey: self.idKey(biz.id)) == draftId { UserDefaults.standard.set(true, forKey: self.landedKey(biz.id)) }
            } catch {
                // Not sent: the next change, or the screen going, sends it again.
                if open, self?.lastSent == text { self?.lastSent = "" }
            }
            // Saved or started over while it was on its way: take it back out.
            if let self, self.generation != gen {
                _ = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": draftId], business: biz)
            }
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
