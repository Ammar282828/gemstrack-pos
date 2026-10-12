package erp.core.contract

import erp.core.entry.EntryHouse
import erp.core.entry.SaleDraft
import erp.core.entry.SaleFigures
import erp.core.entry.SaleLine
import erp.core.entry.SaleLineFields
import erp.core.entry.payload
import erp.core.entry.webValues
import erp.core.logic.ExchangeRowPatch
import erp.core.models.Customer
import erp.core.models.Product
import erp.core.models.Settings
import erp.core.swiftTrim

// New sale's contract cases: sales built the way the screen builds them, and what the screen shows before Save,
// against what the ERP saves when it prices the same payload again (contract.test.ts).
//
// Every case goes through the screen's own code: a piece from the shelf is `SaleLine.fromProduct`, an edit is
// `SaleLineFields.applied`, a customer is `SaleDraft.pick` / `typeName`, an exchange row is the rules'
// `applyExchangeRowChange` through `SaleDraft.changeExchange`, "Paid in full" is `SaleDraft.payRest`, the figures are
// `SaleFigures`, and what is sent is `SaleDraft.payload`, the dictionary the screen hands to
// `ErpApi.write("createInvoice", …)`. Names, numbers and shops are made up. (SaleCases.swift, case for case.)

// The shops' settings

private val taheriShop: Map<String, Any?> = mapOf(
    "shopName" to "Demo Gold Shop", "lastInvoiceNumber" to 120,
    "goldRatePerGram24k" to 38500, "goldRatePerGram22k" to 35300, "goldRatePerGram21k" to 33700, "goldRatePerGram18k" to 28900,
    "palladiumRatePerGram" to 12000, "palladiumRatePerGram18k" to 15000, "palladiumRatePerGram12k" to 9000,
    "platinumRatePerGram" to 21000, "silverRatePerGram" to 480,
)

private val minaShop: Map<String, Any?> = mapOf(
    "shopName" to "Demo Silver Shop", "lastInvoiceNumber" to 7,
    "goldRatePerGram24k" to 38500, "goldRatePerGram22k" to 35300, "goldRatePerGram21k" to 33700, "goldRatePerGram18k" to 28900,
    "palladiumRatePerGram" to 0, "palladiumRatePerGram18k" to 0, "palladiumRatePerGram12k" to 0,
    "platinumRatePerGram" to 0, "silverRatePerGram" to 480,
)

private val sana: Map<String, Any?> = mapOf("id" to "CUST-D01", "name" to "Sana Demo", "phone" to "+923000000101", "address" to "Flat 12, Demo Street")
private val bilal: Map<String, Any?> = mapOf("id" to "CUST-D02", "name" to "Bilal Example", "phone" to "+923000000102")

/** A stock document as the shelf has it. */
private fun product(sku: String, name: String, more: Map<String, Any?> = emptyMap(), drop: List<String> = emptyList()): Map<String, Any?> {
    val d = linkedMapOf<String, Any?>(
        "sku" to sku, "name" to name, "categoryId" to "cat001", "metalType" to "gold", "karat" to "21k", "metalWeightG" to 0,
        "hasStones" to false, "stoneWeightG" to 0, "wastagePercentage" to 0, "makingCharges" to 0,
        "hasDiamonds" to false, "diamondCharges" to 0, "stoneCharges" to 0, "miscCharges" to 0,
    )
    for ((k, v) in more) d[k] = v
    for (k in drop) d.remove(k)
    return d
}

private fun silverPiece(sku: String, name: String, more: Map<String, Any?> = emptyMap()): Map<String, Any?> =
    product(sku, name, mapOf<String, Any?>("metalType" to "silver") + more, drop = listOf("karat"))

// A sale, built as the screen builds it

private class Rig(val shop: Map<String, Any?>, customers: List<Map<String, Any?>> = emptyList()) {
    var draft = SaleDraft()
    val stock = LinkedHashMap<String, Map<String, Any?>>()
    val customers: List<Map<String, Any?>> = customers
    private var oneOffs = 0

    // The shelf and the books.

    /** A piece from stock goes on the sale (`SaleLine.fromProduct`, as a tap on a search result does). */
    fun add(doc: Map<String, Any?>) {
        val sku = doc["sku"] as String
        stock[sku] = doc
        val line = SaleLine.fromProduct(decode<Product>(sku, doc))
        // Opening the line editor on a piece and pressing Apply, changing nothing, must not change its price.
        check(SaleLineFields(line).applied(line).priced == line.priced) {
            "$sku: applying the line editor with no change moved a figure of the piece"
        }
        draft.lines.add(line)
    }

    /** The line editor on a piece already on the sale. */
    fun edit(sku: String, change: (SaleLineFields) -> Unit) {
        val i = draft.lines.indexOfFirst { it.sku == sku }
        if (i < 0) error("no $sku on the sale")
        val f = SaleLineFields(draft.lines[i])
        change(f)
        draft.lines[i] = f.applied(draft.lines[i])
    }

    /**
     * "New item": a blank piece (the house's metal), described in the editor, added to the sale. Its key is NEW- and
     * it has no stock. The editor will not add a piece without a name.
     */
    fun newItem(name: String, change: (SaleLineFields) -> Unit): String {
        check(swiftTrim(name).isNotEmpty()) { "a new item needs a name" }
        oneOffs += 1
        val whenSold = 1_790_000_000.0 + oneOffs.toDouble()
        val line = SaleLine.blankFor(EntryHouse.metal, SaleLine.newItemSku(whenSold, draft.lines.map { it.sku }.toSet()))
        line.name = name
        val f = SaleLineFields(line)
        change(f)
        val made = f.applied(line)
        draft.lines.add(made)
        return made.sku
    }

    fun pick(c: Map<String, Any?>) {
        draft.pick(decode<Customer>(c["id"] as String, c))
    }

    fun type(name: String, phone: String) {
        draft.typeName(name)
        draft.customerPhone = phone
    }

    // Exchange and payments.

    fun exchange(index: Int, patches: List<ExchangeRowPatch>) {
        while (draft.exchanges.size <= index) draft.addExchange()
        for (p in patches) draft.changeExchange(draft.exchanges[index].id, p)
    }

    /** Payment row `index` (adding rows as "Add another payment" does). */
    fun pay(index: Int, amount: String, method: String = "Cash", ref: String = "") {
        while (draft.payments.size <= index) draft.addPayment()
        draft.payments[index].amount = amount
        draft.payments[index].method = method
        draft.payments[index].reference = ref
    }

    /** "Paid in full" on row `index`. */
    fun payInFull(index: Int = 0, method: String = "Cash", ref: String = "") {
        pay(index, "", method, ref)
        draft.payRest(draft.payments[index].id, figures().total)
    }

    // The screen's figures, and the case.

    fun settings(): Settings = decode<Settings>("global", shop)

    fun figures(d: SaleDraft? = null): SaleFigures = SaleFigures(
        draft = d ?: draft, settings = settings(),
        customers = customers.map { decode<Customer>(it["id"] as String, it) },
        marginSettings = EntryHouse.margin,
    )

    fun build(name: String): ContractCase {
        val f = figures()
        // The screen only sends a sale it lets be saved.
        check(f.canSave) { "$name: the screen would not save this sale: ${f.blockedReason ?: "?"}" }
        val send = draft.payload(f) { sku -> stock[sku]?.let { decode<Product>(sku, it).qrCodeDataUrl } }
        return ContractCase(
            name = name, house = EntryHouse.id, send = send,
            shown = mapOf("subtotal" to f.subtotal, "discount" to f.discount, "grandTotal" to f.total, "paid" to f.paidNow, "balanceDue" to f.balance),
            settings = shop, stock = stock, customers = customers, draft = draft.webValues(f.subtotal),
        )
    }
}

// Cases

object SaleCases {
    fun taheri(): List<ContractCase> = listOf(
        walkInPaysExactly(), walkInPaysPart(), namedPaysPart(), namedOverpays(), newCustomerTyped(), numberOnFile(),
        discountEqualToSubtotal(), twoExchangeRows(), exchangeBeyondThePieces(), threePayments(),
        oneOffByWeight(), oneOffAtFixedPrice(), repricedStock(), fourKarats(), decimalGrams(), paiseInTheTotal(),
        paidInFullRoundsDown(), paidInFullRoundsUp(), longDecimals(), oneCrore(), palladium18kAlone(), palladiumWithoutKarat(), goldCoin(),
        aRateTypedOnTheSale(), metalsMixed(), stonesAndSecondMetal(), goldWithoutKarat(), everyShopField(),
    )

    fun mina(): List<ContractCase> = listOf(
        silverPieces(), silverAndGold(), plating(), silverDiscountPartExchange(), silverOneOffs(),
        silverRepriced(), silverPaidInFull(), silverCreditForNamed(),
    )

    // Taheri

    private val ring: Map<String, Any?>
        get() = product("RNG-1001", "Twist band", mapOf("metalWeightG" to 4.0, "wastagePercentage" to 10, "makingCharges" to 5000))
    private val hoops: Map<String, Any?>
        get() = product("ERG-2001", "Hoop earrings", mapOf("categoryId" to "cat002", "metalWeightG" to 5.1, "wastagePercentage" to 10, "makingCharges" to 7000))
    private val bangle: Map<String, Any?>
        get() = product("BNG-3001", "Carved bangle", mapOf("categoryId" to "cat007", "karat" to "22k", "metalWeightG" to 18.4, "wastagePercentage" to 6.5, "makingCharges" to 9000))

    /** A walk-in pays the whole bill in cash with "Paid in full": nothing is owed, nothing is booked. */
    private fun walkInPaysExactly(): ContractCase {
        val r = Rig(taheriShop)
        r.add(ring)
        r.payInFull()
        return r.build("a walk-in pays exactly in cash")
    }

    /** Part paid: the rest is booked on the walk-in's hisaab, which has no customer. */
    private fun walkInPaysPart(): ContractCase {
        val r = Rig(taheriShop)
        r.add(hoops)
        r.add(bangle)
        r.pay(0, "100000")
        return r.build("a walk-in pays part, the balance goes on the walk-in hisaab")
    }

    private fun namedPaysPart(): ContractCase {
        val r = Rig(taheriShop, listOf(sana, bilal))
        r.add(bangle)
        r.pick(sana)
        r.pay(0, "50000", "Card", ref = "4321")
        return r.build("a named customer pays part by card")
    }

    /** Paid past the total by a named customer: the extra is their credit, held on their hisaab. */
    private fun namedOverpays(): ContractCase {
        val r = Rig(taheriShop, listOf(sana, bilal))
        r.add(ring)
        r.pick(bilal)
        val total = r.figures().total
        r.pay(0, (erp.core.swiftRounded(total).toLong() + 25000).toString(), "Bank Transfer", ref = "TRX-100234")
        return r.build("a named customer overpays, so the credit is held")
    }

    /** A name and a number nobody has: the ERP makes the customer when the sale is saved. */
    private fun newCustomerTyped(): ContractCase {
        val r = Rig(taheriShop, listOf(sana))
        r.add(hoops)
        r.type(name = "Nadia Example", phone = "0300 0000555")
        r.pay(0, "60000")
        return r.build("a new customer typed by name and number")
    }

    /** Only a number typed, and it is Sana's: the sale goes to her, not to a copy of her. */
    private fun numberOnFile(): ContractCase {
        val r = Rig(taheriShop, listOf(sana, bilal))
        r.add(ring)
        r.type(name = "", phone = "0300 0000101")
        r.pay(0, "20000")
        return r.build("a number already on file is that customer")
    }

    /**
     * The most a discount can be: the whole subtotal. The sale comes to nothing. (More than the subtotal is refused by
     * the screen, checked here.)
     */
    private fun discountEqualToSubtotal(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("FX-1301", "Antique piece", mapOf("metalWeightG" to 9.2, "isCustomPrice" to true, "customPrice" to 87650)))
        r.draft.discount = "87650"
        val over = r.draft.copy()
        over.discount = "87651"
        check(!r.figures(over).canSave) { "a discount over the subtotal must not be saveable" }
        return r.build("a discount equal to the subtotal")
    }

    /** Two exchange rows: one worked from grams × rate, one typed. */
    private fun twoExchangeRows(): ContractCase {
        val r = Rig(taheriShop, listOf(sana))
        r.add(bangle)
        r.add(hoops)
        r.pick(sana)
        r.exchange(
            0,
            listOf(
                ExchangeRowPatch(description = "Old ring"), ExchangeRowPatch(karat = "22k"),
                ExchangeRowPatch(weightG = "5.2"), ExchangeRowPatch(ratePerGram = "30000"),
            ),
        )
        r.exchange(1, listOf(ExchangeRowPatch(description = "Broken chain"), ExchangeRowPatch(value = "40000")))
        r.pay(0, "100000")
        return r.build("two exchange rows")
    }

    /** What is handed over is worth more than the pieces: the bill is below nothing, which a named customer holds as credit. */
    private fun exchangeBeyondThePieces(): ContractCase {
        val r = Rig(taheriShop, listOf(bilal))
        r.add(product("PND-6001", "Pendant", mapOf("categoryId" to "cat004", "karat" to "24k", "metalWeightG" to 2.5, "wastagePercentage" to 5, "makingCharges" to 3000)))
        r.pick(bilal)
        r.exchange(0, listOf(ExchangeRowPatch(description = "Old set"), ExchangeRowPatch(value = "300000")))
        return r.build("an exchange worth more than the pieces, for a named customer")
    }

    private fun threePayments(): ContractCase {
        val r = Rig(taheriShop, listOf(sana))
        r.add(bangle)
        r.add(hoops)
        r.pick(sana)
        r.pay(0, "100000", "Cash")
        r.pay(1, "75000", "Card", ref = "9921")
        r.pay(2, "50000", "Bank Transfer", ref = "TRX-884412")
        return r.build("three payments by three methods")
    }

    /** A piece described on the spot, never in stock, priced by its weight and the rate. */
    private fun oneOffByWeight(): ContractCase {
        val r = Rig(taheriShop)
        r.newItem("Custom locket") { f ->
            f.categoryId = "cat004"; f.karat = "22k"; f.weight = "6.25"; f.wastage = "12"; f.making = "3500"
        }
        r.payInFull()
        return r.build("a one-off NEW- piece priced by weight")
    }

    /** A piece described on the spot at a price agreed, with a weight that only prints. */
    private fun oneOffAtFixedPrice(): ContractCase {
        val r = Rig(taheriShop)
        r.newItem("Heirloom piece") { f ->
            f.fixed = true; f.customPrice = "98765"; f.weight = "8.5"; f.hasDiamonds = true; f.diamondDetails = "0.5ct round"
        }
        r.add(ring)
        r.pay(0, "150000")
        return r.build("a one-off NEW- piece at a fixed price, with a stock piece")
    }

    /** Pieces from stock re-priced on the sale: one to a fixed price, one by a changed weight and making. */
    private fun repricedStock(): ContractCase {
        val r = Rig(taheriShop)
        r.add(ring)
        r.add(bangle)
        r.edit("RNG-1001") { f -> f.fixed = true; f.customPrice = "99999" }
        r.edit("BNG-3001") { f -> f.weight = "19.05"; f.making = "11250.5"; f.wastage = "7" }
        r.pay(0, "100000")
        return r.build("re-priced stock pieces")
    }

    private fun fourKarats(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("K18-1", "Eighteen", mapOf("categoryId" to "cat008", "karat" to "18k", "metalWeightG" to 7.25, "wastagePercentage" to 9, "makingCharges" to 4000)))
        r.add(product("K21-1", "Twenty-one", mapOf("karat" to "21k", "metalWeightG" to 3.9, "wastagePercentage" to 10, "makingCharges" to 2500)))
        r.add(product("K22-1", "Twenty-two", mapOf("categoryId" to "cat007", "karat" to "22k", "metalWeightG" to 11.2, "wastagePercentage" to 6, "makingCharges" to 6000)))
        r.add(product("K24-1", "Twenty-four", mapOf("categoryId" to "cat004", "karat" to "24k", "metalWeightG" to 2.15, "wastagePercentage" to 3, "makingCharges" to 1500)))
        r.pay(0, "250000")
        return r.build("18k, 21k, 22k and 24k pieces in one sale")
    }

    private fun decimalGrams(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("DG-1", "Fine chain", mapOf("categoryId" to "cat008", "karat" to "22k", "metalWeightG" to 3.456, "wastagePercentage" to 7.5, "makingCharges" to 1234.5)))
        r.add(product("DG-2", "Heavy kara", mapOf("categoryId" to "cat007", "karat" to "21k", "metalWeightG" to 12.875, "wastagePercentage" to 9.25, "makingCharges" to 999.99)))
        r.add(product("DG-3", "Tiny stud", mapOf("karat" to "18k", "metalWeightG" to 0.123, "wastagePercentage" to 12.5, "makingCharges" to 150)))
        r.pay(0, "50000")
        return r.build("decimal grams")
    }

    /** A total with paise in it, part paid: what is owed is booked to the paisa. */
    private fun paiseInTheTotal(): ContractCase {
        val r = Rig(taheriShop, listOf(sana))
        r.add(product("PS-1", "Odd weight", mapOf("karat" to "22k", "metalWeightG" to 4.337, "wastagePercentage" to 6.75, "makingCharges" to 1250.5, "stoneCharges" to 333.33)))
        r.pick(sana)
        r.pay(0, "100000")
        return r.build("paise in the total, part paid")
    }

    /** "Paid in full" pays whole rupees: when the total has paise that round down, the paise stay owed. */
    private fun paidInFullRoundsDown(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("PD-9", "Price with paise", mapOf("isCustomPrice" to true, "customPrice" to 12345.4)))
        r.payInFull()
        return r.build("paid in full when the total has paise that round down")
    }

    /**
     * "Paid in full" pays whole rupees: when the paise round up, the 40 paise over are settled, not credit (under half a
     * rupee either way is settled, lib/invoice-credit inCredit): the invoice says -0.40 and the books hold nothing for it.
     */
    private fun paidInFullRoundsUp(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("PU-9", "Price with paise, up", mapOf("isCustomPrice" to true, "customPrice" to 12345.6)))
        r.payInFull()
        return r.build("paid in full when the total has paise that round up")
    }

    /** A piece weighed and charged to more decimals than anyone types: the line editor keeps every digit. */
    private fun longDecimals(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("LD-1", "Long decimals", mapOf("karat" to "22k", "metalWeightG" to 3.45678, "wastagePercentage" to 7.123456, "makingCharges" to 1234.56789)))
        r.edit("LD-1") { f -> f.billDescription = "Engraved" }
        r.pay(0, "100000")
        return r.build("a piece with long decimals, opened in the editor")
    }

    /** A piece of 1 crore and a little over, by weight. */
    private fun oneCrore(): ContractCase {
        val r = Rig(taheriShop, listOf(bilal))
        r.add(product("BIG-1401", "Show piece", mapOf("categoryId" to "cat015", "metalWeightG" to 268.5, "wastagePercentage" to 10, "makingCharges" to 100000)))
        r.pick(bilal)
        r.pay(0, "10000000", "Bank Transfer", ref = "TRX-770001")
        return r.build("a one-crore piece")
    }

    /** Palladium 18k on its own: the per-karat rate prices it, not the flat one. */
    private fun palladium18kAlone(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("PD-7001", "Palladium band", mapOf("categoryId" to "cat009", "metalType" to "palladium", "karat" to "18k", "metalWeightG" to 7.5, "wastagePercentage" to 5, "makingCharges" to 4000)))
        r.pay(0, "60000")
        return r.build("palladium 18k alone")
    }

    /** Palladium with no karat takes the flat rate. */
    private fun palladiumWithoutKarat(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("PD-7002", "Palladium ring", mapOf("metalType" to "palladium", "metalWeightG" to 4.2, "wastagePercentage" to 5, "makingCharges" to 2000), drop = listOf("karat")))
        r.add(product("PD-7003", "Palladium 12k", mapOf("metalType" to "palladium", "karat" to "12k", "metalWeightG" to 3.3, "makingCharges" to 1000)))
        r.payInFull()
        return r.build("palladium without a karat takes the flat rate, with a 12k piece")
    }

    /** A gold coin is its metal and nothing else: making, wastage, diamonds, stones and sundries are ignored. */
    private fun goldCoin(): ContractCase {
        val r = Rig(taheriShop)
        r.add(
            product(
                "COIN-5001", "One tola coin",
                mapOf(
                    "categoryId" to "cat017", "karat" to "24k", "metalWeightG" to 11.664, "wastagePercentage" to 10, "makingCharges" to 5000,
                    "hasDiamonds" to true, "diamondCharges" to 9000, "stoneCharges" to 700, "miscCharges" to 300,
                ),
            ),
        )
        r.payInFull()
        return r.build("a gold coin ignores making, wastage and stones")
    }

    /** The 21k box typed on this sale prices it; the shop's rate is left as it was. */
    private fun aRateTypedOnTheSale(): ContractCase {
        val r = Rig(taheriShop)
        r.add(ring)
        r.add(bangle)
        r.draft.rates["gold21k"] = "34250.50"
        r.pay(0, "70000")
        return r.build("a rate typed on the sale prices it")
    }

    /** Gold, platinum and silver on one bill: each at its own rate. */
    private fun metalsMixed(): ContractCase {
        val r = Rig(taheriShop)
        r.add(ring)
        r.add(product("PT-8001", "Platinum band", mapOf("categoryId" to "cat009", "metalType" to "platinum", "metalWeightG" to 5.5, "wastagePercentage" to 8, "makingCharges" to 3000), drop = listOf("karat")))
        r.add(silverPiece("SLV-9001", "Silver ring", mapOf("metalWeightG" to 6.2, "silverRatePerGram" to 520, "stoneCharges" to 300)))
        r.add(silverPiece("SLV-9002", "Silver chain", mapOf("categoryId" to "cat008", "metalWeightG" to 18)))
        r.pay(0, "100000")
        return r.build("gold, platinum and silver on one bill")
    }

    /** Stones' weight comes off the metal; a second metal is added; diamonds, stones and making are charged. */
    private fun stonesAndSecondMetal(): ContractCase {
        val r = Rig(taheriShop)
        r.add(
            product(
                "STN-1101", "Ruby ring",
                mapOf(
                    "metalWeightG" to 10, "stoneWeightG" to 1.5, "hasStones" to true, "stoneCharges" to 2500, "hasDiamonds" to true,
                    "diamondCharges" to 18000, "wastagePercentage" to 9, "makingCharges" to 6000,
                    "secondaryMetalType" to "gold", "secondaryMetalKarat" to "18k", "secondaryMetalWeightG" to 2,
                ),
            ),
        )
        r.pay(0, "150000")
        return r.build("stones, diamonds and a second metal")
    }

    /** Gold with no karat is priced as 21k. */
    private fun goldWithoutKarat(): ContractCase {
        val r = Rig(taheriShop)
        r.add(product("NK-1201", "Unmarked piece", mapOf("metalWeightG" to 5, "wastagePercentage" to 10, "makingCharges" to 2000), drop = listOf("karat")))
        r.payInFull()
        return r.build("gold with no karat is priced as 21k")
    }

    /** Every optional field of a sale at once: taken by, rates off the bill, a note, delivery, the 24k rate. */
    private fun everyShopField(): ContractCase {
        val r = Rig(taheriShop, listOf(sana))
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
        r.pay(0, "80000", "Cheque", ref = "CHQ-0042")
        return r.build("every optional field of a sale")
    }

    // Mina (silver)

    private val silverRing: Map<String, Any?>
        get() = silverPiece("MS-1001", "Silver ring", mapOf("metalWeightG" to 6, "stoneCharges" to 300))
    private val silverBracelet: Map<String, Any?>
        get() = silverPiece("MS-1002", "Silver bracelet", mapOf("categoryId" to "cat005", "metalWeightG" to 14.2, "silverRatePerGram" to 650))

    private fun silverPieces(): ContractCase {
        val r = Rig(minaShop)
        r.add(silverRing)
        r.add(silverBracelet)
        r.pay(0, "5000")
        return r.build("silver pieces, one at the shop's rate and one at its own")
    }

    private fun silverAndGold(): ContractCase {
        val r = Rig(minaShop, listOf(sana))
        r.add(silverRing)
        r.add(product("MG-2001", "Gold stud", mapOf("metalWeightG" to 1.8, "wastagePercentage" to 10, "makingCharges" to 2500)))
        r.pick(sana)
        r.pay(0, "30000", "Card", ref = "5521")
        return r.build("silver and gold mixed")
    }

    /** Plating and nickel-free are on the bill, not in the price. */
    private fun plating(): ContractCase {
        val r = Rig(minaShop)
        r.add(silverPiece("MS-1003", "Silver pendant", mapOf("categoryId" to "cat004", "metalWeightG" to 3.75, "stoneCharges" to 150)))
        r.add(silverPiece("MS-1004", "Silver bangle", mapOf("categoryId" to "cat007", "metalWeightG" to 22.4)))
        r.edit("MS-1003") { f -> f.platingType = "White Rhodium"; f.nickelFree = true }
        r.edit("MS-1004") { f -> f.platingType = "Other"; f.platingNote = "Rose gold plating" }
        r.payInFull()
        return r.build("plating")
    }

    private fun silverDiscountPartExchange(): ContractCase {
        val r = Rig(minaShop)
        r.add(silverRing)
        r.add(silverBracelet)
        r.type(name = "Farah Example", phone = "0300 0000888")
        r.draft.discount = "1,500"
        r.exchange(0, listOf(ExchangeRowPatch(description = "Old silver ring"), ExchangeRowPatch(weightG = "10"), ExchangeRowPatch(ratePerGram = "400")))
        r.pay(0, "5000")
        return r.build("a discount, a partial payment and an exchange")
    }

    /** Pieces described on the spot in a silver house: the house's metal, no wastage; one by weight, one fixed. */
    private fun silverOneOffs(): ContractCase {
        val r = Rig(minaShop)
        r.newItem("Custom silver set") { f -> f.categoryId = "cat006"; f.weight = "31.4"; f.stoneCharges = "1200" }
        r.newItem("Gifted piece, agreed price") { f -> f.fixed = true; f.customPrice = "7500"; f.weight = "12" }
        r.pay(0, "10000")
        return r.build("one-off silver pieces, by weight and at a fixed price")
    }

    private fun silverRepriced(): ContractCase {
        val r = Rig(minaShop)
        r.add(silverRing)
        r.add(silverBracelet)
        r.edit("MS-1001") { f -> f.fixed = true; f.customPrice = "3200" }
        r.edit("MS-1002") { f -> f.silverRate = "610"; f.weight = "14.25" }
        r.pay(0, "4000")
        return r.build("silver pieces re-priced on the sale")
    }

    private fun silverPaidInFull(): ContractCase {
        val r = Rig(minaShop)
        r.add(silverRing)
        r.payInFull()
        return r.build("silver paid in full in cash")
    }

    private fun silverCreditForNamed(): ContractCase {
        val r = Rig(minaShop, listOf(bilal))
        r.add(silverBracelet)
        r.pick(bilal)
        val total = r.figures().total
        r.pay(0, (erp.core.swiftRounded(total).toLong() + 2000).toString(), "Bank Transfer", ref = "TRX-30011")
        return r.build("a named customer overpays a silver sale")
    }
}
