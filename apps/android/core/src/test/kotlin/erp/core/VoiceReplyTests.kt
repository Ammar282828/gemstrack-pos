package erp.core

import erp.core.logic.VoiceReplies
import erp.core.logic.VoiceReply
import kotlin.test.Test
import kotlin.test.assertEquals

/** The voice sheet's yes and no (VoiceReplyTests.swift). Made-up phrases only. */
class VoiceReplyTests {
    @Test
    fun yesInEnglishAndRomanUrdu() {
        for (w in listOf("Yes", "yes.", "  Yeah!  ", "save it", "Do it", "haan", "Haan ji", "ji haan", "kar do", "theek hai")) {
            assertEquals(VoiceReply.YES, VoiceReplies.of(w), w)
        }
    }

    @Test
    fun noInEnglishAndRomanUrdu() {
        for (w in listOf("No", "no.", "Cancel", "never mind", "nahi", "Nahin", "rehne do", "don't", "Don’t save")) {
            assertEquals(VoiceReply.NO, VoiceReplies.of(w), w)
        }
    }

    @Test
    fun onlyAWholeUtteranceAnswers() {
        for (w in listOf("no make it 700", "yes and also add tea", "change the amount to 50,000", "save the invoice for Sara", "", "  ", "okay", "ok")) {
            assertEquals(VoiceReply.OTHER, VoiceReplies.of(w), w)
        }
    }
}
