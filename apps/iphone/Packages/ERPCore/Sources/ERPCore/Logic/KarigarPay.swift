// Ported from src/lib/karigar-pay.ts (tests: KarigarPayTests, its cases): a karigar's pay as his page shows it.
// What he has been paid in all, the pay batch open now and what is in it, the settled batches, the payments
// outside any batch, and the silver he has brought in. The server settles a batch at `batchTotal` worked out
// the same way, so the total the owner is shown before settling is the one written.

import Foundation

public enum KarigarPay {
    /// One batch and the payments filed under it, newest first.
    public struct InBatch: Identifiable {
        public let batch: KarigarBatch
        public let payments: [Expense]
        public let total: Double
        public var id: String { batch.id }
    }

    public struct Figures {
        /// Every payment to him, in the batches and outside them.
        public let totalPaid: Double
        /// The newest open batch, which a payment from his page is filed under.
        public let open: InBatch?
        /// The closed ones, newest start first; each totalled from its payments as they are now.
        public let settled: [InBatch]
        /// Paid outside any batch, newest first.
        public let direct: [Expense]
        public let directTotal: Double
    }

    public struct Silver {
        /// His entries, newest first.
        public let rows: [KarigarSilverTransaction]
        public let grams: Double
        public let surcharge: Double
    }

    /// A date as a number to sort by (`Date.parse`); one that cannot be read sorts as the oldest.
    static func time(_ iso: String?) -> Double {
        ERPDate.parse(iso)?.timeIntervalSince1970 ?? 0
    }

    /// Newest first; equal dates keep the order they came in, as the TypeScript's stable sort keeps them.
    static func newestFirst<T>(_ rows: [T], _ date: (T) -> String) -> [T] {
        rows.enumerated()
            .map { (i: $0.offset, row: $0.element, t: time(date($0.element))) }
            .sorted { a, b in a.t != b.t ? a.t > b.t : a.i < b.i }
            .map { $0.row }
    }

    static func total(_ rows: [Expense]) -> Double { rows.reduce(0) { $0 + $1.amount } }

    /// A batch with no closing date is the one open now (a blank one too, as `!b.closedDate` reads it).
    public static func isOpen(_ b: KarigarBatch) -> Bool { (b.closedDate ?? "").isEmpty }

    /// Filed under no batch: no batch id, or a blank one.
    static func isDirect(_ e: Expense) -> Bool { (e.batchId ?? "").isEmpty }

    /// The payments filed under a batch, newest first: his expenses that carry its id.
    public static func batchPayments(_ batch: KarigarBatch, expenses: [Expense]) -> [Expense] {
        newestFirst(expenses.filter { $0.karigarId == batch.karigarId && $0.batchId == batch.id }) { $0.date }
    }

    /// What a batch comes to: what settling it writes as its total paid.
    public static func batchTotal(_ batch: KarigarBatch, expenses: [Expense]) -> Double {
        total(batchPayments(batch, expenses: expenses))
    }

    public static func figures(karigarId: String, expenses: [Expense], batches: [KarigarBatch]) -> Figures {
        let payments = expenses.filter { $0.karigarId == karigarId }
        let mine = batches.filter { $0.karigarId == karigarId }
        // Newest start first; equal starts keep the order they came in.
        let ordered = mine.enumerated()
            .map { (i: $0.offset, b: $0.element, t: time($0.element.startDate)) }
            .sorted { a, b in a.t != b.t ? a.t > b.t : a.i < b.i }
            .map { $0.b }
        func filed(_ b: KarigarBatch) -> InBatch {
            let rows = batchPayments(b, expenses: payments)
            return InBatch(batch: b, payments: rows, total: total(rows))
        }
        // A payment whose batch is gone (a deleted batch used to leave its id behind) is listed as direct.
        let known = Set(mine.map(\.id))
        let direct = newestFirst(payments.filter { isDirect($0) || !known.contains($0.batchId ?? "") }) { $0.date }
        return Figures(
            totalPaid: total(payments),
            open: ordered.first(where: isOpen).map(filed),
            settled: ordered.filter { !isOpen($0) }.map(filed),
            direct: direct,
            directTotal: total(direct)
        )
    }

    /// The silver form's surcharge: the grams received at the rate per gram, as the entry stores it.
    public static func silverSurcharge(grams: Double, perGram: Double) -> Double { grams * perGram }

    /// The silver form's rules: grams above nothing, a surcharge of nothing or more. Nil when it may be saved.
    public static func silverProblem(grams: Double, perGram: Double) -> String? {
        if !grams.isFinite || grams <= 0 { return "Silver grams must be greater than 0" }
        if !perGram.isFinite || perGram < 0 { return "Surcharge must be non-negative" }
        return nil
    }

    /// His silver: the entries newest first, the grams received and the surcharge on them, in all.
    public static func silver(karigarId: String, rows: [KarigarSilverTransaction]) -> Silver {
        let mine = newestFirst(rows.filter { $0.karigarId == karigarId }) { $0.date }
        return Silver(
            rows: mine,
            grams: mine.reduce(0) { $0 + $1.silverGrams },
            surcharge: mine.reduce(0) { $0 + $1.totalSurcharge }
        )
    }
}
