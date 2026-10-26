package erp.app.screens.voice

import erp.app.nav.AppRouter
import erp.core.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Siri-grade voice sheet's pure parts: end of speech, follow-ups, the queue, the spoken line, "Talk to ERP" routing. Made-up words only. */
class VoiceSirigradeTests {
    @Suppress("UNCHECKED_CAST")
    private fun plan(json: String, words: String) = VoicePlan(Json.parse(json) as Map<String, Any?>, words)

    // MARK: End of speech

    private fun EndpointDetector.run(seconds: Double, rms: Float, words: Boolean = false, step: Double = 0.1): Boolean {
        var fired = false
        repeat((seconds / step).toInt()) { if (feed(step, rms, words)) fired = true }
        return fired
    }

    @Test fun aSecondOfQuietAfterTalkEndsTheSentence() {
        val d = EndpointDetector()
        assertFalse(d.run(1.0, rms = 8f, words = true)) // talking
        assertFalse(d.run(0.8, rms = 0f)) // a breath
        assertTrue(d.run(0.4, rms = 0f)) // past a second
    }

    @Test fun itFiresOncePerSentence() {
        val d = EndpointDetector()
        d.run(0.5, rms = 8f)
        assertTrue(d.run(1.5, rms = 0f))
        assertFalse(d.run(2.0, rms = 0f))
        d.reset()
        d.run(0.5, rms = 8f)
        assertTrue(d.run(1.5, rms = 0f))
    }

    @Test fun silenceAloneIsNotASentence() {
        val d = EndpointDetector()
        assertFalse(d.run(10.0, rms = 0f))
    }

    @Test fun aClickIsNotTalk() {
        val d = EndpointDetector()
        d.run(0.1, rms = 9f) // under the 0.2 s that counts as speech
        assertFalse(d.run(3.0, rms = 0f))
    }

    @Test fun wordsCountAsTalkEvenWhenTheMeterIsQuiet() {
        val d = EndpointDetector()
        assertFalse(d.run(0.5, rms = 0f, words = true))
        assertTrue(d.run(1.2, rms = 0f))
    }

    @Test fun aNoisyRoomDoesNotKeepTheSentenceOpenForever() {
        val d = EndpointDetector()
        // A fan at 4 dB is learnt as the room's floor within a few seconds; speech well over it is still heard.
        d.run(8.0, rms = 4f)
        d.reset() // (the fan alone ended a "sentence" while it was being learnt; the caller finds no words in it)
        d.run(0.5, rms = 10f)
        assertTrue(d.run(1.5, rms = 4f))
    }

    @Test fun talkResumingResetsTheQuiet() {
        val d = EndpointDetector()
        d.run(0.5, rms = 8f)
        assertFalse(d.run(0.8, rms = 0f))
        assertFalse(d.run(0.3, rms = 8f)) // started again before the second was up
        assertFalse(d.run(0.8, rms = 0f))
        assertTrue(d.run(0.4, rms = 0f))
    }

    // MARK: Changes to the plan on screen

    private val first = """{"cards":[{"title":"payment","summary":"Test Buyer pays 5,000","operations":[{"op":"recordPayment","fields":{"amount":5000}}]}],"reading":{"intent":"payment","amount":5000}}"""

    @Test fun theReadingIsKept() {
        assertEquals(5000, (plan(first, "w").reading!!["amount"] as Number).toInt())
        assertNull(plan("""{"cards":[]}""", "w").reading)
    }

    @Test fun aFirstSentenceStandsAlone() {
        assertEquals(mapOf("text" to "Test Buyer paid five thousand"), VoiceLogic.requestBody("  Test Buyer paid five thousand ", null))
    }

    @Test fun aChangeCarriesTheEarlierWordsAndTheReading() {
        val body = VoiceLogic.requestBody("make it fifty thousand", plan(first, "Test Buyer paid five thousand"))
        assertEquals("make it fifty thousand", body["text"])
        @Suppress("UNCHECKED_CAST") val previous = body["previous"] as Map<String, Any?>
        assertEquals("Test Buyer paid five thousand", previous["words"])
        assertNotNull(previous["reading"])
        assertEquals(setOf("text", "previous"), body.keys)
    }

    @Test fun aPlanWithoutAReadingIsNotRefined() {
        val body = VoiceLogic.requestBody("add tea 300", plan("""{"cards":[]}""", "tea"))
        assertEquals(setOf("text"), body.keys)
    }

    @Test fun theEarlierWordsAreCappedAtEightHundred() {
        val long = "x".repeat(2000)
        @Suppress("UNCHECKED_CAST") val previous = VoiceLogic.requestBody("y", plan(first, long))["previous"] as Map<String, Any?>
        assertEquals(800, (previous["words"] as String).length)
    }

    @Test fun theWordsReadGrowWithEachChange() {
        assertEquals("a", VoiceLogic.cumulative(null, "a"))
        assertEquals("Test Buyer paid five thousand, make it fifty thousand", VoiceLogic.cumulative(plan(first, "Test Buyer paid five thousand"), "make it fifty thousand"))
    }

    // MARK: Said while a reading is out

    @Test fun aSentenceSaidMeanwhileWaitsAndAYesIsDropped() {
        assertEquals("also add tea 300", VoiceLogic.queue(null, "also add tea 300"))
        assertEquals("also add tea 300 and sugar 50", VoiceLogic.queue("also add tea 300", "and sugar 50"))
        assertNull(VoiceLogic.queue(null, "yes"))
        assertEquals("also add tea 300", VoiceLogic.queue("also add tea 300", "haan"))
        assertNull(VoiceLogic.queue(null, "no"))
    }

    // MARK: Spoken line

    @Test fun anAnswerIsSpokenAsItIs() {
        assertEquals("The drawer holds Rs 3.12 lac.", VoiceLogic.spoken(plan("""{"answer":"The drawer holds Rs 3.12 lac.","cards":[]}""", "w")))
    }

    @Test fun aLongAnswerIsCut() {
        val said = VoiceLogic.spoken(plan("""{"answer":"${"a".repeat(300)}","cards":[]}""", "w"))
        assertEquals(221, said.length)
        assertTrue(said.endsWith("…"))
    }

    @Test fun aProblemIsSpokenBeforeAnythingIsOffered() {
        val p = plan("""{"cards":[{"title":"payment","summary":"s","problem":"No customer named Sara.","operations":[{"op":"recordPayment","fields":{}}]}]}""", "w")
        assertEquals("No customer named Sara.", VoiceLogic.spoken(p))
    }

    @Test fun oneStepIsReadBackAndAskedAbout() {
        assertEquals("Test Buyer pays 5,000. Save it?", VoiceLogic.spoken(plan(first, "w")))
    }

    @Test fun severalStepsAreCounted() {
        val two = """{"cards":[{"title":"a","summary":"s","operations":[{"op":"addExpense","fields":{}}]},{"title":"b","summary":"t","operations":[{"op":"addExpense","fields":{}}]}]}"""
        assertEquals("2 changes. Save them?", VoiceLogic.spoken(plan(two, "w")))
        assertEquals("", VoiceLogic.spoken(plan("""{"cards":[{"title":"a","summary":"s"}]}""", "w")))
    }

    @Test fun theMeterReadsTheRecognisersRms() {
        assertEquals(0f, VoiceLogic.levelFromRms(-2f))
        assertEquals(0f, VoiceLogic.levelFromRms(-10f))
        assertEquals(1f, VoiceLogic.levelFromRms(10f))
        assertEquals(0.5f, VoiceLogic.levelFromRms(4f))
    }

    @Test fun aSpokenSentenceGoesAsTextAndARecordingAsAudio() {
        assertEquals(30_000L, VoiceLogic.ASK_TIMEOUT_MS)
        assertEquals(setOf("audio"), VoiceLogic.audioBody("QUJD").keys)
    }

    // MARK: Talk to ERP

    @Test fun theShortcutAndTheTileOpenTheVoiceSheetOnTheOpenBusiness() {
        // erp://voice: the shortcut's and the tile's address; no business named, so the open one.
        assertEquals(AppRouter.Target(null, "/voice"), AppRouter.target("erp", "voice", "", null, emptyList()))
        assertEquals(VoiceLaunch.PATH, "/voice")
        assertEquals("erp://voice", VoiceLaunch.ADDRESS)
    }

    @Test fun theSystemsVoiceCommandAndAssistOpenItToo() {
        assertEquals(AppRouter.Target(null, "/voice"), AppRouter.voiceTarget("android.intent.action.VOICE_COMMAND"))
        assertEquals(AppRouter.Target(null, "/voice"), AppRouter.voiceTarget("android.intent.action.ASSIST"))
        assertTrue(VoiceLaunch.isVoiceRequest("android.intent.action.ASSIST"))
    }

    @Test fun nothingElseIsAVoiceRequest() {
        assertNull(AppRouter.voiceTarget(null))
        assertNull(AppRouter.voiceTarget("android.intent.action.VIEW"))
        assertNull(AppRouter.voiceTarget("android.intent.action.MAIN"))
        assertFalse(VoiceLaunch.isVoiceRequest("android.intent.action.SEND"))
    }

    @Test fun otherAddressesAreStillTheirOwn() {
        assertEquals(AppRouter.Target(null, "/orders/ORD-1"), AppRouter.target("erp", "orders", "/ORD-1", null, emptyList()))
    }
}
