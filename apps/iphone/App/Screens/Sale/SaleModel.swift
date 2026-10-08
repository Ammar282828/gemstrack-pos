import Foundation
import ERPCore

// The sale in progress, as the phone keeps it. The web keeps an unfinished sale in Firestore
// (Drafts, components/drafts/use-work-drafts.ts) so it can be finished on another device; the phone
// keeps its own copy in UserDefaults ("erp.saleDraft") and no more. Nothing here decides money:
// the prices, totals and credit come from ERPCore (Pricing, Exchange, WalkIn, InvoiceCredit) and the
// server prices the sale again when it is saved.

/// Numbers as the sale's fields hold them: typed text in, a finite number out.
enum SaleNumber {
    /// Text to a number: commas are thousands, blank or unreadable is nil. Never NaN or infinity
    /// (a NaN in a JSON body would crash JSONSerialization).
    static func parse(_ text: String) -> Double? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: "")
        guard !t.isEmpty, let v = Double(t), v.isFinite else { return nil }
        return v
    }

    /// `Number(v) || 0`.
    static func value(_ text: String) -> Double { parse(text) ?? 0 }

    private static let plain: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        // Every digit a figure has, as the web's String(n) keeps them: a piece opened in the line editor and
        // applied unchanged must not move (a weight of 3.45678 g is not 3.4568).
        f.maximumFractionDigits = 10
        f.minimumFractionDigits = 0
        return f
    }()

    /// A number back into a field: 0 and nothing are blank (decisions.md "Number fields").
    static func text(_ v: Double?) -> String {
        guard let v, v.isFinite, v != 0 else { return "" }
        return plain.string(from: NSNumber(value: v)) ?? ""
    }

    /// Grams the way the web prints them: 5.2, 12.35, never 5.2000.
    static func grams(_ v: Double) -> String {
        plain.string(from: NSNumber(value: v)) ?? "0"
    }
}

extension KeyedDecodingContainer {
    /// A saved draft must open after an update that added a field: whatever is missing or odd
    /// takes its default instead of throwing the whole draft away.
    fileprivate func saleField<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? fallback
    }

    fileprivate func saleOptional<T: Decodable>(_ key: Key) -> T? {
        try? decodeIfPresent(T.self, forKey: key)
    }
}

// MARK: One piece on the bill

/// A piece on the bill as the sale holds it: the stock record's fields, perhaps re-priced by hand
/// (the web's cart item, edit-cart-item-dialog.tsx). Words (metal, karat) stay text so the draft is
/// plain JSON; `priced` turns it into what ERPCore prices.
struct SaleLine: Codable, Equatable, Identifiable {
    var sku: String
    var name: String
    var categoryId: String
    var metalType: String
    var karat: String?
    var metalWeightG: Double
    var secondaryMetalType: String?
    var secondaryMetalKarat: String?
    var secondaryMetalWeightG: Double?
    var hasStones: Bool
    var stoneWeightG: Double
    var wastagePercentage: Double
    var makingCharges: Double
    var hasDiamonds: Bool
    var diamondCharges: Double
    var stoneCharges: Double
    var miscCharges: Double
    var imageUrl: String?
    var stoneDetails: String?
    var diamondDetails: String?
    var isCustomPrice: Bool
    var customPrice: Double?
    /// The product's "description": what prints on the bill under the piece.
    var billDescription: String?
    var size: String?
    var platingType: String?
    var platingNote: String?
    var nickelFree: Bool
    var silverRatePerGram: Double?
    var shopifyProductId: String?
    var shopifyVariantId: String?

    var id: String { sku }

    /// The piece as the shelf has it. The tag's QR image stays on the shelf: it is a whole base64
    /// picture, too heavy for a draft; the sale adds it back from the live piece when it is saved.
    init(_ p: Product) {
        sku = p.sku
        name = p.name
        categoryId = p.categoryId
        metalType = p.metalType.rawValue
        karat = p.karat?.rawValue
        metalWeightG = p.metalWeightG
        secondaryMetalType = p.secondaryMetalType?.rawValue
        secondaryMetalKarat = p.secondaryMetalKarat?.rawValue
        secondaryMetalWeightG = p.secondaryMetalWeightG
        hasStones = p.hasStones
        stoneWeightG = p.stoneWeightG
        wastagePercentage = p.wastagePercentage
        makingCharges = p.makingCharges
        hasDiamonds = p.hasDiamonds
        diamondCharges = p.diamondCharges
        stoneCharges = p.stoneCharges
        miscCharges = p.miscCharges
        imageUrl = p.imageUrl
        stoneDetails = p.stoneDetails
        diamondDetails = p.diamondDetails
        isCustomPrice = p.isCustomPrice
        customPrice = p.customPrice
        billDescription = p.description
        size = p.size
        platingType = p.platingType
        platingNote = p.platingNote
        nickelFree = p.nickelFree
        silverRatePerGram = p.silverRatePerGram
        shopifyProductId = p.shopifyProductId
        shopifyVariantId = p.shopifyVariantId
    }

    /// A blank line, for billing a piece that was never in inventory (edit-cart-item-dialog.tsx
    /// `blankCartItem`): the house's own metal, 21k when that is gold, and the opening wastage of the
    /// order and product forms (10% on gold, nothing on silver). Priced from its weight and the rate
    /// unless somebody says otherwise.
    init(blankFor metal: String, sku: String) {
        self.sku = sku
        name = ""
        categoryId = ""
        metalType = metal
        karat = metal == "gold" ? "21k" : nil
        metalWeightG = 0
        hasStones = false
        stoneWeightG = 0
        wastagePercentage = metal == "silver" ? 0 : 10
        makingCharges = 0
        hasDiamonds = false
        diamondCharges = 0
        stoneCharges = 0
        miscCharges = 0
        isCustomPrice = false
        customPrice = 0
        nickelFree = false
    }

    /// `NEW-` plus `Date.now().toString(36).toUpperCase()`: the milliseconds since 1970 in base 36. The
    /// key tells the sale's lines apart; it is not a stock number (lib/sku.ts). `avoiding` keeps two new
    /// items on one bill from sharing a key.
    static func newItemSku(now: Date = Date(), avoiding taken: Set<String> = []) -> String {
        var ms = UInt64(max(0, (now.timeIntervalSince1970 * 1000).rounded(.down)))
        var out = "NEW-" + String(ms, radix: 36, uppercase: true)
        while taken.contains(out) {
            ms += 1
            out = "NEW-" + String(ms, radix: 36, uppercase: true)
        }
        return out
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sku = try c.decode(String.self, forKey: .sku)
        name = c.saleField(.name, "")
        categoryId = c.saleField(.categoryId, "")
        metalType = c.saleField(.metalType, "gold")
        karat = c.saleOptional(.karat)
        metalWeightG = c.saleField(.metalWeightG, 0)
        secondaryMetalType = c.saleOptional(.secondaryMetalType)
        secondaryMetalKarat = c.saleOptional(.secondaryMetalKarat)
        secondaryMetalWeightG = c.saleOptional(.secondaryMetalWeightG)
        hasStones = c.saleField(.hasStones, false)
        stoneWeightG = c.saleField(.stoneWeightG, 0)
        wastagePercentage = c.saleField(.wastagePercentage, 0)
        makingCharges = c.saleField(.makingCharges, 0)
        hasDiamonds = c.saleField(.hasDiamonds, false)
        diamondCharges = c.saleField(.diamondCharges, 0)
        stoneCharges = c.saleField(.stoneCharges, 0)
        miscCharges = c.saleField(.miscCharges, 0)
        imageUrl = c.saleOptional(.imageUrl)
        stoneDetails = c.saleOptional(.stoneDetails)
        diamondDetails = c.saleOptional(.diamondDetails)
        isCustomPrice = c.saleField(.isCustomPrice, false)
        customPrice = c.saleOptional(.customPrice)
        billDescription = c.saleOptional(.billDescription)
        size = c.saleOptional(.size)
        platingType = c.saleOptional(.platingType)
        platingNote = c.saleOptional(.platingNote)
        nickelFree = c.saleField(.nickelFree, false)
        silverRatePerGram = c.saleOptional(.silverRatePerGram)
        shopifyProductId = c.saleOptional(.shopifyProductId)
        shopifyVariantId = c.saleOptional(.shopifyVariantId)
    }

    /// What ERPCore prices (`PricedPiece(product)` for a piece in stock, with this sale's edits).
    var priced: PricedPiece {
        PricedPiece(
            categoryId: categoryId.isEmpty ? nil : categoryId,
            metalType: MetalType(rawValue: metalType),
            karat: SaleLine.word(karat).map { KaratValue(rawValue: $0) },
            metalWeightG: metalWeightG,
            secondaryMetalType: SaleLine.word(secondaryMetalType).map { MetalType(rawValue: $0) },
            secondaryMetalKarat: SaleLine.word(secondaryMetalKarat).map { KaratValue(rawValue: $0) },
            secondaryMetalWeightG: secondaryMetalWeightG,
            stoneWeightG: stoneWeightG,
            wastagePercentage: wastagePercentage,
            makingCharges: makingCharges,
            hasDiamonds: hasDiamonds,
            diamondCharges: diamondCharges,
            stoneCharges: stoneCharges,
            miscCharges: miscCharges,
            isCustomPrice: isCustomPrice,
            customPrice: customPrice,
            silverRatePerGram: silverRatePerGram
        )
    }

    private static func word(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return s
    }

    /// A key made up for one bill (NEW-…, BILL-…), not a stock number (lib/sku.ts).
    var isOneOff: Bool { SaleLookup.isOneOff(sku) }

    /// The SKU worth showing a person, or nothing (lib/sku.ts `stockSku`).
    var stockSku: String? { isOneOff ? nil : sku }

    /// The piece as the ERP's createInvoice takes it: the full product document, plus this sale's
    /// edits (`isCustomPrice` and the price fields), as the web's cart sends it. `qr` is the live
    /// piece's tag image, if the shelf has it: sold_products keeps the whole document.
    func payload(qr: String? = nil) -> [String: Any] {
        var o: [String: Any] = [
            "sku": sku, "name": name, "categoryId": categoryId, "metalType": metalType,
            "metalWeightG": metalWeightG, "hasStones": hasStones, "stoneWeightG": stoneWeightG,
            "wastagePercentage": wastagePercentage, "makingCharges": makingCharges,
            "hasDiamonds": hasDiamonds, "diamondCharges": diamondCharges,
            "stoneCharges": stoneCharges, "miscCharges": miscCharges,
            "isCustomPrice": isCustomPrice, "nickelFree": nickelFree, "quantity": 1,
        ]
        func put(_ key: String, _ value: String?) {
            if let value, !value.trimmingCharacters(in: .whitespaces).isEmpty { o[key] = value }
        }
        put("karat", karat)
        put("secondaryMetalType", secondaryMetalType)
        put("secondaryMetalKarat", secondaryMetalKarat)
        if let v = secondaryMetalWeightG { o["secondaryMetalWeightG"] = v }
        put("imageUrl", imageUrl)
        put("qrCodeDataUrl", qr)
        put("stoneDetails", stoneDetails)
        put("diamondDetails", diamondDetails)
        if isCustomPrice, let v = customPrice { o["customPrice"] = v }
        put("description", billDescription)
        put("size", size)
        put("platingType", platingType)
        put("platingNote", platingNote)
        if let v = silverRatePerGram, v > 0 { o["silverRatePerGram"] = v }
        put("shopifyProductId", shopifyProductId)
        put("shopifyVariantId", shopifyVariantId)
        return o
    }
}

// MARK: Rows

/// An exchange row as the draft keeps it: ERPCore's `ExchangeRow` (components/shared/exchange-rows.tsx),
/// which is not Codable. The rules (grams × rate fills the amount until one is typed) stay in ERPCore.
struct SaleExchangeRow: Codable, Equatable, Identifiable {
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

    static func blank() -> SaleExchangeRow { SaleExchangeRow(blankExchangeRow()) }

    var core: ExchangeRow {
        ExchangeRow(id: id, description: description, karat: karat, weightG: weightG,
                    ratePerGram: ratePerGram, value: value, valueTyped: valueTyped)
    }

    var hasDetails: Bool { !karat.isEmpty || !weightG.isEmpty || !ratePerGram.isEmpty }
    var isBlank: Bool { description.trimmingCharacters(in: .whitespaces).isEmpty && value.isEmpty && !hasDetails }
}

/// One "Payment received" row as typed (the amount stays text until the sale is saved).
struct SalePaymentRow: Codable, Equatable, Identifiable {
    var id: String
    var amount: String
    var method: String
    var reference: String

    init(id: String = newExchangeRowId(), amount: String = "", method: String = "Cash", reference: String = "") {
        self.id = id
        self.amount = amount
        self.method = method
        self.reference = reference
    }
}

/// "Deliver this", as typed (DeliveryFields). The expected date is "yyyy-MM-dd" or blank.
struct SaleDelivery: Codable, Equatable {
    var required = false
    var address = ""
    var city = ""
    var expectedDate = ""
    var contactName = ""
    var contactPhone = ""
    var charge = ""
    var notes = ""

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        required = c.saleField(.required, false)
        address = c.saleField(.address, "")
        city = c.saleField(.city, "")
        expectedDate = c.saleField(.expectedDate, "")
        contactName = c.saleField(.contactName, "")
        contactPhone = c.saleField(.contactPhone, "")
        charge = c.saleField(.charge, "")
        notes = c.saleField(.notes, "")
    }

    /// What the ERP records: only when the piece is going out with an address (create-invoice.ts
    /// keeps `delivery` only then), and only the fields filled in.
    var payload: [String: Any]? {
        let place = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard required, !place.isEmpty else { return nil }
        var o: [String: Any] = ["required": true, "address": place]
        func put(_ key: String, _ value: String) {
            let t = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { o[key] = t }
        }
        put("city", city)
        put("expectedDate", expectedDate)
        put("contactName", contactName)
        put("contactPhone", contactPhone)
        put("notes", notes)
        if let v = SaleNumber.parse(charge), v > 0 { o["charge"] = v }
        return o
    }

    var isBlank: Bool {
        !required && address.isEmpty && city.isEmpty && expectedDate.isEmpty && contactName.isEmpty
            && contactPhone.isEmpty && charge.isEmpty && notes.isEmpty
    }
}

// MARK: The draft

/// The whole sale in progress. Everything a person types is text here, as in the web's form.
struct SaleDraft: Codable, Equatable {
    var lines: [SaleLine] = []
    /// The customer picked from the book; typing a different name lets go of it, as the web's box does.
    var customerId: String?
    var customerName = ""
    var customerPhone = ""
    /// Rate boxes typed in this sale, by `RateInputKey.rawValue`. A box not here follows today's rate.
    var rates: [String: String] = [:]
    var discount = ""
    var exchanges: [SaleExchangeRow] = [SaleExchangeRow.blank()]
    var payments: [SalePaymentRow] = [SalePaymentRow()]
    var takenBy = ""
    var hideRates = false
    var internalNote = ""
    /// The 24k rate for the shop's margin, typed per tola the way the bazaar quotes it.
    var costTola = ""
    var delivery = SaleDelivery()

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lines = c.saleField(.lines, [])
        customerId = c.saleOptional(.customerId)
        customerName = c.saleField(.customerName, "")
        customerPhone = c.saleField(.customerPhone, "")
        rates = c.saleField(.rates, [:])
        discount = c.saleField(.discount, "")
        let ex: [SaleExchangeRow] = c.saleField(.exchanges, [])
        exchanges = ex.isEmpty ? [SaleExchangeRow.blank()] : ex
        let pay: [SalePaymentRow] = c.saleField(.payments, [])
        payments = pay.isEmpty ? [SalePaymentRow()] : pay
        takenBy = c.saleField(.takenBy, "")
        hideRates = c.saleField(.hideRates, false)
        internalNote = c.saleField(.internalNote, "")
        costTola = c.saleField(.costTola, "")
        delivery = c.saleField(.delivery, SaleDelivery())
    }

    /// Nothing worth keeping: a blank sale is not stored.
    var isBlank: Bool {
        let blank = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return lines.isEmpty && customerId == nil && blank(customerName) && blank(customerPhone)
            && rates.isEmpty && blank(discount) && exchanges.allSatisfy { $0.isBlank }
            && payments.allSatisfy { blank($0.amount) && blank($0.reference) }
            && blank(takenBy) && !hideRates && blank(internalNote) && blank(costTola) && delivery.isBlank
    }
}

/// The phone's own unfinished sale ("erp.saleDraft"). The New sale screen writes it as it is typed
/// and takes it back on appear; the scan screen adds a piece to it and opens the sale.
enum SaleDraftStore {
    static let key = "erp.saleDraft"

    static func load() -> SaleDraft? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(SaleDraft.self, from: data)
    }

    static func save(_ draft: SaleDraft) {
        if draft.isBlank {
            UserDefaults.standard.removeObject(forKey: key)
        } else if let data = try? JSONEncoder().encode(draft) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }

    /// Puts a piece on the unfinished sale (a new one if there is none). False when it is already there.
    @discardableResult
    static func add(_ product: Product) -> Bool {
        var d = load() ?? SaleDraft()
        if d.lines.contains(where: { $0.sku == product.sku }) { return false }
        d.lines.append(SaleLine(product))
        save(d)
        return true
    }
}

/// Everything the line editor edits, held as text so the fields stay editable (the web's `Draft` in
/// edit-cart-item-dialog.tsx), and the line with those edits applied (its `toPatch`). Pure, so the
/// contract tests (apps/iphone/Packages/Contract) edit a sale's lines through the very code the sheet runs.
struct SaleLineFields {
    var name: String
    var categoryId: String
    var size: String
    var metalType: String
    var karat: String
    var weight: String
    var hasStones: Bool
    var stoneWeight: String
    var wastage: String
    var making: String
    var hasDiamonds: Bool
    var diamondCharges: String
    var stoneCharges: String
    var miscCharges: String
    var stoneDetails: String
    var diamondDetails: String
    var billDescription: String
    var platingType: String
    var platingNote: String
    var nickelFree: Bool
    var silverRate: String
    var fixed: Bool
    var customPrice: String

    init(_ l: SaleLine) {
        name = l.name
        categoryId = l.categoryId
        size = l.size ?? ""
        metalType = l.metalType
        karat = l.karat ?? ""
        weight = SaleNumber.text(l.metalWeightG)
        // The reveal opens whenever there is stone or diamond data to show, so a figure that is in
        // the price can never sit behind a closed switch.
        hasStones = l.hasStones || l.stoneWeightG > 0 || !(l.stoneDetails ?? "").isEmpty
        stoneWeight = SaleNumber.text(l.stoneWeightG)
        wastage = SaleNumber.text(l.wastagePercentage)
        making = SaleNumber.text(l.makingCharges)
        hasDiamonds = l.hasDiamonds || l.diamondCharges > 0 || !(l.diamondDetails ?? "").isEmpty
        diamondCharges = SaleNumber.text(l.diamondCharges)
        stoneCharges = SaleNumber.text(l.stoneCharges)
        miscCharges = SaleNumber.text(l.miscCharges)
        stoneDetails = l.stoneDetails ?? ""
        diamondDetails = l.diamondDetails ?? ""
        billDescription = l.billDescription ?? ""
        platingType = l.platingType ?? ""
        platingNote = l.platingNote ?? ""
        nickelFree = l.nickelFree
        silverRate = SaleNumber.text(l.silverRatePerGram)
        fixed = l.isCustomPrice
        customPrice = SaleNumber.text(l.customPrice)
    }

    private func nilIfBlank(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// The line with these edits (the web's `toPatch`).
    func applied(to base: SaleLine) -> SaleLine {
        var out = base
        let silver = metalType == "silver"
        out.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        out.categoryId = categoryId
        out.size = nilIfBlank(size)
        out.metalType = metalType
        // Karat only means something where the metal has one: a stray "21k" on silver is the
        // phantom karat that used to print on 925 pieces.
        out.karat = metalHasKarat(metalType) && !karat.isEmpty ? karat : nil
        out.metalWeightG = SaleNumber.value(weight)
        out.hasStones = hasStones
        out.stoneWeightG = SaleNumber.value(stoneWeight)
        out.wastagePercentage = SaleNumber.value(wastage)
        out.makingCharges = SaleNumber.value(making)
        out.hasDiamonds = hasDiamonds
        out.diamondCharges = SaleNumber.value(diamondCharges)
        out.stoneCharges = SaleNumber.value(stoneCharges)
        out.miscCharges = SaleNumber.value(miscCharges)
        out.stoneDetails = nilIfBlank(stoneDetails)
        out.diamondDetails = nilIfBlank(diamondDetails)
        out.billDescription = nilIfBlank(billDescription)
        out.platingType = silver && !platingType.isEmpty ? platingType : nil
        out.platingNote = silver && platingType == "Other" ? nilIfBlank(platingNote) : nil
        out.nickelFree = silver ? nickelFree : false
        let rate = SaleNumber.value(silverRate)
        out.silverRatePerGram = silver && rate > 0 ? rate : nil
        out.isCustomPrice = fixed
        out.customPrice = fixed ? SaleNumber.value(customPrice) : nil
        return out
    }
}

// MARK: What the screen does to the draft

/// The draft's changes, as the screen makes them (pure, so the contract tests build a sale the way the
/// screen does and not by hand).
extension SaleDraft {
    /// A customer picked from the book, or nil for a walk-in. A customer with no number keeps the one typed.
    mutating func pick(_ c: Customer?) {
        guard let c else {
            customerId = nil
            customerName = ""
            customerPhone = ""
            return
        }
        customerId = c.id
        customerName = c.name
        if let p = c.phone, !p.isEmpty { customerPhone = p }
    }

    /// Typing a name lets go of a customer picked from the book, as the web's name box does.
    mutating func typeName(_ text: String) {
        customerName = text
        customerId = nil
    }

    /// A change to one exchange row: ERPCore's rule (grams × rate refills the amount until one is typed).
    mutating func changeExchange(_ id: String, _ patch: ExchangeRowPatch) {
        guard let i = exchanges.firstIndex(where: { $0.id == id }) else { return }
        exchanges[i] = SaleExchangeRow(applyExchangeRowChange(exchanges[i].core, patch))
    }

    mutating func addExchange() { exchanges.append(SaleExchangeRow.blank()) }

    mutating func removeExchange(_ id: String) {
        exchanges.removeAll { $0.id == id }
        if exchanges.isEmpty { exchanges = [SaleExchangeRow.blank()] }
    }

    /// Another payment row: the other method from the last one, as the web offers.
    mutating func addPayment() {
        payments.append(SalePaymentRow(method: payments.last?.method == "Cash" ? "Card" : "Cash"))
    }

    mutating func removePayment(_ id: String) {
        payments.removeAll { $0.id == id }
        if payments.isEmpty { payments = [SalePaymentRow()] }
    }

    /// "Paid in full" / "The rest": the row takes whatever the other rows leave outstanding of `total`,
    /// in whole rupees (sale-page.tsx `payRestWith`).
    mutating func payRest(_ id: String, total: Double) {
        let others = payments.filter { $0.id != id }.reduce(0.0) { $0 + SaleNumber.value($1.amount) }
        let rest = max(0, (total - others).rounded())
        if let i = payments.firstIndex(where: { $0.id == id }) {
            payments[i].amount = rest > 0 ? String(Int(rest)) : ""
        }
    }
}

// MARK: Lists the sale offers

/// lib/categories.ts `staticCategories`, for the edit sheet's Category.
// TODO(logic): port staticCategories (categories.ts) into ERPCore.
struct SaleCategory: Identifiable {
    let id: String
    let title: String
}

enum SaleCategories {
    private static let pairs: [(String, String)] = [
        ("cat001", "Rings"), ("cat002", "Tops"), ("cat003", "Balis"), ("cat004", "Lockets"),
        ("cat005", "Bracelets"), ("cat006", "Bracelet and Ring Set"), ("cat007", "Bangles"),
        ("cat008", "Chains"), ("cat009", "Bands"), ("cat010", "Locket Sets without Bangle"),
        ("cat011", "Locket Set with Bangle"), ("cat012", "String Sets"),
        ("cat013", "Stone Necklace Sets without Bracelets"), ("cat014", "Stone Necklace Sets with Bracelets"),
        ("cat015", "Gold Necklace Sets with Bracelets"), ("cat016", "Gold Necklace Sets without Bracelets"),
        ("cat017", "Gold Coins"), ("cat018", "Men's Rings"), ("cat019", "Loose Bracelet"),
        ("cat020", "Men's Buttons"),
    ]

    static let all: [SaleCategory] = pairs.map { SaleCategory(id: $0.0, title: $0.1) }

    static func title(_ id: String) -> String? { all.first { $0.id == id }?.title }
}

/// store.ts `PLATING_TYPES`: the finishes offered on 925 silver.
// TODO(logic): port PLATING_TYPES (store.ts) into ERPCore.
enum SalePlating {
    static let all = ["White Rhodium", "21K Gold Plating", "18K Gold Plating", "Chandi White Plating", "Other"]
}

/// units.ts `GRAMS_PER_TOLA`: the figure the trade uses here.
// TODO(logic): port GRAMS_PER_TOLA (units.ts) into ERPCore.
let SALE_GRAMS_PER_TOLA = 11.664
