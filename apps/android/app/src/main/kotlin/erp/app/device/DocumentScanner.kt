package erp.app.device

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/**
 * Paper for the ERP's readers (a bill, a parchi, an order slip): Google's scanner finds the page's edges,
 * squares it up and evens the light, which a photo of paper on a counter never is. The ERP's "From Photos"
 * stays beside it for a bill that arrived on WhatsApp.
 */
object DocumentScanner {
    class Page(val jpeg: ByteArray, val name: String)
    class Failure(val code: String, override val message: String) : Exception(message)

    fun isSupported(activity: Activity): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) == ConnectionResult.SUCCESS

    /** The pages scanned, JPEG, no side longer than 2200 px: enough to read a bill, small enough to send. */
    suspend fun scan(activity: Activity): List<Page> {
        val launchers = Foreground.launchers
        if (launchers == null || !isSupported(activity)) throw Failure("unsupported", "This phone can't scan documents.")
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(20)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        val sender = try {
            GmsDocumentScanning.getClient(options).getStartScanIntent(activity).await()
        } catch (e: Exception) {
            throw Failure("failed", e.message ?: "The scanner couldn't open.")
        }
        val result = launchers.intentSender(IntentSenderRequest.Builder(sender).build())
        if (result.resultCode != Activity.RESULT_OK) throw Failure("cancelled", "Cancelled")
        val scanned = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
        val uris = scanned?.pages?.map { it.imageUri } ?: emptyList()
        val pages = withContext(Dispatchers.Default) {
            uris.mapIndexedNotNull { i, uri -> jpeg(activity, uri, 2200)?.let { Page(it, "Scan ${i + 1}.jpg") } }
        }
        if (pages.isEmpty()) throw Failure("failed", "Nothing was scanned.")
        return pages
    }

    private fun jpeg(activity: Activity, uri: Uri, longest: Int): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        activity.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val side = maxOf(bounds.outWidth, bounds.outHeight)
        if (side <= 0) return null
        var sample = 1
        while (side / (sample * 2) >= longest) sample *= 2
        val decoded = activity.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val big = maxOf(decoded.width, decoded.height)
        val fitted = if (big > longest) {
            val k = longest.toFloat() / big
            Bitmap.createScaledBitmap(decoded, (decoded.width * k).toInt(), (decoded.height * k).toInt(), true)
        } else decoded
        return ByteArrayOutputStream().use { out ->
            fitted.compress(Bitmap.CompressFormat.JPEG, 82, out)
            out.toByteArray()
        }
    }
}
