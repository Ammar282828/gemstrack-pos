import Foundation

/// Something the shop handed out and expects back: Firestore `given_items/<id>`
/// (src/lib/store.ts `GivenItem`): a sample, a bangle sent for repair, gold to a karigar.
/// Surprising: the Given page used to write only the name, so older rows have no `recipientId`
/// and are found by `recipientName` (lib/given.ts links one only when exactly one live record
/// carries the name). A customer merge moves rows by `recipientId`.
public struct GivenItem: Decodable, Identifiable, Hashable {
    public let id: String
    /// ISO; the date given.
    public let date: String
    /// What was given ("gold ring sample", "repair bangle").
    public let description: String
    public let recipientType: GivenItemRecipientType
    /// Free text or the resolved name.
    public let recipientName: String
    /// The karigar's or customer's id, when linked.
    public let recipientId: String?
    public let notes: String?
    public let status: GivenItemStatus
    /// ISO; when it came back.
    public let returnedDate: String?

    private enum K: String, CodingKey {
        case id, date, description, recipientType, recipientName, recipientId, notes, status, returnedDate
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        date = c.string(.date, default: "")
        description = c.string(.description, default: "")
        recipientType = c.word(.recipientType, default: .unknown(""))
        recipientName = c.string(.recipientName, default: "")
        recipientId = c.string(.recipientId)
        notes = c.string(.notes)
        status = c.word(.status, default: .unknown(""))
        returnedDate = c.string(.returnedDate)
    }
}
