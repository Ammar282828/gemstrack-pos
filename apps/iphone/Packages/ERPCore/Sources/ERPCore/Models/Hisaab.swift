import Foundation

/// One row of a customer's or karigar's ledger: Firestore `hisaab/<id>` (src/lib/store.ts
/// `HisaabEntry`). The rows of one `entityId` are that person's hisaab; the balance is never
/// stored, it is debit less credit over the rows (lib/owed.ts, lib/karigar-position.ts).
/// Surprising: the words are the shop's. `cashDebit` is what the person owes us (raised when we
/// give goods or services on credit, e.g. an invoice); `cashCredit` what we owe them (raised by
/// their payment or goods). Gold is kept in grams alongside: `goldDebitGrams` we gave them,
/// `goldCreditGrams` they gave us. A row with `linkedInvoiceId` is the auto-managed outstanding
/// balance of that invoice: it is that invoice's `balanceDue` again, so the hand-written
/// balance leaves it out (`ledgerBalances`).
public struct HisaabEntry: Decodable, Identifiable, Hashable {
    public let id: String
    /// Customer or karigar id.
    public let entityId: String
    public let entityType: HisaabEntityType
    public let entityName: String
    /// ISO instant.
    public let date: String
    public let description: String
    public let cashDebit: Double
    public let cashCredit: Double
    public let goldDebitGrams: Double
    public let goldCreditGrams: Double
    public let linkedInvoiceId: String?

    private enum K: String, CodingKey {
        case id, entityId, entityType, entityName, date, description
        case cashDebit, cashCredit, goldDebitGrams, goldCreditGrams, linkedInvoiceId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        entityId = c.string(.entityId, default: "")
        entityType = c.word(.entityType, default: .unknown(""))
        entityName = c.string(.entityName, default: "")
        date = c.string(.date, default: "")
        description = c.string(.description, default: "")
        cashDebit = c.double(.cashDebit, default: 0)
        cashCredit = c.double(.cashCredit, default: 0)
        goldDebitGrams = c.double(.goldDebitGrams, default: 0)
        goldCreditGrams = c.double(.goldCreditGrams, default: 0)
        linkedInvoiceId = c.string(.linkedInvoiceId)
    }
}
