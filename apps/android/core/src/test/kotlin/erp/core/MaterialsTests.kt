package erp.core

import erp.core.logic.KARATS_BY_METAL
import erp.core.logic.KARAT_VALUES
import erp.core.logic.METAL_TYPES
import erp.core.logic.describeDelivery
import erp.core.logic.describeMetal
import erp.core.logic.describePlating
import erp.core.logic.describeSettings
import erp.core.logic.karatLabel
import erp.core.logic.karatsFor
import erp.core.logic.metalHasKarat
import erp.core.logic.metalLabel
import erp.core.models.DeliveryInfo
import erp.core.models.InvoiceItem
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.OrderItem
import erp.core.models.Product
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * src/lib/materials.ts has no TS test. The answers here were taken from running the TS (and its
 * own doc comments); the one place the port differs is the delivery day's format.
 */
class MaterialsTests {
    private fun orderItem(fields: Map<String, Any?>): OrderItem = ERPDecode.model<OrderItem>(fields)!!
    private fun invoiceItem(fields: Map<String, Any?>): InvoiceItem = ERPDecode.model<InvoiceItem>(fields)!!
    private fun delivery(fields: Map<String, Any?>): DeliveryInfo = ERPDecode.model<DeliveryInfo>(fields)!!

    @Test
    fun testWhichKaratsEachMetalIsSoldIn() {
        assertEquals(listOf(KaratValue.k18, KaratValue.k21, KaratValue.k22, KaratValue.k24), karatsFor("gold"))
        assertEquals(listOf(KaratValue.k12, KaratValue.k18), karatsFor("palladium"))
        assertEquals(emptyList(), karatsFor("platinum"))
        assertEquals(emptyList(), karatsFor("silver"))
        assertEquals(emptyList(), karatsFor("titanium"))
        assertEquals(emptyList(), karatsFor(null as String?))
        assertEquals(listOf(KaratValue.k18, KaratValue.k21, KaratValue.k22, KaratValue.k24), karatsFor(MetalType.gold))
        assertEquals(METAL_TYPES.size, KARATS_BY_METAL.keys.size)
        assertEquals(listOf("12k", "18k", "21k", "22k", "24k"), KARAT_VALUES.map { it.rawValue })
    }

    @Test
    fun testOnlyGoldAndPalladiumCarryAKarat() {
        assertTrue(metalHasKarat("gold"))
        assertTrue(metalHasKarat("palladium"))
        assertFalse(metalHasKarat("platinum"))
        assertFalse(metalHasKarat("silver"))
        assertFalse(metalHasKarat(null as String?))
        assertTrue(metalHasKarat(MetalType.palladium))
    }

    @Test
    fun testHowAMetalIsNamedToAHuman() {
        assertEquals("Gold", metalLabel("gold"))
        assertEquals("Palladium", metalLabel("palladium"))
        assertEquals("Platinum", metalLabel("platinum"))
        assertEquals("925 Sterling Silver", metalLabel("silver"))
        assertEquals("Titanium", metalLabel("titanium"))
        assertEquals("", metalLabel(""))
        assertEquals("", metalLabel(null as String?))
        assertEquals("925 Sterling Silver", metalLabel(MetalType.silver))
    }

    @Test
    fun testKaratLabelsAreUpperCase() {
        assertEquals("21K", karatLabel("21k"))
        assertEquals("", karatLabel(""))
        assertEquals("", karatLabel(null as String?))
        assertEquals("22K", karatLabel(KaratValue.k22))
    }

    @Test
    fun testDescribeMetalAsItsDocCommentSaysSilverIgnoringTheKarat() {
        assertEquals("Gold (21K)", describeMetal("gold", "21k"))
        assertEquals("Palladium (18K)", describeMetal("palladium", "18k"))
        assertEquals("925 Sterling Silver", describeMetal("silver", "21k"))
        assertEquals("Gold", describeMetal("gold"))
        assertEquals("Gold", describeMetal("gold", ""))
        assertEquals("Platinum", describeMetal("platinum", "24k"))
        assertEquals("", describeMetal(null as String?, "21k"))
        assertEquals("Gold (21K)", describeMetal(MetalType.gold, KaratValue.k21))
        assertEquals("925 Sterling Silver", describeMetal(MetalType.silver, KaratValue.k21))
    }

    @Test
    fun testTheFinishOnASilverPiece() {
        fun plating(fields: Map<String, Any?>): String? = describePlating(orderItem(fields))
        assertNull(plating(mapOf("metalType" to "gold", "platingType" to "White Rhodium")))
        assertNull(plating(mapOf("metalType" to "silver")))
        assertEquals("White Rhodium · Nickel free", plating(mapOf("metalType" to "silver", "platingType" to "White Rhodium", "nickelFree" to true)))
        assertEquals("matte black", plating(mapOf("metalType" to "silver", "platingType" to "Other", "platingNote" to "  matte black  ")))
        // "Other" with no note says "Other".
        assertEquals("Other", plating(mapOf("metalType" to "silver", "platingType" to "Other", "platingNote" to "   ")))
        assertEquals("Other", plating(mapOf("metalType" to "silver", "platingType" to "Other")))
        assertEquals("Nickel free", plating(mapOf("metalType" to "silver", "nickelFree" to true)))
        assertEquals("21K Gold Plating", plating(mapOf("metalType" to "silver", "platingType" to "21K Gold Plating")))
        // The three piece models read the same way.
        assertEquals("Nickel free", describePlating(invoiceItem(mapOf("metalType" to "silver", "nickelFree" to true))))
        assertEquals("Black", describePlating(ERPDecode.model<Product>(mapOf("sku" to "A", "metalType" to "silver", "platingType" to "Black"))!!))
    }

    @Test
    fun testWhatIsActuallySetIntoAPieceOnlyWhatWasRecorded() {
        fun lines(fields: Map<String, Any?>): List<String> = describeSettings(orderItem(fields))
        assertEquals(
            listOf("Diamonds: 1.12ct VVS2 · round", "Stones: 4 rubies", "Stone weight: 0.46g"),
            lines(mapOf("metalType" to "gold", "diamondDetails" to " 1.12ct VVS2\n  round ", "stoneDetails" to "4 rubies", "stoneWeightG" to 0.456)),
        )
        assertEquals(emptyList(), lines(mapOf("metalType" to "gold")))
        assertEquals(
            listOf("Stone weight: 1.00g", "Finish: White Rhodium · Nickel free"),
            lines(mapOf("metalType" to "silver", "platingType" to "White Rhodium", "nickelFree" to true, "stoneWeightG" to 1)),
        )
        assertEquals(listOf("Stones: a · b", "Stone weight: 0.01g"), lines(mapOf("metalType" to "gold", "stoneDetails" to "a\r\n\r\n b", "stoneWeightG" to 0.005)))
        // toFixed works on the double's exact value: 1.005 is a hair under, 0.125 and 12.345 round up.
        assertEquals(listOf("Stone weight: 1.00g"), lines(mapOf("metalType" to "gold", "stoneWeightG" to 1.005)))
        assertEquals(listOf("Stone weight: 0.13g"), lines(mapOf("metalType" to "gold", "stoneWeightG" to 0.125)))
        assertEquals(listOf("Stone weight: 12.35g"), lines(mapOf("metalType" to "gold", "stoneWeightG" to 12.345)))
        // A charge alone describes nothing.
        assertEquals(emptyList(), lines(mapOf("metalType" to "gold", "diamondCharges" to 45000, "stoneCharges" to 1000)))
        assertEquals(listOf("Stones: 4 rubies"), describeSettings(invoiceItem(mapOf("metalType" to "gold", "stoneDetails" to "4 rubies"))))
    }

    @Test
    fun testTheDeliveryBlockIsEmptyUnlessTheSaleIsBeingDelivered() {
        assertEquals(emptyList(), describeDelivery(null))
        assertEquals(emptyList(), describeDelivery(delivery(mapOf("required" to false, "address" to "x"))))
        assertEquals(emptyList(), describeDelivery(delivery(mapOf("required" to true, "address" to "  "))))
        assertEquals(listOf("12 Example Road, Karachi"), describeDelivery(delivery(mapOf("required" to true, "address" to " 12 Example Road ", "city" to " Karachi "))))
        assertEquals(
            listOf("Sana Example · 0300 0000001", "12 Example Road", "Gate code 1234"),
            describeDelivery(
                delivery(
                    mapOf(
                        "required" to true, "address" to "12 Example Road", "contactName" to "Sana Example",
                        "contactPhone" to "0300 0000001", "notes" to " Gate code 1234 ",
                    ),
                ),
            ),
        )
        assertEquals(
            listOf("0300 0000001", "12 Example Road"),
            describeDelivery(delivery(mapOf("required" to true, "address" to "12 Example Road", "contactPhone" to "0300 0000001"))),
        )
    }

    @Test
    fun testTheExpectedDayIsPrintedAsKarachisDay() {
        assertEquals(
            listOf("12 Example Road", "Expected 5 Oct 2026"),
            describeDelivery(delivery(mapOf("required" to true, "address" to "12 Example Road", "expectedDate" to "2026-10-05"))),
        )
        // 19:30 UTC is already the next day in Karachi.
        assertEquals(
            listOf("12 Example Road", "Expected 5 Oct 2026"),
            describeDelivery(delivery(mapOf("required" to true, "address" to "12 Example Road", "expectedDate" to "2026-10-04T19:30:00.000Z"))),
        )
        // An unreadable day is left off, as the TS leaves off an invalid date.
        assertEquals(listOf("12 Example Road"), describeDelivery(delivery(mapOf("required" to true, "address" to "12 Example Road", "expectedDate" to "soon"))))
    }
}
