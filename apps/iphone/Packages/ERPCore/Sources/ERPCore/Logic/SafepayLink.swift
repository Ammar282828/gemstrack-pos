import Foundation

/// Payment links by Safepay (src/lib/safepay.ts, lib/writes/payment-links.ts; owner, 2026-11-09). The server makes the
/// link and records the money when it is paid; these are the words and the checks the apps share.
public enum SafepayLink {
    /// Safepay's PUBLIC key as the server accepts it (`isSafepayPublicKey`: ^sec_[0-9a-f-]{20,64}$). The Secret key
    /// is never asked for.
    public static func isPublicKey(_ raw: String) -> Bool {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.hasPrefix("sec_") else { return false }
        let rest = key.dropFirst(4)
        guard (20...64).contains(rest.count) else { return false }
        return rest.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) || $0 == "-" }
    }

    /// What the amount box starts with: what is owed, in whole rupees (never below 1: nothing owed has no link).
    public static func defaultAmount(owed: Double) -> Double { owed >= 1 ? owed.rounded() : 0 }

    /// Whether a record may be asked for money by link: open (not Cancelled or Refunded) and something owed.
    public static func offered(status: String, owed: Double) -> Bool {
        status != "Cancelled" && status != "Refunded" && owed >= 1
    }

    /// The server takes 1 rupee up to 50,000,000.
    public static func isValidAmount(_ amount: Double) -> Bool {
        amount.isFinite && amount >= 1 && amount <= 50_000_000
    }

    /// "Assalam o Alaikum Sara, please pay PKR 12,500 for INV-000123 here: https://… — TAHERI". A walk-in or nameless
    /// customer gets no name.
    public static func message(customerName: String?, amount: Double, id: String, url: String, shopName: String) -> String {
        var greeting = "Assalam o Alaikum"
        let name = (customerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty && !isWalkInName(name) { greeting += " " + name }
        return "\(greeting), please pay \(Money.pkr(amount.rounded())) for \(id) here: \(url) \u{2014} \(shopName)"
    }
}
