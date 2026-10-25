import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
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

    /// "/products/RNG-0001": the piece page.
    static func piecePath(_ sku: String) -> String { "/products/" + encode(sku) }

    /// The product form for a piece (StockPieceForm), photo and all. "?web=1" after it is the ERP's own form.
    static func editPath(_ sku: String) -> String { "/products/" + encode(sku) + "/edit" }

    /// "/products/<sku>/edit" → the SKU, decoded (src/app/products/[sku]/edit). Nil for any other path.
    static func editSku(fromPath path: String) -> String? {
        let bare = ScreenRoute.bare(path)
        guard bare.hasPrefix("/products/"), bare.hasSuffix("/edit") else { return nil }
        let middle = bare.dropFirst("/products/".count)
        guard middle.count > "/edit".count else { return nil }
        let sku = String(middle.dropLast("/edit".count))
        guard !sku.isEmpty, !sku.contains("/") else { return nil }
        return sku.removingPercentEncoding ?? sku
    }

    /// "/products/add?voice=1": a new piece the voice assistant filled in (StockVoiceSeed), as the ERP's page takes it.
    static func fromVoice(_ path: String) -> Bool {
        URLComponents(string: path)?.queryItems?.contains { $0.name == "voice" && $0.value == "1" } ?? false
    }

    static let addPath = "/products/add"
    static let bulkAddPath = "/products/bulk-add"
    /// Where Sell goes: the sale in progress, which the piece was just put on (it does not open blank).
    static let newSalePath = "/invoices/new?resume=1"

    /// Pages under /products/ that are not a piece: the forms (adding one, adding many).
    static let ownPages: Set<String> = [addPath, bulkAddPath]

    /// A title for an ERP page opened from here (a native screen names itself; a web page does not).
    static func title(forPath path: String) -> String {
        let bare = ScreenRoute.bare(path)
        if bare == "/invoices/new" { return "New sale" }
        if bare == addPath { return "Add piece" }
        if bare.hasSuffix("/edit") { return "Edit piece" }
        let last = bare.split(separator: "/").last.map(String.init) ?? ""
        return last.removingPercentEncoding ?? last
    }

    // MARK: Deleting a piece

    /// The store's words for it, as its delete-code dialog says them (lib/writes/product-delete.ts `deleteProductWhat`).
    static func deleteWhat(_ p: Product) -> String { "Delete product \(p.name.isEmpty ? p.sku : p.name)" }

    /// A piece's Delete, the piece page's and the list's: the code asked in the owners' sheet, then the ERP's
    /// `deleteProduct` (ops-stock3.ts), which checks it. Gone for good, as the web says: stock has no Recently removed.
    @MainActor
    static func deletion(_ p: Product, then done: @escaping () -> Void = {}) -> OwnerDeletion {
        let name = p.name.isEmpty ? p.sku : "\(p.name) (\(p.sku))"
        return OwnerDeletion(what: deleteWhat(p), detail: "This will permanently delete \(name) from stock.") { code in
            _ = try await ERPAPI.shared.write("deleteProduct", ["sku": p.sku, "deleteCode": code])
            done()
        }
    }

    // MARK: Categories

    struct Category: Identifiable, Hashable {
        let id: String
        let title: String
    }

    /// categories.ts staticCategories: the ids and the list names (plural) as the ERP has them.
    static let categories: [Category] = staticCategories.map { Category(id: $0.id, title: $0.title) }

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
            // Drawn at the size it is shown, from the phone's memory once seen (AsyncImage kept nothing and decoded
            // every photo whole on the main thread: lists of pieces stuttered as they scrolled).
            GeometryReader { geo in
                StockRemoteImage(url: url, name: name, maxPixel: StockRemoteImage.pixels(for: geo.size))
            }
        } else {
            StockInitial(name: name)
        }
    }
}

/// A photo at a web address, shrunk to `maxPixel` on its long side as it is decoded (ImageIO, off the main thread)
/// and kept in memory for the next time its row scrolls by; one download per address however many rows show it.
struct StockRemoteImage: View {
    let url: URL
    let name: String
    let maxPixel: Int
    @State private var image: UIImage?
    @State private var failed = false

    /// The frame's long side in pixels, rounded up to a step so nearby sizes share one decoded copy.
    static func pixels(for size: CGSize) -> Int {
        let points = max(size.width, size.height, 1) * 3
        return min(2400, max(160, Int((points / 160).rounded(.up)) * 160))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if failed {
                StockInitial(name: name)
            } else {
                SkeletonLoading()
            }
        }
        .task(id: "\(url.absoluteString)#\(maxPixel)") {
            if let hit = RemoteImageStore.shared.cached(url, maxPixel: maxPixel) { image = hit; return }
            if let got = await RemoteImageStore.shared.image(url, maxPixel: maxPixel) { image = got } else { failed = true }
        }
    }
}

/// The photos the lists show: decoded copies in memory (NSCache, let go under memory pressure), the downloads in a
/// 200 MB disk cache, and one download at a time per address.
@MainActor
final class RemoteImageStore {
    static let shared = RemoteImageStore()
    private let memory: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 120 * 1024 * 1024
        return c
    }()
    private var loading: [URL: Task<Data?, Never>] = [:]
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 200 * 1024 * 1024)
        c.requestCachePolicy = .returnCacheDataElseLoad
        c.httpCookieAcceptPolicy = .never
        return URLSession(configuration: c)
    }()

    private func key(_ url: URL, _ px: Int) -> NSString { "\(url.absoluteString)#\(px)" as NSString }

    func cached(_ url: URL, maxPixel: Int) -> UIImage? { memory.object(forKey: key(url, maxPixel)) }

    func image(_ url: URL, maxPixel: Int) async -> UIImage? {
        if let hit = cached(url, maxPixel: maxPixel) { return hit }
        let task: Task<Data?, Never>
        if let running = loading[url] { task = running } else {
            let s = session
            task = Task.detached(priority: .userInitiated) { () -> Data? in
                guard let (data, response) = try? await s.data(from: url),
                      ((response as? HTTPURLResponse)?.statusCode ?? 200) < 400 else { return nil }
                return data
            }
            loading[url] = task
        }
        let data = await task.value
        loading[url] = nil
        guard let data else { return nil }
        let px = maxPixel
        let decoded: UIImage? = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: px,
            ]
            guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            return UIImage(cgImage: cg)
        }.value
        if let decoded {
            memory.setObject(decoded, forKey: key(url, maxPixel), cost: Int(decoded.size.width * decoded.size.height * 4))
        }
        return decoded
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
                SkeletonLoading()
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

// MARK: The voice assistant's new piece

/// What was said for a new piece (lib/voice/commands.ts `new_piece`, a `Partial<Product>`), handed over by the
/// voice sheet (NativeVoiceHandoff) for the one form that opens on "/products/add?voice=1". The web keeps it in
/// sessionStorage for five minutes and its page takes it once (lib/voice/handoff.ts); here the form reads it as
/// it opens and lets it go once shown. Kept for the business it was said in, so a switch never fills the next one.
@MainActor
enum StockVoiceSeed {
    private static var held: (business: String, at: Date, piece: [String: Any])?

    static func put(_ piece: [String: Any], now: Date = Date()) { held = (business: House.id, at: now, piece: piece) }

    /// The piece said, if it was said in this business in the last five minutes.
    static func peek(now: Date = Date()) -> [String: Any]? {
        guard let held, held.business == House.id, now.timeIntervalSince(held.at) < 5 * 60 else { return nil }
        return held.piece
    }

    static func clear() { held = nil }
}

// MARK: Opening the ERP's own pages

extension View {
    /// Pushes a place when `go` is set: the sale, the product form, or an ERP page.
    func stockDestination(_ go: Binding<Route?>) -> some View {
        navigationDestination(item: go) { (r: Route) in
            StockDestination(path: r.path)
        }
    }
}

/// A native screen names itself and sits on the house's ground, as a tab's places do (RootView's
/// PlaceScreen); an ERP page has no title of its own here, so one is given.
private struct StockDestination: View {
    let path: String

    var body: some View {
        if ScreenRegistry.hasNative(path) {
            ScreenRegistry.view(for: path)
                .modifier(HouseGround())
        } else {
            ScreenRegistry.view(for: path)
                .navigationTitle(StockKit.title(forPath: path))
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
