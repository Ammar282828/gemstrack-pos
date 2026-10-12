package erp.app.screens.neworder

import erp.app.data.Demo
import erp.core.entry.EntryHouse
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderEdit
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderPieceDraft
import erp.core.entry.NewOrderScanAnswer
import erp.core.entry.NewOrderScanItem
import erp.core.entry.NewOrderSizes
import erp.core.entry.NewOrderSlip
import erp.core.entry.editRequest
import erp.core.entry.fillFromSlip
import erp.core.models.Customer
import erp.core.models.Karigar
import erp.core.models.Order
import erp.core.models.Settings
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NewOrderPhotoCodecTests {
    @Test fun aPictureIsShrunkToAThousandOnItsLongerSideAndNeverGrown() {
        assertEquals(1000 to 750, NewOrderPhotoCodec.scaled(4000, 3000))
        assertEquals(750 to 1000, NewOrderPhotoCodec.scaled(3000, 4000))
        assertEquals(640 to 480, NewOrderPhotoCodec.scaled(640, 480))
        assertEquals(2200 to 1100, NewOrderPhotoCodec.scaled(4400, 2200, longest = 2200))
        assertNull(NewOrderPhotoCodec.scaled(0, 0))
    }

    @Test fun theQualityStepsDownUntilItFitsTheBudget() {
        // fits at once
        assertEquals(82, NewOrderPhotoCodec.quality { 50_000 })
        // too big at 82 and 70, fits at 60
        assertEquals(60, NewOrderPhotoCodec.quality { q -> if (q >= 70) 200_000 else 100_000 })
        // never fits: the last resort
        assertEquals(35, NewOrderPhotoCodec.quality { 500_000 })
        assertEquals(120 * 1024, NewOrderPhotoCodec.budget)
    }
}

class NewOrderScanLogicTests {
    private fun item(extra: NewOrderScanItem.() -> Unit): NewOrderScanItem = NewOrderScanItem().apply(extra)

    @Test fun aPieceWithAHisaabSaysSoAndShowsItsFigures() {
        val it = item {
            description = "Ruby ring"; itemCategory = "Ring"; karat = 21.0; weightG = 5.2
            ratePerGram = 26000.0; wastagePercent = 10.0; stoneWeightG = 0.4; makingCharges = 3000.0; size = "10"; photoIndex = 2.0
        }
        val bits = NewOrderScanLogic.pieceBits(it, photoCount = 2)
        assertEquals("Hisaab on the slip", bits[0])
        assertTrue(bits.contains("Ring"))
        assertTrue(bits.contains("21k"))
        assertTrue(bits.contains("5.2 g"))
        assertTrue(bits.contains("@ 26,000/g"))
        assertTrue(bits.contains("wastage 10%"))
        assertTrue(bits.contains("less 0.4 g stone"))
        assertTrue(bits.contains("making 3,000"))
        assertTrue(bits.contains("Size 10"))
        assertTrue(bits.contains("photo 2"))
        // one photo needs no number
        assertTrue(NewOrderScanLogic.pieceBits(it, photoCount = 1).none { b -> b.startsWith("photo") })
    }

    @Test fun aFigureWithoutAWeightIsAFixedPriceAndTolaIsSaid() {
        assertEquals(listOf("Figure only: a fixed price"), NewOrderScanLogic.pieceBits(item { lineTotal = 150000.0 }, 1))
        val tola = NewOrderScanLogic.pieceBits(item { weightG = 11.664; weightWasTola = true }, 1)
        assertTrue(tola.contains("11.664 g (1.000 tola on the slip)"), tola.toString())
    }

    @Test fun theFootOnlyAppearsWhenTheSlipHasOne() {
        assertEquals(false, NewOrderScanLogic.hasFoot(NewOrderScanAnswer()))
        assertEquals(true, NewOrderScanLogic.hasFoot(NewOrderScanAnswer(advancePayment = 5000.0)))
        assertEquals(true, NewOrderScanLogic.hasFoot(NewOrderScanAnswer(notes = "Rush")))
        assertEquals("1 piece", NewOrderScanLogic.piecesTitle(1))
        assertEquals("3 pieces", NewOrderScanLogic.piecesTitle(3))
    }

    @Test fun theReadingFillsTheDraftThroughTheCoresOwnRules() {
        EntryHouse.id = "taheri"
        val answer = NewOrderScanAnswer(
            items = listOf(NewOrderScanItem(description = "Gold bangle", metalType = "gold", karat = 22.0, weightG = 10.0, ratePerGram = 27000.0, lineTotal = 297000.0, wastagePercent = 10.0)),
            customerNameHeard = "Sana Demo", advancePayment = 50000.0,
        )
        val d = NewOrderDraft.fresh()
        d.fillFromSlip(answer, customer = null, heardCustomer = "Sana Demo", karigarId = "", photos = listOf(byteArrayOf(1)), fallbackMetal = "gold", settings = null)
        assertEquals("Sana Demo", d.customerName)
        assertEquals(1, d.pieces.size)
        assertEquals("50000", d.advance)
        assertEquals("27000", d.rates["goldRatePerGram22k"])
        assertTrue(d.pieces[0].photo!!.contentEquals(byteArrayOf(1)))
        assertNotNull(NewOrderSlip.check(answer))
    }
}

/** The demo books go through the order screens' rules: opened for edit, rebuilt as a request, offered their sizes. */
class DemoNewOrderTests {
    private val now = Instant.parse("2026-10-12T05:00:00Z")

    private val docs: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private val orders: List<Order> by lazy { docs["orders"].orEmpty().map { Order.fromMap(it) } }
    private val customers: List<Customer> by lazy { docs["customers"].orEmpty().map { Customer.fromMap(it) } }
    private val karigars: List<Karigar> by lazy { docs["karigars"].orEmpty().map { Karigar.fromMap(it) } }
    private val settings: Settings by lazy { Settings.fromMap(docs["app_settings"].orEmpty().first()) }

    @Test fun theDemoHasOrdersAndPeopleToWorkWith() {
        assertTrue(orders.size >= 3)
        assertTrue(customers.size >= 3)
    }

    @Test fun everyDemoOrderOpensForEditAndBuildsItsRequest() {
        EntryHouse.id = "taheri"
        val people = NewOrderMath.people(customers)
        for (o in orders) {
            val edit = NewOrderEdit(o)
            val d = edit.draft
            // every step's words and the totals work from what is on file
            NewOrderLogic.stepStates(d)
            val totals = NewOrderMath.totals(d, settings)
            assertEquals(d.pieces.size, totals.prices.size)
            d.pieces.forEach { NewOrderLogic.pieceSpec(it) }
            NewOrderLogic.rateBoxes(d)
            NewOrderLogic.ratesDiffer(d, settings)
            NewOrderLogic.knownAddresses(d.customerId, customers, orders, emptyList())
            NewOrderLogic.reviewFigures(totals)
            val request = NewOrderMath.editRequest(d, edit, settings, people)
            assertEquals(o.id, request["orderId"])
            assertNotNull(request["order"])
        }
    }

    @Test fun aNewOrderForADemoCustomerBuildsAndOffersItsSize() {
        EntryHouse.id = "taheri"
        val sana = customers.first()
        val d = NewOrderDraft.fresh()
        d.seedRates(settings)
        d.choose(sana)
        val p = NewOrderPieceDraft()
        p.description = "Solitaire ring"
        p.category = "cat001"
        p.size = "11.5"
        p.weight = "4"
        d.pieces.add(p)
        assertNull(NewOrderMath.problem(d))
        val request = NewOrderMath.request(d, settings, NewOrderMath.people(customers))
        assertNotNull(request["order"])
        val offered = NewOrderSizes.offer(d, sana.id, sana, houseWants = true)
        assertTrue(offered.isEmpty() || offered.all { it.value == "11.5" })
        assertTrue(NewOrderSizes.offer(d, sana.id, sana, houseWants = false).isEmpty())
        assertEquals(sana.name, d.customerName)
        // the people the screen offers are never the placeholder
        assertTrue(NewOrderMath.people(customers).none { it.name.startsWith("Walk-in") })
        assertTrue(karigars.isNotEmpty())
    }
}
