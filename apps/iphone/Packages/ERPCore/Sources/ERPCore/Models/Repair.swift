import Foundation

/// A repair ticket: Firestore `repairs/<REP-000001>` (src/lib/store.ts `Repair`): one customer,
/// one visit, any number of pieces. Not an order (nothing is made or sold) and not a given item
/// (the pieces are the customer's).
/// Surprising: nothing is stored for the total, the paid sum or the balance: they are
/// computed from `pieces` and `payments` (`repairTotal`, `repairPaid`, `repairBalance`). Each
/// payment is also written to `additional_revenue` in the same transaction (its `revenueId`),
/// so Extra revenue counts repairs without knowing they exist. `promisedDate` is a plain
/// "yyyy-MM-dd". Status words: received (shown "In the shop"), ready, collected, cancelled.
public struct Repair: Decodable, Identifiable, Hashable {
    public let id: String
    public let customerId: String?
    public let customerName: String
    public let customerContact: String?
    public let pieces: [RepairPiece]
    public let payments: [RepairPayment]
    public let status: RepairStatus
    /// ISO instant.
    public let receivedAt: String
    public let promisedDate: String?
    public let readyAt: String?
    public let collectedAt: String?
    public let karigarId: String?
    public let karigarName: String?
    public let takenBy: String?
    /// For the shop only; never printed, never sent.
    public let internalNote: String?

    private enum K: String, CodingKey {
        case id, customerId, customerName, customerContact, pieces, payments, status, receivedAt
        case promisedDate, readyAt, collectedAt, karigarId, karigarName, takenBy, internalNote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        customerId = c.string(.customerId)
        customerName = c.string(.customerName, default: "")
        customerContact = c.string(.customerContact)
        pieces = c.list(.pieces)
        payments = c.list(.payments)
        status = c.word(.status, default: .unknown(""))
        receivedAt = c.string(.receivedAt, default: "")
        promisedDate = c.string(.promisedDate)
        readyAt = c.string(.readyAt)
        collectedAt = c.string(.collectedAt)
        karigarId = c.string(.karigarId)
        karigarName = c.string(.karigarName)
        takenBy = c.string(.takenBy)
        internalNote = c.string(.internalNote)
    }
}

/// One piece on a repair ticket (`RepairPiece`), nested in `Repair.pieces`.
public struct RepairPiece: Decodable, Hashable {
    /// "Gold ring".
    public let item: String
    /// "resize to 14".
    public let work: String
    /// Weighed at the counter.
    public let weightG: Double?
    /// What this piece's repair costs.
    public let price: Double?

    private enum K: String, CodingKey { case item, work, weightG, price }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        item = c.string(.item, default: "")
        work = c.string(.work, default: "")
        weightG = c.double(.weightG)
        price = c.double(.price)
    }
}

/// Money taken on a repair ticket (`RepairPayment`), nested in `Repair.payments`: an advance, or
/// the balance on collection. Its note field is `note`, not the invoice payments' `notes`.
public struct RepairPayment: Decodable, Hashable {
    public let amount: Double
    /// ISO instant.
    public let date: String
    public let method: PaymentType?
    /// The `additional_revenue` row this payment wrote.
    public let revenueId: String?
    public let note: String?

    private enum K: String, CodingKey { case amount, date, method, revenueId, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        amount = c.double(.amount, default: 0)
        date = c.string(.date, default: "")
        method = c.word(.method)
        revenueId = c.string(.revenueId)
        note = c.string(.note)
    }
}
