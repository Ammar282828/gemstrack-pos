import Foundation
import UIKit

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
    private let idKey: String
    private let createdKey: String
    /// Set once a send has landed: until then "not in Drafts" says nothing about the phone's copy.
    private let landedKey: String
    /// The last draft sent, as text: the same work is not sent twice.
    private var lastSent = ""
    private var waiting: Task<Void, Never>?
    private var line: Task<Void, Never>?
    /// Moves on each remove: a send begun before it is taken back out.
    private var generation = 0

    private init(kind: String) {
        self.kind = kind
        idKey = "erp.\(kind)Draft.remoteId"
        createdKey = "erp.\(kind)Draft.remoteCreatedAt"
        landedKey = "erp.\(kind)Draft.remoteLanded"
    }

    /// This phone's draft in Drafts, once it has been sent.
    var id: String? { UserDefaults.standard.string(forKey: idKey) }

    /// What goes to Drafts: the web form's values, and the card's total and name.
    struct Snapshot {
        let values: [String: Any]
        let total: Double
        let customerName: String
    }

    /// The work as it stands, a second after the last change (or `now`, as the screen or the app goes); `make`
    /// is asked for it then, not on every key. Blank work is nothing worth keeping: the Drafts copy goes.
    /// Nothing is sent where the shop has turned drafts off (Settings, `autoDraftForms`).
    func push(blank: Bool, enabled: Bool, now: Bool = false, _ make: @escaping () -> Snapshot) {
        waiting?.cancel()
        // The demo's made-up books never leave the phone.
        guard enabled, !House.isDemo else { return }
        if blank {
            if id != nil { drop() }
            return
        }
        let gen = generation
        waiting = Task { [weak self] in
            if !now {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
            self?.send(make(), gen: gen)
        }
    }

    /// The order or sale was saved, or started over: its Drafts copy goes, and the next is a new draft.
    func drop() {
        waiting?.cancel()
        generation += 1
        lastSent = ""
        guard let gone = id else { return }
        forget()
        enqueue { _ = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": gone]) }
    }

    /// Lets go of the Drafts copy without touching it: it was finished or thrown away on another device.
    func forget() {
        UserDefaults.standard.removeObject(forKey: idKey)
        UserDefaults.standard.removeObject(forKey: createdKey)
        UserDefaults.standard.removeObject(forKey: landedKey)
        lastSent = ""
    }

    /// Whether this phone's draft is still in Drafts. Nil when none has landed there, or there is no answer:
    /// the phone's copy then stands.
    func stillThere() async -> Bool? {
        guard let draftId = id, UserDefaults.standard.bool(forKey: landedKey) else { return nil }
        guard let out = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "check", "id": draftId]) else { return nil }
        return out["exists"] as? Bool
    }

    private func send(_ snap: Snapshot, gen: Int) {
        let values = snap.values
        guard gen == generation, JSONSerialization.isValidJSONObject(values),
              let json = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]) else { return }
        let text = String(decoding: json, as: UTF8.self)
        guard text != lastSent else { return }
        let draftId = id ?? Self.newId(kind)
        let created = UserDefaults.standard.string(forKey: createdKey) ?? Date().ISO8601Format()
        UserDefaults.standard.set(draftId, forKey: idKey)
        UserDefaults.standard.set(created, forKey: createdKey)
        lastSent = text
        let body: [String: Any] = [
            "action": "save", "id": draftId, "kind": kind, "data": values,
            "total": snap.total.isFinite ? snap.total : 0, "customerName": snap.customerName,
            "device": UIDevice.current.model, "createdAt": created,
        ]
        enqueue { [weak self] in
            do {
                _ = try await ERPAPI.shared.send("/api/app/drafts", body)
                if let self, self.id == draftId { UserDefaults.standard.set(true, forKey: self.landedKey) }
            } catch {
                // Not sent: the next change, or the screen going, sends it again.
                if self?.lastSent == text { self?.lastSent = "" }
            }
            // Saved or started over while it was on its way: take it back out.
            if let self, self.generation != gen {
                _ = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": draftId])
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
