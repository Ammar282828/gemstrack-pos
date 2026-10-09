import Foundation
import ERPCore

// Read a slip: what the ERP's reader (/api/vision/order, the same route the browser's "Scan a parchi" calls) read
// off a parchi, and that reading laid into the order form. Ported from lib/vision/order-draft.ts (the slip's own
// arithmetic, `reconcileSlip`), lib/vision/wastage.ts (wastage in grams as the percent the ERP prices with) and
// order-form.tsx `applyScan` (what lands in which box), line for line.
//
// It fills the form and stops. Nothing is saved here: every figure lands as an ordinary, editable field, the
// pieces are added to whatever the order already has, and the person checks them against the paper and presses
// Save. The slip's own totals are never copied in as prices; they are checked against the reading, and a slip
// that does not add up is shown, never corrected.

// MARK: What the reader answers

/// One piece written on the slip (order-draft.ts `DraftItem`). Every field may be missing: the reader is told to
/// leave a figure out rather than guess it.
struct NewOrderScanItem: Decodable, Equatable {
    var description: String?
    /// The reader's word for it ("Ring", "Chain": `ORDER_CATEGORIES`), not a category id.
    var itemCategory: String?
    var metalType: String?
    var karat: Double?
    /// Grams, as weighed: before any stone weight comes off.
    var weightG: Double?
    var weightWasTola: Bool?
    var stoneWeightG: Double?
    var wastageG: Double?
    /// The piece's whole making, in rupees (multiplied out when the slip wrote it per gram).
    var makingCharges: Double?
    var makingWasPerGram: Bool?
    var stoneCharges: Double?
    /// The slip's metal rate for this piece, per gram (converted when written per tola).
    var ratePerGram: Double?
    var rateWasPerTola: Bool?
    var wastagePercent: Double?
    /// The amount written against the piece: copied, never computed.
    var lineTotal: Double?
    var size: String?
    var stoneDetails: String?
    /// 1-based: which photo is a picture of this piece, when one is.
    var photoIndex: Double?
    var note: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        description = c.string(AnyKey("description"))
        itemCategory = c.string(AnyKey("itemCategory"))
        metalType = c.string(AnyKey("metalType"))
        karat = c.double(AnyKey("karat"))
        weightG = c.double(AnyKey("weightG"))
        weightWasTola = c.bool(AnyKey("weightWasTola"))
        stoneWeightG = c.double(AnyKey("stoneWeightG"))
        wastageG = c.double(AnyKey("wastageG"))
        makingCharges = c.double(AnyKey("makingCharges"))
        makingWasPerGram = c.bool(AnyKey("makingWasPerGram"))
        stoneCharges = c.double(AnyKey("stoneCharges"))
        ratePerGram = c.double(AnyKey("ratePerGram"))
        rateWasPerTola = c.bool(AnyKey("rateWasPerTola"))
        wastagePercent = c.double(AnyKey("wastagePercent"))
        lineTotal = c.double(AnyKey("lineTotal"))
        size = c.string(AnyKey("size"))
        stoneDetails = c.string(AnyKey("stoneDetails"))
        photoIndex = c.double(AnyKey("photoIndex"))
        note = c.string(AnyKey("note"))
    }
}

/// Old gold or jewellery handed over against the order (`DraftExchange`).
struct NewOrderScanExchange: Decodable, Equatable {
    var description: String?
    var weightG: Double?
    var weightWasTola: Bool?
    var karat: Double?
    /// The rate written against the OLD gold, per gram: often below the day's.
    var ratePerGram: Double?
    var rateWasPerTola: Bool?
    /// The deduction as written; nil when the slip gave only a weight.
    var value: Double?
    var note: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        description = c.string(AnyKey("description"))
        weightG = c.double(AnyKey("weightG"))
        weightWasTola = c.bool(AnyKey("weightWasTola"))
        karat = c.double(AnyKey("karat"))
        ratePerGram = c.double(AnyKey("ratePerGram"))
        rateWasPerTola = c.bool(AnyKey("rateWasPerTola"))
        value = c.double(AnyKey("value"))
        note = c.string(AnyKey("note"))
    }
}

/// The whole reading (`RawOrderDraft`). Names come back as written; the book is matched on the phone.
struct NewOrderScanAnswer: Decodable, Equatable {
    var items: [NewOrderScanItem] = []
    var karigarNameHeard: String?
    var customerNameHeard: String?
    var customerPhone: String?
    /// Cash advance. Gold handed over is the exchange, never this.
    var advancePayment: Double?
    var exchange: NewOrderScanExchange?
    var discount: Double?
    /// The foot of the slip as written: copied, never recomputed.
    var subtotal: Double?
    var balanceDue: Double?
    var expectedDate: String?
    var notes: String?
    /// What the reader could not make out, shown rather than hidden.
    var unreadable: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        items = c.list(AnyKey("items"))
        karigarNameHeard = c.string(AnyKey("karigarNameHeard"))
        customerNameHeard = c.string(AnyKey("customerNameHeard"))
        customerPhone = c.string(AnyKey("customerPhone"))
        advancePayment = c.double(AnyKey("advancePayment"))
        exchange = c.object(AnyKey("exchange"))
        discount = c.double(AnyKey("discount"))
        subtotal = c.double(AnyKey("subtotal"))
        balanceDue = c.double(AnyKey("balanceDue"))
        expectedDate = c.string(AnyKey("expectedDate"))
        notes = c.string(AnyKey("notes"))
        unreadable = c.string(AnyKey("unreadable"))
    }

    /// The route's JSON; nil when it is not a reading at all.
    static func read(_ data: Data) -> NewOrderScanAnswer? {
        guard (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return nil }
        return try? JSONDecoder().decode(NewOrderScanAnswer.self, from: data)
    }
}

/// The reading with its names matched against the book (`resolveDraft`): the person picks from here.
struct NewOrderScanReading: Equatable {
    var answer: NewOrderScanAnswer
    var karigar: PaperNameGuess?
    var customer: PaperNameGuess?

    /// Customers who are people (removed ones and the old walk-in records are not), and karigars not removed.
    static func resolve(_ answer: NewOrderScanAnswer, customers: [Customer], karigars: [Karigar]) -> NewOrderScanReading {
        let people = NewOrderMath.people(customers).map { PaperPerson(id: $0.id, name: $0.name) }
        let makers = karigars.filter { ($0.deletedAt ?? "").isEmpty }.map { PaperPerson(id: $0.id, name: $0.name) }
        return NewOrderScanReading(
            answer: answer,
            karigar: PaperNames.guess(answer.karigarNameHeard, pool: makers),
            customer: PaperNames.guess(answer.customerNameHeard, pool: people)
        )
    }
}

// MARK: The slip's own arithmetic (order-draft.ts)

enum NewOrderSlip {
    /// `num`: a figure that is there and above nothing, else 0.
    static func num(_ v: Double?) -> Double {
        guard let v, v.isFinite, v > 0 else { return 0 }
        return v
    }

    /// `Math.round`: a half goes up.
    static func jsRound(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        let down = x.rounded(.down)
        return x - down >= 0.5 ? down + 1 : down
    }

    /// `String(n)` for the figures a slip carries (no exponents at these sizes): 5.2, 12, 0.65.
    static func jsNumber(_ x: Double) -> String {
        guard x.isFinite else { return "0" }
        if x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
        return "\(x)"
    }

    /// A figure back into a box: the exact number the browser's form holds, blank for nothing (decision
    /// "Number fields").
    static func box(_ x: Double) -> String { x == 0 ? "" : jsNumber(x) }

    private static let pk: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 3
        f.roundingMode = .halfUp
        return f
    }()

    /// `toLocaleString('en-PK')`: 245,000 and 2,958.333.
    static func pkNumber(_ x: Double) -> String { pk.string(from: NSNumber(value: x)) ?? jsNumber(x) }

    /// `money`: whole rupees, grouped.
    static func money(_ x: Double) -> String { pkNumber(jsRound(x)) }

    /// The trade's tola (lib/units.ts GRAMS_PER_TOLA, order-draft.ts TOLA_G).
    static let tolaG = NewOrderWords.gramsPerTola

    /// lib/vision/wastage.ts `wastagePercentOf`: a percent written wins; grams written are a percent of the metal
    /// the ERP prices (the weight less any stone weight taken off), to two places, so 0.650 on 6.500 is 10.
    static func wastagePercentOf(weightG: Double?, stoneWeightG: Double?, wastageG: Double?, wastagePercent: Double?) -> Double? {
        let round2 = { (n: Double) in jsRound(n * 100) / 100 }
        let pct = wastagePercent ?? .nan
        if pct > 0 { return round2(pct) }
        let grams = wastageG ?? .nan
        let metal = (weightG ?? 0) - (stoneWeightG ?? 0)
        if grams > 0 && metal > 0 { return round2((grams / metal) * 100) }
        return nil
    }

    static func wastagePercentOf(_ it: NewOrderScanItem) -> Double? {
        wastagePercentOf(weightG: it.weightG, stoneWeightG: it.stoneWeightG, wastageG: it.wastageG, wastagePercent: it.wastagePercent)
    }

    /// Does the piece carry a weight: the one figure it takes to price it from a rate?
    static func hasWeight(_ it: NewOrderScanItem) -> Bool { num(it.weightG) > 0 }

    /// Did the slip do the sum for this piece, rather than just name it and a weight?
    static func hasHisaab(_ it: NewOrderScanItem) -> Bool { hasWeight(it) && num(it.ratePerGram) > 0 }

    static let slipMetals = ["gold", "palladium", "platinum", "silver"]

    /// The karats the form takes per metal: a slip that says 20k or 916 gets none rather than a wrong one.
    private static let karatsByMetal: [String: [Int]] = ["gold": [18, 21, 22, 24], "palladium": [12, 18], "platinum": [], "silver": []]

    static func metalFor(_ metalType: String?, fallbackMetal: String) -> String {
        let m = (metalType ?? "").lowercased()
        return slipMetals.contains(m) ? m : fallbackMetal
    }

    static func karatFor(_ karat: Double?, _ metalType: String?, fallbackMetal: String) -> String? {
        let metal = metalFor(metalType, fallbackMetal: fallbackMetal)
        let k = Int(jsRound(num(karat)))
        return (karatsByMetal[metal] ?? []).contains(k) ? "\(k)k" : nil
    }

    /// `slipLinePrice`: rate × the metal (weight less stones), wastage on it when one was written, plus making and
    /// stones, the form's own shape. Nil when the slip gave no rate: a weight alone is not a price.
    static func linePrice(_ it: NewOrderScanItem) -> Double? {
        guard hasHisaab(it) else { return nil }
        let metal = max(0, num(it.weightG) - num(it.stoneWeightG)) * num(it.ratePerGram)
        let wastage = metal * ((wastagePercentOf(it) ?? 0) / 100)
        return jsRound(metal + wastage + num(it.makingCharges) + num(it.stoneCharges))
    }

    enum ExchangeFrom: Equatable { case written, computed, unpriced }

    /// `exchangeValue`: a written figure wins; else a weight AND a rate written against the old gold, multiplied
    /// (the slip's sum, not ours). A weight alone is nothing: borrowing the new piece's rate would give the
    /// customer a price nobody agreed.
    static func exchangeValue(_ ex: NewOrderScanExchange?) -> (value: Double, from: ExchangeFrom) {
        guard let ex else { return (0, .unpriced) }
        if num(ex.value) > 0 { return (num(ex.value), .written) }
        if num(ex.weightG) > 0 && num(ex.ratePerGram) > 0 { return (jsRound(num(ex.weightG) * num(ex.ratePerGram)), .computed) }
        return (0, .unpriced)
    }

    /// `describeExchange`: "Old gold ring · 21k · 5.2 g · at 22,000/g", for the exchange row's words.
    static func describeExchange(_ ex: NewOrderScanExchange?) -> String {
        guard let ex else { return "" }
        var parts: [String] = []
        let what = (ex.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        parts.append(what.isEmpty ? "Gold taken in exchange" : what)
        if num(ex.karat) > 0 { parts.append("\(jsNumber(jsRound(num(ex.karat))))k") }
        if num(ex.weightG) > 0 {
            let tola = ex.weightWasTola == true ? " (\(String(format: "%.3f", num(ex.weightG) / tolaG)) tola on the slip)" : ""
            parts.append("\(jsNumber(num(ex.weightG))) g\(tola)")
        }
        if num(ex.ratePerGram) > 0 {
            parts.append("at \(pkNumber(jsRound(num(ex.ratePerGram))))/g\(ex.rateWasPerTola == true ? " (written per tola)" : "")")
        }
        let from = exchangeValue(ex).from
        if from == .computed { parts.append("value is weight × rate off the slip") }
        if from == .unpriced && num(ex.weightG) > 0 { parts.append("no value written — enter what it was taken at") }
        if let note = ex.note, !note.isEmpty { parts.append(note) }
        return parts.joined(separator: " · ")
    }

    struct Check: Equatable {
        /// One line each, in the reader's words. Empty when everything agrees.
        var warnings: [String] = []
        /// Pieces whose written amount disagrees with their own hisaab, by position.
        var itemsOff: [Int] = []
        /// The pieces, each at its written amount first, then its hisaab.
        var subtotal = 0.0
        /// Subtotal less discount, advance and exchange; nil when no piece could be priced.
        var balance: Double?
    }

    /// `reconcileSlip`: each piece's amount against its own rate × weight, the subtotal against the pieces, the
    /// balance against the subtotal less everything taken off. A rupee or two is rounding; more is a misread
    /// digit or a missed line. Nothing is corrected: the warnings point, the person decides.
    static func check(_ a: NewOrderScanAnswer) -> Check {
        var out = Check()
        var priced = 0
        for (i, it) in a.items.enumerated() {
            let computed = linePrice(it)
            let written = num(it.lineTotal)
            if let computed, written > 0, abs(computed - written) > 2 {
                out.itemsOff.append(i)
                let name = (it.description ?? "").isEmpty ? "Piece \(i + 1)" : it.description!
                out.warnings.append("\(name): the slip writes \(money(written)) but its own rate × weight comes to \(money(computed)). One of those figures was probably misread.")
            }
            let line = written > 0 ? written : (computed ?? 0)
            if line > 0 {
                out.subtotal += line
                priced += 1
            }
        }
        if num(a.subtotal) > 0 && priced > 0 && abs(num(a.subtotal) - out.subtotal) > 2 {
            out.warnings.append("The slip's subtotal is \(money(num(a.subtotal))); the pieces as read come to \(money(out.subtotal)). A line may have been missed or a digit misread.")
        }
        let ex = exchangeValue(a.exchange)
        let off = num(a.discount) + num(a.advancePayment) + ex.value
        let base = num(a.subtotal) > 0 ? num(a.subtotal) : out.subtotal
        out.balance = priced > 0 || num(a.subtotal) > 0 ? base - off : nil
        if num(a.balanceDue) > 0, let balance = out.balance, abs(num(a.balanceDue) - balance) > 2 {
            out.warnings.append("The slip's balance is \(money(num(a.balanceDue))); total less what was taken off comes to \(money(balance)). Check the advance and the exchange line.")
        }
        if let x = a.exchange, ex.from == .unpriced, num(x.weightG) > 0 {
            out.warnings.append("Old gold was taken in exchange but the slip gives no figure for it. Its value is left for you to enter.")
        }
        return out
    }

    /// The reader's words for a piece as the ERP's categories (bill-draft.ts `CATEGORY_BY_WORD`, deliberately
    /// partial: "Set" could be any of seven, so it comes through blank for a person to choose). The browser's
    /// order form puts the bare word in its category box, which then saves a word where an id belongs.
    static let categoryByWord: [String: String] = [
        "Ring": "cat001", "Tops": "cat002", "Earrings": "cat002", "Jhumka": "cat003",
        "Pendant": "cat004", "Bracelet": "cat005", "Bangle": "cat007", "Kara": "cat007",
        "Chain": "cat008",
    ]

    /// The order's rate box for a metal and karat (order-form.tsx `RATE_FIELD`).
    static func rateKey(metal: String, karat: String?) -> RateKey? {
        switch (metal, karat ?? "") {
        case ("gold", "18k"): return .goldRatePerGram18k
        case ("gold", "21k"): return .goldRatePerGram21k
        case ("gold", "22k"): return .goldRatePerGram22k
        case ("gold", "24k"): return .goldRatePerGram24k
        case ("palladium", "18k"): return .palladiumRatePerGram18k
        case ("palladium", "12k"): return .palladiumRatePerGram12k
        default: return nil
        }
    }
}

// MARK: Into the form (order-form.tsx `applyScan`)

extension NewOrderDraft {
    /// The reading laid into the order, as the browser's form lays it:
    ///
    /// - A piece with a weight is priced from the rate, like one typed at the counter; a rate on the slip goes in
    ///   the order's box for that karat, so the form's arithmetic reproduces the slip's. Its wastage is what the
    ///   slip's sum used (the percent, or the grams as a percent of the metal), else none; a bare weight with no
    ///   rate takes the usual 10.
    /// - A figure with no weight is a fixed price at exactly that figure: a weight back-solved from it would be one
    ///   nobody wrote.
    /// - Neither: priced from the rate, the weight left for the person to fill.
    ///
    /// The cash advance, the discount and the old gold land in their own boxes, the customer and karigar only as the
    /// person picked them (`customer` pinned, else the name as written for a new customer). `photos` are the slip's
    /// photos made small for an order (NewOrderPhotoCodec), in the order they were read: a piece the reader said
    /// is in a photo takes that one, else the first piece takes the first, as the order's reference picture.
    /// `settings` seeds today's rates first if the form has not yet, so the slip's rate is never overwritten.
    mutating func fill(fromSlip scan: NewOrderScanAnswer, customer: Customer?, heardCustomer: String?, karigarId: String,
                       photos: [Data], fallbackMetal: String, settings: Settings?) {
        typealias S = NewOrderSlip
        if !ratesSeeded, let settings { seedRates(from: settings) }

        if let customer {
            choose(customer)
        } else if let heard = heardCustomer, !heard.isEmpty {
            // Nobody pinned: the name carries through as written rather than being lost.
            typeCustomerName(heard)
        }
        let phone = (scan.customerPhone ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !phone.isEmpty { customerPhone = phone }
        if S.num(scan.advancePayment) > 0 { advance = S.box(S.num(scan.advancePayment)) }
        if S.num(scan.discount) > 0 { discount = S.box(S.num(scan.discount)) }
        if let day = scan.expectedDate, day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
            promised = day
        }

        // Old gold against the order: the words carry everything the slip said about it, the value only what the
        // slip priced it at.
        if let x = scan.exchange {
            let ex = S.exchangeValue(x)
            let words = (x.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            var row = blankExchangeRow()
            row.description = words.isEmpty ? S.describeExchange(x) : words
            row.karat = S.num(x.karat) > 0 ? "\(S.jsNumber(S.jsRound(S.num(x.karat))))k" : ""
            row.weightG = S.num(x.weightG) > 0 ? S.jsNumber(S.num(x.weightG)) : ""
            row.ratePerGram = S.num(x.ratePerGram) > 0 ? S.jsNumber(S.jsRound(S.num(x.ratePerGram))) : ""
            row.value = ex.value > 0 ? S.jsNumber(ex.value) : ""
            row.valueTyped = ex.from == .written
            exchanges = [NewOrderExchangeDraft(row)]
        }

        let check = S.check(scan)
        let lines = scan.items.isEmpty ? [NewOrderScanItem()] : scan.items
        for (i, it) in lines.enumerated() {
            let metal = S.metalFor(it.metalType, fallbackMetal: fallbackMetal)
            let karat = S.karatFor(it.karat, it.metalType, fallbackMetal: fallbackMetal)
            let weight = S.num(it.weightG)
            let written = S.num(it.lineTotal)
            let fixed = weight <= 0 && written > 0
            let rate = S.num(it.ratePerGram)

            // The slip's rate becomes the order's rate for that karat. Silver has one all-in rate, the shop's, so it
            // is noted instead.
            let rateKey = rate > 0 ? S.rateKey(metal: metal, karat: karat) : nil
            if let rateKey { rates[rateKey.rawValue] = S.box(rate) }

            var p = NewOrderPieceDraft()
            p.category = S.categoryByWord[it.itemCategory ?? ""] ?? ""
            p.description = it.description ?? ""
            p.metal = metal
            // A gold piece with no karat written is 21k; a palladium one with none takes its flat rate, as in the browser.
            p.karat = karat ?? (metal == "gold" ? "21k" : "")
            p.weight = S.box(weight)
            p.wastage = S.box(S.hasHisaab(it) ? (S.wastagePercentOf(it) ?? 0) : 10)
            p.making = S.box(S.num(it.makingCharges))
            p.stones = S.box(S.num(it.stoneCharges))
            p.hasStones = S.num(it.stoneWeightG) > 0 || S.num(it.stoneCharges) > 0
            p.stoneWeight = S.box(S.num(it.stoneWeightG))
            p.stoneDetails = it.stoneDetails ?? ""
            p.hasDiamonds = false
            p.karigarId = karigarId
            p.manual = fixed
            p.manualPrice = fixed ? S.box(written) : ""
            p.size = it.size ?? ""

            // The photo the reader said shows this piece, else the first photo on the first piece.
            let idx = it.photoIndex ?? 0
            if idx >= 1 && idx <= Double(photos.count) {
                p.photo = idx == idx.rounded() ? photos[Int(idx) - 1] : nil
            } else if i == 0 {
                p.photo = photos.first
            }

            let karatWritten = it.karat.map { "\(S.jsNumber($0))k" }
            let notes: [String?] = [
                it.note,
                it.weightWasTola == true ? "Weight converted from tola on the slip." : nil,
                it.rateWasPerTola == true ? "Rate converted from per tola on the slip." : nil,
                it.makingWasPerGram == true ? "Making was written per gram and multiplied by the weight." : nil,
                rate > 0 && rateKey == nil && metal == "silver"
                    ? "Slip rate \(S.pkNumber(rate))/g — silver is priced at the shop's rate in settings." : nil,
                rate > 0 && rateKey == nil && metal != "silver"
                    ? "Slip rate \(S.pkNumber(rate))/g could not be applied — no \(karatWritten ?? "karat") rate box." : nil,
                S.num(it.karat) > 0 && karat == nil ? "Slip says \(karatWritten ?? ""), which the form does not offer." : nil,
                written > 0 && !fixed ? "Slip writes \(S.pkNumber(written)) for this piece." : nil,
                check.itemsOff.contains(i) ? "The slip's own sum for this piece does not match its written amount — check it." : nil,
                i == 0 && !(scan.unreadable ?? "").isEmpty ? "Unread on the slip: \(scan.unreadable ?? "")" : nil,
                i == 0 && S.num(scan.balanceDue) > 0 ? "Slip says balance \(S.pkNumber(S.num(scan.balanceDue)))." : nil,
                i == 0 && !(scan.expectedDate ?? "").isEmpty ? "Slip says wanted by \(scan.expectedDate ?? "")." : nil,
            ]
            p.adminNote = notes.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            pieces.append(p)
        }
    }
}
