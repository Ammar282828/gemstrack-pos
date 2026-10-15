package erp.app.screens.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.speech.tts.TextToSpeech
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import erp.app.data.ErpApi
import erp.app.device.Foreground
import erp.app.device.SpeechEngine
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The voice sheet's state and work (NativeVoiceSession in NativeVoice.swift). Speech only prepares a reading; writes
 * still go through ErpApi. Live words come from Android's recogniser and a recording of up to a minute is kept beside
 * them: the recording is what the ERP reads (/api/voice/native), the live words only show the person they are heard.
 * Main thread only.
 */
class VoiceModel(
    private val context: Context,
    private val scope: CoroutineScope,
    /** The route, as the iPhone calls it (a test answers for it). */
    private val ask: suspend (Map<String, Any?>) -> Map<String, Any?> = { ErpApi.shared.send("/api/voice/native", body = it, timeoutMs = 120_000) },
    private val write: suspend (String, Map<String, Any?>) -> Unit = { op, fields -> ErpApi.shared.write(op, fields) },
) {
    var words by mutableStateOf("")
    var listening by mutableStateOf(false)
        internal set
    var starting by mutableStateOf(false)
        internal set
    var thinking by mutableStateOf(false)
        internal set
    var writing by mutableStateOf(false)
        internal set
    var failure by mutableStateOf<String?>(null)
    var plan by mutableStateOf<VoicePlan?>(null)
        internal set
    var completed by mutableIntStateOf(0)
        internal set
    var level by mutableFloatStateOf(0f)
        internal set
    var readAloud by mutableStateOf(true)
    val busy: Boolean get() = starting || thinking || writing

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var speech: SpeechEngine? = null
    private var work: Job? = null
    private var meter: Job? = null
    private var speaker: TextToSpeech? = null
    private var speakerReady = false
    private var generation = UUID.randomUUID()
    private var peak = 0

    /** What earlier recogniser sessions heard: Android's recogniser ends at a pause, and the next one carries on. */
    private var committed = ""

    fun start(language: String) {
        if (busy || listening) return
        reset()
        starting = true
        val id = generation
        work = scope.launch {
            val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED ||
                (Foreground.launchers?.permission(Manifest.permission.RECORD_AUDIO) ?: false)
            if (generation != id) return@launch
            starting = false
            if (!allowed) {
                failure = "Turn on Microphone for this app in Settings, or type your request."
                return@launch
            }
            try {
                val target = File(context.cacheDir, "erp-voice-${UUID.randomUUID()}.m4a")
                file = target
                val r = newRecorder()
                r.setAudioSource(MediaRecorder.AudioSource.MIC)
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                r.setAudioSamplingRate(44_100)
                r.setAudioChannels(1)
                r.setAudioEncodingBitRate(96_000)
                r.setMaxDuration(VoiceLogic.MAX_MILLIS)
                r.setOutputFile(target.absolutePath)
                r.setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) finish() }
                try {
                    r.prepare()
                    r.start()
                } catch (e: Exception) {
                    runCatching { r.release() }
                    throw ErpApi.Failure(0, "The microphone could not start. You can type instead.")
                }
                recorder = r
                peak = 0
                committed = ""
                listening = true
                // The audio still works if live transcription is unavailable or refused.
                startSpeech(language, id)
                meter = scope.launch {
                    val deadline = System.currentTimeMillis() + VoiceLogic.MAX_MILLIS
                    while (listening) {
                        val amplitude = runCatching { r.maxAmplitude }.getOrDefault(0)
                        peak = maxOf(peak, amplitude)
                        level = VoiceLogic.level(amplitude)
                        if (System.currentTimeMillis() >= deadline) { finish(); break }
                        delay(100)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
                releaseAudio()
            }
        }
    }

    private fun startSpeech(language: String, id: UUID) {
        val engine = SpeechEngine(context) { event, data ->
            if (!listening || generation != id) return@SpeechEngine
            when (event) {
                "speech" -> (data["transcript"] as? String)?.let { words = join(committed, it) }
                // A pause ended this session of the recogniser: the next one carries on from what was heard.
                "speechEnd" -> if (data["error"] == null) scope.launch {
                    committed = words
                    delay(250)
                    if (listening && generation == id) speech?.start(language)
                }
            }
        }
        speech = engine
        scope.launch { engine.start(language) }
    }

    private fun join(a: String, b: String) = if (a.isBlank()) b else if (b.isBlank()) a else "${a.trim()} ${b.trim()}"

    @Suppress("DEPRECATION")
    private fun newRecorder(): MediaRecorder = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()

    /** Stop and send what was said. */
    fun finish() {
        if (!listening) return
        runCatching { recorder?.stop() }
        speech?.stop(notify = false)
        listening = false
        meter?.cancel()
        val bytes = file?.let { runCatching { it.readBytes() }.getOrNull() }
        val heard = words
        val loudest = peak
        releaseAudio()
        val input = VoiceLogic.input(bytes, loudest, heard)
        if (input == null) {
            failure = "Nothing was recorded. Try again or type your request."
            return
        }
        interpret(input)
    }

    fun readText(speak: Boolean) {
        if (busy || listening || completed != 0) return
        readAloud = speak
        interpret(VoiceLogic.textBody(words))
    }

    private fun interpret(input: Map<String, Any?>) {
        work?.cancel()
        silence()
        failure = null
        plan = null
        completed = 0
        thinking = true
        val id = generation
        work = scope.launch {
            try {
                val raw = ask(input)
                if (generation != id) return@launch
                (raw["transcript"] as? String)?.takeIf { it.isNotEmpty() }?.let { words = it }
                val made = VoicePlan(raw, words)
                plan = made
                if (readAloud) made.answer?.let { say(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == id) failure = e.message ?: e.toString()
            } finally {
                if (generation == id) thinking = false
            }
        }
    }

    /** Sends the confirmed steps one at a time; those already saved are not sent again. */
    fun save() {
        val p = plan ?: return
        if (!p.ready || words != p.reviewedWords || busy || listening) return
        silence()
        writing = true
        failure = null
        work = scope.launch {
            try {
                for (operation in p.operations.drop(completed)) {
                    write(operation.op, operation.fields)
                    completed += 1
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            } finally {
                writing = false
            }
        }
    }

    fun reset() {
        if (writing) return
        generation = UUID.randomUUID()
        work?.cancel()
        releaseAudio()
        silence()
        words = ""
        failure = null
        plan = null
        completed = 0
        starting = false
        thinking = false
    }

    fun close() {
        if (writing) return
        generation = UUID.randomUUID()
        work?.cancel()
        releaseAudio()
        silence()
        speaker?.shutdown()
        speaker = null
        speakerReady = false
    }

    fun silence() {
        runCatching { speaker?.stop() }
    }

    private fun say(text: String) {
        val ready = speaker
        if (ready != null && speakerReady) {
            ready.speak(text, TextToSpeech.QUEUE_FLUSH, null, "erp-voice")
            return
        }
        speaker = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                speakerReady = true
                speaker?.language = Locale.UK
                if (readAloud) speaker?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "erp-voice")
            }
        }
    }

    private fun releaseAudio() {
        meter?.cancel()
        meter = null
        recorder?.let { runCatching { it.stop() }; runCatching { it.release() } }
        recorder = null
        speech?.stop(notify = false)
        speech = null
        listening = false
        level = 0f
        file?.let { runCatching { it.delete() } }
        file = null
    }
}
