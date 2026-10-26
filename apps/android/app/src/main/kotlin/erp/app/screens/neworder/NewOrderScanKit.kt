package erp.app.screens.neworder

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.device.DocumentScanner
import erp.app.device.Foreground
import erp.app.ui.MinTouchTarget
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.core.entry.PaperNameGuess
import erp.core.entry.PaperRankedName
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// What Read a slip (New order) and Read a written bill (New sale) share: the paper coming in (the document scanner,
// or Photos for one that arrived on WhatsApp), the photos kept on screen beside what was read off them (a figure read
// off handwriting is worth checking against the handwriting), and a name offered, never decided. (NewOrderScanKit.swift.)

// MARK: A photo of the paper

/**
 * One photo of the paper: the JPEG the ERP's reader is sent (no side over 2200 px, as the scanner's pages), the same
 * made small enough to keep on an order as its reference picture (NewOrderPhotoCodec), and the picture shown.
 */
class PaperPhoto(val jpeg: ByteArray, val small: ByteArray, val image: ImageBitmap) {
    val id: UUID = UUID.randomUUID()

    /** What the reader is sent: `{ data, mimeType }`, base64 JPEG, as the browser sends it. */
    val payload: Map<String, Any?> get() = mapOf("data" to Base64.encodeToString(jpeg, Base64.NO_WRAP), "mimeType" to "image/jpeg")

    companion object {
        /** A page or photo made ready, off the main thread; null when it cannot be read. */
        suspend fun make(picture: Bitmap): PaperPhoto? = withContext(Dispatchers.Default) {
            val fitted = NewOrderPhotoCodec.fitted(picture, 2200)
            val jpeg = ByteArrayOutputStream().use { out ->
                fitted.compress(Bitmap.CompressFormat.JPEG, 82, out)
                out.toByteArray()
            }
            val small = NewOrderPhotoCodec.jpeg(fitted) ?: return@withContext null
            PaperPhoto(jpeg, small, fitted.asImageBitmap())
        }

        /** A page from the scanner, already squared up and sized: sent as it is. */
        suspend fun make(page: ByteArray): PaperPhoto? = withContext(Dispatchers.Default) {
            val image = BitmapFactory.decodeByteArray(page, 0, page.size) ?: return@withContext null
            val small = NewOrderPhotoCodec.jpeg(image) ?: return@withContext null
            PaperPhoto(page, small, image.asImageBitmap())
        }
    }
}

/**
 * The two ways paper comes in: scanned (the scanner squares the page and evens the light; the camera where a phone
 * has no scanner), or chosen from Photos. [room] is how many more photos may be added.
 */
@Composable
internal fun PaperPicker(
    room: Int,
    onAdd: (List<PaperPhoto>) -> Unit,
    onProblem: (String) -> Unit,
    modifier: Modifier = Modifier,
    scanTitle: String = "Scan",
    disabled: Boolean = false,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(false) }

    fun tooMany(count: Int) {
        if (count > room && room > 0) {
            onProblem("Only the first ${if (room == 1) "one was" else "$room were"} added: ${if (room == 1) "one photo" else "$room photos"} at most.")
        }
    }

    fun takeBitmaps(images: List<Bitmap>) {
        loading = true
        scope.launch {
            val out = ArrayList<PaperPhoto>()
            for (image in images.take(maxOf(0, room))) PaperPhoto.make(image)?.let { out.add(it) }
            loading = false
            tooMany(images.size)
            if (out.isNotEmpty()) onAdd(out)
        }
    }

    fun load(uris: List<android.net.Uri>) {
        loading = true
        scope.launch {
            val images = withContext(Dispatchers.Default) { uris.mapNotNull { NewOrderPhotoCodec.decode(context, it) } }
            if (images.size < uris.size) onProblem("Couldn't read ${if (uris.size - images.size == 1) "one of those photos" else "some of those photos"}. Try another.")
            if (images.isEmpty()) loading = false else takeBitmaps(images)
        }
    }

    val single = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) load(listOf(uri)) }
    // A multiple pick needs room for at least two; one place left uses the single picker.
    val many = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, minOf(room, 20)))) { uris -> if (uris.isNotEmpty()) load(uris) }
    val camera = rememberCameraCapture(onProblem = onProblem) { image -> if (image != null) takeBitmaps(listOf(image)) }

    fun scan() {
        val activity = Foreground.activity
        if (activity != null && DocumentScanner.isSupported(activity)) {
            scope.launch {
                try {
                    val pages = DocumentScanner.scan(activity)
                    loading = true
                    val out = ArrayList<PaperPhoto>()
                    for (page in pages.take(maxOf(0, room))) PaperPhoto.make(page.jpeg)?.let { out.add(it) }
                    loading = false
                    tooMany(pages.size)
                    if (out.isNotEmpty()) onAdd(out)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: DocumentScanner.Failure) {
                    if (e.code != "cancelled") onProblem(e.message)
                } catch (e: Exception) {
                    onProblem(e.message ?: "The scanner couldn't open.")
                }
            }
        } else if (hasCamera(context)) {
            camera()
        } else {
            onProblem("This phone has no camera to scan with. Choose the photo from Photos.")
        }
    }

    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val off = disabled || loading || room <= 0
        OutlinedButton(onClick = ::scan, enabled = !off, modifier = Modifier.heightIn(min = MinTouchTarget)) {
            Icon(Icons.Filled.DocumentScanner, null, Modifier.size(18.dp))
            Text(scanTitle, Modifier.padding(start = 6.dp))
        }
        OutlinedButton(
            onClick = {
                if (room <= 1) single.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                else many.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            enabled = !off,
            modifier = Modifier.heightIn(min = MinTouchTarget),
        ) {
            Icon(Icons.Filled.PhotoLibrary, null, Modifier.size(18.dp))
            Text("From Photos", Modifier.padding(start = 6.dp))
        }
        if (loading) SkeletonLoading(compact = true)
    }
}

/** The photos, large enough to check a figure against, numbered when there are several. Tap one to see it whole. */
@Composable
internal fun PaperPhotoStrip(
    photos: List<PaperPhoto>,
    /** Null while reading: the set being read is not changed under it. */
    remove: ((UUID) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    var shown by remember { mutableStateOf<PaperPhoto?>(null) }
    Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        photos.forEachIndexed { i, p ->
            Box {
                Image(
                    p.image, "Photo ${i + 1} of the paper",
                    Modifier.height(260.dp).clip(Radius.tileShape).clickable(role = Role.Button) { shown = p },
                    contentScale = ContentScale.FillHeight,
                )
                if (photos.size > 1) {
                    Text(
                        "${i + 1}",
                        Modifier.padding(6.dp).clip(Radius.chipShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                if (remove != null) {
                    RoundIconButton(Icons.Filled.Close, "Remove photo ${i + 1}", { remove(p.id) }, Modifier.align(Alignment.TopEnd))
                }
            }
        }
    }
    shown?.let { p ->
        FullScreenPage(title = "The paper", onBack = { shown = null }, actions = { TextButton(onClick = { shown = null }) { Text("Done") } }) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Image(p.image, "The paper, whole", Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth)
            }
        }
    }
}

// MARK: A name off the paper

/**
 * A name read off the paper, offered rather than decided (order-scanner.tsx `NamePick`): a clear winner shown as
 * matched, and still changeable; anything short of that a list to choose from; nobody close, said so.
 */
@Composable
internal fun PaperNamePick(
    label: String,
    guess: PaperNameGuess,
    /** What to do when nobody in the book sounds like it. */
    nobody: String,
    onPick: (PaperRankedName?) -> Unit,
) {
    val pinned = guess.pinned
    FormCard(
        title = label,
        footer = when {
            pinned != null -> "Read as “${guess.heard}”: matched in the book."
            guess.candidates.isNotEmpty() -> "Read as “${guess.heard}”. Which one?"
            else -> "Read as “${guess.heard}”."
        },
    ) {
        if (pinned != null) {
            Row(Modifier.fillMaxWidth().formRow(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
                Text(pinned.name, Modifier.weight(1f))
                TextButton(onClick = { onPick(null) }) { Text("Not them") }
            }
        } else if (guess.candidates.isNotEmpty()) {
            guess.candidates.forEach { c ->
                Row(
                    Modifier.fillMaxWidth().formRow().clickable(role = Role.Button) { onPick(c) },
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Icons.Filled.Person, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(c.name, Modifier.weight(1f))
                }
            }
        } else {
            NoteRow(nobody)
        }
    }
}

// MARK: Asking the reader

object PaperReader {
    /**
     * The ERP's reader, as the signed-in owner: the same route the browser's scanner calls. It waits out the AI's rate
     * limit before answering, so it is given five minutes rather than one.
     */
    suspend fun ask(path: String, body: Map<String, Any?>): String = ErpApi.shared.data(path, "POST", body, timeoutMs = 300_000)

    /** What went wrong, in words: the ERP's own when it said something ("Not available on this account."). */
    fun words(error: Throwable): String = (error as? ErpApi.Failure)?.message ?: (error.message ?: error.toString())
}
