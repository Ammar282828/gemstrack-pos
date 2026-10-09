import Foundation
import ERPCore

// New sale's contract cases: sales built the way the screen builds them, and what the screen shows before
// Save, against what the ERP saves when it prices the same payload again (contract.test.ts).
//
// Every case goes through the screen's own code: a piece from the shelf is `SaleLine(product)`, an edit is
// `SaleLineFields.applied`, a customer is `SaleDraft.pick` / `typeName`, an exchange row is ERPCore's
// `applyExchangeRowChange` through `SaleDraft.changeExchange`, "Paid in full" is `SaleDraft.payRest`, the
// figures are `SaleFigures`, and what is sent is `SaleDraft.payload`, the dictionary the screen hands to
// `ERPAPI.write("createInvoice", …)`. Names, numbers and shops are made up.

// MARK: The shops' settings

private let taheriShop: [String: Any] = [
    "shopName": "Demo Gold Shop", "lastInvoiceNumber": 120,
    "goldRatePerGram24k": 38500, "goldRatePerGram22k": 35300, "goldRatePerGram21k": 33700, "goldRatePerGram18k": 28900,
    "palladiumRatePerGram": 12000, "palladiumRatePerGram18k": 15000, "palladiumRatePerGram12k": 9000,
    "platinumRatePerGram": 21000, "silverRatePerGram": 480,
]

private let minaShop: [String: Any] = [
    "shopName": "Demo Silver Shop", "lastInvoiceNumber": 7,
    "goldRatePerGram24k": 38500, "goldRatePerGram22k": 35300, "goldRatePerGram21k": 33700, "goldRatePerGram18k": 28900,
    "palladiumRatePerGram": 0, "palladiumRatePerGram18k": 0, "palladiumRatePerGram12k": 0,
    "platinumRatePerGram": 0, "silverRatePerGram": 480,
]

private let sana: [String: Any] = ["id": "CUST-D01", "name": "Sana Demo", "phone": "+923000000101", "address": "Flat 12, Demo Street"]
private let bilal: [String: Any] = ["id": "CUST-D02", "name": "Bilal Example", "phone": "+923000000102"]

/// A stock document as the shelf has it.
private func product(_ sku: String, _ name: String, _ more: [String: Any] = [:], drop: [String] = []) -> [String: Any] {
    var d: [String: Any] = [
        "sku": sku, "name": name, "categoryId": "cat001", "metalType": "gold", "karat": "21k", "metalWeightG": 0,
        "hasStones": false, "stoneWeightG": 0, "wastagePercentage": 0, "makingCharges": 0,
        "hasDiamonds": false, "diamondCharges": 0, "stoneCharges": 0, "miscCharges": 0,
    ]
    for (k, v) in more { d[k] = v }
    for k in drop { d[k] = nil }
    return d
}

private func silverPiece(_ sku: String, _ name: String, _ more: [String: Any] = [:]) -> [String: Any] {
    product(sku, name, ["metalType": "silver"].merging(more) { _, new in new }, drop: ["karat"])
}

// MARK: A sale, built as the screen builds it

private struct Rig {
    var draft = SaleDraft()
    let shop: [String: Any]
    var stock: [String: [String: Any]] = [:]
    var customers: [[String: Any]] = []
    private var oneOffs = 0

    init(shop: [String: Any], customers: [[String: Any]] = []) {
        self.shop = shop
        self.customers = customers
    }

    // The shelf and the books.

    /// A piece from stock goes on the sale (`SaleLine(product)`, as a tap on a search result does).
    mutating func add(_ doc: [String: Any]) {
        let sku = doc["sku"] as! String
        stock[sku] = doc
        let line = SaleLine(decode(Product.self, sku, doc))
        // Opening the line editor on a piece and pressing Apply, changing nothing, must not change its price.
        precondition(SaleLineFields(line).applied(to: line).priced == line.priced,
                     "\(sku): applying the line editor with no change moved a figure of the piece")
        draft.lines.append(line)
    }

    /// The line editor on a piece already on the sale.
    mutating func edit(_ sku: String, _ change: (inout SaleLineFields) -> Void) {
        guard let i = draft.lines.firstIndex(where: { $0.sku == sku }) else { fatalError("no \(sku) on the sale") }
        var f = SaleLineFields(draft.lines[i])
        change(&f)
        draft.lines[i] = f.applied(to: draft.lines[i])
    }

    /// "New item": a blank piece (the house's metal), described in the editor, added to the sale. Its key
    /// is NEW- and it has no stock. The editor will not add a piece without a name.
    @discardableResult
    mutating func newItem(_ name: String, _ change: (inout SaleLineFields) -> Void) -> String {
        precondition(!name.trimmingCharacters(in: .whitespaces).isEmpty, "a new item needs a name")
        oneOffs += 1
        let when = Date(timeIntervalSince1970: 1_790_000_000 + Double(oneOffs))
        var line = SaleLine(blankFor: House.metal, sku: SaleLine.newItemSku(now: when, avoiding: Set(draft.lines.map { $0.sku })))
        line.name = name
        var f = SaleLineFields(line)
        change(&f)
        let made = f.applied(to: line)
        draft.lines.append(made)
        return made.sku
    }

    mutating func pick(_ c: [String: Any]) {
        draft.pick(decode(Customer.self, c["id"] as! String, c))
    }

    mutating func type(name: String, phone: String) {
        draft.typeName(name)
        draft.customerPhone = phone
    }

    // Exchange and payments.

    mutating func exchange(_ index: Int, _ patches: [ExchangeRowPatch]) {
        while draft.exchanges.count <= index { draft.addExchange() }
        for p in patches { draft.changeExchange(draft.exchanges[index].id, p) }
    }

    /// Payment row `index` (adding rows as "Add another payment" does).
    mutating func pay(_ index: Int, _ amount: String, _ method: String = "Cash", ref: String = "") {
        while draft.payments.count <= index { draft.addPayment() }
        draft.payments[index].amount = amount
        draft.payments[index].method = method
        draft.payments[index].reference = ref
    }

    /// "Paid in full" on row `index`.
    mutating func payInFull(_ index: Int = 0, _ method: String = "Cash", ref: String = "") {
        pay(index, "", method, ref: ref)
        draft.payRest(draft.payments[index].id, total: figures().total)
    }

    // The screen's figures, and the case.

    func settings() -> Settings { decode(Settings.self, "global", shop) }

    func figures(_ d: SaleDraft? = nil) -> SaleFigures {
        SaleFigures(
            draft: d ?? draft, settings: settings(),
            customers: customers.map { decode(Customer.self, $0["id"] as! String, $0) },
            marginSettings: House.margin
        )
    }

    func build(_ name: String) -> ContractCase {
        let f = figures()
        // The screen only sends a sale it lets be saved.
        guard f.canSave else { fatalError("\(name): the screen would not save this sale: \(f.blockedReason ?? "?")") }
        let send = draft.payload(f) { sku in self.stock[sku].flatMap { decode(Product.self, sku, $0).qrCodeDataUrl } }
        return ContractCase(
            name: name, house: House.id, send: send,
            shown: ["subtotal": f.subtotal, "discount": f.discount, "grandTotal": f.total, "paid": f.paidNow, "balanceDue": f.balance],
            settings: shop, stock: stock, customers: customers, draft: draft.webValues(subtotal: f.subtotal)
        )
    }
}

// MARK: Cases

enum SaleCases {
    static func taheri() -> [ContractCase] {
        [
            walkInPaysExactly(), walkInPaysPart(), namedPaysPart(), namedOverpays(), newCustomerTyped(), numberOnFile(),
            discountEqualToSubtotal(), twoExchangeRows(), exchangeBeyondThePieces(), threePayments(),
            oneOffByWeight(), oneOffAtFixedPrice(), repricedStock(), fourKarats(), decimalGrams(), paiseInTheTotal(),
            paidInFullRoundsDown(), paidInFullRoundsUp(), longDecimals(), oneCrore(), palladium18kAlone(), palladiumWithoutKarat(), goldCoin(),
            aRateTypedOnTheSale(), metalsMixed(), stonesAndSecondMetal(), goldWithoutKarat(), everyShopField(),
        ]
    }

    static func mina() -> [ContractCase] {
        [
            silverPieces(), silverAndGold(), plating(), silverDiscountPartExchange(), silverOneOffs(),
            silverRepriced(), silverPaidInFull(), silverCreditForNamed(),
        ]
    }

    // MARK: Taheri

    private static var ring: [String: Any] {
        product("RNG-1001", "Twist band", ["metalWeightG": 4.0, "wastagePercentage": 10, "makingCharges": 5000])
    }
    private static var hoops: [String: Any] {
        product("ERG-2001", "Hoop earrings", ["categoryId": "cat002", "metalWeightG": 5.1, "wastagePercentage": 10, "makingCharges": 7000])
    }
    private static var bangle: [String: Any] {
        product("BNG-3001", "Carved bangle", ["categoryId": "cat007", "karat": "22k", "metalWeightG": 18.4, "wastagePercentage": 6.5, "makingCharges": 9000])
    }

    /// A walk-in pays the whole bill in cash with "Paid in full": nothing is owed, nothing is booked.
    private static func walkInPaysExactly() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(ring)
        r.payInFull()
        return r.build("a walk-in pays exactly in cash")
    }

    /// Part paid: the rest is booked on the walk-in's hisaab, which has no customer.
    private static func walkInPaysPart() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(hoops)
        r.add(bangle)
        r.pay(0, "100000")
        return r.build("a walk-in pays part, the balance goes on the walk-in hisaab")
    }

    private static func namedPaysPart() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana, bilal])
        r.add(bangle)
        r.pick(sana)
        r.pay(0, "50000", "Card", ref: "4321")
        return r.build("a named customer pays part by card")
    }

    /// Paid past the total by a named customer: the extra is their credit, held on their hisaab.
    private static func namedOverpays() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana, bilal])
        r.add(ring)
        r.pick(bilal)
        let total = r.figures().total
        r.pay(0, String(Int(total.rounded()) + 25000), "Bank Transfer", ref: "TRX-100234")
        return r.build("a named customer overpays, so the credit is held")
    }

    /// A name and a number nobody has: the ERP makes the customer when the sale is saved.
    private static func newCustomerTyped() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana])
        r.add(hoops)
        r.type(name: "Nadia Example", phone: "0300 0000555")
        r.pay(0, "60000")
        return r.build("a new customer typed by name and number")
    }

    /// Only a number typed, and it is Sana's: the sale goes to her, not to a copy of her.
    private static func numberOnFile() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana, bilal])
        r.add(ring)
        r.type(name: "", phone: "0300 0000101")
        r.pay(0, "20000")
        return r.build("a number already on file is that customer")
    }

    /// The most a discount can be: the whole subtotal. The sale comes to nothing. (More than the subtotal is
    /// refused by the screen, checked here.)
    private static func discountEqualToSubtotal() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("FX-1301", "Antique piece", ["metalWeightG": 9.2, "isCustomPrice": true, "customPrice": 87650]))
        r.draft.discount = "87650"
        var over = r.draft
        over.discount = "87651"
        precondition(!r.figures(over).canSave, "a discount over the subtotal must not be saveable")
        return r.build("a discount equal to the subtotal")
    }

    /// Two exchange rows: one worked from grams × rate, one typed.
    private static func twoExchangeRows() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana])
        r.add(bangle)
        r.add(hoops)
        r.pick(sana)
        r.exchange(0, [ExchangeRowPatch(description: "Old ring"), ExchangeRowPatch(karat: "22k"),
                       ExchangeRowPatch(weightG: "5.2"), ExchangeRowPatch(ratePerGram: "30000")])
        r.exchange(1, [ExchangeRowPatch(description: "Broken chain"), ExchangeRowPatch(value: "40000")])
        r.pay(0, "100000")
        return r.build("two exchange rows")
    }

    /// What is handed over is worth more than the pieces: the bill is below nothing, which a named customer
    /// holds as credit.
    private static func exchangeBeyondThePieces() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [bilal])
        r.add(product("PND-6001", "Pendant", ["categoryId": "cat004", "karat": "24k", "metalWeightG": 2.5, "wastagePercentage": 5, "makingCharges": 3000]))
        r.pick(bilal)
        r.exchange(0, [ExchangeRowPatch(description: "Old set"), ExchangeRowPatch(value: "300000")])
        return r.build("an exchange worth more than the pieces, for a named customer")
    }

    private static func threePayments() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana])
        r.add(bangle)
        r.add(hoops)
        r.pick(sana)
        r.pay(0, "100000", "Cash")
        r.pay(1, "75000", "Card", ref: "9921")
        r.pay(2, "50000", "Bank Transfer", ref: "TRX-884412")
        return r.build("three payments by three methods")
    }

    /// A piece described on the spot, never in stock, priced by its weight and the rate.
    private static func oneOffByWeight() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.newItem("Custom locket") { f in
            f.categoryId = "cat004"; f.karat = "22k"; f.weight = "6.25"; f.wastage = "12"; f.making = "3500"
        }
        r.payInFull()
        return r.build("a one-off NEW- piece priced by weight")
    }

    /// A piece described on the spot at a price agreed, with a weight that only prints.
    private static func oneOffAtFixedPrice() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.newItem("Heirloom piece") { f in
            f.fixed = true; f.customPrice = "98765"; f.weight = "8.5"; f.hasDiamonds = true; f.diamondDetails = "0.5ct round"
        }
        r.add(ring)
        r.pay(0, "150000")
        return r.build("a one-off NEW- piece at a fixed price, with a stock piece")
    }

    /// Pieces from stock re-priced on the sale: one to a fixed price, one by a changed weight and making.
    private static func repricedStock() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(ring)
        r.add(bangle)
        r.edit("RNG-1001") { f in f.fixed = true; f.customPrice = "99999" }
        r.edit("BNG-3001") { f in f.weight = "19.05"; f.making = "11250.5"; f.wastage = "7" }
        r.pay(0, "100000")
        return r.build("re-priced stock pieces")
    }

    private static func fourKarats() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("K18-1", "Eighteen", ["categoryId": "cat008", "karat": "18k", "metalWeightG": 7.25, "wastagePercentage": 9, "makingCharges": 4000]))
        r.add(product("K21-1", "Twenty-one", ["karat": "21k", "metalWeightG": 3.9, "wastagePercentage": 10, "makingCharges": 2500]))
        r.add(product("K22-1", "Twenty-two", ["categoryId": "cat007", "karat": "22k", "metalWeightG": 11.2, "wastagePercentage": 6, "makingCharges": 6000]))
        r.add(product("K24-1", "Twenty-four", ["categoryId": "cat004", "karat": "24k", "metalWeightG": 2.15, "wastagePercentage": 3, "makingCharges": 1500]))
        r.pay(0, "250000")
        return r.build("18k, 21k, 22k and 24k pieces in one sale")
    }

    private static func decimalGrams() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("DG-1", "Fine chain", ["categoryId": "cat008", "karat": "22k", "metalWeightG": 3.456, "wastagePercentage": 7.5, "makingCharges": 1234.5]))
        r.add(product("DG-2", "Heavy kara", ["categoryId": "cat007", "karat": "21k", "metalWeightG": 12.875, "wastagePercentage": 9.25, "makingCharges": 999.99]))
        r.add(product("DG-3", "Tiny stud", ["karat": "18k", "metalWeightG": 0.123, "wastagePercentage": 12.5, "makingCharges": 150]))
        r.pay(0, "50000")
        return r.build("decimal grams")
    }

    /// A total with paise in it, part paid: what is owed is booked to the paisa.
    private static func paiseInTheTotal() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana])
        r.add(product("PS-1", "Odd weight", ["karat": "22k", "metalWeightG": 4.337, "wastagePercentage": 6.75, "makingCharges": 1250.5, "stoneCharges": 333.33]))
        r.pick(sana)
        r.pay(0, "100000")
        return r.build("paise in the total, part paid")
    }

    /// "Paid in full" pays whole rupees: when the total has paise that round down, the paise stay owed.
    private static func paidInFullRoundsDown() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("PD-9", "Price with paise", ["isCustomPrice": true, "customPrice": 12345.4]))
        r.payInFull()
        return r.build("paid in full when the total has paise that round down")
    }

    /// "Paid in full" pays whole rupees: when the paise round up, the 40 paise over are settled, not credit
    /// (under half a rupee either way is settled, lib/invoice-credit inCredit): the invoice says -0.40 and
    /// the books hold nothing for it.
    private static func paidInFullRoundsUp() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("PU-9", "Price with paise, up", ["isCustomPrice": true, "customPrice": 12345.6]))
        r.payInFull()
        return r.build("paid in full when the total has paise that round up")
    }

    /// A piece weighed and charged to more decimals than anyone types: the line editor keeps every digit.
    private static func longDecimals() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("LD-1", "Long decimals", ["karat": "22k", "metalWeightG": 3.45678, "wastagePercentage": 7.123456, "makingCharges": 1234.56789]))
        r.edit("LD-1") { f in f.billDescription = "Engraved" }
        r.pay(0, "100000")
        return r.build("a piece with long decimals, opened in the editor")
    }

    /// A piece of 1 crore and a little over, by weight.
    private static func oneCrore() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [bilal])
        r.add(product("BIG-1401", "Show piece", ["categoryId": "cat015", "metalWeightG": 268.5, "wastagePercentage": 10, "makingCharges": 100000]))
        r.pick(bilal)
        r.pay(0, "10000000", "Bank Transfer", ref: "TRX-770001")
        return r.build("a one-crore piece")
    }

    /// Palladium 18k on its own: the per-karat rate prices it, not the flat one.
    private static func palladium18kAlone() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("PD-7001", "Palladium band", ["categoryId": "cat009", "metalType": "palladium", "karat": "18k", "metalWeightG": 7.5, "wastagePercentage": 5, "makingCharges": 4000]))
        r.pay(0, "60000")
        return r.build("palladium 18k alone")
    }

    /// Palladium with no karat takes the flat rate.
    private static func palladiumWithoutKarat() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("PD-7002", "Palladium ring", ["metalType": "palladium", "metalWeightG": 4.2, "wastagePercentage": 5, "makingCharges": 2000], drop: ["karat"]))
        r.add(product("PD-7003", "Palladium 12k", ["metalType": "palladium", "karat": "12k", "metalWeightG": 3.3, "makingCharges": 1000]))
        r.payInFull()
        return r.build("palladium without a karat takes the flat rate, with a 12k piece")
    }

    /// A gold coin is its metal and nothing else: making, wastage, diamonds, stones and sundries are ignored.
    private static func goldCoin() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("COIN-5001", "One tola coin", [
            "categoryId": "cat017", "karat": "24k", "metalWeightG": 11.664, "wastagePercentage": 10, "makingCharges": 5000,
            "hasDiamonds": true, "diamondCharges": 9000, "stoneCharges": 700, "miscCharges": 300,
        ]))
        r.payInFull()
        return r.build("a gold coin ignores making, wastage and stones")
    }

    /// The 21k box typed on this sale prices it; the shop's rate is left as it was.
    private static func aRateTypedOnTheSale() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(ring)
        r.add(bangle)
        r.draft.rates["gold21k"] = "34250.50"
        r.pay(0, "70000")
        return r.build("a rate typed on the sale prices it")
    }

    /// Gold, platinum and silver on one bill: each at its own rate.
    private static func metalsMixed() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(ring)
        r.add(product("PT-8001", "Platinum band", ["categoryId": "cat009", "metalType": "platinum", "metalWeightG": 5.5, "wastagePercentage": 8, "makingCharges": 3000], drop: ["karat"]))
        r.add(silverPiece("SLV-9001", "Silver ring", ["metalWeightG": 6.2, "silverRatePerGram": 520, "stoneCharges": 300]))
        r.add(silverPiece("SLV-9002", "Silver chain", ["categoryId": "cat008", "metalWeightG": 18]))
        r.pay(0, "100000")
        return r.build("gold, platinum and silver on one bill")
    }

    /// Stones' weight comes off the metal; a second metal is added; diamonds, stones and making are charged.
    private static func stonesAndSecondMetal() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("STN-1101", "Ruby ring", [
            "metalWeightG": 10, "stoneWeightG": 1.5, "hasStones": true, "stoneCharges": 2500, "hasDiamonds": true,
            "diamondCharges": 18000, "wastagePercentage": 9, "makingCharges": 6000,
            "secondaryMetalType": "gold", "secondaryMetalKarat": "18k", "secondaryMetalWeightG": 2,
        ]))
        r.pay(0, "150000")
        return r.build("stones, diamonds and a second metal")
    }

    /// Gold with no karat is priced as 21k.
    private static func goldWithoutKarat() -> ContractCase {
        var r = Rig(shop: taheriShop)
        r.add(product("NK-1201", "Unmarked piece", ["metalWeightG": 5, "wastagePercentage": 10, "makingCharges": 2000], drop: ["karat"]))
        r.payInFull()
        return r.build("gold with no karat is priced as 21k")
    }

    /// Every optional field of a sale at once: taken by, rates off the bill, a note, delivery, the 24k rate.
    private static func everyShopField() -> ContractCase {
        var r = Rig(shop: taheriShop, customers: [sana])
        r.add(ring)
        r.add(hoops)
        r.pick(sana)
        r.draft.takenBy = "Ammar"
        r.draft.hideRates = true
        r.draft.internalNote = "  Resize the ring by Friday  "
        r.draft.costTola = "450000"
        r.draft.delivery.required = true
        r.draft.delivery.address = "Flat 12, Demo Street"
        r.draft.delivery.city = "Karachi"
        r.draft.delivery.expectedDate = "2026-10-20"
        r.draft.delivery.contactName = "Zara Example"
        r.draft.delivery.contactPhone = "0300 0000777"
        r.draft.delivery.charge = "500"
        r.draft.delivery.notes = "Gate 3, after 5 pm"
        r.pay(0, "80000", "Cheque", ref: "CHQ-0042")
        return r.build("every optional field of a sale")
    }

    // MARK: Mina (silver)

    private static var silverRing: [String: Any] {
        silverPiece("MS-1001", "Silver ring", ["metalWeightG": 6, "stoneCharges": 300])
    }
    private static var silverBracelet: [String: Any] {
        silverPiece("MS-1002", "Silver bracelet", ["categoryId": "cat005", "metalWeightG": 14.2, "silverRatePerGram": 650])
    }

    private static func silverPieces() -> ContractCase {
        var r = Rig(shop: minaShop)
        r.add(silverRing)
        r.add(silverBracelet)
        r.pay(0, "5000")
        return r.build("silver pieces, one at the shop's rate and one at its own")
    }

    private static func silverAndGold() -> ContractCase {
        var r = Rig(shop: minaShop, customers: [sana])
        r.add(silverRing)
        r.add(product("MG-2001", "Gold stud", ["metalWeightG": 1.8, "wastagePercentage": 10, "makingCharges": 2500]))
        r.pick(sana)
        r.pay(0, "30000", "Card", ref: "5521")
        return r.build("silver and gold mixed")
    }

    /// Plating and nickel-free are on the bill, not in the price.
    private static func plating() -> ContractCase {
        var r = Rig(shop: minaShop)
        r.add(silverPiece("MS-1003", "Silver pendant", ["categoryId": "cat004", "metalWeightG": 3.75, "stoneCharges": 150]))
        r.add(silverPiece("MS-1004", "Silver bangle", ["categoryId": "cat007", "metalWeightG": 22.4]))
        r.edit("MS-1003") { f in f.platingType = "White Rhodium"; f.nickelFree = true }
        r.edit("MS-1004") { f in f.platingType = "Other"; f.platingNote = "Rose gold plating" }
        r.payInFull()
        return r.build("plating")
    }

    private static func silverDiscountPartExchange() -> ContractCase {
        var r = Rig(shop: minaShop)
        r.add(silverRing)
        r.add(silverBracelet)
        r.type(name: "Farah Example", phone: "0300 0000888")
        r.draft.discount = "1,500"
        r.exchange(0, [ExchangeRowPatch(description: "Old silver ring"), ExchangeRowPatch(weightG: "10"), ExchangeRowPatch(ratePerGram: "400")])
        r.pay(0, "5000")
        return r.build("a discount, a partial payment and an exchange")
    }

    /// Pieces described on the spot in a silver house: the house's metal, no wastage; one by weight, one fixed.
    private static func silverOneOffs() -> ContractCase {
        var r = Rig(shop: minaShop)
        r.newItem("Custom silver set") { f in f.categoryId = "cat006"; f.weight = "31.4"; f.stoneCharges = "1200" }
        r.newItem("Gifted piece, agreed price") { f in f.fixed = true; f.customPrice = "7500"; f.weight = "12" }
        r.pay(0, "10000")
        return r.build("one-off silver pieces, by weight and at a fixed price")
    }

    private static func silverRepriced() -> ContractCase {
        var r = Rig(shop: minaShop)
        r.add(silverRing)
        r.add(silverBracelet)
        r.edit("MS-1001") { f in f.fixed = true; f.customPrice = "3200" }
        r.edit("MS-1002") { f in f.silverRate = "610"; f.weight = "14.25" }
        r.pay(0, "4000")
        return r.build("silver pieces re-priced on the sale")
    }

    private static func silverPaidInFull() -> ContractCase {
        var r = Rig(shop: minaShop)
        r.add(silverRing)
        r.payInFull()
        return r.build("silver paid in full in cash")
    }

    private static func silverCreditForNamed() -> ContractCase {
        var r = Rig(shop: minaShop, customers: [bilal])
        r.add(silverBracelet)
        r.pick(bilal)
        let total = r.figures().total
        r.pay(0, String(Int(total.rounded()) + 2000), "Bank Transfer", ref: "TRX-30011")
        return r.build("a named customer overpays a silver sale")
    }
}
