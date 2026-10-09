import Foundation
import ERPCore

// Which customers look like one person written twice, and what merging one into another moves. No SwiftUI
// in here. The pairing is src/lib/customer-duplicates.ts line for line (the Customers page's "Merge
// duplicates" list), with its vitest cases to be mirrored; the counts are what store.ts mergeCustomers
// rewrites (src/lib/writes/customer-admin.ts), counted from the books on the phone so the sheet can say them
// before it asks for the delete code.

enum CustomerDuplicates {
    /// What is looked at, as plain text: easy to hand to another thread, and nothing else about a customer matters.
    struct Candidate {
        let id: String
        let name: String
        let phone: String
    }

    /// Two customers who look alike: their ids, why, and how sure (best first).
    struct Found: Identifiable, Equatable {
        let a: String
        let b: String
        let reason: String
        let score: Double
        /// The pair either way round, as the page keys it.
        var id: String { [a, b].sorted().joined(separator: "|") }
    }

    /// The least alike two names may be to be offered.
    static let nameMatchFloor = 0.85

    /// `name.toLowerCase().replace(/\s+/g, ' ').trim()`.
    static func normalizeName(_ name: String?) -> String {
        (name ?? "").lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Digits only, leading zeros dropped (`phone.replace(/\D/g, '').replace(/^0+/, '')`).
    static func normalizePhone(_ phone: String?) -> String {
        let digits = (phone ?? "").filter { $0 >= "0" && $0 <= "9" }
        return String(digits.drop(while: { $0 == "0" }))
    }

    /// 1 for the same name, 0.9 for one inside the other, else the share of words they have in common. A blank
    /// name is like nothing (the page read it as inside every name).
    static func nameSimilarity(_ a: String?, _ b: String?) -> Double {
        let na = normalizeName(a)
        let nb = normalizeName(b)
        return similarity(na, words(na), nb, words(nb))
    }

    private static func words(_ normalized: String) -> Set<String> {
        Set(normalized.split(separator: " ").map(String.init))
    }

    private static func similarity(_ na: String, _ wa: Set<String>, _ nb: String, _ wb: Set<String>) -> Double {
        if na.isEmpty || nb.isEmpty { return 0 }
        if na == nb { return 1 }
        if na.contains(nb) || nb.contains(na) { return 0.9 }
        let shared = wa.filter { wb.contains($0) }.count
        return Double(shared) / Double(max(wa.count, wb.count))
    }

    /// The page's `detectDuplicates`: a pair when they share a number, or their names are 85% alike. Best
    /// first; equals keep the book's order. Ids in a shelf are one each, so a pair is met once.
    static func detect(_ people: [Candidate]) -> [Found] {
        struct Row {
            let id: String
            let name: String
            let words: Set<String>
            let hasPhone: Bool
            let phone: String
        }
        let rows: [Row] = people.map { p in
            let n = normalizeName(p.name)
            return Row(id: p.id, name: n, words: words(n), hasPhone: !p.phone.isEmpty, phone: normalizePhone(p.phone))
        }
        var found: [Found] = []
        for i in 0..<rows.count {
            let a = rows[i]
            for j in (i + 1)..<max(rows.count, i + 1) {
                let b = rows[j]
                if a.hasPhone && b.hasPhone && !a.phone.isEmpty && a.phone == b.phone {
                    found.append(Found(a: a.id, b: b.id, reason: "Same phone number", score: 1))
                    continue
                }
                let sim = similarity(a.name, a.words, b.name, b.words)
                if sim >= nameMatchFloor {
                    found.append(Found(a: a.id, b: b.id, reason: "Similar name (\(Int((sim * 100).rounded()))% match)", score: sim))
                }
            }
        }
        // JavaScript's sort is stable and Swift's is not promised to be.
        return found.enumerated().sorted { l, r in
            l.element.score != r.element.score ? l.element.score > r.element.score : l.offset < r.offset
        }.map { $0.element }
    }
}

// MARK: What a merge moves

/// What follows the duplicate when it is merged away: its invoices, orders and repair tickets, its own hisaab
/// rows, and the things given to it (lib/writes/customer-admin.ts mergeCustomers).
struct CustomerMergeCounts: Equatable {
    var invoices = 0
    var orders = 0
    var hisaab = 0
    var given = 0
    var repairs = 0

    var total: Int { invoices + orders + hisaab + given + repairs }

    /// "3 invoices, 1 order, 2 hisaab rows and 1 given item", only the kinds there are; "nothing" for none.
    var sentence: String {
        var parts: [String] = []
        if invoices > 0 { parts.append("\(invoices) invoice\(invoices == 1 ? "" : "s")") }
        if orders > 0 { parts.append("\(orders) order\(orders == 1 ? "" : "s")") }
        if repairs > 0 { parts.append("\(repairs) repair\(repairs == 1 ? "" : "s")") }
        if hisaab > 0 { parts.append("\(hisaab) hisaab row\(hisaab == 1 ? "" : "s")") }
        if given > 0 { parts.append("\(given) given item\(given == 1 ? "" : "s")") }
        switch parts.count {
        case 0: return "nothing"
        case 1: return parts[0]
        default: return parts.dropLast().joined(separator: ", ") + " and " + (parts.last ?? "")
        }
    }
}

/// The books counted once by customer, so a list of pairs does not search them for each.
struct CustomerMergeBook {
    private var invoices: [String: Int] = [:]
    private var orders: [String: Int] = [:]
    private var hisaab: [String: Int] = [:]
    private var given: [String: Int] = [:]
    private var repairs: [String: Int] = [:]

    init(invoices: [Invoice], orders: [Order], hisaab: [HisaabEntry], given: [GivenItem], repairs: [Repair]) {
        for i in invoices { if let id = i.customerId, !id.isEmpty { self.invoices[id, default: 0] += 1 } }
        for o in orders { if let id = o.customerId, !id.isEmpty { self.orders[id, default: 0] += 1 } }
        for h in hisaab { if case .customer = h.entityType { self.hisaab[h.entityId, default: 0] += 1 } }
        for g in given { if let id = g.recipientId, !id.isEmpty { self.given[id, default: 0] += 1 } }
        for r in repairs { if let id = r.customerId, !id.isEmpty { self.repairs[id, default: 0] += 1 } }
    }

    func counts(_ id: String) -> CustomerMergeCounts {
        CustomerMergeCounts(invoices: invoices[id] ?? 0, orders: orders[id] ?? 0, hisaab: hisaab[id] ?? 0, given: given[id] ?? 0, repairs: repairs[id] ?? 0)
    }
}
