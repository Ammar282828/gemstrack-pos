// Ported from apps/iphone/Packages/ERPCore/Sources/ERPCore/Logic/VoiceReply.swift (tests: VoiceReplyTests).
//
// The native voice sheet's own rule (docs/features/ai.md, Voice). While a plan is on screen the phone keeps
// listening, and a whole utterance that is only "yes" or "no" answers the plan instead of being sent to the model as
// a new request. Only the whole utterance counts ("no, make it 700" is a change, not a refusal), and a bare "okay"
// counts as neither: a stray word must never save money. English and the shop's Roman Urdu.
package erp.core.logic

enum class VoiceReply { YES, NO, OTHER }

object VoiceReplies {
    private val yesWords = setOf(
        "yes", "yeah", "yep", "yup", "yes please", "yes save", "yes save it", "yes do it", "yes go ahead",
        "save", "save it", "save this", "do it", "confirm", "ok save", "okay save", "go ahead",
        "haan", "han", "haan ji", "han ji", "ji haan", "ji han", "ji", "jee", "haan save", "haan kar do",
        "kar do", "kardo", "save kar do", "save karo", "theek hai", "thik hai", "sahi hai",
    )

    private val noWords = setOf(
        "no", "nope", "no cancel", "cancel", "cancel it", "cancel this", "stop", "never mind", "nevermind",
        "leave it", "forget it", "dont", "dont save", "do not save",
        "nahi", "nahin", "nai", "na", "nahi cancel", "nahi karna", "mat karo", "rehne do", "reh ne do",
        "chhor do", "chor do", "cancel kar do",
    )

    /** What a whole utterance says to the plan on screen. Apostrophes vanish ("don't" is "dont"), other marks are spaces. */
    fun of(words: String): VoiceReply {
        val kept = StringBuilder()
        for (c in words.lowercase()) {
            when {
                c == '\'' || c == '’' -> {}
                c.isLetterOrDigit() -> kept.append(c)
                else -> kept.append(' ')
            }
        }
        val phrase = kept.toString().split(' ').filter { it.isNotEmpty() }.joinToString(" ")
        return when (phrase) {
            in yesWords -> VoiceReply.YES
            in noWords -> VoiceReply.NO
            else -> VoiceReply.OTHER
        }
    }
}
