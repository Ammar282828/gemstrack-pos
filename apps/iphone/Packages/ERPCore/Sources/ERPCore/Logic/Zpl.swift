// Ported from src/lib/zebra-zpl.ts (tests: ZplTests, zebra-zpl.test.ts, with the same expected strings).
//
// The tag layout (Models/LabelLayout.swift) as ZPL for a Zebra printer, and the numbers and words that go on it.
//
// - A label takes `tags` pieces (2 for a double tag); a placeholder `{SKU_2}` reads piece 2 of its label, `{sku}`
//   (no number) piece 1. A tag with no piece (the odd last one) prints blank. A key that means nothing stays as
//   typed, so a typo shows on the tag.
// - `{date}`, `{date:d MMM yyyy}`, `{time}`, `{counter:START:STEP:PAD}`, and after a pipe `{price|prefix:Rs |suffix:/-}`,
//   `{name|upper}`, `{name|lower}`, `{weight|fixed:2}`, `{price|group}`, `{name|max:18}`.
// - Text is sent with ^FH_ (ZPL's own hex escape) so a ^, ~, \ or _ in a name prints as itself, and `\&` stays a block's new line.
// - A field's x, y is the corner of its rotated box (what ^FO means), so a turn never moves the corner.
//
// Braces are read by hand, not with a regular expression, and every piece of text is walked as Unicode scalars, so the
// string is the TypeScript's to the last character.

import Foundation

public enum Zpl {
    // MARK: Numbers

    /// `Math.round`, then held between lo and hi.
    static func clampInt(_ v: Double, _ lo: Int, _ hi: Int) -> Int {
        let r = JS.round(v.isFinite ? v : 0)
        return Int(min(Double(hi), max(Double(lo), r)))
    }

    static func clampInt(_ v: Int?, _ lo: Int, _ hi: Int) -> Int { min(hi, max(lo, v ?? 0)) }

    /// A position or size in dots: whole, never negative (^FO takes no negative), within ZPL's 32000.
    static func dots(_ v: Int?) -> Int { clampInt(v, 0, 32000) }

    static func size(_ v: Int?, _ dflt: Int) -> Int { (v ?? 0) >= 1 ? clampInt(v, 1, 32000) : dflt }

    private static func pad(_ n: Int, _ width: Int) -> String {
        let s = String(n)
        return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
    }

    // MARK: The date and the counter

    private static let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    private static let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    /// A moment in Karachi time by a pattern: yyyy yy, MMMM MMM MM M, dd d, EEEE EEE, HH H, hh h, mm m, ss s, a (AM/PM);
    /// 'quoted' text and every other character as typed.
    public static func formatDate(_ pattern: String, _ at: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 5 * 3600)!
        let p = cal.dateComponents([.year, .month, .day, .weekday, .hour, .minute, .second], from: at)
        let year = p.year ?? 1970, month = (p.month ?? 1) - 1, day = p.day ?? 1, wd = (p.weekday ?? 1) - 1
        let hour = p.hour ?? 0, minute = p.minute ?? 0, second = p.second ?? 0
        let chars = Array(pattern.unicodeScalars)
        var out = String.UnicodeScalarView()
        func put(_ s: String) { out.append(contentsOf: s.unicodeScalars) }
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "'" {
                // '' is one quote; otherwise everything up to the next quote is text as typed.
                if i + 1 < chars.count, chars[i + 1] == "'" { out.append("'"); i += 2; continue }
                var j = i + 1
                while j < chars.count, chars[j] != "'" || (j + 1 < chars.count && chars[j + 1] == "'") {
                    if chars[j] == "'" { out.append("'"); j += 2 } else { out.append(chars[j]); j += 1 }
                }
                i = j + 1
                continue
            }
            guard "yMdEHhmsa".unicodeScalars.contains(c) else { out.append(c); i += 1; continue }
            var n = 1
            while i + n < chars.count, chars[i + n] == c { n += 1 }
            i += n
            switch c {
            case "y": put(n == 2 ? pad(year % 100, 2) : pad(year, n))
            case "M": put(n >= 4 ? months[month] : n == 3 ? String(months[month].prefix(3)) : pad(month + 1, n))
            case "d": put(pad(day, n >= 2 ? 2 : 1))
            case "E": put(n >= 4 ? days[wd] : String(days[wd].prefix(3)))
            case "H": put(pad(hour, n >= 2 ? 2 : 1))
            case "h": put(pad(hour % 12 == 0 ? 12 : hour % 12, n >= 2 ? 2 : 1))
            case "m": put(pad(minute, n >= 2 ? 2 : 1))
            case "s": put(pad(second, n >= 2 ? 2 : 1))
            default: put(hour < 12 ? "AM" : "PM")
            }
        }
        return String(out)
    }

    /// `START:STEP:PAD` (each optional) → the number for label `labelIndex`, zero padded.
    private static func counterText(_ arg: String, _ labelIndex: Int, _ override: Int?) -> String {
        let parts = splitScalars(arg, ":")
        func read(_ i: Int, _ dflt: Int) -> Int {
            let t = i < parts.count ? JS.trim(parts[i]) : ""
            if t.isEmpty { return dflt }
            let v = JS.toNumber(t)
            return v.isFinite ? Int(min(1e12, max(-1e12, v.rounded(.towardZero)))) : dflt
        }
        let start = override.map { min(1_000_000_000_000, max(-1_000_000_000_000, $0)) } ?? read(0, 1)
        let step = read(1, 1)
        let width = clampInt(read(2, 0), 0, 20)
        let value = start + labelIndex * step
        return (value < 0 ? "-" : "") + pad(abs(value), width)
    }

    // MARK: Text helpers

    /// `s.split(sep)` on one character, keeping empty pieces.
    static func splitScalars(_ s: String, _ sep: Unicode.Scalar) -> [String] {
        var out: [String] = []
        var cur = String.UnicodeScalarView()
        for c in s.unicodeScalars {
            if c == sep { out.append(String(cur)); cur = String.UnicodeScalarView() } else { cur.append(c) }
        }
        out.append(String(cur))
        return out
    }

    // MARK: Placeholders

    private static let pieceKeys = Set(LabelLive.labelFields.map(\.key))
    private static let csvColumns = Set(LabelCSV.baseHeaders)

    private struct Context {
        var pieces: [LabelValues]
        var labelIndex: Int
        var now: Date
        var counterStart: Int?
    }

    /// One key's value from piece n of the label ("" for a known key with no piece), or nil for a key that means nothing.
    private static func lookup(_ key: String, _ ctx: Context) -> String? {
        func known(_ k: String, _ n: Int) -> String? {
            let piece = n >= 1 && n <= ctx.pieces.count ? ctx.pieces[n - 1] : nil
            if let v = piece?[k] { return v }
            if pieceKeys.contains(k) { return "" }
            let lower = k.lowercased()
            if csvColumns.contains(lower) { return piece?["csv:\(lower)"] ?? "" }
            return nil
        }
        if let direct = known(key, 1) { return direct }
        // `NAME_n`: the last underscore with only digits after it.
        let scalars = Array(key.unicodeScalars)
        if let us = scalars.lastIndex(of: "_"), us + 1 < scalars.count {
            let digits = scalars[(us + 1)...]
            if digits.allSatisfy({ $0.value >= 48 && $0.value <= 57 }) {
                let n = Int(String(String.UnicodeScalarView(digits))) ?? Int.max
                if n >= 1 { return known(String(String.UnicodeScalarView(scalars[..<us])), n) }
            }
        }
        return nil
    }

    private static func isDigit(_ c: Unicode.Scalar) -> Bool { c.value >= 48 && c.value <= 57 }

    /// 12500 → 12,500 in the first number of the text, the rest as it is.
    private static func group(_ value: String) -> String {
        let v = Array(value.unicodeScalars)
        var i = 0
        while i < v.count, !isDigit(v[i]) { i += 1 }
        if i == v.count { return value }
        var j = i
        while j < v.count, isDigit(v[j]) || v[j] == "," { j += 1 }
        let whole = v[i..<j].filter { $0 != "," }
        var k = j
        if k < v.count, v[k] == ".", k + 1 < v.count, isDigit(v[k + 1]) {
            k += 1
            while k < v.count, isDigit(v[k]) { k += 1 }
        }
        var grouped = String.UnicodeScalarView()
        for (p, d) in whole.enumerated() {
            if p > 0 && (whole.count - p) % 3 == 0 { grouped.append(",") }
            grouped.append(d)
        }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: v[..<i])
        out.append(contentsOf: grouped)
        if j < k { out.append(contentsOf: v[j..<k]) }
        out.append(contentsOf: v[max(j, k)...])
        return String(out)
    }

    private static func transform(_ value: String, _ spec: String) -> String {
        let scalars = Array(spec.unicodeScalars)
        let colon = scalars.firstIndex(of: ":")
        let name = String(String.UnicodeScalarView(colon.map { Array(scalars[..<$0]) } ?? scalars))
        let arg = colon.map { String(String.UnicodeScalarView(scalars[($0 + 1)...])) } ?? ""
        switch name {
        case "prefix": return value.isEmpty ? value : arg + value
        case "suffix": return value.isEmpty ? value : value + arg
        case "upper": return value.uppercased()
        case "lower": return value.lowercased()
        case "fixed":
            let n = JS.parseFloat(value)
            let t = JS.trim(arg)
            let digits = JS.toNumber(t)
            if !n.isFinite || abs(n) >= 1e21 || !digits.isFinite || t.isEmpty { return value }
            return JS.toFixed(n, clampInt(digits, 0, 20))
        case "group": return group(value)
        case "max":
            let t = JS.trim(arg)
            let n = JS.toNumber(t)
            if !n.isFinite || t.isEmpty { return value }
            let keep = Int(min(1e9, max(0, n.rounded(.towardZero))))
            return String(String.UnicodeScalarView(value.unicodeScalars.prefix(keep)))
        default: return value
        }
    }

    /// The text with every `{…}` worked out.
    private static func fill(_ template: String, _ ctx: Context) -> String {
        let t = Array(template.unicodeScalars)
        var out = String.UnicodeScalarView()
        var i = 0
        while i < t.count {
            if t[i] != "{" { out.append(t[i]); i += 1; continue }
            var j = i + 1
            while j < t.count, t[j] != "}", t[j] != "{" { j += 1 }
            if j >= t.count || t[j] != "}" { out.append(t[i]); i += 1; continue }
            let token = t[i...j]
            let inner = Array(t[(i + 1)..<j])
            let bar = inner.firstIndex(of: "|")
            let head = bar.map { Array(inner[..<$0]) } ?? inner
            let colon = head.firstIndex(of: ":")
            let name = String(String.UnicodeScalarView(colon.map { Array(head[..<$0]) } ?? head)).lowercased()
            let arg = colon.map { String(String.UnicodeScalarView(head[($0 + 1)...])) } ?? ""
            var value: String?
            if name == "date" { value = formatDate(arg.isEmpty ? "d MMM yyyy" : arg, ctx.now) }
            else if name == "time" { value = formatDate(arg.isEmpty ? "HH:mm" : arg, ctx.now) }
            else if name == "counter" { value = counterText(arg, ctx.labelIndex, ctx.counterStart) }
            else { value = lookup(String(String.UnicodeScalarView(head)), ctx) }
            if var v = value {
                if let bar {
                    for spec in splitScalars(String(String.UnicodeScalarView(inner[(bar + 1)...])), "|") { v = transform(v, spec) }
                }
                out.append(contentsOf: v.unicodeScalars)
            } else {
                out.append(contentsOf: token)
            }
            i = j + 1
        }
        return String(out)
    }

    /// One text with its placeholders filled (what a field's `data` becomes).
    public static func resolveText(_ template: String, pieces: [LabelValues], labelIndex: Int = 0, now: Date = Date(), counterStart: Int? = nil) -> String {
        fill(template, Context(pieces: pieces, labelIndex: labelIndex, now: now, counterStart: counterStart))
    }

    /// Labels for this many pieces.
    public static func labelCount(_ pieces: [LabelValues], _ layout: LabelLayout) -> Int { labelCount(pieceCount: pieces.count, layout) }

    public static func labelCount(pieceCount: Int, _ layout: LabelLayout) -> Int {
        let n = max(0, pieceCount), per = layout.tagsPerLabel
        return (n + per - 1) / per
    }

    /// The layout's fields for one label with their text, QR and barcode data worked out: what the designer's preview
    /// draws and what is printed. A hidden field is still here (the designer shows it faintly); the printer skips it.
    public static func resolveFields(_ layout: LabelLayout, pieces: [LabelValues], labelIndex: Int = 0, now: Date = Date(), counterStart: Int? = nil) -> [LabelLayoutField] {
        let ctx = Context(pieces: pieces, labelIndex: labelIndex, now: now, counterStart: counterStart)
        return layout.fields.map { f in
            guard f.type == .text || f.type == .qr || f.type == .barcode, let data = f.data else { return f }
            var r = f
            r.data = fill(data, ctx)
            return r
        }
    }

    // MARK: ZPL

    /// ^FH_ sends `_5E` for a ^, `_7E` for a ~, `_5C` for a \, `_5F` for a _; a new line is `\&` in a text block and `_0A` elsewhere.
    public static func escape(_ s: String, newline: String) -> String {
        var out = ""
        for c in s.unicodeScalars {
            switch c {
            case "^": out += "_5E"
            case "~": out += "_7E"
            case "\\": out += "_5C"
            case "_": out += "_5F"
            case "\n": out += newline
            default: out.unicodeScalars.append(c)
            }
        }
        return out
    }

    private static func lineBreaks(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        let v = Array(s.unicodeScalars)
        var i = 0
        while i < v.count {
            if v[i] == "\r" { out.append("\n"); if i + 1 < v.count, v[i + 1] == "\n" { i += 1 } } else { out.append(v[i]) }
            i += 1
        }
        return String(out)
    }

    private static func orientation(_ r: Int) -> String { r == 90 ? "R" : r == 180 ? "I" : r == 270 ? "B" : "N" }

    private static func textZpl(_ f: LabelLayoutField) -> [String] {
        let o = orientation(f.rotation)
        let font = (f.fontFamily ?? "").isEmpty ? "0" : f.fontFamily!
        let fs = size(f.fontSize, 20)
        let data = lineBreaks(f.data ?? "")
        let spacing = clampInt(f.lineSpacing, -9999, 9999)
        let x = dots(f.x), y = dots(f.y)
        var out: [String] = []
        func emit(_ px: Int, _ py: Int, _ block: String, _ text: String) {
            out.append("^FO\(px),\(py)^A\(font)\(o),\(fs),\(fs)\(block)^FH_^FD\(text)^FS")
            if f.bold == true { out.append("^FO\(px + 1),\(py)^A\(font)\(o),\(fs),\(fs)\(block)^FH_^FD\(text)^FS") }
        }
        if (f.width ?? 0) >= 1 {
            let newLines = splitScalars(data, "\n").count - 1
            let lines = (f.lines ?? 0) >= 1 ? clampInt(f.lines, 1, 9999) : clampInt(newLines + 1, 1, 9999)
            let align = f.align == "C" || f.align == "R" ? f.align! : "L"
            emit(x, y, "^FB\(size(f.width, 1)),\(lines),\(spacing),\(align)", escape(data, newline: "\\&"))
            return out
        }
        let parts = splitScalars(data, "\n")
        let n = parts.count, pitch = fs + spacing
        let turn = f.rotation == 90 || f.rotation == 180 || f.rotation == 270 ? f.rotation : 0
        for (i, part) in parts.enumerated() {
            // Lines run down the text's own frame: down for 0°, to the left for 90°, up for 180°, to the right for 270°.
            let back = (n - 1 - i) * pitch, fwd = i * pitch
            let px = turn == 90 ? x + back : turn == 270 ? x + fwd : x
            let py = turn == 180 ? y + back : turn == 0 ? y + fwd : y
            emit(dots(px), dots(py), "", escape(part, newline: "_0A"))
        }
        return out
    }

    private static func barcodeZpl(_ f: LabelLayoutField) -> [String] {
        let data = lineBreaks(f.data ?? "")
        if data.isEmpty { return [] }
        let o = orientation(f.rotation)
        let h = size(f.height, 40)
        let m = clampInt(f.moduleWidth ?? 2, 1, 10)
        let yn = f.showText == true ? "Y" : "N"
        let command: String
        switch f.symbology {
        case "code39": command = "^BY\(m)^B3\(o),N,\(h),\(yn),N"
        case "ean13": command = "^BY\(m)^BE\(o),\(h),\(yn),N"
        case "upca": command = "^BY\(m)^BU\(o),\(h),\(yn),N,Y"
        case "datamatrix": command = "^BX\(o),\(m),200"
        case "pdf417": command = "^BY\(m)^B7\(o),\(h)"
        default: command = "^BY\(m)^BC\(o),\(h),\(yn),N,N"
        }
        return ["^FO\(dots(f.x)),\(dots(f.y))\(command)^FH_^FD\(escape(data, newline: "_0A"))^FS"]
    }

    private static func fieldZpl(_ f: LabelLayoutField) -> [String] {
        switch f.type {
        case .text: return textZpl(f)
        case .qr:
            let data = lineBreaks(f.data ?? "")
            if data.isEmpty { return [] }
            let mag = f.qrMagnification == nil ? 2 : clampInt(f.qrMagnification, 1, 10)
            let ec = f.errorCorrection == "L" || f.errorCorrection == "Q" || f.errorCorrection == "H" ? f.errorCorrection! : "M"
            return ["^FO\(dots(f.x)),\(dots(f.y))^BQ\(orientation(f.rotation)),2,\(mag),\(ec)^FH_^FD\(ec)A,\(escape(data, newline: "_0A"))^FS"]
        case .barcode: return barcodeZpl(f)
        case .line, .box:
            let w = size(f.width, 1), h = size(f.height, 1)
            let edge = min(w, h)
            let t = f.type == .line || f.fill == true ? edge : size(f.thickness ?? 2, 1)
            let r = f.type == .line ? 0 : clampInt(f.rounding, 0, 8)
            return ["^FO\(dots(f.x)),\(dots(f.y))^GB\(w),\(h),\(t),B,\(r)^FS"]
        case .ellipse:
            let w = size(f.width, 1), h = size(f.height, 1)
            let t = f.fill == true ? min(w, h) : size(f.thickness ?? 2, 1)
            return ["^FO\(dots(f.x)),\(dots(f.y))^GE\(w),\(h),\(t),B^FS"]
        case .image:
            let w = size(f.width, 1), h = size(f.height, 1)
            guard let bitmap = f.bitmap, !bitmap.isEmpty, let g = LabelBitmap.hex(bitmap: bitmap, width: w, height: h, rotate180: f.rotation == 180) else { return [] }
            return ["^FO\(dots(f.x)),\(dots(f.y))^GFA,\(g.total),\(g.total),\(g.bytesPerRow),\(g.hex)^FS"]
        }
    }

    private static let thermal = ["transfer": "T", "direct": "D"]
    private static let mode = ["tear": "T", "peel": "P", "cutter": "C", "rewind": "R", "delayed-cut": "D"]
    private static let media = ["gap": "Y", "mark": "M", "continuous": "N"]

    /// `^XA^CI28^PW…^LL…` and the printer's options, in a fixed order (^LH ^LT ^LS ^MT ^MM ^MN ^PR ~SD ~TA ^PO ^PM).
    private static func header(_ layout: LabelLayout) -> String {
        let p = layout.effectivePrinter
        var s = "^XA^CI28^PW\(size(layout.widthDots, 1))^LL\(size(layout.heightDots, 1))"
        if p.homeX != nil || p.homeY != nil { s += "^LH\(dots(p.homeX)),\(dots(p.homeY))" }
        if let v = p.labelTop { s += "^LT\(clampInt(v, -120, 120))" }
        s += "^LS\(p.labelShift.map { clampInt($0, -9999, 9999) } ?? 0)"
        if let k = p.thermal, let c = thermal[k] { s += "^MT\(c)" }
        if let k = p.mode, let c = mode[k] { s += "^MM\(c)" }
        if let k = p.media, let c = media[k] { s += "^MN\(c)" }
        if let v = p.speed { s += "^PR\(clampInt(v, 2, 14))" }
        if let v = p.darkness { s += "~SD\(pad(clampInt(v, 0, 30), 2))" }
        if let v = p.tearOff { let t = clampInt(v, -120, 120); s += "~TA\(t < 0 ? "-" : "+")\(pad(abs(t), 3))" }
        if p.orientation == "normal" { s += "^PON" } else if p.orientation == "inverted" { s += "^POI" }
        if p.mirror == true { s += "^PMY" } else if p.mirror == false { s += "^PMN" }
        return s
    }

    /// The ZPL for these pieces: one label to `tags` pieces, each `^XA … ^XZ` on its own lines, `copies` of each
    /// (^PQ). `skip` blank labels come first, for a roll that is part used.
    public static func render(_ layout: LabelLayout, pieces: [LabelValues], copies: Int = 1, skip: Int = 0, counterStart: Int? = nil, now: Date = Date()) -> String {
        let tags = layout.tagsPerLabel
        let copies = clampInt(copies, 1, 9999)
        let skip = clampInt(skip, 0, 999)
        let head = header(layout)
        var out = ""
        for _ in 0..<skip { out += "\(head)\n^PQ1,0,1,Y^XZ\n" }
        let total = labelCount(pieces, layout)
        for i in 0..<total {
            let group = Array(pieces[(i * tags)..<min(pieces.count, (i + 1) * tags)])
            out += "\(head)\n"
            for f in resolveFields(layout, pieces: group, labelIndex: i, now: now, counterStart: counterStart) where !f.hidden {
                for line in fieldZpl(f) { out += "\(line)\n" }
            }
            out += "^PQ\(copies),0,1,Y^XZ\n"
        }
        return out
    }
}
