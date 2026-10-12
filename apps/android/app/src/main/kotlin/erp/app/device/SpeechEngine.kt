package erp.app.device

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat

/**
 * Android's recogniser, for live words (the ERP's voice, lib/voice/live.ts): "speech" with the session's
 * words so far, "speechEnd" when it stops. Android's recogniser ends after a pause; the page starts a new
 * session when one ends, as it does for the iPhone's. Main thread only (SpeechRecognizer demands it).
 */
class SpeechEngine(private val context: Context, private val emit: (String, Map<String, Any?>) -> Unit) {
    private var recognizer: SpeechRecognizer? = null
    private var generation = 0

    /** `done` gets null when listening, or (code, message). */
    suspend fun start(lang: String): Pair<String, String>? {
        generation += 1
        val id = generation
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            val granted = Foreground.launchers?.permission(Manifest.permission.RECORD_AUDIO) ?: false
            if (id != generation) return null
            if (!granted) return "not-allowed" to "The microphone is off for this app in Settings."
        }
        if (id != generation) return null
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return "audio-capture" to "Speech recognition isn't available right now."
        stop(notify = false)
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) { transcript(r, partialResults, final = false) }

            override fun onResults(results: Bundle?) {
                transcript(r, results, final = true)
                finish(r, error = null)
            }

            override fun onError(error: Int) {
                // Silence and "heard nothing" are an ordinary end of a session; the rest is a failure the page can report.
                val quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                finish(r, error = if (quiet) null else message(error))
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName),
        )
        return null
    }

    private fun transcript(r: SpeechRecognizer, bundle: Bundle?, final: Boolean) {
        if (recognizer !== r) return
        val text = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
        emit("speech", mapOf("transcript" to text, "isFinal" to final))
    }

    private fun finish(r: SpeechRecognizer, error: String?) {
        if (recognizer !== r) return
        recognizer = null
        runCatching { r.destroy() }
        emit("speechEnd", if (error == null) emptyMap() else mapOf("error" to error))
    }

    fun stop(notify: Boolean) {
        generation += 1
        val r = recognizer ?: return
        recognizer = null
        runCatching { r.stopListening() }
        runCatching { r.destroy() }
        if (notify) emit("speechEnd", emptyMap())
    }

    private fun message(error: Int) = when (error) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "The microphone is off for this app in Settings."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs the internet."
        SpeechRecognizer.ERROR_AUDIO -> "The microphone couldn't be used."
        else -> "Speech recognition stopped (code $error)."
    }
}
