package erp.app.screens.ads

import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.EventBusy
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.ChevronRight
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.device.Foreground
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.core.Container
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Ads → New ad (src/app/ads/new/page.tsx), in the order a shop thinks of it: what to promote (an Instagram post as it
 * is, new photos from this phone or the ad account's library, a piece from the website, a new video, a creator's post as
 * a partnership ad, or the catalogue: AdsNewAdSources.kt), what it's for, the words, who sees it, budget and dates, Meta's own preview, then make it, paused or live.
 *
 * Every call is the web's own route; nothing goes to Meta from the phone. Photos from this phone go to /api/ads/images
 * as the web sends them. Before anything is made the server checks the ad and says, in New ad's own lines
 * (/api/ads/plan → planSummary), what will happen and what it can cost; only after a yes is it sent to /api/ads/create,
 * which checks again. `?piece=<id>` starts from a website piece, `?from=<ad>` from an existing ad ("Make one like
 * this"). The last audience and budget are remembered on this phone.
 */
@Composable
fun AdsNewAdScreen(path: String) {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val mayUse = adsMayUse(session.role)
    val now0 = AppClock.now()
    val context = LocalContext.current

    var status by remember { mutableStateOf<AdsStatusAnswer?>(null) }
    var lists by remember { mutableStateOf<AdsNewAdLists?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var started by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    var d by remember { mutableStateOf(AdsNewAdDraft(start = now0.plusSeconds(3600))) }
    var media by remember { mutableStateOf<List<AdsMedia>?>(null) }
    var mediaAfter by remember { mutableStateOf<String?>(null) }
    var mediaBusy by remember { mutableStateOf(false) }
    var mediaError by remember { mutableStateOf<String?>(null) }
    var libraryOpen by remember { mutableStateOf(false) }
    var editingAudience by remember { mutableStateOf(false) }
    var pieces by remember { mutableStateOf<List<AdsSitePiece>?>(null) }
    var piecesError by remember { mutableStateOf<String?>(null) }
    var pieceQ by remember { mutableStateOf("") }
    var pixel by remember { mutableStateOf<AdsPixelState?>(null) }

    var previewSet by remember { mutableStateOf<List<AdsPreview>?>(null) }
    var previewBusy by remember { mutableStateOf(false) }
    var previewError by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    var check by remember { mutableStateOf<AdsPlanCheck?>(null) }
    var confirming by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var made by remember { mutableStateOf<AdsMade?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    ScreenTitle("New ad")

    val goal = lists?.goal(d.goalKey)
    val currency = status?.currency ?: "PKR"

    // MARK: Asking the ERP

    suspend fun loadMedia(after: String?) {
        mediaBusy = true
        mediaError = null
        try {
            val a = backend.media(after)
            media = (if (after == null) emptyList() else (media ?: emptyList())) + a.media
            mediaAfter = a.after
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            mediaError = adsWords(e)
        } finally {
            mediaBusy = false
        }
    }

    suspend fun loadPieces() {
        try {
            pieces = backend.sitePieces().filter { !it.hidden }
            piecesError = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            piecesError = adsWords(e)
        }
    }

    fun updatePhoto(key: String, change: (AdsPhoto) -> AdsPhoto) {
        d = d.copy(photos = d.photos.map { if (it.key == key) change(it) else it })
    }

    /** A website piece as a photo of the ad: the server fetches it from the house's own site for Meta. The first one also fills the words, the headline and the link when they are empty. */
    suspend fun addPiece(p: AdsSitePiece) {
        if (d.photos.size >= AdsNewAdDraft.MAX_PHOTOS) return
        val key = "piece${p.id}${UUID.randomUUID().toString().take(6)}"
        val wasEmpty = d.photos.isEmpty()
        d = d.copy(photos = d.photos + AdsPhoto(key, thumb = p.thumb, headline = p.name, link = p.url, uploading = true))
        if (d.text.trim().isEmpty()) d = d.copy(text = AdsNewAdWords.pieceText(p.name, p.weightGrams, p.facts, d.goalKey, goal?.toSite ?: false))
        if (d.headline.trim().isEmpty()) d = d.copy(headline = p.name)
        if (wasEmpty) d = d.copy(link = p.url)
        try {
            val a = backend.imageFromPiece(p.id)
            updatePhoto(key) { it.copy(hash = a.hash, url = a.url, uploading = false) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val message = adsWords(e)
            updatePhoto(key) { it.copy(uploading = false, error = message) }
        }
    }

    /** "Make one like this": the same photos or post, words, button, link, audience and budget, all changeable. */
    suspend fun startFrom(ad: String) {
        try {
            val t = backend.template(ad)
            var n = d.copy(goalKey = t.goal, text = t.text, headline = t.headline, button = t.button, audience = t.audience)
            if (t.link.isNotEmpty()) n = n.copy(link = t.link)
            if (t.budgetAmount > 0) {
                val kind = if (t.budgetKind == "total") "total" else "daily"
                n = n.copy(budgetKind = kind, amount = AdsAmount.field(t.budgetAmount), days = if (kind == "total" && n.days == null) 7 else n.days)
            }
            if (t.kind == "post") {
                n = n.copy(kind = AdsKind.post)
                d = n
                d = d.copy(post = AdsMedia.of(t.mediaId, t.caption, t.thumb, t.permalink))
            } else {
                val list = t.photos.mapIndexed { i, ph -> AdsPhoto("from$i${ph.hash}", hash = ph.hash, url = ph.url, thumb = ph.url, headline = ph.headline, link = ph.link) }
                d = n.copy(
                    kind = AdsKind.photos, photos = list,
                    vertical = t.vertical?.let { AdsPhoto("vertical", hash = it.hash, url = it.url, thumb = it.url) },
                )
            }
            notice = "Started from “${t.name}”: change anything, then make it."
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = "Couldn't copy that ad: ${adsWords(e)}"
        }
    }

    /** Once: the house's link, the last audience and budget, then `?studio=`, `?from=` or `?piece=`. */
    suspend fun begin() {
        val l = lists ?: return
        if (started) return
        started = true
        var n = d
        if (n.link.isEmpty()) n = n.copy(link = l.website)
        AdsLastChoice.read()?.let { last ->
            last.audience?.let { if (it.places.isNotEmpty()) n = n.copy(audience = it) }
            last.amount?.let { if (it > 0) n = n.copy(amount = AdsAmount.field(it)) }
            last.budgetKind?.let { if (it == "daily" || it == "total") n = n.copy(budgetKind = it) }
            if (last.hasDays) n = n.copy(days = last.days)
            if (n.budgetKind == "total" && n.days == null) n = n.copy(days = 7)
            last.goal?.let { g -> if (l.goal(g)?.newAd == true) n = n.copy(goalKey = g) }
        }
        d = n
        val studio = AdsQuery.value("studio", path)?.let { AdsStudioHandoffs.ads.remove(it) }
        val from = AdsQuery.value("from", path)
        val piece = AdsQuery.value("piece", path)
        if (studio != null) {
            val c = Container(studio)
            val photos = (studio["photos"] as? List<*>).orEmpty().mapIndexedNotNull { i, p ->
                val pc = Container((p as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: return@mapIndexedNotNull null)
                AdsPhoto("studio-$i", hash = pc.string("hash", ""), url = pc.string("url", ""), thumb = pc.string("url", ""), headline = pc.string("headline", ""), link = pc.string("link", ""))
            }
            val v = Container(studio.obj("vertical") ?: emptyMap())
            d = d.copy(
                kind = AdsKind.photos, photos = photos,
                vertical = if (v.string("hash", "").isNotEmpty()) AdsPhoto("studio-vertical", hash = v.string("hash", ""), url = v.string("url", ""), thumb = v.string("url", "")) else null,
                text = c.string("text", ""), headline = c.string("headline", ""), link = c.string("link", ""), goalKey = c.string("goal", "whatsapp"),
            )
        } else if (from != null) {
            startFrom(from)
        } else if (piece != null && l.sitePieces) {
            d = d.copy(kind = AdsKind.site)
            loadPieces()
            pieces?.firstOrNull { it.id == piece }?.let { addPiece(it) }
        }
        d = d.fitGoal(l)
    }

    suspend fun load(fresh: Boolean = false) {
        try {
            val s = backend.status(fresh)
            status = s
            problem = null
            if (s.ready && lists == null) lists = backend.newAdLists()
            if (s.ready) begin()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    LaunchedEffect(mayUse) { if (mayUse && status == null) load() }
    // What the chosen source needs read: the Instagram posts, or the website's pieces.
    LaunchedEffect(d.kind, lists != null) {
        if (status?.ready != true || lists == null) return@LaunchedEffect
        if (d.kind == AdsKind.post && media == null && !mediaBusy) loadMedia(null)
        if (d.kind == AdsKind.site && pieces == null) loadPieces()
        if (d.kind == AdsKind.catalog && d.catalog.catalogs == null) {
            try {
                val list = backend.catalogs()
                d = d.copy(catalog = d.catalog.copy(catalogs = list, problem = null, catalogId = if (d.catalog.catalogId.isEmpty() && list.size == 1) list[0].id else d.catalog.catalogId))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                d = d.copy(catalog = d.catalog.copy(problem = adsWords(e)))
            }
        }
    }
    // A catalogue's sets once it is chosen; the biggest is the default (the server sorts them).
    LaunchedEffect(d.catalog.catalogId) {
        val id = d.catalog.catalogId
        if (id.isEmpty()) return@LaunchedEffect
        d = d.copy(catalog = d.catalog.copy(sets = null, setId = ""))
        try {
            val list = backend.catalogSets(id)
            if (d.catalog.catalogId == id) d = d.copy(catalog = d.catalog.copy(sets = list, setId = list.firstOrNull()?.id ?: ""))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            d = d.copy(catalog = d.catalog.copy(problem = adsWords(e)))
        }
    }
    // "Online orders" says what the pixel recorded this week; the channel goal opens the shop's channel; orders go where
    // the checkout is (the online shop when the house has one).
    LaunchedEffect(d.goalKey, lists != null) {
        val l = lists ?: return@LaunchedEffect
        if (d.goalKey == "channel" && !AdsNewAdWords.isChannelLink(d.link) && l.waChannel.isNotEmpty()) d = d.copy(link = l.waChannel)
        if (d.goalKey == "sales") {
            val shop = l.shop.ifEmpty { l.website }
            val trimmed = d.link.trim()
            if (shop.isNotEmpty() && (trimmed.isEmpty() || d.link == l.website || AdsNewAdWords.isChannelLink(d.link))) d = d.copy(link = shop)
            if (pixel == null) pixel = try { backend.pixel().state } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        }
    }
    LaunchedEffect(d.kind) { lists?.let { d = d.fitGoal(it) } }

    // MARK: Photos

    /** Photos picked on this phone: each made a JPEG of at most 2048 px and sent to /api/ads/images, side by side. */
    fun pickPhotos() {
        val activity = Foreground.activity
        val launchers = Foreground.launchers
        if (activity == null || launchers == null) { failure = "Photos can't open here."; return }
        val room = maxOf(0, AdsNewAdDraft.MAX_PHOTOS - d.photos.size)
        if (room == 0) return
        scope.launch {
            val result = try {
                launchers.intent(Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "Photos couldn't open."
                return@launch
            }
            if (result.resultCode != Activity.RESULT_OK) return@launch
            val data = result.data
            val uris = buildList {
                data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) add(clip.getItemAt(i).uri) }
                if (isEmpty()) data?.data?.let { add(it) }
            }.take(room)
            for (uri in uris) {
                val key = UUID.randomUUID().toString()
                d = d.copy(photos = d.photos + AdsPhoto(key, uploading = true))
                scope.launch {
                    val coded = AdsPhotoCodec.read(activity, uri)
                    if (coded == null) {
                        updatePhoto(key) { it.copy(uploading = false, error = "Couldn't read that photo. Try another.") }
                        return@launch
                    }
                    updatePhoto(key) { it.copy(preview = coded.thumbnail) }
                    try {
                        val a = backend.upload(coded.jpeg)
                        updatePhoto(key) { it.copy(hash = a.hash, url = a.url, uploading = false) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        val message = adsWords(e)
                        updatePhoto(key) { it.copy(uploading = false, error = message) }
                    }
                }
            }
        }
    }

    /** A video from this phone, sent to Meta in the pieces it asks for, then waited on until Meta has a cover for it. */
    fun pickVideo() {
        val activity = Foreground.activity
        val launchers = Foreground.launchers
        if (activity == null || launchers == null) { failure = "Videos can't open here."; return }
        scope.launch {
            val result = try {
                launchers.intent(Intent(Intent.ACTION_GET_CONTENT).setType("video/*").addCategory(Intent.CATEGORY_OPENABLE))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "Videos couldn't open."
                return@launch
            }
            val uri = result.data?.data
            if (result.resultCode != Activity.RESULT_OK || uri == null) return@launch
            val source = try {
                AdsUriVideo(context, uri)
            } catch (e: Exception) {
                null
            }
            if (source == null || source.size <= 0) {
                failure = "Couldn't read that video. Try another, or save it to the phone first."
                return@launch
            }
            val name = "Video ${ShopDate.stamp(AppClock.now(), withTime = true)}"
            d = d.copy(video = AdsVideoDraft(name))
            AdsVideoUpload.send(source, name, backend, progress = { draft -> d = d.copy(video = draft) })
        }
    }

    fun move(key: String, by: Int) {
        val i = d.photos.indexOfFirst { it.key == key }
        if (i < 0) return
        val j = (i + by).coerceIn(0, d.photos.size - 1)
        if (i == j) return
        val list = d.photos.toMutableList()
        val p = list.removeAt(i)
        list.add(j, p)
        d = d.copy(photos = list)
    }

    // MARK: Preview, check, make

    fun showPreview() {
        scope.launch {
            previewBusy = true
            previewError = null
            try {
                val list = backend.preview(d.plan(AppClock.now()))
                if (list.isEmpty()) previewError = "Meta gave no preview." else previewSet = list
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                previewError = adsWords(e)
            } finally {
                previewBusy = false
            }
        }
    }

    /** The server's word first: what stops it, else what it will do and cost, for the counter to agree to. */
    fun review() {
        scope.launch {
            checking = true
            try {
                val c = backend.checkPlan(d.plan(AppClock.now()))
                check = c
                if (c.problems.isEmpty()) confirming = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = adsWords(e)
            } finally {
                checking = false
            }
        }
    }

    fun send() {
        val c = check ?: return
        scope.launch {
            sending = true
            val p = LinkedHashMap(d.plan(AppClock.now()))
            p["name"] = c.name
            try {
                val m = backend.create(p)
                AdsLastChoice.keep(d.audience, AdsAmount.parse(d.amount) ?: 0.0, d.budgetKind, d.days, d.goalKey)
                AdsChanges.bump()
                made = m
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = "The ad wasn't made. ${adsWords(e)}"
            } finally {
                sending = false
            }
        }
    }

    fun again() {
        made = null
        // The next ad starts paused again, as every new ad does; the last one's previews and errors go.
        d = d.copy(
            post = null, photos = emptyList(), vertical = null, text = "", headline = "", name = "", launch = "paused",
            video = null, partnerCode = "", partnerCheck = null,
        )
        check = null
        notice = null
        previewError = null
        previewSet = null
        mediaError = null
        failure = null
    }

    // MARK: The page

    val s0 = status
    val l0 = lists
    val m0 = made
    when {
        !mayUse -> AdsOwnersOnly()
        m0 != null -> MadeView(m0, ::again)
        s0 != null && s0.ready && l0 != null -> NewAdForm(
            s = s0, l = l0, d = d, onDraft = { d = it }, notice = notice, goal = goal, currency = currency,
            media = media, mediaAfter = mediaAfter, mediaBusy = mediaBusy, mediaError = mediaError,
            onMoreMedia = { scope.launch { loadMedia(mediaAfter) } }, onRetryMedia = { scope.launch { loadMedia(null) } },
            pieces = pieces, piecesError = piecesError, pieceQ = pieceQ, onPieceQ = { pieceQ = it }, onPiece = { scope.launch { addPiece(it) } },
            pixel = pixel,
            onPick = ::pickPhotos, onPickVideo = ::pickVideo, onLibrary = { libraryOpen = true }, onMove = ::move,
            onChangePhoto = { p -> updatePhoto(p.key) { p } },
            onAudience = { editingAudience = true },
            previewBusy = previewBusy, previewError = previewError, onPreview = ::showPreview,
            check = check, checking = checking, sending = sending, onReview = ::review,
        )
        else -> AdsNotReady(status, problem) { scope.launch { load(fresh = true) } }
    }

    // MARK: Dialogs and sheets

    if (confirming) {
        AdsConfirm(
            title = if (d.launch == "live") "Put this ad live?" else "Make this ad?",
            message = d.confirmText(check, lists, AppClock.now()),
            confirm = if (d.launch == "live") "Put it live" else "Make it, paused",
            cancel = "Not yet",
            onDismiss = { confirming = false },
            onConfirm = { send() },
        )
    }
    FailureAlert(failure, { failure = null }, "That didn't work")
    if (editingAudience) {
        AdsAudienceSheet(
            title = "Who sees it", draft = d.audience, goal = goal?.optimization ?: "REACH", positions = lists?.igPositions ?: emptyList(),
            onDismiss = { editingAudience = false },
        ) { a -> d = d.copy(audience = a) }
    }
    if (libraryOpen) {
        AdsLibrarySheet(
            chosen = d.photos.map { it.hash }.toSet(), room = maxOf(0, AdsNewAdDraft.MAX_PHOTOS - d.photos.size), onDismiss = { libraryOpen = false },
        ) { img ->
            if (d.photos.size < AdsNewAdDraft.MAX_PHOTOS && d.photos.none { it.hash == img.hash }) {
                d = d.copy(photos = d.photos + AdsPhoto("lib${img.hash}", hash = img.hash, url = img.url, thumb = img.thumb))
            }
        }
    }
    previewSet?.let { AdsPreviewSheet(it, onDismiss = { previewSet = null }) }
}

@Composable
private fun NewAdForm(
    s: AdsStatusAnswer,
    l: AdsNewAdLists,
    d: AdsNewAdDraft,
    onDraft: (AdsNewAdDraft) -> Unit,
    notice: String?,
    goal: AdsGoal?,
    currency: String,
    media: List<AdsMedia>?,
    mediaAfter: String?,
    mediaBusy: Boolean,
    mediaError: String?,
    onMoreMedia: () -> Unit,
    onRetryMedia: () -> Unit,
    pieces: List<AdsSitePiece>?,
    piecesError: String?,
    pieceQ: String,
    onPieceQ: (String) -> Unit,
    onPiece: (AdsSitePiece) -> Unit,
    pixel: AdsPixelState?,
    onPick: () -> Unit,
    onPickVideo: () -> Unit,
    onLibrary: () -> Unit,
    onMove: (String, Int) -> Unit,
    onChangePhoto: (AdsPhoto) -> Unit,
    onAudience: () -> Unit,
    previewBusy: Boolean,
    previewError: String?,
    onPreview: () -> Unit,
    check: AdsPlanCheck?,
    checking: Boolean,
    sending: Boolean,
    onReview: () -> Unit,
) {
    val now = AppClock.now()
    AdsPage {
        AdsAlertsSection(s)
        notice?.let { n ->
            AdsSection(null) { AdsWarningRow(n, Tone.quiet, Icons.Filled.Info) }
        }
        AdsTwoPane(
            left = {
                PromoteSections(s, l, d, onDraft, goal, media, mediaAfter, mediaBusy, mediaError, onMoreMedia, onRetryMedia, pieces, piecesError, pieceQ, onPieceQ, onPiece, onPick, onPickVideo, onLibrary, onMove, onChangePhoto)
                GoalSection(l, d, onDraft, s, pixel)
                if (!d.asIs) WordsSection(l, d, onDraft, goal)
            },
            right = {
                AudienceSection(d, onAudience)
                BudgetSection(d, onDraft, s, currency)
                AdsAdvancedSection(
                    d.advanced, { onDraft(d.copy(advanced = it)) },
                    needsTotal = { onDraft(d.copy(budgetKind = "total", days = d.days ?: 7)) },
                    sales = d.goalKey == "sales", currency = s.currency,
                )
                QuietSection(l, d, now)
                PreviewSection(d, previewBusy, previewError, onPreview)
                MakeSections(d, onDraft, check, checking, sending, onReview)
            },
        )
    }
}

// MARK: 1 · What to promote

@Composable
private fun PromoteSections(
    s: AdsStatusAnswer,
    l: AdsNewAdLists,
    d: AdsNewAdDraft,
    onDraft: (AdsNewAdDraft) -> Unit,
    goal: AdsGoal?,
    media: List<AdsMedia>?,
    mediaAfter: String?,
    mediaBusy: Boolean,
    mediaError: String?,
    onMoreMedia: () -> Unit,
    onRetryMedia: () -> Unit,
    pieces: List<AdsSitePiece>?,
    piecesError: String?,
    pieceQ: String,
    onPieceQ: (String) -> Unit,
    onPiece: (AdsSitePiece) -> Unit,
    onPick: () -> Unit,
    onPickVideo: () -> Unit,
    onLibrary: () -> Unit,
    onMove: (String, Int) -> Unit,
    onChangePhoto: (AdsPhoto) -> Unit,
) {
    AdsSection(
        "1 · What to promote",
        footer = { s.settings?.instagramUsername?.let { Text("It runs as @$it.") } },
    ) {
        AdsRow {
            AdsChips {
                FilterChip("A post", d.kind == AdsKind.post, { onDraft(d.copy(kind = AdsKind.post)) })
                FilterChip("New photos", d.kind == AdsKind.photos, { onDraft(d.copy(kind = AdsKind.photos)) })
                if (l.sitePieces) FilterChip("Website piece", d.kind == AdsKind.site, { onDraft(d.copy(kind = AdsKind.site)) })
                FilterChip("New video", d.kind == AdsKind.video, { onDraft(d.copy(kind = AdsKind.video)) })
                FilterChip("A creator's post", d.kind == AdsKind.partner, { onDraft(d.copy(kind = AdsKind.partner)) })
                if (!(l.shop.isEmpty() && l.website.isEmpty())) FilterChip("Catalogue", d.kind == AdsKind.catalog, { onDraft(d.copy(kind = AdsKind.catalog)) })
            }
        }
    }
    when (d.kind) {
        AdsKind.post -> PostSection(d, onDraft, media, mediaAfter, mediaBusy, mediaError, onMoreMedia, onRetryMedia)
        AdsKind.photos -> PhotosSection(d, onDraft, goal, onPick, onLibrary, onMove, onChangePhoto)
        AdsKind.site -> {
            SiteSection(d, pieces, piecesError, pieceQ, onPieceQ, onPiece)
            if (d.photos.isNotEmpty()) PhotosSection(d, onDraft, goal, onPick, onLibrary, onMove, onChangePhoto)
        }
        AdsKind.video -> AdsVideoSection(d.video, onPickVideo)
        AdsKind.partner -> AdsPartnerSection(
            code = d.partnerCode, onCode = { onDraft(d.copy(partnerCode = it)) },
            checked = d.partnerCheck, onChecked = { onDraft(d.copy(partnerCheck = it)) },
            link = d.link, onLink = { onDraft(d.copy(link = it)) }, button = d.button, onButton = { onDraft(d.copy(button = it)) },
            toSite = goal?.toSite ?: false, buttons = l.buttons,
        )
        AdsKind.catalog -> AdsCatalogSection(d.catalog) { onDraft(d.copy(catalog = it)) }
    }
}

@Composable
private fun PostSection(
    d: AdsNewAdDraft,
    onDraft: (AdsNewAdDraft) -> Unit,
    media: List<AdsMedia>?,
    mediaAfter: String?,
    mediaBusy: Boolean,
    mediaError: String?,
    onMoreMedia: () -> Unit,
    onRetryMedia: () -> Unit,
) {
    AdsSection(null, footer = { Text("The post runs as it is: its photo, caption, likes and comments. Tap one.") }, divided = false) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (mediaError != null) {
                AdsWarningRow(mediaError, Tone.problem)
                AdsTonalButton("Try again", onRetryMedia)
            }
            val post = d.post
            if (post != null && (media ?: emptyList()).none { it.id == post.id }) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    erp.app.screens.stock.StockImage(post.thumb, "Post", post.id, Modifier.size(56.dp).clip(Radius.thumbShape))
                    Text("The post of the ad this started from", style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (media != null) {
                AdsMediaGrid(media, d.post?.id) { m -> onDraft(d.copy(post = if (d.post?.id == m.id) null else m)) }
                if (mediaAfter != null) AdsTonalButton(if (mediaBusy) "Reading…" else "Older posts", onMoreMedia, enabled = !mediaBusy)
            } else if (mediaError == null) {
                AdsReading("Reading Instagram…")
            }
            if (post != null) {
                Text(
                    post.caption.ifEmpty { "No caption." }, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3,
                )
            }
        }
    }
}

@Composable
private fun PhotosSection(
    d: AdsNewAdDraft,
    onDraft: (AdsNewAdDraft) -> Unit,
    goal: AdsGoal?,
    onPick: () -> Unit,
    onLibrary: () -> Unit,
    onMove: (String, Int) -> Unit,
    onChangePhoto: (AdsPhoto) -> Unit,
) {
    val note = (if (d.photos.size > 1) "${d.photos.size} photos make a carousel, in this order." else "One photo, or up to ten for a carousel.") +
        " Meta is told not to retouch, crop, animate or re-word anything."
    AdsSection(if (d.kind == AdsKind.site) "The pieces" else "The photos", footer = { Text(note) }) {
        for (p in d.photos) {
            AdsPhotoRow(
                photo = p, carousel = d.photos.size > 1, ownLinks = goal?.toSite == true,
                first = d.photos.firstOrNull()?.key == p.key, last = d.photos.lastOrNull()?.key == p.key,
                change = onChangePhoto, move = { onMove(p.key, it) },
                remove = { onDraft(d.copy(photos = d.photos.filter { it.key != p.key })) },
            )
        }
        if (d.kind == AdsKind.photos && d.photos.size < AdsNewAdDraft.MAX_PHOTOS) {
            AdsRow {
                AdsChips {
                    AdsTonalButton(if (d.photos.isEmpty()) "From this phone" else "Add more", onPick, icon = Icons.Filled.AddPhotoAlternate)
                    AdsTonalButton("Ad account photos", onLibrary, icon = Icons.Filled.PhotoLibrary)
                }
            }
        }
        val v = d.vertical
        if (v != null && d.readyPhotos.size == 1) {
            Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                erp.app.screens.stock.StockImage(v.thumb ?: v.url, "Story size", v.key, Modifier.size(width = 32.dp, height = 56.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp)))
                Text("With its 9:16 version for stories, reels and WhatsApp Status: one ad, each place its own size.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                IconButton(onClick = { onDraft(d.copy(vertical = null)) }) { Icon(Icons.Filled.Cancel, "Drop the story size", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/** The website's pieces, new arrivals first; a search reaches the rest. */
fun adsShownPieces(all: List<AdsSitePiece>, q: String): List<AdsSitePiece> {
    val words = q.lowercase().split(' ').filter { it.isNotEmpty() }
    val hits = all.filter { p ->
        val hay = "${p.name} ${p.collection} ${p.facts.joinToString(" ")}".lowercase()
        words.all { hay.contains(it) }
    }
    val ordered = if (words.isEmpty()) hits.filter { it.newArrival } + hits.filter { !it.newArrival } else hits
    return ordered.take(30)
}

@Composable
private fun SiteSection(d: AdsNewAdDraft, pieces: List<AdsSitePiece>?, piecesError: String?, pieceQ: String, onPieceQ: (String) -> Unit, onPiece: (AdsSitePiece) -> Unit) {
    AdsSection(null, footer = { Text("Each piece is added as a photo below (several make a carousel), with its own link.") }, divided = false) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                pieceQ, onPieceQ, Modifier.fillMaxWidth(), placeholder = { Text("Search the website: ruby, kara, jhumka…") }, singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            )
            if (piecesError != null) AdsWarningRow(piecesError, Tone.problem)
            else if (pieces != null) AdsPieceGrid(adsShownPieces(pieces, pieceQ), full = d.photos.size >= AdsNewAdDraft.MAX_PHOTOS, pick = onPiece)
            else AdsReading("Reading the website…")
        }
    }
}

// MARK: 2 · What it's for

@Composable
private fun GoalSection(l: AdsNewAdLists, d: AdsNewAdDraft, onDraft: (AdsNewAdDraft) -> Unit, s: AdsStatusAnswer, pixel: AdsPixelState?) {
    AdsSection("2 · What it's for", footer = { GoalNote(d, s, pixel) }) {
        for (g in d.offered(l)) AdsGoalRow(g, g.key == d.goalKey) { onDraft(d.copy(goalKey = g.key)) }
    }
}

@Composable
private fun GoalNote(d: AdsNewAdDraft, s: AdsStatusAnswer, pixel: AdsPixelState?) {
    when (d.goalKey) {
        "whatsapp", "messages" -> {
            val opens = if (s.settings?.whatsappGreeting == null) "a hello" else "the message set on Setup"
            var line = "Needs a WhatsApp number linked to the Facebook Page. The chat opens with $opens and three tap-to-ask questions."
            if (d.goalKey == "messages") line += " Someone who lives in Instagram gets Instagram Direct instead: answer both."
            Text(line)
        }
        "sales" -> {
            var line = "Reading what the pixel recorded this week…"
            var warn = false
            if (s.settings?.pixelId == null) {
                line = "Choose the website's pixel on Setup first: Meta counts orders through it."
                warn = true
            } else if (pixel != null) {
                val site = pixel.site ?: "the site"
                val n = pixel.purchases
                if (n != null) {
                    if (n == 0.0) {
                        line = "The pixel recorded no order this week, so Meta has nothing to learn from yet: \"Website visits\" buys better until orders come through $site."
                        warn = true
                    } else if (n < 50) {
                        line = "The pixel recorded ${AdsFormat.count(n)} order${if (n == 1.0) "" else "s"} this week. Meta learns from about 50 a week, so the ad set may stay in learning: run it two weeks without edits and judge it by cost per order."
                    } else {
                        line = "The pixel recorded ${AdsFormat.count(n)} orders this week: enough for Meta to learn from."
                    }
                } else {
                    line = "Meta didn't say what the pixel recorded this week."
                }
            }
            Text(line, color = if (warn) Tone.owed.color() else androidx.compose.material3.LocalContentColor.current)
        }
        "channel" -> Text("Meta has no \"follow a channel\" goal yet, so this is a link ad to the channel: it buys taps on the link; follows show in WhatsApp, not here.")
    }
}

// MARK: 3 · The words

@Composable
private fun WordsSection(l: AdsNewAdLists, d: AdsNewAdDraft, onDraft: (AdsNewAdDraft) -> Unit, goal: AdsGoal?) {
    AdsSection("3 · The words", divided = false) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                d.text, { onDraft(d.copy(text = it)) }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 8,
                placeholder = { Text("What the ad says: the piece, its weight, why it's special.") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            )
            OutlinedTextField(d.headline, { onDraft(d.copy(headline = it)) }, Modifier.fillMaxWidth(), placeholder = { Text("Headline (short)") }, singleLine = true)
            if (d.goalKey == "channel") {
                OutlinedTextField(
                    d.link, { onDraft(d.copy(link = it)) }, Modifier.fillMaxWidth(), placeholder = { Text("https://whatsapp.com/channel/…") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                )
            }
            if (goal?.toSite == true) {
                OutlinedTextField(
                    d.link, { onDraft(d.copy(link = it)) }, Modifier.fillMaxWidth(), placeholder = { Text("https://… the page the button opens") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                )
            }
        }
        if (goal?.toSite == true) PickerRow("Button", d.button, l.buttons.map { it.key to it.label }) { onDraft(d.copy(button = it)) }
    }
}

// MARK: Who sees it

@Composable
private fun AudienceSection(d: AdsNewAdDraft, onAudience: () -> Unit) {
    AdsSection(
        "${d.step(4)} · Who sees it",
        footer = { if (d.audience.places.isEmpty()) Text("Choose where the ad shows.", color = Tone.problem.color()) },
    ) {
        Row(Modifier.fillMaxWidth().clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onAudience).ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Who sees it", style = MaterialTheme.typography.bodyLarge)
                Text(d.audience.words, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// MARK: Budget and dates

@Composable
private fun BudgetSection(d: AdsNewAdDraft, onDraft: (AdsNewAdDraft) -> Unit, s: AdsStatusAnswer, currency: String) {
    AdsSection("${d.step(5)} · Budget and dates (${s.currency})", footer = { Text(d.budgetNote(s.currency, s.account?.minDailyBudget)) }) {
        AdsRow {
            AdsChips {
                FilterChip("Per day", d.budgetKind == "daily", { onDraft(d.copy(budgetKind = "daily")) })
                FilterChip("In total", d.budgetKind == "total", { onDraft(d.copy(budgetKind = "total", days = d.days ?: 7)) })
            }
        }
        ValueRow(if (d.budgetKind == "daily") "A day" else "In total") {
            ValueInput(d.amount, { onDraft(d.copy(amount = it)) }, prompt = "Amount", label = "Amount", keyboard = KeyboardType.Decimal)
        }
        AdsRow {
            AdsChips {
                for (v in d.quickAmounts) FilterChip(AdsFormat.money(v, s.currency), AdsAmount.parse(d.amount) == v, { onDraft(d.copy(amount = AdsAmount.field(v))) })
            }
        }
        val options = listOf(3, 7, 14, 30).map { it.toString() to "$it days" } + (if (d.budgetKind == "daily") listOf("0" to "Until I stop it") else emptyList())
        PickerRow("How long", (d.days ?: 0).toString(), options) { v -> onDraft(d.copy(days = v.toInt().takeIf { it > 0 })) }
        ToggleRow("Start later", d.startLater, { onDraft(d.copy(startLater = it)) })
        if (d.startLater) AdsDayTimeRow("Starts", d.start, min = AppClock.now()) { onDraft(d.copy(start = it)) }
    }
}

@Composable
private fun QuietSection(l: AdsNewAdLists, d: AdsNewAdDraft, now: Instant) {
    val q = d.quietInRange(l, now)
    if (q.isEmpty()) return
    AdsSection(
        null,
        header = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.EventBusy, null, Modifier.size(20.dp), tint = ErpColors.accent)
                Text(
                    if (d.days == null) "Left running, it would reach days kept free of product ads" else "It would run through days kept free of product ads",
                    style = MaterialTheme.typography.titleSmall,
                )
            }
        },
        footer = { Text("End it before, or start after. Ads → Studio → Guide has the calendar.") },
    ) {
        for (day in q.take(6)) {
            AdsRow(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${ShopDate.say(day.date)} · ${day.hijri}", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium))
                Text(day.name + if (day.near) " (the days before)" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (q.size > 6) AdsRow { Text("…and ${q.size - 6} more.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

// MARK: Preview and make it

@Composable
private fun PreviewSection(d: AdsNewAdDraft, busy: Boolean, error: String?, onPreview: () -> Unit) {
    AdsSection("${d.step(6)} · Preview") {
        AdsActionRow(
            if (busy) "Asking Meta…" else "See it as Instagram will show it", onPreview, icon = Icons.Filled.Visibility, busy = busy,
            enabled = !busy && d.previewable,
        )
        if (error != null) AdsRow { Text(error, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
    }
}

@Composable
private fun MakeSections(d: AdsNewAdDraft, onDraft: (AdsNewAdDraft) -> Unit, check: AdsPlanCheck?, checking: Boolean, sending: Boolean, onReview: () -> Unit) {
    AdsSection(
        "${d.step(7)} · Make it",
        footer = {
            Text(
                if (d.launch == "paused") "Look it over in Campaigns and switch it on there: nothing is spent until then."
                else "It starts once Meta approves it (usually within the hour) and spends its budget from then.",
            )
        },
    ) {
        AdsRow {
            OutlinedTextField(d.name, { onDraft(d.copy(name = it)) }, Modifier.fillMaxWidth(), placeholder = { Text("Name in Ads Manager (made for you)") }, singleLine = true)
        }
        AdsRow {
            AdsChips {
                FilterChip("Save it paused", d.launch == "paused", { onDraft(d.copy(launch = "paused")) })
                FilterChip("Put it live", d.launch == "live", { onDraft(d.copy(launch = "live")) })
            }
        }
    }
    AdsProblemsSection(check?.problems ?: emptyList())
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AdsProminentButton(
            if (d.launch == "live") "Review and put it live" else "Review and make it, paused", onReview,
            Modifier.fillMaxWidth(), enabled = !(checking || sending || d.stillUploading), busy = checking || sending,
        )
        if (d.stillUploading) Text(if (d.kind == AdsKind.video) "Wait for the video to reach Meta." else "Wait for the photos to reach Meta.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Made

@Composable
private fun MadeView(m: AdsMade, again: () -> Unit) {
    AdsPage {
        AdsSection(null) {
            Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.CheckCircle, null, Modifier.size(40.dp), tint = Tone.settled.color())
                Text(if (m.live) "The ad is on its way" else "The ad is made, paused", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (m.live) "Meta reviews every ad first (usually within the hour); it starts as soon as it is approved."
                    else "Nothing is spent until it is switched on in Campaigns.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
                )
                for (w in m.warnings) Text(w, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color(), textAlign = TextAlign.Center)
            }
        }
        AdsSection(null) {
            AdsLink("See it in Campaigns", Icons.Filled.Checklist, "/ads/campaigns")
            AdsLink("Test it on another audience", Icons.Filled.Layers, AdsNewAdDraft.adSetPath(m), "The same ad in more ad sets, side by side")
            AdsActionRow("Make another", again, icon = Icons.Filled.Add)
        }
    }
}
