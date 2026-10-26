package erp.app.screens.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import erp.app.data.ErpApi
import erp.app.data.Outbox
import erp.app.data.OutboxEngine
import erp.app.device.Foreground
import erp.app.device.VoiceEars
import erp.core.logic.VoiceReplies
import erp.core.logic.VoiceReply
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The voice sheet's state and work (NativeVoiceSession in NativeVoice.swift). It listens the way the iPhone's does: the
 * microphone is open from the moment the sheet is (the recogniser was made ahead, [VoiceEars.warm]), the words stream in,
 * about a second of quiet after talk ends the sentence ([EndpointDetector]), the reading comes while the microphone stays
 * open, and the next sentence ("change the amount to 50,000", "also add tea 300", "yes") refines or answers the same plan.
 * Speech only prepares a reading; money still goes only through ErpApi, awaited, and the rest through the Outbox.
 *
 * Where the phone has no recogniser at all, the sheet falls back to the old way: a recording of up to a minute that the
 * ERP listens to ([clipMode]). Main thread only.
 */
class VoiceModel(
    private val context: Context,
    private val scope: CoroutineScope,
    /** The route, as the iPhone calls it (a test answers for it). */
    private val ask: suspend (Map<String, Any?>) -> Map<String, Any?> = {
        ErpApi.shared.send("/api/voice/native", body = it, timeoutMs = if (it.containsKey("audio")) 120_000 else VoiceLogic.ASK_TIMEOUT_MS)
    },
    private val write: suspend (String, Map<String, Any?>) -> Unit = { op, fields -> ErpApi.shared.write(op, fields) },
    /** `{warm: true}`: the ERP reads its book now, while the person is still speaking (no model call, no part of the day's cap). */
    private val warmUp: suspend () -> Unit = { ErpApi.shared.send("/api/voice/native", body = mapOf("warm" to true), timeoutMs = 10_000) },
    /** A non-money step leaves at once and retries in the background (Outbox). */
    private val queue: (String, Map<String, Any?>, String) -> Unit = { op, fields, label -> Outbox.enqueue(op, fields, label) },
    /** The ears, or null where the phone cannot recognise speech. */
    private val earsFor: () -> VoiceEars? = { VoiceEars.shared(context).takeIf { VoiceEars.available(context) } },
) {
    /** What the plan on screen answers: the words read, which a typed edit may change before "Read again". */
    var words by mutableStateOf("")

    /** The sentence being said, as far as it is heard. */
    var live by mutableStateOf("")
        internal set

    /** The microphone is open (continuous), or recording (clip mode). */
    var listening by mutableStateOf(false)
        internal set
    var starting by mutableStateOf(false)
        internal set
    var thinking by mutableStateOf(false)
        internal set
    var writing by mutableStateOf(false)
        internal set
    var failure by mutableStateOf<String?>(null)
    var canRetry by mutableStateOf(false)
        internal set
    var plan by mutableStateOf<VoicePlan?>(null)
        internal set
    var completed by mutableIntStateOf(0)
        internal set
    var level by mutableFloatStateOf(0f)
        internal set
    var readAloud by mutableStateOf(true)

    /** No recogniser on the phone: the mic button records a sentence and the ERP listens to it. */
    var clipMode by mutableStateOf(false)
        internal set
    val busy: Boolean get() = starting || thinking || writing

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var work: Job? = null
    private var meter: Job? = null
    private var ticker: Job? = null
    private var restart: Job? = null
    private var speaker: TextToSpeech? = null
    private var speakerReady = false
    private var pendingSpeech: String? = null
    private var generation = UUID.randomUUID()
    private var peak = 0

    private var language = "en-PK"
    private var opened = false
    private var closed = false
    private var pausedByApp = false

    /** The ear is shut while the answer is spoken (no echo), and opens after. */
    private var muted = false
    private var ears: VoiceEars? = null
    private val detector = EndpointDetector()
    private var lastRms = 0f
    private var wordsChanged = false
    private var failures = 0

    /** What was said while the last request was out: read next, in order. */
    private var queued: String? = null
    private var sent: Pair<String, Map<String, Any?>?>? = null

    private val main = Handler(Looper.getMainLooper())

    // MARK: Opening and closing

    /** The sheet is up: the ERP is told to read its book, permission is checked, and the microphone opens. */
    fun open(language: String) {
        if (opened) return
        opened = true
        closed = false
        this.language = language
        starting = true
        // Held from now, so the app going behind the sheet's page does not free the recogniser under it.
        earsFor()?.inUse = true
        scope.launch { runCatching { warmUp() } }
        val id = generation
        work = scope.launch {
            val allowed = micAllowed()
            if (generation != id || closed) return@launch
            starting = false
            if (!allowed) {
                failure = "Turn on Microphone for this app in Settings, or type your request."
                return@launch
            }
            val e = earsFor()
            if (e == null) {
                clipMode = true
                return@launch
            }
            hear(e)
        }
    }

    private suspend fun micAllowed() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED ||
            (Foreground.launchers?.permission(Manifest.permission.RECORD_AUDIO) ?: false)

    private fun hear(e: VoiceEars) {
        ears = e
        e.inUse = true
        e.listener = object : VoiceEars.Listener {
            override fun onWords(text: String) {
                failures = 0
                if (text != live) { live = text; wordsChanged = true }
            }

            override fun onRms(db: Float) {
                lastRms = db
                level = VoiceLogic.levelFromRms(db)
            }

            override fun onEnded(error: String?, finalText: String?) {
                if (!listening || muted) return
                when {
                    error != null -> turnFailed(error)
                    !(finalText ?: live).isBlank() -> finishTurn(finalText)
                    // Silence: a fresh session, the room measured again.
                    else -> beginTurnSoon(120)
                }
            }
        }
        listening = true
        pausedByApp = false
        failures = 0
        ticker?.cancel()
        ticker = scope.launch {
            val step = 100L
            while (true) {
                delay(step)
                if (!listening || muted) continue
                val changed = wordsChanged
                wordsChanged = false
                if (detector.feed(step / 1000.0, lastRms, changed) && live.isNotBlank()) finishTurn(null)
            }
        }
        beginTurn()
    }

    /** A new sentence: a session of the recogniser, the quiet counted from nothing. */
    private fun beginTurn() {
        val e = ears ?: return
        if (!listening || muted || closed) return
        live = ""
        wordsChanged = false
        detector.reset()
        try {
            e.listen(language)
        } catch (ex: CancellationException) {
            throw ex
        } catch (ex: Exception) {
            turnFailed(ex.message ?: ex.toString())
        }
    }

    /** The recogniser needs a breath between a cancel and the next start. */
    private fun beginTurnSoon(afterMs: Long) {
        restart?.cancel()
        restart = scope.launch {
            delay(afterMs)
            beginTurn()
        }
    }

    /** A session that died is replaced; one that keeps dying ends listening and leaves the typed field. */
    private fun turnFailed(message: String) {
        failures += 1
        val microphone = message.contains("microphone", ignoreCase = true)
        if (failures >= MAX_FAILURES || microphone) {
            failure = if (microphone) message else "Listening stopped working. You can type instead."
            stopEars()
            return
        }
        beginTurnSoon(400)
    }

    private fun stopEars() {
        ticker?.cancel()
        ticker = null
        restart?.cancel()
        ears?.let { it.listener = null; it.cancel(); it.inUse = false }
        listening = false
        level = 0f
        live = ""
        muted = false
    }

    /**
     * The app went behind the lock, the switcher or another app: the microphone closes. A request already out finishes; its
     * answer waits on screen. [resume] opens it again.
     */
    fun pause() {
        if (clipMode || !listening) return
        stopEars()
        pausedByApp = true
    }

    fun resume() {
        if (closed || !pausedByApp) return
        ears?.let { hear(it) }
    }

    // MARK: Hearing

    /**
     * The mic button. Continuous: a tap while listening is "Done" (the sentence is read now, or, with nothing said, the
     * microphone closes); a tap while it is closed opens it. Clip mode: a recording starts and stops.
     */
    fun micTap(language: String) {
        this.language = language
        when {
            clipMode -> if (listening) finish() else start(language)
            listening -> finish()
            ears != null && !closed -> hear(ears!!)
            !opened -> open(language)
        }
    }

    /** Another language for the live words: the session in hand is replaced by one in it. */
    fun setLanguage(lang: String) {
        if (lang == language) return
        language = lang
        if (listening && !clipMode && !muted) {
            ears?.cancel()
            beginTurnSoon(150)
        }
    }

    /** Done: whatever has been said is read now (or the recording stops and is sent). */
    fun finish() {
        if (clipMode) { finishClip(); return }
        if (!listening) return
        if (live.isNotBlank()) finishTurn(null) else stopEars()
    }

    private fun finishTurn(finalText: String?) {
        val said = (finalText ?: live).trim()
        ears?.cancel()
        live = ""
        if (said.isEmpty()) { beginTurnSoon(120); return }
        route(said)
        // The microphone stays open for what comes next (a change, "yes"), whatever happens to this sentence.
        beginTurnSoon(150)
    }

    // MARK: Reading

    /** "Yes" and "no" answer a plan on screen; anything else is read (and, with a plan on screen, changes it). */
    private fun route(said: String) {
        if (writing) return
        if (thinking) {
            // Read next, in order; a "yes" now was about the plan before this one and is dropped.
            queued = VoiceLogic.queue(queued, said)
            return
        }
        if (plan != null && completed == 0) {
            when (VoiceReplies.of(said)) {
                VoiceReply.YES -> { save(); return }
                VoiceReply.NO -> { dismissPlan(); return }
                VoiceReply.OTHER -> {}
            }
        }
        interpret(said, audio = null, fresh = false)
    }

    /** The typed field's "Review" / "Read again": the words as they stand, as a request of their own. */
    fun readText(speak: Boolean) {
        if (busy || completed != 0) return
        readAloud = speak
        interpret(words, audio = null, fresh = true)
    }

    fun retry() {
        if (thinking) return
        val (w, audio) = sent ?: return
        interpret(w, audio, fresh = true)
    }

    private fun interpret(said: String, audio: Map<String, Any?>?, fresh: Boolean) {
        work?.cancel()
        silence()
        failure = null
        canRetry = false
        sent = said to audio
        thinking = true
        // With a plan not yet saved on screen the sentence is a change to it.
        val refining = if (audio == null && !fresh && completed == 0) plan else null
        val body = audio ?: VoiceLogic.requestBody(said, refining)
        val cumulative = VoiceLogic.cumulative(refining, said)
        val id = generation
        work = scope.launch {
            var follow: String? = null
            try {
                val raw = ask(body)
                if (generation != id) return@launch
                val heardByServer = (raw["transcript"] as? String).orEmpty()
                val reviewed = if (audio != null && heardByServer.isNotEmpty()) heardByServer else cumulative
                val made = VoicePlan(raw, reviewed)
                plan = made
                completed = 0
                words = reviewed
                if (readAloud) VoiceLogic.spoken(made).takeIf { it.isNotEmpty() }?.let { say(it) }
                follow = queued
                queued = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == id) {
                    failure = e.message ?: e.toString()
                    canRetry = true
                    queued = null
                }
            } finally {
                if (generation == id) thinking = false
            }
            // A sentence said while this was being read is a change to this plan, read now (a "yes" then was about the one before).
            val more = follow
            if (more != null && generation == id && VoiceReplies.of(more) == VoiceReply.OTHER) main.post { interpret(more, null, fresh = false) }
        }
    }

    fun dismissPlan() {
        silence()
        plan = null
        completed = 0
        failure = null
        words = ""
    }

    /** Sends the confirmed steps one at a time; those already saved are not sent again. Money is awaited, the rest queued. */
    fun save() {
        val p = plan ?: return
        if (!p.ready || p.operations.isEmpty() || words != p.reviewedWords || busy || completed >= p.operations.size) return
        silence()
        writing = true
        failure = null
        canRetry = false
        work = scope.launch {
            try {
                var index = 0
                for (card in p.cards) for (operation in card.operations) {
                    val at = index++
                    if (at < completed) continue
                    if (operation.op in OutboxEngine.moneyOps) write(operation.op, operation.fields) else queue(operation.op, operation.fields, card.title)
                    completed += 1
                }
                if (readAloud) say("Saved.")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            } finally {
                writing = false
            }
        }
    }

    /** Another request: what was read and said is cleared; the microphone stays as it is. */
    fun reset() {
        if (writing) return
        generation = UUID.randomUUID()
        work?.cancel()
        silence()
        if (clipMode) releaseAudio()
        words = ""
        live = ""
        failure = null
        canRetry = false
        plan = null
        completed = 0
        starting = false
        thinking = false
        queued = null
    }

    fun close() {
        if (writing) return
        closed = true
        generation = UUID.randomUUID()
        work?.cancel()
        stopEars()
        releaseAudio()
        silence()
        speaker?.shutdown()
        speaker = null
        speakerReady = false
    }

    // MARK: Speaking

    /** Stops speaking and opens the ear again. */
    fun silence() {
        pendingSpeech = null
        runCatching { speaker?.stop() }
        spokenEnd()
    }

    private fun say(text: String) {
        if (speaker != null && speakerReady) { speakNow(text); return }
        pendingSpeech = text
        if (speaker != null) return
        speaker = TextToSpeech(context) { status ->
            if (status != TextToSpeech.SUCCESS) return@TextToSpeech
            speakerReady = true
            speaker?.language = Locale.UK
            speaker?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { main.post { spokenEnd() } }
                @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { main.post { spokenEnd() } }
                override fun onStop(utteranceId: String?, interrupted: Boolean) { main.post { spokenEnd() } }
            })
            pendingSpeech?.let { pendingSpeech = null; if (readAloud) speakNow(it) }
        }
    }

    private fun speakNow(text: String) {
        // The ear shuts while the phone talks, or it would hear itself.
        if (listening) { muted = true; ears?.cancel(); live = "" }
        speaker?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "erp-voice")
    }

    private fun spokenEnd() {
        if (!muted) return
        muted = false
        if (listening && !closed) beginTurnSoon(200)
    }

    // MARK: Clip mode (no recogniser on the phone)

    fun start(language: String) {
        if (busy || listening) return
        this.language = language
        reset()
        starting = true
        val id = generation
        work = scope.launch {
            val allowed = micAllowed()
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
                r.setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) finishClip() }
                try {
                    r.prepare()
                    r.start()
                } catch (e: Exception) {
                    runCatching { r.release() }
                    throw ErpApi.Failure(0, "The microphone could not start. You can type instead.")
                }
                recorder = r
                peak = 0
                listening = true
                meter = scope.launch {
                    val deadline = System.currentTimeMillis() + VoiceLogic.MAX_MILLIS
                    while (listening) {
                        val amplitude = runCatching { r.maxAmplitude }.getOrDefault(0)
                        peak = maxOf(peak, amplitude)
                        level = VoiceLogic.level(amplitude)
                        if (System.currentTimeMillis() >= deadline) { finishClip(); break }
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

    @Suppress("DEPRECATION")
    private fun newRecorder(): MediaRecorder = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()

    /** Stop and send the recording. */
    private fun finishClip() {
        if (!listening) return
        runCatching { recorder?.stop() }
        listening = false
        meter?.cancel()
        val bytes = file?.let { runCatching { it.readBytes() }.getOrNull() }
        val loudest = peak
        releaseAudio()
        val input = VoiceLogic.input(bytes, loudest, "")
        if (input == null) {
            failure = "Nothing was recorded. Try again or type your request."
            return
        }
        interpret("", input, fresh = true)
    }

    private fun releaseAudio() {
        meter?.cancel()
        meter = null
        recorder?.let { runCatching { it.stop() }; runCatching { it.release() } }
        recorder = null
        if (clipMode) { listening = false; level = 0f }
        file?.let { runCatching { it.delete() } }
        file = null
    }

    private companion object {
        /** A session that dies this many times running ends listening (the iPhone's six). */
        const val MAX_FAILURES = 6
    }
}
