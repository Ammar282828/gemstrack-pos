package erp.app.screens.voice

import erp.core.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** Voice over the screen: what the open record is told as, the stack of open records, the overlay's state, its words. Made-up names only. */
class VoiceOverlayTests {
    @Suppress("UNCHECKED_CAST")
    private fun plan(json: String, words: String = "x") = VoicePlan(Json.parse(json) as Map<String, Any?>, words)

    // MARK: The payload, as the iPhone sends it (VoiceContext.swift)

    @Test fun anOrdersPayloadHasTheIphonesKeys() {
        val focus = VoiceFocus("order", "ORD-0123", "Order ORD-0123 · Test Buyer · 2 pieces", listOf("Ring", "Chain"))
        assertEquals(
            mapOf(
                "kind" to "order", "id" to "ORD-0123", "label" to "Order ORD-0123 · Test Buyer · 2 pieces",
                "pieces" to listOf(mapOf("index" to 0, "name" to "Ring"), mapOf("index" to 1, "name" to "Chain")),
            ),
            focus.payload,
        )
    }

    @Test fun aWorkshopPieceAddsItsIndexAndNoOtherKey() {
        val payload = VoiceFocus("order", "ORD-0123", "Order ORD-0123, piece 2", piece = 1).payload
        assertEquals(1, payload["piece"])
        assertEquals(emptyList<Any>(), payload["pieces"])
        assertEquals(setOf("kind", "id", "label", "pieces", "piece"), payload.keys)
        // Without a piece the key is absent, not null.
        assertFalse(VoiceFocus("customer", "C1", "Customer Test Buyer").payload.containsKey("piece"))
    }

    @Test fun theBodyCarriesTheContextAndKeepsTheRest() {
        val focus = VoiceFocus("product", "SKU-9", "Piece SKU-9 · Test ring")
        val body = VoiceLogic.requestBody("make it 22 karat", null, focus)
        assertEquals("make it 22 karat", body["text"])
        assertEquals(focus.payload, body["context"])
        // A recording goes with it too.
        val audio = VoiceLogic.withContext(VoiceLogic.audioBody("AAAA"), focus)
        assertEquals("AAAA", audio["audio"])
        assertEquals(focus.payload, audio["context"])
    }

    @Test fun withNothingOpenTheSentenceStandsAlone() {
        val body = VoiceLogic.requestBody("what is in the drawer", null, null)
        assertFalse(body.containsKey("context"))
        assertFalse(VoiceLogic.withContext(VoiceLogic.textBody("hi"), null).containsKey("context"))
    }

    @Test fun aChangeToAPlanKeepsItsPreviousAndTheContext() {
        val earlier = plan("""{"reading":{"steps":[]},"cards":[]}""", "tea three hundred")
        val body = VoiceLogic.requestBody("make it four hundred", earlier, VoiceFocus("invoice", "INV-1", "Invoice INV-1"))
        assertNotNull(body["previous"])
        assertNotNull(body["context"])
    }

    // MARK: The stack of open records

    @Test fun theNewestOpenRecordIsInFront() {
        VoiceContext.reset()
        val page = Any()
        val sheet = Any()
        VoiceContext.set(VoiceFocus("order", "ORD-1", "Order ORD-1"), page)
        VoiceContext.set(VoiceFocus("order", "ORD-1", "Order ORD-1, piece 1", piece = 0), sheet)
        assertEquals(0, VoiceContext.focus?.piece)
        // The sheet closing does not need the page to say it is back: its own entry was under it all along.
        VoiceContext.clear(sheet)
        assertEquals("Order ORD-1", VoiceContext.focus?.label)
        VoiceContext.clear(page)
        assertNull(VoiceContext.focus)
    }

    @Test fun aScreenChangingItsRecordKeepsItsPlaceInFront() {
        VoiceContext.reset()
        val a = Any()
        val b = Any()
        VoiceContext.set(null, a) // loading
        assertNull(VoiceContext.focus)
        VoiceContext.set(VoiceFocus("customer", "C1", "Customer Test Buyer"), a)
        VoiceContext.set(VoiceFocus("order", "O1", "Order O1"), b)
        VoiceContext.set(VoiceFocus("customer", "C1", "Customer Test Buyer Two"), a)
        assertEquals("Customer Test Buyer Two", VoiceContext.focus?.label)
        VoiceContext.reset()
        assertNull(VoiceContext.focus)
    }

    // MARK: The overlay's state

    private class Stub : VoiceDriver {
        val calls = mutableListOf<String>()
        override fun open(language: String) { calls += "open:$language" }
        override fun close() { calls += "close" }
        override fun pause() { calls += "pause" }
        override fun resume() { calls += "resume" }
    }

    @Test fun presentOpensListeningOnceAndDismissCloses() {
        val made = mutableListOf<Stub>()
        val state = VoiceOverlayState { Stub().also(made::add) }
        assertFalse(state.shown)
        val first = state.present()
        assertSame(first, state.present()) // a second "Talk to ERP" while it is up is the same capsule
        assertEquals(1, made.size)
        assertEquals(listOf("open:en-PK"), first.calls)
        assertTrue(state.shown)
        state.dismiss()
        assertFalse(state.shown)
        assertEquals(listOf("open:en-PK", "close"), first.calls)
        state.dismiss() // nothing to close
        assertEquals(2, first.calls.size)
        // The next one is a new session, in the language chosen.
        state.language = "ur-PK"
        assertEquals(listOf("open:ur-PK"), state.present().calls)
        assertEquals(2, made.size)
    }

    @Test fun theMicrophoneFollowsTheAppNotOnePage() {
        val state = VoiceOverlayState { Stub() }
        state.activityStarted() // the tabs
        val voice = state.present()
        // A page opens over the tabs: it starts, then the tabs stop. The microphone is never closed in between.
        state.activityStarted()
        state.activityStopped()
        assertFalse("pause" in voice.calls)
        // The page closes: the tabs start again before the page is gone.
        state.activityStarted()
        state.activityStopped()
        assertFalse("pause" in voice.calls)
        // The app goes behind the lock or another app.
        state.activityStopped()
        assertEquals("pause", voice.calls.last())
        state.activityStarted()
        assertEquals("resume", voice.calls.last())
    }

    @Test fun aBusinessSwitchPutsItAway() {
        val state = VoiceOverlayState { Stub() }
        val voice = state.present()
        state.reset()
        assertFalse(state.shown)
        assertEquals("close", voice.calls.last())
    }

    @Test fun onlyTheVoiceAddressIsTheOverlays() {
        assertTrue(VoiceOverlay.handles("/voice"))
        assertTrue(VoiceOverlay.handles(VoiceLaunch.PATH))
        assertFalse(VoiceOverlay.handles("/voice/other"))
        assertFalse(VoiceOverlay.handles("/orders/ORD-1"))
    }

    // MARK: What it says

    @Test fun theHeadlineIsTheAnswerTheSavedWordOrTheStep() {
        assertNull(VoiceLogic.headline(null, 0))
        val answer = plan("""{"answer":"Rs 3 lac in the drawer.","cards":[]}""")
        assertEquals("Rs 3 lac in the drawer.", VoiceLogic.headline(answer, 0))
        val one = plan("""{"cards":[{"title":"edit","summary":"Make piece 1 22 karat","operations":[{"op":"updateOrderPiece","fields":{"orderId":"O1"}}]}]}""")
        assertEquals("Make piece 1 22 karat", VoiceLogic.headline(one, 0))
        assertEquals("Saved.", VoiceLogic.headline(one, 1))
        val two = plan("""{"cards":[{"title":"a","summary":"A","operations":[]},{"title":"b","summary":"B","operations":[]}]}""")
        assertEquals("2 changes", VoiceLogic.headline(two, 0))
    }

    @Test fun stepsShowWhenThereIsMoreThanOneOrOneNeedsALook() {
        val single = plan("""{"cards":[{"title":"edit","summary":"S","operations":[{"op":"x","fields":{}}]}]}""")
        assertFalse(VoiceLogic.showsSteps(single, 0))
        assertTrue(VoiceLogic.showsSteps(single, 1) == false) // saved, but no record to open
        val withRecord = plan("""{"cards":[{"title":"edit","summary":"S","href":"/orders/O1","operations":[{"op":"x","fields":{}}]}]}""")
        assertTrue(VoiceLogic.showsSteps(withRecord, 1))
        val problem = plan("""{"cards":[{"title":"edit","summary":"S","problem":"Which piece?","operations":[]}]}""")
        assertTrue(VoiceLogic.showsSteps(problem, 0))
        val answerWithPage = plan("""{"answer":"Here.","href":"/today","cards":[]}""")
        assertTrue(VoiceLogic.showsSteps(answerWithPage, 0))
    }

    @Test fun aRecordOpensFromACardWithoutOperations() {
        val call = plan("""{"cards":[{"title":"call","summary":"Call Test Buyer","href":"tel:+920000000000","operations":[]}]}""").cards[0]
        assertTrue(VoiceLogic.opensRecord(call))
        val stuck = plan("""{"cards":[{"title":"x","summary":"S","problem":"No such customer","href":"tel:+920000000000","operations":[]}]}""").cards[0]
        assertFalse(VoiceLogic.opensRecord(stuck))
        val page = plan("""{"cards":[{"title":"x","summary":"S","problem":"Check it","href":"/orders/O1","operations":[]}]}""").cards[0]
        assertTrue(VoiceLogic.opensRecord(page))
        val saves = plan("""{"cards":[{"title":"x","summary":"S","href":"/orders/O1","operations":[{"op":"x","fields":{}}]}]}""").cards[0]
        assertFalse(VoiceLogic.opensRecord(saves))
    }

    @Test fun theStatusLineSaysWhatIsOpenAndWhatToSay() {
        fun status(plan: VoicePlan? = null, completed: Int = 0, listening: Boolean = true, label: String? = null) = VoiceLogic.status(
            starting = false, listening = listening, writing = false, clipMode = false, plan = plan, completed = completed,
            focusLabel = label, unavailable = false,
        )
        assertEquals("Say what you need", status())
        assertEquals("Listening · about Order ORD-1 · Test Buyer · 1 piece", status(label = "Order ORD-1 · Test Buyer · 1 piece"))
        assertEquals("Tap the mic to listen again", status(listening = false))
        val ready = plan("""{"cards":[{"title":"edit","summary":"S","operations":[{"op":"x","fields":{}}]}]}""")
        assertEquals("Say “yes” to save, or what to change", status(ready))
        assertEquals("Say what’s next", status(ready, completed = 1))
        val stuck = plan("""{"cards":[{"title":"edit","summary":"S","problem":"Which?","operations":[]}]}""")
        assertEquals("Ask another, or say what to do", status(stuck))
        assertEquals("Getting ready…", VoiceLogic.status(true, false, false, false, null, 0, null, false))
        assertEquals("Saving…", VoiceLogic.status(false, true, true, false, ready, 0, null, false))
    }
}
