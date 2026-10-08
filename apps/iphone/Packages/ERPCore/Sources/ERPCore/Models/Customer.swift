import Foundation

/// A customer: Firestore `customers/<id>` (src/lib/store.ts `Customer`).
/// Surprising: removal hides, it does not destroy: a removed customer keeps `deletedAt` and
/// every invoice, order and hisaab row, and the ERP keeps them out of every list (Settings >
/// Recently removed puts them back), so the app must filter `deletedAt == nil` itself. Sizes are
/// free text on purpose ("12.5", "US 6", "usual"). `phone` can be stored as a number in old
/// imports; it decodes as text. `tags` are carried over from the phone book (tj, hom, tc).
public struct Customer: Decodable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let phone: String?
    /// A spare number; never overwritten by an import.
    public let altPhone: String?
    public let email: String?
    public let address: String?
    public let city: String?
    public let country: String?
    public let source: CustomerSource?
    public let shopifyCustomerId: String?
    public let ringSize: String?
    public let bangleSize: String?
    public let braceletSize: String?
    public let chainLength: String?
    /// ISO "yyyy-mm-dd".
    public let birthday: String?
    public let anniversary: String?
    /// What they like, in the shop's own words.
    public let preference: String?
    public let tags: [String]
    public let notes: String?
    /// Present when the customer has been removed.
    public let deletedAt: String?

    private enum K: String, CodingKey {
        case id, name, phone, altPhone, email, address, city, country, source, shopifyCustomerId
        case ringSize, bangleSize, braceletSize, chainLength, birthday, anniversary, preference
        case tags, notes, deletedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        name = c.string(.name, default: "")
        phone = c.string(.phone)
        altPhone = c.string(.altPhone)
        email = c.string(.email)
        address = c.string(.address)
        city = c.string(.city)
        country = c.string(.country)
        source = c.word(.source)
        shopifyCustomerId = c.string(.shopifyCustomerId)
        ringSize = c.string(.ringSize)
        bangleSize = c.string(.bangleSize)
        braceletSize = c.string(.braceletSize)
        chainLength = c.string(.chainLength)
        birthday = c.string(.birthday)
        anniversary = c.string(.anniversary)
        preference = c.string(.preference)
        tags = c.strings(.tags)
        notes = c.string(.notes)
        deletedAt = c.string(.deletedAt)
    }
}
