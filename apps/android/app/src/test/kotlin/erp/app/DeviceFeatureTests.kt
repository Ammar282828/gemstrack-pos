package erp.app

import erp.app.device.PushLogic
import erp.app.nav.AppRouter
import erp.app.screens.voice.VoiceCard
import erp.app.screens.voice.VoiceHandoff
import erp.app.screens.voice.VoiceLogic
import erp.app.screens.voice.VoicePlan
import erp.app.widget.ErpWidgetUrl
import erp.app.widget.Freshness
import erp.app.widget.WidgetLayout
import erp.app.widget.WidgetLinkData
import erp.app.widget.WidgetSize
import erp.app.widget.WidgetSummary
import erp.core.Json
import erp.core.models.Customer
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Notifications, the widget and voice: the parts that are plain Kotlin (docs/features/android-app.md, "Device").

class PushLogicTests {
    @Test fun `a phone registers with the iPhone's body and its platform named`() {
        val body = PushLogic.registerBody("tok", "shop.taheri.erp", "Pixel 9")
        assertEquals(mapOf("token" to "tok", "platform" to "android", "bundleId" to "shop.taheri.erp", "label" to "Pixel 9"), body)
        assertEquals(mapOf("token" to "tok"), PushLogic.unregisterBody("tok"))
    }

    @Test fun `the four channels are the push kinds the server names`() {
        assertEquals(listOf("sales", "payments", "orders", "karigar"), PushLogic.channels.map { it.id })
        assertEquals(listOf("Sales", "Payments", "Orders", "Karigar work"), PushLogic.channels.map { it.name })
        assertEquals("karigar", PushLogic.channelFor("karigar"))
        assertEquals("orders", PushLogic.channelFor("something-new"))
        assertEquals("orders", PushLogic.channelFor(null))
    }

    @Test fun `a tapped notification opens its path and nothing else`() {
        assertEquals("/orders/ORD-000123", PushLogic.pathFor("/orders/ORD-000123"))
        assertEquals("/invoices?tab=due", PushLogic.pathFor(" /invoices?tab=due "))
        assertNull(PushLogic.pathFor(""))
        assertNull(PushLogic.pathFor(null))
        assertNull(PushLogic.pathFor("orders/1"))
        assertNull(PushLogic.pathFor("https://elsewhere.example/x"))
        assertNull(PushLogic.pathFor("//elsewhere.example/x"))
    }

    @Test fun `the server's ERP links and the app's own address still resolve to paths`() {
        assertEquals("/orders/ORD-1?x=1", AppRouter.pathFor("https", "erp.taheri.shop", "/orders/ORD-1", "x=1", "erp.taheri.shop"))
        assertEquals("/orders/ORD-1", AppRouter.pathFor("erp", "orders", "/ORD-1", null, "erp.taheri.shop"))
        assertNull(AppRouter.pathFor("https", "evil.example", "/orders", null, "erp.taheri.shop"))
    }
}

class WidgetSummaryTests {
    private val json = """{"house":"Taheri","updated":"4:05 pm","asOf":"2026-10-12","teamNote":"Confirm collections",
        "figures":[{"label":"Made today","value":"Rs 3.12 lac","detail":"revenue"},{"label":"This month","value":"Rs 28.4 lac","detail":"revenue"},
        {"label":"Due","value":"6","detail":null},{"label":"Broken"},{"value":"1"}]}"""

    @Test fun `the route's answer decodes, a bad figure is skipped and a missing detail is none`() {
        val s = assertNotNull(WidgetSummary.decode(json))
        assertEquals("Taheri", s.house)
        assertEquals("4:05 pm", s.updated)
        assertEquals("2026-10-12", s.asOf)
        assertEquals("Confirm collections", s.teamNote)
        assertEquals(listOf("Made today", "This month", "Due"), s.figures.map { it.label })
        assertNull(s.figures[2].detail)
        assertEquals("revenue", s.figures[0].detail)
    }

    @Test fun `what is not a summary decodes to nothing`() {
        assertNull(WidgetSummary.decode("not json"))
        assertNull(WidgetSummary.decode("""{"error":"Open the app and sign in again."}"""))
        assertNull(WidgetSummary.decode("[]"))
    }

    @Test fun `the room a launcher gives chooses the face`() {
        assertEquals(WidgetSize.Small, WidgetLayout.sizeFor(110f, 110f))
        assertEquals(WidgetSize.Small, WidgetLayout.sizeFor(160f, 160f))
        assertEquals(WidgetSize.Medium, WidgetLayout.sizeFor(250f, 110f))
        assertEquals(WidgetSize.Medium, WidgetLayout.sizeFor(250f, 160f))
        assertEquals(WidgetSize.Large, WidgetLayout.sizeFor(250f, 250f))
        assertEquals(WidgetSize.Small, WidgetLayout.sizeFor(110f, 400f))
    }

    @Test fun `each face shows what the iPhone's does`() {
        val s = WidgetSummary.sample("Taheri")
        val small = assertNotNull(WidgetLayout.plan(s, WidgetSize.Small))
        assertEquals("Made today", small.today.label)
        assertEquals("This month", small.month?.label)
        assertEquals(2, small.noteLines)
        assertTrue(small.compactHeader)
        assertTrue(small.supporting.isEmpty())
        val medium = assertNotNull(WidgetLayout.plan(s, WidgetSize.Medium))
        assertTrue(medium.noteBeside)
        assertEquals(3, medium.noteLines)
        assertTrue(medium.supporting.isEmpty())
        val large = assertNotNull(WidgetLayout.plan(s, WidgetSize.Large))
        assertEquals(listOf("Gold 24k", "In the drawer", "Owed to you", "Due"), large.supporting.map { it.label })
        assertEquals(2, large.columns)
    }

    @Test fun `a long figure is shrunk to its room, never below 60 percent, and a short one keeps its size`() {
        val s = WidgetSummary.sample()
        val roomy = assertNotNull(WidgetLayout.plan(s, WidgetSize.Large, widthDp = 340f))
        assertEquals(40f, roomy.heroSp)
        val narrow = assertNotNull(WidgetLayout.plan(s, WidgetSize.Small, widthDp = 110f))
        assertTrue(narrow.heroSp < 26f && narrow.heroSp >= 26f * 0.6f)
        val huge = WidgetSummary("Taheri", "1:00 pm", listOf(erp.app.widget.WidgetFigure("Made today", "Rs 12,345.67 crore", null)))
        assertEquals(26f * 0.6f, assertNotNull(WidgetLayout.plan(huge, WidgetSize.Small, widthDp = 110f)).heroSp, 0.001f)
        // beside a note the hero has half the width
        val beside = assertNotNull(WidgetLayout.plan(s, WidgetSize.Medium, widthDp = 340f))
        val alone = assertNotNull(WidgetLayout.plan(WidgetSummary("Taheri", "1:00 pm", s.figures), WidgetSize.Medium, widthDp = 340f))
        assertTrue(beside.heroSp <= alone.heroSp)
    }

    @Test fun `an empty or missing note is not shown, and no figures means to link the widget`() {
        val blank = WidgetSummary("Taheri", "1:00 pm", WidgetSummary.sample().figures, teamNote = "  \n")
        assertNull(WidgetLayout.plan(blank, WidgetSize.Medium)?.note)
        assertNull(WidgetLayout.plan(WidgetSummary("Taheri", "1:00 pm", emptyList()), WidgetSize.Small))
    }

    @Test fun `figures from another day carry the day`() {
        val now = Instant.parse("2026-10-13T05:00:00Z") // 10:00 in Karachi on the 13th
        val old = Freshness.of(WidgetSummary("Taheri", "4:05 pm", emptyList(), asOf = "2026-10-12"), now)
        assertTrue(old.stale)
        assertEquals("12 Oct · 4:05 pm", old.text)
        assertEquals("12 Oct", old.short)
        val today = Freshness.of(WidgetSummary("Taheri", "9:05 am", emptyList(), asOf = "2026-10-13"), now)
        assertFalse(today.stale)
        assertEquals("9:05 am", today.text)
        assertFalse(Freshness.of(WidgetSummary("Taheri", "9:05 am", emptyList()), now).stale)
        // 23:30 UTC is already the next day in Karachi
        val late = Freshness.of(WidgetSummary("Taheri", "4:05 pm", emptyList(), asOf = "2026-10-13"), Instant.parse("2026-10-12T23:30:00Z"))
        assertFalse(late.stale)
    }

    @Test fun `the widget's link round-trips and is asked for with its own scheme`() {
        val link = WidgetLinkData("https://erp.taheri.shop", "k-123", "Taheri ERP")
        val back = assertNotNull(WidgetLinkData.decode(link.encode()))
        assertEquals("k-123", back.key)
        assertEquals("https://erp.taheri.shop", back.url)
        assertEquals("Taheri ERP", back.house)
        assertNull(WidgetLinkData.decode(null))
        assertNull(WidgetLinkData.decode("""{"url":"x"}"""))
        assertEquals("Widget k-123", WidgetLinkData.authorization("k-123"))
        assertEquals(mapOf("label" to "Android widget"), WidgetLinkData.keyBody())
    }

    @Test fun `the summary is asked for only on the house's own https address`() {
        assertEquals("https://erp.taheri.shop/api/widget/summary", ErpWidgetUrl.summary("https://erp.taheri.shop", "erp.taheri.shop").toString())
        assertNull(ErpWidgetUrl.summary("http://erp.taheri.shop", "erp.taheri.shop"))
        assertNull(ErpWidgetUrl.summary("https://elsewhere.example", "erp.taheri.shop"))
    }
}

class VoiceLogicTests {
    private fun raw(text: String): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return Json.parse(text) as Map<String, Any?>
    }

    @Test fun `an answer with a page and a plan with steps decode`() {
        val answer = VoicePlan(raw("""{"answer":"Today's cash is Rs 1.2 lac.","href":"/today","cards":[]}"""), "what is in the drawer")
        assertEquals("/today", answer.href)
        assertTrue(answer.operations.isEmpty())
        assertTrue(answer.ready)

        val plan = VoicePlan(
            raw(
                """{"cards":[{"title":"record a PAYMENT","summary":"Rs 5,000 from Test Buyer","href":"/customers/c1",
                "operations":[{"op":"addPayment","fields":{"invoiceId":"INV-1","amount":5000}},{"op":"bad"}]},
                {"title":"expense","summary":"Tea","problem":"No amount heard","operations":[]}]}""",
            ),
            "x",
        )
        assertEquals(2, plan.cards.size)
        assertEquals(1, plan.operations.size)
        assertEquals("addPayment", plan.operations[0].op)
        assertEquals(5000, (plan.operations[0].fields["amount"] as Number).toInt())
        assertFalse(plan.ready)
        assertEquals("Review", VoiceCard(emptyMap()).title)
    }

    @Test fun `a card that wants a form stops the plan being ready`() {
        val plan = VoicePlan(raw("""{"cards":[{"title":"order","summary":"s","handoff":{"kind":"order","payload":{}}}]}"""), "w")
        assertFalse(plan.ready)
        assertEquals("order", VoiceHandoff.kind(plan.cards[0].handoff))
        assertNull(VoiceHandoff.kind(mapOf("kind" to "expense")))
        assertNull(VoiceHandoff.kind(null))
    }

    @Test fun `card headings are capitalised as the iPhone does`() {
        assertEquals("Record A Payment", VoiceLogic.heading("record a PAYMENT"))
        assertEquals("Review", VoiceLogic.heading("review"))
    }

    @Test fun `a recording is sent as it is, and words stand in only when it is empty or silent`() {
        val audio = ByteArray(5000) { 1 }
        val sent = assertNotNull(VoiceLogic.input(audio, peakAmplitude = 9000, liveWords = "pay five thousand"))
        assertEquals(setOf("audio"), sent.keys)
        assertEquals(java.util.Base64.getEncoder().encodeToString(audio), sent["audio"])
        // silent recording, words heard: the words go as text
        assertEquals(mapOf("text" to "pay five thousand"), VoiceLogic.input(audio, 10, "  pay five thousand "))
        // too small to be a recording
        assertEquals(mapOf("text" to "hello"), VoiceLogic.input(ByteArray(500), 9000, "hello"))
        // silent and nothing heard: still sent, the server decides
        assertEquals(setOf("audio"), VoiceLogic.input(audio, 0, "")!!.keys)
        assertNull(VoiceLogic.input(null, 0, ""))
        assertNull(VoiceLogic.input(ByteArray(10), 0, " "))
    }

    @Test fun `typed words are trimmed and a minute is the longest`() {
        assertEquals(mapOf("text" to "pay"), VoiceLogic.textBody("  pay "))
        assertEquals(60_000, VoiceLogic.MAX_MILLIS)
        assertFalse(VoiceLogic.canRead("   "))
        assertTrue(VoiceLogic.canRead(" a "))
    }

    @Test fun `the meter reads like the iPhone's decibels`() {
        assertEquals(0f, VoiceLogic.level(0))
        assertEquals(1f, VoiceLogic.level(32767))
        assertTrue(VoiceLogic.level(3000) in 0.4f..0.8f)
        assertEquals(0f, VoiceLogic.level(10)) // under -55 dB
    }

    @Test fun `a sale spoken becomes a draft for the form, a payment method and the person included`() {
        val payload = mapOf(
            "lines" to listOf(mapOf("description" to "Ring", "weightG" to 5.0, "ratePerGram" to 30000.0, "lineTotal" to 150000.0)),
            "customerNameHeard" to "Amna",
            "paid" to 50000.0,
            "method" to "Bank Transfer",
            "skus" to emptyList<String>(),
        )
        val amna = Customer.from("c1", mapOf("name" to "Amna"))
        val draft = VoiceHandoff.sale(payload, listOf(amna), { id -> amna.takeIf { it.id == id } }, emptyList(), "Test Person", "gold", null)
        assertEquals(1, draft.lines.size)
        assertEquals("Bank Transfer", draft.payments[0].method)
        assertEquals("Test Person", draft.takenBy)
        // a draft that already has a person keeps them
        draft.takenBy = "Someone"
        assertEquals("Someone", VoiceHandoff.sale(payload, listOf(amna), { null }, emptyList(), "Test Person", "gold", draft).takenBy)
    }

    @Test fun `an order spoken becomes a piece with its written price, the advance method and the person`() {
        val payload = mapOf(
            "items" to listOf(mapOf("description" to "Gold ring size 8", "weightG" to 6.0, "lineTotal" to 180000.0)),
            "customerNameHeard" to "Bilal",
            "advanceMethod" to "Cash",
            "customer" to mapOf("pinned" to mapOf("id" to "c2")),
        )
        val draft = VoiceHandoff.order(payload, { null }, null, "Test Person", "gold", null)
        assertEquals(1, draft.pieces.size)
        assertTrue(draft.pieces[0].manual)
        assertEquals("180000", draft.pieces[0].manualPrice)
        assertEquals("Cash", draft.advanceMethod)
        assertEquals("Test Person", draft.takenBy)
    }
}
