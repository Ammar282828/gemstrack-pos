package erp.app.screens.money

import erp.core.models.Expense
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.KarigarBatch
import java.time.Instant
import java.time.ZoneId
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Money screens' own sums (MoneyLogic.swift, ExpenseEditing.swift), on made-up books. */
class MoneyLogicTests {
    // Monday 12 October 2026, noon in Karachi.
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private fun expense(id: String, day: String, amount: Double, category: String = "Shop", extra: Map<String, Any?> = emptyMap()): Expense =
        Expense.fromMap(mapOf("id" to id, "date" to "${day}T07:00:00.000Z", "category" to category, "description" to "Made up $id", "amount" to amount) + extra)

    private fun lines(vararg e: Expense): List<MoneyLine<Expense>> = e.map { MoneyLine(it, MoneyMonths.day(it.date), it.id) }

    // MARK: Paths

    @Test fun aLedgerPathCarriesWhoAndWhichBook() {
        assertEquals("/hisaab/CUST-1?type=customer", MoneyPaths.ledger("CUST-1", isCustomer = true))
        assertEquals("/hisaab/KAR-1?type=karigar&web=1", MoneyPaths.ledger("KAR-1", isCustomer = false, web = true))
        assertEquals("CUST-1", MoneyPaths.ledgerID("/hisaab/CUST-1?type=customer"))
    }

    @Test fun anIdWithASlashOrAQuestionMarkDoesNotSplitTheAddress() {
        val path = MoneyPaths.ledger("a/b?c", isCustomer = false)
        assertEquals("/hisaab/a%2Fb%3Fc?type=karigar", path)
        assertEquals("a/b?c", MoneyPaths.ledgerID(path))
    }

    @Test fun theListAndADeeperPathAreNotALedger() {
        assertNull(MoneyPaths.ledgerID("/hisaab"))
        assertNull(MoneyPaths.ledgerID("/hisaab/"))
        assertNull(MoneyPaths.ledgerID("/hisaab/x/y"))
        assertNull(MoneyPaths.ledgerID("/expenses"))
    }

    @Test fun theLedgerRouteTakesOnlyALedgerPath() {
        assertTrue(MoneyRoutes.any { it.matches("/hisaab/CUST-1?type=customer") })
        assertTrue(MoneyRoutes.any { it.matches("/hisaab") })
        assertFalse(MoneyRoutes.any { it.matches("/hisaab/x/y") })
        assertTrue(MoneyRoutes.any { it.matches("/expenses") })
        assertTrue(MoneyRoutes.any { it.matches("/additional-revenue") })
    }

    @Test fun aQueryValueIsReadDecoded() {
        assertEquals("karigar", MoneyPaths.query("type", "/hisaab/x?type=karigar&web=1"))
        assertEquals("1", MoneyPaths.query("web", "/hisaab/x?type=karigar&web=1"))
        assertNull(MoneyPaths.query("type", "/hisaab/x"))
        assertEquals("/repairs?id=R%2F1", MoneyPaths.repair("R/1"))
        assertEquals("/invoices/INV-000001", MoneyPaths.invoice("INV-000001"))
    }

    @Test fun gramsAreToTheMilligram() {
        assertEquals("25.600 g", MoneyFormat.grams(25.6))
        assertEquals("1,250.000 g", MoneyFormat.grams(1250.0))
        assertEquals("0.000 g", MoneyFormat.grams(0.0))
    }

    @Test fun searchIgnoresCaseAndAccents() {
        assertTrue(moneyContains("Café Sana", "cafe"))
        assertTrue(moneyContains("Sana Demo", "DEMO"))
        assertFalse(moneyContains("Sana Demo", "zzz"))
        assertTrue(moneyContains("anything", ""))
    }

    // MARK: Months and periods

    @Test fun aMonthKeyIsSaidInWords() {
        assertEquals("October 2026", MoneyMonths.title("2026-10"))
        assertEquals("No date", MoneyMonths.title("undated"))
    }

    @Test fun monthsKeepTheirOrderAndSumTheirRows() {
        val rows = lines(
            expense("a", "2026-10-11", 100.0), expense("b", "2026-10-02", 50.0), expense("c", "2026-09-30", 25.0),
            Expense.fromMap(mapOf("id" to "d", "date" to "", "amount" to 5.0)),
        )
        val months = MoneyMonths.group(rows, now) { it.amount }
        assertEquals(listOf("2026-10", "2026-09", "undated"), months.map { it.key })
        assertEquals(150.0, months[0].total)
        assertEquals("This month", months[0].hint)
        assertEquals("", months[1].hint)
        assertEquals("No date", months[2].title)
    }

    @Test fun eachPeriodIsAKarachiSpanOfDays() {
        assertEquals(MoneyDayRange("2026-10-01", "2026-10-12"), ExpensePeriod.thisMonth.range(now = now))
        assertEquals(MoneyDayRange("2026-09-01", "2026-09-30"), ExpensePeriod.lastMonth.range(now = now))
        assertEquals(MoneyDayRange("2026-09-13", "2026-10-12"), ExpensePeriod.last30.range(now = now))
        assertEquals(MoneyDayRange("2026-01-01", "2026-10-12"), ExpensePeriod.thisYear.range(now = now))
        assertTrue(ExpensePeriod.all.range(now = now).isOpen)
        assertEquals("2025-12", ExpensePeriod.previousMonth("2026-01-05"))
        assertEquals("2026-09", ExpensePeriod.previousMonth("2026-10-08"))
        assertEquals(
            listOf("This month", "Last month", "Last 30 days", "This year", "All time", "Custom range"),
            ExpensePeriod.values().map { it.title },
        )
    }

    @Test fun lastMonthInJanuaryIsDecember() {
        val jan = Instant.parse("2026-01-05T07:00:00Z")
        assertEquals(MoneyDayRange("2025-12-01", "2025-12-31"), ExpensePeriod.lastMonth.range(now = jan))
    }

    @Test fun aCustomSpanIsNoBoundUntilAStartIsPickedThenRunsToTheEndOfThatDayOrToday() {
        assertTrue(ExpensePeriod.custom.range(null, "2026-10-05", now).isOpen)
        assertEquals(MoneyDayRange("2026-10-01", "2026-10-12"), ExpensePeriod.custom.range("2026-10-01", null, now))
        assertEquals(MoneyDayRange("2026-10-01", "2026-10-05"), ExpensePeriod.custom.range("2026-10-01", "2026-10-05", now))
        val r = MoneyDayRange("2026-10-01", "2026-10-05")
        assertTrue(r.contains("2026-10-05"))
        assertFalse(r.contains("2026-10-06"))
        assertFalse(r.contains("2026-09-30"))
        assertFalse(r.contains(""))
        assertTrue(MoneyDayRange().contains(""))
        assertEquals("1 Oct – 5 Oct 2026", r.caption)
        assertNull(MoneyDayRange().caption)
    }

    @Test fun theCustomFieldsHoldNothingUntilFromIsOn() {
        val r = MoneyCustomRange()
        assertNull(r.fromDay)
        assertNull(r.toDay)
        assertTrue(r.range(now).isOpen)
        val on = r.copy(useFrom = true, from = java.time.LocalDate.of(2026, 10, 3), useTo = true, to = java.time.LocalDate.of(2026, 10, 7))
        assertEquals("2026-10-03", on.fromDay)
        assertEquals("2026-10-07", on.toDay)
        // An end date is nothing without a start.
        assertNull(r.copy(useTo = true).toDay)
        // A start after the end pulls the end along.
        assertEquals(java.time.LocalDate.of(2026, 10, 9), on.withFrom(java.time.LocalDate.of(2026, 10, 9)).to)
    }

    @Test fun weeksStartOnMonday() {
        assertEquals("2026-10-12", MoneyCalendar.weekStart("2026-10-12"))
        assertEquals("2026-10-12", MoneyCalendar.weekStart("2026-10-18"))
        assertEquals("2026-10-05", MoneyCalendar.weekStart("2026-10-11"))
        assertEquals("Monday 12 Oct", MoneyCalendar.say("2026-10-12", long = true))
        assertEquals("12 Oct", MoneyCalendar.say("2026-10-12"))
        assertEquals("12 Oct 2026", MoneyCalendar.sayFull("2026-10-12"))
        assertEquals("not a day", MoneyCalendar.say("not a day"))
    }

    @Test fun aPickedDayIsTheDayOnTheWall() {
        assertEquals("2026-03-04", MoneyCalendar.pickedDay(java.time.LocalDate.of(2026, 3, 4)))
    }

    // MARK: Buckets

    @Test fun daysAreTodayYesterdayOrTheWeekdayAndDate() {
        val d = MoneyBuckets.bucket("2026-10-12", ExpenseGrouping.day, now)
        assertEquals(MoneyBucket("d2026-10-12", "Today", "12 Oct 2026"), d)
        assertEquals("Yesterday", MoneyBuckets.bucket("2026-10-11", ExpenseGrouping.day, now).label)
        assertEquals(MoneyBucket("d2026-10-06", "Tuesday 6 Oct", "2026"), MoneyBuckets.bucket("2026-10-06", ExpenseGrouping.day, now))
    }

    @Test fun weeksAreNamedByTheirMonday() {
        assertEquals(MoneyBucket("w2026-10-12", "Week of 12 Oct", "This week"), MoneyBuckets.bucket("2026-10-14", ExpenseGrouping.week, now))
        assertEquals(MoneyBucket("w2026-10-05", "Week of 5 Oct", "2026"), MoneyBuckets.bucket("2026-10-07", ExpenseGrouping.week, now))
    }

    @Test fun monthsAreNamedWithTheirYear() {
        assertEquals(MoneyBucket("m2026-10", "October 2026", "This month"), MoneyBuckets.bucket("2026-10-01", ExpenseGrouping.month, now))
        assertEquals(MoneyBucket("m2026-08", "August 2026", ""), MoneyBuckets.bucket("2026-08-20", ExpenseGrouping.month, now))
        assertEquals(MoneyBucket("undated", "No date", ""), MoneyBuckets.bucket("", ExpenseGrouping.month, now))
    }

    @Test fun groupingKeepsTheNewestFirstOrderAndSubtotals() {
        val rows = lines(expense("a", "2026-10-12", 100.0), expense("b", "2026-10-12", 20.0), expense("c", "2026-10-11", 7.0))
        val groups = MoneyBuckets.group(rows, ExpenseGrouping.day, now) { it.amount }
        assertEquals(listOf("Today", "Yesterday"), groups.map { it.label })
        assertEquals(listOf(120.0, 7.0), groups.map { it.total })
        assertEquals(listOf("a", "b"), groups[0].rows.map { it.id })
    }

    // MARK: Figures

    @Test fun theSummaryMatchesThePage() {
        val rows = lines(
            expense("a", "2026-10-12", 600.0), expense("b", "2026-10-11", 100.0, extra = mapOf("karigarId" to "k1")),
            expense("c", "2026-10-11", 300.0, extra = mapOf("karigarId" to "k2")),
        )
        val groups = MoneyBuckets.group(rows, ExpenseGrouping.day, now) { it.amount }
        val s = ExpenseFigures.summary(rows, groups)
        assertEquals(1000.0, s.total)
        assertEquals(3, s.count)
        assertEquals(400.0, s.karigarTotal)
        assertEquals(40, s.karigarShare)
        assertEquals(500.0, s.perBucket)
        assertEquals("Today", s.biggestLabel)
        assertEquals(600.0, s.biggestTotal)
    }

    @Test fun anEmptySummaryHasADashAndNoDivisionByZero() {
        val s = ExpenseFigures.summary(emptyList(), emptyList())
        assertEquals(0.0, s.total)
        assertEquals(0, s.karigarShare)
        assertEquals(0.0, s.perBucket)
        assertEquals("—", s.biggestLabel)
    }

    @Test fun theKarigarShareRoundsAHalfUp() {
        val rows = lines(expense("a", "2026-10-12", 8.0, extra = mapOf("karigarId" to "k1")), expense("b", "2026-10-12", 192.0))
        // 4 percent exactly; and a third rounds to 33, two thirds to 67.
        assertEquals(4, ExpenseFigures.summary(rows, emptyList()).karigarShare)
        val third = lines(expense("a", "2026-10-12", 1.0, extra = mapOf("karigarId" to "k1")), expense("b", "2026-10-12", 2.0))
        assertEquals(33, ExpenseFigures.summary(third, emptyList()).karigarShare)
        val twoThirds = lines(expense("a", "2026-10-12", 2.0, extra = mapOf("karigarId" to "k1")), expense("b", "2026-10-12", 1.0))
        assertEquals(67, ExpenseFigures.summary(twoThirds, emptyList()).karigarShare)
    }

    @Test fun theFilterListIsTheHousesThenAnyOtherNameSorted() {
        val books = listOf(expense("a", "2026-10-12", 1.0, "Zed"), expense("b", "2026-10-12", 1.0, "Apple"), expense("c", "2026-10-12", 1.0, "Rent"))
        assertEquals(listOf("Rent", "Other", "Apple", "Zed"), ExpenseFigures.categories(listOf("Rent", "Other"), books))
        // The house's own list is kept whole, with "Other" where the ERP put it.
        assertEquals(listOf("Rent", "Other", "Apple", "Zed"), ExpenseFigures.formCategories(listOf("Rent", "Other"), books))
    }

    @Test fun withNoHouseListTheNamesInUseComeMostUsedFirstAndOtherLast() {
        val books = listOf(
            expense("a", "2026-10-12", 1.0, "Tea"), expense("b", "2026-10-12", 1.0, "Rent"), expense("c", "2026-10-12", 1.0, "Rent"),
            expense("d", "2026-10-12", 1.0, "Other"), expense("e", "2026-10-12", 1.0, "Other"), expense("f", "2026-10-12", 1.0, "Other"),
            expense("g", "2026-10-12", 1.0, ""),
        )
        assertEquals(listOf("Other", "Rent", "Tea"), ExpenseFigures.categories(emptyList(), books))
        assertEquals(listOf("Rent", "Tea", "Other"), ExpenseFigures.formCategories(emptyList(), books))
        // Ties go by name.
        assertEquals(listOf("Apple", "Zed"), ExpenseFigures.categoriesByUse(listOf(expense("a", "2026-10-12", 1.0, "Zed"), expense("b", "2026-10-12", 1.0, "Apple"))))
    }

    // MARK: Partners, numbers, hisaabs

    @Test fun thePartnersAndTheirSalaryWords() {
        assertEquals("Ammar", MoneyPartners.name("ammar"))
        assertEquals("Mina", MoneyPartners.name("mina"))
        assertNull(MoneyPartners.name("someone"))
        assertNull(MoneyPartners.name(null))
        assertEquals("Mina salary — August", MoneyPartners.salaryDescription("mina", "  August "))
        assertEquals("Partner Salary", MoneyPartners.salaryCategory)
        assertEquals("Partner Drawings", MoneyPartners.drawingsCategory)
    }

    @Test fun theAmountBoxTakesDigitsAndTheFirstDot() {
        assertEquals(125000.0, MoneyParse.amount("PKR 1,25,000"))
        assertEquals(1250.5, MoneyParse.amount("1 250.50"))
        assertEquals(1.23, MoneyParse.amount("1.234"))
        assertEquals(1.234, MoneyParse.amount("1.2345", maxDecimals = 3))
        assertEquals(1.57, MoneyParse.amount("1.5.7"))
        assertEquals(0.5, MoneyParse.amount(".5"))
        assertNull(MoneyParse.amount("."))
        assertNull(MoneyParse.amount(""))
        assertNull(MoneyParse.amount("abc"))
    }

    private fun batch(id: String, karigar: String, start: String, closed: String? = null) =
        KarigarBatch.fromMap(mapOf("id" to id, "karigarId" to karigar, "label" to id, "startDate" to "${start}T00:00:00.000Z") + (closed?.let { mapOf("closedDate" to "${it}T00:00:00.000Z") } ?: emptyMap()))

    @Test fun hisaabsAreHisOpenOneFirstThenTheNewest() {
        val all = listOf(
            batch("old", "k1", "2026-01-01", "2026-02-01"), batch("new", "k1", "2026-06-01", "2026-07-01"),
            batch("open-b", "k1", "2026-08-01"), batch("open-a", "k1", "2026-08-01"), batch("other", "k2", "2026-09-01"),
        )
        val mine = ExpenseFiling.batches("k1", all)
        assertEquals(listOf("open-a", "open-b", "new", "old"), mine.map { it.id })
        assertEquals("open-a", ExpenseFiling.defaultChoice("k1", mine))
        assertEquals(ExpenseFiling.direct, ExpenseFiling.defaultChoice("k1", mine.drop(2)))
        assertEquals("", ExpenseFiling.defaultChoice("", mine))
        assertEquals(emptyList(), ExpenseFiling.batches("", all))
        assertNull(ExpenseFiling.filedBatchId(ExpenseFiling.direct))
        assertNull(ExpenseFiling.filedBatchId(""))
        assertEquals("open-a", ExpenseFiling.filedBatchId("open-a"))
        assertEquals("Open", ExpenseFiling.hint(mine[0]))
        assertEquals("Settled 1 Jul 2026", ExpenseFiling.hint(mine[2]))
    }

    // MARK: The hisaab

    private fun entry(id: String, who: String, type: String, name: String, date: String, debit: Double = 0.0, credit: Double = 0.0, gold: Double = 0.0, goldIn: Double = 0.0, invoice: String? = null) =
        HisaabEntry.fromMap(
            mapOf(
                "id" to id, "entityId" to who, "entityType" to type, "entityName" to name, "date" to "${date}T07:00:00.000Z", "description" to "Row $id",
                "cashDebit" to debit, "cashCredit" to credit, "goldDebitGrams" to gold, "goldCreditGrams" to goldIn,
            ) + (invoice?.let { mapOf("linkedInvoiceId" to it) } ?: emptyMap()),
        )

    private fun invoice(id: String, customer: String?, total: Double, paid: Double, status: String? = null) =
        Invoice.fromMap(
            mapOf("id" to id, "grandTotal" to total, "amountPaid" to paid, "balanceDue" to total - paid, "createdAt" to "2026-10-01T07:00:00.000Z") +
                (customer?.let { mapOf("customerId" to it) } ?: emptyMap()) + (status?.let { mapOf("status" to it) } ?: emptyMap()),
        )

    private val entries = listOf(
        entry("1", "c1", "customer", "Sana Demo", "2026-10-01", debit = 50_000.0, gold = 5.0),
        entry("2", "c1", "customer", "Sana Demo", "2026-10-05", credit = 20_000.0),
        entry("3", "k1", "karigar", "Ustad Demo", "2026-10-02", credit = 12_000.0),
        entry("4", "walk-in", "customer", "x", "2026-10-03", debit = 4_000.0, invoice = "INV-2"),
        entry("5", "c2", "customer", "Settled Demo", "2026-10-03", debit = 100.0),
        entry("6", "c2", "customer", "Settled Demo", "2026-10-04", credit = 100.0),
        entry("7", "g1", "karigar", "Goldsmith Demo", "2026-10-04", goldIn = 2.5),
    )
    private val invoices = listOf(
        invoice("INV-1", "c1", 80_000.0, 30_000.0),
        invoice("INV-2", "walk-in", 4_000.0, 0.0),
        invoice("INV-3", "c1", 9_000.0, 0.0, status = "Refunded"),
        invoice("INV-4", "c1", 5_000.0, 5_000.0),
    )

    @Test fun theSummaryNetsEachPersonAndSkipsTheSettled() {
        val s = HisaabBook.summary(entries, invoices, setOf("c1", "c2"))
        assertEquals(listOf("Sana Demo", "Ustad Demo", "Goldsmith Demo", "Walk-in Customer").sorted(), s.accounts.map { it.name }.sorted())
        // Sorted by name, the walk-in under its fixed name.
        assertEquals(listOf("Goldsmith Demo", "Sana Demo", "Ustad Demo", "Walk-in Customer"), s.accounts.map { it.name })
        assertEquals(34_000.0, s.receivable)
        assertEquals(12_000.0, s.payable)
        assertEquals(5.0, s.receivableGold)
        assertEquals(2.5, s.payableGold)
    }

    @Test fun anAccountKnowsItsSideItsKindAndItsInvoices() {
        val s = HisaabBook.summary(entries, invoices, setOf("c1", "c2"))
        val sana = s.accounts.first { it.id == "c1" }
        assertTrue(sana.isCustomer)
        assertEquals(30_000.0, sana.cash)
        assertEquals(HisaabSide.get, sana.side)
        // Owing only: not the refunded one, not the paid one.
        assertEquals(listOf("INV-1"), sana.unpaid.map { it.id })
        assertEquals(50_000.0, sana.unpaid[0].balanceDue)
        val ustad = s.accounts.first { it.id == "k1" }
        assertFalse(ustad.isCustomer)
        assertEquals(HisaabSide.give, ustad.side)
        val walk = s.accounts.first { it.isWalkIn }
        assertEquals(listOf("INV-2"), walk.unpaid.map { it.id })
        // A balance held only in metal goes by the metal.
        val gold = s.accounts.first { it.id == "g1" }
        assertFalse(gold.hasCash)
        assertEquals(HisaabSide.give, gold.side)
        assertEquals(2.5, gold.size)
    }

    @Test fun aWordWeDoNotKnowIsACustomerOnlyIfTheBookHasThem() {
        val odd = listOf(entry("1", "x1", "mystery", "Odd One", "2026-10-01", debit = 10.0), entry("2", "x2", "mystery", "Odd Two", "2026-10-01", debit = 10.0))
        val s = HisaabBook.summary(odd, emptyList(), setOf("x1"))
        assertTrue(s.accounts.first { it.id == "x1" }.isCustomer)
        assertFalse(s.accounts.first { it.id == "x2" }.isCustomer)
    }

    @Test fun theChipsAndKindsFilterBySideAndByPerson() {
        val s = HisaabBook.summary(entries, invoices, setOf("c1", "c2"))
        assertEquals(setOf("c1", "walk-in"), s.accounts.filter { HisaabChip.get.matches(it) && it.hasCash }.map { it.id }.toSet())
        assertEquals(setOf("k1", "g1"), s.accounts.filter { HisaabChip.give.matches(it) }.map { it.id }.toSet())
        assertEquals(4, s.accounts.count { HisaabChip.all.matches(it) })
        assertEquals(setOf("c1", "walk-in"), s.accounts.filter { HisaabKind.customers.matches(it) }.map { it.id }.toSet())
        assertEquals(setOf("k1", "g1"), s.accounts.filter { HisaabKind.karigars.matches(it) }.map { it.id }.toSet())
        assertEquals(listOf("Sana Demo"), HisaabBook.scope(s.accounts, HisaabKind.everyone, " sana ").map { it.name })
        assertEquals(listOf("Sana Demo", "Walk-in Customer"), HisaabBook.scope(s.accounts, HisaabKind.customers, "").map { it.name })
    }

    @Test fun whoOwesYouFirstPutsTheBiggestDebtFirstThenWhatYouOwe() {
        val s = HisaabBook.summary(entries, invoices, setOf("c1", "c2"))
        val byName = HisaabBook.ordered(s.accounts, HisaabOrder.byName).map { it.id }
        assertEquals(listOf("g1", "c1", "k1", "walk-in"), byName)
        val owes = HisaabBook.ordered(s.accounts, HisaabOrder.owesFirst).map { it.id }
        // Get: Sana (30,000) then the walk-in (4,000); give: Ustad (cash) before the metal-only one.
        assertEquals(listOf("c1", "walk-in", "k1", "g1"), owes)
    }

    @Test fun aLedgerRunsOldestFirstThenReadsNewestFirstWithItsBalances() {
        val mine = entries.filter { it.entityId == "c1" }
        val page = HisaabLedger.page(mine.reversed())
        assertEquals(listOf("2", "1"), page.lines.map { it.id })
        assertEquals(30_000.0, page.cash)
        assertEquals(5.0, page.gold)
        assertTrue(page.hasGold)
        assertEquals(30_000.0, page.lines[0].cash)
        assertEquals(50_000.0, page.lines[1].cash)
        assertEquals(5.0, page.lines[1].gold)
    }

    @Test fun rowsOnTheSameInstantKeepAStableOrderById() {
        val twins = listOf(
            entry("b", "c1", "customer", "Sana Demo", "2026-10-01", debit = 10.0), entry("a", "c1", "customer", "Sana Demo", "2026-10-01", credit = 4.0),
        )
        val page = HisaabLedger.page(twins)
        assertEquals(listOf("b", "a"), page.lines.map { it.id })
        assertEquals(-4.0, page.lines[1].cash)
        assertEquals(6.0, page.cash)
        assertFalse(page.hasGold)
        assertTrue(HisaabLedger.page(emptyList()).lines.isEmpty())
    }

    // MARK: Editing

    @Test fun anAmountComesBackAsTheBoxShowedIt() {
        assertEquals("12000", ExpenseEditing.typed(12000.0))
        assertEquals("13", ExpenseEditing.typed(12.5)) // whole rupees, a half going up
        assertEquals("1250", ExpenseEditing.typed(1250.456))
        assertEquals("", ExpenseEditing.typed(0.0))
        assertEquals("", ExpenseEditing.typed(-3.0))
    }

    @Test fun theSameDayKeepsTheRowsOwnDateText() {
        val zone = ZoneId.of("Asia/Karachi")
        val original = "2026-10-08T05:30:00.000Z"
        assertEquals(original, ExpenseEditing.dateText(Instant.parse("2026-10-08T09:00:00Z"), original, zone))
        assertEquals("2026-10-09T09:00:00.000Z", ExpenseEditing.dateText(Instant.parse("2026-10-09T09:00:00Z"), original, zone))
        // Not a date: always the moment picked.
        assertEquals("2026-10-09T09:00:00.000Z", ExpenseEditing.dateText(Instant.parse("2026-10-09T09:00:00Z"), "", zone))
    }

    @Test fun thePayerIsAWordTheErpKnows() {
        assertEquals("business", ExpenseEditing.payerWord(expense("a", "2026-10-12", 1.0).paidBy))
        assertEquals("mina", ExpenseEditing.payerWord(expense("a", "2026-10-12", 1.0, extra = mapOf("paidBy" to "mina")).paidBy))
        assertEquals("ammar", ExpenseEditing.payerWord(expense("a", "2026-10-12", 1.0, extra = mapOf("paidBy" to "ammar")).paidBy))
        assertNull(ExpenseEditing.payerWord(expense("a", "2026-10-12", 1.0, extra = mapOf("paidBy" to "stranger")).paidBy))
        assertEquals(null, payerName(expense("a", "2026-10-12", 1.0).paidBy))
        assertEquals("Mina", payerName(expense("a", "2026-10-12", 1.0, extra = mapOf("paidBy" to "mina")).paidBy))
        assertEquals("Stranger", payerName(expense("a", "2026-10-12", 1.0, extra = mapOf("paidBy" to "STRANGER")).paidBy))
    }

    @Test fun aDrawingIsOnlyAnExpenseToChangeWhereTheHouseKeepsPartners() {
        val draw = expense("a", "2026-10-12", 1.0, "Partner Drawings")
        assertTrue(ExpenseEditing.isDrawing(draw, partnership = true))
        assertFalse(ExpenseEditing.isDrawing(draw, partnership = false))
        assertFalse(ExpenseEditing.isDrawing(expense("b", "2026-10-12", 1.0), partnership = true))
    }

    @Test fun aDeleteSaysWhatGoesAndWhatGoesWithIt() {
        val plain = expense("EXP-1", "2026-10-12", 12_000.0, "Utilities")
        assertEquals("Delete expense \"Made up EXP-1\"", ExpenseEditing.deleteWhat(plain))
        assertEquals("Made up EXP-1 — PKR 12,000.", ExpenseEditing.deleteDetail(plain))
        val bare = Expense.fromMap(mapOf("id" to "EXP-2", "category" to "Tea", "amount" to 5.0))
        assertEquals("Delete expense \"EXP-2\"", ExpenseEditing.deleteWhat(bare))
        assertEquals("Tea — PKR 5.", ExpenseEditing.deleteDetail(bare))
        val loan = expense("EXP-3", "2026-10-12", 900.0, extra = mapOf("paidBy" to "ammar", "ledgerEntryId" to "L-1"))
        assertEquals("Ammar", ExpenseEditing.fronted(loan))
        assertTrue(ExpenseEditing.deleteDetail(loan).endsWith("The loan on Ammar's ledger, for the cash Ammar put in, is deleted with it."))
        // No ledger row, no loan to mention.
        assertNull(ExpenseEditing.fronted(expense("EXP-4", "2026-10-12", 1.0, extra = mapOf("paidBy" to "ammar"))))
    }

    @Test fun theSubtitleSaysWhenWhatAndWhoItWentTo() {
        val e = expense("a", "2026-10-12", 1.0, "Karigar", extra = mapOf("karigarId" to "k1", "shareholderId" to "mina", "paidBy" to "ammar"))
        val said = expenseSubtitle(e, mapOf("k1" to "Ustad Demo"))
        assertTrue(said.contains("Karigar · Ustad Demo · Mina · paid by Ammar"), said)
    }

    @Test fun searchFindsTheKarigarPaidToo() {
        val e = expense("a", "2026-10-12", 1.0, "Karigar", extra = mapOf("karigarId" to "k1"))
        assertTrue(expenseMatches(e, "ustad", mapOf("k1" to "Ustad Demo")))
        assertTrue(expenseMatches(e, "KARIGAR", emptyMap()))
        assertFalse(expenseMatches(e, "nobody", mapOf("k1" to "Ustad Demo")))
        val range = MoneyDayRange("2026-10-12", "2026-10-12")
        assertEquals(1, scopedLines(listOf(e, expense("b", "2026-10-01", 1.0)), range, "", emptyMap()).size)
        assertEquals("This month · 1 Oct – 12 Oct 2026", periodLine(ExpensePeriod.thisMonth, ExpensePeriod.thisMonth.range(now = now)))
        assertEquals("All time", periodLine(ExpensePeriod.all, ExpensePeriod.all.range(now = now)))
    }
}
