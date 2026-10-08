import Foundation

/// A shop expense: Firestore `expenses/<id>` (src/lib/store.ts `Expense`).
/// Surprising: `category` is free text. Each house has its own list (a variable,
/// lib/expense-categories.ts), and the form accepts a typed one, so an expense can carry a name
/// that is on no list. `paidBy` is absent on older rows and then means the business; a partner
/// (`ammar`, `mina`) who fronted the cash also has a matching row in that partner's ledger
/// collection (`ledgerEntryId`). 'Partner Drawings' and 'Partner Salary' are read by name
/// (lib/partnership.ts).
public struct Expense: Decodable, Identifiable, Hashable {
    public let id: String
    /// ISO instant.
    public let date: String
    public let category: String
    public let description: String
    public let amount: Double
    /// Links this expense to a karigar payment.
    public let karigarId: String?
    /// Links this expense to a karigar hisaab batch.
    public let batchId: String?
    /// Who fronted the cash; `.business` when the row has none.
    public let paidBy: PaidBy
    /// Set on partner salary rows: which partner it paid.
    public let shareholderId: String?
    /// The entry on `{paidBy}_ledger` created for a non-business `paidBy`.
    public let ledgerEntryId: String?

    private enum K: String, CodingKey {
        case id, date, category, description, amount, karigarId, batchId, paidBy, shareholderId, ledgerEntryId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        date = c.string(.date, default: "")
        category = c.string(.category, default: "")
        description = c.string(.description, default: "")
        amount = c.double(.amount, default: 0)
        karigarId = c.string(.karigarId)
        batchId = c.string(.batchId)
        paidBy = c.word(.paidBy, default: .business)
        shareholderId = c.string(.shareholderId)
        ledgerEntryId = c.string(.ledgerEntryId)
    }
}

/// Money in that is not a sale: Firestore `additional_revenue/<id>` ("Extra revenue" in the ERP;
/// src/lib/store.ts `AdditionalRevenue`).
/// Surprising: repairs write their payments here (`repairId`), and so do website deliveries
/// (`WebsiteOrderMeta.deliveryRevenueId`), so the dashboard and Analytics count them without
/// knowing those exist.
public struct AdditionalRevenue: Decodable, Identifiable, Hashable {
    public let id: String
    /// ISO instant.
    public let date: String
    public let description: String
    public let amount: Double
    /// Set when the money was taken for a repair (`Repair.payments`).
    public let repairId: String?

    private enum K: String, CodingKey { case id, date, description, amount, repairId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        date = c.string(.date, default: "")
        description = c.string(.description, default: "")
        amount = c.double(.amount, default: 0)
        repairId = c.string(.repairId)
    }
}
