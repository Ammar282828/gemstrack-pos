package erp.app.screens.marketing

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import erp.app.data.ErpApi
import erp.app.nav.LocalNavigator
import erp.app.nav.NavMap
import erp.app.nav.NavPlace
import erp.app.nav.ScreenRoute
import erp.app.ui.AppClock
import erp.app.ui.SkeletonLoading
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.ERPDate
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// What the Marketing screens share: the places they link to, who may see which, and the few small views (a chip, a
// link row) that look the same on Posts, Ads and Website (MarketingKit.swift).

object MarketingKit {
    const val postsWeb = "/posts?web=1"
    const val piecesPath = "/marketing/pieces"
    const val piecePrefix = "/marketing/piece"
    const val websitePath = "/marketing/website"

    /** `.alphanumerics`: everything but ASCII letters and digits is escaped (the id is a path: "Rings/DSC0912.webp"). */
    fun escape(text: String): String {
        val out = StringBuilder()
        for (b in text.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            if ((c in 'a'.code..'z'.code) || (c in 'A'.code..'Z'.code) || (c in '0'.code..'9'.code)) out.append(c.toChar())
            else out.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
        }
        return out.toString()
    }

    /** One website piece's own screen. The id travels fully escaped in the query, which `pieceId` reads back. */
    fun piecePath(id: String): String = "$piecePrefix?id=${escape(id)}"

    fun pieceId(path: String): String? = query("id", path)

    /** A query value of an ERP path ("/ads/new?piece=Rings%2FDSC0912.webp" → "Rings/DSC0912.webp"), null when empty (AdsQuery). */
    fun query(name: String, path: String): String? {
        val noHash = path.substringBefore('#')
        if (!noHash.contains('?')) return null
        val pair = noHash.substringAfter('?').split('&').firstOrNull { it.substringBefore('=') == name } ?: return null
        val v = ScreenRoute.percentDecode(pair.substringAfter('=', ""))
        return v.ifEmpty { null }
    }

    /**
     * Whether this person's map has the place, as a row, a tab or a page. The map (nav-<house>.json) is already cut to
     * the house's flags (Post a piece, Investments, Edit a piece, the studio…), and `visible` to the person's role, so
     * a place that is not theirs is simply not there.
     */
    fun has(href: String, role: String, map: NavMap = NavMap.current): Boolean {
        for (e in map.visible(role).entries) {
            if (e.href == href) return true
            if ((e.tabs ?: emptyList()).any { it.href == href }) return true
            if ((e.pages ?: emptyList()).any { it.href == href }) return true
        }
        return false
    }

    /** An entry's tabs for this person, in the ERP's order ("website" → Add photos, Edit a piece…). */
    fun tabs(entryId: String, role: String, map: NavMap = NavMap.current): List<NavPlace> =
        map.visible(role).entries.firstOrNull { it.id == entryId }?.tabs ?: emptyList()
}

/** Times and ages in the shop's own words (Karachi, am/pm in lower case). */
object MarketingTime {
    private fun format(pattern: String): DateTimeFormatter = DateTimeFormatter.ofPattern(pattern, Locale.UK).withZone(ERPDate.karachi)
    private val clockFormat = format("h:mm a")
    private val weekdayFormat = format("EEEE")

    /** "4:05 pm". */
    fun clock(iso: String?, now: Instant? = null): String {
        val d = ERPDate.parse(iso) ?: return ""
        return clockFormat.format(d).replace(Regex("(?i)\\s*([ap])\\.?m\\.?$")) { " ${it.groupValues[1].lowercase()}m" }
    }

    fun weekday(iso: String?): String {
        val d = ERPDate.parse(iso) ?: return ""
        return weekdayFormat.format(d)
    }

    fun isToday(iso: String?, now: Instant = AppClock.now()): Boolean {
        val d = ERPDate.parse(iso) ?: return false
        return ERPDate.karachiDay(d) == ERPDate.karachiDay(now)
    }

    /** Whole days since, as the hub counts them (src/app/posts/page.tsx daysAgo). */
    fun daysAgo(iso: String?, now: Instant = AppClock.now()): Int? {
        val d = ERPDate.parse(iso) ?: return null
        return floor((now.epochSecond - d.epochSecond) / 86_400.0).toInt()
    }

    /** "posted today", "posted 3 days ago" (piece-card.tsx agoLabel). */
    fun postedAgo(iso: String?, now: Instant = AppClock.now()): String? {
        val days = daysAgo(iso, now) ?: return null
        if (days <= 0) return "posted today"
        if (days == 1) return "posted yesterday"
        return "posted $days days ago"
    }
}

/** A photograph's bytes as the phone has them (WebsitePhoto's reading side): what they are, a JPEG copy, a small copy. */
object MarketingPhotos {
    class Kind(val ext: String, val mime: String)

    /** What the bytes are, from their first few (a photo from Photos carries no file name). */
    fun kind(data: ByteArray): Kind? {
        if (data.size < 12) return null
        fun b(i: Int) = data[i].toInt() and 0xFF
        if (b(0) == 0xFF && b(1) == 0xD8 && b(2) == 0xFF) return Kind("jpg", "image/jpeg")
        if (b(0) == 0x89 && b(1) == 0x50 && b(2) == 0x4E && b(3) == 0x47) return Kind("png", "image/png")
        fun text(from: Int, to: Int) = String(data, from, to - from, Charsets.ISO_8859_1)
        if (text(0, 4) == "RIFF" && text(8, 12) == "WEBP") return Kind("webp", "image/webp")
        if (text(4, 8) == "ftyp" && text(8, 12) in listOf("heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif")) return Kind("heic", "image/heic")
        return null
    }

    /** The bitmap at a fraction that fits [maxPixel] on its long side, turned upright by its EXIF. Null if unreadable. */
    fun decode(data: ByteArray, maxPixel: Int): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        val side = max(bounds.outWidth, bounds.outHeight)
        if (side <= 0) null
        else {
            var sample = 1
            while (side / (sample * 2) >= maxPixel) sample *= 2
            val raw = BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
            if (raw == null) null
            else {
                val turn = try {
                    when (android.media.ExifInterface(ByteArrayInputStream(data)).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) {
                        android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                        android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                        android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                        else -> 0f
                    }
                } catch (e: Exception) { 0f }
                if (turn == 0f) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(turn) }, true)
            }
        }
    } catch (e: Exception) {
        null
    }

    /** The bitmap as a JPEG no longer than [longest] on its long side (`WebsitePhoto.jpeg`). */
    fun jpeg(image: Bitmap, longest: Int = 4032, quality: Int = 90): ByteArray? {
        val side = max(image.width, image.height)
        if (side <= 0) return null
        val scale = minOf(1f, longest.toFloat() / side)
        val sized = if (scale < 1f) Bitmap.createScaledBitmap(image, (image.width * scale).roundToInt(), (image.height * scale).roundToInt(), true) else image
        return ByteArrayOutputStream().use { out ->
            sized.compress(Bitmap.CompressFormat.JPEG, quality, out)
            out.toByteArray()
        }
    }

    /** A JPEG of any photo the phone can read (HEIC included), for the routes that read only JPEG and PNG (the AI). */
    fun jpegCopy(data: ByteArray, longest: Int = 3000): ByteArray? = decode(data, longest)?.let { jpeg(it, longest, 92) }
}

/** A filter chip: the chosen one is the house's filled capsule, the others quiet (the kit's `FilterChip`). */
@Composable
fun MarketingChip(title: String, selected: Boolean, onClick: () -> Unit, count: Int? = null) {
    erp.app.ui.FilterChip(title = title, chosen = selected, onClick = onClick, count = count)
}

/** A row that opens an ERP page (or another native screen) in the app. */
@Composable
fun MarketingLink(title: String, symbol: ImageVector, path: String, subtitle: String? = null) {
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(path) }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(symbol, contentDescription = null, Modifier.size(24.dp), tint = ErpColors.accent)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}

/** A line while something is being read. */
@Composable
fun MarketingReading(text: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        SkeletonLoading(compact = true, label = text)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Server images use the same authenticated, house-bound transport as the rest of the app: an ERP path is read with the
 * sign-in, an https address loads as it is.
 */
@Composable
fun MarketingPhoto(path: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Fit) {
    if (path.startsWith("https://")) {
        SubcomposeAsyncImage(
            model = path, contentDescription = null, modifier = modifier, contentScale = contentScale,
            loading = { SkeletonLoading(compact = true) },
            error = { PhotoProblem("The picture could not be read.") },
        )
        return
    }
    val state by produceState<PhotoState>(PhotoState.Loading, path) {
        value = try {
            if (!path.startsWith("/api/")) throw ErpApi.Failure(0, "The picture has no usable address.")
            val data = ErpApi.shared.bytes(path)
            val made = withContext(Dispatchers.Default) { MarketingPhotos.decode(data, 1200) }
            if (made == null) PhotoState.Failed("The picture could not be read.") else PhotoState.Ready(made.asImageBitmap())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            PhotoState.Failed(e.message ?: "The picture could not be read.")
        }
    }
    when (val s = state) {
        PhotoState.Loading -> SkeletonLoading(modifier, compact = true)
        is PhotoState.Failed -> PhotoProblem(s.words)
        is PhotoState.Ready -> Image(s.bitmap, contentDescription = null, modifier = modifier, contentScale = contentScale)
    }
}

private sealed interface PhotoState {
    data object Loading : PhotoState
    class Failed(val words: String) : PhotoState
    class Ready(val bitmap: ImageBitmap) : PhotoState
}

@Composable
private fun PhotoProblem(words: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.BrokenImage, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(words, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Full Meta/AI feedback stays readable without raw JSON: each key a heading, nested objects and lists folded (MarketingDetails). */
@Composable
fun MarketingDetails(fields: Map<String, MarketingValue>, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (key in fields.keys.sorted()) DetailItem(key, fields.getValue(key))
    }
}

private fun detailTitle(key: String): String = key.replace('_', ' ').split(' ').joinToString(" ") { w -> w.lowercase().replaceFirstChar { it.uppercase() } }

@Composable
private fun DetailItem(key: String, value: MarketingValue) {
    val title = detailTitle(key)
    when (val j = value.json) {
        is kotlinx.serialization.json.JsonNull -> Unit
        is kotlinx.serialization.json.JsonObject -> MarketingDisclosure(title) { MarketingDetails(value.obj) }
        is kotlinx.serialization.json.JsonArray -> MarketingDisclosure(title) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { value.array.forEachIndexed { i, v -> DetailItem("${i + 1}", v) } }
        }
        else -> Column(Modifier.padding(vertical = 3.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            androidx.compose.foundation.text.selection.SelectionContainer {
                Text((j as? kotlinx.serialization.json.JsonPrimitive)?.content ?: j.toString(), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** A row that unfolds its content under it (a `DisclosureGroup`). */
@Composable
fun MarketingDisclosure(title: String, initiallyOpen: Boolean = false, content: @Composable () -> Unit) {
    var open by androidx.compose.runtime.saveable.rememberSaveable(title, initiallyOpen) { androidx.compose.runtime.mutableStateOf(initiallyOpen) }
    Column {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = if (open) "Fold" else "Unfold", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) Column(Modifier.padding(start = 12.dp, end = 16.dp, bottom = 12.dp)) { content() }
    }
}
