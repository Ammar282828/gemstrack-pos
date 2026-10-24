package erp.app

import erp.app.config.Business
import erp.app.nav.AppRouter
import erp.app.widget.ChartKind
import erp.app.widget.FaceKind
import erp.app.widget.WidgetArrangement
import erp.app.widget.WidgetCharts
import erp.app.widget.WidgetFigure
import erp.app.widget.WidgetLayout
import erp.app.widget.WidgetLinkData
import erp.app.widget.WidgetSize
import erp.app.widget.WidgetSummary
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The widget's two-business layout and what its faces show (WidgetSummary.kt): the same plan draws the Glance widget and the preview.

private val SIDE = Business.Side("#8A6B42", "#F2F3F6", "#FFFFFF", "#FFFFFF")
private val PALETTE = Business.Palette(SIDE, SIDE.copy(accent = "#BE9F76", ground = "#0A1111"))

private fun link(id: String, brand: String? = id) = WidgetLinkData(id, id.uppercase() + " ERP", "https://erp.$id.example", "key-$id", PALETTE, brand)

class WidgetPickTests {
    private val order = listOf("taheri", "mina", "acme")

    @Test fun `with two linked both are shown by default, the open business first`() {
        val links = listOf(link("mina"), link("taheri"))
        assertEquals(listOf("taheri", "mina"), WidgetLayout.pick(links, order, "taheri", both = true).map { it.id })
        assertEquals(listOf("mina", "taheri"), WidgetLayout.pick(links, order, "mina", both = true).map { it.id })
    }

    @Test fun `show both off is the open business alone`() {
        val links = listOf(link("taheri"), link("mina"))
        assertEquals(listOf("mina"), WidgetLayout.pick(links, order, "mina", both = false).map { it.id })
        assertEquals(listOf("taheri"), WidgetLayout.pick(links, order, "gone", both = false).map { it.id })
    }

    @Test fun `one linked is one, nothing linked is nothing, and a third wraps round to the next`() {
        assertEquals(listOf("taheri"), WidgetLayout.pick(listOf(link("taheri")), order, "taheri", both = true).map { it.id })
        assertTrue(WidgetLayout.pick(emptyList(), order, "taheri", both = true).isEmpty())
        val three = listOf(link("taheri"), link("mina"), link("acme", null))
        assertEquals(listOf("acme", "taheri"), WidgetLayout.pick(three, order, "acme", both = true).map { it.id })
        assertEquals(listOf("mina", "acme"), WidgetLayout.pick(three, order, "mina", both = true).map { it.id })
    }

    @Test fun `a business the app does not list yet still has its place, last`() {
        val links = listOf(link("zed", null), link("taheri"))
        assertEquals(listOf("taheri", "zed"), WidgetLayout.pick(links, order, "taheri", both = true).map { it.id })
    }
}

class WidgetPlanTests {
    private val now = Instant.parse("2026-10-24T08:00:00Z")
    private fun shown(vararg ids: String) = ids.map { link(it) to WidgetSummary.sample(it.uppercase()) as WidgetSummary? }

    @Test fun `with two businesses small stacks two rows, medium sets two columns, large stacks two medium faces`() {
        val small = WidgetLayout.plan(shown("taheri", "mina"), WidgetSize.Small, now)
        assertEquals(WidgetArrangement.Rows, small.arrangement)
        assertEquals(listOf(FaceKind.SmallHalf, FaceKind.SmallHalf), small.items.map { it.face!!.kind })
        val medium = WidgetLayout.plan(shown("taheri", "mina"), WidgetSize.Medium, now)
        assertEquals(WidgetArrangement.Columns, medium.arrangement)
        assertEquals(listOf(FaceKind.MediumHalf, FaceKind.MediumHalf), medium.items.map { it.face!!.kind })
        val large = WidgetLayout.plan(shown("taheri", "mina"), WidgetSize.Large, now)
        assertEquals(WidgetArrangement.Stacked, large.arrangement)
        assertEquals(listOf(FaceKind.Medium, FaceKind.Medium), large.items.map { it.face!!.kind })
    }

    @Test fun `one business has the single faces`() {
        assertEquals(FaceKind.Small, WidgetLayout.plan(shown("taheri"), WidgetSize.Small, now).items[0].face!!.kind)
        assertEquals(FaceKind.Medium, WidgetLayout.plan(shown("taheri"), WidgetSize.Medium, now).items[0].face!!.kind)
        val large = WidgetLayout.plan(shown("taheri"), WidgetSize.Large, now)
        assertEquals(WidgetArrangement.Single, large.arrangement)
        assertEquals(FaceKind.Large, large.items[0].face!!.kind)
        assertFalse(WidgetLayout.plan(emptyList(), WidgetSize.Large, now).linked)
    }

    @Test fun `each face shows today's takings, the week's change and its line or bars`() {
        val small = WidgetLayout.plan(shown("taheri"), WidgetSize.Small, now).items[0].face!!
        assertEquals("Made today", small.today.label)
        assertEquals("▲ 12%", small.delta!!.text)
        assertEquals("12 percent up on last week", small.delta!!.speech)
        assertEquals(ChartKind.Sparkline, small.chart)
        assertEquals("Rs", small.heroPrefix)
        assertEquals("3.12 lac", small.heroNumber)
        assertTrue(small.stats.isEmpty() && small.needs.isEmpty())
        val half = WidgetLayout.plan(shown("taheri", "mina"), WidgetSize.Small, now).items[0].face!!
        assertEquals(ChartKind.None, half.chart)
        assertFalse(half.showsWordmark)
        assertEquals(ChartKind.Bars, WidgetLayout.plan(shown("taheri"), WidgetSize.Medium, now).items[0].face!!.chart)
    }

    @Test fun `owed, due and on the bench are the stats of the medium and large faces`() {
        val medium = WidgetLayout.plan(shown("taheri"), WidgetSize.Medium, now).items[0].face!!
        assertEquals(listOf("Rs 18.6 lac" to "Owed to you", "6" to "Due · 2 late", "14" to "On the bench"), medium.stats.map { it.value to it.label })
        assertTrue(medium.stats[1].late)
        assertFalse(medium.stats[2].late)
        // without the ERP's extras the old "Due" figure stands in
        val plain = WidgetSummary("Taheri", "4:05 pm", listOf(WidgetFigure("Made today", "Rs 1", null), WidgetFigure("Owed to you", "Rs 2", null), WidgetFigure("Due", "3", "1 late")))
        assertEquals(listOf("Owed to you", "1 late"), WidgetLayout.stats(plain).map { it.label })
    }

    @Test fun `the large face carries what needs you, the latest sales and the note, and the quiet one the figures instead`() {
        val large = WidgetLayout.plan(shown("taheri"), WidgetSize.Large, now).items[0].face!!
        assertEquals(listOf("Ayesha Khan", "Bilal Traders", "Sana Malik", "Omar Jewellers"), large.needs.map { it.title })
        assertEquals(listOf("Hira Siddiqui", "Walk-in", "Zain Ali"), large.recent.map { it.title })
        assertEquals("Please confirm all collections before closing today.", large.note)
        assertTrue(large.supporting.isEmpty())
        val quiet = WidgetSummary("Taheri", "4:05 pm", WidgetSummary.sample().figures, teamNote = "  \n")
        val face = WidgetLayout.plan(listOf(link("taheri") to quiet), WidgetSize.Large, now).items[0].face!!
        assertNull(face.note)
        assertEquals(listOf("Gold 24k", "Today's cash", "Owed to you", "Orders due"), face.supporting.map { it.label })
    }

    @Test fun `a business with no figures yet keeps its place, and one with none at all has no face`() {
        val plan = WidgetLayout.plan(listOf(link("taheri") to WidgetSummary.sample(), link("mina") to null), WidgetSize.Medium, now)
        assertNotNull(plan.items[0].face)
        assertNull(plan.items[1].face)
        assertEquals("MINA ERP", plan.items[1].look.name)
        assertNull(WidgetLayout.face(WidgetSummary("Taheri", "1:00 pm", emptyList()), "Taheri", FaceKind.Small))
    }

    @Test fun `a long figure is shrunk to its room, never below half, and a short one keeps its size`() {
        val roomy = WidgetLayout.face(WidgetSummary.sample(), "T", FaceKind.Large, now, widthDp = 340f)!!
        assertEquals(40f, roomy.heroSp)
        val narrow = WidgetLayout.face(WidgetSummary.sample(), "T", FaceKind.Small, now, widthDp = 110f)!!
        assertTrue(narrow.heroSp < 30f && narrow.heroSp >= 15f)
        val huge = WidgetSummary("T", "1:00 pm", listOf(WidgetFigure("Made today", "Rs 12,345.67 crore", null)))
        assertEquals(15f, WidgetLayout.face(huge, "T", FaceKind.Small, now, widthDp = 110f)!!.heroSp, 0.001f)
    }

    @Test fun `figures from another day say so, on the faces that have room`() {
        val old = WidgetSummary("T", "4:05 pm", WidgetSummary.sample().figures, asOf = "2026-10-12")
        assertEquals("Updated 12 Oct", WidgetLayout.face(old, "T", FaceKind.Small, now)!!.stamp)
        assertNull(WidgetLayout.face(old, "T", FaceKind.SmallHalf, now)!!.stamp)
        assertNull(WidgetLayout.face(WidgetSummary.sample(), "T", FaceKind.Small, now)!!.stamp)
    }

    @Test fun `the room a launcher gives chooses the size`() {
        assertEquals(WidgetSize.Small, WidgetLayout.sizeFor(110f, 110f))
        assertEquals(WidgetSize.Medium, WidgetLayout.sizeFor(250f, 110f))
        assertEquals(WidgetSize.Large, WidgetLayout.sizeFor(250f, 250f))
    }
}

class WidgetSummaryExtrasTests {
    @Test fun `the ERP's extras decode, and an odd field is a default, never a failure`() {
        val json = """{"house":"Taheri","updated":"4:05 pm","figures":[{"label":"Made today","value":"Rs 1","detail":null}],
            "extras":{"days":[1,2,"x",4.5],"weekDelta":-7.4,"bench":3,"due":"two","late":1,
            "needs":[{"title":"A","detail":"3 days late","tone":"late","path":"/orders"},"junk",{"title":"B"}],
            "recent":[{"title":"C","amount":"Rs 5","when":"23 Oct","path":"/invoices"}]}}"""
        val e = assertNotNull(assertNotNull(WidgetSummary.decode(json)).extras)
        assertEquals(listOf(1.0, 2.0, 4.5), e.days)
        assertEquals(-7, e.weekDelta)
        assertEquals(3, e.bench)
        assertEquals(0, e.due)
        assertEquals(1, e.late)
        assertEquals(listOf("A", "B"), e.needs.map { it.title })
        assertEquals("owed", e.needs[1].tone)
        assertEquals("/", e.needs[1].path)
        assertEquals("23 Oct", e.recent[0].whenText)
    }

    @Test fun `a server that sends no extras still draws the figures`() {
        val s = assertNotNull(WidgetSummary.decode("""{"house":"T","updated":"1 pm","figures":[{"label":"Made today","value":"Rs 1"}]}"""))
        assertNull(s.extras)
        assertEquals(FaceKind.Small, WidgetLayout.face(s, "T", FaceKind.Small)!!.kind)
        assertEquals(ChartKind.None, WidgetLayout.face(s, "T", FaceKind.Small)!!.chart)
    }

    @Test fun `the week's line and bars are scaled the way the iPhone's are`() {
        val days = listOf(0.0, 50.0, 100.0)
        val line = WidgetCharts.sparkline(days)
        assertEquals(listOf(0f, 0.5f, 1f), line.map { it.first })
        assertEquals(1f, line[0].second, 0.0001f)
        assertEquals(1f - 100f / 115f, line[2].second, 0.0001f)
        val bars = WidgetCharts.bars(days)
        assertEquals(0f, bars[0], 0.0001f)
        assertEquals(50f / 105f, bars[1], 0.0001f)
        assertEquals(100f / 105f, bars[2], 0.0001f)
        assertTrue(WidgetCharts.sparkline(listOf(5.0)).isEmpty())
        assertTrue(WidgetCharts.bars(emptyList()).isEmpty())
    }
}

class WidgetLinkTests {
    @Test fun `a tap opens the app on that business and screen, never the browser`() {
        val look = link("mina").look
        assertEquals("shoperp://open?b=mina&p=%2F", look.url())
        assertEquals("shoperp://open?b=mina&p=%2Finvoices%2FINV-1", look.url("/invoices/INV-1"))
    }

    @Test fun `the app reads a widget's tap, a notification's business and an ERP link of any business on the phone`() {
        val hosts = listOf("taheri" to "erp.taheri.shop", "mina" to "erp.houseofmina.store")
        assertEquals(AppRouter.Target("mina", "/invoices"), AppRouter.target("shoperp", "open", null, "b=mina&p=%2Finvoices", hosts))
        assertEquals(AppRouter.Target("taheri", "/"), AppRouter.target("shoperp", "open", null, "b=taheri", hosts))
        assertEquals(AppRouter.Target(null, "/"), AppRouter.target("shoperp", "open", null, "p=%2F%2Fevil.example", hosts))
        assertNull(AppRouter.target("shoperp", "elsewhere", null, "b=mina", hosts))
        assertEquals(AppRouter.Target("mina", "/orders/ORD-1?x=1"), AppRouter.target("https", "erp.houseofmina.store", "/orders/ORD-1", "x=1", hosts))
        // the pos. twin is the same ERP
        assertEquals(AppRouter.Target("taheri", "/orders"), AppRouter.target("https", "pos.taheri.shop", "/orders", null, hosts))
        assertNull(AppRouter.target("https", "evil.example", "/orders", null, hosts))
        assertEquals(AppRouter.Target(null, "/orders/ORD-1"), AppRouter.target("erp", "orders", "/ORD-1", null, hosts))
        assertNull(AppRouter.target("ftp", "x", null, null, hosts))
    }

    @Test fun `a business's colours on the widget are its palette's`() {
        val look = link("mina").look
        assertEquals(androidx.compose.ui.graphics.Color(0xFF8A6B42), look.accent(false))
        assertEquals(androidx.compose.ui.graphics.Color(0xFFBE9F76), look.accent(true))
        assertTrue(look.ground(true) != look.ground(false))
    }
}
