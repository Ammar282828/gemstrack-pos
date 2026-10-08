import Foundation

/// A piece in stock: Firestore `products/<SKU>`, and the same shape in `sold_products`
/// (src/lib/store.ts `Product`).
/// Surprising: the document id IS the SKU. Documents written by the store carry `sku` as a field
/// too, but an update strips it, so `sku` falls back to the injected `id`; `id` is the SKU.
/// `qrCodeDataUrl` is a whole base64 image kept in the document (heavy: keep it out of lists).
/// A custom-priced piece (`isCustomPrice`) is sold at `customPrice` whatever its weights say.
/// Prices are not stored: they are computed from weights, charges and today's rates
/// (lib/pricing.ts), so a model here carries the ingredients only.
public struct Product: Decodable, Identifiable, Hashable {
    public let sku: String
    public var id: String { sku }
    public let name: String
    public let categoryId: String
    public let metalType: MetalType
    public let karat: KaratValue?
    public let metalWeightG: Double
    public let secondaryMetalType: MetalType?
    public let secondaryMetalKarat: KaratValue?
    public let secondaryMetalWeightG: Double?
    public let hasStones: Bool
    public let stoneWeightG: Double
    public let wastagePercentage: Double
    public let makingCharges: Double
    public let hasDiamonds: Bool
    public let diamondCharges: Double
    public let stoneCharges: Double
    public let miscCharges: Double
    public let qrCodeDataUrl: String?
    public let imageUrl: String?
    public let stoneDetails: String?
    public let diamondDetails: String?
    public let isCustomPrice: Bool
    public let customPrice: Double?
    public let description: String?
    /// Free text ("10 Indian / 5 US").
    public let size: String?
    /// 925 silver only.
    public let platingType: String?
    public let platingNote: String?
    public let nickelFree: Bool
    public let silverRatePerGram: Double?
    public let shopifyProductId: String?
    public let shopifyVariantId: String?

    private enum K: String, CodingKey {
        case id, sku, name, categoryId, metalType, karat, metalWeightG
        case secondaryMetalType, secondaryMetalKarat, secondaryMetalWeightG
        case hasStones, stoneWeightG, wastagePercentage, makingCharges, hasDiamonds
        case diamondCharges, stoneCharges, miscCharges, qrCodeDataUrl, imageUrl, stoneDetails, diamondDetails
        case isCustomPrice, customPrice, description, size, platingType, platingNote, nickelFree
        case silverRatePerGram, shopifyProductId, shopifyVariantId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        sku = c.string(.sku) ?? c.string(.id) ?? ""
        name = c.string(.name, default: "")
        categoryId = c.string(.categoryId, default: "")
        metalType = c.word(.metalType, default: .unknown(""))
        karat = c.word(.karat)
        metalWeightG = c.double(.metalWeightG, default: 0)
        secondaryMetalType = c.word(.secondaryMetalType)
        secondaryMetalKarat = c.word(.secondaryMetalKarat)
        secondaryMetalWeightG = c.double(.secondaryMetalWeightG)
        hasStones = c.bool(.hasStones, default: false)
        stoneWeightG = c.double(.stoneWeightG, default: 0)
        wastagePercentage = c.double(.wastagePercentage, default: 0)
        makingCharges = c.double(.makingCharges, default: 0)
        hasDiamonds = c.bool(.hasDiamonds, default: false)
        diamondCharges = c.double(.diamondCharges, default: 0)
        stoneCharges = c.double(.stoneCharges, default: 0)
        miscCharges = c.double(.miscCharges, default: 0)
        qrCodeDataUrl = c.string(.qrCodeDataUrl)
        imageUrl = c.string(.imageUrl)
        stoneDetails = c.string(.stoneDetails)
        diamondDetails = c.string(.diamondDetails)
        isCustomPrice = c.bool(.isCustomPrice, default: false)
        customPrice = c.double(.customPrice)
        description = c.string(.description)
        size = c.string(.size)
        platingType = c.string(.platingType)
        platingNote = c.string(.platingNote)
        nickelFree = c.bool(.nickelFree, default: false)
        silverRatePerGram = c.double(.silverRatePerGram)
        shopifyProductId = c.string(.shopifyProductId)
        shopifyVariantId = c.string(.shopifyVariantId)
    }
}
