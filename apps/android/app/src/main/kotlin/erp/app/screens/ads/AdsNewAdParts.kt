package erp.app.screens.ads

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CellTower
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.screens.stock.StockImage
import erp.app.ui.FullScreenSheet
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The pieces of New ad (AdsNewAd.swift) and the ad set designer (AdsAdSets.swift) that are views of their own: the post
// grid, a photo's row, the ad account's library, the website's pieces, a goal's row (AdsNewAdParts.swift).

/** The icon for a goal (AdsNewAdWords.symbol). */
fun adsGoalIcon(goal: String): ImageVector = when (goal) {
    "whatsapp" -> Icons.Filled.Chat
    "messages" -> Icons.Filled.Forum
    "instagram_dm" -> Icons.Filled.Send
    "website" -> Icons.Filled.TouchApp
    "sales" -> Icons.Filled.ShoppingBag
    "channel" -> Icons.Filled.Podcasts
    "profile" -> Icons.Filled.AccountCircle
    "engagement" -> Icons.Filled.Favorite
    else -> Icons.Filled.CellTower
}

/** A goal on the picker: its words, and a tick on the chosen one. */
@Composable
fun AdsGoalRow(goal: AdsGoal, chosen: Boolean, onClick: () -> Unit) {
    AdsChoiceRow(goal.label, chosen, onClick, subtitle = goal.hint, leading = adsGoalIcon(goal.key))
}

/** A picked photo made ready to send: turned upright and to a JPEG no bigger than Meta is sent (2048 px, the server's own limit). */
object AdsPhotoCodec {
    const val LONGEST_EDGE = 2048
    private const val THUMB_EDGE = 240

    class Coded(val jpeg: ByteArray, val thumbnail: ImageBitmap)

    private fun decode(activity: Activity, uri: Uri, longest: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        activity.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val side = maxOf(bounds.outWidth, bounds.outHeight)
        if (side <= 0) return null
        var sample = 1
        while (side / (sample * 2) >= longest) sample *= 2
        val decoded = activity.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        return fit(decoded, longest)
    }

    private fun fit(b: Bitmap, longest: Int): Bitmap {
        val big = maxOf(b.width, b.height)
        if (big <= longest) return b
        val k = longest.toFloat() / big
        return Bitmap.createScaledBitmap(b, (b.width * k).toInt().coerceAtLeast(1), (b.height * k).toInt().coerceAtLeast(1), true)
    }

    /** The JPEG to send (at most 2048 px, quality 92) and a small copy to show while it goes; null when the photo can't be read. */
    suspend fun read(activity: Activity, uri: Uri): Coded? = withContext(Dispatchers.Default) {
        val big = decode(activity, uri, LONGEST_EDGE) ?: return@withContext null
        val jpeg = ByteArrayOutputStream().use { out ->
            big.compress(Bitmap.CompressFormat.JPEG, 92, out)
            out.toByteArray()
        }
        Coded(jpeg, fit(big, THUMB_EDGE).asImageBitmap())
    }
}

/** Tiles as many to a row as the width has room for (the iPhone's adaptive grid), each [min] wide at least. */
@Composable
fun <T> AdsTileGrid(items: List<T>, min: Dp, spacing: Dp = 6.dp, modifier: Modifier = Modifier, tile: @Composable (T, Dp) -> Unit) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val columns = maxOf(1, ((maxWidth + spacing) / (min + spacing)).toInt())
        val size = (maxWidth - spacing * (columns - 1)) / columns
        Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
            for (row in items.chunked(columns)) {
                Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
                    for (item in row) tile(item, size)
                }
            }
        }
    }
}

/** The house's recent Instagram posts and reels, to promote one as it is. One Meta won't boost is dimmed. */
@Composable
fun AdsMediaGrid(media: List<AdsMedia>, chosen: String?, pick: (AdsMedia) -> Unit) {
    AdsTileGrid(media, 96.dp, modifier = Modifier.padding(vertical = 4.dp)) { m, size ->
        val on = chosen == m.id
        val ok = m.boostable != false
        Box(
            Modifier.size(size).alpha(if (ok) 1f else 0.4f)
                .clip(Radius.thumbShape)
                .then(if (on) Modifier.border(BorderStroke(3.dp, ErpColors.accent), Radius.thumbShape) else Modifier)
                .clickable(enabled = ok, role = Role.Button) { pick(m) }
                .semantics { contentDescription = m.caption.ifEmpty { "Post" } },
        ) {
            StockImage(m.thumb, m.caption.ifEmpty { "Post" }, m.id, Modifier.size(size))
            m.kindWord?.let { w ->
                Text(
                    w, Modifier.align(Alignment.TopStart).padding(4.dp).clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 5.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold), color = Color.White,
                )
            }
            if (on) Icon(Icons.Filled.CheckCircle, "Chosen", Modifier.align(Alignment.TopEnd).padding(4.dp), tint = ErpColors.accent)
        }
    }
}

/** The website's pieces as a grid; a tap adds the piece as a photo of the ad. */
@Composable
fun AdsPieceGrid(pieces: List<AdsSitePiece>, full: Boolean, pick: (AdsSitePiece) -> Unit) {
    AdsTileGrid(pieces, 96.dp, spacing = 8.dp, modifier = Modifier.padding(vertical = 4.dp)) { p, size ->
        Column(
            Modifier.width(size).clickable(enabled = !full, role = Role.Button, onClickLabel = "Add ${p.name}") { pick(p) },
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            StockImage(p.thumb, p.name, p.id, Modifier.size(size).clip(Radius.thumbShape))
            Text(p.name, style = MaterialTheme.typography.labelSmall, maxLines = 2)
        }
    }
}

/**
 * One photo of a new ad: on its way to Meta, refused, or ready; in a carousel, its own headline and link and its place
 * in the order.
 */
@Composable
fun AdsPhotoRow(
    photo: AdsPhoto,
    carousel: Boolean,
    ownLinks: Boolean,
    first: Boolean,
    last: Boolean,
    change: (AdsPhoto) -> Unit,
    move: (Int) -> Unit,
    remove: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        val preview = photo.preview
        if (preview != null) {
            Image(preview, contentDescription = null, Modifier.size(56.dp).clip(Radius.thumbShape), contentScale = ContentScale.Crop)
        } else {
            StockImage(photo.thumb ?: photo.url, photo.headline.ifEmpty { "Photo" }, photo.key, Modifier.size(56.dp).clip(Radius.thumbShape))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            when {
                photo.uploading -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    erp.app.ui.SkeletonLoading(compact = true, label = "Sending to Meta")
                    Text("Sending to Meta…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                photo.error != null -> Text(photo.error, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
                carousel -> {
                    OutlinedTextField(photo.headline, { change(photo.copy(headline = it)) }, Modifier.fillMaxWidth(), label = { Text("Card headline") }, singleLine = true)
                    if (ownLinks) {
                        OutlinedTextField(
                            photo.link, { change(photo.copy(link = it)) }, Modifier.fillMaxWidth(), label = { Text("Card link (optional)") }, singleLine = true,
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                        )
                    }
                }
                else -> Text("Ready", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (carousel) {
            Column {
                IconButton(onClick = { move(-1) }, enabled = !first) { Icon(Icons.Filled.ArrowUpward, "Earlier") }
                IconButton(onClick = { move(1) }, enabled = !last) { Icon(Icons.Filled.ArrowDownward, "Later") }
            }
        }
        IconButton(onClick = remove) { Icon(Icons.Filled.Cancel, "Remove the photo", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** Every picture in the ad account's Ads Manager library (/api/ads/library), to use again without uploading. */
@Composable
fun AdsLibrarySheet(chosen: Set<String>, room: Int, onDismiss: () -> Unit, pick: (AdsLibraryImage) -> Unit) {
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    var images by remember { mutableStateOf<List<AdsLibraryImage>?>(null) }
    var after by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var added by remember { mutableStateOf(setOf<String>()) }

    suspend fun load(cursor: String?) {
        busy = true
        try {
            val a = backend.library(cursor)
            images = (if (cursor == null) emptyList() else (images ?: emptyList())) + a.images
            after = a.after
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        } finally {
            busy = false
        }
    }
    LaunchedEffect(Unit) { if (images == null) load(null) }

    FullScreenSheet(title = "Ad account photos", onCancel = onDismiss, confirmText = "Done", onConfirm = onDismiss) {
        AdsPage {
            Text(
                "Every picture in this ad account's Ads Manager library: tap one to use it again.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            problem?.let { p ->
                Text(p, color = Tone.problem.color())
                AdsTonalButton("Try again", { scope.launch { load(null) } })
            }
            val list = images
            if (list != null) {
                if (list.isEmpty()) AdsUnavailable("The library is empty so far", "", Modifier.fillMaxWidth(), icon = Icons.Filled.PhotoLibrary)
                AdsTileGrid(list, 84.dp) { img, size ->
                    val used = img.hash in chosen || img.hash in added
                    Box(
                        Modifier.size(size).clip(Radius.thumbShape).clickable(enabled = !used && added.size < room, role = Role.Button, onClickLabel = "Use this photo") {
                            added = added + img.hash
                            pick(img)
                        },
                    ) {
                        StockImage(img.thumb, img.name.ifEmpty { "Photo" }, img.hash, Modifier.size(size))
                        if (used) Icon(Icons.Filled.CheckCircle, "Used", Modifier.align(Alignment.TopEnd).padding(4.dp), tint = ErpColors.accent)
                    }
                }
                if (after != null) {
                    AdsTonalButton(if (busy) "Reading…" else "More", { scope.launch { load(after) } }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                }
            } else if (problem == null) {
                Column(Modifier.fillMaxWidth()) { AdsReading("Reading the library…") }
            }
        }
    }
}
