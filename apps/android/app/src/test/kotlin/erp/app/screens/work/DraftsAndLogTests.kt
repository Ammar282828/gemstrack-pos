package erp.app.screens.work

import erp.app.data.Demo
import erp.core.ERPDecode
import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderPieceDraft
import erp.core.logic.ActivityLogRules
import erp.core.logic.ShopCalendar
import erp.core.logic.draftList
import erp.core.logic.shopCalendarDays
import erp.core.logic.shopCalendarDue
import erp.core.logic.shopCalendarDueOn
import erp.core.logic.shopCalendarMonth
import erp.core.models.Invoice
import erp.core.models.Order
import java.io.File
import java.time.Instant
import java.time.LocalDate
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Drafts, the Calendar and the Activity log (apps/iphone/App/Screens/Work): their rules, and the demo books run through them
// the way the screens lay them out. Made-up names and numbers only.
class DraftsAndLogTests {
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    private val demo by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }
    private val orders: List<Order> by lazy { demo.getValue("orders").map { ERPDecode.model<Order>(it)!! } }
    private val invoices: List<Invoice> by lazy { demo.getValue("invoices").map { ERPDecode.model<Invoice>(it)!! } }

    // MARK: Drafts

    @Test fun theDemoDraftsAreListedNewestTypedFirstAndNoneIsExpired() {
        val list = draftList(WorkDemoBooks.drafts(now), now)
        assertEquals(3, list.live.size)
        assertTrue(list.expired.isEmpty())
        assertEquals(listOf("order-demo01aa-ab12c", "sale-demo03cc-ef56g", "order-demo02bb-cd34e"), list.live.map { it.id })
        val rows = DraftsLogic.rows(list.live, null, null, null, null, false, null)
        assertEquals(3, rows.size)
        assertTrue(rows.none { it.phoneOnly || it.native })
        assertEquals(2, rows.count { it.draft.isOrder })
        assertEquals(1, rows.count { it.draft.isSale })
        // A draft begun elsewhere opens in the ERP's own form.
        assertEquals("/orders/add?draft=order-demo01aa-ab12c&web=1", DraftsLogic.path(rows[0]))
        assertEquals("/invoices/new?draft=sale-demo03cc-ef56g&web=1", DraftsLogic.path(rows[1]))
        assertEquals("Last typed Today 12:35 pm on iPhone", DraftsLogic.lastTyped(rows[0], now))
        assertEquals("Order for Sana Demo.", DraftsLogic.discardMessage(rows[0]))
        assertEquals("Sale for Bilal Example.", DraftsLogic.discardMessage(rows[1]))
    }

    @Test fun aMonthOldDraftIsAskedToGoAndNotListed() {
        val old = WorkDemoBooks.drafts(now.minusSeconds(40L * 86_400))
        val list = draftList(old, now)
        assertTrue(list.live.isEmpty())
        assertEquals(3, list.expired.size)
    }

    @Test fun thePhonesOwnWorkComesFirstAndOpensTheNativeForm() {
        val order = NewOrderDraft(customerName = "Sana Demo").also {
            it.pieces = mutableListOf(NewOrderPieceDraft(description = "Plain band"))
        }
        val rows = DraftsLogic.rows(emptyList(), order, null, null, null, false, null)
        assertEquals(1, rows.size)
        val r = rows[0]
        assertTrue(r.phoneOnly && r.native)
        assertEquals("phone-order", r.id)
        assertEquals("Sana Demo", r.draft.title)
        assertEquals("/orders/add", DraftsLogic.path(r))
        assertEquals("On this phone", DraftsLogic.lastTyped(r, now))
        assertEquals(1, r.draft.items)
        assertTrue(r.draft.detail.startsWith("Plain band"))
    }

    @Test fun anOrderThatLeftDraftsIsNotShownAsThePhonesOwnWhenDraftsAreRead() {
        val order = NewOrderDraft(customerName = "Sana Demo").also {
            it.pieces = mutableListOf(NewOrderPieceDraft(description = "Plain band"))
        }
        // Drafts is read and no longer holds the draft that had been sent: it was finished or discarded at the counter.
        assertTrue(DraftsLogic.rows(emptyList(), order, null, "order-gone-abcde", null, true, null).isEmpty())
        // The same draft, found in Drafts, is that draft continued natively.
        val live = WorkDemoBooks.drafts(now).first { it.isOrder }
        val rows = DraftsLogic.rows(listOf(live), order, null, live.id, null, true, null)
        assertEquals(1, rows.size)
        assertTrue(rows[0].native && !rows[0].phoneOnly)
        assertEquals("/orders/add", DraftsLogic.path(rows[0]))
    }

    // MARK: The range of days

    @Test fun aRangeBindsNothingUntilAStartIsChosen() {
        val r = WorkRange(useFrom = false, useTo = true)
        assertNull(r.fromDay)
        assertNull(r.toDay)
        val from = WorkRange(useFrom = true, from = LocalDate.of(2026, 10, 3))
        assertEquals("2026-10-03", from.fromDay)
        // No end date: the range runs to the end of today.
        assertNull(from.toDay)
        assertEquals("2026-10-09", from.copy(useTo = true, to = LocalDate.of(2026, 10, 9)).toDay)
        // A start after the end carries the end.
        assertEquals(LocalDate.of(2026, 10, 20), from.copy(useTo = true, to = LocalDate.of(2026, 10, 9)).withFrom(LocalDate.of(2026, 10, 20)).to)
    }

    @Test fun addressesKeepAnIdInOnePiece() {
        assertEquals("/orders/ORD-D0002", WorkPaths.order("ORD-D0002"))
        assertEquals("/invoices/INV%2F1%3F", WorkPaths.invoice("INV/1?"))
    }

    // MARK: Activity

    @Test fun theDemoLogFiltersByKindAndDay() {
        val log = WorkDemoBooks.activity(now)
        assertEquals(10, log.size)
        val today = "2026-10-12"
        val all = ActivityLogRules.filter(log, "All", null, null, today)
        assertEquals(10, all.size)
        assertEquals("log-demo-1", all.first().id)
        assertEquals(listOf("log-demo-1", "log-demo-2"), ActivityLogRules.filter(log, "invoice", null, null, today).map { it.id })
        // 2 days back is the 10th in Karachi; from then to today holds the first four, and the 5th (100,000 s ago) too.
        val recent = ActivityLogRules.filter(log, "All", "2026-10-11", null, today)
        assertTrue(recent.map { it.id }.containsAll(listOf("log-demo-1", "log-demo-2", "log-demo-3")))
        assertFalse(recent.any { it.id == "log-demo-10" })
        assertEquals(listOf("invoice.create", "order.create", "expense.create"), ActivityLogRules.revertable)
        assertEquals(setOf("log-demo-1", "log-demo-3", "log-demo-5"), log.filter { ActivityLogRules.isRevertable(it.eventType) }.map { it.id }.toSet())
        assertEquals(ActivityLogRules.Tone.deleted, ActivityLogRules.tone(log.first { it.id == "log-demo-10" }.eventType))
        assertEquals("Invoice", ActivityLogRules.title("invoice"))
    }

    // MARK: Calendar

    @Test fun theDemoBooksLayOutAsTheCalendarDoes() {
        val days = shopCalendarDays(invoices, orders)
        assertTrue(days.isNotEmpty())
        val sales = days.values.sumOf { it.invoices }
        assertTrue(sales > 0)
        for ((key, day) in days) {
            assertEquals(day.invoices + day.orders, day.events.size)
            assertTrue(day.events.all { it.docId.isNotEmpty() })
            // Each event is on the day its document was taken.
            assertTrue(ShopCalendar.longDay(key).contains(key.take(4)))
            assertTrue(spoken(key, day, 0).startsWith(ShopCalendar.longDay(key)))
        }
        val today = ShopCalendar.today(now)
        val month = shopCalendarMonth(days, today.year, today.month)
        assertEquals(days.filterKeys { it.startsWith(ShopCalendar.monthKey(today.year, today.month)) }.values.sumOf { it.total }, month.total)
        val due = shopCalendarDue(orders)
        for ((key, n) in due) assertEquals(n, shopCalendarDueOn(key, orders).size)
    }

    @Test fun theGridStartsOnSundayAndTheMonthSteps() {
        val cells = ShopCalendar.cells(2026, 10)
        // 1 October 2026 is a Thursday: four gaps, then 31 days.
        assertEquals(4, cells.takeWhile { it == null }.size)
        assertEquals(31, cells.filterNotNull().size)
        assertEquals(ShopCalendar.YearMonth(2027, 1), ShopCalendar.step(2026, 12, 1))
        assertEquals(ShopCalendar.YearMonth(2025, 12), ShopCalendar.step(2026, 1, -1))
        assertEquals("850", ShopCalendar.dayMoney(850.0))
        assertEquals("12k", ShopCalendar.dayMoney(12_000.0))
    }
}
