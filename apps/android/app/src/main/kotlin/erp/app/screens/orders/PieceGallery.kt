package erp.app.screens.orders

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.animation.core.animate
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import erp.app.ui.SkeletonAsyncImage
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.device.shareBytes
import erp.app.screens.stock.StockImageDecoder
import erp.app.ui.IconButton
import erp.app.ui.Radius
import erp.app.ui.icons.Symbols
import erp.app.ui.rememberErpMotion
import erp.app.ui.theme.TabularDigits
import erp.core.logic.PhotoSource
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

// A piece's reference pictures (2026-10-30, owner: "more than one picture reference in orders ... I should be able to open the
// reference images"): thumbnails wherever a piece shows them, and a full-screen viewer behind a tap: swipe between the piece's
// pictures, pinch or double-tap to zoom, Share (which also saves), swipe down to close. The web has the same in
// components/order/photo-lightbox.tsx; where the pictures live is lib/order-photos.ts. (PieceGallery.swift.)

/** Reads a picture wherever it is kept, once: its document is fetched the first time and held for the session. */
object PieceGalleryStore {
    private val documents = java.util.concurrent.ConcurrentHashMap<String, String>()

    /**
     * The picture's address (a data address or a URL), or null when it has none or cannot be read (the shop floor's accounts read no
     * Firestore of their own; they are handed the pictures inline).
     */
    suspend fun uri(source: PhotoSource): String? {
        source.uri?.takeIf { it.isNotEmpty() }?.let { return it }
        val id = source.storedId?.takeIf { it.isNotEmpty() } ?: return null
        documents[id]?.let { return it }
        if (House.isDemo) return null
        val db = Businesses.firestore ?: return null
        val uri = try {
            db.collection("order_photos").document(id).get().await().data?.get("dataUri") as? String
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        if (uri.isNullOrEmpty()) return null
        documents[id] = uri
        return uri
    }

    /** The picture's bytes for sharing: new ones as they are, a data address decoded; null for a web address. */
    suspend fun bytes(source: PhotoSource): ByteArray? = source.data ?: uri(source)?.let { StockImageDecoder.bytes(it) }

    /** The picture itself, no larger than [maxPixel] on its long side (decoded sampled), off the main thread. Null for a web address or one that cannot be read. */
    suspend fun bitmap(source: PhotoSource, maxPixel: Int): Bitmap? {
        val data = source.data
        if (data != null) return withContext(Dispatchers.Default) { sampled(data, maxPixel) }
        val text = uri(source) ?: return null
        return withContext(Dispatchers.Default) { StockImageDecoder.bitmap(text, maxPixel) }
    }

    private fun sampled(data: ByteArray, maxPixel: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        var sample = 1
        val longSide = maxOf(bounds.outWidth, bounds.outHeight)
        while (longSide / (sample * 2) >= maxPixel) sample *= 2
        return BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}

/** One picture wherever it is kept: a web address is loaded, anything else decoded here. [onFailed] hears of one that cannot be read. */
@Composable
internal fun PhotoImage(
    source: PhotoSource,
    maxPixel: Int,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    description: String? = null,
    onFailed: () -> Unit = {},
) {
    val web = source.uri?.startsWith("http") == true
    if (web) {
        SkeletonAsyncImage(model = source.uri, contentDescription = description, modifier = modifier, contentScale = contentScale)
        return
    }
    val bitmap by produceState<ImageBitmap?>(null, source.id, source.data?.size) {
        value = PieceGalleryStore.bitmap(source, maxPixel)?.asImageBitmap()
        if (value == null) onFailed()
    }
    bitmap?.let { Image(it, description, modifier, contentScale = contentScale) }
}

// MARK: Thumbnails

/** A small square of one picture; blank until it is read. */
@Composable
fun PhotoThumb(source: PhotoSource, modifier: Modifier = Modifier, size: Dp = 64.dp, more: Int = 0) {
    Box(modifier.size(size).clip(Radius.thumbShape).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
        PhotoImage(source, maxPixel = (size.value * 3).toInt(), modifier = Modifier.fillMaxSize())
        if (more > 0) {
            Text(
                "+$more",
                Modifier.align(Alignment.BottomEnd).padding(4.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 6.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = TabularDigits), color = Color.White,
            )
        }
    }
}

/**
 * A piece's pictures as thumbnails; a tap opens the viewer on that one. [all] lays out every picture in a row (the bench's card, the
 * karigar's page); otherwise the first leads with a "+n" for the rest (an order's piece row).
 */
@Composable
fun PieceGalleryRow(sources: List<PhotoSource>, modifier: Modifier = Modifier, title: String = "", size: Dp = 64.dp, all: Boolean = false) {
    if (sources.isEmpty()) return
    var openAt by remember { mutableStateOf<Int?>(null) }
    if (all && sources.size > 1) {
        Row(modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            sources.forEachIndexed { i, s ->
                PhotoThumb(
                    s, Modifier.clickable(onClickLabel = "Open full screen") { openAt = i }.semantics { contentDescription = "Reference photo ${i + 1} of ${sources.size}" },
                    size,
                )
            }
        }
    } else {
        PhotoThumb(
            sources[0],
            modifier.clickable(onClickLabel = "Open full screen") { openAt = 0 }
                .semantics { contentDescription = if (sources.size > 1) "Reference photos, ${sources.size}" else "Reference photo" },
            size, more = sources.size - 1,
        )
    }
    openAt?.let { PhotoViewer(sources, title, it) { openAt = null } }
}

// MARK: The viewer

/** The pictures full screen on black: swipe between them, pinch or double-tap to zoom, Share or save, swipe down (or Back) to close. */
@Composable
fun PhotoViewer(photos: List<PhotoSource>, title: String, index: Int, onClose: () -> Unit) {
    if (photos.isEmpty()) return
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        PhotoViewerContent(photos, title, index, onClose)
    }
}

/** The viewer's page itself (a window of its own in [PhotoViewer]; drawn in place by the screenshot test). */
@Composable
internal fun PhotoViewerContent(photos: List<PhotoSource>, title: String, index: Int, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pager = rememberPagerState(initialPage = index.coerceIn(0, photos.size - 1)) { photos.size }
    var zoomed by remember { mutableStateOf(false) }
    val label = title.ifEmpty { "Reference photo" }
    run {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, key = { photos[it].id }) { page ->
                ZoomPage(photos[page], label, active = pager.currentPage == page, onZoomed = { zoomed = it }, onClose = onClose)
            }
            val bar = IconButtonDefaults.iconButtonColors(contentColor = Color.White)
            Row(Modifier.align(Alignment.TopCenter).safeDrawingPadding().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClose, colors = bar) { Icon(Symbols.Close, "Close") }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    if (photos.size > 1) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton({ scope.launch { pager.animateScrollToPage(pager.currentPage - 1) } }, enabled = pager.currentPage > 0, colors = bar) { Icon(Symbols.KeyboardArrowLeft, "Previous photo") }
                            Text(
                                "${pager.currentPage + 1} of ${photos.size}",
                                style = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = TabularDigits), color = Color.White,
                            )
                            IconButton({ scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } }, enabled = pager.currentPage < photos.size - 1, colors = bar) { Icon(Symbols.KeyboardArrowRight, "Next photo") }
                        }
                    }
                }
                // A web address cannot be handed over as bytes here; the rest can, and sharing is how a picture is saved.
                if (photos[pager.currentPage].uri?.startsWith("http") != true) {
                    IconButton(
                        {
                            val source = photos[pager.currentPage]
                            scope.launch { PieceGalleryStore.bytes(source)?.let { shareBytes(context, it, "$label.jpg", "image/jpeg", label) } }
                        },
                        colors = bar,
                    ) { Icon(Symbols.Share, "Share or save") }
                }
            }
        }
    }
}

/** One picture, zoomable: pinch, double-tap, drag when zoomed; at rest a sideways drag turns the page (the pager's) and a drag down closes. */
@Composable
private fun ZoomPage(source: PhotoSource, label: String, active: Boolean, onZoomed: (Boolean) -> Unit, onClose: () -> Unit) {
    val motion = rememberErpMotion()
    val scope = rememberCoroutineScope()
    val slop = LocalViewConfiguration.current.touchSlop
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var failed by remember { mutableStateOf(false) }
    // A page that is turned away from starts over, and the pager is free again.
    LaunchedEffect(active) { if (!active) { scale = 1f; offset = Offset.Zero } }
    LaunchedEffect(scale > 1.01f, active) { if (active) onZoomed(scale > 1.01f) }
    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = {
                    scope.launch {
                        val from = scale
                        val to = if (from > 1.01f) 1f else 2.5f
                        val off0 = offset
                        // Zooming out carries the pan back to the middle as the scale falls.
                        animate(from, to, animationSpec = motion.spatial()) { v, _ ->
                            scale = v
                            if (to == 1f) offset = off0 * ((v - 1f).coerceAtLeast(0f) / (from - 1f))
                        }
                        if (to == 1f) offset = Offset.Zero
                    }
                })
            }
            .pointerInput(Unit) {
                val closeAt = 110.dp.toPx()
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var dragged = Offset.Zero
                    var closing = false
                    do {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.count { it.pressed }
                        val zoom = event.calculateZoom()
                        val pan = event.calculatePan()
                        if (pressed >= 2 || scale > 1.01f) {
                            val next = (scale * zoom).coerceIn(1f, 6f)
                            val room = Offset(size.width * (next - 1f) / 2f, size.height * (next - 1f) / 2f)
                            offset = if (next > 1f) Offset((offset.x + pan.x).coerceIn(-room.x, room.x), (offset.y + pan.y).coerceIn(-room.y, room.y)) else Offset.Zero
                            scale = next
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        } else if (pressed == 1) {
                            dragged += pan
                            if (closing || (dragged.y > slop && abs(dragged.y) > abs(dragged.x))) {
                                closing = true
                                offset = Offset(0f, dragged.y.coerceAtLeast(0f))
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            }
                        }
                    } while (event.changes.any { it.pressed })
                    if (closing) {
                        if (offset.y > closeAt) onClose()
                        else {
                            val from = offset.y
                            scope.launch { animate(from, 0f, animationSpec = motion.spatial()) { v, _ -> offset = Offset(0f, v) } }
                        }
                    } else if (scale <= 1.01f) {
                        scale = 1f
                        offset = Offset.Zero
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        if (failed) {
            Text("This photo could not be loaded.", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.7f))
        } else {
            PhotoImage(
                source, maxPixel = 2400, contentScale = ContentScale.Fit, description = label, onFailed = { failed = true },
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y },
            )
        }
    }
}
