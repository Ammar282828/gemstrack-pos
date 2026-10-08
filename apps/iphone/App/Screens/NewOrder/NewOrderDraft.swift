import Foundation
import ERPCore

// The order in progress, as the phone keeps it. The web keeps an unfinished order in Firestore
// (Drafts, decisions.md "Drafts") so it can be finished on another device; the phone keeps its own
// copy in UserDefaults ("erp.orderDraft") and no more, so closing the screen, or the app, loses
// nothing. Nothing here decides money: prices and totals come from ERPCore (NewOrderMath), and the
// order is built exactly as the web's order form builds it.
//
// Numbers stay text while they are typed (a box holding "5." must stay "5."). Words (metal, karat,
// source) stay the ERP's own words so the draft is plain JSON.

extension KeyedDecodingContainer {
    /// A saved draft must open after an update that added a field: whatever is missing or odd takes
    /// its default instead of throwing the whole order away.
    fileprivate func orderField<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? fallback
    }
}

// MARK: One piece

struct NewOrderPieceDraft: Codable, Equatable, Identifiable {
    var id = UUID()
    /// A category id ("cat001"), or "" for none.
    var category = ""
    var description = ""
    /// "gold", "palladium", "platinum" or "silver": a new piece starts on the house's own metal.
    var metal = House.metal
    var karat = "21k"
    var weight = ""
    /// A new piece is priced from the rate with stones counted: that is almost every piece here.
    var hasStones = true
    var stoneWeight = ""
    var stoneDetails = ""
    var hasDiamonds = false
    var diamond = ""
    var diamondDetails = ""
    /// The percentage; the grams are worked out beside it (OrderFinalize).
    var wastage = "10"
    var making = ""
    var stones = ""
    var size = ""
    var platingType = ""
    var platingNote = ""
    var nickelFree = false
    var karigarId = ""
    var referenceSku = ""
    var sampleGiven = false
    /// Fixed price instead of weight × rate (the web's `isManualPrice`).
    var manual = false
    var manualPrice = ""
    /// Owners only: staff never read it back (roles.ts STAFF_HIDDEN_FIELDS).
    var adminNote = ""
    /// The sample picture, JPEG, at most about 120 KB (NewOrderPhotoCodec).
    var photo: Data?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.orderField(.id, UUID())
        category = c.orderField(.category, "")
        description = c.orderField(.description, "")
        metal = c.orderField(.metal, House.metal)
        karat = c.orderField(.karat, "21k")
        weight = c.orderField(.weight, "")
        hasStones = c.orderField(.hasStones, true)
        stoneWeight = c.orderField(.stoneWeight, "")
        stoneDetails = c.orderField(.stoneDetails, "")
        hasDiamonds = c.orderField(.hasDiamonds, false)
        diamond = c.orderField(.diamond, "")
        diamondDetails = c.orderField(.diamondDetails, "")
        wastage = c.orderField(.wastage, "10")
        making = c.orderField(.making, "")
        stones = c.orderField(.stones, "")
        size = c.orderField(.size, "")
        platingType = c.orderField(.platingType, "")
        platingNote = c.orderField(.platingNote, "")
        nickelFree = c.orderField(.nickelFree, false)
        karigarId = c.orderField(.karigarId, "")
        referenceSku = c.orderField(.referenceSku, "")
        sampleGiven = c.orderField(.sampleGiven, false)
        manual = c.orderField(.manual, false)
        manualPrice = c.orderField(.manualPrice, "")
        adminNote = c.orderField(.adminNote, "")
        photo = try? c.decodeIfPresent(Data.self, forKey: .photo)
    }
}

// MARK: One exchange row

/// ERPCore's `ExchangeRow` as plain JSON (the row type itself is not Codable, and cannot be made so from here).
struct NewOrderExchangeDraft: Codable, Equatable, Identifiable {
    var id: String
    var description: String
    var karat: String
    var weightG: String
    var ratePerGram: String
    var value: String
    var valueTyped: Bool

    init(_ r: ExchangeRow) {
        id = r.id
        description = r.description
        karat = r.karat
        weightG = r.weightG
        ratePerGram = r.ratePerGram
        value = r.value
        valueTyped = r.valueTyped
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.orderField(.id, newExchangeRowId())
        description = c.orderField(.description, "")
        karat = c.orderField(.karat, "")
        weightG = c.orderField(.weightG, "")
        ratePerGram = c.orderField(.ratePerGram, "")
        value = c.orderField(.value, "")
        valueTyped = c.orderField(.valueTyped, false)
    }

    var row: ExchangeRow {
        ExchangeRow(id: id, description: description, karat: karat, weightG: weightG,
                    ratePerGram: ratePerGram, value: value, valueTyped: valueTyped)
    }

    static func blank() -> NewOrderExchangeDraft { NewOrderExchangeDraft(blankExchangeRow()) }

    var isBlank: Bool {
        description.isEmpty && karat.isEmpty && weightG.isEmpty && ratePerGram.isEmpty && value.isEmpty
    }
}

// MARK: The whole order

struct NewOrderDraft: Codable, Equatable {
    /// A customer picked from the book; "" when a name is being typed or none is given (a walk-in).
    var customerId = ""
    var customerName = ""
    var customerPhone = ""
    /// A `CUSTOMER_SOURCES` word, or "" for not specified.
    var source = ""
    var takenBy = ""
    /// yyyy-MM-dd in Karachi, or "" for no date.
    var promised = ""
    var notes = ""
    var hideRates = false
    var pieces: [NewOrderPieceDraft] = []
    /// The rates this order is priced at, by `RateKey` word, as typed. Seeded from today's once; a
    /// draft that is continued keeps the rates it was quoted at.
    var rates: [String: String] = [:]
    var ratesSeeded = false
    var discount = ""
    var advance = ""
    /// A `PAYMENT_TYPES` word, or "" for not recorded.
    var advanceMethod = "Cash"
    var exchanges: [NewOrderExchangeDraft] = []
    var deliver = false
    var deliveryAddress = ""
    var deliveryCity = ""
    var deliveryName = ""
    var deliveryPhone = ""
    var deliveryNotes = ""
    var deliveryCharge = ""
    var deliveryExpected = ""
    /// The 24k rate now, per tola, for the shop's margin (owners).
    var costTola = ""
    /// The photos were too many to keep on the phone with the rest.
    var photosLeftOut = false

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        customerId = c.orderField(.customerId, "")
        customerName = c.orderField(.customerName, "")
        customerPhone = c.orderField(.customerPhone, "")
        source = c.orderField(.source, "")
        takenBy = c.orderField(.takenBy, "")
        promised = c.orderField(.promised, "")
        notes = c.orderField(.notes, "")
        hideRates = c.orderField(.hideRates, false)
        pieces = c.orderField(.pieces, [NewOrderPieceDraft]())
        rates = c.orderField(.rates, [String: String]())
        ratesSeeded = c.orderField(.ratesSeeded, false)
        discount = c.orderField(.discount, "")
        advance = c.orderField(.advance, "")
        advanceMethod = c.orderField(.advanceMethod, "Cash")
        exchanges = c.orderField(.exchanges, [NewOrderExchangeDraft]())
        deliver = c.orderField(.deliver, false)
        deliveryAddress = c.orderField(.deliveryAddress, "")
        deliveryCity = c.orderField(.deliveryCity, "")
        deliveryName = c.orderField(.deliveryName, "")
        deliveryPhone = c.orderField(.deliveryPhone, "")
        deliveryNotes = c.orderField(.deliveryNotes, "")
        deliveryCharge = c.orderField(.deliveryCharge, "")
        deliveryExpected = c.orderField(.deliveryExpected, "")
        costTola = c.orderField(.costTola, "")
        photosLeftOut = c.orderField(.photosLeftOut, false)
        if exchanges.isEmpty { exchanges = [.blank()] }
    }

    /// A new order: fourteen days unless something else is agreed (DEFAULT_PROMISE_DAYS: blank meant
    /// the order was only chased once it was a week old), one empty exchange row, the advance in cash.
    static func fresh() -> NewOrderDraft {
        var d = NewOrderDraft()
        d.promised = NewOrderDay.after(DEFAULT_PROMISE_DAYS)
        d.exchanges = [.blank()]
        return d
    }

    /// Nothing typed yet: not worth keeping on the phone (the rates and the date are not typing).
    var isBlank: Bool {
        if !pieces.isEmpty || deliver || hideRates { return false }
        if !NewOrderFormat.trim(customerName).isEmpty || !customerPhone.isEmpty { return false }
        if !source.isEmpty || !takenBy.isEmpty || !notes.isEmpty { return false }
        if !discount.isEmpty || !advance.isEmpty || !costTola.isEmpty { return false }
        return exchanges.allSatisfy { $0.isBlank }
    }
}

// MARK: What the form does to the draft

// These are what the form's controls do, kept here and not in the views so the contract cases
// (apps/iphone/Packages/Contract) fill a draft through the very same code the screen runs.

extension NewOrderPieceDraft {
    /// The weight as typed, and the stones' weight while its box is ticked (a figure left in an unticked box
    /// is not in the price). Pricing, the wastage grams and the payload all read these two.
    var weightValue: Double { NewOrderFormat.num(weight) }
    var stoneWeightValue: Double { hasStones ? NewOrderFormat.num(stoneWeight) : 0 }

    /// Changing the metal moves the karat onto one that metal is sold in (24k palladium cannot be chosen).
    mutating func setMetal(_ next: String) {
        metal = next
        let options = karatsFor(MetalType(rawValue: next)).map { $0.rawValue }
        if !options.isEmpty && !options.contains(karat) {
            karat = options.contains("21k") ? "21k" : (options.last ?? "")
        }
    }
}

extension NewOrderDraft {
    /// The rates start as today's, once; a draft that is continued keeps the rates it was quoted at.
    mutating func seedRates(from settings: Settings) {
        rates = NewOrderMath.todaysRates(settings)
        ratesSeeded = true
    }

    /// Typing makes it a new customer again (the web's autocomplete does the same): only a pick from the
    /// list is a customer on file.
    mutating func typeCustomerName(_ typed: String) {
        guard typed != customerName else { return }
        customerName = typed
        customerId = ""
    }

    /// A pick from the list: their name and number, and the order's source starts as theirs if none was chosen.
    mutating func choose(_ c: Customer) {
        customerName = c.name
        customerId = c.id
        if let phone = c.phone, !phone.isEmpty { customerPhone = phone }
        if source.isEmpty, let s = c.source { source = s.rawValue }
    }

    /// A change to one exchange row; grams × rate refills the amount unless it was typed (ERPCore).
    mutating func patchExchange(_ id: String, _ patch: ExchangeRowPatch) {
        exchanges = exchanges.map { x in
            x.id == id ? NewOrderExchangeDraft(applyExchangeRowChange(x.row, patch)) : x
        }
    }

    mutating func duplicatePiece(_ id: UUID) {
        guard let i = pieces.firstIndex(where: { $0.id == id }) else { return }
        var copy = pieces[i]
        copy.id = UUID()
        pieces.insert(copy, at: i + 1)
    }
}

// MARK: On the phone

/// One serial queue, so a write that was already on its way can never land after a newer one (or after
/// a clear), and the encoding (photos included) stays off the main thread.
enum NewOrderDraftStore {
    static let key = "erp.orderDraft"

    /// More than this and the photos are left out, so the rest of the order is always kept.
    private static let ceiling = 3_000_000

    private static let queue = DispatchQueue(label: "erp.orderDraft", qos: .utility)

    static func load() -> NewOrderDraft? {
        queue.sync {
            guard let data = UserDefaults.standard.data(forKey: key),
                  let draft = try? JSONDecoder().decode(NewOrderDraft.self, from: data),
                  !draft.isBlank else { return nil }
            return draft
        }
    }

    /// `now` waits for the write: for the moment the screen or the app is going away.
    static func save(_ draft: NewOrderDraft, now: Bool = false) {
        if now {
            queue.sync { write(draft) }
        } else {
            queue.async { write(draft) }
        }
    }

    static func clear() {
        queue.sync { UserDefaults.standard.removeObject(forKey: key) }
    }

    private static func write(_ draft: NewOrderDraft) {
        if draft.isBlank {
            UserDefaults.standard.removeObject(forKey: key)
            return
        }
        guard var data = try? JSONEncoder().encode(draft) else { return }
        if data.count > ceiling {
            var lite = draft
            lite.pieces = lite.pieces.map { p in
                var q = p
                q.photo = nil
                return q
            }
            lite.photosLeftOut = true
            guard let smaller = try? JSONEncoder().encode(lite) else { return }
            data = smaller
        }
        UserDefaults.standard.set(data, forKey: key)
    }
}
