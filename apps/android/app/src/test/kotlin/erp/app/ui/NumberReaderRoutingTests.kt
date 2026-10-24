package erp.app.ui

import erp.app.screens.rates.RateKeys
import erp.app.screens.repairs.RepairsDraftPiece
import erp.app.screens.repairs.RepairsFormLogic
import erp.core.entry.NewOrderFormat
import erp.core.entry.SaleNumber
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Every amount and weight box reads through the one reader (core ShopNumber): the screens keep no reader of their own.
class NumberReaderRoutingTests {
    @Test fun aPaymentBoxReadsUrduAndArabicDigitsAndLakhCommas() {
        assertEquals(1500.0, PaymentText.amount("۱٬۵۰۰"))
        assertEquals(125000.0, PaymentText.amount("1,25,000"))
        assertEquals(1500.0, PaymentText.amount("١٥٠٠"))
        assertEquals(13.0, PaymentText.amount("12,5"), "a lone comma with one digit is a decimal point; whole rupees round half up")
        assertNull(PaymentText.amount("12abc"), "never a silent 0")
        assertEquals("1500", PaymentText.whole("۱۵۰۰"))
    }

    @Test fun aRateBoxReadsTheSameWay() {
        assertEquals(26250.5, RateKeys.parse("26,250.5"))
        assertEquals(26250.0, RateKeys.parse("٢٦٬٢٥٠"))
        assertNull(RateKeys.parse("two"))
    }

    @Test fun theSaleAndTheOrderReadTheSameWay() {
        assertEquals(150000.0, SaleNumber.value("1,50,000"))
        assertEquals(12.5, NewOrderFormat.num("12,5"))
        assertEquals(0.0, NewOrderFormat.num("12abc"))
        assertTrue(NewOrderFormat.unreadable("12abc"))
        assertFalse(NewOrderFormat.unreadable(""))
        assertTrue(NewOrderFormat.negative("-5"))
        assertTrue(NewOrderFormat.below0("-5"))
        assertFalse(NewOrderFormat.negative("abc"))
    }

    @Test fun aRepairPriceThatIsNotANumberHoldsSave() {
        val piece = RepairsDraftPiece(1L, "Ring", "Polish", "", "12abc")
        assertFalse(RepairsFormLogic.figuresReadable("", listOf(piece)))
        assertFalse(RepairsFormLogic.figuresReadable("x", listOf(piece.copy(price = "500"))))
        assertTrue(RepairsFormLogic.figuresReadable("", listOf(piece.copy(price = "۵۰۰"))))
        assertEquals(500.0, RepairsFormLogic.rupees("۵۰۰"))
    }
}
