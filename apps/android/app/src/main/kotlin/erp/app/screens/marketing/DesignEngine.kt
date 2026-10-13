package erp.app.screens.marketing

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import erp.app.config.House
import java.io.ByteArrayInputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// The designer engine: the web's own `src/lib/social`, bundled per house (assets/design-<house>.js, the flavor's own)
// and run in a web view that has no network. Screens and editing controls are native; only pixels and documents cross
// this bridge (NativeArtwork.swift). The one JS entry point is `window.nativeDesign(input)`; the message protocol is
// `DesignProtocol`, plain JSON in and out, tested without a device.

/** The engine could not draw (not loaded, the renderer stopped, the design threw): [message] is for the person. */
class DesignFailure(override val message: String) : Exception(message)

/** The message protocol of `window.nativeDesign`: JSON in, JSON out. Pure, so it is tested on the JVM. */
object DesignProtocol {
    /** The page's own rules: scripts and styles inline, pictures and fonts only as data, nothing fetched (ever). */
    const val POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"

    /** The page the engine runs in: the bundle inline, a `</script` inside it escaped so it cannot end the tag. */
    fun page(script: String): String =
        "<!doctype html><meta http-equiv='Content-Security-Policy' content=\"$POLICY\"><script>${script.replace("</script", "<\\/script")}</script>"

    /** A photograph as the engine takes it: a data address, its type read from its bytes (JPEG when unsure). */
    fun photoDataUrl(data: ByteArray): String =
        "data:${MarketingPhotos.kind(data)?.mime ?: "image/jpeg"};base64,${java.util.Base64.getEncoder().encodeToString(data)}"

    /**
     * What `nativeDesign` is called with: the options (`action`, `value`, `px`, `piece`, `context`, `background`…) with the
     * document, the photographs (id → data address), the fields (kicker, headline, weight, details) and the house on top
     * of them, as the Swift builds it. A null document is sent as null (the engine then starts a blank one).
     */
    fun input(doc: MarketingValue, photos: Map<String, String>, fields: Map<String, String>, house: String, options: Map<String, Any?> = emptyMap()): String {
        val input = LinkedHashMap<String, Any?>(options)
        input["doc"] = doc.json
        input["photos"] = photos
        input["fields"] = fields
        input["house"] = house
        return MarketingValue.of(input).text
    }

    /**
     * The answer, read. The engine reports a throw as `{nativeError}`; that becomes a failure in the Swift's words
     * ("The design could not be drawn: …"). An answer that is not an object is a failure too.
     */
    fun parse(text: String): MarketingValue {
        val answer = MarketingValue.parse(text)
        if (answer.s("nativeError").isNotEmpty()) throw DesignFailure("The design could not be drawn: " + answer.s("nativeError"))
        if (answer.obj.isEmpty()) throw DesignFailure("The design could not be drawn.")
        return answer
    }

    /**
     * The call the web view runs: the input is taken from the bridge by id (a design with photographs is megabytes,
     * too many for a script string), the promise awaited, and the answer, or the error, handed back by id.
     */
    fun call(id: String): String =
        "(async function(){var id=" + MarketingValue.string(id).json + ";var out;try{var input=JSON.parse(NativeDesign.input(id));" +
            "var r=await window.nativeDesign(input);out=JSON.stringify(r===undefined?null:r);}catch(e){out=JSON.stringify({nativeError:String(e)});}" +
            "NativeDesign.done(id,out);})();"

    /** The base64 JPEG inside an answer (`image`), as bytes; null when there is none. */
    fun imageBytes(response: MarketingValue): ByteArray? {
        val text = response.s("image")
        if (text.isEmpty()) return null
        return try { java.util.Base64.getMimeDecoder().decode(text) } catch (e: IllegalArgumentException) { null }
    }
}

/**
 * The shared drawing engine. One web view per engine, made on first use and loaded once; runs are one at a time.
 * Use `rememberDesignEngine()` in a screen (it is closed with the screen) or make one and `close()` it.
 *
 *     val engine = rememberDesignEngine()
 *     val answer = engine.run(doc, photos = mapOf(id to jpegBytes), fields = mapOf("headline" to "Ruby set"),
 *         options = mapOf("action" to "preset", "value" to "stack-left", "px" to 540))
 *     val doc2 = answer["doc"]; val jpeg = DesignProtocol.imageBytes(answer)
 */
class DesignEngine(context: Context, private val house: String = House.id, private val scriptSource: (() -> String)? = null) {
    private val appContext = context.applicationContext
    private val lock = Mutex()
    private val ids = AtomicLong()
    private val inputs = ConcurrentHashMap<String, String>()
    private val waiting = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private var web: WebView? = null
    private var ready: CompletableDeferred<Unit>? = null
    private var closed = false

    /** The two calls the page makes back, by request id (`DesignProtocol.call`). */
    private inner class Bridge {
        @JavascriptInterface fun input(id: String): String = inputs[id] ?: "{}"
        @JavascriptInterface fun done(id: String, text: String) { waiting.remove(id)?.complete(text) }
    }

    private val bridge = Bridge()

    /** Draws or edits [doc]: see `DesignProtocol.input`. The caller's coroutine may be cancelled; a draw already begun just finishes unheard. */
    suspend fun run(doc: MarketingValue, photos: Map<String, ByteArray>, fields: Map<String, String>, options: Map<String, Any?> = emptyMap()): MarketingValue {
        if (closed) throw DesignFailure("The artwork renderer is closed.")
        val urls = withContext(Dispatchers.Default) { photos.mapValues { DesignProtocol.photoDataUrl(it.value) } }
        val body = withContext(Dispatchers.Default) { DesignProtocol.input(doc, urls, fields, house, options) }
        return lock.withLock { exchange(body) }
    }

    private suspend fun exchange(body: String): MarketingValue {
        val id = "d" + ids.incrementAndGet()
        val answer = CompletableDeferred<String>()
        try {
            withContext(Dispatchers.Main) {
                val view = ensureLoaded()
                inputs[id] = body
                waiting[id] = answer
                view.evaluateJavascript(DesignProtocol.call(id), null)
            }
            return DesignProtocol.parse(answer.await())
        } finally {
            inputs.remove(id)
            waiting.remove(id)
        }
    }

    /** The web view, made and loaded (main thread). A second caller waits for the first's load. */
    @SuppressLint("SetJavaScriptEnabled")
    private suspend fun ensureLoaded(): WebView {
        var view = web
        var loading = ready
        if (view == null || loading == null) {
            val script = withContext(Dispatchers.IO) { scriptSource?.invoke() ?: appContext.assets.open("design-$house.js").bufferedReader().use { it.readText() } }
            val signal = CompletableDeferred<Unit>()
            val made = WebView(appContext)
            made.settings.apply {
                javaScriptEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                blockNetworkLoads = true
                domStorageEnabled = false
                @Suppress("DEPRECATION") databaseEnabled = false
            }
            made.setBackgroundColor(0)
            made.layout(0, 0, 1080, 1920)
            made.addJavascriptInterface(bridge, "NativeDesign")
            made.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) { signal.complete(Unit) }

                // Nothing but the page itself and data addresses is ever fetched: the engine runs with no network.
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                    val scheme = request?.url?.scheme ?: return null
                    return if (scheme == "data" || scheme == "about" || scheme == "blob") null
                    else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }

                // What was drawing fails once; the engine starts again, so the next drawing works without reopening.
                override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                    for ((_, w) in waiting) w.completeExceptionally(DesignFailure("The artwork renderer stopped. Try again."))
                    waiting.clear()
                    web?.destroy()
                    web = null
                    ready = null
                    return true
                }
            }
            made.loadDataWithBaseURL(null, DesignProtocol.page(script), "text/html", "utf-8", null)
            made.onResume()
            web = made
            ready = signal
            view = made
            loading = signal
        }
        loading.await()
        return view
    }

    /** Releases the web view. Anything still drawing fails once. */
    fun close() {
        closed = true
        for ((_, w) in waiting) w.completeExceptionally(CancellationException("closed"))
        waiting.clear()
        val view = web
        web = null
        ready = null
        view?.post { view.destroy() }
    }
}

@Composable
fun rememberDesignEngine(): DesignEngine {
    val context = LocalContext.current
    val engine = remember { DesignEngine(context) }
    DisposableEffect(engine) { onDispose { engine.close() } }
    return engine
}

/** What a draw answers, in the shapes the screens use (NativeArtwork's statics). */
object NativeArtwork {
    /** A blank page: the colour ground EDE6DA, 1080 wide ([height] 1920 a story, 1080 a square, which also holds `placements`). */
    fun blank(photo: String? = null, height: Double = 1920.0): MarketingValue {
        val doc = MarketingValue.of(
            mapOf(
                "bg" to mapOf("photoId" to photo, "placement" to mapOf("mode" to "fill", "zoom" to 1, "focusX" to 0.5, "focusY" to 0.5), "dim" to 0, "gradient" to "none", "color" to "#EDE6DA"),
                "layers" to emptyList<Any>(),
                "frame" to mapOf("w" to 1080, "h" to height),
            ),
        )
        return if (height == 1080.0) doc.with("placements", MarketingValue.of(emptyMap<String, Any>())) else doc
    }

    /** The picture inside an answer, decoded (null when there is none). Do not call on the main thread for a large one. */
    fun image(response: MarketingValue): Bitmap? = DesignProtocol.imageBytes(response)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
}
