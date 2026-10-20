import Foundation

/// The one reader of a number someone typed or pasted (amounts, weights, rates). Every screen goes through it so
/// "12,5" means the same everywhere; before, some fields read it as 125. Unreadable is nil, never 0.
public enum ShopNumber {
    /// Accepts ASCII, Arabic-Indic and Urdu digits. A comma groups thousands only when it groups 3 digits
    /// ("1,500", lakh "1,50,000"); a lone comma with 1-2 digits after it and no dot ("12,5") is a decimal point,
    /// as the decimal pad of a comma region types it. One "." is the decimal point. Spaces and "PKR"/"Rs" are ignored.
    public static func parse(_ text: String) -> Double? {
        var t = ascii(text).lowercased()
        for word in ["pkr", "rs."," rs", "rs"] { t = t.replacingOccurrences(of: word, with: "") }
        t = String(t.filter { !$0.isWhitespace })
        guard !t.isEmpty, t.allSatisfy({ ($0 >= "0" && $0 <= "9") || $0 == "," || $0 == "." }) else { return nil }
        guard t.contains(where: { $0 >= "0" && $0 <= "9" }) else { return nil }

        let dots = t.filter { $0 == "." }.count
        if dots > 1 { return nil }
        var whole = t
        var fraction = ""
        if dots == 1 {
            let parts = t.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
            whole = String(parts[0]); fraction = String(parts[1])
            if fraction.contains(",") { return nil }
        } else if let comma = t.lastIndex(of: ",") {
            let after = t.distance(from: comma, to: t.endIndex) - 1
            if (after == 1 || after == 2), t.filter({ $0 == "," }).count == 1 {
                whole = String(t[t.startIndex..<comma]); fraction = String(t[t.index(after: comma)...])
            }
        }
        if whole.contains(",") {
            let groups = whole.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
            guard groups.count >= 2, let first = groups.first, (1...3).contains(first.count),
                  groups.last?.count == 3, groups.dropFirst().dropLast().allSatisfy({ $0.count == 2 || $0.count == 3 }) else { return nil }
            whole = groups.joined()
        }
        guard !whole.isEmpty || !fraction.isEmpty else { return nil }
        let s = (whole.isEmpty ? "0" : whole) + (fraction.isEmpty ? "" : "." + fraction)
        guard let v = Double(s), v.isFinite else { return nil }
        return v
    }

    /// Digits of any script to ASCII; the Arabic decimal and thousands marks to "." and ",".
    public static func ascii(_ text: String) -> String {
        var out = ""
        for u in text.unicodeScalars {
            switch u.value {
            case 0x0660...0x0669: out.unicodeScalars.append(Unicode.Scalar(0x30 + u.value - 0x0660)!)
            case 0x06F0...0x06F9: out.unicodeScalars.append(Unicode.Scalar(0x30 + u.value - 0x06F0)!)
            case 0x066B: out.append(".")
            case 0x066C, 0x060C: out.append(",")
            default: out.unicodeScalars.append(u)
            }
        }
        return out
    }

    /// True when something was typed but cannot be read (blank is not unreadable: it is just empty).
    public static func isUnreadable(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && parse(text) == nil
    }
}
