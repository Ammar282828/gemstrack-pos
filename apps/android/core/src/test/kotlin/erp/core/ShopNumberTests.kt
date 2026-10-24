package erp.core

import erp.core.logic.ShopNumber
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ShopNumberTests {
    @Test
    fun golden() {
        val cases: List<Pair<String, Double?>> = listOf(
            "1500" to 1500.0, "1,500" to 1500.0, "1,50,000" to 150000.0, "1,25,000" to 125000.0, "26,250" to 26250.0,
            "1,250.50" to 1250.5, "12,5" to 12.5, "22,50" to 22.5, "1500,5" to 1500.5, "12.5" to 12.5, ".5" to 0.5, "5." to 5.0,
            "١٢٣" to 123.0, "۱۲۳" to 123.0, "١٬٥٠٠" to 1500.0, "١٢٫٥" to 12.5, "1٫5" to 1.5,
            "PKR 1,500" to 1500.0, "Rs. 2 500" to 2500.0, "rs1,000" to 1000.0,
            "" to null, "   " to null, "abc" to null, "1.2.3" to null, "1,5000" to null, "12,5.5" to null, "-5" to null,
            "," to null, "." to null, "1e5" to null,
        )
        for ((text, want) in cases) assertEquals(want, ShopNumber.parse(text), text)
    }

    @Test
    fun unreadable() {
        assertFalse(ShopNumber.isUnreadable(""))
        assertFalse(ShopNumber.isUnreadable("12,5"))
        assertTrue(ShopNumber.isUnreadable("12abc"))
    }
}
