package erp.app

import erp.app.data.ErpApi
import erp.app.data.JsonText
import erp.app.data.RequestIds
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ErpApiTests {
    private var clock = 1_000_000L
    private var next = 0
    private fun ids() = RequestIds(now = { clock }, newId = { "id-${next++}" })

    private val payment = mapOf("op" to "addPayment", "invoiceId" to "INV-1", "amount" to 5000, "method" to "Cash", "date" to "2026-10-12T10:00:00.000Z")

    @Test fun theSameChangeWithinHalfAMinuteGoesWithTheSameName() {
        val r = ids()
        val a = r.idFor(payment)
        clock += 10_000
        assertEquals(a, r.idFor(payment))
    }

    @Test fun whenIsNotPartOfWhatTheChangeIs() {
        val r = ids()
        val a = r.idFor(payment)
        clock += 1_000
        assertEquals(a, r.idFor(payment + mapOf("date" to "2026-10-12T10:00:01.000Z", "createdAt" to "x", "at" to 1, "now" to 2)))
        assertEquals(a, r.idFor(payment - "date"))
    }

    @Test fun aDifferentChangeIsAnotherName() {
        val r = ids()
        val a = r.idFor(payment)
        assertNotEquals(a, r.idFor(payment + ("amount" to 5001)))
        assertNotEquals(a, r.idFor(payment + ("op" to "refund")))
    }

    @Test fun afterHalfAMinuteItIsAGenuinelySeparatePayment() {
        val r = ids()
        val a = r.idFor(payment)
        clock += RequestIds.WINDOW_MS
        assertNotEquals(a, r.idFor(payment))
    }

    @Test fun theWindowSlidesWithEachUse() {
        val r = ids()
        val a = r.idFor(payment)
        clock += 25_000
        assertEquals(a, r.idFor(payment))
        clock += 25_000
        assertEquals(a, r.idFor(payment), "asked again 25 s after the last ask")
    }

    @Test fun keyOrderAtAnyLevelDoesNotChangeTheName() {
        val r = ids()
        val a = r.idFor(linkedMapOf("op" to "x", "a" to linkedMapOf("p" to 1, "q" to listOf(linkedMapOf("m" to 1, "n" to 2)))))
        val b = r.idFor(linkedMapOf("a" to linkedMapOf("q" to listOf(linkedMapOf("n" to 2, "m" to 1)), "p" to 1), "op" to "x"))
        assertEquals(a, b)
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
