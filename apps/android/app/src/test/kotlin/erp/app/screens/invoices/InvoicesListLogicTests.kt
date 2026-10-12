package erp.app.screens.invoices

import erp.app.screens.invoices.Fixtures.invoice
import java.time.Instant
import java.time.LocalDate
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InvoicesListLogicTests {
    // Karachi is UTC+5: 2026-10-12 08:00 there. A Monday.
    private val now = Instant.parse("2026-10-12T03:00:00Z")

    private val today = invoice(id = "INV-1", grandTotal = 50_000.0, createdAt = "2026-10-12T02:00:00.000Z", extra = mapOf("takenBy" to "Demo", "customerContact" to "0300 5550001"))
    private val yesterdayPaid = invoice(id = "INV-2", customerName = "Maha Demo", grandTotal = 30_000.0, amountPaid = 30_000.0, createdAt = "2026-10-11T08:00:00.000Z", extra = mapOf("takenBy" to "Counter Two"))
    private val lastWeekOwing = invoice(id = "INV-3", customerName = "Zara Demo", grandTotal = 20_000.0, amountPaid = 5_000.0, createdAt = "2026-10-06T08:00:00.000Z", extra = mapOf("customerId" to "c9", "source" to "shopify"))
    private val lastMonthCredit = invoice(id = "INV-4", grandTotal = 10_000.0, amountPaid = 12_000.0, createdAt = "2026-08-20T08:00:00.000Z")
    private val refunded = invoice(id = "INV-5", grandTotal = 8_000.0, createdAt = "2026-10-10T08:00:00.000Z", extra = mapOf("status" to "Refunded"))
    private val all = listOf(today, yesterdayPaid, lastWeekOwing, lastMonthCredit, refunded)

    private fun scope(f: InvoiceFilter, phones: Map<String, String> = emptyMap()) = InvoicesListRules.scope(all, f, { phones }, now).map { it.id }

    @Test fun chipsSayWhatIsOwedSettledInCreditOrFromShopify() {
        fun ids(c: InvoiceChip) = all.filter { c.matches(it) }.map { it.id }
        assertEquals(listOf("INV-1", "INV-2", "INV-3", "INV-4", "INV-5"), ids(InvoiceChip.all))
        // a refund is not owed even though its balance reads due
        assertEquals(listOf("INV-1", "INV-3"), ids(InvoiceChip.unpaid))
        assertEquals(listOf("INV-2"), ids(InvoiceChip.paid))
        assertEquals(listOf("INV-4"), ids(InvoiceChip.credit))
        assertEquals(listOf("INV-3"), ids(InvoiceChip.shopify))
    }

    @Test fun theChipsCreditAndShopifyAppearOnlyWhenSomethingMatches() {
        assertEquals(
            listOf(InvoiceChip.all, InvoiceChip.unpaid, InvoiceChip.paid),
            InvoicesListRules.visibleChips(listOf(today, yesterdayPaid), InvoiceChip.all),
        )
        assertEquals(
            listOf(InvoiceChip.all, InvoiceChip.unpaid, InvoiceChip.paid, InvoiceChip.credit, InvoiceChip.shopify),
            InvoicesListRules.visibleChips(all, InvoiceChip.all),
        )
        // the chosen one stays on offer so it can be let go of
        assertTrue(InvoiceChip.credit in InvoicesListRules.visibleChips(emptyList(), InvoiceChip.credit))
    }

    @Test fun searchFindsAnIdACustomerAPieceOrANumber() {
        assertEquals(listOf("INV-3"), scope(InvoiceFilter(search = "inv-3")))
        assertEquals(listOf("INV-2"), scope(InvoiceFilter(search = "MAHA")))
        assertEquals(listOf("INV-1", "INV-2", "INV-3", "INV-4", "INV-5"), scope(InvoiceFilter(search = "ruby ring")))
        // the number on the invoice, with its leading zero ignored and punctuation between
        assertEquals(listOf("INV-1"), scope(InvoiceFilter(search = "0300-5550001")))
        assertEquals(listOf("INV-1"), scope(InvoiceFilter(search = "555")))
        // fewer than three digits is not a number search
        assertEquals(emptyList(), scope(InvoiceFilter(search = "55")))
        // the customer's own number, for an invoice that carries none
        assertEquals(listOf("INV-3"), scope(InvoiceFilter(search = "0301 9990000"), mapOf("c9" to "+92 301 9990000")))
    }

    @Test fun takenByMonthAndRangeNarrowTheList() {
        assertEquals(listOf("INV-1"), scope(InvoiceFilter(takenBy = "Demo")))
        assertEquals(listOf("INV-4"), scope(InvoiceFilter(month = "2026-08")))
        assertEquals(listOf("INV-1", "INV-2", "INV-3", "INV-5"), scope(InvoiceFilter(month = "2026-10")))
        // both days included
        assertEquals(listOf("INV-2", "INV-5"), scope(InvoiceFilter(rangeFrom = "2026-10-10", rangeTo = "2026-10-11")))
        // open, it runs to the end of today
        assertEquals(listOf("INV-1", "INV-2", "INV-5"), scope(InvoiceFilter(rangeFrom = "2026-10-10")))
        // a range needs a start
        assertEquals(5, scope(InvoiceFilter(rangeTo = "2026-10-01")).size)
    }

    @Test fun theDayGroupsLeadWithTodayAndYesterday() {
        val groups = InvoicesListRules.sections(listOf(today, yesterdayPaid, refunded, lastWeekOwing, lastMonthCredit), InvoiceGrouping.day, now)
        assertEquals(listOf("Today", "Yesterday", "Saturday 10 Oct", "Tuesday 6 Oct", "Thursday 20 Aug"), groups.map { it.title })
        assertEquals(50_000.0, groups[0].billed)
        assertEquals(50_000.0, groups[0].owed)
        assertEquals(0.0, groups[1].owed)
        // a refund counts toward what was billed but is never owed
        assertEquals(8_000.0, groups[2].billed)
        assertEquals(0.0, groups[2].owed)
    }

    @Test fun theYearIsSaidOnlyWhenItIsNotThisOne() {
        val old = invoice(id = "INV-0", createdAt = "2025-03-04T08:00:00.000Z")
        val g = InvoicesListRules.sections(listOf(old), InvoiceGrouping.day, now)
        assertEquals("Tuesday 4 Mar 2025", g[0].title)
        assertEquals("March 2025", InvoicesListRules.sections(listOf(old), InvoiceGrouping.month, now)[0].title)
        assertEquals("August", InvoicesListRules.sections(listOf(lastMonthCredit), InvoiceGrouping.month, now)[0].title)
    }

    @Test fun weeksRunFromMonday() {
        val groups = InvoicesListRules.sections(listOf(today, yesterdayPaid, refunded, lastWeekOwing), InvoiceGrouping.week, now)
        // Sat 10 and Sun 11 are the week of Mon 5; Mon 12 starts this one
        assertEquals(listOf("This week", "Week of 5 Oct"), groups.map { it.title })
        assertEquals(listOf("INV-1"), groups[0].rows.map { it.id })
        assertEquals(listOf("INV-2", "INV-5", "INV-3"), groups[1].rows.map { it.id })
    }

    @Test fun anUndatedInvoiceHasASectionOfItsOwn() {
        val undated = invoice(id = "INV-9", createdAt = "")
        val g = InvoicesListRules.sections(listOf(undated, today), InvoiceGrouping.day, now)
        assertEquals(listOf("No date", "Today"), g.map { it.title })
    }

    @Test fun byStatusTheOldestDebtComesFirst() {
        val groups = InvoicesListRules.sections(all, InvoiceGrouping.status, now)
        assertEquals(listOf("Awaiting payment", "Settled"), groups.map { it.title })
        assertEquals(listOf("INV-3", "INV-1"), groups[0].rows.map { it.id })
        assertEquals("Oldest first", groups[0].hint)
        assertEquals(listOf("INV-2", "INV-4", "INV-5"), groups[1].rows.map { it.id })
        assertEquals("Nothing outstanding", groups[1].hint)
        assertEquals(65_000.0, groups[0].owed)
    }

    @Test fun theThreeFiguresAtTheHead() {
        val s = InvoiceSummary.of(all, now)
        // today: INV-1. This month (October): INV-1, 2, 3 and the refund's grand total as billed
        assertEquals(50_000.0, s.today)
        assertEquals(1, s.todayCount)
        assertEquals(108_000.0, s.month)
        assertEquals(4, s.monthCount)
        // owed by the ERP's one rule: a refund and a credit are not owed
        assertEquals(65_000.0, s.owed)
        assertEquals(2, s.owedCount)
    }

    @Test fun aFigureTappedShowsWhatItCountsAndTappedAgainLetsGo() {
        val none = InvoiceFilter()
        val (f1, c1) = InvoicesListRules.pick(InvoiceSummary.Figure.today, none, InvoiceChip.all, now)
        assertEquals("2026-10-12", f1.rangeFrom)
        assertNull(f1.rangeTo)
        assertTrue(InvoicesListRules.chosen(InvoiceSummary.Figure.today, f1, c1, now))
        val (f2, _) = InvoicesListRules.pick(InvoiceSummary.Figure.today, f1, c1, now)
        assertNull(f2.rangeFrom)

        val (m1, _) = InvoicesListRules.pick(InvoiceSummary.Figure.month, f1, c1, now)
        assertEquals("2026-10", m1.month)
        assertNull(m1.rangeFrom)
        assertTrue(InvoicesListRules.chosen(InvoiceSummary.Figure.month, m1, c1, now))
        assertFalse(InvoicesListRules.chosen(InvoiceSummary.Figure.today, m1, c1, now))

        val (_, o1) = InvoicesListRules.pick(InvoiceSummary.Figure.owed, none, InvoiceChip.all, now)
        assertEquals(InvoiceChip.unpaid, o1)
        val (_, o2) = InvoicesListRules.pick(InvoiceSummary.Figure.owed, none, o1, now)
        assertEquals(InvoiceChip.all, o2)
    }

    @Test fun theCaptionNamesWhatNarrowsTheList() {
        assertEquals("", InvoicesListRules.caption(InvoiceFilter(), InvoiceChip.all))
        assertEquals(
            "In credit · Demo · October 2026 · 1 Oct – 8 Oct 2026",
            InvoicesListRules.caption(InvoiceFilter(takenBy = "Demo", month = "2026-10", rangeFrom = "2026-10-01", rangeTo = "2026-10-08"), InvoiceChip.credit),
        )
        assertEquals("From 1 Oct 2026", InvoiceCalendar.caption("2026-10-01", null))
        // the chips already show All, Unpaid and Paid; the line is for the rest
        assertFalse(InvoicesListRules.filterActive(InvoiceFilter(), InvoiceChip.unpaid))
        assertTrue(InvoicesListRules.filterActive(InvoiceFilter(), InvoiceChip.credit))
        assertTrue(InvoicesListRules.filterActive(InvoiceFilter(takenBy = "Demo"), InvoiceChip.all))
        assertFalse(InvoicesListRules.filtering(InvoiceFilter(), InvoiceChip.all))
        assertTrue(InvoicesListRules.filtering(InvoiceFilter(search = "x"), InvoiceChip.all))
    }

    @Test fun monthKeysAndLabels() {
        assertEquals("2026-10", InvoiceCalendar.monthKey("2026-10-12T02:00:00.000Z"))
        // 21:00 UTC on the 31st is already November in Karachi
        assertEquals("2026-11", InvoiceCalendar.monthKey("2026-10-31T21:00:00.000Z"))
        assertNull(InvoiceCalendar.monthKey("nope"))
        assertEquals("October 2026", InvoiceCalendar.monthLabel("2026-10"))
        assertEquals("garbage", InvoiceCalendar.monthLabel("garbage"))
        assertEquals("2026-03-04", InvoiceCalendar.day(LocalDate.of(2026, 3, 4)))
        assertEquals(LocalDate.of(2026, 3, 4), InvoiceCalendar.picked("2026-03-04"))
        assertNull(InvoiceCalendar.picked("2026-13-40"))
        assertNull(InvoiceCalendar.picked(null))
    }
}
