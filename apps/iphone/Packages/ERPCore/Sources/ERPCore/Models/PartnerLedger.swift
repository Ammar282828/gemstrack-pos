import Foundation

/// How a ledger entry counts (lib/partnership.ts `LedgerCategory`): a stake in the business, or a loan
/// it repays first. Entries logged before the loan/equity split read as equity.
public enum PartnerLedgerCategory: String, Hashable {
    case equity, loan
}

/// Money in from the partner, or out to them (`LedgerType`).
public enum PartnerLedgerType: String, Hashable {
    case payment, withdrawal
}

/// One row of a partner's own book: Firestore `mina_ledger/<id>` or `ammar_ledger/<id>`, read as
/// lib/shareholders.ts `loadLedger` reads it. Surprising: `date` is a Firestore Timestamp there
/// (the app's Firestore hook turns it into ISO text), and the web's read is ordered by it, so a row
/// with no date is not on its page (`ShareholderFigures.shown` leaves it out here too). A withdrawal
/// carries the id of the "Partner Drawings" expense written beside it; "pending" is no link; an
/// expense a partner paid for shows here as a loan ("Expense paid: …"), linked to that expense.
public struct ShareholderLedgerRow: Decodable, Identifiable, Hashable {
    public let id: String
    public let description: String
    public let amount: Double
    /// ISO instant; "" when the document has none.
    public let date: String
    public let category: PartnerLedgerCategory
    public let type: PartnerLedgerType
    public let linkedExpenseId: String?

    public init(id: String, description: String, amount: Double, date: String, category: PartnerLedgerCategory,
                type: PartnerLedgerType, linkedExpenseId: String? = nil) {
        self.id = id
        self.description = description
        self.amount = amount
        self.date = date
        self.category = category
        self.type = type
        self.linkedExpenseId = linkedExpenseId
    }

    private enum K: String, CodingKey { case id, description, amount, date, category, type, linkedExpenseId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        description = c.string(.description, default: "")
        amount = c.double(.amount, default: 0)
        date = c.string(.date, default: "")
        category = c.string(.category) == "loan" ? .loan : .equity
        type = c.string(.type) == "withdrawal" ? .withdrawal : .payment
        let link = c.string(.linkedExpenseId) ?? ""
        linkedExpenseId = link.isEmpty || link == "pending" ? nil : link
    }
}

/// One change of the working-capital floor (lib/partnership-settings.ts `FloorHistoryEntry`).
public struct FloorHistoryEntry: Decodable, Hashable {
    public let value: Double
    /// ISO instant of when it was set.
    public let date: String
    /// Who set it; the Shareholders page names itself ("Shareholders").
    public let by: String?

    private enum K: String, CodingKey { case value, date, by }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        value = c.double(.value, default: 0)
        date = c.string(.date, default: "")
        by = c.string(.by)
    }
}

/// `app_settings/partnership` as `loadPartnershipSettings` reads it: the cash the business keeps before
/// anything is distributed, and its history. A missing or zero floor is the default, five lac.
public struct PartnershipSettings: Decodable, Hashable {
    public let workingCapitalFloor: Double
    /// ISO: the latest entry in `floorHistory`.
    public let floorLastSetAt: String?
    public let floorHistory: [FloorHistoryEntry]

    public init(workingCapitalFloor: Double, floorLastSetAt: String?, floorHistory: [FloorHistoryEntry]) {
        self.workingCapitalFloor = workingCapitalFloor
        self.floorLastSetAt = floorLastSetAt
        self.floorHistory = floorHistory
    }

    /// No document yet.
    public static let none = PartnershipSettings(workingCapitalFloor: Partnership.defaultWorkingCapitalFloor, floorLastSetAt: nil, floorHistory: [])

    private enum K: String, CodingKey { case workingCapitalFloor, floorLastSetAt, floorHistory }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let floor = c.double(.workingCapitalFloor) ?? 0
        // `Number(data.workingCapitalFloor) || DEFAULT_WORKING_CAPITAL_FLOOR`
        workingCapitalFloor = floor != 0 ? floor : Partnership.defaultWorkingCapitalFloor
        let last = c.string(.floorLastSetAt) ?? ""
        floorLastSetAt = last.isEmpty ? nil : last
        floorHistory = c.list(.floorHistory)
    }
}
