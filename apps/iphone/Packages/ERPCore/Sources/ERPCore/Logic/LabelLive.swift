// Ported from src/lib/label-live.ts (tests: LabelLiveTests) and src/lib/label-live-values.ts (a piece's
// values, `LabelLive.valuesFor`). The tag CSV's own columns it fills from are LabelCSV.swift
// (src/lib/label-csv.ts).
//
// Label LIVE (label.live, the Mac app the shop prints its tags with) takes a print from a link:
// `labellive://print?design=…&variables=<JSON>&printer=…&copies=…&window=…`. The design's variable names
// live in its .lsc file on the Mac, so the ERP never guesses them: the owner pastes the link Label LIVE's
// Integrate button copies, and `parseIntegrateURL` reads the design, the printer and every variable name
// out of it. A design can hold several tags (House of Mina's two-tag "minalabel": every variable twice as
// `SKU_1` / `SKU_2`); a variable ending `_<n>` belongs to tag n, each print fills as many pieces as the
// design has tags, and a tag left over is printed blank.
//
// JavaScript's text habits the link depends on are written out here, not borrowed from Swift:
// `encodeURIComponent` / `decodeURIComponent` (what the TS builds and reads the link with) and
// `JSON.stringify` (the variables), so a link is the same characters as the web ERP's, to the last "%".

import Foundation

// MARK: The settings shape

/// One design variable and the piece's field that fills it (`LabelLive.fieldKeys`), or "" to leave it as
/// the design has it. The settings keep the pairings as a list (`StoredLabelLive.vars`) because the
/// settings document is written with a merge, which would keep a removed variable in a map.
public struct LabelLiveVar: Decodable, Hashable {
    public var name: String
    public var field: String

    public init(name: String, field: String) {
        self.name = name
        self.field = field
    }

    private enum K: String, CodingKey { case name, field }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        name = c.string(.name, default: "")
        field = c.string(.field, default: "")
    }
}

/// Each design variable → its field, in the order the design gave them (the TS object keeps its
/// insertion order, and the link's JSON is written in it). A dictionary literal keeps its order too.
public struct LabelLiveMap: Hashable, ExpressibleByDictionaryLiteral {
    public private(set) var vars: [LabelLiveVar] = []

    public init() {}
    public init(vars: [LabelLiveVar]) { for v in vars { self[v.name] = v.field } }
    public init(dictionaryLiteral elements: (String, String)...) { for (k, v) in elements { self[k] = v } }

    /// nil when the design variable is not in the map (JavaScript's `undefined`).
    public subscript(name: String) -> String? {
        get { vars.first { $0.name == name }?.field }
        set {
            guard let newValue else { vars.removeAll { $0.name == name }; return }
            if let i = vars.firstIndex(where: { $0.name == name }) { vars[i].field = newValue }
            else { vars.append(LabelLiveVar(name: name, field: newValue)) }
        }
    }

    public var names: [String] { vars.map(\.name) }
}

/// What the Settings → Labels card keeps and a print needs (TS `LabelLiveConfig`).
public struct LabelLiveConfig: Hashable {
    /// The design's name as Label LIVE pins it ("minalabel").
    public var design: String
    /// Label LIVE's printer id (its Print tab); empty prints to the last printer used. "Preview" previews.
    public var printer: String
    public var copies: Int
    public var map: LabelLiveMap
    /// Keep Label LIVE's window out of the way while it prints.
    public var hideWindow: Bool

    public init(design: String, printer: String = "", copies: Int = 1, map: LabelLiveMap = LabelLiveMap(), hideWindow: Bool = true) {
        self.design = design
        self.printer = printer
        self.copies = copies
        self.map = map
        self.hideWindow = hideWindow
    }
}

/// As the shop's settings keep it (`app_settings/global` → `labelLive`, TS `StoredLabelLive`). Lenient:
/// anything missing or odd reads as the default, and `LabelLive.clean` then drops what cannot be printed.
public struct StoredLabelLive: Decodable, Hashable {
    public var design: String
    public var printer: String
    public var copies: Double
    public var hideWindow: Bool
    public var vars: [LabelLiveVar]

    public init(design: String, printer: String, copies: Double, hideWindow: Bool, vars: [LabelLiveVar]) {
        self.design = design
        self.printer = printer
        self.copies = copies
        self.hideWindow = hideWindow
        self.vars = vars
    }

    private enum K: String, CodingKey { case design, printer, copies, hideWindow, vars }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        design = c.string(.design, default: "")
        printer = c.string(.printer, default: "")
        copies = c.double(.copies, default: 1)
        // `hideWindow !== false`: only a real false shows the window.
        hideWindow = ((try? c.decodeIfPresent(Bool.self, forKey: .hideWindow)) ?? nil) != false
        vars = c.list(.vars)
    }
}

extension Settings {
    /// The Label LIVE setup as a print can use it; nil until the owner has pasted a link.
    public var labelLiveConfig: LabelLiveConfig? { LabelLive.clean(labelLive) }
}

/// The design, printer, copies and variable names read out of an Integrate link (TS `ParsedIntegrate`).
public struct LabelLiveIntegrate: Hashable {
    public var design: String
    public var printer: String
    public var copies: Int
    public var variables: [String]

    public init(design: String, printer: String, copies: Int, variables: [String]) {
        self.design = design
        self.printer = printer
        self.copies = copies
        self.variables = variables
    }
}

/// What a piece can put on a label (TS `LABEL_FIELDS` and the tag CSV's columns).
public struct LabelField: Hashable {
    public let key: String
    public let label: String
}

/// The values one piece gives a label, by field key: worked out by the caller (it has the rates).
public typealias LabelValues = [String: String]

/// Which tag of a design that holds several a variable belongs to.
public struct LabelTags {
    public let count: Int
    /// 0 for a variable shared by the whole label.
    public let tagOf: (String) -> Int
}

// MARK: Label LIVE

public enum LabelLive {
    // MARK: Fields

    /// What a piece can put on a label. Money is whole rupees (decision "Whole rupees").
    public static let labelFields: [LabelField] = [
        LabelField(key: "sku", label: "SKU"),
        LabelField(key: "name", label: "Name"),
        LabelField(key: "price", label: "Price (Rs 12,500)"),
        LabelField(key: "priceNumber", label: "Price, number only (12500)"),
        LabelField(key: "weight", label: "Weight (4.250 g)"),
        LabelField(key: "weightNumber", label: "Weight, number only (4.250)"),
        LabelField(key: "metal", label: "Metal and karat (Gold 21k)"),
        LabelField(key: "karat", label: "Karat (21k)"),
        LabelField(key: "category", label: "Category"),
        LabelField(key: "stones", label: "Stones (details)"),
        LabelField(key: "stoneWeight", label: "Stone weight (g)"),
        LabelField(key: "diamonds", label: "Diamonds (details)"),
        LabelField(key: "size", label: "Size"),
        LabelField(key: "plating", label: "Plating"),
        LabelField(key: "shop", label: "Shop name"),
        LabelField(key: "qr", label: "QR / barcode (the SKU)"),
        LabelField(key: "date", label: "Today’s date"),
    ]

    /// The tag CSV's own columns, as the file writes them: `csv:total_price_pkr` → "20650".
    public static let csvFields: [LabelField] = LabelCSV.baseHeaders.map { LabelField(key: "csv:\($0)", label: "Tag CSV: \($0)") }

    public static let fieldKeys: [String] = (labelFields + csvFields).map(\.key)

    // MARK: Reading Label LIVE's Integrate link

    /// Split RJSON `NAME:'Jane Doe',CITY:Karachi` at the commas between pairs (not those inside quotes) and
    /// return each pair's key and value.
    public static func rjsonPairs(_ s: String) -> [(key: String, value: String)] {
        var out: [(key: String, value: String)] = []
        var buf: [Unicode.Scalar] = []
        var quote: Unicode.Scalar?
        func flush() {
            if let colon = buf.firstIndex(of: ":"), colon > 0 {
                var key = JS.trim(String(String.UnicodeScalarView(buf[..<colon])))
                // `.replace(/^['"]|['"]$/g, '')`: one quote off the front and one off the back.
                if let f = key.unicodeScalars.first, f == "'" || f == "\"" { key.unicodeScalars.removeFirst() }
                if let l = key.unicodeScalars.last, l == "'" || l == "\"" { key.unicodeScalars.removeLast() }
                var value = JS.trim(String(String.UnicodeScalarView(buf[(colon + 1)...])))
                let v = Array(value.unicodeScalars)
                if v.count >= 2, v[0] == "'" || v[0] == "\"", v[v.count - 1] == v[0] {
                    var inner = Array(v[1..<(v.count - 1)])
                    // `.replace(/\\(['"&])/g, '$1')`: an escaped quote or "&" is itself.
                    var unescaped: [Unicode.Scalar] = []
                    var i = 0
                    while i < inner.count {
                        if inner[i] == "\\", i + 1 < inner.count, ["'", "\"", "&"].contains(inner[i + 1]) { unescaped.append(inner[i + 1]); i += 2 }
                        else { unescaped.append(inner[i]); i += 1 }
                    }
                    inner = unescaped
                    value = String(String.UnicodeScalarView(inner))
                }
                if !key.isEmpty { out.append((key, value)) }
            }
            buf = []
        }
        let chars = Array(s.unicodeScalars)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\\", i + 1 < chars.count { buf.append(c); i += 1; buf.append(chars[i]); i += 1; continue }
            if let q = quote { if c == q { quote = nil }; buf.append(c); i += 1; continue }
            if c == "'" || c == "\"" { quote = c; buf.append(c); i += 1; continue }
            if c == "{" || c == "}" { i += 1; continue } // a `{…}` wrapper some links carry
            if c == "," { flush(); i += 1; continue }
            buf.append(c)
            i += 1
        }
        flush()
        return out
    }

    /// The link Label LIVE's Integrate button copies ("Copy URL" or "Copy Browser URL") → its design,
    /// printer, copies and variable names. Nil when it isn't a Label LIVE print link.
    public static func parseIntegrateURL(_ raw: String) -> LabelLiveIntegrate? {
        let s = JS.trim(raw)
        // `/^labellive:\/\/print\??(.*)$/i`: `.` stops at a line break, so one anywhere fails the match.
        let prefix = "labellive://print"
        guard s.lowercased().hasPrefix(prefix) else { return nil }
        var rest = String(s.unicodeScalars.dropFirst(prefix.unicodeScalars.count))
        if rest.hasPrefix("?") { rest.removeFirst() }
        if rest.unicodeScalars.contains(where: isLineTerminator) { return nil }
        // Its options are split at the "&" that are not escaped as "\&" (Label LIVE's rule inside values).
        var parts: [String] = []
        var cur = String.UnicodeScalarView()
        let r = Array(rest.unicodeScalars)
        for (i, c) in r.enumerated() {
            if c == "&" && !(i > 0 && r[i - 1] == "\\") { parts.append(String(cur)); cur = String.UnicodeScalarView() } else { cur.append(c) }
        }
        parts.append(String(cur))
        func get(_ name: String) -> String? {
            guard let p = parts.first(where: { $0.lowercased().hasPrefix("\(name)=") }) else { return nil }
            let v = String(p.unicodeScalars.dropFirst(name.unicodeScalars.count + 1))
            return decodeURIComponent(v.replacingOccurrences(of: "+", with: "%20")) ?? v
        }
        let design = JS.trim(get("design") ?? "")
        if design.isEmpty { return nil }
        return LabelLiveIntegrate(
            design: design,
            printer: JS.trim(get("printer") ?? ""),
            copies: copiesFrom(get("copies").map(JS.toNumber) ?? .nan),
            variables: rjsonPairs(get("variables") ?? "").map(\.key)
        )
    }

    /// `Number.isFinite(c) && c >= 1 ? Math.min(99, Math.round(c)) : 1`.
    private static func copiesFrom(_ c: Double) -> Int {
        c.isFinite && c >= 1 ? Int(min(99, JS.round(c))) : 1
    }

    /// The field a design variable most likely wants, by its name; "" when nothing fits.
    public static func guessField(_ variable: String) -> String {
        // A tag CSV column with its tag's number (`TOTAL_PRICE_PKR_1`): the design was built on the CSV.
        if let t = tagSuffix(variable), !t.prefix.isEmpty, !t.prefix.unicodeScalars.contains(where: isLineTerminator) {
            let csv = t.prefix.lowercased()
            if LabelCSV.baseHeaders.contains(csv) { return "csv:\(csv)" }
        }
        let base = (tagSuffix(variable)?.prefix ?? variable).lowercased()
        let v = String(base.unicodeScalars.filter { ($0.value >= 97 && $0.value <= 122) || ($0.value >= 48 && $0.value <= 57) })
        func has(_ w: String...) -> Bool { w.contains { v.contains($0) } }
        if has("qr", "barcode") { return "qr" }
        if has("sku", "code", "tag", "itemno", "productid") || v == "id" { return "sku" }
        if has("stonewt", "stoneweight") { return "stoneWeight" }
        if has("diamond") { return "diamonds" }
        if has("stone", "gem") { return "stones" }
        if has("weight", "wt", "gram", "gms") { return v.hasSuffix("num") || v.hasSuffix("number") ? "weightNumber" : "weight" }
        if has("price", "amount", "pkr", "rate", "mrp", "cost") { return v.hasSuffix("num") || v.hasSuffix("number") ? "priceNumber" : "price" }
        if has("karat", "carat", "purity") || v == "kt" || v == "k" { return "karat" }
        if has("metal", "material") { return "metal" }
        if has("category", "type", "collection") { return "category" }
        if has("size") { return "size" }
        if has("plating", "finish", "polish") { return "plating" }
        if has("shop", "brand", "store", "company") { return "shop" }
        if has("date", "day") { return "date" }
        if has("name", "title", "design", "item", "product", "description") { return "name" }
        return ""
    }

    /// A config from a pasted Integrate link, each variable paired with its likely field.
    public static func configFromIntegrate(_ p: LabelLiveIntegrate, previous: LabelLiveConfig? = nil) -> LabelLiveConfig {
        var map = LabelLiveMap()
        for v in p.variables { map[v] = previous?.map[v] ?? guessField(v) }
        return LabelLiveConfig(design: p.design, printer: p.printer, copies: p.copies, map: map, hideWindow: previous?.hideWindow ?? true)
    }

    // MARK: Making the print link

    /// Tag n of a design that holds several: the `_<n>` its variables end with, when they end with at least
    /// two different numbers (one `_2` alone is just a name). 0 for a variable shared by the whole label.
    public static func tagsOf(_ config: LabelLiveConfig) -> LabelTags {
        func num(_ name: String) -> Int { tagSuffix(name)?.number ?? 0 }
        let seen = Set(config.map.names.map(num).filter { $0 > 0 })
        if seen.count < 2 { return LabelTags(count: 1, tagOf: { _ in 0 }) }
        return LabelTags(count: min(12, seen.max() ?? 1), tagOf: num)
    }

    /// A value for the link: one line, and "&" as "and" (Label LIVE splits its options at "&"; a tag never needs it).
    private static func oneLine(_ v: String) -> String {
        var out = String.UnicodeScalarView()
        let s = Array(v.unicodeScalars)
        var i = 0
        while i < s.count {
            if s[i] == "\r", i + 1 < s.count, s[i + 1] == "\n" { out.append(" "); i += 2 }
            else if s[i] == "\n" { out.append(" "); i += 1 }
            else if s[i] == "&" { out.append(contentsOf: "and".unicodeScalars); i += 1 }
            else { out.append(s[i]); i += 1 }
        }
        return String(out)
    }

    /// One label's variables, filled from its pieces (as many as the design has tags), as the JSON object
    /// Label LIVE's Integrate link carries: `{"SKU_1":"RIN-000069","SKU_2":""}`. A paired variable takes its
    /// piece's field; a tag with no piece is sent blank, every variable of it, so the design's sample text
    /// never prints; anything else is left as the design has it.
    public static func variablesFor(_ config: LabelLiveConfig, _ pieces: [LabelValues]) -> String {
        jsonObject(variablesObject(config, pieces))
    }

    public static func variablesFor(_ config: LabelLiveConfig, _ piece: LabelValues) -> String {
        variablesFor(config, [piece])
    }

    private static func variablesObject(_ config: LabelLiveConfig, _ group: [LabelValues]) -> [(String, String)] {
        let tagOf = tagsOf(config).tagOf
        var out: [(String, String)] = []
        for v in config.map.vars {
            let tag = tagOf(v.name)
            let at = max(0, tag - 1)
            if at >= group.count { out.append((v.name, "")) }
            else if !v.field.isEmpty { out.append((v.name, oneLine(group[at][v.field] ?? ""))) }
        }
        return out
    }

    /// The pieces in labels: one per label, or two (or more) to a label for a design that holds that many.
    public static func labelsOf<T>(_ config: LabelLiveConfig, _ pieces: [T]) -> [[T]] {
        let count = tagsOf(config).count
        return stride(from: 0, to: pieces.count, by: count).map { Array(pieces[$0..<min($0 + count, pieces.count)]) }
    }

    /// One label, or several as a list (`variables=[{…},{…}]`, Label LIVE's own way to print many labels of
    /// one design on one printer) → `labellive://print?…`.
    public static func printURL(_ config: LabelLiveConfig, _ pieces: [LabelValues], copies: Int? = nil) -> String {
        let labels = labelsOf(config, pieces)
        let variables = labels.count > 1
            ? "[" + labels.map { jsonObject(variablesObject(config, $0)) }.joined(separator: ",") + "]"
            : variablesFor(config, pieces)
        var q = [
            "design=\(encodeURIComponent(config.design))",
            "variables=\(encodeURIComponent(variables))",
        ]
        if !config.printer.isEmpty { q.append("printer=\(encodeURIComponent(config.printer))") }
        q.append("copies=\(clampCopies(copies ?? config.copies))")
        q.append("window=\(config.hideWindow ? "hide" : "show")")
        q.append("ignoreWarnings=true")
        return "labellive://print?\(q.joined(separator: "&"))"
    }

    public static func printURL(_ config: LabelLiveConfig, _ piece: LabelValues, copies: Int? = nil) -> String {
        printURL(config, [piece], copies: copies)
    }

    /// `Math.max(1, Math.min(99, Math.round(copies) || 1))`.
    private static func clampCopies(_ copies: Int) -> Int { max(1, min(99, copies)) }

    /// Several pieces → one `labellive://batch?payload=…`. Not used to print: Label LIVE 4.3.3 reads the
    /// payload without undoing the link's percent-encoding, so an encoded "+", "/" or "=" breaks it
    /// ("… is not valid JSON", 2026-10-23). `labelLiveURL` sends a list of labels in one print link instead.
    /// Each job has the design, its variables, printer and copies.
    public static func batchURL(_ config: LabelLiveConfig, _ pieces: [LabelValues], copies: Int? = nil) -> String {
        let jobs = labelsOf(config, pieces).map { group -> String in
            var fields: [(String, String)] = [("design", config.design), ("variables", variablesFor(config, group))]
            if !config.printer.isEmpty { fields.append(("printer", config.printer)) }
            fields.append(("copies", String(clampCopies(copies ?? config.copies))))
            fields.append(("window", config.hideWindow ? "hide" : "show"))
            fields.append(("ignoreWarnings", "true"))
            return jsonObject(fields)
        }
        let json = "[" + jobs.joined(separator: ",") + "]"
        return "labellive://batch?payload=\(encodeURIComponent(Data(json.utf8).base64EncodedString()))"
    }

    /// The link for any number of pieces: one print link, a list of labels when there are several.
    public static func labelLiveURL(_ config: LabelLiveConfig, _ pieces: [LabelValues], copies: Int? = nil) -> String {
        printURL(config, pieces, copies: copies)
    }

    // MARK: As the settings keep it

    public static func toStored(_ c: LabelLiveConfig) -> StoredLabelLive {
        StoredLabelLive(design: JS.trim(c.design), printer: JS.trim(c.printer), copies: Double(c.copies), hideWindow: c.hideWindow, vars: c.map.vars)
    }

    /// A saved config, checked: anything odd is dropped rather than printed wrong. `input` is a settings
    /// value as JSON gave it (a dictionary); a legacy `map` object has no order after JSON, so its names
    /// are taken alphabetically (the settings keep `vars`, a list).
    public static func clean(_ input: Any?) -> LabelLiveConfig? {
        guard let o = input as? [String: Any] else { return nil }
        let design = capped(JS.trim((o["design"] as? String) ?? ""), 120)
        if design.isEmpty { return nil }
        var map = LabelLiveMap()
        var pairs: [(String, Any?)] = []
        if let vars = o["vars"] as? [Any] {
            pairs = vars.map { v in
                guard let d = v as? [String: Any] else { return ("", nil) }
                return (text(d["name"]), d["field"])
            }
        } else if let legacy = o["map"] as? [String: Any] {
            pairs = legacy.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
        }
        for (k, v) in pairs.prefix(120) {
            if k.isEmpty || k.utf16.count > 60 { continue }
            if let f = v as? String, fieldKeys.contains(f) { map[k] = f } else { map[k] = "" }
        }
        return LabelLiveConfig(
            design: design,
            printer: capped(JS.trim((o["printer"] as? String) ?? ""), 200),
            copies: copiesFrom(LabelCSV.jsNumber(o["copies"])),
            map: map,
            hideWindow: (o["hideWindow"] as? Bool) != false
        )
    }

    /// A saved config as `Settings.labelLive` decodes it.
    public static func clean(_ stored: StoredLabelLive?) -> LabelLiveConfig? {
        guard let s = stored else { return nil }
        return clean([
            "design": s.design, "printer": s.printer, "copies": s.copies, "hideWindow": s.hideWindow,
            "vars": s.vars.map { ["name": $0.name, "field": $0.field] },
        ] as [String: Any])
    }

    /// `String(v ?? '')` for a name read from a document.
    private static func text(_ v: Any?) -> String {
        switch v {
        case let s as String: return s
        case let b as Bool: return b ? "true" : "false"
        case let d as Double: return JS.number(d)
        case let i as Int: return String(i)
        default: return ""
        }
    }

    /// `s.slice(0, n)` (n UTF-16 units).
    private static func capped(_ s: String, _ n: Int) -> String {
        s.utf16.count <= n ? s : String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self)
    }

    // MARK: A piece's values (label-live-values.ts)

    /// A piece's values for a Label LIVE tag: its price at today's rates the way the tag CSV has always
    /// worked it out, in whole rupees.
    public static func valuesFor(_ p: Product, _ settings: Settings, today: Date = Date()) -> LabelValues {
        let costs = calculateProductCosts(PricedPiece(p), PricingRates(settings).flatPalladiumOnly)
        let price = p.isCustomPrice && JS.truthy(p.customPrice) ? p.customPrice! : costs.totalPrice
        let karat = p.karat?.rawValue ?? ""
        func rs(_ n: Double) -> String { "Rs \(Money.grouped(JS.round(n)))" }
        func grams(_ n: Double) -> String { n.isFinite ? JS.toFixed(n, 3) : "" }
        func cap(_ s: String) -> String { s.isEmpty ? "" : s.prefix(1).uppercased() + s.dropFirst() }
        var out: LabelValues = [
            "sku": p.sku,
            "name": p.name,
            "price": rs(price),
            "priceNumber": JS.number(JS.round(price)),
            "weight": "\(grams(p.metalWeightG)) g",
            "weightNumber": grams(p.metalWeightG),
            "metal": [cap(p.metalType.rawValue), karat].filter { !$0.isEmpty }.joined(separator: " "),
            "karat": karat,
            "category": categoryTitle(p.categoryId) ?? p.categoryId,
            "stones": p.stoneDetails ?? "",
            "stoneWeight": p.hasStones ? grams(p.stoneWeightG) : "",
            "diamonds": p.diamondDetails ?? "",
            "size": p.size ?? "",
            "plating": p.platingType ?? "",
            "shop": settings.shopName,
            "qr": p.sku,
            "date": dateText(today),
        ]
        // A design built on the tag CSV reads its columns as the file writes them.
        for (k, v) in LabelCSV.values(p, settings) { out["csv:\(k)"] = v }
        return out
    }

    /// en-GB `{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }`: "24 Oct 2026".
    private static func dateText(_ d: Date) -> String {
        let parts = ERPDate.karachiCalendar.dateComponents([.year, .month, .day], from: d)
        return "\(parts.day ?? 1) \(JS.shortMonths[(parts.month ?? 1) - 1]) \(parts.year ?? 0)"
    }

    // MARK: JavaScript's own text rules

    /// `encodeURIComponent`: everything but A–Z a–z 0–9 - _ . ! ~ * ' ( ) as UTF-8 percent bytes (upper-case hex).
    public static func encodeURIComponent(_ s: String) -> String {
        let keep = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()".utf8)
        let hex = Array("0123456789ABCDEF")
        var out = ""
        for b in s.utf8 {
            if keep.contains(b) { out.unicodeScalars.append(Unicode.Scalar(b)) }
            else { out.append("%"); out.append(hex[Int(b >> 4)]); out.append(hex[Int(b & 15)]) }
        }
        return out
    }

    /// `decodeURIComponent`; nil where JavaScript throws (a "%" not followed by two hex digits, or bytes that are not UTF-8).
    public static func decodeURIComponent(_ s: String) -> String? {
        let b = Array(s.utf8)
        var out: [UInt8] = []
        var i = 0
        func hexValue(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: return c - 48
            case 65...70: return c - 55
            case 97...102: return c - 87
            default: return nil
            }
        }
        while i < b.count {
            if b[i] == 0x25 {
                guard i + 2 < b.count, let hi = hexValue(b[i + 1]), let lo = hexValue(b[i + 2]) else { return nil }
                out.append(hi << 4 | lo)
                i += 3
            } else {
                out.append(b[i])
                i += 1
            }
        }
        return String(validatingUTF8: out.map { CChar(bitPattern: $0) } + [0])
    }

    /// `JSON.stringify` of one string.
    static func jsonString(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 {
                    let h = String(u.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - h.count) + h
                } else { out.unicodeScalars.append(u) }
            }
        }
        return out + "\""
    }

    /// `JSON.stringify` of an object of strings, keys in the order given.
    static func jsonObject(_ pairs: [(String, String)]) -> String {
        "{" + pairs.map { "\(jsonString($0.0)):\(jsonString($0.1))" }.joined(separator: ",") + "}"
    }

    private static func isLineTerminator(_ u: Unicode.Scalar) -> Bool {
        u == "\n" || u == "\r" || u == "\u{2028}" || u == "\u{2029}"
    }

    /// A trailing `_<n>` (one or two digits) and what comes before it: `/_(\d{1,2})$/`.
    private static func tagSuffix(_ name: String) -> (prefix: String, number: Int)? {
        let s = Array(name.unicodeScalars)
        func digit(_ u: Unicode.Scalar) -> Bool { u.value >= 48 && u.value <= 57 }
        for k in 1...2 where s.count >= k + 1 {
            let tail = s[(s.count - k)...]
            if s[s.count - k - 1] == "_", tail.allSatisfy(digit) {
                return (String(String.UnicodeScalarView(s[..<(s.count - k - 1)])), Int(String(String.UnicodeScalarView(tail))) ?? 0)
            }
        }
        return nil
    }
}
