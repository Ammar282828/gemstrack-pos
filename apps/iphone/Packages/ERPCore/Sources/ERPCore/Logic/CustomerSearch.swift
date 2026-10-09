import Foundation

/// The book offered as a name is typed, on New sale and New order: who the counter most likely means,
/// first. The web's box (customer-autocomplete.tsx) keeps any name containing the letters, in book order;
/// the phone ranks them, and finds a customer by number too, since the counter often has only the number.
///
/// Best first: the whole name; a name that begins with what is typed; one with a word that does ("dem" finds
/// "Sana Demo"); every typed word starting a word of the name ("sa de"); the letters anywhere; a number that
/// holds the typed digits however they were written (0300…, +92300…, 300…). Ties go to the shorter name, then
/// A to Z. Removed customers and the old "Walk-in Customer" records are never offered (lib/walk-in.ts).
public enum CustomerSearch {
    public struct Hit: Equatable {
        public let customer: Customer
        /// Where the typed letters sit in the name, for marking them; nil when found by number.
        public let match: Range<String.Index>?
        /// Found by the number, not the name.
        public let byPhone: Bool

        public init(customer: Customer, match: Range<String.Index>?, byPhone: Bool) {
            self.customer = customer
            self.match = match
            self.byPhone = byPhone
        }
    }

    /// The people of the book: not removed, not a walk-in record.
    public static func people(_ all: [Customer]) -> [Customer] {
        all.filter { ($0.deletedAt ?? "").isEmpty && !isWalkInName($0.name) }
    }

    /// Typed digits as a number's own: no country code, no leading 0 ("0300 12" and "+92 300 12" are "30012").
    public static func digitsTyped(_ s: String) -> String {
        var d = s.filter { $0 >= "0" && $0 <= "9" }
        if d.hasPrefix("92") && d.count > 2 { d = String(d.dropFirst(2)) }
        while d.hasPrefix("0") { d = String(d.dropFirst()) }
        return d
    }

    private static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func words(_ s: String) -> [Substring] {
        s.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "." || $0 == "," })
    }

    public static func rank(_ query: String, in all: [Customer], limit: Int = 6) -> [Hit] {
        let q = fold(query).split(separator: " ").joined(separator: " ")
        guard !q.isEmpty else { return [] }
        let qWords = words(q).map(String.init)
        let qDigits = digitsTyped(query)
        // A number is being typed when the query is mostly digits.
        let typingNumber = qDigits.count >= 3 && query.filter(\.isLetter).isEmpty

        var scored: [(score: Int, hit: Hit)] = []
        for c in people(all) {
            let name = fold(c.name)
            let nameWords = words(name).map(String.init)
            var score: Int?
            if !typingNumber {
                if name == q {
                    score = 0
                } else if name.hasPrefix(q) {
                    score = 1
                } else if nameWords.contains(where: { $0.hasPrefix(q) }) {
                    score = 2
                } else if qWords.count > 1, qWords.allSatisfy({ w in nameWords.contains { $0.hasPrefix(w) } }) {
                    score = 3
                } else if name.contains(q) {
                    score = 4
                }
            }
            var byPhone = false
            if score == nil, qDigits.count >= 3 {
                let numbers = [c.phone, c.altPhone].map { phoneKey($0).isEmpty ? digitsTyped($0 ?? "") : phoneKey($0) }
                if numbers.contains(where: { !$0.isEmpty && $0.contains(qDigits) }) {
                    score = typingNumber ? 1 : 5
                    byPhone = true
                }
            }
            guard let s = score else { continue }
            let range = byPhone ? nil : c.name.range(of: query.trimmingCharacters(in: .whitespaces),
                                                     options: [.caseInsensitive, .diacriticInsensitive])
            scored.append((s, Hit(customer: c, match: range, byPhone: byPhone)))
        }
        scored.sort { a, b in
            if a.score != b.score { return a.score < b.score }
            if a.hit.customer.name.count != b.hit.customer.name.count { return a.hit.customer.name.count < b.hit.customer.name.count }
            return a.hit.customer.name.localizedCaseInsensitiveCompare(b.hit.customer.name) == .orderedAscending
        }
        return scored.prefix(limit).map(\.hit)
    }

    /// The typed name is exactly someone in the book (any case, any spacing): worth saying before a second
    /// customer of the same name is made.
    public static func exact(_ query: String, in all: [Customer]) -> [Customer] {
        let q = fold(query).split(separator: " ").joined(separator: " ")
        guard !q.isEmpty else { return [] }
        return people(all).filter { fold($0.name).split(separator: " ").joined(separator: " ") == q }
    }
}

/// A number as the ERP keeps it: +92… (phone-field.tsx `toE164`/`fromPasted` with Pakistan as the country, for the
/// shapes the counter types). "0300 1234567", "923001234567", "0092…", "+92 0300…" and a bare "3001234567" all
/// become "+923001234567"; anything else (a foreign number with its +, a number still being typed) stays as typed,
/// spaces and dashes aside.
public func pakistanE164(_ raw: String) -> String {
    var t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        .filter { !" -().'".contains($0) }
    if t.isEmpty { return "" }
    if t.hasPrefix("00") { t = "+" + t.dropFirst(2) }
    // The code typed twice, pasted from a chat: "+92+92…".
    while t.hasPrefix("+92+92") { t = String(t.dropFirst(3)) }
    // A trunk zero inside an international number.
    if t.hasPrefix("+920") { t = "+92" + t.dropFirst(4) }
    let digits = t.filter(\.isNumber)
    if t.hasPrefix("+") { return "+" + digits }
    if digits.count == 11 && digits.hasPrefix("0") { return "+92" + digits.dropFirst() }
    if digits.count == 12 && digits.hasPrefix("92") { return "+" + digits }
    if digits.count == 10 && digits.hasPrefix("3") { return "+92" + digits }
    return t
}
