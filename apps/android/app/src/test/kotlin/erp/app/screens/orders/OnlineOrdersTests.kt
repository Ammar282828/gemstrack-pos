package erp.app.screens.orders

import erp.core.Json
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

// OnlineOrdersLogic.swift and OnlineOrdersModels.swift: the inbox's words and small sums, and the answers read as
// leniently as the web reads them. Made-up names and amounts only.
class OnlineOrdersTests {
    private fun row(vararg changes: Pair<String, Any?>): OnlineOrderRow = OnlineOrderRow.from(
        mapOf(
            "id" to "ONL-1", "state" to "to_confirm", "placedAt" to "2026-10-12T05:00:00.000Z",
            "customer" to mapOf("name" to "Sana Demo", "phone" to "0300 1234567"),
            "delivery" to mapOf("address" to "House 1", "city" to "Lahore", "notes" to " Ring the bell "),
            "lines" to listOf(
                mapOf("key" to "k1", "description" to "Ruby ring (size 12)", "price" to 150_000.0, "image" to "https://x.test/a.jpg", "size" to " 12 "),
                mapOf("key" to "k2", "description" to "Chain", "price" to 50_000.0),
            ),
            "subtotal" to 200_000.0, "deliveryCharge" to 1_500.0, "grandTotal" to 201_500.0, "todayTotal" to 205_000.0,
        ) + changes,
    )!!

    @Test fun anAnswerIsReadLeniently() {
        val r = row()
        assertEquals("ONL-1", r.id)
        assertEquals("Sana Demo", r.customer.name)
        assertEquals(2, r.lines.size)
        assertEquals("12", r.lines[0].size)
        assertNull(r.lines[1].size)
        assertEquals("", r.lines[1].image)
        assertNull(r.customer.email)
        // A row of nothing at all is an empty row, not an error.
        val empty = OnlineOrderRow.from(emptyMap<String, Any?>())!!
        assertEquals("", empty.id)
        assertEquals(0.0, empty.grandTotal)
        assertTrue(empty.lines.isEmpty())
        assertNull(empty.todayTotal)
    }

    @Test fun theInboxDropsRowsWithNoId() {
        val answer = OnlineOrdersAnswer.from(Json.parse("""{"orders":[{"id":"ONL-1","state":"to_confirm"},{"state":"confirmed"},"junk",{"id":"ONL-2","state":"declined"}]}"""))!!
        assertEquals(listOf("ONL-1", "ONL-2"), answer.orders.map { it.id })
        assertTrue(OnlineOrdersLogic.isWaiting(answer.orders[0]))
        assertFalse(OnlineOrdersLogic.isWaiting(answer.orders[1]))
        assertTrue(OnlineOrdersLogic.isWaiting(row("state" to "confirming")))
    }

    @Test fun aPreviewDefaultsToSending() {
        val p = OnlinePreview.from(Json.parse("""{"move":"confirm","ref":"ONL-1","name":"Sana","to":"923001234567","text":"Hello","holdUntil":"2026-10-13T05:00:00.000Z"}"""))!!
        assertTrue(p.sends)
        assertEquals("confirm", p.move)
        assertNull(p.booking)
        val paid = OnlinePreview.from(Json.parse("""{"move":"transfer_received","sends":false,"booking":{"advance":200000,"deliveryRevenue":1500,"total":201500}}"""))!!
        assertFalse(paid.sends)
        assertEquals(OnlineBooking(200_000.0, 1_500.0, 201_500.0), paid.booking)
    }

    @Test fun thePiecesNameLosesTheSizeTheSiteAppends() {
        assertEquals("Ruby ring", OnlineOrdersLogic.pieceName("Ruby ring (size 12)"))
        assertEquals("Ruby ring (size )", OnlineOrdersLogic.pieceName("Ruby ring (size )"))
        assertEquals("Ruby (size 1) ring (size 2)", OnlineOrdersLogic.pieceName("Ruby (size 1) ring (size 2)"))
        assertEquals("Chain", OnlineOrdersLogic.pieceName("Chain"))
        assertEquals("Chain (gold)", OnlineOrdersLogic.pieceName("Chain (gold)"))
    }

    @Test fun sizesAndPiecesAreSaidTheWebsWay() {
        assertEquals("12", OnlineOrdersLogic.sizes(row()))
        assertEquals("none asked", OnlineOrdersLogic.sizes(row("lines" to emptyList<Any>())))
        assertEquals("piece", OnlineOrdersLogic.pieces(1))
        assertEquals("3 pieces", OnlineOrdersLogic.pieces(3))
    }

    @Test fun todaysRateIsSaidFromHalfAPercent() {
        val r = row()
        val m = OnlineOrdersLogic.moved(r)!!
        assertEquals(3_500.0, m.amount)
        assertEquals("At today's rate it is PKR 205,000 (+PKR 3,500, +1.7%). Confirming holds their price.", OnlineOrdersLogic.movedLine(r))
        assertEquals(205_000.0, OnlineOrdersLogic.dearerToday(r))
        // Cheaper today: said, but not offered as "Today it would be".
        val cheaper = row("todayTotal" to 190_000.0)
        assertEquals("At today's rate it is PKR 190,000 (−PKR 11,500, -5.7%). Confirming holds their price.", OnlineOrdersLogic.movedLine(cheaper))
        assertNull(OnlineOrdersLogic.dearerToday(cheaper))
        // Under half a percent says nothing; no rate says nothing.
        assertNull(OnlineOrdersLogic.movedLine(row("todayTotal" to 201_600.0)))
        assertNull(OnlineOrdersLogic.movedLine(row("todayTotal" to null)))
        assertNull(OnlineOrdersLogic.moved(row("todayTotal" to null)))
    }

    @Test fun theConfirmationSaysWhatHappensAndHowLongTheyHave() {
        val r = row()
        assertEquals(
            "It becomes an order in the book for Sana Demo, labelled Online, with its 2 pieces at the prices they were quoted. " +
                "They are told on WhatsApp, and you send them your bank details there; they have 24 hours to transfer PKR 201,500.",
            OnlineOrdersLogic.confirmWords(r, null),
        )
        val held = OnlineOrdersLogic.confirmWords(r, "2026-10-06T09:30:00.000Z")
        assertTrue(held.contains("they have until "), held)
        assertTrue(held.contains("2:30 pm to transfer PKR 201,500."), held)
        assertEquals("24 hours", OnlineOrdersLogic.holdWords("nonsense"))
    }

    @Test fun aMoveSaysWhetherTheWhatsAppWent() {
        assertEquals(OnlineTold("Declined.", true), OnlineOrdersLogic.told(null, "Sana", "Declined."))
        assertEquals(OnlineTold("Declined.", true), OnlineOrdersLogic.told("", "Sana", "Declined."))
        assertEquals(
            OnlineTold("Done, but the WhatsApp did not send (no number): tell Sana yourself.", false),
            OnlineOrdersLogic.told("no number", "Sana", "Declined."),
        )
    }

    @Test fun theBankDetailsOpenTheChatWithTheAmountWrittenIn() {
        val url = OnlineOrdersLogic.bankDetailsUrl("0300 1234567", "Sana Demo", "ONL-1", 201_500.0)!!
        assertEquals(
            "https://wa.me/923001234567?text=Assalamualaikum%20Sana%20Demo%2C%20your%20order%20ONL-1%20is%20confirmed.%20The%20amount%20is%20Rs%20201%2C500.%20Please%20transfer%20it%20to%3A%0A",
            url,
        )
        assertNull(OnlineOrdersLogic.bankDetailsUrl("", "Sana", "ONL-1", 1.0))
        assertEquals("Rs 201,500", OnlineOrdersLogic.rs(201_500.0))
    }

    @Test fun componentsAreEncodedAsEncodeURIComponentDoes() {
        assertEquals("ONL-1", OnlineOrdersLogic.component("ONL-1"))
        assertEquals("a%20b%26c%3Dd", OnlineOrdersLogic.component("a b&c=d"))
        assertEquals("it's!~*()", OnlineOrdersLogic.component("it's!~*()"))
        assertEquals("%D8%B3", OnlineOrdersLogic.component("س"))
    }

    @Test fun placedAtIsSaidRelativelyInWholeUnits() {
        val now = Instant.parse("2026-10-12T07:00:00Z")
        assertEquals("2 hours ago", OnlineOrdersLogic.ago("2026-10-12T05:00:00.000Z", now))
        assertEquals("1 hour ago", OnlineOrdersLogic.ago("2026-10-12T05:30:00.000Z", now))
        assertEquals("30 minutes ago", OnlineOrdersLogic.ago("2026-10-12T06:30:00.000Z", now))
        assertEquals("3 days ago", OnlineOrdersLogic.ago("2026-10-09T05:00:00.000Z", now))
        assertEquals("in 2 hours", OnlineOrdersLogic.ago("2026-10-12T09:00:00.000Z", now))
        assertEquals("now", OnlineOrdersLogic.ago("2026-10-12T07:00:00.000Z", now))
        assertEquals("", OnlineOrdersLogic.ago("nonsense", now))
    }

    @Test fun anAccountIsNamedWithoutItsDomain() {
        assertEquals("sana", OnlineOrdersLogic.who("sana@example.com"))
        assertNull(OnlineOrdersLogic.who("dev-bypass"))
        assertNull(OnlineOrdersLogic.who(""))
        assertNull(OnlineOrdersLogic.who(null))
    }

    @Test fun aDeclineNeedsThreeCharactersAndKeepsThreeHundred() {
        assertFalse(OnlineOrdersLogic.reasonReady("  ab "))
        assertTrue(OnlineOrdersLogic.reasonReady(" abc "))
        assertEquals(300, OnlineOrdersLogic.reasonLimit)
        assertEquals(4, OnlineOrdersLogic.reasons.size)
    }

    @Test fun theStoreSaysTheGatesRefusalsInTheWebsWords() {
        assertEquals("Sign in with Google to act on online orders.", OnlineOrdersStore.say(erp.app.data.ErpApi.Failure(401, "x")))
        assertEquals("Only owner and staff accounts can act on online orders.", OnlineOrdersStore.say(erp.app.data.ErpApi.Failure(403, "x")))
        assertEquals("Already confirmed.", OnlineOrdersStore.say(erp.app.data.ErpApi.Failure(409, "Already confirmed.")))
    }
}
