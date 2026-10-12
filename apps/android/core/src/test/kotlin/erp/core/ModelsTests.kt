package erp.core

import erp.core.models.AdditionalRevenue
import erp.core.models.Collections
import erp.core.models.CustomerSource
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.GivenItem
import erp.core.models.GivenItemRecipientType
import erp.core.models.GivenItemStatus
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import erp.core.models.KarigarJobStatus
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.OrderStatus
import erp.core.models.PaidBy
import erp.core.models.PaymentType
import erp.core.models.Product
import erp.core.models.Rates
import erp.core.models.Repair
import erp.core.models.RepairStatus
import erp.core.models.Settings
import erp.core.models.WebsitePaymentStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The models decode the ERP's Firestore documents as they really are: clean ones, and the
 * messy ones years of scripts and imports left behind. Every name, phone and amount here is
 * made up (the repository is public).
 */
class ModelsTests {
    private inline fun <reified T : Any> decode(json: String): T = assertNotNull(Json.decode<T>(json), "the JSON is an object")

    // MARK: Invoice

    @Test
    fun testInvoiceClean() {
        val inv = decode<Invoice>(
            """
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
            """,
        )
        assertEquals("INV-000101", inv.id)
        assertEquals("Sana Example", inv.customerName)
        assertEquals(1, inv.items.size)
        assertEquals(MetalType.gold, inv.items[0].metalType)
        assertEquals(KaratValue.k21, inv.items[0].karat)
        assertEquals(120_000.0, inv.items[0].unitPrice)
        assertEquals("12", inv.items[0].size)
        assertEquals(60_000.0, inv.exchanges.firstOrNull()?.value)
        assertEquals("22k", inv.exchanges.firstOrNull()?.karat)
        assertEquals(55_000.0, inv.grandTotal)
        assertEquals(25_000.0, inv.balanceDue)
        assertEquals(23_000.0, inv.ratesApplied.goldRatePerGram21k)
        assertNull(inv.ratesApplied.silverRatePerGram)
        assertTrue(inv.hideRates)
        assertEquals(PaymentType.cash, inv.paymentHistory.firstOrNull()?.method)
        assertEquals("923000000001", inv.sentOnWhatsApp?.to)
        assertEquals(CustomerSource.walkin, inv.acquisitionSource)
        assertEquals(24_500.0, inv.costRate24k)
        assertNull(inv.status)
    }

    @Test
    fun testInvoiceMessy() {
        // Items as a map (out of order), money as strings, an unknown status and method, no rates.
        val inv = decode<Invoice>(
            """
            {"id":"SHOPIFY-9001","customerName":"Bilal Sample",
             "items":{"1":{"sku":"B","name":"Second","metalType":"silver","unitPrice":"2,500","quantity":"1"},
                      "0":{"sku":"A","name":"First","metalType":"titanium","karat":"21K"}},
             "subtotal":"5000","grandTotal":"5,000","amountPaid":"0","balanceDue":"5000",
             "paymentHistory":{"0":{"amount":"1,000","date":"2026-09-30T10:00:00Z","method":"Easypaisa"}},
             "status":"Disputed","shopifyOrderNumber":"1042","shopifyTransactionIds":[777,"888"],
             "source":"shopify","hideRates":"yes"}
            """,
        )
        assertEquals(listOf("A", "B"), inv.items.map { it.sku })
        assertEquals(MetalType.unknown("titanium"), inv.items[0].metalType)
        assertEquals(KaratValue.unknown("21K"), inv.items[0].karat, "karat matching is exact, as the ERP compares")
        assertEquals(MetalType.silver, inv.items[1].metalType)
        assertEquals(2_500.0, inv.items[1].unitPrice)
        assertEquals(1.0, inv.items[1].quantity)
        assertEquals(1.0, inv.items[0].quantity, "a missing quantity is the model's one")
        assertEquals(5_000.0, inv.grandTotal)
        assertEquals(5_000.0, inv.balanceDue)
        assertEquals(1, inv.paymentHistory.size)
        assertEquals(1_000.0, inv.paymentHistory[0].amount)
        assertEquals(PaymentType.unknown("Easypaisa"), inv.paymentHistory[0].method)
        assertEquals(InvoiceStatus.unknown("Disputed"), inv.status)
        assertEquals(1042, inv.shopifyOrderNumber)
        assertEquals(listOf("777", "888"), inv.shopifyTransactionIds)
        assertEquals(Rates(), inv.ratesApplied)
        assertTrue(inv.hideRates)
        assertEquals("", inv.createdAt)
        assertTrue(inv.exchanges.isEmpty())
    }

    @Test
    fun testInvoiceRefundedAndLegacyExchange() {
        val inv = decode<Invoice>(
            """
            {"id":"INV-000050","customerName":"Walk-in","items":[],"status":"Refunded","refundedAt":"2026-08-02T00:00:00Z",
             "exchangeDescription":"Gold chain","exchangeAmount1":40000,"exchangeAmount2":"5000","adjustmentsAmount":"250"}
            """,
        )
        assertEquals(InvoiceStatus.refunded, inv.status)
        assertEquals("2026-08-02T00:00:00Z", inv.refundedAt)
        assertTrue(inv.exchanges.isEmpty())
        assertEquals("Gold chain", inv.exchangeDescription)
        assertEquals(40_000.0, inv.exchangeAmount1)
        assertEquals(5_000.0, inv.exchangeAmount2)
        assertEquals(250.0, inv.adjustmentsAmount)
    }

    // MARK: Order

    @Test
    fun testOrderClean() {
        val o = decode<Order>(
            """
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
            """,
        )
        assertEquals("ORD-000007", o.id)
        assertEquals(OrderStatus.inProgress, o.status)
        assertEquals("In Progress", o.status.rawValue)
        assertEquals("2026-10-20", o.promisedDate)
        assertEquals(1, o.items.size)
        assertEquals(6.0, o.items[0].estimatedWeightG)
        assertTrue(o.items[0].hasStones)
        assertEquals("k-1", o.items[0].karigarId)
        assertEquals("US 7", o.items[0].size)
        assertEquals(50_000.0, o.advancePayment)
        assertEquals(PaymentType.bankTransfer, o.advanceMethod)
        assertEquals(listOf(20_000.0), o.advances.map { it.amount })
        assertEquals(10_000.0, o.discountAmount)
        assertEquals(100_000.0, o.grandTotal)
        assertEquals(CustomerSource.referral, o.source)
        assertEquals(true, o.delivery?.required)
        assertEquals(500.0, o.delivery?.charge)
        assertNull(o.website)
        assertNull(o.invoiceId)
    }

    @Test
    fun testOrderMessyWebsiteOrder() {
        // A website order: items and slips as maps, sizes a map, an unknown order status and payment status,
        // numbers as strings, a missing advance.
        val o = decode<Order>(
            """
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
            """,
        )
        assertEquals(OrderStatus.unknown("On Hold"), o.status)
        assertEquals(1, o.items.size, "the junk element is dropped, not fatal")
        assertEquals(12.5, o.items[0].estimatedWeightG)
        assertFalse(o.items[0].hasStones)
        assertEquals(8.0, o.items[0].wastagePercentage)
        assertEquals(300_000.0, o.subtotal)
        assertEquals(0.0, o.advancePayment)
        assertTrue(o.advances.isEmpty())
        val w = assertNotNull(o.website)
        assertEquals("abc123", w.token)
        assertEquals(WebsitePaymentStatus.unknown("refund_pending"), w.paymentStatus)
        assertEquals(listOf("Bangles/Bangle 1.webp"), w.pieces)
        assertEquals(500.0, w.deliveryCharge)
        assertEquals(1, w.slips.size)
        assertEquals(20_480, w.slips[0].bytes)
        assertEquals(300_500.0, w.slips[0].amount)
        assertEquals("2.6", w.sizes["Bangles/Bangle 1.webp"])
        assertEquals("12", w.sizes["x"])
        assertEquals(300_500.0, w.total)
        assertEquals("TEST0001", o.leopards?.cn)
        assertEquals(true, o.leopards?.manual)
    }

    @Test
    fun testOrderLegacyExchange() {
        val o = decode<Order>(
            """
            {"id":"ORD-000001","status":"Pending","advanceInExchangeDescription":"Old bangle","advanceInExchangeValue":"30000"}
            """,
        )
        assertEquals(OrderStatus.pending, o.status)
        assertTrue(o.exchanges.isEmpty())
        assertEquals("Old bangle", o.advanceInExchangeDescription)
        assertEquals(30_000.0, o.advanceInExchangeValue)
        assertNull(o.discountAmount)
    }

    // MARK: Customer, Product, Karigar

    @Test
    fun testCustomer() {
        val c = decode<Customer>(
            """
            {"id":"c-1","name":"Sana Example","phone":"+92 300 0000001","altPhone":"+92 300 0000002","city":"Testville",
             "source":"social_media","ringSize":"US 6","tags":["tj","hom"],"birthday":"1990-05-17","notes":"prefers yellow gold"}
            """,
        )
        assertEquals("Sana Example", c.name)
        assertEquals("+92 300 0000002", c.altPhone)
        assertEquals(CustomerSource.socialMedia, c.source)
        assertEquals("US 6", c.ringSize)
        assertEquals(listOf("tj", "hom"), c.tags)
        assertNull(c.deletedAt)

        // Messy: a phone saved as a number, tags as a map, an unknown source, a removed customer, a ring size as a number.
        val m = decode<Customer>(
            """
            {"id":"c-2","name":"Bilal Sample","phone":923000000003,"source":"instagram","tags":{"1":"b","0":"a"},
             "ringSize":12,"deletedAt":"2026-09-01T00:00:00Z"}
            """,
        )
        assertEquals("923000000003", m.phone)
        assertEquals(CustomerSource.unknown("instagram"), m.source)
        assertEquals(listOf("a", "b"), m.tags)
        assertEquals("12", m.ringSize)
        assertEquals("2026-09-01T00:00:00Z", m.deletedAt)
    }

    @Test
    fun testProduct() {
        val p = decode<Product>(
            """
            {"sku":"RIN-000010","name":"Test solitaire ring","categoryId":"cat001","metalType":"gold","karat":"18k",
             "metalWeightG":4.1,"hasStones":false,"stoneWeightG":0,"wastagePercentage":9,"makingCharges":8000,
             "hasDiamonds":true,"diamondCharges":150000,"stoneCharges":0,"miscCharges":0,"isCustomPrice":true,
             "customPrice":420000,"size":"10 Indian / 5 US","imageUrl":"https://example.test/p.jpg"}
            """,
        )
        assertEquals("RIN-000010", p.sku)
        assertEquals("RIN-000010", p.id)
        assertEquals(KaratValue.k18, p.karat)
        assertEquals(4.1, p.metalWeightG)
        assertTrue(p.hasDiamonds)
        assertEquals(150_000.0, p.diamondCharges)
        assertTrue(p.isCustomPrice)
        assertEquals(420_000.0, p.customPrice)

        // Messy: the SKU only as the injected id, numbers as strings, a metal the list does not know,
        // a silver piece with plating.
        val m = decode<Product>(
            """
            {"id":"BNG-000002","name":"Test bangle","metalType":"rose gold","metalWeightG":"20.25","makingCharges":"1,500",
             "secondaryMetalType":"silver","secondaryMetalWeightG":"2","platingType":"White Rhodium","nickelFree":"true"}
            """,
        )
        assertEquals("BNG-000002", m.sku)
        assertEquals("BNG-000002", m.id)
        assertEquals(MetalType.unknown("rose gold"), m.metalType)
        assertEquals(20.25, m.metalWeightG)
        assertEquals(1_500.0, m.makingCharges)
        assertEquals(MetalType.silver, m.secondaryMetalType)
        assertEquals(2.0, m.secondaryMetalWeightG)
        assertTrue(m.nickelFree)
        assertNull(m.karat)
        assertFalse(m.isCustomPrice)
    }

    @Test
    fun testKarigarAndJob() {
        val k = decode<Karigar>(
            """
            {"id":"k-1","name":"Test Karigar","contact":"+92 300 0000009","specialty":"setting","email":"karigar@example.test"}
            """,
        )
        assertEquals("Test Karigar", k.name)
        assertEquals("setting", k.specialty)
        assertEquals("karigar@example.test", k.email)
        assertNull(k.deletedAt)

        val j = decode<KarigarJob>(
            """
            {"id":"j-1","karigarId":"k-1","karigarName":"Test Karigar","description":"Re-polish a set","metalType":"gold",
             "karat":"22k","weightG":"31.5","quantity":2,"status":"in-progress","assignedDate":"2026-10-01T00:00:00Z",
             "agreedCost":"4,000"}
            """,
        )
        assertEquals(KarigarJobStatus.inProgress, j.status)
        assertEquals("in-progress", j.status.rawValue)
        assertEquals(MetalType.gold, j.metalType)
        assertEquals(KaratValue.k22, j.karat)
        assertEquals(31.5, j.weightG)
        assertEquals(4_000.0, j.agreedCost)

        // Messy: an unknown status and nothing else.
        val m = decode<KarigarJob>("""{"id":"j-2","status":"on-hold"}""")
        assertEquals(KarigarJobStatus.unknown("on-hold"), m.status)
        assertEquals("", m.description)
        assertNull(m.metalType)
    }

    // MARK: Hisaab

    @Test
    fun testHisaabEntry() {
        val h = decode<HisaabEntry>(
            """
            {"id":"h-1","entityId":"c-1","entityType":"customer","entityName":"Sana Example","date":"2026-10-01T08:30:00Z",
             "description":"Outstanding balance for Invoice INV-000101","cashDebit":25000,"cashCredit":0,
             "goldDebitGrams":0,"goldCreditGrams":0,"linkedInvoiceId":"INV-000101"}
            """,
        )
        assertEquals(HisaabEntityType.customer, h.entityType)
        assertEquals(25_000.0, h.cashDebit)
        assertEquals("INV-000101", h.linkedInvoiceId)

        // Messy: strings for numbers, gold in grams with a fraction, an unknown entity type, no link.
        val m = decode<HisaabEntry>(
            """
            {"id":"h-2","entityId":"k-1","entityType":"supplier","cashDebit":"1,200","cashCredit":"300.5","goldCreditGrams":"2.25"}
            """,
        )
        assertEquals(HisaabEntityType.unknown("supplier"), m.entityType)
        assertEquals(1_200.0, m.cashDebit)
        assertEquals(300.5, m.cashCredit)
        assertEquals(2.25, m.goldCreditGrams)
        assertEquals(0.0, m.goldDebitGrams)
        assertNull(m.linkedInvoiceId)
    }

    // MARK: Repair

    @Test
    fun testRepair() {
        val r = decode<Repair>(
            """
            {"id":"REP-000003","customerName":"Sana Example","customerContact":"+92 300 0000001",
             "pieces":[{"item":"Gold ring","work":"resize to 14","weightG":3.2,"price":2500},{"item":"Chain","work":"re-solder","price":1000}],
             "payments":[{"amount":1000,"date":"2026-10-03T09:00:00Z","method":"Cash","revenueId":"r-1","note":"Advance"}],
             "status":"ready","receivedAt":"2026-10-03T09:00:00Z","promisedDate":"2026-10-07","karigarId":"k-1","takenBy":"Test Clerk"}
            """,
        )
        assertEquals(RepairStatus.ready, r.status)
        assertEquals(2, r.pieces.size)
        assertEquals("resize to 14", r.pieces[0].work)
        assertEquals(3.2, r.pieces[0].weightG)
        assertEquals(3_500.0, r.pieces.mapNotNull { it.price }.fold(0.0) { a, b -> a + b })
        assertEquals(PaymentType.cash, r.payments.firstOrNull()?.method)
        assertEquals("Advance", r.payments.firstOrNull()?.note)
        assertEquals("r-1", r.payments.firstOrNull()?.revenueId)
        assertEquals("2026-10-07", r.promisedDate)

        // Messy: pieces and payments as maps, price as a string, an unknown status.
        val m = decode<Repair>(
            """
            {"id":"REP-000004","customerName":"Bilal Sample","status":"lost",
             "pieces":{"0":{"item":"Bangle","work":"polish","price":"1,800"}},
             "payments":{"0":{"amount":"500","date":"2026-10-04T00:00:00Z"}}}
            """,
        )
        assertEquals(RepairStatus.unknown("lost"), m.status)
        assertEquals(1_800.0, m.pieces.firstOrNull()?.price)
        assertEquals(500.0, m.payments.firstOrNull()?.amount)
        assertNull(m.payments.firstOrNull()?.method)
        assertEquals("", m.receivedAt)
    }

    // MARK: Expense, AdditionalRevenue, GivenItem

    @Test
    fun testExpenseAndRevenue() {
        val e = decode<Expense>(
            """
            {"id":"e-1","date":"2026-10-02T00:00:00Z","category":"Rent","description":"October rent","amount":60000,"paidBy":"ammar","ledgerEntryId":"l-1"}
            """,
        )
        assertEquals("Rent", e.category)
        assertEquals(60_000.0, e.amount)
        assertEquals(PaidBy.ammar, e.paidBy)
        assertEquals("l-1", e.ledgerEntryId)

        // Messy: no paidBy (the business), a typed category, an amount as a string, a partner who is not listed.
        val m = decode<Expense>("""{"id":"e-2","category":"Tea and biscuits","amount":"850"}""")
        assertEquals(PaidBy.business, m.paidBy)
        assertEquals("Tea and biscuits", m.category)
        assertEquals(850.0, m.amount)
        val x = decode<Expense>("""{"id":"e-3","paidBy":"zubair"}""")
        assertEquals(PaidBy.unknown("zubair"), x.paidBy)

        val r = decode<AdditionalRevenue>(
            """
            {"id":"r-1","date":"2026-10-03T09:00:00Z","description":"Repair advance REP-000003","amount":"1000","repairId":"REP-000003"}
            """,
        )
        assertEquals(1_000.0, r.amount)
        assertEquals("REP-000003", r.repairId)
        val bare = decode<AdditionalRevenue>("""{"id":"r-2"}""")
        assertEquals(0.0, bare.amount)
        assertNull(bare.repairId)
    }

    @Test
    fun testGivenItem() {
        val g = decode<GivenItem>(
            """
            {"id":"g-1","date":"2026-10-01T00:00:00Z","description":"Gold ring sample","recipientType":"karigar",
             "recipientName":"Test Karigar","recipientId":"k-1","status":"out"}
            """,
        )
        assertEquals(GivenItemRecipientType.karigar, g.recipientType)
        assertEquals(GivenItemStatus.out, g.status)
        assertEquals("k-1", g.recipientId)
        assertNull(g.returnedDate)

        // Messy: an old row with a name only, an unknown recipient type, a status the list does not know.
        val m = decode<GivenItem>(
            """
            {"id":"g-2","description":"Repair bangle","recipientType":"supplier","recipientName":"Somebody","status":"lost"}
            """,
        )
        assertEquals(GivenItemRecipientType.unknown("supplier"), m.recipientType)
        assertEquals(GivenItemStatus.unknown("lost"), m.status)
        assertNull(m.recipientId)

        val back = decode<GivenItem>("""{"id":"g-3","recipientType":"other","status":"returned","returnedDate":"2026-10-05T00:00:00Z"}""")
        assertEquals(GivenItemRecipientType.other, back.recipientType)
        assertEquals(GivenItemStatus.returned, back.status)
        assertEquals("2026-10-05T00:00:00Z", back.returnedDate)
    }

    // MARK: Settings

    @Test
    fun testSettings() {
        val s = decode<Settings>(
            """
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
            """,
        )
        assertEquals("global", s.id)
        assertEquals(26_000.0, s.goldRatePerGram24k)
        assertEquals(19_500.0, s.goldRatePerGram18k)
        assertEquals(15_000.0, s.palladiumRatePerGram12k)
        assertEquals(300.0, s.silverRatePerGram)
        assertEquals("2026-10-08T04:00:00.000Z", s.ratesUpdatedAt)
        assertEquals("Test Clerk", s.ratesUpdatedBy)
        assertEquals("Test Jewellers", s.shopName)
        assertEquals(321, s.lastInvoiceNumber)
        assertEquals(12, s.lastRepairNumber)
        assertEquals("Test Bank", s.paymentMethods.firstOrNull()?.bankName)
        assertEquals("PK00TEST0000000000000001", s.paymentMethods.firstOrNull()?.iban)
        assertEquals("glass", s.uiStyle)
        assertTrue(s.notifEnabled)
        assertTrue(s.notifNewInvoice)
        assertFalse(s.notifNewOrder)
        assertEquals("21:30", s.notifDailyReportTime)
        assertNull(s.notifEndOfDayTime)
        assertTrue(s.autoDraftForms, "drafts default on")
    }

    /** The app's settings screens read a shop with no document yet as `{}` (Settings.blank). */
    @Test
    fun testSettingsEmptyDocument() {
        val s = decode<Settings>("{}")
        assertEquals("global", s.id)
        assertEquals("", s.shopName)
        assertTrue(s.paymentMethods.isEmpty())
        assertTrue(s.notifPhones.isEmpty())
        assertFalse(s.notifEnabled)
        assertTrue(s.autoDraftForms)
    }

    @Test
    fun testSettingsMessy() {
        // Rates and counters as strings, phones as numbers, payment methods as a map, switches as odd values.
        val s = decode<Settings>(
            """
            {"goldRatePerGram21k":"23,500","silverRatePerGram":"310.5","lastInvoiceNumber":"150",
             "notifEnabled":"true","notifPhones":{"0":923000000001,"1":"923000000002"},"notifOrderOverdue":1,"notifGivenItems":0,
             "paymentMethods":{"0":{"id":"pm-1","bankName":"Test Bank","accountNumber":12345}},
             "autoDraftForms":false,"databaseLocked":"yes"}
            """,
        )
        assertEquals(23_500.0, s.goldRatePerGram21k)
        assertEquals(0.0, s.goldRatePerGram24k, "a missing rate is 0, never a seed value")
        assertEquals(310.5, s.silverRatePerGram)
        assertEquals(150, s.lastInvoiceNumber)
        assertEquals(0, s.lastOrderNumber)
        assertNull(s.lastRepairNumber)
        assertTrue(s.notifEnabled)
        assertEquals(listOf("923000000001", "923000000002"), s.notifPhones)
        assertTrue(s.notifOrderOverdue)
        assertFalse(s.notifGivenItems)
        assertEquals("12345", s.paymentMethods.firstOrNull()?.accountNumber)
        assertFalse(s.autoDraftForms)
        assertTrue(s.databaseLocked)
        assertEquals("", s.shopName)
        assertNull(s.ratesUpdatedAt)
    }

    // MARK: Words, collections, odd documents

    @Test
    fun testWordsNeverFail() {
        val list = assertNotNull(Json.parse("""["Pending","In Progress","Completed","Cancelled","Refunded","Archived",12,null]""") as? List<*>)
        val words = list.map { OrderStatus.decode(it) }
        assertEquals(
            listOf(OrderStatus.pending, OrderStatus.inProgress, OrderStatus.completed, OrderStatus.cancelled, OrderStatus.refunded, OrderStatus.unknown("Archived"), OrderStatus.unknown("12"), OrderStatus.unknown("")),
            words,
        )
        assertEquals(listOf("Pending", "In Progress", "Completed", "Cancelled", "Refunded", "Archived", "12", ""), words.map { it.rawValue })
        assertEquals(PaymentType.bankTransfer, PaymentType.of("Bank Transfer"))
        assertEquals(PaymentType.unknown("cash"), PaymentType.of("cash"), "exact, as the ERP compares")
        assertEquals(CustomerSource.taheriSpillover, CustomerSource.of("taheri_spillover"))
        assertEquals(CustomerSource.other, CustomerSource.of("other"))
        assertEquals("slip_sent", WebsitePaymentStatus.of("slip_sent").rawValue)
        for (status in listOf("received", "ready", "collected", "cancelled", "x")) {
            assertEquals(status, RepairStatus.of(status).rawValue)
        }
        for (karat in listOf("12k", "18k", "21k", "22k", "24k", "9k")) {
            assertEquals(karat, KaratValue.of(karat).rawValue)
        }
    }

    @Test
    fun testCollectionNames() {
        assertEquals("app_settings", Collections.settings)
        assertEquals("global", Collections.globalSettingsDoc)
        assertEquals("hisaab", Collections.hisaab)
        assertEquals("given_items", Collections.givenItems)
        assertEquals("additional_revenue", Collections.additionalRevenue)
        assertEquals("karigar_jobs", Collections.karigarJobs)
        assertEquals("sold_products", Collections.soldProducts)
        assertEquals("repairs", Collections.repairs)
        assertEquals("order_photos", Collections.orderPhotos)
    }

    @Test
    fun testEmptyDocumentsDecodeEverywhere() {
        assertEquals("", decode<Invoice>("{}").id)
        assertEquals(OrderStatus.unknown(""), decode<Order>("{}").status)
        assertEquals("", decode<Customer>("{}").name)
        assertEquals("", decode<Product>("{}").sku)
        assertEquals("", decode<Karigar>("{}").name)
        assertEquals(KarigarJobStatus.unknown(""), decode<KarigarJob>("{}").status)
        assertEquals(0.0, decode<HisaabEntry>("{}").cashDebit)
        assertEquals(0, decode<Repair>("{}").pieces.size)
        assertEquals(PaidBy.business, decode<Expense>("{}").paidBy)
        assertEquals(0.0, decode<AdditionalRevenue>("{}").amount)
        assertEquals(GivenItemStatus.unknown(""), decode<GivenItem>("{}").status)
        assertEquals("global", decode<Settings>("{}").id)
    }

    @Test
    fun testOneOddDocumentNeverEmptiesAList() {
        val json = """
            [{"id":"INV-1","customerName":"Sana Example","grandTotal":"1,000"}, "garbage", 42,
             {"id":"INV-2","items":{"0":{"sku":"A"}},"balanceDue":"7"}, null]
        """
        val invoices = ERPDecode.models<Invoice>(json)
        assertEquals(listOf("INV-1", "INV-2"), invoices.map { it.id })
        assertEquals(1_000.0, invoices[0].grandTotal)
        assertEquals("A", invoices[1].items.firstOrNull()?.sku)
        assertEquals(7.0, invoices[1].balanceDue)
    }

    @Test
    fun testDecodedModelsAreHashableAndIdentifiable() {
        val json = """{"id":"ORD-000009","status":"Pending","grandTotal":1000}"""
        val a = decode<Order>(json)
        val b = decode<Order>(json)
        assertEquals(a, b)
        assertEquals(1, setOf(a, b).size)
        assertEquals("ORD-000009", a.id)
    }

    @Test
    fun testDecodingFromFirestoreJSONObject() {
        // The app hands over a dictionary (FirestoreJSON); ERPDecode.model reads it the same way.
        val doc: Map<String, Any?> = mapOf("id" to "e-9", "amount" to "1,250", "category" to "Utilities", "paidBy" to "mina")
        val e = ERPDecode.model<Expense>(doc)
        assertEquals(1_250.0, e?.amount)
        assertEquals(PaidBy.mina, e?.paidBy)
    }
}
