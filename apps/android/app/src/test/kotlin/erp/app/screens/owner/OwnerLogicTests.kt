package erp.app.screens.owner

import erp.app.ui.OwnerDeletion
import erp.core.logic.Overheads
import erp.core.logic.RecentlyRemoved
import erp.core.logic.ShareholderFigures
import erp.core.models.Customer
import erp.core.models.Expense
import erp.core.models.Karigar
import erp.core.models.OverheadItem
import erp.core.models.PartnerLedgerCategory
import erp.core.models.ShareholderLedgerRow
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Owner group's own words and small rules (OwnerKit.swift, OverheadsScreen.swift, ShareholderSheets.swift). */
class OwnerLogicTests {
    // MARK: Words

    @Test fun moneyIsInWholeRupeesAndAMinusIsARealMinus() {
        assertEquals("PKR 30,000", OwnerText.pkr(30_000.0))
        assertEquals("+ PKR 30,000", OwnerText.signed(30_000.0))
        assertEquals("− PKR 6,000", OwnerText.signed(-6_000.0))
        assertEquals("+ PKR 0", OwnerText.signed(0.0))
    }

    @Test fun theFormsDayIsKarachisDay() {
        // 11 pm in London is already the next morning in Karachi.
        assertEquals("2026-10-10", OwnerText.day(Instant.parse("2026-10-09T22:30:00Z")))
        assertEquals("2026-10-09", OwnerText.day(Instant.parse("2026-10-09T10:00:00Z")))
    }

    @Test fun aShortDateIsDayMonthYear() {
        assertEquals("1 Oct 2026", OwnerText.shortDate("2026-10-01T07:00:00.000Z"))
        assertEquals("2 Jul 2025", OwnerText.shortDate(ShareholderFigures.expenseCutoff))
        assertEquals("", OwnerText.shortDate("soon"))
        assertEquals("", OwnerText.shortDate(null))
    }

    @Test fun theDeleteAsksCarryTheirWordsAndFinality() {
        val ask = OwnerDeletion("Delete this thing", "Remove it?", run = { })
        assertEquals("Delete this thing", ask.what)
        assertEquals("Remove it?", ask.detail)
        assertTrue(ask.final)
        assertFalse(OwnerDeletion("Put back", "Maybe", run = { }, final = false).final)
    }

    // MARK: Overheads

    @Test fun aLineIsTypedAsTheBoxShowsItAndReadAsTheWebReadsIt() {
        val line = OverheadDraftLine(OverheadItem("rent", "Rent", 120_000.0))
        assertEquals("120000", line.amountText)
        assertEquals(OverheadItem("rent", "Rent", 120_000.0), line.item)
        // Zero is blank (decision "Number fields"), and blank is nothing.
        val zero = OverheadDraftLine(OverheadItem("tea", "Tea", 0.0))
        assertEquals("", zero.amountText)
        assertEquals(0.0, zero.item.amount)
        assertEquals(1251.0, OverheadDraftLine("x", "Y", "PKR 1,250.50").item.amount)
        assertEquals(0.0, OverheadDraftLine("x", "Y", "nothing").item.amount)
    }

    @Test fun aNewLineIsBlankAndItsOwn() {
        val items = listOf(OverheadItem("item-1", "Rent", 1.0))
        val fresh = OverheadDraftLine(Overheads.newOverheadId(items))
        assertEquals("", fresh.label)
        assertEquals("", fresh.amountText)
        assertTrue(items.none { it.id == fresh.id })
        // A draft equals the saved sheet it was made from, so nothing looks changed until it is.
        val saved = listOf(OverheadItem("rent", "Rent", 100.0), OverheadItem("tea", "Tea", 5.5))
        assertEquals(OverheadDraftLine.lines(saved), OverheadDraftLine.lines(saved))
        assertTrue(OverheadDraftLine.lines(saved) != OverheadDraftLine.lines(saved.dropLast(1)))
    }

    @Test fun savingGivesEveryLineItsOwnIdAndTheWritesFields() {
        val typed = listOf(
            OverheadItem("rent", "Rent", 100.0), OverheadItem("rent", "Rent again", 50.0), OverheadItem("", "Old line", 7.0),
        )
        val kept = OverheadsSave.withUniqueIds(typed)
        assertEquals(3, kept.map { it.id }.toSet().size)
        assertTrue(kept.none { it.id.isEmpty() })
        assertEquals("rent", kept[0].id)
        val fields = OverheadsSave.fields(kept, "seq-1")
        assertEquals("seq-1", fields["seq"])
        @Suppress("UNCHECKED_CAST")
        val sent = fields["items"] as List<Map<String, Any?>>
        assertEquals(listOf("id", "label", "amount"), sent[0].keys.toList())
        assertEquals(100.0, sent[0]["amount"])
        assertEquals(setOf("items", "seq"), fields.keys)
    }

    @Test fun theDaysLeftLineAndTheRecordLineAreInTheShopsWords() {
        val p = Overheads.overheadProgress(100_000.0, 20_000.0, Instant.parse("2026-10-12T07:00:00Z"))
        assertEquals(20, p.daysLeft)
        assertTrue(daysLine(p, met = false).startsWith("20 days left · PKR "))
        assertTrue(daysLine(p, met = false).endsWith("/day"))
        assertEquals("20 days left", daysLine(p, met = true))
        val last = Overheads.overheadProgress(100_000.0, 20_000.0, Instant.parse("2026-10-31T07:00:00Z"))
        assertEquals("1 day left · PKR 80,000/day", daysLine(last, met = false))

        val none = Overheads.benchmarkSummary(emptyList())
        assertEquals("Nothing scored yet — September 2026 is the first full month.", summaryLine(none))
    }

    // MARK: Shareholders

    @Test fun thePagesMoneyHasNoSignAndAsignedOneHasARealMinus() {
        assertEquals("PKR 31,750", ShareholderMoney.fmt(31_750.4))
        assertEquals("PKR 6,000", ShareholderMoney.fmt(-6_000.0))
        assertEquals("+PKR 31,750", ShareholderMoney.signed(31_750.0))
        assertEquals("−PKR 6,000", ShareholderMoney.signed(-6_000.0))
        assertEquals("+PKR 0", ShareholderMoney.signed(0.0))
    }

    @Test fun theTwoPartnersAreMinaThenAmmarEachWithTheirOwnBook() {
        assertEquals(listOf("mina", "ammar"), ShareholderPerson.all.map { it.id })
        assertEquals("mina_ledger", ShareholderPerson.named("mina")?.ledger)
        assertEquals("ammar_ledger", ShareholderPerson.named("ammar")?.ledger)
        assertNull(ShareholderPerson.named("someone"))
    }

    @Test fun eachMoveHasItsWords() {
        assertEquals("Pay a salary", ShareholderMove.salary.title)
        assertEquals("Withdraw capital", ShareholderMove.withdrawal.title)
        assertEquals("Add a contribution", ShareholderMove.contribution.title)
        assertEquals("Pay salary", ShareholderMove.salary.action)
        assertEquals("Record withdrawal", ShareholderMove.withdrawal.action)
        assertEquals("Record contribution", ShareholderMove.contribution.action)
        assertEquals("e.g. August", ShareholderMove.salary.placeholder)
        assertEquals("contribution", ShareholderMove.contribution.raw)
        assertEquals("withdrawal", ShareholderMove.withdrawal.raw)
        assertEquals("salary-mina", ShareholderAsk(ShareholderMove.salary, "mina").id)
    }

    @Test fun theTreatedAsHintFollowsTheMoveAndTheCategory() {
        assertEquals("Equity: reduces their stake in the business.", categoryHint(ShareholderMove.withdrawal, PartnerLedgerCategory.equity))
        assertEquals("Loan: repayment of funds they lent.", categoryHint(ShareholderMove.withdrawal, PartnerLedgerCategory.loan))
        assertEquals("Equity: their stake in the business.", categoryHint(ShareholderMove.contribution, PartnerLedgerCategory.equity))
        assertEquals("Loan: repaid before profits are distributed.", categoryHint(ShareholderMove.contribution, PartnerLedgerCategory.loan))
    }

    @Test fun payingThePartnerWhoIsBehindEvensTheTwoUp() {
        val paid = mapOf("mina" to 100_000.0, "ammar" to 40_000.0)
        assertEquals("Mina is PKR 60,000 ahead on salary. Paying Ammar evens that up.", evensUp(ShareholderMove.salary, "ammar", paid))
        // The partner who is ahead has nobody to even up, and a gap under a rupee is no gap.
        assertNull(evensUp(ShareholderMove.salary, "mina", paid))
        assertNull(evensUp(ShareholderMove.salary, "ammar", mapOf("mina" to 100.5, "ammar" to 100.0)))
        assertNull(evensUp(ShareholderMove.contribution, "ammar", paid))
        assertNull(evensUp(ShareholderMove.salary, "nobody", paid))
    }

    private fun row(id: String, amount: Double, type: String, category: String = "equity", date: String = "2026-10-01T07:00:00.000Z", linked: String? = null) =
        ShareholderLedgerRow.fromMap(
            mapOf("id" to id, "description" to "Row $id", "amount" to amount, "date" to date, "type" to type, "category" to category) +
                (linked?.let { mapOf("linkedExpenseId" to it) } ?: emptyMap()),
        )

    private fun salary(id: String, who: String, amount: Double) =
        Expense.fromMap(mapOf("id" to id, "date" to "2026-10-02T07:00:00.000Z", "category" to "Partner Salary", "description" to "${who.replaceFirstChar { it.uppercase() }} salary — Sep", "amount" to amount, "shareholderId" to who))

    @Test fun thePageFiguresComeFromCoresRulesOverTheTwoBooks() {
        val f = ShareholderBoardFigures.of(
            expenses = listOf(salary("s1", "mina", 50_000.0), salary("s2", "ammar", 20_000.0)),
            invoices = emptyList(), orders = emptyList(), revenue = emptyList(),
            mina = listOf(row("m1", 200_000.0, "payment"), row("m2", 50_000.0, "withdrawal", linked = "e9"), row("m3", 70_000.0, "payment", "loan")),
            ammar = listOf(row("a1", 100_000.0, "payment")),
        )
        assertEquals(listOf("mina", "ammar"), f.positions.map { it.id })
        val mina = f.positions[0]
        assertEquals(270_000.0, mina.contributed)
        assertEquals(50_000.0, mina.withdrawn)
        assertEquals(50_000.0, mina.salaryPaid)
        assertEquals(70_000.0, mina.balance.loanBalance)
        assertEquals(150_000.0, mina.balance.equityBalance)
        // Salaries are a business cost split 50/50: the gap moves half of itself between the two.
        val gap = f.gap
        assertEquals("Mina", gap?.ahead?.name)
        assertEquals(15_000.0, gap?.transferred)
    }

    // MARK: Delete words and Recently removed

    @Test fun deletingASalaryAndALedgerEntrySayWhatGoesWithIt() {
        val f = ShareholderBoardFigures.of(
            listOf(salary("s1", "mina", 50_000.0)), emptyList(), emptyList(), emptyList(),
            listOf(row("m2", 50_000.0, "withdrawal", linked = "e9")), emptyList(),
        )
        val mina = f.positions[0]
        val s = askDeleteSalary(mina.salaries[0])
        assertEquals("Delete expense \"Mina salary — Sep\"", s.what)
        assertTrue(s.detail.startsWith("Remove this salary payment? Mina salary — Sep — PKR 50,000. It will be deleted from Expenses too."))
        val e = askDeleteEntry(mina.rows[0], mina)
        assertEquals("Delete this Mina ledger entry", e.what)
        assertEquals("Remove this entry? Row m2 — PKR 50,000. The matching Partner Drawings expense will be deleted too.", e.detail)
        val plain = askDeleteEntry(row("m3", 10.0, "payment"), mina)
        assertEquals("Remove this entry? Row m3 — PKR 10.", plain.detail)
    }

    @Test fun emptyingTheListCountsWhatItOrphans() {
        val c = Customer.fromMap(mapOf("id" to "c1", "name" to "Gone Demo", "deletedAt" to "2026-10-01T07:00:00.000Z"))
        val k = Karigar.fromMap(mapOf("id" to "k1", "name" to "Gone Karigar", "deletedAt" to "2026-10-01T07:00:00.000Z"))
        assertTrue(RecentlyRemoved.isRemoved(c.deletedAt))
        val none = emptyWarning(listOf(c), listOf(k), emptyMap())
        assertEquals("This permanently deletes 1 customer(s) and 1 karigar(s). This is the one thing in the app that cannot be undone.", none)
        val history = mapOf("c1" to RecentlyRemoved.History(entries = 3, orders = 1), "k1" to RecentlyRemoved.History(entries = 1))
        assertEquals(
            "This permanently deletes 1 customer(s) and 1 karigar(s). They carry 4 ledger entries and 1 order between them, which will be orphaned. " +
                "This is the one thing in the app that cannot be undone.",
            emptyWarning(listOf(c), listOf(k), history),
        )
    }
}
