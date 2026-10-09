import Foundation

/// Silver received from a karigar, at a surcharge per gram: Firestore `silver_transactions/<id>`
/// (src/lib/store.ts `SilverTransaction`), written from his page's Silver form.
/// Surprising: `totalSurcharge` is stored, not worked out on reading (lib/karigar-pay.ts
/// `silverSurcharge` made it, grams at the rate), and the karigar's name is copied in.
public struct KarigarSilverTransaction: Decodable, Identifiable, Hashable {
    public let id: String
    public let karigarId: String
    public let karigarName: String
    /// ISO instant.
    public let date: String
    public let silverGrams: Double
    public let surchargePerGram: Double
    public let totalSurcharge: Double
    public let description: String?

    private enum K: String, CodingKey {
        case id, karigarId, karigarName, date, silverGrams, surchargePerGram, totalSurcharge, description
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        karigarId = c.string(.karigarId, default: "")
        karigarName = c.string(.karigarName, default: "")
        date = c.string(.date, default: "")
        silverGrams = c.double(.silverGrams, default: 0)
        surchargePerGram = c.double(.surchargePerGram, default: 0)
        totalSurcharge = c.double(.totalSurcharge, default: 0)
        description = c.string(.description)
    }
}
