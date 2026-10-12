package erp.app.screens.money

import erp.app.data.Demo
import erp.app.screens.owner.OverheadDraftLine
import erp.app.screens.owner.ShareholderBoardFigures
import erp.core.logic.Overheads
import erp.core.logic.RecentlyRemoved
import erp.core.models.AdditionalRevenue
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.Order
import erp.core.models.OverheadPlan
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The demo books go through the Money and Owner screens' logic without a gap (CONVENTIONS.md rule 13). */
class DemoMoneyTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private val books: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private fun <T> shelf(name: String, make: (Map<String, Any?>) -> T): List<T> = books[name].orEmpty().map(make)

    private val hisaab by lazy { shelf("hisaab") { HisaabEntry.fromMap(it) } }
    private val invoices by lazy { shelf("invoices") { Invoice.fromMap(it) } }
    private val orders by lazy { shelf("orders") { Order.fromMap(it) } }
    private val customers by lazy { shelf("customers") { Customer.fromMap(it) } }
    private val karigars by lazy { shelf("karigars") { Karigar.fromMap(it) } }
    private val batches by lazy { shelf("karigar_batches") { KarigarBatch.fromMap(it) } }
    private val expenses by lazy { shelf("expenses") { Expense.fromMap(it) } }
    private val revenue by lazy { shelf("additional_revenue") { AdditionalRevenue.fromMap(it) } }

    @Test fun theHisaabSummaryAndEveryLedgerAddUp() {
        assertTrue(hisaab.isNotEmpty())
        val s = HisaabBook.summary(hisaab, invoices, customers.mapTo(HashSet()) { it.id })
        assertTrue(s.accounts.isNotEmpty())
        assertEquals(s.accounts.sumOf { it.cash }, s.receivable - s.payable, 0.001)
        for (a in s.accounts) {
            val rows = hisaab.filter { it.entityId == a.id }
            val page = HisaabLedger.page(rows)
            assertEquals(rows.size, page.lines.size)
            assertEquals(a.cash, page.cash, 0.001)
            assertEquals(a.gold, page.gold, 0.001)
            LedgerPersonCheck.words(a)
        }
        for (o in HisaabOrder.values()) assertEquals(s.accounts.size, HisaabBook.ordered(s.accounts, o).size)
        for (k in HisaabKind.values()) HisaabBook.scope(s.accounts, k, "mock")
    }

    @Test fun expensesGroupAndSumInEveryPeriodAndGrouping() {
        assertTrue(expenses.isNotEmpty())
        val names = karigars.associate { it.id to it.name }
        for (p in ExpensePeriod.values()) {
            val scoped = scopedLines(expenses, p.range("2026-09-01", null, now), "", names)
            for (g in ExpenseGrouping.values()) {
                val groups = MoneyBuckets.group(scoped, g, now) { it.amount }
                assertEquals(scoped.size, groups.sumOf { it.rows.size })
                val s = ExpenseFigures.summary(scoped, groups)
                assertEquals(scoped.sumOf { it.item.amount }, s.total, 0.001)
                assertEquals(groups.sumOf { it.total }, s.total, 0.001)
                for (e in scoped) expenseSubtitle(e.item, names)
            }
        }
        val all = scopedLines(expenses, ExpensePeriod.all.range(now = now), "", names)
        assertEquals(expenses.size, all.size)
        assertTrue(ExpenseFigures.categories(emptyList(), expenses).isNotEmpty())
        assertTrue(ExpenseFigures.formCategories(emptyList(), expenses).last() == "Other")
        for (e in expenses) {
            ExpenseEditing.deleteWhat(e)
            ExpenseEditing.deleteDetail(e)
            ExpenseEditing.typed(e.amount)
        }
    }

    @Test fun karigarsAndTheirHisaabsOfferTheRightFiling() {
        for (k in karigars) {
            val mine = ExpenseFiling.batches(k.id, batches)
            val choice = ExpenseFiling.defaultChoice(k.id, mine)
            assertTrue(choice.isNotEmpty())
            mine.forEach { ExpenseFiling.hint(it) }
        }
        // The demo's first karigar has an open hisaab and a settled one.
        val first = ExpenseFiling.batches("KAR-D1", batches)
        assertEquals(2, first.size)
        assertTrue(ExpenseFiling.isOpen(first[0]))
        assertEquals(first[0].id, ExpenseFiling.defaultChoice("KAR-D1", first))
    }

    @Test fun extraRevenueGroupsByMonthAndFiltersByDate() {
        assertTrue(revenue.isNotEmpty())
        val shown = revenueLines(revenue, "", MoneyCustomRange(), now)
        assertEquals(revenue.size, shown.size)
        val months = MoneyMonths.group(shown, now) { it.amount }
        assertEquals(revenue.sumOf { it.amount }, months.sumOf { it.total }, 0.001)
        assertEquals(1, revenueLines(revenue, "polish", MoneyCustomRange(), now).size)
        val from = MoneyCustomRange(useFrom = true, from = java.time.LocalDate.of(2026, 10, 10), useTo = false)
        assertTrue(revenueLines(revenue, "", from, now).size < revenue.size)
    }

    @Test fun theOwnersPagesWorkOutFromTheDemoBooks() {
        // Overheads: the score from the books, with no sheet saved (a plan the ERP would have supplied is not in the demo).
        val byMonth = Overheads.revenueByMonth(invoices, orders)
        val rows = Overheads.monthlyRows(emptyList<OverheadPlan>(), byMonth, now)
        Overheads.benchmarkSummary(rows)
        assertTrue(OverheadDraftLine.lines(emptyList()).isEmpty())
        // Shareholders: the partners' own books are not in the demo, and the page still draws.
        val f = ShareholderBoardFigures.of(expenses, invoices, orders, revenue, emptyList(), emptyList())
        assertEquals(2, f.positions.size)
        assertTrue(f.totals.totalRevenue >= 0)
        // Recently removed: the history count reads the same books.
        val history = RecentlyRemoved.removedHistory(hisaab, orders)
        assertTrue(history.values.all { it.entries >= 0 && it.orders >= 0 })
    }
}

/** What an account row prints, for every account of the demo. */
private object LedgerPersonCheck {
    fun words(a: HisaabAccount) {
        MoneyFormat.grams(a.gold)
        MoneyPaths.ledger(a.id, a.isCustomer)
    }
}
