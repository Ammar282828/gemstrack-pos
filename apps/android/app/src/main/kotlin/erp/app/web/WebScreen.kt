package erp.app.web

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import erp.app.BuildConfig
import erp.app.config.House
import erp.app.device.Foreground
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * An ERP page inside the app, for every place without a native screen yet (CONVENTIONS.md rule 5). Signed in
 * with the app's own sign-in, shown without the ERP's sidebar and top bar (the page reads "ERPNative/" in the
 * user agent), its downloads, share sheet and live words handed to the phone through WebBridge: the same calls
 * the ERP made to the Capacitor shell.
 */
@Composable
fun WebScreen(path: String, modifier: Modifier = Modifier) {
    var loading by remember(path) { mutableStateOf(true) }
    var failed by remember(path) { mutableStateOf<String?>(null) }
    var canGoBack by remember(path) { mutableStateOf(false) }
    var attempt by remember(path) { mutableIntStateOf(0) }
    var web by remember { mutableStateOf<WebView?>(null) }
    val scope = rememberCoroutineScope()
    val background = MaterialTheme.colorScheme.background.toArgb()

    Surface(modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            key(path, attempt) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        makeWebView(
                            ctx, path, background, scope,
                            onLoading = { loading = it },
                            onFailed = { failed = it },
                            onHistory = { canGoBack = it },
                        ).also { web = it }
                    },
                    onRelease = { v ->
                        (v.tag as? WebBridge)?.stop()
                        v.stopLoading()
                        v.destroy()
                        if (web === v) web = null
                    },
                )
            }
            if (loading && failed == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            failed?.let { why ->
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(
                        Modifier.padding(32.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Couldn't open this page", style = MaterialTheme.typography.titleMedium)
                        Text(why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(onClick = { failed = null; loading = true; attempt += 1 }) { Text("Try again") }
                    }
                }
            }
        }
    }
    BackHandler(enabled = canGoBack) { web?.goBack() }
}

/** The address of an ERP path on the house's own host. */
fun erpUrl(path: String): String = House.serverUrl.toHttpUrl().resolve(path)?.toString() ?: House.serverUrl

@SuppressLint("SetJavaScriptEnabled")
private fun makeWebView(
    context: Context,
    path: String,
    background: Int,
    scope: CoroutineScope,
    onLoading: (Boolean) -> Unit,
    onFailed: (String) -> Unit,
    onHistory: (Boolean) -> Unit,
): WebView {
    val web = WebView(context)
    web.setBackgroundColor(background)
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    with(web.settings) {
        javaScriptEnabled = true
        domStorageEnabled = true
        mediaPlaybackRequiresUserGesture = false
        allowFileAccess = false
        allowContentAccess = false
        setSupportMultipleWindows(true)
        userAgentString = "$userAgentString ERPApp/1 (${House.id}) ERPNative/1"
    }
    // Firebase's own sign-in iframe and Google's scripts read cookies from other origins.
    CookieManager.getInstance().apply {
        setAcceptCookie(true)
        setAcceptThirdPartyCookies(web, true)
    }
    val bridge = WebBridge(context, web)
    val bridged = bridge.install()
    web.tag = bridge

    web.webViewClient = object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            onLoading(true)
            // Without document-start scripts the shim goes in as the page begins, which is as early as the page lets us.
            if (bridged && !bridge.injectedAtStart && isMine(url)) bridge.injectNow()
        }

        override fun onPageFinished(view: WebView, url: String?) { onLoading(false) }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { onHistory(view.canGoBack()) }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                onLoading(false)
                onFailed(error.description?.toString()?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
            }
        }

        /** The ERP's own addresses stay here; any other site opens in its own app or a Custom Tab. */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val mine = isMine(url.toString()) || url.scheme in setOf("about", "blob", "data")
            if (mine || !request.isForMainFrame) return false
            openOutside(view.context, url)
            return true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            onFailed("The page stopped working.")
            return true
        }
    }

    web.webChromeClient = object : WebChromeClient() {
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
            // window.open and target=_blank: another site opens outside, the ERP's own address in this page. A
            // throwaway view learns the address, then goes.
            val probe = WebView(view.context)
            probe.webViewClient = object : WebViewClient() {
                private fun take(url: String?) {
                    if (url != null && url != "about:blank") {
                        if (isMine(url)) view.loadUrl(url) else openOutside(view.context, Uri.parse(url))
                        probe.post { probe.destroy() }
                    }
                }

                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean { take(request.url.toString()); return true }
                override fun onPageStarted(v: WebView, url: String?, favicon: Bitmap?) { take(url) }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = probe
            resultMsg.sendToTarget()
            return true
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            scope.launch { callback.onReceiveValue(chooseFiles(view.context, params)) }
            return true
        }

        // getUserMedia: the ERP's own page may use the camera and microphone, after Android's own question.
        override fun onPermissionRequest(request: PermissionRequest) {
            if (request.origin.host != House.serverHost) return request.deny()
            scope.launch {
                val granted = mutableListOf<String>()
                for (r in request.resources) {
                    val perm = when (r) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        else -> null
                    } ?: continue
                    val has = ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
                    if (has || Foreground.launchers?.permission(perm) == true) granted.add(r)
                }
                if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
            }
        }

        // The ERP's confirm() and alert() as the phone's own.
        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            AlertDialog.Builder(view.context).setMessage(message)
                .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            AlertDialog.Builder(view.context).setMessage(message)
                .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                .setOnCancelListener { result.confirm() }.show()
            return true
        }
    }

    // A download the view cannot take itself (blob:, or the ERP's own file): the page reads it and shares it.
    web.setDownloadListener(DownloadListener { url, _, contentDisposition, mimeType, _ ->
        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        if (url.startsWith("blob:") || isMine(url)) web.evaluateJavascript(BridgeProtocol.downloadHook(url, name), null)
        else openOutside(context, Uri.parse(url))
    })

    web.loadUrl(erpUrl(path))
    return web
}

private fun isMine(url: String?): Boolean {
    val u = url?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return false
    return u.scheme == "https" && u.host.equals(House.serverHost, ignoreCase = true)
}

/** What leaves the ERP for another app: a web page, a call, a mail, a text or WhatsApp. Any other scheme (another app's private link) is never followed from a page. */
private val OUTSIDE = setOf("https", "http", "tel", "mailto", "sms", "whatsapp")

fun openOutside(context: Context, url: Uri) {
    val scheme = url.scheme?.lowercase() ?: return
    if (scheme !in OUTSIDE) return
    try {
        if (scheme == "https" || scheme == "http") {
            CustomTabsIntent.Builder().build().launchUrl(context, url)
        } else {
            context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    } catch (e: ActivityNotFoundException) {
        // Nothing on this phone opens it.
    }
}

/** A file input: the camera when the page asks for the camera, else Android's file chooser. */
private suspend fun chooseFiles(context: Context, params: WebChromeClient.FileChooserParams): Array<Uri>? {
    val launchers = Foreground.launchers ?: return null
    val wantsPhoto = params.isCaptureEnabled && params.acceptTypes.any { it.startsWith("image") || it.isEmpty() }
    if (wantsPhoto) {
        val dir = File(context.cacheDir, "capture").apply { mkdirs() }
        val file = File.createTempFile("photo-", ".jpg", dir)
        val uri = FileProvider.getUriForFile(context, "${House.applicationId}.files", file)
        return if (launchers.takePicture(uri)) arrayOf(uri) else null
    }
    val result = try { launchers.intent(params.createIntent()) } catch (e: ActivityNotFoundException) { return null }
    return WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
}
