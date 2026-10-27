package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.Album
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// A tray card's photos (src/app/posts/piece-photos.tsx, 2026-10-23: "send multiple pics of a product together with one
// description"; PostTrayPhotos.swift): the piece's lead to start with, its own other photographs offered beneath it, more from
// the website or this phone, each movable and removable. The one caption goes under the first on WhatsApp and once on an
// Instagram carousel (Album).

/** One photo of the piece, in the order it goes. */
class PostAlbumPhoto(val id: String, val kind: Kind, val thumb: String?, val image: ImageBitmap?, val label: String) {
    sealed interface Kind {
        /** The card's own: as the site shows it, with the weight, or its design. */
        data object Lead : Kind

        /** The piece's own n-th photograph, n from 2 (`photo=n` of the image route). */
        class Angle(val n: Int) : Kind

        /** Another website piece's photograph, by its id. */
        class Site(val id: String) : Kind

        /** This phone's, as a JPEG. */
        class Device(val data: ByteArray) : Kind
    }

    val isLead: Boolean get() = kind is Kind.Lead
    val pieceID: String? get() = (kind as? Kind.Site)?.id

    companion object {
        /** What a card starts with: the hero photo alone (owner, 2026-10-23); the piece's others are offered on the card. */
        fun start(p: PostPiece): PostAlbumPhoto = PostAlbumPhoto("lead", Kind.Lead, p.thumb, null, p.name)

        /** The piece's own n-th photograph (n from 2), as it joins the card; [i] indexes `piece.photos`. */
        fun own(p: PostPiece, i: Int): PostAlbumPhoto = PostAlbumPhoto("angle-${i + 2}", Kind.Angle(i + 2), p.photos[i].thumb, null, "${p.name}, photo ${i + 2}")
    }
}

/** The strip on the card: the photos in order, arrows to move one, x to take it out, and more to add. */
@Composable
fun PostAlbumStrip(card: PostTrayCard, model: PostTrayModel, siteName: String, locked: Boolean, onSay: (List<Note>) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var choosing by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    val full = card.album.size >= Album.max
    // The piece's own photos not on the card yet (indexes into `piece.photos`).
    val ownLeft = card.piece.photos.indices.filter { i -> card.album.none { it.id == "angle-${i + 2}" } }

    fun addOwn(indexes: List<Int>) {
        for (i in indexes) {
            if (card.album.size >= Album.max) {
                onSay(listOf(Note("${Album.max} photos at most", "Take some out first, or send this piece twice.", failed = true)))
                return
            }
            card.album.add(PostAlbumPhoto.own(card.piece, i))
        }
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(Album.max)) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            reading = true
            try {
                // The phone's choices, as JPEGs the size a photo WhatsApp takes (HEIC too).
                val jpegs = ArrayList<ByteArray>()
                var failed = 0
                for (uri in uris) {
                    val jpeg = withContext(Dispatchers.IO) {
                        runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() }?.let { MarketingPhotos.jpegCopy(it) } }.getOrNull()
                    }
                    if (jpeg != null) jpegs.add(jpeg) else failed++
                }
                model.addDevice(card, jpegs)?.let { onSay(listOf(Note(it, "Take some out first, or send this piece twice.", failed = true))) }
                if (failed > 0) onSay(listOf(Note("Couldn't read ${Album.photosLabel(failed)}", failed = true)))
            } catch (e: CancellationException) {
                throw e
            } finally {
                reading = false
            }
        }
    }

    val n = card.album.size
    val footer = buildList {
        add(if (n > 1) "${Album.photosLabel(n)} go in this order, the caption under the first. The story takes the first." else "One photo. Add more to send them together under one caption.")
        if (model.toInstagram && n > Album.igCarouselMax) add("Instagram takes the first ${Album.igCarouselMax}.")
    }.joinToString(" ")

    FormSection("Photos", footer = { Text(footer) }) {
        LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(card.album.toList(), key = { it.id }) { x -> Tile(card, model, x, locked) }
        }
        if (ownLeft.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("More of this piece:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ownLeft, key = { it }) { i ->
                        StockImage(
                            card.piece.photos[i].thumb, "${card.piece.name}, photo ${i + 2}", card.id + "|own$i",
                            Modifier.size(56.dp).clip(Radius.thumbShape).clickable(enabled = !locked && !full, onClickLabel = "Add") { addOwn(listOf(i)) }
                                .semantics { contentDescription = "Add photo ${i + 2} of this piece" },
                        )
                    }
                }
                if (ownLeft.size > 1) TextButton(onClick = { addOwn(ownLeft) }, enabled = !locked && !full) { Text("Add all ${ownLeft.size}") }
            }
        }
        ActionRow(
            if (reading) "Reading the photos…" else "Add from this phone",
            { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            Symbols.PhotoLibrary, enabled = !locked && !reading && !full,
        )
        ActionRow("Add from $siteName", { choosing = true }, Symbols.Language, enabled = !locked && !full)
    }
    if (choosing) PostAlbumSitePicker(card, model, onSay) { choosing = false }
}

@Composable
private fun Tile(card: PostTrayCard, model: PostTrayModel, x: PostAlbumPhoto, locked: Boolean) {
    val number = card.album.indexOfFirst { it.id == x.id } + 1
    Column(Modifier.width(132.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(84.dp).clip(Radius.thumbShape).semantics { contentDescription = "Photo $number: ${x.label}" }) {
            val own = x.image ?: if (x.isLead) card.preview else null
            if (own != null) Image(own, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else StockImage(x.thumb, x.label, card.id + "|" + x.id, Modifier.fillMaxSize())
            Text(
                "$number", Modifier.padding(3.dp).clip(CircleShape).background(ErpColors.accent).padding(horizontal = 6.dp, vertical = 1.dp),
                style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = TabularDigits), color = ErpColors.onAccent,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { model.move(card, x.id, -1) }, enabled = !locked && number > 1) { Icon(Symbols.KeyboardArrowLeft, "Move earlier") }
            if (x.isLead) Box(Modifier.size(48.dp))
            else IconButton(onClick = { model.remove(card, x.id) }, enabled = !locked) { Icon(Symbols.Close, "Take photo $number out") }
            IconButton(onClick = { model.move(card, x.id, 1) }, enabled = !locked && number < card.album.size) { Icon(Symbols.KeyboardArrowRight, "Move later") }
        }
    }
}

/** Another website piece's photograph for the card: tap to add, tap again to take it out. */
@Composable
private fun PostAlbumSitePicker(card: PostTrayCard, model: PostTrayModel, onSay: (List<Note>) -> Unit, onClose: () -> Unit) {
    val state by PostsStore.state.collectAsStateWithLifecycle()
    var search by remember { mutableStateOf("") }
    val words = search.lowercase().split(' ').filter { it.isNotEmpty() }
    val shown = state.pieces.filter { it.id != card.id }.filter { p ->
        val text = "${p.name} ${p.collection} ${p.facts.joinToString(" ")}".lowercase()
        words.all { it in text }
    }.take(80)
    FullScreenSheet(title = "Add a photo", onCancel = onClose, cancelText = "Done", confirmText = "Done", onConfirm = onClose) {
        Column(Modifier.fillMaxSize()) {
            OutlinedTextField(
                search, { search = it }, Modifier.fillMaxWidth().padding(16.dp), singleLine = true, placeholder = { Text("Search: ruby, kara, jhumka…") },
            )
            LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.id }) { p ->
                    val place = card.album.indexOfFirst { it.pieceID == p.id }.takeIf { it >= 0 }?.plus(1)
                    Row(
                        Modifier.fillMaxWidth().clickable { model.toggleSite(card, p)?.let { onSay(listOf(Note(it, failed = true))) } }.ledgerRow(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StockImage(p.thumb, p.name, p.id, Modifier.size(52.dp).clip(Radius.thumbShape))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(p.name, style = MaterialTheme.typography.bodyLarge)
                            if (p.collection.isNotEmpty()) Text(p.collection, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (place != null) {
                            Text(
                                "$place", Modifier.clip(CircleShape).background(ErpColors.accent).padding(horizontal = 8.dp, vertical = 3.dp),
                                style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TabularDigits), color = ErpColors.onAccent,
                            )
                        }
                    }
                }
            }
        }
    }
}
