package erp.app.shots

import erp.app.ErpApp
import erp.app.data.Book
import erp.core.Registry
import erp.core.models.Karigar
import erp.core.models.Order
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Made-up orders in the odd shapes the ERP's Firestore really holds (numbers as text, pieces as a map, unknown words,
 * missing and non-ISO dates, duplicate and empty ids, blank and exotic names): each must draw, on the hub and as a page.
 * No real data: every name, phone and amount here is invented.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class SyntheticOrdersTest(config: ShotConfig) : OrderSweepBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return listOf(arrayOf<Any>(ShotConfig("phone-light", "w411dp-h891dp-notnight-xhdpi", dark = false)))
        }
    }

    @Before fun today() { erp.app.ui.AppClock.pinned = java.time.Instant.parse("2026-10-15T09:00:00Z") }

    private fun piece(vararg more: Pair<String, Any?>): Map<String, Any?> = mapOf(
        "description" to "Test ring", "itemCategory" to "ring", "metalType" to "Gold", "karat" to "21k",
        "estimatedWeightG" to 5.5, "wastagePercentage" to 8, "makingCharges" to 1000, "totalEstimate" to 120000, "metalCost" to 100000,
    ) + more

    private fun order(id: String, vararg more: Pair<String, Any?>): Order = Book.decodeDoc(
        Registry.decoder(Order::class), id,
        mapOf(
            "status" to "In Progress", "createdAt" to "2026-10-01T06:00:00.000Z", "promisedDate" to "2026-10-20",
            "customerName" to "Test Customer", "customerContact" to "+920000000000", "items" to listOf(piece()),
            "grandTotal" to 120000, "advancePayment" to 20000, "takenBy" to "Tester",
        ) + more,
    )

    /** One order per odd shape. */
    private fun shapes(): List<Order> = listOf(
        order("T-ITEMS-MAP", "items" to mapOf("0" to piece(), "1" to piece("description" to "Second"))),
        order("T-STRINGS", "advancePayment" to "20,000", "grandTotal" to "120000", "discountAmount" to "500",
            "items" to listOf(piece("estimatedWeightG" to "5.5", "wastagePercentage" to "8", "totalEstimate" to "120,000", "size" to "14.5", "isCompleted" to "false"))),
        order("T-STATUS-UNKNOWN", "status" to "On Hold"),
        order("T-STATUS-BLANK", "status" to ""),
        order("T-DATES-NULL", "createdAt" to null, "promisedDate" to null),
        order("T-DATES-JUNK", "createdAt" to "garbage", "promisedDate" to "10-10-2026"),
        order("T-DATES-NUMBER", "createdAt" to 1760000000, "promisedDate" to 1760000000),
        order("T-DATES-OLD", "createdAt" to "1970-01-01T00:00:00.000Z", "promisedDate" to "0001-01-01"),
        order("T-ITEMS-EMPTY", "items" to emptyList<Any>()),
        order("T-ITEMS-JUNK", "items" to listOf(null, "text", 5, piece())),
        order("T-ITEMS-DUP", "items" to listOf(piece("id" to "a"), piece("id" to "a"))),
        order("T-NEGATIVE", "items" to listOf(piece("estimatedWeightG" to -3, "stoneWeightG" to -1, "totalEstimate" to -500)), "grandTotal" to -500, "advancePayment" to -1),
        order("T-HUGE", "items" to listOf(piece("estimatedWeightG" to 1e300, "totalEstimate" to 1e300)), "grandTotal" to 1e300, "advancePayment" to 1e308),
        order("T-NAN", "items" to listOf(piece("estimatedWeightG" to "NaN", "totalEstimate" to "Infinity")), "advancePayment" to "NaN"),
        order("T-NAMES", "customerName" to ""),
        order("T-NAME-RTL", "customerName" to "طاہری صاحب", "customerContact" to "03xx abc"),
        order("T-NAME-EMOJI", "customerName" to "💍", "customerContact" to ""),
        order("T-NAME-NULL", "customerName" to null, "customerContact" to null),
        order("T-KARIGAR-MISSING", "items" to listOf(piece("karigarId" to "nobody", "givenAt" to "junk"))),
        order("T-KARIGAR-NUMBER", "items" to listOf(piece("karigarId" to 7, "givenAt" to 1760000000))),
        order("T-DELIVERY-STRING", "delivery" to "Lahore", "notes" to "Leave with the guard"),
        order("T-DELIVERY-LIST", "delivery" to listOf("a", "b")),
        order("T-SOURCE-UNKNOWN", "source" to "tiktok", "website" to mapOf("total" to "x")),
        order("T-ADVANCES-MAP", "advances" to mapOf("0" to mapOf("amount" to "5000", "date" to "junk", "method" to "Barter")), "advanceMethod" to "Barter"),
        order("T-EXCHANGES", "exchanges" to mapOf("0" to mapOf("description" to "Old chain", "value" to "30000")), "advanceInExchangeValue" to "30000"),
        order("T-NOTES-LONG", "notes" to "x".repeat(20000)),
        order("T-ID-ODD", "items" to listOf(piece())).let { it }, // plain id below
        order("T ODD/ID#1"),
        order("T-STONES", "items" to listOf(piece("stoneWeightG" to "0.5", "stoneDetails" to " ", "diamondDetails" to "", "adminNote" to "  note ", "hasStones" to "yes"))),
        order("T-MANUAL", "items" to listOf(piece("isManualPrice" to true, "manualPrice" to null, "totalEstimate" to null))),
        order("T-INVOICED", "invoiceId" to "INV-MISSING"),
        order("T-EMPTY-ALL", "items" to null, "status" to null, "grandTotal" to null, "advancePayment" to null),
    )

    @Test fun every_odd_shape_decodes_and_runs_the_logic() {
        val b = SweepBooks(shapes(), karigars = listOf(Book.decodeDoc(Registry.decoder(Karigar::class), "k1", mapOf("name" to "Test Karigar"))))
        val f = sweepLogic(b)
        check(f.isEmpty()) { f.joinToString("\n") }
    }

    @Test fun every_odd_shape_draws_hub_and_page() {
        val b = SweepBooks(shapes())
        val (ok, f) = sweepPages(b)
        println("SYNTHETIC PAGES: ${b.orders.size} shapes, $ok drawn, ${f.size} failures")
        f.forEach { println("FAIL $it") }
        check(f.isEmpty()) { f.joinToString("\n") }
    }
}
