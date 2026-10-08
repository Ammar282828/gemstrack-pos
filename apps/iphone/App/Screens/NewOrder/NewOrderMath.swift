import Foundation
import ERPCore

// What the order form works out, and what it sends. Every figure is ERPCore's (Pricing, Exchange,
// WalkIn, Margin) arranged the way order-form.tsx arranges them: `priceOfItem`, `liveEstimate`
// (subtotal, discount, advance, exchange, grand total) and `onSubmit`'s `orderToSave`. The server
// stores the totals as sent (create-order.ts only rounds them to numbers), so what the phone shows
// is what the book will hold.

enum NewOrderMath {
    struct Totals {
        /// Each piece's price as it stands, in order (the shop's margin reads them).
        var prices: [Double] = []
        var subtotal = 0.0
        /// Never more than the subtotal: a discount cannot turn a sale into a debt.
        var discount = 0.0
        var advance = 0.0
        /// The exchange rows' total.
        var exchange = 0.0
        /// Pieces less discount, advance and exchange: what is still owed. This is the order's `grandTotal`.
        var balance = 0.0
    }

    private static func num(_ s: String) -> Double { NewOrderFormat.num(s) }
    private static func trim(_ s: String) -> String { NewOrderFormat.trim(s) }

    // MARK: Rates

    /// Today's rates as the boxes hold them, every key (the order stamps the seven the server keeps).
    static func todaysRates(_ s: Settings) -> [String: String] {
        let all = s.rates
        var out: [String: String] = [:]
        for key in RATE_KEYS {
            out[key.rawValue] = NewOrderFormat.boxText(all[key] ?? 0, digits: 2)
        }
        return out
    }

    /// The rate card this order is priced at: the four gold rates and the two palladium grades as typed,
    /// and the flat palladium, platinum and silver rates from the shop (silver has one all-in rate that
    /// the order form has no box for: order-form.tsx `ratesForOrder`).
    static func formRates(_ d: NewOrderDraft, _ settings: Settings?) -> PricingRates {
        func typed(_ k: RateKey) -> Double { num(d.rates[k.rawValue] ?? "") }
        return PricingRates(
            goldRatePerGram24k: typed(.goldRatePerGram24k),
            goldRatePerGram22k: typed(.goldRatePerGram22k),
            goldRatePerGram21k: typed(.goldRatePerGram21k),
            goldRatePerGram18k: typed(.goldRatePerGram18k),
            palladiumRatePerGram: settings?.palladiumRatePerGram ?? 0,
            palladiumRatePerGram18k: typed(.palladiumRatePerGram18k),
            palladiumRatePerGram12k: typed(.palladiumRatePerGram12k),
            platinumRatePerGram: settings?.platinumRatePerGram ?? 0,
            silverRatePerGram: settings?.silverRatePerGram ?? 0
        )
    }

    // MARK: The book

    /// Customers who are people: not removed, not the old "Walk-in Customer" records (lib/walk-in.ts).
    static func people(_ all: [Customer]) -> [Customer] {
        all.filter { ($0.deletedAt ?? "").isEmpty && !isWalkInName($0.name) }
    }

    // MARK: One piece

    /// Wastage typed in grams (the karigar's "6.500 + 0.650") as the percentage the order keeps: the grams
    /// are on the metal less its stones (OrderFinalize), to eight places so it prices exactly those grams.
    static func wastageText(grams typed: String, weight: Double, stoneWeight: Double) -> String {
        NewOrderFormat.boxText(wastagePercentFor(num(typed), weight, stoneWeight), digits: 8)
    }

    /// The piece as pricing reads it. Stone weight, diamond charges and a stone's weight count only
    /// while their boxes are ticked, so a figure typed and then unticked cannot sit hidden in a price.
    /// Wastage and making are silver's own rate (pricing.ts), so they are never asked of silver.
    static func priced(_ p: NewOrderPieceDraft) -> PricedPiece {
        let metal = MetalType(rawValue: p.metal)
        let silver = metal == .silver
        return PricedPiece(
            categoryId: nil,
            metalType: metal,
            karat: metalHasKarat(metal) ? KaratValue(rawValue: p.karat) : nil,
            metalWeightG: p.weightValue,
            stoneWeightG: p.stoneWeightValue,
            wastagePercentage: silver ? 0 : num(p.wastage),
            makingCharges: silver ? 0 : num(p.making),
            hasDiamonds: p.hasDiamonds,
            diamondCharges: p.hasDiamonds ? num(p.diamond) : 0,
            stoneCharges: num(p.stones),
            miscCharges: 0
        )
    }

    /// `priceOfItem`: a fixed price is that price; a weighed piece with no weight yet is nothing.
    static func price(_ p: NewOrderPieceDraft, _ rates: PricingRates) -> Double {
        if p.manual { return num(p.manualPrice) }
        if num(p.weight) <= 0 { return 0 }
        return calculateProductCosts(priced(p), rates).totalPrice
    }

    // MARK: The figures

    /// `liveEstimate`.
    static func totals(_ d: NewOrderDraft, _ settings: Settings?) -> Totals {
        let rates = formRates(d, settings)
        var t = Totals()
        for p in d.pieces {
            let x = price(p, rates)
            t.prices.append(x)
            t.subtotal += x
        }
        t.discount = max(0, min(t.subtotal, num(d.discount)))
        t.advance = num(d.advance)
        t.exchange = exchangeTotal(exchangesFromRows(d.exchanges.map { $0.row }))
        t.balance = t.subtotal - t.discount - (t.advance + t.exchange)
        return t
    }

    /// What the web's schema refuses (`orderFormSchema`), in its words; nil when the order can be saved.
    static func problem(_ d: NewOrderDraft) -> String? {
        if d.pieces.isEmpty { return "Add at least one piece to the order." }
        for (i, p) in d.pieces.enumerated() {
            let who = "Piece \(i + 1)"
            if trim(p.description).count < 3 { return "\(who): Description is required." }
            if p.manual {
                if num(p.manualPrice) <= 0 { return "\(who): Manual price must be greater than 0." }
            } else if num(p.weight) <= 0 {
                return "\(who): Weight must be a positive number."
            }
        }
        let goldKarats = Set(d.pieces.filter { $0.metal == "gold" }.map { $0.karat })
        for k in ["18k", "21k", "22k", "24k"] where goldKarats.contains(k) {
            if num(d.rates["goldRatePerGram" + k] ?? "") <= 0 {
                return "A positive gold rate is required for each gold karat type present in the order."
            }
        }
        if num(d.discount) < 0 || num(d.advance) < 0 { return "The discount and the advance can't be negative." }
        // The web drops a delivery with no address without a word; the phone says so.
        if d.deliver && trim(d.deliveryAddress).isEmpty { return "Delivery is ticked but has no address." }
        return nil
    }

    // MARK: What is sent

    private static func put(_ o: inout [String: Any], _ key: String, _ text: String) {
        let t = trim(text)
        if !t.isEmpty { o[key] = t }
    }

    /// One piece as `onSubmit` builds it: the form's fields plus the estimate (`metalCost`, `wastageCost`,
    /// `totalEstimate`), karat only for a metal that has one and plating only for silver (`stripMeaninglessKarat`). The
    /// sample picture goes as a data URI; createOrder moves it to `order_photos` in the same commit
    /// (lib/order-photos.ts splitItemPhotos). The instructions for the karigar are the owner's.
    static func item(_ p: NewOrderPieceDraft, rates: PricingRates, owner: Bool, photo: Bool) -> [String: Any] {
        let metal = MetalType(rawValue: p.metal)
        let silver = metal == .silver
        let costs: ProductCosts = p.manual ? ProductCosts(totalPrice: num(p.manualPrice)) : calculateProductCosts(priced(p), rates)
        var o: [String: Any] = [:]
        o["description"] = trim(p.description)
        o["metalType"] = p.metal
        o["estimatedWeightG"] = num(p.weight)
        o["wastagePercentage"] = num(p.wastage)
        o["makingCharges"] = silver ? 0.0 : num(p.making)
        o["diamondCharges"] = p.hasDiamonds ? num(p.diamond) : 0.0
        o["stoneCharges"] = num(p.stones)
        o["hasDiamonds"] = p.hasDiamonds
        o["hasStones"] = p.hasStones
        o["stoneWeightG"] = p.stoneWeightValue
        o["sampleGiven"] = p.sampleGiven
        o["isCompleted"] = false
        o["isManualPrice"] = p.manual
        o["manualPrice"] = p.manual ? num(p.manualPrice) : 0.0
        o["metalCost"] = NewOrderFormat.finite(costs.metalCost)
        o["wastageCost"] = NewOrderFormat.finite(costs.wastageCost)
        o["totalEstimate"] = NewOrderFormat.finite(costs.totalPrice)
        put(&o, "itemCategory", p.category)
        put(&o, "referenceSku", p.referenceSku)
        put(&o, "size", p.size)
        put(&o, "karigarId", p.karigarId)
        // Karat stays for any metal that has one (gold, and palladium's 18k and 12k, which price differently):
        // lib/order-estimate.ts stripMeaninglessKarat.
        if metalHasKarat(metal) { put(&o, "karat", p.karat) }
        if p.hasStones { put(&o, "stoneDetails", p.stoneDetails) }
        if p.hasDiamonds { put(&o, "diamondDetails", p.diamondDetails) }
        if silver {
            put(&o, "platingType", p.platingType)
            if p.platingType == "Other" { put(&o, "platingNote", p.platingNote) }
            o["nickelFree"] = p.nickelFree
        }
        if owner { put(&o, "adminNote", p.adminNote) }
        if photo, let data = p.photo {
            o["sampleImageDataUri"] = "data:image/jpeg;base64," + data.base64EncodedString()
        }
        return o
    }

    /// The rate card stored on the order so it prices the same for ever (all nine, as the form sends them;
    /// the server keeps seven and fills a missing one from the shop's).
    static func ratesApplied(_ r: PricingRates) -> [String: Any] {
        var o: [String: Any] = [:]
        o["goldRatePerGram18k"] = r.goldRatePerGram18k
        o["goldRatePerGram21k"] = r.goldRatePerGram21k
        o["goldRatePerGram22k"] = r.goldRatePerGram22k
        o["goldRatePerGram24k"] = r.goldRatePerGram24k
        o["palladiumRatePerGram"] = r.palladiumRatePerGram
        o["palladiumRatePerGram18k"] = r.palladiumRatePerGram18k
        o["palladiumRatePerGram12k"] = r.palladiumRatePerGram12k
        o["platinumRatePerGram"] = r.platinumRatePerGram
        o["silverRatePerGram"] = r.silverRatePerGram
        return o
    }

    private static func exchangeDict(_ e: ExchangeEntry) -> [String: Any] {
        var o: [String: Any] = [:]
        o["description"] = e.description
        o["value"] = NewOrderFormat.finite(e.value)
        if let k = e.karat, !k.isEmpty { o["karat"] = k }
        if let w = e.weightG, w > 0 { o["weightG"] = w }
        if let r = e.ratePerGram, r > 0 { o["ratePerGram"] = r }
        return o
    }

    /// The 24k rate now, per gram, from what was typed per tola (the way the bazaar quotes it).
    static func costRatePerGram(_ d: NewOrderDraft) -> Double {
        let tola = num(d.costTola)
        return tola > 0 ? tola / NewOrderWords.gramsPerTola : 0
    }

    /// Who the order is for. A customer picked from the book is theirs; a typed number already on file is
    /// that customer (lib/walk-in.ts: typing instead of tapping no longer copies anyone); a typed name is a
    /// new customer the server makes; a number alone is "Customer - <number>" (createOrder); nothing is a
    /// walk-in, which is no customer at all. The placeholder name is never sent: createOrder would make a
    /// customer of it.
    private static func addCustomer(_ d: NewOrderDraft, _ customers: [Customer], into o: inout [String: Any]) {
        let r = resolveSaleCustomer(
            selectedId: d.customerId.isEmpty ? nil : d.customerId,
            typedName: d.customerName,
            typedPhone: d.customerPhone,
            customers: customers
        )
        let phone = trim(d.customerPhone)
        if let id = r.id {
            o["customerId"] = id
            if !trim(r.name).isEmpty { o["customerName"] = trim(r.name) }
            let contact = phone.isEmpty ? trim(r.phone) : phone
            if !contact.isEmpty { o["customerContact"] = contact }
        } else {
            let typed = isWalkInName(d.customerName) ? "" : trim(d.customerName)
            if !typed.isEmpty { o["customerName"] = typed }
            if !phone.isEmpty { o["customerContact"] = phone }
        }
    }

    /// What the screen hands `ERPAPI.write("createOrder", …)`: the fields of the op, which are `{ order }`.
    static func request(_ d: NewOrderDraft, settings: Settings, customers: [Customer], owner: Bool) -> [String: Any] {
        ["order": order(d, settings: settings, customers: customers, owner: owner)]
    }

    /// The order exactly as `orderToSave` builds it (`createOrder`'s `order`).
    static func order(_ d: NewOrderDraft, settings: Settings, customers: [Customer], owner: Bool) -> [String: Any] {
        let rates = formRates(d, settings)
        let t = totals(d, settings)
        var o: [String: Any] = [:]
        o["items"] = d.pieces.map { item($0, rates: rates, owner: owner, photo: true) }
        o["ratesApplied"] = ratesApplied(rates)
        if d.hideRates { o["hideRates"] = true }
        put(&o, "takenBy", d.takenBy)
        o["advancePayment"] = t.advance
        if t.advance > 0 && !d.advanceMethod.isEmpty { o["advanceMethod"] = d.advanceMethod }
        let ex = orderExchangeFields(exchangesFromRows(d.exchanges.map { $0.row }))
        o["exchanges"] = ex.exchanges.map { exchangeDict($0) }
        o["advanceInExchangeDescription"] = ex.advanceInExchangeDescription
        o["advanceInExchangeValue"] = NewOrderFormat.finite(ex.advanceInExchangeValue)
        let perGram = costRatePerGram(d)
        if owner && perGram > 0 { o["costRate24k"] = perGram }
        o["subtotal"] = NewOrderFormat.finite(t.subtotal)
        o["discountAmount"] = NewOrderFormat.finite(t.discount)
        o["grandTotal"] = NewOrderFormat.finite(t.balance)
        addCustomer(d, customers, into: &o)
        if !d.source.isEmpty { o["source"] = d.source }
        // Absent rather than "" when blank, so orderTiming falls through to the age rule.
        if !d.promised.isEmpty { o["promisedDate"] = d.promised }
        put(&o, "notes", d.notes)
        let address = trim(d.deliveryAddress)
        if d.deliver && !address.isEmpty {
            var del: [String: Any] = [:]
            del["required"] = true
            del["address"] = address
            put(&del, "city", d.deliveryCity)
            put(&del, "contactName", d.deliveryName)
            put(&del, "contactPhone", d.deliveryPhone)
            put(&del, "notes", d.deliveryNotes)
            put(&del, "expectedDate", d.deliveryExpected)
            let charge = num(d.deliveryCharge)
            if charge > 0 { del["charge"] = charge }
            o["delivery"] = del
        }
        return o
    }

    // MARK: The shop's margin (owners)

    /// SHOP-ONLY: what the shop earns on this order as it stands, from ERPCore's `orderMargin` over the
    /// order read back as an Order (the live prices stand in for the saved ones). Never on anything a
    /// customer sees.
    static func margin(_ d: NewOrderDraft, _ settings: Settings?, _ t: Totals) -> Margin? {
        guard let settings else { return nil }
        let rates = formRates(d, settings)
        var doc: [String: Any] = [:]
        doc["items"] = d.pieces.map { item($0, rates: rates, owner: true, photo: false) }
        doc["subtotal"] = NewOrderFormat.finite(t.subtotal)
        doc["discountAmount"] = NewOrderFormat.finite(t.discount)
        let perGram = costRatePerGram(d)
        if perGram > 0 { doc["costRate24k"] = perGram }
        guard let order = DocJSON.decode(Order.self, id: "draft", data: doc) else { return nil }
        return orderMargin(order, prices: t.prices, settings: House.margin)
    }
}
