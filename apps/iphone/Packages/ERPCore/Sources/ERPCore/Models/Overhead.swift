import Foundation

/// One line of the overhead sheet (src/lib/overheads.ts `OverheadItem`): what the shop has to cover
/// each month before anything is profit. Kept in `app_settings/global.overheadPlans`, never in Expenses.
/// Surprising: the id is stable across edits ("rent", "item-3"), so a line can change without being replaced.
public struct OverheadItem: Decodable, Identifiable, Hashable {
    public var id: String
    public var label: String
    /// PKR per month.
    public var amount: Double

    public init(id: String, label: String, amount: Double) {
        self.id = id
        self.label = label
        self.amount = amount
    }

    private enum K: String, CodingKey { case id, label, amount }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id, default: "")
        label = c.string(.label, default: "")
        // `Number(i.amount) || 0`: anything that is not a figure counts as nothing.
        amount = c.double(.amount, default: 0)
    }
}

/// A version of the sheet, in force from `from` ("YYYY-MM") until the next one starts (`OverheadPlan`).
/// Versioned because the sheet is also a record: a raise in November must not rewrite September's target.
public struct OverheadPlan: Decodable, Hashable {
    public let from: String
    public let items: [OverheadItem]

    public init(from: String, items: [OverheadItem]) {
        self.from = from
        self.items = items
    }

    private enum K: String, CodingKey { case from, items }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        from = c.string(.from, default: "")
        items = c.list(.items)
    }
}

/// What /api/app/overheads answers: the plans resolved as the page resolves them (saved, else the
/// first-shape list, else the ERP's starting sheet, which only the ERP keeps), and the month the
/// benchmark starts. `saved` is false while the shop has never saved a sheet of its own.
public struct OverheadPlansAnswer: Decodable, Hashable {
    public let start: String
    public let plans: [OverheadPlan]
    public let saved: Bool

    private enum K: String, CodingKey { case start, plans, saved }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        start = c.string(.start, default: Overheads.benchmarkStart)
        plans = c.list(.plans)
        saved = c.bool(.saved, default: false)
    }
}
