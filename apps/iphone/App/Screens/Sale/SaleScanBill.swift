import Foundation
import ERPCore

// Read a written bill: what the ERP's reader (/api/vision/bill, the route the browser's "Read a written bill" calls)
// read off a handwritten bill or estimate, and those lines put on the sale. Ported from lib/vision/bill-draft.ts
// (`billLineToProduct`, `billRates`, `reconcile`) and sale-page.tsx `acceptScannedBill`, line for line.
//
// The whole design is one distinction: whether a line shows its working. A line with a weight is an ordinary line
// priced from the rate (the bill's own rate, held in its box, and its own wastage), so it comes to the paper's figure
// and moves if the rate is changed. A line with only a figure is a fixed price at exactly that figure, with no weight
// invented to justify it. Nothing is invoiced here: the lines land on the sale for the person to check and save.

// MARK: What the reader answers

/// One line written on the bill (`BillLine`). Every field may be missing.
struct SaleBillLine: Decodable, Equatable {
    var description: String?
    /// The reader's word ("Ring", "Chain"), not a category id.
    var itemCategory: String?
    var metalType: String?
    var karat: Double?
    /// Grams, as weighed: before any stone weight comes off.
    var weightG: Double?
    var weightWasTola: Bool?
    var stoneWeightG: Double?
    var wastageG: Double?
    var wastagePercent: Double?
    /// The rate this line was priced at, per gram: its own, or the one written at the top.
    var ratePerGram: Double?
    var rateWasPerTola: Bool?
    var makingCharges: Double?
    var stoneCharges: Double?
    var diamondCharges: Double?
    /// The line's figure as written: the only one a bare line carries.
    var lineTotal: Double?
    /// The reader's own guess at whether the line showed its working: a hint only (`hasBreakdown` decides).
    var brokenDown: Bool?
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
        wastagePercent = c.double(AnyKey("wastagePercent"))
        ratePerGram = c.double(AnyKey("ratePerGram"))
        rateWasPerTola = c.bool(AnyKey("rateWasPerTola"))
        makingCharges = c.double(AnyKey("makingCharges"))
        stoneCharges = c.double(AnyKey("stoneCharges"))
        diamondCharges = c.double(AnyKey("diamondCharges"))
        lineTotal = c.double(AnyKey("lineTotal"))
        brokenDown = c.bool(AnyKey("brokenDown"))
        note = c.string(AnyKey("note"))
    }
}

/// The whole reading (`RawBillDraft`).
struct SaleBillAnswer: Decodable, Equatable {
    var lines: [SaleBillLine] = []
    /// A rate written once for the whole bill ("Rate 34,000"), per gram.
    var ratePerGram: Double?
    var rateWasPerTola: Bool?
    var customerNameHeard: String?
    var customerPhone: String?
    /// The foot of the bill as written, for checking the sale against.
    var subtotal: Double?
    var discount: Double?
    var grandTotal: Double?
    var amountPaid: Double?
    var date: String?
    var unreadable: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        lines = c.list(AnyKey("lines"))
        ratePerGram = c.double(AnyKey("ratePerGram"))
        rateWasPerTola = c.bool(AnyKey("rateWasPerTola"))
        customerNameHeard = c.string(AnyKey("customerNameHeard"))
        customerPhone = c.string(AnyKey("customerPhone"))
        subtotal = c.double(AnyKey("subtotal"))
        discount = c.double(AnyKey("discount"))
        grandTotal = c.double(AnyKey("grandTotal"))
        amountPaid = c.double(AnyKey("amountPaid"))
        date = c.string(AnyKey("date"))
        unreadable = c.string(AnyKey("unreadable"))
    }

    /// The route's JSON; nil when it is not a reading at all.
    static func read(_ data: Data) -> SaleBillAnswer? {
        guard (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return nil }
        return try? JSONDecoder().decode(SaleBillAnswer.self, from: data)
    }
}

/// The reading with the customer matched against the book (`resolveBill`), and the lines the person keeps.
struct SaleBillReading: Equatable {
    var answer: SaleBillAnswer
    var customer: PaperNameGuess?
    /// Lines left off the sale, by position (the browser's unticked boxes).
    var skipped: Set<Int> = []

    static func resolve(_ answer: SaleBillAnswer, customers: [Customer]) -> SaleBillReading {
        let people = NewOrderMath.people(customers).map { PaperPerson(id: $0.id, name: $0.name) }
        return SaleBillReading(answer: answer, customer: PaperNames.guess(answer.customerNameHeard, pool: people))
    }

    var kept: [SaleBillLine] {
        answer.lines.enumerated().filter { !skipped.contains($0.offset) }.map(\.element)
    }
}

// MARK: The bill's rules (bill-draft.ts)

enum SaleBill {
    /// Can this line be priced from the rate? A weight is the whole question, judged from what arrived.
    static func hasBreakdown(_ l: SaleBillLine) -> Bool { (l.weightG ?? 0) > 0 }

    /// A line's figure as written.
    static func writtenTotal(_ l: SaleBillLine) -> Double { (l.lineTotal ?? 0) > 0 ? l.lineTotal! : 0 }

    static func wastagePercentOf(_ l: SaleBillLine) -> Double? {
        NewOrderSlip.wastagePercentOf(weightG: l.weightG, stoneWeightG: l.stoneWeightG, wastageG: l.wastageG, wastagePercent: l.wastagePercent)
    }

    private static let karatsByMetal: [String: [Double]] = ["gold": [18, 21, 22, 24], "palladium": [12, 18], "platinum": [], "silver": []]

    /// `billLineToProduct`: a line with a weight as an ordinary priced line (the bill's wastage when it wrote one,
    /// else the blank line's); a bare line as a fixed price at its figure, weighing nothing, because nothing is the
    /// honest answer to a question the bill did not ask. `blank` is `SaleLine(blankFor:sku:)`: the house's metal and
    /// opening wastage. A gold line with no karat written is 21k. A karat on a metal that has none is left off (the
    /// browser carries the blank's 21k onto a silver line, the phantom karat that prices nothing).
    static func line(_ l: SaleBillLine, blank: SaleLine, fallbackMetal: String) -> SaleLine {
        let metalWord = l.metalType ?? ""
        let metal = metalWord.isEmpty ? fallbackMetal : metalWord
        let k = l.karat ?? 0
        let allowed = karatsByMetal[metal] ?? []
        let karat: String? = k > 0 && allowed.contains(k) ? "\(NewOrderSlip.jsNumber(k))k" : nil

        var out = blank
        let name = (l.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        out.name = name.isEmpty ? "Item" : name
        out.categoryId = NewOrderSlip.categoryByWord[l.itemCategory ?? ""] ?? ""
        out.metalType = metal
        if let karat {
            out.karat = karat
        } else if metal == "gold" {
            out.karat = "21k"
        } else if !metalHasKarat(metal) {
            out.karat = nil
        }
        if let note = l.note, !note.isEmpty { out.billDescription = note }

        guard hasBreakdown(l) else {
            out.metalWeightG = 0
            out.isCustomPrice = true
            out.customPrice = writtenTotal(l)
            return out
        }
        out.metalWeightG = l.weightG ?? 0
        out.hasStones = (l.stoneWeightG ?? 0) > 0 || (l.stoneCharges ?? 0) > 0
        out.stoneWeightG = l.stoneWeightG ?? 0
        if let w = wastagePercentOf(l) { out.wastagePercentage = w }
        out.stoneCharges = l.stoneCharges ?? 0
        out.hasDiamonds = (l.diamondCharges ?? 0) > 0
        out.diamondCharges = l.diamondCharges ?? 0
        out.makingCharges = l.makingCharges ?? 0
        out.isCustomPrice = false
        out.customPrice = 0
        return out
    }

    /// `billRates`: the rates the bill was priced at, by the sale's rate boxes ("gold21k": 34000). A broken-down
    /// line priced at the bill's rate comes to the bill's figure; at today's it does not. Gold only (silver is
    /// all-in); a karat priced at two rates on one bill sets nothing, since one box can't hold both.
    static func rates(_ lines: [SaleBillLine], billRate: Double?, fallbackMetal: String) -> [String: Double] {
        var seen: [String: Set<Double>] = [:]
        var order: [String] = []
        for l in lines where hasBreakdown(l) {
            let metalWord = l.metalType ?? ""
            let metal = metalWord.isEmpty ? fallbackMetal : metalWord
            if metal != "gold" { continue }
            let rate = (l.ratePerGram ?? 0) > 0 ? l.ratePerGram! : ((billRate ?? 0) > 0 ? billRate! : 0)
            if rate == 0 { continue }
            let k = (l.karat ?? 0) > 0 && karatsByMetal["gold"]!.contains(l.karat!) ? l.karat! : 21
            let key = "gold\(NewOrderSlip.jsNumber(k))k"
            if seen[key] == nil {
                seen[key] = []
                order.append(key)
            }
            seen[key]!.insert(NewOrderSlip.jsRound(rate * 100) / 100)
        }
        var out: [String: Double] = [:]
        for key in order where seen[key]!.count == 1 { out[key] = seen[key]!.first! }
        return out
    }

    /// The figure at the foot of the bill (`reconcile`'s `written`): its total, else its subtotal.
    static func writtenFigure(_ a: SaleBillAnswer) -> Double? {
        if (a.grandTotal ?? 0) > 0 { return a.grandTotal }
        if (a.subtotal ?? 0) > 0 { return a.subtotal }
        return nil
    }

    /// A rupee of rounding is not a discrepancy; a missed line is.
    static func differs(written: Double?, computed: Double) -> Bool {
        guard let written else { return false }
        return abs(written - computed) > 1
    }

    /// `BILL-` and the milliseconds since 1970 in base 36, then the line's number: a key for this bill only, never a
    /// stock number (lib/sku.ts ONE_OFF_SKU_PREFIXES). One already on the sale moves the clock on.
    static func skus(_ count: Int, now: Date, avoiding taken: Set<String>) -> [String] {
        var ms = UInt64(max(0, (now.timeIntervalSince1970 * 1000).rounded(.down)))
        while true {
            let stem = "BILL-" + String(ms, radix: 36, uppercase: true)
            let out = (0..<count).map { "\(stem)-\($0 + 1)" }
            if out.allSatisfy({ !taken.contains($0) }) { return out }
            ms += 1
        }
    }
}

// MARK: Onto the sale (sale-page.tsx `acceptScannedBill`)

extension SaleDraft {
    /// The kept lines onto the sale, after what it holds; the customer only as the person picked them; the bill's
    /// rates into their boxes (the paper's rate prices this bill); its discount unless one is typed; what it says was
    /// paid as one cash row unless a payment is typed. Answers the rate boxes it set, as the sale now holds them:
    /// those are the bill's, never the shop's rate for tomorrow (SaleScanHeld).
    @discardableResult
    mutating func fill(fromBill reading: SaleBillReading, customer: Customer?, fallbackMetal: String, now: Date = Date()) -> [String: String] {
        let kept = reading.kept
        let skus = SaleBill.skus(kept.count, now: now, avoiding: Set(lines.map(\.sku)))
        for (i, l) in kept.enumerated() {
            let made = SaleBill.line(l, blank: SaleLine(blankFor: fallbackMetal, sku: skus[i]), fallbackMetal: fallbackMetal)
            if !lines.contains(where: { $0.sku == made.sku }) { lines.append(made) }
        }
        if let customer { pick(customer) }

        var held: [String: String] = [:]
        for (key, rate) in SaleBill.rates(kept, billRate: reading.answer.ratePerGram, fallbackMetal: fallbackMetal)
        where RateInputKey(rawValue: key) != nil {
            let text = String(format: "%.2f", rate)
            rates[key] = text
            held[key] = text
        }

        let bill = reading.answer
        if let d = bill.discount, d > 0, !((SaleNumber.parse(discount) ?? 0) > 0) {
            discount = NewOrderSlip.jsNumber(d)
        }
        if let paid = bill.amountPaid, paid > 0, !payments.contains(where: { (SaleNumber.parse($0.amount) ?? 0) > 0 }) {
            payments = [SalePaymentRow(amount: NewOrderSlip.jsNumber(paid))]
        }
        return held
    }
}

// MARK: The bill's rates are held, not typed

/// A rate read off a bill prices that bill and is never the shop's rate for tomorrow (decisions.md "Rate chip",
/// lib/rates.ts `ratesToKeep`: the browser holds it, `heldRates`, and writes back only boxes typed by hand). The
/// sale keeps every box it sets as typed text (`SaleDraft.rates`), so the boxes a bill set are remembered here
/// with the figure it set, and a box still holding that figure is not written back. Typing a different figure
/// over it makes it the person's own again.
enum SaleScanHeld {
    static let key = "erp.saleBillRates"

    static func load() -> [String: String] {
        (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
    }

    /// The boxes a bill just set, added to those an earlier bill on the same sale set (a sale with no bill lines
    /// before this one starts the list afresh).
    static func hold(_ set: [String: String], before: SaleDraft) {
        let carried = before.lines.contains { $0.sku.hasPrefix("BILL-") } ? load() : [:]
        UserDefaults.standard.set(carried.merging(set) { _, new in new }, forKey: key)
    }

    /// `kept` (the settings' rate names, as `ratesToWriteBack` answers) less every box still holding a bill's figure.
    static func unheld(_ kept: [String: Double]?, draft: SaleDraft, held: [String: String]) -> [String: Double]? {
        guard var out = kept else { return nil }
        for (box, text) in held where draft.rates[box] == text {
            if let input = RateInputKey(rawValue: box) { out[input.rateKey.rawValue] = nil }
        }
        return out.isEmpty ? nil : out
    }

    static func unheld(_ kept: [String: Double]?, in draft: SaleDraft) -> [String: Double]? {
        unheld(kept, draft: draft, held: load())
    }
}
