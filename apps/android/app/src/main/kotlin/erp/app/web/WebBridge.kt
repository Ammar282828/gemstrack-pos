package erp.app.web

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import erp.app.BuildConfig
import erp.app.config.House
import erp.app.data.JsonText
import erp.app.auth.GoogleAuth
import erp.app.device.BiometricVault
import erp.app.device.DocumentScanner
import erp.app.device.Foreground
import erp.app.device.SpeechEngine
import java.io.File
import java.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What an ERP page inside the app asks of the phone: the same calls it made to the Capacitor shell
 * (src/lib/native-app.ts: `Capacitor.nativePromise(plugin, method, options)` and `Capacitor.addListener`),
 * answered natively. A rejection carries "code|message", which the shim turns back into an Error with `.code`
 * ("cancelled" is a person closing a sheet).
 */
class WebBridge(private val context: Context, private val web: WebView) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val speech = SpeechEngine(context) { event, data -> emit("ERPNative", event, data) }

    sealed interface Reply {
        data class Ok(val result: Any? = null) : Reply
        data class No(val code: String, val message: String) : Reply
    }

    /** Wires the listener for the ERP's origin only and injects the shim before the page's scripts. False where the web view lacks the features. */
    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val origin = "https://${House.serverHost}"
        WebViewCompat.addWebMessageListener(web, BridgeProtocol.OBJECT_NAME, setOf(origin)) { _, message, sourceOrigin, isMainFrame, reply ->
            onMessage(message, sourceOrigin, isMainFrame, reply)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, BridgeProtocol.script, setOf(origin))
            injectedAtStart = true
        }
        return true
    }

    /** True once the shim is set to run before the page's scripts; otherwise the WebViewClient injects it as the page starts. */
    var injectedAtStart = false
        private set

    fun injectNow() {
        web.evaluateJavascript(BridgeProtocol.script, null)
    }

    fun stop() {
        speech.stop(notify = false)
        scope.cancel()
    }

    private fun onMessage(message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, reply: JavaScriptReplyProxy) {
        val call = BridgeProtocol.parse(message.data)
        val id = call?.id
        if (!BridgeProtocol.originAllowed(sourceOrigin.scheme, sourceOrigin.host, sourceOrigin.port, isMainFrame, House.serverHost)) {
            return reply.postMessage(BridgeProtocol.failure(id, "forbidden", "Not this page's to ask"))
        }
        if (call == null) return reply.postMessage(BridgeProtocol.failure(id, "invalid", "Not a call"))
        scope.launch {
            val out = try {
                handle(call.plugin, call.method, call.options)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Reply.No("failed", e.message ?: "The app couldn't do that")
            }
            reply.postMessage(
                when (out) {
                    is Reply.Ok -> BridgeProtocol.reply(id, out.result)
                    is Reply.No -> BridgeProtocol.failure(id, out.code, out.message)
                },
            )
        }
    }

    private fun emit(plugin: String, event: String, data: Map<String, Any?>) {
        val json = JsonText.of(data) ?: return
        web.post { web.evaluateJavascript("window.__erpEmit && window.__erpEmit('$plugin','$event',$json)", null) }
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun handle(plugin: String, method: String, o: Map<String, Any?>): Reply {
        val activity = Foreground.activity
        return when (plugin to method) {
            "ERPNative" to "info" -> Reply.Ok(
                mapOf(
                    "bundleId" to House.applicationId, "version" to BuildConfig.VERSION_NAME, "build" to BuildConfig.VERSION_CODE.toString(),
                    "googleSignIn" to true, "speech" to true, "features" to features(),
                ),
            )
            "ERPNative" to "googleSignIn" -> {
                if (activity == null) return Reply.No("failed", "The app isn't in front.")
                try {
                    val t = GoogleAuth.idToken(activity, interactive = true)
                    Reply.Ok(mapOf("idToken" to t.idToken, "accessToken" to t.accessToken))
                } catch (e: GoogleAuth.Failure) {
                    Reply.No(e.code, e.message ?: "Sign-in failed")
                }
            }
            "ERPNative" to "biometry" -> {
                val (available, type) = BiometricVault.biometry()
                Reply.Ok(mapOf("available" to available, "type" to type))
            }
            "ERPNative" to "secretSave" -> {
                val key = o["key"] as? String
                val value = o["value"] as? String
                if (key == null || value == null) return Reply.No("invalid", "key and value are needed")
                try { BiometricVault.save(value, key); Reply.Ok(mapOf("saved" to true)) } catch (e: BiometricVault.Failure) { Reply.No(e.code, e.message) }
            }
            "ERPNative" to "secretHas" -> Reply.Ok(mapOf("has" to BiometricVault.has(o["key"] as? String ?: "")))
            "ERPNative" to "secretRead" -> {
                val key = o["key"] as? String ?: return Reply.No("invalid", "key is needed")
                try {
                    // null: nothing kept on this phone (the page then asks for the code typed).
                    Reply.Ok(mapOf("value" to BiometricVault.read(key, o["reason"] as? String ?: "Unlock")))
                } catch (e: BiometricVault.Failure) {
                    Reply.No(e.code, e.message)
                }
            }
            "ERPNative" to "secretDelete" -> { BiometricVault.delete(o["key"] as? String ?: ""); Reply.Ok() }
            "ERPNative" to "scanDocument" -> {
                if (activity == null) return Reply.No("failed", "The app isn't in front.")
                try {
                    val pages = DocumentScanner.scan(activity)
                    Reply.Ok(mapOf("pages" to pages.map { mapOf("data" to Base64.getEncoder().encodeToString(it.jpeg), "name" to it.name) }))
                } catch (e: DocumentScanner.Failure) {
                    Reply.No(e.code, e.message)
                }
            }
            "ERPNative" to "chrome" -> Reply.Ok() // the app draws its own bars
            "ERPNative" to "speechStart" -> speech.start(o["lang"] as? String ?: "en-IN")?.let { Reply.No(it.first, it.second) } ?: Reply.Ok()
            "ERPNative" to "speechStop" -> { speech.stop(notify = true); Reply.Ok() }
            "Filesystem" to "writeFile" -> try {
                Reply.Ok(mapOf("uri" to withContext(Dispatchers.IO) { Files.write(context, o) }.toString()))
            } catch (e: Exception) {
                Reply.No("failed", e.message ?: "The file couldn't be written")
            }
            "Filesystem" to "rmdir" -> { withContext(Dispatchers.IO) { Files.remove(context, o["path"] as? String ?: "shared") }; Reply.Ok() }
            "Share" to "share" -> share(o)
            else -> Reply.No("unimplemented", "$plugin.$method is not in this app")
        }
    }

    /**
     * What this phone can do for a page, so the page can choose before a tap (a file input opened after an
     * asynchronous call has lost the tap). "faceID" is the page's name for its biometric option (any biometric here).
     */
    private fun features(): List<String> {
        val f = mutableListOf("share", "files")
        val activity = Foreground.activity
        if (activity != null && DocumentScanner.isSupported(activity)) f.add("scan")
        if (BiometricVault.biometry().first) f.add("faceID")
        return f
    }

    // MARK: Share

    /**
     * The system share sheet. Android does not say whether the person chose a target or closed it, so the page's
     * promise resolves once the sheet is up (the iPhone's rejects "cancelled" on close).
     */
    private fun share(o: Map<String, Any?>): Reply {
        val activity = Foreground.activity ?: return Reply.No("failed", "The app isn't in front.")
        val uris = (o["files"] as? List<*>).orEmpty().mapNotNull { (it as? String)?.let(Uri::parse) }.filter { Files.isOurs(it) }
        val text = listOfNotNull(o["text"] as? String, o["url"] as? String).filter { it.isNotBlank() }.joinToString("\n")
        if (uris.isEmpty() && text.isEmpty()) return Reply.No("failed", "Nothing to share")
        val intent = Intent(if (uris.size > 1) Intent.ACTION_SEND_MULTIPLE else Intent.ACTION_SEND)
        if (text.isNotEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text)
        (o["title"] as? String)?.takeIf { it.isNotBlank() }?.let { intent.putExtra(Intent.EXTRA_SUBJECT, it) }
        if (uris.isNotEmpty()) {
            val types = uris.map { context.contentResolver.getType(it) ?: "application/octet-stream" }.distinct()
            intent.type = types.singleOrNull() ?: "*/*"
            if (uris.size > 1) intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris)) else intent.putExtra(Intent.EXTRA_STREAM, uris.first())
            intent.clipData = ClipData.newRawUri("", uris.first()).also { c -> uris.drop(1).forEach { c.addItem(ClipData.Item(it)) } }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } else {
            intent.type = "text/plain"
        }
        val chooser = Intent.createChooser(intent, (o["dialogTitle"] as? String) ?: (o["title"] as? String))
        activity.startActivity(chooser)
        return Reply.Ok()
    }
}

/** Files the page hands out (a PDF to share): kept in the cache, offered through our FileProvider, swept by the page on its next visit. */
object Files {
    private fun base(context: Context) = File(context.cacheDir, "erp-web")
    fun authority() = "${House.applicationId}.files"

    /** A content address of ours (never another app's, never file://): the only thing Share will carry. */
    fun isOurs(uri: Uri): Boolean = uri.scheme == "content" && uri.authority == authority()

    fun write(context: Context, o: Map<String, Any?>): Uri {
        val target = resolve(base(context), o["path"] as? String ?: "file")
        target.parentFile?.mkdirs()
        val bytes = Base64.getMimeDecoder().decode(o["data"] as? String ?: throw IllegalArgumentException("No data"))
        target.writeBytes(bytes)
        return FileProvider.getUriForFile(context, authority(), target)
    }

    fun remove(context: Context, path: String) {
        resolve(base(context), path).deleteRecursively()
    }

    /** `rel` under `root`, whatever `..` or leading slashes it carries. */
    fun resolve(root: File, rel: String): File {
        val clean = rel.replace("..", "").trimStart('/', '\\')
        val f = File(root, clean.ifEmpty { "file" })
        require(f.canonicalPath.startsWith(root.canonicalPath)) { "Not a path of this app" }
        return f
    }
}
