import Foundation

/// Bot sign-ups among the customers (src/lib/customer-spam.ts, line for line): Customers' "Clean up spam".
///
/// Bot signup spam (e.g. from a public Shopify storefront) shows up as customers with gibberish two-token
/// names, a random free-email address, and NO phone, NO address, and NO transaction history. Only rows with
/// ALL of those negatives are ever flagged, so a real customer who merely lacks a phone is safe.
///
/// The web reads the text as JavaScript does, one UTF-16 unit at a time, and its letter tests are ASCII only
/// (`'A' <= c <= 'Z'`, `/[a-z]/i`); so does this, on `utf16`, so a name outside ASCII scores as it does there.
public enum CustomerSpam {
    public struct Candidate: Equatable, Identifiable {
        public let customer: Customer
        public let reasons: [String]
        public var id: String { customer.id }

        public init(customer: Customer, reasons: [String]) {
            self.customer = customer
            self.reasons = reasons
        }
    }

    private static func isUpper(_ u: UInt16) -> Bool { u >= 65 && u <= 90 }
    private static func isLower(_ u: UInt16) -> Bool { u >= 97 && u <= 122 }
    private static func isLetter(_ u: UInt16) -> Bool { isUpper(u) || isLower(u) }
    /// `/[aeiou]/i`.
    private static func isVowel(_ u: UInt16) -> Bool {
        switch u | 0x20 { case 97, 101, 105, 111, 117: return isLetter(u); default: return false }
    }
    /// `/[bcdfghjklmnpqrstvwxyz]/i`.
    private static func isConsonant(_ u: UInt16) -> Bool { isLetter(u) && !isVowel(u) }

    /// The longest run of consonants: `/[…]{n,}/i.test` is a run of at least n.
    private static func longestConsonantRun(_ units: [UInt16]) -> Int {
        var best = 0, run = 0
        for u in units {
            run = isConsonant(u) ? run + 1 : 0
            best = max(best, run)
        }
        return best
    }

    public static func tokenGibberishScore(_ tok: String) -> Int {
        let t = Array(tok.utf16)
        if t.count < 2 { return 0 }
        var score = 0
        // Internal capitals (an uppercase letter right after a lowercase one): real names are Title Case;
        // "ABajEyYE" style camel-noise is a strong signal.
        var internalCaps = 0
        for i in 1..<t.count where isUpper(t[i]) && isLower(t[i - 1]) { internalCaps += 1 }
        score += internalCaps
        // Frequent case flips (UPPER<->lower) across the token.
        var transitions = 0
        for i in 1..<t.count where isUpper(t[i - 1]) != isUpper(t[i]) { transitions += 1 }
        if transitions >= 4 { score += 2 }
        // Long consonant runs.
        if longestConsonantRun(t) >= 4 { score += 2 }
        // Very low vowel ratio on a reasonably long token.
        let vowels = t.filter(isVowel).count
        let letters = t.filter(isLetter).count
        if letters >= 5 && Double(vowels) / Double(letters) < 0.2 { score += 2 }
        return score
    }

    public static func isGibberishName(_ name: String) -> Bool {
        let tokens = JS.trim(name).unicodeScalars
            .split(whereSeparator: { JS.whitespace.contains($0) })
            .map { String(String.UnicodeScalarView($0)) }
            .filter { !$0.isEmpty }
        if tokens.isEmpty { return false }
        let total = tokens.reduce(0) { $0 + tokenGibberishScore($1) }
        return total >= 3
    }

    public static func isRandomEmailLocal(_ email: String?) -> Bool {
        guard let email, !email.isEmpty else { return false }
        let local = Array((email.components(separatedBy: "@").first ?? "").utf16)
            .filter { $0 != 46 && $0 != 95 && $0 != 45 } // . _ -
        if local.count < 12 { return false }
        if longestConsonantRun(local) >= 5 { return true }
        let vowels = local.filter(isVowel).count
        let found = local.filter(isLetter).count
        let letters = found == 0 ? 1 : found
        return Double(vowels) / Double(letters) < 0.28
    }

    /// The customers with any order, invoice or hisaab row: never flagged (the old khata's customers have a
    /// name and a ledger, no phone and no sale here).
    public static func transactedIds(orders: [Order], invoices: [Invoice], hisaab: [HisaabEntry]) -> Set<String> {
        transactedIds(
            orderCustomerIds: orders.map(\.customerId),
            invoiceCustomerIds: invoices.map(\.customerId),
            hisaabCustomerIds: hisaab.filter { $0.entityType == .customer }.map(\.entityId)
        )
    }

    /// The same, from the ids alone.
    public static func transactedIds(orderCustomerIds: [String?], invoiceCustomerIds: [String?], hisaabCustomerIds: [String]) -> Set<String> {
        var ids = Set<String>()
        for id in orderCustomerIds { if let id, !id.isEmpty { ids.insert(id) } }
        for id in invoiceCustomerIds { if let id, !id.isEmpty { ids.insert(id) } }
        for id in hisaabCustomerIds where !id.isEmpty { ids.insert(id) }
        return ids
    }

    public static func detect(_ customers: [Customer], transacted: Set<String>) -> [Candidate] {
        var out: [Candidate] = []
        for c in customers {
            let hasPhone = !JS.trim(c.phone ?? "").isEmpty
            let hasAddress = !JS.trim(c.address ?? "").isEmpty
            let hasHistory = transacted.contains(c.id)
            if hasPhone || hasAddress || hasHistory { continue }
            var reasons: [String] = []
            if isGibberishName(c.name) { reasons.append("Gibberish name") }
            if isRandomEmailLocal(c.email) { reasons.append("Random email") }
            if reasons.isEmpty { continue }
            reasons.append("No phone / address / orders")
            out.append(Candidate(customer: c, reasons: reasons))
        }
        return out
    }
}
