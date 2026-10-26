package erp.app.screens.marketing

import erp.app.ui.SearchBarField
import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Scale
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.ArrowCircleUp
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.Outbox
import erp.app.data.ErpApi
import erp.app.device.Foreground
import erp.app.device.openAddress
import erp.app.nav.ScreenTitle
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.LedgerSection
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.RowAction
import erp.app.ui.SkeletonLoading
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import java.io.File
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The tray and what is asked of the ERP, held apart from the drawing (the page's `@State`). */
@Stable
class WebsitePhotosModel(private val scope: CoroutineScope) {
    var collections by mutableStateOf<List<WebsiteCollection>?>(null)
    var configured by mutableStateOf(true)
    var denied by mutableStateOf(false)
    var problem by mutableStateOf<String?>(null)
    var folder by mutableStateOf("")
        private set

    /** How the chosen collection names its photographs; null while it is asked, or when it could not be. */
    var maison by mutableStateOf<WebsiteMaisonAnswer?>(null)
    var maisonUnknown by mutableStateOf(false)
    var items by mutableStateOf<List<WebsitePhotoItem>>(emptyList())
    var lastHouse by mutableStateOf("")
    var sending by mutableStateOf(false)
    var reading by mutableStateOf(false)
    var said by mutableStateOf<String?>(null)
    var failure by mutableStateOf<String?>(null)

    val chosen: WebsiteCollection? get() = collections?.firstOrNull { it.folder == folder }
    val isMaison: Boolean get() = maison?.maison ?: false
    val pending: List<WebsitePhotoItem> get() = WebsitePhotosLogic.pending(items)
    val done: List<WebsitePhotoItem> get() = WebsitePhotosLogic.done(items)
    val failedCount: Int get() = items.count { it.status == WebsitePhotoItem.Status.Failed }
    val unnamed: Int get() = WebsitePhotosLogic.unnamed(items, isMaison)
    val canSend: Boolean get() = WebsitePhotosLogic.canSend(folder, configured, items, maison, maisonUnknown, sending, reading)

    fun update(id: String, change: (WebsitePhotoItem) -> WebsitePhotoItem) {
        items = items.map { if (it.id == id) change(it) else it }
    }

    fun choose(next: String) {
        if (next == folder) return
        folder = next
        Prefs.putString(FOLDER_KEY, next)
        scope.launch { checkMaison() }
    }

    suspend fun load() {
        if (House.isDemo) {
            collections = WebsiteDemo.collections
            maison = WebsiteMaisonAnswer(false, emptyList())
            if (folder.isEmpty()) folder = WebsiteDemo.collections[1].folder
            if (items.isEmpty()) items = WebsiteDemo.tray()
            return
        }
        try {
            val a = WebsiteApi.get("/api/website/photos", WebsiteCollectionsAnswer)
            collections = a.collections
            configured = a.configured
            problem = null
            // A counter session is usually one tray: the last collection again.
            val last = Prefs.string(FOLDER_KEY)
            if (folder.isEmpty() && last != null && a.collections.any { it.folder == last }) {
                folder = last
                checkMaison()
            } else if (folder.isNotEmpty()) {
                checkMaison()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 401 || e.status == 403) denied = true else problem = e.message
        } catch (e: Exception) {
            problem = e.message ?: "Something went wrong."
        }
    }

    private suspend fun checkMaison() {
        maison = null
        maisonUnknown = false
        if (folder.isEmpty()) return
        val asked = folder
        try {
            val a = WebsiteApi.get("/api/website/photos/names?folder=${WebsiteNumber.query(asked)}", WebsiteMaisonAnswer)
            if (folder == asked) maison = a
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Never send a Maisons tray under the camera's names: until it is known, Send waits.
            if (folder == asked) maisonUnknown = true
        }
    }

    // MARK: Adding

    private class Ready(val data: ByteArray, val kind: MarketingPhotos.Kind, val thumb: androidx.compose.ui.graphics.ImageBitmap?)

    /** The bytes ready for the ERP: as they are when it takes them, else a JPEG made from them (WebsitePhoto.prepared). */
    private suspend fun prepare(raw: ByteArray): Ready? = withContext(Dispatchers.Default) {
        val kind = MarketingPhotos.kind(raw)
        val bytes: ByteArray
        val k: MarketingPhotos.Kind
        if (kind != null) { bytes = raw; k = kind } else {
            val jpeg = MarketingPhotos.decode(raw, 4032)?.let { MarketingPhotos.jpeg(it) } ?: return@withContext null
            bytes = jpeg; k = MarketingPhotos.Kind("jpg", "image/jpeg")
        }
        Ready(bytes, k, MarketingPhotos.decode(bytes, 240)?.asImageBitmap())
    }

    /** Photos from the phone's picker; null is one that could not be read. */
    suspend fun add(raws: List<ByteArray?>) {
        reading = true
        try {
            var skipped = 0
            var tooBig = 0
            for (raw in raws) {
                if (raw == null) { skipped++; continue }
                val ready = prepare(raw)
                if (ready == null) { skipped++; continue }
                if (ready.data.size > WebsitePhotosLogic.MAX_BYTES) { tooBig++; continue }
                items = items + WebsitePhotoItem(java.util.UUID.randomUUID().toString(), ready.data, ready.kind, ready.thumb, WebsitePhotosLogic.nextStem(items.size), house = lastHouse)
            }
            WebsitePhotosLogic.skippedWords(skipped, tooBig)?.let { failure = it }
        } finally {
            reading = false
        }
    }

    /** A photo from the camera, made a JPEG as the web's camera input is. */
    suspend fun take(raw: ByteArray) {
        reading = true
        try {
            val ready = withContext(Dispatchers.Default) {
                val jpeg = MarketingPhotos.decode(raw, 4032)?.let { MarketingPhotos.jpeg(it, 4032, 92) } ?: return@withContext null
                Ready(jpeg, MarketingPhotos.Kind("jpg", "image/jpeg"), MarketingPhotos.decode(jpeg, 240)?.asImageBitmap())
            }
            if (ready == null) { failure = "Couldn't use that photo."; return }
            items = items + WebsitePhotoItem(java.util.UUID.randomUUID().toString(), ready.data, ready.kind, ready.thumb, WebsitePhotosLogic.nextStem(items.size), house = lastHouse)
        } finally {
            reading = false
        }
    }

    fun remove(id: String) { items = items.filter { it.id != id } }

    fun setHouse(id: String, house: String) {
        update(id) { it.copy(house = house) }
        if (house.isNotEmpty()) lastHouse = house
    }

    fun setModel(id: String, model: String) = update(id) { it.copy(model = model.take(160)) }

    // MARK: Retouch (the AI route's own, as the web page calls it)

    suspend fun retouch(id: String) {
        val item = items.firstOrNull { it.id == id } ?: return
        update(id) { it.copy(retouching = true) }
        try {
            // The AI reads JPEG and PNG; the phone makes the JPEG (HEIC included) as the web asks the converter to.
            val jpeg = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(item.data, 3000) } ?: throw ErpApi.Failure(0, "This photo couldn't be read.")
            val r = WebsiteApi.form(
                "/api/website/post/ai", listOf("op" to "retouch", "params" to "{}"), WebsiteRetouched,
                listOf(ErpApi.FormFile("image", "photo.jpg", "image/jpeg", jpeg)), timeoutMs = 310_000,
            )
            val data = r.data
            if (data == null || data.isEmpty()) throw ErpApi.Failure(0, "The AI sent no photo back.")
            val thumb = withContext(Dispatchers.Default) { MarketingPhotos.decode(data, 240)?.asImageBitmap() }
            update(id) { i ->
                i.copy(
                    original = i.original ?: WebsitePhotoItem.Original(i.data, i.kind, i.thumb),
                    data = data, kind = MarketingPhotos.Kind("jpg", "image/jpeg"), thumb = thumb, check = r, retouching = false,
                )
            }
            said = WebsitePhotosLogic.retouchSaid(r)
        } catch (e: CancellationException) {
            update(id) { it.copy(retouching = false) }
            throw e
        } catch (e: Exception) {
            update(id) { it.copy(retouching = false) }
            failure = "Couldn't retouch it. " + (e.message ?: "")
        }
    }

    fun undoRetouch(id: String) {
        update(id) { i ->
            val o = i.original ?: return@update i
            i.copy(data = o.data, kind = o.kind, thumb = o.thumb, original = null, check = null)
        }
    }

    // MARK: Sending (one after another: shop wifi, big files)

    /**
     * Handed to the Outbox: the tray is free at once (each photo shows its own state), and "n photographs sent" or what failed
     * comes back from there, with Retry (which sends only what has not gone).
     */
    fun sendAll(siteName: String) {
        if (!canSend) return
        sending = true
        said = null
        failure = null
        val target = folder
        val n = pending.size
        for (p in pending) update(p.id) { it.copy(status = WebsitePhotoItem.Status.Uploading, error = null) }
        Outbox.post("Send $n photograph${if (n == 1) "" else "s"} to $siteName") {
            sending = true
            try {
                // The Maisons: the ERP names the whole tray (sent ones included, so a later photo of a piece numbers after them).
                val names = HashMap<String, String>()
                if (isMaison) {
                    try {
                        val tray = items.map { mapOf("house" to it.house, "model" to it.model, "ext" to it.kind.ext) }
                        val a = WebsiteApi.post("/api/website/photos/names", mapOf("folder" to target, "items" to tray), WebsiteMaisonNames)
                        if (!a.maison || a.names.size != items.size) throw ErpApi.Failure(0, "The ERP didn't name the photographs.")
                        items.zip(a.names).forEach { (i, name) -> names[i.id] = name }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        for (i in items.filter { it.status == WebsitePhotoItem.Status.Uploading }) update(i.id) { it.copy(status = WebsitePhotoItem.Status.Failed) }
                        throw e
                    }
                }
                var sent = 0
                var lastProblem: String? = null
                for (id in items.filter { it.status != WebsitePhotoItem.Status.Done }.map { it.id }) {
                    val item = items.firstOrNull { it.id == id } ?: continue
                    update(id) { it.copy(status = WebsitePhotoItem.Status.Uploading, error = null) }
                    val name = names[id] ?: (item.stem + "." + item.kind.ext)
                    try {
                        val up = WebsiteApi.form(
                            "/api/website/photos", listOf("folder" to target, "name" to name), WebsiteUploaded,
                            listOf(ErpApi.FormFile("file", "photo.${item.kind.ext}", item.kind.mime, item.data)), timeoutMs = 120_000,
                        )
                        update(id) { it.copy(status = WebsitePhotoItem.Status.Done, rel = up.rel) }
                        sent++
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        lastProblem = e.message ?: "Failed"
                        update(id) { it.copy(status = WebsitePhotoItem.Status.Failed, error = e.message ?: "Failed") }
                    }
                }
                if (sent > 0) WebsiteStore.loadFeatured()
                // A refusal is not retried by itself; the banner's Retry sends only the photographs that did not go.
                lastProblem?.let { throw ErpApi.Failure(400, (if (sent > 0) "$sent sent. " else "") + it) }
                said = WebsitePhotosLogic.sentWords(sent, siteName, chosen?.collection ?: "the collection")
                "$sent photograph${if (sent == 1) "" else "s"} on $siteName"
            } finally {
                sending = false
            }
        }
    }

    companion object {
        const val FOLDER_KEY = "erp.website.photoFolder"
    }
}

/**
 * Website → Add photos (src/app/website/photos/page.tsx): choose the collection once, then add the tray's photographs from
 * Photos or the camera, and send them. Each goes on its own to the same route the web page uses (/api/website/photos), which
 * relays it to the site with the site's secret and turns HEIC into JPEG on the way, so one bad file never stops the rest and
 * a failure is sent again without redoing the batch. A photograph is public as soon as it arrives (the site reads its drop
 * folder on every load), so Send says where they go first.
 *
 * The Maisons (taheri.shop): each photograph asks for its house and the model's official name, and the ERP names the files
 * (/api/website/photos/names), as the site reads them back. Retouch is the web's (the AI route's `retouch`), with the original
 * kept to put back and the "same piece?" check shown.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun WebsitePhotosScreen() {
    ScreenTitle("Add photos")
    val scope = rememberCoroutineScope()
    val model = remember { WebsitePhotosModel(scope) }
    val site by WebsiteStore.state.collectAsStateWithLifecycle()
    val me by LocalSession.current.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val context = LocalContext.current
    var choosing by remember { mutableStateOf(false) }
    var confirmingSend by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        WebsiteStore.loadSettings()
        if (model.collections == null) model.load()
    }

    fun choosePhotos() {
        val launchers = Foreground.launchers ?: run { model.failure = "Photos can't open here."; return }
        scope.launch {
            try {
                val intent = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                val result = launchers.intent(intent)
                if (result.resultCode != Activity.RESULT_OK) return@launch
                val uris = buildList<Uri> {
                    result.data?.clipData?.let { clip -> for (i in 0 until minOf(clip.itemCount, WebsitePhotosLogic.MAX_PICK)) add(clip.getItemAt(i).uri) }
                    if (isEmpty()) result.data?.data?.let { add(it) }
                }
                model.reading = true
                val raws = withContext(Dispatchers.IO) { uris.map { u -> try { context.contentResolver.openInputStream(u)?.use { it.readBytes() } } catch (e: Exception) { null } } }
                model.add(raws)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                model.failure = e.message ?: "Photos couldn't open."
            } finally {
                model.reading = false
            }
        }
    }

    fun takePhoto() {
        val launchers = Foreground.launchers ?: run { model.failure = "The camera can't open here."; return }
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { File.createTempFile("photo-", ".jpg", File(context.cacheDir, "capture").apply { mkdirs() }) }
                val uri = FileProvider.getUriForFile(context, "${House.applicationId}.files", file)
                if (!launchers.takePicture(uri)) return@launch
                model.reading = true
                val raw = withContext(Dispatchers.IO) { file.readBytes().also { file.delete() } }
                model.take(raw)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                model.failure = e.message ?: "The camera couldn't open."
            } finally {
                model.reading = false
            }
        }
    }

    // What was said after a send or a retouch is the shell's toast, not a line under the button.
    val note = erp.app.ui.LocalNoteState.current
    LaunchedEffect(model.said) { model.said?.let { note.show(erp.app.ui.Note(it)) } }

    val hasCamera = remember { context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY) }
    when {
        model.denied -> NotAvailableState("This account can't add photographs", why = "Only owner, staff and marketing accounts can write to the website.", icon = Icons.Filled.Lock)
        model.problem != null && model.collections == null -> MarketingErrorState(model.problem ?: "") { scope.launch { model.problem = null; model.load() } }
        model.collections == null -> SkeletonLoading(Modifier.fillMaxSize())
        // The page's one action is pinned: where the photographs go is said in the confirmation it opens.
        else -> MarketingPinned(bar = if (model.items.isNotEmpty()) ({
            val unnamed = model.unnamed
            MarketingActionBar(
                if (model.sending) "Sending…" else "Send ${model.pending.size} to the website", Icons.Filled.ArrowCircleUp, { confirmingSend = true },
                busy = model.sending, enabled = model.canSend,
                summary = if (unnamed > 0) "$unnamed still need${if (unnamed == 1) "s" else ""} a house and a name." else null,
            )
        }) else null) {
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; model.load(); refreshing = false } }) {
                PhotosPage(model, site.siteName, site.settings?.site, role, hasCamera, { choosing = true }, ::choosePhotos, ::takePhoto)
            }
        }
    }
    if (choosing) WebsiteCollectionSheet(model.collections ?: emptyList(), model.folder, onPick = { model.choose(it); choosing = false }, onClose = { choosing = false })
    if (confirmingSend) {
        WebsiteConfirm(
            "Put them on ${site.siteName}?", WebsitePhotosLogic.sendWords(model.pending, WebsitePhotosLogic.shelfName(model.chosen, model.folder), site.siteName),
            listOf(WebsiteChoice("Send ${model.pending.size} to the website") { model.sendAll(site.siteName) }),
            onDismiss = { confirmingSend = false },
        )
    }
    FailureAlert(model.failure, { model.failure = null })
}

@Composable
private fun PhotosPage(
    m: WebsitePhotosModel, siteName: String, site: String?, role: String, hasCamera: Boolean,
    chooseCollection: () -> Unit, choosePhotos: () -> Unit, takePhoto: () -> Unit,
) {
    Column(Modifier.fillMaxSize().readableColumn(720.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (!m.configured) {
            Row(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.Warning, null, tint = Tone.owed.color())
                Text("Uploads are not switched on yet: the website's upload secret isn't set on this ERP. Until it is, nothing below can be sent.", color = Tone.owed.color())
            }
        }
        CollectionSection(m, siteName, chooseCollection)
        WebsiteCard(footer = { Text(if (m.folder.isEmpty()) "Choose a collection first." else "JPEG, PNG, WebP or HEIC · up to 25 MB each · add as many as you like.") }) {
            ActionRow("Choose photographs", choosePhotos, Icons.Filled.PhotoLibrary, enabled = m.folder.isNotEmpty() && !m.sending)
            if (hasCamera) ActionRow("Take a photo", takePhoto, Icons.Filled.AddAPhoto, enabled = m.folder.isNotEmpty() && !m.sending)
            if (m.reading) MarketingReading("Reading the photographs…")
        }
        if (m.items.isNotEmpty()) TraySection(m, siteName)
        if (m.done.isNotEmpty() && !m.sending) WebsiteCard { ActionRow("Clear ${m.done.size} sent", { m.items = m.items.filter { it.status != WebsitePhotoItem.Status.Done } }) }
        if (m.done.isNotEmpty()) WebsiteSetOfTheDay(withNote = false)
        if (m.done.isNotEmpty()) AfterSection(m, site, role)
    }
}

@Composable
private fun CollectionSection(m: WebsitePhotosModel, siteName: String, choose: () -> Unit) {
    val c = m.chosen
    FormSection(
        "Collection",
        footer = {
            Text(
                when {
                    m.isMaison -> "The houses' own pieces. Give each photograph its house and the model's official name, exactly as the house names it (“LOVE Bracelet, Classic”). The site shows it under its house, in 18k, with no gold-rate price. Several photographs of one piece: give them the same name."
                    m.maisonUnknown -> "Couldn't check how this collection names its photographs. Pull to try again before sending."
                    else -> "They appear on $siteName as soon as they arrive: no rebuild."
                },
            )
        },
    ) {
        Row(
            Modifier.fillMaxWidth().clickable(enabled = !m.sending, role = androidx.compose.ui.semantics.Role.Button, onClick = choose).ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    c?.let { "${it.category} → ${it.collection}" } ?: "Choose where these photographs go…",
                    color = if (c == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
                if (c != null) Text(if (c.count > 0) "It has ${c.count} pieces today" else "Nothing in it yet", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun TraySection(m: WebsitePhotosModel, siteName: String) {
    FormSection(
        "Photographs · ${m.items.size}",
        footer = if (m.failedCount > 0 && !m.sending) ({ Text("Send again to retry the ones that failed.") }) else null,
    ) {
        for (item in m.items) {
            androidx.compose.runtime.key(item.id) {
                val removable = item.status != WebsitePhotoItem.Status.Uploading && !m.sending && !item.retouching
                SwipeActions(
                    end = if (removable) RowAction("Remove", Icons.Filled.Delete, Tone.problem) { m.remove(item.id) } else null,
                    menu = if (removable) listOf(RowAction("Remove", Icons.Filled.Delete, Tone.problem) { m.remove(item.id) }) else emptyList(),
                ) { PhotoRow(m, item, siteName) }
            }
        }
    }
}

@Composable
private fun PhotoRow(m: WebsitePhotosModel, item: WebsitePhotoItem, siteName: String) {
    val scope = rememberCoroutineScope()
    val editable = item.editable && !m.sending
    Row(Modifier.fillMaxWidth().background(ErpColors.card).padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Picture(item)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(WebsitePhotosLogic.displayName(item, m.isMaison), maxLines = 2, overflow = TextOverflow.Ellipsis)
            StatusLine(item)
            if (m.isMaison && editable) {
                PickerRow("House", item.house, listOf("" to "House…") + (m.maison?.houses ?: emptyList()).map { it to it }) { m.setHouse(item.id, it) }
                OutlinedTextField(
                    value = item.model, onValueChange = { m.setModel(item.id, it) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Official name, e.g. LOVE Bracelet, Classic") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                )
            }
            val check = item.check
            if (check != null && !check.passes) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Filled.Warning, null, Modifier.size(16.dp), tint = Tone.owed.color())
                    Text(check.differences.firstOrNull() ?: "Not checked: compare it with the original.", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color())
                }
            }
            if (editable && !item.retouching) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = { scope.launch { m.retouch(item.id) } }) {
                        Icon(Icons.Filled.AutoFixHigh, null, Modifier.size(18.dp))
                        Text(if (item.original == null) "Retouch" else "Retouch again", Modifier.padding(start = 6.dp))
                    }
                    if (item.original != null) {
                        TextButton(onClick = { m.undoRetouch(item.id) }) {
                            Icon(Icons.Filled.Undo, null, Modifier.size(18.dp))
                            Text("Original", Modifier.padding(start = 6.dp))
                        }
                    }
                }
            }
            val rel = item.rel
            if (item.status == WebsitePhotoItem.Status.Done && !rel.isNullOrEmpty()) WebsiteFeatureButton(rel, item.stem)
        }
    }
}

@Composable
private fun Picture(item: WebsitePhotoItem) {
    Box(
        Modifier.size(72.dp).clip(Radius.tileShape).background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .alpha(if (item.status == WebsitePhotoItem.Status.Done) 0.7f else 1f),
        contentAlignment = Alignment.Center,
    ) {
        val thumb = item.thumb
        if (thumb != null) Image(thumb, contentDescription = null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(Icons.Filled.Image, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        if (item.status == WebsitePhotoItem.Status.Uploading || item.retouching) {
            Box(Modifier.fillMaxSize().background(ErpColors.card.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) { SkeletonLoading(compact = true) }
        }
    }
}

@Composable
private fun StatusLine(item: WebsitePhotoItem) {
    when (item.status) {
        WebsitePhotoItem.Status.Done -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CheckCircle, null, Modifier.size(16.dp), tint = Tone.settled.color())
            // Done is the expected end: a quiet word, the dimmed photo says the rest.
            Text("On the website", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        WebsitePhotoItem.Status.Failed -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.Cancel, null, Modifier.size(16.dp), tint = Tone.problem.color())
            Text(item.error ?: "Failed", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
        }
        WebsitePhotoItem.Status.Uploading -> Text("Sending…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        WebsitePhotoItem.Status.Queued -> Text(
            if (item.retouching) "Retouching… about a minute" else WebsiteNumber.size(item.data.size),
            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun AfterSection(m: WebsitePhotosModel, site: String?, role: String) {
    val context = LocalContext.current
    val url = WebsitePhotosLogic.collectionUrl(m.chosen, site)
    WebsiteCard {
        if (MarketingKit.has("/website/weights", role)) MarketingLink("Record their weights", Icons.Filled.Scale, "/website/weights")
        if (url != null) ActionRow("See ${m.chosen?.collection ?: "the collection"} on the website", { openAddress(context, Intent.ACTION_VIEW, url) }, Icons.AutoMirrored.Filled.OpenInNew)
    }
}

/** The site's collections, by category, to choose where the photographs go. */
@Composable
fun WebsiteCollectionSheet(collections: List<WebsiteCollection>, folder: String, onPick: (String) -> Unit, onClose: () -> Unit) {
    var search by remember { mutableStateOf("") }
    val shelves = WebsitePhotosLogic.shelves(collections, search)
    FullScreenSheet(title = "Collection", onCancel = onClose) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                SearchBarField(
                    value = search, onValueChange = { search = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Find a collection") }, leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                )
            }
            if (shelves.isEmpty()) item { NotAvailableState("Nothing matches", why = "No collection has “$search” in it.", icon = Icons.Filled.Search) }
            items(shelves, key = { it.id }) { shelf ->
                LedgerSection(shelf.id) {
                    for (c in shelf.list) {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = androidx.compose.ui.semantics.Role.Button) { onPick(c.folder) }.ledgerRow(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(c.collection, Modifier.weight(1f))
                            if (c.count > 0) Text("${c.count}", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (c.folder == folder) Icon(Icons.Filled.Check, contentDescription = "Chosen", tint = ErpColors.accent)
                        }
                    }
                }
            }
        }
    }
}
