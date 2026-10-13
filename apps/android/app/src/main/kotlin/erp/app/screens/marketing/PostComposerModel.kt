package erp.app.screens.marketing

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import erp.app.config.House
import erp.app.data.ErpApi
import java.io.File
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A piece handed over by another screen (the Studio's "Use it") to open in Post a piece: `?studio=<key>` on the path. */
object PostHandoffs {
    val posts: MutableMap<String, PostDraft> = HashMap()
}

/** An AI tool asked for (NativePostAIRequest): the operation, what it makes, and the photo it works on (null: the lead photo). */
class PostAIRequest(val op: String, val target: String, val photoID: String?) {
    val id: String = UUID.randomUUID().toString()
}

/**
 * The state and moves of Post a piece (PostComposerModel.swift): the draft being made, the drafts kept on the device,
 * what the website, WhatsApp and Instagram say about themselves, the two designs drawn by the engine, the AI's work and
 * the finish (queue, upload, send). Every route is the web's own (`/api/website/post*`); the sending is the server's.
 */
class PostComposerModel(
    private val scope: CoroutineScope,
    val artwork: DesignEngine,
    /** The folder this person's drafts are kept in; null before there is one to keep them for. */
    private val folderFor: () -> File?,
) {
    private var _draft by mutableStateOf(PostDraft())
    var draft: PostDraft
        get() = _draft
        set(v) { _draft = v; changed() }

    var drafts by mutableStateOf<List<PostDraft>>(emptyList())
    var loaded by mutableStateOf(false)
    var config by mutableStateOf(MarketingValue.NULL)
    var folders by mutableStateOf<List<MarketingValue>>(emptyList())
    var audience by mutableStateOf(MarketingValue.NULL)
    var instagram by mutableStateOf(MarketingValue.NULL)
    var health by mutableStateOf(MarketingValue.NULL)
    var aiAnswer by mutableStateOf(MarketingValue.NULL)
    var storyPreview by mutableStateOf(MarketingValue.NULL)
    var squarePreview by mutableStateOf(MarketingValue.NULL)
    var busy by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var said by mutableStateOf<String?>(null)
    var queueEntry by mutableStateOf<PostQueueEntry?>(null)

    private var disk: PostDraftDisk? = null
    private var saving: Job? = null

    // MARK: What the draft says

    fun update(f: (PostDraft) -> PostDraft) { draft = f(draft) }
    fun word(key: String, value: Any?) = update { it.word(key, value) }

    val assets: Map<String, ByteArray> get() = draft.photos.associate { it.id to it.data }
    val hero: PostPhoto? get() = PostComposerRules.hero(draft)
    val fields: Map<String, String> get() = PostComposerRules.fields(draft.words)
    val validWeight: String get() = PostComposerRules.validWeight(draft.words)
    val makeSquare: Boolean get() = PostComposerRules.makeSquare(draft.words)
    val makeStory: Boolean get() = PostComposerRules.makeStory(draft.words)
    val sitePhotos: List<PostPhoto> get() = PostComposerRules.sitePhotos(draft)
    val waPhotos: List<PostPhoto> get() = PostComposerRules.waPhotos(draft)
    val instagramConnected: Boolean get() = instagram["connected"].bool
    val siteOn: Boolean get() = PostComposerRules.siteOn(draft)
    val waKeys: List<String> get() = PostComposerRules.waKeys(draft)
    val igOn: Boolean get() = PostComposerRules.igOn(draft, instagramConnected)
    val manualStory: Boolean get() = PostComposerRules.manualStory(draft, instagramConnected)
    val frozen: Boolean get() = draft.queuedID != null
    val problems: List<String> get() = PostComposerRules.problems(draft, instagramConnected)

    // MARK: Loading

    suspend fun load() {
        if (loaded) return
        val folder = folderFor()
        if (folder != null) {
            val storage = PostDraftDisk(folder)
            disk = storage
            try {
                val list = withContext(Dispatchers.IO) { storage.list() }
                drafts = list
                list.firstOrNull()?.let { _draft = it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "Drafts could not be read: ${e.message}"
            }
        }
        loaded = true
        if (House.isDemo) {
            config = MarketingValue.of(mapOf("siteName" to "Demo website", "posting" to mapOf("metal" to "", "whatsappNumbers" to emptyList<Any>())))
            return
        }
        refreshConnections()
    }

    suspend fun refreshConnections() {
        coroutineScope {
            val c = async { runCatching { MarketingRequest.get("/api/app/website") } }
            val f = async { runCatching { MarketingRequest.get("/api/website/photos") } }
            val a = async { runCatching { MarketingRequest.get("/api/website/post") } }
            val i = async { runCatching { MarketingRequest.get("/api/instagram/status") } }
            c.await().onSuccess {
                config = it
                if (draft.words.s("metal").isEmpty()) word("metal", config["posting"]["metal"])
                if (drafts.isEmpty()) word("toWebsite", config.s("site").isNotEmpty())
            }.onFailure { say(it) }
            f.await().onSuccess { folders = it["collections"].array }.onFailure { say(it) }
            a.await().onSuccess {
                audience = it
                if (drafts.isEmpty()) {
                    word("toWhatsApp", !audience["community"].isNull)
                    val first = audience["groups"].array.take(1).map { g -> g["key"] }
                    word("waTargets", MarketingValue.array(first + (if (!audience["channel"].isNull) listOf(MarketingValue.string("channel")) else emptyList())))
                }
            }.onFailure { say(it) }
            i.await().onSuccess {
                instagram = it
                if (drafts.isEmpty()) word("toInstagram", instagram["connected"])
            }.onFailure { say(it) }
        }
        checkHealth()
    }

    suspend fun checkHealth() {
        try {
            health = MarketingRequest.get("/api/website/post/health?fresh=1")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e)
        }
    }

    private fun say(e: Throwable) {
        if (e is CancellationException) return
        error = e.message ?: "Something went wrong."
    }

    // MARK: Drafts

    private fun changed() {
        if (!loaded) return
        val snapshot = _draft.copy(updated = System.currentTimeMillis())
        saving?.cancel()
        saving = scope.launch {
            try {
                delay(600)
                withContext(Dispatchers.IO) { disk?.save(snapshot) }
                refreshDrafts()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "Draft could not be saved: ${e.message}"
            }
        }
    }

    suspend fun saveNow() {
        saving?.cancel()
        try {
            val snapshot = _draft.copy(updated = System.currentTimeMillis())
            withContext(Dispatchers.IO) { disk?.save(snapshot) }
            refreshDrafts()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    suspend fun refreshDrafts() {
        val list = withContext(Dispatchers.IO) { runCatching { disk?.list() }.getOrNull() }
        if (list != null) drafts = list
    }

    /** A new piece keeps the metal, formats, destinations and collection of the last. */
    suspend fun startOver() {
        saveNow()
        var next = PostDraft()
        for (key in listOf("metal", "formats", "toWebsite", "toWhatsApp", "toInstagram", "waTargets", "folder")) next = next.word(key, draft.words[key])
        _draft = next
        said = null
        queueEntry = null
        changed()
    }

    suspend fun open(saved: PostDraft) {
        saveNow()
        _draft = saved
        queueEntry = null
    }

    suspend fun remove(saved: PostDraft) {
        try {
            withContext(Dispatchers.IO) { disk?.remove(saved.id) }
            refreshDrafts()
            if (saved.id == draft.id) _draft = PostDraft()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    // MARK: Photos

    suspend fun add(data: ByteArray, name: String, from: MarketingValue? = null) {
        if (draft.photos.size >= 12) { error = "A piece takes up to 12 photos."; return }
        val jpeg = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(data) }
        if (jpeg == null) { error = "The photo could not be read."; return }
        val photo = PostPhoto(name = name, data = jpeg, source = from, toSite = from == null)
        update { it.copy(photos = it.photos + photo) }
        if (hero?.id == photo.id) {
            update { it.copy(story = it.story.withPath(listOf("bg", "photoId"), MarketingValue.string(photo.id)), square = it.square.withPath(listOf("bg", "photoId"), MarketingValue.string(photo.id))) }
            layoutIfEmpty()
        }
    }

    suspend fun layoutIfEmpty() {
        try {
            if (draft.story["layers"].array.isEmpty()) {
                val r = artwork.run(draft.story, assets, fields, mapOf("action" to "preset", "value" to "stack-left"))
                update { it.copy(story = r["doc"]) }
            }
            if (draft.square["layers"].array.isEmpty()) {
                val r = artwork.run(draft.square, assets, fields, mapOf("action" to "square", "value" to if (hero?.source?.get("marked")?.bool == true) "clean" else "catalogue"))
                update { it.copy(square = r["doc"]) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    // MARK: Drawing

    suspend fun preview() {
        if (hero == null) return
        try {
            val story = render(story = true, photo = hero, px = 540)
            storyPreview = story
            val square = render(story = false, photo = hero, px = 540)
            squarePreview = square
            if (!draft.words["captionEdited"].bool) word("caption", story["caption"])
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    suspend fun render(story: Boolean, photo: PostPhoto?, px: Int, site: Boolean = false): MarketingValue {
        var doc = if (story) draft.story else draft.square
        if (photo != null) doc = doc.withPath(listOf("bg", "photoId"), MarketingValue.string(photo.id))
        val context = LinkedHashMap<String, Any?>(config["posting"].obj.mapValues { it.value.any })
        context["whatsappNumbers"] = config["posting"]["whatsappNumbers"].array.map { it.string }
        val collection = folders.firstOrNull { it.s("folder") == draft.words.s("folder") }
        val sourceUrl = photo?.source?.s("url") ?: ""
        context["link"] = if (sourceUrl.isNotEmpty()) sourceUrl else config.s("site") + (collection?.s("path") ?: "")
        val options = LinkedHashMap<String, Any?>()
        options["px"] = px
        options["piece"] = draft.words
        options["context"] = context
        options["name"] = draft.words.s("siteName").ifEmpty { draft.title }
        options["count"] = maxOf(1, sitePhotos.size)
        options["folder"] = draft.words.s("folder")
        options["maisonHouse"] = draft.words.s("maisonHouse")
        val paint = if (story) (if (draft.paintedStoryFor == photo?.id) draft.paintedStory else null) else (if (!site && draft.paintedSquareFor == photo?.id) draft.paintedSquare else null)
        if (paint != null) {
            options["background"] = "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(paint)
            options["hideBound"] = true
        }
        return artwork.run(doc, assets, fields, options)
    }

    /** The designs as picture files to share: the story at 1080, the post at 1600. Null if the engine drew nothing. */
    suspend fun designBytes(kind: String): ByteArray? {
        val r = render(story = kind == "story", photo = hero, px = if (kind == "story") 1080 else 1600)
        return DesignProtocol.imageBytes(r)
    }

    // MARK: The AI

    suspend fun runAI(op: String, photoID: String?, target: String, params: Map<String, Any?>) {
        val source = draft.photos.firstOrNull { it.id == photoID } ?: hero ?: return
        busy = "Making $target…"
        error = null
        try {
            val result = MarketingRequest.ai(op, listOf(source.data), params)
            aiAnswer = result
            if (op == "caption") {
                val c = result["caption"]
                if (draft.words.s("headline").isEmpty()) word("headline", c["headlines"].array.firstOrNull() ?: MarketingValue.string(""))
                if (draft.words.s("hook").isEmpty()) word("hook", c["hook"])
                word("caption", c["whatsappCaption"])
                word("captionEdited", true)
            } else {
                val data = java.util.Base64.getMimeDecoder().decode(result["image"].s("data"))
                val jpeg = withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(data) } ?: throw ErpApi.Failure(0, "The AI returned no readable photo.")
                if (op == "letter" || op == "paint") {
                    update { it.copy(letteringCheck = result) }
                    if (target == "post") update { it.copy(paintedSquare = jpeg, paintedSquareFor = source.id) }
                    else update { it.copy(paintedStory = jpeg, paintedStoryFor = source.id) }
                } else {
                    val made = PostPhoto(name = target, data = jpeg, parent = source.id, check = result["check"].takeUnless { it.isNull }, source = source.source)
                    val story = result.s("aspect") == "9:16" || params["aspect"] == "9:16"
                    val adjusted = made.copy(toSite = !story && source.toSite, toWhatsApp = !story && source.toWhatsApp)
                    if (!story) update { d -> d.copy(photos = d.photos.map { if (it.id == source.id) it.copy(toSite = false, toWhatsApp = false) else it }) }
                    update { it.copy(photos = it.photos + adjusted) }
                    if (story || source.id == hero?.id) update { it.copy(story = it.story.withPath(listOf("bg", "photoId"), MarketingValue.string(adjusted.id))) }
                    if (!story) update { it.copy(square = it.square.withPath(listOf("bg", "photoId"), MarketingValue.string(adjusted.id))) }
                }
                if (PostComposerRules.needsComparing(result["check"])) said = "Compare this version with the original before posting. The piece could not be verified."
            }
            saveNow()
            preview()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        } finally {
            busy = null
        }
    }

    // MARK: Finishing

    /**
     * Queue the piece, upload its pictures and (unless [queueOnly]) send it: the queue is filed first and kept in the draft
     * (`queuedID`), so a failure half way is resumed rather than made twice. The pictures are drawn here at their sizes
     * (the website's full size, WhatsApp's 1600, the story's 1080) and uploaded one by one; `ready` tells the server they are all in.
     */
    suspend fun finish(queueOnly: Boolean) {
        if (problems.isNotEmpty()) { error = problems.joinToString(" "); return }
        if (!(siteOn || waKeys.isNotEmpty() || igOn)) { error = "Choose a destination, or share the story from your phone."; return }
        if (manualStory && !draft.words["storyOut"].bool) { error = "Share or save the story first, or choose Post only."; return }
        busy = "Preparing the post…"
        error = null
        try {
            if (draft.queuedID == null) {
                val thumb = render(story = false, photo = hero, px = 240)
                val names = thumb["names"].array.map { it.string }
                val body = PostComposerRules.queueBody(draft, instagramConnected, folders, config["featured"].bool, names, thumb.s("image"))
                val r = MarketingRequest.send("/api/website/post/queue", body)
                if (r["item"].s("id").isEmpty()) throw ErpApi.Failure(0, "The queue returned no piece.")
                update { it.copy(queuedID = r["item"].s("id"), queueReady = false) }
                saveNow()
            }
            val id = draft.queuedID!!
            if (draft.queueReady != true) {
                val existing = MarketingRequest.get("/api/website/post/queue")
                val item = existing["items"].array.firstOrNull { it.s("id") == id }
                if (item != null && item.s("status") != "draft") {
                    update { it.copy(queueReady = true) }
                    saveNow()
                }
            }
            if (draft.queueReady != true) {
                val uploads = ArrayList<Pair<String, ByteArray>>()
                if (siteOn) {
                    sitePhotos.forEachIndexed { i, p ->
                        val side = ArtworkPixels.size(p.data)?.let { minOf(it.first, it.second).toInt() } ?: 1080
                        val r = render(story = false, photo = p, px = maxOf(1080, minOf(3000, side)), site = true)
                        DesignProtocol.imageBytes(r)?.let { uploads.add("site-$i" to it) }
                    }
                }
                if (waKeys.isNotEmpty()) {
                    waPhotos.forEachIndexed { i, p ->
                        val r = render(story = false, photo = p, px = 1600)
                        DesignProtocol.imageBytes(r)?.let { uploads.add("wa-$i" to it) }
                    }
                }
                if (igOn) {
                    val r = render(story = true, photo = hero, px = 1080)
                    DesignProtocol.imageBytes(r)?.let { uploads.add("story" to it) }
                }
                uploads.forEachIndexed { i, (key, bytes) ->
                    busy = "Keeping photo ${i + 1} of ${uploads.size}…"
                    ErpApi.shared.upload("/api/website/post/queue/$id", listOf("key" to key), listOf(ErpApi.FormFile("file", "$key.jpg", "image/jpeg", bytes)))
                }
                MarketingRequest.send("/api/website/post/queue/$id", mapOf("action" to "ready"), method = "PATCH")
                update { it.copy(queueReady = true) }
                saveNow()
            }
            if (!queueOnly) { busy = "Sending…"; PostsStore.sendNow(id) }
            val entry = MarketingRequest.get("/api/website/post/queue")
            entry["items"].array.firstOrNull { it.s("id") == id }?.let { queueEntry = PostQueueEntry.from(it.any) }
            said = if (queueOnly) "In the queue. It waits until you send or schedule it." else if (queueEntry?.status == "sent") "Sent to every destination." else "Open the queued piece to see what went and retry what remains."
            PostsStore.load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
            saveNow()
        } finally {
            busy = null
        }
    }
}
