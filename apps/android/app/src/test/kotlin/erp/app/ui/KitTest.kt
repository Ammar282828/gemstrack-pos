package erp.app.ui

import erp.core.logic.Money
import erp.core.logic.OrderTiming
import erp.core.logic.PromiseState
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The kit's pure rules: what touches money input, phone numbers, names and the shop's words for a date. */
class KitTest {
    @Test
    fun paymentAmountReadsWhatWasTyped() {
        assertEquals(1500.0, PaymentText.amount("1,500"))
        assertEquals(1_500_000.0, PaymentText.amount("1,500,000"))
        // a region that types its decimal point as a comma: one or two digits after the last comma
        assertEquals(1500.0, PaymentText.amount("1500,4"))
        assertEquals(1500.0, PaymentText.amount("1500,45"))
        // whole rupees: paise typed are rounded away, a half going up
        assertEquals(1500.0, PaymentText.amount("1500.456"))
        assertEquals(1501.0, PaymentText.amount("1500.5"))
        assertEquals(1.0, PaymentText.amount(".5"))
        assertEquals(5.0, PaymentText.amount("  5. "))
        assertNull(PaymentText.amount(""))
        assertNull(PaymentText.amount("abc"))
        assertNull(PaymentText.amount("-5"))
        assertNull(PaymentText.amount("1.5f"))
    }

    @Test
    fun paymentFieldAndWords() {
        assertEquals("1500", PaymentText.field(1500.4))
        assertEquals("1501", PaymentText.field(1500.5))
        assertEquals("1500", PaymentText.field(1500.0))
        assertEquals("100", PaymentText.field(100.0))
        assertEquals("0", PaymentText.field(0.0))
        assertEquals("PKR 1,500", PaymentText.pkr(1500.0))
        assertEquals("PKR 1,500", PaymentText.pkr(1500.4))
        assertEquals("1500", PaymentText.whole("1,500.40"))
        assertEquals("1500", PaymentText.whole("1500"))
        assertEquals("", PaymentText.whole(""))
        assertEquals("15", PaymentText.whole("1x5"))
        assertEquals("Cheque no.", PaymentText.referenceLabel("Cheque"))
        assertEquals("Last 4 digits", PaymentText.referenceLabel("Card"))
        assertEquals("Reference", PaymentText.referenceLabel("Bank Transfer"))
        assertEquals("Note", PaymentText.referenceLabel("Cash"))
        assertEquals(listOf("Cash", "Card", "Bank Transfer", "Cheque"), PaymentMethods.all)
    }

    @Test
    fun overTheBalanceIsOnlyAnInvoicesAndRounded() {
        assertEquals(0.0, PaymentText.over(5000.0, 4000.0, forInvoice = false))
        assertEquals(1000.0, PaymentText.over(5000.0, 4000.0, forInvoice = true))
        assertEquals(-1000.0, PaymentText.over(3000.0, 4000.0, forInvoice = true))
        assertEquals(1.0, PaymentText.over(4000.5, 4000.0, forInvoice = true)) // a half goes away from zero
    }

    @Test
    fun whatsAppNumbers() {
        assertEquals("923001234567", toWhatsAppNumber("0300 1234567"))
        assertEquals("923001234567", toWhatsAppNumber("+92 300 1234567"))
        assertEquals("923001234567", toWhatsAppNumber("3001234567"))
        assertEquals("923001234567", toWhatsAppNumber("00923001234567"))
        assertEquals("447911123456", toWhatsAppNumber("+44 7911 123456"))
        assertEquals("", toWhatsAppNumber("n/a"))
    }

    @Test
    fun monogramLetters() {
        assertEquals("SD", monogramLetters("Sana Demo"))
        assertEquals("MH", monogramLetters("M. Hussain"))
        assertEquals("AB", monogramLetters("Ali-Bux Khan"))
        assertEquals("", monogramLetters("Walk-in Customer"))
        assertEquals("", monogramLetters(""))
    }

    @Test
    fun weightsAndSigns() {
        assertEquals("12.5 g · 1.072 tola", Weight.grams(12.5))
        assertEquals("1,234.57 g · 105.844 tola", Weight.grams(1234.567))
        assertEquals("− PKR 30,000", Money.signed(-30000.0))
        assertEquals("+ PKR 30,000", Money.signed(30000.0))
        assertEquals("− PKR 30,000", Money.minus(30000.0))
        assertEquals("− PKR 30,000", Money.minus(-30000.0))
        assertEquals("4.5 lac", heroFigure(450_000.0, lac = true))
        assertEquals("450,000", heroFigure(450_000.0, lac = false))
    }

    @Test
    fun promiseWords() {
        val day = Instant.parse("2026-10-14T00:00:00Z")
        assertEquals(PromiseWords.Said("Late 1 day", Tone.late), PromiseWords.say(OrderTiming(day, 0, PromiseState.late, false)))
        assertEquals(PromiseWords.Said("Late 3 days", Tone.late), PromiseWords.say(OrderTiming(day, 3, PromiseState.late, false)))
        assertEquals(PromiseWords.Said("Due today", Tone.owed), PromiseWords.say(OrderTiming(day, 0, PromiseState.today, false)))
        assertEquals(PromiseWords.Said("No date", Tone.quiet), PromiseWords.say(OrderTiming(null, 0, PromiseState.noPromise, false)))
        // inside the bench week it is owed, further off it says nothing
        assertEquals(Tone.owed, PromiseWords.say(OrderTiming(day, -3, PromiseState.upcoming, false)).tone)
        assertEquals(Tone.quiet, PromiseWords.say(OrderTiming(day, -20, PromiseState.upcoming, false)).tone)
    }

    @Test
    fun shopDates() {
        val now = Instant.parse("2026-10-12T10:00:00Z") // 3 pm in Karachi
        assertEquals("Today 4:05 pm", ShopDate.stamp(Instant.parse("2026-10-12T11:05:00Z"), withTime = true, now = now))
        assertEquals("Yesterday", ShopDate.stamp(Instant.parse("2026-10-11T08:00:00Z"), now = now))
        assertEquals("Tomorrow", ShopDate.stamp(Instant.parse("2026-10-13T08:00:00Z"), now = now))
        assertEquals("Tue 6 Oct", ShopDate.stamp(Instant.parse("2026-10-06T05:00:00Z"), now = now))
        assertEquals("6 Oct 2025", ShopDate.stamp(Instant.parse("2025-10-06T05:00:00Z"), now = now))
        assertEquals("", ShopDate.say("not a date", now = now))
    }

    @Test
    fun pdfNamesAreNeverPaths() {
        assertEquals("Invoice - Test Buyer.pdf", safeName("Invoice - Test Buyer.pdf"))
        assertEquals("a b.pdf", safeName("a/b"))
        assertEquals("Document.pdf", safeName("  "))
    }

    @Test
    fun cardColumnsFitTheWidth() {
        val dp = androidx.compose.ui.unit.Dp(0f)
        assertEquals(1, CardColumns.count(androidx.compose.ui.unit.Dp(360f)))
        assertEquals(2, CardColumns.count(androidx.compose.ui.unit.Dp(760f)))
        assertEquals(3, CardColumns.count(androidx.compose.ui.unit.Dp(1200f)))
        assertEquals(3, CardColumns.count(androidx.compose.ui.unit.Dp(2000f)))
        assertEquals(1, CardColumns.count(dp))
    }
}
