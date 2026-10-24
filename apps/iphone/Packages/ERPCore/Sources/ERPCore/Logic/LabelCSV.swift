// Ported from src/lib/label-csv.ts (tests: LabelCSVTests, label-csv.test.ts).
//
// The tag printer's CSV: pieces in pairs, a left and a right tag to a row. The text only. What the
// browser's `generateProductCsv` (lib/csv.ts) puts in the download is this plus the byte-order mark,
// and `LabelLive` (the Label LIVE link) reads the same column values, so a design built on the file is
// filled exactly as an import of the file would fill it.
//
// A piece's price is worked out at the shop's rates by `calculateProductCosts` (Pricing.swift) with the
// flat palladium rate only, as the TS passes the shop's rates (the per-karat palladium rates stay out).

import Foundation

public enum LabelCSV {
    /// One tag's columns, in order; the file has each twice, `_1` for the left tag and `_2` for the right.
    /// (TS `BASE_HEADERS`.)
    public static let baseHeaders: [String] = [
        // Primary Details
        "sku", "product_name", "category_id", "shop_name", "image_url",
        // Pricing
        "total_price_pkr", "is_custom_price", "custom_price",
        // Primary Metal
        "metal_type", "metal_weight_g", "karat",
        // Secondary Metal
        "secondary_metal_type", "secondary_metal_weight_g", "secondary_karat",
        // Stones & Diamonds
        "has_stones", "stone_weight_g", "has_diamonds", "stone_details", "diamond_details",
        // Charges
        "making_charges", "diamond_charges", "stone_charges", "misc_charges", "wastage_percentage",
        // QR
        "qr_content",
    ]

    /// The file's name as the browser downloads it: `gemstrack_double_tag_export_2026-10-09-08-30-00.csv` (UTC).
    public static func fileName(_ now: Date = Date()) -> String {
        let stamp = String(ERPDate.iso(now).prefix(19)).map { $0 == ":" || $0 == "T" ? "-" : String($0) }.joined()
        return "gemstrack_double_tag_export_\(stamp).csv"
    }

    /// The CSV for these pieces at the shop's rates, without the byte-order mark the download puts in front.
    public static func productCsv(_ products: [Product], _ settings: Settings) -> String {
        let headers = baseHeaders.map { "\($0)_1" } + baseHeaders.map { "\($0)_2" }

        func formatField(_ value: String) -> String {
            value.contains(",") || value.contains("\"") || value.contains("\n")
                ? "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : value
        }
        func dataOf(_ product: Product?) -> [String] {
            let raw = values(product, settings)
            return baseHeaders.map { formatField(raw[$0] ?? "") }
        }

        var rows: [String] = []
        // Two pieces to a row; an odd last piece leaves the right tag empty.
        var i = 0
        while i < products.count {
            let left = dataOf(products[i])
            let right = dataOf(i + 1 < products.count ? products[i + 1] : nil)
            rows.append((left + right).joined(separator: ","))
            i += 2
        }
        return ([headers.joined(separator: ",")] + rows).joined(separator: "\n")
    }

    /// One tag's values as the CSV has them, unquoted: what a label design built on this file (House of
    /// Mina's "minalabel" in Label LIVE) reads. No piece (the right tag of an odd last row): every column
    /// empty. (TS `labelCsvValues`.)
    public static func values(_ product: Product?, _ settings: Settings) -> [String: String] {
        guard let product else { return Dictionary(uniqueKeysWithValues: baseHeaders.map { ($0, "") }) }
        let costs = calculateProductCosts(PricedPiece(product), PricingRates(settings).flatPalladiumOnly)
        func whole(_ x: Double) -> String { JS.number(JS.round(x)) }
        return [
            "sku": product.sku,
            "product_name": product.name,
            "category_id": product.categoryId,
            "shop_name": settings.shopName,
            "image_url": product.imageUrl ?? "",
            "total_price_pkr": whole(costs.totalPrice),
            "is_custom_price": product.isCustomPrice ? "TRUE" : "FALSE",
            "custom_price": product.customPrice.map(whole) ?? "0",
            "metal_type": product.metalType.rawValue,
            "metal_weight_g": JS.toFixed(product.metalWeightG, 3),
            "karat": product.karat?.rawValue ?? "",
            "secondary_metal_type": product.secondaryMetalType?.rawValue ?? "",
            "secondary_metal_weight_g": product.secondaryMetalWeightG.map { JS.toFixed($0, 3) } ?? "0",
            "secondary_karat": product.secondaryMetalKarat?.rawValue ?? "",
            "has_stones": product.hasStones ? "TRUE" : "FALSE",
            "stone_weight_g": JS.toFixed(product.stoneWeightG, 3),
            "has_diamonds": product.hasDiamonds ? "TRUE" : "FALSE",
            "stone_details": product.stoneDetails ?? "",
            "diamond_details": product.diamondDetails ?? "",
            "making_charges": whole(product.makingCharges),
            "diamond_charges": whole(product.diamondCharges),
            "stone_charges": whole(product.stoneCharges),
            "misc_charges": whole(product.miscCharges),
            "wastage_percentage": JS.toFixed(product.wastagePercentage, 2),
            "qr_content": product.sku,
        ]
    }

    /// A piece as Firestore holds it, made safe for the CSV: the SKU from the document's id when the field
    /// is missing (an update strips it), and the figures the CSV prints with toFixed as numbers (an old
    /// import keeps some as text, and a missing one would stop the whole file). `Product` decodes
    /// leniently ("1,000" would read as 1000), so the figures are settled here first, as `Number(v)` does.
    public static func pieceForCsv(_ sku: String, _ doc: [String: Any]) -> Product {
        func num(_ v: Any?) -> Double { let n = jsNumber(v); return n.isFinite ? n : 0 }
        func opt(_ v: Any?) -> Double? {
            if v == nil || v is NSNull { return nil }
            if let s = v as? String, s.isEmpty { return nil }
            return num(v)
        }
        var out = doc
        if let own = doc["sku"] as? String, !own.isEmpty { out["sku"] = own } else { out["sku"] = sku }
        for key in ["metalWeightG", "stoneWeightG", "makingCharges", "diamondCharges", "stoneCharges", "miscCharges", "wastagePercentage"] {
            out[key] = num(doc[key])
        }
        for key in ["customPrice", "secondaryMetalWeightG"] {
            if let n = opt(doc[key]) { out[key] = n } else { out.removeValue(forKey: key) }
        }
        return ERPDecode.model(Product.self, from: out) ?? ERPDecode.model(Product.self, from: ["sku": out["sku"] ?? sku])!
    }

    /// `Number(v)` for a value read from a document.
    static func jsNumber(_ v: Any?) -> Double {
        switch v {
        case nil: return .nan
        case is NSNull: return 0
        case let b as Bool: return b ? 1 : 0
        case let d as Double: return d
        case let i as Int: return Double(i)
        case let n as NSNumber: return n.doubleValue
        case let s as String: return JS.toNumber(s)
        default: return .nan
        }
    }
}
