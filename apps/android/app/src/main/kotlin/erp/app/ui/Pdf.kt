package erp.app.ui

import erp.app.ui.icons.Symbols
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import erp.app.device.shareFile
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.math.roundToInt

/**
 * A PDF the ERP draws on its server with the browser's own builder (the invoice Print saves, the workshop slip),
 * shown here and handed to the share sheet: Print, Save to Files, WhatsApp. The file is kept only while the screen
 * is open, in the app's cache, under the name the browser saves it by.
 *
 * - [load] fetches the bytes as the signed-in person (`ErpApi`, with a long timeout: a slip of many pieces
 *   takes a second or two). A throw is shown as "Couldn't draw the PDF" with Try again.
 * - [fileName]: "Invoice - Test Buyer.pdf", "OrderSlip-ORD-000123.pdf": what Print, Files and WhatsApp call it.
 * - [onShare]: gets the kept file; by default it goes to the system share sheet as [fileName] (device/ShareFiles.kt).
 * - [showBar]: false where the shell already draws the title and the back arrow (then Share is up to it too:
 *   use [PdfPages] with the file it was handed).
 *
 * Pinch or double-tap to zoom; the pages go one under the other.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfDocumentScreen(
    title: String,
    fileName: String,
    load: suspend () -> ByteArray,
    onShare: ((File) -> Unit)? = null,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    showBar: Boolean = true,
) {
    val context = LocalContext.current
    var attempt by remember { mutableIntStateOf(0) }
    var shown by remember { mutableStateOf<PdfSource?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(attempt) {
        if (shown != null) return@LaunchedEffect
        failed = null
        try {
            val bytes = load()
            val source = withContext(Dispatchers.IO) {
                val file = keep(context.cacheDir, bytes, fileName)
                try {
                    PdfSource(file)
                } catch (e: Exception) {
                    file.parentFile?.deleteRecursively()
                    throw IllegalStateException("The ERP's answer was not a PDF.")
                }
            }
            shown = source
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = e.message ?: e.toString()
        }
    }
    // The customer's bill is not left on the phone once its screen is gone.
    DisposableEffect(Unit) { onDispose { shown?.close(deleteFile = true); shown = null } }

    Column(modifier.fillMaxSize().background(ErpColors.ground)) {
        if (showBar) {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) { Icon(Symbols.ArrowBack, contentDescription = "Back") }
                    }
                },
                actions = {
                    shown?.let { source ->
                        IconButton(onClick = { onShare?.invoke(source.file) ?: shareFile(context, source.file, "application/pdf", title, name = fileName) }) { Icon(Symbols.Share, contentDescription = "Share or print") }
                    }
                },
            )
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val source = shown
            val problem = failed
            when {
                source != null -> PdfPages(source, Modifier.fillMaxSize())
                problem != null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    NotAvailableState("Couldn't draw the PDF", why = problem, icon = Symbols.Warning)
                    Button(onClick = { failed = null; attempt++ }) { Text("Try again") }
                }
                else -> SkeletonLoading(Modifier.fillMaxSize())
            }
        }
    }
}

/** A folder of its own for each PDF, so the file keeps its exact name and two never meet. */
private fun keep(cache: File, bytes: ByteArray, name: String): File {
    val dir = File(File(cache, "erp-pdf"), UUID.randomUUID().toString()).apply { mkdirs() }
    return File(dir, safeName(name)).apply { writeBytes(bytes) }
}

/** A file's name, never a path (the ERP's names are already clean: lib/invoice-share.ts). */
internal fun safeName(name: String): String {
    var n = name.replace("/", " ").replace(":", " ").trim()
    if (n.isEmpty()) n = "Document"
    return if (n.lowercase().endsWith(".pdf")) n else "$n.pdf"
}

/**
 * A PDF opened for display. PdfRenderer is not thread-safe and holds one page at a time, so every render
 * goes through one lock; closing waits its turn.
 */
@Stable
class PdfSource internal constructor(val file: File) {
    private val descriptor: ParcelFileDescriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer: PdfRenderer = try {
        PdfRenderer(descriptor)
    } catch (e: Exception) {
        descriptor.close()
        throw e
    }
    private val lock = Mutex()
    private var closed = false

    /** Each page's size in points, for its place in the list before it is drawn. */
    val pageSizes: List<Pair<Int, Int>> = (0 until renderer.pageCount).map { i ->
        renderer.openPage(i).use { it.width to it.height }
    }

    suspend fun render(index: Int, widthPx: Int): Bitmap = lock.withLock {
        if (closed) throw CancellationException("closed")
        withContext(Dispatchers.Default) {
            renderer.openPage(index).use { page ->
                val height = (widthPx.toFloat() * page.height / page.width).roundToInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(widthPx, height, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(AndroidColor.WHITE) // the renderer leaves a page transparent
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmap
            }
        }
    }

    fun close(deleteFile: Boolean = false) {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            lock.withLock {
                closed = true
                runCatching { renderer.close() }
                runCatching { descriptor.close() }
                if (deleteFile) file.parentFile?.deleteRecursively()
            }
        }
    }
}

/** The pages of an open [PdfSource], one under the other on the ground, zoomed by pinch or double-tap. */
@Composable
fun PdfPages(source: PdfSource, modifier: Modifier = Modifier) {
    var zoom by remember { mutableFloatStateOf(1f) }
    // Pages are redrawn sharper only when the pinch lets go, not at every step of it.
    var drawnZoom by remember { mutableFloatStateOf(1f) }
    BoxWithConstraints(modifier) {
        val available = maxWidth
        val viewport = with(LocalDensity.current) { available.toPx() }
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            if (event.changes.size >= 2) {
                                val change = event.calculateZoom()
                                if (change != 1f) {
                                    zoom = (zoom * change).coerceIn(1f, 4f)
                                    event.changes.forEach { it.consume() }
                                }
                            }
                        } while (event.changes.any { it.pressed })
                        drawnZoom = zoom
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = {
                        zoom = if (zoom > 1.01f) 1f else 2f
                        drawnZoom = zoom
                    })
                }
                .horizontalScroll(rememberScrollState()),
        ) {
            LazyColumn(
                Modifier.width(available * zoom).fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                itemsIndexed(source.pageSizes) { index, size ->
                    // At most 2400 px wide: a page is a bitmap, and a zoomed invoice should not be hundreds of MB.
                    val widthPx = ((viewport - 2 * 12f) * drawnZoom).coerceIn(200f, 2400f).roundToInt()
                    val bitmap by produceState<ImageBitmap?>(null, index, widthPx) {
                        value = runCatching { source.render(index, widthPx).asImageBitmap() }.getOrNull() ?: value
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .aspectRatio(size.first.toFloat() / size.second)
                            .shadow(2.dp)
                            .background(Color.White),
                    ) {
                        bitmap?.let {
                            Image(
                                it, contentDescription = "Page ${index + 1} of ${source.pageSizes.size}",
                                Modifier.fillMaxSize(), contentScale = ContentScale.FillWidth,
                            )
                        }
                    }
                }
            }
        }
    }
}
