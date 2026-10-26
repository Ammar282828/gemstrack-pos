package erp.app.device

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * The voice sheet's ears (the iPhone's `VoiceEngine`): one recogniser made ahead of the tap and kept, so listening starts at
 * once instead of after the recogniser's service has bound. Where the phone has one, the words come from the on-device
 * recogniser (API 31+, `createOnDeviceSpeechRecognizer`): nothing leaves the phone but the sentence as text. Where it has
 * not, or its language pack is missing, the system's default recogniser listens as before; with neither, [available] is
 * false and the sheet records the sentence for the ERP to listen to.
 *
 * Main thread only (SpeechRecognizer demands it). [SpeechEngine] stays the web bridge's; this is the sheet's.
 */
class VoiceEars private constructor(private val appContext: Context) {
    /** What the sheet hears. All on the main thread. */
    interface Listener {
        /** The sentence so far (partial results). */
        fun onWords(text: String)
        fun onRms(db: Float)
        /**
         * A session ended: [error] is null for an ordinary end (silence, nothing matched), else words for the person;
         * [finalText] is the recogniser's last word on the sentence, if it gave one.
         */
        fun onEnded(error: String?, finalText: String?)
    }

    @Volatile var listener: Listener? = null

    private var recognizer: SpeechRecognizer? = null
    private var onDevice = false
    private var active = false

    /** Set once the on-device recogniser has said its language is missing: the default listens for the rest of the run. */
    private var onDeviceRefused = false

    /** True while a sheet holds the ears, so an idle release does not take them from under it. */
    var inUse = false

    /** Makes the recogniser now, without listening (cheap; the service binds in the background). */
    fun warm() {
        if (recognizer == null && available(appContext)) recognizer = make()
    }

    /** Starts one session in [lang]. Words, rms and the end come to [listener]. */
    fun listen(lang: String) {
        val r = recognizer ?: make().also { recognizer = it }
        // A session left running (a restart after the tail of the last) must not answer into this one.
        if (active) runCatching { r.cancel() }
        active = true
        val preferOffline = onDevice
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
                // The recogniser's own end of speech is a hint; VoiceEndpoint is the clock that decides.
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName),
        )
    }

    /** Ends the session without a result (the sentence is already taken, or the app is leaving). The recogniser is kept. */
    fun cancel() {
        if (!active) return
        active = false
        recognizer?.let { runCatching { it.cancel() } }
    }

    /** The recogniser goes (the service is freed). The next [listen] makes another. */
    fun release() {
        active = false
        recognizer?.let { runCatching { it.cancel() }; runCatching { it.destroy() } }
        recognizer = null
    }

    private fun make(): SpeechRecognizer {
        val useOnDevice = !onDeviceRefused && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(appContext)
        onDevice = useOnDevice
        val r = if (useOnDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(appContext) else SpeechRecognizer.createSpeechRecognizer(appContext)
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) {
                if (recognizer !== r || !active) return
                first(partialResults)?.let { listener?.onWords(it) }
            }

            override fun onResults(results: Bundle?) = ended(r, null, first(results))

            override fun onError(error: Int) {
                // Nothing matched and silence are an ordinary end of a session; the rest the sheet can count as a failure.
                val quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                // The on-device recogniser lacks the language (12, 13: API 31): take the default one, which has it online.
                if (onDevice && (error == ERROR_LANGUAGE_NOT_SUPPORTED || error == ERROR_LANGUAGE_UNAVAILABLE)) {
                    onDeviceRefused = true
                    runCatching { r.destroy() }
                    if (recognizer === r) recognizer = null
                    active = false
                    listener?.onEnded(null, null)
                    return
                }
                ended(r, if (quiet) null else message(error), null)
            }

            override fun onRmsChanged(rmsdB: Float) { if (recognizer === r && active) listener?.onRms(rmsdB) }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        return r
    }

    private fun first(bundle: Bundle?): String? = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

    private fun ended(r: SpeechRecognizer, error: String?, finalText: String?) {
        if (recognizer !== r || !active) return
        active = false
        listener?.onEnded(error, finalText)
    }

    private fun message(error: Int) = when (error) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "The microphone is off for this app in Settings."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs the internet."
        SpeechRecognizer.ERROR_AUDIO -> "The microphone couldn't be used."
        else -> "Speech recognition stopped (code $error)."
    }

    companion object {
        // SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED / _UNAVAILABLE are API 31; the numbers are the same on every release.
        private const val ERROR_LANGUAGE_NOT_SUPPORTED = 12
        private const val ERROR_LANGUAGE_UNAVAILABLE = 13

        @Volatile private var instance: VoiceEars? = null

        /** The one set of ears of the app (the recogniser warmed at launch is the one the sheet takes). */
        fun shared(context: Context): VoiceEars =
            instance ?: synchronized(this) { instance ?: VoiceEars(context.applicationContext).also { instance = it } }

        /** Whether the phone can recognise speech at all (a phone without Google's speech services cannot). */
        fun available(context: Context): Boolean =
            SpeechRecognizer.isRecognitionAvailable(context) ||
                (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context))

        /** Called when the app comes to the front for an owner who has let it listen: the sheet then starts in a moment. */
        fun warm(context: Context) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
            ) return
            shared(context).warm()
        }

        /** The app went to the background: the recogniser's service is freed unless a sheet holds it. */
        fun idle(context: Context) {
            instance?.let { if (!it.inUse) it.release() }
        }
    }
}
