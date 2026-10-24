package erp.core.entry

import erp.core.DocJSON
import erp.core.logic.Margin
import erp.core.logic.PricedPiece
import erp.core.logic.PricingRates
import erp.core.logic.ProductCosts
import erp.core.logic.RATE_KEYS
import erp.core.logic.RateKey
import erp.core.logic.calculateProductCosts
import erp.core.logic.exchangeTotal
import erp.core.logic.exchangesFromRows
import erp.core.logic.gramsPerTola
import erp.core.logic.isWalkInName
import erp.core.logic.metalHasKarat
import erp.core.logic.orderExchangeFields
import erp.core.logic.orderMargin
import erp.core.logic.pakistanE164
import erp.core.logic.rates
import erp.core.logic.resolveSaleCustomer
import erp.core.logic.rupees
import erp.core.logic.wastagePercentFor
import erp.core.models.Customer
import erp.core.models.ExchangeEntry
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.Settings

// What the order form works out, and what it sends. Every figure is the rules' (Pricing, Exchange, WalkIn,
// Margin) arranged the way order-form.tsx arranges them: `priceOfItem`, `liveEstimate` (subtotal, discount,
// advance, exchange, grand total) and `onSubmit`'s `orderToSave`. The server stores the totals as sent
// (create-order.ts only rounds them to numbers), so what the phone shows is what the book will hold.
// (NewOrderMath.swift.)

object NewOrderMath {
    class Totals {
        /** Each piece's price as it stands, in order (the shop's margin reads them). */
        val prices: MutableList<Double> = mutableListOf()
        var subtotal = 0.0

        /** Never more than the subtotal: a discount cannot turn a sale into a debt. */
        var discount = 0.0
        var advance = 0.0

        /** The exchange rows' total. */
        var exchange = 0.0

        /** Pieces less discount, advance and exchange: what is still owed. This is the order's `grandTotal`. */
        var balance = 0.0
    }

    private fun num(s: String): Double = NewOrderFormat.num(s)
    private fun trim(s: String): String = NewOrderFormat.trim(s)

    // Rates

    /** Today's rates as the boxes hold them, every key (the order stamps the seven the server keeps). */
    fun todaysRates(s: Settings): Map<String, String> {
        val all = s.rates
        val out = LinkedHashMap<String, String>()
        for (key in RATE_KEYS) {
            out[key.name] = NewOrderFormat.boxText(all[key] ?: 0.0, digits = 2)
        }
        return out
    }

    /**
     * The rate card this order is priced at: the four gold rates and the two palladium grades as typed, and the flat
     * palladium and platinum rates from the shop. Silver has one all-in rate (it holds the making and wastage); the
     * order's own box wins and a blank one is the shop's (order-form.tsx `ratesForOrder`, `silverRate`).
     */
    fun formRates(d: NewOrderDraft, settings: Settings?): PricingRates {
        fun typed(k: RateKey): Double = num(d.rates[k.name] ?: "")
        return PricingRates(
            goldRatePerGram24k = typed(RateKey.goldRatePerGram24k),
            goldRatePerGram22k = typed(RateKey.goldRatePerGram22k),
            goldRatePerGram21k = typed(RateKey.goldRatePerGram21k),
            goldRatePerGram18k = typed(RateKey.goldRatePerGram18k),
            palladiumRatePerGram = settings?.palladiumRatePerGram ?: 0.0,
            palladiumRatePerGram18k = typed(RateKey.palladiumRatePerGram18k),
            palladiumRatePerGram12k = typed(RateKey.palladiumRatePerGram12k),
            platinumRatePerGram = settings?.platinumRatePerGram ?: 0.0,
            silverRatePerGram = typed(RateKey.silverRatePerGram).takeIf { it > 0 } ?: (settings?.silverRatePerGram ?: 0.0),
        )
    }

    // The book

    /** Customers who are people: not removed, not the old "Walk-in Customer" records (lib/walk-in.ts). */
    fun people(all: List<Customer>): List<Customer> = all.filter { (it.deletedAt ?: "").isEmpty() && !isWalkInName(it.name) }

    // One piece

    /**
     * Wastage typed in grams (the karigar's "6.500 + 0.650") as the percentage the order keeps: the grams are on the
     * metal less its stones (OrderFinalize), to eight places so it prices exactly those grams.
     */
    fun wastageText(grams: String, weight: Double, stoneWeight: Double): String =
        NewOrderFormat.boxText(wastagePercentFor(num(grams), weight, stoneWeight), digits = 8)

    /**
     * The piece as pricing reads it. Stone weight, diamond charges and a stone's weight count only while their boxes
     * are ticked, so a figure typed and then unticked cannot sit hidden in a price. Wastage and making are silver's
     * own rate (pricing.ts), so they are never asked of silver.
     */
    fun priced(p: NewOrderPieceDraft): PricedPiece {
        val metal = MetalType.of(p.metal)
        val silver = metal == MetalType.silver
        return PricedPiece(
            categoryId = null,
            metalType = metal,
            karat = if (metalHasKarat(metal)) KaratValue.of(p.karat) else null,
            metalWeightG = p.weightValue,
            stoneWeightG = p.stoneWeightValue,
            wastagePercentage = if (silver) 0.0 else num(p.wastage),
            makingCharges = if (silver) 0.0 else num(p.making),
            hasDiamonds = p.hasDiamonds,
            diamondCharges = if (p.hasDiamonds) num(p.diamond) else 0.0,
            stoneCharges = num(p.stones),
            miscCharges = 0.0,
        )
    }

    /**
     * `priceOfItem` (lib/order-estimate.ts orderItemPrice): a fixed price is that price, in whole rupees;
     * a weighed piece with no weight yet is nothing.
     */
    fun price(p: NewOrderPieceDraft, rates: PricingRates): Double {
        if (p.manual) return rupees(num(p.manualPrice))
        if (num(p.weight) <= 0) return 0.0
        return calculateProductCosts(priced(p), rates).totalPrice
    }

    // The figures

    /** `liveEstimate`. */
    fun totals(d: NewOrderDraft, settings: Settings?): Totals {
        val rates = formRates(d, settings)
        val t = Totals()
        for (p in d.pieces) {
            val x = price(p, rates)
            t.prices.add(x)
            t.subtotal += x
        }
        t.discount = smax(0.0, smin(t.subtotal, rupees(num(d.discount))))
        t.advance = rupees(num(d.advance))
        t.exchange = exchangeTotal(exchangesFromRows(d.exchanges.map { it.row }))
        t.balance = t.subtotal - t.discount - (t.advance + t.exchange)
        return t
    }

    /**
     * What the web's schema refuses (`orderFormSchema`), in its words; null when the order can be saved.
     * `takenBy` is the house's list of counter names: the name must be on it (empty list: any name).
     */
    private fun unreadableFigure(d: NewOrderDraft): Boolean {
        val u = NewOrderFormat::unreadable
        return u(d.discount) || u(d.advance) || d.rates.values.any(u)
            || d.exchanges.any { u(it.weightG) || u(it.ratePerGram) || u(it.value) }
            || d.pieces.any { u(it.weight) || u(it.stoneWeight) || u(it.wastage) || u(it.making) || u(it.stones) || u(it.manualPrice) }
    }

    fun problem(d: NewOrderDraft, takenBy: List<String> = emptyList()): String? {
        if (d.pieces.isEmpty()) return "Add at least one piece to the order."
        for ((i, p) in d.pieces.withIndex()) {
            val who = "Piece ${i + 1}"
            if (graphemeCount(trim(p.description)) < 3) return "$who: Description is required."
            if (p.manual) {
                if (num(p.manualPrice) <= 0) return "$who: Manual price must be greater than 0."
            } else if (num(p.weight) <= 0) {
                return "$who: Weight must be a positive number."
            }
        }
        if (unreadableFigure(d)) {
            return "A figure is not a number (discount, advance, a rate, a weight or an exchange). Retype it, or clear it."
        }
        val goldKarats = d.pieces.filter { it.metal == "gold" }.map { it.karat }.toSet()
        for (k in listOf("18k", "21k", "22k", "24k")) {
            if (!goldKarats.contains(k)) continue
            if (num(d.rates["goldRatePerGram$k"] ?: "") <= 0) {
                return "A positive gold rate is required for each gold karat type present in the order."
            }
        }
        if (takenBy.isNotEmpty() && trim(d.takenBy).isNotEmpty() && !takenBy.contains(trim(d.takenBy))) {
            return "Taken by: Choose a name from the list"
        }
        if (num(d.discount) < 0 || num(d.advance) < 0) return "The discount and the advance can't be negative."
        // The web drops a delivery with no address without a word; the phone says so.
        if (d.deliver && trim(d.deliveryAddress).isEmpty()) return "Delivery is ticked but has no address."
        return null
    }

    // What is sent

    private fun put(o: MutableMap<String, Any?>, key: String, text: String) {
        val t = trim(text)
        if (t.isNotEmpty()) o[key] = t
    }

    /**
     * One piece as `onSubmit` builds it: the form's fields plus the estimate (`metalCost`, `wastageCost`,
     * `totalEstimate`), karat only for a metal that has one and plating only for silver (`stripMeaninglessKarat`). The
     * sample picture goes as a data URI; createOrder moves it to `order_photos` in the same commit
     * (lib/order-photos.ts splitItemPhotos). The instructions for the karigar go from owners and staff alike (staff
     * write it; the ERP gives it back to owners only, roles.ts).
     */
    fun item(p: NewOrderPieceDraft, rates: PricingRates, photo: Boolean): MutableMap<String, Any?> {
        val metal = MetalType.of(p.metal)
        val silver = metal == MetalType.silver
        val costs: ProductCosts = if (p.manual) ProductCosts(totalPrice = rupees(num(p.manualPrice))) else calculateProductCosts(priced(p), rates)
        val o = LinkedHashMap<String, Any?>()
        o["description"] = trim(p.description)
        o["metalType"] = p.metal
        o["estimatedWeightG"] = num(p.weight)
        o["wastagePercentage"] = num(p.wastage)
        // The piece's money fields in whole rupees, as create-order.ts keeps them (PIECE_MONEY).
        o["makingCharges"] = if (silver) 0.0 else rupees(num(p.making))
        o["diamondCharges"] = if (p.hasDiamonds) rupees(num(p.diamond)) else 0.0
        o["stoneCharges"] = rupees(num(p.stones))
        o["hasDiamonds"] = p.hasDiamonds
        o["hasStones"] = p.hasStones
        o["stoneWeightG"] = p.stoneWeightValue
        o["sampleGiven"] = p.sampleGiven
        o["isCompleted"] = p.isCompleted
        o["isManualPrice"] = p.manual
        o["manualPrice"] = if (p.manual) rupees(num(p.manualPrice)) else 0.0
        o["metalCost"] = NewOrderFormat.finite(costs.metalCost)
        o["wastageCost"] = NewOrderFormat.finite(costs.wastageCost)
        o["totalEstimate"] = NewOrderFormat.finite(costs.totalPrice)
        put(o, "itemCategory", p.category)
        put(o, "referenceSku", p.referenceSku)
        put(o, "size", p.size)
        put(o, "karigarId", p.karigarId)
        // Karat stays for any metal that has one (gold, and palladium's 18k and 12k, which price differently):
        // lib/order-estimate.ts stripMeaninglessKarat.
        if (metalHasKarat(metal)) put(o, "karat", p.karat)
        if (p.hasStones) put(o, "stoneDetails", p.stoneDetails)
        if (p.hasDiamonds) put(o, "diamondDetails", p.diamondDetails)
        if (silver) {
            put(o, "platingType", p.platingType)
            if (p.platingType == "Other") put(o, "platingNote", p.platingNote)
            o["nickelFree"] = p.nickelFree
        }
        put(o, "adminNote", p.adminNote)
        val bytes = p.photo
        val uri = p.sampleImageDataUri
        if (photo && bytes != null) {
            o["sampleImageDataUri"] = "data:image/jpeg;base64," + base64(bytes)
        } else if (photo && p.removePhoto) {
            o["sampleImageDataUri"] = null
            o["samplePhotoId"] = null
        } else if (photo && (p.samplePhotoId ?: "").isEmpty() && uri != null && uri.isNotEmpty()) {
            // A piece whose picture is already a document keeps it: resending the bytes only makes the server compare them.
            o["sampleImageDataUri"] = uri
        }
        return o
    }

    /**
     * The rate card stored on the order so it prices the same for ever (all nine, as the form sends them; the server
     * keeps seven and fills a missing one from the shop's).
     */
    fun ratesApplied(r: PricingRates): MutableMap<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
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

    private fun exchangeDict(e: ExchangeEntry): MutableMap<String, Any?> {
        val o = LinkedHashMap<String, Any?>()
        o["description"] = e.description
        o["value"] = NewOrderFormat.finite(e.value)
        val k = e.karat
        if (k != null && k.isNotEmpty()) o["karat"] = k
        val w = e.weightG
        if (w != null && w > 0) o["weightG"] = w
        val r = e.ratePerGram
        if (r != null && r > 0) o["ratePerGram"] = r
        return o
    }

    /** The 24k rate now, per gram, from what was typed per tola (the way the bazaar quotes it). */
    fun costRatePerGram(d: NewOrderDraft): Double {
        val tola = num(d.costTola)
        return if (tola > 0) tola / gramsPerTola else 0.0
    }

    /**
     * Who the order is for. A customer picked from the book is theirs; a typed number already on file is that customer
     * (lib/walk-in.ts: typing instead of tapping no longer copies anyone); a typed name is a new customer the server
     * makes; a number alone is "Customer - <number>" (createOrder); nothing is a walk-in, which is no customer at
     * all. The placeholder name is never sent: createOrder would make a customer of it.
     */
    private fun addCustomer(d: NewOrderDraft, customers: List<Customer>, o: MutableMap<String, Any?>) {
        val r = resolveSaleCustomer(
            selectedId = if (d.customerId.isEmpty()) null else d.customerId,
            typedName = d.customerName,
            typedPhone = d.customerPhone,
            customers = customers,
        )
        val phone = trim(d.customerPhone)
        val id = r.id
        if (id != null) {
            o["customerId"] = id
            if (trim(r.name).isNotEmpty()) o["customerName"] = trim(r.name)
            val contact = if (phone.isEmpty()) trim(r.phone) else phone
            if (contact.isNotEmpty()) o["customerContact"] = pakistanE164(contact)
        } else {
            val typed = if (isWalkInName(d.customerName)) "" else trim(d.customerName)
            if (typed.isNotEmpty()) o["customerName"] = typed
            if (phone.isNotEmpty()) o["customerContact"] = pakistanE164(phone)
        }
    }

    /** What the screen hands `ErpApi.write("createOrder", …)`: the fields of the op, which are `{ order }`. */
    fun request(d: NewOrderDraft, settings: Settings, customers: List<Customer>): MutableMap<String, Any?> =
        linkedMapOf("order" to order(d, settings, customers))

    /** The order exactly as `orderToSave` builds it (`createOrder`'s `order`). */
    fun order(d: NewOrderDraft, settings: Settings, customers: List<Customer>): MutableMap<String, Any?> {
        val rates = formRates(d, settings)
        val t = totals(d, settings)
        val o = LinkedHashMap<String, Any?>()
        o["items"] = d.pieces.map { item(it, rates, photo = true) }
        o["ratesApplied"] = ratesApplied(rates)
        if (d.hideRates) o["hideRates"] = true
        put(o, "takenBy", d.takenBy)
        o["advancePayment"] = t.advance
        if (t.advance > 0 && d.advanceMethod.isNotEmpty()) o["advanceMethod"] = d.advanceMethod
        val ex = orderExchangeFields(exchangesFromRows(d.exchanges.map { it.row }))
        o["exchanges"] = ex.exchanges.map { exchangeDict(it) }
        o["advanceInExchangeDescription"] = ex.advanceInExchangeDescription
        o["advanceInExchangeValue"] = NewOrderFormat.finite(ex.advanceInExchangeValue)
        val perGram = costRatePerGram(d)
        // The shop's own 24k rate for its margin: owners and staff, never the customer (decisions.md "Margin").
        if (perGram > 0) o["costRate24k"] = perGram
        o["subtotal"] = NewOrderFormat.finite(t.subtotal)
        o["discountAmount"] = NewOrderFormat.finite(t.discount)
        o["grandTotal"] = NewOrderFormat.finite(t.balance)
        addCustomer(d, customers, o)
        if (d.source.isNotEmpty()) o["source"] = d.source
        // Absent rather than "" when blank, so orderTiming falls through to the age rule.
        if (d.promised.isNotEmpty()) o["promisedDate"] = d.promised
        put(o, "notes", d.notes)
        val address = trim(d.deliveryAddress)
        if (d.deliver && address.isNotEmpty()) {
            val del = LinkedHashMap<String, Any?>()
            del["required"] = true
            del["address"] = address
            put(del, "city", d.deliveryCity)
            put(del, "contactName", d.deliveryName)
            put(del, "contactPhone", d.deliveryPhone)
            put(del, "notes", d.deliveryNotes)
            put(del, "expectedDate", d.deliveryExpected)
            val charge = rupees(num(d.deliveryCharge))
            if (charge > 0) del["charge"] = charge
            o["delivery"] = del
        }
        return o
    }

    // The shop's margin (owners and staff)

    /**
     * SHOP-ONLY (owners and staff): what the shop earns on this order as it stands, from the rules' `orderMargin` over
     * the order read back as an Order (the live prices stand in for the saved ones). Never on anything a customer sees.
     */
    fun margin(d: NewOrderDraft, settings: Settings?, t: Totals): Margin? {
        if (settings == null) return null
        val rates = formRates(d, settings)
        val doc = LinkedHashMap<String, Any?>()
        doc["items"] = d.pieces.map { item(it, rates, photo = false) }
        doc["subtotal"] = NewOrderFormat.finite(t.subtotal)
        doc["discountAmount"] = NewOrderFormat.finite(t.discount)
        val perGram = costRatePerGram(d)
        if (perGram > 0) doc["costRate24k"] = perGram
        val order = DocJSON.decode<Order>("draft", doc)
        return orderMargin(order, prices = t.prices, settings = EntryHouse.margin)
    }
}
