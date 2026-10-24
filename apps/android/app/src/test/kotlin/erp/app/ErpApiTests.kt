package erp.app

import erp.app.data.ErpApi
import erp.app.data.JsonText
import erp.app.data.OutboxEngine
import erp.app.data.WriteIntents
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ErpApiTests {
    private var clock = 1_000_000_000L
    private var next = 0
    private var disk: String? = null
    private fun intents() = WriteIntents({ disk }, { disk = it }, now = { clock }, newId = { "id-${next++}" })

    private val payment = mapOf("op" to "recordPayment", "invoiceId" to "INV-1", "amount" to 5000, "method" to "Cash", "date" to "2026-10-12T10:00:00.000Z")

    private fun nameOf(w: WriteIntents, body: Map<String, Any?>) = w.id(w.key(body))

    @Test fun theSameChangeAskedAgainGoesWithTheSameName() {
        val w = intents()
        val a = nameOf(w, payment)
        clock += 10_000
        assertEquals(a, nameOf(w, payment))
    }

    @Test fun theNameSurvivesATimeoutAndARelaunch() {
        val a = nameOf(intents(), payment)
        // The app was killed and opened again: a new object over the same file.
        clock += 20 * 3600_000L
        assertEquals(a, nameOf(intents(), payment), "twenty hours later, still unanswered")
    }

    @Test fun whenIsNotPartOfWhatTheChangeIs() {
        val w = intents()
        val a = nameOf(w, payment)
        clock += 1_000
        assertEquals(a, nameOf(w, payment + mapOf("date" to "2026-10-12T10:00:01.000Z", "createdAt" to "x", "at" to 1, "now" to 2, "requestId" to "other")))
        assertEquals(a, nameOf(w, payment - "date"))
    }

    @Test fun aDifferentChangeIsAnotherName() {
        val w = intents()
        val a = nameOf(w, payment)
        assertNotEquals(a, nameOf(w, payment + ("amount" to 5001)))
        assertNotEquals(a, nameOf(w, payment + ("op" to "refund")))
    }

    @Test fun anAnsweredChangeForgetsItsNameSoTheNextPaymentIsItsOwn() {
        val w = intents()
        val key = w.key(payment)
        val a = w.id(key)
        w.clear(key)
        assertEquals(0, w.held())
        assertNotEquals(a, w.id(key), "a second, separate payment of the same amount")
    }

    @Test fun aNameIsForgottenAfterADay() {
        val w = intents()
        val a = nameOf(w, payment)
        clock += (WriteIntents.KEEP_SECONDS + 1) * 1000
        assertNotEquals(a, nameOf(w, payment))
    }

    @Test fun usingANameRenewsItsDay() {
        val w = intents()
        val a = nameOf(w, payment)
        clock += 20 * 3600_000L
        assertEquals(a, nameOf(w, payment))
        clock += 20 * 3600_000L
        assertEquals(a, nameOf(w, payment), "asked again 20 hours after the last ask")
    }

    @Test fun keyOrderAtAnyLevelDoesNotChangeTheName() {
        val w = intents()
        val a = nameOf(w, linkedMapOf("op" to "x", "a" to linkedMapOf("p" to 1, "q" to listOf(linkedMapOf("m" to 1, "n" to 2)))))
        val b = nameOf(w, linkedMapOf("a" to linkedMapOf("q" to listOf(linkedMapOf("n" to 2, "m" to 1)), "p" to 1), "op" to "x"))
        assertEquals(a, b)
    }

    @Test fun aNameIsAnIdTheServerAccepts() {
        // idempotency.ts REQUEST_ID: letters, digits and dashes, 8 to 64.
        val id = nameOf(WriteIntents({ null }, {}), payment)
        assertEquals(true, Regex("^[A-Za-z0-9-]{8,64}$").matches(id))
    }

    @Test fun everyMoneyOpOfTheErpIsHeldToTheOutbox() {
        // src/app/api/app/write/idempotency.ts MONEY_OP_NAMES, copied: an op there must never be queued.
        val server = listOf(
            "recordPayment", "recordOrderAdvance", "createInvoice", "createOrder", "finalizeOrder",
            "addRepair", "recordRepairPayment", "addExpense", "addHisaabEntry", "addShareholderEntry", "addExtraRevenue",
            "updateInvoiceDiscount", "refundInvoicePartial", "payBackCredit", "settleInvoicePayment", "settleOrderAdvance", "raiseOrderDiscount",
            "startPayBatch", "settlePayBatch",
        )
        assertEquals(emptyList(), server.filter { it !in OutboxEngine.moneyOps })
    }

    @Test fun sortedTextIsStableAndWholeNumbersAreIntegers() {
        assertEquals("""{"a":1,"b":[2.5,true,null,"x"]}""", JsonText.of(mapOf("b" to listOf(2.5, true, null, "x"), "a" to 1.0), sorted = true))
        assertNull(JsonText.of(mapOf("a" to Double.NaN)))
        assertNull(JsonText.of(mapOf("a" to Any())))
    }

    @Test fun onlyTheErpsOwnHostIsEverAsked() {
        val base = "https://erp.example.test"
        assertEquals("https://erp.example.test/api/app/me", ErpApi.resolve(base, "/api/app/me")?.toString())
        assertEquals("https://erp.example.test/api/x?y=1", ErpApi.resolve(base, "/api/x?y=1")?.toString())
        assertEquals("https://erp.example.test/a", ErpApi.resolve(base, "https://erp.example.test/a")?.toString())
        assertNull(ErpApi.resolve(base, "https://evil.example.test/api/app/me"))
        assertNull(ErpApi.resolve(base, "http://erp.example.test/api/app/me"))
        assertNull(ErpApi.resolve(base, "//evil.example.test/api"))
        assertNull(ErpApi.resolve(base, "https://erp.example.test@evil.example.test/"))
        assertNull(ErpApi.resolve(base, "https://erp.example.test.evil.example.test/"))
    }

    @Test fun aRefusalSaysWhatTheErpSaid() {
        assertEquals("Wrong code", ErpApi.said("""{"error":"Wrong code"}"""))
        assertNull(ErpApi.said("""{"error":""}"""))
        assertNull(ErpApi.said("<html>502</html>"))
        assertNull(ErpApi.said("""{"ok":true}"""))
    }

    @Test fun onlyTheErpsOwnApiRoutesAreFollowedUp() {
        val out = mapOf(
            "ok" to true,
            "followUps" to listOf(
                mapOf("path" to "/api/notify/whatsapp", "body" to mapOf("id" to "INV-1")),
                mapOf("path" to "https://evil.example.test/api/x", "body" to mapOf("id" to 1)),
                mapOf("path" to "/orders", "body" to mapOf<String, Any?>()),
                mapOf("path" to "/api/no-body"),
                "not a map",
            ),
        )
        val f = ErpApi.followUps(out)
        assertEquals(listOf("/api/notify/whatsapp"), f.map { it.first })
        assertEquals(mapOf("id" to "INV-1"), f.single().second)
        assertEquals(emptyList(), ErpApi.followUps(mapOf("ok" to true)))
        assertNotNull(f)
    }
}
