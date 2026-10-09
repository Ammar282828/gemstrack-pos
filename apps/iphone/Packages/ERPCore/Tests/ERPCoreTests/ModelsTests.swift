import XCTest
@testable import ERPCore

/// The models decode the ERP's Firestore documents as they really are: clean ones, and the
/// messy ones years of scripts and imports left behind. Every name, phone and amount here is
/// made up (the repository is public).
final class ModelsTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: Invoice

    func testInvoiceClean() throws {
        let inv = try decode(Invoice.self, """
        {"id":"INV-000101","customerId":"c-1","customerName":"Sana Example","customerContact":"+92 300 0000001",
         "items":[{"sku":"RIN-000001","name":"Plain band","categoryId":"cat001","metalType":"gold","karat":"21k",
                   "metalWeightG":5.2,"stoneWeightG":0,"quantity":1,"unitPrice":120000,"itemTotal":120000,
                   "metalCost":100000,"wastageCost":8000,"wastagePercentage":8,"makingCharges":12000,
                   "diamondChargesIfAny":0,"stoneChargesIfAny":0,"miscChargesIfAny":0,"size":"12"}],
         "subtotal":120000,"discountAmount":5000,"exchanges":[{"description":"Old ring","karat":"22k","weightG":3,"ratePerGram":20000,"value":60000}],
         "grandTotal":55000,"amountPaid":30000,"balanceDue":25000,"createdAt":"2026-10-01T08:30:00.000Z",
         "ratesApplied":{"goldRatePerGram21k":23000,"goldRatePerGram24k":26000},
         "hideRates":true,"takenBy":"Test Clerk",
         "paymentHistory":[{"amount":30000,"date":"2026-10-01T08:30:00.000Z","notes":"Payment received (Cash)","method":"Cash"}],
         "sentOnWhatsApp":{"at":"2026-10-01T09:00:00.000Z","to":"923000000001","by":"Test Clerk"},
         "acquisitionSource":"walkin","costRate24k":24500}
        """)
        XCTAssertEqual(inv.id, "INV-000101")
        XCTAssertEqual(inv.customerName, "Sana Example")
        XCTAssertEqual(inv.items.count, 1)
        XCTAssertEqual(inv.items[0].metalType, .gold)
        XCTAssertEqual(inv.items[0].karat, .k21)
        XCTAssertEqual(inv.items[0].unitPrice, 120_000)
        XCTAssertEqual(inv.items[0].size, "12")
        XCTAssertEqual(inv.exchanges.first?.value, 60_000)
        XCTAssertEqual(inv.exchanges.first?.karat, "22k")
        XCTAssertEqual(inv.grandTotal, 55_000)
        XCTAssertEqual(inv.balanceDue, 25_000)
        XCTAssertEqual(inv.ratesApplied.goldRatePerGram21k, 23_000)
        XCTAssertNil(inv.ratesApplied.silverRatePerGram)
        XCTAssertTrue(inv.hideRates)
        XCTAssertEqual(inv.paymentHistory.first?.method, .cash)
        XCTAssertEqual(inv.sentOnWhatsApp?.to, "923000000001")
        XCTAssertEqual(inv.acquisitionSource, .walkin)
        XCTAssertEqual(inv.costRate24k, 24_500)
        XCTAssertNil(inv.status)
    }

    func testInvoiceMessy() throws {
        // Items as a map (out of order), money as strings, an unknown status and method, no rates.
        let inv = try decode(Invoice.self, """
        {"id":"SHOPIFY-9001","customerName":"Bilal Sample",
         "items":{"1":{"sku":"B","name":"Second","metalType":"silver","unitPrice":"2,500","quantity":"1"},
                  "0":{"sku":"A","name":"First","metalType":"titanium","karat":"21K"}},
         "subtotal":"5000","grandTotal":"5,000","amountPaid":"0","balanceDue":"5000",
         "paymentHistory":{"0":{"amount":"1,000","date":"2026-09-30T10:00:00Z","method":"Easypaisa"}},
         "status":"Disputed","shopifyOrderNumber":"1042","shopifyTransactionIds":[777,"888"],
         "source":"shopify","hideRates":"yes"}
        """)
        XCTAssertEqual(inv.items.map(\.sku), ["A", "B"])
        XCTAssertEqual(inv.items[0].metalType, .unknown("titanium"))
        XCTAssertEqual(inv.items[0].karat, .unknown("21K"), "karat matching is exact, as the ERP compares")
        XCTAssertEqual(inv.items[1].metalType, .silver)
        XCTAssertEqual(inv.items[1].unitPrice, 2_500)
        XCTAssertEqual(inv.items[1].quantity, 1)
        XCTAssertEqual(inv.items[0].quantity, 1, "a missing quantity is the model's one")
        XCTAssertEqual(inv.grandTotal, 5_000)
        XCTAssertEqual(inv.balanceDue, 5_000)
        XCTAssertEqual(inv.paymentHistory.count, 1)
        XCTAssertEqual(inv.paymentHistory[0].amount, 1_000)
        XCTAssertEqual(inv.paymentHistory[0].method, .unknown("Easypaisa"))
        XCTAssertEqual(inv.status, .unknown("Disputed"))
        XCTAssertEqual(inv.shopifyOrderNumber, 1042)
        XCTAssertEqual(inv.shopifyTransactionIds, ["777", "888"])
        XCTAssertEqual(inv.ratesApplied, Rates())
        XCTAssertTrue(inv.hideRates)
        XCTAssertEqual(inv.createdAt, "")
        XCTAssertTrue(inv.exchanges.isEmpty)
    }

    func testInvoiceRefundedAndLegacyExchange() throws {
        let inv = try decode(Invoice.self, """
        {"id":"INV-000050","customerName":"Walk-in","items":[],"status":"Refunded","refundedAt":"2026-08-02T00:00:00Z",
         "exchangeDescription":"Gold chain","exchangeAmount1":40000,"exchangeAmount2":"5000","adjustmentsAmount":"250"}
        """)
        XCTAssertEqual(inv.status, .refunded)
        XCTAssertEqual(inv.refundedAt, "2026-08-02T00:00:00Z")
        XCTAssertTrue(inv.exchanges.isEmpty)
        XCTAssertEqual(inv.exchangeDescription, "Gold chain")
        XCTAssertEqual(inv.exchangeAmount1, 40_000)
        XCTAssertEqual(inv.exchangeAmount2, 5_000)
        XCTAssertEqual(inv.adjustmentsAmount, 250)
    }

    // MARK: Order

    func testOrderClean() throws {
        let o = try decode(Order.self, """
        {"id":"ORD-000007","createdAt":"2026-10-02T07:00:00.000Z","promisedDate":"2026-10-20","status":"In Progress",
         "items":[{"itemCategory":"Rings","description":"Ring with small stone","karat":"21k","estimatedWeightG":6,
                   "stoneWeightG":0.4,"hasStones":true,"wastagePercentage":10,"makingCharges":9000,"diamondCharges":0,
                   "stoneCharges":3000,"sampleGiven":false,"isCompleted":false,"hasDiamonds":false,"metalType":"gold",
                   "karigarId":"k-1","givenAt":"2026-10-03T05:00:00Z","size":"US 7"}],
         "ratesApplied":{"goldRatePerGram21k":23000},"takenBy":"Test Clerk","subtotal":180000,"discountAmount":10000,
         "advancePayment":50000,"advanceMethod":"Bank Transfer",
         "advances":[{"amount":20000,"date":"2026-10-05T10:00:00Z","method":"Cash"}],
         "grandTotal":100000,"customerId":"c-1","customerName":"Sana Example","source":"referral",
         "delivery":{"required":true,"address":"1 Example Road","city":"Testville","charge":500}}
        """)
        XCTAssertEqual(o.id, "ORD-000007")
        XCTAssertEqual(o.status, .inProgress)
        XCTAssertEqual(o.status.rawValue, "In Progress")
        XCTAssertEqual(o.promisedDate, "2026-10-20")
        XCTAssertEqual(o.items.count, 1)
        XCTAssertEqual(o.items[0].estimatedWeightG, 6)
        XCTAssertTrue(o.items[0].hasStones)
        XCTAssertEqual(o.items[0].karigarId, "k-1")
        XCTAssertEqual(o.items[0].size, "US 7")
        XCTAssertEqual(o.advancePayment, 50_000)
        XCTAssertEqual(o.advanceMethod, .bankTransfer)
        XCTAssertEqual(o.advances.map(\.amount), [20_000])
        XCTAssertEqual(o.discountAmount, 10_000)
        XCTAssertEqual(o.grandTotal, 100_000)
        XCTAssertEqual(o.source, .referral)
        XCTAssertEqual(o.delivery?.required, true)
        XCTAssertEqual(o.delivery?.charge, 500)
        XCTAssertNil(o.website)
        XCTAssertNil(o.invoiceId)
    }

    func testOrderMessyWebsiteOrder() throws {
        // A website order: items and slips as maps, sizes a map, an unknown order status and payment status,
        // numbers as strings, a missing advance.
        let o = try decode(Order.self, """
        {"id":"ORD-000200","createdAt":"2026-10-04T12:00:00Z","status":"On Hold",
         "items":{"0":{"description":"Bangle","metalType":"gold","estimatedWeightG":"12.5","hasStones":"false","wastagePercentage":"8"},
                  "1":"not an item"},
         "subtotal":"300,000","grandTotal":"300000","advancePayment":null,
         "website":{"token":"abc123","paymentMethod":"bank_transfer","paymentStatus":"refund_pending",
                    "pieces":{"0":"Bangles/Bangle 1.webp"},"deliveryCharge":"500","quotedAt":"2026-10-04T11:59:00Z",
                    "placedAt":"2026-10-04T12:00:00Z","holdUntil":"2026-10-05T12:00:00Z",
                    "slips":{"0":{"id":"s1","at":"2026-10-04T13:00:00Z","contentType":"image/jpeg","bytes":"20480","amount":"300500"}},
                    "sizes":{"Bangles/Bangle 1.webp":"2.6",    "x":12},"total":300500},
         "leopards":{"cn":"TEST0001","bookedAt":"2026-10-06T00:00:00Z","trackingUrl":"https://example.test/t/TEST0001","manual":"true"}}
        """)
        XCTAssertEqual(o.status, .unknown("On Hold"))
        XCTAssertEqual(o.items.count, 1, "the junk element is dropped, not fatal")
        XCTAssertEqual(o.items[0].estimatedWeightG, 12.5)
        XCTAssertFalse(o.items[0].hasStones)
        XCTAssertEqual(o.items[0].wastagePercentage, 8)
        XCTAssertEqual(o.subtotal, 300_000)
        XCTAssertEqual(o.advancePayment, 0)
        XCTAssertTrue(o.advances.isEmpty)
        let w = try XCTUnwrap(o.website)
        XCTAssertEqual(w.token, "abc123")
        XCTAssertEqual(w.paymentStatus, .unknown("refund_pending"))
        XCTAssertEqual(w.pieces, ["Bangles/Bangle 1.webp"])
        XCTAssertEqual(w.deliveryCharge, 500)
        XCTAssertEqual(w.slips.count, 1)
        XCTAssertEqual(w.slips[0].bytes, 20_480)
        XCTAssertEqual(w.slips[0].amount, 300_500)
        XCTAssertEqual(w.sizes["Bangles/Bangle 1.webp"], "2.6")
        XCTAssertEqual(w.sizes["x"], "12")
        XCTAssertEqual(w.total, 300_500)
        XCTAssertEqual(o.leopards?.cn, "TEST0001")
        XCTAssertEqual(o.leopards?.manual, true)
    }

    func testOrderLegacyExchange() throws {
        let o = try decode(Order.self, """
        {"id":"ORD-000001","status":"Pending","advanceInExchangeDescription":"Old bangle","advanceInExchangeValue":"30000"}
        """)
        XCTAssertEqual(o.status, .pending)
        XCTAssertTrue(o.exchanges.isEmpty)
        XCTAssertEqual(o.advanceInExchangeDescription, "Old bangle")
        XCTAssertEqual(o.advanceInExchangeValue, 30_000)
        XCTAssertNil(o.discountAmount)
    }

    // MARK: Customer, Product, Karigar

    func testCustomer() throws {
        let c = try decode(Customer.self, """
        {"id":"c-1","name":"Sana Example","phone":"+92 300 0000001","altPhone":"+92 300 0000002","city":"Testville",
         "source":"social_media","ringSize":"US 6","tags":["tj","hom"],"birthday":"1990-05-17","notes":"prefers yellow gold"}
        """)
        XCTAssertEqual(c.name, "Sana Example")
        XCTAssertEqual(c.altPhone, "+92 300 0000002")
        XCTAssertEqual(c.source, .socialMedia)
        XCTAssertEqual(c.ringSize, "US 6")
        XCTAssertEqual(c.tags, ["tj", "hom"])
        XCTAssertNil(c.deletedAt)

        // Messy: a phone saved as a number, tags as a map, an unknown source, a removed customer, a ring size as a number.
        let m = try decode(Customer.self, """
        {"id":"c-2","name":"Bilal Sample","phone":923000000003,"source":"instagram","tags":{"1":"b","0":"a"},
         "ringSize":12,"deletedAt":"2026-09-01T00:00:00Z"}
        """)
        XCTAssertEqual(m.phone, "923000000003")
        XCTAssertEqual(m.source, .unknown("instagram"))
        XCTAssertEqual(m.tags, ["a", "b"])
        XCTAssertEqual(m.ringSize, "12")
        XCTAssertEqual(m.deletedAt, "2026-09-01T00:00:00Z")
    }

    func testProduct() throws {
        let p = try decode(Product.self, """
        {"sku":"RIN-000010","name":"Test solitaire ring","categoryId":"cat001","metalType":"gold","karat":"18k",
         "metalWeightG":4.1,"hasStones":false,"stoneWeightG":0,"wastagePercentage":9,"makingCharges":8000,
         "hasDiamonds":true,"diamondCharges":150000,"stoneCharges":0,"miscCharges":0,"isCustomPrice":true,
         "customPrice":420000,"size":"10 Indian / 5 US","imageUrl":"https://example.test/p.jpg"}
        """)
        XCTAssertEqual(p.sku, "RIN-000010")
        XCTAssertEqual(p.id, "RIN-000010")
        XCTAssertEqual(p.karat, .k18)
        XCTAssertEqual(p.metalWeightG, 4.1)
        XCTAssertTrue(p.hasDiamonds)
        XCTAssertEqual(p.diamondCharges, 150_000)
        XCTAssertTrue(p.isCustomPrice)
        XCTAssertEqual(p.customPrice, 420_000)

        // Messy: the SKU only as the injected id, numbers as strings, a metal the list does not know,
        // a silver piece with plating.
        let m = try decode(Product.self, """
        {"id":"BNG-000002","name":"Test bangle","metalType":"rose gold","metalWeightG":"20.25","makingCharges":"1,500",
         "secondaryMetalType":"silver","secondaryMetalWeightG":"2","platingType":"White Rhodium","nickelFree":"true"}
        """)
        XCTAssertEqual(m.sku, "BNG-000002")
        XCTAssertEqual(m.id, "BNG-000002")
        XCTAssertEqual(m.metalType, .unknown("rose gold"))
        XCTAssertEqual(m.metalWeightG, 20.25)
        XCTAssertEqual(m.makingCharges, 1_500)
        XCTAssertEqual(m.secondaryMetalType, .silver)
        XCTAssertEqual(m.secondaryMetalWeightG, 2)
        XCTAssertTrue(m.nickelFree)
        XCTAssertNil(m.karat)
        XCTAssertFalse(m.isCustomPrice)
    }

    func testKarigarAndJob() throws {
        let k = try decode(Karigar.self, """
        {"id":"k-1","name":"Test Karigar","contact":"+92 300 0000009","specialty":"setting","email":"karigar@example.test"}
        """)
        XCTAssertEqual(k.name, "Test Karigar")
        XCTAssertEqual(k.specialty, "setting")
        XCTAssertEqual(k.email, "karigar@example.test")
        XCTAssertNil(k.deletedAt)

        let j = try decode(KarigarJob.self, """
        {"id":"j-1","karigarId":"k-1","karigarName":"Test Karigar","description":"Re-polish a set","metalType":"gold",
         "karat":"22k","weightG":"31.5","quantity":2,"status":"in-progress","assignedDate":"2026-10-01T00:00:00Z",
         "agreedCost":"4,000"}
        """)
        XCTAssertEqual(j.status, .inProgress)
        XCTAssertEqual(j.status.rawValue, "in-progress")
        XCTAssertEqual(j.metalType, .gold)
        XCTAssertEqual(j.karat, .k22)
        XCTAssertEqual(j.weightG, 31.5)
        XCTAssertEqual(j.agreedCost, 4_000)

        // Messy: an unknown status and nothing else.
        let m = try decode(KarigarJob.self, #"{"id":"j-2","status":"on-hold"}"#)
        XCTAssertEqual(m.status, .unknown("on-hold"))
        XCTAssertEqual(m.description, "")
        XCTAssertNil(m.metalType)
    }

    // MARK: Hisaab

    func testHisaabEntry() throws {
        let h = try decode(HisaabEntry.self, """
        {"id":"h-1","entityId":"c-1","entityType":"customer","entityName":"Sana Example","date":"2026-10-01T08:30:00Z",
         "description":"Outstanding balance for Invoice INV-000101","cashDebit":25000,"cashCredit":0,
         "goldDebitGrams":0,"goldCreditGrams":0,"linkedInvoiceId":"INV-000101"}
        """)
        XCTAssertEqual(h.entityType, .customer)
        XCTAssertEqual(h.cashDebit, 25_000)
        XCTAssertEqual(h.linkedInvoiceId, "INV-000101")

        // Messy: strings for numbers, gold in grams with a fraction, an unknown entity type, no link.
        let m = try decode(HisaabEntry.self, """
        {"id":"h-2","entityId":"k-1","entityType":"supplier","cashDebit":"1,200","cashCredit":"300.5","goldCreditGrams":"2.25"}
        """)
        XCTAssertEqual(m.entityType, .unknown("supplier"))
        XCTAssertEqual(m.cashDebit, 1_200)
        XCTAssertEqual(m.cashCredit, 300.5)
        XCTAssertEqual(m.goldCreditGrams, 2.25)
        XCTAssertEqual(m.goldDebitGrams, 0)
        XCTAssertNil(m.linkedInvoiceId)
    }

    // MARK: Repair

    func testRepair() throws {
        let r = try decode(Repair.self, """
        {"id":"REP-000003","customerName":"Sana Example","customerContact":"+92 300 0000001",
         "pieces":[{"item":"Gold ring","work":"resize to 14","weightG":3.2,"price":2500},{"item":"Chain","work":"re-solder","price":1000}],
         "payments":[{"amount":1000,"date":"2026-10-03T09:00:00Z","method":"Cash","revenueId":"r-1","note":"Advance"}],
         "status":"ready","receivedAt":"2026-10-03T09:00:00Z","promisedDate":"2026-10-07","karigarId":"k-1","takenBy":"Test Clerk"}
        """)
        XCTAssertEqual(r.status, .ready)
        XCTAssertEqual(r.pieces.count, 2)
        XCTAssertEqual(r.pieces[0].work, "resize to 14")
        XCTAssertEqual(r.pieces[0].weightG, 3.2)
        XCTAssertEqual(r.pieces.compactMap(\.price).reduce(0, +), 3_500)
        XCTAssertEqual(r.payments.first?.method, .cash)
        XCTAssertEqual(r.payments.first?.note, "Advance")
        XCTAssertEqual(r.payments.first?.revenueId, "r-1")
        XCTAssertEqual(r.promisedDate, "2026-10-07")

        // Messy: pieces and payments as maps, price as a string, an unknown status.
        let m = try decode(Repair.self, """
        {"id":"REP-000004","customerName":"Bilal Sample","status":"lost",
         "pieces":{"0":{"item":"Bangle","work":"polish","price":"1,800"}},
         "payments":{"0":{"amount":"500","date":"2026-10-04T00:00:00Z"}}}
        """)
        XCTAssertEqual(m.status, .unknown("lost"))
        XCTAssertEqual(m.pieces.first?.price, 1_800)
        XCTAssertEqual(m.payments.first?.amount, 500)
        XCTAssertNil(m.payments.first?.method)
        XCTAssertEqual(m.receivedAt, "")
    }

    // MARK: Expense, AdditionalRevenue, GivenItem

    func testExpenseAndRevenue() throws {
        let e = try decode(Expense.self, """
        {"id":"e-1","date":"2026-10-02T00:00:00Z","category":"Rent","description":"October rent","amount":60000,"paidBy":"ammar","ledgerEntryId":"l-1"}
        """)
        XCTAssertEqual(e.category, "Rent")
        XCTAssertEqual(e.amount, 60_000)
        XCTAssertEqual(e.paidBy, .ammar)
        XCTAssertEqual(e.ledgerEntryId, "l-1")

        // Messy: no paidBy (the business), a typed category, an amount as a string, a partner who is not listed.
        let m = try decode(Expense.self, #"{"id":"e-2","category":"Tea and biscuits","amount":"850"}"#)
        XCTAssertEqual(m.paidBy, .business)
        XCTAssertEqual(m.category, "Tea and biscuits")
        XCTAssertEqual(m.amount, 850)
        let x = try decode(Expense.self, #"{"id":"e-3","paidBy":"zubair"}"#)
        XCTAssertEqual(x.paidBy, .unknown("zubair"))

        let r = try decode(AdditionalRevenue.self, """
        {"id":"r-1","date":"2026-10-03T09:00:00Z","description":"Repair advance REP-000003","amount":"1000","repairId":"REP-000003"}
        """)
        XCTAssertEqual(r.amount, 1_000)
        XCTAssertEqual(r.repairId, "REP-000003")
        let bare = try decode(AdditionalRevenue.self, #"{"id":"r-2"}"#)
        XCTAssertEqual(bare.amount, 0)
        XCTAssertNil(bare.repairId)
    }

    func testGivenItem() throws {
        let g = try decode(GivenItem.self, """
        {"id":"g-1","date":"2026-10-01T00:00:00Z","description":"Gold ring sample","recipientType":"karigar",
         "recipientName":"Test Karigar","recipientId":"k-1","status":"out"}
        """)
        XCTAssertEqual(g.recipientType, .karigar)
        XCTAssertEqual(g.status, .out)
        XCTAssertEqual(g.recipientId, "k-1")
        XCTAssertNil(g.returnedDate)

        // Messy: an old row with a name only, an unknown recipient type, a status the list does not know.
        let m = try decode(GivenItem.self, """
        {"id":"g-2","description":"Repair bangle","recipientType":"supplier","recipientName":"Somebody","status":"lost"}
        """)
        XCTAssertEqual(m.recipientType, .unknown("supplier"))
        XCTAssertEqual(m.status, .unknown("lost"))
        XCTAssertNil(m.recipientId)

        let back = try decode(GivenItem.self, #"{"id":"g-3","recipientType":"other","status":"returned","returnedDate":"2026-10-05T00:00:00Z"}"#)
        XCTAssertEqual(back.recipientType, .other)
        XCTAssertEqual(back.status, .returned)
        XCTAssertEqual(back.returnedDate, "2026-10-05T00:00:00Z")
    }

    // MARK: Settings

    func testSettings() throws {
        let s = try decode(Settings.self, """
        {"goldRatePerGram24k":26000,"goldRatePerGram22k":24000,"goldRatePerGram21k":23000,"goldRatePerGram18k":19500,
         "palladiumRatePerGram":22000,"palladiumRatePerGram18k":21000,"palladiumRatePerGram12k":15000,
         "platinumRatePerGram":25000,"silverRatePerGram":300,
         "ratesUpdatedAt":"2026-10-08T04:00:00.000Z","ratesUpdatedBy":"Test Clerk",
         "shopName":"Test Jewellers","shopAddress":"1 Example Road","shopContact":"+92 300 0000000",
         "lastInvoiceNumber":321,"lastOrderNumber":88,"lastRepairNumber":12,
         "paymentMethods":[{"id":"pm-1","bankName":"Test Bank","accountName":"Test Jewellers","accountNumber":"0000-1","iban":"PK00TEST0000000000000001"}],
         "theme":"taheri","uiStyle":"glass","databaseLocked":false,"shopifyAccessToken":"shpat_not_decoded",
         "notifEnabled":true,"notifPhones":["923000000001"],"notifNewInvoice":true,"notifDailyReport":true,
         "notifDailyReportTime":"21:30"}
        """)
        XCTAssertEqual(s.id, "global")
        XCTAssertEqual(s.goldRatePerGram24k, 26_000)
        XCTAssertEqual(s.goldRatePerGram18k, 19_500)
        XCTAssertEqual(s.palladiumRatePerGram12k, 15_000)
        XCTAssertEqual(s.silverRatePerGram, 300)
        XCTAssertEqual(s.ratesUpdatedAt, "2026-10-08T04:00:00.000Z")
        XCTAssertEqual(s.ratesUpdatedBy, "Test Clerk")
        XCTAssertEqual(s.shopName, "Test Jewellers")
        XCTAssertEqual(s.lastInvoiceNumber, 321)
        XCTAssertEqual(s.lastRepairNumber, 12)
        XCTAssertEqual(s.paymentMethods.first?.bankName, "Test Bank")
        XCTAssertEqual(s.paymentMethods.first?.iban, "PK00TEST0000000000000001")
        XCTAssertEqual(s.uiStyle, "glass")
        XCTAssertTrue(s.notifEnabled)
        XCTAssertTrue(s.notifNewInvoice)
        XCTAssertFalse(s.notifNewOrder)
        XCTAssertEqual(s.notifDailyReportTime, "21:30")
        XCTAssertNil(s.notifEndOfDayTime)
        XCTAssertTrue(s.autoDraftForms, "drafts default on")
    }

    /// The app's settings screens read a shop with no document yet as `{}` (Settings.blank).
    func testSettingsEmptyDocument() throws {
        let s = try decode(Settings.self, "{}")
        XCTAssertEqual(s.id, "global")
        XCTAssertEqual(s.shopName, "")
        XCTAssertTrue(s.paymentMethods.isEmpty)
        XCTAssertTrue(s.notifPhones.isEmpty)
        XCTAssertFalse(s.notifEnabled)
        XCTAssertTrue(s.autoDraftForms)
    }

    func testSettingsMessy() throws {
        // Rates and counters as strings, phones as numbers, payment methods as a map, switches as odd values.
        let s = try decode(Settings.self, """
        {"goldRatePerGram21k":"23,500","silverRatePerGram":"310.5","lastInvoiceNumber":"150",
         "notifEnabled":"true","notifPhones":{"0":923000000001,"1":"923000000002"},"notifOrderOverdue":1,"notifGivenItems":0,
         "paymentMethods":{"0":{"id":"pm-1","bankName":"Test Bank","accountNumber":12345}},
         "autoDraftForms":false,"databaseLocked":"yes"}
        """)
        XCTAssertEqual(s.goldRatePerGram21k, 23_500)
        XCTAssertEqual(s.goldRatePerGram24k, 0, "a missing rate is 0, never a seed value")
        XCTAssertEqual(s.silverRatePerGram, 310.5)
        XCTAssertEqual(s.lastInvoiceNumber, 150)
        XCTAssertEqual(s.lastOrderNumber, 0)
        XCTAssertNil(s.lastRepairNumber)
        XCTAssertTrue(s.notifEnabled)
        XCTAssertEqual(s.notifPhones, ["923000000001", "923000000002"])
        XCTAssertTrue(s.notifOrderOverdue)
        XCTAssertFalse(s.notifGivenItems)
        XCTAssertEqual(s.paymentMethods.first?.accountNumber, "12345")
        XCTAssertFalse(s.autoDraftForms)
        XCTAssertTrue(s.databaseLocked)
        XCTAssertEqual(s.shopName, "")
        XCTAssertNil(s.ratesUpdatedAt)
    }

    // MARK: Words, collections, odd documents

    func testWordsNeverFail() throws {
        let words = try decode([OrderStatus].self, #"["Pending","In Progress","Completed","Cancelled","Refunded","Archived",12,null]"#)
        XCTAssertEqual(words, [.pending, .inProgress, .completed, .cancelled, .refunded, .unknown("Archived"), .unknown("12"), .unknown("")])
        XCTAssertEqual(words.map(\.rawValue), ["Pending", "In Progress", "Completed", "Cancelled", "Refunded", "Archived", "12", ""])
        XCTAssertEqual(PaymentType(rawValue: "Bank Transfer"), .bankTransfer)
        XCTAssertEqual(PaymentType(rawValue: "cash"), .unknown("cash"), "exact, as the ERP compares")
        XCTAssertEqual(CustomerSource(rawValue: "taheri_spillover"), .taheriSpillover)
        XCTAssertEqual(CustomerSource(rawValue: "other"), .other)
        XCTAssertEqual(WebsitePaymentStatus(rawValue: "slip_sent").rawValue, "slip_sent")
        for status in ["received", "ready", "collected", "cancelled", "x"] {
            XCTAssertEqual(RepairStatus(rawValue: status).rawValue, status)
        }
        for karat in ["12k", "18k", "21k", "22k", "24k", "9k"] {
            XCTAssertEqual(KaratValue(rawValue: karat).rawValue, karat)
        }
    }

    func testCollectionNames() {
        XCTAssertEqual(Collections.settings, "app_settings")
        XCTAssertEqual(Collections.globalSettingsDoc, "global")
        XCTAssertEqual(Collections.hisaab, "hisaab")
        XCTAssertEqual(Collections.givenItems, "given_items")
        XCTAssertEqual(Collections.additionalRevenue, "additional_revenue")
        XCTAssertEqual(Collections.karigarJobs, "karigar_jobs")
        XCTAssertEqual(Collections.soldProducts, "sold_products")
        XCTAssertEqual(Collections.repairs, "repairs")
        XCTAssertEqual(Collections.orderPhotos, "order_photos")
    }

    func testEmptyDocumentsDecodeEverywhere() throws {
        XCTAssertEqual(try decode(Invoice.self, "{}").id, "")
        XCTAssertEqual(try decode(Order.self, "{}").status, .unknown(""))
        XCTAssertEqual(try decode(Customer.self, "{}").name, "")
        XCTAssertEqual(try decode(Product.self, "{}").sku, "")
        XCTAssertEqual(try decode(Karigar.self, "{}").name, "")
        XCTAssertEqual(try decode(KarigarJob.self, "{}").status, .unknown(""))
        XCTAssertEqual(try decode(HisaabEntry.self, "{}").cashDebit, 0)
        XCTAssertEqual(try decode(Repair.self, "{}").pieces.count, 0)
        XCTAssertEqual(try decode(Expense.self, "{}").paidBy, .business)
        XCTAssertEqual(try decode(AdditionalRevenue.self, "{}").amount, 0)
        XCTAssertEqual(try decode(GivenItem.self, "{}").status, .unknown(""))
        XCTAssertEqual(try decode(Settings.self, "{}").id, "global")
    }

    func testOneOddDocumentNeverEmptiesAList() throws {
        let json = Data("""
        [{"id":"INV-1","customerName":"Sana Example","grandTotal":"1,000"}, "garbage", 42,
         {"id":"INV-2","items":{"0":{"sku":"A"}},"balanceDue":"7"}, null]
        """.utf8)
        let invoices = ERPDecode.models(Invoice.self, from: json)
        XCTAssertEqual(invoices.map(\.id), ["INV-1", "INV-2"])
        XCTAssertEqual(invoices[0].grandTotal, 1_000)
        XCTAssertEqual(invoices[1].items.first?.sku, "A")
        XCTAssertEqual(invoices[1].balanceDue, 7)
    }

    func testDecodedModelsAreHashableAndIdentifiable() throws {
        let json = #"{"id":"ORD-000009","status":"Pending","grandTotal":1000}"#
        let a = try decode(Order.self, json)
        let b = try decode(Order.self, json)
        XCTAssertEqual(a, b)
        XCTAssertEqual(Set([a, b]).count, 1)
        XCTAssertEqual(a.id, "ORD-000009")
    }

    func testDecodingFromFirestoreJSONObject() {
        // The app hands over a dictionary (FirestoreJSON); ERPDecode.model reads it the same way.
        let doc: [String: Any] = ["id": "e-9", "amount": "1,250", "category": "Utilities", "paidBy": "mina"]
        let e = ERPDecode.model(Expense.self, from: doc)
        XCTAssertEqual(e?.amount, 1_250)
        XCTAssertEqual(e?.paidBy, .mina)
    }
}
