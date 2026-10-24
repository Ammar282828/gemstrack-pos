// The words the tag designer offers for a field's data: the piece's fields and the Tag CSV's columns as `{placeholders}`
// (`_1`, `_2` for a double tag), the date, the time and the counter, and the transforms after a pipe. The rules of how
// Zpl.swift fills them are there; this only writes the tokens. Sample values are made up, for a design with no piece.

import Foundation

public struct LabelChip: Hashable, Identifiable {
    public let token: String
    public let label: String
    public let group: String
    public var id: String { token }
}

public enum LabelPlaceholders {
    /// `{sku}` for one tag; `{sku_1}`, `{sku_2}` … for a label of several.
    public static func tokens(key: String, tags: Int) -> [String] {
        let name = key.hasPrefix("csv:") ? String(key.dropFirst(4)) : key
        if tags <= 1 { return ["{\(name)}"] }
        return (1...min(12, tags)).map { "{\(name)_\($0)}" }
    }

    public static func pieceChips(tags: Int) -> [LabelChip] {
        LabelLive.labelFields.flatMap { f in
            tokens(key: f.key, tags: tags).enumerated().map { i, t in
                LabelChip(token: t, label: tags > 1 ? "\(f.label) (tag \(i + 1))" : f.label, group: "Piece")
            }
        }
    }

    public static func csvChips(tags: Int) -> [LabelChip] {
        LabelCSV.baseHeaders.flatMap { h in
            tokens(key: "csv:\(h)", tags: tags).enumerated().map { i, t in
                LabelChip(token: t, label: tags > 1 ? "\(h) (tag \(i + 1))" : h, group: "Tag CSV")
            }
        }
    }

    /// Date, time and counter.
    public static let specials: [LabelChip] = [
        LabelChip(token: "{date}", label: "Today’s date", group: "Date and counter"),
        LabelChip(token: "{date:dd/MM/yyyy}", label: "Date 24/10/2026", group: "Date and counter"),
        LabelChip(token: "{time}", label: "Time", group: "Date and counter"),
        LabelChip(token: "{counter:1:1:4}", label: "Counter 0001, 0002…", group: "Date and counter"),
    ]

    /// What can follow a pipe, and what it does.
    public static let transforms: [(token: String, help: String)] = [
        ("|prefix:Rs ", "Put words before the value (nothing if it is empty)"),
        ("|suffix:/-", "Put words after the value"),
        ("|upper", "CAPITALS"),
        ("|lower", "small letters"),
        ("|fixed:2", "Always 2 decimal places"),
        ("|group", "12500 becomes 12,500"),
        ("|max:18", "Cut to 18 letters"),
    ]

    public static let help: [String] = [
        "{sku} puts the piece’s SKU; {sku_2} the second tag’s.",
        "{price|prefix:Rs |suffix:/-} adds words round a value.",
        "{date:d MMM yyyy} and {time:HH:mm} use letters: yyyy MM dd HH mm ss, MMMM, EEEE.",
        "{counter:START:STEP:PAD} counts up a label at a time: {counter:1:1:4} gives 0001, 0002.",
        "A word in braces the designer does not know prints as typed, so a typo shows.",
    ]

    /// The placeholders a text holds (`{…}` with no new line or brace inside), in order.
    public static func tokens(in text: String) -> [String] {
        var out: [String] = []
        var current: String?
        for ch in text {
            if ch == "{" { current = "{" }
            else if ch == "}", var c = current { c.append("}"); out.append(c); current = nil }
            else if ch == "\n" { current = nil }
            else if current != nil { current!.append(ch) }
        }
        return out
    }

    /// The text with a token added at the end.
    public static func appending(_ token: String, to text: String) -> String { text + token }

    // MARK: Samples

    /// Made-up values for piece `n` of a label, every key a design can read; nothing here is a shop's.
    public static func sampleValues(piece n: Int) -> LabelValues {
        let suffix = String(format: "%04d", n)
        var v: LabelValues = [
            "sku": "SAMPLE-\(suffix)", "name": "Sample piece \(n)", "price": "Rs 12,500", "priceNumber": "12500",
            "weight": "4.250 g", "weightNumber": "4.250", "metal": "Silver 925", "karat": "925", "category": "Rings",
            "stones": "Sample stones", "stoneWeight": "0.300", "diamonds": "", "size": "7", "plating": "Rhodium",
            "shop": "Sample shop", "qr": "SAMPLE-\(suffix)", "date": "24 Oct 2026",
        ]
        let csv: [String: String] = [
            "sku": "SAMPLE-\(suffix)", "product_name": "Sample piece \(n)", "category_id": "rings", "shop_name": "Sample shop",
            "total_price_pkr": "12500", "metal_type": "silver", "metal_weight_g": "4.250", "karat": "925",
            "stone_weight_g": "0.300", "stone_details": "Sample stones", "stone_charges": "300", "making_charges": "1200",
            "qr_content": "SAMPLE-\(suffix)",
        ]
        for h in LabelCSV.baseHeaders { v["csv:\(h)"] = csv[h] ?? "" }
        return v
    }
}
