package erp.app.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.device.DocumentScanner
import erp.app.device.Foreground
import erp.app.ui.theme.ErpColors
import erp.core.entry.PaperNameGuess
import erp.core.entry.PaperRankedName
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// What Read a written bill shares with Read a slip (NewOrderScanKit.swift): the paper coming in (the document scanner,
// or Photos for one that arrived on WhatsApp), the photo kept on screen beside what was read off it (a figure read off
// handwriting is worth checking against the handwriting), and a name offered, never decided. In the kit because New sale,
// New order and Read a slip all read paper the same way.

/** One photo of the paper: the JPEG the ERP's reader is sent (no side over 2200 px, as the scanner's pages) and the picture shown. */
class PaperPhoto(val jpeg: ByteArray, val image: ImageBitmap) {
    val id: String = UUID.randomUUID().toString()

    companion object {
        /** A page from the scanner, already squared up and sized: sent as it is. Null when it cannot be read. */
        suspend fun ofPage(jpeg: ByteArray): PaperPhoto? = withContext(Dispatchers.Default) {
            val bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return@withContext null
            PaperPhoto(jpeg, bitmap.asImageBitmap())
        }

        /** A photo chosen from the phone, made ready off the main thread: sampled down, no side over 2200 px, JPEG at 82%. */
        suspend fun ofUri(activity: Activity, uri: Uri, longest: Int = 2200): PaperPhoto? = withContext(Dispatchers.Default) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            activity.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            val side = maxOf(bounds.outWidth, bounds.outHeight)
            if (side <= 0) return@withContext null
            var sample = 1
            while (side / (sample * 2) >= longest) sample *= 2
            val decoded = activity.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: return@withContext null
            val big = maxOf(decoded.width, decoded.height)
            val fitted = if (big > longest) {
                val k = longest.toFloat() / big
                Bitmap.createScaledBitmap(decoded, (decoded.width * k).toInt(), (decoded.height * k).toInt(), true)
            } else {
                decoded
            }
            val jpeg = ByteArrayOutputStream().use { out ->
                fitted.compress(Bitmap.CompressFormat.JPEG, 82, out)
                out.toByteArray()
            }
            PaperPhoto(jpeg, fitted.asImageBitmap())
        }
    }
}

/** The ERP's reader, as the signed-in owner: the same route the browser's scanner calls. */
object PaperReader {
    /** It waits out the AI's rate limit before answering, so it is given five minutes rather than one. */
    suspend fun ask(path: String, body: Map<String, Any?>): String = ErpApi.shared.data(path, "POST", body, timeoutMs = 300_000)

    /** What went wrong, in words: the ERP's own when it said something ("Not available on this account."). */
    fun words(error: Throwable): String = (error as? ErpApi.Failure)?.message ?: error.message ?: "Something went wrong. Try again."
}

/**
 * The two ways paper comes in: scanned (Google's scanner squares the page and evens the light), or chosen from
 * Photos. [room] is how many more photos may be added.
 */
@Composable
fun PaperPicker(
    room: Int,
    add: (List<PaperPhoto>) -> Unit,
    problem: (String) -> Unit,
    modifier: Modifier = Modifier,
    scanTitle: String = "Scan",
    disabled: Boolean = false,
) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(false) }

    fun tooMany(count: Int) {
        if (count > room && room > 0) {
            problem("Only the first ${if (room == 1) "one was" else "$room were"} added: ${if (room == 1) "one photo" else "$room photos"} at most.")
        }
    }

    fun scan() {
        val activity = Foreground.activity
        if (activity == null || !DocumentScanner.isSupported(activity)) {
            problem("This phone has no camera to scan with. Choose the photo from Photos.")
            return
        }
        scope.launch {
            loading = true
            try {
                val pages = DocumentScanner.scan(activity)
                val out = pages.take(maxOf(0, room)).mapNotNull { PaperPhoto.ofPage(it.jpeg) }
                tooMany(pages.size)
                if (out.isNotEmpty()) add(out)
            } catch (e: CancellationException) {
                throw e
            } catch (e: DocumentScanner.Failure) {
                if (e.code != "cancelled") problem(e.message)
            } catch (e: Exception) {
                problem(e.message ?: "The scanner couldn't open.")
            } finally {
                loading = false
            }
        }
    }

    fun library() {
        val activity = Foreground.activity
        val launchers = Foreground.launchers
        if (activity == null || launchers == null) {
            problem("Photos can't open here.")
            return
        }
        scope.launch {
            loading = true
            try {
                val intent = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, room > 1)
                val result = launchers.intent(intent)
                if (result.resultCode != Activity.RESULT_OK) return@launch
                val data = result.data
                val uris = buildList {
                    data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) add(clip.getItemAt(i).uri) }
                    if (isEmpty()) data?.data?.let { add(it) }
                }
                val photos = uris.take(maxOf(0, room)).mapNotNull { PaperPhoto.ofUri(activity, it) }
                if (photos.size < uris.take(maxOf(0, room)).size) {
                    val missed = uris.take(maxOf(0, room)).size - photos.size
                    problem("Couldn't read ${if (missed == 1) "one of those photos" else "some of those photos"}. Try another.")
                }
                tooMany(uris.size)
                if (photos.isNotEmpty()) add(photos)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                problem(e.message ?: "Photos couldn't open.")
            } finally {
                loading = false
            }
        }
    }

    val off = disabled || loading || room <= 0
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        FilledTonalButton(onClick = ::scan, enabled = !off, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
            Icon(Icons.Filled.DocumentScanner, contentDescription = null, Modifier.size(18.dp))
            Text(scanTitle, Modifier.padding(start = 6.dp))
        }
        FilledTonalButton(onClick = ::library, enabled = !off, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
            Icon(Icons.Filled.PhotoLibrary, contentDescription = null, Modifier.size(18.dp))
            Text("From Photos", Modifier.padding(start = 6.dp))
        }
        if (loading) SkeletonLoading(compact = true)
    }
}

/** The photos, large enough to check a figure against, numbered when there are several. Tap one to see it whole. */
@Composable
fun PaperPhotoStrip(photos: List<PaperPhoto>, remove: ((String) -> Unit)?, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf<PaperPhoto?>(null) }
    Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        photos.forEachIndexed { i, p ->
            Box {
                Image(
                    p.image, contentDescription = "Photo ${i + 1} of the paper",
                    Modifier.height(260.dp).clip(Radius.tileShape).clickable { shown = p },
                    contentScale = ContentScale.FillHeight,
                )
                if (photos.size > 1) {
                    Text(
                        "${i + 1}", Modifier.padding(6.dp).clip(Radius.chipShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                if (remove != null) {
                    TextButton(
                        onClick = { remove(p.id) },
                        Modifier.align(Alignment.TopEnd).semantics { contentDescription = "Remove photo ${i + 1}" },
                    ) { Text("✕") }
                }
            }
        }
    }
    shown?.let { p ->
        FullScreenSheet(title = "The paper", onCancel = { shown = null }, confirmText = "Done", onConfirm = { shown = null }, cancelText = "Done") {
            Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Image(p.image, contentDescription = "The paper", Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth)
            }
        }
    }
}

/**
 * A name read off the paper, offered rather than decided (order-scanner.tsx `NamePick`): a clear winner shown as
 * matched, and still changeable; anything short of that a list to choose from; nobody close, said so.
 */
@Composable
fun PaperNamePick(label: String, guess: PaperNameGuess, nobody: String, pick: (PaperRankedName?) -> Unit) {
    FormSection(
        label,
        footer = {
            val pinned = guess.pinned
            Text(
                when {
                    pinned != null -> "Read as “${guess.heard}”: matched in the book."
                    guess.candidates.isNotEmpty() -> "Read as “${guess.heard}”. Which one?"
                    else -> "Read as “${guess.heard}”."
                },
            )
        },
    ) {
        val pinned = guess.pinned
        if (pinned != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = ErpColors.accent)
                Text(pinned.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                TextButton(onClick = { pick(null) }, Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text("Not them") }
            }
        } else if (guess.candidates.isNotEmpty()) {
            guess.candidates.forEach { c ->
                ActionRow(c.name, { pick(c) }, Icons.Filled.Person)
            }
        } else {
            Text(nobody, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
