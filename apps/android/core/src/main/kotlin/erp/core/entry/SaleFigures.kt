package erp.core.entry

import erp.core.logic.GOLD_COIN_CATEGORY_ID_INTERNAL
import erp.core.logic.Margin
import erp.core.logic.MarginLine
import erp.core.logic.MarginSettings
import erp.core.logic.Money
import erp.core.logic.PricingRates
import erp.core.logic.ProductCosts
import erp.core.logic.RateInputKey
import erp.core.logic.calculateProductCosts
import erp.core.logic.canHoldCredit
import erp.core.logic.exchangeRowsTotal
import erp.core.logic.exchangesFromRows
import erp.core.logic.inCredit
import erp.core.logic.marginOf
import erp.core.logic.pakistanE164
import erp.core.logic.rates
import erp.core.logic.ratesToKeep
import erp.core.logic.resolveSaleCustomer
import erp.core.logic.shouldCreateCustomer
import erp.core.models.Customer
import erp.core.models.ExchangeEntry
import erp.core.models.Invoice
import erp.core.models.MetalType
import erp.core.models.Product
import erp.core.models.Settings
import erp.core.logic.SaleCustomer
import erp.core.swiftTrim
import erp.core.swiftTrimNewlines
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// What the sale comes to, worked out by the rules and nothing of its own: Pricing (src/lib/pricing.ts) for every
// line, Exchange for the exchange rows, WalkIn for who the sale is to, InvoiceCredit for what paying over the total
// means. The server prices the sale again with the same rules when it is saved (lib/writes/create-invoice.ts); these
// figures are only what the screen shows until then, so they must match it line for line. (SaleFigures.swift.)

/**
 * The rate boxes of one sale: today's rates (the shop's settings) unless a box was typed here (the web's
 * `rateInputs` / `heldRates`). A typed rate prices this sale and is never written back.
 */
class SaleRateBook(val settings: Settings?, val typed: Map<String, String>) {
    /** The shop's rate for a box. */
    fun settingsValue(k: RateInputKey): Double {
        val s = settings ?: return 0.0
        return when (k) {
            RateInputKey.gold24k -> s.goldRatePerGram24k
            RateInputKey.gold22k -> s.goldRatePerGram22k
            RateInputKey.gold21k -> s.goldRatePerGram21k
            RateInputKey.gold18k -> s.goldRatePerGram18k
            RateInputKey.palladium -> s.palladiumRatePerGram
            RateInputKey.palladium18k -> s.palladiumRatePerGram18k
            RateInputKey.palladium12k -> s.palladiumRatePerGram12k
            RateInputKey.platinum -> s.platinumRatePerGram
            RateInputKey.silver -> s.silverRatePerGram
        }
    }

    /** What the box shows: the typed text, else today's rate as the web shows it ("33700.00"). */
    fun text(k: RateInputKey): String = typed[k.name] ?: Money.fixed(settingsValue(k), 2)

    /** `parseFloat(box) || the shop's rate`: a blank or zero box prices at today's rate. */
    fun value(k: RateInputKey): Double {
        val v = SaleNumber.parse(text(k))
        if (v != null && v != 0.0) return v
        return settingsValue(k)
    }

    /** The card the lines are priced from. */
    val pricing: PricingRates
        get() = PricingRates(
            goldRatePerGram24k = value(RateInputKey.gold24k), goldRatePerGram22k = value(RateInputKey.gold22k),
            goldRatePerGram21k = value(RateInputKey.gold21k), goldRatePerGram18k = value(RateInputKey.gold18k),
            palladiumRatePerGram = value(RateInputKey.palladium), palladiumRatePerGram18k = value(RateInputKey.palladium18k),
            palladiumRatePerGram12k = value(RateInputKey.palladium12k),
            platinumRatePerGram = value(RateInputKey.platinum), silverRatePerGram = value(RateInputKey.silver),
        )

    /**
     * The rates the invoice is saved with (`ratesForInvoice` in sale-page.tsx): the metals the bill carries. Unlike the
     * web, the per-karat palladium rates go with a palladium piece too: the web sends them only for gold, so a
     * palladium-only bill was priced at the flat rate on the server while the screen showed the per-karat one (the
     * mismatch calculateProductCosts' own comment describes).
     */
    fun forInvoice(metals: Set<String>): MutableMap<String, Double> {
        val o = LinkedHashMap<String, Double>()
        if (metals.contains("gold") || metals.contains("palladium")) {
            o["palladiumRatePerGram18k"] = value(RateInputKey.palladium18k)
            o["palladiumRatePerGram12k"] = value(RateInputKey.palladium12k)
        }
        if (metals.contains("gold")) {
            o["goldRatePerGram18k"] = value(RateInputKey.gold18k)
            o["goldRatePerGram21k"] = value(RateInputKey.gold21k)
            o["goldRatePerGram22k"] = value(RateInputKey.gold22k)
            o["goldRatePerGram24k"] = value(RateInputKey.gold24k)
        }
        if (metals.contains("palladium")) o["palladiumRatePerGram"] = value(RateInputKey.palladium)
        if (metals.contains("platinum")) o["platinumRatePerGram"] = value(RateInputKey.platinum)
        if (metals.contains("silver")) o["silverRatePerGram"] = value(RateInputKey.silver)
        return o
    }
}

/** One rate box on the screen. */
data class SaleRateBox(val key: RateInputKey, val label: String) {
    val id: String get() = key.name
}

/** Everything the screen shows about the sale, worked out once per draw. */
class SaleFigures(draft: SaleDraft, settings: Settings?, customers: List<Customer>, marginSettings: MarginSettings) {
    val rateBook: SaleRateBook = SaleRateBook(settings, draft.rates)

    /** Each piece's costs at this sale's rates, by SKU. */
    val costs: Map<String, ProductCosts>
    val metals: Set<String>
    val boxes: List<SaleRateBox>

    /** Karats (as "21K") of gold pieces on the bill whose box is zero or unreadable: the total cannot be worked out. */
    val missingRates: List<String>

    val subtotal: Double
    val discount: Double
    val exchange: Double

    /** Subtotal less discount less exchange. */
    val total: Double
    val paidNow: Double

    /** Total less what is paid now; below zero is the customer's credit. */
    val balance: Double

    val who: SaleCustomer

    /** A named customer, new or on file: paying over the total is their credit. A walk-in's extra is change. */
    val namedCustomer: Boolean
    val hasPieces: Boolean

    /** The web's `estimatedInvoice` exists: pieces, settings, and every gold rate the bill needs. */
    val hasEstimate: Boolean
    val paidOver: Boolean
    val overpaid: Boolean
    val inCreditNow: Boolean
    val locked: Boolean
    val discountProblem: String?
    val margin: Margin?

    init {
        val book = rateBook
        val lines = draft.lines
        hasPieces = lines.isNotEmpty()

        // Which metals and karats the bill carries (cartMetalInfo).
        val metalSet = LinkedHashSet<String>()
        val goldKarats = HashSet<String>()
        val palladiumKarats = HashSet<String>()
        for (l in lines) {
            metalSet.add(l.metalType)
            val k = l.karat
            if (k == null || k.isEmpty()) continue
            if (l.metalType == "gold") goldKarats.add(k) else if (l.metalType == "palladium") palladiumKarats.add(k)
        }
        metals = metalSet

        // Only the rates this bill uses. A silver-only bill prices per piece and has none.
        val shown = ArrayList<SaleRateBox>()
        for (k in listOf("18k", "21k", "22k", "24k")) {
            if (!goldKarats.contains(k)) continue
            val key = rateInputKey("gold$k")
            if (key != null) shown.add(SaleRateBox(key, "Gold $k / gram"))
        }
        if (metalSet.contains("palladium")) {
            if (palladiumKarats.contains("18k")) shown.add(SaleRateBox(RateInputKey.palladium18k, "Palladium 18k / gram"))
            if (palladiumKarats.contains("12k")) shown.add(SaleRateBox(RateInputKey.palladium12k, "Palladium 12k / gram"))
            if (palladiumKarats.isEmpty()) shown.add(SaleRateBox(RateInputKey.palladium, "Palladium flat / gram"))
        }
        boxes = shown

        // `hasInvalidRate`: a gold karat on the bill whose box is blank, zero or not a number.
        val missing = ArrayList<String>()
        for (box in shown) {
            if (!box.key.name.startsWith("gold")) continue
            val v = SaleNumber.parse(book.text(box.key))
            if (v == null || v <= 0) missing.add(box.key.name.drop(4).uppercase())
        }
        missingRates = missing

        val pricing = book.pricing
        val byLine = LinkedHashMap<String, ProductCosts>()
        var sum = 0.0
        for (l in lines) {
            val c = calculateProductCosts(l.priced, pricing)
            byLine[l.sku] = c
            sum += c.totalPrice
        }
        costs = byLine
        subtotal = sum
        discount = SaleNumber.value(draft.discount)
        exchange = exchangeRowsTotal(draft.exchanges.map { it.core })
        total = sum - discount - exchange
        paidNow = draft.payments.fold(0.0) { acc, p -> acc + SaleNumber.value(p.amount) }
        balance = total - paidNow

        who = resolveSaleCustomer(selectedId = draft.customerId, typedName = draft.customerName, typedPhone = draft.customerPhone, customers = customers)
        // generateInvoice makes a customer for a typed name or number (shouldCreateCustomer); a walk-in has none.
        val named = canHoldCredit(who.id) || shouldCreateCustomer(who)
        namedCustomer = named

        val estimate = settings != null && lines.isNotEmpty() && missing.isEmpty()
        hasEstimate = estimate
        val over = estimate && inCredit(sum - discount - exchange - paidNow)
        paidOver = over
        overpaid = over && !named
        inCreditNow = over && named
        locked = settings?.databaseLocked ?: false

        discountProblem = if (discount < 0) {
            "The discount can't be negative."
        } else if (discount > sum && lines.isNotEmpty()) {
            "The discount can't be more than the subtotal."
        } else {
            null
        }

        // The shop's margin on this sale (lib/margin.ts): owners' screen only, never the customer's.
        margin = if (estimate && marginSettings.rattiLess != null) {
            val marginLines = lines.map { l ->
                val c = byLine[l.sku] ?: ProductCosts()
                val stonesSet = l.hasDiamonds || l.hasStones ||
                    swiftTrim(l.stoneDetails ?: "").isNotEmpty() ||
                    swiftTrim(l.diamondDetails ?: "").isNotEmpty() ||
                    l.stoneWeightG > 0
                MarginLine(
                    metalType = l.metalType, karat = l.karat, weightG = l.metalWeightG, stoneWeightG = l.stoneWeightG,
                    quantity = 1.0, price = c.totalPrice, stoneCharges = c.stoneCharges, diamondCharges = c.diamondCharges,
                    isCoin = l.categoryId == GOLD_COIN_CATEGORY_ID_INTERNAL, fixedPrice = l.isCustomPrice,
                    setWithStones = stonesSet,
                )
            }
            val perGram = SaleNumber.value(draft.costTola) / SALE_GRAMS_PER_TOLA
            marginOf(marginLines, revenue = sum - discount, rate24k = if (perGram > 0) perGram else null, settings = marginSettings)
        } else {
            null
        }
    }

    /** Why Save is off, in words (sale-page.tsx `invoiceBlockedReason`), or null when the sale can be saved. */
    val blockedReason: String?
        get() {
            if (locked) return "The database is locked. Unlock it in Settings to save sales."
            if (!hasPieces) return "Add a piece to the sale first."
            if (rateBook.settings == null) return "The shop's rates have not loaded yet."
            if (missingRates.isNotEmpty()) {
                return "Enter a ${missingRates.joinToString(" and ")} gold rate under Rates: it is zero, so the total cannot be worked out."
            }
            discountProblem?.let { return it }
            if (overpaid) {
                return "The payments come to more than the total. To keep the rest as credit, name the customer; otherwise check the amounts received."
            }
            return null
        }

    val canSave: Boolean get() = blockedReason == null

    fun price(sku: String): Double = costs[sku]?.totalPrice ?: 0.0
}

// What is sent

private fun exchangeJSON(e: ExchangeEntry): MutableMap<String, Any?> {
    val o = LinkedHashMap<String, Any?>()
    o["description"] = e.description
    o["value"] = e.value
    val k = e.karat
    if (k != null && k.isNotEmpty()) o["karat"] = k
    e.weightG?.let { o["weightG"] = it }
    e.ratePerGram?.let { o["ratePerGram"] = it }
    return o
}

/**
 * The sale as createInvoice takes it (the web's `generateInvoice` arguments): exactly the fields the screen passes to
 * `ErpApi.write("createInvoice", …)`. `qr` finds a piece's tag image on the live shelf (sold_products keeps the whole
 * document); a piece described for this bill has none.
 */
fun SaleDraft.payload(f: SaleFigures, qr: (String) -> String?): MutableMap<String, Any?> {
    fun trimmed(s: String): String = swiftTrimNewlines(s)
    val out = LinkedHashMap<String, Any?>()
    out["cart"] = lines.map { it.payload(qr(it.sku)) }
    val customer = LinkedHashMap<String, Any?>()
    customer["name"] = f.who.name
    f.who.id?.let { customer["id"] = it }
    if (f.who.phone.isNotEmpty()) customer["phone"] = pakistanE164(f.who.phone)
    out["customer"] = customer
    out["rates"] = f.rateBook.forInvoice(f.metals)
    out["discountAmount"] = f.discount
    out["exchanges"] = exchangesFromRows(exchanges.map { it.core }).map { exchangeJSON(it) }
    val paid = ArrayList<Map<String, Any?>>()
    for (r in payments) {
        val amount = SaleNumber.value(r.amount)
        if (amount <= 0) continue
        val p = LinkedHashMap<String, Any?>()
        p["amount"] = amount
        p["method"] = r.method
        val ref = if (r.method == "Cash") "" else trimmed(r.reference)
        if (ref.isNotEmpty()) p["reference"] = ref
        paid.add(p)
    }
    out["payments"] = paid
    if (trimmed(takenBy).isNotEmpty()) out["takenBy"] = trimmed(takenBy)
    out["hideRates"] = hideRates
    if (trimmed(internalNote).isNotEmpty()) out["internalNote"] = trimmed(internalNote)
    delivery.payload?.let { out["delivery"] = it }
    val perGram = SaleNumber.value(costTola) / SALE_GRAMS_PER_TOLA
    if (perGram > 0) out["costRate24k"] = perGram
    return out
}

// Rates typed on the sale

/**
 * The rates typed on this sale that become the shop's rates once the invoice is saved (sale-page.tsx `keptRates`, the
 * rules' `ratesToKeep`): only a NEW sale writes back, only boxes typed by hand, only for a metal the bill carries,
 * only a real rate that differs from the shop's stored one. Decided before the save, from the shop's rates as they
 * stood. Keys are the settings' own names (`setRates`). The phone has no edit of an invoice and no bill scanner, so a
 * typed box is the only way a rate is held.
 */
fun SaleDraft.ratesToWriteBack(f: SaleFigures, current: Settings?): Map<String, Double>? {
    if (current == null) return null
    val typed = LinkedHashSet<RateInputKey>()
    val inputs = LinkedHashMap<RateInputKey, String>()
    for ((name, text) in rates) {
        val key = rateInputKey(name) ?: continue
        typed.add(key)
        inputs[key] = text
    }
    val metals = f.metals.map { MetalType.of(it) }.toSet()
    val kept = ratesToKeep(isNew = true, typed = typed, inputs = inputs, metals = metals, current = current.rates) ?: return null
    val out = LinkedHashMap<String, Double>()
    for ((key, value) in kept) out[key.name] = value
    return out
}

// Lookups

/** Finding pieces: by what is typed, by a scanned tag, and where a piece went when it is not in stock. */
object SaleLookup {
    /** A key made up for one bill (lib/sku.ts ONE_OFF_SKU_PREFIXES). */
    fun isOneOff(sku: String): Boolean = sku.startsWith("NEW-") || sku.startsWith("BILL-")

    /** Pieces in stock matching what is typed: every word in the SKU or the name, not already on the sale, at most `limit` (handleSkuInputChange). */
    fun matches(query: String, products: List<Product>, excluding: Set<String>, limit: Int = 8): List<Product> {
        val tokens = swiftTrimNewlines(query).uppercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return emptyList()
        val out = ArrayList<Product>()
        for (p in products) {
            if (excluding.contains(p.sku)) continue
            val sku = p.sku.uppercase()
            val name = p.name.uppercase()
            if (tokens.all { sku.contains(it) || name.contains(it) }) {
                out.add(p)
                if (out.size == limit) break
            }
        }
        return out
    }

    /** The piece with exactly this SKU, else the same letters in any case. */
    fun find(sku: String, products: List<Product>): Product? {
        val t = swiftTrimNewlines(sku)
        if (t.isEmpty()) return null
        return products.firstOrNull { it.sku == t } ?: products.firstOrNull { it.sku.equals(t, ignoreCase = true) }
    }

    /** The sale a piece went out on, if the books have it (a tag scanned after the piece was sold). */
    fun soldOn(sku: String, invoices: List<Invoice>): Invoice? {
        val t = swiftTrimNewlines(sku)
        if (t.isEmpty()) return null
        return invoices.firstOrNull { inv -> inv.items.any { it.sku.equals(t, ignoreCase = true) } }
    }

    /** The stock SKUs a refusal names, and whether it says the sale was saved before. */
    data class Refusal(val gone: List<String>, val alreadySold: Boolean)

    /**
     * What the server's 409 says (create-invoice route): "No longer in stock: A, B, Gold ring (already sold)." A stock
     * piece is named by its SKU; a piece described for this bill (NEW-…) is named by its name and "(already sold)",
     * because it was refused for being on an invoice already, i.e. this sale was saved before. `gone` is the stock SKUs
     * on the sale that are named, which can be taken off.
     */
    fun refusal(message: String, lines: List<SaleLine>): Refusal {
        val marker = "No longer in stock:"
        val at = message.indexOf(marker)
        if (at < 0) return Refusal(emptyList(), false)
        val tokens = message.substring(at + marker.length)
            .split(",").filter { it.isNotEmpty() }
            .map { it.trim(' ', '.', '\n') }
        val stock = lines.filter { !it.isOneOff }.map { it.sku }.toSet()
        return Refusal(tokens.filter { stock.contains(it) }, message.contains("(already sold)"))
    }

    /**
     * Every address this customer has been sent to, newest first, then the one on their page (delivery-fields.tsx
     * `knownAddressesFor`), once each.
     */
    fun knownAddresses(customerId: String?, customerAddress: String?, invoices: List<Invoice>): List<String> {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        fun take(raw: String?) {
            val a = swiftTrimNewlines(raw ?: "")
            if (a.isEmpty() || !seen.add(a.lowercase())) return
            out.add(a)
        }
        if (!customerId.isNullOrEmpty()) {
            for (inv in invoices) if (inv.customerId == customerId) take(inv.delivery?.address)
        }
        take(customerAddress)
        return out
    }
}

/** A scanned code is a SKU, or a URL ending in one. */
object TagCode {
    /** The SKU in a scanned or typed code: the code itself, or the last part of the path when it is a link. */
    fun sku(code: String): String {
        val t = swiftTrimNewlines(code)
        if (!t.contains("/")) return t
        var path = t
        val q = path.indexOfFirst { it == '?' || it == '#' }
        if (q >= 0) path = path.substring(0, q)
        val last = path.split("/").lastOrNull { it.isNotEmpty() } ?: t
        return percentDecoded(last) ?: last
    }

    /** `removingPercentEncoding`: null when a % is not followed by two hex digits or the bytes are not UTF-8. */
    private fun percentDecoded(s: String): String? {
        val bytes = s.toByteArray(Charsets.UTF_8)
        val out = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < bytes.size) {
            val b = bytes[i].toInt()
            if (b == '%'.code) {
                if (i + 2 >= bytes.size) return null
                val hi = Character.digit(bytes[i + 1].toInt().toChar(), 16)
                val lo = Character.digit(bytes[i + 2].toInt().toChar(), 16)
                if (hi < 0 || lo < 0) return null
                out.write(hi * 16 + lo)
                i += 3
            } else {
                out.write(b)
                i += 1
            }
        }
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(out.toByteArray())).toString()
        } catch (e: CharacterCodingException) {
            null
        }
    }
}
