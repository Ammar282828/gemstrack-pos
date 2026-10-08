import Foundation

/// The shop's per-gram rates, PKR (`RATE_KEYS` in src/lib/rates.ts). What an invoice or order
/// keeps as `ratesApplied` (TypeScript `Partial<Settings>`): the rates the sale was priced at,
/// whichever of them it carried. A rate the sale did not carry is nil, never 0.
public struct Rates: Decodable, Hashable {
    public let goldRatePerGram24k: Double?
    public let goldRatePerGram22k: Double?
    public let goldRatePerGram21k: Double?
    public let goldRatePerGram18k: Double?
    public let palladiumRatePerGram: Double?
    public let palladiumRatePerGram18k: Double?
    public let palladiumRatePerGram12k: Double?
    public let platinumRatePerGram: Double?
    public let silverRatePerGram: Double?

    private enum K: String, CodingKey {
        case goldRatePerGram24k, goldRatePerGram22k, goldRatePerGram21k, goldRatePerGram18k
        case palladiumRatePerGram, palladiumRatePerGram18k, palladiumRatePerGram12k
        case platinumRatePerGram, silverRatePerGram
    }

    /// No rate at all: a sale whose `ratesApplied` is missing.
    public init() {
        goldRatePerGram24k = nil; goldRatePerGram22k = nil; goldRatePerGram21k = nil; goldRatePerGram18k = nil
        palladiumRatePerGram = nil; palladiumRatePerGram18k = nil; palladiumRatePerGram12k = nil
        platinumRatePerGram = nil; silverRatePerGram = nil
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        goldRatePerGram24k = c.double(.goldRatePerGram24k)
        goldRatePerGram22k = c.double(.goldRatePerGram22k)
        goldRatePerGram21k = c.double(.goldRatePerGram21k)
        goldRatePerGram18k = c.double(.goldRatePerGram18k)
        palladiumRatePerGram = c.double(.palladiumRatePerGram)
        palladiumRatePerGram18k = c.double(.palladiumRatePerGram18k)
        palladiumRatePerGram12k = c.double(.palladiumRatePerGram12k)
        platinumRatePerGram = c.double(.platinumRatePerGram)
        silverRatePerGram = c.double(.silverRatePerGram)
    }
}
