import Foundation

/// The few places where JavaScript and Swift read the same text or number differently, and the
/// ported rules (src/lib/*.ts) lean on the JavaScript way: `Math.round` sends a half up,
/// `toFixed` and `String(n)` print numbers their own way, `parseFloat` takes a leading number
/// and ignores the rest, `localeCompare` sorts strings, and date-fns' `parseISO` reads a bare day
/// as the *local* midnight. Internal to ERPCore: a rule that needs one of them says so with `JS.`,
/// so a reader can see where the port is being exact on purpose.
///
/// Karachi is "local" for every date here: the shop's counter, its devices and the owner's phone
/// are all UTC+5 (ERPDate.karachi), and the two sites the web ERP computes dates on (browser,
/// server) are told apart only by the server, which the app never is.
enum JS {
    // MARK: Numbers

    /// `Math.round`: halves go up, so -2.5 is -2 (Swift's `.rounded()` would say -3).
    static func round(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        let down = x.rounded(.down)
        return x - down >= 0.5 ? down + 1 : down
    }

    /// `String(n)`: the shortest digits that read back as the same number, laid out the way
    /// ECMAScript does (3, 5.2, 104000, 0.00001, 1e-7, 1e+21). Swift's own `description` agrees
    /// on the digits but switches to an exponent sooner ("1e-05").
    static func number(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x == 0 { return "0" }
        if x.isInfinite { return x < 0 ? "-Infinity" : "Infinity" }
        let described = "\(abs(x))"
        var mantissa = Substring(described)
        var exponent = 0
        if let e = described.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = described[..<e]
            exponent = Int(described[described.index(after: e)...]) ?? 0
        }
        let halves = mantissa.split(separator: ".", omittingEmptySubsequences: false)
        let whole = String(halves[0])
        var digits = whole + (halves.count > 1 ? String(halves[1]) : "")
        // value = 0.<digits> × 10^n
        var n = whole.count + exponent
        while digits.hasPrefix("0") { digits.removeFirst(); n -= 1 }
        while digits.hasSuffix("0") { digits.removeLast() }
        let k = digits.count
        let sign = x < 0 ? "-" : ""
        if k <= n && n <= 21 { return sign + digits + String(repeating: "0", count: n - k) }
        if 0 < n && n <= 21 { return sign + digits.prefix(n) + "." + digits.dropFirst(n) }
        if -6 < n && n <= 0 { return sign + "0." + String(repeating: "0", count: -n) + digits }
        let e = n - 1
        let tail = (e < 0 ? "-" : "+") + String(abs(e))
        return sign + (k == 1 ? digits : digits.prefix(1) + "." + digits.dropFirst()) + "e" + tail
    }

    /// `n.toFixed(digits)`: the double's exact decimal value, a tie going to the larger number
    /// ((7.25).toFixed(1) is "7.3", (1.005).toFixed(2) is "1.00" because 1.005 is really 1.00499…).
    static func toFixed(_ x: Double, _ digits: Int) -> String {
        guard x.isFinite, abs(x) < 1e21 else { return number(x) }
        let negative = x < 0
        let expansion = String(format: "%.\(digits + 60)f", abs(x))
        let halves = expansion.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        let whole = String(halves[0])
        let fraction = halves.count > 1 ? String(halves[1]) : ""
        let kept = String(fraction.prefix(digits))
        let next = fraction.dropFirst(digits).first
        var digitsList = Array(whole + kept).map { Int($0.wholeNumberValue ?? 0) }
        if let next, (next.wholeNumberValue ?? 0) >= 5 {
            var i = digitsList.count - 1
            while i >= 0 {
                if digitsList[i] == 9 { digitsList[i] = 0; i -= 1 } else { digitsList[i] += 1; break }
            }
            if i < 0 { digitsList.insert(1, at: 0) }
        }
        let text = digitsList.map(String.init).joined()
        let cut = text.index(text.endIndex, offsetBy: -digits)
        let body = digits > 0 ? "\(text[..<cut]).\(text[cut...])" : text
        return (negative ? "-" : "") + body
    }

    /// `Number(s)`: NaN unless the whole text is a number (blank is 0).
    static func toNumber(_ s: String) -> Double {
        let t = trim(s)
        if t.isEmpty { return 0 }
        switch t {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        // JavaScript's whole-number forms: 0x1f, 0b101, 0o17 (never signed, never with a point).
        if t.count > 2, t.hasPrefix("0") {
            let radix: Int? = ["x": 16, "X": 16, "b": 2, "B": 2, "o": 8, "O": 8][String(t[t.index(after: t.startIndex)])]
            if let radix { return UInt64(t.dropFirst(2), radix: radix).map { Double($0) } ?? .nan }
        }
        // Swift also reads "inf", "nan" and hex floats; JavaScript reads none of them.
        if t.contains(where: { "xXpPnN".contains($0) }) || t.range(of: "inf", options: .caseInsensitive) != nil { return .nan }
        return Double(t) ?? .nan
    }

    /// `parseFloat(s)`: the number the text starts with ("26250.00", " 12abc" is 12, ".5", "1e3x"), else NaN.
    static func parseFloat(_ s: String) -> Double {
        let chars = Array(trimStart(s))
        var i = 0
        var sign = ""
        if i < chars.count, chars[i] == "+" || chars[i] == "-" { sign = chars[i] == "-" ? "-" : ""; i += 1 }
        if String(chars[i...]).hasPrefix("Infinity") { return sign == "-" ? -.infinity : .infinity }
        var whole = "", fraction = ""
        while i < chars.count, chars[i].isASCII, chars[i].isNumber { whole.append(chars[i]); i += 1 }
        if i < chars.count, chars[i] == "." {
            var j = i + 1
            var f = ""
            while j < chars.count, chars[j].isASCII, chars[j].isNumber { f.append(chars[j]); j += 1 }
            if !whole.isEmpty || !f.isEmpty { fraction = f; i = j }
        }
        if whole.isEmpty && fraction.isEmpty { return .nan }
        var exponent = ""
        if i < chars.count, chars[i] == "e" || chars[i] == "E" {
            var j = i + 1
            var e = ""
            if j < chars.count, chars[j] == "+" || chars[j] == "-" { e.append(chars[j]); j += 1 }
            var digits = ""
            while j < chars.count, chars[j].isASCII, chars[j].isNumber { digits.append(chars[j]); j += 1 }
            if !digits.isEmpty { exponent = "e" + e + digits }
        }
        let text = sign + (whole.isEmpty ? "0" : whole) + (fraction.isEmpty ? "" : "." + fraction) + exponent
        return Double(text) ?? .nan
    }

    /// `parseInt(s, 10)`: the whole number the text starts with ("21k" is 21), else NaN.
    static func parseInt(_ s: String) -> Double {
        let chars = Array(trimStart(s))
        var i = 0
        var negative = false
        if i < chars.count, chars[i] == "+" || chars[i] == "-" { negative = chars[i] == "-"; i += 1 }
        var digits = ""
        while i < chars.count, chars[i].isASCII, chars[i].isNumber { digits.append(chars[i]); i += 1 }
        guard let value = Double(digits) else { return .nan }
        return negative ? -value : value
    }

    // MARK: Text

    /// JavaScript's white space and line terminators (`\s`, `trim`): not Swift's, which also counts
    /// U+0085 and leaves out U+FEFF.
    static let whitespace: CharacterSet = {
        var set = CharacterSet(charactersIn: "\t\n\u{0B}\u{0C}\r \u{A0}\u{1680}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        set.insert(charactersIn: "\u{2000}"..."\u{200A}")
        return set
    }()

    static func isSpace(_ c: Character) -> Bool { c.unicodeScalars.allSatisfy { whitespace.contains($0) } }

    /// `String.prototype.trim`.
    static func trim(_ s: String) -> String { s.trimmingCharacters(in: whitespace) }

    private static func trimStart(_ s: String) -> String {
        var scalars = Substring(s).unicodeScalars
        while let first = scalars.first, whitespace.contains(first) { scalars = scalars.dropFirst() }
        return String(scalars)
    }

    /// JavaScript truthiness of an optional string: present and not "".
    static func has(_ s: String?) -> Bool { !(s ?? "").isEmpty }

    /// `a.localeCompare(b)` as ICU's root collation orders ASCII (what Node, a browser and the
    /// shop's ids and ISO dates are made of): punctuation, then digits, then letters with case
    /// only breaking a tie (a before A). Anything outside ASCII sorts after it by code point.
    /// Negative when `a` sorts first.
    static func localeCompare(_ a: String, _ b: String) -> Int {
        let pa = a.unicodeScalars.compactMap(primaryWeight)
        let pb = b.unicodeScalars.compactMap(primaryWeight)
        for (x, y) in zip(pa, pb) where x != y { return x < y ? -1 : 1 }
        if pa.count != pb.count { return pa.count < pb.count ? -1 : 1 }
        // Same letters: lower case first, at the first place the case differs.
        for (x, y) in zip(a.unicodeScalars.filter { primaryWeight($0) != nil }, b.unicodeScalars.filter { primaryWeight($0) != nil }) where x != y {
            let xl = isLowerASCII(x), yl = isLowerASCII(y)
            if xl != yl { return xl ? -1 : 1 }
            return x.value < y.value ? -1 : 1
        }
        return 0
    }

    private static let punctuationOrder = Array("_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$".unicodeScalars)

    private static func isLowerASCII(_ s: Unicode.Scalar) -> Bool { s.value >= 97 && s.value <= 122 }

    /// nil for a control character, which collation ignores.
    private static func primaryWeight(_ s: Unicode.Scalar) -> Int? {
        switch s.value {
        case 0x09...0x0D, 0x20: return Int(s.value)
        case 0..<0x20, 0x7F: return nil
        case 0x30...0x39: return 1000 + Int(s.value - 0x30)
        case 0x61...0x7A: return 2000 + Int(s.value - 0x61)
        case 0x41...0x5A: return 2000 + Int(s.value - 0x41)
        default:
            if let at = punctuationOrder.firstIndex(of: s) { return 100 + at }
            return 10_000 + Int(s.value)
        }
    }

    // MARK: Dates

    /// An instant as whole milliseconds, which is how `getTime()` compares them (a period's end
    /// is 23:59:59.999, and seconds as a Double cannot be trusted at that last millisecond).
    static func ms(_ d: Date) -> Int64 { Int64((d.timeIntervalSince1970 * 1000).rounded()) }

    private static let karachiOffset = TimeInterval(5 * 3600)

    private static func isBareDay(_ s: String) -> Bool {
        let c = Array(s)
        guard c.count == 10 else { return false }
        return c.enumerated().allSatisfy { i, ch in i == 4 || i == 7 ? ch == "-" : (ch.isASCII && ch.isNumber) }
    }

    /// "yyyy-MM-ddTHH:mm[:ss[.fff]]" with no zone: the local time, which here is Karachi.
    private static func zonelessDateTime(_ s: String) -> Date? {
        let parts = s.split(separator: "T", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, isBareDay(String(parts[0])), let midnight = ERPDate.parse(String(parts[0])) else { return nil }
        let clock = parts[1].split(separator: ":", omittingEmptySubsequences: false)
        guard clock.count == 2 || clock.count == 3,
              let h = Int(clock[0]), let m = Int(clock[1]), (0...23).contains(h), (0...59).contains(m) else { return nil }
        var seconds = 0.0
        if clock.count == 3 {
            guard let sec = Double(clock[2]), sec >= 0, sec < 60, !clock[2].contains("+"), !clock[2].contains("-") else { return nil }
            seconds = sec
        }
        return midnight.addingTimeInterval(-karachiOffset + Double(h * 3600 + m * 60) + seconds)
    }

    /// `new Date(s)`: an ISO instant, a bare day (UTC midnight), or a zoneless date-time (Karachi). nil is an invalid date.
    static func newDate(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return ERPDate.parse(s) ?? zonelessDateTime(JS.trim(s))
    }

    /// date-fns `parseISO(s)`: as `newDate`, except that a bare day is the *local* midnight
    /// (here Karachi's), which is the whole reason the web ERP uses it for promised days.
    static func parseISO(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let t = JS.trim(s)
        if isBareDay(t) { return ERPDate.parse(t).map { $0.addingTimeInterval(-karachiOffset) } }
        return newDate(t)
    }

    /// date-fns `startOfDay`, in Karachi.
    static func karachiStartOfDay(_ d: Date) -> Date {
        let midnightUTC = ERPDate.parse(ERPDate.karachiDay(d)) ?? d
        return midnightUTC.addingTimeInterval(-karachiOffset)
    }

    /// date-fns `differenceInCalendarDays(a, b)` for two Karachi days.
    static func calendarDays(_ a: Date, since b: Date) -> Int {
        Int(((karachiStartOfDay(a).timeIntervalSince1970 - karachiStartOfDay(b).timeIntervalSince1970) / 86_400).rounded())
    }

    /// en-GB's short month as the browser the web ERP runs in prints it ("Sept" for September).
    static let shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
    static let shortWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
}

extension Array {
    /// JavaScript's `sort`, which is stable: elements that compare equal keep their order
    /// (Swift's `sort` does not promise it). `compare` is the comparator's number: negative sorts `a` first.
    func jsSorted(by compare: (Element, Element) -> Double) -> [Element] {
        enumerated().sorted { l, r in
            let c = compare(l.element, r.element)
            return c < 0 || (c == 0 && l.offset < r.offset)
        }.map(\.element)
    }
}
