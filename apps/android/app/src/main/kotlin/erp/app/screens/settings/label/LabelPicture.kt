package erp.app.screens.settings.label

import erp.app.ui.icons.Symbols
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.screens.neworder.NewOrderPhotoCodec
import erp.app.ui.FullScreenSheet
import erp.app.ui.Radius
import erp.app.ui.SmallPrint
import erp.app.ui.Tone
import erp.app.screens.settings.SettingsSection
import erp.core.logic.DecodedImage
import erp.core.logic.Dither
import erp.core.logic.LabelBitmap
import erp.core.logic.LabelUnits
import erp.core.logic.PNG
import erp.core.models.LabelLayoutField
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Pictures on a tag. A photo or a file becomes the 1-bit bitmap a Zebra prints (core's `LabelBitmap.fromRaster`: threshold,
// Atkinson or Floyd-Steinberg), scaled to dots. The field keeps a small copy of the original (under 64 KB, as the web does) so
// its dithering can be changed later. (The iPhone's LabelPicture.swift.)

object LabelPicture {
    /** Straight (not premultiplied) RGBA, the form `LabelBitmap.fromRaster` reads. */
    fun decoded(bmp: Bitmap): DecodedImage? {
        val w = bmp.width
        val h = bmp.height
        if (w <= 0 || h <= 0 || w.toLong() * h > 16_000_000) return null
        val argb = IntArray(w * h)
        bmp.getPixels(argb, 0, w, 0, 0, w, h)
        val rgba = IntArray(w * h * 4)
        for (i in argb.indices) {
            val p = argb[i]
            rgba[i * 4] = (p shr 16) and 255
            rgba[i * 4 + 1] = (p shr 8) and 255
            rgba[i * 4 + 2] = p and 255
            rgba[i * 4 + 3] = (p ushr 24) and 255
        }
        return DecodedImage(w, h, rgba)
    }

    /** A picture's bytes as a bitmap, no side over [maxSide] (decoded at a power-of-two fraction first). */
    fun bitmap(bytes: ByteArray, maxSide: Int = 4000): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (e: Exception) {
        null
    }

    /** The decoder a Label LIVE import uses for pictures that are not PNG (and the app's own for the rest). */
    val importDecoder: (IntArray) -> DecodedImage? = { ints -> bitmap(ByteArray(ints.size) { ints[it].toByte() })?.let(::decoded) }

    /** The original, small, as the PNG data URL a layout keeps (null when it would be over 64 KB). */
    fun sourceURL(bmp: Bitmap): String? {
        var image = bmp
        for (side in listOf(400, 280, 200)) {
            if (maxOf(bmp.width, bmp.height) > side) {
                val k = side.toDouble() / maxOf(bmp.width, bmp.height)
                image = Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true)
            }
            val out = ByteArrayOutputStream()
            if (!image.compress(Bitmap.CompressFormat.PNG, 100, out)) return null
            val text = "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            if (text.length <= 64 * 1024) return text
        }
        return null
    }

    /** The picture inside a `data:image/...;base64,` URL (the pure PNG reader first, then the system's). */
    fun decodeSource(url: String): DecodedImage? {
        PNG.decodeDataURL(url)?.let { return it }
        val comma = url.indexOf(',')
        if (comma < 0 || !url.startsWith("data:")) return null
        val bytes = try { Base64.decode(url.substring(comma + 1), Base64.DEFAULT) } catch (e: IllegalArgumentException) { return null }
        return bitmap(bytes)?.let(::decoded)
    }

    /** The bitmap of a picture at a size in dots. */
    fun bitmap(img: DecodedImage, width: Int, height: Int, dither: Dither, threshold: Double, brightness: Double = 0.0): String =
        LabelBitmap.fromRaster(img.rgba, img.width, img.height, width, height, dither, threshold, brightness)

    /** A field's picture made again from its kept original at its own size (after the dither or threshold changed). */
    fun redone(f: LabelLayoutField, dither: Dither, threshold: Double): LabelLayoutField? {
        val src = f.source ?: return null
        val img = decodeSource(src) ?: return null
        val w = f.width ?: return null
        val h = f.height ?: return null
        return f.copy(bitmap = bitmap(img, w, h, dither, threshold), dither = dither.raw, threshold = threshold)
    }
}

/**
 * Add a picture to the tag (or give a picture field a new one): choose a photo or a file, see it as the printer will print it,
 * pick the dithering and the threshold, and its width on the tag.
 */
@Composable
fun LabelPictureSheet(
    labelWidthDots: Int,
    dpi: Int?,
    onCancel: () -> Unit,
    /** bitmap, width, height, dither, threshold, source */
    onDone: (bitmap: String, width: Int, height: Int, dither: String, threshold: Double, source: String?) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var original by remember { mutableStateOf<Bitmap?>(null) }
    var image by remember { mutableStateOf<DecodedImage?>(null) }
    var widthDots by remember { mutableStateOf(120) }
    var dither by remember { mutableStateOf(Dither.atkinson) }
    var threshold by remember { mutableStateOf(0.5) }
    var brightness by remember { mutableStateOf(0.0) }
    var problem by remember { mutableStateOf<String?>(null) }

    fun load(uri: Uri?) {
        if (uri == null) return
        scope.launch {
            val bmp = withContext(Dispatchers.Default) { NewOrderPhotoCodec.decode(context, uri, 1200) }
            val d = bmp?.let { withContext(Dispatchers.Default) { LabelPicture.decoded(it) } }
            if (bmp == null || d == null) { problem = "That picture could not be read."; return@launch }
            problem = null
            original = bmp
            image = d
            widthDots = maxOf(8, minOf(labelWidthDots / 3, 160))
        }
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { load(it) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { load(it) }

    val height = image?.let { maxOf(1, Math.round(widthDots.toDouble() * it.height / maxOf(1, it.width)).toInt()) } ?: 1
    val bitmap = remember(image, widthDots, height, dither, threshold, brightness) {
        val img = image
        if (img == null || widthDots <= 0 || widthDots.toLong() * height > 2_000_000) null else LabelPicture.bitmap(img, widthDots, height, dither, threshold, brightness)
    }

    FullScreenSheet(
        title = "Picture", onCancel = onCancel, confirmText = "Add", confirmEnabled = image != null && bitmap != null,
        onConfirm = {
            val b = bitmap ?: return@FullScreenSheet
            val o = original ?: return@FullScreenSheet
            onDone(b, widthDots, height, dither.raw, threshold, LabelPicture.sourceURL(o))
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            SettingsSection("Picture") {
                LabelTapRow("Choose a photo", { photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, icon = Symbols.PhotoLibrary)
                LabelTapRow("Choose a file", { files.launch(arrayOf("image/*")) }, icon = Symbols.FolderOpen)
                problem?.let { SmallPrint(it, Tone.problem, Modifier.padding(16.dp)) }
            }
            if (image != null) {
                SettingsSection("As it prints") {
                    val dots = bitmap?.let { LabelBitmapImage.make(it, widthDots, height) }
                    if (dots != null) {
                        Image(
                            dots, "The picture as dots",
                            Modifier.fillMaxWidth().padding(12.dp).heightIn(max = 220.dp).clip(Radius.chipShape).background(Color.White)
                                .semantics { contentDescription = "The picture as dots" },
                            contentScale = ContentScale.Fit, filterQuality = FilterQuality.None,
                        )
                    }
                }
                SettingsSection("Dots") {
                    LabelSegments(listOf("threshold" to "Threshold", "atkinson" to "Atkinson", "floyd" to "Floyd"), dither.raw, { v -> dither = Dither.entries.first { it.raw == v } })
                    LabelSliderRow("Threshold ${Math.round(threshold * 100)}%", threshold, 0.05..0.95, { threshold = it })
                    LabelSliderRow("Brightness", brightness, -0.5..0.5, { brightness = it })
                    LabelNumberRow("Width", widthDots, { widthDots = it }, unit = "dots · ${LabelUnits.mmText(widthDots.toDouble(), dpi)} mm", range = 8..maxOf(8, labelWidthDots * 2))
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text("Height  $height dots · ${LabelUnits.mmText(height.toDouble(), dpi)} mm", style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
    }
}
