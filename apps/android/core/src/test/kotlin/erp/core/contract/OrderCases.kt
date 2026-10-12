package erp.core.contract

import erp.core.ERPDecode
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderDraftStore
import erp.core.entry.NewOrderEdit
import erp.core.entry.NewOrderFormat
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderPieceDraft
import erp.core.entry.NewOrderSizes
import erp.core.entry.SaleDraft
import erp.core.entry.SaleLine
import erp.core.entry.editRequest
import erp.core.entry.webValues
import erp.core.logic.ExchangeRowPatch
import erp.core.logic.wastageGramsFor
import erp.core.models.Customer
import erp.core.models.Order
import erp.core.models.Settings
import kotlin.math.abs

// New order's contract cases: outliers, not happy paths. Each is a NewOrderDraft filled the way the form fills it
// (the same mutating helpers the controls call: setMetal, choose, patchExchange, duplicatePiece, wastageText,
// seedRates), then turned into `send` and `shown` by the same functions the screen calls: NewOrderMath.request (what
// NewOrder.save passes to ErpApi.write("createOrder", …)) and NewOrderMath.totals (the figures the form displays).
// Nothing is worked out here. (OrderCases.swift, case for case and word for word.)
//
// The ERP's test (src/app/api/app/write/contract.test.ts) holds `shown` and the pieces in `send` to the web form's own
// money (lib/order-estimate.ts) and saves each through the real route. Beyond that, a few things the test does not
// look at are checked here, and the run stops if one is wrong.
//
// All made up: names, numbers, rates.

object OrderCases {
    /** Editing preserves workshop facts and the photo until the counter changes them. */
    fun auditEdits() {
        val settings = decode<Settings>("global", taheriSettings)
        val order = decode<Order>(
            "ORD-TEST",
            mapOf(
                "items" to listOf(
                    mapOf(
                        "description" to "Test ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5,
                        "isCompleted" to true, "samplePhotoId" to "photo-test", "givenAt" to "2026-10-01",
                    ),
                ),
            ),
        )
        val edit = NewOrderEdit(order)
        val draft = edit.draft
        fun sent(draft: NewOrderDraft): Map<String, Any?> {
            val request = NewOrderMath.editRequest(draft, edit, settings, emptyList())

            @Suppress("UNCHECKED_CAST")
            return (((request["order"] as Map<String, Any?>)["items"]) as List<Map<String, Any?>>)[0]
        }
        expect(draft.pieces[0].isCompleted, "edit", "finished state lost on opening")
        expect(draft.pieces[0].samplePhotoId == "photo-test", "edit", "saved photo lost on opening")
        expect(sent(draft)["isCompleted"] == true, "edit", "unchanged finished state lost")
        expect(!sent(draft).containsKey("samplePhotoId"), "edit", "untouched photo should stay on file")
        draft.pieces[0].isCompleted = false
        expect(sent(draft)["isCompleted"] == false, "edit", "finished toggle not sent")
        draft.pieces[0].removePhoto = true
        expect(isNull(sent(draft), "samplePhotoId"), "edit", "photo removal not sent")
        expect(isNull(sent(draft), "sampleImageDataUri"), "edit", "inline photo removal not sent")
        draft.pieces[0].photo = byteArrayOf(1, 2, 3)
        expect((sent(draft)["sampleImageDataUri"] as? String)?.startsWith("data:image/jpeg;base64,") == true, "edit", "replacement photo not sent")
        val legacy = NewOrderPieceDraft.fromMap(emptyMap())
        expect(!legacy.isCompleted && !legacy.removePhoto && legacy.samplePhotoId == null, "edit", "old draft defaults changed")
    }

    /** Swift's `is NSNull`: the key is there and holds null. */
    private fun isNull(m: Map<String, Any?>, key: String): Boolean = m.containsKey(key) && m[key] == null

    // The shops' books (app_settings/global as Firestore holds it)

    /** Taheri: gold by karat, palladium by grade and flat, platinum, silver. */
    val taheriSettings: Map<String, Any?> = mapOf(
        "shopName" to "Test Jewellers", "shopAddress" to "1 Test Street", "shopContact" to "0300-0000000",
        "goldRatePerGram24k" to 41250.5, "goldRatePerGram22k" to 37812.25, "goldRatePerGram21k" to 36090.75,
        "goldRatePerGram18k" to 30937.5,
        "palladiumRatePerGram" to 8125.4, "palladiumRatePerGram18k" to 9310.15, "palladiumRatePerGram12k" to 6205.35,
        "platinumRatePerGram" to 11480, "silverRatePerGram" to 312.5,
        "lastOrderNumber" to 4177, "lastInvoiceNumber" to 2210, "databaseLocked" to false,
    )

    /** A shop that has set only the flat palladium rate. */
    val flatPalladiumSettings: Map<String, Any?> = mapOf(
        "shopName" to "Test Jewellers", "shopAddress" to "1 Test Street", "shopContact" to "0300-0000000",
        "goldRatePerGram24k" to 41250.5, "goldRatePerGram22k" to 37812.25, "goldRatePerGram21k" to 36090.75,
        "goldRatePerGram18k" to 30937.5,
        "palladiumRatePerGram" to 8125.4,
        "platinumRatePerGram" to 11480, "silverRatePerGram" to 312.5,
        "lastOrderNumber" to 88, "lastInvoiceNumber" to 40, "databaseLocked" to false,
    )

    /** House of Mina: silver is the shop's metal; gold is rarely asked for. */
    val minaSettings: Map<String, Any?> = mapOf(
        "shopName" to "Test Silver House", "shopAddress" to "2 Sample Road", "shopContact" to "0301-0000000",
        "goldRatePerGram24k" to 40800.25, "goldRatePerGram22k" to 37400, "goldRatePerGram21k" to 35650.5,
        "goldRatePerGram18k" to 30600.75,
        "palladiumRatePerGram" to 7900, "platinumRatePerGram" to 11200, "silverRatePerGram" to 297.75,
        "lastOrderNumber" to 912, "lastInvoiceNumber" to 655, "databaseLocked" to false,
    )

    val hina: Map<String, Any?> = mapOf(
        "id" to "cust-test-0001", "name" to "Hina Mockwell", "phone" to "+923005550142",
        "source" to "referral", "address" to "12 Test Lane, Sample Town", "ringSize" to "10",
    )
    val omar: Map<String, Any?> = mapOf(
        "id" to "cust-test-0002", "name" to "Omar Samplani", "phone" to "+923215550177",
    )

    // Building a case

    /**
     * Makes one case. `fill` does what the person does on the form; the rates start as today's (the form seeds them
     * once), and the promised day is fixed so cases.json does not change with the date.
     */
    private fun make(
        name: String,
        settings: Map<String, Any?>,
        customers: List<Map<String, Any?>> = emptyList(),
        refusedByForm: Boolean = false,
        fromSale: SaleDraft? = null,
        fill: (NewOrderDraft, Settings, List<Customer>) -> Unit,
    ): ContractCase {
        val shop = decode<Settings>("global", settings)
        val book: List<Customer> = customers.map { decode<Customer>(it["id"] as? String ?: "", it) }
        var d = NewOrderDraft.fresh()
        if (fromSale != null) {
            // "Create order" on the sale: the draft the New order screen opens on is what the phone stored.
            val kept = NewOrderDraftStore.startFromSale(fromSale)
            val started = kept?.let { NewOrderDraftStore.decode(it) } ?: error("order case '$name': nothing was stored from the sale")
            expect(started.fromSale, name, "the draft is not marked as from the sale")
            d = started
        }
        d.seedRates(shop)
        d.promised = "2026-10-22"
        fill(d, shop, book)

        // A case is something the screen can send, except the one that says it is not.
        val refusal = NewOrderMath.problem(d)
        if (refusedByForm) {
            expect(refusal != null, name, "should be refused by the form")
        } else {
            expect(refusal == null, name, "the form would refuse it: ${refusal ?: ""}")
        }

        val totals = NewOrderMath.totals(d, shop)
        val send = NewOrderMath.request(d, shop, NewOrderMath.people(book))
        expect(ERPDecode.isValidJsonObject(send), name, "the request is not JSON")
        val draft = d.webValues(shop)
        expect(ERPDecode.isValidJsonObject(draft), name, "the draft is not JSON")
        return ContractCase(
            name = name, house = erp.core.entry.EntryHouse.id, send = send,
            shown = mapOf("subtotal" to totals.subtotal, "discount" to totals.discount, "grandTotal" to totals.balance),
            settings = settings, customers = customers, draft = draft,
        )
    }

    private fun expect(ok: Boolean, name: String, what: String) {
        if (!ok) error("order case '$name': $what")
    }

    /** A new piece as "Add a piece" makes it (the house's metal, 21k, 10% wastage, stones ticked), then filled in. */
    private fun add(d: NewOrderDraft, desc: String, fill: (NewOrderPieceDraft) -> Unit) {
        val p = NewOrderPieceDraft()
        p.description = desc
        fill(p)
        d.pieces.add(p)
    }

    private fun gold(p: NewOrderPieceDraft, karat: String, weight: String, wastage: String = "10", making: String = "") {
        p.setMetal("gold")
        p.karat = karat
        p.weight = weight
        p.wastage = wastage
        p.making = making
    }

    /** A line of the sale: a piece as the sale holds it (a stock piece, or one described for the bill). */
    private fun line(sku: String, name: String, metal: String, fill: (SaleLine) -> Unit): SaleLine {
        val l = SaleLine.blankFor(metal, sku)
        l.name = name
        fill(l)
        return l
    }

    // What was sent, read back.
    @Suppress("UNCHECKED_CAST")
    private fun sent(c: ContractCase): Map<String, Any?> = c.send["order"] as? Map<String, Any?> ?: emptyMap()

    @Suppress("UNCHECKED_CAST")
    private fun sentItems(c: ContractCase): List<Map<String, Any?>> = sent(c)["items"] as? List<Map<String, Any?>> ?: emptyList()
    private fun close(a: Double?, b: Double): Boolean = abs((a ?: Double.NaN) - b) < 0.005

    // Taheri

    fun taheri(): List<ContractCase> {
        val cases = ArrayList<ContractCase>()

        cases.add(
            make("21k by percentage, stones weighed out of the metal", settings = taheriSettings) { d, _, _ ->
                d.customerName = "Test Buyer"
                add(d, "Test solitaire ring") { p ->
                    p.category = "cat001"
                    gold(p, "21k", weight = "8.25", wastage = "12.5", making = "4800")
                    p.stoneWeight = "0.35"
                    p.stones = "1250.75"
                }
            },
        )

        run {
            var grams = 0.0
            val c = make("wastage typed in grams", settings = taheriSettings) { d, _, _ ->
                add(d, "Test heavy bangle") { p ->
                    p.category = "cat007"
                    gold(p, "22k", weight = "12.4", making = "6500")
                    p.stoneWeight = "0.8"
                    // The karigar writes 1.150 g; the form keeps the percentage that prices exactly that.
                    p.wastage = NewOrderMath.wastageText(grams = "1.15", weight = p.weightValue, stoneWeight = p.stoneWeightValue)
                    grams = wastageGramsFor(NewOrderFormat.num(p.wastage), p.weightValue, p.stoneWeightValue)
                }
            }
            expect(abs(grams - 1.15) < 0.000_001, c.name, "the grams did not come back: $grams")
            cases.add(c)
        }

        run {
            val c = make("22k, 18k and 24k in one order, one rate typed here", settings = taheriSettings) { d, _, _ ->
                d.customerName = "Test Mixed"
                add(d, "Test 22k bangle") { p -> gold(p, "22k", weight = "21.6", wastage = "8", making = "9000") }
                add(d, "Test 18k pendant") { p -> gold(p, "18k", weight = "3.9", wastage = "15", making = "3500") }
                add(d, "Test 24k chain") { p -> gold(p, "24k", weight = "11.664", wastage = "3") }
                // A rate typed for this order only; the others stay today's.
                d.rates["goldRatePerGram18k"] = "31,250.55"
            }
            @Suppress("UNCHECKED_CAST")
            val rates = sent(c)["ratesApplied"] as? Map<String, Any?> ?: emptyMap()
            expect(close(rates["goldRatePerGram18k"] as? Double, 31250.55), c.name, "the typed 18k rate was not sent")
            expect(close(rates["goldRatePerGram22k"] as? Double, 37812.25), c.name, "22k is not today's")
            cases.add(c)
        }

        cases.add(
            make("4.375 g with decimals, and a 5 mg piece", settings = taheriSettings) { d, _, _ ->
                add(d, "Test fine ring") { p ->
                    gold(p, "21k", weight = "4.375", wastage = "7.5", making = "2375.5")
                    p.stoneWeight = "0.125"
                    p.stones = "333.33"
                }
                add(d, "Test grain") { p -> gold(p, "22k", weight = "0.005", wastage = "10", making = "0.5") }
            },
        )

        cases.add(
            make("a fixed-price piece with its weight left in", settings = taheriSettings) { d, _, _ ->
                add(d, "Test agreed necklace") { p ->
                    gold(p, "21k", weight = "9")
                    p.manual = true
                    p.manualPrice = "185,000.50"
                }
                add(d, "Test weighed ring") { p -> gold(p, "21k", weight = "5.5", making = "3000") }
            },
        )

        cases.add(
            make("a piece with 0 weight (the form refuses to save it; the live total still agrees)", settings = taheriSettings, refusedByForm = true) { d, _, _ ->
                add(d, "Test not yet weighed") { p -> gold(p, "21k", weight = "", wastage = "10", making = "5000") }
                add(d, "Test weighed ring") { p -> gold(p, "21k", weight = "3.2", making = "2000") }
            },
        )

        run {
            val c = make("stones and diamonds ticked", settings = taheriSettings) { d, _, _ ->
                add(d, "Test ruby and diamond ring") { p ->
                    p.category = "cat001"
                    gold(p, "22k", weight = "10.2", making = "7500")
                    p.hasStones = true
                    p.stoneWeight = "1.2"
                    p.stones = "12000"
                    p.stoneDetails = "1 x test ruby"
                    p.hasDiamonds = true
                    p.diamond = "85000"
                    p.diamondDetails = "6 x test diamond"
                }
            }
            val it = sentItems(c)[0]
            expect(close(it["diamondCharges"] as? Double, 85000.0) && close(it["stoneWeightG"] as? Double, 1.2), c.name, "ticked boxes were not sent")
            cases.add(c)
        }

        run {
            val c = make("stones and diamonds unticked with values left in them", settings = taheriSettings) { d, _, _ ->
                add(d, "Test plain ring") { p ->
                    gold(p, "21k", weight = "7.7", making = "3300")
                    p.stoneWeight = "2.5"
                    p.stoneDetails = "left in"
                    p.diamond = "99999"
                    p.diamondDetails = "left in"
                    p.hasStones = false
                    p.hasDiamonds = false
                }
                // The same left-over diamond on silver, whose all-in rate adds a diamond charge whatever the box says.
                add(d, "Test silver ring") { p ->
                    p.setMetal("silver")
                    p.weight = "9.5"
                    p.diamond = "15000"
                    p.hasDiamonds = false
                }
            }
            for (it in sentItems(c)) {
                expect(close(it["diamondCharges"] as? Double, 0.0), c.name, "an unticked diamond charge was sent")
                expect(close(it["stoneWeightG"] as? Double, 0.0), c.name, "an unticked stone weight was sent")
                expect(!it.containsKey("stoneDetails") && !it.containsKey("diamondDetails"), c.name, "unticked details were sent")
            }
            cases.add(c)
        }

        run {
            val c = make("a discount larger than the subtotal", settings = taheriSettings) { d, _, _ ->
                add(d, "Test small ring") { p -> gold(p, "21k", weight = "2.1", making = "1500") }
                d.discount = "99,999,999"
            }
            expect(close(c.shown["discount"], c.shown["subtotal"] ?: -1.0) && close(c.shown["grandTotal"], 0.0), c.name, "the discount was not held to the subtotal")
            cases.add(c)
        }

        run {
            val c = make("advance plus two exchange rows", settings = taheriSettings) { d, _, _ ->
                d.customerName = "Test Exchanger"
                d.customerPhone = "0333 5550123"
                add(d, "Test bridal set") { p -> gold(p, "21k", weight = "15.5", wastage = "11", making = "14000") }
                d.advance = "150000"
                d.advanceMethod = "Bank Transfer"
                // Old chain: grams × rate fills the amount (22k, 11.2 g at 36,000).
                val first = d.exchanges[0].id
                d.patchExchange(first, ExchangeRowPatch(description = "Old chain"))
                d.patchExchange(first, ExchangeRowPatch(karat = "22k"))
                d.patchExchange(first, ExchangeRowPatch(weightG = "11.2"))
                d.patchExchange(first, ExchangeRowPatch(ratePerGram = "36000"))
                // Broken bangle: an amount typed over nothing.
                d.exchanges.add(erp.core.entry.NewOrderExchangeDraft.blank())
                val second = d.exchanges[1].id
                d.patchExchange(second, ExchangeRowPatch(description = "Broken bangle"))
                d.patchExchange(second, ExchangeRowPatch(value = "45500.5"))
            }
            val o = sent(c)
            expect((o["exchanges"] as? List<*>)?.size == 2, c.name, "two exchange rows were not sent")
            expect(close(o["advanceInExchangeValue"] as? Double, 403_200.0 + 45_500.5), c.name, "the exchange total is wrong")
            expect((o["advanceMethod"] as? String) == "Bank Transfer", c.name, "the advance method was not sent")
            cases.add(c)
        }

        run {
            val c = make("advance and exchange more than the pieces come to", settings = taheriSettings) { d, _, _ ->
                add(d, "Test small pendant") { p -> gold(p, "18k", weight = "1.8", making = "900") }
                d.advance = "500000"
                d.advanceMethod = "Cash"
                d.patchExchange(d.exchanges[0].id, ExchangeRowPatch(description = "Old ring"))
                d.patchExchange(d.exchanges[0].id, ExchangeRowPatch(value = "20000"))
            }
            expect((c.shown["grandTotal"] ?: 0.0) < 0, c.name, "the balance should be below zero")
            cases.add(c)
        }

        run {
            val c = make("a walk-in", settings = taheriSettings) { d, _, _ ->
                // The counter leaves the name alone, or types the placeholder back (an edited walk-in does).
                d.customerName = "Walk-in Customer"
                add(d, "Test counter ring") { p -> gold(p, "21k", weight = "4.4", making = "2000") }
            }
            val o = sent(c)
            expect(!o.containsKey("customerId") && !o.containsKey("customerName") && !o.containsKey("customerContact"), c.name, "a walk-in sent a customer")
            cases.add(c)
        }

        run {
            val c = make("a new customer by name and number", settings = taheriSettings, customers = listOf(omar)) { d, _, _ ->
                d.typeCustomerName("Zarmeena Testani")
                d.customerPhone = "0312 5550101"
                d.source = "social_media"
                add(d, "Test new-customer ring") { p -> gold(p, "21k", weight = "6.05", making = "2500") }
            }
            val o = sent(c)
            expect(
                !o.containsKey("customerId") && (o["customerName"] as? String) == "Zarmeena Testani" &&
                    (o["customerContact"] as? String) == "+923125550101",
                c.name, "the new customer was not sent, with the number as the ERP keeps it",
            )
            cases.add(c)
        }

        run {
            var offered: List<String> = emptyList()
            val c = make("an existing customer chosen", settings = taheriSettings, customers = listOf(hina, omar)) { d, _, book ->
                val chosen = book.firstOrNull { it.id == "cust-test-0001" } ?: error("no customer")
                d.choose(chosen)
                add(d, "Test repeat ring") { p ->
                    p.category = "cat001"
                    p.size = "11"
                    gold(p, "21k", weight = "5.25", making = "2800")
                }
                add(d, "Test repeat bangle") { p ->
                    p.category = "cat007"
                    p.size = "2.4"
                    gold(p, "22k", weight = "14.5", making = "5200")
                }
                // The profile says ring 10 and holds no bangle size: both are offered once the order is saved.
                offered = NewOrderSizes.offer(d, customerId = chosen.id, profile = chosen, houseWants = true)
                    .map { "${it.field.rawValue}=${it.value}" }
                expect(
                    NewOrderSizes.offer(d, customerId = chosen.id, profile = chosen, houseWants = false).isEmpty(),
                    "an existing customer chosen", "a house that keeps no sizes was offered some",
                )
            }
            val o = sent(c)
            expect((o["customerId"] as? String) == "cust-test-0001" && (o["source"] as? String) == "referral", c.name, "the chosen customer was not sent")
            expect(offered == listOf("ringSize=11", "bangleSize=2.4"), c.name, "the sizes on offer are wrong: $offered")
            cases.add(c)
        }

        run {
            val c = make("a number already on file, typed instead of chosen", settings = taheriSettings, customers = listOf(hina, omar)) { d, _, _ ->
                d.customerPhone = "0300-5550142"
                add(d, "Test typed-number ring") { p -> gold(p, "21k", weight = "5.25", making = "2800") }
            }
            expect((sent(c)["customerId"] as? String) == "cust-test-0001", c.name, "the number on file was not linked")
            cases.add(c)
        }

        run {
            val c = make("ten pieces", settings = taheriSettings) { d, _, _ ->
                add(d, "Test piece 1") { p -> gold(p, "21k", weight = "5.5", making = "3000") }
                // "Duplicate", nine times, then each is changed the way a counter would.
                for (n in 0 until 9) d.duplicatePiece(d.pieces[d.pieces.size - 1].id)
                val karats = listOf("18k", "21k", "22k", "24k")
                val wastages = listOf("8", "10", "12.5")
                for (i in d.pieces.indices) {
                    d.pieces[i].description = "Test piece ${i + 1}"
                    d.pieces[i].weight = NewOrderFormat.trimmed(2.5 + i.toDouble() * 1.375, digits = 3)
                    d.pieces[i].karat = karats[i % karats.size]
                    d.pieces[i].wastage = wastages[i % wastages.size]
                    d.pieces[i].making = (1000 + i * 350).toString()
                }
                d.discount = "12345.67"
            }
            expect(sentItems(c).size == 10, c.name, "ten pieces were not sent")
            cases.add(c)
        }

        run {
            val c = make("a piece over 1 crore", settings = taheriSettings) { d, _, _ ->
                add(d, "Test 24k bullion bar") { p -> gold(p, "24k", weight = "252.125", wastage = "2.5", making = "15000") }
                d.advance = "2500000"
                d.advanceMethod = "Bank Transfer"
            }
            expect((c.shown["subtotal"] ?: 0.0) > 10_000_000, c.name, "the piece is not over a crore")
            cases.add(c)
        }

        run {
            val c = make("palladium 18k and 12k with their own rates", settings = taheriSettings) { d, _, _ ->
                add(d, "Test palladium band") { p ->
                    p.setMetal("palladium")
                    p.karat = "18k"
                    p.weight = "6.2"
                    p.making = "2500"
                }
                add(d, "Test palladium ring") { p ->
                    p.setMetal("palladium")
                    p.karat = "12k"
                    p.weight = "4.05"
                    p.making = "2500"
                }
            }
            val karats = sentItems(c).map { it["karat"] as? String }
            expect(karats == listOf<String?>("18k", "12k"), c.name, "palladium lost its karat: $karats")
            cases.add(c)
        }

        run {
            val c = make("palladium with only the flat rate", settings = flatPalladiumSettings) { d, _, _ ->
                add(d, "Test flat palladium ring") { p ->
                    p.setMetal("palladium")
                    p.karat = "18k"
                    p.weight = "7.3"
                    p.making = "1800"
                }
            }
            cases.add(c)
        }

        run {
            val c = make("platinum and silver in a gold house", settings = taheriSettings) { d, _, _ ->
                add(d, "Test platinum band") { p ->
                    p.setMetal("platinum")
                    p.weight = "6.8"
                    p.wastage = "5"
                    p.making = "6000"
                }
                // A silver piece with the wastage and making of a gold one still typed into it.
                add(d, "Test silver bangle") { p ->
                    gold(p, "21k", weight = "42.5", wastage = "10", making = "1500")
                    p.setMetal("silver")
                }
            }
            val items = sentItems(c)
            expect(!items[0].containsKey("karat") && !items[1].containsKey("karat"), c.name, "platinum or silver was sent with a karat")
            expect(close(items[1]["makingCharges"] as? Double, 0.0), c.name, "silver's making was sent")
            cases.add(c)
        }

        run {
            val c = make("the 24K rate for our margin, a note for the karigar and a photo", settings = taheriSettings) { d, _, _ ->
                d.customerName = "Test Margin"
                add(d, "Test ring with a photo") { p ->
                    gold(p, "21k", weight = "8", making = "4000")
                    p.adminNote = "Set the stone low"
                    p.photo = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x01, 0x02, 0x03)
                }
                d.costTola = "479,500"
            }
            val o = sent(c)
            expect(close(o["costRate24k"] as? Double, 479_500 / 11.664), c.name, "the 24k rate was not sent per gram")
            expect((sentItems(c)[0]["adminNote"] as? String) == "Set the stone low", c.name, "the owner's note was not sent")
            expect((sentItems(c)[0]["sampleImageDataUri"] as? String)?.startsWith("data:image/jpeg;base64,") == true, c.name, "the photo was not sent")
            cases.add(c)
        }

        run {
            // Staff write the karigar's instructions and the 24k rate for the margin as owners do (decisions.md "Margin":
            // owners and staff, never the customer). The contract's route test signs in as an owner; what is held here
            // is that the order carries both whoever sends it.
            val c = make("staff: the 24K rate and the karigar's note go with the order", settings = taheriSettings, customers = listOf(omar)) { d, _, _ ->
                d.typeCustomerName("Test Staff Customer")
                add(d, "Test staff ring") { p ->
                    gold(p, "21k", weight = "8", making = "4000")
                    p.adminNote = "Set the stone low"
                }
                add(d, "Test staff bangle") { p ->
                    gold(p, "22k", weight = "20.5", wastage = "9", making = "8000")
                    p.adminNote = "Polish after setting"
                }
                d.costTola = "479500"
            }
            expect(close(sent(c)["costRate24k"] as? Double, 479_500 / 11.664), c.name, "the 24k rate was not sent")
            expect(sentItems(c).map { it["adminNote"] as? String } == listOf<String?>("Set the stone low", "Polish after setting"), c.name, "the notes were not sent")
            cases.add(c)
        }

        run {
            val c = make("everything the form can carry", settings = taheriSettings, customers = listOf(hina)) { d, _, book ->
                d.choose(book[0])
                // Started on the signed-in person, from the house's list; a name off the list is let go.
                d.settleTakenBy(person = "Test Clerk", list = listOf("Test Clerk", "Test Counter"))
                d.hideRates = true
                d.notes = "  Wanted for a wedding, call before Friday  "
                d.deliver = true
                d.deliveryAddress = "12 Test Lane, Sample Town"
                d.deliveryCity = "Karachi"
                d.deliveryName = "Test Receiver"
                d.deliveryPhone = "0300 5550000"
                d.deliveryCharge = "350"
                d.deliveryNotes = "Gate code 0000"
                d.deliveryExpected = "2026-10-20"
                add(d, "Test wedding ring") { p ->
                    p.category = "cat001"
                    gold(p, "21k", weight = "6.5", making = "3500")
                    p.size = "10.5"
                    p.referenceSku = "RIN-000000"
                    p.sampleGiven = true
                    p.karigarId = "karigar-test-1"
                }
                d.discount = "5000"
                d.advance = "25000"
                d.advanceMethod = ""
                // A name that is not on the house's list is not saved (the web refines it against TAKEN_BY).
                val probe = d.copy()
                probe.takenBy = "Someone Typed"
                expect(
                    NewOrderMath.problem(probe, takenBy = listOf("Test Clerk", "Test Counter")) == "Taken by: Choose a name from the list",
                    "everything the form can carry", "a name off the list was accepted",
                )
                expect(NewOrderMath.problem(d, takenBy = listOf("Test Clerk", "Test Counter")) == null, "everything the form can carry", "the person on the list was refused")
            }
            val o = sent(c)
            expect((o["takenBy"] as? String) == "Test Clerk", c.name, "Taken by did not start on the signed-in person")
            val stale = NewOrderDraft.fresh()
            stale.takenBy = "Someone Typed"
            stale.settleTakenBy(person = "Test Clerk", list = listOf("Test Clerk", "Test Counter"))
            expect(stale.takenBy == "Test Clerk", c.name, "a name off the list was kept")
            val quiet = NewOrderDraft.fresh()
            quiet.settleTakenBy(person = "Test Clerk", list = listOf("Test Clerk"))
            expect(quiet.isBlank, c.name, "a default Taken by made the order worth keeping")
            expect(!o.containsKey("advanceMethod"), c.name, "a method was sent for an advance that was not recorded")
            expect((o["notes"] as? String) == "Wanted for a wedding, call before Friday", c.name, "notes were not trimmed")
            expect((o["delivery"] as? Map<*, *>)?.get("charge") != null, c.name, "the delivery was not sent")
            cases.add(c)
        }

        run {
            // "Create order" on a sale of four pieces: a stock piece, a piece described for the bill at a fixed price (with
            // its weight kept), palladium 18k, and silver. The customer comes with them.
            val sale = SaleDraft()
            sale.customerId = "cust-test-0001"
            sale.customerName = "Hina Mockwell"
            sale.customerPhone = "+923005550142"
            sale.discount = "5000"
            sale.lines = mutableListOf(
                line("RIN-000321", "Test stock ring", metal = "gold") { l ->
                    l.categoryId = "cat001"
                    l.karat = "22k"
                    l.metalWeightG = 6.35
                    l.hasStones = true
                    l.stoneWeightG = 0.4
                    l.wastagePercentage = 9.0
                    l.makingCharges = 4200.0
                    l.stoneCharges = 1800.0
                    l.size = "11"
                },
                line("NEW-TEST01", "Test described pendant", metal = "gold") { l ->
                    l.karat = "21k"
                    l.metalWeightG = 5.5
                    l.isCustomPrice = true
                    l.customPrice = 96500.0
                },
                line("PAL-000044", "Test palladium band", metal = "palladium") { l ->
                    l.karat = "18k"
                    l.metalWeightG = 7.1
                    l.wastagePercentage = 6.0
                    l.makingCharges = 2000.0
                },
                line("BRA-000012", "Test silver cuff", metal = "silver") { l ->
                    l.metalWeightG = 28.5
                    l.wastagePercentage = 0.0
                    l.stoneCharges = 640.0
                },
            )
            val c = make("an order made from a sale", settings = taheriSettings, customers = listOf(hina), fromSale = sale) { d, _, _ ->
                // What the counter adds on the order form: an advance. The sale's discount and payments stay on the sale.
                d.advance = "40000"
                d.advanceMethod = "Cash"
            }
            val o = sent(c)
            val items = sentItems(c)
            expect(items.size == 4, c.name, "the sale's four pieces were not sent")
            expect((o["customerId"] as? String) == "cust-test-0001", c.name, "the sale's customer was not sent")
            expect((items[0]["referenceSku"] as? String) == "RIN-000321" && !items[1].containsKey("referenceSku"), c.name, "a stock number is the reference, a bill's own key is not")
            expect(
                (items[1]["isManualPrice"] as? Boolean) == true && close(items[1]["estimatedWeightG"] as? Double, 5.5) &&
                    close(items[1]["manualPrice"] as? Double, 96500.0),
                c.name, "the fixed price lost its weight",
            )
            expect((items[2]["karat"] as? String) == "18k" && !items[3].containsKey("karat"), c.name, "palladium lost its karat")
            expect(o["discountAmount"] as? Double == 0.0, c.name, "the sale's discount went with the pieces")
            cases.add(c)
        }

        return cases
    }

    // House of Mina

    fun mina(): List<ContractCase> {
        val cases = ArrayList<ContractCase>()

        run {
            val c = make("silver: wastage and making are in the all-in rate", settings = minaSettings) { d, _, _ ->
                add(d, "Test silver bangle") { p ->
                    p.weight = "37.5"
                    p.stones = "850"
                }
                // Typed as gold, then the metal changed: the wastage and the making stay in the boxes.
                add(d, "Test silver pendant") { p ->
                    gold(p, "21k", weight = "21.125", wastage = "18", making = "2500")
                    p.setMetal("silver")
                }
            }
            for (it in sentItems(c)) {
                expect(!it.containsKey("karat"), c.name, "silver was sent with a karat")
                expect(close(it["makingCharges"] as? Double, 0.0), c.name, "silver's making was sent")
            }
            cases.add(c)
        }

        run {
            val c = make("a gold piece in a silver house", settings = minaSettings) { d, _, _ ->
                add(d, "Test gold ring") { p ->
                    p.setMetal("gold")
                    p.weight = "6.75"
                    p.stoneWeight = "0.5"
                    p.making = "4200"
                }
                add(d, "Test silver chain") { p -> p.weight = "55.25" }
            }
            val items = sentItems(c)
            expect((items[0]["karat"] as? String) == "21k" && !items[1].containsKey("karat"), c.name, "karat is wrong: ${items.map { it["karat"] as? String ?: "-" }}")
            cases.add(c)
        }

        run {
            val c = make("plating on silver", settings = minaSettings) { d, _, _ ->
                add(d, "Test rose ring") { p ->
                    p.weight = "9.9"
                    p.platingType = "Other"
                    p.platingNote = "Rose gold"
                    p.nickelFree = true
                }
                add(d, "Test rhodium set") { p ->
                    p.weight = "31.4"
                    p.platingType = "White Rhodium"
                    p.platingNote = "left over from Other"
                }
                // Plated silver changed to gold: the plating goes with the metal.
                add(d, "Test changed piece") { p ->
                    p.weight = "5.5"
                    p.platingType = "21K Gold Plating"
                    p.nickelFree = true
                    gold(p, "22k", weight = "5.5", making = "1000")
                }
            }
            val items = sentItems(c)
            expect((items[0]["platingNote"] as? String) == "Rose gold" && (items[0]["nickelFree"] as? Boolean) == true, c.name, "plating was not sent")
            expect((items[1]["platingType"] as? String) == "White Rhodium" && !items[1].containsKey("platingNote"), c.name, "a note was sent for a named plating")
            expect(!items[2].containsKey("platingType") && !items[2].containsKey("nickelFree"), c.name, "plating was sent on gold")
            cases.add(c)
        }

        run {
            val c = make("silver with a discount and an advance", settings = minaSettings, customers = listOf(hina)) { d, _, book ->
                d.choose(book[0])
                add(d, "Test silver set") { p ->
                    p.weight = "120.5"
                    p.stones = "1200.25"
                }
                d.discount = "2500.5"
                d.advance = "30000"
                d.advanceMethod = "Card"
            }
            expect((sent(c)["advanceMethod"] as? String) == "Card", c.name, "the advance method was not sent")
            cases.add(c)
        }

        run {
            val c = make("silver diamonds ticked and unticked", settings = minaSettings) { d, _, _ ->
                add(d, "Test diamond silver ring") { p ->
                    p.weight = "7.2"
                    p.hasDiamonds = true
                    p.diamond = "18000"
                    p.diamondDetails = "3 x test diamond"
                }
                add(d, "Test plain silver ring") { p ->
                    p.weight = "7.2"
                    p.diamond = "18000"
                    p.hasDiamonds = false
                }
            }
            val items = sentItems(c)
            expect(close(items[0]["diamondCharges"] as? Double, 18000.0) && close(items[1]["diamondCharges"] as? Double, 0.0), c.name, "diamond charges are wrong")
            cases.add(c)
        }

        run {
            val sale = SaleDraft()
            sale.customerName = "Test Silver Buyer"
            sale.customerPhone = "0301 5550188"
            sale.lines = mutableListOf(
                line("BNG-000007", "Test silver bangle", metal = "silver") { l ->
                    l.categoryId = "cat007"
                    l.metalWeightG = 45.25
                    l.size = "2.4"
                    l.platingType = "White Rhodium"
                    l.nickelFree = true
                },
                line("NEW-TEST02", "Test gold stud", metal = "gold") { l ->
                    l.karat = "21k"
                    l.metalWeightG = 2.15
                    l.wastagePercentage = 10.0
                    l.makingCharges = 1500.0
                },
            )
            val c = make("an order made from a sale", settings = minaSettings, fromSale = sale) { _, _, _ -> }
            val items = sentItems(c)
            expect(items.size == 2 && !items[0].containsKey("karat") && (items[1]["karat"] as? String) == "21k", c.name, "the sale's pieces are wrong")
            expect((items[0]["platingType"] as? String) == "White Rhodium" && !items[1].containsKey("platingType"), c.name, "plating is wrong")
            expect(!sent(c).containsKey("customerId") && (sent(c)["customerName"] as? String) == "Test Silver Buyer", c.name, "the sale's typed customer was not sent")
            cases.add(c)
        }

        cases.add(
            make("a fixed-price silver piece with its weight left in", settings = minaSettings) { d, _, _ ->
                add(d, "Test agreed silver tray") { p ->
                    p.weight = "310"
                    p.manual = true
                    p.manualPrice = "64000"
                }
                add(d, "Test weighed silver spoon") { p -> p.weight = "0.375" }
            },
        )

        return cases
    }
}
