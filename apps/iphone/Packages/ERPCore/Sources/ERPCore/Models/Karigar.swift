import Foundation

/// A karigar (workshop craftsman): Firestore `karigars/<id>` (src/lib/store.ts `Karigar`).
/// Surprising: removal hides, as for customers (`deletedAt`); `email` is the Google account the
/// karigar signs in with, which grants their own work list and hisaab only, through the server.
public struct Karigar: Decodable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let contact: String?
    public let altPhone: String?
    /// What he makes: setting, polish, chain, meena.
    public let specialty: String?
    public let workshop: String?
    public let address: String?
    public let city: String?
    public let country: String?
    public let notes: String?
    public let email: String?
    public let deletedAt: String?

    private enum K: String, CodingKey {
        case id, name, contact, altPhone, specialty, workshop, address, city, country, notes, email, deletedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        name = c.string(.name, default: "")
        contact = c.string(.contact)
        altPhone = c.string(.altPhone)
        specialty = c.string(.specialty)
        workshop = c.string(.workshop)
        address = c.string(.address)
        city = c.string(.city)
        country = c.string(.country)
        notes = c.string(.notes)
        email = c.string(.email)
        deletedAt = c.string(.deletedAt)
    }
}

/// A standalone piece of work for a karigar that does not come from a customer order: stock
/// pieces, repairs, samples, re-polish jobs. Firestore `karigar_jobs/<id>`
/// (src/lib/store.ts `KarigarJob`).
/// Surprising: order-sourced work is NOT here; it is derived from `OrderItem.karigarId` (and
/// `InvoiceItem.karigarId`), and the Workshop screen merges all three (lib/workshop.ts).
/// Status words are lower-case with a hyphen ("in-progress"), unlike the order statuses.
public struct KarigarJob: Decodable, Identifiable, Hashable {
    public let id: String
    public let karigarId: String
    public let karigarName: String
    public let description: String
    public let itemCategory: String?
    public let metalType: MetalType?
    public let karat: KaratValue?
    public let weightG: Double?
    public let quantity: Double?
    public let size: String?
    public let status: KarigarJobStatus
    /// ISO; when the job was written up.
    public let assignedDate: String
    /// ISO; when the piece actually left the shop.
    public let givenAt: String?
    public let completedDate: String?
    /// Making charges agreed with the karigar.
    public let agreedCost: Double?
    public let notes: String?

    private enum K: String, CodingKey {
        case id, karigarId, karigarName, description, itemCategory, metalType, karat, weightG, quantity
        case size, status, assignedDate, givenAt, completedDate, agreedCost, notes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        karigarId = c.string(.karigarId, default: "")
        karigarName = c.string(.karigarName, default: "")
        description = c.string(.description, default: "")
        itemCategory = c.string(.itemCategory)
        metalType = c.word(.metalType)
        karat = c.word(.karat)
        weightG = c.double(.weightG)
        quantity = c.double(.quantity)
        size = c.string(.size)
        status = c.word(.status, default: .unknown(""))
        assignedDate = c.string(.assignedDate, default: "")
        givenAt = c.string(.givenAt)
        completedDate = c.string(.completedDate)
        agreedCost = c.double(.agreedCost)
        notes = c.string(.notes)
    }
}

/// One of a karigar's hisaabs, a run of work and payments settled together ("March 2026"):
/// Firestore `karigar_batches/<id>` (src/lib/store.ts `KarigarBatch`). Expenses paid to the karigar
/// are filed under one by `Expense.batchId`.
/// Surprising: no `closedDate` means the hisaab is still open, and a karigar normally has one open.
public struct KarigarBatch: Decodable, Identifiable, Hashable {
    public let id: String
    public let karigarId: String
    public let label: String
    /// ISO.
    public let startDate: String
    /// ISO; nil while open.
    public let closedDate: String?
    /// Written when the hisaab is closed.
    public let totalPaid: Double?

    public var isOpen: Bool { closedDate == nil }

    private enum K: String, CodingKey { case id, karigarId, label, startDate, closedDate, totalPaid }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = c.string(.id) ?? ""
        karigarId = c.string(.karigarId, default: "")
        label = c.string(.label, default: "")
        startDate = c.string(.startDate, default: "")
        closedDate = c.string(.closedDate)
        totalPaid = c.double(.totalPaid)
    }
}
