import Foundation
import ERPCore

// New order's contract cases: outliers, not happy paths. Each is a NewOrderDraft filled the way the form
// fills it (the same mutating helpers the controls call: setMetal, choose, patchExchange, duplicatePiece,
// wastageText, seedRates), then turned into `send` and `shown` by the same functions the screen calls:
// NewOrderMath.request (what NewOrder.save passes to ERPAPI.write("createOrder", …)) and
// NewOrderMath.totals (the figures the form displays). Nothing is worked out here.
//
// The ERP's test (src/app/api/app/write/contract.test.ts) holds `shown` and the pieces in `send` to the
// web form's own money (lib/order-estimate.ts) and saves each through the real route. Beyond that, a few
// things the test does not look at are checked here, and the run stops if one is wrong.
//
// All made up: names, numbers, rates.

enum OrderCases {
    // MARK: The shops' books (app_settings/global as Firestore holds it)

    /// Taheri: gold by karat, palladium by grade and flat, platinum, silver.
    static let taheriSettings: [String: Any] = [
        "shopName": "Test Jewellers", "shopAddress": "1 Test Street", "shopContact": "0300-0000000",
        "goldRatePerGram24k": 41250.5, "goldRatePerGram22k": 37812.25, "goldRatePerGram21k": 36090.75,
        "goldRatePerGram18k": 30937.5,
        "palladiumRatePerGram": 8125.4, "palladiumRatePerGram18k": 9310.15, "palladiumRatePerGram12k": 6205.35,
        "platinumRatePerGram": 11480, "silverRatePerGram": 312.5,
        "lastOrderNumber": 4177, "lastInvoiceNumber": 2210, "databaseLocked": false,
    ]

    /// A shop that has set only the flat palladium rate.
    static let flatPalladiumSettings: [String: Any] = [
        "shopName": "Test Jewellers", "shopAddress": "1 Test Street", "shopContact": "0300-0000000",
        "goldRatePerGram24k": 41250.5, "goldRatePerGram22k": 37812.25, "goldRatePerGram21k": 36090.75,
        "goldRatePerGram18k": 30937.5,
        "palladiumRatePerGram": 8125.4,
        "platinumRatePerGram": 11480, "silverRatePerGram": 312.5,
        "lastOrderNumber": 88, "lastInvoiceNumber": 40, "databaseLocked": false,
    ]

    /// House of Mina: silver is the shop's metal; gold is rarely asked for.
    static let minaSettings: [String: Any] = [
        "shopName": "Test Silver House", "shopAddress": "2 Sample Road", "shopContact": "0301-0000000",
        "goldRatePerGram24k": 40800.25, "goldRatePerGram22k": 37400, "goldRatePerGram21k": 35650.5,
        "goldRatePerGram18k": 30600.75,
        "palladiumRatePerGram": 7900, "platinumRatePerGram": 11200, "silverRatePerGram": 297.75,
        "lastOrderNumber": 912, "lastInvoiceNumber": 655, "databaseLocked": false,
    ]

    static let hina: [String: Any] = [
        "id": "cust-test-0001", "name": "Hina Mockwell", "phone": "+923005550142",
        "source": "referral", "address": "12 Test Lane, Sample Town",
    ]
    static let omar: [String: Any] = [
        "id": "cust-test-0002", "name": "Omar Samplani", "phone": "+923215550177",
    ]

    // MARK: Building a case

    /// Makes one case. `fill` does what the person does on the form; the rates start as today's (the form
    /// seeds them once), and the promised day is fixed so cases.json does not change with the date.
    private static func make(
        _ name: String,
        settings: [String: Any],
        customers: [[String: Any]] = [],
        owner: Bool = true,
        refusedByForm: Bool = false,
        _ fill: (inout NewOrderDraft, Settings, [Customer]) -> Void
    ) -> ContractCase {
        let shop: Settings = decode(Settings.self, "global", settings)
        let book: [Customer] = customers.map { decode(Customer.self, $0["id"] as? String ?? "", $0) }
        var d = NewOrderDraft.fresh()
        d.seedRates(from: shop)
        d.promised = "2026-10-22"
        fill(&d, shop, book)

        // A case is something the screen can send, except the one that says it is not.
        let refusal = NewOrderMath.problem(d)
        if refusedByForm {
            expect(refusal != nil, name, "should be refused by the form")
        } else {
            expect(refusal == nil, name, "the form would refuse it: \(refusal ?? "")")
        }

        let totals = NewOrderMath.totals(d, shop)
        let send = NewOrderMath.request(d, settings: shop, customers: NewOrderMath.people(book), owner: owner)
        expect(JSONSerialization.isValidJSONObject(send), name, "the request is not JSON")
        return ContractCase(
            name: name, house: House.id, send: send,
            shown: ["subtotal": totals.subtotal, "discount": totals.discount, "grandTotal": totals.balance],
            settings: settings, customers: customers
        )
    }

    private static func expect(_ ok: Bool, _ name: String, _ what: String) {
        if !ok { fatalError("order case '\(name)': \(what)") }
    }

    /// A new piece as "Add a piece" makes it (the house's metal, 21k, 10% wastage, stones ticked), then filled in.
    private static func add(_ d: inout NewOrderDraft, _ desc: String, _ fill: (inout NewOrderPieceDraft) -> Void) {
        var p = NewOrderPieceDraft()
        p.description = desc
        fill(&p)
        d.pieces.append(p)
    }

    private static func gold(_ p: inout NewOrderPieceDraft, _ karat: String, weight: String, wastage: String = "10", making: String = "") {
        p.setMetal("gold")
        p.karat = karat
        p.weight = weight
        p.wastage = wastage
        p.making = making
    }

    // What was sent, read back.
    private static func sent(_ c: ContractCase) -> [String: Any] { c.send["order"] as? [String: Any] ?? [:] }
    private static func sentItems(_ c: ContractCase) -> [[String: Any]] { sent(c)["items"] as? [[String: Any]] ?? [] }
    private static func close(_ a: Double?, _ b: Double) -> Bool { abs((a ?? .nan) - b) < 0.005 }

    // MARK: Taheri

    static func taheri() -> [ContractCase] {
        var cases: [ContractCase] = []

        cases.append(make("21k by percentage, stones weighed out of the metal", settings: taheriSettings) { d, _, _ in
            d.customerName = "Test Buyer"
            add(&d, "Test solitaire ring") { p in
                p.category = "cat001"
                gold(&p, "21k", weight: "8.25", wastage: "12.5", making: "4800")
                p.stoneWeight = "0.35"
                p.stones = "1250.75"
            }
        })

        do {
            var grams = 0.0
            let c = make("wastage typed in grams", settings: taheriSettings) { d, _, _ in
                add(&d, "Test heavy bangle") { p in
                    p.category = "cat007"
                    gold(&p, "22k", weight: "12.4", making: "6500")
                    p.stoneWeight = "0.8"
                    // The karigar writes 1.150 g; the form keeps the percentage that prices exactly that.
                    p.wastage = NewOrderMath.wastageText(grams: "1.15", weight: p.weightValue, stoneWeight: p.stoneWeightValue)
                    grams = wastageGramsFor(NewOrderFormat.num(p.wastage), p.weightValue, p.stoneWeightValue)
                }
            }
            expect(abs(grams - 1.15) < 0.000_001, c.name, "the grams did not come back: \(grams)")
            cases.append(c)
        }

        do {
            let c = make("22k, 18k and 24k in one order, one rate typed here", settings: taheriSettings) { d, _, _ in
                d.customerName = "Test Mixed"
                add(&d, "Test 22k bangle") { p in gold(&p, "22k", weight: "21.6", wastage: "8", making: "9000") }
                add(&d, "Test 18k pendant") { p in gold(&p, "18k", weight: "3.9", wastage: "15", making: "3500") }
                add(&d, "Test 24k chain") { p in gold(&p, "24k", weight: "11.664", wastage: "3") }
                // A rate typed for this order only; the others stay today's.
                d.rates["goldRatePerGram18k"] = "31,250.55"
            }
            let rates = sent(c)["ratesApplied"] as? [String: Any] ?? [:]
            expect(close(rates["goldRatePerGram18k"] as? Double, 31250.55), c.name, "the typed 18k rate was not sent")
            expect(close(rates["goldRatePerGram22k"] as? Double, 37812.25), c.name, "22k is not today's")
            cases.append(c)
        }

        cases.append(make("4.375 g with decimals, and a 5 mg piece", settings: taheriSettings) { d, _, _ in
            add(&d, "Test fine ring") { p in
                gold(&p, "21k", weight: "4.375", wastage: "7.5", making: "2375.5")
                p.stoneWeight = "0.125"
                p.stones = "333.33"
            }
            add(&d, "Test grain") { p in gold(&p, "22k", weight: "0.005", wastage: "10", making: "0.5") }
        })

        cases.append(make("a fixed-price piece with its weight left in", settings: taheriSettings) { d, _, _ in
            add(&d, "Test agreed necklace") { p in
                gold(&p, "21k", weight: "9")
                p.manual = true
                p.manualPrice = "185,000.50"
            }
            add(&d, "Test weighed ring") { p in gold(&p, "21k", weight: "5.5", making: "3000") }
        })

        cases.append(make("a piece with 0 weight (the form refuses to save it; the live total still agrees)", settings: taheriSettings, refusedByForm: true) { d, _, _ in
            add(&d, "Test not yet weighed") { p in gold(&p, "21k", weight: "", wastage: "10", making: "5000") }
            add(&d, "Test weighed ring") { p in gold(&p, "21k", weight: "3.2", making: "2000") }
        })

        do {
            let c = make("stones and diamonds ticked", settings: taheriSettings) { d, _, _ in
                add(&d, "Test ruby and diamond ring") { p in
                    p.category = "cat001"
                    gold(&p, "22k", weight: "10.2", making: "7500")
                    p.hasStones = true
                    p.stoneWeight = "1.2"
                    p.stones = "12000"
                    p.stoneDetails = "1 x test ruby"
                    p.hasDiamonds = true
                    p.diamond = "85000"
                    p.diamondDetails = "6 x test diamond"
                }
            }
            let it = sentItems(c)[0]
            expect(close(it["diamondCharges"] as? Double, 85000) && close(it["stoneWeightG"] as? Double, 1.2), c.name, "ticked boxes were not sent")
            cases.append(c)
        }

        do {
            let c = make("stones and diamonds unticked with values left in them", settings: taheriSettings) { d, _, _ in
                add(&d, "Test plain ring") { p in
                    gold(&p, "21k", weight: "7.7", making: "3300")
                    p.stoneWeight = "2.5"
                    p.stoneDetails = "left in"
                    p.diamond = "99999"
                    p.diamondDetails = "left in"
                    p.hasStones = false
                    p.hasDiamonds = false
                }
                // The same left-over diamond on silver, whose all-in rate adds a diamond charge whatever the box says.
                add(&d, "Test silver ring") { p in
                    p.setMetal("silver")
                    p.weight = "9.5"
                    p.diamond = "15000"
                    p.hasDiamonds = false
                }
            }
            for it in sentItems(c) {
                expect(close(it["diamondCharges"] as? Double, 0), c.name, "an unticked diamond charge was sent")
                expect(close(it["stoneWeightG"] as? Double, 0), c.name, "an unticked stone weight was sent")
                expect(it["stoneDetails"] == nil && it["diamondDetails"] == nil, c.name, "unticked details were sent")
            }
            cases.append(c)
        }

        do {
            let c = make("a discount larger than the subtotal", settings: taheriSettings) { d, _, _ in
                add(&d, "Test small ring") { p in gold(&p, "21k", weight: "2.1", making: "1500") }
                d.discount = "99,999,999"
            }
            expect(close(c.shown["discount"], c.shown["subtotal"] ?? -1) && close(c.shown["grandTotal"], 0), c.name, "the discount was not held to the subtotal")
            cases.append(c)
        }

        do {
            let c = make("advance plus two exchange rows", settings: taheriSettings) { d, _, _ in
                d.customerName = "Test Exchanger"
                d.customerPhone = "0333 5550123"
                add(&d, "Test bridal set") { p in gold(&p, "21k", weight: "15.5", wastage: "11", making: "14000") }
                d.advance = "150000"
                d.advanceMethod = "Bank Transfer"
                // Old chain: grams × rate fills the amount (22k, 11.2 g at 36,000).
                let first = d.exchanges[0].id
                d.patchExchange(first, ExchangeRowPatch(description: "Old chain"))
                d.patchExchange(first, ExchangeRowPatch(karat: "22k"))
                d.patchExchange(first, ExchangeRowPatch(weightG: "11.2"))
                d.patchExchange(first, ExchangeRowPatch(ratePerGram: "36000"))
                // Broken bangle: an amount typed over nothing.
                d.exchanges.append(.blank())
                let second = d.exchanges[1].id
                d.patchExchange(second, ExchangeRowPatch(description: "Broken bangle"))
                d.patchExchange(second, ExchangeRowPatch(value: "45500.5"))
            }
            let o = sent(c)
            expect((o["exchanges"] as? [[String: Any]])?.count == 2, c.name, "two exchange rows were not sent")
            expect(close(o["advanceInExchangeValue"] as? Double, 403_200 + 45_500.5), c.name, "the exchange total is wrong")
            expect((o["advanceMethod"] as? String) == "Bank Transfer", c.name, "the advance method was not sent")
            cases.append(c)
        }

        do {
            let c = make("advance and exchange more than the pieces come to", settings: taheriSettings) { d, _, _ in
                add(&d, "Test small pendant") { p in gold(&p, "18k", weight: "1.8", making: "900") }
                d.advance = "500000"
                d.advanceMethod = "Cash"
                d.patchExchange(d.exchanges[0].id, ExchangeRowPatch(description: "Old ring"))
                d.patchExchange(d.exchanges[0].id, ExchangeRowPatch(value: "20000"))
            }
            expect((c.shown["grandTotal"] ?? 0) < 0, c.name, "the balance should be below zero")
            cases.append(c)
        }

        do {
            let c = make("a walk-in", settings: taheriSettings) { d, _, _ in
                // The counter leaves the name alone, or types the placeholder back (an edited walk-in does).
                d.customerName = "Walk-in Customer"
                add(&d, "Test counter ring") { p in gold(&p, "21k", weight: "4.4", making: "2000") }
            }
            let o = sent(c)
            expect(o["customerId"] == nil && o["customerName"] == nil && o["customerContact"] == nil, c.name, "a walk-in sent a customer")
            cases.append(c)
        }

        do {
            let c = make("a new customer by name and number", settings: taheriSettings, customers: [omar]) { d, _, book in
                d.typeCustomerName("Zarmeena Testani")
                d.customerPhone = "0312 5550101"
                d.source = "social_media"
                add(&d, "Test new-customer ring") { p in gold(&p, "21k", weight: "6.05", making: "2500") }
                _ = book
            }
            let o = sent(c)
            expect(o["customerId"] == nil && (o["customerName"] as? String) == "Zarmeena Testani"
                   && (o["customerContact"] as? String) == "0312 5550101", c.name, "the new customer was not sent as typed")
            cases.append(c)
        }

        do {
            let c = make("an existing customer chosen", settings: taheriSettings, customers: [hina, omar]) { d, _, book in
                guard let chosen = book.first(where: { $0.id == "cust-test-0001" }) else { fatalError("no customer") }
                d.choose(chosen)
                add(&d, "Test repeat ring") { p in gold(&p, "21k", weight: "5.25", making: "2800") }
            }
            let o = sent(c)
            expect((o["customerId"] as? String) == "cust-test-0001" && (o["source"] as? String) == "referral", c.name, "the chosen customer was not sent")
            cases.append(c)
        }

        do {
            let c = make("a number already on file, typed instead of chosen", settings: taheriSettings, customers: [hina, omar]) { d, _, _ in
                d.customerPhone = "0300-5550142"
                add(&d, "Test typed-number ring") { p in gold(&p, "21k", weight: "5.25", making: "2800") }
            }
            expect((sent(c)["customerId"] as? String) == "cust-test-0001", c.name, "the number on file was not linked")
            cases.append(c)
        }

        do {
            let c = make("ten pieces", settings: taheriSettings) { d, _, _ in
                add(&d, "Test piece 1") { p in gold(&p, "21k", weight: "5.5", making: "3000") }
                // "Duplicate", nine times, then each is changed the way a counter would.
                for _ in 0..<9 { d.duplicatePiece(d.pieces[d.pieces.count - 1].id) }
                let karats = ["18k", "21k", "22k", "24k"]
                let wastages = ["8", "10", "12.5"]
                for i in d.pieces.indices {
                    d.pieces[i].description = "Test piece \(i + 1)"
                    d.pieces[i].weight = NewOrderFormat.trimmed(2.5 + Double(i) * 1.375, digits: 3)
                    d.pieces[i].karat = karats[i % karats.count]
                    d.pieces[i].wastage = wastages[i % wastages.count]
                    d.pieces[i].making = String(1000 + i * 350)
                }
                d.discount = "12345.67"
            }
            expect(sentItems(c).count == 10, c.name, "ten pieces were not sent")
            cases.append(c)
        }

        do {
            let c = make("a piece over 1 crore", settings: taheriSettings) { d, _, _ in
                add(&d, "Test 24k bullion bar") { p in gold(&p, "24k", weight: "252.125", wastage: "2.5", making: "15000") }
                d.advance = "2500000"
                d.advanceMethod = "Bank Transfer"
            }
            expect((c.shown["subtotal"] ?? 0) > 10_000_000, c.name, "the piece is not over a crore")
            cases.append(c)
        }

        do {
            let c = make("palladium 18k and 12k with their own rates", settings: taheriSettings) { d, _, _ in
                add(&d, "Test palladium band") { p in
                    p.setMetal("palladium")
                    p.karat = "18k"
                    p.weight = "6.2"
                    p.making = "2500"
                }
                add(&d, "Test palladium ring") { p in
                    p.setMetal("palladium")
                    p.karat = "12k"
                    p.weight = "4.05"
                    p.making = "2500"
                }
            }
            let karats = sentItems(c).map { $0["karat"] as? String }
            expect(karats == ["18k", "12k"], c.name, "palladium lost its karat: \(karats)")
            cases.append(c)
        }

        do {
            let c = make("palladium with only the flat rate", settings: flatPalladiumSettings) { d, _, _ in
                add(&d, "Test flat palladium ring") { p in
                    p.setMetal("palladium")
                    p.karat = "18k"
                    p.weight = "7.3"
                    p.making = "1800"
                }
            }
            cases.append(c)
        }

        do {
            let c = make("platinum and silver in a gold house", settings: taheriSettings) { d, _, _ in
                add(&d, "Test platinum band") { p in
                    p.setMetal("platinum")
                    p.weight = "6.8"
                    p.wastage = "5"
                    p.making = "6000"
                }
                // A silver piece with the wastage and making of a gold one still typed into it.
                add(&d, "Test silver bangle") { p in
                    gold(&p, "21k", weight: "42.5", wastage: "10", making: "1500")
                    p.setMetal("silver")
                }
            }
            let items = sentItems(c)
            expect(items[0]["karat"] == nil && items[1]["karat"] == nil, c.name, "platinum or silver was sent with a karat")
            expect(close(items[1]["makingCharges"] as? Double, 0), c.name, "silver's making was sent")
            cases.append(c)
        }

        do {
            let c = make("owner: the 24K rate for our margin, a note for the karigar and a photo", settings: taheriSettings) { d, _, _ in
                d.customerName = "Test Margin"
                add(&d, "Test ring with a photo") { p in
                    gold(&p, "21k", weight: "8", making: "4000")
                    p.adminNote = "Set the stone low"
                    p.photo = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x01, 0x02, 0x03])
                }
                d.costTola = "479,500"
            }
            let o = sent(c)
            expect(close(o["costRate24k"] as? Double, 479_500 / 11.664), c.name, "the 24k rate was not sent per gram")
            expect((sentItems(c)[0]["adminNote"] as? String) == "Set the stone low", c.name, "the owner's note was not sent")
            expect((sentItems(c)[0]["sampleImageDataUri"] as? String)?.hasPrefix("data:image/jpeg;base64,") == true, c.name, "the photo was not sent")
            cases.append(c)
        }

        do {
            // A phone that was an owner's a moment ago: the draft still holds the owner's 24k rate and note.
            let c = make("staff: a 24K rate and a note left in the draft are not sent", settings: taheriSettings, owner: false) { d, _, _ in
                d.customerName = "Test Margin"
                add(&d, "Test ring with a photo") { p in
                    gold(&p, "21k", weight: "8", making: "4000")
                    p.adminNote = "Set the stone low"
                }
                d.costTola = "479500"
            }
            expect(sent(c)["costRate24k"] == nil, c.name, "staff sent the 24k rate")
            expect(sentItems(c)[0]["adminNote"] == nil, c.name, "staff sent the owner's note")
            cases.append(c)
        }

        do {
            let c = make("everything the form can carry", settings: taheriSettings, customers: [hina]) { d, _, book in
                d.choose(book[0])
                d.takenBy = "Test Clerk"
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
                add(&d, "Test wedding ring") { p in
                    p.category = "cat001"
                    gold(&p, "21k", weight: "6.5", making: "3500")
                    p.size = "10.5"
                    p.referenceSku = "RIN-000000"
                    p.sampleGiven = true
                    p.karigarId = "karigar-test-1"
                }
                d.discount = "5000"
                d.advance = "25000"
                d.advanceMethod = ""
            }
            let o = sent(c)
            expect(o["advanceMethod"] == nil, c.name, "a method was sent for an advance that was not recorded")
            expect((o["notes"] as? String) == "Wanted for a wedding, call before Friday", c.name, "notes were not trimmed")
            expect((o["delivery"] as? [String: Any])?["charge"] != nil, c.name, "the delivery was not sent")
            cases.append(c)
        }

        return cases
    }

    // MARK: House of Mina

    static func mina() -> [ContractCase] {
        var cases: [ContractCase] = []

        do {
            let c = make("silver: wastage and making are in the all-in rate", settings: minaSettings) { d, _, _ in
                add(&d, "Test silver bangle") { p in
                    p.weight = "37.5"
                    p.stones = "850"
                }
                // Typed as gold, then the metal changed: the wastage and the making stay in the boxes.
                add(&d, "Test silver pendant") { p in
                    gold(&p, "21k", weight: "21.125", wastage: "18", making: "2500")
                    p.setMetal("silver")
                }
            }
            for it in sentItems(c) {
                expect(it["karat"] == nil, c.name, "silver was sent with a karat")
                expect(close(it["makingCharges"] as? Double, 0), c.name, "silver's making was sent")
            }
            cases.append(c)
        }

        do {
            let c = make("a gold piece in a silver house", settings: minaSettings) { d, _, _ in
                add(&d, "Test gold ring") { p in
                    p.setMetal("gold")
                    p.weight = "6.75"
                    p.stoneWeight = "0.5"
                    p.making = "4200"
                }
                add(&d, "Test silver chain") { p in p.weight = "55.25" }
            }
            let items = sentItems(c)
            expect((items[0]["karat"] as? String) == "21k" && items[1]["karat"] == nil, c.name, "karat is wrong: \(items.map { $0["karat"] as? String ?? "-" })")
            cases.append(c)
        }

        do {
            let c = make("plating on silver", settings: minaSettings) { d, _, _ in
                add(&d, "Test rose ring") { p in
                    p.weight = "9.9"
                    p.platingType = "Other"
                    p.platingNote = "Rose gold"
                    p.nickelFree = true
                }
                add(&d, "Test rhodium set") { p in
                    p.weight = "31.4"
                    p.platingType = "White Rhodium"
                    p.platingNote = "left over from Other"
                }
                // Plated silver changed to gold: the plating goes with the metal.
                add(&d, "Test changed piece") { p in
                    p.weight = "5.5"
                    p.platingType = "21K Gold Plating"
                    p.nickelFree = true
                    gold(&p, "22k", weight: "5.5", making: "1000")
                }
            }
            let items = sentItems(c)
            expect((items[0]["platingNote"] as? String) == "Rose gold" && (items[0]["nickelFree"] as? Bool) == true, c.name, "plating was not sent")
            expect((items[1]["platingType"] as? String) == "White Rhodium" && items[1]["platingNote"] == nil, c.name, "a note was sent for a named plating")
            expect(items[2]["platingType"] == nil && items[2]["nickelFree"] == nil, c.name, "plating was sent on gold")
            cases.append(c)
        }

        do {
            let c = make("silver with a discount and an advance", settings: minaSettings, customers: [hina]) { d, _, book in
                d.choose(book[0])
                add(&d, "Test silver set") { p in
                    p.weight = "120.5"
                    p.stones = "1200.25"
                }
                d.discount = "2500.5"
                d.advance = "30000"
                d.advanceMethod = "Card"
            }
            expect((sent(c)["advanceMethod"] as? String) == "Card", c.name, "the advance method was not sent")
            cases.append(c)
        }

        do {
            let c = make("silver diamonds ticked and unticked", settings: minaSettings) { d, _, _ in
                add(&d, "Test diamond silver ring") { p in
                    p.weight = "7.2"
                    p.hasDiamonds = true
                    p.diamond = "18000"
                    p.diamondDetails = "3 x test diamond"
                }
                add(&d, "Test plain silver ring") { p in
                    p.weight = "7.2"
                    p.diamond = "18000"
                    p.hasDiamonds = false
                }
            }
            let items = sentItems(c)
            expect(close(items[0]["diamondCharges"] as? Double, 18000) && close(items[1]["diamondCharges"] as? Double, 0), c.name, "diamond charges are wrong")
            cases.append(c)
        }

        cases.append(make("a fixed-price silver piece with its weight left in", settings: minaSettings) { d, _, _ in
            add(&d, "Test agreed silver tray") { p in
                p.weight = "310"
                p.manual = true
                p.manualPrice = "64000"
            }
            add(&d, "Test weighed silver spoon") { p in p.weight = "0.375" }
        })

        return cases
    }
}
