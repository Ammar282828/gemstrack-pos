import Foundation
import ERPCore

// What the sale comes to, worked out by ERPCore's rules and nothing of its own: Pricing.swift
// (src/lib/pricing.ts) for every line, Exchange.swift for the exchange rows, WalkIn.swift for who the
// sale is to, InvoiceCredit.swift for what paying over the total means. The server prices the sale
// again with the same rules when it is saved (lib/writes/create-invoice.ts); these figures are only
// what the screen shows until then, so they must match it line for line.

/// The rate boxes of one sale: today's rates (the shop's settings) unless a box was typed here
/// (the web's `rateInputs` / `heldRates`). A typed rate prices this sale and is never written back.
struct SaleRateBook {
    let settings: Settings?
    let typed: [String: String]

    /// The shop's rate for a box.
    func settingsValue(_ k: RateInputKey) -> Double {
        guard let s = settings else { return 0 }
        switch k {
        case .gold24k: return s.goldRatePerGram24k
        case .gold22k: return s.goldRatePerGram22k
        case .gold21k: return s.goldRatePerGram21k
        case .gold18k: return s.goldRatePerGram18k
        case .palladium: return s.palladiumRatePerGram
        case .palladium18k: return s.palladiumRatePerGram18k
        case .palladium12k: return s.palladiumRatePerGram12k
        case .platinum: return s.platinumRatePerGram
        case .silver: return s.silverRatePerGram
        }
    }

    /// What the box shows: the typed text, else today's rate as the web shows it ("33700.00").
    func text(_ k: RateInputKey) -> String {
        typed[k.rawValue] ?? String(format: "%.2f", settingsValue(k))
    }

    /// `parseFloat(box) || the shop's rate`: a blank or zero box prices at today's rate.
    func value(_ k: RateInputKey) -> Double {
        if let v = SaleNumber.parse(text(k)), v != 0 { return v }
        return settingsValue(k)
    }

    /// The card the lines are priced from.
    var pricing: PricingRates {
        PricingRates(
            goldRatePerGram24k: value(.gold24k), goldRatePerGram22k: value(.gold22k),
            goldRatePerGram21k: value(.gold21k), goldRatePerGram18k: value(.gold18k),
            palladiumRatePerGram: value(.palladium), palladiumRatePerGram18k: value(.palladium18k),
            palladiumRatePerGram12k: value(.palladium12k),
            platinumRatePerGram: value(.platinum), silverRatePerGram: value(.silver)
        )
    }

    /// The rates the invoice is saved with (`ratesForInvoice` in sale-page.tsx): the metals the bill
    /// carries. Unlike the web, the per-karat palladium rates go with a palladium piece too: the web
    /// sends them only for gold, so a palladium-only bill was priced at the flat rate on the server
    /// while the screen showed the per-karat one (the mismatch calculateProductCosts' own comment
    /// describes).
    func forInvoice(metals: Set<String>) -> [String: Double] {
        var o: [String: Double] = [:]
        if metals.contains("gold") || metals.contains("palladium") {
            o["palladiumRatePerGram18k"] = value(.palladium18k)
            o["palladiumRatePerGram12k"] = value(.palladium12k)
        }
        if metals.contains("gold") {
            o["goldRatePerGram18k"] = value(.gold18k)
            o["goldRatePerGram21k"] = value(.gold21k)
            o["goldRatePerGram22k"] = value(.gold22k)
            o["goldRatePerGram24k"] = value(.gold24k)
        }
        if metals.contains("palladium") { o["palladiumRatePerGram"] = value(.palladium) }
        if metals.contains("platinum") { o["platinumRatePerGram"] = value(.platinum) }
        if metals.contains("silver") { o["silverRatePerGram"] = value(.silver) }
        return o
    }
}

/// One rate box on the screen.
struct SaleRateBox: Identifiable, Equatable {
    let key: RateInputKey
    let label: String
    var id: String { key.rawValue }
}

/// Everything the screen shows about the sale, worked out once per draw.
struct SaleFigures {
    let rateBook: SaleRateBook
    /// Each piece's costs at this sale's rates, by SKU.
    let costs: [String: ProductCosts]
    let metals: Set<String>
    let boxes: [SaleRateBox]
    /// Karats (as "21K") of gold pieces on the bill whose box is zero or unreadable: the total cannot be worked out.
    let missingRates: [String]

    let subtotal: Double
    let discount: Double
    let exchange: Double
    /// Subtotal less discount less exchange.
    let total: Double
    let paidNow: Double
    /// Total less what is paid now; below zero is the customer's credit.
    let balance: Double

    let who: SaleCustomer
    /// A named customer, new or on file: paying over the total is their credit. A walk-in's extra is change.
    let namedCustomer: Bool
    let hasPieces: Bool
    /// The web's `estimatedInvoice` exists: pieces, settings, and every gold rate the bill needs.
    let hasEstimate: Bool
    let paidOver: Bool
    let overpaid: Bool
    let inCreditNow: Bool
    let locked: Bool
    let discountProblem: String?
    let margin: Margin?

    init(draft: SaleDraft, settings: Settings?, customers: [Customer], marginSettings: MarginSettings) {
        let book = SaleRateBook(settings: settings, typed: draft.rates)
        rateBook = book
        let lines = draft.lines
        hasPieces = !lines.isEmpty

        // Which metals and karats the bill carries (cartMetalInfo).
        var metalSet = Set<String>()
        var goldKarats = Set<String>()
        var palladiumKarats = Set<String>()
        for l in lines {
            metalSet.insert(l.metalType)
            guard let k = l.karat, !k.isEmpty else { continue }
            if l.metalType == "gold" { goldKarats.insert(k) } else if l.metalType == "palladium" { palladiumKarats.insert(k) }
        }
        metals = metalSet

        // Only the rates this bill uses. A silver-only bill prices per piece and has none.
        var shown: [SaleRateBox] = []
        for k in ["18k", "21k", "22k", "24k"] where goldKarats.contains(k) {
            if let key = RateInputKey(rawValue: "gold" + k) { shown.append(SaleRateBox(key: key, label: "Gold \(k) / gram")) }
        }
        if metalSet.contains("palladium") {
            if palladiumKarats.contains("18k") { shown.append(SaleRateBox(key: .palladium18k, label: "Palladium 18k / gram")) }
            if palladiumKarats.contains("12k") { shown.append(SaleRateBox(key: .palladium12k, label: "Palladium 12k / gram")) }
            if palladiumKarats.isEmpty { shown.append(SaleRateBox(key: .palladium, label: "Palladium flat / gram")) }
        }
        boxes = shown

        // `hasInvalidRate`: a gold karat on the bill whose box is blank, zero or not a number.
        var missing: [String] = []
        for box in shown where box.key.rawValue.hasPrefix("gold") {
            let v = SaleNumber.parse(book.text(box.key))
            if v == nil || v! <= 0 { missing.append(String(box.key.rawValue.dropFirst(4)).uppercased()) }
        }
        missingRates = missing

        let pricing = book.pricing
        var byLine: [String: ProductCosts] = [:]
        var sum = 0.0
        for l in lines {
            let c = calculateProductCosts(l.priced, pricing)
            byLine[l.sku] = c
            sum += c.totalPrice
        }
        costs = byLine
        subtotal = sum
        discount = SaleNumber.value(draft.discount)
        exchange = exchangeRowsTotal(draft.exchanges.map { $0.core })
        total = sum - discount - exchange
        paidNow = draft.payments.reduce(0) { $0 + SaleNumber.value($1.amount) }
        balance = total - paidNow

        who = resolveSaleCustomer(selectedId: draft.customerId, typedName: draft.customerName,
                                  typedPhone: draft.customerPhone, customers: customers)
        // generateInvoice makes a customer for a typed name or number (shouldCreateCustomer); a walk-in has none.
        let named = canHoldCredit(who.id) || shouldCreateCustomer(who)
        namedCustomer = named

        let estimate = settings != nil && !lines.isEmpty && missing.isEmpty
        hasEstimate = estimate
        let over = estimate && inCredit(sum - discount - exchange - paidNow)
        paidOver = over
        overpaid = over && !named
        inCreditNow = over && named
        locked = settings?.databaseLocked ?? false

        if discount < 0 {
            discountProblem = "The discount can't be negative."
        } else if discount > sum && !lines.isEmpty {
            discountProblem = "The discount can't be more than the subtotal."
        } else {
            discountProblem = nil
        }

        // The shop's margin on this sale (lib/margin.ts): owners' screen only, never the customer's.
        if estimate, marginSettings.rattiLess != nil {
            let marginLines = lines.map { l -> MarginLine in
                let c = byLine[l.sku] ?? ProductCosts()
                let stonesSet = l.hasDiamonds || l.hasStones
                    || !(l.stoneDetails ?? "").trimmingCharacters(in: .whitespaces).isEmpty
                    || !(l.diamondDetails ?? "").trimmingCharacters(in: .whitespaces).isEmpty
                    || l.stoneWeightG > 0
                return MarginLine(
                    metalType: l.metalType, karat: l.karat, weightG: l.metalWeightG, stoneWeightG: l.stoneWeightG,
                    quantity: 1, price: c.totalPrice, stoneCharges: c.stoneCharges, diamondCharges: c.diamondCharges,
                    isCoin: l.categoryId == GOLD_COIN_CATEGORY_ID_INTERNAL, fixedPrice: l.isCustomPrice,
                    setWithStones: stonesSet
                )
            }
            let perGram = SaleNumber.value(draft.costTola) / SALE_GRAMS_PER_TOLA
            margin = marginOf(marginLines, revenue: sum - discount, rate24k: perGram > 0 ? perGram : nil, settings: marginSettings)
        } else {
            margin = nil
        }
    }

    /// Why Save is off, in words (sale-page.tsx `invoiceBlockedReason`), or nil when the sale can be saved.
    var blockedReason: String? {
        if locked { return "The database is locked. Unlock it in Settings to save sales." }
        if !hasPieces { return "Add a piece to the sale first." }
        if rateBook.settings == nil { return "The shop's rates have not loaded yet." }
        if !missingRates.isEmpty {
            return "Enter a \(missingRates.joined(separator: " and ")) gold rate under Rates: it is zero, so the total cannot be worked out."
        }
        if let p = discountProblem { return p }
        if overpaid {
            return "The payments come to more than the total. To keep the rest as credit, name the customer; otherwise check the amounts received."
        }
        return nil
    }

    var canSave: Bool { blockedReason == nil }

    func price(of sku: String) -> Double { costs[sku]?.totalPrice ?? 0 }
}

// MARK: What is sent

extension SaleDraft {
    private func exchangeJSON(_ e: ExchangeEntry) -> [String: Any] {
        var o: [String: Any] = ["description": e.description, "value": e.value]
        if let k = e.karat, !k.isEmpty { o["karat"] = k }
        if let w = e.weightG { o["weightG"] = w }
        if let r = e.ratePerGram { o["ratePerGram"] = r }
        return o
    }

    /// The sale as createInvoice takes it (the web's `generateInvoice` arguments): exactly the fields the
    /// screen passes to `ERPAPI.shared.write("createInvoice", …)`. `qr` finds a piece's tag image on the
    /// live shelf (sold_products keeps the whole document); a piece described for this bill has none.
    func payload(_ f: SaleFigures, qr: (String) -> String?) -> [String: Any] {
        func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        var out: [String: Any] = [:]
        out["cart"] = lines.map { $0.payload(qr: qr($0.sku)) }
        var customer: [String: Any] = ["name": f.who.name]
        if let id = f.who.id { customer["id"] = id }
        if !f.who.phone.isEmpty { customer["phone"] = f.who.phone }
        out["customer"] = customer
        out["rates"] = f.rateBook.forInvoice(metals: f.metals)
        out["discountAmount"] = f.discount
        out["exchanges"] = exchangesFromRows(exchanges.map { $0.core }).map { exchangeJSON($0) }
        var paid: [[String: Any]] = []
        for r in payments {
            let amount = SaleNumber.value(r.amount)
            if amount <= 0 { continue }
            var p: [String: Any] = ["amount": amount, "method": r.method]
            let ref = r.method == "Cash" ? "" : trimmed(r.reference)
            if !ref.isEmpty { p["reference"] = ref }
            paid.append(p)
        }
        out["payments"] = paid
        if !trimmed(takenBy).isEmpty { out["takenBy"] = trimmed(takenBy) }
        out["hideRates"] = hideRates
        if !trimmed(internalNote).isEmpty { out["internalNote"] = trimmed(internalNote) }
        if let d = delivery.payload { out["delivery"] = d }
        let perGram = SaleNumber.value(costTola) / SALE_GRAMS_PER_TOLA
        if perGram > 0 { out["costRate24k"] = perGram }
        return out
    }
}

// MARK: Lookups

/// Finding pieces: by what is typed, by a scanned tag, and where a piece went when it is not in stock.
enum SaleLookup {
    /// A key made up for one bill (lib/sku.ts ONE_OFF_SKU_PREFIXES).
    static func isOneOff(_ sku: String) -> Bool { sku.hasPrefix("NEW-") || sku.hasPrefix("BILL-") }

    /// Pieces in stock matching what is typed: every word in the SKU or the name, not already on the
    /// sale, at most `limit` (handleSkuInputChange).
    static func matches(_ query: String, in products: [Product], excluding skus: Set<String>, limit: Int = 8) -> [Product] {
        let tokens = query.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            .split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if tokens.isEmpty { return [] }
        var out: [Product] = []
        for p in products where !skus.contains(p.sku) {
            let sku = p.sku.uppercased()
            let name = p.name.uppercased()
            if tokens.allSatisfy({ sku.contains($0) || name.contains($0) }) {
                out.append(p)
                if out.count == limit { break }
            }
        }
        return out
    }

    /// The piece with exactly this SKU, else the same letters in any case.
    static func find(_ sku: String, in products: [Product]) -> Product? {
        let t = sku.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        return products.first { $0.sku == t } ?? products.first { $0.sku.caseInsensitiveCompare(t) == .orderedSame }
    }

    /// The sale a piece went out on, if the books have it (a tag scanned after the piece was sold).
    static func soldOn(_ sku: String, invoices: [Invoice]) -> Invoice? {
        let t = sku.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        return invoices.first { inv in inv.items.contains { $0.sku.caseInsensitiveCompare(t) == .orderedSame } }
    }

    /// What the server's 409 says (create-invoice route): "No longer in stock: A, B, Gold ring (already
    /// sold)." A stock piece is named by its SKU; a piece described for this bill (NEW-…) is named by its
    /// name and "(already sold)", because it was refused for being on an invoice already, i.e. this
    /// sale was saved before. `gone` is the stock SKUs on the sale that are named, which can be taken off.
    static func refusal(in message: String, lines: [SaleLine]) -> (gone: [String], alreadySold: Bool) {
        guard let r = message.range(of: "No longer in stock:") else { return ([], false) }
        let tokens = message[r.upperBound...]
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " .\n")) }
        let stock = Set(lines.filter { !$0.isOneOff }.map { $0.sku })
        return (tokens.filter { stock.contains($0) }, message.contains("(already sold)"))
    }

    /// Every address this customer has been sent to, newest first, then the one on their page
    /// (delivery-fields.tsx `knownAddressesFor`), once each.
    static func knownAddresses(customerId: String?, customerAddress: String?, invoices: [Invoice]) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        func take(_ raw: String?) {
            let a = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if a.isEmpty || !seen.insert(a.lowercased()).inserted { return }
            out.append(a)
        }
        if let id = customerId, !id.isEmpty {
            for inv in invoices where inv.customerId == id { take(inv.delivery?.address) }
        }
        take(customerAddress)
        return out
    }

    /// Names already used in "Taken by" on invoices and orders in the last 60 days: the app has no
    /// list of the house's people yet (NEXT_PUBLIC_STORE_PEOPLE is the web's build variable).
    /// `taken` is (takenBy, createdAt) for each invoice and order.
    static func recentPeople(taken: [(String?, String)], now: Date = Date(), days: Double = 60) -> [String] {
        let since = now.addingTimeInterval(-days * 86_400)
        var names = Set<String>()
        for (by, at) in taken {
            let name = (by ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty { continue }
            if let d = ERPDate.parse(at), d >= since { names.insert(name) }
        }
        return names.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
}

/// A scanned code is a SKU, or a URL ending in one.
enum TagCode {
    /// The SKU in a scanned or typed code: the code itself, or the last part of the path when it is a link.
    static func sku(from code: String) -> String {
        let t = code.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.contains("/") { return t }
        var path = t
        if let q = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<q]) }
        let last = path.split(separator: "/").last.map(String.init) ?? t
        return last.removingPercentEncoding ?? last
    }
}
