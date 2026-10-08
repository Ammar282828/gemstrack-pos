import Foundation

/// Lac and crore (src/lib/money.ts): how the shop reads big sums. 85,000 · 4.5 lac · 1.25 crore.
public enum Money {
    public static let lac: Double = 100_000
    public static let crore: Double = 10_000_000

    private static func trimmed(_ v: Double, _ digits: Int) -> String {
        var s = String(format: "%.\(digits)f", v)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s
    }

    /// Whole rupees grouped the way the ERP's en-US formatting groups them: 85,000.
    public static func grouped(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: n.rounded())) ?? String(Int(n.rounded()))
    }

    public static func lacCrore(_ n: Double, digits: Int = 2) -> String {
        let v = n.isFinite ? n : 0
        let sign = v < 0 ? "-" : ""
        let a = abs(v)
        let round = { (x: Double) -> Double in Double(String(format: "%.\(digits)f", x)) ?? x }
        if a >= crore || round(a / lac) >= 100 { return "\(sign)\(trimmed(a / crore, digits)) crore" }
        if a >= lac || a.rounded() >= lac { return "\(sign)\(trimmed(a / lac, digits)) lac" }
        return "\(sign)\(grouped(a))"
    }

    /// "PKR 4.5 lac".
    public static func pkrLac(_ n: Double, digits: Int = 2) -> String { "PKR \(lacCrore(n, digits: digits))" }

    /// "PKR 321,700": exact, as invoices and receipts say it.
    public static func pkr(_ n: Double) -> String { "PKR \(grouped(n))" }
}
