import SwiftUI
import UIKit
import ImageIO
import ERPCore

/// What the Stock list and the piece page say the same way: where a piece lives, its category's
/// name, how its metal and weight read, and what it sells for at today's rates. The price is
/// ERPCore's (`calculateProductCosts`, the ERP's lib/pricing.ts); what is here is only what
/// src/app/products/page.tsx and products/[sku]/page.tsx work out for themselves.
enum StockKit {

    // MARK: Paths

    /// One part of a path: a SKU with a "/" or "?" in it must not split the address.
    static func encode(_ part: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        return part.addingPercentEncoding(withAllowedCharacters: allowed) ?? part
    }

    /// "/products/RNG-0001": the piece page. `web` asks for the ERP's own page (its QR and CSV for
    /// the label printer, and Delete, which asks for the delete code there).
    static func piecePath(_ sku: String, web: Bool = false) -> String {
        "/products/" + encode(sku) + (web ? "?web=1" : "")
    }

    /// The ERP serves the edit form at its own address; it has no native screen, so it falls through.
    static func editPath(_ sku: String) -> String { "/products/" + encode(sku) + "/edit" }

    static let addPath = "/products/add"
    static let bulkAddPath = "/products/bulk-add"
    static let newSalePath = "/invoices/new"

    /// Pages under /products/ that are not a piece: the ERP's own forms.
    static let ownPages: Set<String> = [addPath, bulkAddPath]

    /// A title for an ERP page opened from here (a native screen names itself; a web page does not).
    static func title(forPath path: String) -> String {
        let bare = ScreenRoute.bare(path)
        if bare == newSalePath { return "New sale" }
        if bare == addPath { return "Add piece" }
        if bare.hasSuffix("/edit") { return "Edit piece" }
        let last = bare.split(separator: "/").last.map(String.init) ?? ""
        return last.removingPercentEncoding ?? last
    }

    // MARK: Categories

    struct Category: Identifiable, Hashable {
        let id: String
        let title: String
    }

    // TODO(logic): port staticCategories (src/lib/categories.ts). Ids and the list names (plural) as the ERP has them.
    static let categories: [Category] = [
        Category(id: "cat001", title: "Rings"),
        Category(id: "cat002", title: "Tops"),
        Category(id: "cat003", title: "Balis"),
        Category(id: "cat004", title: "Lockets"),
        Category(id: "cat005", title: "Bracelets"),
        Category(id: "cat006", title: "Bracelet and Ring Set"),
        Category(id: "cat007", title: "Bangles"),
        Category(id: "cat008", title: "Chains"),
        Category(id: "cat009", title: "Bands"),
        Category(id: "cat010", title: "Locket Sets without Bangle"),
        Category(id: "cat011", title: "Locket Set with Bangle"),
        Category(id: "cat012", title: "String Sets"),
        Category(id: "cat013", title: "Stone Necklace Sets without Bracelets"),
        Category(id: "cat014", title: "Stone Necklace Sets with Bracelets"),
        Category(id: "cat015", title: "Gold Necklace Sets with Bracelets"),
        Category(id: "cat016", title: "Gold Necklace Sets without Bracelets"),
        Category(id: "cat017", title: "Gold Coins"),
        Category(id: "cat018", title: "Men's Rings"),
        Category(id: "cat019", title: "Loose Bracelet"),
        Category(id: "cat020", title: "Men's Buttons"),
    ]

    private static let titleById: [String: String] = {
        var out: [String: String] = [:]
        for c in categories { out[c.id] = c.title }
        return out
    }()

    /// The list name of a piece's category. The web says "Uncategorized" for an id its table lacks;
    /// here a word that is not one of its ids (a hand-typed category) is shown as it was written.
    static func categoryTitle(_ id: String) -> String {
        if let t = titleById[id] { return t }
        return id.isEmpty ? "Uncategorized" : id
    }

    /// The categories worth a chip: the ERP's own in its order, then any other id the stock uses,
    /// each only if a piece is in it (the web's select lists all twenty; a row of chips should not).
    /// `keep` stays even when emptied, so a chosen chip does not vanish under the person.
    static func categoryOptions(counts: [String: Int], keep: String?) -> [Category] {
        var out: [Category] = categories.filter { (counts[$0.id] ?? 0) > 0 || $0.id == keep }
        let known = Set(categories.map { $0.id })
        let extras = counts.keys.filter { !known.contains($0) && !$0.isEmpty }.sorted()
        for id in extras { out.append(Category(id: id, title: id)) }
        if (counts[""] ?? 0) > 0 || keep == "" { out.append(Category(id: "", title: "Uncategorized")) }
        return out
    }

    // MARK: Reading a piece

    /// products/page.tsx `getMetalLabel`: "Gold 21K" for gold with a karat, else the metal's word.
    static func metalLine(_ p: Product) -> String {
        let raw = p.metalType.rawValue
        let metal = raw.prefix(1).uppercased() + raw.dropFirst()
        if p.metalType == .gold, let k = p.karat, !k.rawValue.isEmpty { return "\(metal) \(k.rawValue.uppercased())" }
        return metal
    }

    private static let numberFormat: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 3
        return f
    }()

    /// A weight the way the page prints it: "3.4g", "14.25g", "10g".
    static func grams(_ g: Double) -> String {
        (numberFormat.string(from: NSNumber(value: g)) ?? String(g)) + "g"
    }

    static func percent(_ v: Double) -> String {
        (numberFormat.string(from: NSNumber(value: v)) ?? String(v)) + "%"
    }

    static func filled(_ s: String?) -> String? {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// Search by name or SKU, as the page does.
    static func matches(_ p: Product, _ query: String) -> Bool {
        p.name.localizedCaseInsensitiveContains(query) || p.sku.localizedCaseInsensitiveContains(query)
    }

    // MARK: Price

    /// Today's rates, once the shop's settings have arrived.
    static func rates(_ settings: Settings?) -> PricingRates? {
        guard let settings else { return nil }
        return PricingRates(settings)
    }

    /// What a piece sells for at these rates (the ERP's `calculateProductCosts`, part by part).
    static func costs(_ p: Product, _ rates: PricingRates) -> ProductCosts {
        calculateProductCosts(PricedPiece(p), rates)
    }

    /// The rate the piece is priced from, as the piece page names it (products/[sku]/page.tsx
    /// `getRateForProduct`): nil where the page shows none.
    static func rateLine(_ p: Product, _ s: Settings) -> (label: String, perGram: Double)? {
        switch p.metalType {
        case .gold:
            guard let k = p.karat, !k.rawValue.isEmpty else { return nil }
            let rate: Double
            switch k.rawValue {
            case "24k": rate = s.goldRatePerGram24k
            case "22k": rate = s.goldRatePerGram22k
            case "21k": rate = s.goldRatePerGram21k
            case "18k": rate = s.goldRatePerGram18k
            default: rate = 0
            }
            return ("Gold rate (\(k.rawValue.uppercased()))", rate)
        case .silver:
            if let own = p.silverRatePerGram, own > 0 { return ("This piece's silver rate", own) }
            return ("Silver rate (shop)", s.silverRatePerGram)
        case .palladium:
            return ("Palladium rate", s.palladiumRatePerGram)
        case .platinum:
            return ("Platinum rate", s.platinumRatePerGram)
        case .unknown:
            return nil
        }
    }
}

// MARK: Pictures

/// The first letter of the name on a quiet square: the web's placeholder when a piece has no photo.
struct StockInitial: View {
    let name: String

    var body: some View {
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.title2.weight(.semibold))
            .foregroundStyle(.secondary)
    }
}

/// A piece's photo, filling the frame it is given. A web address loads as it scrolls (AsyncImage).
/// A data address (a photo kept inside the document, which can be megabytes) is skipped in a list
/// (`decodeDataURI` false: the first letter instead) and decoded once, off the main thread, where
/// a single piece is shown.
struct StockImage: View {
    let imageUrl: String?
    let name: String
    /// Names this piece's photo, so a view reused for another piece decodes again.
    let key: String
    var decodeDataURI = false

    var body: some View {
        let source = (imageUrl ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // The photo is an overlay so that filling the square (and spilling over it) never changes the square's size.
        Rectangle()
            .fill(.quaternary)
            .overlay { picture(source) }
            .clipped()
    }

    @ViewBuilder
    private func picture(_ source: String) -> some View {
        if source.hasPrefix("data:") {
            if decodeDataURI {
                StockDataImage(uri: source, key: key, name: name)
            } else {
                StockInitial(name: name)
            }
        } else if source.hasPrefix("http"), let url = URL(string: source) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .failure:
                    StockInitial(name: name)
                default:
                    ProgressView()
                }
            }
        } else {
            StockInitial(name: name)
        }
    }
}

/// A photo kept in the document as "data:image/jpeg;base64,…": decoded and shrunk to the screen
/// off the main thread, and kept for the next visit.
private struct StockDataImage: View {
    let uri: String
    let key: String
    let name: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if failed {
                StockInitial(name: name)
            } else {
                ProgressView()
            }
        }
        .task(id: key) {
            let text: String = uri
            let cacheKey: String = key
            let decoded: UIImage? = await Task.detached(priority: .userInitiated) { () -> UIImage? in
                StockImageDecoder.image(text, key: cacheKey, maxPixel: 1600)
            }.value
            if let decoded {
                image = decoded
            } else {
                failed = true
            }
        }
    }
}

enum StockImageDecoder {
    private static let cache = NSCache<NSString, UIImage>()

    /// The picture inside a base64 data address, no larger than `maxPixel` on its long side
    /// (ImageIO decodes it at that size, so a 12-megapixel photo never sits whole in memory).
    /// Nil for anything that is not base64 image data.
    static func image(_ uri: String, key: String, maxPixel: Int) -> UIImage? {
        let cacheKey = "\(key)#\(uri.utf8.count)" as NSString
        if let hit = cache.object(forKey: cacheKey) { return hit }
        guard let comma = uri.firstIndex(of: ",") else { return nil }
        guard uri[..<comma].contains("base64") else { return nil }
        let payload = String(uri[uri.index(after: comma)...])
        guard let data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters) else { return nil }
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else { return nil }
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary) else { return nil }
        let out = UIImage(cgImage: cg)
        cache.setObject(out, forKey: cacheKey)
        return out
    }
}

// MARK: Opening the ERP's own pages

extension View {
    /// Pushes an ERP page (the sale form, the edit form, a piece's own page with Delete) when `go` is
    /// set. A web page has no title of its own here, so one is given.
    func stockDestination(_ go: Binding<Route?>) -> some View {
        navigationDestination(item: go) { (r: Route) in
            ScreenRegistry.view(for: r.path)
                .navigationTitle(StockKit.title(forPath: r.path))
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
