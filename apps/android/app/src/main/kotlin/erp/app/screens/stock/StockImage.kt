package erp.app.screens.stock

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import coil3.compose.SubcomposeAsyncImage
import erp.app.ui.SkeletonLoading
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The first letter of the name on a quiet square: the web's placeholder when a piece has no photo. */
@Composable
fun StockInitial(name: String) {
    Text(
        name.trim().take(1).uppercase(),
        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * A piece's photo, filling the frame it is given. A web address loads as it scrolls. A data address (a photo kept
 * inside the document, which can be megabytes) is skipped in a list ([decodeDataUri] false: the first letter instead)
 * and decoded once, off the main thread, where a single piece is shown.
 */
@Composable
fun StockImage(imageUrl: String?, name: String, key: String, modifier: Modifier = Modifier, decodeDataUri: Boolean = false) {
    val source = (imageUrl ?: "").trim()
    Box(
        modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest).clipToBounds(),
        contentAlignment = Alignment.Center,
    ) {
        when {
            source.startsWith("data:") -> if (decodeDataUri) StockDataImage(source, key, name) else StockInitial(name)
            source.startsWith("http") -> SubcomposeAsyncImage(
                model = source, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
                loading = { SkeletonLoading(compact = true) },
                error = { StockInitial(name) },
            )
            else -> StockInitial(name)
        }
    }
}

/** A photo kept in the document as "data:image/jpeg;base64,…": decoded and shrunk to the screen off the main thread. */
@Composable
private fun StockDataImage(uri: String, key: String, name: String) {
    val state by produceState<Decoded>(Decoded.Loading, key, uri.length) {
        value = withContext(Dispatchers.Default) {
            StockImageDecoder.bitmap(uri, 1600)?.let { Decoded.Ready(it.asImageBitmap()) } ?: Decoded.Failed
        }
    }
    when (val s = state) {
        is Decoded.Ready -> Image(s.bitmap, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Decoded.Failed -> StockInitial(name)
        Decoded.Loading -> SkeletonLoading(compact = true)
    }
}

private sealed interface Decoded {
    data object Loading : Decoded
    data object Failed : Decoded
    class Ready(val bitmap: ImageBitmap) : Decoded
}

object StockImageDecoder {
    /** The bytes inside a base64 data address; null for anything that is not base64 data. */
    fun bytes(uri: String): ByteArray? {
        val comma = uri.indexOf(',')
        if (comma < 0 || !uri.substring(0, comma).contains("base64")) return null
        return try { Base64.decode(uri.substring(comma + 1), Base64.DEFAULT) } catch (e: IllegalArgumentException) { null }
    }

    /**
     * The picture inside a base64 data address, no larger than [maxPixel] on its long side (decoded sampled, so a
     * 12-megapixel photo never sits whole in memory). Null for anything that is not base64 image data.
     */
    fun bitmap(uri: String, maxPixel: Int): android.graphics.Bitmap? {
        val data = bytes(uri) ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        var sample = 1
        val longSide = maxOf(bounds.outWidth, bounds.outHeight)
        while (longSide / (sample * 2) >= maxPixel) sample *= 2
        return BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
