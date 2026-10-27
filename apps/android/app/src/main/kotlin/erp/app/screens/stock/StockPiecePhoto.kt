package erp.app.screens.stock

import erp.app.ui.icons.Symbols
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.screens.neworder.NewOrderPhotoCodec
import erp.app.screens.neworder.hasCamera
import erp.app.screens.neworder.rememberCameraCapture
import erp.app.screens.settings.label.LabelConfirm
import erp.app.ui.FailureAlert
import erp.app.ui.MinTouchTarget
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.color
import erp.core.Json
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A piece's photo, added, changed or taken off from the phone (the product form's Photo, product-form.tsx; the iPhone's
 * StockPiecePhoto.swift). The web uploads it to Firebase Storage from the browser; the phone has no Storage SDK, so the
 * photograph goes to the ERP (/api/app/product-photo), which stores it in the same place and records its address on the piece
 * (`setProductPhoto`, lib/writes/products.ts). The ERP makes a HEIC a JPEG and brings it to size; the phone only shrinks it
 * first so a camera's full picture is not sent over a shop's line.
 *
 * Saved at once, on its own, as the web's upload is: the form's Save never sends the photo, so what is typed in the form and
 * the photo never overwrite each other. Owners only, as Stock is.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StockPiecePhotoField(sku: String, name: String, imageUrl: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf(false) }
    // What the ERP answered with, shown until the shelf brings the same ("" for taken off).
    var answered by remember { mutableStateOf<String?>(null) }
    val shown = StockKit.filled(answered ?: imageUrl)

    // The shelf has caught up with what was saved here: it speaks for itself again.
    LaunchedEffect(imageUrl) { if (answered != null && StockKit.filled(answered) == StockKit.filled(imageUrl)) answered = null }

    suspend fun post(fields: List<Pair<String, String>>, files: List<ErpApi.FormFile>) {
        try {
            val text = ErpApi.shared.upload("/api/app/product-photo", fields, files, timeoutMs = 120_000)
            answered = ((Json.parse(text) as? Map<*, *>)?.get("imageUrl") as? String) ?: ""
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e.message ?: e.toString()
        }
        busy = null
    }

    fun send(image: Bitmap) {
        busy = "Reading the photo…"
        scope.launch {
            val jpeg = withContext(Dispatchers.Default) { StockPhotoCodec.jpeg(image) }
            if (jpeg == null) { busy = null; failure = "Couldn't use that photo."; return@launch }
            busy = "Uploading the photo…"
            post(listOf("sku" to sku), listOf(ErpApi.FormFile("file", "$sku.jpg", "image/jpeg", jpeg)))
        }
    }

    val library = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = "Reading the photo…"
        scope.launch {
            val image = withContext(Dispatchers.Default) { NewOrderPhotoCodec.decode(context, uri, StockPhotoCodec.longestEdge) }
            if (image == null) { busy = null; failure = "Couldn't read that photo. Try another." } else send(image)
        }
    }
    val camera = rememberCameraCapture(onProblem = { failure = it }) { image -> if (image != null) send(image) }

    Column(modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (shown != null) {
            StockImage(shown, name, shown, Modifier.size(120.dp).clip(Radius.tileShape), decodeDataUri = true)
        }
        busy?.let {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({ library.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, Modifier.heightIn(min = MinTouchTarget), enabled = busy == null) {
                Icon(Symbols.PhotoLibrary, null, Modifier.size(18.dp))
                Text(if (shown == null) "Add from Photos" else "Photos", Modifier.padding(start = 6.dp))
            }
            if (hasCamera(context)) {
                OutlinedButton(camera, Modifier.heightIn(min = MinTouchTarget), enabled = busy == null) {
                    Icon(Symbols.CameraAlt, null, Modifier.size(18.dp))
                    Text("Camera", Modifier.padding(start = 6.dp))
                }
            }
            if (shown != null) {
                OutlinedButton({ confirmRemove = true }, Modifier.heightIn(min = MinTouchTarget).semantics { contentDescription = "Remove photo" }, enabled = busy == null) {
                    Icon(Symbols.DeleteOutline, null, Modifier.size(18.dp), tint = Tone.problem.color())
                    Text("Remove", Modifier.padding(start = 6.dp), color = Tone.problem.color())
                }
            }
        }
    }
    if (confirmRemove) {
        LabelConfirm(
            "Remove the photo of $name?", "The piece keeps everything else. A new photo can be added at any time.", "Remove photo",
            {
                busy = "Removing the photo…"
                scope.launch { post(listOf("sku" to sku, "remove" to "1"), emptyList()) }
            },
            { confirmRemove = false },
        )
    }
    FailureAlert(failure, { failure = null }, "The photo wasn't saved")
}

/**
 * The photograph made a JPEG of a sensible size before it travels. The ERP brings it to its own size (2000 px) and turns it
 * upright; this only keeps a 48-megapixel picture from being sent whole.
 */
object StockPhotoCodec {
    const val longestEdge = 2400

    fun jpeg(image: Bitmap): ByteArray? {
        val size = NewOrderPhotoCodec.scaled(image.width, image.height, longestEdge) ?: return null
        val small = if (size.first == image.width && size.second == image.height) image else Bitmap.createScaledBitmap(image, size.first, size.second, true)
        return ByteArrayOutputStream().use { out ->
            if (!small.compress(Bitmap.CompressFormat.JPEG, 88, out)) null else out.toByteArray()
        }
    }
}
