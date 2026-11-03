package erp.app.screens.orders

import erp.core.models.OrderItem
import org.junit.Test
import kotlin.test.assertEquals

/** Send to karigar's payload and picks (docs/decisions.md "Send to karigar"); made-up pieces. */
class SendToKarigarLogicTests {
    private fun item(k: String?, description: String = "Ring") = OrderItem.fromMap(
        buildMap { put("description", description); if (k != null) put("karigarId", k) },
    )

    private val items = listOf(item("K1"), item(null), item("K2", " "), item("K1"))

    @Test fun opensOnTheAskedKarigarElseTheFirstPiecesElseAnyHolder() {
        assertEquals("K2", SendToKarigarLogic.firstKarigar(items, "K2", null))
        assertEquals("K2", SendToKarigarLogic.firstKarigar(items, null, listOf(2)))
        assertEquals("K1", SendToKarigarLogic.firstKarigar(items, null, listOf(1)))
        assertEquals("", SendToKarigarLogic.firstKarigar(listOf(item(null)), null, null))
    }

    @Test fun piecesAskedThenHisThenAll() {
        assertEquals(setOf(1, 2), SendToKarigarLogic.initialPieces(items, "K1", listOf(1, 2, 9)))
        assertEquals(setOf(0, 3), SendToKarigarLogic.initialPieces(items, "K1", null))
        assertEquals(setOf(0, 1, 2, 3), SendToKarigarLogic.initialPieces(items, "K9", emptyList()))
        assertEquals(setOf(0, 1, 2, 3), SendToKarigarLogic.initialPieces(items, "", null))
    }

    @Test fun bodyCarriesOnlyWhatWasChosen() {
        assertEquals(
            mapOf("orderId" to "ORD-1", "pieceIndexes" to listOf(0, 3), "karigarId" to "K1", "phone" to "0300 1234567", "preview" to true),
            SendToKarigarLogic.body("ORD-1", "K1", setOf(3, 0), " 0300 1234567 ", preview = true),
        )
        assertEquals(mapOf("orderId" to "ORD-1", "pieceIndexes" to listOf(1)), SendToKarigarLogic.body("ORD-1", "", listOf(1), "  ", preview = false))
    }

    @Test fun numberNeedsElevenToFifteenDigits() {
        assertEquals(true, SendToKarigarLogic.numberOK("0300 1234567"))
        assertEquals(false, SendToKarigarLogic.numberOK("12345"))
        assertEquals(false, SendToKarigarLogic.numberOK(""))
    }

    @Test fun previewAndSentWordsFromTheRoutesAnswers() {
        val p = SendToKarigarLogic.preview(mapOf("message" to "Order ORD-1", "messages" to listOf(mapOf("photos" to 2))))
        assertEquals(SendToKarigarLogic.Preview("Order ORD-1", 2), p)
        assertEquals(SendToKarigarLogic.Preview("", 0), SendToKarigarLogic.preview(emptyMap()))
        assertEquals("2 reference photos go first. No prices are sent.", SendToKarigarLogic.photosNote(2))
        assertEquals("1 reference photo go first. No prices are sent.", SendToKarigarLogic.photosNote(1))
        assertEquals("No prices are sent.", SendToKarigarLogic.photosNote(0))
        assertEquals("3 messages to 03•••567 · 1 photo did not go", SendToKarigarLogic.sentDetail(mapOf("sent" to 3, "to" to "03•••567", "photosFailed" to 1)))
        assertEquals("1 message to x", SendToKarigarLogic.sentDetail(mapOf("sent" to 1, "to" to "x")))
    }
}
