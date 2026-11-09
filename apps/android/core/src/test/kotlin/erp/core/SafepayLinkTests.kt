package erp.core

import erp.core.logic.SafepayLink
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/safepay.ts `isSafepayPublicKey`, and the message the apps send with a link. Names and keys are made up. */
class SafepayLinkTests {
    @Test fun aPublicKeyStartsWithSecAndIsHexAndDashes() {
        assertTrue(SafepayLink.isPublicKey("sec_0123456789abcdef0123"))
        assertTrue(SafepayLink.isPublicKey("  sec_01234567-89ab-cdef-0123-456789abcdef \n"))
    }

    @Test fun anythingElseIsNotAPublicKey() {
        assertFalse(SafepayLink.isPublicKey(""))
        assertFalse(SafepayLink.isPublicKey("sec_short"))
        assertFalse(SafepayLink.isPublicKey("SEC_0123456789abcdef0123"))
        assertFalse(SafepayLink.isPublicKey("pub_0123456789abcdef0123"))
        assertFalse(SafepayLink.isPublicKey("sec_0123456789abcdef0123zz"))
        assertFalse(SafepayLink.isPublicKey("sec_" + "a".repeat(65)))
    }

    @Test fun theAmountStartsAtWhatIsOwedInWholeRupees() {
        assertEquals(12_500.0, SafepayLink.defaultAmount(12_500.4))
        assertEquals(0.0, SafepayLink.defaultAmount(0.4))
        assertEquals(0.0, SafepayLink.defaultAmount(-300.0))
    }

    @Test fun aLinkIsOfferedOnlyForAnOpenRecordWithSomethingOwed() {
        assertTrue(SafepayLink.offered("Pending", 100.0))
        assertFalse(SafepayLink.offered("Cancelled", 100.0))
        assertFalse(SafepayLink.offered("Refunded", 100.0))
        assertFalse(SafepayLink.offered("Pending", 0.5))
    }

    @Test fun theAmountIsBetweenOneRupeeAndFiftyMillion() {
        assertTrue(SafepayLink.isValidAmount(1.0))
        assertTrue(SafepayLink.isValidAmount(50_000_000.0))
        assertFalse(SafepayLink.isValidAmount(0.0))
        assertFalse(SafepayLink.isValidAmount(50_000_001.0))
        assertFalse(SafepayLink.isValidAmount(Double.NaN))
    }

    @Test fun theMessageNamesTheCustomerTheAmountTheRecordAndTheShop() {
        assertEquals(
            "Assalam o Alaikum Sara, please pay PKR 12,500 for INV-000123 here: https://pay.example/x — TAHERI",
            SafepayLink.message("Sara", 12_500.0, "INV-000123", "https://pay.example/x", "TAHERI"),
        )
        assertEquals(
            "Assalam o Alaikum, please pay PKR 900 for ORD-000001 here: https://pay.example/y — MINA",
            SafepayLink.message(null, 900.0, "ORD-000001", "https://pay.example/y", "MINA"),
        )
    }
}
