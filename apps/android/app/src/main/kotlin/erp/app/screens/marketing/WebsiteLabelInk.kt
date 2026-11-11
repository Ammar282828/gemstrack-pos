package erp.app.screens.marketing

import android.content.Context
import android.graphics.Bitmap
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Size
import coil3.toBitmap
import erp.core.logic.PhotoLabel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.coroutines.cancellation.CancellationException

/**
 * White or dark for the weight and carats drawn on a photo, by the photo itself: the website's rule
 * (lib/website/label-ink.ts, taheri.shop's WeightLabel.jsx `inkFor`) in core's [PhotoLabel], here only reading the pixels.
 * The web asks its server (`/api/website/pieces/ink`) because a browser cannot read another origin's pixels; the phone
 * already holds the photo (Coil's cache), so it reads the label's corner itself. White when the photo cannot be read,
 * as the server answers.
 */
object WebsiteLabelInk {
    suspend fun of(context: Context, url: String): Int = try {
        val request = ImageRequest.Builder(context).data(url).size(Size(768, 768)).allowHardware(false).build()
        val result = SingletonImageLoader.get(context).execute(request)
        val bitmap = (result as? SuccessResult)?.image?.toBitmap()
        if (bitmap == null) PhotoLabel.WHITE_INK else withContext(Dispatchers.Default) { inkOf(bitmap) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        PhotoLabel.WHITE_INK
    }

    /** The label's corner of this bitmap (against its own width, as the server does), its mean luminance, its ink. */
    fun inkOf(bitmap: Bitmap): Int {
        val a = PhotoLabel.area(bitmap.width, bitmap.height)
        if (a.left >= bitmap.width || a.top >= bitmap.height) return PhotoLabel.WHITE_INK
        val w = minOf(a.width, bitmap.width - a.left)
        val h = minOf(a.height, bitmap.height - a.top)
        val px = IntArray(w * h)
        bitmap.getPixels(px, 0, w, a.left, a.top, w, h)
        return PhotoLabel.inkFor(PhotoLabel.meanLuminance(px))
    }
}
