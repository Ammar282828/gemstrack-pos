package erp.app.screens.home

import erp.app.data.Demo
import erp.app.nav.ScreenRoute
import erp.core.DocJSON
import erp.core.logic.CashMethod
import erp.core.logic.todaysCash
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import erp.core.models.Order
import erp.core.models.Repair
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HomeLogicTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    // Dates

    @Test fun karachiDaysAndFormats() {
        assertEquals("Monday 12 October", DashDate.dayLabel(now))
        assertEquals("Monday, 12 October 2026", DashDate.longDay(now))
        assertEquals("Mon 12 Oct", DashDate.weekdayDayMonth(now))
        assertEquals("2026-10-11T19:00:00Z", DashDate.startOfDay(now).toString())
        assertEquals("2026-09-30T19:00:00Z", DashDate.startOfMonth(now).toString())
        assertEquals("September", DashDate.monthName(DashDate.lastMonth(now)))
        assertEquals("Sep", DashDate.shortMonth(DashDate.lastMonth(now)))
        // Just after midnight in Karachi is still yesterday in UTC, and today here.
        assertEquals("Tuesday 13 October", DashDate.dayLabel(Instant.parse("2026-10-12T19:30:00Z")))
    }

    @Test fun aBareDayIsKarachisMidnightForParseISOAndUtcMidnightForNewDate() {
        assertEquals("2026-10-09T19:00:00Z", DashDate.parseISO("2026-10-10").toString())
        assertEquals("2026-10-10T00:00:00Z", DashDate.newDate("2026-10-10").toString())
        assertEquals("2026-10-09T19:30:00Z", DashDate.newDate("2026-10-10T00:30").toString())
        assertEquals("2026-10-09T19:30:15Z", DashDate.newDate("2026-10-10T00:30:15").toString())
        assertNull(DashDate.newDate("tomorrow"))
        assertNull(DashDate.parseISO(""))
        assertEquals("", DashDate.clock(null))
    }

    @Test fun calendarDaysCountMidnights() {
        assertEquals(1, DashDate.calendarDays(Instant.parse("2026-10-12T19:30:00Z"), Instant.parse("2026-10-12T05:00:00Z")))
        assertEquals(0, DashDate.calendarDays(now, Instant.parse("2026-10-11T19:30:00Z")))
        assertEquals("1:05 am", DashDate.clock("2026-10-11T20:05:00Z"))
    }

    // Birthdays and anniversaries

    @Test fun anOccasionIsWorthMessagingTwoDaysAfterAndTwoWeeksBefore() {
        assertEquals(0, DashOccasions.daysUntil("1990-10-12", now))
        assertEquals(1, DashOccasions.daysUntil("10-13", now))
        assertEquals(-2, DashOccasions.daysUntil("2001-10-10", now))
        // Three days gone is next year's.
        assertEquals(362, DashOccasions.daysUntil("10-09", now))
        assertNull(DashOccasions.daysUntil("not a date", now))
        assertNull(DashOccasions.daysUntil("1990-1-3", now))
        val customers = listOf(
            Customer.fromMap(mapOf("id" to "A", "name" to "Ara Demo", "birthday" to "1990-10-26")),
            Customer.fromMap(mapOf("id" to "B", "name" to "Bia Demo", "anniversary" to "2015-10-27")),
            Customer.fromMap(mapOf("id" to "C", "name" to "Cy Demo", "birthday" to "1990-10-10", "anniversary" to "2015-10-12")),
            Customer.fromMap(mapOf("id" to "D", "name" to "Removed Demo", "birthday" to "1990-10-12", "deletedAt" to "2026-01-01T00:00:00.000Z")),
        )
        val found = DashOccasions.upcoming(customers, now)
        assertEquals(listOf("Cy Demo", "Cy Demo", "Ara Demo"), found.map { it.customerName })
        assertEquals(listOf(-2, 0, 14), found.map { it.inDays })
        assertEquals(listOf("2 days ago", "today", "in 14 days"), found.map { it.`when` })
        assertEquals("tomorrow", DashOccasion("x", "x", true, 1).`when`)
        assertEquals("1 day ago", DashOccasion("x", "x", true, -1).`when`)
    }

    // Paths and words

    @Test fun rowsOpenTheIphonesDestinations() {
        assertEquals("/invoices/INV-000012", DashPath.invoice("INV-000012"))
        assertEquals("/orders/ORD%2F1", DashPath.order("ORD/1"))
        assertEquals("/repairs?id=REP-1", DashPath.repair("REP-1"))
        assertEquals("/customers/C%201", DashPath.customer("C 1"))
        assertEquals("/karigars/K1", DashPath.karigar("K1"))
    }

    @Test fun theHeroLineAndTheSaleStanding() {
        assertEquals("No invoices yet today", heroLine(0, "3:45 pm"))
        assertEquals("1 invoice", heroLine(1, null))
        assertEquals("3 invoices · last sale 3:45 pm", heroLine(3, "3:45 pm"))
        fun inv(extra: Map<String, Any?>) = Invoice.fromMap(mapOf("id" to "I", "grandTotal" to 100_000, "createdAt" to "2026-10-12T06:00:00.000Z") + extra)
        assertEquals("Paid", saleStanding(inv(mapOf("balanceDue" to 0))).text)
        assertEquals("PKR 25,000 due", saleStanding(inv(mapOf("balanceDue" to 25_000))).text)
        assertEquals("In credit", saleStanding(inv(mapOf("balanceDue" to -5_000))).text)
        assertEquals("Refunded", saleStanding(inv(mapOf("status" to "Refunded", "balanceDue" to 25_000))).text)
    }

    // Team note

    @Test fun theTeamNoteIs600CharactersCountedAsAReaderCountsThem() {
        assertEquals(600, TeamNote.LIMIT)
        assertEquals(0, TeamNote.count(""))
        assertEquals(5, TeamNote.count("Close"))
        // An emoji with a skin tone and a letter with a combining accent are one character each.
        assertEquals(2, TeamNote.count("👍🏽" + "é"))
        assertTrue(!TeamNote.isOver("a".repeat(600)))
        assertTrue(TeamNote.isOver("a".repeat(601)))
        assertEquals("Shop shuts at 6", TeamNote.trimmed("  \n Shop shuts at 6 \n"))
    }

    @Test fun saveNeedsAnOwnerALoadedFormAnUnsavingStateAndAFittingNonEmptyNote() {
        assertTrue(TeamNote.canSave("Hello", loaded = true, saving = false, isOwner = true))
        assertTrue(!TeamNote.canSave("Hello", loaded = false, saving = false, isOwner = true))
        assertTrue(!TeamNote.canSave("Hello", loaded = true, saving = true, isOwner = true))
        assertTrue(!TeamNote.canSave("Hello", loaded = true, saving = false, isOwner = false))
        assertTrue(!TeamNote.canSave("  \n ", loaded = true, saving = false, isOwner = true))
        assertTrue(!TeamNote.canSave("a".repeat(601), loaded = true, saving = false, isOwner = true))
    }

    @Test fun theNoteIsWrittenAsTheIphoneWritesIt() {
        assertEquals(mapOf("patch" to mapOf("teamNote" to "Closed Friday")), TeamNote.payload("Closed Friday"))
        assertEquals(mapOf("patch" to mapOf("teamNote" to "")), TeamNote.payload(""))
        assertEquals("from demo", TeamNote.current("settings", "from demo", isDemo = true))
        assertEquals("settings", TeamNote.current("settings", "from demo", isDemo = false))
        assertEquals("settings", TeamNote.current("settings", null, isDemo = true))
        assertEquals("", TeamNote.current(null, null, isDemo = false))
    }

    // Routes

    @Test fun homeOwnsTheDashboardTodaysCashAndTheVoicePlace() {
        fun owns(p: String) = HomeRoutes.any { it.matches(p) }
        assertTrue(owns("/") && owns("/today") && owns("/voice") && owns("/?x=1"))
        assertTrue(!owns("/calendar") && !owns("/orders"))
        assertEquals("x", ScreenRoute.bare("x?y"))
    }

    // The demo books

    private val demo: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), Instant.now())
    }

    private inline fun <reified T : Any> all(name: String, id: String = "id"): List<T> =
        demo[name].orEmpty().map { DocJSON.decode<T>((it[id] as? String) ?: "", it) }

    @Test fun theDemoBooksMakeAFullDashboardAndTodaysCash() {
        val at = Instant.now()
        val invoices = all<Invoice>("invoices").sortedByDescending { it.createdAt }
        val f = DashFigures(
            at, all<Order>("orders"), invoices, all<AdditionalRevenue>("additional_revenue"), all<Expense>("expenses"),
            all<Karigar>("karigars"), all<KarigarJob>("karigar_jobs"), all<Repair>("repairs"), all<Customer>("customers"), all<HisaabEntry>("hisaab"),
        )
        assertEquals(30, f.days.size)
        assertTrue(f.recentInvoices.isNotEmpty())
        assertTrue(f.todayRevenue >= 0 && f.monthRevenue >= f.todayRevenue)
        assertTrue(f.due.isNotEmpty())
        // Every row the page can draw has its words.
        for (d in f.due) { d.whenText(at); dueSpoken(d); dueRefText(d) }
        for (n in f.needs(1, null)) { needSpoken(n); needSymbol(n.kind); needTone(n.tone) }
        for (i in f.recentInvoices) saleStanding(i)
        heroLine(f.todayInvoiceCount, f.lastSaleToday?.let { DashDate.clock(it.createdAt) })
        f.monthAgainstLast?.let { monthChange(it, at) }

        val cash = todaysCash(invoices, all<Order>("orders"), all<Repair>("repairs"), all<AdditionalRevenue>("additional_revenue"), all<Expense>("expenses"), at)
        assertTrue(cash.byMethod.containsKey(CashMethod.cash))
        for (l in cash.lines) { cashLineTitle(l); cashLineSubtitle(l); assertTrue(cashLinePath(l).startsWith("/")) }
        assertNotNull(cash.day)
    }
}
