package erp.app.screens.orders

import erp.app.data.ErpApi
import erp.core.ERPDecode
import erp.core.models.Order
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Send to karigar (KarigarSendQueue.swift, SendToKarigarSheet.swift): the request, the words it reads back, and the loop that asks again
// while the ERP answers `partial`. Made-up names only.
class KarigarSendTests {
    private fun order() = ERPDecode.model<Order>(
        mapOf(
            "id" to "ORD-1", "createdAt" to "2026-10-07T05:00:00.000Z", "status" to "Pending", "customerName" to "Sana Demo",
            "items" to listOf(
                mapOf("description" to "Ring", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 5.0, "karigarId" to "k1"),
                mapOf("description" to "Chain", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 9.0, "karigarId" to "k2"),
                mapOf("description" to " ", "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 2.0),
            ),
        ),
    )!!

    @Test fun theSheetOpensOnTheAskedKarigarThenThePiecesThenTheFirstAssigned() {
        val o = order()
        assertEquals("kx", KarigarSendLogic.firstKarigar(o, "kx", listOf(0)))
        assertEquals("k2", KarigarSendLogic.firstKarigar(o, null, listOf(1)))
        assertEquals("k1", KarigarSendLogic.firstKarigar(o, null, null))
    }

    @Test fun theTickedPiecesAreTheAskedOnesElseHisElseAll() {
        val o = order()
        assertEquals(setOf(1), KarigarSendLogic.initialPieces(o, listOf(1, 9), "k1"))
        assertEquals(setOf(0), KarigarSendLogic.initialPieces(o, null, "k1"))
        assertEquals(setOf(0, 1, 2), KarigarSendLogic.initialPieces(o, null, ""))
        assertEquals(setOf(0, 1, 2), KarigarSendLogic.initialPieces(o, null, "nobody"))
    }

    @Test fun anUntitledPieceIsPiece() {
        assertEquals("Piece", KarigarSendLogic.pieceTitle("  "))
        assertEquals("Ring", KarigarSendLogic.pieceTitle(" Ring "))
    }

    @Test fun theRequestCarriesOnlyTheEditedWordsAndTheNumberTyped() {
        val b = KarigarSendLogic.body("ORD-1", listOf(0, 1), "k1", " 0300 1234567 ", mapOf(1 to "  new words ", 5 to "not ticked"), preview = false)
        assertEquals("ORD-1", b["orderId"])
        assertEquals(listOf(0, 1), b["pieceIndexes"])
        assertEquals("k1", b["karigarId"])
        assertEquals("0300 1234567", b["phone"])
        assertEquals(mapOf("1" to "new words"), b["texts"])
        assertNull(b["preview"])
        val p = KarigarSendLogic.body("ORD-1", listOf(0), "", "", mapOf(0 to "x"), preview = true)
        assertEquals(true, p["preview"])
        assertNull(p["karigarId"]); assertNull(p["phone"]); assertNull(p["texts"])
    }

    @Test fun anEmptiedBoxSendsItsPhotoBare() {
        assertEquals(mapOf("0" to ""), KarigarSendLogic.body("O", listOf(0), "k", "", mapOf(0 to "  "), false)["texts"])
    }

    @Test fun thePreviewIsReadPerPiece() {
        val out = mapOf<String, Any?>(
            "messages" to listOf(mapOf("photos" to 2, "pieces" to listOf(mapOf("index" to 0, "title" to "Ring", "text" to "Ring 5 g"), mapOf("index" to 2.0, "text" to "Piece")))),
        )
        val p = KarigarSendLogic.preview(out)
        assertEquals(2, p.photos)
        assertEquals(mapOf(0 to "Ring 5 g", 2 to "Piece"), p.words)
        assertEquals(0, KarigarSendLogic.preview(emptyMap()).photos)
    }

    @Test fun aNumberNeedsElevenToFifteenDigits() {
        assertTrue(KarigarSendLogic.numberOk("923001234567"))
        assertTrue(!KarigarSendLogic.numberOk("0300"))
    }

    private fun ask(vararg answers: Map<String, Any?>): Pair<suspend (Map<String, Any?>) -> Map<String, Any?>, MutableList<Map<String, Any?>>> {
        val seen = ArrayList<Map<String, Any?>>()
        var n = 0
        return Pair({ body -> seen += body; answers[minOf(n++, answers.lastIndex)] }, seen)
    }

    @Test fun oneAnswerIsSaidWithItsCount() = runBlocking {
        val (f, seen) = ask(mapOf("sent" to 3))
        assertEquals("Sent to Usman: 3 messages", KarigarSendLogic.run("Usman", mapOf("a" to 1), f))
        assertEquals(1, seen.size)
        val (g, _) = ask(mapOf("sent" to 1))
        assertEquals("Sent to Usman: 1 message", KarigarSendLogic.run("Usman", emptyMap(), g))
    }

    @Test fun partialAsksAgainWithTheSameBodyAndSumsWhatWent() = runBlocking {
        val body = mapOf<String, Any?>("orderId" to "ORD-1")
        val (f, seen) = ask(mapOf("partial" to true, "sent" to 2), mapOf("partial" to true, "sent" to 1), mapOf("sent" to 1, "photosFailed" to 2, "unsure" to 1))
        val said = KarigarSendLogic.run("Usman", body, f)
        assertEquals(3, seen.size)
        assertTrue(seen.all { it == body })
        assertEquals("Sent to Usman: 4 messages · 2 photos did not go. Retry sends only those", said.substringBefore(" · WhatsApp"))
        assertTrue(said.endsWith(" · WhatsApp was slow on 1: check the chat"))
    }

    @Test fun aSendThatStaysPartialStopsAtTwelve() = runBlocking {
        val (f, seen) = ask(mapOf("partial" to true, "sent" to 1))
        assertEquals("Sent to Usman: 12 messages", KarigarSendLogic.run("Usman", emptyMap(), f))
        assertEquals(12, seen.size)
    }

    @Test fun aRepeatIsASuccessNotAFailure() = runBlocking {
        val (f, _) = ask(mapOf("duplicate" to true, "said" to "Already sent to Usman a minute ago."))
        assertEquals("Already sent to Usman a minute ago.", KarigarSendLogic.run("Usman", emptyMap(), f))
        val (g, _) = ask(mapOf("duplicate" to true))
        assertEquals("Already sent to Usman.", KarigarSendLogic.run("Usman", emptyMap(), g))
    }

    @Test fun aDuplicateAfterSomeWentIsTheCountOfWhatWent() = runBlocking {
        val (f, _) = ask(mapOf("partial" to true, "sent" to 2), mapOf("duplicate" to true, "said" to "Already sent"))
        assertEquals("Sent to Usman: 2 messages", KarigarSendLogic.run("Usman", emptyMap(), f))
    }

    @Test fun aFailureIsNeverRetriedByTheOutboxItself() {
        val e = KarigarSendLogic.refusal(ErpApi.Failure(503, "WhatsApp is down."))
        assertEquals(400, e.status)
        assertEquals("WhatsApp is down. Retry sends only what has not gone.", e.message)
    }

    @Test fun theSameRequestTwiceIsOneTap() {
        val body = KarigarSendLogic.body("ORD-QUEUE", listOf(0), "k1", "", emptyMap(), false)
        val key = KarigarSendQueue.claim(body)
        assertNotNull(key)
        assertNull(KarigarSendQueue.claim(KarigarSendLogic.body("ORD-QUEUE", listOf(0), "k1", "", emptyMap(), false)))
        KarigarSendQueue.release(key)
        val again = KarigarSendQueue.claim(body)
        assertNotNull(again)
        KarigarSendQueue.release(again)
    }
}
