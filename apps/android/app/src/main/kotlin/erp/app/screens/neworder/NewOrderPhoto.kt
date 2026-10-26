package erp.app.screens.neworder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import coil3.compose.AsyncImage
import com.google.firebase.firestore.FirebaseFirestore
import erp.app.config.House
import erp.app.ui.MinTouchTarget
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

// The sample picture of a piece (components/shared/sample-image-input.tsx): from the library or the camera, made
// small enough to carry, and sent inside the order as a data URI. createOrder moves it to its own document
// (`order_photos/<id>`) in the same commit (lib/order-photos.ts), so the order itself stays light; a picture
// already filed is not sent again (the core's `NewOrderMath.item` leaves it out). (NewOrderPhoto.swift.)

object NewOrderPhotoCodec {
    /** Longest edge after shrinking: the picture is shown at 96 px on the order page, so this is generous. */
    const val longestEdge = 1000

    /** A budget, not a limit: these photos are read by every screen that reads orders. */
    const val budget = 120 * 1024

    /** The web steps the quality down the same way. */
    val steps = listOf(82, 70, 60, 50, 40)
    const val lastQuality = 35

    /** The size after shrinking so no side is over [longest]; null for a picture with no size. */
    fun scaled(width: Int, height: Int, longest: Int = longestEdge): Pair<Int, Int>? {
        val side = max(width, height)
        if (side <= 0) return null
        val scale = minOf(1.0, longest.toDouble() / side)
        return Pair((width * scale).roundToInt().coerceAtLeast(1), (height * scale).roundToInt().coerceAtLeast(1))
    }

    /** The first quality whose result fits the budget, else the last resort. */
    fun quality(bytesAt: (Int) -> Int): Int = steps.firstOrNull { bytesAt(it) <= budget } ?: lastQuality

    /** The picture shrunk and re-encoded until it fits the budget. */
    fun jpeg(image: Bitmap): ByteArray? {
        val size = scaled(image.width, image.height) ?: return null
        val small = if (size.first == image.width && size.second == image.height) image else Bitmap.createScaledBitmap(image, size.first, size.second, true)
        fun encode(q: Int): ByteArray = ByteArrayOutputStream().use { out ->
            small.compress(Bitmap.CompressFormat.JPEG, q, out)
            out.toByteArray()
        }
        // Encoded once per step that is tried; the winner is kept rather than encoded again.
        var kept: ByteArray? = null
        val q = quality { s -> encode(s).also { kept = it }.size }
        return if (q == lastQuality) encode(lastQuality) else kept
    }

    /** A bitmap made to fit [longest] on its longer side. */
    fun fitted(image: Bitmap, longest: Int): Bitmap {
        val size = scaled(image.width, image.height, longest) ?: return image
        return if (size.first == image.width && size.second == image.height) image else Bitmap.createScaledBitmap(image, size.first, size.second, true)
    }

    /** The picture at [uri], upright, with no side much over [longest] (the sample is decoded at a power-of-two fraction first). */
    fun decode(context: Context, uri: Uri, longest: Int = 2200): Bitmap? = try {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val side = max(bounds.outWidth, bounds.outHeight)
        if (side <= 0) {
            null
        } else {
            var sample = 1
            while (side / (sample * 2) >= longest) sample *= 2
            val raw = resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            }
            val turn = resolver.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
            if (raw == null || turn == 0f) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(turn) }, true)
        }
    } catch (e: Exception) {
        null
    }

    /** The bytes of a "data:image/…;base64,…" address, or null for anything else. */
    fun dataUriBytes(uri: String): ByteArray? {
        if (!uri.startsWith("data:")) return null
        val comma = uri.indexOf(',')
        if (comma < 0) return null
        return try { Base64.decode(uri.substring(comma + 1), Base64.DEFAULT) } catch (e: IllegalArgumentException) { null }
    }
}

// MARK: Taking a picture

/**
 * The camera, for a photo of the customer's sample or a design: asks for the permission the manifest declares
 * (without it the system's camera app is refused), then opens the camera into a private file and hands back the
 * picture upright. [onTaken] gets null when it was cancelled. Returns the action to call.
 */
@Composable
internal fun rememberCameraCapture(onProblem: (String) -> Unit, onTaken: (Bitmap?) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var target by remember { mutableStateOf<Pair<File, Uri>?>(null) }
    val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val t = target
        target = null
        if (t == null) return@rememberLauncherForActivityResult
        if (!ok) {
            t.first.delete()
            onTaken(null)
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            val image = withContext(Dispatchers.Default) { NewOrderPhotoCodec.decode(context, t.second) }
            t.first.delete()
            onTaken(image)
        }
    }
    fun open() {
        val dir = File(context.cacheDir, "capture").apply { mkdirs() }
        val file = File(dir, "order-${UUID.randomUUID()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        target = file to uri
        take.launch(uri)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) open() else onProblem("Camera access is off for this app. Turn it on in the phone's settings, or choose the photo from Photos.")
    }
    return {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) open()
        else permission.launch(Manifest.permission.CAMERA)
    }
}

internal fun hasCamera(context: Context): Boolean = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

// MARK: The sample field

/** Stored samples stay visible while editing; choosing or removing a photo is explicit. */
@Composable
internal fun SampleField(holder: DraftHolder, pieceId: UUID) {
    val piece = holder.read().pieces.firstOrNull { it.id == pieceId } ?: return
    val hasStored = !piece.samplePhotoId.isNullOrEmpty() || !piece.sampleImageDataUri.isNullOrEmpty()
    // The filed picture is read from its own document when the piece only holds its id.
    val stored by produceState<StoredSample>(StoredSample.Loading, piece.samplePhotoId, piece.sampleImageDataUri) {
        val id = piece.samplePhotoId
        value = if (id.isNullOrEmpty() || piece.sampleImageDataUri != null) StoredSample.Loading else readStoredSample(id)
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (piece.photo == null && !piece.removePhoto && hasStored) {
            val uri = piece.sampleImageDataUri ?: (stored as? StoredSample.Ready)?.uri
            when {
                !uri.isNullOrEmpty() -> StoredImage(uri, piece.description.ifEmpty { "Sample photo" }, Modifier.heightIn(max = 160.dp).clip(Radius.tileShape))
                stored is StoredSample.Failed -> Text((stored as StoredSample.Failed).words, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> SkeletonLoading(Modifier.heightIn(min = 80.dp))
            }
            TextButton(onClick = { holder.editPiece(pieceId) { removePhoto = true } }) {
                Icon(Icons.Filled.DeleteOutline, null, Modifier.size(18.dp), tint = Tone.problem.color())
                Text("Remove photo", Modifier.padding(start = 6.dp), color = Tone.problem.color())
            }
        }
        PhotoField(piece.photo) { bytes -> holder.editPiece(pieceId) { photo = bytes; removePhoto = bytes == null } }
    }
}

internal sealed interface StoredSample {
    data object Loading : StoredSample
    class Ready(val uri: String) : StoredSample
    class Failed(val words: String) : StoredSample
}

/** The picture an order keeps in its own document (`order_photos/<id>`), read for an editor; the words say what failed. */
internal suspend fun readStoredSample(id: String, keptOn: String = "order"): StoredSample {
    if (House.isDemo) return StoredSample.Failed("Sample photo preview unavailable in demo.")
    return try {
        val snapshot = (erp.app.config.Businesses.firestore ?: error("Not connected to the ERP.")).collection("order_photos").document(id).get().await()
        val uri = snapshot.data?.get("dataUri") as? String
        if (uri != null) StoredSample.Ready(uri) else StoredSample.Failed("The saved photo is unavailable. It stays on the $keptOn unless removed.")
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        StoredSample.Failed("Couldn't load the saved photo. It stays on the $keptOn unless removed.")
    }
}

/** A picture kept on the order: a data URI decoded here, or a web address loaded. */
@Composable
internal fun StoredImage(uri: String, description: String, modifier: Modifier = Modifier) {
    if (uri.startsWith("data:")) {
        val bitmap by produceState<ImageBitmap?>(null, uri) {
            value = withContext(Dispatchers.Default) {
                NewOrderPhotoCodec.dataUriBytes(uri)?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
            }
        }
        bitmap?.let { Image(it, description, modifier, contentScale = ContentScale.Fit) }
    } else {
        AsyncImage(model = uri, contentDescription = description, modifier = modifier, contentScale = ContentScale.Fit)
    }
}

/** A piece's sample picture: shown, replaced from Photos or the camera, or removed (NewOrderPhotoField). */
@Composable
internal fun PhotoField(data: ByteArray?, onData: (ByteArray?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    fun take(image: Bitmap?) {
        if (image == null) { busy = false; return }
        busy = true
        scope.launch {
            val jpeg = withContext(Dispatchers.Default) { NewOrderPhotoCodec.jpeg(image) }
            busy = false
            if (jpeg != null) { onData(jpeg); problem = null } else problem = "Couldn't use that photo."
        }
    }

    val library = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        problem = null
        scope.launch {
            val image = withContext(Dispatchers.Default) { NewOrderPhotoCodec.decode(context, uri) }
            if (image == null) { busy = false; problem = "Couldn't read that photo. Try another." } else take(image)
        }
    }
    val camera = rememberCameraCapture(onProblem = { problem = it }) { image -> if (image != null) { problem = null; take(image) } }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val preview by produceState<ImageBitmap?>(null, data) {
            value = data?.let { bytes -> withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() } }
        }
        preview?.let { bitmap ->
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Image(
                    bitmap, "The sample photo",
                    Modifier.weight(1f, fill = false).heightIn(max = 140.dp).clip(Radius.tileShape),
                    contentScale = ContentScale.Fit,
                )
                androidx.compose.material3.IconButton(
                    onClick = { onData(null) },
                    Modifier.size(MinTouchTarget).semantics { contentDescription = "Remove photo" },
                ) { Icon(Icons.Filled.DeleteOutline, null, tint = Tone.problem.color()) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { library.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, Modifier.heightIn(min = MinTouchTarget)) {
                Icon(Icons.Filled.PhotoLibrary, null, Modifier.size(18.dp))
                Text("Photos", Modifier.padding(start = 6.dp))
            }
            if (hasCamera(context)) {
                OutlinedButton(onClick = camera, Modifier.heightIn(min = MinTouchTarget)) {
                    Icon(Icons.Filled.CameraAlt, null, Modifier.size(18.dp))
                    Text("Camera", Modifier.padding(start = 6.dp))
                }
            }
            if (busy) SkeletonLoading(compact = true)
        }
        problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
    }
}
