import Foundation
import ERPCore

// What the edit sheets on Expenses and Extra revenue work out for themselves, with no SwiftUI in it (it
// compiles on Linux with ERPCore): the figures put back in a box, the day sent again, and the words a
// delete says first. The writes are the ERP's (updateExpense, deleteExpense and the extra revenue ops,
// lib/writes/expense-admin.ts).

enum ExpenseEditing {
    /// An amount as the form's box shows it: whole rupees bare ("12000"), else up to two decimals.
    static func typed(_ amount: Double) -> String {
        if amount <= 0 { return "" }
        var s = String(format: "%.2f", amount)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// The day to send: the row's own text when the day picked is the day it had, so a partner's loan row
    /// is not drawn again for nothing; otherwise the moment picked, as the form's `date.toISOString()`.
    static func dateText(picked: Date, original: String, calendar: Calendar = .current) -> String {
        if let had = ERPDate.parse(original), calendar.isDate(picked, inSameDayAs: had) { return original }
        return ERPDate.iso(picked)
    }

    /// The payer as the ERP names it ("business", "ammar", "mina"); nil for a word it does not know.
    static func payerWord(_ who: PaidBy) -> String? {
        switch who {
        case .business: return "business"
        case .ammar: return "ammar"
        case .mina: return "mina"
        case .unknown: return nil
        }
    }

    /// A partner's drawing, in a house that keeps partner ledgers: the Shareholders page's to change, with
    /// its withdrawal (the ERP refuses it here).
    static func isDrawing(_ e: Expense, partnership: Bool) -> Bool {
        partnership && e.category == MoneyPartners.drawingsCategory
    }

    /// The store's own words for the delete (`Delete expense "…"`), said in the code sheet and the ERP's log.
    static func deleteWhat(_ e: Expense) -> String {
        "Delete expense \"\(e.description.isEmpty ? e.id : e.description)\""
    }

    /// The web's confirmation ("Electricity bill — PKR 12,000.") and what goes with the row: a partner's
    /// loan on their ledger.
    static func deleteDetail(_ e: Expense) -> String {
        let what = e.description.isEmpty ? e.category : e.description
        var text = "\(what) \u{2014} \(Money.pkr(e.amount))."
        if let partner = fronted(e) {
            text += " The loan on \(partner)'s ledger, for the cash \(partner) put in, is deleted with it."
        }
        return text
    }

    /// The partner who fronted the cash, when their ledger has a loan row for it.
    static func fronted(_ e: Expense) -> String? {
        guard let entry = e.ledgerEntryId, !entry.isEmpty else { return nil }
        switch e.paidBy {
        case .ammar: return "Ammar"
        case .mina: return "Mina"
        default: return nil
        }
    }
}
