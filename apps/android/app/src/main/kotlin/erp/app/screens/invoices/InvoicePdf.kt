package erp.app.screens.invoices

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import erp.app.ErpApp
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.ui.PdfDocumentScreen
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * The invoice's PDF: drawn on the ERP's server (/api/app/pdf/invoice, lib/invoice-pdf.ts, the one Print saves),
 * fetched as the signed-in person, shown natively (the kit's PdfDocumentScreen) and handed to Android's share sheet
 * (Print, Save, WhatsApp) through our FileProvider.
 *
 * Two small local workarounds, until the shell has them: `ErpApi.data` answers text (a PDF's bytes would not survive
 * it), so the bytes are fetched here with the same token and the same refusal to leave the ERP's host; and the kit
 * keeps its PDF under cache/erp-pdf, which file_paths.xml does not share, so the file is copied under cache/erp-web
 * (which it does) for the share sheet.
 */
object InvoicePdfShare {
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cache(null)
            .followRedirects(true)
            .followSslRedirects(false)
            // A redirect off the ERP's own host (or off https) is refused, so the Authorization header never follows one.
            .addNetworkInterceptor { chain ->
                val u = chain.request().url
                if (u.scheme != "https" || u.host != House.serverHost) throw IOException("Redirected away from the ERP.")
                chain.proceed(chain.request())
            }
            .connectTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    /** The file's bytes from the ERP, as the signed-in person. A long timeout: a bill of many pieces takes a second or two to draw. */
    suspend fun fetch(path: String, timeoutMs: Long = 90_000): ByteArray {
        if (House.isDemo || !ErpApp.firebaseReady) throw ErpApi.Failure(0, "Not connected to the ERP in the demo.")
        val url = ErpApi.resolve(House.serverUrl, path) ?: throw ErpApi.Failure(0, "Not an address of this ERP.")
        val builder = Request.Builder().url(url).header("Accept", "application/pdf")
        val token = try {
            com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        token?.let { builder.header("Authorization", "Bearer $it") }
        val call = client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build().newCall(builder.build())
        val response = try {
            call.await()
        } catch (e: IOException) {
            throw ErpApi.Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
        }
        response.use { r ->
            if (r.code !in 200..299) {
                val text = runCatching { r.body.string() }.getOrDefault("")
                throw ErpApi.Failure(r.code, ErpApi.said(text) ?: "The ERP answered ${r.code}.")
            }
            return r.body.bytes()
        }
    }

    /** A file's name, never a path. */
    internal fun cleanName(name: String): String {
        val n = name.replace("/", " ").replace(":", " ").trim().ifEmpty { "Document" }
        return if (n.lowercase().endsWith(".pdf")) n else "$n.pdf"
    }

    /** Hands the PDF to the system share sheet (Print is in it, beside Save and WhatsApp). */
    fun share(context: Context, file: File, title: String) {
        val dir = File(File(context.cacheDir, "erp-web"), "share-" + UUID.randomUUID()).apply { mkdirs() }
        val copy = File(dir, cleanName(file.name)).also { file.copyTo(it, overwrite = true) }
        val uri = FileProvider.getUriForFile(context, "${House.applicationId}.files", copy)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, title)
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startChooser(context, Intent.createChooser(send, title))
    }

    /** Shares the customer's link with its words (the iPhone's ShareLink: subject, message and the address). */
    fun shareText(context: Context, subject: String, text: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startChooser(context, Intent.createChooser(send, subject))
    }

    /** Opens a web address (wa.me) in whatever handles it: WhatsApp when it is on the phone. */
    fun openUrl(context: Context, url: String) {
        startChooser(context, Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    private fun startChooser(context: Context, intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // Nothing on the phone handles it: the button simply opened nothing.
        }
    }
}

/** OkHttp's call as a suspension that cancels the call with its coroutine. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont: CancellableContinuation<Response> ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWith(Result.failure(e)) }
        override fun onResponse(call: Call, response: Response) { if (cont.isActive) cont.resumeWith(Result.success(response)) else response.close() }
    })
}

/**
 * The PDF over the screen, full window, with its own title bar, Back and Share (the iPhone pushes PDFDocumentScreen;
 * a screen here makes no stack of its own, so it is a dialog that fills the window).
 */
@Composable
fun InvoicePdfDialog(target: InvoicePdfTarget, onDismiss: () -> Unit) {
    val context = LocalContext.current
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        PdfDocumentScreen(
            title = target.title,
            fileName = target.fileName,
            load = { InvoicePdfShare.fetch(target.path) },
            onShare = { file -> InvoicePdfShare.share(context, file, target.fileName.removeSuffix(".pdf")) },
            onBack = onDismiss,
        )
    }
}
