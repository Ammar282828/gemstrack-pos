package erp.app.screens.voice

/**
 * End of speech by itself (the iPhone's `VoiceAudioTap`: about a second of quiet after talk ends the sentence). Pure: the
 * caller feeds it a slice of time and what it heard in that slice. Android's recogniser does end a session at a pause, but
 * only after its own two to three seconds and with no say in it, so this is the shorter clock that fires first.
 *
 * Someone is talking when the sound stands [RISE] dB above the room, which the quiet moments keep measuring, or when the
 * recogniser's words changed in the slice (it heard something the meter did not). A cough is not a sentence: the caller
 * only reads the words if there are some.
 */
class EndpointDetector(private val silenceToEnd: Double = SILENCE_TO_END, private val minVoice: Double = MIN_VOICE) {
    private var floor = FLOOR_START
    private var voiced = 0.0
    private var silent = 0.0
    private var fired = false

    /** A new sentence: the quiet and the talk so far are forgotten (the room's level is kept). */
    fun reset() {
        voiced = 0.0
        silent = 0.0
        fired = false
    }

    /** True once per sentence: speech has been heard and then [silenceToEnd] seconds of quiet. */
    fun feed(seconds: Double, rmsDb: Float, wordsChanged: Boolean): Boolean {
        val voice = wordsChanged || rmsDb > floor + RISE
        // The room is learnt in the quiet moments, and slowly even under steady noise that no word came out of (a fan, a street),
        // or a sentence would never end there.
        if (!wordsChanged) {
            val k = if (voice) 0.01f else 0.03f
            floor = (floor * (1 - k) + rmsDb * k).coerceIn(FLOOR_MIN, FLOOR_MAX)
        }
        if (voice) {
            voiced += seconds
            silent = 0.0
        } else if (voiced > minVoice) {
            silent += seconds
        }
        if (!fired && voiced >= minVoice && silent >= silenceToEnd) {
            fired = true
            return true
        }
        return false
    }

    companion object {
        const val SILENCE_TO_END = 1.0
        const val MIN_VOICE = 0.2

        /** The recogniser's rms is about -2 dB in a quiet room and 8 to 10 in speech. */
        const val RISE = 3f
        private const val FLOOR_START = 0f
        private const val FLOOR_MIN = -2f
        private const val FLOOR_MAX = 4f
    }
}

/**
 * "Talk to ERP" from outside the app (iPhone: `Shared/VoiceLaunch.swift`): the launcher shortcut, the Quick Settings tile
 * and the system's voice-command and assist requests all open the app on the open business straight into the voice sheet,
 * through the app's own address. The sheet itself checks it is an owner.
 */
object VoiceLaunch {
    /** The ERP path of the sheet (the create menu opens the same one). */
    const val PATH = "/voice"

    /** The address a shortcut or tile fires: `erp://voice` (AppRouter turns it into [PATH] on the open business). */
    const val ADDRESS = "erp://voice"

    /** The system's "voice command" (a headset button, a car) and "assist" (a held power button) requests. */
    const val ACTION_VOICE_COMMAND = "android.intent.action.VOICE_COMMAND"
    const val ACTION_ASSIST = "android.intent.action.ASSIST"

    fun isVoiceRequest(action: String?): Boolean = action == ACTION_VOICE_COMMAND || action == ACTION_ASSIST
}
